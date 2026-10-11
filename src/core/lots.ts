import type { ID, ISODate, Lot, LotSource, LotTake, Money, Movement, Product } from './types';
import { allocate } from './util';

/**
 * LOTES (v2.1) — funciones puras (sin base de datos), usadas por los servicios y por la migración.
 */

/** Orden de salida: primero la fecha de ingreso desconocida (se asume la más antigua), luego la más antigua, luego la creación. */
export function lotOrder(a: Pick<Lot, 'date' | 'createdAt' | 'id'>, b: Pick<Lot, 'date' | 'createdAt' | 'id'>): number {
  const ta = a.date ? Date.parse(a.date) : -Infinity;
  const tb = b.date ? Date.parse(b.date) : -Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Costo por unidad de un lote (null si es desconocido o no queda nada). */
export function lotUnitCost(l: Pick<Lot, 'qty' | 'value' | 'costKnown'>): number | null {
  if (!l.costKnown || l.qty <= 0) return null;
  return l.value / l.qty;
}

/**
 * Qué se saca de cada lote para entregar `q` unidades. No modifica nada.
 * Con `preferredLotId` se empieza por ese lote; el resto sale del más antiguo al más nuevo.
 * Devuelve null si no alcanza.
 */
export function planLotConsumption(lots: Lot[], q: number, preferredLotId?: ID | null): LotTake[] | null {
  const avail = lots.filter((l) => l.qty > 0).sort(lotOrder);
  if (preferredLotId) {
    const i = avail.findIndex((l) => l.id === preferredLotId);
    if (i > 0) avail.unshift(...avail.splice(i, 1));
  }
  const takes: LotTake[] = [];
  let need = q;
  for (const l of avail) {
    if (need <= 0) break;
    const take = Math.min(need, l.qty);
    const cogs = l.costKnown ? (take === l.qty ? l.value : Math.round((l.value * take) / l.qty)) : 0;
    takes.push({ lotId: l.id, qty: take, cogs, unknown: !l.costKnown, date: l.date });
    need -= take;
  }
  return need > 0 ? null : takes;
}

export function summarizeTakes(takes: LotTake[]): { cogs: Money; unknownQty: number; qty: number } {
  return {
    cogs: takes.reduce((a, t) => a + (t.unknown ? 0 : t.cogs), 0),
    unknownQty: takes.reduce((a, t) => a + (t.unknown ? t.qty : 0), 0),
    qty: takes.reduce((a, t) => a + t.qty, 0),
  };
}

interface Layer {
  date: ISODate | null;
  qtyIn: number;
  qty: number;
  unit: number; // costo estimado por unidad (de la entrada original)
  source: LotSource;
  purchaseId: ID | null;
  seq: number;
}

function sourceOf(m: Movement): LotSource {
  if (m.type === 'purchase') return 'purchase';
  if (m.type === 'initial') return 'initial';
  if (m.type === 'return' || m.type === 'void_sale') return 'return';
  if (m.type === 'adjust_in') return 'adjust';
  return 'opening';
}

/**
 * Separa en lotes las existencias de un producto que venía con costo promedio, a partir de su historial:
 * - las entradas se apilan en el orden en que ocurrieron y las salidas sacan primero lo más antiguo
 *   (las unidades sin costo salen primero, igual que en el costo promedio);
 * - el valor total NO cambia: se reparte el valor actual a costo entre los lotes que quedan según el costo
 *   original de cada entrada. Si hubo ventas después de mezclar precios, cada lote puede quedar unos pesos
 *   distinto a su precio de compra original, pero la suma es exacta.
 * Si el historial no cuadra con las existencias, se crea un solo lote de apertura con todo.
 */
export function buildLotsFromHistory(
  product: Pick<Product, 'id' | 'inventoryId' | 'qty' | 'stockValue' | 'unknownCostQty'>,
  movements: Movement[],
  opts: { voidedSales: Set<ID>; voidedPurchases: Set<ID>; supplierOf: (purchaseId: ID) => ID | null; now: ISODate; newId: () => ID },
): Lot[] {
  if (product.qty <= 0) return [];
  const known: Layer[] = [];
  const unknown: Layer[] = [];
  let consistent = true;
  const take = (queue: Layer[], n: number) => {
    let need = n;
    while (need > 0 && queue.length) {
      const L = queue[0];
      const t = Math.min(need, L.qty);
      L.qty -= t;
      need -= t;
      if (L.qty === 0) queue.shift();
    }
    if (need > 0) consistent = false;
  };
  const sorted = movements.filter((m) => m.productId === product.id && m.unitId === null).sort((a, b) => a.seq - b.seq);
  for (const m of sorted) {
    if (m.qtyDelta === 0) continue;
    if ((m.type === 'sale' || m.type === 'void_sale') && m.refId && opts.voidedSales.has(m.refId)) continue;
    if ((m.type === 'purchase' || m.type === 'void_purchase') && m.refId && opts.voidedPurchases.has(m.refId)) continue;
    if (m.qtyDelta > 0) {
      const unk = Math.max(0, Math.min(m.qtyDelta, m.unknownDelta));
      const kn = m.qtyDelta - unk;
      const base = { date: m.dateUnknown ? null : m.at, source: sourceOf(m), purchaseId: m.type === 'purchase' ? m.refId : null, seq: m.seq };
      if (kn > 0) known.push({ ...base, qtyIn: kn, qty: kn, unit: Math.max(0, m.costDelta) / kn });
      if (unk > 0) unknown.push({ ...base, qtyIn: unk, qty: unk, unit: 0 });
    } else {
      const outUnk = Math.max(0, Math.min(-m.qtyDelta, -m.unknownDelta));
      take(unknown, outUnk);
      take(known, -m.qtyDelta - outUnk);
    }
  }
  const knownQty = known.reduce((a, l) => a + l.qty, 0);
  const unknownQty = unknown.reduce((a, l) => a + l.qty, 0);
  if (!consistent || knownQty !== product.qty - product.unknownCostQty || unknownQty !== product.unknownCostQty) {
    const out: Lot[] = [];
    const kq = product.qty - product.unknownCostQty;
    const mk = (qty: number, value: number, costKnown: boolean): Lot => ({
      id: opts.newId(),
      productId: product.id,
      inventoryId: product.inventoryId,
      source: 'opening',
      purchaseId: null,
      purchaseLineId: null,
      supplierId: null,
      date: null,
      qtyIn: qty,
      valueIn: value,
      qty,
      value,
      costKnown,
      notes: 'Existencias al separar por lotes',
      createdAt: opts.now,
    });
    if (product.unknownCostQty > 0) out.push(mk(product.unknownCostQty, 0, false));
    if (kq > 0) out.push(mk(kq, product.stockValue, true));
    return out;
  }
  // Repartir el valor actual según el costo original (exacto al peso)
  const weights = known.map((l) => l.qty * l.unit);
  const values = allocate(product.stockValue, weights.some((w) => w > 0) ? weights : known.map((l) => l.qty));
  const lots: Lot[] = [];
  const add = (l: Layer, value: number, costKnown: boolean, i: number) => {
    // Unir capas de la misma compra
    const same = l.purchaseId ? lots.find((x) => x.purchaseId === l.purchaseId && x.costKnown === costKnown) : undefined;
    if (same) {
      same.qty += l.qty;
      same.qtyIn += l.qtyIn;
      same.value += value;
      same.valueIn += value;
      return;
    }
    lots.push({
      id: opts.newId(),
      productId: product.id,
      inventoryId: product.inventoryId,
      source: l.source,
      purchaseId: l.purchaseId,
      purchaseLineId: null,
      supplierId: l.purchaseId ? opts.supplierOf(l.purchaseId) : null,
      date: l.date,
      qtyIn: l.qtyIn,
      valueIn: value,
      qty: l.qty,
      value,
      costKnown,
      notes: l.qty < l.qtyIn ? 'Separado del costo promedio (ya se vendió una parte)' : 'Separado del costo promedio',
      createdAt: new Date(Date.parse(opts.now) + i).toISOString(),
    });
  };
  unknown.forEach((l, i) => add(l, 0, false, i));
  known.forEach((l, i) => add(l, values[i], true, unknown.length + i));
  return lots;
}
