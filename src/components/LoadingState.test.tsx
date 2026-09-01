import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('expone un estado accesible y la variante solicitada', () => {
    render(<LoadingState variant="import" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('data-loading-variant', 'import');
    expect(screen.getByText('Procesando archivo…')).toBeInTheDocument();
  });

  it('permite personalizar el mensaje sin dar semántica al GIF', () => {
    const { container } = render(
      <LoadingState
        variant="process"
        title="Construyendo indicadores…"
        description="Cruce operativo en curso."
        compact
      />,
    );

    expect(screen.getByText('Construyendo indicadores…')).toBeInTheDocument();
    expect(screen.getByText('Cruce operativo en curso.')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.getByRole('status')).toHaveClass('loading-state--compact');
  });
});
