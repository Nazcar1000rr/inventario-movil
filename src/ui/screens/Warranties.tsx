import { useMemo, useState } from 'react';
import {
  addClaim,
  CLAIM_STATUS_LABEL,
  formatCOP,
  formatDate,
  formatDateTime,
  getSettings,
  newOpId,
  nowISO,
  updateClaim,
  updateWarranty,
  warrantyDisplayStatus,
  WARRANTY_DISPLAY_LABEL,
  type ClaimStatus,
  type ID,
  type WarrantyClaim,
  type WarrantyDisplay,
} from '../../core';
import { Badge, Card, Chips, confirmAction, DateTimeInput, Empty, Field, FormError, KV, Loading, MoneyInput, Page, Paged, Sheet, TextInput } from '../components/ui';
import { db, useAction, useLive } from '../store';

const KIND: Record<WarrantyDisplay, 'ok' | 'warn' | 'bad' | undefined> = { vigente: 'ok', por_vencer: 'warn', vencida: 'bad', anulada: undefined, cerrada: undefined };

export function WarrantiesScreen() {
  const [filter, setFilter] = useState<'active' | 'por_vencer' | 'vencida' | 'claims' | 'all'>('active');
  const data = useLive(async (d) => {
    const [ws, claims, settings, units, products, customers] = await Promise.all([d.warranties.toArray(), d.warrantyClaims.toArray(), getSettings(d), d.units.toArray(), d.products.toArray(), d.customers.toArray()]);
    const u = new Map(units.map((x) => [x.id, x]));
    const p = new Map(products.map((x) => [x.id, x]));
    const c = new Map(customers.map((x) => [x.id, x]));
    return ws
      .map((w) => ({
        w,
        st: warrantyDisplayStatus(w, settings.warrantyAlertDays),
        openClaims: claims.filter((x) => x.warrantyId === w.id && (x.status === 'open' || x.status === 'in_progress')).length,
        label: [w.productId ? p.get(w.productId)?.name : '', w.unitId ? u.get(w.unitId)?.code : ''].filter(Boolean).join(' · '),
        customer: w.customerId ? c.get(w.customerId)?.name ?? '' : '',
      }))
      .sort((a, b) => (a.w.endDate < b.w.endDate ? -1 : 1));
  });
  const list = useMemo(
    () =>
      (data ?? []).filter((r) =>
        filter === 'all' ? true : filter === 'active' ? r.st === 'vigente' || r.st === 'por_vencer' : filter === 'claims' ? r.openClaims > 0 : r.st === filter,
      ),
    [data, filter],
  );
  return (
    <Page title="Garantías" help="warranties" back="/mas">
      <Chips
        label="Filtro"
        value={filter}
        onChange={setFilter}
        options={[
          ['active', 'Vigentes'],
          ['por_vencer', 'Por vencer'],
          ['vencida', 'Vencidas'],
          ['claims', 'Con reclamos abiertos'],
          ['all', 'Todas'],
        ]}
      />
      <p className="small muted">Las garantías al cliente se crean al registrar una venta. Las del proveedor, desde la ficha de cada unidad (modo profesional). Los avisos se muestran al abrir la app; no hay notificaciones en segundo plano.</p>
      <Card flush>
        {!data ? (
          <Loading />
        ) : (
          <Paged
            items={list}
            empty={<Empty icon="shield" title="No hay garantías en este filtro" />}
            render={(r) => (
              <li key={r.w.id}>
                <a className="item" href={`#/garantias/${r.w.id}`}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {r.label || 'Garantía'}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {r.w.type === 'customer' ? 'Al cliente' : 'Del proveedor'} · hasta {formatDate(r.w.endDate)}
                      {r.customer ? ` · ${r.customer}` : ''}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <Badge kind={KIND[r.st]}>{WARRANTY_DISPLAY_LABEL[r.st]}</Badge>
                    {r.openClaims ? <Badge kind="warn">⚠ {r.openClaims} reclamo(s)</Badge> : null}
                  </span>
                </a>
              </li>
            )}
          />
        )}
      </Card>
    </Page>
  );
}

export function WarrantyDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const w = await d.warranties.get(id);
      if (!w) return null;
      const [claims, unit, product, customer, sale, settings] = await Promise.all([
        d.warrantyClaims.where('warrantyId').equals(id).toArray(),
        w.unitId ? d.units.get(w.unitId) : undefined,
        w.productId ? d.products.get(w.productId) : undefined,
        w.customerId ? d.customers.get(w.customerId) : undefined,
        w.saleId ? d.sales.get(w.saleId) : undefined,
        getSettings(d),
      ]);
      return { w, claims: claims.sort((a, b) => (a.date < b.date ? 1 : -1)), unit, product, customer, sale, st: warrantyDisplayStatus(w, settings.warrantyAlertDays) };
    },
    [id],
  );
  const [sheet, setSheet] = useState<null | 'claim' | WarrantyClaim>(null);
  const act = useAction();
  if (data === undefined) return <Page title="Garantía" back="/garantias"><Loading /></Page>;
  if (data === null) return <Page title="Garantía" back="/garantias"><Empty title="La garantía no existe" /></Page>;
  const { w, claims, unit, product, customer, sale, st } = data;
  return (
    <Page title="Garantía" subtitle={w.type === 'customer' ? 'Al cliente' : 'Del proveedor'} back="/garantias">
      <div className="row">
        <Badge kind={KIND[st]}>{WARRANTY_DISPLAY_LABEL[st]}</Badge>
      </div>
      <Card>
        <KV
          rows={[
            ['Producto', product ? <a key="p" href={`#/productos/${product.id}`}>{product.name}</a> : '—'],
            ...(unit ? ([['Unidad', <a key="u" href={`#/unidades/${unit.id}`}>{unit.code}</a>]] as [string, React.ReactNode][]) : []),
            ...(sale ? ([['Venta', <a key="s" href={`#/ventas/${sale.id}`}>{formatDateTime(sale.date)}</a>]] as [string, React.ReactNode][]) : []),
            ...(customer ? ([['Comprador', <a key="c" href={`#/compradores/${customer.id}`}>{customer.name}</a>]] as [string, React.ReactNode][]) : []),
            ['Inicio', formatDate(w.startDate)],
            ['Duración', `${w.durationValue} ${w.durationUnit === 'months' ? 'mes(es)' : 'día(s)'}`],
            ['Vence', formatDate(w.endDate), true],
          ]}
        />
        {w.conditions ? <p className="small" style={{ marginTop: 10 }}>Condiciones: {w.conditions}</p> : null}
      </Card>
      <Card title="Reclamos" action={w.status !== 'cancelled' ? <button className="btn sm" onClick={() => setSheet('claim')}>Nuevo reclamo</button> : undefined} flush>
        {claims.length === 0 ? (
          <Empty icon="shield" title="Sin reclamos" />
        ) : (
          <ul className="list">
            {claims.map((c) => (
              <li key={c.id}>
                <button className="item" onClick={() => setSheet(c)}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {c.description}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDate(c.date)}
                      {c.resolution ? ` · ${c.resolution}` : ''}
                      {c.cost ? ` · costo ${formatCOP(c.cost)}` : ''}
                    </span>
                  </span>
                  <Badge kind={c.status === 'resolved' ? 'ok' : c.status === 'rejected' ? undefined : 'warn'}>{CLAIM_STATUS_LABEL[c.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FormError error={act.error} />
      {w.status === 'active' ? (
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirmAction({ title: 'Cerrar garantía', message: 'Se marcará como cerrada (ya no generará avisos). El historial se conserva.', confirmText: 'Cerrar' });
            if (ok) await act.run(() => updateWarranty(db, id, { status: 'closed' }), 'Garantía cerrada');
          }}
        >
          Cerrar garantía
        </button>
      ) : null}
      {sheet ? <ClaimSheet warrantyId={id} claim={sheet === 'claim' ? null : sheet} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function ClaimSheet({ warrantyId, claim, onClose }: { warrantyId: ID; claim: WarrantyClaim | null; onClose: () => void }) {
  const [description, setDescription] = useState(claim?.description ?? '');
  const [status, setStatus] = useState<ClaimStatus>(claim?.status ?? 'open');
  const [resolution, setResolution] = useState(claim?.resolution ?? '');
  const [cost, setCost] = useState<number | null>(claim?.cost ?? 0);
  const [date, setDate] = useState<string | null>(claim?.date ?? nowISO());
  const [notes, setNotes] = useState(claim?.notes ?? '');
  const [opId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet
      title={claim ? 'Reclamo' : 'Nuevo reclamo'}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(
              () =>
                (claim
                  ? updateClaim(db, claim.id, { status, resolution, cost: cost ?? 0, notes })
                  : addClaim(db, { opId, warrantyId, date: date ?? '', description, status, resolution, cost: cost ?? 0, notes })
                ).then(() => true),
              'Reclamo guardado',
            );
            if (ok) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      {!claim ? (
        <>
          <Field label="Descripción" htmlFor="cl-desc" error={act.field === 'description' ? act.error : null}>
            <TextInput id="cl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: no carga" />
          </Field>
          <Field label="Fecha" htmlFor="cl-date">
            <DateTimeInput id="cl-date" value={date} onChange={setDate} />
          </Field>
        </>
      ) : (
        <p className="strong">{claim.description}</p>
      )}
      <Field label="Estado" htmlFor="cl-status">
        <select id="cl-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
          {Object.entries(CLAIM_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Resolución" htmlFor="cl-res" hint="Revisión, reparación, cambio, devolución…">
        <TextInput id="cl-res" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Field>
      <Field label="Costo para ti" htmlFor="cl-cost" hint="Se registra como gasto (categoría Garantía) una sola vez.">
        <MoneyInput id="cl-cost" value={cost} onChange={setCost} />
      </Field>
      <Field label="Observaciones" htmlFor="cl-notes">
        <TextInput id="cl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError error={act.field === 'description' ? null : act.error} />
    </Sheet>
  );
}
