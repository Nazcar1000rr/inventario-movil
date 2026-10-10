import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { AppError, errorMessage, getDB, type AppDB } from '../core';

export const db: AppDB = getDB();

/** Consulta reactiva: se recalcula sola cuando cambian las tablas leídas. `undefined` = cargando. */
export function useLive<T>(fn: (db: AppDB) => Promise<T> | T, deps: unknown[] = []): T | undefined {
  return useLiveQuery(() => fn(db), deps);
}

/* ---------------- Avisos breves (toasts) ---------------- */

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}
let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
function emitToasts() {
  toastListeners.forEach((l) => l());
}
export function toast(text: string, kind: Toast['kind'] = 'ok', ms = 3500): void {
  const t = { id: ++toastSeq, text, kind };
  toasts = [...toasts, t].slice(-3);
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emitToasts();
  }, ms);
}
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toasts,
  );
}

/* ---------------- Pila de diálogos (para el botón Atrás de Android) ---------------- */

const modalStack: (() => void)[] = [];
export function pushModal(close: () => void): () => void {
  modalStack.push(close);
  return () => {
    const i = modalStack.lastIndexOf(close);
    if (i >= 0) modalStack.splice(i, 1);
  };
}
/** Cierra el diálogo superior. Devuelve false si no había ninguno. */
export function closeTopModal(): boolean {
  const c = modalStack[modalStack.length - 1];
  if (!c) return false;
  c();
  return true;
}

/* ---------------- Acciones con protección contra doble pulsación ---------------- */

export interface ActionState {
  busy: boolean;
  error: string | null;
  field: string | null;
  run: <T>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined>;
  clear: () => void;
}

export function useAction(): ActionState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const lock = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMessage?: string) => {
    if (lock.current) return undefined; // evita doble pulsación
    lock.current = true;
    setBusy(true);
    setError(null);
    setField(null);
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      setField(e instanceof AppError ? e.field ?? null : null);
      toast(msg, 'error', 5000);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => {
    setError(null);
    setField(null);
  }, []);
  return { busy, error, field, run, clear };
}

/* ---------------- Preferencias locales de visualización (no críticas) ---------------- */

export function getPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: string): void {
  try {
    localStorage.setItem(`pref:${key}`, value);
  } catch {
    /* almacenamiento no disponible: se ignora */
  }
}
export function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => getPref(key, fallback));
  const set = useCallback(
    (nv: string) => {
      setV(nv);
      setPref(key, nv);
    },
    [key],
  );
  return [v, set];
}
