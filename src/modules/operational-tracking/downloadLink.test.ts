import { describe, it, expect } from 'vitest';
import { isValidDownloadUrl, downloadLinkStatus } from './downloadLink';

describe('isValidDownloadUrl', () => {
  it('acepta URLs http y https', () => {
    expect(isValidDownloadUrl('https://ejemplo.com/a.zip')).toBe(true);
    expect(isValidDownloadUrl('http://ejemplo.com')).toBe(true);
  });

  it('recorta espacios', () => {
    expect(isValidDownloadUrl('  https://ejemplo.com  ')).toBe(true);
  });

  it('rechaza vacío y solo espacios', () => {
    expect(isValidDownloadUrl('')).toBe(false);
    expect(isValidDownloadUrl('   ')).toBe(false);
  });

  it('rechaza texto arbitrario y URLs mal formadas', () => {
    expect(isValidDownloadUrl('pendiente')).toBe(false);
    expect(isValidDownloadUrl('www.ejemplo.com')).toBe(false);
    expect(isValidDownloadUrl('http://')).toBe(false);
  });

  it('rechaza esquemas peligrosos', () => {
    expect(isValidDownloadUrl('javascript:alert(1)')).toBe(false);
    expect(isValidDownloadUrl('data:text/html,x')).toBe(false);
    expect(isValidDownloadUrl('file:///etc/passwd')).toBe(false);
  });

  it('no lanza excepciones con entradas inválidas', () => {
    expect(() =>
      isValidDownloadUrl(undefined as unknown as string),
    ).not.toThrow();
  });
});

describe('downloadLinkStatus', () => {
  it('distingue válido, faltante e inválido', () => {
    expect(downloadLinkStatus('https://ejemplo.com')).toBe('valid');
    expect(downloadLinkStatus('')).toBe('missing');
    expect(downloadLinkStatus(undefined)).toBe('missing');
    expect(downloadLinkStatus('no-es-url')).toBe('invalid');
  });
});
