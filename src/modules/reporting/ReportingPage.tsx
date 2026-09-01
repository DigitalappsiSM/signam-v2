import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { LoadingState } from '@/components/LoadingState';
import { Icon } from '@/components/Icon';
import { reconciliationStatusLabel } from '@/domain/ekon';
import { presetRange } from '@/modules/dashboard/occupancyModel';
import {
  formatDdMmYyyy,
  parseCampaignDate,
  todayCivil,
} from '@/modules/operational-tracking/businessDays';
import { listCampaigns } from '@/services/campaigns';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';
import { listEkonLinks } from '@/services/campaignEkonLinks';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import { listDigitalTracking } from '@/services/digitalOperationalTracking';
import { listBatches } from '@/services/ekonImports';
import { listReconciliationAssignmentsByEkonNumber } from '@/services/ekonAssignments';
import { listScreens } from '@/services/screens';
import {
  buildReportingModel,
  reportingPercent,
  type ReportingInput,
  type ReportingModel,
  type ReportingRange,
  type WitnessMetric,
} from './reportingModel';
import { exportReportingWorkbook } from './reportingExcelExport';
import './ReportingPage.css';

type Tab = 'executive' | 'operations' | 'quality';
type PeriodPreset = 'this-month' | 'last-3-months' | 'this-year' | 'custom';

const EMPTY_DATA: Omit<ReportingInput, 'range' | 'today'> = {
  campaigns: [],
  screens: [],
  tracking: [],
  digitalItems: [],
  digitalTracking: [],
  ekonLinks: [],
  assignmentsByNumber: new Map(),
  ekonBatches: [],
};

function isoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function reportingRange(preset: PeriodPreset, today: Date): ReportingRange {
  if (preset === 'this-month') return presetRange('this-month', today);
  if (preset === 'this-year') {
    return {
      start: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(today.getUTCFullYear(), 11, 31)),
    };
  }
  if (preset === 'last-3-months') {
    return {
      start: new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1),
      ),
      end: new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
      ),
    };
  }
  return presetRange('this-month', today);
}

async function loadAssignments(numbers: readonly string[]) {
  const result = new Map<
    string,
    Awaited<ReturnType<typeof listReconciliationAssignmentsByEkonNumber>>
  >();
  // Evita disparar decenas de consultas simultáneas contra Firestore.
  for (let index = 0; index < numbers.length; index += 8) {
    const chunk = numbers.slice(index, index + 8);
    const rows = await Promise.all(
      chunk.map((number) => listReconciliationAssignmentsByEkonNumber(number)),
    );
    chunk.forEach((number, offset) => result.set(number, rows[offset] ?? []));
  }
  return result;
}

function MetricCard({
  label,
  value,
  context,
  tone = 'info',
}: {
  label: string;
  value: string | number;
  context: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <article className={`reporting-metric reporting-metric--${tone}`}>
      <span className="reporting-metric__label">{label}</span>
      <strong>{value}</strong>
      <span className="reporting-metric__context">{context}</span>
    </article>
  );
}

function ProgressRow({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percent = reportingPercent(value, total);
  return (
    <div className="reporting-progress">
      <div className="reporting-progress__label">
        <span>{label}</span>
        <strong>
          {value} <small>{percent}%</small>
        </strong>
      </div>
      <div
        className="reporting-progress__track"
        aria-label={`${label}: ${percent}%`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function WitnessCard({
  title,
  metric,
}: {
  title: string;
  metric: WitnessMetric;
}) {
  const completed = metric.onTime + metric.late;
  return (
    <article className="card reporting-sla">
      <div className="reporting-card-title">
        <div>
          <span className="reporting-eyebrow">Campañas de proveedor</span>
          <h3>{title}</h3>
        </div>
        <div className="reporting-sla__score">
          <strong>{metric.compliance}%</strong>
          <span>en tiempo</span>
        </div>
      </div>
      <div className="reporting-sla__grid">
        <span>
          <strong>{metric.onTime}</strong>En tiempo
        </span>
        <span>
          <strong>{metric.late}</strong>Tarde
        </span>
        <span>
          <strong>{metric.overdue}</strong>Vencidos
        </span>
        <span>
          <strong>{metric.pending}</strong>Pendientes
        </span>
      </div>
      <p className="text-muted reporting-note">
        {completed} entregas completadas de {metric.applicable} aplicables.
        {' El cumplimiento excluye obligaciones aún no vencidas.'}
        {metric.invalid > 0 && ` ${metric.invalid} con fecha inválida.`}
      </p>
    </article>
  );
}

function ExecutiveTab({ model }: { model: ReportingModel }) {
  return (
    <>
      <section className="reporting-metrics" aria-label="Resumen ejecutivo">
        <MetricCard
          label="Campañas en alcance"
          value={model.executive.campaigns}
          context={`${model.executive.active} activas · ${model.executive.upcoming} próximas`}
        />
        <MetricCard
          label="Cumplimiento operativo"
          value={`${model.executive.completePct}%`}
          context={`${model.executive.complete} seguimientos completos`}
          tone={model.executive.completePct >= 90 ? 'success' : 'warning'}
        />
        <MetricCard
          label="Atención requerida"
          value={model.executive.withAlerts}
          context={`${model.executive.overdue} con testigos vencidos`}
          tone={model.executive.withAlerts > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Conciliación correcta"
          value={`${model.executive.reconciliationPct}%`}
          context={`${model.reconciliation.reconciled} de ${model.reconciliation.linked} vinculadas`}
          tone={model.reconciliation.blocked > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Operación digital"
          value={`${model.executive.digitalProgress}%`}
          context={`${model.executive.digitalActive} colocaciones activas`}
        />
        <MetricCard
          label="Cobertura"
          value={model.executive.stores}
          context={`${model.executive.supports} soportes · ${model.executive.physicalScreens} pantallas`}
        />
      </section>

      <section className="reporting-two-cols">
        <article className="card">
          <div className="reporting-card-title">
            <div>
              <span className="reporting-eyebrow">Preparación de campañas</span>
              <h2>Embudo operativo</h2>
            </div>
            <Link to="/seguimiento">Ver seguimiento</Link>
          </div>
          <div className="reporting-progress-list">
            {model.funnel.map((stage) => (
              <ProgressRow
                key={stage.key}
                label={stage.label}
                value={stage.value}
                total={stage.total}
              />
            ))}
          </div>
        </article>

        <article className="card">
          <div className="reporting-card-title">
            <div>
              <span className="reporting-eyebrow">Portafolio</span>
              <h2>Distribución del periodo</h2>
            </div>
          </div>
          <div className="reporting-distribution">
            <div>
              <strong>{model.executive.active}</strong>
              <span>Activas</span>
            </div>
            <div>
              <strong>{model.executive.upcoming}</strong>
              <span>Próximas</span>
            </div>
            <div>
              <strong>{model.executive.finished}</strong>
              <span>Terminadas</span>
            </div>
            <div>
              <strong>{model.executive.cancelled}</strong>
              <span>Canceladas</span>
            </div>
          </div>
          <div className="reporting-callout">
            <Icon name="activity" size={20} />
            <p>
              La operación digital reporta{' '}
              <strong>{model.digital.totalCenters}</strong> centros y{' '}
              <strong>{model.digital.totalSupports}</strong> soportes en el
              periodo.
            </p>
          </div>
        </article>
      </section>

      <section className="reporting-two-cols">
        <WitnessCard title="Testigos de arranque" metric={model.sla.start} />
        <WitnessCard title="Testigos completos" metric={model.sla.complete} />
      </section>
    </>
  );
}

function OperationsTab({ model }: { model: ReportingModel }) {
  return (
    <>
      <section className="reporting-two-cols">
        <WitnessCard title="Testigos de arranque" metric={model.sla.start} />
        <WitnessCard title="Testigos completos" metric={model.sla.complete} />
      </section>

      <section className="card reporting-section">
        <div className="reporting-card-title">
          <div>
            <span className="reporting-eyebrow">Control diario</span>
            <h2>Preparación de campañas activas y próximas</h2>
          </div>
        </div>
        <div className="reporting-progress-list reporting-progress-list--wide">
          {model.funnel.map((stage) => (
            <ProgressRow
              key={stage.key}
              label={stage.label}
              value={stage.value}
              total={stage.total}
            />
          ))}
        </div>
      </section>

      <section className="card reporting-section">
        <div className="reporting-card-title">
          <div>
            <span className="reporting-eyebrow">Acción inmediata</span>
            <h2>Campañas con incidencias</h2>
          </div>
          <span className="reporting-count">{model.attention.length}</span>
        </div>
        {model.attention.length === 0 ? (
          <p className="reporting-empty">
            No hay incidencias en el alcance seleccionado.
          </p>
        ) : (
          <div className="reporting-table-wrap">
            <table className="reporting-table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Momento</th>
                  <th>Incidencia</th>
                  <th>Próximo vencimiento</th>
                  <th>Tiendas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {model.attention.map((row) => (
                  <tr key={row.campaignId}>
                    <td>
                      <strong>{row.campaignName}</strong>
                    </td>
                    <td>
                      {row.timeframe === 'active'
                        ? 'Activa'
                        : row.timeframe === 'upcoming'
                          ? 'Próxima'
                          : 'Terminada'}
                    </td>
                    <td>
                      <span className="reporting-issue">{row.issue}</span>
                    </td>
                    <td>{row.deadline ? formatDdMmYyyy(row.deadline) : '—'}</td>
                    <td>{row.stores}</td>
                    <td>
                      <Link
                        to={`/seguimiento?campana=${encodeURIComponent(row.campaignIdentity)}`}
                      >
                        Revisar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function QualityTab({ model }: { model: ReportingModel }) {
  const batch = model.quality.latestEkonBatch;
  return (
    <>
      <section className="reporting-metrics">
        <MetricCard
          label="Sin vínculo EKON"
          value={model.reconciliation.unlinked}
          context="Campañas Liverpool del periodo"
          tone={model.reconciliation.unlinked > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Conciliación bloqueada"
          value={model.reconciliation.blocked}
          context={`${model.reconciliation.incidents} incidencias accionables`}
          tone={model.reconciliation.blocked > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Clasificación pendiente"
          value={model.quality.unclassified}
          context="Sin régimen operativo definido"
          tone={model.quality.unclassified > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Fechas inválidas"
          value={model.quality.invalidDates}
          context="Permanecen visibles para corrección"
          tone={model.quality.invalidDates > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Correcciones manuales"
          value={model.quality.correctedCampaigns}
          context={`${model.quality.correctedFields} campos protegidos`}
        />
        <MetricCard
          label="Ausentes en fuente"
          value={
            model.quality.inactiveCampaigns + model.quality.inactiveDigitalItems
          }
          context={`${model.quality.inactiveCampaigns} Liverpool · ${model.quality.inactiveDigitalItems} digital`}
          tone="warning"
        />
      </section>

      <section className="reporting-two-cols reporting-two-cols--quality">
        <article className="card">
          <div className="reporting-card-title">
            <div>
              <span className="reporting-eyebrow">Frescura de datos</span>
              <h2>Última importación EKON</h2>
            </div>
            <Link to="/importar-ekon">Ver importaciones</Link>
          </div>
          {batch ? (
            <dl className="reporting-definition-list">
              <div>
                <dt>Archivo</dt>
                <dd>{batch.fileName}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{batch.status}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{new Date(batch.createdAt).toLocaleString('es-MX')}</dd>
              </div>
              <div>
                <dt>Filas válidas</dt>
                <dd>{batch.totals.validRows}</dd>
              </div>
              <div>
                <dt>Rechazadas</dt>
                <dd>{batch.totals.rejectedRows}</dd>
              </div>
              <div>
                <dt>Conflictos</dt>
                <dd>{batch.totals.conflictos}</dd>
              </div>
              <div>
                <dt>Modificadas</dt>
                <dd>{batch.totals.modificadas}</dd>
              </div>
              <div>
                <dt>No incluidas</dt>
                <dd>{batch.totals.noIncluidas}</dd>
              </div>
            </dl>
          ) : (
            <p className="reporting-empty">
              No hay importaciones EKON registradas.
            </p>
          )}
        </article>

        <article className="card">
          <div className="reporting-card-title">
            <div>
              <span className="reporting-eyebrow">Resultado general</span>
              <h2>Conciliación Liverpool–EKON</h2>
            </div>
            <Link to="/conciliacion">Abrir conciliación</Link>
          </div>
          <div className="reporting-distribution reporting-distribution--three">
            <div>
              <strong>{model.reconciliation.reconciled}</strong>
              <span>Conciliadas</span>
            </div>
            <div>
              <strong>{model.reconciliation.warnings}</strong>
              <span>Advertencias</span>
            </div>
            <div>
              <strong>{model.reconciliation.blocked}</strong>
              <span>Bloqueadas</span>
            </div>
          </div>
        </article>
      </section>

      <section className="card reporting-section">
        <div className="reporting-card-title">
          <div>
            <span className="reporting-eyebrow">Detalle accionable</span>
            <h2>Campañas vinculadas</h2>
          </div>
          <span className="reporting-count">{model.reconciliation.linked}</span>
        </div>
        {model.reconciliation.rows.length === 0 ? (
          <p className="reporting-empty">
            No hay campañas vinculadas en el periodo.
          </p>
        ) : (
          <div className="reporting-table-wrap">
            <table className="reporting-table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>EKON</th>
                  <th>Estado</th>
                  <th>Cobertura</th>
                  <th>Incidencias</th>
                </tr>
              </thead>
              <tbody>
                {model.reconciliation.rows.map((row) => (
                  <tr key={row.campaign.id}>
                    <td>
                      <strong>{row.campaign.name}</strong>
                    </td>
                    <td>{row.ekonNumber}</td>
                    <td>{reconciliationStatusLabel(row.result.status)}</td>
                    <td>{row.result.coverage}</td>
                    <td>
                      {row.result.issues
                        .map((issue) => issue.message)
                        .join(' · ') || 'Sin incidencias'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function ReportingPage() {
  const today = useMemo(() => todayCivil(), []);
  const [tab, setTab] = useState<Tab>('executive');
  const [preset, setPreset] = useState<PeriodPreset>('this-month');
  const initialRange = useMemo(
    () => reportingRange('this-month', today),
    [today],
  );
  const [customStart, setCustomStart] = useState(isoDate(initialRange.start));
  const [customEnd, setCustomEnd] = useState(isoDate(initialRange.end));
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = useMemo((): ReportingRange => {
    if (preset !== 'custom') return reportingRange(preset, today);
    const start = parseCampaignDate(customStart) ?? initialRange.start;
    const end = parseCampaignDate(customEnd) ?? start;
    return start.getTime() <= end.getTime()
      ? { start, end }
      : { start: end, end: start };
  }, [preset, today, customStart, customEnd, initialRange]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const [
        campaigns,
        screens,
        tracking,
        digitalItems,
        digitalTracking,
        links,
        batches,
      ] = await Promise.all([
        listCampaigns({ includeInactive: true }),
        listScreens(),
        listOperationalTracking(),
        listDigitalOperationalItems(),
        listDigitalTracking(),
        listEkonLinks(),
        listBatches(),
      ]);
      const numbers = [
        ...new Set(links.map((link) => String(link.ekonCampaignNumber))),
      ];
      const assignmentsByNumber = await loadAssignments(numbers);
      setData({
        campaigns,
        screens,
        tracking,
        digitalItems,
        digitalTracking,
        ekonLinks: links,
        assignmentsByNumber,
        ekonBatches: batches,
      });
      setLoadedAt(new Date());
    } catch {
      setError(
        'No se pudo cargar toda la información del reporte. Intenta actualizar nuevamente.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const model = useMemo(
    () => buildReportingModel({ ...data, range, today }),
    [data, range, today],
  );

  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportReportingWorkbook(model);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reporting"
        description="Lectura ejecutiva, control operativo y calidad de datos con las mismas reglas de negocio de SIGNAM."
        actions={
          <div className="reporting-header-actions">
            <button
              className="btn btn-secondary"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <Icon name="activity" size={17} />
              {refreshing ? 'Actualizando…' : 'Actualizar'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void exportExcel()}
              disabled={loading || exporting}
            >
              <Icon name="calendar" size={17} />
              {exporting ? 'Generando…' : 'Exportar Excel'}
            </button>
          </div>
        }
      />

      <section
        className="card reporting-toolbar"
        aria-label="Filtros de reporting"
      >
        <div className="reporting-filter">
          <label htmlFor="reporting-period">Periodo</label>
          <select
            id="reporting-period"
            value={preset}
            onChange={(event) => setPreset(event.target.value as PeriodPreset)}
          >
            <option value="this-month">Mes actual</option>
            <option value="last-3-months">Últimos 3 meses</option>
            <option value="this-year">Año actual</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div className="reporting-filter">
              <label htmlFor="reporting-start">Desde</label>
              <input
                id="reporting-start"
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
              />
            </div>
            <div className="reporting-filter">
              <label htmlFor="reporting-end">Hasta</label>
              <input
                id="reporting-end"
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
              />
            </div>
          </>
        )}
        <div className="reporting-range-label">
          <span>Alcance</span>
          <strong>
            {formatDdMmYyyy(range.start)} — {formatDdMmYyyy(range.end)}
          </strong>
        </div>
        {loadedAt && (
          <span className="reporting-updated">
            Actualizado{' '}
            {loadedAt.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </section>

      <nav className="reporting-tabs" aria-label="Vistas de reporting">
        <button
          className={tab === 'executive' ? 'is-active' : ''}
          onClick={() => setTab('executive')}
        >
          Resumen ejecutivo
        </button>
        <button
          className={tab === 'operations' ? 'is-active' : ''}
          onClick={() => setTab('operations')}
        >
          Operación y SLA
        </button>
        <button
          className={tab === 'quality' ? 'is-active' : ''}
          onClick={() => setTab('quality')}
        >
          Calidad y conciliación
        </button>
      </nav>

      {error && (
        <div className="reporting-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <LoadingState
          variant="process"
          title="Construyendo indicadores…"
          description="Cruzando operación, SLA, calidad y conciliación."
        />
      ) : (
        <div className="reporting-content">
          {tab === 'executive' && <ExecutiveTab model={model} />}
          {tab === 'operations' && <OperationsTab model={model} />}
          {tab === 'quality' && <QualityTab model={model} />}
        </div>
      )}
    </>
  );
}
