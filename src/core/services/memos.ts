import type { AppDB } from '../db';
import type { ID, Memo } from '../types';
import { cleanStr, fail, newId, nowISO } from '../util';
import { claimOp, tx } from './stock';

/**
 * NOTAS (v2.3): libreta para lo que quieras anotar (pedidos, ideas, listas, datos de un cliente).
 * No tienen fecha; si una necesita aviso, se pasa al calendario.
 */

export const MEMO_TITLE_MAX = 80;
export const MEMO_TEXT_MAX = 5000;

export interface MemoInput {
  id?: ID;
  opId?: string;
  title?: string;
  text?: string;
  pinned?: boolean;
}

export async function saveMemo(db: AppDB, input: MemoInput): Promise<Memo | null> {
  const title = cleanStr(input.title ?? '', MEMO_TITLE_MAX);
  const text = (input.text ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, MEMO_TEXT_MAX);
  if (!title && !text) fail('required', 'Escribe algo en la nota.', 'text');
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const prev = input.id ? await db.memos.get(input.id) : undefined;
    if (input.id && !prev) fail('not_found', 'Esa nota ya no existe.');
    const now = nowISO();
    const m: Memo = {
      id: prev?.id ?? newId(),
      title,
      text,
      pinned: input.pinned ?? prev?.pinned ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await db.memos.put(m);
    return m;
  });
}

export async function setMemoPinned(db: AppDB, id: ID, pinned: boolean): Promise<void> {
  // Fijar no cambia la fecha de edición (para no moverla en la lista)
  const n = await db.memos.update(id, { pinned });
  if (!n) fail('not_found', 'Esa nota ya no existe.');
}

/** Borra una nota y la devuelve (para poder deshacer). */
export async function deleteMemo(db: AppDB, id: ID): Promise<Memo | null> {
  return tx(db, async () => {
    const m = await db.memos.get(id);
    if (!m) return null;
    await db.memos.delete(id);
    return m;
  });
}

/** Deshacer el borrado: vuelve a guardar la nota tal como estaba. */
export async function restoreMemo(db: AppDB, m: Memo): Promise<void> {
  await db.memos.put(m);
}

/** Título que se muestra: el escrito o la primera línea del texto. */
export function memoTitle(m: Pick<Memo, 'title' | 'text'>): string {
  if (m.title) return m.title;
  const first = m.text.split('\n').find((l) => l.trim()) ?? '';
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first || 'Nota';
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Fijadas primero; luego la más reciente. Con búsqueda, filtra por título y texto (sin importar tildes). */
export function sortMemos(list: Memo[], q = ''): Memo[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list
    .filter((m) => {
      if (!words.length) return true;
      const hay = fold(`${m.title}\n${m.text}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function listMemos(db: AppDB, q = ''): Promise<Memo[]> {
  return sortMemos(await db.memos.toArray(), q);
}

/** Texto para compartir o copiar. */
export function memoShareText(m: Pick<Memo, 'title' | 'text'>): string {
  return [m.title, m.text].filter(Boolean).join('\n\n');
}
