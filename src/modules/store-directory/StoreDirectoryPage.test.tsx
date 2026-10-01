import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdmiraScreen, UserRole } from '@/domain';
import { listScreens } from '@/services/screens';
import {
  listStoreDirectory,
  type StoredDirectoryEntry,
} from '@/services/storeDirectory';
import { StoreDirectoryPage } from './StoreDirectoryPage';

const authState = { role: 'admin' as UserRole };
vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'me',
      email: 'admin@signam.mx',
      displayName: null,
      role: authState.role,
    },
    loading: false,
    configured: true,
  }),
}));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/storeDirectory', () => ({
  listStoreDirectory: vi.fn(),
  saveStoreEntry: vi.fn(),
  saveStoreDirectory: vi.fn(),
}));

const entry = (over: Partial<StoredDirectoryEntry>): StoredDirectoryEntry => ({
  storeNumber: '901',
  name: 'L PRUEBA NORTE',
  status: 'active',
  street: '',
  neighborhood: '',
  municipality: 'MONTERREY',
  state: 'Nuevo León',
  zone: 'Noreste',
  postalCode: '64000',
  lat: 25.67,
  lng: -100.3,
  coordinateSource: 'ekon',
  createdAt: 1,
  updatedAt: 1,
  updatedBy: 'x',
  ...over,
});

const screenOf = (store: string, name: string): AdmiraScreen =>
  ({
    id: store + name,
    original: { 'Numero de Tienda': store, 'Nombre de tienda': name },
    metadata: { active: true },
  }) as unknown as AdmiraScreen;

describe('StoreDirectoryPage', () => {
  beforeEach(() => {
    authState.role = 'admin';
    vi.mocked(listStoreDirectory).mockResolvedValue([
      entry({}),
      entry({
        storeNumber: '902',
        name: 'L SIN GPS',
        postalCode: null,
        lat: null,
        lng: null,
        coordinateSource: null,
      }),
    ]);
    vi.mocked(listScreens).mockResolvedValue([
      screenOf('0901', 'Prueba Norte'),
      screenOf('77', 'Tienda sin ficha'),
    ]);
  });

  it('muestra resumen, faltantes del catálogo y la tabla', async () => {
    render(
      <MemoryRouter>
        <StoreDirectoryPage />
      </MemoryRouter>,
    );
    const table = await screen.findByRole('table');
    expect(within(table).getByText('L PRUEBA NORTE')).toBeInTheDocument();
    expect(within(table).getByText('GPS Ekon')).toBeInTheDocument();
    expect(within(table).getByText('Sin coordenadas')).toBeInTheDocument();

    const coverage = screen.getByRole('region', {
      name: 'Cruce con el catálogo',
    });
    expect(within(coverage).getByText('Tienda sin ficha')).toBeInTheDocument();
    expect(within(coverage).getByText('L SIN GPS')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Importar Excel' }),
    ).toBeInTheDocument();
  });

  it('un rol de consulta no ve acciones de edición', async () => {
    authState.role = 'viewer';
    render(
      <MemoryRouter>
        <StoreDirectoryPage />
      </MemoryRouter>,
    );
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Importar Excel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });
});
