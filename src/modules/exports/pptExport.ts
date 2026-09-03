import type PptxGenJS from 'pptxgenjs';
import {
  normalizeSupport,
  GUADALAJARA_GALERIAS_EXCEPTION,
  type AdmiraScreen,
} from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import {
  effectiveCampaignSupportScope,
  type CampaignSupport,
} from '@/modules/liverpool-import/campaignParse';
import {
  parseCampaignDate,
  formatDdMmYyyy,
  formatCivilString,
} from '@/modules/operational-tracking/businessDays';
import {
  LIVERPOOL_LOGO_DATA_URL,
  INSTORE_MEDIA_LOGO_DATA_URL,
} from '@/assets/ppt/logos';

/**
 * Exportación de PPTX de evidencias fotográficas por campaña.
 *
 * Dos responsabilidades separadas:
 *  - `buildCampaignPptPlan` (PURO): cruza calendario ↔ catálogo y produce el plan
 *    de diapositivas + incidencias, sin dependencias de UI ni de la librería PPT.
 *  - `buildCampaignPpt` (serialización): dibuja el plan con PptxGenJS (import
 *    dinámico) y devuelve un Blob `.pptx` con formas y textos editables.
 *
 * A diferencia del CSV, la PPT incluye TODOS los soportes (incluidos InStore
 * Media). Por eso NO se reutilizan `result.consolidations` (que excluyen ISM y
 * agrupan por resolución); se hace un cruce propio, deduplicando por `screen.id`.
 */

const norm = normalizeSupport;

/** Fallback de ARTÍCULOS para soportes InStore Media (sin catálogo propio). */
export const INSTORE_ARTICULOS_FALLBACK =
  'No disponible — soporte InStore Media';

export type SlideOwner = 'liverpool' | 'instore-media';

export interface PptEvidenceSlide {
  /** Clave estable: `screen.id` (Liverpool) o `ism|tienda|soporte` (InStore). */
  key: string;
  storeNumber: string;
  storeName: string;
  /** Texto literal de la columna de soporte del calendario. */
  requestedSupport: string;
  /** Normalización Liverpool (`screen.metadata.calendarSupport`). */
  calendarSupport: string;
  articulos: string;
  owner: SlideOwner;
}

export type PptIssueKind =
  | 'store-not-in-catalog'
  | 'store-support-mismatch'
  | 'only-inactive'
  | 'invalid-store-scope'
  | 'assigned-no-active-screens'
  | 'instore-assigned-no-comment'
  | 'instore-store-no-name'
  | 'missing-start-date'
  | 'missing-end-date';

export interface PptEvidenceIssue {
  kind: PptIssueKind;
  support?: string;
  storeNumber?: string;
  message: string;
}

export interface CampaignPptPlan {
  campaignName: string;
  startDate: string;
  endDate: string;
  slides: PptEvidenceSlide[];
  issues: PptEvidenceIssue[];
}

/** Entrada mínima del plan (compatible con `StoredCampaign`). */
export interface PptCampaignInput {
  name: string;
  fechaInicio: string;
  fechaFin: string;
  supports: readonly CampaignSupport[];
}

interface ScreenIndex {
  /** `norm(soporte)|tienda` → pantallas activas. */
  active: Map<string, AdmiraScreen[]>;
  /** `norm(soporte)|tienda` → pantallas inactivas. */
  inactive: Map<string, AdmiraScreen[]>;
  /** tienda normalizada → pantallas activas (Guadalajara y expansión por tienda). */
  activeByStore: Map<string, AdmiraScreen[]>;
  /** `norm(soporte)` → pantallas activas (expansión "asignada sin comentario"). */
  activeBySupport: Map<string, AdmiraScreen[]>;
  /** tienda normalizada → nombre oficial (cualquier registro del catálogo). */
  nameByStore: Map<string, string>;
  /** tiendas (normalizadas) presentes en el catálogo. */
  allStores: Set<string>;
}

function push(map: Map<string, AdmiraScreen[]>, k: string, s: AdmiraScreen) {
  const list = map.get(k);
  if (list) list.push(s);
  else map.set(k, [s]);
}

function buildIndex(screens: readonly AdmiraScreen[]): ScreenIndex {
  const active = new Map<string, AdmiraScreen[]>();
  const inactive = new Map<string, AdmiraScreen[]>();
  const activeByStore = new Map<string, AdmiraScreen[]>();
  const activeBySupport = new Map<string, AdmiraScreen[]>();
  const nameByStore = new Map<string, string>();
  const allStores = new Set<string>();

  for (const screen of screens) {
    const num = normalizeStore(screen.original['Numero de Tienda']);
    allStores.add(num);
    const name = (screen.original['Nombre de tienda'] ?? '').trim();
    if (name && !nameByStore.has(num)) nameByStore.set(num, name);

    const support = screen.metadata.calendarSupport;
    if (!support) continue; // sin mapear: no cruza por soporte
    const k = `${norm(support)}|${num}`;
    push(screen.metadata.active ? active : inactive, k, screen);
    if (screen.metadata.active) {
      push(activeByStore, num, screen);
      push(activeBySupport, norm(support), screen);
    }
  }
  return {
    active,
    inactive,
    activeByStore,
    activeBySupport,
    nameByStore,
    allStores,
  };
}

/** Pantallas CUADRADA activas de la tienda 78 cuando participa de VIDEO WALL CRIUS. */
function guadalajaraCuadrada(index: ScreenIndex): AdmiraScreen[] {
  const g = GUADALAJARA_GALERIAS_EXCEPTION;
  const store = index.activeByStore.get(normalizeStore(g.storeNumber)) ?? [];
  const participates = store.some(
    (s) => norm(s.metadata.calendarSupport) === norm(g.requestedSupport),
  );
  if (!participates) return [];
  return store.filter((s) => norm(s.original.Modelo) === 'CUADRADA');
}

// --- Ordenamiento del plan (puro, estable) -----------------------------------

/**
 * Comparación de soportes tolerante a mayúsculas/minúsculas, espacios y acentos:
 * reutiliza la clave normalizada (`normalizeSupport`) y ordena por punto de
 * código. Es determinista e independiente del locale del sistema o navegador.
 */
function compareSupport(a: string, b: string): number {
  const ka = norm(a);
  const kb = norm(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Interpreta una tienda como entero solo si su texto es puramente numérico. */
function storeAsNumber(value: string): number | null {
  const t = value.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Comparación textual determinista (por punto de código), sin depender del locale. */
function compareTextDeterministic(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/**
 * Orden total de tiendas: numérico ascendente cuando ambas son numéricas
 * (`2, 9, 10, 78, 101`, nunca lexicográfico); si dos representaciones dan el
 * mismo número se desempata por texto determinista. Los valores no numéricos o
 * vacíos van después de los numéricos, con respaldo textual determinista.
 */
function compareStore(a: string, b: string): number {
  const na = storeAsNumber(a);
  const nb = storeAsNumber(b);
  if (na !== null && nb !== null) {
    return na !== nb ? na - nb : compareTextDeterministic(a, b);
  }
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return compareTextDeterministic(a, b);
}

/**
 * Orden estable por decoración: aplica `compare` y usa el índice original como
 * último desempate, sin mutar el arreglo de entrada ni depender de que el motor
 * implemente un `Array.prototype.sort` estable.
 */
function stableSort<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map((d) => d.item);
}

/**
 * Orden de diapositivas: **número de tienda** (numérico ascendente) como criterio
 * primario, de modo que todas las evidencias de una misma tienda quedan juntas;
 * dentro de cada tienda se agrupan por soporte solicitado (alfabético). El orden
 * del catálogo se conserva para pantallas con la misma tienda y soporte.
 */
function compareSlide(a: PptEvidenceSlide, b: PptEvidenceSlide): number {
  return (
    compareStore(a.storeNumber, b.storeNumber) ||
    compareSupport(a.requestedSupport, b.requestedSupport)
  );
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Orden de incidencias: primero las que tienen soporte (alfabético) y, dentro de
 * cada soporte, las que tienen tienda (numérica) antes que las que no. Las
 * incidencias sin soporte quedan al final. En cada nivel el índice original
 * (vía `stableSort`) mantiene el orden relativo; no se altera ningún dato.
 */
function compareIssue(a: PptEvidenceIssue, b: PptEvidenceIssue): number {
  const aSup = hasText(a.support);
  const bSup = hasText(b.support);
  if (aSup !== bSup) return aSup ? -1 : 1;
  if (!aSup || !bSup) return 0; // ambas sin soporte → estabilidad por índice
  const bySupport = compareSupport(a.support ?? '', b.support ?? '');
  if (bySupport !== 0) return bySupport;
  const aStore = hasText(a.storeNumber);
  const bStore = hasText(b.storeNumber);
  if (aStore !== bStore) return aStore ? -1 : 1;
  if (!aStore || !bStore) return 0; // mismo soporte, ambas sin tienda → índice
  return compareStore(a.storeNumber ?? '', b.storeNumber ?? '');
}

/**
 * Construye el plan de la PPT (puro). Deduplica por `screen.id` las pantallas del
 * catálogo y por `tienda|soporte` los soportes InStore Media sin pantalla.
 *
 * Orden del plan (solo afecta a la PPT, no a colecciones, calendario ni CSV):
 *  - Las evidencias se ordenan por **número de tienda** (numérico ascendente,
 *    `2, 9, 10, 78, 101`) como criterio primario, así que todas las evidencias de
 *    una misma tienda quedan juntas; dentro de cada tienda se agrupan por
 *    **soporte solicitado** (`requestedSupport`, alfabético y tolerante a
 *    mayúsculas/acentos/espacios).
 *  - Para varias pantallas de la misma tienda y soporte se **conserva el orden
 *    del catálogo** (estable, sin desempatar por id/modelo/artículos/nombre).
 *  - Las incidencias se ordenan por soporte y luego por tienda; las que no tienen
 *    soporte o tienda quedan de forma determinista al final.
 */
export function buildCampaignPptPlan(
  campaign: PptCampaignInput,
  screens: readonly AdmiraScreen[],
): CampaignPptPlan {
  const index = buildIndex(screens);
  const slides: PptEvidenceSlide[] = [];
  const issues: PptEvidenceIssue[] = [];
  const seen = new Set<string>();
  const g = GUADALAJARA_GALERIAS_EXCEPTION;

  const addScreenSlide = (
    screen: AdmiraScreen,
    requestedSupport: string,
  ): boolean => {
    if (seen.has(screen.id)) return false;
    seen.add(screen.id);
    slides.push({
      key: screen.id,
      storeNumber: normalizeStore(screen.original['Numero de Tienda']),
      storeName: (screen.original['Nombre de tienda'] ?? '').trim() || '—',
      requestedSupport,
      calendarSupport: screen.metadata.calendarSupport,
      articulos: (screen.original.ARTICULOS ?? '').trim() || '—',
      owner: 'liverpool',
    });
    return true;
  };

  for (const support of campaign.supports) {
    if (support.owner === 'instore-media') {
      handleInstore(support, index, slides, issues, seen);
      continue;
    }
    handleLiverpool(support, index, addScreenSlide, issues, g);
  }

  if (!campaign.fechaInicio.trim()) {
    issues.push({
      kind: 'missing-start-date',
      message: 'La campaña no tiene fecha de inicio.',
    });
  }
  if (!campaign.fechaFin.trim()) {
    issues.push({
      kind: 'missing-end-date',
      message: 'La campaña no tiene fecha de fin.',
    });
  }

  return {
    campaignName: campaign.name,
    startDate: campaign.fechaInicio,
    endDate: campaign.fechaFin,
    slides: stableSort(slides, compareSlide),
    issues: stableSort(issues, compareIssue),
  };
}

function handleLiverpool(
  support: CampaignSupport,
  index: ScreenIndex,
  addScreenSlide: (s: AdmiraScreen, req: string) => boolean,
  issues: PptEvidenceIssue[],
  g: typeof GUADALAJARA_GALERIAS_EXCEPTION,
): void {
  const isCrius = norm(support.support) === norm(g.requestedSupport);
  const scope = effectiveCampaignSupportScope(support);

  if (
    scope === 'invalid' ||
    (scope === 'selected' && support.stores.length === 0)
  ) {
    issues.push({
      kind: 'invalid-store-scope',
      support: support.support,
      message: `El alcance de tiendas de "${support.support}" está pendiente o es inválido; no se generaron diapositivas.`,
    });
    return;
  }

  // "Asignada" sin comentario: expandir todas las pantallas activas del soporte.
  if (scope === 'all') {
    let added = 0;
    for (const s of index.activeBySupport.get(norm(support.support)) ?? []) {
      if (addScreenSlide(s, support.support)) added += 1;
    }
    if (isCrius) {
      for (const s of guadalajaraCuadrada(index)) {
        if (addScreenSlide(s, support.support)) added += 1;
      }
    }
    if (added === 0) {
      issues.push({
        kind: 'assigned-no-active-screens',
        support: support.support,
        message: `El soporte "${support.support}" está asignado sin tiendas y no hay pantallas activas en el catálogo para expandirlo.`,
      });
    }
    return;
  }

  for (const store of support.stores) {
    const num = normalizeStore(store.numero);
    const k = `${norm(support.support)}|${num}`;
    const activeMatches = index.active.get(k) ?? [];
    if (activeMatches.length > 0) {
      for (const s of activeMatches) addScreenSlide(s, support.support);
    } else if ((index.inactive.get(k) ?? []).length > 0) {
      issues.push({
        kind: 'only-inactive',
        support: support.support,
        storeNumber: num,
        message: `Tienda ${num}, soporte "${support.support}": solo hay pantallas inactivas en el catálogo; no se generó diapositiva.`,
      });
    } else if (index.allStores.has(num)) {
      issues.push({
        kind: 'store-support-mismatch',
        support: support.support,
        storeNumber: num,
        message: `Tienda ${num} existe en el catálogo pero no con el soporte "${support.support}".`,
      });
    } else {
      issues.push({
        kind: 'store-not-in-catalog',
        support: support.support,
        storeNumber: num,
        message: `Tienda ${num} (soporte "${support.support}") no existe en el catálogo.`,
      });
    }

    // Excepción Guadalajara: tienda 78 + VIDEO WALL CRIUS añade la CUADRADA.
    if (isCrius && num === normalizeStore(g.storeNumber)) {
      for (const s of index.activeByStore.get(num) ?? []) {
        if (norm(s.original.Modelo) === 'CUADRADA') {
          addScreenSlide(s, support.support);
        }
      }
    }
  }
}

function handleInstore(
  support: CampaignSupport,
  index: ScreenIndex,
  slides: PptEvidenceSlide[],
  issues: PptEvidenceIssue[],
  seen: Set<string>,
): void {
  const scope = effectiveCampaignSupportScope(support);
  if (scope === 'invalid' || scope === 'all' || support.stores.length === 0) {
    issues.push({
      kind:
        scope === 'invalid' || scope === 'selected'
          ? 'invalid-store-scope'
          : 'instore-assigned-no-comment',
      support: support.support,
      message:
        scope === 'invalid' || scope === 'selected'
          ? `El alcance de tiendas de "${support.support}" está pendiente o es inválido; no se generaron diapositivas.`
          : `El soporte InStore Media "${support.support}" está asignado sin comentario; no se puede expandir de forma confiable.`,
    });
    return;
  }

  for (const store of support.stores) {
    const num = normalizeStore(store.numero);
    const dedupeKey = `ism|${num}|${norm(support.support)}`;
    if (seen.has(dedupeKey)) continue;
    const name = index.nameByStore.get(num);
    if (!name) {
      issues.push({
        kind: 'instore-store-no-name',
        support: support.support,
        storeNumber: num,
        message: `Tienda ${num} (soporte InStore Media "${support.support}") no tiene nombre oficial en el catálogo; no se generó diapositiva.`,
      });
      continue;
    }
    seen.add(dedupeKey);
    slides.push({
      key: dedupeKey,
      storeNumber: num,
      storeName: name,
      requestedSupport: support.support,
      calendarSupport: support.support,
      articulos: INSTORE_ARTICULOS_FALLBACK,
      owner: 'instore-media',
    });
  }
}

// --- Nombre de archivo -------------------------------------------------------

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'campana'
  );
}

function fileDate(raw: string): string {
  const d = parseCampaignDate(raw);
  return d ? formatDdMmYyyy(d).replace(/\//g, '-') : 'sin-fecha';
}

/** `Evidencias_<Campaña>_<dd-mm-aaaa>_al_<dd-mm-aaaa>.pptx` (sanitizado). */
export function pptFileName(
  campaignName: string,
  startDate: string,
  endDate: string,
): string {
  return `Evidencias_${sanitizeName(campaignName)}_${fileDate(startDate)}_al_${fileDate(endDate)}.pptx`;
}

/** Texto de vigencia para la portada. */
export function vigenciaText(plan: CampaignPptPlan): string {
  if (!plan.startDate.trim() || !plan.endDate.trim()) {
    return 'Fecha no disponible';
  }
  return `Vigencia: ${formatCivilString(plan.startDate)} al ${formatCivilString(plan.endDate)}`;
}

// --- Serialización PPTX ------------------------------------------------------

// Paleta de marca Liverpool (rosa magenta + azul marino). Colores hex sin '#'.
const PINK = 'FA29A3';
const NAVY = '14284C';
const STEEL = '48688B';
const WHITE = 'FFFFFF';
const CARD_BG = 'F7F7F9';
const CARD_LINE = 'D6D9E0';
const FONT = 'Arial';

const LIVERPOOL_RATIO = 368 / 96; // ancho/alto del logo
const INSTORE_RATIO = 242 / 51;

/** Máximo de incidencias por diapositiva (se paginan si hay más). */
export const ISSUES_PER_SLIDE = 12;

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

/** Inserta una imagen; si falla (recurso no disponible) devuelve false. */
function addImageSafe(
  slide: PptxSlide,
  data: string,
  opts: { x: number; y: number; w: number; h: number },
): boolean {
  try {
    slide.addImage({ data, ...opts });
    return true;
  } catch {
    return false;
  }
}

/** Logo Liverpool (imagen); si falla, escribe la palabra como respaldo. */
function addLiverpoolLogo(slide: PptxSlide, x: number, y: number, h: number) {
  const w = h * LIVERPOOL_RATIO;
  if (!addImageSafe(slide, LIVERPOOL_LOGO_DATA_URL, { x, y, w, h })) {
    slide.addText('Liverpool', {
      x,
      y,
      w,
      h,
      valign: 'middle',
      fontFace: FONT,
      fontSize: 20,
      bold: true,
      color: WHITE,
    });
  }
}

/** Logo in-Store Media alineado a la derecha; respaldo textual si falla. */
function addInstoreLogo(
  slide: PptxSlide,
  rightX: number,
  y: number,
  h: number,
) {
  const w = h * INSTORE_RATIO;
  const x = rightX - w;
  if (!addImageSafe(slide, INSTORE_MEDIA_LOGO_DATA_URL, { x, y, w, h })) {
    slide.addText('in-Store Media', {
      x: rightX - 2.2,
      y,
      w: 2.2,
      h,
      align: 'right',
      valign: 'middle',
      fontFace: FONT,
      fontSize: 12,
      color: WHITE,
    });
  }
}

function addPhotoPlaceholder(
  slide: PptxSlide,
  pptx: PptxGenJS,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: CARD_BG },
    line: { color: CARD_LINE, width: 1.5, dashType: 'dash' },
    shadow: {
      type: 'outer',
      color: 'BFC3CC',
      blur: 6,
      offset: 3,
      angle: 90,
      opacity: 0.5,
    },
  });
  // Icono discreto de imagen (formas nativas): marco + sol + montaña.
  const ix = x + w / 2 - 0.6;
  const iy = y + h / 2 - 1.1;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: ix,
    y: iy,
    w: 1.2,
    h: 0.9,
    rectRadius: 0.06,
    fill: { color: WHITE },
    line: { color: 'B7BDC8', width: 1 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: ix + 0.16,
    y: iy + 0.14,
    w: 0.22,
    h: 0.22,
    fill: { color: 'D6D9E0' },
    line: { color: 'B7BDC8', width: 0.5 },
  });
  slide.addShape(pptx.ShapeType.triangle, {
    x: ix + 0.34,
    y: iy + 0.36,
    w: 0.7,
    h: 0.48,
    fill: { color: 'D6D9E0' },
    line: { color: 'B7BDC8', width: 0.5 },
  });
  slide.addText('COLOCAR EVIDENCIA FOTOGRÁFICA', {
    x,
    y: y + h / 2 + 0.15,
    w,
    h: 0.5,
    align: 'center',
    fontFace: FONT,
    fontSize: 16,
    bold: true,
    color: '9AA1AF',
  });
}

/** Icono de pantalla/soporte (formas nativas, contorno azul marino). */
function addSupportIcon(
  slide: PptxSlide,
  pptx: PptxGenJS,
  x: number,
  y: number,
): void {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: 0.5,
    h: 0.62,
    rectRadius: 0.06,
    fill: { color: WHITE },
    line: { color: NAVY, width: 1.5 },
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + 0.19,
    y: y + 0.46,
    w: 0.12,
    h: 0.06,
    rectRadius: 0.02,
    fill: { color: NAVY },
    line: { color: NAVY, width: 0.5 },
  });
}

function addCover(pptx: PptxGenJS, plan: CampaignPptPlan): void {
  const slide = pptx.addSlide();
  slide.background = { color: PINK };
  addLiverpoolLogo(slide, 0.5, 0.4, 0.62);
  slide.addText(plan.campaignName, {
    x: 0.7,
    y: 2.5,
    w: 11.9,
    h: 1.1,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: WHITE,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.75,
    y: 3.62,
    w: 1.6,
    h: 0.05,
    fill: { color: WHITE },
  });
  slide.addText(vigenciaText(plan), {
    x: 0.7,
    y: 3.85,
    w: 11.9,
    h: 0.6,
    fontFace: FONT,
    fontSize: 20,
    color: WHITE,
  });
  addInstoreLogo(slide, 12.83, 6.85, 0.34);
}

function addEvidence(
  pptx: PptxGenJS,
  campaignName: string,
  s: PptEvidenceSlide,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: WHITE };
  // Encabezado rosa con logo Liverpool.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.9,
    fill: { color: PINK },
  });
  addLiverpoolLogo(slide, 0.4, 0.24, 0.42);
  // Pie rosa con logo in-Store Media.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 6.95,
    w: 13.333,
    h: 0.55,
    fill: { color: PINK },
  });
  addInstoreLogo(slide, 12.93, 7.07, 0.3);

  // Panel de información (izquierda).
  const lx = 0.5;
  slide.addText(campaignName, {
    x: lx,
    y: 1.2,
    w: 4.0,
    h: 0.5,
    fontFace: FONT,
    fontSize: 18,
    bold: true,
    color: NAVY,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: lx + 0.02,
    y: 1.72,
    w: 0.7,
    h: 0.04,
    fill: { color: PINK },
  });
  slide.addText(s.storeName, {
    x: lx,
    y: 2.25,
    w: 4.0,
    h: 0.9,
    fontFace: FONT,
    fontSize: 30,
    bold: true,
    color: NAVY,
  });
  slide.addText(`Tienda ${s.storeNumber}`, {
    x: lx,
    y: 3.15,
    w: 4.0,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    color: STEEL,
  });
  let y = 3.7;
  if (s.owner === 'instore-media') {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: lx,
      y,
      w: 2.0,
      h: 0.4,
      rectRadius: 0.08,
      fill: { color: PINK },
    });
    slide.addText('InStore Media', {
      x: lx,
      y,
      w: 2.0,
      h: 0.4,
      align: 'center',
      valign: 'middle',
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: WHITE,
    });
    y += 0.6;
  }
  slide.addText(s.requestedSupport, {
    x: lx,
    y,
    w: 4.0,
    h: 0.5,
    fontFace: FONT,
    fontSize: 17,
    bold: true,
    color: NAVY,
  });
  slide.addText('ARTÍCULOS', {
    x: lx,
    y: y + 0.6,
    w: 4.0,
    h: 0.26,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: STEEL,
  });
  slide.addText(s.articulos || '—', {
    x: lx,
    y: y + 0.85,
    w: 4.0,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    color: NAVY,
  });

  // Icono de soporte + etiqueta (parte inferior izquierda, como la referencia).
  addSupportIcon(slide, pptx, lx, 5.55);
  slide.addText(s.requestedSupport, {
    x: lx + 0.75,
    y: 5.55,
    w: 3.3,
    h: 0.62,
    valign: 'middle',
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: STEEL,
  });

  // Espacio para la fotografía (derecha).
  addPhotoPlaceholder(slide, pptx, 5.0, 1.25, 7.9, 5.35);
}

function addIssues(pptx: PptxGenJS, issues: readonly PptEvidenceIssue[]): void {
  const pages = Math.max(1, Math.ceil(issues.length / ISSUES_PER_SLIDE));
  for (let p = 0; p < pages; p += 1) {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.9,
      fill: { color: PINK },
    });
    addLiverpoolLogo(slide, 0.4, 0.24, 0.42);
    const title =
      pages > 1
        ? `INCIDENCIAS DE COBERTURA ${p + 1}/${pages}`
        : 'INCIDENCIAS DE COBERTURA';
    slide.addText(title, {
      x: 0.4,
      y: 1.15,
      w: 12.5,
      h: 0.6,
      fontFace: FONT,
      fontSize: 22,
      bold: true,
      color: NAVY,
    });
    const chunk = issues.slice(
      p * ISSUES_PER_SLIDE,
      (p + 1) * ISSUES_PER_SLIDE,
    );
    slide.addText(
      chunk.map((i) => ({
        text: i.message,
        options: {
          bullet: true,
          fontSize: 14,
          color: NAVY,
          paraSpaceAfter: 8,
        },
      })),
      { x: 0.6, y: 1.95, w: 12.1, h: 4.7, valign: 'top', fontFace: FONT },
    );
  }
}

/** Serializa el plan a un Blob `.pptx` (import dinámico de PptxGenJS). */
export async function buildCampaignPpt(plan: CampaignPptPlan): Promise<Blob> {
  const Ctor = (await import('pptxgenjs')).default;
  const pptx: PptxGenJS = new Ctor();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in (16:9)
  pptx.defineSlideMaster({ title: 'SIGNAM', background: { color: WHITE } });

  addCover(pptx, plan);
  for (const s of plan.slides) {
    addEvidence(pptx, plan.campaignName, s);
  }
  if (plan.issues.length > 0) addIssues(pptx, plan.issues);

  const data = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
