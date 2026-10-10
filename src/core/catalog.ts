import type { CatalogModel, PartChange, PartChangedBy, PartKey, PartQuality } from './types';

/**
 * Catálogo base verificado (octubre de 2026). Fuentes: páginas oficiales/Wikipedia/MacRumors.
 * Solo modelos anunciados oficialmente. El catálogo es editable y ampliable desde la app.
 * El nombre de modelo NO identifica una unidad física: cada unidad tiene su propio código.
 */
type Seed = [generation: string, model: string, year: number, storage: string[], bio: CatalogModel['biometric']];

const S = (...gb: (number | string)[]) => gb.map((x) => (typeof x === 'number' ? `${x} GB` : x));

const IPHONES: Seed[] = [
  ['iPhone X', 'iPhone X', 2017, S(64, 256), 'faceid'],
  ['iPhone XS / XR', 'iPhone XR', 2018, S(64, 128, 256), 'faceid'],
  ['iPhone XS / XR', 'iPhone XS', 2018, S(64, 256, 512), 'faceid'],
  ['iPhone XS / XR', 'iPhone XS Max', 2018, S(64, 256, 512), 'faceid'],
  ['iPhone 11', 'iPhone 11', 2019, S(64, 128, 256), 'faceid'],
  ['iPhone 11', 'iPhone 11 Pro', 2019, S(64, 256, 512), 'faceid'],
  ['iPhone 11', 'iPhone 11 Pro Max', 2019, S(64, 256, 512), 'faceid'],
  ['iPhone SE', 'iPhone SE (2.ª generación)', 2020, S(64, 128, 256), 'touchid'],
  ['iPhone 12', 'iPhone 12 mini', 2020, S(64, 128, 256), 'faceid'],
  ['iPhone 12', 'iPhone 12', 2020, S(64, 128, 256), 'faceid'],
  ['iPhone 12', 'iPhone 12 Pro', 2020, S(128, 256, 512), 'faceid'],
  ['iPhone 12', 'iPhone 12 Pro Max', 2020, S(128, 256, 512), 'faceid'],
  ['iPhone 13', 'iPhone 13 mini', 2021, S(128, 256, 512), 'faceid'],
  ['iPhone 13', 'iPhone 13', 2021, S(128, 256, 512), 'faceid'],
  ['iPhone 13', 'iPhone 13 Pro', 2021, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone 13', 'iPhone 13 Pro Max', 2021, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone SE', 'iPhone SE (3.ª generación)', 2022, S(64, 128, 256), 'touchid'],
  ['iPhone 14', 'iPhone 14', 2022, S(128, 256, 512), 'faceid'],
  ['iPhone 14', 'iPhone 14 Plus', 2022, S(128, 256, 512), 'faceid'],
  ['iPhone 14', 'iPhone 14 Pro', 2022, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone 14', 'iPhone 14 Pro Max', 2022, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone 15', 'iPhone 15', 2023, S(128, 256, 512), 'faceid'],
  ['iPhone 15', 'iPhone 15 Plus', 2023, S(128, 256, 512), 'faceid'],
  ['iPhone 15', 'iPhone 15 Pro', 2023, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone 15', 'iPhone 15 Pro Max', 2023, S(256, 512, '1 TB'), 'faceid'],
  ['iPhone 16', 'iPhone 16', 2024, S(128, 256, 512), 'faceid'],
  ['iPhone 16', 'iPhone 16 Plus', 2024, S(128, 256, 512), 'faceid'],
  ['iPhone 16', 'iPhone 16 Pro', 2024, S(128, 256, 512, '1 TB'), 'faceid'],
  ['iPhone 16', 'iPhone 16 Pro Max', 2024, S(256, 512, '1 TB'), 'faceid'],
  ['iPhone 16', 'iPhone 16e', 2025, S(128, 256, 512), 'faceid'],
  ['iPhone 17', 'iPhone 17', 2025, S(256, 512), 'faceid'],
  ['iPhone 17', 'iPhone Air', 2025, S(256, 512, '1 TB'), 'faceid'],
  ['iPhone 17', 'iPhone 17 Pro', 2025, S(256, 512, '1 TB'), 'faceid'],
  ['iPhone 17', 'iPhone 17 Pro Max', 2025, S(256, 512, '1 TB', '2 TB'), 'faceid'],
  ['iPhone 17', 'iPhone 17e', 2026, S(256, 512), 'faceid'],
  ['iPhone 18', 'iPhone 18 Pro', 2026, S(256, 512, '1 TB', '2 TB'), 'faceid'],
  ['iPhone 18', 'iPhone 18 Pro Max', 2026, S(256, 512, '1 TB', '2 TB'), 'faceid'],
  ['iPhone Duo', 'iPhone Duo (plegable)', 2026, S(256, 512, '1 TB', '2 TB'), 'unknown'],
];

const AIRPODS: [string, number][] = [
  ['AirPods (2.ª generación)', 2019],
  ['AirPods (3.ª generación)', 2021],
  ['AirPods 4', 2024],
  ['AirPods 4 con cancelación activa de ruido', 2024],
  ['AirPods Pro (1.ª generación)', 2019],
  ['AirPods Pro 2 (Lightning)', 2022],
  ['AirPods Pro 2 (USB-C)', 2023],
  ['AirPods Pro 3', 2025],
  ['AirPods Max (Lightning)', 2020],
  ['AirPods Max (USB-C)', 2024],
];

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function builtinCatalog(createdAt: string): CatalogModel[] {
  const phones: CatalogModel[] = IPHONES.map(([generation, model, year, storageOptions, biometric]) => ({
    id: `cat-${slug(model)}`,
    category: 'phone',
    brand: 'Apple',
    model,
    generation,
    year,
    storageOptions,
    biometric,
    builtin: true,
    archived: false,
    createdAt,
  }));
  const audio: CatalogModel[] = AIRPODS.map(([model, year]) => ({
    id: `cat-${slug(model)}`,
    category: 'audio',
    brand: 'Apple',
    model,
    generation: 'AirPods',
    year,
    storageOptions: [],
    biometric: 'none',
    builtin: true,
    archived: false,
    createdAt,
  }));
  return [...phones, ...audio];
}

/** Puntos de la lista de inspección profesional de teléfonos usados. */
export const INSPECTION_ITEMS: { key: string; label: string }[] = [
  { key: 'screen', label: 'Pantalla (imagen y táctil)' },
  { key: 'chassis', label: 'Chasis / marco' },
  { key: 'backGlass', label: 'Tapa trasera' },
  { key: 'rearCamera', label: 'Cámaras traseras' },
  { key: 'frontCamera', label: 'Cámara frontal' },
  { key: 'biometric', label: 'Face ID / Touch ID' },
  { key: 'buttons', label: 'Botones' },
  { key: 'speakers', label: 'Altavoces' },
  { key: 'earpiece', label: 'Auricular de llamadas' },
  { key: 'microphones', label: 'Micrófonos' },
  { key: 'port', label: 'Conector de carga' },
  { key: 'battery', label: 'Batería' },
  { key: 'signal', label: 'Señal / SIM / eSIM' },
  { key: 'wireless', label: 'Wi-Fi / Bluetooth' },
  { key: 'sensors', label: 'Sensores (proximidad, brillo)' },
  { key: 'vibration', label: 'Vibración' },
];

export const INSPECTION_STATUS_LABEL: Record<string, string> = {
  ok: 'Buen estado',
  damaged: 'Dañado',
  replaced: 'Reemplazado',
  pending: 'Pendiente de revisar',
  na: 'No aplica',
};

export const INSPECTION_SOURCE_LABEL: Record<string, string> = {
  seller: 'Informado por el vendedor',
  own: 'Revisado por mí',
  technician: 'Verificado por técnico',
};

/* ---------------- Historial de reparaciones y piezas (v2) ---------------- */

export const PART_KEYS: PartKey[] = [
  'battery',
  'screen',
  'back',
  'rear_camera',
  'front_camera',
  'biometric',
  'port',
  'speaker',
  'housing',
  'board',
  'other',
];

export const PART_LABEL: Record<PartKey, string> = {
  battery: 'Batería',
  screen: 'Pantalla',
  back: 'Tapa trasera',
  rear_camera: 'Cámara trasera',
  front_camera: 'Cámara frontal',
  biometric: 'Face ID / Touch ID',
  port: 'Puerto de carga',
  speaker: 'Altavoz / auricular',
  housing: 'Chasis / carcasa',
  board: 'Placa',
  other: 'Otra',
};

export const PART_QUALITY_LABEL: Record<PartQuality, string> = {
  original: 'Original',
  generic: 'Genérica',
  unknown: 'No sé',
};

export const PART_BY_LABEL: Record<PartChangedBy, string> = {
  previous_owner: 'Dueño anterior',
  supplier: 'Proveedor',
  me: 'Yo (en mi negocio)',
  unknown: 'No sé',
};

export interface PartsSummary {
  count: number;
  generic: number;
  warnings: number;
  /** Piezas cambiadas sin calidad conocida. */
  unknownQuality: number;
  labels: string[];
}

export function partLabel(p: Pick<PartChange, 'part' | 'label'>): string {
  return p.part === 'other' ? p.label || PART_LABEL.other : PART_LABEL[p.part] ?? p.part;
}

export function partsSummary(parts: PartChange[] | undefined): PartsSummary {
  const list = parts ?? [];
  return {
    count: list.length,
    generic: list.filter((p) => p.quality === 'generic').length,
    warnings: list.filter((p) => p.unknownPartWarning).length,
    unknownQuality: list.filter((p) => p.quality === 'unknown').length,
    labels: [...new Set(list.map(partLabel))],
  };
}

/** Normaliza el estado del equipo (Nuevo / Usado / Restaurado; acepta "reacondicionado"). */
export function normalizeCondition(c: string | null | undefined): string {
  const t = (c ?? '').trim();
  if (!t) return '';
  const low = t.toLowerCase();
  if (low === 'nuevo' || low === 'nueva') return 'Nuevo';
  if (low === 'usado' || low === 'usada') return 'Usado';
  if (low === 'restaurado' || low === 'restaurada' || low === 'reacondicionado' || low === 'reacondicionada') return 'Restaurado';
  return t.slice(0, 40);
}

/** Grupo de estado para umbrales y precios: "new" (Nuevo) o "used" (Usado, Restaurado y otros). Vacío = desconocido. */
export function conditionGroup(c: string | null | undefined): 'new' | 'used' | 'unknown' {
  const n = normalizeCondition(c);
  if (!n) return 'unknown';
  return n === 'Nuevo' ? 'new' : 'used';
}
