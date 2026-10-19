# Quividi: ingesta incremental y control de exportaciones

## Comportamiento

La network autorizada sigue siendo 3089. No se alteran mediciones, ponderaciones,
extrapolación, campañas, Ekon o CSV de Admira.

### Series vigentes (decisión del 19/10/2026)

Quividi pidió reducir la frecuencia de exports (unos 12,000 por semana). Se
conservan 14 series: las cinco operativas (`ots`/`viewers` 1d y 1h,
`viewers_demographics` 1d) más `viewers_apc` finest, `compass` 1h,
`extrapolated_ots` y `extrapolated_watchers` 1h, `footfall` 1h y finest,
`retail_analytics_footfall` 1h y finest y `retail_analytics_footfall_aggregated`
1h. Dejaron de pedirse `viewers` finest, `ots` 5m, `content_plays`, `gate`,
`im*`, `targeted_im`, `pmp_*`, `proof_of_play*` y `vehicles*` (no se usan o no
hay cámaras de vehículos). Lo ya guardado no se borra. Una tarea encolada antes
del recorte termina sin exportar, y el coordinador del backfill las salta sin
mover su cursor.

### Carga diaria en lote

- A las 06:00 de México se encola **una tarea por serie para toda la network**,
  con D-1 y los seis días anteriores. El trabajador solo exporta pares
  ubicación × día que no estén `complete`. En un día normal eso es D-1 y queda
  en **un solo export** con `locations=a,b,c`, unas 14–18 al día en total.
  Las series `finest` van en grupos de 20 ubicaciones y un día.
- `planBatchExports` agrupa las ubicaciones que tienen exactamente los mismos
  días pendientes y corta esos días en tramos contiguos de hasta siete, con un
  máximo de 400 particiones por export. Un día ya guardado nunca se descarga de
  nuevo para otra ubicación del lote.
- Si la tarea necesita más de un export, se divide en tareas `chunk` de un solo
  export, para no superar el tiempo de la función.
- Cada fila se asigna a la partición de su `location_id`. Si una serie no lo
  trae, se marca `perLocation` en `exportCapabilities` y se pide por ubicación.
  Si el lote completo devuelve 400/403/404, se repite por ubicación para aislar
  la que no tiene licencia; las demás se guardan.
- Las cinco series operativas (`ots/1d`, `viewers/1d`, `viewers_demographics/1d`,
  `ots/1h`, `viewers/1h`) se despachan primero en
  `quividi-historyOperationalPartition`. Las demás van en `quividi-historyPartition`.

### Datos atrasados (cámara sin internet)

Una tienda sin internet no envía nada; Quividi devuelve el día vacío o cortado.
Al guardar cada partición se consulta la topología (`/network/3089/locations/`,
que es metadato y no un export) y se compara el `last_seen` de la cámara con el
final del día:

- Si la cámara no había reportado después de terminar el día, la partición queda
  `complete` (los reportes la usan como hoy) pero `provisional: true`. Se guardan
  `provisionalLastSeen`, `provisionalChecks`, `provisionalRechecks` y
  `provisionalCheckedAt`.
- `last_seen` no trae zona horaria: se compara contra la ubicación más reciente
  de la network, así el desfase se cancela. Sin topología, o con toda la network
  sin señal, todo queda provisional. Ante la duda se elige provisional: cuesta
  una relectura, nunca un dato.
- `historyLateDataRecheck` (07:50 y 14:50 México) relee los días provisionales
  **solo de las cámaras cuyo `last_seen` avanzó** desde la última lectura, con
  al menos 12 horas entre relecturas y agrupados por serie (`source: late_data`).
  Una tienda que sigue sin señal no genera exports.
- Tras volver la cámara se confirma dos veces, porque puede tardar en subir lo
  atrasado. Hay un máximo de cinco relecturas; pasados 60 días, el día queda
  definitivo.
- Si un día ya guardado cambia en una serie operativa,
  `quividiHistoryLateData/{fecha}` registra el cambio y los snapshots de campaña
  que incluyen esa fecha se regeneran desde Firestore, sin nuevos exports. El
  PDF pasa entonces del relleno por promedio a la medición real.
- Ejemplo: Perisur 15 días sin internet. Sus 15 días quedan provisionales. Al
  volver, cada serie se relee en tramos de siete días (3 exports por serie), dos
  veces, y luego queda definitiva.
- Límite conocido: el panel de salud y el rollup comercial ya calculados de esos
  días no se recalculan solos.

### Lectura de consumidores

- Reportes y salud leen el histórico fuente completo para su rango de días
  cerrados. Cuando falta información, `historyReadiness.ts` encola solamente sus
  particiones faltantes, agrupadas en una tarea por serie que se exporta en lote. El usuario recibe un error reintentable de información
  en preparación. No se devuelve un total calculado con una ingesta incompleta.
- La cola operativa persiste el JSON fuente y manifiesto con la misma identidad
  existente. El siguiente intento reutiliza esos datos; no vuelve a pedir todo
  el vuelo ni toda la ventana de salud.
- Salud conserva su baseline de 28 días y el backfill administrativo de 1–90 días.
  A las 08:15 usa ayer en `America/Mexico_City`, igual que las actualizaciones
  manuales y el rollup comercial de las 08:30. Si falta fuente, no evalúa nuevas
  incidencias ni sincroniza tickets Odoo; el scheduler reintenta tres veces,
  con esperas de entre cinco y quince minutos. El estado anterior se conserva.
- El coordinador mantiene sus cursores mensuales. El trabajador comprueba los
  días existentes y divide solo los huecos en segmentos de hasta siete días;
  un reintento no vuelve a pedir los subrangos ya guardados. Un control histórico
  `completed` acredita que terminó de encolar, no la finalización de cada tarea.

## Día actual y reportes

Se conserva el corte comercial existente: antes de las 10:00 llega hasta ayer;
10:00–22:00 incluye hoy como parcial; desde las 22:00 incluye el día operativo
completo. El día actual se consulta aparte de los días fuente cerrados.

`liveHistory.ts` comparte las cuatro series de reporte para el inventario de la
network. Cada campaña recibe únicamente las filas de sus ubicaciones. Una caché
persistente de una hora evita repetir los cuatro exports por cada campaña. El
cache key incluye inventario, fecha, serie y fase parcial/cierre operativo. La
respuesta y su captura se guardan bajo `liveExports` y RAW `live/` de Storage:
**nunca marcan una partición histórica como completa**.

La hora mostrada y el vencimiento del snapshot conservan la captura más antigua
usada. Al pasar las 22:00 no se reutiliza la caché parcial. Al día siguiente un
snapshot que todavía usó el día vivo se regenera desde D-1 antes de considerarse
definitivo. «Actualizar datos de Quividi» omite el snapshot de campaña, pero
respeta la caché compartida de la fuente; no fuerza la descarga del histórico.

## Concurrencia, disponibilidad y auditoría

`exportClient.ts` es el único cliente de `/data/`. Tiene dos slots globales
transaccionales, válidos entre instancias, colas y reportes interactivos. El slot
0 está reservado para trabajo operativo; el archivo usa solamente el slot 1.
La caducidad de los leases recupera ejecuciones interrumpidas. Otro lease por
partición evita exportar la misma fecha entre la cola diaria y un backfill.

Cada export real crea un registro en:

`quividiHistoryControl/liverpool/exportAudit/{executionId}`

Campos: origen (`daily`, `archive_daily`, `backfill`, `recovery`, `late_data`, `live`), rango,
serie/resolución, agrupación demográfica, ubicaciones/sitio, inicio/fin, resultado
y número de peticiones HTTP de preparación (`polls`). Un export puede requerir
varios polls; no deben contarse como varios exports únicos. Las consultas de
metadatos y las lecturas de caché no se cuentan como exports de audiencia.
No se registran credenciales ni cuerpos de error del proveedor.

`exportCapabilities` reduce los sondeos de una misma ubicación y serie que
devuelva HTTP 403: espera seis horas en las series operativas y siete días en
las de archivo antes de volver a probar. El estado
por fecha sigue siendo `unsupported`, nunca un cero medido. HTTP 400/404 se
registran por partición sin inferir una restricción global de licencia. Un
export cuyo estado sea `failed` se reintenta, porque puede ser un timeout.
Todas estas subcolecciones y los RAW permanecen backend-only bajo las reglas
cerradas existentes; no se amplían permisos de clientes.

## Validación y despliegue

Las pruebas usan filas sintéticas y dobles de Firestore/Storage: no disparan
exports reales, trabajos en producción ni tickets Odoo. Cubren recuperación de
un hueco, concurrencia, reinicio tras fallo, límites de rango, caché compartida,
separación de hoy, cooldown de disponibilidad y cortes México/UTC.

Antes de desplegar deben pasar formato, lint, typecheck, suite completa,
build de frontend y Cloud Functions, y el guardia de documentación. El PR debe
revisarse antes de fusionar: `main` despliega automáticamente a producción.

En el despliegue verificar que se creó `quividi-historyOperationalPartition`
y que la identidad de Functions puede encolarle tareas, como a las colas ya
existentes. Verificar también que se creó el programador de
`historyLateDataRecheck`. Las tareas por ubicación que ya estaban en cola siguen
siendo válidas (`toBatchTask`). No hace falta reiniciar controles, borrar históricos o volver a
iniciar el backfill. Las tareas anteriores usan el mismo escritor idempotente.

Tras desplegar, observar la primera ingesta D-1 y el proceso de salud. Comparar
la auditoría por origen y serie con el rango exacto y definición de «export» del
proveedor. Revisar particiones incompletas/unsupported antes de atribuir un
ahorro; no usar 76 × 22 como medición de consumo. Tras el cambio a lotes, el
`exportAudit` de `daily`/`archive_daily` debería mostrar unas 14–18 entradas al día
con `locations` de varias ubicaciones; `late_data` solo aparece cuando una cámara
vuelve tras estar sin señal. Los primeros exports reales y
la reducción de tráfico solo se pueden verificar contra producción.
