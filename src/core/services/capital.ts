import type { AppDB } from '../db';
import type {
  CapitalKind,
  Credit,
  CreditPayment,
  CapitalMovement,
  Debt,
  DebtPayment,
  Expense,
  Goal,
  ID,
  ISODate,
  Money,
  Movement,
  Payment,
  Product,
  Purchase,
  Sale,
  SaleReturn,
  Unit,
} from '../types';
import { assertDate, cleanStr, daysBetween, fail, newId, nowISO } from '../util';
import { logHistory, requireInventory } from './base';
import { getFinancialSummary, getUnsoldAging, type Period } from './reports';
import { tx } from './stock';

/**
 * CAPITAL DEL NEGOCIO (v2)
 *
 * Valor del negocio = caja + inventario a costo + cuentas por cobrar + préstamos que te hiciste (lo que le debes al negocio)
 *                     − deudas − saldos a favor de clientes.
 * Capital neto aportado = aportes − retiros + mercancía que ya tenías al empezar (stock inicial a costo).
 * Crecimiento = valor del negocio − capital neto aportado.
 *   (= ganancia neta acumulada + ajustes de caja + mercancía encontrada en ajustes de inventario)
 *
 * Caja calculada = aportes − retiros ± ajustes de caja − préstamos a ti + devoluciones de préstamos
 *                  + cobros − reembolsos − compras − gastos + deudas recibidas − abonos a capital de deudas.
 * (Una compra pagada con deuda sale de la caja y la deuda entra: el efecto neto es solo la parte pagada de contado.)
 *
 * Las ventas y compras anuladas no cuentan, como en el resto de la app.
 */

export const CAPITAL_KIND_LABEL: Record<CapitalKind, string> = {
  contribution: 'Aporte de capital',
  withdrawal: 'Retiro',
  cash_adjustment: 'Ajuste de caja',
  owner_loan: 'Préstamo a ti',
  owner_loan_repayment: 'Devolución de tu préstamo',
};

export const CAPITAL_KIND_HELP: Record<CapitalKind, string> = {
  contribution: 'Dinero que metes al negocio (por ejemplo, el dinero con el que empiezas).',
  withdrawal: 'Dinero que sacas del negocio para ti y no vas a devolver (ganancias o capital).',
  cash_adjustment: 'Corrige la caja calculada para que coincida con el dinero que de verdad tienes. Positivo = sobra; negativo = falta.',
  owner_loan: 'Dinero de la inversión que tomas para algo tuyo o una emergencia y piensas devolver.',
  owner_loan_repayment: 'Lo que devuelves al negocio de un préstamo que te hiciste.',
};

const KINDS: CapitalKind[] = ['contribution', 'withdrawal', 'cash_adjustment', 'owner_loan', 'owner_loan_repayment'];

export interface CapitalInput {
  opId: string;
  kind: CapitalKind;
  date: ISODate;
  /** Pesos enteros positivos. En ajustes de caja: positivo = sobra dinero, negativo = falta. */
  amount: Money;
  inventoryId?: ID | null;
  notes?: string;
  /** v2.1: gasto personal (solo retiros y préstamos a ti). */
  personal?: boolean;
  tag?: string;
}

function ownerLoanOutstanding(list: CapitalMovement[], inventoryId: ID | null): Money {
  let v = 0;
  for (const c of list) {
    if (c.status !== 'active' || (c.inventoryId ?? null) !== inventoryId) continue;
    if (c.kind === 'owner_loan') v += c.amount;
    if (c.kind === 'owner_loan_repayment') v -= c.amount;
  }
  return v;
}

export async function addCapitalMovement(db: AppDB, input: CapitalInput): Promise<CapitalMovement> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  if (!KINDS.includes(input.kind)) fail('invalid', 'Elige el tipo de movimiento.', 'kind');
  const date = assertDate(input.date, 'date', 'Fecha');
  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount)) fail('invalid', 'Escribe un valor en pesos enteros.', 'amount');
  if (input.kind === 'cash_adjustment') {
    if (amount === 0) fail('invalid', 'El ajuste no puede ser cero.', 'amount');
  } else if (amount <= 0) fail('invalid', 'El valor debe ser mayor que cero.', 'amount');
  if (Math.abs(amount) > 1e13) fail('invalid', 'El valor es demasiado grande.', 'amount');
  return tx(db, async () => {
    const existing = await db.capital.where('opId').equals(input.opId).first();
    if (existing) return existing;
    const inventoryId = input.inventoryId ?? null;
    if (inventoryId) await requireInventory(db, inventoryId);
    if (input.kind === 'owner_loan_repayment') {
      const out = ownerLoanOutstanding(await db.capital.toArray(), inventoryId);
      if (out <= 0) fail('no_loan', 'No tienes préstamos pendientes con el negocio en este inventario.', 'amount');
      if (amount > out) fail('too_much', `Solo debes ${out} al negocio.`, 'amount');
    }
    const c: CapitalMovement = {
      id: newId(),
      opId: input.opId,
      inventoryId,
      kind: input.kind,
      date,
      amount,
      notes: cleanStr(input.notes ?? '', 500),
      ...(input.personal && (input.kind === 'withdrawal' || input.kind === 'owner_loan') ? { personal: true, tag: cleanStr(input.tag ?? '', 40) } : {}),
      status: 'active',
      createdAt: nowISO(),
    };
    await db.capital.add(c);
    await logHistory(db, {
      entityType: 'capital',
      entityId: c.id,
      inventoryId,
      action: 'create',
      summary: `${c.personal ? `Gasto personal${c.tag ? ` (${c.tag})` : ''} · ` : ''}${CAPITAL_KIND_LABEL[c.kind]}: ${amount}`,
    });
    return c;
  });
}

/** Anula un movimiento de capital registrado por error (se conserva marcado como anulado). */
export async function voidCapitalMovement(db: AppDB, id: ID, reason: string): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Escribe el motivo de la anulación.', 'reason');
  await tx(db, async () => {
    const c = await db.capital.get(id);
    if (!c) fail('not_found', 'El movimiento no existe.');
    if (c.status === 'voided') return;
    if (c.kind === 'owner_loan') {
      const all = await db.capital.toArray();
      const after = ownerLoanOutstanding(all.filter((x) => x.id !== id), c.inventoryId ?? null);
      if (after < 0) fail('has_repayments', 'Ya devolviste parte de este préstamo. Anula primero esas devoluciones.');
    }
    await db.capital.update(id, { status: 'voided', notes: [c.notes, `Anulado: ${r}`].filter(Boolean).join('\n') });
    await logHistory(db, {
      entityType: 'capital',
      entityId: id,
      inventoryId: c.inventoryId,
      action: 'void',
      summary: `${CAPITAL_KIND_LABEL[c.kind]} anulado (${c.amount}). Motivo: ${r}`,
    });
  });
}

/* ================= Cálculo ================= */

export interface CapitalData {
  capital: CapitalMovement[];
  purchases: Purchase[];
  sales: Sale[];
  payments: Payment[];
  returns: SaleReturn[];
  expenses: Expense[];
  movements: Movement[];
  debts: Debt[];
  debtPayments: DebtPayment[];
  units: Unit[];
  products: Product[];
  /** v2.3: fiados sueltos (me deben) y sus abonos. */
  credits: Credit[];
  creditPayments: CreditPayment[];
}

export async function loadCapitalData(db: AppDB): Promise<CapitalData> {
  return db.transaction(
    'r',
    [db.capital, db.purchases, db.sales, db.payments, db.returns, db.expenses, db.movements, db.debts, db.debtPayments, db.units, db.products, db.credits, db.creditPayments],
    async () => {
      const [capital, purchases, sales, payments, returns, expenses, movements, debts, debtPayments, units, products, credits, creditPayments] = await Promise.all([
        db.capital.toArray(),
        db.purchases.toArray(),
        db.sales.toArray(),
        db.payments.toArray(),
        db.returns.toArray(),
        db.expenses.toArray(),
        db.movements.toArray(),
        db.debts.toArray(),
        db.debtPayments.toArray(),
        db.units.toArray(),
        db.products.toArray(),
        db.credits.toArray(),
        db.creditPayments.toArray(),
      ]);
      return { capital, purchases, sales, payments, returns, expenses, movements, debts, debtPayments, units, products, credits, creditPayments };
    },
  );
}

export interface CashFlow {
  contributions: Money;
  withdrawals: Money;
  adjustments: Money;
  ownerLoansOut: Money;
  ownerLoansBack: Money;
  collected: Money;
  refunded: Money;
  purchases: Money;
  expenses: Money;
  debtIn: Money;
  debtPrincipalPaid: Money;
  /** v2.3: plata que prestaste (fiados de plata) y abonos recibidos de fiados sueltos. */
  lent: Money;
  creditCollected: Money;
}

export interface CapitalSnapshot {
  /** Fecha de corte (exclusiva) o null = todo hasta hoy. */
  at: ISODate | null;
  cash: Money;
  cashFlow: CashFlow;
  /** Inventario a costo conocido (disponible + en revisión + dañado). */
  inventory: Money;
  inventoryUnknownUnits: number;
  receivables: Money;
  customerCredit: Money;
  /** Lo que te prestaste del negocio y aún no devuelves. */
  ownerLoans: Money;
  debts: Money;
  businessValue: Money;
  contributions: Money;
  withdrawals: Money;
  goodsContributed: Money;
  netCapital: Money;
  growth: Money;
  /** Crecimiento ÷ capital neto aportado (null si no hay capital aportado). */
  growthPct: number | null;
  cashAdjustments: Money;
  /** Mercancía encontrada en ajustes de inventario (entra sin costo de caja). */
  foundStock: Money;
  /** v2.3: lo que ya te debían antes de usar la app (cuenta como capital aportado). */
  receivablesContributed: Money;
}

type Scope = (id: ID | null | undefined) => boolean;

export function scopeFor(inventoryIds: ID[] | null): Scope {
  if (!inventoryIds) return () => true;
  const set = new Set(inventoryIds);
  return (id) => !!id && set.has(id);
}

/** Inventario a costo según las tablas actuales (lo mismo que se ve en el resto de la app). */
export function currentInventoryValue(data: Pick<CapitalData, 'units' | 'products'>, inScope: Scope) {
  let value = 0;
  let unknownUnits = 0;
  let available = 0;
  let other = 0;
  for (const u of data.units) {
    if (!inScope(u.inventoryId)) continue;
    if (u.status !== 'available' && u.status !== 'in_review' && u.status !== 'damaged') continue;
    const v = (u.baseCost ?? 0) + u.extraCost;
    value += v;
    if (u.status === 'available') available += v;
    else other += v;
    if (u.baseCost === null) unknownUnits++;
  }
  for (const p of data.products) {
    if (p.tracking !== 'quantity' || !inScope(p.inventoryId)) continue;
    value += p.stockValue;
    available += p.stockValue;
    unknownUnits += p.unknownCostQty;
  }
  return { value, unknownUnits, available, other };
}

/**
 * Calcula el capital con todos los hechos ANTERIORES a `end` (exclusivo). Con `end` = null usa todo.
 * El inventario se reconstruye con los movimientos (sirve para fechas pasadas).
 */
export function computeCapitalAt(data: CapitalData, end: ISODate | null, inScope: Scope): CapitalSnapshot {
  const before = (d: ISODate) => end === null || d < end;
  const activeSales = new Map(data.sales.filter((s) => s.status === 'active').map((s) => [s.id, s]));
  const voidedSales = new Set(data.sales.filter((s) => s.status === 'voided').map((s) => s.id));
  const voidedPurchases = new Set(data.purchases.filter((p) => p.status === 'voided').map((p) => p.id));
  const voidedDebts = new Set(data.debts.filter((d) => d.status === 'voided').map((d) => d.id));

  const cf: CashFlow = {
    contributions: 0,
    withdrawals: 0,
    adjustments: 0,
    ownerLoansOut: 0,
    ownerLoansBack: 0,
    collected: 0,
    refunded: 0,
    purchases: 0,
    expenses: 0,
    debtIn: 0,
    debtPrincipalPaid: 0,
    lent: 0,
    creditCollected: 0,
  };
  for (const c of data.capital) {
    if (c.status !== 'active' || !inScope(c.inventoryId) || !before(c.date)) continue;
    if (c.kind === 'contribution') cf.contributions += c.amount;
    else if (c.kind === 'withdrawal') cf.withdrawals += c.amount;
    else if (c.kind === 'cash_adjustment') cf.adjustments += c.amount;
    else if (c.kind === 'owner_loan') cf.ownerLoansOut += c.amount;
    else if (c.kind === 'owner_loan_repayment') cf.ownerLoansBack += c.amount;
  }
  // Cobros y reembolsos por venta (para caja y cuentas por cobrar)
  const collectedBySale = new Map<ID, Money>();
  for (const p of data.payments) {
    if (!activeSales.has(p.saleId) || !inScope(p.inventoryId) || !before(p.date)) continue;
    if (p.kind === 'payment') cf.collected += p.amount;
    else cf.refunded += p.amount;
    collectedBySale.set(p.saleId, (collectedBySale.get(p.saleId) ?? 0) + (p.kind === 'payment' ? p.amount : -p.amount));
  }
  for (const p of data.purchases) if (p.status === 'active' && inScope(p.inventoryId) && before(p.date)) cf.purchases += p.total;
  for (const e of data.expenses) if (e.status === 'active' && inScope(e.inventoryId) && before(e.date)) cf.expenses += e.amount;
  let debts = 0;
  for (const d of data.debts) {
    if (d.status === 'voided' || !inScope(d.inventoryId) || !before(d.date)) continue;
    cf.debtIn += d.principal;
    debts += d.principal;
  }
  for (const p of data.debtPayments) {
    if (voidedDebts.has(p.debtId) || !inScope(p.inventoryId) || !before(p.date)) continue;
    cf.debtPrincipalPaid += p.principal;
    debts -= p.principal;
  }
  // Fiados sueltos (v2.3)
  const activeCredits = new Map((data.credits ?? []).filter((c) => c.status === 'active' && inScope(c.inventoryId)).map((c) => [c.id, c]));
  let creditReceivables = 0;
  let receivablesContributed = 0;
  for (const c of activeCredits.values()) {
    if (!before(c.date)) continue;
    if (c.kind === 'loan') cf.lent += c.amount;
    else receivablesContributed += c.amount;
    creditReceivables += c.amount - (c.forgivenAt && before(c.forgivenAt) ? c.forgiven : 0);
  }
  for (const p of data.creditPayments ?? []) {
    if (!activeCredits.has(p.creditId) || !before(p.date) || !before(activeCredits.get(p.creditId)!.date)) continue;
    cf.creditCollected += p.amount;
    creditReceivables -= p.amount;
  }
  const cash =
    cf.contributions -
    cf.withdrawals +
    cf.adjustments -
    cf.ownerLoansOut +
    cf.ownerLoansBack +
    cf.collected -
    cf.refunded -
    cf.purchases -
    cf.expenses +
    cf.debtIn -
    cf.debtPrincipalPaid -
    cf.lent +
    cf.creditCollected;

  // Inventario según movimientos + costos capitalizados de unidades
  let inventory = 0;
  let unknownUnits = 0;
  let goods = 0;
  let found = 0;
  for (const m of data.movements) {
    if (!inScope(m.inventoryId) || !before(m.at)) continue;
    if ((m.type === 'sale' || m.type === 'void_sale') && m.refId && voidedSales.has(m.refId)) continue;
    if ((m.type === 'purchase' || m.type === 'void_purchase') && m.refId && voidedPurchases.has(m.refId)) continue;
    inventory += m.costDelta;
    unknownUnits += m.unknownDelta;
    if (m.type === 'initial') goods += m.costDelta;
    if (m.type === 'adjust_in' && m.refType === 'adjust') found += m.costDelta;
  }
  for (const e of data.expenses)
    if (e.status === 'active' && e.treatment === 'capitalized' && e.unitId && inScope(e.inventoryId) && before(e.date)) inventory += e.amount;

  // Cuentas por cobrar y saldos a favor
  const returnedBySale = new Map<ID, Money>();
  for (const r of data.returns) {
    if (!activeSales.has(r.saleId) || !before(r.date)) continue;
    returnedBySale.set(r.saleId, (returnedBySale.get(r.saleId) ?? 0) + r.lines.reduce((a, l) => a + l.amount, 0));
  }
  let receivables = 0;
  let customerCredit = 0;
  for (const s of activeSales.values()) {
    if (!inScope(s.inventoryId) || !before(s.date)) continue;
    const effective = s.total - (returnedBySale.get(s.id) ?? 0);
    const collected = collectedBySale.get(s.id) ?? 0;
    const forgiven = s.forgiven && s.forgivenAt && before(s.forgivenAt) ? s.forgiven : 0;
    receivables += Math.max(0, effective - collected - forgiven);
    customerCredit += Math.max(0, collected - effective);
  }
  receivables += creditReceivables;

  const ownerLoans = cf.ownerLoansOut - cf.ownerLoansBack;
  const businessValue = cash + inventory + receivables + ownerLoans - debts - customerCredit;
  const netCapital = cf.contributions - cf.withdrawals + goods + receivablesContributed;
  const growth = businessValue - netCapital;
  return {
    at: end,
    cash,
    cashFlow: cf,
    inventory,
    inventoryUnknownUnits: unknownUnits,
    receivables,
    customerCredit,
    ownerLoans,
    debts,
    businessValue,
    contributions: cf.contributions,
    withdrawals: cf.withdrawals,
    goodsContributed: goods,
    netCapital,
    growth,
    growthPct: netCapital > 0 ? growth / netCapital : null,
    cashAdjustments: cf.adjustments,
    foundStock: found,
    receivablesContributed,
  };
}

/** Capital a hoy. El inventario se toma de las existencias actuales (igual que en el resto de la app). */
export function computeCurrentCapital(data: CapitalData, inScope: Scope): CapitalSnapshot {
  const s = computeCapitalAt(data, null, inScope);
  const inv = currentInventoryValue(data, inScope);
  const businessValue = s.businessValue - s.inventory + inv.value;
  const growth = businessValue - s.netCapital;
  return {
    ...s,
    inventory: inv.value,
    inventoryUnknownUnits: inv.unknownUnits,
    businessValue,
    growth,
    growthPct: s.netCapital > 0 ? growth / s.netCapital : null,
  };
}

export async function getCapitalSnapshot(db: AppDB, inventoryIds: ID[] | null): Promise<CapitalSnapshot> {
  return computeCurrentCapital(await loadCapitalData(db), scopeFor(inventoryIds));
}

/* ================= Serie mensual ================= */

export interface CapitalPoint {
  key: string; // AAAA-MM
  label: string;
  /** Corte (exclusivo): inicio del mes siguiente, o null en el mes actual (hasta hoy). */
  end: ISODate | null;
  value: Money;
  netCapital: Money;
  growth: Money;
  cash: Money;
  inventory: Money;
  /** Lo que creció el negocio en ese mes (sin contar aportes ni retiros). */
  monthGrowth: Money;
  partial: boolean;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function firstActivity(data: CapitalData, inScope: Scope): ISODate | null {
  const dates: ISODate[] = [];
  for (const c of data.capital) if (c.status === 'active' && inScope(c.inventoryId)) dates.push(c.date);
  for (const m of data.movements) if (inScope(m.inventoryId) && !m.dateUnknown) dates.push(m.at);
  for (const m of data.movements) if (inScope(m.inventoryId) && m.dateUnknown) dates.push(m.createdAt);
  for (const e of data.expenses) if (e.status === 'active' && inScope(e.inventoryId)) dates.push(e.date);
  for (const d of data.debts) if (d.status !== 'voided' && inScope(d.inventoryId)) dates.push(d.date);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Evolución mensual del valor del negocio (máximo `months` meses, desde el primer mes con datos). */
export function computeCapitalSeries(data: CapitalData, inScope: Scope, months = 12, now = new Date()): CapitalPoint[] {
  const first = firstActivity(data, inScope);
  if (!first) return [];
  const f = new Date(first);
  let start = new Date(f.getFullYear(), f.getMonth(), 1);
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const minStart = new Date(curStart.getFullYear(), curStart.getMonth() - (months - 1), 1);
  if (start < minStart) start = minStart;
  if (start > curStart) start = curStart;
  const out: CapitalPoint[] = [];
  let prevGrowth = computeCapitalAt(data, start.toISOString(), inScope).growth;
  for (let d = new Date(start); d <= curStart; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const isCurrent = d.getTime() === curStart.getTime();
    const end = isCurrent ? null : new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
    const s = isCurrent ? computeCurrentCapital(data, inScope) : computeCapitalAt(data, end, inScope);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: monthLabel(d),
      end,
      value: s.businessValue,
      netCapital: s.netCapital,
      growth: s.growth,
      cash: s.cash,
      inventory: s.inventory,
      monthGrowth: s.growth - prevGrowth,
      partial: isCurrent,
    });
    prevGrowth = s.growth;
  }
  return out;
}

export async function getCapitalSeries(db: AppDB, inventoryIds: ID[] | null, months = 12, now = new Date()): Promise<CapitalPoint[]> {
  return computeCapitalSeries(await loadCapitalData(db), scopeFor(inventoryIds), months, now);
}

/* ================= Métricas ================= */

export interface AgeBucket {
  key: string;
  label: string;
  value: Money;
  units: number;
}

export interface CapitalMetrics {
  period: Period;
  netProfit: Money;
  profitComplete: boolean;
  startValue: Money;
  endValue: Money;
  /** Base usada para la rentabilidad: valor al empezar el periodo, o el capital aportado si el negocio empezó en el periodo. */
  returnBase: Money;
  /** Ganancia neta del periodo ÷ base (null si la base es 0). */
  periodReturn: number | null;
  cogs: Money;
  avgInventory: Money;
  /** Veces que el inventario "da la vuelta" en el periodo (costo de lo vendido ÷ inventario promedio). */
  rotation: number | null;
  /** Días que tarda en promedio el dinero del inventario en volver (días del periodo ÷ rotación). */
  inventoryDays: number | null;
  dormant: { value: Money; units: number };
  ageBuckets: AgeBucket[];
}

export async function getCapitalMetrics(db: AppDB, period: Period, inventoryIds: ID[] | null, now = new Date()): Promise<CapitalMetrics> {
  const data = await loadCapitalData(db);
  const inScope = scopeFor(inventoryIds);
  const start = computeCapitalAt(data, period.from, inScope);
  const nowIso = now.toISOString();
  const isCurrent = period.to > nowIso;
  const end = isCurrent ? computeCurrentCapital(data, inScope) : computeCapitalAt(data, period.to, inScope);
  const fin = await getFinancialSummary(db, period, inventoryIds);
  const returnBase = start.businessValue > 0 ? start.businessValue : Math.max(0, end.netCapital);
  const avgInventory = Math.round((start.inventory + end.inventory) / 2);
  const rotation = avgInventory > 0 ? fin.cogs / avgInventory : null;
  const elapsedDays = Math.max(1, daysBetween(period.from, isCurrent ? now : new Date(period.to)));
  const inventoryDays = rotation && rotation > 0 ? Math.round(elapsedDays / rotation) : null;

  const aging = await getUnsoldAging(db, inventoryIds, now);
  const buckets: AgeBucket[] = [
    { key: '0-30', label: '0 a 30 días', value: 0, units: 0 },
    { key: '31-60', label: '31 a 60 días', value: 0, units: 0 },
    { key: '61-90', label: '61 a 90 días', value: 0, units: 0 },
    { key: '91+', label: 'Más de 90 días', value: 0, units: 0 },
    { key: 'unknown', label: 'Fecha desconocida', value: 0, units: 0 },
  ];
  const dormant = { value: 0, units: 0 };
  for (const a of aging) {
    const b = a.days === null ? buckets[4] : a.days <= 30 ? buckets[0] : a.days <= 60 ? buckets[1] : a.days <= 90 ? buckets[2] : buckets[3];
    b.value += a.cost ?? 0;
    b.units += a.qty;
    if (a.dormant) {
      dormant.value += a.cost ?? 0;
      dormant.units += a.qty;
    }
  }
  return {
    period,
    netProfit: fin.netProfit,
    profitComplete: fin.profitComplete,
    startValue: start.businessValue,
    endValue: end.businessValue,
    returnBase,
    periodReturn: returnBase > 0 ? fin.netProfit / returnBase : null,
    cogs: fin.cogs,
    avgInventory,
    rotation,
    inventoryDays,
    dormant,
    ageBuckets: buckets,
  };
}

/** Explica el crecimiento: debe coincidir con ganancia neta acumulada + ajustes de caja + mercancía encontrada. */
export async function explainGrowth(db: AppDB, inventoryIds: ID[] | null) {
  const snap = await getCapitalSnapshot(db, inventoryIds);
  const all = await getFinancialSummary(db, { from: '0000-01-01T00:00:00.000Z', to: '9999-12-31T00:00:00.000Z' }, inventoryIds);
  const explained = all.netProfit + snap.cashAdjustments + snap.foundStock;
  return {
    growth: snap.growth,
    netProfit: all.netProfit,
    cashAdjustments: snap.cashAdjustments,
    foundStock: snap.foundStock,
    difference: snap.growth - explained,
  };
}

/* ================= Metas ================= */

export const GOAL_METRIC_LABEL: Record<Goal['metric'], string> = {
  business_value: 'Valor del negocio',
  growth: 'Crecimiento (ganancia acumulada)',
};

export interface GoalInput {
  id?: ID;
  inventoryId?: ID | null;
  name: string;
  metric: Goal['metric'];
  target: Money;
  dueDate?: ISODate | null;
}

export async function saveGoal(db: AppDB, input: GoalInput): Promise<Goal> {
  const name = cleanStr(input.name, 80);
  if (!name) fail('required', 'Ponle un nombre a la meta.', 'name');
  if (input.metric !== 'business_value' && input.metric !== 'growth') fail('invalid', 'Elige qué quieres medir.', 'metric');
  if (!Number.isInteger(input.target) || input.target <= 0) fail('invalid', 'La meta debe ser un valor mayor que cero.', 'target');
  const dueDate = input.dueDate ? assertDate(input.dueDate, 'dueDate', 'Fecha límite', { allowFuture: true }) : null;
  return tx(db, async () => {
    const inventoryId = input.inventoryId ?? null;
    if (inventoryId) await requireInventory(db, inventoryId, { allowArchived: true });
    const prev = input.id ? await db.goals.get(input.id) : undefined;
    if (input.id && !prev) fail('not_found', 'La meta no existe.');
    const g: Goal = {
      id: prev?.id ?? newId(),
      inventoryId,
      name,
      metric: input.metric,
      target: input.target,
      dueDate,
      status: prev?.status ?? 'active',
      createdAt: prev?.createdAt ?? nowISO(),
    };
    await db.goals.put(g);
    await logHistory(db, {
      entityType: 'goal',
      entityId: g.id,
      inventoryId,
      action: prev ? 'update' : 'create',
      summary: `${prev ? 'Meta editada' : 'Meta creada'}: ${name}`,
    });
    return g;
  });
}

export async function setGoalArchived(db: AppDB, id: ID, archived: boolean): Promise<void> {
  await db.goals.update(id, { status: archived ? 'archived' : 'active' });
}

export async function deleteGoal(db: AppDB, id: ID): Promise<void> {
  await db.goals.delete(id);
}

export interface GoalProgress {
  goal: Goal;
  current: Money;
  /** 0..1 (puede pasar de 1 si se superó). */
  progress: number;
  remaining: Money;
  reached: boolean;
  monthsLeft: number | null;
  /** Lo que tendría que crecer por mes para llegar a tiempo (null si no hay fecha). */
  perMonthNeeded: Money | null;
  overdue: boolean;
}

export function goalProgress(goal: Goal, snap: CapitalSnapshot, now = new Date()): GoalProgress {
  const current = goal.metric === 'business_value' ? snap.businessValue : snap.growth;
  const remaining = Math.max(0, goal.target - current);
  const reached = current >= goal.target;
  let monthsLeft: number | null = null;
  let perMonthNeeded: Money | null = null;
  let overdue = false;
  if (goal.dueDate) {
    const days = (Date.parse(goal.dueDate) - now.getTime()) / 86_400_000;
    overdue = days < 0 && !reached;
    monthsLeft = Math.max(0, Math.round((days / 30.44) * 10) / 10);
    perMonthNeeded = reached ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft));
  }
  return { goal, current, progress: goal.target > 0 ? Math.max(0, current) / goal.target : 0, remaining, reached, monthsLeft, perMonthNeeded, overdue };
}

/** Metas con su avance. Las generales usan el capital global; las de un inventario, el de ese inventario. */
export async function getGoalsProgress(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<GoalProgress[]> {
  const goals = await db.goals.toArray();
  const set = inventoryIds ? new Set(inventoryIds) : null;
  const visible = goals.filter((g) => (set ? g.inventoryId !== null && set.has(g.inventoryId) : true));
  if (!visible.length) return [];
  const data = await loadCapitalData(db);
  const cache = new Map<string, CapitalSnapshot>();
  const snapFor = (inv: ID | null) => {
    const k = inv ?? '*';
    let s = cache.get(k);
    if (!s) {
      s = computeCurrentCapital(data, scopeFor(inv ? [inv] : null));
      cache.set(k, s);
    }
    return s;
  };
  return visible
    .map((g) => goalProgress(g, snapFor(g.inventoryId), now))
    .sort((a, b) => (a.goal.status === b.goal.status ? a.goal.createdAt.localeCompare(b.goal.createdAt) : a.goal.status === 'active' ? -1 : 1));
}

export interface CapitalMovementView extends CapitalMovement {
  label: string;
}

export async function listCapitalMovements(db: AppDB, inventoryIds: ID[] | null): Promise<CapitalMovementView[]> {
  const inScope = scopeFor(inventoryIds);
  return (await db.capital.toArray())
    .filter((c) => inScope(c.inventoryId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({ ...c, label: CAPITAL_KIND_LABEL[c.kind] }));
}

export async function getOwnerLoanOutstanding(db: AppDB, inventoryId: ID | null): Promise<Money> {
  return ownerLoanOutstanding(await db.capital.toArray(), inventoryId);
}
