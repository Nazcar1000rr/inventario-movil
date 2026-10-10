import { daysText, formatCOP, formatDateTime, formatInt, type MonthlySummary } from '../core';

/**
 * Dibuja el resumen mensual en un <canvas> (imagen para compartir) y arma un PDF de una página con esa imagen.
 * Todo ocurre en el teléfono: no se envía nada a internet.
 */

const C = {
  bg: '#ffffff',
  band: '#0d6b58',
  onBand: '#ffffff',
  text: '#14171c',
  muted: '#586170',
  card: '#f3f4f6',
  good: '#146c34',
  bad: '#b42318',
  line: '#d9dde3',
};

const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export interface SummaryImageOptions {
  scopeLabel: string;
  monthTitle: string;
}

export function renderSummaryCanvas(s: MonthlySummary, opts: SummaryImageOptions): HTMLCanvasElement {
  const W = 1080;
  const pad = 56;
  const kpis: [string, string, string?][] = [
    ['Ventas netas', formatCOP(s.fin.netRevenue)],
    ['Ganancia neta', formatCOP(s.fin.netProfit), s.fin.netProfit >= 0 ? C.good : C.bad],
    ['Unidades vendidas', formatInt(s.fin.sales.units)],
    ['Gastos operativos', formatCOP(s.fin.operatingExpenses)],
    ['Valor del negocio', formatCOP(s.end.businessValue)],
    ['Crecimiento del mes', `${s.growthInMonth >= 0 ? '+' : '−'}${formatCOP(Math.abs(s.growthInMonth))}`, s.growthInMonth >= 0 ? C.good : C.bad],
    ['Compras', formatCOP(s.fin.purchases.total)],
    ['Días promedio para vender', s.avgDaysToSell === null ? '—' : String(s.avgDaysToSell).replace('.', ',')],
  ];
  const rowsTop = s.topSellers.length;
  const rowsPpd = s.bestProfitPerDay.length;
  const H =
    260 + // encabezado
    Math.ceil(kpis.length / 2) * 150 +
    40 +
    (rowsTop ? 70 + rowsTop * 56 : 0) +
    (rowsPpd ? 70 + rowsPpd * 56 : 0) +
    (s.debtsOpen.count ? 90 : 0) +
    (s.fin.profitComplete ? 0 : 70) +
    110;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El dispositivo no permite crear la imagen.');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Encabezado
  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, W, 220);
  ctx.fillStyle = C.onBand;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(fitText(ctx, s.businessName || 'Mi negocio', W - 2 * pad), pad, 78);
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(fitText(ctx, opts.monthTitle, W - 2 * pad), pad, 148);
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(fitText(ctx, `${opts.scopeLabel}${s.partial ? ' · mes en curso' : ''}`, W - 2 * pad), pad, 192);

  // Indicadores
  let y = 260;
  const colW = (W - 2 * pad - 24) / 2;
  kpis.forEach(([label, value, color], i) => {
    const x = pad + (i % 2) * (colW + 24);
    const yy = y + Math.floor(i / 2) * 150;
    ctx.fillStyle = C.card;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, yy, colW, 128, 18);
    else ctx.rect(x, yy, colW, 128);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(fitText(ctx, label, colW - 40), x + 24, yy + 44);
    ctx.fillStyle = color ?? C.text;
    ctx.font = `700 42px ${FONT}`;
    ctx.fillText(fitText(ctx, value, colW - 40), x + 24, yy + 98);
  });
  y += Math.ceil(kpis.length / 2) * 150 + 20;

  const section = (title: string, rows: [string, string][]) => {
    ctx.fillStyle = C.text;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(title, pad, y + 36);
    y += 64;
    rows.forEach(([a, b]) => {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
      ctx.font = `400 28px ${FONT}`;
      ctx.fillStyle = C.text;
      ctx.fillText(fitText(ctx, a, W - 2 * pad - 300), pad, y + 38);
      ctx.font = `600 28px ${FONT}`;
      const bw = ctx.measureText(b).width;
      ctx.fillText(b, W - pad - bw, y + 38);
      y += 56;
    });
    y += 6;
  };
  if (rowsTop) section('Lo más vendido', s.topSellers.map((t) => [`${t.name} (${t.units})`, formatCOP(t.revenue)]));
  if (rowsPpd) section('Lo más rentable por día', s.bestProfitPerDay.map((m) => [`${m.label} · ${daysText(m.avgDays)}`, `${formatCOP(m.profitPerDay)}/día`]));
  if (s.debtsOpen.count) {
    ctx.fillStyle = C.bad;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(`Deudas pendientes al cierre: ${formatCOP(s.debtsOpen.amount)} (${s.debtsOpen.count})`, pad, y + 40);
    y += 90;
  }
  if (!s.fin.profitComplete) {
    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(`⚠ Ganancia incompleta: ${s.fin.cogsUnknownUnits} unidad(es) vendidas sin costo conocido.`, pad, y + 36);
    y += 70;
  }
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(`Generado el ${formatDateTime(s.generatedAt)} con Inventario Móvil. Valores a costo.`, pad, H - 48);
  return canvas;
}

export async function canvasToBytes(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error('No se pudo crear la imagen.');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * PDF de una página con una imagen JPEG que ocupa toda la página (ancho A4).
 * Formato PDF 1.4 mínimo, escrito a mano (sin librerías).
 */
export function buildImagePdf(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  const pageW = 595.28; // A4 en puntos
  const pageH = Math.round(((pageW * heightPx) / widthPx) * 100) / 100;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  const text = (t: string) => push(enc.encode(t));
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    text(`${n} 0 obj\n`);
    body();
    text('\nendobj\n');
  };
  text('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // comentario binario recomendado por la norma PDF
  obj(1, () => text('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    text(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    text('\nendstream');
  });
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  obj(5, () => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = length;
  text(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) text(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
