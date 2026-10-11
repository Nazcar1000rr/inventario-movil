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
| `products` | Producto dentro de un inventario. Tipo (teléfono, audífonos, accesorio u otro) y **método de control**: `unit` (por unidad) o `quantity` (por cantidad). Para "por cantidad" guarda `qty`, `stockValue` (valor a costo), `unknownCostQty` (cantidad sin costo conocido) y **`costing`** (v2.1): `lots` (por lotes) o `average` (costo promedio) |
| `lots` (v2.1) | Lotes de productos por cantidad con `costing = 'lots'`: origen (compra, stock inicial, ajuste, devolución, apertura), compra/línea/proveedor, fecha de ingreso, cantidad y valor de entrada, **cantidad y valor actuales**, costo conocido o no. Los totales del producto son siempre la suma de sus lotes |
| `units` | Unidad física: `code` (único y permanente), estado, fecha de ingreso, `availableSince` (inicio del ciclo actual), ciclo, `baseCost` (`null` = desconocido), `extraCost` (costos capitalizados), IMEI, serial, color, capacidad, **estado del equipo** (Nuevo / Usado / Restaurado), batería, inspección, defectos, **`partsHistory`** (v2: piezas cambiadas), compra y venta vigente |
| `catalogModels` | Catálogo de marcas y modelos (base + agregados). **No** identifica unidades |
| `purchases` / `purchaseLines` | Compra (fecha, proveedor, gastos, total, estado, **`paymentSource`** `cash`/`debt` y **`debtId`** en v2) y sus líneas (cantidad, pagado, gasto asignado, costo total, unidades creadas) |
| `sales` / `saleLines` | Venta (subtotal, descuento, total, entrega, estado) y líneas: **una línea por unidad física**, o una por producto "por cantidad". Cada línea guarda el reparto del descuento, el ingreso neto, el **costo de lo vendido (congelado)**, la cantidad sin costo, el inicio del ciclo y lo devuelto |
| `payments` | Pagos (`payment`) y reembolsos (`refund`) de una venta |
| `returns` | Devoluciones: líneas devueltas, destino, ingreso y costo revertidos, reembolso |
| `expenses` | Gastos: `operating` (se restan de la ganancia) o `capitalized` (se suman al costo de una unidad o producto). Pueden estar ligados a un inventario, venta, unidad, reparación, reclamo, **deuda** (intereses, v2) o ser una **comisión de medio de pago** (`paymentFee`, v2) |
| `movements` | Libro de existencias: cada entrada o salida con cantidad, costo, pérdida, referencia y una secuencia (`seq`) |
| `warranties` / `warrantyClaims` | Garantías al cliente o del proveedor, con vencimiento calculado, y sus reclamos |
| `repairs`, `photos` | Reparaciones y fotos (JPEG reducido a 1280 px) por unidad |
| `suppliers`, `customers` | Proveedores y compradores. Sus totales se calculan a partir de las operaciones |
| `consolidatedViews` | Vista = lista de inventarios. **No contiene datos propios** |
| `history` | Bitácora legible de todos los cambios |
| `counters`, `settings`, `meta` | Contadores de códigos y de secuencia, configuración, identificador de la instalación, fechas de respaldo y última versión vista (novedades) |
| `capital` (v2) | Aportes, retiros, ajustes de caja, préstamos al dueño y sus devoluciones. Con inventario o generales; anulables |
| `debts` / `debtPayments` (v2) | Deudas (tarjeta, proveedor, préstamo, otra), si el dinero entró a la caja o pagó una compra, y sus abonos (capital + intereses) |
| `marketPrices` (v2) | Precios de mercado anotados por modelo + capacidad + estado, con fecha (historial completo) |
| `goals` (v2) | Metas de valor del negocio o de crecimiento, generales o por inventario |

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
- **Anulación de compra:** solo es posible si todo lo comprado sigue en existencia, sin costos adicionales y sin salidas posteriores, para no deformar el costo promedio. Con lotes (v2.1) basta con que **el lote de esa compra** siga intacto (misma cantidad y valor), aunque haya salidas de otros lotes. Si la compra tiene gastos agregados después, primero se anulan esos gastos.
- **Baja de unidad** (robo, daño irreparable): el registro y el código se conservan y su costo se reconoce como pérdida.
- **Códigos internos:**
  - Formato `PREFIJO-0001`, con prefijos configurables por categoría (IPH, TEL, AUD, ACC, OTR).
  - Hay un contador por prefijo que nunca retrocede. Ni anular, ni dar de baja, ni eliminar un inventario libera códigos.
  - Se asignan en ambos modos, pero solo se muestran en el profesional.

## 4. Costos

- **Compra:** costo de cada línea = lo pagado + la parte de los gastos de la compra (repartidos por precio o por unidad). En productos por unidad, el costo de la línea se divide entre las unidades con reparto exacto.
- **Productos por unidad:** se usa el costo real de cada unidad: `baseCost + extraCost`.
- **Productos por cantidad con lotes (v2.1, por defecto):** cada entrada (compra, stock inicial, ajuste de entrada, devolución) crea un lote con su valor. Una salida toma primero el lote elegido (si lo hay) y luego del más antiguo al más nuevo (fecha desconocida primero). De cada lote sale `round(valor × q / cantidad)`, y si se vacía se lleva exactamente su resto. La venta guarda `lotAllocations` (lote, cantidad, costo, fecha) para anularla devolviendo cada unidad a su lote y para medir los días hasta vender con la fecha exacta de cada lote. Una devolución crea un lote de devolución (si llega dañada, no). Un gasto capitalizado se reparte entre los lotes por cantidad (o va a uno elegido) y se guarda el reparto para poder anularlo.
- **Productos por cantidad con costo promedio:** **costo promedio ponderado**. `stockValue` acumula el valor a costo. Una salida de `q` unidades cuesta `round(stockValue × q / cantidad con costo)`, y la última salida se lleva exactamente el resto. El stock con costo desconocido sale primero, porque se asume que es el más antiguo.
- **Cambiar de método (v2.1):** apagar los lotes los borra (los totales del producto ya son el promedio). Prenderlos los reconstruye con el historial de movimientos (`buildLotsFromHistory`): capas FIFO, las salidas sin costo consumen primero las capas sin costo, y el valor actual se reparte entre las capas que quedan según el costo original de cada entrada con reparto exacto al peso. Si el historial no cuadra, se crea un único lote de apertura. El valor total nunca cambia.
- **Gastos agregados a una compra o repartidos entre compras (v2.1):** el monto se reparte entre las compras (por valor pagado o por unidades) y dentro de cada compra entre sus líneas. Para cada línea, la parte de lo que sigue en existencia se capitaliza (a las unidades en existencia, o al lote de esa compra en proporción `cantidad actual ÷ cantidad que entró`; con costo promedio, `min(comprado, existencias con costo) ÷ comprado`) y la parte de lo ya vendido o dado de baja es un gasto operativo. Todas las partes comparten `costGroupId` y se anulan juntas.
- **Costo desconocido:**
  - No se inventa. La venta registra cuántas unidades salieron sin costo, y los informes muestran la ganancia como **incompleta**.
  - Si después se completa el costo de una unidad, se actualiza el costo de sus ventas y devoluciones **y también sus movimientos** (v2), para que el valor del inventario calculado con movimientos coincida siempre con el de las unidades.
  - Al dar de baja una unidad con costo base desconocido, igual se da de baja lo que sí se conoce (sus costos adicionales).
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
- **Estancado (v2, opcional):** se puede apagar. Umbral general (60 días por defecto) y, si se quiere, uno para equipos **nuevos** y otro para **usados/restaurados** (vacío = el general). Aunque los avisos estén apagados, el "dinero dormido" de Capital usa esos mismos umbrales.

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
  "schemaVersion": 2,
  "appVersion": "2.0.0",
  "createdAt": "2026-10-09T…Z",
  "installationId": "…",
  "encrypted": false,
  "checksum": "<SHA-256 del JSON de payload>",
  "payload": { "counts": { "units": 3 }, "tables": { "units": [] } }
}
```

- Incluye las **28 tablas** completas (23 de la v1 + capital, deudas, abonos, precios de mercado y metas): datos, relaciones, identificadores, historial, configuración y fotos. Las fotos van en base64.
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

- **Base de datos:** cada cambio de esquema añade `this.version(N).stores(...).upgrade(tx => …)` en `src/core/db.ts`. Dexie ejecuta las migraciones pendientes en una transacción al abrir la base.
- **v1 → v2 (automática al abrir la app actualizada):**
  - Crea las tablas nuevas (vacías).
  - Unidades: `partsHistory = []` y el estado "Reacondicionado" pasa a llamarse "Restaurado" (también en la lista de estados de Configuración).
  - Compras: `paymentSource = 'cash'`, `debtId = null` (en la v1 todas salían de la caja).
  - Movimientos de unidades de stock inicial cuyo costo se completó o corrigió después, y bajas de unidades con costo desconocido: se alinean con el costo actual (función `alignUnitMovementV2`, idempotente).
  - La configuración nueva (precios, comisiones, estancado por estado…) toma valores por defecto al leerse (`mergeSettings`).
- **v2 → v3 (app 2.1, automática):** crea la tabla `lots`; los productos por cantidad pasan a `costing = 'lots'` y sus existencias se separan en lotes con su historial (`upgradeLotsV3`, misma función que al prender los lotes). Los demás productos quedan con `costing = 'average'`. El valor total de cada producto no cambia. `BACKUP_MIGRATIONS[2]` hace lo mismo con los respaldos de la v2.
- **Respaldos:** `BACKUP_MIGRATIONS[1]` hace exactamente la misma conversión para respaldos de la v1, así un respaldo v1 importado en la v2 queda igual que una base v1 actualizada. Un respaldo de una versión **más nueva** que la app se rechaza con un mensaje claro.
- **Integridad:** `verifyIntegrity()` comprueba que las existencias y el valor coincidan con los movimientos, que el saldo de cada unidad sea coherente con su estado, que ninguna unidad esté vendida dos veces, que los totales coincidan con las líneas y que todas las referencias existan. En v2 también: deudas, abonos e intereses coherentes, compras con deuda enlazadas en ambos sentidos, préstamos al dueño no negativos; en v2.1, que cantidad, valor y cantidad sin costo de cada producto con lotes sean exactamente la suma de sus lotes, lotes no negativos y gastos enlazados a lotes existentes; y (como **advertencias**) que el costo de cada unidad coincida con la suma de sus movimientos + costos capitalizados. Las pruebas exigen cero problemas y cero advertencias.

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

## 11. Capital del negocio (v2)

```
Caja calculada        = aportes − retiros ± ajustes de caja − préstamos al dueño + devoluciones del dueño
                        + cobros − reembolsos (ventas activas) − compras activas − gastos activos
                        + deudas recibidas (no anuladas) − abonos a capital
Inventario a costo    = Σ costo de unidades en existencia (base conocida + costos adicionales) + valor de productos por cantidad
Valor del negocio     = caja + inventario a costo + por cobrar + préstamos al dueño − deudas − saldos a favor de clientes
Capital aportado      = aportes − retiros + mercancía que ya se tenía (stock inicial a costo)
Crecimiento           = valor del negocio − capital aportado
                      = ganancia neta acumulada + ajustes de caja + mercancía encontrada en ajustes   (identidad probada)
```

- Una compra pagada con deuda resta su total de la caja y la deuda lo suma: el efecto neto es solo lo pagado de contado. Se puede financiar una parte.
- Un **préstamo al dueño** ("prestado a ti") no cambia el valor del negocio: el dinero sale de la caja pero queda como cuenta por cobrar al dueño. Un **retiro** baja el capital aportado, no el crecimiento.
- Por inventario o global: los registros con inventario cuentan en su inventario; los generales (sin inventario) solo en "Todos".
- **Serie mensual:** el valor de cada fin de mes se reconstruye con todos los hechos anteriores (el inventario con los movimientos, sin compras/ventas anuladas). El mes actual usa los valores de hoy.
- **Métricas:** rentabilidad = ganancia neta del periodo ÷ valor al inicio (o capital aportado si el negocio empezó en el periodo); rotación = costo de lo vendido ÷ inventario promedio; días para recuperar = días del periodo ÷ rotación; dinero dormido = costo de lo que supera su umbral de estancado.
- **Metas:** valor del negocio o crecimiento, con fecha opcional y ritmo mensual necesario.

## 12. Deudas (v2)

- Tipos: tarjeta de crédito, crédito del proveedor, préstamo de un tercero, otra. `cashIn = true` si el dinero entró a la caja; `false` si pagó una compra.
- Abono = capital (baja la deuda) + intereses/cuota de manejo (gasto operativo "Intereses y costos financieros", resta de la ganancia). Al llegar a cero, la deuda queda "Pagada". Un abono se puede anular (también su gasto).
- Anular una compra con deuda exige anular antes sus abonos; la deuda se anula con la compra.

## 13. Precios (v2)

- **Mercado:** registros manuales por `modelo|capacidad|estado` (normalizados), con historial; desactualizado tras N días (30 por defecto).
- **Tu precio real:** promedio de tus ventas del mismo modelo/capacidad/estado en los últimos N días (90 por defecto), sin lo devuelto.
- **Mínimo:** costo + margen mínimo (pesos o %; redondeo hacia arriba con tolerancia a coma flotante).
- **Sugerido:** mercado al día → tu precio real → precio de venta del producto → mercado desactualizado; nunca por debajo del mínimo.
- **Máximo de compra:** mercado ajustado (− descuento por batería bajo umbral − descuento por pieza genérica × piezas) − margen − gastos esperados; con margen en %: `⌊mercado ajustado × 100 ÷ (100 + %) − gastos⌋`.
- **Comisión por medio de pago:** `round(pago × % ÷ 100)` se registra como gasto operativo de la venta (editable al cobrar).

## 14. Rentabilidad y proveedores (v2)

- **Ganancia por día por modelo** (equipos con costo y fecha conocidos): Σ ganancia ÷ Σ días en inventario (mínimo 1 día). Rendimiento = ganancia ÷ Σ(costo × días).
- **Calificación de proveedores (0–100):** margen (2 puntos por 1 %, máx. 40) + rapidez (30 × (1 − días/90)) + calidad (30 − 60 × (devoluciones + reclamos)/ventas − 30 × equipos con piezas genéricas o aviso/comprados). Menos de 3 ventas = "pocos datos".

## 15. Historial de piezas (v2)

Cada unidad guarda una lista de cambios: pieza (batería, pantalla, tapa, cámaras, Face ID/Touch ID, puerto, altavoz, chasis, placa, otra), calidad (original/genérica/no sé), quién (dueño anterior/proveedor/yo/no sé), fecha, aviso de "pieza desconocida" y notas. Anotar piezas **no** cambia costos; solo una reparación pagada (que puede agregar su pieza al historial, enlazada con `repairId`) suma costo.

## 16. Ayuda y modo práctica (v2)

- Contenido en `src/ui/help/content.ts`: manual (artículos con buscador sin tildes y "Llévame ahí"), explicación de cada métrica (ⓘ), ayuda por pantalla (?) y novedades. El manual completo se puede imprimir y se incluye como PDF (`public/manual-inventario-movil.pdf`, generado con `scripts/make-manual-pdf.mjs`).
- **Modo práctica:** abre otra base de datos (`inventario-movil-practica`) con datos de ejemplo; su copia interna de restauración también es aparte. Los datos reales no se abren mientras se practica.
- **Novedades:** se muestran una vez tras actualizar (si la base ya tenía datos), comparando con `meta.lastSeenVersion`.

## 17. Compras, gastos personales, aprendizaje y sonidos (v2.1)

- **Historial de precios de compra** (`services/purchasing.ts`): compras activas del mismo producto en todos los inventarios (mismo nombre normalizado y tipo), precio por unidad sin gastos y con gastos, último precio por proveedor. `compareWithStock` compara el costo por unidad de una compra nueva con las existencias (lotes, unidades o promedio) y devuelve cuánto más costaron y el precio mínimo de cada una.
- **Gastos personales** (`services/personal.ts`): se guardan como movimientos de capital `withdrawal` (no se devuelve) u `owner_loan` (se devuelve) con `personal: true` y `tag`. No son gastos del negocio: no cambian la ganancia, sí la caja. Impacto: `lo que sacaste en el mes = retiros + préstamos a ti − devoluciones`; `ganancia libre = ganancia neta del mes − lo que sacaste`; del gasto nuevo, `de ganancias = min(monto, max(0, ganancia libre))` y el resto sale del capital. Nivel: verde si después de sacar queda al menos la mitad de la ganancia, amarillo si queda menos, rojo si se come capital o el mes no tiene ganancia.
- **Recorridos guiados** (`ui/tour.tsx`): pasos con pantalla y elemento (`data-tour`); una capa oscurece todo menos el elemento y bloquea los toques fuera de él. Avance en el almacenamiento local.
- **Lecciones** (`ui/help/lessons.ts`, `ui/screens/Learn.tsx`): 10 lecciones con calculadora y 3 preguntas; avance en el almacenamiento local.
- **Sonidos** (`ui/sound.ts`): sintetizados con Web Audio (sin archivos ni red). Ocho sonidos con interruptor propio y volumen, guardados en el almacenamiento local; no hay interruptor general a propósito. Un clic en botones/enlaces suena "toque" (o "sección" en la navegación); las acciones con mensaje de éxito suenan según el mensaje (venta, compra o éxito) y los errores con "error".

## 18. Apariencia, voz y sonidos (v2.2)

- **Apariencia** (`ui/theme.ts`): `data-theme` (claro/oscuro; sin atributo = automático), `data-accent` (verde, azul, morado, coral, rosado, grafito), `data-style` (sólido/degradado) y `data-motion` (completas/lite) en `<html>`. Cada color define sus variables (`--primary`, `--primary-2`, `--primary-soft`, `--on-primary`, `--grad-*`, `--hero-*`) para claro y oscuro, con contraste de texto ≥ 4,5:1 comprobado. Un script en `index.html` aplica lo guardado antes de pintar. El color de la barra del sistema (`theme-color`) se actualiza al cambiar. Modo lite: `animation` y `transition` en `none` (salvo el indicador de carga); sin elección guardada, sigue "reducir movimiento" del teléfono.
- **Voz** (`ui/speech.ts`, `ui/speech-text.ts`): en el navegador/iPhone, Web Speech API; en la app de Android, el motor de voz del sistema con `@capacitor-community/text-to-speech` (el WebView no trae voz). Solo voces en español **locales** (`localService`), así el texto no sale del teléfono. El texto se prepara (pesos, cifras sin separadores, símbolos, emojis) y se parte en frases. Lectura automática (`useAutoSpeak`) en pasos de recorridos, explicaciones ⓘ, ayuda "?", artículos y lecciones (las preguntas cuando quedan a la vista); la bocina silencia todo (`voice:muted`). iPhone exige un toque antes de la primera lectura: se desbloquea con el primer toque en la app.
- **Sonidos** (`ui/sound.ts`): 6 paquetes de recetas sintetizadas (osciladores con parciales, ruido filtrado y envolventes), paquete general + tono por sonido. "Sonar con el iPhone en silencio" usa `navigator.audioSession.type = 'playback'` (iOS 17 o superior); apagado, `'auto'`.
- **Logo:** `scripts/make-icons.mjs` genera los íconos de la PWA, el ícono adaptable de Android (fondo con degradado + glifo) y el splash.
