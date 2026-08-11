import type { Atom, Bond, Arrow, TextBox, TextRun } from '../types/chemistry';
import type {
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawBounds,
  ChemDrawBracket,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawGraphic,
  ChemDrawNode,
  ChemDrawObjectTag,
  ChemDrawPoint,
  ChemDrawTable,
  ChemDrawTextBlock,
} from '../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../types/settings';
import { buildAtomLabelRuns, getLeadElementAnchorOffset } from './atomLabelPresentation';
import { chemDrawDocumentToCanvasState } from './chemdrawModel';
import {
  convertNativeToCanvas,
  getDocumentCaptionFontSize,
  getNodeLabelVerticalOffset,
  resolveArrowHeadType,
  resolveDocumentCaptionTextStyle,
  resolveDocumentLabelTextStyle,
} from './chemdrawMetrics';
import { getAtomAlias, getAtomLeadElement } from './atomIdentity';
import { getAtomDisplayText, getAtomHydrogenCount } from './atomLabels';
import { getAtomElectronMarkerGeometry } from './electronAnnotations';
import { VALENCIES } from './elements';
import {
  arrowUsesControlPoint,
  collectBondNeighborVectors,
  computeBondVisibleIntervals,
  computeRingCentroids,
  getArrowGeometryMetrics,
  getArrowLabelAnchors,
  getArrowOffsetCurve,
  getArrowPointAt,
  getArrowTangentAt,
  getAtomBondClipOffset,
  getDoubleBondLineGeometry,
  getAtomLabelLayoutMetrics,
  getAtomLabelBoxWidth,
  getBondVisualMetrics,
  getOffsetBondLineGeometry,
  resolveDoubleBondMode,
  getTripleBondLineGeometry,
  isAtomLabelVisible,
} from './renderGeometry';
import { useStore } from '../store';
import {
  CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  getPageSetupDimensionsPx,
  normalizeDocumentStyleSettings,
  normalizeDocumentViewSettings,
  resolveAtomLabelColor,
  resolveBondColor,
} from './settings';
import { SHORTHAND_DATA } from './shorthand';
import { getTextBoxLines, getTextBoxRenderLines, measureRunWidth } from './textRunPresentation';
import { getObjectTagAnchor, getTextBlockPlainText } from './objectTags';

const BOND_WIDTH = 2;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

function adaptSvgColor(color: string, isDarkMode: boolean): string {
  if (!isDarkMode) return color;
  const normalized = color.toLowerCase().trim();
  return normalized === '#000000' || normalized === '#000' || normalized === 'black'
    ? '#ffffff'
    : color;
}

function pushPointExtent(allX: number[], allY: number[], point?: ChemDrawPoint | null): void {
  if (!point) return;
  allX.push(point.x);
  allY.push(point.y);
}

function pushBoundsExtent(allX: number[], allY: number[], bounds?: ChemDrawBounds | null): void {
  if (!bounds) return;
  allX.push(bounds.left, bounds.right);
  allY.push(bounds.top, bounds.bottom);
}

function translatePoint(
  point: ChemDrawPoint,
  tx: (value: number) => number,
  ty: (value: number) => number,
): ChemDrawPoint {
  return { x: tx(point.x), y: ty(point.y) };
}

function translateBounds(
  bounds: ChemDrawBounds,
  tx: (value: number) => number,
  ty: (value: number) => number,
): ChemDrawBounds {
  return {
    left: tx(bounds.left),
    top: ty(bounds.top),
    right: tx(bounds.right),
    bottom: ty(bounds.bottom),
  };
}

function getBoundsCenter(bounds: ChemDrawBounds): ChemDrawPoint {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

function resolveObjectTagAnchor(
  tag: ChemDrawObjectTag,
  fallbackAnchor?: ChemDrawPoint | null,
): ChemDrawPoint | null {
  const anchor = getObjectTagAnchor(tag) ?? fallbackAnchor ?? null;
  if (!anchor) return null;
  if (tag.positioningOffset && fallbackAnchor) {
    return {
      x: fallbackAnchor.x + tag.positioningOffset.x,
      y: fallbackAnchor.y + tag.positioningOffset.y,
    };
  }
  return anchor;
}

function linePlainText(lineRuns: TextRun[]): string {
  return lineRuns.map((run) => run.text ?? '').join('');
}

function renderSvgTextLines(options: {
  runs: TextRun[];
  x: number;
  y: number;
  justification?: 'left' | 'center' | 'right';
  fontFamily: string;
  fontSize: number;
  color: string;
  isDarkMode: boolean;
  lineHeight?: number;
  rotation?: number;
}): string {
  if (!options.runs.length) return '';
  const lines = getTextBoxLines(options.runs);
  const anchor =
    options.justification === 'left'
      ? 'start'
      : options.justification === 'right'
        ? 'end'
        : 'middle';
  const transform =
    options.rotation != null
      ? ` transform="rotate(${options.rotation.toFixed(1)} ${options.x.toFixed(1)} ${options.y.toFixed(1)})"`
      : '';
  const lineHeight = options.lineHeight ?? options.fontSize * 1.2;
  const baseColor = adaptSvgColor(options.color, options.isDarkMode);
  return lines
    .map((lineRuns, lineIndex) => {
      const lineText = linePlainText(lineRuns);
      const lineInner =
        lineRuns.length > 0
          ? lineRuns
              .map((run) => {
                const runColor = adaptSvgColor(run.color ?? baseColor, options.isDarkMode);
                let attrs = `fill="${escAttr(runColor)}"`;
                if (run.bold) attrs += ' font-weight="bold"';
                if (run.italic) attrs += ' font-style="italic"';
                if (run.sub) {
                  attrs += ` baseline-shift="sub" font-size="${(options.fontSize * 0.65).toFixed(1)}"`;
                } else if (run.sup) {
                  attrs += ` baseline-shift="super" font-size="${(options.fontSize * 0.65).toFixed(1)}"`;
                }
                return `<tspan ${attrs}>${esc(run.text)}</tspan>`;
              })
              .join('')
          : '<tspan fill="transparent">&#8203;</tspan>';
      return `<text x="${options.x.toFixed(1)}" y="${(options.y + lineIndex * lineHeight).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="hanging" font-family="${escAttr(options.fontFamily)}" font-size="${options.fontSize.toFixed(1)}" fill="${escAttr(baseColor)}" aria-label="${escAttr(lineText)}"${transform}>${lineInner}</text>`;
    })
    .join('');
}

function renderTextBlockSVG(
  text: ChemDrawTextBlock | undefined,
  options: {
    anchor: ChemDrawPoint;
    fontFamily: string;
    fontSize: number;
    color: string;
    isDarkMode: boolean;
    rotation?: number;
  },
): string {
  if (!text?.runs?.length) return '';
  return renderSvgTextLines({
    runs: text.runs,
    x: options.anchor.x,
    y: options.anchor.y,
    justification: text.justification ?? 'center',
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    color: options.color,
    isDarkMode: options.isDarkMode,
    rotation: options.rotation,
  });
}

function renderObjectTagsSVG(
  objectTags: ChemDrawObjectTag[] | undefined,
  options: {
    fallbackAnchor?: ChemDrawPoint | null;
    fallbackColor?: string;
    documentStyleSettings: DocumentStyleSettings;
    isDarkMode: boolean;
  },
): string {
  if (!objectTags?.length) return '';
  const defaultFontSize = getDocumentCaptionFontSize(options.documentStyleSettings);
  const defaultFontFamily = options.documentStyleSettings.nativeMetrics.captionFontFamily;
  return objectTags
    .map((tag) => {
      if (tag.visible === false) return '';
      const plainText = getTextBlockPlainText(tag.text);
      if (!plainText) return '';
      const anchor = resolveObjectTagAnchor(tag, options.fallbackAnchor);
      if (!anchor) return '';
      const fontFamily = tag.style?.fontFamily ?? defaultFontFamily;
      const fontSize =
        tag.style?.fontSize != null
          ? convertNativeToCanvas(tag.style.fontSize, options.documentStyleSettings)
          : defaultFontSize;
      const color = tag.style?.color ?? options.fallbackColor ?? '#000000';
      return renderTextBlockSVG(tag.text, {
        anchor: { x: anchor.x, y: anchor.y - fontSize * 0.45 },
        fontFamily,
        fontSize,
        color,
        isDarkMode: options.isDarkMode,
        rotation: tag.style?.rotation,
      });
    })
    .join('');
}

function graphicFallbackAnchor(graphic: ChemDrawGraphic): ChemDrawPoint | null {
  if (graphic.bounds) return getBoundsCenter(graphic.bounds);
  if (graphic.center) return graphic.center;
  if (graphic.points?.length) {
    const sum = graphic.points.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 },
    );
    return {
      x: sum.x / graphic.points.length,
      y: sum.y / graphic.points.length,
    };
  }
  return null;
}

function renderGraphicSVG(
  graphic: ChemDrawGraphic,
  options: {
    tx: (value: number) => number;
    ty: (value: number) => number;
    documentStyleSettings: DocumentStyleSettings;
    isDarkMode: boolean;
  },
): string {
  if (graphic.style?.visible === false) return '';
  const stroke = adaptSvgColor(
    graphic.style?.strokeColor ?? graphic.style?.color ?? '#333333',
    options.isDarkMode,
  );
  const fill = graphic.style?.fillColor
    ? adaptSvgColor(graphic.style.fillColor, options.isDarkMode)
    : 'none';
  const strokeWidth =
    graphic.style?.lineWidth != null
      ? convertNativeToCanvas(graphic.style.lineWidth, options.documentStyleSettings)
      : 1.5;
  const dash = graphic.style?.lineType === 'dashed' ? ' stroke-dasharray="6 4"' : '';
  const shadowAttr =
    graphic.shadowSize != null || (graphic.rectangleType ?? '').toLowerCase().includes('shadow')
      ? ' filter="drop-shadow(3px 3px 8px rgba(0,0,0,0.35))"'
      : '';
  const groupBody: string[] = [];

  if (graphic.graphicType === 'line' && graphic.points && graphic.points.length >= 2) {
    const points = graphic.points.map((point) => translatePoint(point, options.tx, options.ty));
    groupBody.push(
      `<polyline points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="none"${dash}/>`,
    );
  } else if (graphic.graphicType === 'polygon' && graphic.points && graphic.points.length >= 3) {
    const points = graphic.points.map((point) => translatePoint(point, options.tx, options.ty));
    groupBody.push(
      `<polygon points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="${escAttr(fill)}"${dash}/>`,
    );
  } else if (
    (graphic.graphicType === 'rectangle' || graphic.graphicType === 'rounded-rectangle') &&
    graphic.bounds
  ) {
    const bounds = translateBounds(graphic.bounds, options.tx, options.ty);
    const width = Math.abs(bounds.right - bounds.left);
    const height = Math.abs(bounds.bottom - bounds.top);
    const x = Math.min(bounds.left, bounds.right);
    const y = Math.min(bounds.top, bounds.bottom);
    const radius =
      graphic.graphicType === 'rounded-rectangle' ? (graphic.cornerRadius ?? 10).toFixed(1) : '0';
    groupBody.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${radius}" ry="${radius}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" fill="${escAttr(fill)}"${dash}${shadowAttr}/>`,
    );
  } else if (graphic.graphicType === 'ellipse' && graphic.bounds) {
    const bounds = translateBounds(graphic.bounds, options.tx, options.ty);
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const rx = Math.abs(bounds.right - bounds.left) / 2;
    const ry = Math.abs(bounds.bottom - bounds.top) / 2;
    groupBody.push(
      `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" fill="${escAttr(fill)}"${dash}/>`,
    );
  } else if (graphic.graphicType === 'symbol' && graphic.bounds) {
    const bounds = translateBounds(graphic.bounds, options.tx, options.ty);
    const width = Math.abs(bounds.right - bounds.left);
    const height = Math.abs(bounds.bottom - bounds.top);
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const radius = Math.max(width, height, 8) / 2;
    const arm = radius * 0.48;
    if (graphic.symbolType === 'CirclePlus' || graphic.symbolType === 'CircleMinus') {
      groupBody.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" fill="none"/>`,
        `<path d="M${(cx - arm).toFixed(1)} ${cy.toFixed(1)} L${(cx + arm).toFixed(1)} ${cy.toFixed(1)}${graphic.symbolType === 'CirclePlus' ? ` M${cx.toFixed(1)} ${(cy - arm).toFixed(1)} L${cx.toFixed(1)} ${(cy + arm).toFixed(1)}` : ''}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round"/>`,
      );
    } else if (graphic.symbolType === 'LonePair') {
      groupBody.push(
        `<circle cx="${(cx - radius * 0.28).toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(1, strokeWidth * 0.95).toFixed(1)}" fill="${escAttr(stroke)}"/>`,
        `<circle cx="${(cx + radius * 0.28).toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(1, strokeWidth * 0.95).toFixed(1)}" fill="${escAttr(stroke)}"/>`,
      );
    } else if (graphic.symbolType === 'Electron') {
      groupBody.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(1, strokeWidth).toFixed(1)}" fill="${escAttr(stroke)}"/>`,
      );
    }
  } else if (graphic.graphicType === 'bracket' && graphic.points && graphic.points.length >= 2) {
    const [startPoint, endPoint] = graphic.points.map((point) =>
      translatePoint(point, options.tx, options.ty),
    );
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.hypot(dx, dy);
    if (length >= 1) {
      const px = -dy / length;
      const py = dx / length;
      const lip = graphic.lipSize ?? Math.max(8, length * 0.35);
      const midX = (startPoint.x + endPoint.x) / 2;
      const midY = (startPoint.y + endPoint.y) / 2;
      const isSquare = (graphic.bracketType ?? '').toLowerCase() === 'square';
      const path = isSquare
        ? `M${(startPoint.x + px * lip).toFixed(1)} ${(startPoint.y + py * lip).toFixed(1)} L${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} L${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)} L${(endPoint.x + px * lip).toFixed(1)} ${(endPoint.y + py * lip).toFixed(1)}`
        : `M${(startPoint.x + px * lip).toFixed(1)} ${(startPoint.y + py * lip).toFixed(1)} Q${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)} Q${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)} ${(endPoint.x + px * lip).toFixed(1)} ${(endPoint.y + py * lip).toFixed(1)}`;
      groupBody.push(
        `<path d="${path}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
      );
      if (graphic.label) {
        groupBody.push(
          renderSvgTextLines({
            runs: [{ text: graphic.label }],
            x: midX - px * (lip + 10),
            y: midY - py * (lip + 10) - 8,
            justification: 'center',
            fontFamily: options.documentStyleSettings.nativeMetrics.captionFontFamily,
            fontSize: 11,
            color: stroke,
            isDarkMode: options.isDarkMode,
          }),
        );
      }
    }
  } else if (graphic.graphicType === 'orbital') {
    const orbitalFill = graphic.style?.fillColor
      ? adaptSvgColor(graphic.style.fillColor, options.isDarkMode)
      : stroke;
    const orbitalType = (graphic.orbitalType ?? '').toLowerCase();
    if (
      orbitalType.startsWith('s') &&
      graphic.center &&
      graphic.majorAxisEnd &&
      graphic.minorAxisEnd
    ) {
      const center = translatePoint(graphic.center, options.tx, options.ty);
      const majorAxisEnd = translatePoint(graphic.majorAxisEnd, options.tx, options.ty);
      const minorAxisEnd = translatePoint(graphic.minorAxisEnd, options.tx, options.ty);
      const rx = Math.hypot(majorAxisEnd.x - center.x, majorAxisEnd.y - center.y);
      const ry = Math.hypot(minorAxisEnd.x - center.x, minorAxisEnd.y - center.y);
      const rotation =
        (Math.atan2(majorAxisEnd.y - center.y, majorAxisEnd.x - center.x) * 180) / Math.PI;
      const shaded = (graphic.ovalType ?? '').toLowerCase().includes('shaded');
      groupBody.push(
        `<ellipse cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" rx="${Math.max(rx, 1).toFixed(1)}" ry="${Math.max(ry, 1).toFixed(1)}" transform="rotate(${rotation.toFixed(1)} ${center.x.toFixed(1)} ${center.y.toFixed(1)})" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" fill="${escAttr(orbitalFill)}" fill-opacity="${shaded ? '0.22' : '0'}"/>`,
      );
    } else if (orbitalType === 'p' && graphic.points && graphic.points.length >= 2) {
      const [startPoint, endPoint] = graphic.points.map((point) =>
        translatePoint(point, options.tx, options.ty),
      );
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const length = Math.hypot(dx, dy);
      if (length >= 1) {
        const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
        const midX = (startPoint.x + endPoint.x) / 2;
        const midY = (startPoint.y + endPoint.y) / 2;
        const lobeRx = Math.max(length * 0.2, 4);
        const lobeRy = Math.max(length * 0.11, 3);
        const lobeOffset = length * 0.26;
        for (const offset of [-lobeOffset, lobeOffset]) {
          groupBody.push(
            `<ellipse cx="${(midX + Math.cos((rotation * Math.PI) / 180) * offset).toFixed(1)}" cy="${(midY + Math.sin((rotation * Math.PI) / 180) * offset).toFixed(1)}" rx="${lobeRx.toFixed(1)}" ry="${lobeRy.toFixed(1)}" transform="rotate(${rotation.toFixed(1)} ${(midX + Math.cos((rotation * Math.PI) / 180) * offset).toFixed(1)} ${(midY + Math.sin((rotation * Math.PI) / 180) * offset).toFixed(1)})" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" fill="${escAttr(orbitalFill)}" fill-opacity="0.18"/>`,
          );
        }
      }
    }
  }

  const fallbackAnchor = graphicFallbackAnchor(graphic);
  const translatedFallbackAnchor = fallbackAnchor
    ? translatePoint(fallbackAnchor, options.tx, options.ty)
    : null;
  groupBody.push(
    renderObjectTagsSVG(graphic.objectTags, {
      fallbackAnchor: translatedFallbackAnchor,
      fallbackColor: stroke,
      documentStyleSettings: options.documentStyleSettings,
      isDarkMode: options.isDarkMode,
    }),
  );
  return groupBody.length > 0 ? `<g data-native-object="graphic">${groupBody.join('')}</g>` : '';
}

function renderBracketSVG(
  bracket: ChemDrawBracket,
  options: {
    tx: (value: number) => number;
    ty: (value: number) => number;
    documentStyleSettings: DocumentStyleSettings;
    isDarkMode: boolean;
  },
): string {
  if (bracket.style?.visible === false) return '';
  const bounds = translateBounds(bracket.bounds, options.tx, options.ty);
  const stroke = adaptSvgColor(bracket.style?.color ?? '#888888', options.isDarkMode);
  const strokeWidth =
    bracket.style?.lineWidth != null
      ? convertNativeToCanvas(bracket.style.lineWidth, options.documentStyleSettings)
      : 1.5;
  const width = Math.abs(bounds.right - bounds.left);
  const lip = Math.max(6, Math.min(12, width * 0.16));
  const path = [
    `M${(bounds.left + lip).toFixed(1)} ${bounds.top.toFixed(1)}`,
    `L${bounds.left.toFixed(1)} ${bounds.top.toFixed(1)}`,
    `L${bounds.left.toFixed(1)} ${bounds.bottom.toFixed(1)}`,
    `L${(bounds.left + lip).toFixed(1)} ${bounds.bottom.toFixed(1)}`,
    `M${(bounds.right - lip).toFixed(1)} ${bounds.top.toFixed(1)}`,
    `L${bounds.right.toFixed(1)} ${bounds.top.toFixed(1)}`,
    `L${bounds.right.toFixed(1)} ${bounds.bottom.toFixed(1)}`,
    `L${(bounds.right - lip).toFixed(1)} ${bounds.bottom.toFixed(1)}`,
  ].join(' ');
  const label = bracket.label
    ? renderSvgTextLines({
        runs: [{ text: bracket.label }],
        x: (bounds.left + bounds.right) / 2,
        y: bounds.top - 16,
        justification: 'center',
        fontFamily: options.documentStyleSettings.nativeMetrics.captionFontFamily,
        fontSize: 12,
        color: stroke,
        isDarkMode: options.isDarkMode,
      })
    : '';
  const objectTags = renderObjectTagsSVG(bracket.objectTags, {
    fallbackAnchor: { x: (bounds.left + bounds.right) / 2, y: bounds.top - 4 },
    fallbackColor: stroke,
    documentStyleSettings: options.documentStyleSettings,
    isDarkMode: options.isDarkMode,
  });
  return `<g data-native-object="bracket"><path d="${path}" stroke="${escAttr(stroke)}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>${label}${objectTags}</g>`;
}

function renderEmbeddedObjectSVG(
  embeddedObject: ChemDrawEmbeddedObject,
  options: {
    tx: (value: number) => number;
    ty: (value: number) => number;
    documentStyleSettings: DocumentStyleSettings;
    isDarkMode: boolean;
  },
): string {
  if (embeddedObject.style?.visible === false) return '';
  const bounds = translateBounds(embeddedObject.bounds, options.tx, options.ty);
  const width = Math.abs(bounds.right - bounds.left);
  const height = Math.abs(bounds.bottom - bounds.top);
  const x = Math.min(bounds.left, bounds.right);
  const y = Math.min(bounds.top, bounds.bottom);
  const stroke = adaptSvgColor(
    embeddedObject.style?.strokeColor ?? embeddedObject.style?.color ?? '#6f7c8f',
    options.isDarkMode,
  );
  const fill = adaptSvgColor(embeddedObject.style?.fillColor ?? '#f7fafc', options.isDarkMode);
  const body: string[] = [
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${escAttr(fill)}" stroke="${escAttr(stroke)}" stroke-width="1.2" rx="6" ry="6" stroke-dasharray="6 4"/>`,
  ];
  if (embeddedObject.previewDataUrl) {
    body.push(
      `<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="xMidYMid meet" href="${escAttr(embeddedObject.previewDataUrl)}"/>`,
    );
  } else {
    body.push(
      renderSvgTextLines({
        runs: [{ text: embeddedObject.sourceFileName ?? embeddedObject.payloadKind.toUpperCase() }],
        x: x + 6,
        y: y + 6,
        justification: 'left',
        fontFamily: options.documentStyleSettings.nativeMetrics.captionFontFamily,
        fontSize: 11,
        color: stroke,
        isDarkMode: options.isDarkMode,
      }),
    );
  }
  body.push(
    renderObjectTagsSVG(embeddedObject.objectTags, {
      fallbackAnchor: { x: x + width / 2, y: y + height + 8 },
      fallbackColor: stroke,
      documentStyleSettings: options.documentStyleSettings,
      isDarkMode: options.isDarkMode,
    }),
  );
  return `<g data-native-object="embedded-object">${body.join('')}</g>`;
}

function renderTableSVG(
  table: ChemDrawTable,
  options: {
    tx: (value: number) => number;
    ty: (value: number) => number;
    documentStyleSettings: DocumentStyleSettings;
    isDarkMode: boolean;
  },
): string {
  if (table.style?.visible === false) return '';
  const bounds = translateBounds(table.bounds, options.tx, options.ty);
  const stroke = adaptSvgColor(table.style?.color ?? '#666666', options.isDarkMode);
  const fill = adaptSvgColor(table.style?.fillColor ?? '#ffffff', options.isDarkMode);
  const body: string[] = [
    `<rect x="${Math.min(bounds.left, bounds.right).toFixed(1)}" y="${Math.min(bounds.top, bounds.bottom).toFixed(1)}" width="${Math.abs(bounds.right - bounds.left).toFixed(1)}" height="${Math.abs(bounds.bottom - bounds.top).toFixed(1)}" fill="${escAttr(fill)}" stroke="${escAttr(stroke)}" stroke-width="1.2"/>`,
  ];
  for (const cell of table.cells) {
    const cellBounds = translateBounds(cell.boundsInParent, options.tx, options.ty);
    const cellWidth = Math.abs(cellBounds.right - cellBounds.left);
    const cellHeight = Math.abs(cellBounds.bottom - cellBounds.top);
    const cellX = Math.min(cellBounds.left, cellBounds.right);
    const cellY = Math.min(cellBounds.top, cellBounds.bottom);
    body.push(
      `<rect x="${cellX.toFixed(1)}" y="${cellY.toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${cellHeight.toFixed(1)}" fill="none" stroke="${escAttr(stroke)}" stroke-width="1"/>`,
    );
    if (cell.text?.runs?.length) {
      const justification = cell.text.justification ?? 'center';
      const textX =
        justification === 'left'
          ? cellX + 4
          : justification === 'right'
            ? cellX + cellWidth - 4
            : cellX + cellWidth / 2;
      body.push(
        renderSvgTextLines({
          runs: cell.text.runs,
          x: textX,
          y: cellY + 4,
          justification,
          fontFamily:
            table.style?.fontFamily ??
            options.documentStyleSettings.nativeMetrics.captionFontFamily,
          fontSize:
            table.style?.fontSize != null
              ? convertNativeToCanvas(table.style.fontSize, options.documentStyleSettings)
              : 11,
          color: stroke,
          isDarkMode: options.isDarkMode,
        }),
      );
    }
  }
  body.push(
    renderObjectTagsSVG(table.objectTags, {
      fallbackAnchor: { x: (bounds.left + bounds.right) / 2, y: bounds.top - 6 },
      fallbackColor: stroke,
      documentStyleSettings: options.documentStyleSettings,
      isDarkMode: options.isDarkMode,
    }),
  );
  return `<g data-native-object="table">${body.join('')}</g>`;
}

function strokePath(
  d: string,
  color: string,
  width = BOND_WIDTH,
  linecap = 'round',
  dash?: string,
): string {
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="${linecap}" stroke-linejoin="round" fill="none"${dashAttr}/>`;
}

function segmentedStrokePath(
  intervals: Array<[number, number]>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = BOND_WIDTH,
  linecap = 'round',
  dash?: string,
): string {
  return intervals
    .map(([startT, endT]) =>
      strokePath(
        `M${x1 + (x2 - x1) * startT} ${y1 + (y2 - y1) * startT} L${x1 + (x2 - x1) * endT} ${y1 + (y2 - y1) * endT}`,
        color,
        width,
        linecap,
        dash,
      ),
    )
    .join('');
}

function fillPath(d: string, color: string): string {
  return `<path d="${d}" fill="${color}" stroke="none"/>`;
}

function arrowSVG(
  arrow: Pick<
    Arrow,
    'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'cpx' | 'cpy' | 'lineWidth' | 'lineStyle' | 'curveEnabled'
  >,
  color: string,
  documentStyleSettings: ReturnType<typeof useStore.getState>['documentStyleSettings'],
  nativeArrow?: ChemDrawArrow | null,
): string {
  const len = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
  if (len < 2) return '';

  const geometry = getArrowGeometryMetrics(arrow, documentStyleSettings, nativeArrow);
  const headType = resolveArrowHeadType({ type: arrow.type }, nativeArrow);
  const shaftWidth = Math.max(1, geometry.lineWidth);
  const dash =
    arrow.type === 'dashed-reaction' ? '6,4' : arrow.lineStyle === 'dashed' ? '6,4' : undefined;
  const usesControlPoint = arrowUsesControlPoint(arrow);
  const headLength = geometry.headSize;
  const headHalfWidth = geometry.headWidth;
  const halfHeadLength = geometry.headCenterSize;
  const parallelOffset = geometry.shaftSpacing;
  const endTangent = getArrowTangentAt(arrow, 1);
  const startTangent = getArrowTangentAt(arrow, 0);
  const endAngle = Math.atan2(endTangent.dy, endTangent.dx);
  const startAngle = Math.atan2(startTangent.dy, startTangent.dx);
  const shaftPath = (
    points: { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number } = arrow,
    width = shaftWidth,
    dashPattern = dash,
  ) =>
    strokePath(
      usesControlPoint
        ? `M${points.x1} ${points.y1} Q${points.cpx} ${points.cpy} ${points.x2} ${points.y2}`
        : `M${points.x1} ${points.y1} L${points.x2} ${points.y2}`,
      color,
      width,
      arrow.type === 'fat' ? 'butt' : 'round',
      dashPattern,
    );
  const filledHead = (x: number, y: number, angle: number) =>
    fillPath(
      `M${x} ${y} L${x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle)} L${x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle)} Z`,
      color,
    );
  const openHead = (x: number, y: number, angle: number) =>
    [
      strokePath(
        `M${x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle)} L${x} ${y} L${x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle)}`,
        color,
        shaftWidth,
      ),
    ].join('');
  const angleHead = (x: number, y: number, angle: number) =>
    [
      strokePath(
        `M${x} ${y} L${x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle)} M${x} ${y} L${x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle)} ${y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle)}`,
        color,
        shaftWidth,
      ),
    ].join('');
  const halfHead = (x: number, y: number, angle: number, side: 1 | -1) =>
    strokePath(
      `M${x - halfHeadLength * Math.cos(angle) + side * headHalfWidth * Math.sin(angle)} ${y - halfHeadLength * Math.sin(angle) - side * headHalfWidth * Math.cos(angle)} L${x} ${y}`,
      color,
      shaftWidth,
    );
  const resolvedHead = (x: number, y: number, angle: number) =>
    headType === 'filled'
      ? filledHead(x, y, angle)
      : headType === 'angle'
        ? angleHead(x, y, angle)
        : openHead(x, y, angle);

  if (arrow.type === 'fat') {
    let out = shaftPath(arrow, Math.max(6, shaftWidth * 1.8), undefined);
    out += filledHead(arrow.x2, arrow.y2, endAngle);
    return out;
  }

  if (arrow.type === 'equilibrium') {
    const top = getArrowOffsetCurve(arrow, -parallelOffset);
    const bottomBase = getArrowOffsetCurve(arrow, parallelOffset);
    const bottom =
      geometry.equilibriumRatio < 0.999
        ? {
            ...bottomBase,
            x1: bottomBase.x2 + (bottomBase.x1 - bottomBase.x2) * geometry.equilibriumRatio,
            y1: bottomBase.y2 + (bottomBase.y1 - bottomBase.y2) * geometry.equilibriumRatio,
            cpx: bottomBase.x2 + (bottomBase.cpx - bottomBase.x2) * geometry.equilibriumRatio,
            cpy: bottomBase.y2 + (bottomBase.cpy - bottomBase.y2) * geometry.equilibriumRatio,
          }
        : bottomBase;
    return (
      shaftPath(top) +
      halfHead(top.x2, top.y2, endAngle, -1) +
      shaftPath(
        {
          ...bottom,
          x1: bottom.x2,
          y1: bottom.y2,
          x2: bottom.x1,
          y2: bottom.y1,
          cpx: bottom.cpx,
          cpy: bottom.cpy,
        },
        shaftWidth,
        undefined,
      ) +
      halfHead(bottom.x1, bottom.y1, startAngle + Math.PI, 1)
    );
  }

  if (arrow.type === 'retrosynthetic') {
    const top = getArrowOffsetCurve(arrow, -parallelOffset);
    const bottom = getArrowOffsetCurve(arrow, parallelOffset);
    return shaftPath(top) + shaftPath(bottom) + resolvedHead(arrow.x2, arrow.y2, endAngle);
  }

  let out = shaftPath();
  if (arrow.type === 'reaction' || arrow.type === 'dashed-reaction' || arrow.type === 'curved') {
    out += resolvedHead(arrow.x2, arrow.y2, endAngle);
  } else if (arrow.type === 'no-reaction') {
    out += resolvedHead(arrow.x2, arrow.y2, endAngle);
    const mid = getArrowPointAt(arrow, 0.5);
    const tangent = getArrowTangentAt(arrow, 0.5);
    const angle = Math.atan2(tangent.dy, tangent.dx);
    const crossLen = Math.max(9, geometry.headSize * 0.9);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    out += strokePath(
      `M${mid.x - Math.cos(angle) * crossLen - perpX * crossLen} ${mid.y - Math.sin(angle) * crossLen - perpY * crossLen} L${mid.x + Math.cos(angle) * crossLen + perpX * crossLen} ${mid.y + Math.sin(angle) * crossLen + perpY * crossLen}`,
      color,
      Math.max(shaftWidth, 2.5),
    );
    out += strokePath(
      `M${mid.x + Math.cos(angle) * crossLen - perpX * crossLen} ${mid.y + Math.sin(angle) * crossLen - perpY * crossLen} L${mid.x - Math.cos(angle) * crossLen + perpX * crossLen} ${mid.y - Math.sin(angle) * crossLen + perpY * crossLen}`,
      color,
      Math.max(shaftWidth, 2.5),
    );
  } else if (arrow.type === 'resonance') {
    out += resolvedHead(arrow.x2, arrow.y2, endAngle);
    out += resolvedHead(arrow.x1, arrow.y1, startAngle + Math.PI);
  } else if (arrow.type === 'half-curved') {
    out += halfHead(arrow.x2, arrow.y2, endAngle, -1);
  }
  return out;
}

function bondSVG(
  b: Bond,
  atoms: Atom[],
  bonds: Bond[],
  color: string,
  documentStyleSettings: ReturnType<typeof useStore.getState>['documentStyleSettings'],
  nativeBond?: ChemDrawBond | null,
  ringCentroids?: Map<string, { cx: number; cy: number; n: number }>,
): string {
  const fA = atoms.find((a) => a.id === b.from),
    tA = atoms.find((a) => a.id === b.to);
  if (!fA || !tA) return '';
  const dx = tA.x - fA.x,
    dy = tA.y - fA.y,
    dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return '';
  const uX = dx / dist,
    uY = dy / dist;
  const startClip = getAtomBondClipOffset(fA, atoms, bonds, uX, uY, documentStyleSettings);
  const endClip = getAtomBondClipOffset(tA, atoms, bonds, -uX, -uY, documentStyleSettings);
  const sX = fA.x + uX * startClip,
    sY = fA.y + uY * startClip;
  const eX = tA.x - uX * endClip,
    eY = tA.y - uY * endClip;
  const isDarkMode = useStore.getState().isDarkMode;
  const strokeColor = resolveBondColor(b.color, documentStyleSettings, isDarkMode) || color;
  const strokeWidth =
    b.lineWidth ??
    (nativeBond?.style?.lineWidth != null
      ? convertNativeToCanvas(nativeBond.style.lineWidth, documentStyleSettings)
      : (documentStyleSettings.bondLineWidth ?? BOND_WIDTH));
  const visual = getBondVisualMetrics(strokeWidth, dist, {
    documentStyleSettings,
    nativeBond,
  });
  const boldWidth = visual.boldWidth;
  const oX = -uY * visual.parallelOffset,
    oY = uX * visual.parallelOffset;
  const visibleIntervals = computeBondVisibleIntervals(
    b,
    atoms,
    bonds,
    (bond) => {
      if (bond.lineWidth != null) return bond.lineWidth;
      const candidate = bond.id === b.id ? nativeBond : null;
      return candidate?.style?.lineWidth != null
        ? convertNativeToCanvas(candidate.style.lineWidth, documentStyleSettings)
        : (documentStyleSettings.bondLineWidth ?? BOND_WIDTH);
    },
    documentStyleSettings,
  );
  const atomLookup = new Map(atoms.map((atom) => [atom.id, atom]));
  const bondNeighborVectors =
    b.order === 2 || b.order === 3
      ? collectBondNeighborVectors({
          bond: b,
          fromAtom: fA,
          toAtom: tA,
          atomLookup,
          bonds,
        })
      : null;
  let out = '';

  if (b.stereo === 1) {
    const wedgeOffsetX = -uY * visual.stereoHalfWidth;
    const wedgeOffsetY = uX * visual.stereoHalfWidth;
    out += fillPath(
      `M${sX} ${sY} L${eX + wedgeOffsetX} ${eY + wedgeOffsetY} L${eX - wedgeOffsetX} ${eY - wedgeOffsetY} Z`,
      strokeColor,
    );
  } else if (b.stereo === 6) {
    const hN = visual.hashStepCount;
    for (let i = 0; i <= hN; i++) {
      const r = i / hN;
      const px = sX + (eX - sX) * r,
        py = sY + (eY - sY) * r;
      const w = visual.hashStartWidth + i * visual.hashStepWidth,
        dX = -uY * w,
        dY = uX * w;
      out += strokePath(
        `M${px - dX} ${py - dY} L${px + dX} ${py + dY}`,
        strokeColor,
        strokeWidth,
        'butt',
      );
    }
  } else if (b.displayStyle === 'dash') {
    out += segmentedStrokePath(
      visibleIntervals,
      sX,
      sY,
      eX,
      eY,
      strokeColor,
      strokeWidth,
      'round',
      '6 4',
    );
  } else if (b.displayStyle === 'bold') {
    out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, boldWidth);
  } else if (b.displayStyle === 'wavy') {
    const points: string[] = [];
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = sX + (eX - sX) * t;
      const py = sY + (eY - sY) * t;
      const wave = Math.sin((t * Math.PI * segments) / 2);
      points.push(
        `${px + -uY * visual.waveAmplitude * wave} ${py + uX * visual.waveAmplitude * wave}`,
      );
    }
    out += `<polyline points="${points.join(' ')}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else if (b.displayStyle === 'crossed') {
    const mx = (sX + eX) / 2;
    const my = (sY + eY) / 2;
    out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
    out += strokePath(
      `M${mx + -uY * visual.crossHalfLength} ${my + uX * visual.crossHalfLength} L${mx - -uY * visual.crossHalfLength} ${my - uX * visual.crossHalfLength}`,
      strokeColor,
      strokeWidth,
    );
  } else if (b.displayStyle === 'dative') {
    const angle = Math.atan2(eY - sY, eX - sX);
    const hs = visual.dativeHeadSize;
    out += segmentedStrokePath(
      visibleIntervals,
      sX,
      sY,
      eX - Math.cos(angle) * hs,
      eY - Math.sin(angle) * hs,
      strokeColor,
      strokeWidth,
    );
    out += strokePath(
      `M${eX} ${eY} L${eX - hs * Math.cos(angle - Math.PI / 7)} ${eY - hs * Math.sin(angle - Math.PI / 7)}`,
      strokeColor,
      strokeWidth,
    );
    out += strokePath(
      `M${eX} ${eY} L${eX - hs * Math.cos(angle + Math.PI / 7)} ${eY - hs * Math.sin(angle + Math.PI / 7)}`,
      strokeColor,
      strokeWidth,
    );
  } else if (b.order === 1) {
    out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
  } else if (b.order === 1.5) {
    const centroid = ringCentroids?.get(b.id);
    let sign = 1;
    if (centroid) {
      const mx = (fA.x + tA.x) / 2,
        my = (fA.y + tA.y) / 2;
      if ((centroid.cx - mx) * oX + (centroid.cy - my) * oY < 0) sign = -1;
    }
    out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
    out += segmentedStrokePath(
      visibleIntervals,
      sX + sign * oX,
      sY + sign * oY,
      eX + sign * oX,
      eY + sign * oY,
      strokeColor,
      strokeWidth,
      'round',
      visual.aromaticDashPattern.join(' '),
    );
  } else if (b.order === 2) {
    const nativeSecondaryLine =
      nativeBond?.secondaryDisplay != null
        ? getOffsetBondLineGeometry({
            startX: sX,
            startY: sY,
            endX: eX,
            endY: eY,
            unitX: uX,
            unitY: uY,
            offsetX: oX,
            offsetY: oY,
            fromAtom: fA,
            toAtom: tA,
            startNeighborVectors: bondNeighborVectors?.from,
            endNeighborVectors: bondNeighborVectors?.to,
          })
        : null;
    if (nativeBond?.secondaryDisplay === 'dash') {
      out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
      out += segmentedStrokePath(
        visibleIntervals,
        nativeSecondaryLine!.startX,
        nativeSecondaryLine!.startY,
        nativeSecondaryLine!.endX,
        nativeSecondaryLine!.endY,
        strokeColor,
        strokeWidth,
        'round',
        '6 4',
      );
      return out;
    }
    if (nativeBond?.secondaryDisplay === 'bold') {
      out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
      out += segmentedStrokePath(
        visibleIntervals,
        nativeSecondaryLine!.startX,
        nativeSecondaryLine!.startY,
        nativeSecondaryLine!.endX,
        nativeSecondaryLine!.endY,
        strokeColor,
        strokeWidth,
      );
      return out;
    }
    const [primaryLine, secondaryLine] = getDoubleBondLineGeometry({
      startX: sX,
      startY: sY,
      endX: eX,
      endY: eY,
      unitX: uX,
      unitY: uY,
      normalX: oX,
      normalY: oY,
      mode: resolveDoubleBondMode(b.doubleBondMode ?? nativeBond?.doubleBondMode),
      visual,
      fromAtom: fA,
      toAtom: tA,
      ringCentroid: ringCentroids?.get(b.id),
      startNeighborVectors: bondNeighborVectors?.from,
      endNeighborVectors: bondNeighborVectors?.to,
    });
    out += segmentedStrokePath(
      visibleIntervals,
      primaryLine.startX,
      primaryLine.startY,
      primaryLine.endX,
      primaryLine.endY,
      strokeColor,
      strokeWidth,
    );
    out += segmentedStrokePath(
      visibleIntervals,
      secondaryLine.startX,
      secondaryLine.startY,
      secondaryLine.endX,
      secondaryLine.endY,
      strokeColor,
      strokeWidth,
    );
  } else if (b.order === 3) {
    const [topLine, bottomLine] = getTripleBondLineGeometry({
      startX: sX,
      startY: sY,
      endX: eX,
      endY: eY,
      unitX: uX,
      unitY: uY,
      normalX: oX,
      normalY: oY,
      visual,
      fromAtom: fA,
      toAtom: tA,
      startNeighborVectors: bondNeighborVectors?.from,
      endNeighborVectors: bondNeighborVectors?.to,
    });
    out += segmentedStrokePath(visibleIntervals, sX, sY, eX, eY, strokeColor, strokeWidth);
    out += segmentedStrokePath(
      visibleIntervals,
      topLine.startX,
      topLine.startY,
      topLine.endX,
      topLine.endY,
      strokeColor,
      strokeWidth,
    );
    out += segmentedStrokePath(
      visibleIntervals,
      bottomLine.startX,
      bottomLine.startY,
      bottomLine.endX,
      bottomLine.endY,
      strokeColor,
      strokeWidth,
    );
  }
  return out;
}

function textBoxSVG(tb: TextBox, tx: (v: number) => number, ty: (v: number) => number): string {
  const x = tx(tb.x),
    y = ty(tb.y);
  const lines = getTextBoxRenderLines(tb);

  const anchor = tb.textAlign === 'left' ? 'start' : tb.textAlign === 'right' ? 'end' : 'middle';
  const transform = tb.rotation
    ? ` transform="rotate(${tb.rotation} ${x.toFixed(1)} ${y.toFixed(1)})"`
    : '';
  let inner = '';
  lines.forEach((lineRuns, lineIndex) => {
    const dy = lineIndex === 0 ? 0 : tb.fontSize;
    inner += `<tspan x="${x.toFixed(1)}" dy="${dy.toFixed(1)}">`;
    for (const run of lineRuns) {
      const runColor = run.color || tb.color;
      let attrs = `fill="${esc(runColor)}"`;
      if (run.bold) attrs += ' font-weight="bold"';
      if (run.italic) attrs += ' font-style="italic"';
      const text = esc(run.text);
      if (run.sub) {
        inner += `<tspan ${attrs} baseline-shift="sub" font-size="${(tb.fontSize * 0.65).toFixed(1)}">${text}</tspan>`;
      } else if (run.sup) {
        inner += `<tspan ${attrs} baseline-shift="super" font-size="${(tb.fontSize * 0.65).toFixed(1)}">${text}</tspan>`;
      } else {
        inner += `<tspan ${attrs}>${text}</tspan>`;
      }
    }
    inner += `</tspan>`;
  });
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="${esc(tb.fontFamily)}" font-size="${tb.fontSize}" fill="${esc(tb.color)}"${transform}>${inner}</text>`;
}

function generateCanvasSVGWithContext(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  options: {
    chemDrawDocument?: ChemDrawDocument | null;
    documentStyleSettings: DocumentStyleSettings;
    documentViewSettings: DocumentViewSettings;
    isDarkMode: boolean;
    transparent?: boolean;
    textBoxes?: TextBox[];
    pageSetup?: PageSetup;
  },
): string {
  const {
    chemDrawDocument,
    documentStyleSettings,
    documentViewSettings,
    isDarkMode,
    transparent = false,
    textBoxes = [],
    pageSetup,
  } = options;
  const activePage = chemDrawDocument?.pages[0];
  const nativeNodes = new Map(
    (activePage?.objects ?? [])
      .filter((object): object is ChemDrawNode => object.type === 'node')
      .map((node) => [node.id, node]),
  );
  const nativeBonds = new Map(
    (activePage?.objects ?? [])
      .filter((object): object is ChemDrawBond => object.type === 'bond')
      .map((bond) => [bond.id, bond]),
  );
  const nativeArrows = new Map(
    (activePage?.objects ?? [])
      .filter((object): object is ChemDrawArrow => object.type === 'arrow')
      .map((arrow) => [arrow.id, arrow]),
  );
  const nativeGraphics = (activePage?.objects ?? []).filter(
    (object): object is ChemDrawGraphic => object.type === 'graphic',
  );
  const nativeBrackets = (activePage?.objects ?? []).filter(
    (object): object is ChemDrawBracket => object.type === 'bracket',
  );
  const nativeEmbeddedObjects = (activePage?.objects ?? []).filter(
    (object): object is ChemDrawEmbeddedObject => object.type === 'embedded-object',
  );
  const nativeTables = (activePage?.objects ?? []).filter(
    (object): object is ChemDrawTable => object.type === 'table',
  );
  const atomsById = new Map(atoms.map((atom) => [atom.id, atom]));
  const PAD = 40;
  const finitePageMetrics =
    pageSetup?.mode === 'finite' ? getPageSetupDimensionsPx(pageSetup) : null;
  const allX = atoms.map((a) => a.x);
  const allY = atoms.map((a) => a.y);
  const pushObjectTagExtents = (
    objectTags: ChemDrawObjectTag[] | undefined,
    fallbackAnchor?: ChemDrawPoint | null,
  ) => {
    if (!objectTags?.length) return;
    for (const tag of objectTags) {
      const resolvedAnchor = resolveObjectTagAnchor(tag, fallbackAnchor);
      pushPointExtent(allX, allY, resolvedAnchor);
      pushBoundsExtent(allX, allY, tag.text?.bounds);
      if (!resolvedAnchor || tag.text?.bounds || !tag.text?.runs?.length) continue;
      const fontSize =
        tag.style?.fontSize != null
          ? convertNativeToCanvas(tag.style.fontSize, documentStyleSettings)
          : getDocumentCaptionFontSize(documentStyleSettings);
      const tagFontFamily =
        tag.style?.fontFamily ?? documentStyleSettings.nativeMetrics.captionFontFamily;
      const estimatedWidth = tag.text.runs.reduce(
        (sum, run) => sum + measureRunWidth(run, fontSize, tagFontFamily),
        0,
      );
      const halfWidth =
        tag.text.justification === 'left'
          ? estimatedWidth
          : tag.text.justification === 'right'
            ? estimatedWidth
            : estimatedWidth / 2;
      allX.push(resolvedAnchor.x - halfWidth, resolvedAnchor.x + halfWidth);
      allY.push(
        resolvedAnchor.y - fontSize * 0.45,
        resolvedAnchor.y + fontSize * 0.8 + fontSize * 0.2,
      );
    }
  };
  for (const a of arrows) {
    allX.push(a.x1, a.x2, a.cpx);
    allY.push(a.y1, a.y2, a.cpy);
  }
  for (const tb of textBoxes) {
    allX.push(tb.x);
    allY.push(tb.y);
  }
  for (const graphic of nativeGraphics) {
    pushBoundsExtent(allX, allY, graphic.bounds);
    for (const point of graphic.points ?? []) pushPointExtent(allX, allY, point);
    pushPointExtent(allX, allY, graphic.center);
    pushPointExtent(allX, allY, graphic.majorAxisEnd);
    pushPointExtent(allX, allY, graphic.minorAxisEnd);
    pushObjectTagExtents(graphic.objectTags, graphicFallbackAnchor(graphic));
  }
  for (const bracket of nativeBrackets) {
    pushBoundsExtent(allX, allY, bracket.bounds);
    pushObjectTagExtents(bracket.objectTags, {
      x: (bracket.bounds.left + bracket.bounds.right) / 2,
      y: bracket.bounds.top - 4,
    });
  }
  for (const embeddedObject of nativeEmbeddedObjects) {
    pushBoundsExtent(allX, allY, embeddedObject.bounds);
    pushObjectTagExtents(embeddedObject.objectTags, {
      x: (embeddedObject.bounds.left + embeddedObject.bounds.right) / 2,
      y: embeddedObject.bounds.bottom + 8,
    });
  }
  for (const table of nativeTables) {
    pushBoundsExtent(allX, allY, table.bounds);
    for (const cell of table.cells) pushBoundsExtent(allX, allY, cell.boundsInParent);
    pushObjectTagExtents(table.objectTags, {
      x: (table.bounds.left + table.bounds.right) / 2,
      y: table.bounds.top - 6,
    });
  }
  for (const node of nativeNodes.values()) {
    pushObjectTagExtents(node.objectTags, node.position);
  }
  for (const arrow of nativeArrows.values()) {
    pushObjectTagExtents(arrow.objectTags, {
      x: (arrow.tail.x + arrow.head.x) / 2,
      y: (arrow.tail.y + arrow.head.y) / 2,
    });
  }
  for (const bond of nativeBonds.values()) {
    const fromAtom = atomsById.get(bond.beginNodeId);
    const toAtom = atomsById.get(bond.endNodeId);
    if (!fromAtom || !toAtom) continue;
    pushObjectTagExtents(bond.objectTags, {
      x: (fromAtom.x + toAtom.x) / 2,
      y: (fromAtom.y + toAtom.y) / 2,
    });
  }

  if (allX.length === 0 && !finitePageMetrics) {
    const bg = isDarkMode ? '#1e1e1e' : '#f5f5f5';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">${transparent ? '' : `<rect width="200" height="150" fill="${bg}"/>`}</svg>`;
  }

  const minX = finitePageMetrics ? 0 : Math.min(...allX) - PAD,
    minY = finitePageMetrics ? 0 : Math.min(...allY) - PAD;
  const maxX = finitePageMetrics ? finitePageMetrics.totalWidthPx : Math.max(...allX) + PAD,
    maxY = finitePageMetrics ? finitePageMetrics.totalHeightPx : Math.max(...allY) + PAD;
  const W = maxX - minX,
    H = maxY - minY;

  const bg = isDarkMode ? '#1e1e1e' : '#f5f5f5';

  const txf = (v: number) => v - minX;
  const tyf = (v: number) => v - minY;

  const tAtoms = atoms.map((a) => ({ ...a, x: txf(a.x), y: tyf(a.y) }));

  const labeledPositions: { ax: number; ay: number }[] = [];
  for (const a of atoms) {
    const conn = bonds.filter((b) => b.from === a.id || b.to === a.id);
    if (isAtomLabelVisible(a, conn.length)) {
      labeledPositions.push({ ax: txf(a.x), ay: tyf(a.y) });
    }
  }

  let defs = '';
  let bondGroupOpen = '<g>';
  const bondGroupClose = '</g>';
  if (transparent && labeledPositions.length > 0) {
    const maskCircles = labeledPositions
      .map(({ ax, ay }) => `<circle cx="${ax}" cy="${ay}" r="11" fill="black"/>`)
      .join('');
    defs = `<defs><mask id="lm"><rect width="${W}" height="${H}" fill="white"/>${maskCircles}</mask></defs>`;
    bondGroupOpen = '<g mask="url(#lm)">';
  }

  let arrowBody = '';
  let bondBody = '';
  let atomBody = '';
  let nativeBody = '';
  let textBody = '';

  for (const object of activePage?.objects ?? []) {
    if (object.type === 'graphic') {
      nativeBody += renderGraphicSVG(object, {
        tx: txf,
        ty: tyf,
        documentStyleSettings,
        isDarkMode,
      });
    } else if (object.type === 'bracket') {
      nativeBody += renderBracketSVG(object, {
        tx: txf,
        ty: tyf,
        documentStyleSettings,
        isDarkMode,
      });
    } else if (object.type === 'embedded-object') {
      nativeBody += renderEmbeddedObjectSVG(object, {
        tx: txf,
        ty: tyf,
        documentStyleSettings,
        isDarkMode,
      });
    } else if (object.type === 'table') {
      nativeBody += renderTableSVG(object, {
        tx: txf,
        ty: tyf,
        documentStyleSettings,
        isDarkMode,
      });
    }
  }

  for (const a of arrows) {
    const nativeArrow = nativeArrows.get(a.id);
    const color =
      a.strokeColor ??
      nativeArrow?.style?.strokeColor ??
      nativeArrow?.style?.color ??
      resolveBondColor(undefined, documentStyleSettings, isDarkMode);
    arrowBody += arrowSVG(
      {
        type: a.type,
        x1: txf(a.x1),
        y1: tyf(a.y1),
        x2: txf(a.x2),
        y2: tyf(a.y2),
        cpx: txf(a.cpx),
        cpy: tyf(a.cpy),
        curveEnabled: a.curveEnabled,
        lineWidth: a.lineWidth,
        lineStyle: a.lineStyle,
      },
      color,
      documentStyleSettings,
      nativeArrow,
    );
    const labelAbove = a.labelAbove || a.label;
    const labelBelow = a.labelBelow;
    const anchors = getArrowLabelAnchors({
      type: a.type,
      x1: txf(a.x1),
      y1: tyf(a.y1),
      x2: txf(a.x2),
      y2: tyf(a.y2),
      cpx: txf(a.cpx),
      cpy: tyf(a.cpy),
      curveEnabled: a.curveEnabled,
    });
    const labelColor = a.labelColor ?? nativeArrow?.style?.color ?? color;
    const { fontFamily: labelFontFamily, fontSize: labelFontSize } =
      resolveDocumentCaptionTextStyle(documentStyleSettings, {
        authored: { fontSize: a.labelFontSize },
        nativeStyle: nativeArrow?.style,
      });
    if (labelAbove) {
      arrowBody += `<text x="${anchors.above.x.toFixed(1)}" y="${(anchors.above.y - 8).toFixed(1)}" text-anchor="middle" font-family="${esc(labelFontFamily)}" font-size="${labelFontSize.toFixed(1)}" fill="${labelColor}">${esc(labelAbove)}</text>`;
    }
    if (labelBelow) {
      arrowBody += `<text x="${anchors.below.x.toFixed(1)}" y="${(anchors.below.y + labelFontSize).toFixed(1)}" text-anchor="middle" font-family="${esc(labelFontFamily)}" font-size="${labelFontSize.toFixed(1)}" fill="${labelColor}">${esc(labelBelow)}</text>`;
    }
    arrowBody += renderObjectTagsSVG(nativeArrow?.objectTags, {
      fallbackAnchor: {
        x: (txf(a.x1) + txf(a.x2)) / 2,
        y: (tyf(a.y1) + tyf(a.y2)) / 2,
      },
      fallbackColor: labelColor,
      documentStyleSettings,
      isDarkMode,
    });
  }

  const bColor = resolveBondColor(undefined, documentStyleSettings, isDarkMode);
  const ringCentroids = computeRingCentroids(tAtoms, bonds);
  for (const b of bonds) {
    const nativeBond = nativeBonds.get(b.id) ?? null;
    bondBody += bondSVG(b, tAtoms, bonds, bColor, documentStyleSettings, nativeBond, ringCentroids);
    const fromAtom = tAtoms.find((atom) => atom.id === b.from);
    const toAtom = tAtoms.find((atom) => atom.id === b.to);
    if (fromAtom && toAtom) {
      bondBody += renderObjectTagsSVG(nativeBond?.objectTags, {
        fallbackAnchor: {
          x: (fromAtom.x + toAtom.x) / 2,
          y: (fromAtom.y + toAtom.y) / 2,
        },
        fallbackColor: bColor,
        documentStyleSettings,
        isDarkMode,
      });
    }
  }

  for (const a of atoms) {
    const nativeNode = nativeNodes.get(a.id);
    const ax = txf(a.x),
      ay = tyf(a.y);
    const conn = bonds.filter((b) => b.from === a.id || b.to === a.id);
    const sL = isAtomLabelVisible(a, conn.length);
    if (!sL) continue;

    const leadElem = getAtomLeadElement(a);
    const knownVal: number | null = VALENCIES[leadElem] ?? null;
    const chg = a.charge || 0;
    const alias = getAtomAlias(a);
    const canShowImplicitHydrogens = !alias || Boolean(SHORTHAND_DATA[alias]);
    const hydrogenCount = canShowImplicitHydrogens ? getAtomHydrogenCount(a, bonds, knownVal) : 0;
    const displayLabel = getAtomDisplayText(a, atoms, bonds, hydrogenCount).text;

    const explicitLabelColor = a.labelColor ?? nativeNode?.style?.color;
    const color = resolveAtomLabelColor(
      explicitLabelColor,
      leadElem,
      documentStyleSettings,
      isDarkMode,
      documentViewSettings,
    );
    const labelRuns = buildAtomLabelRuns(
      explicitLabelColor && !a.labelColor ? { ...a, labelColor: explicitLabelColor } : a,
      displayLabel,
      color,
      documentStyleSettings,
      documentViewSettings,
      isDarkMode,
    );
    const chgText =
      chg === 1
        ? '+'
        : chg === -1
          ? '−'
          : chg > 1
            ? `${chg}+`
            : chg < -1
              ? `${Math.abs(chg)}−`
              : '';
    const { fontFamily, fontSize } = resolveDocumentLabelTextStyle(documentStyleSettings, {
      authored: {
        fontFamily: a.labelFontFamily,
        fontSize: a.labelFontSize,
      },
      nativeStyle: nativeNode?.style,
    });
    const verticalOffset = getNodeLabelVerticalOffset(nativeNode?.labelAlignment, fontSize);
    const {
      offset: labelAnchorOffset,
      width: totalWidth,
      padding,
    } = getLeadElementAnchorOffset(
      labelRuns,
      displayLabel,
      leadElem,
      fontSize,
      getAtomLabelBoxWidth,
      (run) => measureRunWidth(run, fontSize, fontFamily),
    );
    const runWidths = labelRuns.map((run) => measureRunWidth(run, fontSize, fontFamily));
    const labelLayout = getAtomLabelLayoutMetrics(fontSize, totalWidth, documentStyleSettings);
    const labelBoxStartX = ax - labelAnchorOffset;
    let runX = labelBoxStartX + padding;

    if (!transparent) {
      atomBody += `<rect x="${(labelBoxStartX - labelLayout.boxPadX).toFixed(1)}" y="${(ay - labelLayout.boxHeight / 2 + verticalOffset).toFixed(1)}" width="${(totalWidth + labelLayout.boxPadX * 2).toFixed(1)}" height="${labelLayout.boxHeight.toFixed(1)}" rx="${labelLayout.cornerRadius.toFixed(1)}" fill="${bg}"/>`;
    }
    labelRuns.forEach((run, index) => {
      const runFontSize = run.sub || run.sup ? fontSize * 0.65 : fontSize;
      const runY =
        ay + verticalOffset + 5 + (run.sub ? fontSize * 0.22 : run.sup ? -fontSize * 0.18 : 0);
      atomBody += `<text x="${runX}" y="${runY}" text-anchor="start" font-family="${esc(fontFamily)}" font-size="${runFontSize}" font-weight="${run.bold ? 'bold' : 'normal'}" font-style="${run.italic ? 'italic' : 'normal'}" fill="${esc(run.color ?? color)}">${esc(run.text)}</text>`;
      runX += runWidths[index];
    });
    if (chgText) {
      atomBody += `<text x="${(labelBoxStartX + totalWidth - labelLayout.chargeOffsetX).toFixed(1)}" y="${(ay - labelLayout.chargeOffsetY + verticalOffset + labelLayout.chargeFontSize * 0.45).toFixed(1)}" text-anchor="start" font-family="${esc(fontFamily)}" font-size="${labelLayout.chargeFontSize.toFixed(1)}" font-weight="bold" fill="${color}">${esc(chgText)}</text>`;
    }
    const electronMarkers = getAtomElectronMarkerGeometry(a, {
      centerX: ax,
      centerY: ay,
      distance: labelLayout.electronDistance,
      pairSpacing: labelLayout.electronPairSpacing,
    });
    for (const marker of electronMarkers) {
      for (const dot of marker.dots) {
        atomBody += `<circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="${labelLayout.electronDotRadius.toFixed(1)}" fill="${color}"/>`;
      }
    }
    atomBody += renderObjectTagsSVG(nativeNode?.objectTags, {
      fallbackAnchor: { x: ax, y: ay + verticalOffset },
      fallbackColor: color,
      documentStyleSettings,
      isDarkMode,
    });
  }

  for (const tb of textBoxes) {
    textBody += textBoxSVG(tb, txf, tyf);
  }

  const bgRect = transparent ? '' : `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  const finiteRows = pageSetup?.rows ?? 1;
  const finiteColumns = pageSetup?.columns ?? 1;
  const pageRects =
    transparent || !finitePageMetrics
      ? ''
      : Array.from({ length: finiteRows * finiteColumns }, (_, index) => {
          const row = Math.floor(index / finiteColumns);
          const column = index % finiteColumns;
          return `<rect x="${column * finitePageMetrics.pageWidthPx}" y="${row * finitePageMetrics.pageHeightPx}" width="${finitePageMetrics.pageWidthPx}" height="${finitePageMetrics.pageHeightPx}" fill="${isDarkMode ? '#242424' : '#ffffff'}" stroke="${isDarkMode ? '#7a7a7a' : '#8a8a8a'}" stroke-width="1"/>`;
        }).join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    defs +
    bgRect +
    pageRects +
    nativeBody +
    arrowBody +
    bondGroupOpen +
    bondBody +
    bondGroupClose +
    atomBody +
    textBody +
    `</svg>`
  );
}

export function generateCanvasSVG(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  isDarkMode: boolean,
  transparent = false,
  textBoxes: TextBox[] = [],
  pageSetup?: PageSetup,
): string {
  const { documentStyleSettings, documentViewSettings, chemDrawDocument } = useStore.getState();
  return generateCanvasSVGWithContext(atoms, bonds, arrows, {
    chemDrawDocument,
    documentStyleSettings,
    documentViewSettings,
    isDarkMode,
    transparent,
    textBoxes,
    pageSetup,
  });
}

export function generateDocumentSVG(
  document: ChemDrawDocument,
  options?: {
    documentStyleSettings?: Partial<DocumentStyleSettings> | DocumentStyleSettings;
    documentViewSettings?: Partial<DocumentViewSettings> | DocumentViewSettings;
    isDarkMode?: boolean;
    transparent?: boolean;
    pageSetup?: PageSetup;
  },
): string {
  const documentStyleSettings = normalizeDocumentStyleSettings(
    options?.documentStyleSettings ??
      document.metadata?.documentStyleSettings ??
      DEFAULT_DOCUMENT_STYLE_SETTINGS,
  );
  const documentViewSettings = normalizeDocumentViewSettings(
    options?.documentViewSettings ??
      document.metadata?.documentViewSettings ??
      CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  );
  const pageSetup = options?.pageSetup ?? document.metadata?.pageSetup;
  const { state } = chemDrawDocumentToCanvasState({
    ...document,
    metadata: {
      ...document.metadata,
      documentStyleSettings,
      documentViewSettings,
      ...(pageSetup ? { pageSetup } : {}),
    },
  });

  return generateCanvasSVGWithContext(state.atoms, state.bonds, state.arrows, {
    chemDrawDocument: document,
    documentStyleSettings,
    documentViewSettings,
    isDarkMode: options?.isDarkMode ?? false,
    transparent: options?.transparent ?? false,
    textBoxes: state.textBoxes ?? [],
    pageSetup,
  });
}
