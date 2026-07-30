# SIGNAM V2 — Contexto completo del proyecto

> Documento vivo con todo el contexto, decisiones y lo construido hasta ahora.
> Complementa a `README.md`, `AGENTS.md` y `docs/SETUP.md`.

## 1. Objetivo

Herramienta web para operar la programación de pantallas entre **Liverpool** y
**Admira CSM**:

1. Importar y validar el **Calendario de Campañas** de Liverpool (`.xlsx`/`.xls`).
2. Administrar un **catálogo editable** que representa la configuración de Admira
   (el **maestro** es la **verdad absoluta** de qué pantallas existen).
3. Agregar, editar, inactivar/reactivar y eliminar pantallas.
4. Cruzar campañas Liverpool contra las **pantallas activas** del catálogo.
5. **Consolidar por resolución** (`Campaña + RESOLUCION`).
6. Generar los **CSV de programación** de Admira (+ ZIP) y un **reporte PDF** de
   incidencias para Liverpool.
7. Guardar campañas, cambios y (a futuro) auditoría en **Firebase**.

## 2. Stack y arquitectura

- **Frontend**: React 18 + TypeScript + Vite + React Router (SPA).
- **Estado/UX**: componentes por módulo, formularios validados, diseño
  responsive.
- **Backend**: Firebase — **Authentication** (correo/contraseña), **Cloud
  Firestore**, Hosting. (Storage y Functions **no** se usan aún: requieren plan
  Blaze; ver §7.)
- **Lectura de Excel**: `xlsx` (SheetJS) para el calendario (tolera `.xls`
  antiguos) y `exceljs` para el maestro. Ambos con import dinámico.
- **Exportación**: `jszip` (ZIP de CSV) y `jspdf` + `jspdf-autotable` (PDF).
  Todo client-side, import dinámico.
- **Pruebas**: Vitest + Testing Library (116 pruebas al momento de escribir).
- **Calidad**: ESLint (flat) + Prettier + `tsc` strict.

### Estructura

```
src/
├── app/                  # rutas, permisos, AuthProvider
├── components/           # layout, StatusScreen, PageHeader
├── domain/               # modelos y lógica pura (constantes, csv, soportes…)
├── modules/
│   ├── auth/             # LoginPage
│   ├── admira-catalog/   # catálogo: tabla, formulario, import maestro, filtros
│   ├── liverpool-import/ # inspector del calendario + parseo de campañas + guardado
│   ├── consolidation/    # motor de consolidación (cruce → CSV)
│   ├── campaigns/        # diff de campañas (cambios vs BD)
│   ├── exports/          # CSV/ZIP + reporte PDF
│   ├── dashboard/ audit/ # panel e historial (placeholder)
└── services/             # firebase, auth, screens, campaigns, env
functions/                # estructura de Cloud Functions (pendiente de uso)
```

## 3. Infraestructura y despliegue

- **Proyecto Firebase**: `signam-v2-prod` (entorno único de trabajo en esta
  etapa; alias `dev`/`signam-v2-dev` disponible para el futuro).
- **App en vivo**: <https://signam-v2-prod.web.app>
- **Despliegue automático**: `.github/workflows/deploy.yml` — cada push a `main`
  compila y publica en Firebase Hosting y despliega reglas/índices de Firestore.
  Requiere el secreto `FIREBASE_SERVICE_ACCOUNT` (rol Editor).
- **CI**: `.github/workflows/ci.yml` — formato, lint, typecheck, test, build.
- **Config**: variables `VITE_FIREBASE_*` (ver `.env.example`); en CI se inyectan
  en el build. La `apiKey` web es pública (no es secreto).
- **Plan Spark (gratis)**: Auth + Firestore + Hosting. Sin Storage por ahora.

## 4. Roles y seguridad

- Roles previstos: **admin / operator / viewer** (`src/app/permissions.ts`).
- **Fase actual (pre-lanzamiento):** las reglas de Firestore permiten a
  cualquier usuario autenticado leer/escribir las colecciones de trabajo (app
  privada, por invitación). El control por rol se aplicará antes de liberar al
  equipo. Ver `firestore.rules`.
- Usuarios se crean en Firebase Console → Authentication.

## 5. Decisiones de negocio confirmadas

- **El maestro es la verdad absoluta**: si Liverpool asigna una tienda/soporte
  que no existe en el catálogo, se **reporta como incidencia y se excluye**;
  nunca se fuerza.
- **`RETAILERS` = `LIVERPOOL`** (constante en todas las filas del CSV).
- **Mapeo calendario↔catálogo**: columna del maestro **`NORMALIZACION
LIVERPOOL`** (metadato `calendarSupport`; también acepta `SOPORTE
LIVERPOOL`/`CALENDARIO`/`ISM`). El cruce es por **`Numero de Tienda` +
  `NORMALIZACION LIVERPOOL`**.
- **Números de tienda**: se normalizan quitando ceros a la izquierda
  (`0078` = `78`).
- **"Asignada" sin comentario**: si una celda de soporte dice “Asignada” pero
  **no** trae comentario de tiendas, se asigna a **todas las pantallas activas
  de ese soporte** (todas las tiendas).
- **InStore Media** (`MUPPI'S`, `PENDON`) e **ISM** (`TIPO DE pantallas`
  contiene `ISM`): se **detectan y excluyen** de la consolidación Liverpool
  (lógica propia pendiente de definir).
- **Excepción de Guadalajara Galerías**: tienda **78** + `VIDEO WALL CRIUS`
  incluye además la configuración `CUADRADA` (900 × 900).

### Reglas de dominio (implementadas y probadas)

- **Encabezados del maestro** (12 oficiales, orden autoritativo); `TIPO DE PASES`
  es el definitivo — la estructura antigua `Pases` se reporta, no se corrige.
- **Nombre de campaña Admira**: `"<Campaña>_ <ARTICULOS>"`; varios artículos con
  `+`, deduplicados y en orden de aparición.
- **Consolidación**: llave `Campaña + RESOLUCION` (no separa por circuito,
  soporte, `ARTICULOS` ni `TIPO DE PASES`).
- **CSV**: `ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases`,
  escape RFC 4180, UTF-8 con BOM.

## 6. Flujos de la aplicación

### 6.1 Catálogo Admira

- Tabla con búsqueda (tolerante a acentos/mayúsculas) y filtros (estado, tienda,
  modelo, resolución). Columna **Normalización Liverpool**.
- Agregar/editar (formulario con los 12 campos + campo de normalización).
- Inactivar/Reactivar (con motivo, conserva historial) y **Eliminar**
  (permanente, para limpiar registros de prueba/errados).
- **Importar maestro (.xlsx)**: detecta hoja `Consolidado`, valida encabezados,
  captura `NORMALIZACION LIVERPOOL`, vista previa e incidencias, y opción
  **Agregar** o **Reemplazar todo**.

### 6.2 Importar Calendario

- Sube el calendario; **inspector** muestra hojas, encabezados, comentarios y
  soportes InStore.
- **Parseo de campañas** (matriz: fila = campaña, columnas = soportes,
  comentarios = tiendas `número⇥nombre`; se captura también `LINK`).
- **Persistencia con confirmación**: se comparan las campañas contra la base de
  datos y se muestra un panel de **cambios** (nuevas / modificadas / eliminadas
  / sin cambios) con el detalle (vigencias, link, tiendas por soporte, etc.).
  **Solo se escribe tras aceptar**; si no hay cambios, no se reescribe nada.

### 6.3 Campañas (vista consolidada)

- Lista las campañas guardadas (nombre, **tipo de campaña**, vigencias,
  **Contenido**: botón _Descargar contenido_ con el `LINK`, o _Link pendiente_,
  y **nº de tiendas** realmente incluidas tras la consolidación). El detalle de
  soportes/tiendas se consulta con el icono 👁️ (columna "Soportes Liverpool"
  eliminada de la tabla para no ocultar las acciones).
- La columna **Tiendas** cuenta las **tiendas distintas realmente incluidas**
  (derivadas de las pantallas consolidadas), por lo que refleja correctamente el
  caso "Asignada sin comentario" (tiendas tomadas del catálogo).
- Consolida contra las pantallas activas del catálogo (`Campaña + RESOLUCION`).
- Acciones **por campaña**: 📄 **PDF de errores** (solo esa campaña), 👁️
  **detalle** (soportes + tiendas + estado OK/incidencia), ⬇️ **descargar cada
  CSV**.
- Incidencias tipadas: `store-not-in-catalog`, `store-support-mismatch`,
  `screen-inactive`, `support-not-in-catalog`.
- El antiguo módulo separado "Exportación CSV" se **eliminó**: todo vive aquí.
  Los helpers de CSV/ZIP/PDF permanecen en `src/modules/exports/`.

## 7. Pendientes / próximos pasos

- **Muppi's / ISM**: definir e implementar su lógica (hoy se excluyen).
- **Confirmar duplicado de encabezados** en el calendario: `Led Antea` vs
  `PANTALLAS LED ANTEA` (posible duplicación de Liverpool).
- **Roles reales** (admin/operator/viewer) en reglas de Firestore antes de
  liberar.
- **Historial/auditoría** e **snapshot inmutable de exportaciones** en Firestore
  (y Storage para archivos originales cuando se habilite Blaze).
- **Storage/Functions** (requieren plan Blaze).

## 8. Estado (resumen)

| Módulo                                                        | Estado |
| ------------------------------------------------------------- | ------ |
| App + Login + Firestore + deploy automático                   | ✅     |
| Catálogo (CRUD, importar/reemplazar, eliminar, normalización) | ✅     |
| Calendario (inspector, campañas, tiendas)                     | ✅     |
| Persistencia de campañas con confirmación de cambios          | ✅     |
| Consolidación + CSV + ZIP + incidencias + PDF                 | ✅     |
| Muppi's / ISM · Roles · Historial                             | ⏳     |
