import { useEffect, useState } from 'react';
import {
  createInventory,
  formatCOP,
  formatDate,
  formatInt,
  getAlerts,
  getBalances,
  getFinancialSummary,
  getSettings,
  getSoldObservations,
  getTopSellers,
  velocityBy,
  type InventoryMode,
} from '../../core';
import { PeriodPicker, ScopeSelect, usePeriod, useScope } from '../components/common';
import { Icon } from '../components/Icon';
import { Card, Empty, Field, FormError, Loading, Notice, Page, Segmented, TextInput } from '../components/ui';
import { isIOS, isNative, isStandalone } from '../platform';
import { navigate } from '../router';
import { db, useAction, useLive } from '../store';

export function Kpi({ label, value, prev, foot, money = true, invert = false, testId, text }: { label: string; value: number; prev?: number; foot?: string; money?: boolean; invert?: boolean; testId?: string; text?: string }) {
  let delta: React.ReactNode = null;
  if (prev !== undefined) {
    const diff = value - prev;
    const pct = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
    const up = diff > 0;
    const good = invert ? !up : up;
    delta =
      diff === 0 ? (
        <span>Igual que antes</span>
      ) : (
        <span className={good ? 'delta-up' : 'delta-down'}>
          {up ? '▲' : '▼'} {pct !== null ? `${Math.abs(pct)}%` : ''} (antes {money ? formatCOP(prev) : formatInt(prev)})
        </span>
      );
  }
  return (
    <div className="kpi" data-testid={testId}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{text ?? (money ? formatCOP(value) : formatInt(value))}</div>
      {delta ? <div className="kpi-foot">{delta}</div> : null}
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

function InstallHint() {
  if (isNative() || !isIOS() || isStandalone()) return null;
  return (
    <Notice kind="warn" title="Instale la app en su pantalla de inicio">
      <p>
        En Safari toque <strong>Compartir</strong> → <strong>Añadir a pantalla de inicio</strong>. Use siempre la app instalada: iOS puede borrar los datos de sitios
        abiertos en Safari tras 7 días sin uso, y los datos de Safari y de la app instalada son independientes.
      </p>
    </Notice>
  );
}

function UpdateBanner() {
  const [worker, setWorker] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const on = (e: Event) => setWorker((e as CustomEvent<ServiceWorker>).detail);
    window.addEventListener('app-update-ready', on);
    return () => window.removeEventListener('app-update-ready', on);
  }, []);
  if (!worker) return null;
  return (
    <Notice kind="info" title="Hay una versión nueva de la app">
      <button className="btn sm primary" style={{ marginTop: 6 }} onClick={() => worker.postMessage({ type: 'SKIP_WAITING' })}>
        Actualizar ahora
      </button>
    </Notice>
  );
}

function FirstInventory() {
  const settings = useLive((d) => getSettings(d));
  const [name, setName] = useState('Mi inventario');
  const [mode, setMode] = useState<InventoryMode | null>(null);
  const act = useAction();
  if (!settings) return <Loading />;
  const m = mode ?? settings.defaultMode;
  return (
    <Card title="Empiece creando su primer inventario">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const inv = await act.run(() => createInventory(db, { name, mode: m }), 'Inventario creado');
          if (inv) navigate(`/inventarios/${inv.id}`);
        }}
      >
        <Field label="Nombre" htmlFor="fi-name" error={act.field === 'name' ? act.error : null}>
          <TextInput id="fi-name" value={name} onChange={(e) => setName(e.target.value)} invalid={act.field === 'name'} />
        </Field>
        <Field
          label="Modalidad"
          hint={m === 'simple' ? 'Sencillo: registra lo esencial (producto, cantidad, costo, precio) en pocos pasos.' : 'Profesional: añade IMEI/serial, códigos internos, inspección, fotos, garantías y trazabilidad por unidad.'}
        >
          <Segmented label="Modalidad" value={m} onChange={setMode} options={[['simple', 'Sencillo'], ['pro', 'Profesional']]} />
        </Field>
        <FormError error={act.field === 'name' ? null : act.error} />
        <button className="btn primary block" disabled={act.busy}>
          Crear inventario
        </button>
        <p className="small muted">Puede cambiar la modalidad cuando quiera sin perder datos. Si ya tiene un respaldo, restáurelo desde <a href="#/respaldo">Respaldo</a>.</p>
      </form>
    </Card>
  );
}

export function HomeScreen() {
  const scope = useScope('homeScope');
  const period = usePeriod('homePeriod');
  const ids = scope.inventoryIds;
  const settings = useLive((d) => getSettings(d));
  const invCount = useLive((d) => d.inventories.count());
  const key = JSON.stringify([ids, period.range.current, period.range.previous]);
  const data = useLive(
    async (d) => {
      const [cur, prev, bal, alerts, top, obs] = await Promise.all([
        getFinancialSummary(d, period.range.current, ids),
        getFinancialSummary(d, period.range.previous, ids),
        getBalances(d, ids),
        getAlerts(d, ids),
        getTopSellers(d, period.range.current, ids),
        getSoldObservations(d, period.range.current, ids),
      ]);
      const vel = velocityBy(obs, () => ({ key: 'all', label: 'Todos' }))[0] ?? null;
      return { cur, prev, bal, alerts, top, vel };
    },
    [key],
  );

  return (
    <Page
      title="Inicio"
      subtitle={settings?.businessName || undefined}
      actions={
        <button className="icon-btn" aria-label="Buscar" onClick={() => navigate('/buscar')}>
          <Icon name="search" />
        </button>
      }
    >
      <InstallHint />
      <UpdateBanner />
      {invCount === 0 ? <FirstInventory /> : null}
      {invCount ? (
        <>
          <div className="stack-sm">
            <ScopeSelect {...scope} />
            <PeriodPicker p={period} />
          </div>
          {!data ? (
            <Loading />
          ) : (
            <>
              <h2 className="section-title">
                Actividad · {period.range.label}
              </h2>
              <div className="kpis">
                <Kpi testId="kpi-net-revenue" label="Ingresos netos" value={data.cur.netRevenue} prev={data.prev.netRevenue} foot={`${data.cur.sales.count} venta(s) · ${data.cur.sales.units} unidad(es)`} />
                <Kpi label="Dinero cobrado" value={data.cur.collected} prev={data.prev.collected} />
                <Kpi
                  testId="kpi-gross-profit"
                  label="Ganancia bruta"
                  value={data.cur.grossProfit}
                  prev={data.prev.grossProfit}
                  foot={data.cur.profitComplete ? undefined : `⚠ Incompleta: ${data.cur.cogsUnknownUnits} unidad(es) sin costo conocido`}
                />
                <Kpi testId="kpi-net-profit" label="Ganancia neta" value={data.cur.netProfit} prev={data.prev.netProfit} foot={data.cur.profitComplete ? 'Después de gastos y bajas' : '⚠ Incompleta (faltan costos)'} />
                <Kpi label="Compras" value={data.cur.purchases.total} prev={data.prev.purchases.total} invert foot={`${data.cur.purchases.units} unidad(es) compradas`} />
                <Kpi label="Costo de lo vendido" value={data.cur.cogs} invert />
                <Kpi label="Gastos operativos" value={data.cur.operatingExpenses} prev={data.prev.operatingExpenses} invert />
                {data.cur.returns.count ? <Kpi label="Devoluciones" value={data.cur.returns.amount} foot={`${data.cur.returns.units} unidad(es)`} invert /> : null}
              </div>
              <p className="tiny muted">Comparación: {period.range.previousLabel}. Las ganancias solo cuentan productos vendidos; lo que sigue en inventario no es ganancia.</p>

              <h2 className="section-title">Saldos a hoy</h2>
              <div className="kpis">
                <Kpi testId="kpi-receivables" label="Por cobrar" value={data.bal.receivables} foot={`${data.bal.receivableSales} venta(s) con saldo`} />
                <Kpi testId="kpi-stock" label="Existencias disponibles" value={data.bal.available} money={false} foot={data.bal.inReview + data.bal.damaged ? `+${data.bal.inReview} en revisión, ${data.bal.damaged} dañadas` : undefined} />
                <Kpi testId="kpi-stock-value" label="Valor a costo" value={data.bal.stockValue} foot={data.bal.unknownCostCount ? `⚠ ${data.bal.unknownCostCount} unidad(es) sin costo no incluidas` : 'Costo de lo disponible'} />
                <Kpi label="Días promedio hasta vender" value={data.vel?.avgDays ?? 0} text={data.vel?.avgDays == null ? '—' : String(data.vel.avgDays).replace('.', ',')} money={false} foot={data.vel?.count ? `${data.vel.count} venta(s) con fecha conocida` : 'Sin datos suficientes'} />
              </div>

              <AlertsCard alerts={data.alerts} staleDays={settings?.staleDays ?? 60} alertDays={settings?.warrantyAlertDays ?? 15} />

              <Card title="Más vendidos del periodo" action={<a href="#/informes" className="small">Informes</a>}>
                {data.top.length === 0 ? (
                  <Empty icon="chart" title="Sin ventas en el periodo" />
                ) : (
                  <ul className="list">
                    {data.top.slice(0, 5).map((t) => (
                      <li key={t.key} className="item" style={{ cursor: 'default', padding: '10px 0' }}>
                        <span className="item-main">
                          <span className="item-title" style={{ display: 'block' }}>
                            {t.name}
                          </span>
                          <span className="item-sub" style={{ display: 'block' }}>
                            {t.units} vendida(s) · {t.available} disponible(s)
                          </span>
                        </span>
                        <span className="item-side money">{formatCOP(t.revenue)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
          <div className="actions">
            <a className="btn primary" href="#/ventas/nueva">
              <Icon name="tag" /> Vender
            </a>
            <a className="btn" href="#/compras/nueva">
              <Icon name="cart" /> Comprar
            </a>
          </div>
        </>
      ) : null}
    </Page>
  );
}

function AlertsCard({ alerts, staleDays, alertDays }: { alerts: Awaited<ReturnType<typeof getAlerts>>; staleDays: number; alertDays: number }) {
  const items: { kind: 'warn' | 'bad' | 'info'; text: string; href?: string }[] = [];
  if (alerts.backupDue)
    items.push({
      kind: 'warn',
      text: alerts.lastBackupAt ? `Último respaldo: ${formatDate(alerts.lastBackupAt)}. Haga uno nuevo.` : 'Aún no ha hecho ningún respaldo de sus datos.',
      href: '/respaldo',
    });
  for (const l of alerts.lowStock.slice(0, 5))
    items.push({ kind: l.available === 0 ? 'bad' : 'warn', text: `${l.available === 0 ? 'Agotado' : 'Stock bajo'}: ${l.name} (${l.available} disponible(s))`, href: `/productos/${l.productId}` });
  if (alerts.lowStock.length > 5) items.push({ kind: 'warn', text: `…y ${alerts.lowStock.length - 5} producto(s) más con stock bajo` });
  if (alerts.stale.length) items.push({ kind: 'info', text: `${alerts.stale.reduce((a, s) => a + s.qty, 0)} unidad(es) llevan ${staleDays} días o más sin venderse`, href: '/informes?tab=tiempos' });
  if (alerts.warrantiesExpiring.length) items.push({ kind: 'info', text: `${alerts.warrantiesExpiring.length} garantía(s) vencen en los próximos ${alertDays} días`, href: '/garantias' });
  if (alerts.openClaims) items.push({ kind: 'warn', text: `${alerts.openClaims} reclamo(s) de garantía pendientes`, href: '/garantias' });
  if (alerts.receivables.count) items.push({ kind: 'info', text: `${alerts.receivables.count} venta(s) con saldo por cobrar: ${formatCOP(alerts.receivables.amount)}`, href: '/operaciones?tab=ventas&f=pendientes' });
  for (const d of alerts.duplicateIdentifiers.slice(0, 3)) items.push({ kind: 'bad', text: `Posible duplicado: IMEI/serial ${d.identifier} en ${d.codes.join(', ')}`, href: `/buscar?q=${d.identifier}` });
  for (const d of alerts.duplicateProducts.slice(0, 3)) items.push({ kind: 'warn', text: `Producto repetido en un inventario: ${d.name} (${d.count} veces)`, href: `/inventarios/${d.inventoryId}` });
  if (alerts.unknownCostUnits) items.push({ kind: 'info', text: `${alerts.unknownCostUnits} unidad(es) en existencia sin costo conocido` });
  if (alerts.unknownDateUnits) items.push({ kind: 'info', text: `${alerts.unknownDateUnits} unidad(es) con fecha de ingreso desconocida (excluidas de tiempos)` });
  return (
    <Card title="Avisos">
      {items.length === 0 ? (
        <p className="small muted">Sin avisos pendientes.</p>
      ) : (
        <ul className="list" data-testid="alerts">
          {items.map((it, i) => (
            <li key={i}>
              {it.href ? (
                <a className="item" style={{ padding: '10px 0' }} href={`#${it.href}`}>
                  <span className={it.kind === 'bad' ? 'delta-down' : it.kind === 'warn' ? '' : 'muted'}>
                    <Icon name={it.kind === 'info' ? 'info' : 'alert'} size={20} />
                  </span>
                  <span className="item-main small">{it.text}</span>
                  <Icon name="chevron" size={16} />
                </a>
              ) : (
                <div className="item" style={{ padding: '10px 0', cursor: 'default' }}>
                  <span className="muted">
                    <Icon name="info" size={20} />
                  </span>
                  <span className="item-main small">{it.text}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
