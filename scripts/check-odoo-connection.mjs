/** Preflight de despliegue: misma lectura que el dashboard, sin publicar datos. */
import { overview } from '../functions/lib/odoo/index.js';

if (!process.env.ODOO_API_KEY) {
  console.error('No está configurada la credencial de integración Odoo.');
  process.exit(1);
}
const month = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
}).formatToParts(new Date());
const value = `${month.find((part) => part.type === 'year')?.value}-${month.find((part) => part.type === 'month')?.value}`;
try {
  const result = await overview.run({
    auth: { uid: 'deployment-read-check', token: { role: 'admin' } },
    data: { month: value },
  });
  console.log(
    `Lectura Odoo correcta: ${value}, ${result.tickets.length} tickets, ${result.warnings.length} avisos de SLA.`,
  );
} catch (error) {
  const reasons = new Set([
    'odoo-auth',
    'odoo-access',
    'odoo-language',
    'odoo-request',
    'odoo-unavailable',
  ]);
  const reason = reasons.has(error?.details?.reason)
    ? error.details.reason
    : 'odoo-connection';
  console.error(
    `Falló la lectura real de Odoo: ${reason}. Revisar la integración antes de publicar.`,
  );
  process.exitCode = 1;
}
