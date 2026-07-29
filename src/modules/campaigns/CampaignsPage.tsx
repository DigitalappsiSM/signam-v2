import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/components/Placeholder';

/** Módulo de campañas: cruce Liverpool contra pantallas activas del catálogo. */
export function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campañas"
        description="Cruza las campañas del calendario Liverpool contra las pantallas activas del catálogo y consolida por resolución."
      />
      <Placeholder
        title="Consolidación por resolución"
        items={[
          'Llave definitiva: Campaña + RESOLUCION (no se separa por circuito, soporte, ARTICULOS ni TIPO DE PASES).',
          'ARTICULOS literal del maestro; nombre de campaña «<Campaña>_ <ARTICULOS>».',
          'TIPO DE PASES informativo en cada fila; no divide campañas.',
          'Excepción exclusiva de Guadalajara Galerías (tienda 78, VIDEO WALL CRIUS).',
          'Exclusión de pantallas inactivas con incidencia explícita.',
        ]}
      >
        Las funciones puras de nombre de campaña y de llave de consolidación ya
        están implementadas y probadas en <code>src/domain</code>. El motor que
        cruza calendario y catálogo se implementará en la siguiente iteración.
      </Placeholder>
    </>
  );
}
