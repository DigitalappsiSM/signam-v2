# Quividi: ingesta incremental y control de exportaciones

## Comportamiento

La network autorizada sigue siendo 3089. Se mantienen las 33 configuraciones del
archivo y las tres series diarias nativas: 36 configuraciones en total. No se
eliminan ubicaciones inactivas del archivo ni se alteran mediciones, ponderaciones,
extrapolación, campañas, Ekon o CSV de Admira.

- A las 06:00 de México se encola exclusivamente D-1. Las cinco series operativas
  (`ots/1d`, `viewers/1d`, `viewers_demographics/1d`, `ots/1h`, `viewers/1h`) se
  despachan primero en `quividi-historyOperationalPartition`. Las otras 31 siguen
  en `quividi-historyPartition`.
- Reportes y salud leen el histórico fuente completo para su rango de días
  cerrados. Cuando falta información, `historyReadiness.ts` encola solamente sus
  particiones faltantes. El usuario recibe un error reintentable de información
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

Campos: origen (`daily`, `archive_daily`, `backfill`, `recovery`, `live`), rango,
serie/resolución, agrupación demográfica, ubicaciones/sitio, inicio/fin, resultado
y número de peticiones HTTP de preparación (`polls`). Un export puede requerir
varios polls; no deben contarse como varios exports únicos. Las consultas de
metadatos y las lecturas de caché no se cuentan como exports de audiencia.
No se registran credenciales ni cuerpos de error del proveedor.

`exportCapabilities` reduce los sondeos de una misma ubicación/sitio y serie
que devuelva HTTP 403: espera seis horas antes de volver a probar. El estado
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
existentes. No hace falta reiniciar controles, borrar históricos o volver a
iniciar el backfill. Las tareas anteriores usan el mismo escritor idempotente.

Tras desplegar, observar la primera ingesta D-1 y el proceso de salud. Comparar
la auditoría por origen y serie con el rango exacto y definición de «export» del
proveedor. Revisar particiones incompletas/unsupported antes de atribuir un
ahorro; no usar 76 × 22 como medición de consumo. Los primeros exports reales y
la reducción de tráfico solo se pueden verificar contra producción.
