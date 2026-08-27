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
   link, validación, programación CSM y testigos con fechas límite y alertas;
   los **testigos no aplican a campañas Institucional**), con un **estado manual
   Activa/Cancelada** por campaña, más un **Dashboard** con el resumen y las
   alertas críticas (periodo predeterminado: **Mes actual**).
8. Generar una **PPT de evidencias** (`.pptx`) por campaña para las fotos.
9. **Alertas de baja ocupación**: detectar pantallas con baja variedad de
   proveedores para una fecha y generar CSV auxiliares **Ratio 1 / Ratio 3**.
10. Guardar archivos, versiones, cambios, exportaciones y auditoría en **Firebase**.
11. **Importación Ekon** y **Conciliación** Ekon–Liverpool (ver abajo).
12. **Operación Digital multirretailer** para La Comer y Chedraui, aislada de
    Liverpool/Admira (ver abajo).

## Operación Digital multirretailer

Las rutas `/importar-digital`, `/operacion-digital` y `/catalogo-digital`
implementan la extracción EKON **Seguimiento Campañas** para `CHEDRAUI` y
`LA COMER`, inicialmente solo con `COPETE DIGITAL` y catorcenas confirmadas.
El importador valida las 39 columnas, fechas civiles y Tipo Fijación, enseña lo
ignorado por catálogo y obliga a resolver duplicados exactos o conflictos antes
de persistir. El original se conserva inmutable en
`digital-imports/{batchId}/{archivo}`.

El seguimiento muestra únicamente Link de descarga, Validación de cadena y
Programación CMS. Las cancelaciones son reversibles y conservan checks y
comentarios. El panel agrega una sección independiente de métricas digitales y
el Excel propio genera `Resumen catorcena`, `Detalle EKON`, `Incidencias` y
`Metadatos` sin imágenes.

La vista de **Operación Digital** presenta esos tres checks en columnas
independientes, avance `Sin iniciar / En curso / Completa`, filtros por fuente,
retailer, soporte, catorcena, modo, estado operativo, vigencia en fuente y
cliente/anunciante, más ordenamiento y detalle expandible con la bitácora. Al
entrar muestra la catorcena anterior, la vigente y la siguiente. Los elementos
que una reimportación dejó inactivos continúan visibles e identificados para
preservar el historial; este estado de fuente no se confunde con la cancelación
operativa.

Desde la misma pantalla, admin y operator pueden generar un **Papel de trabajo**
eligiendo obligatoriamente una catorcena, de forma independiente a los filtros
de la tabla. El archivo conserva las hojas `CHEDRAUI` y `LACOMER` y las diez
columnas del formato operativo (`Cadena` a `Comentarios`); incluye solo registros
vigentes en fuente y no cancelados, reúne toda la bitácora de comentarios con
saltos de línea y deja `Arte` vacío con el ancho reservado para añadir la imagen
en Excel. Cada generación se registra en `digitalReportExports`.

### Aislamiento

Este dominio no utiliza `campaigns`, `screens`, `campaignEkonLinks`, Admira,
conciliación Liverpool, baja ocupación, PPT, CSV/ZIP ni el Excel Liverpool. Sus
colecciones exclusivas son `digitalSupportCatalog`, `digitalImportBatches`,
`digitalPlacementRows`, `digitalOperationalItems`,
`digitalOperationalTracking`, `digitalImportResolutions`,
`digitalPlacementRevisions` y `digitalReportExports`. Las reglas prohíben el
borrado físico; perfiles solo los administra admin, lectura está disponible a
usuarios autenticados e importación/seguimiento/exportación a admin/operator.

**Prueba manual:** inicializa los dos perfiles desde el catálogo, sube
`importacion general.xlsx` sin versionarlo, confirma C17/C18 y el duplicado de
las filas Excel 176/177 con “Conservar una”. El smoke test esperado del archivo
de referencia es 1,986 filas fuente, 49 en alcance, 13 campañas, 21 fijaciones,
28 revisiones y 48 filas aceptadas tras colapsar ese duplicado.

## Integración Ekon (Importación y Conciliación)

Integración híbrida Ekon–Liverpool en colecciones **separadas** que nunca tocan
Liverpool, el Master ni el seguimiento operativo.

- **Importación Ekon** (`/importar-ekon`): sube la extracción Ekon (hoja "Datos
  Tienda", 30 columnas), valida encabezados y filas, **detecta y confirma los
  periodos** realmente presentes, muestra una **vista previa del diff** contra la
  última importación y persiste por lotes idempotentes. Estados de asignación:
  `Nueva`, `Sin cambios`, `Modificada`, `No incluida`, `Restaurada`, `Conflicto`;
  las ausencias solo cuentan dentro del alcance confirmado y nada se borra (se
  conserva historial en `ekonRevisions`).
- **Conciliación** (`/conciliacion`): para cada campaña Liverpool con **vínculo
  manual** Ekon (`campaignEkonLinks`, muchos-a-uno), compara número, tipo/Ratio,
  cobertura de periodos vs fechas exactas Liverpool, circuito↔soporte (mapeo
  autorizado) y tiendas por número (solo determinantes físicos; el determinante
  `0` = Centro Administrativo no aplica). La cobertura operativa exige que, en
  cada tienda, todos los soportes Liverpool tengan circuito Ekon compatible y
  viceversa; cualquier diferencia bloquea la conciliación. El detalle se revisa
  en un modal con filtros, copia tabulada y navegación entre campañas con
  incidencias, siempre **sin modificar fuentes**.
- **Fallback CSV** (solo `MEGA MUPI DIGITAL` y `BANNER DIGITAL`): cuando el
  soporte **no** viene marcado en Liverpool pero Ekon indica que debe existir, se
  sintetiza reutilizando el flujo de consolidación normal (mismos encabezados,
  columna guarda, BOM, escape y llave `Campaña + RESOLUCION`). Si Liverpool marca
  el soporte, se usa el flujo Liverpool y no hay fallback. Detalle completo en
  [`AGENTS.md`](./AGENTS.md).

**Ratio 1 / Ratio 3 de Ekon** (por tipo de campaña) es **distinta** del cálculo
de baja ocupación (mismo nombre, lógica separada); esta integración no modifica
el módulo de baja ocupación.

## Alertas de baja ocupación

Ruta `/alertas-ocupacion` (grupo **Operación**). Evalúa cada unidad
`Numero de Tienda + NORMALIZACION LIVERPOOL + RESOLUCION` para una **fecha civil**
(por defecto hoy, o una futura) y cuenta los contenidos de **proveedor vigentes**,
deduplicados por `Campaña + ARTICULOS`:

- **0** proveedores → _Sin ocupación comercial_ (alerta; **fuera de ambos CSV**).
- **1** → _Baja ocupación crítica_ → **Ratio 1**.
- **2** → _Baja ocupación preventiva_ → **Ratio 1**.
- **3 o más** → _Ocupación normal_ → **Ratio 3**.

Por cada `NORMALIZACION LIVERPOOL + RESOLUCION` se generan hasta dos CSV
independientes (Ratio 1 y Ratio 3) con el **formato exacto de Admira**; los textos
`RATIO 1` / `RATIO 3` viven **solo en el nombre del archivo**, que incluye la
**fecha analizada** y la **fecha de generación**. No se descargan archivos vacíos.

La **diferencia** entre fecha analizada (la que elige el usuario) y fecha generada
(el día de la descarga) queda registrada en el nombre del archivo. Ratio 1/3 son
recomendaciones calculadas para una fecha, no propiedades permanentes: no se
persisten. La operación posterior en Admira es **manual**; SIGNAM **no** administra
los contenidos institucionales y el **CSV normal de campañas no cambia**. El flujo
de **Campañas** muestra una advertencia no bloqueante cuando hay pantallas con 1–2
proveedores para hoy. Detalles en `src/modules/low-occupancy/README.md`.

## Exportación de PPTX de evidencias

Desde **Campañas**, cada fila tiene un botón de PowerPoint que genera —solo para
esa campaña— un archivo `.pptx` para preparar las evidencias fotográficas:

- **Portada** con el nombre original Liverpool de la campaña y su **vigencia**
  (`Vigencia: dd/mm/aaaa al dd/mm/aaaa`, o `Fecha no disponible` si falta).
- **Una diapositiva por pantalla física** del catálogo (se deduplica por
  `screen.id`; dos pantallas físicas distintas producen dos diapositivas aunque
  compartan tienda y soporte). Cada una muestra el **nombre oficial** de tienda
  (del catálogo), el número, el **soporte solicitado** por el calendario y
  **ARTÍCULOS**, más un **placeholder grande y editable**
  (`COLOCAR EVIDENCIA FOTOGRÁFICA`).
- **InStore Media** (MUPPI'S, PENDON, etc.) se incluye **temporalmente por
  tienda + soporte** (a diferencia del CSV, que los excluye); su nombre se toma
  de cualquier registro del catálogo con esa tienda y ARTÍCULOS usa un texto de
  respaldo (`No disponible — soporte InStore Media`).
- **Diapositiva(s) final(es) de incidencias** (`INCIDENCIAS DE COBERTURA`), solo
  si existen (tienda no encontrada, soporte sin correspondencia, solo pantallas
  inactivas, asignada sin poder expandir, InStore sin nombre, fechas faltantes…),
  paginadas si son muchas. Las incidencias **no bloquean** la descarga.
- Formato **16:9**, formas y texto **nativos y editables** (Arial), pensado para
  **PowerPoint (escritorio y Online) y Google Slides**. Diseño en la **gama rosa
  de Liverpool** (encabezado y pie magenta) con los **logotipos reales**
  (Liverpool e in-Store Media) extraídos de la presentación de referencia
  autorizada y guardados como recursos pequeños en `src/assets/ppt/`.
- Nombre del archivo:
  `Evidencias_<Campaña>_<dd-mm-aaaa>_al_<dd-mm-aaaa>.pptx` (sanitizado; `sin-fecha`
  si falta una vigencia).

La generación es **100% en el navegador** (import dinámico de `pptxgenjs`, en su
propio chunk); **aún no** se persiste en Firebase ni en Storage.

## Exportación del desglose Excel de campañas

Desde **Campañas** se puede exportar el **desglose** (una hoja de cálculo `.xlsx`)
del cruce campaña ↔ catálogo, de dos formas:

- **Individual**: en el menú de descargas de cada fila, la opción
  **“Descargar desglose Excel”** exporta la **instancia exacta** de esa campaña
  (`StoredCampaign`), sin mezclar campañas o _flights_ homónimos.
- **Masiva**: junto a los filtros, el botón **“Exportar todas (N)”** (o
  **“Exportar filtradas (N)”** cuando hay filtros activos) exporta exactamente el
  conjunto **visible** en la tabla — respeta la **búsqueda por nombre o número
  Ekon** y el **periodo `Desde`/`Hasta`** (intersección inclusiva de vigencias). Se
  deshabilita mientras genera, con periodo inválido o sin resultados.

El libro tiene hasta tres hojas:

- **`Desglose`**: una fila por **combinación única** de identidad de campaña +
  número Ekon + configuración de pantalla. Columnas, en orden: _Número de campaña
  en Ekon, Nombre de campaña, Tipo de campaña, Fecha de inicio, Fecha de fin,
  Número de tienda, Nombre de tienda, Soporte Liverpool, Tipo de pantalla,
  Modelo, Circuito, Resolución, Formato, Nombre en plataforma_. **No** se cuentan
  pantallas: si varias pantallas físicas comparten esos campos, colapsan en **una
  sola fila**; un cambio de tienda, soporte, tipo, modelo, circuito, resolución,
  formato o nombre en plataforma produce **otra fila**. El número Ekon se repite
  en cada fila; si la campaña no lo tiene, la celda queda **vacía** (no se inventa
  cero). El tipo de campaña conserva el valor guardado en SIGNAM (por ejemplo,
  `Institucional` o `Proveedor`) y queda vacío si el campo no tiene valor.
- **`Incidencias`** (solo si las hay): cruces fallidos y soportes/pantallas
  excluidos (InStore Media / ISM), con Ekon, campaña, tipo, fechas, soporte,
  tienda, código y mensaje.
- **`Resumen`** (opcional): una fila por campaña con su tipo y el número de
  **configuraciones únicas** y **tiendas distintas** (sin contar pantallas).

El cruce reutiliza `buildScreenIndex` / `matchCampaignScreens` de la consolidación
(pantallas activas, cruce por `Numero de Tienda` + `calendarSupport`, excepción de
Guadalajara y exclusión de InStore Media / ISM), construyendo el índice **una sola
vez** por reporte. El formato incluye encabezados en negritas, **fila superior
congelada**, **autofiltro**, anchos legibles, ajuste de texto, fechas visibles en
`dd/mm/aaaa` (sin desfases de zona horaria), número de tienda como **texto** y
Ekon como número o celda vacía. No se exportan IDs, `active`, versiones, autores
ni marcas de tiempo SIGNAM.

La lógica vive en `src/modules/exports/campaignReport.ts` (modelo puro: cruce,
deduplicación, incidencias y orden) y `campaignExcelExport.ts` (serialización con
`exceljs` por **import dinámico**, `Blob` y nombres de archivo). Nombres:
`<EKON>_<Campaña>_<inicio>_<fin>_Desglose.xlsx` (o `Sin Ekon_…` sin Ekon) para el
individual y `Campañas_<desde>_a_<hasta>.xlsx` (con variantes según los límites)
para el masivo, siempre sanitizados.

> Esta es la primera entrega: establece **arquitectura, modelos, seguridad y
> pruebas**. La lógica de negocio (parser de Excel, motor de consolidación,
> generación completa de CSV) se implementa en iteraciones posteriores. Los
> módulos de la UI muestran explícitamente el alcance pendiente.

## Seguimiento operativo: estado Activa/Cancelada

Cada campaña del seguimiento tiene un **estado de ciclo de vida** manual —
**Activa** o **Cancelada**— que **solo** afecta al seguimiento operativo (no
cambia ejecución, consolidación, CSV/ZIP, Excel, PPT ni baja ocupación). Vive en
`campaignOperationalTracking/{campaignId}` (campos `lifecycleStatus`,
`lifecycleUpdatedAt/By*` y `cancellationReason`); la importación del calendario
**nunca** lo borra ni sobrescribe.

- **Cancelar** (acción individual por fila, con confirmación accesible y un
  **motivo opcional**): la campaña no requiere ninguno de los cinco checks (se
  muestran **“No aplica”**), no genera alertas, pendientes ni vencimientos, y
  desaparece del **resumen operativo** del Dashboard. Sus checks, clasificación y
  comentarios se **conservan** intactos.
- **Reactivar** (con confirmación): vuelve a **Activa**, limpia el motivo y los
  cinco checks reaparecen exactamente como estaban; se recalculan alertas y
  vencimientos con las reglas normales.
- El estado **sobrevive a cambios de la misma línea lógica** porque el
  `campaign.id` se conserva aunque cambien fechas, link, tipo, vendedor,
  soportes o tiendas. Los flights homónimos siguen siendo independientes.
- Las canceladas **permanecen visibles** por defecto (filtro
  Todas/Activas/Canceladas, inicial **Todas**) con un badge inequívoco
  **“Cancelada”** (icono + texto). Los comentarios y la clasificación siguen
  disponibles y editables según los permisos actuales.
- Documentos **legacy** sin el campo se interpretan como **Activa** (sin
  migración manual). `updateCheck`/`markAllChecks` **rechazan** cambios sobre una
  cancelada (`TrackingError`); reactivar es la única vía para volver a editar los
  checks.

## Panel: carga por tienda y soporte

El Dashboard incluye la sección **Carga por tienda y soporte** (además del
resumen operativo y las alertas). Deriva todo en memoria de `campaigns`,
`screens` y `campaignOperationalTracking` (modelo puro `occupancyModel.ts`); no
persiste métricas en Firestore ni reejecuta la consolidación CSV. **Las campañas
canceladas siguen contando aquí**: solo se excluyen del resumen operativo
superior, no de la carga.

La vista prioriza la lectura ejecutiva con tarjetas KPI, semáforos textuales,
gráfica principal, estado operativo, acciones rápidas y paneles de atención. Los
tonos no usan umbrales arbitrarios: **verde** = al día/sin incidencias,
**amarillo** = revisión o vencimiento próximo, **rojo** = vencido o terminado
con pendientes, **azul** = dato informativo y **gris** = neutral/no aplicable.
Liverpool y la operación Digital multirretailer se muestran en secciones
separadas y nunca combinan sus métricas.

En escritorio, **Carga diaria** y **Atención operativa** comparten una columna
principal independiente del rail de estado, urgencias, clasificación y atajos;
así el contenido operativo continúa inmediatamente debajo de la gráfica sin
depender de la altura del rail. En tablet el rail se organiza en dos columnas y
en móvil todos los paneles se apilan.

- **Métrica principal:** _pico de campañas simultáneas_ — máximo, en cualquier
  día del periodo, de campañas distintas que usan esa tienda/soporte.
- **Complementarias:** campañas distintas, **días-campaña**, tiendas/soportes
  distintos y **pantallas físicas** (dedup por `screen.id`).
- **Segmentación** Institucional / Proveedor / Pendiente (texto y color; nunca se
  asume Proveedor).
- **No es capacidad:** aún no se modela capacidad máxima por pantalla, por eso
  **no** se muestran porcentajes de ocupación ni “saturación”; el color de la
  matriz es intensidad relativa dentro de la vista.
- **InStore Media** (MUPPI'S/PENDON) aparece **separado** como demanda
  solicitada (siguen excluidos del CSV; sin pantallas físicas).
- Cruce por `Numero de Tienda + calendarSupport` (solo pantallas activas;
  inactivas/faltantes → incidencias de calidad), con la excepción **Guadalajara**
  (78 → CRIUS + CUADRADA). Nombre oficial de tienda del catálogo.
- **Filtros** (periodo, clasificación, propietario, soporte, tienda, búsqueda)
  sincronizados con la URL, y **drill-down** por soporte/tienda/celda con enlace
  a Seguimiento. El periodo por defecto es **Mes actual** (sin `periodo` en la
  URL); no hay preset de año completo. Generación client-side; botón Actualizar
  sin vaciar la vista.
- **Gráficas Apache ECharts** (import dinámico, chunk aparte): _Carga diaria_
  (área apilada de campañas simultáneas por día, con marcador de pico) y _Mezcla
  por clasificación_ (dona). Refuerzan las barras top-10 y la matriz, que siguen
  siendo accesibles y con drill-down.

## Interfaz: panel analítico claro/oscuro

La app usa un sistema de diseño _glassmorphism_ por tokens (`src/styles/global.css`)
con **base azul** y **magenta Liverpool como acento puntual**. Incluye **tema
claro y oscuro con interruptor** en la barra superior (persistido en
`localStorage`, respeta `prefers-color-scheme`; `src/app/theme.ts`), barra lateral
**agrupada** por secciones y una topbar tipo panel (marca, estado _En línea_,
toggle de tema y usuario). El cambio de tema aplica a **toda la app** vía
`data-theme` en `<html>`.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + React Router.
- **Gráficas**: Apache ECharts (carga diferida por import dinámico).
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
│   ├── ekon-import/     # Importación Ekon (flujo por etapas + diff)
│   ├── campaigns/
│   ├── consolidation/   # (incluye ekonFallback: soportes sintéticos)
│   ├── reconciliation/  # Conciliación Ekon ↔ Liverpool
│   ├── low-occupancy/   # Alertas de baja ocupación (Ratio 1 / Ratio 3)
│   ├── operational-tracking/
│   ├── exports/
│   └── audit/
├── domain/         # Modelos y lógica pura (sin dependencias de framework)
│   └── ekon/       # Dominio Ekon: parser, identidad, diff, mapeo, conciliación
├── services/       # Adaptadores externos (Firebase, entorno; ekon*.ts)
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
| Importar Ekon               |   ✓   |    ✓     |        |
| Ver conciliación            |   ✓   |    ✓     |   ✓    |
| Exportar CSV                |   ✓   |    ✓     |        |
| Administrar usuarios        |   ✓   |          |        |

### Colecciones e índices Ekon

Colecciones nuevas (reglas en `firestore.rules`): `ekonImportBatches`
(metadatos del lote: nombre, hash, periodos, totales), `ekonAssignments`
(asignaciones vigentes; id = huella estable) y `ekonRevisions` (historial
append-only). La asociación manual reutiliza `campaignEkonLinks`. El archivo
crudo **no** se persiste en Firestore (superaba el límite de tamaño de
escritura); la trazabilidad queda en los metadatos del lote, las asignaciones y
las revisiones.

Índice que **debe desplegarse** (`firestore.indexes.json`): `ekonAssignments`
compuesto por `campaignNumber` (ASC) + `active` (ASC), usado por la conciliación
y el fallback para leer las asignaciones vigentes de un número Ekon. El resto de
consultas Ekon son de un solo campo (auto-indexadas).

```bash
firebase deploy --only firestore:indexes   # despliega el índice compuesto
firebase deploy --only firestore:rules      # despliega las reglas nuevas
```

### Emuladores

```bash
npm run emulators
# En .env: VITE_USE_FIREBASE_EMULATORS=true
```

Puertos: Auth `9099`, Firestore `8080`, Storage `9199`, Functions `5001`,
Hosting `5000`, UI habilitada.

**Prueba manual de la integración Ekon con el Emulator Suite:**

1. `npm run emulators` y `npm run dev` (con `VITE_USE_FIREBASE_EMULATORS=true`).
2. Inicia sesión y ve a **Importación Ekon** (`/importar-ekon`).
3. Sube una extracción Ekon `.xlsx` (hoja "Datos Tienda"). Revisa el alcance
   detectado, **confirma los periodos** y la **vista previa del diff**; confirma
   la importación. En Firestore Emulator UI verás el lote `completed` en
   `ekonImportBatches`, las `ekonAssignments` y `ekonRevisions`.
4. Reimporta el **mismo archivo y alcance**: la app avisa que ya se importó y no
   duplica (idempotencia por `contentHash`).
5. En **Campañas**, vincula manualmente una campaña a un número Ekon. Ve a
   **Conciliación** (`/conciliacion`) y verifica número, Ratio, cobertura de
   periodos y cada combinación tienda↔soporte/circuito. Abre el modal, alterna
   entre diferencias/todas, copia las incidencias y navega a la campaña anterior
   o siguiente con problemas; el determinante `0` aparece como "Centro
   Administrativo / tiendas no aplican".
6. Para el fallback CSV, deja una campaña vinculada **sin** marcar `MEGA MUPI
DIGITAL`/`BANNER DIGITAL` en Liverpool pero con esos circuitos en Ekon y con
   tiendas operativas: la consolidación genera esos soportes reutilizando el CSV
   Admira normal.

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
