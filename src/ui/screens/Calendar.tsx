import { useEffect, useMemo, useState } from 'react';
import {
  dayKey,
  deleteNote,
  dueReminders,
  markRemindersSeen,
  newOpId,
  parseDay,
  remindLabel,
  saveNote,
  setNoteDone,
  upcomingNotes,
  whenText,
  DEFAULT_REMIND_TIME,
  MAX_REMINDERS,
  type CalendarNote,
  type ID,
  type Reminder,
} from '../../core';
import { InfoTip } from '../components/help';
import { Icon } from '../components/Icon';
import { ask, Badge, Card, Empty, Field, FormError, IntInput, Loading, Notice, Page, Sheet, TextInput } from '../components/ui';
import {
  exactAlarms,
  exportToPhoneCalendar,
  notificationPermission,
  openExactAlarmSettings,
  reminderBody,
  remindersNative,
  requestNotificationPermission,
  syncReminderNotifications,
  type NotifPermission,
} from '../reminders';
import { navigate, useRoute } from '../router';
import { db, toast, useAction, useLive } from '../store';
import { playSound } from '../sound';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DOW_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const PRESET_DAYS = [0, 1, 2, 3, 7, 14, 30];

export function dayLabel(day: string): string {
  const d = parseDay(day);
  return `${DOW_LONG[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()}${d.getFullYear() !== new Date().getFullYear() ? ` de ${d.getFullYear()}` : ''}`;
}

function time12(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Hora actual que se actualiza cada minuto (para que los avisos aparezcan a su hora con la app abierta). */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Avisos que ya llegaron y no has visto. */
export function useDueReminders(): Reminder[] | undefined {
  const now = useNow();
  return useLive(async (d) => dueReminders(await d.notes.toArray(), now), [now.getTime()]);
}

/** Lista de avisos pendientes (Inicio y Calendario). */
export function DueReminders({ list, onOpen }: { list: Reminder[]; onOpen?: (id: ID) => void }) {
  const act = useAction();
  return (
    <ul className="list" data-testid="due-reminders">
      {list.map((r) => (
        <li key={`${r.noteId}-${r.daysBefore}`}>
          <div className="item" style={{ cursor: 'default' }}>
            <span className="muted" aria-hidden="true">
              <Icon name="clock" />
            </span>
            <span className="item-main">
              <span className="item-title" style={{ display: 'block' }}>
                {r.title}
              </span>
              <span className="item-sub" style={{ display: 'block' }}>
                {reminderBody(r)}
              </span>
            </span>
            <span className="item-side row" style={{ gap: 4 }}>
              <button type="button" className="btn sm" onClick={() => (onOpen ? onOpen(r.noteId) : navigate(`/calendario?nota=${r.noteId}`))}>
                Ver
              </button>
              <button type="button" className="btn sm" data-testid="reminder-seen" onClick={() => void act.run(() => markRemindersSeen(db, r.noteId, [r.daysBefore]))}>
                Listo
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotificationsCard() {
  const [perm, setPerm] = useState<NotifPermission | null>(null);
  const [exact, setExact] = useState<boolean | null>(null);
  useEffect(() => {
    void notificationPermission().then(setPerm);
    void exactAlarms().then(setExact);
  }, []);
  if (!remindersNative())
    return (
      <Notice title="Avisos en este teléfono">
        Los avisos salen aquí dentro de la app. Para que te avise aunque la app esté cerrada, toca <strong>«Pasar al calendario del teléfono»</strong> en tus notas: el calendario del teléfono te avisa en los días que elegiste.
      </Notice>
    );
  if (perm === 'granted')
    return exact === false ? (
      <Notice kind="warn" title="Los avisos pueden llegar unos minutos tarde">
        <p>Para que lleguen a la hora exacta, permite «Alarmas y recordatorios» para Inventario Móvil.</p>
        <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => void openExactAlarmSettings().then(() => exactAlarms().then(setExact))}>
          Abrir el permiso
        </button>
      </Notice>
    ) : (
      <p className="tiny muted" data-testid="notif-ok">
        ✓ Notificaciones activadas: te avisa aunque la app esté cerrada.
      </p>
    );
  return (
    <Notice kind="warn" title="Activa las notificaciones">
      <p>Así te avisa en los días que elijas, aunque la app esté cerrada.{perm === 'denied' ? ' Están bloqueadas: actívalas en Ajustes del teléfono → Apps → Inventario Móvil → Notificaciones.' : ''}</p>
      {perm !== 'denied' ? (
        <button
          type="button"
          className="btn sm primary"
          style={{ marginTop: 6 }}
          onClick={async () => {
            const p = await requestNotificationPermission();
            setPerm(p);
            if (p === 'granted') void syncReminderNotifications();
          }}
        >
          Permitir notificaciones
        </button>
      ) : null}
    </Notice>
  );
}

export function CalendarScreen() {
  const route = useRoute();
  const now = useNow();
  const today = dayKey(now);
  const notes = useLive((d) => d.notes.toArray());
  const due = useDueReminders();
  const [cursor, setCursor] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }));
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState<CalendarNote | 'new' | null>(null);
  const openId = route.query.get('nota');
  // Desde el botón + o desde Notas: abre una nota nueva (con título y descripción si vienen)
  const wantNew = route.query.get('nueva') === '1';
  useEffect(() => {
    if (!wantNew) return;
    setEditing({ ...blankNote(dayKey(new Date())), title: (route.query.get('titulo') ?? '').slice(0, 80), description: (route.query.get('desc') ?? '').slice(0, 1000) });
    navigate('/calendario', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantNew]);
  useEffect(() => {
    if (!openId || !notes) return;
    const n = notes.find((x) => x.id === openId);
    if (n) {
      setSelected(n.day);
      const d = parseDay(n.day);
      setCursor({ y: d.getFullYear(), m: d.getMonth() });
      setEditing(n);
      navigate('/calendario', { replace: true });
    }
  }, [openId, notes]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarNote[]>();
    for (const n of notes ?? []) m.set(n.day, [...(m.get(n.day) ?? []), n]);
    return m;
  }, [notes]);

  if (!notes)
    return (
      <Page title="Calendario" back="/mas" help="calendar">
        <Loading />
      </Page>
    );
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => dayKey(new Date(cursor.y, cursor.m, i + 1)))];
  while (cells.length % 7) cells.push(null);
  const dayNotes = (byDay.get(selected) ?? []).sort((a, b) => (a.time ?? '') < (b.time ?? '') ? -1 : 1);
  const upcoming = upcomingNotes(notes, now, 30);
  const move = (k: number) => setCursor((c) => ({ y: new Date(c.y, c.m + k, 1).getFullYear(), m: new Date(c.y, c.m + k, 1).getMonth() }));

  return (
    <Page title="Calendario" back="/mas" help="calendar">
      <button type="button" className="btn primary block" onClick={() => setEditing('new')} data-testid="note-new">
        <Icon name="plus" /> Anotar en el calendario
      </button>
      {due?.length ? (
        <Card
          title={
            <h2 className="with-tip">
              Avisos <Badge kind="warn">{due.length}</Badge>
            </h2>
          }
          flush
        >
          <DueReminders list={due} onOpen={(id) => setEditing(notes.find((n) => n.id === id) ?? null)} />
        </Card>
      ) : null}
      <Card
        tour="calendar-month"
        title={
          <h2 className="with-tip">
            {MONTHS[cursor.m]} {cursor.y} <InfoTip k="calendar" />
          </h2>
        }
        action={
          <span className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={() => move(-1)}>
              <Icon name="back" />
            </button>
            <button type="button" className="icon-btn" aria-label="Mes siguiente" onClick={() => move(1)}>
              <Icon name="chevron" />
            </button>
          </span>
        }
      >
        <div className="cal-grid" role="grid" aria-label={`${MONTHS[cursor.m]} ${cursor.y}`} data-testid="cal-grid">
          {DOW.map((d, i) => (
            <span key={i} className="cal-dow" aria-hidden="true">
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (!day) return <span key={i} className="cal-cell empty" aria-hidden="true" />;
            const list = byDay.get(day) ?? [];
            const open = list.filter((n) => !n.done).length;
            return (
              <button
                key={day}
                type="button"
                className={`cal-cell${day === today ? ' today' : ''}${day === selected ? ' selected' : ''}`}
                aria-pressed={day === selected}
                aria-label={`${dayLabel(day)}${list.length ? `, ${list.length} nota(s)` : ''}`}
                onClick={() => setSelected(day)}
                data-day={day}
              >
                <span>{parseDay(day).getDate()}</span>
                {list.length ? <i className={`cal-dot${open ? '' : ' done'}`}>{list.length > 1 ? list.length : ''}</i> : null}
              </button>
            );
          })}
        </div>
        {cursor.y !== now.getFullYear() || cursor.m !== now.getMonth() ? (
          <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(today); }}>
            Ir a hoy
          </button>
        ) : null}
      </Card>
      <Card title={dayLabel(selected).replace(/^./, (c) => c.toUpperCase())} flush>
        {dayNotes.length ? <NoteList notes={dayNotes} now={now} onOpen={setEditing} /> : <Empty icon="clock" title="Sin notas este día" />}
        <div style={{ padding: '0 14px 14px' }}>
          <button type="button" className="btn sm" onClick={() => setEditing({ ...blankNote(selected) })}>
            <Icon name="plus" size={16} /> Agregar en este día
          </button>
        </div>
      </Card>
      <Card title="Próximos 30 días" flush>
        {upcoming.length ? <NoteList notes={upcoming} now={now} onOpen={setEditing} showDay /> : <Empty icon="clock" title="Nada anotado para los próximos días" />}
      </Card>
      <NotificationsCard />
      {upcoming.length && !remindersNative() ? (
        <button type="button" className="btn block wrap-btn" onClick={() => void exportToPhoneCalendar(upcoming)} data-testid="ics-all">
          <Icon name="download" /> Pasar los próximos al calendario del teléfono
        </button>
      ) : null}
      {editing ? <NoteSheet note={editing === 'new' ? blankNote(selected) : editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

function blankNote(day: string): CalendarNote {
  return { id: '', title: '', description: '', day, time: null, remindDays: [1, 0], remindTime: DEFAULT_REMIND_TIME, done: false, doneAt: null, seen: [], createdAt: '', updatedAt: '' };
}

function NoteList({ notes, now, onOpen, showDay }: { notes: CalendarNote[]; now: Date; onOpen: (n: CalendarNote) => void; showDay?: boolean }) {
  const act = useAction();
  return (
    <ul className="list" data-testid="note-list">
      {notes.map((n) => (
        <li key={n.id}>
          <div className="item">
            <label className="note-check" aria-label={n.done ? 'Marcar como pendiente' : 'Marcar como hecha'}>
              <input
                type="checkbox"
                checked={n.done}
                onChange={(e) =>
                  void act.run(async () => {
                    await setNoteDone(db, n.id, e.target.checked);
                    void syncReminderNotifications();
                    if (e.target.checked) playSound('success');
                  })
                }
              />
            </label>
            <button type="button" className="item-main note-open" onClick={() => onOpen(n)}>
              <span className={`item-title${n.done ? ' done-text' : ''}`} style={{ display: 'block' }}>
                {n.title}
              </span>
              <span className="item-sub" style={{ display: 'block' }}>
                {showDay ? `${whenText(n.day, now)} · ${dayLabel(n.day)}` : n.time ? time12(n.time) : 'Todo el día'}
                {showDay && n.time ? ` · ${time12(n.time)}` : ''}
                {n.remindDays.length ? ` · 🔔 ${n.remindDays.length}` : ''}
              </span>
              {n.description ? (
                <span className="item-sub ellipsis" style={{ display: 'block' }}>
                  {n.description}
                </span>
              ) : null}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NoteSheet({ note, onClose }: { note: CalendarNote; onClose: () => void }) {
  const isNew = !note.id;
  const [title, setTitle] = useState(note.title);
  const [description, setDescription] = useState(note.description);
  const [day, setDay] = useState(note.day);
  const [withTime, setWithTime] = useState(!!note.time);
  const [time, setTime] = useState(note.time ?? '09:00');
  const [days, setDays] = useState<number[]>(note.remindDays);
  const [remindTime, setRemindTime] = useState(note.remindTime);
  const [custom, setCustom] = useState<number | null>(null);
  const [opId] = useState(newOpId);
  const act = useAction();
  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].slice(0, MAX_REMINDERS)));
  const allDays = [...new Set([...PRESET_DAYS, ...days])].sort((a, b) => a - b);
  const save = async () => {
    const saved = await act.run(() => saveNote(db, { id: note.id || undefined, opId: isNew ? opId : undefined, title, description, day, time: withTime ? time : null, remindDays: days, remindTime }), isNew ? 'Nota guardada' : 'Nota actualizada');
    if (saved === undefined) return;
    if (remindersNative() && days.length) {
      let p = await notificationPermission();
      if (p === 'prompt') p = await requestNotificationPermission();
      if (p !== 'granted') toast('Activa las notificaciones para que te avise con la app cerrada', 'error', 5000);
    }
    void syncReminderNotifications();
    onClose();
  };
  return (
    <Sheet
      title={isNew ? 'Nueva nota' : 'Nota'}
      onClose={onClose}
      footer={
        <button type="button" className="btn primary block" disabled={act.busy} onClick={() => void save()} data-testid="save-note">
          Guardar
        </button>
      }
    >
      <Field label="Nombre" htmlFor="nt-title" error={act.field === 'title' ? act.error : null}>
        <TextInput id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Pagar el arriendo, pedido al proveedor" maxLength={80} />
      </Field>
      <Field label="Descripción (opcional)" htmlFor="nt-desc">
        <textarea id="nt-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalles, valor, teléfono…" maxLength={1000} />
      </Field>
      <div className="grid-2">
        <Field label="Día" htmlFor="nt-day" error={act.field === 'day' ? act.error : null}>
          <input id="nt-day" type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
        <Field label="Hora (opcional)" htmlFor="nt-time">
          {withTime ? <input id="nt-time" type="time" className="input" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} /> : <p className="small muted">Todo el día</p>}
          <label className="check small">
            <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} /> Con hora
          </label>
        </Field>
      </div>
      <Field label="¿Cuándo te aviso?" hint="Elige uno o varios. Sin ninguno, la nota no avisa.">
        <div className="chips wrap" role="group" aria-label="Avisos">
          {allDays.map((d) => (
            <button key={d} type="button" className="chip" aria-pressed={days.includes(d)} onClick={() => toggle(d)} data-testid={`remind-${d}`}>
              {remindLabel(d)}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Otro: días antes" htmlFor="nt-custom">
          <div className="row" style={{ gap: 6 }}>
            <IntInput id="nt-custom" value={custom} onChange={(v) => setCustom(v === null ? null : Math.min(v, 365))} placeholder="Ej.: 5" />
            <button type="button" className="btn sm" disabled={custom === null || days.includes(custom)} onClick={() => custom !== null && (toggle(custom), setCustom(null))}>
              Agregar
            </button>
          </div>
        </Field>
        <Field label="Hora del aviso" htmlFor="nt-rt">
          <input id="nt-rt" type="time" className="input" value={remindTime} onChange={(e) => e.target.value && setRemindTime(e.target.value)} />
        </Field>
      </div>
      {act.field && act.field !== 'title' && act.field !== 'day' ? <FormError error={act.error} /> : act.field ? null : <FormError error={act.error} />}
      {!isNew ? (
        <div className="row wrap" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              void act.run(async () => {
                await setNoteDone(db, note.id, !note.done);
                void syncReminderNotifications();
                onClose();
              }, note.done ? 'Nota pendiente otra vez' : '¡Hecho!')
            }
          >
            <Icon name="check" size={16} /> {note.done ? 'Marcar pendiente' : 'Marcar como hecha'}
          </button>
          <button type="button" className="btn sm" onClick={() => void exportToPhoneCalendar([note])} data-testid="ics-one">
            <Icon name="download" size={16} /> Pasar al calendario del teléfono
          </button>
          <button
            type="button"
            className="btn sm danger"
            onClick={async () => {
              const r = await ask({ title: 'Borrar nota', message: `Se borra «${note.title}» y sus avisos.`, confirmText: 'Borrar', danger: true });
              if (r.ok) {
                await act.run(() => deleteNote(db, note.id), 'Nota borrada');
                void syncReminderNotifications();
                onClose();
              }
            }}
          >
            <Icon name="trash" size={16} /> Borrar
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
