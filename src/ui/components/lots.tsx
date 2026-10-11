import { useState } from 'react';
import {
  addTripCost,
  compareWithStock,
  daysBetween,
  formatCOP,
  formatDate,
  formatDateTime,
  getLastPricePaid,
  getPurchaseAddedCosts,
  getPurchasePriceHistory,
  listLots,
  listPurchasesOfDay,
  LOT_SOURCE_LABEL,
  newOpId,
  nowISO,
  previewPurchaseCost,
  priceChange,
  setProductCosting,
  voidExpense,
  type AllocationMethod,
  type AppDB,
  type ID,
  type LotView,
  type Product,
  type Purchase,
} from '../../core';
import { db, useAction, useLive } from '../store';
import { InfoTip } from './help';
import { CorrectedBadge, CorrectLotSheet, lotCorrectable, openLotCorrection } from './corrections';
import { Icon } from './Icon';
import { Badge, Card, confirmAction, DateTimeInput, Empty, Field, FormError, KV, MoneyInput, Notice, Segmented, Sheet, TextInput } from './ui';

/* ================= Lotes de un producto ================= */

/** Tarjeta de lotes (productos por cantidad): lo que tienes separado por precio de compra. */
export function LotsCard({ product, canOperate }: { product: Product; canOperate: boolean }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [fixing, setFixing] = useState<LotView | null>(null);
  const lots = useLive((d) => listLots(d, product.id, showEmpty), [product.id, showEmpty, product.qty, product.stockValue]);
  const act = useAction();
  const on = product.costing === 'lots';
  const knownQty = product.qty - product.unknownCostQty;
  const avg = knownQty > 0 ? Math.round(product.stockValue / knownQty) : null;

  const toggle = async () => {
    if (on) {
      const ok = await confirmAction({
        title: 'Usar costo promedio',
        message: (
          <>
            <p>Todas las existencias se juntan con un solo costo: {avg === null ? 'sin costo conocido' : `${formatCOP(avg)} c/u`}. El valor total no cambia.</p>
            <p className="small muted">Puedes volver a separarlas por precio de compra cuando quieras: la app las reconstruye con tu historial.</p>
          </>
        ),
        confirmText: 'Usar costo promedio',
      });
      if (ok) await act.run(() => setProductCosting(db, product.id, 'average'), 'Ahora usa costo promedio');
    } else {
      const ok = await confirmAction({
        title: 'Separar por precio de compra',
        message: (
          <>
            <p>La app separa lo que tienes según cada compra (con tu historial) y, al vender, saca primero lo más antiguo con su costo real.</p>
            <p className="small muted">El valor total de tus existencias no cambia.</p>
          </>
        ),
        confirmText: 'Separar en lotes',
      });
      if (ok) await act.run(() => setProductCosting(db, product.id, 'lots'), 'Separado por precio de compra');
    }
  };

  const distinct = new Set((lots ?? []).filter((l) => l.qty > 0 && l.unitCost !== null).map((l) => l.unitCost)).size;
  return (
    <Card
      title={
        <h2 className="with-tip">
          Por precio de compra <InfoTip k="lots" />
        </h2>
      }
    >
      <div className="stack">
        <label className="check">
          <input type="checkbox" checked={on} disabled={!canOperate || act.busy} onChange={() => void toggle()} data-testid="lots-toggle" /> Separar por precio de compra (lotes)
        </label>
        <FormError error={act.error} />
        {!on ? (
          <p className="small muted">
            Usa costo promedio{avg !== null ? `: ${formatCOP(avg)} c/u` : ''}. Si compraste a precios distintos, todo se mezcla en un solo costo.
          </p>
        ) : !lots ? null : lots.length === 0 ? (
          <Empty title="Sin existencias">
            <p className="small muted">Cada compra nueva crea su lote con su precio.</p>
          </Empty>
        ) : (
          <>
            <ul className="list wrap-sub" data-testid="lots-list">
              {lots.map((l, i) => (
                <li key={l.id}>
                  <div className="item" style={{ cursor: 'default' }}>
                    <span className="item-main">
                      <span className="item-title" style={{ display: 'block' }}>
                        {l.qty} disp. · {l.unitCost === null ? 'costo desconocido' : `${formatCOP(l.unitCost)} c/u`}
                      </span>
                      <span className="item-sub" style={{ display: 'block' }}>
                        {LOT_SOURCE_LABEL[l.source]}
                        {l.date ? ` del ${formatDate(l.date)} · ${daysBetween(l.date)} días` : ' · fecha desconocida'}
                        {l.supplierName ? ` · ${l.supplierName}` : ''}
                        {l.qtyIn !== l.qty ? ` · entraron ${l.qtyIn}` : ''}
                      </span>
                      {l.correctedAt ? (
                        <span style={{ display: 'block', marginTop: 4 }}>
                          <CorrectedBadge at={l.correctedAt} />
                        </span>
                      ) : null}
                    </span>
                    <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                      {i === 0 && l.qty > 0 ? <Badge kind="brand">Sale primero</Badge> : l.qty === 0 ? <Badge>Agotado</Badge> : null}
                      <span className="small money">{l.costKnown ? formatCOP(l.value) : '—'}</span>
                      {canOperate && lotCorrectable(l) ? (
                        <button type="button" className="btn sm" onClick={() => openLotCorrection(l, () => setFixing(l))} aria-label={`Corregir esta entrada (${l.qtyIn} u.)`} data-testid="lot-correct">
                          <Icon name="edit" /> Corregir
                        </button>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {distinct > 1 ? (
              <p className="tiny muted">Tienes {distinct} precios de compra distintos. Al vender sale primero el lote más antiguo, pero puedes elegir otro en la venta.</p>
            ) : null}
            <label className="check small">
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Ver lotes agotados
            </label>
          </>
        )}
      </div>
      {fixing ? <CorrectLotSheet lot={fixing} product={product} onClose={() => setFixing(null)} /> : null}
    </Card>
  );
}

/** Selector de lote para vender o sacar existencias. */
export function LotSelect({ productId, value, onChange, id, label = '¿De qué lote sale?' }: { productId: ID; value: ID | null; onChange: (v: ID | null) => void; id: string; label?: string }) {
  const lots = useLive((d) => listLots(d, productId), [productId]);
  if (!lots || lots.length < 2) return null;
  return (
    <Field label={label} htmlFor={id} hint="Si pides más de lo que tiene el lote, el resto sale del más antiguo.">
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Automático: el más antiguo primero</option>
        {lots.map((l) => (
          <option key={l.id} value={l.id}>
            {l.qty} disp. · {l.unitCost === null ? 'sin costo' : `${formatCOP(l.unitCost)} c/u`} · {l.date ? formatDate(l.date) : 'fecha desconocida'}
            {l.supplierName ? ` · ${l.supplierName}` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ================= Historial de precios de compra ================= */

function Change({ now, before }: { now: number; before: number }) {
  const c = priceChange(now, before);
  if (c.diff === 0) return <span className="muted">= igual</span>;
  const down = c.diff < 0;
  return (
    <span className={down ? 'ok-text' : 'bad-text'}>
      {down ? '▼' : '▲'} {c.pct === null ? '' : `${String(Math.abs(c.pct)).replace('.', ',')} %`} ({formatCOP(Math.abs(c.diff))} {down ? 'menos' : 'más'})
    </span>
  );
}

/** Lo que has pagado por este producto: últimas compras y el último precio de cada proveedor. */
export function PriceHistoryCard({ productId }: { productId: ID }) {
  const data = useLive(async (d) => ({ h: await getPurchasePriceHistory(d, productId, { limit: 8 }), lp: await getLastPricePaid(d, productId) }), [productId]);
  if (!data || !data.h.length) return null;
  const { h, lp } = data;
  return (
    <Card
      title={
        <h2 className="with-tip">
          Lo que has pagado <InfoTip k="priceHistory" />
        </h2>
      }
    >
      <ul className="list wrap-sub" data-testid="price-history">
        {h.map((x, i) => (
          <li key={x.lineId}>
            <a className="item" href={`#/compras/${x.purchaseId}`}>
              <span className="item-main">
                <span className="item-title" style={{ display: 'block' }}>
                  {formatCOP(x.unitPrice)} c/u × {x.qty}
                </span>
                <span className="item-sub" style={{ display: 'block' }}>
                  {formatDate(x.date)}
                  {x.supplierName ? ` · ${x.supplierName}` : ' · sin proveedor'}
                  {x.unitCost !== x.unitPrice ? ` · con gastos ${formatCOP(x.unitCost)}` : ''}
                </span>
              </span>
              <span className="item-side small">{h[i + 1] ? <Change now={x.unitPrice} before={h[i + 1].unitPrice} /> : null}</span>
            </a>
          </li>
        ))}
      </ul>
      {lp.bySupplier.length > 1 ? (
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <p className="small strong">Último precio por proveedor</p>
          {lp.bySupplier.map((s, i) => (
            <p key={s.supplierId ?? 'none'} className="small">
              {i === 0 ? '⭐ ' : ''}
              {s.supplierName || 'Sin proveedor'}: <strong>{formatCOP(s.last.unitPrice)}</strong> ({formatDate(s.last.date)})
              {s.count > 1 ? <span className="muted"> · entre {formatCOP(s.min)} y {formatCOP(s.max)}</span> : null}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/* ================= Al comprar: último precio y aviso de compra más barata ================= */

/** Aviso en la compra: cuánto pagaste la última vez y si compras más barato que lo que ya tienes. */
export function PurchaseHints({ productId, supplierId, unitCost }: { productId: ID; supplierId: ID | null; unitCost: number | null }) {
  const data = useLive(
    async (d) => ({
      lp: await getLastPricePaid(d, productId, supplierId),
      cmp: unitCost !== null && unitCost > 0 ? await compareWithStock(d, productId, unitCost) : null,
    }),
    [productId, supplierId, unitCost],
  );
  if (!data) return null;
  const { lp, cmp } = data;
  const last = lp.last;
  return (
    <div className="stack-sm" data-testid="purchase-hints">
      {last ? (
        <p className="small">
          La última vez pagaste <strong>{formatCOP(last.unitPrice)}</strong> c/u{last.supplierName ? ` a ${last.supplierName}` : ''} el {formatDate(last.date)}
          {unitCost !== null && unitCost > 0 ? (
            <>
              {' · '}
              <Change now={unitCost} before={last.unitCost} />
            </>
          ) : null}
        </p>
      ) : (
        <p className="tiny muted">Primera compra de este producto: desde ahora la app recuerda lo que pagas.</p>
      )}
      {lp.lastFromSupplier && last && lp.lastFromSupplier.purchaseId !== last.purchaseId ? (
        <p className="tiny muted">
          A este proveedor le pagaste {formatCOP(lp.lastFromSupplier.unitPrice)} el {formatDate(lp.lastFromSupplier.date)}.
        </p>
      ) : null}
      {cmp?.cheaper ? <CheaperNotice cmp={cmp} /> : null}
      {cmp?.moreExpensive ? (
        <Notice kind="info" title="Esta compra te sale más cara que lo que ya tienes">
          Lo que tienes te costó en promedio {formatCOP(cmp.avgCost)}. Revisa tu precio de venta para no ganar menos con estas unidades.
        </Notice>
      ) : null}
    </div>
  );
}

export function CheaperNotice({ cmp }: { cmp: Awaited<ReturnType<typeof compareWithStock>> }) {
  const pricier = cmp.items.filter((x) => x.diffPerUnit > 0);
  return (
    <Notice kind="warn" title="Ojo: compras más barato que lo que ya tienes">
      <p>
        {cmp.pricierQty === 1 ? 'Tu unidad anterior te costó' : `Tus ${cmp.pricierQty} unidades anteriores te costaron`} más:{' '}
        <strong>{formatCOP(cmp.extraTotal)}</strong> en total.
      </p>
      <ul className="tight-list">
        {pricier.slice(0, 4).map((x) => (
          <li key={x.lotId ?? x.unitId ?? 'avg'}>
            {x.code ? `${x.code}: ` : `${x.qty} a `}
            {formatCOP(x.unitCost)} c/u (+{formatCOP(x.diffPerUnit)}) → mínimo {formatCOP(x.minPrice)}
          </li>
        ))}
      </ul>
      <p className="tiny" style={{ marginTop: 6 }}>
        No bajes el precio de las anteriores por debajo de su mínimo solo porque ahora te salieron más baratas. Con lotes, la app separa cada precio y al vender sabes cuánto ganas de verdad.
      </p>
    </Notice>
  );
}

/* ================= Gastos agregados a una compra ================= */

/** Compras de un día con proveedor y productos (para elegir entre cuáles repartir un gasto). */
export async function purchasesOfDayView(d: AppDB, day: string) {
  const list = await listPurchasesOfDay(d, day);
  const names = new Map((await d.suppliers.toArray()).map((x) => [x.id, x.name]));
  const out = [];
  for (const p of list) {
    const lines = await d.purchaseLines.where('purchaseId').equals(p.id).toArray();
    const prods = await d.products.bulkGet(lines.map((l) => l.productId));
    const items = lines.map((l, i) => `${prods[i]?.name ?? 'Producto'} ×${l.quantity}`).join(', ');
    out.push({ p, supplier: p.supplierId ? names.get(p.supplierId) ?? '' : '', items });
  }
  return out;
}

const COST_CATEGORIES = ['Transporte', 'Pasajes', 'Comida del viaje', 'Envío', 'Parqueadero', 'Comisión', 'Otros'];

/** Agregar un gasto a una compra ya registrada (o repartirlo entre varias compras del día). */
export function AddPurchaseCostSheet({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState('Transporte');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState<string | null>(nowISO());
  const [allocation, setAllocation] = useState<AllocationMethod>('value');
  const [selected, setSelected] = useState<ID[]>([purchase.id]);
  const [opId] = useState(newOpId);
  const act = useAction();
  const day = useLive((d) => purchasesOfDayView(d, purchase.date), [purchase.id]);
  const preview = useLive(
    async (d) => ((amount ?? 0) > 0 && selected.length ? previewPurchaseCost(d, selected, amount!, allocation).catch(() => null) : null),
    [amount, allocation, selected.join(',')],
  );
  const toggle = (id: ID) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet
      title="Agregar gasto a la compra"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy || !selected.length}
          data-testid="add-cost-confirm"
          onClick={async () => {
            const r = await act.run(() => addTripCost(db, selected, { opId, date: date ?? '', amount: amount ?? 0, category, notes, allocation }), 'Gasto agregado');
            if (r !== undefined) onClose();
          }}
        >
          {act.busy ? 'Guardando…' : `Agregar ${formatCOP(amount ?? 0)}`}
        </button>
      }
    >
      <p className="small muted">Transporte, pasajes, comida del viaje… Lo que sigue en tu inventario sube de costo; lo que ya vendiste lleva su parte como gasto.</p>
      <div className="grid-2">
        <Field label="Valor" htmlFor="pc-amount" error={act.field === 'amount' ? act.error : null}>
          <MoneyInput id="pc-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
        </Field>
        <Field label="¿Qué fue?" htmlFor="pc-cat">
          <select id="pc-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {COST_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Fecha" htmlFor="pc-date">
        <DateTimeInput id="pc-date" value={date} onChange={setDate} />
      </Field>
      <Field label="Nota (opcional)" htmlFor="pc-notes">
        <TextInput id="pc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: bus ida y vuelta" />
      </Field>
      {day && day.length > 1 ? (
        <Field label="¿Entre qué compras se reparte?" hint="Compras del mismo día. Si fue un solo viaje, márcalas todas.">
          <div className="stack-sm">
            {day.map(({ p, supplier, items }) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /> {formatDateTime(p.date)} · {formatCOP(p.subtotal)}
                {supplier ? ` · ${supplier}` : ''}
                {items ? ` · ${items}` : ''}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label="Repartir">
        <Segmented label="Repartir" value={allocation} onChange={setAllocation} options={[['value', 'Según lo pagado'], ['units', 'Igual por unidad']]} />
      </Field>
      {preview ? <CostSplitView split={preview} /> : null}
      <FormError error={act.field === 'amount' ? null : act.error} />
    </Sheet>
  );
}

export function CostSplitView({ split }: { split: Awaited<ReturnType<typeof previewPurchaseCost>> }) {
  return (
    <div className="stack-sm" data-testid="cost-split">
      <KV
        rows={[
          [
            <span key="c" className="with-tip">
              Se suma al costo <InfoTip k="addedCost" />
            </span>,
            formatCOP(split.capitalized),
          ],
          ['Gasto (de lo ya vendido)', formatCOP(split.operating)],
        ]}
      />
      <ul className="tight-list tiny muted">
        {split.lines.map((l) => (
          <li key={l.lineId}>
            {l.productName}: {formatCOP(l.share)} → {l.inStockQty} de {l.quantity} en existencia
          </li>
        ))}
      </ul>
      {split.operating > 0 ? <p className="tiny muted">La parte de lo que ya vendiste se resta de la ganancia como gasto (esas ventas ya se cerraron con su costo).</p> : null}
    </div>
  );
}

/** Gastos agregados después a una compra, con opción de anularlos. */
export function PurchaseAddedCostsCard({ purchaseId, canEdit }: { purchaseId: ID; canEdit: boolean }) {
  const list = useLive((d) => getPurchaseAddedCosts(d, purchaseId), [purchaseId]);
  const act = useAction();
  if (!list || !list.length) return null;
  return (
    <Card title="Gastos agregados después">
      <FormError error={act.error} />
      <ul className="list wrap-sub">
        {list.map((g) => (
          <li key={g.groupId}>
            <div className="item" style={{ cursor: 'default' }}>
              <span className="item-main">
                <span className="item-title" style={{ display: 'block' }}>
                  {g.category} {g.notes ? <span className="muted small">· {g.notes}</span> : null}
                </span>
                <span className="item-sub" style={{ display: 'block' }}>
                  {formatDate(g.date)} · al costo {formatCOP(g.capitalized)} · gasto {formatCOP(g.operating)}
                  {g.shared ? ' · repartido con otras compras' : ''}
                </span>
              </span>
              <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                <span className="money strong">{formatCOP(g.amount)}</span>
                {g.status === 'voided' ? (
                  <Badge>⊘ Anulado</Badge>
                ) : canEdit ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: 'Anular gasto',
                        message: g.shared ? 'Se anula el gasto completo, también en las otras compras con las que se repartió.' : 'Se quita del costo y de los gastos.',
                        danger: true,
                        confirmText: 'Anular',
                      });
                      if (!ok) return;
                      const any = await db.expenses.filter((e) => e.costGroupId === g.groupId && e.status === 'active').first();
                      if (any) await act.run(() => voidExpense(db, any.id), 'Gasto anulado');
                    }}
                  >
                    Anular
                  </button>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

