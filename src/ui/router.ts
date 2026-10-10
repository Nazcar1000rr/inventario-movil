import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = decodeURI(location.hash.replace(/^#/, '')) || '/';
  const [path, qs] = h.split('?');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return { path: clean, segments: clean.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

let depth = 0;
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => listeners.forEach((l) => l()));
window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1);
});

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const l = () => {
      setR(parse());
      window.scrollTo(0, 0);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return r;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = `#${to}`;
  if (location.hash === target) return;
  if (opts.replace) {
    history.replaceState(null, '', target);
    listeners.forEach((l) => l());
  } else {
    depth++;
    location.hash = to;
  }
}

/** Vuelve atrás dentro de la app; si no hay historial propio, va a `fallback`. */
export function goBack(fallback = '/'): void {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function canGoBack(): boolean {
  return depth > 0;
}

export function currentPath(): string {
  return parse().path;
}
