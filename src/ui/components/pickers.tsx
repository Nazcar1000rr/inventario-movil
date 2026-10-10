import { useMemo, useState } from 'react';
import {
  AppError,
  createCustomer,
  createProduct,
  createSupplier,
  daysBetween,
  defaultTracking,
  fifoOrder,
  formatCOP,
  KIND_LABEL,
  normalizeText,
  summarizeUnits,
  TRACKING_LABEL,
  unitCost,
  type CatalogModel,
  type ID,
  type InventoryMode,
  type Product,
  type ProductKind,
  type Tracking,
  type Unit,
} from '../../core';
import { db, useAction, useLive } from '../store';
import { maskImei } from './common';
import { Icon, KIND_ICON } from './Icon';
import { Badge, Chips, Empty, Field, FormError, IntInput, Loading, MoneyInput, Notice, Segmented, Sheet, TextInput } from './ui';

/* ================= Producto ================= */

export interface ProductWithStock extends Product {
  available: number;
}

export function useProductsWithStock(inventoryId: ID | null): ProductWithStock[] | undefined {
  return useLive(
    async (d) => {
      if (!inventoryId) return [];
      const products = (await d.products.where('inventoryId').equals(inventoryId).toArray()).filter((p) => !p.archived);
      const unitIds = products.filter((p) => p.tracking === 'unit').map((p) => p.id);
      const units = unitIds.length ? await d.units.where('productId').anyOf(unitIds).toArray() : [];
      return products
        .map((p) => ({
          ...p,
          available: p.tracking === 'quantity' ? p.qty : summarizeUnits(units.filter((u) => u.productId === p.id)).available,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    [inventoryId],
  );
}

export function ProductPicker({
  inventoryId,
  mode,
  invMode,
  onPick,
  onClose,
}: {
  inventoryId: ID;
  mode: 'purchase' | 'sale' | 'stock';
  invMode: InventoryMode;
  onPick: (p: Product) => void;
  onClose: () => void;
}) {
  const products = useProductsWithStock(inventoryId);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ProductKind>('all');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => {
    const nq = normalizeText(q);
    return (products ?? []).filter(
      (p) => (kind === 'all' || p.kind === kind) && (!nq || normalizeText(`${p.name} ${p.brand} ${p.reference}`).includes(nq)),
    );
  }, [products, q, kind]);

  if (creating)
    return (
      <Sheet title="Nuevo producto" onClose={() => setCreating(false)} full>
        <QuickProductForm
          inventoryId={inventoryId}
          invMode={invMode}
          initialName={q}
          onCreated={(p) => {
            setCreating(false);
            onPick(p);
          }}
          onUseExisting={(p) => {
            setCreating(false);
            onPick(p);
          }}
        />
      </Sheet>
    );

  return (
    <Sheet title={mode === 'sale' ? 'Elegir producto a vender' : 'Elegir producto'} onClose={onClose} full>
      <TextInput type="search" placeholder="Buscar por nombre, marca o referencia" aria-label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      <Chips
        label="Tipo"
        value={kind}
        onChange={setKind}
        options={[
          ['all', 'Todos'],
          ['phone', 'Teléfonos'],
          ['audio', 'Audífonos'],
          ['accessory', 'Accesorios'],
          ['other', 'Otros'],
        ]}
      />
      {mode !== 'sale' ? (
        <button className="btn block" type="button" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Crear producto nuevo
        </button>
      ) : null}
      {!products ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title={products.length ? 'Sin resultados' : 'Este inventario no tiene productos'}>
          {mode === 'sale' ? <p className="small">Primero registra una compra o un ingreso de stock.</p> : null}
        </Empty>
      ) : (
        <ul className="list card flush">
          {list.map((p) => {
            const disabled = mode === 'sale' && p.available <= 0;
            return (
              <li key={p.id}>
                <button className="item" type="button" disabled={disabled} style={disabled ? { opacity: 0.5 } : undefined} onClick={() => onPick(p)}>
                  <span className="muted">
                    <Icon name={KIND_ICON[p.kind]} />
                  </span>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {p.name}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {KIND_LABEL[p.kind]} · {TRACKING_LABEL[p.tracking]}
                      {p.salePrice !== null ? ` · Precio ${formatCOP(p.salePrice)}` : ''}
                    </span>
                  </span>
                  <span className="item-side">
                    <Badge kind={p.available > 0 ? 'ok' : undefined}>{p.available} disp.</Badge>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

export function QuickProductForm({
  inventoryId,
  invMode,
  initialName = '',
  onCreated,
  onUseExisting,
  submitLabel = 'Crear producto',
}: {
  inventoryId: ID;
  invMode: InventoryMode;
  initialName?: string;
  onCreated: (p: Product) => void;
  onUseExisting?: (p: Product) => void;
  submitLabel?: string;
}) {
  const catalog = useLive((d) => d.catalogModels.toArray());
  const [kind, setKind] = useState<ProductKind>('phone');
  const [brand, setBrand] = useState('Apple');
  const [catalogId, setCatalogId] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState('');
  const [variant, setVariant] = useState('');
  const [name, setName] = useState(initialName);
  const [reference, setReference] = useState('');
  const [color, setColor] = useState('');
  const [tracking, setTracking] = useState<Tracking>(defaultTracking('phone'));
  const [salePrice, setSalePrice] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [dup, setDup] = useState<Product | null>(null);
  const act = useAction();

  const brands = useMemo(() => {
    const s = new Set((catalog ?? []).filter((c) => c.category === kind && !c.archived).map((c) => c.brand));
    return [...s].sort();
  }, [catalog, kind]);
  const models: CatalogModel[] = useMemo(
    () => (catalog ?? []).filter((c) => c.category === kind && c.brand === brand && !c.archived),
    [catalog, kind, brand],
  );
  const selected = models.find((m) => m.id === catalogId) ?? null;
  const usesCatalog = (kind === 'phone' || kind === 'audio') && models.length > 0;

  const changeKind = (k: ProductKind) => {
    setKind(k);
    setTracking(defaultTracking(k));
    setCatalogId('');
    setCapacity('');
    setBrand(k === 'phone' || k === 'audio' ? 'Apple' : '');
  };

  const submit = async (allowDuplicate = false) => {
    setDup(null);
    const res = await act.run(async () => {
      try {
        return await createProduct(
          db,
          {
            inventoryId,
            kind,
            tracking,
            catalogModelId: usesCatalog && catalogId ? catalogId : null,
            brand,
            model: usesCatalog ? selected?.model ?? model : model,
            capacity,
            variant,
            name: usesCatalog && catalogId ? '' : name,
            reference,
            color: tracking === 'quantity' ? color : '',
            salePrice,
            lowStockThreshold: low,
          },
          { allowDuplicate },
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'duplicate_product') {
          const list = await db.products.where('inventoryId').equals(inventoryId).toArray();
          const n = normalizeText(e.message.match(/"(.+?)"/)?.[1] ?? '');
          setDup(list.find((p) => normalizeText(p.name) === n) ?? null);
        }
        throw e;
      }
    }, 'Producto creado');
    if (res) onCreated(res);
  };

  if (!catalog) return <Loading />;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Tipo de producto">
        <Segmented
          label="Tipo de producto"
          value={kind}
          onChange={changeKind}
          options={[
            ['phone', 'Teléfono'],
            ['audio', 'Audífonos'],
            ['accessory', 'Accesorio'],
            ['other', 'Otro'],
          ]}
        />
      </Field>
      {kind === 'phone' || kind === 'audio' ? (
        <Field label="Marca" htmlFor="qp-brand">
          <select
            id="qp-brand"
            className="select"
            value={brands.includes(brand) ? brand : '__other'}
            onChange={(e) => {
              setBrand(e.target.value === '__other' ? '' : e.target.value);
              setCatalogId('');
            }}
          >
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value="__other">Otra marca…</option>
          </select>
          {!brands.includes(brand) ? <TextInput aria-label="Marca" placeholder="Ej.: Samsung, Xiaomi" value={brand} onChange={(e) => setBrand(e.target.value)} /> : null}
        </Field>
      ) : null}
      {usesCatalog ? (
        <>
          <Field label="Modelo" htmlFor="qp-model" error={act.field === 'name' ? act.error : null}>
            <select id="qp-model" className="select" value={catalogId} onChange={(e) => { setCatalogId(e.target.value); setCapacity(''); }}>
              <option value="">Elige el modelo…</option>
              {groupByGeneration(models).map(([gen, ms]) => (
                <optgroup key={gen} label={gen}>
                  {ms.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.model}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {selected && selected.storageOptions.length ? (
            <Field label="Capacidad">
              <Chips label="Capacidad" value={capacity} onChange={setCapacity} options={selected.storageOptions.map((s) => [s, s] as [string, string])} />
            </Field>
          ) : null}
        </>
      ) : (
        <>
          <Field label={kind === 'phone' || kind === 'audio' ? 'Modelo' : 'Nombre del producto'} htmlFor="qp-name" error={act.field === 'name' ? act.error : null}>
            <TextInput
              id="qp-name"
              placeholder={kind === 'accessory' ? 'Ej.: Cargador USB-C 20 W' : 'Ej.: Galaxy S24'}
              value={kind === 'phone' || kind === 'audio' ? model : name}
              onChange={(e) => (kind === 'phone' || kind === 'audio' ? setModel(e.target.value) : setName(e.target.value))}
              invalid={act.field === 'name'}
            />
          </Field>
          {kind === 'phone' ? (
            <Field label="Capacidad (opcional)" htmlFor="qp-cap">
              <TextInput id="qp-cap" placeholder="Ej.: 128 GB" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          ) : null}
        </>
      )}
      {kind === 'accessory' || kind === 'other' ? (
        <div className="grid-2">
          <Field label="Marca (opcional)" htmlFor="qp-b2">
            <TextInput id="qp-b2" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Referencia (opcional)" htmlFor="qp-ref">
            <TextInput id="qp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      ) : null}
      <Field
        label="Control de existencias"
        hint={
          tracking === 'unit'
            ? 'Cada unidad física se registra por separado (código interno, IMEI, estado). Recomendado para teléfonos.'
            : 'Se cuenta por cantidad (lote) con costo promedio. Recomendado para accesorios económicos.'
        }
      >
        <Segmented
          label="Control de existencias"
          value={tracking}
          onChange={setTracking}
          options={[
            ['unit', TRACKING_LABEL.unit],
            ['quantity', TRACKING_LABEL.quantity],
          ]}
        />
      </Field>
      <details className="more" open={invMode === 'pro'}>
        <summary>Más detalles (opcional)</summary>
        <div className="stack">
          {kind === 'phone' ? (
            <Field label="Variante (opcional)" htmlFor="qp-var" hint="Ej.: Dual SIM, versión de EE. UU.">
              <TextInput id="qp-var" value={variant} onChange={(e) => setVariant(e.target.value)} />
            </Field>
          ) : null}
          {tracking === 'quantity' ? (
            <Field label="Color (opcional)" htmlFor="qp-color">
              <TextInput id="qp-color" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Precio de venta sugerido (opcional)" htmlFor="qp-price">
            <MoneyInput id="qp-price" value={salePrice} onChange={setSalePrice} />
          </Field>
          <Field label="Avisar cuando queden (opcional)" htmlFor="qp-low" hint="Muestra un aviso de stock bajo al llegar a esta cantidad.">
            <IntInput id="qp-low" value={low} onChange={setLow} placeholder="Sin aviso" />
          </Field>
        </div>
      </details>
      {dup ? (
        <Notice kind="warn" title={`Ya existe "${dup.name}" en este inventario`}>
          <div className="actions" style={{ marginTop: 8 }}>
            {onUseExisting ? (
              <button type="button" className="btn primary sm" onClick={() => onUseExisting(dup)}>
                Usar el existente
              </button>
            ) : null}
            <button type="button" className="btn sm" onClick={() => void submit(true)}>
              Crear de todas formas
            </button>
          </div>
        </Notice>
      ) : (
        <FormError error={act.field === 'name' ? null : act.error} />
      )}
      <button className="btn primary block" type="submit" disabled={act.busy}>
        {act.busy ? 'Guardando…' : submitLabel}
      </button>
    </form>
  );
}

function groupByGeneration(models: CatalogModel[]): [string, CatalogModel[]][] {
  const m = new Map<string, CatalogModel[]>();
  for (const x of models) {
    const arr = m.get(x.generation) ?? [];
    arr.push(x);
    m.set(x.generation, arr);
  }
  return [...m.entries()];
}

/* ================= Unidades ================= */

export function UnitPicker({
  productId,
  selected,
  onDone,
  onClose,
  pro,
}: {
  productId: ID;
  selected: ID[];
  onDone: (ids: ID[]) => void;
  onClose: () => void;
  pro: boolean;
}) {
  const units = useLive(async (d) => (await d.units.where('productId').equals(productId).filter((u) => u.status === 'available').toArray()).sort(fifoOrder), [productId]);
  const [sel, setSel] = useState<Set<ID>>(new Set(selected));
  const [q, setQ] = useState('');
  const filtered = (units ?? []).filter((u: Unit) => {
    const n = q.trim().toUpperCase();
    return !n || u.code.includes(n) || u.imei.includes(n) || u.serial.includes(n) || u.color.toUpperCase().includes(n);
  });
  return (
    <Sheet
      title="Elegir unidades"
      onClose={onClose}
      full
      footer={
        <button className="btn primary block" type="button" disabled={sel.size === 0} onClick={() => onDone([...sel])}>
          Usar {sel.size} unidad(es)
        </button>
      }
    >
      <TextInput type="search" placeholder="Buscar código, IMEI, serial o color" aria-label="Buscar unidad" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="small muted">Ordenadas de la más antigua a la más reciente.</p>
      {!units ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty title="No hay unidades disponibles" />
      ) : (
        <ul className="list card flush">
          {filtered.map((u) => {
            const c = unitCost(u);
            const checked = sel.has(u.id);
            return (
              <li key={u.id}>
                <label className="item">
                  <input
                    type="checkbox"
                    style={{ width: 22, height: 22, accentColor: 'var(--primary)' }}
                    checked={checked}
                    onChange={() => {
                      const n = new Set(sel);
                      if (checked) n.delete(u.id);
                      else n.add(u.id);
                      setSel(n);
                    }}
                  />
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {pro ? <span className="code">{u.code}</span> : null} {[u.capacity, u.color, u.condition].filter(Boolean).join(' · ') || (pro ? '' : 'Unidad')}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {u.availableSince ? `${daysBetween(u.availableSince)} días en inventario` : 'Fecha desconocida'}
                      {pro && u.imei ? ` · IMEI ${maskImei(u.imei)}` : ''}
                      {u.batteryHealth !== null ? ` · Batería ${u.batteryHealth}%` : ''}
                    </span>
                  </span>
                  <span className="item-side small">{c === null ? <Badge kind="warn">Costo desconocido</Badge> : <span className="money">{formatCOP(c)}</span>}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/* ================= Proveedores / compradores ================= */

export function PartyPicker({ type, onPick, onClose }: { type: 'supplier' | 'customer'; onPick: (id: ID | null, name: string) => void; onClose: () => void }) {
  const list = useLive(async (d) => (type === 'supplier' ? await d.suppliers.toArray() : await d.customers.toArray()).filter((x) => !x.archived), [type]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [dupMsg, setDupMsg] = useState<string | null>(null);
  const act = useAction();
  const label = type === 'supplier' ? 'proveedor' : 'comprador';
  const nq = normalizeText(q);
  const filtered = (list ?? [])
    .filter((x) => !nq || normalizeText(`${x.name} ${x.phone} ${x.city}`).includes(nq))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const create = async (allowDuplicate = false) => {
    setDupMsg(null);
    const r = await act.run(async () => {
      try {
        return type === 'supplier'
          ? await createSupplier(db, { name, phone, city }, { allowDuplicate })
          : await createCustomer(db, { name, phone, city }, { allowDuplicate });
      } catch (e) {
        if (e instanceof AppError && e.code.startsWith('duplicate')) setDupMsg(e.message);
        throw e;
      }
    });
    if (r) onPick(r.id, r.name);
  };

  if (creating)
    return (
      <Sheet title={`Nuevo ${label}`} onClose={() => setCreating(false)}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Nombre o empresa" htmlFor="pp-name" error={act.field === 'name' && !dupMsg ? act.error : null}>
            <TextInput id="pp-name" value={name} onChange={(e) => setName(e.target.value)} invalid={act.field === 'name'} data-autofocus />
          </Field>
          <div className="grid-2">
            <Field label="Teléfono (opcional)" htmlFor="pp-phone">
              <TextInput id="pp-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Ciudad (opcional)" htmlFor="pp-city">
              <TextInput id="pp-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
          </div>
          {dupMsg ? (
            <Notice kind="warn" title="Posible duplicado">
              <p>{dupMsg}</p>
              <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => void create(true)}>
                Crear de todas formas
              </button>
            </Notice>
          ) : null}
          <button className="btn primary block" type="submit" disabled={act.busy}>
            Guardar {label}
          </button>
        </form>
      </Sheet>
    );

  return (
    <Sheet title={`Elegir ${label}`} onClose={onClose} full>
      <TextInput type="search" placeholder="Buscar por nombre, teléfono o ciudad" aria-label={`Buscar ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="actions">
        <button
          className="btn"
          type="button"
          onClick={() => {
            setName(q);
            setCreating(true);
          }}
        >
          <Icon name="plus" /> Nuevo {label}
        </button>
        <button className="btn" type="button" onClick={() => onPick(null, '')}>
          Sin {label}
        </button>
      </div>
      {!list ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty title={list.length ? 'Sin resultados' : `Aún no hay ${label}es guardados`} />
      ) : (
        <ul className="list card flush">
          {filtered.map((x) => (
            <li key={x.id}>
              <button className="item" type="button" onClick={() => onPick(x.id, x.name)}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {x.name}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {[x.phone, x.city].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function PartyField({ type, value, onChange }: { type: 'supplier' | 'customer'; value: ID | null; onChange: (id: ID | null) => void }) {
  const [open, setOpen] = useState(false);
  const party = useLive(async (d) => (value ? (type === 'supplier' ? await d.suppliers.get(value) : await d.customers.get(value)) : null), [value, type]);
  const label = type === 'supplier' ? 'Proveedor' : 'Comprador';
  return (
    <Field label={`${label} (opcional)`}>
      <button type="button" className="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setOpen(true)}>
        <span className="ellipsis">{party?.name ?? `Sin ${label.toLowerCase()}`}</span>
        <Icon name="chevron" size={18} />
      </button>
      {open ? (
        <PartyPicker
          type={type}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      ) : null}
    </Field>
  );
}
