import { useEffect, useMemo, useState } from 'react';
import {
  computeSaleBalance,
  createExpense,
  EXPENSE_CATEGORIES,
  formatCOP,
  formatDateTime,
  newOpId,
  nowISO,
  TREATMENT_LABEL,
  voidExpense,
  type ExpenseTreatment,
  type ID,
  type PaymentStatus,
} from '../../core';
import { InventorySelect, PaymentBadge, ScopeSelect, useDefaultInventory, useScope } from '../components/common';
import { Icon } from '../components/Icon';
import { Badge, Card, Chips, confirmAction, DateTimeInput, Empty, Field, FormError, KV, Loading, MoneyInput, Notice, Page, Paged, Segmented, TextInput } from '../components/ui';
import { navigate, useRoute } from '../router';
import { db, useAction, useLive } from '../store';

type Tab = 'ventas' | 'compras' | 'gastos';

export function OperationsScreen({ tab }: { tab: Tab }) {
  const route = useRoute();
  const scope = useScope('opsScope');
  const invFromQuery = route.query.get('inv');
  const { setScope, ready } = scope;
  useEffect(() => {
    if (invFromQuery && ready) setScope(`inv:${invFromQuery}`);
  }, [invFromQuery, ready, setScope]);
  const ids = scope.inventoryIds;
  const setTab = (t: Tab) => navigate(`/operaciones?tab=${t}`, { replace: true });
  return (
    <Page
      title="Operaciones"
      actions={
        <button className="icon-btn" aria-label={tab === 'ventas' ? 'Nueva venta' : tab === 'compras' ? 'Nueva compra' : 'Nuevo gasto'} onClick={() => navigate(tab === 'ventas' ? '/ventas/nueva' : tab === 'compras' ? '/compras/nueva' : '/gastos/nuevo')}>
          <Icon name="plus" />
        </button>
      }
    >
      <Segmented label="Tipo de operación" value={tab} onChange={setTab} options={[['ventas', 'Ventas'], ['compras', 'Compras'], ['gastos', 'Gastos']]} />
      <ScopeSelect {...scope} />
      {tab === 'ventas' ? <SalesList ids={ids} initialFilter={route.query.get('f') === 'pendientes' ? 'pending' : 'all'} /> : tab === 'compras' ? <PurchasesList ids={ids} /> : <ExpensesList ids={ids} />}
    </Page>
  );
}

function SalesList({ ids, initialFilter }: { ids: ID[] | null; initialFilter: 'all' | 'pending' }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'voided'>(initialFilter);
  const [q, setQ] = useState('');
  const data = useLive(
    async (d) => {
      const sales = (await d.sales.orderBy('date').reverse().toArray()).filter((s) => !ids || ids.includes(s.inventoryId));
      const [lines, pays, invs, customers, products] = await Promise.all([d.saleLines.toArray(), d.payments.toArray(), d.inventories.toArray(), d.customers.toArray(), d.products.toArray()]);
      const lb = new Map<ID, typeof lines>();
      lines.forEach((l) => lb.set(l.saleId, [...(lb.get(l.saleId) ?? []), l]));
      const pb = new Map<ID, typeof pays>();
      pays.forEach((p) => pb.set(p.saleId, [...(pb.get(p.saleId) ?? []), p]));
      const invName = new Map(invs.map((i) => [i.id, i.name]));
      const cName = new Map(customers.map((c) => [c.id, c.name]));
      const pName = new Map(products.map((p) => [p.id, p.name]));
      return sales.map((s) => {
        const ls = lb.get(s.id) ?? [];
        const bal = computeSaleBalance(s, ls, pb.get(s.id) ?? []);
        const names = [...new Set(ls.map((l) => pName.get(l.productId) ?? ''))];
        return { s, bal, inv: invName.get(s.inventoryId) ?? '', customer: s.customerId ? cName.get(s.customerId) ?? '' : '', units: ls.reduce((a, l) => a + l.quantity, 0), names };
      });
    },
    [JSON.stringify(ids)],
  );
  const list = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (filter === 'all' ? true : filter === 'pending' ? r.bal.pending > 0 : r.s.status === 'voided') &&
        (!nq || `${r.names.join(' ')} ${r.customer}`.toLowerCase().includes(nq)),
    );
  }, [data, filter, q]);
  const pendingTotal = (data ?? []).reduce((a, r) => a + r.bal.pending, 0);
  return (
    <>
      <Chips label="Filtro" value={filter} onChange={setFilter} options={[['all', 'Todas'], ['pending', `Por cobrar (${formatCOP(pendingTotal)})`], ['voided', 'Anuladas']]} />
      <TextInput type="search" placeholder="Buscar producto o comprador" aria-label="Buscar ventas" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card flush>
        {!data ? (
          <Loading />
        ) : (
          <Paged
            items={list}
            empty={<Empty icon="tag" title="No hay ventas" />}
            render={(r) => (
              <li key={r.s.id}>
                <a className="item" href={`#/ventas/${r.s.id}`}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {r.names.join(', ') || 'Venta'}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDateTime(r.s.date)} · {r.units} u. · {r.inv}
                      {r.customer ? ` · ${r.customer}` : ''}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <span className="money strong">{formatCOP(r.s.total)}</span>
                    <PaymentBadge status={r.bal.status as PaymentStatus} />
                  </span>
                </a>
              </li>
            )}
          />
        )}
      </Card>
    </>
  );
}

function PurchasesList({ ids }: { ids: ID[] | null }) {
  const data = useLive(
    async (d) => {
      const ps = (await d.purchases.orderBy('date').reverse().toArray()).filter((p) => !ids || ids.includes(p.inventoryId));
      const [lines, invs, sups, products] = await Promise.all([d.purchaseLines.toArray(), d.inventories.toArray(), d.suppliers.toArray(), d.products.toArray()]);
      const invName = new Map(invs.map((i) => [i.id, i.name]));
      const sName = new Map(sups.map((s) => [s.id, s.name]));
      const pName = new Map(products.map((p) => [p.id, p.name]));
      return ps.map((p) => {
        const ls = lines.filter((l) => l.purchaseId === p.id);
        return { p, inv: invName.get(p.inventoryId) ?? '', supplier: p.supplierId ? sName.get(p.supplierId) ?? '' : '', units: ls.reduce((a, l) => a + l.quantity, 0), names: [...new Set(ls.map((l) => pName.get(l.productId) ?? ''))] };
      });
    },
    [JSON.stringify(ids)],
  );
  return (
    <Card flush>
      {!data ? (
        <Loading />
      ) : (
        <Paged
          items={data}
          empty={<Empty icon="cart" title="No hay compras" />}
          render={(r) => (
            <li key={r.p.id}>
              <a className="item" href={`#/compras/${r.p.id}`}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {r.names.join(', ') || 'Compra'}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {formatDateTime(r.p.date)} · {r.units} u. · {r.inv}
                    {r.supplier ? ` · ${r.supplier}` : ''}
                  </span>
                </span>
                <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                  <span className="money strong">{formatCOP(r.p.total)}</span>
                  {r.p.status === 'voided' ? <Badge>⊘ Anulada</Badge> : null}
                </span>
              </a>
            </li>
          )}
        />
      )}
    </Card>
  );
}

function ExpensesList({ ids }: { ids: ID[] | null }) {
  const data = useLive(
    async (d) => {
      const es = (await d.expenses.orderBy('date').reverse().toArray()).filter((e) => !ids || (e.inventoryId !== null && ids.includes(e.inventoryId)));
      const invs = await d.inventories.toArray();
      const invName = new Map(invs.map((i) => [i.id, i.name]));
      return es.map((e) => ({ e, inv: e.inventoryId ? invName.get(e.inventoryId) ?? '' : 'General' }));
    },
    [JSON.stringify(ids)],
  );
  return (
    <>
      {ids ? <p className="small muted">Se muestran los gastos asignados a estos inventarios. Los gastos generales aparecen en "Todos los inventarios".</p> : null}
      <Card flush>
        {!data ? (
          <Loading />
        ) : (
          <Paged
            items={data}
            empty={<Empty icon="receipt" title="No hay gastos" />}
            render={({ e, inv }) => (
              <li key={e.id}>
                <a className="item" href={`#/gastos/${e.id}`}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {e.category}
                      {e.notes ? <span className="muted small"> · {e.notes}</span> : null}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDateTime(e.date)} · {inv}
                      {e.treatment === 'capitalized' ? ' · al costo' : ''}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <span className="money strong">{formatCOP(e.amount)}</span>
                    {e.status === 'voided' ? <Badge>⊘ Anulado</Badge> : null}
                  </span>
                </a>
              </li>
            )}
          />
        )}
      </Card>
    </>
  );
}

export function ExpenseFormScreen({ inventoryId }: { inventoryId: string | null }) {
  const [inv, setInv, invs] = useDefaultInventory(inventoryId);
  const [general, setGeneral] = useState(!inventoryId);
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState('Transporte');
  const [date, setDate] = useState<string | null>(nowISO());
  const [notes, setNotes] = useState('');
  const [treatment] = useState<ExpenseTreatment>('operating');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  return (
    <Page title="Registrar gasto" back="/operaciones?tab=gastos">
      <Notice>
        Gastos generales del negocio (se restan en la ganancia neta). Para sumar un costo a una unidad concreta (reparación, transporte de ese equipo), hágalo desde la ficha de la unidad: así no se resta dos veces.
      </Notice>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act.run(() => createExpense(db, { opId, date: date ?? '', amount: amount ?? 0, category, notes, inventoryId: general ? null : inv || null, treatment }), 'Gasto registrado');
          if (r) {
            setOpId(newOpId());
            navigate(`/gastos/${r.id}`, { replace: true });
          }
        }}
      >
        <div className="grid-2">
          <Field label="Valor" htmlFor="ex-amount" error={act.field === 'amount' ? act.error : null}>
            <MoneyInput id="ex-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
          </Field>
          <Field label="Categoría" htmlFor="ex-cat">
            <select id="ex-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Fecha" htmlFor="ex-date">
          <DateTimeInput id="ex-date" value={date} onChange={setDate} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} /> Gasto general (no pertenece a un inventario)
        </label>
        {!general && invs ? (
          <Field label="Inventario" htmlFor="ex-inv">
            <InventorySelect id="ex-inv" value={inv} onChange={setInv} inventories={invs} />
          </Field>
        ) : null}
        <Field label="Nota (opcional)" htmlFor="ex-notes">
          <TextInput id="ex-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={act.field === 'amount' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Guardar gasto
        </button>
      </form>
    </Page>
  );
}

export function ExpenseDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const e = await d.expenses.get(id);
      if (!e) return null;
      const [inv, unit, sale] = await Promise.all([
        e.inventoryId ? d.inventories.get(e.inventoryId) : undefined,
        e.unitId ? d.units.get(e.unitId) : undefined,
        e.saleId ? d.sales.get(e.saleId) : undefined,
      ]);
      return { e, inv, unit, sale };
    },
    [id],
  );
  const act = useAction();
  if (data === undefined) return <Page title="Gasto" back="/operaciones?tab=gastos"><Loading /></Page>;
  if (data === null) return <Page title="Gasto" back="/operaciones?tab=gastos"><Empty title="El gasto no existe" /></Page>;
  const { e, inv, unit, sale } = data;
  return (
    <Page title="Gasto" subtitle={e.category} back="/operaciones?tab=gastos">
      {e.status === 'voided' ? <Notice kind="warn" title="Gasto anulado" /> : null}
      <Card>
        <KV
          rows={[
            ['Valor', formatCOP(e.amount), true],
            ['Categoría', e.category],
            ['Fecha', formatDateTime(e.date)],
            ['Tratamiento', TREATMENT_LABEL[e.treatment]],
            ['Inventario', inv ? <a key="i" href={`#/inventarios/${inv.id}`}>{inv.name}</a> : 'General'],
            ...(unit ? ([['Unidad', <a key="u" href={`#/unidades/${unit.id}`}>{unit.code}</a>]] as [string, React.ReactNode][]) : []),
            ...(sale ? ([['Venta', <a key="s" href={`#/ventas/${sale.id}`}>{formatDateTime(sale.date)}</a>]] as [string, React.ReactNode][]) : []),
            ...(e.notes ? ([['Nota', e.notes]] as [string, string][]) : []),
          ]}
        />
      </Card>
      <FormError error={act.error} />
      {e.status === 'active' && !e.claimId && !e.repairId ? (
        <button
          className="btn danger block"
          onClick={async () => {
            const ok = await confirmAction({ title: 'Anular gasto', message: 'El gasto se conservará marcado como anulado y dejará de contar en los informes.', danger: true, confirmText: 'Anular gasto' });
            if (ok) await act.run(() => voidExpense(db, id), 'Gasto anulado');
          }}
        >
          Anular gasto
        </button>
      ) : null}
      {e.claimId || e.repairId ? <p className="small muted">Este gasto pertenece a {e.claimId ? 'un reclamo de garantía' : 'una reparación'}; se modifica desde allí.</p> : null}
    </Page>
  );
}
