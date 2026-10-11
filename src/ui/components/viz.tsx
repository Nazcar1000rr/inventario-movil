import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatCOP, formatInt } from '../../core';
import { compactCOP } from './Chart';

/**
 * GRÁFICAS DEL ANÁLISIS (v2.3) — SVG/HTML sin dependencias.
 * Reglas: barras delgadas (≤ 24 px) con la punta redondeada y la base recta, líneas de 2 px, cuadrícula fina y
 * suave, etiquetas solo en el extremo o el último valor, y siempre una tabla con los números ("Ver los números").
 * Colores por función (variables --viz-*): una sola serie = azul; positivo/negativo = azul/rojo; énfasis = azul y
 * el resto gris; estado (salud) = verde/amarillo/naranja/rojo siempre con icono y texto. El texto nunca va del
 * color de la serie. Las animaciones respetan el modo lite y "reducir movimiento".
 */

export type Fmt = 'money' | 'int' | 'days' | 'pct' | 'num';

/** "1 venta", "3 ventas". */
export function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

export function fmt(v: number | null | undefined, f: Fmt): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  switch (f) {
    case 'money':
      return formatCOP(Math.round(v));
    case 'int':
      return formatInt(Math.round(v));
    case 'days':
      return `${(Math.round(v * 10) / 10).toLocaleString('es-CO')} ${Math.abs(v) === 1 ? 'día' : 'días'}`;
    case 'pct':
      return `${Math.round(v * 100)} %`;
    case 'num':
      return (Math.round(v * 10) / 10).toLocaleString('es-CO');
  }
}

function axisFmt(v: number, f: Fmt): string {
  if (f === 'money') return compactCOP(v);
  if (f === 'pct') return `${Math.round(v * 100)} %`;
  return formatInt(Math.round(v));
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (max === 0) max = 1;
    else {
      const pad = Math.abs(max) * 0.1;
      min = Math.min(0, min - pad);
      max += pad;
    }
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Ancho real del contenedor (para que el texto de la gráfica tenga su tamaño normal en cualquier pantalla). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(220, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Barra vertical con la punta redondeada (4 px) y la base recta. */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const up = y1 <= y0;
  const h = Math.abs(y0 - y1);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return `M${x},${y0}h${w}v-0.5h${-w}z`;
  if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/* ======================= Contenedor, tooltip y tabla ======================= */

export interface TableCol<T> {
  label: string;
  value: (row: T) => ReactNode;
  num?: boolean;
}

/** La tabla con los números exactos de una gráfica (siempre disponible). */
export function NumbersTable<T>({ caption, rows, cols, open = false, testId }: { caption: string; rows: T[]; cols: TableCol<T>[]; open?: boolean; testId?: string }) {
  return (
    <details className="viz-table" open={open} data-testid={testId}>
      <summary>Ver los números</summary>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.label} className={c.num ? 'num' : undefined} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c, k) =>
                  k === 0 ? (
                    <th key={c.label} scope="row">
                      {c.value(r)}
                    </th>
                  ) : (
                    <td key={c.label} className={c.num ? 'num' : undefined}>
                      {c.value(r)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
  extra?: string;
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.max(70, Math.min(width - 70, tip.x));
  return (
    <div className="viz-tip" role="status" style={{ left, top: tip.y }}>
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
      {tip.extra ? <span>{tip.extra}</span> : null}
    </div>
  );
}

/** Cierra el tooltip al tocar fuera de la gráfica. */
function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const on = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', on);
    return () => document.removeEventListener('pointerdown', on);
  }, [ref, close, active]);
}

/* ======================= Columnas ======================= */

export interface ColumnDatum {
  label: string;
  short: string;
  value: number | null;
  /** Barra resaltada (modo énfasis) o periodo en curso (se ve más clara). */
  emphasis?: boolean;
  partial?: boolean;
  /** Meta del periodo: se dibuja como una raya horizontal. */
  target?: number | null;
}

/**
 * Columnas de una sola serie (con valores negativos si los hay). Toca o pasa el dedo por una barra para ver su valor.
 * `mode="emphasis"`: las barras marcadas van en azul y el resto en gris.
 */
export function Columns({
  title,
  data,
  format,
  height = 190,
  mode = 'single',
  targetLabel,
  valueLabel,
  testId,
}: {
  title: string;
  data: ColumnDatum[];
  format: Fmt;
  height?: number;
  mode?: 'single' | 'emphasis';
  targetLabel?: string;
  valueLabel?: string;
  testId?: string;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<(Tip & { i: number }) | null>(null);
  useOutside(box, () => setTip(null), !!tip);
  const vals = data.flatMap((d) => [d.value ?? 0, d.target ?? 0]);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickW = Math.max(...ticks.map((t) => axisFmt(t, format).length)) * 7 + 10;
  const padL = Math.max(34, tickW);
  const padR = 8;
  const padT = 20;
  const padB = 24;
  const H = height;
  const plotW = W - padL - padR;
  const band = plotW / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(24, band * 0.62));
  const y = (v: number) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);
  const y0 = y(0);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const valid = data.map((d, i) => ({ d, i })).filter((x) => x.d.value !== null);
  const maxI = valid.length ? valid.reduce((a, b) => (Math.abs(b.d.value!) > Math.abs(a.d.value!) ? b : a)).i : -1;
  const lastI = valid.length ? valid[valid.length - 1].i : -1;
  const hasTarget = data.some((d) => d.target !== null && d.target !== undefined);
  const show = (i: number) => {
    const d = data[i];
    const cx = padL + band * i + band / 2;
    setTip({
      i,
      x: cx,
      y: Math.min(y(Math.max(d.value ?? 0, d.target ?? 0, 0)), y0) - 8,
      value: fmt(d.value, format),
      label: `${d.label}${d.partial ? ' (en curso)' : ''}`,
      extra: d.target !== null && d.target !== undefined ? `${targetLabel ?? 'Meta'}: ${fmt(d.target, format)}` : undefined,
    });
  };
  return (
    <figure className="viz" data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      <div ref={box} className="viz-box">
        <svg width={W} height={H} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">
                {axisFmt(t, format)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + band * i + (band - bw) / 2;
            const v = d.value ?? 0;
            const cls = mode === 'emphasis' ? (d.emphasis ? 'viz-fill-1' : 'viz-fill-muted') : v < 0 ? 'viz-fill-neg' : 'viz-fill-1';
            return (
              <g key={i}>
                {d.value !== null ? (
                  <path
                    d={barPath(x, bw, y0, y(v))}
                    className={`viz-bar ${cls}${d.partial ? ' viz-partial' : ''}${tip?.i === i ? ' viz-hover' : ''}`}
                    style={{ transformOrigin: v < 0 ? 'center top' : 'center bottom', animationDelay: `${Math.min(i * 35, 500)}ms` }}
                  />
                ) : null}
                {d.target !== null && d.target !== undefined ? <line x1={x - 4} x2={x + bw + 4} y1={y(d.target)} y2={y(d.target)} className="viz-target" /> : null}
                {(i === lastI || (i === maxI && (lastI - maxI > 1 || band >= 40))) && d.value !== null && d.value !== 0 && band >= 14 ? (
                  <text x={x + bw / 2} y={v >= 0 ? y(v) - 6 : y(v) + 14} textAnchor="middle" className="viz-label">
                    {format === 'money' ? compactCOP(v) : axisFmt(v, format)}
                  </text>
                ) : null}
                {(i % every === 0 && data.length - 1 - i >= every) || i === data.length - 1 ? (
                  <text x={padL + band * i + band / 2} y={H - 6} textAnchor="middle" className="viz-axis">
                    {d.short}
                  </text>
                ) : null}
                <rect
                  x={padL + band * i}
                  y={padT - 14}
                  width={band}
                  height={H - padT - padB + 14}
                  className="viz-hit"
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.label}: ${fmt(d.value, format)}${d.target !== null && d.target !== undefined ? `, ${targetLabel ?? 'meta'} ${fmt(d.target, format)}` : ''}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && show(i)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setTip(null)}
                  onClick={() => show(i)}
                  onFocus={() => show(i)}
                  onBlur={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} width={W} />
      </div>
      {hasTarget || mode === 'emphasis' ? (
        <div className="viz-legend">
          <span>
            <i className="key-rect viz-bg-1" /> {valueLabel ?? 'Valor'}
          </span>
          {mode === 'emphasis' ? (
            <span>
              <i className="key-rect viz-bg-muted" /> El resto
            </span>
          ) : null}
          {hasTarget ? (
            <span>
              <i className="key-line viz-bg-ink" /> {targetLabel ?? 'Meta'}
            </span>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}

/* ======================= Línea (con área suave) ======================= */

export function LineArea({ title, data, format, height = 180, testId }: { title: string; data: { label: string; short: string; value: number }[]; format: Fmt; height?: number; testId?: string }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [i, setI] = useState<number | null>(null);
  useOutside(box, () => setI(null), i !== null);
  if (!data.length) return null;
  const vals = data.map((d) => d.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const padL = Math.max(34, Math.max(...ticks.map((t) => axisFmt(t, format).length)) * 7 + 10);
  const padR = 14;
  const padT = 22;
  const padB = 24;
  const H = height;
  const x = (k: number) => padL + (data.length === 1 ? 0 : (k * (W - padL - padR)) / (data.length - 1));
  const y = (v: number) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);
  const pts = data.map((d, k) => `${x(k)},${y(d.value)}`).join(' ');
  const area = `M${x(0)},${y(Math.max(lo, 0))} L${pts.replace(/ /g, ' L')} L${x(data.length - 1)},${y(Math.max(lo, 0))} Z`;
  const every = Math.ceil(data.length / Math.max(1, Math.floor((W - padL) / 48)));
  const last = data.length - 1;
  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    for (let k = 1; k < data.length; k++) if (Math.abs(x(k) - px) < Math.abs(x(best) - px)) best = k;
    setI(best);
  };
  return (
    <figure className="viz" data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      <div ref={box} className="viz-box">
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={title}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setI(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">
                {axisFmt(t, format)}
              </text>
            </g>
          ))}
          <path d={area} className="viz-area" />
          <polyline points={pts} className="viz-line" />
          {data.map((d, k) =>
            (k % every === 0 && last - k >= every) || k === last ? (
              <text key={k} x={x(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === last ? 'end' : 'middle'} className="viz-axis">
                {d.short}
              </text>
            ) : null,
          )}
          <circle cx={x(last)} cy={y(data[last].value)} r={4.5} className="viz-dot" />
          <text x={x(last)} y={y(data[last].value) - 10} textAnchor="end" className="viz-label">
            {format === 'money' ? compactCOP(data[last].value) : axisFmt(data[last].value, format)}
          </text>
          {i !== null ? (
            <>
              <line x1={x(i)} x2={x(i)} y1={padT - 8} y2={H - padB} className="viz-cross" />
              <circle cx={x(i)} cy={y(data[i].value)} r={4.5} className="viz-dot" />
            </>
          ) : null}
        </svg>
        <Tooltip tip={i === null ? null : { x: x(i), y: y(data[i].value) - 12, value: fmt(data[i].value, format), label: data[i].label }} width={W} />
      </div>
    </figure>
  );
}

/* ======================= Barras horizontales ======================= */

export interface HBarDatum {
  key: string;
  label: ReactNode;
  value: number;
  /** Texto del valor (si no, se formatea). */
  text?: string;
  sub?: ReactNode;
  tone?: '1' | 'muted' | 'neg' | 'a' | 'b' | 'c';
}

/** Barras horizontales: el nombre arriba, la barra y el valor al final. Bueno para nombres largos en el teléfono. */
export function HBars({ data, format, max, testId }: { data: HBarDatum[]; format: Fmt; max?: number; testId?: string }) {
  const top = max ?? Math.max(0, ...data.map((d) => Math.abs(d.value)));
  return (
    <ul className="hbars" data-testid={testId}>
      {data.map((d, i) => (
        <li key={d.key}>
          <div className="hbar-head">
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-value">{d.text ?? fmt(d.value, format)}</span>
          </div>
          <div className="hbar-track" aria-hidden="true">
            <span className={`hbar-fill viz-bg-${d.tone ?? (d.value < 0 ? 'neg' : '1')}`} style={{ width: `${top > 0 && d.value !== 0 ? Math.max(1.5, (Math.abs(d.value) / top) * 100) : 0}%`, animationDelay: `${Math.min(i * 40, 400)}ms` }} />
          </div>
          {d.sub ? <div className="hbar-sub">{d.sub}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/* ======================= Cascada ======================= */

export interface WaterfallDatum {
  key: string;
  label: string;
  value: number;
  kind: 'start' | 'delta' | 'total';
}

/** Cascada horizontal: de dónde sale y a dónde va la plata, paso a paso. */
export function Waterfall({ title, steps, testId }: { title: string; steps: WaterfallDatum[]; testId?: string }) {
  let run = 0;
  const segs = steps.map((s) => {
    let a: number;
    let b: number;
    if (s.kind === 'delta') {
      a = run;
      b = run + s.value;
      run = b;
    } else {
      a = 0;
      b = s.value;
      run = s.value;
    }
    return { ...s, a, b };
  });
  const lo = Math.min(0, ...segs.map((s) => Math.min(s.a, s.b)));
  const hi = Math.max(0, ...segs.map((s) => Math.max(s.a, s.b)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <figure className="viz" data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="waterfall">
        {segs.map((s, i) => {
          const left = pos(Math.min(s.a, s.b));
          const width = Math.max(0.8, pos(Math.max(s.a, s.b)) - left);
          const tone = s.kind !== 'delta' ? 'total' : s.value >= 0 ? '1' : 'neg';
          return (
            <li key={s.key} className={s.kind !== 'delta' ? 'wf-total' : undefined}>
              <div className="hbar-head">
                <span className="hbar-label">{s.label}</span>
                <span className="hbar-value">{s.kind === 'delta' ? `${s.value >= 0 ? '+' : '−'}${formatCOP(Math.abs(s.value))}` : formatCOP(s.value)}</span>
              </div>
              <div className="wf-track" aria-hidden="true">
                {lo < 0 ? <i className="wf-zero" style={{ left: `${pos(0)}%` }} /> : null}
                <span
                  className={`wf-fill viz-bg-${tone}`}
                  style={{ left: `${left}%`, width: `${width}%`, transformOrigin: s.kind === 'delta' && s.value < 0 ? 'right center' : 'left center', animationDelay: `${i * 90}ms` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="viz-legend">
        <span>
          <i className="key-rect viz-bg-total" /> Total
        </span>
        <span>
          <i className="key-rect viz-bg-1" /> Suma
        </span>
        <span>
          <i className="key-rect viz-bg-neg" /> Resta
        </span>
      </div>
    </figure>
  );
}

/* ======================= Medidor y velocímetro ======================= */

/**
 * Medidor horizontal: lo logrado contra una meta. `marker` = una segunda referencia (p. ej. a dónde llegarías al ritmo actual).
 */
export function Meter({ value, label, tone = '1', marker, markerLabel, testId }: { value: number; label: string; tone?: '1' | 'good' | 'warn' | 'serious' | 'critical'; marker?: number | null; markerLabel?: string; testId?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const m = marker === null || marker === undefined ? null : Math.max(0, Math.min(1, marker));
  return (
    <div className="meter" data-testid={testId}>
      <div className="meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <span className={`meter-fill viz-bg-${tone}`} style={{ width: `${pct * 100}%` }} />
        {m !== null ? <i className="meter-marker" style={{ left: `${m * 100}%` }} title={markerLabel} /> : null}
      </div>
    </div>
  );
}

export type HealthTone = 'good' | 'warn' | 'serious' | 'critical';

export function healthTone(score: number): HealthTone {
  return score >= 80 ? 'good' : score >= 60 ? 'warn' : score >= 40 ? 'serious' : 'critical';
}

const TONE_ICON: Record<HealthTone, string> = { good: '✓', warn: '●', serious: '!', critical: '⚠' };

/** Velocímetro de 0 a 100 (salud del negocio). El color va con un icono y un texto: nunca solo el color. */
export function Gauge({ score, label, testId }: { score: number; label: string; testId?: string }) {
  const tone = healthTone(score);
  const r = 80;
  const len = Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const arc = `M20,100 A${r},${r} 0 0 1 180,100`;
  return (
    <figure className="gauge" data-testid={testId}>
      <svg viewBox="0 0 200 112" width="220" height="123" role="img" aria-label={`Salud del negocio: ${score} de 100, ${label}`}>
        <path d={arc} className="gauge-track" />
        <path d={arc} className={`gauge-fill viz-stroke-${tone}`} style={{ strokeDasharray: len, strokeDashoffset: len * (1 - pct), ['--gauge-len' as string]: `${len}` }} />
      </svg>
      <div className="gauge-center">
        <span className="gauge-value">{score}</span>
        <span className="gauge-of">de 100</span>
      </div>
      <figcaption className={`gauge-label tone-${tone}`}>
        <span aria-hidden="true">{TONE_ICON[tone]}</span> {label}
      </figcaption>
    </figure>
  );
}

function motionOff(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.getAttribute('data-motion') === 'lite' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Cifra grande que cuenta hasta su valor (sin animación en modo lite o con "reducir movimiento"). */
export function CountUp({ value, format, className }: { value: number; format: Fmt; className?: string }) {
  const [shown, setShown] = useState(() => (motionOff() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (motionOff() || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    const dur = 650;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const v = start + (value - start) * (1 - (1 - k) ** 3);
      setShown(k === 1 ? value : v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{fmt(shown, format)}</span>;
}
