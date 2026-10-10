import type { AppDB } from '../db';
import type {
  DeliveryStatus,
  ID,
  ISODate,
  Money,
  Payment,
  Product,
  ReturnDestination,
  ReturnLine,
  Sale,
  SaleLine,
  SaleReturn,
  Unit,
} from '../types';
import { allocate, assertDate, assertMoney, assertQty, cleanStr, fail, newId, nowISO } from '../util';
import { addMovement, getSettings, logHistory, requireInventory, requireProduct } from './base';
import { claimOp, consumeQuantity, fifoOrder, tx, unitCost } from './stock';
import { buildWarranty } from './warranties';

export interface SaleLineInput {
  productId: ID;
  /** Cantidad (productos por cantidad, o unidades a elegir automáticamente por antigüedad). */
  quantity?: number;
  /** Unidades específicas (productos por unidad). Si se indican, se ignora `quantity`. */
  unitIds?: ID[];
  /** Precio de venta por unidad. */
  unitPrice: Money;
}

export interface SaleCostInput {
  category: string;
  amount: Money;
  notes?: string;
}

export interface SaleInput {
  opId: string;
  inventoryId: ID;
  customerId?: ID | null;
  date: ISODate;
  paymentMethod?: string;
  notes?: string;
  discount?: Money;
  deliveryStatus?: DeliveryStatus;
  lines: SaleLineInput[];
  /** Dinero recibido al registrar la venta (0 = pendiente). */
  initialPayment?: Money;
  /** Gastos de la venta (comisión, envío...). Se registran como gastos operativos vinculados. */
  costs?: SaleCostInput[];
  warranty?: { durationValue: number; durationUnit: 'days' | 'months'; conditions?: string } | null;
  /**
   * Comisión del medio de pago sobre el pago inicial. undefined = se calcula con el % configurado
   * para el medio de pago; un número = valor exacto (0 = sin comisión).
   */
  initialPaymentFee?: Money | null;
}

export const PAYMENT_FEE_CATEGORY = 'Comisión medio de pago';

/** % de comisión configurado para un medio de pago (sin distinguir mayúsculas). */
export function feePercentFor(fees: Record<string, number>, method: string): number {
  const m = method.trim().toLowerCase();
  if (!m) return 0;
  for (const [k, v] of Object.entries(fees)) if (k.trim().toLowerCase() === m) return v;
  return 0;
}

/** Comisión estimada (pesos enteros, redondeo normal). */
export function estimatePaymentFee(fees: Record<string, number>, method: string, amount: Money): Money {
  const pct = feePercentFor(fees, method);
  return pct > 0 && amount > 0 ? Math.round((amount * pct) / 100) : 0;
}

/** Registra la comisión del medio de pago como gasto operativo vinculado a la venta. Uso interno. */
async function addPaymentFeeExpense(
  db: AppDB,
  sale: Pick<Sale, 'id' | 'inventoryId'>,
  args: { date: ISODate; method: string; amount: Money; fee: Money | null | undefined },
): Promise<void> {
  let fee: Money;
  let pctNote = '';
  if (args.fee === undefined || args.fee === null) {
    const settings = await getSettings(db);
    const pct = feePercentFor(settings.paymentFees, args.method);
    fee = estimatePaymentFee(settings.paymentFees, args.method, args.amount);
    pctNote = pct ? ` (${pct} %)` : '';
  } else fee = assertMoney(args.fee, 'fee', 'Comisión');
  if (fee <= 0) return;
  if (fee > args.amount) fail('invalid', 'La comisión no puede ser mayor que el pago.', 'fee');
  await db.expenses.add({
    id: newId(),
    date: args.date,
    amount: fee,
    category: PAYMENT_FEE_CATEGORY,
    notes: `${args.method || 'Pago'}${pctNote} sobre ${args.amount}`,
    treatment: 'operating',
    inventoryId: sale.inventoryId,
    saleId: sale.id,
    purchaseId: null,
    unitId: null,
    productId: null,
    claimId: null,
    repairId: null,
    paymentFee: true,
    status: 'active',
    createdAt: nowISO(),
  });
}

interface Atom {
  product: Product;
  unit: Unit | null;
  quantity: number;
  unitPrice: Money;
}

export type PaymentStatus = 'pagada' | 'parcial' | 'pendiente' | 'devuelta' | 'anulada';

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pagada: 'Pagada',
  parcial: 'Pago parcial',
  pendiente: 'Pago pendiente',
  devuelta: 'Devuelta',
  anulada: 'Anulada',
};

export interface SaleBalance {
  /** Importe vigente de la venta: total − devoluciones (0 si está anulada). */
  effective: Money;
  returned: Money;
  paid: Money;
  refunded: Money;
  /** Dinero neto recibido: pagos − reembolsos. */
  collected: Money;
  /** Saldo pendiente de cobro. */
  pending: Money;
  /** Saldo a favor del cliente (se le debe reembolsar). */
  credit: Money;
  status: PaymentStatus;
}

export function computeSaleBalance(sale: Sale, lines: SaleLine[], payments: Payment[]): SaleBalance {
  const returned = lines.reduce((a, l) => a + l.returnedAmount, 0);
  const paid = payments.filter((p) => p.kind === 'payment').reduce((a, p) => a + p.amount, 0);
  const refunded = payments.filter((p) => p.kind === 'refund').reduce((a, p) => a + p.amount, 0);
  const collected = paid - refunded;
  if (sale.status === 'voided') {
    return { effective: 0, returned, paid, refunded, collected, pending: 0, credit: 0, status: 'anulada' };
  }
  const effective = sale.total - returned;
  const pending = Math.max(0, effective - collected);
  const credit = Math.max(0, collected - effective);
  let status: PaymentStatus;
  if (effective === 0 && returned > 0) status = 'devuelta';
  else if (pending === 0) status = 'pagada';
  else if (collected > 0) status = 'parcial';
  else status = 'pendiente';
  return { effective, returned, paid, refunded, collected, pending, credit, status };
}

export async function getSaleBalance(db: AppDB, saleId: ID): Promise<SaleBalance> {
  const sale = await db.sales.get(saleId);
  if (!sale) fail('not_found', 'La venta no existe.');
  const [lines, payments] = await Promise.all([
    db.saleLines.where('saleId').equals(saleId).toArray(),
    db.payments.where('saleId').equals(saleId).toArray(),
  ]);
  return computeSaleBalance(sale, lines, payments);
}

/**
 * Registra una venta de forma ATÓMICA. Garantías:
 * - Nunca vende más de lo disponible ni la misma unidad dos veces.
 * - La misma `opId` no crea dos ventas (doble pulsación / reintento).
 * - Si algo falla, no queda nada registrado.
 */
export async function createSale(db: AppDB, input: SaleInput): Promise<Sale> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  const date = assertDate(input.date, 'date', 'Fecha de venta');
  const discount = assertMoney(input.discount ?? 0, 'discount', 'Descuento');
  const initialPayment = assertMoney(input.initialPayment ?? 0, 'initialPayment', 'Pago recibido');
  if (!input.lines?.length) fail('required', 'Agrega al menos un producto a la venta.', 'lines');
  input.lines.forEach((l, i) => assertMoney(l.unitPrice, `lines.${i}.unitPrice`, 'Precio de venta'));
  const costs = (input.costs ?? []).filter((c) => c.amount > 0);
  costs.forEach((c, i) => {
    assertMoney(c.amount, `costs.${i}.amount`, 'Gasto de la venta');
    if (!cleanStr(c.category, 40)) fail('required', 'Indica la categoría del gasto de la venta.', `costs.${i}.category`);
  });
  const delivery: DeliveryStatus = input.deliveryStatus ?? 'na';
  if (!['na', 'pending', 'delivered'].includes(delivery)) fail('invalid', 'Estado de entrega no válido.', 'deliveryStatus');

  return tx(db, async () => {
    const existing = await db.sales.where('opId').equals(input.opId).first();
    if (existing) return existing;

    const inv = await requireInventory(db, input.inventoryId);
    if (input.customerId && !(await db.customers.get(input.customerId)))
      fail('not_found', 'El comprador no existe.', 'customerId');

    // 1) Resolver líneas en "átomos" (una por unidad física, o una por producto por cantidad)
    const atoms: Atom[] = [];
    const usedUnits = new Set<ID>();
    const qtyState = new Map<ID, Product>();
    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      const p = await requireProduct(db, l.productId);
      if (p.inventoryId !== inv.id)
        fail('wrong_inventory', `"${p.name}" pertenece a otro inventario. La venta debe registrarse en su inventario de origen.`, `lines.${i}`);
      if (p.tracking === 'unit') {
        let units: Unit[];
        if (l.unitIds && l.unitIds.length) {
          units = [];
          for (const uid of l.unitIds) {
            const u = await db.units.get(uid);
            if (!u || u.productId !== p.id) fail('not_found', `La unidad seleccionada no pertenece a "${p.name}".`, `lines.${i}`);
            if (usedUnits.has(u.id)) fail('duplicate_unit', `La unidad ${u.code} está repetida en la venta.`, `lines.${i}`);
            if (u.status !== 'available')
              fail('unit_not_available', `La unidad ${u.code} no está disponible (estado actual: ${u.status === 'sold' ? 'vendida' : u.status}).`, `lines.${i}`);
            units.push(u);
          }
        } else {
          const q = assertQty(l.quantity, `lines.${i}.quantity`);
          const avail = (await db.units.where('productId').equals(p.id).filter((u) => u.status === 'available' && !usedUnits.has(u.id)).toArray()).sort(fifoOrder);
          if (avail.length < q)
            fail('insufficient_stock', `Stock insuficiente de "${p.name}": hay ${avail.length} disponible(s) y se intentan vender ${q}.`, `lines.${i}.quantity`);
          units = avail.slice(0, q);
        }
        for (const u of units) {
          usedUnits.add(u.id);
          const since = u.availableSince ?? u.acquiredAt;
          if (since && Date.parse(date) < Date.parse(since) - 60_000)
            fail('incoherent_date', `La fecha de venta es anterior al ingreso de la unidad ${u.code}.`, 'date');
          atoms.push({ product: p, unit: u, quantity: 1, unitPrice: l.unitPrice });
        }
      } else {
        const q = assertQty(l.quantity, `lines.${i}.quantity`);
        const state = qtyState.get(p.id) ?? p;
        if (q > state.qty)
          fail('insufficient_stock', `Stock insuficiente de "${p.name}": hay ${state.qty} disponible(s) y se intentan vender ${q}.`, `lines.${i}.quantity`);
        qtyState.set(p.id, { ...state, qty: state.qty - q });
        atoms.push({ product: p, unit: null, quantity: q, unitPrice: l.unitPrice });
      }
    }

    // 2) Totales y reparto del descuento
    const gross = atoms.map((a) => a.quantity * a.unitPrice);
    const subtotal = gross.reduce((a, b) => a + b, 0);
    if (discount > subtotal) fail('discount_too_high', 'El descuento no puede ser mayor que el subtotal.', 'discount');
    const total = subtotal - discount;
    if (initialPayment > total) fail('overpayment', 'El pago recibido no puede ser mayor que el total de la venta.', 'initialPayment');
    const shares = allocate(discount, gross);

    const sale: Sale = {
      id: newId(),
      opId: input.opId,
      inventoryId: inv.id,
      customerId: input.customerId ?? null,
      date,
      paymentMethod: cleanStr(input.paymentMethod ?? '', 40),
      notes: cleanStr(input.notes ?? '', 1000),
      subtotal,
      discount,
      total,
      deliveryStatus: delivery,
      status: 'active',
      voidedAt: null,
      voidReason: '',
      createdAt: nowISO(),
    };
    await db.sales.add(sale);

    // 3) Líneas, salida de stock y movimientos
    const createdLines: SaleLine[] = [];
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const line: SaleLine = {
        id: newId(),
        saleId: sale.id,
        inventoryId: inv.id,
        productId: a.product.id,
        unitId: a.unit?.id ?? null,
        quantity: a.quantity,
        unitPrice: a.unitPrice,
        discountShare: shares[i],
        netAmount: gross[i] - shares[i],
        cogs: 0,
        cogsUnknownQty: 0,
        cycleStart: null,
        acquiredAt: null,
        returnedQty: 0,
        returnedAmount: 0,
        returnedCogs: 0,
        returnedUnknownQty: 0,
      };
      if (a.unit) {
        const u = (await db.units.get(a.unit.id))!;
        if (u.status !== 'available') fail('unit_not_available', `La unidad ${u.code} ya no está disponible.`);
        const c = unitCost(u);
        line.cogs = c ?? u.extraCost;
        line.cogsUnknownQty = c === null ? 1 : 0;
        line.cycleStart = u.availableSince;
        line.acquiredAt = u.acquiredAt;
        await db.units.update(u.id, { status: 'sold', saleId: sale.id, saleLineId: line.id, updatedAt: nowISO() });
        await addMovement(db, {
          at: date,
          inventoryId: inv.id,
          productId: a.product.id,
          unitId: u.id,
          type: 'sale',
          qtyDelta: -1,
          costDelta: -line.cogs,
          unknownDelta: -line.cogsUnknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: sale.id,
          notes: '',
        });
        await logHistory(db, {
          entityType: 'unit',
          entityId: u.id,
          inventoryId: inv.id,
          action: 'sale',
          summary: `Vendida (${u.code}) por ${line.netAmount}`,
        });
      } else {
        const p = (await db.products.get(a.product.id))!;
        const c = consumeQuantity(p, a.quantity);
        line.cogs = c.cogs;
        line.cogsUnknownQty = c.unknownQty;
        await db.products.update(p.id, { qty: c.qty, stockValue: c.stockValue, unknownCostQty: c.unknownCostQty, updatedAt: nowISO() });
        await addMovement(db, {
          at: date,
          inventoryId: inv.id,
          productId: p.id,
          unitId: null,
          type: 'sale',
          qtyDelta: -a.quantity,
          costDelta: -c.cogs,
          unknownDelta: -c.unknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: sale.id,
          notes: '',
        });
      }
      await db.saleLines.add(line);
      createdLines.push(line);
    }

    // 4) Pago inicial
    if (initialPayment > 0) {
      await db.payments.add({
        id: newId(),
        saleId: sale.id,
        inventoryId: inv.id,
        kind: 'payment',
        date,
        amount: initialPayment,
        method: sale.paymentMethod,
        notes: 'Pago al registrar la venta',
        createdAt: nowISO(),
      });
      await addPaymentFeeExpense(db, sale, { date, method: sale.paymentMethod, amount: initialPayment, fee: input.initialPaymentFee });
    }

    // 5) Gastos de la venta (operativos, vinculados a la venta)
    for (const c of costs) {
      await db.expenses.add({
        id: newId(),
        date,
        amount: c.amount,
        category: cleanStr(c.category, 40),
        notes: cleanStr(c.notes ?? '', 300),
        treatment: 'operating',
        inventoryId: inv.id,
        saleId: sale.id,
        purchaseId: null,
        unitId: null,
        productId: null,
        claimId: null,
        repairId: null,
        status: 'active',
        createdAt: nowISO(),
      });
    }

    // 6) Garantía al cliente (opcional)
    if (input.warranty) {
      for (const l of createdLines) {
        const w = buildWarranty({
          type: 'customer',
          inventoryId: inv.id,
          startDate: date,
          durationValue: input.warranty.durationValue,
          durationUnit: input.warranty.durationUnit,
          conditions: input.warranty.conditions,
          saleId: sale.id,
          saleLineId: l.id,
          unitId: l.unitId,
          productId: l.productId,
          customerId: sale.customerId,
        });
        await db.warranties.add(w);
      }
    }

    await logHistory(db, {
      entityType: 'sale',
      entityId: sale.id,
      inventoryId: inv.id,
      action: 'create',
      summary: `Venta registrada: ${atoms.reduce((a, x) => a + x.quantity, 0)} unidad(es), total ${total}`,
    });
    return sale;
  });
}

/* ---------------- Pagos ---------------- */

export async function addPayment(
  db: AppDB,
  input: { opId?: string; saleId: ID; amount: Money; date: ISODate; method?: string; notes?: string; fee?: Money | null },
): Promise<void> {
  const amount = assertMoney(input.amount, 'amount', 'Valor del pago', false);
  const date = assertDate(input.date, 'date', 'Fecha del pago');
  await tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return;
    const sale = await db.sales.get(input.saleId);
    if (!sale) fail('not_found', 'La venta no existe.');
    if (sale.status === 'voided') fail('voided', 'La venta está anulada.');
    if (Date.parse(date) < Date.parse(sale.date) - 60_000)
      fail('incoherent_date', 'La fecha del pago no puede ser anterior a la venta.', 'date');
    const bal = await getSaleBalance(db, sale.id);
    if (amount > bal.pending)
      fail('overpayment', `El pago supera el saldo pendiente (${bal.pending}).`, 'amount');
    await db.payments.add({
      id: newId(),
      saleId: sale.id,
      inventoryId: sale.inventoryId,
      kind: 'payment',
      date,
      amount,
      method: cleanStr(input.method ?? '', 40),
      notes: cleanStr(input.notes ?? '', 300),
      createdAt: nowISO(),
    });
    await addPaymentFeeExpense(db, sale, { date, method: cleanStr(input.method ?? '', 40), amount, fee: input.fee });
    await logHistory(db, {
      entityType: 'sale',
      entityId: sale.id,
      inventoryId: sale.inventoryId,
      action: 'payment',
      summary: `Pago registrado: ${amount}`,
    });
  });
}

/** Reembolso independiente (p. ej. devolver un saldo a favor del cliente). */
export async function addRefund(
  db: AppDB,
  input: { opId?: string; saleId: ID; amount: Money; date: ISODate; method?: string; notes?: string },
): Promise<void> {
  const amount = assertMoney(input.amount, 'amount', 'Valor del reembolso', false);
  const date = assertDate(input.date, 'date', 'Fecha del reembolso');
  await tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return;
    const sale = await db.sales.get(input.saleId);
    if (!sale) fail('not_found', 'La venta no existe.');
    if (sale.status === 'voided') fail('voided', 'La venta está anulada.');
    const bal = await getSaleBalance(db, sale.id);
    if (amount > bal.collected) fail('refund_too_high', `El reembolso supera lo cobrado (${bal.collected}).`, 'amount');
    await db.payments.add({
      id: newId(),
      saleId: sale.id,
      inventoryId: sale.inventoryId,
      kind: 'refund',
      date,
      amount,
      method: cleanStr(input.method ?? '', 40),
      notes: cleanStr(input.notes ?? '', 300),
      createdAt: nowISO(),
    });
    await logHistory(db, {
      entityType: 'sale',
      entityId: sale.id,
      inventoryId: sale.inventoryId,
      action: 'refund',
      summary: `Reembolso registrado: ${amount}`,
    });
  });
}

/* ---------------- Devoluciones ---------------- */

export interface ReturnInput {
  opId: string;
  saleId: ID;
  date: ISODate;
  reason: string;
  refundAmount: Money;
  notes?: string;
  lines: { saleLineId: ID; quantity: number; destination: ReturnDestination }[];
}

/** Calcula qué parte del ingreso y del costo de una línea corresponde a `q` unidades devueltas. */
export function returnPortion(l: SaleLine, q: number): { amount: Money; cogs: Money; unknownQty: number } {
  const remaining = l.quantity - l.returnedQty;
  const amount = q === remaining ? l.netAmount - l.returnedAmount : Math.round((l.netAmount * q) / l.quantity);
  const remainingUnknown = l.cogsUnknownQty - l.returnedUnknownQty;
  const unknownQty = Math.min(q, remainingUnknown);
  const knownQ = q - unknownQty;
  const knownTotal = l.quantity - l.cogsUnknownQty;
  const remainingKnown = knownTotal - (l.returnedQty - l.returnedUnknownQty);
  let cogs = 0;
  if (knownQ > 0) cogs = knownQ === remainingKnown ? l.cogs - l.returnedCogs : Math.round((l.cogs * knownQ) / knownTotal);
  return { amount, cogs, unknownQty };
}

/**
 * Registra una devolución como operación NUEVA relacionada con la venta (la venta original se conserva).
 * Destino de lo devuelto: disponible, en revisión o dañado. Si un producto por cantidad vuelve dañado,
 * su costo se reconoce como pérdida (baja).
 */
export async function registerReturn(db: AppDB, input: ReturnInput): Promise<SaleReturn> {
  if (!input.opId) fail('invalid', 'Falta el identificador de la operación.');
  const date = assertDate(input.date, 'date', 'Fecha de devolución');
  const refundAmount = assertMoney(input.refundAmount, 'refundAmount', 'Reembolso');
  if (!input.lines?.length) fail('required', 'Elige lo que se devuelve.', 'lines');
  return tx(db, async () => {
    const existing = await db.returns.where('opId').equals(input.opId).first();
    if (existing) return existing;
    const sale = await db.sales.get(input.saleId);
    if (!sale) fail('not_found', 'La venta no existe.');
    if (sale.status === 'voided') fail('voided', 'La venta está anulada; no admite devoluciones.');
    if (Date.parse(date) < Date.parse(sale.date) - 60_000)
      fail('incoherent_date', 'La fecha de devolución no puede ser anterior a la venta.', 'date');
    const balBefore = await getSaleBalance(db, sale.id);
    if (refundAmount > balBefore.collected)
      fail('refund_too_high', `El reembolso no puede superar lo cobrado (${balBefore.collected}).`, 'refundAmount');

    const retLines: ReturnLine[] = [];
    const seen = new Set<ID>();
    for (const rl of input.lines) {
      const q = assertQty(rl.quantity);
      if (seen.has(rl.saleLineId)) fail('duplicate', 'Hay una línea repetida en la devolución.');
      seen.add(rl.saleLineId);
      const l = await db.saleLines.get(rl.saleLineId);
      if (!l || l.saleId !== sale.id) fail('not_found', 'La línea no pertenece a esta venta.');
      if (q > l.quantity - l.returnedQty)
        fail('too_many', `Solo quedan ${l.quantity - l.returnedQty} por devolver en esa línea.`, 'quantity');
      if (!['available', 'in_review', 'damaged'].includes(rl.destination)) fail('invalid', 'Destino no válido.');
      const p = (await db.products.get(l.productId))!;
      if (p.tracking === 'quantity' && rl.destination === 'in_review')
        fail('invalid', `"${p.name}" se controla por cantidad: elige "disponible" o "dañado".`);
      const portion = returnPortion(l, q);
      retLines.push({ saleLineId: l.id, unitId: l.unitId, quantity: q, destination: rl.destination, ...portion });

      await db.saleLines.update(l.id, {
        returnedQty: l.returnedQty + q,
        returnedAmount: l.returnedAmount + portion.amount,
        returnedCogs: l.returnedCogs + portion.cogs,
        returnedUnknownQty: l.returnedUnknownQty + portion.unknownQty,
      });

      if (l.unitId) {
        const u = (await db.units.get(l.unitId))!;
        if (u.status !== 'sold' || u.saleId !== sale.id)
          fail('inconsistent', `La unidad ${u.code} no figura como vendida en esta venta.`);
        await db.units.update(u.id, {
          status: rl.destination,
          saleId: null,
          saleLineId: null,
          availableSince: date,
          cycle: u.cycle + 1,
          updatedAt: nowISO(),
        });
        await addMovement(db, {
          at: date,
          inventoryId: sale.inventoryId,
          productId: l.productId,
          unitId: u.id,
          type: 'return',
          qtyDelta: 1,
          costDelta: portion.cogs,
          unknownDelta: portion.unknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: sale.id,
          notes: cleanStr(input.reason, 200),
        });
        await logHistory(db, {
          entityType: 'unit',
          entityId: u.id,
          inventoryId: sale.inventoryId,
          action: 'return',
          summary: `Devuelta (${u.code}); inicia ciclo ${u.cycle + 1} como "${rl.destination === 'available' ? 'disponible' : rl.destination === 'in_review' ? 'en revisión' : 'dañada'}"`,
        });
        const ws = await db.warranties.where('saleId').equals(sale.id).filter((w) => w.saleLineId === l.id).toArray();
        for (const w of ws) await db.warranties.update(w.id, { status: 'cancelled', updatedAt: nowISO() });
      } else {
        const fresh = (await db.products.get(p.id))!;
        await db.products.update(p.id, {
          qty: fresh.qty + q,
          stockValue: fresh.stockValue + portion.cogs,
          unknownCostQty: fresh.unknownCostQty + portion.unknownQty,
          updatedAt: nowISO(),
        });
        await addMovement(db, {
          at: date,
          inventoryId: sale.inventoryId,
          productId: p.id,
          unitId: null,
          type: 'return',
          qtyDelta: q,
          costDelta: portion.cogs,
          unknownDelta: portion.unknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: sale.id,
          notes: cleanStr(input.reason, 200),
        });
        if (rl.destination === 'damaged') {
          const after = (await db.products.get(p.id))!;
          await db.products.update(p.id, {
            qty: after.qty - q,
            stockValue: after.stockValue - portion.cogs,
            unknownCostQty: after.unknownCostQty - portion.unknownQty,
            updatedAt: nowISO(),
          });
          await addMovement(db, {
            at: date,
            inventoryId: sale.inventoryId,
            productId: p.id,
            unitId: null,
            type: 'adjust_out',
            qtyDelta: -q,
            costDelta: -portion.cogs,
            unknownDelta: -portion.unknownQty,
            writeOff: portion.cogs,
            refType: 'return',
            refId: sale.id,
            notes: 'Devuelto dañado: baja de inventario',
          });
        }
      }
    }

    const ret: SaleReturn = {
      id: newId(),
      opId: input.opId,
      saleId: sale.id,
      inventoryId: sale.inventoryId,
      date,
      reason: cleanStr(input.reason, 300),
      refundAmount,
      lines: retLines,
      notes: cleanStr(input.notes ?? '', 1000),
      createdAt: nowISO(),
    };
    await db.returns.add(ret);
    if (refundAmount > 0) {
      await db.payments.add({
        id: newId(),
        saleId: sale.id,
        inventoryId: sale.inventoryId,
        kind: 'refund',
        date,
        amount: refundAmount,
        method: '',
        notes: 'Reembolso por devolución',
        createdAt: nowISO(),
      });
    }
    await logHistory(db, {
      entityType: 'sale',
      entityId: sale.id,
      inventoryId: sale.inventoryId,
      action: 'return',
      summary: `Devolución registrada: ${retLines.reduce((a, x) => a + x.quantity, 0)} unidad(es), reembolso ${refundAmount}`,
    });
    return ret;
  });
}

/* ---------------- Anulación ---------------- */

/**
 * Anula una venta registrada por error: se conserva marcada como anulada, lo vendido vuelve
 * a existencia (continuando su ciclo original) y deja de contar en ingresos, costos y cobros.
 * Si la venta tuvo devoluciones, no se puede anular (use devoluciones).
 */
export async function voidSale(db: AppDB, saleId: ID, reason: string, opts: { voidExpenses?: boolean } = {}): Promise<void> {
  const r = cleanStr(reason, 300);
  if (!r) fail('required', 'Escribe el motivo de la anulación.', 'reason');
  await tx(db, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('not_found', 'La venta no existe.');
    if (sale.status === 'voided') return;
    if ((await db.returns.where('saleId').equals(saleId).count()) > 0)
      fail('has_returns', 'La venta tiene devoluciones registradas; no se puede anular. Registra una devolución por lo restante.');
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    const now = nowISO();
    for (const l of lines) {
      if (l.unitId) {
        const u = (await db.units.get(l.unitId))!;
        if (u.status !== 'sold' || u.saleId !== saleId) fail('inconsistent', `La unidad ${u.code} ya no figura en esta venta.`);
        await db.units.update(u.id, { status: 'available', saleId: null, saleLineId: null, availableSince: l.cycleStart, updatedAt: now });
        await addMovement(db, {
          at: now,
          inventoryId: sale.inventoryId,
          productId: l.productId,
          unitId: u.id,
          type: 'void_sale',
          qtyDelta: 1,
          costDelta: l.cogs,
          unknownDelta: l.cogsUnknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: saleId,
          notes: r,
        });
        await logHistory(db, {
          entityType: 'unit',
          entityId: u.id,
          inventoryId: sale.inventoryId,
          action: 'void_sale',
          summary: `Venta anulada; la unidad ${u.code} vuelve a estar disponible`,
        });
      } else {
        const p = (await db.products.get(l.productId))!;
        await db.products.update(p.id, {
          qty: p.qty + l.quantity,
          stockValue: p.stockValue + l.cogs,
          unknownCostQty: p.unknownCostQty + l.cogsUnknownQty,
          updatedAt: now,
        });
        await addMovement(db, {
          at: now,
          inventoryId: sale.inventoryId,
          productId: p.id,
          unitId: null,
          type: 'void_sale',
          qtyDelta: l.quantity,
          costDelta: l.cogs,
          unknownDelta: l.cogsUnknownQty,
          writeOff: 0,
          refType: 'sale',
          refId: saleId,
          notes: r,
        });
      }
    }
    if (opts.voidExpenses !== false) {
      const exps = await db.expenses.where('saleId').equals(saleId).toArray();
      for (const e of exps) await db.expenses.update(e.id, { status: 'voided' });
    }
    const ws = await db.warranties.where('saleId').equals(saleId).toArray();
    for (const w of ws) await db.warranties.update(w.id, { status: 'cancelled', updatedAt: now });
    await db.sales.update(saleId, { status: 'voided', voidedAt: now, voidReason: r });
    await logHistory(db, {
      entityType: 'sale',
      entityId: saleId,
      inventoryId: sale.inventoryId,
      action: 'void',
      summary: `Venta anulada. Motivo: ${r}`,
    });
  });
}

export async function updateSaleInfo(
  db: AppDB,
  saleId: ID,
  patch: { notes?: string; customerId?: ID | null; paymentMethod?: string; deliveryStatus?: DeliveryStatus },
): Promise<void> {
  await tx(db, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('not_found', 'La venta no existe.');
    const upd: Partial<Sale> = {};
    if (patch.notes !== undefined) upd.notes = cleanStr(patch.notes, 1000);
    if (patch.paymentMethod !== undefined) upd.paymentMethod = cleanStr(patch.paymentMethod, 40);
    if (patch.deliveryStatus !== undefined) {
      if (!['na', 'pending', 'delivered'].includes(patch.deliveryStatus)) fail('invalid', 'Estado de entrega no válido.');
      upd.deliveryStatus = patch.deliveryStatus;
    }
    if (patch.customerId !== undefined) {
      if (patch.customerId && !(await db.customers.get(patch.customerId))) fail('not_found', 'El comprador no existe.');
      upd.customerId = patch.customerId;
      const ws = await db.warranties.where('saleId').equals(saleId).toArray();
      for (const w of ws) await db.warranties.update(w.id, { customerId: patch.customerId });
    }
    await db.sales.update(saleId, upd);
    await logHistory(db, {
      entityType: 'sale',
      entityId: saleId,
      inventoryId: sale.inventoryId,
      action: 'update',
      summary: 'Datos de la venta editados',
    });
  });
}
