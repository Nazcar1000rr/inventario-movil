import { describe, expect, it } from 'vitest';
import {
  addInquiry,
  createBackup,
  createPurchase,
  createSale,
  deleteInquiry,
  getBusinessAnalysis,
  getInquiryOverview,
  markInquiryBought,
  parseBackup,
  registerInitialStock,
  reopenInquiry,
  restoreBackup,
  updateInquiry,
} from '../../src/core';
import { D, accessoryProduct, expectIntegrity, makeDB, op, phoneProduct, setupInventory } from './helpers';

const NOW = new Date('2026-10-10T20:00:00Z'); // sábado

describe('v2.3 · preguntones', () => {
  it('cada toque guarda la fecha; "Me compró" resta el más reciente; análisis por semana y mes', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const p = await accessoryProduct(db, inv.id, 'Cargador');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: p.id, quantity: 20, price: 200_000 }] });
    // Esta semana (lunes 5 a domingo 11 de octubre): 6 preguntones y 2 ventas
    for (const d of ['2026-10-05T15:00:00Z', '2026-10-06T15:00:00Z', '2026-10-06T23:30:00Z', '2026-10-08T14:00:00Z', '2026-10-09T16:00:00Z', '2026-10-10T17:00:00Z'])
      await addInquiry(db, { opId: op(), inventoryId: inv.id, date: D(d), productId: p.id });
    await addInquiry(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-20T15:00:00Z') });
    const sell = (d: string) => createSale(db, { opId: op(), inventoryId: inv.id, date: D(d), lines: [{ productId: p.id, quantity: 1, unitPrice: 25_000 }], initialPayment: 25_000 });
    await sell('2026-10-07T15:00:00Z');
    await sell('2026-10-09T15:00:00Z');
    // Repetir el mismo toque (doble pulsación) no duplica
    const opId = op();
    await addInquiry(db, { opId, inventoryId: inv.id, date: D('2026-10-10T18:00:00Z') });
    expect(await addInquiry(db, { opId, inventoryId: inv.id, date: D('2026-10-10T18:00:00Z') })).toBeNull();

    // Uno de los que preguntó volvió y compró
    const back = await markInquiryBought(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-10T19:00:00Z') });
    expect(back!.date).toBe(D('2026-10-10T18:00:00Z'));
    await sell('2026-10-10T19:00:00Z');

    const ov = await getInquiryOverview(db, null, NOW);
    expect(ov.week).toBe(6);
    expect(ov.month).toBe(6);
    expect(ov.today).toBe(1);
    expect(ov.openTotal).toBe(7);
    expect(ov.returnedTotal).toBe(1);
    const week = ov.weeks.at(-1)!;
    // 6 preguntones + 3 ventas = 9 interesados → 3 de cada 9 compran; 3 personas por venta
    expect(week).toMatchObject({ askers: 6, returned: 1, sales: 3, interested: 9, partial: true });
    expect(week.conversion).toBeCloseTo(1 / 3, 6);
    expect(week.perSale).toBe(3);
    expect(ov.months.at(-1)).toMatchObject({ askers: 6, sales: 3 });
    expect(ov.months.at(-2)).toMatchObject({ askers: 1, sales: 0, perSale: null });
    expect(ov.weekdays.find((w) => w.label === 'Martes')!.count).toBe(2);
    expect(ov.topProducts[0]).toMatchObject({ name: 'Cargador', asked: 6, returned: 0 });
    expect(ov.avgDaysToReturn).toBe(0);
    expect(ov.recent).toHaveLength(8);

    // Deshacer "Me compró", corregir lo preguntado y borrar un toque por error
    await reopenInquiry(db, back!.id);
    await updateInquiry(db, back!.id, { productId: p.id, notes: 'Quería el de 35 W' });
    await deleteInquiry(db, back!.id);
    expect((await getInquiryOverview(db, null, NOW)).openTotal).toBe(7);
    await expect(markInquiryBought(db, { opId: op(), inventoryId: null })).rejects.toMatchObject({ code: 'none_open' });
    await expectIntegrity(db);

    // Viajan en el respaldo
    const db2 = await makeDB();
    await restoreBackup(db2, await parseBackup((await createBackup(db)).text), { safetyName: 'seg-' + op() });
    expect(await db2.inquiries.count()).toBe(7);
    await expectIntegrity(db2);
  });
});

describe('v2.3 · tiempo para vender', () => {
  it('promedio, mediana, rangos, por producto y lo que lleva esperando', async () => {
    const db = await makeDB();
    const inv = await setupInventory(db);
    const a = await accessoryProduct(db, inv.id, 'Cable');
    await createPurchase(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-01T15:00:00Z'), lines: [{ productId: a.id, quantity: 10, price: 50_000 }] });
    // 2 a los 4 días y 1 a los 30 días
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-09-05T15:00:00Z'), lines: [{ productId: a.id, quantity: 2, unitPrice: 9_000 }], initialPayment: 18_000 });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: a.id, quantity: 1, unitPrice: 9_000 }], initialPayment: 9_000 });
    const phone = await phoneProduct(db, inv.id);
    const { unitIds } = await registerInitialStock(db, { opId: op(), productId: phone.id, quantity: 1, unitCost: 1_000_000, date: D('2026-08-01T15:00:00Z') });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-01T15:00:00Z'), lines: [{ productId: phone.id, unitIds, unitPrice: 1_400_000 }], initialPayment: 1_400_000 });
    // Sin fecha de ingreso: no cuenta para el promedio
    const b = await accessoryProduct(db, inv.id, 'Funda');
    await registerInitialStock(db, { opId: op(), productId: b.id, quantity: 2, unitCost: 5_000, date: null });
    await createSale(db, { opId: op(), inventoryId: inv.id, date: D('2026-10-02T15:00:00Z'), lines: [{ productId: b.id, quantity: 1, unitPrice: 15_000 }], initialPayment: 15_000 });

    const t = (await getBusinessAnalysis(db, null, NOW)).sellTime;
    expect(t.units).toBe(4);
    expect(t.unknown).toBe(1);
    expect(t.avgDays).toBe(24.8); // (4 + 4 + 30 + 61) ÷ 4 = 24,75 (se redondea a un decimal)
    expect(t.medianDays).toBe(17);
    expect(t.buckets.find((x) => x.key === '0-7')!.units).toBe(2);
    expect(t.buckets.find((x) => x.key === '61-90')!.units).toBe(1);
    expect(t.byProduct[0]).toMatchObject({ name: 'Cable', units: 3 });
    expect(t.byProduct.at(-1)!.units).toBe(1);
    expect(t.months.find((m) => m.label === 'septiembre 2026')!.avgDays).toBe(4);
    // Lo que queda: 7 cables desde el 1 de septiembre (39 días) y 1 funda sin fecha
    expect(t.waiting).toMatchObject({ avgDays: 39, units: 8 });
  });
});
