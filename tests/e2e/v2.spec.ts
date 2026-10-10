import { copyFileSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SCHEMA_V1 } from '../../src/core/db';
import { createInventory, docShot, SHOTS } from './helpers';

async function setFee(page: Page, method: string, pct: string) {
  await page.goto('/#/ajustes');
  await page.locator(`#fee-${method}`).fill(pct);
  await page.getByTestId('save-settings').click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();
}

test('v2 · capital, compra con tarjeta, piezas, precio sugerido, comisión, abono y resumen (modo sencillo)', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await setFee(page, 'Tarjeta', '3');

  // Aporte inicial
  await page.goto('/#/capital');
  await page.getByRole('button', { name: 'Aporte', exact: true }).click();
  await page.locator('#cm-amount').fill('10000000');
  await page.getByTestId('save-capital').click();
  await expect(page.getByTestId('kpi-cash')).toContainText('$ 10.000.000');
  await expect(page.getByTestId('kpi-business-value')).toContainText('$ 10.000.000');

  // Compra con tarjeta de crédito, estado "Usado" y pieza genérica con aviso
  await page.goto(`/#/compras/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir o crear producto/ }).click();
  await page.getByRole('button', { name: 'Crear producto nuevo' }).click();
  const np = page.getByRole('dialog', { name: 'Nuevo producto' });
  await np.getByLabel('Modelo').selectOption({ label: 'iPhone 13' });
  await np.getByRole('group', { name: 'Capacidad' }).getByRole('button', { name: '128 GB' }).click();
  await np.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#pu-q-0').fill('1');
  await page.locator('#pu-p-0').fill('1500000');
  await page.getByRole('group', { name: 'Estado del equipo' }).getByRole('button', { name: 'Usado' }).click();
  await page.getByText(/Batería y piezas cambiadas por equipo/).click();
  await page.getByRole('button', { name: 'Agregar pieza cambiada' }).click();
  const part = page.getByRole('dialog', { name: 'Agregar pieza cambiada' });
  await part.getByRole('group', { name: 'Pieza' }).getByRole('button', { name: 'Pantalla' }).click();
  await part.getByRole('group', { name: 'Calidad' }).getByRole('button', { name: 'Genérica' }).click();
  await part.getByLabel('¿Quién la cambió?').selectOption({ label: 'Proveedor' });
  await part.getByLabel(/pieza desconocida/).check();
  await part.getByRole('button', { name: 'Guardar pieza' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('group', { name: 'Forma de pago de la compra' }).getByRole('button', { name: 'Tarjeta de crédito' }).click();
  await page.locator('#pu-cred').fill('Visa');
  await expect(page.getByText(/Se creará una deuda por \$\s1\.500\.000/)).toBeVisible();
  await page.getByRole('button', { name: 'Revisar y registrar compra' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmar compra' })).toContainText('Queda como deuda');
  await page.getByTestId('confirm-purchase').click();
  await expect(page.getByRole('heading', { name: 'Compra', exact: true })).toBeVisible();
  await expect(page.getByText(/Deuda · Visa/)).toBeVisible();

  // Ficha del equipo: estado, piezas y etiquetas
  await page.getByRole('link', { name: 'Unidad 1' }).click();
  await expect(page.getByText('1 pieza cambiada').first()).toBeVisible();
  await expect(page.getByText('Pieza desconocida').first()).toBeVisible();
  await expect(page.getByTestId('parts-list')).toContainText('Pantalla');
  await expect(page.getByTestId('parts-list')).toContainText('Genérica');
  await docShot(page, 'v2-unidad-piezas');

  // Precio de mercado
  await page.goto('/#/precios');
  await page.getByTestId('add-market-price').click();
  await page.locator('#mp-model').fill('iPhone 13');
  await page.locator('#mp-cap').fill('128 GB');
  await page.locator('#mp-price').fill('2000000');
  await page.getByTestId('save-market-price').click();
  await expect(page.getByTestId('market-row')).toContainText('iPhone 13 128 GB · Usado');
  await expect(page.getByTestId('market-row')).toContainText('$ 2.000.000');
  await docShot(page, 'v2-precios');

  // Venta con ayuda de precio, aviso por debajo del costo y comisión de tarjeta
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /iPhone 13/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('price-hints')).toContainText('Mercado $ 2.000.000');
  await expect(page.getByTestId('price-hints')).toContainText('Costo $ 1.500.000');
  await page.locator('#sa-p-0').fill('1400000');
  await expect(page.getByText(/por debajo del costo/)).toBeVisible();
  await page.getByRole('button', { name: /Usar sugerido/ }).click();
  await expect(page.locator('#sa-p-0')).toHaveValue('2.000.000');
  await page.locator('#sa-method').selectOption('Tarjeta');
  await expect(page.getByTestId('fee-box')).toContainText('$ 60.000');
  await docShot(page, 'v2-venta-precio');
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();

  // Abono a la tarjeta con intereses
  await page.goto('/#/deudas');
  await expect(page.getByTestId('kpi-owed')).toContainText('$ 1.500.000');
  await page.getByTestId('debt-item').click();
  await page.getByTestId('pay-debt').click();
  await page.locator('#pd-p').fill('500000');
  await page.locator('#pd-i').fill('20000');
  await page.getByTestId('save-payment').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('$ 1.000.000').first()).toBeVisible();
  await docShot(page, 'v2-deuda');

  // Capital: caja 11.420.000; valor 10.420.000; crecimiento 420.000 (= 2.000.000 − 1.500.000 − 60.000 − 20.000)
  await page.goto('/#/capital');
  await expect(page.getByTestId('kpi-cash')).toContainText('$ 11.420.000');
  await expect(page.getByTestId('kpi-business-value')).toContainText('$ 10.420.000');
  await expect(page.getByTestId('kpi-growth')).toContainText('$ 420.000');
  await expect(page.getByTestId('money-breakdown')).toContainText('Deudas');
  await expect(page.locator('figure.chart').first()).toBeVisible();
  await docShot(page, 'v2-capital');

  // Calculadora "¿Cuánto pagar?": margen por defecto 250.000 → máximo 1.750.000
  await page.goto('/#/calculadora');
  await page.locator('#calc-row').selectOption({ index: 1 });
  await expect(page.getByTestId('max-buy')).toContainText('$ 1.750.000');
  await docShot(page, 'v2-calculadora');

  // Rentabilidad: ganancia por día y proveedor (sin proveedor = no aparece en calificaciones)
  await page.goto('/#/informes?tab=rentabilidad');
  await expect(page.getByTestId('profit-per-day')).toContainText('iPhone 13');

  // Resumen mensual: imagen y PDF (en el navegador de pruebas se descargan)
  await page.goto('/#/resumen');
  await page.getByLabel('Mes', { exact: true }).selectOption({ index: 0 });
  await expect(page.getByText('$ 420.000').first()).toBeVisible();
  await docShot(page, 'v2-resumen');
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-png').click()]);
  expect(png.suggestedFilename()).toMatch(/^resumen-\d{4}-\d{2}\.png$/);
  const pngBytes = readFileSync((await png.path())!);
  copyFileSync((await png.path())!, `${SHOTS}/v2-resumen-imagen.png`);
  expect(pngBytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(pngBytes.length).toBeGreaterThan(20_000);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-pdf').click()]);
  expect(pdf.suggestedFilename()).toMatch(/^resumen-\d{4}-\d{2}\.pdf$/);
  const pdfBytes = readFileSync((await pdf.path())!);
  expect(pdfBytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(pdfBytes.subarray(-6).toString('latin1')).toContain('%%EOF');
});

test('v2 · ayuda: primeros pasos, "?" por pantalla, buscador, Llévame ahí, ⓘ y manual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('getting-started')).toContainText('0 de 7 listos');
  await page.getByLabel('Nombre').fill('Tienda');
  await page.getByRole('button', { name: 'Crear inventario' }).click();
  await page.goto('/');
  await expect(page.getByTestId('getting-started')).toContainText('1 de 7 listos');

  await page.getByTestId('help-btn').click();
  const dlg = page.getByRole('dialog', { name: 'Ayuda · Inicio' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /Cómo empezar/ }).click();
  await expect(page.getByRole('heading', { name: 'Cómo empezar' })).toBeVisible();
  await page.getByTestId('take-me').click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  await page.goto('/#/ayuda');
  await docShot(page, 'v2-ayuda');
  await page.getByTestId('help-search').fill('tarjeta de credito');
  await expect(page.getByTestId('help-results')).toContainText('Deudas y préstamos');
  await page.getByTestId('help-results').getByRole('link', { name: /Deudas y préstamos/ }).click();
  await page.getByTestId('take-me').click();
  await expect(page.getByRole('heading', { name: 'Deudas y préstamos' })).toBeVisible();

  await page.getByRole('button', { name: '¿Qué es Lo que debes?' }).click();
  const tip = page.getByRole('dialog', { name: 'Deudas' });
  await expect(tip).toContainText('Cómo se calcula');
  await page.keyboard.press('Escape');

  await page.goto('/#/ayuda/manual');
  await expect(page.getByTestId('manual')).toContainText('Glosario de números');
  expect(await page.locator('.manual-article').count()).toBeGreaterThanOrEqual(25);

  // Ver la ayuda cuenta como paso hecho
  await page.goto('/');
  await expect(page.getByTestId('getting-started')).toContainText('2 de 7 listos');
});

test('v2 · modo práctica usa una base aparte y no toca los datos reales', async ({ page }) => {
  await page.goto('/');
  await createInventory(page, 'Inventario real');
  await page.goto('/#/ayuda');
  await page.getByTestId('practice-enter').click();
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await page.goto('/#/inventarios');
  await expect(page.getByText('Práctica').first()).toBeVisible();
  await expect(page.getByText('Inventario real')).toHaveCount(0);
  await page.goto('/#/capital');
  await expect(page.getByTestId('kpi-business-value')).not.toContainText('$ 0');
  await docShot(page, 'v2-practica');
  await page.getByTestId('practice-banner').getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toHaveCount(0);
  await page.goto('/#/inventarios');
  await expect(page.getByText('Inventario real')).toBeVisible();
  await expect(page.getByText('Práctica')).toHaveCount(0);
});

test('v2 · actualización real desde una base de la v1 en el navegador: conserva los datos y muestra novedades', async ({ page }) => {
  const at = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const data: Record<string, unknown[]> = {
    meta: [
      { key: 'installationId', value: 'instalacion-v1' },
      { key: 'createdAt', value: at },
    ],
    settings: [{ key: 'app', businessName: 'Tienda v1', defaultMode: 'simple', prefixes: { iphone: 'IPH', phone: 'TEL', audio: 'AUD', accessory: 'ACC', other: 'OTR' }, staleDays: 60, warrantyAlertDays: 15, backupReminderDays: 7, conditions: ['Nuevo', 'Usado', 'Reacondicionado'] }],
    counters: [
      { prefix: 'code:IPH', value: 1 },
      { prefix: '#movement', value: 1 },
    ],
    inventories: [{ id: 'inv1', name: 'Mi tienda v1', mode: 'simple', archived: false, archivedAt: null, notes: '', createdAt: at, updatedAt: at }],
    products: [
      { id: 'p1', inventoryId: 'inv1', kind: 'phone', tracking: 'unit', name: 'iPhone 12 128 GB', brand: 'Apple', model: 'iPhone 12', variant: '', reference: '', capacity: '128 GB', color: '', catalogModelId: null, salePrice: null, lowStockThreshold: null, location: '', notes: '', qty: 0, stockValue: 0, unknownCostQty: 0, archived: false, createdAt: at, updatedAt: at },
    ],
    purchases: [{ id: 'pu1', opId: 'op1', inventoryId: 'inv1', supplierId: null, date: at, paymentMethod: '', notes: '', subtotal: 1_200_000, extraCosts: 0, allocation: 'value', total: 1_200_000, status: 'active', voidedAt: null, voidReason: '', createdAt: at }],
    purchaseLines: [{ id: 'pl1', purchaseId: 'pu1', inventoryId: 'inv1', productId: 'p1', quantity: 1, price: 1_200_000, allocatedExtra: 0, totalCost: 1_200_000, unitIds: ['u1'] }],
    units: [
      { id: 'u1', productId: 'p1', inventoryId: 'inv1', code: 'IPH-0001', status: 'available', archivedReason: '', acquiredAt: at, availableSince: at, cycle: 1, baseCost: 1_200_000, extraCost: 0, source: 'purchase', purchaseId: 'pu1', purchaseLineId: 'pl1', supplierId: null, saleId: null, saleLineId: null, imei: '', imei2: '', serial: '', color: '', capacity: '128 GB', condition: 'Reacondicionado', batteryHealth: 90, inspection: null, defects: '', replacedParts: '', includedAccessories: '', notes: '', createdAt: at, updatedAt: at },
    ],
    movements: [{ id: 'm1', at, createdAt: at, seq: 1, inventoryId: 'inv1', productId: 'p1', unitId: 'u1', type: 'purchase', qtyDelta: 1, costDelta: 1_200_000, unknownDelta: 0, writeOff: 0, refType: 'purchase', refId: 'pu1', notes: '' }],
    history: [{ id: 'h1', at, entityType: 'purchase', entityId: 'pu1', inventoryId: 'inv1', action: 'create', summary: 'Compra registrada' }],
  };
  // Página del mismo origen que NO abre la app, para crear la base v1 tal como la dejaba la versión 1 (Dexie v1 = IndexedDB 10)
  await page.goto('/manifest.webmanifest');
  await page.evaluate(
    async ({ schema, data }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('inventario-movil', 10);
        req.onupgradeneeded = () => {
          const idb = req.result;
          for (const [table, spec] of Object.entries(schema)) {
            const [pk, ...idx] = spec.split(',').map((x) => x.trim());
            const store = idb.createObjectStore(table, { keyPath: pk });
            for (const i of idx) {
              const unique = i.startsWith('&');
              const name = unique ? i.slice(1) : i;
              store.createIndex(name, name, { unique });
            }
          }
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(Object.keys(data), 'readwrite');
          for (const [t, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(t).put(r);
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { schema: SCHEMA_V1, data },
  );

  await page.goto('/');
  const news = page.getByRole('dialog', { name: '¡Novedades!' });
  await expect(news).toBeVisible();
  await expect(news).toContainText('Capital del negocio');
  await docShot(page, 'v2-novedades', false);
  await page.getByTestId('news-ok').click();
  await expect(news).toHaveCount(0);

  await page.goto('/#/inventarios');
  await expect(page.getByText('Mi tienda v1')).toBeVisible();
  await page.goto('/#/unidades/u1');
  await expect(page.getByText('Restaurado').first()).toBeVisible();
  await expect(page.getByText('Reparaciones y piezas')).toBeVisible();
  await page.goto('/#/compras/pu1');
  await expect(page.getByText('La caja')).toBeVisible();
  await page.goto('/#/ajustes');
  await expect(page.locator('#st-cond')).toHaveValue('Nuevo, Usado, Restaurado');
  await page.goto('/#/capital');
  await expect(page.getByTestId('kpi-business-value')).toContainText('$ 0');
  await expect(page.getByText('Registra el dinero con el que empezaste')).toBeVisible();
  // Las novedades no vuelven a salir
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Capital' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '¡Novedades!' })).toHaveCount(0);
});
