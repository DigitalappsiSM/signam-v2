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
