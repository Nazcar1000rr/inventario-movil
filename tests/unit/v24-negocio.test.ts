import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, createBackup, createStarterInventory, featureOn, getBusinessProfile, normalizeProfile, parseBackup, restoreBackup, setBusinessTypes, setFeatureOverride, skipBusinessWelcome } from '../../src/core';
import { expectIntegrity, makeDB, op } from './helpers';

describe('v2.4 · tipo de negocio', () => {
  it('sin elegir nada todo está activo; cada tipo muestra solo lo que le sirve', () => {
    const none = normalizeProfile(null);
    expect(none.done).toBe(false);
    for (const k of ['inquiries', 'phones', 'warranties', 'quotes'] as const) expect(featureOn(none, k)).toBe(true);
    const calle = normalizeProfile({ done: true, types: ['calle'] });
    expect(featureOn(calle, 'phones')).toBe(false);
    expect(featureOn(calle, 'warranties')).toBe(false);
    const tech = normalizeProfile({ done: true, types: ['tecnologia'] });
    expect(featureOn(tech, 'phones')).toBe(true);
    // Varios negocios de tipos distintos: se activa lo que le sirva a alguno
    const both = normalizeProfile({ done: true, types: ['calle', 'tecnologia'] });
    expect(featureOn(both, 'phones')).toBe(true);
    expect(featureOn(both, 'warranties')).toBe(true);
  });

  it('lo que cambias a mano pisa al tipo de negocio, y datos raros se limpian', () => {
    const p = normalizeProfile({ done: true, types: ['calle', 'inventado', 'calle'], overrides: { phones: true, inquiries: 'no', otra: true } });
    expect(p.types).toEqual(['calle']);
    expect(featureOn(p, 'phones')).toBe(true);
    expect(p.overrides).toEqual({ phones: true });
    expect(featureOn(normalizeProfile({ done: true, types: ['tecnologia'], overrides: { inquiries: false } }), 'inquiries')).toBe(false);
  });

  it('se guarda, se puede cambiar de tipo y sumar otro, y pasa por el respaldo', async () => {
    const db = await makeDB();
    expect((await getBusinessProfile(db)).done).toBe(false);
    await expect(setBusinessTypes(db, [])).rejects.toThrow();
    await setBusinessTypes(db, ['gimnasio']);
    await setFeatureOverride(db, 'inquiries', false);
    let p = await getBusinessProfile(db);
    expect(p).toMatchObject({ done: true, types: ['gimnasio'], overrides: { inquiries: false } });
    // Sumar otro negocio conservando lo que cambiaste a mano
    await setBusinessTypes(db, ['gimnasio', 'tecnologia'], { keepOverrides: true });
    p = await getBusinessProfile(db);
    expect(p.types).toEqual(['gimnasio', 'tecnologia']);
    expect(featureOn(p, 'inquiries')).toBe(false);
    // Cambiar de tipo sin conservar: se borran los cambios a mano
    await setBusinessTypes(db, ['calle']);
    expect((await getBusinessProfile(db)).overrides).toEqual({});
    await setFeatureOverride(db, 'phones', true);
    await setFeatureOverride(db, 'phones', null);
    expect((await getBusinessProfile(db)).overrides).toEqual({});

    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup((await createBackup(db)).text), { safetyName: 'seg-' + op() });
    expect(await getBusinessProfile(db2)).toMatchObject({ done: true, types: ['calle'] });
  });

  it('omitir la bienvenida deja todo activo', async () => {
    const db = await makeDB();
    await skipBusinessWelcome(db);
    const p = await getBusinessProfile(db);
    expect(p.done).toBe(true);
    expect(featureOn(p, 'phones')).toBe(true);
  });

  it('crea un inventario con los productos típicos de cada tipo (por cantidad, sin precios)', async () => {
    const db = await makeDB();
    for (const t of BUSINESS_TYPES.filter((x) => x.starter.length)) {
      const r = await createStarterInventory(db, t.id);
      expect(r.products).toBe(t.starter.length);
      const prods = await db.products.where('inventoryId').equals(r.inventoryId).toArray();
      expect(prods.map((x) => x.name).sort()).toEqual(t.starter.map((x) => x.name).sort());
      expect(prods.every((x) => x.tracking === 'quantity' && x.salePrice === null && x.qty === 0)).toBe(true);
    }
    await expectIntegrity(db);
  });
});
