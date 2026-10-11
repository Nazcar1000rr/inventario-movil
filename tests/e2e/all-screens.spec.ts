import { expect, test } from '@playwright/test';
import { createInventory, noHorizontalOverflow, purchase } from './helpers';

test('todas las pantallas cargan sin errores (con datos de ejemplo)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto('/');
  const inv = await createInventory(page, 'Principal', 'Profesional');
  const inv2 = await createInventory(page, 'Secundario', 'Sencillo');
  await purchase(page, inv, { phone: { model: 'iPhone 13 Pro', capacity: '128 GB' } }, 2, 2_000_000, { imeis: ['354444444444441'] });
  const purchaseId = page.url().split('/compras/')[1];
  await purchase(page, inv, { accessory: 'Cargador 20 W' }, 10, 25_000);

  // Venta con comprador nuevo, garantía y gasto de comisión
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /iPhone 13 Pro/ }).click();
  await page.locator('#sa-p-0').fill('2600000');
  await page.getByRole('button', { name: 'Sin comprador' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nuevo comprador' }).click();
  await page.getByRole('dialog').getByLabel('Nombre o empresa').fill('Laura Gómez');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar comprador' }).click();
  await expect(page.getByRole('button', { name: 'Laura Gómez' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar gasto' }).click();
  await page.getByLabel('Valor del gasto').fill('30000');
  await page.getByLabel('Dar garantía al comprador').check();
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  const saleId = page.url().split('/ventas/')[1];

  // Gasto general
  await page.goto('/#/gastos/nuevo');
  await page.getByLabel('Valor').fill('80000');
  await page.getByLabel('Categoría').selectOption('Publicidad');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('heading', { name: 'Gasto', exact: true })).toBeVisible();
  const expenseId = page.url().split('/gastos/')[1];

  // Vista consolidada
  await page.goto('/#/vistas');
  await page.getByRole('button', { name: 'Nueva vista' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Todo');
  await page.getByRole('dialog').getByLabel('Principal').check();
  await page.getByRole('dialog').getByLabel('Secundario').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();
  const viewId = page.url().split('/vistas/')[1];

  // v2: capital, deuda y precio de mercado
  await page.goto('/#/capital');
  await page.getByRole('button', { name: 'Aporte', exact: true }).click();
  await page.locator('#cm-amount').fill('5000000');
  await page.getByTestId('save-capital').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#/deudas');
  await page.getByRole('button', { name: 'Nueva deuda' }).click();
  await page.locator('#db-cred').fill('Primo');
  await page.locator('#db-amount').fill('1000000');
  await page.getByTestId('save-debt').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const debtId = (await page.locator('a[href^="#/deudas/"]').first().getAttribute('href'))!.split('/deudas/')[1];
  await page.goto('/#/precios');
  await page.getByTestId('add-market-price').click();
  await page.locator('#mp-model').fill('iPhone 13 Pro');
  await page.locator('#mp-cap').fill('128 GB');
  await page.locator('#mp-price').fill('2900000');
  await page.getByTestId('save-market-price').click();
  await expect(page.getByTestId('market-row')).toBeVisible();

  // Identificadores para rutas de detalle
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText('iPhone 13 Pro 128 GB').click();
  const productId = page.url().split('/productos/')[1];
  await page.getByRole('button', { name: /Vendidas/ }).click();
  const unitId = (await page.locator('a[href^="#/unidades/"]').first().getAttribute('href'))!.split('/unidades/')[1];
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText('Cargador 20 W').click();
  const accessoryId = page.url().split('/productos/')[1];
  await page.goto('/#/garantias');
  await page.getByRole('button', { name: 'Todas' }).click();
  const warrantyId = (await page.locator('a[href^="#/garantias/"]').first().getAttribute('href'))!.split('/garantias/')[1];
  await page.goto('/#/compradores');
  const customerId = (await page.locator('a[href^="#/compradores/"]').first().getAttribute('href'))!.split('/compradores/')[1];

  const routes = [
    '/',
    '/inventarios',
    `/inventarios/${inv}`,
    `/inventarios/${inv2}`,
    `/historial?inv=${inv}`,
    '/historial',
    `/productos/${productId}`,
    `/productos/${productId}/editar`,
    '/productos/nuevo',
    `/unidades/${unitId}`,
    `/stock/nuevo?inv=${inv}`,
    `/compras/nueva?inv=${inv}`,
    `/compras/${purchaseId}`,
    `/ventas/nueva?inv=${inv}`,
    `/ventas/${saleId}`,
    '/operaciones?tab=ventas',
    '/operaciones?tab=compras',
    '/operaciones?tab=gastos',
    '/gastos/nuevo',
    `/gastos/${expenseId}`,
    '/proveedores',
    '/compradores',
    `/compradores/${customerId}`,
    '/garantias',
    `/garantias/${warrantyId}`,
    '/informes?tab=finanzas',
    '/informes?tab=tiempos',
    '/informes?tab=productos',
    '/vistas',
    `/vistas/${viewId}`,
    '/catalogo',
    '/respaldo',
    '/ajustes',
    '/mas',
    '/buscar?q=IPH',
    '/capital',
    '/deudas',
    `/deudas/${debtId}`,
    '/precios',
    '/calculadora',
    '/resumen',
    '/informes?tab=rentabilidad',
    '/ayuda',
    '/ayuda/capital',
    '/ayuda/manual',
    '/ayuda/novedades',
    // v2.1
    `/productos/${accessoryId}`,
    '/gastos/nuevo?tipo=compra',
    '/gastos/nuevo?tipo=personal',
    '/personal',
    '/aprende',
    '/aprende/costo',
    '/aprende/margen',
    '/aprende/ganancia',
    '/aprende/caja',
    '/aprende/capital',
    '/aprende/rotacion',
    '/aprende/sueldo',
    '/aprende/precios',
    '/aprende/proveedores',
    '/aprende/lotes',
    '/ayuda/lotes',
    '/ayuda/gastos-personales',
    // v2.2
    '/apariencia',
    '/ayuda/apariencia',
    '/ayuda/voz',
    '/ayuda/sonidos',
  ];
  let helpOpened = 0;
  for (const r of routes) {
    await page.goto(`/#${r}`);
    await page.waitForTimeout(200);
    await expect(page.getByText('Ocurrió un error al mostrar esta pantalla'), r).toHaveCount(0);
    await expect(page.getByText('Pantalla no encontrada'), r).toHaveCount(0);
    await noHorizontalOverflow(page);
    // Ayuda "?" de la pantalla (si tiene)
    const help = page.getByTestId('help-btn');
    if (await help.count()) {
      await help.click();
      await expect(page.getByRole('dialog', { name: /^Ayuda · / }), r).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      helpOpened++;
    }
  }
  expect(helpOpened).toBeGreaterThanOrEqual(25);
  expect(errors).toEqual([]);
});
