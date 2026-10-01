import { httpsCallable } from 'firebase/functions';
import { getFirebase } from './firebase';
import type { OdooOverview } from '@/domain/odooIncidents';

/** Mensajes controlados: no expone cuerpos de Odoo, tokens ni trazas. */
export function odooErrorMessage(cause: unknown): string {
  const details =
    typeof cause === 'object' &&
    cause !== null &&
    'details' in cause &&
    typeof cause.details === 'object' &&
    cause.details !== null &&
    'reason' in cause.details
      ? String(cause.details.reason)
      : '';
  const reasons: Record<string, string> = {
    'odoo-auth':
      'Odoo rechazó la credencial de integración. Es necesario revisar o renovar la API key configurada en el servidor.',
    'odoo-access':
      'Odoo no permite leer uno de los modelos necesarios. Revisa los permisos del usuario asociado a la API key.',
    'odoo-language':
      'La integración solicitó un idioma que no está activo en Odoo. Debe utilizar el idioma de la cuenta de API.',
    'odoo-request':
      'Odoo rechazó la consulta. Es necesario revisar los modelos y campos de la integración.',
    'odoo-unavailable':
      'Odoo está temporalmente fuera de servicio o limitó las solicitudes. Vuelve a intentar más tarde.',
  };
  if (reasons[details]) return reasons[details];
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String(cause.code).replace(/^functions\//, '')
      : '';
  const messages: Record<string, string> = {
    unauthenticated:
      'Tu sesión expiró. Vuelve a iniciar sesión en SIGNAM para consultar Odoo.',
    'permission-denied':
      'La cuenta no tiene permiso para esta consulta. Comprueba el rol de SIGNAM y los permisos de lectura del usuario de API en Odoo.',
    'failed-precondition':
      'La integración necesita revisar su configuración o los campos disponibles en Odoo.',
    'not-found':
      'El servicio de incidencias todavía no está disponible. Es necesario completar su despliegue.',
    'invalid-argument':
      'Selecciona un mes válido para consultar las incidencias.',
    'resource-exhausted':
      'La consulta excedió el límite de registros o de solicitudes. Selecciona otro mes o inténtalo más tarde.',
    'deadline-exceeded':
      'Odoo tardó demasiado en responder. Vuelve a intentar la consulta.',
    unavailable:
      'Odoo no respondió a la consulta. Vuelve a intentar; si persiste, revisa la integración.',
  };
  return (
    messages[code] ??
    'No se pudo completar la consulta. Vuelve a intentar la conexión.'
  );
}
export async function getOdooOverview(month: string): Promise<OdooOverview> {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  const result = await httpsCallable<{ month: string }, OdooOverview>(
    fb.functions,
    'odoo-overview',
    { timeout: 310_000 },
  )({ month });
  return result.data;
}
