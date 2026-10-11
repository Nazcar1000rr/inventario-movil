import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Empaquetado Android con Capacitor. La app es la misma compilación web (dist/),
 * servida localmente dentro del APK (sin servidor ni internet).
 */
const config: CapacitorConfig = {
  appId: 'co.inventariomovil.app',
  appName: 'Inventario Móvil',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DEFAULT',
    },
    // v2.3: recordatorios del calendario (notificaciones locales, sin internet)
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#0d6b58',
    },
  },
};

export default config;
