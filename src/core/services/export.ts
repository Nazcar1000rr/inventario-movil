import type { AppDB } from "../db";
import type { ID, Lot, Product, Unit } from "../types";
import { daysBetween } from "../util";
import {
  buildXlsx,
  x,
  type XlsxChart,
  type XlsxRow,
  type XlsxSheet,
} from "../xlsx";
import {
  currentPeriod,
  loadAnalysisData,
  periodTable,
  productMovement,
  type PeriodMetrics,
  type TableGranularity,
} from "./analysis";

/**
 * EXPORTAR A EXCEL (v2.4)
 * Un solo archivo con: Inventario, Existencias, Compras, Ventas, Gastos, Análisis (día, semana y mes) y Gráficas.
 * Los números salen de los mismos datos y del mismo cálculo del resto de la app; no se recalcula nada aparte.
 */

const header = (cells: string[]): XlsxRow => ({ kind: "header", cells });
const title = (t: string): XlsxRow => ({ kind: "title", cells: [t] });

const KIND_LABEL: Record<Product["kind"], string> = {
  phone: "Celular",
  audio: "Audio",
  accessory: "Accesorio",
  other: "Producto",
};
const UNIT_STATUS: Record<Unit["status"], string> = {
  available: "Disponible",
  sold: "Vendida",
  in_review: "En revisión",
  damaged: "Dañada",
  archived: "Archivada",
};

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function excelFileName(now = new Date()): string {
  return `inventario-movil-${fileStamp(now)}.xlsx`;
}

export interface ExcelBook {
  sheets: XlsxSheet[];
  /** Cuántas filas de datos tiene cada hoja (para mostrar al terminar y para pruebas). */
  counts: Record<string, number>;
}

/** Arma todas las hojas del libro (sin escribir el archivo). */
export async function buildExcelBook(
  db: AppDB,
  now = new Date(),
): Promise<ExcelBook> {
  const [
    inventories,
    products,
    units,
    lots,
    suppliers,
    customers,
    purchases,
    purchaseLines,
    sales,
    saleLines,
    expenses,
  ] = await Promise.all([
    db.inventories.toArray(),
    db.products.toArray(),
    db.units.toArray(),
    db.lots.toArray(),
    db.suppliers.toArray(),
    db.customers.toArray(),
    db.purchases.toArray(),
    db.purchaseLines.toArray(),
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.expenses.toArray(),
  ]);
  const inv = new Map(inventories.map((i) => [i.id, i.name]));
  const prod = new Map(products.map((p) => [p.id, p]));
  const sup = new Map(suppliers.map((s) => [s.id, s.name]));
  const cus = new Map(customers.map((c) => [c.id, c.name]));
  const pName = (id: ID | null) =>
    id ? (prod.get(id)?.name ?? "Producto eliminado") : "";
  const counts: Record<string, number> = {};
  const sheets: XlsxSheet[] = [];

  /* ---- Inventario: un producto por fila ---- */
  {
    const availByProduct = new Map<ID, { qty: number; value: number }>();
    for (const u of units) {
      if (u.status !== "available") continue;
      const g = availByProduct.get(u.productId) ?? { qty: 0, value: 0 };
      g.qty += 1;
      g.value += (u.baseCost ?? 0) + u.extraCost;
      availByProduct.set(u.productId, g);
    }
    let sumQty = 0;
    let sumVal = 0;
    const body = [...products]
      .sort(
        (a, b) =>
          (inv.get(a.inventoryId) ?? "").localeCompare(
            inv.get(b.inventoryId) ?? "",
          ) || a.name.localeCompare(b.name),
      )
      .map((p): XlsxRow => {
        const stock =
          p.tracking === "unit"
            ? (availByProduct.get(p.id) ?? { qty: 0, value: 0 })
            : { qty: p.qty, value: p.stockValue };
        sumQty += stock.qty;
        sumVal += stock.value;
        return [
          x.text(inv.get(p.inventoryId)),
          x.text(p.name),
          x.text(KIND_LABEL[p.kind]),
          x.text(p.brand),
          x.text(p.model),
          x.text(p.capacity),
          x.text(p.color),
          x.text(p.tracking === "unit" ? "Por unidad" : "Por cantidad"),
          x.int(stock.qty),
          x.money(stock.qty > 0 ? Math.round(stock.value / stock.qty) : null),
          x.money(stock.value),
          x.money(p.salePrice),
          x.int(p.lowStockThreshold),
          x.text(p.location),
          x.text(p.archived ? "Archivado" : "Activo"),
        ];
      });
    sheets.push({
      name: "Inventario",
      widths: [18, 30, 11, 14, 18, 12, 12, 13, 12, 14, 16, 16, 12, 16, 11],
      rows: [
        header([
          "Inventario",
          "Producto",
          "Tipo",
          "Marca",
          "Modelo",
          "Capacidad",
          "Color",
          "Seguimiento",
          "Existencias",
          "Costo promedio",
          "Valor a costo",
          "Precio de venta",
          "Stock mínimo",
          "Ubicación",
          "Estado",
        ]),
        ...body,
        {
          kind: "total",
          cells: [
            x.text("Total", true),
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            x.int(sumQty, true),
            "",
            x.money(sumVal, true),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: body.length },
    });
    counts.Inventario = body.length;
  }

  /* ---- Existencias: unidades disponibles y lotes con saldo ---- */
  {
    let qty = 0;
    let val = 0;
    const unitRows = units
      .filter((u) => u.status === "available" || u.status === "in_review")
      .map((u): { k: string; row: XlsxRow } => {
        qty += 1;
        val += u.baseCost === null ? 0 : u.baseCost + u.extraCost;
        return {
          k: `${inv.get(u.inventoryId) ?? ""}|${pName(u.productId)}|${u.code}`,
          row: [
            x.text("Unidad"),
            x.text(inv.get(u.inventoryId)),
            x.text(pName(u.productId)),
            x.text(u.code),
            x.text(u.imei),
            x.text(u.serial),
            x.text(u.color || prod.get(u.productId)?.color),
            x.text(u.capacity || prod.get(u.productId)?.capacity),
            x.text(u.condition),
            x.text(UNIT_STATUS[u.status]),
            x.date(u.acquiredAt),
            x.int(u.acquiredAt ? daysBetween(u.acquiredAt, now) : null),
            x.int(1),
            x.money(u.baseCost === null ? null : u.baseCost + u.extraCost),
            x.text(u.supplierId ? sup.get(u.supplierId) : ""),
          ],
        };
      });
    const lotRows = lots
      .filter((l: Lot) => l.qty > 0)
      .map((l): { k: string; row: XlsxRow } => {
        qty += l.qty;
        val += l.costKnown ? l.value : 0;
        return {
          k: `${inv.get(l.inventoryId) ?? ""}|${pName(l.productId)}|${l.date ?? ""}`,
          row: [
            x.text("Lote"),
            x.text(inv.get(l.inventoryId)),
            x.text(pName(l.productId)),
            x.text(""),
            x.text(""),
            x.text(""),
            x.text(prod.get(l.productId)?.color),
            x.text(prod.get(l.productId)?.capacity),
            x.text(""),
            x.text("Disponible"),
            x.date(l.date),
            x.int(l.date ? daysBetween(l.date, now) : null),
            x.int(l.qty),
            x.money(l.costKnown ? l.value : null),
            x.text(l.supplierId ? sup.get(l.supplierId) : ""),
          ],
        };
      });
    const all = [...unitRows, ...lotRows]
      .sort((a, b) => a.k.localeCompare(b.k))
      .map((r) => r.row);
    sheets.push({
      name: "Existencias",
      widths: [9, 18, 30, 16, 18, 16, 12, 12, 14, 13, 12, 14, 10, 16, 18],
      rows: [
        header([
          "Tipo",
          "Inventario",
          "Producto",
          "Código",
          "IMEI",
          "Serie",
          "Color",
          "Capacidad",
          "Condición",
          "Estado",
          "Ingreso",
          "Días en inventario",
          "Cantidad",
          "Costo total",
          "Proveedor",
        ]),
        ...all,
        {
          kind: "total",
          cells: [
            x.text("Total", true),
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            x.int(qty, true),
            x.money(val, true),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: all.length },
    });
    counts.Existencias = all.length;
  }

  /* ---- Compras: una línea por fila ---- */
  {
    const pur = new Map(purchases.map((p) => [p.id, p]));
    const body = purchaseLines
      .filter((l) => pur.has(l.purchaseId))
      .map((l) => ({ l, p: pur.get(l.purchaseId)! }))
      .sort((a, b) => b.p.date.localeCompare(a.p.date))
      .map(({ l, p }): XlsxRow => [
        x.date(p.date),
        x.text(inv.get(p.inventoryId)),
        x.text(p.supplierId ? sup.get(p.supplierId) : ""),
        x.text(pName(l.productId)),
        x.int(l.quantity),
        x.money(l.price),
        x.money(l.allocatedExtra),
        x.money(l.totalCost),
        x.text(p.paymentMethod),
        x.text(p.status === "voided" ? "Anulada" : "Activa"),
        x.text(p.notes),
      ]);
    const active = purchaseLines.filter(
      (l) => pur.get(l.purchaseId)?.status === "active",
    );
    sheets.push({
      name: "Compras",
      widths: [12, 18, 18, 30, 10, 15, 15, 15, 16, 10, 28],
      rows: [
        header([
          "Fecha",
          "Inventario",
          "Proveedor",
          "Producto",
          "Cantidad",
          "Valor pagado",
          "Costos extra",
          "Costo total",
          "Medio de pago",
          "Estado",
          "Notas",
        ]),
        ...body,
        {
          kind: "total",
          cells: [
            x.text("Total (sin anuladas)", true),
            "",
            "",
            "",
            x.int(
              active.reduce((a, l) => a + l.quantity, 0),
              true,
            ),
            x.money(
              active.reduce((a, l) => a + l.price, 0),
              true,
            ),
            x.money(
              active.reduce((a, l) => a + l.allocatedExtra, 0),
              true,
            ),
            x.money(
              active.reduce((a, l) => a + l.totalCost, 0),
              true,
            ),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: body.length },
    });
    counts.Compras = body.length;
  }

  /* ---- Ventas: una línea por fila ---- */
  {
    const sal = new Map(sales.map((s) => [s.id, s]));
    const net = (l: (typeof saleLines)[number]) =>
      l.netAmount - l.returnedAmount;
    const gain = (l: (typeof saleLines)[number]) =>
      net(l) - (l.cogs - l.returnedCogs);
    const body = saleLines
      .filter((l) => sal.has(l.saleId))
      .map((l) => ({ l, s: sal.get(l.saleId)! }))
      .sort((a, b) => b.s.date.localeCompare(a.s.date))
      .map(({ l, s }): XlsxRow => {
        const live = s.status === "active";
        return [
          x.date(s.date),
          x.text(inv.get(s.inventoryId)),
          x.text(s.customerId ? cus.get(s.customerId) : ""),
          x.text(pName(l.productId)),
          x.int(l.quantity),
          x.money(l.unitPrice),
          x.money(l.discountShare),
          x.int(l.returnedQty),
          x.money(live ? net(l) : null),
          x.money(live ? l.cogs - l.returnedCogs : null),
          x.money(live ? gain(l) : null),
          x.text(s.paymentMethod),
          x.text(live ? "Activa" : "Anulada"),
          x.text(s.notes),
        ];
      });
    const live = saleLines.filter(
      (l) => sal.get(l.saleId)?.status === "active",
    );
    sheets.push({
      name: "Ventas",
      widths: [12, 18, 18, 30, 10, 14, 13, 11, 15, 14, 14, 16, 10, 28],
      rows: [
        header([
          "Fecha",
          "Inventario",
          "Cliente",
          "Producto",
          "Cantidad",
          "Precio unitario",
          "Descuento",
          "Devueltas",
          "Venta neta",
          "Costo",
          "Ganancia",
          "Medio de pago",
          "Estado",
          "Notas",
        ]),
        ...body,
        {
          kind: "total",
          cells: [
            x.text("Total (sin anuladas)", true),
            "",
            "",
            "",
            x.int(
              live.reduce((a, l) => a + l.quantity, 0),
              true,
            ),
            "",
            x.money(
              live.reduce((a, l) => a + l.discountShare, 0),
              true,
            ),
            x.int(
              live.reduce((a, l) => a + l.returnedQty, 0),
              true,
            ),
            x.money(
              live.reduce((a, l) => a + net(l), 0),
              true,
            ),
            x.money(
              live.reduce((a, l) => a + l.cogs - l.returnedCogs, 0),
              true,
            ),
            x.money(
              live.reduce((a, l) => a + gain(l), 0),
              true,
            ),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: body.length },
    });
    counts.Ventas = body.length;
  }

  /* ---- Gastos ---- */
  {
    const body = [...expenses]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e): XlsxRow => [
        x.date(e.date),
        x.text(e.category),
        x.money(e.amount),
        x.text(
          e.treatment === "capitalized" ? "Suma al costo" : "Gasto del negocio",
        ),
        x.text(e.inventoryId ? inv.get(e.inventoryId) : "General"),
        x.text(e.status === "voided" ? "Anulado" : "Activo"),
        x.text(e.notes),
      ]);
    sheets.push({
      name: "Gastos",
      widths: [12, 20, 15, 18, 18, 10, 34],
      rows: [
        header([
          "Fecha",
          "Categoría",
          "Valor",
          "Tratamiento",
          "Inventario",
          "Estado",
          "Notas",
        ]),
        ...body,
        {
          kind: "total",
          cells: [
            x.text("Total (sin anulados)", true),
            "",
            x.money(
              expenses
                .filter((e) => e.status === "active")
                .reduce((a, e) => a + e.amount, 0),
              true,
            ),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: body.length },
    });
    counts.Gastos = body.length;
  }

  /* ---- Análisis por día, semana y mes (todos los inventarios) ---- */
  const data = await loadAnalysisData(db);
  const gran: {
    kind: TableGranularity;
    n: number;
    name: string;
    unit: string;
  }[] = [
    { kind: "day", n: 30, name: "Análisis por día", unit: "Día" },
    { kind: "week", n: 12, name: "Análisis por semana", unit: "Semana" },
    { kind: "month", n: 12, name: "Análisis por mes", unit: "Mes" },
  ];
  const tables = new Map<TableGranularity, PeriodMetrics[]>();
  for (const g of gran) {
    const t = periodTable(data, g.kind, g.n, null, now);
    tables.set(g.kind, t.rows);
    const rows = [...t.rows].reverse();
    sheets.push({
      name: g.name,
      widths: [24, 9, 11, 15, 15, 15, 15, 15, 15],
      rows: [
        header([
          g.unit,
          "Ventas",
          "Unidades",
          "Ingresos",
          "Ganancia",
          "Gastos",
          "Ganancia neta",
          "Compras",
          "Cobrado",
        ]),
        ...rows.map((r): XlsxRow => [
          x.text(r.label + (r.partial ? " (en curso)" : "")),
          x.int(r.sales),
          x.int(r.units),
          x.money(r.revenue),
          x.money(r.grossProfit),
          x.money(r.expenses),
          x.money(r.netProfit),
          x.money(r.purchases),
          x.money(r.collected),
        ]),
        {
          kind: "total",
          cells: [
            x.text("Total", true),
            x.int(t.total.sales, true),
            x.int(t.total.units, true),
            x.money(t.total.revenue, true),
            x.money(t.total.grossProfit, true),
            x.money(t.total.expenses, true),
            x.money(t.total.netProfit, true),
            x.money(t.total.purchases, true),
            x.money(t.total.collected, true),
          ],
        },
      ],
      filter: { headerRow: 0, lastRow: rows.length },
    });
    counts[g.name] = rows.length;
  }

  /* ---- Productos que más se mueven ---- */
  const movers: { label: string; rows: ReturnType<typeof productMovement> }[] =
    (["day", "week", "month"] as const).map((k) => {
      const cur = currentPeriod(k, now);
      return {
        label: cur.label,
        rows: productMovement(data, cur.period, null).slice(0, 15),
      };
    });
  {
    const rows: XlsxRow[] = [];
    movers.forEach((m, i) => {
      if (i) rows.push([]);
      rows.push(title(`Productos que más se mueven · ${m.label}`));
      rows.push(
        header([
          "Producto",
          "Unidades",
          "Ventas",
          "Ganancia",
          "% de unidades",
          "Cantidad de ventas",
        ]),
      );
      if (!m.rows.length) rows.push([x.text("Sin ventas")]);
      for (const r of m.rows)
        rows.push([
          x.text(pName(r.productId)),
          x.int(r.units),
          x.money(r.revenue),
          x.money(r.profit),
          x.pct(r.share),
          x.int(r.sales),
        ]);
    });
    sheets.push({
      name: "Productos que más se mueven",
      widths: [34, 11, 15, 15, 14, 18],
      rows,
      freezeRows: 0,
    });
    counts["Productos que más se mueven"] = movers.reduce(
      (a, m) => a + m.rows.length,
      0,
    );
  }

  /* ---- Gráficas: tablas pequeñas con sus gráficas al lado ---- */
  {
    const rows: XlsxRow[] = [];
    const charts: XlsxChart[] = [];
    const block = (
      name: string,
      kind: "bar" | "line",
      head: string[],
      data: { cat: string; vals: number[] }[],
      valCols: number[],
    ) => {
      const start = rows.length;
      rows.push(title(name));
      rows.push(header(head));
      for (const d of data)
        rows.push([x.text(d.cat), ...d.vals.map((v) => x.money(v))]);
      const headerRow = start + 1;
      const firstRow = start + 2;
      const lastRow = start + 1 + data.length;
      if (data.length)
        charts.push({
          kind,
          title: name,
          catCol: 0,
          valCols,
          headerRow,
          firstRow,
          lastRow,
          at: {
            col: 4,
            row: start,
            cols: 9,
            rows: Math.max(16, data.length + 3),
          },
          format: "money",
        });
      rows.push([]);
      while (rows.length < start + Math.max(18, data.length + 5)) rows.push([]);
    };
    const days = (tables.get("day") ?? []).slice(-14);
    block(
      "Ventas y ganancia de los últimos 14 días",
      "bar",
      ["Día", "Ingresos", "Ganancia neta"],
      days.map((r) => ({
        cat: r.short || r.label,
        vals: [r.revenue, r.netProfit],
      })),
      [1, 2],
    );
    const months = tables.get("month") ?? [];
    block(
      "Ingresos y ganancia por mes",
      "line",
      ["Mes", "Ingresos", "Ganancia neta"],
      months.map((r) => ({
        cat: r.short || r.label,
        vals: [r.revenue, r.netProfit],
      })),
      [1, 2],
    );
    const topMonth = movers[2].rows.slice(0, 8);
    const start = rows.length;
    rows.push(title("Productos más vendidos este mes (unidades)"));
    rows.push(header(["Producto", "Unidades"]));
    for (const r of topMonth)
      rows.push([x.text(pName(r.productId)), x.int(r.units)]);
    if (topMonth.length)
      charts.push({
        kind: "bar",
        title: "Productos más vendidos este mes (unidades)",
        catCol: 0,
        valCols: [1],
        headerRow: start + 1,
        firstRow: start + 2,
        lastRow: start + 1 + topMonth.length,
        at: {
          col: 4,
          row: start,
          cols: 9,
          rows: Math.max(16, topMonth.length + 3),
        },
        format: "int",
      });
    sheets.push({
      name: "Gráficas",
      widths: [30, 15, 15, 3],
      rows,
      freezeRows: 0,
      charts,
    });
    counts["Gráficas"] = charts.length;
  }

  return { sheets, counts };
}

/** Genera el archivo .xlsx con toda la información. */
export async function exportExcel(
  db: AppDB,
  now = new Date(),
): Promise<{
  bytes: Uint8Array;
  name: string;
  counts: Record<string, number>;
}> {
  const book = await buildExcelBook(db, now);
  return {
    bytes: buildXlsx(book.sheets),
    name: excelFileName(now),
    counts: book.counts,
  };
}
