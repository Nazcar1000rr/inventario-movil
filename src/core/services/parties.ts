import type { AppDB } from '../db';
import type { Customer, ID, ISODate, Money, Supplier } from '../types';
import { cleanStr, fail, newId, normalizeText, nowISO } from '../util';
import { logHistory } from './base';
import { tx } from './stock';

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

export interface SupplierInput {
  name: string;
  phone?: string;
  city?: string;
  address?: string;
  type?: string;
  notes?: string;
}

/** Posibles duplicados: mismo nombre normalizado o mismo teléfono. */
export async function findSimilarSuppliers(db: AppDB, input: { name: string; phone?: string }, exceptId?: ID): Promise<Supplier[]> {
  const n = normalizeText(input.name);
  const ph = digits(input.phone ?? '');
  const all = await db.suppliers.toArray();
  return all.filter(
    (s) => s.id !== exceptId && ((n && normalizeText(s.name) === n) || (ph.length >= 7 && digits(s.phone) === ph)),
  );
}

export async function createSupplier(db: AppDB, input: SupplierInput, opts: { allowDuplicate?: boolean } = {}): Promise<Supplier> {
  const name = cleanStr(input.name, 100);
  if (!name) fail('required', 'Ingrese el nombre del proveedor.', 'name');
  return tx(db, async () => {
    if (!opts.allowDuplicate) {
      const sim = await findSimilarSuppliers(db, { name, phone: input.phone });
      if (sim.length) fail('duplicate_supplier', `Ya existe un proveedor parecido: "${sim[0].name}".`, 'name');
    }
    const now = nowISO();
    const s: Supplier = {
      id: newId(),
      name,
      phone: cleanStr(input.phone ?? '', 30),
      city: cleanStr(input.city ?? '', 60),
      address: cleanStr(input.address ?? '', 200),
      type: cleanStr(input.type ?? '', 60),
      notes: cleanStr(input.notes ?? '', 1000),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.suppliers.add(s);
    await logHistory(db, { entityType: 'supplier', entityId: s.id, inventoryId: null, action: 'create', summary: `Proveedor creado: ${name}` });
    return s;
  });
}

export async function updateSupplier(db: AppDB, id: ID, patch: Partial<SupplierInput> & { archived?: boolean }): Promise<void> {
  await tx(db, async () => {
    const s = await db.suppliers.get(id);
    if (!s) fail('not_found', 'El proveedor no existe.');
    const next: Supplier = { ...s, updatedAt: nowISO() };
    if (patch.name !== undefined) {
      const name = cleanStr(patch.name, 100);
      if (!name) fail('required', 'El nombre no puede quedar vacío.', 'name');
      next.name = name;
    }
    if (patch.phone !== undefined) next.phone = cleanStr(patch.phone, 30);
    if (patch.city !== undefined) next.city = cleanStr(patch.city, 60);
    if (patch.address !== undefined) next.address = cleanStr(patch.address, 200);
    if (patch.type !== undefined) next.type = cleanStr(patch.type, 60);
    if (patch.notes !== undefined) next.notes = cleanStr(patch.notes, 1000);
    if (patch.archived !== undefined) next.archived = patch.archived;
    await db.suppliers.put(next);
    await logHistory(db, { entityType: 'supplier', entityId: id, inventoryId: null, action: 'update', summary: `Proveedor editado: ${next.name}` });
  });
}

export interface SupplierStats {
  purchases: number;
  totalPurchased: Money;
  firstPurchase: ISODate | null;
  lastPurchase: ISODate | null;
}

/** Totales calculados a partir de las compras registradas (no anuladas). */
export async function getSupplierStats(db: AppDB, id: ID): Promise<SupplierStats> {
  const ps = (await db.purchases.where('supplierId').equals(id).toArray()).filter((p) => p.status === 'active');
  const dates = ps.map((p) => p.date).sort();
  return {
    purchases: ps.length,
    totalPurchased: ps.reduce((a, p) => a + p.total, 0),
    firstPurchase: dates[0] ?? null,
    lastPurchase: dates.at(-1) ?? null,
  };
}

export interface CustomerInput {
  name: string;
  phone?: string;
  city?: string;
  notes?: string;
}

export async function findSimilarCustomers(db: AppDB, input: { name: string; phone?: string }, exceptId?: ID): Promise<Customer[]> {
  const n = normalizeText(input.name);
  const ph = digits(input.phone ?? '');
  const all = await db.customers.toArray();
  return all.filter(
    (c) => c.id !== exceptId && ((n && normalizeText(c.name) === n) || (ph.length >= 7 && digits(c.phone) === ph)),
  );
}

export async function createCustomer(db: AppDB, input: CustomerInput, opts: { allowDuplicate?: boolean } = {}): Promise<Customer> {
  const name = cleanStr(input.name, 100);
  if (!name) fail('required', 'Ingrese el nombre del comprador.', 'name');
  return tx(db, async () => {
    if (!opts.allowDuplicate) {
      const sim = await findSimilarCustomers(db, { name, phone: input.phone });
      if (sim.length) fail('duplicate_customer', `Ya existe un comprador parecido: "${sim[0].name}".`, 'name');
    }
    const now = nowISO();
    const c: Customer = {
      id: newId(),
      name,
      phone: cleanStr(input.phone ?? '', 30),
      city: cleanStr(input.city ?? '', 60),
      notes: cleanStr(input.notes ?? '', 1000),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.customers.add(c);
    await logHistory(db, { entityType: 'customer', entityId: c.id, inventoryId: null, action: 'create', summary: `Comprador creado: ${name}` });
    return c;
  });
}

export async function updateCustomer(db: AppDB, id: ID, patch: Partial<CustomerInput> & { archived?: boolean }): Promise<void> {
  await tx(db, async () => {
    const c = await db.customers.get(id);
    if (!c) fail('not_found', 'El comprador no existe.');
    const next: Customer = { ...c, updatedAt: nowISO() };
    if (patch.name !== undefined) {
      const name = cleanStr(patch.name, 100);
      if (!name) fail('required', 'El nombre no puede quedar vacío.', 'name');
      next.name = name;
    }
    if (patch.phone !== undefined) next.phone = cleanStr(patch.phone, 30);
    if (patch.city !== undefined) next.city = cleanStr(patch.city, 60);
    if (patch.notes !== undefined) next.notes = cleanStr(patch.notes, 1000);
    if (patch.archived !== undefined) next.archived = patch.archived;
    await db.customers.put(next);
    await logHistory(db, { entityType: 'customer', entityId: id, inventoryId: null, action: 'update', summary: `Comprador editado: ${next.name}` });
  });
}
