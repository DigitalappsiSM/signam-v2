# Guía para agentes — SIGNAM V2

Lee este archivo antes de modificar el repositorio. Complementa al `README.md`.

## Deriva entre código y documentación

Este documento y `CLAUDE.md` no son material de apoyo: `CLAUDE.md` se carga
automáticamente en cada sesión de IA y este fichero es la especificación
autoritativa de las reglas de negocio. Cuando el código cambia y ellos no, la
siguiente persona o la siguiente IA actúa sobre reglas falsas. Ya pasó: durante
días la documentación afirmó que el informe «no extrapola» mientras el código
extrapolaba.

Por eso CI ejecuta en cada pull request `scripts/check-docs-freshness.mjs`, que
**bloquea el merge** si se toca código sensible sin abrir el documento que lo
especifica. El mapeo vive en las `RULES` de ese script y se prueba en
`scripts/check-docs-freshness.test.mjs`; al añadir una regla de negocio nueva,
añade también su entrada.

El guardia no valida el contenido —ninguna máquina puede— sino que alguien
revisara el fichero correcto. Si un cambio de verdad no altera nada documentado,
`[skip-docs]` en el cuerpo del PR lo omite y deja constancia de quién lo decidió.

Lo que sí es comprobable lo comprueba `src/tests/docsInvariants.test.ts`: ata los
**literales** de este documento y de `CLAUDE.md` a las constantes del código —la
fila 1 del CSV tal y como la escribe el serializador, el encabezado definitivo y
el heredado, el valor constante de `RETAILERS` y un ejemplo de nombre de campaña
generado por `buildAdmiraCampaignName`—. Si el código cambia y aquí no, falla.

Por eso este fichero es la **única fuente normativa**. `README.md` y
`docs/CONTEXTO.md` describen qué hace la aplicación y enlazan aquí en lugar de
repetir las reglas; la misma prueba comprueba que no vuelvan a copiarlas. La
duplicación no era teórica: la misma regla llegó a vivir en cuatro ficheros y
tres de ellos describían mal el separador de artículos.

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
- **Nombre de campaña Admira**: `<Campaña>_ <ARTICULOS>` (espacio tras `_`).
  Varios artículos se unen con **espacio, signo más y espacio**, deduplicando en
  orden de aparición. El ejemplo canónico, generado por el propio código y atado
  por `src/tests/docsInvariants.test.ts`, es:
  `Nike Verano_ ARTICULO 1 + ARTICULO 2`.
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
  incompletos (p. ej. Institucional sin CSM) sigue apareciendo como _terminada
  con pendientes_ en el Dashboard (alerta `finished-pending`), aunque los testigos
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
  aún sin festivos); T Completos: la entrega arranca el día inmediato posterior
  al fin de campaña y hay **4 días naturales** para completarla, por lo que vence
  en `fechaFin` **+ 4 días naturales** (`WITNESS_COMPLETE_GRACE_DAYS`). Objetivo de arranque =
  `Math.ceil(tiendasDistintasConsolidadas * 0.10)`. En esta fase **no** se suben
  evidencias ni se seleccionan tiendas individuales. Permisos: la matriz reserva
  `tracking.write` a admin/operator y las reglas de Firestore aplican la misma
  restricción. `viewer` y `commercial` son solo lectura. `read` requiere autenticación;
  **sin borrado físico** desde el cliente. Fechas mostradas en `dd/mm/aaaa`.
- **Perfil Comercial**: rol `commercial`, independiente de `viewer`. Su lista
  cerrada de rutas es Panel (`/`), Campañas (`/campanas`) y Seguimiento operativo
  (`/seguimiento`); escribir cualquier otra ruta redirige al Panel. Ve todas las
  campañas, el detalle completo (Ekon solo como texto), checks, vencimientos,
  comentarios y cancelaciones. No corrige campañas, no vincula Ekon, no modifica
  seguimiento y no accede a Storage. Su única descarga es el informe Quividi en
  PDF o Excel; no ve contenido creativo, PPT, PDF de errores, Excel general,
  CSV, ZIP ni exportación masiva. Firestore permite únicamente las lecturas que
  requieren esos tres módulos y bloquea todas sus escrituras.
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
  `calendarSupport`. Un comentario presente sin números de tienda nunca equivale
  a circuito completo: queda con alcance `invalid`, bloquea el guardado y se
  resuelve en la importación seleccionando tiendas activas del soporte o
  confirmando explícitamente “todas”. Los marcadores inequívocos `TODAS`,
  `TODAS LAS TIENDAS` y `TODAS LAS PANTALLAS` se aceptan como alcance global.
  Las resoluciones humanas se recuerdan por `soporte + comentario` en
  `storeCommentResolutions`; si una tienda seleccionada deja de estar activa o
  cambia de soporte, se solicita confirmación nuevamente. Los documentos legacy
  sin `scope` conservan compatibilidad: lista vacía = todas, lista poblada =
  selección.
- **Alcance Quividi por cocomercialización**: esta regla es exclusiva del
  reporte de audiencia y no cambia la autoridad general de Conciliación/CSV.
  Tiendas explícitas del Calendario mandan; “todas” explícito usa circuito
  completo. Sin comentario, `VIDEO WALL CRIUS` y
  `VIDEO WALL POSTER LED` usan circuito completo; los demás soportes intentan
  completar el alcance desde la campaña Ekon vinculada, usando solo
  determinantes físicos vigentes, sin conflicto, con periodo solapado y circuito
  compatible. El resultado es derivado: nunca escribe tiendas Ekon dentro de
  `campaigns`. Las importaciones nuevas guardan `scopeSource` para distinguir
  “sin comentario” de “todas” explícito.
  Para Quividi, `MUPPI'S` se resuelve como `MEGA MUPI DIGITAL` (alias
  tolerado `MEGAMUPI DIGITAL`) y `PENDON` como `BANNER DIGITAL`.
- **Salud operativa Quividi por cámara**: colección backend-only
  `quividiCameraHealthDaily`, con identidad idempotente
  `YYYY-MM-DD__locationId`. Se deriva del catálogo activo de `screens`,
  nunca del alcance de una campaña. La identidad preferida es
  `Numero de Tienda + calendarSupport + quividiLocationId`; el alias
  `quividiCameraName` queda como referencia visual y fallback temporal para
  registros legacy. El job diario migra de forma conservadora los registros que
  solo tienen alias cuando ese alias coincide con una única location Quividi, y
  sincroniza el alias canónico cuando ya existe Location ID. El proceso diario consulta una ventana móvil de 28 días para
  conservar el baseline de duración de la medición existente y persiste el último
  día completo; si la colección está vacía, el primer ciclo carga los 28 días.
  Existe un backfill administrativo explícito de 1–90 días. Un nombre de cámara
  asignado a más de una tienda/soporte se excluye y se reporta como ambigüedad.
  Además del resumen diario, se consulta OTS a resolución `1h` y se persiste la
  cobertura operativa de **10:00–22:00**, separando la ventana núcleo
  **11:00–22:00**: la hora 10:00–11:00 es tolerancia de arranque porque algunas
  tiendas encienden sus cámaras hasta las 11:00. La salud futura debe evaluarse
  al cierre del día, no generar una alerta inmediata por ausencia a las 10:xx.
  `measurementStatus` y `hasOts` son señales distintas: **OTS = 0 no equivale
  por sí solo a avería técnica**.
- **Motor de salud Quividi (Fase 2.2)**: la salud vigente se decide **solo con el
  último día completo**. El histórico se usa únicamente para calcular desde
  cuándo persiste una anomalía; una caída antigua ya recuperada **no crea alerta
  retroactiva**. La evaluación usa la ventana núcleo 11:00–22:00 y conserva
  10:00–11:00 como tolerancia de arranque. Estados: `normal`,
  `no_measurement` (0 horas núcleo con medición), `partial_measurement`
  (cobertura núcleo <80%) y `no_ots` (cobertura suficiente pero OTS núcleo = 0).
  Una sola incidencia puede cambiar de tipo mientras siga sin existir un día
  normal entre medias. `quividiCameraHealthAlertState/{locationId}` mantiene el
  estado actual/puntero y es además el **punto de serialización transaccional por
  cámara**: scheduler y backfill no pueden dejar dos incidencias activas para el
  mismo `locationId`. `quividiCameraHealthAlerts/{locationId__inicio}` conserva
  cada incidente. Al volver a normal, la incidencia activa pasa a `recovered`
  usando como `recoveredDate` el **primer día normal observado** y como
  `lastAnomalousDate` el último día anómalo previo. Si una cámara deja el scope
  activo (inactiva, borrada, ambigua o sin mapeo Quividi), su incidencia no se
  marca como recuperada: pasa a `retired` con razón `out_of_scope` y su estado
  queda `monitored:false`. Si faltan días entre la última evaluación persistida
  y el histórico recibido (por ejemplo, un backfill demasiado corto), SIGNAM no
  asume continuidad: retira la incidencia previa con `history_gap` y abre una
  nueva desde el último día observado. Una cámara que vuelve al scope después de
  estar `monitored:false` también inicia una incidencia nueva y nunca reactiva
  un documento histórico `recovered`/`retired`. **No se abre ningún ticket
  automáticamente**.
- **UI Salud de cámaras**: ruta `/salud-camaras` dentro de Operación. Consume
  únicamente una callable autenticada de solo lectura sobre los estados ya
  calculados; abrir o refrescar la pantalla **no vuelve a consultar VidiCenter**.
  Presenta resumen actual, estados por cámara y recuperaciones recientes.
  `Catálogo Admira` permite capturar y validar `quividiLocationId`; al
  validarlo contra Quividi se guarda también el alias canónico.
- **Reporte comercial de audiencia (PDF)**: la descarga para marcas es una vista
  agregada del resultado de campaña. No publica tráfico, ranking ni rendimiento de
  una tienda individual por nombre salvo en «Tiendas TOP» (ver más abajo, que
  publica agregados ajustados, nunca incidencias). El detalle técnico por
  tienda/cámara y las métricas operativas permanecen en el Excel técnico.
- **Estado del proyecto: Fase 1 de 2.** El PDF describe seis secciones —
  Portada, Evolución, Audiencia, Horarios, Tiendas TOP, Cierre— construidas sobre
  el mismo motor de extrapolación **día/par** que ya existía (`brandCampaignSummary`,
  `brandDaily`, `brandWeeklyEvolution`). La Fase 2 —un motor de extrapolación
  **hora a hora** que complete huecos horarios distinguiendo «hora que debía
  medir y no reportó» de «hora fuera de operación»— está **bloqueada**: SIGNAM
  no tiene hoy ninguna fuente fiable del horario de apertura/cierre por soporte
  (se buscó en `src/domain/quividi.ts`, en el Catálogo Admira y en la ventana de
  «Salud de cámaras», que es una regla de evaluación global de 10:00–22:00, no un
  horario real por tienda). Mientras esa fuente no exista o no se decida una
  aproximación explícita, no se debe: (a) completar horas sin dato en el Excel
  con una hoja «Detalle de extrapolación» hora a hora, ni (b) aplicar un factor
  horario a `brandHourlyDistribution` para convertirlo en «OTS ajustados por
  hora». Quien retome la Fase 2 debe traer esa decisión documentada aquí antes
  de tocar el motor horario.
- **KPIs del PDF comercial**: una sola cifra de OTS de campaña en portada (sin
  desglosar medido/extrapolado como cifras protagonistas separadas), OTS
  promedio diario, dwell time promedio ponderado por watchers, y vigencia. La
  portada **no** lleva ningún pie con reparto de OTS entre tiendas con/sin
  medición — desde la Fase 3 ese indicador se movió al pie de la página de
  Evolución (ver el punto «Pie de página relocalizado» más abajo) y se
  simplificó a un % por conteo de tiendas, no por OTS. No se muestran Watchers
  ni Conversion Rate en ningún punto del PDF. Los segmentos de audiencia se
  comunican únicamente como distribuciones porcentuales agregadas (género, edad,
  hora), nunca como conteos absolutos. El campo «Retailer» no existe en el PDF.
- **Circuito medible y extrapolación**: la cifra publicada cubre
  **únicamente los formatos de soporte con medición** durante la vigencia
  (`brandMeasurableScope`). Un formato sin ninguna cámara —CRIUS, Poster LED,
  video walls no instrumentados— **queda fuera del OTS**: aplicarle el promedio
  de un mupi supondría que un pasillo y un atrio ven pasar a la misma gente.
  Dentro del circuito medible se extrapola **formato a formato**, cada uno con
  su propio promedio de OTS por par-día medido, nunca con un promedio único del
  circuito.

  El promedio de cada formato se calcula sobre sus par-día **medidos** y no
  sobre su rejilla completa: si los días sin dato entraran al numerador como
  cero, deflactarían el promedio que luego rellena el resto, un sesgo que crece
  con la vigencia (despreciable por debajo de ~14 días, por encima del 20 % a
  partir de 60). Todo hueco dentro de un formato medible recibe el mismo
  tratamiento, sea un soporte sin cámara o un día que la cámara no reportó. Un
  OTS observado en `0` (cámara activa, cero personas detectadas) es un dato
  real y **nunca** se trata como hueco.

  El porcentaje de cobertura por tienda y por tienda-día (`brandCoverage`) se
  conserva como referencia operativa del despliegue de cámaras. El divisor por
  tienda sigue siendo el universo de campaña: una tienda con sólo formatos no
  medibles deja el reparto conservador, que es el sentido seguro para un dato
  que va a marca.

- **Evolución (`brandDaily`/`brandWeeklyEvolution`) concilia con el total de
  portada.** Cada día se extrapola **formato a formato** con el mismo promedio
  por par-día medido que `brandCampaignSummary`: el hueco de un formato en un
  día concreto se completa con el promedio de ese mismo formato, nunca con un
  factor único de circuito. Esto es lo que garantiza la identidad `suma de
  `brandDaily(...).estimatedOts` === `brandCampaignSummary(...).estimatedOts``
  (antes de esta fase, `brandDaily` escalaba cada día con un único factor
  `totalPares/paresMedidos`, que no reconciliaba con la extrapolación por
  formato de portada cuando había más de un formato — se corrigió aquí).
  Si la vigencia es de **28 días o menos**, el PDF dibuja una barra por día
  (día de la semana + día del mes en el eje). Por encima de 28 días dibuja
  `brandWeeklyEvolution`: semanas **de lunes a domingo**, con **semanas
  parciales en los extremos** de la vigencia, sumando (nunca promediando) los
  días de cada semana — también concilia con el total.
- **El PDF no publica incidencias de medición**: qué soporte falló un día
  concreto es operación interna y de cara a la marca sólo añade ruido. El
  detalle de completo / parcial / sin dato / sin cámara vive en la hoja
  «Auditoría de cifras» del Excel.
- **Hoja «Auditoría de cifras» del Excel**: el Excel técnico incluye una hoja que
  reconstruye paso a paso la cifra del PDF — universo contratado, reparto
  exhaustivo de la rejilla par-día (completo / parcial / sin dato / sin cámara),
  la cadena aritmética de OTS medidos a OTS estimados, las dos lecturas de
  cobertura y la aportación por tienda. Consume las **mismas funciones puras**
  que el PDF (`quividiBrandReport.ts`), nunca recalcula: una discrepancia entre
  hoja e informe debe ser imposible por construcción. Es la única vista que
  desglosa por tienda, y existe sólo para auditar la construcción del agregado.
  Nueve secciones numeradas:
  1. Universo contratado. 2. Qué se midió realmente. 3. Construcción de la
  cifra formato a formato — la tabla trae, por formato, **dos columnas de
  motivo del hueco** («Extrapolados: sin dato» / «Extrapolados: sin cámara»,
  `brandExtrapolationByReason`), y dos filas de totales agregadas
  inmediatamente después de «De los cuales, extrapolados»: `missingOts` (días
  sin dato con cámara instalada) y `uncoveredOts` (soportes sin cámara),
  cuya suma reconcilia exactamente con `extrapolatedOts` sin recalcularlo
  — Fase 2 seguía pendiente de este desglose a nivel **hora**; a nivel **día**
  ya está resuelto. 4. El circuito por formato. 5. Cobertura — dos lecturas
  distintas (por tienda vs. por tienda-día). **6. Clasificación informativa
  vs. clasificación técnica**: hace explícito que el % de OTS atribuido a
  «tiendas con medición» (`brandStoreAttribution().measuredStoresSharePercent`,
  clasifica tiendas) y el % de «OTS medidos» sobre el total
  (`summary.measuredOts / summary.estimatedOts`, clasifica par-día) casi nunca
  coinciden — son la clasificación informativa que antes vivía en el pie de
  portada y la clasificación técnica del Excel, ahora una junto a la otra para
  que la diferencia sea imposible de pasar por alto. 7. Derivados del informe.
  **8. Aportación por tienda — observado y ajustado**: además del OTS medido
  (crudo, para trazabilidad), cada tienda trae su **OTS ajustado**
  (`brandStoreAttribution().stores[].adjustedOts`, «—» si su único soporte es
  un formato sin medición), y la tabla cierra con tres filas que reconstruyen
  el total de portada: OTS ajustados de tiendas con medición (suma) + OTS de
  tiendas sin medición (residuo) = OTS estimados de campaña. 9. Regla
  aplicada. Sigue pendiente de Fase 2 (bloqueada por la falta de horario de
  operación descrita arriba): la hoja «Detalle de extrapolación» hora a hora
  que pide el encargo de negocio, con una fila por tienda/formato/fecha/hora
  estimada.
- **Multi-cámara**: se mantiene la agregación vigente de tienda+soporte para
  todo el circuito, en el PDF y en el Excel. **Única excepción: Insurgentes**.
  Sus dos cámaras están en pisos distintos y miden zonas diferentes; para la
  vista comercial (portada, evolución, Tiendas TOP) sus OTS válidos se suman
  como zonas independientes y no se promedian (`brandSupportDays`). Esta
  excepción no cambia la agregación técnica general ni las hojas técnicas del
  Excel, que conservan el promedio de cámaras válidas.
- **Tiendas TOP (`brandStoreAttribution`)**: página con título exacto «Tiendas
  TOP», maquetada como **leaderboard de una sola columna** (no tabla de dos
  columnas: rompería el orden visual del ranking) — rango, nombre de tienda,
  barra horizontal proporcional al OTS ajustado y minibarra de dwell time a la
  derecha; la fila #1 lleva acento rosa, el resto gris. Lista únicamente
  tiendas con al menos una jornada de medición directa en algún momento de la
  vigencia (`everMeasured`), con su OTS ajustado (dato propio más los huecos
  de la tienda completados al promedio de su formato) y su dwell time
  ponderado por watchers. Se pagina automáticamente cada **8** filas
  (`TOP_STORES_ROWS_PER_PAGE`) si el listado no cabe en una página, con
  eyebrow de continuación `«04 · TIENDAS TOP — CONTINUACIÓN»` (em-dash, nunca
  paréntesis — ver la nota de escape de `tracking` más abajo). La página **no**
  explica que la suma de la tabla difiere del total de portada ni detalla el
  caso Insurgentes: es ruido metodológico que la marca no necesita: ambas notas
  se retiraron a partir de la Fase 3 por pedido explícito («no generar ruido a
  la marca»); la aclaración completa sigue disponible solo en el Excel técnico.
- **Pie de página relocalizado (Fase 3): un solo indicador, solo en
  Evolución.** El PDF ya no publica en portada ni en Tiendas TOP ninguna
  cifra de cobertura de medición. El único lugar donde aparece es el pie de la
  página de Evolución, como nota discreta en gris a la derecha:
  `«<%> tiendas con cámara · <%> tiendas proyectadas»`, calculada por
  **conteo de tiendas** (`brandCoverage(report).measuredPercent` /
  `estimatedPercent`), no por par-día ni por OTS. Es intencional que esta cifra
  no coincida con `scope.measuredPercent`/`brandExtrapolationBasis` del Excel
  (que clasifican **par-día**, no tiendas): son dos clasificaciones distintas
  y el PDF nunca las etiqueta como «real vs. extrapolado».
- **Distribución horaria (`brandHourlyDistribution`) es descriptiva, no
  extrapolada.** Reparte en porcentaje los OTS **con medición directa** por
  hora del día (0–23), a partir de `supportHours`. A diferencia de
  `brandDaily`/`brandWeeklyEvolution`, **no completa horas sin dato**: por el
  bloqueo de Fase 2 descrito arriba, no hay manera de distinguir hoy una hora
  sin medición de una hora en la que el soporte estaba apagado. El pie de la
  gráfica lo declara («con medición directa») para no sugerir una precisión que
  el dato no sostiene. Si el reporte no trae `supportHours`, el bloque se omite
  en vez de dibujar ceros.
- **No existe cruce hora × demografía — bloqueo de datos, no de diseño.** El
  mockup aprobado de la página «Horarios» incluía un corte mañana/tarde/noche
  por género y edad; **no se implementó en el generador real** porque el
  esquema no lo permite: `QuividiDemographicRow` no trae `hour` y
  `QuividiSupportHour` no trae `gender`/`age` — ninguna fuente une hora del día
  con demografía. `horariosPage()` en `quividiCampaignPdf.ts` se limita al
  reparto horario simple (`brandHourlyDistribution`, ver punto anterior). Si
  Quividi llega a exponer ese cruce, se puede portar el mockup tal cual; hasta
  entonces no intentar aproximarlo con los datos actuales (mezclar `supportHours`
  y `demographics` por fecha, sin hora, daría un cruce falso).
- **Composición por género por día (`brandGenderByDay`)**: porcentaje diario de
  mujeres/hombres/no identificado sobre lo observado ese día (o agregado por
  semana natural cuando la vigencia supera 28 días, ponderado por watchers). El
  género «no identificado» se conserva tal cual lo reporta Quividi y nunca se
  redistribuye entre mujeres y hombres para forzar que ambos sumen 100. En la
  página «Audiencia», la tendencia día a día se dibuja como **dos líneas**
  (`sparkline()` en `quividiPdfKit.ts`), nunca barras apiladas (rechazado
  explícitamente por diseño: «no quiero que sean apilados»); ambas líneas
  **comparten un único dominio** de escala (mín/máx combinado de las dos
  series, con margen) para que la variación día a día se compare correctamente
  entre géneros — normalizar cada línea por separado exagera visualmente
  diferencias mínimas (bug encontrado y corregido en Fase 3). El resumen de
  cabecera de género (mujeres/hombres/no identificado) se lee de `brandGender()`
  y **no** de `brandGenderAge()`: la pirámide de `brandGenderAge()` ya excluye
  «no identificado» y renormaliza a 100, así que derivar el «no identificado»
  de ella siempre da 0 (bug encontrado y corregido en Fase 3).
- **Tono y metodología del PDF**: es un reporte de resultados para marketing, no
  un documento de auditoría. El cierre reemplaza la antigua explicación
  metodológica de tres notas por recomendaciones comerciales breves, calculadas
  de los propios datos de la campaña (día de mayor audiencia, hora de mayor
  tránsito, rango de edad dominante) y con la advertencia explícita de que la
  audiencia medida no prueba ventas. La metodología técnica completa —
  incidencias, detalle de cámaras, cadena aritmética— vive únicamente en las
  hojas «Metodología» y «Auditoría de cifras» del Excel. La portada presenta la
  cifra como `OPORTUNIDADES DE VER · OTS` y no la califica de estimada. A
  partir de la Fase 3 esto se extiende a toda página interior: no hay leyendas
  ni citas que describan el método de extrapolación (por ejemplo «OTS
  ajustados»), ni notas de descargo sobre proyección de tiendas/horas fuera del
  pie relocalizado de Evolución — cualquier fraseo de ese tipo que reaparezca
  en una página distinta a la Evolución es una regresión, no una decisión de
  redacción libre.
- **Look & feel del PDF comercial (Fase 3): dashboard SaaS minimalista sobre
  A4 horizontal.** Lienzo **apaisado** 1123×794 px (297×210 mm) — se evaluó
  vertical y horizontal y se optó por horizontal para dar más ancho a las
  gráficas de tendencia y evitar áreas en blanco. Un solo visual dominante por
  página (una gráfica, un leaderboard, una pirámide), sin fondos de tarjeta
  en azul pálido, con barras delgadas (≤26 px) y etiqueta de valor en cada
  barra. Cada página de datos cierra con una fila de 3–4 conclusiones
  calculadas de los propios datos de la campaña (promedio, día/hora pico,
  delta fin de semana, etc.) en vez de un párrafo metodológico o una cita —
  reemplazo explícito de las leyendas de método de la Fase 1/2. Iconografía
  lineal propia (`clockIcon`, `calendarIcon`, `eyeIcon`, `trendIcon`,
  `peopleIcon` en `quividiPdfKit.ts`, dibujados con primitivas de jsPDF, sin
  assets externos) junto a las cifras clave de cada eyebrow/stat. Estructura
  fija de **seis páginas**: Portada, Evolución, Audiencia, Horarios, Tiendas
  TOP, Cierre — ver el punto de paginación más abajo. En los gráficos de
  género, rosa es **siempre** mujeres y azul **siempre** hombres — por
  identidad, nunca por posición o ranking — con `GRAY_DARK` (`quividiPdfKit.ts`)
  para «no identificado»; antes de esta fase el bloque superior de género
  coloreaba por orden de magnitud, lo que pintaba de rosa al género
  mayoritario aunque fuera masculino. Las fotografías **nunca ocupan una
  sección completa ni se cortan en seco**: se integran dentro de un bloque
  navy y se disuelven en él con degradados — y **nunca llevan blur**: se
  probó difuminar la foto completa para integrarla al fondo navy y se
  descartó explícitamente («el punto es que se distinga perfectamente el
  soporte»); solo el degradado navy cubre el lado del texto, la fotografía en
  sí queda nítida. Como jsPDF no dibuja degradados, `quividiPdfKit.ts` los
  compone
  con **rectángulos acumulativos anclados a un borde**: tiras contiguas dejan
  bandas visibles (cada borde compartido se suaviza por su lado y asoma un
  hilo de imagen sin velar) y solaparlas produce líneas oscuras, porque la
  opacidad se compone como `1-(1-a1)(1-a2)`. Cada `fade` cubre un solo sentido
  y sus `stops` deben ser **no crecientes**; un degradado de dos lados son dos
  llamadas. Las fotos se recortan con `photoCover`, que emula `object-fit:
  cover` y **exige pasar `null` como estilo a `doc.rect`** para que el trazado
  sirva de recorte: sin él jsPDF lo traza, cierra el trazado y `clip` recorta
  la página entera, haciendo desaparecer la imagen sin que nada falle.

  Los assets viven en `public/report-assets/` y deben ser **JPEG o PNG con
  cabecera de dimensiones legible**: jsPDF no soporta WebP y, si no puede leer
  el tamaño, la imagen se dibuja deformada al marco. El logotipo del informe es
  `instore-media-color.png`, **no** el de `assets/ppt`, que es la versión blanca
  para diapositivas oscuras y sobre el blanco del informe resulta invisible.
  Un texto que use `tracking` (interletraje) y contenga paréntesis literales se
  escribe en el PDF con los paréntesis escapados (`\(`/`\)`, requisito del
  formato); no asumir en pruebas que el texto crudo del PDF contiene el
  paréntesis sin escapar.

- **Perfil de audiencia**: página «Audiencia» (`audiencePage()`), separada de
  «Horarios» desde la Fase 3 (antes era una sola página «Perfil y horarios»).
  Publica el reparto de género y el cruce **género × edad** como pirámide
  (`brandGenderAge`, porcentajes sobre el total para que «mujer adulta» y
  «hombre adulto» se comparen entre sí, descartando el género desconocido en
  lugar de repartirlo) más un pill de insight con el rango de edad dominante.
  Cuando el reporte no trae detalle horario o demográfico, el bloque
  correspondiente se omite en lugar de dibujar ceros.
- **El número de páginas del PDF se adapta al contenido, con un mínimo de
  seis secciones fijas** (`MIN_PAGE_COUNT = 6`): Portada, Evolución,
  Audiencia, Horarios, Tiendas TOP, Cierre. «Tiendas TOP» añade páginas de más
  si el listado de tiendas medidas no cabe en una sola (8 filas por página,
  `TOP_STORES_ROWS_PER_PAGE`). El número de página de cada página interior se
  lee de `doc.getNumberOfPages()` en el momento de dibujarla, nunca de una
  constante — necesario porque la cantidad de páginas ya no es fija.
- **El maquetado del PDF se expresa en píxeles de un lienzo A4 horizontal a
  96 dpi** (1123 × 794 — ancho primero, es apaisado desde la Fase 3;
  anteriormente era vertical 794 × 1123). `quividiPdfKit.ts` convierte a
  milímetros y puntos vía `u(px)`, escalado sobre el ancho real de la página
  (297 mm), y expone `sparkline()` para minigráficas de tendencia (usada en
  portada y en la página de Audiencia) — al dibujar **más de una** serie con
  `sparkline()` en el mismo eje hay que pasarles un `domain` explícito y
  compartido: cada llamada normaliza a su propio mín/máx si no se le da uno,
  lo que exagera artificialmente diferencias mínimas entre series (ver el
  punto de género por día más arriba). Mantener la unidad del diseño en
  píxeles es lo que permite transcribir el mockup sin recalcular cada posición
  a mano; no introducir coordenadas en mm en las páginas.
- **El informe de marca no publica comparativos entre periodos ni métricas de
  costo**: cada informe reporta su propia vigencia, sin deltas ni CPM/CPC/coste
  por impacto. La comercialización sigue siendo a costo fijo.
- **El PDF no nombra las plataformas internas o de medición**: ningún texto
  visible, pie de página ni nombre de archivo cita Quividi ni SIGNAM. Se presenta
  como medición de audiencia de in-Store Media y se descarga como
  `Audiencia_<campaña>_<inicio>_<fin>.pdf`. Los nombres `quividi*` pueden
  permanecer en la implementación interna y el Excel técnico.
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

## Diagnóstico de pases Admira

- La página de baja ocupación conserva un único análisis vigente del reporte de
  pases en Firestore. El Excel original no se sube ni se persiste.
- El resultado se publica mediante `admiraPassAnalysisState/current` y un
  snapshot en `admiraPassAnalysisSnapshots/{snapshotId}/units`; primero se
  escribe completo, después se cambia el puntero y al final se elimina el
  snapshot anterior. La interfaz no ofrece históricos.
- Persistir el diagnóstico no concilia campañas con Signam ni cambia las reglas
  de Ratio 1/Ratio 3, el catálogo, los CSV o la planeación estimada.

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
- El papel de trabajo se exporta desde Operación Digital con una catorcena exacta
  obligatoria e independiente de los filtros. Solo incluye elementos vigentes en
  fuente y no cancelados; genera `CHEDRAUI` y `LACOMER` con las diez columnas del
  formato acordado, concatena la bitácora en `Comentarios` y conserva `Arte`
  vacío con su ancho. No reutiliza ni modifica exportadores Liverpool.
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
