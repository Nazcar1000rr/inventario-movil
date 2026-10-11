import { expect, test } from '@playwright/test';
import { createInventory, docShot, purchase, SHOTS } from './helpers';

test('v2.1 · lotes por precio, "la última vez pagaste", aviso de compra más barata y gasto del viaje', async ({ page }) => {
  await page.goto('/');
  const inv = await createInventory(page, 'Mi negocio');
  await purchase(page, inv, { accessory: 'Audífonos Bluetooth' }, 5, 30_000);

  // Segunda compra más barata: último precio y aviso
  await page.goto(`/#/compras/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir o crear producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Audífonos Bluetooth/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#pu-q-0').fill('4');
  await page.locator('#pu-p-0').fill('22000');
  const hints = page.getByTestId('purchase-hints').first();
  await expect(hints).toContainText('La última vez pagaste');
  await expect(hints).toContainText(/\$\s30\.000/);
  await expect(hints).toContainText('▼');
  await expect(hints).toContainText('Ojo: compras más barato que lo que ya tienes');
  await expect(hints).toContainText(/Tus 5 unidades anteriores te costaron más: \$\s40\.000/);
  await docShot(page, 'v21-compra-aviso');
  await page.getByRole('button', { name: 'Revisar y registrar compra' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmar compra' })).toContainText('Ojo: compras más barato');
  await page.getByTestId('confirm-purchase').click();
  await expect(page.getByRole('heading', { name: 'Compra', exact: true })).toBeVisible();

  // Ficha del producto: dos lotes y lo que has pagado
  await page.goto(`/#/inventarios/${inv}`);
  await page.getByText('Audífonos Bluetooth').click();
  const productUrl = page.url().split('#')[1];
  const lots = page.getByTestId('lots-list');
  await expect(lots.locator('li')).toHaveCount(2);
  await expect(lots.locator('li').nth(0)).toContainText(/5 disp\. · \$\s30\.000 c\/u/);
  await expect(lots.locator('li').nth(0)).toContainText('Sale primero');
  await expect(lots.locator('li').nth(1)).toContainText(/4 disp\. · \$\s22\.000 c\/u/);
  await expect(page.getByTestId('price-history')).toContainText('▼');
  await docShot(page, 'v21-lotes');

  // Venta: con el lote automático (30 000) a 28 000 avisa pérdida; con el lote nuevo no
  await page.goto(`/#/ventas/nueva?inv=${inv}`);
  await page.getByRole('button', { name: /Elegir producto/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Audífonos Bluetooth/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#sa-q-0').fill('1');
  await page.locator('#sa-p-0').fill('28000');
  await expect(page.getByTestId('lot-hints')).toContainText('Por lote');
  await expect(page.getByText(/perderías \$\s2\.000 por unidad/)).toBeVisible();
  await page.locator('#sa-lot-0').selectOption({ index: 2 });
  await expect(page.getByText(/perderías/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisar y registrar venta' }).click();
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByRole('heading', { name: 'Venta', exact: true })).toBeVisible();
  await page.goto(`/#${productUrl}`);
  await expect(lots.locator('li').nth(0)).toContainText('5 disp.');
  await expect(lots.locator('li').nth(1)).toContainText('3 disp.');

  // Gasto del viaje repartido entre las dos compras del día
  await page.goto('/#/gastos/nuevo?tipo=compra');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.locator('#tc-amount').fill('9000');
  const split = page.getByTestId('cost-split');
  // 9 000 según lo pagado: 5 672 y 3 328; del lote nuevo ya se vendió 1 de 4 → 832 es gasto
  await expect(split).toContainText(/Se suma al costo[\s\S]*\$\s8\.168/);
  await expect(split).toContainText(/Gasto \(de lo ya vendido\)[\s\S]*\$\s832/);
  await docShot(page, 'v21-gasto-viaje');
  await page.getByTestId('save-trip-cost').click();
  await expect(page.getByRole('heading', { name: 'Compra', exact: true })).toBeVisible();
  await expect(page.getByText('Gastos agregados después')).toBeVisible();
  await expect(page.getByText(/repartido con otras compras/)).toBeVisible();

  // Apagar y volver a prender los lotes
  await page.goto(`/#${productUrl}`);
  await page.getByTestId('lots-toggle').click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByText('Ahora usa costo promedio')).toBeVisible();
  await expect(page.getByTestId('lots-list')).toHaveCount(0);
  await page.getByTestId('lots-toggle').click();
  await page.getByTestId('ask-confirm').click();
  await expect(page.getByTestId('lots-list').locator('li')).toHaveCount(2);
});

test('v2.1 · gasto personal: avisa si sale de las ganancias o del capital, con consejos que se pueden apagar', async ({ page }) => {
  await page.goto('/');
  await createInventory(page, 'Mi negocio');
  await page.goto('/#/capital');
  await page.getByRole('button', { name: 'Aporte', exact: true }).click();
  await page.locator('#cm-amount').fill('1000000');
  await page.getByTestId('save-capital').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/#/gastos/nuevo');
  await page.getByTestId('expense-kind-personal').click();
  await page.locator('#ps-amount').fill('50000');
  await page.getByRole('group', { name: 'En qué lo gastaste' }).getByRole('button', { name: 'Gasto hormiga' }).click();
  const impact = page.getByTestId('personal-impact');
  await expect(impact).toContainText('Esto ya no sale de tus ganancias: sale del capital del negocio');
  await expect(impact).toContainText('Si esto se repite todos los días');
  await expect(page.getByTestId('money-tip')).toContainText('La plata del negocio es del negocio');
  await docShot(page, 'v21-gasto-personal');
  await page.getByTestId('save-personal').click();
  await expect(page.getByRole('heading', { name: 'Gastos personales' })).toBeVisible();
  await expect(page.getByText('Este mes estás sacando más de lo que el negocio gana')).toBeVisible();
  await expect(page.getByTestId('ant-result')).toContainText('al mes');
  await docShot(page, 'v21-personal');

  await page.goto('/#/capital');
  await expect(page.getByTestId('capital-move').first()).toContainText('Personal · Gasto hormiga');

  // Apagar los consejos
  await page.goto('/#/ajustes');
  await page.getByLabel('Consejos al registrar gastos personales').uncheck();
  await page.getByTestId('save-settings').click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();
  await page.goto('/#/gastos/nuevo?tipo=personal');
  await page.locator('#ps-amount').fill('10000');
  await expect(page.getByTestId('personal-impact')).toBeVisible();
  await expect(page.getByTestId('money-tip')).toHaveCount(0);
});

test('v2.1 · recorrido guiado, lecciones con preguntas y consejo del día', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('daily-tip')).toBeVisible();
  const tip1 = await page.getByTestId('daily-tip').innerText();
  await page.getByTestId('daily-tip').getByRole('button', { name: 'Otro consejo' }).click();
  await expect(page.getByTestId('daily-tip')).not.toHaveText(tip1);

  await expect(page.getByTestId('tour-offer')).toBeVisible();
  await page.getByRole('button', { name: 'Hacer el recorrido' }).click();
  const tour = page.getByTestId('tour');
  await expect(tour).toContainText('paso 1 de 10'); // 2.3: un paso más (análisis, preguntones, me deben y calendario)
  for (let i = 2; i <= 10; i++) {
    await page.getByTestId('tour-next').click();
    await expect(tour).toContainText(`paso ${i} de 10`);
    if (i === 3) await page.screenshot({ path: `${SHOTS}/v21-recorrido.png` });
  }
  await page.getByTestId('tour-next').click(); // "Siguiente recorrido": tu primera compra
  await expect(tour).toContainText('Tu primera compra · paso 1');
  await expect(page).toHaveURL(/#\/compras\/nueva/);
  await page.getByTestId('tour-next').click();
  await expect(tour).toContainText('Elige el producto');
  await tour.getByTestId('tour-skip').click(); // «Omitir»
  await expect(tour).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('tour-offer')).toHaveCount(0);

  // Lección con calculadora y preguntas
  await page.goto('/#/aprende/margen');
  await page.locator('#m-cost').fill('50000');
  await page.locator('#m-price').fill('60000');
  await expect(page.getByTestId('calc-out')).toContainText('16,7 %');
  await page.goto('/#/aprende/costo');
  const quiz = page.getByTestId('quiz');
  await quiz.getByRole('button', { name: /^34\s000$/ }).click();
  await expect(page.getByText('¡Correcto!')).toBeVisible();
  await page.getByTestId('quiz-next').click();
  await quiz.getByRole('button', { name: /suben su costo/ }).click();
  await page.getByTestId('quiz-next').click();
  await quiz.getByRole('button', { name: /^100\s000$/ }).click();
  await expect(page.getByText('No exactamente')).toBeVisible();
  await page.getByTestId('quiz-next').click();
  await expect(page.getByTestId('quiz-result')).toContainText('2 de 3 correctas');
  await page.goto('/#/aprende');
  await expect(page.getByText('1 de 16 lecciones completadas')).toBeVisible();
  await expect(page.getByTestId('lessons').locator('li').first()).toContainText('Hecha');
  await docShot(page, 'v21-aprende');
});

test('v2.1 · sonidos: cada uno se apaga por separado y se recuerda', async ({ page }) => {
  await page.goto('/#/apariencia');
  await expect(page.getByTestId('sounds-card')).toBeVisible();
  await page.getByTestId('sound-tap').uncheck();
  await page.locator('#snd-vol').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Volumen: 30 %')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('sound-tap')).not.toBeChecked();
  await expect(page.getByTestId('sound-open')).toBeChecked();
  await expect(page.getByTestId('sound-sale')).toBeChecked();
  await docShot(page, 'v21-sonidos');

  await page.evaluate(() => ((window as unknown as { __sounds: string[] }).__sounds.length = 0));
  await page.goto('/#/capital');
  await page.getByRole('button', { name: 'Aporte', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const played = await page.evaluate(() => [...(window as unknown as { __sounds: string[] }).__sounds]);
  expect(played).toContain('open');
  expect(played).not.toContain('tap');
});
