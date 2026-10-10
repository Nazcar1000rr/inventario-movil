import type { AppDB } from '../db';
import type {
  ID,
  ISODate,
  Inspection,
  Money,
  Product,
  ProductKind,
  Repair,
  Tracking,
  Unit,
  UnitStatus,
} from '../types';
import {
  assertDate,
  assertMoney,
  assertQty,
  cleanIdentifier,
  cleanStr,
  fail,
  newId,
  normalizeText,
  nowISO,
} from '../util';
import {
  addMovement,
  codePrefixFor,
  getSettings,
  logHistory,
  nextUnitCode,
  requireInventory,
  requireProduct,
  requireUnit,
} from './base';
import { claimOp, consumeQuantity, tx, unitCost } from './stock';

export const KIND_LABEL: Record<ProductKind, string> = {
  phone: 'Teléfono',
  audio: 'Audífonos',
  accessory: 'Accesorio',
  other: 'Otro',
};

export const TRACKING_LABEL: Record<Tracking, string> = {
  unit: 'Por unidad',
  quantity: 'Por cantidad',
};

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  available: 'Disponible',
  sold: 'Vendido',
  in_review: 'En revisión',
  damaged: 'Dañado',
  archived: 'Dado de baja',
};

export function defaultTracking(kind: ProductKind): Tracking {
  return kind === 'phone' ? 'unit' : 'quantity';
}

export interface ProductInput {
  inventoryId: ID;
  kind: ProductKind;
  tracking?: Tracking;
  name?: string;
  brand?: string;
  model?: string;
  variant?: string;
  reference?: string;
  capacity?: string;
  color?: string;
  catalogModelId?: ID | null;
  salePrice?: Money | null;
  lowStockThreshold?: number | null;
  location?: string;
  notes?: string;
}

export function buildProductName(i: Pick<ProductInput, 'name' | 'brand' | 'model' | 'variant' | 'capacity' | 'color' | 'reference'>): string {
  const explicit = cleanStr(i.name ?? '', 120);
  if (explicit) return explicit;
  const parts = [i.model || i.brand, i.variant, i.capacity, i.reference, i.color]
    .map((x) => cleanStr(x ?? '', 60))
    .filter(Boolean);
  return parts.join(' ').slice(0, 120);
}

export async function findSimilarProducts(db: AppDB, inventoryId: ID, name: string, exceptId?: ID): Promise<Product[]> {
  const n = normalizeText(name);
  if (!n) return [];
  const list = await db.products.where('inventoryId').equals(inventoryId).toArray();
  return list.filter((p) => p.id !== exceptId && !p.archived && normalizeText(p.name) === n);
}

function validateProductFields(input: ProductInput) {
  if (!['phone', 'audio', 'accessory', 'other'].includes(input.kind)) fail('invalid', 'Tipo de producto no válido.', 'kind');
  if (input.tracking && !['unit', 'quantity'].includes(input.tracking))
    fail('invalid', 'Método de control no válido.', 'tracking');
  if (input.salePrice !== undefined && input.salePrice !== null) assertMoney(input.salePrice, 'salePrice', 'Precio de venta');
  if (input.lowStockThreshold !== undefined && input.lowStockThreshold !== null) {
    if (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0)
      fail('invalid', 'El umbral de stock bajo debe ser un número entero ≥ 0.', 'lowStockThreshold');
  }
}

export async function createProduct(
  db: AppDB,
  input: ProductInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<Product> {
  validateProductFields(input);
  return tx(db, async () => {
    await requireInventory(db, input.inventoryId);
    let brand = cleanStr(input.brand ?? '', 60);
    let model = cleanStr(input.model ?? '', 80);
    if (input.catalogModelId) {
      const cm = await db.catalogModels.get(input.catalogModelId);
      if (!cm) fail('not_found', 'El modelo del catálogo no existe.', 'catalogModelId');
      brand = brand || cm.brand;
      model = model || cm.model;
    }
    const name = buildProductName({ ...input, brand, model });
    if (!name) fail('required', 'Ingrese el nombre o el modelo del producto.', 'name');
    if (!opts.allowDuplicate) {
      const similar = await findSimilarProducts(db, input.inventoryId, name);
      if (similar.length)
        fail('duplicate_product', `Ya existe "${similar[0].name}" en este inventario. Use el existente o confirme que es distinto.`, 'name');
    }
    const now = nowISO();
    const p: Product = {
      id: newId(),
      inventoryId: input.inventoryId,
      kind: input.kind,
      tracking: input.tracking ?? defaultTracking(input.kind),
      name,
      brand,
      model,
      variant: cleanStr(input.variant ?? '', 60),
      reference: cleanStr(input.reference ?? '', 60),
      capacity: cleanStr(input.capacity ?? '', 20),
      color: cleanStr(input.color ?? '', 40),
      catalogModelId: input.catalogModelId ?? null,
      salePrice: input.salePrice ?? null,
      lowStockThreshold: input.lowStockThreshold ?? null,
      location: cleanStr(input.location ?? '', 80),
      notes: cleanStr(input.notes ?? '', 1000),
      qty: 0,
      stockValue: 0,
      unknownCostQty: 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.products.add(p);
    await logHistory(db, {
      entityType: 'product',
      entityId: p.id,
      inventoryId: p.inventoryId,
      action: 'create',
      summary: `Producto creado: ${p.name} (${TRACKING_LABEL[p.tracking].toLowerCase()})`,
    });
    return p;
  });
}

/** Edita datos descriptivos. No permite cambiar inventario, método de control ni existencias. */
export async function updateProduct(
  db: AppDB,
  id: ID,
  patch: Partial<Pick<Product, 'name' | 'brand' | 'model' | 'variant' | 'reference' | 'capacity' | 'color' | 'salePrice' | 'lowStockThreshold' | 'location' | 'notes' | 'kind'>>,
): Promise<void> {
  await tx(db, async () => {
    const p = await requireProduct(db, id);
    const next: Product = { ...p, updatedAt: nowISO() };
    if (patch.name !== undefined) {
      const name = cleanStr(patch.name, 120);
      if (!name) fail('required', 'El nombre no puede quedar vacío.', 'name');
      next.name = name;
    }
    for (const k of ['brand', 'model', 'variant', 'reference', 'capacity', 'color', 'location'] as const) {
      if (patch[k] !== undefined) next[k] = cleanStr(patch[k], 80);
    }
    if (patch.notes !== undefined) next.notes = cleanStr(patch.notes, 1000);
    if (patch.kind !== undefined) next.kind = patch.kind;
    if (patch.salePrice !== undefined) next.salePrice = patch.salePrice === null ? null : assertMoney(patch.salePrice, 'salePrice', 'Precio de venta');
    if (patch.lowStockThreshold !== undefined) {
      if (patch.lowStockThreshold !== null && (!Number.isInteger(patch.lowStockThreshold) || patch.lowStockThreshold < 0))
        fail('invalid', 'El umbral de stock bajo debe ser un número entero ≥ 0.', 'lowStockThreshold');
      next.lowStockThreshold = patch.lowStockThreshold;
    }
    await db.products.put(next);
    await logHistory(db, {
      entityType: 'product',
      entityId: id,
      inventoryId: p.inventoryId,
      action: 'update',
      summary: `Producto editado: ${next.name}`,
    });
  });
}

export async function setProductArchived(db: AppDB, id: ID, archived: boolean): Promise<void> {
  await tx(db, async () => {
    const p = await requireProduct(db, id);
    if (archived) {
      const active =
        p.tracking === 'quantity'
          ? p.qty
          : await db.units.where('productId').equals(id).filter((u) => u.status === 'available' || u.status === 'in_review' || u.status === 'damaged').count();
      if (active > 0) fail('has_stock', `No se puede archivar "${p.name}": todavía tiene ${active} en existencia.`);
    }
    await db.products.update(id, { archived, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'product',
      entityId: id,
      inventoryId: p.inventoryId,
      action: archived ? 'archive' : 'unarchive',
      summary: archived ? `Producto archivado: ${p.name}` : `Producto reactivado: ${p.name}`,
    });
  });
}

/* ---------------- Creación de unidades ---------------- */

export interface UnitDetails {
  imei?: string;
  imei2?: string;
  serial?: string;
  color?: string;
  capacity?: string;
  condition?: string;
  batteryHealth?: number | null;
  defects?: string;
  includedAccessories?: string;
  notes?: string;
}

export function validateBattery(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100)
    fail('invalid_battery', 'El estado de batería debe ser un porcentaje entero entre 0 y 100.', 'batteryHealth');
  return v;
}

/** Crea una unidad física. Uso interno dentro de transacciones (compras, stock inicial). */
export async function insertUnit(
  db: AppDB,
  p: Product,
  args: {
    acquiredAt: ISODate | null;
    baseCost: Money | null;
    source: Unit['source'];
    purchaseId?: ID | null;
    purchaseLineId?: ID | null;
    supplierId?: ID | null;
    details?: UnitDetails;
  },
): Promise<Unit> {
  const settings = await getSettings(db);
  const code = await nextUnitCode(db, codePrefixFor(settings, p));
  const d = args.details ?? {};
  const now = nowISO();
  const u: Unit = {
    id: newId(),
    productId: p.id,
    inventoryId: p.inventoryId,
    code,
    status: 'available',
    archivedReason: '',
    acquiredAt: args.acquiredAt,
    availableSince: args.acquiredAt,
    cycle: 1,
    baseCost: args.baseCost,
    extraCost: 0,
    source: args.source,
    purchaseId: args.purchaseId ?? null,
    purchaseLineId: args.purchaseLineId ?? null,
    supplierId: args.supplierId ?? null,
    saleId: null,
    saleLineId: null,
    imei: cleanIdentifier(d.imei),
    imei2: cleanIdentifier(d.imei2),
    serial: cleanIdentifier(d.serial),
    color: cleanStr(d.color ?? '', 40) || p.color,
    capacity: cleanStr(d.capacity ?? '', 20) || p.capacity,
    condition: cleanStr(d.condition ?? '', 40),
    batteryHealth: validateBattery(d.batteryHealth),
    inspection: null,
    defects: cleanStr(d.defects ?? '', 1000),
    replacedParts: '',
    includedAccessories: cleanStr(d.includedAccessories ?? '', 500),
    notes: cleanStr(d.notes ?? '', 1000),
    createdAt: now,
    updatedAt: now,
  };
  await db.units.add(u);
  return u;
}

/** Busca unidades con el mismo IMEI o serial (posible duplicado o equipo recomprado). */
export async function findIdentifierMatches(db: AppDB, ids: { imei?: string; serial?: string }, exceptUnitId?: ID): Promise<Unit[]> {
  const out = new Map<string, Unit>();
  const imei = cleanIdentifier(ids.imei);
  const serial = cleanIdentifier(ids.serial);
  if (imei) (await db.units.where('imei').equals(imei).toArray()).forEach((u) => out.set(u.id, u));
  if (imei) (await db.units.filter((u) => u.imei2 === imei).toArray()).forEach((u) => out.set(u.id, u));
  if (serial) (await db.units.where('serial').equals(serial).toArray()).forEach((u) => out.set(u.id, u));
  if (exceptUnitId) out.delete(exceptUnitId);
  return [...out.values()];
}

/* ---------------- Ingreso de stock existente (sin compra) ---------------- */

export interface InitialStockInput {
  opId?: string;
  productId: ID;
  quantity: number;
  /** Costo por unidad; null = desconocido (no se inventa). */
  unitCost: Money | null;
  /** Fecha de ingreso; null = desconocida (se excluye de cálculos de tiempo). */
  date: ISODate | null;
  notes?: string;
  units?: UnitDetails[];
}

/**
 * Registra mercancía que ya se tenía antes de usar la app (no cuenta como compra del periodo).
 * Permite costo y fecha desconocidos.
 */
export async function registerInitialStock(db: AppDB, input: InitialStockInput): Promise<{ unitIds: ID[] }> {
  const q = assertQty(input.quantity);
  const cost = input.unitCost === null ? null : assertMoney(input.unitCost, 'unitCost', 'Costo por unidad');
  const date = input.date === null ? null : assertDate(input.date, 'date', 'Fecha de ingreso');
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return { unitIds: [] };
    const p = await requireProduct(db, input.productId);
    if (p.archived) fail('archived', 'El producto está archivado.', 'productId');
    await requireInventory(db, p.inventoryId);
    const unitIds: ID[] = [];
    const at = date ?? nowISO();
    if (p.tracking === 'unit') {
      for (let i = 0; i < q; i++) {
        const u = await insertUnit(db, p, {
          acquiredAt: date,
          baseCost: cost,
          source: 'initial',
          details: input.units?.[i],
        });
        unitIds.push(u.id);
        await addMovement(db, {
          at,
          inventoryId: p.inventoryId,
          productId: p.id,
          unitId: u.id,
          type: 'initial',
          dateUnknown: date === null,
          qtyDelta: 1,
          costDelta: cost ?? 0,
          unknownDelta: cost === null ? 1 : 0,
          writeOff: 0,
          refType: 'initial',
          refId: null,
          notes: cleanStr(input.notes ?? '', 300),
        });
      }
    } else {
      const value = cost === null ? 0 : cost * q;
      await db.products.update(p.id, {
        qty: p.qty + q,
        stockValue: p.stockValue + value,
        unknownCostQty: p.unknownCostQty + (cost === null ? q : 0),
        updatedAt: nowISO(),
      });
      await addMovement(db, {
        at,
        inventoryId: p.inventoryId,
        productId: p.id,
        unitId: null,
        type: 'initial',
        dateUnknown: date === null,
        qtyDelta: q,
        costDelta: value,
        unknownDelta: cost === null ? q : 0,
        writeOff: 0,
        refType: 'initial',
        refId: null,
        notes: cleanStr(input.notes ?? '', 300),
      });
    }
    await logHistory(db, {
      entityType: 'product',
      entityId: p.id,
      inventoryId: p.inventoryId,
      action: 'initial_stock',
      summary: `Ingreso de stock existente: ${q} × ${p.name}${cost === null ? ' (costo desconocido)' : ''}${date === null ? ' (fecha desconocida)' : ''}`,
    });
    return { unitIds };
  });
}

/* ---------------- Ajustes de productos por cantidad ---------------- */

export interface AdjustInput {
  opId?: string;
  productId: ID;
  direction: 'in' | 'out';
  quantity: number;
  unitCost?: Money | null; // solo entradas
  date: ISODate;
  reason: string;
}

/** Entrada: corrige faltantes encontrados. Salida: pérdida/daño/robo, se reconoce como baja a costo promedio. */
export async function adjustQuantity(db: AppDB, input: AdjustInput): Promise<void> {
  const q = assertQty(input.quantity);
  const date = assertDate(input.date, 'date', 'Fecha');
  const reason = cleanStr(input.reason, 300);
  if (!reason) fail('required', 'Indique el motivo del ajuste.', 'reason');
  await tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return;
    const p = await requireProduct(db, input.productId);
    if (p.tracking !== 'quantity') fail('invalid', 'Los ajustes por cantidad solo aplican a productos por cantidad.');
    await requireInventory(db, p.inventoryId);
    if (input.direction === 'in') {
      const cost = input.unitCost === null || input.unitCost === undefined ? null : assertMoney(input.unitCost, 'unitCost', 'Costo por unidad');
      const value = cost === null ? 0 : cost * q;
      await db.products.update(p.id, {
        qty: p.qty + q,
        stockValue: p.stockValue + value,
        unknownCostQty: p.unknownCostQty + (cost === null ? q : 0),
        updatedAt: nowISO(),
      });
      await addMovement(db, {
        at: date,
        inventoryId: p.inventoryId,
        productId: p.id,
        unitId: null,
        type: 'adjust_in',
        qtyDelta: q,
        costDelta: value,
        unknownDelta: cost === null ? q : 0,
        writeOff: 0,
        refType: 'adjust',
        refId: null,
        notes: reason,
      });
    } else {
      const c = consumeQuantity(p, q);
      await db.products.update(p.id, { qty: c.qty, stockValue: c.stockValue, unknownCostQty: c.unknownCostQty, updatedAt: nowISO() });
      await addMovement(db, {
        at: date,
        inventoryId: p.inventoryId,
        productId: p.id,
        unitId: null,
        type: 'adjust_out',
        qtyDelta: -q,
        costDelta: -c.cogs,
        unknownDelta: -c.unknownQty,
        writeOff: c.cogs,
        refType: 'adjust',
        refId: null,
        notes: reason,
      });
    }
    await logHistory(db, {
      entityType: 'product',
      entityId: p.id,
      inventoryId: p.inventoryId,
      action: input.direction === 'in' ? 'adjust_in' : 'adjust_out',
      summary: `Ajuste de ${input.direction === 'in' ? 'entrada' : 'salida'}: ${q} × ${p.name}. Motivo: ${reason}`,
    });
  });
}

/* ---------------- Unidades ---------------- */

export type UnitDetailsPatch = Partial<
  Pick<Unit, 'imei' | 'imei2' | 'serial' | 'color' | 'capacity' | 'condition' | 'batteryHealth' | 'defects' | 'replacedParts' | 'includedAccessories' | 'notes'>
>;

const UNIT_FIELD_LABEL: Record<string, string> = {
  imei: 'IMEI',
  imei2: 'IMEI 2',
  serial: 'serial',
  color: 'color',
  capacity: 'capacidad',
  condition: 'estado físico',
  batteryHealth: 'batería',
  defects: 'defectos',
  replacedParts: 'componentes sustituidos',
  includedAccessories: 'accesorios incluidos',
  notes: 'observaciones',
};

export async function updateUnitDetails(db: AppDB, unitId: ID, patch: UnitDetailsPatch): Promise<void> {
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    const next: Unit = { ...u };
    const changed: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      let val: unknown = v;
      if (k === 'imei' || k === 'imei2' || k === 'serial') val = cleanIdentifier(v);
      else if (k === 'batteryHealth') val = validateBattery(v);
      else val = cleanStr(v, k === 'notes' || k === 'defects' ? 1000 : 200);
      if ((u as unknown as Record<string, unknown>)[k] !== val) {
        (next as unknown as Record<string, unknown>)[k] = val;
        changed.push(UNIT_FIELD_LABEL[k] ?? k);
      }
    }
    if (!changed.length) return;
    next.updatedAt = nowISO();
    await db.units.put(next);
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'update',
      summary: `Datos actualizados (${u.code}): ${changed.join(', ')}`,
    });
  });
}

export async function setUnitInspection(db: AppDB, unitId: ID, inspection: Inspection): Promise<void> {
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    const clean: Inspection = {
      items: {},
      inspectedAt: inspection.inspectedAt,
      notes: cleanStr(inspection.notes, 1000),
    };
    for (const [k, it] of Object.entries(inspection.items)) {
      if (!['ok', 'damaged', 'replaced', 'pending', 'na'].includes(it.status)) continue;
      clean.items[k] = {
        status: it.status,
        source: ['seller', 'own', 'technician'].includes(it.source) ? it.source : 'own',
        note: cleanStr(it.note, 300),
      };
    }
    await db.units.update(unitId, { inspection: clean, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'inspection',
      summary: `Inspección actualizada (${u.code})`,
    });
  });
}

/**
 * Asigna o corrige el costo de adquisición de una unidad.
 * - Si el costo era desconocido, se completa (también en las ventas/devoluciones de esa unidad).
 * - Si ya era conocido, solo se corrige mientras la unidad no esté vendida.
 */
export async function setUnitBaseCost(db: AppDB, unitId: ID, baseCost: Money): Promise<void> {
  assertMoney(baseCost, 'baseCost', 'Costo de adquisición');
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    if (u.source === 'purchase')
      fail('from_purchase', 'El costo de esta unidad viene de una compra. Para corregirlo, anule la compra y regístrela de nuevo.');
    const wasUnknown = u.baseCost === null;
    if (!wasUnknown && u.status === 'sold')
      fail('sold', 'La unidad ya está vendida con un costo conocido; ese costo ya se usó en la ganancia de la venta.');
    if (wasUnknown) {
      const lines = await db.saleLines.where('unitId').equals(unitId).toArray();
      for (const l of lines) {
        if (l.cogsUnknownQty > 0) {
          const upd: Partial<typeof l> = { cogs: l.cogs + baseCost, cogsUnknownQty: 0 };
          if (l.returnedUnknownQty > 0) {
            upd.returnedCogs = l.returnedCogs + baseCost;
            upd.returnedUnknownQty = 0;
          }
          await db.saleLines.update(l.id, upd);
          const rets = await db.returns.where('saleId').equals(l.saleId).toArray();
          for (const r of rets) {
            let touched = false;
            const linesR = r.lines.map((rl) => {
              if (rl.saleLineId === l.id && rl.unknownQty > 0) {
                touched = true;
                return { ...rl, cogs: rl.cogs + baseCost, unknownQty: 0 };
              }
              return rl;
            });
            if (touched) await db.returns.update(r.id, { lines: linesR });
          }
        }
      }
    }
    await db.units.update(unitId, { baseCost, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'cost',
      summary: wasUnknown ? `Costo de adquisición completado (${u.code})` : `Costo de adquisición corregido (${u.code})`,
    });
  });
}

/** Completa o corrige la fecha de ingreso de una unidad de stock inicial. */
export async function setUnitAcquiredAt(db: AppDB, unitId: ID, date: ISODate | null): Promise<void> {
  const d = date === null ? null : assertDate(date, 'acquiredAt', 'Fecha de ingreso');
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    if (u.source === 'purchase') fail('from_purchase', 'La fecha de esta unidad viene de su compra. Edite la fecha de la compra.');
    const lines = await db.saleLines.where('unitId').equals(unitId).toArray();
    if (d) {
      for (const l of lines) {
        const s = await db.sales.get(l.saleId);
        if (s && s.status === 'active' && Date.parse(s.date) < Date.parse(d))
          fail('incoherent_date', 'La fecha de ingreso no puede ser posterior a una venta de esta unidad.', 'acquiredAt');
      }
    }
    const patch: Partial<Unit> = { acquiredAt: d, updatedAt: nowISO() };
    if (u.cycle === 1) patch.availableSince = d;
    await db.units.update(unitId, patch);
    for (const l of lines) {
      const lp: Partial<typeof l> = { acquiredAt: d };
      if (l.cycleStart === u.acquiredAt) lp.cycleStart = d;
      await db.saleLines.update(l.id, lp);
    }
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'date',
      summary: `Fecha de ingreso ${d ? 'actualizada' : 'marcada como desconocida'} (${u.code})`,
    });
  });
}

const MOVABLE: UnitStatus[] = ['available', 'in_review', 'damaged'];

/** Cambia entre disponible / en revisión / dañado. No afecta costos ni ventas. */
export async function setUnitStatus(db: AppDB, unitId: ID, status: 'available' | 'in_review' | 'damaged', note = ''): Promise<void> {
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    if (!MOVABLE.includes(u.status))
      fail('invalid_status', `No se puede cambiar el estado de una unidad ${UNIT_STATUS_LABEL[u.status].toLowerCase()}.`);
    if (u.status === status) return;
    await db.units.update(unitId, { status, updatedAt: nowISO() });
    await addMovement(db, {
      at: nowISO(),
      inventoryId: u.inventoryId,
      productId: u.productId,
      unitId,
      type: 'status',
      qtyDelta: 0,
      costDelta: 0,
      unknownDelta: 0,
      writeOff: 0,
      refType: 'status',
      refId: null,
      notes: `${UNIT_STATUS_LABEL[u.status]} → ${UNIT_STATUS_LABEL[status]}${note ? `. ${cleanStr(note, 200)}` : ''}`,
    });
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'status',
      summary: `Estado: ${UNIT_STATUS_LABEL[u.status]} → ${UNIT_STATUS_LABEL[status]} (${u.code})`,
    });
  });
}

/** Da de baja una unidad (pérdida, robo, daño irreparable). Su costo se reconoce como pérdida. Conserva el registro y el código. */
export async function writeOffUnit(db: AppDB, unitId: ID, reason: string, date: ISODate): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Indique el motivo de la baja.', 'reason');
  const d = assertDate(date, 'date', 'Fecha');
  await tx(db, async () => {
    const u = await requireUnit(db, unitId);
    if (!MOVABLE.includes(u.status)) fail('invalid_status', 'Solo se pueden dar de baja unidades en existencia.');
    const c = unitCost(u);
    await db.units.update(unitId, { status: 'archived', archivedReason: r, updatedAt: nowISO() });
    await addMovement(db, {
      at: d,
      inventoryId: u.inventoryId,
      productId: u.productId,
      unitId,
      type: 'adjust_out',
      qtyDelta: -1,
      costDelta: -(c ?? 0),
      unknownDelta: c === null ? -1 : 0,
      writeOff: c ?? 0,
      refType: 'writeoff',
      refId: null,
      notes: r,
    });
    await logHistory(db, {
      entityType: 'unit',
      entityId: unitId,
      inventoryId: u.inventoryId,
      action: 'writeoff',
      summary: `Unidad dada de baja (${u.code}). Motivo: ${r}${c === null ? '. Costo desconocido' : ''}`,
    });
  });
}

/* ---------------- Reparaciones ---------------- */

export interface RepairInput {
  unitId: ID;
  date: ISODate;
  description: string;
  partsReplaced?: string;
  technician?: string;
  cost: Money;
  notes?: string;
  opId?: string;
}

/**
 * Registra una reparación. Si tiene costo:
 * - unidad en existencia → gasto CAPITALIZADO (aumenta el costo de la unidad; no se resta otra vez como gasto).
 * - unidad vendida/dada de baja → gasto OPERATIVO.
 */
export async function addRepair(db: AppDB, input: RepairInput): Promise<Repair> {
  const desc = cleanStr(input.description, 500);
  if (!desc) fail('required', 'Describa la reparación.', 'description');
  const cost = assertMoney(input.cost, 'cost', 'Costo de la reparación');
  const date = assertDate(input.date, 'date', 'Fecha');
  return tx(db, async () => {
    const u = await requireUnit(db, input.unitId);
    if (!(await claimOp(db, input.opId))) {
      const prev = (await db.repairs.where('unitId').equals(u.id).sortBy('createdAt')).at(-1);
      if (prev) return prev;
    }
    const repair: Repair = {
      id: newId(),
      unitId: u.id,
      date,
      description: desc,
      partsReplaced: cleanStr(input.partsReplaced ?? '', 300),
      technician: cleanStr(input.technician ?? '', 100),
      cost,
      expenseId: null,
      notes: cleanStr(input.notes ?? '', 500),
      createdAt: nowISO(),
    };
    if (cost > 0) {
      const capitalize = MOVABLE.includes(u.status);
      const expenseId = newId();
      await db.expenses.add({
        id: expenseId,
        date,
        amount: cost,
        category: 'Reparación',
        notes: `${u.code}: ${desc}`,
        treatment: capitalize ? 'capitalized' : 'operating',
        inventoryId: u.inventoryId,
        saleId: null,
        purchaseId: null,
        unitId: u.id,
        productId: u.productId,
        claimId: null,
        repairId: repair.id,
        status: 'active',
        createdAt: nowISO(),
      });
      repair.expenseId = expenseId;
      if (capitalize) await db.units.update(u.id, { extraCost: u.extraCost + cost, updatedAt: nowISO() });
    }
    if (repair.partsReplaced) {
      const rp = [u.replacedParts, repair.partsReplaced].filter(Boolean).join('; ');
      await db.units.update(u.id, { replacedParts: rp.slice(0, 1000) });
    }
    await db.repairs.add(repair);
    await logHistory(db, {
      entityType: 'unit',
      entityId: u.id,
      inventoryId: u.inventoryId,
      action: 'repair',
      summary: `Reparación registrada (${u.code}): ${desc}`,
    });
    return repair;
  });
}
