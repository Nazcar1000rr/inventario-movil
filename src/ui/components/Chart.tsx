import { formatCOP } from '../../core';

/** Pesos en formato corto para ejes: 1.250.000 → "$1,3 M"; 85.000 → "$85 mil". */
export function compactCOP(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('es-CO', { maximumFractionDigits: 1 });
  if (a >= 1e9) return `${sign}$${fmt(a / 1e9)} mil M`;
  if (a >= 1e6) return `${sign}$${fmt(a / 1e6)} M`;
  if (a >= 1e3) return `${sign}$${fmt(a / 1e3)} mil`;
  return `${sign}$${Math.round(a)}`;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(Math.round(out[out.length - 1] + step));
  return out;
}

export interface Series {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
}

/** Gráfica de líneas simple (SVG, sin dependencias). Accesible: incluye una tabla oculta con los datos. */
export function LineChart({ labels, series, height = 200, title }: { labels: string[]; series: Series[]; height?: number; title: string }) {
  const W = 640;
  const H = height;
  const padL = 64;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const all = series.flatMap((s) => s.values);
  if (!labels.length || !all.length) return null;
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (i: number) => padL + (labels.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (labels.length - 1));
  const y = (v: number) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);
  const every = Math.ceil(labels.length / 6);
  return (
    <figure className="chart" aria-label={title}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">
              {compactCOP(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" className="chart-axis">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '6 5' : undefined}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} /> {s.name}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Mes</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <td>{l}</td>
              {series.map((s) => (
                <td key={s.name}>{formatCOP(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Barras positivas/negativas (por ejemplo, crecimiento de cada mes). */
export function BarChart({ labels, values, height = 150, title }: { labels: string[]; values: number[]; height?: number; title: string }) {
  const W = 640;
  const H = height;
  const padL = 64;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  if (!values.length) return null;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);
  const slot = (W - padL - padR) / values.length;
  const bw = Math.min(36, slot * 0.6);
  const every = Math.ceil(labels.length / 6);
  return (
    <figure className="chart" aria-label={title}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-zero' : 'chart-grid'} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">
              {compactCOP(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = padL + slot * i + slot / 2;
          const top = y(Math.max(0, v));
          const h = Math.max(1, Math.abs(y(v) - y(0)));
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={top} width={bw} height={h} rx={3} className={v >= 0 ? 'chart-bar-pos' : 'chart-bar-neg'} />
              {i % every === 0 || i === values.length - 1 ? (
                <text x={cx} y={H - 8} textAnchor="middle" className="chart-axis">
                  {labels[i]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <td>{l}</td>
              <td>{formatCOP(values[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Barra de progreso (0..1). */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <span style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
