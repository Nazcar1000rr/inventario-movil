import { useState } from 'react';
import { COLLECTION_TONE_LABEL, updateCustomer, whatsappLink, whatsappNumber, type CollectionTone, type ID } from '../../core';
import { openExternal } from '../platform';
import { db, toast } from '../store';
import { Icon } from './Icon';
import { Field, Sheet, TextInput } from './ui';

/**
 * COBRAR POR WHATSAPP (v2.3): escribes (o eliges y cambias) el mensaje y la app abre el chat de esa persona en
 * WhatsApp con el texto listo. La app no envía nada: tú lo revisas y lo envías desde WhatsApp.
 */
export function WhatsAppSheet({
  name,
  phone,
  customerId,
  build,
  hasDetail,
  onClose,
}: {
  name: string;
  phone: string;
  customerId: ID | null;
  /** Mensaje de ejemplo según el tono y si lleva el detalle de lo que debe. */
  build: (tone: CollectionTone, detail: boolean) => string;
  hasDetail: boolean;
  onClose: () => void;
}) {
  const [number, setNumber] = useState(phone);
  const [tone, setTone] = useState<CollectionTone>('amable');
  const [detail, setDetail] = useState(false);
  const [text, setText] = useState(() => build('amable', false));
  const [save, setSave] = useState(!phone.trim());
  const [error, setError] = useState<string | null>(null);
  const changedNumber = number.trim() !== phone.trim();

  const pick = (t: CollectionTone, d: boolean) => {
    setTone(t);
    setDetail(d);
    setText(build(t, d));
  };

  const open = async () => {
    const num = whatsappNumber(number);
    if (!num) {
      setError('Escribe su número de celular (10 dígitos). Si es de otro país, empieza con + y el indicativo.');
      return;
    }
    setError(null);
    if (customerId && save && changedNumber) {
      try {
        await updateCustomer(db, customerId, { phone: number.trim() });
        toast('Número guardado en su ficha');
      } catch {
        /* si no se pudo guardar el número, igual se abre WhatsApp */
      }
    }
    openExternal(whatsappLink(num, text));
    onClose();
  };

  return (
    <Sheet
      title="Cobrar por WhatsApp"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary block" onClick={() => void open()} data-testid="wa-open">
          <Icon name="send" /> Abrir el chat en WhatsApp
        </button>
      }
    >
      <p className="small muted">Escribe el mensaje para {name}. Al tocar el botón se abre su chat en WhatsApp con el mensaje listo; tú lo revisas y lo envías.</p>
      <Field label="Número de WhatsApp" htmlFor="wa-phone" error={error} hint={!error ? 'Celular de Colombia: los 10 dígitos. De otro país: con + y el indicativo.' : undefined}>
        <TextInput id="wa-phone" type="tel" inputMode="tel" autoComplete="off" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej.: 300 123 4567" data-autofocus={!phone.trim() || undefined} />
      </Field>
      {customerId && changedNumber && number.trim() ? (
        <label className="check small">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} data-testid="wa-save" /> Guardar este número en su ficha
        </label>
      ) : null}
      <Field label="Mensaje de ejemplo (luego lo cambias como quieras)">
        <div className="chips wrap" role="group" aria-label="Mensaje de ejemplo">
          {(Object.keys(COLLECTION_TONE_LABEL) as CollectionTone[]).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tone === t} onClick={() => pick(t, detail)} data-testid={`wa-tone-${t}`}>
              {COLLECTION_TONE_LABEL[t]}
            </button>
          ))}
        </div>
      </Field>
      {hasDetail ? (
        <label className="check small">
          <input type="checkbox" checked={detail} onChange={(e) => pick(tone, e.target.checked)} data-testid="wa-detail" /> Incluir lo que debe, una por una
        </label>
      ) : null}
      <Field label="Tu mensaje" htmlFor="wa-text">
        <textarea id="wa-text" className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} data-autofocus={!!phone.trim() || undefined} />
      </Field>
    </Sheet>
  );
}
