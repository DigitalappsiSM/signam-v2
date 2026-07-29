import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { UserRole } from '@/domain';
import { getFirebase, isFirebaseConfigured } from '@/services/firebase';

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
        const token = await fbUser.getIdTokenResult();
        const role = (token.claims.role as UserRole | undefined) ?? 'viewer';
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
