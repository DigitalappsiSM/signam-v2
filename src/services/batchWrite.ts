import {
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

/**
 * Escritura en lotes segmentada por número de operaciones Y por tamaño estimado.
 *
 * Firestore limita cada petición de escritura a ~10 MiB y a 500 operaciones por
 * lote. Segmentar solo por número de operaciones no basta: con documentos
 * grandes (o muchos), 400 escrituras pueden superar el límite de bytes. Esta
 * utilidad cierra el lote actual antes de exceder cualquiera de los dos límites.
 */

/** Máximo de operaciones por commit (límite duro de Firestore: 500). */
const MAX_OPS_PER_COMMIT = 400;
/** Presupuesto de bytes por commit, con margen bajo el límite de ~10 MiB. */
const MAX_BYTES_PER_COMMIT = 8 * 1024 * 1024;

/** Estima los bytes UTF-8 de un objeto serializado. */
export function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Escribe (set) todos los `items` en commits segmentados por operaciones y
 * bytes. Devuelve cuántos documentos se escribieron. Idempotente si `makeRef`
 * es determinístico. Reintentable: reejecutar reescribe lo mismo.
 */
export async function writeInChunks<T>(
  database: Firestore,
  items: readonly T[],
  makeRef: (item: T) => DocumentReference,
  makeData: (item: T) => DocumentData,
): Promise<number> {
  let batch = writeBatch(database);
  let ops = 0;
  let bytes = 0;
  let written = 0;

  for (const item of items) {
    const data = makeData(item);
    const size = estimateBytes(data);
    if (
      ops > 0 &&
      (ops + 1 > MAX_OPS_PER_COMMIT || bytes + size > MAX_BYTES_PER_COMMIT)
    ) {
      await batch.commit();
      batch = writeBatch(database);
      ops = 0;
      bytes = 0;
    }
    batch.set(makeRef(item), data);
    ops += 1;
    bytes += size;
    written += 1;
  }
  if (ops > 0) await batch.commit();
  return written;
}
