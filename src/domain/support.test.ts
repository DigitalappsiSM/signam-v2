import { describe, it, expect } from 'vitest';
import {
  classifySupport,
  isInStoreMediaSupport,
  isLiverpoolSupport,
  normalizeSupport,
} from './support';

describe('normalizeSupport', () => {
  it('quita acentos, apóstrofes y colapsa espacios', () => {
    expect(normalizeSupport("  Muppi's  ")).toBe('MUPPIS');
    expect(normalizeSupport('Pendón')).toBe('PENDON');
  });

  it('trata el apóstrofe tipográfico igual que el recto', () => {
    expect(normalizeSupport('MUPPI’S')).toBe('MUPPIS');
  });
});

describe('isInStoreMediaSupport', () => {
  it("detecta MUPPI'S en distintas grafías", () => {
    expect(isInStoreMediaSupport("MUPPI'S")).toBe(true);
    expect(isInStoreMediaSupport('muppis')).toBe(true);
    expect(isInStoreMediaSupport('MUPPI’S')).toBe(true);
  });

  it('detecta PENDON con y sin acento', () => {
    expect(isInStoreMediaSupport('PENDON')).toBe(true);
    expect(isInStoreMediaSupport('Pendón')).toBe(true);
  });

  it('no marca soportes Liverpool', () => {
    expect(isInStoreMediaSupport('VIDEO WALL CRIUS')).toBe(false);
    expect(isInStoreMediaSupport('VIDEOWALL')).toBe(false);
  });
});

describe('isLiverpoolSupport', () => {
  it('es el complemento de InStore Media', () => {
    expect(isLiverpoolSupport('VIDEO WALL CRIUS')).toBe(true);
    expect(isLiverpoolSupport("MUPPI'S")).toBe(false);
  });
});

describe('classifySupport', () => {
  it('clasifica correctamente por propietario', () => {
    expect(classifySupport("MUPPI'S")).toBe('instore-media');
    expect(classifySupport('PENDON')).toBe('instore-media');
    expect(classifySupport('PANTALLA LED')).toBe('liverpool');
  });
});
