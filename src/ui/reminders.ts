import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { buildIcs, formatDate, futureReminders, parseDay, reminderNumber, type CalendarNote, type Reminder } from '../core';
import { isIOS, isStandalone, shareFile } from './platform';
import { navigate } from './router';
import { db } from './store';

/**
 * NOTIFICACIONES DE RECORDATORIOS (v2.3)
 * - App de Android: notificaciones del teléfono programadas con anticipación (salen aunque la app esté cerrada;
 *   se vuelven a programar al reiniciar el teléfono). No usan internet ni servidores.
 * - iPhone y navegador: Apple no permite que una app web programe notificaciones sin un servidor, así que los avisos
 *   salen dentro de la app y puedes pasar las notas al calendario del teléfono (.ics) para que él te avise.
 */

const native = Capacitor.isNativePlatform();
const CHANNEL = 'recordatorios';

export type NotifPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export function remindersNative(): boolean {
  return native;
}

export async function notificationPermission(): Promise<NotifPermission> {
  if (!native) return 'unsupported';
  try {
    const p = await LocalNotifications.checkPermissions();
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<NotifPermission> {
  if (!native) return 'unsupported';
  try {
    const p = await LocalNotifications.requestPermissions();
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

/** Android 12+: si las alarmas exactas están apagadas, el aviso puede llegar unos minutos tarde. */
export async function exactAlarms(): Promise<boolean | null> {
  if (!native) return null;
  try {
    const r = await LocalNotifications.checkExactNotificationSetting();
    return r.exact_alarm === 'granted';
  } catch {
    return null;
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (native) await LocalNotifications.changeExactNotificationSetting().catch(() => undefined);
}

function time12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Texto del aviso: "Mañana a las 3:00 p. m.", "En 3 días (sáb, 17 oct)". */
export function reminderBody(r: Pick<Reminder, 'daysBefore' | 'day' | 'time' | 'description'>): string {
  const when = r.daysBefore === 0 ? (r.time ? `Hoy a las ${time12(r.time)}` : 'Es hoy') : r.daysBefore === 1 ? `Mañana${r.time ? ` a las ${time12(r.time)}` : ''}` : `En ${r.daysBefore} días (${formatDate(parseDay(r.day).toISOString())})`;
  const desc = r.description.split('\n')[0].slice(0, 120);
  return desc ? `${when} · ${desc}` : when;
}

let syncing: Promise<number | null> | null = null;

/** Vuelve a programar todas las notificaciones futuras (después de guardar, borrar o al abrir la app). */
export function syncReminderNotifications(): Promise<number | null> {
  if (!native) return Promise.resolve(null);
  if (syncing) return syncing.then(() => syncReminderNotifications());
  syncing = (async () => {
    try {
      if ((await notificationPermission()) !== 'granted') return null;
      await LocalNotifications.createChannel({ id: CHANNEL, name: 'Recordatorios del calendario', description: 'Avisos de las notas de tu calendario', importance: 4, visibility: 1 }).catch(() => undefined);
      const pending = await LocalNotifications.getPending();
      const ours = pending.notifications.filter((n) => (n.extra as { kind?: string } | undefined)?.kind === 'note');
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      const notes = await db.notes.toArray();
      const list = futureReminders(notes, new Date(), 60);
      if (list.length)
        await LocalNotifications.schedule({
          notifications: list.map((r) => ({
            id: reminderNumber(r.noteId, r.daysBefore),
            title: r.title,
            body: reminderBody(r),
            channelId: CHANNEL,
            smallIcon: 'ic_stat_notify',
            schedule: { at: r.at, allowWhileIdle: true },
            extra: { kind: 'note', noteId: r.noteId },
          })),
        });
      return list.length;
    } catch {
      return null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Al abrir la app: reprograma y, si tocas una notificación, abre la nota. */
export function installReminders(): void {
  if (!native) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const id = (e.notification.extra as { noteId?: string } | undefined)?.noteId;
    navigate(id ? `/calendario?nota=${id}` : '/calendario');
  });
  void syncReminderNotifications();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncReminderNotifications();
  });
}

/** Pasa notas al calendario del teléfono (archivo .ics con sus avisos). */
export async function exportToPhoneCalendar(notes: CalendarNote[]): Promise<'opened' | 'shared' | 'downloaded' | 'cancelled'> {
  const text = buildIcs(notes);
  const name = notes.length === 1 ? `${notes[0].title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'nota'}.ics` : 'calendario-inventario.ics';
  if (!native && isIOS()) {
    // En el iPhone, abrir el archivo muestra "Agregar al calendario"
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    if (isStandalone()) window.open(url, '_blank');
    else location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'opened';
  }
  return shareFile(name, text, 'text/calendar');
}
