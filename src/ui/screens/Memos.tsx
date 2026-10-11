import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteMemo, formatDate, memoShareText, memoTitle, newOpId, restoreMemo, saveMemo, setMemoPinned, sortMemos, type Memo } from '../../core';
import { Icon } from '../components/Icon';
import { Card, Empty, Field, FormError, Loading, Page, Sheet, TextInput } from '../components/ui';
import { navigate, useRoute } from '../router';
import { shareText } from '../platform';
import { db, toast, useAction, useLive } from '../store';

/** Nota nueva o una existente que se está editando. */
type Editing = Memo | 'new' | null;

export function MemosScreen() {
  const route = useRoute();
  const memos = useLive((d) => d.memos.toArray());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [undo, setUndo] = useState<Memo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantNew = route.query.get('nueva') === '1';
  useEffect(() => {
    if (!wantNew) return;
    setEditing('new');
    navigate('/notas', { replace: true });
  }, [wantNew]);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);
  const list = useMemo(() => sortMemos(memos ?? [], q), [memos, q]);

  const onDeleted = (m: Memo) => {
    setUndo(m);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };

  return (
    <Page title="Notas" back="/mas" help="memos">
      <button type="button" className="btn primary block" onClick={() => setEditing('new')} data-testid="memo-new">
        <Icon name="plus" /> Nueva nota
      </button>
      {undo ? (
        <div className="notice row" role="status" data-testid="memo-undo" style={{ alignItems: 'center' }}>
          <span className="grow small">Nota borrada: {memoTitle(undo)}</span>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              await restoreMemo(db, undo);
              setUndo(null);
              toast('Nota recuperada');
            }}
          >
            <Icon name="undo" size={16} /> Deshacer
          </button>
        </div>
      ) : null}
      {memos && memos.length > 3 ? (
        <TextInput type="search" placeholder="Buscar en tus notas" aria-label="Buscar en tus notas" value={q} onChange={(e) => setQ(e.target.value)} data-testid="memo-search" />
      ) : null}
      {!memos ? (
        <Loading />
      ) : !memos.length ? (
        <Empty icon="note" title="Todavía no tienes notas">
          <p className="small muted">Anota pedidos, ideas, listas de compra, datos de un cliente o lo que no quieras olvidar. Si algo tiene fecha, pásalo al calendario para que te avise.</p>
        </Empty>
      ) : (
        <Card flush>
          {!list.length ? (
            <Empty icon="search" title="Ninguna nota tiene esas palabras" />
          ) : (
            <ul className="list memo-list" data-testid="memo-list">
              {list.map((m) => (
                <li key={m.id}>
                  <button type="button" className="item memo-item" onClick={() => setEditing(m)}>
                    <span className="item-main">
                      <span className="item-title memo-title">
                        {m.pinned ? (
                          <span className="memo-pin" title="Fijada arriba">
                            <Icon name="pin" size={14} />
                            <span className="sr-only">Fijada: </span>
                          </span>
                        ) : null}
                        {memoTitle(m)}
                      </span>
                      {m.title && m.text ? <span className="item-sub memo-preview">{m.text}</span> : null}
                      <span className="item-sub tiny">{m.updatedAt === m.createdAt ? 'Creada' : 'Editada'} el {formatDate(m.updatedAt)}</span>
                    </span>
                    <Icon name="chevron" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <p className="small muted">Las notas se guardan solo en este teléfono y viajan en el respaldo.</p>
      {editing ? <MemoSheet memo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDeleted={onDeleted} /> : null}
    </Page>
  );
}

function MemoSheet({ memo, onClose, onDeleted }: { memo: Memo | null; onClose: () => void; onDeleted: (m: Memo) => void }) {
  const [title, setTitle] = useState(memo?.title ?? '');
  const [text, setText] = useState(memo?.text ?? '');
  const [pinned, setPinned] = useState(memo?.pinned ?? false);
  const [opId] = useState(newOpId);
  const act = useAction();
  const dirty = !memo ? !!(title.trim() || text.trim()) || pinned : title !== memo.title || text !== memo.text;

  const save = async () => {
    const r = await act.run(() => saveMemo(db, { id: memo?.id, opId: memo ? undefined : opId, title, text, pinned }), memo ? 'Nota actualizada' : 'Nota guardada');
    if (r !== undefined) onClose();
  };

  return (
    <Sheet
      title={memo ? 'Nota' : 'Nueva nota'}
      onClose={onClose}
      footer={
        <button type="button" className="btn primary block" disabled={act.busy || (!!memo && !dirty && pinned === memo.pinned)} onClick={() => void save()} data-testid="save-memo">
          Guardar
        </button>
      }
    >
      <Field label="Título (opcional)" htmlFor="mm-title">
        <TextInput id="mm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Pedido de Andrés, ideas para vender más" maxLength={80} />
      </Field>
      <Field label="Nota" htmlFor="mm-text" error={act.field === 'text' ? act.error : null}>
        <textarea id="mm-text" className="input memo-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe aquí…" maxLength={5000} data-autofocus={!memo || undefined} />
      </Field>
      <label className="check small">
        <input
          type="checkbox"
          checked={pinned}
          onChange={async (e) => {
            setPinned(e.target.checked);
            if (memo) await setMemoPinned(db, memo.id, e.target.checked);
          }}
          data-testid="memo-pin"
        />{' '}
        Fijar arriba
      </label>
      {act.field !== 'text' ? <FormError error={act.error} /> : null}
      {memo ? (
        <div className="row wrap" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              const r = await shareText(memoShareText({ title, text }), 'Compartir nota');
              if (r === 'copied') toast('Nota copiada');
            }}
          >
            <Icon name="share" size={16} /> Compartir
          </button>
          <button
            type="button"
            className="btn sm"
            data-testid="memo-to-calendar"
            onClick={() => {
              const params = new URLSearchParams({ nueva: '1', titulo: memoTitle({ title, text }), desc: title ? text : text.split('\n').slice(1).join('\n').trim() });
              onClose();
              navigate(`/calendario?${params.toString()}`);
            }}
          >
            <Icon name="clock" size={16} /> Ponerle fecha y aviso
          </button>
          <button
            type="button"
            className="btn sm danger"
            data-testid="memo-delete"
            onClick={async () => {
              const gone = await deleteMemo(db, memo.id);
              onClose();
              if (gone) onDeleted(gone);
            }}
          >
            <Icon name="trash" size={16} /> Borrar
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
