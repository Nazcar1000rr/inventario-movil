# CLAUDE.md — contexto para seguir trabajando en Inventario Móvil

Este archivo es la memoria del proyecto para Claude: qué es la app, cómo está hecha y **cómo se ha venido trabajando** (metodología). Léelo completo antes de tocar algo. Última actualización: 11 de octubre de 2026, versión **2.3.0** publicada (commit `edb7c90` + README `185990f`).

## 1. Qué es

- App en **español** para el negocio de Daniel (usuario de GitHub `Nazcar1000rr`): venta de teléfonos (sobre todo **iPhone usados/restaurados**, que se valoran con precios de Marketplace), audífonos y accesorios. Pesos colombianos (**COP, enteros**).
- Dos usuarios con datos **independientes**: Daniel en **iPhone (PWA)** y su primo en **Android (APK)**. Los datos solo pasan entre teléfonos con **respaldo manual** (exportar/importar).
- **Sin servidor, sin cuentas, sin nube.** Todo en IndexedDB del teléfono.
- Enlaces:
  - iPhone (PWA): <https://nazcar1000rr.github.io/inventario-movil/>
  - APK: <https://github.com/Nazcar1000rr/inventario-movil/releases/latest/download/inventario-movil.apk>
  - Repo: <https://github.com/Nazcar1000rr/inventario-movil>

## 2. Reglas que el usuario fijó (siguen vigentes, textuales)

- "No incluyas claves privadas de firma en el código fuente ni en repositorios."
- "No afirmes que existe una URL, que se generó un APK, que se instaló en un teléfono físico o que una prueba pasó, salvo que realmente haya ocurrido."
- "No enviar datos a terceros ni a la nube."
- "Guardar datos en el almacenamiento privado de la aplicación."
- "No incluir información sensible en registros de depuración."

Preferencias de Daniel:
- **Entrega concisa**, sin explicaciones salvo que algo haya salido mal. **Validar los archivos antes de entregarlos.**
- Todos los textos de la app en **tono cercano (tú)**. `tests/unit/tone.test.ts` lo exige: evitar "toque" (sustantivo), "Toque", "crean", "sus datos", "su teléfono", "Escriba", "Seleccione", "usted", etc. (ver la regex en el test).
- Respuestas al usuario en español, tono tú.
- Pide funciones grandes en mensajes sucesivos mientras trabajas: se agregan a la misma versión en curso y se anuncia brevemente qué se va a hacer.

## 3. Metodología de trabajo (hacerlo igual)

1. Primera respuesta: una frase de qué vas a hacer y empezar. Crear **lista de tareas** (TaskCreate/TaskUpdate) por cada función pedida y la de "verificar y publicar".
2. Leer el código existente antes de cambiar; seguir los patrones del proyecto (sección 6).
3. **Lógica en `src/core` con pruebas unitarias** (Vitest + fake-indexeddb, TZ America/Bogota) que comprueban los invariantes contables (sección 5). UI en `src/ui`.
4. Por cada función: ayuda (manual, `?` de la pantalla, ⓘ de métricas), novedades (CHANGELOG), consejo del día si aplica, lección si aplica, recorrido si aplica, modo práctica con datos de ejemplo.
5. **E2E con Playwright** contra la compilación de producción (`npm run build` primero). Capturas con `docShot` en `docs/capturas/` y **revisarlas a la vista** (Read de la imagen): desbordes, palabras partidas, superposiciones.
6. Correr **todo**: `npx tsc -b`, `npx vitest run`, `npx playwright test` (completo, ~9 min; en segundo plano con log y esperar).
7. Publicar (sección 9), **verificar de verdad** (CI, Pages, firma del APK) y recién ahí afirmar.
8. Entregables: zip del código (sin firma), zip de la PWA, manual PDF → `SendUserFile`. Informe final **corto**: enlaces, qué hay de nuevo en viñetas, qué **no** se probó (teléfono físico).
9. Las capturas de gráficas siguen el skill de dataviz (colores validados con su script).

## 4. Stack y comandos

- React 19, Vite 8, TypeScript 7 estricto, Dexie 4 (`useLiveQuery` → `useLive`), Capacitor 8.5.3 (Android), plugins: app, filesystem, share, `@capacitor-community/text-to-speech@8.0.2`, `@capacitor/local-notifications@8.3.1`.
- Pruebas: Vitest 5 + fake-indexeddb; Playwright 1.56 (Chromium), `baseURL` http://localhost:4173 con `vite preview`, viewport 390×844, locale es-CO.
- Node 22.

```bash
npm ci
npm test                 # 119 pruebas de lógica
npm run build            # tsc + vite + sw.js (imprime "versión <hash>")
npx playwright test      # 36 E2E (requiere build)
npx cap sync android     # actualiza los gradle generados (commitearlos si cambian plugins)
# Manual PDF: npm run build; npx vite preview --port 4173 --strictPort & ; node scripts/make-manual-pdf.mjs; matar preview; npm run build otra vez
```

No usar `pkill` a lo bruto para el preview: matar solo los procesos `node .*vite.* preview`.

## 5. Dinero e invariantes (no romper)

- Dinero en **enteros COP**. Repartos con `allocate()` (mayor residuo; acepta totales negativos).
- **Libro de movimientos:** Σ costDelta de movimientos = `stockValue` del producto. Productos por cantidad con lotes: totales = suma de lotes.
- **Unidades:** Σ movimientos de la unidad + capitalizado = baseCost + extra si está en stock; 0 si no.
- **Capital:** crecimiento = ganancia neta + ajustes de caja + mercancía que ya tenías → `explainGrowth().difference === 0`.
- **Correcciones (2.3):** nunca editar movimientos pasados; agregar movimientos `correction: true` **fechados en el hecho** (fecha de la compra/lote, de cada venta, hoy para bajas). Patrón plan: `plan()` → vista previa + `writes[]`; aplicar en `tx` con `claimOp`.
- Toda operación multi‑tabla en `tx(db, fn)` (todas las tablas). Doble toque: `claimOp(db, opId)`.
- `verifyIntegrity()` debe dar cero problemas y cero advertencias en las pruebas (`expectIntegrity`).

## 6. Estructura y patrones

- `src/core/types.ts` modelo; `src/core/db.ts` esquema Dexie (**v4**: `SCHEMA_V4`, `DATA_TABLES`), `src/core/services/*` (inventarios, productos, lotes, compras, ventas, gastos, garantías, vistas, informes, capital, deudas, precios, rentabilidad, personal, **corrections, analysis, inquiries, calendar, receivables, memos**, integridad, backup, búsqueda). `src/core/index.ts` reexporta.
- **Agregar una tabla:** types → `db.ts` (SCHEMA_V4 si la versión no ha salido; si ya salió, nueva versión con upgrade) → `DATA_TABLES` → `backup.ts` (etiqueta, PK, SPEC de campos, `BACKUP_MIGRATIONS`) → `integrity.ts` → borrar al eliminar inventario si aplica → `practice.ts`.
- UI: `src/ui/App.tsx` (rutas en `resolve`, barra lateral, botón + que usa `src/ui/menu.ts` → `QUICK_GROUPS`; menú Más y barra lateral usan `MORE_GROUPS`), pantallas en `src/ui/screens/`, componentes en `src/ui/components/` (`ui.tsx`: Page, Card, Sheet, Field, TextInput, MoneyInput(`focusFirst`), IntInput, Notice, Chips, Segmented, ListItem, ask/confirmAction; `viz.tsx` gráficas; `Icon.tsx`).
- Hooks/estado: `useLive`, `useAction()` (`act.run(fn, msgOk)` devuelve `undefined` si falló; `act.field/act.error`), `toast`, `getPref/setPref` (localStorage `pref:`), `navigate`, `useRoute`.
- Sheet: el foco inicial va a `[data-autofocus]` si existe; si no, al primer campo.
- Ayuda: `src/ui/help/content.ts` (CATEGORIES, ARTICLES, METRICS, SCREEN_HELP, CHANGELOG, DAILY_TIPS), `help/lessons.ts` (16 lecciones), `tour.tsx` (recorridos; `skipTour`, `restartFirstSteps`, `toursOff`), `Learn.tsx` (calculadoras, ToursCard), `practice.ts`.
- Voz `speech.ts` (Web Speech / TTS Android, solo voces locales); barra `components/speechbar.tsx` (Callar/Silenciar). Sonidos `sound.ts` (Web Audio; al ocultarse la app se pausa y el primer toque al volver crea un contexto nuevo — arreglo 2.3).
- Notificaciones: `src/ui/reminders.ts` (Android: canal `recordatorios`, ícono `ic_stat_notify`, reprograma al abrir; iPhone/web: avisos en la app + `.ics` por blob). `capacitor.config.ts` → LocalNotifications.
- WhatsApp: `whatsappNumber` (10 dígitos → 57…), `whatsappLink` (`https://wa.me/<n>?text=`), `collectionMessage(tone amable|fecha|firme, detail)`; `components/whatsapp.tsx`; `platform.ts` → `openExternal`, `shareText`.
- Colores de gráficas (dataviz): una serie azul #2a78d6 (oscuro #3987e5); negativo rojo #e34948 (#e66767); énfasis gris; ordinal A/B/C #184f95/#2a78d6/#86b6ef; estados con ícono + texto. Animaciones respetan `data-motion='lite'` y reducir movimiento.

## 7. Pruebas E2E: detalles útiles

- Helpers en `tests/e2e/helpers.ts`: `createInventory`, `purchase`, `sell`, `docShot(page, name, fullPage)` (espera animaciones), `noHorizontalOverflow`.
- `all-screens.spec.ts` (todas las rutas + `?` de cada pantalla) y `responsive-network.spec.ts` (8 tamaños): agregar ahí cada pantalla nueva.
- Recorrido "Conoce la app" tiene **10 pasos** (v21 lo comprueba).
- Voz simulada con `addInitScript` (speechSynthesis falso); audio simulado igual (ver `v23.spec.ts` y `v23b.spec.ts`).

## 8. Historia de versiones

- **1.0.0:** inventarios (sencillo/profesional), productos por unidad (IMEI, código permanente) o por cantidad, compras, ventas, pagos, devoluciones, gastos, garantías, informes, vistas consolidadas, respaldo con SHA-256 y cifrado AES opcional.
- **2.0.0:** capital, deudas, precios de mercado, historial de piezas/reparaciones, rentabilidad y proveedores, ayuda completa y modo práctica.
- **2.1.0:** lotes por precio de compra, avisos de compra más barata, gasto del viaje, gastos personales, lecciones, recorridos, sonidos.
- **2.2.0:** logo nuevo, colores/modo oscuro/degradado/modo lite, lectura en voz alta, paquetes de sonidos.
- **2.3.0 (actual, compilación 10, sw `cae583406f28`):** corregir compras/stock/costos sin recrear (ventas pasadas recalculadas, "Corrección"), cambiar precio de venta; Análisis del negocio (salud 0–100, lo que esperas ganar, expectativas semanales/mensuales automáticas y editables con historial, tendencias, ABC 80/20, tiempo de venta, flujo, punto de equilibrio, días/horas); Preguntones (+1 con fecha, "Me compró"); Calendario con recordatorios (notificaciones locales en Android, .ics en iPhone); Me deben (fiados, abonos con fecha, préstamos, "ya me debía", "No me va a pagar", fecha prometida, **cobro por WhatsApp** con mensaje propio); Notas; menús + y Más por categorías; recorridos con Omitir/Repetir primeros pasos/no ofrecer; barra Callar/Silenciar la voz; arreglo de sonidos al volver a la app.

## 9. Publicar una versión (pasos exactos)

1. Subir versión en `package.json` y `package-lock.json` (las 2 primeras apariciones). Entrada nueva en `CHANGELOG` (content.ts).
2. Actualizar `README.md` (funciones, estado, límites), `docs/ARQUITECTURA.md`, `docs/PRUEBAS.md` (qué se probó, errores reales, no probado, lista en teléfono, conteos), `docs/INSTALACION.md`.
3. Regenerar el manual PDF y comprobar que tiene texto (`pdftotext`), luego `npm run build`.
4. `npx cap sync android` si cambiaron plugins.
5. Correr todas las pruebas. Revisar capturas.
6. Commit con autor `Claude <noreply@anthropic.com>` y al final del mensaje las líneas de atribución que indique la sesión. `git push origin main`.
7. CI: `curl -s https://api.github.com/repos/Nazcar1000rr/inventario-movil/actions/runs?per_page=3`. El workflow del APK ignora cambios solo de `**.md` y `docs/**`; `versionCode` = número de ejecución; publica el release `v<versión>-<n>`.
8. Verificar Pages: WebFetch de `.../sw.js?v=<algo>` → `const CACHE = 'inventario-<hash>'` igual al hash del build local.
9. Verificar APK: descargarlo; certificado de firma v2 **SHA-256 `16554A00B262E2A165FF392D971A9606D7062110D10079374EB675E1F433C972`** (misma clave siempre, para instalar encima); `assets/public/sw.js` con el mismo hash; permisos en el manifiesto.
10. Actualizar la tabla "Estado de la entrega" del README con lo verificado (commit aparte).
11. Entregables: `git archive` del repo (sin `.jks` ni `keystore.properties`), zip de `dist/`, manual PDF; validar los zips; enviarlos.

**Firma:** la clave (`inventario-release.jks`, `keystore.properties`) se entregó a Daniel por separado y vive como secrets de GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). **Nunca** en el repo. El APK se compila solo en GitHub Actions.

## 10. Pendiente / a confirmar

- Nada se ha probado en un **teléfono físico** ni en Safari: notificaciones reales de Android, `.ics` en el Calendario del iPhone, abrir WhatsApp, sonidos al volver de otra app, voz real. Lista en `docs/PRUEBAS.md` (paso 15).
- Daniel pidió "en la parte de las órdenes todo por categorías": se ordenaron el **botón +** y el **menú Más**; se le preguntó si se refería a otra pantalla (p. ej. Operaciones). Confirmar.
- Limitaciones conocidas en README (datos solo en el teléfono, caja calculada, sin QR, importes de ventas no editables, etc.).
