# SIGNAM V2

Aplicación web para operar el flujo de programación de pantallas entre
**Liverpool** y **Admira CSM**:

1. Importar y validar el **Calendario de Campañas** descargado de Liverpool.
2. Administrar un **catálogo editable** que representa la configuración de Admira CSM.
3. Agregar, editar, inactivar y reactivar pantallas.
4. Cruzar campañas Liverpool contra las pantallas activas del catálogo.
5. **Consolidar por resolución** (`Campaña + RESOLUCION`).
6. Generar los **CSV de programación** de Admira.
7. **Seguimiento operativo** por campaña (clasificación Institucional/Proveedor,
   link, validación, programación CSM y testigos con fechas límite y alertas),
   más un **Dashboard** con el resumen y las alertas críticas.
8. Guardar archivos, versiones, cambios, exportaciones y auditoría en **Firebase**.

> Esta es la primera entrega: establece **arquitectura, modelos, seguridad y
> pruebas**. La lógica de negocio (parser de Excel, motor de consolidación,
> generación completa de CSV) se implementa en iteraciones posteriores. Los
> módulos de la UI muestran explícitamente el alcance pendiente.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + React Router.
- **Pruebas**: Vitest + Testing Library (jsdom).
- **Calidad**: ESLint (flat config) + Prettier + `tsc` strict.
- **Backend**: Firebase (Auth, Firestore, Storage, Functions, Hosting) con
  Emulator Suite y reglas/índices versionados.

## Requisitos

- Node.js >= 20 (probado con Node 22).
- npm 10+.
- (Opcional) Firebase CLI para emuladores y despliegue: `npm i -g firebase-tools`.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completa las variables VITE_FIREBASE_*
npm run dev            # http://localhost:5173
```

> Guía detallada de configuración de Firebase (crear `signam-v2-dev`, servicios,
> `.env`, reglas, emuladores y roles): [`docs/SETUP.md`](./docs/SETUP.md).

Sin configuración de Firebase la app arranca en **modo degradado**: la interfaz
funciona y el panel indica que faltan las variables `VITE_FIREBASE_*`. No se
usan credenciales inventadas.

## Scripts

| Script                  | Descripción                             |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | Servidor de desarrollo (Vite).          |
| `npm run build`         | Typecheck + build de producción.        |
| `npm run preview`       | Sirve el build de producción.           |
| `npm run typecheck`     | Comprobación de tipos (`tsc --noEmit`). |
| `npm run lint`          | ESLint (0 warnings permitidos).         |
| `npm run format`        | Formatea con Prettier.                  |
| `npm run format:check`  | Verifica formato sin escribir.          |
| `npm run test`          | Ejecuta las pruebas (Vitest).           |
| `npm run test:coverage` | Pruebas con reporte de cobertura.       |
| `npm run emulators`     | Inicia la Firebase Emulator Suite.      |

## Variables de entorno

Documentadas en [`.env.example`](./.env.example). Nunca se confirman `.env`,
cuentas de servicio, llaves privadas ni tokens.

| Variable                            | Descripción                                   |
| ----------------------------------- | --------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | API key del proyecto Firebase.                |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Dominio de autenticación.                     |
| `VITE_FIREBASE_PROJECT_ID`          | ID del proyecto (`signam-v2-dev`).            |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Bucket de Cloud Storage.                      |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID.                                    |
| `VITE_FIREBASE_APP_ID`              | App ID web.                                   |
| `VITE_USE_FIREBASE_EMULATORS`       | `true` para usar la Emulator Suite.           |
| `VITE_FIREBASE_EMULATOR_HOST`       | Host de emuladores (por defecto `127.0.0.1`). |

## Estructura

```text
src/
├── app/            # Composición de la app: rutas, permisos, providers
│   └── providers/  # AuthProvider (Firebase Auth + modo degradado)
├── components/     # Componentes reutilizables (layout, encabezados)
├── modules/        # Módulos de negocio (una carpeta por sección de la UI)
│   ├── dashboard/
│   ├── liverpool-import/
│   ├── admira-catalog/
│   ├── campaigns/
│   ├── exports/
│   └── audit/
├── domain/         # Modelos y lógica pura (sin dependencias de framework)
├── services/       # Adaptadores externos (Firebase, entorno)
├── styles/         # Estilos globales
└── tests/          # Pruebas de integración de la app

functions/
└── src/            # Cloud Functions: imports, consolidation, exports, audit
```

## Dominio y reglas confirmadas

La carpeta `src/domain` implementa (y prueba) las reglas ya definidas:

- **Separación de soportes** (`support.ts`): todos los soportes del calendario
  son de Liverpool **excepto** `MUPPI'S` y `PENDON` (InStore Media), que se
  detectan pero se excluyen de la consolidación en esta etapa.
- **Nombre de campaña Admira** (`campaignName.ts`): formato
  `<Campaña Liverpool>_ <ARTICULOS>`; múltiples artículos distintos se
  concatenan con `+`, deduplicando y conservando el orden de aparición.
- **Llave de consolidación** (`consolidationKey.ts`): `Campaña + RESOLUCION`.
  No se separa por circuito, soporte, `ARTICULOS` ni `TIPO DE PASES`.
- **Serialización CSV de Admira** (`csv.ts`): Admira ignora la primera columna,
  por lo que la columna A se usa como columna "guarda" (vacía en los datos, con
  `LIVERPOOL` en `A1`) y las columnas reales empiezan en B. La fila 1 es
  `LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases`.
  Orden de columnas reales confirmado
  `ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,TIPO DE PASES`, escape
  RFC 4180 y UTF-8 con BOM opcional. `RETAILERS` es constante = `LIVERPOOL`. El
  encabezado escrito rotula la última columna como `Tipo de Pases`; la llave
  interna y el encabezado del maestro siguen siendo `TIPO DE PASES`.
- **Encabezados del catálogo** (`constants.ts`): orden autoritativo del maestro.
  El encabezado definitivo es `TIPO DE PASES`; la estructura antigua `Pases` se
  reporta como faltante en lugar de corregirse en silencio.

## Firebase

Se usa un proyecto **nuevo**, sin reutilizar `signam-produccion`:

- Producción (entorno de trabajo actual y `default` en `.firebaserc`): `signam-v2-prod`
- Desarrollo (alias `dev`, opcional para más adelante): `signam-v2-dev`

> En esta etapa se trabaja directamente contra producción como entorno único;
> los datos no son definitivos y pueden reiniciarse hasta validar el flujo por
> completo. Ver [`docs/SETUP.md`](./docs/SETUP.md).

Archivos versionados: `firebase.json`, `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `.firebaserc`.

### Roles y seguridad

Los roles se resuelven desde los **custom claims** del token
(`request.auth.token.role`): `admin`, `operator`, `viewer`. La matriz de
permisos del cliente (`src/app/permissions.ts`) es solo para la UI; las
**reglas de Firestore y Storage** son la fuente de verdad del control de acceso
(ocultar botones no es suficiente).

| Acción                      | admin | operator | viewer |
| --------------------------- | :---: | :------: | :----: |
| Leer catálogo               |   ✓   |    ✓     |   ✓    |
| Editar / inactivar catálogo |   ✓   |          |        |
| Importar calendarios        |   ✓   |    ✓     |        |
| Exportar CSV                |   ✓   |    ✓     |        |
| Administrar usuarios        |   ✓   |          |        |

### Emuladores

```bash
npm run emulators
# En .env: VITE_USE_FIREBASE_EMULATORS=true
```

Puertos: Auth `9099`, Firestore `8080`, Storage `9199`, Functions `5001`,
Hosting `5000`, UI habilitada.

## Integración continua

`.github/workflows/ci.yml` ejecuta en cada push a `main` y en cada pull request:
formato, lint, typecheck, pruebas y build del frontend, y build de las Cloud
Functions.

## Pendientes (siguientes iteraciones)

- Parser de Excel y validación estructural del calendario Liverpool
  (detección de hoja/encabezados, comentarios de celdas, reporte de incidencias).
- Importación y comparación de versiones del maestro Admira.
- Motor de consolidación (excepción de Guadalajara Galerías incluida).
- Generación completa de CSV/ZIP con snapshot inmutable por exportación.
- Bitácora de auditoría poblada desde Cloud Functions.

## Datos empresariales

No se confirman archivos empresariales (`Calendario de Campañas ISM.xlsx`,
`MAESTRO.xlsx`) en Git. Las pruebas usan **fixtures sintéticos/anonimizados**.
