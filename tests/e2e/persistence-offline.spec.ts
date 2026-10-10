import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInventory, purchase, sell } from './helpers';

const BASE = 'http://localhost:4173';

test('19. los datos sobreviven a recargar, cerrar el navegador y volver a abrir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inv-persist-'));
  const opts = { viewport: { width: 390, height: 844 }, locale: 'es-CO', timezoneId: 'America/Bogota', baseURL: BASE };
  try {
    let ctx = await chromium.launchPersistentContext(dir, opts);
    let page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('/');
    const inv = await createInventory(page, 'Persistente');
    await purchase(page, inv, { accessory: 'Cable Lightning' }, 7, 15_000);
    await sell(page, inv, 'Cable Lightning', 2, 30_000);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
    // Cierre "forzado": se cierra el navegador completo sin pasos de guardado
    await ctx.close();

    ctx = await chromium.launchPersistentContext(dir, opts);
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`/#/inventarios/${inv}`);
    await expect(page.getByRole('heading', { name: 'Persistente' })).toBeVisible();
    await expect(page.getByText('5 disp.')).toBeVisible();
    await page.goto('/#/operaciones?tab=ventas');
    await expect(page.locator('a[href^="#/ventas/"]')).toHaveCount(1);
    await ctx.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('20. funciona sin conexión después de la primera carga (service worker)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Asegurar que la página esté controlada por el service worker
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' });
      return false;
    } catch {
      return true;
    }
  });
  expect(offline).toBe(true);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  const inv = await createInventory(page, 'Sin internet');
  await purchase(page, inv, { phone: { model: 'iPhone 12', capacity: '64 GB' } }, 1, 900_000);
  await sell(page, inv, 'iPhone 12 64 GB', 1, 1_200_000);
  await page.goto(`/#/inventarios/${inv}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sin internet' })).toBeVisible();
  await context.setOffline(false);
});
