# Distribución de Panel y Alertas de baja ocupación

Cambio de presentación basado en la propuesta revisada en temas claro y oscuro.
Se conservan los tokens corporativos actuales y el marco de navegación de la app.

## Panel

- Filtros con etiquetas visibles en una rejilla compacta, incluido el rango personalizado.
- Los cinco indicadores preceden a la salud operativa, ahora en una banda compacta.
- Carga diaria y mezcla por clasificación comparten una fila; atención inmediata y
  atención operativa comparten la siguiente.
- El detalle de carga conserva indicadores, gráficas, matriz y sus interacciones.
- Acciones rápidas se presentan debajo del detalle de carga. Operación Digital y
  las tarjetas de selección de módulos conservan su contenido.

## Alertas

- Cabecera, metadatos y semáforos más compactos, sin ocultar los metadatos largos.
- La lista de cada semáforo se despliega debajo de las tarjetas, sin deformarlas.
- La tabla conserva todas las columnas y tiene desplazamiento horizontal local
  accesible con teclado. El detalle del player se coloca a su lado cuando el
  contenido supera 1300 px; con menos espacio permanece debajo.
- Exportaciones: un grupo por fila, con Ratio 1, Ratio 3 y sin proveedores en
  columnas. Se conservan centros, pantallas, cambios, comparaciones y descargas.
- El reporte real de Admira y la planeación estimada siguen siendo independientes.

## Alcance técnico

Los estilos nuevos se limitan a los contenedores de estos dos módulos. No se
modifican AppLayout, rutas, logotipo, tokens globales, servicios, dominio,
permisos, persistencia, importadores, cálculos, umbrales ni exportadores. La
translucidez se aplica a filtros y tarjetas; las tablas mantienen un fondo sólido.
Las rejillas responden al ancho del contenido disponible mediante container queries.
Los controles conservan sus callbacks y el orden del DOM sigue el orden visual.

## Validación

- `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build`.
- Regresión de filtros/KPIs, importación/persistencia y CSV mediante la suite existente.
- Interacción del semáforo reubicado: abrir lista, seleccionar player, cerrar detalle
  y cerrar lista, comprobando que la consulta no escribe en persistencia.
