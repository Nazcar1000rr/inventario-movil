import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createInventory, docShot, freshApp, noHorizontalOverflow, purchase, sell } from './helpers';

test('v2.4: tablas, Excel, comprobante, cierre de caja, cotizaciones y tutorial', async ({ page }) => {
  test.setTimeout(240_000);
  await freshApp(page);
  const inv = await createInventory(page, 'Local centro', 'Sencillo');
  await purchase(page, inv, { phone: { model: 'iPhone 13', capacity: '128 GB' } }, 3, 1_500_000);
  const saleId = await sell(page, inv, 'iPhone 13 128 GB', 1, 2_000_000, 'full');

  // Análisis → Tablas
  await page.goto('/#/analisis?tab=tablas');
  const table = page.getByTestId('period-table');
  await expect(table).toContainText('Total');
  await expect(table).toContainText('2.000.000');
  await page.getByRole('group', { name: 'Ver por' }).getByRole('button', { name: 'Semana' }).click();
  await expect(table).toContainText('en curso');
  await page.getByRole('group', { name: 'Ver por' }).getByRole('button', { name: 'Mes' }).click();
  await expect(page.getByTestId('movers-table').first()).toContainText('iPhone 13');
  await noHorizontalOverflow(page);
  await docShot(page, 'v24-analisis-tablas');

  // Excel
  await page.goto('/#/respaldo');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
  expect(dl.suggestedFilename()).toMatch(/^inventario-movil-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = await dl.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // un .xlsx es un zip
  expect(bytes.length).toBeGreaterThan(5_000);
  await expect(page.getByText('Excel listo')).toBeVisible();
  await docShot(page, 'v24-excel');

  // Comprobante
  await page.goto(`/#/ventas/${saleId}`);
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: /Comprobante/ }).click();
  const [img] = await Promise.all([page.waitForEvent('download'), page.getByTestId('receipt-png').click()]);
  expect(img.suggestedFilename()).toMatch(/^comprobante-\d{6}-[A-Z0-9]+\.png$/);
  expect(readFileSync((await img.path())!).subarray(1, 4).toString()).toBe('PNG');

  // Cierre de caja: la venta de hoy se cobró en efectivo
  await page.goto('/#/cierre-caja');
  // Entraron $2.000.000 y la compra de $4.500.000 también salió de la caja: debería haber −$2.500.000
  await expect(page.getByTestId('cash-expected')).toContainText('2.500.000');
  await expect(page.getByTestId('cash-methods')).toContainText('Efectivo');
  await page.getByLabel('Efectivo que contaste').fill('0');
  await expect(page.getByText(/Sobran.*2\.500\.000/).first()).toBeVisible();
  await page.getByTestId('save-cash-close').click();
  await expect(page.getByTestId('cash-history')).toContainText('2.500.000');
  await noHorizontalOverflow(page);
  await docShot(page, 'v24-cierre-caja');

  // Cotización → venta
  await page.goto('/#/cotizaciones');
  await expect(page.getByText('Aún no tienes cotizaciones')).toBeVisible();
  await page.getByTestId('new-quote').click();
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByTestId('quote-add-product').click();
  await page.getByRole('dialog').getByRole('button', { name: /iPhone 13/ }).first().click();
  await page.getByLabel('Precio de cada uno').fill('2100000');
  await page.getByTestId('quote-add-free').click();
  await page.getByLabel('Qué ofreces').fill('Forro');
  await page.getByLabel('Precio de cada uno').nth(1).fill('30000');
  await page.getByLabel('Descuento').fill('30000');
  await expect(page.getByTestId('quote-total')).toContainText('2.100.000');
  await docShot(page, 'v24-cotizacion-form');
  await page.getByTestId('save-quote').click();
  await expect(page.getByTestId('quote-detail-total')).toContainText('2.100.000');
  await expect(page.getByTestId('quote-lines')).toContainText('Forro');
  await docShot(page, 'v24-cotizacion-detalle');
  await page.getByTestId('quote-to-sale').click();
  await expect(page.getByText(/Viene de la cotización N\.º 1/)).toBeVisible();
  await expect(page.getByText(/No se pudo agregar: Forro/)).toBeVisible(); // lo escrito a mano no es un producto
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  await page.goto('/#/cotizaciones');
  await page.getByRole('group', { name: 'Mostrar' }).getByRole('button', { name: 'Vendidas' }).click();
  await expect(page.getByTestId('quote-list')).toContainText('Vendida');
  await expect(page.getByTestId('quote-list')).toContainText('Ana');

  // Ficha del comprador y compras
  // Tutorial con ejemplo, zoom y repetir
  await page.goto('/#/aprende');
  await page.getByTestId('tour-all').click();
  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Recorrido completo');
  await page.getByTestId('tour-next').click();
  await expect(tour).toContainText('Para qué sirve');
  await expect(tour).toContainText('Ejemplo');
  await page.getByTestId('tour-repeat-step').click();
  await expect(tour).toContainText('Ejemplo');
  await page.getByTestId('tour-repeat-topic').click();
  await expect(tour).toContainText('paso 1 de');
  await tour.getByTestId('tour-skip').click();
  await expect(tour).toHaveCount(0);
});

test('v2.4: eliminar producto, capacidades y funciones por negocio', async ({ page }) => {
  test.setTimeout(120_000);
  await freshApp(page);
  const inv = await createInventory(page, 'Local centro', 'Sencillo');

  // Capacidades: lista corta por modelo y botón para ver todas
  await page.goto(`/#/productos/nuevo?inv=${inv}`);
  await page.getByLabel('Modelo').selectOption({ label: 'iPhone 13' });
  await expect(page.getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: '1 TB' })).toHaveCount(0);
  await page.getByTestId('all-capacities').click();
  await expect(page.getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: '1 TB' })).toBeVisible();
  await page.getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: '64 GB' }).click();

  // Eliminar un producto sin movimientos
  await page.getByRole('button', { name: /Crear producto|Guardar/ }).first().click();
  await expect(page.getByRole('heading', { name: /iPhone 13/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: 'Eliminar producto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local centro' })).toBeVisible();
  await expect(page.getByText('iPhone 13 64 GB')).toHaveCount(0);

  // Tu negocio: apagar Preguntones lo esconde del menú y de Inicio
  await page.goto('/#/ajustes');
  await expect(page.getByTestId('biz-current')).toBeVisible();
  await page.getByTestId('feat-inquiries').click();
  await expect(page.getByTestId('feat-inquiries')).not.toBeChecked();
  await page.goto('/#/mas');
  await expect(page.getByRole('link', { name: /Preguntones/ })).toHaveCount(0);
  await page.goto('/#/ajustes');
  await page.getByTestId('feat-inquiries').click();
  await expect(page.getByTestId('feat-inquiries')).toBeChecked();
  await page.goto('/#/mas');
  await expect(page.getByRole('link', { name: /Preguntones/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Cierre de caja/ })).toBeVisible();
});

test('v2.4: bienvenida por tipo de negocio', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await docShot(page, 'v24-bienvenida');
  await page.getByTestId('biz-calle').check();
  await page.getByTestId('welcome-next').click();
  await expect(page.getByTestId('welcome-summary')).toContainText('Celulares y su catálogo');
  await expect(page.getByTestId('welcome-summary')).toContainText('oculto');
  await page.getByTestId('welcome-done').click();
  await expect(page.getByRole('heading', { name: 'Mi puesto' })).toBeVisible();
  await expect(page.getByText('Perro caliente')).toBeVisible();
  await page.goto('/#/mas');
  await expect(page.getByRole('link', { name: /Catálogo de modelos/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Cotizaciones/ })).toHaveCount(0);
});

test('v2.4: en iPhone sin mezcla de audio, sonidos y voz empiezan apagados (no pausan la música)', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'es-CO',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      delete (Navigator.prototype as unknown as { audioSession?: unknown }).audioSession;
    } catch {
      /* ya no existe */
    }
  });
  await page.goto('/#/apariencia');
  await expect(page.getByTestId('sounds-all')).not.toBeChecked();
  await page.getByTestId('sounds-all').click();
  await expect(page.getByTestId('sounds-all')).toBeChecked();
  await ctx.close();
});
