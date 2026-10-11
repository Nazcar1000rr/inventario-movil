import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compareVersions, errorMessage, getSettings, updateSettings } from '../../core';
import { Progress } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Card, confirmAction, Empty, ListItem, Loading, Notice, Page, Sheet, TextInput } from '../components/ui';
import { ARTICLES, articleText, CATEGORIES, CHANGELOG, findArticle, METRICS, searchArticles, type Article, type Block } from '../help/content';
import { SpeakerToggle } from '../components/speaker';
import { useAutoSpeak } from '../speech';
import { isNative, shareBinary } from '../platform';
import { ToursCard } from './Learn';
import { navigate } from '../router';
import { db, isPracticeMode, practice, PRACTICE_DB, setPracticeMode, setPref, getPref, toast, useLive } from '../store';

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

function BlockView({ b }: { b: Block }) {
  if ('p' in b) return <p>{b.p}</p>;
  if ('h' in b) return <h3 className="help-h">{b.h}</h3>;
  if ('tip' in b) return <Notice kind="ok">{b.tip}</Notice>;
  if ('warn' in b) return <Notice kind="warn">{b.warn}</Notice>;
  if ('steps' in b)
    return (
      <ol className="help-steps">
        {b.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    );
  return (
    <ul className="help-list">
      {b.list.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

export function ArticleBody({ a }: { a: Article }) {
  return (
    <div className="stack help-article">
      {a.blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}

export function HelpScreen() {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim().length >= 2 ? searchArticles(q) : null), [q]);
  useEffect(() => setPref('helpVisited', '1'), []);
  return (
    <Page title="Ayuda" back="/mas">
      <TextInput type="search" placeholder="Buscar en el manual (ej.: deuda, precio, respaldo)…" aria-label="Buscar en el manual" value={q} onChange={(e) => setQ(e.target.value)} data-testid="help-search" />
      {results ? (
        results.length === 0 ? (
          <Empty icon="search" title="Sin resultados">
            <p className="small muted">Prueba con otra palabra.</p>
          </Empty>
        ) : (
          <Card flush>
            <ul className="list wrap-sub" data-testid="help-results">
              {results.map((a) => (
                <ListItem key={a.id} href={`/ayuda/${a.id}`} icon="book" title={a.title} sub={a.summary} />
              ))}
            </ul>
          </Card>
        )
      ) : (
        <>
          <GettingStartedCard always />
          <ToursCard />
          <Card flush>
            <ul className="list wrap-sub">
              <ListItem href="/aprende" icon="star" title="Aprende de negocios" sub="16 lecciones cortas: costo, margen, ganancia, caja, expectativas, 80/20, fiar y más" />
            </ul>
          </Card>
          <PracticeCard />
          <Card flush title={<h2 style={{ padding: '0 0 4px' }}>Manual</h2>}>
            <ul className="list wrap-sub">
              <ListItem href="/ayuda/manual" icon="file" title="Manual completo" sub="Todo el manual en una página, para leer, imprimir o guardar en PDF" />
              <ListItem href="/ayuda/novedades" icon="sparkle" title="Novedades" sub={`Lo nuevo en la versión ${APP_VERSION}`} />
            </ul>
          </Card>
          {CATEGORIES.map((c) => {
            const list = ARTICLES.filter((a) => a.category === c);
            if (!list.length) return null;
            return (
              <Card key={c} title={c} flush>
                <ul className="list wrap-sub">
                  {list.map((a) => (
                    <ListItem key={a.id} href={`/ayuda/${a.id}`} title={a.title} sub={a.summary} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}

export function HelpArticleScreen({ id }: { id: string }) {
  if (id === 'manual') return <ManualScreen />;
  if (id === 'novedades') return <NewsScreen />;
  return <ArticleScreen id={id} />;
}

function ArticleScreen({ id }: { id: string }) {
  const a = findArticle(id);
  const text = a ? articleText(a) : null;
  useAutoSpeak(text);
  if (!a) return <Page title="Ayuda" back="/ayuda"><Empty title="Ese tema no existe" /></Page>;
  const idx = ARTICLES.indexOf(a);
  const next = ARTICLES[idx + 1];
  return (
    <Page title={a.title} subtitle={a.category} back="/ayuda" actions={<SpeakerToggle text={text ?? ''} />}>
      <Card>
        <ArticleBody a={a} />
      </Card>
      {a.to ? (
        <button className="btn primary block" onClick={() => navigate(a.to!)} data-testid="take-me">
          <Icon name="play" /> Llévame ahí{a.toLabel ? `: ${a.toLabel}` : ''}
        </button>
      ) : null}
      {next ? (
        <a className="btn block" href={`#/ayuda/${next.id}`}>
          Siguiente: {next.title} <Icon name="chevron" size={18} />
        </a>
      ) : null}
    </Page>
  );
}

/** Manual completo en una sola página (se puede imprimir o guardar como PDF). */
export function ManualScreen() {
  const [pdfAvailable, setPdfAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./manual-inventario-movil.pdf', { method: 'HEAD' })
      .then((r) => alive && setPdfAvailable(r.ok))
      .catch(() => alive && setPdfAvailable(false));
    return () => {
      alive = false;
    };
  }, []);
  const sharePdf = async () => {
    try {
      const r = await fetch('./manual-inventario-movil.pdf');
      if (!r.ok) throw new Error('No se encontró el PDF del manual.');
      const bytes = new Uint8Array(await r.arrayBuffer());
      await shareBinary('manual-inventario-movil.pdf', bytes, 'application/pdf', 'Manual');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Page title="Manual completo" back="/ayuda">
      <div className="actions no-print">
        {pdfAvailable ? (
          <button className="btn primary" onClick={() => void sharePdf()}>
            <Icon name="file" /> Descargar / compartir PDF
          </button>
        ) : null}
        {!isNative() ? (
          <button className="btn" onClick={() => window.print()}>
            <Icon name="download" /> Imprimir o guardar como PDF
          </button>
        ) : null}
      </div>
      <div className="manual" data-testid="manual">
        <h1 className="manual-title">Manual de Inventario Móvil</h1>
        <p className="small muted">Versión {APP_VERSION}. Este manual también está dentro de la app en Más → Ayuda, con buscador.</p>
        {CATEGORIES.map((c) => (
          <section key={c}>
            <h2 className="manual-cat">{c}</h2>
            {ARTICLES.filter((a) => a.category === c).map((a) => (
              <article key={a.id} className="manual-article">
                <h3>{a.title}</h3>
                <p className="small muted">{a.summary}</p>
                <ArticleBody a={a} />
              </article>
            ))}
          </section>
        ))}
        <section>
          <h2 className="manual-cat">Glosario de números (ⓘ)</h2>
          <dl className="manual-glossary">
            {Object.values(METRICS).map((m) => (
              <div key={m.title}>
                <dt>{m.title}</dt>
                <dd>
                  {m.what}
                  {m.formula ? (
                    <>
                      <br />
                      <span className="small">Cálculo: {m.formula}</span>
                    </>
                  ) : null}
                  {m.note ? (
                    <>
                      <br />
                      <span className="small muted">{m.note}</span>
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Page>
  );
}

function NewsList({ since }: { since?: string | null }) {
  const entries = CHANGELOG.filter((e) => !since || compareVersions(e.version, since) > 0);
  return (
    <div className="stack">
      {entries.map((e) => (
        <div key={e.version} className="stack-sm">
          <p className="strong">{e.title}</p>
          <ul className="list wrap-sub">
            {e.items.map((it) => (
              <li key={it.title} className="item" style={{ cursor: it.to ? 'pointer' : 'default', padding: '8px 0' }} onClick={it.to ? () => navigate(it.to!) : undefined}>
                <span className="muted">
                  <Icon name="sparkle" size={18} />
                </span>
                <span className="item-main">
                  <span className="item-title" style={{ display: 'block' }}>
                    {it.title}
                  </span>
                  <span className="item-sub" style={{ display: 'block' }}>
                    {it.text}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NewsScreen() {
  return (
    <Page title="Novedades" back="/ayuda">
      <Card>
        <NewsList />
      </Card>
    </Page>
  );
}

/**
 * Muestra las novedades una vez después de actualizar. En una instalación nueva (sin datos) no se muestran.
 * No se muestran en modo práctica.
 */
export function NewsHost() {
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || practice || APP_VERSION === 'dev') return;
    decided.current = true;
    void (async () => {
      const seen = (await db.meta.get('lastSeenVersion'))?.value ?? null;
      if (seen && compareVersions(APP_VERSION, seen) <= 0) return;
      const hasData = (await db.inventories.count()) > 0;
      if (!seen && !hasData) {
        await db.meta.put({ key: 'lastSeenVersion', value: APP_VERSION });
        return;
      }
      const pending = CHANGELOG.some((e) => compareVersions(e.version, seen ?? '0') > 0 && compareVersions(e.version, APP_VERSION) <= 0);
      if (pending) setSince(seen ?? '0');
      else await db.meta.put({ key: 'lastSeenVersion', value: APP_VERSION });
    })();
  }, []);
  if (since === undefined || since === null) return null;
  const close = () => {
    void db.meta.put({ key: 'lastSeenVersion', value: APP_VERSION });
    setSince(undefined);
  };
  return (
    <Sheet
      title="¡Novedades!"
      onClose={close}
      footer={
        <>
          <button className="btn primary block" onClick={close} data-testid="news-ok">
            Entendido
          </button>
          <button
            className="btn block"
            onClick={() => {
              close();
              navigate('/ayuda');
            }}
          >
            Ver la ayuda
          </button>
        </>
      }
    >
      <p className="small muted">Tus datos se conservaron y se convirtieron automáticamente a la nueva versión.</p>
      <NewsList since={since} />
    </Sheet>
  );
}

/* ---------------- Primeros pasos ---------------- */

interface Step {
  id: string;
  title: string;
  hint: string;
  to: string;
  done: boolean;
}

function useSteps(): Step[] | undefined {
  return useLive(async (d) => {
    const [invs, contributions, movs, sales, prices, lastBackup] = await Promise.all([
      d.inventories.count(),
      d.capital.filter((c) => c.status === 'active' && c.kind === 'contribution').count(),
      d.movements.filter((m) => m.type === 'initial' || m.type === 'purchase').count(),
      d.sales.count(),
      d.marketPrices.count(),
      d.meta.get('lastBackupAt'),
    ]);
    return [
      { id: 'inventory', title: 'Crea tu inventario', hint: 'Dónde guardas tus productos.', to: '/inventarios', done: invs > 0 },
      { id: 'capital', title: 'Registra con cuánto dinero empiezas', hint: 'Capital → Aporte. Así la app calcula tu caja y tu crecimiento.', to: '/capital', done: contributions > 0 },
      { id: 'stock', title: 'Ingresa tu mercancía o una compra', hint: 'Lo que ya tienes (stock existente) o lo que compres.', to: '/stock/nuevo', done: movs > 0 },
      { id: 'sale', title: 'Registra una venta', hint: 'Verás el precio sugerido y tu ganancia.', to: '/ventas/nueva', done: sales > 0 },
      { id: 'prices', title: 'Anota un precio de mercado', hint: 'Lo que ves en Marketplace para tus modelos.', to: '/precios', done: prices > 0 },
      { id: 'backup', title: 'Haz tu primer respaldo', hint: 'Y guárdalo fuera del teléfono.', to: '/respaldo', done: !!lastBackup },
      { id: 'help', title: 'Mira la ayuda', hint: 'Manual, "?" en cada pantalla y modo práctica.', to: '/ayuda', done: getPref('helpVisited', '') === '1' },
    ];
  });
}

/** Lista de primeros pasos. En Inicio se oculta cuando terminas o si la ocultas; en Ayuda siempre se ve. */
export function GettingStartedCard({ always = false }: { always?: boolean }) {
  const steps = useSteps();
  const settings = useLive((d) => getSettings(d));
  if (!steps || !settings) return null;
  const done = steps.filter((s) => s.done).length;
  if (!always && (!settings.showGettingStarted || done === steps.length)) return null;
  return (
    <Card
      title={<h2>Primeros pasos</h2>}
      action={
        !always ? (
          <button className="btn sm" onClick={() => void updateSettings(db, { showGettingStarted: false })}>
            Ocultar
          </button>
        ) : undefined
      }
    >
      <div className="stack-sm" data-testid="getting-started">
        <p className="small muted">
          {done} de {steps.length} listos{done === steps.length ? ' · ¡Todo listo!' : ''}
        </p>
        <Progress value={done / steps.length} label="Primeros pasos" />
        <ul className="list checklist wrap-sub">
          {steps.map((s) => (
            <li key={s.id}>
              <a className="item" href={`#${s.to}`} style={{ padding: '8px 0' }}>
                <span className={s.done ? 'check-done' : 'check-todo'} aria-hidden="true">
                  {s.done ? <Icon name="check" size={16} /> : null}
                </span>
                <span className="item-main">
                  <span className={`item-title ${s.done ? 'muted' : ''}`} style={{ display: 'block', textDecoration: s.done ? 'line-through' : undefined }}>
                    {s.title}
                    <span className="sr-only">{s.done ? ' (hecho)' : ' (pendiente)'}</span>
                  </span>
                  {!s.done ? (
                    <span className="item-sub" style={{ display: 'block' }}>
                      {s.hint}
                    </span>
                  ) : null}
                </span>
                {!s.done ? <Icon name="chevron" size={16} /> : null}
              </a>
            </li>
          ))}
        </ul>
        {!always && !settings.showGettingStarted ? null : always && !settings.showGettingStarted ? (
          <button className="btn sm" onClick={() => void updateSettings(db, { showGettingStarted: true })}>
            Mostrar en Inicio
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/* ---------------- Modo práctica ---------------- */

function PracticeCard() {
  const on = isPracticeMode();
  return (
    <Card title={<h2>Modo práctica</h2>}>
      <div className="stack-sm">
        <p className="small">
          {on
            ? 'Estás en modo práctica: todo lo que hagas usa datos de ejemplo en una base aparte. Tus datos reales no se tocan.'
            : 'Practica con un negocio de ejemplo (compras, ventas, deudas, capital…) en una base de datos aparte. Tus datos reales no se tocan.'}
        </p>
        <div className="actions">
          {on ? (
            <>
              <button className="btn primary" onClick={() => setPracticeMode(false)} data-testid="practice-exit">
                Salir del modo práctica
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (!(await confirmAction({ title: 'Reiniciar práctica', message: <p>Se borran los datos de práctica y se vuelven a crear los de ejemplo.</p>, confirmText: 'Reiniciar' }))) return;
                  db.close();
                  await indexedDB.deleteDatabase(PRACTICE_DB);
                  location.hash = '#/';
                  location.reload();
                }}
              >
                Reiniciar práctica
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => setPracticeMode(true)} data-testid="practice-enter">
              <Icon name="play" /> Entrar al modo práctica
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PracticeBanner(): ReactNode {
  if (!practice) return null;
  return (
    <div className="practice-banner" role="status" data-testid="practice-banner">
      <span>
        <strong>Modo práctica</strong> · datos de ejemplo
      </span>
      <button className="btn sm" onClick={() => setPracticeMode(false)}>
        Salir
      </button>
    </div>
  );
}

export function HelpLoading() {
  return <Loading />;
}
