# Guía de configuración de SIGNAM V2

Esta guía explica cómo poner en marcha SIGNAM V2 en local y cómo conectar el
proyecto Firebase de trabajo.

> **Entorno de trabajo actual: producción (`signam-v2-prod`).** En esta etapa se
> trabaja directamente contra el proyecto de producción como entorno único. Los
> datos no son definitivos todavía: si algo sale mal, se vacía la base de datos
> y se reinicia. **No se libera al equipo hasta tener el flujo 100% probado.**
> Como no hay un proyecto de desarrollo separado, cualquier borrado afecta la
> única base existente: procede con esa consciencia. (El alias `dev` /
> `signam-v2-dev` sigue disponible en `.firebaserc` por si más adelante se
> quiere un entorno separado.)

> **Nota:** en la primera entrega **aún no existe pantalla de inicio de sesión**
> (el módulo de autenticación llega en una iteración posterior). Configurar
> Firebase ahora sirve para conectar la app, quitar el aviso de "configuración
> pendiente" y desplegar las reglas e índices de seguridad.

## Requisitos previos

- Node.js **>= 20** (probado con Node 22) y npm 10+.
- Una cuenta de Google con acceso a la [consola de Firebase](https://console.firebase.google.com/).
- (Para desplegar y usar emuladores) Firebase CLI:
  ```bash
  npm install -g firebase-tools
  ```

## Fase 0 — Obtener el código

```bash
git clone https://github.com/DigitalappsiSM/signam-v2.git
cd signam-v2
npm install
```

Si ya lo tienes clonado:

```bash
git checkout main && git pull
npm install
```

## Fase 1 — Crear el proyecto de producción

1. Entra a <https://console.firebase.google.com/> → **Agregar proyecto**.
2. Nombre: **`signam-v2-prod`** (es el proyecto `default` en `.firebaserc`).
3. Google Analytics es opcional; puedes desactivarlo.

## Fase 2 — Activar los servicios (plan Spark, gratis)

Se trabaja en el **plan Spark (gratuito, sin tarjeta)**. En esta etapa **no se
habilita Cloud Storage**: Storage (y Cloud Functions) requieren el plan Blaze, y
la app todavía no usa Storage. Se activarán cuando se implemente la carga de los
archivos Excel originales.

Dentro del proyecto:

1. **Authentication** → _Comenzar_ → _Sign-in method_ → habilita
   **Correo electrónico/contraseña**.
2. **Firestore Database** → _Crear base de datos_ → modo **producción** →
   elige región (p. ej. `nam5` / `us-central1`).
3. **Storage** → _omitir por ahora_ (requiere Blaze; no es necesario aún).

## Fase 3 — Registrar la app web y obtener `firebaseConfig`

1. _Configuración del proyecto_ (⚙️) → **Tus apps** → icono **`</>`** (Web).
2. Apodo: `signam-v2-web`. No marques Hosting todavía.
3. Copia el objeto `firebaseConfig` (apiKey, authDomain, projectId, …).

## Fase 4 — Crear tu archivo `.env`

```bash
cp .env.example .env
```

Completa `.env` con los valores de `firebaseConfig`:

```dotenv
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=signam-v2-prod.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=signam-v2-prod
VITE_FIREBASE_STORAGE_BUCKET=signam-v2-prod.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc...
VITE_USE_FIREBASE_EMULATORS=false
```

> `.env` está en `.gitignore`: **nunca se sube a Git**. Solo se versiona
> `.env.example`.

## Fase 5 — Ejecutar en local

```bash
npm run dev
```

Abre <http://localhost:5173>. El aviso amarillo de "Firebase no configurado"
debe desaparecer cuando las variables son válidas.

## Fase 6 — Desplegar reglas e índices de seguridad

```bash
firebase login
firebase use prod    # apunta a signam-v2-prod (también es el default)
firebase deploy --only firestore:rules,firestore:indexes
```

Esto publica `firestore.rules` y `firestore.indexes.json`.

> En el plan Spark **no se despliega `storage`** (Storage no está habilitado).
> Cuando se pase a Blaze y se active Storage, añade `,storage` al comando para
> publicar también `storage.rules`.

## Fase 7 (opcional) — Emulator Suite (desarrollo sin datos reales)

```bash
firebase emulators:start   # equivalente: npm run emulators
```

Y en `.env`:

```dotenv
VITE_USE_FIREBASE_EMULATORS=true
```

Puertos por defecto: Auth `9099`, Firestore `8080`, Storage `9199`,
Functions `5001`, Hosting `5000`, UI del emulador habilitada.

## Roles y permisos (custom claims)

Las reglas de Firestore/Storage resuelven el rol desde
`request.auth.token.role` (custom claims): `admin`, `operator`, `viewer`.

Los custom claims **no se asignan desde la consola de Firebase**: se establecen
con el Admin SDK (por ejemplo, desde una Cloud Function o un script con una
cuenta de servicio). Ejemplo de referencia (requiere una cuenta de servicio que
**no debe subirse a Git**):

```js
// scripts/setRole.mjs  (ejemplo; NO commitear la llave de servicio)
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp({ credential: cert('./serviceAccount.json') });

const uid = process.argv[2];
const role = process.argv[3]; // admin | operator | viewer
await getAuth().setCustomUserClaims(uid, { role });
console.log(`Rol '${role}' asignado a ${uid}`);
```

La asignación de roles desde la interfaz de administración forma parte de una
iteración posterior.

## Despliegue automático (GitHub Actions → Firebase Hosting)

El repositorio incluye `.github/workflows/deploy.yml`, que en cada push a `main`
compila la app y la publica en **Firebase Hosting** (`signam-v2-prod`), además de
desplegar las reglas e índices de Firestore. Así no se necesita usar la terminal:
basta con abrir la URL publicada.

**Configuración única (una sola vez):**

1. **Cuenta de servicio (Firebase):** consola de Firebase → ⚙️ _Configuración
   del proyecto_ → pestaña **Cuentas de servicio** → **Generar nueva clave
   privada** → se descarga un archivo `.json`.
2. **Secreto en GitHub:** repositorio en GitHub → **Settings** → **Secrets and
   variables** → **Actions** → **New repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: pega **todo el contenido** del `.json` descargado.
   - **Add secret**.
3. Borra el archivo `.json` de tu computadora (ya vive, cifrado, en GitHub).

> ⚠️ El `.json` de la cuenta de servicio **es una llave privada**: nunca se sube
> a Git ni se comparte por chat. Solo se pega en **GitHub → Secrets** (cifrado).

Con el secreto configurado, cada cambio en `main` se publica solo. También se
puede lanzar manualmente desde la pestaña **Actions** del repositorio
(_Deploy a Firebase Hosting_ → _Run workflow_).

### Despliegue manual (alternativa, requiere terminal)

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` ya está configurado para servir `dist/` como SPA (con reescritura
a `index.html`).

## Verificación rápida

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Todo debe pasar en verde antes de desplegar.
