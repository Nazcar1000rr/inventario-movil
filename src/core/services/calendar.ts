import type { AppDB } from '../db';
import type { CalendarNote, ID } from '../types';
import { cleanStr, fail, newId, nowISO } from '../util';
import { logHistory } from './base';
import { claimOp, tx } from './stock';

/**
 * CALENDARIO Y RECORDATORIOS (v2.3)
 * Notas con nombre, descripción opcional, día (y hora opcional). Cada nota avisa los días antes que elijas
 * (0 = el mismo día) a la hora que elijas. Las fechas se guardan como día local (AAAA-MM-DD) para que una nota
 * "del 20" siga siendo del 20 aunque cambie la zona horaria del teléfono.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DEFAULT_REMIND_TIME = '08:00';
export const MAX_REMINDERS = 8;

export function parseDay(day: string): Date {
  const m = DAY_RE.exec(day);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validDay(day: unknown): string {
  if (typeof day !== 'string' || !DAY_RE.test(day)) fail('invalid', 'Elige el día de la nota.', 'day');
  const d = parseDay(day);
  if (!Number.isFinite(d.getTime()) || dayKey(d) !== day) fail('invalid', 'Ese día no existe.', 'day');
  return day;
}

function validTime(t: unknown, field: string, label: string): string {
  if (typeof t !== 'string' || !TIME_RE.test(t)) fail('invalid', `${label}: escribe una hora válida (por ejemplo 08:00).`, field);
  return t;
}

export interface NoteInput {
  id?: ID;
  opId?: string;
  title: string;
  description?: string;
  day: string;
  time?: string | null;
  remindDays?: number[];
  remindTime?: string;
}

export async function saveNote(db: AppDB, input: NoteInput): Promise<CalendarNote | null> {
  const title = cleanStr(input.title, 80);
  if (!title) fail('required', 'Escribe el nombre de la nota.', 'title');
  const description = cleanStr(input.description ?? '', 1000);
  const day = validDay(input.day);
  const time = input.time ? validTime(input.time, 'time', 'Hora') : null;
  const remindTime = validTime(input.remindTime ?? DEFAULT_REMIND_TIME, 'remindTime', 'Hora del aviso');
  const days = [...new Set(input.remindDays ?? [])];
  for (const d of days) if (!Number.isInteger(d) || d < 0 || d > 365) fail('invalid', 'Los avisos van de 0 a 365 días antes.', 'remindDays');
  if (days.length > MAX_REMINDERS) fail('invalid', `Máximo ${MAX_REMINDERS} avisos por nota.`, 'remindDays');
  days.sort((a, b) => b - a);
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const prev = input.id ? await db.notes.get(input.id) : undefined;
    if (input.id && !prev) fail('not_found', 'Esa nota ya no existe.');
    const now = nowISO();
    const changedWhen = !prev || prev.day !== day || prev.remindTime !== remindTime || prev.time !== time;
    const n: CalendarNote = {
      id: prev?.id ?? newId(),
      title,
      description,
      day,
      time,
      remindDays: days,
      remindTime,
      done: prev?.done ?? false,
      doneAt: prev?.doneAt ?? null,
      // Si cambió la fecha o la hora, los avisos vuelven a salir
      seen: changedWhen ? [] : (prev?.seen ?? []).filter((d) => days.includes(d)),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await db.notes.put(n);
    await logHistory(db, { entityType: 'note', entityId: n.id, inventoryId: null, action: prev ? 'update' : 'create', summary: `Nota del calendario: ${title} (${day})` });
    return n;
  });
}

export async function deleteNote(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const n = await db.notes.get(id);
    if (!n) return;
    await db.notes.delete(id);
    await logHistory(db, { entityType: 'note', entityId: id, inventoryId: null, action: 'delete', summary: `Nota borrada: ${n.title} (${n.day})` });
  });
}

/** Marca la nota como hecha (ya no avisa) o la vuelve a abrir. */
export async function setNoteDone(db: AppDB, id: ID, done: boolean): Promise<void> {
  await tx(db, async () => {
    const n = await db.notes.get(id);
    if (!n) fail('not_found', 'Esa nota ya no existe.');
    await db.notes.update(id, { done, doneAt: done ? nowISO() : null, updatedAt: nowISO() });
  });
}

/** Ya viste estos avisos dentro de la app. */
export async function markRemindersSeen(db: AppDB, id: ID, days: number[]): Promise<void> {
  await tx(db, async () => {
    const n = await db.notes.get(id);
    if (!n) return;
    await db.notes.update(id, { seen: [...new Set([...n.seen, ...days])] });
  });
}

/* ======================= Avisos ======================= */

export interface Reminder {
  noteId: ID;
  title: string;
  description: string;
  day: string;
  time: string | null;
  daysBefore: number;
  /** Cuándo sale el aviso. */
  at: Date;
  seen: boolean;
}

/** Momento del aviso: N días antes a la hora del aviso. El mismo día, si la nota tiene hora y es antes, avisa 1 hora antes. */
export function reminderTime(n: Pick<CalendarNote, 'day' | 'time' | 'remindTime'>, daysBefore: number): Date {
  const d = parseDay(n.day);
  const [rh, rm] = n.remindTime.split(':').map(Number);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBefore, rh, rm);
  if (daysBefore === 0 && n.time) {
    const [th, tm] = n.time.split(':').map(Number);
    const event = new Date(d.getFullYear(), d.getMonth(), d.getDate(), th, tm);
    if (event.getTime() <= at.getTime()) return new Date(Math.max(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), event.getTime() - 3_600_000));
  }
  return at;
}

export function noteReminders(n: CalendarNote): Reminder[] {
  return n.remindDays.map((daysBefore) => ({
    noteId: n.id,
    title: n.title,
    description: n.description,
    day: n.day,
    time: n.time,
    daysBefore,
    at: reminderTime(n, daysBefore),
    seen: n.seen.includes(daysBefore),
  }));
}

/** Avisos que ya llegaron y no has visto (de notas no hechas y que no pasaron hace más de un día). */
export function dueReminders(notes: CalendarNote[], now: Date): Reminder[] {
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const out: Reminder[] = [];
  for (const n of notes) {
    if (n.done || n.day < yesterday) continue;
    for (const r of noteReminders(n)) if (!r.seen && r.at.getTime() <= now.getTime()) out.push(r);
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.daysBefore - b.daysBefore));
}

/** Avisos que todavía no salen (para programar notificaciones del teléfono). */
export function futureReminders(notes: CalendarNote[], now: Date, limit = 60): Reminder[] {
  const out: Reminder[] = [];
  for (const n of notes) if (!n.done) for (const r of noteReminders(n)) if (r.at.getTime() > now.getTime()) out.push(r);
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
}

/** Notas de hoy en adelante (no hechas), de la más cercana a la más lejana. */
export function upcomingNotes(notes: CalendarNote[], now: Date, days = 30): CalendarNote[] {
  const today = dayKey(now);
  const until = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return notes
    .filter((n) => !n.done && n.day >= today && n.day <= until)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.time ?? '') < (b.time ?? '') ? -1 : 1));
}

/** "Hoy", "Mañana", "En 3 días", "Hace 2 días". */
export function whenText(day: string, now: Date): string {
  const diff = Math.round((parseDay(day).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return diff > 0 ? `En ${diff} días` : `Hace ${-diff} días`;
}

export function remindLabel(d: number): string {
  if (d === 0) return 'El mismo día';
  if (d === 1) return '1 día antes';
  if (d === 7) return '1 semana antes';
  if (d === 14) return '2 semanas antes';
  if (d === 30) return '1 mes antes';
  return `${d} días antes`;
}

/** Identificador numérico estable de cada aviso (las notificaciones de Android usan números de 31 bits). */
export function reminderNumber(noteId: ID, daysBefore: number): number {
  let h = 2166136261;
  const s = `${noteId}|${daysBefore}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

/* ======================= Archivo de calendario (.ics) ======================= */

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Las líneas largas se doblan a 75 caracteres (regla del formato). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * Archivo .ics con las notas y sus avisos: el calendario del teléfono (Calendario del iPhone, Google Calendar)
 * te avisa en los días que elegiste, aunque la app esté cerrada.
 */
export function buildIcs(notes: CalendarNote[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Inventario Movil//Calendario//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const n of notes) {
    const d = parseDay(n.day);
    lines.push('BEGIN:VEVENT', `UID:${n.id}@inventario-movil`, `DTSTAMP:${icsUtc(now)}`);
    if (n.time) {
      const [h, m] = n.time.split(':').map(Number);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(new Date(start.getTime() + 3_600_000))}`);
    } else {
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${n.day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${dayKey(next).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${icsText(n.title)}`);
    if (n.description) lines.push(`DESCRIPTION:${icsText(n.description)}`);
    for (const r of noteReminders(n))
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`${n.title} · ${remindLabel(r.daysBefore)}`)}`, `TRIGGER;VALUE=DATE-TIME:${icsUtc(r.at)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
