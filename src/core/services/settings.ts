import type { AppDB } from '../db';
import { builtinCatalog } from '../catalog';
import type { CatalogModel, ProductKind, Settings } from '../types';
import { cleanStr, fail, newId, nowISO } from '../util';
import { DEFAULT_SETTINGS, getSettings, logHistory } from './base';

export { DEFAULT_SETTINGS, getSettings };

/**
 * Prepara la base de datos al abrir la app: crea el identificador de la instalación,
 * la configuración por defecto y añade al catálogo los modelos base que falten.
 * Es idempotente.
 */
export async function initDatabase(db: AppDB): Promise<void> {
  await db.transaction('rw', db.meta, db.settings, db.catalogModels, async () => {
    if (!(await db.meta.get('installationId'))) {
      await db.meta.put({ key: 'installationId', value: newId() });
      await db.meta.put({ key: 'createdAt', value: nowISO() });
    }
    if (!(await db.settings.get('app'))) await db.settings.put(DEFAULT_SETTINGS);
    const seed = builtinCatalog(nowISO());
    const existing = new Set(await db.catalogModels.toCollection().primaryKeys());
    const missing = seed.filter((m) => !existing.has(m.id));
    if (missing.length) await db.catalogModels.bulkAdd(missing);
  });
}

export async function getMeta(db: AppDB, key: string): Promise<string | null> {
  return (await db.meta.get(key))?.value ?? null;
}

export async function setMeta(db: AppDB, key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

const PREFIX_RE = /^[A-Z0-9]{1,6}$/;

export async function updateSettings(db: AppDB, patch: Partial<Omit<Settings, 'key'>>): Promise<Settings> {
  return db.transaction('rw', db.settings, db.history, async () => {
    const cur = await getSettings(db);
    const next: Settings = {
      ...cur,
      ...patch,
      prefixes: { ...cur.prefixes, ...(patch.prefixes ?? {}) },
      key: 'app',
    };
    for (const [k, v] of Object.entries(next.prefixes)) {
      const up = v.trim().toUpperCase();
      if (!PREFIX_RE.test(up)) fail('invalid_prefix', `Prefijo inválido (${k}): use de 1 a 6 letras o números.`, `prefix.${k}`);
      (next.prefixes as Record<string, string>)[k] = up;
    }
    if (!Number.isInteger(next.staleDays) || next.staleDays < 1 || next.staleDays > 3650)
      fail('invalid', 'Días para considerar un producto estancado: entre 1 y 3650.', 'staleDays');
    if (!Number.isInteger(next.warrantyAlertDays) || next.warrantyAlertDays < 0 || next.warrantyAlertDays > 365)
      fail('invalid', 'Días de aviso de garantías: entre 0 y 365.', 'warrantyAlertDays');
    if (!Number.isInteger(next.backupReminderDays) || next.backupReminderDays < 0 || next.backupReminderDays > 365)
      fail('invalid', 'Días para recordar respaldo: entre 0 y 365.', 'backupReminderDays');
    next.businessName = cleanStr(next.businessName, 80);
    next.conditions = next.conditions.map((c) => cleanStr(c, 40)).filter(Boolean);
    if (next.conditions.length === 0) next.conditions = DEFAULT_SETTINGS.conditions;
    await db.settings.put(next);
    await logHistory(db, {
      entityType: 'settings',
      entityId: 'app',
      inventoryId: null,
      action: 'update',
      summary: 'Configuración actualizada',
    });
    return next;
  });
}

/* ---------------- Catálogo ---------------- */

export interface CatalogInput {
  category: ProductKind;
  brand: string;
  model: string;
  generation?: string;
  year?: number | null;
  storageOptions?: string[];
  biometric?: CatalogModel['biometric'];
}

export async function addCatalogModel(db: AppDB, input: CatalogInput): Promise<CatalogModel> {
  const brand = cleanStr(input.brand, 60);
  const model = cleanStr(input.model, 80);
  if (!brand) fail('required', 'Ingrese la marca.', 'brand');
  if (!model) fail('required', 'Ingrese el modelo.', 'model');
  return db.transaction('rw', db.catalogModels, db.history, async () => {
    const all = await db.catalogModels.toArray();
    const dup = all.find(
      (m) => m.brand.toLowerCase() === brand.toLowerCase() && m.model.toLowerCase() === model.toLowerCase(),
    );
    if (dup) fail('duplicate', `El modelo "${model}" de ${brand} ya está en el catálogo.`, 'model');
    const rec: CatalogModel = {
      id: newId(),
      category: input.category,
      brand,
      model,
      generation: cleanStr(input.generation ?? '', 60) || model,
      year: input.year ?? null,
      storageOptions: (input.storageOptions ?? []).map((s) => cleanStr(s, 20)).filter(Boolean),
      biometric: input.biometric ?? 'unknown',
      builtin: false,
      archived: false,
      createdAt: nowISO(),
    };
    await db.catalogModels.add(rec);
    await logHistory(db, {
      entityType: 'catalog',
      entityId: rec.id,
      inventoryId: null,
      action: 'create',
      summary: `Modelo añadido al catálogo: ${brand} ${model}`,
    });
    return rec;
  });
}

export async function updateCatalogModel(
  db: AppDB,
  id: string,
  patch: Partial<Pick<CatalogModel, 'storageOptions' | 'archived' | 'model' | 'brand' | 'generation' | 'year'>>,
): Promise<void> {
  await db.transaction('rw', db.catalogModels, async () => {
    const m = await db.catalogModels.get(id);
    if (!m) fail('not_found', 'El modelo no existe.');
    const next = { ...m, ...patch };
    if (!m.builtin) {
      next.brand = cleanStr(next.brand, 60) || m.brand;
      next.model = cleanStr(next.model, 80) || m.model;
    } else {
      // Los modelos base conservan marca y nombre; solo se pueden ocultar o ajustar capacidades.
      next.brand = m.brand;
      next.model = m.model;
    }
    next.storageOptions = (next.storageOptions ?? []).map((s) => cleanStr(s, 20)).filter(Boolean);
    await db.catalogModels.put(next);
  });
}
