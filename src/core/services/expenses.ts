import type { AppDB } from '../db';
import type { Expense, ExpenseTreatment, ID, ISODate, Money } from '../types';
import { assertDate, assertMoney, cleanStr, fail, newId, nowISO } from '../util';
import { addMovement, logHistory } from './base';
import { claimOp, tx } from './stock';
import { addValueToLots, removeValueFromLots, usesLots } from './lots';

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
  /** Productos con lotes: lote al que se suma (por defecto, se reparte entre todos según la cantidad). */
  lotId?: ID | null;
}

/** Suma un costo a una unidad en existencia (no crea el gasto). Devuelve su inventario y producto. */
export async function capitalizeOnUnit(db: AppDB, unitId: ID, amount: Money, category: string): Promise<{ inventoryId: ID; productId: ID }> {
  const u = await db.units.get(unitId);
  if (!u) fail('not_found', 'La unidad no existe.', 'unitId');
  if (!['available', 'in_review', 'damaged'].includes(u.status))
    fail('not_in_stock', `La unidad ${u.code} ya no está en existencia: registra el gasto como operativo.`, 'treatment');
  await db.units.update(u.id, { extraCost: u.extraCost + amount, updatedAt: nowISO() });
  await logHistory(db, {
    entityType: 'unit',
    entityId: u.id,
    inventoryId: u.inventoryId,
    action: 'extra_cost',
    summary: `Costo adicional (${category}) sumado a ${u.code}: ${amount}`,
  });
  return { inventoryId: u.inventoryId, productId: u.productId };
}

/** Suma un costo a las existencias con costo conocido de un producto por cantidad (no crea el gasto). */
export async function capitalizeOnProduct(
  db: AppDB,
  productId: ID,
  amount: Money,
  o: { category: string; date: ISODate; expenseId: ID; lotId?: ID | null },
): Promise<{ inventoryId: ID; lotAllocations?: { lotId: ID; amount: Money }[] }> {
  const p = await db.products.get(productId);
  if (!p) fail('not_found', 'El producto no existe.', 'productId');
  if (p.tracking !== 'quantity') fail('invalid', 'Para productos por unidad, elige la unidad específica.', 'unitId');
  if (p.qty - p.unknownCostQty <= 0)
    fail('no_stock', `"${p.name}" no tiene existencias con costo conocido a las que sumar el gasto.`, 'productId');
  const lotAllocations = usesLots(p) ? await addValueToLots(db, p, amount, o.lotId) : undefined;
  await db.products.update(p.id, { stockValue: p.stockValue + amount, updatedAt: nowISO() });
  await addMovement(db, {
    at: o.date,
    inventoryId: p.inventoryId,
    productId: p.id,
    unitId: null,
    type: 'adjust_in',
    qtyDelta: 0,
    costDelta: amount,
    unknownDelta: 0,
    writeOff: 0,
    refType: 'expense',
    refId: o.expenseId,
    notes: `Costo adicional capitalizado: ${o.category}`,
  });
  return { inventoryId: p.inventoryId, lotAllocations };
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
    let lotAllocations: { lotId: ID; amount: Money }[] | undefined;
    if (inventoryId && !(await db.inventories.get(inventoryId))) fail('not_found', 'El inventario no existe.', 'inventoryId');
    if (treatment === 'capitalized') {
      if (unitId) {
        ({ inventoryId, productId } = await capitalizeOnUnit(db, unitId, amount, category));
      } else if (productId) {
        ({ inventoryId, lotAllocations } = await capitalizeOnProduct(db, productId, amount, { category, date, expenseId, lotId: input.lotId }));
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
      ...(lotAllocations ? { lotAllocations } : {}),
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

/**
 * Anula un gasto (se conserva marcado). Un gasto capitalizado solo se puede anular si la unidad sigue en existencia.
 * Si el gasto es parte de un grupo (gasto de compra agregado después o repartido entre compras), se anula el grupo completo.
 */
export async function voidExpense(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const e = await db.expenses.get(id);
    if (!e) fail('not_found', 'El gasto no existe.');
    if (e.status === 'voided') return;
    if (e.claimId || e.repairId)
      fail('linked', 'Este gasto pertenece a un reclamo o reparación; modifícalo desde allí.');
    if (e.debtId) fail('linked', 'Este gasto son intereses de un abono a una deuda; anula el abono desde Deudas.');
    const group = e.costGroupId ? await db.expenses.filter((x) => x.costGroupId === e.costGroupId && x.status === 'active').toArray() : [e];
    for (const x of group) await voidOne(db, x);
  });
}

async function voidOne(db: AppDB, e: Expense): Promise<void> {
  if (e.treatment === 'capitalized') {
    if (e.unitId) {
      const u = (await db.units.get(e.unitId))!;
      if (!['available', 'in_review', 'damaged'].includes(u.status))
        fail('sold', `No se puede anular: el costo ya forma parte de la venta de ${u.code}.`);
      await db.units.update(u.id, { extraCost: Math.max(0, u.extraCost - e.amount), updatedAt: nowISO() });
    } else if (e.productId) {
      const p = (await db.products.get(e.productId))!;
      if (p.stockValue < e.amount) fail('sold', 'No se puede anular: parte de ese costo ya se usó en ventas.');
      if (usesLots(p)) await removeValueFromLots(db, p, e.amount, e.lotAllocations);
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
  await db.expenses.update(e.id, { status: 'voided' });
  await logHistory(db, {
    entityType: 'expense',
    entityId: e.id,
    inventoryId: e.inventoryId,
    action: 'void',
    summary: `Gasto anulado: ${e.category} ${e.amount}`,
  });
}
