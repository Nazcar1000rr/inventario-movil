import type { AppDB } from '../db';
import type { Expense, ExpenseTreatment, ID, ISODate, Money } from '../types';
import { assertDate, assertMoney, cleanStr, fail, newId, nowISO } from '../util';
import { addMovement, logHistory } from './base';
import { claimOp, tx } from './stock';

export const EXPENSE_CATEGORIES = [
  'Transporte',
  'Envío',
  'Empaques',
  'Publicidad',
  'Comisión',
  'Reparación',
  'Garantía',
  'Servicios',
  'Arriendo',
  'Otros',
];

export const TREATMENT_LABEL: Record<ExpenseTreatment, string> = {
  operating: 'Gasto operativo (se resta de la ganancia)',
  capitalized: 'Costo de inventario (se suma al costo de la unidad/producto)',
};

export interface ExpenseInput {
  opId?: string;
  date: ISODate;
  amount: Money;
  category: string;
  notes?: string;
  inventoryId?: ID | null;
  /**
   * operating = gasto general: se resta en la ganancia neta del periodo.
   * capitalized = se suma al costo de una unidad o producto en existencia: se convierte en costo
   *   de venta cuando se vende, y NO se resta otra vez como gasto.
   */
  treatment?: ExpenseTreatment;
  unitId?: ID | null;
  productId?: ID | null;
}

export async function createExpense(db: AppDB, input: ExpenseInput): Promise<Expense | null> {
  const date = assertDate(input.date, 'date', 'Fecha del gasto');
  const amount = assertMoney(input.amount, 'amount', 'Valor del gasto', false);
  const category = cleanStr(input.category, 40);
  if (!category) fail('required', 'Elige una categoría.', 'category');
  const treatment: ExpenseTreatment = input.treatment === 'capitalized' ? 'capitalized' : 'operating';
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    let inventoryId = input.inventoryId ?? null;
    let productId = input.productId ?? null;
    const unitId = input.unitId ?? null;
    const expenseId = newId();
    if (inventoryId && !(await db.inventories.get(inventoryId))) fail('not_found', 'El inventario no existe.', 'inventoryId');
    if (treatment === 'capitalized') {
      if (unitId) {
        const u = await db.units.get(unitId);
        if (!u) fail('not_found', 'La unidad no existe.', 'unitId');
        if (!['available', 'in_review', 'damaged'].includes(u.status))
          fail('not_in_stock', `La unidad ${u.code} ya no está en existencia: registra el gasto como operativo.`, 'treatment');
        await db.units.update(u.id, { extraCost: u.extraCost + amount, updatedAt: nowISO() });
        inventoryId = u.inventoryId;
        productId = u.productId;
        await logHistory(db, {
          entityType: 'unit',
          entityId: u.id,
          inventoryId: u.inventoryId,
          action: 'extra_cost',
          summary: `Costo adicional (${category}) sumado a ${u.code}: ${amount}`,
        });
      } else if (productId) {
        const p = await db.products.get(productId);
        if (!p) fail('not_found', 'El producto no existe.', 'productId');
        if (p.tracking !== 'quantity') fail('invalid', 'Para productos por unidad, elige la unidad específica.', 'unitId');
        if (p.qty - p.unknownCostQty <= 0)
          fail('no_stock', `"${p.name}" no tiene existencias con costo conocido a las que sumar el gasto.`, 'productId');
        await db.products.update(p.id, { stockValue: p.stockValue + amount, updatedAt: nowISO() });
        inventoryId = p.inventoryId;
        await addMovement(db, {
          at: date,
          inventoryId: p.inventoryId,
          productId: p.id,
          unitId: null,
          type: 'adjust_in',
          qtyDelta: 0,
          costDelta: amount,
          unknownDelta: 0,
          writeOff: 0,
          refType: 'expense',
          refId: expenseId,
          notes: `Costo adicional capitalizado: ${category}`,
        });
      } else {
        fail('required', 'Un gasto capitalizado debe vincularse a una unidad o a un producto.', 'treatment');
      }
    }
    const e: Expense = {
      id: expenseId,
      date,
      amount,
      category,
      notes: cleanStr(input.notes ?? '', 500),
      treatment,
      inventoryId,
      saleId: null,
      purchaseId: null,
      unitId,
      productId,
      claimId: null,
      repairId: null,
      status: 'active',
      createdAt: nowISO(),
    };
    await db.expenses.add(e);
    await logHistory(db, {
      entityType: 'expense',
      entityId: e.id,
      inventoryId,
      action: 'create',
      summary: `Gasto registrado: ${category} ${amount}`,
    });
    return e;
  });
}

/** Anula un gasto (se conserva marcado). Un gasto capitalizado solo se puede anular si la unidad sigue en existencia. */
export async function voidExpense(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const e = await db.expenses.get(id);
    if (!e) fail('not_found', 'El gasto no existe.');
    if (e.status === 'voided') return;
    if (e.claimId || e.repairId)
      fail('linked', 'Este gasto pertenece a un reclamo o reparación; modifícalo desde allí.');
    if (e.debtId) fail('linked', 'Este gasto son intereses de un abono a una deuda; anula el abono desde Deudas.');
    if (e.treatment === 'capitalized') {
      if (e.unitId) {
        const u = (await db.units.get(e.unitId))!;
        if (!['available', 'in_review', 'damaged'].includes(u.status))
          fail('sold', `No se puede anular: el costo ya forma parte de la venta de ${u.code}.`);
        await db.units.update(u.id, { extraCost: Math.max(0, u.extraCost - e.amount), updatedAt: nowISO() });
      } else if (e.productId) {
        const p = (await db.products.get(e.productId))!;
        if (p.stockValue < e.amount) fail('sold', 'No se puede anular: parte de ese costo ya se usó en ventas.');
        await db.products.update(p.id, { stockValue: p.stockValue - e.amount, updatedAt: nowISO() });
        await addMovement(db, {
          at: nowISO(),
          inventoryId: p.inventoryId,
          productId: p.id,
          unitId: null,
          type: 'adjust_out',
          qtyDelta: 0,
          costDelta: -e.amount,
          unknownDelta: 0,
          writeOff: 0,
          refType: 'expense',
          refId: e.id,
          notes: 'Anulación de costo capitalizado',
        });
      }
    }
    await db.expenses.update(id, { status: 'voided' });
    await logHistory(db, {
      entityType: 'expense',
      entityId: id,
      inventoryId: e.inventoryId,
      action: 'void',
      summary: `Gasto anulado: ${e.category} ${e.amount}`,
    });
  });
}
