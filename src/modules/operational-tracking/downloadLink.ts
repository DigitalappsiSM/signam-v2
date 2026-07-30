/**
 * Estado del indicador automático "Link de descarga".
 *
 * Se deriva del campo `LINK` de la campaña importada: no se persiste como un
 * check manual mutable, para que nunca quede desincronizado con `campaign.link`.
 */

export type DownloadLinkStatus = 'valid' | 'missing' | 'invalid';

/**
 * ¿El valor es una URL de descarga válida? Solo acepta `http:`/`https:`;
 * rechaza vacío, texto arbitrario y esquemas peligrosos (`javascript:`,
 * `data:`, `file:`). No lanza excepciones.
 */
export function isValidDownloadUrl(value: string): boolean {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** Clasifica el link en válido / faltante / inválido. */
export function downloadLinkStatus(
  value: string | undefined,
): DownloadLinkStatus {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return 'missing';
  return isValidDownloadUrl(trimmed) ? 'valid' : 'invalid';
}
