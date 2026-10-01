export type Row = Record<string, unknown>;
export function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function relation(value: unknown): string {
  return Array.isArray(value) ? text(value[1]) : '';
}
export function plainHtml(value: unknown): string {
  return text(value)
    .replace(/<\/(p|div|pre)>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}
export function labeled(value: string, label: string): string {
  return (
    value
      .split('\n')
      .map((line) => line.trim())
      .find((line) => normalized(line).startsWith(normalized(label) + ':'))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? ''
  );
}
export function classify(
  retailer: string,
  tags: string[],
  title: string,
  description: string,
): string {
  const keys = tags.map(normalized);
  const camera = keys.some((tag) =>
    /^(\[camaras\]|camaras?|quividi|camara sin conexion)$/.test(tag),
  );
  if (camera) return 'Cámaras';
  const explicit = normalized(labeled(description, 'Tipo de ticket'));
  const support =
    keys.some((tag) => /^(tipo:\s*soporte|soporte)$/.test(tag)) ||
    explicit === 'soporte' ||
    /\[SOPORTE\]/i.test(title);
  const content =
    keys.some((tag) => /^(tipo:\s*contenido|contenido)$/.test(tag)) ||
    explicit === 'contenido' ||
    /\[CONTENIDO\]/i.test(title);
  if (support && content) return 'Sin clasificar';
  if (support) return 'Soporte';
  if (content) return 'Contenido';
  return normalized(retailer) === 'liverpool' ? 'Sin clasificar' : 'General';
}
export function modality(tags: string[]): string {
  const keys = tags.map(normalized);
  const remote = keys.some((tag) => /^(remoto|remota)$/.test(tag));
  const onsite = keys.some((tag) => /^(in[\s-]*situ|en sitio)$/.test(tag));
  return remote && onsite
    ? 'Mixta'
    : remote
      ? 'Remoto'
      : onsite
        ? 'In situ'
        : 'Sin dato';
}
export function slaState(statuses: Row[]): string {
  if (!statuses.length) return 'Sin dato';
  if (statuses.some((row) => row.status === 'failed')) return 'Incumplido';
  if (statuses.every((row) => row.status === 'reached')) return 'Cumplido';
  if (
    statuses.every((row) => ['reached', 'ongoing'].includes(text(row.status)))
  )
    return 'En curso';
  return 'Sin dato';
}
export function hours(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
export function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}
