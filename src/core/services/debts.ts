import type { AppDB } from '../db';
import type { Debt, DebtKind, DebtPayment, ID, ISODate, Money, Purchase } from '../types';
import { assertDate, assertMoney, cleanStr, fail, newId, nowISO } from '../util';
import { logHistory, requireInventory } from './base';
import { tx } from './stock';

/**
 * DEUDAS Y PRÉSTAMOS (cuentas por pagar).
 * - Una deuda es dinero que el negocio debe: tarjeta de crédito, crédito del proveedor, préstamo de un tercero.
 * - Si el dinero prestado entró a la caja (préstamo en efectivo) la caja sube; si la deuda pagó directamente
 *   una compra (tarjeta, crédito del proveedor), la compra sale de la caja y la deuda la compensa: en ambos
 *   casos el cálculo de caja es: + capital de la deuda − compras − abonos a capital.
 * - Los abonos reducen la deuda. Los intereses o cuotas de manejo NO reducen la deuda: son un gasto financiero
 *   (gasto operativo) y restan de la ganancia.
 */

export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  credit_card: 'Tarjeta de crédito',
  supplier: 'Crédito del proveedor',
  loan: 'Préstamo de un tercero',
  other: 'Otra deuda',
};

export const DEBT_STATUS_LABEL: Record<Debt['status'], string> = {
  open: 'Pendiente',
  paid: 'Pagada',
  voided: 'Anulada',
};

export const INTEREST_CATEGORY = 'Intereses y costos financieros';

const KINDS: DebtKind[] = ['credit_card', 'supplier', 'loan', 'other'];

export interface DebtBalance {
  principal: Money;
  paidPrincipal: Money;
  paidInterest: Money;
  outstanding: Money;
  payments: number;
  lastPaymentAt: ISODate | null;
}

export function computeDebtBalance(debt: Debt, payments: DebtPayment[]): DebtBalance {
  const ps = payments.filter((p) => p.debtId === debt.id);
  const paidPrincipal = ps.reduce((a, p) => a + p.principal, 0);
  const paidInterest = ps.reduce((a, p) => a + p.interest, 0);
  const last = ps.map((p) => p.date).sort().at(-1) ?? null;
  return {
    principal: debt.principal,
    paidPrincipal,
    paidInterest,
    outstanding: debt.status === 'voided' ? 0 : Math.max(0, debt.principal - paidPrincipal),
    payments: ps.length,
    lastPaymentAt: last,
  };
}

function checkKind(kind: unknown): DebtKind {
  if (!KINDS.includes(kind as DebtKind)) fail('invalid', 'Elige el tipo de deuda.', 'kind');
  return kind as DebtKind;
}

function defaultCreditor(kind: DebtKind, creditor: string): string {
  const c = cleanStr(creditor, 80);
  if (c) return c;
  if (kind === 'credit_card') return 'Tarjeta de crédito';
  return fail('required', '¿A quién le debes? Escribe el nombre del acreedor.', 'creditor');
}

export interface DebtInput {
  opId: string;
  kind: DebtKind;
  creditor: string;
  description?: string;
  date: ISODate;
  principal: Money;
  inventoryId?: ID | null;
  notes?: string;
}

/** Registra una deuda cuyo dinero ENTRÓ a la caja (préstamo en efectivo, avance de tarjeta...). */
export async function createDebt(db: AppDB, input: DebtInput): Promise<Debt> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  const kind = checkKind(input.kind);
  const creditor = defaultCreditor(kind, input.creditor);
  const date = assertDate(input.date, 'date', 'Fecha de la deuda');
  const principal = assertMoney(input.principal, 'principal', 'Valor de la deuda', false);
  return tx(db, async () => {
    const existing = await db.debts.where('opId').equals(input.opId).first();
    if (existing) return existing;
    const inventoryId = input.inventoryId ?? null;
    if (inventoryId) await requireInventory(db, inventoryId);
    const now = nowISO();
    const d: Debt = {
      id: newId(),
      opId: input.opId,
      inventoryId,
      kind,
      creditor,
      description: cleanStr(input.description ?? '', 200),
      date,
      principal,
      cashIn: true,
      purchaseId: null,
      status: 'open',
      notes: cleanStr(input.notes ?? '', 1000),
      createdAt: now,
      updatedAt: now,
    };
    await db.debts.add(d);
    await logHistory(db, {
      entityType: 'debt',
      entityId: d.id,
      inventoryId,
      action: 'create',
      summary: `Deuda registrada: ${DEBT_KIND_LABEL[kind]} · ${creditor} · ${principal}`,
    });
    return d;
  });
}

export interface PurchaseFunding {
  kind: DebtKind;
  creditor: string;
  /** Parte de la compra que quedó como deuda (por defecto, el total). */
  amount?: Money;
  notes?: string;
}

/** Uso interno de createPurchase (dentro de su transacción): la compra se pagó con deuda. */
export async function insertPurchaseDebt(db: AppDB, purchase: Purchase, funding: PurchaseFunding): Promise<Debt> {
  const kind = checkKind(funding.kind);
  const creditor = defaultCreditor(kind, funding.creditor);
  const amount = funding.amount === undefined ? purchase.total : assertMoney(funding.amount, 'funding.amount', 'Valor financiado', false);
  if (amount > purchase.total) fail('invalid', 'El valor financiado no puede ser mayor que el total de la compra.', 'funding.amount');
  if (amount <= 0) fail('invalid', 'El valor financiado debe ser mayor que cero.', 'funding.amount');
  const now = nowISO();
  const d: Debt = {
    id: newId(),
    opId: `purchase:${purchase.opId}`,
    inventoryId: purchase.inventoryId,
    kind,
    creditor,
    description: 'Compra de mercancía',
    date: purchase.date,
    principal: amount,
    cashIn: false,
    purchaseId: purchase.id,
    status: 'open',
    notes: cleanStr(funding.notes ?? '', 500),
    createdAt: now,
    updatedAt: now,
  };
  await db.debts.add(d);
  await logHistory(db, {
    entityType: 'debt',
    entityId: d.id,
    inventoryId: purchase.inventoryId,
    action: 'create',
    summary: `Compra pagada con deuda: ${DEBT_KIND_LABEL[kind]} · ${creditor} · ${amount}`,
  });
  return d;
}

export interface DebtPaymentInput {
  opId: string;
  debtId: ID;
  date: ISODate;
  /** Abono a capital (reduce la deuda). */
  principal: Money;
  /** Intereses o cuota de manejo (gasto financiero). */
  interest?: Money;
  notes?: string;
}

export async function payDebt(db: AppDB, input: DebtPaymentInput): Promise<DebtPayment> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  const date = assertDate(input.date, 'date', 'Fecha del abono');
  const principal = assertMoney(input.principal, 'principal', 'Abono a capital');
  const interest = assertMoney(input.interest ?? 0, 'interest', 'Intereses');
  if (principal + interest <= 0) fail('required', 'Escribe el valor del abono o de los intereses.', 'principal');
  return tx(db, async () => {
    const existing = await db.debtPayments.where('opId').equals(input.opId).first();
    if (existing) return existing;
    const debt = await db.debts.get(input.debtId);
    if (!debt) fail('not_found', 'La deuda no existe.');
    if (debt.status === 'voided') fail('voided', 'La deuda está anulada.');
    if (debt.status === 'paid') fail('paid', 'Esta deuda ya está pagada por completo.');
    if (Date.parse(date) < Date.parse(debt.date) - 60_000)
      fail('incoherent_date', 'La fecha del abono no puede ser anterior a la deuda.', 'date');
    const pays = await db.debtPayments.where('debtId').equals(debt.id).toArray();
    const bal = computeDebtBalance(debt, pays);
    if (principal > bal.outstanding) fail('overpayment', `El abono supera lo que debes (${bal.outstanding}).`, 'principal');
    const payment: DebtPayment = {
      id: newId(),
      opId: input.opId,
      debtId: debt.id,
      inventoryId: debt.inventoryId,
      date,
      principal,
      interest,
      expenseId: null,
      notes: cleanStr(input.notes ?? '', 300),
      createdAt: nowISO(),
    };
    if (interest > 0) {
      const expenseId = newId();
      await db.expenses.add({
        id: expenseId,
        date,
        amount: interest,
        category: INTEREST_CATEGORY,
        notes: `${DEBT_KIND_LABEL[debt.kind]} · ${debt.creditor}`,
        treatment: 'operating',
        inventoryId: debt.inventoryId,
        saleId: null,
        purchaseId: null,
        unitId: null,
        productId: null,
        claimId: null,
        repairId: null,
        debtId: debt.id,
        status: 'active',
        createdAt: nowISO(),
      });
      payment.expenseId = expenseId;
    }
    await db.debtPayments.add(payment);
    if (bal.outstanding - principal === 0) await db.debts.update(debt.id, { status: 'paid', updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'debt',
      entityId: debt.id,
      inventoryId: debt.inventoryId,
      action: 'payment',
      summary: `Abono a deuda (${debt.creditor}): capital ${principal}${interest ? `, intereses ${interest}` : ''}`,
    });
    return payment;
  });
}

/** Deshace un abono registrado por error (también anula su gasto de intereses). */
export async function voidDebtPayment(db: AppDB, paymentId: ID): Promise<void> {
  await tx(db, async () => {
    const p = await db.debtPayments.get(paymentId);
    if (!p) return;
    const debt = await db.debts.get(p.debtId);
    if (p.expenseId) await db.expenses.update(p.expenseId, { status: 'voided' });
    await db.debtPayments.delete(p.id);
    if (debt && debt.status === 'paid') await db.debts.update(debt.id, { status: 'open', updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'debt',
      entityId: p.debtId,
      inventoryId: p.inventoryId,
      action: 'payment_void',
      summary: `Abono anulado: capital ${p.principal}${p.interest ? `, intereses ${p.interest}` : ''}`,
    });
  });
}

/** Anula una deuda registrada por error. Si viene de una compra, se anula anulando la compra. */
export async function voidDebt(db: AppDB, debtId: ID, reason: string): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Escribe el motivo de la anulación.', 'reason');
  await tx(db, async () => {
    const d = await db.debts.get(debtId);
    if (!d) fail('not_found', 'La deuda no existe.');
    if (d.status === 'voided') return;
    if (d.purchaseId) fail('from_purchase', 'Esta deuda viene de una compra: para quitarla, anula la compra.');
    if ((await db.debtPayments.where('debtId').equals(d.id).count()) > 0)
      fail('has_payments', 'La deuda tiene abonos. Anula primero los abonos.');
    await db.debts.update(d.id, { status: 'voided', notes: [d.notes, `Anulada: ${r}`].filter(Boolean).join('\n'), updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'debt',
      entityId: d.id,
      inventoryId: d.inventoryId,
      action: 'void',
      summary: `Deuda anulada (${d.creditor}). Motivo: ${r}`,
    });
  });
}

export async function updateDebtInfo(
  db: AppDB,
  debtId: ID,
  patch: { creditor?: string; description?: string; notes?: string },
): Promise<void> {
  await tx(db, async () => {
    const d = await db.debts.get(debtId);
    if (!d) fail('not_found', 'La deuda no existe.');
    const upd: Partial<Debt> = { updatedAt: nowISO() };
    if (patch.creditor !== undefined) upd.creditor = defaultCreditor(d.kind, patch.creditor);
    if (patch.description !== undefined) upd.description = cleanStr(patch.description, 200);
    if (patch.notes !== undefined) upd.notes = cleanStr(patch.notes, 1000);
    await db.debts.update(d.id, upd);
  });
}

export interface DebtView extends Debt {
  balance: DebtBalance;
}

/** Deudas (más recientes primero). `inventoryIds` null = todas; si se filtra, se excluyen las generales. */
export async function listDebts(db: AppDB, inventoryIds: ID[] | null): Promise<DebtView[]> {
  const set = inventoryIds ? new Set(inventoryIds) : null;
  const [debts, pays] = await Promise.all([db.debts.toArray(), db.debtPayments.toArray()]);
  return debts
    .filter((d) => (set ? d.inventoryId !== null && set.has(d.inventoryId) : true))
    .map((d) => ({ ...d, balance: computeDebtBalance(d, pays) }))
    .sort((a, b) => (a.status === b.status ? b.date.localeCompare(a.date) : a.status === 'open' ? -1 : b.status === 'open' ? 1 : 0));
}
