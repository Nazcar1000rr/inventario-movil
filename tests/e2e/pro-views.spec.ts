import { expect, test } from '@playwright/test';
import { createInventory, purchase, SHOTS } from './helpers';

test('modo profesional: códigos, IMEI, inspección, reparación y cambio de modo sin pérdida', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Bodega pro', 'Profesional');
  await purchase(page, inv, { phone: { model: 'iPhone 15 Pro', capacity: '256 GB' } }, 2, 3_000_000, { imeis: ['351111111111111', '351111111111112'] });
  await expect(page.getByRole('link', { name: 'IPH-0001' })).toBeVisible();
  await page.getByRole('link', { name: 'IPH-0001' }).click();
  await expect(page.getByRole('heading', { name: 'IPH-0001' })).toBeVisible();
  await expect(page.getByText('351111111111111')).toBeVisible();

  // Inspección: pantalla reemplazada (verificada por técnico)
  await page.getByRole('button', { name: 'Iniciar' }).click();
  const ins = page.getByRole('dialog', { name: 'Inspección' });
  await ins.getByLabel('Estado de batería (%)').fill('86');
  await ins.getByLabel('Pantalla (imagen y táctil): estado').selectOption('replaced');
  await ins.getByLabel('Pantalla (imagen y táctil): origen').selectOption('technician');
  await ins.getByRole('button', { name: 'Guardar inspección' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Reemplazado', { exact: true })).toBeVisible();
  await expect(page.getByText('Verificado por técnico')).toBeVisible();
  await expect(page.getByText('86% (ingresado manualmente)')).toBeVisible();

  // Reparación capitalizada: el costo de la unidad sube
  await page.locator('section').filter({ hasText: 'Reparaciones pagadas' }).getByRole('button', { name: 'Agregar' }).click();
  const rep = page.getByRole('dialog', { name: 'Registrar reparación pagada' });
  await rep.getByLabel('Descripción').fill('Cambio de batería');
  await rep.getByRole('group', { name: 'Pieza cambiada' }).getByRole('button', { name: 'Batería' }).click();
  await rep.getByLabel('Costo').fill('150000');
  await rep.getByRole('button', { name: 'Guardar reparación' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('$ 3.150.000').first()).toBeVisible(); // 3.000.000 + 150.000
  // La reparación con pieza queda en el historial de piezas
  await expect(page.getByTestId('parts-list').getByText('Batería')).toBeVisible();
  await expect(page.getByTestId('parts-list').getByText('· reparación registrada')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/pro-unidad.png`, fullPage: true });

  // Cambiar a sencillo y volver: los datos siguen ahí
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: 'Cambiar a modo sencillo' }).click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByText('Sencillo').first()).toBeVisible();
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: 'Cambiar a modo profesional' }).click();
  await page.getByTestId('ask-confirm').click();
  await page.goto('/#/buscar?q=351111111111111');
  await expect(page.getByText('IPH-0001')).toBeVisible();
  await page.getByText('IPH-0001').click();
  await expect(page.getByText('Verificado por técnico')).toBeVisible();
  await expect(page.getByText('$ 3.150.000').first()).toBeVisible();
});

test('14-15. vista consolidada: suma sin duplicar y vende desde el inventario de origen', async ({ page }) => {
  await page.goto('/');
  const a = await createInventory(page, 'Inventario A');
  const b = await createInventory(page, 'Inventario B');
  await purchase(page, a, { phone: { model: 'iPhone 13', capacity: '128 GB' } }, 3, 1_400_000);
  await purchase(page, b, { phone: { model: 'iPhone 13', capacity: '128 GB' } }, 2, 1_450_000);

  await page.goto('/#/vistas');
  await page.getByRole('button', { name: 'Nueva vista' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Todo');
  await dlg.getByLabel('Inventario A').check();
  await dlg.getByLabel('Inventario B').check();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();
  const viewUrl = page.url();
  await expect(page.getByTestId('view-group-total')).toHaveText('5');
  await page.screenshot({ path: `${SHOTS}/vista-consolidada.png`, fullPage: true });

  // Vender desde la vista: hay stock en dos inventarios → pide elegir el origen
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page.getByRole('dialog', { name: '¿Desde qué inventario vendes?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /Inventario A/ }).click();
  await expect(page.locator('#sa-inv')).toHaveValue(a);
  await page.locator('#sa-p-0').fill('2000000');
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();

  await page.goto(viewUrl);
  await expect(page.getByTestId('view-group-total')).toHaveText('4');
  await page.goto(`/#/inventarios/${a}`);
  await expect(page.getByText('2 disp.')).toBeVisible();
  await page.goto(`/#/inventarios/${b}`);
  await expect(page.getByText('2 disp.')).toBeVisible();

  // Eliminar la vista no toca los inventarios
  await page.goto(viewUrl);
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: 'Eliminar vista' }).click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByRole('heading', { name: 'Vistas consolidadas' })).toBeVisible();
  await expect(page.getByText('Aún no hay vistas')).toBeVisible();
  await page.goto(`/#/inventarios/${a}`);
  await expect(page.getByText('2 disp.')).toBeVisible();
});
