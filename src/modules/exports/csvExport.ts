import { serializeAdmiraCsv } from '@/domain';
import type { Consolidation } from '@/modules/consolidation/consolidate';

/**
 * Utilidades de exportación de CSV de Admira a partir de consolidaciones.
 * La serialización (encabezado, escape RFC 4180, BOM) vive en `domain/csv`.
 */

/** Nombre de archivo seguro para una consolidación (basado en el nombre Admira). */
export function csvFileName(c: Consolidation): string {
  const base = c.admiraCampaignName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'campana'}.csv`;
}

/** Contenido CSV de una consolidación (UTF-8 con BOM). */
export function consolidationCsv(c: Consolidation): string {
  return serializeAdmiraCsv(c.rows);
}

/** Empaqueta todas las consolidaciones en un ZIP, evitando nombres repetidos. */
export async function buildZip(
  consolidations: readonly Consolidation[],
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Map<string, number>();

  for (const c of consolidations) {
    let name = csvFileName(c);
    const count = used.get(name);
    if (count !== undefined) {
      const next = count + 1;
      used.set(name, next);
      name = name.replace(/\.csv$/, `_${next}.csv`);
    } else {
      used.set(name, 0);
    }
    zip.file(name, consolidationCsv(c));
  }

  return zip.generateAsync({ type: 'blob' });
}
