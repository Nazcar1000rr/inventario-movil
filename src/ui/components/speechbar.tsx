import { setMuted, stopSpeaking, useSpeech } from '../speech';
import { toast } from '../store';
import { Icon } from './Icon';

/**
 * Mientras la app lee en voz alta aparece arriba esta barrita: «Callar» corta solo esta lectura y
 * «Silenciar» apaga la lectura automática en toda la app (se vuelve a prender con la bocina 🔊).
 */
export function SpeechBar() {
  const sp = useSpeech();
  if (!sp.speaking) return null;
  return (
    <div className="speech-bar" role="region" aria-label="Lectura en voz alta" data-testid="speech-bar" data-sound="none">
      <span className="speech-dot" aria-hidden="true">
        <Icon name="volume" size={16} />
      </span>
      <span className="speech-label">Leyendo</span>
      <button type="button" className="speech-btn" onClick={() => stopSpeaking()} data-testid="speech-stop" aria-label="Callar esta lectura">
        <Icon name="stop" size={14} /> Callar
      </button>
      {!sp.muted ? (
        <button
          type="button"
          className="speech-btn"
          data-testid="speech-mute"
          aria-label="Silenciar la voz en toda la app"
          onClick={() => {
            setMuted(true);
            toast('Voz silenciada. Para volver a oírla, toca la bocina 🔊', 'ok', 4500);
          }}
        >
          <Icon name="mute" size={14} /> Silenciar
        </button>
      ) : null}
    </div>
  );
}
