# Guía para agentes — SIGNAM V2

Lee este archivo antes de modificar el repositorio. Complementa al `README.md`.

## Reglas de trabajo

- Confirma que `origin` apunta a `DigitalappsiSM/signam-v2`.
- No construyas una app monolítica en un solo `index.html`: mantén la
  arquitectura modular (`src/modules`, `src/domain`, `src/services`).
- Todo cambio debe: estar documentado, tener pruebas, pasar
  `lint` + `typecheck` + `test` + `build`, ir en un commit claro y presentarse
  en un pull request.
- **No** incluyas contraseñas, tokens, cuentas de servicio ni llaves privadas.
  `.env` está en `.gitignore`; solo se versiona `.env.example`.
- Si falta una decisión que pueda cambiar el modelo de datos o el resultado de
  los CSV, **pregunta antes de asumirla**.

## Invariantes de dominio (no romper sin decisión documentada)

- **Encabezados del maestro** (`src/domain/constants.ts`): orden y texto literal
  autoritativos. El encabezado definitivo es `TIPO DE PASES`; la estructura
  antigua `Pases` se **reporta**, no se corrige en silencio.
- **Metadatos SIGNAM** (`active`, `createdAt`, `version`, etc.) se guardan
  **separados** de los campos originales del maestro y nunca se exportan dentro
  del maestro (ver `AdmiraScreen` en `src/domain/models.ts`).
- **Consolidación**: la llave es `Campaña + RESOLUCION`. No separar por circuito,
  soporte, `ARTICULOS` ni `TIPO DE PASES`.
- **Nombre de campaña Admira**: `<Campaña>_ <ARTICULOS>` (espacio tras `_`),
  varios artículos con `+`, deduplicando en orden de aparición.
- **`TIPO DE PASES`**: informativo, va en cada fila del CSV; no divide campañas
  ni forma parte del nombre.
- **Soportes InStore Media** (`MUPPI'S`, `PENDON`): se detectan pero se excluyen
  de la consolidación en esta etapa.
- **CSV de Admira**: Admira **ignora la primera columna**, así que la **columna
  A** se usa como columna "guarda": va **vacía** en las filas de datos y su
  encabezado en `A1` es **`LIVERPOOL`** (`ADMIRA_CSV_TITLE`). Las columnas reales
  empiezan en **B**. La fila 1 es
  `LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases`
  y cada fila de datos comienza con una celda vacía. El **encabezado escrito**
  rotula la última columna como **`Tipo de Pases`** (`ADMIRA_CSV_HEADER_LABELS`),
  mientras la **llave interna** de las filas (`AdmiraCsvRow`) y el **encabezado
  del maestro** permanecen `TIPO DE PASES`. `RETAILERS` es constante =
  `LIVERPOOL` (`RETAILERS_VALUE`).
- **Asociación campaña ↔ Ekon**: relación muchos-a-uno (cada campaña tiene como
  máximo un número; un mismo número puede repetirse en varias campañas),
  persistida en `campaignEkonLinks/{campaignId}`. La identidad canónica es el
  `id` existente del documento `campaigns`; `campaignIdentity` es solo una
  huella de comparación y nunca una llave persistente. No se reserva la unicidad
  del número: al reutilizarlo, la UI avisa y pide confirmación. Los enlaces
  legacy basados en `nameKey` se copian una vez a cada flight existente y luego
  cada flight se edita de forma independiente.
- **Seguimiento operativo**: colección independiente
  `campaignOperationalTracking/{campaignId}`. Dos flights homónimos tienen
  seguimientos independientes y una actualización de fechas, tiendas, soportes,
  link u otros datos conserva el mismo `campaignId` y todo su historial. Los
  documentos legacy basados en `campaignIdentity` se copian de forma idempotente
  al `campaignId`. Contiene solo
  datos operativos; nunca se mezcla con `campaigns` y la importación no borra ni
  sobrescribe checks manuales ni el estado de ciclo de vida. Los
  indicadores se editan **inline como casillas** en la tabla (sin modal). Cinco
  indicadores editables: **Link de descarga** (por defecto automático — marcado
  si `campaign.link` es URL válida — pero editable: al cambiarlo `source:manual`
  manda; si no, se deriva del calendario), **Validación Liverpool** (por defecto
  marcada si Institucional **o** hay link válido; editable), **Programación
  CSM**, **T Arranque** y **T Completos** (manuales). Reglas de testigos: marcar
  T Completos marca también T Arranque; no se puede desmarcar T Arranque mientras
  T Completos siga marcado. **Los testigos NO aplican a campañas Institucional**:
  T Arranque y T Completos se muestran como **"No aplica"** (sin casilla), no
  generan estados/vencimientos/alertas y su valor efectivo se trata como
  satisfecho solo para los agregados (`isFullyTracked`); la regla vive en el
  dominio (`applyCheckChange` **rechaza** esos cambios con `TrackingError` y
  `markAllComplete` no los toca), no solo en la UI, y **conserva** los valores
  históricos (reaparecen si vuelve a Proveedor). Los testigos **solo aplican a
  Proveedor**: con clasificación **pendiente** no se asume ningún régimen (no
  generan vencimientos ni alertas de testigo), muestran "Clasifica primero" y no
  ofrecen "Marcar…". Una campaña **terminada** con indicadores **aplicables**
  incompletos (p. ej. Institucional sin CSM) sigue apareciendo como *terminada
  con pendientes* en el Dashboard (alerta `finished-pending`), aunque los testigos
  no apliquen. En campañas **terminadas** (fecha de fin ya pasada) y **ya
  clasificadas** aparece un botón por fila: **"Marcar todas"** (Proveedor: marca
  los cinco) o **"Marcar aplicables"** (Institucional: marca solo Link, Validación
  Liverpool y CSM). Cada campaña tiene
  además una **bitácora de comentarios** (`comments[]`,
  historial con autor y fecha) en un panel expandible; los comentarios se agregan
  al final y no se borran desde el cliente. Clasificación
  **Institucional/Proveedor** obligatoria
  (se elige en la importación cuando el `tipo` no es inequívoco; nunca se asume
  Proveedor). Fechas civiles (sin desfase por zona horaria): T Arranque vence al
  **5.º día hábil inclusivo** desde el inicio (solo se excluyen sábado/domingo;
  aún sin festivos); T Completos vence en `fechaFin`. Objetivo de arranque =
  `Math.ceil(tiendasDistintasConsolidadas * 0.10)`. En esta fase **no** se suben
  evidencias ni se seleccionan tiendas individuales. Permisos: la matriz reserva
  `tracking.write` a admin/operator, pero en **pre-lanzamiento** las reglas
  permiten escribir a cualquier autenticado (como el resto de colecciones); el
  control por rol se activará antes de liberar. `read` requiere autenticación;
  **sin borrado físico** desde el cliente. Fechas mostradas en `dd/mm/aaaa`.
- **Estado de ciclo de vida operativo (Activa/Cancelada)**: campo tipado
  `lifecycleStatus: 'active' | 'cancelled'` (más `lifecycleUpdatedAt`,
  `lifecycleUpdatedByUid/Email` y `cancellationReason: string | null`) en el
  documento de seguimiento. **Solo afecta al seguimiento operativo**: no toca
  ejecución, consolidación, CSV/ZIP, Excel, PPT ni baja ocupación, y **las
  canceladas siguen contando** en la carga por tienda/soporte del Dashboard.
  Reglas: (1) documentos legacy sin el campo se interpretan como `active`
  (`normalizeTracking`, aplicada en lecturas **y** dentro de las transacciones);
  (2) cancelar/reactivar son transiciones **transaccionales y puras**
  (`cancelTracking`/`reactivateTracking` en `trackingFactory.ts`) que **no**
  modifican checks, clasificación ni comentarios; (3) una campaña cancelada no
  requiere checks (se muestran "No aplica"), no genera alertas/pendientes/
  vencimientos y queda **fuera** del resumen operativo del Dashboard (se filtran
  las filas aplicables antes de calcular todas las secciones); (4) `updateCheck`
  y `markAllChecks` **rechazan** cambios sobre una cancelada (`TrackingError`);
  `updateClassification` y `addComment` siguen permitidos; (5) el estado
  sobrevive a actualizaciones de la misma línea lógica (mismo `campaignId`); (6)
  `cancellationReason` vacío se persiste
  como `null` y se limpia al reactivar; al reactivar los checks reaparecen tal
  cual estaban. Las reglas de Firestore validan el enum y los tipos de estos
  campos; la lectura no los exige (compatibilidad legacy).
- **Reimportación y emparejamiento**: coincidencias exactas usan
  `campaignIdentity` como huella; una única campaña entrante y una única guardada
  con el mismo nombre se actualizan conservando `campaign.id`. Si varios
  homónimos cambian y no hay correspondencia inequívoca, SIGNAM bloquea el
  guardado hasta que el usuario los empareje. Un cambio de nombre siempre pide
  confirmación. Las ausentes se inactivan (`active:false`), no se borran. Las
  fechas vacías, imposibles, invertidas o con año fuera de `2000–2100` son
  errores bloqueantes y **no se escribe ninguna campaña**. Después de cada
  guardado se vuelve a leer campañas y seguimiento: toda campaña activa debe
  tener seguimiento por `campaign.id` (o por identidad legacy). Los fallos de
  inicialización se reportan por campaña y el reintento es idempotente; nunca
  se sobrescriben checks manuales ni el ciclo de vida existente.
- **Correcciones manuales de campaña**: admin/operator pueden corregir desde
  Campañas únicamente fechas, link, mes, vendido por y tipo; nombre, soportes y
  tiendas siguen bajo control de la importación. Cada guardado exige motivo,
  conserva `campaign.id`, recalcula `signature`, registra un evento append-only
  en `campaigns/{campaignId}/corrections` y guarda el valor como
  `manualOverrides`. Los overrides prevalecen sobre reimportaciones posteriores;
  nunca reinician checks, comentarios, Ekon ni ciclo de vida. Si falta el
  seguimiento, la corrección intenta crearlo de forma idempotente y solicita
  clasificación cuando `tipo` no sea inequívoco.
- **Corrección de fechas en la importación**: una campaña **nueva** cuya
  vigencia de origen es inválida (año fuera de 2000–2100, texto no interpretable
  o inicio posterior a fin) bloquea la importación. Se puede corregir su fecha
  desde la propia pantalla de importación **sin modificar el archivo**: la
  corrección se aplica en memoria (por fila de origen) para desbloquear y, al
  guardar, se persiste como `manualOverrides` del alta más un evento en su
  bitácora `corrections`, idéntica a una corrección de Campañas. Las campañas ya
  existentes con fecha inválida se corrigen desde Campañas, no aquí.
- **Mapeo calendario↔catálogo**: columna del maestro `NORMALIZACION LIVERPOOL`
  (metadato `calendarSupport`); el cruce es por `Numero de Tienda` +
  `calendarSupport`.
- **Excepción de Guadalajara Galerías**: solo tienda 78 + `VIDEO WALL CRIUS`
  (ver `GUADALAJARA_GALERIAS_EXCEPTION`).
- Pantallas inactivas: permanecen con su historial pero no consolidan ni generan
  filas de CSV; una campaña que las solicite produce una incidencia explícita.

## Integración Ekon (no romper sin decisión documentada)

Dominio puro en `src/domain/ekon`, servicios en `src/services/ekon*.ts`, módulos
`src/modules/ekon-import` y `src/modules/reconciliation`. Colecciones nuevas y
**separadas**: nunca modifican `campaigns`, el catálogo Admira ni el seguimiento.

- **Autoridad entre fuentes**: Ekon es autoritativo del número de campaña,
  producto, tipo, periodos ERP y artículo/circuito; **Liverpool** manda en fechas
  exactas, tiendas operativas y soportes solicitados; el **Master Admira** resuelve
  las pantallas físicas. La conciliación **compara**, nunca corrige ni mueve
  asociaciones.
- **Identidad estable de asignación**: `Año + Campaña + Línea campaña +
Determinante + Artículo` (`identity.ts`). Perfilado sobre el archivo real
  (21 327 filas → 21 317 llaves; 10 colisiones son la misma asignación con solo
  `Importe neto` distinto; **0** llaves multi-periodo). Un cambio de periodo es
  **modificación** de la misma asignación, no alta+baja. **No** incluir periodo,
  fechas, importe ni factura en la identidad (van al fingerprint).
- **Estados**: `Nueva`, `Sin cambios`, `Modificada`, `No incluida`, `Restaurada`,
  `Conflicto` (`diff.ts`). `No incluida` solo dentro del **alcance de periodos
  confirmado**; fuera del alcance, intacta. Nunca se borra: se marca inactiva y se
  conserva historial (`ekonRevisions`).
- **Tipos de campaña Ekon → Ratio** (`campaignType.ts`, **distinto** de baja
  ocupación): Institucionales/Liverpesos = Ratio 3 sin testigos; Liverpool/General
  = Ratio 1 con testigos. Campaña mixta con ≥1 línea Ratio 1 → Ratio 1 global. No
  toca el módulo de baja ocupación ni el seguimiento.
- **Determinante `0` = Centro Administrativo**: no es tienda, no se concilia como
  tienda, no genera incidencia de tienda faltante, nunca se programa. Solo las
  filas con determinante real `0` quedan fuera de la conciliación de tienda.
- **Mapeo circuito Ekon ↔ soporte Liverpool** (`supportMapping.ts`): tabla cerrada
  y probada; alias `MEGA MUPI DIGITAL → MEGA MUPI`. La conciliación acepta
  cualquiera de los soportes permitidos del circuito (sin igualdad literal).
- **Fallback CSV** (`fallbackCsv.ts` + `modules/consolidation/ekonFallback.ts`):
  solo `MEGA MUPI DIGITAL` (desde `MEGA MUPI`) y `BANNER DIGITAL` (desde
  `ESPECTACULAR IN STORE`). Precedencia: si Liverpool marca el soporte, se usa el
  flujo Liverpool y **no** hay fallback (nunca ambos). Requiere vínculo manual
  Ekon y lote completado; solo asignaciones vigentes. Conserva fechas y universo
  de tiendas Liverpool; el Master resuelve pantallas por `Numero de Tienda` +
  `NORMALIZACION LIVERPOOL`. Sin tiendas operativas → **bloquea**, nunca expande a
  todas. El CSV conserva encabezados, columna guarda, BOM, escape y llave
  `Campaña + RESOLUCION` (reutiliza `consolidate`).
- **Asociación campaña ↔ Ekon**: sigue siendo **manual y muchos-a-uno** en
  `campaignEkonLinks`; la importación Ekon nunca la crea ni la mueve. Un cambio de
  número Ekon no reasocia campañas automáticamente.
- **Idempotencia**: `contentHash` del contenido normalizado; reimportar el mismo
  archivo y alcance no duplica. Un fallo a mitad deja el lote sin `completed` y es
  reintentable (el diff se recalcula sobre el estado vigente).
- Eliminación física de pantallas: existe en el catálogo (`deleteScreen`) para
  limpiar registros de prueba o cargados por error. **Inactivar es la acción
  preferida** (conserva historial); no se deben eliminar pantallas ya
  referenciadas por exportaciones. Antes de liberar se restringirá a admin.

## Operación Digital multirretailer

- La Comer y Chedraui con `COPETE DIGITAL` viven exclusivamente en las ocho
  colecciones `digital*` y en Storage bajo `digital-imports/`. Una importación
  digital nunca escribe en `campaigns`, `screens`, `campaignEkonLinks`,
  consolidaciones, `csvExports` ni seguimiento Liverpool.
- El alcance se decide por coincidencia exacta normalizada contra perfiles
  activos del catálogo. No se buscan palabras en creatividad u observaciones.
- La identidad de fila es año + campaña + línea + retailer + soporte +
  creatividad + periodo. La identidad operativa omite la línea. Los originales
  conservan las 39 columnas y su orden.
- `Tipo Fijación` es autoritativo: Fijación → `fixation`, Revisión →
  `continuous`; desconocidos bloquean. Los conflictos y duplicados requieren
  confirmación y nunca se suman automáticamente.
- El seguimiento digital tiene exactamente tres checks (link, validación de
  cadena y programación CMS). No usa testigos, objetivos, días hábiles, Admira,
  PPT, CSV/ZIP ni los reportes Excel Liverpool.
- Las ausencias solo se inactivan dentro de catorcenas confirmadas. Nunca hay
  borrado físico y una reimportación conserva checks, comentarios y cancelación.

## Comandos

```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run format        # antes de commitear
```

Cloud Functions (`functions/`) tienen su propio `package.json` y `tsconfig`:

```bash
cd functions && npm install && npm run build
```

## Seguridad

Las reglas de Firestore/Storage son la fuente de verdad del control de acceso.
`src/app/permissions.ts` es solo para la UI. Si cambias permisos en el cliente,
actualiza también `firestore.rules` / `storage.rules`.
