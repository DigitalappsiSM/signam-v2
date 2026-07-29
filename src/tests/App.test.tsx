import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { AuthProvider } from '@/app/providers/AuthProvider';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('muestra la navegación de los módulos principales', () => {
    renderAt('/');
    const nav = within(
      screen.getByRole('navigation', { name: /Navegación principal/i }),
    );
    expect(
      nav.getByRole('link', { name: /Importar Calendario/i }),
    ).toBeInTheDocument();
    expect(
      nav.getByRole('link', { name: /Catálogo Admira/i }),
    ).toBeInTheDocument();
    expect(nav.getByRole('link', { name: /Campañas/i })).toBeInTheDocument();
    expect(
      nav.getByRole('link', { name: /Exportación CSV/i }),
    ).toBeInTheDocument();
    expect(nav.getByRole('link', { name: /Historial/i })).toBeInTheDocument();
  });

  it('sin Firebase configurado, muestra el aviso de configuración', () => {
    renderAt('/');
    expect(
      screen.getByText(/Firebase no está configurado/i),
    ).toBeInTheDocument();
  });

  it('renderiza la página de exportación con el layout CSV confirmado', () => {
    renderAt('/exportar');
    expect(
      screen.getByText(
        'ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,TIPO DE PASES',
      ),
    ).toBeInTheDocument();
  });

  it('muestra 404 en rutas desconocidas', () => {
    renderAt('/ruta-inexistente');
    expect(
      screen.getByRole('heading', { name: /Página no encontrada/i }),
    ).toBeInTheDocument();
  });
});
