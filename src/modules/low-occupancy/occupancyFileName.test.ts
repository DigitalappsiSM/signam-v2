import { describe, it, expect } from 'vitest';
import { occupancyCsvFileName, sanitizeSegment } from './occupancyFileName';

describe('sanitizeSegment', () => {
  it('elimina acentos', () => {
    expect(sanitizeSegment('ANTEÁ')).toBe('ANTEA');
  });
  it('convierte espacios y diagonales en guion bajo', () => {
    expect(sanitizeSegment('VIDEO WALL CRIUS')).toBe('VIDEO_WALL_CRIUS');
    expect(sanitizeSegment('A/B C')).toBe('A_B_C');
  });
  it('colapsa guiones bajos duplicados y recorta extremos', () => {
    expect(sanitizeSegment('  A   B  ')).toBe('A_B');
    expect(sanitizeSegment('/A//B/')).toBe('A_B');
  });
  it('conserva números y dimensiones', () => {
    expect(sanitizeSegment('904x918')).toBe('904x918');
    expect(sanitizeSegment('914 x 908')).toBe('914_x_908');
  });
  it('sustituye caracteres inválidos', () => {
    expect(sanitizeSegment('A:*?"<>|B')).toBe('A_B');
  });
});

describe('occupancyCsvFileName', () => {
  it('sigue el formato con ambas fechas', () => {
    expect(
      occupancyCsvFileName({
        normalization: 'VIDEO WALL CRIUS',
        resolution: '904x918',
        ratio: 1,
        analysisDate: '2026-08-30',
        generatedDate: '2026-08-06',
      }),
    ).toBe(
      'VIDEO_WALL_CRIUS_904x918_RATIO_1_ANALISIS_2026-08-30_GENERADO_2026-08-06.csv',
    );
  });

  it('incluye ambas fechas aunque sean iguales', () => {
    const name = occupancyCsvFileName({
      normalization: 'APARADOR DIGITAL',
      resolution: '1080x1920',
      ratio: 3,
      analysisDate: '2026-08-06',
      generatedDate: '2026-08-06',
    });
    expect(name).toContain('ANALISIS_2026-08-06');
    expect(name).toContain('GENERADO_2026-08-06');
    expect(name).toContain('RATIO_3');
  });
});
