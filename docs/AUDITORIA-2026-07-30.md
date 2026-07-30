# Auditoría técnica — 30 de julio de 2026

## Alcance

Se revisaron la arquitectura, invariantes de dominio, persistencia, reglas de
Firebase, tareas declaradas, dependencias, pruebas y procesos de compilación del
frontend y de Cloud Functions.

## Resultado ejecutivo

- Los 116 tests existentes, lint, typecheck, formato y ambos builds pasan.
- La lógica pura del frontend ya implementa importación, comparación de
  campañas, consolidación, CSV y reporte PDF; el apartado «Pendientes» del
  README quedó desactualizado.
- Las Cloud Functions de importación, consolidación y exportación siguen siendo
  módulos vacíos. La aplicación ejecuta hoy esas operaciones en el cliente.
- Firestore permite temporalmente que cualquier usuario autenticado opere las
  colecciones de trabajo. Es una decisión explícita para la etapa de pruebas y
  debe cerrarse con roles antes de liberar la aplicación al equipo.
- `npm audit` reporta 36 vulnerabilidades en el árbol raíz (3 críticas, 17 altas
  y 16 moderadas) y 8 moderadas en Functions. Su resolución exige migraciones
  mayores; `xlsx` no ofrece corrección en el registro npm audit. No se aplicaron
  upgrades mayores sin una validación específica de compatibilidad.

## Validación de tareas funcionales

| Tarea | Estado | Evidencia / observación |
| --- | --- | --- |
| Importar maestro Admira | Implementada en cliente | Detección de hoja, encabezados, filas y columna de mapeo. |
| Importar calendario Liverpool | Implementada en cliente | Lectura, análisis, comentarios y parseo de campañas. |
| Comparar versiones de campañas | Implementada en cliente | Altas, modificaciones y bajas con persistencia por lotes. |
| Consolidar por campaña + resolución | Implementada en cliente | Incluye exclusiones, incidencias e excepción Guadalajara. |
| Generar CSV y ZIP | Implementada en cliente | Layout Admira y serialización probados. |
| Generar reporte PDF | Implementada en cliente | Existe prueba automatizada del reporte. |
| Catálogo editable | Implementada en cliente | Alta, edición, activación, inactivación y borrado físico. |
| Cloud Functions operativas | Pendiente | Imports, consolidation y exports solo contienen scaffolding. |
| Auditoría automática | Pendiente | Existe el helper de servidor, pero no hay triggers/callables que lo invoquen. |
| Snapshot inmutable de exportación | Pendiente en backend | Las reglas protegen documentos creados, pero no existe Function que persista el flujo completo. |

## Hallazgos

### Riesgo aceptado durante pruebas — autorización de Firestore

Las reglas permitían leer y mutar casi todas las colecciones a cualquier cuenta
autenticada, incluyendo perfiles, catálogo y campañas, y permitían falsificar
eventos de auditoría. El equipo confirmó que esta apertura es intencional
mientras culminan las pruebas, por lo que la auditoría no modifica las reglas.
No debe interpretarse la matriz de permisos de la UI como una barrera de
seguridad durante esta fase.

Antes de liberar debe documentarse la decisión de cierre y activarse de forma
coordinada el control `admin` / `operator` / `viewer` en Firestore y Storage.
También debe reservarse la escritura de `auditEvents` para Admin SDK / Cloud
Functions. Aplicarlo anticipadamente impediría los flujos de prueba actuales.

### Alto — dependencias vulnerables

El árbol raíz contiene avisos que alcanzan herramientas de desarrollo y
dependencias de ejecución (`firebase`, `jspdf`, `react-router-dom`, `xlsx` y
dependencias transitivas de `exceljs`). Functions contiene avisos transitivos de
`firebase-admin`. Se recomienda una rama de migración con upgrades mayores,
pruebas de archivos XLSX/PDF reales anonimizados y un nuevo `npm audit`.

### Alto — backend incompleto

Las operaciones sensibles están implementadas en el navegador mientras los
módulos de Functions siguen pendientes. Esto limita auditoría confiable,
procesamiento reproducible y snapshots inmutables. Prioridad sugerida:

1. callable/trigger de importación con validación y evento de auditoría;
2. consolidación en servidor a partir de versiones persistidas;
3. exportación y almacenamiento inmutables desde Admin SDK;
4. pruebas con Firebase Emulator Suite para reglas y Functions.

### Medio — cobertura y reglas sin pruebas de emulador

La suite cubre bien la lógica pura, pero no prueba reglas de Firestore/Storage,
adaptadores reales de Firebase, cargas a Storage ni Functions. Deben añadirse
tests con `@firebase/rules-unit-testing` que verifiquen explícitamente cada rol,
la inmutabilidad de exportaciones y la prohibición de escribir auditoría.

### Medio — tamaño del bundle

Vite advierte chunks superiores a 500 kB; `exceljs`, `xlsx`, `jspdf` y el chunk
principal dominan la salida. Conviene cargar importadores y exportadores con
`import()` desde sus rutas para reducir el arranque inicial.

### Bajo — documentación desactualizada

El README describe varias funciones existentes como futuras y todavía llama a
la entrega «primera entrega». Debe actualizarse cuando se decida si el cliente
es una implementación provisional o si el backend reemplazará esos flujos.

## Plan recomendado

1. Mantener la apertura de Firestore solo en el entorno y periodo de pruebas;
   aplicar roles y pruebas de emulador antes de liberar al equipo.
2. Migrar dependencias críticas/altas en cambios pequeños y verificables.
3. Implementar Functions y conectar la UI sin cambiar el modelo CSV.
4. Habilitar cobertura mínima en CI y carga diferida de dependencias pesadas.
5. Actualizar README y cerrar los pendientes conforme haya backend desplegable.
