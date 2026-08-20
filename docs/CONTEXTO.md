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
7. **Alertas de baja ocupación**: detectar pantallas con baja variedad de
   proveedores para una fecha y generar CSV auxiliares **Ratio 1 / Ratio 3**.
8. Guardar campañas, cambios y (a futuro) auditoría en **Firebase**.

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
│   ├── consolidation/    # motor de consolidación (cruce → CSV; helpers reutilizables)
│   ├── campaigns/        # diff de campañas (cambios vs BD) + Ekon
│   ├── low-occupancy/    # alertas de baja ocupación → CSV Ratio 1 / Ratio 3
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
- **Asociación campaña ↔ Ekon** (muchos-a-uno): cada campaña puede tener a lo
  sumo un número de campaña Ekon, pero un mismo número puede repetirse en varias
  campañas. No se bloquea la unicidad: al reutilizar un número, la UI avisa en
  qué otras campañas ya está y pide confirmación antes de guardar. Se guarda en
  la colección separada `campaignEkonLinks` que sobrevive a reimportaciones; la
  importación nunca la toca.

## 6. Flujos de la aplicación

### 6.0 Identidad visual (panel analítico, claro/oscuro)

- Sistema de diseño **glassmorphism** definido por tokens en
  `src/styles/global.css`: superficies de "chrome" translúcidas con desenfoque
  (`--glass-*`) sobre un **fondo ambiental fijo** (`body::before`) que combina
  base, dos resplandores de marca y una **malla de puntos** tenue que evoca las
  pantallas de señalización (LED).
- **Base azul + detalle magenta.** Inspirado en un panel analítico oscuro, el
  color de **acción/base es azul** (`--color-primary`) y el **magenta Liverpool**
  (`--color-magenta`, mismo rosa de la PPT) se reserva como **acento puntual de
  marca** (logotipo, barra del enlace activo, marcador de pico, intensidad de la
  matriz, selección). El resto se mantiene sobrio para no competir.
- **Tema claro y oscuro con interruptor.** Los mismos tokens tienen variante
  oscura en `:root[data-theme='dark']`. El tema se gestiona en `src/app/theme.ts`
  (persistencia en `localStorage`, respeta `prefers-color-scheme` si no hay
  preferencia, e `initTheme()` en `main.tsx` evita el parpadeo). El **toggle**
  vive en la topbar; `applyTheme` escribe `data-theme` y `color-scheme` en
  `<html>`, por lo que **todos los módulos** (incluido el login) cambian de tema.
- **Shell tipo panel:** topbar con marca, **pill "En línea"**, toggle de tema y
  **chip de usuario** (avatar + rol); **barra lateral agrupada** por secciones
  (Operación · Datos · Campañas · Administración) desde `NAV_ROUTES` (campo
  `group`).
- Se aplica de forma transversal reutilizando clases compartidas (`.card`,
  `.btn`, `.badge`, `.catalog__table`, topbar/sidebar, modales, menús); las
  tablas e inputs se mantienen **nítidos** para densidad de datos. Respeta foco
  visible por teclado.
- **Gráficas con Apache ECharts** (`echarts`), cargadas por **import dinámico**
  (chunk aparte, fuera del bundle inicial) mediante el envoltorio
  `src/components/charts/EChart.tsx`. La paleta por tema está en
  `chartTheme.ts`. El contenedor expone `role="img"` accesible y omite el render
  sin canvas real (p. ej. jsdom en pruebas). Ver §6.5.

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
- **Fechas sin ambigüedad día/mes**: las celdas de **fecha reales** de Excel se
  leen por su valor (no por el texto formateado, que puede venir mes-primero) y
  se guardan como ISO `AAAA-MM-DD`; la app las muestra en `dd/mm/aaaa`. Así se
  evita el intercambio día↔mes (p. ej. 5 oct visto como 10 may).
- **Fechas de texto ambiguas → confirmación con memoria**: una fecha escrita
  como **texto** `A/B/AAAA` con ambos componentes ≤ 12 (no se sabe si es
  día/mes o mes/día) se marca en el panel **“Fechas por confirmar”**; el
  guardado se **bloquea** hasta que el usuario elige la interpretación (viendo
  ambas lecturas). La elección se **persiste** (`dateResolutions`, clave = la
  cadena cruda) y en reimportaciones se **aplica sola** (no se vuelve a
  preguntar ni se pierde). Lógica pura en `dateAmbiguity.ts`
  (`isAmbiguousDate` / `interpretDate`).
- **Persistencia con confirmación**: se comparan las campañas contra la base de
  datos y se muestra un panel de **cambios** (nuevas / modificadas / eliminadas
  / sin cambios) con el detalle (vigencias, link, tiendas por soporte, etc.).
  **Solo se escribe tras aceptar**; si no hay cambios, no se reescribe nada.
- **ID canónico y huella.** `campaign.id` es la identidad persistente de cada
  flight. `campaignIdentity(c)` = nombre + todos los datos sigue existiendo como
  **huella de comparación** (`nombre#<hash>`), no como llave de Ekon o
  seguimiento. `nameKey` conserva el nombre normalizado para el agrupado CSV.
  - **En Seguimiento**: cada `campaign.id` tiene su documento independiente y
    su conteo de tiendas. Cambiar fechas, link, soportes o tiendas conserva todo
    el seguimiento de esa línea lógica.
  - **En importación**: `dedupeIncoming` colapsa **solo filas idénticas**;
    `diffCampaigns` usa la huella para igualdad exacta, conserva el ID en cambios
    inequívocos y pide al usuario emparejar homónimos ambiguos. Un cambio de
    nombre siempre requiere confirmación. Las ausentes se inactivan.
  - **Ekon** se guarda por `campaign.id`: dos flights pueden compartir número,
    pero editar uno no modifica al otro. **CSV** sigue agrupado por
    `Campaña + RESOLUCION`; su consolidación no cambia.
  - **Descargas deduplicadas**: como la llave es `Campaña + RESOLUCION`, varios
    _flights_ homónimos se **unen** en una única consolidación por resolución
    (las pantallas se acumulan globalmente y se deduplican por `screen.id`). Se
    **presenta y descarga un único CSV por resolución** —tanto en el menú como en
    el ZIP—, sin opciones repetidas; su contenido es la **unión deduplicada** de
    las pantallas aplicables de todos los flights (`consolidate`, con prueba de
    regresión en `consolidate.test.ts` y en `CampaignsPage.test.tsx`).
- **UX resumen → detalle** (no se despliega todo a la vez): tras subir el
  archivo aparece un **banner-titular fijo** (sticky) con las cifras clave
  (Nuevas · Modificadas · Eliminadas · Pendientes · Errores) y el botón
  **Aceptar y guardar cambios**. El resto es un **acordeón** de secciones
  colapsables (`Errores y advertencias`, `Clasificación operativa`, `Campañas
  modificadas`, `Campañas inactivadas`, `Campañas nuevas`, `Campañas detectadas`,
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
  Después, un separador y las descargas individuales por resolución. Como la
  consolidación es por `Campaña + RESOLUCION`, se muestra **una sola opción por
  resolución** aunque la campaña tenga varios _flights_ homónimos (sin opciones
  repetidas), y el ZIP contiene un único CSV por resolución. Si la campaña no
  tiene consolidaciones, muestra **“Sin CSV”** y no ofrece ZIP.
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
  `campaignOperationalTracking/{campaignId}`: la importación **nunca** borra
  ni sobrescribe checks manuales ni el estado de ciclo de vida, y el seguimiento
  **nunca** modifica la campaña importada. La llave operativa es el
  `campaign.id`; por eso dos flights homónimos tienen seguimientos separados y
  una corrección de datos conserva checks, comentarios, clasificación y ciclo de
  vida. Los documentos legacy basados en `campaignIdentity` se copian de forma
  idempotente al ID canónico.
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
- **Testigos no aplican a Institucional**: las campañas **Institucional** no
  requieren testigos, así que **T Arranque** y **T Completos** se muestran como
  **"No aplica"** (sin casilla editable) y no generan estados, vencimientos ni
  alertas. La regla vive en el dominio (`applyCheckChange` rechaza esos cambios y
  `markAllComplete` no los toca), no solo en la interfaz. Los valores históricos
  se conservan y **reaparecen** si la campaña vuelve a Proveedor. Con la
  clasificación **pendiente** los testigos muestran **"Clasifica primero"** (nunca
  se asume Proveedor).
- **Marcar todas / Marcar aplicables** (campañas terminadas): en las filas cuya
  `fechaFin` ya pasó (periodo **Terminada**) aparece un botón que marca de una vez
  los indicadores (`source: manual`, con quién/cuándo). En **Proveedor** se llama
  **"Marcar todas"** y marca los cinco; en **Institucional** se llama **"Marcar
  aplicables"** y marca solo Link, Validación Liverpool y CSM (nunca los testigos).
  No aparece en campañas activas ni futuras.
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
- **Estados y alertas** con icono + texto (no solo color): `not-applicable`
  (testigos de Institucional; neutro, se ordena al final), `upcoming`,
  `on-track`, `due-soon` (2 días hábiles T Arranque / 5 naturales T Completos),
  `due-today`, `overdue`, `completed-on-time`, `completed-late`, `invalid-date`.
- El **Dashboard** deriva (no persiste) el resumen operativo: activas,
  seguimiento completo, en curso sin atrasos, con alertas y vencidas; alertas
  críticas ordenadas por urgencia; próximos vencimientos e inicios; y terminadas
  con pendientes. Cada alerta enlaza a la campaña en `/seguimiento`. Las campañas
  **canceladas se excluyen por completo** de este resumen (se filtran las filas
  operacionalmente aplicables **antes** de calcular todas las secciones, para que
  una cancelada no acabe como “En curso sin atrasos” solo porque `criticalAlerts`
  devuelva un arreglo vacío).
- **Filtro de periodo (rango de fechas)**: por defecto la tabla muestra solo las
  campañas cuya vigencia **se traslapa** con la ventana **mes anterior + mes
  actual + mes siguiente** (del día 1 del mes anterior al último día del mes
  siguiente; helper puro `defaultTrackingWindow` en `businessDays.ts`). Hay
  campos **Desde/Hasta** precargados con esa ventana, un botón **Restablecer**
  (vuelve al default) y **Ver todo** (quita el filtro temporal). El cruce por
  intersección reutiliza `campaignIntersectsPeriod`/`periodError` de
  `campaigns/dateFilter`. Este filtro **reemplazó** al antiguo selector
  Activas/Futuras/Terminadas (la noción de "Terminada" sigue viva internamente
  para el botón "Marcar todas"). Se combina (AND) con Estado, Clasificación y
  búsqueda.
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
- **Estado Activa/Cancelada (ciclo de vida)**: campo tipado
  `lifecycleStatus: 'active' | 'cancelled'` en el documento de seguimiento (más
  `lifecycleUpdatedAt`, `lifecycleUpdatedByUid/Email` y
  `cancellationReason: string | null`). **Alcance exclusivamente operativo**: no
  cambia ejecución, consolidación, CSV/ZIP, Excel, PPT ni baja ocupación, y las
  canceladas **siguen contando** en la carga por tienda/soporte del Dashboard;
  solo se excluyen del **resumen operativo** superior.
  - **Cancelar** (acción individual por fila, confirmación accesible, **motivo
    opcional**): la campaña no requiere ninguno de los cinco checks (se muestran
    **“No aplica”**, sin casillas ni “Marcar todas”), no genera alertas,
    pendientes ni vencimientos (próximo vencimiento `—`) y muestra de forma
    accesible quién/cuándo/motivo. Los checks, la clasificación y los comentarios
    se **conservan** intactos. El diálogo bloquea dobles envíos; cerrarlo no
    guarda nada.
  - **Reactivar** (confirmación): vuelve a **Activa**, limpia el motivo y los
    cinco checks reaparecen **exactamente** como estaban; se recalculan alertas y
    vencimientos con las reglas normales.
  - **Transición pura y probada** (`cancelTracking`/`reactivateTracking` en
    `trackingFactory.ts`), aplicada de forma **transaccional** por la capa de
    servicio (`cancelCampaignTracking`/`reactivateCampaignTracking`), que crea el
    documento con los defaults actuales si aún no existe antes de aplicar la
    transición. Nunca modifica checks, clasificación ni comentarios.
  - **Protección de reglas operativas**: `updateCheck` y `markAllChecks`
    **rechazan** cambios sobre una cancelada (`TrackingError`);
    `updateClassification` y `addComment` siguen permitidos. No se depende de
    ocultar las casillas.
  - **Compatibilidad legacy**: los documentos sin estos campos se interpretan
    como `active` (`normalizeTracking`, aplicada en **lecturas** y **dentro de
    las transacciones**); no requiere migración manual. Las reglas de Firestore
    validan el enum y los tipos de los metadatos; la lectura no los exige.
  - **Reimportaciones**: actualizar una línea con el mismo `campaign.id` conserva
    `cancelled`; `initializeTrackingForImport` no cambia `lifecycleStatus`, el
    motivo ni los metadatos de transición.
- **Auditoría**: por ahora la trazabilidad (quién/cuándo modificó y completó)
  vive **dentro** del documento de seguimiento. No existe todavía una bitácora
  global operativa; queda preparada la información para poblarla más adelante.

### 6.5 Panel — Carga por tienda y soporte (`/`)

- El Dashboard conserva su resumen operativo (activas, alertas críticas,
  vencimientos, inicios, terminadas con pendientes) y añade la sección **Carga
  por tienda y soporte**, derivada en memoria de `campaigns`, `screens` y
  `campaignOperationalTracking` (modelo puro `occupancyModel.ts`). **No** persiste
  agregados en Firestore ni reejecuta `consolidate()` (no reutiliza sus
  resultados porque excluyen InStore Media y agrupan por resolución). La sección
  de carga **recibe todas las campañas**, incluidas las **canceladas** (solo el
  resumen operativo superior las excluye); su resultado no cambia por el estado
  de ciclo de vida.
- **Jerarquía visual y semáforos**: la cabecera presenta KPIs con icono, texto y
  tono semántico; la gráfica diaria y sus filtros ocupan el panel principal; un
  rail lateral muestra salud operativa, clasificación y acciones rápidas; las
  listas de atención quedan debajo. Azul = informativo, verde = al día, amarillo
  = revisión/vencimiento próximo, rojo = vencido/terminado con pendientes y gris
  = neutral. El color nunca es el único medio de comunicar el estado.
- **Fuentes separadas**: el bloque Digital multirretailer conserva sus métricas
  y colecciones independientes; no agrega cifras con Liverpool.
- **Definición de carga**: métrica principal **pico de campañas simultáneas**
  (`peakConcurrentCampaigns`) = máximo, para cualquier día civil del periodo, de
  campañas distintas que usan esa tienda/soporte ese día. Complementarias:
  **campañas distintas** (`distinctCampaigns`), **días-campaña** (`campaignDays`
  = suma de días activos por campaña en esa tienda/soporte), **tiendas** /
  **soportes distintos**, y **pantallas físicas** (dedup por `screen.id`).
- **No es capacidad**: el sistema aún **no** modela capacidad máxima por
  pantalla (slots, circuito, rotación, TIPO DE PASES), por eso **no** se muestran
  porcentajes de ocupación, “saturación” ni “slots libres”. La intensidad de
  color de la matriz es solo relativa dentro de la vista.
- **Segmentación** Institucional / Proveedor / **Pendiente** (nunca se asume
  Proveedor): clasificación desde `tracking.classification` y, si no existe,
  `classifyFromTipo(campaign.tipo)`. Se comunica por texto y color (no solo
  color).
- **Cruce** por `Numero de Tienda + calendarSupport` reutilizando
  `normalizeStore`/`normalizeSupport`; solo pantallas **activas** suman; las
  inactivas, tiendas inexistentes o soportes sin correspondencia generan
  **incidencias de calidad** (no carga). Nombre oficial de tienda del catálogo.
  “Asignada” sin comentario expande las pantallas activas del soporte; se
  conserva la **excepción Guadalajara** (78 → CRIUS + CUADRADA: una campaña por
  combinación, pero dos pantallas físicas).
- **InStore Media separado**: MUPPI'S/PENDON siguen **excluidos del CSV**, pero
  el panel muestra su **demanda solicitada** por tienda+soporte (sin pantallas
  físicas; nombre oficial si la tienda existe, incidencia si no; “asignada” sin
  comentario no se expande).
- **Filtros**: periodo (Hoy / Semana actual / Próximos 7 / Mes actual / Próximos
  30 / Rango personalizado, por intersección con fechas civiles), clasificación,
  propietario, soporte, tienda y búsqueda; sincronizados con la **URL**
  (`?periodo=&clasificacion=&tienda=&soporte=&q=`). El periodo **predeterminado es
  Mes actual** (del día 1 al último día del mes natural): sin `periodo` en la URL
  se usa `this-month` y la vista por defecto lo **omite** de la URL; `periodo=today`
  u otros presets se respetan. No existe un preset de año completo. Drill-down por
  soporte, tienda o celda que lista las campañas con enlace a `/seguimiento?campana=`.
- **Estados**: carga inicial, error (sin vaciar), sin campañas, sin datos para el
  periodo/filtros; botón **Actualizar** que conserva los datos previos y muestra
  la última actualización. `occupancyModel` está ampliamente cubierto por
  pruebas puras.
- **Gráficas ECharts** (import dinámico, tema claro/oscuro): **Carga diaria**
  (área apilada de campañas simultáneas por día y clasificación, con marcador de
  **pico** en magenta) y **Mezcla por clasificación** (dona). Ambas se derivan de
  campos añadidos al modelo (`series: DailyLoadPoint[]` y `classificationTotals`),
  respetan los filtros a nivel campaña y son coherentes con `totals`. Las barras
  horizontales top-10 y la matriz tienda × soporte se conservan (accesibles, con
  `aria-label` y drill-down); las gráficas son un refuerzo visual, no la única
  fuente del dato.

### 6.6 Alertas de baja ocupación (`/alertas-ocupacion`)

> **Para IA (resumen de una frase):** módulo que, para una **fecha civil**,
> cuenta los **contenidos de proveedor vigentes** de cada pantalla y genera CSV
> de Admira que recomiendan poner institucionales de relleno en **Ratio 1** (poca
> variedad) o dejarlos en **Ratio 3** (variedad normal). No cambia nada del flujo
> existente; solo **detecta y exporta**. Carpeta: `src/modules/low-occupancy/`
> (README propio con todo el detalle).

**Contexto de negocio.** Admira reparte el loop en dos ratios: **Ratio 1** = 83 %
(marcas/proveedores) y **Ratio 3** = 17 % (institucionales); **no existe Ratio
2**. Si una pantalla tiene solo 1–2 contenidos de proveedor, Admira los repite
demasiado en Ratio 1; el operador sube manualmente institucionales de relleno en
Ratio 1 para dar variedad. SIGNAM **solo detecta** esas pantallas y genera los CSV
que indican dónde los institucionales van en Ratio 1 y dónde permanecen en Ratio
3. La carga final en Admira es **manual**; SIGNAM **no** administra institucionales
(no sabe cuántos hay ni su orden/frecuencia; el mismo CSV sirve para 1, 2 o 3).

**Unidad de análisis** = `Numero de Tienda + NORMALIZACION LIVERPOOL
(metadata.calendarSupport) + RESOLUCION`. Una misma tienda puede dar resultados
distintos por soporte o resolución.

**Conteo de proveedores** = contenidos deduplicados por `Campaña + ARTICULOS`
dentro de la unidad:

- misma campaña + mismo artículo (repetido) → **1**;
- misma campaña + dos artículos → **2**;
- dos campañas + mismo artículo → **2**;
- `TIPO DE PASES` y circuito **no** dividen; resolución y soporte normalizado
  **sí** separan.

Solo cuentan campañas **Proveedor** (`classifyFromTipo` = `provider`, reutilizada);
Institucional / `ISM/INSTITUCIONAL 1` / desconocido **nunca** cuentan. Una campaña
está vigente si `fechaInicio <= fechaAnalizada <= fechaFin` (inclusive, fechas
civiles sin desfase UTC).

**Clasificación → nivel → ratio → CSV:**

| Proveedores | Nivel                     | Ratio     | CSV                |
| ----------- | ------------------------- | --------- | ------------------ |
| 0           | Sin ocupación comercial   | (ninguno) | **fuera de ambos** |
| 1           | Baja ocupación crítica    | Ratio 1   | CSV Ratio 1        |
| 2           | Baja ocupación preventiva | Ratio 1   | CSV Ratio 1        |
| 3 o más     | Ocupación normal          | Ratio 3   | CSV Ratio 3        |

Cero proveedores = **alerta** en la UI y queda fuera de ambos CSV.

**Universo de pantallas** = todas las activas y elegibles del catálogo. Se
**reutiliza** el motor de consolidación: se extrajeron de
`consolidation/consolidate.ts` las funciones puras `buildScreenIndex`,
`matchCampaignScreens` y `screenToAdmiraRow` (la consolidación normal las usa
también; su comportamiento no cambió). Se conservan las exclusiones de **InStore
Media** (`MUPPI'S`/`PENDON`), **ISM** (`TIPO DE pantallas` contiene `ISM`),
**inactivas**, **sin normalización** (se reporta como incidencia) y la **excepción
de Guadalajara Galerías** (78 → CRIUS + CUADRADA). "Asignada" sin comentario =
todas las tiendas activas del soporte.

**CSV Ratio 1 / Ratio 3.** La evaluación es por unidad, pero los **archivos** se
agrupan por `NORMALIZACION LIVERPOOL + RESOLUCION` (dos CSV independientes por
combinación). Formato **idéntico** al CSV normal (`serializeAdmiraCsv`,
`AdmiraCsvRow`, columna guarda `LIVERPOOL` en A1, BOM UTF-8, CRLF,
`RETAILERS=LIVERPOOL`, etiqueta `Tipo de Pases`). Los textos `RATIO 1`/`RATIO 3`
aparecen **solo en el nombre del archivo**, nunca en las columnas. Nombre:
`<NORMALIZACION>_<RESOLUCION>_RATIO_<1|3>_ANALISIS_<AAAA-MM-DD>_GENERADO_<AAAA-MM-DD>.csv`
(incluye **fecha analizada** —la que elige el usuario— y **fecha de generación**
—el día de la descarga—, aunque coincidan; saneado sin acentos/espacios/inválidos).
**Nunca** se descargan CSV vacíos (botón deshabilitado con "Sin pantallas para
Ratio 1/3").

**Arquitectura (archivos clave).**

- `occupancyAnalysis.ts` — **motor puro** `analyzeLowOccupancy({ campaigns,
  screens, analysisDate })` + `filterUnits` + helpers (`todayIsoDate`,
  `isCampaignActiveOn`, `countsForOccupancy`). Sin React ni Firebase.
- `occupancyCsv.ts` + `occupancyFileName.ts` — generación de CSV y nombres.
- `types.ts` — `OccupancyUnit`, `OccupancyExportGroup`, `OccupancyAnalysis`,
  niveles y etiquetas.
- `LowOccupancyPage.tsx` + `components/` (`OccupancySummary`, `OccupancyFilters`,
  `OccupancyTable`, `OccupancyDetail`, `OccupancyExportGroups`, `LevelBadge`).

**Datos y estado.** Carga bajo demanda con `Promise.all([listCampaigns(),
listScreens()])`; recalcula al abrir, cambiar la fecha, pulsar **Recalcular** o
volver tras importar. **No** se persisten resultados ni existe colección nueva:
Ratio 1/3 son recomendaciones para una fecha, no propiedades permanentes. **No**
hay catálogo institucional.

**UI.** Ruta `/alertas-ocupacion` (grupo **Operación**), acepta `?fecha=AAAA-MM-DD`.
Controles: fecha, Recalcular; filtros por centro, tienda, normalización,
resolución, nivel, ratio y búsqueda por campaña/artículo (los filtros son
**visuales**, no alteran los CSV completos). Resumen (unidades, 0/1/2/3+, grupos
exportables, incidencias), tabla, detalle por unidad (contenidos, vigencias,
soporte, pantallas físicas, llave de dedup) y exportaciones por soporte+resolución.
Accesibilidad: etiquetas textuales + símbolos (no solo color). Descargas gated por
permiso `export.csv`.

**Advertencia no bloqueante en Campañas.** El flujo de Campañas muestra un aviso
(`role="status"`) cuando hay pantallas con 1–2 proveedores para hoy, con enlace a
`/alertas-ocupacion?fecha=AAAA-MM-DD`. **No** bloquea, no cambia el CSV normal ni
las consolidaciones ni impide exportar.

**Invariantes que NO cambian** (importante para futuras IA): la consolidación
`Campaña + RESOLUCION`, el CSV normal de campañas, el nombre Admira
`<Campaña>_ <ARTICULOS>`, el catálogo, el seguimiento operativo, Ekon, `TIPO DE
PASES`, el ratio 83/17, las reglas de pantallas inactivas y las exclusiones
InStore Media. La agrupación `NORMALIZACION LIVERPOOL + RESOLUCION` aplica **solo**
a los CSV auxiliares Ratio 1/3.

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
| Alertas de baja ocupación (Ratio 1 / Ratio 3, CSV por soporte+resolución) | ✅     |
| Muppi's / ISM · Festivos/evidencias · Historial global        | ⏳     |
