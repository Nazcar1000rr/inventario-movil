import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { navigate, useRoute } from './router';
import { playSound } from './sound';
import { getPref, setPref, toast } from './store';
import { stopSpeaking, useAutoSpeak } from './speech';
import { celebrate } from './theme';
import { SpeakerToggle } from './components/speaker';
import { Icon } from './components/Icon';

/**
 * RECORRIDOS GUIADOS (v2.1): resaltan partes reales de la app, paso a paso, y explican para qué sirven.
 * Cada paso puede llevarte a otra pantalla. El avance se guarda solo en este teléfono.
 */

export interface TourStep {
  /** Pantalla donde está el paso (se navega sola). */
  route?: string;
  /** Elemento a resaltar: valor de data-tour (o un selector CSS si empieza con [ . #). */
  target?: string;
  title: string;
  text: string;
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  steps: TourStep[];
  /** Al terminar: botón para hacerlo de verdad. */
  finish?: { label: string; to: string };
}

export const TOURS: Tour[] = [
  {
    id: 'app',
    title: 'Conoce la app',
    summary: 'Dónde está cada cosa: Inicio, el botón +, inventarios, operaciones y la ayuda.',
    minutes: 1,
    steps: [
      { route: '/', title: '¡Hola! Te muestro la app', text: 'Es un recorrido de un minuto. Puedes omitirlo cuando quieras con «Omitir» y repetirlo desde Ayuda → Recorridos guiados.' },
      { route: '/', target: 'kpis', title: 'Tu resumen', text: 'Aquí ves lo que vendiste, lo que ganaste y lo que te deben en el periodo elegido. Cambia el periodo arriba (hoy, semana, mes…).' },
      { route: '/', target: 'quick', title: 'El botón +', text: 'Desde aquí registras todo: ventas, compras, gastos (del negocio, del viaje o personales), stock que ya tenías y más.' },
      { route: '/', target: 'nav-inventarios', title: 'Inventarios', text: 'Tus productos y existencias. Toca un producto para ver sus unidades, sus lotes por precio y lo que has pagado por él.' },
      { route: '/', target: 'nav-operaciones', title: 'Operaciones', text: 'Todas tus ventas, compras y gastos, con lo que te deben por cobrar.' },
      { route: '/', target: 'nav-mas', title: 'Más', text: 'Todo lo demás, ordenado por categorías: análisis e informes, clientes y cobros (me deben, preguntones), compras, tu plata (capital, deudas, gastos personales), notas y calendario, la ayuda y la configuración.' },
      { route: '/', target: 'home-inquiries', title: 'Preguntones', text: 'Cada vez que alguien te pregunte y no compre, toca «+1 Preguntón». Si vuelve y compra, toca «Me compró». Así sabes cuántas personas preguntan por cada venta.' },
      { route: '/', target: '[data-testid="help-btn"]', title: 'El botón ?', text: 'En cada pantalla te explica qué hace y te lleva al manual. Y donde veas ⓘ junto a un número, tócalo: te dice qué significa y cómo se calcula.' },
      { route: '/aprende', target: 'learn-list', title: 'Aprende de negocios', text: 'Lecciones cortas con ejemplos, calculadoras y preguntas: costo, margen, ganancia, caja, capital y más. Ideales si estás empezando.' },
      { title: '¡Listo!', text: 'Ya conoces lo básico. Te recomiendo el recorrido "Tu primera compra" y, si quieres practicar sin miedo, el Modo práctica en Ayuda.' },
    ],
    finish: { label: 'Recorrido: tu primera compra', to: 'tour:first-purchase' },
  },
  {
    id: 'first-purchase',
    title: 'Tu primera compra',
    summary: 'Cómo registrar mercancía que compras: producto, precio, gastos y cómo la pagaste.',
    minutes: 2,
    steps: [
      { route: '/compras/nueva', title: 'Registrar una compra', text: 'Cada vez que compres mercancía, regístrala aquí. Así la app sabe cuánto te costó cada cosa y puede calcular tu ganancia real.' },
      { route: '/compras/nueva', target: 'pu-product', title: 'Elige el producto', text: 'Toca aquí para buscarlo o crearlo. Por ejemplo "Audífonos Bluetooth" o un iPhone del catálogo.' },
      { route: '/compras/nueva', target: 'pu-qty-price', title: 'Cantidad y precio', text: 'Escribe cuántas compraste y cuánto pagaste por cada una (o el total). Al elegir el producto verás cuánto pagaste la última vez y si ahora te salió más barato.' },
      { route: '/compras/nueva', target: 'pu-extra', title: 'Gastos de la compra', text: 'Transporte, envío… se suman al costo. Si hiciste varias compras en el mismo viaje, registra el pasaje una sola vez después y repártelo entre todas.' },
      { route: '/compras/nueva', target: 'pu-pay', title: '¿Cómo la pagaste?', text: 'Con la plata del negocio (la caja) o con tarjeta de crédito, crédito del proveedor o un préstamo. Si es deuda, la app la anota en Deudas.' },
      { route: '/compras/nueva', target: 'pu-submit', title: 'Revisa y registra', text: 'Antes de guardar verás un resumen. Si compras más barato que lo que ya tenías, la app te avisa cuánto te costaron las anteriores y su precio mínimo.' },
      { title: 'Lotes por precio', text: 'Cada compra de accesorios queda en su propio lote con su precio. Al vender sale primero lo más antiguo, así tu ganancia es exacta. Puedes apagarlo en la ficha del producto.' },
    ],
    finish: { label: 'Registrar mi primera compra', to: '/compras/nueva' },
  },
  {
    id: 'first-sale',
    title: 'Tu primera venta',
    summary: 'Cómo vender: producto, precio sugerido, avisos de precio y cómo te pagaron.',
    minutes: 2,
    steps: [
      { route: '/ventas/nueva', title: 'Registrar una venta', text: 'Cada venta saca la mercancía del inventario y suma a tus ingresos. La app calcula tu ganancia con el costo real.' },
      { route: '/ventas/nueva', target: 'sa-product', title: 'Elige lo que vendes', text: 'Busca el producto. En teléfonos puedes elegir la unidad exacta; si no, sale la más antigua.' },
      { route: '/ventas/nueva', target: 'sa-qty-price', title: 'Precio de venta', text: 'Al elegir el producto verás su costo, tu precio mínimo y un precio sugerido. Si vendes por debajo del costo, la app te avisa.' },
      { route: '/ventas/nueva', target: 'sa-pay', title: '¿Cómo te pagaron?', text: 'Completo, una parte (abono) o pendiente. Lo que falte queda "por cobrar". Si pagan con datáfono, la comisión se registra sola.' },
      { route: '/ventas/nueva', target: 'sa-submit', title: 'Revisa y registra', text: 'Verás el resumen con la ganancia estimada antes de guardar. Una doble pulsación no duplica la venta.' },
    ],
    finish: { label: 'Registrar una venta', to: '/ventas/nueva' },
  },
  {
    id: 'capital',
    title: 'Entiende tu capital',
    summary: 'Cuánto vale tu negocio, cuánto has puesto, cuánto ha crecido y dónde está tu plata.',
    minutes: 2,
    steps: [
      { route: '/capital', title: 'Tu capital', text: 'Aquí ves si tu negocio está creciendo de verdad, separando la plata que tú pones de la que el negocio gana.' },
      { route: '/capital', target: 'cap-kpis', title: 'Valor y crecimiento', text: 'Valor del negocio = caja + mercancía + lo que te deben − lo que debes. El crecimiento es lo que ganó el negocio por sí mismo. Toca ⓘ para ver cada fórmula.' },
      { route: '/capital', target: 'cap-actions', title: 'Aportes, retiros y préstamos a ti', text: 'Registra la plata con la que empiezas (Aporte). Si sacas plata para ti, usa Retiro o Préstamo a ti; para gustos y gastos hormiga, Gastos personales.' },
      { route: '/personal', target: 'personal-month', title: 'Gastos personales', text: 'La plata del negocio es del negocio. Aquí ves cuánto has sacado este mes frente a lo que el negocio ganó.' },
      { title: 'Consejo', text: 'Si cada mes sacas menos de lo que el negocio gana, tu capital crece. Si sacas más, te estás comiendo la plata para comprar mercancía.' },
    ],
    finish: { label: 'Lección: caja no es ganancia', to: '/aprende/caja' },
  },
  {
    id: 'analysis',
    title: 'Análisis del negocio',
    summary: 'Salud del negocio, lo que esperas ganar, expectativas, tendencias, tiempo de venta, preguntones y calendario.',
    minutes: 2,
    steps: [
      { route: '/analisis?tab=resumen', title: 'Análisis del negocio', text: 'Aquí ves cómo va tu negocio con gráficas y tablas exactas. Toca una barra para ver su valor y «Ver los números» para la tabla.' },
      { route: '/analisis?tab=resumen', target: 'analysis-filters', title: 'Inventario y sección', text: 'Elige el inventario y la sección: resumen, lo que esperas ganar, expectativas, tendencias, productos, tiempo de venta, flujo de dinero, días y preguntones.' },
      { route: '/analisis?tab=resumen', target: 'analysis-health', title: 'Salud del negocio', text: 'Un puntaje de 0 a 100 con cinco partes: margen, tendencia, rotación, plata quieta y deudas. Cada parte trae un consejo.' },
      { route: '/analisis?tab=esperas', target: 'analysis-outlook', title: 'Lo que esperas ganar', text: 'Cuánto ganarías si vendes todo lo que tienes a tus precios, al ritmo de tus ventas y cuánto valdría tu negocio a futuro.' },
      { route: '/analisis?tab=metas', target: 'analysis-exp-month', title: 'Expectativas', text: 'La app te propone cuánto esperar ganar este mes y esta semana (y la puedes cambiar). La rayita negra muestra a dónde llegarías al ritmo actual.' },
      { route: '/analisis?tab=tendencias', target: 'analysis-trends', title: 'Tendencias', text: 'Tus últimos 12 meses o 12 semanas. Elige qué ver: ganancia, ventas, margen, unidades o gastos. Abajo, este mes frente al pasado.' },
      { route: '/analisis?tab=tiempo', target: 'analysis-selltime', title: 'Tiempo de venta', text: 'Cuántos días te demoras en promedio en vender, por producto y mes a mes.' },
      { route: '/preguntones', target: 'inquiry-counter', title: 'Preguntones', text: 'El contador de los que preguntan y no compran, con su análisis semanal y mensual.' },
      { route: '/calendario', target: 'calendar-month', title: 'Calendario', text: 'Anota pagos y pendientes, y elige cuántos días antes te avisa.' },
    ],
    finish: { label: 'Lección: expectativas', to: '/aprende/expectativas' },
  },
];

/* ---------------- Estado ---------------- */

let active: { tour: Tour; step: number } | null = null;
let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function startTour(id: string): void {
  const tour = TOURS.find((t) => t.id === id);
  if (!tour) return;
  setPref('tourOffer', 'done');
  active = { tour, step: 0 };
  emit();
}
export function endTour(completed: boolean): void {
  if (active && completed) {
    setPref(`tour:${active.tour.id}`, 'done');
    playSound('achievement');
    celebrate();
  }
  stopSpeaking();
  active = null;
  emit();
}
/** «Omitir»: cierra el recorrido y no lo vuelve a ofrecer (se puede repetir desde Ayuda). */
export function skipTour(): void {
  if (!active) return;
  if (!isTourDone(active.tour.id)) setPref(`tour:${active.tour.id}`, 'skipped');
  endTour(false);
  toast('Recorrido omitido. Lo repites cuando quieras en Ayuda → Recorridos guiados.', 'ok', 4500);
}
export function isTourDone(id: string): boolean {
  return getPref(`tour:${id}`, '') === 'done';
}
export function isTourSkipped(id: string): boolean {
  return getPref(`tour:${id}`, '') === 'skipped';
}

/** «No mostrarme recorridos»: Inicio deja de ofrecerlos (igual puedes abrirlos desde Ayuda). */
export function toursOff(): boolean {
  return getPref('tours:off', '') === '1';
}
export function setToursOff(off: boolean): void {
  setPref('tours:off', off ? '1' : '');
  if (off && active) endTour(false);
  emit();
}

/** Repetir primeros pasos: borra el avance de los recorridos, vuelve a ofrecerlos y empieza «Conoce la app». */
export function restartFirstSteps(): void {
  for (const t of TOURS) setPref(`tour:${t.id}`, '');
  setPref('tourOffer', '');
  setPref('tours:off', '');
  startTour('app');
}

/** Para pantallas que muestran el estado de los recorridos. */
export function useToursVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}
function go(step: number) {
  if (!active) return;
  active = { ...active, step };
  emit();
}
function useActive() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => active,
  );
}

function findTarget(t: string): HTMLElement | null {
  const sel = /^[[.#]/.test(t) ? t : `[data-tour="${t}"]`;
  const all = Array.from(document.querySelectorAll<HTMLElement>(sel));
  return all.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) ?? null;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/* ---------------- Capa del recorrido ---------------- */

export function TourHost() {
  const st = useActive();
  const route = useRoute();
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const step = st ? st.tour.steps[st.step] : null;
  const spoken = step ? `${step.title}. ${step.text}` : '';
  useAutoSpeak(spoken, !!step);

  // Ir a la pantalla del paso
  useEffect(() => {
    if (step?.route && route.path !== step.route.split('?')[0]) navigate(step.route);
  }, [step, route.path]);

  // Buscar y seguir el elemento resaltado
  useEffect(() => {
    setRect(null);
    setMissing(false);
    if (!step?.target) return;
    let raf = 0;
    let tries = 0;
    let scrolled = false;
    let last = '';
    const tick = () => {
      const el = findTarget(step.target!);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        const key = `${Math.round(r.top)}|${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}`;
        if (key !== last) {
          last = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      } else if (++tries > 120) {
        setMissing(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, route.path]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step, rect]);

  useEffect(() => {
    if (!st) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skipTour();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [st]);

  if (!st || !step) return null;
  const { tour } = st;
  const last = st.step === tour.steps.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;
  const hole = rect && !missing ? { top: Math.max(0, rect.top - pad), left: Math.max(0, rect.left - pad), width: Math.min(vw, rect.width + pad * 2), height: rect.height + pad * 2 } : null;
  const cardW = Math.min(360, vw - 24);
  let cardTop = vh / 2 - cardH / 2;
  let cardLeft = (vw - cardW) / 2;
  if (hole) {
    const below = hole.top + hole.height + 10;
    const above = hole.top - 10 - cardH;
    cardTop = below + cardH < vh - 8 ? below : above > 8 ? above : Math.max(8, vh - cardH - 8);
    cardLeft = Math.min(Math.max(12, hole.left + hole.width / 2 - cardW / 2), vw - cardW - 12);
  }
  const block = (style: React.CSSProperties, k: string) => <div key={k} className="tour-block" style={style} onClick={(e) => e.stopPropagation()} />;
  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour" data-sound="none">
      {hole ? (
        <>
          {block({ top: 0, left: 0, width: vw, height: hole.top }, 't')}
          {block({ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) }, 'b')}
          {block({ top: hole.top, left: 0, width: hole.left, height: hole.height }, 'l')}
          {block({ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height }, 'r')}
          <div className="tour-hole" style={hole} />
        </>
      ) : (
        block({ top: 0, left: 0, width: vw, height: vh }, 'all')
      )}
      <div ref={cardRef} key={`${tour.id}-${st.step}`} className="tour-card" style={{ top: cardTop, left: cardLeft, width: cardW }}>
        <p className="tiny muted">
          {tour.title} · paso {st.step + 1} de {tour.steps.length}
        </p>
        <h2 id="tour-title" className="tour-title">
          {step.title}
        </h2>
        <p className="small">{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {tour.steps.map((_, i) => (
            <span key={i} className={i === st.step ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="btn sm" onClick={() => skipTour()} data-testid="tour-skip" aria-label="Omitir el recorrido">
            <Icon name="skip" size={16} /> Omitir
          </button>
          <SpeakerToggle text={spoken} />
          <span className="grow" />
          {st.step > 0 ? (
            <button type="button" className="btn sm" onClick={() => go(st.step - 1)}>
              Atrás
            </button>
          ) : null}
          {last ? (
            <button
              type="button"
              className="btn sm primary"
              data-testid="tour-next"
              onClick={() => {
                const fin = tour.finish;
                endTour(true);
                if (fin) {
                  if (fin.to.startsWith('tour:')) startTour(fin.to.slice(5));
                }
              }}
            >
              {tour.finish?.to.startsWith('tour:') ? 'Siguiente recorrido' : 'Terminar'}
            </button>
          ) : (
            <button
              type="button"
              className="btn sm primary"
              data-testid="tour-next"
              onClick={() => {
                playSound('tap');
                go(st.step + 1);
              }}
            >
              Siguiente
            </button>
          )}
        </div>
        {last && tour.finish?.to.startsWith('tour:') ? (
          <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => endTour(true)} data-testid="tour-finish-here">
            Terminar aquí (sin el siguiente recorrido)
          </button>
        ) : null}
        {last && tour.finish && !tour.finish.to.startsWith('tour:') ? (
          <button
            type="button"
            className="btn block"
            style={{ marginTop: 8 }}
            onClick={() => {
              const to = tour.finish!.to;
              endTour(true);
              navigate(to);
            }}
          >
            {tour.finish.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
