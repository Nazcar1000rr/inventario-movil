import { useState } from 'react';
import {
  createView,
  deleteView,
  formatCOP,
  getBalances,
  getFinancialSummary,
  getStockOverview,
  updateView,
  type ConsolidatedView,
  type ID,
  type StockGroup,
} from '../../core';
import { PeriodPicker, useInventories, usePeriod } from '../components/common';
import { Icon, KIND_ICON } from '../components/Icon';
import { ActionMenu, ask, Badge, Card, confirmAction, Empty, Field, FormError, Loading, Notice, Page, Paged, Sheet, TextInput } from '../components/ui';
import { navigate } from '../router';
import { db, toast, useAction, useLive } from '../store';
import { Kpi } from './Home';

export function ViewsScreen() {
  const views = useLive((d) => d.consolidatedViews.toArray());
  const invs = useInventories();
  const [creating, setCreating] = useState(false);
  const name = new Map((invs ?? []).map((i) => [i.id, i.name]));
  return (
    <Page
      title="Vistas consolidadas"
      back="/mas"
      actions={
        <button className="icon-btn" aria-label="Nueva vista" onClick={() => setCreating(true)}>
          <Icon name="plus" />
        </button>
      }
    >
      <Notice>
        Una vista consolidada suma varios inventarios para consultarlos juntos. Es solo una consulta: no mueve ni duplica productos, compras, ventas ni dinero. Cada unidad sigue perteneciendo a su inventario de origen.
      </Notice>
      <Card flush>
        {!views ? (
          <Loading />
        ) : views.length === 0 ? (
          <Empty icon="layers" title="Aún no hay vistas">
            <button className="btn primary" onClick={() => setCreating(true)}>
              Crear vista
            </button>
          </Empty>
        ) : (
          <ul className="list">
            {views.map((v) => (
              <li key={v.id}>
                <a className="item" href={`#/vistas/${v.id}`}>
                  <span className="muted">
                    <Icon name="layers" />
                  </span>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {v.name}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {v.inventoryIds.map((i) => name.get(i) ?? '—').join(' + ')}
                    </span>
                  </span>
                  {v.archived ? <Badge>Archivada</Badge> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating ? <ViewEditor onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

function ViewEditor({ view, onClose }: { view?: ConsolidatedView; onClose: () => void }) {
  const invs = useInventories();
  const [name, setName] = useState(view?.name ?? '');
  const [sel, setSel] = useState<Set<ID>>(new Set(view?.inventoryIds ?? []));
  const act = useAction();
  return (
    <Sheet
      title={view ? 'Editar vista' : 'Nueva vista consolidada'}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => (view ? updateView(db, view.id, { name, inventoryIds: [...sel] }).then(() => view) : createView(db, { name, inventoryIds: [...sel] })), 'Vista guardada');
            if (r) {
              onClose();
              if (!view) navigate(`/vistas/${r.id}`);
            }
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Nombre" htmlFor="vw-name" error={act.field === 'name' ? act.error : null}>
        <TextInput id="vw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Todo el negocio" />
      </Field>
      <div className="field">
        <span className="field-label">Inventarios incluidos (mínimo 2)</span>
        {(invs ?? []).map((i) => (
          <label key={i.id} className="check">
            <input
              type="checkbox"
              checked={sel.has(i.id)}
              onChange={() => {
                const n = new Set(sel);
                if (n.has(i.id)) n.delete(i.id);
                else n.add(i.id);
                setSel(n);
              }}
            />
            {i.name}
            {i.archived ? ' (archivado)' : ''}
          </label>
        ))}
        {act.field === 'inventoryIds' ? <span className="error">{act.error}</span> : null}
      </div>
      <FormError error={act.field ? null : act.error} />
    </Sheet>
  );
}

export function ViewDetailScreen({ id }: { id: ID }) {
  const view = useLive((d) => d.consolidatedViews.get(id), [id]);
  const invs = useInventories();
  const period = usePeriod('viewPeriod');
  const ids = view?.inventoryIds ?? [];
  const key = JSON.stringify([ids, period.range.current]);
  const data = useLive(
    async (d) => {
      if (!ids.length) return null;
      const [groups, bal, fin] = await Promise.all([getStockOverview(d, ids), getBalances(d, ids), getFinancialSummary(d, period.range.current, ids)]);
      return { groups, bal, fin };
    },
    [key],
  );
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState<StockGroup | null>(null);
  const act = useAction();
  if (view === undefined) return <Page title="Vista" back="/vistas"><Loading /></Page>;
  if (!view) return <Page title="Vista" back="/vistas"><Empty title="La vista no existe" /></Page>;
  const invName = new Map((invs ?? []).map((i) => [i.id, i]));

  const sell = (g: StockGroup) => {
    const withStock = g.sources.filter((s) => s.available > 0);
    if (withStock.length === 1) navigate(`/ventas/nueva?inv=${withStock[0].inventoryId}&product=${withStock[0].productId}`);
    else setSelling(g);
  };

  return (
    <Page
      title={view.name}
      subtitle={`Vista de ${view.inventoryIds.length} inventarios`}
      back="/vistas"
      actions={
        <ActionMenu
          title={view.name}
          actions={[
            { label: 'Editar nombre e inventarios', icon: 'edit', onSelect: () => setEditing(true) },
            {
              label: 'Renombrar',
              icon: 'edit',
              onSelect: async () => {
                const r = await ask({ title: 'Renombrar vista', input: { label: 'Nombre', initial: view.name, required: true } });
                if (r.ok) await act.run(() => updateView(db, id, { name: r.value }), 'Vista renombrada');
              },
            },
            { label: view.archived ? 'Desarchivar' : 'Archivar', icon: 'archive', onSelect: () => act.run(() => updateView(db, id, { archived: !view.archived }), view.archived ? 'Vista desarchivada' : 'Vista archivada') },
            {
              label: 'Eliminar vista',
              icon: 'trash',
              danger: true,
              onSelect: async () => {
                const ok = await confirmAction({ title: 'Eliminar vista', message: 'Solo se elimina la vista. Los inventarios de origen y todos sus movimientos quedan intactos.', danger: true, confirmText: 'Eliminar vista' });
                if (!ok) return;
                const done = await act.run(() => deleteView(db, id).then(() => true));
                if (done) {
                  toast('Vista eliminada');
                  navigate('/vistas', { replace: true });
                }
              },
            },
          ]}
        />
      }
    >
      <div className="row wrap">
        {view.inventoryIds.map((i) => (
          <a key={i} className="badge brand" href={`#/inventarios/${i}`}>
            {invName.get(i)?.name ?? '—'}
          </a>
        ))}
      </div>
      <FormError error={act.error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <Kpi testId="view-available" label="Disponibles (suma)" value={data.bal.available} money={false} />
            <Kpi label="Valor a costo (suma)" value={data.bal.stockValue} foot={data.bal.unknownCostCount ? `⚠ ${data.bal.unknownCostCount} sin costo` : undefined} />
          </div>
          <PeriodPicker p={period} />
          <div className="kpis">
            <Kpi label="Ingresos netos" value={data.fin.netRevenue} foot={`${data.fin.sales.count} venta(s)`} />
            <Kpi label="Ganancia bruta" value={data.fin.grossProfit} foot={data.fin.profitComplete ? undefined : '⚠ Incompleta'} />
            <Kpi label="Ganancia neta" value={data.fin.netProfit} />
            <Kpi label="Por cobrar" value={data.bal.receivables} />
          </div>
          <Card title="Existencias combinadas" flush>
            <Paged
              items={data.groups}
              empty={<Empty title="Sin existencias" />}
              render={(g) => (
                <li key={g.key} style={{ padding: '12px 14px' }} data-testid="view-group">
                  <div className="row between">
                    <span className="row grow">
                      <span className="muted">
                        <Icon name={KIND_ICON[g.kind]} size={20} />
                      </span>
                      <span className="strong ellipsis">{g.name}</span>
                    </span>
                    <Badge kind={g.available ? 'ok' : undefined}>
                      <span data-testid="view-group-total">{g.available}</span> disp.
                    </Badge>
                  </div>
                  <ul className="list small" style={{ marginTop: 6 }}>
                    {g.sources.map((s) => (
                      <li key={s.productId} className="row between" style={{ padding: '4px 0' }}>
                        <a href={`#/productos/${s.productId}`}>{invName.get(s.inventoryId)?.name ?? '—'}</a>
                        <span className="num">
                          {s.available} · {formatCOP(s.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {g.available > 0 ? (
                    <button className="btn sm" style={{ marginTop: 6 }} onClick={() => sell(g)}>
                      <Icon name="tag" size={18} /> Vender
                    </button>
                  ) : null}
                </li>
              )}
            />
          </Card>
        </>
      )}
      {editing ? <ViewEditor view={view} onClose={() => setEditing(false)} /> : null}
      {selling ? (
        <Sheet title="¿Desde qué inventario vende?" onClose={() => setSelling(null)}>
          <p className="small muted">La venta se registra en el inventario de origen de la unidad. La vista se actualizará sola.</p>
          {selling.sources
            .filter((s) => s.available > 0)
            .map((s) => (
              <button key={s.productId} className="menu-item" onClick={() => navigate(`/ventas/nueva?inv=${s.inventoryId}&product=${s.productId}`)}>
                <Icon name="box" />
                <span className="grow">{invName.get(s.inventoryId)?.name}</span>
                <Badge kind="ok">{s.available} disp.</Badge>
              </button>
            ))}
        </Sheet>
      ) : null}
    </Page>
  );
}
