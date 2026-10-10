/**
 * Contenido de ayuda: manual, explicaciones de métricas (ⓘ), ayuda por pantalla (?) y novedades.
 * Todo está en la app (funciona sin conexión). Tono cercano (tú).
 */

export type Block = { p: string } | { h: string } | { steps: string[] } | { list: string[] } | { tip: string } | { warn: string };

export interface Article {
  id: string;
  title: string;
  category: string;
  /** Palabras extra para la búsqueda. */
  keywords: string;
  summary: string;
  /** Pantalla a la que lleva "Llévame ahí". */
  to?: string;
  toLabel?: string;
  blocks: Block[];
}

export const CATEGORIES = [
  'Primeros pasos',
  'Inventario',
  'Compras y ventas',
  'Equipos y reparaciones',
  'Dinero y capital',
  'Precios',
  'Informes',
  'Respaldo y seguridad',
  'Configuración',
];

export const ARTICLES: Article[] = [
  /* ---------------- Primeros pasos ---------------- */
  {
    id: 'empezar',
    title: 'Cómo empezar',
    category: 'Primeros pasos',
    keywords: 'inicio comenzar tutorial guía primeros pasos lista',
    summary: 'Los pasos para dejar la app lista en unos minutos.',
    to: '/',
    toLabel: 'Ir a Inicio',
    blocks: [
      { p: 'En Inicio verás la lista "Primeros pasos". Cada paso se marca solo cuando lo haces. Este es el orden recomendado:' },
      {
        steps: [
          'Crea tu inventario (por ejemplo "Mi negocio"). Puedes tener varios: uno tuyo y otro para mercancía en consignación, por ejemplo.',
          'Registra el dinero con el que empiezas en Capital → Aporte. Así la app puede calcular tu caja y cuánto crece tu negocio.',
          'Ingresa la mercancía que ya tienes con "Ingresar stock existente". Si no sabes el costo o la fecha, márcalos como desconocidos: la app nunca inventa datos.',
          'Registra tus compras nuevas y tus ventas a medida que pasen.',
          'Anota precios de mercado de los modelos que más mueves (Precios de mercado) para ver precios sugeridos al vender.',
          'Haz un respaldo y guárdalo fuera del teléfono (WhatsApp, Drive, correo).',
        ],
      },
      { tip: 'Si quieres probar sin miedo a dañar nada, activa el Modo práctica en Más → Ayuda. Usa datos de ejemplo en una base aparte.' },
    ],
  },
  {
    id: 'instalar',
    title: 'Instalar y actualizar la app',
    category: 'Primeros pasos',
    keywords: 'iphone android apk safari pantalla de inicio actualizar versión',
    summary: 'iPhone: desde Safari. Android: con el archivo APK. Cómo actualizar sin perder datos.',
    blocks: [
      { h: 'iPhone' },
      { steps: ['Abre el enlace de la app en Safari.', 'Toca Compartir → "Añadir a pantalla de inicio".', 'Usa siempre el icono de la pantalla de inicio.'] },
      { warn: 'iOS puede borrar los datos de páginas abiertas en una pestaña de Safari tras 7 días sin uso, y los datos de Safari y los de la app instalada son independientes. Usa siempre la app instalada y haz respaldos.' },
      { p: 'Cuando hay una versión nueva, Inicio muestra "Hay una versión nueva de la app": toca "Actualizar ahora". Tus datos se conservan.' },
      { h: 'Android' },
      { steps: ['Descarga el archivo inventario-movil.apk.', 'Ábrelo y permite instalar apps de esta fuente si Android lo pide.', 'Para actualizar, instala el APK nuevo ENCIMA del anterior. No desinstales: desinstalar borra los datos.'] },
      { tip: 'Al actualizar de la versión 1 a la 2, tus datos se convierten automáticamente. Antes de actualizar es buena idea hacer un respaldo.' },
    ],
  },
  {
    id: 'practica',
    title: 'Modo práctica',
    category: 'Primeros pasos',
    keywords: 'practicar demo ejemplo prueba ensayo datos de ejemplo',
    summary: 'Practica con datos de ejemplo sin tocar tus datos reales.',
    to: '/ayuda',
    toLabel: 'Ir a Ayuda',
    blocks: [
      { p: 'El modo práctica abre una base de datos APARTE con un negocio de ejemplo (compras, ventas, deudas, capital…). Todo lo que hagas ahí no afecta tus datos reales.' },
      { steps: ['Ve a Más → Ayuda → "Modo práctica".', 'Toca "Entrar al modo práctica". Verás una franja naranja abajo mientras estés en práctica.', 'Para volver a tus datos reales toca "Salir" en esa franja.'] },
      { p: 'Puedes reiniciar los datos de ejemplo cuando quieras con "Reiniciar práctica".' },
      { warn: 'Los respaldos hechos en modo práctica contienen solo datos de ejemplo.' },
    ],
  },
  {
    id: 'privacidad',
    title: 'Tus datos y tu privacidad',
    category: 'Primeros pasos',
    keywords: 'nube servidor internet privacidad seguridad datos local',
    summary: 'Todo se guarda solo en tu teléfono. No hay cuentas, servidores ni nube.',
    blocks: [
      { p: 'La app guarda todo en el almacenamiento privado de este teléfono. No envía datos a internet, no tiene cuentas y no sincroniza con otros teléfonos.' },
      { p: 'Si tú y otra persona usan la app, cada uno tiene sus propios datos. Para pasar información de un teléfono a otro se usa un archivo de respaldo, de forma manual.' },
      { warn: 'Desinstalar la app (Android), quitarla de la pantalla de inicio (iPhone) o borrar los datos del navegador borra la base de datos. Guarda respaldos fuera del teléfono.' },
    ],
  },

  /* ---------------- Inventario ---------------- */
  {
    id: 'inventarios',
    title: 'Inventarios y modalidades',
    category: 'Inventario',
    keywords: 'inventario sencillo profesional modo archivar eliminar renombrar',
    summary: 'Crea varios inventarios y elige entre modo Sencillo o Profesional.',
    to: '/inventarios',
    toLabel: 'Ir a Inventarios',
    blocks: [
      { p: 'Un inventario agrupa productos, compras, ventas y gastos. Puedes tener varios y verlos juntos con una vista consolidada.' },
      { list: ['Sencillo: lo esencial (producto, cantidad, costo, precio y estado del equipo).', 'Profesional: además IMEI/serial, inspección de 16 puntos, fotos, garantías del proveedor y trazabilidad por unidad.'] },
      { p: 'Cambiar de modalidad solo cambia lo que ves en pantalla. No borra ni modifica datos.' },
      { p: 'Archivar un inventario lo oculta de los formularios pero conserva su historia. Eliminarlo es permanente y pide escribir su nombre para confirmar.' },
    ],
  },
  {
    id: 'productos',
    title: 'Productos por unidad y por cantidad',
    category: 'Inventario',
    keywords: 'producto unidad cantidad catálogo modelo iphone accesorio costo promedio código interno',
    summary: 'Teléfonos uno por uno; accesorios por cantidad con costo promedio.',
    blocks: [
      { list: ['Por unidad (teléfonos): cada equipo tiene su código interno permanente (IPH-0001…), su costo, su estado y su historia.', 'Por cantidad (accesorios): se maneja el total con costo promedio ponderado.'] },
      { p: 'Al crear un teléfono puedes elegir el modelo del catálogo (iPhone X hasta los últimos), que ya trae sus capacidades.' },
      { tip: 'Los códigos internos nunca se reutilizan, aunque borres o vendas el equipo.' },
    ],
  },
  {
    id: 'stock-existente',
    title: 'Ingresar mercancía que ya tenías',
    category: 'Inventario',
    keywords: 'stock inicial existente mercancía anterior costo desconocido fecha desconocida',
    summary: 'Registra lo que tenías antes de usar la app. Cuenta como capital aportado en mercancía.',
    to: '/stock/nuevo',
    toLabel: 'Ingresar stock existente',
    blocks: [
      { p: 'No es una compra del periodo: es mercancía que ya era tuya. En Capital cuenta como "mercancía aportada" (parte de tu capital inicial).' },
      { p: 'Si no sabes cuánto te costó o cuándo llegó, márcalo como desconocido. La app lo avisa y no inventa números; las ganancias de esas unidades se marcan como incompletas hasta que completes el costo.' },
      { p: 'Para teléfonos puedes indicar el estado (Nuevo, Usado o Restaurado) y las piezas cambiadas que conozcas.' },
    ],
  },
  {
    id: 'vistas',
    title: 'Vistas consolidadas',
    category: 'Inventario',
    keywords: 'vista consolidada varios inventarios juntos sumar',
    summary: 'Mira varios inventarios juntos sin duplicar nada.',
    to: '/vistas',
    toLabel: 'Ir a Vistas',
    blocks: [
      { p: 'Una vista suma las existencias y números de varios inventarios. No copia nada: cada producto sigue perteneciendo a su inventario.' },
      { p: 'Al vender desde una vista, la app te pide de qué inventario sale el equipo.' },
    ],
  },

  /* ---------------- Compras y ventas ---------------- */
  {
    id: 'compras',
    title: 'Registrar una compra',
    category: 'Compras y ventas',
    keywords: 'compra comprar proveedor imei gastos transporte reparto tarjeta crédito deuda estado nuevo usado restaurado',
    summary: 'Varios productos, gastos repartidos, estado del equipo, piezas y forma de pago.',
    to: '/compras/nueva',
    toLabel: 'Registrar compra',
    blocks: [
      { steps: ['Elige el inventario y agrega los productos con la cantidad y el total pagado por cada línea.', 'Si hubo gastos de la compra (transporte, envío), escríbelos: se reparten al costo de lo comprado.', 'Para cada teléfono indica el estado: Nuevo, Usado o Restaurado. En modo profesional también IMEI y serial.', 'Si sabes que el equipo tiene piezas cambiadas, agrégalas en "Reparaciones y piezas".', 'Elige cómo la pagaste: con la caja, con tarjeta de crédito, a crédito del proveedor u otra deuda.', 'Revisa el resumen y confirma.'] },
      { p: 'Si la pagaste con tarjeta o a crédito, la app crea la deuda automáticamente. Puedes financiar solo una parte (por ejemplo, la mitad de contado y la mitad a crédito).' },
      { tip: 'Los importes de una compra no se editan. Si te equivocaste, anúlala y regístrala de nuevo: así todo queda trazable.' },
    ],
  },
  {
    id: 'ventas',
    title: 'Registrar una venta',
    category: 'Compras y ventas',
    keywords: 'venta vender precio sugerido mínimo cliente comprador pago parcial garantía comisión',
    summary: 'Unidades, precio con ayuda, pagos parciales, garantía y comisiones.',
    to: '/ventas/nueva',
    toLabel: 'Registrar venta',
    blocks: [
      { steps: ['Elige el producto. Para teléfonos, la app propone la unidad más antigua o puedes elegir una específica.', 'Debajo del precio verás: tu costo, el precio mínimo, el precio de mercado y "tu precio real". Toca "Usar sugerido" si quieres.', 'Si el precio queda por debajo del costo o del mínimo, la app te avisa (no te bloquea).', 'Indica cuánto te pagaron ahora y el medio de pago. Si hay comisión (datáfono), la app la calcula sola.', 'Opcional: comprador, garantía y gastos de la venta (envío, comisión de un vendedor).', 'Confirma. Una doble pulsación no crea dos ventas.'] },
      { p: 'Si te quedan debiendo, la venta queda "por cobrar" y luego registras los abonos.' },
    ],
  },
  {
    id: 'pagos',
    title: 'Cobros, abonos y saldos',
    category: 'Compras y ventas',
    keywords: 'cobro abono pago pendiente saldo por cobrar reembolso a favor',
    summary: 'Registra abonos de clientes y reembolsos.',
    to: '/operaciones?tab=ventas&f=pendientes',
    toLabel: 'Ver ventas por cobrar',
    blocks: [
      { p: 'En el detalle de una venta toca "Registrar pago". Si el medio de pago tiene comisión configurada, se registra como gasto automáticamente (puedes cambiar el valor).' },
      { p: 'Un reembolso devuelve dinero al cliente (por ejemplo, un saldo a favor después de una devolución).' },
    ],
  },
  {
    id: 'devoluciones',
    title: 'Devoluciones y anulaciones',
    category: 'Compras y ventas',
    keywords: 'devolución devolver anular error cancelar',
    summary: 'Devolver no borra la venta: es una operación nueva. Anular es para errores.',
    blocks: [
      { list: ['Devolución: el cliente devuelve algo. La venta original se conserva y el equipo vuelve como disponible, en revisión o dañado, empezando un nuevo ciclo.', 'Anulación: la venta o compra se registró por error. Queda marcada como anulada y deja de contar en todo.'] },
      { p: 'Una compra pagada con deuda solo se puede anular si la deuda no tiene abonos (primero anula los abonos en Deudas).' },
    ],
  },
  {
    id: 'gastos',
    title: 'Gastos: operativos y capitalizados',
    category: 'Compras y ventas',
    keywords: 'gasto transporte publicidad arriendo reparación capitalizado operativo costo',
    summary: 'Qué gasto resta de la ganancia y cuál se suma al costo del equipo.',
    to: '/gastos/nuevo',
    toLabel: 'Registrar gasto',
    blocks: [
      { list: ['Operativo: publicidad, arriendo, transporte general… Se resta de la ganancia del periodo.', 'Capitalizado: un gasto que se suma al costo de un equipo o producto en existencia (por ejemplo, una reparación antes de venderlo). Se vuelve costo cuando lo vendes y no se resta dos veces.'] },
      { p: 'Los gastos sin inventario son "generales": cuentan en la vista de todos los inventarios, pero no al filtrar uno solo.' },
    ],
  },
  {
    id: 'comisiones',
    title: 'Comisiones por medio de pago',
    category: 'Compras y ventas',
    keywords: 'comisión datáfono tarjeta nequi daviplata porcentaje medio de pago',
    summary: 'Configura el % de cada medio de pago y la app registra la comisión como gasto.',
    to: '/ajustes',
    toLabel: 'Ir a Configuración',
    blocks: [
      { p: 'En Configuración → Comisiones por medio de pago escribe el porcentaje de cada medio (por ejemplo, Tarjeta 3,5 %).' },
      { p: 'Cada vez que registras un pago con ese medio, la app crea un gasto "Comisión medio de pago" con el valor calculado. Antes de confirmar puedes cambiarlo o ponerlo en 0.' },
      { tip: 'Comisión = pago × porcentaje ÷ 100, redondeada al peso.' },
    ],
  },

  /* ---------------- Equipos y reparaciones ---------------- */
  {
    id: 'unidades',
    title: 'Ficha de cada equipo',
    category: 'Equipos y reparaciones',
    keywords: 'unidad equipo ficha estado revisión dañado baja costo fecha inspección fotos historial imei',
    summary: 'Todo sobre un teléfono: costo, estado, piezas, inspección, fotos e historial.',
    blocks: [
      { p: 'Toca un equipo para ver su ficha. Desde el menú ⋮ puedes editar datos, cambiar su estado (disponible, en revisión, dañado), sumar costos, completar el costo o la fecha si eran desconocidos o darlo de baja.' },
      { p: 'Dar de baja (pérdida, robo, daño irreparable) reconoce su costo como pérdida y conserva el registro.' },
      { p: 'En modo profesional también tienes inspección de 16 puntos, fotos y garantía del proveedor.' },
    ],
  },
  {
    id: 'piezas',
    title: 'Historial de reparaciones y piezas',
    category: 'Equipos y reparaciones',
    keywords: 'reparación pieza batería pantalla tapa cámara face id touch id puerto altavoz genérica original pieza desconocida aviso restaurado',
    summary: 'Registra qué se le cambió al equipo, con qué calidad y quién lo hizo.',
    blocks: [
      { p: 'Disponible en los dos modos. Sirve sobre todo para equipos usados o restaurados.' },
      { list: ['Pieza: batería, pantalla, tapa trasera, cámaras, Face ID / Touch ID, puerto, altavoz, chasis, placa u otra.', 'Calidad: original, genérica o no sé.', 'Quién la cambió: dueño anterior, proveedor, yo o no sé.', '"Pieza desconocida": márcalo si el iPhone muestra ese aviso en Ajustes → General → Información.'] },
      { p: 'Anotar una pieza NO cambia el costo. Solo las reparaciones pagadas (botón "Registrar reparación") suman costo: si el equipo está en existencia, se suma a su costo; si ya se vendió, es un gasto.' },
      { p: 'Los equipos con piezas cambiadas muestran una etiqueta en las listas, y puedes filtrarlos.' },
      { tip: 'Las piezas genéricas o con aviso pueden restar valor al equipo. Puedes configurar un descuento para la calculadora "¿Cuánto pagar?".' },
    ],
  },
  {
    id: 'garantias',
    title: 'Garantías y reclamos',
    category: 'Equipos y reparaciones',
    keywords: 'garantía reclamo vencimiento cliente proveedor',
    summary: 'Garantías a clientes con vencimiento y reclamos con su costo.',
    to: '/garantias',
    toLabel: 'Ir a Garantías',
    blocks: [
      { p: 'Al vender puedes dar garantía (en días o meses). La app calcula el vencimiento y te avisa cuando está por vencer.' },
      { p: 'Un reclamo con costo se registra como gasto. Los reclamos también cuentan en la calificación del proveedor del equipo.' },
    ],
  },

  /* ---------------- Dinero y capital ---------------- */
  {
    id: 'capital',
    title: 'Capital: cuánto vale tu negocio y cuánto crece',
    category: 'Dinero y capital',
    keywords: 'capital inversión valor negocio crecimiento caja dinero invertido patrimonio',
    summary: 'El valor del negocio, el capital que has puesto y cuánto ha crecido.',
    to: '/capital',
    toLabel: 'Ir a Capital',
    blocks: [
      { list: ['Valor del negocio = caja + inventario a costo + por cobrar + lo que te prestaste − deudas − saldos a favor de clientes.', 'Capital aportado = aportes − retiros + la mercancía que ya tenías al empezar.', 'Crecimiento = valor del negocio − capital aportado. Es lo que el negocio ha ganado por sí mismo.'] },
      { p: 'La gráfica muestra mes a mes el valor del negocio y el capital aportado; la distancia entre las dos líneas es el crecimiento.' },
      { p: 'Puedes ver el capital de todos los inventarios juntos o de uno solo. Los movimientos sin inventario (generales) solo cuentan en "Todos".' },
      { warn: 'La caja es CALCULADA con lo que registras. Si no registras el dinero con el que empezaste o algún gasto, no coincidirá con la realidad. Usa "Ajuste de caja" para corregirla después de contar.' },
    ],
  },
  {
    id: 'aportes',
    title: 'Aportes, retiros, préstamos a ti y ajustes de caja',
    category: 'Dinero y capital',
    keywords: 'aporte retiro sacar dinero meter dinero préstamo a mí emergencia devolver ajuste caja faltante sobrante',
    summary: 'Cómo registrar el dinero que entra o sale entre tú y el negocio.',
    to: '/capital',
    toLabel: 'Ir a Capital',
    blocks: [
      { list: ['Aporte: dinero que metes al negocio.', 'Retiro: dinero que sacas para ti y no vas a devolver (ganancias o capital). Baja el capital aportado, no el crecimiento.', 'Préstamo a ti: tomas dinero de la inversión para algo tuyo o una emergencia y piensas devolverlo. El negocio no pierde valor: queda como una cuenta que te debes.', 'Devolución de tu préstamo: lo que repones.', 'Ajuste de caja: corrige la caja calculada después de contar el dinero real. Positivo si sobra, negativo si falta.'] },
      { tip: 'Si sacaste dinero "prestado" y al final decides no devolverlo, registra la devolución y luego un retiro por el mismo valor.' },
    ],
  },
  {
    id: 'deudas',
    title: 'Deudas y préstamos',
    category: 'Dinero y capital',
    keywords: 'deuda préstamo tarjeta de crédito proveedor crédito abono intereses cuota de manejo pagar',
    summary: 'Tarjeta de crédito, crédito del proveedor o préstamos de terceros, con abonos e intereses.',
    to: '/deudas',
    toLabel: 'Ir a Deudas',
    blocks: [
      { list: ['Compra pagada con tarjeta o a crédito: se registra desde la compra y la deuda se crea sola.', 'Préstamo en efectivo (un familiar, un banco): regístralo en Deudas → Nueva deuda. El dinero entra a la caja.'] },
      { p: 'Al abonar separa el abono a capital (lo que baja la deuda) de los intereses o cuota de manejo. Los intereses son un gasto financiero: restan de tu ganancia.' },
      { p: 'Cuando el saldo llega a cero, la deuda queda "Pagada".' },
    ],
  },
  {
    id: 'metas',
    title: 'Metas',
    category: 'Dinero y capital',
    keywords: 'meta objetivo valor crecimiento fecha ritmo mensual',
    summary: 'Ponte una meta de valor del negocio o de crecimiento y mira cuánto te falta.',
    to: '/capital',
    toLabel: 'Ir a Capital',
    blocks: [
      { p: 'En Capital → Metas toca "Nueva meta". Elige si quieres medir el valor del negocio o el crecimiento, el valor objetivo y, si quieres, una fecha.' },
      { p: 'Con fecha, la app calcula cuánto tendrías que crecer por mes para llegar a tiempo.' },
    ],
  },
  {
    id: 'metricas',
    title: 'Métricas: rentabilidad, rotación y dinero dormido',
    category: 'Dinero y capital',
    keywords: 'rentabilidad rotación dinero dormido estancado antigüedad dónde está mi dinero',
    summary: 'Qué tan bien trabaja tu dinero.',
    to: '/capital',
    toLabel: 'Ir a Capital',
    blocks: [
      { list: ['Rentabilidad del periodo = ganancia neta ÷ valor del negocio al empezar el periodo.', 'Rotación = costo de lo vendido ÷ inventario promedio. Cuántas veces "da la vuelta" tu inventario.', 'Días para recuperar el inventario = días del periodo ÷ rotación.', 'Dinero dormido = costo de lo que lleva más días sin venderse que tu umbral (según su estado).'] },
      { p: 'En "¿Dónde está tu dinero?" ves cuánto hay en caja, en inventario (por antigüedad), por cobrar y prestado, y cuánto debes.' },
      { tip: 'Toca el ⓘ junto a cada número para ver cómo se calcula.' },
    ],
  },

  /* ---------------- Precios ---------------- */
  {
    id: 'precios',
    title: 'Precios: mercado, tu precio real, mínimo y sugerido',
    category: 'Precios',
    keywords: 'precio mercado marketplace sugerido mínimo margen vender precio real promedio desactualizado',
    summary: 'Cómo la app te ayuda a ponerle precio a un equipo.',
    to: '/precios',
    toLabel: 'Ir a Precios de mercado',
    blocks: [
      { list: ['Precio de mercado: lo anotas tú (por ejemplo, lo que ves en Marketplace) por modelo, capacidad y estado. Se guarda el historial con fecha; si tiene más de 30 días (configurable) se marca como desactualizado.', 'Tu precio real: el promedio de lo que TÚ vendiste ese mismo modelo, capacidad y estado en los últimos 90 días (configurable).', 'Precio mínimo: tu costo + el margen mínimo que configures (en pesos o en %).', 'Precio sugerido: el de mercado si está al día; si no, tu precio real; si no, el precio de venta del producto; y si solo hay un precio de mercado viejo, ese. Nunca por debajo del mínimo.'] },
      { p: 'Al vender verás estos valores y una alerta si vendes por debajo del costo o del mínimo.' },
    ],
  },
  {
    id: 'calculadora',
    title: '¿Cuánto pagar? Calculadora de compra',
    category: 'Precios',
    keywords: 'calculadora cuánto pagar máximo comprar oferta margen deseado batería descuento',
    summary: 'El precio máximo que deberías pagar por un equipo para ganar lo que quieres.',
    to: '/calculadora',
    toLabel: 'Abrir calculadora',
    blocks: [
      { p: 'Escribe (o elige) el precio de mercado del equipo, su batería y cuántas piezas genéricas o con aviso tiene.' },
      { list: ['Mercado ajustado = mercado − descuento por batería baja − descuento por pieza genérica × piezas.', 'Con margen en pesos: máximo = mercado ajustado − margen − gastos esperados.', 'Con margen en %: máximo = mercado ajustado ÷ (1 + %) − gastos esperados (el % es sobre tu costo total).'] },
      { p: 'Los descuentos por batería y piezas son opcionales: se configuran en Configuración → Precios (en 0 no se aplican).' },
    ],
  },

  /* ---------------- Informes ---------------- */
  {
    id: 'informes',
    title: 'Informes',
    category: 'Informes',
    keywords: 'informe reporte finanzas tiempos más vendidos ganancia por día proveedores calificación',
    summary: 'Finanzas, tiempos de venta, más vendidos, rentabilidad por modelo y proveedores.',
    to: '/informes',
    toLabel: 'Ir a Informes',
    blocks: [
      { list: ['Finanzas: ingresos, costo de lo vendido, ganancias, gastos y cobros del periodo, comparados con el mismo tramo del periodo anterior.', 'Tiempos: días hasta vender por modelo, categoría e inventario, y lo que lleva más tiempo sin venderse.', 'Productos: los más vendidos y el % vendido.', 'Rentabilidad: ganancia por día por modelo y calificación de proveedores.'] },
      { p: 'Ganancia por día = ganancia total ÷ días totales que los equipos estuvieron esperando. Un modelo que deja poca ganancia pero se vende rapidísimo puede ser mejor negocio que uno con mucha ganancia que tarda meses.' },
    ],
  },
  {
    id: 'proveedores',
    title: 'Calificación de proveedores',
    category: 'Informes',
    keywords: 'proveedor calificación puntaje devoluciones reclamos piezas genéricas margen rapidez',
    summary: 'Un puntaje de 0 a 100 según margen, rapidez y problemas.',
    to: '/informes?tab=rentabilidad',
    toLabel: 'Ver calificaciones',
    blocks: [
      { list: ['Margen (hasta 40): 2 puntos por cada 1 % de ganancia sobre el costo.', 'Rapidez (hasta 30): 30 si se vende el mismo día; baja hasta 0 a los 90 días.', 'Calidad (hasta 30): baja con las devoluciones y reclamos por venta y con los equipos que llegaron con piezas genéricas o aviso de pieza desconocida.'] },
      { p: 'Con menos de 3 ventas el puntaje es poco confiable y se marca así.' },
    ],
  },
  {
    id: 'estancado',
    title: 'Productos estancados (opcional)',
    category: 'Informes',
    keywords: 'estancado días sin vender aviso umbral nuevo usado restaurado desactivar',
    summary: 'Avisos de lo que lleva mucho tiempo sin venderse, con umbrales por estado.',
    to: '/ajustes',
    toLabel: 'Ir a Configuración',
    blocks: [
      { p: 'En Configuración puedes apagar los avisos de estancado o poner umbrales distintos para equipos nuevos y para usados/restaurados (que suelen devaluarse menos).' },
      { p: 'Aunque apagues los avisos, la app sigue mostrando el "dinero dormido" en Capital con esos mismos umbrales.' },
    ],
  },
  {
    id: 'resumen',
    title: 'Resumen mensual para compartir',
    category: 'Informes',
    keywords: 'resumen mensual compartir imagen pdf whatsapp primo socio',
    summary: 'Una imagen o PDF con los números del mes.',
    to: '/resumen',
    toLabel: 'Abrir resumen mensual',
    blocks: [
      { p: 'Elige el mes y el inventario. Verás ventas, ganancia, gastos, valor del negocio, crecimiento, lo más vendido y lo más rentable por día.' },
      { p: 'Toca "Compartir imagen" o "Compartir PDF" para enviarlo por WhatsApp, correo, etc. El archivo se crea en tu teléfono; la app no lo sube a ningún lado.' },
    ],
  },

  /* ---------------- Respaldo y seguridad ---------------- */
  {
    id: 'respaldo',
    title: 'Respaldo y pasar datos a otro teléfono',
    category: 'Respaldo y seguridad',
    keywords: 'respaldo copia de seguridad exportar importar restaurar otro teléfono contraseña cifrado deshacer',
    summary: 'Guarda una copia de todo y restáurala en este u otro teléfono.',
    to: '/respaldo',
    toLabel: 'Ir a Respaldo',
    blocks: [
      { steps: ['En Respaldo toca "Preparar respaldo". Si quieres, ponle contraseña (cifrado AES-256): sin ella nadie puede abrirlo, ni tú.', 'Toca "Guardar o compartir" y envíalo fuera del teléfono (WhatsApp, Drive, correo, AirDrop).', 'En el otro teléfono: Respaldo → "Elegir archivo de respaldo". Verás un resumen antes de reemplazar.'] },
      { warn: 'Importar REEMPLAZA todos los datos del teléfono. La app guarda una copia interna para que puedas deshacer la última restauración.' },
      { p: 'Los respaldos de la versión 1 se convierten automáticamente al importarlos en la versión 2.' },
    ],
  },

  /* ---------------- Configuración ---------------- */
  {
    id: 'configuracion',
    title: 'Configuración',
    category: 'Configuración',
    keywords: 'configuración ajustes prefijos códigos estados margen comisiones estancado',
    summary: 'Qué puedes ajustar y para qué sirve.',
    to: '/ajustes',
    toLabel: 'Ir a Configuración',
    blocks: [
      { list: ['Negocio: nombre, modalidad por defecto y prefijos de códigos internos.', 'Estancado: activar o apagar los avisos y los días para nuevos y usados/restaurados.', 'Precios: margen mínimo, margen deseado, gastos esperados por equipo, descuentos por batería y por pieza genérica, días para precio desactualizado y para "tu precio real".', 'Comisiones por medio de pago.', 'Recordatorio de respaldo y aviso de garantías.'] },
    ],
  },
  {
    id: 'problemas',
    title: 'Preguntas frecuentes y problemas',
    category: 'Configuración',
    keywords: 'problema error no coincide caja ganancia incompleta duplicado ayuda preguntas',
    summary: 'Respuestas a las dudas más comunes.',
    blocks: [
      { h: '¿Por qué la ganancia dice "incompleta"?' },
      { p: 'Vendiste equipos con costo desconocido. Completa su costo en la ficha del equipo (menú ⋮ → Completar costo).' },
      { h: 'La caja no coincide con mi dinero real' },
      { p: 'Revisa que registraste el dinero con el que empezaste (Aporte), todos los gastos y los retiros. Luego cuenta el dinero y registra un Ajuste de caja.' },
      { h: '¿El crecimiento es lo mismo que la ganancia?' },
      { p: 'Casi: crecimiento = ganancia neta acumulada + ajustes de caja + mercancía encontrada en conteos. Los aportes y retiros no cambian el crecimiento.' },
      { h: 'Me sale un aviso de posible duplicado' },
      { p: 'Hay dos equipos en existencia con el mismo IMEI o serial. Revisa si registraste el mismo equipo dos veces.' },
      { h: 'Cambié de teléfono' },
      { p: 'Haz un respaldo en el teléfono viejo e impórtalo en el nuevo (Respaldo → Elegir archivo de respaldo).' },
    ],
  },
];

export function findArticle(id: string): Article | undefined {
  return ARTICLES.find((a) => a.id === id);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function blockText(b: Block): string {
  if ('p' in b) return b.p;
  if ('h' in b) return b.h;
  if ('tip' in b) return b.tip;
  if ('warn' in b) return b.warn;
  if ('steps' in b) return b.steps.join(' ');
  return b.list.join(' ');
}

/** Búsqueda simple (sin tildes): todas las palabras deben aparecer. Título y palabras clave pesan más. */
export function searchArticles(q: string): Article[] {
  const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return ARTICLES;
  const scored: [Article, number][] = [];
  for (const a of ARTICLES) {
    const head = norm(`${a.title} ${a.keywords} ${a.summary}`);
    const body = norm(a.blocks.map(blockText).join(' '));
    let score = 0;
    let all = true;
    for (const w of words) {
      if (head.includes(w)) score += 3;
      else if (body.includes(w)) score += 1;
      else all = false;
    }
    if (all) scored.push([a, score]);
  }
  return scored.sort((x, y) => y[1] - x[1]).map(([a]) => a);
}

/* ---------------- Explicación de métricas (ⓘ) ---------------- */

export interface MetricHelp {
  title: string;
  what: string;
  formula?: string;
  note?: string;
}

export const METRICS: Record<string, MetricHelp> = {
  netRevenue: { title: 'Ingresos netos', what: 'Lo que vendiste en el periodo, después de descuentos y devoluciones.', formula: 'ventas − descuentos − devoluciones' },
  collected: { title: 'Dinero cobrado', what: 'El dinero que realmente recibiste en el periodo (puede incluir abonos de ventas anteriores).', formula: 'pagos recibidos − reembolsos' },
  grossProfit: { title: 'Ganancia bruta', what: 'Lo que te dejaron las ventas antes de gastos.', formula: 'ingresos netos − costo de lo vendido', note: 'Si dice "incompleta", hay ventas de equipos sin costo conocido.' },
  netProfit: { title: 'Ganancia neta', what: 'Lo que te quedó de verdad en el periodo.', formula: 'ganancia bruta − gastos operativos − bajas', note: 'Incluye intereses de deudas y comisiones de medios de pago, porque son gastos operativos.' },
  purchases: { title: 'Compras', what: 'Total invertido en compras registradas en el periodo (incluye gastos de la compra).' },
  cogs: { title: 'Costo de lo vendido', what: 'Lo que te costaron los productos que vendiste (costo de compra + costos sumados, como reparaciones).', formula: 'costo de lo vendido − costo de lo devuelto' },
  operatingExpenses: { title: 'Gastos operativos', what: 'Gastos que restan de la ganancia: publicidad, envíos, comisiones, intereses, garantías…' },
  receivables: { title: 'Por cobrar', what: 'Lo que tus clientes todavía te deben.' },
  stockValue: { title: 'Valor a costo', what: 'Lo que te costó lo que tienes disponible para vender. No es ganancia: es dinero invertido en mercancía.' },
  avgDaysToSell: { title: 'Días promedio hasta vender', what: 'Cuánto tarda en venderse un producto desde que queda disponible.', note: 'Solo cuenta productos con fecha de ingreso conocida.' },
  businessValue: {
    title: 'Valor del negocio',
    what: 'Cuánto vale hoy tu negocio a costo: lo que tienes menos lo que debes.',
    formula: 'caja + inventario a costo + por cobrar + préstamos a ti − deudas − saldos a favor de clientes',
  },
  cash: {
    title: 'Caja calculada',
    what: 'El dinero que debería haber según lo que registraste.',
    formula: 'aportes − retiros ± ajustes − préstamos a ti + devoluciones + cobros − reembolsos − compras − gastos + deudas recibidas − abonos a capital',
    note: 'Si no coincide con tu dinero real, registra un ajuste de caja.',
  },
  netCapital: { title: 'Capital aportado', what: 'Lo que tú has puesto en el negocio.', formula: 'aportes − retiros + mercancía que ya tenías al empezar' },
  growth: {
    title: 'Crecimiento',
    what: 'Lo que el negocio ha crecido por sí mismo, sin contar lo que tú metes o sacas.',
    formula: 'valor del negocio − capital aportado',
    note: 'Es igual a la ganancia neta acumulada + ajustes de caja + mercancía encontrada en conteos.',
  },
  growthPct: { title: 'Crecimiento %', what: 'Cuánto ha crecido tu negocio respecto a lo que has puesto.', formula: 'crecimiento ÷ capital aportado × 100' },
  inventoryCapital: { title: 'Inventario a costo', what: 'Lo que te costó toda la mercancía en existencia (disponible, en revisión y dañada).', note: 'Las unidades con costo desconocido no suman.' },
  ownerLoans: { title: 'Préstamos a ti', what: 'Dinero del negocio que tomaste para algo tuyo y aún no devuelves. Sigue siendo del negocio.' },
  debts: { title: 'Deudas', what: 'Lo que el negocio debe: tarjetas, crédito de proveedores y préstamos.', formula: 'valor de las deudas − abonos a capital' },
  periodReturn: {
    title: 'Rentabilidad del periodo',
    what: 'Cuánto ganó tu negocio en el periodo comparado con lo que valía al empezar.',
    formula: 'ganancia neta del periodo ÷ valor del negocio al inicio del periodo × 100',
    note: 'Si el negocio empezó en este periodo, se usa el capital aportado.',
  },
  rotation: {
    title: 'Rotación del inventario',
    what: 'Cuántas veces "da la vuelta" tu inventario en el periodo. Más alto = el dinero vuelve más rápido.',
    formula: 'costo de lo vendido ÷ inventario promedio (inicio y fin del periodo)',
  },
  inventoryDays: { title: 'Días para recuperar el inventario', what: 'Cuántos días tarda en promedio el dinero del inventario en volver a ti.', formula: 'días del periodo ÷ rotación' },
  dormant: {
    title: 'Dinero dormido',
    what: 'Costo de lo que lleva más días sin venderse que tu umbral de estancado (según si es nuevo o usado/restaurado).',
    note: 'Se calcula aunque tengas apagados los avisos de estancado.',
  },
  profitPerDay: {
    title: 'Ganancia por día',
    what: 'Cuánto te deja cada día que un equipo estuvo esperando a venderse.',
    formula: 'ganancia total ÷ días totales en inventario',
    note: 'Solo equipos con costo y fecha conocidos.',
  },
  dailyReturn: {
    title: 'Rendimiento mensual del dinero',
    what: 'Cuánto rinde el dinero invertido en ese modelo, llevado a 30 días.',
    formula: 'ganancia ÷ (costo × días en inventario) × 30 × 100',
  },
  supplierScore: {
    title: 'Calificación del proveedor',
    what: 'Puntaje de 0 a 100 = margen (hasta 40) + rapidez (hasta 30) + calidad (hasta 30).',
    formula: 'margen: 2 puntos por cada 1 % de ganancia sobre el costo · rapidez: 30 × (1 − días ÷ 90) · calidad: 30 − 60 × (devoluciones + reclamos) ÷ ventas − 30 × equipos con piezas genéricas o aviso ÷ comprados',
    note: 'Con menos de 3 ventas es poco confiable.',
  },
  minPrice: { title: 'Precio mínimo', what: 'Por debajo de este precio no ganas lo mínimo que configuraste.', formula: 'costo + margen mínimo (en pesos o en %)' },
  suggestedPrice: { title: 'Precio sugerido', what: 'El precio de mercado si está al día; si no, tu precio real; si no, el precio de venta del producto. Nunca por debajo del mínimo.' },
  recentPrice: { title: 'Tu precio real', what: 'El promedio de lo que tú vendiste este mismo modelo, capacidad y estado en los últimos días configurados.' },
  marketPrice: { title: 'Precio de mercado', what: 'El último precio que anotaste para este modelo, capacidad y estado (por ejemplo, de Marketplace).', note: 'Se marca como desactualizado después de los días configurados.' },
  maxBuy: {
    title: 'Precio máximo de compra',
    what: 'Lo máximo que deberías pagar para ganar el margen que quieres.',
    formula: 'en pesos: mercado ajustado − margen − gastos · en %: mercado ajustado ÷ (1 + %) − gastos',
  },
  paymentFee: { title: 'Comisión del medio de pago', what: 'Lo que te cobra el datáfono o la plataforma. Se registra como gasto operativo.', formula: 'pago × % configurado ÷ 100' },
  sellThrough: { title: '% vendido', what: 'Qué parte de ese producto ya se vendió.', formula: 'vendidas ÷ (vendidas + disponibles)' },
};

/* ---------------- Ayuda por pantalla (?) ---------------- */

export interface ScreenHelp {
  title: string;
  intro: string;
  articles: string[];
}

export const SCREEN_HELP: Record<string, ScreenHelp> = {
  home: { title: 'Inicio', intro: 'Resumen de tu actividad del periodo, saldos a hoy y avisos. Cambia el periodo o el inventario arriba.', articles: ['empezar', 'informes', 'capital'] },
  inventories: { title: 'Inventarios', intro: 'Tus inventarios. Toca uno para ver sus productos y existencias.', articles: ['inventarios', 'productos', 'vistas'] },
  inventory: { title: 'Inventario', intro: 'Productos y existencias de este inventario. Desde ⋮ cambias la modalidad, lo archivas o ves su historial.', articles: ['inventarios', 'productos', 'stock-existente'] },
  product: { title: 'Producto', intro: 'Existencias, unidades y movimientos del producto. Toca una unidad para ver su ficha.', articles: ['productos', 'unidades', 'piezas'] },
  'product-form': { title: 'Producto', intro: 'Crea o edita un producto. Para teléfonos, elige el modelo del catálogo.', articles: ['productos'] },
  stock: { title: 'Ingresar stock existente', intro: 'Mercancía que ya tenías antes de usar la app. Cuenta como capital aportado en mercancía.', articles: ['stock-existente', 'piezas', 'capital'] },
  unit: { title: 'Ficha del equipo', intro: 'Todo sobre este equipo: costo, estado, piezas cambiadas, precio sugerido e historial.', articles: ['unidades', 'piezas', 'precios'] },
  'purchase-form': { title: 'Nueva compra', intro: 'Registra lo que compraste, su estado, piezas y cómo lo pagaste.', articles: ['compras', 'deudas', 'piezas'] },
  purchase: { title: 'Compra', intro: 'Detalle de la compra. Si te equivocaste en los importes, anúlala y regístrala de nuevo.', articles: ['compras', 'devoluciones'] },
  'sale-form': { title: 'Nueva venta', intro: 'Elige lo que vendes y el precio. La app te muestra el costo, el mínimo y el sugerido.', articles: ['ventas', 'precios', 'comisiones'] },
  sale: { title: 'Venta', intro: 'Detalle, pagos, devoluciones y garantías de la venta.', articles: ['pagos', 'devoluciones', 'garantias'] },
  operations: { title: 'Operaciones', intro: 'Tus ventas, compras y gastos. Filtra las ventas por cobrar.', articles: ['ventas', 'compras', 'gastos'] },
  'expense-form': { title: 'Nuevo gasto', intro: 'Elige si el gasto resta de la ganancia (operativo) o se suma al costo de un equipo (capitalizado).', articles: ['gastos'] },
  capital: { title: 'Capital', intro: 'Cuánto vale tu negocio, cuánto has puesto y cuánto ha crecido. Toca ⓘ para ver cada cálculo.', articles: ['capital', 'aportes', 'metricas', 'metas'] },
  debts: { title: 'Deudas y préstamos', intro: 'Lo que debe el negocio y lo que tú le debes. Registra abonos e intereses.', articles: ['deudas', 'aportes'] },
  debt: { title: 'Deuda', intro: 'Abonos e intereses de esta deuda.', articles: ['deudas'] },
  prices: { title: 'Precios de mercado', intro: 'Anota precios de referencia por modelo, capacidad y estado. Se guarda el historial.', articles: ['precios', 'calculadora'] },
  calculator: { title: '¿Cuánto pagar?', intro: 'Calcula el máximo que deberías pagar por un equipo según el mercado y el margen que quieres.', articles: ['calculadora', 'precios'] },
  summary: { title: 'Resumen mensual', intro: 'Los números del mes en una imagen o PDF para compartir.', articles: ['resumen', 'capital'] },
  reports: { title: 'Informes', intro: 'Finanzas, tiempos, más vendidos y rentabilidad por modelo y proveedor.', articles: ['informes', 'proveedores', 'estancado'] },
  warranties: { title: 'Garantías', intro: 'Garantías vigentes, por vencer y reclamos.', articles: ['garantias'] },
  parties: { title: 'Proveedores y compradores', intro: 'Tus contactos y sus operaciones.', articles: ['proveedores', 'compras'] },
  views: { title: 'Vistas consolidadas', intro: 'Varios inventarios juntos sin duplicar nada.', articles: ['vistas'] },
  catalog: { title: 'Catálogo', intro: 'Modelos disponibles al crear productos. Puedes agregar marcas y modelos.', articles: ['productos'] },
  backup: { title: 'Respaldo', intro: 'Crea una copia de todo o restaura una. Importar reemplaza todos los datos.', articles: ['respaldo', 'privacidad'] },
  settings: { title: 'Configuración', intro: 'Ajustes del negocio, estancado, precios y comisiones.', articles: ['configuracion', 'estancado', 'comisiones'] },
  more: { title: 'Más', intro: 'Todas las secciones de la app.', articles: ['empezar'] },
};

/* ---------------- Novedades ---------------- */

export interface ChangelogEntry {
  version: string;
  title: string;
  items: { title: string; text: string; to?: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.0.0',
    title: 'Novedades de la versión 2',
    items: [
      { title: 'Capital del negocio', text: 'Mira cuánto vale tu negocio, cuánto has puesto y cuánto ha crecido mes a mes, con metas.', to: '/capital' },
      { title: 'Deudas y préstamos', text: 'Tarjeta de crédito, crédito del proveedor, préstamos de terceros y "préstamo a ti", con abonos e intereses.', to: '/deudas' },
      { title: 'Precios', text: 'Precio de mercado con historial, tu precio real, mínimo, sugerido al vender y la calculadora "¿Cuánto pagar?".', to: '/precios' },
      { title: 'Reparaciones y piezas', text: 'Historial de piezas cambiadas por equipo (original, genérica, pieza desconocida), también en modo sencillo.' },
      { title: 'Estado del equipo', text: 'Elige Nuevo, Usado o Restaurado al ingresar teléfonos. "Reacondicionado" ahora se llama "Restaurado".' },
      { title: 'Estancado opcional', text: 'Puedes apagar los avisos o usar días distintos para nuevos y usados/restaurados.', to: '/ajustes' },
      { title: 'Informes nuevos', text: 'Ganancia por día por modelo, calificación de proveedores y resumen mensual para compartir.', to: '/informes?tab=rentabilidad' },
      { title: 'Comisiones', text: 'El % de cada medio de pago se registra solo como gasto.', to: '/ajustes' },
      { title: 'Ayuda', text: 'Manual con buscador, "?" en cada pantalla, ⓘ en cada número y modo práctica.', to: '/ayuda' },
    ],
  },
];
