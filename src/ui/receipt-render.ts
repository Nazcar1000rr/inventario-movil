import { formatCOP, formatDateTime, type Receipt } from '../core';

/**
 * Dibuja el comprobante de venta en un <canvas> (imagen para compartir por WhatsApp o PDF).
 * Todo ocurre en el teléfono: no se envía nada a internet.
 */

const C = { bg: '#ffffff', band: '#0d6b58', onBand: '#ffffff', text: '#14171c', muted: '#586170', line: '#d9dde3', good: '#146c34', bad: '#b42318', void: '#b42318' };
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const STATUS: Record<Receipt['status'], string> = { pagada: 'Pagada', parcial: 'Pago parcial', pendiente: 'Por cobrar', anulada: 'Anulada', devuelta: 'Devuelta', perdonada: 'Cerrada' };

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export function renderReceiptCanvas(r: Receipt): HTMLCanvasElement {
  const W = 900;
  const pad = 52;
  const lineH = (l: Receipt['lines'][number]) => 52 + (l.imei ? 34 : 0) + (l.warranty ? 34 : 0);
  const itemsH = r.lines.reduce((a, l) => a + lineH(l), 0);
  const totalsRows = 1 + (r.discount > 0 ? 2 : 0) + (r.returned > 0 ? 1 : 0) + 1 + (r.pending > 0 ? 1 : 0);
  const H = 230 + (r.customer ? 56 : 0) + 70 + itemsH + 30 + totalsRows * 52 + (r.notes ? 70 : 0) + 120;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo dibujar el comprobante.');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, W, 170);
  ctx.fillStyle = C.onBand;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(fit(ctx, r.business, W - pad * 2), pad, 80);
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(`Comprobante de venta · N.º ${r.number}`, pad, 126);
  let y = 230;
  ctx.fillStyle = C.muted;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(formatDateTime(r.date), pad, y);
  const st = r.voided ? 'Anulada' : STATUS[r.status];
  ctx.textAlign = 'right';
  ctx.fillStyle = r.voided ? C.void : r.pending > 0 ? C.bad : C.good;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(st, W - pad, y);
  ctx.textAlign = 'left';
  if (r.customer) {
    y += 56;
    ctx.fillStyle = C.text;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(fit(ctx, `Cliente: ${r.customer}`, W - pad * 2), pad, y);
  }
  y += 30;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 14;
  for (const l of r.lines) {
    y += 40;
    ctx.fillStyle = C.text;
    ctx.font = `600 28px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(formatCOP(l.amount), W - pad, y);
    const amountW = ctx.measureText(formatCOP(l.amount)).width;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, `${l.quantity > 1 ? `${l.quantity} × ` : ''}${l.name}`, W - pad * 2 - amountW - 20), pad, y);
    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${FONT}`;
    if (l.quantity > 1) {
      y += 30;
      ctx.fillText(`${formatCOP(l.unitPrice)} c/u`, pad, y);
    }
    if (l.imei) {
      y += 34;
      ctx.fillText(`IMEI ${l.imei}`, pad, y);
    }
    if (l.warranty) {
      y += 34;
      ctx.fillText(l.warranty, pad, y);
    }
    y += 12;
  }
  y += 14;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  const row = (label: string, value: string, bold = false, color = C.text) => {
    y += 52;
    ctx.fillStyle = C.muted;
    ctx.font = `${bold ? 600 : 400} ${bold ? 30 : 26}px ${FONT}`;
    ctx.fillText(label, pad, y);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.font = `${bold ? 700 : 500} ${bold ? 34 : 26}px ${FONT}`;
    ctx.fillText(value, W - pad, y);
    ctx.textAlign = 'left';
  };
  if (r.discount > 0) {
    row('Subtotal', formatCOP(r.subtotal));
    row('Descuento', `−${formatCOP(r.discount)}`);
  }
  if (r.returned > 0) row('Devuelto', `−${formatCOP(r.returned)}`);
  row('Total', formatCOP(r.total - r.returned), true);
  row(r.method ? `Pagado (${r.method})` : 'Pagado', formatCOP(r.paid), false, C.good);
  if (r.pending > 0) row('Falta por pagar', formatCOP(r.pending), true, C.bad);
  if (r.notes) {
    y += 64;
    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(fit(ctx, r.notes.split('\n')[0], W - pad * 2), pad, y);
  }
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Gracias por tu compra', W / 2, H - 64);
  ctx.fillText('Hecho con Inventario Móvil', W / 2, H - 30);
  ctx.textAlign = 'left';
  return canvas;
}
