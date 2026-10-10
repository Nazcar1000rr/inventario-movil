import type { AppDB } from '../db';
import type { ID, Inventory, InventoryMode } from '../types';
import { cleanStr, fail, newId, normalizeText, nowISO } from '../util';
import { getSettings, logHistory, requireInventory } from './base';

export const MODE_LABEL: Record<InventoryMode, string> = { simple: 'Sencillo', pro: 'Profesional' };

async function assertUniqueName(db: AppDB, name: string, exceptId?: ID) {
  const all = await db.inventories.toArray();
  const n = normalizeText(name);
  if (all.some((i) => i.id !== exceptId && normalizeText(i.name) === n))
    fail('duplicate', `Ya existe un inventario llamado "${name}".`, 'name');
}

export async function createInventory(
  db: AppDB,
  input: { name: string; mode?: InventoryMode; notes?: string },
): Promise<Inventory> {
  const name = cleanStr(input.name, 60);
  if (!name) fail('required', 'Escribe un nombre para el inventario.', 'name');
  return db.transaction('rw', db.inventories, db.settings, db.history, async () => {
    await assertUniqueName(db, name);
    const settings = await getSettings(db);
    const mode = input.mode ?? settings.defaultMode;
    if (mode !== 'simple' && mode !== 'pro') fail('invalid', 'Modo no válido.', 'mode');
    const now = nowISO();
    const inv: Inventory = {
      id: newId(),
      name,
      mode,
      archived: false,
      archivedAt: null,
      notes: cleanStr(input.notes ?? '', 1000),
      createdAt: now,
      updatedAt: now,
    };
    await db.inventories.add(inv);
    await logHistory(db, {
      entityType: 'inventory',
      entityId: inv.id,
      inventoryId: inv.id,
      action: 'create',
      summary: `Inventario creado en modo ${MODE_LABEL[mode].toLowerCase()}`,
    });
    return inv;
  });
}

export async function renameInventory(db: AppDB, id: ID, newName: string): Promise<void> {
  const name = cleanStr(newName, 60);
  if (!name) fail('required', 'Escribe un nombre para el inventario.', 'name');
  await db.transaction('rw', db.inventories, db.history, async () => {
    const inv = await requireInventory(db, id, { allowArchived: true });
    if (inv.name === name) return;
    await assertUniqueName(db, name, id);
    await db.inventories.update(id, { name, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'inventory',
      entityId: id,
      inventoryId: id,
      action: 'rename',
      summary: `Renombrado de "${inv.name}" a "${name}"`,
    });
  });
}

/** Cambia la modalidad. Solo modifica el campo `mode`: no toca productos, costos, historial ni estadísticas. */
export async function setInventoryMode(db: AppDB, id: ID, mode: InventoryMode): Promise<void> {
  if (mode !== 'simple' && mode !== 'pro') fail('invalid', 'Modo no válido.', 'mode');
  await db.transaction('rw', db.inventories, db.history, async () => {
    const inv = await requireInventory(db, id, { allowArchived: true });
    if (inv.mode === mode) return;
    await db.inventories.update(id, { mode, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'inventory',
      entityId: id,
      inventoryId: id,
      action: 'mode',
      summary: `Modalidad cambiada de ${MODE_LABEL[inv.mode].toLowerCase()} a ${MODE_LABEL[mode].toLowerCase()}`,
    });
  });
}

export async function updateInventoryNotes(db: AppDB, id: ID, notes: string): Promise<void> {
  await db.inventories.update(id, { notes: cleanStr(notes, 1000), updatedAt: nowISO() });
}

/** Archivar no borra nada: el inventario deja de aceptar operaciones nuevas pero conserva su historia. */
export async function setInventoryArchived(db: AppDB, id: ID, archived: boolean): Promise<void> {
  await db.transaction('rw', db.inventories, db.history, async () => {
    const inv = await requireInventory(db, id, { allowArchived: true });
    if (inv.archived === archived) return;
    await db.inventories.update(id, { archived, archivedAt: archived ? nowISO() : null, updatedAt: nowISO() });
    await logHistory(db, {
      entityType: 'inventory',
      entityId: id,
      inventoryId: id,
      action: archived ? 'archive' : 'unarchive',
      summary: archived ? 'Inventario archivado' : 'Inventario desarchivado',
    });
  });
}

export interface InventoryDeletionImpact {
  products: number;
  units: number;
  purchases: number;
  sales: number;
  expenses: number;
  warranties: number;
  capital: number;
  debts: number;
}

export async function getDeletionImpact(db: AppDB, id: ID): Promise<InventoryDeletionImpact> {
  const [products, units, purchases, sales, expenses, warranties, capital, debts] = await Promise.all([
    db.products.where('inventoryId').equals(id).count(),
    db.units.where('inventoryId').equals(id).count(),
    db.purchases.where('inventoryId').equals(id).count(),
    db.sales.where('inventoryId').equals(id).count(),
    db.expenses.where('inventoryId').equals(id).count(),
    db.warranties.filter((w) => w.inventoryId === id).count(),
    db.capital.where('inventoryId').equals(id).count(),
    db.debts.where('inventoryId').equals(id).count(),
  ]);
  return { products, units, purchases, sales, expenses, warranties, capital, debts };
}

/**
 * Elimina PERMANENTEMENTE un inventario y todo lo que le pertenece.
 * Exige escribir el nombre exacto como confirmación. Los códigos internos usados
 * no se reutilizan (los contadores no retroceden).
 */
export async function deleteInventoryPermanently(db: AppDB, id: ID, confirmName: string): Promise<void> {
  await db.transaction('rw', db.allTables(), async () => {
    const inv = await requireInventory(db, id, { allowArchived: true });
    if (confirmName.trim() !== inv.name)
      fail('confirm_mismatch', 'El nombre escrito no coincide. No se eliminó nada.', 'confirmName');
    const unitIds = await db.units.where('inventoryId').equals(id).primaryKeys();
    const saleIds = await db.sales.where('inventoryId').equals(id).primaryKeys();
    const purchaseIds = await db.purchases.where('inventoryId').equals(id).primaryKeys();
    const warrantyIds = (await db.warranties.filter((w) => w.inventoryId === id).toArray()).map((w) => w.id);
    await db.warrantyClaims.where('warrantyId').anyOf(warrantyIds).delete();
    await db.warranties.bulkDelete(warrantyIds);
    await db.photos.where('unitId').anyOf(unitIds).delete();
    await db.repairs.where('unitId').anyOf(unitIds).delete();
    await db.payments.where('saleId').anyOf(saleIds).delete();
    await db.returns.where('saleId').anyOf(saleIds).delete();
    await db.saleLines.where('saleId').anyOf(saleIds).delete();
    await db.sales.bulkDelete(saleIds);
    await db.purchaseLines.where('purchaseId').anyOf(purchaseIds).delete();
    await db.purchases.bulkDelete(purchaseIds);
    await db.expenses.where('inventoryId').equals(id).delete();
    await db.expenses.where('unitId').anyOf(unitIds).delete();
    await db.units.bulkDelete(unitIds);
    await db.products.where('inventoryId').equals(id).delete();
    await db.movements.where('inventoryId').equals(id).delete();
    await db.history.where('inventoryId').equals(id).delete();
    const debtIds = await db.debts.where('inventoryId').equals(id).primaryKeys();
    await db.debtPayments.where('debtId').anyOf(debtIds).delete();
    await db.debts.bulkDelete(debtIds);
    await db.capital.where('inventoryId').equals(id).delete();
    await db.goals.where('inventoryId').equals(id).delete();
    const views = await db.consolidatedViews.toArray();
    for (const v of views) {
      if (v.inventoryIds.includes(id))
        await db.consolidatedViews.update(v.id, { inventoryIds: v.inventoryIds.filter((x) => x !== id), updatedAt: nowISO() });
    }
    await db.inventories.delete(id);
    await logHistory(db, {
      entityType: 'inventory',
      entityId: id,
      inventoryId: null,
      action: 'delete',
      summary: `Inventario "${inv.name}" eliminado permanentemente`,
    });
  });
}
