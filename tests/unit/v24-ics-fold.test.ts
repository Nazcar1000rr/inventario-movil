import { describe, expect, it } from 'vitest';
import { buildIcs, saveNote } from '../../src/core';
import { makeDB } from './helpers';

const octets = (s: string) => new TextEncoder().encode(s).length;

describe('v2.4 · archivo .ics: líneas dobladas por octetos', () => {
  it('ninguna línea pasa de 75 bytes aunque tenga tildes y emojis, y al desdoblar queda el texto original', async () => {
    const db = await makeDB();
    const title = 'Cobrar a María José Núñez la cuota del iPhone 13 Pro 📱 ' + 'ñandú ✓ '.repeat(8);
    const n = (await saveNote(db, { title, description: 'Acción pendiente: llamar a Peña 🇨🇴 ' + 'ó'.repeat(90), day: '2026-11-05', remindDays: [1] }))!;
    const ics = buildIcs([n], new Date('2026-10-11T12:00:00Z'));
    const lines = ics.split('\r\n');
    expect(lines.every((l) => octets(l) <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${n.title}`);
    expect(unfolded).toContain(`DESCRIPTION:${n.description}`);
    expect(n.description.length).toBeGreaterThan(100);
    expect(unfolded).not.toContain('�');
  });

  it('una línea corta no se dobla', async () => {
    const db = await makeDB();
    const n = (await saveNote(db, { title: 'Feria', day: '2026-11-07', remindDays: [] }))!;
    expect(buildIcs([n]).includes('\r\n ')).toBe(false);
  });
});
