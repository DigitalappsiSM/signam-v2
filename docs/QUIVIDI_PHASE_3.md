# Quividi — Fase 3: Inteligencia Comercial

> Reglas transversales autoritativas: `AGENTS.md`. Este documento complementa
> `docs/QUIVIDI_PHASE_1.md` (reporte por campaña) y `docs/QUIVIDI_PHASE_2.md`
> (histórico integral + salud de cámaras). Ninguna de las dos fases anteriores
> se modifica aquí.

## 1. Objetivo

Inteligencia Comercial es una **capa comercial derivada**, separada de Fase 1
y Fase 2, construida exclusivamente a partir de lo que esas dos fases ya
guardaron (`quividiHistoryPartitions`, `quividiHistoryBindings`). Nunca llama
a VidiCenter de nuevo y nunca modifica el crudo ni los snapshots por campaña.
Cubre:

1. Una regla de duplicación comercial para soportes con video que comparten un
   solo flujo entre dos pantallas físicas.
2. Un visor de auditoría de consistencia entre crudo, capa comercial y Fase 1.
3. Un catálogo de reportes estándar + un builder libre (sub-fase 3b).
4. Un agente de descubrimiento de fechas de alto tráfico (sub-fase 3c).
5. Un agente LLM de propuestas comerciales a demanda (sub-fase 3d).

Este documento se escribe junto con la **sub-fase 3a** (duplicación + rollup +
auditoría); las secciones 3b–3d describen el diseño acordado y se actualizan
cuando se implementen.

## 2. Combinación/duplicación multi-cámara: reusa `cameraCombination.ts`

**Esta capa no define su propia regla de duplicación.** Reusa exactamente
`combineCameraValues` / `isZoneSplitPair` / `publishedValue` de
`functions/src/quividi/cameraCombination.ts` — la misma que ya aplica en Fase
1 (`measurement.ts`/`hourly.ts`) al reporte por campaña. Esto es deliberado:
una versión propia de esta regla en Inteligencia Comercial podría divergir de
la cifra que la marca ya ve en el PDF/Excel de Fase 1, y sería exactamente el
tipo de documentación-vs-código que `scripts/check-docs-freshness.mjs` existe
para prevenir.

La regla real (documentada en detalle en `AGENTS.md`, sección «Multi-cámara»
e «Duplicación de la cifra»):

1. **Zona partida → suma siempre**: Insurgentes (dos cámaras en pisos
   distintos) y cualquier soporte `BANNER DIGITAL` (dos caras a lados
   distintos del hueco central) — su oportunidad de ver es genuinamente el
   doble, no una redundancia de la misma pantalla.
2. **Cualquier otro caso → la lectura más alta** entre los puntos medidos, para
   OTS, Effective OTS y Watchers (ya no promedio).
3. **Cifra publicada (de cara a marca)**: duplica (×2) el valor combinado
   cuando el par tiene **1 punto configurado**, o **2 fuera de zona partida**
   — nunca con 3+ puntos ni en zona partida (que ya suma sus 2 audiencias). Se
   basa en cuántos puntos tiene **asignados** el catálogo, no en cuántos
   reportaron ese día.
4. Attention Time y Dwell Time **nunca se duplican**: son promedios por
   watcher, no conteos. Salen de la misma cámara de referencia que watchers
   (la de **más watchers** fuera de zona partida; ponderado de todas en zona
   partida), con el mismo helper que Fase 1 (`combineCameraAverageSeconds`).

Esta capa **no toca** `quividiHistoryPartitions` (crudo) ni el reporte por
campaña de Fase 1 (`campaignAudienceSnapshots`); solo produce su propio rollup
derivado (`quividiCommercialDaily`) aplicando la misma función compartida.

Lógica pura: `functions/src/quividi/commercial/commercialRollup.ts`
(`buildCommercialDailyRow`, que importa `cameraCombination.ts` directamente),
con pruebas de caracterización en `commercialRollup.test.ts`.

## 3. Colecciones

Todas backend-only, sin regla explícita en `firestore.rules` (mismo criterio
que `campaignAudienceSnapshots`: caen en el cierre por defecto).

### `quividiCommercialDaily/{date}__{storeNumber}__{support}`

Rollup comercial diario. Construido desde `quividiHistoryBindings` (puntos
configurados vigentes en la fecha) y `quividiHistoryPartitions` (exports
`ots`/`1h` y `viewers`/`1h` que Fase 2 ya ingiere; ninguna familia nueva).

Campos: `date`, `storeNumber`, `storeName`, `support`, `configuredCameras`,
`measuredCameras`, `status` (`measured`/`partial`/`missing`), `zoneSplit`,
`ots`/`effectiveOts`/`watchers` (combinados, crudos), `publishedOts`/
`publishedEffectiveOts`/`publishedWatchers` (cifra de cara a marca, duplicada
donde aplica), `attentionSeconds`, `dwellSeconds`, `pointIdsUsed`,
`locationIdsUsed` (trazabilidad para la auditoría — nunca es lo que se le
muestra al usuario como identidad principal, que siempre es Tienda+Soporte).
Mismo shape conceptual que `SupportDay` de Fase 1.

### `quividiCommercialKnownDates/{id}` _(sub-fase 3c, pendiente)_

Calendario comercial externo cargado manualmente (Buen Fin, Hot Sale, Venta
Nocturna, quincenas…): `name`, `startDate`, `endDate`, `recurrence?`, `notes`.

### `quividiCommercialHighTrafficDates/{date}` _(sub-fase 3c, pendiente)_

Fechas candidatas/confirmadas de alto tráfico: `origin`
(`agent`/`manual`), `status` (`pending`/`confirmed`/`rejected`), `reason`,
`confirmedBy*`. Vive conceptualmente dentro de `/historial-quividi`, con el
mismo permiso `quividi.history` (hoy exclusivo de `admin`).

### `quividiCommercialProposals/{id}` _(sub-fase 3d, pendiente)_

Propuesta comercial final: inputs (rango, tiendas/soportes, contexto de
marca), narrativa generada por el agente LLM, cifras citadas (snapshot
reproducible), `status` (`draft`/`confirmed`), `confirmedBy*`. El PDF final
**no se guarda como archivo en Storage** — ver §6.

## 4. Callables

### `quividi-commercialRollupBuild`

Callable de backfill/soporte manual. Reservado a `admin`/`operator` (`viewer`
observa, no recalcula — mismo criterio que `QUIVIDI_HEALTH_REFRESH_ROLES`).
No llama a VidiCenter: solo relee `quividiHistoryPartitions`/`Bindings` ya
ingeridos. Idempotente por `date__storeNumber__support`.

### `quividi-commercialRollupDaily` (scheduled)

Reconstruye el rollup del último día completo cada madrugada (08:30
America/Mexico_City), igual patrón que el resto de Fase 2/Salud de cámaras.

### `quividi-commercialAudit`

Callable de solo lectura, gated por `quividi.commercial` (los cuatro roles).
Dado Tienda+Soporte+rango de fechas (+ `campaignId` opcional), devuelve por
día: el crudo (por punto, sumando las horas ya guardadas), el rollup
comercial ya persistido, la cifra de Fase 1 si la campaña indicada tiene
snapshot vigente, y una bandera `consistency` (`ok`/`mismatch`/`no-data`)
que recombina el crudo medido con la **misma** `combineCameraValues` del
rollup y lo compara contra lo persistido — una discrepancia señala que el
rollup del día está desalineado (p. ej. datos tardíos de Fase 2 que aún no
dispararon `quividi-commercialRollupBuild`), nunca dispara una corrección
automática.

- **Rango acotado**: fechas de calendario reales, fin ≥ inicio y como máximo
  `MAX_AUDIT_DAYS` (93) días; fuera de eso responde `invalid-argument`.
- **Snapshot vigente** significa lo mismo que en el reporte por campaña:
  `schemaVersion === SNAPSHOT_SCHEMA_VERSION` (8), `inputSignature` igual a
  la de la campaña y alcance actuales, y `snapshotIsFresh` con el corte
  actual. Si cualquiera falla, la columna Fase 1 sale vacía en vez de mostrar
  una cifra que Fase 1 rechazaría.
- El cliente rotula los puntos por su `pointId` de catálogo o, si no lo
  tiene, «Punto N»; nunca por Location ID.

## 5. Permisos

| Capacidad | admin | operator | viewer | commercial |
|---|---|---|---|---|
| `quividi.commercial` (ver reportes/auditoría) | ✅ | ✅ | ✅ | ✅ |
| `quividi.commercial.generate` (confirmar/generar propuesta final) | ✅ | ✅ | ❌ | ✅ |

`viewer` observa, no dispara acciones mutantes — mismo criterio usado en Salud
de Cámaras (`QUIVIDI_HEALTH_REFRESH_ROLES`). Espejo en backend:
`functions/src/quividi/access.ts` (`QUIVIDI_COMMERCIAL_ROLES`,
`QUIVIDI_COMMERCIAL_GENERATE_ROLES`). La ruta `/inteligencia-comercial` se
agregó a `COMMERCIAL_ROUTE_PATHS` en `src/app/routes.ts`: el rol `commercial`
tiene navegación cerrada y necesita esa entrada explícita además del permiso.

## 6. Decisiones de alcance

- **Fase 1 no se toca y no se duplica su regla.** Inteligencia Comercial
  **reusa** `cameraCombination.ts` en vez de definir su propia versión de la
  combinación/duplicación multi-cámara — ver §2. El PDF/Excel por campaña de
  Fase 1 sigue generándose exactamente igual, sin que este rollup lo afecte.
- **El PDF de propuestas (sub-fase 3d) no se guarda en Storage.**
  `storage.rules` declara explícitamente que el rol `commercial` no lee ni
  escribe Storage (su única descarga se genera en cliente desde una
  callable). El PDF final se renderiza en el navegador a partir del registro
  Firestore reproducible (`quividiCommercialProposals`), reusando
  `src/modules/exports/quividiPdfKit.ts`.
- **Demografía queda fuera del rollup en 3a.** El backfill histórico
  (`HISTORY_EXPORTS` en `historyModel.ts`) no pide hoy el export de `viewers`
  con desglose demográfico (eso solo existe en la llamada por campaña de Fase
  1, `group_by_demographics=1`). Agregarla implica una familia nueva al
  backfill (más cuota, más Storage) y se implementa aislada en su propia
  sub-fase.
- **El agente de descubrimiento de fechas (3c) vive en `/historial-quividi`**,
  no en Inteligencia Comercial, y hereda su permiso actual (`quividi.history`,
  hoy exclusivo de `admin`).
- **El agente LLM de propuestas (3d) usa Vertex AI (Gemini)**, vía service
  account del proyecto (sin secreto nuevo en Secret Manager, a diferencia de
  Quividi/Odoo). Sigue la misma regla que el PDF de Fase 1: puede citar cifras
  finales (OTS, audiencia) pero **nunca** debe mencionar metodología,
  extrapolación ni el mecanismo de duplicación.

## 7. Qué NO está implementado todavía

- Catálogo de reportes estándar y builder libre (sub-fase 3b).
- Descubrimiento de fechas de alto tráfico y su UI en `/historial-quividi`
  (sub-fase 3c).
- Agente LLM de propuestas comerciales, flujo borrador→confirmación→PDF→
  persistencia (sub-fase 3d).
- Demografía en el rollup comercial (fast-follow, aislado por cuota).

## 8. Archivos principales

Backend:

- `functions/src/quividi/commercial/commercialRollup.ts` (lógica pura)
- `functions/src/quividi/commercial/commercialRollupJob.ts` (orquestación +
  callables)
- `functions/src/quividi/commercial/commercialAudit.ts` (callable de
  auditoría)
- `functions/src/quividi/access.ts` (capacidades `quividi.commercial*`)

Frontend:

- `src/modules/commercial-intelligence/CommercialIntelligencePage.tsx`
- `src/modules/commercial-intelligence/commercialAuditView.ts`
- `src/services/quividi.ts` (`getQuividiCommercialAudit`)
- `src/app/routes.ts` (`/inteligencia-comercial`, `COMMERCIAL_ROUTE_PATHS`)
- `src/app/permissions.ts` (`quividi.commercial`, `quividi.commercial.generate`)

Documentación:

- `AGENTS.md` — invariantes transversales.
- `docs/QUIVIDI_PHASE_1.md`, `docs/QUIVIDI_PHASE_2.md` — fases anteriores, no
  modificadas.
