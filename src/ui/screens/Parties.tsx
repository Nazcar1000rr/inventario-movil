import { useMemo, useState } from 'react';
import {
  computeSaleBalance,
  formatCOP,
  formatDate,
  formatDateTime,
  getSupplierStats,
  getSupplierScores,
  normalizeText,
  updateCustomer,
  updateSupplier,
  type ID,
} from '../../core';
import { Icon } from '../components/Icon';
import { PartyPicker } from '../components/pickers';
import { Badge, Card, Empty, Field, FormError, KV, Loading, Page, Paged, TextInput } from '../components/ui';
import { navigate } from '../router';
import { db, useAction, useLive } from '../store';
import { L } from '../components/help';

export function PartiesScreen({ type }: { type: 'supplier' | 'customer' }) {
  const list = useLive(async (d) => (type === 'supplier' ? await d.suppliers.toArray() : await d.customers.toArray()), [type]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const title = type === 'supplier' ? 'Proveedores' : 'Compradores';
  const base = type === 'supplier' ? '/proveedores' : '/compradores';
  const filtered = useMemo(() => {
    const nq = normalizeText(q);
    return (list ?? [])
      .filter((x) => !nq || normalizeText(`${x.name} ${x.phone} ${x.city}`).includes(nq))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'es'));
  }, [list, q]);
  return (
    <Page help="parties"
      title={title}
      back="/mas"
      actions={
        <button className="icon-btn" aria-label={`Nuevo ${type === 'supplier' ? 'proveedor' : 'comprador'}`} onClick={() => setCreating(true)}>
          <Icon name="plus" />
        </button>
      }
    >
      <TextInput type="search" placeholder="Buscar por nombre, teléfono o ciudad" aria-label={`Buscar ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <Card flush>
        {!list ? (
          <Loading />
        ) : (
          <Paged
            items={filtered}
            empty={<Empty icon={type === 'supplier' ? 'truck' : 'users'} title={list.length ? 'Sin resultados' : `Aún no hay ${title.toLowerCase()}`} />}
            render={(x) => (
              <li key={x.id}>
                <a className="item" href={`#${base}/${x.id}`}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {x.name}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {[x.phone, x.city].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                    </span>
                  </span>
                  {x.archived ? <Badge>Archivado</Badge> : null}
                </a>
              </li>
            )}
          />
        )}
      </Card>
      {creating ? (
        <PartyPicker
          type={type}
          onClose={() => setCreating(false)}
          onPick={(id) => {
            setCreating(false);
            if (id) navigate(`${base}/${id}`);
          }}
        />
      ) : null}
    </Page>
  );
}

export function PartyDetailScreen({ type, id }: { type: 'supplier' | 'customer'; id: ID }) {
  const base = type === 'supplier' ? '/proveedores' : '/compradores';
  const data = useLive(
    async (d) => {
      if (type === 'supplier') {
        const s = await d.suppliers.get(id);
        if (!s) return null;
        const stats = await getSupplierStats(d, id);
        const purchases = (await d.purchases.where('supplierId').equals(id).toArray()).sort((a, b) => (a.date < b.date ? 1 : -1));
        const score = (await getSupplierScores(d, null)).find((x) => x.supplierId === id) ?? null;
        return { kind: 'supplier' as const, party: s, stats, purchases, score };
      }
      const c = await d.customers.get(id);
      if (!c) return null;
      const sales = (await d.sales.where('customerId').equals(id).toArray()).sort((a, b) => (a.date < b.date ? 1 : -1));
      const balances = await Promise.all(
        sales.map(async (s) => computeSaleBalance(s, await d.saleLines.where('saleId').equals(s.id).toArray(), await d.payments.where('saleId').equals(s.id).toArray())),
      );
      return { kind: 'customer' as const, party: c, sales, balances };
    },
    [id, type],
  );
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const act = useAction();
  if (data === undefined) return <Page title="Cargando…" back={base}><Loading /></Page>;
  if (data === null) return <Page title="No encontrado" back={base}><Empty title="El registro no existe" /></Page>;
  const p = data.party;
  const f = edit ?? { name: p.name, phone: p.phone, city: p.city, address: 'address' in p ? p.address : '', type: 'type' in p ? p.type : '', notes: p.notes };
  const dirty = edit !== null;
  const save = async () => {
    const ok = await act.run(
      () => (type === 'supplier' ? updateSupplier(db, id, f) : updateCustomer(db, id, { name: f.name, phone: f.phone, city: f.city, notes: f.notes })).then(() => true),
      'Datos guardados',
    );
    if (ok) setEdit(null);
  };
  return (
    <Page title={p.name} subtitle={type === 'supplier' ? 'Proveedor' : 'Comprador'} help="parties" back={base}>
      {data.kind === 'supplier' ? (
        <Card title="Resumen">
          <KV
            rows={[
              ['Compras registradas', data.stats.purchases],
              ['Total comprado', formatCOP(data.stats.totalPurchased), true],
              ['Primera compra', formatDate(data.stats.firstPurchase)],
              ['Última compra', formatDate(data.stats.lastPurchase)],
            ]}
          />
          <p className="tiny muted" style={{ marginTop: 8 }}>Calculado a partir de las compras registradas (sin las anuladas).</p>
        </Card>
      ) : null}
      {data.kind === 'supplier' && data.score ? (
        <Card title={<h2><L k="supplierScore">Calificación</L></h2>}>
          <KV
            rows={[
              ['Puntaje', data.score.score === null ? 'Sin ventas todavía' : <strong key="sc">{data.score.score}/100{data.score.enoughData ? '' : ' (pocos datos)'}</strong>, true],
              ...(data.score.scoreParts
                ? ([
                    ['Margen (de 40)', String(data.score.scoreParts.margin)],
                    ['Rapidez (de 30)', String(data.score.scoreParts.speed)],
                    ['Calidad (de 30)', String(data.score.scoreParts.quality)],
                  ] as [string, string][])
                : []),
              ['Equipos comprados', `${data.score.unitsBought} · ${data.score.inStock} en existencia`],
              ['Ventas de sus equipos', String(data.score.sold)],
              ['Ganancia promedio', formatCOP(data.score.avgProfit)],
              ['Días promedio para vender', data.score.avgDays === null ? '—' : String(data.score.avgDays).replace('.', ',')],
              ['Devoluciones / reclamos', `${data.score.returns} / ${data.score.claims}`],
              ['Con piezas genéricas o aviso', String(data.score.partIssues)],
            ]}
          />
        </Card>
      ) : null}
      {data.kind === 'customer' ? (
        <Card title="Resumen">
          <KV
            rows={[
              ['Compras realizadas', data.sales.filter((s) => s.status === 'active').length],
              ['Total comprado', formatCOP(data.balances.reduce((a, b) => a + b.effective, 0)), true],
              ['Saldo pendiente', formatCOP(data.balances.reduce((a, b) => a + b.pending, 0))],
            ]}
          />
        </Card>
      ) : null}
      <Card title="Datos">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Nombre o empresa" htmlFor="pd-name" error={act.field === 'name' ? act.error : null}>
            <TextInput id="pd-name" value={f.name} onChange={(e) => setEdit({ ...f, name: e.target.value })} />
          </Field>
          <div className="grid-2">
            <Field label="Teléfono" htmlFor="pd-phone">
              <TextInput id="pd-phone" inputMode="tel" value={f.phone} onChange={(e) => setEdit({ ...f, phone: e.target.value })} />
            </Field>
            <Field label="Ciudad" htmlFor="pd-city">
              <TextInput id="pd-city" value={f.city} onChange={(e) => setEdit({ ...f, city: e.target.value })} />
            </Field>
          </div>
          {type === 'supplier' ? (
            <>
              <Field label="Dirección" htmlFor="pd-addr">
                <TextInput id="pd-addr" value={f.address} onChange={(e) => setEdit({ ...f, address: e.target.value })} />
              </Field>
              <Field label="Tipo de proveedor" htmlFor="pd-type">
                <TextInput id="pd-type" placeholder="Ej.: mayorista, particular, importador" value={f.type} onChange={(e) => setEdit({ ...f, type: e.target.value })} />
              </Field>
            </>
          ) : null}
          <Field label="Observaciones" htmlFor="pd-notes">
            <textarea id="pd-notes" className="textarea" value={f.notes} onChange={(e) => setEdit({ ...f, notes: e.target.value })} />
          </Field>
          <FormError error={act.field === 'name' ? null : act.error} />
          {dirty ? (
            <button className="btn primary block" disabled={act.busy}>
              Guardar cambios
            </button>
          ) : null}
        </form>
      </Card>
      {data.kind === 'supplier' ? (
        <Card title="Historial de compras" flush>
          <Paged
            items={data.purchases}
            empty={<Empty icon="cart" title="Sin compras" />}
            render={(pu) => (
              <li key={pu.id}>
                <a className="item" href={`#/compras/${pu.id}`}>
                  <span className="item-main">{formatDateTime(pu.date)}</span>
                  <span className="item-side">
                    <span className="money">{formatCOP(pu.total)}</span> {pu.status === 'voided' ? <Badge>Anulada</Badge> : null}
                  </span>
                </a>
              </li>
            )}
          />
        </Card>
      ) : (
        <Card title="Historial de compras del cliente" flush>
          <Paged
            items={data.sales.map((s, i) => ({ s, b: data.balances[i] }))}
            empty={<Empty icon="tag" title="Sin ventas" />}
            render={({ s, b }) => (
              <li key={s.id}>
                <a className="item" href={`#/ventas/${s.id}`}>
                  <span className="item-main">{formatDateTime(s.date)}</span>
                  <span className="item-side">
                    <span className="money">{formatCOP(s.total)}</span> {b.pending ? <Badge kind="warn">Debe {formatCOP(b.pending)}</Badge> : null}
                    {s.status === 'voided' ? <Badge>Anulada</Badge> : null}
                  </span>
                </a>
              </li>
            )}
          />
        </Card>
      )}
      <button
        className="btn"
        onClick={() => act.run(() => (type === 'supplier' ? updateSupplier(db, id, { archived: !p.archived }) : updateCustomer(db, id, { archived: !p.archived })), p.archived ? 'Reactivado' : 'Archivado')}
      >
        <Icon name="archive" /> {p.archived ? 'Reactivar' : 'Archivar (ocultar en listas de selección)'}
      </button>
    </Page>
  );
}
