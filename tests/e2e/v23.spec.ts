import { expect, test } from '@playwright/test';
import { createInventory, docShot, purchase, sell } from './helpers';

test('v2.3 · corregir una compra mal digitada: cantidad, ventas recalculadas y precio de venta', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  // Se digitaron 10 a 10 000, pero llegaron 8 (se pagó lo mismo: 100 000)
  await purchase(page, inv, { accessory: 'Cargador USB-C 20W' }, 10, 10_000);
  const purchaseUrl = page.url().split('#')[1];
  await sell(page, inv, 'Cargador USB-C 20W', 3, 15_000);

  await page.goto(`/#${purchaseUrl}`);
  await page.getByTestId('correct-line-btn-0').click();
  const sheet = page.getByRole('dialog', { name: 'Corregir compra' });
  await expect(sheet).toBeVisible();
  await sheet.locator('#cl-q-0').fill('8');
  await expect(sheet.getByRole('group', { name: 'Lo que pagaste' }).getByRole('button', { name: 'Pagué lo mismo en total' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('#cl-u-0')).toHaveValue('12.500');
  const preview = sheet.getByTestId('correction-preview');
  await expect(preview).toContainText('Se recalcula 1 venta');
  await expect(preview).toContainText(/costo \$\s30\.000 → \$\s37\.500/);
  await expect(preview).toContainText(/Tu ganancia baja \$\s7\.500/);
  await preview.scrollIntoViewIfNeeded();
  await docShot(page, 'v23-corregir-compra', false);
  await sheet.getByTestId('save-correction').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText(/Corregida el/)).toBeVisible();
  await expect(page.getByText(/\$\s12\.500/).first()).toBeVisible();

  // Precio de venta desde la compra
  await page.getByTestId('sale-price-btn-0').click();
  const sp = page.getByRole('dialog', { name: 'Precio de venta' });
  await sp.locator('#sp-price').fill('18000');
  await sp.getByTestId('save-sale-price').click();
  await expect(sp).toHaveCount(0);
  await expect(page.getByText(/\$\s18\.000/)).toBeVisible();

  // Ficha del producto: entrada corregida, movimientos de corrección y precio de venta
  await page.getByRole('link', { name: 'Cargador USB-C 20W' }).click();
  await expect(page.getByTestId('lots-list').locator('li').first()).toContainText(/5 disp\. · \$\s12\.500 c\/u/);
  await expect(page.getByTestId('lots-list')).toContainText('Corregida');
  await expect(page.getByText(/Corrección · Venta/)).toBeVisible();
  await page.getByTestId('edit-sale-price').click();
  await page.locator('#sp-price').fill('20000');
  await expect(page.getByRole('dialog')).toContainText(/Ganarías \$\s7\.500 por unidad/);
  await page.getByTestId('save-sale-price').click();
  await expect(page.getByTestId('kpi-sale-price')).toContainText(/\$\s20\.000/);

  // Corregir desde el lote lleva a la compra
  await page.getByTestId('lot-correct').first().click();
  await expect(page.getByRole('dialog', { name: 'Corregir compra' })).toBeVisible();
});

test('v2.3 · corregir stock que ya tenías (completar costo desconocido)', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await page.goto(`/#/stock/nuevo?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir o crear producto/ }).click();
  await page.getByRole('button', { name: 'Crear producto nuevo' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nuevo producto' });
  await dlg.getByRole('group', { name: 'Tipo de producto' }).getByRole('button', { name: 'Accesorio' }).click();
  await dlg.getByLabel('Nombre del producto').fill('Funda iPhone 13');
  await dlg.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#se-q').fill('6');
  await page.getByLabel(/No sé el costo/).check();
  await page.getByRole('button', { name: /^Registrar 6 unidad/ }).click();
  await expect(page.getByTestId('lots-list')).toBeVisible();
  await sell(page, inv, 'Funda iPhone 13', 2, 25_000);
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText('Funda iPhone 13').click();
  await page.getByTestId('lot-correct').first().click();
  const sheet = page.getByRole('dialog', { name: 'Corregir entrada' });
  // Sin costo conocido, el cursor va directo al costo
  await expect(sheet.locator('#lc-c')).toBeFocused();
  await sheet.locator('#lc-c').fill('9000');
  await expect(sheet.getByTestId('correction-preview')).toContainText(/costo desconocido → \$\s18\.000/);
  await sheet.getByTestId('save-lot-correction').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('lots-list').locator('li').first()).toContainText(/4 disp\. · \$\s9\.000 c\/u/);
});

test('v2.3 · análisis del negocio: salud, gráficas con valor al tocar, tabla y expectativa editable', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await purchase(page, inv, { accessory: 'Cable USB-C' }, 10, 10_000);
  await sell(page, inv, 'Cable USB-C', 4, 25_000);
  await page.goto('/#/analisis?tab=resumen');
  await expect(page.getByTestId('health-gauge')).toBeVisible();
  await expect(page.getByTestId('health-parts').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('insights')).toContainText('Si vendes todo lo que tienes');
  await docShot(page, 'v23-analisis-resumen');

  await page.goto('/#/analisis?tab=esperas');
  // 6 cables sin precio de venta → se usa el promedio de tus ventas (25 000): 6 × 15 000 = 90 000
  await expect(page.getByTestId('expected-profit')).toContainText(/\$\s90\.000/);

  await page.goto('/#/analisis?tab=tendencias');
  const chart = page.getByTestId('trend-chart');
  await chart.locator('.viz-hit').last().click();
  await expect(chart.locator('.viz-tip')).toContainText(/\$\s60\.000/);
  await chart.locator('..').getByText('Ver los números').first().click();
  await expect(page.locator('.viz-table[open] table')).toContainText(/\$\s100\.000/);
  await expect(page.getByTestId('compare-table')).toContainText('Ganancia neta');
  await docShot(page, 'v23-analisis-tendencias');

  // Expectativa del mes: la pones tú y luego vuelves a la automática
  await page.goto('/#/analisis?tab=metas');
  await page.getByTestId('edit-expectation-month').click();
  await page.locator('#ex-p').fill('200000');
  await page.locator('#ex-r').fill('500000');
  await page.getByTestId('save-expectation').click();
  await expect(page.getByTestId('expectation-month')).toContainText('La pusiste tú');
  await expect(page.getByTestId('expectation-month')).toContainText(/\$\s200\.000/);
  await page.getByRole('button', { name: 'Volver a la automática' }).click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByTestId('expectation-month')).toHaveCount(0); // sin meses anteriores no hay propuesta

  await page.goto('/#/analisis?tab=tiempo');
  await expect(page.getByTestId('avg-sell-days')).toBeVisible();
  await page.goto('/#/analisis?tab=flujo');
  await expect(page.getByTestId('profit-waterfall')).toContainText('Ganancia neta');
  await docShot(page, 'v23-analisis-flujo');
});

test('v2.3 · preguntones: +1 con fecha, "Me compró" resta y análisis', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await purchase(page, inv, { accessory: 'Funda' }, 5, 10_000);
  await page.goto('/');
  const counter = page.getByTestId('inquiry-counter');
  for (let i = 0; i < 3; i++) await counter.getByTestId('inquiry-add').click();
  await expect(counter.getByTestId('inquiry-today')).toHaveText('3');
  await expect(counter.getByTestId('inquiry-week')).toHaveText('3');
  await counter.getByRole('button', { name: 'Lo toqué por error' }).click();
  await expect(counter.getByTestId('inquiry-today')).toHaveText('2');
  await counter.getByTestId('inquiry-bought').click();
  await expect(counter.getByTestId('inquiry-today')).toHaveText('1');
  await sell(page, inv, 'Funda', 1, 20_000);
  await page.goto('/#/preguntones');
  await expect(page.getByTestId('inquiry-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('inquiry-list')).toContainText('Volvió y compró');
  // 1 preguntón + 1 venta = 2 personas por venta
  await expect(page.getByTestId('inquiry-stats')).toContainText(/Preguntan por cada venta\s*2/);
  await page.getByText('¿Qué es un preguntón y para qué sirve?').click();
  await expect(page.getByTestId('inquiry-explain')).toContainText('Me compró');
  await docShot(page, 'v23-preguntones');
});

test('v2.3 · calendario: nota con avisos elegidos, aviso dentro de la app y archivo para el calendario del teléfono', async ({ page }) => {
  await page.goto('/#/calendario');
  await page.getByTestId('note-new').click();
  const sheet = page.getByRole('dialog', { name: 'Nueva nota' });
  await sheet.locator('#nt-title').fill('Pagar el arriendo');
  await sheet.locator('#nt-desc').fill('Transferencia a don Luis');
  // Mañana, avisar 1 día antes (hoy) a las 00:00 → el aviso ya llegó
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await sheet.locator('#nt-day').fill(tomorrow);
  await sheet.getByTestId('remind-0').click(); // quita "el mismo día"
  await expect(sheet.getByTestId('remind-1')).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByTestId('remind-3').click();
  await sheet.locator('#nt-custom').fill('5');
  await sheet.getByRole('button', { name: 'Agregar' }).click();
  await expect(sheet.getByTestId('remind-5')).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('#nt-rt').fill('00:00');
  await docShot(page, 'v23-nota', false);
  await sheet.getByTestId('save-note').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(`[data-day="${tomorrow}"] .cal-dot`)).toBeVisible();
  await expect(page.getByTestId('due-reminders')).toContainText('Pagar el arriendo');
  await expect(page.getByTestId('due-reminders')).toContainText('Mañana');
  await docShot(page, 'v23-calendario');
  // En Inicio también aparece; "Listo" lo quita
  await page.goto('/');
  await expect(page.getByTestId('due-reminders')).toContainText('Pagar el arriendo');
  // Avisos de 5, 3 y 1 día antes: ya llegaron los tres
  await expect(page.getByTestId('reminder-seen')).toHaveCount(3);
  for (let i = 0; i < 3; i++) await page.getByTestId('reminder-seen').first().click();
  await expect(page.getByTestId('due-reminders')).toHaveCount(0);
  // Pasar al calendario del teléfono (.ics)
  await page.goto('/#/calendario');
  await page.locator(`[data-day="${tomorrow}"]`).click();
  await page.getByTestId('note-list').first().getByText('Pagar el arriendo').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ics-one').click()]);
  const path = await download.path();
  const fs = await import('node:fs');
  const ics = fs.readFileSync(path, 'utf8');
  expect(ics).toContain('SUMMARY:Pagar el arriendo');
  expect(ics).toContain('DESCRIPTION:Transferencia a don Luis');
  expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
});

test('v2.3 · me deben: fiar mercancía, abonos con fecha y "no me va a pagar"', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await purchase(page, inv, { accessory: 'Funda' }, 5, 10_000);
  await page.goto(`/#/ventas/nueva?inv=${inv}&fiado=1`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Funda/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#sa-q-0').fill('2');
  await page.locator('#sa-p-0').fill('25000');
  await expect(page.getByRole('group', { name: 'Estado del pago' }).getByRole('button', { name: 'Pendiente' })).toHaveAttribute('aria-pressed', 'true');
  const box = page.getByTestId('fiado-box');
  await box.getByRole('button', { name: /Sin comprador/ }).click();
  await page.getByRole('button', { name: /Nuevo comprador/ }).click();
  await page.locator('#pp-name').fill('Ana Pérez');
  await page.locator('#pp-phone').fill('3001234567');
  await page.getByRole('button', { name: 'Guardar comprador' }).click();
  await expect(box).toContainText('Ana Pérez');
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  await page.getByTestId('sale-debtor-link').click();

  // Ficha de la persona: abono parcial
  await expect(page.getByTestId('debtor-total')).toContainText(/\$\s50\.000/);
  await page.getByTestId('debtor-pay').click();
  await page.locator('#dp-amount').fill('20000');
  await page.getByTestId('save-debt-payment').click();
  await expect(page.getByTestId('debtor-total')).toContainText(/\$\s30\.000/);
  await expect(page.getByTestId('debtor-history')).toContainText(/\$\s20\.000/);
  await expect(page.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:3001234567');
  await docShot(page, 'v23-me-debe');

  // Otro fiado: plata prestada con recordatorio
  await page.goto('/#/me-deben');
  await expect(page.getByTestId('debtors-list')).toContainText('Ana Pérez');
  await page.getByTestId('add-credit').click();
  await page.getByRole('dialog', { name: 'Otro fiado' }).getByRole('button', { name: /Sin comprador/ }).click();
  await page.getByRole('dialog', { name: 'Elegir comprador' }).getByRole('button', { name: /Ana Pérez/ }).click();
  await page.locator('#cr-amount').fill('40000');
  await page.getByTestId('save-credit').click();
  await expect(page.getByTestId('debtor-total')).toContainText(/\$\s70\.000/);
  await docShot(page, 'v23-me-deben-persona');

  // No me va a pagar (la plata prestada) y deshacer
  await page.getByTestId('debt-items').locator('li').filter({ hasText: 'Le prestaste plata' }).getByTestId('forgive').click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByTestId('debtor-total')).toContainText(/\$\s30\.000/);
  await page.goto('/#/me-deben');
  await expect(page.getByTestId('debtors-kpis')).toContainText(/\$\s30\.000/);
  await docShot(page, 'v23-me-deben');
  await page.goto('/');
  await expect(page.getByTestId('kpi-receivables')).toContainText(/\$\s30\.000/);
});

test('v2.3 · los sonidos vuelven a sonar después de salir de la app y volver (audio interrumpido como en iPhone)', async ({ page }) => {
  await page.addInitScript(() => {
    type Any = Record<string, unknown>;
    const all: FakeCtx[] = [];
    class Param {
      value = 0;
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
      cancelScheduledValues() {}
    }
    const node = (extra: Any = {}) => ({ connect: (n: unknown) => n, ...extra });
    class FakeCtx {
      state = 'suspended';
      currentTime = 0;
      sampleRate = 44_100;
      destination = node();
      started = 0;
      stuck = false;
      constructor() {
        all.push(this);
      }
      resume() {
        if (this.stuck) return new Promise(() => undefined); // como el iPhone: nunca vuelve
        this.state = 'running';
        return Promise.resolve();
      }
      suspend() {
        this.state = 'suspended';
        return Promise.resolve();
      }
      close() {
        this.state = 'closed';
        return Promise.resolve();
      }
      createGain() {
        return node({ gain: new Param() });
      }
      createOscillator() {
        return node({ frequency: new Param(), start: () => this.started++, stop: () => undefined });
      }
      createBuffer() {
        return { sampleRate: 44_100, getChannelData: () => new Float32Array(8) };
      }
      createBufferSource() {
        return node({ start: () => this.started++, stop: () => undefined });
      }
      createBiquadFilter() {
        return node({ frequency: new Param(), Q: { value: 0 } });
      }
    }
    (window as unknown as Any).AudioContext = FakeCtx;
    (window as unknown as Any).__ctxs = all;
  });
  await page.goto('/');
  const tip = page.getByTestId('daily-tip').getByRole('button', { name: 'Otro consejo' });
  await tip.click();
  const count = () => page.evaluate(() => (window as unknown as { __ctxs: { started: number; state: string }[] }).__ctxs.map((c) => ({ started: c.started, state: c.state })));
  await expect.poll(async () => (await count())[0]?.started ?? 0).toBeGreaterThan(0);
  // Sales de la app: se pausa; el teléfono deja el audio "interrumpido" y ya no responde
  await page.evaluate(() => {
    const setVis = (v: string) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    setVis('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const c = (window as unknown as { __ctxs: { state: string; stuck: boolean }[] }).__ctxs[0];
    c.state = 'interrupted';
    c.stuck = true;
    setVis('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await tip.click();
  await expect.poll(async () => (await count()).length).toBe(2);
  await expect.poll(async () => (await count())[1].started).toBeGreaterThan(0);
  expect((await count())[0].state).toBe('closed');
  expect(await page.evaluate(() => (window as unknown as { __audio: () => { restarts: number; state: string } }).__audio())).toEqual({ restarts: 1, state: 'running' });
});
