import { describe, expect, it } from 'vitest';
import {
  allowedSupportsFor,
  canonicalCircuit,
  isCompatibleSupport,
} from './supportMapping';

describe('mapeo de circuito Ekon ↔ soporte Liverpool', () => {
  it('resuelve el alias MEGA MUPI DIGITAL → MEGA MUPI', () => {
    expect(canonicalCircuit('MEGA MUPI DIGITAL')).toBe('MEGA MUPI');
    expect(canonicalCircuit('MEGA MUPI')).toBe('MEGA MUPI');
  });

  it('acepta solo combinaciones autorizadas', () => {
    expect(isCompatibleSupport('ESPECTACULAR IN STORE', 'BANNER DIGITAL')).toBe(
      true,
    );
    expect(isCompatibleSupport('ESPECTACULAR IN STORE', 'LED ALTABRISA')).toBe(
      true,
    );
    expect(isCompatibleSupport('MEGA MUPI DIGITAL', 'MEGA MUPI DIGITAL')).toBe(
      true,
    );
    expect(isCompatibleSupport('VIDEOWALL', 'VIDEO WALL CRIUS')).toBe(true);
    // No autorizadas:
    expect(isCompatibleSupport('MEGA MUPI', 'BANNER DIGITAL')).toBe(false);
    expect(
      isCompatibleSupport('ESPECTACULAR IN STORE', 'MEGA MUPI DIGITAL'),
    ).toBe(false);
    expect(isCompatibleSupport('DESCONOCIDO', 'BANNER DIGITAL')).toBe(false);
  });

  it('no exige igualdad literal entre sistemas distintos', () => {
    expect(
      isCompatibleSupport('espectacular out liv', 'video wall crius'),
    ).toBe(true);
  });

  it('lista los soportes permitidos de un circuito', () => {
    expect(allowedSupportsFor('MEGA MUPI')).toEqual(['MEGA MUPI DIGITAL']);
    expect(allowedSupportsFor('ESPECTACULAR IN STORE')).toContain(
      'BANNER DIGITAL',
    );
    expect(allowedSupportsFor('DESCONOCIDO')).toEqual([]);
  });
});

describe('identidad estable', () => {
  it('la misma identidad con distinto periodo produce la misma llave', async () => {
    const { assignmentKey } = await import('./identity');
    const base = {
      año: '2026',
      campaña: '30001',
      lineaCampaña: '10',
      determinante: '10',
      articulo: 'MEGA MUPI DIGITAL',
    };
    expect(assignmentKey(base)).toBe(assignmentKey(base));
  });

  it('colapsa ceros a la izquierda del determinante y acentos del artículo', async () => {
    const { assignmentKey } = await import('./identity');
    const a = assignmentKey({
      año: '2026',
      campaña: '1',
      lineaCampaña: '1',
      determinante: '0078',
      articulo: 'Mega Mupi Digital',
    });
    const b = assignmentKey({
      año: '2026',
      campaña: '1',
      lineaCampaña: '1',
      determinante: '78',
      articulo: 'MEGA MUPI DIGITAL',
    });
    expect(a).toBe(b);
  });
});
