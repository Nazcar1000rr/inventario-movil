import { describe, expect, it } from 'vitest';
import {
  AppError,
  addCapitalMovement,
  addPersonalSpending,
  addPurchaseCost,
  addTripCost,
  antProjection,
  compareWithStock,
  createPurchase,
  createSale,
  createSupplier,
  explainGrowth,
  getFinancialSummary,
  getLastPricePaid,
  getPersonalMonth,
  getPurchaseAddedCosts,
  getPurchasePriceHistory,
  listLots,
  listPurchasesOfDay,
  personalSpendingImpact,
  previewPurchaseCost,
  priceChange,
  updateSettings,
  voidExpense,
  voidPurchase,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('v2.1 · precio de compra', () => {
  it('la última vez pagaste…: historial por producto (en todos los inventarios) y por proveedor', async () => {
    const db = await makeDB();
    const a = await setupInventory(db, 'Mío');
    const b = await setupInventory(db, 'Primo');
    const old = await createSupplier(db, { name: 'Proveedor viejo' });
    const nuevo = await createSupplier(db, { name: 'Proveedor nuevo' });
    const pa = await accessoryProduct(db, a.id, 'Audífonos Bluetooth');
    const pb = await accessoryProduct(db, b.id, 'audifonos bluetooth');
    await createPurchase(db, { opId: op(), inventoryId: a.id, supplierId: old.id, date: D('2026-08-01T15:00:00Z'), lines: [{ productId: pa.id, quantity: 5, price: 150_000 }] });
    await createPurchase(db, { opId: op(), inventoryId: b.id, supplierId: old.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: pb.id, quantity: 2, price: 62_000 }] });
    await createPurchase(db, { opId: op(), inventoryId: a.id, supplierId: nuevo.id, date: D('2026-10-01T15:00:00Z'), extraCosts: 8_000, lines: [{ productId: pa.id, quantity: 4, price: 88_000 }] });
    const h = await getPurchasePriceHistory(db, pa.id);
    expect(h.map((x) => [x.unitPrice, x.unitCost, x.supplierName])).toEqual([
      [22_000, 24_000, 'Proveedor nuevo'],
      [31_000, 31_000, 'Proveedor viejo'],
      [30_000, 30_000, 'Proveedor viejo'],
    ]);
    const lp = await getLastPricePaid(db, pa.id, old.id);
    expect(lp.last!.unitPrice).toBe(22_000);
    expect(lp.previous!.unitPrice).toBe(31_000);
    expect(lp.lastFromSupplier!.unitPrice).toBe(31_000);
    expect(lp.bySupplier.map((s) => [s.supplierName, s.last.unitPrice, s.count, s.min, s.max])).toEqual([
      ['Proveedor nuevo', 22_000, 1, 22_000, 22_000],
      ['Proveedor viejo', 31_000, 2, 30_000, 31_000],
    ]);
    expect(priceChange(22_000, 31_000)).toEqual({ diff: -9_000, pct: -29 });
    expect(priceChange(33_000, 30_000)).toEqual({ diff: 3_000, pct: 10 });
    expect((await getLastPricePaid(db, (await accessoryProduct(db, a.id, 'Nuevo producto')).id)).last).toBeNull();
  });

  it('aviso al comprar más barato: cuánto más te costó lo anterior y su precio mínimo', async () => {
    const db = await makeDB();
    await updateSettings(db, { pricing: { minMarginType: 'percent', minMarginValue: 10 } } as never);
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Audífonos');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 5, price: 150_000 }] });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-10T15:00:00Z'), lines: [{ productId: p.id, quantity: 2, price: 50_000 }] });
    const c = await compareWithStock(db, p.id, 22_000);
    expect(c.cheaper).toBe(true);
    expect(c.items.map((x) => [x.qty, x.unitCost, x.diffPerUnit, x.minPrice])).toEqual([
      [5, 30_000, 8_000, 33_000],
      [2, 25_000, 3_000, 27_500],
    ]);
    expect(c.pricierQty).toBe(7);
    expect(c.extraTotal).toBe(46_000);
    expect(c.moreExpensive).toBe(false);
    const c2 = await compareWithStock(db, p.id, 35_000);
    expect([c2.cheaper, c2.moreExpensive, c2.avgCost]).toEqual([false, true, Math.round(200_000 / 7)]);
    // Teléfonos: compara con las unidades disponibles
    const ph = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: ph.id, quantity: 2, price: 3_000_000 }] });
    const c3 = await compareWithStock(db, ph.id, 1_400_000);
    expect([c3.cheaper, c3.pricierQty, c3.extraTotal]).toEqual([true, 2, 200_000]);
  });
});

describe('v2.1 · gastos agregados a compras', () => {
  async function scenario() {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const hp = await accessoryProduct(db, inv.id, 'Audífonos');
    const ph = await phoneProduct(db, inv.id);
    const pu = (await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-10-01T15:00:00Z'),
      lines: [
        { productId: hp.id, quantity: 5, price: 150_000 },
        { productId: ph.id, quantity: 2, price: 3_000_000 },
      ],
    }))!;
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-02T15:00:00Z'), lines: [{ productId: hp.id, quantity: 2, unitPrice: 45_000 }, { productId: ph.id, quantity: 1, unitPrice: 1_800_000 }], initialPayment: 1_890_000 });
    return { db, inv, hp, ph, pu };
  }

  it('lo que sigue en existencia sube de costo; lo ya vendido queda como gasto', async () => {
    const { db, hp, ph, pu } = await scenario();
    const pv = await previewPurchaseCost(db, [pu.id], 70_000, 'units');
    expect([pv.capitalized, pv.operating]).toEqual([40_000, 30_000]);
    expect(pv.lines.map((l) => [l.share, l.capitalized, l.operating, l.inStockQty]).sort((x, y) => y[0] - x[0])).toEqual([
      [50_000, 30_000, 20_000, 3],
      [20_000, 10_000, 10_000, 1],
    ]);
    const before = await getFinancialSummary(db, { from: D('2026-10-01T00:00:00Z'), to: D('2026-11-01T00:00:00Z') }, null);
    const r = await addPurchaseCost(db, pu.id, { opId: op(), date: D('2026-10-03T15:00:00Z'), amount: 70_000, category: 'Transporte', allocation: 'units' });
    expect(r!.split.capitalized).toBe(40_000);
    expect((await listLots(db, hp.id)).map((l) => [l.qty, l.value])).toEqual([[3, 120_000]]);
    const unit = (await db.units.where('productId').equals(ph.id).filter((u) => u.status === 'available').toArray())[0];
    expect(unit.extraCost).toBe(10_000);
    const after = await getFinancialSummary(db, { from: D('2026-10-01T00:00:00Z'), to: D('2026-11-01T00:00:00Z') }, null);
    expect(before.netProfit - after.netProfit).toBe(30_000);
    expect((await explainGrowth(db, null)).difference).toBe(0);
    const added = await getPurchaseAddedCosts(db, pu.id);
    expect(added.map((x) => [x.amount, x.capitalized, x.operating, x.shared])).toEqual([[70_000, 40_000, 30_000, false]]);
    await expectIntegrity(db);
    await expectAppError(voidPurchase(db, pu.id, 'Error'), 'has_costs');
    // Anular una parte anula todo el grupo
    const anyExp = (await db.expenses.where('purchaseId').equals(pu.id).toArray()).find((e) => e.costGroupId)!;
    await voidExpense(db, anyExp.id);
    expect(await db.expenses.filter((e) => e.costGroupId === r!.groupId && e.status === 'active').count()).toBe(0);
    expect((await listLots(db, hp.id)).map((l) => l.value)).toEqual([90_000]);
    expect((await db.units.get(unit.id))!.extraCost).toBe(0);
    await expectIntegrity(db);
  });

  it('un gasto del viaje se reparte entre las compras del día', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const a = await accessoryProduct(db, inv.id, 'Audífonos');
    const c = await accessoryProduct(db, inv.id, 'Cargadores', { costing: 'average' });
    const p1 = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-10T14:00:00Z'), lines: [{ productId: a.id, quantity: 5, price: 150_000 }] }))!;
    const p2 = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-10T16:00:00Z'), lines: [{ productId: c.id, quantity: 4, price: 88_000 }] }))!;
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-09T16:00:00Z'), lines: [{ productId: c.id, quantity: 1, price: 22_000 }] });
    expect((await listPurchasesOfDay(db, D('2026-10-10T12:00:00Z'))).map((p) => p.id)).toEqual([p1.id, p2.id]);
    const opId = op();
    const r = await addTripCost(db, [p1.id, p2.id], { opId, date: D('2026-10-10T20:00:00Z'), amount: 23_800, category: 'Transporte', notes: 'Pasajes y almuerzo' });
    expect(r!.split.lines.map((l) => [l.share, l.capitalized])).toEqual([
      [15_000, 15_000],
      [8_800, 8_800],
    ]);
    expect(await addTripCost(db, [p1.id, p2.id], { opId, date: D('2026-10-10T20:00:00Z'), amount: 23_800, category: 'Transporte' })).toBeNull();
    expect((await listLots(db, a.id))[0].unitCost).toBe(33_000);
    expect((await db.products.get(c.id))!.stockValue).toBe(88_000 + 22_000 + 8_800);
    expect((await getPurchaseAddedCosts(db, p2.id))[0].shared).toBe(true);
    await expectIntegrity(db);
  });

  it('producto con costo promedio: se capitaliza la parte que sigue en existencia', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const c = await accessoryProduct(db, inv.id, 'Cables', { costing: 'average' });
    const pu = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: c.id, quantity: 4, price: 40_000 }] }))!;
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-02T15:00:00Z'), lines: [{ productId: c.id, quantity: 3, unitPrice: 20_000 }] });
    const r = await addPurchaseCost(db, pu.id, { opId: op(), date: D('2026-10-03T15:00:00Z'), amount: 4_000, category: 'Envío' });
    expect([r!.split.capitalized, r!.split.operating]).toEqual([1_000, 3_000]);
    expect((await db.products.get(c.id))!.stockValue).toBe(11_000);
    await expectAppError(addPurchaseCost(db, pu.id, { date: D('2026-10-03T15:00:00Z'), amount: 0, category: 'Envío' }), 'zero_amount');
    await expectIntegrity(db);
  });
});

describe('v2.1 · gastos personales', () => {
  it('dice si el gasto sale de las ganancias o del capital, sin tocar la ganancia del negocio', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-09-01T15:00:00Z'), amount: 2_000_000 });
    const ph = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: ph.id, quantity: 1, price: 1_000_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-03T15:00:00Z'), lines: [{ productId: ph.id, quantity: 1, unitPrice: 1_300_000 }], initialPayment: 1_300_000 });
    const day = D('2026-10-10T15:00:00Z');
    const i1 = await personalSpendingImpact(db, 100_000, day);
    expect([i1.month.profit, i1.fromProfit, i1.fromCapital, i1.level, i1.pctOfProfit]).toEqual([300_000, 100_000, 0, 'ok', 33]);
    await addPersonalSpending(db, { opId: op(), date: D('2026-10-05T15:00:00Z'), amount: 100_000, tag: 'Gusto', notes: 'Tenis', willRepay: false });
    const i2 = await personalSpendingImpact(db, 80_000, day);
    expect([i2.takenAfter, i2.level, i2.freeProfitAfter]).toEqual([180_000, 'warn', 120_000]);
    const i3 = await personalSpendingImpact(db, 250_000, day);
    expect([i3.fromProfit, i3.fromCapital, i3.level]).toEqual([200_000, 50_000, 'danger']);
    expect(i3.cash).toBe(2_000_000 - 1_000_000 + 1_300_000 - 100_000);
    await addPersonalSpending(db, { opId: op(), date: D('2026-10-06T15:00:00Z'), amount: 6_000, tag: 'Gasto hormiga', willRepay: true });
    const m = await getPersonalMonth(db, new Date(day));
    expect([m.taken, m.personal, m.personalCount, m.ant, m.antCount]).toEqual([106_000, 106_000, 2, 6_000, 1]);
    expect(m.byTag.map((t) => t.tag)).toEqual(['Gusto', 'Gasto hormiga']);
    // No es gasto del negocio: la ganancia sigue igual y el crecimiento cuadra
    expect(m.profit).toBe(300_000);
    expect((await explainGrowth(db, null)).difference).toBe(0);
    const loan = (await db.capital.toArray()).find((c) => c.kind === 'owner_loan')!;
    expect([loan.personal, loan.tag]).toEqual([true, 'Gasto hormiga']);
    await expectAppError(addPersonalSpending(db, { opId: op(), date: day, amount: 1_000, tag: ' ', willRepay: false }), 'required');
    // Sin ganancia en el mes, todo sale del capital
    const nov = await personalSpendingImpact(db, 10_000, D('2026-11-02T15:00:00Z'));
    expect([nov.month.profit, nov.fromCapital, nov.level]).toEqual([0, 10_000, 'danger']);
    await expectIntegrity(db);
  });

  it('proyección del gasto hormiga', () => {
    expect(antProjection(5_000, 7)).toEqual({ month: 151_667, year: 1_820_000 });
  });
});
