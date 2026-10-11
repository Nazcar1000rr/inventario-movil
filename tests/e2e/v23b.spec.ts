import { expect, test, type Page } from '@playwright/test';
import { createInventory, docShot, purchase } from './helpers';

/** Voz simulada que sigue "hablando" hasta que se cancela (para probar la barra de lectura). */
async function slowSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    const voice = { name: 'Paulina', lang: 'es-MX', localService: true, voiceURI: 'paulina', default: true };
    let pending: { onend?: () => void }[] = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [voice],
        speak: (u: { text: string; onend?: () => void }) => {
          if (u.text.trim()) {
            w.__spoken.push(u.text);
            pending.push(u);
          }
        },
        cancel: () => {
          w.__spoken.push('<cancel>');
          pending = [];
        },
        addEventListener: () => undefined,
      },
    });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      constructor(t: string) {
        this.text = t;
      }
    };
  });
}

test('v2.3 · botón + y menú Más por categorías', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Registrar operación' }).click();
  const menu = page.getByTestId('quick-menu');
  await expect(menu.locator('.quick-title')).toHaveText(['Vender y cobrar', 'Comprar y mercancía', 'Gastos', 'Tu plata', 'Anotar']);
  await expect(menu.getByRole('region', { name: 'Vender y cobrar' }).getByRole('button')).toHaveCount(4);
  await docShot(page, 'v23-menu-registrar', false);
  await menu.getByRole('button', { name: /Fiar mercancía/ }).click();
  await expect(page).toHaveURL(/#\/ventas\/nueva\?fiado=1/);

  await page.goto('/#/mas');
  await expect(page.getByTestId('more-group')).toHaveCount(7);
  await expect(page.locator('.card').filter({ hasText: 'Organízate' })).toContainText('Notas');
  await expect(page.locator('.card').filter({ hasText: 'Clientes y cobros' })).toContainText('Me deben');
  await docShot(page, 'v23-menu-mas');
});

test('v2.3 · notas: crear desde el +, fijar, buscar, pasar al calendario, borrar y deshacer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Registrar operación' }).click();
  await page.getByTestId('quick-menu').getByRole('button', { name: 'Nota', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Nueva nota' });
  await expect(sheet.locator('#mm-text')).toBeFocused();
  await sheet.locator('#mm-title').fill('Pedido de Andrés');
  await sheet.locator('#mm-text').fill('Funda MagSafe\nVidrio templado');
  await sheet.getByTestId('save-memo').click();
  await expect(sheet).toHaveCount(0);
  for (const t of ['Llamar al técnico por la pantalla', 'Ideas para Marketplace', 'Cobrar a Luis el viernes']) {
    await page.getByTestId('memo-new').click();
    await page.locator('#mm-text').fill(t);
    await page.getByTestId('save-memo').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const list = page.getByTestId('memo-list');
  await expect(list.locator('li')).toHaveCount(4);
  await expect(list.locator('li').first()).toContainText('Cobrar a Luis'); // la más reciente primero
  // Fijar la del pedido
  await list.getByText('Pedido de Andrés').click();
  await page.getByTestId('memo-pin').check();
  await page.keyboard.press('Escape');
  await expect(list.locator('li').first()).toContainText('Pedido de Andrés');
  await expect(list.locator('li').first()).toContainText('Funda MagSafe');
  // Buscar sin tildes
  await page.getByTestId('memo-search').fill('tecnico');
  await expect(list.locator('li')).toHaveCount(1);
  await page.getByTestId('memo-search').fill('');
  await docShot(page, 'v23-notas');
  // Pasar al calendario
  await list.getByText('Cobrar a Luis el viernes').click();
  await page.getByTestId('memo-to-calendar').click();
  await expect(page).toHaveURL(/#\/calendario$/);
  await expect(page.getByRole('dialog', { name: 'Nueva nota' }).locator('#nt-title')).toHaveValue('Cobrar a Luis el viernes');
  await page.keyboard.press('Escape');
  // Borrar y deshacer
  await page.goto('/#/notas');
  await list.getByText('Ideas para Marketplace').click();
  await page.getByTestId('memo-delete').click();
  await expect(list.locator('li')).toHaveCount(3);
  await page.getByTestId('memo-undo').getByRole('button', { name: 'Deshacer' }).click();
  await expect(list.locator('li')).toHaveCount(4);
  // Se conservan al recargar
  await page.reload();
  await expect(page.getByTestId('memo-list').locator('li')).toHaveCount(4);
});

test('v2.3 · cobrar por WhatsApp: número de la ficha, mensaje que escribes y chat abierto con el texto', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string) => {
      (window as unknown as { __opened: string[] }).__opened.push(url);
      return { opener: null } as unknown as Window;
    }) as typeof window.open;
  });
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await purchase(page, inv, { accessory: 'Funda' }, 5, 10_000);
  await page.goto(`/#/ventas/nueva?inv=${inv}&fiado=1`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Funda/ }).first().click();
  await page.locator('#sa-q-0').fill('2');
  await page.locator('#sa-p-0').fill('25000');
  await page.getByTestId('fiado-box').getByRole('button', { name: /Sin comprador/ }).click();
  await page.getByRole('button', { name: /Nuevo comprador/ }).click();
  await page.locator('#pp-name').fill('Ana Pérez');
  await page.locator('#pp-phone').fill('300 123 4567');
  await page.getByRole('button', { name: 'Guardar comprador' }).click();
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  // Desde la venta pendiente
  await page.getByTestId('sale-whatsapp').click();
  const sheet = page.getByRole('dialog', { name: 'Cobrar por WhatsApp' });
  await expect(sheet.locator('#wa-phone')).toHaveValue('300 123 4567');
  await expect(sheet.locator('#wa-text')).toHaveValue(/Hola Ana, ¿cómo estás\?.*\$\s50\.000/);
  await sheet.getByTestId('wa-tone-firme').click();
  await expect(sheet.locator('#wa-text')).toHaveValue(/Necesito que me abones/);
  await sheet.locator('#wa-text').fill('Hola Ana, te escribo por los $50.000 de las fundas. ¿Me abonas el sábado?');
  await docShot(page, 'v23-whatsapp', false);
  await sheet.getByTestId('wa-open').click();
  await expect(sheet).toHaveCount(0);
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toEqual([`https://wa.me/573001234567?text=${encodeURIComponent('Hola Ana, te escribo por los $50.000 de las fundas. ¿Me abonas el sábado?')}`]);
  await expect(page).toHaveURL(/#\/me-deben\/[^?]+$/);

  // Número equivocado: se corrige y se guarda en la ficha
  await page.getByTestId('debtor-whatsapp').click();
  await sheet.locator('#wa-phone').fill('12345');
  await sheet.getByTestId('wa-open').click();
  await expect(sheet.getByRole('alert')).toContainText('10 dígitos');
  await sheet.locator('#wa-phone').fill('+57 310 555 0000');
  await sheet.getByTestId('wa-save').check();
  await sheet.getByTestId('wa-open').click();
  await expect(page.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+573105550000');
  expect((await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))[1]).toMatch(/^https:\/\/wa\.me\/573105550000\?text=Hola%20Ana/);
});

test('v2.3 · recorridos: omitir, repetir primeros pasos y no ofrecerlos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tour-offer')).toBeVisible();
  await page.getByRole('button', { name: 'Hacer el recorrido' }).click();
  const tour = page.getByTestId('tour');
  await page.getByTestId('tour-next').click();
  await tour.getByTestId('tour-skip').click();
  await expect(tour).toHaveCount(0);
  await expect(page.getByText('Recorrido omitido')).toBeVisible();
  await page.goto('/#/ayuda');
  await expect(page.getByTestId('tours-list')).toContainText('Conoce la app');
  await expect(page.getByTestId('tours-list').getByRole('button', { name: /Conoce la app/ })).toContainText('Omitido');
  // Ocultar la lista de primeros pasos en Inicio y luego repetirlos
  await page.goto('/');
  await page.getByTestId('getting-started').locator('..').locator('..').getByRole('button', { name: 'Ocultar' }).click();
  await expect(page.getByTestId('getting-started')).toHaveCount(0);
  await page.goto('/#/ayuda');
  await page.getByTestId('repeat-first-steps').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(tour).toContainText('Conoce la app · paso 1 de 10');
  for (let i = 2; i <= 10; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-finish-here')).toBeVisible();
  await page.getByTestId('tour-finish-here').click(); // sin seguir con «Tu primera compra»
  await expect(tour).toHaveCount(0);
  await expect(page).toHaveURL(/#\/aprende$/);
  await page.goto('/');
  await expect(page.getByTestId('getting-started')).toBeVisible();
  // No ofrecer recorridos
  await page.goto('/#/ayuda');
  await expect(page.getByTestId('tours-list').getByRole('button', { name: /Conoce la app/ })).toContainText('Hecho');
  await page.getByTestId('tours-off').check();
  await page.evaluate(() => localStorage.removeItem('pref:tourOffer'));
  await page.evaluate(() => localStorage.setItem('pref:tour:app', ''));
  await page.goto('/');
  await page.reload();
  await expect(page.getByTestId('tour-offer')).toHaveCount(0);
});

test('v2.3 · la voz se puede callar o silenciar mientras habla', async ({ page }) => {
  await slowSpeech(page);
  await page.goto('/#/capital');
  await page.getByRole('button', { name: /¿Qué es Valor del negocio/ }).first().click();
  const bar = page.getByTestId('speech-bar');
  await expect(bar).toBeVisible();
  await docShot(page, 'v23-voz-callar', false);
  await bar.getByTestId('speech-stop').click();
  await expect(bar).toHaveCount(0);
  const spoken = () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect((await spoken()).at(-1)).toBe('<cancel>');
  // La explicación sigue abierta; la voz no vuelve a empezar sola
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // Silenciar: apaga la lectura automática en toda la app
  await page.getByRole('button', { name: /¿Qué es Valor del negocio/ }).first().click();
  await expect(bar).toBeVisible();
  await bar.getByTestId('speech-mute').click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('dialog').getByTestId('speaker')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  const n = (await spoken()).length;
  await page.goto('/#/aprende/costo');
  await page.waitForTimeout(500);
  expect((await spoken()).length).toBe(n);
});
