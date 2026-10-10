import { defineConfig } from '@playwright/test';

/**
 * Pruebas de extremo a extremo sobre la compilación de producción (npm run build).
 * Se ejecutan en Chromium (mismo motor que el WebView de Android). Safari/WebKit de iOS
 * no está disponible en este entorno: ver docs/PRUEBAS.md.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
