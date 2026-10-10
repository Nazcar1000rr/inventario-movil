import type { AppDB } from '../db';
import type { Money, Product, Unit } from '../types';
import { fail, newId } from '../util';

/** Transacción de escritura sobre todas las tablas: garantiza atomicidad total de la operación. */
export function tx<T>(db: AppDB, fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.allTables(), fn);
}

/**
 * Idempotencia: registra `opId` una sola vez. Devuelve false si la operación ya se había registrado
 * (doble pulsación o reintento). Debe llamarse dentro de una transacción que incluya `meta`.
 */
export async function claimOp(db: AppDB, opId: string | undefined): Promise<boolean> {
  if (!opId) return true;
  const key = `op:${opId}`;
  if (await db.meta.get(key)) return false;
  await db.meta.put({ key, value: new Date().toISOString() });
  return true;
}

export function newOpId(): string {
  return newId();
}

/** Costo total conocido de una unidad, o null si el costo de adquisición es desconocido. */
export function unitCost(u: Pick<Unit, 'baseCost' | 'extraCost'>): Money | null {
  return u.baseCost === null ? null : u.baseCost + u.extraCost;
}

export interface Consumption {
  cogs: Money; // costo conocido consumido
  unknownQty: number; // cantidad consumida sin costo conocido
  qty: number;
  stockValue: Money;
  unknownCostQty: number;
}

/**
 * Salida de un producto por cantidad, con COSTO PROMEDIO PONDERADO.
 * Las unidades con costo desconocido (stock inicial sin costo) se consideran las más antiguas
 * y salen primero. Nunca deja stock negativo.
 */
export function consumeQuantity(p: Pick<Product, 'qty' | 'stockValue' | 'unknownCostQty' | 'name'>, q: number): Consumption {
  if (q > p.qty)
    fail('insufficient_stock', `Stock insuficiente de "${p.name}": hay ${p.qty} disponible(s) y se intentan sacar ${q}.`, 'quantity');
  const unknownQty = Math.min(q, p.unknownCostQty);
  const knownQty = q - unknownQty;
  const knownPool = p.qty - p.unknownCostQty;
  let cogs = 0;
  if (knownQty > 0) cogs = knownQty === knownPool ? p.stockValue : Math.round((p.stockValue * knownQty) / knownPool);
  return {
    cogs,
    unknownQty,
    qty: p.qty - q,
    stockValue: p.stockValue - cogs,
    unknownCostQty: p.unknownCostQty - unknownQty,
  };
}

/** Ordena unidades disponibles por antigüedad (FIFO). Fecha desconocida = más antigua. */
export function fifoOrder(a: Unit, b: Unit): number {
  const ta = a.availableSince ? Date.parse(a.availableSince) : -Infinity;
  const tb = b.availableSince ? Date.parse(b.availableSince) : -Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.code.localeCompare(b.code);
}

export interface ProductStock {
  tracking: Product['tracking'];
  available: number;
  inReview: number;
  damaged: number;
  sold: number;
  archived: number;
  /** Valor a costo del stock disponible con costo conocido. */
  availableValue: Money;
  /** Cantidad disponible cuyo costo es desconocido. */
  unknownCostCount: number;
  /** Valor a costo de unidades en revisión o dañadas (no disponibles para venta). */
  otherValue: Money;
}

export async function getProductStock(db: AppDB, p: Product): Promise<ProductStock> {
  if (p.tracking === 'quantity') {
    return {
      tracking: 'quantity',
      available: p.qty,
      inReview: 0,
      damaged: 0,
      sold: 0,
      archived: 0,
      availableValue: p.stockValue,
      unknownCostCount: p.unknownCostQty,
      otherValue: 0,
    };
  }
  const units = await db.units.where('productId').equals(p.id).toArray();
  return summarizeUnits(units);
}

export function summarizeUnits(units: Unit[]): ProductStock {
  const s: ProductStock = {
    tracking: 'unit',
    available: 0,
    inReview: 0,
    damaged: 0,
    sold: 0,
    archived: 0,
    availableValue: 0,
    unknownCostCount: 0,
    otherValue: 0,
  };
  for (const u of units) {
    const c = unitCost(u);
    switch (u.status) {
      case 'available':
        s.available++;
        if (c === null) s.unknownCostCount++;
        else s.availableValue += c;
        break;
      case 'in_review':
        s.inReview++;
        if (c !== null) s.otherValue += c;
        break;
      case 'damaged':
        s.damaged++;
        if (c !== null) s.otherValue += c;
        break;
      case 'sold':
        s.sold++;
        break;
      case 'archived':
        s.archived++;
        break;
    }
  }
  return s;
}
