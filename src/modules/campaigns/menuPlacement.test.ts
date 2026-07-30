import { describe, it, expect } from 'vitest';
import { computeMenuPlacement } from './menuPlacement';

const viewport = { width: 1000, height: 800 };

describe('computeMenuPlacement', () => {
  it('abre hacia abajo cuando hay espacio suficiente', () => {
    const p = computeMenuPlacement({
      anchor: { top: 100, bottom: 120, left: 400, right: 440 },
      viewport,
      menuWidth: 240,
      estimatedHeight: 200,
    });
    expect(p.openUp).toBe(false);
    expect(p.top).toBeGreaterThan(120);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  it('abre hacia arriba cuando no hay espacio debajo', () => {
    const p = computeMenuPlacement({
      anchor: { top: 760, bottom: 780, left: 400, right: 440 },
      viewport,
      menuWidth: 240,
      estimatedHeight: 200,
    });
    expect(p.openUp).toBe(true);
    expect(p.bottom).toBeGreaterThan(0);
    expect(p.top).toBeUndefined();
  });

  it('mantiene el panel dentro del viewport horizontalmente', () => {
    // Botón pegado al borde derecho: el panel no debe salirse.
    const p = computeMenuPlacement({
      anchor: { top: 100, bottom: 120, left: 980, right: 1000 },
      viewport,
      menuWidth: 240,
      estimatedHeight: 200,
    });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 240).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('no deja el panel con left negativo si el botón está a la izquierda', () => {
    const p = computeMenuPlacement({
      anchor: { top: 100, bottom: 120, left: 0, right: 20 },
      viewport,
      menuWidth: 240,
      estimatedHeight: 200,
    });
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('nunca devuelve maxHeight negativo', () => {
    const p = computeMenuPlacement({
      anchor: { top: 795, bottom: 800, left: 400, right: 440 },
      viewport,
      menuWidth: 240,
      estimatedHeight: 200,
    });
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
