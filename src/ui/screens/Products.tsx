import { useMemo, useState } from 'react';
import {
  adjustQuantity,
  fifoOrder,
  formatCOP,
  formatDate,
  formatDateTime,
  KIND_LABEL,
  newOpId,
  nowISO,
  registerInitialStock,
  setProductArchived,
  TRACKING_LABEL,
  unitCost,
  updateProduct,
  type ID,
  type Movement,
  type Product,
  type UnitStatus,
  type PartInput,
  type UnitDetails,
} from '../../core';
import { DaysLabel, InventorySelect, maskImei, ModeBadge, UnitStatusBadge, useDefaultInventory } from '../components/common';
import { Icon } from '../components/Icon';
import { ProductPicker, QuickProductForm } from '../components/pickers';
import {
  ActionMenu,
  Card,
  Chips,
  confirmAction,
  DateTimeInput,
  Empty,
  Field,
  FormError,
  IntInput,
  Loading,
  MoneyInput,
  Notice,
  Page,
  Paged,
  Segmented,
  Sheet,
  TextInput,
} from '../components/ui';
import { goBack, navigate } from '../router';
import { db, useAction, useLive, usePref } from '../store';
import { ConditionChips, PartsBadges, PartsEditor, STANDARD_CONDITIONS } from '../components/parts';
import { Kpi } from './Home';

/* ================= Crear / editar producto ================= */

export function ProductFormScreen({ inventoryId, productId }: { inventoryId?: string | null; productId?: ID }) {
  if (productId) return <ProductEdit id={productId} />;
  return <ProductCreate inventoryId={inventoryId ?? null} />;
}

function ProductCreate({ inventoryId }: { inventoryId: string | null }) {
  const [inv, setInv, invs] = useDefaultInventory(inventoryId);
  const current = invs?.find((i) => i.id === inv);
  return (
    <Page title="Nuevo producto" help="product-form" back={inv ? `/inventarios/${inv}` : '/inventarios'}>
      {!invs ? (
        <Loading />
      ) : invs.filter((i) => !i.archived).length === 0 ? (
        <Empty title="Primero cree un inventario">
          <a className="btn primary" href="#/inventarios">
            Ir a inventarios
          </a>
        </Empty>
      ) : (
        <>
          <Field label="Inventario" htmlFor="pc-inv">
            <InventorySelect id="pc-inv" value={inv} onChange={setInv} inventories={invs} />
          </Field>
          {current ? (
            <Card>
              <QuickProductForm
                key={current.id}
                inventoryId={current.id}
                invMode={current.mode}
                onCreated={(p) => navigate(`/productos/${p.id}`, { replace: true })}
                onUseExisting={(p) => navigate(`/productos/${p.id}`, { replace: true })}
              />
            </Card>
          ) : null}
        </>
      )}
    </Page>
  );
}

function ProductEdit({ id }: { id: ID }) {
  const p = useLive((d) => d.products.get(id), [id]);
  if (p === undefined) return <Page title="Editar producto" back={`/productos/${id}`}><Loading /></Page>;
  if (!p) return <Page title="Editar producto" back="/inventarios"><Empty title="El producto no existe" /></Page>;
  return <ProductEditForm p={p} />;
}

function ProductEditForm({ p }: { p: Product }) {
  const [f, setF] = useState({ ...p });
  const act = useAction();
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Page title="Editar producto" back={`/productos/${p.id}`}>
      <Card>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act.run(
              () =>
                updateProduct(db, p.id, {
                  name: f.name,
                  brand: f.brand,
                  model: f.model,
                  variant: f.variant,
                  reference: f.reference,
                  capacity: f.capacity,
                  color: f.color,
                  salePrice: f.salePrice,
                  lowStockThreshold: f.lowStockThreshold,
                  location: f.location,
                  notes: f.notes,
                }).then(() => true),
              'Producto actualizado',
            );
            if (ok) goBack(`/productos/${p.id}`);
          }}
        >
          <Field label="Nombre visible" htmlFor="pe-name" error={act.field === 'name' ? act.error : null}>
            <TextInput id="pe-name" value={f.name} onChange={(e) => set('name', e.target.value)} invalid={act.field === 'name'} />
          </Field>
          <div className="grid-2">
            <Field label="Marca" htmlFor="pe-brand">
              <TextInput id="pe-brand" value={f.brand} onChange={(e) => set('brand', e.target.value)} />
            </Field>
            <Field label="Modelo" htmlFor="pe-model">
              <TextInput id="pe-model" value={f.model} onChange={(e) => set('model', e.target.value)} />
            </Field>
            <Field label="Variante" htmlFor="pe-var">
              <TextInput id="pe-var" value={f.variant} onChange={(e) => set('variant', e.target.value)} />
            </Field>
            <Field label="Referencia" htmlFor="pe-ref">
              <TextInput id="pe-ref" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            <Field label="Capacidad" htmlFor="pe-cap">
              <TextInput id="pe-cap" value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
            </Field>
            <Field label="Color" htmlFor="pe-color">
              <TextInput id="pe-color" value={f.color} onChange={(e) => set('color', e.target.value)} />
            </Field>
          </div>
          <Field label="Precio de venta sugerido" htmlFor="pe-price">
            <MoneyInput id="pe-price" value={f.salePrice} onChange={(v) => set('salePrice', v)} />
          </Field>
          <div className="grid-2">
            <Field label="Aviso de stock bajo" htmlFor="pe-low" hint="Vacío = sin aviso">
              <IntInput id="pe-low" value={f.lowStockThreshold} onChange={(v) => set('lowStockThreshold', v)} />
            </Field>
            <Field label="Ubicación" htmlFor="pe-loc">
              <TextInput id="pe-loc" value={f.location} onChange={(e) => set('location', e.target.value)} />
            </Field>
          </div>
          <Field label="Observaciones" htmlFor="pe-notes">
            <textarea id="pe-notes" className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <p className="small muted">
            Tipo: {KIND_LABEL[p.kind]} · Control: {TRACKING_LABEL[p.tracking]} (no se puede cambiar para no alterar las existencias registradas).
          </p>
          <FormError error={act.field === 'name' ? null : act.error} />
          <button className="btn primary block" disabled={act.busy}>
            Guardar cambios
          </button>
        </form>
      </Card>
    </Page>
  );
}

/* ================= Detalle de producto ================= */

const MOVE_LABEL: Record<Movement['type'], string> = {
  purchase: 'Compra',
  initial: 'Stock existente',
  sale: 'Venta',
  return: 'Devolución',
  void_sale: 'Venta anulada',
  void_purchase: 'Compra anulada',
  adjust_in: 'Ajuste de entrada',
  adjust_out: 'Salida / baja',
  status: 'Cambio de estado',
};

export function ProductDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const p = await d.products.get(id);
      if (!p) return null;
      const [inv, units, moves] = await Promise.all([
        d.inventories.get(p.inventoryId),
        p.tracking === 'unit' ? d.units.where('productId').equals(id).toArray() : Promise.resolve([]),
        d.movements.where('productId').equals(id).toArray(),
      ]);
      return { p, inv: inv!, units, moves: moves.sort((a, b) => b.seq - a.seq) };
    },
    [id],
  );
  const [status, setStatus] = useState<'available' | 'in_review' | 'damaged' | 'sold' | 'archived' | 'all'>('available');
  const [partsFilter, setPartsFilter] = useState<'any' | 'repaired' | 'generic' | 'clean'>('any');
  const [adjust, setAdjust] = useState(false);
  const act = useAction();

  const unitsFiltered = useMemo(() => {
    if (!data) return [];
    let list = status === 'all' ? data.units : data.units.filter((u) => u.status === status);
    if (partsFilter === 'repaired') list = list.filter((u) => (u.partsHistory ?? []).length > 0);
    if (partsFilter === 'generic') list = list.filter((u) => (u.partsHistory ?? []).some((x) => x.quality === 'generic' || x.unknownPartWarning));
    if (partsFilter === 'clean') list = list.filter((u) => (u.partsHistory ?? []).length === 0);
    return [...list].sort(fifoOrder);
  }, [data, status, partsFilter]);

  if (data === undefined) return <Page title="Producto" back="/inventarios"><Loading /></Page>;
  if (data === null) return <Page title="Producto" back="/inventarios"><Empty title="El producto no existe" /></Page>;
  const { p, inv, units, moves } = data;
  const pro = inv.mode === 'pro';
  const count = (s: UnitStatus) => units.filter((u) => u.status === s).length;
  const avail = p.tracking === 'quantity' ? p.qty : count('available');
  const availUnits = units.filter((u) => u.status === 'available');
  const value = p.tracking === 'quantity' ? p.stockValue : availUnits.reduce((a, u) => a + (unitCost(u) ?? 0), 0);
  const unknown = p.tracking === 'quantity' ? p.unknownCostQty : availUnits.filter((u) => unitCost(u) === null).length;
  const knownQty = p.tracking === 'quantity' ? p.qty - p.unknownCostQty : availUnits.length - unknown;
  const avg = knownQty > 0 ? Math.round(value / knownQty) : null;
  const canOperate = !inv.archived && !p.archived;

  return (
    <Page help="product"
      title={p.name}
      subtitle={
        <span className="row">
          <a href={`#/inventarios/${inv.id}`}>{inv.name}</a> · {TRACKING_LABEL[p.tracking]} <ModeBadge mode={inv.mode} />
        </span>
      }
      back={`/inventarios/${inv.id}`}
      actions={
        <ActionMenu
          title={p.name}
          actions={[
            { label: 'Editar datos', icon: 'edit', onSelect: () => navigate(`/productos/${id}/editar`) },
            { label: 'Ajustar existencias', icon: 'sliders', hidden: p.tracking !== 'quantity' || !canOperate, onSelect: () => setAdjust(true) },
            {
              label: p.archived ? 'Reactivar producto' : 'Archivar producto',
              icon: 'archive',
              onSelect: async () => {
                const ok = await confirmAction({
                  title: p.archived ? 'Reactivar producto' : 'Archivar producto',
                  message: p.archived ? 'Volverá a aparecer en las listas.' : 'Solo se puede archivar sin existencias. Su historial se conserva.',
                  confirmText: p.archived ? 'Reactivar' : 'Archivar',
                });
                if (ok) await act.run(() => setProductArchived(db, id, !p.archived), p.archived ? 'Producto reactivado' : 'Producto archivado');
              },
            },
          ]}
        />
      }
    >
      {p.archived ? <Notice kind="warn" title="Producto archivado" /> : null}
      <FormError error={act.error} />
      <div className="kpis">
        <Kpi label="Disponibles" value={avail} money={false} foot={p.tracking === 'unit' && count('in_review') + count('damaged') ? `+${count('in_review')} en revisión, ${count('damaged')} dañadas` : undefined} />
        <Kpi label="Valor a costo" value={value} foot={unknown ? `⚠ ${unknown} sin costo conocido` : undefined} />
        <Kpi label={p.tracking === 'quantity' ? 'Costo promedio' : 'Costo medio'} value={avg ?? 0} text={avg === null ? '—' : undefined} foot={avg === null ? 'Sin datos de costo' : p.tracking === 'quantity' ? 'Promedio ponderado' : undefined} />
        <Kpi label="Precio sugerido" value={p.salePrice ?? 0} text={p.salePrice === null ? '—' : undefined} foot={p.salePrice === null ? 'No definido' : avg !== null && p.salePrice ? `Margen estimado ${formatCOP(p.salePrice - avg)}` : undefined} />
      </div>
      {canOperate ? (
        <div className="actions">
          <a className={`btn ${avail ? 'primary' : ''}`} href={`#/ventas/nueva?inv=${inv.id}&product=${id}`} aria-disabled={!avail}>
            <Icon name="tag" /> Vender
          </a>
          <a className="btn" href={`#/compras/nueva?inv=${inv.id}&product=${id}`}>
            <Icon name="cart" /> Comprar
          </a>
          <a className="btn" href={`#/stock/nuevo?inv=${inv.id}&product=${id}`}>
            <Icon name="box" /> Stock existente
          </a>
        </div>
      ) : null}

      {p.tracking === 'unit' ? (
        <>
          <Chips
            label="Estado"
            value={status}
            onChange={setStatus}
            options={[
              ['available', `Disponibles (${count('available')})`],
              ['in_review', `En revisión (${count('in_review')})`],
              ['damaged', `Dañadas (${count('damaged')})`],
              ['sold', `Vendidas (${count('sold')})`],
              ['archived', `Bajas (${count('archived')})`],
              ['all', `Todas (${units.length})`],
            ]}
          />
          {units.some((u) => (u.partsHistory ?? []).length) ? (
            <Chips
              label="Piezas"
              value={partsFilter}
              onChange={setPartsFilter}
              options={[
                ['any', 'Todas las piezas'],
                ['repaired', 'Con piezas cambiadas'],
                ['generic', 'Genéricas o con aviso'],
                ['clean', 'Sin cambios registrados'],
              ]}
            />
          ) : null}
          <Card flush>
            <Paged
              items={unitsFiltered}
              empty={<Empty title="No hay unidades en este estado" />}
              render={(u) => {
                const c = unitCost(u);
                const desc = [u.capacity, u.color, u.condition].filter(Boolean).join(' · ');
                return (
                  <li key={u.id}>
                    <a className="item" href={`#/unidades/${u.id}`}>
                      <span className="item-main">
                        <span className="item-title" style={{ display: 'block' }}>
                          {pro ? <span className="code">{u.code}</span> : null} {desc || (pro ? '' : `Unidad ingresada ${u.acquiredAt ? formatDate(u.acquiredAt) : '(fecha desconocida)'}`)}
                        </span>
                        <span className="item-sub" style={{ display: 'block' }}>
                          {u.status === 'available' || u.status === 'in_review' || u.status === 'damaged' ? <DaysLabel since={u.availableSince} /> : null}
                          {pro && u.imei ? ` · IMEI ${maskImei(u.imei)}` : ''}
                          {u.cycle > 1 ? ` · ciclo ${u.cycle}` : ''}
                          {u.batteryHealth !== null ? ` · batería ${u.batteryHealth} %` : ''}
                        </span>
                        {(u.partsHistory ?? []).length ? (
                          <span style={{ display: 'block', marginTop: 4 }}>
                            <PartsBadges parts={u.partsHistory} compact />
                          </span>
                        ) : null}
                      </span>
                      <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                        <UnitStatusBadge status={u.status} />
                        <span className="small money">{c === null ? 'Costo desconocido' : formatCOP(c)}</span>
                      </span>
                    </a>
                  </li>
                );
              }}
            />
          </Card>
        </>
      ) : null}

      <Card title="Movimientos" flush>
        <Paged
          items={moves}
          pageSize={20}
          empty={<Empty icon="history" title="Sin movimientos" />}
          render={(m) => (
            <li key={m.id}>
              <a className="item" href={m.refType === 'sale' && m.refId ? `#/ventas/${m.refId}` : m.refType === 'purchase' && m.refId ? `#/compras/${m.refId}` : m.unitId ? `#/unidades/${m.unitId}` : undefined} style={!m.refId && !m.unitId ? { cursor: 'default' } : undefined}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {MOVE_LABEL[m.type]}
                    {m.notes ? <span className="muted small"> · {m.notes}</span> : null}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {m.dateUnknown ? 'Fecha real desconocida' : formatDateTime(m.at)}
                    {m.writeOff ? ` · pérdida ${formatCOP(m.writeOff)}` : ''}
                  </span>
                </span>
                <span className="item-side num strong">{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta === 0 ? '±0' : m.qtyDelta}</span>
              </a>
            </li>
          )}
        />
      </Card>
      {p.notes ? (
        <Card title="Observaciones">
          <p className="small wrap-anywhere">{p.notes}</p>
        </Card>
      ) : null}
      {adjust ? <AdjustSheet product={p} onClose={() => setAdjust(false)} /> : null}
    </Page>
  );
}

function AdjustSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState<number | null>(1);
  const [cost, setCost] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(nowISO());
  const [reason, setReason] = useState('');
  const [opId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet title="Ajustar existencias" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act.run(
            () => adjustQuantity(db, { opId, productId: product.id, direction: dir, quantity: qty ?? 0, unitCost: dir === 'in' ? cost : null, date: date ?? '', reason }).then(() => true),
            'Ajuste registrado',
          );
          if (ok) onClose();
        }}
      >
        <Segmented label="Tipo de ajuste" value={dir} onChange={setDir} options={[['out', 'Salida (pérdida, daño)'], ['in', 'Entrada (faltante encontrado)']]} />
        <Notice>
          {dir === 'out'
            ? `Disponibles: ${product.qty}. La salida se valora a costo promedio y se registra como pérdida.`
            : 'Para mercancía comprada use "Comprar"; esto es solo para corregir conteos.'}
        </Notice>
        <div className="grid-2">
          <Field label="Cantidad" htmlFor="adj-q" error={act.field === 'quantity' ? act.error : null}>
            <IntInput id="adj-q" value={qty} min={0} onChange={setQty} invalid={act.field === 'quantity'} />
          </Field>
          {dir === 'in' ? (
            <Field label="Costo por unidad" htmlFor="adj-c" hint="Vacío = desconocido">
              <MoneyInput id="adj-c" value={cost} onChange={setCost} />
            </Field>
          ) : null}
        </div>
        <Field label="Fecha" htmlFor="adj-d">
          <DateTimeInput id="adj-d" value={date} onChange={setDate} />
        </Field>
        <Field label="Motivo" htmlFor="adj-r" error={act.field === 'reason' ? act.error : null}>
          <TextInput id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: se dañaron en bodega" invalid={act.field === 'reason'} />
        </Field>
        <FormError error={act.field === 'quantity' || act.field === 'reason' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Registrar ajuste
        </button>
      </form>
    </Sheet>
  );
}

/* ================= Ingreso de stock existente ================= */

export function StockEntryScreen({ inventoryId, productId }: { inventoryId: string | null; productId: string | null }) {
  const [inv, setInv, invs] = useDefaultInventory(inventoryId);
  const current = invs?.find((i) => i.id === inv) ?? null;
  const [pid, setPid] = useState<ID | null>(productId);
  const product = useLive(async (d) => (pid ? await d.products.get(pid) : null), [pid]);
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState<number | null>(1);
  const [cost, setCost] = useState<number | null>(null);
  const [costUnknown, setCostUnknown] = useState(false);
  const [date, setDate] = useState<string | null>(nowISO());
  const [dateUnknown, setDateUnknown] = useState(false);
  const [notes, setNotes] = useState('');
  const [details, setDetails] = useState<Record<number, UnitDetailValue>>({});
  const [condition, setCondition] = usePref('lastCondition', '');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  const pro = current?.mode === 'pro';
  const validProduct = product && product.inventoryId === inv ? product : null;

  const submit = async () => {
    const units = validProduct?.tracking === 'unit' ? Array.from({ length: qty ?? 0 }, (_, i) => toUnitDetails(details[i], condition)) : undefined;
    const r = await act.run(
      () =>
        registerInitialStock(db, {
          opId,
          productId: validProduct?.id ?? '',
          quantity: qty ?? 0,
          unitCost: costUnknown ? null : cost,
          date: dateUnknown ? null : date,
          notes,
          units,
        }),
      'Stock registrado',
    );
    if (r) {
      setOpId(newOpId());
      navigate(`/productos/${validProduct!.id}`, { replace: true });
    }
  };

  return (
    <Page title="Ingresar stock existente" help="stock" back={inv ? `/inventarios/${inv}` : '/'}>
      <Notice>
        Usa esta opción para la mercancía que ya tenías antes de usar la app. No cuenta como compra del periodo: en Capital cuenta como mercancía aportada. Si no recuerdas el costo o la fecha, márcalos como desconocidos: no se inventan.
      </Notice>
      {!invs ? (
        <Loading />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Inventario" htmlFor="se-inv">
            <InventorySelect id="se-inv" value={inv} onChange={(v) => { setInv(v); setPid(null); }} inventories={invs} />
          </Field>
          {current ? (
            <Field label="Producto" error={act.field === 'productId' ? 'Elige un producto.' : null}>
              <button type="button" className="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setPicking(true)}>
                <span className="ellipsis">{validProduct?.name ?? 'Elegir o crear producto…'}</span>
                <Icon name="chevron" size={18} />
              </button>
              {validProduct ? <span className="hint">{TRACKING_LABEL[validProduct.tracking]}</span> : null}
            </Field>
          ) : null}
          <Field label="Cantidad" htmlFor="se-q" error={act.field === 'quantity' ? act.error : null}>
            <IntInput id="se-q" value={qty} onChange={(v) => setQty(v === null ? null : Math.min(v, validProduct?.tracking === 'quantity' ? 100_000 : 500))} invalid={act.field === 'quantity'} />
          </Field>
          <Field label="Costo por unidad" htmlFor="se-c" error={act.field === 'unitCost' ? act.error : null}>
            {!costUnknown ? <MoneyInput id="se-c" value={cost} onChange={setCost} invalid={act.field === 'unitCost'} /> : null}
            <label className="check">
              <input type="checkbox" checked={costUnknown} onChange={(e) => setCostUnknown(e.target.checked)} /> No sé el costo (quedará como desconocido)
            </label>
          </Field>
          <Field label="Fecha de ingreso" htmlFor="se-d" error={act.field === 'date' ? act.error : null}>
            {!dateUnknown ? <DateTimeInput id="se-d" value={date} onChange={setDate} invalid={act.field === 'date'} /> : null}
            <label className="check">
              <input type="checkbox" checked={dateUnknown} onChange={(e) => setDateUnknown(e.target.checked)} /> Fecha desconocida (se excluye del cálculo de días)
            </label>
          </Field>
          {validProduct?.tracking === 'unit' ? (
            <Field label="Estado del equipo" hint="Nuevo, usado o restaurado. Sirve para los precios y los días de estancado.">
              <ConditionChips value={condition} onChange={setCondition} />
            </Field>
          ) : null}
          {validProduct?.tracking === 'unit' && (qty ?? 0) > 0 ? (
            <details className="more">
              <summary>{pro ? 'IMEI, batería y piezas por equipo (opcional)' : 'Batería y piezas cambiadas por equipo (opcional)'}</summary>
              <div className="stack">
                {Array.from({ length: Math.min(qty ?? 0, 50) }, (_, i) => (
                  <UnitDetailFields key={i} index={i} pro={pro} generalCondition={condition} value={details[i]} onChange={(v) => setDetails((d) => ({ ...d, [i]: v }))} />
                ))}
              </div>
            </details>
          ) : null}
          <Field label="Notas (opcional)" htmlFor="se-n">
            <TextInput id="se-n" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {costUnknown || dateUnknown ? (
            <Notice kind="warn">
              {costUnknown ? 'Las ganancias de estas unidades se mostrarán como incompletas hasta que completes el costo. ' : ''}
              {dateUnknown ? 'No se calcularán días en inventario para estas unidades.' : ''}
            </Notice>
          ) : null}
          <FormError error={['quantity', 'unitCost', 'date'].includes(act.field ?? '') ? null : act.error} />
          <button className="btn primary block" disabled={act.busy || !validProduct}>
            Registrar {qty ?? 0} unidad(es)
          </button>
        </form>
      )}
      {picking && current ? (
        <ProductPicker
          inventoryId={current.id}
          invMode={current.mode}
          mode="stock"
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPid(p.id);
            setPicking(false);
          }}
        />
      ) : null}
    </Page>
  );
}

export interface UnitDetailValue {
  imei: string;
  serial: string;
  color: string;
  /** Vacío = el estado elegido para todos los equipos. */
  condition: string;
  batteryHealth: number | null;
  parts: PartInput[];
}

export const emptyUnitDetail = (): UnitDetailValue => ({ imei: '', serial: '', color: '', condition: '', batteryHealth: null, parts: [] });

/** Convierte los datos del formulario a los que recibe la lógica, aplicando el estado general si la unidad no tiene uno propio. */
export function toUnitDetails(v: UnitDetailValue | undefined, generalCondition: string): UnitDetails {
  const x = v ?? emptyUnitDetail();
  return { imei: x.imei, serial: x.serial, color: x.color, condition: x.condition || generalCondition, batteryHealth: x.batteryHealth, parts: x.parts };
}

export function UnitDetailFields({
  index,
  value,
  onChange,
  pro,
  generalCondition,
}: {
  index: number;
  value?: UnitDetailValue;
  onChange: (v: UnitDetailValue) => void;
  pro: boolean;
  generalCondition: string;
}) {
  const v = value ?? emptyUnitDetail();
  const settings = useLive((d) => d.settings.get('app'));
  const set = <K extends keyof UnitDetailValue>(k: K, x: UnitDetailValue[K]) => onChange({ ...v, [k]: x });
  return (
    <fieldset className="card stack" style={{ margin: 0 }}>
      <legend className="small strong" style={{ padding: '0 4px' }}>
        Equipo {index + 1}
      </legend>
      <div className="grid-2">
        {pro ? (
          <>
            <Field label="IMEI" htmlFor={`ud-imei-${index}`}>
              <TextInput id={`ud-imei-${index}`} inputMode="numeric" autoComplete="off" value={v.imei} onChange={(e) => set('imei', e.target.value)} />
            </Field>
            <Field label="Serial" htmlFor={`ud-ser-${index}`}>
              <TextInput id={`ud-ser-${index}`} autoCapitalize="characters" autoComplete="off" value={v.serial} onChange={(e) => set('serial', e.target.value)} />
            </Field>
            <Field label="Color" htmlFor={`ud-col-${index}`}>
              <TextInput id={`ud-col-${index}`} value={v.color} onChange={(e) => set('color', e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Estado" htmlFor={`ud-cond-${index}`}>
          <select id={`ud-cond-${index}`} className="select" value={v.condition} onChange={(e) => set('condition', e.target.value)}>
            <option value="">{generalCondition ? `Como arriba (${generalCondition})` : 'Sin indicar'}</option>
            {(settings?.conditions ?? STANDARD_CONDITIONS).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Batería %" htmlFor={`ud-bat-${index}`}>
          <IntInput id={`ud-bat-${index}`} value={v.batteryHealth} onChange={(x) => set('batteryHealth', x === null ? null : Math.min(100, x))} placeholder="Desconocida" />
        </Field>
      </div>
      <div className="field">
        <span className="field-label">Reparaciones y piezas cambiadas</span>
        <PartsEditor value={v.parts} onChange={(p) => set('parts', p)} />
      </div>
    </fieldset>
  );
}
