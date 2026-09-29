import { describe, it, expect } from 'vitest';
import {
  witnessStartStatus,
  witnessCompleteStatus,
  passesEvidenceStatus,
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

// Límite de T Completos = fin (03-20) + 4 días naturales = 2026-03-24.
describe('witnessCompleteStatus', () => {
  it('en tiempo con más de 5 días naturales', () => {
    // hoy 03-10, límite 03-24 → 14 días → on-track.
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-10') })),
    ).toBe('on-track');
  });

  it('due-soon con 5 días naturales o menos', () => {
    // hoy 03-19, límite 03-24 → 5 días → due-soon.
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-19') })),
    ).toBe('due-soon');
  });

  it('sigue en tiempo el día del fin de campaña (aún dentro de la ventana)', () => {
    // hoy 03-20 (fin), límite 03-24 → 4 días → due-soon, ya no vencido.
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-20') })),
    ).toBe('due-soon');
  });

  it('vence hoy en el 4.º día natural posterior al fin', () => {
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-24') })),
    ).toBe('due-today');
  });

  it('vencido al pasar los 4 días naturales', () => {
    expect(
      witnessCompleteStatus(completeInput({ today: d('2026-03-25') })),
    ).toBe('overdue');
  });

  it('completado a tiempo y tarde', () => {
    // 03-24 (último día de la ventana) → a tiempo; 03-25 → tarde.
    expect(
      witnessCompleteStatus(
        completeInput({
          completed: true,
          completedAt: Date.parse('2026-03-24T23:00:00'),
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

describe('passesEvidenceStatus', () => {
  const base = { startStr: '2026-09-10', endStr: '2026-09-30' };
  const at = (d: string) => parseCampaignDate(d)!;

  it('vence a los 5 días naturales del inicio (inclusivo)', () => {
    // Inicio 10/09 → límite 15/09.
    expect(
      passesEvidenceStatus({
        ...base,
        completed: false,
        completedAt: null,
        today: at('2026-09-15'),
      }),
    ).toBe('due-today');
    expect(
      passesEvidenceStatus({
        ...base,
        completed: false,
        completedAt: null,
        today: at('2026-09-16'),
      }),
    ).toBe('overdue');
  });

  it('avisa antes de vencer y antes de eso está en curso', () => {
    const s = (today: string) =>
      passesEvidenceStatus({
        ...base,
        completed: false,
        completedAt: null,
        today: at(today),
      });
    expect(s('2026-09-09')).toBe('upcoming');
    expect(s('2026-09-10')).toBe('on-track');
    expect(s('2026-09-12')).toBe('on-track');
    expect(s('2026-09-13')).toBe('due-soon');
    expect(s('2026-09-14')).toBe('due-soon');
  });

  it('distingue entrega a tiempo de tardía', () => {
    const done = (ts: number) =>
      passesEvidenceStatus({
        ...base,
        completed: true,
        completedAt: ts,
        today: at('2026-09-30'),
      });
    expect(done(new Date(2026, 8, 15, 12).getTime())).toBe('completed-on-time');
    expect(done(new Date(2026, 8, 16, 12).getTime())).toBe('completed-late');
  });

  it('fecha inválida', () => {
    expect(
      passesEvidenceStatus({
        startStr: 'x',
        endStr: 'x',
        completed: false,
        completedAt: null,
        today: at('2026-09-15'),
      }),
    ).toBe('invalid-date');
  });
});
