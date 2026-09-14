import type { AdmiraScreen } from '@/domain';

export type AdmiraRatio = 1 | 3;
export type AdmiraRiskLevel = 'critical' | 'warning' | 'healthy';

export interface AdmiraPassRow {
  sourceRow: number;
  player: string;
  descriptiveName: string;
  date: string;
  campaign: string;
  content: string;
  ratio: AdmiraRatio;
  schedule: string;
  passes: number;
  passesMin: number;
  passesMax: number;
  passesRaw: string;
}

export interface AdmiraPassIssue {
  row: number | null;
  code: string;
  message: string;
}

export interface AdmiraPassParseResult {
  rows: AdmiraPassRow[];
  issues: AdmiraPassIssue[];
  headerRow: number | null;
  dates: string[];
  players: string[];
}

export interface AdmiraPassContent {
  key: string;
  campaign: string;
  content: string;
  ratio: AdmiraRatio;
  passes: number;
  passesMin: number;
  passesMax: number;
  schedules: string[];
  sourceRows: number[];
}

export type AdmiraCatalogMatch = 'exact' | 'duplicate' | 'inactive' | 'missing';

export interface AdmiraPassAnalysisUnit {
  key: string;
  player: string;
  date: string;
  descriptiveName: string;
  catalogMatch: AdmiraCatalogMatch;
  screenId: string | null;
  storeNumber: string;
  storeName: string;
  model: string;
  normalization: string;
  ratio1Contents: AdmiraPassContent[];
  ratio3Contents: AdmiraPassContent[];
  evaluatedRatio: AdmiraRatio | null;
  evaluatedContents: AdmiraPassContent[];
  contentCount: number;
  totalPasses: number;
  minimumPasses: number;
  maximumPasses: number;
  maximumShare: number;
  level: AdmiraRiskLevel;
  reasons: string[];
}

export interface AdmiraPassAnalysis {
  units: AdmiraPassAnalysisUnit[];
  dates: string[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    healthy: number;
    missingPlayers: number;
  };
}

const REQUIRED_HEADERS = {
  player: ['NOMBRE'],
  date: ['DIA'],
  campaign: ['CAMPANA'],
  content: ['CONTENIDOS'],
  category: ['CATEGORIA'],
  passes: ['PASES_SLOTS_EN_USO'],
} as const;

function repairMojibake(value: string): string {
  if (!/[ÃÂ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(
      [...value].map((character) => character.charCodeAt(0)),
    );
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return repaired.includes('�') ? value : repaired;
  } catch {
    return value;
  }
}

function cleanText(value: unknown): string {
  return repairMojibake(String(value ?? ''))
    .trim()
    .replace(/\s+/g, ' ');
}

function headerKey(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findHeaderRow(grid: readonly (readonly unknown[])[]): number | null {
  const limit = Math.min(grid.length, 25);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const keys = new Set((grid[rowIndex] ?? []).map(headerKey));
    const complete = Object.values(REQUIRED_HEADERS).every((aliases) =>
      aliases.some((alias) => keys.has(alias)),
    );
    if (complete) return rowIndex;
  }
  return null;
}

function excelSerialToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseCivilDate(value: unknown): string | null {
  if (typeof value === 'number') return excelSerialToIso(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!local) return null;
  const [, day, month, year] = local;
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parsePasses(value: unknown): {
  average: number;
  minimum: number;
  maximum: number;
  raw: string;
} | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      average: value,
      minimum: value,
      maximum: value,
      raw: String(value),
    };
  }
  const raw = cleanText(value);
  const values = raw
    .split('|')
    .map((part) => Number(part.replace(/,/g, '').trim()))
    .filter(Number.isFinite);
  if (values.length === 0) return null;
  return {
    average: values.reduce((sum, item) => sum + item, 0) / values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    raw,
  };
}

function ratioFromCategory(value: unknown): AdmiraRatio | null {
  const category = headerKey(value);
  if (category === 'PUBLICIDAD_TIPO_1') return 1;
  if (category === 'PUBLICIDAD_TIPO_3') return 3;
  return null;
}

/**
 * Convierte la hoja de detalle de ocupación de Admira en filas tipadas. No
 * normaliza nombres de campaña ni contenido: conserva sus valores literales.
 */
export function parseAdmiraPassesGrid(
  grid: readonly (readonly unknown[])[],
): AdmiraPassParseResult {
  const issues: AdmiraPassIssue[] = [];
  const headerRow = findHeaderRow(grid);
  if (headerRow === null) {
    return {
      rows: [],
      issues: [
        {
          row: null,
          code: 'missing-headers',
          message:
            'No se encontró la hoja de detalle con Nombre, Día, Campaña, Contenidos, Categoría y Pases/Slots en uso.',
        },
      ],
      headerRow: null,
      dates: [],
      players: [],
    };
  }

  const headers = (grid[headerRow] ?? []).map(headerKey);
  const index = new Map(headers.map((header, column) => [header, column]));
  const column = (field: keyof typeof REQUIRED_HEADERS): number => {
    const alias = REQUIRED_HEADERS[field].find((candidate) =>
      index.has(candidate),
    );
    return alias === undefined ? -1 : (index.get(alias) ?? -1);
  };
  const columns = {
    player: column('player'),
    descriptiveName: index.get('NOMBRE_DESCRIPTIVO') ?? -1,
    date: column('date'),
    campaign: column('campaign'),
    content: column('content'),
    category: column('category'),
    schedule: index.get('HORARIO') ?? -1,
    passes: column('passes'),
  };

  const rows: AdmiraPassRow[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex += 1) {
    const source = grid[rowIndex] ?? [];
    const player = cleanText(source[columns.player]);
    if (!player) continue;
    const date = parseCivilDate(source[columns.date]);
    const campaign = cleanText(source[columns.campaign]);
    const content = cleanText(source[columns.content]);
    const ratio = ratioFromCategory(source[columns.category]);
    const passes = parsePasses(source[columns.passes]);
    const sourceRow = rowIndex + 1;

    if (!date || !campaign || !content || !ratio || !passes) {
      const missing = [
        !date && 'fecha',
        !campaign && 'campaña',
        !content && 'contenido',
        !ratio && 'categoría',
        !passes && 'pases en uso',
      ].filter(Boolean);
      issues.push({
        row: sourceRow,
        code: 'invalid-row',
        message: `Fila omitida: ${missing.join(', ')} no válido.`,
      });
      continue;
    }

    rows.push({
      sourceRow,
      player,
      descriptiveName: cleanText(source[columns.descriptiveName]) || player,
      date,
      campaign,
      content,
      ratio,
      schedule: cleanText(source[columns.schedule]),
      passes: passes.average,
      passesMin: passes.minimum,
      passesMax: passes.maximum,
      passesRaw: passes.raw,
    });
  }

  return {
    rows,
    issues,
    headerRow: headerRow + 1,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    players: [...new Set(rows.map((row) => row.player))].sort(),
  };
}

function aggregateContents(
  rows: readonly AdmiraPassRow[],
  ratio: AdmiraRatio,
): AdmiraPassContent[] {
  const index = new Map<string, AdmiraPassContent>();
  for (const row of rows) {
    if (row.ratio !== ratio) continue;
    const key = `${row.campaign}\u0000${row.content}`;
    const current = index.get(key);
    if (current) {
      current.passes += row.passes;
      current.passesMin += row.passesMin;
      current.passesMax += row.passesMax;
      if (row.schedule && !current.schedules.includes(row.schedule)) {
        current.schedules.push(row.schedule);
      }
      current.sourceRows.push(row.sourceRow);
    } else {
      index.set(key, {
        key,
        campaign: row.campaign,
        content: row.content,
        ratio,
        passes: row.passes,
        passesMin: row.passesMin,
        passesMax: row.passesMax,
        schedules: row.schedule ? [row.schedule] : [],
        sourceRows: [row.sourceRow],
      });
    }
  }
  return [...index.values()].sort(
    (a, b) => b.passes - a.passes || a.campaign.localeCompare(b.campaign),
  );
}

function classify(
  contents: readonly AdmiraPassContent[],
): Pick<
  AdmiraPassAnalysisUnit,
  | 'contentCount'
  | 'totalPasses'
  | 'minimumPasses'
  | 'maximumPasses'
  | 'maximumShare'
  | 'level'
  | 'reasons'
> {
  const contentCount = contents.length;
  const totalPasses = contents.reduce((sum, item) => sum + item.passes, 0);
  const minimumPasses = contentCount
    ? Math.min(...contents.map((item) => item.passes))
    : 0;
  const maximumPasses = contentCount
    ? Math.max(...contents.map((item) => item.passes))
    : 0;
  const maximumShare = totalPasses > 0 ? maximumPasses / totalPasses : 0;
  const reasons: string[] = [];

  if (contentCount === 0) reasons.push('No hay contenidos programados.');
  if (contentCount > 0 && contentCount <= 2) {
    reasons.push(
      `Solo hay ${contentCount} contenido${contentCount === 1 ? '' : 's'}.`,
    );
  }
  if (contentCount === 3)
    reasons.push('Hay 3 contenidos; requiere vigilancia.');
  if (maximumShare > 0.35) {
    reasons.push(
      `Un contenido concentra ${(maximumShare * 100).toFixed(0)} % de los pases.`,
    );
  }
  if (minimumPasses > 0 && minimumPasses <= 15) {
    reasons.push('Existe un contenido con 15 pases por hora o menos.');
  }

  let level: AdmiraRiskLevel = 'healthy';
  if (contentCount <= 2 || maximumShare > 0.35) level = 'critical';
  else if (contentCount === 3 || (minimumPasses > 0 && minimumPasses <= 15)) {
    level = 'warning';
  }

  return {
    contentCount,
    totalPasses,
    minimumPasses,
    maximumPasses,
    maximumShare,
    level,
    reasons,
  };
}

/**
 * Analiza el reporte real/programado de Admira por player y día. Si existe
 * contenido Ratio 1, ese bloque se evalúa por separado: Ratio 3 no compensa la
 * repetición comercial. Si no existe Ratio 1, se evalúa la variedad de Ratio 3.
 */
export function analyzeAdmiraPasses(
  rows: readonly AdmiraPassRow[],
  screens: readonly AdmiraScreen[],
): AdmiraPassAnalysis {
  const screensByPlayer = new Map<string, AdmiraScreen[]>();
  for (const screen of screens) {
    const player = screen.original['Nombre en plataforma'].trim();
    if (!player) continue;
    const found = screensByPlayer.get(player) ?? [];
    found.push(screen);
    screensByPlayer.set(player, found);
  }

  const grouped = new Map<string, AdmiraPassRow[]>();
  for (const row of rows) {
    const key = `${row.player}\u0000${row.date}`;
    const found = grouped.get(key) ?? [];
    found.push(row);
    grouped.set(key, found);
  }

  const units: AdmiraPassAnalysisUnit[] = [];
  for (const [key, groupRows] of grouped) {
    const first = groupRows[0];
    if (!first) continue;
    const catalog = screensByPlayer.get(first.player) ?? [];
    const active = catalog.filter((screen) => screen.metadata.active);
    const screen = active[0] ?? catalog[0] ?? null;
    const catalogMatch: AdmiraCatalogMatch =
      catalog.length === 0
        ? 'missing'
        : active.length === 0
          ? 'inactive'
          : active.length > 1
            ? 'duplicate'
            : 'exact';
    const ratio1Contents = aggregateContents(groupRows, 1);
    const ratio3Contents = aggregateContents(groupRows, 3);
    const evaluatedRatio: AdmiraRatio | null =
      ratio1Contents.length > 0 ? 1 : 3;
    const evaluatedContents =
      evaluatedRatio === 1 ? ratio1Contents : ratio3Contents;
    const metrics = classify(evaluatedContents);
    const reasons = [...metrics.reasons];
    let level = metrics.level;
    if (catalogMatch !== 'exact') {
      reasons.push(
        catalogMatch === 'missing'
          ? 'El player no existe en el catálogo Admira de Signam.'
          : catalogMatch === 'inactive'
            ? 'El player está inactivo en el catálogo Admira de Signam.'
            : 'El player aparece duplicado en el catálogo Admira de Signam.',
      );
      if (level === 'healthy') level = 'warning';
    }
    if (reasons.length === 0) reasons.push('Variedad y reparto saludables.');

    units.push({
      key,
      player: first.player,
      date: first.date,
      descriptiveName: first.descriptiveName,
      catalogMatch,
      screenId: screen?.id ?? null,
      storeNumber: screen?.original['Numero de Tienda'] ?? '',
      storeName: screen?.original['Nombre de tienda'] ?? '',
      model: screen?.original.Modelo ?? '',
      normalization: screen?.metadata.calendarSupport ?? '',
      ratio1Contents,
      ratio3Contents,
      evaluatedRatio,
      evaluatedContents,
      ...metrics,
      level,
      reasons,
    });
  }

  const severity = { critical: 0, warning: 1, healthy: 2 } as const;
  units.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      severity[a.level] - severity[b.level] ||
      a.player.localeCompare(b.player),
  );
  return {
    units,
    dates: [...new Set(units.map((unit) => unit.date))].sort(),
    summary: {
      total: units.length,
      critical: units.filter((unit) => unit.level === 'critical').length,
      warning: units.filter((unit) => unit.level === 'warning').length,
      healthy: units.filter((unit) => unit.level === 'healthy').length,
      missingPlayers: units.filter((unit) => unit.catalogMatch !== 'exact')
        .length,
    },
  };
}
