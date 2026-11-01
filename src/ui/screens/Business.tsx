import { useEffect, useState } from 'react';
import { BUSINESS_BY_ID, BUSINESS_TYPES, createStarterInventory, featureOn, FEATURES, setBusinessTypes, setFeatureOverride, skipBusinessWelcome, type BusinessTypeId } from '../../core';
import { useBusiness } from '../features';
import { Icon } from '../components/Icon';
import { Card, FormError, Notice } from '../components/ui';
import { navigate } from '../router';
import { db, practice, toast, useAction, useLive } from '../store';

/** Tarjeta para elegir uno o varios tipos de negocio (en la bienvenida y en Configuración). */
function TypePicker({ value, onChange }: { value: BusinessTypeId[]; onChange: (v: BusinessTypeId[]) => void }) {
  return (
    <div className="stack-sm" role="group" aria-label="Tipo de negocio" data-testid="biz-types">
      {BUSINESS_TYPES.map((t) => {
        const on = value.includes(t.id);
        return (
          <label key={t.id} className={`biz-option${on ? ' on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])} data-testid={`biz-${t.id}`} />
            <span>
              <strong>{t.label}</strong>
              <span className="small muted" style={{ display: 'block' }}>
                {t.hint}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Bienvenida de la primera apertura (v2.4): pregunta qué vendes y acomoda la app.
 * Se muestra solo si no hay datos y no se ha terminado antes; quien ya usaba la app no la ve.
 */
export function WelcomeScreen() {
  const [step, setStep] = useState<1 | 2>(1);
  const [types, setTypes] = useState<BusinessTypeId[]>([]);
  const [starter, setStarter] = useState(true);
  const act = useAction();
  const first = types.map((t) => BUSINESS_BY_ID.get(t)).find((t) => t && t.starter.length);
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-inner stack">
        <img src="./icons/icon.svg" alt="" width="56" height="56" className="brand-logo" />
        {step === 1 ? (
          <>
            <div>
              <h1>¡Hola! ¿Qué vendes?</h1>
              <p className="muted">Elige uno o varios. La app muestra solo lo que te sirve y lo puedes cambiar cuando quieras en Configuración.</p>
            </div>
            <TypePicker value={types} onChange={setTypes} />
            <div className="stack-sm">
              <button className="btn primary block" disabled={!types.length} onClick={() => setStep(2)} data-testid="welcome-next">
                Continuar
              </button>
              <button
                className="btn block"
                data-testid="welcome-skip"
                disabled={act.busy}
                onClick={async () => {
                  await act.run(() => skipBusinessWelcome(db));
                }}
              >
                Omitir por ahora
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1>Listo, así queda tu app</h1>
              <ul className="small" data-testid="welcome-summary">
                {FEATURES.map((f) => {
                  const on = types.some((t) => BUSINESS_BY_ID.get(t)?.features[f.key]);
                  return (
                    <li key={f.key}>
                      {on ? '✓' : '—'} {f.label} {on ? '' : '(oculto; lo activas en Configuración)'}
                    </li>
                  );
                })}
              </ul>
            </div>
            {first ? (
              <label className="check">
                <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} data-testid="welcome-starter" /> Crear mi inventario «{first.inventoryName}» con productos típicos ({first.starter.length}), sin precios: los pones tú
              </label>
            ) : null}
            <FormError error={act.error} />
            <div className="stack-sm">
              <button
                className="btn primary block"
                disabled={act.busy}
                data-testid="welcome-done"
                onClick={async () => {
                  const ok = await act.run(async () => {
                    await setBusinessTypes(db, types);
                    if (first && starter) return createStarterInventory(db, first.id);
                    return null;
                  });
                  if (ok === undefined) return;
                  if (ok) navigate(`/inventarios/${ok.inventoryId}`);
                  toast('¡Todo listo!');
                }}
              >
                Empezar
              </button>
              <button className="btn block" onClick={() => setStep(1)}>
                Volver
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Decide si se muestra la bienvenida. Quien ya tenía inventarios (de antes de la 2.4) no la ve: se marca como hecha. */
export function useShowWelcome(): boolean {
  const biz = useBusiness();
  const invCount = useLive((d) => d.inventories.count(), []);
  const needs = !practice && !!biz && !biz.done && invCount === 0 && typeof navigator !== 'undefined' && !navigator.webdriver;
  useEffect(() => {
    if (practice || !biz || biz.done || invCount === undefined) return;
    // Datos de antes: no se pregunta nada, todo queda activo
    if (invCount > 0 || (typeof navigator !== 'undefined' && navigator.webdriver)) void skipBusinessWelcome(db);
  }, [biz, invCount]);
  return needs;
}

/** Configuración → Tu negocio: cambiar o sumar tipos de negocio y activar o apagar funciones. */
export function BusinessCard() {
  const biz = useBusiness();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [types, setTypes] = useState<BusinessTypeId[]>([]);
  useEffect(() => {
    if (biz) setTypes(biz.types);
  }, [biz]);
  if (!biz) return null;
  const names = biz.types.map((t) => BUSINESS_BY_ID.get(t)?.label).filter(Boolean);
  return (
    <Card title="Tu negocio" tour="settings-business">
      <div className="stack">
        {!editing ? (
          <>
            <p className="small" data-testid="biz-current">
              {names.length ? names.join(' · ') : 'Sin elegir: se muestra todo.'}
            </p>
            <button className="btn" onClick={() => setEditing(true)} data-testid="biz-edit">
              <Icon name="edit" /> Cambiar o agregar otro negocio
            </button>
          </>
        ) : (
          <>
            <Notice title="Puedes elegir varios, incluso de tipos distintos">Se muestra lo que le sirva a cualquiera de ellos.</Notice>
            <TypePicker value={types} onChange={setTypes} />
            <FormError error={act.error} />
            <div className="row">
              <button
                className="btn primary"
                disabled={act.busy || !types.length}
                data-testid="biz-save"
                onClick={async () => {
                  const ok = await act.run(() => setBusinessTypes(db, types, { keepOverrides: true }), 'Negocio actualizado');
                  if (ok) setEditing(false);
                }}
              >
                Guardar
              </button>
              <button className="btn" onClick={() => { setTypes(biz.types); setEditing(false); }}>
                Cancelar
              </button>
            </div>
          </>
        )}
        <div className="stack-sm" aria-label="Funciones">
          <h3 className="small strong">Funciones</h3>
          {FEATURES.map((f) => (
            <label key={f.key} className="check">
              <input type="checkbox" checked={featureOn(biz, f.key)} onChange={(e) => void act.run(() => setFeatureOverride(db, f.key, e.target.checked))} data-testid={`feat-${f.key}`} /> <span>{f.label}<span className="small muted" style={{ display: 'block' }}>{f.hint}</span></span>
            </label>
          ))}
        </div>
        {biz.types.some((t) => BUSINESS_BY_ID.get(t)?.starter.length) ? (
          <div className="stack-sm">
            <h3 className="small strong">Productos típicos</h3>
            <p className="small muted">Crea un inventario nuevo con los productos de tu tipo de negocio (sin precios).</p>
            {biz.types
              .map((t) => BUSINESS_BY_ID.get(t))
              .filter((t) => t && t.starter.length)
              .map((t) => (
                <button
                  key={t!.id}
                  className="btn"
                  disabled={act.busy}
                  onClick={async () => {
                    const r = await act.run(() => createStarterInventory(db, t!.id), `Inventario «${t!.inventoryName}» creado`);
                    if (r) navigate(`/inventarios/${r.inventoryId}`);
                  }}
                >
                  <Icon name="plus" /> Crear «{t!.inventoryName}» ({t!.starter.length} productos)
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
