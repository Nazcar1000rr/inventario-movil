import { describe, expect, it } from 'vitest';
import { builtinCatalog, capacityChoices, capacityGB, PHONE_CAPACITIES, initDatabase } from '../../src/core';
import { makeDB } from './helpers';

describe('v2.4 · capacidades de almacenamiento', () => {
  it('entiende 64 GB, 1 TB y 1000 GB como la misma capacidad máxima', () => {
    expect(capacityGB('64 GB')).toBe(64);
    expect(capacityGB('1 TB')).toBe(1000);
    expect(capacityGB('1000 GB')).toBe(1000);
    expect(capacityGB('2tb')).toBe(2000);
    expect(capacityGB('256')).toBe(256);
    expect(capacityGB('mucha')).toBeNull();
  });

  it('todas las capacidades van de 64 GB a 1 TB, de menor a mayor y sin repetir', () => {
    expect(PHONE_CAPACITIES).toEqual(['64 GB', '128 GB', '256 GB', '512 GB', '1 TB']);
    expect(capacityChoices(['256 GB', '512 GB', '1 TB'], false)).toEqual(['256 GB', '512 GB', '1 TB']);
    expect(capacityChoices(['256 GB', '1000 GB'], true)).toEqual(['64 GB', '128 GB', '256 GB', '512 GB', '1000 GB']);
    expect(capacityChoices(['2 TB', '128 GB'], true)).toEqual(['64 GB', '128 GB', '256 GB', '512 GB', '1 TB', '2 TB']);
  });

  it('el catálogo trae iPhone 7 y 8 y una instalación existente los recibe sin tocar lo editado', async () => {
    const seed = builtinCatalog('2026-01-01T00:00:00.000Z');
    expect(seed.some((m) => m.model === 'iPhone 8 Plus')).toBe(true);
    const db = await makeDB();
    // Una persona editó un modelo del catálogo y borró un modelo base (como instalación vieja)
    await db.catalogModels.update('cat-iphone-13', { storageOptions: ['128 GB', '256 GB', '512 GB', '1 TB'], model: 'iPhone 13 (mío)' });
    await db.catalogModels.delete('cat-iphone-8-plus');
    await initDatabase(db);
    expect((await db.catalogModels.get('cat-iphone-13'))!.model).toBe('iPhone 13 (mío)');
    expect(await db.catalogModels.get('cat-iphone-8-plus')).toBeTruthy();
  });
});
