# Quividi — Fase 2: salud operativa de cámaras

> Estado vigente de la integración operativa Quividi en SIGNAM V2.
>
> - Implementación base: PR #120 — persistencia diaria de salud por cámara.
> - Motor de incidencias: PR #121 — evaluación del último día completo y ciclo
>   de vida de alertas.
> - Location ID + UI: PR #122 — identidad estable en Catálogo Admira y módulo
>   **Operación → Salud de cámaras**.
> - Este documento complementa `docs/QUIVIDI_PHASE_1.md`, que conserva el
>   diseño del reporte de audiencia por campaña.
> - Reglas transversales autoritativas: `AGENTS.md`.

---

## 1. Objetivo

La Fase 2 separa dos necesidades que no deben mezclarse:

1. **Reporte de audiencia por campaña** — Fase 1. Produce información comercial
   contextual a una campaña Liverpool.
2. **Salud operativa de cámaras** — Fase 2. Mantiene un histórico técnico por
   cámara y detecta incidencias vigentes independientemente de campañas.

La fuente operativa es el **Catálogo Admira de SIGNAM** (`screens`) y la
topología de VidiCenter. Una cámara puede existir y ser monitoreada aunque no
haya una campaña activa que la use.

---

## 2. Identidad de cámara

Cada pantalla puede guardar hasta dos vínculos Quividi y dos puntos estables SIGNAM:

- `calendarSupport`: normalización Liverpool.
- `measurementPointCode` / `measurementPointCode2`: código corto del punto físico (`1`, `2`, `P1`, `P2`).
- `measurementPointId` / `measurementPointId2`: identidad estable construida como `LIV-TIENDA-SOPORTE-PUNTO`.
- `quividiLocationId` / `quividiLocationId2`: Location ID vigente en Quividi.
- `quividiCameraName` / `quividiCameraName2`: alias canónico de cada location.

### Regla de identidad

El **Punto SIGNAM** es la identidad permanente del punto físico. El Location ID es la referencia técnica vigente para consultar Quividi y puede cambiar sin crear un nuevo punto SIGNAM.

El alias `quividiCameraName` queda como:

- referencia visual;
- compatibilidad temporal con registros legacy;
- fallback únicamente cuando todavía no existe Location ID.

Un cambio de alias no altera la identidad. Si cambia el Location ID por sustitución/reconfiguración pero la cámara sigue midiendo el mismo punto físico, se conserva el mismo Punto SIGNAM. Si cambia el punto físico medido, debe asignarse otro código de punto.

### Alta y edición desde Catálogo Admira

En el formulario de alta/edición existe un bloque **Vínculo Quividi**:

1. se captura el Location ID;
2. SIGNAM llama a `quividi-locationLookup`;
3. el backend valida que la location exista;
4. devuelve el alias canónico;
5. se guardan ID + alias en `screens.metadata`.

Si el ID no existe, no se considera validado.

### Migración de registros legacy

El job de salud también ejecuta una sincronización conservadora:

- si ya existe Location ID y VidiCenter lo reconoce, sincroniza el alias;
- si falta el ID pero el alias coincide con **una sola** location, rellena el ID;
- si el alias no existe o es ambiguo, no adivina y no modifica el registro.

Esto permite migrar el inventario existente sin capturar manualmente todos los
IDs.

---

## 3. Fuente de inventario y mapeo

La salud operativa se deriva de pantallas activas en `screens`.

Para participar en Camera Health se requiere:

- `metadata.active !== false`;
- número de tienda;
- `calendarSupport`;
- Location ID válido o, temporalmente, alias Quividi resoluble.

El par operativo sigue siendo:

```text
Numero de Tienda + calendarSupport -> 1..N cámaras Quividi
```

Cada cámara física se conserva por separado para salud técnica. No se promedian
cámaras para decidir si una cámara concreta está caída.

Si el mismo Location ID queda asignado a más de un par tienda/soporte, se trata
como ambigüedad y se excluye hasta corregir el catálogo.

---

## 4. Persistencia diaria

Colección backend-only:

```text
quividiCameraHealthDaily/{YYYY-MM-DD__locationId}
```

Cada documento representa una cámara física en un día.

Campos principales:

- tienda y soporte;
- `locationId`, `locationName`, `boxId`, `siteId`;
- `topologyActive`, `lastSeen`;
- duración medida;
- OTS, Effective OTS, Watchers;
- Attention time y Dwell time;
- `measurementStatus`: `complete | partial | missing`;
- cobertura horaria operativa y núcleo;
- primera/última hora medida y con OTS.

Las escrituras son idempotentes por `date + locationId`.

### Ventanas horarias

- **10:00–22:00**: ventana operativa amplia.
- **10:00–11:00**: tolerancia de arranque.
- **11:00–22:00**: ventana núcleo usada por el motor de salud.

La hora 10:00–11:00 no debe generar una incidencia por sí sola porque algunas
tiendas encienden cámaras alrededor de las 11:00.

---

## 5. Ejecución automática

Cloud Function programada:

```text
cameraHealthDaily
08:15 America/Mexico_City
```

Flujo:

```text
Catálogo screens
   ↓
VidiCenter /locations/
   ↓
sincronización Location ID / alias
   ↓
exports diarios + OTS horario
   ↓
quividiCameraHealthDaily
   ↓
motor de salud vigente
   ↓
estado + incidencias
```

La ventana móvil normal es de 28 días. Si la colección diaria está vacía, el
primer ciclo persiste el backfill inicial. Después se persiste el último día
completo.

Existe además `cameraHealthBackfill` para administración, con rango controlado
de 1–90 días.

Admin y operator pueden lanzar desde la UI `quividi-cameraHealthRefresh`.
Esta callable ejecuta el **mismo ciclo del scheduler** y sigue evaluando solo el
último día completo: nunca convierte el día parcial en una incidencia. Scheduler
y refresco manual comparten un lock global en
`quividiCameraHealthRefresh/control`; si ya existe una ejecución vigente no se
inicia una segunda. Tras finalizar se aplica un cooldown manual de 5 minutos.

Etapas publicadas a la UI:

1. conexión con Quividi;
2. sincronización de catálogo;
3. análisis OTS/medición;
4. actualización de incidencias;
5. sincronización Odoo.

La UI muestra etapas reales, no porcentajes estimados. También conserva la fecha
de la última ejecución automática y la última manual con el usuario que la
inició.

El cálculo del último día completo reutiliza actualmente la lógica
`lastCompleteUtcDate`. Cambiar esa frontera temporal requiere una decisión
explícita porque afecta continuidad histórica y fechas de incidencias.

---

## 6. Motor de salud vigente

Principio central:

> **Solo el último día completo determina si existe una incidencia activa.**

El histórico no convierte una caída antigua en una alerta actual. Se usa para:

- determinar desde cuándo continúa una anomalía vigente;
- conservar contexto;
- identificar el primer día normal de recuperación;
- evitar inventar continuidad cuando faltan días.

### Estados de salud

`normal`
: cobertura suficiente y actividad operativa sin una condición de alerta.

`no_measurement`
: 0 horas con medición en la ventana núcleo.

`partial_measurement`
: cobertura núcleo inferior al 80 %. Con 11 horas esperadas, menos de 9 horas
  se considera parcial.

`no_ots`
: cobertura de medición suficiente, pero OTS núcleo = 0.

`no_ots` no significa automáticamente “hardware desconectado”. Es una señal
operativa que requiere interpretación junto con medición, `lastSeen` y contexto.

---

## 7. Incidencias y ciclo de vida

Colecciones backend-only:

```text
quividiCameraHealthAlertState/{locationId}
quividiCameraHealthAlerts/{locationId__startedDate}
```

### AlertState

Un documento por cámara. Mantiene:

- estado actual;
- severidad;
- último día evaluado;
- puntero a incidencia activa;
- fecha de inicio;
- métricas actuales de cobertura y OTS;
- `monitored`.

También es el punto de serialización transaccional por cámara. Scheduler y
backfill no deben dejar dos incidencias activas para un mismo Location ID.

### Incidencia

Una anomalía continua produce una sola incidencia, no una por día.

Si cambia de `partial_measurement` a `no_measurement` o `no_ots` sin un día
normal intermedio, continúa siendo el mismo incidente.

Al recuperarse:

- `state = recovered`;
- `lastAnomalousDate` = último día anómalo;
- `recoveredDate` = primer día normal observado.

Si la cámara deja de pertenecer al scope:

- la incidencia no se marca como recuperada;
- pasa a `retired`;
- razón `out_of_scope`;
- el estado queda `monitored:false`.

Si falta continuidad histórica suficiente, no se inventa:

- la incidencia previa se retira con `history_gap`;
- una anomalía vigente comienza una incidencia nueva desde el último tramo
  demostrable.

---

## 8. UI — Operación → Salud de cámaras

Ruta:

```text
/salud-camaras
```

Permiso:

```text
quividi.report
```

La pantalla muestra:

- cámaras monitoreadas;
- normales;
- alertas activas;
- fuera de alcance;
- última actualización automática/manual;
- progreso del refresco global cuando existe una ejecución en curso.

`Actualizar vista` relee Firestore sin consumir VidiCenter. Admin y operator
ven además `Actualizar desde Quividi`; viewer puede observar el progreso pero
no iniciar el proceso. Mientras existe un refresco, los botones de creación
manual de tickets quedan deshabilitados y el backend también rechaza esa acción
para evitar carreras con la reconciliación de incidencias.
- tienda;
- soporte;
- Location ID;
- alias Quividi;
- estado operativo;
- fecha de inicio;
- días consecutivos;
- cobertura 11:00–22:00;
- horas con OTS;
- OTS;
- último día evaluado;
- recuperaciones recientes.

La vista permite buscar por tienda, soporte, alias o Location ID y filtrar por
estado.

### Importante

**Actualizar la vista no vuelve a consultar VidiCenter.**

La UI llama a `quividi-cameraHealthOverview`, que lee el último estado ya
calculado en Firestore. Esto separa observación operativa de adquisición de datos.

---

## 9. Callables relevantes

### `quividi-locationLookup`

Valida un Location ID contra la topología de VidiCenter y devuelve:

- ID;
- alias/nombre;
- estado activo;
- `lastSeen`.

Se utiliza desde Catálogo Admira.

### `quividi-cameraHealthOverview`

Callable autenticada de solo lectura para la UI de Salud de cámaras.

No modifica incidencias y no dispara exports de VidiCenter.

### `quividi-cameraHealthRefresh`

Refresco operativo manual para admin/operator. Ejecuta el mismo ciclo del
scheduler, sincroniza Odoo bajo las mismas reglas y respeta lock/cooldown global.

### `quividi-cameraHealthBackfill`

Recalcula un rango histórico controlado. Requiere capacidad administrativa para
forzar refrescos Quividi. No sustituye el refresco operativo de la UI.

---

## 10. Seguridad

Las credenciales Quividi siguen únicamente en backend mediante Secret Manager:

- `QUIVIDI_API_USERNAME`;
- `QUIVIDI_API_TOKEN`.

El navegador nunca recibe estas credenciales.

Las colecciones diarias, estados e incidencias permanecen backend-only. La UI
consume una callable autenticada y autorizada.

---

## 11. Relación con la Fase 1

La Fase 1 continúa vigente para reportes por campaña:

- icono de analítica en Campañas;
- alcance Calendario/Ekon;
- snapshot por campaña;
- Excel técnico/comercial;
- agregación multi-cámara por tienda + soporte.

La Fase 2 **no reutiliza los snapshots de campaña** como histórico operativo.
Hacerlo duplicaría medición cuando campañas se solapan.

Ambas capas comparten:

- topología Quividi;
- normalización tienda/soporte;
- primitives de medición;
- control de acceso.

Pero tienen persistencias y objetivos distintos.

---

## 12. Qué NO está implementado todavía

### Odoo / tickets `[CAMARAS]`

Está diseñado conceptualmente, pero **no está implementado**.

Dirección acordada:

- añadir la clasificación/etiqueta `CAMARAS` junto a Soporte y Contenido;
- identificar una incidencia por tienda + cámara/Location ID;
- antes de crear, comprobar si ya existe un ticket activo de esa misma cámara;
- si existe, actualizar el ticket existente;
- si no existe, crear uno nuevo;
- añadir comentario automático diario mientras siga activa;
- permitir comentarios durante estados abiertos, en progreso o en espera de
  permiso de acceso;
- añadir comentario de recuperación;
- no cerrar automáticamente el ticket en la primera versión;
- mantener vínculo estable `alertId ↔ odooTicketId`.

No se debe crear un ticket por cada día ni deduplicar solo por tienda: una tienda
puede tener varias cámaras e incidencias independientes.

### Caída relativa de tráfico

Todavía no existe una alerta `traffic_drop` calibrada contra baseline histórico.
Antes de implementarla debe definirse el umbral con datos reales y comparar días
equivalentes, no simplemente contra el día anterior.

### Inteligencia de audiencia histórica / forecast

La capa de inteligencia comercial de largo plazo sigue pendiente y es distinta
de Salud de cámaras.

---

## 13. Archivos principales

Backend:

- `functions/src/quividi/cameraHealth.ts`
- `functions/src/quividi/cameraAlerts.ts`
- `functions/src/quividi/catalog.ts`
- `functions/src/quividi/healthOverview.ts`
- `functions/src/quividi/measurement.ts`
- `functions/src/quividi/effectiveScope.ts`
- `functions/src/quividi/index.ts`

Frontend:

- `src/modules/admira-catalog/ScreenForm.tsx`
- `src/modules/admira-catalog/CatalogPage.tsx`
- `src/modules/camera-health/CameraHealthPage.tsx`
- `src/modules/camera-health/cameraHealthView.ts`
- `src/services/quividi.ts`
- `src/domain/quividiHealth.ts`

Documentación:

- `AGENTS.md` — invariantes actuales.
- `docs/QUIVIDI_PHASE_1.md` — reporte por campaña.
- `docs/QUIVIDI_AUDITORIA.md` — auditoría histórica de Fase 1.
- `docs/QUIVIDI_PHASE_2.md` — este documento.

---

## 14. Pruebas y CI

La implementación tiene cobertura de:

- mapeo por Location ID;
- fallback legacy por alias;
- Location ID duplicado;
- ventana núcleo y tolerancia de arranque;
- sin medición;
- medición parcial;
- sin OTS;
- anomalía histórica recuperada;
- continuidad de incidencia;
- recuperación;
- filtros y estados de la UI.

Todo PR debe seguir pasando:

```text
Prettier
ESLint
TypeScript
Vitest
Vite build
Cloud Functions build
```

---

## 15. Siguiente orden recomendado

1. Observar el módulo **Salud de cámaras** con datos reales y ajustar ruido si
   aparece.
2. Integrar Odoo con categoría `[CAMARAS]`, deduplicación por Location ID y
   vínculo `alertId ↔ ticketId`.
3. Añadir seguimiento automático diario del ticket y comentario de recuperación.
4. Calibrar una alerta de caída relativa de OTS con histórico comparable.
5. Evolucionar, en una fase separada, la inteligencia de audiencia histórica.


## 8. Tickets automáticos Odoo por salud de cámaras

La automatización Odoo usa `measurementPointId` como llave de deduplicación, nunca `locationId`.

- `no_ots`: creación automática al procesar el último día completo.
- `no_measurement` y `partial_measurement`: se muestran como **Pendiente de decisión** y solo `admin/operator` pueden crear el ticket desde Salud de cámaras.
- Una vez creado, el botón desaparece y la UI muestra el folio.
- Cuando el punto vuelve a `normal`, SIGNAM agrega un comentario de recuperación al ticket pero **no lo cierra**.
- El cierre corresponde al equipo técnico.
- El estado backend se conserva en `quividiCameraTicketState/{measurementPointId}`, por lo que un cambio de Location ID no duplica tickets del mismo punto.
- La integración usa el secreto `ODOO_API_KEY`, el mismo tipo de credencial JSON/2 usado por el portal de soporte Liverpool.
- Antes de crear un ticket, SIGNAM busca el asunto determinístico
  `[CAMARAS][measurementPointId][startedDate]`; si ya existe exactamente uno,
  lo adopta. Esto evita duplicados cuando una creación anterior llegó a Odoo
  pero la respuesta se perdió por timeout.
- Tanto el scheduler como **Actualizar desde Quividi** ejecutan esta misma
  reconciliación Odoo. Repetir el cálculo no implica repetir el ticket ni el
  comentario de recuperación.
