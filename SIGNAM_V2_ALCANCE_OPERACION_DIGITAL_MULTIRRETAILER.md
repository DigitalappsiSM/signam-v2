# SIGNAM V2 — Implementación de operación Digital Signage multirretailer

## Instrucción principal para Codex

Implementa en el repositorio `DigitalappsiSM/signam-v2` un módulo persistente de operación Digital Signage multirretailer para importar la extracción de EKON **“Seguimiento Campañas”**, comenzando exclusivamente con:

- Retailers: `LA COMER` y `CHEDRAUI`.
- Soporte/artículo EKON: `COPETE DIGITAL`.
- Periodicidad: catorcenas indicadas por EKON.

El módulo debe alimentar **seguimiento operativo**, **dashboards** y un **Excel propio de catorcenas**. Debe conservar historial de importaciones, cambios y resoluciones de duplicados.

### Regla de aislamiento absoluta

Esta implementación **no puede cambiar directa ni indirectamente** ningún resultado, dato, flujo o comportamiento actual de Liverpool y Admira.

Los datos de La Comer y Chedraui:

- **NO** se programan en Admira.
- **NO** deben entrar en `campaigns`.
- **NO** deben entrar en `screens`.
- **NO** deben entrar en `campaignEkonLinks`.
- **NO** deben participar en consolidación Admira.
- **NO** deben generar CSV o ZIP de Admira.
- **NO** deben aparecer en la exportación PPT actual.
- **NO** deben participar en el reporte Excel actual de campañas Liverpool.
- **NO** deben participar en conciliación Liverpool ↔ EKON ↔ Admira.
- **NO** deben participar en baja ocupación Liverpool.
- **NO** deben participar en la matriz de carga por tienda/pantalla Liverpool.
- **NO** deben usar el catálogo de pantallas Admira.
- **NO** deben alterar las colecciones o documentos actuales de Liverpool.

La importación de una catorcena deberá producir exactamente **cero escrituras** en las colecciones actuales relacionadas con Liverpool/Admira.

Antes de modificar código:

1. Lee completamente `AGENTS.md`, `README.md` y los módulos relacionados.
2. Confirma que el repositorio y la rama base correspondan a `DigitalappsiSM/signam-v2` y `main`.
3. Crea una rama de trabajo específica.
4. No modifiques producción, no hagas merge y no despliegues Firebase.
5. Al finalizar, ejecuta formato, lint, typecheck, pruebas y build.
6. Abre un pull request en borrador contra `main` con una descripción clara del aislamiento aplicado.

---

## 1. Contexto funcional

SIGNAM V2 actualmente concentra principalmente la operación Digital Signage de Liverpool. El objetivo de este cambio es ampliar SIGNAM para que pueda contener la operación Digital Signage de otros retailers sin convertir los flujos Liverpool/Admira en un modelo genérico riesgoso.

La primera ampliación corresponde a `LA COMER` y `CHEDRAUI`, para el soporte `COPETE DIGITAL`. Estas campañas se gestionan por catorcenas y se programan en un CMS externo, no en Admira.

La extracción de referencia de EKON es un archivo `.xlsx` con:

- Hoja: `Seguimiento Campañas`.
- 39 columnas.
- Periodos como `C17 - 11/08/2026 a 24/08/2026`.
- Fechas Excel seriales en varias columnas.
- Información agregada por línea; no contiene determinantes ni tiendas individuales.

El archivo empresarial de referencia no debe confirmarse en Git. Utilízalo solo para validación local y crea fixtures sintéticos/anonimizados para las pruebas.

---

## 2. Decisiones de negocio confirmadas

### 2.1 Alcance inicial

Solo se importan filas que coincidan, mediante el catálogo activo, con:

- `Cadena = CHEDRAUI` y `Artículo = COPETE DIGITAL`.
- `Cadena = LA COMER` y `Artículo = COPETE DIGITAL`.

La comparación debe normalizar espacios, mayúsculas y acentos, pero debe ser una coincidencia exacta contra el retailer y artículo/alias autorizados.

No buscar `COPETE DIGITAL` dentro del título de creatividad, material u observaciones. En el archivo de referencia existen falsos positivos como:

- `COPETE MUPI`.
- `STOPPER-MEDIA` con una creatividad cuyo título contiene “COPETE DIGITAL”.

Esas filas deben quedar fuera del alcance salvo que posteriormente un administrador amplíe explícitamente el catálogo.

### 2.2 Clasificación continua/fijación

Usar como fuente autoritativa `Tipo Fijación`:

| Valor EKON | Valor normalizado | Etiqueta de usuario |
| --- | --- | --- |
| `Fijación` | `fixation` | `Fijación` |
| `Revisión` | `continuous` | `Continua` |
| Vacío/desconocido | `unresolved` | `Por revisar` |

Los valores vacíos o desconocidos deben generar una incidencia bloqueante. No inferir ni corregir silenciosamente la clasificación usando las fechas.

### 2.3 Seguimiento operativo aplicable

Para La Comer y Chedraui solo aplican estos tres indicadores:

1. `Link de descarga`.
2. `Validación de la cadena`.
3. `Programación CMS`.

También deben estar disponibles:

- Comentarios/bitácora.
- Cancelación y reactivación reversible.
- Motivo opcional de cancelación.
- Filtros y búsqueda.
- Historial de cambios.

### 2.4 Testigos: exclusión obligatoria

Los testigos se gestionan en otro apartado y no forman parte de este alcance.

Para estas operaciones:

- No mostrar `T Arranque`.
- No mostrar `T Completos`.
- No calcular objetivo de arranque.
- No calcular fechas límite de testigos.
- No generar alertas o vencimientos de testigos.
- No incluir testigos en el porcentaje de avance.
- No reutilizar `witnessTarget`, `businessDays` ni reglas Liverpool de testigos.

Los cinco checks actuales de Liverpool y todas sus reglas deben permanecer exactamente como están.

### 2.5 Duplicados exactos

Cuando dos o más filas sean exactamente iguales en todos los campos normalizados:

- Mostrar el grupo al usuario antes de importar.
- Proponer por defecto `Conservar una sola fila`.
- Exigir confirmación explícita.
- Permitir también `Conservar todas`, `Excluir todas` o `Cancelar la importación`.
- Guardar la decisión con usuario, fecha, lote y filas de origen.

No eliminar duplicados silenciosamente.

### 2.6 Duplicados lógicos con diferencias

Detectar filas con la misma clave lógica de registro pero diferencias en uno o más campos.

Opciones permitidas:

- Elegir cuál fila conservar.
- Conservar varias como registros separados.
- Excluir una o varias.
- Cancelar la importación.

No se permite consolidar ni sumar automáticamente `Nº Centros`, `Nº Soportes`, cantidades de material u otros campos.

La pantalla debe mostrar las diferencias campo por campo.

### 2.7 Registros fuera del catálogo

- No importarlos como operación vigente o inactiva.
- Mostrarlos en la vista previa como `Ignorados por catálogo`.
- Incluir sus conteos y motivos en el lote.
- Conservarlos únicamente en el archivo original guardado para auditoría.

---

## 3. Arquitectura requerida

### 3.1 Estrategia general

Crear un dominio y persistencia nuevos, aislados de Liverpool:

```text
src/
├── domain/
│   └── digital-operations/
├── modules/
│   ├── digital-import/
│   ├── digital-operations/
│   └── digital-dashboard/
├── services/
│   ├── digitalCatalog.ts
│   ├── digitalImportBatches.ts
│   ├── digitalPlacementRows.ts
│   ├── digitalOperationalItems.ts
│   ├── digitalOperationalTracking.ts
│   ├── digitalImportResolutions.ts
│   ├── digitalRevisions.ts
│   └── digitalReportExports.ts
```

Los nombres pueden ajustarse si existe una convención mejor, pero la separación conceptual y de persistencia es obligatoria.

### 3.2 Colecciones nuevas

Usar colecciones independientes:

- `digitalSupportCatalog`
- `digitalImportBatches`
- `digitalPlacementRows`
- `digitalOperationalItems`
- `digitalOperationalTracking`
- `digitalImportResolutions`
- `digitalPlacementRevisions`
- `digitalReportExports`

No reutilizar `ekonAssignments` porque su identidad, encabezados, tiendas, conciliación y fallback pertenecen al flujo “Datos Tienda”.

### 3.3 Archivo original

Guardar el `.xlsx` original en Firebase Storage con una ruta equivalente a:

```text
digital-imports/{batchId}/{sanitizedFileName}
```

El documento del lote debe guardar la ruta, nombre, tamaño y hash. El archivo debe ser inmutable desde el cliente después de completarse el lote.

---

## 4. Perfil y catálogo de soportes digitales

Crear un catálogo administrable por usuarios con permiso de administración.

### 4.1 Modelo mínimo

```ts
interface DigitalSupportProfile {
  id: string;
  retailerCode: string;
  retailerLabel: string;
  retailerAliases: string[];
  supportCode: string;
  supportLabel: string;
  articleAliases: string[];
  sourceSchema: 'ekon-campaign-tracking-v1';
  periodicity: 'fortnight';
  cmsName: string | null;
  trackingTemplate: 'external-cms-basic';
  fixationTypeMap: Record<string, 'fixation' | 'continuous'>;
  active: boolean;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}
```

### 4.2 Registros iniciales

Crear una inicialización idempotente o una interfaz para registrar:

1. `CHEDRAUI / COPETE DIGITAL`.
2. `LA COMER / COPETE DIGITAL`.

No inventar el nombre del CMS. Si `cmsName` está vacío, mostrar `CMS externo`; permitir que un administrador lo actualice después.

### 4.3 Administración

Permitir:

- Crear perfil.
- Editar alias y nombre del CMS.
- Activar/inactivar.
- Consultar autor y fecha de la última modificación.

No borrar físicamente perfiles ya referenciados por importaciones.

---

## 5. Esquema de entrada EKON

### 5.1 Hoja y detección

Buscar primero la hoja `Seguimiento Campañas` mediante comparación normalizada. Si no existe:

- Si solo hay una hoja y contiene los encabezados esperados, permitir usarla mostrando una advertencia.
- Si hay varias candidatas o no se reconocen los encabezados, bloquear y pedir corrección.

No asumir siempre la primera hoja, como hace el lector EKON actual.

### 5.2 Encabezados del archivo de referencia

El esquema contiene:

1. Comercial
2. Cliente
3. Anunciante
4. Producto
5. Cadena
6. Periodo Id
7. Periodo
8. Artículo
9. Nº Centros
10. Nº Soportes
11. Campaña
12. Línea campaña
13. Fecha Fijación
14. Fecha Retirada
15. Tipo Fijación
16. Observaciones Fijación
17. Observaciones Almacen
18. Contrato Enviado
19. Contrato Recibido
20. Produce ISM/Cliente
21. Creatividad Repartida
22. Escandallos Repartidos
23. Orden de Trabajo Generada
24. Creatividad Id
25. Creatividad Desc.
26. Creativitad Título
27. Creatividad Estado
28. Material
29. Total Unidades Material
30. Fecha Material
31. Proveedor
32. Número Pedido
33. Unidades Pedido
34. Fecha Pedido
35. Producción
36. Cantidades Enviadas
37. Número Albarán
38. Unidades Albarán
39. Fecha Albarán

El encabezado de origen contiene el typo `Creativitad Título`. Aceptar como alias tanto `Creativitad Título` como `Creatividad Título`, pero conservar el encabezado original para la exportación detallada.

### 5.3 Campos mínimos requeridos

Bloquear filas sin:

- Cadena
- Periodo Id
- Periodo
- Artículo
- Campaña
- Línea campaña
- Fecha Fijación
- Fecha Retirada
- Tipo Fijación
- Creatividad Id
- Nº Centros
- Nº Soportes

Los demás campos pueden estar vacíos, pero deben conservarse.

### 5.4 Normalización

- Fechas Excel seriales → fecha civil `AAAA-MM-DD`, sin desfase horario.
- Identificadores como campaña, línea y creatividad → texto, nunca número flotante.
- Conteos → número finito no negativo o `null` con incidencia.
- Texto → recortar extremos y colapsar espacios para comparación.
- Conservar el valor literal original en `sourceFields`.

### 5.5 Periodos

Interpretar formatos como:

```text
C17 - 11/08/2026 a 24/08/2026
```

Validar:

- El número del texto coincide con `Periodo Id`.
- Inicio ≤ fin.
- Las fechas son interpretables.
- El año puede derivarse del inicio del periodo.
- Un mismo `Periodo Id` no aparece con fechas incompatibles.

La UI debe mostrar los periodos detectados y exigir que el usuario confirme el alcance antes de importar.

---

## 6. Identidades y agregación

### 6.1 Fila detallada

Usar una clave estable equivalente a:

```text
año + campaña + línea campaña + retailer + soporte + creatividad id + periodo id
```

Esta clave conserva el detalle de cada línea EKON dentro de una catorcena.

### 6.2 Campaña lógica

Usar una huella de comparación equivalente a:

```text
año + campaña + retailer + soporte + creatividad id
```

No incluir línea ni periodo. Esto permite reconocer que una campaña continúa entre catorcenas aunque EKON cambie el número de línea.

### 6.3 Elemento operativo

Seguimiento y dashboards no deben mostrar una fila por cada línea EKON. Crear un elemento operativo agregado por:

```text
año + campaña + retailer + soporte + creatividad id + periodo id
```

Las líneas resueltas y aceptadas alimentan el elemento operativo. Para conteos:

- Eliminar solo los duplicados exactos que el usuario haya decidido colapsar.
- Sumar `Nº Centros` y `Nº Soportes` únicamente entre líneas distintas aceptadas.
- Nunca sumar dos filas pertenecientes a un conflicto no resuelto.
- Conservar los IDs de las filas fuente y la decisión aplicada.

Si un elemento contiene valores incompatibles de cliente, producto, fechas o clasificación, bloquear su agregación y enviarlo a resolución.

---

## 7. Modelos persistidos

### 7.1 Lote

```ts
type DigitalImportStatus =
  | 'analyzing'
  | 'pending-scope'
  | 'pending-resolutions'
  | 'processing'
  | 'completed'
  | 'failed';

interface DigitalImportBatch {
  id: string;
  sourceSchema: 'ekon-campaign-tracking-v1';
  fileName: string;
  storagePath: string;
  contentHash: string;
  status: DigitalImportStatus;
  detectedPeriods: Array<{
    periodId: string;
    startDate: string;
    endDate: string;
  }>;
  confirmedPeriodIds: string[];
  catalogProfileIds: string[];
  totals: {
    sourceRows: number;
    inScopeRows: number;
    ignoredByCatalog: number;
    validRows: number;
    rejectedRows: number;
    exactDuplicateGroups: number;
    logicalConflictGroups: number;
    operationalItems: number;
  };
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  completedAt: number | null;
  schemaVersion: number;
}
```

### 7.2 Fila normalizada

```ts
interface DigitalPlacementRow {
  id: string;
  recordKey: string;
  logicalFlightKey: string;
  batchId: string;
  sourceRow: number;
  year: string;
  retailerCode: string;
  supportCode: string;
  profileId: string;
  campaignNumber: string;
  lineNumber: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  fixationStart: string;
  fixationEnd: string;
  placementMode: 'fixation' | 'continuous';
  client: string;
  advertiser: string;
  product: string;
  creativityId: string;
  creativityTitle: string;
  creativityStatus: string;
  centers: number | null;
  supports: number | null;
  sourceFields: Record<string, string | number | boolean | null>;
  fingerprint: string;
  active: boolean;
  firstBatchId: string;
  lastBatchId: string;
  missingSinceBatchId: string | null;
  revision: number;
  updatedAt: number;
}
```

### 7.3 Elemento operativo

```ts
interface DigitalOperationalItem {
  id: string;
  operationalKey: string;
  logicalFlightKey: string;
  source: 'ekon-campaign-tracking';
  retailerCode: string;
  retailerLabel: string;
  supportCode: string;
  supportLabel: string;
  cmsName: string | null;
  campaignNumber: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  fixationStart: string;
  fixationEnd: string;
  placementMode: 'fixation' | 'continuous';
  client: string;
  advertiser: string;
  product: string;
  creativityId: string;
  creativityTitle: string;
  creativityStatus: string;
  centers: number;
  supports: number;
  placementRowIds: string[];
  active: boolean;
  firstBatchId: string;
  lastBatchId: string;
  updatedAt: number;
}
```

### 7.4 Seguimiento

```ts
type DigitalCheckKey =
  | 'downloadLink'
  | 'retailerValidation'
  | 'cmsProgramming';

interface DigitalOperationalTracking {
  id: string; // mismo id del DigitalOperationalItem
  operationalItemId: string;
  lifecycleStatus: 'active' | 'cancelled';
  cancellationReason: string | null;
  checks: Record<DigitalCheckKey, {
    completed: boolean;
    source: 'automatic' | 'manual';
    updatedAt: number;
    updatedByUid: string;
    updatedByEmail: string;
  }>;
  comments: Array<{
    id: string;
    text: string;
    createdAt: number;
    createdByUid: string;
    createdByEmail: string;
  }>;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}
```

La reimportación nunca debe sobrescribir checks, comentarios, cancelación ni motivo de cancelación.

---

## 8. Flujo de importación

Implementar estas fases visibles:

1. **Seleccionar archivo**.
2. **Detectar esquema y hoja**.
3. **Validar encabezados y fechas**.
4. **Aplicar catálogo** y mostrar filas dentro/fuera del alcance.
5. **Confirmar catorcenas**.
6. **Detectar duplicados exactos y conflictos lógicos**.
7. **Resolver conflictos**.
8. **Vista previa del diff**.
9. **Confirmar importación**.
10. **Guardar archivo, lote, filas, elementos operativos, revisiones y resoluciones**.
11. **Mostrar resumen final y acceso al seguimiento/Excel**.

La confirmación debe permanecer deshabilitada mientras exista:

- Encabezado requerido ausente.
- Periodo inconsistente.
- Valor `Tipo Fijación` desconocido.
- Duplicado/conflicto sin resolver.
- Campo mínimo inválido.
- Cero perfiles del catálogo aplicables.

### 8.1 Idempotencia

- Calcular hash del contenido normalizado.
- Mismo hash + mismo alcance + mismas resoluciones completadas → no duplicar.
- Si el archivo es idéntico, mostrar el lote previo.
- Un lote fallido debe ser reintentable.
- Escribir en lotes inferiores al límite de Firestore.

### 8.2 Diff y ausencias

Estados mínimos:

- Nueva.
- Sin cambios.
- Modificada.
- No incluida.
- Restaurada.
- Conflicto.

Una fila previa ausente solo puede marcarse `No incluida` si su periodo está dentro del alcance confirmado. Fuera de ese alcance debe permanecer intacta.

No borrar físicamente filas, elementos operativos, lotes, resoluciones o revisiones.

---

## 9. Interfaz de resolución de duplicados

Crear una tabla/panel con:

- Tipo de conflicto.
- Campaña.
- Retailer.
- Soporte.
- Periodo.
- Creatividad.
- Líneas y filas de origen.
- Campos diferentes resaltados.
- Acción propuesta.
- Acción elegida.

### 9.1 Acciones para duplicado exacto

- `Conservar una` — preseleccionada, pero requiere confirmación.
- `Conservar todas`.
- `Excluir todas`.
- `Cancelar importación`.

### 9.2 Acciones para conflicto lógico

- `Elegir fila principal`.
- `Conservar seleccionadas como separadas`.
- `Excluir seleccionadas`.
- `Cancelar importación`.

No implementar una acción de suma/consolidación automática.

### 9.3 Trazabilidad

Persistir:

- Firma del conflicto.
- Filas involucradas.
- Valores comparados.
- Acción.
- Filas aceptadas/excluidas.
- Usuario y fecha.
- Lote.

Si aparece el mismo conflicto en otro lote, mostrar la resolución anterior como sugerencia, pero exigir nueva confirmación.

---

## 10. Seguimiento operativo

### 10.1 Integración visual

La experiencia puede estar en la pantalla actual de seguimiento mediante un adaptador común, o en una sección/pestaña claramente integrada. En cualquiera de los casos:

- Liverpool continúa usando `campaigns` + `campaignOperationalTracking` y sus cinco checks.
- La Comer/Chedraui usan `digitalOperationalItems` + `digitalOperationalTracking` y solo tres checks.
- No copiar documentos nuevos dentro de colecciones Liverpool.

### 10.2 Columnas para La Comer/Chedraui

- Estado activa/cancelada.
- Retailer.
- Campaña EKON.
- Cliente.
- Anunciante.
- Producto.
- Soporte.
- Catorcena.
- Fecha de fijación.
- Fecha de retirada.
- Continua/Fijación.
- Creatividad ID/título/estado.
- Centros.
- Soportes.
- Link de descarga.
- Validación de cadena.
- Programación CMS.
- Comentarios.

No mostrar columnas de testigos.

### 10.3 Reglas de checks

- `Link de descarga`: puede derivarse automáticamente solo si existe una URL válida en el modelo; debe seguir siendo editable manualmente.
- `Validación de la cadena`: manual.
- `Programación CMS`: manual.
- El porcentaje de avance es checks completados / 3.
- Una cancelada muestra `No aplica`, no genera pendientes y queda fuera de los porcentajes operativos.
- Reactivar restaura los checks tal como estaban.
- Comentarios siguen disponibles en canceladas.

No inventar fechas límite para estos tres checks. Si no existe una regla confirmada, mostrar pendientes sin clasificación de vencimiento.

### 10.4 Filtros

- Fuente.
- Retailer.
- Soporte.
- Catorcena.
- Continua/Fijación.
- Estado activa/cancelada.
- Estado de avance.
- Cliente/anunciante.
- Búsqueda por campaña o creatividad.

---

## 11. Dashboards

### 11.1 Principio de no regresión

No cambiar las fórmulas, denominadores ni resultados actuales de los widgets Liverpool. Agregar secciones nuevas o un adaptador explícito; no mezclar silenciosamente elementos con esquemas de checks diferentes.

### 11.2 Sección multirretailer

Agregar una sección de operación Digital Signage con:

- Elementos operativos activos.
- Elementos cancelados.
- Avance promedio de los tres checks aplicables.
- Pendientes por check.
- Campañas distintas.
- Campañas por retailer.
- Campañas por soporte.
- Campañas por catorcena.
- Fijaciones vs continuidades.
- Total de centros reportados.
- Total de soportes reportados.
- Distribución por cliente/anunciante.

Todos los cálculos deben partir de `digitalOperationalItems` y `digitalOperationalTracking`.

### 11.3 Exclusiones del dashboard

Los nuevos datos no deben entrar en:

- Carga por tienda y soporte Liverpool.
- Matriz tienda/soporte.
- Pantallas físicas.
- Incidencias de catálogo Admira.
- Ratio 1 / Ratio 3.
- Métricas de testigos.

El archivo solo contiene conteos agregados; no inferir tiendas individuales.

---

## 12. Excel propio de catorcenas

Generar un `.xlsx` cliente-side usando el patrón/librería ya existente en el repositorio. Este exportador es independiente de los exportadores Liverpool.

### 12.1 Hoja `Resumen catorcena`

Una fila por elemento operativo:

- Retailer.
- Periodo ID.
- Catorcena.
- Inicio/fin de catorcena.
- Campaña EKON.
- Cliente.
- Anunciante.
- Producto.
- Soporte.
- Creatividad ID.
- Creatividad título.
- Creatividad estado.
- Fecha fijación.
- Fecha retirada.
- Continua/Fijación.
- Nº centros.
- Nº soportes.
- Número de líneas EKON.
- Estado operativo.
- Link.
- Validación cadena.
- Programación CMS.
- Avance.

### 12.2 Hoja `Detalle EKON`

- Conservar las 39 columnas originales y su orden.
- Agregar al final:
  - `Clasificación SIGNAM`.
  - `Retailer canónico`.
  - `Soporte canónico`.
  - `ID elemento operativo`.
  - `Fila origen`.
  - `Tratamiento duplicado`.
- Solo incluir filas aceptadas.

### 12.3 Hoja `Incidencias`

- Filas rechazadas.
- Filas ignoradas por catálogo.
- Duplicados exactos.
- Conflictos lógicos.
- Resolución aplicada.
- Campos desconocidos.
- Periodos inconsistentes.

### 12.4 Hoja `Metadatos`

- ID de lote.
- Archivo.
- Hash.
- Usuario importador.
- Fecha.
- Periodos confirmados.
- Perfiles de catálogo usados.
- Totales.
- Versión de esquema.

### 12.5 Formato

- Encabezados en negritas.
- Autofiltro.
- Fila superior congelada.
- Ajuste de texto.
- Fechas reales con formato `dd/mm/yyyy`.
- Identificadores como texto.
- Anchos legibles.
- Nombre seguro, por ejemplo:

```text
Operacion_Digital_C17-C18_2026.xlsx
```

No incluir imágenes. El archivo de origen no proporciona imágenes ni URLs recuperables.

Guardar un snapshot de metadatos del export, pero no mezclarlo con `csvExports`.

---

## 13. Permisos y seguridad

Agregar permisos explícitos, por ejemplo:

- `digitalOperations.read`
- `digitalOperations.import`
- `digitalOperations.track`
- `digitalOperations.export`
- `digitalCatalog.manage`

Propuesta:

| Acción | Admin | Operator | Viewer |
| --- | :---: | :---: | :---: |
| Leer operación | Sí | Sí | Sí |
| Importar | Sí | Sí | No |
| Resolver duplicados | Sí | Sí | No |
| Editar seguimiento | Sí | Sí | No |
| Exportar Excel | Sí | Sí | No |
| Administrar catálogo | Sí | No | No |

Actualizar tanto `src/app/permissions.ts` como `firestore.rules` y `storage.rules`.

Las reglas deben validar enums, tipos mínimos e inmutabilidad de campos de identidad y creación. Prohibir eliminación física desde el cliente.

---

## 14. Archivos actuales que no deben cambiar funcionalmente

Evitar modificar estos módulos salvo para pruebas de aislamiento o imports estrictamente necesarios:

- `src/modules/exports/pptExport.ts`
- `src/modules/exports/csvExport.ts`
- `src/modules/exports/campaignExcelExport.ts`
- `src/modules/exports/campaignReport.ts`
- `src/modules/consolidation/consolidate.ts`
- `src/modules/consolidation/ekonFallback.ts`
- `src/domain/csv.ts`
- `src/domain/consolidationKey.ts`
- `src/domain/ekon/fallbackCsv.ts`
- `src/services/campaigns.ts`
- `src/services/campaignEkonLinks.ts`
- `src/services/screens.ts`

Si es indispensable tocar alguno, documentar la razón y demostrar mediante pruebas que el resultado público no cambió.

---

## 15. Pruebas obligatorias

### 15.1 Parser

- Detecta `Seguimiento Campañas`.
- Acepta encabezados normalizados y el alias `Creativitad/Creatividad Título`.
- Convierte fechas seriales sin desfase.
- Conserva identificadores como texto.
- Rechaza campos mínimos faltantes.
- Valida `Periodo Id` contra el texto.

### 15.2 Catálogo

- Incluye exactamente La Comer/Chedraui + Copete Digital.
- Excluye `COPETE MUPI`.
- Excluye `STOPPER-MEDIA` aunque el título contenga Copete Digital.
- Respeta perfiles inactivos.

### 15.3 Clasificación

- `Fijación → fixation`.
- `Revisión → continuous`.
- Desconocido → incidencia bloqueante.

### 15.4 Duplicados

- Detecta duplicados exactos.
- Propone conservar uno, pero no resuelve sin confirmación.
- Detecta conflicto lógico con diferencias.
- Bloquea importación con conflictos pendientes.
- Nunca suma automáticamente.
- Guarda la resolución y el actor.

### 15.5 Idempotencia/diff

- Reimportar el mismo archivo y alcance no duplica.
- Cambios producen revisión.
- Ausencias dentro del alcance → No incluida.
- Fuera del alcance → intacta.
- Restauración conserva identidad.
- Checks y comentarios sobreviven a reimportaciones.

### 15.6 Seguimiento

- Nuevos elementos tienen exactamente tres checks.
- No aparecen checks de testigos.
- Avance usa denominador 3.
- Cancelar/reactivar conserva checks y comentarios.
- Liverpool conserva sus cinco checks y reglas actuales.

### 15.7 Dashboard

- Calcula métricas desde colecciones nuevas.
- No altera KPIs Liverpool existentes.
- No incluye datos nuevos en ocupación por tienda/pantalla.
- Canceladas quedan fuera del avance, según la regla operativa.

### 15.8 Exportación Excel

- Crea las cuatro hojas.
- Fechas, filtros, encabezados y tipos correctos.
- Detalle conserva las 39 columnas originales.
- Incidencias reflejan resoluciones.
- No contiene imágenes.

### 15.9 Aislamiento crítico

Crear pruebas de regresión que demuestren:

1. Importar La Comer/Chedraui no crea ni actualiza documentos en `campaigns`.
2. No crea ni actualiza `campaignEkonLinks`.
3. No crea consolidaciones.
4. No crea `csvExports`.
5. No modifica el catálogo `screens`.
6. Los resultados de `csvExport`, `campaignReport`, `campaignExcelExport` y `pptExport` para un fixture Liverpool son idénticos antes y después de introducir fixtures multirretailer.
7. Ninguna función de Admira recibe `DigitalOperationalItem` o `DigitalPlacementRow`.

Estas pruebas son condición obligatoria para aceptar el cambio.

---

## 16. Validación con el archivo de referencia

El análisis previo del archivo empresarial encontró:

- 1,986 filas de datos totales.
- 49 filas con retailer La Comer/Chedraui y artículo exactamente `COPETE DIGITAL`.
- 13 campañas distintas.
- Periodos C17 y C18.
- 21 filas `Fijación`.
- 28 filas `Revisión/Continua`.
- Un duplicado exacto en las filas Excel 176 y 177:
  - Chedraui.
  - C18.
  - Campaña 24498.
  - Línea 70.
  - Creatividad 62382.

Estos conteos sirven como smoke test local, no como constantes hardcodeadas ni como fixture empresarial versionado.

El importador debe mostrar el duplicado y exigir resolución. Si el usuario elige `Conservar una`, el detalle aceptado debe contener 48 filas para este archivo específico.

---

## 17. Navegación sugerida

Agregar en la sección `Datos`:

- `Operación Digital` o `Importación Digital`.
- `Catálogo de soportes digitales` para admin.

Agregar en `Operación` o dentro del seguimiento actual:

- Filtro/pestaña `Todos / Liverpool / La Comer / Chedraui`.

El dashboard debe conservar la sección Liverpool existente y añadir una sección multirretailer claramente separada.

---

## 18. Documentación y auditoría

Actualizar:

- `AGENTS.md`: añadir invariantes del nuevo dominio y el aislamiento Admira.
- `README.md`: documentar navegación, colecciones, permisos y flujo manual.
- `docs/CONTEXTO.md` si corresponde.
- Reglas e índices Firebase.

Agregar acciones auditables para:

- Importación digital completada/fallida.
- Resolución de duplicado/conflicto.
- Cambio de catálogo.
- Cancelación/reactivación.
- Exportación Excel.

No incluir el archivo empresarial ni credenciales en Git.

---

## 19. Orden de implementación recomendado

1. Dominio puro: modelos, encabezados, normalización, periodos, claves y parser.
2. Catálogo y filtros exactos.
3. Duplicados/resoluciones y diff.
4. Servicios Firestore/Storage y reglas.
5. Flujo UI de importación.
6. Agregación a elementos operativos.
7. Seguimiento de tres checks.
8. Dashboard multirretailer.
9. Excel de catorcenas.
10. Pruebas de aislamiento y regresión Liverpool.
11. Documentación.
12. Verificación completa y PR en borrador.

---

## 20. Criterios de aceptación

La implementación se considera terminada únicamente cuando:

- El archivo EKON puede analizarse, validarse e importarse con alcance confirmado.
- El usuario resuelve todos los duplicados/conflictos antes de guardar.
- El archivo original y el historial quedan preservados.
- La Comer y Chedraui aparecen en seguimiento con solo tres checks.
- No existe ningún campo, cálculo o alerta de testigos para estos retailers.
- Los dashboards multirretailer muestran los KPIs acordados.
- El Excel genera Resumen, Detalle, Incidencias y Metadatos.
- Los registros fuera del catálogo no se importan.
- La reimportación es idempotente y conserva seguimiento manual.
- Las pruebas demuestran que PPT, CSV/ZIP Admira, consolidación y campañas Liverpool permanecen sin cambios.
- Firestore/Storage rules cubren todas las colecciones/rutas nuevas.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build` pasan.
- El PR queda en borrador, sin merge ni despliegue.

---

## 21. Comandos de verificación

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
cd functions && npm run build
```

Si las Cloud Functions no cambian, verificar al menos que su build actual continúe pasando.

---

## 22. Entrega esperada de Codex

Al finalizar, reportar:

1. Rama y PR en borrador.
2. Archivos agregados/modificados.
3. Colecciones, reglas e índices nuevos.
4. Descripción del aislamiento Liverpool/Admira.
5. Resultados de todas las verificaciones.
6. Prueba manual sugerida con el archivo de referencia.
7. Cualquier decisión pendiente que no haya podido resolverse sin inventar una regla de negocio.

No hacer merge ni despliegue automático.
