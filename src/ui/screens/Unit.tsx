import { useEffect, useState } from 'react';
import {
  addRepair,
  createExpense,
  createWarranty,
  EXPENSE_CATEGORIES,
  findIdentifierMatches,
  formatCOP,
  formatDate,
  formatDateTime,
  getSettings,
  INSPECTION_ITEMS,
  INSPECTION_SOURCE_LABEL,
  INSPECTION_STATUS_LABEL,
  newId,
  newOpId,
  nowISO,
  setUnitAcquiredAt,
  setUnitBaseCost,
  setUnitInspection,
  setUnitStatus,
  unitCost,
  updateUnitDetails,
  warrantyDisplayStatus,
  WARRANTY_DISPLAY_LABEL,
  writeOffUnit,
  type ID,
  type Inspection,
  type InspectionItem,
  type Unit,
} from '../../core';
import { DaysLabel, ModeBadge, UnitStatusBadge } from '../components/common';
import { Icon } from '../components/Icon';
import {
  ActionMenu,
  ask,
  Badge,
  Card,
  confirmAction,
  DateTimeInput,
  Empty,
  Field,
  FormError,
  IntInput,
  KV,
  ListItem,
  Loading,
  MoneyInput,
  Notice,
  Page,
  Segmented,
  Sheet,
  TextInput,
} from '../components/ui';
import { compressImage } from '../platform';
import { navigate } from '../router';
import { db, toast, useAction, useLive } from '../store';

export function UnitDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const u = await d.units.get(id);
      if (!u) return null;
      const [p, inv, supplier, purchase, lines, repairs, warranties, photos, history, settings] = await Promise.all([
        d.products.get(u.productId),
        d.inventories.get(u.inventoryId),
        u.supplierId ? d.suppliers.get(u.supplierId) : Promise.resolve(undefined),
        u.purchaseId ? d.purchases.get(u.purchaseId) : Promise.resolve(undefined),
        d.saleLines.where('unitId').equals(id).toArray(),
        d.repairs.where('unitId').equals(id).toArray(),
        d.warranties.where('unitId').equals(id).toArray(),
        d.photos.where('unitId').equals(id).toArray(),
        d.history.where('entityId').equals(id).toArray(),
        getSettings(d),
      ]);
      const sales = await d.sales.bulkGet(lines.map((l) => l.saleId));
      return { u, p: p!, inv: inv!, supplier, purchase, lines, sales, repairs, warranties, photos, history: history.sort((a, b) => (a.at < b.at ? 1 : -1)), settings };
    },
    [id],
  );
  const [sheet, setSheet] = useState<null | 'edit' | 'inspection' | 'repair' | 'cost' | 'date' | 'extra' | 'status' | 'warranty'>(null);
  const act = useAction();

  if (data === undefined) return <Page title="Unidad" back="/inventarios"><Loading /></Page>;
  if (data === null) return <Page title="Unidad" back="/inventarios"><Empty title="La unidad no existe" /></Page>;
  const { u, p, inv, supplier, purchase, lines, sales, repairs, warranties, photos, history, settings } = data;
  const pro = inv.mode === 'pro';
  const inStock = u.status === 'available' || u.status === 'in_review' || u.status === 'damaged';
  const cost = unitCost(u);
  const currentSale = u.saleId ? sales.find((s) => s?.id === u.saleId) : undefined;

  const writeOff = async () => {
    const r = await ask({
      title: 'Dar de baja la unidad',
      danger: true,
      message: <p>La unidad deja de estar en existencia y su costo ({formatCOP(cost)}) se registra como pérdida. El registro y el código se conservan.</p>,
      input: { label: 'Motivo', placeholder: 'Ej.: robo, daño irreparable', required: true },
      confirmText: 'Dar de baja',
    });
    if (r.ok) await act.run(() => writeOffUnit(db, id, r.value, nowISO()), 'Unidad dada de baja');
  };

  return (
    <Page
      title={pro ? u.code : p.name}
      subtitle={
        <span className="row">
          {pro ? <a href={`#/productos/${p.id}`}>{p.name}</a> : <a href={`#/inventarios/${inv.id}`}>{inv.name}</a>} <ModeBadge mode={inv.mode} />
        </span>
      }
      back={`/productos/${p.id}`}
      actions={
        <ActionMenu
          title={pro ? u.code : p.name}
          actions={[
            { label: 'Vender esta unidad', icon: 'tag', hidden: u.status !== 'available' || inv.archived, onSelect: () => navigate(`/ventas/nueva?inv=${inv.id}&product=${p.id}&unit=${u.id}`) },
            { label: 'Editar datos', icon: 'edit', onSelect: () => setSheet('edit') },
            { label: 'Cambiar estado', icon: 'sliders', hidden: !inStock, onSelect: () => setSheet('status') },
            { label: 'Inspección', icon: 'clipboard', hidden: !pro, onSelect: () => setSheet('inspection') },
            { label: 'Registrar reparación', icon: 'wrench', hidden: !pro, onSelect: () => setSheet('repair') },
            { label: 'Sumar costo adicional', icon: 'money', hidden: !inStock, onSelect: () => setSheet('extra') },
            { label: u.baseCost === null ? 'Completar costo' : 'Corregir costo', icon: 'money', hidden: u.source !== 'initial' || (u.baseCost !== null && u.status === 'sold'), onSelect: () => setSheet('cost') },
            { label: u.acquiredAt ? 'Corregir fecha de ingreso' : 'Completar fecha de ingreso', icon: 'clock', hidden: u.source !== 'initial', onSelect: () => setSheet('date') },
            { label: 'Garantía del proveedor', icon: 'shield', hidden: !pro, onSelect: () => setSheet('warranty') },
            { label: 'Dar de baja', icon: 'trash', danger: true, hidden: !inStock, onSelect: writeOff },
          ]}
        />
      }
    >
      <div className="row wrap">
        <UnitStatusBadge status={u.status} />
        {u.cycle > 1 ? <Badge kind="info">Ciclo {u.cycle} (tras devolución)</Badge> : null}
        {cost === null ? <Badge kind="warn">⚠ Costo desconocido</Badge> : null}
        {!u.acquiredAt ? <Badge kind="warn">⚠ Fecha desconocida</Badge> : null}
      </div>
      <FormError error={act.error} />
      {u.status === 'available' && !inv.archived ? (
        <a className="btn primary block" href={`#/ventas/nueva?inv=${inv.id}&product=${p.id}&unit=${u.id}`}>
          <Icon name="tag" /> Vender esta unidad
        </a>
      ) : null}

      <Card title="Resumen">
        <KV
          rows={[
            ['Estado', <UnitStatusBadge key="s" status={u.status} />],
            ...(inStock ? ([['Tiempo en inventario', <DaysLabel key="d" since={u.availableSince} />]] as [React.ReactNode, React.ReactNode][]) : []),
            ['Fecha de ingreso', formatDate(u.acquiredAt)],
            ...(u.cycle > 1 ? ([['Disponible desde (ciclo actual)', formatDate(u.availableSince)]] as [React.ReactNode, React.ReactNode][]) : []),
            ['Costo de adquisición', formatCOP(u.baseCost)],
            ...(u.extraCost ? ([['Costos adicionales', formatCOP(u.extraCost)]] as [React.ReactNode, React.ReactNode][]) : []),
            ['Costo total', <strong key="c">{formatCOP(cost)}</strong>],
            ['Origen', purchase ? <a key="o" href={`#/compras/${purchase.id}`}>Compra del {formatDate(purchase.date)}</a> : u.source === 'initial' ? 'Stock existente' : '—'],
            ...(supplier ? ([['Proveedor', <a key="sp" href={`#/proveedores/${supplier.id}`}>{supplier.name}</a>]] as [React.ReactNode, React.ReactNode][]) : []),
            ...(currentSale ? ([['Venta', <a key="sl" href={`#/ventas/${currentSale.id}`}>{formatDate(currentSale.date)}</a>]] as [React.ReactNode, React.ReactNode][]) : []),
            ...(u.status === 'archived' ? ([['Motivo de baja', u.archivedReason]] as [React.ReactNode, React.ReactNode][]) : []),
          ]}
        />
      </Card>

      <Card title="Datos de la unidad" action={<button className="btn sm" onClick={() => setSheet('edit')}>Editar</button>}>
        <KV
          rows={(
            [
              pro ? ['Código interno', <span key="c" className="code">{u.code}</span>] : null,
              u.imei ? ['IMEI', <span key="i" className="code">{u.imei}</span>] : null,
              u.imei2 ? ['IMEI 2', <span key="i2" className="code">{u.imei2}</span>] : null,
              u.serial ? ['Serial', <span key="s" className="code">{u.serial}</span>] : null,
              ['Capacidad', u.capacity || '—'],
              ['Color', u.color || '—'],
              ['Estado físico', u.condition || '—'],
              ['Batería', u.batteryHealth === null ? 'Desconocida' : `${u.batteryHealth}% (ingresado manualmente)`],
              u.includedAccessories ? ['Accesorios incluidos', u.includedAccessories] : null,
              u.defects ? ['Defectos observados', u.defects] : null,
              u.replacedParts ? ['Componentes sustituidos', u.replacedParts] : null,
              u.notes ? ['Observaciones', u.notes] : null,
            ] as ([React.ReactNode, React.ReactNode] | null)[]
          ).filter((x): x is [React.ReactNode, React.ReactNode] => x !== null)}
        />
      </Card>

      {pro || u.inspection ? (
        <Card title="Inspección" action={<button className="btn sm" onClick={() => setSheet('inspection')}>{u.inspection ? 'Editar' : 'Iniciar'}</button>}>
          {u.inspection ? <InspectionView inspection={u.inspection} /> : <p className="small muted">Sin inspección registrada.</p>}
        </Card>
      ) : null}

      {pro || repairs.length ? (
        <Card title="Reparaciones" action={pro ? <button className="btn sm" onClick={() => setSheet('repair')}>Agregar</button> : undefined}>
          {repairs.length === 0 ? (
            <p className="small muted">Sin reparaciones.</p>
          ) : (
            <ul className="list">
              {repairs
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((r) => (
                  <li key={r.id} style={{ padding: '8px 0' }}>
                    <div className="row between">
                      <span className="strong">{r.description}</span>
                      <span className="money">{formatCOP(r.cost)}</span>
                    </div>
                    <div className="small muted">
                      {formatDate(r.date)}
                      {r.partsReplaced ? ` · Partes: ${r.partsReplaced}` : ''}
                      {r.technician ? ` · ${r.technician}` : ''}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      ) : null}

      {warranties.length ? (
        <Card title="Garantías" flush>
          <ul className="list">
            {warranties.map((w) => {
              const st = warrantyDisplayStatus(w, settings.warrantyAlertDays);
              return (
                <ListItem
                  key={w.id}
                  href={`/garantias/${w.id}`}
                  title={w.type === 'customer' ? 'Garantía al cliente' : 'Garantía del proveedor'}
                  sub={`Hasta ${formatDate(w.endDate)}`}
                  side={<Badge kind={st === 'vigente' ? 'ok' : st === 'por_vencer' ? 'warn' : undefined}>{WARRANTY_DISPLAY_LABEL[st]}</Badge>}
                />
              );
            })}
          </ul>
        </Card>
      ) : null}

      {pro || photos.length ? <PhotosCard unitId={u.id} photos={photos} canAdd={pro} /> : null}

      {lines.length ? (
        <Card title="Ventas de esta unidad" flush>
          <ul className="list">
            {lines.map((l) => {
              const s = sales.find((x) => x?.id === l.saleId);
              if (!s) return null;
              return (
                <ListItem
                  key={l.id}
                  href={`/ventas/${s.id}`}
                  title={`${formatDate(s.date)} · ${formatCOP(l.netAmount)}`}
                  sub={s.status === 'voided' ? 'Anulada' : l.returnedQty ? 'Devuelta' : 'Vigente'}
                />
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card title="Historial de la unidad" flush>
        {history.length === 0 ? (
          <Empty icon="history" title="Sin registros" />
        ) : (
          <ul className="list">
            {history.map((h) => (
              <li key={h.id} className="item" style={{ cursor: 'default' }}>
                <span className="item-main">
                  <span className="small" style={{ display: 'block' }}>
                    {h.summary}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {formatDateTime(h.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sheet === 'edit' ? <EditUnitSheet unit={u} pro={pro} conditions={settings.conditions} onClose={() => setSheet(null)} /> : null}
      {sheet === 'inspection' ? <InspectionSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'repair' ? <RepairSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'cost' ? <CostSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'date' ? <DateSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'extra' ? <ExtraCostSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'status' ? <StatusSheet unit={u} onClose={() => setSheet(null)} /> : null}
      {sheet === 'warranty' ? <SupplierWarrantySheet unit={u} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function InspectionView({ inspection }: { inspection: Inspection }) {
  const items = INSPECTION_ITEMS.filter((i) => inspection.items[i.key]);
  return (
    <div className="stack-sm">
      {inspection.inspectedAt ? <p className="small muted">Actualizada: {formatDateTime(inspection.inspectedAt)}</p> : null}
      {items.length === 0 ? <p className="small muted">Ningún punto evaluado todavía.</p> : null}
      <ul className="list">
        {items.map((i) => {
          const it = inspection.items[i.key];
          const kind = it.status === 'ok' ? 'ok' : it.status === 'damaged' ? 'bad' : it.status === 'replaced' || it.status === 'pending' ? 'warn' : undefined;
          return (
            <li key={i.key} style={{ padding: '8px 0' }}>
              <div className="row between">
                <span>{i.label}</span>
                <Badge kind={kind}>{INSPECTION_STATUS_LABEL[it.status]}</Badge>
              </div>
              <div className="tiny muted">
                {INSPECTION_SOURCE_LABEL[it.source]}
                {it.note ? ` · ${it.note}` : ''}
              </div>
            </li>
          );
        })}
      </ul>
      {inspection.notes ? <p className="small">{inspection.notes}</p> : null}
      <p className="tiny muted">"Informado por el vendedor" no es una verificación. La app no certifica originalidad de piezas ni legitimidad de reparaciones.</p>
    </div>
  );
}

function InspectionSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [items, setItems] = useState<Record<string, InspectionItem>>(() => ({ ...(unit.inspection?.items ?? {}) }));
  const [notes, setNotes] = useState(unit.inspection?.notes ?? '');
  const [battery, setBattery] = useState<number | null>(unit.batteryHealth);
  const act = useAction();
  const setItem = (k: string, patch: Partial<InspectionItem>) =>
    setItems((x) => ({ ...x, [k]: { ...(x[k] ?? { status: 'pending', source: 'own', note: '' }), ...patch } }));
  return (
    <Sheet
      title="Inspección"
      onClose={onClose}
      full
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(async () => {
              await setUnitInspection(db, unit.id, { items, notes, inspectedAt: nowISO() });
              if (battery !== unit.batteryHealth) await updateUnitDetails(db, unit.id, { batteryHealth: battery });
              return true;
            }, 'Inspección guardada');
            if (ok) onClose();
          }}
        >
          Guardar inspección
        </button>
      }
    >
      <p className="small muted">Marque solo lo que haya revisado. Indique quién dio la información: lo dicho por el vendedor no equivale a una verificación.</p>
      <Field label="Estado de batería (%)" htmlFor="ins-bat" hint="Se ingresa manualmente (la app no lee la batería del iPhone).">
        <IntInput id="ins-bat" value={battery} onChange={(v) => setBattery(v === null ? null : Math.min(100, v))} placeholder="Desconocido" />
      </Field>
      {INSPECTION_ITEMS.map((i) => {
        const it = items[i.key];
        return (
          <fieldset key={i.key} className="card stack-sm" style={{ margin: 0 }}>
            <legend className="strong small" style={{ padding: '0 4px' }}>
              {i.label}
            </legend>
            <div className="grid-2">
              <select
                className="select"
                aria-label={`${i.label}: estado`}
                value={it?.status ?? ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setItems((x) => {
                      const n = { ...x };
                      delete n[i.key];
                      return n;
                    });
                  } else setItem(i.key, { status: e.target.value as InspectionItem['status'] });
                }}
              >
                <option value="">Sin evaluar</option>
                {Object.entries(INSPECTION_STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select className="select" aria-label={`${i.label}: origen`} disabled={!it} value={it?.source ?? 'own'} onChange={(e) => setItem(i.key, { source: e.target.value as InspectionItem['source'] })}>
                {Object.entries(INSPECTION_SOURCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {it ? <TextInput aria-label={`${i.label}: nota`} placeholder="Nota (opcional)" value={it.note} onChange={(e) => setItem(i.key, { note: e.target.value })} /> : null}
          </fieldset>
        );
      })}
      <Field label="Notas generales" htmlFor="ins-notes">
        <textarea id="ins-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError error={act.error} />
    </Sheet>
  );
}

function EditUnitSheet({ unit, pro, conditions, onClose }: { unit: Unit; pro: boolean; conditions: string[]; onClose: () => void }) {
  const [f, setF] = useState({
    imei: unit.imei,
    imei2: unit.imei2,
    serial: unit.serial,
    color: unit.color,
    capacity: unit.capacity,
    condition: unit.condition,
    batteryHealth: unit.batteryHealth,
    includedAccessories: unit.includedAccessories,
    defects: unit.defects,
    replacedParts: unit.replacedParts,
    notes: unit.notes,
  });
  const [dups, setDups] = useState<Unit[]>([]);
  const act = useAction();
  const set = (k: keyof typeof f, v: string | number | null) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    const t = setTimeout(async () => {
      const m = await findIdentifierMatches(db, { imei: f.imei, serial: f.serial }, unit.id);
      setDups(m);
    }, 300);
    return () => clearTimeout(t);
  }, [f.imei, f.serial, unit.id]);
  const showPro = pro || !!(unit.imei || unit.serial || unit.imei2);
  return (
    <Sheet
      title="Editar datos de la unidad"
      onClose={onClose}
      full
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(() => updateUnitDetails(db, unit.id, f).then(() => true), 'Datos guardados');
            if (ok) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      {showPro ? (
        <div className="grid-2">
          <Field label="IMEI" htmlFor="eu-imei">
            <TextInput id="eu-imei" inputMode="numeric" autoComplete="off" value={f.imei} onChange={(e) => set('imei', e.target.value)} />
          </Field>
          <Field label="IMEI 2" htmlFor="eu-imei2">
            <TextInput id="eu-imei2" inputMode="numeric" autoComplete="off" value={f.imei2} onChange={(e) => set('imei2', e.target.value)} />
          </Field>
          <Field label="Serial" htmlFor="eu-serial">
            <TextInput id="eu-serial" autoCapitalize="characters" autoComplete="off" value={f.serial} onChange={(e) => set('serial', e.target.value)} />
          </Field>
        </div>
      ) : null}
      {dups.length ? (
        <Notice kind="warn" title="Identificador repetido">
          Ya existe en: {dups.map((d) => `${d.code} (${d.status === 'sold' ? 'vendida' : d.status})`).join(', ')}. Si es el mismo equipo recomprado, puede continuar.
        </Notice>
      ) : null}
      <div className="grid-2">
        <Field label="Capacidad" htmlFor="eu-cap">
          <TextInput id="eu-cap" value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
        </Field>
        <Field label="Color" htmlFor="eu-color">
          <TextInput id="eu-color" value={f.color} onChange={(e) => set('color', e.target.value)} />
        </Field>
        <Field label="Estado físico" htmlFor="eu-cond">
          <select id="eu-cond" className="select" value={f.condition} onChange={(e) => set('condition', e.target.value)}>
            <option value="">Sin indicar</option>
            {[...new Set([...conditions, f.condition].filter(Boolean))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Batería %" htmlFor="eu-bat">
          <IntInput id="eu-bat" value={f.batteryHealth} onChange={(v) => set('batteryHealth', v === null ? null : Math.min(100, v))} placeholder="Desconocida" />
        </Field>
      </div>
      {showPro ? (
        <>
          <Field label="Accesorios incluidos" htmlFor="eu-acc">
            <TextInput id="eu-acc" value={f.includedAccessories} onChange={(e) => set('includedAccessories', e.target.value)} placeholder="Ej.: caja, cable" />
          </Field>
          <Field label="Defectos observados" htmlFor="eu-def">
            <textarea id="eu-def" className="textarea" value={f.defects} onChange={(e) => set('defects', e.target.value)} />
          </Field>
          <Field label="Componentes sustituidos" htmlFor="eu-rep">
            <TextInput id="eu-rep" value={f.replacedParts} onChange={(e) => set('replacedParts', e.target.value)} />
          </Field>
        </>
      ) : null}
      <Field label="Observaciones" htmlFor="eu-notes">
        <textarea id="eu-notes" className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <FormError error={act.error} />
    </Sheet>
  );
}

function RepairSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(nowISO());
  const [description, setDescription] = useState('');
  const [parts, setParts] = useState('');
  const [tech, setTech] = useState('');
  const [cost, setCost] = useState<number | null>(0);
  const [opId] = useState(newOpId);
  const act = useAction();
  const inStock = ['available', 'in_review', 'damaged'].includes(unit.status);
  return (
    <Sheet title="Registrar reparación" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act.run(() => addRepair(db, { opId, unitId: unit.id, date: date ?? '', description, partsReplaced: parts, technician: tech, cost: cost ?? 0 }).then(() => true), 'Reparación registrada');
          if (ok) onClose();
        }}
      >
        <Field label="Descripción" htmlFor="rp-desc" error={act.field === 'description' ? act.error : null}>
          <TextInput id="rp-desc" value={description} onChange={(e) => setDescription(e.target.value)} invalid={act.field === 'description'} placeholder="Ej.: cambio de pantalla" />
        </Field>
        <div className="grid-2">
          <Field label="Partes reemplazadas" htmlFor="rp-parts">
            <TextInput id="rp-parts" value={parts} onChange={(e) => setParts(e.target.value)} />
          </Field>
          <Field label="Técnico" htmlFor="rp-tech">
            <TextInput id="rp-tech" value={tech} onChange={(e) => setTech(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Costo" htmlFor="rp-cost">
            <MoneyInput id="rp-cost" value={cost} onChange={setCost} />
          </Field>
          <Field label="Fecha" htmlFor="rp-date">
            <DateTimeInput id="rp-date" value={date} onChange={setDate} />
          </Field>
        </div>
        <Notice>{inStock ? 'El costo se sumará al costo de esta unidad (no se restará otra vez como gasto).' : 'La unidad ya no está en existencia: el costo se registrará como gasto operativo.'}</Notice>
        <FormError error={act.field === 'description' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Guardar reparación
        </button>
      </form>
    </Sheet>
  );
}

function CostSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [cost, setCost] = useState<number | null>(unit.baseCost);
  const act = useAction();
  return (
    <Sheet title={unit.baseCost === null ? 'Completar costo' : 'Corregir costo'} onClose={onClose}>
      <Field label="Costo de adquisición" htmlFor="uc-cost">
        <MoneyInput id="uc-cost" value={cost} onChange={setCost} />
      </Field>
      {unit.baseCost === null && unit.status === 'sold' ? <Notice>Se actualizará también el costo y la ganancia de la venta de esta unidad.</Notice> : null}
      <FormError error={act.error} />
      <button
        className="btn primary block"
        disabled={act.busy || cost === null}
        onClick={async () => {
          const ok = await act.run(() => setUnitBaseCost(db, unit.id, cost ?? 0).then(() => true), 'Costo guardado');
          if (ok) onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function DateSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(unit.acquiredAt ?? nowISO());
  const [unknown, setUnknown] = useState(false);
  const act = useAction();
  return (
    <Sheet title="Fecha de ingreso" onClose={onClose}>
      {!unknown ? (
        <Field label="Fecha" htmlFor="ud-date" error={act.error}>
          <DateTimeInput id="ud-date" value={date} onChange={setDate} />
        </Field>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> Marcar como desconocida
      </label>
      <button
        className="btn primary block"
        disabled={act.busy}
        onClick={async () => {
          const ok = await act.run(() => setUnitAcquiredAt(db, unit.id, unknown ? null : date).then(() => true), 'Fecha guardada');
          if (ok) onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function ExtraCostSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState('Transporte');
  const [date, setDate] = useState<string | null>(nowISO());
  const [notes, setNotes] = useState('');
  const [opId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet title="Sumar costo adicional" onClose={onClose}>
      <Notice>Se suma al costo de esta unidad y se reconocerá como costo cuando se venda. No se resta otra vez como gasto.</Notice>
      <div className="grid-2">
        <Field label="Valor" htmlFor="xc-amount" error={act.field === 'amount' ? act.error : null}>
          <MoneyInput id="xc-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
        </Field>
        <Field label="Categoría" htmlFor="xc-cat">
          <select id="xc-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Fecha" htmlFor="xc-date">
        <DateTimeInput id="xc-date" value={date} onChange={setDate} />
      </Field>
      <Field label="Nota" htmlFor="xc-notes">
        <TextInput id="xc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError error={act.field === 'amount' ? null : act.error} />
      <button
        className="btn primary block"
        disabled={act.busy}
        onClick={async () => {
          const ok = await act.run(() => createExpense(db, { opId, date: date ?? '', amount: amount ?? 0, category, notes, treatment: 'capitalized', unitId: unit.id }).then(() => true), 'Costo sumado');
          if (ok) onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function StatusSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [status, setStatus] = useState<'available' | 'in_review' | 'damaged'>(unit.status === 'available' ? 'in_review' : 'available');
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <Sheet title="Cambiar estado" onClose={onClose}>
      <Segmented label="Nuevo estado" value={status} onChange={setStatus} options={[['available', 'Disponible'], ['in_review', 'En revisión'], ['damaged', 'Dañado']]} />
      <p className="small muted">Solo las unidades "Disponible" se pueden vender. El costo no cambia.</p>
      <Field label="Nota (opcional)" htmlFor="st-note">
        <TextInput id="st-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError error={act.error} />
      <button
        className="btn primary block"
        disabled={act.busy || status === unit.status}
        onClick={async () => {
          const ok = await act.run(() => setUnitStatus(db, unit.id, status, note).then(() => true), 'Estado actualizado');
          if (ok) onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function SupplierWarrantySheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [value, setValue] = useState<number | null>(1);
  const [unitT, setUnitT] = useState<'days' | 'months'>('months');
  const [start, setStart] = useState<string | null>(unit.acquiredAt ?? nowISO());
  const [conditions, setConditions] = useState('');
  const act = useAction();
  return (
    <Sheet title="Garantía del proveedor" onClose={onClose}>
      <div className="grid-2">
        <Field label="Duración" htmlFor="sw-v" error={act.field === 'durationValue' ? act.error : null}>
          <IntInput id="sw-v" value={value} onChange={setValue} />
        </Field>
        <Field label="Unidad">
          <Segmented label="Unidad de tiempo" value={unitT} onChange={setUnitT} options={[['days', 'Días'], ['months', 'Meses']]} />
        </Field>
      </div>
      <Field label="Inicio" htmlFor="sw-start">
        <DateTimeInput id="sw-start" value={start} onChange={setStart} />
      </Field>
      <Field label="Condiciones" htmlFor="sw-cond">
        <textarea id="sw-cond" className="textarea" value={conditions} onChange={(e) => setConditions(e.target.value)} />
      </Field>
      <FormError error={act.field === 'durationValue' ? null : act.error} />
      <button
        className="btn primary block"
        disabled={act.busy}
        onClick={async () => {
          const ok = await act.run(
            () =>
              createWarranty(db, {
                type: 'supplier',
                inventoryId: unit.inventoryId,
                unitId: unit.id,
                productId: unit.productId,
                supplierId: unit.supplierId,
                startDate: start ?? '',
                durationValue: value ?? 0,
                durationUnit: unitT,
                conditions,
              }).then(() => true),
            'Garantía registrada',
          );
          if (ok) onClose();
        }}
      >
        Guardar garantía
      </button>
    </Sheet>
  );
}

function PhotosCard({ unitId, photos, canAdd }: { unitId: ID; photos: { id: string; data: ArrayBuffer; mime: string; createdAt: string }[]; canAdd: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const act = useAction();
  useEffect(() => {
    const m: Record<string, string> = {};
    for (const p of photos) m[p.id] = URL.createObjectURL(new Blob([p.data], { type: p.mime }));
    setUrls(m);
    return () => Object.values(m).forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);
  const add = async (file: File | undefined) => {
    if (!file) return;
    await act.run(async () => {
      const img = await compressImage(file);
      await db.transaction('rw', db.photos, db.history, db.units, async () => {
        const u = await db.units.get(unitId);
        await db.photos.add({ id: newId(), unitId, mime: img.mime, data: img.data, width: img.width, height: img.height, createdAt: nowISO() });
        await db.history.add({ id: newId(), at: nowISO(), entityType: 'unit', entityId: unitId, inventoryId: u?.inventoryId ?? null, action: 'photo', summary: 'Foto agregada' });
      });
    }, 'Foto guardada');
  };
  return (
    <Card title={`Fotos (${photos.length})`}>
      <div className="stack">
        {photos.length ? (
          <div className="photo-grid">
            {photos.map((p) => (
              <button key={p.id} type="button" style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setViewing(p.id)} aria-label={`Ver foto del ${formatDate(p.createdAt)}`}>
                {urls[p.id] ? <img src={urls[p.id]} alt="" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">Sin fotos.</p>
        )}
        {canAdd ? (
          <div className="actions">
            <label className="btn">
              <Icon name="camera" /> Tomar foto
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void add(e.target.files?.[0]).then(() => (e.target.value = ''))} />
            </label>
            <label className="btn">
              <Icon name="upload" /> Elegir imagen
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void add(e.target.files?.[0]).then(() => (e.target.value = ''))} />
            </label>
          </div>
        ) : null}
        <FormError error={act.error} />
      </div>
      {viewing ? (
        <Sheet
          title="Foto"
          onClose={() => setViewing(null)}
          footer={
            <button
              className="btn danger block"
              onClick={async () => {
                const ok = await confirmAction({ title: 'Eliminar foto', message: 'La foto se borrará de este dispositivo.', danger: true, confirmText: 'Eliminar' });
                if (!ok) return;
                await db.photos.delete(viewing);
                toast('Foto eliminada');
                setViewing(null);
              }}
            >
              <Icon name="trash" /> Eliminar foto
            </button>
          }
        >
          {urls[viewing] ? <img src={urls[viewing]} alt="Foto de la unidad" style={{ width: '100%', borderRadius: 8 }} /> : null}
        </Sheet>
      ) : null}
    </Card>
  );
}
