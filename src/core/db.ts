import Dexie, { type Table } from 'dexie';
import type {
  CapitalMovement,
  CatalogModel,
  ConsolidatedView,
  Counter,
  Customer,
  Debt,
  DebtPayment,
  Expense,
  Goal,
  HistoryEntry,
  Inventory,
  MarketPrice,
  MetaRecord,
  Movement,
  Payment,
  Photo,
  Product,
  Purchase,
  PurchaseLine,
  Repair,
  Sale,
  SaleLine,
  SaleReturn,
  Settings,
  Supplier,
  Unit,
  Warranty,
  WarrantyClaim,
} from './types';

/** Versión del esquema de datos. Debe coincidir con la última `version()` declarada abajo. */
export const DB_SCHEMA_VERSION = 2;
export const DB_NAME = 'inventario-movil';

/**
 * Esquema IndexedDB (Dexie). Solo se declaran los campos indexados; el resto
 * de los campos de cada entidad se guardan igualmente.
 *
 * MIGRACIONES: para cambiar el esquema se añade una nueva versión, por ejemplo:
 *   this.version(2).stores({ units: '..., nuevoIndice' }).upgrade(async (tx) => { ... });
 * Dexie ejecuta las migraciones pendientes de forma transaccional al abrir la base.
 * Además, `backup.ts` contiene migraciones para respaldos de versiones anteriores.
 */
export const SCHEMA_V1: Record<string, string> = {
  meta: 'key',
  settings: 'key',
  counters: 'prefix',
  inventories: 'id, name',
  catalogModels: 'id, category, brand, generation',
  products: 'id, inventoryId, kind, catalogModelId',
  units: 'id, productId, inventoryId, status, &code, imei, serial, purchaseId, saleId',
  suppliers: 'id, name',
  customers: 'id, name',
  purchases: 'id, &opId, inventoryId, supplierId, date',
  purchaseLines: 'id, purchaseId, productId',
  sales: 'id, &opId, inventoryId, customerId, date',
  saleLines: 'id, saleId, productId, unitId, inventoryId',
  payments: 'id, saleId, date',
  returns: 'id, &opId, saleId, date',
  expenses: 'id, date, inventoryId, saleId, purchaseId, unitId, claimId',
  movements: 'id, seq, at, inventoryId, productId, unitId, refId',
  warranties: 'id, saleId, unitId, endDate, customerId',
  warrantyClaims: 'id, warrantyId',
  repairs: 'id, unitId',
  photos: 'id, unitId',
  consolidatedViews: 'id',
  history: 'id, at, entityId, inventoryId',
};

/** v2: capital, deudas, precios de mercado y metas. */
export const SCHEMA_V2: Record<string, string> = {
  ...SCHEMA_V1,
  capital: 'id, &opId, inventoryId, date, kind',
  debts: 'id, &opId, inventoryId, date, purchaseId',
  debtPayments: 'id, &opId, debtId, date',
  marketPrices: 'id, key, date',
  goals: 'id, inventoryId',
};

/** Tablas que existían en la versión 1 (para validar respaldos antiguos). */
export const TABLES_V1 = [
  'meta',
  'settings',
  'counters',
  'inventories',
  'catalogModels',
  'products',
  'units',
  'suppliers',
  'customers',
  'purchases',
  'purchaseLines',
  'sales',
  'saleLines',
  'payments',
  'returns',
  'expenses',
  'movements',
  'warranties',
  'warrantyClaims',
  'repairs',
  'photos',
  'consolidatedViews',
  'history',
] as const;

/** Tablas de datos de negocio (todas se incluyen en el respaldo). */
export const DATA_TABLES = [
  'meta',
  'settings',
  'counters',
  'inventories',
  'catalogModels',
  'products',
  'units',
  'suppliers',
  'customers',
  'purchases',
  'purchaseLines',
  'sales',
  'saleLines',
  'payments',
  'returns',
  'expenses',
  'movements',
  'warranties',
  'warrantyClaims',
  'repairs',
  'photos',
  'consolidatedViews',
  'history',
  'capital',
  'debts',
  'debtPayments',
  'marketPrices',
  'goals',
] as const;

export type TableName = (typeof DATA_TABLES)[number];

export class AppDB extends Dexie {
  meta!: Table<MetaRecord, string>;
  settings!: Table<Settings, string>;
  counters!: Table<Counter, string>;
  inventories!: Table<Inventory, string>;
  catalogModels!: Table<CatalogModel, string>;
  products!: Table<Product, string>;
  units!: Table<Unit, string>;
  suppliers!: Table<Supplier, string>;
  customers!: Table<Customer, string>;
  purchases!: Table<Purchase, string>;
  purchaseLines!: Table<PurchaseLine, string>;
  sales!: Table<Sale, string>;
  saleLines!: Table<SaleLine, string>;
  payments!: Table<Payment, string>;
  returns!: Table<SaleReturn, string>;
  expenses!: Table<Expense, string>;
  movements!: Table<Movement, string>;
  warranties!: Table<Warranty, string>;
  warrantyClaims!: Table<WarrantyClaim, string>;
  repairs!: Table<Repair, string>;
  photos!: Table<Photo, string>;
  consolidatedViews!: Table<ConsolidatedView, string>;
  history!: Table<HistoryEntry, string>;
  capital!: Table<CapitalMovement, string>;
  debts!: Table<Debt, string>;
  debtPayments!: Table<DebtPayment, string>;
  marketPrices!: Table<MarketPrice, string>;
  goals!: Table<Goal, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    // v2: tablas nuevas + datos nuevos en registros existentes. Dexie la ejecuta en una transacción al abrir.
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        await tx.table('units').toCollection().modify((u: Record<string, unknown>) => upgradeUnitV2(u));
        await tx.table('purchases').toCollection().modify((p: Record<string, unknown>) => upgradePurchaseV2(p));
        await tx.table('settings').toCollection().modify((st: Record<string, unknown>) => upgradeSettingsV2(st));
        // Alinear los movimientos de unidades con su costo actual (costos completados/corregidos en v1, bajas).
        const units = (await tx.table('units').toArray()) as Record<string, unknown>[];
        const byId = new Map(units.map((u) => [u.id as string, u]));
        await tx
          .table('movements')
          .toCollection()
          .modify((m: Record<string, unknown>) => {
            const u = typeof m.unitId === 'string' ? byId.get(m.unitId) : undefined;
            if (u) alignUnitMovementV2(m, u);
          });
      });
  }

  /** Todas las tablas de negocio, para transacciones globales (respaldo/restauración). */
  allTables(): Table[] {
    return DATA_TABLES.map((t) => this.table(t));
  }
}

/* ---- Conversión de registros v1 → v2 (usada por Dexie y por los respaldos antiguos) ---- */

export function mapConditionV2(c: unknown): string {
  if (typeof c !== 'string') return '';
  const t = c.trim().toLowerCase();
  if (t === 'reacondicionado' || t === 'restaurado') return 'Restaurado';
  if (t === 'nuevo') return 'Nuevo';
  if (t === 'usado') return 'Usado';
  return c;
}

export function upgradeUnitV2(u: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(u.partsHistory)) u.partsHistory = [];
  u.condition = mapConditionV2(u.condition);
  return u;
}

export function upgradePurchaseV2(p: Record<string, unknown>): Record<string, unknown> {
  if (p.paymentSource !== 'cash' && p.paymentSource !== 'debt') p.paymentSource = 'cash';
  if (p.debtId === undefined) p.debtId = null;
  return p;
}

export function upgradeSettingsV2(st: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(st.conditions)) {
    const mapped = (st.conditions as unknown[]).map(mapConditionV2).filter(Boolean);
    st.conditions = [...new Set(['Nuevo', 'Usado', 'Restaurado', ...mapped])];
  }
  return st;
}

/**
 * Corrige un movimiento de unidad creado por la v1 para que el valor del inventario calculado con movimientos
 * coincida con el costo de la unidad:
 * - stock inicial con costo completado o corregido después → el movimiento toma ese costo;
 * - baja de una unidad con costos adicionales y costo base desconocido → también da de baja esos costos.
 * Es idempotente (aplicarla dos veces da el mismo resultado).
 */
export function alignUnitMovementV2(m: Record<string, unknown>, u: Record<string, unknown>): void {
  const base = typeof u.baseCost === 'number' ? u.baseCost : null;
  const extra = typeof u.extraCost === 'number' ? u.extraCost : 0;
  if (u.source === 'initial' && base !== null) applyKnownCostToMovement(m, base);
  if (m.type === 'adjust_out' && m.refType === 'writeoff') {
    const full = (base ?? 0) + extra;
    m.costDelta = -full;
    m.writeOff = full;
    m.unknownDelta = base === null ? -1 : 0;
  }
}

/**
 * Ajusta un movimiento de una unidad cuyo costo base pasó a ser conocido (o se corrigió):
 * - el ingreso inicial toma el costo actual;
 * - las salidas/entradas que se registraron "sin costo" suman o restan ese costo (y la baja lo reconoce como pérdida).
 * Así el valor del inventario calculado con movimientos coincide con el de las unidades.
 */
export function applyKnownCostToMovement(m: Record<string, unknown>, baseCost: number): void {
  if (m.type === 'initial') {
    m.costDelta = baseCost;
    m.unknownDelta = 0;
    return;
  }
  const ud = typeof m.unknownDelta === 'number' ? m.unknownDelta : 0;
  if (ud === 0) return;
  const sign = ud > 0 ? 1 : -1;
  m.costDelta = (typeof m.costDelta === 'number' ? m.costDelta : 0) + sign * baseCost;
  if (m.type === 'adjust_out') m.writeOff = (typeof m.writeOff === 'number' ? m.writeOff : 0) + baseCost;
  m.unknownDelta = 0;
}

let current: AppDB | null = null;

export function getDB(name = DB_NAME): AppDB {
  if (!current) current = new AppDB(name);
  return current;
}

/** Solo para pruebas: usar una base distinta. */
export function setDB(db: AppDB): void {
  current = db;
}
