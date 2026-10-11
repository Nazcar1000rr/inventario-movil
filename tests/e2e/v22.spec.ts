import { expect, test, type Page } from '@playwright/test';
import { docShot, SHOTS } from './helpers';

/** Voz falsa (Chromium sin voces): registra lo que la app pide leer, sin sonido. */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    const voice = { name: 'Paulina', lang: 'es-MX', localService: true, voiceURI: 'paulina', default: true };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [voice],
        speak: (u: { text: string; onend?: () => void }) => {
          if (u.text.trim()) w.__spoken.push(u.text);
          setTimeout(() => u.onend?.(), 30);
        },
        cancel: () => w.__spoken.push('<cancel>'),
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
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((x) => x !== '<cancel>'));
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('v2.2 · apariencia: color, modo oscuro, degradado y modo lite (se recuerdan)', async ({ page }) => {
  await page.goto('/#/apariencia');
  await expect(page.getByTestId('appearance-card')).toBeVisible();
  expect(await cssVar(page, '--primary')).toBe('#0d6b58');
  await page.getByTestId('accent-azul').click();
  expect(await cssVar(page, '--primary')).toBe('#1d5fbf');
  await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cssVar(page, '--primary')).toBe('#6ea1f0');
  await page.getByRole('group', { name: 'Estilo de color' }).getByRole('button', { name: 'Degradado' }).click();
  const topbarBg = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(topbarBg).toContain('linear-gradient');
  await docShot(page, 'v22-apariencia-oscuro');
  // Se recuerda al volver a abrir
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'azul');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'gradient');
  // Animaciones: completas y modo lite
  await page.goto('/#/mas');
  expect(await page.locator('.content > *').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('rise-in');
  await page.goto('/#/apariencia');
  await page.getByRole('group', { name: 'Animaciones' }).getByRole('button', { name: 'Modo lite' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await page.goto('/#/mas');
  expect(await page.locator('.content > *').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  // Volver al claro con color rosado y sólido
  await page.goto('/#/apariencia');
  await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Claro' }).click();
  await page.getByTestId('accent-rosado').click();
  await page.getByRole('group', { name: 'Estilo de color' }).getByRole('button', { name: 'Sólido' }).click();
  expect(await cssVar(page, '--primary')).toBe('#bf2f6c');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#bf2f6c');
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/v22-inicio-rosado.png` });
});

test('v2.2 · lectura en voz alta: recorrido, ⓘ, lección y bocina para silenciar', async ({ page }) => {
  await fakeSpeech(page);
  await page.goto('/#/ayuda');
  await page.getByTestId('tours-list').getByRole('button', { name: /Conoce la app/ }).click();
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Te muestro la app');
  // Bocina: silenciar
  const speaker = page.getByTestId('tour').getByTestId('speaker');
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  await expect(speaker).toHaveAccessibleName('Activar la lectura en voz alta');
  const before = (await spoken(page)).length;
  await page.getByTestId('tour-next').click();
  await page.waitForTimeout(400);
  expect((await spoken(page)).length).toBe(before);
  // Volver a activar: lee el paso actual
  await speaker.click();
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Aquí ves lo que vendiste');
  await page.getByTestId('tour').getByRole('button', { name: 'Salir' }).click();

  // Explicación ⓘ y ayuda "?"
  await page.goto('/#/capital');
  await page.getByRole('button', { name: /¿Qué es Valor del negocio/ }).first().click();
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Cuánto vale hoy tu negocio');
  await expect(page.getByRole('dialog').getByTestId('speaker')).toBeVisible();
  await page.keyboard.press('Escape');

  // Lección y preguntas
  await page.goto('/#/aprende/costo');
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Costo y precio no son lo mismo');
  await page.getByTestId('quiz').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('Pregunta 1');
  // Las cifras se leen en pesos, sin separadores
  await page.goto('/#/aprende/costo');
  const all = (await spoken(page)).join(' ');
  expect(all).toContain('1200000');

  // Ejemplo en Configuración
  await page.goto('/#/apariencia');
  await expect(page.getByTestId('voice-card')).toBeVisible();
  await page.getByTestId('voice-test').click();
  await expect.poll(async () => (await spoken(page)).join(' ')).toContain('soy la voz de Inventario Móvil');
});

test('v2.2 · paquetes de sonidos, tono por sonido y opción de silencio del iPhone', async ({ page }) => {
  await page.addInitScript(() => {
    (navigator as unknown as { audioSession: { type: string } }).audioSession = { type: 'auto' };
  });
  await page.goto('/#/apariencia');
  await expect(page.getByTestId('sounds-card')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __sounds: string[] }).__sounds.length = 0));
  await page.getByTestId('pack-retro').click();
  await expect(page.getByTestId('pack-retro')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tone-sale').selectOption('caja');
  const played = await page.evaluate(() => [...(window as unknown as { __sounds: string[] }).__sounds]);
  expect(played).toContain('sale:retro');
  expect(played).toContain('sale:caja');
  await page.getByTestId('ignore-silent').check();
  expect(await page.evaluate(() => (navigator as unknown as { audioSession: { type: string } }).audioSession.type)).toBe('playback');
  await docShot(page, 'v22-sonidos');
  await page.reload();
  await expect(page.getByTestId('pack-retro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tone-sale')).toHaveValue('caja');
  await expect(page.getByTestId('ignore-silent')).toBeChecked();
  expect(await page.evaluate(() => (navigator as unknown as { audioSession: { type: string } }).audioSession.type)).toBe('playback');
  await page.getByTestId('ignore-silent').uncheck();
  expect(await page.evaluate(() => (navigator as unknown as { audioSession: { type: string } }).audioSession.type)).toBe('auto');
});
