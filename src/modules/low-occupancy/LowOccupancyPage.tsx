import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  analyzeLowOccupancy,
  filterUnits,
  todayIsoDate,
} from './occupancyAnalysis';
import { compareOccupancy, previousCivilDate } from './occupancyComparison';
import type { GroupComparison } from './occupancyComparison';
import { buildRatioCsv } from './occupancyCsv';
import { EMPTY_FILTERS } from './types';
import type {
  OccupancyExportGroup,
  OccupancyFilters as Filters,
  OccupancyUnit,
} from './types';
import { OccupancySummary } from './components/OccupancySummary';
import { OccupancyFilters } from './components/OccupancyFilters';
import { OccupancyTable } from './components/OccupancyTable';
import { OccupancyDetail } from './components/OccupancyDetail';
import { OccupancyChangeDetail } from './components/OccupancyChangeDetail';
import { OccupancyExportGroups } from './components/OccupancyExportGroups';
import '@/modules/admira-catalog/CatalogPage.css';
import '@/modules/liverpool-import/ImportPage.css';
import './LowOccupancyPage.css';

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Valida el formato AAAA-MM-DD. */
function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Página "Alertas de baja ocupación": detecta pantallas con baja variedad de
 * proveedores para una fecha civil y genera los CSV auxiliares Ratio 1 / Ratio 3
 * agrupados por normalización + resolución.
 */
export function LowOccupancyPage() {
  const { user } = useAuth();
  // Info 100% operativa: cualquier usuario autenticado puede descargar estos
  // CSV (ver `export.occupancyCsv` en la matriz de permisos).
  const canExport = user ? can(user.role, 'export.occupancyCsv') : false;

  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = useMemo(() => {
    const q = searchParams.get('fecha');
    return q && isIsoDate(q) ? q : todayIsoDate();
    // Solo en el montaje inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [analysisDate, setAnalysisDate] = useState(initialDate);
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [detail, setDetail] = useState<OccupancyUnit | null>(null);
  const [changeDetail, setChangeDetail] = useState<GroupComparison | null>(
    null,
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s] = await Promise.all([listCampaigns(), listScreens()]);
      setCampaigns(c);
      setScreens(s);
    } catch {
      setError('No se pudieron cargar las campañas o el catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Sincroniza la fecha con el parámetro `?fecha=` (deep link).
  useEffect(() => {
    const current = searchParams.get('fecha');
    if (current !== analysisDate) {
      const next = new URLSearchParams(searchParams);
      next.set('fecha', analysisDate);
      setSearchParams(next, { replace: true });
    }
  }, [analysisDate, searchParams, setSearchParams]);

  const analysis = useMemo(
    () => analyzeLowOccupancy({ campaigns, screens, analysisDate }),
    [campaigns, screens, analysisDate],
  );

  // Comparación contra el día calendario anterior con los MISMOS datos cargados
  // (opción sin persistencia): reconstruye la fecha anterior para señalar si el
  // resultado cambió y evitar cargar archivos idénticos en Admira. Ver la
  // limitación documentada en `occupancyComparison.ts`.
  const previousDate = useMemo(
    () => previousCivilDate(analysisDate),
    [analysisDate],
  );
  const previousAnalysis = useMemo(
    () =>
      analyzeLowOccupancy({ campaigns, screens, analysisDate: previousDate }),
    [campaigns, screens, previousDate],
  );
  const comparison = useMemo(
    () => compareOccupancy(analysis, previousAnalysis),
    [analysis, previousAnalysis],
  );

  const normalizations = useMemo(
    () => [...new Set(analysis.units.map((u) => u.normalization))].sort(),
    [analysis],
  );
  const resolutions = useMemo(
    () => [...new Set(analysis.units.map((u) => u.resolution))].sort(),
    [analysis],
  );

  const filtered = useMemo(
    () => filterUnits(analysis.units, filters),
    [analysis, filters],
  );

  const filtersActive = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS),
    [filters],
  );

  function patchFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
  }

  function downloadRatio(group: OccupancyExportGroup, ratio: 1 | 3) {
    const csv = buildRatioCsv(group, ratio, {
      analysisDate,
      generatedDate: todayIsoDate(),
    });
    if (!csv) return; // no se descargan archivos vacíos
    download(csv.content, csv.fileName);
  }

  function viewZero(group: OccupancyExportGroup) {
    // "Ver alertas" filtra por NIVEL `sin-ocupacion` (las unidades sin
    // proveedores conservan ese nivel aunque pertenezcan a Ratio 3).
    setFilters({
      ...EMPTY_FILTERS,
      normalization: group.normalization,
      resolution: group.resolution,
      level: 'sin-ocupacion',
    });
  }

  return (
    <>
      <PageHeader
        title="Alertas de baja ocupación"
        description="Detecta pantallas con baja variedad de proveedores para una fecha y genera CSV para Ratio 1 y Ratio 3. La carga final en Admira sigue siendo manual; SIGNAM no administra los contenidos institucionales."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => void reload()}
            aria-busy={loading}
          >
            Recalcular
          </button>
        }
      />

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      <div className="occ-controls">
        <label className="campaign-date">
          <span className="text-muted">Fecha de análisis</span>
          <input
            type="date"
            aria-label="Fecha de análisis"
            value={analysisDate}
            onChange={(e) => {
              if (isIsoDate(e.target.value)) setAnalysisDate(e.target.value);
            }}
          />
        </label>
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          Análisis vigente para <strong>{analysisDate}</strong>. Solo cuentan
          los proveedores vigentes en esa fecha. Cada tarjeta se compara con el
          día calendario anterior para señalar si el resultado cambió.
        </span>
      </div>

      {loading ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <>
          <OccupancySummary summary={analysis.summary} />

          <h2 className="occ-section-title">
            Exportaciones (Ratio 1 / Ratio 3)
          </h2>
          <OccupancyExportGroups
            groups={analysis.groups}
            canExport={canExport}
            comparison={comparison}
            onDownload={downloadRatio}
            onViewZero={viewZero}
            onViewChanges={setChangeDetail}
          />

          <h2 className="occ-section-title">Unidades evaluadas</h2>
          <OccupancyFilters
            filters={filters}
            normalizations={normalizations}
            resolutions={resolutions}
            onChange={patchFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
            active={filtersActive}
          />
          <p className="text-muted occ-count">
            {filtersActive
              ? `${filtered.length} de ${analysis.units.length} unidades`
              : `${analysis.units.length} unidades evaluadas`}
          </p>
          <OccupancyTable units={filtered} onSelect={setDetail} />
        </>
      )}

      {detail && (
        <OccupancyDetail unit={detail} onClose={() => setDetail(null)} />
      )}

      {changeDetail && (
        <OccupancyChangeDetail
          comparison={changeDetail}
          selectedDate={analysisDate}
          previousDate={previousDate}
          onClose={() => setChangeDetail(null)}
        />
      )}
    </>
  );
}
