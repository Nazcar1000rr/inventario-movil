import { describe, expect, it } from 'vitest';
import {
  createExpense,
  createPurchase,
  createSale,
  getAlerts,
  getBalances,
  getFinancialSummary,
  getSoldObservations,
  getTopSellers,
  getUnsoldAging,
  periodRange,
  registerInitialStock,
  registerReturn,
  setUnitBaseCost,
  setUnitAcquiredAt,
  velocityBy,
  voidExpense,
  addRepair,
  addPayment,
  voidSale,
} from '../../src/core';
import { accessoryProduct, availableUnits, D, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

const PERIOD = { from: D('2026-01-01T05:00:00Z'), to: D('2026-03-01T05:00:00Z') };

async function scenario() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const phone = await phoneProduct(db, inv.id);
  const charger = await accessoryProduct(db, inv.id);
  await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-01-10T15:00:00Z'),
    extraCosts: 64_000,
    lines: [
      { productId: phone.id, quantity: 2, price: 3_000_000 },
      { productId: charger.id, quantity: 10, price: 200_000 },
    ],
  });
  const sale = await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-01-25T15:00:00Z'),
    discount: 5_000,
    lines: [
      { productId: phone.id, quantity: 1, unitPrice: 2_000_000 },
      { productId: charger.id, quantity: 3, unitPrice: 35_000 },
    ],
    initialPayment: 1_000_000,
    costs: [{ category: 'Comisión', amount: 50_000 }],
  });
  await createExpense(db, { opId: op(), date: D('2026-01-26T15:00:00Z'), amount: 30_000, category: 'Publicidad', inventoryId: inv.id });
  return { db, inv, phone, charger, sale };
}

describe('Etapa 3: finanzas', () => {
  it('8. calcula costos, ingresos y ganancias con un caso conocido', async () => {
    const { db, inv, sale } = await scenario();
    const lines = await db.saleLines.where('saleId').equals(sale.id).toArray();
    const iphoneLine = lines.find((l) => l.unitId)!;
    const chLine = lines.find((l) => !l.unitId)!;
    expect(iphoneLine.discountShare + chLine.discountShare).toBe(5_000);
    expect(iphoneLine.discountShare).toBe(4_751);
    expect(iphoneLine.cogs).toBe(1_530_000);
    expect(chLine.cogs).toBe(61_200);

    const s = await getFinancialSummary(db, PERIOD, null);
    expect(s.purchases).toMatchObject({ count: 1, total: 3_264_000, units: 12, extraCosts: 64_000 });
    expect(s.sales).toMatchObject({ count: 1, units: 4, gross: 2_105_000, discounts: 5_000, total: 2_100_000 });
    expect(s.netRevenue).toBe(2_100_000);
    expect(s.cogs).toBe(1_591_200);
    expect(s.grossProfit).toBe(508_800);
    expect(s.operatingExpenses).toBe(80_000);
    expect(s.netProfit).toBe(428_800);
    expect(s.collected).toBe(1_000_000);
    expect(s.profitComplete).toBe(true);

    const b = await getBalances(db, [inv.id]);
    expect(b.receivables).toBe(1_100_000);
    expect(b.available).toBe(1 + 7);
    expect(b.stockValue).toBe(1_530_000 + 142_800);
    // Inventario no vendido NO es ganancia
    expect(s.netProfit).toBeLessThan(b.stockValue);
  });

  it('10. gastos: un costo capitalizado no se resta dos veces', async () => {
    const { db, inv, phone } = await scenario();
    const [u] = await availableUnits(db, phone.id);
    await addRepair(db, { opId: op(), unitId: u.id, date: D('2026-01-27T15:00:00Z'), description: 'Cambio de batería', partsReplaced: 'Batería', cost: 100_000 });
    expect((await db.units.get(u.id))!.extraCost).toBe(100_000);
    let s = await getFinancialSummary(db, PERIOD, null);
    expect(s.operatingExpenses).toBe(80_000); // la reparación NO es gasto operativo
    expect(s.capitalizedExpenses).toBe(100_000);
    expect((await getBalances(db, [inv.id])).stockValue).toBe(1_630_000 + 142_800);
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-04T15:00:00Z'), lines: [{ productId: phone.id, unitIds: [u.id], unitPrice: 2_000_000 }], initialPayment: 2_000_000 });
    s = await getFinancialSummary(db, PERIOD, null);
    expect(s.cogs).toBe(1_591_200 + 1_630_000); // el costo capitalizado entra una sola vez, como costo de venta
    expect(s.operatingExpenses).toBe(80_000);
    expect(s.netProfit).toBe(2_100_000 + 2_000_000 - (1_591_200 + 1_630_000) - 80_000);
    // Un gasto capitalizado no se puede anular después de vender la unidad
    const capExp = (await db.expenses.toArray()).find((e) => e.treatment === 'capitalized')!;
    await expect(voidExpense(db, capExp.id)).rejects.toMatchObject({ code: 'linked' });
    // Gasto capitalizado a un producto por cantidad sube su costo promedio
    const ch = (await db.products.toArray()).find((p) => p.tracking === 'quantity')!;
    const e = await createExpense(db, { opId: op(), date: D('2026-02-05T15:00:00Z'), amount: 7_000, category: 'Transporte', treatment: 'capitalized', productId: ch.id });
    expect((await db.products.get(ch.id))!.stockValue).toBe(142_800 + 7_000);
    await voidExpense(db, e!.id);
    expect((await db.products.get(ch.id))!.stockValue).toBe(142_800);
    await expectIntegrity(db);
  });

  it('devoluciones y anulaciones en el resumen financiero', async () => {
    const { db, sale } = await scenario();
    const lines = await db.saleLines.where('saleId').equals(sale.id).toArray();
    const chLine = lines.find((l) => !l.unitId)!;
    await registerReturn(db, { opId: op(), saleId: sale.id, date: D('2026-01-28T15:00:00Z'), reason: 'No le sirvió', refundAmount: 0, lines: [{ saleLineId: chLine.id, quantity: 1, destination: 'available' }] });
    let s = await getFinancialSummary(db, PERIOD, null);
    const retAmount = Math.round((chLine.netAmount * 1) / 3);
    expect(s.returns.amount).toBe(retAmount);
    expect(s.netRevenue).toBe(2_100_000 - retAmount);
    expect(s.cogs).toBe(1_591_200 - 20_400);
    // Saldo pendiente se reduce por lo devuelto
    const bal = await import('../../src/core').then((m) => m.getSaleBalance(db, sale.id));
    expect(bal.pending).toBe(2_100_000 - retAmount - 1_000_000);
    // Una venta anulada no cuenta en ingresos, costos ni cobros
    const inv = (await db.inventories.toArray())[0];
    const charger = (await db.products.toArray()).find((p) => p.tracking === 'quantity')!;
    const s2 = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-29T15:00:00Z'), lines: [{ productId: charger.id, quantity: 1, unitPrice: 40_000 }], initialPayment: 40_000 });
    const before = await getFinancialSummary(db, PERIOD, null);
    expect(before.collected).toBe(1_000_000 + 40_000);
    await voidSale(db, s2.id, 'Prueba');
    s = await getFinancialSummary(db, PERIOD, null);
    expect(s.sales.count).toBe(1);
    expect(s.collected).toBe(1_000_000);
    await expectIntegrity(db);
  });

  it('12. calcula días en inventario y días hasta vender con fechas conocidas', async () => {
    const { db, inv, phone } = await scenario();
    const now = new Date('2026-02-09T17:00:00Z');
    const aging = await getUnsoldAging(db, [inv.id], now);
    const unitItem = aging.find((a) => a.type === 'unit')!;
    expect(unitItem.days).toBe(30); // 10 ene → 9 feb
    const lot = aging.find((a) => a.type === 'lot')!;
    expect(lot.qty).toBe(7);
    expect(lot.days).toBe(30);
    const [u] = await availableUnits(db, phone.id);
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-04T15:00:00Z'), lines: [{ productId: phone.id, unitIds: [u.id], unitPrice: 2_000_000 }] });
    const obs = await getSoldObservations(db, PERIOD, [inv.id]);
    const phoneObs = obs.filter((o) => o.productId === phone.id).map((o) => o.days).sort((a, b) => a! - b!);
    expect(phoneObs).toEqual([15, 25]);
    const chargerObs = obs.filter((o) => o.productId !== phone.id);
    expect(chargerObs.reduce((a, o) => a + o.qty, 0)).toBe(3);
    expect(chargerObs[0].days).toBe(15);
    const byModel = velocityBy(obs, (o) => ({ key: o.groupKey, label: o.productName }));
    const ph = byModel.find((v) => v.label.startsWith('iPhone'))!;
    expect(ph).toMatchObject({ count: 2, avgDays: 20, minDays: 15, maxDays: 25, unknown: 0 });
    const top = await getTopSellers(db, PERIOD, [inv.id]);
    expect(top[0]).toMatchObject({ units: 3 }); // cargadores
    expect(top.find((t) => t.name.startsWith('iPhone'))?.sellThrough).toBe(1);
  });

  it('13. fecha y costo desconocidos: no se inventan y se marcan como incompletos', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id, 'iPhone 11', '64 GB');
    const charger = await accessoryProduct(db, inv.id);
    const { unitIds } = await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: null, date: null });
    await registerInitialStock(db, { opId: op(), productId: charger.id, quantity: 5, unitCost: null, date: null });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: charger.id, quantity: 5, price: 50_000 }] });
    const u = (await db.units.get(unitIds[0]))!;
    expect(u.acquiredAt).toBeNull();
    expect(u.baseCost).toBeNull();
    const aging = await getUnsoldAging(db, [inv.id], new Date('2026-02-09T17:00:00Z'));
    expect(aging.find((a) => a.unitId === u.id)?.days).toBeNull();
    const lots = aging.filter((a) => a.type === 'lot');
    expect(lots.find((l) => l.since === null)?.qty).toBe(5);
    expect(lots.find((l) => l.since !== null)?.qty).toBe(5);

    let b = await getBalances(db, [inv.id]);
    expect(b.unknownCostCount).toBe(1 + 5);
    expect(b.stockValue).toBe(50_000); // solo lo conocido

    await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-20T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, unitPrice: 800_000 },
        { productId: charger.id, quantity: 6, unitPrice: 20_000 },
      ],
      initialPayment: 920_000,
    });
    let s = await getFinancialSummary(db, PERIOD, null);
    expect(s.cogsUnknownUnits).toBe(1 + 5); // el teléfono + 5 cargadores sin costo (salen primero)
    expect(s.cogs).toBe(10_000); // 1 cargador con costo conocido
    expect(s.profitComplete).toBe(false);
    const obs = await getSoldObservations(db, PERIOD, [inv.id]);
    const v = velocityBy(obs, (o) => ({ key: o.kind, label: o.kind }));
    expect(v.find((x) => x.key === 'phone')).toMatchObject({ count: 0, unknown: 1, avgDays: null });
    expect(v.find((x) => x.key === 'accessory')).toMatchObject({ count: 1, unknown: 5, avgDays: 10 });

    // Completar el costo del teléfono actualiza el costo de su venta
    await setUnitBaseCost(db, u.id, 500_000);
    s = await getFinancialSummary(db, PERIOD, null);
    expect(s.cogs).toBe(510_000);
    expect(s.cogsUnknownUnits).toBe(5);
    // Completar la fecha: debe ser anterior a la venta
    await expect(setUnitAcquiredAt(db, u.id, D('2026-01-25T15:00:00Z'))).rejects.toMatchObject({ code: 'incoherent_date' });
    await setUnitAcquiredAt(db, u.id, D('2026-01-05T15:00:00Z'));
    const obs2 = await getSoldObservations(db, PERIOD, [inv.id]);
    expect(obs2.find((o) => o.productId === phone.id)?.days).toBe(15);
    b = await getBalances(db, [inv.id]);
    expect(b.unknownCostCount).toBe(0);
    await expectIntegrity(db);
  });

  it('periodos: rangos de hoy/semana/mes/año y comparación del mismo tramo', () => {
    const now = new Date('2026-10-09T22:00:00-05:00');
    const m = periodRange('month', now);
    expect(new Date(m.current.from).getDate()).toBe(1);
    expect(new Date(m.previous.from).getMonth()).toBe(8);
    expect(new Date(m.current.to).getMonth()).toBe(10); // hasta el 1 de noviembre (exclusivo)
    const elapsedPrev = Date.parse(m.previous.to) - Date.parse(m.previous.from);
    const elapsedCur = Math.ceil((now.getTime() + 1) / 60_000) * 60_000 - Date.parse(m.current.from);
    expect(elapsedPrev).toBe(elapsedCur); // mismo tramo transcurrido
    expect(periodRange('month', now)).toEqual(periodRange('month', new Date(now.getTime() + 1000))); // estable
    const w = periodRange('week', now);
    expect(new Date(w.current.from).getDay()).toBe(1); // lunes
    const t = periodRange('today', now);
    expect(new Date(t.current.from).getHours()).toBe(0);
    const c = periodRange('custom', now, { from: new Date('2026-09-01T12:00:00-05:00'), to: new Date('2026-09-30T12:00:00-05:00') });
    expect(Date.parse(c.current.to) - Date.parse(c.current.from)).toBe(30 * 86_400_000);
  });

  it('avisos: stock bajo, estancados, garantías por vencer, duplicados y respaldo', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const charger = await accessoryProduct(db, inv.id, 'Cable Lightning', { lowStockThreshold: 3 });
    const phone = await phoneProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      lines: [
        { productId: charger.id, quantity: 4, price: 40_000 },
        { productId: phone.id, quantity: 3, price: 4_500_000, units: [{}, { imei: '350000000000001' }, { imei: '350000000000001' }] },
      ],
    });
    const sale = await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-31T15:00:00Z'),
      lines: [
        { productId: charger.id, quantity: 1, unitPrice: 20_000 },
        { productId: phone.id, quantity: 1, unitPrice: 2_000_000 },
      ],
      initialPayment: 0,
      warranty: { durationValue: 3, durationUnit: 'months' },
    });
    const w = await db.warranties.where('saleId').equals(sale.id).toArray();
    expect(w).toHaveLength(2);
    expect(w[0].endDate.slice(0, 10)).toBe('2026-04-30'); // 31 ene + 3 meses → 30 abr
    const a = await getAlerts(db, null, new Date('2026-04-20T15:00:00Z'));
    expect(a.lowStock).toHaveLength(1);
    expect(a.lowStock[0].available).toBe(3);
    expect(a.stale.length).toBeGreaterThan(0); // > 60 días
    expect(a.warrantiesExpiring).toHaveLength(2);
    expect(a.duplicateIdentifiers[0].identifier).toBe('350000000000001');
    expect(a.receivables).toEqual({ count: 1, amount: 2_020_000 });
    expect(a.backupDue).toBe(true);
    await addPayment(db, { opId: op(), saleId: sale.id, amount: 2_020_000, date: D('2026-02-01T15:00:00Z') });
    expect((await getAlerts(db, null, new Date('2026-04-20T15:00:00Z'))).receivables.count).toBe(0);
  });
});
