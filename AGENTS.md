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
  varios artículos con ` + `, deduplicando en orden de aparición.
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
  T Completos siga marcado. En campañas **terminadas** (fecha de fin ya pasada)
  aparece un botón **"Marcar todas"** por fila que marca los cinco indicadores de
  golpe. Cada campaña tiene además una **bitácora de comentarios** (`comments[]`,
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
  confirmación. Las ausentes se inactivan (`active:false`), no se borran.
- **Mapeo calendario↔catálogo**: columna del maestro `NORMALIZACION LIVERPOOL`
  (metadato `calendarSupport`); el cruce es por `Numero de Tienda` +
  `calendarSupport`.
- **Excepción de Guadalajara Galerías**: solo tienda 78 + `VIDEO WALL CRIUS`
  (ver `GUADALAJARA_GALERIAS_EXCEPTION`).
- Pantallas inactivas: permanecen con su historial pero no consolidan ni generan
  filas de CSV; una campaña que las solicite produce una incidencia explícita.
- Eliminación física de pantallas: existe en el catálogo (`deleteScreen`) para
  limpiar registros de prueba o cargados por error. **Inactivar es la acción
  preferida** (conserva historial); no se deben eliminar pantallas ya
  referenciadas por exportaciones. Antes de liberar se restringirá a admin.

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
