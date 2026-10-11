import { useSyncExternalStore } from 'react';

/**
 * SONIDOS (v2.1) — generados con Web Audio (no hay archivos de audio ni nada que descargar).
 * Cada sonido se activa o desactiva por separado en Configuración → Sonidos; no hay un interruptor general
 * a propósito. Las preferencias se guardan solo en este teléfono (almacenamiento local).
 */

export type SoundName = 'tap' | 'nav' | 'open' | 'success' | 'sale' | 'purchase' | 'error' | 'achievement';

export const SOUNDS: { id: SoundName; label: string; hint: string }[] = [
  { id: 'tap', label: 'Toques de botones', hint: 'Un clic suave al tocar botones y opciones.' },
  { id: 'nav', label: 'Cambiar de sección', hint: 'Al usar la barra de abajo o el menú lateral.' },
  { id: 'open', label: 'Abrir ventanas', hint: 'Al abrir un diálogo o una hoja de opciones.' },
  { id: 'success', label: 'Guardado con éxito', hint: 'Cuando algo se guarda bien.' },
  { id: 'sale', label: 'Venta registrada', hint: 'Sonido de caja al registrar una venta.' },
  { id: 'purchase', label: 'Compra registrada', hint: 'Al registrar una compra.' },
  { id: 'error', label: 'Errores y avisos', hint: 'Cuando algo no se pudo guardar.' },
  { id: 'achievement', label: 'Logros', hint: 'Al completar un paso, una lección o acertar una pregunta.' },
];

const DEFAULT_VOLUME = 0.6;
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* sin almacenamiento local: se usa el valor por defecto */
  }
}

export function isSoundOn(name: SoundName): boolean {
  return read(`sound:${name}`) !== '0';
}
export function setSoundOn(name: SoundName, on: boolean): void {
  write(`sound:${name}`, on ? '1' : '0');
  emit();
}
export function getVolume(): number {
  const v = Number.parseFloat(read('sound:volume') ?? '');
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VOLUME;
}
export function setVolume(v: number): void {
  write('sound:volume', String(Math.max(0, Math.min(1, v))));
  emit();
}

/** Para la pantalla de Configuración: se vuelve a dibujar cuando cambian las preferencias. */
export function useSoundPrefs(): { on: Record<SoundName, boolean>; volume: number } {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const on = {} as Record<SoundName, boolean>;
  for (const s of SOUNDS) on[s.id] = isSoundOn(s.id);
  return { on, volume: getVolume() };
}

/* ---------------- Síntesis ---------------- */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

interface Note {
  f: number; // frecuencia (Hz)
  t: number; // inicio (s)
  d: number; // duración (s)
  type?: OscillatorType;
  g?: number; // ganancia relativa
  slide?: number; // frecuencia final (glissando)
}

const RECIPES: Record<SoundName, Note[]> = {
  tap: [{ f: 1200, t: 0, d: 0.035, type: 'sine', g: 0.25 }],
  nav: [
    { f: 660, t: 0, d: 0.06, type: 'sine', g: 0.25 },
    { f: 880, t: 0.05, d: 0.07, type: 'sine', g: 0.22 },
  ],
  open: [{ f: 420, t: 0, d: 0.12, type: 'triangle', g: 0.22, slide: 640 }],
  success: [
    { f: 784, t: 0, d: 0.09, type: 'sine', g: 0.3 },
    { f: 1046, t: 0.08, d: 0.16, type: 'sine', g: 0.3 },
  ],
  sale: [
    { f: 1318, t: 0, d: 0.07, type: 'square', g: 0.12 },
    { f: 1760, t: 0.07, d: 0.12, type: 'square', g: 0.12 },
    { f: 2637, t: 0.16, d: 0.22, type: 'sine', g: 0.22 },
  ],
  purchase: [
    { f: 523, t: 0, d: 0.08, type: 'triangle', g: 0.3 },
    { f: 659, t: 0.08, d: 0.08, type: 'triangle', g: 0.3 },
    { f: 784, t: 0.16, d: 0.14, type: 'triangle', g: 0.3 },
  ],
  error: [
    { f: 330, t: 0, d: 0.12, type: 'sawtooth', g: 0.12 },
    { f: 247, t: 0.12, d: 0.18, type: 'sawtooth', g: 0.12 },
  ],
  achievement: [
    { f: 523, t: 0, d: 0.1, type: 'sine', g: 0.28 },
    { f: 659, t: 0.09, d: 0.1, type: 'sine', g: 0.28 },
    { f: 784, t: 0.18, d: 0.1, type: 'sine', g: 0.28 },
    { f: 1046, t: 0.27, d: 0.28, type: 'sine', g: 0.3 },
  ],
};

/** Últimos sonidos (solo nombres), para las pruebas automáticas. No guarda datos del negocio. */
export const recentSounds: SoundName[] = [];

let lastTap: { at: number; gain: GainNode } | null = null;

export function playSound(name: SoundName): void {
  if (!isSoundOn(name)) return;
  const vol = getVolume();
  recentSounds.push(name);
  if (recentSounds.length > 30) recentSounds.shift();
  if (vol <= 0) return;
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume();
    const now = ac.currentTime + 0.005;
    // Un sonido "de resultado" justo después de un toque reemplaza el clic (no se enciman)
    if (name !== 'tap' && lastTap && performance.now() - lastTap.at < 80) {
      lastTap.gain.gain.cancelScheduledValues(now);
      lastTap.gain.gain.setValueAtTime(0, now);
    }
    const master = ac.createGain();
    master.gain.value = vol * 0.5;
    master.connect(ac.destination);
    for (const n of RECIPES[name]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = n.type ?? 'sine';
      o.frequency.setValueAtTime(n.f, now + n.t);
      if (n.slide) o.frequency.exponentialRampToValueAtTime(n.slide, now + n.t + n.d);
      g.gain.setValueAtTime(0.0001, now + n.t);
      g.gain.exponentialRampToValueAtTime(n.g ?? 0.25, now + n.t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      o.connect(g).connect(master);
      o.start(now + n.t);
      o.stop(now + n.t + n.d + 0.02);
    }
    if (name === 'tap') lastTap = { at: performance.now(), gain: master };
  } catch {
    /* el audio no es esencial: si falla, la app sigue igual */
  }
}

/** Sonido según el mensaje de éxito de una acción (venta, compra u otro). */
export function soundForMessage(msg: string): SoundName {
  const m = msg.toLowerCase();
  if (m.startsWith('venta registrada')) return 'sale';
  if (m.startsWith('compra registrada')) return 'purchase';
  return 'success';
}

let installed = false;
/** Clic suave en botones y enlaces; sonido de navegación en la barra de secciones. */
export function installSoundHandlers(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], summary') as HTMLElement | null;
      if (!el) return;
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (el.dataset.sound === 'none' || el.closest('[data-sound="none"]')) return;
      if (el.closest('.bottom-nav, .side-nav')) playSound('nav');
      else playSound('tap');
    },
    true,
  );
}
