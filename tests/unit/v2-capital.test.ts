import { describe, expect, it } from 'vitest';
import {
  AppError,
  addCapitalMovement,
  addRepair,
  adjustQuantity,
  computeCapitalAt,
  createDebt,
  createPurchase,
  createSale,
  createExpense,
  createSupplier,
  currentInventoryValue,
  deleteInventoryPermanently,
  explainGrowth,
  getCapitalMetrics,
  getCapitalSeries,
  getCapitalSnapshot,
  getGoalsProgress,
  getMonthlySummary,
  getFinancialSummary,
  listDebts,
  loadCapitalData,
  payDebt,
  registerInitialStock,
  registerReturn,
  saveGoal,
  scopeFor,
  updateSettings,
  voidCapitalMovement,
  voidDebt,
  voidDebtPayment,
  voidPurchase,
  type AppDB,
} from '../../src/core';
import { accessoryProduct, D, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function purchaseUnits(db: AppDB, purchaseId: string): Promise<string[]> {
  const lines = await db.purchaseLines.where('purchaseId').equals(purchaseId).toArray();
  return lines.flatMap((l) => l.unitIds);
}

/**
 * Caso completo con valores calculados a mano (ver comentarios). Fechas en enero y febrero de 2026.
 */
async function capitalScenario() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const phone = await phoneProduct(db, inv.id, 'iPhone 13', '128 GB');
  const charger = await accessoryProduct(db, inv.id);
  const s1 = await createSupplier(db, { name: 'Proveedor Uno' });
  await updateSettings(db, { paymentFees: { Efectivo: 0, Tarjeta: 3 } });

  // 1) Aporte inicial 10.000.000
  await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-01-02T15:00:00Z'), amount: 10_000_000, inventoryId: inv.id });
  // 2) Mercancía que ya tenía (diciembre 2025): 1 iPhone a 1.200.000 + 5 cargadores a 20.000 → 1.300.000 aportados en mercancía
  const init = await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: 1_200_000, date: D('2025-12-01T15:00:00Z') });
  await registerInitialStock(db, { opId: op(), productId: charger.id, quantity: 5, unitCost: 20_000, date: D('2025-12-01T15:00:00Z') });
  // 3) Compra de contado: 2 iPhone por 3.000.000 (1.500.000 c/u)
  const p1 = await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    supplierId: s1.id,
    date: D('2026-01-10T15:00:00Z'),
    lines: [{ productId: phone.id, quantity: 2, price: 3_000_000, units: [{ condition: 'Usado' }, { condition: 'Usado' }] }],
  });
  const [u1] = await purchaseUnits(db, p1.id);
  // 4) Compra con tarjeta de crédito: 1 iPhone 1.800.000 (deuda 1.800.000)
  const p2 = await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-01-12T15:00:00Z'),
    lines: [{ productId: phone.id, quantity: 1, price: 1_800_000 }],
    funding: { kind: 'credit_card', creditor: 'Visa' },
  });
  // 5) Reparación pagada (capitalizada) de 100.000 con cambio de batería genérica
  await addRepair(db, {
    opId: op(),
    unitId: u1,
    date: D('2026-01-15T15:00:00Z'),
    description: 'Cambio de batería',
    cost: 100_000,
    part: { part: 'battery', quality: 'generic' },
  });
  // 6) Venta de u1 (costo 1.600.000) por 2.000.000, abono 1.500.000 → por cobrar 500.000
  const sale1 = await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-01-20T15:00:00Z'),
    paymentMethod: 'Efectivo',
    lines: [{ productId: phone.id, unitIds: [u1], unitPrice: 2_000_000 }],
    initialPayment: 1_500_000,
  });
  // 7) Venta de 2 cargadores (40.000 c/u) pagada con tarjeta (comisión 3 % = 2.400)
  const sale2 = await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-01-21T15:00:00Z'),
    paymentMethod: 'Tarjeta',
    lines: [{ productId: charger.id, quantity: 2, unitPrice: 40_000 }],
    initialPayment: 80_000,
  });
  // 8) Gasto general (sin inventario) de 50.000
  await createExpense(db, { opId: op(), date: D('2026-01-25T15:00:00Z'), amount: 50_000, category: 'Publicidad' });
  // 9-12) Préstamo a mí 300.000, devuelvo 100.000, retiro 200.000, ajuste de caja −10.000
  await addCapitalMovement(db, { opId: op(), kind: 'owner_loan', date: D('2026-02-01T15:00:00Z'), amount: 300_000, inventoryId: inv.id });
  await addCapitalMovement(db, { opId: op(), kind: 'owner_loan_repayment', date: D('2026-02-05T15:00:00Z'), amount: 100_000, inventoryId: inv.id });
  await addCapitalMovement(db, { opId: op(), kind: 'withdrawal', date: D('2026-02-10T15:00:00Z'), amount: 200_000, inventoryId: inv.id });
  await addCapitalMovement(db, { opId: op(), kind: 'cash_adjustment', date: D('2026-02-11T15:00:00Z'), amount: -10_000, inventoryId: inv.id, notes: 'Faltante' });
  // 13) Préstamo en efectivo de un tercero: 1.000.000
  const loan = await createDebt(db, { opId: op(), kind: 'loan', creditor: 'Primo', date: D('2026-02-12T15:00:00Z'), principal: 1_000_000, inventoryId: inv.id });
  // 14) Abono a la tarjeta: 800.000 a capital + 30.000 de intereses
  const visa = (await db.debts.where('purchaseId').equals(p2.id).first())!;
  const pay = await payDebt(db, { opId: op(), debtId: visa.id, date: D('2026-02-15T15:00:00Z'), principal: 800_000, interest: 30_000 });
  // 15) Devolución de 1 cargador con reembolso de 40.000
  const l2 = (await db.saleLines.where('saleId').equals(sale2.id).toArray())[0];
  await registerReturn(db, { opId: op(), saleId: sale2.id, date: D('2026-02-20T15:00:00Z'), reason: 'No le sirvió', refundAmount: 40_000, lines: [{ saleLineId: l2.id, quantity: 1, destination: 'available' }] });
  // 16) Cargador encontrado en conteo (20.000)
  await adjustQuantity(db, { opId: op(), productId: charger.id, direction: 'in', quantity: 1, unitCost: 20_000, date: D('2026-02-22T15:00:00Z'), reason: 'Conteo físico' });
  // 17) Venta del iPhone inicial (1.200.000) por 1.700.000 de contado
  await createSale(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D('2026-02-25T15:00:00Z'),
    paymentMethod: 'Efectivo',
    lines: [{ productId: phone.id, unitIds: init.unitIds, unitPrice: 1_700_000 }],
    initialPayment: 1_700_000,
  });
  return { db, inv, phone, charger, p1, p2, visa, loan, pay, sale1, sale2, u1 };
}

describe('v2 · capital del negocio', () => {
  it('calcula caja, valor del negocio y crecimiento con un caso conocido', async () => {
    const { db, inv } = await capitalScenario();
    const s = await getCapitalSnapshot(db, null);
    // Caja = 10.000.000 − 200.000 − 10.000 − 300.000 + 100.000 + 3.280.000 − 40.000 − 4.800.000 − 182.400 + 2.800.000 − 800.000
    expect(s.cash).toBe(9_847_600);
    expect(s.cashFlow).toMatchObject({
      contributions: 10_000_000,
      withdrawals: 200_000,
      adjustments: -10_000,
      ownerLoansOut: 300_000,
      ownerLoansBack: 100_000,
      collected: 3_280_000,
      refunded: 40_000,
      purchases: 4_800_000,
      expenses: 182_400,
      debtIn: 2_800_000,
      debtPrincipalPaid: 800_000,
    });
    expect(s.inventory).toBe(3_400_000); // 1.500.000 + 1.800.000 + 5 cargadores × 20.000
    expect(s.receivables).toBe(500_000);
    expect(s.customerCredit).toBe(0);
    expect(s.ownerLoans).toBe(200_000);
    expect(s.debts).toBe(2_000_000);
    expect(s.businessValue).toBe(11_947_600);
    expect(s.goodsContributed).toBe(1_300_000);
    expect(s.netCapital).toBe(11_100_000);
    expect(s.growth).toBe(847_600);
    expect(s.growthPct).toBeCloseTo(847_600 / 11_100_000, 10);

    // Crecimiento = ganancia neta acumulada + ajustes de caja + mercancía encontrada
    const g = await explainGrowth(db, null);
    expect(g).toEqual({ growth: 847_600, netProfit: 837_600, cashAdjustments: -10_000, foundStock: 20_000, difference: 0 });

    // Por inventario: el gasto general (50.000) no cuenta
    const si = await getCapitalSnapshot(db, [inv.id]);
    expect(si.cash).toBe(9_897_600);
    expect(si.growth).toBe(897_600);
    expect((await explainGrowth(db, [inv.id])).difference).toBe(0);

    // El valor del inventario según movimientos coincide con el de las existencias
    const data = await loadCapitalData(db);
    expect(computeCapitalAt(data, null, scopeFor(null)).inventory).toBe(currentInventoryValue(data, scopeFor(null)).value);
    await expectIntegrity(db);
  });

  it('serie mensual: valores por mes, crecimiento mensual y último punto = hoy', async () => {
    const { db } = await capitalScenario();
    const series = await getCapitalSeries(db, null, 24, new Date(2026, 9, 10, 12));
    expect(series[0].key).toBe('2025-12');
    expect(series[0]).toMatchObject({ value: 1_300_000, netCapital: 1_300_000, growth: 0 });
    const jan = series.find((p) => p.key === '2026-01')!;
    // Fin de enero: caja 8.427.600 + inventario 4.560.000 + por cobrar 500.000 − deuda 1.800.000
    expect(jan).toMatchObject({ cash: 8_427_600, inventory: 4_560_000, value: 11_687_600, netCapital: 11_300_000, growth: 387_600, monthGrowth: 387_600 });
    const feb = series.find((p) => p.key === '2026-02')!;
    expect(feb.monthGrowth).toBe(847_600 - 387_600);
    const last = series.at(-1)!;
    const snap = await getCapitalSnapshot(db, null);
    expect(last.partial).toBe(true);
    expect(last.value).toBe(snap.businessValue);
    expect(series.reduce((a, p) => a + p.monthGrowth, 0)).toBe(snap.growth);
    // La ganancia de enero coincide con el crecimiento de enero
    const fin = await getFinancialSummary(db, { from: D('2026-01-01T05:00:00Z'), to: new Date(2026, 1, 1).toISOString() }, null);
    expect(fin.netProfit).toBe(387_600);
  });

  it('métricas: rentabilidad del periodo, rotación y dinero dormido', async () => {
    const { db } = await capitalScenario();
    const feb = { from: new Date(2026, 1, 1).toISOString(), to: new Date(2026, 2, 1).toISOString() };
    const m = await getCapitalMetrics(db, feb, null);
    // Febrero: venta 500.000 − devolución (40.000 − 20.000) − intereses 30.000 = 450.000
    expect(m.netProfit).toBe(450_000);
    expect(m.startValue).toBe(11_687_600);
    expect(m.periodReturn).toBeCloseTo(450_000 / 11_687_600, 10);
    expect(m.cogs).toBe(1_180_000);
    expect(m.avgInventory).toBe(Math.round((4_560_000 + 3_400_000) / 2));
    expect(m.rotation).toBeCloseTo(1_180_000 / 3_980_000, 10);
    // Todo lo que queda en existencia tiene más de 90 días
    expect(m.ageBuckets.find((b) => b.key === '91+')!.value).toBe(3_400_000);
    expect(m.dormant.value).toBe(3_400_000);
  });

  it('metas: avance, faltante y ritmo mensual necesario', async () => {
    const { db, inv } = await capitalScenario();
    await saveGoal(db, { name: 'Llegar a 15 millones', metric: 'business_value', target: 15_000_000, dueDate: daysFromNow(61) });
    await saveGoal(db, { name: 'Crecer 1 millón', metric: 'growth', target: 1_000_000, inventoryId: inv.id });
    const all = await getGoalsProgress(db, null);
    expect(all).toHaveLength(2);
    const g1 = all.find((g) => g.goal.metric === 'business_value')!;
    expect(g1.current).toBe(11_947_600);
    expect(g1.remaining).toBe(3_052_400);
    expect(g1.monthsLeft).toBeCloseTo(2, 0);
    expect(g1.perMonthNeeded).toBe(Math.ceil(3_052_400 / g1.monthsLeft!));
    const g2 = all.find((g) => g.goal.metric === 'growth')!;
    expect(g2.current).toBe(897_600); // del inventario (sin el gasto general)
    expect(g2.reached).toBe(false);
    const onlyInv = await getGoalsProgress(db, [inv.id]);
    expect(onlyInv.map((g) => g.goal.name)).toEqual(['Crecer 1 millón']);
    await expect(saveGoal(db, { name: '', metric: 'growth', target: 1 })).rejects.toThrow(AppError);
  });

  it('resumen mensual con los números del mes', async () => {
    const { db } = await capitalScenario();
    const s = await getMonthlySummary(db, new Date(2026, 0, 15), null);
    expect(s.key).toBe('2026-01');
    expect(s.partial).toBe(false);
    expect(s.fin.netProfit).toBe(387_600);
    expect(s.growthInMonth).toBe(387_600);
    expect(s.end.businessValue).toBe(11_687_600);
    expect(s.valueChange).toBe(11_687_600 - 1_300_000);
    expect(s.topSellers[0].units).toBeGreaterThan(0);
    expect(s.debtsOpen).toEqual({ count: 1, amount: 1_800_000 }); // solo la tarjeta (el préstamo del primo es de febrero)
  });

  it('préstamos al dueño y anulaciones de capital', async () => {
    const { db, inv } = await capitalScenario();
    await expect(
      addCapitalMovement(db, { opId: op(), kind: 'owner_loan_repayment', date: D('2026-03-01T15:00:00Z'), amount: 300_000, inventoryId: inv.id }),
    ).rejects.toMatchObject({ code: 'too_much' });
    const loan = (await db.capital.toArray()).find((c) => c.kind === 'owner_loan')!;
    await expect(voidCapitalMovement(db, loan.id, 'error')).rejects.toMatchObject({ code: 'has_repayments' });
    const wd = (await db.capital.toArray()).find((c) => c.kind === 'withdrawal')!;
    await voidCapitalMovement(db, wd.id, 'Registrado dos veces');
    const s = await getCapitalSnapshot(db, null);
    expect(s.cash).toBe(9_847_600 + 200_000);
    expect(s.netCapital).toBe(11_100_000 + 200_000);
    expect(s.growth).toBe(847_600); // retirar no cambia el crecimiento
    await expect(addCapitalMovement(db, { opId: op(), kind: 'cash_adjustment', date: D('2026-03-01T15:00:00Z'), amount: 0 })).rejects.toThrow(AppError);
    await expect(addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-03-01T15:00:00Z'), amount: -5 })).rejects.toThrow(AppError);
    // Idempotencia: la misma operación no se registra dos veces
    const id = op();
    await addCapitalMovement(db, { opId: id, kind: 'contribution', date: D('2026-03-01T15:00:00Z'), amount: 1_000 });
    await addCapitalMovement(db, { opId: id, kind: 'contribution', date: D('2026-03-01T15:00:00Z'), amount: 1_000 });
    expect((await db.capital.where('opId').equals(id).count())).toBe(1);
    await expectIntegrity(db);
  });

  it('eliminar un inventario elimina su capital, deudas y metas (lo general se conserva)', async () => {
    const { db, inv } = await capitalScenario();
    await saveGoal(db, { name: 'Meta', metric: 'growth', target: 1_000_000, inventoryId: inv.id });
    await addCapitalMovement(db, { opId: op(), kind: 'contribution', date: D('2026-03-01T15:00:00Z'), amount: 5_000 });
    await deleteInventoryPermanently(db, inv.id, inv.name);
    expect(await db.capital.where('inventoryId').equals(inv.id).count()).toBe(0);
    expect(await db.debts.count()).toBe(0);
    expect(await db.debtPayments.count()).toBe(0);
    expect(await db.goals.count()).toBe(0);
    expect(await db.capital.count()).toBe(1);
    expect(await db.expenses.filter((e) => e.inventoryId === null).count()).toBe(1);
    await expectIntegrity(db);
  });
});

describe('v2 · deudas y préstamos', () => {
  it('abonos, intereses como gasto financiero, saldo y estado', async () => {
    const { db, visa, loan, pay } = await capitalScenario();
    const debts = await listDebts(db, null);
    const v = debts.find((d) => d.id === visa.id)!;
    expect(v.balance).toMatchObject({ principal: 1_800_000, paidPrincipal: 800_000, paidInterest: 30_000, outstanding: 1_000_000, payments: 1 });
    expect(v.cashIn).toBe(false);
    const { voidExpense } = await import('../../src/core');
    await expect(voidExpense(db, pay.expenseId!)).rejects.toMatchObject({ code: 'linked' });
    const exp = await db.expenses.get(pay.expenseId!);
    expect(exp).toMatchObject({ amount: 30_000, category: 'Intereses y costos financieros', treatment: 'operating', debtId: visa.id, status: 'active' });

    await expect(payDebt(db, { opId: op(), debtId: loan.id, date: D('2026-03-01T15:00:00Z'), principal: 1_000_001 })).rejects.toMatchObject({ code: 'overpayment' });
    await payDebt(db, { opId: op(), debtId: loan.id, date: D('2026-03-01T15:00:00Z'), principal: 1_000_000 });
    expect((await db.debts.get(loan.id))!.status).toBe('paid');
    await expect(payDebt(db, { opId: op(), debtId: loan.id, date: D('2026-03-02T15:00:00Z'), principal: 1 })).rejects.toMatchObject({ code: 'paid' });
    await expect(voidDebt(db, loan.id, 'error')).rejects.toMatchObject({ code: 'has_payments' });
    await expect(voidDebt(db, visa.id, 'error')).rejects.toMatchObject({ code: 'from_purchase' });
    const lp = (await db.debtPayments.where('debtId').equals(loan.id).toArray())[0];
    await voidDebtPayment(db, lp.id);
    expect((await db.debts.get(loan.id))!.status).toBe('open');
    await voidDebt(db, loan.id, 'Registrado por error');
    expect((await db.debts.get(loan.id))!.status).toBe('voided');
    const s = await getCapitalSnapshot(db, null);
    expect(s.debts).toBe(1_000_000);
    expect(s.cash).toBe(9_847_600 - 1_000_000);
    expect(s.growth).toBe(847_600);
    await expectIntegrity(db);
  });

  it('una compra con deuda: anularla exige anular antes los abonos y anula la deuda', async () => {
    const { db, p2, visa, pay } = await capitalScenario();
    expect((await db.purchases.get(p2.id))).toMatchObject({ paymentSource: 'debt', debtId: visa.id });
    await expect(voidPurchase(db, p2.id, 'error')).rejects.toMatchObject({ code: 'debt_has_payments' });
    await voidDebtPayment(db, pay.id);
    expect((await db.expenses.get(pay.expenseId!))!.status).toBe('voided');
    await voidPurchase(db, p2.id, 'Compra duplicada');
    expect((await db.debts.get(visa.id))!.status).toBe('voided');
    const s = await getCapitalSnapshot(db, null);
    // Sin la compra (−1.800.000 de inventario) ni la deuda (+1.800.000), sin el abono (800.000) ni los intereses (30.000)
    expect(s.inventory).toBe(1_600_000);
    expect(s.debts).toBe(1_000_000);
    expect(s.cash).toBe(9_847_600 + 800_000 + 30_000);
    expect((await explainGrowth(db, null)).difference).toBe(0);
    await expectIntegrity(db);
  });

  it('valida los datos de una deuda y de la financiación de una compra', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const phone = await phoneProduct(db, inv.id);
    await expect(createDebt(db, { opId: op(), kind: 'loan', creditor: '', date: D('2026-02-01T15:00:00Z'), principal: 100 })).rejects.toMatchObject({ code: 'required' });
    await expect(createDebt(db, { opId: op(), kind: 'loan', creditor: 'X', date: D('2026-02-01T15:00:00Z'), principal: 0 })).rejects.toThrow(AppError);
    const cc = await createDebt(db, { opId: op(), kind: 'credit_card', creditor: '', date: D('2026-02-01T15:00:00Z'), principal: 100 });
    expect(cc.creditor).toBe('Tarjeta de crédito');
    await expect(
      createPurchase(db, {
        opId: op(),
        inventoryId: inv.id,
        date: D('2026-02-01T15:00:00Z'),
        lines: [{ productId: phone.id, quantity: 1, price: 1_000 }],
        funding: { kind: 'supplier', creditor: 'Prov', amount: 2_000 },
      }),
    ).rejects.toThrow(AppError);
    expect(await db.purchases.count()).toBe(0);
    // Financiación parcial: 600 de 1.000 a crédito del proveedor → solo 400 salen de la caja
    await createPurchase(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D('2026-02-01T15:00:00Z'),
      lines: [{ productId: phone.id, quantity: 1, price: 1_000 }],
      funding: { kind: 'supplier', creditor: 'Prov', amount: 600 },
    });
    const s = await getCapitalSnapshot(db, [inv.id]);
    expect(s.cash).toBe(-400);
    expect(s.debts).toBe(600);
    await expectIntegrity(db);
  });
});

describe('v2 · comisiones por medio de pago', () => {
  it('registra la comisión como gasto automático y permite ajustarla', async () => {
    const { db, sale1, sale2 } = await capitalScenario();
    const fee = (await db.expenses.where('saleId').equals(sale2.id).toArray()).find((e) => e.paymentFee)!;
    expect(fee).toMatchObject({ amount: 2_400, category: 'Comisión medio de pago', treatment: 'operating' });
    expect(await db.expenses.where('saleId').equals(sale1.id).count()).toBe(0); // efectivo: 0 %
    const { addPayment } = await import('../../src/core');
    await addPayment(db, { opId: op(), saleId: sale1.id, amount: 200_000, date: D('2026-03-01T15:00:00Z'), method: 'Tarjeta' });
    await addPayment(db, { opId: op(), saleId: sale1.id, amount: 100_000, date: D('2026-03-02T15:00:00Z'), method: 'Tarjeta', fee: 0 });
    await addPayment(db, { opId: op(), saleId: sale1.id, amount: 100_000, date: D('2026-03-03T15:00:00Z'), method: 'tarjeta', fee: 5_000 });
    const fees = (await db.expenses.where('saleId').equals(sale1.id).toArray()).map((e) => e.amount).sort((a, b) => a - b);
    expect(fees).toEqual([5_000, 6_000]);
    await expectIntegrity(db);
  });
});
