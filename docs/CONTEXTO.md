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
│   ├── campaigns/        # diff de campañas (cambios vs BD) + Ekon
│   ├── operational-tracking/ # seguimiento operativo (estados, testigos, alertas)
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
- **CSV**: Admira ignora la **columna A**, que se usa como columna "guarda":
  vacía en los datos y con `LIVERPOOL` en `A1`. Las columnas reales empiezan en
  **B**, así que la fila 1 es `LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,
RESOLUCION,RETAILERS,Tipo de Pases` y cada fila de datos empieza con una celda
  vacía. Escape RFC 4180, UTF-8 con BOM. El encabezado **escrito** rotula la
  última columna como `Tipo de Pases`; la llave interna de las filas y el
  encabezado del maestro permanecen `TIPO DE PASES`.
- **Asociación campaña ↔ Ekon** (1–1): cada campaña puede tener a lo sumo un
  número de campaña Ekon y cada número pertenece a una sola campaña. Se guarda
  en colecciones separadas (`campaignEkonLinks`, `ekonCampaignNumbers`) que
  sobreviven a reimportaciones; la importación nunca las toca.

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
- **UX resumen → detalle** (no se despliega todo a la vez): tras subir el
  archivo aparece un **banner-titular fijo** (sticky) con las cifras clave
  (Nuevas · Modificadas · Eliminadas · Pendientes · Errores) y el botón
  **Aceptar y guardar cambios**. El resto es un **acordeón** de secciones
  colapsables (`Errores y advertencias`, `Clasificación operativa`, `Campañas
  modificadas`, `Campañas eliminadas`, `Campañas nuevas`, `Campañas detectadas`,
  `Diagnóstico del archivo`); cada una muestra su cifra en el encabezado y se
  expande bajo demanda. Lo **crítico** abre por defecto: errores/advertencias,
  clasificaciones pendientes, y campañas modificadas/eliminadas. Hay un control
  **Expandir todo / Colapsar todo** sobre el acordeón (el usuario puede seguir
  abriendo/cerrando cada sección a mano). El resumen numérico se calcula con la
  función pura `importSummary` y el control con `nextBulk` (ambas con pruebas).

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
- **Filtros**: búsqueda por nombre y periodo **Desde/Hasta** (`input date`),
  combinables, con botón **Limpiar filtros**. Una campaña aparece si su vigencia
  **intersecta** el periodo (límites inclusivos); un rango invertido
  (`Desde > Hasta`) muestra validación y no presenta resultados.
- Columna **`# campaña Ekon`**: muestra el número asociado o `—`. La edición se
  hace **solo dentro del modal de detalle** (input + **Guardar** +
  **Desvincular**), acepta enteros positivos seguros y pide **confirmación**
  antes de reemplazar una asociación existente.
- **Ordenamiento**: los encabezados de la tabla son **clicables** para ordenar
  por Campaña, Tipo, Inicio, Fin, # Ekon o Tiendas (asc/desc, con flecha
  indicadora). Lógica pura reutilizable en `src/lib/tableSort.ts`.
- Acciones **por campaña**: 🅿️ **PPT de evidencias** (`.pptx`, solo esa campaña),
  📄 **PDF de errores** (solo esa campaña), 👁️ **detalle** (soportes + tiendas +
  estado OK/incidencia + edición de Ekon), ⬇️ **menú de descargas CSV**.
- **PPT de evidencias** (`pptExport.ts`): plan puro `buildCampaignPptPlan` +
  serialización `buildCampaignPpt` (PptxGenJS por import dinámico). **Una
  diapositiva por pantalla física** (dedup por `screen.id`); portada con nombre
  Liverpool + vigencia; nombre oficial de tienda del catálogo, soporte
  solicitado y `ARTÍCULOS`; placeholder editable de foto. Diseño en la **gama
  rosa de Liverpool** con los **logotipos reales** (Liverpool e in-Store Media)
  en `src/assets/ppt/` (`logos.ts` los expone como data URL). Incluye **InStore
  Media** por tienda+soporte (a diferencia del CSV) con ARTÍCULOS de respaldo;
  reutiliza `normalizeStore`/`normalizeSupport` y la **excepción Guadalajara**
  (78 → CRIUS + CUADRADA). Diapositiva final de **incidencias** paginada solo si
  existen; no bloquea la descarga. Generación client-side; **sin persistencia**
  en Firebase/Storage por ahora.
- **PDF de errores** (`buildIssuesPdf`): diseño profesional con **franja de
  marca**, **sujeto** (campaña + calendario), **resumen ejecutivo en tarjetas**
  (incidencias · tipos · soportes afectados · tiendas afectadas), tablas
  **por tipo** y **por soporte** (con %), **detalle** completo y **pie de página
  numerado**, en **paleta azul**. El detalle incluye el **nombre de la tienda**
  (además del número), tomado del maestro (`Nombre de tienda`, indexado por
  número normalizado); las tiendas que no existen en el catálogo quedan como `—`.
  Si la campaña no tiene incidencias, muestra un estado **"Sin incidencias"**.
  Las funciones de datos son puras y con pruebas (`issueDetailRows`,
  `issuesSummaryMetrics`, `subjectCampaign`).
- **Menú de descargas CSV**: se renderiza como **capa flotante** (portal a
  `document.body`, `position: fixed`) para no quedar recortado por el overflow de
  la tabla; se coloca junto al botón (abre hacia abajo o hacia arriba) y se
  cierra al pulsar fuera, con Escape o al hacer scroll/resize. Su primera opción,
  **Descargar todos en ZIP**, empaqueta todas las resoluciones de la campaña en
  un ZIP (reutiliza `buildZip`, mismos nombres y contenido que las descargas
  individuales); el archivo se nombra **`<Campaña>_ Todas las resoluciones.zip`**.
  Después, un separador y las descargas individuales por resolución. Si la
  campaña no tiene consolidaciones, muestra **“Sin CSV”** y no ofrece ZIP.
- **Contadores**: reflejan los resultados filtrados. Sin filtros muestran los
  totales globales; con búsqueda o periodo activo muestran
  `N de total campañas · CSV visibles · incidencias visibles` (calculados solo a
  partir de las campañas visibles).
- Incidencias tipadas: `store-not-in-catalog`, `store-support-mismatch`,
  `screen-inactive`, `support-not-in-catalog`.
- El antiguo módulo separado "Exportación CSV" se **eliminó**: todo vive aquí.
  Los helpers de CSV/ZIP/PDF permanecen en `src/modules/exports/`.

### 6.4 Seguimiento operativo (`/seguimiento`)

- Sección independiente (no columnas nuevas en Campañas) con el estado operativo
  de cada campaña. Persistencia **separada** en
  `campaignOperationalTracking/{campaignKeyId}`: la importación **nunca** borra
  ni sobrescribe checks manuales, y el seguimiento **nunca** modifica la campaña
  importada. El `campaignKeyId` se deriva del `nameKey` (mismo criterio que
  Ekon); si el nombre normalizado cambia, es una campaña nueva y **empieza un
  seguimiento nuevo** (no se traslada el anterior).
- **Edición inline**: los indicadores se marcan **directamente como casillas en
  la tabla** de `/seguimiento` (sin abrir un modal). Cada casilla guarda al
  instante (quién/cuándo se ve en su tooltip). La clasificación se corrige con un
  **selector en la misma fila**.
- **Cinco indicadores** (editables): **Link de descarga**, **Validación
  Liverpool**, **Programación CSM**, **T Arranque** y **T Completos**.
  - **Link de descarga**: por defecto **automático** (marcado si `campaign.link`
    es una URL válida) pero **editable**. Si el usuario lo cambia, su valor manda
    (`source: manual`); mientras no lo toque, se deriva del link del calendario y
    se actualiza en reimportaciones.
  - **Validación Liverpool**: por defecto **marcada** si la campaña es
    Institucional **o** tiene link válido; editable (si la desmarcas, se
    respeta).
  - **CSM / T Arranque / T Completos**: manuales, inician desmarcados.
- **Marcar todas** (campañas terminadas): en las filas cuya `fechaFin` ya pasó
  (periodo **Terminada**) aparece un botón **"Marcar todas"** que marca los cinco
  indicadores de una sola vez (`source: manual`, con quién/cuándo). No aparece en
  campañas activas ni futuras.
- **Bitácora de comentarios**: cada campaña tiene un **historial** de comentarios
  (`comments[]`, cada uno con texto, autor y fecha) accesible desde un botón
  `💬 N` que despliega un panel inline bajo la fila. Los comentarios se agregan al
  final (orden cronológico) y **no** se borran ni editan desde el cliente. El
  documento de seguimiento se crea al vuelo si aún no existía al comentar o al
  usar "Marcar todas".
- **Clasificación Institucional/Proveedor**: automática si el `tipo` contiene
  `INSTITUCIONAL`/`PROVEEDOR` (ignorando mayúsculas/acentos); si es ambigua o
  vacía queda **pendiente**. Se define en la **importación** (selector con
  preselección; no se puede confirmar con clasificaciones pendientes) y puede
  corregirse luego con el selector inline en Seguimiento. En Seguimiento se
  **permite marcar casillas aunque la clasificación esté pendiente**: se usa
  Institucional como valor inicial editable (nunca se asume Proveedor). Una
  reimportación no cambia una clasificación ya existente de forma silenciosa.
- **Testigos** (confirmaciones manuales, sin evidencias ni tiendas individuales
  en esta fase): T Arranque confirma ≥ **10%** de las tiendas realmente
  consolidadas y vence al **5.º día hábil inclusivo** desde el inicio (solo se
  excluyen sábado/domingo; aún sin festivos). T Completos confirma el 100% y
  vence en `fechaFin`. Marcar T Completos marca también T Arranque; no se puede
  desmarcar T Arranque mientras T Completos siga marcado.
- **Objetivo del 10%** = `Math.ceil(tiendasDistintas * 0.10)` (tiendas
  **distintas** de las pantallas que realmente consolidaron; 0 tiendas → 0).
- **Fechas civiles**: todo el cálculo usa fechas civiles a medianoche UTC (sin
  desfases por zona horaria/DST). Si `fechaInicio`/`fechaFin` no se interpreta,
  se muestra estado `Fecha inválida` (no una alerta de vencimiento) y el check
  sigue editable.
- **Estados y alertas** con icono + texto (no solo color): `upcoming`,
  `on-track`, `due-soon` (2 días hábiles T Arranque / 5 naturales T Completos),
  `due-today`, `overdue`, `completed-on-time`, `completed-late`, `invalid-date`.
- El **Dashboard** deriva (no persiste) el resumen operativo: activas,
  seguimiento completo, en curso sin atrasos, con alertas y vencidas; alertas
  críticas ordenadas por urgencia; próximos vencimientos e inicios; y terminadas
  con pendientes. Cada alerta enlaza a la campaña en `/seguimiento`.
- **Ordenamiento**: los encabezados son **clicables** para ordenar por Campaña,
  Clasificación, Inicio, Fin, Tiendas, Objetivo, Estado general o Próximo
  vencimiento (asc/desc); las columnas de casillas y Acciones no ordenan.
- **Fechas**: se muestran en formato **`dd/mm/aaaa`** en **todos los módulos**
  (Campañas, Importar, Seguimiento y Dashboard) con los helpers puros
  `formatDdMmYyyy`/`formatCivilString`.
- **Permisos**: la matriz define `tracking.read` (todos los roles) y
  `tracking.write` (admin/operator). En la **fase pre-lanzamiento** —igual que el
  resto de colecciones— cualquier usuario **autenticado** puede editar el
  seguimiento (los custom claims de rol aún no están provisionados; forzar el rol
  dejaría al único usuario administrador sin poder editar). El control por rol
  (viewer solo lectura) se activará antes de liberar, sustituyendo `isSignedIn()`
  por la comprobación de `role` en `firestore.rules`. Se conservan ya las
  validaciones estructurales y la prohibición de **borrado físico**.
- **Auditoría**: por ahora la trazabilidad (quién/cuándo modificó y completó)
  vive **dentro** del documento de seguimiento. No existe todavía una bitácora
  global operativa; queda preparada la información para poblarla más adelante.

## 7. Pendientes / próximos pasos

- **Muppi's / ISM**: definir e implementar su lógica (hoy se excluyen).
- **Confirmar duplicado de encabezados** en el calendario: `Led Antea` vs
  `PANTALLAS LED ANTEA` (posible duplicación de Liverpool).
- **Roles reales** (admin/operator/viewer) en reglas de Firestore antes de
  liberar. Ya aplicado por **custom claims** en la colección de **seguimiento
  operativo**; el resto de colecciones sigue en modo autenticado (pre-lanzamiento).
- **Seguimiento operativo**: pendientes de fases siguientes — calendario de
  **festivos** para los días hábiles, **evidencias** de testigos y selección de
  **tiendas individuales**, y **bitácora global** de auditoría.
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
| Seguimiento operativo (estados, testigos, alertas) + Dashboard | ✅     |
| Muppi's / ISM · Festivos/evidencias · Historial global        | ⏳     |
