import { useMemo, useState } from 'react';
import {
  createInventory,
  deleteInventoryPermanently,
  formatCOP,
  formatDateTime,
  getDeletionImpact,
  getSettings,
  KIND_LABEL,
  normalizeText,
  renameInventory,
  setInventoryArchived,
  setInventoryMode,
  summarizeUnits,
  TRACKING_LABEL,
  type ID,
  type InventoryMode,
  type ProductKind,
} from '../../core';
import { ModeBadge, useInventories } from '../components/common';
import { Icon, KIND_ICON } from '../components/Icon';
import { ActionMenu, ask, Badge, Card, Chips, confirmAction, Empty, Field, FormError, Loading, Notice, Page, Paged, Segmented, Sheet, TextInput } from '../components/ui';
import { navigate } from '../router';
import { db, toast, useAction, useLive } from '../store';
import { Kpi } from './Home';

export function InventoriesScreen() {
  const invs = useInventories();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const stats = useLive(async (d) => {
    const [products, units] = await Promise.all([d.products.toArray(), d.units.where('status').equals('available').toArray()]);
    const m = new Map<ID, { available: number; value: number }>();
    for (const p of products) {
      const e = m.get(p.inventoryId) ?? { available: 0, value: 0 };
      if (p.tracking === 'quantity') {
        e.available += p.qty;
        e.value += p.stockValue;
      }
      m.set(p.inventoryId, e);
    }
    for (const u of units) {
      const e = m.get(u.inventoryId) ?? { available: 0, value: 0 };
      e.available++;
      e.value += u.baseCost === null ? 0 : u.baseCost + u.extraCost;
      m.set(u.inventoryId, e);
    }
    return m;
  });
  const visible = (invs ?? []).filter((i) => showArchived || !i.archived);
  const archivedCount = (invs ?? []).filter((i) => i.archived).length;
  return (
    <Page
      title="Inventarios"
      actions={
        <button className="icon-btn" aria-label="Nuevo inventario" onClick={() => setCreating(true)}>
          <Icon name="plus" />
        </button>
      }
    >
      {!invs ? (
        <Loading />
      ) : invs.length === 0 ? (
        <Card>
          <Empty title="Aún no tiene inventarios">
            <button className="btn primary" onClick={() => setCreating(true)}>
              Crear inventario
            </button>
          </Empty>
        </Card>
      ) : (
        <Card flush>
          <ul className="list">
            {visible.map((i) => {
              const s = stats?.get(i.id);
              return (
                <li key={i.id}>
                  <a className="item" href={`#/inventarios/${i.id}`}>
                    <span className="muted">
                      <Icon name={i.archived ? 'archive' : 'box'} />
                    </span>
                    <span className="item-main">
                      <span className="item-title" style={{ display: 'block' }}>
                        {i.name}
                      </span>
                      <span className="item-sub" style={{ display: 'block' }}>
                        {s ? `${s.available} disponible(s) · ${formatCOP(s.value)} a costo` : 'Sin existencias'}
                      </span>
                    </span>
                    <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                      <ModeBadge mode={i.mode} />
                      {i.archived ? <Badge>Archivado</Badge> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {archivedCount ? (
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar archivados ({archivedCount})
        </label>
      ) : null}
      <div className="actions">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Nuevo inventario
        </button>
        <a className="btn" href="#/vistas">
          <Icon name="layers" /> Vistas consolidadas
        </a>
      </div>
      {creating ? <CreateInventorySheet onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

function CreateInventorySheet({ onClose }: { onClose: () => void }) {
  const settings = useLive((d) => getSettings(d));
  const [name, setName] = useState('');
  const [mode, setMode] = useState<InventoryMode | null>(null);
  const act = useAction();
  const m = mode ?? settings?.defaultMode ?? 'simple';
  return (
    <Sheet title="Nuevo inventario" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const inv = await act.run(() => createInventory(db, { name, mode: m }), 'Inventario creado');
          if (inv) {
            onClose();
            navigate(`/inventarios/${inv.id}`);
          }
        }}
      >
        <Field label="Nombre" htmlFor="ni-name" error={act.field === 'name' ? act.error : null}>
          <TextInput id="ni-name" placeholder="Ej.: Local centro, Bodega, iPhones usados" value={name} onChange={(e) => setName(e.target.value)} invalid={act.field === 'name'} data-autofocus />
        </Field>
        <Field label="Modalidad" hint={m === 'simple' ? 'Registro rápido de lo esencial.' : 'Trazabilidad completa por unidad (IMEI, inspección, garantías, fotos).'}>
          <Segmented label="Modalidad" value={m} onChange={setMode} options={[['simple', 'Sencillo'], ['pro', 'Profesional']]} />
        </Field>
        <FormError error={act.field === 'name' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Crear
        </button>
      </form>
    </Sheet>
  );
}

interface Row {
  id: ID;
  name: string;
  kind: ProductKind;
  tracking: 'unit' | 'quantity';
  available: number;
  inReview: number;
  damaged: number;
  value: number;
  unknownCost: number;
  low: boolean;
  archived: boolean;
}

export function InventoryDetailScreen({ id }: { id: ID }) {
  const inv = useLive((d) => d.inventories.get(id), [id]);
  const rows = useLive(
    async (d): Promise<Row[]> => {
      const products = await d.products.where('inventoryId').equals(id).toArray();
      const units = await d.units.where('inventoryId').equals(id).toArray();
      return products
        .map((p) => {
          if (p.tracking === 'quantity')
            return { id: p.id, name: p.name, kind: p.kind, tracking: p.tracking, available: p.qty, inReview: 0, damaged: 0, value: p.stockValue, unknownCost: p.unknownCostQty, low: p.lowStockThreshold !== null && p.qty <= p.lowStockThreshold, archived: p.archived };
          const s = summarizeUnits(units.filter((u) => u.productId === p.id));
          return { id: p.id, name: p.name, kind: p.kind, tracking: p.tracking, available: s.available, inReview: s.inReview, damaged: s.damaged, value: s.availableValue, unknownCost: s.unknownCostCount, low: p.lowStockThreshold !== null && s.available <= p.lowStockThreshold, archived: p.archived };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    [id],
  );
  const [kind, setKind] = useState<'all' | ProductKind>('all');
  const [q, setQ] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const act = useAction();

  const filtered = useMemo(() => {
    const nq = normalizeText(q);
    return (rows ?? []).filter(
      (r) => (kind === 'all' || r.kind === kind) && (!nq || normalizeText(r.name).includes(nq)) && (showEmpty ? true : !r.archived && r.available + r.inReview + r.damaged > 0),
    );
  }, [rows, kind, q, showEmpty]);

  if (inv === undefined) return <Page title="Inventario" back="/inventarios"><Loading /></Page>;
  if (inv === null || !inv) return <Page title="Inventario" back="/inventarios"><Empty title="El inventario no existe" /></Page>;

  const totals = (rows ?? []).reduce((a, r) => ({ available: a.available + r.available, value: a.value + r.value, other: a.other + r.inReview + r.damaged, unknown: a.unknown + r.unknownCost }), { available: 0, value: 0, other: 0, unknown: 0 });
  const pro = inv.mode === 'pro';

  const changeMode = async () => {
    const next: InventoryMode = pro ? 'simple' : 'pro';
    const ok = await confirmAction({
      title: `Cambiar a modo ${next === 'pro' ? 'profesional' : 'sencillo'}`,
      message: (
        <p>
          {next === 'pro'
            ? 'Se mostrarán los campos avanzados (códigos, IMEI, inspección, garantías). Podrá completarlos poco a poco; no es obligatorio llenar datos antiguos.'
            : 'Se ocultarán los campos avanzados. No se borra nada: los datos profesionales se conservan y vuelven a verse al regresar al modo profesional.'}{' '}
          Los costos, el historial y las estadísticas no cambian.
        </p>
      ),
      confirmText: 'Cambiar modalidad',
    });
    if (ok) await act.run(() => setInventoryMode(db, id, next), 'Modalidad cambiada');
  };
  const rename = async () => {
    const r = await ask({ title: 'Renombrar inventario', input: { label: 'Nuevo nombre', initial: inv.name, required: true }, confirmText: 'Guardar' });
    if (r.ok) await act.run(() => renameInventory(db, id, r.value), 'Nombre actualizado');
  };
  const archive = async () => {
    const ok = await confirmAction({
      title: inv.archived ? 'Desarchivar inventario' : 'Archivar inventario',
      message: inv.archived ? 'Volverá a aceptar compras y ventas.' : 'No se borra nada: su historia y estadísticas se conservan, pero no podrá registrar operaciones nuevas hasta desarchivarlo.',
      confirmText: inv.archived ? 'Desarchivar' : 'Archivar',
    });
    if (ok) await act.run(() => setInventoryArchived(db, id, !inv.archived), inv.archived ? 'Inventario desarchivado' : 'Inventario archivado');
  };
  const remove = async () => {
    const impact = await getDeletionImpact(db, id);
    const r = await ask({
      title: 'Eliminar permanentemente',
      danger: true,
      confirmText: 'Eliminar para siempre',
      message: (
        <>
          <Notice kind="bad" title="Esta acción no se puede deshacer">
            Se borrarán {impact.products} producto(s), {impact.units} unidad(es), {impact.purchases} compra(s), {impact.sales} venta(s), {impact.expenses} gasto(s) y {impact.warranties} garantía(s) de este inventario. Las cifras financieras de esas operaciones desaparecerán de los informes.
          </Notice>
          <p className="small">Si solo quiere dejar de usarlo, es mejor archivarlo. Considere hacer un respaldo antes.</p>
        </>
      ),
      input: { label: `Escriba "${inv.name}" para confirmar`, required: true, mustEqual: inv.name },
    });
    if (!r.ok) return;
    const done = await act.run(() => deleteInventoryPermanently(db, id, r.value).then(() => true));
    if (done) {
      toast('Inventario eliminado');
      navigate('/inventarios', { replace: true });
    }
  };

  return (
    <Page
      title={inv.name}
      subtitle={
        <span className="row">
          <ModeBadge mode={inv.mode} /> {inv.archived ? <Badge>Archivado</Badge> : null}
        </span>
      }
      back="/inventarios"
      actions={
        <ActionMenu
          title={inv.name}
          actions={[
            { label: pro ? 'Cambiar a modo sencillo' : 'Cambiar a modo profesional', icon: 'sliders', onSelect: changeMode },
            { label: 'Editar nombre', icon: 'edit', onSelect: rename },
            { label: 'Consultar historial', icon: 'history', onSelect: () => navigate(`/historial?inv=${id}`) },
            { label: 'Ver compras y ventas', icon: 'list', onSelect: () => navigate(`/operaciones?tab=ventas&inv=${id}`) },
            { label: inv.archived ? 'Desarchivar' : 'Archivar', icon: 'archive', onSelect: archive },
            { label: 'Eliminar permanentemente', icon: 'trash', danger: true, onSelect: remove },
          ]}
        />
      }
    >
      {inv.archived ? <Notice kind="warn" title="Inventario archivado">Solo consulta. Desarchívelo desde el menú ⋮ para registrar operaciones.</Notice> : null}
      <div className="kpis">
        <Kpi label="Disponibles" value={totals.available} money={false} foot={totals.other ? `+${totals.other} en revisión o dañadas` : undefined} />
        <Kpi label="Valor a costo" value={totals.value} foot={totals.unknown ? `⚠ ${totals.unknown} sin costo conocido` : undefined} />
      </div>
      {!inv.archived ? (
        <div className="actions">
          <a className="btn primary" href={`#/ventas/nueva?inv=${id}`}>
            <Icon name="tag" /> Vender
          </a>
          <a className="btn" href={`#/compras/nueva?inv=${id}`}>
            <Icon name="cart" /> Comprar
          </a>
          <a className="btn" href={`#/stock/nuevo?inv=${id}`}>
            <Icon name="box" /> Stock existente
          </a>
          <a className="btn" href={`#/productos/nuevo?inv=${id}`}>
            <Icon name="plus" /> Producto
          </a>
        </div>
      ) : null}
      <TextInput type="search" placeholder="Buscar producto" aria-label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
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
      <Card flush>
        {!rows ? (
          <Loading />
        ) : (
          <Paged
            items={filtered}
            empty={<Empty title={rows.length ? 'No hay productos con existencias para este filtro' : 'Aún no hay productos'}>{!rows.length && !inv.archived ? <a className="btn" href={`#/compras/nueva?inv=${id}`}>Registrar la primera compra</a> : null}</Empty>}
            render={(r) => (
              <li key={r.id}>
                <a className="item" href={`#/productos/${r.id}`}>
                  <span className="muted">
                    <Icon name={KIND_ICON[r.kind]} />
                  </span>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {r.name}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {KIND_LABEL[r.kind]} · {TRACKING_LABEL[r.tracking]} · {formatCOP(r.value)}
                      {r.unknownCost ? ' · ⚠ costo incompleto' : ''}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <Badge kind={r.available > 0 ? (r.low ? 'warn' : 'ok') : 'bad'}>
                      {r.low ? '⚠ ' : ''}
                      {r.available} disp.
                    </Badge>
                    {r.inReview + r.damaged ? <span className="tiny muted">+{r.inReview + r.damaged} no disp.</span> : null}
                    {r.archived ? <Badge>Archivado</Badge> : null}
                  </span>
                </a>
              </li>
            )}
          />
        )}
      </Card>
      <label className="check">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Mostrar productos agotados y archivados
      </label>
      <FormError error={act.error} />
    </Page>
  );
}

const ENTITY_LABEL: Record<string, string> = {
  inventory: 'Inventario',
  product: 'Producto',
  unit: 'Unidad',
  purchase: 'Compra',
  sale: 'Venta',
  expense: 'Gasto',
  warranty: 'Garantía',
  settings: 'Configuración',
  backup: 'Respaldo',
  view: 'Vista',
  supplier: 'Proveedor',
  customer: 'Comprador',
  catalog: 'Catálogo',
};

export function historyHref(h: { entityType: string; entityId: string }): string | undefined {
  switch (h.entityType) {
    case 'inventory':
      return `/inventarios/${h.entityId}`;
    case 'product':
      return `/productos/${h.entityId}`;
    case 'unit':
      return `/unidades/${h.entityId}`;
    case 'purchase':
      return `/compras/${h.entityId}`;
    case 'sale':
      return `/ventas/${h.entityId}`;
    case 'expense':
      return `/gastos/${h.entityId}`;
    case 'warranty':
      return `/garantias/${h.entityId}`;
    case 'supplier':
      return `/proveedores/${h.entityId}`;
    case 'customer':
      return `/compradores/${h.entityId}`;
  }
  return undefined;
}

export function HistoryScreen({ inventoryId }: { inventoryId: ID | null }) {
  const inv = useLive(async (d) => (inventoryId ? await d.inventories.get(inventoryId) : null), [inventoryId]);
  const list = useLive(
    async (d) => {
      const all = inventoryId ? await d.history.where('inventoryId').equals(inventoryId).toArray() : await d.history.toArray();
      return all.sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    [inventoryId],
  );
  return (
    <Page title="Historial" subtitle={inv?.name ?? 'Todos los registros'} back={inventoryId ? `/inventarios/${inventoryId}` : '/mas'}>
      <Card flush>
        {!list ? (
          <Loading />
        ) : (
          <Paged
            items={list}
            pageSize={60}
            empty={<Empty icon="history" title="Sin registros" />}
            render={(h) => {
              const href = historyHref(h);
              const body = (
                <>
                  <span className="item-main">
                    <span style={{ display: 'block' }} className="small">
                      {h.summary}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {ENTITY_LABEL[h.entityType] ?? h.entityType} · {formatDateTime(h.at)}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={h.id}>
                  {href ? (
                    <a className="item" href={`#${href}`}>
                      {body}
                    </a>
                  ) : (
                    <div className="item" style={{ cursor: 'default' }}>
                      {body}
                    </div>
                  )}
                </li>
              );
            }}
          />
        )}
      </Card>
    </Page>
  );
}
