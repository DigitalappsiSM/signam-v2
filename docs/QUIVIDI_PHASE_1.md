# Quividi — Fase 1: reporte de audiencia por campaña


> **Documento de Fase 1.** Describe el reporte de audiencia por campaña.
> Para Location ID estable, histórico operativo, incidencias y
> **Operación → Salud de cámaras**, ver
> [`QUIVIDI_PHASE_2.md`](./QUIVIDI_PHASE_2.md).

## Objetivo

La Fase 1 integra Quividi en la vista **Campañas** de SIGNAM. No crea un
módulo nuevo: cada campaña muestra un icono de métricas cuando al menos una
combinación **Tienda + Soporte** tiene una cámara Quividi relacionada.

Al pulsar el icono, SIGNAM consulta VidiCenter desde Cloud Functions, normaliza
la medición, guarda un snapshot cuando cabe de forma segura en Firestore y
genera un Excel de audiencia.

## Fuente de verdad de inventario

El Catálogo Admira conserva sus 12 campos oficiales sin cambios. SIGNAM añade
como metadatos operativos:

- `NORMALIZACION LIVERPOOL`: soporte del calendario.
- `CAMARA QUIVIDI`: nombre exacto de la location en VidiCenter.

La unidad de cruce es:

`Retailer + Número de tienda + Soporte normalizado -> 0..N locations Quividi`

El nombre de cámara se usa para resolver Topology. En cada consulta, el backend
obtiene de Quividi los identificadores actuales `location_id`, `box_id` y
`site_id`; esos IDs no se escriben manualmente en el catálogo.

### Cargar el catálogo enriquecido sin duplicar pantallas

En **Catálogo Admira > Importar maestro**:

1. Seleccionar el Excel con las columnas `NORMALIZACION LIVERPOOL` y
   `CAMARA QUIVIDI`.
2. Revisar la vista previa.
3. Seleccionar **Actualizar mapeos**.
4. Confirmar.

Esta opción no crea ni borra pantallas. Empareja por los 12 campos oficiales y
actualiza únicamente los dos metadatos operativos.

## Credenciales

Las credenciales nunca se versionan ni se colocan en variables `VITE_*`.
Desde una terminal autenticada contra el proyecto de producción:

```bash
firebase login
firebase use signam-v2-prod
firebase functions:secrets:set QUIVIDI_API_USERNAME
firebase functions:secrets:set QUIVIDI_API_TOKEN
```

Después de crear o cambiar un secreto, desplegar las Functions que consumen
Quividi. El código sólo referencia el nombre del secreto.

## Consulta a VidiCenter

El backend usa:

- Topology `/api/v1/locations/` para resolver las cámaras.
- Data Export `data_type=ots`, resolución diaria.
- Data Export `data_type=viewers`, resolución diaria y
  `group_by_demographics=1`.

Los exports de datos son asíncronos. SIGNAM maneja los estados
`started -> in_progress -> finished`, errores `failed` y respuestas HTTP 429
con espera progresiva.

## Reglas de campaña

SIGNAM respeta el alcance real de cada soporte de la campaña. Una tienda puede
tener Quividi para Mupi y Banner, pero no para CRIUS; sólo los pares
Tienda + Soporte mapeados entran en el reporte.

La cobertura se calcula tanto de forma general como por soporte:

`pares Tienda+Soporte con Quividi / pares Tienda+Soporte de la campaña`

Las tiendas sin Quividi **no se extrapolan en la capa de medición**: ni el Excel
técnico ni el snapshot rellenan lo que no se midió. La estimación existe sólo en
el informe comercial en PDF, que es una capa aparte y declara explícitamente qué
parte de la cifra es medida y cuál estimada (ver *Informe comercial de
audiencia*, más abajo).

## Alcance efectivo y cocomercialización

Quividi no asume que una celda de soporte sin detalle de tiendas significa
siempre circuito completo. Para construir los pares **Tienda + Soporte** se usa
esta precedencia:

Antes del cruce, los nombres comerciales del Calendario se traducen al soporte
normalizado del catálogo: `MUPPI'S → MEGA MUPI DIGITAL` (también se tolera
`MEGAMUPI DIGITAL`) y `PENDON → BANNER DIGITAL`.

1. Si el Calendario Liverpool trae tiendas explícitas, se usan exactamente esas
   tiendas.
2. Si el comentario confirma explícitamente **todas**, se usa el circuito
   completo del soporte según el catálogo activo.
3. Si no hay comentario y el soporte es **VIDEO WALL CRIUS** o
   **VIDEO WALL POSTER LED**, se usa el circuito completo. Esta es una excepción
   operativa documentada.
4. Para cualquier otro soporte sin comentario, SIGNAM busca el número Ekon
   asociado manualmente a esa instancia de campaña y utiliza solo asignaciones
   vigentes que:
   - no sean Centro Administrativo (determinante 0);
   - no tengan conflicto;
   - se solapen con la vigencia de la campaña Liverpool;
   - tengan circuito Ekon compatible con el soporte Liverpool.
5. Si no existe vínculo Ekon o no hay asignaciones compatibles, el alcance queda
   sin resolver y no se inventan tiendas.

El fallback Ekon es específico del reporte Quividi y **no modifica** el
documento de campaña, la conciliación, la consolidación ni el CSV Admira. Las
fuentes permanecen separadas.

El reporte conserva el origen de cada alcance (`Calendario Liverpool`,
`Circuito completo` o `EKON · Cocomercialización`) y lo muestra en Dashboard y
en la hoja **Alcance**.

### Distinción entre “sin comentario” y “todas”

Las nuevas importaciones guardan `scopeSource` para diferenciar una celda sin
comentario de un comentario/resolución que confirme explícitamente todas las
tiendas. Los documentos legacy no contienen ese campo. Para ellos, una lista
vacía se trata de forma conservadora: CRIUS/Poster LED usan circuito completo y
los demás soportes intentan resolver tiendas desde Ekon. Reimportar el calendario
vigente deja registrada la distinción exacta para futuras consultas.

## Varias cámaras en un soporte

Una sola cámara representa el soporte completo.

Cuando un mismo Tienda + Soporte tiene varias cámaras que pueden observar el
mismo tráfico, SIGNAM **no suma** sus audiencias. La ponderación se hace cada
día:

`resultado diario = promedio de cámaras válidas del día`

Si una cámara cae y otra conserva medición válida, se usa la disponible y el
día queda marcado como medición parcial. Si ninguna cámara tiene medición, ese
Tienda + Soporte queda sin medición para ese día.

La regla funciona igual con 2, 3 o más cámaras.

### Medición parcial

Como primera regla operativa, una cámara se marca como parcial cuando la
duración medida del día es inferior al 80% de la mediana de duración de esa
misma cámara dentro del periodo consultado.

Cuando existen cámaras completas para ese soporte/día, las parciales no se
mezclan en la ponderación. Si sólo existen cámaras parciales, se utilizan las
disponibles y la incidencia queda declarada.

SIGNAM no rellena los faltantes con cero y no extrapola los días ausentes **en
el dato técnico**. El informe comercial sí completa el circuito, con las reglas
de la sección *Informe comercial de audiencia*.

## Agregaciones

- OTS, Effective OTS y Watchers: promedio diario entre cámaras válidas del
  mismo soporte; después se acumulan los días.
- Attention Time y Dwell Time: promedio ponderado por Watchers.
- Tasa de atención: se recalcula como `Watchers / OTS`; no se promedian
  porcentajes.
- Demografía: se pondera con la misma regla multi-cámara.
- Los resultados se presentan separados por soporte para evitar interpretar
  Mupi + Banner como personas únicas.

## Excel

El archivo abre primero con una capa comercial para marcas y marketing y deja
el detalle técnico al final:

- **Dashboard Ejecutivo**: KPIs, audiencia por soporte, Top tiendas, días de
  semana, momentos de mayor oportunidad, franjas horarias, demografía, calidad
  y origen del alcance.
- **Tiendas**: OTS, Watchers, tasa de atención, Attention/Dwell Time, mejor día,
  mejor franja y cobertura de medición por tienda.
- **Días y Horarios**: mapa de calor de OTS por día de semana y hora.
- **Evolución Diaria**: tendencia diaria de OTS, Watchers y tasa de atención.
- **Detalle Horario**: agregado de una hora por Tienda + Soporte para
  trazabilidad.
- **Resumen Técnico**: resumen operativo que conserva la estructura previa.
- **Alcance**: fuente usada por soporte y número Ekon cuando aplica.
- **Detalle Soportes**: resultado diario ponderado por Tienda + Soporte.
- **Cámaras**: dato original por location, incluyendo IDs técnicos y duración.
- **Demografía**: edad y género estimados.
- **Calidad medición**: cámaras/días parciales o sin medición.
- **Metodología**: reglas de lectura y limitaciones.

### Lectura comercial y horarios

OTS y Watchers agregados se presentan como **contactos/detecciones medidos**,
no como reach único de personas. Cuando se agregan tiendas o soportes no se
deduplican individuos; por eso el detalle por soporte se conserva separado y
esta limitación aparece en el informe.

Para el análisis horario se solicitan a VidiCenter exports con
`time_resolution=1h`. La regla de varias cámaras es la misma que en el dato
diario: se promedian únicamente las cámaras con medición válida del periodo; si
solo una cámara de varias reporta, la hora queda como medición parcial. Las horas
se muestran según el periodo horario entregado por VidiCenter para cada
ubicación; SIGNAM no fuerza una única zona horaria para toda la red.

Definiciones mostradas al usuario:

- **OTS**: oportunidades de estar expuesto al soporte.
- **Effective OTS**: oportunidades dentro del ángulo efectivo de visión.
- **Watchers**: personas detectadas que dirigieron la mirada a la pantalla.
- **Tasa de atención**: porcentaje de oportunidades que terminó mirando.
- **Attention Time**: tiempo promedio mirando la pantalla.
- **Dwell Time**: tiempo promedio permaneciendo frente o cerca del soporte.
- **Demografía**: estimación estadística; no identifica personas.

## Informe comercial de audiencia

El PDF que se comparte con la marca es una **capa distinta** del Excel técnico.
El Excel conserva el dato tal cual se midió; el PDF publica una lectura agregada
del circuito y, para eso, sí estima la parte no medida.

### Circuito medible

La cifra publicada cubre **únicamente los formatos de soporte con medición**
durante la vigencia. Un formato sin ninguna cámara —CRIUS, Poster LED, un video
wall no instrumentado— **queda fuera del OTS** y se reporta como alcance
adicional: suma exhibición, no audiencia estimada.

El motivo es que aplicarle el promedio de otro formato supondría que un pasillo
y un atrio ven pasar a la misma gente. El código no asume dónde hay cámaras:
detecta por campaña qué formatos tuvieron medición, de modo que un video wall
instrumentado entra con su propio promedio.

### Extrapolación formato a formato

Dentro del circuito medible, cada formato se completa con **su propio** promedio
de OTS por par-día medido, nunca con un promedio único del circuito.

Ese promedio se calcula sobre los par-día **medidos** y no sobre la rejilla
completa del formato. Si los días sin dato entraran al numerador como cero,
deflactarían el promedio que después rellena el resto: un sesgo que crece con la
vigencia —despreciable por debajo de ~14 días, por encima del 20% a partir de
60—. Todo hueco dentro de un formato medible recibe el mismo tratamiento, sea un
soporte sin cámara o un día que la cámara instalada no reportó.

### Qué publica el PDF y qué no

Seis páginas fijas en formato **A4 horizontal**, con estilo de dashboard
minimalista: Portada, Evolución, Audiencia, Horarios, Tiendas TOP y Cierre
(«Tiendas TOP» añade páginas de más si el listado no cabe en una). Ver
`AGENTS.md` para el detalle regla por regla; resumen:

- **Publica**: una sola cifra de OTS de campaña en portada (sin desglose
  medido/extrapolado como protagonista), su evolución diaria o semanal según la
  vigencia con una fila de conclusiones calculadas (promedio, día pico, delta
  fin de semana), el perfil de audiencia (género por día como dos líneas de
  tendencia con dominio compartido, cruce género × edad), la distribución
  horaria de lo observado, las tiendas con medición y sus OTS ajustados
  («Tiendas TOP», como leaderboard de una sola columna), y recomendaciones
  comerciales calculadas de la propia campaña. Un único indicador de cobertura
  (% de tiendas con cámara vs. proyectadas, por conteo de tiendas) aparece solo
  en el pie de la página de Evolución. **Todo el PDF** (no sólo la
  distribución horaria) está acotado a la franja operativa de cara a la marca
  (10:00–22:00, `BRAND_OPERATIONAL_START_HOUR`/`_END_HOUR`,
  `brandOperationalReport`) — ver el detalle en `AGENTS.md`.
- **No publica**: el campo «Retailer», incidencias de medición (qué soporte
  falló un día concreto es operación interna), la cadena aritmética completa,
  ni ningún lenguaje que revele el método de extrapolación a la marca (por
  ejemplo «OTS ajustados», el caso Insurgentes o el descargo «la suma no
  equivale al total») — eso vive únicamente en la hoja «Auditoría de cifras»
  del Excel.
- La serie de evolución se limita al circuito medible y escala **cada día**
  (o cada semana, en vigencias de más de 28 días) **formato a formato** con el
  mismo promedio que la cifra de portada, de modo que la suma de la serie
  concilia exactamente con el total publicado.
- **Pendiente (Fase 2, bloqueada)**: extrapolar hora a hora distinguiendo «hora
  sin dato» de «hora fuera de operación» requiere un horario de apertura/cierre
  por soporte que SIGNAM no tiene hoy en ningún lugar del dominio ni del
  Catálogo Admira. Mientras tanto, la distribución horaria del PDF
  (`brandHourlyDistribution`) es puramente descriptiva de lo observado, nunca
  extrapolada, y el Excel no trae todavía la hoja «Detalle de extrapolación»
  hora a hora que pide el encargo comercial.
- **Pendiente adicional (sin fase asignada)**: el cruce hora × género/edad
  (franjas mañana/tarde/noche por demografía) no se puede construir con el
  esquema actual — ninguna fuente une hora del día con demografía
  (`QuividiDemographicRow` no trae hora, `QuividiSupportHour` no trae
  género/edad) — así que la página «Horarios» solo publica el reparto horario
  simple. Ver `AGENTS.md` para el detalle.
- **La franja operativa 10:00–22:00 acota todo el PDF, pero no el Excel —
  divergencia deliberada.** `report.supportDays` viene pre-sumado por Quividi
  00:00–23:59 (`time_resolution: '1d'`) y no se puede recortar por hora
  después del hecho. `brandOperationalSupportDays` reconstruye filas «por
  día» sumando sólo las horas de `supportHours` dentro de la franja (que ya
  se pide con `time_resolution: '1h'` para la distribución horaria, sin
  llamada nueva a Quividi), y `brandOperationalReport` sustituye
  `supportDays` por esa reconstrucción para las seis páginas del PDF. El
  Excel técnico (`quividiCampaignExcel.ts`, `quividiAuditSheet.ts`) sigue
  leyendo `report.supportDays` sin recortar — conserva el dato tal cual lo
  mide Quividi, como declara — así que cuando hay medición fuera de
  10:00–22:00 el total del Excel es mayor que el de portada **a propósito**;
  la hoja «Auditoría de cifras» lo advierte en una nota bajo el título. No es
  el cambio de ingesta en Cloud Functions descrito en una versión anterior de
  este documento (que habría afectado también «Salud de cámaras» y los
  snapshots cacheados): la reconstrucción vive enteramente en la capa pura
  del PDF (`quividiBrandReport.ts`), no toca `functions/`.

### Hoja «Auditoría de cifras»

El Excel incluye una hoja de nueve secciones que reconstruye paso a paso la
cifra del PDF: circuito contratado frente a circuito medible, reparto
exhaustivo de la rejilla par-día, la cadena aritmética formato a formato, el
desglose del circuito con los no medibles marcados, las dos lecturas de
cobertura, y la aportación por tienda.

Consume las **mismas funciones puras** que el PDF (`quividiBrandReport.ts`), de
modo que una discrepancia entre hoja e informe es imposible por construcción.

Tres bloques resuelven lo que el encargo original pedía del Excel a nivel
**día** (el nivel **hora** sigue bloqueado por el punto anterior):

- **Motivo del hueco** (`brandExtrapolationByReason`): la tabla de
  construcción por formato trae dos columnas — «Extrapolados: sin dato» (el
  soporte tiene cámara pero no reportó ese día) y «Extrapolados: sin cámara»
  (el soporte del universo contratado nunca tuvo cámara) — más dos filas de
  totales agregados. La suma de ambos motivos reconcilia exactamente con «De
  los cuales, extrapolados» sin recalcularlo.
- **Clasificación informativa vs. técnica**: pone una junto a la otra el %
  de OTS de tiendas «con medición» (clasifica tiendas —
  `brandStoreAttribution().measuredStoresSharePercent`, el mismo criterio que
  antes vivía en el pie de portada) y el % de OTS medidos directamente
  (clasifica par-día — `summary.measuredOts / summary.estimatedOts`), para
  que quede explícito que casi nunca son el mismo porcentaje.
- **OTS ajustados por tienda**: la tabla de aportación por tienda añade el
  OTS ajustado de cada una (`brandStoreAttribution().stores[].adjustedOts`,
  junto al OTS medido crudo para trazabilidad) y cierra con tres filas que
  reconstruyen el total de portada: OTS ajustados de tiendas con medición
  (suma) + OTS de tiendas sin medición (residuo) = OTS estimados de campaña.

### Dónde vive

- `src/modules/exports/quividiBrandReport.ts` — capa pura: circuito medible,
  extrapolación, cobertura, perfil de audiencia.
- `src/modules/exports/quividiCampaignPdf.ts` — las seis páginas del informe.
- `src/modules/exports/quividiPdfKit.ts` — primitivas de dibujo sobre jsPDF.
- `src/modules/exports/quividiAuditSheet.ts` — la hoja de auditoría.

Las reglas de diseño y las trampas de jsPDF (degradados acumulativos, recorte de
fotografía, formatos de asset admitidos) están en `AGENTS.md`.

## Snapshot

El snapshot del reporte usa schema v3 porque además del agregado diario conserva
`supportHours`, la capa horaria que alimenta el dashboard comercial.

La colección `campaignAudienceSnapshots/{campaignId}` es exclusivamente de
backend. Para campañas activas se reutiliza el snapshot durante aproximadamente
24 horas. Para una campaña finalizada, un snapshot generado después del cierre
se considera final mientras no cambie la configuración de campaña/mapeos.

Si el reporte comprimido excede el tamaño seguro del documento Firestore, se
devuelve el Excel normalmente pero no se persiste el snapshot.

## Seguridad

- El navegador nunca recibe el token de Quividi.
- La callable requiere un usuario autenticado en SIGNAM.
- El snapshot no necesita reglas de lectura para cliente; se administra con
  Firebase Admin SDK desde Cloud Functions.
- No se guardan credenciales en Git, `.env.example` ni Firestore.
