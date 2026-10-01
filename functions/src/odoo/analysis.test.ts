import { describe, expect, it } from 'vitest';
import {
  classify,
  modality,
  slaState,
  validMonth,
  labeled,
  plainHtml,
} from './analysis';
describe('clasificación de incidencias Odoo', () => {
  it('separa cámara de soporte y modalidad de categoría', () => {
    expect(
      classify('Liverpool', ['Tipo: Soporte', '[camaras]', 'In-Situ'], '', ''),
    ).toBe('Cámaras');
    expect(modality(['In-Situ', 'Remoto'])).toBe('Mixta');
    expect(classify('Chedraui', ['Remoto'], '', '')).toBe('General');
    expect(classify('Liverpool', ['Remoto'], '', '')).toBe('Sin clasificar');
  });
  it('normaliza variantes y no clasifica por palabras ambiguas del asunto', () => {
    expect(classify('Liverpool', ['Cámara'], '', '')).toBe('Cámaras');
    expect(classify('Liverpool', ['Contenido'], '', '')).toBe('Contenido');
    expect(
      classify('Liverpool', [], 'Contenido congelado por avería de PC', ''),
    ).toBe('Sin clasificar');
    expect(
      classify('Liverpool', ['Tipo: Soporte', 'Tipo: Contenido'], '', ''),
    ).toBe('Sin clasificar');
  });
  it('extrae descripción estructurada sin inferir por comentarios', () => {
    const value = plainHtml(
      '<p>Tipo de ticket: Soporte</p><p>Tienda: 001 - Tienda</p><p>Solicitante: Persona</p>',
    );
    expect(labeled(value, 'Tienda')).toBe('001 - Tienda');
    expect(classify('Liverpool', [], '', value)).toBe('Soporte');
    expect(modality([])).toBe('Sin dato');
  });
  it('conserva incumplimiento entre políticas y no convierte ausencias en éxito', () => {
    expect(slaState([])).toBe('Sin dato');
    expect(slaState([{ status: 'reached' }, { status: 'failed' }])).toBe(
      'Incumplido',
    );
    expect(slaState([{ status: 'reached' }, { status: 'ongoing' }])).toBe(
      'En curso',
    );
    expect(slaState([{ status: 'unknown' }])).toBe('Sin dato');
    expect(validMonth('2026-13')).toBe(false);
    expect(validMonth('2026-09')).toBe(true);
  });
});
