export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}
export function comparisonText(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}
export function identifier(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value))
    return Number.isInteger(value)
      ? String(value)
      : String(value).replace(/\.0+$/, '');
  return normalizeText(value);
}
export function finiteCount(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const result =
    typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function civilDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(
      Date.UTC(1899, 11, 30) + Math.round(value) * 86400000,
    );
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf()))
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  const text = normalizeText(value);
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match)
    return `${match[3]!}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? text : null;
}
export function stableKey(parts: readonly unknown[]): string {
  return parts.map(comparisonText).join('|');
}
export function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
