import { useEffect } from 'react';
import { checkSpeechSupport, setMuted, speak, useSpeech } from '../speech';
import { Icon } from './Icon';

/**
 * Botón de bocina: 🔊 lee en voz alta (y al tocarlo se silencia), 🔇 silenciado (al tocarlo vuelve a leer `text`).
 * El silencio es general: vale para recorridos, explicaciones, ayuda y lecciones.
 */
export function SpeakerToggle({ text, className = '' }: { text?: string; className?: string }) {
  const sp = useSpeech();
  useEffect(() => {
    void checkSpeechSupport();
  }, []);
  if (sp.supported === false) return null;
  return (
    <button
      type="button"
      className={`icon-btn speaker ${sp.speaking && !sp.muted ? 'is-speaking' : ''} ${className}`}
      aria-label={sp.muted ? 'Activar la lectura en voz alta' : 'Silenciar la lectura en voz alta'}
      aria-pressed={!sp.muted}
      data-testid="speaker"
      data-sound="none"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (sp.muted) {
          setMuted(false);
          if (text) speak(text);
        } else setMuted(true);
      }}
    >
      <Icon name={sp.muted ? 'mute' : 'volume'} />
    </button>
  );
}

/** Botón "Escuchar" para leer un texto suelto (consejos), aunque la lectura automática esté silenciada. */
export function ListenButton({ text, label = 'Escuchar' }: { text: string; label?: string }) {
  const sp = useSpeech();
  useEffect(() => {
    void checkSpeechSupport();
  }, []);
  if (sp.supported === false) return null;
  return (
    <button type="button" className="btn sm" data-sound="none" data-testid="listen" onClick={() => speak(text, { force: true })}>
      <Icon name="volume" size={18} /> {label}
    </button>
  );
}
