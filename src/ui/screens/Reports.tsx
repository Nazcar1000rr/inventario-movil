import { useState } from 'react';
import {
  formatCOP,
  formatDate,
  getBalances,
  getFinancialSummary,
  getSettings,
  getSoldObservations,
  getTopSellers,
  getUnsoldAging,
  KIND_LABEL,
  velocityBy,
  type VelocityStat,
} from '../../core';
import { PeriodPicker, ScopeSelect, usePeriod, useScope } from '../components/common';
import { Badge, Card, Empty, KV, Loading, Notice, Page, Paged, Segmented } from '../components/ui';
import { useRoute } from '../router';
import { useLive } from '../store';

type Tab = 'finanzas' | 'tiempos' | 'productos';

export function ReportsScreen() {
  const route = useRoute();
  const [tab, setTab] = useState<Tab>((route.query.get('tab') as Tab) ?? 'finanzas');
  const scope = useScope('reportScope');
  const period = usePeriod('reportPeriod');
  return (
    <Page title="Informes" back="/mas">
      <Segmented label="Informe" value={tab} onChange={setTab} options={[['finanzas', 'Finanzas'], ['tiempos', 'Tiempos'], ['productos', 'Productos']]} />
      <div className="stack-sm">
        <ScopeSelect {...scope} />
        <PeriodPicker p={period} />
      </div>
      {tab === 'finanzas' ? <Finance ids={scope.inventoryIds} period={period} /> : tab === 'tiempos' ? <Times ids={scope.inventoryIds} period={period} /> : <Products ids={scope.inventoryIds} period={period} />}
    </Page>
  );
}

function Finance({ ids, period }: { ids: string[] | null; period: ReturnType<typeof usePeriod> }) {
  const key = JSON.stringify([ids, period.range.current, period.range.previous]);
  const data = useLive(
    async (d) => ({
      cur: await getFinancialSummary(d, period.range.current, ids),
      prev: await getFinancialSummary(d, period.range.previous, ids),
      bal: await getBalances(d, ids),
    }),
    [key],
  );
  if (!data) return <Loading />;
  const { cur, prev, bal } = data;
  const vs = (a: number, b: number) =>
    b === a ? (
      formatCOP(a)
    ) : (
      <span>
        {formatCOP(a)}
        <span className="tiny muted" style={{ display: 'block', fontWeight: 400 }}>
          antes {formatCOP(b)}
        </span>
      </span>
    );
  return (
    <>
      {!cur.profitComplete ? (
        <Notice kind="warn" title="Ganancias incompletas">
          {cur.cogsUnknownUnits} unidad(es) vendidas no tienen costo conocido. Las ganancias mostradas están sobrestimadas hasta completar esos costos en la ficha de cada unidad.
        </Notice>
      ) : null}
      <Card title={`Resultado · ${period.range.label}`}>
        <KV
          rows={[
            ['Ventas brutas', formatCOP(cur.sales.gross)],
            ['− Descuentos', formatCOP(cur.sales.discounts)],
            ['− Devoluciones', formatCOP(cur.returns.amount)],
            ['= Ingresos netos', vs(cur.netRevenue, prev.netRevenue), true],
            ['− Costo de lo vendido', formatCOP(cur.cogs)],
            ['= Ganancia bruta', <span key="g">{formatCOP(cur.grossProfit)}{!cur.profitComplete ? <> <Badge kind="warn">⚠ incompleta</Badge></> : null}</span>, true],
            ['− Gastos operativos', formatCOP(cur.operatingExpenses)],
            ['− Bajas y pérdidas', formatCOP(cur.writeOffs)],
            ['= Ganancia neta', vs(cur.netProfit, prev.netProfit), true],
          ]}
        />
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Comparación: {period.range.previousLabel}. Fórmulas: ingresos netos = ventas − descuentos − devoluciones; ganancia bruta = ingresos netos − costo de lo vendido; ganancia neta = ganancia bruta − gastos operativos − bajas.
        </p>
      </Card>
      <Card title="Dinero">
        <KV
          rows={[
            ['Dinero cobrado (neto de reembolsos)', formatCOP(cur.collected), true],
            ['Reembolsos por devoluciones', formatCOP(cur.returns.refunds)],
            ['Invertido en compras', `${formatCOP(cur.purchases.total)} · ${cur.purchases.units} u.`],
            ['  de ello, gastos de compra', formatCOP(cur.purchases.extraCosts)],
            ['Costos sumados a unidades (capitalizados)', formatCOP(cur.capitalizedExpenses)],
            ['Stock existente ingresado (no es compra)', `${cur.initialStock.units} u. · ${formatCOP(cur.initialStock.value)}${cur.initialStock.unknownCostUnits ? ` (${cur.initialStock.unknownCostUnits} sin costo)` : ''}`],
          ]}
        />
        <p className="tiny muted" style={{ marginTop: 8 }}>Una venta pendiente de pago cuenta como ingreso pero no como dinero cobrado.</p>
      </Card>
      <Card title="Gastos operativos por categoría">
        {cur.expensesByCategory.length === 0 ? (
          <p className="small muted">Sin gastos en el periodo.</p>
        ) : (
          <KV rows={cur.expensesByCategory.map((e) => [e.category, formatCOP(e.amount)] as [string, string])} />
        )}
        {cur.generalExpensesExcluded ? <p className="tiny muted" style={{ marginTop: 8 }}>No incluye {formatCOP(cur.generalExpensesExcluded)} de gastos generales sin inventario asignado.</p> : null}
      </Card>
      <Card title="Saldos a hoy (no dependen del periodo)">
        <KV
          rows={[
            ['Por cobrar', `${formatCOP(bal.receivables)} · ${bal.receivableSales} venta(s)`],
            ...(bal.customerCredit ? ([['Saldo a favor de clientes', formatCOP(bal.customerCredit)]] as [string, string][]) : []),
            ['Existencias disponibles', `${bal.available} u.`],
            ['Valor del inventario a costo', formatCOP(bal.stockValue), true],
            ...(bal.unknownCostCount ? ([['Unidades sin costo conocido (no incluidas)', String(bal.unknownCostCount)]] as [string, string][]) : []),
            ['En revisión / dañadas', `${bal.inReview} / ${bal.damaged} · ${formatCOP(bal.otherValue)}`],
          ]}
        />
        <p className="tiny muted" style={{ marginTop: 8 }}>El inventario sin vender no es ganancia: solo se convierte en ganancia cuando se vende.</p>
      </Card>
    </>
  );
}

function VelocityList({ title, stats }: { title: string; stats: VelocityStat[] }) {
  return (
    <Card title={title}>
      {stats.length === 0 ? (
        <p className="small muted">Sin ventas en el periodo.</p>
      ) : (
        <ul className="list">
          {stats.map((s) => (
            <li key={s.key} style={{ padding: '8px 0' }}>
              <div className="row between">
                <span className="ellipsis">{s.label}</span>
                <span className="num strong">{s.avgDays === null ? '—' : `${s.avgDays} días`}</span>
              </div>
              <div className="tiny muted">
                {s.count} venta(s) con fecha{s.count ? ` · mín. ${s.minDays} · máx. ${s.maxDays}` : ''}
                {s.unknown ? ` · ${s.unknown} sin fecha (excluidas)` : ''}
                {s.count > 0 && s.count < 3 ? ' · pocos datos' : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Times({ ids, period }: { ids: string[] | null; period: ReturnType<typeof usePeriod> }) {
  const key = JSON.stringify([ids, period.range.current]);
  const data = useLive(
    async (d) => {
      const [obs, aging, settings, invs] = await Promise.all([getSoldObservations(d, period.range.current, ids), getUnsoldAging(d, ids), getSettings(d), d.inventories.toArray()]);
      const invName = new Map(invs.map((i) => [i.id, i.name]));
      return {
        byModel: velocityBy(obs, (o) => ({ key: o.groupKey, label: o.productName })),
        byKind: velocityBy(obs, (o) => ({ key: o.kind, label: KIND_LABEL[o.kind] })),
        byInv: velocityBy(obs, (o) => ({ key: o.inventoryId, label: invName.get(o.inventoryId) ?? '' })),
        fastest: obs.filter((o) => o.days !== null).sort((a, b) => a.days! - b.days!).slice(0, 10),
        aging,
        settings,
        invName,
      };
    },
    [key],
  );
  if (!data) return <Loading />;
  const known = data.aging.filter((a) => a.days !== null);
  const unknown = data.aging.filter((a) => a.days === null);
  const stale = known.filter((a) => (a.days ?? 0) >= data.settings.staleDays);
  return (
    <>
      <Card title="Sin vender: más antiguos primero" flush>
        <div style={{ padding: '0 14px 8px' }} className="small muted">
          {known.reduce((a, x) => a + x.qty, 0)} unidad(es) con fecha · {stale.reduce((a, x) => a + x.qty, 0)} con {data.settings.staleDays}+ días (estancadas)
          {unknown.length ? ` · ${unknown.reduce((a, x) => a + x.qty, 0)} con fecha desconocida (no se calculan días)` : ''}
        </div>
        <Paged
          items={data.aging}
          pageSize={20}
          empty={<Empty title="No hay existencias" />}
          render={(a) => (
            <li key={`${a.productId}-${a.unitId ?? a.since}-${a.qty}`}>
              <a className="item" href={a.unitId ? `#/unidades/${a.unitId}` : `#/productos/${a.productId}`}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {a.qty > 1 ? `${a.qty} × ` : ''}
                    {a.productName}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {a.code ? `${a.code} · ` : ''}
                    {data.invName.get(a.inventoryId)} · desde {formatDate(a.since)}
                  </span>
                </span>
                <span className="item-side">
                  {a.days === null ? <Badge kind="warn">Fecha desconocida</Badge> : <Badge kind={a.days >= data.settings.staleDays ? 'bad' : a.days >= data.settings.staleDays / 2 ? 'warn' : 'ok'}>{a.days} días</Badge>}
                </span>
              </a>
            </li>
          )}
        />
      </Card>
      <VelocityList title={`Días promedio hasta vender por modelo · ${period.range.label}`} stats={data.byModel} />
      <VelocityList title="Por categoría" stats={data.byKind} />
      <VelocityList title="Por inventario" stats={data.byInv} />
      <Card title="Vendidos más rápido">
        {data.fastest.length === 0 ? (
          <p className="small muted">Sin datos.</p>
        ) : (
          <ul className="list">
            {data.fastest.map((o, i) => (
              <li key={i} className="row between" style={{ padding: '8px 0' }}>
                <span className="ellipsis">
                  {o.productName}
                  {o.code ? ` · ${o.code}` : ''}
                </span>
                <span className="num">{o.days} días</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="tiny muted">Días = desde el ingreso (o desde la devolución, si volvió al inventario) hasta la venta. Para productos por cantidad se asume que sale primero lo más antiguo. Las unidades sin fecha conocida se excluyen.</p>
    </>
  );
}

function Products({ ids, period }: { ids: string[] | null; period: ReturnType<typeof usePeriod> }) {
  const key = JSON.stringify([ids, period.range.current]);
  const top = useLive((d) => getTopSellers(d, period.range.current, ids), [key]);
  if (!top) return <Loading />;
  return (
    <Card title={`Más vendidos · ${period.range.label}`} flush>
      <Paged
        items={top}
        empty={<Empty icon="chart" title="Sin ventas en el periodo" />}
        render={(t) => (
          <li key={t.key} style={{ padding: '12px 14px' }}>
            <div className="row between">
              <span className="strong ellipsis">{t.name}</span>
              <span className="money">{formatCOP(t.revenue)}</span>
            </div>
            <div className="small muted">
              {t.units} vendida(s) · {t.available} disponible(s) · ganancia bruta {formatCOP(t.revenue - t.cogs)}
              {t.unknownCost ? ' (incompleta)' : ''}
            </div>
            <div className="bar" style={{ marginTop: 6 }} role="img" aria-label={`Vendido ${Math.round(t.sellThrough * 100)}% de lo disponible`}>
              <span style={{ width: `${Math.round(t.sellThrough * 100)}%` }} />
            </div>
            <div className="tiny muted">{Math.round(t.sellThrough * 100)}% vendido (vendidas ÷ (vendidas + disponibles))</div>
          </li>
        )}
      />
    </Card>
  );
}
