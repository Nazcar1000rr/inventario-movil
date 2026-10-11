import { useState } from 'react';
import {
  addCapitalMovement,
  CAPITAL_KIND_HELP,
  CAPITAL_KIND_LABEL,
  computeCapitalSeries,
  computeCurrentCapital,
  deleteGoal,
  formatCOP,
  formatDate,
  getCapitalMetrics,
  getGoalsProgress,
  getOwnerLoanOutstanding,
  GOAL_METRIC_LABEL,
  listCapitalMovements,
  loadCapitalData,
  newOpId,
  nowISO,
  saveGoal,
  scopeFor,
  setGoalArchived,
  toDateInput,
  voidCapitalMovement,
  type CapitalKind,
  type Goal,
  type ID,
} from '../../core';
import { BarChart, LineChart, Progress } from '../components/Chart';
import { PeriodPicker, ScopeSelect, useInventories, usePeriod, useScope } from '../components/common';
import { InfoTip, L } from '../components/help';
import { Icon } from '../components/Icon';
import { ActionMenu, ask, Badge, Card, Chips, confirmAction, DateTimeInput, Empty, Field, FormError, KV, Loading, MoneyInput, Notice, Page, Segmented, Sheet, TextInput } from '../components/ui';
import { db, useAction, useLive } from '../store';
import { Kpi } from './Home';

const pct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} %`);

export function CapitalScreen() {
  const scope = useScope('capitalScope');
  const period = usePeriod('capitalPeriod');
  const ids = scope.inventoryIds;
  const key = JSON.stringify(ids);
  const data = useLive(
    async (d) => {
      const all = await loadCapitalData(d);
      const inScope = scopeFor(ids);
      return { snap: computeCurrentCapital(all, inScope), series: computeCapitalSeries(all, inScope, 12) };
    },
    [key],
  );
  const metrics = useLive((d) => getCapitalMetrics(d, period.range.current, ids), [key, JSON.stringify(period.range.current)]);
  const goals = useLive((d) => getGoalsProgress(d, ids), [key]);
  const moves = useLive((d) => listCapitalMovements(d, ids), [key]);
  const invs = useInventories();
  const [sheet, setSheet] = useState<null | { kind: CapitalKind } | 'count' | { goal: Goal | null }>(null);
  const [allMoves, setAllMoves] = useState(false);
  const act = useAction();
  const singleInv = ids && ids.length === 1 ? ids[0] : null;
  const invName = (id: ID | null) => (id ? invs?.find((i) => i.id === id)?.name ?? 'Inventario' : 'General');

  return (
    <Page title="Capital" help="capital" back="/mas">
      <ScopeSelect {...scope} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis" data-tour="cap-kpis">
            <Kpi testId="kpi-business-value" label="Valor del negocio" value={data.snap.businessValue} info="businessValue" />
            <Kpi
              testId="kpi-growth"
              label="Crecimiento"
              value={data.snap.growth}
              info="growth"
              tone={data.snap.growth > 0 ? 'good' : data.snap.growth < 0 ? 'bad' : undefined}
              foot={data.snap.growthPct === null ? 'Sin capital aportado' : `${pct(data.snap.growthPct)} sobre lo aportado`}
            />
            <Kpi label="Capital aportado" value={data.snap.netCapital} info="netCapital" foot={data.snap.goodsContributed ? `Incluye ${formatCOP(data.snap.goodsContributed)} en mercancía` : undefined} />
            <Kpi testId="kpi-cash" label="Caja calculada" value={data.snap.cash} info="cash" tone={data.snap.cash < 0 ? 'bad' : undefined} foot={data.snap.cash < 0 ? '⚠ Negativa: ¿falta registrar un aporte?' : undefined} />
          </div>
          <div className="actions" data-tour="cap-actions">
            <button className="btn primary" onClick={() => setSheet({ kind: 'contribution' })}>
              <Icon name="plus" /> Aporte
            </button>
            <button className="btn" onClick={() => setSheet({ kind: 'withdrawal' })}>
              <Icon name="wallet" /> Retiro
            </button>
            <button className="btn" onClick={() => setSheet({ kind: 'owner_loan' })}>
              <Icon name="return" /> Préstamo a ti
            </button>
            <button className="btn" onClick={() => setSheet('count')}>
              <Icon name="calc" /> Cuadrar caja
            </button>
            <a className="btn" href="#/personal">
              <Icon name="wallet" /> Gastos personales
            </a>
          </div>
          {data.snap.contributions === 0 && data.snap.goodsContributed === 0 ? (
            <Notice title="Registra el dinero con el que empezaste">
              Toca <strong>Aporte</strong> y escribe cuánto dinero tenías para el negocio. Sin eso, la caja calculada y el crecimiento no reflejan la realidad.
            </Notice>
          ) : null}

          <Card title={<h2>¿Dónde está tu dinero?</h2>}>
            <MoneyBreakdown snap={data.snap} buckets={metrics?.ageBuckets} />
          </Card>

          <Card title={<h2>Cómo ha crecido</h2>} action={<a className="small" href="#/resumen">Resumen mensual</a>}>
            {data.series.length === 0 ? (
              <Empty icon="trend" title="Aún no hay movimientos" />
            ) : (
              <div className="stack">
                <LineChart
                  title="Valor del negocio y capital aportado por mes"
                  labels={data.series.map((p) => p.label)}
                  series={[
                    { name: 'Valor del negocio', values: data.series.map((p) => p.value), color: 'var(--primary)' },
                    { name: 'Capital aportado', values: data.series.map((p) => p.netCapital), color: 'var(--text-2)', dashed: true },
                  ]}
                />
                <div>
                  <p className="small strong">
                    Crecimiento de cada mes <InfoTip k="growth" />
                  </p>
                  <BarChart title="Crecimiento de cada mes" labels={data.series.map((p) => p.label)} values={data.series.map((p) => p.monthGrowth)} />
                </div>
                <p className="tiny muted">El mes actual va hasta hoy. La distancia entre las dos líneas es lo que el negocio ha crecido por sí mismo.</p>
              </div>
            )}
          </Card>

          <Card title={<h2>Métricas del periodo</h2>}>
            <div className="stack">
              <PeriodPicker p={period} />
              {!metrics ? (
                <Loading />
              ) : (
                <KV
                  rows={[
                    [<L key="np" k="netProfit">Ganancia neta</L>, `${formatCOP(metrics.netProfit)}${metrics.profitComplete ? '' : ' (incompleta)'}`],
                    [<L key="pr" k="periodReturn">Rentabilidad</L>, <strong key="prv">{pct(metrics.periodReturn, 2)}</strong>],
                    [<L key="ro" k="rotation">Rotación del inventario</L>, metrics.rotation === null ? '—' : `${metrics.rotation.toLocaleString('es-CO', { maximumFractionDigits: 2 })} veces`],
                    [<L key="id" k="inventoryDays">Días para recuperar el inventario</L>, metrics.inventoryDays === null ? '—' : `${metrics.inventoryDays} días`],
                    [<L key="dm" k="dormant">Dinero dormido</L>, metrics.dormant.units ? `${formatCOP(metrics.dormant.value)} (${metrics.dormant.units} unidad(es))` : 'Nada'],
                  ]}
                />
              )}
            </div>
          </Card>

          <Card title={<h2>Metas</h2>} action={<button className="btn sm" onClick={() => setSheet({ goal: null })}><Icon name="plus" size={18} /> Nueva meta</button>}>
            {!goals?.length ? (
              <p className="small muted">Ponte una meta, por ejemplo "Que el negocio valga 20 millones en diciembre".</p>
            ) : (
              <ul className="list">
                {goals.map((g) => (
                  <li key={g.goal.id} style={{ padding: '10px 0' }} data-testid="goal">
                    <div className="row between">
                      <span className="strong">
                        {g.goal.name} {g.goal.status === 'archived' ? <Badge>Archivada</Badge> : g.reached ? <Badge kind="ok">¡Lograda!</Badge> : g.overdue ? <Badge kind="warn">Vencida</Badge> : null}
                      </span>
                      <ActionMenu
                        title={g.goal.name}
                        actions={[
                          { label: 'Editar', icon: 'edit', onSelect: () => setSheet({ goal: g.goal }) },
                          { label: g.goal.status === 'archived' ? 'Reactivar' : 'Archivar', icon: 'archive', onSelect: () => void act.run(() => setGoalArchived(db, g.goal.id, g.goal.status !== 'archived')) },
                          {
                            label: 'Eliminar',
                            icon: 'trash',
                            danger: true,
                            onSelect: async () => {
                              if (await confirmAction({ title: 'Eliminar meta', message: <p>Se elimina "{g.goal.name}".</p>, danger: true, confirmText: 'Eliminar' }))
                                await act.run(() => deleteGoal(db, g.goal.id), 'Meta eliminada');
                            },
                          },
                        ]}
                      />
                    </div>
                    <Progress value={g.progress} label={`Avance de ${g.goal.name}`} />
                    <p className="small muted" style={{ marginTop: 4 }}>
                      {GOAL_METRIC_LABEL[g.goal.metric]}: {formatCOP(g.current)} de {formatCOP(g.goal.target)} ({Math.round(g.progress * 100)} %) · {invName(g.goal.inventoryId)}
                      {g.reached ? '' : ` · faltan ${formatCOP(g.remaining)}`}
                      {g.goal.dueDate ? ` · hasta ${formatDate(g.goal.dueDate)}` : ''}
                      {g.perMonthNeeded && !g.reached && !g.overdue ? ` · necesitas crecer ${formatCOP(g.perMonthNeeded)} por mes` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={<h2>Aportes, retiros y préstamos a ti</h2>} flush>
            {!moves?.length ? (
              <Empty icon="wallet" title="Sin movimientos de capital" />
            ) : (
              <>
                <ul className="list wrap-sub">
                  {(allMoves ? moves : moves.slice(0, 8)).map((m) => {
                    const sign = m.kind === 'contribution' || m.kind === 'owner_loan_repayment' ? 1 : m.kind === 'cash_adjustment' ? Math.sign(m.amount) : -1;
                    return (
                      <li key={m.id} className="item" style={{ cursor: 'default' }} data-testid="capital-move">
                        <span className="item-main">
                          <span className="item-title" style={{ display: 'block' }}>
                            {m.label} {m.personal ? <Badge kind="warn">Personal{m.tag ? ` · ${m.tag}` : ''}</Badge> : null} {m.status === 'voided' ? <Badge>Anulado</Badge> : null}
                          </span>
                          <span className="item-sub" style={{ display: 'block' }}>
                            {formatDate(m.date)} · {invName(m.inventoryId)}
                            {m.notes ? ` · ${m.notes.split('\n')[0]}` : ''}
                          </span>
                        </span>
                        <span className={`item-side money ${m.status === 'voided' ? 'muted' : sign > 0 ? 'delta-up' : 'delta-down'}`} style={m.status === 'voided' ? { textDecoration: 'line-through' } : undefined}>
                          {sign > 0 ? '+' : '−'}
                          {formatCOP(Math.abs(m.amount))}
                        </span>
                        {m.status === 'active' ? (
                          <ActionMenu
                            title={m.label}
                            actions={[
                              {
                                label: 'Anular (registrado por error)',
                                icon: 'ban',
                                danger: true,
                                onSelect: async () => {
                                  const r = await ask({ title: 'Anular movimiento', danger: true, input: { label: 'Motivo', required: true }, confirmText: 'Anular' });
                                  if (r.ok) await act.run(() => voidCapitalMovement(db, m.id, r.value), 'Movimiento anulado');
                                },
                              },
                            ]}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {moves.length > 8 && !allMoves ? (
                  <div style={{ padding: 12 }}>
                    <button className="btn block" onClick={() => setAllMoves(true)}>
                      Ver todos ({moves.length})
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          <FormError error={act.error} />
          <div className="actions">
            <a className="btn" href="#/deudas">
              <Icon name="card" /> Deudas y préstamos
            </a>
            <a className="btn" href="#/resumen">
              <Icon name="image" /> Resumen mensual
            </a>
          </div>
        </>
      )}
      {sheet && typeof sheet === 'object' && 'kind' in sheet ? (
        <CapitalMovementSheet initialKind={sheet.kind} defaultInventoryId={singleInv} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'count' && data ? <CashCountSheet calculated={data.snap.cash} inventoryId={singleInv} onClose={() => setSheet(null)} /> : null}
      {sheet && typeof sheet === 'object' && 'goal' in sheet ? <GoalSheet goal={sheet.goal} defaultInventoryId={singleInv} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function MoneyBreakdown({ snap, buckets }: { snap: ReturnType<typeof computeCurrentCapital>; buckets?: { key: string; label: string; value: number; units: number }[] }) {
  const pos = [
    { label: 'Caja', value: snap.cash, k: 'cash' },
    { label: 'Inventario a costo', value: snap.inventory, k: 'inventoryCapital' },
    { label: 'Por cobrar', value: snap.receivables, k: 'receivables' },
    { label: 'Prestado a ti', value: snap.ownerLoans, k: 'ownerLoans' },
  ];
  const neg = [
    { label: 'Deudas', value: snap.debts, k: 'debts' },
    { label: 'Saldos a favor de clientes', value: snap.customerCredit, k: '' },
  ].filter((x) => x.value);
  const max = Math.max(1, ...pos.map((p) => Math.max(0, p.value)), ...neg.map((n) => n.value));
  return (
    <div className="stack-sm" data-testid="money-breakdown">
      {pos.map((p) => (
        <div key={p.label}>
          <div className="row between small">
            <span>{p.k ? <L k={p.k}>{p.label}</L> : p.label}</span>
            <span className={`money ${p.value < 0 ? 'delta-down' : ''}`}>{formatCOP(p.value)}</span>
          </div>
          <Progress value={Math.max(0, p.value) / max} label={p.label} />
          {p.k === 'inventoryCapital' && buckets && snap.inventory > 0 ? (
            <p className="tiny muted" style={{ marginTop: 2 }}>
              {buckets
                .filter((b) => b.value > 0)
                .map((b) => `${b.label}: ${formatCOP(b.value)}`)
                .join(' · ')}
              {snap.inventoryUnknownUnits ? ` · ${snap.inventoryUnknownUnits} sin costo conocido` : ''}
            </p>
          ) : null}
        </div>
      ))}
      {neg.map((n) => (
        <div key={n.label}>
          <div className="row between small">
            <span>{n.k ? <L k={n.k}>{`Menos: ${n.label}`}</L> : `Menos: ${n.label}`}</span>
            <span className="money delta-down">−{formatCOP(n.value)}</span>
          </div>
          <div className="bar neg">
            <span style={{ width: `${(n.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="row between strong" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <span>Valor del negocio</span>
        <span className="money">{formatCOP(snap.businessValue)}</span>
      </div>
    </div>
  );
}

function InventoryOrGeneral({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const invs = useInventories();
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">General (todo el negocio)</option>
      {(invs ?? [])
        .filter((i) => !i.archived || i.id === value)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
    </select>
  );
}

export function CapitalMovementSheet({ initialKind, defaultInventoryId, onClose }: { initialKind: CapitalKind; defaultInventoryId: ID | null; onClose: () => void }) {
  const [kind, setKind] = useState<CapitalKind>(initialKind);
  const [amount, setAmount] = useState<number | null>(null);
  const [sign, setSign] = useState<'plus' | 'minus'>('minus');
  const [date, setDate] = useState<string | null>(nowISO());
  const [inv, setInv] = useState(defaultInventoryId ?? '');
  const [notes, setNotes] = useState('');
  const [opId] = useState(newOpId);
  const outstanding = useLive((d) => getOwnerLoanOutstanding(d, inv || null), [inv]);
  const act = useAction();
  const kinds: [CapitalKind, string][] = [
    ['contribution', 'Aporte'],
    ['withdrawal', 'Retiro'],
    ['owner_loan', 'Préstamo a ti'],
    ['owner_loan_repayment', 'Devuelvo préstamo'],
    ['cash_adjustment', 'Ajuste de caja'],
  ];
  return (
    <Sheet
      title={CAPITAL_KIND_LABEL[kind]}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-capital"
          onClick={async () => {
            const value = kind === 'cash_adjustment' && sign === 'minus' ? -(amount ?? 0) : amount ?? 0;
            const r = await act.run(() => addCapitalMovement(db, { opId, kind, date: date ?? '', amount: value, inventoryId: inv || null, notes }), 'Movimiento registrado');
            if (r) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="stack">
        <Chips label="Tipo de movimiento" value={kind} onChange={setKind} options={kinds} />
        <p className="small muted">{CAPITAL_KIND_HELP[kind]}</p>
        {kind === 'owner_loan_repayment' ? <Notice>{outstanding ? `Le debes al negocio ${formatCOP(outstanding)} en ${inv ? 'este inventario' : 'lo general'}.` : 'No tienes préstamos pendientes aquí.'}</Notice> : null}
        {kind === 'cash_adjustment' ? <Segmented label="Tipo de ajuste" value={sign} onChange={setSign} options={[['minus', 'Falta dinero'], ['plus', 'Sobra dinero']]} /> : null}
        <Field label="Valor" htmlFor="cm-amount" error={act.field === 'amount' ? act.error : null}>
          <MoneyInput id="cm-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
        </Field>
        <Field label="¿De qué inventario?" htmlFor="cm-inv" hint="General = el negocio completo. Si llevas inventarios separados (por ejemplo, el tuyo y el de tu primo), elige uno.">
          <InventoryOrGeneral id="cm-inv" value={inv} onChange={setInv} />
        </Field>
        <Field label="Fecha" htmlFor="cm-date">
          <DateTimeInput id="cm-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Nota (opcional)" htmlFor="cm-notes">
          <TextInput id="cm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'owner_loan' ? 'Ej.: emergencia médica' : ''} />
        </Field>
        <FormError error={act.field === 'amount' ? null : act.error} />
      </div>
    </Sheet>
  );
}

function CashCountSheet({ calculated, inventoryId, onClose }: { calculated: number; inventoryId: ID | null; onClose: () => void }) {
  const [real, setReal] = useState<number | null>(null);
  const [opId] = useState(newOpId);
  const act = useAction();
  const diff = real === null ? null : real - calculated;
  return (
    <Sheet title="Cuadrar caja" onClose={onClose}>
      <div className="stack">
        <p className="small">Cuenta el dinero del negocio (efectivo + cuentas) y escríbelo. La app registra la diferencia como ajuste de caja.</p>
        <KV rows={[['Caja calculada', formatCOP(calculated)]]} />
        <Field label="Dinero real contado" htmlFor="cc-real">
          <MoneyInput id="cc-real" value={real} onChange={setReal} />
        </Field>
        {diff !== null ? (
          diff === 0 ? (
            <Notice kind="ok">¡Cuadra perfecto! No hace falta ajuste.</Notice>
          ) : (
            <Notice kind={diff < 0 ? 'warn' : 'info'}>
              {diff < 0 ? `Faltan ${formatCOP(-diff)}.` : `Sobran ${formatCOP(diff)}.`} Antes de ajustar, revisa si olvidaste registrar algún gasto, retiro o venta.
            </Notice>
          )
        ) : null}
        <FormError error={act.error} />
        <button
          className="btn primary block"
          disabled={act.busy || diff === null || diff === 0}
          onClick={async () => {
            const r = await act.run(
              () => addCapitalMovement(db, { opId, kind: 'cash_adjustment', date: nowISO(), amount: diff ?? 0, inventoryId, notes: `Conteo de caja: real ${formatCOP(real)} vs. calculada ${formatCOP(calculated)}` }),
              'Caja ajustada',
            );
            if (r) onClose();
          }}
        >
          Registrar ajuste
        </button>
      </div>
    </Sheet>
  );
}

function GoalSheet({ goal, defaultInventoryId, onClose }: { goal: Goal | null; defaultInventoryId: ID | null; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [metric, setMetric] = useState<Goal['metric']>(goal?.metric ?? 'business_value');
  const [target, setTarget] = useState<number | null>(goal?.target ?? null);
  const [due, setDue] = useState(goal?.dueDate ? toDateInput(goal.dueDate) : '');
  const [inv, setInv] = useState(goal ? goal.inventoryId ?? '' : defaultInventoryId ?? '');
  const act = useAction();
  return (
    <Sheet
      title={goal ? 'Editar meta' : 'Nueva meta'}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(
              () => saveGoal(db, { id: goal?.id, name, metric, target: target ?? 0, dueDate: due ? new Date(`${due}T23:59:00`).toISOString() : null, inventoryId: inv || null }),
              'Meta guardada',
            );
            if (r) onClose();
          }}
        >
          Guardar meta
        </button>
      }
    >
      <div className="stack">
        <Field label="Nombre" htmlFor="gl-name" error={act.field === 'name' ? act.error : null}>
          <TextInput id="gl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: 20 millones para diciembre" />
        </Field>
        <Field label="¿Qué quieres medir?">
          <Segmented label="Métrica" value={metric} onChange={setMetric} options={[['business_value', 'Valor del negocio'], ['growth', 'Crecimiento']]} />
        </Field>
        <Field label="Meta" htmlFor="gl-target" error={act.field === 'target' ? act.error : null}>
          <MoneyInput id="gl-target" value={target} onChange={setTarget} />
        </Field>
        <Field label="Fecha límite (opcional)" htmlFor="gl-due">
          <input id="gl-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Inventario" htmlFor="gl-inv">
          <InventoryOrGeneral id="gl-inv" value={inv} onChange={setInv} />
        </Field>
        <FormError error={act.field === 'name' || act.field === 'target' ? null : act.error} />
      </div>
    </Sheet>
  );
}

