# Alertas de baja ocupación

Detecta pantallas con **baja variedad de contenidos de proveedor** para una
fecha civil y genera los CSV auxiliares **Ratio 1** y **Ratio 3** compatibles con
Admira. La decisión final y la carga en Admira siguen siendo **manuales**.

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

| Proveedores | Nivel                     | Ratio     | CSV                |
| ----------- | ------------------------- | --------- | ------------------ |
| 0           | Sin ocupación comercial   | (ninguno) | **Fuera de ambos** |
| 1           | Baja ocupación crítica    | Ratio 1   | CSV Ratio 1        |
| 2           | Baja ocupación preventiva | Ratio 1   | CSV Ratio 1        |
| 3 o más     | Ocupación normal          | Ratio 3   | CSV Ratio 3        |

Las unidades con **cero proveedores** aparecen como **alerta** en la interfaz y
quedan **fuera de ambos CSV**.

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

## Arquitectura

Separación estricta de responsabilidades:

- **Motor puro** — `occupancyAnalysis.ts` (`analyzeLowOccupancy`,
  `filterUnits`, helpers de fecha/clasificación). Sin React ni Firebase. Reutiliza
  `matchCampaignScreens` / `buildScreenIndex` del motor de consolidación para no
  mantener una segunda variante incompatible del cruce calendario↔catálogo.
- **Generación CSV** — `occupancyCsv.ts` + `occupancyFileName.ts`.
- **Presentación** — `LowOccupancyPage.tsx` y `components/` (resumen, filtros,
  tabla, detalle, exportaciones).
- **Acceso a datos** — bajo demanda con `listCampaigns()` + `listScreens()`
  (`Promise.all`). Se recalcula al abrir la página, cambiar la fecha, pulsar
  **Recalcular** o volver tras una importación.

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
