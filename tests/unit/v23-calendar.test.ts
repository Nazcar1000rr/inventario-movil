import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  createBackup,
  deleteNote,
  dueReminders,
  futureReminders,
  markRemindersSeen,
  parseBackup,
  reminderNumber,
  reminderTime,
  restoreBackup,
  saveNote,
  setNoteDone,
  upcomingNotes,
  whenText,
} from '../../src/core';
import { expectIntegrity, makeDB, op } from './helpers';

describe('v2.3 · calendario y recordatorios', () => {
  it('guarda notas con descripción opcional y avisos en los días que eliges', async () => {
    const db = await makeDB();
    const n = (await saveNote(db, { opId: op(), title: 'Pagar arriendo', day: '2026-10-20', remindDays: [0, 3, 1, 3], remindTime: '09:30' }))!;
    expect(n.description).toBe('');
    expect(n.remindDays).toEqual([3, 1, 0]);
    // Avisos: 17, 19 y 20 de octubre a las 9:30 a. m. (hora local)
    expect(reminderTime(n, 3)).toEqual(new Date(2026, 9, 17, 9, 30));
    expect(reminderTime(n, 0)).toEqual(new Date(2026, 9, 20, 9, 30));
    // Si la nota es temprano (7:00), el aviso del mismo día sale 1 hora antes
    expect(reminderTime({ day: '2026-10-20', time: '07:00', remindTime: '09:30' }, 0)).toEqual(new Date(2026, 9, 20, 6, 0));

    await expect(saveNote(db, { title: ' ', day: '2026-10-20' })).rejects.toMatchObject({ code: 'required' });
    await expect(saveNote(db, { title: 'X', day: '2026-02-30' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(saveNote(db, { title: 'X', day: '2026-10-20', remindTime: '25:00' })).rejects.toMatchObject({ code: 'invalid' });

    const now = new Date(2026, 9, 18, 12, 0);
    expect(dueReminders([n], now).map((r) => r.daysBefore)).toEqual([3]);
    expect(futureReminders([n], now).map((r) => r.daysBefore)).toEqual([1, 0]);
    expect(whenText(n.day, now)).toBe('En 2 días');
    await markRemindersSeen(db, n.id, [3]);
    const seen = (await db.notes.get(n.id))!;
    expect(dueReminders([seen], now)).toEqual([]);
    // Cambiar la fecha vuelve a activar los avisos
    const moved = (await saveNote(db, { id: n.id, title: 'Pagar arriendo', description: 'Transferencia a don Luis', day: '2026-10-21', remindDays: [3, 1, 0], remindTime: '09:30' }))!;
    expect(moved.seen).toEqual([]);
    expect(moved.description).toBe('Transferencia a don Luis');
    expect(await db.notes.count()).toBe(1);

    await saveNote(db, { opId: op(), title: 'Pedido al proveedor', day: '2026-10-19', time: '15:00', remindDays: [1] });
    expect(upcomingNotes(await db.notes.toArray(), now).map((x) => x.title)).toEqual(['Pedido al proveedor', 'Pagar arriendo']);
    await setNoteDone(db, n.id, true);
    expect(futureReminders(await db.notes.toArray(), now).every((r) => r.noteId !== n.id)).toBe(true);
    expect(reminderNumber(n.id, 1)).toBeGreaterThan(0);
    expect(reminderNumber(n.id, 1)).toBeLessThan(2 ** 31);
    expect(reminderNumber(n.id, 1)).not.toBe(reminderNumber(n.id, 0));
    await expectIntegrity(db);

    // Respaldo
    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup((await createBackup(db)).text), { safetyName: 'seg-' + op() });
    expect(await db2.notes.count()).toBe(2);
    await deleteNote(db, n.id);
    expect(await db.notes.count()).toBe(1);
  });

  it('archivo .ics con alarmas para el calendario del teléfono', async () => {
    const db = await makeDB();
    const a = (await saveNote(db, { title: 'Pagar tarjeta; cuota, 3', description: 'Línea 1\nLínea 2', day: '2026-11-05', remindDays: [2, 0] }))!;
    const b = (await saveNote(db, { title: 'Feria', day: '2026-11-07', time: '10:00', remindDays: [] }))!;
    const ics = buildIcs([a, b], new Date('2026-10-11T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261105');
    expect(ics).toContain('DTEND;VALUE=DATE:20261106');
    expect(ics).toContain('SUMMARY:Pagar tarjeta\\; cuota\\, 3');
    expect(ics).toContain('DESCRIPTION:Línea 1\\nLínea 2');
    // 3 de noviembre 8:00 a. m. en Bogotá = 13:00 UTC
    expect(ics).toContain('TRIGGER;VALUE=DATE-TIME:20261103T130000Z');
    expect(ics).toContain('DTSTART:20261107T150000Z');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
