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
  type ImportClassificationSelection,
} from '@/services/campaignOperationalTracking';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import { isValidDownloadUrl } from '@/modules/operational-tracking/downloadLink';
import type { Classification } from '@/modules/operational-tracking/types';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { importSummary, type ImportSummary } from './importSummary';
import { nextBulk, type BulkState } from './accordionBulk';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
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
  // Memoria persistida de fechas ambiguas ya confirmadas (raw → resolución).
  const [dateMemory, setDateMemory] = useState<Map<string, DateResolution>>(
    new Map(),
  );
  // Elección en curso del usuario para fechas ambiguas aún no confirmadas.
  const [dateChoices, setDateChoices] = useState<Map<string, DateOrder>>(
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
    setPhase('analyzing');
    try {
      const data = await readCalendarWorkbook(file);
      setAnalysis(analyzeCalendar(data));
      const parsed = parseCampaigns(data);
      setCampaigns(parsed);
      setParsedList(parsed.campaigns);
      setDateChoices(new Map());
      const [stored, tracking, resolutions] = await Promise.all([
        listCampaigns(),
        listOperationalTracking(),
        listDateResolutions(),
      ]);
      setStoredCampaigns(stored);
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
  // Calendario con fechas resueltas (memoria + elecciones) y deduplicado.
  const resolvedList = useMemo(
    () =>
      dedupeIncoming(
        parsedList.map((c) => resolveCampaignDates(c, dateMemory, dateChoices)),
      ),
    [parsedList, dateMemory, dateChoices],
  );

  const diff = useMemo(
    () =>
      storedCampaigns ? diffCampaigns(resolvedList, storedCampaigns) : null,
    [resolvedList, storedCampaigns],
  );

  // Fechas ambiguas (texto A/B con ambos ≤ 12) que NO están en la memoria: hay
  // que confirmarlas. Las que ya están en la memoria se aplican solas.
  const ambiguousRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { raw: string; dmy: string | null; mdy: string | null }[] = [];
    for (const c of parsedList) {
      for (const raw of [c.fechaInicio, c.fechaFin]) {
        if (!isAmbiguousDate(raw) || dateMemory.has(raw) || seen.has(raw)) {
          continue;
        }
        seen.add(raw);
        rows.push({ raw, ...ambiguousInterpretations(raw) });
      }
    }
    return rows.sort((a, b) => a.raw.localeCompare(b.raw));
  }, [parsedList, dateMemory]);

  const pendingDatesCount = ambiguousRows.filter(
    (r) => !dateChoices.get(r.raw),
  ).length;

  // Campañas del calendario sin seguimiento previo (necesitan clasificación).
  const needClass = useMemo(() => {
    const out: { nameKey: string; name: string; tipo: string; link: string }[] =
      [];
    const seen = new Set<string>();
    for (const c of resolvedList) {
      const nameKey = campaignIdentity(c);
      if (existingKeys.has(nameKey) || seen.has(nameKey)) continue;
      seen.add(nameKey);
      out.push({ nameKey, name: c.name, tipo: c.tipo, link: c.link });
    }
    return out;
  }, [resolvedList, existingKeys]);

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

  const pendingCount = needClass.filter(
    (k) => !selections.get(k.nameKey),
  ).length;
  const canSave =
    (Boolean(diff?.hasChanges) || needClass.length > 0) &&
    pendingCount === 0 &&
    pendingDatesCount === 0;
  const summary = importSummary(
    diff,
    analysis,
    needClass.length,
    pendingCount + pendingDatesCount,
  );

  function setSelection(nameKey: string, value: ClassChoice) {
    setSelections((prev) => new Map(prev).set(nameKey, value));
  }

  function setDateChoice(raw: string, order: DateOrder) {
    setDateChoices((prev) => new Map(prev).set(raw, order));
  }

  async function saveChanges() {
    if (saving || pendingCount > 0 || pendingDatesCount > 0) return;
    setSaving(true);
    setError(null);
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

      let res = { added: 0, modified: 0, removed: 0 };
      if (diff && diff.hasChanges) {
        res = await applyCampaignChanges(diff, actor);
      }
      const sels: ImportClassificationSelection[] = needClass
        .map((k) => ({
          campaignNameKey: k.nameKey,
          campaignName: k.name,
          classification: selections.get(k.nameKey) as Classification,
          linkValid: isValidDownloadUrl(k.link),
          confirmedReclassify: false,
        }))
        .filter(
          (s) =>
            s.classification === 'institutional' ||
            s.classification === 'provider',
        );
      const track = sels.length
        ? await initializeTrackingForImport(sels, actor)
        : { created: 0, reclassified: 0 };

      const [stored, tracking, resolutions] = await Promise.all([
        listCampaigns(),
        listOperationalTracking(),
        listDateResolutions(),
      ]);
      setStoredCampaigns(stored);
      setDateMemory(resolutions);
      setExistingKeys(new Set(tracking.map((t) => t.campaignNameKey)));
      setSaveNotice(
        `Guardado: ${res.added} nuevas, ${res.removed} eliminadas. Seguimiento inicializado: ${track.created}.`,
      );
    } catch {
      setError('No se pudieron guardar los cambios de campañas.');
    } finally {
      setSaving(false);
    }
  }

  function downloadDiagnosis() {
    if (!analysis) return;
    const blob = new Blob(
      [JSON.stringify({ fileName, analysis, campaigns }, null, 2)],
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
    analysis?.issues.filter((i) => i.severity === 'blocking') ?? [];
  const warnings =
    analysis?.issues.filter((i) => i.severity === 'warning') ?? [];

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

            {ambiguousRows.length > 0 && (
              <AmbiguousDatesPanel
                rows={ambiguousRows}
                choices={dateChoices}
                onChange={setDateChoice}
                pendingCount={pendingDatesCount}
              />
            )}

            {needClass.length > 0 && (
              <ClassificationPanel
                items={needClass}
                selections={selections}
                onChange={setSelection}
                pendingCount={pendingCount}
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
                title="Campañas eliminadas"
                chip={diff.removed.length}
                tone="danger"
                defaultOpen
              >
                <p className="import__note" style={{ marginTop: 0 }}>
                  Estas campañas se eliminarán de la base de datos al guardar.
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

            {campaigns && <CampaignsSection result={campaigns} />}

            {analysis && (
              <FileDiagnosisSection
                analysis={analysis}
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
  onSave,
}: {
  summary: ImportSummary;
  saving: boolean;
  canSave: boolean;
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
        {summary.hasWork ? (
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !canSave}
            title={
              summary.pending > 0
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
