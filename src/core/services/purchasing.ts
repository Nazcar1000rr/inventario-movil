import type { AppDB } from '../db';
import { lotOrder } from '../lots';
import type { AllocationMethod, Expense, ID, ISODate, Money, Product, Purchase, PurchaseLine } from '../types';
import { allocate, assertDate, assertMoney, cleanStr, fail, newId, nowISO } from '../util';
import { getSettings, logHistory } from './base';
import { groupKey } from './consolidated';
import { capitalizeOnProduct, capitalizeOnUnit } from './expenses';
import { usesLots } from './lots';
import { minPriceFor } from './pricing';
import { claimOp, tx, unitCost } from './stock';

/**
 * COMPRAS INTELIGENTES (v2.1)
 * - Historial de precios de compra por producto y proveedor ("la última vez pagaste…").
 * - Comparación de una compra nueva con lo que ya tienes en existencia (aviso si compras más barato).
 * - Gastos agregados a una compra ya registrada y gastos de un viaje repartidos entre varias compras:
 *   la parte de lo que sigue en existencia se suma al costo; la parte de lo que ya vendiste es gasto operativo.
 */

/* ================= Historial de precios ================= */

export interface PricePoint {
  purchaseId: ID;
  lineId: ID;
  date: ISODate;
  supplierId: ID | null;
  supplierName: string;
  inventoryId: ID;
  productId: ID;
  qty: number;
  /** Lo que pagaste por unidad al proveedor (sin gastos). */
  unitPrice: Money;
  /** Costo por unidad con los gastos de la compra. */
  unitCost: Money;
}

/** Compras activas del mismo producto (en todos los inventarios: mismo nombre y tipo), de la más reciente a la más antigua. */
export async function getPurchasePriceHistory(db: AppDB, productId: ID, opts: { supplierId?: ID | null; limit?: number } = {}): Promise<PricePoint[]> {
  const p = await db.products.get(productId);
  if (!p) return [];
  const key = groupKey(p);
  const same = (await db.products.toArray()).filter((x) => groupKey(x) === key).map((x) => x.id);
  const lines = await db.purchaseLines.where('productId').anyOf(same).toArray();
  if (!lines.length) return [];
  const purchases = new Map((await db.purchases.where('id').anyOf([...new Set(lines.map((l) => l.purchaseId))]).toArray()).map((x) => [x.id, x]));
  const suppliers = new Map((await db.suppliers.toArray()).map((s) => [s.id, s.name]));
  const out: PricePoint[] = [];
  for (const l of lines) {
    const pu = purchases.get(l.purchaseId);
    if (!pu || pu.status !== 'active' || l.quantity <= 0) continue;
    if (opts.supplierId !== undefined && (pu.supplierId ?? null) !== (opts.supplierId ?? null)) continue;
    out.push({
      purchaseId: pu.id,
      lineId: l.id,
      date: pu.date,
      supplierId: pu.supplierId,
      supplierName: pu.supplierId ? suppliers.get(pu.supplierId) ?? '' : '',
      inventoryId: pu.inventoryId,
      productId: l.productId,
      qty: l.quantity,
      unitPrice: Math.round(l.price / l.quantity),
      unitCost: Math.round(l.totalCost / l.quantity),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.lineId < b.lineId ? 1 : -1));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export interface SupplierPrice {
  supplierId: ID | null;
  supplierName: string;
  last: PricePoint;
  count: number;
  min: Money;
  max: Money;
}

export interface LastPriceInfo {
  /** Última compra (de cualquier proveedor). */
  last: PricePoint | null;
  /** La compra anterior a la última (para ver si subió o bajó). */
  previous: PricePoint | null;
  /** Última compra al proveedor indicado. */
  lastFromSupplier: PricePoint | null;
  /** Último precio de cada proveedor (el más barato primero). */
  bySupplier: SupplierPrice[];
}

export async function getLastPricePaid(db: AppDB, productId: ID, supplierId?: ID | null): Promise<LastPriceInfo> {
  const h = await getPurchasePriceHistory(db, productId);
  const groups = new Map<string, PricePoint[]>();
  for (const x of h) {
    const k = x.supplierId ?? '';
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const bySupplier: SupplierPrice[] = [...groups.values()].map((g) => ({
    supplierId: g[0].supplierId,
    supplierName: g[0].supplierName,
    last: g[0],
    count: g.length,
    min: Math.min(...g.map((x) => x.unitPrice)),
    max: Math.max(...g.map((x) => x.unitPrice)),
  }));
  bySupplier.sort((a, b) => a.last.unitPrice - b.last.unitPrice);
  return {
    last: h[0] ?? null,
    previous: h[1] ?? null,
    lastFromSupplier: supplierId === undefined ? null : h.find((x) => (x.supplierId ?? null) === (supplierId ?? null)) ?? null,
    bySupplier,
  };
}

/** Diferencia entre un precio nuevo y uno anterior: valor y porcentaje (negativo = más barato). */
export function priceChange(now: Money, before: Money): { diff: Money; pct: number | null } {
  return { diff: now - before, pct: before > 0 ? Math.round(((now - before) * 1000) / before) / 10 : null };
}

/* ================= Compra nueva vs. lo que ya tienes ================= */

export interface StockCostItem {
  lotId: ID | null;
  unitId: ID | null;
  code: string;
  qty: number;
  date: ISODate | null;
  unitCost: Money;
  /** Cuánto más (o menos, si es negativo) te costó cada unidad que la compra nueva. */
  diffPerUnit: Money;
  /** Precio mínimo para no perder con ese costo (según tu margen mínimo). */
  minPrice: Money | null;
}

export interface StockComparison {
  productId: ID;
  newUnitCost: Money;
  /** Existencias con costo conocido, del costo más alto al más bajo. */
  items: StockCostItem[];
  /** Hay existencias que te costaron más que la compra nueva. */
  cheaper: boolean;
  /** Unidades que te costaron más. */
  pricierQty: number;
  /** Cuánto más te costaron en total las existencias más caras. */
  extraTotal: Money;
  /** La compra nueva es más cara que todo lo que tienes. */
  moreExpensive: boolean;
  avgCost: Money | null;
  stockQty: number;
}

/**
 * Compara el costo por unidad de una compra nueva con lo que ya tienes de ese producto.
 * Sirve para avisar: "tus 3 audífonos anteriores te costaron 8 000 más cada uno; véndelos mínimo a…".
 */
export async function compareWithStock(db: AppDB, productId: ID, newUnitCost: Money): Promise<StockComparison> {
  const p = await db.products.get(productId);
  if (!p) fail('not_found', 'El producto no existe.');
  const settings = await getSettings(db);
  const items: StockCostItem[] = [];
  const push = (x: Omit<StockCostItem, 'diffPerUnit' | 'minPrice'>) =>
    items.push({ ...x, diffPerUnit: x.unitCost - newUnitCost, minPrice: minPriceFor(x.unitCost, settings.pricing) });
  if (p.tracking === 'unit') {
    const units = await db.units.where('productId').equals(p.id).filter((u) => u.status === 'available' || u.status === 'in_review').toArray();
    for (const u of units) {
      const c = unitCost(u);
      if (c !== null) push({ lotId: null, unitId: u.id, code: u.code, qty: 1, date: u.availableSince, unitCost: c });
    }
  } else if (usesLots(p)) {
    const lots = (await db.lots.where('productId').equals(p.id).toArray()).filter((l) => l.qty > 0 && l.costKnown).sort(lotOrder);
    for (const l of lots) push({ lotId: l.id, unitId: null, code: '', qty: l.qty, date: l.date, unitCost: Math.round(l.value / l.qty) });
  } else {
    const kq = p.qty - p.unknownCostQty;
    if (kq > 0) push({ lotId: null, unitId: null, code: '', qty: kq, date: null, unitCost: Math.round(p.stockValue / kq) });
  }
  items.sort((a, b) => b.unitCost - a.unitCost);
  const pricier = items.filter((x) => x.diffPerUnit > 0);
  const stockQty = items.reduce((a, x) => a + x.qty, 0);
  const stockValue = items.reduce((a, x) => a + x.unitCost * x.qty, 0);
  return {
    productId,
    newUnitCost,
    items,
    cheaper: pricier.length > 0,
    pricierQty: pricier.reduce((a, x) => a + x.qty, 0),
    extraTotal: pricier.reduce((a, x) => a + x.diffPerUnit * x.qty, 0),
    moreExpensive: items.length > 0 && items.every((x) => x.diffPerUnit < 0),
    avgCost: stockQty > 0 ? Math.round(stockValue / stockQty) : null,
    stockQty,
  };
}

/* ================= Gastos agregados a compras ================= */

export interface PurchaseCostInput {
  opId?: string;
  date: ISODate;
  amount: Money;
  category: string;
  notes?: string;
  /** Cómo repartir entre los productos de la compra (y entre compras): por valor pagado o por unidades. */
  allocation?: AllocationMethod;
}

export interface CostSplitLine {
  purchaseId: ID;
  lineId: ID;
  productId: ID;
  productName: string;
  quantity: number;
  /** Parte del gasto que le toca a esta línea. */
  share: Money;
  /** Lo que se suma al costo de lo que sigue en existencia. */
  capitalized: Money;
  /** Lo que corresponde a unidades ya vendidas o dadas de baja: gasto operativo. */
  operating: Money;
  inStockQty: number;
}

export interface CostSplit {
  amount: Money;
  capitalized: Money;
  operating: Money;
  lines: CostSplitLine[];
}

interface Part {
  line: PurchaseLine;
  purchase: Purchase;
  product: Product;
  share: Money;
  /** Partes capitalizadas: a unidades (unitId) o al producto (lotId opcional). */
  caps: { unitId: ID | null; lotId: ID | null; amount: Money }[];
  operating: Money;
  inStockQty: number;
}

async function loadPurchase(db: AppDB, id: ID): Promise<{ purchase: Purchase; lines: PurchaseLine[] }> {
  const purchase = await db.purchases.get(id);
  if (!purchase) fail('not_found', 'La compra no existe.', 'purchaseId');
  if (purchase.status !== 'active') fail('voided', 'La compra está anulada.', 'purchaseId');
  const lines = await db.purchaseLines.where('purchaseId').equals(id).toArray();
  return { purchase, lines };
}

/** Reparte `amount` entre las líneas y separa lo que sigue en existencia de lo ya vendido. No guarda nada. */
async function planParts(db: AppDB, purchase: Purchase, lines: PurchaseLine[], amount: Money, allocation: AllocationMethod): Promise<Part[]> {
  const weights = lines.map((l) => (allocation === 'units' ? l.quantity : l.price));
  const shares = allocate(amount, weights.some((w) => w > 0) ? weights : lines.map((l) => l.quantity));
  const parts: Part[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const share = shares[i];
    const product = (await db.products.get(line.productId))!;
    const part: Part = { line, purchase, product, share, caps: [], operating: 0, inStockQty: 0 };
    if (share > 0) {
      if (product.tracking === 'unit') {
        const per = allocate(share, line.unitIds.map(() => 1));
        for (let j = 0; j < line.unitIds.length; j++) {
          const u = await db.units.get(line.unitIds[j]);
          const inStock = !!u && (u.status === 'available' || u.status === 'in_review' || u.status === 'damaged');
          if (inStock) {
            part.inStockQty++;
            if (per[j] > 0) part.caps.push({ unitId: u!.id, lotId: null, amount: per[j] });
          } else part.operating += per[j];
        }
      } else {
        // Costo promedio (o lote no encontrado): se asume que lo que queda en existencia es de esta compra (hasta lo comprado)
        let inStock = Math.min(line.quantity, Math.max(0, product.qty - product.unknownCostQty));
        let lotId: ID | null = null;
        let base = line.quantity;
        if (usesLots(product)) {
          const lot = await db.lots
            .where('purchaseId')
            .equals(purchase.id)
            .filter((x) => x.productId === product.id && x.costKnown && (x.purchaseLineId === line.id || x.purchaseLineId === null))
            .first();
          if (lot) {
            inStock = lot.qty;
            base = Math.max(lot.qtyIn, 1);
            lotId = lot.qty > 0 ? lot.id : null;
          }
        }
        part.inStockQty = inStock;
        const cap = inStock >= base ? share : Math.round((share * inStock) / base);
        if (cap > 0) part.caps.push({ unitId: null, lotId, amount: cap });
        part.operating += share - cap;
      }
    }
    parts.push(part);
  }
  return parts;
}

function summarize(amount: Money, parts: Part[]): CostSplit {
  const lines = parts.map((p) => {
    const capitalized = p.caps.reduce((a, c) => a + c.amount, 0);
    return {
      purchaseId: p.purchase.id,
      lineId: p.line.id,
      productId: p.product.id,
      productName: p.product.name,
      quantity: p.line.quantity,
      share: p.share,
      capitalized,
      operating: p.operating,
      inStockQty: p.inStockQty,
    };
  });
  return { amount, capitalized: lines.reduce((a, l) => a + l.capitalized, 0), operating: lines.reduce((a, l) => a + l.operating, 0), lines };
}

/** Reparte un monto entre varias compras (por valor pagado o por unidades). */
function splitAmong(amount: Money, items: { purchase: Purchase; lines: PurchaseLine[] }[], allocation: AllocationMethod): Money[] {
  const w = items.map((x) => (allocation === 'units' ? x.lines.reduce((a, l) => a + l.quantity, 0) : x.purchase.subtotal));
  return allocate(amount, w.some((v) => v > 0) ? w : items.map(() => 1));
}

async function planMany(db: AppDB, purchaseIds: ID[], amount: Money, allocation: AllocationMethod): Promise<Part[]> {
  const ids = [...new Set(purchaseIds)];
  if (!ids.length) fail('required', 'Elige al menos una compra.', 'purchaseIds');
  const items = [];
  for (const id of ids) items.push(await loadPurchase(db, id));
  const amounts = splitAmong(amount, items, allocation);
  const parts: Part[] = [];
  for (let i = 0; i < items.length; i++) parts.push(...(await planParts(db, items[i].purchase, items[i].lines, amounts[i], allocation)));
  return parts;
}

/** Vista previa: cuánto se suma al costo de lo que tienes y cuánto queda como gasto (lo ya vendido). */
export async function previewPurchaseCost(db: AppDB, purchaseIds: ID[], amount: Money, allocation: AllocationMethod = 'value'): Promise<CostSplit> {
  const a = assertMoney(amount, 'amount', 'Valor del gasto', false);
  return summarize(a, await planMany(db, purchaseIds, a, allocation));
}

async function applyParts(db: AppDB, parts: Part[], input: PurchaseCostInput, date: ISODate, category: string, notes: string): Promise<{ groupId: ID; expenses: Expense[] }> {
  const groupId = newId();
  const created: Expense[] = [];
  const base = (over: Partial<Expense>): Expense => ({
    id: newId(),
    date,
    amount: 0,
    category,
    notes,
    treatment: 'operating',
    inventoryId: null,
    saleId: null,
    purchaseId: null,
    unitId: null,
    productId: null,
    claimId: null,
    repairId: null,
    costGroupId: groupId,
    status: 'active',
    createdAt: nowISO(),
    ...over,
  });
  // Operativo: un gasto por compra con la suma de lo ya vendido
  const opByPurchase = new Map<ID, { amount: Money; inventoryId: ID }>();
  for (const p of parts) {
    for (const c of p.caps) {
      const id = newId();
      if (c.unitId) {
        const r = await capitalizeOnUnit(db, c.unitId, c.amount, category);
        created.push(base({ id, amount: c.amount, treatment: 'capitalized', inventoryId: r.inventoryId, productId: r.productId, unitId: c.unitId, purchaseId: p.purchase.id }));
      } else {
        const r = await capitalizeOnProduct(db, p.product.id, c.amount, { category, date, expenseId: id, lotId: c.lotId });
        created.push(
          base({
            id,
            amount: c.amount,
            treatment: 'capitalized',
            inventoryId: r.inventoryId,
            productId: p.product.id,
            purchaseId: p.purchase.id,
            ...(r.lotAllocations ? { lotAllocations: r.lotAllocations } : {}),
          }),
        );
      }
    }
    if (p.operating > 0) {
      const o = opByPurchase.get(p.purchase.id) ?? { amount: 0, inventoryId: p.purchase.inventoryId };
      o.amount += p.operating;
      opByPurchase.set(p.purchase.id, o);
    }
  }
  for (const [purchaseId, o] of opByPurchase)
    created.push(base({ amount: o.amount, inventoryId: o.inventoryId, purchaseId, notes: cleanStr(`${notes ? notes + ' · ' : ''}Parte de lo que ya vendiste`, 500) }));
  if (!created.length) fail('invalid', 'No hay a qué sumar el gasto.');
  await db.expenses.bulkAdd(created);
  const purchaseIds = [...new Set(parts.map((p) => p.purchase.id))];
  for (const id of purchaseIds) {
    const inv = parts.find((p) => p.purchase.id === id)!.purchase.inventoryId;
    const mine = created.filter((e) => e.purchaseId === id).reduce((a, e) => a + e.amount, 0);
    await logHistory(db, {
      entityType: 'purchase',
      entityId: id,
      inventoryId: inv,
      action: 'add_cost',
      summary: `Gasto agregado a la compra (${category}): ${mine}${purchaseIds.length > 1 ? ` de ${input.amount} repartidos entre ${purchaseIds.length} compras` : ''}`,
    });
  }
  return { groupId, expenses: created };
}

function validate(input: PurchaseCostInput) {
  const date = assertDate(input.date, 'date', 'Fecha del gasto');
  const amount = assertMoney(input.amount, 'amount', 'Valor del gasto', false);
  const category = cleanStr(input.category, 40);
  if (!category) fail('required', 'Elige una categoría.', 'category');
  return { date, amount, category, notes: cleanStr(input.notes ?? '', 500), allocation: (input.allocation === 'units' ? 'units' : 'value') as AllocationMethod };
}

/**
 * Agrega un gasto (transporte, envío, comida del viaje…) a una compra ya registrada.
 * Lo que sigue en existencia sube de costo; lo que ya vendiste lleva su parte como gasto operativo.
 */
export async function addPurchaseCost(db: AppDB, purchaseId: ID, input: PurchaseCostInput): Promise<{ groupId: ID; split: CostSplit } | null> {
  return addTripCost(db, [purchaseId], input);
}

/** Un gasto del viaje o del día repartido entre varias compras (por valor pagado o por unidades). */
export async function addTripCost(db: AppDB, purchaseIds: ID[], input: PurchaseCostInput): Promise<{ groupId: ID; split: CostSplit } | null> {
  const v = validate(input);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const parts = await planMany(db, purchaseIds, v.amount, v.allocation);
    const { groupId } = await applyParts(db, parts, input, v.date, v.category, v.notes);
    return { groupId, split: summarize(v.amount, parts) };
  });
}

/** Gastos agregados después a una compra (agrupados). */
export async function getPurchaseAddedCosts(db: AppDB, purchaseId: ID): Promise<{ groupId: ID; date: ISODate; category: string; notes: string; amount: Money; capitalized: Money; operating: Money; shared: boolean; status: Expense['status'] }[]> {
  const mine = await db.expenses.where('purchaseId').equals(purchaseId).filter((e) => !!e.costGroupId).toArray();
  const groups = [...new Set(mine.map((e) => e.costGroupId!))];
  const out = [];
  for (const g of groups) {
    const all = await db.expenses.filter((e) => e.costGroupId === g).toArray();
    const here = all.filter((e) => e.purchaseId === purchaseId);
    out.push({
      groupId: g,
      date: here[0].date,
      category: here[0].category,
      notes: here.find((e) => e.treatment === 'capitalized')?.notes ?? here[0].notes,
      amount: here.reduce((a, e) => a + e.amount, 0),
      capitalized: here.filter((e) => e.treatment === 'capitalized').reduce((a, e) => a + e.amount, 0),
      operating: here.filter((e) => e.treatment === 'operating').reduce((a, e) => a + e.amount, 0),
      shared: new Set(all.map((e) => e.purchaseId)).size > 1,
      status: here.every((e) => e.status === 'voided') ? ('voided' as const) : ('active' as const),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Compras activas de un día (para repartir el gasto del viaje). */
export async function listPurchasesOfDay(db: AppDB, day: ISODate, inventoryIds: ID[] | null = null): Promise<Purchase[]> {
  const d = new Date(day);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
  const list = await db.purchases.where('date').between(from, to, true, false).toArray();
  return list.filter((p) => p.status === 'active' && (!inventoryIds || inventoryIds.includes(p.inventoryId))).sort((a, b) => (a.date < b.date ? -1 : 1));
}
