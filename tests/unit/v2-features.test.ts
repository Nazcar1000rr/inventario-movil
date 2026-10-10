import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  AppDB,
  AppError,
  DATA_TABLES,
  SCHEMA_V1,
  TABLES_V1,
  addMarketPrice,
  addRepair,
  checkPrice,
  createBackup,
  createPurchase,
  createSale,
  createSupplier,
  explainGrowth,
  getAlerts,
  getProfitPerDay,
  getSettings,
  getSupplierScores,
  getUnitPricing,
  getUnsoldAging,
  initDatabase,
  listMarketPrices,
  maxBuyPrice,
  mergeSettings,
  minPriceFor,
  parseBackup,
  partsSummary,
  readAllTables,
  registerInitialStock,
  registerReturn,
  removePartChange,
  restoreBackup,
  savePartChange,
  setUnitBaseCost,
  staleThreshold,
  updateSettings,
  verifyIntegrity,
  writeOffUnit,
  addCapitalMovement,
  createDebt,
  saveGoal,
  type PricingSettings,
} from '../../src/core';
import { D, expectIntegrity, makeDB, op, phoneProduct, setupInventory, snapshot } from './helpers';

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Migración v1 → v2 con datos reales de la versión 1                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/**
 * Crea datos con la app y los convierte EXACTAMENTE a como los guardaba la v1:
 * sin campos nuevos, estado "Reacondicionado", y los movimientos que la v1 dejaba sin ajustar
 * (costo completado después de vender, baja de una unidad con reparación y costo desconocido).
 */
async function v1Tables() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const phone = await phoneProduct(db, inv.id);
  // A: stock inicial sin costo, vendido, y luego se completa el costo (1.000.000)
  const a = await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: null, date: D('2026-01-05T15:00:00Z'), units: [{ condition: 'Reacondicionado' }] });
  await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-20T15:00:00Z'), lines: [{ productId: phone.id, unitIds: a.unitIds, unitPrice: 1_500_000 }], initialPayment: 1_500_000 });
  await setUnitBaseCost(db, a.unitIds[0], 1_000_000);
  // B: stock inicial sin costo, reparación pagada (capitalizada) y baja
  const b = await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: null, date: D('2026-01-05T15:00:00Z'), units: [{ condition: 'reacondicionado' }] });
  await addRepair(db, { opId: op(), unitId: b.unitIds[0], date: D('2026-01-08T15:00:00Z'), description: 'Pantalla', cost: 50_000 });
  await writeOffUnit(db, b.unitIds[0], 'Se dañó', D('2026-01-25T15:00:00Z'));
  // C: compra normal
  await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, price: 2_000_000, units: [{ condition: 'Usado' }] }] });

  const v2 = (await readAllTables(db)) as Record<string, Row[]>;
  const expectedMovements = structuredClone(v2.movements);
  const v1: Record<string, Row[]> = {};
  for (const t of TABLES_V1) v1[t] = structuredClone(v2[t]);
  v1.units = v1.units.map((u) => {
    const { partsHistory: _p, ...rest } = u;
    void _p;
    return { ...rest, condition: u.condition === 'Restaurado' ? 'Reacondicionado' : u.condition };
  });
  v1.purchases = v1.purchases.map((p) => {
    const { paymentSource: _s, debtId: _d, ...rest } = p;
    void _s;
    void _d;
    return rest;
  });
  v1.settings = [
    { key: 'app', businessName: 'Mi negocio', defaultMode: 'simple', prefixes: { iphone: 'IPH', phone: 'TEL', audio: 'AUD', accessory: 'ACC', other: 'OTR' }, staleDays: 45, warrantyAlertDays: 15, backupReminderDays: 7, conditions: ['Nuevo', 'Usado', 'Reacondicionado'] },
  ];
  // Movimientos como los dejaba la v1
  v1.movements = v1.movements.map((m) => {
    if (m.unitId === a.unitIds[0] && m.type === 'initial') return { ...m, costDelta: 0, unknownDelta: 1 };
    if (m.unitId === a.unitIds[0] && m.type === 'sale') return { ...m, costDelta: 0, unknownDelta: -1 };
    if (m.unitId === b.unitIds[0] && m.type === 'adjust_out') return { ...m, costDelta: 0, writeOff: 0 };
    return m;
  });
  db.close();
  return { v1, expectedMovements, aId: a.unitIds[0], bId: b.unitIds[0] };
}

class V1DB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
  }
}

describe('v2 · migración de datos de la v1', () => {
  it('Dexie actualiza una base v1 real a v2 sin perder nada y corrige los movimientos', async () => {
    const { v1, expectedMovements, aId, bId } = await v1Tables();
    const name = 'v1-real-' + Math.random().toString(36).slice(2);
    const old = new V1DB(name);
    await old.open();
    for (const t of TABLES_V1) if (v1[t].length) await old.table(t).bulkAdd(v1[t]);
    expect(old.verno).toBe(1);
    old.close();

    const db = new AppDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    await initDatabase(db);
    // Nada se perdió
    for (const t of TABLES_V1) if (t !== 'meta' && t !== 'catalogModels') expect(await db.table(t).count(), t).toBe(v1[t].length);
    // Campos nuevos con valores por defecto
    const units = await db.units.toArray();
    expect(units.every((u) => Array.isArray(u.partsHistory) && u.partsHistory.length === 0)).toBe(true);
    expect((await db.units.get(aId))!.condition).toBe('Restaurado');
    expect((await db.units.get(bId))!.condition).toBe('Restaurado');
    expect((await db.purchases.toArray()).every((p) => p.paymentSource === 'cash' && p.debtId === null)).toBe(true);
    const st = await getSettings(db);
    expect(st.conditions).toEqual(['Nuevo', 'Usado', 'Restaurado']);
    expect(st.staleDays).toBe(45);
    expect(st.businessName).toBe('Mi negocio');
    expect(st).toMatchObject({ staleEnabled: true, staleDaysNew: null, staleDaysUsed: null, showGettingStarted: true });
    expect(st.pricing.marketStaleDays).toBe(30);
    // Movimientos corregidos = los que produce la v2
    const mv = await db.movements.toArray();
    const byId = new Map(mv.map((m) => [m.id, m]));
    for (const e of expectedMovements) expect(byId.get(e.id as string)).toEqual(e);
    // Integridad completa y crecimiento explicado
    const rep = await verifyIntegrity(db);
    expect(rep.issues).toEqual([]);
    expect(rep.warnings).toEqual([]);
    expect((await explainGrowth(db, null)).difference).toBe(0);
    // Tablas nuevas vacías y utilizables
    for (const t of ['capital', 'debts', 'debtPayments', 'marketPrices', 'goals']) expect(await db.table(t).count()).toBe(0);
    await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-02-01T15:00:00Z'), amount: 1_000 });
    expect(await db.capital.count()).toBe(1);
    db.close();
    await Dexie.delete(name);
  });

  it('un respaldo de la v1 se convierte e importa igual que la base actualizada', async () => {
    const { v1, expectedMovements } = await v1Tables();
    const counts: Record<string, number> = {};
    for (const t of TABLES_V1) counts[t] = v1[t].length;
    const payload = { counts, tables: v1 };
    const env = {
      format: 'inventario-movil-backup',
      formatVersion: 1,
      schemaVersion: 1,
      appVersion: '1.0.0',
      createdAt: D('2026-02-01T15:00:00Z'),
      installationId: 'otra-instalacion',
      businessName: 'Mi negocio',
      encrypted: false,
      checksum: await sha256Hex(JSON.stringify(payload)),
      payload,
    };
    const parsed = await parseBackup(JSON.stringify(env));
    expect(parsed.migratedFrom).toBe(1);
    for (const t of DATA_TABLES) expect(Array.isArray(parsed.tables[t])).toBe(true);
    expect(parsed.counts.capital).toBe(0);

    const db = await makeDB();
    const res = await restoreBackup(db, parsed, { safetyName: 'seg-' + op() });
    expect(res.integrity.issues).toEqual([]);
    await expectIntegrity(db);
    const mv = await db.movements.toArray();
    const byId = new Map(mv.map((m) => [m.id, m]));
    for (const e of expectedMovements) expect(byId.get(e.id as string)).toEqual(e);
    expect((await db.units.toArray()).every((u) => Array.isArray(u.partsHistory))).toBe(true);
    // Un respaldo v1 al que le falta una sección se rechaza
    const broken = structuredClone(payload);
    delete (broken.tables as Record<string, unknown>).returns;
    const env2 = { ...env, payload: broken, checksum: await sha256Hex(JSON.stringify(broken)) };
    await expect(parseBackup(JSON.stringify(env2))).rejects.toMatchObject({ code: 'missing_table' });
  });

  it('un respaldo v2 incluye capital, deudas, precios y metas y se restaura idéntico', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-02-01T15:00:00Z'), amount: 5_000_000, inventoryId: inv.id });
    await createDebt(db, { opId: op(), kind: 'loan', creditor: 'Tío', date: D('2026-02-02T15:00:00Z'), principal: 1_000_000 });
    await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Usado', price: 1_900_000, date: D('2026-02-03T15:00:00Z') });
    await saveGoal(db, { name: 'Meta', metric: 'business_value', target: 10_000_000 });
    const phone = await phoneProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-02-04T15:00:00Z'),
      lines: [{ productId: phone.id, quantity: 1, price: 1_000_000, units: [{ condition: 'Usado', parts: [{ part: 'screen', quality: 'generic', by: 'previous_owner', unknownPartWarning: true }] }] }],
      funding: { kind: 'credit_card', creditor: 'Visa' },
    });
    const backup = await createBackup(db, { password: 'secreta123' });
    const parsed = await parseBackup(backup.text, 'secreta123');
    expect(parsed.counts).toMatchObject({ capital: 1, debts: 2, marketPrices: 1, goals: 1 });
    const db2 = await makeDB();
    await restoreBackup(db2, parsed, { safetyName: 'seg-' + op() });
    expect(await snapshot(db2, ['meta', 'history'])).toEqual(await snapshot(db, ['meta', 'history']));
    await expectIntegrity(db2);
  });
});

/* ------------------------------------------------------------------ */

describe('v2 · historial de reparaciones y piezas', () => {
  it('registra piezas al ingresar, edita, quita y suma las de reparaciones pagadas', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const r = await registerInitialStock(db, {
      opId: op(),
      productId: phone.id,
      quantity: 1,
      unitCost: 1_000_000,
      date: D('2026-02-01T15:00:00Z'),
      units: [
        {
          condition: 'Restaurado',
          parts: [
            { part: 'battery', quality: 'generic', by: 'previous_owner', unknownPartWarning: true },
            { part: 'screen', quality: 'original', by: 'supplier', date: D('2026-01-10T15:00:00Z') },
          ],
        },
      ],
    });
    const uid = r.unitIds[0];
    let u = (await db.units.get(uid))!;
    expect(u.partsHistory).toHaveLength(2);
    expect(partsSummary(u.partsHistory)).toMatchObject({ count: 2, generic: 1, warnings: 1, labels: ['Batería', 'Pantalla'] });
    // Registrar piezas no cambia el costo
    expect(u.baseCost).toBe(1_000_000);
    expect(u.extraCost).toBe(0);
    await expect(savePartChange(db, uid, { part: 'other' })).rejects.toThrow(AppError);
    const other = await savePartChange(db, uid, { part: 'other', label: 'Flex de encendido', quality: 'unknown' });
    await savePartChange(db, uid, { ...other, part: 'other', label: 'Flex de volumen', quality: 'generic' });
    u = (await db.units.get(uid))!;
    expect(u.partsHistory.find((p) => p.id === other.id)).toMatchObject({ label: 'Flex de volumen', quality: 'generic' });
    await removePartChange(db, uid, u.partsHistory[0].id);
    u = (await db.units.get(uid))!;
    expect(u.partsHistory.map((p) => p.part)).toEqual(['screen', 'other']);
    // Reparación pagada con pieza → entrada "hecha por mí" vinculada y costo capitalizado
    const rep = await addRepair(db, { opId: op(), unitId: uid, date: D('2026-02-10T15:00:00Z'), description: 'Cambio de puerto', cost: 80_000, part: { part: 'port', quality: 'original' } });
    u = (await db.units.get(uid))!;
    expect(u.partsHistory.at(-1)).toMatchObject({ part: 'port', by: 'me', repairId: rep.id, quality: 'original' });
    expect(u.extraCost).toBe(80_000);
    await expectIntegrity(db);
  });
});

/* ------------------------------------------------------------------ */

describe('v2 · estancado opcional y por estado', () => {
  it('usa umbrales distintos para nuevos y usados, y se puede desactivar', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: 1, date: ago(40), units: [{ condition: 'Nuevo' }] });
    await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: 1, date: ago(40), units: [{ condition: 'Usado' }] });
    await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: 1, date: ago(70), units: [{ condition: 'Restaurado' }] });
    await updateSettings(db, { staleDays: 60, staleDaysNew: 30, staleDaysUsed: null });
    const conds = async () => (await getAlerts(db, null)).stale.map((a) => a.condition).sort();
    expect(await conds()).toEqual(['Nuevo', 'Restaurado']);
    await updateSettings(db, { staleDaysUsed: 90 });
    expect(await conds()).toEqual(['Nuevo']);
    await updateSettings(db, { staleEnabled: false });
    expect(await conds()).toEqual([]);
    // El "dinero dormido" se sigue calculando aunque los avisos estén apagados
    const aging = await getUnsoldAging(db, null);
    expect(aging.filter((a) => a.dormant).map((a) => a.condition)).toEqual(['Nuevo']);
    expect(aging.every((a) => a.staleDays === null)).toBe(true);
    const st = await getSettings(db);
    expect(staleThreshold(st, 'Usado', false)).toBe(90);
    expect(staleThreshold(st, '', false)).toBe(60);
    await expect(updateSettings(db, { staleDaysNew: 0 })).rejects.toThrow(AppError);
  });
});

/* ------------------------------------------------------------------ */

describe('v2 · precios', () => {
  const pricing: PricingSettings = {
    minMarginType: 'percent',
    minMarginValue: 10,
    targetMarginType: 'amount',
    targetMarginValue: 300_000,
    expectedCosts: 50_000,
    batteryThreshold: 85,
    batteryDiscount: 100_000,
    genericPartDiscount: 80_000,
    marketStaleDays: 30,
    recentSalesDays: 90,
  };

  it('precio máximo de compra con margen en pesos o en % y descuentos opcionales', () => {
    const a = maxBuyPrice({ market: 2_000_000, batteryHealth: 80, genericParts: 1 }, pricing);
    expect(a).toMatchObject({ batteryDiscount: 100_000, partsDiscount: 80_000, adjustedMarket: 1_820_000, maxPrice: 1_470_000, expectedProfit: 300_000 });
    const b = maxBuyPrice({ market: 2_000_000, batteryHealth: 90 }, pricing);
    expect(b).toMatchObject({ batteryDiscount: 0, partsDiscount: 0, maxPrice: 1_650_000 });
    const c = maxBuyPrice({ market: 2_000_000, batteryHealth: 80, genericParts: 1, targetMarginType: 'percent', targetMarginValue: 20 }, pricing);
    expect(c.maxPrice).toBe(1_466_666);
    // Comprando a ese precio, el margen sobre el costo total es de al menos 20 %
    expect(c.expectedProfit / (c.maxPrice + c.expectedCosts)).toBeGreaterThanOrEqual(0.2);
    expect(maxBuyPrice({ market: 100_000 }, pricing).maxPrice).toBe(0);
    expect(maxBuyPrice({ market: 2_000_000, batteryHealth: 50 }, { ...pricing, batteryThreshold: null }).batteryDiscount).toBe(0);
    expect(minPriceFor(1_000_000, pricing)).toBe(1_100_000);
    expect(minPriceFor(1_000_000, { minMarginType: 'amount', minMarginValue: 150_000 })).toBe(1_150_000);
    expect(minPriceFor(null, pricing)).toBeNull();
  });

  it('precio de mercado con historial, aviso de desactualizado, tu precio real y sugerido', async () => {
    const db = await makeDB();
    await updateSettings(db, { pricing });
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id, 'iPhone 13', '128 GB');
    await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Usado', price: 1_900_000, date: ago(40) });
    await addMarketPrice(db, { model: 'iphone 13', capacity: '128GB', condition: 'usado', price: 1_950_000, date: ago(5) });
    await addMarketPrice(db, { model: 'iPhone 13', capacity: '256 GB', condition: 'Usado', price: 2_300_000, date: ago(45) });
    await expect(addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: '', price: 1 })).rejects.toThrow(AppError);
    const rows = await listMarketPrices(db);
    expect(rows).toHaveLength(2);
    const r128 = rows.find((r) => r.capacity === '128 GB' || r.capacity === '128GB')!;
    expect(r128).toMatchObject({ count: 2, change: 50_000, stale: false });
    expect(r128.latest.price).toBe(1_950_000);
    expect(rows.find((r) => r.capacity === '256 GB')!.stale).toBe(true);

    const p = await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: ago(30),
      lines: [{ productId: phone.id, quantity: 2, price: 3_000_000, units: [{ condition: 'Usado' }, { condition: 'Usado' }] }],
    });
    const [u1, u2] = (await db.purchaseLines.where('purchaseId').equals(p.id).first())!.unitIds;
    let info = await getUnitPricing(db, u1);
    expect(info).toMatchObject({ cost: 1_500_000, minPrice: 1_650_000, suggested: 1_950_000, suggestedSource: 'market', recent: null });
    expect(info.market).toMatchObject({ price: 1_950_000, stale: false });
    // Una venta propia reciente → "tu precio real"
    await createSale(db, { opId: op(), inventoryId: inv.id, date: ago(2), lines: [{ productId: phone.id, unitIds: [u2], unitPrice: 2_050_000 }], initialPayment: 2_050_000 });
    info = await getUnitPricing(db, u1);
    expect(info.recent).toMatchObject({ avg: 2_050_000, count: 1 });
    expect(checkPrice(1_400_000, info)).toMatchObject({ belowCost: true, belowMin: true, profit: -100_000, vsMarket: -550_000 });
    expect(checkPrice(1_600_000, info)).toMatchObject({ belowCost: false, belowMin: true });
    expect(checkPrice(2_000_000, info)).toMatchObject({ belowCost: false, belowMin: false, profit: 500_000 });
  });
});

/* ------------------------------------------------------------------ */

describe('v2 · ganancia por día y proveedores', () => {
  it('calcula ganancia por día por modelo y califica proveedores', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const ip13 = await phoneProduct(db, inv.id, 'iPhone 13', '128 GB');
    const ip14 = await phoneProduct(db, inv.id, 'iPhone 14', '128 GB');
    const s1 = await createSupplier(db, { name: 'Uno' });
    const s2 = await createSupplier(db, { name: 'Dos' });
    const buy = async (supplierId: string, productId: string, price: number, date: string, parts: Parameters<typeof savePartChange>[2][] = []) => {
      const p = await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId, date, lines: [{ productId, quantity: 1, price, units: [{ condition: 'Usado', parts }] }] });
      return (await db.purchaseLines.where('purchaseId').equals(p.id).first())!.unitIds[0];
    };
    const sell = (productId: string, unitId: string, price: number, date: string) =>
      createSale(db, { opId: op(), inventoryId: inv.id, date, lines: [{ productId, unitIds: [unitId], unitPrice: price }], initialPayment: price });
    const x = await buy(s1.id, ip13.id, 1_000_000, ago(40));
    const y = await buy(s1.id, ip13.id, 1_000_000, ago(40));
    const z = await buy(s2.id, ip14.id, 2_000_000, ago(20));
    const w = await buy(s2.id, ip14.id, 2_000_000, ago(20), [{ part: 'screen', quality: 'generic', by: 'supplier' }]);
    await sell(ip13.id, x, 1_200_000, ago(30)); // 10 días, +200.000
    await sell(ip13.id, y, 1_300_000, ago(10)); // 30 días, +300.000
    await sell(ip14.id, z, 2_100_000, ago(15)); // 5 días, +100.000
    const sw = await sell(ip14.id, w, 2_200_000, ago(12));
    const lw = (await db.saleLines.where('saleId').equals(sw.id).first())!;
    await registerReturn(db, { opId: op(), saleId: sw.id, date: ago(11), reason: 'Falla', refundAmount: 2_200_000, lines: [{ saleLineId: lw.id, quantity: 1, destination: 'available' }] });

    const ppd = await getProfitPerDay(db, null, null);
    expect(ppd.map((m) => m.label)).toEqual([ip14.name, ip13.name]);
    expect(ppd[0]).toMatchObject({ units: 1, profit: 100_000, avgDays: 5, profitPerDay: 20_000 });
    expect(ppd[1]).toMatchObject({ units: 2, profit: 500_000, avgProfit: 250_000, avgDays: 20, profitPerDay: 12_500 });
    expect(ppd[1].dailyReturn).toBeCloseTo(500_000 / (1_000_000 * 10 + 1_000_000 * 30), 10);

    const sc = await getSupplierScores(db, null);
    expect(sc.map((s) => s.name)).toEqual(['Uno', 'Dos']);
    expect(sc[0]).toMatchObject({ unitsBought: 2, sold: 2, avgProfit: 250_000, avgDays: 20, returns: 0, problemRate: 0, partIssues: 0 });
    expect(sc[0].avgMargin).toBeCloseTo(0.25, 10);
    expect(sc[0].scoreParts).toEqual({ margin: 40, speed: 23, quality: 30 });
    expect(sc[0].score).toBe(93);
    expect(sc[1]).toMatchObject({ unitsBought: 2, sold: 2, returns: 1, problemRate: 0.5, partIssues: 1, inStock: 1, avgDays: 5 });
    expect(sc[1].scoreParts).toEqual({ margin: 10, speed: 28, quality: 0 });
    expect(sc[1].score).toBe(38);
    expect(sc[1].enoughData).toBe(false);
    await expectIntegrity(db);
  });
});

/* ------------------------------------------------------------------ */

describe('v2 · configuración', () => {
  it('valida precios, comisiones y mezcla los valores por defecto', async () => {
    const db = await makeDB();
    await expect(updateSettings(db, { pricing: { minMarginValue: -1 } })).rejects.toThrow(AppError);
    await expect(updateSettings(db, { pricing: { minMarginType: 'percent', minMarginValue: 2000 } })).rejects.toThrow(AppError);
    await expect(updateSettings(db, { pricing: { batteryThreshold: 101 } })).rejects.toThrow(AppError);
    await expect(updateSettings(db, { paymentFees: { Tarjeta: 60 } })).rejects.toThrow(AppError);
    const s = await updateSettings(db, { pricing: { targetMarginType: 'percent', targetMarginValue: 15 }, paymentFees: { Tarjeta: 3.456, '  ': 2 } });
    expect(s.pricing).toMatchObject({ targetMarginType: 'percent', targetMarginValue: 15, minMarginType: 'amount', marketStaleDays: 30 });
    expect(s.paymentFees).toEqual({ Tarjeta: 3.46 });
    const merged = mergeSettings({ key: 'app', staleDays: 10 } as never);
    expect(merged).toMatchObject({ staleDays: 10, staleEnabled: true, conditions: ['Nuevo', 'Usado', 'Restaurado'] });
    expect(merged.pricing.recentSalesDays).toBe(90);
  });
});

describe('v2 · redondeos de precios', () => {
  it('no se desvía un peso por errores de coma flotante', () => {
    const base: PricingSettings = { minMarginType: 'percent', minMarginValue: 10, targetMarginType: 'percent', targetMarginValue: 20, expectedCosts: 0, batteryThreshold: null, batteryDiscount: 0, genericPartDiscount: 0, marketStaleDays: 30, recentSalesDays: 90 };
    expect(minPriceFor(1_500_000, base)).toBe(1_650_000);
    expect(minPriceFor(1_234_567, base)).toBe(1_358_024); // 1.234.567 × 1,1 = 1.358.023,7 → hacia arriba
    expect(maxBuyPrice({ market: 1_200_000 }, base).maxPrice).toBe(1_000_000);
    expect(maxBuyPrice({ market: 2_190_000 }, { ...base, targetMarginValue: 9.5 }).maxPrice).toBe(2_000_000);
  });
});
