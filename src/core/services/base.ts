import type { AppDB } from '../db';
import type { HistoryEntry, ID, Movement, PricingSettings, Product, Settings } from '../types';
import { fail, newId, nowISO } from '../util';

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  businessName: '',
  defaultMode: 'simple',
  prefixes: { iphone: 'IPH', phone: 'TEL', audio: 'AUD', accessory: 'ACC', other: 'OTR' },
  staleEnabled: true,
  staleDays: 60,
  staleDaysNew: null,
  staleDaysUsed: null,
  warrantyAlertDays: 15,
  backupReminderDays: 7,
  conditions: ['Nuevo', 'Usado', 'Restaurado'],
  pricing: {
    minMarginType: 'amount',
    minMarginValue: 100_000,
    targetMarginType: 'amount',
    targetMarginValue: 250_000,
    expectedCosts: 0,
    batteryThreshold: null,
    batteryDiscount: 0,
    genericPartDiscount: 0,
    marketStaleDays: 30,
    recentSalesDays: 90,
  },
  paymentFees: { Efectivo: 0, Transferencia: 0, Nequi: 0, Daviplata: 0, Tarjeta: 0, Otro: 0 },
  showGettingStarted: true,
};

/** Combina lo guardado con los valores por defecto (los campos nuevos de versiones posteriores quedan con su valor por defecto). */
export function mergeSettings(s: Partial<Settings> | undefined | null): Settings {
  if (!s) return { ...DEFAULT_SETTINGS, pricing: { ...DEFAULT_SETTINGS.pricing }, paymentFees: { ...DEFAULT_SETTINGS.paymentFees } };
  const pricing: PricingSettings = { ...DEFAULT_SETTINGS.pricing, ...(s.pricing ?? {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    key: 'app',
    prefixes: { ...DEFAULT_SETTINGS.prefixes, ...(s.prefixes ?? {}) },
    pricing,
    paymentFees: { ...DEFAULT_SETTINGS.paymentFees, ...(s.paymentFees ?? {}) },
  };
}

export async function getSettings(db: AppDB): Promise<Settings> {
  return mergeSettings(await db.settings.get('app'));
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
    fail('archived', `El inventario "${inv.name}" está archivado. Desarchívalo para registrar operaciones.`, 'inventoryId');
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
