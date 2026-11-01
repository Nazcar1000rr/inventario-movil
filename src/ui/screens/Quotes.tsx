import { useEffect, useState } from 'react';
import {
  createQuote,
  deleteQuote,
  formatCOP,
  formatDate,
  getQuote,
  listQuotes,
  quoteMessage,
  quoteState,
  quoteTotals,
  setQuoteCancelled,
  updateQuote,
  whatsappLink,
  whatsappNumber,
  type ID,
  type Quote,
  type QuoteLine,
} from '../../core';
import { InventorySelect, useDefaultInventory } from '../components/common';
import { Icon } from '../components/Icon';
import { PartyPicker, ProductPicker } from '../components/pickers';
import { ActionMenu, ask, Badge, Card, Chips, Empty, Field, FormError, IntInput, KV, Loading, MoneyInput, Notice, Page, Sheet, TextInput } from '../components/ui';
import { openExternal } from '../platform';
import { navigate } from '../router';
import { db, toast, useAction, useLive } from '../store';

const STATE_LABEL = { open: 'Vigente', expired: 'Vencida', sold: 'Vendida', cancelled: 'Cancelada' } as const;
const STATE_KIND = { open: 'ok', expired: 'warn', sold: 'brand', cancelled: 'bad' } as const;

const dayText = (day: string) => formatDate(new Date(`${day}T12:00:00`).toISOString());
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ======================= Lista ======================= */

export function QuotesScreen() {
  const quotes = useLive((d) => listQuotes(d));
  const [filter, setFilter] = useState<'open' | 'all' | 'sold' | 'closed'>('open');
  if (!quotes) return <Page title="Cotizaciones" back="/mas" help="quotes"><Loading /></Page>;
  const rows = quotes.filter((q) => {
    const s = quoteState(q);
    return filter === 'all' ? true : filter === 'open' ? s === 'open' : filter === 'sold' ? s === 'sold' : s === 'expired' || s === 'cancelled';
  });
  return (
    <Page title="Cotizaciones" back="/mas" help="quotes" actions={<a className="btn primary sm" href="#/cotizaciones/nueva" data-testid="new-quote" data-tour="quote-new"><Icon name="plus" /> Nueva</a>}>
      <Chips
        label="Mostrar"
        value={filter}
        onChange={setFilter}
        options={[
          ['open', 'Vigentes'],
          ['sold', 'Vendidas'],
          ['closed', 'Vencidas o canceladas'],
          ['all', 'Todas'],
        ]}
      />
      {rows.length === 0 ? (
        <Empty title={quotes.length ? 'Nada en esta lista' : 'Aún no tienes cotizaciones'}>
          {quotes.length ? null : <p className="small">Arma una con los productos, cantidades, descuento y hasta cuándo vale el precio. Luego la envías por WhatsApp y, si el cliente compra, la pasas a venta en un paso.</p>}
          <a className="btn primary" href="#/cotizaciones/nueva">Hacer una cotización</a>
        </Empty>
      ) : (
        <ul className="list" data-testid="quote-list">
          {rows.map((q) => {
            const st = quoteState(q);
            return (
              <li key={q.id}>
                <a className="list-item" href={`#/cotizaciones/${q.id}`}>
                  <div className="grow">
                    <strong>N.º {q.number}{q.customerName ? ` · ${q.customerName}` : ''}</strong>
                    <div className="small muted">
                      {q.lines.length} producto(s) · vale hasta el {dayText(q.validUntil)}
                    </div>
                  </div>
                  <div className="right">
                    <strong>{formatCOP(quoteTotals(q).total)}</strong>
                    <div><Badge kind={STATE_KIND[st]}>{STATE_LABEL[st]}</Badge></div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

/* ======================= Formulario ======================= */

interface FLine {
  key: string;
  productId: ID | null;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
}
let lineKey = 0;
const nextKey = () => `l${++lineKey}`;

export function QuoteFormScreen({ id }: { id?: ID }) {
  const [inv, setInv, invs] = useDefaultInventory(null);
  const existing = useLive(async (d) => (id ? (await getQuote(d, id)) ?? null : undefined), [id]);
  const [lines, setLines] = useState<FLine[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [customerId, setCustomerId] = useState<ID | null>(null);
  const [validUntil, setValidUntil] = useState(inDays(7));
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickingParty, setPickingParty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const act = useAction();

  useEffect(() => {
    if (!existing || loaded) return;
    setLines(existing.lines.map((l) => ({ key: nextKey(), productId: l.productId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })));
    setDiscount(existing.discount || null);
    setName(existing.customerName);
    setPhone(existing.customerPhone);
    setCustomerId(existing.customerId);
    setValidUntil(existing.validUntil);
    setNotes(existing.notes);
    if (existing.inventoryId) setInv(existing.inventoryId);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, loaded]);

  const setLine = (key: string, patch: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const clean: QuoteLine[] = lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }));
  const t = quoteTotals({ lines: clean, discount: discount ?? 0 });
  const current = invs?.find((i) => i.id === inv) ?? null;

  const save = async () => {
    const input = { inventoryId: inv || null, customerId, customerName: name, customerPhone: phone, validUntil, lines: clean, discount: discount ?? 0, notes };
    const q = await act.run(() => (id ? updateQuote(db, id, input) : createQuote(db, input)), id ? 'Cotización guardada' : 'Cotización creada');
    if (q) navigate(`/cotizaciones/${q.id}`, { replace: true });
  };

  if (id && existing === undefined) return <Page title="Cotización" back="/cotizaciones"><Loading /></Page>;
  if (id && existing === null) return <Page title="Cotización" back="/cotizaciones"><Empty title="La cotización no existe" /></Page>;

  return (
    <Page title={id ? `Editar cotización N.º ${existing?.number ?? ''}` : 'Nueva cotización'} back={id ? `/cotizaciones/${id}` : '/cotizaciones'} help="quotes">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Card title="Para quién">
          <div className="stack">
            <button type="button" className="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setPickingParty(true)}>
              <span className="ellipsis">{customerId ? `Comprador: ${name}` : 'Elegir de mis compradores (opcional)'}</span>
              <Icon name="chevron" size={18} />
            </button>
            <div className="grid-2">
              <Field label="Nombre" htmlFor="qt-name">
                <TextInput id="qt-name" value={name} onChange={(e) => { setName(e.target.value); setCustomerId(null); }} />
              </Field>
              <Field label="WhatsApp" htmlFor="qt-phone">
                <TextInput id="qt-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Productos" tour="quote-products">
          <div className="stack">
            <Field label="Inventario de donde eliges los productos" htmlFor="qt-inv">
              <InventorySelect id="qt-inv" value={inv} inventories={invs ?? []} onChange={setInv} />
            </Field>
            {lines.map((l, i) => (
              <div key={l.key} className="stack-sm" data-testid="quote-line">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="ellipsis">{l.name || `Producto ${i + 1}`}</strong>
                  <button type="button" className="icon-btn" aria-label={`Quitar ${l.name || `producto ${i + 1}`}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Icon name="x" />
                  </button>
                </div>
                {l.productId ? null : (
                  <Field label="Qué ofreces" htmlFor={`qt-n-${l.key}`}>
                    <TextInput id={`qt-n-${l.key}`} value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} />
                  </Field>
                )}
                <div className="grid-2">
                  <Field label="Cantidad" htmlFor={`qt-q-${l.key}`}>
                    <IntInput id={`qt-q-${l.key}`} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} />
                  </Field>
                  <Field label="Precio de cada uno" htmlFor={`qt-p-${l.key}`}>
                    <MoneyInput id={`qt-p-${l.key}`} value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} />
                  </Field>
                </div>
              </div>
            ))}
            <div className="grid-2">
              <button type="button" className="btn" disabled={!current} onClick={() => setPicking(true)} data-testid="quote-add-product">
                <Icon name="plus" /> Un producto mío
              </button>
              <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { key: nextKey(), productId: null, name: '', quantity: 1, unitPrice: null }])} data-testid="quote-add-free">
                <Icon name="plus" /> Otro concepto
              </button>
            </div>
          </div>
        </Card>
        <Card title="Descuento y validez" tour="quote-valid">
          <div className="stack">
            <div className="grid-2">
              <Field label="Descuento" htmlFor="qt-disc">
                <MoneyInput id="qt-disc" value={discount} onChange={setDiscount} />
              </Field>
              <Field label="Vale hasta" htmlFor="qt-valid">
                <input id="qt-valid" type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
            </div>
            <Field label="Notas para el cliente" htmlFor="qt-notes">
              <textarea id="qt-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <KV rows={[['Subtotal', formatCOP(t.subtotal)], ['Descuento', `−${formatCOP(t.discount)}`], ['Total', <strong key="t" data-testid="quote-total">{formatCOP(t.total)}</strong>, true]]} />
          </div>
        </Card>
        <FormError error={act.error} />
        <button className="btn primary block" disabled={act.busy} data-testid="save-quote">{act.busy ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar cotización'}</button>
      </form>
      {picking && current ? (
        <ProductPicker
          inventoryId={current.id}
          mode="sale"
          invMode={current.mode}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setLines((ls) => [...ls, { key: nextKey(), productId: p.id, name: p.name, quantity: 1, unitPrice: p.salePrice }]);
            setPicking(false);
          }}
        />
      ) : null}
      {pickingParty ? (
        <PartyPicker
          type="customer"
          onClose={() => setPickingParty(false)}
          onPick={async (cid, cname) => {
            setPickingParty(false);
            setCustomerId(cid);
            setName(cname);
            if (cid) setPhone((await db.customers.get(cid))?.phone ?? '');
          }}
        />
      ) : null}
    </Page>
  );
}

/* ======================= Detalle ======================= */

export function QuoteDetailScreen({ id }: { id: ID }) {
  const q = useLive(async (d) => (await getQuote(d, id)) ?? null, [id]);
  const biz = useLive(async (d) => {
    const q2 = await getQuote(d, id);
    return q2?.inventoryId ? (await d.inventories.get(q2.inventoryId))?.name ?? '' : '';
  }, [id]);
  const [wa, setWa] = useState(false);
  const act = useAction();
  if (q === undefined) return <Page title="Cotización" back="/cotizaciones"><Loading /></Page>;
  if (q === null) return <Page title="Cotización" back="/cotizaciones"><Empty title="La cotización no existe" /></Page>;
  const st = quoteState(q);
  const t = quoteTotals(q);
  const remove = async () => {
    const r = await ask({ title: 'Eliminar cotización', danger: true, message: <p>Se borra para siempre. No afecta tus ventas ni tu inventario.</p>, confirmText: 'Eliminar' });
    if (r.ok) {
      await deleteQuote(db, id);
      toast('Cotización eliminada');
      navigate('/cotizaciones', { replace: true });
    }
  };
  return (
    <Page
      title={`Cotización N.º ${q.number}`}
      subtitle={<Badge kind={STATE_KIND[st]}>{STATE_LABEL[st]}</Badge>}
      back="/cotizaciones"
      help="quotes"
      actions={
        <ActionMenu
          title="Cotización"
          actions={[
            { label: 'Editar', icon: 'edit', hidden: q.status === 'sold', onSelect: () => navigate(`/cotizaciones/${id}/editar`) },
            { label: q.status === 'cancelled' ? 'Volver a activar' : 'Cancelar cotización', icon: 'ban', hidden: q.status === 'sold', onSelect: () => void act.run(() => setQuoteCancelled(db, id, q.status !== 'cancelled'), 'Listo') },
            { label: 'Eliminar', icon: 'trash', danger: true, onSelect: remove },
          ]}
        />
      }
    >
      <Card title={q.customerName || 'Sin nombre'}>
        <KV
          rows={[
            ['Fecha', formatDate(q.date)],
            ['Vale hasta', dayText(q.validUntil)],
            ...(q.customerPhone ? ([['WhatsApp', q.customerPhone]] as [string, string][]) : []),
          ]}
        />
      </Card>
      <Card title="Productos">
        <ul className="list" data-testid="quote-lines">
          {q.lines.map((l, i) => (
            <li key={i} className="list-item">
              <div className="grow">
                <strong>{l.name}</strong>
                <div className="small muted">{l.quantity} × {formatCOP(l.unitPrice)}</div>
              </div>
              <strong>{formatCOP(l.quantity * l.unitPrice)}</strong>
            </li>
          ))}
        </ul>
        <KV rows={[['Subtotal', formatCOP(t.subtotal)], ...(t.discount > 0 ? ([['Descuento', `−${formatCOP(t.discount)}`]] as [string, string][]) : []), ['Total', <strong key="t" data-testid="quote-detail-total">{formatCOP(t.total)}</strong>, true]]} />
        {q.notes ? <p className="small muted">{q.notes}</p> : null}
      </Card>
      {st === 'expired' ? <Notice kind="warn">La fecha de validez ya pasó. Si el cliente aún quiere comprar, edita la cotización y pon una fecha nueva.</Notice> : null}
      {q.status === 'sold' ? (
        <Notice kind="ok" title="Ya se vendió">{q.saleId ? <a href={`#/ventas/${q.saleId}`}>Ver la venta</a> : null}</Notice>
      ) : (
        <div className="stack">
          <button className="btn primary block" onClick={() => navigate(`/ventas/nueva?cotizacion=${q.id}`)} disabled={q.status === 'cancelled'} data-testid="quote-to-sale">
            <Icon name="check" /> Convertir en venta
          </button>
          <button className="btn block" onClick={() => setWa(true)} data-testid="quote-whatsapp">
            <Icon name="share" /> Enviar por WhatsApp
          </button>
        </div>
      )}
      <FormError error={act.error} />
      {wa ? <QuoteWhatsApp q={q} business={biz ?? ''} onClose={() => setWa(false)} /> : null}
    </Page>
  );
}

function QuoteWhatsApp({ q, business, onClose }: { q: Quote; business: string; onClose: () => void }) {
  const [phone, setPhone] = useState(q.customerPhone);
  const [text, setText] = useState(() => quoteMessage(q, business, formatCOP, dayText));
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      title="Enviar por WhatsApp"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          data-testid="open-whatsapp"
          onClick={() => {
            const num = whatsappNumber(phone);
            if (!num) return setError('Escribe un número de WhatsApp válido (10 dígitos, o con el indicativo del país).');
            openExternal(whatsappLink(num, text));
            onClose();
          }}
        >
          Abrir WhatsApp
        </button>
      }
    >
      <div className="stack">
        <p className="small">La app no envía nada: abre el chat con el mensaje listo y tú lo envías desde WhatsApp.</p>
        <Field label="Número de WhatsApp" htmlFor="qw-phone" error={error}>
          <TextInput id="qw-phone" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setError(null); }} />
        </Field>
        <Field label="Mensaje" htmlFor="qw-text">
          <textarea id="qw-text" className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
