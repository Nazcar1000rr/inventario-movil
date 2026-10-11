import { describe, expect, it } from 'vitest';
import {
  AppError,
  adjustQuantity,
  correctLot,
  correctPurchase,
  correctUnitCost,
  createPurchase,
  createSale,
  explainGrowth,
  getCapitalSnapshot,
  getFinancialSummary,
  listCorrections,
  listLots,
  payDebt,
  previewPurchaseCorrection,
  previewLotCorrection,
  previewUnitCostCorrection,
  registerInitialStock,
  registerReturn,
  setProductCosting,
  voidPurchase,
  voidSale,
  writeOffUnit,
  type AppDB,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

const ALL = { from: '0000-01-01T00:00:00.000Z', to: '9999-12-31T00:00:00.000Z' };

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await expect(p).rejects.toMatchObject({ code });
}

async function expectBalanced(db: AppDB) {
  await expectIntegrity(db);
  expect((await explainGrowth(db, null)).difference).toBe(0);
}

async function lineOf(db: AppDB, saleId: string) {
  return (await db.saleLines.where('saleId').equals(saleId).toArray())[0];
}

/** 10 cargadores "a 10 000" (100 000 en total) y se venden 3. */
async function tenChargers() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const p = await accessoryProduct(db, inv.id);
  const pu = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 10, price: 100_000 }] }))!;
  const s = (await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 3, unitPrice: 15_000 }], initialPayment: 45_000 }))!;
  const line = (await db.purchaseLines.where('purchaseId').equals(pu.id).toArray())[0];
  return { db, inv, p, pu, s, line };
}

describe('v2.3 · corregir compras (productos por cantidad con lotes)', () => {
  it('cantidad mal digitada: se conserva lo pagado, cambia el costo por unidad y se recalcula lo ya vendido', async () => {
    const { db, p, pu, s, line } = await tenChargers();
    expect((await lineOf(db, s.id)).cogs).toBe(30_000);
    const input = { opId: op(), lines: [{ lineId: line.id, quantity: 8 }] };
    const pre = await previewPurchaseCorrection(db, pu.id, input);
    expect(pre.newTotal).toBe(100_000);
    expect(pre.lines[0]).toMatchObject({ oldQty: 10, newQty: 8, oldUnitCost: 10_000, newUnitCost: 12_500, stockQtyDelta: -2, profitDelta: -7_500 });
    expect(pre.lines[0].sales).toHaveLength(1);
    expect(pre.salesAffected).toBe(1);

    const r = await correctPurchase(db, pu.id, input);
    expect(r).toEqual(pre);
    const sl = await lineOf(db, s.id);
    expect(sl.cogs).toBe(37_500);
    expect(sl.lotAllocations![0].cogs).toBe(37_500);
    const [lot] = await listLots(db, p.id, true);
    expect([lot.qtyIn, lot.qty, lot.valueIn, lot.value]).toEqual([8, 5, 100_000, 62_500]);
    const prod = (await db.products.get(p.id))!;
    expect([prod.qty, prod.stockValue]).toEqual([5, 62_500]);
    const pl = (await db.purchaseLines.get(line.id))!;
    expect([pl.quantity, pl.price, pl.totalCost]).toEqual([8, 100_000, 100_000]);
    const fin = await getFinancialSummary(db, ALL, null);
    expect(fin.cogs).toBe(37_500);
    expect((await db.purchases.get(pu.id))!.correctedAt).toBeTruthy();
    // Los movimientos anteriores no se tocan: se agregan correcciones
    const corr = (await db.movements.where('productId').equals(p.id).toArray()).filter((m) => m.correction);
    expect(corr.map((m) => [m.type, m.qtyDelta, m.costDelta]).sort()).toEqual([
      ['purchase', -2, 0],
      ['sale', 0, -7_500],
    ]);
    expect(corr.find((m) => m.type === 'sale')!.at).toBe(s.date);
    expect((await listCorrections(db, pu.id))[0].summary).toContain('cantidad 10 → 8');
    await expectBalanced(db);
    // Repetir la misma operación (doble toque) no hace nada
    expect(await correctPurchase(db, pu.id, input)).toBeNull();
    expect((await lineOf(db, s.id)).cogs).toBe(37_500);
  });

  it('costo por unidad mal digitado: cambia lo pagado, la caja, la venta y la pérdida de lo dado de baja', async () => {
    const { db, inv, p, pu, s, line } = await tenChargers();
    await adjustQuantity(db, { opId: op(), productId: p.id, direction: 'out', quantity: 1, date: D('2026-09-06T15:00:00Z'), reason: 'Se dañó' });
    const cashBefore = (await getCapitalSnapshot(db, null)).cash;
    // En realidad costaban 9 000 c/u
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, price: 90_000 }] }))!;
    expect(r.newTotal).toBe(90_000);
    expect(r.lines[0].writeOffDelta).toBe(-1_000);
    expect(r.lines[0].profitDelta).toBe(4_000);
    expect((await lineOf(db, s.id)).cogs).toBe(27_000);
    const [lot] = await listLots(db, p.id, true);
    expect([lot.qty, lot.value]).toEqual([6, 54_000]);
    expect((await getCapitalSnapshot(db, null)).cash).toBe(cashBefore + 10_000);
    const fin = await getFinancialSummary(db, ALL, null);
    expect(fin.writeOffs).toBe(9_000);
    expect(fin.cogs).toBe(27_000);
    await expectBalanced(db);
    // La compra se puede seguir corrigiendo, y se puede vender lo que queda al costo nuevo
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-10T15:00:00Z'), lines: [{ productId: p.id, quantity: 6, unitPrice: 15_000 }], initialPayment: 90_000 });
    expect((await db.products.get(p.id))!.stockValue).toBe(0);
    await expectBalanced(db);
  });

  it('no deja una cantidad menor a lo que ya salió, ni recalcular ventas con devoluciones', async () => {
    const { db, pu, s, line } = await tenChargers();
    await expectAppError(correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 2 }] }), 'below_outflows');
    // Exactamente lo vendido: todo el costo pasa a la venta y el lote queda en cero
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 3 }] }))!;
    expect(r.lines[0].sales[0].newCogs).toBe(100_000);
    await expectBalanced(db);
    const sl = await lineOf(db, s.id);
    await registerReturn(db, { opId: op(), saleId: s.id, date: D('2026-09-07T15:00:00Z'), reason: 'Cambio', refundAmount: 0, lines: [{ saleLineId: sl.id, quantity: 1, destination: 'available' }] });
    await expectAppError(correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, price: 90_000 }] }), 'has_returns');
  });

  it('una venta anulada no cuenta; después de corregir se puede anular la venta y la compra', async () => {
    const { db, p, pu, s, line } = await tenChargers();
    await voidSale(db, s.id, 'Error');
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 12, price: 120_000 }] }))!;
    expect(r.lines[0].sales).toHaveLength(0);
    expect((await db.products.get(p.id))!.qty).toBe(12);
    await expectBalanced(db);
    await voidPurchase(db, pu.id, 'Era de otro inventario');
    expect((await db.products.get(p.id))!.qty).toBe(0);
    await expectBalanced(db);
  });

  it('compra con deuda: si se financió todo, la deuda cambia con el total; si fue una parte, se limita; no baja de lo abonado', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id);
    const full = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 10, price: 100_000 }], funding: { kind: 'credit_card', creditor: 'Visa' } }))!;
    const fl = (await db.purchaseLines.where('purchaseId').equals(full.id).toArray())[0];
    const r = (await correctPurchase(db, full.id, { opId: op(), lines: [{ lineId: fl.id, price: 120_000 }] }))!;
    expect(r.debt).toMatchObject({ oldPrincipal: 100_000, newPrincipal: 120_000 });
    expect((await db.debts.get(full.debtId!))!.principal).toBe(120_000);
    await expectBalanced(db);

    const part = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-02T15:00:00Z'), lines: [{ productId: p.id, quantity: 5, price: 50_000 }], funding: { kind: 'supplier', creditor: 'Prov', amount: 40_000 } }))!;
    const pl = (await db.purchaseLines.where('purchaseId').equals(part.id).toArray())[0];
    await payDebt(db, { opId: op(), debtId: part.debtId!, date: D('2026-09-03T15:00:00Z'), principal: 30_000 });
    await expectAppError(correctPurchase(db, part.id, { opId: op(), lines: [{ lineId: pl.id, price: 25_000 }] }), 'debt_paid_more');
    await correctPurchase(db, part.id, { opId: op(), lines: [{ lineId: pl.id, price: 35_000 }] });
    const d = (await db.debts.get(part.debtId!))!;
    expect([d.principal, d.status]).toEqual([35_000, 'open']);
    await correctPurchase(db, part.id, { opId: op(), lines: [{ lineId: pl.id, price: 30_000 }] });
    expect((await db.debts.get(part.debtId!))!.status).toBe('paid');
    await expectBalanced(db);
  });

  it('gastos de la compra y varias líneas: el reparto se recalcula y todo cuadra', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const a = await accessoryProduct(db, inv.id, 'Cable');
    const b = await accessoryProduct(db, inv.id, 'Funda');
    const pu = (await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-09-01T15:00:00Z'),
      extraCosts: 10_000,
      lines: [
        { productId: a.id, quantity: 5, price: 50_000 },
        { productId: b.id, quantity: 5, price: 50_000 },
      ],
    }))!;
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-02T15:00:00Z'), lines: [{ productId: b.id, quantity: 2, unitPrice: 20_000 }], initialPayment: 40_000 });
    const lines = await db.purchaseLines.where('purchaseId').equals(pu.id).toArray();
    const la = lines.find((l) => l.productId === a.id)!;
    const r = (await correctPurchase(db, pu.id, { opId: op(), extraCosts: 13_000, lines: [{ lineId: la.id, price: 70_000 }] }))!;
    expect(r.newTotal).toBe(133_000);
    expect(r.lines).toHaveLength(2);
    expect(r.salesAffected).toBe(1);
    await expectBalanced(db);
  });

  it('costo promedio: se corrige si no hubo salidas después de la compra; si las hubo, se bloquea', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Cable', { costing: 'average' });
    const pu = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 10, price: 100_000 }] }))!;
    const line = (await db.purchaseLines.where('purchaseId').equals(pu.id).toArray())[0];
    await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 9 }] });
    expect((await db.products.get(p.id))!.qty).toBe(9);
    await expectBalanced(db);
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-02T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 20_000 }], initialPayment: 20_000 });
    await expectAppError(correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 10 }] }), 'later_outflows');
    // Al activar los lotes después, la corrección se respeta
    await setProductCosting(db, p.id, 'lots');
    await expectBalanced(db);
  });
});

describe('v2.3 · corregir compras de equipos (por unidad)', () => {
  async function twoPhones() {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await phoneProduct(db, inv.id);
    const pu = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 2, price: 4_000_000 }] }))!;
    const line = (await db.purchaseLines.where('purchaseId').equals(pu.id).toArray())[0];
    const [u1, u2] = await Promise.all(line.unitIds.map(async (id) => (await db.units.get(id))!));
    const s = (await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-03T15:00:00Z'), lines: [{ productId: p.id, unitIds: [u1.id], unitPrice: 2_400_000 }], initialPayment: 2_400_000 }))!;
    return { db, inv, p, pu, line, u1, u2, s };
  }

  it('precio mal digitado: cambia el costo de cada equipo y la ganancia del que ya se vendió', async () => {
    const { db, pu, line, u1, u2, s } = await twoPhones();
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, price: 3_800_000 }] }))!;
    expect(r.lines[0]).toMatchObject({ kind: 'units', newUnitCost: 1_900_000, stockValueDelta: -100_000, profitDelta: 100_000 });
    expect((await db.units.get(u1.id))!.baseCost).toBe(1_900_000);
    expect((await db.units.get(u2.id))!.baseCost).toBe(1_900_000);
    expect((await lineOf(db, s.id)).cogs).toBe(1_900_000);
    await expectBalanced(db);
  });

  it('quitar un equipo que no venía y agregar uno que faltó; no se puede quitar uno vendido', async () => {
    const { db, p, pu, line, u1, u2 } = await twoPhones();
    await expectAppError(correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, removeUnitIds: [u1.id] }] }), 'not_in_stock');
    await expectAppError(correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, quantity: 1 }] }), 'choose_units');
    // Venía solo uno: lo pagado fue 2 000 000
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, removeUnitIds: [u2.id], price: 2_000_000 }] }))!;
    expect(r.lines[0].removedUnits).toEqual([u2.code]);
    expect((await db.units.get(u2.id))!.status).toBe('archived');
    expect((await db.purchaseLines.get(line.id))!.unitIds).toEqual([u1.id]);
    expect((await db.purchases.get(pu.id))!.total).toBe(2_000_000);
    await expectBalanced(db);
    // Faltó registrar uno de 2 100 000
    await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, addUnits: 1, price: 4_100_000 }] });
    const units = await db.units.where('productId').equals(p.id).toArray();
    expect(units.filter((u) => u.status === 'available')).toHaveLength(1);
    expect((await db.purchaseLines.get(line.id))!.unitIds).toHaveLength(2);
    await expectBalanced(db);
  });

  it('equipo dado de baja: la pérdida se corrige', async () => {
    const { db, pu, line, u2 } = await twoPhones();
    await writeOffUnit(db, u2.id, 'Robo', D('2026-09-04T15:00:00Z'));
    const r = (await correctPurchase(db, pu.id, { opId: op(), lines: [{ lineId: line.id, price: 4_200_000 }] }))!;
    expect(r.lines[0].writeOffDelta).toBe(100_000);
    expect((await getFinancialSummary(db, ALL, null)).writeOffs).toBe(2_100_000);
    await expectBalanced(db);
  });
});

describe('v2.3 · corregir stock que ya tenías y ajustes', () => {
  it('completar el costo desconocido de un lote: ventas y bajas pasan a tener costo', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id);
    await registerInitialStock(db, { opId: op(), productId: p.id, quantity: 10, unitCost: null, date: null });
    const s = (await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 4, unitPrice: 15_000 }], initialPayment: 60_000 }))!;
    await adjustQuantity(db, { opId: op(), productId: p.id, direction: 'out', quantity: 1, date: D('2026-09-06T15:00:00Z'), reason: 'Perdido' });
    expect((await getFinancialSummary(db, ALL, null)).profitComplete).toBe(false);
    const [lot] = await listLots(db, p.id, true);
    const pre = await previewLotCorrection(db, lot.id, { unitCost: 8_000 });
    expect(pre).toMatchObject({ oldTotal: null, newTotal: 80_000, stockValueDelta: 40_000, writeOffDelta: 8_000, profitDelta: -40_000 });
    await correctLot(db, lot.id, { opId: op(), unitCost: 8_000 });
    const sl = await lineOf(db, s.id);
    expect([sl.cogs, sl.cogsUnknownQty]).toEqual([32_000, 0]);
    const prod = (await db.products.get(p.id))!;
    expect([prod.qty, prod.stockValue, prod.unknownCostQty]).toEqual([5, 40_000, 0]);
    const fin = await getFinancialSummary(db, ALL, null);
    expect(fin.profitComplete).toBe(true);
    expect(fin.writeOffs).toBe(8_000);
    expect((await getCapitalSnapshot(db, null)).goodsContributed).toBe(80_000);
    await expectBalanced(db);
    // Ahora la cantidad: eran 12 (el costo por unidad se conserva)
    await correctLot(db, lot.id, { opId: op(), quantity: 12 });
    expect((await db.products.get(p.id))!.qty).toBe(7);
    expect((await db.lots.get(lot.id))!.valueIn).toBe(96_000);
    await expectBalanced(db);
    await expectAppError(correctLot(db, lot.id, { opId: op(), unitCost: null }), 'invalid');
  });

  it('corregir cantidad y costo conocido de stock existente y de un ajuste de conteo (mercancía encontrada)', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id);
    await registerInitialStock(db, { opId: op(), productId: p.id, quantity: 5, unitCost: 10_000, date: D('2026-08-01T15:00:00Z') });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 2, unitPrice: 15_000 }], initialPayment: 30_000 });
    const [initial] = await listLots(db, p.id, true);
    await correctLot(db, initial.id, { opId: op(), quantity: 6, unitCost: 11_000 });
    expect((await db.products.get(p.id))!.stockValue).toBe(44_000);
    await expectBalanced(db);
    await adjustQuantity(db, { opId: op(), productId: p.id, direction: 'in', quantity: 2, unitCost: 9_000, date: D('2026-09-10T15:00:00Z'), reason: 'Encontrados' });
    const adj = (await listLots(db, p.id, true)).find((l) => l.source === 'adjust')!;
    await correctLot(db, adj.id, { opId: op(), quantity: 3 });
    const snap = await getCapitalSnapshot(db, null);
    expect(snap.foundStock).toBe(27_000);
    await expectBalanced(db);
    const pur = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-11T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, price: 9_000 }] }))!;
    const pl = (await listLots(db, p.id)).find((l) => l.purchaseId === pur.id)!;
    await expectAppError(correctLot(db, pl.id, { opId: op(), quantity: 2 }), 'from_purchase');
  });

  it('equipo de stock que ya tenías: corregir su costo aunque ya esté vendido; completar uno desconocido', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await phoneProduct(db, inv.id);
    const { unitIds } = await registerInitialStock(db, { opId: op(), productId: p.id, quantity: 2, unitCost: 1_500_000, date: D('2026-08-01T15:00:00Z') });
    const s = (await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-05T15:00:00Z'), lines: [{ productId: p.id, unitIds: [unitIds[0]], unitPrice: 2_000_000 }], initialPayment: 2_000_000 }))!;
    const pre = await previewUnitCostCorrection(db, unitIds[0], { cost: 1_600_000 });
    expect(pre.profitDelta).toBe(-100_000);
    await correctUnitCost(db, unitIds[0], { opId: op(), cost: 1_600_000 });
    expect((await lineOf(db, s.id)).cogs).toBe(1_600_000);
    await correctUnitCost(db, unitIds[1], { opId: op(), cost: 1_400_000 });
    expect((await getCapitalSnapshot(db, null)).goodsContributed).toBe(3_000_000);
    await expectBalanced(db);

    const { unitIds: unk } = await registerInitialStock(db, { opId: op(), productId: p.id, quantity: 1, unitCost: null, date: null });
    const s2 = (await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-06T15:00:00Z'), lines: [{ productId: p.id, unitIds: [unk[0]], unitPrice: 1_000_000 }], initialPayment: 1_000_000 }))!;
    const pre2 = await previewUnitCostCorrection(db, unk[0], { cost: 800_000 });
    expect(pre2.sales[0]).toMatchObject({ completed: true, newCogs: 800_000 });
    await correctUnitCost(db, unk[0], { opId: op(), cost: 800_000 });
    expect((await lineOf(db, s2.id)).cogsUnknownQty).toBe(0);
    await expectBalanced(db);

    const pu = (await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-07T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, price: 1_000_000 }] }))!;
    const bought = (await db.purchaseLines.where('purchaseId').equals(pu.id).toArray())[0].unitIds[0];
    await expectAppError(correctUnitCost(db, bought, { opId: op(), cost: 900_000 }), 'from_purchase');
  });
});
