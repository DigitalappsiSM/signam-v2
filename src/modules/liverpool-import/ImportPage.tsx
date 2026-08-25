import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { analyzeCalendar, type CalendarAnalysis } from './calendarImport';
import {
  parseCampaigns,
  type CampaignParseResult,
  type ParsedCampaign,
} from './campaignParse';
import { readCalendarWorkbook } from './readCalendarWorkbook';
import {
  diffCampaigns,
  dedupeIncoming,
  campaignIdentity,
  type CampaignMatchPending,
  type CampaignMatchSelections,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import {
  isAmbiguousDate,
  interpretDate,
  ambiguousInterpretations,
  type DateOrder,
} from './dateAmbiguity';
import {
  listDateResolutions,
  saveDateResolutions,
  type DateResolution,
} from '@/services/dateResolutions';
import { applyCampaignChanges, listCampaigns } from '@/services/campaigns';
import {
  listOperationalTracking,
  initializeTrackingForImport,
  migrateLegacyOperationalTracking,
  type ImportClassificationSelection,
} from '@/services/campaignOperationalTracking';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import {
  listEkonLinks,
  migrateLegacyEkonLinks,
} from '@/services/campaignEkonLinks';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import { isValidDownloadUrl } from '@/modules/operational-tracking/downloadLink';
import type { Classification } from '@/modules/operational-tracking/types';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { importSummary, type ImportSummary } from './importSummary';
import { nextBulk, type BulkState } from './accordionBulk';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import { validateCampaignDates } from './campaignDateValidation';
import { campaignsMissingOperationalTracking } from '@/modules/operational-tracking/trackingReconciliation';
import { CAMPAIGN_FIELD_LABELS } from '@/modules/campaigns/campaignCorrection';
import {
  applyImportDateCorrections,
  campaignHasBlockingDates,
  importDateCorrectionError,
  toDateInputValue,
  type ImportDateCorrection,
  type ImportDateCorrections,
} from './importDateCorrection';
import './ImportPage.css';

/**
 * Señal de "expandir/colapsar todo". Las secciones la leen por contexto para no
 * tener que recibir props a través de los componentes envoltorio.
 */
const AccordionBulkContext = createContext<BulkState | null>(null);

type ClassChoice = Classification | '';

type Phase = 'idle' | 'analyzing' | 'done';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Resuelve una fecha cruda a ISO usando la memoria y las elecciones en curso;
 *  si sigue sin resolver (ambigua y sin elección) se deja tal cual. */
function resolvedDateValue(
  raw: string,
  memory: Map<string, DateResolution>,
  choices: Map<string, DateOrder>,
): string {
  if (!isAmbiguousDate(raw)) return raw;
  const mem = memory.get(raw);
  if (mem) return mem.iso;
  const choice = choices.get(raw);
  if (choice) return interpretDate(raw, choice) ?? raw;
  return raw;
}

function resolveCampaignDates(
  c: ParsedCampaign,
  memory: Map<string, DateResolution>,
  choices: Map<string, DateOrder>,
): ParsedCampaign {
  return {
    ...c,
    fechaInicio: resolvedDateValue(c.fechaInicio, memory, choices),
    fechaFin: resolvedDateValue(c.fechaFin, memory, choices),
  };
}

/** Importación del Calendario de Liverpool — inspección + campañas + guardado. */
export function ImportPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<CalendarAnalysis | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignParseResult | null>(null);
  const [parsedList, setParsedList] = useState<ParsedCampaign[]>([]);
  const [storedCampaigns, setStoredCampaigns] = useState<
    StoredCampaign[] | null
  >(null);
  const [existingTracking, setExistingTracking] = useState<
    CampaignOperationalTracking[]
  >([]);
  const [matchSelections, setMatchSelections] =
    useState<CampaignMatchSelections>(new Map());
  // Memoria persistida de fechas ambiguas ya confirmadas (raw → resolución).
  const [dateMemory, setDateMemory] = useState<Map<string, DateResolution>>(
    new Map(),
  );
  // Elección en curso del usuario para fechas ambiguas aún no confirmadas.
  const [dateChoices, setDateChoices] = useState<Map<string, DateOrder>>(
    new Map(),
  );
  // Correcciones de vigencia capturadas durante la importación (por fila de
  // origen), para campañas nuevas con fecha inválida. No tocan el archivo.
  const [dateCorrections, setDateCorrections] = useState<ImportDateCorrections>(
    new Map(),
  );
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clasificación operativa por campaña (solo las que aún no tienen seguimiento).
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [selections, setSelections] = useState<Map<string, ClassChoice>>(
    new Map(),
  );
  const [bulk, setBulk] = useState<BulkState | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setSaveNotice(null);
    setStoredCampaigns(null);
    setMatchSelections(new Map());
    setPhase('analyzing');
    try {
      const data = await readCalendarWorkbook(file);
      const structuralAnalysis = analyzeCalendar(data);
      const parsed = parseCampaigns(data);
      setAnalysis({
        ...structuralAnalysis,
        issues: [...structuralAnalysis.issues, ...(parsed.issues ?? [])],
      });
      setCampaigns(parsed);
      setParsedList(parsed.campaigns);
      setDateChoices(new Map());
      setDateCorrections(new Map());
      const [stored, tracking, resolutions] = await Promise.all([
        listCampaigns({ includeInactive: true }),
        listOperationalTracking(),
        listDateResolutions(),
      ]);
      setStoredCampaigns(stored);
      setExistingTracking(tracking);
      setDateMemory(resolutions);
      setExistingKeys(new Set(tracking.map((t) => t.campaignNameKey)));
      // El diff, la deduplicación, la clasificación y las fechas ambiguas se
      // derivan de forma reactiva (ver más abajo).
      setPhase('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(
        `No se pudo leer el archivo. Detalle: ${detail}. Si el problema persiste, intenta abrirlo en Excel y "Guardar como" → Libro de Excel (.xlsx).`,
      );
      setPhase('idle');
    }
  }

  // --- Derivaciones reactivas -----------------------------------------------
  // Campañas con las correcciones de vigencia de la importación ya aplicadas
  // (fila → fechas corregidas). Es la base de todas las derivaciones siguientes.
  const correctedList = useMemo(
    () => applyImportDateCorrections(parsedList, dateCorrections),
    [parsedList, dateCorrections],
  );

  // Calendario con fechas resueltas (memoria + elecciones) y deduplicado.
  const resolvedList = useMemo(
    () =>
      dedupeIncoming(
        correctedList.map((c) =>
          resolveCampaignDates(c, dateMemory, dateChoices),
        ),
      ),
    [correctedList, dateMemory, dateChoices],
  );

  const diff = useMemo(
    () =>
      storedCampaigns
        ? diffCampaigns(resolvedList, storedCampaigns, matchSelections)
        : null,
    [resolvedList, storedCampaigns, matchSelections],
  );

  // Fechas ambiguas (texto A/B con ambos ≤ 12) que NO están en la memoria: hay
  // que confirmarlas. Las que ya están en la memoria se aplican solas.
  const ambiguousRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { raw: string; dmy: string | null; mdy: string | null }[] = [];
    for (const c of correctedList) {
      for (const raw of [c.fechaInicio, c.fechaFin]) {
        if (!isAmbiguousDate(raw) || dateMemory.has(raw) || seen.has(raw)) {
          continue;
        }
        seen.add(raw);
        rows.push({ raw, ...ambiguousInterpretations(raw) });
      }
    }
    return rows.sort((a, b) => a.raw.localeCompare(b.raw));
  }, [correctedList, dateMemory]);

  const pendingDatesCount = ambiguousRows.filter(
    (r) => !dateChoices.get(r.raw),
  ).length;

  // Vista "Campañas detectadas" con las fechas ya resueltas (para que la vista
  // previa coincida con lo que se guardará, no con la lectura cruda día-primero).
  const resolvedResult = useMemo(
    () =>
      campaigns
        ? {
            ...campaigns,
            campaigns: correctedList.map((c) =>
              resolveCampaignDates(c, dateMemory, dateChoices),
            ),
          }
        : null,
    [campaigns, correctedList, dateMemory, dateChoices],
  );

  // Campañas del calendario sin seguimiento previo (necesitan clasificación).
  const needClass = useMemo(() => {
    const out: { nameKey: string; name: string; tipo: string; link: string }[] =
      [];
    const seen = new Set<string>();
    const matchedByIdentity = new Map(
      (diff?.matched ?? []).map((match) => [
        campaignIdentity(match.campaign),
        match.stored,
      ]),
    );
    const trackingCampaignIds = new Set(
      existingTracking.flatMap((tracking) =>
        tracking.campaignId ? [tracking.campaignId] : [],
      ),
    );
    const legacyTrackingKeys = new Set(
      existingTracking
        .filter((tracking) => !tracking.campaignId)
        .map((tracking) => tracking.campaignNameKey),
    );
    for (const c of resolvedList) {
      const nameKey = campaignIdentity(c);
      const stored = matchedByIdentity.get(nameKey);
      const hasTracking =
        existingKeys.has(nameKey) ||
        (stored != null &&
          (trackingCampaignIds.has(stored.id) ||
            legacyTrackingKeys.has(campaignIdentity(stored))));
      if (hasTracking || seen.has(nameKey)) continue;
      seen.add(nameKey);
      out.push({ nameKey, name: c.name, tipo: c.tipo, link: c.link });
    }
    return out;
  }, [resolvedList, existingKeys, existingTracking, diff]);

  // Preselección de clasificación por identidad: agrega defaults para las
  // identidades nuevas sin pisar lo que el usuario ya haya elegido.
  useEffect(() => {
    setSelections((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const c of resolvedList) {
        const nameKey = campaignIdentity(c);
        if (existingKeys.has(nameKey) || next.has(nameKey)) continue;
        const auto = classifyFromTipo(c.tipo);
        next.set(nameKey, auto === 'unknown' ? '' : auto);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [resolvedList, existingKeys]);

  const pendingClassCount = needClass.filter(
    (k) => !selections.get(k.nameKey),
  ).length;
  const pendingMatchCount = diff?.pendingMatches.length ?? 0;
  const pendingCount = pendingClassCount + pendingMatchCount;

  // Valida fechas después de resolver DMY/MDY y después de aplicar las
  // correcciones manuales del documento emparejado. Una fecha ambigua pendiente
  // se valida cuando el usuario elige su interpretación, no antes.
  const dateIssues = useMemo(() => {
    const unresolved = new Set(
      ambiguousRows
        .filter((row) => !dateChoices.get(row.raw))
        .map((row) => row.raw),
    );
    const candidates = diff
      ? [
          ...diff.matched.map((match) => match.campaign),
          ...diff.added,
          ...diff.pendingMatches.map((pending) => pending.campaign),
        ]
      : resolvedList;
    const unique = new Map(
      candidates.map((campaign) => [campaignIdentity(campaign), campaign]),
    );
    return validateCampaignDates(
      [...unique.values()].filter(
        (campaign) =>
          !unresolved.has(campaign.fechaInicio) &&
          !unresolved.has(campaign.fechaFin),
      ),
      campaigns?.operativeSheet ?? null,
    );
  }, [ambiguousRows, dateChoices, diff, resolvedList, campaigns]);

  const manualOverrideIssues = useMemo(
    () =>
      (diff?.matched ?? [])
        .filter((match) => match.overriddenFields.length > 0)
        .map((match) => ({
          severity: 'warning' as const,
          code: 'manual-correction-preserved',
          message: `Se conservó la corrección manual de "${match.campaign.name}" en: ${match.overriddenFields
            .map((field) => CAMPAIGN_FIELD_LABELS[field])
            .join(', ')}. El valor del archivo no sobrescribirá estos campos.`,
          location: campaigns?.operativeSheet
            ? { sheet: campaigns.operativeSheet }
            : undefined,
        })),
    [campaigns?.operativeSheet, diff],
  );

  // Altas nuevas con vigencia inválida que aún pueden corregirse dentro de la
  // importación. Las coincidencias con campañas ya guardadas no se listan aquí:
  // esas se corrigen desde Campañas y su corrección se conserva al reimportar.
  const correctableAdded = useMemo(
    () => (diff ? diff.added.filter((c) => campaignHasBlockingDates(c)) : []),
    [diff],
  );
  const appliedCorrections = useMemo(() => {
    const byRow = new Map(parsedList.map((c) => [c.row, c]));
    return [...dateCorrections.entries()]
      .flatMap(([row, correction]) => {
        const campaign = byRow.get(row);
        return campaign ? [{ row, campaign, correction }] : [];
      })
      .sort((a, b) => a.row - b.row);
  }, [dateCorrections, parsedList]);

  const validatedAnalysis = useMemo<CalendarAnalysis | null>(
    () =>
      analysis
        ? {
            ...analysis,
            issues: [
              ...analysis.issues,
              ...dateIssues,
              ...manualOverrideIssues,
            ],
          }
        : null,
    [analysis, dateIssues, manualOverrideIssues],
  );
  const blockingCount =
    validatedAnalysis?.issues.filter((issue) => issue.severity === 'blocking')
      .length ?? 0;
  // Hay trabajo si: cambios en campañas, clasificaciones nuevas, o **fechas
  // ambiguas por resolver** (aunque la fecha resuelta ya coincida con la BD, hay
  // que persistir la confirmación para no volver a preguntar).
  const hasWork =
    Boolean(diff?.hasChanges) ||
    pendingMatchCount > 0 ||
    needClass.length > 0 ||
    ambiguousRows.length > 0 ||
    blockingCount > 0;
  const canSave =
    hasWork &&
    blockingCount === 0 &&
    pendingCount === 0 &&
    pendingDatesCount === 0;
  const summary = importSummary(
    diff,
    validatedAnalysis,
    needClass.length,
    pendingCount + pendingDatesCount,
  );

  function setSelection(nameKey: string, value: ClassChoice) {
    setSelections((prev) => new Map(prev).set(nameKey, value));
  }

  function setMatchSelection(incomingIdentity: string, storedId: string) {
    setMatchSelections((prev) => {
      const next = new Map(prev);
      next.set(incomingIdentity, storedId === '__new__' ? null : storedId);
      return next;
    });
  }

  function setDateChoice(raw: string, order: DateOrder) {
    setDateChoices((prev) => new Map(prev).set(raw, order));
  }

  function applyDateCorrection(row: number, correction: ImportDateCorrection) {
    setDateCorrections((prev) => new Map(prev).set(row, correction));
  }

  function undoDateCorrection(row: number) {
    setDateCorrections((prev) => {
      const next = new Map(prev);
      next.delete(row);
      return next;
    });
  }

  async function saveChanges() {
    if (
      saving ||
      blockingCount > 0 ||
      pendingCount > 0 ||
      pendingDatesCount > 0
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveNotice(null);
    try {
      // Persiste las resoluciones de fecha confirmadas para reimportaciones.
      const newResolutions: DateResolution[] = ambiguousRows
        .map((r): DateResolution | null => {
          const order = dateChoices.get(r.raw);
          if (!order) return null;
          const iso = interpretDate(r.raw, order);
          return iso ? { raw: r.raw, order, iso } : null;
        })
        .filter((x): x is DateResolution => x !== null);
      if (newResolutions.length > 0) {
        await saveDateResolutions(newResolutions, actor);
      }

      if (storedCampaigns) {
        const [links, tracking] = await Promise.all([
          listEkonLinks(),
          listOperationalTracking(),
        ]);
        await Promise.all([
          migrateLegacyEkonLinks(storedCampaigns, links),
          migrateLegacyOperationalTracking(storedCampaigns, tracking),
        ]);
      }

      let res = {
        added: 0,
        modified: 0,
        removed: 0,
        addedCampaignIds: {} as Record<string, string>,
      };
      if (diff && diff.hasChanges) {
        res = await applyCampaignChanges(diff, actor, dateCorrections);
      }
      const matchedIds = new Map(
        (diff?.matched ?? []).map((match) => [
          campaignIdentity(match.campaign),
          match.stored.id,
        ]),
      );
      const sels: ImportClassificationSelection[] = needClass
        .map((k) => ({
          campaignId:
            matchedIds.get(k.nameKey) ?? res.addedCampaignIds[k.nameKey] ?? '',
          campaignNameKey: k.nameKey,
          campaignName: k.name,
          classification: selections.get(k.nameKey) as Classification,
          linkValid: isValidDownloadUrl(k.link),
          confirmedReclassify: false,
        }))
        .filter(
          (s) =>
            s.campaignId !== '' &&
            (s.classification === 'institutional' ||
              s.classification === 'provider'),
        );
      const track = sels.length
        ? await initializeTrackingForImport(sels, actor)
        : { created: 0, reclassified: 0, failures: [] };

      const [stored, tracking, resolutions] = await Promise.all([
        listCampaigns({ includeInactive: true }),
        listOperationalTracking(),
        listDateResolutions(),
      ]);
      setStoredCampaigns(stored);
      setExistingTracking(tracking);
      setDateMemory(resolutions);
      setExistingKeys(new Set(tracking.map((t) => t.campaignNameKey)));
      const missingTracking = campaignsMissingOperationalTracking(
        stored,
        tracking,
      );
      const inconsistentNames = Array.from(
        new Set([
          ...track.failures.map((failure) => failure.campaignName),
          ...missingTracking.map((campaign) => campaign.name),
        ]),
      );
      if (inconsistentNames.length > 0) {
        setSaveNotice(
          `Guardado parcial: ${res.added} nuevas, ${res.modified} actualizadas, ${res.removed} inactivadas. Seguimiento inicializado: ${track.created}.`,
        );
        setError(
          `Inconsistencia detectada: estas campañas activas quedaron sin seguimiento operativo: ${inconsistentNames.join(', ')}. Vuelve a importar el mismo calendario para reintentar; la operación es idempotente y conserva los checks existentes.`,
        );
      } else {
        setSaveNotice(
          `Guardado y verificado: ${res.added} nuevas, ${res.modified} actualizadas, ${res.removed} inactivadas. Seguimiento inicializado: ${track.created}.`,
        );
      }
    } catch (saveError) {
      const detail =
        saveError instanceof Error ? saveError.message : String(saveError);
      setError(
        `No se pudieron completar los cambios. Detalle: ${detail}. Revisa Campañas y Seguimiento operativo antes de reintentar.`,
      );
    } finally {
      setSaving(false);
    }
  }

  function downloadDiagnosis() {
    if (!validatedAnalysis) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { fileName, analysis: validatedAnalysis, campaigns },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostico-${fileName || 'calendario'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const blocking =
    validatedAnalysis?.issues.filter((i) => i.severity === 'blocking') ?? [];
  const warnings =
    validatedAnalysis?.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <>
      <PageHeader
        title="Importar Calendario"
        description="Sube el Calendario de Liverpool. Verás un resumen de todo lo detectado; abre cada sección solo para el detalle que te interese. Lo crítico (errores, pendientes y campañas eliminadas/modificadas) aparece abierto."
      />

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label className="import-file">
          <span className="btn btn-primary">
            Seleccionar calendario (.xlsx / .xls)
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => void handleFile(e)}
            hidden
          />
        </label>
        {fileName && (
          <span className="text-muted import-file__name">{fileName}</span>
        )}
      </div>

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {phase === 'analyzing' && (
        <p className="text-muted">Analizando archivo…</p>
      )}

      {phase === 'done' && (
        <ImportSummaryBanner
          summary={summary}
          saving={saving}
          canSave={canSave}
          hasWork={hasWork}
          onSave={() => void saveChanges()}
        />
      )}

      {saveNotice && (
        <div className="catalog__notice" role="status">
          {saveNotice}
        </div>
      )}

      {phase === 'done' && (
        <AccordionBulkContext.Provider value={bulk}>
          <div className="imp-accordion__toolbar">
            <button
              type="button"
              className="btn btn-secondary imp-accordion__toggle"
              onClick={() => setBulk((b) => nextBulk(b, true))}
            >
              Expandir todo
            </button>
            <button
              type="button"
              className="btn btn-secondary imp-accordion__toggle"
              onClick={() => setBulk((b) => nextBulk(b, false))}
            >
              Colapsar todo
            </button>
          </div>
          <div className="imp-accordion">
            {(blocking.length > 0 || warnings.length > 0) && (
              <Section
                title="Errores y advertencias"
                chip={issuesChip(blocking.length, warnings.length)}
                tone={blocking.length > 0 ? 'danger' : 'warning'}
                defaultOpen
              >
                {blocking.length > 0 && (
                  <div className="import__issues import__issues--blocking">
                    <h3>Errores</h3>
                    <ul>
                      {blocking.map((i, idx) => (
                        <li key={idx}>{i.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {warnings.length > 0 && (
                  <div className="import__issues import__issues--warning">
                    <h3>Advertencias</h3>
                    <ul>
                      {warnings.map((i, idx) => (
                        <li key={idx}>{i.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            )}

            {(correctableAdded.length > 0 || appliedCorrections.length > 0) && (
              <InvalidDateCorrectionPanel
                correctable={correctableAdded}
                applied={appliedCorrections}
                onApply={applyDateCorrection}
                onUndo={undoDateCorrection}
              />
            )}

            {ambiguousRows.length > 0 && (
              <AmbiguousDatesPanel
                rows={ambiguousRows}
                choices={dateChoices}
                onChange={setDateChoice}
                pendingCount={pendingDatesCount}
              />
            )}

            {diff && diff.pendingMatches.length > 0 && (
              <CampaignMatchPanel
                items={diff.pendingMatches}
                selectedStoredIds={
                  new Set(
                    [...matchSelections.values()].filter(
                      (id): id is string => id !== null,
                    ),
                  )
                }
                onChange={setMatchSelection}
              />
            )}

            {needClass.length > 0 && (
              <ClassificationPanel
                items={needClass}
                selections={selections}
                onChange={setSelection}
                pendingCount={pendingClassCount}
              />
            )}

            {diff && diff.modified.length > 0 && (
              <Section
                title="Campañas modificadas"
                chip={diff.modified.length}
                tone="info"
                defaultOpen
              >
                <div className="diagnosis__table-wrap">
                  <table className="catalog__table">
                    <thead>
                      <tr>
                        <th>Campaña</th>
                        <th>Cambios</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.modified.slice(0, 200).map((m) => (
                        <tr key={m.campaign.name}>
                          <td>{m.campaign.name}</td>
                          <td>{m.changes.join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {diff && diff.removed.length > 0 && (
              <Section
                title="Campañas inactivadas"
                chip={diff.removed.length}
                tone="danger"
                defaultOpen
              >
                <p className="import__note" style={{ marginTop: 0 }}>
                  Estas campañas dejarán de mostrarse, pero conservarán su ID,
                  Ekon y seguimiento para una posible reactivación.
                </p>
                <ul className="text-muted">
                  {diff.removed.slice(0, 100).map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                </ul>
              </Section>
            )}

            {diff && diff.added.length > 0 && (
              <Section
                title="Campañas nuevas"
                chip={diff.added.length}
                tone="success"
              >
                <ul className="text-muted">
                  {diff.added.slice(0, 100).map((c) => (
                    <li key={c.name}>{c.name}</li>
                  ))}
                </ul>
              </Section>
            )}

            {diff && !diff.hasChanges && (
              <p className="import__note">
                Las campañas del calendario coinciden con la base de datos. No
                se reescribe nada.
              </p>
            )}

            {resolvedResult && <CampaignsSection result={resolvedResult} />}

            {validatedAnalysis && (
              <FileDiagnosisSection
                analysis={validatedAnalysis}
                onDownload={downloadDiagnosis}
              />
            )}
          </div>
        </AccordionBulkContext.Provider>
      )}
    </>
  );
}

/** Franja-titular fija con las cifras clave y el botón de guardado. */
function ImportSummaryBanner({
  summary,
  saving,
  canSave,
  hasWork,
  onSave,
}: {
  summary: ImportSummary;
  saving: boolean;
  canSave: boolean;
  hasWork: boolean;
  onSave: () => void;
}) {
  return (
    <div className="imp-banner">
      <div className="imp-banner__stats">
        <Stat
          value={summary.added}
          label="Nuevas"
          tone={summary.added > 0 ? 'success' : 'neutral'}
        />
        <Stat
          value={summary.modified}
          label="Modificadas"
          tone={summary.modified > 0 ? 'info' : 'neutral'}
        />
        <Stat
          value={summary.removed}
          label="Eliminadas"
          tone={summary.removed > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          value={summary.pending}
          label="Pendientes"
          tone={summary.pending > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          value={summary.errors}
          label="Errores"
          tone={summary.errors > 0 ? 'danger' : 'neutral'}
        />
      </div>
      <div className="imp-banner__action">
        {hasWork ? (
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !canSave}
            title={
              summary.errors > 0
                ? `Corrige ${summary.errors} errores bloqueantes del calendario`
                : summary.pending > 0
                  ? `Faltan ${summary.pending} confirmaciones por definir (clasificación o fecha)`
                  : undefined
            }
          >
            {saving ? 'Guardando…' : 'Aceptar y guardar cambios'}
          </button>
        ) : (
          <span className="badge badge-info">Sin cambios</span>
        )}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: Tone;
}) {
  return (
    <div className={`imp-stat imp-stat--${tone}`}>
      <span className="imp-stat__value">{value}</span>
      <span className="imp-stat__label">{label}</span>
    </div>
  );
}

/** Sección colapsable (resumen → detalle) del acordeón de importación. */
function Section({
  title,
  chip,
  tone = 'neutral',
  defaultOpen = false,
  children,
}: {
  title: string;
  chip?: ReactNode;
  tone?: Tone;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const bulk = useContext(AccordionBulkContext);
  // "Expandir/colapsar todo": aplica el estado global de forma imperativa sin
  // volver la sección controlada (el usuario sigue pudiendo abrir/cerrar a mano).
  useEffect(() => {
    if (bulk && ref.current) ref.current.open = bulk.open;
  }, [bulk]);
  return (
    <details ref={ref} className="imp-section" open={defaultOpen}>
      <summary className="imp-section__summary">
        <span className="imp-section__caret" aria-hidden="true">
          ▸
        </span>
        <span className="imp-section__title">{title}</span>
        {chip != null && chip !== '' && (
          <span className={`imp-chip imp-chip--${tone}`}>{chip}</span>
        )}
      </summary>
      <div className="imp-section__body">{children}</div>
    </details>
  );
}

function issuesChip(errors: number, warnings: number): string {
  return [
    errors > 0 ? `${errors} ${errors === 1 ? 'error' : 'errores'}` : null,
    warnings > 0
      ? `${warnings} ${warnings === 1 ? 'advertencia' : 'advertencias'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function campaignMatchLabel(campaign: StoredCampaign): string {
  return `${campaign.name} · ${formatCivilString(
    campaign.fechaInicio,
  )}–${formatCivilString(campaign.fechaFin)} · fila ${campaign.row}`;
}

/** Confirmación humana para homónimos o correcciones de nombre ambiguas. */
function CampaignMatchPanel({
  items,
  selectedStoredIds,
  onChange,
}: {
  items: CampaignMatchPending[];
  selectedStoredIds: Set<string>;
  onChange: (incomingIdentity: string, storedId: string) => void;
}) {
  return (
    <Section
      title="Campañas por emparejar"
      chip={`${items.length} pendientes`}
      tone="warning"
      defaultOpen
    >
      <p className="import__note" style={{ marginTop: 0 }}>
        SIGNAM encontró campañas homónimas o una posible corrección de nombre y
        no puede asegurar cuál línea anterior corresponde. Elige la campaña que
        conserva el mismo ID, Ekon y seguimiento, o indícala como nueva.
      </p>
      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Campaña entrante</th>
              <th>Inicio / fin</th>
              <th>Corresponde a</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.incomingIdentity}>
                <td>
                  {item.campaign.name}
                  {item.reason === 'name-change' && (
                    <span className="badge badge-warning">
                      Cambio de nombre
                    </span>
                  )}
                </td>
                <td>
                  {formatCivilString(item.campaign.fechaInicio)} –{' '}
                  {formatCivilString(item.campaign.fechaFin)}
                </td>
                <td>
                  <select
                    className="catalog__search"
                    aria-label={`Emparejar ${item.campaign.name}`}
                    defaultValue=""
                    onChange={(event) =>
                      onChange(item.incomingIdentity, event.target.value)
                    }
                  >
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {item.candidates.map((candidate) => (
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        disabled={selectedStoredIds.has(candidate.id)}
                      >
                        {campaignMatchLabel(candidate)}
                      </option>
                    ))}
                    <option value="__new__">Es una campaña nueva</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CampaignsSection({ result }: { result: CampaignParseResult }) {
  const liverpoolStores = (c: CampaignParseResult['campaigns'][number]) =>
    c.supports
      .filter((s) => s.owner === 'liverpool')
      .reduce((n, s) => n + s.stores.length, 0);

  return (
    <Section
      title="Campañas detectadas"
      chip={result.totalCampaigns}
      tone="neutral"
    >
      <dl className="import__summary">
        <div>
          <dt>Campañas</dt>
          <dd>
            <strong>{result.totalCampaigns}</strong>
          </dd>
        </div>
        <div>
          <dt>Soportes Liverpool</dt>
          <dd>{result.liverpoolSupports.length}</dd>
        </div>
        <div>
          <dt>Soportes InStore (excluidos)</dt>
          <dd>{result.instoreSupports.length}</dd>
        </div>
      </dl>

      <div className="import__note">
        <strong>Soportes Liverpool:</strong>{' '}
        {result.liverpoolSupports.join(' · ') || '—'}
        <br />
        <strong>InStore Media (Muppi’s / Pendón, excluidos):</strong>{' '}
        {result.instoreSupports.join(' · ') || '—'}
      </div>

      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Soportes Liverpool</th>
              <th>Tiendas</th>
            </tr>
          </thead>
          <tbody>
            {result.campaigns.slice(0, 100).map((c) => (
              <tr key={c.row}>
                <td>{c.name}</td>
                <td>{formatCivilString(c.fechaInicio)}</td>
                <td>{formatCivilString(c.fechaFin)}</td>
                <td>
                  {c.supports
                    .filter((s) => s.owner === 'liverpool')
                    .map((s) => s.support)
                    .join(', ') || '—'}
                </td>
                <td>{liverpoolStores(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.campaigns.length > 100 && (
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          Mostrando las primeras 100 de {result.campaigns.length} campañas.
        </p>
      )}
    </Section>
  );
}

function FileDiagnosisSection({
  analysis,
  onDownload,
}: {
  analysis: CalendarAnalysis;
  onDownload: () => void;
}) {
  return (
    <Section
      title="Diagnóstico del archivo"
      chip={`${analysis.dataRowCount} filas`}
      tone="neutral"
    >
      <div className="diagnosis__head">
        <span className="text-muted">
          Estructura detectada del calendario (hojas, columnas, vista previa y
          comentarios).
        </span>
        <button className="btn btn-secondary" onClick={onDownload}>
          Descargar diagnóstico (JSON)
        </button>
      </div>

      <dl className="import__summary">
        <div>
          <dt>Hoja operativa</dt>
          <dd>{analysis.operativeSheet ?? '—'}</dd>
        </div>
        <div>
          <dt>Fila de encabezados</dt>
          <dd>{analysis.headerRow ?? '—'}</dd>
        </div>
        <div>
          <dt>Columnas detectadas</dt>
          <dd>{analysis.headers.filter((h) => h !== '').length}</dd>
        </div>
        <div>
          <dt>Filas de datos</dt>
          <dd>
            <strong>{analysis.dataRowCount}</strong>
          </dd>
        </div>
        <div>
          <dt>Comentarios de celda</dt>
          <dd>{analysis.comments.length}</dd>
        </div>
      </dl>

      <section className="diagnosis__section">
        <h3>Hojas del archivo</h3>
        <ul className="text-muted">
          {analysis.sheets.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> — {s.rows} filas × {s.cols} columnas
              {s.name === analysis.operativeSheet ? ' (operativa)' : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="diagnosis__section">
        <h3>Soportes InStore Media detectados (Muppi’s / Pendón)</h3>
        {analysis.instoreSupports.length === 0 ? (
          <p className="text-muted">Ninguno.</p>
        ) : (
          <ul>
            {analysis.instoreSupports.map((s) => (
              <li key={s.value}>
                <span className="badge badge-warning">{s.value}</span> ×{' '}
                {s.count}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          En esta etapa Muppi’s y Pendón se detectan pero se excluyen de la
          consolidación.
        </p>
      </section>

      {analysis.headers.length > 0 && (
        <section className="diagnosis__section">
          <h3>Vista previa</h3>
          <div className="diagnosis__table-wrap">
            <table className="catalog__table">
              <thead>
                <tr>
                  {analysis.headers.map((h, i) => (
                    <th key={i}>{h || `(col ${i + 1})`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.previewRows.map((row, r) => (
                  <tr key={r}>
                    {analysis.headers.map((_, c) => (
                      <td key={c}>{row[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {analysis.comments.length > 0 && (
        <section className="diagnosis__section">
          <h3>Comentarios de celda</h3>
          <div className="diagnosis__table-wrap">
            <table className="catalog__table">
              <thead>
                <tr>
                  <th>Celda</th>
                  <th>Comentario</th>
                </tr>
              </thead>
              <tbody>
                {analysis.comments.slice(0, 50).map((c, i) => (
                  <tr key={i}>
                    <td>{c.address}</td>
                    <td>{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Section>
  );
}

function AmbiguousDatesPanel({
  rows,
  choices,
  onChange,
  pendingCount,
}: {
  rows: { raw: string; dmy: string | null; mdy: string | null }[];
  choices: Map<string, DateOrder>;
  onChange: (raw: string, order: DateOrder) => void;
  pendingCount: number;
}) {
  return (
    <Section
      title="Fechas por confirmar"
      chip={pendingCount > 0 ? `${pendingCount} pendientes` : 'Completa'}
      tone={pendingCount > 0 ? 'warning' : 'success'}
      defaultOpen={pendingCount > 0}
    >
      <p className="import__note" style={{ marginTop: 0 }}>
        Estas fechas del calendario están escritas como texto y son{' '}
        <strong>ambiguas</strong> (no se sabe si el orden es día/mes o mes/día).
        Elige la interpretación correcta; se <strong>recordará</strong> para las
        próximas importaciones. No se puede guardar con fechas pendientes.
      </p>
      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Valor en el calendario</th>
              <th>Día / mes (dd/mm)</th>
              <th>Mes / día (mm/dd)</th>
              <th>Interpretación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const val = choices.get(r.raw) ?? '';
              return (
                <tr key={r.raw}>
                  <td>
                    <code>{r.raw}</code>
                  </td>
                  <td className="text-muted">
                    {r.dmy ? formatCivilString(r.dmy) : '—'}
                  </td>
                  <td className="text-muted">
                    {r.mdy ? formatCivilString(r.mdy) : '—'}
                  </td>
                  <td>
                    <select
                      aria-label={`Interpretación de la fecha ${r.raw}`}
                      value={val}
                      onChange={(e) =>
                        onChange(r.raw, e.target.value as DateOrder)
                      }
                    >
                      <option value="">— Selecciona —</option>
                      {r.dmy && (
                        <option value="DMY">
                          Día/mes → {formatCivilString(r.dmy)}
                        </option>
                      )}
                      {r.mdy && (
                        <option value="MDY">
                          Mes/día → {formatCivilString(r.mdy)}
                        </option>
                      )}
                    </select>
                    {val === '' && (
                      <span
                        className="badge badge-warning"
                        style={{ marginLeft: '0.4rem' }}
                      >
                        Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * Corrección auditada de vigencias inválidas de campañas nuevas, dentro de la
 * importación. No modifica el archivo de Liverpool: aplica la fecha en memoria
 * para desbloquear la importación y, al guardar, la persiste como corrección
 * auditada de la campaña.
 */
function InvalidDateCorrectionPanel({
  correctable,
  applied,
  onApply,
  onUndo,
}: {
  correctable: ParsedCampaign[];
  applied: {
    row: number;
    campaign: ParsedCampaign;
    correction: ImportDateCorrection;
  }[];
  onApply: (row: number, correction: ImportDateCorrection) => void;
  onUndo: (row: number) => void;
}) {
  const pending = correctable.length;
  return (
    <Section
      title="Fechas inválidas por corregir"
      chip={pending > 0 ? `${pending} pendientes` : 'Completa'}
      tone={pending > 0 ? 'danger' : 'success'}
      defaultOpen={pending > 0}
    >
      <p className="import__note" style={{ marginTop: 0 }}>
        Estas campañas <strong>nuevas</strong> traen una vigencia inválida en el
        archivo (año fuera de 2000–2100, texto no interpretable, o inicio
        posterior a fin). Corrige la fecha aquí{' '}
        <strong>sin modificar el archivo de Liverpool</strong>: la corrección
        queda auditada (motivo, autor y fecha) y se conserva en futuras
        reimportaciones. Las campañas que ya existían se corrigen desde{' '}
        <strong>Campañas</strong>.
      </p>
      {correctable.length > 0 && (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Campaña (fila)</th>
                <th>Fecha de inicio</th>
                <th>Fecha de fin</th>
                <th>Motivo</th>
                <th aria-label="Acción" />
              </tr>
            </thead>
            <tbody>
              {correctable.map((c) => (
                <DateCorrectionRow key={c.row} campaign={c} onApply={onApply} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {applied.length > 0 && (
        <div
          className="import__issues import__issues--warning"
          style={{ marginTop: '1rem' }}
        >
          <h3>Correcciones aplicadas</h3>
          <ul>
            {applied.map(({ row, campaign, correction }) => (
              <li key={row}>
                <strong>{campaign.name}</strong> (fila {row}):{' '}
                <code>{correction.before.fechaInicio || '(vacía)'}</code> –{' '}
                <code>{correction.before.fechaFin || '(vacía)'}</code> →{' '}
                <strong>
                  {formatCivilString(correction.fechaInicio)} –{' '}
                  {formatCivilString(correction.fechaFin)}
                </strong>
                . Motivo: {correction.reason}{' '}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onUndo(row)}
                >
                  Deshacer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** Fila editable para corregir la vigencia de una campaña nueva. */
function DateCorrectionRow({
  campaign,
  onApply,
}: {
  campaign: ParsedCampaign;
  onApply: (row: number, correction: ImportDateCorrection) => void;
}) {
  const [inicio, setInicio] = useState(() =>
    toDateInputValue(campaign.fechaInicio),
  );
  const [fin, setFin] = useState(() => toDateInputValue(campaign.fechaFin));
  const [reason, setReason] = useState('');
  const error = importDateCorrectionError(
    campaign,
    { fechaInicio: inicio, fechaFin: fin },
    reason,
  );
  return (
    <tr>
      <td>
        {campaign.name}
        <span className="text-muted"> · fila {campaign.row}</span>
        <div className="text-muted" style={{ fontSize: '0.8rem' }}>
          Archivo: {campaign.fechaInicio || '(vacía)'} –{' '}
          {campaign.fechaFin || '(vacía)'}
        </div>
      </td>
      <td>
        <input
          type="date"
          aria-label={`Fecha de inicio de ${campaign.name}`}
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
      </td>
      <td>
        <input
          type="date"
          aria-label={`Fecha de fin de ${campaign.name}`}
          value={fin}
          onChange={(e) => setFin(e.target.value)}
        />
      </td>
      <td>
        <input
          type="text"
          aria-label={`Motivo de la corrección de ${campaign.name}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (mín. 5)"
        />
      </td>
      <td>
        <button
          type="button"
          className="btn btn-primary"
          disabled={error != null}
          title={error ?? undefined}
          onClick={() =>
            onApply(campaign.row, {
              fechaInicio: inicio,
              fechaFin: fin,
              reason: reason.trim(),
              before: {
                fechaInicio: campaign.fechaInicio,
                fechaFin: campaign.fechaFin,
              },
            })
          }
        >
          Aplicar
        </button>
      </td>
    </tr>
  );
}

function ClassificationPanel({
  items,
  selections,
  onChange,
  pendingCount,
}: {
  items: { nameKey: string; name: string; tipo: string }[];
  selections: Map<string, ClassChoice>;
  onChange: (nameKey: string, value: ClassChoice) => void;
  pendingCount: number;
}) {
  // Pendientes primero para facilitar completarlas.
  const sorted = [...items].sort((a, b) => {
    const pa = selections.get(a.nameKey) ? 1 : 0;
    const pb = selections.get(b.nameKey) ? 1 : 0;
    return pa - pb || a.name.localeCompare(b.name, 'es');
  });

  return (
    <Section
      title="Clasificación operativa"
      chip={pendingCount > 0 ? `${pendingCount} pendientes` : 'Completa'}
      tone={pendingCount > 0 ? 'warning' : 'success'}
      defaultOpen={pendingCount > 0}
    >
      <p className="import__note" style={{ marginTop: 0 }}>
        Clasifica cada campaña nueva como <strong>Institucional</strong> o{' '}
        <strong>Proveedor</strong>. Las que traen el tipo claro vienen
        preseleccionadas y puedes corregirlas. No se puede confirmar la
        importación con clasificaciones pendientes.
      </p>
      <div
        className="diagnosis__table-wrap"
        style={{ maxHeight: 360, overflowY: 'auto' }}
      >
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Tipo</th>
              <th>Clasificación</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((it) => {
              const val = selections.get(it.nameKey) ?? '';
              return (
                <tr key={it.nameKey}>
                  <td>{it.name}</td>
                  <td className="text-muted">{it.tipo || '—'}</td>
                  <td>
                    <select
                      aria-label={`Clasificación de ${it.name}`}
                      value={val}
                      onChange={(e) =>
                        onChange(it.nameKey, e.target.value as ClassChoice)
                      }
                    >
                      <option value="">— Selecciona —</option>
                      <option value="institutional">Institucional</option>
                      <option value="provider">Proveedor</option>
                    </select>
                    {val === '' && (
                      <span
                        className="badge badge-warning"
                        style={{ marginLeft: '0.4rem' }}
                      >
                        Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
