import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { USER_ROLES, type UserRole } from '@/domain';
import { getFirebase, isFirebaseConfigured } from '@/services/firebase';

/** Type guard para el rol leído del espejo `users/{uid}` (dato no confiable). */
function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Contexto de autenticación de SIGNAM V2.
 *
 * Envuelve Firebase Authentication cuando está configurado. Si Firebase no está
 * configurado (p. ej. entorno de desarrollo sin `.env`), la app funciona en
 * modo degradado: no hay usuario y las vistas explican que falta configuración,
 * en lugar de fallar.
 */

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** Rol resuelto desde custom claims; `viewer` por defecto. */
  role: UserRole;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** true si existe configuración de Firebase por variables de entorno. */
  configured: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured());

  useEffect(() => {
    const firebase = getFirebase();
    if (!firebase) {
      setLoading(false);
      return;
    }

    let active = true;
    const unsubscribe = firebase.auth.onAuthStateChanged(async (fbUser) => {
      if (!active) return;
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        let token = await fbUser.getIdTokenResult();
        let role = (token.claims.role as UserRole | undefined) ?? 'viewer';

        // Reconcilia un claim de rol potencialmente obsoleto. Al reasignar un
        // rol, la Cloud Function fija el claim y revoca los refresh tokens, pero
        // el ID token que el usuario ya tiene abierto conserva el rol anterior
        // hasta que caduca (~1 hora). Mientras tanto las reglas de
        // Firestore/Storage (que leen `request.auth.token.role`) rechazan las
        // escrituras protegidas por rol —p. ej. importar Ekon/Digital/Catálogo—
        // aunque el panel ya muestre el rol nuevo. Si el espejo `users/{uid}`
        // (legible por el propio usuario) indica un rol distinto al del token,
        // se fuerza un refresco para adoptar el claim nuevo sin obligar a cerrar
        // sesión manualmente.
        try {
          const mirror = await getDoc(doc(firebase.db, 'users', fbUser.uid));
          const mirrorRole = mirror.exists() ? mirror.data()?.role : undefined;
          if (isUserRole(mirrorRole) && mirrorRole !== role) {
            token = await fbUser.getIdTokenResult(true);
            role = (token.claims.role as UserRole | undefined) ?? 'viewer';
          }
        } catch {
          // Sin acceso al espejo (permisos/red): se conserva el rol del claim
          // actual. El peor caso es el comportamiento previo a esta reconciliación.
        }

        if (!active) return;
        setUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          role,
        });
      } catch (error) {
        // Falla transitoria al leer el token (red/autenticación): en lugar de
        // dejar la app colgada en "cargando" o presentar al usuario como sin
        // sesión, se degrada al rol mínimo (viewer) y se libera el estado.
        console.error('No se pudo leer el token de autenticación:', error);
        if (!active) return;
        setUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          role: 'viewer',
        });
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, configured: isFirebaseConfigured() }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}
