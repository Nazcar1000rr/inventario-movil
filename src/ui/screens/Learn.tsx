import { useEffect, useRef, useState, type ReactNode } from 'react';
import { antProjection, formatCOP } from '../../core';
import { Progress } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Badge, Card, Empty, Field, IntInput, KV, ListItem, MoneyInput, Notice, Page } from '../components/ui';
import { findLesson, LESSONS, type CalcKind, type Lesson } from '../help/lessons';
import { navigate } from '../router';
import { playSound } from '../sound';
import { getPref, setPref } from '../store';
import { isTourDone, startTour, TOURS } from '../tour';
import { ArticleBody } from './Help';
import { articleText } from '../help/content';
import { SpeakerToggle } from '../components/speaker';
import { useAutoSpeak } from '../speech';
import { celebrate } from '../theme';

/* ================= Progreso ================= */

export function isLessonDone(id: string): boolean {
  return getPref(`learn:${id}`, '') === 'done';
}

/* ================= Lista de lecciones y recorridos ================= */

export function ToursCard() {
  const [, force] = useState(0);
  return (
    <Card title={<h2>Recorridos guiados</h2>}>
      <p className="small muted">Te muestran la app paso a paso, sobre las pantallas reales.</p>
      <ul className="list wrap-sub" data-testid="tours-list">
        {TOURS.map((t) => (
          <ListItem
            key={t.id}
            icon={isTourDone(t.id) ? 'check' : 'play'}
            title={t.title}
            sub={`${t.summary} · ${t.minutes} min`}
            onClick={() => {
              startTour(t.id);
              force((x) => x + 1);
            }}
          />
        ))}
      </ul>
    </Card>
  );
}

export function LearnScreen() {
  const done = LESSONS.filter((l) => isLessonDone(l.id)).length;
  return (
    <Page title="Aprende de negocios" back="/mas" help="learn">
      <Card>
        <div className="stack-sm">
          <p className="small">
            Lecciones cortas para entender tus números: cada una tiene un ejemplo, una calculadora para probar con tus cifras y 3 preguntas.
          </p>
          <p className="small strong">
            {done} de {LESSONS.length} lecciones completadas{done === LESSONS.length ? ' · ¡Excelente!' : ''}
          </p>
          <Progress value={done / LESSONS.length} label="Lecciones completadas" />
        </div>
      </Card>
      <Card flush tour="learn-list">
        <ul className="list wrap-sub" data-testid="lessons">
          {LESSONS.map((l, i) => (
            <li key={l.id}>
              <a className="item" href={`#/aprende/${l.id}`}>
                <span className="lesson-emoji" aria-hidden="true">
                  {l.emoji}
                </span>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {i + 1}. {l.title}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {l.summary} · {l.minutes} min
                  </span>
                </span>
                <span className="item-side">{isLessonDone(l.id) ? <Badge kind="ok">✓ Hecha</Badge> : null}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <ToursCard />
    </Page>
  );
}

/* ================= Lección ================= */

export function LessonScreen({ id }: { id: string }) {
  const lesson = findLesson(id);
  const text = lesson ? articleText({ title: lesson.title, blocks: lesson.blocks }) : null;
  useAutoSpeak(text);
  if (!lesson)
    return (
      <Page title="Aprende" back="/aprende">
        <Empty title="Esa lección no existe" />
      </Page>
    );
  const idx = LESSONS.indexOf(lesson);
  const next = LESSONS[idx + 1];
  return (
    <Page title={lesson.title} subtitle={`Lección ${idx + 1} de ${LESSONS.length} · ${lesson.minutes} min`} back="/aprende" actions={<SpeakerToggle text={text ?? ''} />}>
      <Card>
        <ArticleBody a={{ id: lesson.id, title: lesson.title, category: '', keywords: '', summary: '', blocks: lesson.blocks }} />
      </Card>
      <Card title={<h2>🧮 Pruébalo con tus números</h2>}>
        <Calculator kind={lesson.calc} />
      </Card>
      <Quiz key={lesson.id} lesson={lesson} />
      {lesson.tryIt ? (
        <button type="button" className="btn block" onClick={() => navigate(lesson.tryIt!.to)}>
          <Icon name="play" /> {lesson.tryIt.label}
        </button>
      ) : null}
      {next ? (
        <a className="btn primary block wrap-btn" href={`#/aprende/${next.id}`}>
          Siguiente lección: {next.title} →
        </a>
      ) : (
        <a className="btn primary block" href="#/aprende">
          Volver a las lecciones
        </a>
      )}
    </Page>
  );
}

/* ================= Preguntas ================= */

function Quiz({ lesson }: { lesson: Lesson }) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const q = lesson.quiz[i];
  // Se lee cuando las preguntas quedan a la vista (y cada pregunta y respuesta después)
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || seen || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const quizText = finished
    ? `${score} de ${lesson.quiz.length} correctas. ${score === lesson.quiz.length ? '¡Muy bien!' : 'Repasa la lección y vuelve a intentarlo cuando quieras.'}`
    : chosen === null
      ? `Pregunta ${i + 1}. ${q.q} ${q.options.map((o, k) => `Opción ${k + 1}: ${o}.`).join(' ')}`
      : `${chosen === q.answer ? '¡Correcto!' : 'No exactamente.'} ${q.explain}`;
  useAutoSpeak(quizText, seen);
  const restart = () => {
    setI(0);
    setChosen(null);
    setScore(0);
    setFinished(false);
  };
  if (finished) {
    const perfect = score === lesson.quiz.length;
    return (
      <Card title={<h2>✅ Ponte a prueba</h2>} action={<SpeakerToggle text={quizText} />}>
        <div className="stack-sm" data-testid="quiz-result" ref={box}>
          <p className="strong">
            {score} de {lesson.quiz.length} correctas. {perfect ? '¡Muy bien!' : 'Repasa la lección y vuelve a intentarlo cuando quieras.'}
          </p>
          <p className="small muted">Lección marcada como completada.</p>
          <button type="button" className="btn sm" onClick={restart}>
            Repetir preguntas
          </button>
        </div>
      </Card>
    );
  }
  return (
    <Card title={<h2>✅ Ponte a prueba</h2>} action={<SpeakerToggle text={quizText} />}>
      <div className="stack-sm" data-testid="quiz" ref={box}>
        <p className="tiny muted">
          Pregunta {i + 1} de {lesson.quiz.length}
        </p>
        <p className="strong">{q.q}</p>
        <div className="stack-sm" role="group" aria-label="Respuestas">
          {q.options.map((o, k) => {
            const state = chosen === null ? '' : k === q.answer ? 'right' : k === chosen ? 'wrong' : '';
            return (
              <button
                key={k}
                type="button"
                className={`quiz-option ${state}`}
                disabled={chosen !== null}
                data-sound="none"
                onClick={() => {
                  setChosen(k);
                  if (k === q.answer) {
                    setScore((s) => s + 1);
                    playSound('success');
                  } else playSound('error');
                }}
              >
                {state === 'right' ? '✓ ' : state === 'wrong' ? '✗ ' : ''}
                {o}
              </button>
            );
          })}
        </div>
        {chosen !== null ? (
          <>
            <Notice kind={chosen === q.answer ? 'ok' : 'warn'} title={chosen === q.answer ? '¡Correcto!' : 'No exactamente'}>
              {q.explain}
            </Notice>
            <button
              type="button"
              className="btn primary block"
              data-testid="quiz-next"
              onClick={() => {
                if (i + 1 < lesson.quiz.length) {
                  setI(i + 1);
                  setChosen(null);
                } else {
                  setFinished(true);
                  if (!isLessonDone(lesson.id)) setPref(`learn:${lesson.id}`, 'done');
                  playSound('achievement');
                  celebrate();
                }
              }}
            >
              {i + 1 < lesson.quiz.length ? 'Siguiente pregunta' : 'Terminar'}
            </button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

/* ================= Calculadoras ================= */

function M({ label, value, onChange, id }: { label: string; value: number | null; onChange: (v: number | null) => void; id: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <MoneyInput id={id} value={value} onChange={onChange} />
    </Field>
  );
}
function N({ label, value, onChange, id, max = 100_000 }: { label: string; value: number | null; onChange: (v: number | null) => void; id: string; max?: number }) {
  return (
    <Field label={label} htmlFor={id}>
      <IntInput id={id} value={value} onChange={(v) => onChange(v === null ? null : Math.min(v, max))} />
    </Field>
  );
}
const v0 = (x: number | null) => x ?? 0;
const pct = (a: number, b: number) => (b ? `${(Math.round((a * 1000) / b) / 10).toString().replace('.', ',')} %` : '—');
const signed = (x: number) => (x < 0 ? `−${formatCOP(-x)}` : formatCOP(x));

function Out({ rows, children }: { rows: [ReactNode, ReactNode, boolean?][]; children?: ReactNode }) {
  return (
    <div className="calc-out" data-testid="calc-out">
      <KV rows={rows} />
      {children}
    </div>
  );
}

function Calculator({ kind }: { kind: CalcKind }) {
  switch (kind) {
    case 'cost':
      return <CostCalc />;
    case 'margin':
      return <MarginCalc />;
    case 'profit':
      return <ProfitCalc />;
    case 'cash':
      return <CashCalc />;
    case 'capital':
      return <CapitalCalc />;
    case 'rotation':
      return <RotationCalc />;
    case 'salary':
      return <SalaryCalc />;
    case 'pricing':
      return <PricingCalc />;
    case 'negotiate':
      return <NegotiateCalc />;
    case 'lots':
      return <LotsCalc />;
  }
}

function CostCalc() {
  const [paid, setPaid] = useState<number | null>(1_200_000);
  const [transport, setTransport] = useState<number | null>(20_000);
  const [repairs, setRepairs] = useState<number | null>(80_000);
  const [price, setPrice] = useState<number | null>(1_350_000);
  const cost = v0(paid) + v0(transport) + v0(repairs);
  const profit = v0(price) - cost;
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="c-paid" label="Le pagaste al proveedor" value={paid} onChange={setPaid} />
        <M id="c-tr" label="Transporte / envío" value={transport} onChange={setTransport} />
        <M id="c-rep" label="Reparaciones / piezas" value={repairs} onChange={setRepairs} />
        <M id="c-price" label="Lo vendes en" value={price} onChange={setPrice} />
      </div>
      <Out
        rows={[
          ['Costo real', formatCOP(cost)],
          ['Ganancia real', signed(profit), true],
          ['Si olvidas transporte y reparaciones, creerías ganar', signed(v0(price) - v0(paid))],
        ]}
      />
    </div>
  );
}

function MarginCalc() {
  const [cost, setCost] = useState<number | null>(80_000);
  const [price, setPrice] = useState<number | null>(100_000);
  const [want, setWant] = useState<number | null>(20);
  const c = v0(cost);
  const p = v0(price);
  const w = Math.min(v0(want), 95);
  const needed = c > 0 ? Math.ceil(c / (1 - w / 100)) : 0;
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="m-cost" label="Costo" value={cost} onChange={setCost} />
        <M id="m-price" label="Precio de venta" value={price} onChange={setPrice} />
        <N id="m-want" label="Margen que quieres (%)" value={want} onChange={setWant} max={95} />
      </div>
      <Out
        rows={[
          ['Ganancia por unidad', signed(p - c)],
          ['Margen sobre el precio', pct(p - c, p)],
          ['Ganancia sobre el costo', pct(p - c, c)],
          [`Precio para un margen del ${w} %`, formatCOP(needed), true],
        ]}
      />
    </div>
  );
}

function ProfitCalc() {
  const [sales, setSales] = useState<number | null>(3_000_000);
  const [cogs, setCogs] = useState<number | null>(2_400_000);
  const [exp, setExp] = useState<number | null>(150_000);
  const gross = v0(sales) - v0(cogs);
  const net = gross - v0(exp);
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="p-s" label="Lo que vendiste" value={sales} onChange={setSales} />
        <M id="p-c" label="Lo que te costó lo vendido" value={cogs} onChange={setCogs} />
        <M id="p-e" label="Gastos del negocio" value={exp} onChange={setExp} />
      </div>
      <Out
        rows={[
          ['Ganancia bruta', signed(gross)],
          ['Ganancia neta', signed(net), true],
          ['De cada 100 pesos vendidos te quedan', v0(sales) ? `${Math.round((net * 100) / v0(sales))} pesos` : '—'],
        ]}
      />
    </div>
  );
}

function CashCalc() {
  const [contrib, setContrib] = useState<number | null>(1_000_000);
  const [buy, setBuy] = useState<number | null>(800_000);
  const [sold, setSold] = useState<number | null>(500_000);
  const [cogs, setCogs] = useState<number | null>(400_000);
  const [credit, setCredit] = useState<number | null>(100_000);
  const cash = v0(contrib) - v0(buy) + v0(sold) - Math.min(v0(credit), v0(sold));
  const profit = v0(sold) - v0(cogs);
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="k-a" label="Aporte (plata tuya)" value={contrib} onChange={setContrib} />
        <M id="k-b" label="Compraste mercancía por" value={buy} onChange={setBuy} />
        <M id="k-s" label="Vendiste por" value={sold} onChange={setSold} />
        <M id="k-c" label="Lo vendido te costó" value={cogs} onChange={setCogs} />
        <M id="k-f" label="De eso, fiado (sin cobrar)" value={credit} onChange={setCredit} />
      </div>
      <Out
        rows={[
          ['Caja', formatCOP(cash)],
          ['Ganancia', signed(profit), true],
          ['Mercancía que te queda (a costo)', signed(v0(buy) - v0(cogs))],
          ['Por cobrar', formatCOP(Math.min(v0(credit), v0(sold)))],
        ]}
      >
        <p className="tiny muted">Fíjate: la caja y la ganancia son números distintos.</p>
      </Out>
    </div>
  );
}

function CapitalCalc() {
  const [contrib, setContrib] = useState<number | null>(2_000_000);
  const [withdraw, setWithdraw] = useState<number | null>(0);
  const [cash, setCash] = useState<number | null>(900_000);
  const [stock, setStock] = useState<number | null>(1_500_000);
  const [recv, setRecv] = useState<number | null>(100_000);
  const [debts, setDebts] = useState<number | null>(200_000);
  const value = v0(cash) + v0(stock) + v0(recv) - v0(debts);
  const put = v0(contrib) - v0(withdraw);
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="cp-a" label="Lo que has aportado" value={contrib} onChange={setContrib} />
        <M id="cp-r" label="Lo que has retirado" value={withdraw} onChange={setWithdraw} />
        <M id="cp-c" label="Caja" value={cash} onChange={setCash} />
        <M id="cp-s" label="Mercancía a costo" value={stock} onChange={setStock} />
        <M id="cp-p" label="Te deben" value={recv} onChange={setRecv} />
        <M id="cp-d" label="Debes" value={debts} onChange={setDebts} />
      </div>
      <Out
        rows={[
          ['Valor del negocio', signed(value)],
          ['Capital aportado', signed(put)],
          ['Crecimiento', `${signed(value - put)} (${pct(value - put, put)})`, true],
        ]}
      />
    </div>
  );
}

function RotationCalc() {
  const [pa, setPa] = useState<number | null>(80_000);
  const [da, setDa] = useState<number | null>(60);
  const [pb, setPb] = useState<number | null>(40_000);
  const [dbb, setDb] = useState<number | null>(10);
  const perA = v0(da) ? v0(pa) / v0(da) : 0;
  const perB = v0(dbb) ? v0(pb) / v0(dbb) : 0;
  const period = Math.max(v0(da), v0(dbb), 1);
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="r-pa" label="Producto A: ganancia" value={pa} onChange={setPa} />
        <N id="r-da" label="A: días en venderse" value={da} onChange={setDa} max={3650} />
        <M id="r-pb" label="Producto B: ganancia" value={pb} onChange={setPb} />
        <N id="r-db" label="B: días en venderse" value={dbb} onChange={setDb} max={3650} />
      </div>
      <Out
        rows={[
          ['A: ganancia por día', formatCOP(Math.round(perA))],
          ['B: ganancia por día', formatCOP(Math.round(perB))],
          [`En ${period} días, A deja`, formatCOP(Math.round(perA * period))],
          [`En ${period} días, B deja`, formatCOP(Math.round(perB * period)), true],
        ]}
      >
        <p className="tiny muted">{perA === perB ? 'Dejan lo mismo por día.' : `Por día te conviene más ${perA > perB ? 'A' : 'B'}.`}</p>
      </Out>
    </div>
  );
}

function SalaryCalc() {
  const [profit, setProfit] = useState<number | null>(1_000_000);
  const [share, setShare] = useState<number | null>(40);
  const [ant, setAnt] = useState<number | null>(5_000);
  const [times, setTimes] = useState<number | null>(5);
  const s = Math.round((v0(profit) * Math.min(v0(share), 100)) / 100);
  const pr = antProjection(v0(ant), v0(times));
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="s-p" label="Ganancia neta del mes" value={profit} onChange={setProfit} />
        <N id="s-s" label="% para ti" value={share} onChange={setShare} max={100} />
      </div>
      <Out
        rows={[
          ['Tu sueldo del mes', formatCOP(s), true],
          ['Se queda en el negocio para crecer', formatCOP(v0(profit) - s)],
        ]}
      />
      <p className="small strong">Gasto hormiga</p>
      <div className="grid-2">
        <M id="s-a" label="Cada vez" value={ant} onChange={setAnt} />
        <N id="s-t" label="Veces por semana" value={times} onChange={setTimes} max={50} />
      </div>
      <Out
        rows={[
          ['Al mes', formatCOP(pr.month)],
          ['Al año', formatCOP(pr.year), true],
          ['Del sueldo del mes se te va', pct(pr.month, s)],
        ]}
      />
    </div>
  );
}

function PricingCalc() {
  const [cost, setCost] = useState<number | null>(1_000_000);
  const [min, setMin] = useState<number | null>(10);
  const [market, setMarket] = useState<number | null>(1_250_000);
  const minPrice = v0(cost) + Math.ceil((v0(cost) * v0(min)) / 100 - 1e-6);
  const room = v0(market) - minPrice;
  return (
    <div className="stack">
      <div className="grid-2">
        <M id="pr-c" label="Costo real" value={cost} onChange={setCost} />
        <N id="pr-m" label="Margen mínimo (%)" value={min} onChange={setMin} max={500} />
        <M id="pr-k" label="Precio de mercado" value={market} onChange={setMarket} />
      </div>
      <Out
        rows={[
          ['Precio mínimo', formatCOP(minPrice)],
          ['Ganancia vendiendo al precio de mercado', signed(v0(market) - v0(cost)), true],
        ]}
      >
        {v0(market) ? (
          room >= 0 ? (
            <Notice kind="ok">El mercado paga {formatCOP(room)} más que tu mínimo: hay espacio para vender bien.</Notice>
          ) : (
            <Notice kind="warn">El mercado paga {formatCOP(-room)} menos que tu mínimo. Negocia mejor la compra o busca otro modelo.</Notice>
          )
        ) : null}
      </Out>
    </div>
  );
}

function NegotiateCalc() {
  const [units, setUnits] = useState<number | null>(20);
  const [save, setSave] = useState<number | null>(2_000);
  const month = v0(units) * v0(save);
  return (
    <div className="stack">
      <div className="grid-2">
        <N id="n-u" label="Unidades que compras al mes" value={units} onChange={setUnits} />
        <M id="n-s" label="Descuento por unidad" value={save} onChange={setSave} />
      </div>
      <Out
        rows={[
          ['Ganancia extra al mes', formatCOP(month)],
          ['Ganancia extra al año', formatCOP(month * 12), true],
        ]}
      />
    </div>
  );
}

function LotsCalc() {
  const [qa, setQa] = useState<number | null>(5);
  const [ca, setCa] = useState<number | null>(30_000);
  const [qb, setQb] = useState<number | null>(4);
  const [cb, setCb] = useState<number | null>(22_000);
  const [price, setPrice] = useState<number | null>(28_000);
  const totalQ = v0(qa) + v0(qb);
  const avg = totalQ ? Math.round((v0(qa) * v0(ca) + v0(qb) * v0(cb)) / totalQ) : 0;
  const p = v0(price);
  return (
    <div className="stack">
      <div className="grid-2">
        <N id="l-qa" label="Lote viejo: cantidad" value={qa} onChange={setQa} />
        <M id="l-ca" label="Lote viejo: costo c/u" value={ca} onChange={setCa} />
        <N id="l-qb" label="Lote nuevo: cantidad" value={qb} onChange={setQb} />
        <M id="l-cb" label="Lote nuevo: costo c/u" value={cb} onChange={setCb} />
        <M id="l-p" label="Precio de venta" value={price} onChange={setPrice} />
      </div>
      <Out
        rows={[
          ['Vendiendo del lote viejo, ganas por unidad', signed(p - v0(ca))],
          ['Vendiendo del lote nuevo, ganas por unidad', signed(p - v0(cb))],
          ['Con costo promedio parecería', `${signed(p - avg)} (costo ${formatCOP(avg)})`],
          ['Vendiendo todo a ese precio ganas', signed(p * totalQ - v0(qa) * v0(ca) - v0(qb) * v0(cb)), true],
        ]}
      >
        {p && p < v0(ca) ? <Notice kind="warn">A ese precio pierdes {formatCOP(v0(ca) - p)} por cada unidad del lote viejo.</Notice> : null}
      </Out>
    </div>
  );
}
