/**
 * MENÚS POR CATEGORÍAS (v2.3): una sola lista para el menú Más, la barra lateral (tableta o computador)
 * y el botón + (Registrar). Agrupar evita una lista larga y revuelta.
 */

export interface MenuEntry {
  href: string;
  label: string;
  icon: string;
  sub?: string;
  /** Primer segmento de la ruta (para marcar la sección actual). */
  key: string;
}

export interface MenuGroup {
  title: string;
  items: MenuEntry[];
}

const e = (href: string, label: string, icon: string, sub?: string): MenuEntry => ({ href, label, icon, sub, key: href.slice(1).split(/[/?]/)[0] });

/** Menú Más (y la barra lateral, después de Inicio, Inventarios y Operaciones). */
export const MORE_GROUPS: MenuGroup[] = [
  {
    title: 'Análisis e informes',
    items: [
      e('/analisis', 'Análisis del negocio', 'gauge', 'Salud, lo que esperas ganar, expectativas, tendencias y más'),
      e('/informes', 'Informes', 'chart', 'Finanzas, tiempos, más vendidos y rentabilidad'),
      e('/resumen', 'Resumen mensual', 'image', 'Imagen o PDF para compartir'),
    ],
  },
  {
    title: 'Clientes y cobros',
    items: [
      e('/me-deben', 'Me deben', 'users', 'A quién le fiaste, cuánto te debe, abonos y cobro por WhatsApp'),
      e('/preguntones', 'Preguntones', 'chat', 'Cuántos preguntan y no compran, por semana y por mes'),
      e('/compradores', 'Compradores', 'users'),
      e('/garantias', 'Garantías', 'shield', 'Vigentes, por vencer y reclamos'),
    ],
  },
  {
    title: 'Compras y mercancía',
    items: [
      e('/precios', 'Precios de mercado', 'tag', 'Historial de precios y precio sugerido'),
      e('/calculadora', '¿Cuánto pagar?', 'calc', 'Precio máximo de compra'),
      e('/proveedores', 'Proveedores', 'truck'),
      e('/catalogo', 'Catálogo de modelos', 'book'),
      e('/vistas', 'Vistas consolidadas', 'layers', 'Consultar varios inventarios juntos'),
    ],
  },
  {
    title: 'Tu plata',
    items: [
      e('/capital', 'Capital', 'trend', 'Cuánto vale tu negocio y cuánto crece'),
      e('/deudas', 'Deudas y préstamos', 'card', 'Tarjeta, proveedores, préstamos y lo que te prestaste'),
      e('/personal', 'Gastos personales', 'wallet', 'Gustos y gastos hormiga: ¿salen de tus ganancias o del capital?'),
    ],
  },
  {
    title: 'Organízate',
    items: [
      e('/notas', 'Notas', 'note', 'Pedidos, ideas, listas y lo que quieras anotar'),
      e('/calendario', 'Calendario y recordatorios', 'clock', 'Notas con fecha y aviso los días que elijas'),
      e('/buscar', 'Buscar', 'search', 'Código, IMEI, serial, modelo…'),
      e('/historial', 'Historial general', 'history'),
    ],
  },
  {
    title: 'Aprende y ayuda',
    items: [
      e('/aprende', 'Aprende de negocios', 'star', 'Lecciones cortas con ejemplos, calculadoras y preguntas'),
      e('/ayuda', 'Ayuda', 'help', 'Manual, primeros pasos, recorridos, modo práctica y novedades'),
    ],
  },
  {
    title: 'App y datos',
    items: [
      e('/respaldo', 'Respaldo y restauración', 'download', 'Exportar, importar, deshacer'),
      e('/apariencia', 'Apariencia, sonidos y voz', 'palette', 'Colores, animaciones, tonos y lectura en voz alta'),
      e('/ajustes', 'Configuración', 'sliders'),
    ],
  },
];

export interface QuickAction {
  href: string;
  label: string;
  icon: string;
  hint: string;
}

export interface QuickGroup {
  title: string;
  items: QuickAction[];
}

/** Botón + (Registrar), por categorías. */
export const QUICK_GROUPS: QuickGroup[] = [
  {
    title: 'Vender y cobrar',
    items: [
      { href: '/ventas/nueva', label: 'Venta', icon: 'tag', hint: 'Sale del inventario y suma ingresos' },
      { href: '/ventas/nueva?fiado=1', label: 'Fiar mercancía', icon: 'users', hint: 'Venta que te pagan después o por partes' },
      { href: '/me-deben', label: 'Abono de quien te debe', icon: 'money', hint: 'Fiados y abonos por persona' },
      { href: '/preguntones', label: 'Preguntón (+1)', icon: 'chat', hint: 'Alguien preguntó y no compró' },
    ],
  },
  {
    title: 'Comprar y mercancía',
    items: [
      { href: '/compras/nueva', label: 'Compra', icon: 'cart', hint: 'Entra al inventario con su costo' },
      { href: '/stock/nuevo', label: 'Stock que ya tenías', icon: 'box', hint: 'Mercancía que ya tenías (no es una compra nueva)' },
      { href: '/productos/nuevo', label: 'Producto nuevo', icon: 'plus', hint: 'Sin registrar existencias todavía' },
      { href: '/calculadora', label: '¿Cuánto pagar?', icon: 'calc', hint: 'Precio máximo de compra según el mercado' },
    ],
  },
  {
    title: 'Gastos',
    items: [
      { href: '/gastos/nuevo', label: 'Gasto del negocio', icon: 'receipt', hint: 'Publicidad, empaques, arriendo…' },
      { href: '/gastos/nuevo?tipo=compra', label: 'Gasto del viaje de compras', icon: 'truck', hint: 'Pasajes y comida: se reparte entre las compras del día' },
      { href: '/gastos/nuevo?tipo=personal', label: 'Gasto personal', icon: 'wallet', hint: 'Un gusto o gasto hormiga con plata del negocio' },
    ],
  },
  {
    title: 'Tu plata',
    items: [
      { href: '/capital', label: 'Aporte, retiro o préstamo a ti', icon: 'trend', hint: 'Dinero que entra o sale entre tú y el negocio' },
      { href: '/deudas', label: 'Deuda o abono', icon: 'card', hint: 'Tarjeta, crédito del proveedor, préstamos' },
    ],
  },
  {
    title: 'Anotar',
    items: [
      { href: '/notas?nueva=1', label: 'Nota', icon: 'note', hint: 'Algo que no quieres olvidar' },
      { href: '/calendario?nueva=1', label: 'Nota con fecha y aviso', icon: 'clock', hint: 'Te avisa los días que elijas' },
    ],
  },
];

/** Lista plana (para buscar o probar). */
export const QUICK_ACTIONS: QuickAction[] = QUICK_GROUPS.flatMap((g) => g.items);
