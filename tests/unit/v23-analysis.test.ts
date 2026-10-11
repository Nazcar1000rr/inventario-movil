import { describe, expect, it } from 'vitest';
import {
  addMarketPrice,
  analyzeBusiness,
  createBackup,
  createExpense,
  createPurchase,
  createSale,
  getBusinessAnalysis,
  getExpectationsOverview,
  getFinancialSummary,
  loadAnalysisData,
  loadFinancialData,
  migrateTables,
  parseBackup,
  periodName,
  periodStart,
  registerInitialStock,
  resetExpectation,
  restoreBackup,
  saveExpectation,
  summarizeFinancial,
  updateProduct,
  type AppDB,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

const NOW = new Date('2026-10-10T20:00:00Z'); // sábado 10 de octubre, 3:00 p. m. en Colombia

/** Un negocio con ventas en julio, agosto, septiembre y octubre. */
async function business() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const p = await accessoryProduct(db, inv.id, 'Cargador', { salePrice: 30_000 });
  await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-07-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 100, price: 1_000_000 }] });
  // Julio: 10 ventas, agosto: 20, septiembre: 30 (a 30 000; costo 10 000)
  const sell = (date: string, q: number) =>
    createSale(db, { opId: op(), inventoryId: inv.id, date: D(date), lines: [{ productId: p.id, quantity: q, unitPrice: 30_000 }], initialPayment: q * 30_000 });
  await sell('2026-07-15T15:00:00Z', 10);
  await sell('2026-08-14T15:00:00Z', 20); // viernes
  await sell('2026-09-12T15:00:00Z', 30); // sábado
  await sell('2026-10-03T15:00:00Z', 5); // sábado
  await createExpense(db, { opId: op(), date: D('2026-09-05T15:00:00Z'), amount: 100_000, category: 'Arriendo', inventoryId: inv.id });
  return { db, inv, p };
}

async function analysis(db: AppDB, ids: string[] | null = null) {
  return getBusinessAnalysis(db, ids, NOW);
}

describe('v2.3 · resumen financiero puro', () => {
  it('summarizeFinancial con todos los datos da lo mismo que getFinancialSummary', async () => {
    const { db } = await business();
    const data = await loadFinancialData(db);
    for (const period of [
      { from: D('2026-07-01T05:00:00Z'), to: D('2026-08-01T05:00:00Z') },
      { from: D('2026-09-01T05:00:00Z'), to: D('2026-10-01T05:00:00Z') },
      { from: '0000-01-01T00:00:00.000Z', to: '9999-12-31T00:00:00.000Z' },
    ])
      expect(summarizeFinancial(data, period, null)).toEqual(await getFinancialSummary(db, period, null));
  });
});

describe('v2.3 · expectativas', () => {
  it('propone el promedio de los meses anteriores con ventas; se puede editar y volver a la automática', async () => {
    const { db, inv } = await business();
    const ov = await getExpectationsOverview(db, null, NOW);
    // Ganancia neta: jul 200 000, ago 400 000, sep 600 000 − 100 000 = 500 000 → promedio 366 667 → 367 000
    expect(ov.month.target).toMatchObject({ source: 'auto', profit: 367_000, revenue: 600_000, units: 20 });
    expect(ov.month.target!.basis).toContain('3 meses');
    expect(ov.month.current).toBe(true);
    expect(ov.month.actual.profit).toBe(100_000);
    expect(ov.canEdit).toBe(true);
    // Historial: julio no tiene meses anteriores con ventas (sin meta); agosto esperaba 200 000 y logró 400 000
    const aug = ov.monthHistory.find((m) => m.label === 'agosto 2026')!;
    expect(aug.target!.profit).toBe(200_000);
    expect(aug.state).toBe('met');
    const sep = ov.monthHistory.find((m) => m.label === 'septiembre 2026')!;
    expect(sep.target!.profit).toBe(300_000);
    expect(sep.state).toBe('met');
    expect(ov.monthHistory.find((m) => m.label === 'julio 2026')!.state).toBe('no_target');

    // La editas: 500 000 de ganancia
    const e = await saveExpectation(db, { period: 'month', date: NOW.toISOString(), inventoryId: null, profit: 500_000, revenue: 1_500_000, units: 50 });
    let ov2 = await getExpectationsOverview(db, null, NOW);
    expect(ov2.month.target).toMatchObject({ source: 'manual', profit: 500_000 });
    expect(ov2.month.state).toBe('behind');
    // Guardar otra vez el mismo mes la reemplaza (no duplica)
    await saveExpectation(db, { period: 'month', date: D('2026-10-20T15:00:00Z'), inventoryId: null, profit: 50_000, revenue: 150_000, units: 5 });
    expect(await db.expectations.count()).toBe(1);
    ov2 = await getExpectationsOverview(db, null, NOW);
    expect(ov2.month.state).toBe('met');
    // Un inventario tiene su propia expectativa
    const ovInv = await getExpectationsOverview(db, [inv.id], NOW);
    expect(ovInv.month.target!.source).toBe('auto');
    await resetExpectation(db, e.id);
    expect((await getExpectationsOverview(db, null, NOW)).month.target!.source).toBe('auto');
    await expect(saveExpectation(db, { period: 'month', date: NOW.toISOString(), inventoryId: null, profit: 0, revenue: 0, units: 0 })).rejects.toMatchObject({ code: 'invalid' });
    await expectIntegrity(db);
  });

  it('semanas de lunes a domingo; sin ventas anteriores no hay propuesta', async () => {
    expect(periodStart('week', NOW).getDay()).toBe(1);
    expect(periodName('week', periodStart('week', NOW)).label).toBe('Semana del 5 al 11 oct');
    const db = await makeDB();
    await setupInventory(db);
    const ov = await getExpectationsOverview(db, null, NOW);
    expect(ov.month.target).toBeNull();
    expect(ov.month.state).toBe('no_target');
    expect(ov.monthHistory).toEqual([]);
  });

  it('las expectativas viajan en el respaldo; un respaldo de la v2.1/2.2 se convierte sin expectativas', async () => {
    const { db } = await business();
    await saveExpectation(db, { period: 'week', date: NOW.toISOString(), inventoryId: null, profit: 100_000, revenue: 300_000, units: 10 });
    const exp = await createBackup(db);
    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup(exp.text), { safetyName: 'seg-' + op() });
    expect(await db2.expectations.count()).toBe(1);
    await expectIntegrity(db2);
    const migrated = migrateTables({ inventories: [] } as Record<string, unknown[]>, 3);
    expect(migrated.expectations).toEqual([]);
  });
});

describe('v2.3 · lo que esperas ganar y análisis', () => {
  it('ganancia esperada con tus existencias: precio de venta, precio de mercado y costo desconocido', async () => {
    const { db, inv, p } = await business();
    const phone = await phoneProduct(db, inv.id, 'iPhone 13', '128 GB', { salePrice: 2_000_000 });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: phone.id, quantity: 2, price: 3_000_000 }] });
    const u = await db.units.where('productId').equals(phone.id).first();
    await db.units.update(u!.id, { condition: 'Usado' });
    await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Usado', price: 1_900_000, date: D('2026-10-05T15:00:00Z') });
    const sinPrecio = await accessoryProduct(db, inv.id, 'Funda');
    await registerInitialStock(db, { opId: op(), productId: sinPrecio.id, quantity: 4, unitCost: 5_000, date: null });
    const a = await analysis(db);
    const charger = a.outlook.rows.find((r) => r.productId === p.id)!;
    expect(charger).toMatchObject({ qty: 35, cost: 350_000, price: 30_000, priceSource: 'list', revenue: 1_050_000, profit: 700_000 });
    const ph = a.outlook.rows.find((r) => r.productId === phone.id)!;
    expect(ph).toMatchObject({ qty: 2, cost: 3_000_000, revenue: 3_900_000, profit: 900_000, priceSource: 'mixed' });
    expect(a.outlook.unpricedQty).toBe(4);
    expect(a.outlook.unpricedCost).toBe(20_000);
    expect(a.outlook.profit).toBe(1_600_000);
    expect(a.value.ifAllSold).toBe(a.value.now + 1_600_000);
    // Cambiar el precio cambia lo esperado
    await updateProduct(db, sinPrecio.id, { salePrice: 15_000 });
    expect((await analysis(db)).outlook.profit).toBe(1_640_000);
  });

  it('ritmo, punto de equilibrio, cascadas que cuadran, días de venta, 80/20, salud y comparación', async () => {
    const { db, inv } = await business();
    const otro = await accessoryProduct(db, inv.id, 'Cable', { salePrice: 20_000 });
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: otro.id, quantity: 10, price: 50_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-08T15:00:00Z'), lines: [{ productId: otro.id, quantity: 1, unitPrice: 20_000 }], initialPayment: 20_000 });
    const a = await analysis(db);
    expect(a.hasSales).toBe(true);
    // Ritmo de los últimos 30 días (desde el 10 de septiembre): 35 cargadores + 1 cable
    expect(a.pace.days).toBe(30);
    expect(Math.round(a.pace.revenuePerDay * 30)).toBe(1_070_000);
    expect(a.pace.monthEnd.actualRevenue).toBe(170_000);
    expect(a.pace.monthEnd.revenue).toBeGreaterThan(170_000);
    expect(a.pace.daysOfStock).not.toBeNull();

    // Punto de equilibrio: gastos promedio de los últimos 3 meses (100 000 ÷ 3) ÷ margen bruto
    const be = a.breakEven;
    expect(be.monthlyExpenses).toBe(33_333);
    expect(be.state).toBe('reached');
    expect(be.revenueNeeded).toBe(Math.round(33_333 / be.grossMargin!));

    // Cascadas: suman exacto
    const sumDeltas = (steps: typeof a.profitFlow) => steps.filter((s) => s.kind !== 'total').reduce((x, s) => x + s.value, 0);
    expect(sumDeltas(a.profitFlow)).toBe(a.profitFlow.at(-1)!.value);
    expect(a.profitFlow.at(-1)!.value).toBe(115_000);
    expect(sumDeltas(a.cashFlow)).toBe(a.cashFlow.at(-1)!.value);

    // 80/20: los cargadores dejan la mayor parte de la ganancia
    expect(a.abc.rows[0]).toMatchObject({ name: 'Cargador', cls: 'A' });
    expect(a.abc.rows.reduce((x, r) => x + r.share, 0)).toBeCloseTo(1, 6);

    // Días de venta: los sábados venden más
    expect(a.time.best?.label).toBe('Sábado');
    expect(a.time.weekdays.reduce((x, w) => x + w.share, 0)).toBeCloseTo(1, 6);

    // Salud entre 0 y 100, con 5 partes de 20
    expect(a.health.score).toBeGreaterThanOrEqual(0);
    expect(a.health.score).toBeLessThanOrEqual(100);
    expect(a.health.parts).toHaveLength(5);

    // Tendencia de 12 meses; el último es el actual
    expect(a.months).toHaveLength(12);
    expect(a.months.at(-1)!.partial).toBe(true);
    expect(a.months.find((m) => m.label === 'septiembre 2026')!.netProfit).toBe(500_000);
    expect(a.weeks).toHaveLength(12);

    // Comparación: este mes vs. el pasado
    const rev = a.compare.rows.find((r) => r.key === 'revenue')!;
    expect(rev.cur).toBe(170_000);
    expect(rev.prevFull).toBe(900_000);
    // Al mismo día del mes pasado (1 al 10 de septiembre) todavía no había ventas
    expect(rev.prev).toBe(0);
  });

  it('analyzeBusiness funciona con un negocio vacío', async () => {
    const db = await makeDB();
    await setupInventory(db);
    const a = analyzeBusiness(await loadAnalysisData(db), null, NOW);
    expect(a.hasSales).toBe(false);
    expect(a.health.score).toBeNull();
    expect(a.breakEven.state).toBe('no_data');
    expect(a.outlook.rows).toEqual([]);
    expect(a.abc.rows).toEqual([]);
  });
});
