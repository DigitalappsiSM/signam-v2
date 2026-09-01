import type { AdmiraScreen } from '@/domain';
import type {
  DigitalOperationalItem,
  DigitalOperationalTracking,
} from '@/domain/digital-operations';
import { buildDigitalDashboard } from '@/domain/digital-operations';
import type { EkonImportBatch, StoredEkonAssignment } from '@/domain/ekon';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  buildTrackingRows,
  criticalAlerts,
  effectiveChecks,
  isFullyTracked,
  type TrackingRow,
} from '@/modules/operational-tracking/trackingModel';
import {
  parseCampaignDate,
  todayCivil,
} from '@/modules/operational-tracking/businessDays';
import type { WitnessStatus } from '@/modules/operational-tracking/operationalStatus';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import {
  buildReconciliationRows,
  reconciliationIncidentCount,
  summarizeReconciliation,
  type ReconciliationRow,
} from '@/modules/reconciliation/reconciliationView';
import {
  ekonNumberForCampaign,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';

export interface ReportingRange {
  start: Date;
  end: Date;
}

export interface ReportingInput {
  campaigns: readonly StoredCampaign[];
  screens: readonly AdmiraScreen[];
  tracking: readonly CampaignOperationalTracking[];
  digitalItems: readonly DigitalOperationalItem[];
  digitalTracking: readonly DigitalOperationalTracking[];
  ekonLinks: readonly CampaignEkonLink[];
  assignmentsByNumber: ReadonlyMap<string, StoredEkonAssignment[]>;
  ekonBatches: readonly EkonImportBatch[];
  range: ReportingRange;
  today?: Date;
}

export interface FunnelStage {
  key: 'received' | 'link' | 'validation' | 'programming';
  label: string;
  value: number;
  total: number;
}

export interface WitnessMetric {
  applicable: number;
  onTime: number;
  late: number;
  overdue: number;
  pending: number;
  invalid: number;
  compliance: number;
}

export interface AttentionRow {
  campaignId: string;
  campaignIdentity: string;
  campaignName: string;
  timeframe: TrackingRow['timeframe'];
  classification: TrackingRow['classification'];
  issue: string;
  deadline: Date | null;
  stores: number;
  supports: number;
}

export interface ReportingModel {
  range: ReportingRange;
  generatedAt: number;
  executive: {
    campaigns: number;
    active: number;
    upcoming: number;
    finished: number;
    complete: number;
    completePct: number;
    withAlerts: number;
    overdue: number;
    cancelled: number;
    stores: number;
    supports: number;
    physicalScreens: number;
    digitalActive: number;
    digitalProgress: number;
    reconciliationPct: number;
  };
  funnel: FunnelStage[];
  sla: {
    start: WitnessMetric;
    complete: WitnessMetric;
  };
  attention: AttentionRow[];
  digital: ReturnType<typeof buildDigitalDashboard>;
  reconciliation: {
    rows: ReconciliationRow[];
    linked: number;
    unlinked: number;
    reconciled: number;
    warnings: number;
    blocked: number;
    incidents: number;
  };
  quality: {
    inactiveCampaigns: number;
    invalidDates: number;
    unclassified: number;
    correctedCampaigns: number;
    correctedFields: number;
    inactiveDigitalItems: number;
    latestEkonBatch: EkonImportBatch | null;
  };
  trackingRows: TrackingRow[];
}

function civilTime(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function overlapsRange(
  startText: string,
  endText: string,
  range: ReportingRange,
): boolean {
  const start = parseCampaignDate(startText);
  const end = parseCampaignDate(endText);
  // Los registros con fechas inválidas permanecen visibles para no ocultar el
  // problema dentro del reporte de calidad.
  if (!start || !end) return true;
  return (
    civilTime(start) <= civilTime(range.end) &&
    civilTime(end) >= civilTime(range.start)
  );
}

function digitalOverlapsRange(
  item: DigitalOperationalItem,
  range: ReportingRange,
): boolean {
  return overlapsRange(item.periodStart, item.periodEnd, range);
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function witnessMetric(
  rows: readonly TrackingRow[],
  pick: (row: TrackingRow) => WitnessStatus,
): WitnessMetric {
  const statuses = rows.map(pick);
  const onTime = statuses.filter((s) => s === 'completed-on-time').length;
  const late = statuses.filter((s) => s === 'completed-late').length;
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const invalid = statuses.filter((s) => s === 'invalid-date').length;
  const pending = statuses.filter(
    (s) =>
      s === 'upcoming' ||
      s === 'on-track' ||
      s === 'due-soon' ||
      s === 'due-today',
  ).length;
  const eligible = onTime + late + overdue;
  return {
    applicable: statuses.length,
    onTime,
    late,
    overdue,
    pending,
    invalid,
    compliance: pct(onTime, eligible),
  };
}

function attentionRows(rows: readonly TrackingRow[]): AttentionRow[] {
  return rows
    .map((row): AttentionRow | null => {
      const alerts = criticalAlerts(row);
      if (alerts.length === 0) return null;
      return {
        campaignId: row.campaign.id,
        campaignIdentity: row.identity,
        campaignName: row.campaign.name,
        timeframe: row.timeframe,
        classification: row.classification,
        issue: alerts.map((alert) => alert.label).join(' · '),
        deadline: row.nextDeadline,
        stores: row.distinctStores,
        supports: new Set(
          row.campaign.supports.map((support) => support.support),
        ).size,
      };
    })
    .filter((row): row is AttentionRow => row !== null)
    .sort((a, b) => {
      const aDeadline = a.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDeadline = b.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return (
        aDeadline - bDeadline || a.campaignName.localeCompare(b.campaignName)
      );
    });
}

export function buildReportingModel(input: ReportingInput): ReportingModel {
  const now = input.today ?? todayCivil();
  const activeCampaigns = input.campaigns.filter(
    (campaign) =>
      campaign.active !== false &&
      overlapsRange(campaign.fechaInicio, campaign.fechaFin, input.range),
  );
  const trackingRows = buildTrackingRows(
    activeCampaigns,
    input.screens,
    input.tracking,
    now,
  );
  const applicable = trackingRows.filter(
    (row) => row.lifecycleStatus !== 'cancelled',
  );
  const cancelled = trackingRows.length - applicable.length;
  const accountable = applicable.filter((row) => row.timeframe !== 'upcoming');
  const complete = accountable.filter(isFullyTracked);
  const withAlerts = applicable.filter((row) => criticalAlerts(row).length > 0);
  const overdue = applicable.filter(
    (row) => row.startStatus === 'overdue' || row.completeStatus === 'overdue',
  );
  const readinessRows = applicable.filter(
    (row) => row.timeframe !== 'finished',
  );
  const checkCounts = readinessRows.reduce(
    (counts, row) => {
      const checks = effectiveChecks(row);
      if (checks.link) counts.link += 1;
      if (checks.liverpool) counts.validation += 1;
      if (checks.csm) counts.programming += 1;
      return counts;
    },
    { link: 0, validation: 0, programming: 0 },
  );
  const funnelTotal = readinessRows.length;
  const funnel: FunnelStage[] = [
    {
      key: 'received',
      label: 'Recibidas',
      value: funnelTotal,
      total: funnelTotal,
    },
    {
      key: 'link',
      label: 'Con link',
      value: checkCounts.link,
      total: funnelTotal,
    },
    {
      key: 'validation',
      label: 'Validadas',
      value: checkCounts.validation,
      total: funnelTotal,
    },
    {
      key: 'programming',
      label: 'Programadas',
      value: checkCounts.programming,
      total: funnelTotal,
    },
  ];

  const providerRows = applicable.filter(
    (row) => row.classification === 'provider',
  );

  const scopedDigitalItems = input.digitalItems.filter((item) =>
    digitalOverlapsRange(item, input.range),
  );
  const digital = buildDigitalDashboard(
    scopedDigitalItems,
    input.digitalTracking,
  );

  const assignments = input.assignmentsByNumber;
  const reconciliationRows = buildReconciliationRows(
    activeCampaigns,
    input.ekonLinks,
    assignments,
  );
  const reconciliationSummary = summarizeReconciliation(reconciliationRows);
  const reconciled = reconciliationSummary.conciliadas;
  const linked = reconciliationRows.length;
  const unlinked = activeCampaigns.filter(
    (campaign) => ekonNumberForCampaign(campaign, input.ekonLinks) === null,
  ).length;
  const incidents = reconciliationRows.reduce(
    (total, row) => total + reconciliationIncidentCount(row),
    0,
  );

  const stores = new Set<string>();
  const supports = new Set<string>();
  for (const campaign of activeCampaigns) {
    for (const support of campaign.supports) {
      supports.add(support.support.trim().toLowerCase());
      for (const store of support.stores) stores.add(store.numero.trim());
    }
  }
  const correctedCampaigns = activeCampaigns.filter(
    (campaign) => Object.keys(campaign.manualOverrides ?? {}).length > 0,
  );
  const ekonBatches = [...input.ekonBatches].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  return {
    range: input.range,
    generatedAt: Date.now(),
    executive: {
      campaigns: applicable.length,
      active: applicable.filter((row) => row.timeframe === 'active').length,
      upcoming: applicable.filter((row) => row.timeframe === 'upcoming').length,
      finished: applicable.filter((row) => row.timeframe === 'finished').length,
      complete: complete.length,
      completePct: pct(complete.length, accountable.length),
      withAlerts: withAlerts.length,
      overdue: overdue.length,
      cancelled,
      stores: stores.size,
      supports: supports.size,
      physicalScreens: input.screens.filter((screen) => screen.metadata.active)
        .length,
      digitalActive: digital.activeItems,
      digitalProgress: Math.round(digital.averageProgress * 100),
      reconciliationPct: pct(reconciled, linked),
    },
    funnel,
    sla: {
      start: witnessMetric(providerRows, (row) => row.startStatus),
      complete: witnessMetric(providerRows, (row) => row.completeStatus),
    },
    attention: attentionRows(applicable),
    digital,
    reconciliation: {
      rows: reconciliationRows,
      linked,
      unlinked,
      reconciled,
      warnings: reconciliationSummary.advertencias,
      blocked: reconciliationSummary.error,
      incidents,
    },
    quality: {
      inactiveCampaigns: input.campaigns.filter(
        (campaign) =>
          campaign.active === false &&
          overlapsRange(campaign.fechaInicio, campaign.fechaFin, input.range),
      ).length,
      invalidDates: activeCampaigns.filter(
        (campaign) =>
          !parseCampaignDate(campaign.fechaInicio) ||
          !parseCampaignDate(campaign.fechaFin),
      ).length,
      unclassified: trackingRows.filter(
        (row) => row.classification === 'unknown',
      ).length,
      correctedCampaigns: correctedCampaigns.length,
      correctedFields: correctedCampaigns.reduce(
        (total, campaign) =>
          total + Object.keys(campaign.manualOverrides ?? {}).length,
        0,
      ),
      inactiveDigitalItems: scopedDigitalItems.filter((item) => !item.active)
        .length,
      latestEkonBatch: ekonBatches[0] ?? null,
    },
    trackingRows,
  };
}

export function reportingPercent(value: number, total: number): number {
  return pct(value, total);
}
