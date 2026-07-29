import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/components/Placeholder';
import { ADMIRA_CSV_COLUMNS } from '@/domain';

/** Módulo de exportación: generación de los CSV de programación de Admira. */
export function ExportsPage() {
  return (
    <>
      <PageHeader
        title="Exportación CSV"
        description="Genera un CSV por cada Campaña + RESOLUCION, con el layout confirmado de Admira."
      />

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Layout confirmado</h2>
        <pre
          style={{
            background: 'var(--color-bg)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            overflowX: 'auto',
            margin: 0,
          }}
        >
          <code>{ADMIRA_CSV_COLUMNS.join(',')}</code>
        </pre>
        <p className="text-muted" style={{ marginBottom: 0 }}>
          La construcción de <code>RETAILERS</code> requiere una regla posterior
          aún no definida y no debe inventarse.
        </p>
      </div>

      <Placeholder
        title="Generación y respaldo de CSV"
        items={[
          'Vista previa, incidencias, CSV individual y ZIP.',
          'UTF-8 con BOM y escape correcto de comas, comillas y saltos.',
          'Snapshot inmutable de cada exportación (no cambia si luego se edita el catálogo).',
        ]}
      >
        El serializador CSV (encabezado, escape RFC 4180 y BOM) ya está
        implementado y probado en <code>src/domain/csv.ts</code>.
      </Placeholder>
    </>
  );
}
