import { describe, it, expect } from 'vitest';
import { parseEkonNumber, campaignKeyId, EKON_ERRORS } from './ekon';

describe('parseEkonNumber', () => {
  it('acepta un entero positivo', () => {
    expect(parseEkonNumber('123')).toEqual({ ok: true, value: 123 });
    expect(parseEkonNumber('  45 ')).toEqual({ ok: true, value: 45 });
    expect(parseEkonNumber('1')).toEqual({ ok: true, value: 1 });
  });

  it('acepta el mayor entero seguro', () => {
    expect(parseEkonNumber(String(Number.MAX_SAFE_INTEGER))).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rechaza el vacío', () => {
    expect(parseEkonNumber('')).toEqual({
      ok: false,
      error: EKON_ERRORS.empty,
    });
    expect(parseEkonNumber('   ')).toEqual({
      ok: false,
      error: EKON_ERRORS.empty,
    });
  });

  it('rechaza el cero', () => {
    expect(parseEkonNumber('0')).toEqual({
      ok: false,
      error: EKON_ERRORS.notPositive,
    });
    expect(parseEkonNumber('00')).toEqual({
      ok: false,
      error: EKON_ERRORS.notPositive,
    });
  });

  it('rechaza negativos', () => {
    expect(parseEkonNumber('-5')).toEqual({
      ok: false,
      error: EKON_ERRORS.notInteger,
    });
  });

  it('rechaza decimales', () => {
    expect(parseEkonNumber('3.5')).toEqual({
      ok: false,
      error: EKON_ERRORS.notInteger,
    });
    expect(parseEkonNumber('3,5').ok).toBe(false);
  });

  it('rechaza texto y valores mixtos', () => {
    expect(parseEkonNumber('abc').ok).toBe(false);
    expect(parseEkonNumber('12a').ok).toBe(false);
    expect(parseEkonNumber('1e3').ok).toBe(false);
    expect(parseEkonNumber('+7').ok).toBe(false);
  });

  it('rechaza enteros no seguros', () => {
    const unsafe = String(Number.MAX_SAFE_INTEGER + 2); // 9007199254740993
    expect(parseEkonNumber(unsafe)).toEqual({
      ok: false,
      error: EKON_ERRORS.unsafe,
    });
  });
});

describe('campaignKeyId', () => {
  it('es determinístico para el mismo nameKey', () => {
    expect(campaignKeyId('regreso a clases')).toBe(
      campaignKeyId('regreso a clases'),
    );
  });

  it('es seguro para IDs de Firestore (sin / . ni vacíos)', () => {
    for (const name of [
      'campaña con / barra',
      '..',
      '.',
      'buen fin 2026',
      'ñoño áéíóú',
    ]) {
      const id = campaignKeyId(name);
      expect(id).not.toContain('/');
      expect(id).not.toBe('.');
      expect(id).not.toBe('..');
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('distingue nombres distintos', () => {
    expect(campaignKeyId('campaña a')).not.toBe(campaignKeyId('campaña b'));
  });

  it('trata el vacío de forma estable', () => {
    expect(campaignKeyId('')).toBe('_');
    expect(campaignKeyId('   ')).toBe('_');
  });
});
