import type { AppDB } from '../db';
import { buildLotsFromHistory, lotOrder, planLotConsumption, summarizeTakes } from '../lots';
import type { Costing, ID, ISODate, Lot, LotSource, LotTake, Money, Product, SaleLine } from '../types';
import { allocate, fail, newId, nowISO } from '../util';
import { logHistory, requireProduct } from './base';
import { tx } from './stock';

/**
 * LOTES (v2.1): operaciones con la base de datos. Todas deben llamarse dentro de una transacción `tx`.
 * El producto conserva sus totales (qty, stockValue, unknownCostQty) = suma de sus lotes, así el resto de la app
 * (saldos, capital, integridad) funciona igual con o sin lotes.
 */

export const LOT_SOURCE_LABEL: Record<LotSource, string> = {
  purchase: 'Compra',
  initial: 'Stock que ya tenías',
  adjust: 'Ajuste de conteo',
  return: 'Devolución',
  opening: 'Existencias anteriores',
};

export function usesLots(p: Pick<Product, 'tracking' | 'costing'>): boolean {
  return p.tracking === 'quantity' && p.costing === 'lots';
}

export async function getProductLots(db: AppDB, productId: ID, opts: { includeEmpty?: boolean } = {}): Promise<Lot[]> {
  const lots = await db.lots.where('productId').equals(productId).toArray();
  return lots.filter((l) => opts.includeEmpty || l.qty > 0).sort(lotOrder);
}

export interface NewLot {
  product: Product;
  source: LotSource;
  qty: number;
  /** Costo total del lote; null = costo desconocido. */
  value: Money | null;
  date: ISODate | null;
  purchaseId?: ID | null;
  purchaseLineId?: ID | null;
  supplierId?: ID | null;
  notes?: string;
}

export async function addLot(db: AppDB, n: NewLot): Promise<Lot> {
  const lot: Lot = {
    id: newId(),
    productId: n.product.id,
    inventoryId: n.product.inventoryId,
    source: n.source,
    purchaseId: n.purchaseId ?? null,
    purchaseLineId: n.purchaseLineId ?? null,
    supplierId: n.supplierId ?? null,
    date: n.date,
    qtyIn: n.qty,
    valueIn: n.value ?? 0,
    qty: n.qty,
    value: n.value ?? 0,
    costKnown: n.value !== null,
    notes: n.notes ?? '',
    createdAt: nowISO(),
  };
  await db.lots.add(lot);
  return lot;
}

/** Saca `q` unidades de los lotes (primero `preferredLotId`, luego el más antiguo) y actualiza los lotes. */
export async function consumeLots(db: AppDB, product: Product, q: number, preferredLotId?: ID | null): Promise<{ takes: LotTake[]; cogs: Money; unknownQty: number }> {
  const lots = await getProductLots(db, product.id);
  if (preferredLotId && !lots.some((l) => l.id === preferredLotId))
    fail('lot_empty', `El lote elegido de "${product.name}" ya no tiene existencias.`, 'lotId');
  const takes = planLotConsumption(lots, q, preferredLotId);
  if (!takes) fail('insufficient_stock', `Stock insuficiente de "${product.name}": hay ${lots.reduce((a, l) => a + l.qty, 0)} disponible(s) y se intentan sacar ${q}.`, 'quantity');
  for (const t of takes) {
    const l = lots.find((x) => x.id === t.lotId)!;
    await db.lots.update(l.id, { qty: l.qty - t.qty, value: l.costKnown ? l.value - t.cogs : 0 });
  }
  return { takes, ...summarizeTakes(takes) };
}

/** Devuelve a sus lotes lo que salió (anulación de venta). Si un lote ya no existe, crea uno de devolución. */
export async function restoreTakes(db: AppDB, product: Product, takes: LotTake[], date: ISODate): Promise<void> {
  for (const t of takes) {
    const l = await db.lots.get(t.lotId);
    if (l) await db.lots.update(l.id, { qty: l.qty + t.qty, value: l.costKnown ? l.value + t.cogs : 0 });
    else await addLot(db, { product, source: 'return', qty: t.qty, value: t.unknown ? null : t.cogs, date: t.date ?? date, notes: 'Vuelve por anulación de venta' });
  }
}

/** Línea vendida sin registro de lotes (vendida con costo promedio): vuelve como lote de devolución. */
export async function restoreLineWithoutLots(db: AppDB, product: Product, line: Pick<SaleLine, 'quantity' | 'cogs' | 'cogsUnknownQty'>, date: ISODate): Promise<void> {
  const kn = line.quantity - line.cogsUnknownQty;
  if (line.cogsUnknownQty > 0) await addLot(db, { product, source: 'return', qty: line.cogsUnknownQty, value: null, date, notes: 'Vuelve por anulación de venta' });
  if (kn > 0) await addLot(db, { product, source: 'return', qty: kn, value: line.cogs, date, notes: 'Vuelve por anulación de venta' });
}

/** Suma valor (gasto capitalizado) a los lotes: a uno elegido o repartido por cantidad entre los de costo conocido. */
export async function addValueToLots(db: AppDB, product: Product, amount: Money, lotId?: ID | null): Promise<{ lotId: ID; amount: Money }[]> {
  const lots = (await getProductLots(db, product.id)).filter((l) => l.costKnown);
  if (!lots.length) fail('no_stock', `"${product.name}" no tiene lotes con costo conocido a los que sumar el gasto.`, 'productId');
  let targets = lots;
  if (lotId) {
    targets = lots.filter((l) => l.id === lotId);
    if (!targets.length) fail('lot_empty', 'El lote elegido ya no tiene existencias con costo conocido.', 'lotId');
  }
  const parts = allocate(amount, targets.map((l) => l.qty));
  const out: { lotId: ID; amount: Money }[] = [];
  for (let i = 0; i < targets.length; i++) {
    if (!parts[i]) continue;
    await db.lots.update(targets[i].id, { value: targets[i].value + parts[i] });
    out.push({ lotId: targets[i].id, amount: parts[i] });
  }
  return out;
}

/** Quita valor de los lotes (anular un gasto capitalizado). Falla si parte del gasto ya salió con ventas. */
export async function removeValueFromLots(db: AppDB, product: Product, amount: Money, allocations?: { lotId: ID; amount: Money }[]): Promise<void> {
  if (allocations?.length) {
    for (const a of allocations) {
      const l = await db.lots.get(a.lotId);
      if (!l || l.value < a.amount || l.qty <= 0) fail('sold', 'No se puede anular: parte de ese costo ya se usó en ventas.');
    }
    for (const a of allocations) {
      const l = (await db.lots.get(a.lotId))!;
      await db.lots.update(l.id, { value: l.value - a.amount });
    }
    return;
  }
  const lots = (await getProductLots(db, product.id)).filter((l) => l.costKnown && l.value > 0);
  const total = lots.reduce((a, l) => a + l.value, 0);
  if (total < amount) fail('sold', 'No se puede anular: parte de ese costo ya se usó en ventas.');
  const parts = allocate(amount, lots.map((l) => l.value));
  for (let i = 0; i < lots.length; i++) if (parts[i]) await db.lots.update(lots[i].id, { value: lots[i].value - parts[i] });
}

/**
 * Activa o desactiva los lotes de un producto por cantidad.
 * - Activar: separa las existencias actuales en lotes según su historial (el valor total no cambia).
 * - Desactivar: vuelve al costo promedio (se borran los lotes; los totales del producto ya son el promedio).
 */
export async function setProductCosting(db: AppDB, productId: ID, costing: Costing): Promise<void> {
  await tx(db, async () => {
    const p = await requireProduct(db, productId);
    if (p.tracking !== 'quantity') fail('invalid', 'Los lotes solo aplican a productos por cantidad. Los productos por unidad ya guardan el costo de cada unidad.');
    if (p.costing === costing) return;
    await db.lots.where('productId').equals(productId).delete();
    // Los gastos capitalizados ya no apuntan a lotes concretos (al anularlos se quita el valor en proporción)
    const linked = await db.expenses.filter((e) => e.productId === productId && !!e.lotAllocations).toArray();
    for (const e of linked) await db.expenses.update(e.id, { lotAllocations: undefined });
    if (costing === 'lots') {
      const [movements, sales, purchases] = await Promise.all([
        db.movements.where('productId').equals(productId).toArray(),
        db.sales.toArray(),
        db.purchases.toArray(),
      ]);
      const supplier = new Map(purchases.map((x) => [x.id, x.supplierId]));
      const lots = buildLotsFromHistory(p, movements, {
        voidedSales: new Set(sales.filter((s) => s.status === 'voided').map((s) => s.id)),
        voidedPurchases: new Set(purchases.filter((x) => x.status === 'voided').map((x) => x.id)),
        supplierOf: (id) => supplier.get(id) ?? null,
        now: nowISO(),
        newId,
      });
      if (lots.length) await db.lots.bulkAdd(lots);
    }
    await db.products.update(productId, { costing, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'product',
      entityId: productId,
      inventoryId: p.inventoryId,
      action: 'costing',
      summary: costing === 'lots' ? `Separado por precio de compra (lotes): ${p.name}` : `Vuelve a costo promedio: ${p.name}`,
    });
  });
}

export interface LotView extends Lot {
  unitCost: number | null;
  supplierName: string;
  purchaseDate: ISODate | null;
}

export async function listLots(db: AppDB, productId: ID, includeEmpty = false): Promise<LotView[]> {
  const lots = await getProductLots(db, productId, { includeEmpty });
  const suppliers = new Map((await db.suppliers.toArray()).map((s) => [s.id, s.name]));
  return lots.map((l) => ({
    ...l,
    unitCost: l.costKnown && l.qty > 0 ? Math.round(l.value / l.qty) : l.costKnown && l.qtyIn > 0 ? Math.round(l.valueIn / l.qtyIn) : null,
    supplierName: l.supplierId ? suppliers.get(l.supplierId) ?? '' : '',
    purchaseDate: l.date,
  }));
}
