import { httpsCallable } from 'firebase/functions';
import { getFirebase } from './firebase';

/**
 * Lectura agregada del Centro de Control (`controlCenter-overview`): tickets
 * abiertos de Liverpool en Odoo y estado vigente de las cámaras Quividi, en una
 * proyección mínima apta para los cuatro roles. Espejo de
 * `functions/src/controlCenter/snapshot.ts`.
 */

export interface ControlCenterTicket {
  id: number;
  title: string;
  /** `Soporte`, `Contenido`, `Cámaras` o `Sin clasificar`. */
  category: string;
  storeNumber: string | null;
  storeLabel: string | null;
  stage: string;
  assignee: string;
  /** UTC de Odoo, `AAAA-MM-DD HH:MM:SS`. */
  createdAt: string;
  url: string;
}

export type CameraStatus =
  'normal' | 'no_measurement' | 'partial_measurement' | 'no_ots';

export interface ControlCenterCamera {
  storeNumber: string;
  storeName: string;
  support: string;
  status: CameraStatus;
  severity: 'none' | 'medium' | 'high' | 'critical';
  latestDate: string;
  consecutiveDays: number;
  coreOts: number;
  ticketId: number | null;
}

export interface ControlCenterSnapshot {
  generatedAt: string;
  tickets: ControlCenterTicket[] | null;
  cameras: ControlCenterCamera[] | null;
  camerasLatestDate: string | null;
  warnings: string[];
}

export async function getControlCenterSnapshot(): Promise<ControlCenterSnapshot> {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  const result = await httpsCallable<
    Record<string, never>,
    ControlCenterSnapshot
  >(fb.functions, 'controlCenter-overview', { timeout: 130_000 })({});
  return result.data;
}
