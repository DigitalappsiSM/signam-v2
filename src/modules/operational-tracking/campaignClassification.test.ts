import { describe, it, expect } from 'vitest';
import { classifyFromTipo } from './campaignClassification';

describe('classifyFromTipo', () => {
  it('detecta institucional ignorando mayúsculas y acentos', () => {
    expect(classifyFromTipo('Institucional')).toBe('institutional');
    expect(classifyFromTipo('  campaña INSTITUCIONAL ')).toBe('institutional');
    expect(classifyFromTipo('institucionál')).toBe('institutional');
  });

  it('detecta proveedor', () => {
    expect(classifyFromTipo('Proveedor')).toBe('provider');
    expect(classifyFromTipo('CAMPAÑA PROVEEDOR')).toBe('provider');
  });

  it('deja pendiente el tipo vacío', () => {
    expect(classifyFromTipo('')).toBe('unknown');
    expect(classifyFromTipo('   ')).toBe('unknown');
  });

  it('deja pendiente un tipo desconocido', () => {
    expect(classifyFromTipo('Digital')).toBe('unknown');
    expect(classifyFromTipo('Otro')).toBe('unknown');
  });

  it('deja pendiente si es ambiguo (ambas palabras)', () => {
    expect(classifyFromTipo('Institucional y Proveedor')).toBe('unknown');
  });
});
