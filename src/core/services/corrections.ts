import type { AppDB } from '../db';
import type { ID, ISODate, Lot, LotTake, Money, Movement, Product, Purchase, PurchaseLine, SaleLine, Unit } from '../types';
import { allocate, assertMoney, assertQty, cleanStr, fail, formatDate, nowISO } from '../util';
import { addMovement, logHistory, requireInventory, requireProduct, requireUnit } from './base';
import { claimOp, tx } from './stock';
import { previewPurchase } from './purchases';
import { usesLots } from './lots';
import { insertUnit, setUnitBaseCost } from './products';

/**
 * CORRECCIONES (v2.3): arreglar errores de digitación (cantidad, costo) sin borrar ni volver a crear nada.
 *
 * Reglas:
 * - Nunca se modifican movimientos pasados: se agregan movimientos de corrección (marcados `correction`), con la
 *   fecha del hecho que corrigen. Así el valor del inventario, el capital y su explicación siguen cuadrando
 *   (crecimiento = ganancia + ajustes de caja + mercancía encontrada) en cualquier fecha.
 * - Compra: el valor pagado de cada línea se corrige en la compra (subtotal, total y deuda). Si solo cambia la
 *   cantidad, por defecto se conserva lo pagado y se recalcula el costo por unidad (lo decide la pantalla).
 * - Lo que ya se vendió de esa mercancía se recalcula con el costo correcto: cambia el costo de esas ventas y su
 *   ganancia. Lo dado de baja también (pérdida corregida).
 * - Todo queda en el historial como "Corrección".
 */

type Write = () => Promise<unknown>;
type NewMovement = Omit<Movement, 'id' | 'seq' | 'createdAt'>;

export interface SaleEffect {
  saleId: ID;
  saleLineId: ID;
  date: ISODate;
  qty: number;
  oldCogs: Money;
  newCogs: Money;
  /** El costo de esa venta era desconocido y ahora se completa. */
  completed: boolean;
}

export interface CorrectionEffect {
  kind: 'lot' | 'average' | 'units' | 'unit';
  productId: ID;
  productName: string;
  lineId?: ID;
  lotId?: ID;
  unitId?: ID;
  /** Cantidad que entró (antes y después). */
  oldQty: number;
  newQty: number;
  /** Costo total de lo que entró (null = desconocido). */
  oldTotal: Money | null;
  newTotal: Money | null;
  oldUnitCost: Money | null;
  newUnitCost: Money | null;
  /** Cambio en las existencias y en su valor a costo. */
  stockQtyDelta: number;
  stockValueDelta: Money;
  sales: SaleEffect[];
  writeOffDelta: Money;
  /** Cambio en la ganancia acumulada (negativo = baja). */
  profitDelta: Money;
  removedUnits: string[];
  addedUnits: number;
}

export interface PurchaseCorrectionPreview {
  purchaseId: ID;
  oldSubtotal: Money;
  newSubtotal: Money;
  oldExtraCosts: Money;
  newExtraCosts: Money;
  oldTotal: Money;
  newTotal: Money;
  debt: { id: ID; oldPrincipal: Money; newPrincipal: Money; paid: Money } | null;
  lines: CorrectionEffect[];
  profitDelta: Money;
  salesAffected: number;
  changed: boolean;
}

export interface PurchaseLineCorrection {
  lineId: ID;
  /** Productos por cantidad: cantidad correcta. */
  quantity?: number;
  /** Total pagado por la línea (no por unidad). Sin esto se conserva. */
  price?: Money;
  /** Productos por unidad: equipos que no venían en la compra (deben seguir en existencia). */
  removeUnitIds?: ID[];
  /** Productos por unidad: equipos que faltó registrar. */
  addUnits?: number;
}

export interface PurchaseCorrectionInput {
  opId?: string;
  extraCosts?: Money;
  lines: PurchaseLineCorrection[];
  reason?: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const perUnit = (total: Money | null, qty: number): Money | null => (total === null || qty <= 0 ? null : Math.round(total / qty));
const IN_STOCK: Unit['status'][] = ['available', 'in_review', 'damaged'];

function emptyEffect(kind: CorrectionEffect['kind'], p: Product): CorrectionEffect {
  return {
    kind,
    productId: p.id,
    productName: p.name,
    oldQty: 0,
    newQty: 0,
    oldTotal: null,
    newTotal: null,
    oldUnitCost: null,
    newUnitCost: null,
    stockQtyDelta: 0,
    stockValueDelta: 0,
    sales: [],
    writeOffDelta: 0,
    profitDelta: 0,
    removedUnits: [],
    addedUnits: 0,
  };
}

/* ======================= Lotes ======================= */

interface LotChange {
  lot: Lot;
  product: Product;
  oldQtyIn: number;
  oldTotal: Money | null;
  newQtyIn: number;
  newTotal: Money | null;
  /** Movimiento de corrección de la entrada (compra, stock existente o ajuste). */
  entry: (qtyDelta: number, costDelta: Money, unknownDelta: number) => NewMovement;
}

/**
 * Corrige la entrada de un lote y recalcula lo que ya salió de él:
 * - ventas activas que sacaron de este lote → cambia su costo (y su ganancia);
 * - lo que salió por bajas → cambia la pérdida;
 * - lo que queda → cambia su cantidad y su valor.
 */
async function planLot(db: AppDB, c: LotChange, writes: Write[], now: ISODate): Promise<CorrectionEffect> {
  const { lot, product: p } = c;
  const dq = c.newQtyIn - c.oldQtyIn;
  const out = lot.qtyIn - lot.qty;
  const newRemQty = lot.qty + dq;
  if (newRemQty < 0)
    fail('below_outflows', `De "${p.name}" ya salieron ${out} unidad(es) de esta entrada: la cantidad no puede ser menor que ${out}.`, 'quantity');
  const oldKnown = c.oldTotal !== null;
  const newKnown = c.newTotal !== null;
  if (oldKnown && !newKnown) fail('invalid', 'Un costo conocido no puede volver a quedar como desconocido.', 'unitCost');
  const completing = !oldKnown && newKnown;

  // Ventas activas que sacaron de este lote
  const lines = await db.saleLines.where('productId').equals(p.id).toArray();
  const sales = new Map((await db.sales.bulkGet([...new Set(lines.map((l) => l.saleId))])).filter((s) => !!s).map((s) => [s!.id, s!]));
  const hits: { line: SaleLine; take: LotTake; date: ISODate }[] = [];
  for (const l of lines) {
    const s = sales.get(l.saleId);
    if (!s || s.status !== 'active') continue;
    const take = (l.lotAllocations ?? []).find((t) => t.lotId === lot.id);
    if (!take) continue;
    if (l.returnedQty > 0)
      fail('has_returns', `La venta del ${formatDate(s.date)} sacó de esta entrada y tiene una devolución: no se puede recalcular su costo. Registra un ajuste de conteo en su lugar.`);
    hits.push({ line: l, take, date: s.date });
  }
  hits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const soldQty = sum(hits.map((h) => h.take.qty));
  const otherQty = out - soldQty;
  if (otherQty < 0) fail('inconsistent', `Las salidas de esta entrada de "${p.name}" no cuadran. Revisa la integridad de los datos en Respaldo.`);
  if (otherQty > 0 && lot.notes.includes('ya se vendió una parte'))
    fail('unknown_outflows', `Parte de esta entrada de "${p.name}" salió antes de separar por lotes y no se sabe en qué venta: no se puede recalcular. Registra un ajuste de conteo en su lugar.`);

  // Valor de lo que queda y diferencia que va a lo que ya salió
  let newRemValue = lot.costKnown ? lot.value : 0;
  let dOut = 0;
  if (newKnown) {
    const newU = c.newTotal! / c.newQtyIn;
    if (!oldKnown) newRemValue = newRemQty === 0 ? 0 : Math.round(newRemQty * newU);
    else {
      const oldU = c.oldTotal! / c.oldQtyIn;
      newRemValue = newRemQty === 0 ? 0 : lot.value + Math.round(newRemQty * newU - lot.qty * oldU);
    }
    if (newRemValue < 0) fail('negative_cost', 'Con ese costo, lo que queda en existencia quedaría con valor negativo. Revisa los valores.', 'price');
    dOut = c.newTotal! - (c.oldTotal ?? 0) - (newRemValue - (lot.costKnown ? lot.value : 0));
  }
  const weights = hits.map((h) => h.take.qty);
  if (otherQty > 0) weights.push(otherQty);
  if (!weights.length && dOut !== 0) {
    newRemValue += dOut;
    dOut = 0;
  }
  const parts = weights.length && newKnown ? allocate(dOut, weights) : weights.map(() => 0);

  const effect = emptyEffect('lot', p);
  Object.assign(effect, {
    lotId: lot.id,
    oldQty: c.oldQtyIn,
    newQty: c.newQtyIn,
    oldTotal: c.oldTotal,
    newTotal: c.newTotal,
    oldUnitCost: perUnit(c.oldTotal, c.oldQtyIn),
    newUnitCost: perUnit(c.newTotal, c.newQtyIn),
    stockQtyDelta: dq,
    stockValueDelta: newRemValue - (lot.costKnown ? lot.value : 0),
  });

  if (newKnown) {
    hits.forEach((h, k) => {
      const part = parts[k];
      const newTakeCogs = (completing ? 0 : h.take.cogs) + part;
      if (newTakeCogs < 0) fail('negative_cost', 'Con ese costo, una venta quedaría con costo negativo. Revisa los valores.', 'price');
      if (part === 0 && !completing) return;
      effect.sales.push({
        saleId: h.line.saleId,
        saleLineId: h.line.id,
        date: h.date,
        qty: h.take.qty,
        oldCogs: h.line.cogs,
        newCogs: h.line.cogs + part,
        completed: completing,
      });
      writes.push(async () => {
        const l = (await db.saleLines.get(h.line.id))!;
        const allocs = (l.lotAllocations ?? []).map((t) => (t.lotId === lot.id ? { ...t, cogs: newTakeCogs, unknown: false } : t));
        await db.saleLines.update(l.id, {
          lotAllocations: allocs,
          cogs: l.cogs + part,
          cogsUnknownQty: l.cogsUnknownQty - (completing ? h.take.qty : 0),
        });
        await addMovement(db, {
          at: h.date,
          inventoryId: p.inventoryId,
          productId: p.id,
          unitId: null,
          type: 'sale',
          qtyDelta: 0,
          costDelta: -part,
          unknownDelta: completing ? h.take.qty : 0,
          writeOff: 0,
          refType: 'sale',
          refId: h.line.saleId,
          notes: completing ? 'Corrección: costo completado' : 'Corrección de costo',
          correction: true,
        });
      });
    });
    if (otherQty > 0) {
      const partW = parts[parts.length - 1];
      effect.writeOffDelta = partW;
      if (partW !== 0 || completing)
        writes.push(() =>
          addMovement(db, {
            at: now,
            inventoryId: p.inventoryId,
            productId: p.id,
            unitId: null,
            type: 'adjust_out',
            qtyDelta: 0,
            costDelta: -partW,
            unknownDelta: completing ? otherQty : 0,
            writeOff: partW,
            refType: 'adjust',
            refId: null,
            notes: 'Corrección del costo de lo dado de baja',
            correction: true,
          }),
        );
    }
  }
  effect.profitDelta = -(sum(effect.sales.map((s) => s.newCogs - s.oldCogs)) + effect.writeOffDelta);

  const entryCost = newKnown ? c.newTotal! - (c.oldTotal ?? 0) : 0;
  const entryUnknown = completing ? -c.oldQtyIn : !newKnown ? dq : 0;
  const unknownChange = completing ? -lot.qty : !newKnown ? dq : 0;
  writes.push(async () => {
    if (dq !== 0 || entryCost !== 0 || entryUnknown !== 0) await addMovement(db, c.entry(dq, entryCost, entryUnknown));
    await db.lots.update(lot.id, {
      qtyIn: c.newQtyIn,
      valueIn: newKnown ? c.newTotal! : 0,
      qty: newRemQty,
      value: newKnown ? newRemValue : 0,
      costKnown: newKnown,
      correctedAt: now,
    });
    const fresh = (await db.products.get(p.id))!;
    await db.products.update(p.id, {
      qty: fresh.qty + dq,
      stockValue: fresh.stockValue + effect.stockValueDelta,
      unknownCostQty: fresh.unknownCostQty + unknownChange,
      updatedAt: now,
    });
  });
  return effect;
}

/* ======================= Costo promedio ======================= */

async function planAverageLine(
  db: AppDB,
  p: Product,
  purchase: Purchase,
  line: PurchaseLine,
  newQty: number,
  newTotal: Money,
  writes: Write[],
  now: ISODate,
): Promise<CorrectionEffect> {
  const moves = await db.movements.where('productId').equals(p.id).toArray();
  const base = moves.filter((m) => m.type === 'purchase' && m.refId === purchase.id && !m.correction && m.unitId === null);
  const minSeq = base.length ? Math.min(...base.map((m) => m.seq)) : 0;
  if (moves.some((m) => m.seq > minSeq && m.qtyDelta < 0 && !(m.correction && m.refId === purchase.id)))
    fail(
      'later_outflows',
      `"${p.name}" usa costo promedio y ya tuvo salidas después de esta compra: no se puede recalcular. Activa "Separar por precio de compra" en el producto o registra un ajuste.`,
    );
  const dq = newQty - line.quantity;
  const dv = newTotal - line.totalCost;
  if (p.qty + dq < p.unknownCostQty || p.stockValue + dv < 0)
    fail('below_outflows', `Con esa corrección las existencias de "${p.name}" quedarían negativas.`, 'quantity');
  const effect = emptyEffect('average', p);
  Object.assign(effect, {
    lineId: line.id,
    oldQty: line.quantity,
    newQty,
    oldTotal: line.totalCost,
    newTotal,
    oldUnitCost: perUnit(line.totalCost, line.quantity),
    newUnitCost: perUnit(newTotal, newQty),
    stockQtyDelta: dq,
    stockValueDelta: dv,
  });
  writes.push(async () => {
    await addMovement(db, {
      at: purchase.date,
      inventoryId: p.inventoryId,
      productId: p.id,
      unitId: null,
      type: 'purchase',
      qtyDelta: dq,
      costDelta: dv,
      unknownDelta: 0,
      writeOff: 0,
      refType: 'purchase',
      refId: purchase.id,
      notes: 'Corrección de la compra',
      correction: true,
    });
    const fresh = (await db.products.get(p.id))!;
    await db.products.update(p.id, { qty: fresh.qty + dq, stockValue: fresh.stockValue + dv, updatedAt: now });
  });
  return effect;
}

/* ======================= Unidades ======================= */

/** Cambia el costo base de una unidad y arrastra el cambio a su venta (o a su baja). */
async function planUnitDelta(
  db: AppDB,
  u: Unit,
  newCost: Money,
  entry: (delta: Money) => NewMovement,
  effect: CorrectionEffect,
  writes: Write[],
  now: ISODate,
): Promise<void> {
  const delta = newCost - (u.baseCost ?? 0);
  if (delta === 0) return;
  writes.push(async () => {
    await db.units.update(u.id, { baseCost: newCost, updatedAt: now });
    await addMovement(db, entry(delta));
  });
  if (IN_STOCK.includes(u.status)) {
    effect.stockValueDelta += delta;
    return;
  }
  if (u.status === 'sold') {
    const l = u.saleLineId ? await db.saleLines.get(u.saleLineId) : undefined;
    const s = l ? await db.sales.get(l.saleId) : undefined;
    if (!l || !s) fail('inconsistent', `La venta de ${u.code} no se encontró. Revisa la integridad de los datos en Respaldo.`);
    effect.sales.push({ saleId: s.id, saleLineId: l.id, date: s.date, qty: 1, oldCogs: l.cogs, newCogs: l.cogs + delta, completed: false });
    writes.push(async () => {
      const fresh = (await db.saleLines.get(l.id))!;
      await db.saleLines.update(l.id, { cogs: fresh.cogs + delta });
      await addMovement(db, {
        at: s.date,
        inventoryId: u.inventoryId,
        productId: u.productId,
        unitId: u.id,
        type: 'sale',
        qtyDelta: 0,
        costDelta: -delta,
        unknownDelta: 0,
        writeOff: 0,
        refType: 'sale',
        refId: s.id,
        notes: `Corrección de costo (${u.code})`,
        correction: true,
      });
    });
    effect.profitDelta -= delta;
    return;
  }
  // Dada de baja: la pérdida cambia
  effect.writeOffDelta += delta;
  effect.profitDelta -= delta;
  writes.push(() =>
    addMovement(db, {
      at: now,
      inventoryId: u.inventoryId,
      productId: u.productId,
      unitId: u.id,
      type: 'adjust_out',
      qtyDelta: 0,
      costDelta: -delta,
      unknownDelta: 0,
      writeOff: delta,
      refType: 'writeoff',
      refId: null,
      notes: `Corrección del costo de la baja (${u.code})`,
      correction: true,
    }),
  );
}

async function planUnitLine(
  db: AppDB,
  p: Product,
  purchase: Purchase,
  line: PurchaseLine,
  remove: Set<ID>,
  addCount: number,
  newTotal: Money,
  writes: Write[],
  now: ISODate,
): Promise<{ effect: CorrectionEffect; unitIds: () => ID[] }> {
  const units = (await db.units.bulkGet(line.unitIds)).map((u, i) => {
    if (!u) fail('inconsistent', `Falta una unidad de la compra (${line.unitIds[i]}).`);
    return u;
  });
  for (const id of remove) if (!line.unitIds.includes(id)) fail('not_found', 'Ese equipo no pertenece a esta línea de la compra.', 'removeUnitIds');
  const keep = units.filter((u) => !remove.has(u.id));
  const removed = units.filter((u) => remove.has(u.id));
  for (const u of removed) {
    if (!IN_STOCK.includes(u.status) || u.cycle > 1)
      fail('not_in_stock', `${u.code} ya se vendió o salió del inventario: no se puede quitar de la compra.`, 'removeUnitIds');
    if (u.extraCost > 0) fail('has_extra_cost', `${u.code} tiene costos agregados (reparaciones…): anúlalos antes de quitarlo de la compra.`, 'removeUnitIds');
  }
  const newQty = keep.length + addCount;
  if (newQty < 1) fail('invalid', 'La línea debe quedar con al menos una unidad. Si la compra completa fue un error, anúlala.', 'quantity');
  const costs = allocate(newTotal, Array(newQty).fill(1));
  const effect = emptyEffect('units', p);
  Object.assign(effect, {
    lineId: line.id,
    oldQty: line.quantity,
    newQty,
    oldTotal: line.totalCost,
    newTotal,
    oldUnitCost: perUnit(line.totalCost, line.quantity),
    newUnitCost: perUnit(newTotal, newQty),
    stockQtyDelta: addCount - removed.length,
    removedUnits: removed.map((u) => u.code),
    addedUnits: addCount,
  });
  for (let i = 0; i < keep.length; i++) {
    const u = keep[i];
    await planUnitDelta(
      db,
      u,
      costs[i],
      (delta) => ({
        at: purchase.date,
        inventoryId: u.inventoryId,
        productId: u.productId,
        unitId: u.id,
        type: 'purchase',
        qtyDelta: 0,
        costDelta: delta,
        unknownDelta: 0,
        writeOff: 0,
        refType: 'purchase',
        refId: purchase.id,
        notes: `Corrección de la compra (${u.code})`,
        correction: true,
      }),
      effect,
      writes,
      now,
    );
  }
  const finalIds = keep.map((u) => u.id);
  for (const u of removed) {
    effect.stockValueDelta -= u.baseCost ?? 0;
    writes.push(async () => {
      await db.units.update(u.id, { status: 'archived', archivedReason: 'Corrección: no venía en la compra', updatedAt: now });
      await addMovement(db, {
        at: purchase.date,
        inventoryId: u.inventoryId,
        productId: u.productId,
        unitId: u.id,
        type: 'void_purchase',
        qtyDelta: -1,
        costDelta: -(u.baseCost ?? 0),
        unknownDelta: 0,
        writeOff: 0,
        refType: 'purchase',
        refId: purchase.id,
        notes: 'Corrección: no venía en la compra',
        correction: true,
      });
    });
  }
  for (let k = 0; k < addCount; k++) {
    const cost = costs[keep.length + k];
    effect.stockValueDelta += cost;
    writes.push(async () => {
      const fresh = (await db.products.get(p.id))!;
      const u = await insertUnit(db, fresh, {
        acquiredAt: purchase.date,
        baseCost: cost,
        source: 'purchase',
        purchaseId: purchase.id,
        purchaseLineId: line.id,
        supplierId: purchase.supplierId,
      });
      finalIds.push(u.id);
      await addMovement(db, {
        at: purchase.date,
        inventoryId: u.inventoryId,
        productId: u.productId,
        unitId: u.id,
        type: 'purchase',
        qtyDelta: 1,
        costDelta: cost,
        unknownDelta: 0,
        writeOff: 0,
        refType: 'purchase',
        refId: purchase.id,
        notes: 'Corrección: faltaba en la compra',
        correction: true,
      });
    });
  }
  return { effect, unitIds: () => finalIds };
}

/* ======================= Compras ======================= */

async function planPurchaseCorrection(db: AppDB, purchaseId: ID, input: PurchaseCorrectionInput, now: ISODate) {
  const purchase = await db.purchases.get(purchaseId);
  if (!purchase) fail('not_found', 'La compra no existe.');
  if (purchase.status === 'voided') fail('voided', 'La compra está anulada.');
  await requireInventory(db, purchase.inventoryId);
  const lines = await db.purchaseLines.where('purchaseId').equals(purchaseId).toArray();
  const byId = new Map((input.lines ?? []).map((c) => [c.lineId, c]));
  for (const id of byId.keys()) if (!lines.some((l) => l.id === id)) fail('not_found', 'Esa línea no pertenece a la compra.', 'lines');
  const extraCosts = input.extraCosts === undefined ? purchase.extraCosts : assertMoney(input.extraCosts, 'extraCosts', 'Gastos adicionales');

  const products = new Map<ID, Product>();
  for (const l of lines) if (!products.has(l.productId)) products.set(l.productId, await requireProduct(db, l.productId));

  const plan = lines.map((l) => {
    const c = byId.get(l.id);
    const p = products.get(l.productId)!;
    const price = c?.price === undefined ? l.price : assertMoney(c.price, `lines.${l.id}.price`, 'Precio pagado');
    let quantity = l.quantity;
    const remove = new Set(c?.removeUnitIds ?? []);
    const add = c?.addUnits ?? 0;
    if (p.tracking === 'unit') {
      if (!Number.isInteger(add) || add < 0 || add > 500) fail('invalid', 'Cantidad de equipos a agregar no válida.', 'addUnits');
      quantity = l.unitIds.filter((id) => !remove.has(id)).length + add;
      if (c?.quantity !== undefined && c.quantity !== quantity)
        fail('choose_units', 'Para cambiar la cantidad de equipos, elige cuáles no venían o cuántos faltaron.', 'quantity');
    } else if (c?.quantity !== undefined) quantity = assertQty(c.quantity, 'quantity');
    return { line: l, product: p, price, quantity, remove, add };
  });

  const preview = previewPurchase(
    plan.map((x) => ({ productId: x.product.id, quantity: x.quantity, price: x.price })),
    extraCosts,
    purchase.allocation,
  );
  const writes: Write[] = [];
  const effects: CorrectionEffect[] = [];
  for (let i = 0; i < plan.length; i++) {
    const { line, product: p, price, quantity, remove, add } = plan[i];
    const pv = preview[i];
    const unchanged = quantity === line.quantity && price === line.price && pv.totalCost === line.totalCost && !remove.size && !add;
    if (unchanged) continue;
    let unitIds: () => ID[] = () => line.unitIds;
    let effect: CorrectionEffect;
    if (p.tracking === 'unit') {
      const r = await planUnitLine(db, p, purchase, line, remove, add, pv.totalCost, writes, now);
      effect = r.effect;
      unitIds = r.unitIds;
    } else if (usesLots(p)) {
      const lot = await db.lots
        .where('purchaseId')
        .equals(purchaseId)
        .filter((x) => x.productId === p.id && (x.purchaseLineId === line.id || x.purchaseLineId === null))
        .first();
      if (!lot || lot.qtyIn !== line.quantity)
        fail('lot_mismatch', `No se encontró la entrada de "${p.name}" de esta compra tal como se registró. Registra un ajuste de conteo en su lugar.`);
      effect = await planLot(
        db,
        {
          lot,
          product: p,
          oldQtyIn: line.quantity,
          oldTotal: line.totalCost,
          newQtyIn: quantity,
          newTotal: pv.totalCost,
          entry: (qtyDelta, costDelta, unknownDelta) => ({
            at: purchase.date,
            inventoryId: p.inventoryId,
            productId: p.id,
            unitId: null,
            type: 'purchase',
            qtyDelta,
            costDelta,
            unknownDelta,
            writeOff: 0,
            refType: 'purchase',
            refId: purchase.id,
            notes: 'Corrección de la compra',
            correction: true,
          }),
        },
        writes,
        now,
      );
      effect.lineId = line.id;
    } else effect = await planAverageLine(db, p, purchase, line, quantity, pv.totalCost, writes, now);
    effects.push(effect);
    writes.push(async () => {
      const ids = unitIds();
      await db.purchaseLines.update(line.id, { quantity, price, allocatedExtra: pv.allocatedExtra, totalCost: pv.totalCost, unitIds: ids });
    });
  }

  const newSubtotal = sum(plan.map((x) => x.price));
  const newTotal = newSubtotal + extraCosts;
  let debt: PurchaseCorrectionPreview['debt'] = null;
  if (purchase.debtId && newTotal !== purchase.total) {
    const d = await db.debts.get(purchase.debtId);
    if (d && d.status !== 'voided') {
      const paid = sum((await db.debtPayments.where('debtId').equals(d.id).toArray()).map((x) => x.principal));
      const full = d.principal === purchase.total;
      const newPrincipal = full ? newTotal : Math.min(d.principal, newTotal);
      if (newPrincipal <= 0) fail('invalid', 'La compra quedaría en cero y está pagada con una deuda. Anula la compra si fue un error.', 'price');
      if (newPrincipal < paid)
        fail('debt_paid_more', `Ya abonaste ${paid} a la deuda de esta compra; el nuevo total no puede ser menor. Anula primero esos abonos en Deudas.`, 'price');
      debt = { id: d.id, oldPrincipal: d.principal, newPrincipal, paid };
    }
  }
  const changed = effects.length > 0 || newTotal !== purchase.total || extraCosts !== purchase.extraCosts;
  if (changed)
    writes.push(async () => {
      await db.purchases.update(purchaseId, { subtotal: newSubtotal, extraCosts, total: newTotal, correctedAt: now });
      if (debt && debt.newPrincipal !== debt.oldPrincipal)
        await db.debts.update(debt.id, { principal: debt.newPrincipal, status: debt.paid >= debt.newPrincipal ? 'paid' : 'open', updatedAt: now });
    });

  const result: PurchaseCorrectionPreview = {
    purchaseId,
    oldSubtotal: purchase.subtotal,
    newSubtotal,
    oldExtraCosts: purchase.extraCosts,
    newExtraCosts: extraCosts,
    oldTotal: purchase.total,
    newTotal,
    debt,
    lines: effects,
    profitDelta: sum(effects.map((e) => e.profitDelta)),
    salesAffected: new Set(effects.flatMap((e) => e.sales.map((s) => s.saleId))).size,
    changed,
  };
  return { purchase, result, writes };
}

/** Muestra qué cambiaría al corregir una compra (sin guardar nada). Lanza error si la corrección no es posible. */
export async function previewPurchaseCorrection(db: AppDB, purchaseId: ID, input: PurchaseCorrectionInput): Promise<PurchaseCorrectionPreview> {
  return (await planPurchaseCorrection(db, purchaseId, input, nowISO())).result;
}

/**
 * Corrige cantidades, valores pagados o gastos de una compra ya registrada (errores de digitación).
 * Recalcula lo que ya se vendió o se dio de baja de esa mercancía y ajusta la deuda si la compra se pagó con deuda.
 */
export async function correctPurchase(db: AppDB, purchaseId: ID, input: PurchaseCorrectionInput): Promise<PurchaseCorrectionPreview | null> {
  const reason = cleanStr(input.reason ?? '', 300);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const now = nowISO();
    const { purchase, result, writes } = await planPurchaseCorrection(db, purchaseId, input, now);
    if (!result.changed) return result;
    for (const w of writes) await w();
    const parts: string[] = [];
    for (const e of result.lines) {
      const bits: string[] = [];
      if (e.oldQty !== e.newQty) bits.push(`cantidad ${e.oldQty} → ${e.newQty}`);
      if (e.oldUnitCost !== e.newUnitCost) bits.push(`costo c/u ${e.oldUnitCost ?? '?'} → ${e.newUnitCost ?? '?'}`);
      if (e.removedUnits.length) bits.push(`quitados ${e.removedUnits.join(', ')}`);
      if (e.addedUnits) bits.push(`agregados ${e.addedUnits}`);
      parts.push(`${e.productName}: ${bits.join(', ') || 'reparto de gastos'}`);
    }
    if (result.oldExtraCosts !== result.newExtraCosts) parts.push(`gastos ${result.oldExtraCosts} → ${result.newExtraCosts}`);
    if (result.oldTotal !== result.newTotal) parts.push(`total ${result.oldTotal} → ${result.newTotal}`);
    if (result.salesAffected) parts.push(`${result.salesAffected} venta(s) recalculada(s)`);
    await logHistory(db, {
      entityType: 'purchase',
      entityId: purchaseId,
      inventoryId: purchase.inventoryId,
      action: 'correct',
      summary: `Corrección: ${parts.join('; ')}${reason ? `. Motivo: ${reason}` : ''}`,
    });
    for (const e of result.lines)
      await logHistory(db, {
        entityType: 'product',
        entityId: e.productId,
        inventoryId: purchase.inventoryId,
        action: 'correct',
        summary: `Corrección de la compra del ${formatDate(purchase.date)}: ${e.productName}`,
      });
    return result;
  });
}

/* ======================= Lotes de stock existente y ajustes ======================= */

export interface LotCorrectionInput {
  opId?: string;
  /** Cantidad correcta que entró. */
  quantity?: number;
  /** Costo correcto por unidad (null = desconocido; solo si ya era desconocido). */
  unitCost?: Money | null;
  reason?: string;
}

async function planLotCorrection(db: AppDB, lotId: ID, input: LotCorrectionInput, now: ISODate) {
  const lot = await db.lots.get(lotId);
  if (!lot) fail('not_found', 'Esa entrada ya no existe.');
  const p = await requireProduct(db, lot.productId);
  await requireInventory(db, p.inventoryId);
  if (!usesLots(p)) fail('invalid', 'Este producto no separa por precio de compra.');
  if (lot.source === 'purchase') fail('from_purchase', 'Esta entrada viene de una compra: corrígela desde la compra.');
  if (lot.source === 'return') fail('from_return', 'Esta entrada viene de una devolución: su costo es el de la venta. Si hay un error, registra un ajuste de conteo.');
  const newQtyIn = input.quantity === undefined ? lot.qtyIn : assertQty(input.quantity, 'quantity');
  if (lot.source === 'opening' && (newQtyIn !== lot.qtyIn || lot.costKnown))
    fail('opening', 'En las existencias anteriores a los lotes solo se puede completar un costo desconocido. Para cambiar la cantidad, registra un ajuste de conteo.');
  let newTotal: Money | null;
  if (input.unitCost === undefined) newTotal = lot.costKnown ? Math.round((lot.valueIn / lot.qtyIn) * newQtyIn) : null;
  else if (input.unitCost === null) newTotal = lot.costKnown ? fail('invalid', 'Un costo conocido no puede volver a quedar como desconocido.', 'unitCost') : null;
  else newTotal = assertMoney(input.unitCost, 'unitCost', 'Costo por unidad') * newQtyIn;
  const adjust = lot.source === 'adjust';
  const writes: Write[] = [];
  const effect = await planLot(
    db,
    {
      lot,
      product: p,
      oldQtyIn: lot.qtyIn,
      oldTotal: lot.costKnown ? lot.valueIn : null,
      newQtyIn,
      newTotal,
      entry: (qtyDelta, costDelta, unknownDelta) => ({
        at: lot.date ?? lot.createdAt,
        dateUnknown: lot.date === null ? true : undefined,
        inventoryId: p.inventoryId,
        productId: p.id,
        unitId: null,
        type: adjust ? 'adjust_in' : 'initial',
        qtyDelta,
        costDelta,
        unknownDelta,
        writeOff: 0,
        refType: adjust ? 'adjust' : 'initial',
        refId: null,
        notes: lot.costKnown || newTotal === null ? 'Corrección del ingreso' : 'Corrección: costo completado',
        correction: true,
      }),
    },
    writes,
    now,
  );
  return { lot, product: p, effect, writes };
}

export async function previewLotCorrection(db: AppDB, lotId: ID, input: LotCorrectionInput): Promise<CorrectionEffect> {
  return (await planLotCorrection(db, lotId, input, nowISO())).effect;
}

/** Corrige la cantidad o el costo de una entrada de "stock que ya tenías" o de un ajuste de conteo (también completa un costo desconocido). */
export async function correctLot(db: AppDB, lotId: ID, input: LotCorrectionInput): Promise<CorrectionEffect | null> {
  const reason = cleanStr(input.reason ?? '', 300);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const now = nowISO();
    const { lot, product: p, effect, writes } = await planLotCorrection(db, lotId, input, now);
    if (effect.oldQty === effect.newQty && effect.oldTotal === effect.newTotal) return effect;
    for (const w of writes) await w();
    const bits: string[] = [];
    if (effect.oldQty !== effect.newQty) bits.push(`cantidad ${effect.oldQty} → ${effect.newQty}`);
    if (effect.oldUnitCost !== effect.newUnitCost) bits.push(`costo c/u ${effect.oldUnitCost ?? 'desconocido'} → ${effect.newUnitCost ?? 'desconocido'}`);
    if (effect.sales.length) bits.push(`${effect.sales.length} venta(s) recalculada(s)`);
    await logHistory(db, {
      entityType: 'product',
      entityId: p.id,
      inventoryId: p.inventoryId,
      action: 'correct',
      summary: `Corrección (${lot.source === 'adjust' ? 'ajuste de conteo' : 'stock que ya tenías'}) de ${p.name}: ${bits.join(', ')}${reason ? `. Motivo: ${reason}` : ''}`,
    });
    return effect;
  });
}

/* ======================= Unidades de stock existente ======================= */

export interface UnitCostCorrectionInput {
  opId?: string;
  cost: Money;
  reason?: string;
}

async function planUnitCostCorrection(db: AppDB, unitId: ID, input: UnitCostCorrectionInput, now: ISODate) {
  const cost = assertMoney(input.cost, 'cost', 'Costo de adquisición');
  const u = await requireUnit(db, unitId);
  const p = await requireProduct(db, u.productId);
  await requireInventory(db, p.inventoryId);
  if (u.source === 'purchase') fail('from_purchase', 'El costo de este equipo viene de una compra: corrígelo desde la compra.');
  const effect = emptyEffect('unit', p);
  const inStock = IN_STOCK.includes(u.status);
  Object.assign(effect, { unitId: u.id, oldQty: 1, newQty: 1, oldTotal: u.baseCost, newTotal: cost, oldUnitCost: u.baseCost, newUnitCost: cost });
  const writes: Write[] = [];
  if (u.baseCost === null) {
    // Completar un costo desconocido: también corrige sus ventas y devoluciones (lo hace setUnitBaseCost).
    if (inStock) effect.stockValueDelta = cost;
    else if (u.status === 'sold' && u.saleLineId) {
      const l = await db.saleLines.get(u.saleLineId);
      const s = l ? await db.sales.get(l.saleId) : undefined;
      if (l && s) {
        effect.sales.push({ saleId: s.id, saleLineId: l.id, date: s.date, qty: 1, oldCogs: l.cogs, newCogs: l.cogs + cost, completed: true });
        effect.profitDelta = -cost;
      }
    } else if (u.status === 'archived') {
      effect.writeOffDelta = cost;
      effect.profitDelta = -cost;
    }
    writes.push(() => setUnitBaseCost(db, u.id, cost));
    return { unit: u, effect, writes, completing: true };
  }
  const mv = (await db.movements.where('unitId').equals(u.id).toArray()).find((m) => m.type === 'initial' && !m.correction);
  await planUnitDelta(
    db,
    u,
    cost,
    (delta) => ({
      at: mv?.at ?? u.acquiredAt ?? u.createdAt,
      dateUnknown: mv?.dateUnknown ? true : undefined,
      inventoryId: u.inventoryId,
      productId: u.productId,
      unitId: u.id,
      type: 'initial',
      qtyDelta: 0,
      costDelta: delta,
      unknownDelta: 0,
      writeOff: 0,
      refType: 'initial',
      refId: null,
      notes: `Corrección del costo (${u.code})`,
      correction: true,
    }),
    effect,
    writes,
    now,
  );
  return { unit: u, effect, writes, completing: false };
}

export async function previewUnitCostCorrection(db: AppDB, unitId: ID, input: UnitCostCorrectionInput): Promise<CorrectionEffect> {
  return (await planUnitCostCorrection(db, unitId, input, nowISO())).effect;
}

/**
 * Corrige (o completa) el costo de un equipo de "stock que ya tenías", aunque ya esté vendido o dado de baja:
 * la ganancia de su venta se recalcula.
 */
export async function correctUnitCost(db: AppDB, unitId: ID, input: UnitCostCorrectionInput): Promise<CorrectionEffect | null> {
  const reason = cleanStr(input.reason ?? '', 300);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const now = nowISO();
    const { unit: u, effect, writes, completing } = await planUnitCostCorrection(db, unitId, input, now);
    if (u.baseCost === effect.newTotal) return effect;
    for (const w of writes) await w();
    if (!completing)
      await logHistory(db, {
        entityType: 'unit',
        entityId: u.id,
        inventoryId: u.inventoryId,
        action: 'correct',
        summary: `Corrección del costo (${u.code}): ${u.baseCost} → ${effect.newTotal}${effect.sales.length ? '. Venta recalculada' : ''}${reason ? `. Motivo: ${reason}` : ''}`,
      });
    return effect;
  });
}

/* ======================= Consultas para la interfaz ======================= */

/** ¿Se puede corregir esta compra? Devuelve el motivo si no (sin intentar la corrección). */
export async function purchaseCorrectionBlocker(db: AppDB, purchaseId: ID): Promise<string | null> {
  const p = await db.purchases.get(purchaseId);
  if (!p) return 'La compra no existe.';
  if (p.status === 'voided') return 'La compra está anulada.';
  const inv = await db.inventories.get(p.inventoryId);
  if (inv?.archived) return 'El inventario está archivado.';
  return null;
}

/** Correcciones registradas (para mostrar "Corregida" en compras, lotes y unidades). */
export async function listCorrections(db: AppDB, entityId: ID) {
  return (await db.history.where('entityId').equals(entityId).toArray()).filter((h) => h.action === 'correct').sort((a, b) => (a.at < b.at ? 1 : -1));
}
