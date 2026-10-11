import { describe, expect, it } from 'vitest';
import { speechChunks, speechText } from '../../src/ui/speech-text';
import { RECIPES, PACKS, SOUNDS } from '../../src/ui/sound';

describe('v2.2 · texto para leer en voz alta', () => {
  it('lee pesos, cifras y símbolos en español', () => {
    expect(speechText('Costo $ 1.300.000 c/u')).toBe('Costo 1300000 pesos cada uno');
    expect(speechText('Ganaste 1 300 000 (15 %)')).toBe('Ganaste 1300000 (15 por ciento)');
    expect(speechText('Margen 16,7 %')).toBe('Margen 16,7 por ciento');
    expect(speechText('ganancia ÷ costo × 100')).toBe('ganancia dividido entre costo por 100');
    expect(speechText('Más → Ayuda')).toBe('Más, Ayuda');
    expect(speechText('💡 Ej.: “caja” ▼ 9 %')).toBe('Por ejemplo: caja baja 9 por ciento');
    expect(speechText('perderías −$ 2.000')).toBe('perderías menos 2000 pesos');
  });

  it('parte textos largos en frases sin perder nada', () => {
    const t = 'Primera frase corta. ' + 'Palabra '.repeat(80) + 'fin. ¿Una pregunta? Sí.';
    const chunks = speechChunks(t, 120);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(t.trim().replace(/\s+/g, ' '));
  });
});

describe('v2.2 · paquetes de sonidos', () => {
  it('cada paquete define los 8 sonidos con notas válidas', () => {
    for (const p of PACKS)
      for (const s of SOUNDS) {
        const notes = RECIPES[p.id][s.id];
        expect(notes.length, `${p.id}/${s.id}`).toBeGreaterThan(0);
        for (const n of notes) {
          expect(n.f).toBeGreaterThan(0);
          expect(n.d).toBeGreaterThan(0);
          expect(n.t).toBeGreaterThanOrEqual(0);
          expect(n.t + n.d).toBeLessThan(1.5);
        }
      }
  });
});
