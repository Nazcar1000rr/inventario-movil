import { useSyncExternalStore } from 'react';

/**
 * SONIDOS — generados con Web Audio (no hay archivos de audio ni nada que descargar).
 * v2.1: cada sonido se activa o desactiva por separado (no hay un interruptor general a propósito).
 * v2.2: paquetes de tonos (Suave, Caja registradora, Burbujas, Retro, Cristal, Madera), tono elegido por sonido
 *       y opción para sonar aunque el iPhone esté en silencio (Audio Session API, iOS 17 o superior).
 * Las preferencias se guardan solo en este teléfono (almacenamiento local).
 */

export type SoundName = 'tap' | 'nav' | 'open' | 'success' | 'sale' | 'purchase' | 'error' | 'achievement';
export type PackId = 'suave' | 'caja' | 'burbujas' | 'retro' | 'cristal' | 'madera';

export const SOUNDS: { id: SoundName; label: string; hint: string }[] = [
  { id: 'tap', label: 'Toques de botones', hint: 'Al tocar botones y opciones.' },
  { id: 'nav', label: 'Cambiar de sección', hint: 'Al usar la barra de abajo o el menú lateral.' },
  { id: 'open', label: 'Abrir ventanas', hint: 'Al abrir un diálogo o una hoja de opciones.' },
  { id: 'success', label: 'Guardado con éxito', hint: 'Cuando algo se guarda bien.' },
  { id: 'sale', label: 'Venta registrada', hint: 'Al registrar una venta.' },
  { id: 'purchase', label: 'Compra registrada', hint: 'Al registrar una compra.' },
  { id: 'error', label: 'Errores y avisos', hint: 'Cuando algo no se pudo guardar.' },
  { id: 'achievement', label: 'Logros', hint: 'Al completar un paso, una lección o acertar una pregunta.' },
];

export const PACKS: { id: PackId; label: string; hint: string }[] = [
  { id: 'suave', label: 'Suave', hint: 'Tonos limpios y discretos' },
  { id: 'caja', label: 'Caja registradora', hint: 'Clics, monedas y campanita de caja' },
  { id: 'burbujas', label: 'Burbujas', hint: 'Pops alegres' },
  { id: 'retro', label: 'Retro', hint: 'Estilo videojuego de 8 bits' },
  { id: 'cristal', label: 'Cristal', hint: 'Campanitas claras' },
  { id: 'madera', label: 'Madera', hint: 'Marimba cálida' },
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
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* sin almacenamiento local: se usa el valor por defecto */
  }
}

const isPack = (v: string | null): v is PackId => !!v && PACKS.some((p) => p.id === v);

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
/** Paquete general. */
export function getPack(): PackId {
  const v = read('sound:pack');
  return isPack(v) ? v : 'suave';
}
export function setPack(p: PackId): void {
  write('sound:pack', p);
  emit();
}
/** Tono elegido para un sonido (null = el del paquete general). */
export function getToneOverride(name: SoundName): PackId | null {
  const v = read(`sound:tone:${name}`);
  return isPack(v) ? v : null;
}
export function setToneOverride(name: SoundName, p: PackId | null): void {
  write(`sound:tone:${name}`, p);
  emit();
}
export function toneFor(name: SoundName): PackId {
  return getToneOverride(name) ?? getPack();
}

/* ---------------- Sonar con el iPhone en silencio ---------------- */

interface AudioSessionLike {
  type: string;
}
function audioSession(): AudioSessionLike | null {
  const s = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
  return s && typeof s === 'object' ? s : null;
}
/** true si el navegador permite elegir si el sonido respeta el modo silencio (iPhone con iOS 17 o superior). */
export function canIgnoreSilentSwitch(): boolean {
  return audioSession() !== null;
}
export function getIgnoreSilent(): boolean {
  return read('sound:ignoreSilent') === '1';
}
export function setIgnoreSilent(on: boolean): void {
  write('sound:ignoreSilent', on ? '1' : '0');
  applyAudioSession();
  // Un contexto de audio nuevo toma la configuración nueva
  dropCtx();
  emit();
}
/** "playback" suena aunque el interruptor de silencio esté activado; "auto" respeta el silencio. */
export function applyAudioSession(): void {
  const s = audioSession();
  if (!s) return;
  try {
    s.type = getIgnoreSilent() ? 'playback' : 'auto';
  } catch {
    /* no disponible: se ignora */
  }
}

/** Para la pantalla de Configuración: se vuelve a dibujar cuando cambian las preferencias. */
export function useSoundPrefs(): {
  on: Record<SoundName, boolean>;
  tone: Record<SoundName, PackId | null>;
  pack: PackId;
  volume: number;
  ignoreSilent: boolean;
} {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const on = {} as Record<SoundName, boolean>;
  const tone = {} as Record<SoundName, PackId | null>;
  for (const s of SOUNDS) {
    on[s.id] = isSoundOn(s.id);
    tone[s.id] = getToneOverride(s.id);
  }
  return { on, tone, pack: getPack(), volume: getVolume(), ignoreSilent: getIgnoreSilent() };
}

/* ---------------- Síntesis ---------------- */

let lastTap: { at: number; gain: GainNode } | null = null;
let noiseBuffer: AudioBuffer | null = null;

/*
 * Contexto de audio y "despertarlo" al volver a la app.
 * Al salir de la app sin cerrarla, el teléfono pausa el audio: en iPhone el contexto queda "interrumpido" y a veces
 * no vuelve aunque se le pida; en Android queda en pausa. Antes solo se reanudaba si estaba en pausa, así que
 * después de volver no sonaba nada (la voz sí, porque usa otro motor). Ahora: al ocultarse la app se pausa, y en el
 * primer toque al volver se crea un contexto nuevo dentro de ese toque (el iPhone solo deja arrancar audio así).
 */
let ctx: AudioContext | null = null;
let needsFresh = false;
let wasHidden = false;
let audioRestarts = 0;
/** Estado del audio (solo para las pruebas automáticas). */
export function audioDebug(): { restarts: number; state: string | null } {
  return { restarts: audioRestarts, state: ctx ? (ctx.state as string) : null };
}

function makeCtx(): AudioContext | null {
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    applyAudioSession();
    return new AC();
  } catch {
    return null;
  }
}

function dropCtx(): void {
  const old = ctx;
  ctx = null;
  needsFresh = false;
  noiseBuffer = null;
  lastTap = null;
  if (old && (old.state as string) !== 'closed') void old.close().catch(() => undefined);
}

function audio(): AudioContext | null {
  if (ctx && (needsFresh || (ctx.state as string) === 'closed')) {
    dropCtx();
    audioRestarts++;
  }
  if (!ctx) ctx = makeCtx();
  return ctx;
}

/** Si al pedirle que siga el contexto no arranca en un momento, el próximo toque crea uno nuevo. */
function resumeOrRenew(ac: AudioContext, then?: (ac: AudioContext) => void): void {
  let settled = false;
  const ok = () => {
    if (settled) return;
    settled = true;
    if ((ac.state as string) === 'running') then?.(ac);
    else needsFresh = true;
  };
  try {
    void ac.resume().then(ok, () => {
      settled = true;
      needsFresh = true;
    });
  } catch {
    needsFresh = true;
    return;
  }
  setTimeout(() => {
    if (!settled && (ac.state as string) !== 'running') {
      settled = true;
      needsFresh = true;
    }
  }, 400);
}

/** Se llama en cada toque (antes del clic): despierta el audio si la app estuvo en segundo plano. */
function unlockAudio(): void {
  if (!ctx) return; // se crea con el primer sonido
  const st = ctx.state as string;
  if (st === 'running') {
    wasHidden = false;
    return;
  }
  if (wasHidden || st === 'interrupted') needsFresh = true;
  wasHidden = false;
  const ac = audio();
  if (ac && (ac.state as string) !== 'running') resumeOrRenew(ac);
}

interface Note {
  /** Frecuencia (Hz). En ruido, frecuencia del filtro. */
  f: number;
  /** Inicio (s). */
  t: number;
  /** Duración (s). */
  d: number;
  type?: OscillatorType | 'noise';
  /** Ganancia relativa. */
  g?: number;
  /** Frecuencia final (glissando). */
  slide?: number;
  /** Parciales extra: [múltiplo de la frecuencia, ganancia relativa]. */
  harm?: [number, number][];
  /** Filtro para el ruido. */
  filter?: BiquadFilterType;
  attack?: number;
}

/** Notas consecutivas (arpegio). */
function arp(freqs: number[], step: number, d: number, extra: Partial<Note> = {}, lastD = d): Note[] {
  return freqs.map((f, i) => ({ f, t: i * step, d: i === freqs.length - 1 ? lastD : d, ...extra }));
}
const bell: Partial<Note> = { type: 'sine', harm: [[2, 0.35], [3, 0.12]] };
const glass: Partial<Note> = { type: 'sine', harm: [[2.76, 0.18], [5.4, 0.06]] };
const marimba: Partial<Note> = { type: 'sine', harm: [[4, 0.22], [9.8, 0.05]], attack: 0.003 };
const bubble = (f: number, t: number, d = 0.08, g = 0.3): Note => ({ f, t, d, g, slide: f * 2.3, type: 'sine' });

export const RECIPES: Record<PackId, Record<SoundName, Note[]>> = {
  suave: {
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
    purchase: arp([523, 659, 784], 0.08, 0.08, { type: 'triangle', g: 0.3 }, 0.14),
    error: [
      { f: 330, t: 0, d: 0.12, type: 'sawtooth', g: 0.12 },
      { f: 247, t: 0.12, d: 0.18, type: 'sawtooth', g: 0.12 },
    ],
    achievement: arp([523, 659, 784, 1046], 0.09, 0.1, { type: 'sine', g: 0.28 }, 0.28),
  },
  caja: {
    tap: [{ f: 3200, t: 0, d: 0.025, type: 'noise', filter: 'highpass', g: 0.35 }],
    nav: [
      { f: 2600, t: 0, d: 0.022, type: 'noise', filter: 'highpass', g: 0.3 },
      { f: 2600, t: 0.06, d: 0.022, type: 'noise', filter: 'highpass', g: 0.3 },
    ],
    open: [
      { f: 1100, t: 0, d: 0.16, type: 'noise', filter: 'bandpass', g: 0.35 },
      { f: 3000, t: 0.15, d: 0.03, type: 'noise', filter: 'highpass', g: 0.3 },
    ],
    success: [{ f: 2093, t: 0, d: 0.5, g: 0.22, ...bell }],
    sale: [
      { f: 4200, t: 0, d: 0.08, type: 'noise', filter: 'highpass', g: 0.32 },
      { f: 1568, t: 0.06, d: 0.32, g: 0.2, ...bell },
      { f: 2637, t: 0.15, d: 0.7, g: 0.22, ...bell },
    ],
    purchase: [
      { f: 3200, t: 0, d: 0.08, g: 0.16, type: 'sine', harm: [[1.5, 0.3]] },
      { f: 2800, t: 0.07, d: 0.08, g: 0.16, type: 'sine', harm: [[1.5, 0.3]] },
      { f: 3500, t: 0.13, d: 0.08, g: 0.16, type: 'sine', harm: [[1.5, 0.3]] },
      { f: 3000, t: 0.2, d: 0.12, g: 0.16, type: 'sine', harm: [[1.5, 0.3]] },
    ],
    error: [
      { f: 150, t: 0, d: 0.3, type: 'square', g: 0.12 },
      { f: 156, t: 0, d: 0.3, type: 'square', g: 0.1 },
    ],
    achievement: arp([1568, 2093, 2637, 3136], 0.1, 0.4, { g: 0.2, ...bell }, 0.7),
  },
  burbujas: {
    tap: [bubble(500, 0, 0.06)],
    nav: [bubble(420, 0, 0.07), bubble(620, 0.07, 0.07)],
    open: [bubble(320, 0, 0.12), bubble(520, 0.08, 0.1)],
    success: [bubble(600, 0, 0.09), bubble(820, 0.1, 0.12)],
    sale: [bubble(500, 0, 0.1), bubble(700, 0.08, 0.1), bubble(950, 0.16, 0.14)],
    purchase: [bubble(400, 0, 0.1), bubble(560, 0.09, 0.12)],
    error: [{ f: 900, t: 0, d: 0.22, type: 'sine', g: 0.3, slide: 260 }],
    achievement: [bubble(500, 0, 0.1), bubble(650, 0.08, 0.1), bubble(800, 0.16, 0.1), bubble(1000, 0.24, 0.16), { f: 3500, t: 0.32, d: 0.25, g: 0.1, ...glass }],
  },
  retro: {
    tap: [{ f: 1200, t: 0, d: 0.03, type: 'square', g: 0.1 }],
    nav: arp([660, 990], 0.05, 0.05, { type: 'square', g: 0.1 }, 0.06),
    open: arp([440, 660, 880], 0.04, 0.05, { type: 'square', g: 0.1 }),
    success: [
      { f: 988, t: 0, d: 0.07, type: 'square', g: 0.1 },
      { f: 1319, t: 0.07, d: 0.18, type: 'square', g: 0.1 },
    ],
    sale: arp([523, 659, 784, 1047, 1319], 0.05, 0.07, { type: 'square', g: 0.09 }, 0.2),
    purchase: arp([392, 523, 659], 0.06, 0.08, { type: 'square', g: 0.1 }, 0.12),
    error: [{ f: 220, t: 0, d: 0.3, type: 'square', g: 0.1, slide: 110 }],
    achievement: arp([659, 784, 1047, 1319, 1568], 0.08, 0.08, { type: 'square', g: 0.09 }, 0.32),
  },
  cristal: {
    tap: [{ f: 3000, t: 0, d: 0.05, g: 0.14, ...glass }],
    nav: [
      { f: 2349, t: 0, d: 0.12, g: 0.14, ...glass },
      { f: 3136, t: 0.06, d: 0.15, g: 0.14, ...glass },
    ],
    open: [{ f: 1760, t: 0, d: 0.15, type: 'triangle', g: 0.14, slide: 2349 }],
    success: [
      { f: 1760, t: 0, d: 0.4, g: 0.18, ...glass },
      { f: 2637, t: 0.08, d: 0.5, g: 0.18, ...glass },
    ],
    sale: arp([2093, 2637, 3136, 4186], 0.05, 0.35, { g: 0.15, ...glass }, 0.6),
    purchase: arp([1568, 2093], 0.08, 0.4, { g: 0.17, ...glass }),
    error: [
      { f: 880, t: 0, d: 0.25, type: 'sine', g: 0.16 },
      { f: 831, t: 0, d: 0.25, type: 'sine', g: 0.16 },
    ],
    achievement: arp([2093, 2637, 3136, 4186, 5274], 0.07, 0.5, { g: 0.14, ...glass }, 0.8),
  },
  madera: {
    tap: [
      { f: 900, t: 0, d: 0.04, type: 'triangle', g: 0.3, attack: 0.002 },
      { f: 2000, t: 0, d: 0.015, type: 'noise', filter: 'bandpass', g: 0.15 },
    ],
    nav: arp([587, 784], 0.07, 0.18, { g: 0.3, ...marimba }, 0.22),
    open: arp([440, 659], 0.06, 0.2, { g: 0.3, ...marimba }),
    success: arp([784, 1047], 0.09, 0.25, { g: 0.3, ...marimba }, 0.35),
    sale: arp([523, 659, 784, 1047], 0.07, 0.3, { g: 0.28, ...marimba }, 0.45),
    purchase: arp([392, 523, 659], 0.08, 0.28, { g: 0.3, ...marimba }),
    error: arp([330, 247], 0.12, 0.25, { g: 0.32, ...marimba }, 0.35),
    achievement: arp([523, 659, 784, 1047, 1319], 0.08, 0.4, { g: 0.26, ...marimba }, 0.6),
  },
};

/** Últimos sonidos (solo nombres), para las pruebas automáticas. No guarda datos del negocio. */
export const recentSounds: string[] = [];


function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.8), ac.sampleRate);
  const data = b.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = b;
  return b;
}

function schedule(ac: AudioContext, master: GainNode, n: Note, now: number) {
  const start = now + n.t;
  const end = start + n.d;
  const atk = n.attack ?? 0.008;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(n.g ?? 0.25, start + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(master);
  if (n.type === 'noise') {
    const src = ac.createBufferSource();
    src.buffer = noise(ac);
    const f = ac.createBiquadFilter();
    f.type = n.filter ?? 'highpass';
    f.frequency.setValueAtTime(n.f, start);
    f.Q.value = n.filter === 'bandpass' ? 2 : 0.7;
    src.connect(f).connect(g);
    src.start(start);
    src.stop(end + 0.02);
    return;
  }
  const partials: [number, number][] = [[1, 1], ...(n.harm ?? [])];
  for (const [mult, rel] of partials) {
    const o = ac.createOscillator();
    o.type = (n.type as OscillatorType) ?? 'sine';
    o.frequency.setValueAtTime(n.f * mult, start);
    if (n.slide) o.frequency.exponentialRampToValueAtTime(n.slide * mult, end);
    if (rel === 1) o.connect(g);
    else {
      const pg = ac.createGain();
      pg.gain.value = rel;
      o.connect(pg).connect(g);
    }
    o.start(start);
    o.stop(end + 0.02);
  }
}

/** Reproduce un sonido con su tono (o con el paquete indicado, para "probar"). */
export function playSound(name: SoundName, opts: { pack?: PackId; force?: boolean } = {}): void {
  if (!opts.force && !isSoundOn(name)) return;
  const vol = getVolume();
  const pack = opts.pack ?? toneFor(name);
  recentSounds.push(pack === 'suave' ? name : `${name}:${pack}`);
  if (recentSounds.length > 30) recentSounds.shift();
  if (vol <= 0) return;
  const ac = audio();
  if (!ac) return;
  if ((ac.state as string) === 'running') render(ac, name, pack, vol);
  // En pausa (o interrumpido): suena apenas arranque; si no arranca, el próximo toque crea un audio nuevo
  else resumeOrRenew(ac, (a) => render(a, name, pack, vol));
}

function render(ac: AudioContext, name: SoundName, pack: PackId, vol: number): void {
  try {
    const now = ac.currentTime + 0.005;
    // Un sonido "de resultado" justo después de un toque reemplaza el clic (no se enciman)
    if (name !== 'tap' && lastTap && performance.now() - lastTap.at < 80) {
      lastTap.gain.gain.cancelScheduledValues(now);
      lastTap.gain.gain.setValueAtTime(0, now);
    }
    const master = ac.createGain();
    master.gain.value = vol * 0.5;
    master.connect(ac.destination);
    for (const n of RECIPES[pack][name]) schedule(ac, master, n, now);
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
/** Clic en botones y enlaces; sonido de navegación en la barra de secciones. */
export function installSoundHandlers(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  applyAudioSession();
  // Al salir de la app se pausa el audio; al volver, el primer toque lo despierta (o crea uno nuevo)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true;
      if (ctx && (ctx.state as string) === 'running') void ctx.suspend().catch(() => undefined);
    } else applyAudioSession();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) wasHidden = true;
  });
  for (const type of ['touchend', 'pointerup', 'keydown'] as const) document.addEventListener(type, unlockAudio, { capture: true, passive: true });
  document.addEventListener(
    'click',
    (e) => {
      unlockAudio();
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
