import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthContextValue } from '@/app/providers/AuthProvider';
import { App } from '@/app/App';

// Estado de autenticación controlable para las pruebas.
const authState: AuthContextValue = {
  user: null,
  loading: false,
  configured: true,
};

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function signIn() {
  authState.user = {
    uid: 'u1',
    email: 'admin@signam.mx',
    displayName: null,
    role: 'admin',
  };
}

beforeEach(() => {
  authState.user = null;
  authState.loading = false;
  authState.configured = true;
});

describe('App — control de acceso', () => {
  it('muestra un estado de carga mientras se resuelve la sesión', () => {
    authState.loading = true;
    renderAt('/');
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument();
  });

  it('muestra el inicio de sesión cuando no hay usuario', () => {
    renderAt('/');
    expect(
      screen.getByRole('heading', { name: /Iniciar sesión/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo electrónico/i)).toBeInTheDocument();
  });

  it('avisa si Firebase no está configurado', () => {
    authState.configured = false;
    renderAt('/');
    expect(
      screen.getByRole('heading', { name: /Firebase no está configurado/i }),
    ).toBeInTheDocument();
  });
});

describe('App — con sesión activa', () => {
  it('muestra la navegación de los módulos y el rol del usuario', () => {
    signIn();
    renderAt('/');
    const nav = within(
      screen.getByRole('navigation', { name: /Navegación principal/i }),
    );
    expect(
      nav.getByRole('link', { name: /Importar Calendario/i }),
    ).toBeInTheDocument();
    expect(
      nav.getByRole('link', { name: /Seguimiento operativo/i }),
    ).toBeInTheDocument();
    expect(
      nav.getByRole('link', { name: /Alertas de baja ocupación/i }),
    ).toBeInTheDocument();
    expect(nav.getByRole('link', { name: /Historial/i })).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Cerrar sesión/i }),
    ).toBeInTheDocument();
  });

  it('ya no muestra el módulo "Exportación CSV" en la navegación', () => {
    signIn();
    renderAt('/');
    const nav = within(
      screen.getByRole('navigation', { name: /Navegación principal/i }),
    );
    expect(
      nav.queryByRole('link', { name: /Exportación CSV/i }),
    ).not.toBeInTheDocument();
    expect(nav.getByRole('link', { name: /Campañas/i })).toBeInTheDocument();
  });

  it('muestra 404 en rutas desconocidas', () => {
    signIn();
    renderAt('/ruta-inexistente');
    expect(
      screen.getByRole('heading', { name: /Página no encontrada/i }),
    ).toBeInTheDocument();
  });
});
