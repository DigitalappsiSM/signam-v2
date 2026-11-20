import { describe, expect, it } from 'vitest';
import { parseGrassfishCatalog } from './grassfish';

const HEADER =
  'Box-ID,Player,Clave tienda,Location ID 1,Location ID 2,Total audiencia';

describe('importación del catálogo Grassfish', () => {
  it('conserva claves y cámaras independientes y admite players sin cámara', () => {
    const players = parseGrassfishCatalog(
      [
        HEADER,
        'BOX-01,"Entrada, Norte",00017,10,30,both',
        'BOX-02,Sur,,,,',
      ].join('\n'),
    );
    expect(players).toEqual([
      {
        boxId: 'BOX-01',
        name: 'Entrada, Norte',
        storeKey: '00017',
        displayCount: 2,
        camera1: { locationId: 10 },
        camera2: { locationId: 30 },
        audienceMode: 'both',
      },
      {
        boxId: 'BOX-02',
        name: 'Sur',
        storeKey: null,
        displayCount: 2,
        camera1: null,
        camera2: null,
        audienceMode: 'primary',
      },
    ]);
  });

  it('bloquea dos cámaras para el total si falta la segunda', () => {
    expect(() =>
      parseGrassfishCatalog(HEADER + '\nBOX-01,Norte,,10,,both'),
    ).toThrow(/requiere dos cámaras/);
  });

  it('rechaza un Location ID compartido por dos players', () => {
    expect(() =>
      parseGrassfishCatalog(
        HEADER + '\nBOX-01,Norte,,10,,primary\nBOX-02,Sur,,10,,primary',
      ),
    ).toThrow(/duplicado/);
  });
});
