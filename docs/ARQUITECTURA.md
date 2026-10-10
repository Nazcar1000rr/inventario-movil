# Arquitectura, modelo de datos y reglas

## 1. Decisiones técnicas

| Decisión | Motivo |
|---|---|
| **Una sola base web:** TypeScript 7 + React 19 + Vite 8 | El iPhone exige una PWA para instalarse sin App Store. Con una base web, la lógica y la interfaz son el mismo código en iPhone y Android. Con React Native o Flutter habría que duplicar la lógica o mantener una versión web secundaria. |
| **Android con Capacitor 8.5** | Empaqueta la misma compilación web en un APK nativo, con botón Atrás, menú para compartir, sistema de archivos e iconos. No necesita servidor: la app se sirve desde dentro del APK. |
| **IndexedDB con Dexie 4.4** | Es la única base de datos **transaccional** nativa de Safari (iOS) y existe igual en el WebView de Android. Las transacciones son atómicas entre varias tablas, tiene índices y migraciones por versión, y guarda los datos en el almacenamiento privado de la app. SQLite en web requiere WASM + OPFS, con soporte irregular en iOS, y dos motores distintos duplicarían el riesgo. |
| **Dinero en pesos enteros** | Evita errores de decimales. Todos los repartos (descuentos, gastos, costos unitarios) usan el método del mayor resto, así que la suma siempre cuadra al peso. |
| **Identificadores UUID v4** | Son persistentes, nunca se reutilizan y no chocan entre instalaciones. |
| **Service worker propio** | Es pequeño y transparente: precarga la lista exacta de archivos de cada versión y permite actualizar con aviso. |
| **Separación por capas** | `src/core` contiene la lógica y los datos sin interfaz, y se prueba sola con Vitest. `src/ui` contiene solo la presentación. |

## 2. Modelo de datos (tablas)

| Tabla | Contenido |
|---|---|
| `inventories` | Nombre, modo (`simple`/`pro`), archivado y notas |
| `products` | Producto dentro de un inventario. Tipo (teléfono, audífonos, accesorio u otro) y **método de control**: `unit` (por unidad) o `quantity` (por cantidad). Para "por cantidad" guarda `qty`, `stockValue` (valor a costo) y `unknownCostQty` (cantidad sin costo conocido) |
| `units` | Unidad física: `code` (único y permanente), estado, fecha de ingreso, `availableSince` (inicio del ciclo actual), ciclo, `baseCost` (`null` = desconocido), `extraCost` (costos capitalizados), IMEI, serial, color, capacidad, batería, inspección, defectos, compra y venta vigente |
| `catalogModels` | Catálogo de marcas y modelos (base + agregados). **No** identifica unidades |
| `purchases` / `purchaseLines` | Compra (fecha, proveedor, gastos, total, estado) y sus líneas (cantidad, pagado, gasto asignado, costo total, unidades creadas) |
| `sales` / `saleLines` | Venta (subtotal, descuento, total, entrega, estado) y líneas: **una línea por unidad física**, o una por producto "por cantidad". Cada línea guarda el reparto del descuento, el ingreso neto, el **costo de lo vendido (congelado)**, la cantidad sin costo, el inicio del ciclo y lo devuelto |
| `payments` | Pagos (`payment`) y reembolsos (`refund`) de una venta |
| `returns` | Devoluciones: líneas devueltas, destino, ingreso y costo revertidos, reembolso |
| `expenses` | Gastos: `operating` (se restan de la ganancia) o `capitalized` (se suman al costo de una unidad o producto). Pueden estar ligados a un inventario, venta, unidad, reparación o reclamo |
| `movements` | Libro de existencias: cada entrada o salida con cantidad, costo, pérdida, referencia y una secuencia (`seq`) |
| `warranties` / `warrantyClaims` | Garantías al cliente o del proveedor, con vencimiento calculado, y sus reclamos |
| `repairs`, `photos` | Reparaciones y fotos (JPEG reducido a 1280 px) por unidad |
| `suppliers`, `customers` | Proveedores y compradores. Sus totales se calculan a partir de las operaciones |
| `consolidatedViews` | Vista = lista de inventarios. **No contiene datos propios** |
| `history` | Bitácora legible de todos los cambios |
| `counters`, `settings`, `meta` | Contadores de códigos y de secuencia, configuración, identificador de la instalación y fechas de respaldo |

Todas las operaciones que tocan varias tablas (compra, venta, devolución, anulación, ajuste, restauración) se ejecutan en **una sola transacción**. Si algo falla, IndexedDB revierte todo.

## 3. Reglas de existencias

- Una unidad solo se puede vender si su estado es **Disponible**. Las que están en revisión o dañadas existen, pero no se venden. Es imposible vender la misma unidad dos veces: la transacción vuelve a leer el estado antes de venderla.
- Un producto "por cantidad" nunca queda con existencias negativas.
- **Idempotencia:**
  - Cada formulario genera un `opId` al abrirse. Compras, ventas y devoluciones tienen un índice único sobre `opId`, y pagos, gastos y ajustes registran su `opId` en `meta`.
  - Una doble pulsación o un reintento devuelve la operación ya registrada en lugar de crear otra.
  - La interfaz además bloquea el botón mientras guarda.
- **Venta automática** de productos por unidad: si no se eligen unidades concretas, se venden primero las más antiguas (FIFO). Las de fecha desconocida se consideran las más antiguas.
- **Devolución:**
  - Es un registro nuevo y la venta original se conserva.
  - La unidad vuelve como disponible, en revisión o dañada, empieza un **ciclo nuevo** (`cycle + 1`, `availableSince` = fecha de devolución) y conserva su fecha de ingreso original.
  - En productos por cantidad, lo devuelto "dañado" se da de baja como pérdida.
- **Anulación de venta** (solo para errores y sin devoluciones previas):
  - La venta queda marcada como anulada.
  - Las unidades vuelven a estar disponibles **continuando su ciclo original**.
  - La venta deja de contar en ingresos, costo y cobros.
- **Anulación de compra:** solo es posible si todo lo comprado sigue en existencia, sin costos adicionales y sin salidas posteriores, para no deformar el costo promedio.
- **Baja de unidad** (robo, daño irreparable): el registro y el código se conservan y su costo se reconoce como pérdida.
- **Códigos internos:**
  - Formato `PREFIJO-0001`, con prefijos configurables por categoría (IPH, TEL, AUD, ACC, OTR).
  - Hay un contador por prefijo que nunca retrocede. Ni anular, ni dar de baja, ni eliminar un inventario libera códigos.
  - Se asignan en ambos modos, pero solo se muestran en el profesional.

## 4. Costos

- **Compra:** costo de cada línea = lo pagado + la parte de los gastos de la compra (repartidos por precio o por unidad). En productos por unidad, el costo de la línea se divide entre las unidades con reparto exacto.
- **Productos por unidad:** se usa el costo real de cada unidad: `baseCost + extraCost`.
- **Productos por cantidad:** **costo promedio ponderado**. `stockValue` acumula el valor a costo. Una salida de `q` unidades cuesta `round(stockValue × q / cantidad con costo)`, y la última salida se lleva exactamente el resto. El stock con costo desconocido sale primero, porque se asume que es el más antiguo.
- **Costo desconocido:**
  - No se inventa. La venta registra cuántas unidades salieron sin costo, y los informes muestran la ganancia como **incompleta**.
  - Si después se completa el costo de una unidad, se actualiza el costo de sus ventas y devoluciones.
- **Gasto capitalizado** (reparación o transporte de una unidad en existencia): se suma al costo de la unidad y entra en la ganancia **una sola vez**, como costo de lo vendido al venderla. Si la unidad ya se vendió, una reparación se registra como gasto operativo.
- Los gastos de la compra viven en la compra, los de la venta (comisión, envío) en la venta como gastos operativos, y los costos de reclamos de garantía como gasto operativo del reclamo. Ningún importe existe en dos lugares, así que ninguno se resta dos veces.

## 5. Fórmulas financieras (por periodo)

```
Ventas brutas            = Σ cantidad × precio de las ventas del periodo (sin anuladas)
Ingresos netos           = ventas brutas − descuentos − devoluciones registradas en el periodo
Costo de lo vendido      = Σ costo congelado de las líneas vendidas − costo de lo devuelto
Ganancia bruta           = ingresos netos − costo de lo vendido      (incompleta si faltan costos)
Ganancia neta            = ganancia bruta − gastos operativos − bajas/pérdidas
Dinero cobrado           = pagos − reembolsos con fecha en el periodo (sin ventas anuladas)
Cobros pendientes (hoy)  = Σ max(0, total vigente de cada venta − cobrado neto)
Valor del inventario     = Σ costo de lo disponible con costo conocido (se informa aparte lo desconocido)
Invertido en compras     = Σ total de las compras del periodo (incluye sus gastos)
```

- El **stock existente** registrado con la opción "Ingresar stock existente" **no** cuenta como compra del periodo.
- El inventario sin vender **no** es ganancia.
- El **resultado del periodo** (actividad entre dos fechas) se presenta separado de los **saldos a hoy** (por cobrar, existencias, valor a costo).
- Comparación: "mismo tramo del periodo anterior". Por ejemplo, del 1 al 9 de este mes frente al 1 al 9 del mes anterior.

## 6. Tiempo en inventario

- **Unidades:** días desde `availableSince` hasta hoy si no se ha vendido, o hasta la venta. Una devolución inicia un ciclo nuevo y el ciclo anterior queda en su venta original.
- **Productos por cantidad:** se reconstruyen capas FIFO a partir de los movimientos, ignorando compras y ventas anuladas, para saber la antigüedad de lo que queda y los días hasta vender de cada salida.
- **Fecha desconocida:** se excluye de los promedios y se informa cuántas unidades quedaron fuera.
- **Velocidad:** promedio, mínimo y máximo de días hasta vender por modelo, categoría e inventario, más lo vendido más rápido. Con menos de 3 datos se marca "pocos datos".
- **% vendido** = vendidas en el periodo ÷ (vendidas + disponibles ahora).
- **Estancado:** días en inventario ≥ al umbral configurable (60 por defecto).

## 7. Vistas consolidadas

Una vista es solo una lista de inventarios. Las existencias se agrupan por nombre de producto normalizado y **se calculan en vivo** a partir de los inventarios de origen. Cada fila muestra el desglose por inventario, y las finanzas de la vista son la suma de los registros cuyo inventario está en la lista. Como cada registro pertenece a un solo inventario, nada se cuenta dos veces.

Para vender desde una vista:
- Si el producto está en un solo inventario, se abre la venta en ese inventario.
- Si está en varios, se pide elegir el de origen.

Eliminar una vista no toca ningún dato.

## 8. Formato de respaldo

Es un archivo `.json` propio:

```json
{
  "format": "inventario-movil-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "createdAt": "2026-10-09T…Z",
  "installationId": "…",
  "encrypted": false,
  "checksum": "<SHA-256 del JSON de payload>",
  "payload": { "counts": { "units": 3 }, "tables": { "units": [] } }
}
```

- Incluye las **23 tablas** completas: datos, relaciones, identificadores, historial, configuración y fotos. Las fotos van en base64.
- **Cifrado opcional:**
  - `encrypted: true`, con la clave derivada por PBKDF2-SHA256 (310 000 iteraciones) y cifrado AES-GCM de 256 bits.
  - Solo la cabecera queda en claro.
  - AES-GCM detecta cualquier alteración.
  - Si se olvida la contraseña, no hay recuperación.
- **Importación segura:**
  1. Lectura del JSON.
  2. Comprobación de formato y versión.
  3. Suma de verificación o descifrado.
  4. Conteos.
  5. Validación de tipos de cada campo, identificadores repetidos y códigos repetidos.
  6. Carga en una **base temporal aparte** con verificación completa de integridad.
  7. Resumen para el usuario.
  8. **Copia interna** de los datos actuales.
  9. Reemplazo de todo **en una sola transacción**, con nueva verificación (conteos e integridad) **antes de confirmar**.
  10. Si cualquier paso falla, los datos actuales quedan intactos.
- La instalación de destino conserva su propio `installationId`: es una copia, no una vinculación.
- **No se combinan** dos instalaciones. Sus códigos internos (por ejemplo, IPH-0001 en ambas) y sus existencias chocarían, y no se puede garantizar que no se dupliquen unidades o dinero.

## 9. Migraciones

- **Base de datos:** cada cambio de esquema añade `this.version(N).stores(...).upgrade(tx => …)` en `src/core/db.ts`. Dexie ejecuta las migraciones pendientes en una transacción al abrir la base. Hay una prueba que lo demuestra con una versión 2 simulada.
- **Respaldos:** `BACKUP_MIGRATIONS` en `backup.ts` convierte respaldos de versiones anteriores paso a paso (`v → v+1`) antes de validarlos. Un respaldo de una versión **más nueva** que la app se rechaza con un mensaje claro.
- **Integridad:** `verifyIntegrity()` comprueba que las existencias y el valor coincidan con los movimientos, que el saldo de cada unidad sea coherente con su estado, que ninguna unidad esté vendida dos veces, que los totales coincidan con las líneas y que todas las referencias existan.

## 10. Seguridad y privacidad

- Sin servidores, sin cuentas y sin analítica.
- La política de seguridad de contenido (`connect-src 'self'`) **bloquea** cualquier envío de datos a internet. Hay una prueba que lo verifica.
- **Android:**
  - `allowBackup=false` y `dataExtractionRules` excluyen los datos de la copia en la nube de Google y de la transferencia automática entre teléfonos.
  - Solo pide permiso de almacenamiento en Android 9 y 10, para guardar en Documentos.
  - No pide cámara: usa la app de cámara del sistema.
- No se registran IMEI ni datos personales en la consola.
- Las listas y la búsqueda muestran el IMEI enmascarado (`•••1234`). El IMEI completo solo aparece en la ficha de la unidad.
- Las acciones irreversibles piden confirmación, y las más graves exigen escribir una palabra (BORRAR, REEMPLAZAR o el nombre del inventario).
