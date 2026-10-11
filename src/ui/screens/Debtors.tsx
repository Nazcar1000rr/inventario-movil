import { useState } from 'react';
import {
  collectionMessage,
  createCredit,
  CREDIT_KIND_LABEL,
  dayKey,
  forgiveDebt,
  formatCOP,
  formatDate,
  getDebtor,
  getReceivablesOverview,
  getSettings,
  newOpId,
  nowISO,
  payDebtor,
  saveNote,
  setDueDate,
  unforgiveDebt,
  voidCreditPayment,
  type DebtItem,
  type DebtRef,
  type Debtor,
  type ID,
} from '../../core';
import { PAYMENT_METHODS } from '../components/common';
import { InfoTip } from '../components/help';
import { Icon } from '../components/Icon';
import { PartyField } from '../components/pickers';
import { ListenButton } from '../components/speaker';
import { ask, Badge, Card, DateTimeInput, Empty, Field, FormError, Loading, MoneyInput, Notice, Page, Segmented, Sheet, TextInput } from '../components/ui';
import { plural } from '../components/viz';
import { navigate } from '../router';
import { db, toast, useAction, useLive } from '../store';
import { playSound } from '../sound';
import { syncReminderNotifications } from '../reminders';
import { shareText } from '../platform';
import { WhatsAppSheet } from '../components/whatsapp';
import { useRoute } from '../router';

export const DEBTORS_EXPLAIN =
  'Aquí ves a quién le fiaste y cuánto te debe cada persona. Lo que fías en mercancía se registra como una venta con pago pendiente o parcial (así sale del inventario). Cada abono que te den lo registras con su fecha y se va restando. También puedes anotar plata que prestaste o lo que ya te debían antes de usar la app.';

const dateInputValue = (iso: string | null) => (iso ? dayKey(new Date(iso)) : '');
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

/* ======================= Lista ======================= */

export function DebtorsScreen() {
  const ov = useLive((d) => getReceivablesOverview(d, null));
  const [adding, setAdding] = useState(false);
  return (
    <Page title="Me deben" back="/mas" help="debtors">
      <div className="grid-2">
        <a className="btn primary" href="#/ventas/nueva?fiado=1" data-testid="fiar">
          <Icon name="tag" /> Fiar mercancía
        </a>
        <button type="button" className="btn" onClick={() => setAdding(true)} data-testid="add-credit">
          <Icon name="plus" /> Otro fiado
        </button>
      </div>
      {!ov ? (
        <Loading />
      ) : (
        <>
          <div className="stat-grid" data-testid="debtors-kpis">
            <div className="kpi">
              <div className="kpi-label with-tip">
                Te deben <InfoTip k="debtors" />
              </div>
              <div className="kpi-value">{formatCOP(ov.total)}</div>
              <div className="kpi-foot">{plural(ov.debtors.length, 'persona', 'personas')}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Ya se pasó la fecha</div>
              <div className={`kpi-value${ov.overdue ? ' delta-down' : ''}`}>{formatCOP(ov.overdue)}</div>
              <div className="kpi-foot">Prometieron pagar y no han pagado</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Te abonaron este mes</div>
              <div className="kpi-value">{formatCOP(ov.collectedThisMonth)}</div>
            </div>
          </div>
          <Card title="Personas" flush>
            {!ov.debtors.length ? (
              <Empty icon="users" title="Nadie te debe">
                <p className="small muted">Cuando fíes algo (venta pendiente o parcial) aparecerá aquí.</p>
              </Empty>
            ) : (
              <ul className="list" data-testid="debtors-list">
                {ov.debtors.map((d) => (
                  <li key={d.key}>
                    <a className="item" href={`#/me-deben/${d.key}`}>
                      <span className="item-main">
                        <span className="item-title" style={{ display: 'block' }}>
                          {d.name}
                        </span>
                        <span className="item-sub" style={{ display: 'block' }}>
                          {plural(d.items.filter((i) => i.pending > 0).length, 'deuda', 'deudas')}
                          {d.oldest ? ` · desde el ${formatDate(d.oldest)}` : ''}
                          {d.lastPaymentAt ? ` · último abono ${formatDate(d.lastPaymentAt)}` : ''}
                        </span>
                      </span>
                      <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                        <span className="money strong">{formatCOP(d.pending)}</span>
                        {d.overdue ? <Badge kind="bad">Vencido</Badge> : d.nextDue ? <Badge kind="info">Paga el {formatDate(d.nextDue)}</Badge> : null}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <details className="more">
        <summary>¿Cómo funciona «Me deben»?</summary>
        <div className="stack-sm">
          <p className="small">{DEBTORS_EXPLAIN}</p>
          <div>
            <ListenButton text={DEBTORS_EXPLAIN} />
          </div>
        </div>
      </details>
      {adding ? <CreditSheet onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}

/* ======================= Una persona ======================= */

async function shareCollection(text: string) {
  if ((await shareText(text, 'Enviar mensaje de cobro')) === 'copied') toast('Mensaje copiado');
}

export function DebtorScreen({ debtorKey }: { debtorKey: string }) {
  const data = useLive(async (d) => ({ ...(await getDebtor(d, debtorKey)), settings: await getSettings(d) }), [debtorKey]);
  const [paying, setPaying] = useState<DebtRef | 'all' | null>(null);
  const [dueFor, setDueFor] = useState<DebtItem | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const route = useRoute();
  const [wa, setWa] = useState(() => route.query.get('wa') === '1');
  const act = useAction();
  if (!data)
    return (
      <Page title="Me deben" back="/me-deben">
        <Loading />
      </Page>
    );
  const { debtor, history, settings } = data;
  if (!debtor)
    return (
      <Page title="Me deben" back="/me-deben">
        <Empty icon="users" title="No hay nada pendiente con esta persona" />
      </Page>
    );
  const open = debtor.items.filter((i) => i.pending > 0);
  const closed = debtor.items.filter((i) => i.pending <= 0);
  const msg = collectionMessage(debtor, settings.businessName, formatCOP, formatDate);
  return (
    <Page title={debtor.name} subtitle={debtor.phone || undefined} back="/me-deben" help="debtor">
      <div className="kpi" data-testid="debtor-total">
        <div className="kpi-label">Te debe</div>
        <div className="hero-figure">{formatCOP(debtor.pending)}</div>
        {debtor.overdue ? <div className="kpi-foot delta-down">⚠ {formatCOP(debtor.overdue)} ya se pasó de la fecha</div> : debtor.nextDue ? <div className="kpi-foot">Prometió pagar el {formatDate(debtor.nextDue)}</div> : null}
      </div>
      {debtor.pending > 0 ? (
        <button type="button" className="btn primary block" onClick={() => setPaying('all')} data-testid="debtor-pay">
          <Icon name="money" /> Registrar abono
        </button>
      ) : null}
      {debtor.pending > 0 ? (
        <button type="button" className="btn block wa-btn" onClick={() => setWa(true)} data-testid="debtor-whatsapp">
          <Icon name="send" /> Cobrar por WhatsApp
        </button>
      ) : null}
      <div className="row wrap" style={{ gap: 6 }}>
        {debtor.phone ? (
          <a className="btn sm" href={`tel:${debtor.phone.replace(/[^\d+]/g, '')}`}>
            <Icon name="phone" size={16} /> Llamar
          </a>
        ) : null}
        {debtor.pending > 0 ? (
          <>
            <button type="button" className="btn sm" onClick={() => void shareCollection(msg)} data-testid="debtor-message">
              <Icon name="share" size={16} /> Mensaje por otra app
            </button>
            <button
              type="button"
              className="btn sm"
              data-testid="debtor-reminder"
              onClick={async () => {
                const day = debtor.nextDue ? dayKey(new Date(debtor.nextDue)) : dayKey(new Date(Date.now() + 7 * 86_400_000));
                const r = await act.run(() => saveNote(db, { opId: newOpId(), title: `Cobrar a ${debtor.name}`, description: `Saldo pendiente: ${formatCOP(debtor.pending)}`, day, remindDays: [1, 0] }), 'Recordatorio en el calendario');
                if (r) void syncReminderNotifications();
              }}
            >
              <Icon name="clock" size={16} /> Recordarme cobrar
            </button>
          </>
        ) : null}
        {debtor.customerId ? (
          <a className="btn sm" href={`#/compradores/${debtor.customerId}`}>
            <Icon name="users" size={16} /> Ficha
          </a>
        ) : null}
      </div>
      <FormError error={act.error} />
      <Card title="Lo que debe" flush>
        {open.length ? <ItemList items={open} debtorKey={debtorKey} onPay={(r) => setPaying(r)} onDue={setDueFor} /> : <Empty icon="check" title="¡Está al día!" />}
        {closed.length ? (
          <div style={{ padding: '0 14px 12px' }}>
            <label className="check small">
              <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> Ver lo ya pagado o perdonado ({closed.length})
            </label>
          </div>
        ) : null}
        {showPaid ? <ItemList items={closed} debtorKey={debtorKey} onPay={() => undefined} onDue={() => undefined} /> : null}
      </Card>
      <Card title="Abonos" flush>
        {!history.length ? (
          <Empty icon="money" title="Todavía no hay abonos" />
        ) : (
          <ul className="list" data-testid="debtor-history">
            {history.map((h) => (
              <li key={h.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {formatCOP(h.amount)}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDate(h.date)}
                      {h.method ? ` · ${h.method}` : ''}
                      {h.notes && h.notes !== 'Abono' ? ` · ${h.notes}` : ''}
                    </span>
                  </span>
                  {h.type === 'credit' ? (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label="Borrar este abono"
                      onClick={async () => {
                        const r = await ask({ title: 'Borrar abono', message: 'Úsalo solo si lo registraste por error.', confirmText: 'Borrar', danger: true });
                        if (r.ok) await act.run(() => voidCreditPayment(db, h.id), 'Abono borrado');
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  ) : (
                    <a className="btn sm" href={`#/ventas/${h.refId}`}>
                      Venta
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {paying ? <PaySheet debtor={debtor} target={paying === 'all' ? null : paying} onClose={() => setPaying(null)} /> : null}
      {dueFor ? <DueSheet item={dueFor} onClose={() => setDueFor(null)} /> : null}
      {wa ? (
        <WhatsAppSheet
          name={debtor.name}
          phone={debtor.phone}
          customerId={debtor.customerId}
          hasDetail={open.length > 1}
          build={(tone, detail) => collectionMessage(debtor, settings.businessName, formatCOP, formatDate, { tone, detail })}
          onClose={() => {
            setWa(false);
            if (route.query.get('wa')) navigate(`/me-deben/${debtorKey}`, { replace: true });
          }}
        />
      ) : null}
    </Page>
  );
}

function ItemList({ items, onPay, onDue }: { items: DebtItem[]; debtorKey: string; onPay: (r: DebtRef) => void; onDue: (i: DebtItem) => void }) {
  const act = useAction();
  return (
    <ul className="list" data-testid="debt-items">
      {items.map((it) => (
        <li key={it.id} className="inq-row">
          <div className="inq-main">
            <span className="strong small">{it.concept}</span>
            <span className="money strong">{formatCOP(it.pending)}</span>
          </div>
          <div className="inq-sub small muted">
            {formatDate(it.date)} · era {formatCOP(it.original)}
            {it.paid ? ` · abonado ${formatCOP(it.paid)}` : ''}
            {it.forgiven ? ` · perdonado ${formatCOP(it.forgiven)}` : ''}
            {it.dueDate ? ` · ${it.overdue ? 'debía pagar' : 'paga'} el ${formatDate(it.dueDate)}` : ''}
          </div>
          {it.overdue ? (
            <Badge kind="bad">
              <span aria-hidden="true">⚠</span> Vencido
            </Badge>
          ) : null}
          <div className="inq-actions">
            {it.pending > 0 ? (
              <>
                <button type="button" className="btn sm" onClick={() => onPay({ type: it.type, id: it.id })}>
                  <Icon name="money" size={16} /> Abonar a esto
                </button>
                <button type="button" className="btn sm" onClick={() => onDue(it)}>
                  <Icon name="clock" size={16} /> {it.dueDate ? 'Cambiar fecha' : '¿Cuándo paga?'}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  data-testid="forgive"
                  onClick={async () => {
                    const r = await ask({
                      title: 'No me va a pagar',
                      message: <p>Se perdonan {formatCOP(it.pending)}. Se registran como pérdida y bajan tu ganancia. Lo puedes deshacer después.</p>,
                      input: { label: 'Nota (opcional)', placeholder: 'Ej.: se fue del barrio' },
                      confirmText: 'Perdonar',
                      danger: true,
                    });
                    if (r.ok) await act.run(() => forgiveDebt(db, { type: it.type, id: it.id }, r.value), 'Saldo perdonado');
                  }}
                >
                  No me va a pagar
                </button>
              </>
            ) : it.forgiven ? (
              <button type="button" className="btn sm" onClick={() => void act.run(() => unforgiveDebt(db, { type: it.type, id: it.id }), 'Vuelve a contar como deuda')}>
                <Icon name="undo" size={16} /> Quitar el perdón
              </button>
            ) : null}
            {it.type === 'sale' ? (
              <a className="btn sm" href={`#/ventas/${it.id}`}>
                Ver venta
              </a>
            ) : null}
          </div>
        </li>
      ))}
      <FormError error={act.error} />
    </ul>
  );
}

function PaySheet({ debtor, target, onClose }: { debtor: Debtor; target: DebtRef | null; onClose: () => void }) {
  const item = target ? debtor.items.find((i) => i.type === target.type && i.id === target.id) : null;
  const max = item ? item.pending : debtor.pending;
  const [amount, setAmount] = useState<number | null>(max);
  const [date, setDate] = useState<string | null>(nowISO());
  const [method, setMethod] = useState('Efectivo');
  const [notes, setNotes] = useState('');
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet
      title="Registrar abono"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-debt-payment"
          onClick={async () => {
            const r = await act.run(() => payDebtor(db, { opId, key: debtor.key, amount: amount ?? 0, date: date ?? '', method, notes, target }), 'Abono registrado');
            if (r) {
              playSound('sale');
              setOpId(newOpId());
              onClose();
            }
          }}
        >
          Guardar abono
        </button>
      }
    >
      <p className="small muted">
        {debtor.name} te debe {formatCOP(debtor.pending)}.{' '}
        {item ? `Este abono va solo a: ${item.concept}.` : debtor.items.filter((i) => i.pending > 0).length > 1 ? 'Se abona primero a lo más antiguo.' : ''}
      </p>
      <Field label="¿Cuánto te abonó?" htmlFor="dp-amount" error={act.field === 'amount' ? act.error : null} hint={`Máximo ${formatCOP(max)}`}>
        <MoneyInput id="dp-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="¿Cuándo?" htmlFor="dp-date" error={act.field === 'date' ? act.error : null}>
        <DateTimeInput id="dp-date" value={date} onChange={setDate} />
      </Field>
      <Field label="¿Cómo te pagó?" htmlFor="dp-method">
        <select id="dp-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Nota (opcional)" htmlFor="dp-notes">
        <TextInput id="dp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {amount !== null && amount > 0 && amount < max ? <p className="small">Le quedarían {formatCOP(max - amount)} por pagar.</p> : null}
      <FormError error={act.field === 'amount' || act.field === 'date' ? null : act.error} />
    </Sheet>
  );
}

function DueSheet({ item, onClose }: { item: DebtItem; onClose: () => void }) {
  const [day, setDay] = useState(dateInputValue(item.dueDate));
  const act = useAction();
  return (
    <Sheet
      title="¿Cuándo te paga?"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary block"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => setDueDate(db, { type: item.type, id: item.id }, fromDateInput(day)).then(() => true), 'Fecha guardada');
            if (r) onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted">{item.concept}</p>
      <Field label="Fecha en que prometió pagar" htmlFor="due-day">
        <input id="due-day" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      {item.dueDate ? (
        <button type="button" className="btn sm" onClick={() => setDay('')}>
          Quitar la fecha
        </button>
      ) : null}
      <FormError error={act.error} />
    </Sheet>
  );
}

/* ======================= Otro fiado (plata o deuda de antes) ======================= */

function CreditSheet({ onClose }: { onClose: () => void }) {
  const [customerId, setCustomerId] = useState<ID | null>(null);
  const [kind, setKind] = useState<'loan' | 'opening'>('loan');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(nowISO());
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [remind, setRemind] = useState(false);
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  return (
    <Sheet
      title="Otro fiado"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary block"
          disabled={act.busy}
          data-testid="save-credit"
          onClick={async () => {
            const c = await act.run(() => createCredit(db, { opId, customerId: customerId ?? '', kind, amount: amount ?? 0, date: date ?? '', dueDate: fromDateInput(due), notes }), 'Guardado en «Me deben»');
            if (!c) return;
            if (remind && due) {
              const person = await db.customers.get(c.customerId);
              await saveNote(db, { opId: newOpId(), title: `Cobrar a ${person?.name ?? ''}`.trim(), description: `${CREDIT_KIND_LABEL[kind]}: ${formatCOP(c.amount)}`, day: due, remindDays: [1, 0] });
              void syncReminderNotifications();
            }
            setOpId(newOpId());
            onClose();
            navigate(`/me-deben/${c.customerId}`);
          }}
        >
          Guardar
        </button>
      }
    >
      <Notice>¿Le fiaste mercancía? Regístrala como venta con pago pendiente: así sale del inventario. Aquí va la plata que no es una venta.</Notice>
      <PartyField type="customer" value={customerId} onChange={setCustomerId} />
      {act.field === 'customerId' ? <FormError error={act.error} /> : null}
      <Field label="¿Qué es?">
        <Segmented
          label="Tipo de fiado"
          value={kind}
          onChange={setKind}
          options={[
            ['loan', 'Le presté plata'],
            ['opening', 'Me debía de antes'],
          ]}
        />
      </Field>
      <p className="tiny muted">{kind === 'loan' ? 'La plata sale de la caja del negocio y vuelve con los abonos.' : 'Plata que ya te debían antes de usar la app: no sale de la caja (cuenta como capital que ya tenías).'}</p>
      <Field label="Valor" htmlFor="cr-amount" error={act.field === 'amount' ? act.error : null}>
        <MoneyInput id="cr-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="Fecha" htmlFor="cr-date">
        <DateTimeInput id="cr-date" value={date} onChange={setDate} />
      </Field>
      <Field label="¿Cuándo te paga? (opcional)" htmlFor="cr-due">
        <input id="cr-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      {due ? (
        <label className="check small">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> Recordarme cobrar (el día antes y ese día)
        </label>
      ) : null}
      <Field label="Nota (opcional)" htmlFor="cr-notes">
        <TextInput id="cr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: para el pasaje" />
      </Field>
      <FormError error={act.field && act.field !== 'amount' && act.field !== 'customerId' ? act.error : act.field ? null : act.error} />
    </Sheet>
  );
}
