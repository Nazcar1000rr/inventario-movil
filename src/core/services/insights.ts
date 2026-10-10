import type { AppDB } from '../db';
import type { ID, Money, Settings } from '../types';
import { daysBetween } from '../util';
import { getSettings } from './base';
import { computeCapitalAt, computeCurrentCapital, loadCapitalData, monthLabel, scopeFor, type CapitalSnapshot } from './capital';
import { groupKey } from './consolidated';
import { getFinancialSummary, getSoldObservations, getTopSellers, velocityBy, type FinancialSummary, type Period, type TopSeller } from './reports';

/* ================= Ganancia por día por modelo ================= */

export interface ModelProfitStat {
  key: string;
  label: string;
  units: number;
  revenue: Money;
  cost: Money;
  profit: Money;
  avgProfit: Money;
  avgDays: number;
  /** Ganancia total ÷ días totales en inventario: cuánto te deja cada día que el equipo estuvo esperando. */
  profitPerDay: Money;
  /** Ganancia ÷ (costo × días): rendimiento diario del dinero invertido (×30 ≈ mensual). */
  dailyReturn: number | null;
  /** Ventas excluidas por costo o fecha desconocidos. */
  excluded: number;
}

/**
 * Ganancia por día por modelo (solo equipos controlados por unidad, con costo y fecha conocidos).
 * Días = desde que el equipo quedó disponible hasta la venta (mínimo 1).
 */
export async function getProfitPerDay(db: AppDB, period: Period | null, inventoryIds: ID[] | null): Promise<ModelProfitStat[]> {
  const inScope = scopeFor(inventoryIds);
  const sales = (await db.sales.toArray()).filter(
    (s) => s.status === 'active' && inScope(s.inventoryId) && (!period || (s.date >= period.from && s.date < period.to)),
  );
  if (!sales.length) return [];
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const lines = (await db.saleLines.where('saleId').anyOf([...saleById.keys()]).toArray()).filter((l) => l.unitId && l.returnedQty < l.quantity);
  const products = new Map((await db.products.toArray()).map((p) => [p.id, p]));
  const m = new Map<string, { label: string; units: number; revenue: number; cost: number; days: number; costDays: number; excluded: number }>();
  for (const l of lines) {
    const p = products.get(l.productId);
    if (!p) continue;
    const k = groupKey(p);
    const e = m.get(k) ?? { label: p.name, units: 0, revenue: 0, cost: 0, days: 0, costDays: 0, excluded: 0 };
    const s = saleById.get(l.saleId)!;
    if (l.cogsUnknownQty > 0 || !l.cycleStart) {
      e.excluded++;
      m.set(k, e);
      continue;
    }
    const days = Math.max(1, daysBetween(l.cycleStart, s.date));
    e.units++;
    e.revenue += l.netAmount;
    e.cost += l.cogs;
    e.days += days;
    e.costDays += l.cogs * days;
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([key, e]) => {
      const profit = e.revenue - e.cost;
      return {
        key,
        label: e.label,
        units: e.units,
        revenue: e.revenue,
        cost: e.cost,
        profit,
        avgProfit: e.units ? Math.round(profit / e.units) : 0,
        avgDays: e.units ? Math.round((e.days / e.units) * 10) / 10 : 0,
        profitPerDay: e.days ? Math.round(profit / e.days) : 0,
        dailyReturn: e.costDays > 0 ? profit / e.costDays : null,
        excluded: e.excluded,
      };
    })
    .sort((a, b) => (b.units > 0 ? 1 : 0) - (a.units > 0 ? 1 : 0) || b.profitPerDay - a.profitPerDay);
}

/* ================= Calificación de proveedores ================= */

export interface SupplierScore {
  supplierId: ID;
  name: string;
  unitsBought: number;
  spent: Money;
  inStock: number;
  /** Ventas de equipos de este proveedor (incluye las que luego se devolvieron). */
  sold: number;
  avgProfit: Money | null;
  /** Ganancia ÷ costo de los equipos vendidos. */
  avgMargin: number | null;
  avgDays: number | null;
  returns: number;
  claims: number;
  /** Equipos con piezas genéricas o aviso de "pieza desconocida" que no cambiaste tú. */
  partIssues: number;
  /** (devoluciones + reclamos) ÷ ventas. */
  problemRate: number | null;
  /** Puntaje 0–100 (null si aún no hay ventas). */
  score: number | null;
  scoreParts: { margin: number; speed: number; quality: number } | null;
  /** true si hay al menos 3 ventas: con menos el puntaje es poco confiable. */
  enoughData: boolean;
}

/**
 * Puntaje de 0 a 100 = margen (hasta 40) + rapidez (hasta 30) + calidad (hasta 30):
 * - margen: 2 puntos por cada 1 % de margen sobre el costo (20 % o más = 40);
 * - rapidez: 30 si se vende el mismo día, baja en línea recta hasta 0 a los 90 días;
 * - calidad: 30 − 60 × (devoluciones + reclamos) ÷ ventas − 30 × equipos con piezas genéricas/aviso ÷ comprados (mínimo 0).
 */
export function supplierScoreParts(avgMargin: number, avgDays: number, problemRate: number, partIssueRate: number) {
  const margin = Math.max(0, Math.min(40, avgMargin * 100 * 2));
  const speed = 30 * Math.max(0, Math.min(1, 1 - avgDays / 90));
  const quality = Math.max(0, 30 - 60 * problemRate - 30 * partIssueRate);
  return { margin: Math.round(margin), speed: Math.round(speed), quality: Math.round(quality) };
}

export async function getSupplierScores(db: AppDB, inventoryIds: ID[] | null): Promise<SupplierScore[]> {
  const inScope = scopeFor(inventoryIds);
  const [suppliers, purchases, units, sales, lines, warranties, claims] = await Promise.all([
    db.suppliers.toArray(),
    db.purchases.toArray(),
    db.units.toArray(),
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.warranties.toArray(),
    db.warrantyClaims.toArray(),
  ]);
  const activePurchases = new Map(purchases.filter((p) => p.status === 'active' && inScope(p.inventoryId)).map((p) => [p.id, p]));
  const activeSales = new Map(sales.filter((s) => s.status === 'active').map((s) => [s.id, s]));
  const unitsBySupplier = new Map<ID, typeof units>();
  for (const u of units) {
    if (!u.supplierId || !u.purchaseId || !activePurchases.has(u.purchaseId)) continue;
    const a = unitsBySupplier.get(u.supplierId) ?? [];
    a.push(u);
    unitsBySupplier.set(u.supplierId, a);
  }
  const linesByUnit = new Map<ID, typeof lines>();
  for (const l of lines) {
    if (!l.unitId || !activeSales.has(l.saleId)) continue;
    const a = linesByUnit.get(l.unitId) ?? [];
    a.push(l);
    linesByUnit.set(l.unitId, a);
  }
  const claimsByWarranty = new Map<ID, number>();
  for (const c of claims) claimsByWarranty.set(c.warrantyId, (claimsByWarranty.get(c.warrantyId) ?? 0) + 1);
  const claimsByUnit = new Map<ID, number>();
  for (const w of warranties) if (w.type === 'customer' && w.unitId) claimsByUnit.set(w.unitId, (claimsByUnit.get(w.unitId) ?? 0) + (claimsByWarranty.get(w.id) ?? 0));

  const out: SupplierScore[] = [];
  for (const s of suppliers) {
    const us = unitsBySupplier.get(s.id) ?? [];
    const spent = [...activePurchases.values()].filter((p) => p.supplierId === s.id).reduce((a, p) => a + p.total, 0);
    if (!us.length && !spent) continue;
    let sold = 0;
    let returns = 0;
    let claimCount = 0;
    let partIssues = 0;
    let profitSum = 0;
    let costSum = 0;
    let profitN = 0;
    let daysSum = 0;
    let daysN = 0;
    for (const u of us) {
      if ((u.partsHistory ?? []).some((x) => x.by !== 'me' && (x.quality === 'generic' || x.unknownPartWarning))) partIssues++;
      claimCount += claimsByUnit.get(u.id) ?? 0;
      for (const l of linesByUnit.get(u.id) ?? []) {
        sold++;
        if (l.returnedQty > 0) {
          returns++;
          continue;
        }
        const sale = activeSales.get(l.saleId)!;
        if (l.cogsUnknownQty === 0 && l.cogs > 0) {
          profitSum += l.netAmount - l.cogs;
          costSum += l.cogs;
          profitN++;
        }
        if (l.cycleStart) {
          daysSum += Math.max(0, daysBetween(l.cycleStart, sale.date));
          daysN++;
        }
      }
    }
    const avgMargin = costSum > 0 ? profitSum / costSum : null;
    const avgDays = daysN ? Math.round((daysSum / daysN) * 10) / 10 : null;
    const problemRate = sold ? (returns + claimCount) / sold : null;
    const partIssueRate = us.length ? partIssues / us.length : 0;
    const parts = avgMargin !== null && avgDays !== null && problemRate !== null ? supplierScoreParts(avgMargin, avgDays, problemRate, partIssueRate) : null;
    out.push({
      supplierId: s.id,
      name: s.name,
      unitsBought: us.length,
      spent,
      inStock: us.filter((u) => u.status === 'available' || u.status === 'in_review' || u.status === 'damaged').length,
      sold,
      avgProfit: profitN ? Math.round(profitSum / profitN) : null,
      avgMargin,
      avgDays,
      returns,
      claims: claimCount,
      partIssues,
      problemRate,
      score: parts ? parts.margin + parts.speed + parts.quality : null,
      scoreParts: parts,
      enoughData: sold >= 3,
    });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.unitsBought - a.unitsBought);
}

/* ================= Resumen mensual ================= */

export interface MonthlySummary {
  key: string;
  label: string;
  period: Period;
  businessName: string;
  generatedAt: string;
  fin: FinancialSummary;
  start: CapitalSnapshot;
  end: CapitalSnapshot;
  /** Crecimiento del negocio en el mes (sin contar aportes ni retiros). */
  growthInMonth: Money;
  /** Variación del valor del negocio en el mes (incluye aportes y retiros). */
  valueChange: Money;
  topSellers: TopSeller[];
  bestProfitPerDay: ModelProfitStat[];
  avgDaysToSell: number | null;
  debtsOpen: { count: number; amount: Money };
  partial: boolean;
}

export function monthPeriod(monthStart: Date): Period {
  const s = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const e = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  return { from: s.toISOString(), to: e.toISOString() };
}

export async function getMonthlySummary(db: AppDB, monthStart: Date, inventoryIds: ID[] | null, now = new Date()): Promise<MonthlySummary> {
  const settings: Settings = await getSettings(db);
  const period = monthPeriod(monthStart);
  const inScope = scopeFor(inventoryIds);
  const data = await loadCapitalData(db);
  const partial = period.to > now.toISOString();
  const start = computeCapitalAt(data, period.from, inScope);
  const end = partial ? computeCurrentCapital(data, inScope) : computeCapitalAt(data, period.to, inScope);
  const [fin, top, ppd, obs] = await Promise.all([
    getFinancialSummary(db, period, inventoryIds),
    getTopSellers(db, period, inventoryIds),
    getProfitPerDay(db, period, inventoryIds),
    getSoldObservations(db, period, inventoryIds),
  ]);
  const all = velocityBy(obs, () => ({ key: 'all', label: 'Todo' }))[0];
  // Deudas pendientes al cierre del mes
  const cut = (d: string) => partial || d < period.to;
  const openDebts = data.debts.filter((d) => {
    if (d.status === 'voided' || !inScope(d.inventoryId) || !cut(d.date)) return false;
    const paid = data.debtPayments.filter((x) => x.debtId === d.id && cut(x.date)).reduce((a, x) => a + x.principal, 0);
    return d.principal - paid > 0;
  });
  const s = new Date(period.from);
  return {
    key: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`,
    label: monthLabel(s),
    period,
    businessName: settings.businessName,
    generatedAt: now.toISOString(),
    fin,
    start,
    end,
    growthInMonth: end.growth - start.growth,
    valueChange: end.businessValue - start.businessValue,
    topSellers: top.slice(0, 5),
    bestProfitPerDay: ppd.filter((x) => x.units > 0).slice(0, 3),
    avgDaysToSell: all?.avgDays ?? null,
    debtsOpen: { count: openDebts.length, amount: end.debts },
    partial,
  };
}
