import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/components/Placeholder';

/** Módulo de importación y validación del Calendario de Campañas Liverpool. */
export function ImportPage() {
  return (
    <>
      <PageHeader
        title="Importar Calendario"
        description="Sube el Calendario de Campañas descargado de Liverpool. La validación no depende de posiciones fijas: detecta la hoja operativa, la fila de encabezados y los cambios estructurales."
      />
      <Placeholder
        title="Validación de importación"
        items={[
          'Detección de hoja operativa y fila de encabezados por estructura.',
          'Columnas obligatorias, faltantes, adicionales y reordenadas (reporte textual).',
          'Detección de soportes nuevos y separación Liverpool / InStore Media (Muppi’s y Pendón).',
          'Lectura de comentarios de celdas con asignaciones de tiendas.',
          'Errores bloqueantes vs. advertencias, vista previa y reporte de incidencias descargable.',
          'Conservación del archivo original y del resultado de validación.',
        ]}
      >
        En esta primera entrega se establece la arquitectura, los modelos (
        <code>ImportValidation</code>, <code>ValidationIssue</code>) y la
        clasificación de soportes. El parser de Excel se implementará en la
        siguiente iteración.
      </Placeholder>
    </>
  );
}
