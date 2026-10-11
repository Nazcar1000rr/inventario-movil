import {
  addCapitalMovement,
  addMarketPrice,
  addPersonalSpending,
  addTripCost,
  createExpense,
  createInventory,
  createProduct,
  createPurchase,
  createSale,
  createSupplier,
  createCustomer,
  payDebt,
  registerInitialStock,
  saveGoal,
  updateSettings,
  type AppDB,
} from '../core';

const ago = (days: number, hour = 15) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const op = () => crypto.randomUUID();

/**
 * Crea el negocio de ejemplo del modo práctica (solo en la base de datos de práctica).
 * Fechas relativas a hoy para que siempre se vea "vivo".
 */
export async function seedPracticeData(db: AppDB): Promise<void> {
  if ((await db.meta.get('practiceSeeded')) || (await db.inventories.count()) > 0) return;
  await updateSettings(db, { businessName: 'Negocio de práctica', paymentFees: { Efectivo: 0, Transferencia: 0, Nequi: 0, Daviplata: 0, Tarjeta: 3, Otro: 0 } });
  const inv = await createInventory(db, { name: 'Práctica', mode: 'simple' });
  const ip11 = await createProduct(db, { inventoryId: inv.id, kind: 'phone', brand: 'Apple', model: 'iPhone 11', capacity: '64 GB' });
  const ip13 = await createProduct(db, { inventoryId: inv.id, kind: 'phone', brand: 'Apple', model: 'iPhone 13', capacity: '128 GB', salePrice: 1_950_000 });
  const ip14 = await createProduct(db, { inventoryId: inv.id, kind: 'phone', brand: 'Apple', model: 'iPhone 14 Pro', capacity: '256 GB' });
  const charger = await createProduct(db, { inventoryId: inv.id, kind: 'accessory', name: 'Cargador USB-C 20W', salePrice: 35_000, lowStockThreshold: 3 });
  const buds = await createProduct(db, { inventoryId: inv.id, kind: 'audio', name: 'Audífonos Bluetooth', salePrice: 45_000 });
  const prov = await createSupplier(db, { name: 'Proveedor Centro', city: 'Medellín' });
  const prov2 = await createSupplier(db, { name: 'Mayorista Nuevo', city: 'Medellín' });
  const client = await createCustomer(db, { name: 'Cliente de ejemplo' });

  await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: ago(75), amount: 8_000_000, inventoryId: inv.id, notes: 'Dinero con el que empecé' });
  const init = await registerInitialStock(db, {
    opId: op(),
    productId: ip11.id,
    quantity: 1,
    unitCost: 650_000,
    date: ago(80),
    units: [{ condition: 'Usado', batteryHealth: 82, parts: [{ part: 'battery', quality: 'generic', by: 'previous_owner', unknownPartWarning: true }] }],
  });
  await registerInitialStock(db, { opId: op(), productId: charger.id, quantity: 10, unitCost: 18_000, date: ago(80) });

  const p1 = await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    supplierId: prov.id,
    date: ago(60),
    paymentMethod: 'Transferencia',
    extraCosts: 40_000,
    lines: [
      {
        productId: ip13.id,
        quantity: 2,
        price: 3_100_000,
        units: [
          { condition: 'Usado', batteryHealth: 88 },
          { condition: 'Restaurado', batteryHealth: 100, parts: [{ part: 'screen', quality: 'generic', by: 'supplier' }, { part: 'battery', quality: 'original', by: 'supplier' }] },
        ],
      },
    ],
  });
  await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    supplierId: prov.id,
    date: ago(40),
    lines: [{ productId: ip14.id, quantity: 1, price: 2_900_000, units: [{ condition: 'Restaurado', batteryHealth: 95 }] }],
    funding: { kind: 'credit_card', creditor: 'Visa' },
  });
  const u13 = (await db.purchaseLines.where('purchaseId').equals(p1.id).first())!.unitIds[0];
  await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    customerId: client.id,
    date: ago(45),
    paymentMethod: 'Efectivo',
    lines: [{ productId: ip13.id, unitIds: [u13], unitPrice: 1_950_000 }],
    initialPayment: 1_950_000,
    warranty: { durationValue: 1, durationUnit: 'months' },
  });
  await createSale(db, { opId: op(), inventoryId: inv.id, date: ago(30), paymentMethod: 'Tarjeta', lines: [{ productId: charger.id, quantity: 4, unitPrice: 35_000 }], initialPayment: 140_000 });
  await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    date: ago(20),
    paymentMethod: 'Nequi',
    lines: [{ productId: ip11.id, unitIds: init.unitIds, unitPrice: 900_000 }],
    initialPayment: 600_000,
  });
  await createExpense(db, { opId: op(), date: ago(25), amount: 60_000, category: 'Publicidad', inventoryId: inv.id, notes: 'Publicación destacada' });
  const visa = (await db.debts.toArray()).find((d) => d.creditor === 'Visa');
  if (visa) await payDebt(db, { opId: op(), debtId: visa.id, date: ago(10), principal: 1_000_000, interest: 45_000 });
  await addCapitalMovement(db, { opId: op(), kind: 'owner_loan', date: ago(15), amount: 200_000, inventoryId: inv.id, notes: 'Emergencia' });

  // Lotes: los mismos audífonos a dos precios (el proveedor nuevo los dejó más baratos) + el pasaje del viaje
  await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: prov.id, date: ago(35), lines: [{ productId: buds.id, quantity: 5, price: 150_000 }] });
  await createSale(db, { opId: op(), inventoryId: inv.id, date: ago(12), paymentMethod: 'Efectivo', lines: [{ productId: buds.id, quantity: 2, unitPrice: 45_000 }], initialPayment: 90_000 });
  const trip1 = await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: prov2.id, date: ago(3, 11), lines: [{ productId: buds.id, quantity: 4, price: 88_000 }] });
  const trip2 = await createPurchase(db, { opId: op(), inventoryId: inv.id, supplierId: prov2.id, date: ago(3, 13), lines: [{ productId: charger.id, quantity: 5, price: 80_000 }] });
  await addTripCost(db, [trip1.id, trip2.id], { opId: op(), date: ago(3, 18), amount: 16_800, category: 'Pasajes', notes: 'Bus ida y vuelta + almuerzo' });
  await createSale(db, { opId: op(), inventoryId: inv.id, date: ago(1), paymentMethod: 'Efectivo', lines: [{ productId: buds.id, quantity: 2, unitPrice: 45_000 }], initialPayment: 90_000 });
  await addPersonalSpending(db, { opId: op(), date: ago(1, 17), amount: 12_000, tag: 'Gasto hormiga', notes: 'Café y pan', willRepay: false });

  await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Usado', price: 1_900_000, date: ago(35) });
  await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Usado', price: 1_950_000, date: ago(5) });
  await addMarketPrice(db, { model: 'iPhone 13', capacity: '128 GB', condition: 'Restaurado', price: 2_050_000, date: ago(5) });
  await addMarketPrice(db, { model: 'iPhone 14 Pro', capacity: '256 GB', condition: 'Restaurado', price: 3_500_000, date: ago(40) });
  await addMarketPrice(db, { model: 'iPhone 11', capacity: '64 GB', condition: 'Usado', price: 950_000, date: ago(25) });

  await saveGoal(db, { name: 'Llegar a 12 millones', metric: 'business_value', target: 12_000_000, dueDate: new Date(Date.now() + 90 * 86_400_000).toISOString(), inventoryId: inv.id });
  await db.meta.put({ key: 'practiceSeeded', value: new Date().toISOString() });
}
