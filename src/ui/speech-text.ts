/**
 * Prepara un texto de la app para leerlo en voz alta en español (función pura, probada aparte):
 * cifras en pesos, símbolos, abreviaturas y emojis.
 */
export function speechText(input: string): string {
  let t = ` ${input} `;
  // Emojis y símbolos decorativos
  t = t.replace(/\p{Extended_Pictographic}️?/gu, ' ');
  t = t.replace(/[ⓘ⭐✓✗⊘•·]/g, ' ');
  // Cifras: quitar separadores de miles (punto, espacio o espacio duro): 1.300.000 / 1 300 000 → 1300000
  t = t.replace(/\d{1,3}(?:[.   ]\d{3})+(?![\d])/g, (m) => m.replace(/[.   ]/g, ''));
  // Pesos: "$ 1300000" / "−$ 5000" → "1300000 pesos"
  t = t.replace(/([−-])\s?\$\s?(\d+(?:,\d+)?)/g, 'menos $2 pesos');
  t = t.replace(/\$\s?(\d+(?:,\d+)?)/g, '$1 pesos');
  t = t.replace(/\bCOP\b/g, 'pesos');
  // Símbolos y abreviaturas
  t = t.replace(/\s?%/g, ' por ciento');
  t = t.replace(/\bc\/u\b/gi, 'cada uno');
  t = t.replace(/÷/g, ' dividido entre ');
  t = t.replace(/(\d)\s?×\s?(\d)/g, '$1 por $2');
  t = t.replace(/×/g, ' por ');
  t = t.replace(/\s?→\s?/g, ', ');
  t = t.replace(/▲/g, ' sube ');
  t = t.replace(/▼/g, ' baja ');
  t = t.replace(/(^|\s)−\s?(\d)/g, '$1menos $2');
  t = t.replace(/\s−\s/g, ' menos ');
  t = t.replace(/\s\+\s/g, ' más ');
  t = t.replace(/\s=\s/g, ' igual a ');
  t = t.replace(/\bEj\.:?/g, 'Por ejemplo:');
  t = t.replace(/\bp\. ej\./gi, 'por ejemplo');
  t = t.replace(/\bN\.º\s?/g, 'número ');
  t = t.replace(/[“”"«»]/g, '');
  t = t.replace(/\s+([,.;:])/g, '$1');
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** Parte un texto largo en frases de hasta `max` caracteres (los motores de voz cortan textos muy largos). */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?¡¿]+[.!?]*|[¡¿][^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((cur + ' ' + s).trim().length <= max) cur = (cur + ' ' + s).trim();
    else {
      if (cur) out.push(cur);
      if (s.length <= max) cur = s;
      else {
        // Frase muy larga: se corta por comas o espacios
        let rest = s;
        while (rest.length > max) {
          const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max));
          const at = cut > 40 ? cut + 1 : max;
          out.push(rest.slice(0, at).trim());
          rest = rest.slice(at).trim();
        }
        cur = rest;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}
