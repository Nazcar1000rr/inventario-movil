// Genera el manual en PDF a partir de la pantalla "Manual completo" de la app compilada.
// Uso (con `npm run build` hecho y `npm run preview` corriendo en el puerto 4173):
//   node scripts/make-manual-pdf.mjs
// Escribe public/manual-inventario-movil.pdf (se incluye en la app) y docs/Manual-Inventario-Movil.pdf.
import { copyFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.env.MANUAL_URL ?? 'http://localhost:4173/#/ayuda/manual';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'es-CO' });
await page.goto(url);
await page.getByTestId('manual').waitFor();
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: 'public/manual-inventario-movil.pdf',
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#666">Manual de Inventario Móvil · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
});
copyFileSync('public/manual-inventario-movil.pdf', 'docs/Manual-Inventario-Movil.pdf');
await browser.close();
console.log('Manual PDF generado');
