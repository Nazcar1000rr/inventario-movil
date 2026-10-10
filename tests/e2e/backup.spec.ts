import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { confirmTyped, createInventory, purchase, sell, SHOTS } from './helpers';

async function exportBackup(page: Page, password?: string): Promise<string> {
  await page.goto('/#/respaldo');
  if (password) {
    await page.getByLabel('Proteger con contraseña (cifrado AES-256)').check();
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByLabel('Repetir contraseña').fill(password);
  }
  await page.getByTestId('prepare-backup').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-backup').click();
  const d = await dl;
  const path = `test-results/${d.suggestedFilename()}`;
  await d.saveAs(path);
  return path;
}

async function wipeAll(page: Page) {
  await page.goto('/#/ajustes');
  await page.getByRole('button', { name: 'Borrar todos los datos' }).click();
  await confirmTyped(page, 'BORRAR');
  await expect(page.getByText('Empiece creando su primer inventario')).toBeVisible();
}

async function chooseFile(page: Page, path: string) {
  await page.goto('/#/respaldo');
  const fc = page.waitForEvent('filechooser');
  await page.getByTestId('choose-backup').click();
  await (await fc).setFiles(path);
}

test('16-18. exportar, restaurar en instalación vacía, rechazar archivos dañados y reemplazar con confirmación', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Para respaldar', 'Profesional');
  await purchase(page, inv, { phone: { model: 'iPhone 14 Pro', capacity: '256 GB' } }, 2, 2_800_000, { imeis: ['356789012345671', '356789012345672'] });
  await purchase(page, inv, { accessory: 'Protector de pantalla' }, 20, 5_000);
  await sell(page, inv, 'iPhone 14 Pro 256 GB', 1, 3_500_000, 'pending');

  const file = await exportBackup(page);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.format).toBe('inventario-movil-backup');
  expect(json.payload.counts.units).toBe(2);

  // Instalación "vacía": se borran todos los datos y se restaura
  await wipeAll(page);
  await chooseFile(page, file);
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await expect(page.getByText('Verificación de integridad correcta')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/backup-resumen.png`, fullPage: true });
  await page.getByTestId('restore-backup').click();
  await expect(page.getByTestId('restore-done')).toContainText('2 unidad(es)');
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByRole('heading', { name: 'Para respaldar' })).toBeVisible();
  await expect(page.getByText('1 disp.')).toBeVisible();
  await page.goto('/#/operaciones?tab=ventas&f=pendientes');
  await expect(page.locator('a[href^="#/ventas/"]')).toHaveCount(1);

  // Archivo dañado (alterado): no se importa nada
  const tampered = 'test-results/alterado.json';
  writeFileSync(tampered, readFileSync(file, 'utf8').replace('356789012345671', '356789012345679'));
  await chooseFile(page, tampered);
  await expect(page.getByText('No se puede importar este archivo')).toBeVisible();
  await expect(page.getByText(/suma de verificación no coincide/)).toBeVisible();
  const truncated = 'test-results/truncado.json';
  writeFileSync(truncated, readFileSync(file, 'utf8').slice(0, 500));
  await chooseFile(page, truncated);
  await expect(page.getByText(/no es un respaldo válido/)).toBeVisible();
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByText('1 disp.')).toBeVisible(); // datos intactos

  // Reemplazo con datos existentes: exige escribir REEMPLAZAR y permite deshacer
  await purchase(page, inv, { existing: 'Protector de pantalla' }, 5, 5_000);
  await chooseFile(page, file);
  await expect(page.getByText('Este dispositivo ya tiene datos')).toBeVisible();
  await expect(page.getByText(/Combinar dos instalaciones no está disponible/)).toBeVisible();
  await page.getByTestId('restore-backup').click();
  await confirmTyped(page, 'REEMPLAZAR');
  await expect(page.getByTestId('restore-done')).toBeVisible();
  await page.goto('/#/operaciones?tab=compras');
  await expect(page.locator('a[href^="#/compras/"]')).toHaveCount(2); // la compra posterior ya no está
  await page.goto('/#/respaldo');
  await page.getByRole('button', { name: 'Volver a los datos anteriores' }).click();
  await page.getByTestId('ask-confirm').click();
  await page.goto('/#/operaciones?tab=compras');
  await expect(page.locator('a[href^="#/compras/"]')).toHaveCount(3);
});

test('respaldo cifrado con contraseña', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Cifrado');
  await purchase(page, inv, { accessory: 'AirTag' }, 3, 90_000);
  const file = await exportBackup(page, 'secreto123');
  expect(readFileSync(file, 'utf8')).not.toContain('AirTag');
  await wipeAll(page);
  await chooseFile(page, file);
  await page.getByLabel('Contraseña del respaldo').fill('incorrecta');
  await page.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(page.getByText(/Contraseña incorrecta/)).toBeVisible();
  await chooseFile(page, file);
  await page.getByLabel('Contraseña del respaldo').fill('secreto123');
  await page.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await page.getByTestId('restore-backup').click();
  await expect(page.getByTestId('restore-done')).toBeVisible();
  await page.goto(`/#/inventarios/${inv}`);
  await expect(page.getByText('3 disp.')).toBeVisible();
});
