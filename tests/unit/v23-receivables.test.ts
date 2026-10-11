import { describe, expect, it } from 'vitest';
import {
  createBackup,
  createCredit,
  createCustomer,
  createPurchase,
  createSale,
  explainGrowth,
  forgiveDebt,
  getBalances,
  getCapitalSnapshot,
  getDebtor,
  getFinancialSummary,
  getReceivablesOverview,
  getSaleBalance,
  parseBackup,
  payDebtor,
  registerReturn,
  restoreBackup,
  setDueDate,
  unforgiveDebt,
  voidCredit,
  voidCreditPayment,
  type AppDB,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, setupInventory } from './helpers';

const ALL = { from: '0000-01-01T00:00:00.000Z', to: '9999-12-31T00:00:00.000Z' };
const NOW = new Date('2026-10-10T20:00:00Z');

async function balanced(db: AppDB) {
  await expectIntegrity(db);
  expect((await explainGrowth(db, null)).difference).toBe(0);
}

async function shop() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const p = await accessoryProduct(db, inv.id, 'Funda');
  await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 20, price: 200_000 }] });
  const ana = await createCustomer(db, { name: 'Ana Pérez', phone: '3001234567' });
  const fiar = (date: string, q: number, paid = 0, customerId: string | null = ana.id) =>
    createSale(db, { opId: op(), inventoryId: inv.id, customerId, date: D(date), lines: [{ productId: p.id, quantity: q, unitPrice: 25_000 }], initialPayment: paid });
  return { db, inv, p, ana, fiar };
}

describe('v2.3 · me deben (fiados)', () => {
  it('ventas fiadas por persona: abonos con fecha de lo más antiguo a lo más nuevo', async () => {
    const { db, ana, fiar } = await shop();
    const s1 = await fiar('2026-09-05T15:00:00Z', 2, 10_000); // debe 40 000
    const s2 = await fiar('2026-09-20T15:00:00Z', 1); // debe 25 000
    await setDueDate(db, { type: 'sale', id: s1.id }, D('2026-09-30T15:00:00Z'));
    let ov = await getReceivablesOverview(db, null, NOW);
    expect(ov.debtors).toHaveLength(1);
    expect(ov.debtors[0]).toMatchObject({ name: 'Ana Pérez', pending: 65_000, overdue: 40_000 });
    expect(ov.total).toBe(65_000);
    expect((await getBalances(db, null)).debtors).toBe(1);

    await expect(payDebtor(db, { opId: op(), key: ana.id, amount: 70_000, date: D('2026-10-01T15:00:00Z') })).rejects.toMatchObject({ code: 'overpayment' });
    await expect(payDebtor(db, { opId: op(), key: ana.id, amount: 1_000, date: D('2026-09-01T15:00:00Z') })).rejects.toMatchObject({ code: 'incoherent_date' });
    // Abono de 50 000: 40 000 a la primera y 10 000 a la segunda
    const r = await payDebtor(db, { opId: op(), key: ana.id, amount: 50_000, date: D('2026-10-02T15:00:00Z'), method: 'Nequi' });
    expect(r!.applied.map((a) => a.amount)).toEqual([40_000, 10_000]);
    expect((await getSaleBalance(db, s1.id)).status).toBe('pagada');
    expect((await getSaleBalance(db, s2.id)).pending).toBe(15_000);
    ov = await getReceivablesOverview(db, null, NOW);
    expect(ov.debtors[0]).toMatchObject({ pending: 15_000, overdue: 0, lastPaymentAt: D('2026-10-02T15:00:00Z') });
    expect(ov.collectedThisMonth).toBe(50_000);
    const det = await getDebtor(db, ana.id, NOW);
    // Incluye lo que pagó el día de la venta
    expect(det.history.map((h) => h.amount).sort()).toEqual([10_000, 10_000, 40_000]);
    expect(det.debtor!.items).toHaveLength(2);
    await balanced(db);
  });

  it('venta fiada sin comprador: se abona con su propia clave', async () => {
    const { db, fiar } = await shop();
    const s = await fiar('2026-09-05T15:00:00Z', 1, 0, null);
    const ov = await getReceivablesOverview(db, null, NOW);
    expect(ov.debtors[0]).toMatchObject({ key: `sale:${s.id}`, name: 'Venta sin nombre', pending: 25_000 });
    await payDebtor(db, { opId: op(), key: `sale:${s.id}`, amount: 25_000, date: D('2026-09-06T15:00:00Z') });
    expect((await getReceivablesOverview(db, null, NOW)).debtors).toEqual([]);
    await balanced(db);
  });

  it('le prestaste plata y ya te debía de antes: caja, capital y crecimiento cuadran', async () => {
    const { db, ana } = await shop();
    const cash0 = (await getCapitalSnapshot(db, null)).cash;
    const loan = await createCredit(db, { opId: op(), customerId: ana.id, kind: 'loan', amount: 100_000, date: D('2026-09-10T15:00:00Z'), notes: 'Para el pasaje' });
    const old = await createCredit(db, { opId: op(), customerId: ana.id, kind: 'opening', amount: 30_000, date: D('2026-09-01T15:00:00Z') });
    let snap = await getCapitalSnapshot(db, null);
    expect(snap.cash).toBe(cash0 - 100_000);
    expect(snap.receivables).toBe(130_000);
    expect(snap.receivablesContributed).toBe(30_000);
    await balanced(db);
    // Abono: primero lo más antiguo (lo de antes de la app)
    const r = await payDebtor(db, { opId: op(), key: ana.id, amount: 50_000, date: D('2026-09-15T15:00:00Z') });
    expect(r!.applied).toEqual([
      { ref: { type: 'credit', id: old.id }, amount: 30_000 },
      { ref: { type: 'credit', id: loan.id }, amount: 20_000 },
    ]);
    snap = await getCapitalSnapshot(db, null);
    expect(snap.cash).toBe(cash0 - 50_000);
    expect(snap.receivables).toBe(80_000);
    await balanced(db);
    await expect(voidCredit(db, loan.id, 'error')).rejects.toMatchObject({ code: 'has_payments' });
    const pays = await db.creditPayments.where('creditId').equals(loan.id).toArray();
    await voidCreditPayment(db, pays[0].id);
    await voidCredit(db, loan.id, 'Lo registré dos veces');
    expect((await getCapitalSnapshot(db, null)).receivables).toBe(0);
    await balanced(db);
  });

  it('"no me va a pagar": el saldo se perdona como pérdida y se puede deshacer', async () => {
    const { db, ana, fiar } = await shop();
    const s = await fiar('2026-09-05T15:00:00Z', 2, 20_000); // debe 30 000
    const loan = await createCredit(db, { opId: op(), customerId: ana.id, kind: 'loan', amount: 40_000, date: D('2026-09-10T15:00:00Z') });
    const before = (await getFinancialSummary(db, ALL, null)).netProfit;
    expect(await forgiveDebt(db, { type: 'sale', id: s.id }, 'Se fue del barrio', D('2026-10-01T15:00:00Z'))).toBe(30_000);
    expect(await forgiveDebt(db, { type: 'credit', id: loan.id }, '', D('2026-10-01T15:00:00Z'))).toBe(40_000);
    const fin = await getFinancialSummary(db, ALL, null);
    expect(fin.badDebts).toBe(70_000);
    expect(fin.netProfit).toBe(before - 70_000);
    expect((await getSaleBalance(db, s.id)).status).toBe('perdonada');
    expect((await getReceivablesOverview(db, null, NOW)).total).toBe(0);
    await balanced(db);
    const line = (await db.saleLines.where('saleId').equals(s.id).toArray())[0];
    await expect(registerReturn(db, { opId: op(), saleId: s.id, date: D('2026-10-02T15:00:00Z'), reason: 'x', refundAmount: 0, lines: [{ saleLineId: line.id, quantity: 1, destination: 'available' }] })).rejects.toMatchObject({ code: 'forgiven' });
    await unforgiveDebt(db, { type: 'sale', id: s.id });
    expect((await getReceivablesOverview(db, null, NOW)).total).toBe(30_000);
    await balanced(db);
    // Respaldo
    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup((await createBackup(db)).text), { safetyName: 'seg-' + op() });
    expect(await db2.credits.count()).toBe(1);
    await expectIntegrity(db2);
  });
});
