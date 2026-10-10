import { useState } from 'react';
import { daysText, errorMessage, formatCOP, getMonthlySummary, monthLabel } from '../../core';
import { ScopeSelect, useScope } from '../components/common';
import { L } from '../components/help';
import { Icon } from '../components/Icon';
import { Card, Empty, KV, Loading, Notice, Page } from '../components/ui';
import { shareBinary } from '../platform';
import { toast, useLive } from '../store';
import { buildImagePdf, canvasToBytes, renderSummaryCanvas } from '../summary-render';

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function monthOptions(n = 13): { key: string; date: Date; label: string }[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, date: d, label: `${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}` };
  });
}

export function SummaryScreen() {
  const scope = useScope('summaryScope');
  const months = monthOptions();
  const [mk, setMk] = useState(months[months.length > 1 ? 1 : 0].key);
  const month = months.find((m) => m.key === mk) ?? months[0];
  const s = useLive((d) => getMonthlySummary(d, month.date, scope.inventoryIds), [mk, JSON.stringify(scope.inventoryIds)]);
  const [busy, setBusy] = useState(false);
  const title = `Resumen de ${month.label}`;
  const share = async (kind: 'png' | 'pdf') => {
    if (!s || busy) return;
    setBusy(true);
    try {
      const canvas = renderSummaryCanvas(s, { scopeLabel: scope.label, monthTitle: title });
      const base = `resumen-${s.key}`;
      const out =
        kind === 'png'
          ? await shareBinary(`${base}.png`, await canvasToBytes(canvas, 'image/png'), 'image/png', 'Compartir resumen')
          : await shareBinary(`${base}.pdf`, buildImagePdf(await canvasToBytes(canvas, 'image/jpeg', 0.9), canvas.width, canvas.height), 'application/pdf', 'Compartir resumen');
      if (out === 'downloaded') toast('Archivo descargado');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Resumen mensual" help="summary" back="/informes">
      <div className="stack-sm">
        <select className="select" aria-label="Mes" value={mk} onChange={(e) => setMk(e.target.value)}>
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label[0].toUpperCase() + m.label.slice(1)}
              {m === months[0] ? ' (en curso)' : ''}
            </option>
          ))}
        </select>
        <ScopeSelect {...scope} />
      </div>
      {!s ? (
        <Loading />
      ) : (
        <>
          <Card title={<h2>{title[0].toUpperCase() + title.slice(1)}</h2>}>
            {s.partial ? <Notice>El mes aún no termina: los números van hasta hoy.</Notice> : null}
            <KV
              rows={[
                [<L key="a" k="netRevenue">Ventas netas</L>, formatCOP(s.fin.netRevenue)],
                ['Unidades vendidas', String(s.fin.sales.units)],
                [<L key="b" k="grossProfit">Ganancia bruta</L>, formatCOP(s.fin.grossProfit)],
                [<L key="c" k="operatingExpenses">Gastos operativos</L>, formatCOP(s.fin.operatingExpenses)],
                [<L key="d" k="netProfit">Ganancia neta</L>, <strong key="dv">{formatCOP(s.fin.netProfit)}{s.fin.profitComplete ? '' : ' (incompleta)'}</strong>, true],
                ['Compras', formatCOP(s.fin.purchases.total)],
                [<L key="e" k="businessValue">Valor del negocio al cierre</L>, formatCOP(s.end.businessValue)],
                [<L key="f" k="growth">Crecimiento del mes</L>, <span key="fv" className={s.growthInMonth >= 0 ? 'delta-up' : 'delta-down'}>{formatCOP(s.growthInMonth)}</span>],
                ['Días promedio para vender', s.avgDaysToSell === null ? '—' : String(s.avgDaysToSell).replace('.', ',')],
                ...(s.debtsOpen.count ? ([['Deudas pendientes al cierre', formatCOP(s.debtsOpen.amount)]] as [string, string][]) : []),
              ]}
            />
          </Card>
          {s.topSellers.length ? (
            <Card title="Lo más vendido">
              <KV rows={s.topSellers.map((t) => [`${t.name} (${t.units})`, formatCOP(t.revenue)] as [string, string])} />
            </Card>
          ) : (
            <Empty icon="chart" title={`Sin ventas en ${monthLabel(month.date)}`} />
          )}
          {s.bestProfitPerDay.length ? (
            <Card title={<h2><L k="profitPerDay">Lo más rentable por día</L></h2>}>
              <KV rows={s.bestProfitPerDay.map((m) => [`${m.label} · ${daysText(m.avgDays)}`, `${formatCOP(m.profitPerDay)}/día`] as [string, string])} />
            </Card>
          ) : null}
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={() => void share('png')} data-testid="share-png">
              <Icon name="image" /> Compartir imagen
            </button>
            <button className="btn" disabled={busy} onClick={() => void share('pdf')} data-testid="share-pdf">
              <Icon name="file" /> Compartir PDF
            </button>
          </div>
          <p className="tiny muted">La imagen y el PDF se crean en tu teléfono. Tú eliges con quién compartirlos.</p>
        </>
      )}
    </Page>
  );
}
