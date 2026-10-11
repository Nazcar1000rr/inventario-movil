/**
 * Modelo de datos. Reglas generales:
 * - Todos los identificadores son UUID v4 (texto) y nunca se reutilizan.
 * - El dinero se guarda en pesos colombianos ENTEROS (sin centavos).
 * - Las fechas se guardan como texto ISO 8601 (UTC). `null` = fecha desconocida.
 * - Un costo `null` significa "desconocido": nunca se inventa.
 * - El modo (sencillo/profesional) solo afecta la interfaz, no la estructura.
 */

export type ID = string;
export type ISODate = string;
export type Money = number; // pesos COP enteros

export type InventoryMode = 'simple' | 'pro';

export interface Inventory {
  id: ID;
  name: string;
  mode: InventoryMode;
  archived: boolean;
  archivedAt: ISODate | null;
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ProductKind = 'phone' | 'audio' | 'accessory' | 'other';
/** unit = cada unidad física se registra por separado; quantity = se maneja por cantidad (lote). */
export type Tracking = 'unit' | 'quantity';
/**
 * Costeo de productos por cantidad:
 * - lots (v2.1, por defecto): cada compra queda como un lote con su propio costo; se vende primero el más antiguo
 *   (o el que elijas) y la ganancia usa el costo real de ese lote.
 * - average: costo promedio ponderado (todo junto).
 */
export type Costing = 'average' | 'lots';

export interface CatalogModel {
  id: ID;
  category: ProductKind;
  brand: string;
  model: string; // p. ej. "iPhone 13 Pro"
  generation: string; // p. ej. "iPhone 13"
  year: number | null;
  storageOptions: string[]; // p. ej. ["128 GB", "256 GB"]
  biometric: 'faceid' | 'touchid' | 'none' | 'unknown';
  builtin: boolean;
  archived: boolean;
  createdAt: ISODate;
}

export interface Product {
  id: ID;
  inventoryId: ID;
  kind: ProductKind;
  tracking: Tracking;
  name: string;
  brand: string;
  model: string;
  variant: string;
  reference: string;
  capacity: string;
  color: string;
  catalogModelId: ID | null;
  salePrice: Money | null; // precio de venta sugerido
  lowStockThreshold: number | null;
  location: string;
  notes: string;
  /** Solo para tracking = 'quantity': existencias y valor a costo (promedio ponderado). */
  qty: number;
  stockValue: Money;
  /** Unidades (de qty) cuyo costo es desconocido. Se consumen primero (FIFO: son el stock más antiguo). */
  unknownCostQty: number;
  /** Solo para tracking = 'quantity'. En productos por unidad no se usa. */
  costing: Costing;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type UnitStatus = 'available' | 'sold' | 'in_review' | 'damaged' | 'archived';

export type InspectionStatus = 'ok' | 'damaged' | 'replaced' | 'pending' | 'na';
export type InspectionSource = 'seller' | 'own' | 'technician';

export interface InspectionItem {
  status: InspectionStatus;
  source: InspectionSource;
  note: string;
}

export interface Inspection {
  items: Record<string, InspectionItem>;
  inspectedAt: ISODate | null;
  notes: string;
}

/** Estados estándar del equipo. Se permiten otros textos configurables. */
export const CONDITIONS = ['Nuevo', 'Usado', 'Restaurado'] as const;

export type PartKey =
  | 'battery'
  | 'screen'
  | 'back'
  | 'rear_camera'
  | 'front_camera'
  | 'biometric'
  | 'port'
  | 'speaker'
  | 'housing'
  | 'board'
  | 'other';

export type PartQuality = 'original' | 'generic' | 'unknown';
export type PartChangedBy = 'previous_owner' | 'supplier' | 'me' | 'unknown';

export interface PartChange {
  id: ID;
  part: PartKey;
  label: string; // descripción libre (obligatoria para "other")
  quality: PartQuality;
  by: PartChangedBy;
  date: ISODate | null;
  /** El iPhone muestra el aviso "pieza desconocida" / "pieza no genuina" en Ajustes. */
  unknownPartWarning: boolean;
  notes: string;
  repairId: ID | null; // si viene de una reparación pagada registrada en la app
}

export interface Unit {
  id: ID;
  productId: ID;
  inventoryId: ID;
  code: string; // código interno único y permanente
  status: UnitStatus;
  archivedReason: string;
  acquiredAt: ISODate | null; // fecha de compra/ingreso (null = desconocida)
  availableSince: ISODate | null; // inicio del ciclo de disponibilidad actual
  cycle: number; // 1 = primer ciclo; aumenta con cada devolución
  baseCost: Money | null; // costo de adquisición asignado (null = desconocido)
  extraCost: Money; // gastos capitalizados posteriores (reparaciones, etc.)
  source: 'purchase' | 'initial';
  purchaseId: ID | null;
  purchaseLineId: ID | null;
  supplierId: ID | null;
  saleId: ID | null; // venta vigente si está vendida
  saleLineId: ID | null;
  imei: string;
  imei2: string;
  serial: string;
  color: string;
  capacity: string;
  condition: string; // nuevo | usado | reacondicionado | otro texto
  batteryHealth: number | null;
  inspection: Inspection | null;
  /** Historial de reparaciones y cambios de piezas del equipo (incluye las hechas antes de comprarlo). */
  partsHistory: PartChange[];
  defects: string;
  replacedParts: string;
  includedAccessories: string;
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type LotSource = 'purchase' | 'initial' | 'adjust' | 'return' | 'opening';

/** Lote de un producto por cantidad (v2.1): lo que entró junto, con su propio costo. */
export interface Lot {
  id: ID;
  productId: ID;
  inventoryId: ID;
  source: LotSource;
  purchaseId: ID | null;
  purchaseLineId: ID | null;
  supplierId: ID | null;
  /** Fecha de ingreso (null = desconocida). */
  date: ISODate | null;
  /** Cantidad y valor con que se creó el lote. */
  qtyIn: number;
  valueIn: Money;
  /** Lo que queda del lote y su valor a costo (si el costo es conocido). */
  qty: number;
  value: Money;
  costKnown: boolean;
  notes: string;
  createdAt: ISODate;
  /** v2.3: última corrección de cantidad o costo. */
  correctedAt?: ISODate | null;
}

/** De qué lotes salió una venta (para anularla o calcular días exactos). */
export interface LotTake {
  lotId: ID;
  qty: number;
  cogs: Money;
  unknown: boolean;
  /** Fecha de ingreso del lote (para tiempos de venta). */
  date: ISODate | null;
}

export interface Supplier {
  id: ID;
  name: string;
  phone: string;
  city: string;
  address: string;
  type: string;
  notes: string;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Customer {
  id: ID;
  name: string;
  phone: string;
  city: string;
  notes: string;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type OpStatus = 'active' | 'voided';
export type AllocationMethod = 'value' | 'units';

export interface Purchase {
  id: ID;
  opId: string; // clave de idempotencia
  inventoryId: ID;
  supplierId: ID | null;
  date: ISODate;
  paymentMethod: string;
  notes: string;
  subtotal: Money; // suma de lo pagado por los productos
  extraCosts: Money; // gastos atribuibles a la compra (transporte, etc.), se capitalizan
  allocation: AllocationMethod;
  total: Money;
  /** cash = pagada con dinero de la caja; debt = pagada con deuda (tarjeta de crédito, crédito del proveedor...). */
  paymentSource: 'cash' | 'debt';
  debtId: ID | null;
  status: OpStatus;
  voidedAt: ISODate | null;
  voidReason: string;
  createdAt: ISODate;
  /** v2.3: última corrección de cantidades o valores. */
  correctedAt?: ISODate | null;
}

export interface PurchaseLine {
  id: ID;
  purchaseId: ID;
  inventoryId: ID;
  productId: ID;
  quantity: number;
  price: Money; // total pagado por la línea
  allocatedExtra: Money;
  totalCost: Money; // price + allocatedExtra
  unitIds: ID[];
}

export type DeliveryStatus = 'na' | 'pending' | 'delivered';

export interface Sale {
  id: ID;
  opId: string;
  inventoryId: ID;
  customerId: ID | null;
  date: ISODate;
  paymentMethod: string;
  notes: string;
  subtotal: Money; // suma de cantidad × precio
  discount: Money;
  total: Money; // subtotal − descuento
  deliveryStatus: DeliveryStatus;
  status: OpStatus;
  voidedAt: ISODate | null;
  voidReason: string;
  createdAt: ISODate;
  /** v2.3: fecha en que el cliente prometió pagar (fiado). */
  dueDate?: ISODate | null;
  /** v2.3: saldo que perdonaste ("no me va a pagar"): se registra como pérdida. */
  forgiven?: Money;
  forgivenAt?: ISODate | null;
  forgiveNote?: string;
}

export interface SaleLine {
  id: ID;
  saleId: ID;
  inventoryId: ID;
  productId: ID;
  unitId: ID | null;
  quantity: number;
  unitPrice: Money;
  discountShare: Money;
  netAmount: Money; // quantity*unitPrice − discountShare
  cogs: Money; // costo conocido de lo vendido
  cogsUnknownQty: number; // cantidad vendida sin costo conocido
  cycleStart: ISODate | null; // inicio del ciclo de disponibilidad de lo vendido (unidades)
  acquiredAt: ISODate | null;
  returnedQty: number;
  returnedAmount: Money;
  returnedCogs: Money;
  returnedUnknownQty: number;
  /** Productos con lotes: de qué lotes salió (v2.1). */
  lotAllocations?: LotTake[];
}

export type PaymentKind = 'payment' | 'refund';

export interface Payment {
  id: ID;
  saleId: ID;
  inventoryId: ID;
  kind: PaymentKind;
  date: ISODate;
  amount: Money; // siempre positivo
  method: string;
  notes: string;
  createdAt: ISODate;
}

export type ReturnDestination = 'available' | 'in_review' | 'damaged';

export interface ReturnLine {
  saleLineId: ID;
  unitId: ID | null;
  quantity: number;
  destination: ReturnDestination;
  amount: Money; // ingreso revertido
  cogs: Money; // costo revertido
  unknownQty: number;
}

export interface SaleReturn {
  id: ID;
  opId: string;
  saleId: ID;
  inventoryId: ID;
  date: ISODate;
  reason: string;
  refundAmount: Money;
  lines: ReturnLine[];
  notes: string;
  createdAt: ISODate;
}

export type ExpenseTreatment = 'operating' | 'capitalized';

export interface Expense {
  id: ID;
  date: ISODate;
  amount: Money;
  category: string;
  notes: string;
  treatment: ExpenseTreatment;
  inventoryId: ID | null;
  saleId: ID | null;
  purchaseId: ID | null;
  unitId: ID | null;
  productId: ID | null;
  claimId: ID | null;
  repairId: ID | null;
  /** Intereses o costos financieros de una deuda. */
  debtId?: ID | null;
  /** Comisión automática del medio de pago (datáfono, etc.). */
  paymentFee?: boolean;
  /** Gasto capitalizado en productos con lotes: a qué lotes se sumó (v2.1). */
  lotAllocations?: { lotId: ID; amount: Money }[];
  /** Gasto de compra agregado después o repartido entre varias compras (v2.1): agrupa las partes. */
  costGroupId?: ID | null;
  status: OpStatus;
  createdAt: ISODate;
}

export type MovementType =
  | 'purchase'
  | 'initial'
  | 'sale'
  | 'return'
  | 'void_sale'
  | 'void_purchase'
  | 'adjust_in'
  | 'adjust_out'
  | 'status';

export interface Movement {
  id: ID;
  at: ISODate; // fecha del hecho (negocio)
  /** true si la fecha real es desconocida (stock inicial sin fecha): `at` es solo la fecha de registro. */
  dateUnknown?: boolean;
  createdAt: ISODate; // momento del registro
  seq: number; // orden total de registro
  inventoryId: ID;
  productId: ID;
  unitId: ID | null;
  type: MovementType;
  qtyDelta: number; // + entra, − sale (stock disponible + revisión + dañado)
  costDelta: Money; // variación del valor a costo conocido
  unknownDelta: number; // variación de unidades sin costo conocido
  writeOff: Money; // pérdida reconocida (bajas)
  refType: string;
  refId: ID | null;
  notes: string;
  /** v2.3: movimiento agregado por una corrección (no es una operación nueva). */
  correction?: boolean;
}

export type WarrantyType = 'customer' | 'supplier';
export type WarrantyStatus = 'active' | 'cancelled' | 'closed';

export interface Warranty {
  id: ID;
  type: WarrantyType;
  inventoryId: ID;
  saleId: ID | null;
  saleLineId: ID | null;
  unitId: ID | null;
  productId: ID | null;
  customerId: ID | null;
  supplierId: ID | null;
  startDate: ISODate;
  durationValue: number;
  durationUnit: 'days' | 'months';
  endDate: ISODate;
  conditions: string;
  status: WarrantyStatus;
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ClaimStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';

export interface WarrantyClaim {
  id: ID;
  warrantyId: ID;
  date: ISODate;
  description: string;
  status: ClaimStatus;
  resolution: string;
  cost: Money;
  expenseId: ID | null;
  notes: string;
  resolvedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Repair {
  id: ID;
  unitId: ID;
  date: ISODate;
  description: string;
  partsReplaced: string;
  technician: string;
  cost: Money;
  expenseId: ID | null;
  notes: string;
  createdAt: ISODate;
}

export interface Photo {
  id: ID;
  unitId: ID;
  mime: string;
  data: ArrayBuffer;
  width: number;
  height: number;
  createdAt: ISODate;
}

export interface ConsolidatedView {
  id: ID;
  name: string;
  inventoryIds: ID[];
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface HistoryEntry {
  id: ID;
  at: ISODate;
  entityType:
    | 'inventory'
    | 'product'
    | 'unit'
    | 'purchase'
    | 'sale'
    | 'expense'
    | 'warranty'
    | 'settings'
    | 'backup'
    | 'view'
    | 'supplier'
    | 'customer'
    | 'catalog'
    | 'capital'
    | 'debt'
    | 'price'
    | 'goal'
    | 'expectation'
    | 'note'
    | 'credit';
  entityId: ID;
  inventoryId: ID | null;
  action: string;
  summary: string;
}

export interface Counter {
  prefix: string;
  value: number;
}

export type MarginType = 'percent' | 'amount';

export interface PricingSettings {
  /** Margen mínimo sobre el costo para el "precio mínimo" (aviso al vender por debajo). */
  minMarginType: MarginType;
  minMarginValue: number;
  /** Margen deseado sobre el costo para calcular el "precio máximo de compra". */
  targetMarginType: MarginType;
  targetMarginValue: number;
  /** Gastos esperados por equipo al comprar (transporte, alistamiento...). */
  expectedCosts: Money;
  /** Descuento opcional si la batería está por debajo de un porcentaje (null = desactivado). */
  batteryThreshold: number | null;
  batteryDiscount: Money;
  /** Descuento opcional por cada pieza genérica o con aviso de pieza desconocida (0 = desactivado). */
  genericPartDiscount: Money;
  /** Días tras los cuales un precio de mercado se considera desactualizado. */
  marketStaleDays: number;
  /** Ventana de días para calcular "tu precio real" (promedio de tus ventas). */
  recentSalesDays: number;
}

export interface Settings {
  key: 'app';
  businessName: string;
  defaultMode: InventoryMode;
  prefixes: { iphone: string; phone: string; audio: string; accessory: string; other: string };
  /** Avisos de productos estancados (opcional). */
  staleEnabled: boolean;
  staleDays: number;
  /** Umbral específico para equipos nuevos (null = usar el general). */
  staleDaysNew: number | null;
  /** Umbral específico para usados y restaurados (null = usar el general). */
  staleDaysUsed: number | null;
  warrantyAlertDays: number;
  backupReminderDays: number;
  conditions: string[];
  pricing: PricingSettings;
  /** Comisión (%) por medio de pago, p. ej. { Tarjeta: 3.5 }. 0 = sin comisión. */
  paymentFees: Record<string, number>;
  /** Mostrar la lista de "Primeros pasos" en Inicio. */
  showGettingStarted: boolean;
  /** v2.1: los productos por cantidad nuevos separan sus existencias por lote (precio de compra). */
  lotsByDefault: boolean;
  /** v2.1: mostrar el análisis y el consejo al registrar un gasto personal. */
  personalSpendingTips: boolean;
  /** v2.1: mostrar el consejo del día en Inicio. */
  dailyTips: boolean;
}

/* ---------------- Capital, deudas, precios y metas (v2) ---------------- */

export type CapitalKind = 'contribution' | 'withdrawal' | 'cash_adjustment' | 'owner_loan' | 'owner_loan_repayment';

export interface CapitalMovement {
  id: ID;
  opId: string;
  /** null = capital general del negocio (no asignado a un inventario). */
  inventoryId: ID | null;
  kind: CapitalKind;
  date: ISODate;
  /** Siempre positivo, excepto en ajustes de caja (negativo = faltante). */
  amount: Money;
  notes: string;
  /** v2.1: gasto personal pagado con plata del negocio (gusto, gasto hormiga…). Es un retiro o un préstamo a ti. */
  personal?: boolean;
  /** v2.1: categoría del gasto personal (Gusto, Gasto hormiga, Comida…). */
  tag?: string;
  status: OpStatus;
  createdAt: ISODate;
}

export type DebtKind = 'credit_card' | 'supplier' | 'loan' | 'other';

export interface Debt {
  id: ID;
  opId: string;
  inventoryId: ID | null;
  kind: DebtKind;
  creditor: string;
  description: string;
  date: ISODate;
  principal: Money;
  /** true si el dinero prestado entró a la caja (préstamo en efectivo). false si pagó una compra directamente. */
  cashIn: boolean;
  purchaseId: ID | null;
  status: 'open' | 'paid' | 'voided';
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface DebtPayment {
  id: ID;
  opId: string;
  debtId: ID;
  inventoryId: ID | null;
  date: ISODate;
  principal: Money; // abono a capital (reduce la deuda)
  interest: Money; // intereses/cuota de manejo (gasto financiero)
  expenseId: ID | null;
  notes: string;
  createdAt: ISODate;
}

export interface MarketPrice {
  id: ID;
  key: string; // modelo|capacidad|estado normalizado
  model: string;
  capacity: string;
  condition: string;
  price: Money;
  date: ISODate;
  notes: string;
  createdAt: ISODate;
}

export interface Goal {
  id: ID;
  inventoryId: ID | null;
  name: string;
  metric: 'business_value' | 'growth';
  target: Money;
  dueDate: ISODate | null;
  status: 'active' | 'archived';
  createdAt: ISODate;
}

/* ---------------- Expectativas (v2.3) ---------------- */

export type ExpectationPeriod = 'month' | 'week';

/**
 * Lo que esperas lograr en un mes o una semana. Solo se guarda cuando la editas: si no hay registro, la app
 * propone una automáticamente con tus resultados anteriores a ese periodo.
 */
export interface Expectation {
  id: ID;
  period: ExpectationPeriod;
  /** Inicio del periodo (día 1 o lunes, 00:00 hora local) y fin (exclusivo). */
  start: ISODate;
  end: ISODate;
  /** null = todo el negocio. */
  inventoryId: ID | null;
  expectedProfit: Money;
  expectedRevenue: Money;
  expectedUnits: number;
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/* ---------------- Preguntones (v2.3) ---------------- */

/**
 * Una persona que preguntó y no compró (un toque en el botón "Preguntón").
 * Si después vuelve y compra, se marca como "bought": deja de contar como preguntón porque su compra ya cuenta como venta.
 */
export interface Inquiry {
  id: ID;
  /** null = general (todo el negocio). */
  inventoryId: ID | null;
  /** Cuándo preguntó (el momento del toque). */
  date: ISODate;
  /** Qué preguntó (opcional). */
  productId: ID | null;
  status: 'open' | 'bought';
  boughtAt: ISODate | null;
  notes: string;
  createdAt: ISODate;
}

/* ---------------- Me deben (v2.3) ---------------- */

/**
 * Plata que te deben sin ser una venta registrada:
 * - loan: le prestaste plata (sale de la caja);
 * - opening: ya te debía antes de usar la app (cuenta como capital aportado, igual que la mercancía que ya tenías).
 * Lo que fías en mercancía se registra como una venta con pago pendiente.
 */
export interface Credit {
  id: ID;
  opId: string;
  inventoryId: ID | null;
  customerId: ID;
  kind: 'loan' | 'opening';
  amount: Money;
  date: ISODate;
  dueDate: ISODate | null;
  notes: string;
  forgiven: Money;
  forgivenAt: ISODate | null;
  status: OpStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CreditPayment {
  id: ID;
  opId: string;
  creditId: ID;
  customerId: ID;
  inventoryId: ID | null;
  date: ISODate;
  amount: Money;
  method: string;
  notes: string;
  createdAt: ISODate;
}

/* ---------------- Calendario (v2.3) ---------------- */

/** Una nota del calendario con sus avisos. */
export interface CalendarNote {
  id: ID;
  title: string;
  /** Opcional. */
  description: string;
  /** Día de la nota en hora local: AAAA-MM-DD. */
  day: string;
  /** Hora opcional (HH:MM). */
  time: string | null;
  /** Cuántos días antes te avisa (0 = el mismo día). */
  remindDays: number[];
  /** Hora de los avisos (HH:MM). */
  remindTime: string;
  done: boolean;
  doneAt: ISODate | null;
  /** Avisos que ya viste dentro de la app (días antes). */
  seen: number[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Nota libre (sección Notas, v2.3): sin fecha; se puede pasar al calendario. */
export interface Memo {
  id: ID;
  title: string;
  text: string;
  pinned: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface MetaRecord {
  key: string;
  value: string;
}
