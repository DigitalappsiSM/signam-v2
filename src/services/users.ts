import { httpsCallable } from 'firebase/functions';
import type { UserRole } from '@/domain';
import { getFirebase } from './firebase';

/**
 * Administración de usuarios y roles.
 *
 * El rol efectivo vive en los custom claims del token de Firebase Auth y solo
 * se puede modificar con credenciales de administrador. Por eso este servicio
 * no toca Firestore directamente: invoca las Cloud Functions `users-listUsers`
 * y `users-setUserRole`, que validan que quien llama sea `admin`.
 */

/** Usuario administrable, tal como lo devuelve la función `listUsers`. */
export interface ManagedUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  /** Alta en Firebase Auth (epoch ms), si está disponible. */
  createdAt: number | null;
}

function functions() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.functions;
}

/** Lista los usuarios con su rol. Requiere rol admin (se valida en el servidor). */
export async function listManagedUsers(): Promise<ManagedUser[]> {
  const callable = httpsCallable<unknown, { users: ManagedUser[] }>(
    functions(),
    'users-listUsers',
  );
  const result = await callable();
  return result.data.users;
}

/** Cambia el rol de un usuario. Requiere rol admin (se valida en el servidor). */
export async function setUserRole(
  uid: string,
  role: UserRole,
): Promise<{ ok: true; role: UserRole }> {
  const callable = httpsCallable<
    { uid: string; role: UserRole },
    { ok: true; role: UserRole }
  >(functions(), 'users-setUserRole');
  const result = await callable({ uid, role });
  return result.data;
}

/**
 * Traduce los errores de las funciones callable a mensajes claros en español.
 * Función pura: fácil de probar sin Firebase.
 */
export function userAdminErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'functions/unauthenticated':
      return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    case 'functions/permission-denied':
      return 'Solo un administrador puede gestionar usuarios.';
    case 'functions/failed-precondition':
      return 'No puedes cambiar tu propio rol.';
    case 'functions/not-found':
      return 'El usuario ya no existe.';
    case 'functions/invalid-argument':
      return 'Datos inválidos para la operación.';
    default:
      return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
}
