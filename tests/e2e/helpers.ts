import { expect, type Page } from '@playwright/test';

export const SHOTS = 'docs/capturas';

export async function freshApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
}

/** Crea un inventario desde la pantalla de inventarios y devuelve su id. */
export async function createInventory(page: Page, name: string, mode: 'Sencillo' | 'Profesional' = 'Sencillo'): Promise<string> {
  await page.goto('/#/inventarios');
  await page.getByRole('button', { name: 'Nuevo inventario' }).first().click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('group', { name: 'Modalidad' }).getByRole('button', { name: mode }).click();
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page.url().split('/inventarios/')[1];
}

export interface PhoneSpec {
  model: string;
  capacity?: string;
}

/** Registra una compra creando el producto desde el catálogo o el nombre indicado. */
export async function purchase(
  page: Page,
  invId: string,
  item: { phone?: PhoneSpec; accessory?: string; existing?: string },
  qty: number,
  unitPrice: number,
  opts: { imeis?: string[]; extra?: number } = {},
) {
  await page.goto(`/#/compras/nueva?inv=${invId}`);
  await page.getByRole('button', { name: /Elegir o crear producto/ }).click();
  if (item.existing) {
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(item.existing) }).first().click();
  } else {
    await page.getByRole('button', { name: 'Crear producto nuevo' }).click();
    const dlg = page.getByRole('dialog', { name: 'Nuevo producto' });
    if (item.phone) {
      await dlg.getByLabel('Modelo').selectOption({ label: item.phone.model });
      if (item.phone.capacity) await dlg.getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: item.phone.capacity }).click();
    } else if (item.accessory) {
      await dlg.getByRole('group', { name: 'Tipo de producto' }).getByRole('button', { name: 'Accesorio' }).click();
      await dlg.getByLabel('Nombre del producto').fill(item.accessory);
    }
    await dlg.getByRole('button', { name: 'Crear producto' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#pu-q-0').fill(String(qty));
  await page.locator('#pu-p-0').fill(String(unitPrice));
  if (opts.extra) await page.locator('#pu-extra').fill(String(opts.extra));
  if (opts.imeis) {
    await page.getByText('IMEI, serial y estado por unidad (opcional)').click();
    for (let i = 0; i < opts.imeis.length; i++) await page.locator(`#ud-imei-${i}`).fill(opts.imeis[i]);
  }
  await page.getByRole('button', { name: 'Revisar y registrar compra' }).click();
  await page.getByTestId('confirm-purchase').click();
  await expect(page.getByRole('heading', { name: 'Compra', exact: true })).toBeVisible();
}

export async function sell(
  page: Page,
  invId: string,
  productName: string,
  qty: number,
  price: number,
  pay: 'full' | 'pending' | { partial: number } = 'full',
) {
  await page.goto(`/#/ventas/nueva?inv=${invId}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(productName) }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#sa-q-0').fill(String(qty));
  await page.locator('#sa-p-0').fill(String(price));
  const group = page.getByRole('group', { name: 'Estado del pago' });
  if (pay === 'pending') await group.getByRole('button', { name: 'Pendiente' }).click();
  else if (typeof pay === 'object') {
    await group.getByRole('button', { name: 'Parcial' }).click();
    await page.locator('#sa-partial').fill(String(pay.partial));
  }
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  return page.url().split('/ventas/')[1];
}

export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(r.sw, `ancho del documento ${r.sw} > ventana ${r.w}`).toBeLessThanOrEqual(r.w + 1);
}

export async function confirmTyped(page: Page, text: string) {
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox').fill(text);
  await dlg.getByTestId('ask-confirm').click();
}
