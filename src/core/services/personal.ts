import type { AppDB } from '../db';
import type { CapitalMovement, ID, ISODate, Money } from '../types';
import { cleanStr, fail } from '../util';
import { addCapitalMovement, getCapitalSnapshot } from './capital';
import { monthPeriod } from './insights';
import { getFinancialSummary, inPeriod } from './reports';

/**
 * GASTOS PERSONALES (v2.1)
 * Un gusto, un gasto hormiga, una comida… pagados con plata del negocio. NO son gastos del negocio:
 * no bajan la ganancia del negocio, pero sí sacan plata de la caja. Se guardan como un retiro (si no lo
 * vas a devolver) o como un préstamo a ti (si lo vas a devolver), marcados como personales.
 * La app compara lo que sacas en el mes con lo que el negocio ganó en el mes:
 * - si sacas menos que la ganancia, estás usando ganancias;
 * - si sacas más, te estás comiendo el capital (la plata para volver a comprar mercancía).
 */

export const PERSONAL_TAGS = ['Gusto', 'Gasto hormiga', 'Comida', 'Salida', 'Transporte', 'Ropa', 'Familia', 'Emergencia', 'Otro'] as const;

export interface PersonalInput {
  opId: string;
  date: ISODate;
  amount: Money;
  tag: string;
  notes?: string;
  /** true = lo vas a devolver (préstamo a ti); false = retiro. */
  willRepay: boolean;
  inventoryId?: ID | null;
}

export async function addPersonalSpending(db: AppDB, input: PersonalInput): Promise<CapitalMovement> {
  const tag = cleanStr(input.tag, 40);
  if (!tag) fail('required', 'Elige en qué lo gastaste.', 'tag');
  return addCapitalMovement(db, {
    opId: input.opId,
    kind: input.willRepay ? 'owner_loan' : 'withdrawal',
    date: input.date,
    amount: input.amount,
    inventoryId: input.inventoryId ?? null,
    notes: input.notes,
    personal: true,
    tag,
  });
}

export interface PersonalMonth {
  from: ISODate;
  to: ISODate;
  /** Ganancia neta del negocio en el mes (puede ser negativa). */
  profit: Money;
  /** Todo lo que sacaste del negocio en el mes: retiros + préstamos a ti − lo que devolviste. */
  taken: Money;
  /** Solo los gastos personales (gustos, hormiga…). */
  personal: Money;
  personalCount: number;
  /** Gastos hormiga del mes. */
  ant: Money;
  antCount: number;
  byTag: { tag: string; amount: Money; count: number }[];
  /** Ganancia que aún no has sacado (negativo = ya sacaste más de lo que ganaste). */
  freeProfit: Money;
}

export interface PersonalImpact {
  amount: Money;
  month: PersonalMonth;
  takenAfter: Money;
  freeProfitAfter: Money;
  /** Del gasto, cuánto sale de las ganancias del mes y cuánto del capital del negocio. */
  fromProfit: Money;
  fromCapital: Money;
  /** % de la ganancia del mes que habrás sacado (null si no hay ganancia). */
  pctOfProfit: number | null;
  cash: Money;
  cashAfter: Money;
  cashShort: boolean;
  /** ok = cabe holgado en la ganancia; warn = te comes más de la mitad de la ganancia; danger = te comes capital. */
  level: 'ok' | 'warn' | 'danger';
}

/** Resumen del mes de `now`: ganancia, lo que sacaste y los gastos personales. */
export async function getPersonalMonth(db: AppDB, now = new Date()): Promise<PersonalMonth> {
  const period = monthPeriod(now);
  const [summary, capital] = await Promise.all([getFinancialSummary(db, period, null), db.capital.toArray()]);
  let taken = 0;
  let personal = 0;
  let personalCount = 0;
  let ant = 0;
  let antCount = 0;
  const tags = new Map<string, { amount: Money; count: number }>();
  for (const c of capital) {
    if (c.status !== 'active' || !inPeriod(c.date, period)) continue;
    if (c.kind === 'withdrawal' || c.kind === 'owner_loan') taken += c.amount;
    if (c.kind === 'owner_loan_repayment') taken -= c.amount;
    if (c.personal && (c.kind === 'withdrawal' || c.kind === 'owner_loan')) {
      personal += c.amount;
      personalCount++;
      const t = c.tag || 'Otro';
      const x = tags.get(t) ?? { amount: 0, count: 0 };
      x.amount += c.amount;
      x.count++;
      tags.set(t, x);
      if (t === 'Gasto hormiga') {
        ant += c.amount;
        antCount++;
      }
    }
  }
  return {
    from: period.from,
    to: period.to,
    profit: summary.netProfit,
    taken,
    personal,
    personalCount,
    ant,
    antCount,
    byTag: [...tags.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.amount - a.amount),
    freeProfit: summary.netProfit - taken,
  };
}

/** Qué pasa si sacas `amount` hoy para un gasto personal. No guarda nada. */
export async function personalSpendingImpact(db: AppDB, amount: Money, date: ISODate = new Date().toISOString()): Promise<PersonalImpact> {
  const d = Number.isNaN(Date.parse(date)) ? new Date().toISOString() : date;
  const a = Math.max(0, Math.round(amount || 0));
  const [month, snap] = await Promise.all([getPersonalMonth(db, new Date(d)), getCapitalSnapshot(db, null)]);
  const takenAfter = month.taken + a;
  const freeBefore = Math.max(0, month.freeProfit);
  const fromProfit = Math.min(a, freeBefore);
  const fromCapital = a - fromProfit;
  const pctOfProfit = month.profit > 0 ? Math.round((takenAfter * 100) / month.profit) : null;
  const level: PersonalImpact['level'] = fromCapital > 0 || month.profit <= 0 ? 'danger' : takenAfter * 2 > month.profit ? 'warn' : 'ok';
  return {
    amount: a,
    month,
    takenAfter,
    freeProfitAfter: month.profit - takenAfter,
    fromProfit,
    fromCapital,
    pctOfProfit,
    cash: snap.cash,
    cashAfter: snap.cash - a,
    cashShort: snap.cash < a,
    level,
  };
}

/** Gastos personales registrados (los más recientes primero). */
export async function listPersonalSpending(db: AppDB, limit = 50): Promise<CapitalMovement[]> {
  const all = await db.capital.filter((c) => !!c.personal).toArray();
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
}

/** Cuánto suma un gasto pequeño repetido: "un café de 5 000 al día son 150 000 al mes". */
export function antProjection(amount: Money, timesPerWeek: number): { month: Money; year: Money } {
  const perWeek = Math.max(0, amount) * Math.max(0, timesPerWeek);
  return { month: Math.round((perWeek * 52) / 12), year: perWeek * 52 };
}
