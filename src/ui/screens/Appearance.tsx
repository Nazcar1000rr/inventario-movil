import { useEffect } from 'react';
import { Icon } from '../components/Icon';
import { Card, Field, Notice, Page, Segmented } from '../components/ui';
import { checkSpeechSupport, isNativeVoice, openVoiceInstall, refreshVoices, setMuted, setRate, setVoiceId, speak, useSpeech } from '../speech';
import { ACCENTS, isDark, setAppearance, useAppearance, type Accent } from '../theme';
import { SoundsCard } from './Settings';

const SAMPLE = 'Hola, soy la voz de Inventario Móvil. Así te leeré los recorridos, las explicaciones y las lecciones.';

export function AppearanceScreen() {
  return (
    <Page title="Apariencia, sonidos y voz" back="/mas" help="appearance">
      <AppearanceCard />
      <VoiceCard />
      <SoundsCard />
    </Page>
  );
}

function AppearanceCard() {
  const a = useAppearance();
  const dark = isDark(a);
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reduced = false;
  }
  return (
    <Card title="Apariencia">
      <div className="stack" data-testid="appearance-card">
        <Field label="Modo">
          <Segmented label="Modo" value={a.mode} onChange={(v) => setAppearance({ mode: v })} options={[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']]} />
        </Field>
        <Field label="Color principal">
          <div className="swatches" role="group" aria-label="Color principal">
            {ACCENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="swatch"
                aria-pressed={a.accent === c.id}
                data-testid={`accent-${c.id}`}
                onClick={() => setAppearance({ accent: c.id as Accent })}
              >
                <span className="swatch-dot" style={{ background: dark ? c.dark : c.light }}>
                  {a.accent === c.id ? <Icon name="check" size={18} /> : null}
                </span>
                <span className="small">{c.label}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Estilo de color" hint={a.style === 'gradient' ? 'Encabezados, botones principales y barras con degradado.' : 'Colores planos, más sobrios.'}>
          <Segmented label="Estilo de color" value={a.style} onChange={(v) => setAppearance({ style: v })} options={[['solid', 'Sólido'], ['gradient', 'Degradado']]} />
        </Field>
        <Field
          label="Animaciones"
          hint={a.motion === 'lite' ? 'Modo lite: sin animaciones ni transiciones. Más rápido y ahorra batería.' : 'Transiciones al cambiar de pantalla, ventanas que suben, botones que responden al tocarlos y confeti en los logros.'}
        >
          <Segmented label="Animaciones" value={a.motion} onChange={(v) => setAppearance({ motion: v })} options={[['full', 'Completas'], ['lite', 'Modo lite']]} />
        </Field>
        {reduced ? <p className="tiny muted">Tu teléfono tiene activado "reducir movimiento": por eso el modo lite empieza prendido.</p> : null}
        <div className="preview-box" aria-label="Vista previa">
          <span className="tiny muted">Vista previa</span>
          <div className="row wrap">
            <button type="button" className="btn primary sm">
              Botón principal
            </button>
            <button type="button" className="chip" aria-pressed="true">
              Elegido
            </button>
            <span className="badge brand">Etiqueta</span>
          </div>
          <div className="bar" role="presentation">
            <span style={{ width: '65%' }} />
          </div>
        </div>
        <p className="tiny muted">El ícono de la app en la pantalla de inicio no cambia de color.</p>
      </div>
    </Card>
  );
}

function VoiceCard() {
  const sp = useSpeech();
  useEffect(() => {
    void checkSpeechSupport();
  }, []);
  return (
    <Card title="Lectura en voz alta">
      <div className="stack" data-testid="voice-card">
        {sp.supported === false ? (
          <Notice kind="warn" title="No hay una voz en español disponible">
            {isNativeVoice()
              ? 'Instala o descarga una voz en español en los ajustes de voz de Android y vuelve a intentarlo.'
              : 'Este navegador o teléfono no tiene una voz en español que funcione sin internet.'}
          </Notice>
        ) : null}
        {sp.supported === false && isNativeVoice() ? (
          <div className="row wrap">
            <button type="button" className="btn sm" onClick={openVoiceInstall}>
              Instalar voces
            </button>
            <button type="button" className="btn sm" onClick={() => void refreshVoices()}>
              Volver a buscar
            </button>
          </div>
        ) : null}
        {sp.supported ? (
          <>
            <label className="check">
              <input type="checkbox" checked={!sp.muted} onChange={(e) => setMuted(!e.target.checked)} data-testid="voice-auto" /> Leer en voz alta los recorridos, explicaciones ⓘ, ayuda y lecciones
            </label>
            <p className="tiny muted">También puedes silenciarla o activarla con la bocina 🔊 / 🔇 que aparece en esas pantallas.</p>
            {sp.voices && sp.voices.length > 1 ? (
              <Field label="Voz" htmlFor="voice-id">
                <select id="voice-id" className="select" value={sp.voiceId || sp.voices[0].id} onChange={(e) => setVoiceId(e.target.value)}>
                  {sp.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={`Velocidad: ${sp.rate.toFixed(1).replace('.', ',')}×`} htmlFor="voice-rate">
              <input id="voice-rate" type="range" min={6} max={16} step={1} value={Math.round(sp.rate * 10)} onChange={(e) => setRate(Number(e.target.value) / 10)} />
            </Field>
            <button type="button" className="btn" data-sound="none" onClick={() => speak(SAMPLE, { force: true })} data-testid="voice-test">
              <Icon name="volume" /> Escuchar un ejemplo
            </button>
          </>
        ) : null}
        <p className="tiny muted">Usa las voces que ya trae tu teléfono, sin internet. La app no envía el texto a ningún lado.</p>
      </div>
    </Card>
  );
}
