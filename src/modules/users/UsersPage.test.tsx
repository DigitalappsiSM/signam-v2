import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from './UsersPage';
import { listManagedUsers, setUserRole } from '@/services/users';
import type { ManagedUser } from '@/services/users';
import type { UserRole } from '@/domain';

const authState = { uid: 'me', role: 'admin' as UserRole };
vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: authState.uid,
      email: 'admin@signam.mx',
      displayName: null,
      role: authState.role,
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/users', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/users')>(
      '@/services/users',
    );
  return {
    ...actual,
    listManagedUsers: vi.fn(),
    setUserRole: vi.fn(),
  };
});

const mockList = vi.mocked(listManagedUsers);
const mockSet = vi.mocked(setUserRole);

const USERS: ManagedUser[] = [
  {
    uid: 'me',
    email: 'admin@signam.mx',
    displayName: 'Admin',
    role: 'admin',
    disabled: false,
    createdAt: 1,
  },
  {
    uid: 'u2',
    email: 'oper@signam.mx',
    displayName: 'Operador',
    role: 'operator',
    disabled: false,
    createdAt: 2,
  },
];

beforeEach(() => {
  authState.uid = 'me';
  authState.role = 'admin';
  mockList.mockReset();
  mockSet.mockReset();
  mockList.mockResolvedValue(USERS);
});

describe('UsersPage — acceso', () => {
  it('bloquea a usuarios sin permiso users.manage', () => {
    authState.role = 'operator';
    render(<UsersPage />);
    expect(
      screen.getByRole('heading', { name: /Solo para administradores/i }),
    ).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe('UsersPage — administración', () => {
  it('lista los usuarios con su rol actual', async () => {
    render(<UsersPage />);
    expect(await screen.findByText('oper@signam.mx')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // Encabezado + 2 usuarios.
    expect(rows).toHaveLength(3);
  });

  it('no permite cambiar el propio rol', async () => {
    render(<UsersPage />);
    await screen.findByText('oper@signam.mx');
    const selfRow = screen.getByText('admin@signam.mx').closest('tr')!;
    expect(
      within(selfRow).getByText(/No puedes cambiar tu propio rol/i),
    ).toBeInTheDocument();
    expect(within(selfRow).getByRole('combobox')).toBeDisabled();
  });

  it('cambia el rol de otro usuario y muestra confirmación', async () => {
    mockSet.mockResolvedValue({ ok: true, role: 'admin' });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('oper@signam.mx');

    const otherRow = screen.getByText('oper@signam.mx').closest('tr')!;
    const select = within(otherRow).getByRole('combobox');
    const saveBtn = within(otherRow).getByRole('button', { name: /Guardar/i });

    // Sin cambios, el botón está deshabilitado.
    expect(saveBtn).toBeDisabled();

    await user.selectOptions(select, 'admin');
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith('u2', 'admin'),
    );
    expect(
      await within(otherRow).findByText(/Rol actualizado/i),
    ).toBeInTheDocument();
  });

  it('muestra un error si la operación falla', async () => {
    mockSet.mockRejectedValue({ code: 'functions/permission-denied' });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('oper@signam.mx');

    const otherRow = screen.getByText('oper@signam.mx').closest('tr')!;
    await user.selectOptions(
      within(otherRow).getByRole('combobox'),
      'viewer',
    );
    await user.click(within(otherRow).getByRole('button', { name: /Guardar/i }));

    expect(
      await within(otherRow).findByText(/Solo un administrador/i),
    ).toBeInTheDocument();
  });
});
