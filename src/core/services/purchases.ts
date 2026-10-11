import type { AppDB } from '../db';
import type { AllocationMethod, ID, ISODate, Money, Purchase, PurchaseLine, Unit } from '../types';
import { allocate, assertDate, assertMoney, assertQty, cleanStr, fail, newId, nowISO } from '../util';
import { addMovement, logHistory, requireInventory, requireProduct } from './base';
import { insertUnit, type UnitDetails } from './products';
import { tx } from './stock';
import { insertPurchaseDebt, type PurchaseFunding } from './debts';
import { addLot, usesLots } from './lots';

export interface PurchaseLineInput {
  productId: ID;
  quantity: number;
  /** Total pagado por esta línea (no por unidad). */
  price: Money;
  /** Datos opcionales por unidad (solo productos por unidad). */
  units?: UnitDetails[];
}

export interface PurchaseInput {
  opId: string;
  inventoryId: ID;
  supplierId?: ID | null;
  date: ISODate;
  paymentMethod?: string;
  notes?: string;
  /** Gastos atribuibles a toda la compra (transporte, envío...). Se suman al costo de lo comprado. */
  extraCosts?: Money;
  allocation?: AllocationMethod;
  lines: PurchaseLineInput[];
  /** Si la compra se pagó con deuda (tarjeta de crédito, crédito del proveedor...). Sin esto, se pagó con la caja. */
  funding?: PurchaseFunding | null;
}

export interface PurchasePreviewLine {
  productId: ID;
  quantity: number;
  price: Money;
  allocatedExtra: Money;
  totalCost: Money;
  /** Costo asignado a cada unidad (suma exacta = totalCost). */
  unitCosts: Money[];
}

/**
 * Calcula el reparto de gastos y el costo unitario sin guardar nada (para mostrarlo antes de confirmar).
 * - allocation 'value': los gastos se reparten en proporción al precio pagado por cada línea.
 * - allocation 'units': se reparten en partes iguales por unidad.
 * Los redondeos se reparten para que la suma sea exacta.
 */
export function previewPurchase(lines: { productId: ID; quantity: number; price: Money }[], extraCosts: Money, allocation: AllocationMethod): PurchasePreviewLine[] {
  const weights =
    allocation === 'units' || lines.every((l) => l.price === 0) ? lines.map((l) => l.quantity) : lines.map((l) => l.price);
  const extras = allocate(extraCosts, weights);
  return lines.map((l, i) => {
    const totalCost = l.price + extras[i];
    return {
      productId: l.productId,
      quantity: l.quantity,
      price: l.price,
      allocatedExtra: extras[i],
      totalCost,
      unitCosts: allocate(totalCost, Array(l.quantity).fill(1)),
    };
  });
}

/** Registra una compra de forma ATÓMICA: compra + líneas + unidades/stock + movimientos. */
export async function createPurchase(db: AppDB, input: PurchaseInput): Promise<Purchase> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  const date = assertDate(input.date, 'date', 'Fecha de compra');
  const extraCosts = assertMoney(input.extraCosts ?? 0, 'extraCosts', 'Gastos adicionales');
  const allocation: AllocationMethod = input.allocation === 'units' ? 'units' : 'value';
  if (!input.lines?.length) fail('required', 'Agrega al menos un producto a la compra.', 'lines');
  input.lines.forEach((l, i) => {
    assertQty(l.quantity, `lines.${i}.quantity`);
    assertMoney(l.price, `lines.${i}.price`, 'Precio pagado');
  });

  return tx(db, async () => {
    const existing = await db.purchases.where('opId').equals(input.opId).first();
    if (existing) return existing; // reintento o doble pulsación: no se duplica

    const inv = await requireInventory(db, input.inventoryId);
    if (input.supplierId) {
      const s = await db.suppliers.get(input.supplierId);
      if (!s) fail('not_found', 'El proveedor no existe.', 'supplierId');
    }
    const products = [];
    for (const l of input.lines) {
      const p = await requireProduct(db, l.productId);
      if (p.inventoryId !== inv.id) fail('wrong_inventory', `"${p.name}" pertenece a otro inventario.`, 'lines');
      if (p.archived) fail('archived', `"${p.name}" está archivado.`, 'lines');
      products.push(p);
    }

    const preview = previewPurchase(input.lines, extraCosts, allocation);
    const subtotal = input.lines.reduce((a, l) => a + l.price, 0);
    const purchase: Purchase = {
      id: newId(),
      opId: input.opId,
      inventoryId: inv.id,
      supplierId: input.supplierId ?? null,
      date,
      paymentMethod: cleanStr(input.paymentMethod ?? '', 40),
      notes: cleanStr(input.notes ?? '', 1000),
      subtotal,
      extraCosts,
      allocation,
      total: subtotal + extraCosts,
      paymentSource: input.funding ? 'debt' : 'cash',
      debtId: null,
      status: 'active',
      voidedAt: null,
      voidReason: '',
      createdAt: nowISO(),
    };
    await db.purchases.add(purchase);
    if (input.funding) {
      const debt = await insertPurchaseDebt(db, purchase, input.funding);
      purchase.debtId = debt.id;
      await db.purchases.update(purchase.id, { debtId: debt.id });
    }

    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      const pv = preview[i];
      let p = products[i];
      // Recargar por si el mismo producto aparece en varias líneas
      p = (await db.products.get(p.id))!;
      const line: PurchaseLine = {
        id: newId(),
        purchaseId: purchase.id,
        inventoryId: inv.id,
        productId: p.id,
        quantity: l.quantity,
        price: l.price,
        allocatedExtra: pv.allocatedExtra,
        totalCost: pv.totalCost,
        unitIds: [],
      };
      if (p.tracking === 'unit') {
        for (let k = 0; k < l.quantity; k++) {
          const u = await insertUnit(db, p, {
            acquiredAt: date,
            baseCost: pv.unitCosts[k],
            source: 'purchase',
            purchaseId: purchase.id,
            purchaseLineId: line.id,
            supplierId: purchase.supplierId,
            details: l.units?.[k],
          });
          line.unitIds.push(u.id);
          await addMovement(db, {
            at: date,
            inventoryId: inv.id,
            productId: p.id,
            unitId: u.id,
            type: 'purchase',
            qtyDelta: 1,
            costDelta: pv.unitCosts[k],
            unknownDelta: 0,
            writeOff: 0,
            refType: 'purchase',
            refId: purchase.id,
            notes: '',
          });
        }
      } else {
        await db.products.update(p.id, {
          qty: p.qty + l.quantity,
          stockValue: p.stockValue + pv.totalCost,
          updatedAt: nowISO(),
        });
        if (usesLots(p))
          await addLot(db, {
            product: p,
            source: 'purchase',
            qty: l.quantity,
            value: pv.totalCost,
            date,
            purchaseId: purchase.id,
            purchaseLineId: line.id,
            supplierId: purchase.supplierId,
          });
        await addMovement(db, {
          at: date,
          inventoryId: inv.id,
          productId: p.id,
          unitId: null,
          type: 'purchase',
          qtyDelta: l.quantity,
          costDelta: pv.totalCost,
          unknownDelta: 0,
          writeOff: 0,
          refType: 'purchase',
          refId: purchase.id,
          notes: '',
        });
      }
      await db.purchaseLines.add(line);
    }

    const units = input.lines.reduce((a, l) => a + l.quantity, 0);
    await logHistory(db, {
      entityType: 'purchase',
      entityId: purchase.id,
      inventoryId: inv.id,
      action: 'create',
      summary: `Compra registrada: ${units} unidad(es), total ${purchase.total}`,
    });
    return purchase;
  });
}

/** Edita datos no financieros de una compra. Cambiar la fecha actualiza la fecha de ingreso de lo comprado. */
export async function updatePurchaseInfo(
  db: AppDB,
  id: ID,
  patch: { notes?: string; supplierId?: ID | null; paymentMethod?: string; date?: ISODate },
): Promise<void> {
  await tx(db, async () => {
    const p = await db.purchases.get(id);
    if (!p) fail('not_found', 'La compra no existe.');
    if (p.status === 'voided') fail('voided', 'La compra está anulada.');
    const upd: Partial<Purchase> = {};
    if (patch.notes !== undefined) upd.notes = cleanStr(patch.notes, 1000);
    if (patch.paymentMethod !== undefined) upd.paymentMethod = cleanStr(patch.paymentMethod, 40);
    if (patch.supplierId !== undefined) {
      if (patch.supplierId && !(await db.suppliers.get(patch.supplierId))) fail('not_found', 'El proveedor no existe.', 'supplierId');
      upd.supplierId = patch.supplierId;
      const lines = await db.purchaseLines.where('purchaseId').equals(id).toArray();
      for (const l of lines) for (const uid of l.unitIds) await db.units.update(uid, { supplierId: patch.supplierId });
      await db.lots.where('purchaseId').equals(id).modify({ supplierId: patch.supplierId });
    }
    if (patch.date !== undefined) {
      const date = assertDate(patch.date, 'date', 'Fecha de compra');
      const lines = await db.purchaseLines.where('purchaseId').equals(id).toArray();
      for (const l of lines) {
        for (const uid of l.unitIds) {
          const u = await db.units.get(uid);
          if (!u) continue;
          const sl = await db.saleLines.where('unitId').equals(uid).toArray();
          for (const s of sl) {
            const sale = await db.sales.get(s.saleId);
            if (sale && sale.status === 'active' && Date.parse(sale.date) < Date.parse(date))
              fail('incoherent_date', `La nueva fecha es posterior a la venta de ${u.code}.`, 'date');
          }
          const uu: Partial<Unit> = { acquiredAt: date };
          if (u.cycle === 1) uu.availableSince = date;
          await db.units.update(uid, uu);
          for (const s of sl) {
            const lp: Partial<typeof s> = { acquiredAt: date };
            if (s.cycleStart === u.acquiredAt) lp.cycleStart = date;
            await db.saleLines.update(s.id, lp);
          }
        }
      }
      const mvs = await db.movements.where('refId').equals(id).toArray();
      for (const m of mvs) if (m.type === 'purchase') await db.movements.update(m.id, { at: date });
      await db.lots.where('purchaseId').equals(id).modify({ date });
      upd.date = date;
      if (p.debtId) {
        const debt = await db.debts.get(p.debtId);
        const first = (await db.debtPayments.where('debtId').equals(p.debtId).toArray()).map((x) => x.date).sort()[0];
        if (first && Date.parse(first) < Date.parse(date))
          fail('incoherent_date', 'La nueva fecha es posterior a un abono de la deuda de esta compra.', 'date');
        if (debt) await db.debts.update(debt.id, { date, updatedAt: nowISO() });
      }
    }
    await db.purchases.update(id, upd);
    await logHistory(db, {
      entityType: 'purchase',
      entityId: id,
      inventoryId: p.inventoryId,
      action: 'update',
      summary: 'Datos de la compra editados',
    });
  });
}

/**
 * Anula una compra registrada por error. La compra se conserva marcada como anulada.
 * Solo es posible si todo lo comprado sigue en existencia y (para productos por cantidad)
 * no hubo salidas posteriores, para no distorsionar el costo promedio.
 */
export async function voidPurchase(db: AppDB, id: ID, reason: string): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Escribe el motivo de la anulación.', 'reason');
  await tx(db, async () => {
    const p = await db.purchases.get(id);
    if (!p) fail('not_found', 'La compra no existe.');
    if (p.status === 'voided') return;
    if (p.debtId && (await db.debtPayments.where('debtId').equals(p.debtId).count()) > 0)
      fail('debt_has_payments', 'Esta compra se pagó con una deuda que ya tiene abonos. Anula primero esos abonos en Deudas.');
    if ((await db.expenses.where('purchaseId').equals(id).filter((e) => e.status === 'active' && !!e.costGroupId).count()) > 0)
      fail('has_costs', 'Esta compra tiene gastos agregados después. Anúlalos primero desde el detalle de la compra.');
    const lines = await db.purchaseLines.where('purchaseId').equals(id).toArray();
    const purchaseMoves = (await db.movements.where('refId').equals(id).toArray()).filter((m) => m.type === 'purchase');
    const minSeq = Math.min(...purchaseMoves.map((m) => m.seq));
    for (const l of lines) {
      const prod = (await db.products.get(l.productId))!;
      if (prod.tracking === 'unit') {
        for (const uid of l.unitIds) {
          const u = (await db.units.get(uid))!;
          if (u.status !== 'available' && u.status !== 'in_review' && u.status !== 'damaged')
            fail('not_in_stock', `No se puede anular: la unidad ${u.code} ya no está en existencia.`);
          if (u.extraCost > 0)
            fail('has_extra_cost', `No se puede anular: la unidad ${u.code} tiene costos adicionales registrados.`);
        }
      } else if (usesLots(prod)) {
        const lot = await db.lots.where('purchaseId').equals(id).filter((x) => x.productId === prod.id && (x.purchaseLineId === l.id || x.purchaseLineId === null)).first();
        if (!lot || lot.qty !== l.quantity || lot.value !== l.totalCost)
          fail('later_outflows', `No se puede anular: del lote de "${prod.name}" de esta compra ya salieron unidades o cambió su costo. Registra un ajuste en su lugar.`);
      } else {
        const later = await db.movements
          .where('productId')
          .equals(prod.id)
          .filter((m) => m.seq > minSeq && m.qtyDelta < 0)
          .count();
        if (later > 0)
          fail('later_outflows', `No se puede anular: "${prod.name}" tuvo salidas después de esta compra. Registra un ajuste en su lugar.`);
        if (prod.qty < l.quantity || prod.stockValue < l.totalCost)
          fail('not_in_stock', `No se puede anular: el stock de "${prod.name}" es menor que lo comprado.`);
      }
    }
    const now = nowISO();
    for (const l of lines) {
      const prod = (await db.products.get(l.productId))!;
      if (prod.tracking === 'unit') {
        for (const uid of l.unitIds) {
          const u = (await db.units.get(uid))!;
          await db.units.update(uid, { status: 'archived', archivedReason: 'Compra anulada', updatedAt: now });
          await addMovement(db, {
            at: now,
            inventoryId: p.inventoryId,
            productId: prod.id,
            unitId: uid,
            type: 'void_purchase',
            qtyDelta: -1,
            costDelta: -(u.baseCost ?? 0),
            unknownDelta: 0,
            writeOff: 0,
            refType: 'purchase',
            refId: id,
            notes: r,
          });
        }
      } else {
        await db.products.update(prod.id, {
          qty: prod.qty - l.quantity,
          stockValue: prod.stockValue - l.totalCost,
          updatedAt: now,
        });
        if (usesLots(prod)) await db.lots.where('purchaseId').equals(id).filter((x) => x.productId === prod.id && (x.purchaseLineId === l.id || x.purchaseLineId === null)).delete();
        await addMovement(db, {
          at: now,
          inventoryId: p.inventoryId,
          productId: prod.id,
          unitId: null,
          type: 'void_purchase',
          qtyDelta: -l.quantity,
          costDelta: -l.totalCost,
          unknownDelta: 0,
          writeOff: 0,
          refType: 'purchase',
          refId: id,
          notes: r,
        });
      }
    }
    await db.purchases.update(id, { status: 'voided', voidedAt: now, voidReason: r });
    if (p.debtId) await db.debts.update(p.debtId, { status: 'voided', updatedAt: now });
    await logHistory(db, {
      entityType: 'purchase',
      entityId: id,
      inventoryId: p.inventoryId,
      action: 'void',
      summary: `Compra anulada. Motivo: ${r}`,
    });
  });
}
