/** Conectores que no aportan a las iniciales (se omiten si hay otras palabras). */
const STOP_WORDS = new Set([
  'de',
  'a',
  'y',
  'la',
  'el',
  'los',
  'las',
  'del',
  'en',
  'con',
  'para',
]);

/**
 * Iniciales legibles de un texto (p. ej. nombre de campaña): toma la primera
 * letra de las dos primeras palabras significativas, omitiendo conectores.
 * "REGRESO A CLASES" → "RC"; "BUEN FIN 2025" → "BF".
 */
export function toInitials(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const use = meaningful.length > 0 ? meaningful : words;
  const first = use[0] ?? '';
  if (use.length <= 1) return (first.slice(0, 2) || '—').toUpperCase();
  const second = use[1] ?? '';
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}
