// Genera los iconos de la PWA y de Android a partir de un SVG.
// Requiere sharp:  npm i -D sharp   (o NODE_PATH apuntando a una instalación global)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = new URL('..', import.meta.url).pathname;
const BG = '#0d6b58';

/** Glifo: teléfono con lista de existencias. `scale` reduce el contenido (iconos adaptables/maskable). */
function svg({ scale = 1, background = true, rounded = false } = {}) {
  const g = `
    <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
      <rect x="332" y="176" width="360" height="672" rx="64" fill="none" stroke="#fff" stroke-width="48"/>
      <rect x="452" y="222" width="120" height="22" rx="11" fill="#fff"/>
      <rect x="404" y="352" width="216" height="58" rx="16" fill="#fff"/>
      <rect x="404" y="450" width="216" height="58" rx="16" fill="#fff" fill-opacity="0.82"/>
      <rect x="404" y="548" width="150" height="58" rx="16" fill="#fff" fill-opacity="0.64"/>
      <circle cx="512" cy="756" r="30" fill="#fff"/>
    </g>`;
  const bg = background ? `<rect width="1024" height="1024" ${rounded ? 'rx="224"' : ''} fill="${BG}"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${g}</svg>`);
}

async function png(file, size, opts) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(svg(opts), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
}

const pub = join(root, 'public', 'icons');
await png(join(pub, 'icon-192.png'), 192, { rounded: true });
await png(join(pub, 'icon-512.png'), 512, { rounded: true });
await png(join(pub, 'icon-maskable-512.png'), 512, { scale: 0.72 });
await png(join(pub, 'apple-touch-icon.png'), 180, {}); // iOS aplica su propia máscara
await png(join(pub, 'favicon-32.png'), 32, { rounded: true });
writeFileSync(join(pub, 'icon.svg'), svg({ rounded: true }));
console.log('Iconos PWA generados en public/icons');

const res = join(root, 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await png(join(res, `mipmap-${d}`, 'ic_launcher.png'), Math.round(48 * k), { rounded: true, scale: 0.9 });
    await png(join(res, `mipmap-${d}`, 'ic_launcher_round.png'), Math.round(48 * k), { rounded: true, scale: 0.9 });
    // Primer plano del icono adaptable: 108dp con el contenido dentro de la zona segura (66dp)
    await png(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), Math.round(108 * k), { background: false, scale: 0.6 });
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
    const glyph = await sharp(svg({ background: false }), { density: 300 }).resize(side, side).png().toBuffer();
    const out = await sharp({ create: { width, height, channels: 4, background: BG } })
      .composite([{ input: glyph, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(file, out);
  }
  console.log('Iconos y splash de Android generados en android/app/src/main/res');
}
