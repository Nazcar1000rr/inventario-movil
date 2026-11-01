import { describe, expect, it } from "vitest";
import {
  createPurchase,
  createSale,
  currentPeriod,
  loadAnalysisData,
  periodMetrics,
  periodsFor,
  periodTable,
  productMovement,
} from "../../src/core";
import {
  accessoryProduct,
  D,
  makeDB,
  op,
  phoneProduct,
  setupInventory,
} from "./helpers";

// Bogotá no tiene horario de verano; las pruebas corren con TZ America/Bogota
const NOW = new Date("2026-10-14T20:00:00-05:00");

async function scenario() {
  const db = await makeDB();
  const inv = await setupInventory(db);
  const charger = await accessoryProduct(db, inv.id, "Cargador");
  const phone = await phoneProduct(db, inv.id, "iPhone 13", "128 GB");
  await createPurchase(db, {
    opId: op(),
    inventoryId: inv.id,
    date: D("2026-10-01T10:00:00-05:00"),
    lines: [
      { productId: charger.id, quantity: 10, price: 20_000 },
      { productId: phone.id, quantity: 2, price: 1_500_000 },
    ],
  });
  const sell = (
    iso: string,
    productId: string,
    quantity: number,
    unitPrice: number,
  ) =>
    createSale(db, {
      opId: op(),
      inventoryId: inv.id,
      date: D(iso),
      lines: [{ productId, quantity, unitPrice }],
      initialPayment: quantity * unitPrice,
    });
  await sell("2026-10-12T09:00:00-05:00", charger.id, 3, 35_000); // lunes
  await sell("2026-10-13T15:30:00-05:00", charger.id, 2, 35_000); // martes
  await sell("2026-10-13T18:00:00-05:00", phone.id, 1, 2_000_000); // martes
  await sell("2026-10-14T11:00:00-05:00", charger.id, 1, 36_000); // hoy
  return { db, charger, phone };
}

describe("v2.4 · tablas por día, semana y mes", () => {
  it("los periodos van en orden, terminan en el actual y cubren días, semanas y meses locales", () => {
    const d = periodsFor("day", 7, NOW);
    expect(d).toHaveLength(7);
    expect(d[6].partial).toBe(true);
    expect(d[0].partial).toBe(false);
    expect(d[6].period.from).toBe(new Date(2026, 9, 14).toISOString());
    expect(d[6].label).toContain("Miércoles 14");
    for (let i = 1; i < d.length; i++)
      expect(d[i].period.from).toBe(d[i - 1].period.to);
    const w = periodsFor("week", 4, NOW);
    expect(w[3].period.from).toBe(new Date(2026, 9, 12).toISOString()); // lunes 12
    const m = periodsFor("month", 3, NOW);
    expect(m.map((x) => x.period.from)).toEqual(
      [new Date(2026, 7, 1), new Date(2026, 8, 1), new Date(2026, 9, 1)].map(
        (x) => x.toISOString(),
      ),
    );
  });

  it("el total de los días de una semana es el de esa semana, y la semana encaja con el mes", async () => {
    const { db } = await scenario();
    const data = await loadAnalysisData(db);
    const days = periodTable(data, "day", 3, null, NOW); // 12, 13 y 14 de octubre
    expect(days.rows.map((r) => r.revenue)).toEqual([
      105_000, 2_070_000, 36_000,
    ]);
    expect(days.rows.map((r) => r.sales)).toEqual([1, 2, 1]);
    expect(days.total.revenue).toBe(2_211_000);
    expect(days.best?.revenue).toBe(2_070_000);
    const week = periodTable(data, "week", 1, null, NOW).rows[0];
    expect(week.revenue).toBe(days.total.revenue);
    expect(week.grossProfit).toBe(days.total.grossProfit);
    expect(week.units).toBe(days.total.units);
    const month = periodTable(data, "month", 1, null, NOW).rows[0];
    expect(month.revenue).toBe(week.revenue); // todas las ventas están en esa semana
    expect(month.purchases).toBe(1_520_000); // el precio de cada línea de compra es el total de la línea
    expect(month.grossProfit).toBe(5 * 33_000 + 34_000 + 1_250_000); // cargador a 2.000 c/u, iPhone a 750.000 c/u
    expect(month.collected).toBe(month.revenue);
  });

  it("productos que más se mueven: por unidades, con ventas y ganancia, y suman lo mismo que el periodo", async () => {
    const { db, charger, phone } = await scenario();
    const data = await loadAnalysisData(db);
    const { period } = currentPeriod("week", NOW);
    const rows = productMovement(data, period, null);
    expect(rows.map((r) => r.productId)).toEqual([charger.id, phone.id]);
    expect(rows[0]).toMatchObject({
      units: 6,
      revenue: 3 * 35_000 + 2 * 35_000 + 36_000,
      sales: 3,
    });
    expect(rows[1]).toMatchObject({
      units: 1,
      revenue: 2_000_000,
      profit: 1_250_000,
      sales: 1,
    });
    expect(Math.round((rows[0].share + rows[1].share) * 1000)).toBe(1000);
    const m = periodMetrics(data, period, null);
    expect(rows.reduce((a, r) => a + r.revenue, 0)).toBe(m.revenue);
    expect(rows.reduce((a, r) => a + r.profit, 0)).toBe(m.grossProfit);
    expect(rows.reduce((a, r) => a + r.units, 0)).toBe(m.units);
    // Hoy solo se vendió un cargador
    expect(
      productMovement(data, currentPeriod("day", NOW).period, null),
    ).toHaveLength(1);
    // Un periodo sin ventas no trae filas
    expect(
      productMovement(data, periodsFor("day", 30, NOW)[0].period, null),
    ).toEqual([]);
  });
});
