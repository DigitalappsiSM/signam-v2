# Análisis de incidencias Odoo · Digital Signage

Página `/analisis-incidencias-odoo`, navegación «Incidencias Odoo» en Operación.
Consulta real bajo demanda mediante Firebase `odoo-overview`, sin datos demo ni
escrituras sobre Odoo, campañas, catálogo o seguimiento. Reutiliza el cliente
JSON-2 y el secreto existente `ODOO_API_KEY`. La norma está en AGENTS.md.

## Validación de la fuente

Inspección de solo lectura del 30-sep-2026: equipos Liverpool, Chedraui,
La Comer y Farmacias San Pablo. Liverpool es el equipo 6. El agrupamiento por
etiquetas confirma uso de In-Situ y Remoto en Liverpool, además de Tipo: Soporte,
Tipo: Contenido, Contenido, SOPORTE, Cámara, Quividi y [camaras]. Hay variantes de
mayúsculas y tickets sin etiqueta. La descripción del portal contiene Tipo de
ticket, Tienda y Solicitante. Se observaron reaperturas con historial de cierre;
no deben contarse como tickets nuevos. Las modalidades solo acreditan etiquetas,
no una visita efectivamente realizada. No se publican datos personales aquí.

## Pantalla

Filtros combinables: mes de creación, retailer/equipo, tienda, categoría,
atención, solicitante, responsable y resultado SLA. Indicadores: total,
abiertos/resueltos, cumplimiento con denominador explícito, promedio de primera
respuesta y resolución con cantidad de observaciones. Distribución por categoría,
ranking de incidencias técnicas y detalle paginado con etiquetas y políticas SLA.
Datos faltantes y fallos de lectura tienen estados visibles.

La tienda histórica sin determinante queda sin identificar; no se adivina por
palabras del asunto. General no se considera automáticamente una avería técnica.
El selector de mes no filtra por fecha de cierre: tickets del mes pueden haberse
cerrado después. El SLA representa la lectura actual de Odoo, no una foto al
cierre histórico del mes. Un ticket puede tener varias etiquetas/políticas;
los totales cuentan IDs de tickets una sola vez.

## Despliegue y límites

La suite Vitest incluye la callable de Odoo y necesita las dependencias de ambos
paquetes. En un checkout limpio ejecutar `npm ci` y `npm ci --prefix functions`
antes de `npm run test`; el job de calidad de CI instala ambos paquetes. El job
de compilación de Cloud Functions se ejecuta aparte y no comparte dependencias.

1. Compilar frontend y functions. Desplegar `functions:odoo-overview` y Hosting.
2. Conservar el secreto ODOO_API_KEY ya instalado. El usuario Odoo de esa clave
   debe poder leer helpdesk.team, helpdesk.ticket, helpdesk.tag y
   helpdesk.sla.status. No ampliar sus permisos desde esta página.
3. La función descubre fields_get en ejecución para no asumir personalizaciones.
   Primera respuesta/resolución solo aparecen si existen first_response_hours /
   close_hours; ausentes se omiten. La validación por navegador confirma etiquetas
   pero no los permisos del usuario de API ni estos campos: hace falta la prueba
   en Firebase desplegado para certificar la integración completa.
4. Revisar que los estados de SLA devueltos sean reached/failed/ongoing y comparar
   una muestra con Odoo. No convertir errores de API o estados desconocidos en
   cumplimiento. Cancelada se omite de métricas; Resuelto/Cerrado/Solucionado son
   estados cerrados reconocidos. Estados personalizados distintos requieren mapeo.

Cada actualización consulta Odoo; no hay sincronización programada ni cache
persistente. Máximo 5,000 registros por modelo en una consulta. La clasificación
conservadora deja tickets legacy sin clasificar; se puede extender con un catálogo
aprobado de etiquetas técnicas sin modificar tickets originales. Queda pendiente
conciliar partners históricos por ID con catálogo para cubrir más tiendas.

## Informes visuales y Excel

El panel ejecutivo añade gráficas interactivas (tooltip) de volumen diario,
SLA por categoría, modalidades y horas medias por retailer, además de mediana,
P90, antigüedad de abiertos, calidad de datos y tablas por responsable/solicitante.
Los datos de cada gráfica también se ofrecen en tablas accesibles. En oscuro
se respeta el tema de SIGNAM. No se muestran promedios como cero si faltan datos.

La evolución usa fechas de creación: no cuenta todos los cierres de la operación
cuando pertenecen a tickets creados antes del mes. La antigüedad usa horas
naturales, independiente de horarios de SLA. Los responsables reflejan la
asignación actual, no productividad histórica atribuida a cada intervención.
El tamaño de muestra acompaña los tiempos promedio; el P90 es interpolado.

«Descargar informe Excel» produce un libro con Resumen, Tickets, Políticas SLA,
Retailers, Categorías, Atención, Responsables, Solicitantes, Tiendas técnicas,
Evolución diaria, Calidad y antigüedad y Metodología. Todas las hojas derivan de
los mismos tickets filtrados; los rankings de pantalla muestran 10 filas y el
Excel guarda todas. La descarga ocurre en el navegador, sin envío ni guardado
nuevo en Firestore. No se presenta como informe PDF ni como sincronización continua.

## Presentación y diagnóstico de conexión

Incidencias Odoo aparece al final de Operación. Los filtros usan controles
completos, con adaptación a móvil y tema oscuro. Las vistas Resumen ejecutivo,
Tiempos y equipos y Detalle de tickets comparten los filtros y la exportación.
La carga y los errores tienen panel propio; los indicadores pendientes muestran
un guion, nunca ceros ni datos de demostración. Un error permite reintentar.

Las lecturas heredan el idioma activo del usuario de API: no fuerzan `es_MX`,
que no está activo en la instalación revisada (solo Spanish / Español). La zona
horaria del periodo sigue siendo Ciudad de México y es independiente del idioma.
Los errores HTTP de Odoo se clasifican en credencial, permisos, idioma, consulta
rechazada o servicio no disponible. Solo se registran modelo, método, estado HTTP
y motivo controlado; nunca cuerpos, trazas, tickets ni claves. SIGNAM diferencia
una sesión expirada de una clave de integración rechazada. No se modifican los
permisos, claves ni preferencias de Odoo desde el dashboard.

Validación de producción: la función desplegada responde y exige sesión, y el
workflow de despliegue del PR 155 terminó correctamente. La lectura autenticada
fallaba antes de retirar el idioma forzado. Es obligatorio volver a probar la
consulta tras desplegar esta corrección; las pruebas con mocks no certifican
los permisos ni la vigencia de la API key real.

El workflow de producción ejecuta `scripts/check-odoo-connection.mjs` con el
secreto existente, después de compilar functions y antes de publicar. Utiliza
la misma lectura que el dashboard y el mes México actual. Una consulta fallida
bloquea ese despliegue (incluidos cambios ajenos a Odoo) hasta corregir la
integración; no marca como error un mes sin tickets ni la ausencia opcional de
SLA. Solo muestra número de tickets y avisos, nunca sus datos o el secreto.
Esta comprobación verifica Odoo y su credencial, pero no sustituye la validación
del login y de la callable desplegada desde SIGNAM.

## SLA de resolución y primera respuesta

Resolución es el indicador principal. Primera respuesta se conserva para seguimiento
al proveedor y SLA global mantiene el resultado combinado anterior. Una respuesta
incumplida y resolución cumplida se muestran como dos resultados distintos.
Los gráficos por categoría, tablas por responsable/solicitante, detalle y Excel
separan ambos tipos; el filtro de resultado permite elegir Resolución (inicial),
Primera respuesta o Global. Cada porcentaje incluye su propio denominador.

Las políticas se identifican por nombre explícito o etapa objetivo reconocida;
los nombres ambiguos y etapas desconocidas quedan sin identificar y se conservan
visibles en el detalle/Excel. Si no hay política reconocida se muestra Sin dato.
Se lee opcionalmente helpdesk.sla.stage_id; ante falta de acceso se advierte y
se conserva la clasificación por nombres. No se amplían permisos. No se deduce SLA
por horas ni se recalculan horarios, pausas por permisos o metas contractuales.
Se usan los estados actuales de Odoo, incluso en tickets reabiertos: un vencido
abierto entra como incumplido si Odoo así lo registra. Cancelados, en curso y sin
dato se excluyen del porcentaje de su tipo.
