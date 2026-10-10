import type { AppDB } from '../db';
import { builtinCatalog } from '../catalog';
import type { CatalogModel, ProductKind, Settings } from '../types';
import { cleanStr, fail, newId, nowISO } from '../util';
import { DEFAULT_SETTINGS, getSettings, logHistory, mergeSettings } from './base';

export { DEFAULT_SETTINGS, getSettings, mergeSettings };

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
    if (!(await db.settings.get('app'))) await db.settings.put(mergeSettings(null));
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

export type SettingsPatch = Partial<Omit<Settings, 'key' | 'pricing'>> & { pricing?: Partial<Settings['pricing']> };

function checkDays(v: number | null, field: string, label: string, allowNull: boolean): void {
  if (v === null && allowNull) return;
  if (v === null || !Number.isInteger(v) || v < 1 || v > 3650) fail('invalid', `${label}: entre 1 y 3650 días.`, field);
}

function checkMargin(type: string, value: number, field: string, label: string): void {
  if (type !== 'percent' && type !== 'amount') fail('invalid', `${label}: tipo de margen inválido.`, field);
  if (!Number.isFinite(value) || value < 0) fail('invalid', `${label}: no puede ser negativo.`, field);
  if (type === 'percent' && value > 1000) fail('invalid', `${label}: máximo 1000 %.`, field);
  if (type === 'amount' && !Number.isInteger(value)) fail('invalid', `${label}: usa pesos enteros.`, field);
}

function checkMoney(v: number, field: string, label: string): void {
  if (!Number.isInteger(v) || v < 0) fail('invalid', `${label}: debe ser un valor en pesos, cero o mayor.`, field);
}

export async function updateSettings(db: AppDB, patch: SettingsPatch): Promise<Settings> {
  return db.transaction('rw', db.settings, db.history, async () => {
    const cur = await getSettings(db);
    const next: Settings = {
      ...cur,
      ...patch,
      prefixes: { ...cur.prefixes, ...(patch.prefixes ?? {}) },
      pricing: { ...cur.pricing, ...(patch.pricing ?? {}) },
      paymentFees: patch.paymentFees ? { ...patch.paymentFees } : { ...cur.paymentFees },
      key: 'app',
    };
    for (const [k, v] of Object.entries(next.prefixes)) {
      const up = v.trim().toUpperCase();
      if (!PREFIX_RE.test(up)) fail('invalid_prefix', `Prefijo inválido (${k}): usa de 1 a 6 letras o números.`, `prefix.${k}`);
      (next.prefixes as Record<string, string>)[k] = up;
    }
    next.staleEnabled = next.staleEnabled !== false;
    checkDays(next.staleDays, 'staleDays', 'Días para considerar un producto estancado', false);
    checkDays(next.staleDaysNew, 'staleDaysNew', 'Días de estancado para equipos nuevos', true);
    checkDays(next.staleDaysUsed, 'staleDaysUsed', 'Días de estancado para usados y restaurados', true);
    if (!Number.isInteger(next.warrantyAlertDays) || next.warrantyAlertDays < 0 || next.warrantyAlertDays > 365)
      fail('invalid', 'Días de aviso de garantías: entre 0 y 365.', 'warrantyAlertDays');
    if (!Number.isInteger(next.backupReminderDays) || next.backupReminderDays < 0 || next.backupReminderDays > 365)
      fail('invalid', 'Días para recordar respaldo: entre 0 y 365.', 'backupReminderDays');
    const pr = next.pricing;
    checkMargin(pr.minMarginType, pr.minMarginValue, 'pricing.minMarginValue', 'Margen mínimo');
    checkMargin(pr.targetMarginType, pr.targetMarginValue, 'pricing.targetMarginValue', 'Margen deseado');
    checkMoney(pr.expectedCosts, 'pricing.expectedCosts', 'Gastos esperados por equipo');
    checkMoney(pr.batteryDiscount, 'pricing.batteryDiscount', 'Descuento por batería');
    checkMoney(pr.genericPartDiscount, 'pricing.genericPartDiscount', 'Descuento por pieza genérica');
    if (pr.batteryThreshold !== null && (!Number.isInteger(pr.batteryThreshold) || pr.batteryThreshold < 1 || pr.batteryThreshold > 100))
      fail('invalid', 'Batería mínima: entre 1 y 100 %.', 'pricing.batteryThreshold');
    if (!Number.isInteger(pr.marketStaleDays) || pr.marketStaleDays < 1 || pr.marketStaleDays > 365)
      fail('invalid', 'Días para precio de mercado desactualizado: entre 1 y 365.', 'pricing.marketStaleDays');
    if (!Number.isInteger(pr.recentSalesDays) || pr.recentSalesDays < 7 || pr.recentSalesDays > 730)
      fail('invalid', 'Días para "tu precio real": entre 7 y 730.', 'pricing.recentSalesDays');
    const fees: Record<string, number> = {};
    for (const [method, pct] of Object.entries(next.paymentFees)) {
      const name = cleanStr(method, 30);
      if (!name) continue;
      if (!Number.isFinite(pct) || pct < 0 || pct > 50)
        fail('invalid', `Comisión de "${name}": entre 0 y 50 %.`, `paymentFees.${name}`);
      fees[name] = Math.round(pct * 100) / 100;
    }
    next.paymentFees = fees;
    next.showGettingStarted = next.showGettingStarted !== false;
    next.businessName = cleanStr(next.businessName, 80);
    next.conditions = next.conditions.map((c) => cleanStr(c, 40)).filter(Boolean);
    if (next.conditions.length === 0) next.conditions = [...DEFAULT_SETTINGS.conditions];
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
  if (!brand) fail('required', 'Escribe la marca.', 'brand');
  if (!model) fail('required', 'Escribe el modelo.', 'model');
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
