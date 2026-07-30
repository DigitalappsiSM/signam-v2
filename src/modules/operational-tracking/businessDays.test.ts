import { describe, it, expect } from 'vitest';
import {
  fifthBusinessDay,
  businessDaysUntil,
  calendarDaysUntil,
  addDays,
  parseCampaignDate,
} from './businessDays';

const d = (s: string) => parseCampaignDate(s)!;
const ymd = (date: Date) => date.toISOString().slice(0, 10);

describe('fifthBusinessDay', () => {
  it('inicio lunes → quinto día viernes', () => {
    // 2026-03-02 es lunes.
    expect(ymd(fifthBusinessDay(d('2026-03-02')))).toBe('2026-03-06');
  });

  it('inicio martes → quinto día lunes siguiente', () => {
    // 2026-03-03 martes → mié, jue, vie, (sáb/dom), lun 2026-03-09.
    expect(ymd(fifthBusinessDay(d('2026-03-03')))).toBe('2026-03-09');
  });

  it('inicio viernes → quinto día jueves siguiente', () => {
    // 2026-03-06 viernes → lun, mar, mié, jue 2026-03-12.
    expect(ymd(fifthBusinessDay(d('2026-03-06')))).toBe('2026-03-12');
  });

  it('inicio sábado → primer día lunes y quinto viernes', () => {
    // 2026-03-07 sábado → lunes 03-09 es día 1, viernes 03-13 día 5.
    expect(ymd(fifthBusinessDay(d('2026-03-07')))).toBe('2026-03-13');
  });

  it('inicio domingo → primer día lunes y quinto viernes', () => {
    // 2026-03-08 domingo → lunes 03-09 día 1, viernes 03-13 día 5.
    expect(ymd(fifthBusinessDay(d('2026-03-08')))).toBe('2026-03-13');
  });

  it('funciona cruzando cambio de mes', () => {
    // 2026-04-30 jueves → vie 05-01, (fin de semana), lun-mié → 05-06.
    expect(ymd(fifthBusinessDay(d('2026-04-30')))).toBe('2026-05-06');
  });

  it('funciona en año bisiesto cruzando febrero', () => {
    // 2024-02-27 martes → mié 28, jue 29, vie 01-mar, lun 04-mar.
    expect(ymd(fifthBusinessDay(d('2024-02-27')))).toBe('2024-03-04');
  });
});

describe('businessDaysUntil', () => {
  it('cuenta días hábiles después de hoy hasta el límite inclusivo', () => {
    // hoy miércoles, límite viernes → jue, vie = 2.
    expect(businessDaysUntil(d('2026-03-04'), d('2026-03-06'))).toBe(2);
    // hoy martes, límite viernes → mié, jue, vie = 3.
    expect(businessDaysUntil(d('2026-03-03'), d('2026-03-06'))).toBe(3);
  });

  it('ignora el fin de semana', () => {
    // hoy viernes, límite lunes → solo lunes = 1.
    expect(businessDaysUntil(d('2026-03-06'), d('2026-03-09'))).toBe(1);
  });

  it('es 0 cuando el límite es hoy o pasado', () => {
    expect(businessDaysUntil(d('2026-03-06'), d('2026-03-06'))).toBe(0);
    expect(businessDaysUntil(d('2026-03-06'), d('2026-03-05'))).toBe(0);
  });
});

describe('calendarDaysUntil', () => {
  it('cuenta días naturales (con signo)', () => {
    expect(calendarDaysUntil(d('2026-03-01'), d('2026-03-06'))).toBe(5);
    expect(calendarDaysUntil(d('2026-03-06'), d('2026-03-06'))).toBe(0);
    expect(calendarDaysUntil(d('2026-03-06'), d('2026-03-01'))).toBe(-5);
  });

  it('no se rompe por DST (usa fechas civiles UTC)', () => {
    // Un rango que cruza el cambio de horario de México (abril) sigue siendo 30.
    expect(calendarDaysUntil(d('2026-04-01'), d('2026-05-01'))).toBe(30);
  });
});

describe('addDays', () => {
  it('suma y resta días civiles', () => {
    expect(ymd(addDays(d('2026-12-31'), 1))).toBe('2027-01-01');
    expect(ymd(addDays(d('2026-03-01'), -1))).toBe('2026-02-28');
  });
});
