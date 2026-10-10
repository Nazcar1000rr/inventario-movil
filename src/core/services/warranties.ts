import type { AppDB } from '../db';
import type { ClaimStatus, ID, ISODate, Money, Warranty, WarrantyClaim, WarrantyType } from '../types';
import { addDays, addMonths, assertDate, assertMoney, cleanStr, daysBetween, fail, newId, nowISO } from '../util';
import { logHistory } from './base';
import { claimOp, tx } from './stock';

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
  rejected: 'Rechazado',
};

export function computeEndDate(start: ISODate, value: number, unit: 'days' | 'months'): ISODate {
  return unit === 'months' ? addMonths(start, value) : addDays(start, value);
}

export function validateDuration(value: unknown, unit: unknown): { value: number; unit: 'days' | 'months' } {
  if (unit !== 'days' && unit !== 'months') fail('invalid', 'Unidad de duración no válida.', 'durationUnit');
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    fail('invalid', 'La duración de la garantía debe ser un número entero mayor que cero.', 'durationValue');
  const max = unit === 'months' ? 120 : 3650;
  if (value > max) fail('invalid', 'La duración de la garantía es demasiado larga.', 'durationValue');
  return { value, unit };
}

export type WarrantyDisplay = 'vigente' | 'por_vencer' | 'vencida' | 'anulada' | 'cerrada';

export function warrantyDisplayStatus(w: Warranty, alertDays: number, today = new Date()): WarrantyDisplay {
  if (w.status === 'cancelled') return 'anulada';
  if (w.status === 'closed') return 'cerrada';
  const left = daysBetween(today.toISOString(), w.endDate);
  if (left < 0) return 'vencida';
  if (left <= alertDays) return 'por_vencer';
  return 'vigente';
}

export const WARRANTY_DISPLAY_LABEL: Record<WarrantyDisplay, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  anulada: 'Anulada',
  cerrada: 'Cerrada',
};

export function buildWarranty(args: {
  type: WarrantyType;
  inventoryId: ID;
  startDate: ISODate;
  durationValue: number;
  durationUnit: 'days' | 'months';
  conditions?: string;
  saleId?: ID | null;
  saleLineId?: ID | null;
  unitId?: ID | null;
  productId?: ID | null;
  customerId?: ID | null;
  supplierId?: ID | null;
  notes?: string;
}): Warranty {
  const d = validateDuration(args.durationValue, args.durationUnit);
  const now = nowISO();
  return {
    id: newId(),
    type: args.type,
    inventoryId: args.inventoryId,
    saleId: args.saleId ?? null,
    saleLineId: args.saleLineId ?? null,
    unitId: args.unitId ?? null,
    productId: args.productId ?? null,
    customerId: args.customerId ?? null,
    supplierId: args.supplierId ?? null,
    startDate: args.startDate,
    durationValue: d.value,
    durationUnit: d.unit,
    endDate: computeEndDate(args.startDate, d.value, d.unit),
    conditions: cleanStr(args.conditions ?? '', 1000),
    status: 'active',
    notes: cleanStr(args.notes ?? '', 1000),
    createdAt: now,
    updatedAt: now,
  };
}

/** Garantía independiente (p. ej. la que da el proveedor sobre una unidad). */
export async function createWarranty(db: AppDB, input: Parameters<typeof buildWarranty>[0]): Promise<Warranty> {
  const start = assertDate(input.startDate, 'startDate', 'Fecha de inicio', { allowFuture: true });
  return tx(db, async () => {
    if (!(await db.inventories.get(input.inventoryId))) fail('not_found', 'El inventario no existe.');
    if (input.unitId && !(await db.units.get(input.unitId))) fail('not_found', 'La unidad no existe.');
    const w = buildWarranty({ ...input, startDate: start });
    await db.warranties.add(w);
    await logHistory(db, {
      entityType: 'warranty',
      entityId: w.id,
      inventoryId: w.inventoryId,
      action: 'create',
      summary: `Garantía registrada (${w.type === 'customer' ? 'al cliente' : 'del proveedor'})`,
    });
    if (w.unitId) {
      await logHistory(db, {
        entityType: 'unit',
        entityId: w.unitId,
        inventoryId: w.inventoryId,
        action: 'warranty',
        summary: `Garantía ${w.type === 'customer' ? 'al cliente' : 'del proveedor'} hasta ${w.endDate.slice(0, 10)}`,
      });
    }
    return w;
  });
}

export async function updateWarranty(
  db: AppDB,
  id: ID,
  patch: { durationValue?: number; durationUnit?: 'days' | 'months'; conditions?: string; notes?: string; status?: Warranty['status'] },
): Promise<void> {
  await tx(db, async () => {
    const w = await db.warranties.get(id);
    if (!w) fail('not_found', 'La garantía no existe.');
    const next: Warranty = { ...w, updatedAt: nowISO() };
    if (patch.durationValue !== undefined || patch.durationUnit !== undefined) {
      const d = validateDuration(patch.durationValue ?? w.durationValue, patch.durationUnit ?? w.durationUnit);
      next.durationValue = d.value;
      next.durationUnit = d.unit;
      next.endDate = computeEndDate(w.startDate, d.value, d.unit);
    }
    if (patch.conditions !== undefined) next.conditions = cleanStr(patch.conditions, 1000);
    if (patch.notes !== undefined) next.notes = cleanStr(patch.notes, 1000);
    if (patch.status !== undefined) next.status = patch.status;
    await db.warranties.put(next);
    await logHistory(db, {
      entityType: 'warranty',
      entityId: id,
      inventoryId: w.inventoryId,
      action: 'update',
      summary: 'Garantía actualizada',
    });
  });
}

export interface ClaimInput {
  opId?: string;
  warrantyId: ID;
  date: ISODate;
  description: string;
  status?: ClaimStatus;
  resolution?: string;
  cost?: Money;
  notes?: string;
}

/**
 * Reclamo de garantía. Si tiene costo, se registra como gasto operativo (categoría Garantía)
 * vinculado al reclamo: el costo existe en un solo lugar y no se cuenta dos veces.
 */
export async function addClaim(db: AppDB, input: ClaimInput): Promise<WarrantyClaim> {
  const date = assertDate(input.date, 'date', 'Fecha del reclamo');
  const desc = cleanStr(input.description, 1000);
  if (!desc) fail('required', 'Describa el reclamo.', 'description');
  const cost = assertMoney(input.cost ?? 0, 'cost', 'Costo');
  return tx(db, async () => {
    const w = await db.warranties.get(input.warrantyId);
    if (!w) fail('not_found', 'La garantía no existe.');
    if (!(await claimOp(db, input.opId))) {
      const prev = (await db.warrantyClaims.where('warrantyId').equals(w.id).sortBy('createdAt')).at(-1);
      if (prev) return prev;
    }
    const status = input.status ?? 'open';
    const claim: WarrantyClaim = {
      id: newId(),
      warrantyId: w.id,
      date,
      description: desc,
      status,
      resolution: cleanStr(input.resolution ?? '', 300),
      cost,
      expenseId: null,
      notes: cleanStr(input.notes ?? '', 1000),
      resolvedAt: status === 'resolved' || status === 'rejected' ? nowISO() : null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    if (cost > 0) claim.expenseId = await addClaimExpense(db, w.inventoryId, claim, w.unitId);
    await db.warrantyClaims.add(claim);
    await logHistory(db, {
      entityType: 'warranty',
      entityId: w.id,
      inventoryId: w.inventoryId,
      action: 'claim',
      summary: `Reclamo registrado: ${desc}`,
    });
    if (w.unitId)
      await logHistory(db, {
        entityType: 'unit',
        entityId: w.unitId,
        inventoryId: w.inventoryId,
        action: 'claim',
        summary: `Reclamo de garantía: ${desc}`,
      });
    return claim;
  });
}

async function addClaimExpense(db: AppDB, inventoryId: ID, claim: WarrantyClaim, unitId: ID | null): Promise<ID> {
  const id = newId();
  await db.expenses.add({
    id,
    date: claim.date,
    amount: claim.cost,
    category: 'Garantía',
    notes: `Reclamo: ${claim.description}`.slice(0, 300),
    treatment: 'operating',
    inventoryId,
    saleId: null,
    purchaseId: null,
    unitId,
    productId: null,
    claimId: claim.id,
    repairId: null,
    status: 'active',
    createdAt: nowISO(),
  });
  return id;
}

export async function updateClaim(
  db: AppDB,
  id: ID,
  patch: { status?: ClaimStatus; resolution?: string; cost?: Money; notes?: string },
): Promise<void> {
  await tx(db, async () => {
    const c = await db.warrantyClaims.get(id);
    if (!c) fail('not_found', 'El reclamo no existe.');
    const w = (await db.warranties.get(c.warrantyId))!;
    const next: WarrantyClaim = { ...c, updatedAt: nowISO() };
    if (patch.status !== undefined) {
      next.status = patch.status;
      next.resolvedAt = patch.status === 'resolved' || patch.status === 'rejected' ? c.resolvedAt ?? nowISO() : null;
    }
    if (patch.resolution !== undefined) next.resolution = cleanStr(patch.resolution, 300);
    if (patch.notes !== undefined) next.notes = cleanStr(patch.notes, 1000);
    if (patch.cost !== undefined && patch.cost !== c.cost) {
      const cost = assertMoney(patch.cost, 'cost', 'Costo');
      next.cost = cost;
      if (c.expenseId) {
        if (cost > 0) await db.expenses.update(c.expenseId, { amount: cost });
        else {
          await db.expenses.update(c.expenseId, { status: 'voided' });
          next.expenseId = null;
        }
      } else if (cost > 0) {
        next.expenseId = await addClaimExpense(db, w.inventoryId, next, w.unitId);
      }
    }
    await db.warrantyClaims.put(next);
    await logHistory(db, {
      entityType: 'warranty',
      entityId: w.id,
      inventoryId: w.inventoryId,
      action: 'claim_update',
      summary: `Reclamo actualizado: ${CLAIM_STATUS_LABEL[next.status]}`,
    });
  });
}
