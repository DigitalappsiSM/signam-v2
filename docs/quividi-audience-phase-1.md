# Quividi en SIGNAM — Fase 1

## Objetivo

Añadir un informe de audiencia Quividi directamente desde cada campaña de SIGNAM, sin crear un módulo nuevo. La unidad de cruce es siempre **Tienda + Soporte**, nunca solo tienda.

## Flujo

1. En **Campañas**, el icono 📊 aparece al final de la fila.
2. Si no existe cobertura Quividi para ninguna combinación Tienda + Soporte de la campaña, el botón queda deshabilitado y explica el motivo.
3. Al solicitar el informe, una Cloud Function lee campaña y catálogo Admira, resuelve IDs con Topology, consulta OTS/viewers/demografía, guarda un snapshot y devuelve los datos normalizados.
4. El frontend genera el Excel Quividi.

## Fuente única de verdad

Los 12 campos oficiales del maestro Admira permanecen intactos. SIGNAM guarda la relación con Quividi dentro de metadata:

- `metadata.calendarSupport`
- `metadata.quividiCameraName`

El importador reconoce `CAMARA QUIVIDI` / `CÁMARA QUIVIDI` como columna opcional y no la marca como extra.

El nombre de cámara sirve para reconciliar el catálogo con Topology; el identificador técnico usado por el reporte es el `locationId` obtenido de VidiCenter.

## Seguridad

Las credenciales Quividi nunca deben estar en Git, `.env` del frontend ni código cliente. La Function usa Firebase Secret Manager:

```bash
firebase use signam-v2-prod
firebase functions:secrets:set QUIVIDI_API_USERNAME
firebase functions:secrets:set QUIVIDI_API_TOKEN
```

## Reglas de cobertura

Para cada soporte de campaña se evalúan únicamente sus tiendas aplicables. Ejemplo: Satélite + MUPIS puede tener cobertura, mientras Satélite + CRIUS puede no tenerla.

## Regla de varias cámaras

Cuando un mismo Tienda + Soporte tiene varias cámaras que pueden observar tráfico solapado, SIGNAM no suma las cámaras. La ponderación se hace **por día**:

```text
valor ponderado del día = suma de valores de cámaras válidas / número de cámaras válidas ese día
```

Esto aplica a OTS, Effective OTS, Watchers y buckets demográficos.

### Caída parcial

Si un soporte tiene dos cámaras y una deja de reportar uno o varios días:

- se usa la cámara que sí tiene dato;
- el día queda marcado como `partial`;
- el Excel notifica la cámara afectada y el rango de fechas;
- no se extrapolan ni se inventan datos.

### Caída total

Si ninguna cámara del soporte tiene datos para un día:

- el día queda `missing`;
- no se convierte en cero audiencia;
- se refleja como pérdida de cobertura de medición.

### Una sola cámara

Una única cámara configurada representa el soporte completo. No se divide ni se pondera contra el número de pantallas físicas.

## Métricas

El Excel inicial contiene OTS, Effective OTS, Watchers, Watchers/OTS, Attention Time, Dwell Time, edad, género, Edad × Género, cobertura Quividi, cobertura de medición e incidencias de cámara.

Attention Time y Dwell Time se ponderan por Watchers.

## Definiciones simples usadas en el Excel

| Indicador | Explicación |
| --- | --- |
| OTS | Personas que tuvieron la oportunidad de estar expuestas al soporte. |
| Effective OTS | Personas que, por su posición o recorrido, realmente pudieron ver la pantalla. |
| Watchers | Personas que dirigieron la mirada hacia la pantalla. |
| Tasa de atención | De las personas expuestas, qué porcentaje miró la pantalla. |
| Attention Time | Tiempo promedio que las personas estuvieron mirando la pantalla. |
| Dwell Time | Tiempo promedio que las personas permanecieron frente o cerca del soporte. |
| Cobertura Quividi | Qué parte de los soportes de la campaña cuenta con medición de audiencia. |
| Cobertura de medición | Qué parte del periodo de campaña tuvo datos válidos disponibles. |
| Edad | Distribución estimada de la audiencia por grupos de edad. |
| Género | Distribución estimada de la audiencia detectada por género. |

Los datos demográficos son estimaciones estadísticas y no identifican personas.

## Hojas del Excel

- `Dashboard`
- `Soportes`
- `Cámaras`
- `Demografía`
- `Calidad de medición`
- `Metodología`

## API utilizada

Base: `https://vidicenter.quividi.com/api/v1`

- `/locations/` para reconciliación de Topology.
- `/data/?data_type=ots&time_resolution=1d` para OTS, Effective OTS y duración.
- `/data/?data_type=viewers&time_resolution=1d` para Watchers y tiempos.
- `/data/?data_type=viewers&time_resolution=1d&group_by_demographics=1` para edad y género.

Los exports de `/data/` son asíncronos. La Function respeta `started`, `in_progress`, `finished` y `failed` y usa backoff entre consultas.

## Evolución prevista

Fase 2 reutilizará el mismo normalizador y los snapshots como base para **Inteligencia de Audiencia** e histórico por tienda/soporte. Fase 3 añadirá forecast comercial.
