import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirebase } from './firebase';

/**
 * Operaciones de autenticación de SIGNAM V2 (correo/contraseña).
 *
 * Son envoltorios finos sobre Firebase Auth. El estado de sesión (usuario y
 * rol) lo expone `AuthProvider` mediante `onAuthStateChanged`; estas funciones
 * solo disparan el inicio/cierre de sesión.
 */

/** Inicia sesión con correo y contraseña. Lanza si Firebase no está configurado. */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  const fb = getFirebase();
  if (!fb) {
    throw new Error('Firebase no está configurado.');
  }
  await signInWithEmailAndPassword(fb.auth, email.trim(), password);
}

/** Cierra la sesión actual. No hace nada si Firebase no está configurado. */
export async function signOutCurrentUser(): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  await signOut(fb.auth);
}

/**
 * Traduce los códigos de error de Firebase Auth a mensajes claros en español.
 * Función pura: no depende de Firebase, por lo que es fácil de probar.
 */
export function authErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-email':
      return 'El correo electrónico no es válido.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera un momento e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de red. Revisa tu conexión e inténtalo de nuevo.';
    default:
      return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }
}
