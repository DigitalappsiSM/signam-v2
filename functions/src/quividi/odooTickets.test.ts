import { describe, expect, it } from 'vitest';
import { recoveryTicketId, type CameraTicketStateDoc } from './odooTickets';

function ticket(
  over: Partial<CameraTicketStateDoc> = {},
): Partial<CameraTicketStateDoc> {
  return {
    ticketId: 18501,
    ticketStatus: 'recovery_notified',
    incidentStartedDate: '2026-10-01',
    ...over,
  };
}

describe('recoveryTicketId', () => {
  it('devuelve el ticket cuando corresponde a la misma incidencia', () => {
    expect(recoveryTicketId(ticket(), '2026-10-01')).toBe(18501);
    expect(
      recoveryTicketId(ticket({ ticketStatus: 'created' }), '2026-10-01'),
    ).toBe(18501);
  });

  it('no liga el ticket de otra incidencia del mismo punto', () => {
    expect(recoveryTicketId(ticket(), '2026-09-01')).toBeNull();
  });

  it('no liga tickets sin crear o sin estado', () => {
    expect(recoveryTicketId(undefined, '2026-10-01')).toBeNull();
    expect(
      recoveryTicketId(ticket({ ticketStatus: 'error' }), '2026-10-01'),
    ).toBeNull();
    expect(
      recoveryTicketId(ticket({ ticketId: null }), '2026-10-01'),
    ).toBeNull();
    expect(recoveryTicketId(ticket(), '')).toBeNull();
  });
});
