import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  AppDB,
  AppError,
  DB_SCHEMA_VERSION,
  SCHEMA_V1,
  analyzeImport,
  createBackup,
  createPurchase,
  createSale,
  createSupplier,
  getSafetySnapshotInfo,
  migrateTables,
  parseBackup,
  readAllTables,
  restoreBackup,
  undoLastRestore,
  registerReturn,
  createView,
  createExpense,
  addRepair,
  createWarranty,
  addClaim,
  newId,
} from '../../src/core';
import { accessoryProduct, D, expectIntegrity, makeDB, op, phoneProduct, setupInventory, snapshot } from './helpers';

async function richDB() {
  const db = await makeDB();
  const a = await setupInventory(db, 'Local', 'simple');
  const b = await setupInventory(db, 'Bodega', 'pro');
  const sup = await createSupplier(db, { name: 'Proveedor Uno', phone: '3001112233' });
  const phone = await phoneProduct(db, b.id, 'iPhone 15 Pro', '256 GB');
  const acc = await accessoryProduct(db, a.id);
  await createPurchase(db, {
    opId: op(),
    inventoryId: b.id,
    supplierId: sup.id,
    date: D('2026-01-10T15:00:00Z'),
    extraCosts: 30_000,
    lines: [{ productId: phone.id, quantity: 3, price: 9_000_000, units: [{ imei: '359999999999991', color: 'Titanio' }] }],
  });
  await createPurchase(db, { opId: op(), inventoryId: a.id, date: D('2026-01-10T15:00:00Z'), lines: [{ productId: acc.id, quantity: 20, price: 300_000 }] });
  const s = await createSale(db, {
    opId: op(),
    inventoryId: b.id,
    date: D('2026-01-15T15:00:00Z'),
    lines: [{ productId: phone.id, quantity: 2, unitPrice: 3_600_000 }],
    initialPayment: 5_000_000,
    warranty: { durationValue: 6, durationUnit: 'months' },
    costs: [{ category: 'Envío', amount: 25_000 }],
  });
  const line = (await db.saleLines.where('saleId').equals(s.id).toArray())[0];
  await registerReturn(db, { opId: op(), saleId: s.id, date: D('2026-01-16T15:00:00Z'), reason: 'Cambio', refundAmount: 1_000_000, lines: [{ saleLineId: line.id, quantity: 1, destination: 'in_review' }] });
  await createSale(db, { opId: op(), inventoryId: a.id, date: D('2026-01-17T15:00:00Z'), lines: [{ productId: acc.id, quantity: 4, unitPrice: 30_000 }], initialPayment: 0 });
  await createView(db, { name: 'Todo', inventoryIds: [a.id, b.id] });
  await createExpense(db, { opId: op(), date: D('2026-01-18T15:00:00Z'), amount: 50_000, category: 'Publicidad' });
  const unit = (await db.units.where('status').equals('available').toArray())[0];
  await addRepair(db, { opId: op(), unitId: unit.id, date: D('2026-01-19T15:00:00Z'), description: 'Cambio de batería', cost: 120_000 });
  const w = await createWarranty(db, { type: 'supplier', inventoryId: b.id, unitId: unit.id, startDate: D('2026-01-10T15:00:00Z'), durationValue: 1, durationUnit: 'months' });
  await addClaim(db, { opId: op(), warrantyId: w.id, date: D('2026-01-20T15:00:00Z'), description: 'Revisión', cost: 0 });
  // Foto (binario) para probar que el respaldo conserva datos binarios
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 250, 251]);
  await db.photos.add({ id: newId(), unitId: unit.id, mime: 'image/jpeg', data: bytes.buffer, width: 2, height: 2, createdAt: D('2026-01-19T15:00:00Z') });
  return db;
}

function comparable(t: Record<string, unknown[]>) {
  const out: Record<string, unknown> = {};
  for (const [k, rows] of Object.entries(t)) {
    out[k] = rows
      .filter((r) => !(k === 'meta' && ['installationId', 'lastRestoreAt', 'lastRestoreChecksum', 'lastBackupAt', 'createdAt'].includes((r as { key: string }).key)))
      .filter((r) => !(k === 'history' && (r as { action: string }).action === 'restore'))
      .map((r) => JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : v))));
  }
  return out;
}

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('Etapa 6: respaldo e importación', () => {
  it('16. exporta un respaldo completo y lo restaura en otra instalación sin perder relaciones', async () => {
    const src = await richDB();
    await expectIntegrity(src);
    const exp = await createBackup(src);
    expect(exp.filename).toMatch(/^inventario-respaldo-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const parsed = await parseBackup(exp.text);
    expect(parsed.counts.units).toBe(3);
    expect(parsed.counts.photos).toBe(1);

    const dst = await makeDB(); // instalación nueva
    const dstId = (await dst.meta.get('installationId'))!.value;
    const analysis = await analyzeImport(dst, parsed, 'stg-' + newId());
    expect(analysis.currentHasData).toBe(false);
    expect(analysis.integrity.ok).toBe(true);
    const res = await restoreBackup(dst, parsed, { safetyName: 'safety-' + newId() });
    expect(res.integrity.ok).toBe(true);
    expect(res.safetySnapshot).toBe(false);
    expect(comparable(await readAllTables(dst))).toEqual(comparable(await readAllTables(src)));
    // La instalación destino conserva su propia identidad (copia, no sincronización)
    expect((await dst.meta.get('installationId'))!.value).toBe(dstId);
    const photo = (await dst.photos.toArray())[0];
    expect(Array.from(new Uint8Array(photo.data))).toEqual([0xff, 0xd8, 0xff, 1, 2, 3, 250, 251]);
    await expectIntegrity(dst);
    // Ambas instalaciones divergen después: un cambio en una no afecta a la otra
    await createSupplier(dst, { name: 'Solo en destino' });
    expect(await src.suppliers.count()).toBe(1);
    expect(await dst.suppliers.count()).toBe(2);
  });

  it('respaldo cifrado: requiere la contraseña correcta', async () => {
    const src = await richDB();
    const exp = await createBackup(src, { password: 'clave-segura' });
    expect(exp.filename).toContain('cifrado');
    expect(exp.text).not.toContain('Proveedor Uno');
    expect(exp.text).not.toContain('359999999999991');
    await expectAppError(parseBackup(exp.text), 'password_required');
    await expectAppError(parseBackup(exp.text, 'otra-clave'), 'bad_password');
    const parsed = await parseBackup(exp.text, 'clave-segura');
    expect(parsed.encrypted).toBe(true);
    expect(parsed.counts.sales).toBe(2);
    await expectAppError(createBackup(src, { password: '123' }), 'weak_password');
    // Alterar el texto cifrado lo invalida (autenticación AES-GCM)
    const env = JSON.parse(exp.text);
    const bytes = Buffer.from(env.ciphertext as string, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 0x01; // cambia un solo bit
    env.ciphertext = bytes.toString('base64');
    await expectAppError(parseBackup(JSON.stringify(env), 'clave-segura'), 'bad_password');
  });

  it('17. importar un archivo dañado no modifica los datos existentes', async () => {
    const src = await richDB();
    const good = (await createBackup(src)).text;
    const dst = await richDB();
    await createSupplier(dst, { name: 'Dato que debe sobrevivir' });
    const before = await snapshot(dst);

    const env = JSON.parse(good);
    const cases: [string, string][] = [
      ['vacío', ''],
      ['truncado', good.slice(0, Math.floor(good.length / 2))],
      ['otro formato', JSON.stringify({ hello: 'world' })],
      ['checksum alterado', good.replace('Proveedor Uno', 'Proveedor Dos')],
      ['versión futura', JSON.stringify({ ...env, schemaVersion: DB_SCHEMA_VERSION + 1 })],
      ['conteo incorrecto', JSON.stringify({ ...env, payload: { ...env.payload, counts: { ...env.payload.counts, units: 99 } } })],
    ];
    for (const [, text] of cases) {
      await expect(parseBackup(text)).rejects.toBeInstanceOf(AppError);
    }
    // Campo inválido con checksum recalculado (archivo "bien formado" pero con datos corruptos)
    const { createHash } = await import('node:crypto');
    const bad = structuredClone(env);
    bad.payload.tables.units[0].baseCost = 'mil';
    bad.checksum = createHash('sha256').update(JSON.stringify(bad.payload)).digest('hex');
    await expectAppError(parseBackup(JSON.stringify(bad)), 'bad_field');
    const dup = structuredClone(env);
    dup.payload.tables.units.push(dup.payload.tables.units[0]);
    dup.payload.counts.units++;
    dup.checksum = createHash('sha256').update(JSON.stringify(dup.payload)).digest('hex');
    await expectAppError(parseBackup(JSON.stringify(dup)), 'dup_id');
    // Referencia rota: pasa la validación estructural, pero la verificación de integridad la rechaza
    const broken = structuredClone(env);
    broken.payload.tables.units[0].productId = 'no-existe';
    broken.checksum = createHash('sha256').update(JSON.stringify(broken.payload)).digest('hex');
    const parsedBroken = await parseBackup(JSON.stringify(broken));
    await expectAppError(restoreBackup(dst, parsedBroken, { safetyName: 'safety-' + newId() }), 'integrity');

    expect(await snapshot(dst)).toEqual(before);
    await expectIntegrity(dst);
  });

  it('la restauración es atómica: un fallo a mitad de camino no deja datos a medias', async () => {
    const src = await richDB();
    const parsed = await parseBackup((await createBackup(src)).text);
    const dst = await richDB();
    await createSupplier(dst, { name: 'Original' });
    const before = await snapshot(dst);
    // Simula un error de escritura (p. ej. disco lleno) al insertar unidades, después de haber borrado tablas
    dst.units.hook('creating', () => {
      throw new Error('Fallo simulado de escritura');
    });
    await expect(restoreBackup(dst, parsed, { safetyName: 'safety-' + newId() })).rejects.toThrow('Fallo simulado');
    expect(await snapshot(dst)).toEqual(before);
  });

  it('18. conflictos: misma instalación, respaldo antiguo, ya restaurado; reemplazo con copia de seguridad y deshacer', async () => {
    const db = await richDB();
    const safetyName = 'safety-' + newId();
    const exp = await createBackup(db);
    const parsed = await parseBackup(exp.text);
    await new Promise((r) => setTimeout(r, 5));
    await createSupplier(db, { name: 'Cambio posterior al respaldo' });
    const a1 = await analyzeImport(db, parsed, 'stg-' + newId());
    expect(a1.currentHasData).toBe(true);
    expect(a1.sameInstallation).toBe(true);
    expect(a1.olderThanCurrent).toBe(true);
    expect(a1.alreadyRestored).toBe(false);

    const beforeRestore = await snapshot(db);
    const res = await restoreBackup(db, parsed, { safetyName });
    expect(res.safetySnapshot).toBe(true);
    expect(await db.suppliers.count()).toBe(1); // reemplazo: el cambio posterior ya no está
    expect(await getSafetySnapshotInfo(safetyName)).not.toBeNull();
    const a2 = await analyzeImport(db, parsed, 'stg-' + newId());
    expect(a2.alreadyRestored).toBe(true);

    // Deshacer devuelve exactamente los datos anteriores
    await undoLastRestore(db, safetyName);
    expect(await db.suppliers.count()).toBe(2);
    const after = await snapshot(db, ['meta', 'history']);
    const { meta: _m, history: _h, ...rest } = beforeRestore as Record<string, unknown>;
    void _m;
    void _h;
    expect(after).toEqual(rest);
    expect(await getSafetySnapshotInfo(safetyName)).toBeNull();
    await expectIntegrity(db);
  });
});

describe('22. migraciones de esquema', () => {
  it('convierte respaldos antiguos con una cadena de migraciones', () => {
    const tables = { units: [{ id: 'u1', code: 'IPH-0001' }] } as Record<string, unknown[]>;
    const migrations = {
      1: (t: Record<string, unknown[]>) => ({ ...t, units: t.units.map((u) => ({ ...(u as object), warrantyMonths: null })) }),
      2: (t: Record<string, unknown[]>) => ({ ...t, units: t.units.map((u) => ({ ...(u as object), tag: 'v3' })) }),
    };
    const out = migrateTables(tables, 1, 3, migrations);
    expect(out.units[0]).toEqual({ id: 'u1', code: 'IPH-0001', warrantyMonths: null, tag: 'v3' });
    expect(() => migrateTables(tables, 1, 4, migrations)).toThrow(AppError);
  });

  it('Dexie actualiza una base existente a una versión nueva conservando los datos', async () => {
    const name = 'mig-' + newId();
    const v1 = new AppDB(name);
    await v1.open();
    await v1.inventories.add({ id: 'i1', name: 'Viejo', mode: 'simple', archived: false, archivedAt: null, notes: '', createdAt: D('2026-01-01T00:00:00Z'), updatedAt: D('2026-01-01T00:00:00Z') });
    v1.close();

    class V2 extends Dexie {
      constructor() {
        super(name);
        this.version(1).stores(SCHEMA_V1);
        this.version(2)
          .stores({ ...SCHEMA_V1, inventories: 'id, name, mode' })
          .upgrade(async (tx) => {
            await tx.table('inventories').toCollection().modify((i: Record<string, unknown>) => {
              i.color = 'gris';
            });
          });
      }
    }
    const v2 = new V2();
    await v2.open();
    expect(v2.verno).toBe(2);
    const inv = await v2.table('inventories').get('i1');
    expect(inv).toMatchObject({ name: 'Viejo', color: 'gris' });
    expect(await v2.table('inventories').where('mode').equals('simple').count()).toBe(1);
    v2.close();
  });
});
