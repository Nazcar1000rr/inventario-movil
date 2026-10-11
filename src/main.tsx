import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapApp } from '@capacitor/app';
import { errorMessage, initDatabase } from './core';
import { App } from './ui/App';
import { db, closeTopModal, practice } from './ui/store';
import { seedPracticeData } from './ui/practice';
import { goBack, canGoBack, currentPath } from './ui/router';
import { isNative, requestPersistence } from './ui/platform';
import { audioDebug, installSoundHandlers, recentSounds } from './ui/sound';
import { applyAppearance, watchSystemTheme } from './ui/theme';
import { installSpeechUnlock, stopSpeaking } from './ui/speech';
import { installReminders } from './ui/reminders';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

function fatal(msg: string) {
  root.render(
    <div className="content" style={{ paddingTop: 40 }}>
      <div className="notice bad" role="alert">
        <div className="notice-body stack-sm">
          <p className="strong">No se pudo abrir la base de datos local</p>
          <p className="small">{msg}</p>
          <p className="small">
            Si usas Safari en modo privado, ábrelo en una pestaña normal o desde la app instalada. Tus datos no se han modificado.
          </p>
          <button className="btn" onClick={() => location.reload()}>
            Reintentar
          </button>
        </div>
      </div>
    </div>,
  );
}

async function start() {
  if (!window.indexedDB) {
    fatal('Este navegador no permite almacenamiento local (IndexedDB).');
    return;
  }
  try {
    await db.open();
    await initDatabase(db);
    if (practice) await seedPracticeData(db);
  } catch (e) {
    fatal(errorMessage(e));
    return;
  }
  db.on('versionchange', () => {
    // Otra pestaña actualizó la app: cerrar para no bloquear la migración
    db.close();
    location.reload();
  });
  void requestPersistence();

  // Evita que el teclado tape el campo activo
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches?.('input, textarea, select')) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });

  if (isNative()) {
    // Botón Atrás de Android: cierra diálogos, luego navega atrás, y en Inicio sale de la app
    void CapApp.addListener('backButton', () => {
      if (closeTopModal()) return;
      if (canGoBack()) goBack();
      else if (currentPath() !== '/') goBack('/');
      else void CapApp.exitApp();
    });
  } else if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    void registerSW();
  }

  applyAppearance();
  watchSystemTheme();
  installSoundHandlers();
  installSpeechUnlock();
  installReminders();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopSpeaking();
  });
  // Solo para las pruebas automáticas (navegador controlado): nombres de los últimos sonidos
  if (navigator.webdriver) {
    (window as unknown as { __sounds: string[] }).__sounds = recentSounds;
    (window as unknown as { __audio: typeof audioDebug }).__audio = audioDebug;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function registerSW() {
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const announce = (w: ServiceWorker) => {
      window.dispatchEvent(new CustomEvent('app-update-ready', { detail: w }));
    };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
      });
    });
    // Recargar solo cuando una versión NUEVA reemplaza a otra (no en la primera instalación)
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  } catch {
    /* sin service worker: la app funciona, pero no sin conexión */
  }
}

void start();
