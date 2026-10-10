import type { AppDB } from '../db';
import type { HistoryEntry, ID, Movement, Product, Settings } from '../types';
import { fail, newId, nowISO } from '../util';

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  businessName: '',
  defaultMode: 'simple',
  prefixes: { iphone: 'IPH', phone: 'TEL', audio: 'AUD', accessory: 'ACC', other: 'OTR' },
  staleDays: 60,
  warrantyAlertDays: 15,
  backupReminderDays: 7,
  conditions: ['Nuevo', 'Usado', 'Reacondicionado'],
};

export async function getSettings(db: AppDB): Promise<Settings> {
  const s = await db.settings.get('app');
  return s ? { ...DEFAULT_SETTINGS, ...s, prefixes: { ...DEFAULT_SETTINGS.prefixes, ...s.prefixes } } : DEFAULT_SETTINGS;
}

export async function logHistory(
  db: AppDB,
  e: Omit<HistoryEntry, 'id' | 'at'> & { at?: string },
): Promise<void> {
  await db.history.add({ id: newId(), at: e.at ?? nowISO(), ...e });
}

/** Siguiente número de una secuencia persistente (nunca se reutiliza). Debe llamarse dentro de una transacción rw que incluya `counters`. */
export async function nextCounter(db: AppDB, key: string): Promise<number> {
  const c = await db.counters.get(key);
  const value = (c?.value ?? 0) + 1;
  await db.counters.put({ prefix: key, value });
  return value;
}

export async function addMovement(db: AppDB, m: Omit<Movement, 'id' | 'seq' | 'createdAt'>): Promise<Movement> {
  const seq = await nextCounter(db, '#movement');
  const mv: Movement = { id: newId(), seq, createdAt: nowISO(), ...m };
  await db.movements.add(mv);
  return mv;
}

export function codePrefixFor(settings: Settings, p: Pick<Product, 'kind' | 'brand'>): string {
  const isApple = p.brand.trim().toLowerCase() === 'apple';
  switch (p.kind) {
    case 'phone':
      return isApple ? settings.prefixes.iphone : settings.prefixes.phone;
    case 'audio':
      return settings.prefixes.audio;
    case 'accessory':
      return settings.prefixes.accessory;
    default:
      return settings.prefixes.other;
  }
}

/** Genera un código interno único y permanente (p. ej. IPH-0001). */
export async function nextUnitCode(db: AppDB, prefix: string): Promise<string> {
  const clean = prefix.trim().toUpperCase() || 'UNI';
  for (let i = 0; i < 1000; i++) {
    const n = await nextCounter(db, `code:${clean}`);
    const code = `${clean}-${String(n).padStart(4, '0')}`;
    const exists = await db.units.where('code').equals(code).count();
    if (!exists) return code;
  }
  return fail('code_exhausted', 'No se pudo generar un código interno único.');
}

export async function requireInventory(db: AppDB, id: ID, opts: { allowArchived?: boolean } = {}) {
  const inv = await db.inventories.get(id);
  if (!inv) fail('not_found', 'El inventario no existe.', 'inventoryId');
  if (inv.archived && !opts.allowArchived)
    fail('archived', `El inventario "${inv.name}" está archivado. Desarchívelo para registrar operaciones.`, 'inventoryId');
  return inv;
}

export async function requireProduct(db: AppDB, id: ID) {
  const p = await db.products.get(id);
  if (!p) fail('not_found', 'El producto no existe.', 'productId');
  return p;
}

export async function requireUnit(db: AppDB, id: ID) {
  const u = await db.units.get(id);
  if (!u) fail('not_found', 'La unidad no existe.', 'unitId');
  return u;
}
