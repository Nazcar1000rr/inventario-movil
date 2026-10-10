import Dexie from 'dexie';
import { AppDB, DATA_TABLES, DB_SCHEMA_VERSION, type TableName } from '../db';
import { AppError, fail, nowISO } from '../util';
import { verifyIntegrity, type IntegrityReport } from './integrity';

/**
 * FORMATO DE RESPALDO PROPIO (archivo .json)
 * {
 *   format: "inventario-movil-backup", formatVersion: 1,
 *   schemaVersion: <versión del esquema de datos>, appVersion, createdAt, installationId,
 *   encrypted: false, checksum: <SHA-256 del JSON de payload>, payload: { counts, tables }
 * }
 * Cifrado (opcional): encrypted: true, crypto: { PBKDF2-SHA256 + AES-GCM-256, salt, iv, iterations },
 * ciphertext: base64( JSON del payload ). AES-GCM autentica el contenido: si la contraseña
 * es incorrecta o el archivo fue alterado, no se puede abrir.
 */
export const BACKUP_FORMAT = 'inventario-movil-backup';
export const BACKUP_FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export type Tables = Record<string, unknown[]>;

export interface BackupPayload {
  counts: Record<string, number>;
  tables: Tables;
}

interface Envelope {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  installationId: string;
  businessName?: string;
  encrypted: boolean;
  checksum?: string;
  payload?: BackupPayload;
  crypto?: { kdf: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string; cipher: 'AES-GCM'; iv: string };
  ciphertext?: string;
}

export const TABLE_LABEL: Partial<Record<TableName, string>> = {
  inventories: 'Inventarios',
  products: 'Productos',
  units: 'Unidades',
  purchases: 'Compras',
  sales: 'Ventas',
  payments: 'Pagos',
  returns: 'Devoluciones',
  expenses: 'Gastos',
  suppliers: 'Proveedores',
  customers: 'Compradores',
  warranties: 'Garantías',
  warrantyClaims: 'Reclamos',
  repairs: 'Reparaciones',
  photos: 'Fotos',
  consolidatedViews: 'Vistas consolidadas',
  movements: 'Movimientos',
  catalogModels: 'Modelos del catálogo',
};

/* ---------------- Codificación ---------------- */

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ArrayBuffer (fotos) → { $ab: base64 } para poder guardarlo en JSON. */
function encodeValue(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $ab: bytesToB64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { $ab: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = encodeValue(x);
    return o;
  }
  return v;
}

function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === '$ab' && typeof obj.$ab === 'string') {
      const b = b64ToBytes(obj.$ab);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(obj)) o[k] = decodeValue(x);
    return o;
  }
  return v;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ---------------- Exportar ---------------- */

export interface ExportResult {
  text: string;
  filename: string;
  createdAt: string;
  counts: Record<string, number>;
  bytes: number;
}

/** Lee TODA la base en una sola transacción de lectura (instantánea coherente). */
export async function readAllTables(db: AppDB): Promise<Tables> {
  return db.transaction('r', db.allTables(), async () => {
    const out: Tables = {};
    for (const t of DATA_TABLES) out[t] = await db.table(t).toArray();
    return out;
  });
}

export function backupFilename(createdAt: string, encrypted: boolean): string {
  const d = new Date(createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `inventario-respaldo-${stamp}${encrypted ? '-cifrado' : ''}.json`;
}

export async function createBackup(db: AppDB, opts: { password?: string } = {}): Promise<ExportResult> {
  const raw = await readAllTables(db);
  const tables = encodeValue(raw) as Tables;
  const counts: Record<string, number> = {};
  for (const t of DATA_TABLES) counts[t] = tables[t].length;
  const payload: BackupPayload = { counts, tables };
  const payloadText = JSON.stringify(payload);
  const installationId = (raw.meta as { key: string; value: string }[]).find((m) => m.key === 'installationId')?.value ?? '';
  const settings = (raw.settings as { businessName?: string }[])[0];
  const createdAt = nowISO();
  const env: Envelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DB_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt,
    installationId,
    businessName: settings?.businessName ?? '',
    encrypted: false,
  };
  if (opts.password) {
    if (opts.password.length < 6) fail('weak_password', 'La contraseña debe tener al menos 6 caracteres.', 'password');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(opts.password, salt, PBKDF2_ITERATIONS);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(payloadText));
    env.encrypted = true;
    env.crypto = { kdf: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToB64(salt), cipher: 'AES-GCM', iv: bytesToB64(iv) };
    env.ciphertext = bytesToB64(new Uint8Array(ct));
    delete env.businessName;
  } else {
    env.checksum = await sha256Hex(payloadText);
    env.payload = payload;
  }
  const text = JSON.stringify(env);
  return { text, filename: backupFilename(createdAt, !!opts.password), createdAt, counts, bytes: new TextEncoder().encode(text).length };
}

/** Registrar que el usuario guardó/compartió el respaldo. */
export async function markBackupDone(db: AppDB, createdAt: string): Promise<void> {
  await db.meta.put({ key: 'lastBackupAt', value: createdAt });
}

/* ---------------- Leer y validar ---------------- */

export interface ParsedBackup {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  installationId: string;
  businessName: string;
  encrypted: boolean;
  checksum: string;
  counts: Record<string, number>;
  tables: Tables; // ya decodificadas y migradas al esquema actual
  migratedFrom: number | null;
}

export type BackupMigration = (tables: Tables) => Tables;

/**
 * Migraciones de respaldos antiguos: clave = versión de origen; convierte a versión + 1.
 * Ejemplo para una futura versión 2:  1: (t) => ({ ...t, units: t.units.map((u) => ({ ...u, nuevoCampo: null })) })
 */
export const BACKUP_MIGRATIONS: Record<number, BackupMigration> = {};

export function migrateTables(tables: Tables, fromVersion: number, toVersion = DB_SCHEMA_VERSION, migrations = BACKUP_MIGRATIONS): Tables {
  let t = tables;
  for (let v = fromVersion; v < toVersion; v++) {
    const m = migrations[v];
    if (!m) fail('no_migration', `No hay forma de convertir un respaldo de la versión de datos ${v}.`);
    t = m(t);
  }
  return t;
}

export async function parseBackup(text: string, password?: string, migrations = BACKUP_MIGRATIONS): Promise<ParsedBackup> {
  let env: Envelope;
  try {
    env = JSON.parse(text);
  } catch {
    fail('not_json', 'El archivo no es un respaldo válido: no se puede leer (está dañado o no es de esta app).');
  }
  if (!env || typeof env !== 'object' || env.format !== BACKUP_FORMAT)
    fail('wrong_format', 'El archivo no es un respaldo de esta aplicación.');
  if (typeof env.formatVersion !== 'number' || env.formatVersion > BACKUP_FORMAT_VERSION)
    fail('newer_format', 'El respaldo fue creado con una versión más nueva de la app. Actualice la app antes de importarlo.');
  if (typeof env.schemaVersion !== 'number' || env.schemaVersion < 1)
    fail('bad_header', 'El encabezado del respaldo está dañado.');
  if (env.schemaVersion > DB_SCHEMA_VERSION)
    fail('newer_schema', 'El respaldo contiene datos de una versión más nueva de la app. Actualice la app antes de importarlo.');

  let payload: BackupPayload;
  let checksum: string;
  if (env.encrypted) {
    if (!env.crypto || !env.ciphertext) fail('bad_header', 'El respaldo cifrado está incompleto.');
    if (!password) fail('password_required', 'Este respaldo está protegido con contraseña.', 'password');
    let plain: string;
    try {
      const key = await deriveKey(password, b64ToBytes(env.crypto.salt), env.crypto.iterations);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.crypto.iv) as BufferSource }, key, b64ToBytes(env.ciphertext) as BufferSource);
      plain = new TextDecoder().decode(pt);
    } catch {
      fail('bad_password', 'Contraseña incorrecta o archivo dañado. No se pudo abrir el respaldo.', 'password');
    }
    try {
      payload = JSON.parse(plain);
    } catch {
      fail('corrupt', 'El contenido del respaldo está dañado.');
    }
    checksum = await sha256Hex(plain);
  } else {
    if (!env.payload || typeof env.checksum !== 'string') fail('corrupt', 'El respaldo está incompleto.');
    payload = env.payload;
    checksum = await sha256Hex(JSON.stringify(payload));
    if (checksum !== env.checksum)
      fail('checksum', 'El respaldo está dañado o fue modificado (la suma de verificación no coincide). No se importó nada.');
  }
  if (!payload || typeof payload !== 'object' || !payload.tables || !payload.counts) fail('corrupt', 'El contenido del respaldo está incompleto.');

  let tables = decodeValue(payload.tables) as Tables;
  for (const t of DATA_TABLES) {
    if (!Array.isArray(tables[t])) fail('missing_table', `El respaldo está incompleto: falta la sección "${TABLE_LABEL[t] ?? t}".`);
    if (payload.counts[t] !== tables[t].length)
      fail('count_mismatch', `El respaldo está incompleto: la sección "${TABLE_LABEL[t] ?? t}" no tiene la cantidad esperada de registros.`);
  }
  const migratedFrom = env.schemaVersion < DB_SCHEMA_VERSION ? env.schemaVersion : null;
  tables = migrateTables(tables, env.schemaVersion, DB_SCHEMA_VERSION, migrations);
  validateTables(tables);

  return {
    createdAt: env.createdAt,
    appVersion: env.appVersion,
    schemaVersion: env.schemaVersion,
    installationId: env.installationId,
    businessName: env.businessName ?? '',
    encrypted: !!env.encrypted,
    checksum,
    counts: Object.fromEntries(DATA_TABLES.map((t) => [t, tables[t].length])),
    tables,
    migratedFrom,
  };
}

/* ---------------- Validación estructural ---------------- */

type FieldType = 'str' | 'str?' | 'int' | 'int?' | 'bool' | 'arr' | 'obj?' | 'iso' | 'iso?' | 'buf';

const PK: Record<TableName, string> = {
  meta: 'key',
  settings: 'key',
  counters: 'prefix',
  inventories: 'id',
  catalogModels: 'id',
  products: 'id',
  units: 'id',
  suppliers: 'id',
  customers: 'id',
  purchases: 'id',
  purchaseLines: 'id',
  sales: 'id',
  saleLines: 'id',
  payments: 'id',
  returns: 'id',
  expenses: 'id',
  movements: 'id',
  warranties: 'id',
  warrantyClaims: 'id',
  repairs: 'id',
  photos: 'id',
  consolidatedViews: 'id',
  history: 'id',
};

const SPEC: Partial<Record<TableName, Record<string, FieldType>>> = {
  inventories: { name: 'str', mode: 'str', archived: 'bool', createdAt: 'iso' },
  products: { inventoryId: 'str', kind: 'str', tracking: 'str', name: 'str', qty: 'int', stockValue: 'int', unknownCostQty: 'int', archived: 'bool' },
  units: { productId: 'str', inventoryId: 'str', code: 'str', status: 'str', acquiredAt: 'iso?', availableSince: 'iso?', baseCost: 'int?', extraCost: 'int', cycle: 'int', saleId: 'str?' },
  purchases: { opId: 'str', inventoryId: 'str', date: 'iso', subtotal: 'int', extraCosts: 'int', total: 'int', status: 'str' },
  purchaseLines: { purchaseId: 'str', productId: 'str', quantity: 'int', price: 'int', totalCost: 'int', unitIds: 'arr' },
  sales: { opId: 'str', inventoryId: 'str', date: 'iso', subtotal: 'int', discount: 'int', total: 'int', status: 'str' },
  saleLines: { saleId: 'str', productId: 'str', unitId: 'str?', quantity: 'int', unitPrice: 'int', netAmount: 'int', cogs: 'int', cogsUnknownQty: 'int', returnedQty: 'int' },
  payments: { saleId: 'str', kind: 'str', date: 'iso', amount: 'int' },
  returns: { opId: 'str', saleId: 'str', date: 'iso', refundAmount: 'int', lines: 'arr' },
  expenses: { date: 'iso', amount: 'int', category: 'str', treatment: 'str', status: 'str' },
  movements: { seq: 'int', at: 'iso', inventoryId: 'str', productId: 'str', type: 'str', qtyDelta: 'int', costDelta: 'int' },
  warranties: { type: 'str', inventoryId: 'str', startDate: 'iso', endDate: 'iso', status: 'str' },
  warrantyClaims: { warrantyId: 'str', date: 'iso', status: 'str', cost: 'int' },
  repairs: { unitId: 'str', date: 'iso', cost: 'int' },
  photos: { unitId: 'str', mime: 'str', data: 'buf' },
  consolidatedViews: { name: 'str', inventoryIds: 'arr' },
  suppliers: { name: 'str' },
  customers: { name: 'str' },
  catalogModels: { brand: 'str', model: 'str', category: 'str', storageOptions: 'arr' },
  counters: { value: 'int' },
  meta: { value: 'str' },
  history: { at: 'iso', entityId: 'str', summary: 'str' },
};

function checkType(v: unknown, t: FieldType): boolean {
  switch (t) {
    case 'str':
      return typeof v === 'string';
    case 'str?':
      return v === null || v === undefined || typeof v === 'string';
    case 'int':
      return typeof v === 'number' && Number.isInteger(v);
    case 'int?':
      return v === null || v === undefined || (typeof v === 'number' && Number.isInteger(v));
    case 'bool':
      return typeof v === 'boolean';
    case 'arr':
      return Array.isArray(v);
    case 'obj?':
      return v === null || v === undefined || typeof v === 'object';
    case 'iso':
      return typeof v === 'string' && Number.isFinite(Date.parse(v));
    case 'iso?':
      return v === null || v === undefined || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
    case 'buf':
      return v instanceof ArrayBuffer;
  }
}

export function validateTables(tables: Tables): void {
  for (const t of DATA_TABLES) {
    const pk = PK[t];
    const spec = SPEC[t] ?? {};
    const seen = new Set<string>();
    const rows = tables[t];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Record<string, unknown>;
      const label = TABLE_LABEL[t] ?? t;
      if (!r || typeof r !== 'object') fail('bad_row', `Registro inválido en "${label}" (posición ${i + 1}).`);
      const id = r[pk];
      if (typeof id !== 'string' || !id) fail('bad_row', `Registro sin identificador en "${label}" (posición ${i + 1}).`);
      if (seen.has(id)) fail('dup_id', `Identificador repetido en "${label}": el respaldo está dañado.`);
      seen.add(id);
      for (const [f, ft] of Object.entries(spec)) {
        if (!checkType(r[f], ft)) fail('bad_field', `Dato inválido en "${label}" (campo ${f}, posición ${i + 1}). El respaldo está dañado.`);
      }
    }
  }
  const codes = new Set<string>();
  for (const u of tables.units as { code: string }[]) {
    if (codes.has(u.code)) fail('dup_code', `Código interno repetido (${u.code}): el respaldo está dañado.`);
    codes.add(u.code);
  }
}

/* ---------------- Análisis previo (staging) ---------------- */

export interface ImportAnalysis {
  backup: Omit<ParsedBackup, 'tables'>;
  /** Resultado de verificar la integridad del respaldo en una base temporal. */
  integrity: IntegrityReport;
  currentHasData: boolean;
  sameInstallation: boolean;
  /** El respaldo es anterior a la última modificación de los datos actuales. */
  olderThanCurrent: boolean;
  alreadyRestored: boolean;
  currentCounts: Record<string, number>;
}

async function businessCounts(db: AppDB): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of DATA_TABLES) out[t] = await db.table(t).count();
  return out;
}

export function hasBusinessData(counts: Record<string, number>): boolean {
  return ['inventories', 'products', 'units', 'purchases', 'sales', 'expenses', 'suppliers', 'customers'].some((t) => (counts[t] ?? 0) > 0);
}

async function writeTables(db: AppDB, tables: Tables): Promise<void> {
  for (const t of DATA_TABLES) await db.table(t).clear();
  for (const t of DATA_TABLES) if (tables[t].length) await db.table(t).bulkAdd(tables[t]);
}

/**
 * Carga el respaldo en una base TEMPORAL separada y verifica su integridad, sin tocar los datos actuales.
 */
export async function analyzeImport(db: AppDB, parsed: ParsedBackup, stagingName = 'inventario-movil-staging'): Promise<ImportAnalysis> {
  const staging = new AppDB(stagingName);
  let integrity: IntegrityReport;
  try {
    await staging.open();
    await staging.transaction('rw', staging.allTables(), () => writeTables(staging, parsed.tables));
    integrity = await verifyIntegrity(staging);
  } finally {
    staging.close();
    await Dexie.delete(stagingName).catch(() => undefined);
  }
  const currentCounts = await businessCounts(db);
  const myId = (await db.meta.get('installationId'))?.value ?? '';
  const lastChange = (await db.history.orderBy('at').last())?.at ?? null;
  const lastRestore = (await db.meta.get('lastRestoreChecksum'))?.value ?? null;
  const lastRestoreAt = (await db.meta.get('lastRestoreAt'))?.value ?? null;
  const { tables: _omit, ...meta } = parsed;
  void _omit;
  return {
    backup: meta,
    integrity,
    currentHasData: hasBusinessData(currentCounts),
    sameInstallation: !!myId && myId === parsed.installationId,
    olderThanCurrent: !!lastChange && hasBusinessData(currentCounts) && parsed.createdAt < lastChange,
    alreadyRestored: lastRestore === parsed.checksum && !!lastRestoreAt && (!lastChange || lastChange <= lastRestoreAt),
    currentCounts,
  };
}

/* ---------------- Restaurar (reemplazo atómico) ---------------- */

const SAFETY_DB = 'inventario-movil-seguridad';

class SafetyDB extends Dexie {
  snapshots!: Dexie.Table<{ id: string; createdAt: string; text: string }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ snapshots: 'id' });
  }
}

export interface RestoreResult {
  counts: Record<string, number>;
  integrity: IntegrityReport;
  safetySnapshot: boolean;
}

/**
 * Reemplaza TODOS los datos por los del respaldo dentro de UNA transacción.
 * Si algo falla (incluida la verificación posterior), IndexedDB revierte todo y los datos actuales quedan intactos.
 * Antes de reemplazar, guarda una copia de seguridad interna de los datos actuales para poder deshacer.
 */
export async function restoreBackup(
  db: AppDB,
  parsed: ParsedBackup,
  opts: { allowIntegrityWarnings?: boolean; safetyName?: string; skipSafety?: boolean } = {},
): Promise<RestoreResult> {
  const safetyName = opts.safetyName ?? SAFETY_DB;
  const pre = await analyzeImport(db, parsed, `${safetyName}-staging`);
  if (!pre.integrity.ok && !opts.allowIntegrityWarnings)
    throw new AppError('integrity', `El respaldo tiene ${pre.integrity.issues.length} inconsistencia(s). No se importó nada.`);

  let safetySnapshot = false;
  if (!opts.skipSafety && pre.currentHasData) {
    const snap = await createBackup(db);
    const sdb = new SafetyDB(safetyName);
    try {
      await sdb.snapshots.clear();
      await sdb.snapshots.put({ id: 'last', createdAt: snap.createdAt, text: snap.text });
      safetySnapshot = true;
    } finally {
      sdb.close();
    }
  }

  const myInstallation = (await db.meta.get('installationId'))?.value ?? null;
  const tables: Tables = { ...parsed.tables };
  // Conservar la identidad de ESTA instalación (los datos se copian; los dispositivos no se vinculan)
  tables.meta = (tables.meta as { key: string; value: string }[]).filter(
    (m) => !['installationId', 'lastRestoreAt', 'lastRestoreChecksum', 'lastBackupAt'].includes(m.key),
  );
  const now = nowISO();
  if (myInstallation) tables.meta.push({ key: 'installationId', value: myInstallation });
  tables.meta.push({ key: 'lastRestoreAt', value: now }, { key: 'lastRestoreChecksum', value: parsed.checksum });
  tables.meta.push({ key: 'lastBackupAt', value: parsed.createdAt });

  const integrity = await db.transaction('rw', db.allTables(), async () => {
    await writeTables(db, tables);
    for (const t of DATA_TABLES) {
      const n = await db.table(t).count();
      if (n !== tables[t].length) throw new AppError('verify_failed', `Verificación fallida en "${TABLE_LABEL[t] ?? t}". No se importó nada.`);
    }
    const rep = await verifyIntegrity(db);
    if (rep.issues.length > pre.integrity.issues.length)
      throw new AppError('verify_failed', 'La verificación posterior a la restauración falló. No se importó nada.');
    await db.history.add({
      id: crypto.randomUUID(),
      at: now,
      entityType: 'backup',
      entityId: parsed.checksum.slice(0, 16),
      inventoryId: null,
      action: 'restore',
      summary: `Respaldo restaurado (creado ${parsed.createdAt.slice(0, 16).replace('T', ' ')})`,
    });
    return rep;
  });
  const counts = await businessCounts(db);
  return { counts, integrity, safetySnapshot };
}

export async function getSafetySnapshotInfo(safetyName = SAFETY_DB): Promise<{ createdAt: string } | null> {
  const sdb = new SafetyDB(safetyName);
  try {
    const s = await sdb.snapshots.get('last');
    return s ? { createdAt: s.createdAt } : null;
  } finally {
    sdb.close();
  }
}

/** Deshace la última restauración volviendo a los datos que había justo antes. */
export async function undoLastRestore(db: AppDB, safetyName = SAFETY_DB): Promise<RestoreResult> {
  const sdb = new SafetyDB(safetyName);
  let text: string | undefined;
  try {
    text = (await sdb.snapshots.get('last'))?.text;
  } finally {
    sdb.close();
  }
  if (!text) fail('no_snapshot', 'No hay una copia de seguridad interna para deshacer.');
  const parsed = await parseBackup(text);
  const res = await restoreBackup(db, parsed, { allowIntegrityWarnings: true, skipSafety: true, safetyName });
  const s2 = new SafetyDB(safetyName);
  try {
    await s2.snapshots.delete('last');
  } finally {
    s2.close();
  }
  return res;
}
