# Inventario Móvil

App en español para llevar el inventario de un negocio de teléfonos (sobre todo iPhone), audífonos y accesorios: compras, ventas, pagos, devoluciones, gastos, proveedores, compradores, garantías, **capital, deudas y precios**, **personas que te deben (fiados) con cobro por WhatsApp**, **análisis del negocio con gráficas**, **calendario con recordatorios**, **notas** y un contador de **preguntones**, con **lotes por precio de compra**, **gastos personales**, **lecciones de negocios** para quien está empezando, **lectura en voz alta**, **colores a elegir** y **sonidos**. Calcula la rentabilidad, cuánto vale y cuánto crece el negocio, y cuánto tarda cada producto en venderse. Trabaja con pesos colombianos (COP).

- **iPhone:** se instala como app web (PWA) desde Safari, sin App Store.
- **Android:** se instala con un archivo APK, sin Google Play.
- **Sin servidor, sin cuentas y sin nube.** Cada teléfono guarda sus propios datos. Para pasar datos de un teléfono a otro se exporta e importa un archivo de respaldo, de forma manual.

**Instalar o actualizar:**
- **iPhone:** abre <https://nazcar1000rr.github.io/inventario-movil/> en Safari → Compartir → *Añadir a pantalla de inicio*. Si ya la tienes, ábrela con internet y toca *Actualizar ahora*.
- **Android:** descarga <https://github.com/Nazcar1000rr/inventario-movil/releases/latest/download/inventario-movil.apk> e instálalo (para actualizar, instálalo encima, sin desinstalar).
- **Al actualizar (de la v1, la v2 o la 2.2 a la 2.3) tus datos se convierten solos.** Igual, haz un respaldo antes de actualizar.
- **Logo nuevo (2.2):** en Android cambia al instalar el APK encima. En iPhone, el ícono de la pantalla de inicio normalmente no se actualiza solo; para verlo hay que quitar y volver a agregar la app, y eso borra sus datos: haz un respaldo antes e impórtalo después.

> Guía de instalación: **[docs/INSTALACION.md](docs/INSTALACION.md)** · Manual de uso: **[docs/Manual-Inventario-Movil.pdf](docs/Manual-Inventario-Movil.pdf)** (también dentro de la app, en Más → Ayuda)
> Arquitectura, modelo de datos y fórmulas: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)** · Pruebas y resultados reales: **[docs/PRUEBAS.md](docs/PRUEBAS.md)**

---

## Estado de la entrega (honesto)

| Elemento | Estado |
|---|---|
| Código fuente completo (PWA + proyecto Android), versión 2.3.0 | ✅ Terminado |
| Lógica de negocio y base de datos local | ✅ 119 pruebas automáticas, todas aprobadas |
| Interfaz | ✅ 36 pruebas de extremo a extremo en Chromium, todas aprobadas |
| Conversión automática de los datos de la v1 | ✅ Probada con una base real de la v1 (en la capa de datos y en el navegador) y con respaldos de la v1 |
| Conversión automática de los datos de la v2 (lotes) | ✅ Probada con una base real de la v2 y con respaldos de la v2 (en la capa de datos, con el mismo código Dexie de la app) |
| PWA publicada en HTTPS | ✅ Versión 2.3.0 publicada con GitHub Pages (comprobado que la dirección sirve la compilación nueva, versión cae583406f28). Se republica en cada cambio |
| APK de Android | ✅ Versión 2.3.0 (compilación 10) compilada y firmada en GitHub Actions y publicada en *Releases*, con el motor de voz y las notificaciones locales de Android incluidos. Comprobado que está firmado con la misma clave de siempre (se puede instalar encima), que trae la compilación 2.3.0 (cae583406f28) y los permisos de notificaciones |
| Clave de firma del APK | Entregada **por separado** (no está en el código) |
| Pruebas en iPhone o Android físicos, o en Safari | ⛔ **No realizadas** (no hay dispositivos ni Safari/WebKit en este entorno): tampoco las notificaciones reales, abrir WhatsApp ni el calendario del iPhone. Ver la lista de verificación en docs/PRUEBAS.md |

## Funciones

**Inventario**
- Inventarios múltiples (crear, renombrar, archivar, eliminar con confirmación escrita) en modo **sencillo** o **profesional** (cambiar de modo no borra nada) y **vistas consolidadas** que suman varios sin duplicar.
- Productos **por unidad** (teléfonos, con código interno permanente IPH-0001…, IMEI, serial, batería, inspección de 16 puntos, fotos) o **por cantidad** (accesorios, costo promedio ponderado).
- **Lotes por precio de compra** (accesorios y audífonos): cada compra guarda su precio; al vender sale primero lo más antiguo o el lote que elijas, con su costo y precio mínimo. Se apaga por producto (costo promedio) y se puede volver a prender.
- **Teléfonos agrupados por compra** ("Compra del 10 oct · 3 disponibles · $X c/u").
- **Estado del equipo** al ingresarlo, en los dos modos: Nuevo, Usado o Restaurado.
- **Historial de reparaciones y piezas** por equipo, también en modo sencillo: batería, pantalla, tapa, cámaras, Face ID/Touch ID, puerto, altavoz, chasis, placa u otra; calidad original/genérica/no sé; quién la cambió; aviso de "pieza desconocida". Etiquetas y filtros en las listas. Solo las reparaciones pagadas suman costo.
- Catálogo de iPhone X a los anunciados en septiembre de 2026, AirPods, y editable (marcas y modelos de Android).

**Compras y ventas**
- Compras con varios productos, gastos repartidos al peso, IMEI por unidad y **forma de pago**: caja, tarjeta de crédito, crédito del proveedor u otra deuda (total o parcial).
- **"La última vez pagaste…"** con ▲/▼ y el último precio de cada proveedor; **aviso al comprar más barato** que lo que ya tienes (cuánto más te costó y su precio mínimo).
- **Gastos del viaje de compras:** agregar un gasto a una compra ya registrada o repartirlo entre las compras del día (lo que sigue en existencia sube de costo; lo ya vendido queda como gasto).
- Ventas con unidad más antigua o elegida, descuentos, pagos parciales y posteriores, garantía, gastos y entrega. Doble pulsación no duplica.
- **Corregir sin volver a crear (2.3):** cantidad y costo de una compra, de una entrada de stock o del stock que ya tenías, el costo de un teléfono y el precio de venta. La ganancia de las ventas que ya hiciste se recalcula sola y cada corrección queda en el historial como "Corrección" (nada se borra).
- **Ayuda de precio al vender:** costo, precio mínimo, precio de mercado, "tu precio real" (promedio de tus ventas de los últimos 90 días) y precio sugerido; aviso si vendes por debajo del costo o del mínimo.
- **Comisiones por medio de pago** (por ejemplo, datáfono 3 %): se registran solas como gasto.
- Devoluciones (la venta original se conserva) y anulaciones trazables. Gastos operativos y capitalizados sin restar dos veces.

**Dinero**
- **Capital:** valor del negocio, capital aportado (incluida la mercancía que ya tenías), crecimiento, caja calculada y "Cuadrar caja", por inventario o global; gráfica mensual del valor y del crecimiento; "¿Dónde está tu dinero?".
- **Aportes, retiros, préstamos a ti** (dinero de la inversión que tomas y devuelves) y ajustes de caja.
- **Gastos personales** (gustos, gastos hormiga): te dice si salen de las ganancias del mes o del capital, con consejos ("la plata del negocio es del negocio") que se pueden apagar.
- **Deudas y préstamos:** tarjeta de crédito, proveedores, préstamos de terceros, con abonos e intereses (gasto financiero).
- **Métricas:** rentabilidad del periodo, rotación del inventario, días para recuperar el inventario y dinero dormido. **Metas** con ritmo mensual necesario.

**Personas que te deben (2.3)**
- **Fiar mercancía** desde la venta (queda como venta por cobrar), **"le presté plata"** y **"ya me debía de antes"**.
- **Abonos con fecha** que se reparten solos de la deuda más antigua a la más nueva; el saldo baja en cada abono.
- Fecha en que prometió pagar (con aviso de vencido), recordatorio en el calendario, botón para llamar y **"No me va a pagar"** (queda como pérdida, se puede deshacer).
- **Cobrar por WhatsApp:** escribes el mensaje (o eliges uno de ejemplo: amable, con la fecha de pago o más firme, con el detalle de lo que debe si quieres) y se abre el chat de esa persona en WhatsApp con el texto listo. La app no envía nada por su cuenta. Si la persona no tenía número, lo escribes y queda en su ficha.

**Análisis del negocio (2.3)**
- **Salud del negocio** (0–100) en 5 partes, **lo que esperas ganar** con lo que tienes en stock, **expectativas semanales y mensuales** (la app propone una con tus ventas y tú la cambias) con avance, cumplida/no cumplida e historial.
- Tendencias con tabla exacta, comparación con el mes anterior, **productos estrella (ABC)**, **cuánto demoras en promedio en vender** cada producto, punto de equilibrio, **cascadas de la ganancia y del dinero**, mejores días y horas para vender.
- Gráficas animadas que muestran el valor exacto al tocarlas y con **"Ver los números"** en cada una.

**Preguntones, calendario y notas (2.3)**
- **Preguntones:** un botón para contar a quien pregunta y no compra (guarda la fecha y la hora) y **"Me compró"** para restarlo; cuántas personas preguntan por cada venta, por semana y por mes.
- **Calendario** con notas (nombre y descripción opcional) y **recordatorios los días antes que elijas**. En Android salen como **notificaciones del teléfono aunque la app esté cerrada**; en iPhone aparecen al abrir la app y puedes pasar la nota al calendario del iPhone para que él te avise.
- **Notas:** libreta para pedidos, ideas y listas, con título opcional, fijar arriba, buscador sin tildes, compartir, pasar al calendario y deshacer al borrar.

**Precios**
- **Precios de mercado** por modelo + capacidad + estado, con fecha, historial y aviso de desactualizado (30 días).
- **Calculadora "¿Cuánto pagar?":** precio máximo de compra según mercado, margen deseado (pesos o %), gastos esperados y descuentos opcionales por batería y piezas genéricas.

**Informes**
- Finanzas por periodo con comparación, tiempos de venta, más vendidos, **ganancia por día por modelo** y **calificación de proveedores** (0–100).
- **Estancado opcional**, con días distintos para nuevos y usados/restaurados.
- **Resumen mensual** para compartir como **imagen o PDF**.
- Avisos al abrir: stock bajo, estancados, garantías, cobros pendientes, duplicados y respaldo vencido.

**Ayuda**
- **Menús por categorías (2.3):** el botón + y el menú Más agrupados (vender y cobrar, comprar, gastos, tu plata, anotar…).
- Lista de **primeros pasos**, botón **?** en cada pantalla, **ⓘ** en cada número con su fórmula, **manual con buscador** y "Llévame ahí", **modo práctica** con datos de ejemplo en una base aparte, **novedades** después de actualizar y **manual en PDF**.
- **Recorridos guiados** sobre las pantallas reales (con **Omitir** en cada paso, **Repetir primeros pasos** y la opción de no ofrecerlos) y **Aprende de negocios**: 16 lecciones con ejemplos, calculadoras y preguntas. **Consejo del día** en Inicio.
- **Lectura en voz alta** de recorridos, explicaciones ⓘ, ayuda y lecciones (con sus preguntas), con bocina 🔊/🔇 para silenciar y, mientras lee, una barrita con **Callar** y **Silenciar**; voz y velocidad a elegir. Usa las voces del teléfono, sin internet.
- **Sonidos** en 6 paquetes (Suave, Caja registradora, Burbujas, Retro, Cristal, Madera), con tono propio y interruptor por sonido, y opción de sonar con el iPhone en silencio (iOS 17 o superior).
- **Apariencia:** modo claro/oscuro/automático, 6 colores, estilo sólido o con degradados, animaciones y **modo lite** sin animaciones.
- Tono cercano (tú) en toda la app.

**Respaldo:** formato propio con suma SHA-256 y **cifrado AES-256 opcional**, menú nativo para compartir, importación verificada en una base temporal, reemplazo atómico y **deshacer**. Los respaldos de la v1 se convierten al importarlos.

## Comandos

Requiere Node.js 22 o superior.

```bash
npm ci                 # instalar dependencias
npm run dev            # desarrollo en http://localhost:5173
npm test               # pruebas de lógica (Vitest + IndexedDB simulada)
npm run build          # compilación de producción en dist/ (incluye sw.js)
npm run preview        # servir dist/ en http://localhost:4173
npx playwright test    # pruebas de extremo a extremo (requiere build previo y Chromium de Playwright)
node scripts/make-manual-pdf.mjs  # regenerar el manual en PDF (con preview corriendo)
node scripts/make-icons.mjs        # regenerar íconos y splash desde el logo (requiere sharp)
npm run android:sync   # compilar y copiar la app al proyecto Android
npm run android:apk    # compilar el APK (requiere Android SDK y android/keystore.properties)
```

## Estructura

```
src/core/            Lógica de negocio sin interfaz (reutilizable)
  types.ts           Modelo de datos
  db.ts              Esquema IndexedDB (Dexie), versiones y migraciones v1 → v2 → v3 → v4
  lots.ts            Lotes: consumo y reconstrucción desde el historial (funciones puras)
  catalog.ts         Catálogo base, puntos de inspección, piezas y estados del equipo
  services/          Inventarios, productos, lotes, compras, ventas, gastos, garantías,
                     vistas, informes, capital, deudas, precios, rentabilidad,
                     historial de precios de compra, gastos personales,
                     correcciones, análisis del negocio, preguntones,
                     calendario, notas, personas que te deben (y WhatsApp),
                     integridad, respaldo, búsqueda
src/ui/              Interfaz React (pantallas, componentes, navegación)
  help/content.ts    Manual, explicaciones de métricas, ayuda por pantalla, novedades y consejos
  help/lessons.ts    Lecciones de "Aprende de negocios"
  tour.tsx           Recorridos guiados
  sound.ts           Sonidos y paquetes de tonos (Web Audio)
  speech.ts          Lectura en voz alta (Web Speech / motor de voz de Android)
  reminders.ts       Notificaciones locales de Android y archivo .ics para el iPhone
  menu.ts            Menús por categorías (Más, barra lateral y botón +)
  theme.ts           Colores, modo oscuro, degradados y animaciones
  practice.ts        Datos de ejemplo del modo práctica
  summary-render.ts  Imagen y PDF del resumen mensual
src/main.tsx         Arranque, service worker y botón Atrás de Android
public/              Manifiesto, iconos y manual en PDF
scripts/             Generación de sw.js, iconos y manual en PDF
android/             Proyecto nativo Android (Capacitor 8)
tests/unit/          Pruebas de lógica
tests/e2e/           Pruebas de extremo a extremo (Playwright)
docs/                Instalación, arquitectura, pruebas, manual y capturas
.github/workflows/   Compilación del APK y publicación de la PWA
```

## Limitaciones conocidas

- **Los datos viven solo en el teléfono.** Desinstalar la app (Android), quitarla de la pantalla de inicio (iPhone) o borrar los datos del navegador elimina la base de datos. La app recuerda hacer respaldos, pero guardarlos fuera del teléfono depende de ti.
- **La caja es calculada** con lo que registras. Si no registras el dinero con el que empiezas, algún gasto o un retiro, no coincidirá con la realidad: usa "Cuadrar caja".
- **Los precios de mercado los anotas tú:** la app no consulta Marketplace ni ningún sitio (no se conecta a internet).
- **iPhone:** usa siempre la app instalada (iOS puede borrar los datos de pestañas de Safari tras 7 días sin uso). Apple no deja que una app web programe notificaciones sin un servidor, así que los recordatorios del calendario aparecen al abrir la app; para que el iPhone te avise con la app cerrada, usa *Agregar al calendario del iPhone* (archivo .ics con sus avisos).
- **Android:** las notificaciones necesitan el permiso de notificaciones; si las "alarmas exactas" están apagadas (Android 12 o superior), el aviso puede llegar unos minutos tarde. Algunos teléfonos con ahorro de batería agresivo pueden retrasarlas.
- **No implementado:** escaneo o generación de QR/códigos de barras, impresión de etiquetas, estado "reservado", combinar dos respaldos (la importación siempre reemplaza, con opción de deshacer), convertir un producto de "por cantidad" a "por unidad", y saldo a favor del dueño (cuando el negocio te debe a ti; regístralo como aporte).
- Los importes de una venta no se editan: se anula o se registra una devolución. Las compras y entradas de stock sí se corrigen (con movimientos de corrección fechados, sin borrar el historial).
- La batería del iPhone se ingresa a mano: la app no la lee del equipo.
- El avance de los recorridos y las lecciones y las preferencias de apariencia, sonido y voz se guardan solo en el teléfono (no van en el respaldo).
- La voz depende de las voces en español que tenga el teléfono: si no hay ninguna que funcione sin internet, la lectura en voz alta no aparece.
- Los lotes son para productos por cantidad; los teléfonos ya guardan el costo de cada unidad.
