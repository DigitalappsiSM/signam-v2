# Alertas de baja ocupación

Detecta pantallas con **baja variedad de contenidos de proveedor** para una
fecha civil y genera los CSV auxiliares **Ratio 1** y **Ratio 3** compatibles con
Admira. La decisión final y la carga en Admira siguen siendo **manuales**.

## Diagnóstico por reporte de pases de Admira (fase 1)

La misma ruta permite importar el Excel de ocupación de Admira y analizar la
programación que Admira reporta para cada `Nombre + Día`. Esta lectura convive
con el cálculo histórico de Signam, pero en esta fase son fuentes independientes:

- **Reporte Admira:** evidencia programada por player, fecha, campaña, contenido,
  categoría y pases por hora. Es la fuente del diagnóstico de repetición.
- **Planeación Signam:** campañas vigentes y catálogo; conserva la generación de
  CSV auxiliares y no se altera.
- **Sin conciliación de campañas:** no se normalizan ni se comparan todavía los
  nombres de campaña/contenido entre ambas fuentes.

El archivo se procesa en el navegador y no se persiste. Se busca una hoja que
contenga `Nombre`, `Día`, `Campaña`, `Contenidos`, `Categoria` y
`Pases/Slots en uso`; se admiten encabezados con espacios y mojibake común del
export. Los players se cruzan por coincidencia literal —tras recortar espacios—
contra `Nombre en plataforma` del catálogo.

### Regla de riesgo del reporte

Los contenidos se deduplican por `Campaña + Contenidos` dentro de cada
`player + día + categoría`:

1. Si hay Publicidad Tipo 1, se evalúa únicamente Ratio 1. El contenido Ratio 3
   no compensa una repetición comercial.
2. Si no hay Tipo 1, se evalúa Ratio 3; cuatro o más contenidos equilibrados se
   consideran una experiencia saludable.
3. Uno o dos contenidos son críticos; tres generan alerta; cuatro o más son
   saludables.
4. Cualquier contenido que concentre más de 35 % de los pases vuelve crítico el
   player, aunque tenga cuatro o más contenidos.
5. Un contenido con 15 pases por hora o menos genera alerta de entrega mínima.

Los valores con rango, por ejemplo `28|29`, se leen con su promedio para el
cálculo y conservan mínimo/máximo. El resultado se muestra inmediatamente por
fecha con detalle de campañas, videos y pases. No modifica campañas, catálogo,
CSV ni Firebase.

## Objetivo

Admira maneja dos ratios: **Ratio 1** (83 % del loop, marcas/proveedores) y
**Ratio 3** (17 %, institucionales). No existe Ratio 2. Cuando una pantalla tiene
solo uno o dos contenidos de proveedor vigentes, Admira repite demasiado esos
contenidos dentro del Ratio 1; el usuario carga manualmente institucionales de
relleno en Ratio 1 para dar variedad. SIGNAM **solo detecta** las pantallas
afectadas y genera CSV para indicar en qué pantallas los institucionales deben
ir en Ratio 1 y en cuáles permanecer en Ratio 3.

SIGNAM **no** administra los contenidos institucionales: no sabe cuántos hay, ni
su orden ni su frecuencia. El mismo CSV puede aplicarse manualmente a uno, dos o
tres institucionales.

## Unidad de análisis

Cada unidad se evalúa por la llave:

```
Numero de Tienda + NORMALIZACION LIVERPOOL (metadata.calendarSupport) + RESOLUCION
```

Una misma tienda puede tener resultados distintos por soporte o resolución.

## Conteo `Campaña + ARTICULOS`

Dentro de cada unidad, los contenidos de proveedor vigentes se **deduplican** por
`Campaña + ARTICULOS`:

- misma campaña y mismo artículo repetidos → un solo contenido;
- misma campaña con dos artículos distintos → dos contenidos;
- dos campañas distintas con el mismo artículo → dos contenidos;
- `TIPO DE PASES` y circuito **no** dividen el conteo; resolución y soporte
  normalizado **sí** separan el análisis.

Solo cuentan las campañas **Proveedor** (`classifyFromTipo` = `provider`). Un tipo
Institucional, `ISM/INSTITUCIONAL 1`, desconocido o ambiguo **nunca** cuenta.

Una campaña está vigente cuando `fechaInicio <= fechaAnalizada <= fechaFin`
(ambos extremos inclusivos, en fechas civiles sin desfase por zona horaria).

## Clasificación 0 / 1 / 2 / 3+

| Proveedores | Nivel                     | Ratio   | CSV                        |
| ----------- | ------------------------- | ------- | -------------------------- |
| 0           | Sin ocupación comercial   | Ratio 3 | **CSV Ratio 3 (subconj.)** |
| 1           | Baja ocupación crítica    | Ratio 1 | CSV Ratio 1                |
| 2           | Baja ocupación preventiva | Ratio 1 | CSV Ratio 1                |
| 3 o más     | Ocupación normal          | Ratio 3 | CSV Ratio 3                |

Las unidades con **cero proveedores** conservan el nivel **Sin ocupación
comercial** y aparecen como **alerta** en la interfaz, pero **pertenecen a Ratio
3**: sus filas se exportan **dentro del CSV Ratio 3** (subconjunto de Ratio 3),
para que Admira coloque ahí los institucionales de relleno. El filtro
«Sin ocupación» y el botón **«Ver alertas»** siguen filtrando por el **nivel**
`sin-ocupacion`.

## Agrupación de CSV

La **evaluación** es por `tienda + normalización + resolución`, pero los
**archivos** se agrupan por `NORMALIZACION LIVERPOOL + RESOLUCION`. Por cada
combinación pueden generarse dos archivos independientes: **CSV Ratio 1**
(unidades con 1–2 proveedores) y **CSV Ratio 3** (unidades con 3+). No se mezclan
soportes normalizados ni resoluciones distintas en el mismo archivo.

### Formato Admira

Los CSV reutilizan exactamente el formato de Admira del módulo de campañas
(`serializeAdmiraCsv`, `AdmiraCsvRow`, encabezados, columna guarda, BOM UTF-8,
CRLF, `RETAILERS = LIVERPOOL`, etiqueta `Tipo de Pases`). La conversión de
pantalla a fila es `screenToAdmiraRow` (compartida con la consolidación).

Los textos `RATIO 1` / `RATIO 3` aparecen **únicamente en el nombre del archivo**,
nunca dentro de las columnas.

### Nombre de archivo

```
<NORMALIZACION>_<RESOLUCION>_RATIO_<1|3>_ANALISIS_<AAAA-MM-DD>_GENERADO_<AAAA-MM-DD>.csv
```

Ejemplo:

```
VIDEO_WALL_CRIUS_904x918_RATIO_1_ANALISIS_2026-08-30_GENERADO_2026-08-06.csv
```

El nombre incluye **siempre** la **fecha analizada** y la **fecha de generación**
(aunque sean iguales). La **fecha analizada** es la que elige el usuario; la
**fecha de generación** es el día en que se descarga el archivo. El nombre se
sanea (sin acentos, espacios/diagonales → `_`, sin caracteres inválidos, sin
guiones bajos duplicados, conservando números y dimensiones).

No se descargan CSV vacíos: si una combinación no tiene filas para un ratio, el
botón se deshabilita y se muestra `Sin pantallas para Ratio 1/3`.

## Comparación contra el día anterior

Cada tarjeta `NORMALIZACION + RESOLUCION` indica si el resultado **cambió
respecto al día calendario anterior**, para evitar cargar en Admira archivos
idénticos día tras día.

- **Reconstrucción sin persistencia.** «Ayer» se recalcula con las **campañas y
  el maestro actuales** (no se guardan snapshots). El motor `analyzeLowOccupancy`
  se ejecuta **dos veces con los mismos datos cargados**: para la fecha
  seleccionada y para el día anterior.
- **«Ayer» = día calendario anterior**, incluidos fines de semana
  (`previousCivilDate` resta **un día civil** en UTC, sin desfase de zona horaria;
  resuelve correctamente los cambios de mes y de año).
- **Criterio de cambio (autoritativo):** se comparan las **filas finales
  deduplicadas** de Admira por grupo y por ratio, **ignorando el orden**, el
  encabezado, el BOM, el nombre del archivo y las fechas del nombre. «Sin
  proveedores» se compara por **unidades** `tienda + normalización + resolución`.
  El contador **ilustrativo de pantallas no determina el cambio**.
- **Estados:** `Sin cambios`, `Cambió`, `Nuevo` y `Ya no tiene contenido`. Se
  muestra un estado **general** por tarjeta y uno **individual** para Ratio 1,
  Ratio 3 y Sin proveedores, junto con la **fecha comparada en `dd/mm/aaaa`**.
- **Detalle:** resumen y lista de los **centros que entraron/salieron** por
  sección (modal «Ver cambios del día»).
- **Consulta histórica:** si se elige una fecha en el calendario, se compara
  contra **su** día anterior.

> ⚠️ **Limitación de la reconstrucción sin persistencia.** Como «ayer» se
> reconstruye con los datos actuales, si el **maestro** o el **calendario**
> cambiaron después, la comparación **no reproduce necesariamente el archivo
> exacto** que se generó ayer. Señala si el resultado que Admira recibiría hoy
> **para la fecha anterior** difiere del de la fecha seleccionada; **no** es un
> historial auditable. Para reproducir el archivo exacto de un día habría que
> persistir snapshots (opción no elegida en esta etapa).

La comparación es **de solo lectura**: no altera columnas, encabezados,
deduplicación, nombres ni contenido de los CSV, ni la advertencia general de
Campañas.

## Arquitectura

Separación estricta de responsabilidades:

- **Motor puro** — `occupancyAnalysis.ts` (`analyzeLowOccupancy`,
  `filterUnits`, helpers de fecha/clasificación). Sin React ni Firebase. Reutiliza
  `matchCampaignScreens` / `buildScreenIndex` del motor de consolidación para no
  mantener una segunda variante incompatible del cruce calendario↔catálogo.
- **Comparación pura** — `occupancyComparison.ts` (`compareOccupancy`,
  `previousCivilDate` y helpers de etiqueta/plural/fecha). Sin React ni Firebase;
  reutiliza el resultado de `analyzeLowOccupancy` sin reimplementar consolidación
  ni serialización.
- **Generación CSV** — `occupancyCsv.ts` + `occupancyFileName.ts`.
- **Presentación** — `LowOccupancyPage.tsx` y `components/` (resumen, filtros,
  tabla, detalle, exportaciones, distintivos de comparación y detalle de
  cambios).
- **Acceso a datos** — bajo demanda con `listCampaigns()` + `listScreens()`
  (`Promise.all`). Se recalcula al abrir la página, cambiar la fecha, pulsar
  **Recalcular** o volver tras una importación.
- **Reporte de pases** — `readAdmiraPassesWorkbook.ts` lee el Excel;
  `admiraPasses.ts` valida, deduplica, cruza players y clasifica el riesgo;
  `AdmiraPassesPanel.tsx` contiene la importación y el detalle operativo.

En esta versión **no** se persisten resultados: Ratio 1 / Ratio 3 son
recomendaciones calculadas para una fecha, no propiedades permanentes.

## Lo que NO cambia

La nueva agrupación `NORMALIZACION LIVERPOOL + RESOLUCION` aplica **solo** a los
archivos auxiliares Ratio 1 / Ratio 3. **No** se modifica la consolidación normal
`Campaña + RESOLUCION`, el CSV normal de campañas, el catálogo, el seguimiento
operativo, las asociaciones Ekon, `TIPO DE PASES`, el ratio 83/17, las reglas de
pantallas inactivas ni las exclusiones de InStore Media. Tampoco existe un
catálogo institucional.

## Advertencia no bloqueante en Campañas

El flujo normal de **Campañas** muestra una advertencia cuando existen pantallas
con 1–2 proveedores para hoy (con enlace a `/alertas-ocupacion?fecha=AAAA-MM-DD`).
No bloquea, no cambia el CSV normal ni impide exportar.
