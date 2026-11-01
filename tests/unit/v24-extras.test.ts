import { describe, expect, it } from 'vitest';
import { createExpense, createPurchase, createQuote, createSale, deleteQuote, getCashClose, getQuote, getReceipt, listCashCloses, listQuotes, markQuoteSold, quoteMessage, quoteState, quoteTotals, saveCashClose, setQuoteCancelled, updateQuote } from '../../src/core';
import { accessoryProduct, D, expectIntegrity, makeDB, op, setupInventory } from './helpers';

const DAY = new Date(2026, 9, 14, 12, 0, 0);

async function base() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const charger = await accessoryProduct(db, inv.id, 'Cargador');
  await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T10:00:00-05:00'), lines: [{ productId: charger.id, quantity: 20, price: 40_000 }] });
  return { db, inv, charger };
}

describe('v2.4 · comprobante de venta', () => {
  it('muestra líneas, total, pagado y lo que falta', async () => {
    const { db, inv, charger } = await base();
    const s = await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-14T10:00:00-05:00'), discount: 5_000, lines: [{ productId: charger.id, quantity: 3, unitPrice: 35_000 }], initialPayment: 40_000, paymentMethod: 'Nequi' });
    const r = await getReceipt(db, s.id);
    expect(r).toMatchObject({ subtotal: 105_000, discount: 5_000, total: 100_000, paid: 40_000, pending: 60_000, status: 'parcial', voided: false });
    expect(r.lines).toEqual([expect.objectContaining({ name: 'Cargador', quantity: 3, unitPrice: 35_000, amount: 105_000 })]);
    expect(r.payments).toHaveLength(1);
    expect(r.number).toMatch(/^261014-[A-Z0-9]{1,4}$/);
    await expectIntegrity(db);
  });
});

describe('v2.4 · cierre de caja', () => {
  it('suma cobros por medio, resta gastos y compras en efectivo y calcula la diferencia', async () => {
    const { db, inv, charger } = await base();
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-14T09:00:00-05:00'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 35_000 }], initialPayment: 70_000, paymentMethod: 'Efectivo' });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-14T11:00:00-05:00'), lines: [{ productId: charger.id, quantity: 1, unitPrice: 36_000 }], initialPayment: 36_000, paymentMethod: 'Nequi' });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-14T15:00:00-05:00'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 35_000 }], initialPayment: 20_000, paymentMethod: 'Efectivo' }); // fiado: debe 50.000
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-13T15:00:00-05:00'), lines: [{ productId: charger.id, quantity: 1, unitPrice: 35_000 }], initialPayment: 35_000, paymentMethod: 'Efectivo' }); // ayer: no cuenta
    await createExpense(db, { opId: op(), date: D('2026-10-14T12:00:00-05:00'), amount: 15_000, category: 'Transporte', inventoryId: inv.id } as never);
    const c = await getCashClose(db, DAY);
    expect(c.salesCount).toBe(3);
    expect(c.salesTotal).toBe(70_000 + 36_000 + 70_000);
    expect(c.onCredit).toBe(50_000);
    expect(c.collectedByMethod).toEqual([expect.objectContaining({ method: 'Efectivo', amount: 90_000, count: 2 }), expect.objectContaining({ method: 'Nequi', amount: 36_000, count: 1 })]);
    expect(c.collected).toBe(126_000);
    expect(c.expenses).toBe(15_000);
    expect(c.expectedCash).toBe(90_000 - 15_000);
    expect(c.saved).toBeNull();
    const s = await saveCashClose(db, DAY, 70_000, 'Faltaron 5 mil');
    expect(s).toMatchObject({ counted: 70_000, expected: 75_000, difference: -5_000, day: '2026-10-14' });
    expect((await getCashClose(db, DAY)).saved?.difference).toBe(-5_000);
    const again = await saveCashClose(db, DAY, 75_000);
    expect(again.difference).toBe(0);
    expect(await listCashCloses(db)).toHaveLength(1);
    // Otro día sin movimientos
    expect(await getCashClose(db, new Date(2026, 9, 20))).toMatchObject({ salesCount: 0, collected: 0, expectedCash: 0 });
  });
});

describe('v2.4 · cotizaciones', () => {
  const lines = [{ productId: null, name: 'iPhone 13 128 GB', quantity: 1, unitPrice: 2_000_000 }, { productId: null, name: 'Cargador', quantity: 2, unitPrice: 35_000 }];
  it('crea, numera, calcula, cambia de estado y borra', async () => {
    const { db } = await base();
    const a = await createQuote(db, { inventoryId: null, customerId: null, customerName: 'Ana', customerPhone: '3001234567', validUntil: '2026-10-20', lines, discount: 70_000, notes: '' });
    const b = await createQuote(db, { inventoryId: null, customerId: null, customerName: '', customerPhone: '', validUntil: '2026-11-20', lines: [lines[1]], discount: 0, notes: 'Entrega en 2 días' });
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(quoteTotals(a)).toEqual({ subtotal: 2_070_000, discount: 70_000, total: 2_000_000 });
    expect((await listQuotes(db)).map((q) => q.number)).toEqual([2, 1]);
    expect(quoteState(a, new Date(2026, 9, 20))).toBe('open'); // el último día aún vale
    expect(quoteState(a, new Date(2026, 9, 21))).toBe('expired');
    const msg = quoteMessage(a, 'Local centro', (n) => `$${n}`, (d) => d);
    expect(msg).toContain('Hola Ana');
    expect(msg).toContain('• 2 × Cargador: $70000');
    expect(msg).toContain('Total: $2000000');
    expect(msg).toContain('Válida hasta el 2026-10-20');
    await setQuoteCancelled(db, a.id, true);
    expect(quoteState((await getQuote(db, a.id))!, DAY)).toBe('cancelled');
    await setQuoteCancelled(db, a.id, false);
    const up = await updateQuote(db, a.id, { ...a, lines: [lines[0]], discount: 0, validUntil: '2026-12-01' });
    expect(quoteTotals(up).total).toBe(2_000_000);
    await markQuoteSold(db, a.id, 'sale-1');
    expect(await getQuote(db, a.id)).toMatchObject({ status: 'sold', saleId: 'sale-1' });
    await expect(updateQuote(db, a.id, a)).rejects.toThrow(/convirtió en venta/);
    await deleteQuote(db, b.id);
    expect(await listQuotes(db)).toHaveLength(1);
  });
  it('valida: sin productos, cantidad, descuento y fecha', async () => {
    const { db } = await base();
    const ok = { inventoryId: null, customerId: null, customerName: '', customerPhone: '', validUntil: '2026-10-20', lines, discount: 0, notes: '' };
    await expect(createQuote(db, { ...ok, lines: [] })).rejects.toThrow(/Agrega al menos/);
    await expect(createQuote(db, { ...ok, lines: [{ ...lines[0], quantity: 0 }] })).rejects.toThrow(/cantidad/);
    await expect(createQuote(db, { ...ok, discount: 9_999_999 })).rejects.toThrow(/descuento/);
    await expect(createQuote(db, { ...ok, validUntil: '' })).rejects.toThrow(/validez/);
  });
});
