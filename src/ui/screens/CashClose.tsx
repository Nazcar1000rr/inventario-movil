import { useState } from 'react';
import { formatCOP, formatDate, getCashClose, listCashCloses, saveCashClose } from '../../core';
import { ScopeSelect, useScope } from '../components/common';
import { Badge, Card, Empty, Field, FormError, InfoMore, KV, Loading, MoneyInput, Notice, Page, Segmented } from '../components/ui';
import { db, toast, useAction, useLive } from '../store';

const dayOf = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};

/** CIERRE DE CAJA DIARIO (v2.4): lo que entró, lo que salió y cuánto debería haber en efectivo contra lo que contaste. */
export function CashCloseScreen() {
  const [which, setWhich] = useState<'today' | 'yesterday'>('today');
  const day = dayOf(which === 'today' ? 0 : -1);
  const scope = useScope('cashCloseScope');
  const key = JSON.stringify(scope.inventoryIds);
  const c = useLive((d) => (scope.ready ? getCashClose(d, day, scope.inventoryIds) : undefined), [which, key, scope.ready]);
  const history = useLive((d) => listCashCloses(d, 10));
  const [counted, setCounted] = useState<number | null>(null);
  const [saveRefresh, setSaveRefresh] = useState(0);
  const act = useAction();
  const close = async () => {
    if (counted === null) return;
    const r = await act.run(() => saveCashClose(db, day, counted), 'Cierre guardado');
    if (r) {
      setCounted(null);
      setSaveRefresh((n) => n + 1);
      toast(r.difference === 0 ? 'La caja cuadra' : r.difference > 0 ? `Sobran ${formatCOP(r.difference)}` : `Faltan ${formatCOP(-r.difference)}`, r.difference === 0 ? 'ok' : 'error');
    }
  };
  void saveRefresh;
  const diff = c && counted !== null ? counted - c.expectedCash : null;
  return (
    <Page title="Cierre de caja" back="/mas" help="cash-close">
      <div className="stack-sm">
        <Segmented label="Día" value={which} onChange={setWhich} options={[['today', 'Hoy'], ['yesterday', 'Ayer']]} />
        <ScopeSelect {...scope} />
      </div>
      {!c ? (
        <Loading />
      ) : (
        <>
          <Card title="Lo que pasó">
            <KV
              rows={[
                ['Ventas', `${c.salesCount} · ${formatCOP(c.salesTotal)}`],
                ['Quedó por cobrar', formatCOP(c.onCredit)],
                ['Plata que entró', <strong key="in" data-testid="cash-in">{formatCOP(c.collected)}</strong>, true],
              ]}
            />
            {c.collectedByMethod.length ? (
              <ul className="list" data-testid="cash-methods">
                {c.collectedByMethod.map((m) => (
                  <li key={m.method} className="list-item">
                    <span className="grow">{m.method} <span className="muted small">({m.count})</span></span>
                    <strong>{formatCOP(m.amount)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No entró plata este día.</p>
            )}
            <KV rows={[['Devoluciones de plata', `−${formatCOP(c.refunds)}`], ['Gastos', `−${formatCOP(c.expenses)}`], ['Compras pagadas de la caja', `−${formatCOP(c.purchasesCash)}`]]} />
          </Card>
          <Card title="Efectivo en caja" tour="cash-count">
            <div className="stack">
              <KV rows={[['Debería haber', <strong key="e" data-testid="cash-expected">{formatCOP(c.expectedCash)}</strong>, true]]} />
              <InfoMore label="¿Cómo se calcula?">Cobros en efectivo, menos devoluciones en efectivo, gastos y compras pagadas con plata de la caja. Lo que entró por Nequi, transferencia o datáfono no cuenta aquí.</InfoMore>
              <Field label="Efectivo que contaste" htmlFor="cc-counted">
                <MoneyInput id="cc-counted" value={counted} onChange={setCounted} />
              </Field>
              {diff !== null ? (
                <Notice kind={diff === 0 ? 'ok' : 'warn'} title={diff === 0 ? 'La caja cuadra' : diff > 0 ? `Sobran ${formatCOP(diff)}` : `Faltan ${formatCOP(-diff)}`} />
              ) : null}
              <FormError error={act.error} />
              <button className="btn primary block" disabled={act.busy || counted === null} onClick={() => void close()} data-testid="save-cash-close">
                {c.saved ? 'Guardar de nuevo el cierre' : 'Cerrar el día'}
              </button>
              {c.saved ? (
                <Notice kind="ok" title="Ya cerraste este día">
                  Contaste {formatCOP(c.saved.counted)} · {c.saved.difference === 0 ? 'cuadró' : c.saved.difference > 0 ? `sobraron ${formatCOP(c.saved.difference)}` : `faltaron ${formatCOP(-c.saved.difference)}`}
                </Notice>
              ) : null}
            </div>
          </Card>
        </>
      )}
      <Card title="Cierres anteriores">
        {!history || history.length === 0 ? (
          <Empty title="Aún no has cerrado ningún día" />
        ) : (
          <ul className="list" data-testid="cash-history">
            {history.map((h) => (
              <li key={h.day} className="list-item">
                <span className="grow">{formatDate(new Date(`${h.day}T12:00:00`).toISOString())}</span>
                <span>{formatCOP(h.counted)}</span>
                <Badge kind={h.difference === 0 ? 'ok' : 'warn'}>{h.difference === 0 ? 'Cuadró' : h.difference > 0 ? `+${formatCOP(h.difference)}` : `−${formatCOP(-h.difference)}`}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
