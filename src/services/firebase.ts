import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
} from 'firebase/storage';
import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from 'firebase/functions';
import { appEnv } from './env';

/**
 * Adaptador de Firebase para SIGNAM V2.
 *
 * - Se inicializa de forma perezosa y solo si hay configuración válida por
 *   variables de entorno (`VITE_FIREBASE_*`).
 * - En desarrollo, si `VITE_USE_FIREBASE_EMULATORS=true`, se conecta a la
 *   Emulator Suite en lugar de a servicios reales.
 * - Nunca contiene credenciales productivas codificadas.
 */

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
}

let services: FirebaseServices | null = null;
let emulatorsConnected = false;

/** true si existe configuración de Firebase válida por variables de entorno. */
export function isFirebaseConfigured(): boolean {
  return appEnv.firebase !== null;
}

function connectEmulators(s: FirebaseServices): void {
  if (emulatorsConnected) return;
  const host = appEnv.emulatorHost;
  connectAuthEmulator(s.auth, `http://${host}:9099`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(s.db, host, 8080);
  connectStorageEmulator(s.storage, host, 9199);
  connectFunctionsEmulator(s.functions, host, 5001);
  emulatorsConnected = true;
}

/**
 * Devuelve los servicios de Firebase inicializados, o `null` si no hay
 * configuración. La inicialización ocurre una sola vez (singleton).
 */
export function getFirebase(): FirebaseServices | null {
  if (services) return services;
  if (!appEnv.firebase) return null;

  const app = initializeApp(appEnv.firebase);
  services = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
    functions: getFunctions(app),
  };

  if (appEnv.useEmulators) {
    connectEmulators(services);
  }

  return services;
}
