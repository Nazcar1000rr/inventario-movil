import Dexie, { type Table } from 'dexie';
import type {
  CatalogModel,
  ConsolidatedView,
  Counter,
  Customer,
  Expense,
  HistoryEntry,
  Inventory,
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
export const DB_SCHEMA_VERSION = 1;
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

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
  }

  /** Todas las tablas de negocio, para transacciones globales (respaldo/restauración). */
  allTables(): Table[] {
    return DATA_TABLES.map((t) => this.table(t));
  }
}

let current: AppDB | null = null;

export function getDB(): AppDB {
  if (!current) current = new AppDB();
  return current;
}

/** Solo para pruebas: usar una base distinta. */
export function setDB(db: AppDB): void {
  current = db;
}
