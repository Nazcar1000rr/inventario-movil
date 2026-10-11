import { useState } from 'react';
import {
  formatCOP,
  formatDate,
  getBusinessAnalysis,
  getInquiryOverview,
  PRICE_SOURCE_LABEL,
  resetExpectation,
  saveExpectation,
  type BusinessAnalysis,
  type CompareRow,
  type ExpectationStatus,
  type ID,
} from '../../core';
import { ScopeSelect, useScope } from '../components/common';
import { InfoTip } from '../components/help';
import { Icon } from '../components/Icon';
import { ListenButton } from '../components/speaker';
import { ask, Badge, Card, Chips, Empty, Field, FormError, IntInput, Loading, MoneyInput, Notice, Page, Segmented, Sheet } from '../components/ui';
import { Columns, CountUp, fmt, Gauge, healthTone, HBars, LineArea, Meter, NumbersTable, plural, Waterfall, type Fmt } from '../components/viz';
import { useRoute } from '../router';
import { db, useAction, useLive, usePref } from '../store';
import { InquiryAnalysis } from './Inquiries';

type Tab = 'resumen' | 'esperas' | 'metas' | 'tendencias' | 'productos' | 'tiempo' | 'flujo' | 'dias' | 'preguntones';

const TABS: [Tab, string][] = [
  ['resumen', 'Resumen'],
  ['esperas', 'Lo que esperas ganar'],
  ['metas', 'Expectativas'],
  ['tendencias', 'Tendencias'],
  ['productos', 'Productos'],
  ['tiempo', 'Tiempo de venta'],
  ['flujo', 'Flujo de dinero'],
  ['dias', 'Días y horas'],
  ['preguntones', 'Preguntones'],
];

const signed = (v: number, f: Fmt = 'money') => (v === 0 ? fmt(0, f) : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), f)}`);

export function AnalysisScreen() {
  const route = useRoute();
  const [saved, setSaved] = usePref('analysisTab', 'resumen');
  const tab = ((route.query.get('tab') as Tab) || (saved as Tab)) ?? 'resumen';
  const setTab = (t: Tab) => setSaved(t);
  const scope = useScope('analysisScope');
  const key = JSON.stringify(scope.inventoryIds);
  const data = useLive((d) => (scope.ready ? getBusinessAnalysis(d, scope.inventoryIds) : undefined), [key, scope.ready]);
  const current = TABS.some(([t]) => t === tab) ? tab : 'resumen';
  return (
    <Page title="Análisis del negocio" back="/mas" help="analysis">
      <div className="stack-sm" data-tour="analysis-filters">
        <ScopeSelect {...scope} />
        <Chips label="Sección del análisis" value={current} onChange={setTab} options={TABS} />
      </div>
      {!data ? (
        <Loading />
      ) : current === 'resumen' ? (
        <Summary a={data} goTo={setTab} />
      ) : current === 'esperas' ? (
        <Outlook a={data} />
      ) : current === 'metas' ? (
        <Expectations a={data} inventoryIds={scope.inventoryIds} />
      ) : current === 'tendencias' ? (
        <Trends a={data} />
      ) : current === 'productos' ? (
        <ProductsTab a={data} />
      ) : current === 'tiempo' ? (
        <SellTimeTab a={data} />
      ) : current === 'flujo' ? (
        <Flows a={data} />
      ) : current === 'dias' ? (
        <Days a={data} />
      ) : (
        <InquiriesTab inventoryIds={scope.inventoryIds} />
      )}
    </Page>
  );
}

function H({ children, k }: { children: React.ReactNode; k?: string }) {
  return (
    <h2 className="with-tip">
      {children}
      {k ? <InfoTip k={k} /> : null}
    </h2>
  );
}

/* ======================= Resumen ======================= */

function stateText(s: ExpectationStatus): { icon: string; text: string; kind: 'ok' | 'warn' | 'bad' | 'info' } {
  switch (s.state) {
    case 'met':
      return { icon: '✓', text: 'Cumplida', kind: 'ok' };
    case 'on_track':
      return { icon: '↗', text: 'Vas bien', kind: 'ok' };
    case 'behind':
      return { icon: '!', text: 'Vas por debajo', kind: 'warn' };
    case 'early':
      return { icon: '…', text: 'Todavía es pronto', kind: 'info' };
    case 'missed':
      return { icon: '✗', text: 'No se cumplió', kind: 'bad' };
    default:
      return { icon: '—', text: 'Sin expectativa', kind: 'info' };
  }
}

function meterTone(kind: 'ok' | 'warn' | 'bad' | 'info'): '1' | 'warn' | 'critical' {
  return kind === 'warn' ? 'warn' : kind === 'bad' ? 'critical' : '1';
}

function insights(a: BusinessAnalysis): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  const m = a.expectations.month;
  if (m.target && m.projected) out.push({ icon: '🎯', text: `Al ritmo actual terminarías el mes con ${formatCOP(m.metric === 'profit' ? m.projected.profit : m.projected.revenue)} de ${m.metric === 'profit' ? 'ganancia' : 'ventas'}; esperabas ${formatCOP(m.metric === 'profit' ? m.target.profit : m.target.revenue)}.` });
  if (a.outlook.profit > 0) out.push({ icon: '📦', text: `Si vendes todo lo que tienes a tus precios, ganarías ${formatCOP(a.outlook.profit)}.` });
  const star = a.abc.rows[0];
  if (star && star.profit > 0) out.push({ icon: '⭐', text: `Tu producto estrella es ${star.name}: deja el ${Math.round(star.share * 100)} % de tu ganancia de los últimos 90 días.` });
  if (a.sellTime.avgDays !== null) out.push({ icon: '⏱', text: `En promedio te demoras ${fmt(a.sellTime.avgDays, 'days')} en vender un producto.` });
  if (a.time.best) out.push({ icon: '📅', text: `El día que más vendes es el ${a.time.best.label.toLowerCase()}.` });
  if (a.breakEven.revenueNeeded) out.push({ icon: '⚖', text: a.breakEven.state === 'reached' ? 'Este mes ya cubriste tus gastos: desde aquí todo es ganancia.' : `Para cubrir tus gastos del mes necesitas vender ${formatCOP(a.breakEven.revenueNeeded)}; llevas ${formatCOP(a.breakEven.monthRevenue)}.` });
  if (a.abc.idle.length) out.push({ icon: '💤', text: `${a.abc.idle.length} producto(s) no se vendieron en 90 días: tienes ${formatCOP(a.abc.idle.reduce((x, i) => x + i.cost, 0))} quietos ahí.` });
  return out;
}

function Summary({ a, goTo }: { a: BusinessAnalysis; goTo: (t: Tab) => void }) {
  if (!a.hasSales)
    return (
      <Empty icon="chart" title="Todavía no hay ventas para analizar">
        <p className="small muted">Cuando registres ventas verás aquí la salud de tu negocio, lo que esperas ganar y mucho más.</p>
      </Empty>
    );
  const ins = insights(a);
  const m = a.expectations.month;
  const st = stateText(m);
  const goal = m.target ? (m.metric === 'profit' ? m.target.profit : m.target.revenue) : 0;
  const got = m.metric === 'profit' ? m.actual.profit : m.actual.revenue;
  const proj = m.projected ? (m.metric === 'profit' ? m.projected.profit : m.projected.revenue) : null;
  const speech = `Salud del negocio: ${a.health.score} de 100, ${a.health.label}. ${ins.map((i) => i.text).join(' ')}`;
  return (
    <>
      <Card tour="analysis-health" title={<H k="health">Salud del negocio</H>}>
        {a.health.score !== null ? (
          <>
            <Gauge score={a.health.score} label={a.health.label} testId="health-gauge" />
            <ul className="hbars" style={{ marginTop: 12 }} data-testid="health-parts">
              {a.health.parts.map((p) => (
                <li key={p.key}>
                  <div className="hbar-head">
                    <span className="hbar-label">
                      <strong>{p.label}</strong> · {p.value}
                    </span>
                    <span className="hbar-value">
                      {p.score}/{p.max}
                    </span>
                  </div>
                  <Meter value={p.score / p.max} label={p.label} tone={healthTone((p.score / p.max) * 100)} />
                  <div className="hbar-sub">{p.tip}</div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
      <Card title={<H k="expectation">Este mes</H>} action={<button className="btn sm" onClick={() => goTo('metas')}>Ver</button>}>
        <div className="stat-grid">
          <div className="kpi">
            <div className="kpi-label">Ganancia neta</div>
            <div className="kpi-value">
              <CountUp value={m.actual.profit} format="money" />
            </div>
            <div className="kpi-foot">
              {plural(m.actual.sales, 'venta', 'ventas')} · {plural(m.actual.units, 'unidad', 'unidades')}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Esperabas</div>
            <div className="kpi-value">{m.target ? formatCOP(m.target.profit) : '—'}</div>
            <div className="kpi-foot">
              <span aria-hidden="true">{st.icon}</span> {st.text}
            </div>
          </div>
        </div>
        {m.target && goal > 0 ? (
          <div style={{ marginTop: 10 }}>
            <Meter value={got / goal} marker={proj !== null ? proj / goal : null} label="Avance de la expectativa del mes" tone={meterTone(st.kind)} testId="month-meter" />
            <div className="viz-legend">
              <span>
                <i className={`key-rect viz-bg-${meterTone(st.kind)}`} /> Llevas {Math.round((got / goal) * 100)} %
              </span>
              {proj !== null ? (
                <span>
                  <i className="key-line viz-bg-ink" /> Al ritmo actual: {Math.round((proj / goal) * 100)} %
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
      <Card title="Lo más importante" action={<ListenButton text={speech} />}>
        <ul className="insights" data-testid="insights">
          {ins.map((i) => (
            <li key={i.text}>
              <span aria-hidden="true">{i.icon}</span>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="stat-grid">
        <button type="button" className="kpi kpi-btn" onClick={() => goTo('esperas')}>
          <div className="kpi-label">Ganancia esperada de lo que tienes</div>
          <div className="kpi-value">{formatCOP(a.outlook.profit)}</div>
          <div className="kpi-foot">Ver detalle →</div>
        </button>
        <button type="button" className="kpi kpi-btn" onClick={() => goTo('tiempo')}>
          <div className="kpi-label">Tiempo promedio para vender</div>
          <div className="kpi-value">{fmt(a.sellTime.avgDays, 'days')}</div>
          <div className="kpi-foot">Ver detalle →</div>
        </button>
      </div>
    </>
  );
}

/* ======================= Lo que esperas ganar ======================= */

function Outlook({ a }: { a: BusinessAnalysis }) {
  const o = a.outlook;
  const p = a.pace;
  const v = a.value;
  return (
    <>
      <Card tour="analysis-outlook" title={<H k="expectedStock">Si vendes todo lo que tienes</H>}>
        <p className="hero-figure" data-testid="expected-profit">
          <CountUp value={o.profit} format="money" />
        </p>
        <p className="small muted">de ganancia esperada, vendiendo a tus precios.</p>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <div className="kpi">
            <div className="kpi-label">Venderías</div>
            <div className="kpi-value">{formatCOP(o.revenue)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Te costó</div>
            <div className="kpi-value">{formatCOP(o.cost)}</div>
            <div className="kpi-foot">{o.qty} unidades</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Margen esperado</div>
            <div className="kpi-value">{fmt(o.margin, 'pct')}</div>
          </div>
        </div>
        {o.unpricedQty ? (
          <Notice kind="warn" title={`${o.unpricedQty} unidad(es) sin precio de venta`}>
            No suman a la ganancia esperada ({formatCOP(o.unpricedCost)} a costo). Ponles precio en la ficha del producto (toca «Cambiar» en Precio de venta).
          </Notice>
        ) : null}
        {o.unknownCostQty ? <p className="tiny muted">{o.unknownCostQty} unidad(es) tienen costo desconocido: su ganancia no se cuenta.</p> : null}
        {o.damaged.qty ? <p className="tiny muted">No se cuentan {o.damaged.qty} equipo(s) dañados ({formatCOP(o.damaged.cost)} a costo).</p> : null}
      </Card>
      {o.rows.length ? (
        <Card title="Por producto">
          <HBars
            format="money"
            testId="outlook-bars"
            data={o.rows.slice(0, 12).map((r) => ({
              key: r.productId,
              label: r.name,
              value: Math.max(0, r.profit),
              text: r.pricedQty ? formatCOP(r.profit) : 'Sin precio',
              tone: r.profit < 0 ? 'neg' : r.pricedQty ? '1' : 'muted',
              sub: `${r.qty} × ${r.price === null ? 'sin precio' : formatCOP(r.price)}${r.priceSource ? ` (${PRICE_SOURCE_LABEL[r.priceSource]})` : ''}`,
            }))}
          />
          <NumbersTable
            caption="Ganancia esperada por producto"
            rows={o.rows}
            cols={[
              { label: 'Producto', value: (r) => r.name },
              { label: 'Cant.', value: (r) => r.qty, num: true },
              { label: 'Costo', value: (r) => formatCOP(r.cost), num: true },
              { label: 'Precio c/u', value: (r) => (r.price === null ? '—' : formatCOP(r.price)), num: true },
              { label: 'Venderías', value: (r) => formatCOP(r.revenue), num: true },
              { label: 'Ganancia', value: (r) => formatCOP(r.profit), num: true },
              { label: 'Margen', value: (r) => fmt(r.margin, 'pct'), num: true },
            ]}
          />
        </Card>
      ) : null}
      <Card title={<H k="pace">Al ritmo de tus ventas</H>}>
        <p className="small muted">Según tus últimos {p.days} días.</p>
        <div className="stat-grid">
          <div className="kpi">
            <div className="kpi-label">Próximos 30 días</div>
            <div className="kpi-value">{formatCOP(p.next30.profit)}</div>
            <div className="kpi-foot">
              de ganancia · {formatCOP(p.next30.revenue)} en ventas · {p.next30.units} u.
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Terminarías el mes con</div>
            <div className="kpi-value">{formatCOP(p.monthEnd.profit)}</div>
            <div className="kpi-foot">
              Llevas {formatCOP(p.monthEnd.actualProfit)} · faltan {p.monthEnd.daysLeft} días
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Vendes todo en</div>
            <div className="kpi-value">{p.daysOfStock === null ? '—' : fmt(p.daysOfStock, 'days')}</div>
            <div className="kpi-foot">{p.sellOutDate ? `Hacia el ${formatDate(p.sellOutDate)}` : 'Sin ventas recientes'}</div>
          </div>
        </div>
      </Card>
      <Card title={<H k="valueProjection">Valor del negocio a futuro</H>}>
        <LineArea title="Valor del negocio proyectado" data={v.points.map((x) => ({ label: x.label, short: x.label, value: x.value }))} format="money" testId="value-projection" />
        <p className="small muted">Si sigues ganando {formatCOP(v.monthlyProfit)} al mes ({v.monthlyBasis}). Es una proyección, no una promesa.</p>
        <NumbersTable
          caption="Valor del negocio proyectado"
          rows={[{ label: 'Hoy', value: v.now }, { label: 'Si vendes todo lo que tienes', value: v.ifAllSold }, ...v.points.filter((_, i) => i === 3 || i === 6 || i === 12).map((x) => ({ label: `En ${x.label}`, value: x.value }))]}
          cols={[
            { label: 'Momento', value: (r) => r.label },
            { label: 'Valor', value: (r) => formatCOP(r.value), num: true },
          ]}
          open
        />
      </Card>
    </>
  );
}

/* ======================= Expectativas ======================= */

function ExpectationCard({ s, title, canEdit, onEdit }: { s: ExpectationStatus; title: string; canEdit: boolean; onEdit: () => void }) {
  const act = useAction();
  const st = stateText(s);
  const t = s.target;
  const goal = t ? (s.metric === 'profit' ? t.profit : t.revenue) : 0;
  const got = s.metric === 'profit' ? s.actual.profit : s.actual.revenue;
  const proj = s.projected ? (s.metric === 'profit' ? s.projected.profit : s.projected.revenue) : null;
  return (
    <Card
      tour={`analysis-exp-${s.kind}`}
      title={
        <h2 className="with-tip">
          {title} <InfoTip k="expectation" />
        </h2>
      }
      action={canEdit ? <button className="btn sm" onClick={onEdit} data-testid={`edit-expectation-${s.kind}`}>Editar</button> : undefined}
    >
      <p className="small muted">{s.label}</p>
      {!t ? (
        <Notice title="Sin expectativa todavía">Aún no hay ventas anteriores para proponerte una. {canEdit ? 'Toca «Editar» y ponla tú.' : ''}</Notice>
      ) : (
        <div className="stack-sm" data-testid={`expectation-${s.kind}`}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge kind={t.source === 'manual' ? 'brand' : 'info'}>{t.source === 'manual' ? 'La pusiste tú' : 'Automática'}</Badge>
            <Badge kind={st.kind === 'ok' ? 'ok' : st.kind === 'warn' ? 'warn' : st.kind === 'bad' ? 'bad' : 'info'}>
              <span aria-hidden="true">{st.icon}</span> {st.text}
            </Badge>
          </div>
          {t.source === 'auto' ? <p className="tiny muted">{t.basis}.</p> : t.notes ? <p className="tiny muted">{t.notes}</p> : null}
          {goal > 0 ? (
            <>
              <Meter value={got / goal} marker={proj !== null ? proj / goal : null} label={`Avance: ${title}`} tone={meterTone(st.kind)} />
              <div className="viz-legend">
                <span>
                  <i className={`key-rect viz-bg-${meterTone(st.kind)}`} /> Llevas {Math.round((got / goal) * 100)} %
                </span>
                {proj !== null ? (
                  <span>
                    <i className="key-line viz-bg-ink" /> Al ritmo actual llegarías al {Math.round((proj / goal) * 100)} %
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col" className="num">Esperabas</th>
                  <th scope="col" className="num">Llevas</th>
                  {s.projected ? <th scope="col" className="num">Al ritmo</th> : null}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Ganancia</th>
                  <td className="num">{formatCOP(t.profit)}</td>
                  <td className="num">{formatCOP(s.actual.profit)}</td>
                  {s.projected ? <td className="num">{formatCOP(s.projected.profit)}</td> : null}
                </tr>
                <tr>
                  <th scope="row">Ventas</th>
                  <td className="num">{formatCOP(t.revenue)}</td>
                  <td className="num">{formatCOP(s.actual.revenue)}</td>
                  {s.projected ? <td className="num">{formatCOP(s.projected.revenue)}</td> : null}
                </tr>
                <tr>
                  <th scope="row">Unidades</th>
                  <td className="num">{t.units}</td>
                  <td className="num">{s.actual.units}</td>
                  {s.projected ? <td className="num">{s.projected.units}</td> : null}
                </tr>
              </tbody>
            </table>
          </div>
          {t.source === 'manual' && canEdit ? (
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const r = await ask({ title: 'Volver a la automática', message: 'La app volverá a proponer la expectativa con tus resultados anteriores.', confirmText: 'Volver a la automática' });
                if (r.ok && t.id) await act.run(() => resetExpectation(db, t.id!), 'Expectativa automática');
              }}
            >
              Volver a la automática
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Expectations({ a, inventoryIds }: { a: BusinessAnalysis; inventoryIds: ID[] | null }) {
  const e = a.expectations;
  const [editing, setEditing] = useState<ExpectationStatus | null>(null);
  const [kind, setKind] = useState<'month' | 'week'>('month');
  const hist = kind === 'month' ? e.monthHistory : e.weekHistory;
  const rate = kind === 'month' ? e.hitRate.month : e.hitRate.week;
  return (
    <>
      {!e.canEdit ? <Notice>En una vista de varios inventarios las expectativas son automáticas. Para editarlas, elige «Todos los inventarios» o uno solo.</Notice> : null}
      <ExpectationCard s={e.month} title="Expectativa del mes" canEdit={e.canEdit} onEdit={() => setEditing(e.month)} />
      <ExpectationCard s={e.week} title="Expectativa de la semana" canEdit={e.canEdit} onEdit={() => setEditing(e.week)} />
      <Card title={<H k="expectationHistory">¿Cumpliste antes?</H>}>
        <Segmented label="Ver por" value={kind} onChange={setKind} options={[['month', 'Meses'], ['week', 'Semanas']]} />
        {hist.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }} data-testid="hit-rate">
              Cumpliste <strong>{rate.met}</strong> de {kind === 'month' ? plural(rate.total, 'mes', 'meses') : plural(rate.total, 'semana', 'semanas')}.
            </p>
            <Columns
              title="Ganancia lograda frente a la esperada"
              format="money"
              testId="expectation-history"
              valueLabel="Lo que ganaste"
              targetLabel="Lo que esperabas"
              data={hist.map((h) => ({ label: h.label, short: h.short, value: h.actual.profit, target: h.target?.profit ?? null }))}
            />
            <NumbersTable
              caption="Historial de expectativas"
              rows={[...hist].reverse()}
              cols={[
                { label: kind === 'month' ? 'Mes' : 'Semana', value: (h) => h.label },
                { label: 'Esperabas', value: (h) => (h.target ? formatCOP(h.target.profit) : '—'), num: true },
                { label: 'Ganaste', value: (h) => formatCOP(h.actual.profit), num: true },
                { label: 'Diferencia', value: (h) => (h.diff === null ? '—' : signed(h.diff)), num: true },
                { label: 'Resultado', value: (h) => `${stateText(h).icon} ${stateText(h).text}` },
              ]}
            />
          </>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>
            Aquí verás, periodo por periodo, si llegaste a lo que esperabas.
          </p>
        )}
      </Card>
      {editing ? <ExpectationSheet s={editing} inventoryId={inventoryIds?.[0] ?? null} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ExpectationSheet({ s, inventoryId, onClose }: { s: ExpectationStatus; inventoryId: ID | null; onClose: () => void }) {
  const [profit, setProfit] = useState<number | null>(s.target?.profit ?? null);
  const [revenue, setRevenue] = useState<number | null>(s.target?.revenue ?? null);
  const [units, setUnits] = useState<number | null>(s.target?.units ?? null);
  const [notes, setNotes] = useState(s.target?.source === 'manual' ? s.target.notes : '');
  const act = useAction();
  return (
    <Sheet
      title={s.kind === 'month' ? 'Expectativa del mes' : 'Expectativa de la semana'}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-expectation"
          onClick={async () => {
            const r = await act.run(() => saveExpectation(db, { period: s.kind, date: s.start, inventoryId, profit: profit ?? 0, revenue: revenue ?? 0, units: units ?? 0, notes }).then(() => true), 'Expectativa guardada');
            if (r) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted">{s.label}. {s.target?.source === 'auto' ? `La app te propuso: ${s.target.basis.toLowerCase()}.` : ''}</p>
      <Field label="¿Cuánto esperas ganar? (ganancia neta)" htmlFor="ex-p" error={act.field === 'profit' ? act.error : null}>
        <MoneyInput id="ex-p" value={profit} onChange={setProfit} />
      </Field>
      <Field label="¿Cuánto esperas vender? (ventas)" htmlFor="ex-r">
        <MoneyInput id="ex-r" value={revenue} onChange={setRevenue} />
      </Field>
      <Field label="¿Cuántas unidades?" htmlFor="ex-u">
        <IntInput id="ex-u" value={units} onChange={setUnits} />
      </Field>
      <Field label="Nota (opcional)" htmlFor="ex-n">
        <input id="ex-n" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: temporada de diciembre" />
      </Field>
      <FormError error={act.field === 'profit' ? null : act.error} />
    </Sheet>
  );
}

/* ======================= Tendencias ======================= */

type Metric = 'netProfit' | 'revenue' | 'grossProfit' | 'units' | 'grossMargin' | 'expenses' | 'sales';
const METRIC_OPTS: [Metric, string][] = [
  ['netProfit', 'Ganancia neta'],
  ['revenue', 'Ventas'],
  ['grossProfit', 'Ganancia bruta'],
  ['grossMargin', 'Margen'],
  ['units', 'Unidades'],
  ['sales', 'N.º de ventas'],
  ['expenses', 'Gastos'],
];

function Trends({ a }: { a: BusinessAnalysis }) {
  const [kind, setKind] = useState<'month' | 'week'>('month');
  const [metric, setMetric] = useState<Metric>('netProfit');
  const [cmpFull, setCmpFull] = useState(false);
  const rows = kind === 'month' ? a.months : a.weeks;
  const format: Fmt = metric === 'grossMargin' ? 'pct' : metric === 'units' || metric === 'sales' ? 'int' : 'money';
  const label = METRIC_OPTS.find((m) => m[0] === metric)![1];
  return (
    <>
      <Card tour="analysis-trends" title={<H k="trends">{label}: {kind === 'month' ? 'últimos 12 meses' : 'últimas 12 semanas'}</H>}>
        <div className="stack-sm">
          <Segmented label="Ver por" value={kind} onChange={setKind} options={[['month', 'Meses'], ['week', 'Semanas']]} />
          <Chips label="Qué ver" value={metric} onChange={setMetric} options={METRIC_OPTS} />
        </div>
        <Columns title={`${label} por ${kind === 'month' ? 'mes' : 'semana'}`} format={format} testId="trend-chart" data={rows.map((r) => ({ label: r.label, short: r.short, value: r[metric] as number | null, partial: r.partial }))} />
        <p className="tiny muted">La barra más clara es el periodo en curso (todavía no termina).</p>
        <NumbersTable
          caption="Tendencias"
          rows={[...rows].reverse()}
          cols={[
            { label: kind === 'month' ? 'Mes' : 'Semana', value: (r) => `${r.label}${r.partial ? ' (en curso)' : ''}` },
            { label: 'Ventas', value: (r) => formatCOP(r.revenue), num: true },
            { label: 'Costo', value: (r) => formatCOP(r.cogs), num: true },
            { label: 'G. bruta', value: (r) => formatCOP(r.grossProfit), num: true },
            { label: 'Gastos', value: (r) => formatCOP(r.expenses), num: true },
            { label: 'G. neta', value: (r) => formatCOP(r.netProfit), num: true },
            { label: 'Margen', value: (r) => fmt(r.grossMargin, 'pct'), num: true },
            { label: 'N.º ventas', value: (r) => r.sales, num: true },
            { label: 'Unidades', value: (r) => r.units, num: true },
          ]}
        />
      </Card>
      <Card title={<H k="compare">Este mes frente al pasado</H>}>
        <Segmented
          label="Comparar con"
          value={cmpFull ? 'full' : 'same'}
          onChange={(v) => setCmpFull(v === 'full')}
          options={[
            ['same', 'Mismo día'],
            ['full', 'Mes completo'],
          ]}
        />
        <ul className="cmp-list" data-testid="compare-table">
          {a.compare.rows.map((r) => (
            <CompareLine key={r.key} r={r} full={cmpFull} prevLabel={cmpFull ? 'Mes pasado' : 'Mes pasado al mismo día'} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function CompareLine({ r, full, prevLabel }: { r: CompareRow; full: boolean; prevLabel: string }) {
  const prev = full ? r.prevFull : r.prev;
  const f: Fmt = r.format;
  let change: React.ReactNode = <span className="muted">—</span>;
  if (r.cur !== null && prev !== null) {
    const d = r.cur - prev;
    const good = d === 0 ? null : (d > 0) === (r.good === 'up');
    const pct = f !== 'pct' && prev !== 0 ? ` (${d > 0 ? '+' : '−'}${Math.round(Math.abs(d / prev) * 100)} %)` : '';
    change =
      d === 0 ? (
        <span className="muted">Igual</span>
      ) : (
        <span className={good ? 'delta-up' : 'delta-down'}>
          {d > 0 ? '▲' : '▼'} {f === 'pct' ? `${Math.round(Math.abs(d) * 100)} pts` : f === 'money' ? formatCOP(Math.abs(d)) : fmt(Math.abs(d), f)}
          {pct}
        </span>
      );
  }
  return (
    <li>
      <div className="cmp-head">
        <span className="strong">{r.label}</span>
        <span className="cmp-change">{change}</span>
      </div>
      <div className="cmp-vals">
        <span>
          Este mes: <strong>{fmt(r.cur, f)}</strong>
        </span>
        <span>
          {prevLabel}: {fmt(prev, f)}
        </span>
      </div>
    </li>
  );
}

/* ======================= Productos (80/20) ======================= */

function ProductsTab({ a }: { a: BusinessAnalysis }) {
  const abc = a.abc;
  return (
    <>
      <Card tour="analysis-abc" title={<H k="abc">Productos estrella (80/20)</H>}>
        {abc.rows.length ? (
          <>
            <p className="small">
              En los últimos {abc.days} días, <strong>{abc.counts.A}</strong> producto(s) (clase A) dejaron el <strong>{Math.round(abc.shareA * 100)} %</strong> de tu ganancia.
            </p>
            <HBars
              format="money"
              testId="abc-bars"
              data={abc.rows.slice(0, 12).map((r) => ({
                key: r.productId,
                label: (
                  <>
                    <span className={`abc-tag abc-${r.cls.toLowerCase()}`}>{r.cls}</span> {r.name}
                  </>
                ),
                value: Math.max(0, r.profit),
                text: formatCOP(r.profit),
                tone: r.cls === 'A' ? 'a' : r.cls === 'B' ? 'b' : 'c',
                sub: `${plural(r.units, 'unidad', 'unidades')} · ${Math.round(r.share * 100)} % de la ganancia · margen ${fmt(r.margin, 'pct')}`,
              }))}
            />
            <div className="viz-legend">
              <span>
                <i className="key-rect viz-bg-a" /> A: el 80 % de tu ganancia
              </span>
              <span>
                <i className="key-rect viz-bg-b" /> B: el siguiente 15 %
              </span>
              <span>
                <i className="key-rect viz-bg-c" /> C: el resto
              </span>
            </div>
            <NumbersTable
              caption="Productos por ganancia"
              rows={abc.rows}
              cols={[
                { label: 'Producto', value: (r) => `${r.cls} · ${r.name}` },
                { label: 'Unid.', value: (r) => r.units, num: true },
                { label: 'Ventas', value: (r) => formatCOP(r.revenue), num: true },
                { label: 'Ganancia', value: (r) => formatCOP(r.profit), num: true },
                { label: 'Margen', value: (r) => fmt(r.margin, 'pct'), num: true },
                { label: '% gan.', value: (r) => fmt(r.share, 'pct'), num: true },
                { label: 'Acumulado', value: (r) => fmt(r.cumShare, 'pct'), num: true },
              ]}
            />
          </>
        ) : (
          <Empty icon="chart" title="Sin ventas en los últimos 90 días" />
        )}
      </Card>
      <Card title={<H k="idle">Plata quieta: no se vendió en {abc.days} días</H>}>
        {abc.idle.length ? (
          <>
            <HBars format="money" data={abc.idle.slice(0, 10).map((i) => ({ key: i.productId, label: i.name, value: i.cost, tone: 'muted', sub: plural(i.qty, 'unidad', 'unidades') }))} />
            <p className="tiny muted">Considera una promoción o un precio más bajo: esa plata podría volver a la caja.</p>
          </>
        ) : (
          <p className="small muted">¡Bien! Todo lo que tienes se ha vendido en los últimos {abc.days} días.</p>
        )}
      </Card>
    </>
  );
}

/* ======================= Tiempo de venta ======================= */

function SellTimeTab({ a }: { a: BusinessAnalysis }) {
  const t = a.sellTime;
  if (!t.units && !t.unknown)
    return (
      <Empty icon="clock" title="Todavía no hay ventas para medir">
        <p className="small muted">Cuando vendas, aquí verás cuántos días te demoras en promedio desde que la mercancía entra hasta que la vendes.</p>
      </Empty>
    );
  const fast = t.byProduct.slice(0, 5);
  const slow = [...t.byProduct].reverse().slice(0, 5);
  return (
    <>
      <Card tour="analysis-selltime" title={<H k="sellTime">¿Cuánto te demoras en vender?</H>}>
        <p className="hero-figure" data-testid="avg-sell-days">
          {fmt(t.avgDays, 'days')}
        </p>
        <p className="small muted">en promedio, desde que entra la mercancía hasta que la vendes ({t.units} unidades con fecha conocida).</p>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <div className="kpi">
            <div className="kpi-label">La mitad se vende en menos de</div>
            <div className="kpi-value">{fmt(t.medianDays, 'days')}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Últimos 90 días</div>
            <div className="kpi-value">{fmt(t.avgDays90, 'days')}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Lo que tienes lleva esperando</div>
            <div className="kpi-value">{fmt(t.waiting.avgDays, 'days')}</div>
            <div className="kpi-foot">{t.waiting.units} unidades</div>
          </div>
        </div>
        {t.unknown ? <p className="tiny muted">{t.unknown} unidad(es) vendidas no tienen fecha de ingreso y no cuentan.</p> : null}
      </Card>
      <Card title="¿En cuánto tiempo se vende?">
        <HBars format="pct" testId="selltime-buckets" data={t.buckets.map((b) => ({ key: b.key, label: b.label, value: b.share, text: `${b.units} (${fmt(b.share, 'pct')})` }))} />
      </Card>
      <Card title="Mes a mes">
        <Columns title="Días promedio para vender, por mes de venta" format="int" testId="selltime-months" data={t.months.map((m) => ({ label: m.label, short: m.short, value: m.avgDays, partial: m.partial }))} />
        <NumbersTable
          caption="Días promedio por mes"
          rows={[...t.months].reverse().filter((m) => m.units)}
          cols={[
            { label: 'Mes', value: (m) => m.label },
            { label: 'Días promedio', value: (m) => fmt(m.avgDays, 'days'), num: true },
            { label: 'Unidades', value: (m) => m.units, num: true },
          ]}
        />
      </Card>
      {t.byProduct.length ? (
        <Card title="Por producto">
          <p className="small strong">Los que más rápido se venden</p>
          <HBars format="days" data={fast.map((p) => ({ key: `f${p.productId}`, label: p.name, value: p.avgDays, sub: plural(p.units, 'vendida', 'vendidas') }))} max={Math.max(...t.byProduct.map((p) => p.avgDays))} />
          {t.byProduct.length > 5 ? (
            <>
              <p className="small strong" style={{ marginTop: 12 }}>
                Los que más se demoran
              </p>
              <HBars format="days" data={slow.map((p) => ({ key: `s${p.productId}`, label: p.name, value: p.avgDays, tone: 'muted', sub: plural(p.units, 'vendida', 'vendidas') }))} max={Math.max(...t.byProduct.map((p) => p.avgDays))} />
            </>
          ) : null}
          <NumbersTable
            caption="Días promedio por producto"
            rows={t.byProduct}
            cols={[
              { label: 'Producto', value: (p) => p.name },
              { label: 'Días', value: (p) => fmt(p.avgDays, 'num'), num: true },
              { label: 'Vendidas', value: (p) => p.units, num: true },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}

/* ======================= Flujo de dinero ======================= */

function Flows({ a }: { a: BusinessAnalysis }) {
  const [prev, setPrev] = useState(false);
  const be = a.breakEven;
  const profit = prev ? a.profitFlowPrev : a.profitFlow;
  const cash = prev ? a.cashFlowPrev : a.cashFlow;
  return (
    <>
      <Segmented label="Mes" value={prev ? 'prev' : 'cur'} onChange={(v) => setPrev(v === 'prev')} options={[['cur', 'Este mes'], ['prev', 'Mes pasado']]} />
      <Card tour="analysis-flow" title={<H k="profitFlow">De tus ventas a tu ganancia</H>}>
        <Waterfall title="De las ventas a la ganancia neta" steps={profit} testId="profit-waterfall" />
      </Card>
      <Card title={<H k="cashFlow">Cómo se movió la plata de la caja</H>}>
        <Waterfall title="Movimiento de la caja" steps={cash} testId="cash-waterfall" />
        <p className="tiny muted">La caja es la plata que debería haber (efectivo y cuentas) según lo que registraste.</p>
      </Card>
      <Card title={<H k="breakEven">Punto de equilibrio del mes</H>}>
        {be.state === 'no_data' ? (
          <p className="small muted">Todavía no hay ventas para calcularlo.</p>
        ) : be.state === 'no_margin' ? (
          <Notice kind="bad" title="Estás vendiendo sin margen">Con lo que ganas por venta no alcanzas a cubrir los gastos. Revisa tus precios.</Notice>
        ) : be.state === 'no_expenses' ? (
          <p className="small">No tienes gastos registrados: cada venta ya deja ganancia.</p>
        ) : (
          <div className="stack-sm" data-testid="break-even">
            <p className="small">
              Tus gastos son de unos <strong>{formatCOP(be.monthlyExpenses)}</strong> al mes ({be.expensesBasis}) y de cada venta te queda el <strong>{fmt(be.grossMargin, 'pct')}</strong>. Para no perder necesitas vender{' '}
              <strong>{formatCOP(be.revenueNeeded)}</strong> al mes.
            </p>
            <Meter value={be.progress ?? 0} label="Avance hacia el punto de equilibrio" tone={be.state === 'reached' ? 'good' : be.state === 'behind' ? 'warn' : '1'} />
            <p className="small">
              {be.state === 'reached' ? (
                <>
                  <span aria-hidden="true">✓</span> Ya lo superaste: llevas {formatCOP(be.monthRevenue)}.
                </>
              ) : be.state === 'on_track' ? (
                <>
                  <span aria-hidden="true">↗</span> Llevas {formatCOP(be.monthRevenue)}. Al ritmo actual lo alcanzas hacia el {formatDate(be.reachedOn)}.
                </>
              ) : (
                <>
                  <span aria-hidden="true">!</span> Llevas {formatCOP(be.monthRevenue)}. Al ritmo actual no alcanzas este mes.
                </>
              )}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

/* ======================= Días y horas ======================= */

function Days({ a }: { a: BusinessAnalysis }) {
  const t = a.time;
  const max = Math.max(...t.weekdays.map((w) => w.avgRevenue));
  return (
    <>
      <Card tour="analysis-days" title={<H k="weekday">¿Qué días vendes más?</H>}>
        {t.best ? (
          <p className="small">
            Últimos {t.days} días. Tu mejor día es el <strong>{t.best.label.toLowerCase()}</strong>.
          </p>
        ) : (
          <p className="small muted">Sin ventas en los últimos {t.days} días.</p>
        )}
        <Columns
          title="Ventas promedio por día de la semana"
          format="money"
          mode="emphasis"
          valueLabel="El mejor día"
          testId="weekday-chart"
          data={t.weekdays.map((w) => ({ label: w.label, short: w.label.slice(0, 3), value: w.avgRevenue, emphasis: max > 0 && w.avgRevenue === max }))}
        />
        <NumbersTable
          caption="Ventas por día de la semana"
          rows={t.weekdays}
          cols={[
            { label: 'Día', value: (w) => w.label },
            { label: 'Ventas', value: (w) => w.sales, num: true },
            { label: 'Ingresos', value: (w) => formatCOP(w.revenue), num: true },
            { label: 'Promedio por día', value: (w) => formatCOP(w.avgRevenue), num: true },
            { label: 'Ganancia', value: (w) => formatCOP(w.profit), num: true },
            { label: '% de ventas', value: (w) => fmt(w.share, 'pct'), num: true },
          ]}
        />
      </Card>
      <Card title="¿A qué hora?">
        <HBars format="pct" data={t.hours.map((h) => ({ key: h.key, label: h.label, value: h.share, text: `${h.sales} ventas (${fmt(h.share, 'pct')})` }))} />
      </Card>
    </>
  );
}

/* ======================= Preguntones ======================= */

function InquiriesTab({ inventoryIds }: { inventoryIds: ID[] | null }) {
  const ov = useLive((d) => getInquiryOverview(d, inventoryIds), [JSON.stringify(inventoryIds)]);
  return (
    <>
      <a className="btn block" href="#/preguntones">
        <Icon name="chat" /> Ir al contador de preguntones
      </a>
      {ov ? <InquiryAnalysis ov={ov} /> : <Loading />}
    </>
  );
}
