import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  AppDB,
  AppError,
  DB_SCHEMA_VERSION,
  SCHEMA_V2,
  TABLES_V2,
  adjustQuantity,
  buildLotsFromHistory,
  getCapitalSnapshot,
  createBackup,
  createExpense,
  createPurchase,
  createSale,
  createSupplier,
  explainGrowth,
  getProductPricing,
  getSoldObservations,
  getUnsoldAging,
  initDatabase,
  listLots,
  migrateTables,
  parseBackup,
  planLotConsumption,
  readAllTables,
  registerInitialStock,
  registerReturn,
  restoreBackup,
  setProductCosting,
  updateSettings,
  voidExpense,
  voidPurchase,
  voidSale,
  type Lot,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await expect(p).rejects.toMatchObject({ code });
}

/** Audífonos: 5 a 30 000 (proveedor viejo) y luego 4 a 22 000 (proveedor nuevo, más barato). */
async function twoPrices() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const old = await createSupplier(db, { name: 'Proveedor viejo' });
  const nuevo = await createSupplier(db, { name: 'Proveedor nuevo' });
  const p = await accessoryProduct(db, inv.id, 'Audífonos Bluetooth');
  const p1 = await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: old.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 5, price: 150_000 }] });
  const p2 = await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: nuevo.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 4, price: 88_000 }] });
  const lots = await listLots(db, p.id);
  return { db, inv, p, p1: p1!, p2: p2!, lots, old, nuevo };
}

describe('v2.1 · lotes por precio de compra', () => {
  it('los productos por cantidad usan lotes por defecto; se puede apagar en Ajustes; los de unidad no', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    expect((await accessoryProduct(db, inv.id)).costing).toBe('lots');
    expect((await phoneProduct(db, inv.id)).costing).toBe('average');
    expect((await accessoryProduct(db, inv.id, 'Cable', { costing: 'average' })).costing).toBe('average');
    await updateSettings(db, { lotsByDefault: false });
    expect((await accessoryProduct(db, inv.id, 'Funda')).costing).toBe('average');
  });

  it('cada compra crea su lote con su costo y proveedor; la venta saca primero el más antiguo', async () => {
    const { db, inv, p, lots, old, nuevo } = await twoPrices();
    expect(lots.map((l) => [l.qty, l.value, l.unitCost, l.supplierId])).toEqual([
      [5, 150_000, 30_000, old.id],
      [4, 88_000, 22_000, nuevo.id],
    ]);
    const s = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 6, unitPrice: 45_000 }], initialPayment: 270_000 });
    const line = (await db.saleLines.where('saleId').equals(s!.id).toArray())[0];
    // 5 × 30 000 + 1 × 22 000 (con costo promedio habría sido 158 667)
    expect(line.cogs).toBe(172_000);
    expect(line.lotAllocations!.map((t) => [t.qty, t.cogs])).toEqual([
      [5, 150_000],
      [1, 22_000],
    ]);
    const after = await listLots(db, p.id);
    expect(after.map((l) => [l.qty, l.value])).toEqual([[3, 66_000]]);
    const prod = (await db.products.get(p.id))!;
    expect([prod.qty, prod.stockValue]).toEqual([3, 66_000]);
    await expectIntegrity(db);
  });

  it('se puede elegir el lote al vender; anular la venta devuelve cada unidad a su lote', async () => {
    const { db, inv, p, lots } = await twoPrices();
    const s = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 2, unitPrice: 40_000, lotId: lots[1].id }] });
    const line = (await db.saleLines.where('saleId').equals(s!.id).toArray())[0];
    expect(line.cogs).toBe(44_000);
    expect((await listLots(db, p.id)).map((l) => l.qty)).toEqual([5, 2]);
    // Pedir más de lo que tiene el lote elegido: completa con el más antiguo
    const s2 = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-06T15:00:00Z'), lines: [{ productId: p.id, quantity: 3, unitPrice: 40_000, lotId: lots[1].id }] });
    const l2 = (await db.saleLines.where('saleId').equals(s2!.id).toArray())[0];
    expect(l2.cogs).toBe(2 * 22_000 + 30_000);
    await voidSale(db, s2!.id, 'Error');
    await voidSale(db, s!.id, 'Error');
    expect((await listLots(db, p.id)).map((l) => [l.qty, l.value])).toEqual([
      [5, 150_000],
      [4, 88_000],
    ]);
    await expectIntegrity(db);
  });

  it('un lote vacío no se puede elegir y no se vende más de lo que hay', async () => {
    const { db, inv, p, lots } = await twoPrices();
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 4, unitPrice: 40_000, lotId: lots[1].id }] });
    await expectAppError(createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-06T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 40_000, lotId: lots[1].id }] }), 'lot_empty');
    await expectAppError(createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-06T15:00:00Z'), lines: [{ productId: p.id, quantity: 6, unitPrice: 40_000 }] }), 'insufficient_stock');
    await expectIntegrity(db);
  });

  it('devoluciones: vuelve como lote de devolución con su costo; si llega dañado no crea lote', async () => {
    const { db, inv, p } = await twoPrices();
    const s = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 6, unitPrice: 45_000 }] });
    const line = (await db.saleLines.where('saleId').equals(s!.id).toArray())[0];
    await registerReturn(db, { opId: op(), saleId: s!.id, date: D('2026-10-06T15:00:00Z'), reason: 'No le gustó', refundAmount: 0, lines: [{ saleLineId: line.id, quantity: 2, destination: 'available' }] });
    await registerReturn(db, { opId: op(), saleId: s!.id, date: D('2026-10-07T15:00:00Z'), reason: 'No carga', refundAmount: 0, lines: [{ saleLineId: line.id, quantity: 1, destination: 'damaged' }] });
    const ls = await listLots(db, p.id);
    expect(ls.map((l) => [l.source, l.qty])).toEqual([
      ['purchase', 3],
      ['return', 2],
    ]);
    const prod = (await db.products.get(p.id))!;
    expect(prod.qty).toBe(5);
    expect(ls.reduce((a, l) => a + l.value, 0)).toBe(prod.stockValue);
    await expectIntegrity(db);
  });

  it('ajustes: la salida puede elegir lote; la entrada y el stock inicial crean lotes; sin costo sale primero', async () => {
    const { db, p, lots } = await twoPrices();
    await adjustQuantity(db, { opId: op(), productId: p.id, direction: 'out', quantity: 1, date: D('2026-10-02T15:00:00Z'), reason: 'Se dañó', lotId: lots[1].id });
    expect((await listLots(db, p.id)).map((l) => l.qty)).toEqual([5, 3]);
    await adjustQuantity(db, { opId: op(), productId: p.id, direction: 'in', quantity: 2, unitCost: 25_000, date: D('2026-10-03T15:00:00Z'), reason: 'Encontrados' });
    await registerInitialStock(db, { opId: op(), productId: p.id, quantity: 2, unitCost: null, date: null });
    const ls = await listLots(db, p.id);
    expect(ls.map((l) => [l.source, l.qty, l.costKnown])).toEqual([
      ['initial', 2, false],
      ['purchase', 5, true],
      ['purchase', 3, true],
      ['adjust', 2, true],
    ]);
    const plan = planLotConsumption(ls as Lot[], 3);
    expect(plan!.map((t) => [t.qty, t.unknown])).toEqual([
      [2, true],
      [1, false],
    ]);
    await expectIntegrity(db);
  });

  it('gastos capitalizados: se reparten entre los lotes o van a uno elegido, y se pueden anular', async () => {
    const { db, p, lots } = await twoPrices();
    const e1 = await createExpense(db, { opId: op(), date: D('2026-10-02T15:00:00Z'), amount: 9_000, category: 'Transporte', treatment: 'capitalized', productId: p.id });
    expect((await listLots(db, p.id)).map((l) => l.value)).toEqual([155_000, 92_000]);
    const e2 = await createExpense(db, { opId: op(), date: D('2026-10-02T15:00:00Z'), amount: 4_000, category: 'Transporte', treatment: 'capitalized', productId: p.id, lotId: lots[1].id });
    expect((await listLots(db, p.id)).map((l) => l.unitCost)).toEqual([31_000, 24_000]);
    await expectIntegrity(db);
    await voidExpense(db, e2!.id);
    await voidExpense(db, e1!.id);
    expect((await listLots(db, p.id)).map((l) => l.value)).toEqual([150_000, 88_000]);
    expect((await db.products.get(p.id))!.stockValue).toBe(238_000);
    await expectIntegrity(db);
  });

  it('anular una compra: se puede si su lote sigue intacto, aunque se haya vendido de otro lote', async () => {
    const { db, inv, p, p1, p2, lots } = await twoPrices();
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 40_000, lotId: lots[0].id }] });
    await expectAppError(voidPurchase(db, p1.id, 'Error'), 'later_outflows');
    await voidPurchase(db, p2.id, 'Error');
    expect((await listLots(db, p.id)).map((l) => [l.qty, l.value])).toEqual([[4, 120_000]]);
    await expectIntegrity(db);
  });

  it('apagar y volver a prender los lotes conserva el valor exacto y respeta el historial', async () => {
    const { db, inv, p } = await twoPrices();
    await setProductCosting(db, p.id, 'average');
    expect(await db.lots.where('productId').equals(p.id).count()).toBe(0);
    await expectIntegrity(db);
    // Con costo promedio: 2 × 238 000/9 = 52 889
    const s = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 2, unitPrice: 40_000 }] });
    expect((await db.saleLines.where('saleId').equals(s!.id).toArray())[0].cogs).toBe(52_889);
    await setProductCosting(db, p.id, 'lots');
    const ls = await listLots(db, p.id);
    const prod = (await db.products.get(p.id))!;
    // Quedan 3 del lote viejo y 4 del nuevo; el valor total no cambia
    expect(ls.map((l) => l.qty)).toEqual([3, 4]);
    expect(ls.reduce((a, l) => a + l.value, 0)).toBe(prod.stockValue);
    expect(prod.stockValue).toBe(238_000 - 52_889);
    // El reparto respeta el costo original de cada compra (30 000 vs 22 000 aprox.)
    expect(Math.abs(ls[0].unitCost! - 30_000)).toBeLessThan(1_500);
    expect(Math.abs(ls[1].unitCost! - 22_000)).toBeLessThan(1_500);
    await expectIntegrity(db);
    await expectAppError(setProductCosting(db, (await phoneProduct(db, inv.id)).id, 'lots'), 'invalid');
  });

  it('buildLotsFromHistory: si el historial no cuadra, crea un lote de apertura con todo', () => {
    const lots = buildLotsFromHistory({ id: 'p', inventoryId: 'i', qty: 7, stockValue: 70_000, unknownCostQty: 2 }, [], {
      voidedSales: new Set(),
      voidedPurchases: new Set(),
      supplierOf: () => null,
      now: D('2026-10-10T00:00:00Z'),
      newId: (() => {
        let i = 0;
        return () => `l${i++}`;
      })(),
    });
    expect(lots.map((l) => [l.source, l.qty, l.value, l.costKnown])).toEqual([
      ['opening', 2, 0, false],
      ['opening', 5, 70_000, true],
    ]);
  });

  it('informes: antigüedad por lote, días hasta vender por lote, precio mínimo por lote', async () => {
    const { db, inv, p, lots } = await twoPrices();
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 40_000, lotId: lots[1].id }] });
    const aging = (await getUnsoldAging(db, null, new Date('2026-10-10T15:00:00Z'))).filter((a) => a.productId === p.id);
    expect(aging.map((a) => [a.qty, a.days, a.cost, a.lotId])).toEqual([
      [5, 39, 150_000, lots[0].id],
      [3, 9, 66_000, lots[1].id],
    ]);
    const obs = await getSoldObservations(db, null, null);
    expect(obs.map((o) => [o.qty, o.days])).toEqual([[1, 4]]);
    const pr = await getProductPricing(db, p.id, new Date('2026-10-10T15:00:00Z'));
    expect(pr.cost).toBe(30_000); // sale primero el lote viejo
    expect(pr.lots!.map((l) => [l.unitCost, l.next])).toEqual([
      [30_000, true],
      [22_000, false],
    ]);
    expect(pr.avgCost).toBe(Math.round(216_000 / 8));
    const pr2 = await getProductPricing(db, p.id, new Date('2026-10-10T15:00:00Z'), lots[1].id);
    expect(pr2.cost).toBe(22_000);
    expect(pr2.minPrice).toBeLessThan(pr.minPrice!);
  });

  it('el capital no cambia por usar lotes: crecimiento = ganancia', async () => {
    const { db, inv, p } = await twoPrices();
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-05T15:00:00Z'), lines: [{ productId: p.id, quantity: 6, unitPrice: 45_000 }], initialPayment: 270_000 });
    const cap = await getCapitalSnapshot(db, null);
    expect(cap.inventory).toBe(66_000);
    const g = await explainGrowth(db, null);
    expect(g.difference).toBe(0);
    expect(g.netProfit).toBe(270_000 - 172_000);
  });
});

describe('v2.1 · migración a lotes', () => {
  /** Datos creados con costo promedio (como en la v2) y convertidos a la forma exacta de la v2. */
  async function v2Tables() {
    const db = await makeDB();
    await updateSettings(db, { lotsByDefault: false });
    const inv = await setupInventory(db);
    const sup = await createSupplier(db, { name: 'Mayorista' });
    const a = await accessoryProduct(db, inv.id, 'Audífonos');
    const c = await accessoryProduct(db, inv.id, 'Cargador');
    await registerInitialStock(db, { opId: op(), productId: a.id, quantity: 2, unitCost: null, date: null });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: sup.id, date: D('2026-08-01T15:00:00Z'), lines: [{ productId: a.id, quantity: 4, price: 120_000 }, { productId: c.id, quantity: 3, price: 45_000 }] });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: a.id, quantity: 5, price: 110_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-10T15:00:00Z'), lines: [{ productId: a.id, quantity: 5, unitPrice: 45_000 }, { productId: c.id, quantity: 3, unitPrice: 25_000 }] });
    const all = (await readAllTables(db)) as Record<string, Record<string, unknown>[]>;
    const v2: Record<string, Record<string, unknown>[]> = {};
    for (const t of TABLES_V2) v2[t] = all[t].map((r) => {
      const x = { ...r };
      delete x.costing;
      delete x.lotAllocations;
      return x;
    });
    db.close();
    return { v2, a, c };
  }

  it('Dexie convierte una base v2 real: separa en lotes, conserva el valor exacto y la integridad', async () => {
    const { v2, a, c } = await v2Tables();
    const name = 'v2-real-' + Math.random().toString(36).slice(2);
    class V2DB extends Dexie {
      constructor() {
        super(name);
        this.version(2).stores(SCHEMA_V2);
      }
    }
    const old = new V2DB();
    await old.open();
    for (const t of TABLES_V2) if (v2[t].length) await old.table(t).bulkAdd(v2[t]);
    old.close();
    const db = new AppDB(name);
    await db.open();
    expect(db.verno).toBe(DB_SCHEMA_VERSION);
    await initDatabase(db);
    const pa = (await db.products.get(a.id))!;
    expect(pa.costing).toBe('lots');
    expect((await db.products.get(c.id))!.costing).toBe('lots');
    const la = await listLots(db, a.id);
    // Salieron 5: primero las 2 sin costo, luego 3 de la compra de agosto. Quedan 1 de agosto y 5 de septiembre.
    expect(la.map((l) => [l.qty, l.costKnown, l.source])).toEqual([
      [1, true, 'purchase'],
      [5, true, 'purchase'],
    ]);
    expect(la.reduce((s, l) => s + l.value, 0)).toBe(pa.stockValue);
    expect(la[0].supplierName).toBe('Mayorista');
    expect(await listLots(db, c.id)).toEqual([]);
    await expectIntegrity(db);
  });

  it('un respaldo de la v2 se convierte igual que la base', async () => {
    const { v2, a } = await v2Tables();
    const migrated = migrateTables(v2, 2);
    const lots = migrated.lots as Lot[];
    expect(lots.filter((l) => l.productId === a.id).map((l) => l.qty)).toEqual([1, 5]);
    // Respaldo completo de la v2.1 → restaurar en otra base
    const db = await makeDB();
    const db2 = await makeDB();
    const { inv, p } = await (async () => {
      const inv = await setupInventory(db);
      const p = await accessoryProduct(db, inv.id);
      await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 3, price: 60_000 }] });
      return { inv, p };
    })();
    void inv;
    const exp = await createBackup(db);
    const parsed = await parseBackup(exp.text);
    await restoreBackup(db2, parsed, { safetyName: 'seg-' + op() });
    expect((await listLots(db2, p.id)).map((l) => [l.qty, l.value])).toEqual([[3, 60_000]]);
    await expectIntegrity(db2);
  });
});
