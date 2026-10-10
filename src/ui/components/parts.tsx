import { useState } from 'react';
import {
  formatDate,
  fromDateInput,
  partLabel,
  partsSummary,
  PART_BY_LABEL,
  PART_KEYS,
  PART_LABEL,
  PART_QUALITY_LABEL,
  removePartChange,
  savePartChange,
  toDateInput,
  type PartChange,
  type PartChangedBy,
  type PartInput,
  type PartKey,
  type PartQuality,
  type Unit,
} from '../../core';
import { db, useAction, useLive } from '../store';
import { Icon } from './Icon';
import { Badge, Card, Chips, confirmAction, Field, FormError, Segmented, Sheet, TextInput } from './ui';

export const STANDARD_CONDITIONS = ['Nuevo', 'Usado', 'Restaurado'];

/** Selector de estado del equipo (Nuevo / Usado / Restaurado y los que agregues en Configuración). */
export function ConditionChips({ value, onChange, allowEmpty = true, label = 'Estado del equipo' }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean; label?: string }) {
  const settings = useLive((d) => d.settings.get('app'));
  const list = settings?.conditions?.length ? settings.conditions : STANDARD_CONDITIONS;
  const opts: [string, string][] = list.map((c) => [c, c]);
  if (allowEmpty) opts.push(['', 'Sin indicar']);
  return <Chips label={label} value={value} onChange={onChange} options={opts} />;
}

/** Etiquetas de piezas para listas y fichas. */
export function PartsBadges({ parts, compact }: { parts: PartChange[] | undefined; compact?: boolean }) {
  const s = partsSummary(parts);
  if (!s.count) return null;
  return (
    <span className="row wrap" style={{ gap: 4, display: 'inline-flex' }}>
      <Badge kind="info">
        <Icon name="wrench" size={13} /> {compact ? s.count : `${s.count} ${s.count === 1 ? 'pieza cambiada' : 'piezas cambiadas'}`}
      </Badge>
      {s.generic ? (
        <Badge kind="warn">
          {s.generic} genérica{s.generic === 1 ? '' : 's'}
        </Badge>
      ) : null}
      {s.warnings ? (
        <Badge kind="bad">
          <Icon name="alert" size={13} /> Pieza desconocida
        </Badge>
      ) : null}
    </span>
  );
}

function describe(p: Pick<PartChange, 'quality' | 'by' | 'date' | 'unknownPartWarning'>): string {
  return [PART_QUALITY_LABEL[p.quality], `por ${PART_BY_LABEL[p.by].toLowerCase()}`, p.date ? formatDate(p.date) : '', p.unknownPartWarning ? 'aviso "pieza desconocida"' : '']
    .filter(Boolean)
    .join(' · ');
}

/** Formulario de una pieza cambiada. */
export function PartSheet({
  initial,
  onSave,
  onClose,
  busy,
  error,
  showBy = true,
}: {
  initial?: Partial<PartInput>;
  onSave: (p: PartInput) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
  showBy?: boolean;
}) {
  const [part, setPart] = useState<PartKey>(initial?.part ?? 'battery');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [quality, setQuality] = useState<PartQuality>(initial?.quality ?? 'unknown');
  const [by, setBy] = useState<PartChangedBy>(initial?.by ?? 'unknown');
  const [date, setDate] = useState(initial?.date ? toDateInput(initial.date) : '');
  const [warn, setWarn] = useState(initial?.unknownPartWarning ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Sheet
      title={initial?.id ? 'Editar pieza' : 'Agregar pieza cambiada'}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary block"
          disabled={busy}
          onClick={() => {
            if (part === 'other' && !label.trim()) return setLocalErr('Escribe qué pieza se cambió.');
            setLocalErr(null);
            onSave({ id: initial?.id, part, label: label.trim(), quality, by, date: date ? fromDateInput(date) : null, unknownPartWarning: warn, notes });
          }}
        >
          Guardar pieza
        </button>
      }
    >
      <div className="stack">
        <Field label="¿Qué se cambió o reparó?">
          <Chips label="Pieza" value={part} onChange={setPart} options={PART_KEYS.map((k) => [k, PART_LABEL[k]])} />
        </Field>
        {part === 'other' || label ? (
          <Field label={part === 'other' ? 'Describe la pieza' : 'Detalle (opcional)'} htmlFor="pt-label">
            <TextInput id="pt-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej.: flex de encendido" />
          </Field>
        ) : null}
        <Field label="Calidad de la pieza">
          <Segmented label="Calidad" value={quality} onChange={setQuality} options={[['original', 'Original'], ['generic', 'Genérica'], ['unknown', 'No sé']]} />
        </Field>
        {showBy ? (
          <Field label="¿Quién la cambió?" htmlFor="pt-by">
            <select id="pt-by" className="select" value={by} onChange={(e) => setBy(e.target.value as PartChangedBy)}>
              {(Object.keys(PART_BY_LABEL) as PartChangedBy[]).map((k) => (
                <option key={k} value={k}>
                  {PART_BY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> El iPhone muestra el aviso de "pieza desconocida" / "pieza no genuina"
        </label>
        {showBy ? (
          <Field label="Fecha del cambio (opcional)" htmlFor="pt-date">
            <input id="pt-date" type="date" className="input" value={date} max={toDateInput(new Date().toISOString())} onChange={(e) => setDate(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Notas (opcional)" htmlFor="pt-notes">
          <TextInput id="pt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={localErr ?? error ?? null} />
      </div>
    </Sheet>
  );
}

/** Editor de piezas en memoria (formularios de compra e ingreso de stock). */
export function PartsEditor({ value, onChange }: { value: PartInput[]; onChange: (v: PartInput[]) => void }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  return (
    <div className="stack-sm">
      {value.length ? (
        <ul className="list wrap-sub">
          {value.map((p, i) => (
            <li key={i} className="item" style={{ cursor: 'default', padding: '8px 0' }}>
              <Icon name="wrench" size={18} />
              <span className="item-main">
                <span className="item-title" style={{ display: 'block' }}>
                  {partLabel({ part: p.part, label: p.label ?? '' })}
                </span>
                <span className="item-sub" style={{ display: 'block' }}>
                  {describe({ quality: p.quality ?? 'unknown', by: p.by ?? 'unknown', date: p.date ?? null, unknownPartWarning: !!p.unknownPartWarning })}
                </span>
              </span>
              <button type="button" className="icon-btn" aria-label={`Editar ${PART_LABEL[p.part]}`} onClick={() => setEditing(i)}>
                <Icon name="edit" size={18} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Quitar ${PART_LABEL[p.part]}`} onClick={() => onChange(value.filter((_, k) => k !== i))}>
                <Icon name="x" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn sm" onClick={() => setEditing('new')}>
        <Icon name="wrench" size={18} /> Agregar pieza cambiada
      </button>
      {editing !== null ? (
        <PartSheet
          initial={editing === 'new' ? undefined : value[editing]}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            onChange(editing === 'new' ? [...value, p] : value.map((x, k) => (k === editing ? p : x)));
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Tarjeta de la ficha del equipo: historial de reparaciones y piezas, con edición. */
export function UnitPartsCard({ unit }: { unit: Unit }) {
  const [editing, setEditing] = useState<PartChange | 'new' | null>(null);
  const act = useAction();
  const parts = unit.partsHistory ?? [];
  return (
    <Card
      title="Reparaciones y piezas"
      action={
        <button type="button" className="btn sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Agregar
        </button>
      }
    >
      {parts.length === 0 ? (
        <p className="small muted">Sin piezas cambiadas registradas. Si el equipo es usado o restaurado, anota lo que sepas: batería, pantalla, etc.</p>
      ) : (
        <>
          <PartsBadges parts={parts} />
          <ul className="list wrap-sub" data-testid="parts-list">
            {parts.map((p) => (
              <li key={p.id} className="item" style={{ cursor: 'default', padding: '8px 0' }}>
                <span className={p.quality === 'generic' || p.unknownPartWarning ? 'delta-down' : 'muted'}>
                  <Icon name={p.unknownPartWarning ? 'alert' : 'wrench'} size={18} />
                </span>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {partLabel(p)}
                    {p.repairId ? <span className="tiny muted"> · reparación registrada</span> : null}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {describe(p)}
                    {p.notes ? ` · ${p.notes}` : ''}
                  </span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Editar ${partLabel(p)}`} onClick={() => setEditing(p)}>
                  <Icon name="edit" size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Quitar ${partLabel(p)}`}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: 'Quitar del historial',
                      message: <p>Se quita "{partLabel(p)}" del historial de piezas. {p.repairId ? 'El costo de la reparación no cambia.' : ''}</p>,
                      confirmText: 'Quitar',
                      danger: true,
                    });
                    if (ok) await act.run(() => removePartChange(db, unit.id, p.id), 'Pieza quitada');
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Anotar piezas no cambia el costo. Para sumar el costo de una reparación pagada usa "Registrar reparación pagada" (menú ⋮).
      </p>
      {editing ? (
        <PartSheet
          initial={editing === 'new' ? undefined : editing}
          busy={act.busy}
          error={act.error}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            const r = await act.run(() => savePartChange(db, unit.id, p), 'Pieza guardada');
            if (r) setEditing(null);
          }}
        />
      ) : null}
    </Card>
  );
}
