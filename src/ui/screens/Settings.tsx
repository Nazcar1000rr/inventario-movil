import { useEffect, useState } from 'react';
import { DB_SCHEMA_VERSION, getSettings, searchAll, updateSettings, type Settings } from '../../core';
import { maskImei, PAYMENT_METHODS, UnitStatusBadge } from '../components/common';
import { L } from '../components/help';
import { Icon } from '../components/Icon';
import { Card, confirmAction, Empty, Field, FormError, IntInput, KV, ListItem, Loading, MoneyInput, Notice, Page, Segmented, TextInput } from '../components/ui';
import { getStorageStatus, isNative, platformName, requestPersistence, type StorageStatus } from '../platform';
import { useRoute } from '../router';
import { db, useAction, useLive } from '../store';
import { playSound, setSoundOn, setVolume, SOUNDS, useSoundPrefs } from '../sound';

declare const __APP_VERSION__: string;

export function MoreScreen() {
  const items: [string, string, string, string?][] = [
    ['/capital', 'Capital', 'trend', 'Cuánto vale tu negocio y cuánto crece'],
    ['/deudas', 'Deudas y préstamos', 'card', 'Tarjeta, proveedores, préstamos y lo que te prestaste'],
    ['/personal', 'Gastos personales', 'wallet', 'Gustos y gastos hormiga: ¿salen de tus ganancias o del capital?'],
    ['/aprende', 'Aprende de negocios', 'star', 'Lecciones cortas con ejemplos, calculadoras y preguntas'],
    ['/informes', 'Informes', 'chart', 'Finanzas, tiempos, más vendidos y rentabilidad'],
    ['/resumen', 'Resumen mensual', 'image', 'Imagen o PDF para compartir'],
    ['/precios', 'Precios de mercado', 'tag', 'Historial de precios y precio sugerido'],
    ['/calculadora', '¿Cuánto pagar?', 'calc', 'Precio máximo de compra'],
    ['/garantias', 'Garantías', 'shield', 'Vigentes, por vencer y reclamos'],
    ['/proveedores', 'Proveedores', 'truck'],
    ['/compradores', 'Compradores', 'users'],
    ['/vistas', 'Vistas consolidadas', 'layers', 'Consultar varios inventarios juntos'],
    ['/catalogo', 'Catálogo de modelos', 'book'],
    ['/buscar', 'Buscar', 'search', 'Código, IMEI, serial, modelo…'],
    ['/historial', 'Historial general', 'history'],
    ['/respaldo', 'Respaldo y restauración', 'download', 'Exportar, importar, deshacer'],
    ['/ajustes', 'Configuración', 'sliders'],
    ['/ayuda', 'Ayuda', 'help', 'Manual, primeros pasos, modo práctica y novedades'],
  ];
  return (
    <Page title="Más" help="more">
      <Card flush>
        <ul className="list">
          {items.map(([href, title, icon, sub]) => (
            <ListItem key={href} href={href} title={title} icon={icon} sub={sub} />
          ))}
        </ul>
      </Card>
    </Page>
  );
}

export function SettingsScreen() {
  const settings = useLive((d) => getSettings(d));
  if (!settings) return <Page title="Configuración" back="/mas"><Loading /></Page>;
  return <SettingsForm initial={settings} />;
}

function DecimalInput({ id, value, onChange, suffix = '%' }: { id: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  return (
    <div className="input-affix">
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9,.]/g, '');
          setText(t);
          const n = Number.parseFloat(t.replace(',', '.'));
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
      <span className="affix" aria-hidden="true">
        {suffix}
      </span>
    </div>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [conditions, setConditions] = useState(initial.conditions.join(', '));
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const installationId = useLive(async (d) => (await d.meta.get('installationId'))?.value ?? '');
  const act = useAction();
  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, []);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setPr = <K extends keyof Settings['pricing']>(k: K, v: Settings['pricing'][K]) => setS((x) => ({ ...x, pricing: { ...x.pricing, [k]: v } }));
  const dirty = JSON.stringify({ ...s, conditions }) !== JSON.stringify({ ...initial, conditions: initial.conditions.join(', ') });
  const err = (f: string) => (act.field === f ? act.error : null);
  const methods = [...new Set([...PAYMENT_METHODS, ...Object.keys(s.paymentFees)])];
  return (
    <Page title="Configuración" help="settings" back="/mas">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          await act.run(() => updateSettings(db, { ...s, conditions: conditions.split(',').map((c) => c.trim()).filter(Boolean) }), 'Configuración guardada');
        }}
      >
        <Card title="Negocio">
          <div className="stack">
            <Field label="Nombre del negocio (opcional)" htmlFor="st-name">
              <TextInput id="st-name" value={s.businessName} onChange={(e) => set('businessName', e.target.value)} />
            </Field>
            <Field label="Modalidad por defecto para inventarios nuevos">
              <Segmented label="Modalidad por defecto" value={s.defaultMode} onChange={(v) => set('defaultMode', v)} options={[['simple', 'Sencillo'], ['pro', 'Profesional']]} />
            </Field>
            <div className="field">
              <span className="field-label">Prefijos de códigos internos</span>
              <span className="hint">Los códigos ya asignados no cambian. Cada prefijo tiene su propio contador y los números nunca se reutilizan.</span>
              <div className="grid-2">
                {(
                  [
                    ['iphone', 'iPhone'],
                    ['phone', 'Otros teléfonos'],
                    ['audio', 'Audífonos'],
                    ['accessory', 'Accesorios'],
                    ['other', 'Otros'],
                  ] as [keyof Settings['prefixes'], string][]
                ).map(([k, l]) => (
                  <Field key={k} label={l} htmlFor={`pf-${k}`} error={err(`prefix.${k}`)}>
                    <TextInput id={`pf-${k}`} autoCapitalize="characters" maxLength={6} value={s.prefixes[k]} onChange={(e) => set('prefixes', { ...s.prefixes, [k]: e.target.value.toUpperCase() })} />
                  </Field>
                ))}
              </div>
            </div>
            <Field label="Estados del equipo" htmlFor="st-cond" hint="Separados por comas. Nuevo, Usado y Restaurado se usan para precios y días de estancado.">
              <TextInput id="st-cond" value={conditions} onChange={(e) => setConditions(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Productos estancados">
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={s.staleEnabled} onChange={(e) => set('staleEnabled', e.target.checked)} data-testid="stale-enabled" /> Avisarme de productos que llevan mucho tiempo sin venderse
            </label>
            <div className="grid-2">
              <Field label="Días (general)" htmlFor="st-stale" error={err('staleDays')}>
                <IntInput id="st-stale" value={s.staleDays} onChange={(v) => set('staleDays', v ?? 0)} />
              </Field>
              <Field label="Días para nuevos" htmlFor="st-stale-new" hint="Vacío = el general" error={err('staleDaysNew')}>
                <IntInput id="st-stale-new" value={s.staleDaysNew} onChange={(v) => set('staleDaysNew', v)} placeholder={String(s.staleDays)} />
              </Field>
              <Field label="Días para usados y restaurados" htmlFor="st-stale-used" hint="Vacío = el general" error={err('staleDaysUsed')}>
                <IntInput id="st-stale-used" value={s.staleDaysUsed} onChange={(v) => set('staleDaysUsed', v)} placeholder={String(s.staleDays)} />
              </Field>
            </div>
            <p className="tiny muted">Aunque apagues los avisos, en Capital verás el "dinero dormido" con estos mismos días.</p>
          </div>
        </Card>

        <Card title="Precios">
          <div className="stack">
            <Field label={<L k="minPrice">Margen mínimo (precio mínimo de venta)</L>} error={err('pricing.minMarginValue')}>
              <Segmented label="Tipo de margen mínimo" value={s.pricing.minMarginType} onChange={(v) => setPr('minMarginType', v)} options={[['amount', 'En pesos'], ['percent', 'En %']]} />
              {s.pricing.minMarginType === 'amount' ? (
                <MoneyInput ariaLabel="Margen mínimo en pesos" value={s.pricing.minMarginValue} onChange={(v) => setPr('minMarginValue', v ?? 0)} />
              ) : (
                <DecimalInput id="st-minpct" value={s.pricing.minMarginValue} onChange={(v) => setPr('minMarginValue', v)} />
              )}
            </Field>
            <Field label={<L k="maxBuy">Margen deseado al comprar (calculadora)</L>} error={err('pricing.targetMarginValue')}>
              <Segmented label="Tipo de margen deseado" value={s.pricing.targetMarginType} onChange={(v) => setPr('targetMarginType', v)} options={[['amount', 'En pesos'], ['percent', 'En %']]} />
              {s.pricing.targetMarginType === 'amount' ? (
                <MoneyInput ariaLabel="Margen deseado en pesos" value={s.pricing.targetMarginValue} onChange={(v) => setPr('targetMarginValue', v ?? 0)} />
              ) : (
                <DecimalInput id="st-tgtpct" value={s.pricing.targetMarginValue} onChange={(v) => setPr('targetMarginValue', v)} />
              )}
            </Field>
            <Field label="Gastos esperados por equipo" htmlFor="st-expc" hint="Transporte, alistamiento… (se usan en la calculadora)" error={err('pricing.expectedCosts')}>
              <MoneyInput id="st-expc" value={s.pricing.expectedCosts} onChange={(v) => setPr('expectedCosts', v ?? 0)} />
            </Field>
            <div className="grid-2">
              <Field label="Descontar si la batería es menor a (%)" htmlFor="st-bat" hint="Vacío = sin descuento por batería" error={err('pricing.batteryThreshold')}>
                <IntInput id="st-bat" value={s.pricing.batteryThreshold} onChange={(v) => setPr('batteryThreshold', v === null ? null : Math.min(100, v))} placeholder="Sin descuento" />
              </Field>
              <Field label="Descuento por batería baja" htmlFor="st-batd">
                <MoneyInput id="st-batd" value={s.pricing.batteryDiscount} onChange={(v) => setPr('batteryDiscount', v ?? 0)} />
              </Field>
              <Field label="Descuento por pieza genérica o con aviso" htmlFor="st-gen" hint="0 = sin descuento">
                <MoneyInput id="st-gen" value={s.pricing.genericPartDiscount} onChange={(v) => setPr('genericPartDiscount', v ?? 0)} />
              </Field>
              <Field label="Precio de mercado desactualizado tras (días)" htmlFor="st-mkt" error={err('pricing.marketStaleDays')}>
                <IntInput id="st-mkt" value={s.pricing.marketStaleDays} onChange={(v) => setPr('marketStaleDays', v ?? 0)} />
              </Field>
              <Field label={<L k="recentPrice">Días para "tu precio real"</L>} htmlFor="st-rec" error={err('pricing.recentSalesDays')}>
                <IntInput id="st-rec" value={s.pricing.recentSalesDays} onChange={(v) => setPr('recentSalesDays', v ?? 0)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Comisiones por medio de pago">
          <div className="stack">
            <p className="small muted">Porcentaje que te cobra cada medio (datáfono, plataforma). Se registra solo como gasto al recibir un pago. 0 = sin comisión.</p>
            <div className="grid-2">
              {methods.map((m) => (
                <Field key={m} label={m} htmlFor={`fee-${m}`} error={err(`paymentFees.${m}`)}>
                  <DecimalInput id={`fee-${m}`} value={s.paymentFees[m] ?? 0} onChange={(v) => set('paymentFees', { ...s.paymentFees, [m]: v })} />
                </Field>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Inventario y consejos">
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={s.lotsByDefault !== false} onChange={(e) => set('lotsByDefault', e.target.checked)} data-testid="lots-default" /> Separar por precio de compra (lotes) en productos nuevos por cantidad
            </label>
            <p className="tiny muted">Cada compra queda en su propio lote con su precio y, al vender, sale primero lo más antiguo. Puedes apagarlo en cada producto desde su ficha.</p>
            <label className="check">
              <input type="checkbox" checked={s.personalSpendingTips !== false} onChange={(e) => set('personalSpendingTips', e.target.checked)} /> Consejos al registrar gastos personales
            </label>
            <label className="check">
              <input type="checkbox" checked={s.dailyTips !== false} onChange={(e) => set('dailyTips', e.target.checked)} /> Consejo del día en Inicio
            </label>
          </div>
        </Card>

        <Card title="Recordatorios">
          <div className="grid-2">
            <Field label="Avisar garantías con (días)" htmlFor="st-war" error={err('warrantyAlertDays')}>
              <IntInput id="st-war" value={s.warrantyAlertDays} onChange={(v) => set('warrantyAlertDays', v ?? 0)} />
            </Field>
            <Field label="Recordar respaldo cada (días)" htmlFor="st-bk" hint="0 = no recordar" error={err('backupReminderDays')}>
              <IntInput id="st-bk" value={s.backupReminderDays} onChange={(v) => set('backupReminderDays', v ?? 0)} />
            </Field>
          </div>
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={s.showGettingStarted} onChange={(e) => set('showGettingStarted', e.target.checked)} /> Mostrar "Primeros pasos" en Inicio
          </label>
        </Card>
        <FormError error={act.error} />
        <div className="sticky-save">
          <button className="btn primary block" disabled={act.busy || !dirty} data-testid="save-settings">
            Guardar configuración
          </button>
        </div>
      </form>

      <SoundsCard />

      <Card title="Privacidad y almacenamiento">
        <div className="stack">
          <Notice kind="ok" title="Sin servidores ni nube">
            Todos los datos se guardan solo en este dispositivo. La app no envía información a internet ni sincroniza con otros teléfonos. Para pasar datos a otro teléfono usa Respaldo.
          </Notice>
          <KV
            rows={[
              ['Plataforma', isNative() ? `App ${platformName() === 'android' ? 'Android' : platformName()}` : 'Aplicación web (PWA)'],
              ['Almacenamiento persistente', storage?.persisted === null || !storage ? 'No informado' : storage.persisted ? 'Concedido' : 'No concedido'],
              ['Espacio usado', storage?.usage ? `${(storage.usage / 1024 / 1024).toFixed(1)} MB` : '—'],
            ]}
          />
          {storage && storage.persisted === false ? (
            <button className="btn" onClick={async () => { await requestPersistence(); setStorage(await getStorageStatus()); }}>
              Solicitar almacenamiento persistente
            </button>
          ) : null}
          <p className="small muted">Desinstalar la app o borrar los datos del sitio/navegador elimina la base de datos local. Guarda respaldos fuera del teléfono.</p>
        </div>
      </Card>

      <Card title="Acerca de">
        <KV
          rows={[
            ['Versión de la app', typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'],
            ['Versión de datos', String(DB_SCHEMA_VERSION)],
            ['Instalación', installationId ? installationId.slice(0, 8) : '—'],
          ]}
        />
      </Card>

      <Card title="Zona de peligro">
        <div className="stack">
          <p className="small">Borra todos los datos de este dispositivo (inventarios, ventas, configuración…). Haz un respaldo antes.</p>
          <button
            className="btn danger block"
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Borrar todos los datos',
                danger: true,
                message: <p>Esta acción no se puede deshacer. Solo podrás recuperar los datos si tienes un archivo de respaldo.</p>,
                input: { label: 'Escribe BORRAR para confirmar', required: true, mustEqual: 'BORRAR' },
                confirmText: 'Borrar todo',
              });
              if (!ok) return;
              db.close();
              await db.delete();
              location.hash = '#/';
              location.reload();
            }}
          >
            <Icon name="trash" /> Borrar todos los datos
          </button>
        </div>
      </Card>
    </Page>
  );
}

/** Sonidos: cada uno se activa o desactiva por separado (se guarda al instante, solo en este teléfono). */
function SoundsCard() {
  const prefs = useSoundPrefs();
  return (
    <Card title="Sonidos">
      <div className="stack" data-testid="sounds-card">
        <p className="small muted">Actívalos o desactívalos uno por uno. Toca ▶ para escucharlos. Se guarda al instante.</p>
        <ul className="list">
          {SOUNDS.map((x) => (
            <li key={x.id}>
              <div className="item" style={{ cursor: 'default' }}>
                <label className="check grow" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={prefs.on[x.id]} onChange={(e) => setSoundOn(x.id, e.target.checked)} data-testid={`sound-${x.id}`} data-sound="none" />
                  <span>
                    <span className="strong" style={{ display: 'block' }}>
                      {x.label}
                    </span>
                    <span className="tiny muted">{x.hint}</span>
                  </span>
                </label>
                <button type="button" className="icon-btn" aria-label={`Escuchar: ${x.label}`} data-sound="none" disabled={!prefs.on[x.id]} onClick={() => playSound(x.id)}>
                  <Icon name="play" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <Field label={`Volumen: ${Math.round(prefs.volume * 100)} %`} htmlFor="snd-vol">
          <input id="snd-vol" type="range" min={0} max={100} step={10} value={Math.round(prefs.volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} onPointerUp={() => playSound('success')} />
        </Field>
        <p className="tiny muted">En iPhone, si el teléfono está en silencio es posible que no suenen.</p>
      </div>
    </Card>
  );
}

export function SearchScreen() {
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [term, setTerm] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const res = useLive((d) => searchAll(d, term), [term]);
  const total = res ? res.units.length + res.products.length + res.suppliers.length + res.customers.length : 0;
  return (
    <Page title="Buscar" back="/mas">
      <TextInput type="search" autoFocus placeholder="Código interno, IMEI, serial, modelo, proveedor…" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      {term.trim().length < 2 ? (
        <p className="small muted">Escribe al menos 2 caracteres.</p>
      ) : !res ? (
        <Loading />
      ) : total === 0 ? (
        <Empty icon="search" title="Sin resultados" />
      ) : (
        <>
          {res.units.length ? (
            <Card title="Unidades" flush>
              <ul className="list">
                {res.units.map((u) => (
                  <ListItem
                    key={u.id}
                    href={`/unidades/${u.id}`}
                    title={
                      <>
                        <span className="code">{u.code}</span> · {u.productName}
                      </>
                    }
                    sub={[u.imei ? `IMEI ${maskImei(u.imei)}` : '', u.serial ? `Serial ${u.serial}` : '', u.color].filter(Boolean).join(' · ')}
                    side={<UnitStatusBadge status={u.status} />}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
          {res.products.length ? (
            <Card title="Productos" flush>
              <ul className="list">
                {res.products.map((p) => (
                  <ListItem key={p.id} href={`/productos/${p.id}`} title={p.name} sub={p.reference || p.brand} />
                ))}
              </ul>
            </Card>
          ) : null}
          {res.suppliers.length ? (
            <Card title="Proveedores" flush>
              <ul className="list">
                {res.suppliers.map((s) => (
                  <ListItem key={s.id} href={`/proveedores/${s.id}`} title={s.name} sub={[s.phone, s.city].filter(Boolean).join(' · ')} />
                ))}
              </ul>
            </Card>
          ) : null}
          {res.customers.length ? (
            <Card title="Compradores" flush>
              <ul className="list">
                {res.customers.map((c) => (
                  <ListItem key={c.id} href={`/compradores/${c.id}`} title={c.name} sub={[c.phone, c.city].filter(Boolean).join(' · ')} />
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </Page>
  );
}
