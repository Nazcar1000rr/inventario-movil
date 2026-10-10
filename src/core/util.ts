import type { ISODate, Money } from './types';

/* ---------------- Identificadores ---------------- */

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Respaldo RFC 4122 v4 con getRandomValues (contextos no seguros antiguos)
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------- Errores ---------------- */

export class AppError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = field;
  }
}

export function fail(code: string, message: string, field?: string): never {
  throw new AppError(code, message, field);
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === 'object' && 'name' in e) {
    const name = String((e as { name: unknown }).name);
    if (name === 'QuotaExceededError') return 'No hay espacio suficiente en el dispositivo para guardar los datos.';
    if (name === 'ConstraintError') return 'El registro ya existe (dato duplicado).';
    if (name === 'DatabaseClosedError' || name === 'OpenFailedError')
      return 'No se pudo abrir la base de datos local. Cierre y vuelva a abrir la app.';
  }
  if (e instanceof Error) return e.message;
  return 'Error desconocido.';
}

/* ---------------- Dinero ---------------- */

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const intFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function formatCOP(value: Money | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Desconocido';
  return copFormatter.format(value);
}

export function formatInt(value: number): string {
  return intFormatter.format(value);
}

/** Convierte texto como "1.250.000" o "$ 1.250.000" en 1250000. Devuelve null si está vacío. */
export function parseMoney(text: string): Money | null {
  const digits = text.replace(/[^\d-]/g, '');
  if (digits === '' || digits === '-') return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

export function isMoney(v: unknown): v is Money {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

export function assertMoney(v: unknown, field: string, label: string, allowZero = true): Money {
  if (!isMoney(v)) fail('invalid_amount', `${label}: ingrese un valor entero en pesos.`, field);
  if (v < 0) fail('negative_amount', `${label} no puede ser negativo.`, field);
  if (!allowZero && v === 0) fail('zero_amount', `${label} debe ser mayor que cero.`, field);
  if (v > 100_000_000_000) fail('amount_too_large', `${label} es demasiado alto. Revise el valor.`, field);
  return v;
}

export function assertQty(v: unknown, field = 'quantity', label = 'Cantidad'): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)
    fail('invalid_qty', `${label} debe ser un número entero mayor que cero.`, field);
  if (v > 100_000) fail('qty_too_large', `${label} es demasiado alta.`, field);
  return v;
}

/**
 * Reparte `total` entre `weights` proporcionalmente, en enteros, sin perder ni sumar pesos.
 * El residuo se asigna a las posiciones con mayor parte fraccionaria (método del mayor resto).
 */
export function allocate(total: Money, weights: number[]): Money[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  const w = sumW > 0 ? weights : weights.map(() => 1);
  const sw = sumW > 0 ? sumW : n;
  const raw = w.map((x) => (total * x) / sw);
  const floor = raw.map((x) => Math.floor(x));
  let rest = total - floor.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floor[order[k].i] += 1;
  return floor;
}

/* ---------------- Fechas ---------------- */

export function nowISO(): ISODate {
  return new Date().toISOString();
}

export function isValidISO(v: unknown): v is ISODate {
  if (typeof v !== 'string' || v.length < 10) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function assertDate(v: unknown, field: string, label: string, opts: { allowFuture?: boolean } = {}): ISODate {
  if (!isValidISO(v)) fail('invalid_date', `${label}: fecha no válida.`, field);
  const t = Date.parse(v);
  if (t < Date.parse('2000-01-01T00:00:00Z')) fail('date_too_old', `${label}: la fecha es anterior al año 2000.`, field);
  if (!opts.allowFuture && t > Date.now() + 5 * 60_000)
    fail('future_date', `${label}: la fecha no puede estar en el futuro.`, field);
  return new Date(t).toISOString();
}

/** Inicio del día local de una fecha. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Días calendario completos entre dos fechas (local). */
export function daysBetween(fromISO: ISODate, to: Date | ISODate = new Date()): number {
  const a = startOfDay(new Date(fromISO));
  const b = startOfDay(typeof to === 'string' ? new Date(to) : to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const d = new Date(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toISOString();
}

const dateFmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return 'Fecha desconocida';
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: ISODate | null | undefined): string {
  if (!iso) return 'Fecha desconocida';
  return dateTimeFmt.format(new Date(iso));
}

/** Para <input type="datetime-local">: "YYYY-MM-DDTHH:mm" en hora local. */
export function toLocalInput(iso: ISODate | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): ISODate | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Para <input type="date">: "YYYY-MM-DD" local. */
export function toDateInput(iso: ISODate | null): string {
  return iso ? toLocalInput(iso).slice(0, 10) : '';
}

export function fromDateInput(v: string): ISODate | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/* ---------------- Texto ---------------- */

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanStr(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

export function cleanIdentifier(v: unknown): string {
  return cleanStr(v, 40).replace(/\s+/g, '').toUpperCase();
}
