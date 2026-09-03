import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';

// --- Dobles de Firebase -----------------------------------------------------

type AuthCallback = (user: unknown) => void;

const onAuthStateChanged = vi.fn<(cb: AuthCallback) => () => void>();
const getIdTokenResult = vi.fn();
const getDoc = vi.fn();

vi.mock('@/services/firebase', () => ({
  isFirebaseConfigured: () => true,
  getFirebase: () => ({
    auth: { onAuthStateChanged },
    db: {},
  }),
}));

vi.mock('firebase/firestore', () => ({
  // `doc` solo compone una referencia; en el test no necesita comportamiento.
  doc: () => ({}),
  getDoc: (...args: unknown[]) => getDoc(...args),
}));

/** Componente sonda que expone el rol resuelto por el contexto. */
function RoleProbe() {
  const { user, loading } = useAuth();
  if (loading) return <span>cargando</span>;
  return <span>rol:{user?.role ?? 'sin-usuario'}</span>;
}

function mockMirrorRole(role: string | undefined) {
  getDoc.mockResolvedValue({
    exists: () => role !== undefined,
    data: () => (role === undefined ? undefined : { role }),
  });
}

const fbUser = { uid: 'u1', email: 'op@example.com', displayName: 'Op' };

beforeEach(() => {
  onAuthStateChanged.mockReset();
  getIdTokenResult.mockReset();
  getDoc.mockReset();
  // El observador entrega el usuario autenticado inmediatamente y devuelve un
  // desuscriptor. `getIdTokenResult` vive en el usuario de Firebase.
  onAuthStateChanged.mockImplementation((cb: AuthCallback) => {
    cb({ ...fbUser, getIdTokenResult });
    return () => {};
  });
});

describe('AuthProvider — reconciliación de rol', () => {
  it('fuerza el refresco del token cuando el espejo indica un rol más alto que el claim obsoleto', async () => {
    // Token abierto todavía sin el claim nuevo (operador recién asignado).
    getIdTokenResult.mockImplementation((forceRefresh?: boolean) =>
      Promise.resolve({
        claims: { role: forceRefresh ? 'operator' : undefined },
      }),
    );
    mockMirrorRole('operator');

    render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('rol:operator')).toBeInTheDocument(),
    );
    // Debe haberse forzado exactamente un refresco (segunda llamada con `true`).
    expect(getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('no fuerza refresco cuando el claim del token ya coincide con el espejo', async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: 'operator' } });
    mockMirrorRole('operator');

    render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('rol:operator')).toBeInTheDocument(),
    );
    expect(getIdTokenResult).not.toHaveBeenCalledWith(true);
  });

  it('conserva el rol del claim si no se puede leer el espejo (falla la lectura)', async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: 'operator' } });
    getDoc.mockRejectedValue(new Error('permiso denegado'));

    render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('rol:operator')).toBeInTheDocument(),
    );
    expect(getIdTokenResult).not.toHaveBeenCalledWith(true);
  });

  it('cae a viewer cuando no hay claim ni espejo con rol', async () => {
    getIdTokenResult.mockResolvedValue({ claims: {} });
    mockMirrorRole(undefined);

    render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('rol:viewer')).toBeInTheDocument(),
    );
    expect(getIdTokenResult).not.toHaveBeenCalledWith(true);
  });
});
