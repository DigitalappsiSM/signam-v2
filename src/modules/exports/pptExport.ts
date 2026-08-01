import type PptxGenJS from 'pptxgenjs';
import {
  normalizeSupport,
  GUADALAJARA_GALERIAS_EXCEPTION,
  type AdmiraScreen,
} from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import {
  parseCampaignDate,
  formatDdMmYyyy,
  formatCivilString,
} from '@/modules/operational-tracking/businessDays';

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

/**
 * Construye el plan de la PPT (puro). Deduplica por `screen.id` las pantallas del
 * catálogo y por `tienda|soporte` los soportes InStore Media sin pantalla.
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
    slides,
    issues,
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

  // "Asignada" sin comentario: expandir todas las pantallas activas del soporte.
  if (support.stores.length === 0) {
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
  if (support.stores.length === 0) {
    issues.push({
      kind: 'instore-assigned-no-comment',
      support: support.support,
      message: `El soporte InStore Media "${support.support}" está asignado sin comentario; no se puede expandir de forma confiable.`,
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

// Paleta (gama de la app). Colores hex sin '#'.
const DARK = '0F2A47';
const ACCENT = '2563EB';
const WHITE = 'FFFFFF';
const MUTED = '64748B';
const FOOT = '93A4BF';
const CARD_BG = 'F8FAFC';
const CARD_LINE = 'CBD5E1';
const TITLE = '0F172A';
const FONT = 'Arial';

/** Máximo de incidencias por diapositiva (se paginan si hay más). */
export const ISSUES_PER_SLIDE = 12;

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

function addField(
  slide: PptxSlide,
  pptx: PptxGenJS,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
): void {
  slide.addText(label.toUpperCase(), {
    x,
    y,
    w,
    h: 0.28,
    fontFace: FONT,
    fontSize: 10,
    color: MUTED,
    bold: true,
  });
  slide.addText(value || '—', {
    x,
    y: y + 0.28,
    w,
    h: 0.5,
    fontFace: FONT,
    fontSize: 15,
    color: TITLE,
  });
  void pptx;
}

function addBrand(slide: PptxSlide, x: number, y: number, w: number): void {
  // Marca textual (recreada con texto nativo; el logo real puede sustituirse).
  slide.addText('Liverpool', {
    x,
    y,
    w,
    h: 0.6,
    align: 'right',
    valign: 'middle',
    fontFace: FONT,
    fontSize: 20,
    italic: true,
    bold: true,
    color: WHITE,
  });
}

function addPhotoPlaceholder(
  slide: PptxSlide,
  pptx: PptxGenJS,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: CARD_BG },
    line: { color: CARD_LINE, width: 1.5, dashType: 'dash' },
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
    fill: { color: 'FFFFFF' },
    line: { color: '94A3B8', width: 1 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: ix + 0.16,
    y: iy + 0.14,
    w: 0.22,
    h: 0.22,
    fill: { color: 'CBD5E1' },
    line: { color: '94A3B8', width: 0.5 },
  });
  slide.addShape(pptx.ShapeType.triangle, {
    x: ix + 0.34,
    y: iy + 0.36,
    w: 0.7,
    h: 0.48,
    fill: { color: 'CBD5E1' },
    line: { color: '94A3B8', width: 0.5 },
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
    color: '94A3B8',
  });
}

function addCover(
  slide: PptxSlide,
  pptx: PptxGenJS,
  plan: CampaignPptPlan,
): void {
  slide.background = { color: DARK };
  addBrand(slide, 8.9, 0.4, 4.0);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 3.15,
    w: 3.2,
    h: 0.08,
    fill: { color: ACCENT },
  });
  slide.addText(plan.campaignName, {
    x: 0.8,
    y: 2.1,
    w: 11.7,
    h: 1.0,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: WHITE,
  });
  slide.addText(vigenciaText(plan), {
    x: 0.8,
    y: 3.45,
    w: 11.7,
    h: 0.6,
    fontFace: FONT,
    fontSize: 18,
    color: 'CBD5E1',
  });
  slide.addText('Evidencias fotográficas', {
    x: 0.8,
    y: 6.5,
    w: 11.7,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    color: FOOT,
  });
}

function addEvidence(
  slide: PptxSlide,
  pptx: PptxGenJS,
  campaignName: string,
  s: PptEvidenceSlide,
): void {
  slide.background = { color: WHITE };
  // Encabezado oscuro.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.9,
    fill: { color: DARK },
  });
  slide.addText(campaignName, {
    x: 0.4,
    y: 0.12,
    w: 8.3,
    h: 0.66,
    valign: 'middle',
    fontFace: FONT,
    fontSize: 20,
    bold: true,
    color: WHITE,
  });
  addBrand(slide, 9.0, 0.15, 3.9);
  // Pie oscuro.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 6.95,
    w: 13.333,
    h: 0.55,
    fill: { color: DARK },
  });
  slide.addText('SIGNAM · Evidencias', {
    x: 0.4,
    y: 6.98,
    w: 8,
    h: 0.45,
    valign: 'middle',
    fontFace: FONT,
    fontSize: 9,
    color: FOOT,
  });

  // Panel de información (izquierda).
  const lx = 0.4;
  slide.addText(s.storeName, {
    x: lx,
    y: 1.25,
    w: 4.2,
    h: 0.8,
    fontFace: FONT,
    fontSize: 24,
    bold: true,
    color: TITLE,
  });
  slide.addText(`Tienda ${s.storeNumber}`, {
    x: lx,
    y: 2.0,
    w: 4.2,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    color: MUTED,
  });
  if (s.owner === 'instore-media') {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: lx,
      y: 2.5,
      w: 2.2,
      h: 0.4,
      rectRadius: 0.08,
      fill: { color: ACCENT },
    });
    slide.addText('InStore Media', {
      x: lx,
      y: 2.5,
      w: 2.2,
      h: 0.4,
      align: 'center',
      valign: 'middle',
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: WHITE,
    });
  }
  const fy = s.owner === 'instore-media' ? 3.15 : 2.7;
  addField(slide, pptx, lx, fy, 4.2, 'Soporte solicitado', s.requestedSupport);
  addField(
    slide,
    pptx,
    lx,
    fy + 0.95,
    4.2,
    'Normalización Liverpool',
    s.calendarSupport,
  );
  addField(slide, pptx, lx, fy + 1.9, 4.2, 'Artículos', s.articulos);

  // Espacio para la fotografía (derecha).
  addPhotoPlaceholder(slide, pptx, 4.9, 1.25, 8.0, 5.4);
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
      fill: { color: DARK },
    });
    const title =
      pages > 1
        ? `INCIDENCIAS DE COBERTURA ${p + 1}/${pages}`
        : 'INCIDENCIAS DE COBERTURA';
    slide.addText(title, {
      x: 0.4,
      y: 0.12,
      w: 12.5,
      h: 0.66,
      valign: 'middle',
      fontFace: FONT,
      fontSize: 20,
      bold: true,
      color: WHITE,
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
          color: TITLE,
          paraSpaceAfter: 8,
        },
      })),
      { x: 0.6, y: 1.2, w: 12.1, h: 5.5, valign: 'top', fontFace: FONT },
    );
  }
}

/** Serializa el plan a un Blob `.pptx` (import dinámico de PptxGenJS). */
export async function buildCampaignPpt(plan: CampaignPptPlan): Promise<Blob> {
  const Ctor = (await import('pptxgenjs')).default;
  const pptx: PptxGenJS = new Ctor();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in (16:9)
  pptx.defineSlideMaster({ title: 'SIGNAM', background: { color: WHITE } });

  addCover(pptx.addSlide(), pptx, plan);
  for (const s of plan.slides) {
    addEvidence(pptx.addSlide(), pptx, plan.campaignName, s);
  }
  if (plan.issues.length > 0) addIssues(pptx, plan.issues);

  const data = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
