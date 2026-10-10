import { expect, test } from '@playwright/test';
import { createInventory, purchase, sell, SHOTS } from './helpers';

// Capturas de referencia (docs/capturas) de las pantallas principales, en claro y oscuro.
test('capturas de pantallas principales', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const inv = await createInventory(page, 'Tienda', 'Profesional');
  await purchase(page, inv, { phone: { model: 'iPhone 14', capacity: '128 GB' } }, 3, 1_350_000, { imeis: ['350000000000011', '350000000000012', '350000000000013'], extra: 60_000 });
  await purchase(page, inv, { accessory: 'AirPods 4 (caja sellada)' }, 6, 420_000);
  await sell(page, inv, 'iPhone 14 128 GB', 1, 1_900_000, { partial: 900_000 });

  await page.goto(`/#/inventarios/${inv}`);
  await page.screenshot({ path: `${SHOTS}/inventario-pro.png` });

  await page.goto(`/#/compras/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir o crear producto/ }).click();
  await page.getByRole('button', { name: 'Crear producto nuevo' }).click();
  await page.getByRole('dialog', { name: 'Nuevo producto' }).getByLabel('Modelo').selectOption({ label: 'iPhone 16 Pro' });
  await page.screenshot({ path: `${SHOTS}/producto-nuevo.png` });
  await page.getByRole('dialog').getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: '256 GB' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Crear producto' }).click();
  await page.locator('#pu-q-0').fill('2');
  await page.locator('#pu-p-0').fill('3900000');
  await page.locator('#pu-extra').fill('50000');
  await page.screenshot({ path: `${SHOTS}/compra-formulario.png`, fullPage: true });

  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.screenshot({ path: `${SHOTS}/venta-elegir-producto.png` });
  await page.getByRole('dialog').getByRole('button', { name: /iPhone 14/ }).click();
  await page.getByRole('button', { name: 'Elegir unidades específicas' }).click();
  await page.screenshot({ path: `${SHOTS}/venta-elegir-unidades.png` });
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await page.getByRole('dialog').getByRole('button', { name: /Usar 1 unidad/ }).click();
  await page.locator('#sa-p-0').fill('1950000');
  await page.screenshot({ path: `${SHOTS}/venta-formulario.png`, fullPage: true });
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.screenshot({ path: `${SHOTS}/venta-confirmar.png` });
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();

  await page.goto('/#/informes?tab=tiempos');
  await page.screenshot({ path: `${SHOTS}/informes-tiempos.png`, fullPage: true });
  await page.goto('/#/respaldo');
  await page.screenshot({ path: `${SHOTS}/respaldo.png`, fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/inicio-oscuro.png`, fullPage: true });
  await page.goto(`/#/inventarios/${inv}`);
  await page.screenshot({ path: `${SHOTS}/inventario-oscuro.png` });
});
