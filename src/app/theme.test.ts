import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyTheme, resolveInitialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('applyTheme escribe el atributo y color-scheme en <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('resolveInitialTheme usa la preferencia guardada si existe', () => {
    localStorage.setItem('signam.theme', 'dark');
    expect(resolveInitialTheme()).toBe('dark');
    localStorage.setItem('signam.theme', 'light');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('resolveInitialTheme ignora valores inválidos y cae en claro', () => {
    localStorage.setItem('signam.theme', 'azul');
    // Sin matchMedia real en jsdom, el sistema no fuerza oscuro → claro.
    expect(resolveInitialTheme()).toBe('light');
  });
});
