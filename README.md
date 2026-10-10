# Inventario Móvil

Aplicación en español para administrar el inventario de un negocio de teléfonos (sobre todo iPhone), audífonos y accesorios. Registra compras, ventas, pagos, devoluciones, gastos, proveedores, compradores y garantías, y calcula la rentabilidad y el tiempo que tarda cada producto en venderse. Trabaja con pesos colombianos (COP).

- **iPhone:** se instala como app web (PWA) desde Safari, sin App Store.
- **Android:** se instala con un archivo APK, sin Google Play.
- **Sin servidor, sin cuentas y sin nube.** Cada teléfono guarda sus propios datos. Para pasar datos de un teléfono a otro se exporta e importa un archivo de respaldo, de forma manual.

**Instalar:**
- **iPhone:** abrir <https://nazcar1000rr.github.io/inventario-movil/> en Safari → Compartir → *Añadir a pantalla de inicio*.
- **Android:** descargar <https://github.com/Nazcar1000rr/inventario-movil/releases/latest/download/inventario-movil.apk> e instalarlo (para actualizar, instalar encima sin desinstalar).

> Guía de instalación paso a paso: **[docs/INSTALACION.md](docs/INSTALACION.md)**
> Arquitectura, modelo de datos y reglas de cálculo: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**
> Pruebas ejecutadas y resultados reales: **[docs/PRUEBAS.md](docs/PRUEBAS.md)**

---

## Estado de la entrega (honesto)

| Elemento | Estado |
|---|---|
| Código fuente completo (PWA + proyecto Android) | ✅ Terminado |
| Lógica de negocio y base de datos local | ✅ Terminada. 40 pruebas automáticas, todas aprobadas |
| Interfaz (35 pantallas) | ✅ Terminada. 13 pruebas de extremo a extremo en Chromium, todas aprobadas |
| PWA (manifiesto, service worker, iconos, uso sin conexión) | ✅ Compilada y probada en Chromium |
| PWA publicada en una URL HTTPS | ✅ Publicada con GitHub Pages en https://nazcar1000rr.github.io/inventario-movil/ |
| APK de Android | ✅ Compilado y firmado en GitHub Actions (firma verificada). Se publica en Releases en cada cambio |
| Clave de firma del APK | ✅ Generada y entregada **por separado** (no está en el código) |
| Pruebas en iPhone o Android físicos, o en Safari | ⛔ **No realizadas** (no hay dispositivos ni Safari/WebKit en este entorno). Ver la lista de verificación en docs/PRUEBAS.md |

## Funciones implementadas

- **Inventarios múltiples:** crear, renombrar, archivar (sin perder historia), consultar el historial y eliminar de forma permanente con confirmación escrita.
- **Modo sencillo o profesional por inventario,** con un menú ⋮ para cambiarlo. El modo solo cambia lo que se ve en pantalla, no los datos, así que cambiar de modo no borra, duplica ni altera nada. Se puede elegir el modo por defecto para los inventarios nuevos.
- **Productos con control por unidad o por cantidad:**
  - **Por unidad** (teléfonos): cada equipo tiene su código interno permanente (IPH-0001…), IMEI y serial, color, capacidad, estado físico, batería, defectos, accesorios incluidos, fotos e historial.
  - **Por cantidad** (accesorios): se maneja con costo promedio ponderado.
- **Catálogo de modelos** desde el iPhone X hasta los anunciados en septiembre de 2026 (18 Pro, 18 Pro Max y Duo), con sus capacidades reales. También incluye AirPods. Es editable: se pueden agregar marcas y modelos de Android.
- **Compras:**
  - Varios productos por compra y gastos de la compra (transporte, etc.) repartidos al costo por precio o por unidad, con un reparto exacto al peso.
  - Proveedor y método de pago.
  - IMEI por unidad.
  - Anulación trazable.
- **Stock existente:** registra mercancía que ya tenía antes de usar la app, con costo o fecha "desconocidos" en lugar de inventarlos.
- **Ventas:**
  - Elección automática de la unidad más antigua o selección de unidades específicas, y descuento.
  - Pago completo, parcial o pendiente, y pagos posteriores.
  - Comprador, garantía, gastos de la venta (comisión, envío) y estado de entrega.
  - Confirmación antes de guardar. Una doble pulsación no crea dos ventas.
- **Devoluciones** como operación nueva: la venta original se conserva. Lo devuelto queda disponible, en revisión o dañado, y empieza un nuevo ciclo de disponibilidad. Las **anulaciones** de ventas registradas por error también son trazables.
- **Gastos operativos y costos capitalizados** (reparaciones, costos sumados a una unidad), separados para que nada se reste dos veces.
- **Finanzas:**
  - Ingresos netos, costo de lo vendido, ganancia bruta y neta, dinero cobrado frente a pendiente, inversión en compras y valor del inventario a costo.
  - Avisos cuando faltan costos (resultado "incompleto").
- **Panel e informes:**
  - Filtros por hoy, semana, mes, año o un periodo personalizado.
  - Filtro por inventario o vista consolidada.
  - Comparación con el mismo tramo del periodo anterior.
- **Tiempo en inventario y velocidad de venta:** antigüedad de lo no vendido, días hasta vender por modelo, categoría e inventario, lo que se vende más rápido, lo estancado y el % vendido.
- **Modo profesional:** inspección de 16 puntos con origen de la información (vendedor, revisión propia o técnico), reparaciones, garantías del proveedor, fotos (cámara o galería) e historial por unidad.
- **Garantías** con vencimiento calculado, reclamos y su costo, y aviso de las que están por vencer.
- **Vistas consolidadas:** suman varios inventarios sin duplicar nada. Para vender desde una vista se pide elegir el inventario de origen.
- **Búsqueda** por código interno, IMEI (también parcial), serial, modelo, proveedor o comprador.
- **Avisos al abrir la app:**
  - Stock bajo o agotado, productos estancados, garantías por vencer y reclamos pendientes.
  - Posibles duplicados (IMEI o producto repetido), cobros pendientes y respaldo vencido.
- **Respaldo completo:**
  - Formato propio con versión y suma de verificación SHA-256, y **cifrado opcional AES-256** con contraseña.
  - Se comparte o guarda con el menú nativo (WhatsApp, AirDrop, Drive, correo, Archivos…).
  - Importación con resumen previo, verificación en una base temporal y reemplazo atómico.
  - Copia interna para **deshacer** la restauración. Un archivo dañado nunca modifica los datos.

## Comandos

Requiere Node.js 22 o superior.

```bash
npm ci                 # instalar dependencias
npm run dev            # desarrollo en http://localhost:5173
npm test               # pruebas de lógica (Vitest + IndexedDB simulada)
npm run build          # compilación de producción en dist/ (incluye sw.js)
npm run preview        # servir dist/ en http://localhost:4173
npx playwright test    # pruebas de extremo a extremo (requiere build previo y Chromium de Playwright)
npm run android:sync   # compilar y copiar la app al proyecto Android
npm run android:apk    # compilar el APK (requiere Android SDK y android/keystore.properties)
```

## Estructura

```
src/core/            Lógica de negocio sin interfaz (reutilizable)
  types.ts           Modelo de datos
  db.ts              Esquema IndexedDB (Dexie) y versiones/migraciones
  catalog.ts         Catálogo base de iPhone/AirPods y puntos de inspección
  services/          Inventarios, productos, compras, ventas, gastos, garantías,
                     vistas, informes, integridad, respaldo, búsqueda
src/ui/              Interfaz React (pantallas, componentes, navegación)
src/main.tsx         Arranque, service worker y botón Atrás de Android
public/              Manifiesto e iconos de la PWA
scripts/             Generación de sw.js e iconos
android/             Proyecto nativo Android (Capacitor 8)
tests/unit/          Pruebas de lógica
tests/e2e/           Pruebas de extremo a extremo (Playwright)
docs/                Instalación, arquitectura, pruebas y capturas
.github/workflows/   Compilación del APK y publicación de la PWA
```

## Limitaciones conocidas

- **Los datos viven solo en el teléfono.**
  - Desinstalar la app (Android), quitar la app de la pantalla de inicio (iPhone) o borrar los datos del navegador elimina la base de datos.
  - La app recuerda hacer respaldos, pero guardar el archivo fuera del teléfono depende del usuario.
- **iPhone:**
  - Hay que usar siempre la app instalada en la pantalla de inicio. iOS puede borrar los datos de sitios abiertos en una pestaña de Safari tras 7 días sin uso, y los datos de Safari y de la app instalada son independientes.
  - No hay notificaciones en segundo plano: los avisos aparecen al abrir la app.
- **No implementado (opcional en el pedido):** escaneo y generación de QR o códigos de barras, impresión de etiquetas, estado "reservado", combinar dos respaldos (la importación siempre reemplaza, con opción de deshacer) y convertir un producto de "por cantidad" a "por unidad".
- Los importes de una compra o venta no se editan. Para corregirlos se anula la operación y se registra de nuevo, así todo queda trazable.
- La batería del iPhone se ingresa a mano: la app no la lee del equipo.
