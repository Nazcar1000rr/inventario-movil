import type { AppDB } from '../db';
import type { ID } from '../types';

export interface IntegrityReport {
  ok: boolean;
  issues: string[];
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
  const [inventories, products, units, purchases, pLines, sales, sLines, payments, returns, expenses, movements, warranties, claims, repairs, photos, views, suppliers, customers] =
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
  for (const m of movements) {
    ref(invIds.has(m.inventoryId), `Movimiento ${m.id}: inventario inexistente`);
    ref(prodById.has(m.productId), `Movimiento ${m.id}: producto inexistente`);
    if (m.unitId) {
      ref(unitById.has(m.unitId), `Movimiento ${m.id}: unidad inexistente`);
      unitAgg.set(m.unitId, (unitAgg.get(m.unitId) ?? 0) + m.qtyDelta);
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

  return {
    ok: issues.length === 0,
    issues,
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
