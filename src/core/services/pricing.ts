import type { AppDB } from '../db';
import type { ID, ISODate, MarketPrice, Money, PricingSettings, Product, Unit } from '../types';
import { normalizeCondition } from '../catalog';
import { assertDate, cleanStr, daysBetween, fail, newId, normalizeText, nowISO } from '../util';
import { getSettings, logHistory } from './base';
import { unitCost } from './stock';
import { lotOrder } from '../lots';

/**
 * PRECIOS (v2)
 * - Precio de mercado: lo anotas tú (p. ej. lo que ves en Marketplace) por modelo + capacidad + estado, con fecha.
 *   Se guarda el historial; si tiene más de N días se marca como desactualizado.
 * - Tu precio real: promedio de TUS ventas de ese modelo/capacidad/estado en los últimos N días.
 * - Precio mínimo: costo + margen mínimo. La app avisa si vendes por debajo del costo o del mínimo.
 * - Precio máximo de compra: precio de mercado − descuentos − margen deseado − gastos esperados.
 */

export function marketKey(model: string, capacity: string, condition: string): string {
  return [normalizeText(model), normalizeText(capacity).replace(/\s+/g, ''), normalizeText(normalizeCondition(condition))].join('|');
}

export interface MarketPriceInput {
  model: string;
  capacity: string;
  condition: string;
  price: Money;
  date?: ISODate;
  notes?: string;
}

export async function addMarketPrice(db: AppDB, input: MarketPriceInput): Promise<MarketPrice> {
  const model = cleanStr(input.model, 80);
  if (!model) fail('required', 'Escribe el modelo (por ejemplo, iPhone 13).', 'model');
  const capacity = cleanStr(input.capacity, 20);
  const condition = normalizeCondition(input.condition);
  if (!condition) fail('required', 'Elige el estado del equipo.', 'condition');
  if (!Number.isInteger(input.price) || input.price <= 0) fail('invalid', 'Escribe el precio de mercado en pesos.', 'price');
  const date = input.date ? assertDate(input.date, 'date', 'Fecha') : nowISO();
  const rec: MarketPrice = {
    id: newId(),
    key: marketKey(model, capacity, condition),
    model,
    capacity,
    condition,
    price: input.price,
    date,
    notes: cleanStr(input.notes ?? '', 300),
    createdAt: nowISO(),
  };
  await db.transaction('rw', db.marketPrices, db.history, async () => {
    await db.marketPrices.add(rec);
    await logHistory(db, {
      entityType: 'price',
      entityId: rec.id,
      inventoryId: null,
      action: 'create',
      summary: `Precio de mercado: ${model} ${capacity} ${condition} = ${rec.price}`,
    });
  });
  return rec;
}

export async function deleteMarketPrice(db: AppDB, id: ID): Promise<void> {
  await db.marketPrices.delete(id);
}

export interface MarketPriceRow {
  key: string;
  model: string;
  capacity: string;
  condition: string;
  latest: MarketPrice;
  previous: MarketPrice | null;
  /** Diferencia con el registro anterior. */
  change: Money | null;
  count: number;
  ageDays: number;
  stale: boolean;
}

export function summarizeMarketPrices(prices: MarketPrice[], staleDays: number, now = new Date()): MarketPriceRow[] {
  const byKey = new Map<string, MarketPrice[]>();
  for (const p of prices) {
    const a = byKey.get(p.key) ?? [];
    a.push(p);
    byKey.set(p.key, a);
  }
  const rows: MarketPriceRow[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const latest = list[0];
    const previous = list[1] ?? null;
    const ageDays = Math.max(0, daysBetween(latest.date, now));
    rows.push({
      key,
      model: latest.model,
      capacity: latest.capacity,
      condition: latest.condition,
      latest,
      previous,
      change: previous ? latest.price - previous.price : null,
      count: list.length,
      ageDays,
      stale: ageDays > staleDays,
    });
  }
  return rows.sort((a, b) => a.model.localeCompare(b.model, 'es', { numeric: true }) || a.capacity.localeCompare(b.capacity, 'es', { numeric: true }) || a.condition.localeCompare(b.condition));
}

export async function listMarketPrices(db: AppDB, now = new Date()): Promise<MarketPriceRow[]> {
  const settings = await getSettings(db);
  return summarizeMarketPrices(await db.marketPrices.toArray(), settings.pricing.marketStaleDays, now);
}

export async function getMarketHistory(db: AppDB, key: string): Promise<MarketPrice[]> {
  return (await db.marketPrices.where('key').equals(key).toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/* ---------------- Márgenes ---------------- */

/** Precio mínimo = costo + margen mínimo (redondeado hacia arriba). null si el costo es desconocido. */
export function minPriceFor(cost: Money | null, pricing: Pick<PricingSettings, 'minMarginType' | 'minMarginValue'>): Money | null {
  if (cost === null) return null;
  // Tolerancia para errores de coma flotante (p. ej. 1.500.000 × 1,1 = 1.650.000,0000000002).
  if (pricing.minMarginType === 'percent') return cost + Math.ceil((cost * pricing.minMarginValue) / 100 - 1e-6);
  return cost + pricing.minMarginValue;
}

export interface MaxBuyInput {
  market: Money;
  batteryHealth?: number | null;
  /** Piezas genéricas o con aviso de "pieza desconocida". */
  genericParts?: number;
  /** Para usar valores distintos a los de Configuración en esta consulta. */
  targetMarginType?: PricingSettings['targetMarginType'];
  targetMarginValue?: number;
  expectedCosts?: Money;
}

export interface MaxBuyResult {
  market: Money;
  batteryDiscount: Money;
  partsDiscount: Money;
  adjustedMarket: Money;
  expectedCosts: Money;
  marginType: PricingSettings['targetMarginType'];
  marginValue: number;
  /** Ganancia esperada si compras al precio máximo y vendes al precio de mercado ajustado. */
  expectedProfit: Money;
  /** Lo máximo que deberías pagar (0 si no da). */
  maxPrice: Money;
}

/**
 * ¿Cuánto pagar como máximo?
 * - margen en pesos:  máximo = mercado ajustado − margen − gastos esperados
 * - margen en %:      máximo = mercado ajustado ÷ (1 + %) − gastos esperados   (el % es sobre tu costo total)
 * mercado ajustado = mercado − descuento por batería (si está por debajo del umbral) − descuento por pieza genérica × piezas.
 */
export function maxBuyPrice(input: MaxBuyInput, pricing: PricingSettings): MaxBuyResult {
  const market = Math.max(0, Math.round(input.market));
  const batteryDiscount =
    pricing.batteryThreshold !== null && input.batteryHealth !== null && input.batteryHealth !== undefined && input.batteryHealth < pricing.batteryThreshold
      ? pricing.batteryDiscount
      : 0;
  const partsDiscount = Math.max(0, input.genericParts ?? 0) * pricing.genericPartDiscount;
  const adjustedMarket = Math.max(0, market - batteryDiscount - partsDiscount);
  const expectedCosts = input.expectedCosts ?? pricing.expectedCosts;
  const marginType = input.targetMarginType ?? pricing.targetMarginType;
  const marginValue = input.targetMarginValue ?? pricing.targetMarginValue;
  let maxPrice: number;
  if (marginType === 'percent') maxPrice = Math.floor((adjustedMarket * 100) / (100 + marginValue) - expectedCosts + 1e-6);
  else maxPrice = adjustedMarket - marginValue - expectedCosts;
  maxPrice = Math.max(0, maxPrice);
  return {
    market,
    batteryDiscount,
    partsDiscount,
    adjustedMarket,
    expectedCosts,
    marginType,
    marginValue,
    expectedProfit: adjustedMarket - maxPrice - expectedCosts,
    maxPrice,
  };
}

/* ---------------- Información de precio para vender ---------------- */

export interface PricingInfo {
  model: string;
  capacity: string;
  condition: string;
  key: string;
  cost: Money | null;
  minPrice: Money | null;
  market: { price: Money; date: ISODate; ageDays: number; stale: boolean } | null;
  recent: { avg: Money; count: number; days: number } | null;
  listPrice: Money | null;
  suggested: Money | null;
  suggestedSource: 'market' | 'recent' | 'list' | 'market_stale' | 'min' | null;
  /** El sugerido se subió al mínimo porque la referencia estaba por debajo. */
  raisedToMin: boolean;
  /** Productos con lotes: costo y precio mínimo de cada lote (del que sale primero al último). */
  lots?: LotPricing[];
  /** Productos con lotes: costo promedio de todas las existencias (para comparar). */
  avgCost?: Money | null;
}

export interface LotPricing {
  lotId: ID;
  qty: number;
  date: ISODate | null;
  unitCost: Money | null;
  minPrice: Money | null;
  supplierId: ID | null;
  /** true = es el lote que sale primero si no eliges otro. */
  next: boolean;
}

export const SUGGESTED_SOURCE_LABEL: Record<NonNullable<PricingInfo['suggestedSource']>, string> = {
  market: 'precio de mercado',
  recent: 'tu precio real (promedio de tus ventas)',
  list: 'precio de venta del producto',
  market_stale: 'precio de mercado desactualizado',
  min: 'precio mínimo',
};

interface SaleRef {
  date: ISODate;
  amount: Money;
}

async function recentSalesFor(db: AppDB, match: (p: Product, u: Unit | null) => boolean, days: number, now: Date): Promise<SaleRef[]> {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const sales = (await db.sales.where('date').aboveOrEqual(from).toArray()).filter((s) => s.status === 'active');
  if (!sales.length) return [];
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const lines = await db.saleLines.where('saleId').anyOf([...saleById.keys()]).toArray();
  const products = new Map((await db.products.where('id').anyOf([...new Set(lines.map((l) => l.productId))]).toArray()).map((p) => [p.id, p]));
  const unitIds = lines.filter((l) => l.unitId).map((l) => l.unitId!);
  const units = new Map((await db.units.where('id').anyOf(unitIds).toArray()).map((u) => [u.id, u]));
  const out: SaleRef[] = [];
  for (const l of lines) {
    const p = products.get(l.productId);
    if (!p) continue;
    const u = l.unitId ? units.get(l.unitId) ?? null : null;
    const netQty = l.quantity - l.returnedQty;
    if (netQty <= 0 || !match(p, u)) continue;
    const per = Math.round((l.netAmount - l.returnedAmount) / netQty);
    for (let i = 0; i < netQty; i++) out.push({ date: saleById.get(l.saleId)!.date, amount: per });
  }
  return out;
}

function pickSuggested(info: Omit<PricingInfo, 'suggested' | 'suggestedSource' | 'raisedToMin'>): Pick<PricingInfo, 'suggested' | 'suggestedSource' | 'raisedToMin'> {
  let suggested: Money | null = null;
  let source: PricingInfo['suggestedSource'] = null;
  if (info.market && !info.market.stale) [suggested, source] = [info.market.price, 'market'];
  else if (info.recent) [suggested, source] = [info.recent.avg, 'recent'];
  else if (info.listPrice) [suggested, source] = [info.listPrice, 'list'];
  else if (info.market) [suggested, source] = [info.market.price, 'market_stale'];
  let raisedToMin = false;
  if (info.minPrice !== null && (suggested === null || suggested < info.minPrice)) {
    raisedToMin = suggested !== null;
    suggested = info.minPrice;
    source = source ?? 'min';
  }
  return { suggested, suggestedSource: source, raisedToMin };
}

/** Datos para ponerle precio a una unidad (equipo). */
export async function getUnitPricing(db: AppDB, unitId: ID, now = new Date()): Promise<PricingInfo> {
  const u = await db.units.get(unitId);
  if (!u) fail('not_found', 'La unidad no existe.');
  const p = await db.products.get(u.productId);
  if (!p) fail('not_found', 'El producto no existe.');
  const settings = await getSettings(db);
  const model = p.model || p.name;
  const capacity = u.capacity || p.capacity;
  const condition = normalizeCondition(u.condition);
  const key = marketKey(model, capacity, condition);
  const hist = condition ? await getMarketHistory(db, key) : [];
  const m = hist[0];
  const market = m
    ? { price: m.price, date: m.date, ageDays: Math.max(0, daysBetween(m.date, now)), stale: daysBetween(m.date, now) > settings.pricing.marketStaleDays }
    : null;
  const nModel = normalizeText(model);
  const nCap = normalizeText(capacity).replace(/\s+/g, '');
  const nCond = normalizeText(condition);
  const refs = await recentSalesFor(
    db,
    (pp, uu) =>
      normalizeText(pp.model || pp.name) === nModel &&
      normalizeText(uu?.capacity || pp.capacity).replace(/\s+/g, '') === nCap &&
      normalizeText(normalizeCondition(uu?.condition ?? '')) === nCond,
    settings.pricing.recentSalesDays,
    now,
  );
  const recent = refs.length ? { avg: Math.round(refs.reduce((a, r) => a + r.amount, 0) / refs.length), count: refs.length, days: settings.pricing.recentSalesDays } : null;
  const cost = unitCost(u);
  const base = { model, capacity, condition, key, cost, minPrice: minPriceFor(cost, settings.pricing), market, recent, listPrice: p.salePrice };
  return { ...base, ...pickSuggested(base) };
}

/** Datos de precio para productos por cantidad (accesorios). */
export async function getProductPricing(db: AppDB, productId: ID, now = new Date(), lotId?: ID | null): Promise<PricingInfo> {
  const p = await db.products.get(productId);
  if (!p) fail('not_found', 'El producto no existe.');
  const settings = await getSettings(db);
  const knownQty = p.qty - p.unknownCostQty;
  const avgCost = p.tracking === 'quantity' && knownQty > 0 ? Math.round(p.stockValue / knownQty) : null;
  let cost = avgCost;
  let lots: LotPricing[] | undefined;
  if (p.tracking === 'quantity' && p.costing === 'lots') {
    const all = (await db.lots.where('productId').equals(p.id).toArray()).filter((l) => l.qty > 0).sort(lotOrder);
    lots = all.map((l, i) => {
      const uc = l.costKnown ? Math.round(l.value / l.qty) : null;
      return { lotId: l.id, qty: l.qty, date: l.date, unitCost: uc, minPrice: minPriceFor(uc, settings.pricing), supplierId: l.supplierId, next: i === 0 };
    });
    // El costo de referencia es el del lote elegido o el del que sale primero
    const chosen = (lotId && lots.find((l) => l.lotId === lotId)) || lots[0];
    if (chosen) cost = chosen.unitCost;
  }
  const refs = await recentSalesFor(db, (pp) => pp.id === p.id, settings.pricing.recentSalesDays, now);
  const recent = refs.length ? { avg: Math.round(refs.reduce((a, r) => a + r.amount, 0) / refs.length), count: refs.length, days: settings.pricing.recentSalesDays } : null;
  const base = {
    model: p.model || p.name,
    capacity: p.capacity,
    condition: '',
    key: '',
    cost,
    minPrice: minPriceFor(cost, settings.pricing),
    market: null,
    recent,
    listPrice: p.salePrice,
  };
  return { ...base, ...pickSuggested(base), ...(lots ? { lots, avgCost } : {}) };
}

export interface PriceCheck {
  belowCost: boolean;
  belowMin: boolean;
  /** Diferencia con el precio de mercado (negativo = por debajo). */
  vsMarket: Money | null;
  profit: Money | null;
}

export function checkPrice(price: Money, info: Pick<PricingInfo, 'cost' | 'minPrice' | 'market'>): PriceCheck {
  return {
    belowCost: info.cost !== null && price < info.cost,
    belowMin: info.minPrice !== null && price < info.minPrice,
    vsMarket: info.market ? price - info.market.price : null,
    profit: info.cost !== null ? price - info.cost : null,
  };
}

/** Cuántas piezas genéricas o con aviso tiene una unidad (para el descuento del precio máximo de compra). */
export function genericPartsCount(u: Pick<Unit, 'partsHistory'>): number {
  return (u.partsHistory ?? []).filter((x) => x.quality === 'generic' || x.unknownPartWarning).length;
}

