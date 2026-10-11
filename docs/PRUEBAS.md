# Pruebas: lo ejecutado y lo pendiente

Fecha de ejecución: 11 de octubre de 2026 (versión 2.3.0).

Entorno:
- Linux con Node 22.22.
- Vitest 5.0.3 + fake-indexeddb 6.2.5: implementación de IndexedDB conforme al estándar, sobre la que corre el mismo código Dexie de la app.
- Playwright 1.56 con Chromium 141 (compilación 1194), contra la **compilación de producción** (`npm run build` + `vite preview`).

**Resultado: 119/119 pruebas de lógica y 36/36 pruebas de extremo a extremo aprobadas.** `tsc` (TypeScript 7.0.2, modo estricto) no reporta errores.

## Versión 2.3: qué se probó

| Tema | Cómo se verificó | Resultado |
|---|---|---|
| Corregir una compra | Cantidad mal digitada (se conserva lo pagado, cambia el costo por unidad y la ganancia de lo ya vendido); costo por unidad mal digitado (cambia lo pagado, la caja, la venta y la pérdida de lo dado de baja); gastos repartidos en varias líneas; compra con deuda; costo promedio con y sin salidas posteriores; teléfonos: precio, quitar uno que no venía, agregar uno que faltó; bloqueos (menos de lo que ya salió, devoluciones, unidad vendida). Después de cada corrección: libro de movimientos = valor del stock, costo de cada unidad = movimientos + capitalizado y crecimiento del capital = ganancia (diferencia 0) | ✅ |
| Corregir stock que ya tenías | Completar el costo desconocido de un lote (ventas y bajas pasan a tener costo), cantidad y costo de stock existente y de un ajuste, costo de un teléfono ya vendido. E2E: completar 9 000 por unidad con 2 vendidas → costo de lo vendido 18 000 | ✅ (Chromium) |
| Análisis del negocio | Periodos de lunes a domingo, expectativa automática (promedio de meses con ventas) editable y "volver a la automática", ganancia esperada con existencias, ritmo, punto de equilibrio, cascadas que cuadran, 80/20, salud, comparación, tiempo de venta (promedio, mediana, rangos, por producto). E2E: gráficas con valor al tocar, tabla "Ver los números" y expectativa editable | ✅ |
| Preguntones | +1 guarda fecha y hora; "Me compró" marca el más reciente; análisis semanal y mensual (personas por venta, conversión). E2E con el contador de Inicio | ✅ |
| Calendario | Notas con descripción opcional, avisos en los días elegidos, aviso dentro de la app, archivo .ics con 3 alarmas | ✅ (Chromium) |
| Me deben | Fiar mercancía, abonos con fecha de lo más antiguo a lo más nuevo, plata prestada y "ya me debía", "No me va a pagar" como pérdida (y deshacer); caja, capital y crecimiento cuadran | ✅ |
| Cobrar por WhatsApp | Número: 10 dígitos → 57…, +57, 0057, otro país, inválidos. Enlace `wa.me` con el mensaje codificado. E2E: desde la venta pendiente, número de la ficha, mensaje de ejemplo "más firme", mensaje escrito a mano → se abre `https://wa.me/573001234567?text=…` con ese texto; número inválido avisado; número corregido guardado en la ficha | ✅ (Chromium; WhatsApp simulado) |
| Notas | Crear desde el botón +, título opcional, fijar arriba, buscar sin tildes, pasar al calendario con el título, borrar y deshacer, se conservan al recargar y en el respaldo; doble toque no duplica | ✅ |
| Menús por categorías | E2E: el botón + muestra 5 categorías (Vender y cobrar con 4 opciones…); el menú Más, 7 categorías; sin desborde en 8 tamaños de pantalla | ✅ (Chromium) |
| Recorridos | E2E: «Omitir» cierra y marca "Omitido"; «Repetir primeros pasos» vuelve a mostrar la lista de Inicio y empieza «Conoce la app» (10 pasos); «Terminar aquí» no sigue con el siguiente; "No ofrecerme recorridos" quita la invitación de Inicio | ✅ (Chromium) |
| Callar la voz | E2E con voz simulada que sigue hablando: aparece la barra «Leyendo»; «Callar» corta la lectura (se cancela la voz) y no vuelve a empezar; «Silenciar» apaga la lectura automática en toda la app | ✅ (Chromium, voz simulada) |
| Sonidos al volver a la app | E2E con un audio simulado que imita al iPhone: al salir de la app queda "interrumpido" y no responde; al volver, el primer toque crea un audio nuevo y el sonido suena (el viejo se cierra). Sin el arreglo, esta prueba no sonaba | ✅ (Chromium, audio simulado) |
| Migración 2.2 → 2.3 | Respaldos de la 2.1/2.2 se convierten sin expectativas, notas ni fiados (tablas vacías); integridad sin problemas | ✅ |

### Errores reales encontrados y corregidos (v2.3)

1. **Sonidos mudos al volver a la app** (reportado por el usuario): el audio solo se reanudaba si estaba "en pausa"; en iPhone queda "interrumpido" y no volvía. Ahora se recrea con el primer toque al volver.
2. Al abrir "Corregir entrada", el cursor caía en la cantidad y lo que escribías en el costo podía terminar en la cantidad. Ahora, si el costo no se conoce, el cursor va directo al costo, y el foco inicial respeta el campo marcado.
3. Varios textos nuevos usaban formas que la prueba de tono marca ("toque", "sus datos"). Se reescribieron.
4. En el menú Más con mosaicos, "Compradores" y "Configuración" se partían a mitad de palabra. Se ajustó el tamaño y la división de palabras.

**No probado aquí (2.3):** notificaciones reales de Android (permiso, alarmas exactas, aviso con la app cerrada y después de reiniciar), agregar el .ics al Calendario del iPhone, abrir WhatsApp de verdad desde el APK y desde el iPhone, y los sonidos al volver de otra app en un teléfono real. Ver la lista de verificación.

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
| Notificaciones del calendario (Android) | El plugin de notificaciones solo funciona en la app nativa, que se compila en GitHub Actions; no hay teléfono para ver los avisos | Lista de abajo, paso 15 |
| Calendario del iPhone (.ics) y abrir WhatsApp | Se comprobó el archivo .ics (3 alarmas) y el enlace `wa.me` exacto en Chromium; no se abrieron en un iPhone ni en un Android | Lista de abajo, paso 15 |
| Sonidos al volver de otra app en un teléfono | Se probó con un audio simulado que se comporta como el del iPhone (queda "interrumpido") | Lista de abajo, paso 15 |
| Actualización 2.2 → 2.3 en el navegador | Probada con respaldos de la 2.2 y en la capa de datos; el cambio de esquema solo agrega tablas vacías | Hacer un respaldo antes de actualizar |

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
15. **v2.3:**
    - **Android:** Calendario → «Permitir notificaciones»; crea una nota para dentro de 10 minutos con aviso "el mismo día" a esa hora, cierra la app y espera la notificación; tócala (debe abrir la nota). Reinicia el teléfono con otra nota pendiente y comprueba que también avisa.
    - **iPhone:** abre una nota → «Agregar al calendario del iPhone» → Agregar; revisa que el Calendario del iPhone tenga el evento con sus alertas.
    - **WhatsApp:** fía algo a una persona con número → Me deben → «Cobrar por WhatsApp» → cambia el mensaje → debe abrirse su chat con ese texto.
    - **Sonidos:** con los sonidos prendidos, sal de la app sin cerrarla (abre WhatsApp), vuelve y toca un botón: debe sonar.
    - Corrige una compra (cantidad o costo) y revisa que la ganancia de una venta anterior cambie; mira Análisis del negocio, los preguntones, Notas y los menús + y Más por categorías; en un recorrido toca «Omitir» y luego «Repetir primeros pasos»; mientras la voz lee, toca «Callar».

## Cómo volver a ejecutar las pruebas

```bash
npm ci
npm test                     # 119 pruebas de lógica (~12 s)
npm run build
npx playwright test          # 36 pruebas E2E (~9 min). Requiere el navegador Chromium de Playwright
```

Para regenerar el manual en PDF (después de cambiar la ayuda): `npm run build`, `npm run preview` en otra terminal y `node scripts/make-manual-pdf.mjs`; luego `npm run build` otra vez.
