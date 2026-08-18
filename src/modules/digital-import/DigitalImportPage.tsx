import { useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { PageHeader } from '@/components/PageHeader';
import {
  acceptedRows,
  detectConflicts,
  initialDigitalProfiles,
  parseDigitalWorkbook,
  resolutionHash,
  resolveConflict,
  type DigitalConflictGroup,
  type DigitalImportResolution,
  type DigitalParseResult,
} from '@/domain/digital-operations';
import { listDigitalProfiles } from '@/services/digitalCatalog';
import { completeDigitalImport } from '@/services/digitalImportBatches';
import './digital.css';
export function DigitalImportPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<DigitalParseResult | null>(null),
    [profiles, setProfiles] = useState(
      initialDigitalProfiles({ uid: 'preview', email: 'preview' }),
    ),
    [groups, setGroups] = useState<DigitalConflictGroup[]>([]),
    [periods, setPeriods] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' };
  const allowed = !!user && can(user.role, 'digitalOperations.import');
  async function analyze(selected: File) {
    setBusy(true);
    setMessage('');
    try {
      const stored = await listDigitalProfiles();
      const active = stored.length ? stored : profiles;
      setProfiles(active);
      const parsed = parseDigitalWorkbook(await selected.arrayBuffer(), active);
      setResult(parsed);
      setGroups(detectConflicts(parsed.rows));
      setPeriods(parsed.periods.map((p) => p.periodId));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }
  function confirm(group: DigitalConflictGroup) {
    if (!result) return;
    const firstIndex = group.rowIndexes[0];
    if (firstIndex === undefined) return;
    const accepted = [firstIndex];
    const resolution = resolveConflict(
      group,
      group.kind === 'exact-duplicate' ? 'keep-one' : 'choose-primary',
      accepted,
      result.rows,
      'preview',
      actor,
    );
    setGroups((all) => all.map((g) => (g.id === group.id ? resolution : g)));
  }
  async function save() {
    if (!file || !result) return;
    setBusy(true);
    try {
      const accepted = acceptedRows(result.rows, groups),
        resolutions = groups as DigitalImportResolution[];
      const response = await completeDigitalImport({
        file,
        contentHash: result.contentHash,
        resolutionHash: resolutionHash(groups),
        rows: accepted,
        profiles,
        periods: result.periods,
        confirmedPeriodIds: periods,
        resolutions,
        sourceRows: result.sourceRows,
        ignored: result.ignored.length,
        rejected: result.issues.length,
        actor,
      });
      setMessage(
        response.idempotent
          ? `Archivo ya importado en el lote ${response.batch.id}.`
          : `Importación completada: ${response.batch.id}.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const blocked =
    !result ||
    result.issues.some((i) => i.blocking) ||
    !periods.length ||
    groups.some((g) => !g.confirmed);
  return (
    <section>
      <PageHeader
        title="Importación Digital"
        description="Seguimiento Campañas de La Comer y Chedraui · COPETE DIGITAL. Flujo completamente separado de Liverpool y Admira."
      />
      <div className="digital-card">
        <ol className="digital-steps">
          <li>Archivo y esquema</li>
          <li>Catálogo</li>
          <li>Catorcenas</li>
          <li>Duplicados</li>
          <li>Diff y confirmación</li>
        </ol>
        <label className="digital-field">
          Archivo .xlsx
          <input
            type="file"
            accept=".xlsx"
            disabled={!allowed || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                void analyze(f);
              }
            }}
          />
        </label>
        {busy && <p>Procesando…</p>}
        {message && <p role="status">{message}</p>}
      </div>
      {result && (
        <>
          <div className="digital-grid">
            <article className="digital-card">
              <strong>{result.sourceRows}</strong>
              <span>filas origen</span>
            </article>
            <article className="digital-card">
              <strong>{result.rows.length}</strong>
              <span>dentro del catálogo</span>
            </article>
            <article className="digital-card">
              <strong>{result.ignored.length}</strong>
              <span>ignoradas por catálogo</span>
            </article>
            <article className="digital-card">
              <strong>{result.issues.length}</strong>
              <span>incidencias</span>
            </article>
          </div>
          <div className="digital-card">
            <h2>Confirmar catorcenas</h2>
            {result.periods.map((p) => (
              <label key={p.periodId}>
                <input
                  type="checkbox"
                  checked={periods.includes(p.periodId)}
                  onChange={(e) =>
                    setPeriods((v) =>
                      e.target.checked
                        ? [...v, p.periodId]
                        : v.filter((x) => x !== p.periodId),
                    )
                  }
                />
                {p.periodId}: {p.startDate} a {p.endDate}
              </label>
            ))}
          </div>
          <div className="digital-card">
            <h2>Duplicados y conflictos</h2>
            {groups.length === 0 ? (
              <p>Sin grupos duplicados.</p>
            ) : (
              groups.map((g) => (
                <div className="digital-conflict" key={g.id}>
                  <strong>
                    {g.kind === 'exact-duplicate'
                      ? 'Duplicado exacto'
                      : 'Conflicto lógico'}
                  </strong>{' '}
                  · filas{' '}
                  {g.rowIndexes
                    .map((i) => result.rows[i]?.sourceRow)
                    .filter((value) => value !== undefined)
                    .join(', ')}
                  {g.differentFields.length > 0 && (
                    <p>Diferencias: {g.differentFields.join(', ')}</p>
                  )}
                  <button
                    type="button"
                    disabled={g.confirmed}
                    onClick={() => confirm(g)}
                  >
                    {g.confirmed
                      ? 'Resolución confirmada'
                      : 'Confirmar propuesta: conservar una'}
                  </button>
                </div>
              ))
            )}
          </div>
          <button
            className="button-primary"
            disabled={blocked || busy || !allowed}
            onClick={() => void save()}
          >
            Confirmar importación aislada
          </button>
          {blocked && (
            <p>
              No se puede importar hasta confirmar periodos, corregir
              incidencias y resolver todos los grupos.
            </p>
          )}
        </>
      )}
    </section>
  );
}
