import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReconciliationPage } from './ReconciliationPage';

describe('ReconciliationPage', () => {
  it('arranca en modo degradado (sin Firebase) sin romper', () => {
    render(
      <MemoryRouter>
        <ReconciliationPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Conciliación/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/modo degradado/i)).toBeInTheDocument();
  });
});
