import Dexie, { type Table } from 'dexie';
import { buildLotsFromHistory } from './lots';
import type {
  CalendarNote,
  CapitalMovement,
  CatalogModel,
  ConsolidatedView,
  Counter,
  Credit,
  CreditPayment,
  Customer,
  Debt,
  DebtPayment,
  Expectation,
  Expense,
  Goal,
  Memo,
  HistoryEntry,
  Inquiry,
  Inventory,
  Lot,
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
export const DB_SCHEMA_VERSION = 4;
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

/** v3 (app 2.1): lotes por precio de compra. */
export const SCHEMA_V3: Record<string, string> = {
  ...SCHEMA_V2,
  lots: 'id, productId, inventoryId, purchaseId, date',
};

/** v4 (app 2.3): expectativas del mes y de la semana, preguntones, calendario, fiados (me deben) y notas. */
export const SCHEMA_V4: Record<string, string> = {
  ...SCHEMA_V3,
  expectations: 'id, start, period, inventoryId',
  inquiries: 'id, date, inventoryId, status, productId',
  notes: 'id, day, done',
  credits: 'id, &opId, customerId, inventoryId, date, status',
  creditPayments: 'id, &opId, creditId, customerId, date',
  memos: 'id, updatedAt, pinned',
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

/** Tablas de la versión 2 (app 2.0). */
export const TABLES_V2 = [...TABLES_V1, 'capital', 'debts', 'debtPayments', 'marketPrices', 'goals'] as const;

/** Tablas de la versión 3 (app 2.1 y 2.2). */
export const TABLES_V3 = [...TABLES_V2, 'lots'] as const;

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
  'lots',
  'expectations',
  'inquiries',
  'notes',
  'credits',
  'creditPayments',
  'memos',
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
  lots!: Table<Lot, string>;
  expectations!: Table<Expectation, string>;
  inquiries!: Table<Inquiry, string>;
  notes!: Table<CalendarNote, string>;
  credits!: Table<Credit, string>;
  creditPayments!: Table<CreditPayment, string>;
  memos!: Table<Memo, string>;

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
    // v3 (app 2.1): lotes por precio. Los productos por cantidad que ya existían se separan en lotes a partir de su
    // historial, conservando exactamente su valor a costo (ver buildLotsFromHistory).
    this.version(3)
      .stores(SCHEMA_V3)
      .upgrade(async (tx) => {
        const [products, movements, purchases, sales] = await Promise.all([
          tx.table('products').toArray(),
          tx.table('movements').toArray(),
          tx.table('purchases').toArray(),
          tx.table('sales').toArray(),
        ]);
        const lots = upgradeLotsV3(products as Record<string, unknown>[], movements as Movement[], purchases as Record<string, unknown>[], sales as Record<string, unknown>[]);
        await tx.table('products').toCollection().modify((p: Record<string, unknown>) => upgradeProductV3(p));
        if (lots.length) await tx.table('lots').bulkAdd(lots);
      });
    // v4 (app 2.3): tablas nuevas de expectativas (vacía: las automáticas se calculan, no se guardan) de preguntones y del calendario.
    this.version(4).stores(SCHEMA_V4);
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

/* ---- Conversión v2 → v3 (Dexie y respaldos) ---- */

export function upgradeProductV3(p: Record<string, unknown>): Record<string, unknown> {
  if (p.costing !== 'average' && p.costing !== 'lots') p.costing = p.tracking === 'quantity' ? 'lots' : 'average';
  return p;
}

/** Lotes para todos los productos por cantidad con existencias (reconstruidos desde su historial). */
export function upgradeLotsV3(
  products: Record<string, unknown>[],
  movements: Movement[],
  purchases: Record<string, unknown>[],
  sales: Record<string, unknown>[],
): Lot[] {
  const voidedSales = new Set(sales.filter((s) => s.status === 'voided').map((s) => s.id as string));
  const voidedPurchases = new Set(purchases.filter((p) => p.status === 'voided').map((p) => p.id as string));
  const supplier = new Map(purchases.map((p) => [p.id as string, (p.supplierId as string | null) ?? null]));
  const byProduct = new Map<string, Movement[]>();
  for (const m of movements) {
    const a = byProduct.get(m.productId) ?? [];
    a.push(m);
    byProduct.set(m.productId, a);
  }
  const now = new Date().toISOString();
  const out: Lot[] = [];
  for (const p of products) {
    if (p.tracking !== 'quantity' || p.costing === 'average') continue;
    out.push(
      ...buildLotsFromHistory(p as unknown as Product, byProduct.get(p.id as string) ?? [], {
        voidedSales,
        voidedPurchases,
        supplierOf: (id) => supplier.get(id) ?? null,
        now,
        newId: () => crypto.randomUUID(),
      }),
    );
  }
  return out;
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
