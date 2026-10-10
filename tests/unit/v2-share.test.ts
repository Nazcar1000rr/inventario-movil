import { describe, expect, it } from 'vitest';
import { compareVersions, daysText } from '../../src/core';
import { buildImagePdf } from '../../src/ui/summary-render';

describe('v2 · resumen en PDF y utilidades', () => {
  it('arma un PDF válido de una página con la imagen (tabla xref correcta)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
    const pdf = buildImagePdf(jpeg, 1080, 1600);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // startxref apunta a "xref" y cada entrada de la tabla apunta a "N 0 obj"
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').slice(3, 8);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    // La imagen va completa y con su longitud declarada
    expect(text).toContain(`/Width 1080 /Height 1600`);
    expect(text).toContain(`/Length ${jpeg.length}`);
    const at = pdf.findIndex((b, i) => b === 0xff && pdf[i + 1] === 0xd8 && pdf[i + 2] === 0xff);
    expect(Array.from(pdf.slice(at, at + jpeg.length))).toEqual(Array.from(jpeg));
    // Página A4 de ancho con la proporción de la imagen
    expect(text).toContain('/MediaBox [0 0 595.28 881.9]');
  });

  it('compara versiones y escribe días en singular/plural', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '2.0.1')).toBeLessThan(0);
    expect(compareVersions('2.1', '2.0.9')).toBeGreaterThan(0);
    expect(daysText(1)).toBe('1 día');
    expect(daysText(2.5)).toBe('2,5 días');
  });
});
