import type { AppDB } from '../db';
import type { Customer, Product, Supplier, Unit } from '../types';
import { normalizeText } from '../util';

export interface SearchResults {
  units: (Unit & { productName: string })[];
  products: Product[];
  suppliers: Supplier[];
  customers: Customer[];
}

/** Búsqueda global por código interno, IMEI, serial, modelo, color, proveedor o comprador. */
export async function searchAll(db: AppDB, query: string, limit = 30): Promise<SearchResults> {
  const q = normalizeText(query);
  const qId = query.replace(/\s+/g, '').toUpperCase();
  if (q.length < 2) return { units: [], products: [], suppliers: [], customers: [] };
  const [products, units, suppliers, customers] = await Promise.all([
    db.products.toArray(),
    db.units.toArray(),
    db.suppliers.toArray(),
    db.customers.toArray(),
  ]);
  const pById = new Map(products.map((p) => [p.id, p]));
  const matchedProducts = products.filter((p) =>
    normalizeText(`${p.name} ${p.brand} ${p.model} ${p.reference} ${p.color} ${p.capacity}`).includes(q),
  );
  const matchedProductIds = new Set(matchedProducts.map((p) => p.id));
  const matchedUnits = units
    .filter(
      (u) =>
        u.code.includes(qId) ||
        (u.imei && u.imei.includes(qId)) ||
        (u.imei2 && u.imei2.includes(qId)) ||
        (u.serial && u.serial.includes(qId)) ||
        normalizeText(`${u.color} ${u.notes}`).includes(q) ||
        matchedProductIds.has(u.productId),
    )
    .map((u) => ({ ...u, productName: pById.get(u.productId)?.name ?? '' }))
    .sort((a, b) => {
      const ea = a.code === qId || a.imei === qId || a.serial === qId ? 0 : 1;
      const eb = b.code === qId || b.imei === qId || b.serial === qId ? 0 : 1;
      return ea - eb || a.code.localeCompare(b.code);
    });
  return {
    units: matchedUnits.slice(0, limit),
    products: matchedProducts.slice(0, limit),
    suppliers: suppliers.filter((s) => normalizeText(`${s.name} ${s.phone} ${s.city}`).includes(q)).slice(0, limit),
    customers: customers.filter((c) => normalizeText(`${c.name} ${c.phone} ${c.city}`).includes(q)).slice(0, limit),
  };
}
