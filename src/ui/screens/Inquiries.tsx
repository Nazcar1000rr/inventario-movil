import { useMemo, useState } from 'react';
import {
  addInquiry,
  deleteInquiry,
  formatDate,
  formatDateTime,
  getInquiryOverview,
  markInquiryBought,
  newOpId,
  normalizeText,
  reopenInquiry,
  updateInquiry,
  type ID,
  type InquiryOverview,
} from '../../core';
import { InfoTip } from '../components/help';
import { Icon } from '../components/Icon';
import { ListenButton } from '../components/speaker';
import { ask, Badge, Card, Empty, Field, FormError, Loading, Notice, Page, Segmented, Sheet, TextInput } from '../components/ui';
import { Columns, fmt, HBars, NumbersTable, plural } from '../components/viz';
import { playSound } from '../sound';
import { db, toast, useAction, useLive, usePref } from '../store';

export const INQUIRY_EXPLAIN =
  'Un preguntón es alguien que te preguntó por un producto (por WhatsApp, en el local o por redes) y no te compró. Cada vez que pase, toca «+1 Preguntón»: la app guarda el día y la hora. Si esa persona vuelve y te compra, toca «Me compró»: se resta del contador porque su compra ya cuenta como venta. Así sabes cuántas personas preguntan por cada venta y qué días preguntan más.';

/** Inventario al que se anotan los preguntones (se recuerda en este teléfono). Con un solo inventario, ese. */
function useInquiryInventory(): { value: ID | null; set: (v: ID | null) => void; options: [string, string][] } {
  const invs = useLive((d) => d.inventories.toArray());
  const [pref, setPref] = usePref('inquiryInventory', '');
  const active = (invs ?? []).filter((i) => !i.archived);
  let value: ID | null = pref && active.some((i) => i.id === pref) ? pref : null;
  if (!pref && active.length === 1) value = active[0].id;
  const options: [string, string][] = [['', 'Todo el negocio'], ...active.map((i) => [i.id, i.name] as [string, string])];
  return { value, set: (v) => setPref(v ?? ''), options: active.length > 1 ? options : [] };
}

/** Botones +1 / Me compró con los contadores de hoy, la semana y el mes. */
export function InquiryCounter({ compact = false }: { compact?: boolean }) {
  const inv = useInquiryInventory();
  const ov = useLive((d) => getInquiryOverview(d, inv.value ? [inv.value] : null), [inv.value]);
  const [last, setLast] = useState<ID | null>(null);
  const act = useAction();
  const add = async () => {
    const q = await act.run(() => addInquiry(db, { opId: newOpId(), inventoryId: inv.value }));
    if (q) {
      setLast(q.id);
      playSound('tap');
      toast('Preguntón anotado');
    }
  };
  const bought = async () => {
    const q = await act.run(() => markInquiryBought(db, { opId: newOpId(), inventoryId: inv.value }));
    if (q) {
      setLast(null);
      playSound('sale');
      toast('¡Bien! Se restó un preguntón: ya cuenta como venta');
    }
  };
  return (
    <div className="stack-sm" data-testid="inquiry-counter">
      {inv.options.length ? (
        <select className="select" aria-label="¿De qué inventario?" value={inv.value ?? ''} onChange={(e) => inv.set(e.target.value || null)}>
          {inv.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ) : null}
      <div className="inquiry-counts" aria-live="polite">
        <div>
          <span className="inquiry-num" data-testid="inquiry-today">
            {ov?.today ?? 0}
          </span>
          <span className="tiny muted">hoy</span>
        </div>
        <div>
          <span className="inquiry-num" data-testid="inquiry-week">
            {ov?.week ?? 0}
          </span>
          <span className="tiny muted">esta semana</span>
        </div>
        <div>
          <span className="inquiry-num" data-testid="inquiry-month">
            {ov?.month ?? 0}
          </span>
          <span className="tiny muted">este mes</span>
        </div>
      </div>
      <div className="grid-2">
        <button type="button" className="btn primary inquiry-add" disabled={act.busy} onClick={() => void add()} data-testid="inquiry-add" data-sound="none">
          <Icon name="plus" /> Preguntón
        </button>
        <button type="button" className="btn" disabled={act.busy || !ov?.openTotal} onClick={() => void bought()} data-testid="inquiry-bought" data-sound="none">
          <Icon name="check" /> Me compró
        </button>
      </div>
      {last ? (
        <button
          type="button"
          className="btn sm"
          onClick={async () => {
            await act.run(() => deleteInquiry(db, last), 'Registro borrado');
            setLast(null);
          }}
        >
          <Icon name="undo" size={16} /> Lo toqué por error
        </button>
      ) : null}
      {!compact && ov && ov.last30.sales > 0 && ov.last30.perSale ? (
        <p className="small">
          En los últimos 30 días te preguntaron <strong>{fmt(ov.last30.perSale, 'num')} personas por cada venta</strong>.
        </p>
      ) : null}
      <FormError error={act.error} />
    </div>
  );
}

const STATE_LABEL = { open: 'No compró', bought: 'Volvió y compró' };

export function InquiriesScreen() {
  const ov = useLive((d) => getInquiryOverview(d, null));
  return (
    <Page title="Preguntones" back="/mas" help="inquiries">
      <Card
        tour="inquiry-counter"
        title={
          <h2 className="with-tip">
            Personas que preguntan <InfoTip k="inquiries" />
          </h2>
        }
      >
        <InquiryCounter />
      </Card>
      <details className="more" data-testid="inquiry-explain">
        <summary>¿Qué es un preguntón y para qué sirve?</summary>
        <div className="stack-sm">
          <p className="small">{INQUIRY_EXPLAIN}</p>
          <p className="small">
            Ejemplo: si en la semana te preguntaron 12 personas que no compraron y vendiste 4 veces, hubo 16 interesados. Te preguntan <strong>4 personas por cada venta</strong> (16 ÷ 4) y compra 1 de cada 4 (25 %). Si ese número baja, estás convenciendo a más gente.
          </p>
          <div>
            <ListenButton text={INQUIRY_EXPLAIN} />
          </div>
        </div>
      </details>
      {!ov ? <Loading /> : <InquiryAnalysis ov={ov} />}
      {ov ? <RecentInquiries ov={ov} /> : null}
    </Page>
  );
}

/** Análisis semanal y mensual de los preguntones (también se muestra en Análisis del negocio). */
export function InquiryAnalysis({ ov }: { ov: InquiryOverview }) {
  const [kind, setKind] = useState<'week' | 'month'>('week');
  if (!ov.hasData)
    return (
      <Empty icon="chat" title="Todavía no has anotado preguntones">
        <p className="small muted">Toca «+1 Preguntón» cada vez que alguien pregunte y no compre. Con unos días de datos verás cuántos preguntan por cada venta.</p>
      </Empty>
    );
  const rows = kind === 'week' ? ov.weeks : ov.months;
  const cur = rows[rows.length - 1];
  const maxDay = Math.max(...ov.weekdays.map((w) => w.count));
  return (
    <>
      <Card
        title={
          <h2 className="with-tip">
            Por cada venta <InfoTip k="conversion" />
          </h2>
        }
      >
        <div className="stat-grid" data-testid="inquiry-stats">
          <div className="kpi">
            <div className="kpi-label">Preguntan por cada venta</div>
            <div className="kpi-value">{ov.last30.perSale === null ? '—' : fmt(ov.last30.perSale, 'num')}</div>
            <div className="kpi-foot">Últimos 30 días</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Compran de cada 100</div>
            <div className="kpi-value">{ov.last30.conversion === null ? '—' : Math.round(ov.last30.conversion * 100)}</div>
            <div className="kpi-foot">
              {plural(ov.last30.sales, 'venta', 'ventas')} · {plural(ov.last30.askers, 'preguntón', 'preguntones')}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Volvieron y compraron</div>
            <div className="kpi-value">{ov.returnedTotal}</div>
            <div className="kpi-foot">{ov.avgDaysToReturn === null ? 'Todavía ninguno' : `En promedio a los ${fmt(ov.avgDaysToReturn, 'days')}`}</div>
          </div>
        </div>
      </Card>
      <Card title="Semana a semana y mes a mes">
        <Segmented label="Ver por" value={kind} onChange={setKind} options={[['week', 'Semanas'], ['month', 'Meses']]} />
        <p className="small" style={{ marginTop: 8 }}>
          {cur.label}: <strong>{cur.askers}</strong> preguntones y <strong>{cur.sales}</strong> ventas
          {cur.perSale !== null ? ` · ${fmt(cur.perSale, 'num')} personas por venta` : ''}.
        </p>
        <Columns
          title={`Preguntones por ${kind === 'week' ? 'semana' : 'mes'}`}
          testId="inquiry-chart"
          format="int"
          data={rows.map((r) => ({ label: r.label, short: r.short, value: r.askers, partial: r.partial }))}
        />
        <NumbersTable
          caption="Preguntones y ventas por periodo"
          rows={[...rows].reverse()}
          cols={[
            { label: kind === 'week' ? 'Semana' : 'Mes', value: (r) => r.label },
            { label: 'Preguntones', value: (r) => r.askers, num: true },
            { label: 'Ventas', value: (r) => r.sales, num: true },
            { label: 'Interesados', value: (r) => r.interested, num: true },
            { label: 'Por venta', value: (r) => (r.perSale === null ? '—' : fmt(r.perSale, 'num')), num: true },
            { label: 'Compran', value: (r) => (r.conversion === null ? '—' : fmt(r.conversion, 'pct')), num: true },
            { label: 'Volvieron', value: (r) => r.returned, num: true },
          ]}
        />
      </Card>
      <Card title="¿Qué días preguntan más?">
        <p className="tiny muted">Últimos 90 días. Todos los toques, compren o no.</p>
        <Columns
          title="Preguntones por día de la semana"
          format="int"
          mode="emphasis"
          valueLabel="El día con más preguntas"
          data={ov.weekdays.map((w) => ({ label: w.label, short: w.label.slice(0, 3), value: w.count, emphasis: maxDay > 0 && w.count === maxDay }))}
        />
        <HBars format="pct" data={ov.hours.map((h) => ({ key: h.key, label: h.label, value: h.share, text: `${h.count} (${fmt(h.share, 'pct')})`, tone: 'muted' }))} />
      </Card>
      {ov.topProducts.length ? (
        <Card title="Lo que más preguntan">
          <HBars
            format="int"
            data={ov.topProducts.map((p) => ({ key: p.productId, label: p.name, value: p.asked, text: `${p.asked}`, sub: p.returned ? (p.returned === 1 ? '1 volvió y compró' : `${p.returned} volvieron y compraron`) : undefined }))}
          />
        </Card>
      ) : null}
    </>
  );
}

function RecentInquiries({ ov }: { ov: InquiryOverview }) {
  const act = useAction();
  const [picking, setPicking] = useState<ID | null>(null);
  if (!ov.recent.length) return null;
  return (
    <Card title="Últimos toques" flush>
      <FormError error={act.error} />
      <ul className="list" data-testid="inquiry-list">
        {ov.recent.map((q) => (
          <li key={q.id} className="inq-row">
            <div className="inq-main">
              <span className="strong small">{formatDateTime(q.date)}</span>
              <Badge kind={q.status === 'bought' ? 'ok' : undefined}>{STATE_LABEL[q.status]}</Badge>
            </div>
            <div className="inq-sub small muted">
              {q.productName ? `Preguntó por: ${q.productName}` : 'Sin producto'}
              {q.notes ? ` · ${q.notes}` : ''}
              {q.status === 'bought' && q.boughtAt ? ` · compró el ${formatDate(q.boughtAt)}` : ''}
            </div>
            <div className="inq-actions">
              {q.status === 'open' ? (
                <button type="button" className="btn sm" onClick={() => void act.run(() => markInquiryBought(db, { id: q.id }), 'Marcado: volvió y compró')}>
                  <Icon name="check" size={16} /> Me compró
                </button>
              ) : (
                <button type="button" className="btn sm" onClick={() => void act.run(() => reopenInquiry(db, q.id), 'Vuelve a contar como preguntón')}>
                  <Icon name="undo" size={16} /> Deshacer
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => setPicking(q.id)}>
                <Icon name="edit" size={16} /> Editar
              </button>
              <button
                type="button"
                className="btn sm"
                aria-label="Borrar este registro"
                onClick={async () => {
                  const ok = await ask({ title: 'Borrar este registro', message: 'Úsalo solo si lo tocaste por error.', confirmText: 'Borrar', danger: true });
                  if (ok.ok) await act.run(() => deleteInquiry(db, q.id), 'Registro borrado');
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {picking ? <AskedSheet id={picking} initial={ov.recent.find((x) => x.id === picking)!} onClose={() => setPicking(null)} /> : null}
    </Card>
  );
}

function AskedSheet({ id, initial, onClose }: { id: ID; initial: { productId: ID | null; notes: string; inventoryId: ID | null }; onClose: () => void }) {
  const products = useLive((d) => d.products.filter((p) => !p.archived && (!initial.inventoryId || p.inventoryId === initial.inventoryId)).toArray(), [initial.inventoryId]);
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState<ID | null>(initial.productId);
  const [notes, setNotes] = useState(initial.notes);
  const act = useAction();
  const list = useMemo(() => {
    const nq = normalizeText(q);
    return (products ?? []).filter((p) => !nq || normalizeText(p.name).includes(nq)).slice(0, 40);
  }, [products, q]);
  return (
    <Sheet
      title="¿Qué preguntó?"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => updateInquiry(db, id, { productId, notes }).then(() => true), 'Guardado');
            if (r) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Buscar producto" htmlFor="aq-q">
        <TextInput id="aq-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: iPhone 13, cargador" />
      </Field>
      <div className="chips wrap" role="group" aria-label="Producto">
        <button type="button" className="chip" aria-pressed={productId === null} onClick={() => setProductId(null)}>
          Ninguno
        </button>
        {list.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={productId === p.id} onClick={() => setProductId(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <Field label="Nota (opcional)" htmlFor="aq-n">
        <TextInput id="aq-n" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: le pareció caro, quería otro color" />
      </Field>
      <Notice>Saber qué preguntan sin comprar te dice qué producto conviene tener más o a qué precio ofrecerlo.</Notice>
      <FormError error={act.error} />
    </Sheet>
  );
}
