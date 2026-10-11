# Pruebas: lo ejecutado y lo pendiente

Fecha de ejecución: 10 de octubre de 2026 (versión 2.2.0).

Entorno:
- Linux con Node 22.22.
- Vitest 5.0.3 + fake-indexeddb 6.2.5: implementación de IndexedDB conforme al estándar, sobre la que corre el mismo código Dexie de la app.
- Playwright 1.56 con Chromium 141 (compilación 1194), contra la **compilación de producción** (`npm run build` + `vite preview`).

**Resultado: 88/88 pruebas de lógica y 24/24 pruebas de extremo a extremo aprobadas.** `tsc` (TypeScript 7.0.2, modo estricto) no reporta errores.

## Versión 2.2: qué se probó

| Tema | Cómo se verificó | Resultado |
|---|---|---|
| Colores y modo | E2E: Azul cambia el color principal (#1d5fbf); Oscuro lo cambia a su versión oscura (#6ea1f0); Degradado pone degradado en el encabezado; todo se recuerda al recargar; Rosado en claro actualiza la barra del sistema (theme-color) | ✅ (Chromium) |
| Contraste de los 6 colores | Cálculo WCAG de texto sobre botón, enlaces sobre el fondo y chips, en claro y oscuro, y sobre los degradados: todos ≥ 4,5:1 (se ajustaron Verde degradado y Coral) | ✅ |
| Animaciones y modo lite | E2E: con animaciones, las tarjetas entran con animación; en modo lite, ninguna | ✅ (Chromium) |
| Lectura en voz alta | E2E con una voz simulada (Chromium no trae voces): lee el paso del recorrido, la bocina silencia (🔇) y no lee el paso siguiente, al reactivarla lee el paso actual; lee la explicación ⓘ, la lección y la pregunta cuando queda a la vista; las cifras se leen sin separadores; el ejemplo de Configuración | ✅ (Chromium, voz simulada) |
| Texto para la voz | Pesos, porcentajes, símbolos (÷ × → ▼ −), "Ej.", comillas y emojis; frases largas partidas sin perder texto | ✅ |
| Paquetes de sonidos | Los 6 paquetes definen los 8 sonidos; E2E: elegir Retro suena "venta" en Retro; tono de venta Caja registradora; se recuerdan al recargar | ✅ |
| Sonar con el iPhone en silencio | E2E simulando la API de sesión de audio de iOS: la opción pone el tipo "playback" (y "auto" al quitarla) y se recuerda | ✅ (simulado) |
| Logo | Íconos de la PWA, adaptable de Android y splash generados y revisados a la vista | ✅ |

### Errores reales encontrados y corregidos (v2.2)

1. El manual en PDF salía en blanco: con las animaciones nuevas, el contenido empezaba transparente justo cuando se imprimía. Ahora, al imprimir o guardar en PDF no hay animaciones (comprobado: el manual vuelve a tener todo su texto).
2. Dos combinaciones de color no llegaban al contraste mínimo (inicio del degradado verde y chips en coral). Se oscurecieron.
3. Un texto nuevo usaba "toque" (forma de usted según la prueba de tono). Se reescribió.

**No probado aquí:** la voz real (iPhone y motor de voz de Android), el sonido real con el interruptor de silencio del iPhone y el logo en la pantalla de inicio de un teléfono. Ver la lista de verificación.

## Versión 2.1: qué se probó

| Tema | Cómo se verificó | Resultado |
|---|---|---|
| Lotes: salida del más antiguo | Audífonos 5 a 30 000 y 4 a 22 000; vender 6 → costo 172 000 (5 × 30 000 + 22 000), no 158 667 como con promedio; quedan 3 a 22 000 | ✅ |
| Lote elegido | Vender 2 del lote nuevo → 44 000; pedir más de lo que tiene completa con el más antiguo; lote vacío rechazado; stock insuficiente rechazado | ✅ |
| Anulaciones y devoluciones | Anular ventas devuelve cada unidad a su lote exacto; devolución crea lote de devolución; devuelto dañado no crea lote | ✅ |
| Ajustes y stock inicial | Salida desde un lote elegido; entrada y stock inicial crean lotes; lo sin costo sale primero | ✅ |
| Gastos capitalizados en lotes | 9 000 repartidos por cantidad (5 000 + 4 000) o a un lote elegido; anularlos deja los valores originales | ✅ |
| Anular compra con lotes | Permitido si su lote sigue intacto aunque se haya vendido de otro lote; bloqueado si su lote cambió | ✅ |
| Apagar y prender lotes | Costo promedio después de apagar (2 × 238 000 ÷ 9 = 52 889); al prender, lotes reconstruidos con el historial, suma exacta al peso | ✅ |
| Informes con lotes | Antigüedad por lote (39 y 9 días), días hasta vender con la fecha del lote, costo y mínimo por lote | ✅ |
| Capital con lotes | Crecimiento = ganancia (diferencia 0) | ✅ |
| Migración v2 → v2.1 (base de datos) | Base Dexie **versión 2** con datos reales de la v2 (stock sin costo, dos compras, ventas) abierta con la app nueva: lotes reconstruidos (1 de agosto y 5 de septiembre), valor exacto, proveedor, integridad sin problemas | ✅ |
| Respaldo v2 → v2.1 | Mismo resultado al convertir un respaldo de la v2; respaldo de la 2.1 restaurado idéntico | ✅ |
| "La última vez pagaste" | Historial en dos inventarios con el mismo producto, por proveedor (mín./máx.), variación −29 % y +10 % | ✅ |
| Aviso de compra más barata | 7 unidades más caras, 46 000 de diferencia, mínimos con 10 % (33 000 y 27 500); teléfonos comparados por unidad | ✅ |
| Gasto agregado a una compra | 70 000 por unidades: 40 000 al costo (3 audífonos y 1 teléfono en existencia) y 30 000 como gasto (lo vendido); la ganancia baja exactamente 30 000; anular una parte anula el grupo | ✅ |
| Gasto del viaje entre compras | 23 800 según lo pagado → 15 000 y 8 800; doble envío no duplica; producto con costo promedio | ✅ |
| Gastos personales | Ganancia del mes 300 000: 100 000 → verde (33 %), luego 80 000 → amarillo, 250 000 → 200 000 de ganancias y 50 000 del capital (rojo); mes sin ganancia → rojo; no cambia la ganancia; crecimiento cuadra | ✅ |
| E2E lotes y compras | Aviso de compra más barata (también en la confirmación), ficha con 2 lotes y "Lo que has pagado", venta con aviso de pérdida que desaparece al elegir el lote nuevo, gasto del viaje 9 000 → 8 168 al costo y 832 de gasto, apagar y prender lotes | ✅ (Chromium) |
| E2E gasto personal | Aviso rojo, proyección de gasto hormiga, consejo; pantalla de gastos personales; etiqueta "Personal" en Capital; consejos apagados en Configuración | ✅ (Chromium) |
| E2E recorrido y lecciones | Oferta del recorrido en Inicio, 9 pasos sobre pantallas reales, encadena "Tu primera compra"; calculadora de margen (16,7 %); preguntas 2 de 3 y lección marcada | ✅ (Chromium) |
| E2E sonidos | Apagar solo "Toques" y volumen 30 %: se recuerdan al recargar; al abrir un diálogo suena "abrir" y no "toque" | ✅ (Chromium) |
| Pantallas nuevas | Las 17 rutas nuevas (lecciones, gastos personales, gasto de viaje, ficha con lotes, ayuda nueva) sin errores; 6 pantallas nuevas sin desborde en 8 tamaños | ✅ (Chromium) |

### Errores reales encontrados y corregidos (v2.1)

1. Quedaban textos de "usted" que la prueba de tono no detectaba ("Primero cree un inventario", "use Comprar", "hágalo desde la ficha"). Corregidos y agregados a la prueba.
2. El botón "Siguiente lección" se salía de la pantalla con títulos largos (390 px). Ahora el texto se ajusta.
3. Las cifras de los textos de ayuda se partían entre líneas ("1" / "300 000"). Ahora usan espacio duro.
4. Los subtítulos de lotes e historial de precios se cortaban con "…". Ahora se ven completos.

## Versión 2: qué se probó

| Tema | Cómo se verificó | Resultado |
|---|---|---|
| Migración real v1 → v2 (base de datos) | Se crean datos con la app, se convierten **exactamente** a la forma de la v1 (sin campos nuevos, "Reacondicionado", movimientos sin ajustar de un costo completado después de vender y de una baja con reparación), se guardan en una base Dexie **versión 1** y se abre con la app v2: nada se pierde, los campos nuevos quedan con su valor por defecto, los movimientos quedan iguales a los que produce la v2, integridad sin problemas ni advertencias y crecimiento explicado al peso | ✅ |
| Migración v1 → v2 en el navegador | E2E: se crea una base IndexedDB con el esquema y los datos de la v1 en Chromium, se abre la app compilada: inventario, unidad ("Restaurado"), compra ("La caja") y configuración convertidos; se muestran las novedades una sola vez | ✅ (Chromium) |
| Respaldo de la v1 importado en la v2 | Archivo v1 (23 tablas, suma SHA-256 válida) → se convierte, se importa y queda igual que la base actualizada. Un respaldo v1 incompleto se rechaza | ✅ |
| Respaldo v2 | Con capital, deudas, precios, metas y piezas, cifrado: se restaura idéntico en otra base | ✅ |
| Capital (caso calculado a mano) | 17 operaciones (aporte, stock inicial, compra de contado, compra con tarjeta, reparación, ventas con abono y con comisión, gasto general, préstamo a ti y devolución, retiro, ajuste de caja, préstamo de un tercero, abono con intereses, devolución, mercancía encontrada, venta): caja 9 847 600, inventario 3 400 000, por cobrar 500 000, deudas 2 000 000, valor 11 947 600, capital aportado 11 100 000, crecimiento 847 600 = ganancia neta 837 600 − ajuste 10 000 + mercancía encontrada 20 000 | ✅ |
| Capital por inventario | El gasto general no cuenta al filtrar un inventario (caja +50 000, crecimiento 897 600) y la identidad del crecimiento se cumple igual | ✅ |
| Serie mensual | Diciembre (solo mercancía aportada: crecimiento 0), enero (valor 11 687 600, crecimiento 387 600 = ganancia de enero), suma de crecimientos mensuales = crecimiento total, último punto = hoy | ✅ |
| Métricas | Rentabilidad de febrero 450 000 ÷ 11 687 600, rotación 1 180 000 ÷ 3 980 000, dinero dormido por antigüedad | ✅ |
| Deudas | Abonos, intereses como gasto financiero, estado "Pagada", sobrepago rechazado, anular abono reabre, anular deuda con abonos o de compra bloqueado, compra con deuda parcial (solo sale de caja lo de contado) | ✅ |
| Préstamos a ti | Devolver más de lo prestado se rechaza; anular un préstamo ya devuelto en parte se bloquea; un retiro no cambia el crecimiento | ✅ |
| Comisiones | 3 % de 80 000 = 2 400 como gasto; 0 % en efectivo; valor manual y 0 respetados | ✅ |
| Precios | Historial y "desactualizado" a los 30 días, tu precio real, sugerido, mínimo en pesos y %, máximo de compra con descuentos por batería y pieza, sin desvíos por coma flotante (1 500 000 × 1,1 = 1 650 000) | ✅ |
| Ganancia por día y proveedores | Casos calculados: 12 500/día y 20 000/día; puntajes 93 y 38 con sus componentes | ✅ |
| Historial de piezas | Al ingresar, editar, quitar; "otra" exige descripción; reparación pagada agrega pieza enlazada y suma costo; anotar piezas no cambia el costo | ✅ |
| Estancado opcional y por estado | Nuevos 30 días / usados con el general / usados 90; apagado = sin avisos pero con dinero dormido | ✅ |
| Tono cercano | Prueba que recorre todo el código y falla si aparece una forma de "usted" | ✅ |
| PDF del resumen | Estructura del PDF (tabla xref, imagen completa, tamaño A4) | ✅ |
| E2E v2 (modo sencillo) | Aporte → compra con tarjeta, estado "Usado" y pieza genérica con aviso → ficha con etiquetas → precio de mercado → venta con "Usar sugerido", aviso de venta bajo el costo y comisión 60 000 → abono con intereses → Capital: caja 11 420 000, valor 10 420 000, crecimiento 420 000 → calculadora 1 750 000 → resumen mensual descargado como PNG y PDF válidos | ✅ (Chromium) |
| E2E ayuda | Primeros pasos (0 → 1 → 2 de 7), "?" de Inicio, "Llévame ahí", buscador sin tildes, ⓘ con fórmula, manual completo | ✅ (Chromium) |
| E2E modo práctica | Base aparte con datos de ejemplo; al salir, los datos reales siguen y los de práctica no aparecen | ✅ (Chromium) |
| Todas las pantallas | 46 rutas sin errores de consola ni desbordes; el "?" abre su ayuda en 25 o más de ellas | ✅ (Chromium) |
| Diseño adaptable | 18 pantallas × 8 tamaños (320 a 1280 px) sin desborde horizontal | ✅ (Chromium) |

## Errores reales encontrados y corregidos durante las pruebas (v2)

1. **Costo completado después de vender (v1):** los movimientos de la unidad no se actualizaban; con el capital nuevo eso hacía que el crecimiento no cuadrara con la ganancia. Ahora se corrigen al completar el costo y en la migración.
2. **Baja de una unidad con costo desconocido y una reparación pagada (v1):** el costo de la reparación nunca se reconocía como pérdida. Corregido (y migrado).
3. **Redondeo:** el precio mínimo de 1 500 000 con 10 % daba 1 650 001 por coma flotante. Corregido con tolerancia.
4. **Resumen mensual:** contaba las deudas abiertas hoy en lugar de las abiertas al cierre del mes. Corregido.
5. **Gasto de intereses anulable por fuera de su abono:** dejaba el abono incoherente. Ahora se anula solo desde el abono.

Errores corregidos en la v1 (siguen cubiertos por las pruebas): recarga inesperada en la primera visita, diálogos que enviaban el formulario de fondo, consultas repetidas sin parar y etiquetas partidas a 320 px.

## Pruebas de la versión 1 (siguen pasando)

Las 24 pruebas obligatorias de la v1 (inventarios y modos, compras, ventas, stock insuficiente, ventas duplicadas, finanzas con caso conocido, cobros, gastos sin doble descuento, devoluciones, días en inventario, fechas desconocidas, vistas consolidadas, respaldo y restauración, archivos corruptos, conflictos al importar, persistencia, sin conexión, diseño, migraciones y privacidad) siguen en `tests/unit` y `tests/e2e` y pasan con la v2.

## Lo que NO se pudo probar aquí (y por qué)

| Aspecto | Motivo | Cómo probarlo |
|---|---|---|
| Safari / iOS (instalación, almacenamiento, compartir imagen/PDF con Web Share, selector de Archivos, impresión del manual) | No hay WebKit ni iPhone en este entorno | Lista de verificación de abajo |
| APK en un teléfono Android (botón Atrás, compartir nativo de imagen/PDF, selector de archivos, cámara, márgenes) | El APK se compila y firma en GitHub Actions, pero no hay un teléfono para instalarlo | Lista de abajo |
| Actualización real v1 → v2 en un teléfono | Probada con la base real de la v1 en Chromium y en la capa de datos; no en un teléfono con datos reales | Hacer un respaldo antes de actualizar (lista, paso 1) |
| Actualización v2 → v2.1 en el navegador | Probada en la capa de datos (fake-indexeddb con el mismo código Dexie); no se repitió en Chromium ni en un teléfono | Hacer un respaldo antes de actualizar |
| Sonidos reales y modo silencio del iPhone | En Chromium se comprobó qué sonido se dispara y la opción de la sesión de audio (simulada), no cómo se oye | Apariencia, sonidos y voz → ▶ en cada uno, con y sin silencio |
| Voz real | Chromium no trae voces; se probó con una voz simulada. En Android usa un plugin nativo que solo se compila en GitHub Actions | Apariencia, sonidos y voz → Escuchar un ejemplo; hacer un recorrido |
| Transferencia real entre un iPhone y un Android | Requiere dos dispositivos físicos | Lista de abajo |

## Lista de verificación en dispositivos físicos (≈ 20 minutos por teléfono)

1. **Antes de actualizar de la v1:** Respaldo → Preparar respaldo → guardarlo fuera del teléfono.
2. Actualizar (iPhone: abrir la app con internet y tocar "Actualizar ahora"; Android: instalar el APK nuevo encima, sin desinstalar). Debe salir "¡Novedades!" y tus datos deben seguir ahí.
3. Capital → Aporte: registrar el dinero con el que empiezas. Revisar que la caja tenga sentido; si no, "Cuadrar caja".
4. Registrar una compra con "Tarjeta de crédito" y una pieza cambiada; ver la deuda en Deudas y la pieza en la ficha.
5. Precios de mercado → anotar un precio; Registrar venta → "Usar sugerido".
6. Resumen mensual → "Compartir imagen" y "Compartir PDF": debe abrir el menú nativo (WhatsApp, AirDrop, Drive…).
7. Ayuda → Manual completo → descargar/compartir el PDF.
8. Ayuda → Modo práctica → entrar, mirar, salir: tus datos reales deben estar intactos.
9. **Cierre forzado y reinicio del teléfono:** los datos siguen ahí.
10. **Sin conexión:** modo avión, reabrir y registrar una venta.
11. **Entre teléfonos:** exportar en uno, importar en el otro y comprobar los totales.
12. Android: el botón Atrás cierra diálogos, vuelve atrás y en Inicio sale de la app.
13. **v2.1:** compra unos audífonos a dos precios distintos y mira los lotes en la ficha; registra el pasaje en "Gasto del viaje de compras"; registra un gasto personal; haz el recorrido "Conoce la app"; en Apariencia, sonidos y voz toca ▶ en cada sonido y apaga uno.
14. **v2.2:** Más → Apariencia, sonidos y voz: prueba los colores, el modo oscuro, el degradado y el modo lite; toca "Escuchar un ejemplo" (si no hay voz en español, en Android toca "Instalar voces"); haz el recorrido "Conoce la app" y silencia con la bocina; en iPhone activa "Sonar aunque el iPhone esté en silencio" y prueba con el interruptor de silencio.

## Cómo volver a ejecutar las pruebas

```bash
npm ci
npm test                     # 88 pruebas de lógica (~5 s)
npm run build
npx playwright test          # 24 pruebas E2E (~7 min). Requiere el navegador Chromium de Playwright
```

Para regenerar el manual en PDF (después de cambiar la ayuda): `npm run build`, `npm run preview` en otra terminal y `node scripts/make-manual-pdf.mjs`; luego `npm run build` otra vez.
