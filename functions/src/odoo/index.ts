import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { odooCall, OdooApiError } from '../quividi/odooTickets';
import {
  classify,
  hours,
  isCancelledStage,
  isClosedStage,
  labeled,
  modality,
  plainHtml,
  relation,
  slaState,
  text,
  validMonth,
  type Row,
} from './analysis';

const ODOO_API_KEY = defineSecret('ODOO_API_KEY');
const RETAILERS = ['Liverpool', 'Chedraui', 'La Comer', 'Farmacias San Pablo'];
async function schema(
  key: string,
  model: string,
): Promise<Record<string, Row>> {
  return odooCall(key, model, 'fields_get', { attributes: ['type', 'string'] });
}
async function rows(
  key: string,
  model: string,
  domain: unknown[],
  fields: string[],
): Promise<Row[]> {
  const result: Row[] = [];
  for (let offset = 0; offset <= 5000; offset += 250) {
    const page = await odooCall<Row[]>(key, model, 'search_read', {
      domain,
      fields,
      offset,
      limit: 250,
      order: 'id asc',
      // Hereda el idioma activo del usuario de API. Forzar es_MX puede fallar
      // cuando la base solo tiene instalado es_ES.
      context: { active_test: false },
    });
    result.push(...page);
    if (result.length > 5000)
      throw new HttpsError(
        'resource-exhausted',
        'El mes supera 5,000 registros. Se requiere una consulta más acotada.',
      );
    if (page.length < 250) return result;
  }
  return result;
}

export const overview = onCall(
  { secrets: [ODOO_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    if (
      !['admin', 'operator', 'viewer'].includes(text(request.auth.token.role))
    )
      throw new HttpsError(
        'permission-denied',
        'Tu rol no permite consultar incidencias Odoo.',
      );
    const month: unknown = request.data?.month;
    if (!validMonth(month))
      throw new HttpsError('invalid-argument', 'Selecciona un mes válido.');
    const key = ODOO_API_KEY.value();
    if (!key)
      throw new HttpsError(
        'failed-precondition',
        'La conexión Odoo no está configurada.',
      );
    try {
      const teams = await rows(
        key,
        'helpdesk.team',
        [['name', 'in', RETAILERS]],
        ['id', 'name'],
      );
      if (!teams.length)
        throw new HttpsError(
          'failed-precondition',
          'No se encontraron los equipos de retailers autorizados.',
        );
      const ticketFields = await schema(key, 'helpdesk.ticket');
      const required = [
        'id',
        'name',
        'team_id',
        'partner_id',
        'user_id',
        'stage_id',
        'tag_ids',
        'description',
        'create_date',
      ];
      if (required.some((field) => !ticketFields[field]))
        throw new HttpsError(
          'failed-precondition',
          'Faltan campos necesarios en Odoo.',
        );
      const optional = [
        'close_date',
        'first_response_date',
        'first_response_hours',
        'close_hours',
        'partner_name',
        'sla_deadline',
      ];
      const available = optional.filter((field) => ticketFields[field]);
      const year = Number(month.slice(0, 4));
      const number = Number(month.slice(5));
      // Local midnight in Mexico City (UTC-6), inclusive start / exclusive end.
      const from = `${month}-01 06:00:00`;
      const to = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01 06:00:00`;
      const tickets = await rows(
        key,
        'helpdesk.ticket',
        [
          ['team_id', 'in', teams.map((team) => team.id)],
          ['create_date', '>=', from],
          ['create_date', '<', to],
        ],
        [...required, ...available],
      );
      const tagIds = [
        ...new Set(
          tickets.flatMap((ticket) =>
            Array.isArray(ticket.tag_ids) ? (ticket.tag_ids as number[]) : [],
          ),
        ),
      ];
      const tags = tagIds.length
        ? await rows(
            key,
            'helpdesk.tag',
            [['id', 'in', tagIds]],
            ['id', 'name'],
          )
        : [];
      const tagMap = new Map(tags.map((tag) => [tag.id, text(tag.name)]));
      let statuses: Row[] = [];
      const warnings: string[] = [];
      if (tickets.length) {
        try {
          const fields = await schema(key, 'helpdesk.sla.status');
          if (!fields.status || !fields.ticket_id)
            throw new Error('No SLA fields');
          statuses = await rows(
            key,
            'helpdesk.sla.status',
            [['ticket_id', 'in', tickets.map((ticket) => ticket.id)]],
            [
              'id',
              'ticket_id',
              'status',
              ...(fields.sla_id ? ['sla_id'] : []),
              ...(fields.deadline ? ['deadline'] : []),
            ],
          );
        } catch (error) {
          if (
            error instanceof HttpsError &&
            error.code === 'resource-exhausted'
          )
            throw error;
          warnings.push(
            'No fue posible leer los resultados de SLA. Se muestran como Sin dato.',
          );
        }
      }
      // Optional policy metadata: target stage helps distinguish response from closure.
      const policyStages = new Map<number, string>();
      const policyIds = [
        ...new Set(
          statuses.flatMap((status) =>
            Array.isArray(status.sla_id) ? [Number(status.sla_id[0])] : [],
          ),
        ),
      ];
      if (policyIds.length) {
        try {
          const fields = await schema(key, 'helpdesk.sla');
          if (fields.stage_id) {
            const policies = await rows(
              key,
              'helpdesk.sla',
              [['id', 'in', policyIds]],
              ['id', 'stage_id'],
            );
            for (const policy of policies)
              policyStages.set(Number(policy.id), relation(policy.stage_id));
          }
        } catch (error) {
          if (
            error instanceof HttpsError &&
            error.code === 'resource-exhausted'
          )
            throw error;
          warnings.push(
            'No fue posible leer las etapas objetivo de SLA. Las políticas sin nombre explícito se muestran como Sin dato en respuesta y resolución.',
          );
        }
      }
      const byTicket = new Map<number, Row[]>();
      for (const status of statuses) {
        if (!Array.isArray(status.ticket_id)) continue;
        const id = Number(status.ticket_id[0]);
        byTicket.set(id, [...(byTicket.get(id) ?? []), status]);
      }
      return {
        month,
        fetchedAt: new Date().toISOString(),
        warnings,
        missingFields: optional.filter((field) => !ticketFields[field]),
        tickets: tickets.map((ticket) => {
          const description = plainHtml(ticket.description);
          const retailer = relation(ticket.team_id);
          const names = (Array.isArray(ticket.tag_ids) ? ticket.tag_ids : [])
            .map((id) => tagMap.get(id) ?? '')
            .filter(Boolean);
          const partner = relation(ticket.partner_id);
          // A person or generic retailer partner is never treated as a physical store.
          const store =
            labeled(description, 'Tienda') ||
            (/(^|,\s*)\d{2,4}\s*-\s*/.test(partner)
              ? partner.replace(/^.*?,\s*(?=\d{2,4}\s*-)/, '')
              : null);
          const stage = relation(ticket.stage_id);
          const cancelled = isCancelledStage(stage);
          const closed = !cancelled && isClosedStage(stage);
          const result = byTicket.get(Number(ticket.id)) ?? [];
          return {
            id: Number(ticket.id),
            title: text(ticket.name),
            retailer,
            store,
            requester:
              labeled(description, 'Solicitante') ||
              text(ticket.partner_name) ||
              'Sin dato',
            assignee: relation(ticket.user_id) || 'Sin asignar',
            stage,
            closed,
            cancelled,
            category: classify(retailer, names, text(ticket.name), description),
            modality: modality(names),
            tags: names,
            createdAt: text(ticket.create_date),
            closedAt: text(ticket.close_date) || null,
            firstResponseHours:
              ticket.first_response_date ||
              (hours(ticket.first_response_hours) ?? 0) > 0
                ? hours(ticket.first_response_hours)
                : null,
            resolutionHours: closed ? hours(ticket.close_hours) : null,
            sla: cancelled ? 'No aplica' : slaState(result),
            policies: result.map((status) => ({
              name: relation(status.sla_id),
              targetStage: Array.isArray(status.sla_id)
                ? (policyStages.get(Number(status.sla_id[0])) ?? '')
                : '',
              status: text(status.status),
              deadline: text(status.deadline) || null,
            })),
            url: `https://in-storemedia.odoo.com/odoo/helpdesk/${Array.isArray(ticket.team_id) ? Number(ticket.team_id[0]) : 0}/tickets/${Number(ticket.id)}`,
          };
        }),
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof OdooApiError) {
        const details = {
          reason: error.reason,
          model: error.model,
          method: error.method,
          httpStatus: error.status,
        };
        logger.warn('Falló la consulta de incidencias Odoo', details);
        throw new HttpsError(
          error.reason === 'odoo-access'
            ? 'permission-denied'
            : ['odoo-auth', 'odoo-language', 'odoo-request'].includes(
                  error.reason,
                )
              ? 'failed-precondition'
              : 'unavailable',
          'La consulta de incidencias Odoo no se pudo completar.',
          details,
        );
      }
      logger.warn('Falló la consulta de incidencias Odoo', {
        reason: 'odoo-connection',
      });
      throw new HttpsError(
        'unavailable',
        'No se pudo consultar Odoo. Revisa permisos de lectura y la conexión.',
      );
    }
  },
);
