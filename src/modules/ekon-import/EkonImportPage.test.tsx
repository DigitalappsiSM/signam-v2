import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.mx', displayName: null, role: 'admin' },
    loading: false,
    configured: false,
  }),
}));

import { EkonImportPage } from './EkonImportPage';

describe('EkonImportPage', () => {
  it('arranca en modo degradado (sin Firebase) sin romper', () => {
    render(
      <MemoryRouter>
        <EkonImportPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Importación Ekon/i }),
    ).toBeInTheDocument();
    // Aviso de modo degradado y control de carga presentes.
    expect(screen.getByText(/modo degradado/i)).toBeInTheDocument();
    expect(screen.getByText(/Seleccionar archivo Ekon/i)).toBeInTheDocument();
  });
});
