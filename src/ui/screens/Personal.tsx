import { useState } from 'react';
import {
  addPersonalSpending,
  antProjection,
  formatCOP,
  formatDateTime,
  getPersonalMonth,
  getSettings,
  listPersonalSpending,
  newOpId,
  nowISO,
  PERSONAL_TAGS,
  personalSpendingImpact,
  voidCapitalMovement,
} from '../../core';
import { Progress } from '../components/Chart';
import { InfoTip } from '../components/help';
import { Icon } from '../components/Icon';
import { ask, Badge, Card, Chips, DateTimeInput, Empty, Field, FormError, IntInput, KV, Loading, MoneyInput, Notice, Page, Segmented, TextInput } from '../components/ui';
import { MONEY_TIPS, pickTip } from '../help/content';
import { navigate } from '../router';
import { db, useAction, useLive } from '../store';
import { playSound } from '../sound';
import { ListenButton } from '../components/speaker';

/* ================= Formulario de gasto personal ================= */

export function PersonalSpendingForm({ onSaved }: { onSaved?: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [tag, setTag] = useState<string>('Gusto');
  const [notes, setNotes] = useState('');
  const [repay, setRepay] = useState<'no' | 'yes'>('no');
  const [date, setDate] = useState<string | null>(nowISO());
  const [opId, setOpId] = useState(newOpId);
  const act = useAction();
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act.run(
          () => addPersonalSpending(db, { opId, date: date ?? '', amount: amount ?? 0, tag, notes, willRepay: repay === 'yes' }),
          repay === 'yes' ? 'Préstamo a ti registrado' : 'Gasto personal registrado',
        );
        if (r) {
          setOpId(newOpId());
          if (onSaved) onSaved();
          else navigate('/personal', { replace: true });
        }
      }}
    >
      <Notice title="Es plata que sacas del negocio para ti">
        Un gusto, un antojo, un gasto hormiga… No es un gasto del negocio: no baja la ganancia, pero sí saca plata de la caja. Registrarlo te ayuda a saber de verdad cuánto te deja el negocio.
      </Notice>
      <Field label="Valor" htmlFor="ps-amount" error={act.field === 'amount' ? act.error : null}>
        <MoneyInput id="ps-amount" value={amount} onChange={setAmount} invalid={act.field === 'amount'} />
      </Field>
      <Field label="¿En qué?">
        <Chips label="En qué lo gastaste" value={tag} onChange={setTag} options={PERSONAL_TAGS.map((t) => [t, t] as [string, string])} />
      </Field>
      <Field label="Nota (opcional)" htmlFor="ps-notes">
        <TextInput id="ps-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: tenis, almuerzo, café" />
      </Field>
      <Field label="¿Lo vas a devolver al negocio?" hint={repay === 'yes' ? 'Queda como "préstamo a ti": el negocio no pierde capital mientras lo devuelvas.' : 'Queda como "retiro": es plata que el negocio ya no tiene.'}>
        <Segmented label="¿Lo vas a devolver?" value={repay} onChange={setRepay} options={[['no', 'No, es un retiro'], ['yes', 'Sí, es un préstamo']]} />
      </Field>
      <Field label="Fecha" htmlFor="ps-date">
        <DateTimeInput id="ps-date" value={date} onChange={setDate} />
      </Field>
      <PersonalImpactBox amount={amount ?? 0} date={date ?? nowISO()} tag={tag} />
      <FormError error={act.field === 'amount' ? null : act.error} />
      <button className="btn primary block" disabled={act.busy} data-testid="save-personal">
        Registrar gasto personal
      </button>
    </form>
  );
}

/** Qué pasa con tus ganancias y con la plata del negocio si haces este gasto. */
export function PersonalImpactBox({ amount, date, tag }: { amount: number; date: string; tag: string }) {
  const data = useLive(async (d) => ({ imp: await personalSpendingImpact(d, amount, date), st: await getSettings(d) }), [amount, date]);
  if (!data) return null;
  const { imp, st } = data;
  const m = imp.month;
  const tip = pickTip(MONEY_TIPS, new Date(), amount % 7);
  return (
    <div className="stack-sm" data-testid="personal-impact">
      {amount <= 0 ? (
        <p className="small muted">
          Este mes el negocio lleva {formatCOP(m.profit)} de ganancia neta y ya has sacado {formatCOP(m.taken)}.
        </p>
      ) : imp.level === 'ok' ? (
        <Notice kind="ok" title="Sale de tus ganancias del mes">
          Este mes el negocio ha ganado {formatCOP(m.profit)}. Con este gasto habrás sacado {formatCOP(imp.takenAfter)} ({imp.pctOfProfit} %). Te quedan {formatCOP(imp.freeProfitAfter)} de ganancia sin tocar.
        </Notice>
      ) : imp.level === 'warn' ? (
        <Notice kind="warn" title={`Ya vas en el ${imp.pctOfProfit} % de la ganancia del mes`}>
          Todavía sale de ganancias, pero te queda poco: {formatCOP(imp.freeProfitAfter)}. Lo que dejas en el negocio es lo que lo hace crecer.
        </Notice>
      ) : (
        <Notice kind="bad" title="Esto ya no sale de tus ganancias: sale del capital del negocio">
          {m.profit <= 0
            ? `Este mes el negocio todavía no tiene ganancia (${formatCOP(m.profit)}). Todo lo que saques sale de la plata para comprar mercancía.`
            : `De este gasto, ${formatCOP(imp.fromProfit)} sale de las ganancias y ${formatCOP(imp.fromCapital)} del capital. Tu negocio queda con ${formatCOP(imp.fromCapital)} menos para comprar mercancía.`}
        </Notice>
      )}
      {amount > 0 ? (
        <p className="tiny muted">
          No baja la ganancia del negocio, pero sí saca {formatCOP(amount)} de la caja (quedaría en {formatCOP(imp.cashAfter)}).
          {imp.cashShort ? ' Ojo: la caja calculada no alcanza; revisa si falta registrar algo.' : ''}
        </p>
      ) : null}
      {amount > 0 && tag === 'Gasto hormiga' ? (
        <p className="tiny">
          Si esto se repite todos los días: <strong>{formatCOP(antProjection(amount, 7).month)}</strong> al mes y {formatCOP(antProjection(amount, 7).year)} al año.
        </p>
      ) : null}
      {st.personalSpendingTips !== false ? (
        <div className="tip-card" data-testid="money-tip">
          <span className="tip-icon">💡</span>
          <div className="stack-sm">
            <p className="small strong">La plata del negocio es del negocio</p>
            <p className="small">{tip}</p>
            <div>
              <ListenButton text={`La plata del negocio es del negocio. ${tip}`} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ================= Pantalla de gastos personales ================= */

export function PersonalScreen() {
  const data = useLive(async (d) => ({ month: await getPersonalMonth(d), list: await listPersonalSpending(d, 100) }));
  const [antAmount, setAntAmount] = useState<number | null>(5_000);
  const [antTimes, setAntTimes] = useState<number | null>(5);
  const act = useAction();
  if (!data)
    return (
      <Page title="Gastos personales" back="/mas" help="personal">
        <Loading />
      </Page>
    );
  const { month: m, list } = data;
  const proj = antProjection(antAmount ?? 0, antTimes ?? 0);
  return (
    <Page title="Gastos personales" back="/mas" help="personal">
      <a className="btn primary block" href="#/gastos/nuevo?tipo=personal" onClick={() => playSound('tap')}>
        <Icon name="plus" /> Registrar gasto personal
      </a>
      <Card
        tour="personal-month"
        title={
          <h2 className="with-tip">
            Este mes <InfoTip k="personalMonth" />
          </h2>
        }
      >
        <KV
          rows={[
            ['Ganancia neta del negocio', formatCOP(m.profit)],
            ['Lo que has sacado para ti', formatCOP(m.taken)],
            ['De eso, gastos personales', `${formatCOP(m.personal)} (${m.personalCount})`],
            ['Ganancia que queda en el negocio', formatCOP(m.freeProfit), true],
          ]}
        />
        {m.profit > 0 ? (
          <div className="stack-sm" style={{ marginTop: 10 }}>
            <Progress value={m.taken / m.profit} label="Parte de la ganancia que has sacado" />
            <p className="tiny muted">Has sacado el {Math.round((m.taken * 100) / m.profit)} % de la ganancia del mes.</p>
          </div>
        ) : null}
        {m.freeProfit < 0 ? (
          <Notice kind="bad" title="Este mes estás sacando más de lo que el negocio gana">
            Te has comido {formatCOP(-m.freeProfit)} del capital. Intenta devolverlo o reducir los gastos personales el resto del mes.
          </Notice>
        ) : null}
      </Card>
      {m.byTag.length ? (
        <Card title="¿En qué se te va?">
          <ul className="list">
            {m.byTag.map((t) => (
              <li key={t.tag}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="item-main">
                    <span className="item-title">{t.tag}</span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {t.count} {t.count === 1 ? 'vez' : 'veces'}
                    </span>
                  </span>
                  <span className="item-side money strong">{formatCOP(t.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Calculadora de gasto hormiga">
        <div className="grid-2">
          <Field label="Cada vez" htmlFor="ant-a">
            <MoneyInput id="ant-a" value={antAmount} onChange={setAntAmount} />
          </Field>
          <Field label="Veces por semana" htmlFor="ant-t">
            <IntInput id="ant-t" value={antTimes} onChange={(v) => setAntTimes(v === null ? null : Math.min(v, 50))} />
          </Field>
        </div>
        <p className="small" data-testid="ant-result">
          Son <strong>{formatCOP(proj.month)}</strong> al mes y <strong>{formatCOP(proj.year)}</strong> al año.
        </p>
      </Card>
      <div className="tip-card">
        <span className="tip-icon">💡</span>
        <div>
          <p className="small strong">La plata del negocio es del negocio</p>
          <p className="small">{pickTip(MONEY_TIPS)}</p>
        </div>
      </div>
      <FormError error={act.error} />
      <Card title="Registrados" flush>
        {!list.length ? (
          <Empty icon="wallet" title="Todavía no has registrado gastos personales" />
        ) : (
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {c.tag || 'Personal'}
                      {c.notes ? <span className="muted small"> · {c.notes}</span> : null}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {formatDateTime(c.date)} · {c.kind === 'owner_loan' ? 'préstamo (por devolver)' : 'retiro'}
                    </span>
                  </span>
                  <span className="item-side stack-sm" style={{ alignItems: 'flex-end' }}>
                    <span className="money strong">{formatCOP(c.amount)}</span>
                    {c.status === 'voided' ? (
                      <Badge>⊘ Anulado</Badge>
                    ) : (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={async () => {
                          const r = await ask({ title: 'Anular gasto personal', danger: true, input: { label: 'Motivo', required: true, placeholder: 'Ej.: lo registré dos veces' }, confirmText: 'Anular' });
                          if (r.ok) await act.run(() => voidCapitalMovement(db, c.id, r.value), 'Anulado');
                        }}
                      >
                        Anular
                      </button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {list.some((c) => c.kind === 'owner_loan' && c.status === 'active') ? (
        <p className="small muted">
          Para devolver un préstamo, ve a <a href="#/capital">Capital</a> → Devuelvo préstamo.
        </p>
      ) : null}
    </Page>
  );
}
