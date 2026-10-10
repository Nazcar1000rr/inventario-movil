import { expect, test } from '@playwright/test';
import { createInventory, freshApp, purchase, sell, SHOTS } from './helpers';

test('flujo completo en modo sencillo: compra, venta parcial, pago, devolución y panel', async ({ page }) => {
  await freshApp(page);
  const inv = await createInventory(page, 'Local centro', 'Sencillo');
  await purchase(page, inv, { phone: { model: 'iPhone 13', capacity: '128 GB' } }, 2, 1_500_000, { extra: 40_000 });
  await expect(page.getByText('3.040.000').first()).toBeVisible(); // total compra
  await purchase(page, inv, { accessory: 'Cargador USB-C 20 W' }, 10, 20_000);

  // Inventario muestra existencias
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByText('iPhone 13 128 GB')).toBeVisible();
  await expect(page.getByText('2 disp.')).toBeVisible();
  await expect(page.getByText('10 disp.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/flow-inventario.png`, fullPage: true });

  // Venta con pago parcial
  const saleId = await sell(page, inv, 'iPhone 13 128 GB', 1, 2_100_000, { partial: 1_000_000 });
  await expect(page.getByText('Pago parcial').first()).toBeVisible();
  await expect(page.getByText('1.100.000').first()).toBeVisible(); // pendiente
  // ganancia de la venta: 2.100.000 − 1.520.000 (costo con gastos repartidos)
  await expect(page.getByText('580.000').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/flow-venta.png`, fullPage: true });

  // Registrar el resto del pago
  await page.getByRole('button', { name: /Registrar pago/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Pagada').first()).toBeVisible();

  // Stock: queda 1 iPhone
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByText('1 disp.')).toBeVisible();

  // Devolución: vuelve como pendiente de inspección; la venta original se conserva
  await page.goto(`/#/ventas/${saleId}`);
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  const dlg = page.getByRole('dialog', { name: 'Registrar devolución' });
  await dlg.getByRole('checkbox').first().check();
  await dlg.getByLabel('Motivo').fill('No enciende');
  await dlg.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(page.getByText('Devuelta').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Devoluciones' })).toBeVisible();

  // Panel de inicio con datos
  await page.goto('/');
  await expect(page.getByTestId('kpi-stock')).toContainText('11');
  await page.screenshot({ path: `${SHOTS}/flow-inicio.png`, fullPage: true });

  // Vender más de lo disponible: la app lo impide
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Cargador/ }).click();
  await page.locator('#sa-q-0').fill('11');
  await page.locator('#sa-p-0').fill('30000');
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await expect(page.getByText(/Stock insuficiente/)).toBeVisible();
});

test('la confirmación evita ventas duplicadas por doble pulsación', async ({ page }) => {
  await freshApp(page);
  const inv = await createInventory(page, 'Doble pulsación');
  await purchase(page, inv, { accessory: 'Funda' }, 5, 10_000);
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Funda/ }).click();
  await page.locator('#sa-p-0').fill('25000');
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  const btn = page.getByTestId('confirm-sale');
  // Tres pulsaciones seguidas
  await btn.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
    b.click();
  });
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  await page.goto('/#/operaciones?tab=ventas');
  await expect(page.locator('a[href^="#/ventas/"]')).toHaveCount(1);
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByText('4 disp.')).toBeVisible();
});
