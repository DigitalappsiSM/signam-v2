import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/components/Placeholder';

/** Módulo de historial y auditoría. */
export function AuditPage() {
  return (
    <>
      <PageHeader
        title="Historial"
        description="Auditoría de cambios en el catálogo, importaciones y exportaciones, con valores anteriores y nuevos."
      />
      <Placeholder
        title="Auditoría y versiones"
        items={[
          'Usuario, fecha, acción, registro, valores anteriores y nuevos.',
          'Motivo de inactivación e importación / exportación relacionadas.',
          'Snapshot histórico inmutable por exportación.',
        ]}
      >
        El modelo <code>AuditEvent</code> ya está definido en{' '}
        <code>src/domain</code>. La bitácora se poblará desde Cloud Functions
        para operaciones sensibles.
      </Placeholder>
    </>
  );
}
