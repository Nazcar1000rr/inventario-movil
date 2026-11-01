import { strToU8, zipSync } from "fflate";

/**
 * ESCRITOR DE EXCEL (.xlsx) SIN SERVIDOR (v2.4)
 * Genera un libro de Excel real (hojas con formato, encabezado fijo, filtros y gráficas nativas) en el teléfono.
 * Es un escritor mínimo: texto, números, fechas, formatos de moneda/porcentaje, anchos de columna y gráficas
 * de barras o líneas que apuntan a los datos de la propia hoja (se pueden editar en Excel).
 */

export type XlsxFormat = "text" | "money" | "int" | "pct" | "date" | "datetime";
export interface XlsxCell {
  v: string | number | null;
  f?: XlsxFormat;
  bold?: boolean;
}
export type XlsxValue = string | number | null | XlsxCell;
export type XlsxRowKind = "normal" | "header" | "title" | "total";
export type XlsxRow = XlsxValue[] | { kind: XlsxRowKind; cells: XlsxValue[] };

export interface XlsxChart {
  kind: "bar" | "line";
  title: string;
  /** Columna (0 = A) con las categorías (etiquetas). */
  catCol: number;
  /** Columnas con las series. La fila de encabezado (headerRow) da el nombre de cada serie. */
  valCols: number[];
  /** Filas de la hoja (0 = fila 1): encabezado de la tabla y filas de datos (incluidas). */
  headerRow: number;
  firstRow: number;
  lastRow: number;
  /** Esquina superior izquierda (columna, fila; 0 = A1) y tamaño en columnas y filas. */
  at: { col: number; row: number; cols: number; rows: number };
  /** Formato del eje de valores. */
  format?: "money" | "int" | "pct";
}

export interface XlsxSheet {
  name: string;
  /** Anchos de columna en caracteres. */
  widths?: number[];
  rows: XlsxRow[];
  /** Congela las primeras N filas (por defecto 1 si la primera fila es de encabezado). */
  freezeRows?: number;
  /** Agrega filtros al encabezado de la tabla: fila de encabezado y última fila de datos. */
  filter?: { headerRow: number; lastRow: number };
  charts?: XlsxChart[];
}

/* ---------- utilidades ---------- */

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) =>
  s
    .replace(BAD_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A, B, … Z, AA… (columna 0 = A). */
export function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const ref = (col: number, row: number) => `${colName(col)}${row + 1}`;

/** Nombre de hoja válido para Excel: sin []:*?/\ , máximo 31 letras, sin repetidos. */
export function sheetName(raw: string, used: Set<string>): string {
  let base =
    raw
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "") || "Hoja";
  base = base.slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Fecha (ISO) → número de serie de Excel en hora local del teléfono. */
export function excelDate(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const utc = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return utc / 86_400_000 + 25569;
}

export const x = {
  text: (v: string | null | undefined, bold = false): XlsxCell => ({
    v: v ?? "",
    f: "text",
    bold,
  }),
  money: (v: number | null | undefined, bold = false): XlsxCell => ({
    v: v ?? null,
    f: "money",
    bold,
  }),
  int: (v: number | null | undefined, bold = false): XlsxCell => ({
    v: v ?? null,
    f: "int",
    bold,
  }),
  pct: (v: number | null | undefined, bold = false): XlsxCell => ({
    v: v ?? null,
    f: "pct",
    bold,
  }),
  date: (iso: string | null | undefined): XlsxCell => ({
    v: iso ? excelDate(iso) : null,
    f: "date",
  }),
  datetime: (iso: string | null | undefined): XlsxCell => ({
    v: iso ? excelDate(iso) : null,
    f: "datetime",
  }),
};

/* ---------- estilos ---------- */

interface StyleKey {
  f: XlsxFormat;
  bold: boolean;
  kind: XlsxRowKind;
}

const NUM_FMT: Record<XlsxFormat, number> = {
  text: 0,
  money: 164,
  int: 1,
  pct: 165,
  date: 166,
  datetime: 167,
};

class Styles {
  private index = new Map<string, number>();
  private list: StyleKey[] = [{ f: "text", bold: false, kind: "normal" }];
  constructor() {
    this.index.set("text|0|normal", 0);
  }
  get(key: StyleKey): number {
    const k = `${key.f}|${key.bold ? 1 : 0}|${key.kind}`;
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(key);
      this.index.set(k, i);
    }
    return i;
  }
  xml(): string {
    // Fuentes: 0 normal, 1 negrita, 2 título; rellenos: 0 ninguno, 1 gris (obligatorio), 2 encabezado, 3 total
    const fontOf = (s: StyleKey) =>
      s.kind === "title"
        ? 2
        : s.bold || s.kind === "header" || s.kind === "total"
          ? 1
          : 0;
    const fillOf = (s: StyleKey) =>
      s.kind === "header" ? 2 : s.kind === "total" ? 3 : 0;
    const borderOf = (s: StyleKey) =>
      s.kind === "header" ? 1 : s.kind === "total" ? 2 : 0;
    const xfs = this.list
      .map((s) => {
        const align =
          s.kind === "header"
            ? '<alignment horizontal="center" vertical="center" wrapText="1"/>'
            : "";
        return `<xf numFmtId="${NUM_FMT[s.f]}" fontId="${fontOf(s)}" fillId="${fillOf(s)}" borderId="${borderOf(s)}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
      })
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F5"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF7F8FA6"/></bottom><diagonal/></border>' +
      '<border><left/><right/><top style="thin"><color rgb="FF7F8FA6"/></top><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.list.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    );
  }
}

/* ---------- hojas ---------- */

function normalizeRow(r: XlsxRow): { kind: XlsxRowKind; cells: XlsxValue[] } {
  return Array.isArray(r) ? { kind: "normal", cells: r } : r;
}

function cellXml(
  v: XlsxValue,
  c: number,
  r: number,
  kind: XlsxRowKind,
  st: Styles,
): string {
  const cell: XlsxCell = v !== null && typeof v === "object" ? v : { v };
  const f: XlsxFormat = cell.f ?? (typeof cell.v === "number" ? "int" : "text");
  const s = st.get({
    f: typeof cell.v === "number" || cell.v === null ? f : "text",
    bold: !!cell.bold,
    kind,
  });
  const a = ref(c, r);
  if (cell.v === null || cell.v === "")
    return kind === "normal" && s === 0 ? "" : `<c r="${a}" s="${s}"/>`;
  if (typeof cell.v === "number")
    return Number.isFinite(cell.v)
      ? `<c r="${a}" s="${s}"><v>${cell.v}</v></c>`
      : `<c r="${a}" s="${s}"/>`;
  return `<c r="${a}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`;
}

function sheetXml(sh: XlsxSheet, st: Styles, hasDrawing: boolean): string {
  const rows = sh.rows.map(normalizeRow);
  let maxCol = 0;
  const body = rows
    .map((row, r) => {
      maxCol = Math.max(maxCol, row.cells.length);
      const cells = row.cells
        .map((v, c) => cellXml(v, c, r, row.kind, st))
        .join("");
      const ht =
        row.kind === "title"
          ? ' ht="22" customHeight="1"'
          : row.kind === "header"
            ? ' ht="30" customHeight="1"'
            : "";
      return `<row r="${r + 1}"${ht}>${cells}</row>`;
    })
    .join("");
  const freeze = sh.freezeRows ?? (rows[0]?.kind === "header" ? 1 : 0);
  const pane =
    freeze > 0
      ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freeze + 1}" sqref="A${freeze + 1}"/>`
      : "";
  const cols = sh.widths?.length
    ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const filter = sh.filter
    ? `<autoFilter ref="A${sh.filter.headerRow + 1}:${colName(Math.max(0, maxCol - 1))}${sh.filter.lastRow + 1}"/>`
    : "";
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${colName(Math.max(0, maxCol - 1))}${Math.max(1, rows.length)}"/>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="1">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${body}</sheetData>` +
    filter +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    (hasDrawing ? '<drawing r:id="rId1"/>' : "") +
    "</worksheet>"
  );
}

/* ---------- gráficas ---------- */

const COLORS = ["2F6FDE", "E8833A", "2BA36B", "8E5BD6", "D6465C", "3AA9C9"];

function cellValue(sh: XlsxSheet, r: number, c: number): XlsxCell {
  const row = sh.rows[r];
  if (!row) return { v: null };
  const v = normalizeRow(row).cells[c];
  return v !== null && typeof v === "object" ? v : { v: v ?? null };
}

function chartXml(sh: XlsxSheet, sheetNameText: string, ch: XlsxChart): string {
  const q = `'${sheetNameText.replace(/'/g, "''")}'`;
  const catRef = `${q}!$${colName(ch.catCol)}$${ch.firstRow + 1}:$${colName(ch.catCol)}$${ch.lastRow + 1}`;
  const cats: string[] = [];
  for (let r = ch.firstRow; r <= ch.lastRow; r++)
    cats.push(String(cellValue(sh, r, ch.catCol).v ?? ""));
  const catXml = `<c:cat><c:strRef><c:f>${esc(catRef)}</c:f><c:strCache><c:ptCount val="${cats.length}"/>${cats.map((t, i) => `<c:pt idx="${i}"><c:v>${esc(t)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`;
  const fmt =
    ch.format === "pct" ? "0.0%" : ch.format === "int" ? "0" : "#,##0";
  const series = ch.valCols
    .map((col, i) => {
      const name = String(
        cellValue(sh, ch.headerRow, col).v ?? `Serie ${i + 1}`,
      );
      const nameRef = `${q}!$${colName(col)}$${ch.headerRow + 1}`;
      const valRef = `${q}!$${colName(col)}$${ch.firstRow + 1}:$${colName(col)}$${ch.lastRow + 1}`;
      const pts: string[] = [];
      for (let r = ch.firstRow; r <= ch.lastRow; r++) {
        const v = cellValue(sh, r, col).v;
        if (typeof v === "number" && Number.isFinite(v))
          pts.push(`<c:pt idx="${r - ch.firstRow}"><c:v>${v}</c:v></c:pt>`);
      }
      const color = COLORS[i % COLORS.length];
      const sp =
        ch.kind === "bar"
          ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`
          : `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>`;
      return (
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
        `<c:tx><c:strRef><c:f>${esc(nameRef)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
        sp +
        catXml +
        `<c:val><c:numRef><c:f>${esc(valRef)}</c:f><c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${cats.length}"/>${pts.join("")}</c:numCache></c:numRef></c:val>` +
        (ch.kind === "line" ? '<c:smooth val="0"/>' : "") +
        "</c:ser>"
      );
    })
    .join("");
  const plot =
    ch.kind === "bar"
      ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/><c:axId val="111"/><c:axId val="222"/></c:barChart>`
      : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>`;
  const legend =
    ch.valCols.length > 1
      ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
      : "";
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:roundedCorners val="0"/>' +
    `<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="es-CO" sz="1300" b="1"/><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}` +
    '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9DEE7"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
    `</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
}

function drawingXml(charts: XlsxChart[]): string {
  const anchors = charts
    .map(
      (ch, i) =>
        `<xdr:twoCellAnchor><xdr:from><xdr:col>${ch.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${ch.at.col + ch.at.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row + ch.at.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfica ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    anchors +
    "</xdr:wsDr>"
  );
}

/* ---------- libro ---------- */

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: [string, string, string][]) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  items
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`,
    )
    .join("") +
  "</Relationships>";

/** Arma el archivo .xlsx (bytes) con las hojas dadas. */
export function buildXlsx(
  sheets: XlsxSheet[],
  title = "Inventario Móvil",
): Uint8Array {
  if (!sheets.length) throw new Error("El libro necesita al menos una hoja.");
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, used) }));
  const st = new Styles();
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, text: string) => {
    files[path] = strToU8(text);
  };

  let chartNo = 0;
  let drawingNo = 0;
  const overrides: string[] = [];
  const definedNames: string[] = [];

  named.forEach((sh, i) => {
    const n = i + 1;
    const charts = sh.charts ?? [];
    const hasDrawing = charts.length > 0;
    put(`xl/worksheets/sheet${n}.xml`, sheetXml(sh, st, hasDrawing));
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    if (sh.filter) {
      const last = colName(
        Math.max(
          0,
          Math.max(...sh.rows.map((r) => normalizeRow(r).cells.length)) - 1,
        ),
      );
      definedNames.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${sh.name.replace(/'/g, "''")}'!$A$${sh.filter.headerRow + 1}:$${last}$${sh.filter.lastRow + 1}</definedName>`,
      );
    }
    if (hasDrawing) {
      drawingNo++;
      put(
        `xl/worksheets/_rels/sheet${n}.xml.rels`,
        rels([
          ["rId1", `${REL}/drawing`, `../drawings/drawing${drawingNo}.xml`],
        ]),
      );
      put(`xl/drawings/drawing${drawingNo}.xml`, drawingXml(charts));
      overrides.push(
        `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
      const drels: [string, string, string][] = [];
      charts.forEach((ch, k) => {
        chartNo++;
        put(`xl/charts/chart${chartNo}.xml`, chartXml(sh, sh.name, ch));
        overrides.push(
          `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        );
        drels.push([
          `rId${k + 1}`,
          `${REL}/chart`,
          `../charts/chart${chartNo}.xml`,
        ]);
      });
      put(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, rels(drels));
    }
  });

  put("xl/styles.xml", st.xml());
  put(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
      `<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (definedNames.length
        ? `<definedNames>${definedNames.join("")}</definedNames>`
        : "") +
      "</workbook>",
  );
  put(
    "xl/_rels/workbook.xml.rels",
    rels([
      ...named.map((_, i): [string, string, string] => [
        `rId${i + 1}`,
        `${REL}/worksheet`,
        `worksheets/sheet${i + 1}.xml`,
      ]),
      [`rId${named.length + 1}`, `${REL}/styles`, "styles.xml"],
    ]),
  );
  put(
    "_rels/.rels",
    rels([
      ["rId1", `${REL}/officeDocument`, "xl/workbook.xml"],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml",
      ],
    ]),
  );
  put(
    "docProps/core.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(title)}</dc:title><dc:creator>Inventario Móvil</dc:creator></cp:coreProperties>`,
  );
  put(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      overrides.join("") +
      "</Types>",
  );
  return zipSync(files, { level: 6 });
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
