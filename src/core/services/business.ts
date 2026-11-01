import type { AppDB } from '../db';
import { BUSINESS_BY_ID, DEFAULT_PROFILE, normalizeProfile, type BusinessProfile, type BusinessTypeId, type FeatureKey } from '../business';
import type { ID } from '../types';
import { fail } from '../util';
import { createInventory } from './inventories';
import { createProduct } from './products';
import { tx } from './stock';

const KEY = 'businessProfile';

export async function getBusinessProfile(db: AppDB): Promise<BusinessProfile> {
  const rec = await db.meta.get(KEY);
  if (!rec) return { ...DEFAULT_PROFILE, overrides: {} };
  try {
    return normalizeProfile(JSON.parse(rec.value));
  } catch {
    return { ...DEFAULT_PROFILE, overrides: {} };
  }
}

async function put(db: AppDB, p: BusinessProfile): Promise<BusinessProfile> {
  const clean = normalizeProfile(p);
  await db.meta.put({ key: KEY, value: JSON.stringify(clean) });
  return clean;
}

/** Guarda los tipos de negocio elegidos y marca la bienvenida como terminada. Al cambiar de tipo se borran los cambios a mano. */
export async function setBusinessTypes(db: AppDB, types: BusinessTypeId[], opts: { keepOverrides?: boolean } = {}): Promise<BusinessProfile> {
  const valid = [...new Set(types)].filter((t) => BUSINESS_BY_ID.has(t));
  if (!valid.length) fail('required', 'Elige al menos un tipo de negocio.', 'types');
  return tx(db, async () => {
    const cur = await getBusinessProfile(db);
    return put(db, { done: true, types: valid, overrides: opts.keepOverrides ? cur.overrides : {} });
  });
}

/** Enciende o apaga una función a mano (pisa lo que sugiere el tipo de negocio). */
export async function setFeatureOverride(db: AppDB, key: FeatureKey, on: boolean | null): Promise<BusinessProfile> {
  return tx(db, async () => {
    const cur = await getBusinessProfile(db);
    const overrides = { ...cur.overrides };
    if (on === null) delete overrides[key];
    else overrides[key] = on;
    return put(db, { ...cur, overrides });
  });
}

/** Termina la bienvenida sin elegir (por ejemplo, al restaurar un respaldo o si ya tenías datos): queda todo activo. */
export async function skipBusinessWelcome(db: AppDB): Promise<BusinessProfile> {
  return tx(db, async () => {
    const cur = await getBusinessProfile(db);
    return put(db, { ...cur, done: true });
  });
}

/**
 * Crea un inventario sencillo con los productos típicos de un tipo de negocio (por cantidad, sin precios ni existencias:
 * los completas tú). Es opcional y se pide con un botón.
 */
export async function createStarterInventory(db: AppDB, type: BusinessTypeId): Promise<{ inventoryId: ID; products: number }> {
  const t = BUSINESS_BY_ID.get(type);
  if (!t) fail('invalid', 'Ese tipo de negocio no existe.', 'type');
  const inv = await createInventory(db, { name: t.inventoryName, mode: 'simple' });
  let n = 0;
  for (const p of t.starter) {
    await createProduct(db, { inventoryId: inv.id, kind: 'other', tracking: 'quantity', name: p.name });
    n++;
  }
  return { inventoryId: inv.id, products: n };
}
