import type { jsPDF } from 'jspdf';

/**
 * Primitivas de dibujo del informe comercial de audiencia.
 *
 * El informe se diseñó sobre un lienzo A4 de 794 × 1123 px (A4 a 96 dpi), así
 * que todas las coordenadas del maquetado se expresan en esos píxeles y se
 * convierten aquí a milímetros. Mantener la unidad del diseño evita traducir a
 * mano cada posición y que el PDF derive del mockup con cada retoque.
 */

export type RGB = readonly [number, number, number];

export const NAVY: RGB = [17, 38, 78];
export const BLUE: RGB = [0, 126, 203];
export const BLUE_MID: RGB = [78, 111, 159];
export const BLUE_LIGHT: RGB = [96, 183, 231];
export const BLUE_PALE: RGB = [156, 205, 232];
export const SKY: RGB = [233, 246, 253];
export const PINK: RGB = [226, 18, 111];
export const PINK_PALE: RGB = [253, 230, 240];
export const MUTED: RGB = [91, 104, 125];
export const HAIR: RGB = [222, 230, 239];
export const SOFT: RGB = [247, 250, 253];
export const GRAY: RGB = [197, 208, 220];
export const WHITE: RGB = [255, 255, 255];

/** Ancho del lienzo de diseño, en px. Un A4 a 96 dpi. */
export const CANVAS_W = 794;
export const CANVAS_H = 1123;

/** px del maquetado → mm de página. */
export function u(px: number): number {
  return (px * 210) / CANVAS_W;
}

/** px CSS → puntos tipográficos, la unidad de `setFontSize`. */
export function pt(px: number): number {
  return px * 0.75;
}

export function fill(doc: jsPDF, color: RGB): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

export function stroke(doc: jsPDF, color: RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

/** Rectángulo sólido en coordenadas del maquetado. */
export function block(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
): void {
  fill(doc, color);
  doc.rect(u(x), u(y), u(w), u(h), 'F');
}

export interface TextOptions {
  size?: number;
  color?: RGB;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Interletraje en px del maquetado. */
  tracking?: number;
}

/**
 * Texto en una línea. `y` es la línea base, igual que en jsPDF: el maquetado
 * se transcribe apoyando cada texto en su base, no en su caja.
 */
export function text(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  const color = options.color ?? NAVY;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(pt(options.size ?? 12));
  doc.setTextColor(color[0], color[1], color[2]);
  if (options.tracking) doc.setCharSpace(u(options.tracking));
  doc.text(value, u(x), u(y), { align: options.align ?? 'left' });
  if (options.tracking) doc.setCharSpace(0);
}

/**
 * Párrafo con ajuste de línea. Devuelve la `y` (en px) de la línea base
 * siguiente, para encadenar bloques sin recalcular alturas a mano.
 */
export function paragraph(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  options: TextOptions & { lineHeight?: number } = {},
): number {
  const size = options.size ?? 11;
  const color = options.color ?? MUTED;
  const lineHeight = options.lineHeight ?? size * 1.55;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(pt(size));
  doc.setTextColor(color[0], color[1], color[2]);
  const lines = doc.splitTextToSize(value, u(width)) as string[];
  // jsPDF ancla el texto centrado o alineado a la derecha en la `x` recibida.
  // Aquí `x` es siempre el borde izquierdo de la caja, como en el maquetado.
  const align = options.align ?? 'left';
  const anchor =
    align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
  lines.forEach((line, index) => {
    doc.text(line, u(anchor), u(y + index * lineHeight), { align });
  });
  return y + Math.max(1, lines.length) * lineHeight;
}

/** Ancho de un texto, en px del maquetado. */
export function textWidth(
  doc: jsPDF,
  value: string,
  size: number,
  bold = false,
): number {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(pt(size));
  return (doc.getTextWidth(value) * CANVAS_W) / 210;
}

function gstate(doc: jsPDF, opacity: number): void {
  const withGState = doc as unknown as {
    GState?: new (options: { opacity: number }) => unknown;
    setGState?: (state: unknown) => void;
  };
  if (!withGState.GState || !withGState.setGState) return;
  withGState.setGState(new withGState.GState({ opacity }));
}

export type AlphaStop = readonly [position: number, alpha: number];

function alphaAt(stops: readonly AlphaStop[], t: number): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    if (!a || !b || t > b[0]) continue;
    const span = b[0] - a[0];
    const k = span <= 0 ? 0 : (t - a[0]) / span;
    return a[1] + (b[1] - a[1]) * k;
  }
  return last[1];
}

/**
 * Degradado de un color hacia la transparencia, anclado a un borde.
 *
 * jsPDF no dibuja degradados. La aproximación evidente —tiras contiguas de
 * opacidad decreciente— produce bandas visibles: dos rectángulos que comparten
 * un borde se suavizan cada uno por su lado y dejan pasar un hilo de la imagen
 * sin velar. Solaparlos tampoco sirve: donde se pisan, la opacidad se compone
 * como `1-(1-a1)(1-a2)` y aparece una línea más oscura.
 *
 * Aquí los rectángulos son **acumulativos**: todos arrancan en el borde de
 * anclaje y cada uno llega menos lejos que el anterior, de modo que se apilan
 * sin fronteras internas. Un punto a distancia `d` queda cubierto por todos los
 * rectángulos que lleguen hasta él, y la opacidad de cada uno se despeja para
 * que la composición acumulada valga exactamente la del degradado pedido.
 * Ninguna frontera puede exponer la imagen cruda, porque más allá de cada
 * rectángulo siguen estando todos los anteriores.
 *
 * `stops` describe la opacidad en función de la distancia al borde de anclaje
 * (0 en el borde, 1 en el extremo opuesto) y **debe ser no creciente**: un
 * degradado de dos lados se compone con dos llamadas, una por borde.
 */
export function fade(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  stops: readonly AlphaStop[],
  anchor: 'left' | 'right' | 'top' | 'bottom',
  steps = 48,
): void {
  const horizontal = anchor === 'left' || anchor === 'right';
  const span = horizontal ? w : h;
  if (span <= 0 || steps < 1) return;

  fill(doc, color);
  // `remaining` es el producto de (1 - opacidad) ya acumulado: lo que todavía
  // deja ver de la imagen.
  let remaining = 1;
  for (let i = 0; i < steps; i += 1) {
    const far = (steps - i) / steps;
    const near = (steps - i - 1) / steps;
    const target = Math.max(0, Math.min(1, alphaAt(stops, (far + near) / 2)));
    const wanted = 1 - target;
    const alpha = remaining <= 0 ? 0 : 1 - wanted / remaining;
    remaining = wanted;
    if (alpha <= 0.004) continue;

    const reach = span * far;
    gstate(doc, Math.min(1, alpha));
    if (anchor === 'left') doc.rect(u(x), u(y), u(reach), u(h), 'F');
    else if (anchor === 'right') {
      doc.rect(u(x + w - reach), u(y), u(reach), u(h), 'F');
    } else if (anchor === 'top') doc.rect(u(x), u(y), u(w), u(reach), 'F');
    else doc.rect(u(x), u(y + h - reach), u(w), u(reach), 'F');
  }
  gstate(doc, 1);
}

/** Rectángulo sólido con opacidad, para velar una fotografía. */
export function veil(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  opacity: number,
): void {
  fill(doc, color);
  gstate(doc, opacity);
  doc.rect(u(x), u(y), u(w), u(h), 'F');
  gstate(doc, 1);
}

/**
 * Fotografía recortada al marco, equivalente a `object-fit: cover`.
 *
 * `posX` y `posY` van de 0 a 1 y eligen qué parte de la imagen queda dentro
 * cuando sobra, igual que `object-position`. Sin soporte de recorte en el
 * motor, la imagen se ajusta al marco antes que desbordar la página.
 */
export function photoCover(
  doc: jsPDF,
  dataUrl: string,
  format: string,
  x: number,
  y: number,
  w: number,
  h: number,
  posX = 0.5,
  posY = 0.5,
): void {
  const frameX = u(x);
  const frameY = u(y);
  const frameW = u(w);
  const frameH = u(h);

  let naturalW = w;
  let naturalH = h;
  try {
    const props = doc.getImageProperties(dataUrl);
    if (props.width > 0 && props.height > 0) {
      naturalW = props.width;
      naturalH = props.height;
    }
  } catch {
    // Sin metadatos de la imagen, se dibuja ajustada al marco.
  }

  const scale = Math.max(frameW / naturalW, frameH / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  const drawX = frameX - (drawW - frameW) * posX;
  const drawY = frameY - (drawH - frameH) * posY;

  const clipper = doc as unknown as {
    saveGraphicsState?: () => void;
    restoreGraphicsState?: () => void;
    clip?: () => void;
    discardPath?: () => void;
  };
  const canClip =
    typeof clipper.saveGraphicsState === 'function' &&
    typeof clipper.restoreGraphicsState === 'function' &&
    typeof clipper.clip === 'function' &&
    typeof clipper.discardPath === 'function';

  if (!canClip) {
    doc.addImage(
      dataUrl,
      format,
      frameX,
      frameY,
      frameW,
      frameH,
      undefined,
      'FAST',
    );
    return;
  }

  clipper.saveGraphicsState?.();
  // El `null` es obligatorio: sin él jsPDF traza el rectángulo y cierra el
  // trazado, con lo que `clip` se aplica sobre un trazado vacío y recorta la
  // página entera. La fotografía desaparece sin que nada falle.
  doc.rect(frameX, frameY, frameW, frameH, null as unknown as string);
  clipper.clip?.();
  clipper.discardPath?.();
  doc.addImage(dataUrl, format, drawX, drawY, drawW, drawH, undefined, 'FAST');
  clipper.restoreGraphicsState?.();
}

/** Arco grueso, base de las donas de cobertura. */
export function arc(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  from: number,
  to: number,
  color: RGB,
): void {
  stroke(doc, color);
  doc.setLineWidth(u(width));
  // El arco se compone de segmentos rectos: con remate plano, cada unión deja
  // una muesca en el borde exterior y la dona sale dentada. El remate redondo
  // los solapa.
  doc.setLineCap('round');
  doc.setLineJoin('round');
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) * 24));
  let previousX = cx + Math.cos(from) * radius;
  let previousY = cy + Math.sin(from) * radius;
  for (let i = 1; i <= steps; i += 1) {
    const angle = from + ((to - from) * i) / steps;
    const currentX = cx + Math.cos(angle) * radius;
    const currentY = cy + Math.sin(angle) * radius;
    doc.line(u(previousX), u(previousY), u(currentX), u(currentY));
    previousX = currentX;
    previousY = currentY;
  }
  doc.setLineWidth(u(0.75));
}

/** Dona de porcentaje: pista completa más el arco cubierto. */
export function donut(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  percent: number,
  track: RGB = HAIR,
  value: RGB = BLUE,
): void {
  const clamped = Math.max(0, Math.min(100, percent));
  const start = -Math.PI / 2;
  arc(doc, cx, cy, radius, width, start, start + Math.PI * 2, track);
  if (clamped > 0) {
    arc(
      doc,
      cx,
      cy,
      radius,
      width,
      start,
      start + Math.PI * 2 * (clamped / 100),
      value,
    );
  }
}

/**
 * Pictograma de tienda: toldo, cuerpo y puerta.
 *
 * La puerta se pinta del color del fondo sobre el que se apoya el icono, que
 * es lo que la hace legible a 21 px sin recurrir a trazos finos.
 */
export function storeGlyph(
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
  color: RGB,
  background: RGB,
): void {
  fill(doc, color);
  doc.rect(u(x), u(y + size * 0.1), u(size), u(size * 0.22), 'F');
  doc.rect(
    u(x + size * 0.09),
    u(y + size * 0.36),
    u(size * 0.82),
    u(size * 0.54),
    'F',
  );
  fill(doc, background);
  doc.rect(
    u(x + size * 0.39),
    u(y + size * 0.6),
    u(size * 0.22),
    u(size * 0.3),
    'F',
  );
}
