# Inventario Móvil

App en español para llevar el inventario de un negocio de teléfonos (sobre todo iPhone), audífonos y accesorios: compras, ventas, pagos, devoluciones, gastos, proveedores, compradores, garantías, **capital, deudas y precios**. Calcula la rentabilidad, cuánto vale y cuánto crece el negocio, y cuánto tarda cada producto en venderse. Trabaja con pesos colombianos (COP).

- **iPhone:** se instala como app web (PWA) desde Safari, sin App Store.
- **Android:** se instala con un archivo APK, sin Google Play.
- **Sin servidor, sin cuentas y sin nube.** Cada teléfono guarda sus propios datos. Para pasar datos de un teléfono a otro se exporta e importa un archivo de respaldo, de forma manual.

**Instalar o actualizar:**
- **iPhone:** abre <https://nazcar1000rr.github.io/inventario-movil/> en Safari → Compartir → *Añadir a pantalla de inicio*. Si ya la tienes, ábrela con internet y toca *Actualizar ahora*.
- **Android:** descarga <https://github.com/Nazcar1000rr/inventario-movil/releases/latest/download/inventario-movil.apk> e instálalo (para actualizar, instálalo encima, sin desinstalar).
- **Al pasar de la v1 a la v2 tus datos se convierten solos.** Igual, haz un respaldo antes de actualizar.

> Guía de instalación: **[docs/INSTALACION.md](docs/INSTALACION.md)** · Manual de uso: **[docs/Manual-Inventario-Movil.pdf](docs/Manual-Inventario-Movil.pdf)** (también dentro de la app, en Más → Ayuda)
> Arquitectura, modelo de datos y fórmulas: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)** · Pruebas y resultados reales: **[docs/PRUEBAS.md](docs/PRUEBAS.md)**

---

## Estado de la entrega (honesto)

| Elemento | Estado |
|---|---|
| Código fuente completo (PWA + proyecto Android), versión 2.0.0 | ✅ Terminado |
| Lógica de negocio y base de datos local | ✅ 64 pruebas automáticas, todas aprobadas |
| Interfaz | ✅ 17 pruebas de extremo a extremo en Chromium, todas aprobadas |
| Conversión automática de los datos de la v1 | ✅ Probada con una base real de la v1 (en la capa de datos y en el navegador) y con respaldos de la v1 |
| PWA publicada en HTTPS | ✅ Versión 2.0.0 publicada con GitHub Pages (comprobado que la dirección sirve la compilación nueva). Se republica en cada cambio |
| APK de Android | ✅ Versión 2.0.0 (compilación 6) compilada y firmada en GitHub Actions y publicada en *Releases*. Comprobado que está firmado con la misma clave que la v1 (se puede instalar encima) |
| Clave de firma del APK | Entregada **por separado** (no está en el código) |
| Pruebas en iPhone o Android físicos, o en Safari | ⛔ **No realizadas** (no hay dispositivos ni Safari/WebKit en este entorno). Ver la lista de verificación en docs/PRUEBAS.md |

## Funciones

**Inventario**
- Inventarios múltiples (crear, renombrar, archivar, eliminar con confirmación escrita) en modo **sencillo** o **profesional** (cambiar de modo no borra nada) y **vistas consolidadas** que suman varios sin duplicar.
- Productos **por unidad** (teléfonos, con código interno permanente IPH-0001…, IMEI, serial, batería, inspección de 16 puntos, fotos) o **por cantidad** (accesorios, costo promedio ponderado).
- **Estado del equipo** al ingresarlo, en los dos modos: Nuevo, Usado o Restaurado.
- **Historial de reparaciones y piezas** por equipo, también en modo sencillo: batería, pantalla, tapa, cámaras, Face ID/Touch ID, puerto, altavoz, chasis, placa u otra; calidad original/genérica/no sé; quién la cambió; aviso de "pieza desconocida". Etiquetas y filtros en las listas. Solo las reparaciones pagadas suman costo.
- Catálogo de iPhone X a los anunciados en septiembre de 2026, AirPods, y editable (marcas y modelos de Android).

**Compras y ventas**
- Compras con varios productos, gastos repartidos al peso, IMEI por unidad y **forma de pago**: caja, tarjeta de crédito, crédito del proveedor u otra deuda (total o parcial).
- Ventas con unidad más antigua o elegida, descuentos, pagos parciales y posteriores, garantía, gastos y entrega. Doble pulsación no duplica.
- **Ayuda de precio al vender:** costo, precio mínimo, precio de mercado, "tu precio real" (promedio de tus ventas de los últimos 90 días) y precio sugerido; aviso si vendes por debajo del costo o del mínimo.
- **Comisiones por medio de pago** (por ejemplo, datáfono 3 %): se registran solas como gasto.
- Devoluciones (la venta original se conserva) y anulaciones trazables. Gastos operativos y capitalizados sin restar dos veces.

**Dinero**
- **Capital:** valor del negocio, capital aportado (incluida la mercancía que ya tenías), crecimiento, caja calculada y "Cuadrar caja", por inventario o global; gráfica mensual del valor y del crecimiento; "¿Dónde está tu dinero?".
- **Aportes, retiros, préstamos a ti** (dinero de la inversión que tomas y devuelves) y ajustes de caja.
- **Deudas y préstamos:** tarjeta de crédito, proveedores, préstamos de terceros, con abonos e intereses (gasto financiero).
- **Métricas:** rentabilidad del periodo, rotación del inventario, días para recuperar el inventario y dinero dormido. **Metas** con ritmo mensual necesario.

**Precios**
- **Precios de mercado** por modelo + capacidad + estado, con fecha, historial y aviso de desactualizado (30 días).
- **Calculadora "¿Cuánto pagar?":** precio máximo de compra según mercado, margen deseado (pesos o %), gastos esperados y descuentos opcionales por batería y piezas genéricas.

**Informes**
- Finanzas por periodo con comparación, tiempos de venta, más vendidos, **ganancia por día por modelo** y **calificación de proveedores** (0–100).
- **Estancado opcional**, con días distintos para nuevos y usados/restaurados.
- **Resumen mensual** para compartir como **imagen o PDF**.
- Avisos al abrir: stock bajo, estancados, garantías, cobros pendientes, duplicados y respaldo vencido.

**Ayuda**
- Lista de **primeros pasos**, botón **?** en cada pantalla, **ⓘ** en cada número con su fórmula, **manual con buscador** y "Llévame ahí", **modo práctica** con datos de ejemplo en una base aparte, **novedades** después de actualizar y **manual en PDF**.
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
npm run android:sync   # compilar y copiar la app al proyecto Android
npm run android:apk    # compilar el APK (requiere Android SDK y android/keystore.properties)
```

## Estructura

```
src/core/            Lógica de negocio sin interfaz (reutilizable)
  types.ts           Modelo de datos
  db.ts              Esquema IndexedDB (Dexie), versiones y migración v1 → v2
  catalog.ts         Catálogo base, puntos de inspección, piezas y estados del equipo
  services/          Inventarios, productos, compras, ventas, gastos, garantías, vistas,
                     informes, capital, deudas, precios, rentabilidad, integridad,
                     respaldo, búsqueda
src/ui/              Interfaz React (pantallas, componentes, navegación)
  help/content.ts    Manual, explicaciones de métricas, ayuda por pantalla y novedades
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
- **iPhone:** usa siempre la app instalada (iOS puede borrar los datos de pestañas de Safari tras 7 días sin uso). No hay notificaciones en segundo plano: los avisos aparecen al abrir la app.
- **No implementado:** escaneo o generación de QR/códigos de barras, impresión de etiquetas, estado "reservado", combinar dos respaldos (la importación siempre reemplaza, con opción de deshacer), convertir un producto de "por cantidad" a "por unidad", y saldo a favor del dueño (cuando el negocio te debe a ti; regístralo como aporte).
- Los importes de una compra o venta no se editan: se anula y se registra de nuevo para que todo quede trazable.
- La batería del iPhone se ingresa a mano: la app no la lee del equipo.
