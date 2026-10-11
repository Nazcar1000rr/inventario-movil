import type { AppDB } from '../db';
import type { ID } from '../types';

export interface IntegrityReport {
  ok: boolean;
  issues: string[];
  /**
   * Diferencias de valor que no impiden usar los datos (p. ej. el costo de una unidad no coincide con la suma
   * de sus movimientos). Las pruebas exigen que esté vacío; restaurar un respaldo no se bloquea por esto.
   */
  warnings: string[];
  counts: Record<string, number>;
}

/**
 * Verifica la consistencia de toda la base de datos:
 * - existencias y valor de productos por cantidad = suma de sus movimientos;
 * - cada unidad tiene un saldo de movimientos coherente con su estado;
 * - unidades vendidas apuntan a una venta activa con la línea correcta;
 * - totales de compras y ventas = suma de sus líneas;
 * - todas las referencias (claves foráneas) existen.
 * Se usa en pruebas y después de restaurar un respaldo.
 */
export async function verifyIntegrity(db: AppDB): Promise<IntegrityReport> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const [inventories, products, units, purchases, pLines, sales, sLines, payments, returns, expenses, movements, warranties, claims, repairs, photos, views, suppliers, customers, capital, debts, debtPayments, goals, lots] =
    await Promise.all([
      db.inventories.toArray(),
      db.products.toArray(),
      db.units.toArray(),
      db.purchases.toArray(),
      db.purchaseLines.toArray(),
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.payments.toArray(),
      db.returns.toArray(),
      db.expenses.toArray(),
      db.movements.toArray(),
      db.warranties.toArray(),
      db.warrantyClaims.toArray(),
      db.repairs.toArray(),
      db.photos.toArray(),
      db.consolidatedViews.toArray(),
      db.suppliers.toArray(),
      db.customers.toArray(),
      db.capital.toArray(),
      db.debts.toArray(),
      db.debtPayments.toArray(),
      db.goals.toArray(),
      db.lots.toArray(),
    ]);
  const invIds = new Set(inventories.map((i) => i.id));
  const prodById = new Map(products.map((p) => [p.id, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const sLineById = new Map(sLines.map((l) => [l.id, l]));
  const supplierIds = new Set(suppliers.map((s) => s.id));
  const customerIds = new Set(customers.map((c) => c.id));
  const warrantyIds = new Set(warranties.map((w) => w.id));

  const ref = (ok: boolean, msg: string) => {
    if (!ok) issues.push(msg);
  };

  for (const p of products) ref(invIds.has(p.inventoryId), `Producto ${p.name}: inventario inexistente`);

  // Movimientos agregados
  const agg = new Map<ID, { q: number; c: number; u: number }>();
  const unitAgg = new Map<ID, number>();
  const unitCostAgg = new Map<ID, { c: number; u: number }>();
  for (const m of movements) {
    ref(invIds.has(m.inventoryId), `Movimiento ${m.id}: inventario inexistente`);
    ref(prodById.has(m.productId), `Movimiento ${m.id}: producto inexistente`);
    if (m.unitId) {
      ref(unitById.has(m.unitId), `Movimiento ${m.id}: unidad inexistente`);
      unitAgg.set(m.unitId, (unitAgg.get(m.unitId) ?? 0) + m.qtyDelta);
      const uc = unitCostAgg.get(m.unitId) ?? { c: 0, u: 0 };
      uc.c += m.costDelta;
      uc.u += m.unknownDelta;
      unitCostAgg.set(m.unitId, uc);
    } else {
      const a = agg.get(m.productId) ?? { q: 0, c: 0, u: 0 };
      a.q += m.qtyDelta;
      a.c += m.costDelta;
      a.u += m.unknownDelta;
      agg.set(m.productId, a);
    }
  }
  for (const p of products) {
    if (p.tracking !== 'quantity') continue;
    const a = agg.get(p.id) ?? { q: 0, c: 0, u: 0 };
    ref(p.qty === a.q, `Producto ${p.name}: existencias ${p.qty} ≠ movimientos ${a.q}`);
    ref(p.stockValue === a.c, `Producto ${p.name}: valor ${p.stockValue} ≠ movimientos ${a.c}`);
    ref(p.unknownCostQty === a.u, `Producto ${p.name}: sin costo ${p.unknownCostQty} ≠ movimientos ${a.u}`);
    ref(p.qty >= 0 && p.stockValue >= 0 && p.unknownCostQty >= 0 && p.unknownCostQty <= p.qty, `Producto ${p.name}: existencias negativas o incoherentes`);
  }

  // Lotes (v2.1): los totales del producto = suma de sus lotes
  const lotAgg = new Map<ID, { q: number; v: number; u: number }>();
  const lotIds = new Set(lots.map((l) => l.id));
  for (const l of lots) {
    const p = prodById.get(l.productId);
    ref(!!p, `Lote ${l.id}: producto inexistente`);
    if (p) {
      ref(p.tracking === 'quantity' && p.costing === 'lots', `Lote de ${p.name}: el producto no usa lotes`);
      ref(p.inventoryId === l.inventoryId, `Lote de ${p.name}: inventario distinto al de su producto`);
    }
    ref(Number.isInteger(l.qty) && Number.isInteger(l.value) && l.qty >= 0 && l.value >= 0, `Lote ${l.id}: valores negativos o inválidos`);
    if (!l.costKnown) ref(l.value === 0, `Lote ${l.id}: sin costo pero con valor`);
    if (l.qty === 0 && l.costKnown) ref(l.value === 0, `Lote ${l.id}: sin existencias pero con valor`);
    if (l.purchaseId) ref(purchaseById.has(l.purchaseId), `Lote ${l.id}: compra inexistente`);
    if (l.supplierId) ref(supplierIds.has(l.supplierId), `Lote ${l.id}: proveedor inexistente`);
    const a = lotAgg.get(l.productId) ?? { q: 0, v: 0, u: 0 };
    a.q += l.qty;
    a.v += l.costKnown ? l.value : 0;
    a.u += l.costKnown ? 0 : l.qty;
    lotAgg.set(l.productId, a);
  }
  for (const p of products) {
    ref(p.costing === 'average' || p.costing === 'lots', `Producto ${p.name}: tipo de costo inválido`);
    if (p.tracking !== 'quantity' || p.costing !== 'lots') continue;
    const a = lotAgg.get(p.id) ?? { q: 0, v: 0, u: 0 };
    ref(a.q === p.qty, `Producto ${p.name}: existencias ${p.qty} ≠ lotes ${a.q}`);
    ref(a.v === p.stockValue, `Producto ${p.name}: valor ${p.stockValue} ≠ lotes ${a.v}`);
    ref(a.u === p.unknownCostQty, `Producto ${p.name}: sin costo ${p.unknownCostQty} ≠ lotes ${a.u}`);
  }
  for (const l of sLines)
    for (const t of l.lotAllocations ?? []) ref(t.qty > 0 && t.cogs >= 0, `Línea de venta ${l.id}: reparto por lotes inválido`);
  for (const e of expenses)
    for (const a of e.lotAllocations ?? []) if (e.status === 'active') ref(lotIds.has(a.lotId), `Gasto ${e.id}: lote inexistente`);

  // Costos capitalizados activos por unidad (reparaciones, costos sumados)
  const capByUnit = new Map<ID, number>();
  for (const e of expenses)
    if (e.status === 'active' && e.treatment === 'capitalized' && e.unitId) capByUnit.set(e.unitId, (capByUnit.get(e.unitId) ?? 0) + e.amount);

  for (const u of units) {
    const p = prodById.get(u.productId);
    ref(!!p, `Unidad ${u.code}: producto inexistente`);
    ref(invIds.has(u.inventoryId), `Unidad ${u.code}: inventario inexistente`);
    if (p) ref(p.inventoryId === u.inventoryId, `Unidad ${u.code}: inventario distinto al de su producto`);
    const inStock = u.status === 'available' || u.status === 'in_review' || u.status === 'damaged';
    const bal = unitAgg.get(u.id) ?? 0;
    ref(bal === (inStock ? 1 : 0), `Unidad ${u.code}: saldo de movimientos ${bal} incoherente con estado ${u.status}`);
    if (u.status === 'sold') {
      const s = u.saleId ? saleById.get(u.saleId) : undefined;
      ref(!!s && s.status === 'active', `Unidad ${u.code}: vendida sin venta activa`);
      const l = u.saleLineId ? sLineById.get(u.saleLineId) : undefined;
      ref(!!l && l.unitId === u.id && l.saleId === u.saleId, `Unidad ${u.code}: línea de venta incoherente`);
    } else {
      ref(u.saleId === null, `Unidad ${u.code}: no vendida pero con venta asociada`);
    }
    // Valor según movimientos = costo de la unidad en existencia (o 0 si ya salió)
    const uc = unitCostAgg.get(u.id) ?? { c: 0, u: 0 };
    const cap = capByUnit.get(u.id) ?? 0;
    const expected = inStock ? (u.baseCost ?? 0) + u.extraCost : 0;
    if (uc.c + cap !== expected) warnings.push(`Unidad ${u.code}: valor según movimientos ${uc.c + cap} ≠ costo ${expected}`);
    if (uc.u !== (inStock && u.baseCost === null ? 1 : 0)) warnings.push(`Unidad ${u.code}: costo desconocido incoherente con sus movimientos`);
    if (cap !== u.extraCost) warnings.push(`Unidad ${u.code}: costos adicionales ${u.extraCost} ≠ gastos capitalizados ${cap}`);
    if (!Array.isArray(u.partsHistory)) issues.push(`Unidad ${u.code}: historial de piezas inválido`);
    if (u.supplierId) ref(supplierIds.has(u.supplierId), `Unidad ${u.code}: proveedor inexistente`);
    if (u.purchaseId) ref(purchaseById.has(u.purchaseId), `Unidad ${u.code}: compra inexistente`);
  }

  // Una unidad no puede estar en dos ventas activas sin devolución
  const activeUnitSales = new Map<ID, number>();
  for (const l of sLines) {
    const s = saleById.get(l.saleId);
    ref(!!s, `Línea de venta ${l.id}: venta inexistente`);
    ref(prodById.has(l.productId), `Línea de venta ${l.id}: producto inexistente`);
    if (l.unitId) {
      ref(unitById.has(l.unitId), `Línea de venta ${l.id}: unidad inexistente`);
      if (s && s.status === 'active' && l.returnedQty < l.quantity)
        activeUnitSales.set(l.unitId, (activeUnitSales.get(l.unitId) ?? 0) + 1);
    }
    ref(l.returnedQty >= 0 && l.returnedQty <= l.quantity, `Línea de venta ${l.id}: devolución mayor que lo vendido`);
  }
  for (const [uid, n] of activeUnitSales)
    ref(n <= 1, `Unidad ${unitById.get(uid)?.code ?? uid}: aparece vendida ${n} veces`);

  for (const s of sales) {
    ref(invIds.has(s.inventoryId), `Venta ${s.id}: inventario inexistente`);
    if (s.customerId) ref(customerIds.has(s.customerId), `Venta ${s.id}: comprador inexistente`);
    const ls = sLines.filter((l) => l.saleId === s.id);
    ref(s.subtotal === ls.reduce((a, l) => a + l.quantity * l.unitPrice, 0), `Venta ${s.id}: subtotal no coincide con sus líneas`);
    ref(s.discount === ls.reduce((a, l) => a + l.discountShare, 0), `Venta ${s.id}: descuento no coincide con su reparto`);
    ref(s.total === s.subtotal - s.discount, `Venta ${s.id}: total incoherente`);
  }
  for (const p of purchases) {
    ref(invIds.has(p.inventoryId), `Compra ${p.id}: inventario inexistente`);
    if (p.supplierId) ref(supplierIds.has(p.supplierId), `Compra ${p.id}: proveedor inexistente`);
    const ls = pLines.filter((l) => l.purchaseId === p.id);
    ref(p.subtotal === ls.reduce((a, l) => a + l.price, 0), `Compra ${p.id}: subtotal no coincide con sus líneas`);
    ref(p.extraCosts === ls.reduce((a, l) => a + l.allocatedExtra, 0), `Compra ${p.id}: reparto de gastos incoherente`);
  }
  for (const l of pLines) ref(purchaseById.has(l.purchaseId), `Línea de compra ${l.id}: compra inexistente`);
  for (const p of payments) ref(saleById.has(p.saleId), `Pago ${p.id}: venta inexistente`);
  for (const r of returns) {
    ref(saleById.has(r.saleId), `Devolución ${r.id}: venta inexistente`);
    for (const rl of r.lines) ref(sLineById.has(rl.saleLineId), `Devolución ${r.id}: línea inexistente`);
  }
  for (const e of expenses) {
    if (e.inventoryId) ref(invIds.has(e.inventoryId), `Gasto ${e.id}: inventario inexistente`);
    if (e.saleId) ref(saleById.has(e.saleId), `Gasto ${e.id}: venta inexistente`);
    if (e.unitId) ref(unitById.has(e.unitId), `Gasto ${e.id}: unidad inexistente`);
  }
  for (const w of warranties) {
    if (w.saleId) ref(saleById.has(w.saleId), `Garantía ${w.id}: venta inexistente`);
    if (w.unitId) ref(unitById.has(w.unitId), `Garantía ${w.id}: unidad inexistente`);
  }
  for (const c of claims) ref(warrantyIds.has(c.warrantyId), `Reclamo ${c.id}: garantía inexistente`);
  for (const r of repairs) ref(unitById.has(r.unitId), `Reparación ${r.id}: unidad inexistente`);
  for (const ph of photos) ref(unitById.has(ph.unitId), `Foto ${ph.id}: unidad inexistente`);
  for (const v of views) for (const id of v.inventoryIds) ref(invIds.has(id), `Vista ${v.name}: inventario inexistente`);

  // Capital (aportes, retiros, préstamos al dueño)
  const ownerLoans = new Map<string, number>();
  for (const c of capital) {
    if (c.inventoryId) ref(invIds.has(c.inventoryId), `Capital ${c.id}: inventario inexistente`);
    ref(Number.isInteger(c.amount), `Capital ${c.id}: valor inválido`);
    if (c.kind === 'cash_adjustment') ref(c.amount !== 0, `Capital ${c.id}: ajuste de caja en cero`);
    else ref(c.amount > 0, `Capital ${c.id}: el valor debe ser positivo`);
    if (c.status !== 'active') continue;
    const k = c.inventoryId ?? '';
    if (c.kind === 'owner_loan') ownerLoans.set(k, (ownerLoans.get(k) ?? 0) + c.amount);
    if (c.kind === 'owner_loan_repayment') ownerLoans.set(k, (ownerLoans.get(k) ?? 0) - c.amount);
  }
  for (const [k, v] of ownerLoans) ref(v >= 0, `Préstamos al dueño${k ? ` (${k})` : ''}: devuelto más de lo prestado`);

  // Deudas
  const debtById = new Map(debts.map((d) => [d.id, d]));
  const paidByDebt = new Map<ID, number>();
  for (const p of debtPayments) {
    const d = debtById.get(p.debtId);
    ref(!!d, `Abono ${p.id}: deuda inexistente`);
    ref(p.principal >= 0 && p.interest >= 0, `Abono ${p.id}: valores negativos`);
    if (d) ref(d.status !== 'voided', `Abono ${p.id}: deuda anulada con abonos`);
    if (p.interest > 0) {
      const e = p.expenseId ? expenses.find((x) => x.id === p.expenseId) : undefined;
      ref(!!e && e.status === 'active' && e.amount === p.interest, `Abono ${p.id}: gasto de intereses incoherente`);
    }
    paidByDebt.set(p.debtId, (paidByDebt.get(p.debtId) ?? 0) + p.principal);
  }
  for (const d of debts) {
    if (d.inventoryId) ref(invIds.has(d.inventoryId), `Deuda ${d.id}: inventario inexistente`);
    ref(d.principal > 0, `Deuda ${d.id}: valor inválido`);
    const paid = paidByDebt.get(d.id) ?? 0;
    ref(paid <= d.principal, `Deuda ${d.creditor}: abonos mayores que la deuda`);
    if (d.status === 'paid') ref(paid === d.principal, `Deuda ${d.creditor}: marcada como pagada con saldo pendiente`);
    if (d.status === 'open') ref(paid < d.principal, `Deuda ${d.creditor}: saldada pero marcada como pendiente`);
    if (d.purchaseId) {
      const p = purchaseById.get(d.purchaseId);
      ref(!!p, `Deuda ${d.creditor}: compra inexistente`);
      if (p) {
        ref(p.debtId === d.id, `Deuda ${d.creditor}: la compra no apunta a esta deuda`);
        ref(d.principal <= p.total, `Deuda ${d.creditor}: mayor que el total de su compra`);
        if (p.status === 'voided') ref(d.status === 'voided', `Deuda ${d.creditor}: su compra está anulada pero la deuda no`);
      }
    }
  }
  for (const p of purchases) {
    if (p.paymentSource === 'debt') {
      const d = p.debtId ? debtById.get(p.debtId) : undefined;
      ref(!!d && d.purchaseId === p.id, `Compra ${p.id}: pagada con deuda sin deuda asociada`);
    } else ref(!p.debtId, `Compra ${p.id}: pagada con caja pero con deuda asociada`);
  }
  for (const e of expenses) if (e.debtId) ref(debtById.has(e.debtId), `Gasto ${e.id}: deuda inexistente`);
  for (const g of goals) if (g.inventoryId) ref(invIds.has(g.inventoryId), `Meta ${g.name}: inventario inexistente`);

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    counts: {
      inventories: inventories.length,
      products: products.length,
      units: units.length,
      purchases: purchases.length,
      sales: sales.length,
      movements: movements.length,
    },
  };
}
