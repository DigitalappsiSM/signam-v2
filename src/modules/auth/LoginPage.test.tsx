import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { signInWithEmail } from '@/services/auth';

vi.mock('@/services/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/auth')>('@/services/auth');
  return {
    ...actual,
    signInWithEmail: vi.fn(),
  };
});

const signInMock = vi.mocked(signInWithEmail);

beforeEach(() => {
  signInMock.mockReset();
});

describe('LoginPage', () => {
  it('deshabilita el botón hasta que hay correo y contraseña', async () => {
    render(<LoginPage />);
    const button = screen.getByRole('button', { name: /Ingresar/i });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Correo/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/Contraseña/i), 'secret');
    expect(button).toBeEnabled();
  });

  it('llama a signInWithEmail con las credenciales ingresadas', async () => {
    signInMock.mockResolvedValueOnce(undefined);
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/Correo/i), 'admin@signam.mx');
    await userEvent.type(screen.getByLabelText(/Contraseña/i), 'clave123');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/i }));

    expect(signInMock).toHaveBeenCalledWith('admin@signam.mx', 'clave123');
  });

  it('muestra un mensaje de error si las credenciales son inválidas', async () => {
    signInMock.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/Correo/i), 'admin@signam.mx');
    await userEvent.type(screen.getByLabelText(/Contraseña/i), 'mala');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Correo o contraseña incorrectos/i,
      );
    });
  });
});
