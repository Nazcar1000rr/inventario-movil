/**
 * TIPOS DE NEGOCIO (v2.4)
 * La primera vez que abres la app te pregunta qué vendes y se acomoda: muestra solo lo que te sirve (por ejemplo, sin
 * celulares ni garantías si vendes tinto) y te sugiere productos típicos. Puedes cambiar o sumar otro negocio en
 * Configuración, incluso de tipos distintos. Todo se guarda solo en este teléfono.
 */

export type FeatureKey =
  /** Contador de preguntones (los que preguntan y no compran). */
  | 'inquiries'
  /** Celulares: catálogo de modelos, capacidades, IMEI, precios de mercado y «¿Cuánto pagar?». */
  | 'phones'
  /** Garantías por equipo o por venta. */
  | 'warranties'
  /** Cotizaciones. */
  | 'quotes';

export const FEATURES: { key: FeatureKey; label: string; hint: string }[] = [
  { key: 'inquiries', label: 'Preguntones', hint: 'El contador de los que preguntan y no compran.' },
  { key: 'phones', label: 'Celulares y su catálogo', hint: 'Modelos, capacidades, IMEI, precios de mercado y «¿Cuánto pagar?».' },
  { key: 'warranties', label: 'Garantías', hint: 'Garantías de lo que vendes y reclamos.' },
  { key: 'quotes', label: 'Cotizaciones', hint: 'Armar y enviar cotizaciones y pasarlas a venta.' },
];

export type BusinessTypeId = 'tecnologia' | 'calle' | 'comida' | 'mascotas' | 'gimnasio' | 'tienda' | 'ropa' | 'belleza' | 'ferreteria' | 'papeleria' | 'servicios' | 'otro';

export interface BusinessType {
  id: BusinessTypeId;
  label: string;
  hint: string;
  /** Qué funciones le sirven a este tipo de negocio. */
  features: Record<FeatureKey, boolean>;
  /** Productos típicos que se pueden crear con un toque (sin precios: los pones tú). */
  starter: { name: string; unit?: string }[];
  /** Nombre sugerido para el inventario. */
  inventoryName: string;
}

const ON = { inquiries: true, phones: true, warranties: true, quotes: true };
const BASIC = { inquiries: false, phones: false, warranties: false, quotes: false };

export const BUSINESS_TYPES: BusinessType[] = [
  { id: 'tecnologia', label: 'Tecnología y celulares', hint: 'Celulares, audífonos, accesorios y reparaciones', features: ON, inventoryName: 'Tecnología', starter: [{ name: 'Cargador USB-C 20 W' }, { name: 'Cable de carga' }, { name: 'Forro o estuche' }, { name: 'Vidrio templado' }] },
  { id: 'calle', label: 'Ventas de la calle (perros calientes, tinto, empanadas…)', hint: 'Ventas informales o ambulantes, todo el día en la calle', features: { ...BASIC, inquiries: true }, inventoryName: 'Mi puesto', starter: [{ name: 'Perro caliente' }, { name: 'Hamburguesa' }, { name: 'Tinto' }, { name: 'Empanada' }, { name: 'Arepa rellena' }, { name: 'Gaseosa' }, { name: 'Agua' }, { name: 'Papas fritas' }] },
  { id: 'comida', label: 'Comida rápida y restaurante', hint: 'Pizzas, hamburguesas, almuerzos, domicilios', features: { ...BASIC, quotes: true }, inventoryName: 'Cocina', starter: [{ name: 'Almuerzo corriente' }, { name: 'Hamburguesa' }, { name: 'Pizza personal' }, { name: 'Jugo natural' }, { name: 'Gaseosa' }, { name: 'Postre' }] },
  { id: 'mascotas', label: 'Tienda de mascotas', hint: 'Alimento, accesorios, higiene y juguetes', features: { ...BASIC, inquiries: true }, inventoryName: 'Mascotas', starter: [{ name: 'Alimento para perro (bulto)' }, { name: 'Alimento para gato' }, { name: 'Juguete' }, { name: 'Correa y collar' }, { name: 'Shampoo para mascotas' }, { name: 'Arena para gato' }] },
  { id: 'gimnasio', label: 'Gimnasio', hint: 'Entradas del día, mensualidades y planes: nombre de la persona y forma de pago', features: { ...BASIC, quotes: true }, inventoryName: 'Gimnasio', starter: [{ name: 'Entrada del día' }, { name: 'Semana' }, { name: 'Quincena' }, { name: 'Mensualidad' }, { name: 'Trimestre' }, { name: 'Bebida deportiva' }] },
  { id: 'tienda', label: 'Tienda de barrio o minimercado', hint: 'Abarrotes, aseo, bebidas y mecato', features: { ...BASIC, inquiries: true }, inventoryName: 'Tienda', starter: [{ name: 'Arroz (libra)' }, { name: 'Huevos' }, { name: 'Leche' }, { name: 'Pan' }, { name: 'Gaseosa' }, { name: 'Aseo' }] },
  { id: 'ropa', label: 'Ropa, calzado y accesorios', hint: 'Prendas por talla y color', features: { ...BASIC, inquiries: true, quotes: true }, inventoryName: 'Ropa', starter: [{ name: 'Camiseta' }, { name: 'Jean' }, { name: 'Tenis' }, { name: 'Gorra' }, { name: 'Medias' }] },
  { id: 'belleza', label: 'Peluquería, belleza y estética', hint: 'Servicios y productos de belleza', features: { ...BASIC, quotes: true }, inventoryName: 'Belleza', starter: [{ name: 'Corte de cabello' }, { name: 'Manicure' }, { name: 'Tinte' }, { name: 'Shampoo' }] },
  { id: 'ferreteria', label: 'Ferretería y materiales', hint: 'Herramientas, tornillería y construcción', features: { ...BASIC, quotes: true }, inventoryName: 'Ferretería', starter: [{ name: 'Tornillos (caja)' }, { name: 'Cemento (bulto)' }, { name: 'Pintura (galón)' }, { name: 'Taladro' }] },
  { id: 'papeleria', label: 'Papelería y fotocopias', hint: 'Útiles, impresiones y fotocopias', features: { ...BASIC, quotes: true }, inventoryName: 'Papelería', starter: [{ name: 'Fotocopia' }, { name: 'Impresión' }, { name: 'Cuaderno' }, { name: 'Esfero' }, { name: 'Resma de papel' }] },
  { id: 'servicios', label: 'Servicios (técnico, domicilios, reparaciones)', hint: 'Cobras por servicio o por hora', features: { ...BASIC, warranties: true, quotes: true }, inventoryName: 'Servicios', starter: [{ name: 'Servicio técnico' }, { name: 'Domicilio' }, { name: 'Repuesto' }] },
  { id: 'otro', label: 'Otro negocio', hint: 'Lo configuras tú: puedes activar lo que necesites en Configuración', features: { ...BASIC, inquiries: true }, inventoryName: 'Mi negocio', starter: [] },
];

export const BUSINESS_BY_ID = new Map(BUSINESS_TYPES.map((b) => [b.id, b]));

export interface BusinessProfile {
  /** false hasta que la persona termina la bienvenida (o ya tenía datos antes de la 2.4). */
  done: boolean;
  /** Tipos de negocio elegidos (uno o varios). */
  types: BusinessTypeId[];
  /** Cambios a mano: pisan lo que sugiere el tipo de negocio. */
  overrides: Partial<Record<FeatureKey, boolean>>;
}

export const DEFAULT_PROFILE: BusinessProfile = { done: false, types: [], overrides: {} };

/** Una función está activa si lo pediste a mano; si no, si le sirve a alguno de tus tipos de negocio. Sin tipos, todo activo. */
export function featureOn(profile: BusinessProfile, key: FeatureKey): boolean {
  const o = profile.overrides[key];
  if (typeof o === 'boolean') return o;
  const types = profile.types.map((t) => BUSINESS_BY_ID.get(t)).filter((t): t is BusinessType => !!t);
  if (!types.length) return true;
  return types.some((t) => t.features[key]);
}

export function normalizeProfile(raw: unknown): BusinessProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BusinessProfile>;
  const types = Array.isArray(r.types) ? [...new Set(r.types.filter((t): t is BusinessTypeId => BUSINESS_BY_ID.has(t as BusinessTypeId)))] : [];
  const overrides: BusinessProfile['overrides'] = {};
  if (r.overrides && typeof r.overrides === 'object') for (const f of FEATURES) if (typeof r.overrides[f.key] === 'boolean') overrides[f.key] = r.overrides[f.key];
  return { done: r.done === true, types, overrides };
}
