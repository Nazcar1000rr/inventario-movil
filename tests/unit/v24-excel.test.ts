import { mkdirSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx, colName, createPurchase, createSale, excelDate, exportExcel, sheetName } from '../../src/core';
import { accessoryProduct, D, makeDB, op, phoneProduct, setupInventory } from './helpers';

const NOW = new Date('2026-10-14T20:00:00-05:00');

describe('v2.4 · Excel', () => {
  it('nombres de columna, de hoja y fechas', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    const used = new Set<string>();
    expect(sheetName('Ventas/Compras: [2026]?', used)).toBe('Ventas Compras 2026');
    expect(sheetName('Ventas/Compras: [2026]?', used)).toBe('Ventas Compras 2026 2');
    expect(sheetName('x'.repeat(60), new Set()).length).toBe(31);
    // 1 de enero de 2026 a las 00:00 locales = 46023
    expect(excelDate(new Date(2026, 0, 1).toISOString())).toBe(46023);
    expect(excelDate('no es fecha')).toBeNull();
  });

  it('un libro con datos raros (tildes, &, <, comillas, caracteres de control) queda bien formado', () => {
    const bytes = buildXlsx([{ name: 'Prueba', rows: [{ kind: 'header', cells: ['Nombre', 'Valor'] }, ['Café & <té> "ñandú"\u0001', 5], [{ v: NaN }, { v: 1.5, f: 'pct' }]] }]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('Café &amp; &lt;té&gt; &quot;ñandú&quot;');
    expect(sheet).not.toContain('\u0001');
    expect(sheet).not.toContain('NaN');
  });

  it('exporta todas las hojas con los mismos números que la app', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const charger = await accessoryProduct(db, inv.id, 'Cargador');
    const phone = await phoneProduct(db, inv.id, 'iPhone 13', '128 GB');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T10:00:00-05:00'), lines: [{ productId: charger.id, quantity: 10, price: 20_000 }, { productId: phone.id, quantity: 2, price: 1_500_000 }] });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-13T15:30:00-05:00'), lines: [{ productId: charger.id, quantity: 2, unitPrice: 35_000 }], initialPayment: 70_000 });
    const out = await exportExcel(db, NOW);
    expect(out.name).toBe('inventario-movil-2026-10-14.xlsx');
    expect(out.counts).toMatchObject({ Compras: 2, Ventas: 1, Inventario: 2 });
    const files = unzipSync(out.bytes);
    const wb = strFromU8(files['xl/workbook.xml']);
    for (const n of ['Inventario', 'Existencias', 'Compras', 'Ventas', 'Gastos', 'Análisis por día', 'Análisis por semana', 'Análisis por mes', 'Productos que más se mueven', 'Gráficas']) expect(wb).toContain(`name="${n}"`);
    expect(Object.keys(files).filter((f) => f.startsWith('xl/charts/chart'))).toHaveLength(3);
    mkdirSync('/tmp/claude-0/-home-claude/80356fb9-0b0f-5b73-8b24-d9f959b524b3/scratchpad', { recursive: true });
    writeFileSync('/tmp/claude-0/-home-claude/80356fb9-0b0f-5b73-8b24-d9f959b524b3/scratchpad/prueba.xlsx', out.bytes);
  });

  it('con la base vacía igual genera un archivo válido', async () => {
    const db = await makeDB();
    const out = await exportExcel(db, NOW);
    expect(out.counts.Ventas).toBe(0);
    expect(Object.keys(unzipSync(out.bytes))).toContain('xl/workbook.xml');
  });
});
