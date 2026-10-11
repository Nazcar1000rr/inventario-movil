import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { applyAudioSession } from './sound';
import { speechChunks, speechText } from './speech-text';

/**
 * LECTURA EN VOZ ALTA (v2.2).
 * - iPhone y navegador: Web Speech API (voces del propio teléfono).
 * - App de Android: motor de voz de Android (el navegador interno no trae voz), con el plugin de Capacitor.
 * Solo se usan voces en español que funcionan en el teléfono (sin conexión): nunca voces "en línea".
 * La app no envía el texto a ningún servidor. Preferencias en el almacenamiento local de este teléfono.
 */

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  /** Android: posición de la voz en la lista del motor. */
  index?: number;
}

const native = Capacitor.isNativePlatform();
const listeners = new Set<() => void>();
let version = 0;
let speaking = false;
let token = 0;
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
    /* sin almacenamiento local */
  }
}

export function isMuted(): boolean {
  return read('voice:muted') === '1';
}
export function setMuted(m: boolean): void {
  write('voice:muted', m ? '1' : '0');
  if (m) stopSpeaking();
  emit();
}
export function getRate(): number {
  const r = Number.parseFloat(read('voice:rate') ?? '');
  return Number.isFinite(r) ? Math.max(0.6, Math.min(1.6, r)) : 1;
}
export function setRate(r: number): void {
  write('voice:rate', String(Math.max(0.6, Math.min(1.6, r))));
  emit();
}
export function getVoiceId(): string {
  return read('voice:id') ?? '';
}
export function setVoiceId(id: string): void {
  write('voice:id', id);
  emit();
}

/* ---------------- Voces ---------------- */

let voicesCache: VoiceOption[] | null = null;

function webSynth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

const PREFERRED = ['es-co', 'es-mx', 'es-us', 'es-419', 'es-es', 'es'];
function langRank(lang: string): number {
  const l = lang.toLowerCase().replace('_', '-');
  const i = PREFERRED.findIndex((p) => l === p || l.startsWith(p + '-'));
  return i < 0 ? PREFERRED.length : i;
}

/** Voces en español disponibles en el teléfono (solo locales, sin conexión). */
export async function listVoices(): Promise<VoiceOption[]> {
  if (voicesCache && voicesCache.length) return voicesCache;
  let list: VoiceOption[] = [];
  if (native) {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      list = voices
        .map((v, index) => ({ v, index }))
        .filter(({ v }) => v.lang.toLowerCase().startsWith('es') && v.localService !== false)
        .map(({ v, index }) => ({ id: v.voiceURI, name: v.name, lang: v.lang, index }));
    } catch {
      list = [];
    }
  } else {
    const s = webSynth();
    if (s) {
      let vs = s.getVoices();
      if (!vs.length) {
        await new Promise<void>((res) => {
          const done = () => res();
          s.addEventListener?.('voiceschanged', done, { once: true });
          setTimeout(done, 1200);
        });
        vs = s.getVoices();
      }
      list = vs
        .filter((v) => v.lang.toLowerCase().startsWith('es') && v.localService)
        .map((v) => ({ id: v.voiceURI || v.name, name: v.name, lang: v.lang }));
    }
  }
  list.sort((a, b) => langRank(a.lang) - langRank(b.lang) || a.name.localeCompare(b.name));
  voicesCache = list;
  emit();
  return list;
}

function chosenVoice(list: VoiceOption[]): VoiceOption | null {
  const id = getVoiceId();
  return list.find((v) => v.id === id) ?? list[0] ?? null;
}

/** ¿Se puede leer en voz alta en este teléfono? (null = todavía no se sabe) */
let supportedFlag: boolean | null = null;
export async function checkSpeechSupport(): Promise<boolean> {
  if (supportedFlag !== null) return supportedFlag;
  if (!native && !webSynth()) supportedFlag = false;
  else supportedFlag = (await listVoices()).length > 0;
  emit();
  return supportedFlag;
}

/* ---------------- Hablar ---------------- */

export function stopSpeaking(): void {
  token++;
  if (native) void TextToSpeech.stop().catch(() => undefined);
  else webSynth()?.cancel();
  if (speaking) {
    speaking = false;
    emit();
  }
}

/** Identificador de la lectura actual (para no cortar una lectura que empezó otro). */
export function currentSpeech(): number {
  return token;
}

/**
 * Lee un texto (si la voz no está silenciada, o siempre con `force`). Corta lo que se estuviera leyendo.
 * Devuelve el identificador de esta lectura (0 si no se leyó).
 */
export function speak(text: string, opts: { force?: boolean } = {}): number {
  if (!text.trim()) return 0;
  if (isMuted() && !opts.force) return 0;
  stopSpeaking();
  const my = ++token;
  void run(text, my);
  return my;
}

async function run(text: string, my: number): Promise<void> {
  const list = await listVoices();
  if (my !== token) return;
  const voice = chosenVoice(list);
  if (!voice && !native) return;
  const chunks = speechChunks(speechText(text));
  const rate = getRate();
  applyAudioSession();
  speaking = true;
  emit();
  const finish = () => {
    if (my === token && speaking) {
      speaking = false;
      emit();
    }
  };
  if (native) {
    try {
      for (const c of chunks) {
        if (my !== token) return;
        await TextToSpeech.speak({ text: c, lang: voice?.lang ?? 'es-CO', rate, voice: voice?.index ?? -1 });
      }
    } catch {
      /* sin motor de voz: se ignora */
    }
    finish();
    return;
  }
  const s = webSynth();
  if (!s || !voice) return finish();
  const v = s.getVoices().find((x) => (x.voiceURI || x.name) === voice.id) ?? null;
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = voice.lang;
    if (v) u.voice = v;
    u.rate = rate;
    if (i === chunks.length - 1) {
      u.onend = finish;
      u.onerror = finish;
    }
    s.speak(u);
  });
}

/** iPhone exige que la primera lectura empiece con un toque: se "desbloquea" con el primer toque en la app. */
let unlocked = false;
export function installSpeechUnlock(): void {
  if (native || typeof document === 'undefined') return;
  const s = webSynth();
  if (!s) return;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    } catch {
      /* sin voz */
    }
    document.removeEventListener('click', unlock, true);
    document.removeEventListener('touchend', unlock, true);
  };
  document.addEventListener('click', unlock, true);
  document.addEventListener('touchend', unlock, true);
  void checkSpeechSupport();
}

export function useSpeech(): { muted: boolean; speaking: boolean; supported: boolean | null; voices: VoiceOption[] | null; rate: number; voiceId: string } {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return { muted: isMuted(), speaking, supported: supportedFlag, voices: voicesCache, rate: getRate(), voiceId: getVoiceId() };
}

/**
 * Lee `text` automáticamente cuando aparece (o cambia) y deja de leer al cerrarse.
 * `enabled` permite esperar a que el contenido esté listo.
 */
export function useAutoSpeak(text: string | null | undefined, enabled = true): void {
  useEffect(() => {
    if (!enabled || !text) return;
    let mine = 0;
    const t = setTimeout(() => {
      mine = speak(text);
    }, 120);
    return () => {
      clearTimeout(t);
      if (mine && mine === currentSpeech()) stopSpeaking();
    };
  }, [text, enabled]);
}

/** Android: abre la instalación de datos de voz del sistema. */
export function openVoiceInstall(): void {
  if (native) void TextToSpeech.openInstall().catch(() => undefined);
}

export function isNativeVoice(): boolean {
  return native;
}

/** Vuelve a buscar las voces (por ejemplo, después de instalar una). */
export async function refreshVoices(): Promise<VoiceOption[]> {
  voicesCache = null;
  supportedFlag = null;
  const list = await listVoices();
  supportedFlag = list.length > 0;
  emit();
  return list;
}
