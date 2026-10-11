import { Component, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatCOP, formatInt, fromLocalInput, parseMoney, toLocalInput } from '../../core';
import { goBack } from '../router';
import { pushModal, useToasts } from '../store';
import { playSound } from '../sound';
import { HelpButton } from './help';
import { Icon } from './Icon';

/* ================= Página ================= */

export function Page({
  title,
  subtitle,
  back,
  actions,
  help,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string | true;
  actions?: ReactNode;
  /** Clave de ayuda de la pantalla (botón "?"). */
  help?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Inventario`;
  }, [title]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          {back ? (
            <button className="icon-btn" aria-label="Volver" onClick={() => goBack(typeof back === 'string' ? back : '/')}>
              <Icon name="back" />
            </button>
          ) : null}
          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle ? <div className="topbar-sub">{subtitle}</div> : null}
          </div>
          {help ? <HelpButton helpKey={help} /> : null}
          {actions}
        </div>
      </header>
      <div className="content">{children}</div>
    </>
  );
}

export function Card({ title, action, children, flush, tour }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; tour?: string }) {
  return (
    <section className={`card${flush ? ' flush' : ''}`} data-tour={tour}>
      {title || action ? (
        <div className="card-title" style={flush ? { padding: '14px 14px 0' } : undefined}>
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <p className="center muted small">{label}</p>
    </div>
  );
}

export function Empty({ icon = 'box', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <p className="strong">{title}</p>
      {children}
    </div>
  );
}

export function Notice({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; title?: string; children?: ReactNode }) {
  const icon = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert';
  return (
    <div className={`notice ${kind === 'info' ? '' : kind}`} role={kind === 'bad' ? 'alert' : undefined}>
      <span className="notice-icon">
        <Icon name={icon} size={20} />
      </span>
      <div className="notice-body stack-sm">
        {title ? <p className="strong">{title}</p> : null}
        {children ? <div className="small">{children}</div> : null}
      </div>
    </div>
  );
}

export function Badge({ kind, children }: { kind?: 'ok' | 'warn' | 'bad' | 'info' | 'brand'; children: ReactNode }) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={`money ${className ?? ''}`}>{formatCOP(value)}</span>;
}

export function KV({ rows }: { rows: [ReactNode, ReactNode, boolean?][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v, total], i) => (
        <div key={i} className="kv-row">
          <dt className={total ? 'total' : undefined}>{k}</dt>
          <dd className={total ? 'total' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ListItem({
  title,
  sub,
  side,
  icon,
  href,
  onClick,
  chevron = true,
}: {
  title: ReactNode;
  sub?: ReactNode;
  side?: ReactNode;
  icon?: string;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {icon ? (
        <span className="muted">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="item-main">
        <span className="item-title" style={{ display: 'block' }}>
          {title}
        </span>
        {sub ? (
          <span className="item-sub" style={{ display: 'block' }}>
            {sub}
          </span>
        ) : null}
      </span>
      {side ? <span className="item-side">{side}</span> : null}
      {chevron && (href || onClick) ? (
        <span className="muted">
          <Icon name="chevron" size={18} />
        </span>
      ) : null}
    </>
  );
  if (href)
    return (
      <li>
        <a className="item" href={`#${href}`}>
          {inner}
        </a>
      </li>
    );
  if (onClick)
    return (
      <li>
        <button className="item" type="button" onClick={onClick}>
          {inner}
        </button>
      </li>
    );
  return (
    <li>
      <div className="item" style={{ cursor: 'default' }}>
        {inner}
      </div>
    </li>
  );
}

/** Lista con carga por partes para miles de registros. */
export function Paged<T>({ items, render, pageSize = 40, empty }: { items: T[]; render: (x: T) => ReactNode; pageSize?: number; empty?: ReactNode }) {
  const [n, setN] = useState(pageSize);
  if (!items.length) return <>{empty}</>;
  return (
    <>
      <ul className="list">{items.slice(0, n).map(render)}</ul>
      {items.length > n ? (
        <div style={{ padding: 12 }}>
          <button className="btn block" onClick={() => setN(n + pageSize)}>
            Mostrar más ({items.length - n} restantes)
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ================= Formularios ================= */

export function Field({ label, hint, error, children, htmlFor, tour }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; tour?: string }) {
  return (
    <div className="field" data-tour={tour}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <input className={`input ${className ?? ''}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  placeholder = '0',
  ariaLabel,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatInt(value));
  useEffect(() => {
    const cur = parseMoney(text);
    if (cur !== value) setText(value === null ? '' : formatInt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="input-affix" style={invalid ? { borderColor: 'var(--danger)' } : undefined}>
      <span className="affix" aria-hidden="true">
        $
      </span>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => {
          const n = parseMoney(e.target.value);
          const abs = n === null ? null : Math.abs(n);
          setText(abs === null ? '' : formatInt(abs));
          onChange(abs);
        }}
      />
    </div>
  );
}

export function IntInput({
  id,
  value,
  onChange,
  min = 0,
  invalid,
  ariaLabel,
  placeholder,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  invalid?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      className="input"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, '').slice(0, 6);
        if (d === '') onChange(null);
        else onChange(Math.max(min, Number.parseInt(d, 10)));
      }}
    />
  );
}

export function DateTimeInput({ id, value, onChange, invalid }: { id?: string; value: string | null; onChange: (iso: string | null) => void; invalid?: boolean }) {
  return (
    <input
      id={id}
      type="datetime-local"
      className="input"
      aria-invalid={invalid || undefined}
      max={toLocalInput(new Date(Date.now() + 60_000).toISOString())}
      value={toLocalInput(value)}
      onChange={(e) => onChange(fromLocalInput(e.target.value))}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className="chip" aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Notice kind="bad" title="No se pudo guardar">
      {error}
    </Notice>
  );
}

/* ================= Diálogos ================= */

export function Sheet({
  title,
  onClose,
  children,
  footer,
  full,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
}) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unregister = pushModal(() => closeRef.current());
    playSound('open');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = boxRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not(.icon-btn)');
      el?.focus({ preventScroll: true });
    }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      unregister();
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    // Los portales de React propagan eventos por el árbol de componentes: se detiene el envío de
    // formularios internos para que no active el formulario de la pantalla de fondo.
    <div className="overlay" onSubmit={(e) => e.stopPropagation()} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className={`sheet${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" type="button" aria-label="Cerrar" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ---- Confirmaciones imperativas: await ask({...}) ---- */

export interface AskOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  input?: { label: string; initial?: string; placeholder?: string; required?: boolean; mustEqual?: string; multiline?: boolean };
}
interface AskState extends AskOptions {
  resolve: (r: { ok: boolean; value: string }) => void;
}
let askState: AskState | null = null;
const askListeners = new Set<() => void>();
export function ask(opts: AskOptions): Promise<{ ok: boolean; value: string }> {
  return new Promise((resolve) => {
    askState = { ...opts, resolve };
    askListeners.forEach((l) => l());
  });
}
export async function confirmAction(opts: AskOptions): Promise<boolean> {
  return (await ask(opts)).ok;
}

export function AskHost() {
  const state = useSyncExternalStore(
    (cb) => {
      askListeners.add(cb);
      return () => askListeners.delete(cb);
    },
    () => askState,
  );
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(state?.input?.initial ?? '');
  }, [state]);
  if (!state) return null;
  const close = (ok: boolean) => {
    const s = state;
    askState = null;
    askListeners.forEach((l) => l());
    s.resolve({ ok, value: value.trim() });
  };
  const inp = state.input;
  const invalid = !!inp && ((inp.required && !value.trim()) || (inp.mustEqual !== undefined && value.trim() !== inp.mustEqual));
  return (
    <Sheet
      title={state.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className={`btn block ${state.danger ? 'danger' : 'primary'}`} disabled={invalid} onClick={() => close(true)} data-testid="ask-confirm">
            {state.confirmText ?? 'Confirmar'}
          </button>
          <button className="btn block" onClick={() => close(false)}>
            {state.cancelText ?? 'Cancelar'}
          </button>
        </>
      }
    >
      {state.message ? <div className="stack-sm">{state.message}</div> : null}
      {inp ? (
        <div className="field">
          <label htmlFor="ask-input">{inp.label}</label>
          {inp.multiline ? (
            <textarea id="ask-input" className="textarea" data-autofocus value={value} placeholder={inp.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input
              id="ask-input"
              className="input"
              data-autofocus
              value={value}
              placeholder={inp.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !invalid) close(true);
              }}
            />
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---- Menú de acciones (⋮) ---- */

export interface MenuAction {
  label: string;
  icon?: string;
  danger?: boolean;
  hidden?: boolean;
  onSelect: () => void;
}

export function ActionMenu({ title, actions, label = 'Más opciones' }: { title: string; actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const visible = actions.filter((a) => !a.hidden);
  return (
    <>
      <button className="icon-btn" type="button" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="dots" />
      </button>
      {open ? (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className="stack-sm">
            {visible.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`menu-item${a.danger ? ' danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  setTimeout(a.onSelect, 0);
                }}
              >
                {a.icon ? <Icon name={a.icon} /> : null}
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/* ================= Avisos breves ================= */

export function ToastHost() {
  const list = useToasts();
  return (
    <div className="toasts" aria-live="polite" role="status">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={20} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ================= Errores de pantalla ================= */

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="content">
          <Notice kind="bad" title="Ocurrió un error al mostrar esta pantalla">
            <p>{this.state.error.message || 'Error desconocido.'}</p>
            <p className="tiny" style={{ marginTop: 6 }}>
              Tus datos no se modificaron. Puedes volver al inicio o recargar la app.
            </p>
          </Notice>
          <div className="actions">
            <a className="btn" href="#/">
              Ir al inicio
            </a>
            <button className="btn" onClick={() => location.reload()}>
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
