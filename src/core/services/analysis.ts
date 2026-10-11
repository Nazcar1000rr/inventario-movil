import type { AppDB } from '../db';
import type { Expectation, ExpectationPeriod, ID, ISODate, Lot, MarketPrice, Money, Product, Settings, Unit } from '../types';
import { normalizeCondition } from '../catalog';
import { cleanStr, daysBetween, fail, newId, nowISO } from '../util';
import { getSettings, logHistory, requireInventory } from './base';
import { computeCapitalAt, computeCurrentCapital, loadCapitalData, monthLabel, scopeFor, type CapitalData } from './capital';
import { marketKey } from './pricing';
import { getSoldObservations, getUnsoldAging, summarizeFinancial, type AgingItem, type FinancialData, type FinancialSummary, type Period, type SoldObservation } from './reports';
import { tx, unitCost } from './stock';

/**
 * ANÁLISIS DEL NEGOCIO (v2.3)
 * - Lo que esperas ganar: con tus existencias y tus precios, y al ritmo de tus ventas.
 * - Expectativas del mes y de la semana: la app propone una (promedio de tus periodos anteriores) y la puedes editar.
 * - Tendencias, productos estrella (80/20), punto de equilibrio, flujo de dinero, días de venta y salud del negocio.
 * Todo se calcula en el teléfono con tus datos; nada sale del dispositivo.
 */

const DAY = 86_400_000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round1000 = (v: number) => Math.round(v / 1000) * 1000;
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/* ======================= Periodos (hora local) ======================= */

export function periodStart(kind: ExpectationPeriod, d: Date): Date {
  if (kind === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7; // lunes = 0
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - dow);
}

export function shiftPeriod(kind: ExpectationPeriod, start: Date, n: number): Date {
  return kind === 'month' ? new Date(start.getFullYear(), start.getMonth() + n, 1) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n);
}

export function periodOf(kind: ExpectationPeriod, start: Date): Period {
  return { from: start.toISOString(), to: shiftPeriod(kind, start, 1).toISOString() };
}

export function periodName(kind: ExpectationPeriod, start: Date): { label: string; short: string } {
  if (kind === 'month') return { label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`, short: monthLabel(start) };
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const same = end.getMonth() === start.getMonth();
  return {
    label: `Semana del ${start.getDate()}${same ? '' : ` ${MONTH_SHORT[start.getMonth()]}`} al ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`,
    short: `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`,
  };
}

/** Clave del alcance para guardar expectativas: null = todo el negocio; un inventario; undefined = vista de varios (no se guarda). */
export function expectationScope(inventoryIds: ID[] | null): ID | null | undefined {
  if (inventoryIds === null) return null;
  return inventoryIds.length === 1 ? inventoryIds[0] : undefined;
}

/* ======================= Datos ======================= */

export interface AnalysisData {
  fin: FinancialData;
  cap: CapitalData;
  lots: Lot[];
  expectations: Expectation[];
  marketPrices: MarketPrice[];
  settings: Settings;
  /** Memoria de resúmenes ya calculados (misma consulta = mismo resultado). */
  cache: Map<string, FinancialSummary>;
}

export async function loadAnalysisData(db: AppDB): Promise<AnalysisData> {
  const [cap, purchaseLines, saleLines, lots, expectations, marketPrices, settings] = await Promise.all([
    loadCapitalData(db),
    db.purchaseLines.toArray(),
    db.saleLines.toArray(),
    db.lots.toArray(),
    db.expectations.toArray(),
    db.marketPrices.toArray(),
    getSettings(db),
  ]);
  const fin: FinancialData = {
    purchases: cap.purchases,
    purchaseLines,
    sales: cap.sales,
    saleLines,
    returns: cap.returns,
    expenses: cap.expenses,
    payments: cap.payments,
    movements: cap.movements,
    credits: cap.credits,
  };
  return { fin, cap, lots, expectations, marketPrices, settings, cache: new Map() };
}

function summary(data: AnalysisData, period: Period, ids: ID[] | null): FinancialSummary {
  const k = `${period.from}|${period.to}|${ids ? ids.join(',') : '*'}`;
  let s = data.cache.get(k);
  if (!s) {
    s = summarizeFinancial(data.fin, period, ids);
    data.cache.set(k, s);
  }
  return s;
}

/* ======================= Métricas de un periodo ======================= */

export interface PeriodMetrics {
  from: ISODate;
  to: ISODate;
  label: string;
  short: string;
  partial: boolean;
  revenue: Money;
  cogs: Money;
  grossProfit: Money;
  expenses: Money;
  writeOffs: Money;
  netProfit: Money;
  sales: number;
  units: number;
  purchases: Money;
  collected: Money;
  grossMargin: number | null;
  netMargin: number | null;
  avgTicket: Money | null;
  profitPerSale: Money | null;
  profitComplete: boolean;
}

export function periodMetrics(data: AnalysisData, period: Period, ids: ID[] | null, label = '', short = '', partial = false): PeriodMetrics {
  const f = summary(data, period, ids);
  const units = f.sales.units - f.returns.units;
  return {
    from: period.from,
    to: period.to,
    label,
    short,
    partial,
    revenue: f.netRevenue,
    cogs: f.cogs,
    grossProfit: f.grossProfit,
    expenses: f.operatingExpenses,
    writeOffs: f.writeOffs,
    netProfit: f.netProfit,
    sales: f.sales.count,
    units,
    purchases: f.purchases.total,
    collected: f.collected,
    grossMargin: ratio(f.grossProfit, f.netRevenue),
    netMargin: ratio(f.netProfit, f.netRevenue),
    avgTicket: f.sales.count ? Math.round(f.sales.total / f.sales.count) : null,
    profitPerSale: f.sales.count ? Math.round(f.grossProfit / f.sales.count) : null,
    profitComplete: f.profitComplete,
  };
}

/** Últimos `n` meses o semanas (el último es el actual, incompleto). */
export function trend(data: AnalysisData, kind: ExpectationPeriod, n: number, ids: ID[] | null, now: Date): PeriodMetrics[] {
  const cur = periodStart(kind, now);
  const out: PeriodMetrics[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = shiftPeriod(kind, cur, -i);
    const nm = periodName(kind, s);
    out.push(periodMetrics(data, periodOf(kind, s), ids, nm.label, nm.short, i === 0));
  }
  return out;
}

function firstSaleDate(data: AnalysisData, ids: ID[] | null): ISODate | null {
  const inScope = scopeFor(ids);
  let first: ISODate | null = null;
  for (const s of data.fin.sales) if (s.status === 'active' && inScope(s.inventoryId) && (!first || s.date < first)) first = s.date;
  return first;
}

/* ======================= Expectativas ======================= */

export interface ExpectationTarget {
  profit: Money;
  revenue: Money;
  units: number;
  source: 'auto' | 'manual';
  /** De dónde sale (p. ej. "Promedio de tus últimos 3 meses con ventas"). */
  basis: string;
  id: ID | null;
  notes: string;
}

/** Propuesta automática: el promedio de tus periodos anteriores con ventas (3 meses u 8 semanas). */
export function autoTarget(data: AnalysisData, kind: ExpectationPeriod, start: Date, ids: ID[] | null): ExpectationTarget | null {
  const lookback = kind === 'month' ? 3 : 8;
  const ms: PeriodMetrics[] = [];
  for (let i = 1; i <= lookback; i++) {
    const m = periodMetrics(data, periodOf(kind, shiftPeriod(kind, start, -i)), ids);
    if (m.sales > 0) ms.push(m);
  }
  if (!ms.length) return null;
  const avg = (f: (m: PeriodMetrics) => number) => sum(ms.map(f)) / ms.length;
  const word = kind === 'month' ? (ms.length === 1 ? 'mes' : 'meses') : ms.length === 1 ? 'semana' : 'semanas';
  return {
    profit: Math.max(0, round1000(avg((m) => m.netProfit))),
    revenue: Math.max(0, round1000(avg((m) => m.revenue))),
    units: Math.max(0, Math.round(avg((m) => m.units))),
    source: 'auto',
    basis: ms.length === 1 ? `Lo que hiciste en tu último ${word} con ventas` : `Promedio de tus últimos ${ms.length} ${word} con ventas`,
    id: null,
    notes: '',
  };
}

export function targetFor(data: AnalysisData, kind: ExpectationPeriod, start: Date, ids: ID[] | null): ExpectationTarget | null {
  const scope = expectationScope(ids);
  if (scope !== undefined) {
    const e = data.expectations.find((x) => x.period === kind && x.start === start.toISOString() && (x.inventoryId ?? null) === scope);
    if (e) return { profit: e.expectedProfit, revenue: e.expectedRevenue, units: e.expectedUnits, source: 'manual', basis: 'La pusiste tú', id: e.id, notes: e.notes };
  }
  return autoTarget(data, kind, start, ids);
}

export type ExpectationState = 'met' | 'missed' | 'on_track' | 'behind' | 'early' | 'no_target';

export interface ExpectationStatus {
  kind: ExpectationPeriod;
  start: ISODate;
  from: ISODate;
  to: ISODate;
  label: string;
  short: string;
  current: boolean;
  /** Parte del periodo que ya pasó (0 a 1). */
  elapsed: number;
  target: ExpectationTarget | null;
  actual: { profit: Money; revenue: Money; units: number; sales: number };
  /** Periodo actual: cómo terminaría si sigues al mismo ritmo. */
  projected: { profit: Money; revenue: Money; units: number } | null;
  /** Avance hacia la meta de ganancia (o de ventas si la meta de ganancia es 0). */
  progress: number | null;
  state: ExpectationState;
  /** Diferencia con la meta: lo logrado (pasado) o lo proyectado (actual). */
  diff: Money | null;
  /** Qué se compara: ganancia o ventas. */
  metric: 'profit' | 'revenue';
}

export function expectationStatus(data: AnalysisData, kind: ExpectationPeriod, start: Date, ids: ID[] | null, now: Date): ExpectationStatus {
  const period = periodOf(kind, start);
  const nm = periodName(kind, start);
  const m = periodMetrics(data, period, ids);
  const t0 = Date.parse(period.from);
  const t1 = Date.parse(period.to);
  const current = now.getTime() >= t0 && now.getTime() < t1;
  const elapsed = current ? clamp01((now.getTime() - t0) / (t1 - t0)) : now.getTime() >= t1 ? 1 : 0;
  const target = targetFor(data, kind, start, ids);
  const actual = { profit: m.netProfit, revenue: m.revenue, units: m.units, sales: m.sales };
  const projected = current && elapsed > 0 ? { profit: Math.round(m.netProfit / elapsed), revenue: Math.round(m.revenue / elapsed), units: Math.round(m.units / elapsed) } : null;
  const metric: 'profit' | 'revenue' = target && target.profit <= 0 && target.revenue > 0 ? 'revenue' : 'profit';
  const goal = target ? (metric === 'profit' ? target.profit : target.revenue) : null;
  const got = metric === 'profit' ? actual.profit : actual.revenue;
  const proj = projected ? (metric === 'profit' ? projected.profit : projected.revenue) : null;
  let state: ExpectationState = 'no_target';
  let diff: Money | null = null;
  if (target && goal !== null) {
    if (current) {
      diff = proj !== null ? proj - goal : got - goal;
      if (goal > 0 && got >= goal) state = 'met';
      else if (elapsed < 0.15) state = 'early';
      else state = (proj ?? got) >= goal ? 'on_track' : 'behind';
    } else {
      diff = got - goal;
      state = got >= goal ? 'met' : 'missed';
    }
  }
  return {
    kind,
    start: start.toISOString(),
    from: period.from,
    to: period.to,
    label: nm.label,
    short: nm.short,
    current,
    elapsed,
    target,
    actual,
    projected,
    progress: goal && goal > 0 ? got / goal : null,
    state,
    diff,
    metric,
  };
}

export interface ExpectationsOverview {
  /** Se puede editar (todo el negocio o un solo inventario). */
  canEdit: boolean;
  scope: ID | null | undefined;
  month: ExpectationStatus;
  week: ExpectationStatus;
  /** Periodos anteriores (del más antiguo al más reciente), solo desde que hay ventas. */
  monthHistory: ExpectationStatus[];
  weekHistory: ExpectationStatus[];
  hitRate: { month: { met: number; total: number }; week: { met: number; total: number } };
}

export function expectationsOverview(data: AnalysisData, ids: ID[] | null, now: Date, months = 6, weeks = 8): ExpectationsOverview {
  const first = firstSaleDate(data, ids);
  const hist = (kind: ExpectationPeriod, n: number) => {
    const cur = periodStart(kind, now);
    const out: ExpectationStatus[] = [];
    for (let i = n; i >= 1; i--) {
      const s = shiftPeriod(kind, cur, -i);
      if (!first || shiftPeriod(kind, s, 1).toISOString() <= first) continue;
      out.push(expectationStatus(data, kind, s, ids, now));
    }
    return out;
  };
  const monthHistory = hist('month', months);
  const weekHistory = hist('week', weeks);
  const rate = (xs: ExpectationStatus[]) => ({ met: xs.filter((x) => x.state === 'met').length, total: xs.filter((x) => x.target).length });
  const scope = expectationScope(ids);
  return {
    canEdit: scope !== undefined,
    scope,
    month: expectationStatus(data, 'month', periodStart('month', now), ids, now),
    week: expectationStatus(data, 'week', periodStart('week', now), ids, now),
    monthHistory,
    weekHistory,
    hitRate: { month: rate(monthHistory), week: rate(weekHistory) },
  };
}

export async function getExpectationsOverview(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<ExpectationsOverview> {
  return expectationsOverview(await loadAnalysisData(db), inventoryIds, now);
}

export interface ExpectationInput {
  period: ExpectationPeriod;
  /** Cualquier fecha dentro del periodo (se toma su inicio). */
  date: ISODate;
  inventoryId: ID | null;
  profit: Money;
  revenue: Money;
  units: number;
  notes?: string;
}

/** Guarda (o cambia) tu expectativa de un mes o una semana. */
export async function saveExpectation(db: AppDB, input: ExpectationInput): Promise<Expectation> {
  if (input.period !== 'month' && input.period !== 'week') fail('invalid', 'Elige si es del mes o de la semana.', 'period');
  const d = new Date(input.date);
  if (!Number.isFinite(d.getTime())) fail('invalid', 'Fecha no válida.', 'date');
  const ints = (v: unknown, field: string, label: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1e13) fail('invalid', `${label}: escribe un valor en pesos (0 o más).`, field);
    return v;
  };
  const profit = ints(input.profit, 'profit', 'Ganancia esperada');
  const revenue = ints(input.revenue, 'revenue', 'Ventas esperadas');
  const units = ints(input.units, 'units', 'Unidades esperadas');
  if (profit === 0 && revenue === 0) fail('invalid', 'Pon al menos la ganancia o las ventas que esperas.', 'profit');
  const start = periodStart(input.period, d);
  const period = periodOf(input.period, start);
  return tx(db, async () => {
    if (input.inventoryId) await requireInventory(db, input.inventoryId, { allowArchived: true });
    const prev = (await db.expectations.where('start').equals(period.from).toArray()).find((x) => x.period === input.period && (x.inventoryId ?? null) === (input.inventoryId ?? null));
    const now = nowISO();
    const e: Expectation = {
      id: prev?.id ?? newId(),
      period: input.period,
      start: period.from,
      end: period.to,
      inventoryId: input.inventoryId ?? null,
      expectedProfit: profit,
      expectedRevenue: revenue,
      expectedUnits: units,
      notes: cleanStr(input.notes ?? '', 300),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await db.expectations.put(e);
    const nm = periodName(input.period, start);
    await logHistory(db, {
      entityType: 'expectation',
      entityId: e.id,
      inventoryId: e.inventoryId,
      action: prev ? 'update' : 'create',
      summary: `Expectativa (${nm.label}): ganancia ${profit}, ventas ${revenue}, ${units} unidades`,
    });
    return e;
  });
}

/** Quita tu expectativa: vuelve a la propuesta automática. */
export async function resetExpectation(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const e = await db.expectations.get(id);
    if (!e) return;
    await db.expectations.delete(id);
    await logHistory(db, {
      entityType: 'expectation',
      entityId: id,
      inventoryId: e.inventoryId,
      action: 'reset',
      summary: `Expectativa (${periodName(e.period, new Date(e.start)).label}) vuelve a ser automática`,
    });
  });
}

/* ======================= Lo que esperas ganar con tus existencias ======================= */

export type PriceSource = 'list' | 'market' | 'recent' | 'market_stale' | 'mixed';

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  list: 'tu precio de venta',
  market: 'precio de mercado',
  recent: 'promedio de tus ventas',
  market_stale: 'precio de mercado (viejo)',
  mixed: 'varios precios',
};

export interface StockOutlookRow {
  productId: ID;
  name: string;
  tracking: Product['tracking'];
  qty: number;
  /** Valor a costo conocido. */
  cost: Money;
  unknownCostQty: number;
  /** Cantidad con precio de venta conocido. */
  pricedQty: number;
  /** Precio de venta por unidad (promedio si varía). */
  price: Money | null;
  priceSource: PriceSource | null;
  revenue: Money;
  /** Ganancia esperada (solo de lo que tiene precio y costo conocidos). */
  profit: Money;
  margin: number | null;
}

export interface StockOutlook {
  rows: StockOutlookRow[];
  qty: number;
  cost: Money;
  revenue: Money;
  profit: Money;
  margin: number | null;
  pricedQty: number;
  unpricedQty: number;
  unpricedCost: Money;
  unknownCostQty: number;
  /** Equipos dañados: no se cuentan como venta esperada. */
  damaged: { qty: number; cost: Money };
}

function recentPrices(data: AnalysisData, ids: ID[] | null, now: Date) {
  const inScope = scopeFor(ids);
  const from = new Date(now.getTime() - data.settings.pricing.recentSalesDays * DAY).toISOString();
  const sales = new Map(data.fin.sales.filter((s) => s.status === 'active' && s.date >= from && inScope(s.inventoryId)).map((s) => [s.id, s]));
  const units = new Map(data.cap.units.map((u) => [u.id, u]));
  const products = new Map(data.cap.products.map((p) => [p.id, p]));
  const byProduct = new Map<ID, { amount: number; qty: number }>();
  const byKey = new Map<string, { amount: number; qty: number }>();
  for (const l of data.fin.saleLines) {
    if (!sales.has(l.saleId)) continue;
    const q = l.quantity - l.returnedQty;
    if (q <= 0) continue;
    const amt = l.netAmount - l.returnedAmount;
    const a = byProduct.get(l.productId) ?? { amount: 0, qty: 0 };
    a.amount += amt;
    a.qty += q;
    byProduct.set(l.productId, a);
    const u = l.unitId ? units.get(l.unitId) : undefined;
    const p = products.get(l.productId);
    if (u && p) {
      const k = marketKey(p.model || p.name, u.capacity || p.capacity, normalizeCondition(u.condition));
      const b = byKey.get(k) ?? { amount: 0, qty: 0 };
      b.amount += amt;
      b.qty += q;
      byKey.set(k, b);
    }
  }
  const avg = (x?: { amount: number; qty: number }) => (x && x.qty > 0 ? Math.round(x.amount / x.qty) : null);
  return { product: (id: ID) => avg(byProduct.get(id)), unitKey: (k: string) => avg(byKey.get(k)) };
}

export function stockOutlook(data: AnalysisData, ids: ID[] | null, now: Date): StockOutlook {
  const inScope = scopeFor(ids);
  const recent = recentPrices(data, ids, now);
  const latestMarket = new Map<string, MarketPrice>();
  for (const m of data.marketPrices) {
    const cur = latestMarket.get(m.key);
    if (!cur || m.date > cur.date) latestMarket.set(m.key, m);
  }
  const staleDays = data.settings.pricing.marketStaleDays;
  const rows: StockOutlookRow[] = [];
  const damaged = { qty: 0, cost: 0 };
  const unitsByProduct = new Map<ID, Unit[]>();
  for (const u of data.cap.units) {
    if (!inScope(u.inventoryId)) continue;
    if (u.status === 'damaged') {
      damaged.qty++;
      damaged.cost += unitCost(u) ?? 0;
      continue;
    }
    if (u.status !== 'available' && u.status !== 'in_review') continue;
    unitsByProduct.set(u.productId, [...(unitsByProduct.get(u.productId) ?? []), u]);
  }
  for (const p of data.cap.products) {
    if (!inScope(p.inventoryId)) continue;
    if (p.tracking === 'quantity') {
      if (p.qty <= 0) continue;
      const known = p.qty - p.unknownCostQty;
      let price: Money | null = p.salePrice;
      let source: PriceSource | null = price !== null ? 'list' : null;
      if (price === null) {
        price = recent.product(p.id);
        source = price !== null ? 'recent' : null;
      }
      const revenue = price === null ? 0 : price * p.qty;
      const profit = price === null ? 0 : price * known - p.stockValue;
      rows.push({
        productId: p.id,
        name: p.name,
        tracking: p.tracking,
        qty: p.qty,
        cost: p.stockValue,
        unknownCostQty: p.unknownCostQty,
        pricedQty: price === null ? 0 : p.qty,
        price,
        priceSource: source,
        revenue,
        profit,
        margin: price === null ? null : ratio(profit, price * known),
      });
    } else {
      const us = unitsByProduct.get(p.id) ?? [];
      if (!us.length) continue;
      let revenue = 0;
      let profit = 0;
      let priced = 0;
      let cost = 0;
      let unknown = 0;
      let knownRevenue = 0;
      const sources = new Set<PriceSource>();
      for (const u of us) {
        const c = unitCost(u);
        if (c === null) unknown++;
        else cost += c;
        const key = marketKey(p.model || p.name, u.capacity || p.capacity, normalizeCondition(u.condition));
        const m = latestMarket.get(key);
        const fresh = m && daysBetween(m.date, now) <= staleDays;
        let price: Money | null = null;
        let src: PriceSource | null = null;
        if (m && fresh) [price, src] = [m.price, 'market'];
        else if (recent.unitKey(key) !== null) [price, src] = [recent.unitKey(key), 'recent'];
        else if (p.salePrice !== null) [price, src] = [p.salePrice, 'list'];
        else if (m) [price, src] = [m.price, 'market_stale'];
        if (price === null || !src) continue;
        sources.add(src);
        priced++;
        revenue += price;
        if (c !== null) {
          profit += price - c;
          knownRevenue += price;
        }
      }
      rows.push({
        productId: p.id,
        name: p.name,
        tracking: p.tracking,
        qty: us.length,
        cost,
        unknownCostQty: unknown,
        pricedQty: priced,
        price: priced ? Math.round(revenue / priced) : null,
        priceSource: sources.size === 0 ? null : sources.size === 1 ? [...sources][0] : 'mixed',
        revenue,
        profit,
        margin: ratio(profit, knownRevenue),
      });
    }
  }
  rows.sort((a, b) => b.profit - a.profit || b.cost - a.cost);
  const priced = rows.filter((r) => r.pricedQty > 0);
  const unpriced = rows.filter((r) => r.pricedQty < r.qty);
  const totalProfit = sum(rows.map((r) => r.profit));
  const revenueKnown = sum(rows.map((r) => (r.margin !== null && r.margin !== undefined ? r.revenue : 0)));
  return {
    rows,
    qty: sum(rows.map((r) => r.qty)),
    cost: sum(rows.map((r) => r.cost)),
    revenue: sum(rows.map((r) => r.revenue)),
    profit: totalProfit,
    margin: ratio(totalProfit, revenueKnown),
    pricedQty: sum(priced.map((r) => r.pricedQty)),
    unpricedQty: sum(unpriced.map((r) => r.qty - r.pricedQty)),
    unpricedCost: sum(unpriced.map((r) => (r.pricedQty === 0 ? r.cost : Math.round((r.cost * (r.qty - r.pricedQty)) / Math.max(1, r.qty))))),
    unknownCostQty: sum(rows.map((r) => r.unknownCostQty)),
    damaged,
  };
}

/* ======================= Ritmo y proyecciones ======================= */

export interface Pace {
  /** Días usados para medir el ritmo (máximo 30; menos si el negocio es más nuevo). */
  days: number;
  revenuePerDay: number;
  profitPerDay: number;
  unitsPerDay: number;
  salesPerDay: number;
  next30: { revenue: Money; profit: Money; units: number };
  monthEnd: { revenue: Money; profit: Money; units: number; actualRevenue: Money; actualProfit: Money; actualUnits: number; daysLeft: number };
  /** Días que tardarías en vender todo lo que tienes al ritmo de los últimos 90 días (null si no hay ventas). */
  daysOfStock: number | null;
  sellOutDate: ISODate | null;
}

export function pace(data: AnalysisData, ids: ID[] | null, now: Date, stockCost: Money): Pace {
  const first = firstSaleDate(data, ids);
  const sinceFirst = first ? Math.max(1, Math.ceil((now.getTime() - Date.parse(first)) / DAY)) : 30;
  const days = Math.min(30, sinceFirst);
  const end = new Date(Math.ceil((now.getTime() + 1) / 60_000) * 60_000);
  const win = periodMetrics(data, { from: new Date(end.getTime() - days * DAY).toISOString(), to: end.toISOString() }, ids);
  const d90 = Math.min(90, sinceFirst);
  const w90 = periodMetrics(data, { from: new Date(end.getTime() - d90 * DAY).toISOString(), to: end.toISOString() }, ids);
  const per = (v: number) => (first ? v / days : 0);
  const monthStart = periodStart('month', now);
  const month = periodMetrics(data, periodOf('month', monthStart), ids);
  const monthEndDate = shiftPeriod('month', monthStart, 1);
  const daysLeft = Math.max(0, (monthEndDate.getTime() - now.getTime()) / DAY);
  const cogsPerDay = first ? w90.cogs / d90 : 0;
  const daysOfStock = cogsPerDay > 0 ? Math.round(stockCost / cogsPerDay) : null;
  return {
    days,
    revenuePerDay: per(win.revenue),
    profitPerDay: per(win.netProfit),
    unitsPerDay: per(win.units),
    salesPerDay: per(win.sales),
    next30: { revenue: Math.round(per(win.revenue) * 30), profit: Math.round(per(win.netProfit) * 30), units: Math.round(per(win.units) * 30) },
    monthEnd: {
      revenue: Math.round(month.revenue + per(win.revenue) * daysLeft),
      profit: Math.round(month.netProfit + per(win.netProfit) * daysLeft),
      units: Math.round(month.units + per(win.units) * daysLeft),
      actualRevenue: month.revenue,
      actualProfit: month.netProfit,
      actualUnits: month.units,
      daysLeft: Math.ceil(daysLeft),
    },
    daysOfStock,
    sellOutDate: daysOfStock === null ? null : new Date(now.getTime() + daysOfStock * DAY).toISOString(),
  };
}

export interface ValueProjection {
  now: Money;
  /** Si vendes todo lo que tienes a tus precios (sin contar lo que no tiene precio). */
  ifAllSold: Money;
  /** Ganancia neta mensual que se usa para proyectar (promedio de los últimos 3 meses o ritmo actual). */
  monthlyProfit: Money;
  monthlyBasis: string;
  points: { label: string; value: Money }[];
}

export function valueProjection(data: AnalysisData, ids: ID[] | null, now: Date, outlook: StockOutlook, p: Pace): ValueProjection {
  const inScope = scopeFor(ids);
  const snap = computeCurrentCapital(data.cap, inScope);
  const cur = periodStart('month', now);
  const prev = [1, 2, 3].map((i) => periodMetrics(data, periodOf('month', shiftPeriod('month', cur, -i)), ids)).filter((m) => m.sales > 0);
  const monthlyProfit = prev.length ? Math.round(sum(prev.map((m) => m.netProfit)) / prev.length) : Math.round(p.profitPerDay * 30);
  const monthlyBasis = prev.length ? `promedio de ${prev.length === 1 ? 'tu último mes' : `tus últimos ${prev.length} meses`}` : 'tu ritmo de los últimos días';
  const points: ValueProjection['points'] = [{ label: 'Hoy', value: snap.businessValue }];
  for (let i = 1; i <= 12; i++) {
    const d = shiftPeriod('month', cur, i);
    points.push({ label: monthLabel(d), value: snap.businessValue + monthlyProfit * i });
  }
  return { now: snap.businessValue, ifAllSold: snap.businessValue + outlook.profit, monthlyProfit, monthlyBasis, points };
}

/* ======================= Productos estrella (80/20) ======================= */

export interface AbcRow {
  productId: ID;
  name: string;
  units: number;
  revenue: Money;
  cogs: Money;
  profit: Money;
  margin: number | null;
  share: number;
  cumShare: number;
  cls: 'A' | 'B' | 'C';
}

export interface AbcResult {
  days: number;
  rows: AbcRow[];
  totalProfit: Money;
  counts: { A: number; B: number; C: number };
  /** Parte de la ganancia que dejan los productos A. */
  shareA: number;
  /** Productos con existencias que no se vendieron en el periodo. */
  idle: { productId: ID; name: string; qty: number; cost: Money }[];
}

export function abcAnalysis(data: AnalysisData, ids: ID[] | null, now: Date, days = 90): AbcResult {
  const inScope = scopeFor(ids);
  const from = new Date(now.getTime() - days * DAY).toISOString();
  const sales = new Set(data.fin.sales.filter((s) => s.status === 'active' && inScope(s.inventoryId) && s.date >= from && s.date <= now.toISOString()).map((s) => s.id));
  const products = new Map(data.cap.products.map((p) => [p.id, p]));
  const agg = new Map<ID, { units: number; revenue: number; cogs: number }>();
  for (const l of data.fin.saleLines) {
    if (!sales.has(l.saleId)) continue;
    const a = agg.get(l.productId) ?? { units: 0, revenue: 0, cogs: 0 };
    a.units += l.quantity - l.returnedQty;
    a.revenue += l.netAmount - l.returnedAmount;
    a.cogs += l.cogs - l.returnedCogs;
    agg.set(l.productId, a);
  }
  const base = [...agg.entries()]
    .map(([id, a]) => ({ productId: id, name: products.get(id)?.name ?? 'Producto', units: a.units, revenue: a.revenue, cogs: a.cogs, profit: a.revenue - a.cogs }))
    .filter((r) => r.units > 0 || r.revenue !== 0)
    .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
  const positive = sum(base.map((r) => Math.max(0, r.profit)));
  let cum = 0;
  const rows: AbcRow[] = base.map((r) => {
    const share = positive > 0 ? Math.max(0, r.profit) / positive : 0;
    const prevCum = cum;
    cum += share;
    const cls: AbcRow['cls'] = r.profit <= 0 ? 'C' : prevCum < 0.8 ? 'A' : prevCum < 0.95 ? 'B' : 'C';
    return { ...r, margin: ratio(r.profit, r.revenue), share, cumShare: Math.min(1, cum), cls };
  });
  const sold = new Set(rows.map((r) => r.productId));
  const idle: AbcResult['idle'] = [];
  const unitsIn = new Map<ID, { qty: number; cost: number }>();
  for (const u of data.cap.units) {
    if (!inScope(u.inventoryId) || (u.status !== 'available' && u.status !== 'in_review' && u.status !== 'damaged')) continue;
    const x = unitsIn.get(u.productId) ?? { qty: 0, cost: 0 };
    x.qty++;
    x.cost += unitCost(u) ?? 0;
    unitsIn.set(u.productId, x);
  }
  for (const p of data.cap.products) {
    if (!inScope(p.inventoryId) || sold.has(p.id)) continue;
    const x = p.tracking === 'quantity' ? { qty: p.qty, cost: p.stockValue } : unitsIn.get(p.id);
    if (x && x.qty > 0) idle.push({ productId: p.id, name: p.name, qty: x.qty, cost: x.cost });
  }
  idle.sort((a, b) => b.cost - a.cost);
  return {
    days,
    rows,
    totalProfit: sum(rows.map((r) => r.profit)),
    counts: { A: rows.filter((r) => r.cls === 'A').length, B: rows.filter((r) => r.cls === 'B').length, C: rows.filter((r) => r.cls === 'C').length },
    shareA: sum(rows.filter((r) => r.cls === 'A').map((r) => r.share)),
    idle,
  };
}

/* ======================= Punto de equilibrio ======================= */

export interface BreakEven {
  /** Gastos del negocio por mes (promedio de los últimos meses). */
  monthlyExpenses: Money;
  expensesBasis: string;
  /** Margen bruto de los últimos 90 días (lo que te queda de cada peso vendido después del costo). */
  grossMargin: number | null;
  /** Ventas del mes que necesitas para no perder. */
  revenueNeeded: Money | null;
  monthRevenue: Money;
  progress: number | null;
  /** Fecha estimada en la que lo alcanzas este mes al ritmo actual. */
  reachedOn: ISODate | null;
  state: 'reached' | 'on_track' | 'behind' | 'no_margin' | 'no_expenses' | 'no_data';
}

export function breakEven(data: AnalysisData, ids: ID[] | null, now: Date, p: Pace): BreakEven {
  const cur = periodStart('month', now);
  const prev = [1, 2, 3].map((i) => periodMetrics(data, periodOf('month', shiftPeriod('month', cur, -i)), ids)).filter((m) => m.sales > 0 || m.expenses > 0);
  const month = periodMetrics(data, periodOf('month', cur), ids);
  let monthlyExpenses: number;
  let expensesBasis: string;
  if (prev.length) {
    monthlyExpenses = Math.round(sum(prev.map((m) => m.expenses)) / prev.length);
    expensesBasis = prev.length === 1 ? 'gastos del mes pasado' : `promedio de tus gastos de los últimos ${prev.length} meses`;
  } else {
    monthlyExpenses = month.expenses;
    expensesBasis = 'gastos de este mes';
  }
  const d90 = periodMetrics(data, { from: new Date(now.getTime() - 90 * DAY).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() }, ids);
  const grossMargin = ratio(d90.grossProfit, d90.revenue);
  const base = { monthlyExpenses, expensesBasis, grossMargin, monthRevenue: month.revenue };
  if (d90.revenue <= 0 && month.revenue <= 0) return { ...base, revenueNeeded: null, progress: null, reachedOn: null, state: 'no_data' };
  if (grossMargin === null || grossMargin <= 0) return { ...base, revenueNeeded: null, progress: null, reachedOn: null, state: 'no_margin' };
  if (monthlyExpenses <= 0) return { ...base, revenueNeeded: 0, progress: 1, reachedOn: null, state: 'no_expenses' };
  const revenueNeeded = Math.round(monthlyExpenses / grossMargin);
  const progress = month.revenue / revenueNeeded;
  let reachedOn: ISODate | null = null;
  let state: BreakEven['state'];
  if (month.revenue >= revenueNeeded) state = 'reached';
  else if (p.revenuePerDay > 0) {
    const daysNeeded = (revenueNeeded - month.revenue) / p.revenuePerDay;
    const at = new Date(now.getTime() + daysNeeded * DAY);
    const monthEnd = shiftPeriod('month', cur, 1);
    state = at < monthEnd ? 'on_track' : 'behind';
    if (at < monthEnd) reachedOn = at.toISOString();
  } else state = 'behind';
  return { ...base, revenueNeeded, progress, reachedOn, state };
}

/* ======================= Esquemas de flujo (cascada) ======================= */

export interface WaterfallStep {
  key: string;
  label: string;
  value: Money;
  /** start/total = barra completa; delta = sube o baja. */
  kind: 'start' | 'delta' | 'total';
}

/** De tus ventas a tu ganancia neta. */
export function profitWaterfall(data: AnalysisData, period: Period, ids: ID[] | null): WaterfallStep[] {
  const f = summary(data, period, ids);
  const steps: WaterfallStep[] = [
    { key: 'revenue', label: 'Ventas', value: f.netRevenue, kind: 'start' },
    { key: 'cogs', label: 'Costo de lo vendido', value: -f.cogs, kind: 'delta' },
  ];
  const cats = [...f.expensesByCategory].sort((a, b) => b.amount - a.amount);
  const top = cats.slice(0, 3);
  for (const c of top) steps.push({ key: `exp:${c.category}`, label: c.category || 'Gastos', value: -c.amount, kind: 'delta' });
  const rest = sum(cats.slice(3).map((c) => c.amount));
  if (rest) steps.push({ key: 'exp:other', label: 'Otros gastos', value: -rest, kind: 'delta' });
  if (f.writeOffs) steps.push({ key: 'writeoffs', label: 'Pérdidas por bajas', value: -f.writeOffs, kind: 'delta' });
  steps.push({ key: 'net', label: 'Ganancia neta', value: f.netProfit, kind: 'total' });
  return steps;
}

/** Cómo se movió la plata de la caja en el periodo. */
export function cashWaterfall(data: AnalysisData, period: Period, ids: ID[] | null, now: Date): WaterfallStep[] {
  const inScope = scopeFor(ids);
  const a = computeCapitalAt(data.cap, period.from, inScope);
  const endIso = period.to > now.toISOString() ? null : period.to;
  const b = computeCapitalAt(data.cap, endIso, inScope);
  const d = (k: keyof typeof a.cashFlow) => b.cashFlow[k] - a.cashFlow[k];
  const steps: WaterfallStep[] = [
    { key: 'start', label: 'Caja al empezar', value: a.cash, kind: 'start' },
    { key: 'collected', label: 'Cobros de ventas', value: d('collected') - d('refunded'), kind: 'delta' },
    { key: 'purchases', label: 'Compras de mercancía', value: -d('purchases'), kind: 'delta' },
    { key: 'expenses', label: 'Gastos', value: -d('expenses'), kind: 'delta' },
    { key: 'contributions', label: 'Aportes', value: d('contributions'), kind: 'delta' },
    { key: 'withdrawals', label: 'Retiros y gastos personales', value: -d('withdrawals') - d('ownerLoansOut') + d('ownerLoansBack'), kind: 'delta' },
    { key: 'debts', label: 'Deudas (préstamos − abonos)', value: d('debtIn') - d('debtPrincipalPaid'), kind: 'delta' },
    { key: 'adjustments', label: 'Ajustes de caja', value: d('adjustments'), kind: 'delta' },
    { key: 'end', label: 'Caja al final', value: b.cash, kind: 'total' },
  ];
  return steps.filter((s) => s.kind !== 'delta' || s.value !== 0);
}

/* ======================= Días y horas de venta ======================= */

export interface WeekdayRow {
  day: number;
  label: string;
  sales: number;
  revenue: Money;
  profit: Money;
  /** Ventas promedio de cada uno de esos días en el periodo. */
  avgRevenue: Money;
  share: number;
}

export interface HourRow {
  key: string;
  label: string;
  sales: number;
  revenue: Money;
  profit: Money;
  share: number;
}

export function salesByTime(data: AnalysisData, ids: ID[] | null, now: Date, days = 90): { days: number; weekdays: WeekdayRow[]; hours: HourRow[]; best: WeekdayRow | null } {
  const inScope = scopeFor(ids);
  const from = new Date(now.getTime() - days * DAY);
  const sales = data.fin.sales.filter((s) => s.status === 'active' && inScope(s.inventoryId) && s.date >= from.toISOString() && s.date <= now.toISOString());
  const linesBySale = new Map<ID, { revenue: number; profit: number }>();
  const ids2 = new Set(sales.map((s) => s.id));
  for (const l of data.fin.saleLines) {
    if (!ids2.has(l.saleId)) continue;
    const x = linesBySale.get(l.saleId) ?? { revenue: 0, profit: 0 };
    x.revenue += l.netAmount - l.returnedAmount;
    x.profit += l.netAmount - l.returnedAmount - (l.cogs - l.returnedCogs);
    linesBySale.set(l.saleId, x);
  }
  const wd = WEEKDAYS.map((label, day) => ({ day, label, sales: 0, revenue: 0, profit: 0, avgRevenue: 0, share: 0 }));
  const HOURS: [string, string, number, number][] = [
    ['madrugada', 'Madrugada (0 a 6)', 0, 6],
    ['manana', 'Mañana (6 a 12)', 6, 12],
    ['tarde', 'Tarde (12 a 18)', 12, 18],
    ['noche', 'Noche (18 a 24)', 18, 24],
  ];
  const hr = HOURS.map(([key, label]) => ({ key, label, sales: 0, revenue: 0, profit: 0, share: 0 }));
  for (const s of sales) {
    const d = new Date(s.date);
    const x = linesBySale.get(s.id) ?? { revenue: 0, profit: 0 };
    const w = wd[(d.getDay() + 6) % 7];
    w.sales++;
    w.revenue += x.revenue;
    w.profit += x.profit;
    const h = hr[HOURS.findIndex(([, , a, b]) => d.getHours() >= a && d.getHours() < b)];
    h.sales++;
    h.revenue += x.revenue;
    h.profit += x.profit;
  }
  // Cuántas veces aparece cada día de la semana en el periodo (para promediar)
  const occ = Array(7).fill(0);
  for (let t = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1); t <= now; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) occ[(t.getDay() + 6) % 7]++;
  const totalRev = sum(wd.map((w) => w.revenue));
  for (const w of wd) {
    w.avgRevenue = occ[w.day] ? Math.round(w.revenue / occ[w.day]) : 0;
    w.share = totalRev > 0 ? w.revenue / totalRev : 0;
  }
  for (const h of hr) h.share = totalRev > 0 ? h.revenue / totalRev : 0;
  const best = sales.length ? [...wd].sort((a, b) => b.revenue - a.revenue)[0] : null;
  return { days, weekdays: wd, hours: hr, best };
}

/* ======================= Salud del negocio ======================= */

export interface HealthPart {
  key: 'margin' | 'trend' | 'rotation' | 'idle' | 'debts';
  label: string;
  score: number;
  max: number;
  value: string;
  tip: string;
}

export interface Health {
  score: number | null;
  label: string;
  parts: HealthPart[];
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function businessHealth(data: AnalysisData, ids: ID[] | null, now: Date, p: Pace, idleShare: number): Health {
  const first = firstSaleDate(data, ids);
  if (!first) return { score: null, label: 'Todavía sin ventas', parts: [] };
  const inScope = scopeFor(ids);
  const end = new Date(now.getTime() + 60_000);
  const d90 = periodMetrics(data, { from: new Date(end.getTime() - 90 * DAY).toISOString(), to: end.toISOString() }, ids);
  const last30 = periodMetrics(data, { from: new Date(end.getTime() - 30 * DAY).toISOString(), to: end.toISOString() }, ids);
  const prior = periodMetrics(data, { from: new Date(end.getTime() - 120 * DAY).toISOString(), to: new Date(end.getTime() - 30 * DAY).toISOString() }, ids);
  const parts: HealthPart[] = [];
  const gm = ratio(d90.grossProfit, d90.revenue);
  parts.push({
    key: 'margin',
    label: 'Margen',
    score: Math.round(clamp01((gm ?? 0) / 0.3) * 20),
    max: 20,
    value: gm === null ? 'Sin ventas en 90 días' : `${pct(gm)} de cada venta`,
    tip: gm === null || gm < 0.15 ? 'Tu margen es bajo: revisa a cómo compras y a cómo vendes.' : gm < 0.3 ? 'Buen margen; si puedes, sube un poco tus precios o compra más barato.' : 'Excelente margen.',
  });
  const priorEnd = end.getTime() - 30 * DAY;
  const priorDays = Math.max(0, (priorEnd - Math.max(Date.parse(first), end.getTime() - 120 * DAY)) / DAY);
  let trendScore = 10;
  let trendValue = 'Sin historial para comparar';
  if (priorDays >= 7) {
    const base = (prior.netProfit / priorDays) * 30;
    if (base <= 0) trendScore = last30.netProfit > 0 ? 20 : 0;
    else trendScore = Math.round(clamp01(last30.netProfit / base) * 20);
    trendValue = base > 0 ? `${last30.netProfit >= base ? '+' : '−'}${pct(Math.abs(last30.netProfit / base - 1))} vs. antes` : last30.netProfit > 0 ? 'Ahora sí ganas' : 'Sin ganancia';
  }
  parts.push({
    key: 'trend',
    label: 'Tendencia',
    score: trendScore,
    max: 20,
    value: trendValue,
    tip: trendScore >= 16 ? 'Tu ganancia de los últimos 30 días va igual o mejor que antes.' : 'Tu ganancia de los últimos 30 días va por debajo de lo normal.',
  });
  const dos = p.daysOfStock;
  parts.push({
    key: 'rotation',
    label: 'Rotación',
    score: dos === null ? 0 : Math.round(clamp01(1 - (dos - 30) / 150) * 20),
    max: 20,
    value: dos === null ? 'Sin ventas recientes' : `Vendes todo en ~${dos} días`,
    tip: dos === null || dos > 90 ? 'Tu mercancía se demora en salir: compra menos de lo que rota lento.' : 'Tu mercancía se mueve bien.',
  });
  parts.push({
    key: 'idle',
    label: 'Plata quieta',
    score: Math.round(clamp01(1 - idleShare / 0.5) * 20),
    max: 20,
    value: `${pct(idleShare)} del inventario`,
    tip: idleShare > 0.25 ? 'Mucha plata en mercancía que no se vende: haz una promoción o recupera esa plata.' : 'Poca plata quieta en mercancía.',
  });
  const snap = computeCurrentCapital(data.cap, inScope);
  const debtShare = snap.businessValue > 0 ? snap.debts / snap.businessValue : snap.debts > 0 ? 1 : 0;
  let debtScore = Math.round(clamp01(1 - debtShare / 0.5) * 20);
  if (snap.cash < 0) debtScore = Math.min(debtScore, 5);
  parts.push({
    key: 'debts',
    label: 'Deudas y caja',
    score: debtScore,
    max: 20,
    value: snap.debts > 0 ? `Debes el ${pct(debtShare)} de lo que vale` : 'Sin deudas',
    tip: snap.cash < 0 ? 'La caja calculada está en negativo: revisa si falta registrar algo.' : debtShare > 0.3 ? 'Tus deudas pesan: abona antes de comprar más.' : 'Deudas bajo control.',
  });
  const score = sum(parts.map((x) => x.score));
  const label = score >= 80 ? 'Excelente' : score >= 60 ? 'Bien' : score >= 40 ? 'Regular' : 'En riesgo';
  return { score, label, parts };
}

/* ======================= Comparación del mes ======================= */

export interface CompareRow {
  key: string;
  label: string;
  cur: number | null;
  prev: number | null;
  prevFull: number | null;
  format: 'money' | 'int' | 'pct';
  /** Qué dirección es buena. */
  good: 'up' | 'down';
}

export interface MonthCompare {
  curLabel: string;
  prevLabel: string;
  prevFullLabel: string;
  rows: CompareRow[];
}

export function monthCompare(data: AnalysisData, ids: ID[] | null, now: Date): MonthCompare {
  const curStart = periodStart('month', now);
  const prevStart = shiftPeriod('month', curStart, -1);
  const nowMinute = Math.ceil((now.getTime() + 1) / 60_000) * 60_000;
  const elapsed = nowMinute - curStart.getTime();
  const cur = periodMetrics(data, { from: curStart.toISOString(), to: new Date(nowMinute).toISOString() }, ids);
  const prev = periodMetrics(data, { from: prevStart.toISOString(), to: new Date(Math.min(prevStart.getTime() + elapsed, curStart.getTime())).toISOString() }, ids);
  const full = periodMetrics(data, periodOf('month', prevStart), ids);
  const capAt = (iso: ISODate | null) => (iso === null ? computeCurrentCapital(data.cap, scopeFor(ids)) : computeCapitalAt(data.cap, iso, scopeFor(ids)));
  const vNow = capAt(null);
  const vPrev = capAt(new Date(Math.min(prevStart.getTime() + elapsed, curStart.getTime())).toISOString());
  const vFull = capAt(curStart.toISOString());
  const row = (key: string, label: string, f: (m: PeriodMetrics) => number | null, format: CompareRow['format'], good: CompareRow['good'] = 'up'): CompareRow => ({
    key,
    label,
    cur: f(cur),
    prev: f(prev),
    prevFull: f(full),
    format,
    good,
  });
  return {
    curLabel: 'Este mes',
    prevLabel: 'Mes pasado (mismo día)',
    prevFullLabel: 'Mes pasado completo',
    rows: [
      row('sales', 'Ventas registradas', (m) => m.sales, 'int'),
      row('units', 'Unidades vendidas', (m) => m.units, 'int'),
      row('revenue', 'Ingresos', (m) => m.revenue, 'money'),
      row('cogs', 'Costo de lo vendido', (m) => m.cogs, 'money', 'down'),
      row('gross', 'Ganancia bruta', (m) => m.grossProfit, 'money'),
      row('grossMargin', 'Margen bruto', (m) => m.grossMargin, 'pct'),
      row('expenses', 'Gastos', (m) => m.expenses, 'money', 'down'),
      row('writeOffs', 'Pérdidas por bajas', (m) => m.writeOffs, 'money', 'down'),
      row('net', 'Ganancia neta', (m) => m.netProfit, 'money'),
      row('netMargin', 'Margen neto', (m) => m.netMargin, 'pct'),
      row('ticket', 'Venta promedio', (m) => m.avgTicket, 'money'),
      row('perSale', 'Ganancia por venta', (m) => m.profitPerSale, 'money'),
      row('purchases', 'Compras de mercancía', (m) => m.purchases, 'money', 'down'),
      row('collected', 'Plata cobrada', (m) => m.collected, 'money'),
      { key: 'value', label: 'Valor del negocio', cur: vNow.businessValue, prev: vPrev.businessValue, prevFull: vFull.businessValue, format: 'money', good: 'up' },
      { key: 'stock', label: 'Inventario a costo', cur: vNow.inventory, prev: vPrev.inventory, prevFull: vFull.inventory, format: 'money', good: 'up' },
    ],
  };
}

/* ======================= Tiempo para vender ======================= */

export interface SellTime {
  /** Unidades vendidas con fecha de ingreso conocida (las que cuentan para el promedio). */
  units: number;
  /** Unidades vendidas sin fecha de ingreso (no cuentan). */
  unknown: number;
  avgDays: number | null;
  medianDays: number | null;
  /** Promedio de lo vendido en los últimos 90 días. */
  avgDays90: number | null;
  buckets: { key: string; label: string; units: number; share: number }[];
  /** Por producto, del más rápido al más lento (mínimo 1 unidad con fecha). */
  byProduct: { productId: ID; name: string; units: number; avgDays: number }[];
  /** Promedio de días según el mes de la venta (12 meses). */
  months: { label: string; short: string; avgDays: number | null; units: number; partial: boolean }[];
  /** Lo que tienes ahora: cuántos días lleva esperando en promedio. */
  waiting: { avgDays: number | null; units: number };
}

const BUCKETS: [string, string, number, number][] = [
  ['0-7', '1 semana o menos', 0, 7],
  ['8-15', '8 a 15 días', 8, 15],
  ['16-30', '16 a 30 días', 16, 30],
  ['31-60', '1 a 2 meses', 31, 60],
  ['61-90', '2 a 3 meses', 61, 90],
  ['91+', 'Más de 3 meses', 91, Infinity],
];

export function sellTime(obs: SoldObservation[], aging: AgingItem[], now: Date): SellTime {
  const known = obs.filter((o) => o.days !== null);
  const days: number[] = [];
  for (const o of known) for (let i = 0; i < o.qty; i++) days.push(o.days!);
  days.sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? Math.round((sum(xs) / xs.length) * 10) / 10 : null);
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
  const from90 = new Date(now.getTime() - 90 * DAY).toISOString();
  const d90: number[] = [];
  for (const o of known) if (o.saleDate >= from90) for (let i = 0; i < o.qty; i++) d90.push(o.days!);
  const buckets = BUCKETS.map(([key, label, a, b]) => {
    const units = days.filter((d) => d >= a && d <= b).length;
    return { key, label, units, share: days.length ? units / days.length : 0 };
  });
  const byP = new Map<ID, { name: string; days: number[] }>();
  for (const o of known) {
    const x = byP.get(o.productId) ?? { name: o.productName, days: [] };
    for (let i = 0; i < o.qty; i++) x.days.push(o.days!);
    byP.set(o.productId, x);
  }
  const byProduct = [...byP.entries()].map(([productId, x]) => ({ productId, name: x.name, units: x.days.length, avgDays: avg(x.days)! })).sort((a, b) => a.avgDays - b.avgDays || b.units - a.units);
  const cur = periodStart('month', now);
  const months: SellTime['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const s = shiftPeriod('month', cur, -i);
    const p = periodOf('month', s);
    const ds: number[] = [];
    for (const o of known) if (o.saleDate >= p.from && o.saleDate < p.to) for (let k = 0; k < o.qty; k++) ds.push(o.days!);
    const nm = periodName('month', s);
    months.push({ label: nm.label, short: nm.short, avgDays: avg(ds), units: ds.length, partial: i === 0 });
  }
  const waitingDays: number[] = [];
  for (const a of aging) if (a.days !== null) for (let i = 0; i < a.qty; i++) waitingDays.push(a.days);
  return {
    units: days.length,
    unknown: sum(obs.filter((o) => o.days === null).map((o) => o.qty)),
    avgDays: avg(days),
    medianDays: median,
    avgDays90: avg(d90),
    buckets,
    byProduct,
    months,
    waiting: { avgDays: avg(waitingDays), units: sum(aging.map((a) => a.qty)) },
  };
}

/* ======================= Todo junto ======================= */

export interface BusinessAnalysis {
  at: ISODate;
  hasSales: boolean;
  health: Health;
  outlook: StockOutlook;
  pace: Pace;
  value: ValueProjection;
  expectations: ExpectationsOverview;
  months: PeriodMetrics[];
  weeks: PeriodMetrics[];
  abc: AbcResult;
  breakEven: BreakEven;
  profitFlow: WaterfallStep[];
  cashFlow: WaterfallStep[];
  /** Lo mismo del mes pasado. */
  profitFlowPrev: WaterfallStep[];
  cashFlowPrev: WaterfallStep[];
  time: ReturnType<typeof salesByTime>;
  compare: MonthCompare;
  sellTime: SellTime;
}

/** Análisis completo. `aging` y `sold` vienen de getUnsoldAging y getSoldObservations. */
export function analyzeBusiness(data: AnalysisData, ids: ID[] | null, now: Date, aging: AgingItem[] = [], sold: SoldObservation[] = []): BusinessAnalysis {
  const totalStock = sum(aging.map((a) => a.cost ?? 0));
  const idleShare = totalStock > 0 ? sum(aging.filter((a) => a.dormant).map((a) => a.cost ?? 0)) / totalStock : 0;
  const outlook = stockOutlook(data, ids, now);
  const p = pace(data, ids, now, outlook.cost);
  const monthPeriod = periodOf('month', periodStart('month', now));
  const prevPeriod = periodOf('month', shiftPeriod('month', periodStart('month', now), -1));
  return {
    at: now.toISOString(),
    hasSales: firstSaleDate(data, ids) !== null,
    health: businessHealth(data, ids, now, p, idleShare),
    outlook,
    pace: p,
    value: valueProjection(data, ids, now, outlook, p),
    expectations: expectationsOverview(data, ids, now),
    months: trend(data, 'month', 12, ids, now),
    weeks: trend(data, 'week', 12, ids, now),
    abc: abcAnalysis(data, ids, now),
    breakEven: breakEven(data, ids, now, p),
    profitFlow: profitWaterfall(data, monthPeriod, ids),
    cashFlow: cashWaterfall(data, monthPeriod, ids, now),
    profitFlowPrev: profitWaterfall(data, prevPeriod, ids),
    cashFlowPrev: cashWaterfall(data, prevPeriod, ids, now),
    time: salesByTime(data, ids, now),
    compare: monthCompare(data, ids, now),
    sellTime: sellTime(sold, aging, now),
  };
}

export async function getBusinessAnalysis(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<BusinessAnalysis> {
  const [data, aging, sold] = await Promise.all([loadAnalysisData(db), getUnsoldAging(db, inventoryIds, now), getSoldObservations(db, null, inventoryIds)]);
  return analyzeBusiness(data, inventoryIds, now, aging, sold);
}

