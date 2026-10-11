import { useEffect, useMemo, useState } from 'react';
import {
  correctLot,
  correctPurchase,
  correctUnitCost,
  errorMessage,
  formatCOP,
  formatDate,
  LOT_SOURCE_LABEL,
  newOpId,
  previewLotCorrection,
  previewPurchaseCorrection,
  previewUnitCostCorrection,
  updateProduct,
  type CorrectionEffect,
  type ID,
  type LotView,
  type Product,
  type PurchaseCorrectionInput,
  type PurchaseCorrectionPreview,
  type Unit,
} from '../../core';
import { db, useAction, useLive } from '../store';
import { navigate } from '../router';
import { Badge, Chips, Field, FormError, IntInput, KV, MoneyInput, Notice, Sheet, TextInput } from './ui';

/* ================= Utilidades ================= */

/** "+$ 7.500" / "−$ 7.500" */
export function deltaCOP(v: number): string {
  if (v === 0) return formatCOP(0);
  return `${v > 0 ? '+' : '−'}${formatCOP(Math.abs(v))}`;
}

function arrow(a: string, b: string) {
  return a === b ? (
    b
  ) : (
    <span>
      <span className="muted">{a}</span> → <strong>{b}</strong>
    </span>
  );
}

/** Calcula una vista previa (sin guardar) cada vez que cambian los datos. */
function usePreview<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): { data: T | null; error: string | null } {
  const [st, setSt] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) {
      setSt({ data: null, error: null });
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      fn().then(
        (data) => alive && setSt({ data, error: null }),
        (e) => alive && setSt({ data: null, error: errorMessage(e) }),
      );
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

/** Lo que cambia con la corrección: costo por unidad, existencias, ventas recalculadas y ganancia. */
export function EffectView({ e, title }: { e: CorrectionEffect; title?: string }) {
  const rows: [React.ReactNode, React.ReactNode][] = [];
  if (e.oldQty !== e.newQty) rows.push(['Cantidad', arrow(String(e.oldQty), String(e.newQty))]);
  if (e.oldTotal !== e.newTotal) rows.push(['Costo total', arrow(formatCOP(e.oldTotal), formatCOP(e.newTotal))]);
  rows.push(['Costo por unidad', arrow(e.oldUnitCost === null ? 'desconocido' : formatCOP(e.oldUnitCost), e.newUnitCost === null ? 'desconocido' : formatCOP(e.newUnitCost))]);
  if (e.stockQtyDelta) rows.push(['Existencias', `${e.stockQtyDelta > 0 ? '+' : ''}${e.stockQtyDelta}`]);
  if (e.stockValueDelta) rows.push(['Valor de lo que tienes', deltaCOP(e.stockValueDelta)]);
  if (e.removedUnits.length) rows.push(['Se quitan', e.removedUnits.join(', ')]);
  if (e.addedUnits) rows.push(['Se agregan', `${e.addedUnits} equipo(s)`]);
  if (e.writeOffDelta) rows.push(['Pérdida por bajas', deltaCOP(e.writeOffDelta)]);
  return (
    <div className="stack-sm">
      {title ? <p className="small strong">{title}</p> : null}
      <KV rows={rows} />
      {e.sales.length ? (
        <div className="stack-sm">
          <p className="small strong">
            {e.sales.length === 1 ? 'Se recalcula 1 venta' : `Se recalculan ${e.sales.length} ventas`}
          </p>
          <ul className="small plain-list">
            {e.sales.slice(0, 6).map((s) => (
              <li key={s.saleLineId}>
                Venta del {formatDate(s.date)} ({s.qty} u.): costo {s.completed ? 'desconocido' : formatCOP(s.oldCogs)} → {formatCOP(s.newCogs)}
              </li>
            ))}
            {e.sales.length > 6 ? <li className="muted">… y {e.sales.length - 6} más</li> : null}
          </ul>
        </div>
      ) : null}
      {e.profitDelta ? (
        <p className={`small strong ${e.profitDelta > 0 ? 'delta-up' : 'delta-down'}`}>
          Tu ganancia {e.profitDelta > 0 ? 'sube' : 'baja'} {formatCOP(Math.abs(e.profitDelta))}
        </p>
      ) : null}
    </div>
  );
}

/* ================= Corregir una compra ================= */

interface LineDraft {
  qty: number | null;
  total: number | null;
  unit: number | null;
  mode: 'total' | 'unit';
  remove: ID[];
  add: number | null;
}

/**
 * Hoja para corregir una compra ya registrada: cantidades, lo que pagaste (por unidad o total), equipos que no
 * venían o que faltaron y los gastos de la compra. Muestra antes de guardar lo que cambia.
 */
export function CorrectPurchaseSheet({ purchaseId, focusLineId, onClose }: { purchaseId: ID; focusLineId?: ID | null; onClose: () => void }) {
  const data = useLive(
    async (d) => {
      const p = await d.purchases.get(purchaseId);
      if (!p) return null;
      const lines = await d.purchaseLines.where('purchaseId').equals(purchaseId).toArray();
      const products = await d.products.bulkGet(lines.map((l) => l.productId));
      const units = await d.units.where('purchaseId').equals(purchaseId).toArray();
      return { p, lines, products, units };
    },
    [purchaseId],
  );
  const [drafts, setDrafts] = useState<Record<ID, LineDraft> | null>(null);
  const [extra, setExtra] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();

  useEffect(() => {
    if (!data || drafts) return;
    const init: Record<ID, LineDraft> = {};
    data.lines.forEach((l, i) => {
      // Por cantidad: lo normal es que pagaste un total por el paquete. Por unidad (equipos): cada uno tiene su precio.
      const mode = data.products[i]?.tracking === 'unit' ? 'unit' : 'total';
      init[l.id] = { qty: l.quantity, total: l.price, unit: Math.round(l.price / l.quantity), mode, remove: [], add: 0 };
    });
    setDrafts(init);
    setExtra(data.p.extraCosts);
  }, [data, drafts]);

  const input = useMemo<PurchaseCorrectionInput | null>(() => {
    if (!data || !drafts) return null;
    return {
      opId,
      extraCosts: extra ?? 0,
      reason,
      lines: data.lines.map((l, i) => {
        const dr = drafts[l.id];
        const tracking = data.products[i]?.tracking;
        return {
          lineId: l.id,
          quantity: tracking === 'quantity' ? dr.qty ?? l.quantity : undefined,
          price: dr.total ?? 0,
          removeUnitIds: dr.remove,
          addUnits: dr.add ?? 0,
        };
      }),
    };
  }, [data, drafts, extra, reason, opId]);
  const preview = usePreview<PurchaseCorrectionPreview>(() => previewPurchaseCorrection(db, purchaseId, input!), [JSON.stringify(input)], !!input);

  if (data === null) return null;
  if (!data || !drafts) return null;
  const { p, lines, products, units } = data;
  const ordered = focusLineId ? [...lines].sort((a, b) => (a.id === focusLineId ? -1 : b.id === focusLineId ? 1 : 0)) : lines;

  const setLine = (id: ID, patch: Partial<LineDraft>) => setDrafts((cur) => ({ ...cur!, [id]: { ...cur![id], ...patch } }));
  const effectiveQty = (lineId: ID, tracking: string | undefined, dr: LineDraft) => {
    if (tracking === 'quantity') return dr.qty ?? 0;
    const l = lines.find((x) => x.id === lineId)!;
    return l.unitIds.length - dr.remove.length + (dr.add ?? 0);
  };
  /** Cuando cambia la cantidad: se conserva lo pagado en total o el precio por unidad, según lo que elegiste. */
  const onQty = (lineId: ID, tracking: string | undefined, next: LineDraft) => {
    const q = effectiveQty(lineId, tracking, next);
    if (q <= 0) return setLine(lineId, next);
    if (next.mode === 'unit') setLine(lineId, { ...next, total: (next.unit ?? 0) * q });
    else setLine(lineId, { ...next, unit: Math.round((next.total ?? 0) / q) });
  };

  const save = async () => {
    if (!input) return;
    const r = await act.run(() => correctPurchase(db, purchaseId, input), 'Compra corregida');
    if (r !== undefined) {
      setOpId(newOpId());
      onClose();
    }
  };
  const pv = preview.data;

  return (
    <Sheet
      title="Corregir compra"
      onClose={onClose}
      full
      footer={
        <button className="btn primary block" disabled={act.busy || !pv?.changed || !!preview.error} onClick={() => void save()} data-testid="save-correction">
          Guardar corrección
        </button>
      }
    >
      <p className="small muted">
        Compra del {formatDate(p.date)}. Corrige lo que digitaste mal: la app ajusta tus existencias y recalcula lo que ya vendiste de esta mercancía. Nada se borra: queda en el historial como «Corrección».
      </p>
      {ordered.map((l) => {
        const i = lines.indexOf(l);
        const prod = products[i];
        const dr = drafts[l.id];
        const q = effectiveQty(l.id, prod?.tracking, dr);
        const changedQty = q !== l.quantity;
        const lineUnits = l.unitIds.map((id) => units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
        return (
          <fieldset key={l.id} className="card stack-sm" data-testid={`correct-line-${i}`} style={{ padding: 12 }}>
            <legend className="strong">{prod?.name ?? 'Producto'}</legend>
            {prod?.tracking === 'quantity' ? (
              <Field label="Cantidad que llegó" htmlFor={`cl-q-${i}`} hint={`Registraste ${l.quantity}.`}>
                <IntInput id={`cl-q-${i}`} min={1} value={dr.qty} onChange={(v) => onQty(l.id, prod?.tracking, { ...dr, qty: v })} />
              </Field>
            ) : (
              <div className="stack-sm">
                <p className="small">
                  {l.unitIds.length} equipo(s) en esta compra. Marca los que <strong>no venían</strong>:
                </p>
                <ul className="plain-list stack-sm">
                  {lineUnits.map((u) => {
                    const inStock = u.status === 'available' || u.status === 'in_review' || u.status === 'damaged';
                    const blocked = !inStock || u.cycle > 1 || u.extraCost > 0;
                    return (
                      <li key={u.id}>
                        <label className="check small">
                          <input
                            type="checkbox"
                            disabled={blocked}
                            checked={dr.remove.includes(u.id)}
                            onChange={(e) => onQty(l.id, prod?.tracking, { ...dr, remove: e.target.checked ? [...dr.remove, u.id] : dr.remove.filter((x) => x !== u.id) })}
                            data-testid={`remove-unit-${u.code}`}
                          />{' '}
                          {u.code}
                          {u.imei ? ` · IMEI …${u.imei.slice(-4)}` : ''}
                          {blocked ? <span className="muted"> · {inStock ? 'tiene costos agregados' : 'ya salió del inventario'}</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <Field label="¿Faltó registrar equipos?" htmlFor={`cl-add-${i}`} hint="La app los agrega con el mismo costo; luego completas el IMEI, el color y lo demás.">
                  <IntInput id={`cl-add-${i}`} value={dr.add} onChange={(v) => onQty(l.id, prod?.tracking, { ...dr, add: v === null ? null : Math.min(v, 50) })} />
                </Field>
              </div>
            )}
            {changedQty ? (
              <Field label="¿Qué pasa con lo que pagaste?">
                <Chips
                  wrap
                  label="Lo que pagaste"
                  value={dr.mode}
                  onChange={(mode) => onQty(l.id, prod?.tracking, { ...dr, mode })}
                  options={[
                    ['total', 'Pagué lo mismo en total'],
                    ['unit', 'Cada una costó lo mismo'],
                  ]}
                />
              </Field>
            ) : null}
            <div className="grid-2">
              <Field label="Precio por unidad" htmlFor={`cl-u-${i}`}>
                <MoneyInput id={`cl-u-${i}`} value={dr.unit} onChange={(v) => setLine(l.id, { unit: v, total: (v ?? 0) * q, mode: 'unit' })} />
              </Field>
              <Field label="Total pagado" htmlFor={`cl-t-${i}`}>
                <MoneyInput id={`cl-t-${i}`} value={dr.total} onChange={(v) => setLine(l.id, { total: v, unit: q > 0 ? Math.round((v ?? 0) / q) : dr.unit, mode: 'total' })} />
              </Field>
            </div>
            {q > 0 && dr.total !== null && dr.total % q !== 0 ? <p className="tiny muted">El total no se divide exacto: unas unidades quedan con $1 más que otras.</p> : null}
          </fieldset>
        );
      })}
      <Field label="Gastos de la compra (transporte, envío…)" htmlFor="cl-extra" hint="Se reparten entre los productos de esta compra.">
        <MoneyInput id="cl-extra" value={extra} onChange={setExtra} />
      </Field>
      <Field label="Motivo (opcional)" htmlFor="cl-reason">
        <TextInput id="cl-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: me equivoqué al digitar" />
      </Field>
      <div className="stack" data-testid="correction-preview" aria-live="polite">
        {preview.error ? (
          <Notice kind="bad" title="Así no se puede corregir">
            {preview.error}
          </Notice>
        ) : pv && !pv.changed ? (
          <p className="small muted">Cambia una cantidad o un valor para ver qué se corrige.</p>
        ) : pv ? (
          <>
            <Notice kind={pv.profitDelta < 0 ? 'warn' : 'info'} title="Esto es lo que cambia">
              <KV
                rows={[
                  ['Total de la compra', arrow(formatCOP(pv.oldTotal), formatCOP(pv.newTotal))],
                  ...(pv.debt ? ([['Deuda de la compra', arrow(formatCOP(pv.debt.oldPrincipal), formatCOP(pv.debt.newPrincipal))]] as [React.ReactNode, React.ReactNode][]) : []),
                  ...(pv.oldTotal !== pv.newTotal && !pv.debt && p.paymentSource === 'cash'
                    ? ([['La caja', pv.newTotal > pv.oldTotal ? `baja ${formatCOP(pv.newTotal - pv.oldTotal)}` : `sube ${formatCOP(pv.oldTotal - pv.newTotal)}`]] as [React.ReactNode, React.ReactNode][])
                    : []),
                  ['Ventas recalculadas', String(pv.salesAffected)],
                  ['Cambio en tu ganancia', deltaCOP(pv.profitDelta)],
                ]}
              />
            </Notice>
            {pv.lines.map((e) => (
              <EffectView key={e.lineId ?? e.productId} e={e} title={e.productName} />
            ))}
          </>
        ) : null}
      </div>
      <FormError error={act.error} />
    </Sheet>
  );
}

/* ================= Corregir una entrada (lote) ================= */

/** Botón "Corregir" de un lote: los de compra se corrigen en la compra; los demás, aquí. */
export function lotCorrectable(l: Pick<LotView, 'source' | 'costKnown' | 'purchaseId'>): boolean {
  if (l.source === 'purchase') return !!l.purchaseId;
  if (l.source === 'return') return false;
  if (l.source === 'opening') return !l.costKnown;
  return true;
}

export function openLotCorrection(l: LotView, open: () => void) {
  if (l.source === 'purchase' && l.purchaseId) navigate(`/compras/${l.purchaseId}?corregir=${l.purchaseLineId ?? '1'}`);
  else open();
}

export function CorrectLotSheet({ lot, product, onClose }: { lot: LotView; product: Product; onClose: () => void }) {
  const [qty, setQty] = useState<number | null>(lot.qtyIn);
  const [cost, setCost] = useState<number | null>(lot.costKnown ? Math.round(lot.valueIn / lot.qtyIn) : null);
  const [reason, setReason] = useState('');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  const opening = lot.source === 'opening';
  const input = { opId, quantity: qty ?? lot.qtyIn, unitCost: cost === null ? (lot.costKnown ? undefined : null) : cost, reason };
  const preview = usePreview(() => previewLotCorrection(db, lot.id, input), [qty, cost], qty !== null && qty > 0);
  const e = preview.data;
  const changed = !!e && (e.oldQty !== e.newQty || e.oldTotal !== e.newTotal);
  return (
    <Sheet
      title="Corregir entrada"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy || !changed || !!preview.error}
          data-testid="save-lot-correction"
          onClick={async () => {
            const r = await act.run(() => correctLot(db, lot.id, input), 'Corrección guardada');
            if (r !== undefined) {
              setOpId(newOpId());
              onClose();
            }
          }}
        >
          Guardar corrección
        </button>
      }
    >
      <p className="small muted">
        {product.name} · {LOT_SOURCE_LABEL[lot.source]}
        {lot.date ? ` del ${formatDate(lot.date)}` : ''}. Lo que ya vendiste de aquí se recalcula con el costo correcto.
      </p>
      <Field label="Cantidad que entró" htmlFor="lc-q" hint={opening ? 'En las existencias anteriores solo se puede completar el costo.' : `Registraste ${lot.qtyIn}. Ya salieron ${lot.qtyIn - lot.qty}.`}>
        {opening ? <p className="strong">{lot.qtyIn}</p> : <IntInput id="lc-q" min={1} value={qty} onChange={setQty} />}
      </Field>
      <Field label="Costo por unidad" htmlFor="lc-c" hint={lot.costKnown ? undefined : 'Si todavía no lo sabes, déjalo vacío.'}>
        <MoneyInput id="lc-c" value={cost} onChange={setCost} focusFirst={!lot.costKnown} />
      </Field>
      <Field label="Motivo (opcional)" htmlFor="lc-r">
        <TextInput id="lc-r" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Ej.: me equivoqué al digitar" />
      </Field>
      <div data-testid="correction-preview" aria-live="polite">
        {preview.error ? (
          <Notice kind="bad" title="Así no se puede corregir">
            {preview.error}
          </Notice>
        ) : e && changed ? (
          <EffectView e={e} />
        ) : null}
      </div>
      <FormError error={act.error} />
    </Sheet>
  );
}

/* ================= Corregir el costo de un equipo de stock existente ================= */

export function CorrectUnitCostSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [cost, setCost] = useState<number | null>(unit.baseCost);
  const [reason, setReason] = useState('');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  const input = { opId, cost: cost ?? 0, reason };
  const preview = usePreview(() => previewUnitCostCorrection(db, unit.id, input), [cost], cost !== null);
  const e = preview.data;
  const changed = cost !== null && cost !== unit.baseCost;
  return (
    <Sheet
      title={unit.baseCost === null ? 'Completar costo' : 'Corregir costo'}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy || !changed || !!preview.error}
          data-testid="save-unit-cost"
          onClick={async () => {
            const r = await act.run(() => correctUnitCost(db, unit.id, input), 'Costo guardado');
            if (r !== undefined) {
              setOpId(newOpId());
              onClose();
            }
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Costo de adquisición" htmlFor="uc-cost">
        <MoneyInput id="uc-cost" value={cost} onChange={setCost} />
      </Field>
      {unit.status === 'sold' ? <p className="small muted">Ya está vendido: se recalcula la ganancia de esa venta.</p> : null}
      <Field label="Motivo (opcional)" htmlFor="uc-r">
        <TextInput id="uc-r" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Ej.: me equivoqué al digitar" />
      </Field>
      <div data-testid="correction-preview" aria-live="polite">
        {preview.error ? (
          <Notice kind="bad" title="Así no se puede corregir">
            {preview.error}
          </Notice>
        ) : e && changed ? (
          <EffectView e={e} />
        ) : null}
      </div>
      <FormError error={act.error} />
    </Sheet>
  );
}

/* ================= Precio de venta ================= */

/** Cambiar el precio al que vendes un producto (precio sugerido al vender). */
export function SalePriceSheet({ product, avgCost, onClose }: { product: Product; avgCost: number | null; onClose: () => void }) {
  const [price, setPrice] = useState<number | null>(product.salePrice);
  const act = useAction();
  const margin = price !== null && avgCost !== null ? price - avgCost : null;
  return (
    <Sheet
      title="Precio de venta"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy || price === product.salePrice}
          data-testid="save-sale-price"
          onClick={async () => {
            const r = await act.run(() => updateProduct(db, product.id, { salePrice: price }).then(() => true), 'Precio guardado');
            if (r) onClose();
          }}
        >
          Guardar precio
        </button>
      }
    >
      <p className="small muted">{product.name}. Es el precio que aparece al vender; en cada venta lo puedes cambiar.</p>
      <Field label="¿A cómo lo vendes?" htmlFor="sp-price" hint={product.salePrice !== null ? `Antes: ${formatCOP(product.salePrice)}` : 'Todavía no tenía precio.'}>
        <MoneyInput id="sp-price" value={price} onChange={setPrice} />
      </Field>
      {margin !== null ? (
        <p className={`small ${margin >= 0 ? '' : 'delta-down'}`}>
          {margin >= 0 ? `Ganarías ${formatCOP(margin)} por unidad sobre tu costo promedio (${formatCOP(avgCost)}).` : `Ojo: perderías ${formatCOP(-margin)} por unidad: tu costo promedio es ${formatCOP(avgCost)}.`}
        </p>
      ) : null}
      {product.salePrice !== null ? (
        <button type="button" className="btn sm" onClick={() => setPrice(null)}>
          Quitar el precio
        </button>
      ) : null}
      <FormError error={act.error} />
    </Sheet>
  );
}

/** Insignia "Corregida" para compras y lotes. */
export function CorrectedBadge({ at }: { at?: string | null }) {
  if (!at) return null;
  return <Badge kind="info">✎ Corregida el {formatDate(at)}</Badge>;
}
