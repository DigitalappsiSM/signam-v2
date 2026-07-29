import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';

/** Página 404. */
export function NotFoundPage() {
  return (
    <>
      <PageHeader
        title="Página no encontrada"
        description="La ruta solicitada no existe en SIGNAM V2."
      />
      <Link className="btn btn-primary" to="/">
        Volver al panel
      </Link>
    </>
  );
}
