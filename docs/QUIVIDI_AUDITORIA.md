# Auditoría técnica — Integración Quividi (SIGNAM V2)

> Documento de contexto completo. Está escrito para que **cualquier IA o
> desarrollador** que no conozca el repositorio pueda entender, operar y
> modificar la integración Quividi sin leer todo el código.
>
> - Fecha de la auditoría: **2026-09-19**
> - Commit auditado: `b58d9c1` (merge del PR #114, `feat/quividi-marketing-dashboard`)
> - Alcance: **solo** la integración Quividi (frontend, dominio, servicio,
>   Cloud Functions, Excel, catálogo, seguridad, pruebas).
> - Documento funcional previo (no lo reemplaza, lo complementa):
>   `docs/QUIVIDI_PHASE_1.md`. Reglas de negocio transversales: `AGENTS.md`
>   (secciones «Alcance Quividi por cocomercialización» y «Reporte comercial
>   Quividi»).

---

## 1. Resumen ejecutivo

Quividi es la plataforma de **medición de audiencia por cámara** (VidiCenter).
SIGNAM la usa para generar, **por campaña Liverpool**, un Excel de audiencia
(OTS, Watchers, atención, permanencia, demografía y detalle horario).

No existe un módulo «Quividi» en la navegación: la integración se **injerta en
la pantalla Campañas** como un icono de métricas por fila.

Estado general: **funcional y bien acotado**. El diseño respeta el principio
rector del repositorio (Quividi **nunca** escribe en `campaigns`, `screens`,
consolidaciones ni CSV Admira; solo lee y deriva). Las credenciales viven en
Secret Manager y nunca llegan al navegador.

Riesgos principales detectados (detalle en §9):

| # | Severidad | Título |
|---|-----------|--------|
| F1 | Alta | `campaignAvailability` reconsulta Ekon por campaña (N+1 Firestore) |
| F2 | Alta | **Cero pruebas automatizadas** en `functions/` (toda la lógica crítica) |
| F3 | Media | El presupuesto de 4 exports secuenciales puede agotar los 540 s |
| F4 | Media | Topología asumida como array plano, sin paginación ni validación |
| F5 | Media | Sin control de rol: cualquier usuario autenticado dispara la API Quividi |
| F6 | Media | Snapshot > 900 KB se descarta en silencio (sin señal al usuario) |
| F7 | Media | `src/modules/campaigns/quividiCoverage.ts` es código muerto y **divergente** |
| F8 | Baja | Zona horaria: ventana UTC vs. horario local de cada ubicación |
| F9 | Baja | Disponibilidad no valida contra VidiCenter (icono activo sin cámara real) |
| F10 | Baja | `buildSupportHours` recorre todo el índice por cámara (O(n·m)) |
| F11 | Baja | README y `.env.example` no documentan la integración ni sus secretos |

> **Estado**: F1 y F2 se atienden en el PR #116 (caché de asignaciones Ekon
> compartida + 29 pruebas de caracterización de `effectiveScope` y `hourly`).
> El resto sigue abierto. Esta auditoría describe el commit `b58d9c1`.

---

## 2. Mapa de archivos

| Capa | Archivo | Líneas | Rol |
|------|---------|--------|-----|
| Dominio (tipos puros) | `src/domain/quividi.ts` | 163 | Contrato compartido cliente↔backend: `QuividiCampaignReport` y sus filas, etiquetas de género/edad, glosario de KPIs. Reexportado por `src/domain/index.ts`. |
| Modelo de pantalla | `src/domain/models.ts:56` | — | Metadato `quividiCameraName` en `AdmiraScreen.metadata`. |
| Servicio cliente | `src/services/quividi.ts` | 50 | Dos callables: `quividi-campaignReport` y `quividi-campaignAvailability` (lotes de 200 ids). |
| UI | `src/modules/campaigns/CampaignsPage.tsx` | — | Icono por campaña, estado de disponibilidad, descarga del Excel, errores. |
| Cobertura (cliente) | `src/modules/campaigns/quividiCoverage.ts` | 103 | **No se usa en producción** (solo su test). Ver F7. |
| Backend — orquestación | `functions/src/quividi/index.ts` | 876 | Callables, llamadas a VidiCenter, ponderación multi-cámara diaria, demografía, incidencias, caché comprimida. |
| Backend — alcance | `functions/src/quividi/effectiveScope.ts` | 507 | Construcción de pares **Tienda + Soporte** con precedencia Calendario → «todas» → circuito completo → Ekon. |
| Backend — horario | `functions/src/quividi/hourly.ts` | 233 | Capa `supportHours` (agregados de 1 h) con la misma regla multi-cámara. |
| Excel — técnico | `src/modules/exports/quividiCampaignExcel.ts` | 620 | Hojas Resumen Técnico, Alcance, Detalle Soportes, Cámaras, Demografía, Calidad medición, Metodología. |
| Excel — comercial | `src/modules/exports/quividiMarketingSheets.ts` | 679 | Dashboard Ejecutivo, Tiendas, Días y Horarios, Evolución Diaria, Detalle Horario. |
| Excel — cálculos | `src/modules/exports/quividiMarketingAnalytics.ts` | 442 | Agregados puros del reporte (KPIs, top tiendas, heatmap, franjas, demografía, calidad). |
| Catálogo | `src/modules/admira-catalog/masterImport.ts`, `masterExport.ts`, `ScreenForm.tsx`, `CatalogPage.tsx`, `MasterImportModal.tsx`, `MasterExportModal.tsx` | — | Columna `CAMARA QUIVIDI` (alias `CÁMARA QUIVIDI`) en importación/exportación del maestro y edición manual. |
| Persistencia catálogo | `src/services/screens.ts` | — | Escritura del metadato, incluida la opción «Actualizar mapeos» (no crea ni borra pantallas). |
| Registro de funciones | `functions/src/index.ts:15` | — | `export * as quividi from './quividi'` → nombres desplegados `quividi-campaignReport`, `quividi-campaignAvailability`. |

Colección Firestore exclusiva: **`campaignAudienceSnapshots/{campaignId}`**.

---

## 3. Modelo conceptual

### 3.1 Unidad de cruce

```
Tienda (Numero de Tienda) + Soporte (NORMALIZACION LIVERPOOL)  ->  0..N cámaras Quividi
```

- El **catálogo Admira** es la fuente de inventario. Sus 12 campos oficiales no
  se tocan; SIGNAM añade dos metadatos: `calendarSupport`
  (`NORMALIZACION LIVERPOOL`) y `quividiCameraName` (`CAMARA QUIVIDI`).
- `quividiCameraName` debe ser el **nombre exacto de la location** en
  VidiCenter. Los IDs técnicos (`location_id`, `box_id`, `site_id`) **nunca**
  se escriben a mano: se resuelven en cada consulta vía Topology.
- Una pantalla inactiva (`metadata.active === false`) queda fuera de todo el
  cálculo (`effectiveScope.ts:activeScreens`).

### 3.2 Alcance efectivo (precedencia, `effectiveScope.ts:374`)

Para cada soporte de la campaña, en este orden:

1. **`calendar-selected`** — el Calendario trae tiendas explícitas → se usan esas.
2. **`calendar-all`** — `scopeSource` es `comment-explicit-all` o
   `resolution-all` → circuito completo del soporte según catálogo activo.
3. **`calendar-full-circuit`** — sin comentario y el soporte es
   `VIDEO WALL CRIUS` o `VIDEO WALL POSTER LED` → circuito completo
   (excepción operativa documentada).
4. **`ekon`** — cualquier otro soporte sin comentario: se busca el número Ekon
   vinculado y se derivan tiendas de `ekonAssignments` filtrando por:
   `active == true`, sin `conflict`, `centroAdministrativo == false`, periodo
   solapado con la vigencia Liverpool y circuito/artículo **compatible** con el
   soporte.
5. **`unresolved`** — no hay vínculo Ekon o ninguna asignación es compatible →
   **no se inventan tiendas**. `scope === 'invalid'` también cae aquí con
   `pairCount: 0`.

El origen se conserva por soporte en `scopeOrigins[]` y se muestra en el
Dashboard y en la hoja **Alcance**. Este fallback es **derivado y de solo
lectura**: no escribe tiendas Ekon dentro de `campaigns` ni afecta
Conciliación/Consolidación/CSV.

### 3.3 Alias de soporte (solo Quividi)

`effectiveScope.ts:CALENDAR_TO_QUIVIDI_SUPPORT` y `SUPPORT_ALIASES`:

| Nombre comercial (Calendario) | Soporte normalizado (catálogo) |
|---|---|
| `MUPPI'S` / `MUPPIS` | `MEGA MUPI DIGITAL` |
| `MEGAMUPI DIGITAL` | `MEGA MUPI DIGITAL` |
| `PENDON` | `BANNER DIGITAL` |

Nota importante: `MUPPI'S` y `PENDON` son soportes **InStore Media**, excluidos
de la consolidación y del CSV Admira, pero **sí** entran en el reporte Quividi.

Compatibilidad circuito Ekon → soportes (`CIRCUIT_TO_SUPPORTS`):

| Circuito Ekon | Soportes Liverpool |
|---|---|
| `ESPECTACULAR IN STORE` | LED ALTABRISA, LED VALLARTA, COLUMNA DIGITAL, BANNER DIGITAL |
| `ESPECTACULAR OUT LIV` | APARADOR INSURGENTES, APARADOR POLANCO, C&C MTY, PANTALLAS LED ANTEA, VIDEO WALL CRIUS |
| `MEGA MUPI` | MEGA MUPI DIGITAL |
| `VIDEOWALL` | PANTALLAS CUADRADAS, VIDEO WALL CRIUS, VIDEO WALL POSTER LED |

(`ARTICLE_ALIASES` mapea el artículo `MEGA MUPI DIGITAL` al circuito `MEGA MUPI`.)

### 3.4 Regla multi-cámara (invariante de negocio)

Una cámara representa el soporte completo. Cuando un mismo Tienda + Soporte
tiene varias cámaras, **no se suman**: se **promedia por día** (y por hora) entre
las cámaras con medición válida.

- Estado de cámara/día: `complete`, `partial` o `missing`.
- `partial` = la duración medida del día es **< 80 %** de la mediana de duración
  de esa misma cámara en el periodo (`PARTIAL_DURATION_RATIO = 0.8`,
  `index.ts:22`).
- Si hay cámaras `complete`, las `partial` **no se mezclan** en la ponderación.
  Si solo hay `partial`, se usan y la incidencia queda declarada.
- Nunca se rellena con cero ni se extrapolan días ausentes.

### 3.5 Agregaciones

| Métrica | Regla |
|---|---|
| OTS / Effective OTS / Watchers | Promedio diario entre cámaras válidas → luego se acumulan los días |
| Attention Time / Dwell Time | Promedio **ponderado por Watchers** (`Σ décimas / Σ watchers / 10`) |
| Tasa de atención | Se **recalcula** como `Watchers / OTS`; nunca se promedian porcentajes |
| Demografía | Misma regla multi-cámara (promedio entre cámaras seleccionadas) |
| Presentación | Separada por soporte; jamás se interpretan Mupi + Banner como personas únicas |

**Límite semántico declarado**: OTS y Watchers agregados son
**contactos/detecciones medidos**, *nunca* reach único de personas. Al agregar
tiendas o soportes no se deduplican individuos.

---

## 4. Flujo de ejecución (extremo a extremo)

### 4.1 Disponibilidad (pinta o no el icono)

```
CampaignsPage.reload()
  └─ getQuividiCampaignAvailability(ids)      services/quividi.ts:35  (lotes de 200)
       └─ callable quividi-campaignAvailability          index.ts:820
            ├─ exige request.auth
            ├─ máx. 250 ids por llamada
            ├─ lee TODAS las screens una vez
            ├─ db.getAll(campaigns...)
            └─ por campaña: buildEffectiveSupportPairs()  index.ts:856
                 └─ available = (pares con cameraNames.length > 0) > 0
```

No toca VidiCenter ni secretos: es puramente Firestore. También se reejecuta
tras cambiar el vínculo Ekon (`reloadEkon`).

### 4.2 Reporte (descarga del Excel)

```
CampaignsPage.downloadQuividiReport(c)         CampaignsPage.tsx:508
  └─ getQuividiCampaignReport(campaignId, false)
       └─ callable quividi-campaignReport       index.ts:707  (540 s, 512 MiB, secrets)
            1. auth + campaignId
            2. lee campaigns/{id}; valida fechaInicio/fechaFin (parseCivilDate)
            3. lee todas las screens
            4. buildEffectiveSupportPairs() → pairs + origins
            5. inputSignature = sha256(nombre, fechas, origins, pares ordenados)
            6. si !forceRefresh y el snapshot coincide y está fresco → devuelve cached
            7. generateReport():
                 GET /locations/                       (Topology)
                 resolvePairs(): nombre exacto → location; ambiguas/no halladas → unmappedCameraNames
                 measurableEndDate(): recorta al último día UTC completo
                 4 exports asíncronos secuenciales:
                   1d ots · 1d viewers (group_by_demographics=1) · 1h ots · 1h viewers
                 buildMeasurementRows() → cameraDays, supportDays, demographics, incidents
                 buildSupportHours()    → supportHours
            8. gzip del JSON; si < 900 000 bytes → guarda snapshot
            9. devuelve { report, cached }
  └─ buildQuividiCampaignBlob(report)  → ExcelJS en el navegador
  └─ download(...)                      quividiCampaignFileName(report)
```

### 4.3 Protocolo VidiCenter

- Base: `https://vidicenter.quividi.com/api/v1` (`index.ts:18`).
- Auth: `Basic base64(QUIVIDI_API_USERNAME:QUIVIDI_API_TOKEN)`, secretos de
  Firebase (`defineSecret`). **Nunca** en variables `VITE_*` ni en el navegador.
- Topology: `GET /locations/`.
- Data Export: `GET /data/?locations=&start=&end=&time_resolution=&data_type=`.
  Los exports son **asíncronos**: se repite la misma petición hasta que
  `state === 'finished'`. Estados manejados: `started`, `in_progress`,
  `finished`, `failed`, HTTP 429 (espera progresiva), desconocido → `data-loss`.
  Presupuesto: 24 intentos, espera `min(8 s, 1 s + intento·0,75 s)`
  (429: `min(10 s, 2 s + intento·0,5 s)`) — `index.ts:254`.

### 4.4 Caché (`campaignAudienceSnapshots`)

| Campo | Contenido |
|---|---|
| `schemaVersion` | `3` (incluye `supportHours`) |
| `inputSignature` | sha256 de nombre, fechas, `scopeOrigins` y pares (tienda, soporte, cámaras, origen, ekon) |
| `compressedReport` | JSON del reporte, gzip, como bytes |
| `coverage`, `campaignName`, `startDate`, `endDate`, `generatedAt` | metadatos legibles |
| `updatedByUid`, `updatedByEmail` | trazabilidad |

Frescura (`snapshotIsFresh`): campaña **vigente** → se reutiliza ~24 h
(`ACTIVE_CACHE_MS`); campaña **terminada** → el snapshot es definitivo si se
generó después del cierre. Cualquier cambio de configuración cambia la firma e
invalida la caché.

---

## 5. Superficie de datos del contrato (`QuividiCampaignReport`)

```ts
{
  schemaVersion: 3;
  campaignId, campaignName, startDate, endDate, generatedAt;
  scopeOrigins:  { support, source, pairCount, ekonNumber }[];
  coverage:      { totalPairs, mappedPairs, percent, bySupport[] };
  cameraDays:    fila por cámara × día (dato crudo + status + IDs técnicos);
  supportDays:   fila por Tienda+Soporte × día (ponderada);
  supportHours:  fila por Tienda+Soporte × día × hora (ponderada);
  demographics:  fila por Tienda+Soporte × día × (gender, age);
  incidents:     cámaras con días partial/missing;
  unmappedCameraNames: string[];
}
```

Cobertura = `pares con cámara / pares del alcance`, general y por soporte.
Las tiendas sin Quividi **no se extrapolan**.

Códigos de demografía (`src/domain/quividi.ts`): género `0` Desconocido,
`1` Masculino, `2` Femenino; edad `0` Desconocido, `1` Niñez (1–15),
`2` Adulto joven (16–30), `3` Adulto (31–65), `4` Senior (66+).

---

## 6. Excel generado

Orden intencional: **primero la lectura comercial**, el detalle técnico al final.

| # | Hoja | Fuente |
|---|------|--------|
| 1 | Dashboard Ejecutivo | `quividiMarketingSheets.ts:196` + analytics |
| 2 | Tiendas | `storeSummaries()` |
| 3 | Días y Horarios | `heatmapCells()` (mapa de calor día×hora) |
| 4 | Evolución Diaria | `dailySummaries()` |
| 5 | Detalle Horario | `supportHours` |
| 6 | Resumen Técnico | `quividiCampaignExcel.ts:141` |
| 7 | Alcance | `scopeOrigins` + número Ekon |
| 8 | Detalle Soportes | `supportDays` |
| 9 | Cámaras | `cameraDays` (incluye `location_id`, `box_id`, `site_id`, duración) |
| 10 | Demografía | `demographics` |
| 11 | Calidad medición | `incidents` + conteo complete/partial/missing |
| 12 | Metodología | reglas y limitaciones declaradas |

Franjas horarias fijas (`TIME_BANDS`): Madrugada 00–06, Mañana 06–12, Mediodía
12–16, Tarde 16–20, Noche 20–24. La franja «Madrugada» se omite si su OTS es 0.
Las semanas se ordenan lunes→domingo (`[1..6, 0]`); `dayOfWeek()` interpreta la
fecha civil a mediodía UTC para evitar corrimientos.

---

## 7. Seguridad

Lo que **está** bien resuelto:

- El token Quividi nunca sale de Cloud Functions (`defineSecret`, nunca `VITE_*`).
- Ambas callables exigen `request.auth` (`unauthenticated` en caso contrario).
- `campaignAudienceSnapshots` **no tiene regla** en `firestore.rules`, por lo que
  cae en el cierre por defecto `match /{document=**} { allow read, write: if false; }`.
  Solo el Admin SDK (que omite reglas) la escribe y la lee. Es el
  comportamiento deseado y conviene **no** añadirle una regla de lectura.
- `campaignAvailability` está acotada a 250 ids por llamada.

Lo que **falta** (ver F5, F9):

- No hay comprobación de rol: `src/app/permissions.ts` no declara ninguna
  capacidad Quividi, así que un `viewer` autenticado puede descargar el reporte
  y provocar llamadas a la API de Quividi.
- `forceRefresh` está expuesto en el contrato de la callable (la UI siempre
  envía `false`, pero un cliente puede enviar `true` en bucle y saltarse la
  caché). No hay rate limiting propio.

---

## 8. Cobertura de pruebas

| Área | Pruebas |
|---|---|
| `quividiMarketingAnalytics.ts` | 5 casos (`quividiMarketingAnalytics.test.ts`) |
| `quividiCoverage.ts` (código muerto) | 2 casos |
| Catálogo: columna `CAMARA QUIVIDI` | cubierto en `masterImport.test.ts` / `masterExport.test.ts` |
| `functions/src/quividi/*` (876 + 507 + 233 líneas) | **ninguna** |

`functions/package.json` no declara runner de pruebas y CI
(`.github/workflows/ci.yml`, job `functions`) solo ejecuta `npm run build`.
Toda la lógica de alcance efectivo, ponderación multi-cámara, medición parcial,
caché y capa horaria viaja **sin red de seguridad**.

---

## 9. Hallazgos detallados

### F1 · Alta — `campaignAvailability` reconsulta Ekon por campaña

`functions/src/quividi/index.ts:856` llama a `buildEffectiveSupportPairs` dentro
del bucle **sin pasar `assignmentCache`**. El parámetro tiene valor por defecto
`new Map()` (`effectiveScope.ts:379`), así que cada campaña crea una caché nueva
y vuelve a consultar `ekonAssignments`. Con 250 campañas eso son hasta 250
lecturas de `campaignEkonLinks` + 250 consultas `where(campaignNumber)` (más las
legacy por `campaignNameKey`), todas **secuenciales** (`await` dentro de `for`).
Se dispara en cada carga de la pantalla Campañas.

**Corrección sugerida**: crear una sola `Map` fuera del bucle y pasarla en cada
llamada; opcionalmente paralelizar con `Promise.all` por lotes.

### F2 · Alta — Sin pruebas en `functions/`

Ver §8. Las reglas más delicadas (precedencia de alcance, compatibilidad
circuito↔soporte, umbral del 80 % de medición parcial, ponderación) no tienen
ninguna prueba. Un cambio inocente puede alterar cifras entregadas a marcas sin
que CI lo note.

**Corrección sugerida**: añadir Vitest a `functions/` y cubrir al menos
`buildEffectiveSupportPairs`, `buildMeasurementRows` y `buildSupportHours`; o
mover esa lógica pura a `src/domain/quividi/` compartida y probarla ahí.

### F3 · Media — Presupuesto de tiempo de los exports

`generateReport` encadena **cuatro** exports asíncronos. Cada uno puede
consumir 24 intentos con esperas de hasta 8–10 s (~3 min). En el peor caso se
superan los `timeoutSeconds: 540` y el usuario recibe un error genérico tras
9 minutos, sin resultado parcial.

**Corrección sugerida**: lanzar los cuatro exports en paralelo (`Promise.all`),
o degradar la capa horaria (hacerla opcional) cuando el diario ya consumió el
presupuesto.

### F4 · Media — Topología sin validar ni paginar

`index.ts:637` hace `quividiGet<TopologyLocation[]>('/locations/')` y
`resolvePairs` itera el resultado directamente. Si VidiCenter devuelve un objeto
paginado (`{count, next, results}`) o aplica un límite por defecto, el `for`
lanza `TypeError` o se pierden cámaras **en silencio** (aparecerían como
`unmappedCameraNames`, indistinguibles de un nombre mal escrito).

**Corrección sugerida**: validar que la respuesta es array; si no, leer
`results` y seguir `next` hasta agotar la paginación.

### F5 · Media — Sin control de rol

Ver §7. Añadir una capacidad (p. ej. `quividi.report`) a
`src/app/permissions.ts` y validarla también en la callable con
`request.auth.token.role`, coherente con la nota de `CLAUDE.md`: esconder
botones no es control de acceso.

### F6 · Media — Snapshot descartado en silencio

`index.ts:786`: si el gzip supera 900 000 bytes no se persiste nada y la función
devuelve el reporte con `cached: false`. Una campaña grande (muchas tiendas ×
muchos días × 24 h) recalculará **siempre** desde cero, con el coste de API
correspondiente, y ni el usuario ni el log lo indican.

**Corrección sugerida**: registrar un `logger.warn` y/o persistir un snapshot
degradado (sin `supportHours`) marcando el recorte en el documento.

### F7 · Media — `quividiCoverage.ts` es código muerto y divergente

`src/modules/campaigns/quividiCoverage.ts` solo lo importa su propio test. La UI
usa la disponibilidad del backend. Además su lógica **no coincide** con
`effectiveScope.ts`: no aplica los alias `MUPPI'S`/`PENDON`, no distingue
`scopeSource` y no tiene fallback Ekon. Mantenerlo invita a que alguien lo
reutilice y obtenga una cobertura distinta a la del reporte.

**Corrección sugerida**: eliminarlo (con su test) o marcarlo explícitamente como
utilidad de pruebas fuera del flujo productivo.

### F8 · Baja — Zona horaria

`dayList()`/`measurableEndDate()` razonan en **UTC**, mientras que los exports se
piden con marcas locales sin offset (`${startDate}T00:00:00`) y VidiCenter
responde en el huso de cada ubicación (decisión explícita: SIGNAM no fuerza una
zona horaria única). En México (UTC−6) el «último día UTC completo» puede dejar
fuera parte del día local en curso, o incluir un día local sin datos. El efecto
es de borde (primer/último día del periodo) y no invalida el reporte, pero debe
conocerse al conciliar cifras con VidiCenter.

### F9 · Baja — Disponibilidad no valida contra VidiCenter

`campaignAvailability` responde `available: true` con solo tener un
`quividiCameraName` en el catálogo. Si el nombre está mal escrito o la location
se renombró en VidiCenter, el icono queda habilitado y la descarga produce un
Excel con cobertura resuelta pero sin mediciones (el nombre aparece en
`unmappedCameraNames`). Es un compromiso deliberado (evita pegarle a Quividi en
cada carga de pantalla) que conviene dejar por escrito en la UI.

Relacionado: en `resolvePairs`, un nombre que resuelve a **más de una** location
se descarta y se reporta como `"<nombre> (duplicada en Quividi)"`, mezclando en
un mismo arreglo «no encontrada» y «ambigua».

### F10 · Baja — Coste de `pairPeriods`

`hourly.ts:pairPeriods` recorre **todas** las claves del índice OTS por cada
cámara del par. Con 30 días × 24 h × N cámaras el coste es cuadrático en la
práctica. Indexar por `locationId → periodos` al construir el índice lo vuelve
lineal.

### F11 · Baja — Documentación de entrada

`README.md` no menciona Quividi en absoluto y `.env.example` no puede (ni debe)
contener los secretos, pero tampoco los nombra. El único punto de entrada es
`docs/QUIVIDI_PHASE_1.md`. Conviene enlazarlo desde el README y nombrar
`QUIVIDI_API_USERNAME` / `QUIVIDI_API_TOKEN` como requisitos de despliegue.

### Observaciones sin severidad

- `effectiveScope.ts:398` calcula `scope` pero solo lo usa para detectar
  `'invalid'`; la rama «legacy sin `scopeSource`» se resuelve por el orden de los
  `if`, no por esa variable. Es correcto respecto a lo documentado, pero la
  variable induce a error al leerla.
- El estado de un `supportDay` es `complete` solo si **todas** las cámaras del
  par lo son; basta una `missing` para degradar el día a `partial` aunque la
  medición usada sea completa. Es intencional (conservador), conviene no
  «corregirlo» sin decisión documentada.
- En demografía, el promedio entre cámaras seleccionadas cuenta como `0` a las
  cámaras que no reportaron ese bucket, lo que aplana la distribución cuando las
  cámaras de un mismo par miden poblaciones distintas. Coherente con la regla
  multi-cámara, pero es un matiz a declarar si se compara con VidiCenter.
- No se fija región en `getFunctions(app)` (`src/services/firebase.ts:72`) ni en
  las callables: ambos usan `us-central1` por defecto, así que hoy coinciden.
  Fijar la región explícitamente en ambos lados evitaría una rotura silenciosa.

---

## 10. Invariantes que NO deben romperse sin decisión documentada

1. Quividi **solo lee**. Nunca escribe en `campaigns`, `screens`,
   `campaignEkonLinks`, consolidaciones, exportaciones CSV ni seguimiento.
2. El fallback Ekon es **derivado**: jamás persiste tiendas Ekon dentro de la
   campaña Liverpool.
3. Varias cámaras en un mismo Tienda + Soporte **se promedian, no se suman**.
4. La tasa de atención se **recalcula** (`Watchers / OTS`); nunca se promedian
   porcentajes.
5. OTS y Watchers agregados se rotulan como **contactos/detecciones**, nunca como
   reach único.
6. No se rellenan faltantes con cero ni se extrapolan días o tiendas sin medición.
7. El token Quividi nunca llega al navegador ni al repositorio.
8. Los 12 campos oficiales del maestro Admira no cambian: `CAMARA QUIVIDI` es un
   **metadato SIGNAM** aparte y no se exporta dentro del maestro oficial.
9. `campaignAudienceSnapshots` es de backend; no abrirla a lectura de cliente.
10. Alias exclusivos del reporte: `MUPPI'S → MEGA MUPI DIGITAL`,
    `PENDON → BANNER DIGITAL`. No propagarlos a consolidación ni a CSV.

---

## 11. Guía rápida de operación

**Dar de alta una cámara**

1. Catálogo Admira → exportar maestro con la columna `CÁMARA QUIVIDI`.
2. Llenar el nombre **exacto** de la location de VidiCenter.
3. Catálogo Admira → Importar maestro → **Actualizar mapeos** → confirmar.
   (Esta opción empareja por los 12 campos oficiales y solo actualiza
   `NORMALIZACION LIVERPOOL` y `CAMARA QUIVIDI`; no crea ni borra pantallas.)

Alternativa puntual: editar la pantalla en el catálogo (`ScreenForm`).

**Credenciales**

```bash
firebase login
firebase use signam-v2-prod
firebase functions:secrets:set QUIVIDI_API_USERNAME
firebase functions:secrets:set QUIVIDI_API_TOKEN
firebase deploy --only functions:quividi
```

**Diagnóstico cuando el icono no aparece**

1. ¿La campaña tiene soportes con alcance resoluble? Revisar `scopeOrigins`
   (`unresolved` = sin comentario, sin CRIUS/Poster LED y sin Ekon vinculado).
2. ¿Las pantallas del par están **activas** y tienen `calendarSupport`?
3. ¿Alguna pantalla del par tiene `quividiCameraName`? Sin él no hay cobertura.
4. Si es un soporte sin comentario: ¿está vinculado el número Ekon en Campañas?

**Diagnóstico cuando el Excel sale vacío**

1. Hoja **Cámaras** vacía → los nombres no resolvieron: revisar
   `unmappedCameraNames` (hoja Calidad medición).
2. Campaña futura o iniciada hoy → `measurableEndDate` devuelve `null` y no hay
   días medibles (solo se mide hasta el último día UTC completo).
3. Todo `missing` → la location existe pero no entregó datos en el periodo.

---

## 12. Glosario

| Término | Definición |
|---|---|
| **OTS** | Oportunidades de estar expuesto al soporte |
| **Effective OTS** | Oportunidades dentro del ángulo efectivo de visión |
| **Watchers** | Personas detectadas que dirigieron la mirada a la pantalla |
| **Tasa de atención** | `Watchers / OTS` |
| **Attention Time** | Tiempo promedio mirando la pantalla |
| **Dwell Time** | Tiempo promedio frente o cerca del soporte |
| **Location** | Cámara Quividi en VidiCenter; su `name` es la llave de cruce |
| **Par** | Combinación Tienda + Soporte normalizado |
| **Cobertura** | Pares con cámara / pares del alcance |
| **Medición parcial** | Día con duración < 80 % de la mediana de esa cámara |
| **Cocomercialización** | Alcance derivado de asignaciones Ekon cuando el Calendario no trae tiendas |
