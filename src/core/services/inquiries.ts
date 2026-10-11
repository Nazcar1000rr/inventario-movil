import type { AppDB } from '../db';
import type { ExpectationPeriod, ID, Inquiry, ISODate, Product, Sale } from '../types';
import { assertDate, cleanStr, fail, newId, nowISO } from '../util';
import { requireInventory } from './base';
import { periodName, periodOf, periodStart, shiftPeriod, WEEKDAYS } from './analysis';
import { scopeFor } from './capital';
import { claimOp, tx } from './stock';

/**
 * PREGUNTONES (v2.3)
 * Un toque = una persona que preguntó y no compró (se guarda la fecha y la hora).
 * Si esa persona vuelve y compra, tocas "Me compró": deja de contar como preguntón (su compra ya cuenta como venta).
 * Con eso la app calcula cuántas personas preguntan por cada venta, por semana y por mes.
 */

const DAY = 86_400_000;

export interface InquiryInput {
  opId?: string;
  inventoryId?: ID | null;
  date?: ISODate;
  productId?: ID | null;
  notes?: string;
}

export async function addInquiry(db: AppDB, input: InquiryInput = {}): Promise<Inquiry | null> {
  const date = input.date ? assertDate(input.date, 'date', 'Fecha') : nowISO();
  return tx(db, async () => {
    if (!(await claimOp(db, input.opId))) return null;
    const inventoryId = input.inventoryId ?? null;
    if (inventoryId) await requireInventory(db, inventoryId);
    if (input.productId && !(await db.products.get(input.productId))) fail('not_found', 'El producto no existe.', 'productId');
    const q: Inquiry = {
      id: newId(),
      inventoryId,
      date,
      productId: input.productId ?? null,
      status: 'open',
      boughtAt: null,
      notes: cleanStr(input.notes ?? '', 200),
      createdAt: nowISO(),
    };
    await db.inquiries.add(q);
    return q;
  });
}

/**
 * "Me compró": la persona que preguntó volvió y compró. Sin `id`, se resta el preguntón más reciente
 * (del mismo inventario si se indica).
 */
export async function markInquiryBought(db: AppDB, opts: { opId?: string; id?: ID; inventoryId?: ID | null; date?: ISODate } = {}): Promise<Inquiry | null> {
  const date = opts.date ? assertDate(opts.date, 'date', 'Fecha') : nowISO();
  return tx(db, async () => {
    if (!(await claimOp(db, opts.opId))) return null;
    let q: Inquiry | undefined;
    if (opts.id) {
      q = await db.inquiries.get(opts.id);
      if (!q) fail('not_found', 'Ese preguntón ya no existe.');
      if (q.status === 'bought') fail('already_bought', 'Ese preguntón ya está marcado como que compró.');
    } else {
      const open = (await db.inquiries.where('status').equals('open').toArray()).filter((x) => opts.inventoryId === undefined || x.inventoryId === (opts.inventoryId ?? null));
      q = open.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
      if (!q) fail('none_open', 'No hay preguntones para restar.');
    }
    if (Date.parse(date) < Date.parse(q.date)) fail('incoherent_date', 'La compra no puede ser antes de la pregunta.', 'date');
    await db.inquiries.update(q.id, { status: 'bought', boughtAt: date });
    return { ...q, status: 'bought', boughtAt: date };
  });
}

/** Deshace "Me compró" (vuelve a contar como preguntón). */
export async function reopenInquiry(db: AppDB, id: ID): Promise<void> {
  await tx(db, async () => {
    const q = await db.inquiries.get(id);
    if (!q) fail('not_found', 'Ese preguntón ya no existe.');
    await db.inquiries.update(id, { status: 'open', boughtAt: null });
  });
}

/** Borra un toque hecho por error. */
export async function deleteInquiry(db: AppDB, id: ID): Promise<void> {
  await db.inquiries.delete(id);
}

export async function updateInquiry(db: AppDB, id: ID, patch: { productId?: ID | null; notes?: string; inventoryId?: ID | null }): Promise<void> {
  await tx(db, async () => {
    const q = await db.inquiries.get(id);
    if (!q) fail('not_found', 'Ese preguntón ya no existe.');
    const upd: Partial<Inquiry> = {};
    if (patch.productId !== undefined) {
      if (patch.productId && !(await db.products.get(patch.productId))) fail('not_found', 'El producto no existe.', 'productId');
      upd.productId = patch.productId;
    }
    if (patch.notes !== undefined) upd.notes = cleanStr(patch.notes, 200);
    if (patch.inventoryId !== undefined) {
      if (patch.inventoryId) await requireInventory(db, patch.inventoryId, { allowArchived: true });
      upd.inventoryId = patch.inventoryId;
    }
    await db.inquiries.update(id, upd);
  });
}

/* ======================= Análisis ======================= */

export interface InquiryPeriodRow {
  label: string;
  short: string;
  from: ISODate;
  to: ISODate;
  partial: boolean;
  /** Preguntaron y no compraron. */
  askers: number;
  /** Preguntaron y volvieron a comprar (ya cuentan en ventas). */
  returned: number;
  /** Ventas registradas. */
  sales: number;
  /** Personas interesadas = preguntones + ventas (cada venta es alguien que preguntó y compró). */
  interested: number;
  /** De cada 100 interesados, cuántos compraron. */
  conversion: number | null;
  /** Cuántas personas preguntan por cada venta. */
  perSale: number | null;
}

export interface InquiryOverview {
  today: number;
  week: number;
  month: number;
  /** Preguntones sin comprar (todo el tiempo) y los que volvieron y compraron. */
  openTotal: number;
  returnedTotal: number;
  last30: InquiryPeriodRow;
  weeks: InquiryPeriodRow[];
  months: InquiryPeriodRow[];
  weekdays: { day: number; label: string; count: number; share: number }[];
  hours: { key: string; label: string; count: number; share: number }[];
  topProducts: { productId: ID; name: string; asked: number; returned: number }[];
  /** Días promedio entre la pregunta y la compra de los que volvieron. */
  avgDaysToReturn: number | null;
  recent: (Inquiry & { productName: string })[];
  hasData: boolean;
}

function row(inquiries: Inquiry[], sales: Sale[], from: ISODate, to: ISODate, label: string, short: string, partial: boolean): InquiryPeriodRow {
  const qs = inquiries.filter((q) => q.date >= from && q.date < to);
  const askers = qs.filter((q) => q.status === 'open').length;
  const returned = qs.filter((q) => q.status === 'bought').length;
  const n = sales.filter((s) => s.date >= from && s.date < to).length;
  const interested = askers + n;
  return {
    label,
    short,
    from,
    to,
    partial,
    askers,
    returned,
    sales: n,
    interested,
    conversion: interested > 0 ? n / interested : null,
    perSale: n > 0 ? interested / n : null,
  };
}

export function inquiryOverview(all: Inquiry[], allSales: Sale[], products: Product[], inventoryIds: ID[] | null, now: Date): InquiryOverview {
  const inScope = scopeFor(inventoryIds);
  const inquiries = all.filter((q) => inScope(q.inventoryId));
  const sales = allSales.filter((s) => s.status === 'active' && inScope(s.inventoryId));
  const open = inquiries.filter((q) => q.status === 'open');
  const nowIso = now.toISOString();
  const count = (from: Date) => open.filter((q) => q.date >= from.toISOString() && q.date <= nowIso).length;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const series = (kind: ExpectationPeriod, n: number) => {
    const cur = periodStart(kind, now);
    const out: InquiryPeriodRow[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const s = shiftPeriod(kind, cur, -i);
      const p = periodOf(kind, s);
      const nm = periodName(kind, s);
      out.push(row(inquiries, sales, p.from, p.to, nm.label, nm.short, i === 0));
    }
    return out;
  };
  const wd = WEEKDAYS.map((label, day) => ({ day, label, count: 0, share: 0 }));
  const HOURS: [string, string, number, number][] = [
    ['madrugada', 'Madrugada (0 a 6)', 0, 6],
    ['manana', 'Mañana (6 a 12)', 6, 12],
    ['tarde', 'Tarde (12 a 18)', 12, 18],
    ['noche', 'Noche (18 a 24)', 18, 24],
  ];
  const hr = HOURS.map(([key, label]) => ({ key, label, count: 0, share: 0 }));
  const from90 = new Date(now.getTime() - 90 * DAY).toISOString();
  const recentQs = inquiries.filter((q) => q.date >= from90 && q.date <= nowIso);
  for (const q of recentQs) {
    const d = new Date(q.date);
    wd[(d.getDay() + 6) % 7].count++;
    hr[HOURS.findIndex(([, , a, b]) => d.getHours() >= a && d.getHours() < b)].count++;
  }
  for (const w of wd) w.share = recentQs.length ? w.count / recentQs.length : 0;
  for (const h of hr) h.share = recentQs.length ? h.count / recentQs.length : 0;
  const names = new Map(products.map((p) => [p.id, p.name]));
  const byProduct = new Map<ID, { asked: number; returned: number }>();
  for (const q of inquiries) {
    if (!q.productId) continue;
    const x = byProduct.get(q.productId) ?? { asked: 0, returned: 0 };
    x.asked++;
    if (q.status === 'bought') x.returned++;
    byProduct.set(q.productId, x);
  }
  const topProducts = [...byProduct.entries()]
    .map(([productId, x]) => ({ productId, name: names.get(productId) ?? 'Producto', ...x }))
    .sort((a, b) => b.asked - a.asked)
    .slice(0, 8);
  const back = inquiries.filter((q) => q.status === 'bought' && q.boughtAt);
  const avgDaysToReturn = back.length ? Math.round((back.reduce((a, q) => a + (Date.parse(q.boughtAt!) - Date.parse(q.date)), 0) / back.length / DAY) * 10) / 10 : null;
  return {
    today: count(today),
    week: count(periodStart('week', now)),
    month: count(periodStart('month', now)),
    openTotal: open.length,
    returnedTotal: back.length,
    last30: row(inquiries, sales, new Date(now.getTime() - 30 * DAY).toISOString(), new Date(now.getTime() + 60_000).toISOString(), 'Últimos 30 días', '30 días', true),
    weeks: series('week', 8),
    months: series('month', 6),
    weekdays: wd,
    hours: hr,
    topProducts,
    avgDaysToReturn,
    recent: [...inquiries]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 30)
      .map((q) => ({ ...q, productName: q.productId ? names.get(q.productId) ?? '' : '' })),
    hasData: inquiries.length > 0,
  };
}

export async function getInquiryOverview(db: AppDB, inventoryIds: ID[] | null, now = new Date()): Promise<InquiryOverview> {
  const [inquiries, sales, products] = await Promise.all([db.inquiries.toArray(), db.sales.toArray(), db.products.toArray()]);
  return inquiryOverview(inquiries, sales, products, inventoryIds, now);
}
