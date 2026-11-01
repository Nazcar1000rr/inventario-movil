import { describe, expect, it } from 'vitest';
import { checkProductDelete, createPurchase, createSale, deleteProduct, getFinancialSummary, registerInitialStock } from '../../src/core';
import { accessoryProduct, D, expectIntegrity, makeDB, op, phoneProduct, setupInventory, snapshot } from './helpers';

const PERIOD = { from: D('2026-01-01T05:00:00Z'), to: D('2026-12-31T05:00:00Z') };

describe('v2.4 · eliminar un producto de verdad', () => {
  it('un producto creado por error (sin nada registrado) se elimina y no deja rastro', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Producto de prueba');
    const before = await getFinancialSummary(db, PERIOD, null);
    expect(await checkProductDelete(db, p.id)).toMatchObject({ canDelete: true, units: 0, movements: 0 });
    await deleteProduct(db, p.id, { opId: op() });
    expect(await db.products.get(p.id)).toBeUndefined();
    expect(await getFinancialSummary(db, PERIOD, null)).toEqual(before);
    expect((await db.history.toArray()).some((h) => h.action === 'delete' && h.entityId === p.id)).toBe(true);
    await expectIntegrity(db);
  });

  it('con stock que ya tenías se borran sus unidades, lotes y movimientos, y lo demás no cambia', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const keep = await accessoryProduct(db, inv.id, 'Cargador');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-01T15:00:00Z'), lines: [{ productId: keep.id, quantity: 4, price: 20_000 }] });
    const test = await phoneProduct(db, inv.id, 'iPhone 11', '64 GB');
    await registerInitialStock(db, { opId: op(), productId: test.id, quantity: 2, unitCost: 900_000, date: D('2026-01-05T15:00:00Z') });
    const other = await accessoryProduct(db, inv.id, 'Estuche');
    await registerInitialStock(db, { opId: op(), productId: other.id, quantity: 3, unitCost: 5_000, date: null });
    await db.inquiries.put({ id: 'inq1', date: D('2026-02-02T15:00:00Z'), inventoryId: inv.id, productId: test.id, note: '', status: 'open', boughtAt: null, createdAt: D('2026-02-02T15:00:00Z') } as never);

    const check = await checkProductDelete(db, test.id);
    expect(check).toMatchObject({ canDelete: true, units: 2 });
    expect(check.movements).toBeGreaterThan(0);
    const otherMovs = (await db.movements.where('productId').equals(keep.id).count()) + (await db.movements.where('productId').equals(other.id).count());

    await deleteProduct(db, test.id, { opId: op() });
    expect(await db.units.where('productId').equals(test.id).count()).toBe(0);
    expect(await db.movements.where('productId').equals(test.id).count()).toBe(0);
    expect((await db.movements.where('productId').equals(keep.id).count()) + (await db.movements.where('productId').equals(other.id).count())).toBe(otherMovs);
    expect((await db.inquiries.get('inq1'))!.productId).toBeNull();
    await expectIntegrity(db);
  });

  it('no se puede si ya tiene ventas o compras: no cambia nada y dice por qué', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Cargador');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 4, price: 20_000 }] });
    const c1 = await checkProductDelete(db, p.id);
    expect(c1.canDelete).toBe(false);
    expect(c1.reason).toMatch(/compras/);
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-03T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 30_000 }], paid: 30_000 } as never);
    const c2 = await checkProductDelete(db, p.id);
    expect(c2.canDelete).toBe(false);
    expect(c2.reason).toMatch(/ventas/);
    const snap = await snapshot(db, ['history']);
    await expect(deleteProduct(db, p.id)).rejects.toThrow();
    expect(await snapshot(db, ['history'])).toEqual(snap);
    await expectIntegrity(db);
  });

  it('una doble pulsación (misma operación) no falla ni borra dos veces', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Prueba');
    const id = op();
    await deleteProduct(db, p.id, { opId: id });
    await expect(deleteProduct(db, p.id, { opId: id })).resolves.toBeUndefined();
  });
});
