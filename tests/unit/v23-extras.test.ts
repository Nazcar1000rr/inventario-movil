import { describe, expect, it } from 'vitest';
import {
  collectionMessage,
  createBackup,
  deleteMemo,
  listMemos,
  memoShareText,
  memoTitle,
  parseBackup,
  restoreBackup,
  restoreMemo,
  saveMemo,
  setMemoPinned,
  whatsappLink,
  whatsappNumber,
} from '../../src/core';
import { expectIntegrity, makeDB, op } from './helpers';

const fmt = (v: number) => `$ ${v.toLocaleString('es-CO')}`;
const fmtDate = (iso: string) => iso.slice(0, 10);

describe('v2.3 · notas', () => {
  it('guarda, edita, fija, busca sin tildes, borra y deshace; viajan en el respaldo', async () => {
    const db = await makeDB();
    await expect(saveMemo(db, { title: '  ', text: '\n ' })).rejects.toThrow('Escribe algo');
    const a = (await saveMemo(db, { opId: op(), title: 'Pedido de Andrés', text: 'Funda MagSafe\nCargador 20 W' }))!;
    const b = (await saveMemo(db, { opId: op(), text: 'Llamar al técnico por la pantalla del 13 Pro' }))!;
    expect(memoTitle(b)).toBe('Llamar al técnico por la pantalla del 13 Pro');
    expect(memoTitle({ title: '', text: '' })).toBe('Nota');
    // Doble toque no duplica
    const opId = op();
    await saveMemo(db, { opId, text: 'Una' });
    expect(await saveMemo(db, { opId, text: 'Una' })).toBeNull();
    expect(await db.memos.count()).toBe(3);

    await new Promise((r) => setTimeout(r, 5));
    await saveMemo(db, { id: a.id, title: 'Pedido de Andrés', text: 'Funda MagSafe\nCargador 20 W\nVidrio templado' });
    expect((await listMemos(db))[0].id).toBe(a.id); // la editada sube
    await setMemoPinned(db, b.id, true);
    expect((await listMemos(db))[0].id).toBe(b.id); // la fijada va primero
    expect((await listMemos(db, 'tecnico')).map((m) => m.id)).toEqual([b.id]);
    expect((await listMemos(db, 'andres vidrio')).map((m) => m.id)).toEqual([a.id]);
    expect(memoShareText((await db.memos.get(a.id))!)).toBe('Pedido de Andrés\n\nFunda MagSafe\nCargador 20 W\nVidrio templado');

    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup((await createBackup(db)).text), { safetyName: 'seg-' + op() });
    expect(await db2.memos.count()).toBe(3);
    expect((await db2.memos.get(b.id))!.pinned).toBe(true);

    const gone = (await deleteMemo(db, a.id))!;
    expect(await db.memos.count()).toBe(2);
    await restoreMemo(db, gone);
    expect((await db.memos.get(a.id))!.text).toContain('Vidrio templado');
    await expectIntegrity(db);
  });
});

describe('v2.3 · cobrar por WhatsApp', () => {
  it('número con indicativo de Colombia y enlace con el mensaje que escribes', () => {
    expect(whatsappNumber('300 123 4567')).toBe('573001234567');
    expect(whatsappNumber('(300) 123-4567')).toBe('573001234567');
    expect(whatsappNumber('+57 300 123 4567')).toBe('573001234567');
    expect(whatsappNumber('573001234567')).toBe('573001234567');
    expect(whatsappNumber('0057 300 123 4567')).toBe('573001234567');
    expect(whatsappNumber('+1 (305) 555-0100')).toBe('13055550100');
    expect(whatsappNumber('123 4567')).toBeNull(); // fijo sin indicativo
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappLink('573001234567', ' Hola Ana, ¿me abonas $ 20.000? ')).toBe('https://wa.me/573001234567?text=Hola%20Ana%2C%20%C2%BFme%20abonas%20%24%2020.000%3F');
    expect(whatsappLink('573001234567', '')).toBe('https://wa.me/573001234567');
  });

  it('mensajes de cobro: amable, fecha y firme, con detalle opcional', () => {
    const d = {
      name: 'Ana Pérez',
      pending: 70_000,
      nextDue: '2026-10-20T17:00:00.000Z',
      oldest: '2026-09-01T17:00:00.000Z',
      items: [
        { type: 'sale' as const, id: 's', inventoryId: null, date: '2026-09-01T17:00:00.000Z', dueDate: null, concept: '2 × Funda', original: 50_000, paid: 20_000, forgiven: 0, pending: 30_000, overdue: false },
        { type: 'credit' as const, id: 'c', inventoryId: null, date: '2026-10-01T17:00:00.000Z', dueDate: null, concept: 'Le prestaste plata', original: 40_000, paid: 0, forgiven: 0, pending: 40_000, overdue: false },
        { type: 'sale' as const, id: 'p', inventoryId: null, date: '2026-08-01T17:00:00.000Z', dueDate: null, concept: 'Cable', original: 10_000, paid: 10_000, forgiven: 0, pending: 0, overdue: false },
      ],
    };
    const amable = collectionMessage(d, 'Tienda Nazcar', fmt, fmtDate);
    expect(amable).toContain('Hola Ana');
    expect(amable).toContain('de Tienda Nazcar');
    expect(amable).toContain('(quedamos para el 2026-10-20)');
    expect(collectionMessage(d, '', fmt, fmtDate, { tone: 'fecha' })).toContain('quedamos para el 2026-10-20 con el pago');
    expect(collectionMessage({ ...d, nextDue: null }, '', fmt, fmtDate, { tone: 'fecha' })).toContain('¿Para qué fecha me puedes abonar?');
    expect(collectionMessage(d, '', fmt, fmtDate, { tone: 'firme' })).toContain('desde el 2026-09-01');
    const detail = collectionMessage(d, '', fmt, fmtDate, { detail: true });
    expect(detail).toContain('\n\nDetalle:\n• 2 × Funda (2026-09-01): $ 30.000\n• Le prestaste plata (2026-10-01): $ 40.000');
    expect(detail).not.toContain('Cable');
  });
});
