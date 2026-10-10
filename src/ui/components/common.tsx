import { useState } from 'react';
import {
  daysBetween,
  formatDate,
  fromDateInput,
  PAYMENT_STATUS_LABEL,
  periodRange,
  PERIOD_LABEL,
  toDateInput,
  UNIT_STATUS_LABEL,
  type ID,
  type Inventory,
  type PaymentStatus,
  type PeriodKind,
  type PeriodRange,
  type UnitStatus,
} from '../../core';
import { useLive, usePref } from '../store';
import { Icon } from './Icon';
import { Badge, Chips } from './ui';

export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Tarjeta', 'Otro'];

export function useInventories(): Inventory[] | undefined {
  return useLive(async (db) => {
    const all = await db.inventories.toArray();
    return all.sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'es'));
  });
}

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  const map: Record<UnitStatus, ['ok' | 'info' | 'warn' | 'bad' | undefined, string]> = {
    available: ['ok', 'check'],
    sold: ['info', 'tag'],
    in_review: ['warn', 'clipboard'],
    damaged: ['bad', 'alert'],
    archived: [undefined, 'ban'],
  };
  const [k, icon] = map[status];
  return (
    <Badge kind={k}>
      <Icon name={icon} size={13} /> {UNIT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, ['ok' | 'info' | 'warn' | 'bad' | undefined, string]> = {
    pagada: ['ok', 'check'],
    parcial: ['warn', 'clock'],
    pendiente: ['bad', 'alert'],
    devuelta: ['info', 'return'],
    anulada: [undefined, 'ban'],
  };
  const [k, icon] = map[status];
  return (
    <Badge kind={k}>
      <Icon name={icon} size={13} /> {PAYMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: Inventory['mode'] }) {
  return <Badge kind={mode === 'pro' ? 'brand' : undefined}>{mode === 'pro' ? 'Profesional' : 'Sencillo'}</Badge>;
}

export function DaysLabel({ since }: { since: string | null }) {
  if (!since) return <span className="muted">Fecha desconocida</span>;
  const d = daysBetween(since);
  return (
    <span title={`Desde ${formatDate(since)}`}>
      {d} {d === 1 ? 'día' : 'días'}
    </span>
  );
}

export function InventorySelect({
  id,
  value,
  onChange,
  inventories,
  includeArchived = false,
  invalid,
}: {
  id?: string;
  value: ID;
  onChange: (id: ID) => void;
  inventories: Inventory[];
  includeArchived?: boolean;
  invalid?: boolean;
}) {
  const list = inventories.filter((i) => includeArchived || !i.archived || i.id === value);
  return (
    <select id={id} className="select" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
      <option value="">Elige un inventario…</option>
      {list.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
          {i.archived ? ' (archivado)' : ''}
        </option>
      ))}
    </select>
  );
}

/** Inventario por defecto para formularios: el indicado, el último usado o el único activo. */
export function useDefaultInventory(fromQuery: string | null): [string, (v: string) => void, Inventory[] | undefined] {
  const invs = useInventories();
  const [last, setLast] = usePref('lastInventory', '');
  const [chosen, setChosen] = useState<string | null>(fromQuery);
  let value = chosen ?? '';
  if (!chosen && invs) {
    const active = invs.filter((i) => !i.archived);
    if (last && active.some((i) => i.id === last)) value = last;
    else if (active.length === 1) value = active[0].id;
  }
  const set = (v: string) => {
    setChosen(v);
    if (v) setLast(v);
  };
  return [value, set, invs];
}

/* ---------------- Alcance (todos / inventario / vista) ---------------- */

export function useScope(prefKey: string): {
  scope: string;
  setScope: (s: string) => void;
  inventoryIds: ID[] | null;
  label: string;
  options: [string, string][];
  ready: boolean;
} {
  const [scope, setScope] = usePref(prefKey, 'all');
  const data = useLive(async (db) => ({
    invs: await db.inventories.toArray(),
    views: (await db.consolidatedViews.toArray()).filter((v) => !v.archived),
  }));
  const options: [string, string][] = [['all', 'Todos los inventarios']];
  data?.invs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .forEach((i) => options.push([`inv:${i.id}`, `${i.name}${i.archived ? ' (archivado)' : ''}`]));
  data?.views.forEach((v) => options.push([`view:${v.id}`, `Vista: ${v.name}`]));
  let inventoryIds: ID[] | null = null;
  let label = 'Todos los inventarios';
  let effective = scope;
  if (scope.startsWith('inv:')) {
    const id = scope.slice(4);
    const inv = data?.invs.find((i) => i.id === id);
    if (inv) {
      inventoryIds = [id];
      label = inv.name;
    } else if (data) effective = 'all';
  } else if (scope.startsWith('view:')) {
    const v = data?.views.find((x) => x.id === scope.slice(5));
    if (v) {
      inventoryIds = v.inventoryIds;
      label = `Vista: ${v.name}`;
    } else if (data) effective = 'all';
  }
  return { scope: effective, setScope, inventoryIds, label, options, ready: !!data };
}

export function ScopeSelect({ scope, setScope, options }: { scope: string; setScope: (s: string) => void; options: [string, string][] }) {
  return (
    <select className="select" aria-label="Inventarios incluidos" value={scope} onChange={(e) => setScope(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/* ---------------- Periodo ---------------- */

export function usePeriod(prefKey: string): { kind: PeriodKind; setKind: (k: PeriodKind) => void; range: PeriodRange; custom: { from: string; to: string }; setCustom: (c: { from: string; to: string }) => void } {
  const [kind, setKindRaw] = usePref(prefKey, 'month');
  const today = toDateInput(new Date().toISOString());
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + '01', to: today });
  const k = (['today', 'week', 'month', 'year', 'custom'].includes(kind) ? kind : 'month') as PeriodKind;
  const from = fromDateInput(custom.from);
  const to = fromDateInput(custom.to);
  const range = periodRange(k, new Date(), from && to ? { from: new Date(from), to: new Date(to) } : undefined);
  return { kind: k, setKind: (v) => setKindRaw(v), range, custom, setCustom };
}

export function PeriodPicker({ p }: { p: ReturnType<typeof usePeriod> }) {
  return (
    <div className="stack-sm">
      <Chips
        label="Periodo"
        value={p.kind}
        onChange={p.setKind}
        options={(['today', 'week', 'month', 'year', 'custom'] as PeriodKind[]).map((k) => [k, PERIOD_LABEL[k]])}
      />
      {p.kind === 'custom' ? (
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pf">Desde</label>
            <input id="pf" type="date" className="input" value={p.custom.from} max={p.custom.to} onChange={(e) => p.setCustom({ ...p.custom, from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pt">Hasta</label>
            <input id="pt" type="date" className="input" value={p.custom.to} min={p.custom.from} onChange={(e) => p.setCustom({ ...p.custom, to: e.target.value })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function maskImei(v: string): string {
  if (!v) return '';
  return v.length > 4 ? `•••${v.slice(-4)}` : v;
}
