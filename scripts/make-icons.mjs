// Genera los iconos de la PWA y de Android a partir de un SVG.
// Requiere sharp:  npm i -D sharp   (o NODE_PATH apuntando a una instalación aparte)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = new URL('..', import.meta.url).pathname;
const BG = '#0d6b58';

const DEFS = `<defs>
  <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024">
    <stop offset="0" stop-color="#1fae8c"/><stop offset="0.5" stop-color="#0d6b58"/><stop offset="1" stop-color="#06392f"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.28" cy="0.18" r="0.75">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#e9a628"/>
  </linearGradient>
  <linearGradient id="mint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4f3e8"/>
  </linearGradient>
</defs>`;

/**
 * Logo v2.2 ("la i de Inventario"): una i formada por un teléfono (con barras que suben) y una moneda como punto.
 * `scale` reduce el contenido (iconos adaptables/maskable). `background: 'none'` = solo el glifo (fondo transparente).
 */
function svg({ scale = 1, background = 'gradient', rounded = false } = {}) {
  const g = `
    <g transform="translate(512 512) scale(${scale}) translate(-512 -517)">
      <circle cx="512" cy="226" r="104" fill="url(#gold)"/>
      <circle cx="512" cy="226" r="70" fill="none" stroke="#fff4cc" stroke-opacity="0.8" stroke-width="13"/>
      <rect x="372" y="380" width="280" height="532" rx="72" fill="url(#mint)"/>
      <rect x="408" y="428" width="208" height="436" rx="36" fill="${BG}"/>
      <rect x="476" y="402" width="72" height="13" rx="6.5" fill="${BG}" fill-opacity="0.5"/>
      <rect x="442" y="734" width="40" height="92" rx="12" fill="#ffffff" fill-opacity="0.55"/>
      <rect x="492" y="660" width="40" height="166" rx="12" fill="#ffffff" fill-opacity="0.8"/>
      <rect x="542" y="574" width="40" height="252" rx="12" fill="url(#gold)"/>
    </g>`;
  const r = rounded ? 'rx="224"' : '';
  const bg = background === 'gradient' ? `<rect width="1024" height="1024" ${r} fill="url(#bg)"/><rect width="1024" height="1024" ${r} fill="url(#glow)"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${DEFS}${bg}${g}</svg>`);
}

/** Solo el fondo (para la capa de fondo del icono adaptable de Android). */
function bgOnly() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${DEFS}<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/></svg>`);
}

async function png(file, size, opts, source) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(source ?? svg(opts), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
}

const pub = join(root, 'public', 'icons');
await png(join(pub, 'icon-192.png'), 192, { rounded: true });
await png(join(pub, 'icon-512.png'), 512, { rounded: true });
await png(join(pub, 'icon-maskable-512.png'), 512, { scale: 0.72 });
await png(join(pub, 'apple-touch-icon.png'), 180, {}); // iOS aplica su propia máscara
await png(join(pub, 'favicon-32.png'), 32, { rounded: true });
await png(join(pub, 'logo-256.png'), 256, { rounded: true });
writeFileSync(join(pub, 'icon.svg'), svg({ rounded: true }));
console.log('Iconos PWA generados en public/icons');

const res = join(root, 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await png(join(res, `mipmap-${d}`, 'ic_launcher.png'), Math.round(48 * k), { rounded: true, scale: 0.9 });
    await png(join(res, `mipmap-${d}`, 'ic_launcher_round.png'), Math.round(48 * k), { rounded: true, scale: 0.9 });
    // Primer plano del icono adaptable: 108dp con el contenido dentro de la zona segura (66dp)
    await png(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), Math.round(108 * k), { background: 'none', scale: 0.6 });
    await png(join(res, `mipmap-${d}`, 'ic_launcher_back.png'), Math.round(108 * k), {}, bgOnly());
  }
  const values = join(res, 'values');
  mkdirSync(values, { recursive: true });
  writeFileSync(
    join(values, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
  );
  // Pantallas de inicio (splash) con el mismo fondo e icono, en los tamaños existentes
  const { readdirSync } = await import('node:fs');
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = join(res, dir, 'splash.png');
    if (!existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    const side = Math.round(Math.min(width, height) * 0.42);
    const glyph = await sharp(svg({ background: 'none' }), { density: 300 }).resize(side, side).png().toBuffer();
    const out = await sharp({ create: { width, height, channels: 4, background: BG } })
      .composite([{ input: glyph, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(file, out);
  }
  // Icono adaptable: fondo con degradado (imagen) + glifo
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_back"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
  writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
  console.log('Iconos y splash de Android generados en android/app/src/main/res');
}
