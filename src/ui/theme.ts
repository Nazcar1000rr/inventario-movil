import { useSyncExternalStore } from 'react';

/**
 * APARIENCIA (v2.2): modo claro/oscuro/automático, color principal, estilo sólido o con degradados y animaciones
 * (completas o modo lite). Se guarda solo en este teléfono y se aplica como atributos en <html>
 * (data-theme, data-accent, data-style, data-motion). index.html aplica lo mismo antes de pintar, sin parpadeo.
 */

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Accent = 'verde' | 'azul' | 'morado' | 'coral' | 'rosado' | 'grafito';
export type ColorStyle = 'solid' | 'gradient';
export type Motion = 'full' | 'lite';

export const ACCENTS: { id: Accent; label: string; light: string; dark: string }[] = [
  { id: 'verde', label: 'Verde', light: '#0d6b58', dark: '#45b99d' },
  { id: 'azul', label: 'Azul', light: '#1d5fbf', dark: '#6ea1f0' },
  { id: 'morado', label: 'Morado', light: '#6b3fc2', dark: '#a98bee' },
  { id: 'coral', label: 'Coral', light: '#c2462b', dark: '#f08c6e' },
  { id: 'rosado', label: 'Rosado', light: '#bf2f6c', dark: '#f07aaa' },
  { id: 'grafito', label: 'Grafito', light: '#2b3139', dark: '#d5dae1' },
];

export interface Appearance {
  mode: ThemeMode;
  accent: Accent;
  style: ColorStyle;
  motion: Motion;
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
    /* sin almacenamiento local: solo dura esta sesión */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function getAppearance(): Appearance {
  const mode = read('ui:mode');
  const accent = read('ui:accent');
  const style = read('ui:style');
  const motion = read('ui:motion');
  return {
    mode: mode === 'light' || mode === 'dark' ? mode : 'auto',
    accent: ACCENTS.some((a) => a.id === accent) ? (accent as Accent) : 'verde',
    style: style === 'gradient' ? 'gradient' : 'solid',
    // Sin elección guardada, se respeta "reducir movimiento" del teléfono
    motion: motion === 'lite' || motion === 'full' ? motion : prefersReducedMotion() ? 'lite' : 'full',
  };
}

const listeners = new Set<() => void>();
let version = 0;

export function setAppearance(patch: Partial<Appearance>): void {
  const next = { ...getAppearance(), ...patch };
  write('ui:mode', next.mode);
  write('ui:accent', next.accent);
  write('ui:style', next.style);
  if (patch.motion) write('ui:motion', patch.motion);
  applyAppearance();
  version++;
  listeners.forEach((l) => l());
}

export function isDark(a: Appearance = getAppearance()): boolean {
  if (a.mode === 'dark') return true;
  if (a.mode === 'light') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Aplica la apariencia a <html> y al color de la barra del sistema. */
export function applyAppearance(): void {
  const a = getAppearance();
  const root = document.documentElement;
  if (a.mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a.mode);
  root.setAttribute('data-accent', a.accent);
  root.setAttribute('data-style', a.style);
  root.setAttribute('data-motion', a.motion);
  // Barra de estado / del navegador: el color del encabezado
  const css = getComputedStyle(root);
  const color = (a.style === 'gradient' ? css.getPropertyValue('--hero-a') : isDark(a) ? css.getPropertyValue('--surface') : css.getPropertyValue('--primary')).trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  if (color) {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = color;
    document.head.appendChild(m);
  }
}

let watching = false;
/** Al cambiar el modo del teléfono (automático), se actualiza el color de la barra. */
export function watchSystemTheme(): void {
  if (watching) return;
  watching = true;
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance());
  } catch {
    /* navegadores antiguos: sin escucha */
  }
}

export function useAppearance(): Appearance {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return getAppearance();
}

export function motionEnabled(): boolean {
  return getAppearance().motion === 'full';
}

/** Confeti breve para celebrar un logro (no se muestra en modo lite). */
export function celebrate(): void {
  if (!motionEnabled() || typeof document === 'undefined') return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const colors = ['var(--primary)', '#f2c14e', 'var(--success)', 'var(--info)', '#ef8a63'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.round(Math.random() * 100)}%`;
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.round(Math.random() * 250)}ms`;
    s.style.animationDuration = `${900 + Math.round(Math.random() * 700)}ms`;
    s.style.setProperty('--dx', `${Math.round(Math.random() * 160 - 80)}px`);
    s.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2000);
}
