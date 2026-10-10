# Pruebas: lo ejecutado y lo pendiente

Fecha de ejecución: 9 de octubre de 2026.

Entorno:
- Linux con Node 22.22.
- Vitest 5.0.3 + fake-indexeddb 6.2.5: implementación de IndexedDB conforme al estándar, sobre la que corre el mismo código Dexie de la app.
- Playwright 1.56 con Chromium 141 (compilación 1194), contra la **compilación de producción** (`npm run build` + `vite preview`).

**Resultado: 40/40 pruebas de lógica y 13/13 pruebas de extremo a extremo aprobadas.** Además, `tsc` (TypeScript 7.0.2, modo estricto) no reporta errores.

## Errores reales encontrados y corregidos durante las pruebas

1. **Recarga inesperada en la primera visita.** Al activarse el service worker por primera vez, la app se recargaba sola e interrumpía al usuario. Ahora solo recarga cuando una versión nueva reemplaza a otra.
2. **Diálogos que enviaban el formulario de fondo.** Al guardar un comprador o un producto desde un diálogo, el envío se propagaba al formulario de venta o compra que estaba detrás y abría su confirmación. Se corrigió en el componente de diálogo.
3. **Consultas repetidas sin parar en el panel e informes.** El rango del periodo cambiaba en cada pintado de pantalla. Ahora los límites son estables. Se verificó 0 operaciones de IndexedDB en 3 segundos de reposo en Inicio, Finanzas y Tiempos.
4. **Etiquetas que se partían palabra por palabra en pantallas de 320 px.** Se cambió el diseño de las filas de datos.

## Correspondencia con las pruebas obligatorias

| # | Prueba exigida | Cómo se verificó | Resultado |
|---|---|---|---|
| 1 | Crear inventario en modo sencillo | `operations.test.ts`, flujo E2E | ✅ |
| 2 | Crear inventario en modo profesional | `operations.test.ts`, E2E profesional | ✅ |
| 3 | Cambiar de modalidad sin pérdida de datos | Instantánea de **todas** las tablas antes y después de 3 cambios: idénticas. En E2E se cambia sencillo → profesional y los datos de inspección y costo siguen ahí | ✅ |
| 4 | Compra y stock | Unidades con costo exacto (1 530 000 c/u con gastos repartidos) y producto por cantidad (valor 204 000) | ✅ |
| 5 | Venta y disminución de stock | Unidad vendida (la más antigua) y cantidad 10 → 7 | ✅ |
| 6 | Evitar venta superior al stock | Por cantidad, por unidad, venta mixta y la misma línea repetida. La base queda idéntica tras el error. En E2E aparece el mensaje "Stock insuficiente" | ✅ |
| 7 | Evitar duplicar venta (doble pulsación o reintento) | Dos llamadas simultáneas y un reintento con la misma `opId` = 1 venta. Dos ventas distintas de la misma unidad en paralelo: solo una se completa. En E2E, triple clic en Confirmar = 1 venta | ✅ |
| 8 | Costos, ingresos y ganancias con caso conocido | Ventas 2 105 000, descuento 5 000, costo 1 591 200, ganancia bruta 508 800, gastos 80 000, ganancia neta 428 800 | ✅ |
| 9 | Ventas cobradas frente a pendientes | Pendiente → parcial → pagada. Se rechaza el sobrepago y un pago reintentado no se duplica | ✅ |
| 10 | Gastos sin descontar dos veces | Una reparación capitalizada no aparece como gasto operativo y entra una sola vez en el costo al vender | ✅ |
| 11 | Devolución conservando la venta original | La venta sigue activa, la línea marca lo devuelto, la unidad queda en revisión en el ciclo 2 con su fecha original, la garantía se anula y hay historial. Al revender se conserva el ciclo anterior | ✅ |
| 12 | Días en inventario con fechas conocidas | 30 días en inventario; 15 y 25 días hasta vender; promedio 20 | ✅ |
| 13 | Fecha desconocida sin inventarla | `acquiredAt = null`, días = null, excluida de los promedios (contada como "sin fecha"). Ganancia marcada incompleta hasta completar el costo | ✅ |
| 14 | Dos inventarios y vista consolidada sin duplicar | A = 3 + B = 2 → la vista muestra 5. La vista no crea registros | ✅ |
| 15 | Vender desde el origen y ver la vista | Se vende desde A → A = 2, vista = 4, B = 2. Desde la vista pide elegir el origen. Las finanzas de la vista son A + B | ✅ |
| 16 | Exportar y restaurar un respaldo completo | Lógica: restauración en **otra** base (otra instalación) con todas las tablas idénticas, fotos binarias incluidas e integridad correcta. E2E: descarga del archivo, borrado total y restauración por el selector de archivos | ✅ |
| 17 | Archivo corrupto no altera los datos | Vacío, truncado, otro formato, suma alterada, versión futura, conteo erróneo, campo inválido, identificador repetido y referencia rota: todos rechazados con la base idéntica. Un fallo simulado de escritura **a mitad** de la restauración revierte todo | ✅ |
| 18 | Conflictos o duplicados al importar | Detecta misma instalación, respaldo más antiguo que los datos y respaldo ya restaurado. El reemplazo exige escribir REEMPLAZAR, guarda una copia interna y "Deshacer" recupera los datos exactos. Combinar no se ofrece (explicado en pantalla) | ✅ |
| 19 | Reiniciar la app y comprobar persistencia | Navegador con perfil persistente: crear datos, recargar, **cerrar el navegador completo** y volver a abrir. Los datos siguen ahí | ✅ (Chromium) |
| 20 | Trabajar sin conexión | Service worker activo, red desconectada (comprobado que `fetch` externo falla), recarga, y crear inventario, comprar y vender sin conexión | ✅ (Chromium) |
| 21 | Diseño en varios tamaños | 11 pantallas × 8 tamaños (320×568, 375×667, 393×852, 430×932, 360×740, 412×915, 820×1180 y 1280×800) sin desborde horizontal. Las 35 rutas se recorren sin errores. Capturas en `docs/capturas/` | ✅ (Chromium) |
| 21b | Teclado abierto | Con la pantalla reducida a 390×380 (simulando el teclado), el campo enfocado queda visible | ✅ simulado |
| 22 | Migración de esquema | Cadena de migraciones de respaldos v1→v3 y una base Dexie existente actualizada a la versión 2 conservando los datos | ✅ |
| 23 | No se envían datos a servidores | Todas las peticiones de un flujo completo van a la propia app, y un `fetch` a un servidor externo queda bloqueado por la política de seguridad | ✅ |
| 24 | Experiencia básica en iOS y Android | **No probado en dispositivos ni simuladores.** Solo Chromium con emulación móvil (táctil, tamaños, densidad 2×), que usa el mismo motor que el WebView de Android | ⚠️ Pendiente |

## Lo que NO se pudo probar aquí (y por qué)

| Aspecto | Motivo | Cómo probarlo |
|---|---|---|
| Safari / iOS (instalación en la pantalla de inicio, almacenamiento, Web Share con archivos, selector de Archivos) | No hay WebKit ni iPhone en este entorno | Lista de verificación de abajo |
| APK en Android (botón Atrás, compartir nativo, Guardar en Documentos, selector de archivos, cámara, márgenes del sistema) | No se pudo compilar: el Android SDK y Google Maven están bloqueados por la red del entorno | Compilar con GitHub Actions o Android Studio y seguir la lista de abajo |
| Transferencia real entre un iPhone y un Android | Requiere dos dispositivos físicos | Lista de abajo (paso 8) |
| Cierre forzado del sistema operativo (matar el proceso) | Solo se simuló cerrando el navegador completo | Lista de abajo (paso 3) |

Los archivos de Android se validaron sin compilar:
- XML bien formado.
- Scripts Gradle con sintaxis Groovy correcta.
- Íconos y pantalla de inicio generados.

## Lista de verificación en dispositivos físicos (≈ 15 minutos por teléfono)

1. Instalar (iPhone: Safari → Añadir a pantalla de inicio; Android: APK) y abrir desde el icono.
2. Crear un inventario y registrar una compra de 2 teléfonos y una venta con pago parcial.
3. **Cierre forzado:** cerrar la app desde el selector de apps y reabrirla. Los datos deben seguir ahí. Reiniciar el teléfono y comprobar de nuevo.
4. **Sin conexión:** activar el modo avión, reabrir y registrar una venta.
5. Teclado: en "Registrar venta", tocar el campo Descuento y comprobar que el teclado no lo tapa.
6. Respaldo → Preparar → Compartir: debe abrir el menú nativo (AirDrop o WhatsApp en iPhone; WhatsApp, Drive o Bluetooth en Android). En Android, probar también "Guardar en Documentos".
7. Respaldo → Elegir archivo: debe abrir el selector de archivos y mostrar el resumen.
8. **Entre teléfonos:** exportar en el iPhone, enviar al Android, importar y comprobar los totales. Repetir en sentido contrario.
9. Android: el botón Atrás cierra diálogos, vuelve atrás y en Inicio sale de la app.
10. Modo profesional → ficha de unidad → Tomar foto: debe abrir la cámara y guardar la foto.
11. iPhone/Android con notch o barra de gestos: nada queda tapado por la barra de estado ni por la barra inferior.

## Cómo volver a ejecutar las pruebas

```bash
npm ci
npm test                     # 40 pruebas de lógica (~3 s)
npm run build
npx playwright test          # 13 pruebas E2E (~4 min). Requiere el navegador Chromium de Playwright
```
