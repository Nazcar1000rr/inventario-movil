import type { AppDB } from '../db';
import type { ID, ISODate, Money, Payment } from '../types';
import { assertMoney, cleanStr, fail, newId, nowISO } from '../util';

import { computeSaleBalance, type PaymentStatus } from './sales';
import { tx } from './stock';

/**
 * v2.4: comprobante de venta, cierre de caja diario y cotizaciones.
 * Las cotizaciones y los cierres se guardan en `meta` (una clave por registro): viajan en el respaldo sin cambiar
 * la estructura de la base de datos y no tocan los inventarios ni las cuentas hasta que se convierten en venta.
 */

/* ======================= Comprobante de venta ======================= */

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
  imei: string;
  /** Texto de la garantía de ese equipo ("Garantía hasta 12 dic 2026"), si tiene. */
  warranty: string;
}

export interface Receipt {
  saleId: ID;
  /** Número corto para el cliente (derivado de la fecha y el código de la venta). */
  number: string;
  date: ISODate;
  business: string;
  customer: string;
  customerPhone: string;
  lines: ReceiptLine[];
  subtotal: Money;
  discount: Money;
  total: Money;
  returned: Money;
  paid: Money;
  pending: Money;
  status: PaymentStatus;
  method: string;
  voided: boolean;
  notes: string;
  payments: { date: ISODate; amount: Money; method: string; kind: Payment['kind'] }[];
}

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDate = (iso: ISODate): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

export async function getReceipt(db: AppDB, saleId: ID): Promise<Receipt> {
  const sale = await db.sales.get(saleId);
  if (!sale) fail('not_found', 'La venta no existe.');
  const [lines, payments, inv, customer, warranties] = await Promise.all([
    db.saleLines.where('saleId').equals(saleId).toArray(),
    db.payments.where('saleId').equals(saleId).toArray(),
    db.inventories.get(sale.inventoryId),
    sale.customerId ? db.customers.get(sale.customerId) : Promise.resolve(undefined),
    db.warranties.where('saleId').equals(saleId).toArray(),
  ]);
  const bal = computeSaleBalance(sale, lines, payments);
  const products = new Map((await db.products.bulkGet([...new Set(lines.map((l) => l.productId))])).filter(Boolean).map((p) => [p!.id, p!]));
  const unitIds = lines.map((l) => l.unitId).filter(Boolean) as ID[];
  const units = new Map((await db.units.bulkGet(unitIds)).filter(Boolean).map((u) => [u!.id, u!]));
  const out: ReceiptLine[] = lines.map((l) => {
    const w = warranties.find((x) => x.saleLineId === l.id) ?? (l.unitId ? warranties.find((x) => x.unitId === l.unitId) : undefined);
    return {
      name: products.get(l.productId)?.name ?? 'Producto',
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.quantity * l.unitPrice,
      imei: l.unitId ? units.get(l.unitId)?.imei ?? '' : '',
      warranty: w && w.status !== 'cancelled' ? `Garantía hasta ${shortDate(w.endDate)}` : '',
    };
  });
  const d = new Date(sale.date);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    saleId,
    number: `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${sale.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
    date: sale.date,
    business: inv?.name ?? 'Inventario Móvil',
    customer: customer?.name ?? '',
    customerPhone: customer?.phone ?? '',
    lines: out,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    returned: bal.returned,
    paid: bal.collected,
    pending: bal.pending,
    status: bal.status,
    method: sale.paymentMethod,
    voided: sale.status === 'voided',
    notes: sale.notes,
    payments: payments.map((p) => ({ date: p.date, amount: p.amount, method: p.method, kind: p.kind })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ======================= Cierre de caja diario ======================= */

export interface CashCloseSaved {
  day: string;
  counted: Money;
  expected: Money;
  difference: Money;
  notes: string;
  closedAt: ISODate;
}

export interface CashClose {
  /** Día en formato AAAA-MM-DD (hora local). */
  day: string;
  salesCount: number;
  salesTotal: Money;
  /** Ventas del día que quedaron por cobrar (fiado). */
  onCredit: Money;
  /** Plata que entró hoy por medio de pago (cobros de ventas de hoy y de días anteriores). */
  collectedByMethod: { method: string; amount: Money; count: number }[];
  collected: Money;
  refunds: Money;
  expenses: Money;
  /** Compras pagadas con plata de la caja (no con deuda). */
  purchasesCash: Money;
  /** Lo que debería haber en efectivo: cobros en efectivo − devoluciones en efectivo − gastos − compras. */
  expectedCash: Money;
  saved: CashCloseSaved | null;
}

const CASH = 'Efectivo';
const localDayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function getCashClose(db: AppDB, day: Date, inventoryIds: ID[] | null = null): Promise<CashClose> {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString();
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).toISOString();
  const inScope = (id: ID | null) => !inventoryIds || (id !== null && inventoryIds.includes(id));
  const inDay = (iso: ISODate) => iso >= from && iso < to;
  const [sales, payments, expenses, purchases] = await Promise.all([db.sales.toArray(), db.payments.toArray(), db.expenses.toArray(), db.purchases.toArray()]);
  const activeSales = new Map(sales.filter((s) => s.status === 'active').map((s) => [s.id, s]));
  const today = sales.filter((s) => s.status === 'active' && inScope(s.inventoryId) && inDay(s.date));
  const pays = payments.filter((p) => inDay(p.date) && inScope(p.inventoryId) && activeSales.has(p.saleId));
  const by = new Map<string, { amount: Money; count: number }>();
  let refunds = 0;
  let refundsCash = 0;
  for (const p of pays) {
    const m = p.method || CASH;
    if (p.kind === 'refund') {
      refunds += p.amount;
      if (m === CASH) refundsCash += p.amount;
      continue;
    }
    const g = by.get(m) ?? { amount: 0, count: 0 };
    g.amount += p.amount;
    g.count += 1;
    by.set(m, g);
  }
  const exp = expenses.filter((e) => e.status === 'active' && inDay(e.date) && (inventoryIds ? inScope(e.inventoryId) : true) && e.treatment === 'operating').reduce((a, e) => a + e.amount, 0);
  const purchasesCash = purchases.filter((p) => p.status === 'active' && p.paymentSource === 'cash' && inDay(p.date) && inScope(p.inventoryId)).reduce((a, p) => a + p.total, 0);
  const collectedByMethod = [...by.entries()].map(([method, g]) => ({ method, ...g })).sort((a, b) => b.amount - a.amount);
  const collected = collectedByMethod.reduce((a, g) => a + g.amount, 0);
  const cashIn = by.get(CASH)?.amount ?? 0;
  const dayStr = localDayKey(day);
  const savedRec = await db.meta.get(`cashClose:${dayStr}`);
  let saved: CashCloseSaved | null = null;
  if (savedRec) {
    try {
      saved = JSON.parse(savedRec.value) as CashCloseSaved;
    } catch {
      saved = null;
    }
  }
  const salesTotal = today.reduce((a, s) => a + s.total, 0);
  const paidToday = pays.filter((p) => p.kind === 'payment' && today.some((s) => s.id === p.saleId)).reduce((a, p) => a + p.amount, 0);
  return {
    day: dayStr,
    salesCount: today.length,
    salesTotal,
    onCredit: Math.max(0, salesTotal - paidToday),
    collectedByMethod,
    collected,
    refunds,
    expenses: exp,
    purchasesCash,
    expectedCash: cashIn - refundsCash - exp - purchasesCash,
    saved,
  };
}

/** Guarda el cierre del día con lo que contaste en caja. Cerrar de nuevo el mismo día reemplaza el anterior. */
export async function saveCashClose(db: AppDB, day: Date, counted: Money, notes = ''): Promise<CashCloseSaved> {
  assertMoney(counted, 'counted', 'Efectivo contado');
  const c = await getCashClose(db, day);
  const rec: CashCloseSaved = { day: c.day, counted, expected: c.expectedCash, difference: counted - c.expectedCash, notes: cleanStr(notes, 300), closedAt: nowISO() };
  await db.meta.put({ key: `cashClose:${c.day}`, value: JSON.stringify(rec) });
  return rec;
}

export async function listCashCloses(db: AppDB, limit = 30): Promise<CashCloseSaved[]> {
  const rows = await db.meta.where('key').startsWith('cashClose:').toArray();
  const out: CashCloseSaved[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.value) as CashCloseSaved);
    } catch {
      /* se ignora un registro dañado */
    }
  }
  return out.sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
}

/* ======================= Cotizaciones ======================= */

export type QuoteStatus = 'open' | 'sold' | 'cancelled';

export interface QuoteLine {
  productId: ID | null;
  name: string;
  quantity: number;
  unitPrice: Money;
}

export interface Quote {
  id: ID;
  number: number;
  inventoryId: ID | null;
  customerId: ID | null;
  customerName: string;
  customerPhone: string;
  date: ISODate;
  /** Último día en que vale el precio (AAAA-MM-DD). */
  validUntil: string;
  lines: QuoteLine[];
  discount: Money;
  notes: string;
  status: QuoteStatus;
  saleId: ID | null;
  createdAt: ISODate;
}

export type QuoteInput = Pick<Quote, 'inventoryId' | 'customerId' | 'customerName' | 'customerPhone' | 'validUntil' | 'lines' | 'discount' | 'notes'> & { date?: ISODate };

const QKEY = 'quote:';

export function quoteTotals(q: Pick<Quote, 'lines' | 'discount'>): { subtotal: Money; discount: Money; total: Money } {
  const subtotal = q.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const discount = Math.min(q.discount, subtotal);
  return { subtotal, discount, total: subtotal - discount };
}

/** "Vigente", "Vencida" (pasó la fecha de validez), "Vendida" o "Cancelada". */
export function quoteState(q: Pick<Quote, 'status' | 'validUntil'>, now = new Date()): 'open' | 'expired' | 'sold' | 'cancelled' {
  if (q.status !== 'open') return q.status;
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = q.validUntil.split('-').map(Number);
  return new Date(y, m - 1, d) < t ? 'expired' : 'open';
}

function cleanLines(lines: QuoteLine[]): QuoteLine[] {
  if (!lines?.length) fail('required', 'Agrega al menos un producto a la cotización.', 'lines');
  return lines.map((l, i) => {
    const name = cleanStr(l.name, 120);
    if (!name) fail('required', `Línea ${i + 1}: falta el nombre del producto.`, `lines.${i}.name`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) fail('invalid', `Línea ${i + 1}: la cantidad debe ser 1 o más.`, `lines.${i}.quantity`);
    assertMoney(l.unitPrice, `lines.${i}.unitPrice`, 'Precio');
    return { productId: l.productId ?? null, name, quantity: l.quantity, unitPrice: l.unitPrice };
  });
}

function checkDay(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T12:00:00`).getTime())) fail('invalid', 'Escribe la fecha de validez.', 'validUntil');
  return s;
}

async function readQuote(db: AppDB, id: ID): Promise<Quote | undefined> {
  const rec = await db.meta.get(QKEY + id);
  if (!rec) return undefined;
  try {
    return JSON.parse(rec.value) as Quote;
  } catch {
    return undefined;
  }
}

export async function listQuotes(db: AppDB): Promise<Quote[]> {
  const rows = await db.meta.where('key').startsWith(QKEY).toArray();
  const out: Quote[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.value) as Quote);
    } catch {
      /* se ignora un registro dañado */
    }
  }
  return out.sort((a, b) => b.number - a.number);
}

export const getQuote = readQuote;

export async function createQuote(db: AppDB, input: QuoteInput): Promise<Quote> {
  const lines = cleanLines(input.lines);
  const discount = assertMoney(input.discount ?? 0, 'discount', 'Descuento');
  const validUntil = checkDay(input.validUntil);
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  if (discount > subtotal) fail('invalid', 'El descuento no puede ser mayor que el subtotal.', 'discount');
  return tx(db, async () => {
    const all = await listQuotes(db);
    const q: Quote = {
      id: newId(),
      number: (all[0]?.number ?? 0) + 1,
      inventoryId: input.inventoryId ?? null,
      customerId: input.customerId ?? null,
      customerName: cleanStr(input.customerName, 80),
      customerPhone: cleanStr(input.customerPhone, 30),
      date: input.date ?? nowISO(),
      validUntil,
      lines,
      discount,
      notes: cleanStr(input.notes, 300),
      status: 'open',
      saleId: null,
      createdAt: nowISO(),
    };
    await db.meta.put({ key: QKEY + q.id, value: JSON.stringify(q) });
    return q;
  });
}

export async function updateQuote(db: AppDB, id: ID, input: QuoteInput): Promise<Quote> {
  return tx(db, async () => {
    const q = await readQuote(db, id);
    if (!q) fail('not_found', 'La cotización no existe.');
    if (q.status === 'sold') fail('state', 'Esta cotización ya se convirtió en venta; no se puede cambiar.');
    const lines = cleanLines(input.lines);
    const discount = assertMoney(input.discount ?? 0, 'discount', 'Descuento');
    if (discount > lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0)) fail('invalid', 'El descuento no puede ser mayor que el subtotal.', 'discount');
    const next: Quote = { ...q, inventoryId: input.inventoryId ?? null, customerId: input.customerId ?? null, customerName: cleanStr(input.customerName, 80), customerPhone: cleanStr(input.customerPhone, 30), validUntil: checkDay(input.validUntil), lines, discount, notes: cleanStr(input.notes, 300), status: 'open' };
    await db.meta.put({ key: QKEY + id, value: JSON.stringify(next) });
    return next;
  });
}

export async function setQuoteCancelled(db: AppDB, id: ID, cancelled: boolean): Promise<void> {
  await tx(db, async () => {
    const q = await readQuote(db, id);
    if (!q) fail('not_found', 'La cotización no existe.');
    if (q.status === 'sold') fail('state', 'Esta cotización ya se convirtió en venta.');
    await db.meta.put({ key: QKEY + id, value: JSON.stringify({ ...q, status: cancelled ? 'cancelled' : 'open' }) });
  });
}

/** Marca la cotización como vendida cuando se registra la venta que salió de ella. */
export async function markQuoteSold(db: AppDB, id: ID, saleId: ID): Promise<void> {
  await tx(db, async () => {
    const q = await readQuote(db, id);
    if (!q || q.status === 'sold') return;
    await db.meta.put({ key: QKEY + id, value: JSON.stringify({ ...q, status: 'sold', saleId }) });
  });
}

export async function deleteQuote(db: AppDB, id: ID): Promise<void> {
  await db.meta.delete(QKEY + id);
}

/** Texto listo para WhatsApp. */
export function quoteMessage(q: Quote, business: string, fmtMoney: (n: Money) => string, fmtDay: (day: string) => string): string {
  const t = quoteTotals(q);
  const rows = q.lines.map((l) => `• ${l.quantity} × ${l.name}: ${fmtMoney(l.quantity * l.unitPrice)}`);
  return [
    `Hola${q.customerName ? ` ${q.customerName}` : ''}, esta es tu cotización${business ? ` de ${business}` : ''} (N.º ${q.number}):`,
    '',
    ...rows,
    ...(t.discount > 0 ? ['', `Descuento: −${fmtMoney(t.discount)}`] : []),
    '',
    `Total: ${fmtMoney(t.total)}`,
    `Válida hasta el ${fmtDay(q.validUntil)}.`,
    ...(q.notes ? ['', q.notes] : []),
  ].join('\n');
}
