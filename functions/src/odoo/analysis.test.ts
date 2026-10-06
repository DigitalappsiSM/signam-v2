import { describe, expect, it } from 'vitest';
import {
  isCancelledStage,
  isClosedStage,
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
  it('reconoce las etiquetas entre corchetes que usa Liverpool', () => {
    expect(classify('Liverpool', ['[Soporte]'], '', '')).toBe('Soporte');
    expect(classify('Liverpool', ['[Contenido]'], '', '')).toBe('Contenido');
    expect(classify('Liverpool', ['[CAMARAS]'], '', '')).toBe('Cámaras');
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

describe('etapas cerradas de Odoo', () => {
  it('reconoce cancelación en español y en inglés (la API responde sin lang)', () => {
    for (const stage of ['Cancelada', 'Cancelado', 'Canceled', 'Cancelled'])
      expect(isCancelledStage(stage)).toBe(true);
    expect(isCancelledStage('En progreso')).toBe(false);
  });

  it('reconoce cierre en español y en inglés', () => {
    for (const stage of [
      'Resuelto',
      'Cerrado',
      'Solucionado',
      'Solved',
      'Closed',
      'Done',
    ])
      expect(isClosedStage(stage)).toBe(true);
    for (const stage of [
      'Nuevo',
      'En espera de permiso de acceso',
      'In Progress',
    ])
      expect(isClosedStage(stage)).toBe(false);
  });
});
