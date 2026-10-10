import { describe, expect, it } from 'vitest';
import {
  addClaim,
  createPurchase,
  createSale,
  createView,
  deleteView,
  getFinancialSummary,
  getStockOverview,
  INSPECTION_ITEMS,
  searchAll,
  setUnitInspection,
  updateClaim,
  updateUnitDetails,
  createWarranty,
  warrantyDisplayStatus,
  findIdentifierMatches,
  builtinCatalog,
} from '../../src/core';
import { D, expectIntegrity, makeDB, op, phoneProduct, setupInventory, snapshot } from './helpers';

describe('Etapa 5: vistas consolidadas', () => {
  it('14-15. combina inventarios sin duplicar y se actualiza al vender en el origen', async () => {
    const db = await makeDB();
    const a = await setupInventory(db, 'A');
    const b = await setupInventory(db, 'B', 'pro');
    const pa = await phoneProduct(db, a.id);
    const pb = await phoneProduct(db, b.id);
    await createPurchase(db, { opId: op(), inventoryId: a.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: pa.id, quantity: 3, price: 6_000_000 }] });
    await createPurchase(db, { opId: op(), inventoryId: b.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: pb.id, quantity: 2, price: 4_200_000 }] });
    const view = await createView(db, { name: 'Todo', inventoryIds: [a.id, b.id] });
    const unitsBefore = await db.units.count();
    const salesBefore = await db.sales.count();

    let g = (await getStockOverview(db, view.inventoryIds))[0];
    expect(g.available).toBe(5);
    expect(g.value).toBe(6_000_000 + 4_200_000);
    expect(g.sources.map((s) => s.available).sort()).toEqual([2, 3]);
    // La vista no crea registros
    expect(await db.units.count()).toBe(unitsBefore);

    // Vender desde la vista exige el inventario de origen correcto
    await expect(
      createSale(db, { opId: op(), inventoryId: b.id, date: D('2026-01-12T15:00:00Z'), lines: [{ productId: pa.id, quantity: 1, unitPrice: 2_500_000 }] }),
    ).rejects.toMatchObject({ code: 'wrong_inventory' });
    await createSale(db, { opId: op(), inventoryId: a.id, date: D('2026-01-12T15:00:00Z'), lines: [{ productId: pa.id, quantity: 1, unitPrice: 2_500_000 }], initialPayment: 2_500_000 });

    g = (await getStockOverview(db, view.inventoryIds))[0];
    expect(g.available).toBe(4);
    expect((await getStockOverview(db, [a.id]))[0].available).toBe(2);
    expect((await getStockOverview(db, [b.id]))[0].available).toBe(2);
    expect(await db.sales.count()).toBe(salesBefore + 1);

    // Finanzas de la vista = A + B, sin doble conteo
    const P = { from: D('2026-01-01T05:00:00Z'), to: D('2026-02-01T05:00:00Z') };
    const sv = await getFinancialSummary(db, P, view.inventoryIds);
    const sa = await getFinancialSummary(db, P, [a.id]);
    const sb = await getFinancialSummary(db, P, [b.id]);
    expect(sv.sales.count).toBe(1);
    expect(sv.purchases.total).toBe(sa.purchases.total + sb.purchases.total);
    expect(sv.netRevenue).toBe(sa.netRevenue + sb.netRevenue);
    expect(sv.grossProfit).toBe(2_500_000 - 2_000_000);

    // Eliminar la vista no toca los inventarios de origen
    const before = await snapshot(db, ['consolidatedViews', 'history']);
    await deleteView(db, view.id);
    expect(await snapshot(db, ['consolidatedViews', 'history'])).toEqual(before);
    await expectIntegrity(db);
  });

  it('requiere al menos dos inventarios', async () => {
    const db = await makeDB();
    const a = await setupInventory(db, 'A');
    await expect(createView(db, { name: 'X', inventoryIds: [a.id, a.id] })).rejects.toMatchObject({ code: 'too_few' });
  });
});

describe('Etapa 4: funciones profesionales', () => {
  it('ficha de unidad: inspección con origen de la información, datos e historial', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db, 'Pro', 'pro');
    const p = await phoneProduct(db, inv.id, 'iPhone 14 Pro', '256 GB');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, price: 2_800_000, units: [{ imei: '35 123456 789012 3', serial: 'f2lx1234', batteryHealth: 87, condition: 'Usado' }] }] });
    const u = (await db.units.toArray())[0];
    expect(u.imei).toBe('351234567890123');
    expect(u.serial).toBe('F2LX1234');
    expect(u.batteryHealth).toBe(87);
    await setUnitInspection(db, u.id, {
      inspectedAt: D('2026-01-11T15:00:00Z'),
      notes: 'Revisión general',
      items: {
        screen: { status: 'replaced', source: 'technician', note: 'Pantalla genérica' },
        biometric: { status: 'ok', source: 'seller', note: 'Dicho por el vendedor' },
        battery: { status: 'pending', source: 'own', note: '' },
      },
    });
    const ins = (await db.units.get(u.id))!.inspection!;
    expect(ins.items.screen).toMatchObject({ status: 'replaced', source: 'technician' });
    expect(ins.items.biometric.source).toBe('seller');
    expect(INSPECTION_ITEMS.length).toBeGreaterThanOrEqual(12);
    await expect(updateUnitDetails(db, u.id, { batteryHealth: 120 })).rejects.toMatchObject({ code: 'invalid_battery' });
    await updateUnitDetails(db, u.id, { color: 'Morado oscuro', notes: 'Caja original' });
    const hist = await db.history.where('entityId').equals(u.id).toArray();
    expect(hist.map((h) => h.action)).toEqual(expect.arrayContaining(['inspection', 'update']));
    // búsqueda por código, IMEI parcial y serial
    expect((await searchAll(db, 'IPH-0001')).units[0].id).toBe(u.id);
    expect((await searchAll(db, '789012')).units[0].id).toBe(u.id);
    expect((await searchAll(db, 'f2lx')).units[0].id).toBe(u.id);
    expect((await searchAll(db, '14 pro')).products[0].id).toBe(p.id);
    expect(await findIdentifierMatches(db, { imei: '351234567890123' })).toHaveLength(1);
    await expectIntegrity(db);
  });

  it('garantías: vencimiento calculado, reclamos con costo registrado una sola vez', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db, 'Pro', 'pro');
    const p = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, price: 1_000_000 }] });
    const u = (await db.units.toArray())[0];
    const w = await createWarranty(db, { type: 'supplier', inventoryId: inv.id, unitId: u.id, startDate: D('2026-01-10T15:00:00Z'), durationValue: 30, durationUnit: 'days' });
    expect(w.endDate.slice(0, 10)).toBe('2026-02-09');
    expect(warrantyDisplayStatus(w, 15, new Date('2026-01-20T12:00:00Z'))).toBe('vigente');
    expect(warrantyDisplayStatus(w, 15, new Date('2026-02-01T12:00:00Z'))).toBe('por_vencer');
    expect(warrantyDisplayStatus(w, 15, new Date('2026-02-11T12:00:00Z'))).toBe('vencida');
    const c = await addClaim(db, { opId: op(), warrantyId: w.id, date: D('2026-01-20T15:00:00Z'), description: 'Altavoz falla', cost: 40_000 });
    let exps = await db.expenses.where('claimId').equals(c.id).toArray();
    expect(exps).toHaveLength(1);
    expect(exps[0].amount).toBe(40_000);
    await updateClaim(db, c.id, { status: 'resolved', resolution: 'Cambio de altavoz', cost: 55_000 });
    exps = await db.expenses.where('claimId').equals(c.id).toArray();
    expect(exps).toHaveLength(1);
    expect(exps[0].amount).toBe(55_000);
    const P = { from: D('2026-01-01T05:00:00Z'), to: D('2026-02-01T05:00:00Z') };
    expect((await getFinancialSummary(db, P, null)).operatingExpenses).toBe(55_000);
    expect((await db.warrantyClaims.get(c.id))?.resolvedAt).not.toBeNull();
  });

  it('catálogo base: iPhone X a la generación actual sin duplicados y con variantes reales', () => {
    const cat = builtinCatalog(new Date().toISOString());
    const phones = cat.filter((c) => c.category === 'phone').map((c) => c.model);
    expect(new Set(phones).size).toBe(phones.length);
    expect(phones[0]).toBe('iPhone X');
    for (const m of ['iPhone 12 mini', 'iPhone 14 Plus', 'iPhone 16e', 'iPhone Air', 'iPhone 17 Pro Max', 'iPhone 17e', 'iPhone 18 Pro Max']) expect(phones).toContain(m);
    // Variantes que nunca existieron
    for (const m of ['iPhone 14 mini', 'iPhone 13 Plus', 'iPhone X Pro', 'iPhone 18']) expect(phones).not.toContain(m);
    expect(cat.find((c) => c.model === 'iPhone 17 Pro Max')?.storageOptions).toContain('2 TB');
  });
});
