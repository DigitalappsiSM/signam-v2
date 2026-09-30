import { httpsCallable } from 'firebase/functions';
import { getFirebase } from './firebase';
import type { OdooOverview } from '@/domain/odooIncidents';
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
