import { useState, type ReactNode } from 'react';
import { findArticle, METRICS, SCREEN_HELP } from '../help/content';
import { navigate } from '../router';
import { Icon } from './Icon';
import { Sheet } from './ui';

/** Botón ⓘ que explica qué significa un número y cómo se calcula. */
export function InfoTip({ k, label }: { k: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const m = METRICS[k];
  if (!m) return null;
  return (
    <>
      <button
        type="button"
        className="info-tip"
        aria-label={`¿Qué es ${label ?? m.title}?`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="info" size={15} />
      </button>
      {open ? (
        <Sheet title={m.title} onClose={() => setOpen(false)}>
          <div className="stack">
            <p>{m.what}</p>
            {m.formula ? (
              <div className="formula">
                <span className="tiny muted">Cómo se calcula</span>
                <p>{m.formula}</p>
              </div>
            ) : null}
            {m.note ? <p className="small muted">{m.note}</p> : null}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** Etiqueta con su ⓘ (para tablas clave-valor). */
export function L({ children, k }: { children: ReactNode; k: string }) {
  return (
    <span className="with-tip">
      {children} <InfoTip k={k} label={typeof children === 'string' ? children : undefined} />
    </span>
  );
}

/** Botón "?" de la barra superior: ayuda de la pantalla y artículos relacionados del manual. */
export function HelpButton({ helpKey }: { helpKey: string }) {
  const [open, setOpen] = useState(false);
  const h = SCREEN_HELP[helpKey];
  if (!h) return null;
  return (
    <>
      <button className="icon-btn" type="button" aria-label={`Ayuda: ${h.title}`} onClick={() => setOpen(true)} data-testid="help-btn">
        <Icon name="help" />
      </button>
      {open ? (
        <Sheet title={`Ayuda · ${h.title}`} onClose={() => setOpen(false)}>
          <div className="stack">
            <p>{h.intro}</p>
            <div className="stack-sm">
              {h.articles
                .map((id) => findArticle(id))
                .filter((a) => !!a)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/ayuda/${a.id}`);
                    }}
                  >
                    <Icon name="book" />
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>
                        {a.title}
                      </span>
                      <span className="small muted">{a.summary}</span>
                    </span>
                  </button>
                ))}
            </div>
            <button
              type="button"
              className="btn block"
              onClick={() => {
                setOpen(false);
                navigate('/ayuda');
              }}
            >
              <Icon name="search" /> Buscar en el manual
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
