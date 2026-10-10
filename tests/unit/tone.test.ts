import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Formas de "usted" que no deben aparecer en textos de la app (el tono es cercano: "tú"). */
const USTED = /\b(usted|Usted|Seleccione|seleccione|Ingrese|ingrese|Indique|indique|Agregue|agregue|Describa|describa|Elija|elija|Haga|haga|Escriba|escriba|Toque|toque|Anule|anule|Revise|revise|Instale|instale|Desarchívelo|regístrela|Regístrela|Guárdelo|guárdelo|envíelos|Cierre y vuelva|Considere|Puede agregar|podrá registrar|Podrá completarlos|Sus datos|sus datos|su teléfono|Su teléfono|olvida la|guárdela|inventario vende)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('v2 · tono cercano (tú)', () => {
  it('los textos de la app no usan formas de "usted"', () => {
    const hits: string[] = [];
    for (const f of files('src')) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (USTED.test(line)) hits.push(`${f}:${i + 1}: ${t.slice(0, 120)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
