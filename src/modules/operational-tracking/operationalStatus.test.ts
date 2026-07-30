import { describe, it, expect } from 'vitest';
import {
  witnessStartStatus,
  witnessCompleteStatus,
  STATUS_SEVERITY,
} from './operationalStatus';
import { parseCampaignDate } from './businessDays';

const d = (s: string) => parseCampaignDate(s)!;
// 2026-03-02 lunes → límite T Arranque = viernes 2026-03-06.
const START = '2026-03-02';
const END = '2026-03-20';

function startInput(over: Partial<Parameters<typeof witnessStartStatus>[0]>) {
  return {
    startStr: START,
    endStr: END,
    completed: false,
    completedAt: null,
    today: d('2026-03-02'),
    ...over,
  };
}

describe('witnessStartStatus', () => {
  it('futuro cuando aún no inicia', () => {
    expect(witnessStartStatus(startInput({ today: d('2026-02-27') }))).toBe(
      'upcoming',
    );
  });

  it('en tiempo con más de 2 días hábiles', () => {
    // hoy lunes, límite viernes → jue+vie+... realmente mar..vie = 4 → on-track.
    expect(witnessStartStatus(startInput({ today: d('2026-03-02') }))).toBe(
      'on-track',
    );
  });

  it('due-soon con 2 días hábiles o menos', () => {
    // hoy miércoles → jue, vie = 2 → due-soon.
    expect(witnessStartStatus(startInput({ today: d('2026-03-04') }))).toBe(
      'due-soon',
    );
  });

  it('vence hoy', () => {
    expect(witnessStartStatus(startInput({ today: d('2026-03-06') }))).toBe(
      'due-today',
    );
  });

  it('vencido cuando pasó el límite', () => {
    expect(witnessStartStatus(startInput({ today: d('2026-03-09') }))).toBe(
      'overdue',
    );
  });

  it('completado a tiempo', () => {
    expect(
      witnessStartStatus(
        startInput({
          completed: true,
          completedAt: Date.parse('2026-03-05T10:00:00'),
        }),
      ),
    ).toBe('completed-on-time');
  });

  it('completado tarde', () => {
    expect(
      witnessStartStatus(
        startInput({
          completed: true,
          completedAt: Date.parse('2026-03-10T10:00:00'),
        }),
      ),
    ).toBe('completed-late');
  });

  it('fecha inválida', () => {
    expect(witnessStartStatus(startInput({ startStr: 'sin fecha' }))).toBe(
      'invalid-date',
    );
  });
});

function completeInput(
  over: Partial<Parameters<typeof witnessCompleteStatus>[0]>,
) {
  return {
    startStr: START,
    endStr: END,
    completed: false,
    completedAt: null,
    today: d('2026-03-10'),
    ...over,
  };
}

describe('witnessCompleteStatus', () => {
  it('en tiempo con más de 5 días naturales', () => {
    // hoy 03-10, fin 03-20 → 10 días → on-track.
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-10') })),
    ).toBe('on-track');
  });

  it('due-soon con 5 días naturales o menos', () => {
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-15') })),
    ).toBe('due-soon');
  });

  it('vence hoy', () => {
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-20') })),
    ).toBe('due-today');
  });

  it('vencido', () => {
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-21') })),
    ).toBe('overdue');
  });

  it('completado a tiempo y tarde', () => {
    expect(
      witnessCompleteStatus(
        completeInput({
          completed: true,
          completedAt: Date.parse('2026-03-20T23:00:00'),
        }),
      ),
    ).toBe('completed-on-time');
    expect(
      witnessCompleteStatus(
        completeInput({
          completed: true,
          completedAt: Date.parse('2026-03-25T10:00:00'),
        }),
      ),
    ).toBe('completed-late');
  });

  it('fecha inválida', () => {
    expect(witnessCompleteStatus(completeInput({ endStr: '' }))).toBe(
      'invalid-date',
    );
  });
});

describe('STATUS_SEVERITY', () => {
  it('prioriza vencido sobre el resto y completado-a-tiempo casi al final', () => {
    expect(STATUS_SEVERITY.overdue).toBeLessThan(STATUS_SEVERITY['due-today']);
    expect(STATUS_SEVERITY['due-today']).toBeLessThan(
      STATUS_SEVERITY['due-soon'],
    );
    expect(STATUS_SEVERITY['completed-on-time']).toBeLessThan(
      STATUS_SEVERITY.upcoming,
    );
  });
});
