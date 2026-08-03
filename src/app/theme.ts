import { useCallback, useEffect, useState } from 'react';

/**
 * Sistema de tema **claro/oscuro** de SIGNAM V2.
 *
 * - El tema se aplica como atributo `data-theme` en `<html>` para que las
 *   variables CSS de `global.css` cambien en toda la app (incluido el login).
 * - La preferencia del usuario se guarda en `localStorage`; si no hay una,
 *   se respeta la preferencia del sistema (`prefers-color-scheme`).
 * - `initTheme()` se llama antes del render en `main.tsx` para evitar el
 *   parpadeo (FOUC) al cargar en oscuro.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'signam.theme';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Tema guardado por el usuario, si existe y es válido. */
function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Tema inicial: preferencia guardada → preferencia del sistema → claro. */
export function resolveInitialTheme(): Theme {
  return storedTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

/** Aplica el tema al documento (atributo + `color-scheme` nativo). */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

/** Inicializa el tema antes del primer render (evita parpadeo). */
export function initTheme(): void {
  applyTheme(resolveInitialTheme());
}

/**
 * Hook de tema. Devuelve el tema actual y utilidades para cambiarlo.
 * Persiste la elección explícita del usuario en `localStorage`.
 */
export function useTheme(): {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Ignorar entornos sin almacenamiento.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignorar entornos sin almacenamiento.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme, setTheme };
}
