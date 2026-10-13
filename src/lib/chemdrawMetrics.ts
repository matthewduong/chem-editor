import type { ArrowType, TextRun } from '../types/chemistry';
import type { ChemDrawArrow, ChemDrawArrowHeadType, ChemDrawBond } from '../types/chemdraw';
import type { ChemDrawStyleSheet, DocumentStyleSettings, TextFormat } from '../types/settings';
import { getFaceMetrics } from './textMetrics';

const ACS_1996_BOND_LENGTH = 14.4;

export const DEFAULT_CANVAS_BOND_LENGTH = ACS_1996_BOND_LENGTH;

export const DEFAULT_CHEMDRAW_STYLE_SHEET: ChemDrawStyleSheet = {
  // Match the ACS Document 1996 ChemDraw drawing defaults.
  bondLength: ACS_1996_BOND_LENGTH,
  lineWidth: 0.6,
  boldWidth: 2,
  bondSpacingPct: 18,
  marginWidth: 1.6,
  hashSpacing: 2.5,
  labelSize: 10,
  captionSize: 10,
  labelFace: 96,
  captionFace: 0,
  labelFontFamily: 'Helvetica',
  captionFontFamily: 'Helvetica',
};

const DEFAULT_CANVAS_SCALE = DEFAULT_CANVAS_BOND_LENGTH / DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength;

type TextFormatLike = Pick<TextFormat, 'fontFamily' | 'fontSize'>;
type StyleSettingsLike = Pick<DocumentStyleSettings, 'bondLength' | 'nativeMetrics'>;
type LabelAlignment = 'left' | 'center' | 'right' | 'above' | 'below' | undefined;
type TextRunFaceStyle = Pick<TextRun, 'bold' | 'italic' | 'sub' | 'sup' | 'formula'>;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeFontFamily(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The document's native bond length, guarded against values that would break the scale it defines.
 *
 * **Every** conversion between native and canvas units has to go through this. Import used to scale
 * coordinates by the raw `BondLength` while the style sheet clamped it, so the two disagreed and a
 * document declaring `BondLength="7.2"` came back from a round trip with every coordinate
 * multiplied by 8/7.2 -- nodes at (100, 200) exported as (111.11, 222.22).
 *
 * The floor is a guard against zero, negative and absurd values rather than a style opinion, so it
 * sits well below any bond length a real document would use. The ACS default is 14.4.
 */
export function normalizeNativeBondLength(value: unknown): number {
  return clampNumber(value, DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength, 1, 240);
}

function getCanvasScaleFromValues(canvasBondLength: number, nativeBondLength: number): number {
  if (!Number.isFinite(canvasBondLength) || canvasBondLength <= 0) return DEFAULT_CANVAS_SCALE;
  if (!Number.isFinite(nativeBondLength) || nativeBondLength <= 0) return DEFAULT_CANVAS_SCALE;
  return canvasBondLength / nativeBondLength;
}

function nativeToCanvas(value: number, canvasScale: number): number {
  return value * canvasScale;
}

function canvasToNative(value: number, canvasScale: number): number {
  return value / canvasScale;
}

export function getDocumentCanvasScale(settings?: StyleSettingsLike | null): number {
  return getCanvasScaleFromValues(
    settings?.bondLength ?? DEFAULT_CANVAS_BOND_LENGTH,
    settings?.nativeMetrics?.bondLength ?? DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength,
  );
}

export function convertNativeToCanvas(value: number, settings?: StyleSettingsLike | null): number {
  return nativeToCanvas(value, getDocumentCanvasScale(settings));
}

export function convertCanvasToNative(value: number, settings?: StyleSettingsLike | null): number {
  return canvasToNative(value, getDocumentCanvasScale(settings));
}

export function normalizeChemDrawStyleSheet(
  value: Partial<ChemDrawStyleSheet> | undefined,
  options: {
    canvasBondLength: number;
    legacyBondLineWidth?: number;
    legacyTextFormat?: Partial<TextFormatLike>;
  },
): ChemDrawStyleSheet {
  const normalizedBondLength = normalizeNativeBondLength(value?.bondLength);
  const canvasScale = getCanvasScaleFromValues(options.canvasBondLength, normalizedBondLength);
  const legacyLineWidth =
    typeof options.legacyBondLineWidth === 'number'
      ? clampNumber(options.legacyBondLineWidth, NaN, 0.2, 40)
      : NaN;
  const legacyFontSize =
    typeof options.legacyTextFormat?.fontSize === 'number'
      ? clampNumber(options.legacyTextFormat.fontSize, NaN, 4, 160)
      : NaN;
  const hasLegacyFontFamily =
    typeof options.legacyTextFormat?.fontFamily === 'string' &&
    options.legacyTextFormat.fontFamily.trim().length > 0;
  const normalizedLineWidth = clampNumber(
    Number.isNaN(legacyLineWidth) ? value?.lineWidth : canvasToNative(legacyLineWidth, canvasScale),
    DEFAULT_CHEMDRAW_STYLE_SHEET.lineWidth,
    0.1,
    40,
  );
  const normalizedCaptionSize = clampNumber(
    Number.isNaN(legacyFontSize) ? value?.captionSize : canvasToNative(legacyFontSize, canvasScale),
    value?.captionSize != null
      ? clampNumber(value.captionSize, DEFAULT_CHEMDRAW_STYLE_SHEET.captionSize, 4, 160)
      : DEFAULT_CHEMDRAW_STYLE_SHEET.captionSize,
    4,
    160,
  );
  const normalizedLabelSize = clampNumber(
    value?.labelSize,
    value?.labelSize != null
      ? clampNumber(value.labelSize, DEFAULT_CHEMDRAW_STYLE_SHEET.labelSize, 4, 160)
      : DEFAULT_CHEMDRAW_STYLE_SHEET.labelSize,
    4,
    160,
  );
  const normalizedCaptionFontFamily = normalizeFontFamily(
    hasLegacyFontFamily ? options.legacyTextFormat?.fontFamily : value?.captionFontFamily,
    DEFAULT_CHEMDRAW_STYLE_SHEET.captionFontFamily,
  );

  return {
    bondLength: normalizedBondLength,
    lineWidth: normalizedLineWidth,
    boldWidth: clampNumber(value?.boldWidth, DEFAULT_CHEMDRAW_STYLE_SHEET.boldWidth, 0.1, 60),
    bondSpacingPct: clampNumber(
      value?.bondSpacingPct,
      DEFAULT_CHEMDRAW_STYLE_SHEET.bondSpacingPct,
      1,
      100,
    ),
    marginWidth: clampNumber(value?.marginWidth, DEFAULT_CHEMDRAW_STYLE_SHEET.marginWidth, 0.1, 40),
    hashSpacing: clampNumber(value?.hashSpacing, DEFAULT_CHEMDRAW_STYLE_SHEET.hashSpacing, 0.1, 40),
    labelSize: normalizedLabelSize,
    captionSize: normalizedCaptionSize,
    labelFace: clampNumber(value?.labelFace, DEFAULT_CHEMDRAW_STYLE_SHEET.labelFace, 0, 65535),
    captionFace: clampNumber(
      value?.captionFace,
      DEFAULT_CHEMDRAW_STYLE_SHEET.captionFace,
      0,
      65535,
    ),
    labelFontFamily: normalizeFontFamily(
      value?.labelFontFamily,
      DEFAULT_CHEMDRAW_STYLE_SHEET.labelFontFamily,
    ),
    captionFontFamily: normalizedCaptionFontFamily,
  };
}

export function getDocumentBondLineWidth(settings: StyleSettingsLike): number {
  return convertNativeToCanvas(settings.nativeMetrics.lineWidth, settings);
}

export function getDocumentLabelFontSize(settings: StyleSettingsLike): number {
  return convertNativeToCanvas(settings.nativeMetrics.labelSize, settings);
}

export function getDocumentCaptionFontSize(settings: StyleSettingsLike): number {
  return convertNativeToCanvas(settings.nativeMetrics.captionSize, settings);
}

export const DEFAULT_CHEMDRAW_LABEL_FONT_SIZE = getDocumentLabelFontSize({
  bondLength: DEFAULT_CANVAS_BOND_LENGTH,
  nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
});

export const DEFAULT_CHEMDRAW_CAPTION_FONT_SIZE = getDocumentCaptionFontSize({
  bondLength: DEFAULT_CANVAS_BOND_LENGTH,
  nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
});

function resolveCanvasFontSize(
  authoredCanvasFontSize: unknown,
  nativeFontSize: unknown,
  fallbackNativeFontSize: number,
  settings: StyleSettingsLike,
): number {
  if (isFinitePositiveNumber(authoredCanvasFontSize)) return authoredCanvasFontSize;
  if (isFinitePositiveNumber(nativeFontSize))
    return convertNativeToCanvas(nativeFontSize, settings);
  return convertNativeToCanvas(fallbackNativeFontSize, settings);
}

function normalizeChemDrawFace(face: number): number {
  if (face >= 96 && face < 128) return face - 96;
  return face;
}

function decodeChemDrawFaceStyles(face: unknown): TextRunFaceStyle {
  if (!Number.isFinite(face)) return {};
  const normalizedFace = normalizeChemDrawFace(face as number);
  return {
    // Face 96 is the formula face: digits are subscripted when the run is drawn.
    ...(((face as number) & 96) === 96 && (face as number) < 128 ? { formula: true } : {}),
    ...(normalizedFace & 1 ? { bold: true } : {}),
    ...(normalizedFace & 2 ? { italic: true } : {}),
    ...(normalizedFace & 32 ? { sub: true } : {}),
    ...(normalizedFace & 64 ? { sup: true } : {}),
  };
}

export function resolveDocumentLabelTextStyle(
  settings: StyleSettingsLike,
  options?: {
    authored?: Partial<TextFormatLike> | null;
    nativeStyle?: Partial<TextFormatLike> | null;
  },
): TextFormatLike {
  return {
    fontFamily: normalizeFontFamily(
      options?.authored?.fontFamily,
      normalizeFontFamily(options?.nativeStyle?.fontFamily, settings.nativeMetrics.labelFontFamily),
    ),
    fontSize: resolveCanvasFontSize(
      options?.authored?.fontSize,
      options?.nativeStyle?.fontSize,
      settings.nativeMetrics.labelSize,
      settings,
    ),
  };
}

export function resolveDocumentLabelFaceStyle(
  settings: StyleSettingsLike,
  options?: {
    nativeFace?: number | null;
  },
): TextRunFaceStyle {
  return decodeChemDrawFaceStyles(options?.nativeFace ?? settings.nativeMetrics.labelFace);
}

export function resolveDocumentCaptionTextStyle(
  settings: StyleSettingsLike,
  options?: {
    authored?: Partial<TextFormatLike> | null;
    nativeStyle?: Partial<TextFormatLike> | null;
  },
): TextFormatLike {
  return {
    fontFamily: normalizeFontFamily(
      options?.authored?.fontFamily,
      normalizeFontFamily(
        options?.nativeStyle?.fontFamily,
        settings.nativeMetrics.captionFontFamily,
      ),
    ),
    fontSize: resolveCanvasFontSize(
      options?.authored?.fontSize,
      options?.nativeStyle?.fontSize,
      settings.nativeMetrics.captionSize,
      settings,
    ),
  };
}

export function getNodeLabelVerticalOffset(
  labelAlignment: LabelAlignment,
  fontSize: number,
): number {
  if (labelAlignment === 'above') return -fontSize * 0.7;
  if (labelAlignment === 'below') return fontSize * 0.55;
  return 0;
}

/**
 * How far below the atom centre ChemDraw puts an atom label's baseline, as a fraction of the
 * face's cap height.
 *
 * Measured by handing ChemDraw heteroatoms with no label of their own and reading back the anchor
 * it chose: 0.5298, 0.5287, 0.5291, 0.5293, 0.5295, 0.5297 and 0.5293 at 6, 8, 10, 12, 14, 18 and
 * 24pt. Steady over a fourfold range, where the same measurement expressed as "half the cap height
 * plus a constant" is not, so this is a ratio rather than a centring plus a fudge.
 *
 * Slightly more than half, so the label sits a shade low of a true cap-box centring.
 */
const ATOM_LABEL_BASELINE_CAP_FRACTION = 0.5293;

/**
 * Baseline-to-baseline distance in a multi-line text object, as a multiple of the font size.
 *
 * ChemDraw's automatic leading, which is what every text object in the reference corpus asks for:
 * 1316 declare `LineHeight="auto"`, 28 declare `variable`, and none give a number. Fitting box
 * height against line count over the 94 multi-line captions in the corpus puts the line advance at
 * 10.839pt for 10pt text.
 *
 * We previously advanced by exactly the font size, which sets multi-line captions about 8% tight.
 */
export const AUTO_LINE_HEIGHT_RATIO = 1.084;

/**
 * Baselines of a stacked atom label (`N` over `H`, or `H` over `N`), as offsets from the atom's
 * y, y down.
 *
 * Measured on ChemDraw 26.1.0.6801 (2026-10-13) at 8, 10, 12, 16 and 24pt by saving a document
 * whose heteroatoms had no label and reading the baseline (`p`) and `BoundingBox` ChemDraw wrote:
 * the lead element's baseline is half a cap height below the atom (0.358 em, 3.58 at 10pt); the
 * second line is 0.835 em from it (8.35 at 10pt, 20.04 at 24pt). When the hydrogens are above and
 * carry a subscript count (`H2`) the pitch grows by the subscript's drop, 0.218-0.224 em
 * (NH 8.35, SiH2 10.53 at 10pt). Charge adds a further 0.05 em at most, which is not modelled.
 */
export function getStackedLabelBaselines(
  fontSize: number,
  side: 'above' | 'below',
  hydrogensHaveSubscript: boolean,
  hydrogensHaveCharge = false,
): { lead: number; hydrogens: number } {
  if (!isFinitePositiveNumber(fontSize)) return { lead: 0, hydrogens: 0 };
  const lead = fontSize * STACKED_LABEL_LEAD_BASELINE_EM;
  const pitch = fontSize * STACKED_LABEL_LINE_PITCH_EM;
  if (side === 'below') return { lead, hydrogens: lead + pitch };
  const drop = hydrogensHaveSubscript ? fontSize * STACKED_LABEL_SUBSCRIPT_DROP_EM : 0;
  // A charge sign on the upper line raises it a further 0.058 em (NH2+ above: 42.55 against 43.13).
  const charge = hydrogensHaveCharge ? fontSize * 0.058 : 0;
  return { lead, hydrogens: lead - pitch - drop - charge };
}

/** Half of Arial's 0.716 em cap height; measured with Arial only. */
const STACKED_LABEL_LEAD_BASELINE_EM = 0.358;
const STACKED_LABEL_LINE_PITCH_EM = 0.835;
const STACKED_LABEL_SUBSCRIPT_DROP_EM = 0.22;

/**
 * Distance from an atom's centre down to its label's baseline.
 *
 * Cap height rather than point size because that is what tracks the face: across Arial, a serif and
 * a monospace face at the same point size ChemDraw's offset moves with the cap height, not the
 * size. The remaining disagreement on non-sans faces is our own metrics approximating them, since
 * `FONT_METRICS` carries one representative face per generic family.
 */
export function getAtomLabelBaselineOffset(
  fontSize: number,
  fontFamily?: string,
  faceStyle?: { bold?: boolean; italic?: boolean },
): number {
  if (!isFinitePositiveNumber(fontSize)) return 0;
  const { capHeight } = getFaceMetrics({
    family: fontFamily ?? DEFAULT_CHEMDRAW_STYLE_SHEET.labelFontFamily,
    sizePx: fontSize,
    bold: Boolean(faceStyle?.bold),
    italic: Boolean(faceStyle?.italic),
  });
  return capHeight * ATOM_LABEL_BASELINE_CAP_FRACTION;
}

export function getDefaultArrowHeadType(type?: ArrowType): ChemDrawArrowHeadType {
  if (type === 'retrosynthetic') return 'angle';
  if (type === 'fat') return 'filled';
  return 'solid';
}

export function resolveArrowHeadType(
  options: {
    type?: ArrowType;
  },
  nativeArrow?: Pick<ChemDrawArrow, 'headType'> | null,
): ChemDrawArrowHeadType {
  return nativeArrow?.headType ?? getDefaultArrowHeadType(options.type);
}

export interface ResolvedDocumentRenderMetrics {
  canvasScale: number;
  bondLength: number;
  lineWidth: number;
  boldWidth: number;
  bondSpacing: number;
  marginWidth: number;
  hashSpacing: number;
  labelFontSize: number;
  captionFontSize: number;
}

export function resolveDocumentRenderMetrics(
  settings: StyleSettingsLike,
): ResolvedDocumentRenderMetrics {
  const canvasScale = getDocumentCanvasScale(settings);
  return {
    canvasScale,
    bondLength: settings.bondLength,
    lineWidth: nativeToCanvas(settings.nativeMetrics.lineWidth, canvasScale),
    boldWidth: nativeToCanvas(settings.nativeMetrics.boldWidth, canvasScale),
    bondSpacing: (settings.bondLength * settings.nativeMetrics.bondSpacingPct) / 100,
    marginWidth: nativeToCanvas(settings.nativeMetrics.marginWidth, canvasScale),
    hashSpacing: nativeToCanvas(settings.nativeMetrics.hashSpacing, canvasScale),
    labelFontSize: nativeToCanvas(settings.nativeMetrics.labelSize, canvasScale),
    captionFontSize: nativeToCanvas(settings.nativeMetrics.captionSize, canvasScale),
  };
}

export function resolveBondSpacing(
  settings: StyleSettingsLike,
  nativeBond?: Pick<ChemDrawBond, 'bondSpacingAbs' | 'bondSpacingPct'> | null,
): number {
  if (
    typeof nativeBond?.bondSpacingAbs === 'number' &&
    Number.isFinite(nativeBond.bondSpacingAbs)
  ) {
    return convertNativeToCanvas(nativeBond.bondSpacingAbs, settings);
  }
  const spacingPct =
    typeof nativeBond?.bondSpacingPct === 'number' && Number.isFinite(nativeBond.bondSpacingPct)
      ? nativeBond.bondSpacingPct
      : settings.nativeMetrics.bondSpacingPct;
  return (settings.bondLength * spacingPct) / 100;
}

type ArrowGeometryDefaults = {
  minHeadSize: number;
  headSizeRatio: number;
  minHeadCenterSize: number;
  headCenterSizeRatio: number;
  minHeadWidth: number;
  headWidthRatio: number;
  minShaftSpacing: number;
  shaftSpacingRatio: number;
  equilibriumRatio: number;
};

const DEFAULT_ARROW_GEOMETRY: ArrowGeometryDefaults = {
  minHeadSize: 8 / DEFAULT_CANVAS_SCALE,
  headSizeRatio: 4.4,
  minHeadCenterSize: 7 / DEFAULT_CANVAS_SCALE,
  headCenterSizeRatio: 3.6,
  minHeadWidth: 3.4 / DEFAULT_CANVAS_SCALE,
  headWidthRatio: 1.9,
  minShaftSpacing: 3.5 / DEFAULT_CANVAS_SCALE,
  shaftSpacingRatio: 1.8,
  equilibriumRatio: 1,
};

const ARROW_GEOMETRY_DEFAULTS: Record<ArrowType, ArrowGeometryDefaults> = {
  reaction: DEFAULT_ARROW_GEOMETRY,
  'dashed-reaction': DEFAULT_ARROW_GEOMETRY,
  'no-reaction': DEFAULT_ARROW_GEOMETRY,
  resonance: DEFAULT_ARROW_GEOMETRY,
  curved: DEFAULT_ARROW_GEOMETRY,
  'half-curved': {
    ...DEFAULT_ARROW_GEOMETRY,
    minHeadSize: 7 / DEFAULT_CANVAS_SCALE,
    headSizeRatio: 3.6,
    minHeadCenterSize: 6 / DEFAULT_CANVAS_SCALE,
    headCenterSizeRatio: 3.1,
  },
  equilibrium: {
    ...DEFAULT_ARROW_GEOMETRY,
    minHeadSize: 7.2 / DEFAULT_CANVAS_SCALE,
    headSizeRatio: 3.9,
    minHeadCenterSize: 6.4 / DEFAULT_CANVAS_SCALE,
    headCenterSizeRatio: 3.4,
    minHeadWidth: 3.1 / DEFAULT_CANVAS_SCALE,
    headWidthRatio: 1.65,
    equilibriumRatio: 1,
  },
  retrosynthetic: {
    ...DEFAULT_ARROW_GEOMETRY,
    minShaftSpacing: 3.8 / DEFAULT_CANVAS_SCALE,
    shaftSpacingRatio: 1.9,
  },
  fat: {
    minHeadSize: 12 / DEFAULT_CANVAS_SCALE,
    headSizeRatio: 1.05,
    minHeadCenterSize: 10.8 / DEFAULT_CANVAS_SCALE,
    headCenterSizeRatio: 0.94,
    minHeadWidth: 5.4 / DEFAULT_CANVAS_SCALE,
    headWidthRatio: 0.45,
    minShaftSpacing: 0,
    shaftSpacingRatio: 0,
    equilibriumRatio: 1,
  },
};

export interface ResolvedArrowGeometryMetrics {
  lineWidth: number;
  headSize: number;
  headCenterSize: number;
  headWidth: number;
  shaftSpacing: number;
  equilibriumRatio: number;
}

type NativeArrowGeometry = Pick<
  ChemDrawArrow,
  'headSize' | 'headCenterSize' | 'headWidth' | 'shaftSpacing' | 'equilibriumRatio'
> & {
  style?: Pick<NonNullable<ChemDrawArrow['style']>, 'lineWidth' | 'lineType'>;
};

export function getDefaultArrowLineWidth(
  type?: ArrowType,
  lineStyle?: 'solid' | 'dashed' | 'bold',
  settings?: StyleSettingsLike | null,
): number {
  const metrics = resolveDocumentRenderMetrics(
    settings ?? {
      bondLength: DEFAULT_CANVAS_BOND_LENGTH,
      nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
    },
  );
  if (type === 'fat') return metrics.boldWidth * 2;
  if (lineStyle === 'bold') return metrics.boldWidth;
  return metrics.lineWidth;
}

function normalizeEquilibriumRatio(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 1;
  if ((value ?? 0) > 10) return (value ?? 0) / 100;
  return value ?? 1;
}

export function resolveArrowGeometryMetrics(
  options: {
    type?: ArrowType;
    lineStyle?: 'solid' | 'dashed' | 'bold';
    lineWidth?: number;
  },
  settings?: StyleSettingsLike | null,
  nativeArrow?: NativeArrowGeometry | null,
): ResolvedArrowGeometryMetrics {
  const effectiveSettings =
    settings ??
    ({
      bondLength: DEFAULT_CANVAS_BOND_LENGTH,
      nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
    } satisfies StyleSettingsLike);
  const defaults = ARROW_GEOMETRY_DEFAULTS[options.type ?? 'reaction'] ?? DEFAULT_ARROW_GEOMETRY;
  const effectiveLineStyle = nativeArrow?.style?.lineType ?? options.lineStyle;
  const lineWidth =
    options.lineWidth ??
    (typeof nativeArrow?.style?.lineWidth === 'number'
      ? convertNativeToCanvas(nativeArrow.style.lineWidth, effectiveSettings)
      : getDefaultArrowLineWidth(options.type, effectiveLineStyle, effectiveSettings));
  const resolveLength = (
    nativeValue: number | undefined,
    minNative: number,
    ratio: number,
  ): number =>
    typeof nativeValue === 'number' && Number.isFinite(nativeValue)
      ? convertNativeToCanvas(nativeValue, effectiveSettings)
      : Math.max(convertNativeToCanvas(minNative, effectiveSettings), lineWidth * ratio);
  return {
    lineWidth,
    headSize: resolveLength(nativeArrow?.headSize, defaults.minHeadSize, defaults.headSizeRatio),
    headCenterSize: resolveLength(
      nativeArrow?.headCenterSize,
      defaults.minHeadCenterSize,
      defaults.headCenterSizeRatio,
    ),
    headWidth: resolveLength(
      nativeArrow?.headWidth,
      defaults.minHeadWidth,
      defaults.headWidthRatio,
    ),
    shaftSpacing: resolveLength(
      nativeArrow?.shaftSpacing,
      defaults.minShaftSpacing,
      defaults.shaftSpacingRatio,
    ),
    equilibriumRatio: normalizeEquilibriumRatio(
      nativeArrow?.equilibriumRatio ?? defaults.equilibriumRatio,
    ),
  };
}

/**
 * How far, in em, ChemDraw moves a label's baseline down when it carries a superscript.
 *
 * Measured on ChemDraw 26.1.0.6801 (2026-10-13): `Na+`, `Ca2+`, `NH3+`, `O-` and `C2+` at 10 and
 * 20pt. A charge sign alone moved the baseline 0.042 em (4.0 against 3.58 at 10pt), a superscript
 * digit with it 0.091 em (4.49), the same at both sizes.
 */
export function getSuperscriptBaselineShift(runs: Array<{ text: string; sup?: boolean }>): number {
  const superscripts = runs.filter((run) => run.sup);
  if (superscripts.length === 0) return 0;
  return superscripts.some((run) => /[0-9]/.test(run.text)) ? 0.091 : 0.042;
}
