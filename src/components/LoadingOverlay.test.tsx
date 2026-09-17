import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingOverlay } from './LoadingOverlay';

describe('LoadingOverlay', () => {
  it('superpone el estado de carga a pantalla completa reutilizando LoadingState', () => {
    const { container } = render(
      <LoadingOverlay
        variant="import"
        title="Procesando archivo…"
        description="Detectando duplicados y conflictos."
      />,
    );

    const overlay = container.querySelector('.loading-overlay');
    expect(overlay).toBeInTheDocument();

    // Una sola región accesible: la del LoadingState reutilizado.
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('data-loading-variant', 'import');
    expect(status).toHaveClass('loading-state');
    expect(status).not.toHaveClass('loading-state--compact');

    expect(screen.getByText('Procesando archivo…')).toBeInTheDocument();
    expect(
      screen.getByText('Detectando duplicados y conflictos.'),
    ).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('usa la variante process por defecto', () => {
    render(<LoadingOverlay />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'data-loading-variant',
      'process',
    );
  });
});
