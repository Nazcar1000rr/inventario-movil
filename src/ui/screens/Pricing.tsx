import { useMemo, useState } from 'react';
import {
  addMarketPrice,
  deleteMarketPrice,
  formatCOP,
  formatDate,
  getMarketHistory,
  getSettings,
  listMarketPrices,
  maxBuyPrice,
  normalizeText,
  nowISO,
  type MarginType,
  type MarketPriceRow,
} from '../../core';
import { L } from '../components/help';
import { Icon } from '../components/Icon';
import { ConditionChips } from '../components/parts';
import { Badge, Card, confirmAction, DateTimeInput, Empty, Field, FormError, IntInput, KV, Loading, MoneyInput, Notice, Page, Segmented, Sheet, TextInput } from '../components/ui';
import { useRoute } from '../router';
import { db, useAction, useLive } from '../store';

/** Modelos y capacidades conocidos (catálogo + productos) para sugerir al escribir. */
function useModelOptions() {
  return useLive(async (d) => {
    const [cat, prods] = await Promise.all([d.catalogModels.toArray(), d.products.toArray()]);
    const models = new Map<string, Set<string>>();
    for (const m of cat) if (!m.archived && m.category === 'phone') models.set(m.model, new Set(m.storageOptions));
    for (const p of prods) {
      const name = p.model || '';
      if (!name) continue;
      const set = models.get(name) ?? new Set<string>();
      if (p.capacity) set.add(p.capacity);
      models.set(name, set);
    }
    return models;
  });
}

export function MarketPricesScreen() {
  const route = useRoute();
  const prefill = route.query.get('model') ? { model: route.query.get('model') ?? '', capacity: route.query.get('cap') ?? '', condition: route.query.get('cond') ?? '' } : null;
  const rows = useLive((d) => listMarketPrices(d));
  const settings = useLive((d) => getSettings(d));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<null | { model: string; capacity: string; condition: string }>(prefill);
  const [history, setHistory] = useState<MarketPriceRow | null>(null);
  const filtered = useMemo(() => {
    const t = normalizeText(q);
    return (rows ?? []).filter((r) => !t || normalizeText(`${r.model} ${r.capacity} ${r.condition}`).includes(t));
  }, [rows, q]);
  const stale = (rows ?? []).filter((r) => r.stale).length;
  return (
    <Page title="Precios de mercado" help="prices" back="/mas">
      <Notice>
        Anota lo que ves en Marketplace u otras tiendas para cada modelo, capacidad y estado. La app guarda el historial y te sugiere precios al vender. Un precio con más de {settings?.pricing.marketStaleDays ?? 30} días se marca como desactualizado.
      </Notice>
      <div className="actions">
        <button className="btn primary" onClick={() => setAdding({ model: '', capacity: '', condition: '' })} data-testid="add-market-price">
          <Icon name="plus" /> Anotar precio
        </button>
        <a className="btn" href="#/calculadora">
          <Icon name="calc" /> ¿Cuánto pagar?
        </a>
      </div>
      {stale ? <Notice kind="warn">{stale} precio(s) desactualizado(s). Revisa el mercado y anótalos de nuevo.</Notice> : null}
      {rows && rows.length > 6 ? <TextInput type="search" placeholder="Buscar modelo…" aria-label="Buscar modelo" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon="tag" title="Aún no has anotado precios">
          <p className="small muted">Empieza por los modelos que más vendes.</p>
        </Empty>
      ) : (
        <Card flush>
          <ul className="list">
            {filtered.map((r) => (
              <li key={r.key}>
                <button className="item" type="button" onClick={() => setHistory(r)} data-testid="market-row">
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {r.model} {r.capacity} · {r.condition}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDate(r.latest.date)} · hace {r.ageDays} d{r.count > 1 ? ` · ${r.count} registros` : ''}
                      {r.change ? <span className={r.change > 0 ? 'delta-up' : 'delta-down'}> · {r.change > 0 ? '▲' : '▼'} {formatCOP(Math.abs(r.change))}</span> : null}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <span className="money strong">{formatCOP(r.latest.price)}</span>
                    {r.stale ? <Badge kind="warn">Desactualizado</Badge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {adding ? <MarketPriceSheet initial={adding} onClose={() => setAdding(null)} /> : null}
      {history ? (
        <HistorySheet
          row={history}
          onClose={() => setHistory(null)}
          onAdd={() => {
            setAdding({ model: history.model, capacity: history.capacity, condition: history.condition });
            setHistory(null);
          }}
        />
      ) : null}
    </Page>
  );
}

function MarketPriceSheet({ initial, onClose }: { initial: { model: string; capacity: string; condition: string }; onClose: () => void }) {
  const [model, setModel] = useState(initial.model);
  const [capacity, setCapacity] = useState(initial.capacity);
  const [condition, setCondition] = useState(initial.condition || 'Usado');
  const [price, setPrice] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(nowISO());
  const [notes, setNotes] = useState('');
  const options = useModelOptions();
  const caps = options?.get(model) ? [...options.get(model)!] : [];
  const act = useAction();
  return (
    <Sheet
      title="Anotar precio de mercado"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-market-price"
          onClick={async () => {
            const r = await act.run(() => addMarketPrice(db, { model, capacity, condition, price: price ?? 0, date: date ?? undefined, notes }), 'Precio guardado');
            if (r) onClose();
          }}
        >
          Guardar precio
        </button>
      }
    >
      <div className="stack">
        <Field label="Modelo" htmlFor="mp-model" error={act.field === 'model' ? act.error : null}>
          <TextInput id="mp-model" list="mp-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ej.: iPhone 13" />
          <datalist id="mp-models">
            {[...(options?.keys() ?? [])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Capacidad" htmlFor="mp-cap">
          <TextInput id="mp-cap" list="mp-caps" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Ej.: 128 GB" />
          <datalist id="mp-caps">
            {caps.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Estado">
          <ConditionChips value={condition} onChange={setCondition} allowEmpty={false} />
        </Field>
        <Field label="Precio de mercado" htmlFor="mp-price" error={act.field === 'price' ? act.error : null}>
          <MoneyInput id="mp-price" value={price} onChange={setPrice} invalid={act.field === 'price'} />
        </Field>
        <Field label="Fecha" htmlFor="mp-date">
          <DateTimeInput id="mp-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Nota (opcional)" htmlFor="mp-notes">
          <TextInput id="mp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: promedio de 5 publicaciones" />
        </Field>
        <FormError error={act.field === 'model' || act.field === 'price' ? null : act.error} />
      </div>
    </Sheet>
  );
}

function HistorySheet({ row, onClose, onAdd }: { row: MarketPriceRow; onClose: () => void; onAdd: () => void }) {
  const list = useLive((d) => getMarketHistory(d, row.key), [row.key]);
  const act = useAction();
  return (
    <Sheet
      title={`${row.model} ${row.capacity} · ${row.condition}`}
      onClose={onClose}
      footer={
        <button className="btn primary block" onClick={onAdd}>
          <Icon name="plus" /> Anotar precio nuevo
        </button>
      }
    >
      {!list ? (
        <Loading />
      ) : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className="item" style={{ cursor: 'default' }}>
              <span className="item-main">
                <span className="item-title" style={{ display: 'block' }}>
                  {formatCOP(p.price)}
                </span>
                <span className="item-sub" style={{ display: 'block' }}>
                  {formatDate(p.date)}
                  {p.notes ? ` · ${p.notes}` : ''}
                </span>
              </span>
              <button
                className="icon-btn"
                aria-label="Eliminar registro"
                onClick={async () => {
                  if (await confirmAction({ title: 'Eliminar precio', message: <p>Se elimina el registro de {formatCOP(p.price)} del {formatDate(p.date)}.</p>, danger: true, confirmText: 'Eliminar' }))
                    await act.run(() => deleteMarketPrice(db, p.id), 'Registro eliminado');
                }}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/* ================= Calculadora "¿Cuánto pagar?" ================= */

export function CalculatorScreen() {
  const settings = useLive((d) => getSettings(d));
  const rows = useLive((d) => listMarketPrices(d));
  if (!settings || !rows) return <Page title="¿Cuánto pagar?" help="calculator" back="/precios"><Loading /></Page>;
  return <Calculator pricing={settings.pricing} rows={rows} />;
}

function Calculator({ pricing, rows }: { pricing: Awaited<ReturnType<typeof getSettings>>['pricing']; rows: MarketPriceRow[] }) {
  const [rowKey, setRowKey] = useState('');
  const [market, setMarket] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [generic, setGeneric] = useState<number | null>(0);
  const [marginType, setMarginType] = useState<MarginType>(pricing.targetMarginType);
  const [margin, setMargin] = useState<number | null>(pricing.targetMarginValue);
  const [costs, setCosts] = useState<number | null>(pricing.expectedCosts);
  const row = rows.find((r) => r.key === rowKey);
  const marketValue = market ?? row?.latest.price ?? null;
  const res = marketValue !== null ? maxBuyPrice({ market: marketValue, batteryHealth: battery, genericParts: generic ?? 0, targetMarginType: marginType, targetMarginValue: margin ?? 0, expectedCosts: costs ?? 0 }, pricing) : null;
  return (
    <Page title="¿Cuánto pagar?" help="calculator" back="/precios">
      <Card>
        <div className="stack">
          {rows.length ? (
            <Field label="Modelo (de tus precios de mercado)" htmlFor="calc-row">
              <select
                id="calc-row"
                className="select"
                value={rowKey}
                onChange={(e) => {
                  setRowKey(e.target.value);
                  setMarket(null);
                }}
              >
                <option value="">Escribir el precio a mano</option>
                {rows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.model} {r.capacity} · {r.condition} · {formatCOP(r.latest.price)}
                    {r.stale ? ' (desactualizado)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label={<L k="marketPrice">Precio de mercado</L>} htmlFor="calc-market" hint={row && market === null ? `Anotado el ${formatDate(row.latest.date)}` : undefined}>
            <MoneyInput id="calc-market" value={marketValue} onChange={setMarket} />
          </Field>
          {row?.stale ? <Notice kind="warn">Este precio de mercado está desactualizado (hace {row.ageDays} días).</Notice> : null}
          <div className="grid-2">
            <Field label="Batería %" htmlFor="calc-bat" hint={pricing.batteryThreshold !== null ? `Descuento si es menor a ${pricing.batteryThreshold} %` : 'Sin descuento configurado'}>
              <IntInput id="calc-bat" value={battery} onChange={(v) => setBattery(v === null ? null : Math.min(100, v))} placeholder="Opcional" />
            </Field>
            <Field label="Piezas genéricas o con aviso" htmlFor="calc-gen" hint={pricing.genericPartDiscount ? `${formatCOP(pricing.genericPartDiscount)} c/u` : 'Sin descuento configurado'}>
              <IntInput id="calc-gen" value={generic} onChange={setGeneric} />
            </Field>
          </div>
          <Field label="Margen que quieres ganar">
            <Segmented label="Tipo de margen" value={marginType} onChange={setMarginType} options={[['amount', 'En pesos'], ['percent', 'En %']]} />
          </Field>
          <div className="grid-2">
            <Field label={marginType === 'amount' ? 'Margen ($)' : 'Margen (%)'} htmlFor="calc-margin">
              {marginType === 'amount' ? <MoneyInput id="calc-margin" value={margin} onChange={setMargin} /> : <IntInput id="calc-margin" value={margin} onChange={setMargin} />}
            </Field>
            <Field label="Gastos esperados" htmlFor="calc-costs" hint="Transporte, alistamiento…">
              <MoneyInput id="calc-costs" value={costs} onChange={setCosts} />
            </Field>
          </div>
        </div>
      </Card>
      {res ? (
        <Card>
          <div className="center stack-sm" data-testid="max-buy">
            <p className="small muted">
              <L k="maxBuy">Paga como máximo</L>
            </p>
            <p className="kpi-value" style={{ fontSize: 32 }}>
              {formatCOP(res.maxPrice)}
            </p>
          </div>
          <KV
            rows={[
              ['Precio de mercado', formatCOP(res.market)],
              ...(res.batteryDiscount ? ([['Descuento por batería', `−${formatCOP(res.batteryDiscount)}`]] as [string, string][]) : []),
              ...(res.partsDiscount ? ([['Descuento por piezas', `−${formatCOP(res.partsDiscount)}`]] as [string, string][]) : []),
              ['Mercado ajustado', formatCOP(res.adjustedMarket)],
              ['Gastos esperados', `−${formatCOP(res.expectedCosts)}`],
              ['Ganancia esperada', formatCOP(res.expectedProfit), true],
            ]}
          />
          {res.maxPrice === 0 ? <Notice kind="warn">Con ese precio de mercado no alcanzas el margen que quieres.</Notice> : null}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {res.marginType === 'percent' ? `Margen del ${res.marginValue} % sobre tu costo total (compra + gastos).` : `Margen de ${formatCOP(res.marginValue)} por equipo.`} Los descuentos se configuran en Configuración → Precios.
          </p>
        </Card>
      ) : (
        <p className="small muted">Escribe o elige el precio de mercado para calcular.</p>
      )}
    </Page>
  );
}
