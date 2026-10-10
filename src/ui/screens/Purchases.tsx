import { useEffect, useMemo, useState } from 'react';
import {
  createPurchase,
  formatCOP,
  formatDate,
  formatDateTime,
  newOpId,
  nowISO,
  previewPurchase,
  TRACKING_LABEL,
  updatePurchaseInfo,
  voidPurchase,
  type AllocationMethod,
  type ID,
  type Product,
} from '../../core';
import { InventorySelect, PAYMENT_METHODS, useDefaultInventory } from '../components/common';
import { Icon } from '../components/Icon';
import { PartyField, ProductPicker } from '../components/pickers';
import {
  ActionMenu,
  ask,
  Card,
  DateTimeInput,
  Empty,
  Field,
  FormError,
  IntInput,
  KV,
  Loading,
  MoneyInput,
  Notice,
  Page,
  Segmented,
  Sheet,
  TextInput,
} from '../components/ui';
import { navigate } from '../router';
import { db, useAction, useLive } from '../store';
import { UnitDetailFields, type UnitDetailValue } from './Products';

interface LineState {
  key: string;
  product: Product | null;
  qty: number | null;
  priceMode: 'unit' | 'total';
  unitPrice: number | null;
  totalPrice: number | null;
  details: Record<number, UnitDetailValue>;
}

const newLine = (product: Product | null = null): LineState => ({
  key: newOpId(),
  product,
  qty: 1,
  priceMode: 'unit',
  unitPrice: null,
  totalPrice: null,
  details: {},
});

function linePrice(l: LineState): number | null {
  if (l.priceMode === 'total') return l.totalPrice;
  if (l.unitPrice === null || l.qty === null) return null;
  return l.unitPrice * l.qty;
}

export function PurchaseFormScreen({ inventoryId, productId }: { inventoryId: string | null; productId: string | null }) {
  const [inv, setInv, invs] = useDefaultInventory(inventoryId);
  const current = invs?.find((i) => i.id === inv) ?? null;
  const pro = current?.mode === 'pro';
  const [supplierId, setSupplierId] = useState<ID | null>(null);
  const [date, setDate] = useState<string | null>(nowISO());
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [extra, setExtra] = useState<number | null>(null);
  const [allocation, setAllocation] = useState<AllocationMethod>('value');
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opId, setOpId] = useState(newOpId);
  const [localError, setLocalError] = useState<string | null>(null);
  const act = useAction();

  const initialProduct = useLive(async (d) => (productId ? await d.products.get(productId) : null), [productId]);
  useEffect(() => {
    if (initialProduct && initialProduct.inventoryId === inv) setLines((ls) => (ls.length === 1 && !ls[0].product ? [{ ...ls[0], product: initialProduct, unitPrice: null }] : ls));
  }, [initialProduct, inv]);

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const ready = lines.every((l) => l.product && l.qty && linePrice(l) !== null);
  const preview = useMemo(
    () => (ready ? previewPurchase(lines.map((l) => ({ productId: l.product!.id, quantity: l.qty!, price: linePrice(l)! })), extra ?? 0, allocation) : null),
    [ready, lines, extra, allocation],
  );
  const subtotal = lines.reduce((a, l) => a + (linePrice(l) ?? 0), 0);
  const total = subtotal + (extra ?? 0);

  const validate = (): boolean => {
    if (!current) return setErr('Seleccione el inventario de destino.');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.product) return setErr(`Línea ${i + 1}: elija un producto.`);
      if (!l.qty) return setErr(`Línea ${i + 1}: ingrese la cantidad.`);
      if (linePrice(l) === null) return setErr(`Línea ${i + 1}: ingrese el precio pagado.`);
    }
    setLocalError(null);
    return true;
  };
  function setErr(m: string): false {
    setLocalError(m);
    return false;
  }

  const submit = async () => {
    const p = await act.run(
      () =>
        createPurchase(db, {
          opId,
          inventoryId: inv,
          supplierId,
          date: date ?? '',
          paymentMethod: method,
          notes,
          extraCosts: extra ?? 0,
          allocation,
          lines: lines.map((l) => ({
            productId: l.product!.id,
            quantity: l.qty!,
            price: linePrice(l)!,
            units: l.product!.tracking === 'unit' ? Array.from({ length: l.qty! }, (_, k) => l.details[k] ?? {}) : undefined,
          })),
        }),
      'Compra registrada',
    );
    setConfirming(false);
    if (p) {
      setOpId(newOpId());
      navigate(`/compras/${p.id}`, { replace: true });
    }
  };

  return (
    <Page title="Registrar compra" back={inv ? `/inventarios/${inv}` : '/'}>
      {!invs ? (
        <Loading />
      ) : invs.filter((i) => !i.archived).length === 0 ? (
        <Empty title="Primero cree un inventario">
          <a className="btn primary" href="#/inventarios">
            Ir a inventarios
          </a>
        </Empty>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) setConfirming(true);
          }}
        >
          <Field label="Inventario de destino" htmlFor="pu-inv">
            <InventorySelect
              id="pu-inv"
              value={inv}
              inventories={invs}
              onChange={(v) => {
                setInv(v);
                setLines([newLine()]);
              }}
            />
          </Field>
          <Field label="Fecha y hora" htmlFor="pu-date" error={act.field === 'date' ? act.error : null}>
            <DateTimeInput id="pu-date" value={date} onChange={setDate} invalid={act.field === 'date'} />
          </Field>

          {lines.map((l, i) => {
            const pv = preview?.[i];
            return (
              <Card
                key={l.key}
                title={<h2>Producto {lines.length > 1 ? i + 1 : ''}</h2>}
                action={
                  lines.length > 1 ? (
                    <button type="button" className="icon-btn" aria-label={`Quitar producto ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                      <Icon name="x" />
                    </button>
                  ) : undefined
                }
              >
                <div className="stack">
                  <button type="button" className="btn block" style={{ justifyContent: 'space-between' }} disabled={!current} onClick={() => setPicking(i)}>
                    <span className="ellipsis">{l.product?.name ?? 'Elegir o crear producto…'}</span>
                    <Icon name="chevron" size={18} />
                  </button>
                  {l.product ? <span className="small muted">{TRACKING_LABEL[l.product.tracking]}</span> : null}
                  <div className="grid-2">
                    <Field label="Cantidad" htmlFor={`pu-q-${i}`}>
                      <IntInput id={`pu-q-${i}`} value={l.qty} onChange={(v) => setLine(i, { qty: v === null ? null : Math.min(v, l.product?.tracking === 'quantity' ? 100_000 : 500) })} />
                    </Field>
                    <Field label={l.priceMode === 'unit' ? 'Precio por unidad' : 'Total pagado'} htmlFor={`pu-p-${i}`}>
                      <MoneyInput
                        id={`pu-p-${i}`}
                        value={l.priceMode === 'unit' ? l.unitPrice : l.totalPrice}
                        onChange={(v) => setLine(i, l.priceMode === 'unit' ? { unitPrice: v } : { totalPrice: v })}
                      />
                    </Field>
                  </div>
                  <Segmented
                    label="Forma de ingresar el precio"
                    value={l.priceMode}
                    onChange={(m) => setLine(i, { priceMode: m, totalPrice: m === 'total' ? linePrice(l) : l.totalPrice, unitPrice: m === 'unit' && l.qty && l.totalPrice !== null ? Math.round(l.totalPrice / l.qty) : l.unitPrice })}
                    options={[['unit', 'Precio por unidad'], ['total', 'Total de la línea']]}
                  />
                  {pv ? (
                    <p className="small muted">
                      Total línea {formatCOP(pv.price)}
                      {pv.allocatedExtra ? ` + gastos ${formatCOP(pv.allocatedExtra)}` : ''} → costo por unidad{' '}
                      <strong>{pv.unitCosts.length && Math.min(...pv.unitCosts) !== Math.max(...pv.unitCosts) ? `${formatCOP(Math.min(...pv.unitCosts))}–${formatCOP(Math.max(...pv.unitCosts))}` : formatCOP(pv.unitCosts[0] ?? 0)}</strong>
                    </p>
                  ) : null}
                  {pro && l.product?.tracking === 'unit' && (l.qty ?? 0) > 0 ? (
                    <details className="more">
                      <summary>IMEI, serial y estado por unidad (opcional)</summary>
                      <div className="stack">
                        {Array.from({ length: Math.min(l.qty ?? 0, 50) }, (_, k) => (
                          <UnitDetailFields key={k} index={k} value={l.details[k]} onChange={(v) => setLine(i, { details: { ...l.details, [k]: v } })} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </Card>
            );
          })}
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, newLine()])} disabled={!current}>
            <Icon name="plus" /> Agregar otro producto
          </button>

          <Field label="Gastos adicionales de la compra" htmlFor="pu-extra" hint="Transporte, envío, comisión del proveedor… Se suman al costo de lo comprado (no se restan otra vez como gasto).">
            <MoneyInput id="pu-extra" value={extra} onChange={setExtra} />
          </Field>
          {(extra ?? 0) > 0 && lines.length > 1 ? (
            <Field label="Repartir gastos">
              <Segmented label="Repartir gastos" value={allocation} onChange={setAllocation} options={[['value', 'Según el precio'], ['units', 'Igual por unidad']]} />
            </Field>
          ) : null}

          <details className="more" open={pro}>
            <summary>Proveedor, pago y notas (opcional)</summary>
            <div className="stack">
              <PartyField type="supplier" value={supplierId} onChange={setSupplierId} />
              <Field label="Método de pago" htmlFor="pu-method">
                <select id="pu-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">Sin indicar</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Notas / comprobante" htmlFor="pu-notes">
                <textarea id="pu-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: factura #123" />
              </Field>
            </div>
          </details>

          <Card>
            <KV
              rows={[
                ['Subtotal', formatCOP(subtotal)],
                ['Gastos adicionales', formatCOP(extra ?? 0)],
                ['Total invertido', formatCOP(total), true],
              ]}
            />
          </Card>
          {localError ? <Notice kind="bad">{localError}</Notice> : null}
          <FormError error={act.error} />
          <button className="btn primary block" disabled={act.busy}>
            Revisar y registrar compra
          </button>
        </form>
      )}
      {picking !== null && current ? (
        <ProductPicker
          inventoryId={current.id}
          invMode={current.mode}
          mode="purchase"
          onClose={() => setPicking(null)}
          onPick={(p) => {
            setLine(picking, { product: p, unitPrice: lines[picking].unitPrice });
            setPicking(null);
          }}
        />
      ) : null}
      {confirming ? (
        <Sheet
          title="Confirmar compra"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn primary block" disabled={act.busy} onClick={() => void submit()} data-testid="confirm-purchase">
                {act.busy ? 'Guardando…' : `Registrar compra por ${formatCOP(total)}`}
              </button>
              <button className="btn block" onClick={() => setConfirming(false)}>
                Volver a editar
              </button>
            </>
          }
        >
          <KV
            rows={[
              ['Inventario', current?.name ?? ''],
              ['Fecha', formatDateTime(date)],
              ...lines.map((l) => [`${l.qty} × ${l.product?.name}`, formatCOP(linePrice(l))] as [string, string]),
              ['Gastos adicionales', formatCOP(extra ?? 0)],
              ['Total', formatCOP(total), true],
            ]}
          />
          <p className="small muted">Se sumarán {lines.reduce((a, l) => a + (l.qty ?? 0), 0)} unidad(es) al inventario.</p>
        </Sheet>
      ) : null}
    </Page>
  );
}

export function PurchaseDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const p = await d.purchases.get(id);
      if (!p) return null;
      const [inv, supplier, lines] = await Promise.all([d.inventories.get(p.inventoryId), p.supplierId ? d.suppliers.get(p.supplierId) : undefined, d.purchaseLines.where('purchaseId').equals(id).toArray()]);
      const products = await d.products.bulkGet(lines.map((l) => l.productId));
      const units = await d.units.where('purchaseId').equals(id).toArray();
      return { p, inv: inv!, supplier, lines, products, units };
    },
    [id],
  );
  const [editing, setEditing] = useState(false);
  const act = useAction();
  if (data === undefined) return <Page title="Compra" back="/operaciones?tab=compras"><Loading /></Page>;
  if (data === null) return <Page title="Compra" back="/operaciones?tab=compras"><Empty title="La compra no existe" /></Page>;
  const { p, inv, supplier, lines, products, units } = data;
  const pro = inv.mode === 'pro';
  const voidIt = async () => {
    const r = await ask({
      title: 'Anular compra',
      danger: true,
      message: <p>La compra se conserva marcada como anulada y lo comprado sale del inventario. Solo es posible si todo sigue en existencia.</p>,
      input: { label: 'Motivo', required: true, placeholder: 'Ej.: registrada por error' },
      confirmText: 'Anular compra',
    });
    if (r.ok) await act.run(() => voidPurchase(db, id, r.value), 'Compra anulada');
  };
  return (
    <Page
      title="Compra"
      subtitle={formatDateTime(p.date)}
      back="/operaciones?tab=compras"
      actions={
        p.status === 'active' ? (
          <ActionMenu
            title="Compra"
            actions={[
              { label: 'Editar datos (proveedor, fecha, notas)', icon: 'edit', onSelect: () => setEditing(true) },
              { label: 'Anular compra', icon: 'ban', danger: true, onSelect: voidIt },
            ]}
          />
        ) : undefined
      }
    >
      {p.status === 'voided' ? (
        <Notice kind="warn" title="Compra anulada">
          {formatDateTime(p.voidedAt)} · {p.voidReason}
        </Notice>
      ) : null}
      <FormError error={act.error} />
      <Card>
        <KV
          rows={[
            ['Inventario', <a key="i" href={`#/inventarios/${inv.id}`}>{inv.name}</a>],
            ['Proveedor', supplier ? <a key="s" href={`#/proveedores/${supplier.id}`}>{supplier.name}</a> : 'Sin proveedor'],
            ['Método de pago', p.paymentMethod || 'Sin indicar'],
            ['Subtotal', formatCOP(p.subtotal)],
            ['Gastos adicionales', `${formatCOP(p.extraCosts)}${p.extraCosts ? (p.allocation === 'units' ? ' (igual por unidad)' : ' (según precio)') : ''}`],
            ['Total', formatCOP(p.total), true],
          ]}
        />
        {p.notes ? <p className="small" style={{ marginTop: 10 }}>{p.notes}</p> : null}
      </Card>
      {lines.map((l, i) => {
        const prod = products[i];
        const lu = units.filter((u) => u.purchaseLineId === l.id);
        return (
          <Card key={l.id} title={prod ? <a href={`#/productos/${prod.id}`} className="strong">{prod.name}</a> : 'Producto'}>
            <KV
              rows={[
                ['Cantidad', l.quantity],
                ['Pagado', formatCOP(l.price)],
                ['Gastos asignados', formatCOP(l.allocatedExtra)],
                ['Costo total', formatCOP(l.totalCost), true],
                ['Costo por unidad', formatCOP(Math.round(l.totalCost / l.quantity))],
              ]}
            />
            {lu.length ? (
              <div className="row wrap" style={{ marginTop: 10 }}>
                {lu.map((u, k) => (
                  <a key={u.id} href={`#/unidades/${u.id}`} className="badge brand">
                    {pro ? u.code : `Unidad ${k + 1}`}
                  </a>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
      <p className="tiny muted">Registrada el {formatDate(p.createdAt)}.</p>
      {editing ? <EditPurchaseSheet id={id} initial={{ notes: p.notes, supplierId: p.supplierId, paymentMethod: p.paymentMethod, date: p.date }} onClose={() => setEditing(false)} /> : null}
    </Page>
  );
}

function EditPurchaseSheet({ id, initial, onClose }: { id: ID; initial: { notes: string; supplierId: ID | null; paymentMethod: string; date: string }; onClose: () => void }) {
  const [f, setF] = useState(initial);
  const act = useAction();
  return (
    <Sheet
      title="Editar compra"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(() => updatePurchaseInfo(db, id, f).then(() => true), 'Compra actualizada');
            if (ok) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted">Los importes no se editan: para corregirlos, anule la compra y regístrela de nuevo.</p>
      <Field label="Fecha" htmlFor="ep-date" error={act.field === 'date' ? act.error : null}>
        <DateTimeInput id="ep-date" value={f.date} onChange={(v) => setF({ ...f, date: v ?? f.date })} />
      </Field>
      <PartyField type="supplier" value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} />
      <Field label="Método de pago" htmlFor="ep-method">
        <select id="ep-method" className="select" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>
          <option value="">Sin indicar</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Notas" htmlFor="ep-notes">
        <TextInput id="ep-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <FormError error={act.field === 'date' ? null : act.error} />
    </Sheet>
  );
}
