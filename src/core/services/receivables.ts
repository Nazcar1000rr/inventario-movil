import type { AppDB } from '../db';
import type { Credit, CreditPayment, Customer, ID, ISODate, Money, Sale } from '../types';
import { assertDate, assertMoney, cleanStr, fail, newId, nowISO } from '../util';
import { logHistory, requireInventory } from './base';
import { creditPending } from './reports';
import { addPaymentFeeExpense, computeSaleBalance } from './sales';
import { claimOp, tx } from './stock';

/**
 * ME DEBEN (v2.3): las personas que te deben plata.
 * - Lo que fías en mercancía es una venta con pago pendiente (o parcial): ya descuenta del inventario y cuenta en
 *   tus ventas; aquí se agrupa por persona.
 * - Fiados sueltos: le prestaste plata (sale de la caja) o ya te debía antes de usar la app (capital aportado).
 * - Abonos con su fecha: se reparten de lo más antiguo a lo más nuevo (o al que elijas).
 * - "No me va a pagar": el saldo se perdona y se registra como pérdida (baja la ganancia del día en que lo perdonas).
 */

export const CREDIT_KIND_LABEL: Record<Credit['kind'], string> = {
  loan: 'Le prestaste plata',
  opening: 'Ya te debía (antes de usar la app)',
};

export interface CreditInput {
  opId: string;
  customerId: ID;
  kind: Credit['kind'];
  amount: Money;
  date: ISODate;
  dueDate?: ISODate | null;
  notes?: string;
  inventoryId?: ID | null;
}

export async function createCredit(db: AppDB, input: CreditInput): Promise<Credit> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  if (input.kind !== 'loan' && input.kind !== 'opening') fail('invalid', 'Elige qué tipo de deuda es.', 'kind');
  const amount = assertMoney(input.amount, 'amount', 'Valor', false);
  const date = assertDate(input.date, 'date', 'Fecha');
  const dueDate = input.dueDate ? assertDate(input.dueDate, 'dueDate', 'Fecha en que te paga', { allowFuture: true }) : null;
  return tx(db, async () => {
    const existing = await db.credits.where('opId').equals(input.opId).first();
    if (existing) return existing;
    const c = await db.customers.get(input.customerId);
    if (!c) fail('not_found', 'Elige la persona que te debe.', 'customerId');
    const inventoryId = input.inventoryId ?? null;
    if (inventoryId) await requireInventory(db, inventoryId);
    const now = nowISO();
    const credit: Credit = {
      id: newId(),
      opId: input.opId,
      inventoryId,
      customerId: c.id,
      kind: input.kind,
      amount,
      date,
      dueDate,
      notes: cleanStr(input.notes ?? '', 300),
      forgiven: 0,
      forgivenAt: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await db.credits.add(credit);
    await logHistory(db, { entityType: 'credit', entityId: credit.id, inventoryId, action: 'create', summary: `${CREDIT_KIND_LABEL[credit.kind]}: ${c.name} · ${amount}` });
    return credit;
  });
}

/** Anula un fiado suelto registrado por error (solo si no tiene abonos). */
export async function voidCredit(db: AppDB, id: ID, reason: string): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Escribe el motivo.', 'reason');
  await tx(db, async () => {
    const c = await db.credits.get(id);
    if (!c) fail('not_found', 'Ese registro ya no existe.');
    if (c.status === 'voided') return;
    if ((await db.creditPayments.where('creditId').equals(id).count()) > 0) fail('has_payments', 'Tiene abonos registrados. Borra primero esos abonos.');
    await db.credits.update(id, { status: 'voided', updatedAt: nowISO() });
    await logHistory(db, { entityType: 'credit', entityId: id, inventoryId: c.inventoryId, action: 'void', summary: `Fiado anulado. Motivo: ${r}` });
  });
}

/** Borra un abono de un fiado suelto registrado por error. */
export async function voidCreditPayment(db: AppDB, paymentId: ID): Promise<void> {
  await tx(db, async () => {
    const p = await db.creditPayments.get(paymentId);
    if (!p) return;
    const c = await db.credits.get(p.creditId);
    if (c && c.forgiven > 0) fail('forgiven', 'Ese fiado tiene un saldo perdonado. Quita el perdón primero.');
    await db.creditPayments.delete(paymentId);
    await logHistory(db, { entityType: 'credit', entityId: p.creditId, inventoryId: p.inventoryId, action: 'payment_void', summary: `Abono borrado: ${p.amount}` });
  });
}

export type DebtRef = { type: 'sale' | 'credit'; id: ID };

export async function setDueDate(db: AppDB, ref: DebtRef, dueDate: ISODate | null): Promise<void> {
  const d = dueDate ? assertDate(dueDate, 'dueDate', 'Fecha en que te paga', { allowFuture: true }) : null;
  await tx(db, async () => {
    if (ref.type === 'sale') {
      if (!(await db.sales.get(ref.id))) fail('not_found', 'La venta no existe.');
      await db.sales.update(ref.id, { dueDate: d });
    } else {
      if (!(await db.credits.get(ref.id))) fail('not_found', 'Ese registro ya no existe.');
      await db.credits.update(ref.id, { dueDate: d, updatedAt: nowISO() });
    }
  });
}

async function salePending(db: AppDB, s: Sale) {
  const [lines, payments] = await Promise.all([db.saleLines.where('saleId').equals(s.id).toArray(), db.payments.where('saleId').equals(s.id).toArray()]);
  return computeSaleBalance(s, lines, payments);
}

/** "No me va a pagar": perdona lo que falta (se registra como pérdida en la fecha de hoy). */
export async function forgiveDebt(db: AppDB, ref: DebtRef, note = '', date = nowISO()): Promise<Money> {
  const at = assertDate(date, 'date', 'Fecha');
  return tx(db, async () => {
    if (ref.type === 'sale') {
      const s = await db.sales.get(ref.id);
      if (!s || s.status !== 'active') fail('not_found', 'La venta no existe o está anulada.');
      const b = await salePending(db, s);
      if (b.pending <= 0) fail('nothing_pending', 'Esa venta no tiene saldo pendiente.');
      const forgiven = (s.forgiven ?? 0) + b.pending;
      await db.sales.update(s.id, { forgiven, forgivenAt: at, forgiveNote: cleanStr(note, 200) });
      await logHistory(db, { entityType: 'sale', entityId: s.id, inventoryId: s.inventoryId, action: 'forgive', summary: `Saldo perdonado (pérdida): ${b.pending}` });
      return b.pending;
    }
    const c = await db.credits.get(ref.id);
    if (!c || c.status !== 'active') fail('not_found', 'Ese registro ya no existe.');
    const paid = (await db.creditPayments.where('creditId').equals(c.id).toArray()).reduce((a, p) => a + p.amount, 0);
    const pending = creditPending(c, paid);
    if (pending <= 0) fail('nothing_pending', 'No tiene saldo pendiente.');
    await db.credits.update(c.id, { forgiven: c.forgiven + pending, forgivenAt: at, updatedAt: nowISO() });
    await logHistory(db, { entityType: 'credit', entityId: c.id, inventoryId: c.inventoryId, action: 'forgive', summary: `Saldo perdonado (pérdida): ${pending}` });
    return pending;
  });
}

/** Deshace el perdón: vuelve a contar como plata que te deben. */
export async function unforgiveDebt(db: AppDB, ref: DebtRef): Promise<void> {
  await tx(db, async () => {
    if (ref.type === 'sale') {
      const s = await db.sales.get(ref.id);
      if (!s) fail('not_found', 'La venta no existe.');
      await db.sales.update(s.id, { forgiven: 0, forgivenAt: null, forgiveNote: '' });
      await logHistory(db, { entityType: 'sale', entityId: s.id, inventoryId: s.inventoryId, action: 'unforgive', summary: 'Se quitó el perdón del saldo' });
    } else {
      const c = await db.credits.get(ref.id);
      if (!c) fail('not_found', 'Ese registro ya no existe.');
      await db.credits.update(c.id, { forgiven: 0, forgivenAt: null, updatedAt: nowISO() });
      await logHistory(db, { entityType: 'credit', entityId: c.id, inventoryId: c.inventoryId, action: 'unforgive', summary: 'Se quitó el perdón del saldo' });
    }
  });
}

/* ======================= Lo que te debe cada persona ======================= */

export interface DebtItem {
  type: 'sale' | 'credit';
  id: ID;
  inventoryId: ID | null;
  date: ISODate;
  dueDate: ISODate | null;
  /** Qué fue: productos de la venta o el tipo de fiado. */
  concept: string;
  original: Money;
  paid: Money;
  forgiven: Money;
  pending: Money;
  overdue: boolean;
  kind?: Credit['kind'];
}

export interface Debtor {
  /** Id de la persona, o "sale:<id>" si la venta no tiene comprador. */
  key: string;
  customerId: ID | null;
  name: string;
  phone: string;
  pending: Money;
  overdue: Money;
  oldest: ISODate | null;
  nextDue: ISODate | null;
  lastPaymentAt: ISODate | null;
  items: DebtItem[];
}

export interface DebtPaymentRow {
  id: ID;
  type: 'sale' | 'credit';
  refId: ID;
  date: ISODate;
  amount: Money;
  method: string;
  notes: string;
}

export interface ReceivablesOverview {
  debtors: Debtor[];
  total: Money;
  overdue: Money;
  /** Abonos recibidos este mes (ventas fiadas y fiados sueltos). */
  collectedThisMonth: Money;
}

interface Loaded {
  sales: Sale[];
  customers: Map<ID, Customer>;
  items: DebtItem[];
  owner: Map<string, string>;
  history: (DebtPaymentRow & { ownerKey: string })[];
}

async function loadDebts(db: AppDB, inventoryIds: ID[] | null, now: Date, includeSettled = false): Promise<Loaded> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID | null) => (invSet ? !!id && invSet.has(id) : true);
  const [sales, lines, payments, products, customers, credits, creditPayments] = await Promise.all([
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.payments.toArray(),
    db.products.toArray(),
    db.customers.toArray(),
    db.credits.toArray(),
    db.creditPayments.toArray(),
  ]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const linesBy = new Map<ID, typeof lines>();
  for (const l of lines) linesBy.set(l.saleId, [...(linesBy.get(l.saleId) ?? []), l]);
  const paysBy = new Map<ID, typeof payments>();
  for (const p of payments) paysBy.set(p.saleId, [...(paysBy.get(p.saleId) ?? []), p]);
  const items: DebtItem[] = [];
  const owner = new Map<string, string>();
  const history: Loaded['history'] = [];
  for (const s of sales) {
    if (s.status !== 'active' || !inInv(s.inventoryId)) continue;
    const ls = linesBy.get(s.id) ?? [];
    const ps = paysBy.get(s.id) ?? [];
    const b = computeSaleBalance(s, ls, ps);
    // Solo ventas que alguna vez quedaron fiadas (algo se cobró después de la venta, o falta, o se perdonó)
    const fiada = b.pending > 0 || b.forgiven > 0 || ps.some((p) => p.kind === 'payment' && Date.parse(p.date) > Date.parse(s.date) + 60_000);
    if (!fiada || (!includeSettled && b.pending <= 0)) continue;
    const key = s.customerId ?? `sale:${s.id}`;
    owner.set(`sale:${s.id}`, key);
    const names = ls.map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ''}${pName.get(l.productId) ?? 'Producto'}`);
    items.push({
      type: 'sale',
      id: s.id,
      inventoryId: s.inventoryId,
      date: s.date,
      dueDate: s.dueDate ?? null,
      concept: names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''),
      original: b.effective,
      paid: b.collected,
      forgiven: b.forgiven,
      pending: b.pending,
      overdue: b.pending > 0 && !!s.dueDate && s.dueDate < today,
    });
    for (const p of ps) if (p.kind === 'payment') history.push({ id: p.id, type: 'sale', refId: s.id, date: p.date, amount: p.amount, method: p.method, notes: p.notes, ownerKey: key });
  }
  const cpBy = new Map<ID, CreditPayment[]>();
  for (const p of creditPayments) cpBy.set(p.creditId, [...(cpBy.get(p.creditId) ?? []), p]);
  for (const c of credits) {
    if (c.status !== 'active' || !inInv(c.inventoryId)) continue;
    const ps = cpBy.get(c.id) ?? [];
    const paid = ps.reduce((a, p) => a + p.amount, 0);
    const pending = creditPending(c, paid);
    if (!includeSettled && pending <= 0) continue;
    owner.set(`credit:${c.id}`, c.customerId);
    items.push({
      type: 'credit',
      id: c.id,
      inventoryId: c.inventoryId,
      date: c.date,
      dueDate: c.dueDate,
      concept: `${CREDIT_KIND_LABEL[c.kind]}${c.notes ? ` · ${c.notes}` : ''}`,
      original: c.amount,
      paid,
      forgiven: c.forgiven,
      pending,
      overdue: pending > 0 && !!c.dueDate && c.dueDate < today,
      kind: c.kind,
    });
    for (const p of ps) history.push({ id: p.id, type: 'credit', refId: c.id, date: p.date, amount: p.amount, method: p.method, notes: p.notes, ownerKey: c.customerId });
  }
  return { sales, customers: new Map(customers.map((c) => [c.id, c])), items, owner, history };
}

function groupDebtors(l: Loaded): Debtor[] {
  const by = new Map<string, Debtor>();
  for (const it of l.items) {
    const key = l.owner.get(`${it.type}:${it.id}`)!;
    let d = by.get(key);
    if (!d) {
      const c = key.startsWith('sale:') ? undefined : l.customers.get(key);
      d = { key, customerId: c?.id ?? null, name: c?.name ?? 'Venta sin nombre', phone: c?.phone ?? '', pending: 0, overdue: 0, oldest: null, nextDue: null, lastPaymentAt: null, items: [] };
      by.set(key, d);
    }
    d.items.push(it);
    d.pending += it.pending;
    if (it.overdue) d.overdue += it.pending;
    if (it.pending > 0 && (!d.oldest || it.date < d.oldest)) d.oldest = it.date;
    if (it.pending > 0 && it.dueDate && (!d.nextDue || it.dueDate < d.nextDue)) d.nextDue = it.dueDate;
  }
  for (const h of l.history) {
    const d = by.get(h.ownerKey);
    if (d && (!d.lastPaymentAt || h.date > d.lastPaymentAt)) d.lastPaymentAt = h.date;
  }
  for (const d of by.values()) d.items.sort((a, b) => (a.date < b.date ? -1 : 1));
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);
}

export async function getReceivablesOverview(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<ReceivablesOverview> {
  const l = await loadDebts(db, inventoryIds, now);
  const debtors = groupDebtors(l).filter((d) => d.pending > 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const full = await loadDebts(db, inventoryIds, now, true);
  return {
    debtors,
    total: debtors.reduce((a, d) => a + d.pending, 0),
    overdue: debtors.reduce((a, d) => a + d.overdue, 0),
    collectedThisMonth: full.history.filter((h) => h.date >= monthStart).reduce((a, h) => a + h.amount, 0),
  };
}

/** Todo lo de una persona (incluye lo ya pagado) y el historial de abonos. */
export async function getDebtor(db: AppDB, key: string, now = new Date()): Promise<{ debtor: Debtor | null; history: DebtPaymentRow[] }> {
  const l = await loadDebts(db, null, now, true);
  const debtor = groupDebtors(l).find((d) => d.key === key) ?? null;
  const history = l.history.filter((h) => h.ownerKey === key).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { debtor, history };
}

export interface DebtorPaymentInput {
  opId: string;
  /** Persona (id) o "sale:<id>" para una venta sin comprador. */
  key: string;
  amount: Money;
  date: ISODate;
  method?: string;
  notes?: string;
  /** Abonar solo a esto (si no, de lo más antiguo a lo más nuevo). */
  target?: DebtRef | null;
}

/** Registra un abono de una persona y lo reparte entre lo que debe. Devuelve cómo se repartió. */
export async function payDebtor(db: AppDB, input: DebtorPaymentInput): Promise<{ applied: { ref: DebtRef; amount: Money }[] } | null> {
  const amount = assertMoney(input.amount, 'amount', 'Valor del abono', false);
  const date = assertDate(input.date, 'date', 'Fecha del abono');
  const method = cleanStr(input.method ?? '', 40);
  const notes = cleanStr(input.notes ?? '', 300);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const l = await loadDebts(db, null, new Date());
    let open = l.items.filter((it) => l.owner.get(`${it.type}:${it.id}`) === input.key && it.pending > 0);
    if (input.target) open = open.filter((it) => it.type === input.target!.type && it.id === input.target!.id);
    if (!open.length) fail('nothing_pending', 'No hay saldo pendiente para abonar.');
    const eligible = open.filter((it) => Date.parse(it.date) <= Date.parse(date) + 60_000).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!eligible.length) fail('incoherent_date', 'La fecha del abono es anterior a lo que te debe.', 'date');
    const total = eligible.reduce((a, it) => a + it.pending, 0);
    if (amount > total) fail('overpayment', `El abono es mayor que lo que te debe (${total}).`, 'amount');
    let rest = amount;
    const applied: { ref: DebtRef; amount: Money }[] = [];
    for (const it of eligible) {
      if (rest <= 0) break;
      const part = Math.min(rest, it.pending);
      rest -= part;
      if (it.type === 'sale') {
        const s = l.sales.find((x) => x.id === it.id)!;
        await db.payments.add({ id: newId(), saleId: s.id, inventoryId: s.inventoryId, kind: 'payment', date, amount: part, method, notes: notes || 'Abono', createdAt: nowISO() });
        await addPaymentFeeExpense(db, s, { date, method, amount: part, fee: undefined });
        await logHistory(db, { entityType: 'sale', entityId: s.id, inventoryId: s.inventoryId, action: 'payment', summary: `Abono registrado: ${part}` });
      } else {
        const c = (await db.credits.get(it.id))!;
        await db.creditPayments.add({ id: newId(), opId: `${input.opId}:${it.id}`, creditId: c.id, customerId: c.customerId, inventoryId: c.inventoryId, date, amount: part, method, notes, createdAt: nowISO() });
        await logHistory(db, { entityType: 'credit', entityId: c.id, inventoryId: c.inventoryId, action: 'payment', summary: `Abono registrado: ${part}` });
      }
      applied.push({ ref: { type: it.type, id: it.id }, amount: part });
    }
    return { applied };
  });
}

/** Mensaje de cobro amable (para copiar o compartir). */
/** Tono del mensaje de cobro: amable (recordatorio), fecha (pide o recuerda la fecha) o firme (ya se demoró). */
export type CollectionTone = 'amable' | 'fecha' | 'firme';
export const COLLECTION_TONE_LABEL: Record<CollectionTone, string> = { amable: 'Amable', fecha: 'Fecha de pago', firme: 'Más firme' };

export function collectionMessage(
  d: Pick<Debtor, 'name' | 'pending' | 'nextDue'> & Partial<Pick<Debtor, 'oldest' | 'items'>>,
  business: string,
  fmt: (v: number) => string,
  fmtDate: (iso: string) => string,
  opts: { tone?: CollectionTone; detail?: boolean } = {},
): string {
  const first = d.name.trim().split(/\s+/)[0] || 'Hola';
  const from = business ? ` de ${business}` : '';
  const tone = opts.tone ?? 'amable';
  let msg: string;
  if (tone === 'fecha')
    msg = d.nextDue
      ? `Hola ${first}, ¿cómo estás? Te escribo${from} para recordarte que quedamos para el ${fmtDate(d.nextDue)} con el pago de ${fmt(d.pending)}. ¿Me confirmas si ese día puedes? ¡Gracias!`
      : `Hola ${first}, ¿cómo estás? Te escribo${from} por el saldo pendiente de ${fmt(d.pending)}. ¿Para qué fecha me puedes abonar? Así lo anoto. ¡Gracias!`;
  else if (tone === 'firme')
    msg = `Hola ${first}. Te escribo${from} porque tienes un saldo pendiente de ${fmt(d.pending)}${d.oldest ? ` desde el ${fmtDate(d.oldest)}` : ''}. Necesito que me abones lo más pronto posible. ¿Me dices hoy cuándo me pagas? Gracias.`;
  else msg = `Hola ${first}, ¿cómo estás? Te escribo${from} para recordarte el saldo pendiente de ${fmt(d.pending)}${d.nextDue ? ` (quedamos para el ${fmtDate(d.nextDue)})` : ''}. ¿Me confirmas cuándo puedes abonar? ¡Gracias!`;
  const open = (d.items ?? []).filter((i) => i.pending > 0);
  if (opts.detail && open.length) msg += `\n\nDetalle:\n${open.map((i) => `• ${i.concept} (${fmtDate(i.date)}): ${fmt(i.pending)}`).join('\n')}`;
  return msg;
}

/* ---------------- WhatsApp ---------------- */

/**
 * Número para WhatsApp (solo dígitos, con indicativo del país). Acepta "300 123 4567", "+57 300…", "0057…".
 * Un número de 10 dígitos sin indicativo se toma como de Colombia (57). Devuelve null si no parece un número válido.
 */
export function whatsappNumber(raw: string, country = '57'): string | null {
  const t = (raw ?? '').trim();
  let d = t.replace(/\D/g, '');
  if (!d) return null;
  if (!t.startsWith('+') && d.startsWith('00')) d = d.slice(2);
  else if (!t.startsWith('+') && d.length === 10) d = country + d;
  return d.length >= 11 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

/** Enlace que abre el chat de WhatsApp de esa persona con el mensaje escrito (no se envía solo: tú decides). */
export function whatsappLink(number: string, text: string): string {
  const t = text.trim();
  return `https://wa.me/${number}${t ? `?text=${encodeURIComponent(t)}` : ''}`;
}
