import { describe, it, expect } from 'vitest';
import { toInitials } from './initials';

describe('toInitials', () => {
  it('toma la inicial de las dos primeras palabras significativas', () => {
    expect(toInitials('BUEN FIN 2025')).toBe('BF');
    expect(toInitials('NAVIDAD LIVERPOOL')).toBe('NL');
  });

  it('omite conectores (de, a, y, la, …)', () => {
    expect(toInitials('REGRESO A CLASES')).toBe('RC');
    expect(toInitials('DÍA DE LAS MADRES')).toBe('DM');
  });

  it('con una sola palabra usa sus dos primeras letras', () => {
    expect(toInitials('Samsung')).toBe('SA');
  });

  it('si todo son conectores, no se queda vacío', () => {
    expect(toInitials('de la')).toBe('DL');
  });

  it('texto vacío devuelve un guion', () => {
    expect(toInitials('   ')).toBe('—');
  });
});
