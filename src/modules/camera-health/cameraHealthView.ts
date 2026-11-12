import type { QuividiCameraHealthRow } from '@/domain';

export type CameraHealthFilter =
  | 'all'
  | 'alerts'
  | 'normal'
  | 'no_measurement'
  | 'partial_measurement'
  | 'no_ots'
  | 'out_of_scope';

/**
 * Los tickets de cámaras se crean siempre en el equipo de Helpdesk 6
 * (`HELPDESK_TEAM_ID` en `functions/src/quividi/odooTickets.ts`).
 */
const ODOO_CAMERA_TICKETS_BASE =
  'https://in-storemedia.odoo.com/odoo/helpdesk/6/tickets/';

/** Liga directa al ticket en Odoo; `null` si no hay un id válido. */
export function odooCameraTicketUrl(
  ticketId: number | null | undefined,
): string | null {
  return typeof ticketId === 'number' &&
    Number.isInteger(ticketId) &&
    ticketId > 0
    ? ODOO_CAMERA_TICKETS_BASE + ticketId
    : null;
}

export function cameraHealthStatusKey(
  camera: QuividiCameraHealthRow,
): Exclude<CameraHealthFilter, 'all' | 'alerts'> {
  return camera.monitored ? camera.currentStatus : 'out_of_scope';
}

export function cameraHealthStatusLabel(
  camera: QuividiCameraHealthRow,
): string {
  if (!camera.monitored) return 'Fuera de alcance';
  switch (camera.currentStatus) {
    case 'no_measurement':
      return 'Sin medición';
    case 'partial_measurement':
      return 'Medición parcial';
    case 'no_ots':
      return 'Sin OTS';
    default:
      return 'Normal';
  }
}

export function cameraHealthStatusTone(
  camera: QuividiCameraHealthRow,
): 'success' | 'danger' | 'warning' | 'muted' {
  if (!camera.monitored) return 'muted';
  if (camera.currentStatus === 'no_measurement') return 'danger';
  if (
    camera.currentStatus === 'partial_measurement' ||
    camera.currentStatus === 'no_ots'
  ) {
    return 'warning';
  }
  return 'success';
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function filterCameraHealthRows(
  cameras: readonly QuividiCameraHealthRow[],
  search: string,
  filter: CameraHealthFilter,
): QuividiCameraHealthRow[] {
  const query = normalize(search);
  return cameras.filter((camera) => {
    const status = cameraHealthStatusKey(camera);
    if (filter === 'alerts') {
      if (!camera.monitored || camera.activeAlertId === null) return false;
    } else if (filter !== 'all' && status !== filter) {
      return false;
    }

    if (!query) return true;
    const haystack = normalize(
      [
        camera.storeNumber,
        camera.storeName,
        camera.support,
        camera.locationName,
        String(camera.locationId),
        cameraHealthStatusLabel(camera),
      ].join(' '),
    );
    return haystack.includes(query);
  });
}

export function formatHealthDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-');
  return day + '/' + month + '/' + year;
}
