import { useEffect, useMemo, useState } from 'react';
import {
  addPayment,
  addRefund,
  computeSaleBalance,
  createSale,
  EXPENSE_CATEGORIES,
  fifoOrder,
  formatCOP,
  formatDateTime,
  newOpId,
  nowISO,
  registerReturn,
  returnPortion,
  TRACKING_LABEL,
  unitCost,
  updateSaleInfo,
  voidSale,
  type DeliveryStatus,
  type ID,
  type Product,
  type ReturnDestination,
  type Sale,
  type SaleLine,
} from '../../core';
import { InventorySelect, maskImei, PaymentBadge, PAYMENT_METHODS, useDefaultInventory } from '../components/common';
import { Icon } from '../components/Icon';
import { PartyField, ProductPicker, UnitPicker } from '../components/pickers';
import {
  ActionMenu,
  ask,
  Badge,
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

interface SLine {
  key: string;
  product: Product | null;
  qty: number | null;
  unitIds: ID[];
  price: number | null;
}

const newSLine = (product: Product | null = null, unitIds: ID[] = []): SLine => ({
  key: newOpId(),
  product,
  qty: unitIds.length || 1,
  unitIds,
  price: product?.salePrice ?? null,
});

const DELIVERY_LABEL: Record<DeliveryStatus, string> = { na: 'No aplica', pending: 'Pendiente de entrega', delivered: 'Entregado' };

export function SaleFormScreen({ inventoryId, productId, unitId }: { inventoryId: string | null; productId: string | null; unitId: string | null }) {
  const [inv, setInv, invs] = useDefaultInventory(inventoryId);
  const current = invs?.find((i) => i.id === inv) ?? null;
  const pro = current?.mode === 'pro';
  const [lines, setLines] = useState<SLine[]>([newSLine()]);
  const [date, setDate] = useState<string | null>(nowISO());
  const [discount, setDiscount] = useState<number | null>(null);
  const [payMode, setPayMode] = useState<'full' | 'partial' | 'pending'>('full');
  const [partial, setPartial] = useState<number | null>(null);
  const [method, setMethod] = useState('Efectivo');
  const [customerId, setCustomerId] = useState<ID | null>(null);
  const [costs, setCosts] = useState<{ category: string; amount: number | null }[]>([]);
  const [warrantyOn, setWarrantyOn] = useState(false);
  const [wValue, setWValue] = useState<number | null>(1);
  const [wUnit, setWUnit] = useState<'days' | 'months'>('months');
  const [wCond, setWCond] = useState('');
  const [delivery, setDelivery] = useState<DeliveryStatus>('na');
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  const [unitPicking, setUnitPicking] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opId, setOpId] = useState(newOpId);
  const [localError, setLocalError] = useState<string | null>(null);
  const act = useAction();

  // Producto/unidad indicados en la dirección
  const initial = useLive(async (d) => ({ p: productId ? await d.products.get(productId) : undefined }), [productId]);
  useEffect(() => {
    const p = initial?.p;
    if (p && p.inventoryId === inv) setLines((ls) => (ls.length === 1 && !ls[0].product ? [newSLine(p, unitId ? [unitId] : [])] : ls));
  }, [initial, inv, unitId]);

  // Disponibilidad y costos estimados en vivo
  const productIds = lines.map((l) => l.product?.id).filter(Boolean) as ID[];
  const stock = useLive(
    async (d) => {
      const out: Record<ID, { available: number; costs: (number | null)[]; unitIds: ID[]; avg: number | null; unknownQty: number }> = {};
      for (const pid of productIds) {
        const p = await d.products.get(pid);
        if (!p) continue;
        if (p.tracking === 'unit') {
          const us = (await d.units.where('productId').equals(pid).filter((u) => u.status === 'available').toArray()).sort(fifoOrder);
          out[pid] = { available: us.length, costs: us.map(unitCost), unitIds: us.map((u) => u.id), avg: null, unknownQty: 0 };
        } else {
          const known = p.qty - p.unknownCostQty;
          out[pid] = { available: p.qty, costs: [], unitIds: [], avg: known > 0 ? p.stockValue / known : null, unknownQty: p.unknownCostQty };
        }
      }
      return out;
    },
    [productIds.join(',')],
  );
  const unitCostMap = useLive(async (d) => {
    const ids = lines.flatMap((l) => l.unitIds);
    const us = ids.length ? await d.units.bulkGet(ids) : [];
    const m: Record<ID, { cost: number | null; code: string; imei: string; color: string }> = {};
    us.forEach((u) => {
      if (u) m[u.id] = { cost: unitCost(u), code: u.code, imei: u.imei, color: u.color };
    });
    return m;
  }, [lines.map((l) => l.unitIds.join(',')).join('|')]);

  const setLine = (i: number, patch: Partial<SLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const qtyOf = (l: SLine) => (l.unitIds.length ? l.unitIds.length : l.qty ?? 0);
  const subtotal = lines.reduce((a, l) => a + qtyOf(l) * (l.price ?? 0), 0);
  const total = Math.max(0, subtotal - (discount ?? 0));
  const initialPayment = payMode === 'full' ? total : payMode === 'partial' ? partial ?? 0 : 0;
  const costsTotal = costs.reduce((a, c) => a + (c.amount ?? 0), 0);

  // Costo estimado de lo vendido
  const est = useMemo(() => {
    let cost = 0;
    let unknown = 0;
    for (const l of lines) {
      if (!l.product || !stock?.[l.product.id]) continue;
      const s = stock[l.product.id];
      const q = qtyOf(l);
      if (l.product.tracking === 'unit') {
        const cs = l.unitIds.length ? l.unitIds.map((id) => unitCostMap?.[id]?.cost ?? null) : s.costs.slice(0, q);
        for (const c of cs) {
          if (c === null) unknown++;
          else cost += c;
        }
      } else {
        const uq = Math.min(q, s.unknownQty);
        unknown += uq;
        cost += s.avg === null ? 0 : Math.round(s.avg * (q - uq));
      }
    }
    return { cost, unknown };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, stock, unitCostMap]);

  const validate = (): boolean => {
    const fail = (m: string) => {
      setLocalError(m);
      return false;
    };
    if (!current) return fail('Seleccione el inventario de origen.');
    const used = new Map<ID, number>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.product) return fail(`Línea ${i + 1}: elija un producto.`);
      const q = qtyOf(l);
      if (!q) return fail(`Línea ${i + 1}: ingrese la cantidad.`);
      if (l.price === null) return fail(`Línea ${i + 1}: ingrese el precio de venta.`);
      used.set(l.product.id, (used.get(l.product.id) ?? 0) + q);
    }
    for (const [pid, q] of used) {
      const s = stock?.[pid];
      if (s && q > s.available) return fail(`Stock insuficiente: hay ${s.available} disponible(s) de "${lines.find((l) => l.product?.id === pid)?.product?.name}".`);
    }
    if ((discount ?? 0) > subtotal) return fail('El descuento no puede ser mayor que el subtotal.');
    if (payMode === 'partial' && (partial === null || partial <= 0 || partial >= total)) return fail('Para pago parcial, ingrese un valor mayor que 0 y menor que el total.');
    setLocalError(null);
    return true;
  };

  const submit = async () => {
    const s = await act.run(
      () =>
        createSale(db, {
          opId,
          inventoryId: inv,
          customerId,
          date: date ?? '',
          paymentMethod: payMode === 'pending' ? '' : method,
          notes,
          discount: discount ?? 0,
          deliveryStatus: delivery,
          lines: lines.map((l) => ({ productId: l.product!.id, quantity: l.unitIds.length ? undefined : l.qty ?? 0, unitIds: l.unitIds.length ? l.unitIds : undefined, unitPrice: l.price ?? 0 })),
          initialPayment,
          costs: costs.filter((c) => (c.amount ?? 0) > 0).map((c) => ({ category: c.category, amount: c.amount ?? 0 })),
          warranty: warrantyOn ? { durationValue: wValue ?? 0, durationUnit: wUnit, conditions: wCond } : null,
        }),
      'Venta registrada',
    );
    setConfirming(false);
    if (s) {
      setOpId(newOpId());
      navigate(`/ventas/${s.id}`, { replace: true });
    }
  };

  return (
    <Page title="Registrar venta" back={inv ? `/inventarios/${inv}` : '/'}>
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
          <Field label="Inventario de origen" htmlFor="sa-inv">
            <InventorySelect
              id="sa-inv"
              value={inv}
              inventories={invs}
              onChange={(v) => {
                setInv(v);
                setLines([newSLine()]);
              }}
            />
          </Field>
          {lines.map((l, i) => {
            const s = l.product ? stock?.[l.product.id] : undefined;
            const isUnit = l.product?.tracking === 'unit';
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
                    <span className="ellipsis">{l.product?.name ?? 'Elegir producto…'}</span>
                    <Icon name="chevron" size={18} />
                  </button>
                  {l.product ? (
                    <span className="small muted">
                      {TRACKING_LABEL[l.product.tracking]} · Disponibles: {s?.available ?? '…'}
                    </span>
                  ) : null}
                  <div className="grid-2">
                    <Field label="Cantidad" htmlFor={`sa-q-${i}`}>
                      <IntInput id={`sa-q-${i}`} value={l.unitIds.length || l.qty} onChange={(v) => setLine(i, { qty: v, unitIds: [] })} />
                    </Field>
                    <Field label="Precio por unidad" htmlFor={`sa-p-${i}`}>
                      <MoneyInput id={`sa-p-${i}`} value={l.price} onChange={(v) => setLine(i, { price: v })} />
                    </Field>
                  </div>
                  {isUnit ? (
                    <div className="stack-sm">
                      <button type="button" className="btn sm" onClick={() => setUnitPicking(i)}>
                        {l.unitIds.length ? `Cambiar unidades (${l.unitIds.length} elegidas)` : 'Elegir unidades específicas'}
                      </button>
                      {l.unitIds.length ? (
                        <div className="row wrap">
                          {l.unitIds.map((id) => (
                            <Badge key={id} kind="brand">
                              {pro ? unitCostMap?.[id]?.code : unitCostMap?.[id]?.color || 'Unidad'}
                              {pro && unitCostMap?.[id]?.imei ? ` · ${maskImei(unitCostMap[id].imei)}` : ''}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="tiny muted">Si no elige, se venden las unidades más antiguas primero.</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, newSLine()])} disabled={!current}>
            <Icon name="plus" /> Agregar otro producto
          </button>

          <Field label="Descuento (opcional)" htmlFor="sa-disc">
            <MoneyInput id="sa-disc" value={discount} onChange={setDiscount} />
          </Field>

          <Field label="Pago">
            <Segmented label="Estado del pago" value={payMode} onChange={setPayMode} options={[['full', 'Pagado completo'], ['partial', 'Parcial'], ['pending', 'Pendiente']]} />
          </Field>
          {payMode === 'partial' ? (
            <Field label="Valor recibido ahora" htmlFor="sa-partial" hint={`Saldo pendiente: ${formatCOP(Math.max(0, total - (partial ?? 0)))}`}>
              <MoneyInput id="sa-partial" value={partial} onChange={setPartial} />
            </Field>
          ) : null}
          {payMode !== 'pending' ? (
            <Field label="Método de pago" htmlFor="sa-method">
              <select id="sa-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          ) : null}

          <details className="more" open={pro}>
            <summary>Comprador, garantía, gastos y notas (opcional)</summary>
            <div className="stack">
              <PartyField type="customer" value={customerId} onChange={setCustomerId} />
              <div className="field">
                <span className="field-label">Gastos de esta venta</span>
                <span className="hint">Comisiones, envío pagado por usted… Se restan en la ganancia neta.</span>
                {costs.map((c, k) => (
                  <div key={k} className="row">
                    <select className="select" aria-label="Categoría del gasto" style={{ maxWidth: '45%' }} value={c.category} onChange={(e) => setCosts((cs) => cs.map((x, j) => (j === k ? { ...x, category: e.target.value } : x)))}>
                      {EXPENSE_CATEGORIES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <div className="grow">
                      <MoneyInput ariaLabel="Valor del gasto" value={c.amount} onChange={(v) => setCosts((cs) => cs.map((x, j) => (j === k ? { ...x, amount: v } : x)))} />
                    </div>
                    <button type="button" className="icon-btn" aria-label="Quitar gasto" onClick={() => setCosts((cs) => cs.filter((_, j) => j !== k))}>
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn sm" onClick={() => setCosts((cs) => [...cs, { category: 'Comisión', amount: null }])}>
                  <Icon name="plus" size={18} /> Agregar gasto
                </button>
              </div>
              <label className="check">
                <input type="checkbox" checked={warrantyOn} onChange={(e) => setWarrantyOn(e.target.checked)} /> Dar garantía al comprador
              </label>
              {warrantyOn ? (
                <>
                  <div className="grid-2">
                    <Field label="Duración" htmlFor="sa-wv">
                      <IntInput id="sa-wv" value={wValue} onChange={setWValue} />
                    </Field>
                    <Field label="Unidad">
                      <Segmented label="Unidad de tiempo" value={wUnit} onChange={setWUnit} options={[['days', 'Días'], ['months', 'Meses']]} />
                    </Field>
                  </div>
                  <Field label="Condiciones" htmlFor="sa-wc">
                    <TextInput id="sa-wc" value={wCond} onChange={(e) => setWCond(e.target.value)} placeholder="Ej.: no cubre golpes ni humedad" />
                  </Field>
                </>
              ) : null}
              <Field label="Entrega">
                <Segmented label="Estado de entrega" value={delivery} onChange={setDelivery} options={[['na', 'No aplica'], ['pending', 'Pendiente'], ['delivered', 'Entregado']]} />
              </Field>
              <Field label="Fecha y hora" htmlFor="sa-date" error={act.field === 'date' ? act.error : null}>
                <DateTimeInput id="sa-date" value={date} onChange={setDate} invalid={act.field === 'date'} />
              </Field>
              <Field label="Observaciones" htmlFor="sa-notes">
                <textarea id="sa-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </details>

          <Card>
            <KV
              rows={[
                ['Subtotal', formatCOP(subtotal)],
                ['Descuento', formatCOP(discount ?? 0)],
                ['Total de la venta', formatCOP(total), true],
                ['Recibido ahora', formatCOP(initialPayment)],
                ['Queda por cobrar', formatCOP(Math.max(0, total - initialPayment))],
                [
                  'Ganancia estimada',
                  est.unknown ? (
                    <span key="g">
                      {formatCOP(total - est.cost - costsTotal)} <Badge kind="warn">⚠ {est.unknown} sin costo</Badge>
                    </span>
                  ) : (
                    formatCOP(total - est.cost - costsTotal)
                  ),
                ],
              ]}
            />
          </Card>
          {localError ? <Notice kind="bad">{localError}</Notice> : null}
          <FormError error={act.error} />
          <button className="btn primary block" disabled={act.busy}>
            Revisar y registrar venta
          </button>
        </form>
      )}
      {picking !== null && current ? (
        <ProductPicker
          inventoryId={current.id}
          invMode={current.mode}
          mode="sale"
          onClose={() => setPicking(null)}
          onPick={(p) => {
            setLine(picking, { product: p, unitIds: [], qty: 1, price: p.salePrice ?? lines[picking].price });
            setPicking(null);
          }}
        />
      ) : null}
      {unitPicking !== null && lines[unitPicking]?.product ? (
        <UnitPicker
          productId={lines[unitPicking].product!.id}
          selected={lines[unitPicking].unitIds}
          pro={pro}
          onClose={() => setUnitPicking(null)}
          onDone={(ids) => {
            setLine(unitPicking, { unitIds: ids, qty: ids.length });
            setUnitPicking(null);
          }}
        />
      ) : null}
      {confirming ? (
        <Sheet
          title="Confirmar venta"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn primary block" disabled={act.busy} onClick={() => void submit()} data-testid="confirm-sale">
                {act.busy ? 'Guardando…' : `Registrar venta por ${formatCOP(total)}`}
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
              ...lines.map((l) => [`${qtyOf(l)} × ${l.product?.name}`, formatCOP(qtyOf(l) * (l.price ?? 0))] as [string, string]),
              ['Descuento', formatCOP(discount ?? 0)],
              ['Total', formatCOP(total), true],
              ['Pago', payMode === 'full' ? `Completo (${method})` : payMode === 'partial' ? `Parcial: ${formatCOP(initialPayment)}` : 'Pendiente'],
            ]}
          />
        </Sheet>
      ) : null}
    </Page>
  );
}

/* ================= Detalle de venta ================= */

export function SaleDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const sale = await d.sales.get(id);
      if (!sale) return null;
      const [inv, customer, lines, payments, returns, expenses, warranties] = await Promise.all([
        d.inventories.get(sale.inventoryId),
        sale.customerId ? d.customers.get(sale.customerId) : undefined,
        d.saleLines.where('saleId').equals(id).toArray(),
        d.payments.where('saleId').equals(id).toArray(),
        d.returns.where('saleId').equals(id).toArray(),
        d.expenses.where('saleId').equals(id).toArray(),
        d.warranties.where('saleId').equals(id).toArray(),
      ]);
      const products = new Map((await d.products.bulkGet(lines.map((l) => l.productId))).filter(Boolean).map((p) => [p!.id, p!]));
      const units = new Map((await d.units.bulkGet(lines.map((l) => l.unitId).filter(Boolean) as ID[])).filter(Boolean).map((u) => [u!.id, u!]));
      return { sale, inv: inv!, customer, lines, payments, returns, expenses, warranties, products, units };
    },
    [id],
  );
  const [sheet, setSheet] = useState<null | 'payment' | 'refund' | 'return' | 'edit'>(null);
  const act = useAction();
  if (data === undefined) return <Page title="Venta" back="/operaciones?tab=ventas"><Loading /></Page>;
  if (data === null) return <Page title="Venta" back="/operaciones?tab=ventas"><Empty title="La venta no existe" /></Page>;
  const { sale, inv, customer, lines, payments, returns, expenses, warranties, products, units } = data;
  const bal = computeSaleBalance(sale, lines, payments);
  const pro = inv.mode === 'pro';
  const active = sale.status === 'active';
  const canReturn = active && lines.some((l) => l.returnedQty < l.quantity);
  const cogs = lines.reduce((a, l) => a + l.cogs - l.returnedCogs, 0);
  const unknown = lines.reduce((a, l) => a + l.cogsUnknownQty - l.returnedUnknownQty, 0);
  const saleCosts = expenses.filter((e) => e.status === 'active').reduce((a, e) => a + e.amount, 0);

  const voidIt = async () => {
    const r = await ask({
      title: 'Anular venta',
      danger: true,
      message: (
        <p>
          Use esto solo si la venta se registró por error. Se conservará marcada como anulada, lo vendido vuelve a existencia y deja de contar en ingresos, costos y cobros. Para una devolución real del cliente, use "Registrar devolución".
        </p>
      ),
      input: { label: 'Motivo', required: true },
      confirmText: 'Anular venta',
    });
    if (r.ok) await act.run(() => voidSale(db, id, r.value), 'Venta anulada');
  };

  return (
    <Page
      title="Venta"
      subtitle={formatDateTime(sale.date)}
      back="/operaciones?tab=ventas"
      actions={
        active ? (
          <ActionMenu
            title="Venta"
            actions={[
              { label: 'Registrar pago', icon: 'money', hidden: bal.pending <= 0, onSelect: () => setSheet('payment') },
              { label: 'Registrar devolución', icon: 'return', hidden: !canReturn, onSelect: () => setSheet('return') },
              { label: 'Reembolsar saldo a favor', icon: 'money', hidden: bal.credit <= 0, onSelect: () => setSheet('refund') },
              { label: 'Editar datos (comprador, entrega, notas)', icon: 'edit', onSelect: () => setSheet('edit') },
              { label: 'Anular venta (error)', icon: 'ban', danger: true, hidden: returns.length > 0, onSelect: voidIt },
            ]}
          />
        ) : undefined
      }
    >
      <div className="row wrap">
        <PaymentBadge status={bal.status} />
        {sale.deliveryStatus !== 'na' ? <Badge kind={sale.deliveryStatus === 'delivered' ? 'ok' : 'warn'}>{DELIVERY_LABEL[sale.deliveryStatus]}</Badge> : null}
      </div>
      {sale.status === 'voided' ? (
        <Notice kind="warn" title="Venta anulada">
          {formatDateTime(sale.voidedAt)} · {sale.voidReason}
        </Notice>
      ) : null}
      <FormError error={act.error} />
      {active && bal.pending > 0 ? (
        <button className="btn primary block" onClick={() => setSheet('payment')}>
          <Icon name="money" /> Registrar pago ({formatCOP(bal.pending)} pendiente)
        </button>
      ) : null}
      <Card>
        <KV
          rows={[
            ['Inventario', <a key="i" href={`#/inventarios/${inv.id}`}>{inv.name}</a>],
            ['Comprador', customer ? <a key="c" href={`#/compradores/${customer.id}`}>{customer.name}</a> : 'Sin comprador'],
            ['Subtotal', formatCOP(sale.subtotal)],
            ['Descuento', formatCOP(sale.discount)],
            ['Total de la venta', formatCOP(sale.total), true],
            ...(bal.returned ? ([['Devuelto', `− ${formatCOP(bal.returned)}`]] as [string, string][]) : []),
            ['Cobrado (neto)', formatCOP(bal.collected)],
            ['Pendiente por cobrar', formatCOP(bal.pending), true],
            ...(bal.credit ? ([['Saldo a favor del cliente', formatCOP(bal.credit)]] as [string, string][]) : []),
          ]}
        />
      </Card>
      {active ? (
        <Card title="Rentabilidad de la venta">
          <KV
            rows={[
              ['Ingreso neto', formatCOP(bal.effective)],
              ['Costo de lo vendido', unknown ? <span key="u">{formatCOP(cogs)} <Badge kind="warn">⚠ {unknown} sin costo</Badge></span> : formatCOP(cogs)],
              ['Ganancia bruta', formatCOP(bal.effective - cogs), true],
              ['Gastos de la venta', formatCOP(saleCosts)],
              ['Ganancia después de gastos', formatCOP(bal.effective - cogs - saleCosts), true],
            ]}
          />
          {unknown ? <p className="tiny muted" style={{ marginTop: 8 }}>La ganancia está sobrestimada porque falta el costo de {unknown} unidad(es).</p> : null}
        </Card>
      ) : null}
      <Card title="Productos" flush>
        <ul className="list">
          {lines.map((l) => {
            const p = products.get(l.productId);
            const u = l.unitId ? units.get(l.unitId) : undefined;
            return (
              <li key={l.id}>
                <a className="item" href={u ? `#/unidades/${u.id}` : `#/productos/${l.productId}`}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {l.quantity} × {p?.name ?? 'Producto'}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {u && pro ? `${u.code} · ` : ''}
                      {formatCOP(l.unitPrice)} c/u{l.discountShare ? ` · desc. ${formatCOP(l.discountShare)}` : ''} · costo {l.cogsUnknownQty ? 'incompleto' : formatCOP(l.cogs)}
                      {l.returnedQty ? ` · devuelto ${l.returnedQty}` : ''}
                    </span>
                  </span>
                  <span className="item-side money strong">{formatCOP(l.netAmount)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Pagos y reembolsos" flush>
        {payments.length === 0 ? (
          <Empty icon="money" title="Sin pagos registrados" />
        ) : (
          <ul className="list">
            {payments
              .sort((a, b) => (a.date < b.date ? -1 : 1))
              .map((p) => (
                <li key={p.id} className="item" style={{ cursor: 'default' }}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {p.kind === 'payment' ? 'Pago' : 'Reembolso'}
                      {p.method ? ` · ${p.method}` : ''}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDateTime(p.date)}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </span>
                  </span>
                  <span className={`item-side money strong ${p.kind === 'refund' ? 'delta-down' : ''}`}>
                    {p.kind === 'refund' ? '− ' : ''}
                    {formatCOP(p.amount)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
      {returns.length ? (
        <Card title="Devoluciones" flush>
          <ul className="list">
            {returns.map((r) => (
              <li key={r.id} className="item" style={{ cursor: 'default' }}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {r.lines.reduce((a, x) => a + x.quantity, 0)} unidad(es) · {r.reason || 'Sin motivo'}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {formatDateTime(r.date)} · reembolso {formatCOP(r.refundAmount)}
                  </span>
                </span>
                <span className="item-side money">− {formatCOP(r.lines.reduce((a, x) => a + x.amount, 0))}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {expenses.length ? (
        <Card title="Gastos de la venta" flush>
          <ul className="list">
            {expenses.map((e) => (
              <li key={e.id}>
                <a className="item" href={`#/gastos/${e.id}`}>
                  <span className="item-main">
                    {e.category}
                    {e.status === 'voided' ? ' (anulado)' : ''}
                  </span>
                  <span className="item-side money">{formatCOP(e.amount)}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {warranties.length ? (
        <Card title="Garantías" flush>
          <ul className="list">
            {warranties.map((w) => (
              <li key={w.id}>
                <a className="item" href={`#/garantias/${w.id}`}>
                  <span className="item-main">
                    {w.durationValue} {w.durationUnit === 'months' ? 'mes(es)' : 'día(s)'} · hasta {formatDateTime(w.endDate).split(',')[0]}
                  </span>
                  <span className="item-side">{w.status === 'cancelled' ? <Badge>Anulada</Badge> : <Badge kind="ok">Activa</Badge>}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {sale.notes ? (
        <Card title="Observaciones">
          <p className="small wrap-anywhere">{sale.notes}</p>
        </Card>
      ) : null}

      {sheet === 'payment' ? <PaymentSheet sale={sale} kind="payment" max={bal.pending} onClose={() => setSheet(null)} /> : null}
      {sheet === 'refund' ? <PaymentSheet sale={sale} kind="refund" max={bal.credit} onClose={() => setSheet(null)} /> : null}
      {sheet === 'return' ? <ReturnSheet sale={sale} lines={lines} collected={bal.collected} products={products} units={units} pro={pro} onClose={() => setSheet(null)} /> : null}
      {sheet === 'edit' ? <EditSaleSheet sale={sale} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function PaymentSheet({ sale, kind, max, onClose }: { sale: Sale; kind: 'payment' | 'refund'; max: number; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(max);
  const [date, setDate] = useState<string | null>(nowISO());
  const [method, setMethod] = useState('Efectivo');
  const [notes, setNotes] = useState('');
  const [opId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet title={kind === 'payment' ? 'Registrar pago' : 'Registrar reembolso'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const fn = kind === 'payment' ? addPayment : addRefund;
          const ok = await act.run(() => fn(db, { opId, saleId: sale.id, amount: amount ?? 0, date: date ?? '', method, notes }).then(() => true), kind === 'payment' ? 'Pago registrado' : 'Reembolso registrado');
          if (ok) onClose();
        }}
      >
        <Field label="Valor" htmlFor="pay-amount" hint={`Máximo: ${formatCOP(max)}`} error={act.field === 'amount' ? act.error : null}>
          <MoneyInput id="pay-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
        </Field>
        <div className="grid-2">
          <Field label="Método" htmlFor="pay-method">
            <select id="pay-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha" htmlFor="pay-date">
            <DateTimeInput id="pay-date" value={date} onChange={setDate} />
          </Field>
        </div>
        <Field label="Nota (opcional)" htmlFor="pay-notes">
          <TextInput id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={act.field === 'amount' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Guardar
        </button>
      </form>
    </Sheet>
  );
}

function ReturnSheet({
  sale,
  lines,
  collected,
  products,
  units,
  pro,
  onClose,
}: {
  sale: Sale;
  lines: SaleLine[];
  collected: number;
  products: Map<ID, Product>;
  units: Map<ID, { code: string }>;
  pro: boolean;
  onClose: () => void;
}) {
  const open = lines.filter((l) => l.returnedQty < l.quantity);
  const [sel, setSel] = useState<Record<ID, { qty: number; dest: ReturnDestination }>>({});
  const [date, setDate] = useState<string | null>(nowISO());
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<number | null>(null);
  const [refundTouched, setRefundTouched] = useState(false);
  const [opId] = useState(newOpId);
  const act = useAction();
  const amount = Object.entries(sel).reduce((a, [lid, s]) => {
    const l = lines.find((x) => x.id === lid);
    return l ? a + returnPortion(l, s.qty).amount : a;
  }, 0);
  const suggested = Math.min(collected, amount);
  const refundValue = refundTouched ? refund : suggested;
  return (
    <Sheet
      title="Registrar devolución"
      onClose={onClose}
      full
      footer={
        <button
          className="btn primary block"
          disabled={act.busy || Object.keys(sel).length === 0}
          onClick={async () => {
            const ok = await act.run(
              () =>
                registerReturn(db, {
                  opId,
                  saleId: sale.id,
                  date: date ?? '',
                  reason,
                  refundAmount: refundValue ?? 0,
                  lines: Object.entries(sel).map(([saleLineId, s]) => ({ saleLineId, quantity: s.qty, destination: s.dest })),
                }).then(() => true),
              'Devolución registrada',
            );
            if (ok) onClose();
          }}
        >
          Registrar devolución
        </button>
      }
    >
      <p className="small muted">La venta original se conserva. Elija qué vuelve y en qué estado queda.</p>
      {open.map((l) => {
        const p = products.get(l.productId);
        const s = sel[l.id];
        const remaining = l.quantity - l.returnedQty;
        const isQty = p?.tracking === 'quantity';
        return (
          <fieldset key={l.id} className="card stack-sm" style={{ margin: 0 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={!!s}
                onChange={(e) =>
                  setSel((x) => {
                    const n = { ...x };
                    if (e.target.checked) n[l.id] = { qty: remaining, dest: isQty ? 'available' : 'in_review' };
                    else delete n[l.id];
                    return n;
                  })
                }
              />
              <span>
                {p?.name}
                {l.unitId && pro ? ` · ${units.get(l.unitId)?.code}` : ''} ({remaining} por devolver)
              </span>
            </label>
            {s ? (
              <div className="grid-2">
                {remaining > 1 ? (
                  <Field label="Cantidad" htmlFor={`rt-q-${l.id}`}>
                    <IntInput id={`rt-q-${l.id}`} value={s.qty} min={1} onChange={(v) => setSel((x) => ({ ...x, [l.id]: { ...s, qty: Math.min(remaining, Math.max(1, v ?? 1)) } }))} />
                  </Field>
                ) : null}
                <Field label="Queda como" htmlFor={`rt-d-${l.id}`}>
                  <select id={`rt-d-${l.id}`} className="select" value={s.dest} onChange={(e) => setSel((x) => ({ ...x, [l.id]: { ...s, dest: e.target.value as ReturnDestination } }))}>
                    <option value="available">Disponible para vender</option>
                    {!isQty ? <option value="in_review">Pendiente de inspección</option> : null}
                    <option value="damaged">{isQty ? 'Dañado (se da de baja)' : 'Dañado'}</option>
                  </select>
                </Field>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      <Field label="Motivo" htmlFor="rt-reason">
        <TextInput id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: falla en la cámara" />
      </Field>
      <div className="grid-2">
        <Field label="Dinero devuelto al cliente" htmlFor="rt-refund" hint={`Cobrado hasta hoy: ${formatCOP(collected)}`} error={act.field === 'refundAmount' ? act.error : null}>
          <MoneyInput
            id="rt-refund"
            value={refundValue}
            onChange={(v) => {
              setRefundTouched(true);
              setRefund(v);
            }}
          />
        </Field>
        <Field label="Fecha" htmlFor="rt-date">
          <DateTimeInput id="rt-date" value={date} onChange={setDate} />
        </Field>
      </div>
      <p className="small">Valor de lo devuelto: <strong>{formatCOP(amount)}</strong></p>
      <FormError error={act.field === 'refundAmount' ? null : act.error} />
    </Sheet>
  );
}

function EditSaleSheet({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [customerId, setCustomerId] = useState<ID | null>(sale.customerId);
  const [delivery, setDelivery] = useState<DeliveryStatus>(sale.deliveryStatus);
  const [method, setMethod] = useState(sale.paymentMethod);
  const [notes, setNotes] = useState(sale.notes);
  const act = useAction();
  return (
    <Sheet
      title="Editar venta"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(() => updateSaleInfo(db, sale.id, { customerId, deliveryStatus: delivery, paymentMethod: method, notes }).then(() => true), 'Venta actualizada');
            if (ok) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted">Los importes no se editan: use pagos, devoluciones o anulación para que todo quede trazable.</p>
      <PartyField type="customer" value={customerId} onChange={setCustomerId} />
      <Field label="Entrega">
        <Segmented label="Estado de entrega" value={delivery} onChange={setDelivery} options={[['na', 'No aplica'], ['pending', 'Pendiente'], ['delivered', 'Entregado']]} />
      </Field>
      <Field label="Método de pago" htmlFor="es-method">
        <select id="es-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Sin indicar</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Observaciones" htmlFor="es-notes">
        <textarea id="es-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError error={act.error} />
    </Sheet>
  );
}
