import type { AppDB } from '../db';
import type { ID, ISODate, Money, Movement, Product, ProductKind, Sale, SaleLine, Settings } from '../types';
import { conditionGroup } from '../catalog';
import { daysBetween, startOfDay } from '../util';
import { lotOrder } from '../lots';
import { getSettings } from './base';
import { groupKey } from './consolidated';
import { computeSaleBalance } from './sales';
import { summarizeUnits, unitCost } from './stock';
import { warrantyDisplayStatus } from './warranties';

/* ================= Periodos ================= */

export type PeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';

export interface Period {
  from: ISODate; // inclusivo
  to: ISODate; // exclusivo
}

export interface PeriodRange {
  current: Period;
  previous: Period;
  label: string;
  previousLabel: string;
}

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  today: 'Hoy',
  week: 'Semana',
  month: 'Mes',
  year: 'Año',
  custom: 'Personalizado',
};

/**
 * Rango del periodo actual (completo: hasta el final del día/semana/mes/año) y del periodo anterior comparable.
 * La comparación usa el MISMO TRAMO transcurrido (p. ej. del 1 al 9 de este mes vs. del 1 al 9 del mes anterior).
 * Los límites se redondean al minuto para que el rango sea estable (no cambie en cada render).
 */
export function periodRange(kind: PeriodKind, now = new Date(), custom?: { from: Date; to: Date }): PeriodRange {
  const today = startOfDay(now);
  let start: Date;
  let end: Date;
  let prevStart: Date;
  let label: string;
  let prevLabel: string;
  switch (kind) {
    case 'today':
      start = today;
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      prevStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      label = 'Hoy';
      prevLabel = 'Ayer a la misma hora';
      break;
    case 'week': {
      const dow = (today.getDay() + 6) % 7; // lunes = 0
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
      label = 'Esta semana';
      prevLabel = 'Mismo tramo de la semana anterior';
      break;
    }
    case 'month':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      label = 'Este mes';
      prevLabel = 'Mismo tramo del mes anterior';
      break;
    case 'year':
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today.getFullYear() + 1, 0, 1);
      prevStart = new Date(today.getFullYear() - 1, 0, 1);
      label = 'Este año';
      prevLabel = 'Mismo tramo del año anterior';
      break;
    case 'custom': {
      const f = startOfDay(custom?.from ?? today);
      const t = startOfDay(custom?.to ?? today);
      const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      const len = end.getTime() - f.getTime();
      return {
        current: { from: f.toISOString(), to: end.toISOString() },
        previous: { from: new Date(f.getTime() - len).toISOString(), to: f.toISOString() },
        label: 'Periodo seleccionado',
        previousLabel: 'Periodo anterior de igual duración',
      };
    }
  }
  const nowMinute = Math.ceil((now.getTime() + 1) / 60_000) * 60_000;
  const elapsed = nowMinute - start.getTime();
  return {
    current: { from: start.toISOString(), to: end.toISOString() },
    previous: { from: prevStart.toISOString(), to: new Date(Math.min(prevStart.getTime() + elapsed, start.getTime())).toISOString() },
    label,
    previousLabel: prevLabel,
  };
}

export function inPeriod(iso: ISODate, p: Period): boolean {
  return iso >= p.from && iso < p.to;
}

/* ================= Resumen financiero ================= */

export interface FinancialSummary {
  period: Period;
  purchases: { count: number; total: Money; units: number; extraCosts: Money };
  sales: { count: number; units: number; gross: Money; discounts: Money; total: Money };
  returns: { count: number; units: number; amount: Money; cogs: Money; refunds: Money };
  /** Ingresos netos = ventas − descuentos − devoluciones. */
  netRevenue: Money;
  /** Costo de lo vendido (neto de devoluciones), solo con costos conocidos. */
  cogs: Money;
  /** Unidades vendidas en el periodo cuyo costo es desconocido. */
  cogsUnknownUnits: number;
  grossProfit: Money;
  /** false si hay ventas sin costo conocido: la ganancia mostrada está sobrestimada. */
  profitComplete: boolean;
  operatingExpenses: Money;
  expensesByCategory: { category: string; amount: Money }[];
  /** Gastos sin inventario asignado (no incluidos cuando se filtra por inventario). */
  generalExpensesExcluded: Money;
  capitalizedExpenses: Money;
  writeOffs: Money;
  netProfit: Money;
  /** Dinero efectivamente recibido en el periodo (pagos − reembolsos). */
  collected: Money;
  initialStock: { units: number; value: Money; unknownCostUnits: number };
}

/**
 * Resumen de ACTIVIDAD del periodo. Las ventas y compras anuladas no cuentan.
 * Si `inventoryIds` es null, incluye todos los inventarios.
 */
export async function getFinancialSummary(db: AppDB, period: Period, inventoryIds: ID[] | null): Promise<FinancialSummary> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID | null) => (invSet ? id !== null && invSet.has(id) : true);

  const [purchases, sales, returns, expenses, payments, movements] = await Promise.all([
    db.purchases.where('date').between(period.from, period.to, true, false).toArray(),
    db.sales.toArray(),
    db.returns.where('date').between(period.from, period.to, true, false).toArray(),
    db.expenses.where('date').between(period.from, period.to, true, false).toArray(),
    db.payments.where('date').between(period.from, period.to, true, false).toArray(),
    db.movements.where('at').between(period.from, period.to, true, false).toArray(),
  ]);
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const voidedSales = new Set(sales.filter((s) => s.status === 'voided').map((s) => s.id));

  // Compras
  const ps = purchases.filter((p) => p.status === 'active' && inInv(p.inventoryId));
  const pLines = ps.length ? await db.purchaseLines.where('purchaseId').anyOf(ps.map((p) => p.id)).toArray() : [];
  const purchasesOut = {
    count: ps.length,
    total: ps.reduce((a, p) => a + p.total, 0),
    units: pLines.reduce((a, l) => a + l.quantity, 0),
    extraCosts: ps.reduce((a, p) => a + p.extraCosts, 0),
  };

  // Ventas del periodo
  const ss = sales.filter((s) => s.status === 'active' && inInv(s.inventoryId) && inPeriod(s.date, period));
  const sLines = ss.length ? await db.saleLines.where('saleId').anyOf(ss.map((s) => s.id)).toArray() : [];
  const salesOut = {
    count: ss.length,
    units: sLines.reduce((a, l) => a + l.quantity, 0),
    gross: ss.reduce((a, s) => a + s.subtotal, 0),
    discounts: ss.reduce((a, s) => a + s.discount, 0),
    total: ss.reduce((a, s) => a + s.total, 0),
  };
  let cogs = sLines.reduce((a, l) => a + l.cogs, 0);
  let cogsUnknownUnits = sLines.reduce((a, l) => a + l.cogsUnknownQty, 0);

  // Devoluciones registradas en el periodo
  const rs = returns.filter((r) => !voidedSales.has(r.saleId) && inInv(r.inventoryId));
  const returnsOut = {
    count: rs.length,
    units: rs.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.quantity, 0), 0),
    amount: rs.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.amount, 0), 0),
    cogs: rs.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.cogs, 0), 0),
    refunds: rs.reduce((a, r) => a + r.refundAmount, 0),
  };
  cogs -= returnsOut.cogs;
  cogsUnknownUnits -= rs.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.unknownQty, 0), 0);
  cogsUnknownUnits = Math.max(0, cogsUnknownUnits);

  const netRevenue = salesOut.total - returnsOut.amount;
  const grossProfit = netRevenue - cogs;

  // Gastos
  const activeExp = expenses.filter((e) => e.status === 'active');
  const op = activeExp.filter((e) => e.treatment === 'operating');
  const opIn = op.filter((e) => inInv(e.inventoryId));
  const generalExcluded = invSet ? op.filter((e) => e.inventoryId === null).reduce((a, e) => a + e.amount, 0) : 0;
  const byCat = new Map<string, Money>();
  for (const e of opIn) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const operatingExpenses = opIn.reduce((a, e) => a + e.amount, 0);
  const capitalizedExpenses = activeExp
    .filter((e) => e.treatment === 'capitalized' && inInv(e.inventoryId))
    .reduce((a, e) => a + e.amount, 0);

  // Bajas (pérdidas reconocidas)
  const mv = movements.filter((m) => inInv(m.inventoryId));
  const writeOffs = mv.reduce((a, m) => a + m.writeOff, 0);

  // Stock inicial (no es compra)
  const init = mv.filter((m) => m.type === 'initial');
  const initialStock = {
    units: init.reduce((a, m) => a + m.qtyDelta, 0),
    value: init.reduce((a, m) => a + m.costDelta, 0),
    unknownCostUnits: init.reduce((a, m) => a + m.unknownDelta, 0),
  };

  // Cobros efectivos
  const pays = payments.filter((p) => !voidedSales.has(p.saleId) && inInv(p.inventoryId) && saleById.has(p.saleId));
  const collected = pays.reduce((a, p) => a + (p.kind === 'payment' ? p.amount : -p.amount), 0);

  return {
    period,
    purchases: purchasesOut,
    sales: salesOut,
    returns: returnsOut,
    netRevenue,
    cogs,
    cogsUnknownUnits,
    grossProfit,
    profitComplete: cogsUnknownUnits === 0,
    operatingExpenses,
    expensesByCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    generalExpensesExcluded: generalExcluded,
    capitalizedExpenses,
    writeOffs,
    netProfit: grossProfit - operatingExpenses - writeOffs,
    collected,
    initialStock,
  };
}

/* ================= Saldos acumulados (a hoy) ================= */

export interface Balances {
  receivables: Money;
  receivableSales: number;
  customerCredit: Money;
  available: number;
  stockValue: Money;
  unknownCostCount: number;
  inReview: number;
  damaged: number;
  otherValue: Money;
}

export async function getBalances(db: AppDB, inventoryIds: ID[] | null): Promise<Balances> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID) => (invSet ? invSet.has(id) : true);
  const [sales, lines, payments, products, units] = await Promise.all([
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.payments.toArray(),
    db.products.toArray(),
    db.units.toArray(),
  ]);
  const linesBySale = groupBy(lines, (l) => l.saleId);
  const paysBySale = groupBy(payments, (p) => p.saleId);
  let receivables = 0;
  let receivableSales = 0;
  let customerCredit = 0;
  for (const s of sales) {
    if (s.status !== 'active' || !inInv(s.inventoryId)) continue;
    const b = computeSaleBalance(s, linesBySale.get(s.id) ?? [], paysBySale.get(s.id) ?? []);
    if (b.pending > 0) {
      receivables += b.pending;
      receivableSales++;
    }
    customerCredit += b.credit;
  }
  const qtyProducts = products.filter((p) => p.tracking === 'quantity' && inInv(p.inventoryId));
  const us = summarizeUnits(units.filter((u) => inInv(u.inventoryId)));
  return {
    receivables,
    receivableSales,
    customerCredit,
    available: us.available + qtyProducts.reduce((a, p) => a + p.qty, 0),
    stockValue: us.availableValue + qtyProducts.reduce((a, p) => a + p.stockValue, 0),
    unknownCostCount: us.unknownCostCount + qtyProducts.reduce((a, p) => a + p.unknownCostQty, 0),
    inReview: us.inReview,
    damaged: us.damaged,
    otherValue: us.otherValue,
  };
}

function groupBy<T>(arr: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/* ================= Antigüedad (FIFO) y velocidad de venta ================= */

interface Layer {
  date: ISODate | null; // null = fecha desconocida
  qty: number;
}

export interface FifoResult {
  layers: Layer[];
  /** Para cada salida por venta: días desde el ingreso hasta la venta (null si se desconoce). */
  sold: { saleId: ID; at: ISODate; qty: number; days: number | null }[];
}

/**
 * Reconstruye capas FIFO de un producto por cantidad a partir de sus movimientos.
 * Las ventas/compras anuladas se ignoran (como si no hubieran existido). Solo para TIEMPOS;
 * el costo usa promedio ponderado.
 */
export function replayFifo(movs: Movement[], voidedSales: Set<ID>, voidedPurchases: Set<ID>): FifoResult {
  const layers: Layer[] = [];
  const sold: FifoResult['sold'] = [];
  const sorted = [...movs].sort((a, b) => a.seq - b.seq);
  for (const m of sorted) {
    if (m.qtyDelta === 0) continue;
    if ((m.type === 'sale' || m.type === 'void_sale') && m.refId && voidedSales.has(m.refId)) continue;
    if ((m.type === 'purchase' || m.type === 'void_purchase') && m.refId && voidedPurchases.has(m.refId)) continue;
    if (m.qtyDelta > 0) {
      layers.push({ date: m.dateUnknown ? null : m.at, qty: m.qtyDelta });
    } else {
      let need = -m.qtyDelta;
      while (need > 0 && layers.length) {
        const L = layers[0];
        const take = Math.min(need, L.qty);
        if (m.type === 'sale' && m.refId)
          sold.push({ saleId: m.refId, at: m.at, qty: take, days: L.date ? Math.max(0, daysBetween(L.date, m.at)) : null });
        L.qty -= take;
        need -= take;
        if (L.qty === 0) layers.shift();
      }
    }
  }
  return { layers, sold };
}

export interface AgingItem {
  type: 'unit' | 'lot';
  inventoryId: ID;
  productId: ID;
  productName: string;
  kind: ProductKind;
  unitId: ID | null;
  /** Lote (productos por cantidad con lotes). */
  lotId?: ID | null;
  code: string;
  qty: number;
  since: ISODate | null;
  days: number | null;
  cost: Money | null;
  status: string;
  /** Estado del equipo (Nuevo / Usado / Restaurado); vacío en productos por cantidad. */
  condition: string;
  /** Días a partir de los cuales se considera "dinero dormido" (según el estado del equipo). */
  dormantDays: number;
  /** Umbral de aviso de estancado (null = avisos desactivados). */
  staleDays: number | null;
  /** true si supera el umbral de aviso de estancado. */
  stale: boolean;
  /** true si supera el umbral de dinero dormido (aunque los avisos estén desactivados). */
  dormant: boolean;
}

/**
 * Días para considerar un producto estancado según su estado:
 * - nuevos → umbral de nuevos (o el general); usados/restaurados → umbral de usados (o el general).
 * Con `forAlerts`, devuelve null si los avisos de estancado están desactivados.
 */
export function staleThreshold(settings: Pick<Settings, 'staleEnabled' | 'staleDays' | 'staleDaysNew' | 'staleDaysUsed'>, condition: string | null, forAlerts = true): number | null {
  if (forAlerts && settings.staleEnabled === false) return null;
  const g = conditionGroup(condition);
  if (g === 'new') return settings.staleDaysNew ?? settings.staleDays;
  if (g === 'used') return settings.staleDaysUsed ?? settings.staleDays;
  return settings.staleDays;
}

/** Existencias sin vender y su antigüedad. Las de fecha desconocida se devuelven con days = null. */
export async function getUnsoldAging(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<AgingItem[]> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID) => (invSet ? invSet.has(id) : true);
  const settings = await getSettings(db);
  const flags = (days: number | null, condition: string) => {
    const staleDays = staleThreshold(settings, condition, true);
    const dormantDays = staleThreshold(settings, condition, false)!;
    return {
      condition,
      staleDays,
      dormantDays,
      stale: days !== null && staleDays !== null && days >= staleDays,
      dormant: days !== null && days >= dormantDays,
    };
  };
  const products = (await db.products.toArray()).filter((p) => inInv(p.inventoryId));
  const pById = new Map(products.map((p) => [p.id, p]));
  const items: AgingItem[] = [];
  const units = (await db.units.toArray()).filter(
    (u) => inInv(u.inventoryId) && (u.status === 'available' || u.status === 'in_review' || u.status === 'damaged'),
  );
  for (const u of units) {
    const p = pById.get(u.productId);
    if (!p) continue;
    const days = u.availableSince ? daysBetween(u.availableSince, now) : null;
    items.push({
      ...flags(days, u.condition),
      type: 'unit',
      inventoryId: u.inventoryId,
      productId: p.id,
      productName: p.name,
      kind: p.kind,
      unitId: u.id,
      code: u.code,
      qty: 1,
      since: u.availableSince,
      days,
      cost: unitCost(u),
      status: u.status,
    });
  }
  const qtyProducts = products.filter((p) => p.tracking === 'quantity' && p.qty > 0);
  if (qtyProducts.length) {
    const { voidedSales, voidedPurchases } = await voidedSets(db);
    const movs = await db.movements.where('productId').anyOf(qtyProducts.map((p) => p.id)).toArray();
    const byP = groupBy(movs, (m) => m.productId);
    const lotProducts = qtyProducts.filter((p) => p.costing === 'lots');
    const lotsByP = groupBy(lotProducts.length ? await db.lots.where('productId').anyOf(lotProducts.map((p) => p.id)).toArray() : [], (l) => l.productId);
    for (const p of qtyProducts) {
      if (p.costing === 'lots') {
        // Con lotes: cada lote es una capa con su fecha y su costo real
        for (const l of (lotsByP.get(p.id) ?? []).filter((x) => x.qty > 0).sort(lotOrder)) {
          const days = l.date ? daysBetween(l.date, now) : null;
          items.push({
            ...flags(days, ''),
            type: 'lot',
            inventoryId: p.inventoryId,
            productId: p.id,
            productName: p.name,
            kind: p.kind,
            unitId: null,
            lotId: l.id,
            code: '',
            qty: l.qty,
            since: l.date,
            days,
            cost: l.costKnown ? l.value : null,
            status: 'available',
          });
        }
        continue;
      }
      const { layers } = replayFifo(byP.get(p.id) ?? [], voidedSales, voidedPurchases);
      const avg = p.qty - p.unknownCostQty > 0 ? Math.round(p.stockValue / (p.qty - p.unknownCostQty)) : null;
      for (const L of layers) {
        if (L.qty <= 0) continue;
        const days = L.date ? daysBetween(L.date, now) : null;
        items.push({
          ...flags(days, ''),
          type: 'lot',
          inventoryId: p.inventoryId,
          productId: p.id,
          productName: p.name,
          kind: p.kind,
          unitId: null,
          code: '',
          qty: L.qty,
          since: L.date,
          days,
          cost: avg === null ? null : avg * L.qty,
          status: 'available',
        });
      }
    }
  }
  return items.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
}

async function voidedSets(db: AppDB) {
  const [sales, purchases] = await Promise.all([db.sales.toArray(), db.purchases.toArray()]);
  return {
    voidedSales: new Set(sales.filter((s) => s.status === 'voided').map((s) => s.id)),
    voidedPurchases: new Set(purchases.filter((p) => p.status === 'voided').map((p) => p.id)),
  };
}

export interface SoldObservation {
  saleId: ID;
  inventoryId: ID;
  productId: ID;
  productName: string;
  groupKey: string;
  kind: ProductKind;
  code: string;
  qty: number;
  saleDate: ISODate;
  since: ISODate | null;
  days: number | null;
}

/** Observaciones de tiempo hasta vender (ventas activas del periodo; se excluyen líneas devueltas por completo). */
export async function getSoldObservations(db: AppDB, period: Period | null, inventoryIds: ID[] | null): Promise<SoldObservation[]> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID) => (invSet ? invSet.has(id) : true);
  const sales = (await db.sales.toArray()).filter(
    (s) => s.status === 'active' && inInv(s.inventoryId) && (!period || inPeriod(s.date, period)),
  );
  if (!sales.length) return [];
  const saleById = new Map<ID, Sale>(sales.map((s) => [s.id, s]));
  const lines = await db.saleLines.where('saleId').anyOf([...saleById.keys()]).toArray();
  const products = new Map((await db.products.toArray()).map((p) => [p.id, p]));
  const units = new Map((await db.units.where('id').anyOf(lines.filter((l) => l.unitId).map((l) => l.unitId!)).toArray()).map((u) => [u.id, u]));
  const out: SoldObservation[] = [];
  const qtyLines: SaleLine[] = [];
  for (const l of lines) {
    const p = products.get(l.productId);
    const s = saleById.get(l.saleId)!;
    if (!p) continue;
    if (l.returnedQty >= l.quantity) continue;
    if (l.unitId) {
      out.push({
        saleId: s.id,
        inventoryId: s.inventoryId,
        productId: p.id,
        productName: p.name,
        groupKey: groupKey(p),
        kind: p.kind,
        code: units.get(l.unitId)?.code ?? '',
        qty: 1,
        saleDate: s.date,
        since: l.cycleStart,
        days: l.cycleStart ? Math.max(0, daysBetween(l.cycleStart, s.date)) : null,
      });
    } else qtyLines.push(l);
  }
  if (qtyLines.length) {
    const pids = [...new Set(qtyLines.map((l) => l.productId))];
    const { voidedSales, voidedPurchases } = await voidedSets(db);
    const movs = await db.movements.where('productId').anyOf(pids).toArray();
    const byP = groupBy(movs, (m) => m.productId);
    // Líneas vendidas con lotes: la fecha de ingreso de cada lote es exacta
    const lotSales = new Set<string>();
    for (const l of qtyLines) {
      if (!l.lotAllocations?.length) continue;
      const p = products.get(l.productId)!;
      const s = saleById.get(l.saleId)!;
      lotSales.add(`${l.saleId}|${l.productId}`);
      let remaining = l.quantity - l.returnedQty;
      for (const t of l.lotAllocations) {
        const q = Math.min(t.qty, remaining);
        if (q <= 0) break;
        remaining -= q;
        out.push({
          saleId: s.id,
          inventoryId: s.inventoryId,
          productId: p.id,
          productName: p.name,
          groupKey: groupKey(p),
          kind: p.kind,
          code: '',
          qty: q,
          saleDate: s.date,
          since: t.date,
          days: t.date ? Math.max(0, daysBetween(t.date, s.date)) : null,
        });
      }
    }
    for (const pid of pids) {
      const p = products.get(pid)!;
      const { sold } = replayFifo(byP.get(pid) ?? [], voidedSales, voidedPurchases);
      for (const o of sold) {
        const s = saleById.get(o.saleId);
        if (!s) continue;
        if (lotSales.has(`${o.saleId}|${pid}`)) continue;
        out.push({
          saleId: s.id,
          inventoryId: s.inventoryId,
          productId: p.id,
          productName: p.name,
          groupKey: groupKey(p),
          kind: p.kind,
          code: '',
          qty: o.qty,
          saleDate: s.date,
          since: null,
          days: o.days,
        });
      }
    }
  }
  return out;
}

export interface VelocityStat {
  key: string;
  label: string;
  count: number; // unidades con fecha conocida
  unknown: number; // unidades sin fecha conocida (excluidas del promedio)
  avgDays: number | null;
  minDays: number | null;
  maxDays: number | null;
}

export function velocityBy(obs: SoldObservation[], keyFn: (o: SoldObservation) => { key: string; label: string }): VelocityStat[] {
  const m = new Map<string, { label: string; days: number[]; unknown: number }>();
  for (const o of obs) {
    const k = keyFn(o);
    const e = m.get(k.key) ?? { label: k.label, days: [], unknown: 0 };
    if (o.days === null) e.unknown += o.qty;
    else for (let i = 0; i < o.qty; i++) e.days.push(o.days);
    m.set(k.key, e);
  }
  return [...m.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      count: e.days.length,
      unknown: e.unknown,
      avgDays: e.days.length ? Math.round((e.days.reduce((a, b) => a + b, 0) / e.days.length) * 10) / 10 : null,
      minDays: e.days.length ? Math.min(...e.days) : null,
      maxDays: e.days.length ? Math.max(...e.days) : null,
    }))
    .sort((a, b) => (a.avgDays ?? Infinity) - (b.avgDays ?? Infinity));
}

export interface TopSeller {
  key: string;
  name: string;
  units: number;
  revenue: Money;
  cogs: Money;
  unknownCost: number;
  available: number;
  /** % vendido = vendidas / (vendidas + disponibles ahora). */
  sellThrough: number;
}

export async function getTopSellers(db: AppDB, period: Period, inventoryIds: ID[] | null): Promise<TopSeller[]> {
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID) => (invSet ? invSet.has(id) : true);
  const sales = (await db.sales.toArray()).filter((s) => s.status === 'active' && inInv(s.inventoryId) && inPeriod(s.date, period));
  const lines = sales.length ? await db.saleLines.where('saleId').anyOf(sales.map((s) => s.id)).toArray() : [];
  const products = (await db.products.toArray()).filter((p) => inInv(p.inventoryId));
  const pById = new Map<ID, Product>(products.map((p) => [p.id, p]));
  const m = new Map<string, TopSeller>();
  for (const l of lines) {
    const p = pById.get(l.productId);
    if (!p) continue;
    const k = groupKey(p);
    const t = m.get(k) ?? { key: k, name: p.name, units: 0, revenue: 0, cogs: 0, unknownCost: 0, available: 0, sellThrough: 0 };
    const netQty = l.quantity - l.returnedQty;
    t.units += netQty;
    t.revenue += l.netAmount - l.returnedAmount;
    t.cogs += l.cogs - l.returnedCogs;
    t.unknownCost += l.cogsUnknownQty - l.returnedUnknownQty;
    m.set(k, t);
  }
  if (m.size) {
    const unitList = await db.units.where('status').equals('available').toArray();
    for (const p of products) {
      const t = m.get(groupKey(p));
      if (!t) continue;
      t.available += p.tracking === 'quantity' ? p.qty : unitList.filter((u) => u.productId === p.id).length;
    }
  }
  return [...m.values()]
    .filter((t) => t.units > 0)
    .map((t) => ({ ...t, sellThrough: t.units + t.available > 0 ? t.units / (t.units + t.available) : 0 }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue);
}

/* ================= Avisos ================= */

export interface Alerts {
  lowStock: { productId: ID; name: string; inventoryId: ID; available: number; threshold: number }[];
  stale: AgingItem[];
  warrantiesExpiring: { warrantyId: ID; endDate: ISODate; daysLeft: number }[];
  openClaims: number;
  duplicateIdentifiers: { identifier: string; codes: string[] }[];
  duplicateProducts: { name: string; inventoryId: ID; count: number }[];
  receivables: { count: number; amount: Money };
  unknownCostUnits: number;
  unknownDateUnits: number;
  backupDue: boolean;
  lastBackupAt: ISODate | null;
}

export async function getAlerts(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<Alerts> {
  const settings = await getSettings(db);
  const invSet = inventoryIds ? new Set(inventoryIds) : null;
  const inInv = (id: ID) => (invSet ? invSet.has(id) : true);
  const [products, units, warranties, claims, lastBackup, invCount] = await Promise.all([
    db.products.toArray(),
    db.units.toArray(),
    db.warranties.toArray(),
    db.warrantyClaims.toArray(),
    db.meta.get('lastBackupAt'),
    db.inventories.count(),
  ]);
  const activeInv = new Set((await db.inventories.toArray()).filter((i) => !i.archived).map((i) => i.id));
  const ps = products.filter((p) => inInv(p.inventoryId) && !p.archived && activeInv.has(p.inventoryId));
  const unitsByP = groupBy(units, (u) => u.productId);

  const lowStock: Alerts['lowStock'] = [];
  for (const p of ps) {
    if (p.lowStockThreshold === null) continue;
    const available = p.tracking === 'quantity' ? p.qty : (unitsByP.get(p.id) ?? []).filter((u) => u.status === 'available').length;
    if (available <= p.lowStockThreshold) lowStock.push({ productId: p.id, name: p.name, inventoryId: p.inventoryId, available, threshold: p.lowStockThreshold });
  }

  const aging = await getUnsoldAging(db, inventoryIds, now);
  const stale = aging.filter((a) => a.stale && activeInv.has(a.inventoryId));

  const warrantiesExpiring: Alerts['warrantiesExpiring'] = [];
  for (const w of warranties) {
    if (w.type !== 'customer' || !inInv(w.inventoryId)) continue;
    if (warrantyDisplayStatus(w, settings.warrantyAlertDays, now) === 'por_vencer')
      warrantiesExpiring.push({ warrantyId: w.id, endDate: w.endDate, daysLeft: daysBetween(now.toISOString(), w.endDate) });
  }
  const wIds = new Set(warranties.filter((w) => inInv(w.inventoryId)).map((w) => w.id));
  const openClaims = claims.filter((c) => wIds.has(c.warrantyId) && (c.status === 'open' || c.status === 'in_progress')).length;

  // Identificadores repetidos entre unidades en existencia
  const inStock = units.filter((u) => inInv(u.inventoryId) && ['available', 'in_review', 'damaged'].includes(u.status));
  const idMap = new Map<string, string[]>();
  for (const u of inStock) {
    for (const ident of [u.imei, u.imei2, u.serial]) {
      if (!ident) continue;
      const arr = idMap.get(ident) ?? [];
      if (!arr.includes(u.code)) arr.push(u.code);
      idMap.set(ident, arr);
    }
  }
  const duplicateIdentifiers = [...idMap.entries()].filter(([, c]) => c.length > 1).map(([identifier, codes]) => ({ identifier, codes }));

  const nameMap = new Map<string, { name: string; inventoryId: ID; count: number }>();
  for (const p of ps) {
    const k = `${p.inventoryId}|${groupKey(p)}`;
    const e = nameMap.get(k) ?? { name: p.name, inventoryId: p.inventoryId, count: 0 };
    e.count++;
    nameMap.set(k, e);
  }
  const duplicateProducts = [...nameMap.values()].filter((e) => e.count > 1);

  const bal = await getBalances(db, inventoryIds);
  const unknownDateUnits =
    inStock.filter((u) => !u.availableSince).length +
    aging.filter((a) => a.type === 'lot' && a.days === null).reduce((a, x) => a + x.qty, 0);

  const lastBackupAt = lastBackup?.value ?? null;
  const hasData = invCount > 0;
  const backupDue =
    hasData &&
    settings.backupReminderDays > 0 &&
    (!lastBackupAt || daysBetween(lastBackupAt, now) >= settings.backupReminderDays);

  return {
    lowStock,
    stale,
    warrantiesExpiring: warrantiesExpiring.sort((a, b) => a.daysLeft - b.daysLeft),
    openClaims,
    duplicateIdentifiers,
    duplicateProducts,
    receivables: { count: bal.receivableSales, amount: bal.receivables },
    unknownCostUnits: bal.unknownCostCount,
    unknownDateUnits,
    backupDue,
    lastBackupAt,
  };
}
