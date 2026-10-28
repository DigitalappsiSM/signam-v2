# Implementar los 9 KPI operativos de SIGNAM V2

Actúa como ingeniero senior responsable de SIGNAM V2. Implementa este alcance completo en el repositorio existente `https://github.com/DigitalappsiSM/signam-v2`. No te quedes en un diagnóstico, plan o maqueta. Estoy trabajando desde Windows con PowerShell.

## Objetivo y decisiones ya aprobadas

Implementar en Reporting una vista de gestión operativa con nueve KPI, gráficos y animaciones, integrada en el diseño actual de SIGNAM. La referencia aprobada es el archivo adjunto `REFERENCIA_VISUAL_SIGNAM.html`.

La prioridad es que mi equipo siga haciendo exactamente su captura habitual: marcar los checks actuales. NO agregues checks, formularios, campos obligatorios, confirmaciones ni pasos de trabajo. NO agregues una colección de eventos, una bitácora nueva ni un historial ilimitado para alimentar los KPI. Sí está autorizado corregir automáticamente la conservación de fechas y agregar los metadatos opcionales mínimos dentro del seguimiento existente para hacerlo bien.

Estos puntos están decididos; no vuelvas a preguntar si quiero más captura o un nuevo flujo. Resuelve las decisiones técnicas rutinarias. Si aparece una contradicción sustancial de negocio no cubierta aquí, explica el caso concreto antes de cambiar su significado.

## Preparación del trabajo

- Lee `AGENTS.md`, `CLAUDE.md`, README y las instrucciones aplicables del repositorio. Este documento fija las decisiones de negocio de esta funcionalidad.
- Revisa `git status`, la rama y el remoto. Verifica que `origin` corresponde a `DigitalappsiSM/signam-v2`. Conserva el trabajo local existente; usa una rama o worktree aislado si es necesario. No borres, resetees ni sobrescribas cambios ajenos.
- Usa comandos compatibles con PowerShell; no supongas que el entorno es Bash ni dependas de rutas Linux.
- Inspecciona el código vigente antes de editar. Los nombres de archivos de este documento son puntos de entrada, no permiso para ignorar cambios posteriores.
- Reutiliza React, TypeScript, Firebase y ECharts ya instalados. No crees otra aplicación, un HTML monolítico, un iframe de la maqueta ni otro menú lateral dentro de SIGNAM.

## Alcance de integración

La nueva vista vive dentro de `src/modules/reporting`, reutilizando los datos, permisos y patrones de navegación existentes. Puede ser una sección o pestaña de Gestión operativa que conserve las vistas actuales. Reutiliza el marco de la app y el componente de diálogo del panel.

Mantén intactos el Centro de Control/mapa actual, campañas, catálogo, importación y resolución Liverpool–Ekon, conciliación, Quividi, Odoo, consolidación y exportadores actuales de CSV/ZIP/PPT/PDF/Excel. Las únicas correcciones transversales autorizadas aquí son las de seguimiento/fechas y su interpretación de cumplimiento. No amplíes esta entrega a multirretailer: La Comer/Chedraui conservan su modelo independiente de tres checks y sus reportes actuales.

No confundas estos KPI de gestión con fill rate comercial o reproducción efectiva. No implementes esas otras métricas en esta entrega.

## Diseño visual aprobado

Abre e inspecciona `REFERENCIA_VISUAL_SIGNAM.html` antes de diseñar. Es una referencia visual funcional con cifras ficticias, no código de producción. El export puede contener el contenido dentro de un iframe/srcdoc: inspecciónalo si hace falta. No copies su runtime de exportación, dependencias CDN, datasets simulados ni navegación duplicada al producto.

Adapta la composición a los componentes y tokens reales actuales de SIGNAM:

1. Identidad azul in-Store Media, logo original, tipografías Inter/Space Grotesk, bordes y sombras suaves, tarjetas con jerarquía clara y temas claro/oscuro.
2. Dos tarjetas principales con medidores circulares: Campañas salidas en tiempo y Campañas perfectas. El resto de la pantalla debe tener gráficos, no una pared de nueve tarjetas iguales.
3. Comparativa semanal de ambos indicadores mediante barras agrupadas. Indica que Salidas usa semana de inicio y Perfectas usa semana de cierre. Tooltips con numerador, denominador y porcentaje.
4. Panel de Link antes del inicio, con porcentaje y desglose antes del inicio / el día de inicio o después / sin fecha verificable.
5. Gráfico horizontal de tiempos promedio: programación, T. Arranque, T. Completos y pases. Cada fila muestra su origen temporal, días y número de casos. La escala es de días, no una meta de servicio.
6. Cumplimiento de plazos con barras apiladas por obligación: a tiempo / completada tarde / vencida abierta. Mantén visibles los conteos y el porcentaje total.
7. Pendientes vencidos con obligaciones, campañas distintas afectadas, mayor atraso y distribución por antigüedad, como 1–3, 4–7 y 8+ días. Incluye prioridades y acceso al detalle.
8. Al pulsar un indicador, abrir un diálogo con las campañas u obligaciones reales que lo componen, fechas, resultado, origen del registro y motivo de exclusión si aplica. No ocultes denominadores ni problemas de datos.
9. El periodo y la selección de una semana actualizan medidores, contadores y gráficos de forma coordinada. Reutiliza los filtros que correspondan y mantén identificadas las diferentes cohortes.

Anima cambios de valores y geometría al cambiar filtros/semana, hover de tarjetas y apertura de diálogos. Evita parpadeos, bucles decorativos, contadores falsos de carga y movimiento continuo. Respeta `prefers-reduced-motion`, navegación por teclado, foco y Escape. Los números animados son presentación: nunca modifican los datos de cálculo ni generan nuevas lecturas/escrituras.

Haz el diseño responsive y comprueba que etiquetas, valores y tooltips no se corten en escritorio ni móvil. Mantén los colores consistentes por serie/estado. No inventes metas porcentuales ni un semáforo verde/rojo según umbrales arbitrarios.

## Universo, fechas y calidad

- Unidad de campaña: `campaign.id` estable. No agrupar por nombre ni mezclar flights homónimos. No contar campaña × tienda como campañas distintas.
- Reutiliza las resoluciones vigentes de soportes/tiendas y vínculos Ekon. No recrees un universo paralelo.
- Conserva el régimen de estados del dominio: pausadas, canceladas, duplicadas y retiradas fuera de los KPI aplicables, con conteos/estados separados donde corresponda. No borres datos. No asumas clasificación Proveedor cuando falta.
- Institucional: Link, Validación y Programación aplican. Testigos y pases son No aplica. Proveedor, incluido Sampling: los seis checks aplican.
- Zona para analítica: `America/Mexico_City`. Las fechas de campaña son civiles; los timestamps de checks se convierten a esa zona antes de compararlos con inicio/fin/vencimiento. Evita resultados diferentes por la zona del navegador o por fechas ISO interpretadas como UTC.
- Fechas inválidas o ausentes, registros incompatibles y ausencia de observaciones no son cero. Mostrar Sin dato, Sin casos o Requiere revisión según corresponda. Cero por ciento solo cuando existe un denominador válido y ningún cumplimiento.
- Identifica registros automáticos, manuales, masivos, derivados y legacy hasta donde la evidencia realmente lo permita. No inventes la procedencia histórica.
- La fecha del check acredita registro en SIGNAM. El link no acredita recepción completa ni el check de pases acredita reproducción efectiva. No llames a estos promedios tiempo de atención humana ni prueba de envío al cliente.
- En porcentajes muestra numerador, denominador y excluidos. En tiempos: promedio, casos válidos, mediana y P90, al menos en el detalle. Calcula percentiles desde observaciones individuales, nunca desde promedios semanales.
- Las campañas futuras no entran anticipadamente en la evaluación de arranque. Las obligaciones cuyo día límite aún no ha terminado no se cuentan como vencidas.

## Definición exacta de los nueve KPI

### 1. Campañas salidas en tiempo

Sustituye al anterior concepto de Preparación al inicio; NO son dos KPI distintos.

Una campaña cumple si TODOS estos checks quedaron completos antes del día de inicio: `linkDownload`, `liverpoolValidation` y `csmProgramming` (el check actual de programación CSM/CMS).

Es una condición AND por campaña. El mismo día de inicio ya NO cuenta como antes. No basta un check, un promedio de avance ni tener hoy la programación marcada.

Porcentaje = campañas que cumplen los tres / campañas iniciadas evaluables del periodo × 100. Mostrar también fuera de tiempo y no verificables. Usa fechas conservadas que acrediten el cumplimiento; no conviertas un cierre tardío en arranque puntual. Si hay evidencia de incumplimiento, clasifica fuera de tiempo; si la historia es ambigua sin datos suficientes, clasifica no verificable.

### 2. Campañas perfectas

Una campaña es perfecta cuando tiene TODOS sus checks APLICABLES completos. Si falta uno, no cuenta. No es el promedio de seis casillas. Los No aplica no penalizan ni se presentan como entregas efectivamente realizadas.

Perfecta significa completitud, NO cumplimiento de todos los plazos: una campaña puede ser perfecta y haber cerrado algún check tarde. La puntualidad se mide aparte.

Para el porcentaje de cierre, usa campañas cuya fecha fin cae en el periodo y cuya ventana operativa ya agotó al corte. En Proveedor, la ventana vence en el máximo de los plazos aplicables de arranque, completos y pases, no necesariamente solo fin + 4; en Institucional no inventes una gracia de testigos que no aplica. Separa las finalizadas aún dentro de plazo y las campañas en curso. Evalúa siempre la misma cohorte, incluso cuando algunas completaron anticipadamente, para no sesgar el porcentaje.

Porcentaje = campañas perfectas / campañas finalizadas evaluables con ventana agotada × 100. Este indicador depende del estado de los checks; una fecha ausente no vuelve incompleto un check que está completo, aunque limite su evaluación temporal.

### 3. Tiempo hasta programación

Para campañas con Programación completada en el periodo y dos fechas utilizables: timestamp de Programación menos timestamp de Validación, dividido entre 86,400,000 para mostrar días transcurridos.

Excluir pares sin fecha, invertidos o de origen masivo/derivado no verificable. Identificar la validación automática como registro automático: no asumir que representa una revisión humana. Los datos existentes válidos pueden servir como referencia de registro, con su calidad visible.

### 4. Link antes del inicio

Campañas con registro/detección verificable del link antes del día de inicio / campañas iniciadas evaluables × 100. Separar antes del inicio, el día de inicio o después y sin fecha. No llamarlo recepción completa de contenido.

### 5. Tiempo hasta T. Arranque

Para checks completados en el periodo: diferencia en días civiles de México entre inicio de campaña y fecha del registro válido de T. Arranque. Promediar las observaciones, manteniendo casos y calidad. Un registro automático derivado de T. Completos no prueba una entrega individual de arranque.

### 6. Tiempo hasta T. Completos

Para checks completados en el periodo: días civiles entre fin de campaña y fecha del registro válido de T. Completos. No calcularlo desde inicio. Identificar registros anteriores al fin como anticipados/a revisión y separarlos del promedio postcierre; no convertirlos silenciosamente en cero.

### 7. Tiempo hasta Evidencia de pases

Para checks completados en el periodo: días civiles entre inicio de campaña y registro válido de `passesEvidence`. No sustituirlo por la fecha de importación del diagnóstico de pases Admira.

### 8. Cumplimiento de plazos

Aplicar a T. Arranque, T. Completos y Evidencia de pases, únicamente donde correspondan. Cohorte: obligaciones cuyo vencimiento cae en el periodo seleccionado y cuyo día límite ya terminó al corte.

Cumplimiento = a tiempo / (a tiempo + completadas tarde + pendientes vencidas) × 100.

Incluir las vencidas abiertas en el denominador. Separar No aplica, futuras y completadas sin fecha verificable. Mostrar total y desglose por obligación; una campaña puede aportar tres obligaciones, por lo que este conteo no equivale a campañas.

Preservar los plazos actuales del dominio:
- T. Arranque: quinto día hábil inclusivo desde inicio, excluyendo sábados y domingos; no agregar festivos en esta entrega.
- T. Completos: fin + 4 días naturales, último día todavía a tiempo.
- Evidencia de pases: inicio + 5 días naturales, último día todavía a tiempo.

No usar simplemente fechaFin para todas las obligaciones ni penalizar pendientes durante el día de su vencimiento.

### 9. Pendientes vencidos

Foto al corte de todas las obligaciones aplicables abiertas fuera de plazo: cantidad de obligaciones, campañas distintas, días de atraso, máximo y bandas de antigüedad. Incluir arrastres previos al periodo; cambiar de semana NO debe ocultarlos. Etiquetarlo como corte general, conservando los filtros estructurales aplicables.

Usar fechas civiles para antigüedad. Ordenar el detalle por mayor atraso y permitir abrir el seguimiento de la campaña por su ID.

## Agregaciones y gráficos

La comparativa semanal de Salidas usa la cohorte de inicio; la de Perfectas usa la de fin con ventana agotada. Los tiempos usan fecha de completado y SLA usa fecha de vencimiento. Haz esta diferencia visible en etiquetas/ayuda.

El total del mes se calcula sumando numeradores/denominadores o con observaciones individuales, nunca promediando porcentajes o promedios semanales sin ponderación. Los gráficos, KPI y detalles deben salir del mismo modelo y filtros.

Los cortes semanales muestran resultados de esas cohortes al corte actual, no una supuesta foto histórica inmutable. No introduzcas snapshots ni nuevas colecciones para simular una auditoría histórica que no tenemos.

## Correcciones de fechas autorizadas: sin carga para el equipo

Inspecciona `OperationalCheck`, `makeCheck`, `applyCheckChange`, `markAllComplete`, servicios y reglas Firestore. Diseña la ampliación opcional mínima y compatible del documento de seguimiento; explica el esquema adoptado en la documentación.

1. Marcar una casilla ya completa debe ser idempotente para su fecha de cumplimiento.
2. Marcar todas conserva fechas y procedencias ya existentes de checks completos. Solo completa pendientes aplicables. Lo completado en bloque se identifica como masivo y no se interpreta automáticamente como fechas individuales reales para los KPI de tiempo/puntualidad.
3. Al desmarcar, conservar automáticamente la referencia del cumplimiento anterior, aunque `completedAt` deba seguir siendo null en el estado abierto por compatibilidad. Al volver a marcar, registrar el nuevo cierre sin perder la referencia anterior. No dejar un check abierto computando como completado.
4. Conservar la regla T. Completos implica T. Arranque y la prohibición de desmarcar Arranque mientras Completos esté marcado. Si se arrastra Arranque, identificarlo como derivado; no presentarlo como entrega de arranque registrada individualmente. Si Arranque ya tenía fecha propia, no sobrescribirla.
5. Un check completo sin fecha no equivale a completado a tiempo. Corrige esa interpretación conservando compatibilidad y estados No aplica.
6. La fecha de alta/importación no equivale a recepción o aprobación real. No inicializar retrospectivamente fechas perdidas con ahora.
7. Los documentos legacy se leen sin migración destructiva. Si no se puede acreditar una secuencia histórica por reaperturas o cambios de vigencia, mostrar la limitación/no verificable en vez de reconstruirla con suposiciones. Guardar unas pocas marcas no equivale a disponer de un historial completo.

No agregues una colección de eventos, arrays crecientes ni campos que deba llenar el operador. No ejecutes un backfill masivo en producción para fabricar fechas. Mantén transacciones, permisos y validaciones coherentes; si necesitas nuevos metadatos opcionales en el check, actualiza tipos, normalización y reglas de forma compatible.

## Puntos de entrada del código

- `src/modules/operational-tracking/types.ts`
- `src/modules/operational-tracking/trackingFactory.ts`
- `src/modules/operational-tracking/trackingModel.ts`
- `src/modules/operational-tracking/operationalStatus.ts`
- `src/modules/operational-tracking/businessDays.ts`
- `src/services/campaignOperationalTracking.ts`
- `src/modules/reporting/reportingModel.ts`, `ReportingPage.tsx` y CSS
- `src/modules/dashboard/DashboardPage.css`, `DashboardLayout.css`
- `src/modules/dashboard/controlCenter/GlassDialog.tsx`
- `src/components/layout/AppLayout.*`, `src/components/BrandLogo.tsx`
- `src/styles/global.css`, `firestore.rules`, pruebas de seguimiento/reglas y documentación.

Separa cálculo puro, lectura/persistencia y presentación. Evita consultas N+1, llamadas por animación y descargas adicionales de Quividi/Odoo/Admira para esta vista. Usa los datos ya necesarios del seguimiento y campañas; no acortes la carga de forma que desaparezca el backlog histórico.

## Pruebas y criterios de aceptación

Implementa pruebas con comportamiento real, al menos para:
- AND de los tres checks antes del inicio; mismo día no cumple; faltantes/no verificables separados.
- Perfectas exige todos los aplicables y no añade puntualidad. Una Proveedor con seis checks y uno tardío sí es perfecta. Institucional no exige testigos/pases.
- Ventana agotada, finalizadas aún en plazo, campañas futuras y estados excluidos.
- Idempotencia, Marcar todas, desmarcar/remarcar, cascada de testigos, procedencia y documentos legacy sin fechas.
- Vencimientos inclusivos, fines de semana, cambios de mes/año y timestamps cerca de medianoche de México.
- SLA con vencidas abiertas en denominador; cero denominador, fechas inválidas y No aplica.
- Totales ponderados; media/mediana/P90 desde casos; filtros y gráfica/detalle consistentes.
- Pendientes antiguos visibles al seleccionar una semana reciente.
- Temas claro/oscuro, reduced motion, teclado, foco y cierre de diálogos; responsive sin recortes.

Ejecuta los checks exigidos por el repo: lint, typecheck, test y build; si cambias validaciones Firestore, también las pruebas de reglas correspondientes. En PowerShell ejecuta cada comando por separado y verifica su código de salida. Si tocas Functions, ejecuta también su validación específica. No afirmes que una comprobación pasó si no se ejecutó.

Realiza QA visual en navegador con datos reales o fixtures exclusivos de pruebas: escritorio y móvil, temas claro/oscuro, periodos sin casos y calidad incompleta. No dejes datos ficticios, valores fijos de octubre de 2026 ni fallbacks con números aparentando resultados reales en la vista productiva.

Documenta fórmulas, cohortes, limitaciones de fechas, esquema opcional y comportamiento nuevo en los documentos autoritativos requeridos por el repo, incluido su control de frescura si aplica. Prepara un commit claro y PR con problema, comportamiento final, validaciones y limitaciones; no hagas merge ni despliegue como parte de este encargo.

## Entrega

Al terminar, entrega: resumen de implementación, archivos principales, esquema compatible elegido, pruebas ejecutadas con resultado, evidencia visual/limitaciones reales y enlace a la rama/PR si hay acceso. La pantalla debe ser funcional con datos del sistema, no una reproducción estática del HTML.

Empieza inspeccionando el repositorio y la referencia adjunta y continúa hasta dejar la implementación y sus verificaciones completas.
