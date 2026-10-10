import type { AppDB } from '../db';
import type { ConsolidatedView, ID, Money, Product, ProductKind, Tracking } from '../types';
import { cleanStr, fail, newId, normalizeText, nowISO } from '../util';
import { logHistory } from './base';
import { summarizeUnits, tx } from './stock';

/**
 * VISTA CONSOLIDADA: es solo una consulta calculada en vivo a partir de los inventarios de origen.
 * No crea unidades, productos, compras, ventas ni dinero. Cada existencia conserva su inventario
 * de origen; para vender se usa siempre el inventario de origen.
 */

export async function createView(db: AppDB, input: { name: string; inventoryIds: ID[] }): Promise<ConsolidatedView> {
  const name = cleanStr(input.name, 60);
  if (!name) fail('required', 'Escribe un nombre para la vista.', 'name');
  const ids = [...new Set(input.inventoryIds)];
  if (ids.length < 2) fail('too_few', 'Elige al menos dos inventarios.', 'inventoryIds');
  return tx(db, async () => {
    for (const id of ids) if (!(await db.inventories.get(id))) fail('not_found', 'Uno de los inventarios no existe.');
    const now = nowISO();
    const v: ConsolidatedView = { id: newId(), name, inventoryIds: ids, archived: false, createdAt: now, updatedAt: now };
    await db.consolidatedViews.add(v);
    await logHistory(db, { entityType: 'view', entityId: v.id, inventoryId: null, action: 'create', summary: `Vista consolidada creada: ${name}` });
    return v;
  });
}

export async function updateView(db: AppDB, id: ID, patch: { name?: string; inventoryIds?: ID[]; archived?: boolean }): Promise<void> {
  await tx(db, async () => {
    const v = await db.consolidatedViews.get(id);
    if (!v) fail('not_found', 'La vista no existe.');
    const next = { ...v, updatedAt: nowISO() };
    if (patch.name !== undefined) {
      const n = cleanStr(patch.name, 60);
      if (!n) fail('required', 'Escribe un nombre para la vista.', 'name');
      next.name = n;
    }
    if (patch.inventoryIds !== undefined) {
      const ids = [...new Set(patch.inventoryIds)];
      if (ids.length < 2) fail('too_few', 'Elige al menos dos inventarios.', 'inventoryIds');
      next.inventoryIds = ids;
    }
    if (patch.archived !== undefined) next.archived = patch.archived;
    await db.consolidatedViews.put(next);
  });
}

/** Elimina solo la vista. Los inventarios de origen y sus movimientos no se tocan. */
export async function deleteView(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const v = await db.consolidatedViews.get(id);
    if (!v) return;
    await db.consolidatedViews.delete(id);
    await logHistory(db, { entityType: 'view', entityId: id, inventoryId: null, action: 'delete', summary: `Vista consolidada eliminada: ${v.name}` });
  });
}

export interface StockSource {
  inventoryId: ID;
  productId: ID;
  available: number;
  value: Money;
  unknownCost: number;
}

export interface StockGroup {
  key: string;
  name: string;
  kind: ProductKind;
  tracking: Tracking | 'mixed';
  available: number;
  inReview: number;
  damaged: number;
  value: Money;
  unknownCost: number;
  lowStock: boolean;
  sources: StockSource[];
}

export function groupKey(p: Pick<Product, 'name' | 'kind'>): string {
  return `${p.kind}:${normalizeText(p.name)}`;
}

/**
 * Existencias agrupadas por producto (nombre normalizado) para uno o varios inventarios.
 * Cada existencia se cuenta exactamente una vez, en su inventario de origen.
 */
export async function getStockOverview(db: AppDB, inventoryIds: ID[], opts: { includeEmpty?: boolean } = {}): Promise<StockGroup[]> {
  const products = (await db.products.where('inventoryId').anyOf(inventoryIds).toArray()).filter((p) => !p.archived);
  const unitProducts = products.filter((p) => p.tracking === 'unit').map((p) => p.id);
  const units = unitProducts.length ? await db.units.where('productId').anyOf(unitProducts).toArray() : [];
  const byProduct = new Map<ID, typeof units>();
  for (const u of units) {
    const arr = byProduct.get(u.productId) ?? [];
    arr.push(u);
    byProduct.set(u.productId, arr);
  }
  const groups = new Map<string, StockGroup>();
  for (const p of products) {
    const s = p.tracking === 'unit'
      ? summarizeUnits(byProduct.get(p.id) ?? [])
      : { available: p.qty, inReview: 0, damaged: 0, availableValue: p.stockValue, unknownCostCount: p.unknownCostQty };
    const key = groupKey(p);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: p.name, kind: p.kind, tracking: p.tracking, available: 0, inReview: 0, damaged: 0, value: 0, unknownCost: 0, lowStock: false, sources: [] };
      groups.set(key, g);
    }
    if (g.tracking !== p.tracking) g.tracking = 'mixed';
    g.available += s.available;
    g.inReview += s.inReview;
    g.damaged += s.damaged;
    g.value += s.availableValue;
    g.unknownCost += s.unknownCostCount;
    if (p.lowStockThreshold !== null && s.available <= p.lowStockThreshold) g.lowStock = true;
    g.sources.push({ inventoryId: p.inventoryId, productId: p.id, available: s.available, value: s.availableValue, unknownCost: s.unknownCostCount });
  }
  const out = [...groups.values()];
  return (opts.includeEmpty ? out : out.filter((g) => g.available + g.inReview + g.damaged > 0)).sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );
}
