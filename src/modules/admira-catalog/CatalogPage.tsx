import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/components/Placeholder';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';

/** Módulo del catálogo Admira CSM (pantallas): consulta, edición y estados. */
export function CatalogPage() {
  return (
    <>
      <PageHeader
        title="Catálogo Admira"
        description="Administra las pantallas del catálogo Admira CSM. Los campos originales del maestro se conservan intactos; los metadatos de SIGNAM se guardan por separado."
      />

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>
          Encabezados oficiales del maestro
        </h2>
        <p className="text-muted">
          Orden autoritativo (hoja <code>Consolidado</code>). El encabezado
          definitivo es <code>TIPO DE PASES</code>; una estructura con{' '}
          <code>Pases</code> se reporta como campo obligatorio faltante.
        </p>
        <ol style={{ columns: 2, margin: 0 }}>
          {ADMIRA_CATALOG_HEADERS.map((header) => (
            <li key={header}>
              <code>{header}</code>
            </li>
          ))}
        </ol>
      </div>

      <Placeholder
        title="Catálogo editable"
        items={[
          'Consultar, buscar y filtrar por tienda, modelo, resolución y estado.',
          'Agregar, editar y duplicar configuraciones de pantalla.',
          'Inactivar y reactivar (con motivo) conservando el historial.',
          'Importar y comparar nuevas versiones del maestro.',
          'Exportar respaldos.',
        ]}
      >
        Una pantalla inactiva permanece en el catálogo con su historial, pero no
        participa en nuevas consolidaciones ni genera filas de CSV.
      </Placeholder>
    </>
  );
}
