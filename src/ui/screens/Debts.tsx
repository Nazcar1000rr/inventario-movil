import { useState } from 'react';
import {
  computeDebtBalance,
  createDebt,
  DEBT_KIND_LABEL,
  DEBT_STATUS_LABEL,
  formatCOP,
  formatDate,
  getOwnerLoanOutstanding,
  listDebts,
  newOpId,
  nowISO,
  payDebt,
  updateDebtInfo,
  voidDebt,
  voidDebtPayment,
  type DebtKind,
  type ID,
} from '../../core';
import { Progress } from '../components/Chart';
import { ScopeSelect, useInventories, useScope } from '../components/common';
import { L } from '../components/help';
import { Icon } from '../components/Icon';
import { ActionMenu, ask, Badge, Card, Chips, confirmAction, DateTimeInput, Empty, Field, FormError, KV, ListItem, Loading, MoneyInput, Notice, Page, Sheet, TextInput } from '../components/ui';
import { db, useAction, useLive } from '../store';
import { CapitalMovementSheet } from './Capital';
import { Kpi } from './Home';

export function DebtsScreen() {
  const scope = useScope('debtScope');
  const ids = scope.inventoryIds;
  const debts = useLive((d) => listDebts(d, ids), [JSON.stringify(ids)]);
  const loans = useLive(
    async (d) => {
      if (ids && ids.length === 1) return getOwnerLoanOutstanding(d, ids[0]);
      if (ids) {
        let t = 0;
        for (const id of ids) t += await getOwnerLoanOutstanding(d, id);
        return t;
      }
      const caps = await d.capital.toArray();
      return caps.filter((c) => c.status === 'active').reduce((a, c) => a + (c.kind === 'owner_loan' ? c.amount : c.kind === 'owner_loan_repayment' ? -c.amount : 0), 0);
    },
    [JSON.stringify(ids)],
  );
  const [sheet, setSheet] = useState<null | 'new' | 'loan' | 'repay'>(null);
  const [showClosed, setShowClosed] = useState(false);
  const open = debts?.filter((d) => d.status === 'open') ?? [];
  const closed = debts?.filter((d) => d.status !== 'open') ?? [];
  const owed = open.reduce((a, d) => a + d.balance.outstanding, 0);
  const interest = (debts ?? []).reduce((a, d) => a + d.balance.paidInterest, 0);
  const singleInv = ids && ids.length === 1 ? ids[0] : null;
  return (
    <Page title="Deudas y préstamos" help="debts" back="/capital">
      <ScopeSelect {...scope} />
      {!debts ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <Kpi testId="kpi-owed" label="Lo que debes" value={owed} info="debts" foot={`${open.length} deuda(s) pendiente(s)`} tone={owed ? 'bad' : undefined} />
            <Kpi label="Intereses pagados" value={interest} foot="Gasto financiero acumulado" />
            <Kpi label="Prestado a ti" value={loans ?? 0} info="ownerLoans" foot="Lo que le debes al negocio" />
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => setSheet('new')}>
              <Icon name="plus" /> Nueva deuda
            </button>
            <button className="btn" onClick={() => setSheet('loan')}>
              <Icon name="return" /> Tomar prestado
            </button>
            <button className="btn" disabled={!loans} onClick={() => setSheet('repay')}>
              <Icon name="undo" /> Devolver al negocio
            </button>
          </div>
          <p className="tiny muted">Las compras pagadas con tarjeta de crédito o a crédito del proveedor crean su deuda desde la compra.</p>
          <Card title="Pendientes" flush>
            {open.length === 0 ? (
              <Empty icon="check" title="No debes nada" />
            ) : (
              <ul className="list wrap-sub">
                {open.map((d) => (
                  <li key={d.id}>
                    <a className="item" href={`#/deudas/${d.id}`} data-testid="debt-item">
                      <span className="item-main">
                        <span className="item-title" style={{ display: 'block' }}>
                          {d.creditor}
                        </span>
                        <span className="item-sub" style={{ display: 'block' }}>
                          {DEBT_KIND_LABEL[d.kind]} · {formatDate(d.date)} · pagado {formatCOP(d.balance.paidPrincipal)} de {formatCOP(d.principal)}
                        </span>
                        <span style={{ display: 'block', marginTop: 6 }}>
                          <Progress value={d.balance.paidPrincipal / d.principal} label={`Pagado de ${d.creditor}`} />
                        </span>
                      </span>
                      <span className="item-side money strong">{formatCOP(d.balance.outstanding)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {closed.length ? (
            <>
              <button className="btn block" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? 'Ocultar' : 'Ver'} pagadas y anuladas ({closed.length})
              </button>
              {showClosed ? (
                <Card flush>
                  <ul className="list">
                    {closed.map((d) => (
                      <ListItem
                        key={d.id}
                        href={`/deudas/${d.id}`}
                        title={d.creditor}
                        sub={`${DEBT_KIND_LABEL[d.kind]} · ${formatCOP(d.principal)} · ${formatDate(d.date)}`}
                        side={<Badge kind={d.status === 'paid' ? 'ok' : undefined}>{DEBT_STATUS_LABEL[d.status]}</Badge>}
                      />
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {sheet === 'new' ? <NewDebtSheet defaultInventoryId={singleInv} onClose={() => setSheet(null)} /> : null}
      {sheet === 'loan' ? <CapitalMovementSheet initialKind="owner_loan" defaultInventoryId={singleInv} onClose={() => setSheet(null)} /> : null}
      {sheet === 'repay' ? <CapitalMovementSheet initialKind="owner_loan_repayment" defaultInventoryId={singleInv} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function NewDebtSheet({ defaultInventoryId, onClose }: { defaultInventoryId: ID | null; onClose: () => void }) {
  const [kind, setKind] = useState<DebtKind>('loan');
  const [creditor, setCreditor] = useState('');
  const [description, setDescription] = useState('');
  const [principal, setPrincipal] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(nowISO());
  const [inv, setInv] = useState(defaultInventoryId ?? '');
  const [opId] = useState(newOpId);
  const invs = useInventories();
  const act = useAction();
  return (
    <Sheet
      title="Nueva deuda"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-debt"
          onClick={async () => {
            const r = await act.run(() => createDebt(db, { opId, kind, creditor, description, principal: principal ?? 0, date: date ?? '', inventoryId: inv || null }), 'Deuda registrada');
            if (r) onClose();
          }}
        >
          Guardar deuda
        </button>
      }
    >
      <div className="stack">
        <Notice>Úsalo cuando te presten dinero que ENTRA a la caja (un familiar, un banco, un avance de la tarjeta). Si la tarjeta o el proveedor pagaron una compra, regístralo desde la compra.</Notice>
        <Chips
          label="Tipo de deuda"
          value={kind}
          onChange={setKind}
          options={(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map((k) => [k, DEBT_KIND_LABEL[k]])}
        />
        <Field label="¿A quién le debes?" htmlFor="db-cred" error={act.field === 'creditor' ? act.error : null}>
          <TextInput id="db-cred" value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder={kind === 'credit_card' ? 'Ej.: Visa Bancolombia' : 'Ej.: Primo Andrés'} invalid={act.field === 'creditor'} />
        </Field>
        <Field label="Valor prestado" htmlFor="db-amount" error={act.field === 'principal' ? act.error : null}>
          <MoneyInput id="db-amount" value={principal} onChange={setPrincipal} invalid={act.field === 'principal'} />
        </Field>
        <Field label="Detalle (opcional)" htmlFor="db-desc">
          <TextInput id="db-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: a 3 meses, sin intereses" />
        </Field>
        <Field label="Fecha" htmlFor="db-date">
          <DateTimeInput id="db-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Inventario" htmlFor="db-inv">
          <select id="db-inv" className="select" value={inv} onChange={(e) => setInv(e.target.value)}>
            <option value="">General (todo el negocio)</option>
            {(invs ?? [])
              .filter((i) => !i.archived)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </Field>
        <FormError error={act.field === 'creditor' || act.field === 'principal' ? null : act.error} />
      </div>
    </Sheet>
  );
}

export function DebtDetailScreen({ id }: { id: ID }) {
  const data = useLive(
    async (d) => {
      const debt = await d.debts.get(id);
      if (!debt) return null;
      const [payments, purchase, inv] = await Promise.all([
        d.debtPayments.where('debtId').equals(id).toArray(),
        debt.purchaseId ? d.purchases.get(debt.purchaseId) : Promise.resolve(undefined),
        debt.inventoryId ? d.inventories.get(debt.inventoryId) : Promise.resolve(undefined),
      ]);
      return { debt, payments: payments.sort((a, b) => b.date.localeCompare(a.date)), purchase, inv, balance: computeDebtBalance(debt, payments) };
    },
    [id],
  );
  const [paying, setPaying] = useState(false);
  const act = useAction();
  if (data === undefined) return <Page title="Deuda" back="/deudas"><Loading /></Page>;
  if (data === null) return <Page title="Deuda" back="/deudas"><Empty title="La deuda no existe" /></Page>;
  const { debt, payments, purchase, inv, balance } = data;
  return (
    <Page
      title={debt.creditor}
      subtitle={DEBT_KIND_LABEL[debt.kind]}
      help="debt"
      back="/deudas"
      actions={
        <ActionMenu
          title={debt.creditor}
          actions={[
            {
              label: 'Editar acreedor y detalle',
              icon: 'edit',
              onSelect: async () => {
                const r = await ask({ title: 'Acreedor', input: { label: '¿A quién le debes?', initial: debt.creditor, required: true }, confirmText: 'Guardar' });
                if (r.ok) await act.run(() => updateDebtInfo(db, id, { creditor: r.value }), 'Deuda actualizada');
              },
            },
            {
              label: 'Anular deuda (registrada por error)',
              icon: 'ban',
              danger: true,
              hidden: debt.status === 'voided' || !!debt.purchaseId,
              onSelect: async () => {
                const r = await ask({ title: 'Anular deuda', danger: true, input: { label: 'Motivo', required: true }, confirmText: 'Anular' });
                if (r.ok) await act.run(() => voidDebt(db, id, r.value), 'Deuda anulada');
              },
            },
          ]}
        />
      }
    >
      <div className="row wrap">
        <Badge kind={debt.status === 'open' ? 'warn' : debt.status === 'paid' ? 'ok' : undefined}>{DEBT_STATUS_LABEL[debt.status]}</Badge>
        {debt.purchaseId ? <Badge kind="info">Pagó una compra</Badge> : <Badge kind="info">Dinero recibido en caja</Badge>}
      </div>
      <FormError error={act.error} />
      <Card>
        <KV
          rows={[
            ['Fecha', formatDate(debt.date)],
            ['Valor de la deuda', formatCOP(debt.principal)],
            ['Abonado a capital', formatCOP(balance.paidPrincipal)],
            ['Intereses pagados', formatCOP(balance.paidInterest)],
            [<L key="o" k="debts">Saldo pendiente</L>, <strong key="ov">{formatCOP(balance.outstanding)}</strong>, true],
            ...(purchase ? ([['Compra', <a key="p" href={`#/compras/${purchase.id}`}>{formatDate(purchase.date)} · {formatCOP(purchase.total)}</a>]] as [string, React.ReactNode][]) : []),
            ['Inventario', inv?.name ?? 'General'],
            ...(debt.description ? ([['Detalle', debt.description]] as [string, string][]) : []),
          ]}
        />
        {debt.principal ? (
          <div style={{ marginTop: 10 }}>
            <Progress value={balance.paidPrincipal / debt.principal} label="Avance del pago" />
          </div>
        ) : null}
        {debt.notes ? <p className="small muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{debt.notes}</p> : null}
      </Card>
      {debt.status === 'open' ? (
        <button className="btn primary block" onClick={() => setPaying(true)} data-testid="pay-debt">
          <Icon name="money" /> Registrar abono
        </button>
      ) : null}
      <Card title="Abonos" flush>
        {payments.length === 0 ? (
          <Empty icon="money" title="Sin abonos" />
        ) : (
          <ul className="list">
            {payments.map((p) => (
              <li key={p.id} className="item" style={{ cursor: 'default' }}>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {formatCOP(p.principal)} a capital{p.interest ? ` + ${formatCOP(p.interest)} de intereses` : ''}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {formatDate(p.date)}
                    {p.notes ? ` · ${p.notes}` : ''}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label="Anular abono"
                  onClick={async () => {
                    if (await confirmAction({ title: 'Anular abono', message: <p>Se quita este abono y sus intereses (el gasto también se anula).</p>, danger: true, confirmText: 'Anular abono' }))
                      await act.run(() => voidDebtPayment(db, p.id), 'Abono anulado');
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {paying ? <PayDebtSheet debtId={id} outstanding={balance.outstanding} onClose={() => setPaying(false)} /> : null}
    </Page>
  );
}

function PayDebtSheet({ debtId, outstanding, onClose }: { debtId: ID; outstanding: number; onClose: () => void }) {
  const [principal, setPrincipal] = useState<number | null>(outstanding);
  const [interest, setInterest] = useState<number | null>(0);
  const [date, setDate] = useState<string | null>(nowISO());
  const [notes, setNotes] = useState('');
  const [opId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet
      title="Registrar abono"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-payment"
          onClick={async () => {
            const r = await act.run(() => payDebt(db, { opId, debtId, principal: principal ?? 0, interest: interest ?? 0, date: date ?? '', notes }), 'Abono registrado');
            if (r) onClose();
          }}
        >
          Guardar abono
        </button>
      }
    >
      <div className="stack">
        <Field label="Abono a capital (baja la deuda)" htmlFor="pd-p" hint={`Debes ${formatCOP(outstanding)}`} error={act.field === 'principal' ? act.error : null}>
          <MoneyInput id="pd-p" value={principal} onChange={setPrincipal} invalid={act.field === 'principal'} />
        </Field>
        <Field label="Intereses o cuota de manejo" htmlFor="pd-i" hint="Es un gasto financiero: resta de tu ganancia. No baja la deuda.">
          <MoneyInput id="pd-i" value={interest} onChange={setInterest} />
        </Field>
        <Field label="Fecha" htmlFor="pd-d">
          <DateTimeInput id="pd-d" value={date} onChange={setDate} />
        </Field>
        <Field label="Nota (opcional)" htmlFor="pd-n">
          <TextInput id="pd-n" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="small muted">Sale de la caja: {formatCOP((principal ?? 0) + (interest ?? 0))}</p>
        <FormError error={act.field === 'principal' ? null : act.error} />
      </div>
    </Sheet>
  );
}
