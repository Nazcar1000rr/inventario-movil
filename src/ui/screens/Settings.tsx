import { useEffect, useState } from 'react';
import { DB_SCHEMA_VERSION, getSettings, searchAll, updateSettings, type Settings } from '../../core';
import { maskImei, UnitStatusBadge } from '../components/common';
import { Icon } from '../components/Icon';
import { Card, confirmAction, Empty, Field, FormError, IntInput, KV, ListItem, Loading, Notice, Page, Segmented, TextInput } from '../components/ui';
import { getStorageStatus, isNative, platformName, requestPersistence, type StorageStatus } from '../platform';
import { useRoute } from '../router';
import { db, useAction, useLive } from '../store';

declare const __APP_VERSION__: string;

export function MoreScreen() {
  const items: [string, string, string, string?][] = [
    ['/informes', 'Informes', 'chart', 'Finanzas, tiempos de venta, más vendidos'],
    ['/garantias', 'Garantías', 'shield', 'Vigentes, por vencer y reclamos'],
    ['/proveedores', 'Proveedores', 'truck'],
    ['/compradores', 'Compradores', 'users'],
    ['/vistas', 'Vistas consolidadas', 'layers', 'Consultar varios inventarios juntos'],
    ['/catalogo', 'Catálogo de modelos', 'book'],
    ['/buscar', 'Buscar', 'search', 'Código, IMEI, serial, modelo…'],
    ['/historial', 'Historial general', 'history'],
    ['/respaldo', 'Respaldo y restauración', 'download', 'Exportar, importar, deshacer'],
    ['/ajustes', 'Configuración', 'sliders'],
  ];
  return (
    <Page title="Más">
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
  const dirty = JSON.stringify({ ...s, conditions }) !== JSON.stringify({ ...initial, conditions: initial.conditions.join(', ') });
  return (
    <Page title="Configuración" back="/mas">
      <Card title="Negocio">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await act.run(() => updateSettings(db, { ...s, conditions: conditions.split(',').map((c) => c.trim()).filter(Boolean) }), 'Configuración guardada');
          }}
        >
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
                <Field key={k} label={l} htmlFor={`pf-${k}`} error={act.field === `prefix.${k}` ? act.error : null}>
                  <TextInput id={`pf-${k}`} autoCapitalize="characters" maxLength={6} value={s.prefixes[k]} onChange={(e) => set('prefixes', { ...s.prefixes, [k]: e.target.value.toUpperCase() })} />
                </Field>
              ))}
            </div>
          </div>
          <div className="grid-2">
            <Field label="Días para considerar estancado" htmlFor="st-stale">
              <IntInput id="st-stale" value={s.staleDays} onChange={(v) => set('staleDays', v ?? 0)} />
            </Field>
            <Field label="Avisar garantías con (días)" htmlFor="st-war">
              <IntInput id="st-war" value={s.warrantyAlertDays} onChange={(v) => set('warrantyAlertDays', v ?? 0)} />
            </Field>
            <Field label="Recordar respaldo cada (días)" htmlFor="st-bk" hint="0 = no recordar">
              <IntInput id="st-bk" value={s.backupReminderDays} onChange={(v) => set('backupReminderDays', v ?? 0)} />
            </Field>
          </div>
          <Field label="Estados físicos disponibles" htmlFor="st-cond" hint="Separados por comas">
            <TextInput id="st-cond" value={conditions} onChange={(e) => setConditions(e.target.value)} />
          </Field>
          <FormError error={act.error} />
          <button className="btn primary block" disabled={act.busy || !dirty}>
            Guardar configuración
          </button>
        </form>
      </Card>

      <Card title="Privacidad y almacenamiento">
        <div className="stack">
          <Notice kind="ok" title="Sin servidores ni nube">
            Todos los datos se guardan solo en este dispositivo. La app no envía información a internet ni sincroniza con otros teléfonos. Para pasar datos a otro teléfono use Respaldo.
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
          <p className="small muted">Desinstalar la app o borrar los datos del sitio/navegador elimina la base de datos local. Conserve respaldos fuera del teléfono.</p>
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
          <p className="small">Borra todos los datos de este dispositivo (inventarios, ventas, configuración…). Haga un respaldo antes.</p>
          <button
            className="btn danger block"
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Borrar todos los datos',
                danger: true,
                message: <p>Esta acción no se puede deshacer. Solo podrá recuperar los datos si tiene un archivo de respaldo.</p>,
                input: { label: 'Escriba BORRAR para confirmar', required: true, mustEqual: 'BORRAR' },
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
        <p className="small muted">Escriba al menos 2 caracteres.</p>
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
