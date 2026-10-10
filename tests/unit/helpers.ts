import { AppDB, DATA_TABLES, initDatabase, newId, readAllTables, verifyIntegrity } from '../../src/core';
import { createInventory } from '../../src/core/services/inventories';
import { createProduct, type ProductInput } from '../../src/core/services/products';
import { expect } from 'vitest';

let n = 0;
export async function makeDB(): Promise<AppDB> {
  const db = new AppDB(`test-${Date.now()}-${n++}-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDatabase(db);
  return db;
}

export const op = () => newId();

export const D = (s: string) => new Date(s).toISOString();

export async function setupInventory(db: AppDB, name = 'Principal', mode: 'simple' | 'pro' = 'simple') {
  return createInventory(db, { name, mode });
}

export async function phoneProduct(db: AppDB, inventoryId: string, model = 'iPhone 13', capacity = '128 GB', extra: Partial<ProductInput> = {}) {
  return createProduct(db, { inventoryId, kind: 'phone', brand: 'Apple', model, capacity, ...extra });
}

export async function accessoryProduct(db: AppDB, inventoryId: string, name = 'Cargador USB-C 20W', extra: Partial<ProductInput> = {}) {
  return createProduct(db, { inventoryId, kind: 'accessory', name, ...extra });
}

export async function availableUnits(db: AppDB, productId: string) {
  return db.units.where('productId').equals(productId).filter((u) => u.status === 'available').toArray();
}

export async function expectIntegrity(db: AppDB) {
  const r = await verifyIntegrity(db);
  expect(r.issues).toEqual([]);
  expect(r.ok).toBe(true);
}

/** Instantánea de todas las tablas excepto las indicadas, para comparar "nada cambió". */
export async function snapshot(db: AppDB, exclude: string[] = []) {
  const t = await readAllTables(db);
  const out: Record<string, unknown> = {};
  for (const k of DATA_TABLES) if (!exclude.includes(k)) out[k] = t[k];
  return JSON.parse(JSON.stringify(out, (_k, v) => (v instanceof ArrayBuffer ? `buf:${v.byteLength}` : v)));
}
