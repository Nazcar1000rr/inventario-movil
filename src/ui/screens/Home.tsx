import { useEffect, useState, type ReactNode } from 'react';
import {
  createInventory,
  formatCOP,
  formatDate,
  formatInt,
  getAlerts,
  getBalances,
  getBusinessAnalysis,
  getCapitalSnapshot,
  getFinancialSummary,
  getSettings,
  getSoldObservations,
  getTopSellers,
  velocityBy,
  type InventoryMode,
} from '../../core';
import { PeriodPicker, ScopeSelect, usePeriod, useScope } from '../components/common';
import { InfoTip } from '../components/help';
import { GettingStartedCard } from './Help';
import { Icon } from '../components/Icon';
import { Card, Empty, Field, FormError, Loading, Notice, Page, Segmented, TextInput } from '../components/ui';
import { isIOS, isNative, isStandalone } from '../platform';
import { navigate } from '../router';
import { db, getPref, setPref, useAction, useLive } from '../store';
import { DAILY_TIPS, pickTip } from '../help/content';
import { isTourDone, startTour, toursOff } from '../tour';
import { InquiryCounter } from './Inquiries';
import { DueReminders, useDueReminders } from './Calendar';
import { Meter } from '../components/viz';
import { ListenButton } from '../components/speaker';

export function Kpi({
  label,
  value,
  prev,
  foot,
  money = true,
  invert = false,
  testId,
  text,
  info,
  tone,
}: {
  label: string;
  value: number;
  prev?: number;
  foot?: ReactNode;
  money?: boolean;
  invert?: boolean;
  testId?: string;
  text?: string;
  /** Clave de la explicación ⓘ (help/content.ts → METRICS). */
  info?: string;
  tone?: 'good' | 'bad';
}) {
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
      <div className="kpi-label">
        {label}
        {info ? <InfoTip k={info} label={label} /> : null}
      </div>
      <div className={`kpi-value${tone === 'good' ? ' delta-up' : tone === 'bad' ? ' delta-down' : ''}`}>{text ?? (money ? formatCOP(value) : formatInt(value))}</div>
      {delta ? <div className="kpi-foot">{delta}</div> : null}
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

function InstallHint() {
  if (isNative() || !isIOS() || isStandalone()) return null;
  return (
    <Notice kind="warn" title="Instala la app en tu pantalla de inicio">
      <p>
        En Safari toca <strong>Compartir</strong> → <strong>Añadir a pantalla de inicio</strong>. Usa siempre la app instalada: iOS puede borrar los datos de sitios
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
    <Card title="Empieza creando tu primer inventario">
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
        <p className="small muted">
          Puedes cambiar la modalidad cuando quieras sin perder datos. Si ya tienes un respaldo, restáuralo desde <a href="#/respaldo">Respaldo</a>. ¿Quieres practicar primero? Entra al{' '}
          <a href="#/ayuda">modo práctica</a>.
        </p>
      </form>
    </Card>
  );
}

/** Ofrece el recorrido "Conoce la app" la primera vez. */
function TourOffer() {
  const [hidden, setHidden] = useState(() => getPref('tourOffer', '') !== '' || isTourDone('app') || toursOff());
  if (hidden) return null;
  return (
    <Card>
      <div className="stack-sm" data-testid="tour-offer">
        <p className="strong">👋 ¿Primera vez aquí?</p>
        <p className="small">Te muestro la app en un minuto, sobre las pantallas reales. También hay lecciones cortas para entender tus números.</p>
        <div className="row wrap">
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              setHidden(true);
              startTour('app');
            }}
          >
            <Icon name="play" /> Hacer el recorrido
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setPref('tourOffer', 'dismissed');
              setHidden(true);
            }}
          >
            Ahora no
          </button>
        </div>
      </div>
    </Card>
  );
}

/** Consejo del día (se puede apagar en Configuración). */
function DailyTipCard() {
  const [offset, setOffset] = useState(0);
  const tip = pickTip(DAILY_TIPS, new Date(), offset);
  return (
    <div className="tip-card daily-tip" data-testid="daily-tip">
      <span className="tip-icon">💡</span>
      <div className="grow">
        <p className="tiny muted">Consejo del día</p>
        <p className="small strong">{tip.title}</p>
        <p className="small">{tip.text}</p>
        <div className="tip-actions">
          <ListenButton text={`Consejo del día. ${tip.title}. ${tip.text}`} />
          {tip.to ? (
            <a className="btn sm" href={`#${tip.to}`}>
              {tip.toLabel ?? 'Ver más'}
            </a>
          ) : null}
          <button type="button" className="btn sm" onClick={() => setOffset((o) => o + 1)}>
            Otro consejo
          </button>
        </div>
      </div>
    </div>
  );
}

/** Avisos del calendario que ya llegaron (con la app abierta o al abrirla). */
function HomeReminders() {
  const due = useDueReminders();
  if (!due?.length) return null;
  return (
    <Card
      title={
        <h2 className="with-tip">
          <Icon name="clock" /> Recordatorios
        </h2>
      }
      action={
        <a href="#/calendario" className="small">
          Calendario
        </a>
      }
      flush
    >
      <DueReminders list={due} />
    </Card>
  );
}

/** Salud del negocio y expectativa del mes, con enlace al análisis completo. */
function AnalysisTeaser({ ids }: { ids: string[] | null }) {
  const a = useLive((d) => getBusinessAnalysis(d, ids), [JSON.stringify(ids)]);
  if (!a || !a.hasSales) return null;
  const m = a.expectations.month;
  const goal = m.target ? (m.metric === 'profit' ? m.target.profit : m.target.revenue) : 0;
  const got = m.metric === 'profit' ? m.actual.profit : m.actual.revenue;
  const proj = m.projected ? (m.metric === 'profit' ? m.projected.profit : m.projected.revenue) : null;
  return (
    <a href="#/analisis" className="kpi-link" aria-label="Ver el análisis del negocio" data-testid="analysis-teaser">
      <div className="kpi">
        <div className="kpi-label">Análisis del negocio</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="kpi-value">{a.health.score === null ? '—' : `${a.health.score}/100`}</span>
          <span className="small strong">{a.health.label}</span>
        </div>
        {goal > 0 ? (
          <div style={{ marginTop: 8 }}>
            <Meter value={got / goal} marker={proj !== null ? proj / goal : null} label="Expectativa del mes" />
            <div className="kpi-foot">
              Expectativa del mes: llevas {Math.round((got / goal) * 100)} %{proj !== null ? ` · al ritmo actual ${Math.round((proj / goal) * 100)} %` : ''}
            </div>
          </div>
        ) : null}
        <div className="kpi-foot">Ver todo el análisis →</div>
      </div>
    </a>
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
      const cap = await getCapitalSnapshot(d, ids);
      return { cur, prev, bal, alerts, top, vel, cap };
    },
    [key],
  );

  return (
    <Page
      title="Inicio"
      help="home"
      subtitle={settings?.businessName || undefined}
      actions={
        <button className="icon-btn" aria-label="Buscar" onClick={() => navigate('/buscar')}>
          <Icon name="search" />
        </button>
      }
    >
      <InstallHint />
      <UpdateBanner />
      <TourOffer />
      {invCount === 0 ? <FirstInventory /> : null}
      <GettingStartedCard />
      {settings && settings.dailyTips !== false ? <DailyTipCard /> : null}
      <HomeReminders />
      {invCount ? (
        <Card
          tour="home-inquiries"
          title={
            <h2 className="with-tip">
              Preguntones <InfoTip k="inquiries" />
            </h2>
          }
          action={
            <a href="#/preguntones" className="small">
              Ver análisis
            </a>
          }
        >
          <InquiryCounter compact />
        </Card>
      ) : null}
      {invCount ? <AnalysisTeaser ids={ids} /> : null}
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
              <div className="kpis" data-tour="kpis">
                <Kpi testId="kpi-net-revenue" label="Ingresos netos" info="netRevenue" value={data.cur.netRevenue} prev={data.prev.netRevenue} foot={`${data.cur.sales.count} venta(s) · ${data.cur.sales.units} unidad(es)`} />
                <Kpi label="Dinero cobrado" info="collected" value={data.cur.collected} prev={data.prev.collected} />
                <Kpi
                  testId="kpi-gross-profit"
                  label="Ganancia bruta"
                  info="grossProfit"
                  value={data.cur.grossProfit}
                  prev={data.prev.grossProfit}
                  foot={data.cur.profitComplete ? undefined : `⚠ Incompleta: ${data.cur.cogsUnknownUnits} unidad(es) sin costo conocido`}
                />
                <Kpi testId="kpi-net-profit" label="Ganancia neta" info="netProfit" value={data.cur.netProfit} prev={data.prev.netProfit} foot={data.cur.profitComplete ? 'Después de gastos y bajas' : '⚠ Incompleta (faltan costos)'} />
                <Kpi label="Compras" info="purchases" value={data.cur.purchases.total} prev={data.prev.purchases.total} invert foot={`${data.cur.purchases.units} unidad(es) compradas`} />
                <Kpi label="Costo de lo vendido" info="cogs" value={data.cur.cogs} invert />
                <Kpi label="Gastos operativos" info="operatingExpenses" value={data.cur.operatingExpenses} prev={data.prev.operatingExpenses} invert />
                {data.cur.returns.count ? <Kpi label="Devoluciones" value={data.cur.returns.amount} foot={`${data.cur.returns.units} unidad(es)`} invert /> : null}
              </div>
              <p className="tiny muted">Comparación: {period.range.previousLabel}. Las ganancias solo cuentan productos vendidos; lo que sigue en inventario no es ganancia.</p>

              <h2 className="section-title">Saldos a hoy</h2>
              <div className="kpis">
                <a href="#/capital" className="kpi-link" aria-label="Ver capital">
                  <Kpi testId="kpi-home-value" label="Valor del negocio" info="businessValue" value={data.cap.businessValue} foot="Ver capital →" />
                </a>
                <a href="#/capital" className="kpi-link" aria-label="Ver crecimiento">
                  <Kpi
                    label="Crecimiento"
                    info="growth"
                    value={data.cap.growth}
                    tone={data.cap.growth > 0 ? 'good' : data.cap.growth < 0 ? 'bad' : undefined}
                    foot={data.cap.netCapital > 0 ? `Sobre ${formatCOP(data.cap.netCapital)} aportados` : 'Registra tu capital en Capital'}
                  />
                </a>
                <a href="#/me-deben" className="kpi-link" aria-label="Ver quién te debe">
                  <Kpi testId="kpi-receivables" label="Me deben" info="receivables" value={data.bal.receivables} foot={data.bal.debtors ? `${data.bal.debtors} persona(s) · Ver →` : 'Nadie te debe'} />
                </a>
                <Kpi testId="kpi-stock" label="Existencias disponibles" value={data.bal.available} money={false} foot={data.bal.inReview + data.bal.damaged ? `+${data.bal.inReview} en revisión, ${data.bal.damaged} dañadas` : undefined} />
                <Kpi testId="kpi-stock-value" label="Valor a costo" info="stockValue" value={data.bal.stockValue} foot={data.bal.unknownCostCount ? `⚠ ${data.bal.unknownCostCount} unidad(es) sin costo no incluidas` : 'Costo de lo disponible'} />
                <Kpi label="Días promedio hasta vender" info="avgDaysToSell" value={data.vel?.avgDays ?? 0} text={data.vel?.avgDays == null ? '—' : String(data.vel.avgDays).replace('.', ',')} money={false} foot={data.vel?.count ? `${data.vel.count} venta(s) con fecha conocida` : 'Sin datos suficientes'} />
              </div>

              <AlertsCard alerts={data.alerts} alertDays={settings?.warrantyAlertDays ?? 15} />

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

function AlertsCard({ alerts, alertDays }: { alerts: Awaited<ReturnType<typeof getAlerts>>; alertDays: number }) {
  const items: { kind: 'warn' | 'bad' | 'info'; text: string; href?: string }[] = [];
  if (alerts.backupDue)
    items.push({
      kind: 'warn',
      text: alerts.lastBackupAt ? `Último respaldo: ${formatDate(alerts.lastBackupAt)}. Haz uno nuevo.` : 'Aún no has hecho ningún respaldo de tus datos.',
      href: '/respaldo',
    });
  for (const l of alerts.lowStock.slice(0, 5))
    items.push({ kind: l.available === 0 ? 'bad' : 'warn', text: `${l.available === 0 ? 'Agotado' : 'Stock bajo'}: ${l.name} (${l.available} disponible(s))`, href: `/productos/${l.productId}` });
  if (alerts.lowStock.length > 5) items.push({ kind: 'warn', text: `…y ${alerts.lowStock.length - 5} producto(s) más con stock bajo` });
  if (alerts.stale.length) {
    const days = [...new Set(alerts.stale.map((s) => s.staleDays))].filter((x) => x !== null).sort((a, b) => a! - b!);
    items.push({
      kind: 'info',
      text: `${alerts.stale.reduce((a, s) => a + s.qty, 0)} unidad(es) llevan ${days.length === 1 ? `${days[0]} días o más` : 'más días de lo esperado'} sin venderse`,
      href: '/informes?tab=tiempos',
    });
  }
  if (alerts.warrantiesExpiring.length) items.push({ kind: 'info', text: `${alerts.warrantiesExpiring.length} garantía(s) vencen en los próximos ${alertDays} días`, href: '/garantias' });
  if (alerts.openClaims) items.push({ kind: 'warn', text: `${alerts.openClaims} reclamo(s) de garantía pendientes`, href: '/garantias' });
  if (alerts.receivables.count) items.push({ kind: 'info', text: `Te deben ${formatCOP(alerts.receivables.amount)} (${alerts.receivables.count} venta(s) fiadas o pendientes)`, href: '/me-deben' });
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
