/**
 * Lectura tipada y validada de variables de entorno de Vite.
 *
 * La configuración de Firebase NUNCA se codifica en el repositorio: se lee de
 * variables `VITE_FIREBASE_*` documentadas en `.env.example`. Si faltan valores
 * obligatorios, la app arranca en modo degradado (sin Firebase) en lugar de
 * usar credenciales inventadas.
 */

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface AppEnv {
  firebase: FirebaseEnvConfig | null;
  useEmulators: boolean;
  emulatorHost: string;
}

const REQUIRED_KEYS: Array<keyof FirebaseEnvConfig> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

function readFirebaseConfig(
  env: Record<string, string | undefined>,
): FirebaseEnvConfig | null {
  const config: FirebaseEnvConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };

  const complete = REQUIRED_KEYS.every((key) => config[key].trim() !== '');
  return complete ? config : null;
}

/** Construye la configuración de la app a partir de un mapa de variables. */
export function resolveAppEnv(env: Record<string, string | undefined>): AppEnv {
  return {
    firebase: readFirebaseConfig(env),
    useEmulators: env.VITE_USE_FIREBASE_EMULATORS === 'true',
    emulatorHost: env.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1',
  };
}

/** Configuración efectiva leída de `import.meta.env` en tiempo de ejecución. */
export const appEnv: AppEnv = resolveAppEnv(
  import.meta.env as unknown as Record<string, string | undefined>,
);
