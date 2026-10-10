import { describe, expect, it } from 'vitest';
import {
  AppError,
  createPurchase,
  createSale,
  getProductStock,
  getSaleBalance,
  previewPurchase,
  registerInitialStock,
  registerReturn,
  voidPurchase,
  voidSale,
  addPayment,
  adjustQuantity,
  createSupplier,
  createCustomer,
  updateSettings,
} from '../../src/core';
import {
  createInventory,
  deleteInventoryPermanently,
  renameInventory,
  setInventoryArchived,
  setInventoryMode,
} from '../../src/core/services/inventories';
import { createProduct, writeOffUnit } from '../../src/core/services/products';
import { accessoryProduct, availableUnits, D, expectIntegrity, makeDB, op, phoneProduct, setupInventory, snapshot } from './helpers';

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('Etapa 1: inventarios y modos', () => {
  it('1. crea un inventario en modo sencillo', async () => {
    const db = await makeDB();
    const inv = await createInventory(db, { name: 'Tienda centro', mode: 'simple' });
    const saved = await db.inventories.get(inv.id);
    expect(saved?.mode).toBe('simple');
    expect(saved?.archived).toBe(false);
    expect(await db.history.where('entityId').equals(inv.id).count()).toBe(1);
  });

  it('2. crea un inventario en modo profesional', async () => {
    const db = await makeDB();
    const inv = await createInventory(db, { name: 'Bodega', mode: 'pro' });
    expect((await db.inventories.get(inv.id))?.mode).toBe('pro');
  });

  it('usa el modo por defecto configurado y rechaza nombres vacíos o duplicados', async () => {
    const db = await makeDB();
    await updateSettings(db, { defaultMode: 'pro' });
    const inv = await createInventory(db, { name: 'Sin modo explícito' });
    expect(inv.mode).toBe('pro');
    await expectAppError(createInventory(db, { name: '   ' }), 'required');
    await expectAppError(createInventory(db, { name: 'sin modo EXPLÍCITO' }), 'duplicate');
  });

  it('3. cambiar de modalidad no borra, duplica ni altera datos', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db, 'Pro', 'pro');
    const p = await phoneProduct(db, inv.id);
    const acc = await accessoryProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      extraCosts: 10_000,
      lines: [
        { productId: p.id, quantity: 2, price: 3_000_000, units: [{ imei: '351111111111111', color: 'Azul' }] },
        { productId: acc.id, quantity: 5, price: 100_000 },
      ],
    });
    await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-12T15:00:00Z'),
      lines: [{ productId: p.id, quantity: 1, unitPrice: 2_000_000 }],
      initialPayment: 2_000_000,
    });
    const before = await snapshot(db, ['inventories', 'history']);
    await setInventoryMode(db, inv.id, 'simple');
    await setInventoryMode(db, inv.id, 'pro');
    await setInventoryMode(db, inv.id, 'simple');
    const after = await snapshot(db, ['inventories', 'history']);
    expect(after).toEqual(before);
    expect((await db.inventories.get(inv.id))?.mode).toBe('simple');
    const modeChanges = await db.history.where('entityId').equals(inv.id).filter((h) => h.action === 'mode').count();
    expect(modeChanges).toBe(3);
    await expectIntegrity(db);
  });

  it('renombra, archiva sin borrar historia e impide operar en archivados', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: p.id, quantity: 3, price: 30_000 }] });
    await renameInventory(db, inv.id, 'Local norte');
    await setInventoryArchived(db, inv.id, true);
    expect((await db.inventories.get(inv.id))?.name).toBe('Local norte');
    expect(await db.purchases.where('inventoryId').equals(inv.id).count()).toBe(1);
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 20_000 }] }),
      'archived',
    );
    await setInventoryArchived(db, inv.id, false);
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: p.id, quantity: 1, unitPrice: 20_000 }] });
    await expectIntegrity(db);
  });

  it('eliminar permanentemente exige el nombre exacto y no reutiliza códigos', async () => {
    const db = await makeDB();
    const a = await setupInventory(db, 'A');
    const b = await setupInventory(db, 'B');
    const pa = await phoneProduct(db, a.id);
    const pb = await phoneProduct(db, b.id);
    await createPurchase(db, { opId: op(), inventoryId: a.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: pa.id, quantity: 2, price: 2_000_000 }] });
    await expectAppError(deleteInventoryPermanently(db, a.id, 'a'), 'confirm_mismatch');
    expect(await db.units.count()).toBe(2);
    await deleteInventoryPermanently(db, a.id, 'A');
    expect(await db.inventories.get(a.id)).toBeUndefined();
    expect(await db.units.count()).toBe(0);
    await createPurchase(db, { opId: op(), inventoryId: b.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: pb.id, quantity: 1, price: 1_000_000 }] });
    const u = (await db.units.toArray())[0];
    expect(u.code).toBe('IPH-0003'); // 0001 y 0002 no se reutilizan
    await expectIntegrity(db);
  });
});

describe('Etapa 2: compras, ventas, devoluciones', () => {
  it('4. registra una compra y actualiza el stock (unidades y cantidad) con reparto exacto de gastos', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const charger = await accessoryProduct(db, inv.id);
    const pv = previewPurchase(
      [
        { productId: phone.id, quantity: 2, price: 3_000_000 },
        { productId: charger.id, quantity: 10, price: 200_000 },
      ],
      64_000,
      'value',
    );
    expect(pv[0].allocatedExtra).toBe(60_000);
    expect(pv[1].allocatedExtra).toBe(4_000);
    expect(pv[0].unitCosts).toEqual([1_530_000, 1_530_000]);

    const purchase = await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      extraCosts: 64_000,
      lines: [
        { productId: phone.id, quantity: 2, price: 3_000_000 },
        { productId: charger.id, quantity: 10, price: 200_000 },
      ],
    });
    expect(purchase.total).toBe(3_264_000);
    const units = await availableUnits(db, phone.id);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.baseCost)).toEqual([1_530_000, 1_530_000]);
    expect(units.map((u) => u.code).sort()).toEqual(['IPH-0001', 'IPH-0002']);
    const ch = (await db.products.get(charger.id))!;
    expect(ch.qty).toBe(10);
    expect(ch.stockValue).toBe(204_000);
    expect(await db.movements.count()).toBe(3);
    await expectIntegrity(db);
  });

  it('reparto con decimales: la suma de costos unitarios es exactamente el total', async () => {
    const pv = previewPurchase([{ productId: 'x', quantity: 3, price: 1_000_000 }], 100, 'units');
    expect(pv[0].unitCosts.reduce((a, b) => a + b, 0)).toBe(1_000_100);
    expect(Math.max(...pv[0].unitCosts) - Math.min(...pv[0].unitCosts)).toBeLessThanOrEqual(1);
  });

  it('5. registra una venta y disminuye el stock', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const charger = await accessoryProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 2, price: 3_000_000 },
        { productId: charger.id, quantity: 10, price: 200_000 },
      ],
    });
    const sale = await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-20T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, unitPrice: 2_000_000 },
        { productId: charger.id, quantity: 3, unitPrice: 35_000 },
      ],
      initialPayment: 2_105_000,
    });
    expect(sale.total).toBe(2_105_000);
    expect(await availableUnits(db, phone.id)).toHaveLength(1);
    expect((await db.products.get(charger.id))!.qty).toBe(7);
    const sold = await db.units.where('status').equals('sold').toArray();
    expect(sold).toHaveLength(1);
    expect(sold[0].code).toBe('IPH-0001'); // FIFO
    expect(sold[0].saleId).toBe(sale.id);
    await expectIntegrity(db);
  });

  it('6. impide vender más que el stock (y no deja datos a medias)', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const charger = await accessoryProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, price: 1_500_000 },
        { productId: charger.id, quantity: 2, price: 40_000 },
      ],
    });
    const before = await snapshot(db);
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: charger.id, quantity: 3, unitPrice: 30_000 }] }),
      'insufficient_stock',
    );
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: phone.id, quantity: 2, unitPrice: 2_000_000 }] }),
      'insufficient_stock',
    );
    // Venta mixta: la primera línea es válida pero la segunda no → nada se registra
    await expectAppError(
      createSale(db, {
        opId: op(),
        inventoryId: inv.id,
        date: D('2026-01-11T15:00:00Z'),
        lines: [
          { productId: phone.id, quantity: 1, unitPrice: 2_000_000 },
          { productId: charger.id, quantity: 5, unitPrice: 30_000 },
        ],
      }),
      'insufficient_stock',
    );
    // La misma línea repetida no puede superar el stock combinado
    await expectAppError(
      createSale(db, {
        opId: op(),
        inventoryId: inv.id,
        date: D('2026-01-11T15:00:00Z'),
        lines: [
          { productId: charger.id, quantity: 2, unitPrice: 30_000 },
          { productId: charger.id, quantity: 1, unitPrice: 30_000 },
        ],
      }),
      'insufficient_stock',
    );
    expect(await snapshot(db)).toEqual(before);
    await expectIntegrity(db);
  });

  it('7. no duplica una venta por doble pulsación/reintento ni vende dos veces la misma unidad', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 2, price: 3_000_000 }] });
    const [u1] = await availableUnits(db, phone.id);
    const input = {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-11T15:00:00Z'),
      lines: [{ productId: phone.id, unitIds: [u1.id], unitPrice: 2_000_000 }],
      initialPayment: 2_000_000,
    };
    // Doble pulsación simultánea y reintento posterior con la misma opId
    const [a, b] = await Promise.all([createSale(db, input), createSale(db, input)]);
    const c = await createSale(db, input);
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    // Dos ventas DISTINTAS de la misma unidad, en paralelo: solo una puede completarse
    const [u2] = await availableUnits(db, phone.id);
    const results = await Promise.allSettled([
      createSale(db, { ...input, opId: op(), lines: [{ productId: phone.id, unitIds: [u2.id], unitPrice: 2_000_000 }] }),
      createSale(db, { ...input, opId: op(), lines: [{ productId: phone.id, unitIds: [u2.id], unitPrice: 2_100_000 }] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'unit_not_available' });
    expect(await db.sales.count()).toBe(2);
    await expectIntegrity(db);
  });

  it('valida fechas incoherentes, descuentos y sobrepagos', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, price: 1_000_000 }] });
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-05T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, unitPrice: 1 }] }),
      'incoherent_date',
    );
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), discount: 2, lines: [{ productId: phone.id, quantity: 1, unitPrice: 1 }] }),
      'discount_too_high',
    );
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), initialPayment: 10, lines: [{ productId: phone.id, quantity: 1, unitPrice: 5 }] }),
      'overpayment',
    );
    const future = new Date(Date.now() + 86_400_000 * 3).toISOString();
    await expectAppError(
      createSale(db, { opId: op(), inventoryId: inv.id, date: future, lines: [{ productId: phone.id, quantity: 1, unitPrice: 5 }] }),
      'future_date',
    );
    await expectAppError(
      createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 0, price: 5 }] }),
      'invalid_qty',
    );
    await expectAppError(
      createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, price: -5 }] }),
      'negative_amount',
    );
  });

  it('9. distingue venta registrada de dinero cobrado (pago parcial y pendiente)', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const charger = await accessoryProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: charger.id, quantity: 10, price: 100_000 }] });
    const pending = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 50_000 }], initialPayment: 0 });
    let bal = await getSaleBalance(db, pending.id);
    expect(bal).toMatchObject({ effective: 100_000, collected: 0, pending: 100_000, status: 'pendiente' });
    await addPayment(db, { opId: op(), saleId: pending.id, amount: 30_000, date: D('2026-01-12T15:00:00Z') });
    bal = await getSaleBalance(db, pending.id);
    expect(bal).toMatchObject({ collected: 30_000, pending: 70_000, status: 'parcial' });
    await expectAppError(addPayment(db, { saleId: pending.id, amount: 70_001, date: D('2026-01-12T15:00:00Z') }), 'overpayment');
    const payOp = op();
    await addPayment(db, { opId: payOp, saleId: pending.id, amount: 70_000, date: D('2026-01-13T15:00:00Z') });
    await addPayment(db, { opId: payOp, saleId: pending.id, amount: 70_000, date: D('2026-01-13T15:00:00Z') }); // reintento: no duplica
    bal = await getSaleBalance(db, pending.id);
    expect(bal).toMatchObject({ collected: 100_000, pending: 0, status: 'pagada' });
    expect(await db.payments.count()).toBe(2);
  });

  it('11. devolución: conserva la venta original e inicia un ciclo nuevo de disponibilidad', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db, 'Pro', 'pro');
    const phone = await phoneProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, price: 1_500_000 }] });
    const sale = await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-20T15:00:00Z'),
      lines: [{ productId: phone.id, quantity: 1, unitPrice: 2_000_000 }],
      initialPayment: 2_000_000,
      warranty: { durationValue: 3, durationUnit: 'months' },
    });
    const line = (await db.saleLines.where('saleId').equals(sale.id).toArray())[0];
    const retOp = op();
    const ret = await registerReturn(db, {
      opId: retOp,
      saleId: sale.id,
      date: D('2026-01-25T15:00:00Z'),
      reason: 'Falla en cámara',
      refundAmount: 2_000_000,
      lines: [{ saleLineId: line.id, quantity: 1, destination: 'in_review' }],
    });
    // Reintento con la misma opId no duplica
    const again = await registerReturn(db, { opId: retOp, saleId: sale.id, date: D('2026-01-25T15:00:00Z'), reason: 'x', refundAmount: 2_000_000, lines: [{ saleLineId: line.id, quantity: 1, destination: 'in_review' }] });
    expect(again.id).toBe(ret.id);
    expect(await db.returns.count()).toBe(1);

    const s = await db.sales.get(sale.id);
    expect(s?.status).toBe('active'); // la venta original sigue existiendo
    expect(s?.total).toBe(2_000_000);
    const l2 = (await db.saleLines.get(line.id))!;
    expect(l2.returnedQty).toBe(1);
    expect(l2.returnedCogs).toBe(1_500_000);
    const u = (await db.units.get(line.unitId!))!;
    expect(u.status).toBe('in_review');
    expect(u.cycle).toBe(2);
    expect(u.availableSince).toBe(D('2026-01-25T15:00:00Z'));
    expect(u.acquiredAt).toBe(D('2026-01-10T15:00:00Z')); // el ciclo original se conserva
    const bal = await getSaleBalance(db, sale.id);
    expect(bal).toMatchObject({ effective: 0, collected: 0, pending: 0, status: 'devuelta' });
    const w = await db.warranties.where('saleId').equals(sale.id).first();
    expect(w?.status).toBe('cancelled');
    const unitHistory = await db.history.where('entityId').equals(u.id).toArray();
    expect(unitHistory.map((h) => h.action)).toEqual(expect.arrayContaining(['sale', 'return']));
    // No se puede devolver más de lo vendido
    await expectAppError(
      registerReturn(db, { opId: op(), saleId: sale.id, date: D('2026-01-26T15:00:00Z'), reason: 'x', refundAmount: 0, lines: [{ saleLineId: line.id, quantity: 1, destination: 'available' }] }),
      'too_many',
    );
    // Revendida: se conserva el ciclo anterior
    const { setUnitStatus } = await import('../../src/core/services/products');
    await setUnitStatus(db, u.id, 'available');
    const sale2 = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-02-05T15:00:00Z'), lines: [{ productId: phone.id, unitIds: [u.id], unitPrice: 1_900_000 }], initialPayment: 1_900_000 });
    const l3 = (await db.saleLines.where('saleId').equals(sale2.id).toArray())[0];
    expect(l3.cycleStart).toBe(D('2026-01-25T15:00:00Z'));
    expect(await db.saleLines.where('unitId').equals(u.id).count()).toBe(2);
    await expectIntegrity(db);
  });

  it('devolución de producto por cantidad dañado: se reconoce como baja', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const charger = await accessoryProduct(db, inv.id);
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: charger.id, quantity: 4, price: 80_000 }] });
    const sale = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 40_000 }], initialPayment: 80_000 });
    const line = (await db.saleLines.where('saleId').equals(sale.id).toArray())[0];
    await registerReturn(db, { opId: op(), saleId: sale.id, date: D('2026-01-12T15:00:00Z'), reason: 'No carga', refundAmount: 40_000, lines: [{ saleLineId: line.id, quantity: 1, destination: 'damaged' }] });
    const p = (await db.products.get(charger.id))!;
    expect(p.qty).toBe(2); // no vuelve al stock disponible
    expect(p.stockValue).toBe(40_000);
    const wo = (await db.movements.toArray()).filter((m) => m.writeOff > 0);
    expect(wo).toHaveLength(1);
    expect(wo[0].writeOff).toBe(20_000);
    await expectIntegrity(db);
  });

  it('anular una venta: vuelve el stock con su ciclo original y no se puede anular con devoluciones', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const charger = await accessoryProduct(db, inv.id);
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, price: 1_000_000 },
        { productId: charger.id, quantity: 5, price: 50_000 },
      ],
    });
    const sale = await createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-15T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, unitPrice: 1_300_000 },
        { productId: charger.id, quantity: 2, unitPrice: 20_000 },
      ],
      initialPayment: 500_000,
      costs: [{ category: 'Comisión', amount: 30_000 }],
    });
    await expectAppError(voidSale(db, sale.id, ''), 'required');
    await voidSale(db, sale.id, 'Registrada por error');
    const u = (await db.units.where('productId').equals(phone.id).toArray())[0];
    expect(u.status).toBe('available');
    expect(u.availableSince).toBe(D('2026-01-10T15:00:00Z'));
    expect(u.cycle).toBe(1);
    const c = (await db.products.get(charger.id))!;
    expect(c.qty).toBe(5);
    expect(c.stockValue).toBe(50_000);
    expect((await db.sales.get(sale.id))?.status).toBe('voided');
    expect((await db.expenses.where('saleId').equals(sale.id).first())?.status).toBe('voided');
    expect(await getSaleBalance(db, sale.id)).toMatchObject({ status: 'anulada', pending: 0 });
    // Con devolución no se puede anular
    const s2 = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-16T15:00:00Z'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 20_000 }], initialPayment: 0 });
    const l = (await db.saleLines.where('saleId').equals(s2.id).toArray())[0];
    await registerReturn(db, { opId: op(), saleId: s2.id, date: D('2026-01-17T15:00:00Z'), reason: 'x', refundAmount: 0, lines: [{ saleLineId: l.id, quantity: 1, destination: 'available' }] });
    await expectAppError(voidSale(db, s2.id, 'error'), 'has_returns');
    await expectIntegrity(db);
  });

  it('anular una compra solo si todo sigue en existencia', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const charger = await accessoryProduct(db, inv.id);
    const p1 = await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 2, price: 2_000_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: phone.id, quantity: 1, unitPrice: 1_500_000 }] });
    await expectAppError(voidPurchase(db, p1.id, 'error'), 'not_in_stock');
    const p2 = await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: charger.id, quantity: 5, price: 50_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-11T15:00:00Z'), lines: [{ productId: charger.id, quantity: 1, unitPrice: 20_000 }] });
    await expectAppError(voidPurchase(db, p2.id, 'error'), 'later_outflows');
    const p3 = await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-01-12T15:00:00Z'), lines: [{ productId: charger.id, quantity: 3, price: 33_000 }] });
    await voidPurchase(db, p3.id, 'Duplicada');
    expect((await db.purchases.get(p3.id))?.status).toBe('voided');
    expect((await db.products.get(charger.id))!.qty).toBe(4);
    await expectIntegrity(db);
  });

  it('idempotencia de compras', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const input = { opId: op(), inventoryId: inv.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: phone.id, quantity: 2, price: 2_000_000 }] };
    const [a, b] = await Promise.all([createPurchase(db, input), createPurchase(db, input)]);
    expect(a.id).toBe(b.id);
    expect(await db.units.count()).toBe(2);
  });

  it('ajustes por cantidad y baja de unidades se registran como pérdidas', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    const case_ = await accessoryProduct(db, inv.id, 'Funda silicona');
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-01-10T15:00:00Z'),
      lines: [
        { productId: phone.id, quantity: 1, price: 900_000 },
        { productId: case_.id, quantity: 10, price: 100_000 },
      ],
    });
    await adjustQuantity(db, { opId: op(), productId: case_.id, direction: 'out', quantity: 2, date: D('2026-01-11T15:00:00Z'), reason: 'Rotas' });
    await expectAppError(adjustQuantity(db, { productId: case_.id, direction: 'out', quantity: 9, date: D('2026-01-11T15:00:00Z'), reason: 'x' }), 'insufficient_stock');
    const u = (await availableUnits(db, phone.id))[0];
    await writeOffUnit(db, u.id, 'Robo', D('2026-01-12T15:00:00Z'));
    expect((await db.units.get(u.id))?.status).toBe('archived');
    expect((await db.products.get(case_.id))!.qty).toBe(8);
    const losses = (await db.movements.toArray()).reduce((a, m) => a + m.writeOff, 0);
    expect(losses).toBe(20_000 + 900_000);
    await expectIntegrity(db);
  });

  it('proveedores y compradores: evita duplicados obvios', async () => {
    const db = await makeDB();
    await createSupplier(db, { name: 'Importadora Andina', phone: '300 123 4567' });
    await expectAppError(createSupplier(db, { name: 'importadora  ANDINA' }), 'duplicate_supplier');
    await expectAppError(createSupplier(db, { name: 'Otro nombre', phone: '3001234567' }), 'duplicate_supplier');
    await createSupplier(db, { name: 'Importadora Andina' }, { allowDuplicate: true });
    await createCustomer(db, { name: 'Juan Pérez' });
    await expectAppError(createCustomer(db, { name: 'juan perez' }), 'duplicate_customer');
    expect(await db.suppliers.count()).toBe(2);
  });

  it('productos: detecta duplicados en el mismo inventario y códigos por categoría', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    await phoneProduct(db, inv.id);
    await expectAppError(phoneProduct(db, inv.id), 'duplicate_product');
    const pods = await createProduct(db, { inventoryId: inv.id, kind: 'audio', tracking: 'unit', brand: 'Apple', model: 'AirPods Pro 3' });
    const samsung = await createProduct(db, { inventoryId: inv.id, kind: 'phone', brand: 'Samsung', model: 'Galaxy S24' });
    await registerInitialStock(db, { productId: pods.id, quantity: 1, unitCost: 600_000, date: D('2026-01-01T15:00:00Z') });
    await registerInitialStock(db, { productId: samsung.id, quantity: 1, unitCost: 1_600_000, date: D('2026-01-01T15:00:00Z') });
    const codes = (await db.units.toArray()).map((u) => u.code).sort();
    expect(codes).toEqual(['AUD-0001', 'TEL-0001']);
    await updateSettings(db, { prefixes: { iphone: 'IPH', phone: 'CEL', audio: 'AUD', accessory: 'ACC', other: 'OTR' } });
    await registerInitialStock(db, { productId: samsung.id, quantity: 1, unitCost: 1_600_000, date: D('2026-01-01T15:00:00Z') });
    expect((await db.units.toArray()).map((u) => u.code).sort()).toEqual(['AUD-0001', 'CEL-0001', 'TEL-0001']);
    const stock = await getProductStock(db, (await db.products.get(samsung.id))!);
    expect(stock.available).toBe(2);
    await expectIntegrity(db);
  });
});
