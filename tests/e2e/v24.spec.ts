import { expect, test } from '@playwright/test';
import { createInventory, docShot, freshApp, noHorizontalOverflow, purchase, sell } from './helpers';

test('v2.4: Operaciones por categorías (estado de cobro, proveedor y categoría de gasto)', async ({ page }) => {
  test.setTimeout(120_000);
  await freshApp(page);
  const inv = await createInventory(page, 'Local centro', 'Sencillo');
  await purchase(page, inv, { phone: { model: 'iPhone 13', capacity: '128 GB' } }, 2, 1_500_000);
  await sell(page, inv, 'iPhone 13 128 GB', 1, 2_100_000, { partial: 1_000_000 });
  await sell(page, inv, 'iPhone 13 128 GB', 1, 2_000_000, 'full');

  for (const [cat, amount] of [['Publicidad', '80000'], ['Empaques', '15000']] as const) {
    await page.goto('/#/gastos/nuevo');
    await page.getByLabel('Valor').fill(amount);
    await page.getByLabel('Categoría').selectOption(cat);
    await page.getByRole('button', { name: 'Guardar gasto' }).click();
    await expect(page.getByRole('heading', { name: 'Gasto', exact: true })).toBeVisible();
  }

  // Ventas: por defecto por fecha (sin grupos); por estado de cobro → grupos
  await page.goto('/#/operaciones?tab=ventas');
  await expect(page.getByTestId('grouped-list')).toHaveCount(0);
  await page.getByRole('group', { name: 'Ver' }).getByRole('button', { name: 'Por estado de cobro' }).click();
  const grouped = page.getByTestId('grouped-list');
  await expect(grouped.getByRole('button', { name: /Por cobrar/ })).toContainText('1.100.000');
  await expect(grouped.getByRole('button', { name: /Pagadas/ })).toContainText('2.000.000');
  await expect(grouped.getByRole('button', { name: /Anuladas/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await docShot(page, 'v24-operaciones-ventas-estado');

  // Plegar y desplegar un grupo
  const head = grouped.getByRole('button', { name: /Pagadas/ });
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');

  // La elección se recuerda al cambiar de pestaña
  await page.getByRole('group', { name: 'Tipo de operación' }).getByRole('button', { name: 'Gastos' }).click();
  await expect(page.getByRole('group', { name: 'Ver' }).getByRole('button', { name: 'Por categoría' })).toHaveAttribute('aria-pressed', 'true');
  await expect(grouped.getByRole('button', { name: /Publicidad/ })).toContainText('80.000');
  await expect(grouped.getByRole('button', { name: /Empaques/ })).toContainText('15.000');
  await noHorizontalOverflow(page);
  await docShot(page, 'v24-operaciones-gastos-categoria');

  // Compras: por proveedor (la compra no tiene proveedor)
  await page.getByRole('group', { name: 'Tipo de operación' }).getByRole('button', { name: 'Compras' }).click();
  await expect(grouped.getByRole('button', { name: /Sin proveedor/ })).toContainText('3.000.000');
  await docShot(page, 'v24-operaciones-compras-proveedor');

  // Volver a "Por fecha" quita los grupos
  await page.getByRole('group', { name: 'Ver' }).getByRole('button', { name: 'Por fecha' }).click();
  await expect(page.getByTestId('grouped-list')).toHaveCount(0);
});
