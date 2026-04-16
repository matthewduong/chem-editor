/**
 * cdxml.ts — ChemDraw CDXML import/export
 *
 * ChemDraw coordinate units: points at 72 dpi. A default ChemDraw bond is 30pt.
 * Our default canvas bond is 45px, corresponding to ChemDraw's 30-unit default.
 * Export scales are resolved per document from native BondLength / canvas bond length.
 *
 * Critical structure rule:
 *   CDXML requires atoms+bonds to be grouped inside <fragment> elements.
 *   Multiple disconnected molecules → multiple <fragment> elements.
 *   Without this ChemDraw ignores the structure.
 */

import {
  Atom,
  Bond,
  Arrow,
  ArrowType,
  type ChemicalTextMetadata,
  TextBox,
  TextRun,
} from '../types/chemistry';
import type { DocumentStyleSettings, PagePresetId, PageSetup } from '../types/settings';
import type {
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawBracket,
  ChemDrawBounds,
  ChemDrawConversionResult,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawFragment,
  ChemDrawGraphic,
  ChemDrawNode,
  ChemDrawObject,
  ChemDrawObjectTag,
  ChemDrawPreservationMetadata,
  ChemDrawTable,
  ChemDrawText,
} from '../types/chemdraw';
import { canvasStateToChemDrawDocument, chemDrawDocumentToCanvasState } from '../lib/chemdrawModel';
import {
  getAtomDisplayText,
  getAtomHydrogenCount,
  inferAtomLabelFromDisplayedText,
} from '../lib/atomLabels';
import { getAtomAlias, getAtomLeadElement } from '../lib/atomIdentity';
import { VALENCIES } from '../lib/elements';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../lib/settings';
import {
  DEFAULT_CANVAS_BOND_LENGTH,
  DEFAULT_CHEMDRAW_STYLE_SHEET,
  convertCanvasToNative,
  getDefaultArrowHeadType,
  getDocumentBondLineWidth,
  getDocumentCaptionFontSize,
  normalizeChemDrawStyleSheet,
  resolveArrowGeometryMetrics,
} from '../lib/chemdrawMetrics';
import {
  DEFAULT_PAGE_SETUP,
  getPageSetupDimensionsPx,
  inferImportedPageSetup,
  normalizePageSetup,
} from '../lib/settings';
import { SHORTHAND_DATA } from '../lib/shorthand';
import { extractEmbeddedPreviewData } from '../lib/embeddedObjects';

const DEFAULT_SCALE_FACTOR = DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength / DEFAULT_CANVAS_BOND_LENGTH;
const CANVAS_BOND_PX = DEFAULT_CANVAS_BOND_LENGTH;
const CHEMDRAW_ARROW_METRIC_SCALE = 100;
const CHEM_EDITOR_CHEMICAL_METADATA_ATTR = 'ChemEditorChemicalMetadata';
const CHEM_EDITOR_TEXT_SEMANTIC_MODE_ATTR = 'ChemEditorTextSemanticMode';
const CHEM_EDITOR_TEXT_CONVERSION_STATUS_ATTR = 'ChemEditorTextConversionStatus';
const CHEM_EDITOR_DOUBLE_BOND_MODE_ATTR = 'ChemEditorDoubleBondMode';
const CHEM_EDITOR_ARROW_TYPE_ATTR = 'ChemEditorArrowType';
const CHEM_EDITOR_ARROW_CURVE_ENABLED_ATTR = 'ChemEditorArrowCurveEnabled';
const CHEM_EDITOR_ELECTRON_ANGLES_ATTR = 'ChemEditorElectronAngles';
const CHEM_EDITOR_RING_TEMPLATE_ATOM_MEMBERSHIPS_ATTR = 'ChemEditorRingTemplateAtomMemberships';
const CHEM_EDITOR_RING_TEMPLATE_BOND_MEMBERSHIPS_ATTR = 'ChemEditorRingTemplateBondMemberships';
const DEFAULT_CHEMDRAW_COLORS = [
  { hex: '#ffffff', r: 1, g: 1, b: 1 }, // index 2
  { hex: '#000000', r: 0, g: 0, b: 0 }, // index 3
  { hex: '#ff0000', r: 1, g: 0, b: 0 }, // index 4
  { hex: '#ffff00', r: 1, g: 1, b: 0 }, // index 5
  { hex: '#00ff00', r: 0, g: 1, b: 0 }, // index 6
  { hex: '#00ffff', r: 0, g: 1, b: 1 }, // index 7
  { hex: '#0000ff', r: 0, g: 0, b: 1 }, // index 8
  { hex: '#ff00ff', r: 1, g: 0, b: 1 }, // index 9
] as const;

// Stereo-descriptor annotations like "(S)", "(1R,2S)", "(±)", "(rel)" appear as
// <t> children of <n> atoms in ChemDraw CDXML.  They are purely visual annotations
// placed at the atom position — NOT the atom's chemical label.  Without this guard
// they would be imported as the atom's alias, showing "(S)" instead of the element.
function isStereodescriptor(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('(') || !t.endsWith(')')) return false;
  const inner = t.slice(1, -1).trim();
  // Position-numbered R/S/E/Z descriptors: "S", "1R,2S", "R,S", "±", etc.
  if (/^[0-9,\s]*[RSEZrsez±][,\s0-9RSEZrsez±*]*$/.test(inner)) return true;
  // Named configuration words
  if (/^(rel|abs|rac|d|l|dl|\+|-)$/i.test(inner)) return true;
  // Greek metal-complex helical descriptors
  if (/^[ΔΛ]$/.test(inner)) return true;
  return false;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseChemDrawBoolean(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true') return true;
  if (normalized === 'no' || normalized === 'false') return false;
  return undefined;
}

function serializeRingTemplateAtomMemberships(node: ChemDrawNode): string | undefined {
  if (!node.ringTemplateMemberships?.length) return undefined;
  return JSON.stringify(
    node.ringTemplateMemberships.map((membership) => ({
      structureId: membership.structureId,
      family: membership.family,
      preset: membership.preset,
      atomKey: membership.atomKey,
      stereoCarrier:
        node.geometry === 'Tetrahedral' &&
        (node.atomStereo === 'r' || node.atomStereo === 's') &&
        node.bondOrdering?.length
          ? Boolean(membership.nativeStereo)
          : false,
    })),
  );
}

function serializeRingTemplateBondMemberships(bond: ChemDrawBond): string | undefined {
  if (!bond.ringTemplateMemberships?.length) return undefined;
  return JSON.stringify(
    bond.ringTemplateMemberships.map((membership) => ({
      structureId: membership.structureId,
      family: membership.family,
      preset: membership.preset,
      bondKey: membership.bondKey,
    })),
  );
}

function parseRingTemplateBondOrdering(value: string | null): Array<string | 0> | undefined {
  if (!value) return undefined;
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token === '0' ? 0 : token));
  return tokens.length > 0 ? tokens : undefined;
}

function shouldEmitComputedNodeLabel(
  atom: Atom,
  connectedBondCount: number,
  preservedDocumentAttributes?: Record<string, string>,
): boolean {
  const leadElement = getAtomLeadElement(atom);
  if (leadElement !== 'C') return true;
  if (connectedBondCount === 0) return true;

  const showTerminalCarbonLabels =
    parseChemDrawBoolean(preservedDocumentAttributes?.ShowTerminalCarbonLabels) ?? false;
  const showNonTerminalCarbonLabels =
    parseChemDrawBoolean(preservedDocumentAttributes?.ShowNonTerminalCarbonLabels) ?? false;

  return connectedBondCount <= 1 ? showTerminalCarbonLabels : showNonTerminalCarbonLabels;
}

function collectUnhandledAttributes(
  el: Element,
  handledAttributeNames: Iterable<string>,
): Record<string, string> | undefined {
  const handled = new Set(Array.from(handledAttributeNames, (name) => name.toLowerCase()));
  const rawAttributes: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (handled.has(attr.name.toLowerCase())) continue;
    rawAttributes[attr.name] = attr.value;
  }
  return Object.keys(rawAttributes).length > 0 ? rawAttributes : undefined;
}

function collectUnhandledChildren(
  el: Element,
  preserveChild: (child: Element) => boolean,
): string[] | undefined {
  const serializer = new XMLSerializer();
  const rawChildren = Array.from(el.children)
    .filter(preserveChild)
    .map((child) => serializer.serializeToString(child));
  return rawChildren.length > 0 ? rawChildren : undefined;
}

function buildPreservationMetadata(options: {
  el: Element;
  handledAttributeNames: Iterable<string>;
  preserveChild?: (child: Element) => boolean;
  capability?: ChemDrawPreservationMetadata['capability'];
  reasons?: string[];
}): ChemDrawPreservationMetadata | undefined {
  const rawAttributes = collectUnhandledAttributes(options.el, options.handledAttributeNames);
  const rawChildren = options.preserveChild
    ? collectUnhandledChildren(options.el, options.preserveChild)
    : undefined;
  const reasons = options.reasons?.filter(Boolean);
  if (!rawAttributes && !rawChildren && !options.capability && !reasons?.length) return undefined;
  return {
    ...(options.capability ? { capability: options.capability } : {}),
    ...(reasons?.length ? { reasons } : {}),
    ...(rawAttributes ? { rawAttributes } : {}),
    ...(rawChildren ? { rawChildrenXml: rawChildren } : {}),
  };
}

function emitRawAttributes(rawAttributes?: Record<string, string>): string {
  if (!rawAttributes) return '';
  return Object.entries(rawAttributes)
    .map(([name, value]) => ` ${name}="${xmlEscape(value)}"`)
    .join('');
}

function emitRawChildren(rawChildrenXml?: string[], indent: string = ''): string {
  if (!rawChildrenXml?.length) return '';
  return rawChildrenXml
    .map((childXml) => `${indent}${childXml.endsWith('\n') ? childXml : `${childXml}\n`}`)
    .join('');
}

function parseBounds(
  attr: string | null | undefined,
  scaleFactor: number = DEFAULT_SCALE_FACTOR,
): { left: number; top: number; right: number; bottom: number } | undefined {
  if (!attr) return undefined;
  const [left, top, right, bottom] = attr.trim().split(/\s+/).map(Number);
  if ([left, top, right, bottom].some(Number.isNaN)) return undefined;
  return {
    left: left / scaleFactor,
    top: top / scaleFactor,
    right: right / scaleFactor,
    bottom: bottom / scaleFactor,
  };
}

function parseBoundingBoxEndpoints(
  attr: string | null | undefined,
  scaleFactor: number = DEFAULT_SCALE_FACTOR,
):
  | [
      ChemDrawBounds['left'],
      ChemDrawBounds['top'],
      ChemDrawBounds['right'],
      ChemDrawBounds['bottom'],
    ]
  | undefined {
  if (!attr) return undefined;
  const values = attr.trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some(Number.isNaN)) return undefined;
  return [
    values[0] / scaleFactor,
    values[1] / scaleFactor,
    values[2] / scaleFactor,
    values[3] / scaleFactor,
  ];
}

function parsePoint3D(
  attr: string | null | undefined,
  scaleFactor: number = DEFAULT_SCALE_FACTOR,
): { x: number; y: number } | undefined {
  if (!attr) return undefined;
  const values = attr.trim().split(/\s+/).map(Number);
  if (values.length < 2 || values.slice(0, 2).some(Number.isNaN)) return undefined;
  return { x: values[0] / scaleFactor, y: values[1] / scaleFactor };
}

function parseNodeLabelAlignment(
  value: string | null | undefined,
): ChemDrawNode['labelAlignment'] | undefined {
  switch ((value ?? '').toLowerCase()) {
    case 'left':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'above':
      return 'above';
    case 'below':
      return 'below';
    default:
      return undefined;
  }
}

function getDirectChildrenByTagName(el: Element, tagName: string): Element[] {
  return Array.from(el.children).filter((child) => child.tagName === tagName);
}

function hasAncestorTag(el: Element, tagName: string): boolean {
  let parent = el.parentElement;
  while (parent) {
    if (parent.tagName.toLowerCase() === tagName.toLowerCase()) return true;
    parent = parent.parentElement;
  }
  return false;
}

function getClosestPage(el: Element): Element | null {
  let current: Element | null = el;
  while (current) {
    if (current.tagName === 'page') return current;
    current = current.parentElement;
  }
  return null;
}

function isElementOnPage(el: Element, pageEl: Element | null): boolean {
  return Boolean(pageEl) && getClosestPage(el) === pageEl;
}

function getFirstDirectChildByTagName(el: Element, tagName: string): Element | null {
  return getDirectChildrenByTagName(el, tagName)[0] ?? null;
}

function extractGraphicObjectTagText(
  graphicEl: Element,
  preferredTagName?: string,
): string | undefined {
  const objectTags = Array.from(graphicEl.getElementsByTagName('objecttag'));
  if (preferredTagName) {
    const preferred = objectTags.find((tag) => tag.getAttribute('Name') === preferredTagName);
    const preferredText = preferred ? extractTText(preferred.getElementsByTagName('t')[0]) : '';
    if (preferredText) return preferredText;
  }
  for (const objectTag of objectTags) {
    const text = extractTText(objectTag.getElementsByTagName('t')[0]);
    if (text) return text;
  }
  return undefined;
}

function formatCdxmlNumber(value: number, precision = 2): string {
  return value.toFixed(precision).replace(/\.?0+$/, '');
}

function parseChemDrawArrowMetric(...values: Array<string | null | undefined>): number | undefined {
  for (const value of values) {
    const parsed = parseFloat(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    return parsed >= CHEMDRAW_ARROW_METRIC_SCALE ? parsed / CHEMDRAW_ARROW_METRIC_SCALE : parsed;
  }
  return undefined;
}

function formatChemDrawArrowMetric(value: number): string {
  return formatCdxmlNumber(value * CHEMDRAW_ARROW_METRIC_SCALE);
}

function parseChemDrawArrowHeadType(
  value: string | null | undefined,
): ChemDrawArrow['headType'] | undefined {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'solid':
      return 'solid';
    case 'angle':
      return 'angle';
    case 'filled':
      return 'filled';
    case 'hollow':
      return 'hollow';
    default:
      return undefined;
  }
}

function arrowHeadTypeToCdxml(value: ChemDrawArrow['headType'] | undefined): string {
  switch (value) {
    case 'angle':
      return 'Angle';
    case 'filled':
      return 'Filled';
    case 'hollow':
      return 'Hollow';
    case 'solid':
    default:
      return 'Solid';
  }
}

function arrowFillTypeToCdxml(value: ChemDrawArrow['headType'] | undefined): string {
  return value === 'filled' || value === 'hollow' ? 'Solid' : 'None';
}

function boundsToCdxml(bounds: ChemDrawBounds, scaleFactor: number): string {
  return [
    formatCdxmlNumber(bounds.left * scaleFactor),
    formatCdxmlNumber(bounds.top * scaleFactor),
    formatCdxmlNumber(bounds.right * scaleFactor),
    formatCdxmlNumber(bounds.bottom * scaleFactor),
  ].join(' ');
}

function parseQueryList(
  attr: string | null | undefined,
): { values: string[]; negate: boolean } | undefined {
  if (!attr) return undefined;
  const parts = attr.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const negate = parts[0].toUpperCase() === 'NOT';
  return {
    values: negate ? parts.slice(1) : parts,
    negate,
  };
}

function parseBondDisplay(value: string | null | undefined): ChemDrawBond['display'] | undefined {
  if (!value) return undefined;
  switch (value) {
    case 'Solid':
      return 'solid';
    case 'Dash':
      return 'dash';
    case 'DottedHydrogen':
      return 'dotted-hydrogen';
    case 'Hash':
      return 'hash-begin';
    case 'WedgedHashBegin':
      return 'hash-begin';
    case 'WedgedHashEnd':
      return 'hash-end';
    case 'Bold':
      return 'bold';
    case 'WedgeBegin':
      return 'wedge-begin';
    case 'WedgeEnd':
      return 'wedge-end';
    case 'Wavy':
      return 'wavy';
    case 'WavyWedgeBegin':
      return 'wavy';
    case 'WavyWedgeEnd':
      return 'wavy';
    default:
      return undefined;
  }
}

function bondDisplayToCdxml(display: ChemDrawBond['display'] | undefined): string | undefined {
  switch (display) {
    case 'solid':
      return 'Solid';
    case 'dash':
      return 'Dash';
    case 'dotted-hydrogen':
      return 'DottedHydrogen';
    case 'hash-begin':
      return 'WedgedHashBegin';
    case 'hash-end':
      return 'WedgedHashEnd';
    case 'bold':
      return 'Bold';
    case 'wedge-begin':
      return 'WedgeBegin';
    case 'wedge-end':
      return 'WedgeEnd';
    case 'wavy':
      return 'Wavy';
    case 'crossed':
      return 'Wavy';
    default:
      return undefined;
  }
}

function parseBondOrder(value: string | null | undefined): {
  order?: number;
  aromatic?: boolean;
  allowedOrders?: number[];
} {
  if (!value) return {};
  const trimmed = value.trim();
  if (trimmed === '1') return { order: 1 };
  if (trimmed === '2') return { order: 2 };
  if (trimmed === '3') return { order: 3 };
  if (trimmed === '1.5') return { order: 1.5, aromatic: true };
  if (trimmed === '0.5') return { order: 0.5 };
  if (trimmed === '2.5') return { order: 2.5 };

  const intValue = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(intValue)) {
    const allowedOrders: number[] = [];
    if (intValue & 0x0001) allowedOrders.push(1);
    if (intValue & 0x0002) allowedOrders.push(2);
    if (intValue & 0x0004) allowedOrders.push(3);
    if (intValue & 0x0080) allowedOrders.push(1.5);
    if (allowedOrders.length === 1) {
      return { order: allowedOrders[0], aromatic: allowedOrders[0] === 1.5 };
    }
    if (allowedOrders.length > 1) return { allowedOrders };
  }

  return {};
}

function bondOrderToCdxml(bond: ChemDrawBond): string | undefined {
  if (bond.query?.allowedOrders && bond.query.allowedOrders.length > 1) {
    let mask = 0;
    for (const order of bond.query.allowedOrders) {
      if (order === 1) mask |= 0x0001;
      else if (order === 2) mask |= 0x0002;
      else if (order === 3) mask |= 0x0004;
      else if (order === 1.5) mask |= 0x0080;
    }
    if (mask) return String(mask);
  }
  if (bond.aromatic || bond.order === 1.5) return '1.5';
  if (bond.order != null) return String(bond.order);
  return undefined;
}

/** Extract concatenated text from all <s> children of a <t> element */
function extractTText(tEl: Element): string {
  const parts: string[] = [];
  const sNodes = tEl.getElementsByTagName('s');
  for (let i = 0; i < sNodes.length; i++) parts.push(sNodes[i].textContent ?? '');
  return parts.join('').trim();
}

function normalizeCdxmlFace(face: number): number {
  // ChemDraw-authored CDXML commonly uses face=96 as the baseline face for
  // ordinary chemical labels. Treat that 96-series as a base offset rather than
  // as literal sub/sup bits.
  if (face >= 96 && face < 128) return face - 96;
  return face;
}

export function decodeCdxmlFaceStyles(
  face: number,
): Pick<TextRun, 'bold' | 'italic' | 'sub' | 'sup'> {
  const normalizedFace = normalizeCdxmlFace(face);
  return {
    ...(normalizedFace & 1 ? { bold: true } : {}),
    ...(normalizedFace & 2 ? { italic: true } : {}),
    ...(normalizedFace & 32 ? { sub: true } : {}),
    ...(normalizedFace & 64 ? { sup: true } : {}),
  };
}

function parseChemicalMetadataAttr(
  value: string | null,
  warnings: string[],
  context: string,
): ChemicalTextMetadata | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ChemicalTextMetadata;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.intent !== 'boolean' ||
      typeof parsed.formula !== 'string' ||
      typeof parsed.chemistryAvailable !== 'boolean'
    ) {
      warnings.push(`${context} chemical metadata was malformed and was ignored.`);
      return undefined;
    }
    return parsed;
  } catch {
    warnings.push(`${context} chemical metadata could not be parsed and was ignored.`);
    return undefined;
  }
}

/** Emit a simple CDXML <t> text element (plain, for labels/annotations) */
function emitT(
  text: string,
  x: number,
  y: number,
  indent: string,
  options?: {
    size?: number;
    color?: number;
    fontId?: number;
    face?: number;
    justification?: 'left' | 'center' | 'right';
    labelAlignment?: ChemDrawNode['labelAlignment'];
  },
): string {
  const xs = x.toFixed(2),
    ys = y.toFixed(2);
  const size = options?.size ?? 12;
  const color = options?.color;
  const fontId = options?.fontId ?? 1;
  const face = options?.face ?? 0;
  const justification =
    options?.justification === 'left'
      ? 'Left'
      : options?.justification === 'right'
        ? 'Right'
        : 'Center';
  const colorAttr = color != null ? ` color="${color}"` : '';
  const labelAlignment =
    options?.labelAlignment === 'above'
      ? 'Above'
      : options?.labelAlignment === 'below'
        ? 'Below'
        : options?.labelAlignment === 'left'
          ? 'Left'
          : options?.labelAlignment === 'right'
            ? 'Right'
            : options?.labelAlignment === 'center'
              ? 'Center'
              : null;
  const labelAlignmentAttr = labelAlignment ? ` LabelAlignment="${labelAlignment}"` : '';
  return `${indent}<t p="${xs} ${ys}" Justification="${justification}"${labelAlignmentAttr}><s font="${fontId}" size="${size}" face="${face}"${colorAttr}>${xmlEscape(text)}</s></t>\n`;
}

// ─── Color table management ───────────────────────────────────────────────────
// ChemDraw colortable: indices 0,1 are reserved; first <color> entry = index 2.
// We always emit white (index 2) and black (index 3) as fixed entries,
// then append any custom colors from TextBox runs.

function hexToRgbF(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

function buildColorTable(
  textBoxes: TextBox[],
  arrows: Arrow[],
  objects: ChemDrawObject[],
): {
  colortableXml: string;
  getIndex: (color: string) => number;
} {
  const entries: Array<{ r: number; g: number; b: number }> = DEFAULT_CHEMDRAW_COLORS.map(
    ({ r, g, b }) => ({ r, g, b }),
  );
  const indexMap = new Map<string, number>(
    DEFAULT_CHEMDRAW_COLORS.map(({ hex }, index) => [hex, index + 2]),
  );

  const addColor = (hex: string) => {
    const n = hex.toLowerCase();
    if (indexMap.has(n)) return;
    const rgb = hexToRgbF(n);
    if (!rgb) return;
    indexMap.set(n, 2 + entries.length);
    entries.push(rgb);
  };

  for (const tb of textBoxes) {
    if (tb.color) addColor(tb.color);
    for (const run of tb.runs) {
      if (run.color) addColor(run.color);
    }
  }
  for (const arrow of arrows) {
    if (arrow.labelColor) addColor(arrow.labelColor);
    if (arrow.strokeColor) addColor(arrow.strokeColor);
  }
  for (const object of objects) {
    if (object.style?.color) addColor(object.style.color);
    if (object.style?.strokeColor) addColor(object.style.strokeColor);
    if (object.style?.fillColor) addColor(object.style.fillColor);
    if (object.style?.backgroundColor) addColor(object.style.backgroundColor);
    for (const tag of object.objectTags ?? []) {
      if (tag.style?.color) addColor(tag.style.color);
      if (tag.style?.strokeColor) addColor(tag.style.strokeColor);
      if (tag.style?.fillColor) addColor(tag.style.fillColor);
      for (const run of tag.text?.runs ?? []) {
        if (run.color) addColor(run.color);
      }
    }
  }

  const colortableXml = entries
    .map((c) => `    <color r="${c.r.toFixed(4)}" g="${c.g.toFixed(4)}" b="${c.b.toFixed(4)}"/>\n`)
    .join('');

  const getIndex = (color: string): number => indexMap.get(color.toLowerCase()) ?? 3; // default black

  return { colortableXml, getIndex };
}

function buildFontTable(
  textBoxes: TextBox[],
  objects: ChemDrawObject[],
  defaultFontFamilies: string[] = [],
): {
  fonttableXml: string;
  getFontId: (fontFamily: string) => number;
  fontNameById: Map<number, string>;
} {
  const fonts = new Map<string, number>();
  const fontNameById = new Map<number, string>();
  const addFont = (fontFamily: string) => {
    const name = fontFamily.trim() || 'Arial';
    if (fonts.has(name)) return fonts.get(name)!;
    const id = fonts.size + 1;
    fonts.set(name, id);
    fontNameById.set(id, name);
    return id;
  };

  addFont('Arial');
  defaultFontFamilies.forEach((fontFamily) => addFont(fontFamily));
  for (const tb of textBoxes) addFont(tb.fontFamily);
  for (const object of objects) {
    if (object.style?.fontFamily) addFont(object.style.fontFamily);
    for (const tag of object.objectTags ?? []) {
      if (tag.style?.fontFamily) addFont(tag.style.fontFamily);
    }
  }

  const fonttableXml = Array.from(fonts.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([name, id]) => `    <font id="${id}" charset="iso-8859-1" name="${xmlEscape(name)}"/>\n`)
    .join('');

  return {
    fonttableXml,
    getFontId: (fontFamily: string) => fonts.get(fontFamily.trim() || 'Arial') ?? 1,
    fontNameById,
  };
}

/** Emit a rich-text CDXML <t> element from a TextBox */
function emitTextBoxT(
  tb: TextBox,
  x: number,
  y: number,
  scaleFactor: number,
  indent: string,
  getColorIndex: (c: string) => number,
  getFontId: (fontFamily: string) => number,
  options?: {
    rawAttributes?: Record<string, string>;
    rawChildrenXml?: string[];
  },
): string {
  const xs = x.toFixed(2),
    ys = y.toFixed(2);
  const just = tb.textAlign === 'left' ? 'Left' : tb.textAlign === 'right' ? 'Right' : 'Center';
  const fontSize = (tb.fontSize ?? 14).toFixed(1);
  const defaultColorIdx = getColorIndex(tb.color ?? '#000000');
  const fontId = getFontId(tb.fontFamily ?? 'Arial');
  const rotationAttr =
    tb.rotation != null ? ` RotationAngle="${Math.round(tb.rotation * 65536)}"` : '';
  const widthAttr =
    tb.width != null && tb.width > 0
      ? ` BoundingBox="${x.toFixed(2)} ${y.toFixed(2)} ${(x + tb.width * scaleFactor).toFixed(2)} ${(y + tb.fontSize * 1.6).toFixed(2)}"`
      : '';
  const chemicalMetadataAttr = tb.chemicalMetadata
    ? ` ${CHEM_EDITOR_CHEMICAL_METADATA_ATTR}="${xmlEscape(JSON.stringify(tb.chemicalMetadata))}"`
    : '';
  const semanticModeAttr = tb.semanticMode
    ? ` ${CHEM_EDITOR_TEXT_SEMANTIC_MODE_ATTR}="${xmlEscape(tb.semanticMode)}"`
    : '';
  const conversionStatusAttr = tb.conversionStatus
    ? ` ${CHEM_EDITOR_TEXT_CONVERSION_STATUS_ATTR}="${xmlEscape(tb.conversionStatus)}"`
    : '';
  const rawAttributesAttr = emitRawAttributes(options?.rawAttributes);

  let out = `${indent}<t p="${xs} ${ys}" Justification="${just}"${rotationAttr}${widthAttr}${chemicalMetadataAttr}${semanticModeAttr}${conversionStatusAttr}${rawAttributesAttr}>\n`;
  for (const run of tb.runs) {
    let face = 0;
    if (run.bold) face |= 1;
    if (run.italic) face |= 2;
    if (run.sub) face |= 32;
    if (run.sup) face |= 64;
    const colorIdx = run.color ? getColorIndex(run.color) : defaultColorIdx;
    out += `${indent}  <s font="${fontId}" size="${fontSize}" face="${face}" color="${colorIdx}">${xmlEscape(run.text)}</s>\n`;
  }
  out += emitRawChildren(options?.rawChildrenXml, `${indent}  `);
  out += `${indent}</t>\n`;
  return out;
}

function emitTextBlockT(options: {
  text: NonNullable<ChemDrawText['text']>;
  anchor: { x: number; y: number };
  indent: string;
  getColorIndex: (color: string) => number;
  getFontId: (fontFamily: string) => number;
  style?: {
    color?: string;
    fontFamily?: string;
    fontSize?: number;
  };
  rawAttributes?: Record<string, string>;
  rawChildrenXml?: string[];
}): string {
  const justification =
    options.text.justification === 'left'
      ? 'Left'
      : options.text.justification === 'right'
        ? 'Right'
        : 'Center';
  const pAttr = ` p="${formatCdxmlNumber(options.anchor.x)} ${formatCdxmlNumber(options.anchor.y)}"`;
  const bboxAttr = options.text.bounds
    ? ` BoundingBox="${boundsToCdxml(options.text.bounds, 1)}"`
    : '';
  const rawAttributesAttr = emitRawAttributes(options.rawAttributes);
  let out = `${options.indent}<t${pAttr} Justification="${justification}"${bboxAttr}${rawAttributesAttr}>\n`;
  for (const run of options.text.runs) {
    let face = 0;
    if (run.bold) face |= 1;
    if (run.italic) face |= 2;
    if (run.sub) face |= 32;
    if (run.sup) face |= 64;
    const color = run.color ?? options.style?.color;
    const colorAttr = color ? ` color="${options.getColorIndex(color)}"` : '';
    out += `${options.indent}  <s font="${options.getFontId(options.style?.fontFamily ?? 'Arial')}" size="${formatCdxmlNumber(options.style?.fontSize ?? 12, 1)}" face="${face}"${colorAttr}>${xmlEscape(run.text)}</s>\n`;
  }
  out += emitRawChildren(options.rawChildrenXml, `${options.indent}  `);
  out += `${options.indent}</t>\n`;
  return out;
}

function emitObjectTags(
  objectTags: ChemDrawObjectTag[] | undefined,
  indent: string,
  scaleFactor: number,
  getColorIndex: (color: string) => number,
  getFontId: (fontFamily: string) => number,
): string {
  if (!objectTags?.length) return '';
  let xml = '';
  for (const tag of objectTags) {
    const visibleAttr = tag.visible === false ? ' Visible="no"' : '';
    const tagTypeAttr = tag.tagType ? ` TagType="${xmlEscape(tag.tagType)}"` : '';
    const nameAttr = ` Name="${xmlEscape(tag.name)}"`;
    const idAttr = tag.id ? ` id="${xmlEscape(tag.id)}"` : '';
    const positioningTypeAttr = tag.positioningType
      ? ` PositioningType="${xmlEscape(tag.positioningType)}"`
      : '';
    const positioningAngleAttr =
      tag.positioningAngle != null
        ? ` PositioningAngle="${formatCdxmlNumber(tag.positioningAngle, 3)}"`
        : '';
    const positioningOffsetAttr = tag.positioningOffset
      ? ` PositioningOffset="${formatCdxmlNumber(tag.positioningOffset.x * scaleFactor)} ${formatCdxmlNumber(tag.positioningOffset.y * scaleFactor)}"`
      : '';
    const rawAttributesAttr = emitRawAttributes(tag.preservation?.rawAttributes);
    const content = tag.text
      ? emitTextBlockT({
          text: {
            ...tag.text,
            ...(tag.text.bounds
              ? {
                  bounds: {
                    left: tag.text.bounds.left * scaleFactor,
                    top: tag.text.bounds.top * scaleFactor,
                    right: tag.text.bounds.right * scaleFactor,
                    bottom: tag.text.bounds.bottom * scaleFactor,
                  },
                }
              : {}),
          },
          anchor: tag.textAnchor
            ? {
                x: tag.textAnchor.x * scaleFactor,
                y: tag.textAnchor.y * scaleFactor,
              }
            : tag.text.bounds
              ? {
                  x: ((tag.text.bounds.left + tag.text.bounds.right) / 2) * scaleFactor,
                  y: ((tag.text.bounds.top + tag.text.bounds.bottom) / 2) * scaleFactor,
                }
              : { x: 0, y: 0 },
          indent: `${indent}  `,
          getColorIndex,
          getFontId,
          style: tag.style,
          rawAttributes: tag.text ? undefined : undefined,
          rawChildrenXml: tag.preservation?.rawChildrenXml,
        })
      : emitRawChildren(tag.preservation?.rawChildrenXml, `${indent}  `);
    xml += content
      ? `${indent}<objecttag${idAttr}${tagTypeAttr}${nameAttr}${visibleAttr}${positioningTypeAttr}${positioningAngleAttr}${positioningOffsetAttr}${rawAttributesAttr}>\n${content}${indent}</objecttag>\n`
      : `${indent}<objecttag${idAttr}${tagTypeAttr}${nameAttr}${visibleAttr}${positioningTypeAttr}${positioningAngleAttr}${positioningOffsetAttr}${rawAttributesAttr}/>\n`;
  }
  return xml;
}

// ─── ID generation ───────────────────────────────────────────────────────────

function makeIdGen() {
  let n = 1;
  return () => (n++).toString();
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function chemDrawDocumentToCDXML(document: ChemDrawDocument): string {
  return chemDrawDocumentToCDXMLInternal(document);
}

export function stateToCDXML(
  state: { atoms: Atom[]; bonds: Bond[]; arrows: Arrow[]; textBoxes?: TextBox[] },
  options?: { documentStyleSettings?: DocumentStyleSettings; pageSetup?: PageSetup },
): string {
  const conversion = canvasStateToChemDrawDocument(
    {
      atoms: state.atoms,
      bonds: state.bonds,
      arrows: state.arrows,
      groups: [],
      textBoxes: state.textBoxes ?? [],
    },
    options,
  );
  return chemDrawDocumentToCDXMLInternal(conversion.document);
}

function chemDrawDocumentToCDXMLInternal(document: ChemDrawDocument): string {
  const getId = makeIdGen();
  const idMap = new Map<string, string>(); // logical id → CDXML id
  const page = document.pages[0];
  const documentStyleSettings =
    document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;
  const preservedDocumentAttributes = document.metadata?.preservedDocumentAttributes;
  const exportScaleFactor =
    documentStyleSettings.nativeMetrics.bondLength / documentStyleSettings.bondLength;
  const pageSetup = normalizePageSetup(document.metadata?.pageSetup ?? DEFAULT_PAGE_SETUP);
  const rawDocumentAttributesAttr = emitRawAttributes(
    document.metadata?.preservedDocumentAttributes,
  );
  const rawPageAttributesAttr = emitRawAttributes(document.metadata?.preservedPageAttributes);
  if (!page) {
    return `<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n<CDXML/>\n`;
  }

  const nodes = page.objects.filter((object): object is ChemDrawNode => object.type === 'node');
  const bonds = page.objects.filter((object): object is ChemDrawBond => object.type === 'bond');
  const fragments = page.objects.filter(
    (object): object is ChemDrawFragment => object.type === 'fragment',
  );
  const arrows = page.objects.filter((object): object is ChemDrawArrow => object.type === 'arrow');
  const textObjects = page.objects.filter(
    (object): object is ChemDrawText => object.type === 'text',
  );
  const brackets = page.objects.filter(
    (object): object is ChemDrawBracket => object.type === 'bracket',
  );
  const graphics = page.objects.filter(
    (object): object is ChemDrawGraphic => object.type === 'graphic',
  );
  const embeddedObjects = page.objects.filter(
    (object): object is ChemDrawEmbeddedObject => object.type === 'embedded-object',
  );
  const tables = page.objects.filter((object): object is ChemDrawTable => object.type === 'table');

  const textBoxes = textObjects.map((text) => ({
    id: text.id,
    x: text.anchor.x,
    y: text.anchor.y,
    runs: text.text.runs,
    fontSize: text.style?.fontSize ?? documentStyleSettings.nativeMetrics.captionSize,
    fontFamily:
      text.style?.fontFamily ?? documentStyleSettings.nativeMetrics.captionFontFamily ?? 'Arial',
    color: text.style?.color ?? '#000000',
    textAlign: text.text.justification ?? 'center',
    ...(text.text.width != null ? { width: text.text.width } : {}),
    ...(text.style?.rotation != null ? { rotation: text.style.rotation } : {}),
  }));
  const arrowStyles = arrows.map((arrow) => ({
    id: arrow.id,
    type: arrow.arrowType,
    x1: arrow.tail.x,
    y1: arrow.tail.y,
    x2: arrow.head.x,
    y2: arrow.head.y,
    cpx: arrow.controlPoint?.x ?? (arrow.tail.x + arrow.head.x) / 2,
    cpy: arrow.controlPoint?.y ?? (arrow.tail.y + arrow.head.y) / 2,
    ...(arrow.textAbove
      ? {
          labelAbove: arrow.textAbove.runs.map((run) => run.text).join(''),
          label: arrow.textAbove.runs.map((run) => run.text).join(''),
        }
      : {}),
    ...(arrow.textBelow
      ? { labelBelow: arrow.textBelow.runs.map((run) => run.text).join('') }
      : {}),
    ...(arrow.style?.fontSize != null ? { labelFontSize: arrow.style.fontSize } : {}),
    ...(arrow.style?.color ? { labelColor: arrow.style.color } : {}),
    ...(arrow.style?.strokeColor ? { strokeColor: arrow.style.strokeColor } : {}),
  }));

  // Build color table from TextBox runs (pre-pass)
  const { colortableXml, getIndex: getColorIndex } = buildColorTable(
    textBoxes,
    arrowStyles,
    page.objects,
  );
  const { fonttableXml, getFontId } = buildFontTable(textBoxes, page.objects, [
    documentStyleSettings.nativeMetrics.labelFontFamily,
    documentStyleSettings.nativeMetrics.captionFontFamily,
  ]);

  // Collect all coordinates to compute a page BoundingBox
  const allX = [
    ...nodes.map((node) => node.position.x * exportScaleFactor),
    ...arrows.flatMap((arrow) => [
      arrow.tail.x * exportScaleFactor,
      arrow.head.x * exportScaleFactor,
    ]),
    ...textObjects.map((text) => text.anchor.x * exportScaleFactor),
    ...brackets
      .flatMap((object) => [object.bounds.left, object.bounds.right])
      .map((value) => value * exportScaleFactor),
    ...graphics
      .flatMap((object) =>
        object.bounds
          ? [object.bounds.left, object.bounds.right]
          : (object.points ?? []).map((point) => point.x),
      )
      .map((value) => value * exportScaleFactor),
    ...embeddedObjects
      .flatMap((object) => [object.bounds.left, object.bounds.right])
      .map((value) => value * exportScaleFactor),
    ...tables
      .flatMap((object) => [object.bounds.left, object.bounds.right])
      .map((value) => value * exportScaleFactor),
  ];
  const allY = [
    ...nodes.map((node) => node.position.y * exportScaleFactor),
    ...arrows.flatMap((arrow) => [
      arrow.tail.y * exportScaleFactor,
      arrow.head.y * exportScaleFactor,
    ]),
    ...textObjects.map((text) => text.anchor.y * exportScaleFactor),
    ...brackets
      .flatMap((object) => [object.bounds.top, object.bounds.bottom])
      .map((value) => value * exportScaleFactor),
    ...graphics
      .flatMap((object) =>
        object.bounds
          ? [object.bounds.top, object.bounds.bottom]
          : (object.points ?? []).map((point) => point.y),
      )
      .map((value) => value * exportScaleFactor),
    ...embeddedObjects
      .flatMap((object) => [object.bounds.top, object.bounds.bottom])
      .map((value) => value * exportScaleFactor),
    ...tables
      .flatMap((object) => [object.bounds.top, object.bounds.bottom])
      .map((value) => value * exportScaleFactor),
  ];
  const pad = 36; // 0.5 inch padding
  const finitePageDimensions = getPageSetupDimensionsPx(pageSetup);
  const pageBounds =
    pageSetup.mode === 'finite'
      ? {
          left: 0,
          top: 0,
          right: finitePageDimensions.totalWidthPx,
          bottom: finitePageDimensions.totalHeightPx,
        }
      : page.bounds;
  const bbL = pageBounds
    ? pageBounds.left * exportScaleFactor
    : allX.length
      ? Math.min(...allX) - pad
      : 0;
  const bbT = pageBounds
    ? pageBounds.top * exportScaleFactor
    : allY.length
      ? Math.min(...allY) - pad
      : 0;
  const bbR = pageBounds
    ? pageBounds.right * exportScaleFactor
    : allX.length
      ? Math.max(...allX) + pad
      : 540;
  const bbB = pageBounds
    ? pageBounds.bottom * exportScaleFactor
    : allY.length
      ? Math.max(...allY) + pad
      : 720;

  let xml = `<?xml version="1.0" encoding="UTF-8" ?>\n`;
  xml += `<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n`;
  xml += `<CDXML BondSpacing="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.bondSpacingPct)}" BondLength="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.bondLength)}" BoldWidth="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.boldWidth)}" LineWidth="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.lineWidth)}" MarginWidth="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.marginWidth)}" HashSpacing="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.hashSpacing)}" ChainAngle="120" LabelFont="${getFontId(documentStyleSettings.nativeMetrics.labelFontFamily)}" CaptionFont="${getFontId(documentStyleSettings.nativeMetrics.captionFontFamily)}" LabelSize="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.labelSize)}" CaptionSize="${formatCdxmlNumber(documentStyleSettings.nativeMetrics.captionSize)}" LabelFace="${Math.round(documentStyleSettings.nativeMetrics.labelFace)}" CaptionFace="${Math.round(documentStyleSettings.nativeMetrics.captionFace)}" ChemEditorBondLength="${formatCdxmlNumber(documentStyleSettings.bondLength)}" ChemEditorBondLineWidth="${formatCdxmlNumber(getDocumentBondLineWidth(documentStyleSettings))}" ChemEditorTextFontFamily="${xmlEscape(documentStyleSettings.textFormat.fontFamily)}" ChemEditorTextFontSize="${formatCdxmlNumber(documentStyleSettings.textFormat.fontSize)}" ChemEditorTextColor="${xmlEscape(documentStyleSettings.textFormat.color)}" ChemEditorTextAlign="${documentStyleSettings.textFormat.textAlign}" ChemEditorBondColor="${xmlEscape(documentStyleSettings.colors.bondColor)}" ChemEditorMonochrome="${documentStyleSettings.colors.monochrome ? 'true' : 'false'}" ChemEditorAtomColors="${xmlEscape(JSON.stringify(documentStyleSettings.colors.atomColors))}" ChemEditorPageMode="${pageSetup.mode}" ChemEditorPageUnit="${pageSetup.unit}" ChemEditorPagePresetId="${pageSetup.presetId}" ChemEditorPageOrientation="${pageSetup.orientation}" ChemEditorPageWidth="${pageSetup.pageWidth}" ChemEditorPageHeight="${pageSetup.pageHeight}" ChemEditorPageRows="${pageSetup.rows}" ChemEditorPageColumns="${pageSetup.columns}"${rawDocumentAttributesAttr}>\n`;
  xml += `  <colortable>\n${colortableXml}  </colortable>\n`;
  xml += `  <fonttable>\n${fonttableXml}  </fonttable>\n`;
  xml += `  <page id="${page.id || getId()}" BoundingBox="${bbL.toFixed(2)} ${bbT.toFixed(2)} ${bbR.toFixed(2)} ${bbB.toFixed(2)}" HeaderPosition="36" FooterPosition="36" PrintTrimMarks="yes" HeightPages="${pageSetup.rows}" WidthPages="${pageSetup.columns}"${rawPageAttributesAttr}>\n`;

  // ── Atoms + bonds, grouped into <fragment> per connected component ──────────
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const bondMap = new Map(bonds.map((bond) => [bond.id, bond]));
  const canvasAtoms: Atom[] = nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    kind: node.alias ? ('alias' as const) : ('element' as const),
    element: node.element ?? 'C',
    ...(node.alias ? { alias: node.alias } : {}),
    ...(node.charge != null ? { charge: node.charge } : {}),
    ...(node.lonePairCount != null ? { lonePairs: node.lonePairCount } : {}),
    ...(node.radicalElectrons != null ? { radicalElectrons: node.radicalElectrons } : {}),
    ...(node.isotope != null ? { isotope: node.isotope } : {}),
    ...(node.style?.fontFamily ? { labelFontFamily: node.style.fontFamily } : {}),
    ...(node.style?.fontSize != null ? { labelFontSize: node.style.fontSize } : {}),
    ...(node.style?.color ? { labelColor: node.style.color } : {}),
    ...(node.labelOrientation ? { labelOrientation: node.labelOrientation } : {}),
    ...(node.aliasResolution ? { aliasResolution: node.aliasResolution } : {}),
  }));
  const canvasBonds: Bond[] = bonds.map((bond) => ({
    id: bond.id,
    from: bond.beginNodeId,
    to: bond.endNodeId,
    order: bond.aromatic && bond.order == null ? 1.5 : (bond.order ?? 1),
  }));
  const atomById = new Map(canvasAtoms.map((atom) => [atom.id, atom]));

  for (const fragment of fragments) {
    const fragId = fragment.id || getId();
    xml += `    <fragment id="${fragId}"${emitRawAttributes(fragment.preservation?.rawAttributes)}>\n`;

    for (const nodeId of fragment.nodeIds) {
      if (!idMap.has(nodeId)) idMap.set(nodeId, getId());
    }
    for (const bondId of fragment.bondIds) {
      if (!idMap.has(bondId)) idMap.set(bondId, getId());
    }

    // Atoms
    for (const nodeId of fragment.nodeIds) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const cdxId = idMap.get(node.id)!;

      const x = formatCdxmlNumber(node.position.x * exportScaleFactor);
      const y = formatCdxmlNumber(node.position.y * exportScaleFactor);

      let attrs = `id="${cdxId}" p="${x} ${y}"`;

      if (
        (node.query?.type === 'list' || node.query?.type === 'not-list') &&
        node.query.elements?.length
      ) {
        attrs += ` NodeType="ElementList" ElementList="${xmlEscape(`${node.query.negateList ? 'NOT ' : ''}${node.query.elements.join(' ')}`)}"`;
      } else if (node.query?.type === 'alias') {
        attrs += ` NodeType="GenericNickname"`;
        if (node.query.genericName)
          attrs += ` GenericNickname="${xmlEscape(node.query.genericName)}"`;
      } else if (node.query?.type === 'r-group') {
        attrs += ` NodeType="NamedAlternativeGroup"`;
        if (node.query.attachments?.length)
          attrs += ` Attachments="${xmlEscape(node.query.attachments.join(' '))}"`;
      } else if (node.query?.type === 'variable-attachment') {
        attrs += ` NodeType="LinkNode"`;
        if (node.query.linkCountLow != null) attrs += ` LinkCountLow="${node.query.linkCountLow}"`;
        if (node.query.linkCountHigh != null)
          attrs += ` LinkCountHigh="${node.query.linkCountHigh}"`;
        if (node.query.attachments?.length)
          attrs += ` Attachments="${xmlEscape(node.query.attachments.join(' '))}"`;
      } else if (node.query?.type === 'any') {
        attrs += ` NodeType="AnyElement"`;
      } else if (node.sourceNodeType === 'Fragment' || node.sourceNodeType === 'Nickname') {
        attrs += ` NodeType="${node.sourceNodeType}"`;
      } else if (node.sourceNodeType === 'GenericNickname') {
        attrs += ` NodeType="GenericNickname"`;
      }

      if ((node.element ?? 'C') !== 'C') {
        attrs += ` Element="${getAtomicNumber(node.element ?? 'C')}"`;
      }
      if (node.charge) {
        attrs += ` Charge="${node.charge}"`;
      }
      if ((node.lonePairCount ?? 0) > 0) {
        attrs += ` LonePairCount="${node.lonePairCount}"`;
      }
      if (node.radicalElectrons === 1) {
        attrs += ` Radical="Doublet"`;
      } else if ((node.radicalElectrons ?? 0) > 1) {
        attrs += ` NumUnpairedElectrons="${node.radicalElectrons}"`;
      }
      if (node.electronAngles?.length) {
        attrs += ` ${CHEM_EDITOR_ELECTRON_ANGLES_ATTR}="${xmlEscape(JSON.stringify(node.electronAngles))}"`;
      }
      if (node.isotope != null) {
        attrs += ` Isotope="${node.isotope}"`;
      }
      if (node.geometry) {
        attrs += ` Geometry="${node.geometry}"`;
      }
      if (node.atomStereo) {
        attrs += ` AS="${node.atomStereo}"`;
      }
      if (node.bondOrdering?.length) {
        const exportedBondOrdering = node.bondOrdering
          .map((bondId) => (bondId === 0 ? '0' : (idMap.get(bondId) ?? bondId)))
          .join(' ');
        attrs += ` BondOrdering="${xmlEscape(exportedBondOrdering)}"`;
      }
      if (node.aliasResolution) {
        attrs += ` ChemEditorAliasResolution="${xmlEscape(JSON.stringify(node.aliasResolution))}"`;
      }
      const ringTemplateAtomMemberships = serializeRingTemplateAtomMemberships(node);
      if (ringTemplateAtomMemberships) {
        attrs += ` ${CHEM_EDITOR_RING_TEMPLATE_ATOM_MEMBERSHIPS_ATTR}="${xmlEscape(ringTemplateAtomMemberships)}"`;
      }
      attrs += emitRawAttributes(node.preservation?.rawAttributes);

      let nodeLabel =
        node.query?.type === 'r-group'
          ? (node.query.rGroupName ?? node.query.label ?? node.alias)
          : node.query?.type === 'alias'
            ? (node.query.label ?? node.query.genericName ?? node.alias)
            : (node.alias ?? node.text?.runs.map((run) => run.text).join(''));
      if (!node.query && !nodeLabel) {
        const atom = atomById.get(node.id);
        if (atom) {
          const connectedBondCount = canvasBonds.filter(
            (bond) => bond.from === atom.id || bond.to === atom.id,
          ).length;
          if (shouldEmitComputedNodeLabel(atom, connectedBondCount, preservedDocumentAttributes)) {
            const knownValence: number | null = VALENCIES[getAtomLeadElement(atom)] ?? null;
            const alias = getAtomAlias(atom);
            const canShowImplicitHydrogens = !alias || Boolean(SHORTHAND_DATA[alias]);
            const hydrogenCount = canShowImplicitHydrogens
              ? getAtomHydrogenCount(atom, canvasBonds, knownValence)
              : 0;
            nodeLabel = getAtomDisplayText(atom, canvasAtoms, canvasBonds, hydrogenCount).text;
          }
        }
      }
      if (nodeLabel) {
        if (node.sourceNodeType === 'GenericNickname') {
          attrs += ` GenericNickname="${xmlEscape(node.alias ?? nodeLabel)}"`;
        }
        let content = '';
        content += emitT(nodeLabel, parseFloat(x), parseFloat(y), '        ', {
          size: node.style?.fontSize ?? documentStyleSettings.nativeMetrics.labelSize,
          color: node.style?.color ? getColorIndex(node.style.color) : undefined,
          fontId: getFontId(
            node.style?.fontFamily ?? documentStyleSettings.nativeMetrics.labelFontFamily,
          ),
          face: documentStyleSettings.nativeMetrics.labelFace,
          justification: node.text?.justification,
          labelAlignment: node.labelAlignment,
        });
        content += emitObjectTags(
          node.objectTags,
          '        ',
          exportScaleFactor,
          getColorIndex,
          getFontId,
        );
        content += emitRawChildren(node.preservation?.rawChildrenXml, '        ');
        xml += `      <n ${attrs}>\n${content}      </n>\n`;
      } else {
        const rawChildren =
          emitObjectTags(node.objectTags, '        ', exportScaleFactor, getColorIndex, getFontId) +
          emitRawChildren(node.preservation?.rawChildrenXml, '        ');
        xml += rawChildren
          ? `      <n ${attrs}>\n${rawChildren}      </n>\n`
          : `      <n ${attrs}/>\n`;
      }
    }

    // Bonds within this component
    for (const bondId of fragment.bondIds) {
      const bond = bondMap.get(bondId);
      if (!bond) continue;
      const fromId = idMap.get(bond.beginNodeId);
      const toId = idMap.get(bond.endNodeId);
      if (!fromId || !toId) continue;

      const cdxId = idMap.get(bond.id)!;
      let attrs = `id="${cdxId}" B="${fromId}" E="${toId}"`;

      const orderAttr = bondOrderToCdxml(bond);
      if (orderAttr) attrs += ` Order="${orderAttr}"`;

      const displayAttr = bondDisplayToCdxml(bond.display);
      if (displayAttr) attrs += ` Display="${displayAttr}"`;
      const display2Attr = bondDisplayToCdxml(bond.secondaryDisplay);
      if (display2Attr) attrs += ` Display2="${display2Attr}"`;
      if (bond.order === 2 && bond.doubleBondMode && bond.doubleBondMode !== 'auto') {
        attrs += ` ${CHEM_EDITOR_DOUBLE_BOND_MODE_ATTR}="${bond.doubleBondMode}"`;
      }
      if (bond.style?.lineWidth != null)
        attrs += ` LineWidth="${formatCdxmlNumber(bond.style.lineWidth)}"`;
      if (bond.bondSpacingPct != null)
        attrs += ` BondSpacing="${formatCdxmlNumber(bond.bondSpacingPct)}"`;
      if (bond.bondSpacingAbs != null)
        attrs += ` BondSpacingAbs="${formatCdxmlNumber(bond.bondSpacingAbs)}"`;
      if (bond.style?.color) attrs += ` Color="${getColorIndex(bond.style.color)}"`;
      if (bond.query?.ringState === 'ring') attrs += ` Topology="Ring"`;
      else if (bond.query?.ringState === 'chain') attrs += ` Topology="Chain"`;
      else if (bond.query?.ringState === 'either') attrs += ` Topology="RingOrChain"`;
      const ringTemplateBondMemberships = serializeRingTemplateBondMemberships(bond);
      if (ringTemplateBondMemberships) {
        attrs += ` ${CHEM_EDITOR_RING_TEMPLATE_BOND_MEMBERSHIPS_ATTR}="${xmlEscape(ringTemplateBondMemberships)}"`;
      }
      attrs += emitRawAttributes(bond.preservation?.rawAttributes);
      const rawChildren = emitRawChildren(bond.preservation?.rawChildrenXml, '        ');
      xml += rawChildren
        ? `      <b ${attrs}>\n${rawChildren}      </b>\n`
        : `      <b ${attrs}/>\n`;
    }

    xml += `    </fragment>\n`;
  }

  // ── Arrows ─────────────────────────────────────────────────────────────────
  for (const arrow of arrows) {
    const cdxId = arrow.id || getId();
    const arrowGeometry = resolveArrowGeometryMetrics(
      {
        type: arrow.arrowType,
        lineStyle: arrow.style?.lineType,
      },
      documentStyleSettings,
      arrow,
    );
    const hx = formatCdxmlNumber(arrow.head.x * exportScaleFactor);
    const hy = formatCdxmlNumber(arrow.head.y * exportScaleFactor);
    const tx = formatCdxmlNumber(arrow.tail.x * exportScaleFactor);
    const ty = formatCdxmlNumber(arrow.tail.y * exportScaleFactor);
    const cpx = (
      (arrow.controlPoint?.x ?? (arrow.tail.x + arrow.head.x) / 2) * exportScaleFactor
    ).toFixed(2);
    const cpy = (
      (arrow.controlPoint?.y ?? (arrow.tail.y + arrow.head.y) / 2) * exportScaleFactor
    ).toFixed(2);

    const midX = ((arrow.tail.x + arrow.head.x) / 2) * exportScaleFactor;
    const midY = ((arrow.tail.y + arrow.head.y) / 2) * exportScaleFactor;
    const labelFontSize = arrow.style?.fontSize ?? documentStyleSettings.nativeMetrics.captionSize;
    const labelColorIdx = arrow.style?.color ? getColorIndex(arrow.style.color) : undefined;
    const strokeColorAttr = arrow.style?.strokeColor
      ? ` color="${getColorIndex(arrow.style.strokeColor)}"`
      : '';

    const aboveText = arrow.textAbove?.runs.map((run) => run.text).join('');
    const belowText = arrow.textBelow?.runs.map((run) => run.text).join('');

    let labelContent = '';
    if (aboveText)
      labelContent += emitT(aboveText, midX, midY - 14, '      ', {
        size: labelFontSize,
        color: labelColorIdx,
        face: documentStyleSettings.nativeMetrics.captionFace,
      });
    if (belowText)
      labelContent += emitT(belowText, midX, midY + 14, '      ', {
        size: labelFontSize,
        color: labelColorIdx,
        face: documentStyleSettings.nativeMetrics.captionFace,
      });
    labelContent += emitObjectTags(
      arrow.objectTags,
      '      ',
      exportScaleFactor,
      getColorIndex,
      getFontId,
    );
    const rawArrowAttributes = emitRawAttributes(arrow.preservation?.rawAttributes);
    const rawArrowChildren = emitRawChildren(arrow.preservation?.rawChildrenXml, '      ');
    const resolvedHeadType = arrow.headType ?? getDefaultArrowHeadType(arrow.arrowType);
    const lineWidthAttr = ` LineWidth="${formatCdxmlNumber(
      convertCanvasToNative(arrowGeometry.lineWidth, documentStyleSettings),
    )}"`;
    const headSizeAttr = ` HeadSize="${formatChemDrawArrowMetric(
      convertCanvasToNative(arrowGeometry.headSize, documentStyleSettings),
    )}"`;
    const headCenterSizeAttr = ` ArrowheadCenterSize="${formatChemDrawArrowMetric(
      convertCanvasToNative(arrowGeometry.headCenterSize, documentStyleSettings),
    )}"`;
    const headWidthAttr = ` ArrowheadWidth="${formatChemDrawArrowMetric(
      convertCanvasToNative(arrowGeometry.headWidth, documentStyleSettings),
    )}"`;
    const shaftSpacingAttr =
      arrow.arrowType === 'equilibrium' ||
      arrow.arrowType === 'retrosynthetic' ||
      arrow.shaftSpacing != null
        ? ` ArrowShaftSpacing="${formatChemDrawArrowMetric(
            convertCanvasToNative(arrowGeometry.shaftSpacing, documentStyleSettings),
          )}"`
        : '';
    const equilibriumRatioAttr =
      arrow.arrowType === 'equilibrium' || arrow.equilibriumRatio != null
        ? ` ArrowEquilibriumRatio="${formatCdxmlNumber(arrowGeometry.equilibriumRatio, 3)}"`
        : '';
    const arrowheadTypeAttr = ` ArrowheadType="${arrowHeadTypeToCdxml(resolvedHeadType)}"`;
    const fillTypeAttr = ` FillType="${arrowFillTypeToCdxml(resolvedHeadType)}"`;
    const editorArrowTypeAttr = ` ${CHEM_EDITOR_ARROW_TYPE_ATTR}="${xmlEscape(arrow.arrowType)}"`;
    const editorCurveAttr =
      arrow.curveEnabled && arrow.arrowType !== 'curved' && arrow.arrowType !== 'half-curved'
        ? ` ${CHEM_EDITOR_ARROW_CURVE_ENABLED_ATTR}="true"`
        : '';

    const hasLabel = labelContent.length > 0 || rawArrowChildren.length > 0;
    const openTag = hasLabel ? '' : '/>';
    const closeTag = hasLabel ? `>\n${labelContent}${rawArrowChildren}    </arrow>\n` : `\n`;
    const lineTypeAttr =
      arrow.style?.lineType === 'dashed'
        ? ' LineType="Dashed"'
        : arrow.style?.lineType === 'bold'
          ? ' LineType="Bold"'
          : '';
    const curvedGeometryAttr =
      (arrow.curveEnabled || arrow.arrowType === 'curved' || arrow.arrowType === 'half-curved') &&
      (!arrow.arcCenter || (arrow.arrowType !== 'curved' && arrow.arrowType !== 'half-curved'))
        ? ` CurvePoints="${tx} ${ty} ${cpx} ${cpy} ${hx} ${hy}"`
        : '';
    const linearGeometryAttr =
      curvedGeometryAttr.length > 0 ? '' : ` Head3D="${hx} ${hy} 0" Tail3D="${tx} ${ty} 0"`;

    if (arrow.arrowType === 'curved' || arrow.arrowType === 'half-curved') {
      const headStr = arrow.arrowType === 'half-curved' ? 'HalfLeft' : 'Full';
      if (arrow.arcCenter && arrow.majorAxisEnd && arrow.minorAxisEnd) {
        const angularSizeAttr =
          arrow.angularSize != null && Number.isFinite(arrow.angularSize)
            ? ` AngularSize="${arrow.angularSize}"`
            : '';
        xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr} Head3D="${hx} ${hy} 0" Tail3D="${tx} ${ty} 0" Center3D="${formatCdxmlNumber(arrow.arcCenter.x * exportScaleFactor)} ${formatCdxmlNumber(arrow.arcCenter.y * exportScaleFactor)} 0" MajorAxisEnd3D="${formatCdxmlNumber(arrow.majorAxisEnd.x * exportScaleFactor)} ${formatCdxmlNumber(arrow.majorAxisEnd.y * exportScaleFactor)} 0" MinorAxisEnd3D="${formatCdxmlNumber(arrow.minorAxisEnd.x * exportScaleFactor)} ${formatCdxmlNumber(arrow.minorAxisEnd.y * exportScaleFactor)} 0" ArrowheadHead="${headStr}"${arrowheadTypeAttr}${fillTypeAttr}${angularSizeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
      } else {
        xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr} ArrowheadHead="${headStr}"${arrowheadTypeAttr}${curvedGeometryAttr || linearGeometryAttr}${fillTypeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
      }
    } else if (arrow.arrowType === 'equilibrium') {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="HalfRight" ArrowheadTail="HalfLeft"${arrowheadTypeAttr}${fillTypeAttr} NoGo="None"${rawArrowAttributes}${openTag}${closeTag}`;
    } else if (arrow.arrowType === 'retrosynthetic') {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="Full"${arrowheadTypeAttr}${fillTypeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
    } else if (arrow.arrowType === 'no-reaction') {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="Full"${arrowheadTypeAttr}${fillTypeAttr} NoGo="Cross"${rawArrowAttributes}${openTag}${closeTag}`;
    } else if (arrow.arrowType === 'resonance') {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="Full" ArrowheadTail="Full"${arrowheadTypeAttr}${fillTypeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
    } else if (arrow.arrowType === 'fat') {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="Full"${arrowheadTypeAttr}${fillTypeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
    } else {
      xml += `    <arrow id="${cdxId}"${strokeColorAttr}${lineWidthAttr}${headSizeAttr}${headCenterSizeAttr}${headWidthAttr}${shaftSpacingAttr}${equilibriumRatioAttr}${lineTypeAttr}${editorArrowTypeAttr}${editorCurveAttr}${curvedGeometryAttr || linearGeometryAttr} ArrowheadHead="Full"${arrowheadTypeAttr}${fillTypeAttr}${rawArrowAttributes}${openTag}${closeTag}`;
    }
  }

  // ── Text boxes (rich text) ─────────────────────────────────────────────────
  for (const text of textObjects) {
    const tb = {
      id: text.id,
      x: text.anchor.x,
      y: text.anchor.y,
      runs: text.text.runs,
      fontSize: text.style?.fontSize ?? documentStyleSettings.nativeMetrics.captionSize,
      fontFamily: text.style?.fontFamily ?? documentStyleSettings.nativeMetrics.captionFontFamily,
      color: text.style?.color ?? '#000000',
      textAlign: text.text.justification ?? 'center',
      ...(text.text.width != null ? { width: text.text.width } : {}),
      ...(text.style?.rotation != null ? { rotation: text.style.rotation } : {}),
      ...(text.semanticMode ? { semanticMode: text.semanticMode } : {}),
      ...(text.conversionStatus ? { conversionStatus: text.conversionStatus } : {}),
      ...(text.chemicalMetadata ? { chemicalMetadata: text.chemicalMetadata } : {}),
    };
    const plain = tb.runs.map((r) => r.text).join('');
    if (!plain.trim()) continue;
    const x = tb.x * exportScaleFactor;
    const y = tb.y * exportScaleFactor;
    xml += emitTextBoxT(tb, x, y, exportScaleFactor, '    ', getColorIndex, getFontId, {
      rawAttributes: text.preservation?.rawAttributes,
      rawChildrenXml: [
        ...(text.objectTags
          ? [
              emitObjectTags(
                text.objectTags,
                '      ',
                exportScaleFactor,
                getColorIndex,
                getFontId,
              ).trimEnd(),
            ]
          : []),
        ...(text.preservation?.rawChildrenXml ?? []),
      ],
    });
  }

  for (const object of page.objects) {
    if (object.type === 'bracket') {
      const bounds = boundsToCdxml(object.bounds, exportScaleFactor);
      const usage =
        object.bracketType === 'multiple-group'
          ? 'MultipleGroup'
          : object.bracketType === 'mixture'
            ? 'Mixture'
            : object.bracketType === 'sru'
              ? 'SRU'
              : 'Generic';
      const rawAttributesAttr = emitRawAttributes(object.preservation?.rawAttributes);
      let content = '';
      if (object.label) {
        const cx = ((object.bounds.left + object.bounds.right) / 2) * exportScaleFactor;
        const cy = object.bounds.top * exportScaleFactor;
        content += emitT(object.label, cx, cy, '      ');
      }
      content += emitObjectTags(
        object.objectTags,
        '      ',
        exportScaleFactor,
        getColorIndex,
        getFontId,
      );
      content += emitRawChildren(object.preservation?.rawChildrenXml, '      ');
      xml += content
        ? `    <bracketedgroup id="${object.id}" BoundingBox="${bounds}" BracketUsage="${usage}"${rawAttributesAttr}>\n${content}    </bracketedgroup>\n`
        : `    <bracketedgroup id="${object.id}" BoundingBox="${bounds}" BracketUsage="${usage}"${rawAttributesAttr}/>\n`;
    } else if (object.type === 'graphic') {
      const boundingBoxValue =
        object.points && object.points.length >= 2
          ? `${formatCdxmlNumber(object.points[0].x * exportScaleFactor)} ${formatCdxmlNumber(object.points[0].y * exportScaleFactor)} ${formatCdxmlNumber(object.points[1].x * exportScaleFactor)} ${formatCdxmlNumber(object.points[1].y * exportScaleFactor)}`
          : object.bounds
            ? boundsToCdxml(object.bounds, exportScaleFactor)
            : '';
      const boundsAttr = boundingBoxValue ? ` BoundingBox="${boundingBoxValue}"` : '';
      const pointsAttr = object.points?.length
        ? ` Points="${object.points.map((point) => `${formatCdxmlNumber(point.x * exportScaleFactor)} ${formatCdxmlNumber(point.y * exportScaleFactor)}`).join(' ')}"`
        : '';
      const colorAttr = object.style?.color ? ` color="${getColorIndex(object.style.color)}"` : '';
      const fillColorAttr = object.style?.fillColor
        ? ` FillColor="${getColorIndex(object.style.fillColor)}"`
        : '';
      const lineWidthAttr =
        object.style?.lineWidth != null
          ? ` LineWidth="${formatCdxmlNumber(object.style.lineWidth)}"`
          : '';
      const zIndexAttr =
        object.style?.zIndex != null ? ` Z="${Math.round(object.style.zIndex)}"` : '';
      const visibleAttr = object.style?.visible === false ? ' Visible="no"' : '';
      const lineTypeAttr =
        object.style?.lineType === 'dashed'
          ? ' LineType="Dashed"'
          : object.style?.lineType === 'bold'
            ? ' LineType="Bold"'
            : '';
      const fillTypeAttr = object.style?.fillColor ? ' FillType="Solid"' : '';
      const rawAttributesAttr = emitRawAttributes(object.preservation?.rawAttributes);
      const rawChildren =
        emitObjectTags(object.objectTags, '      ', exportScaleFactor, getColorIndex, getFontId) +
        emitRawChildren(object.preservation?.rawChildrenXml, '      ');
      const tag =
        object.graphicType === 'line'
          ? 'line'
          : object.graphicType === 'ellipse'
            ? 'oval'
            : object.graphicType === 'polygon'
              ? 'polygon'
              : 'graphic';
      if (object.graphicType === 'symbol') {
        const symbolTypeAttr = object.symbolType
          ? ` SymbolType="${xmlEscape(object.symbolType)}"`
          : '';
        const representChild =
          object.representedObjectId || object.representedAttribute
            ? `<represent${
                object.representedAttribute
                  ? ` attribute="${xmlEscape(object.representedAttribute)}"`
                  : ''
              }${
                object.representedObjectId
                  ? ` object="${xmlEscape(object.representedObjectId)}"`
                  : ''
              }/>`
            : '';
        const content = `${representChild}${rawChildren}`;
        xml += content
          ? `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Symbol"${symbolTypeAttr}${rawAttributesAttr}>${content}</graphic>\n`
          : `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Symbol"${symbolTypeAttr}${rawAttributesAttr}/>\n`;
      } else if (object.graphicType === 'bracket') {
        const bracketTypeAttr = object.bracketType
          ? ` BracketType="${xmlEscape(object.bracketType)}"`
          : '';
        const bracketUsageAttr = object.bracketUsage
          ? ` BracketUsage="${xmlEscape(object.bracketUsage)}"`
          : '';
        const lipSizeAttr =
          object.lipSize != null ? ` LipSize="${Math.round(object.lipSize * 6)}"` : '';
        let content = '';
        const hasLabelInObjectTags = object.objectTags?.some(
          (t) => t.name === 'parameterizedBracketLabel',
        );
        if (object.label && !hasLabelInObjectTags) {
          const labelX =
            object.points && object.points[1]
              ? object.points[1].x * exportScaleFactor
              : (object.bounds?.right ?? 0) * exportScaleFactor;
          const labelY =
            object.points && object.points[1]
              ? object.points[1].y * exportScaleFactor
              : (object.bounds?.bottom ?? 0) * exportScaleFactor;
          content = `<objecttag id="${getId()}" TagType="Unknown" Name="parameterizedBracketLabel">\n${emitT(object.label, labelX, labelY, '      ', { size: 7.5 })}    </objecttag>`;
        }
        content += rawChildren;
        xml += content
          ? `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Bracket"${bracketTypeAttr}${lipSizeAttr}${bracketUsageAttr}${rawAttributesAttr}>${content}</graphic>\n`
          : `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Bracket"${bracketTypeAttr}${lipSizeAttr}${bracketUsageAttr}${rawAttributesAttr}/>\n`;
      } else if (object.graphicType === 'orbital') {
        const orbitalTypeAttr = object.orbitalType
          ? ` OrbitalType="${xmlEscape(object.orbitalType)}"`
          : '';
        const ovalTypeAttr = object.ovalType ? ` OvalType="${xmlEscape(object.ovalType)}"` : '';
        const centerAttr = object.center
          ? ` Center3D="${formatCdxmlNumber(object.center.x * exportScaleFactor)} ${formatCdxmlNumber(object.center.y * exportScaleFactor)} 0"`
          : '';
        const majorAxisAttr = object.majorAxisEnd
          ? ` MajorAxisEnd3D="${formatCdxmlNumber(object.majorAxisEnd.x * exportScaleFactor)} ${formatCdxmlNumber(object.majorAxisEnd.y * exportScaleFactor)} 0"`
          : '';
        const minorAxisAttr = object.minorAxisEnd
          ? ` MinorAxisEnd3D="${formatCdxmlNumber(object.minorAxisEnd.x * exportScaleFactor)} ${formatCdxmlNumber(object.minorAxisEnd.y * exportScaleFactor)} 0"`
          : '';
        xml += rawChildren
          ? `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Orbital"${orbitalTypeAttr}${ovalTypeAttr}${centerAttr}${majorAxisAttr}${minorAxisAttr}${rawAttributesAttr}>\n${rawChildren}    </graphic>\n`
          : `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Orbital"${orbitalTypeAttr}${ovalTypeAttr}${centerAttr}${majorAxisAttr}${minorAxisAttr}${rawAttributesAttr}/>\n`;
      } else if (object.graphicType === 'rectangle' || object.graphicType === 'rounded-rectangle') {
        const rectangleTypeAttr = object.rectangleType
          ? ` RectangleType="${xmlEscape(object.rectangleType)}"`
          : '';
        const cornerRadiusAttr =
          object.cornerRadius != null
            ? ` CornerRadius="${formatCdxmlNumber(object.cornerRadius * exportScaleFactor * 100, 0)}"`
            : '';
        const shadowSizeAttr =
          object.shadowSize != null
            ? ` ShadowSize="${formatCdxmlNumber(object.shadowSize * exportScaleFactor * 100, 0)}"`
            : '';
        xml += rawChildren
          ? `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Rectangle"${rectangleTypeAttr}${cornerRadiusAttr}${shadowSizeAttr}${rawAttributesAttr}>\n${rawChildren}    </graphic>\n`
          : `    <graphic id="${object.id}"${boundsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr} GraphicType="Rectangle"${rectangleTypeAttr}${cornerRadiusAttr}${shadowSizeAttr}${rawAttributesAttr}/>\n`;
      } else {
        xml += rawChildren
          ? `    <${tag} id="${object.id}"${boundsAttr}${pointsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr}${rawAttributesAttr}>\n${rawChildren}    </${tag}>\n`
          : `    <${tag} id="${object.id}"${boundsAttr}${pointsAttr}${colorAttr}${fillColorAttr}${fillTypeAttr}${lineWidthAttr}${lineTypeAttr}${zIndexAttr}${visibleAttr}${rawAttributesAttr}/>\n`;
      }
    }
  }

  for (const object of embeddedObjects) {
    const boundsAttr = ` BoundingBox="${boundsToCdxml(object.bounds, exportScaleFactor)}"`;
    const payloadAttr =
      object.payloadKind === 'pdf'
        ? ` PDF="${object.payloadHex}"`
        : object.payloadKind === 'png'
          ? ` PNG="${object.payloadHex}"`
          : object.payloadKind === 'jpeg'
            ? ` JPEG="${object.payloadHex}"`
            : '';
    const zIndexAttr =
      object.style?.zIndex != null ? ` Z="${Math.round(object.style.zIndex)}"` : '';
    const visibleAttr = object.style?.visible === false ? ' Visible="no"' : '';
    const rawAttributesAttr = emitRawAttributes(object.preservation?.rawAttributes);
    const rawChildren =
      emitObjectTags(object.objectTags, '      ', exportScaleFactor, getColorIndex, getFontId) +
      emitRawChildren(object.preservation?.rawChildrenXml, '      ');
    xml += rawChildren
      ? `    <embeddedobject id="${object.id}"${boundsAttr}${zIndexAttr}${visibleAttr}${payloadAttr}${rawAttributesAttr}>\n${rawChildren}    </embeddedobject>\n`
      : `    <embeddedobject id="${object.id}"${boundsAttr}${zIndexAttr}${visibleAttr}${payloadAttr}${rawAttributesAttr}/>\n`;
  }

  for (const object of tables) {
    const boundsAttr = ` BoundingBox="${boundsToCdxml(object.bounds, exportScaleFactor)}"`;
    const zIndexAttr =
      object.style?.zIndex != null ? ` Z="${Math.round(object.style.zIndex)}"` : '';
    const visibleAttr = object.style?.visible === false ? ' Visible="no"' : '';
    const colorAttr = object.style?.color ? ` Color="${getColorIndex(object.style.color)}"` : '';
    const fillColorAttr = object.style?.fillColor
      ? ` FillColor="${getColorIndex(object.style.fillColor)}"`
      : '';
    const rawAttributesAttr = emitRawAttributes(object.preservation?.rawAttributes);
    let content = emitObjectTags(
      object.objectTags,
      '      ',
      exportScaleFactor,
      getColorIndex,
      getFontId,
    );
    for (const cell of object.cells) {
      const boundsInParentAttr = ` BoundsInParent="${boundsToCdxml(cell.boundsInParent, exportScaleFactor)}"`;
      const cellRawAttributesAttr = emitRawAttributes(cell.rawAttributes);
      let cellContent = '';
      if (cell.text?.runs.length) {
        cellContent += emitTextBlockT({
          text: {
            ...cell.text,
            ...(cell.text.bounds
              ? {
                  bounds: {
                    left: cell.text.bounds.left * exportScaleFactor,
                    top: cell.text.bounds.top * exportScaleFactor,
                    right: cell.text.bounds.right * exportScaleFactor,
                    bottom: cell.text.bounds.bottom * exportScaleFactor,
                  },
                }
              : {}),
          },
          anchor: cell.text.bounds
            ? {
                x: ((cell.text.bounds.left + cell.text.bounds.right) / 2) * exportScaleFactor,
                y: ((cell.text.bounds.top + cell.text.bounds.bottom) / 2) * exportScaleFactor,
              }
            : {
                x: ((cell.boundsInParent.left + cell.boundsInParent.right) / 2) * exportScaleFactor,
                y: ((cell.boundsInParent.top + cell.boundsInParent.bottom) / 2) * exportScaleFactor,
              },
          indent: '        ',
          getColorIndex,
          getFontId,
          style: object.style,
        });
      }
      cellContent += emitRawChildren(cell.rawChildrenXml, '        ');
      content += cellContent
        ? `      <page id="${cell.id}"${boundsInParentAttr}${cellRawAttributesAttr}>\n${cellContent}      </page>\n`
        : `      <page id="${cell.id}"${boundsInParentAttr}${cellRawAttributesAttr}/>\n`;
    }
    content += emitRawChildren(object.preservation?.rawChildrenXml, '      ');
    xml += content
      ? `    <table id="${object.id}"${boundsAttr}${zIndexAttr}${visibleAttr}${colorAttr}${fillColorAttr}${rawAttributesAttr}>\n${content}    </table>\n`
      : `    <table id="${object.id}"${boundsAttr}${zIndexAttr}${visibleAttr}${colorAttr}${fillColorAttr}${rawAttributesAttr}/>\n`;
  }

  for (const preservedChild of page.preservedPageChildren ?? []) {
    xml += `    ${preservedChild.xml.endsWith('\n') ? preservedChild.xml : `${preservedChild.xml}\n`}`;
  }

  xml += `  </page>\n`;
  xml += `</CDXML>\n`;
  return xml;
}

// ─── Import ──────────────────────────────────────────────────────────────────

export function cdxmlToChemDrawDocument(xmlString: string): ChemDrawConversionResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const warnings: string[] = [];
  const objects: ChemDrawObject[] = [];
  const pageEl = doc.querySelector('page');
  const root = doc.documentElement;
  const preservedPageChildren: NonNullable<
    ChemDrawDocument['pages'][number]['preservedPageChildren']
  > = [];
  const preservedDocumentAttributes = collectUnhandledAttributes(root, [
    'BondSpacing',
    'BondSpacingAbs',
    'BondLength',
    'BoldWidth',
    'LineWidth',
    'MarginWidth',
    'HashSpacing',
    'ChainAngle',
    'LabelFont',
    'CaptionFont',
    'CaptionSize',
    'LabelSize',
    'LabelFace',
    'CaptionFace',
    'ChemEditorBondLength',
    'ChemEditorBondLineWidth',
    'ChemEditorTextFontFamily',
    'ChemEditorTextFontSize',
    'ChemEditorTextColor',
    'ChemEditorTextAlign',
    'ChemEditorBondColor',
    'ChemEditorMonochrome',
    'ChemEditorAtomColors',
    'ChemEditorPageMode',
    'ChemEditorPageUnit',
    'ChemEditorPagePresetId',
    'ChemEditorPageOrientation',
    'ChemEditorPageWidth',
    'ChemEditorPageHeight',
    'ChemEditorPageRows',
    'ChemEditorPageColumns',
  ]);
  const preservedPageAttributes = pageEl
    ? collectUnhandledAttributes(pageEl, [
        'id',
        'BoundingBox',
        'HeaderPosition',
        'FooterPosition',
        'PrintTrimMarks',
        'HeightPages',
        'WidthPages',
      ])
    : undefined;

  // Compute import scale factor from the document's BondLength (ChemDraw units → canvas px).
  const docBondLength = parseFloat(root.getAttribute('BondLength') ?? '30') || 30;
  const importScaleFactor = docBondLength / CANVAS_BOND_PX;

  const colorTable: string[] = [];
  const colortableEl = doc.querySelector('colortable');
  if (colortableEl) {
    const colorEls = colortableEl.children;
    for (let i = 0; i < colorEls.length; i++) {
      const el = colorEls[i];
      const r = Math.round(parseFloat(el.getAttribute('r') ?? '0') * 255);
      const g = Math.round(parseFloat(el.getAttribute('g') ?? '0') * 255);
      const b = Math.round(parseFloat(el.getAttribute('b') ?? '0') * 255);
      colorTable.push(
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      );
    }
  }
  const getImportColor = (idx: number): string | undefined => colorTable[idx - 2];

  const fontNameById = new Map<number, string>();
  const fonttableEl = doc.querySelector('fonttable');
  if (fonttableEl) {
    const fontEls = fonttableEl.getElementsByTagName('font');
    for (let i = 0; i < fontEls.length; i++) {
      const el = fontEls[i];
      const id = parseInt(el.getAttribute('id') ?? '');
      const name = el.getAttribute('name') ?? '';
      if (!isNaN(id) && name) fontNameById.set(id, name);
    }
  }

  const parseSRuns = (tEl: Element): TextRun[] => {
    const sNodes = tEl.getElementsByTagName('s');
    const runs: TextRun[] = [];
    for (let i = 0; i < sNodes.length; i++) {
      const s = sNodes[i];
      const text = s.textContent ?? '';
      if (!text) continue;
      const faceStyles = decodeCdxmlFaceStyles(parseInt(s.getAttribute('face') ?? '0'));
      const colorAttr = s.getAttribute('color');
      const run: TextRun = {
        text,
        ...faceStyles,
      };
      if (colorAttr != null) {
        const hex = getImportColor(parseInt(colorAttr));
        if (hex) run.color = hex;
      }
      runs.push(run);
    }
    if (runs.length === 0) {
      const text = tEl.textContent?.trim() ?? '';
      if (text) runs.push({ text });
    }
    return runs;
  };

  const parseTextBlock = (tEl: Element): ChemDrawText['text'] => {
    const runs = parseSRuns(tEl);
    const justAttr =
      tEl.getAttribute('Justification') ?? tEl.getAttribute('LabelJustification') ?? 'Center';
    const justification = justAttr === 'Left' ? 'left' : justAttr === 'Right' ? 'right' : 'center';
    const bounds = parseBounds(tEl.getAttribute('BoundingBox'), importScaleFactor);
    const pAttr = tEl.getAttribute('p');
    let width: number | undefined;
    if (bounds) width = Math.max(0, bounds.right - bounds.left);
    else if (pAttr) {
      const coords = pAttr.trim().split(/\s+/).map(Number);
      if (coords.length >= 4 && !coords.some(Number.isNaN)) {
        width = Math.max(0, (coords[2] - coords[0]) / importScaleFactor);
      }
    }
    return {
      runs,
      justification,
      ...(width != null ? { width } : {}),
      ...(bounds ? { bounds } : {}),
    };
  };

  const parseObjectTags = (containerEl: Element): ChemDrawObjectTag[] | undefined => {
    const tags = getDirectChildrenByTagName(containerEl, 'objecttag')
      .map((tagEl) => {
        const textEl = getFirstDirectChildByTagName(tagEl, 't');
        const firstS = textEl?.querySelector('s') ?? null;
        const fontId = firstS ? parseInt(firstS.getAttribute('font') ?? '', 10) : undefined;
        const fontFamily =
          fontId != null && !Number.isNaN(fontId) ? fontNameById.get(fontId) : undefined;
        const fontSize = firstS ? parseFloat(firstS.getAttribute('size') ?? '') : undefined;
        const colorId = firstS ? parseInt(firstS.getAttribute('color') ?? '', 10) : undefined;
        const color =
          colorId != null && !Number.isNaN(colorId) ? getImportColor(colorId) : undefined;
        const tag: ChemDrawObjectTag = {
          name: tagEl.getAttribute('Name') ?? 'objecttag',
          ...(tagEl.getAttribute('id') ? { id: tagEl.getAttribute('id')! } : {}),
          ...(tagEl.getAttribute('TagType') ? { tagType: tagEl.getAttribute('TagType')! } : {}),
          ...(parseChemDrawBoolean(tagEl.getAttribute('Visible') ?? undefined) != null
            ? { visible: parseChemDrawBoolean(tagEl.getAttribute('Visible') ?? undefined) }
            : {}),
          ...(tagEl.getAttribute('PositioningType')
            ? { positioningType: tagEl.getAttribute('PositioningType')! }
            : {}),
          ...(tagEl.getAttribute('PositioningAngle') != null &&
          !Number.isNaN(parseFloat(tagEl.getAttribute('PositioningAngle') ?? ''))
            ? { positioningAngle: parseFloat(tagEl.getAttribute('PositioningAngle') ?? '') }
            : {}),
          ...(parsePoint3D(tagEl.getAttribute('PositioningOffset'), importScaleFactor)
            ? {
                positioningOffset: parsePoint3D(
                  tagEl.getAttribute('PositioningOffset'),
                  importScaleFactor,
                )!,
              }
            : {}),
          ...(textEl ? { text: parseTextBlock(textEl) } : {}),
          ...(textEl && parsePoint3D(textEl.getAttribute('p'), importScaleFactor)
            ? { textAnchor: parsePoint3D(textEl.getAttribute('p'), importScaleFactor)! }
            : {}),
          ...(fontFamily || (fontSize != null && !Number.isNaN(fontSize)) || color
            ? {
                style: {
                  ...(fontFamily ? { fontFamily } : {}),
                  ...(fontSize != null && !Number.isNaN(fontSize) ? { fontSize } : {}),
                  ...(color ? { color } : {}),
                },
              }
            : {}),
        };
        const preservation = buildPreservationMetadata({
          el: tagEl,
          handledAttributeNames: [
            'id',
            'Name',
            'TagType',
            'Visible',
            'PositioningType',
            'PositioningAngle',
            'PositioningOffset',
          ],
          preserveChild: (child) => child.tagName !== 't' || child !== textEl,
        });
        if (preservation) tag.preservation = preservation;
        return tag;
      })
      .filter((tag) => tag.name);
    return tags.length > 0 ? tags : undefined;
  };

  const nodeObjectIds = new Set<string>();
  const skippedNodeIds = new Set<string>();

  // Pre-pass: collect ALL ExternalConnectionPoint node IDs across every fragment
  // before bond processing begins.  Without this, a bond in fragment A that points
  // to an ECP in fragment B (processed later) slips through the per-fragment guard
  // and leaves a dangling reference that corrupts the molblock → RDKit marks every
  // atom invalid → everything turns red.
  const allNodeEls = Array.from(doc.getElementsByTagName('n')).filter(
    (el) => isElementOnPage(el, pageEl) && !hasAncestorTag(el, 'table'),
  );
  for (let i = 0; i < allNodeEls.length; i++) {
    if (allNodeEls[i].getAttribute('NodeType') === 'ExternalConnectionPoint') {
      // Only skip ECPs that live in top-level fragments. Sub-fragment ECPs (nested
      // inside a NodeType=Fragment atom's <fragment> child) can share IDs with
      // top-level atoms; adding them here would cause their shared-ID top-level
      // bond endpoints to be silently dropped from the parsed document.
      if (!hasAncestorTag(allNodeEls[i], 'n')) {
        const id = allNodeEls[i].getAttribute('id');
        if (id) skippedNodeIds.add(id);
      }
    }
  }

  // Only process top-level fragments. ChemDraw stores the "expanded structure" of
  // superatom groups (OTBS, TMS, …) as <fragment> elements nested inside the <n>
  // node they belong to. getElementsByTagName returns those too; including them
  // would add duplicate atoms with wrong coordinates → crazy cross-canvas bonds.
  const isNestedInAtom = (el: Element): boolean => {
    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'n') return true;
      p = p.parentElement;
    }
    return false;
  };
  const allFragmentEls = doc.getElementsByTagName('fragment');
  const fragmentEls = Array.from(allFragmentEls).filter(
    (el) => !isNestedInAtom(el) && isElementOnPage(el, pageEl) && !hasAncestorTag(el, 'table'),
  );
  for (let i = 0; i < fragmentEls.length; i++) {
    const fragmentEl = fragmentEls[i];
    const fragmentId = fragmentEl.getAttribute('id') ?? makeIdGen()();
    const nodeIds: string[] = [];
    const bondIds: string[] = [];

    for (let j = 0; j < fragmentEl.children.length; j++) {
      const child = fragmentEl.children[j];
      if (child.tagName === 'n') {
        const cdxId = child.getAttribute('id');
        const p = child.getAttribute('p') ?? child.getAttribute('p3');
        if (!cdxId || !p) continue;

        const parts = p.trim().split(/\s+/);
        const x = parseFloat(parts[0]) / importScaleFactor;
        const y = parseFloat(parts[1]) / importScaleFactor;
        if (isNaN(x) || isNaN(y)) continue;

        const elementNumStr = child.getAttribute('Element');
        const element = elementNumStr ? getElementSymbol(parseInt(elementNumStr)) : 'C';
        const chargeStr = child.getAttribute('Charge');
        const charge = chargeStr ? parseInt(chargeStr) : undefined;
        const radicalStr = child.getAttribute('Radical');
        const numUnpairedStr = child.getAttribute('NumUnpairedElectrons');
        const lonePairStr = child.getAttribute('LonePairCount');
        const electronAnglesAttr = child.getAttribute(CHEM_EDITOR_ELECTRON_ANGLES_ATTR);
        const lonePairCount =
          lonePairStr != null && !Number.isNaN(parseInt(lonePairStr, 10))
            ? parseInt(lonePairStr, 10)
            : undefined;
        let electronAngles: number[] | undefined;
        if (electronAnglesAttr) {
          try {
            const parsed = JSON.parse(electronAnglesAttr);
            if (Array.isArray(parsed)) {
              const numericAngles = parsed.filter(
                (value): value is number => typeof value === 'number' && Number.isFinite(value),
              );
              if (numericAngles.length > 0) electronAngles = numericAngles;
            }
          } catch {
            warnings.push(
              `Electron angle metadata on node ${cdxId} could not be parsed and was ignored.`,
            );
          }
        }
        let radicalElectrons: number | undefined;
        if (numUnpairedStr != null && !Number.isNaN(parseInt(numUnpairedStr, 10))) {
          radicalElectrons = parseInt(numUnpairedStr, 10);
        } else if (radicalStr === 'Doublet' || radicalStr === '1') {
          radicalElectrons = 1;
        } else if (radicalStr === 'Singlet' || radicalStr === 'Triplet' || radicalStr === '2') {
          radicalElectrons = 2;
        }
        const isotopeStr = child.getAttribute('Isotope');
        const isotope = isotopeStr ? parseInt(isotopeStr) : undefined;
        const nodeType = child.getAttribute('NodeType') ?? 'Element';
        const sourceNodeType = nodeType !== 'Element' ? nodeType : undefined;
        if (nodeType === 'ExternalConnectionPoint') {
          skippedNodeIds.add(cdxId);
          continue;
        }
        const elementList = parseQueryList(child.getAttribute('ElementList'));
        const genericList = parseQueryList(child.getAttribute('GenericList'));
        const attachments = child.getAttribute('Attachments')?.trim().split(/\s+/).filter(Boolean);
        const linkCountLow = child.getAttribute('LinkCountLow');
        const linkCountHigh = child.getAttribute('LinkCountHigh');
        let aliasResolution: ChemDrawNode['aliasResolution'];
        const aliasResolutionAttr = child.getAttribute('ChemEditorAliasResolution');
        if (aliasResolutionAttr) {
          try {
            aliasResolution = JSON.parse(aliasResolutionAttr) as ChemDrawNode['aliasResolution'];
          } catch {
            warnings.push(
              `Alias resolution metadata on node ${cdxId} could not be parsed and was ignored.`,
            );
          }
        }
        const geometryAttr = child.getAttribute('Geometry');
        const geometry = geometryAttr === 'Tetrahedral' ? geometryAttr : undefined;
        const atomStereoAttr = child.getAttribute('AS');
        const atomStereo =
          atomStereoAttr === 'N' || atomStereoAttr === 'r' || atomStereoAttr === 's'
            ? atomStereoAttr
            : undefined;
        const bondOrdering = parseRingTemplateBondOrdering(child.getAttribute('BondOrdering'));
        let ringTemplateMemberships: ChemDrawNode['ringTemplateMemberships'];
        const ringTemplateMembershipsAttr = child.getAttribute(
          CHEM_EDITOR_RING_TEMPLATE_ATOM_MEMBERSHIPS_ATTR,
        );
        if (ringTemplateMembershipsAttr) {
          try {
            const parsed = JSON.parse(ringTemplateMembershipsAttr) as Array<{
              structureId?: unknown;
              family?: unknown;
              preset?: unknown;
              atomKey?: unknown;
              stereoCarrier?: unknown;
            }>;
            if (Array.isArray(parsed)) {
              ringTemplateMemberships = parsed
                .filter(
                  (entry) =>
                    typeof entry.structureId === 'string' &&
                    entry.family === 'chair' &&
                    (entry.preset === 'chair' || entry.preset === 'chair-flipped') &&
                    typeof entry.atomKey === 'string',
                )
                .map((entry) => ({
                  structureId: entry.structureId as string,
                  family: 'chair' as const,
                  preset: entry.preset as 'chair' | 'chair-flipped',
                  atomKey: entry.atomKey as string,
                  ...(entry.stereoCarrier === true &&
                  geometry === 'Tetrahedral' &&
                  (atomStereo === 'r' || atomStereo === 's') &&
                  bondOrdering?.length
                    ? {
                        nativeStereo: {
                          geometry,
                          as: atomStereo,
                          bondOrdering,
                        },
                      }
                    : {}),
                }));
            }
          } catch {
            warnings.push(
              `Ring template metadata on node ${cdxId} could not be parsed and was ignored.`,
            );
          }
        }

        const tChildren = Array.from(child.children).filter((el) => el.tagName === 't');
        const objectTags = parseObjectTags(child);
        let alias: string | undefined;
        let text: ChemDrawNode['text'];
        let style: ChemDrawNode['style'];
        let labelOrientation: ChemDrawNode['labelOrientation'];
        let labelAlignment: ChemDrawNode['labelAlignment'];
        if (tChildren.length > 0) {
          alias = extractTText(tChildren[0]) || undefined;
          // Stereo-descriptor annotations like "(S)" must not become atom aliases.
          if (alias && isStereodescriptor(alias)) alias = undefined;
          // GenericNickname attribute (e.g. TMS, Co2(CO)8) may not have a <t> child —
          // fall back to the XML attribute when the <t> text was absent or a stereo descriptor.
          if (!alias && nodeType === 'GenericNickname') {
            alias = child.getAttribute('GenericNickname') ?? undefined;
          }
          const runs = alias ? parseSRuns(tChildren[0]) : [];
          const justAttr =
            tChildren[0].getAttribute('Justification') ??
            tChildren[0].getAttribute('LabelJustification');
          const justification =
            justAttr === 'Left' ? 'left' : justAttr === 'Right' ? 'right' : 'center';
          labelAlignment = parseNodeLabelAlignment(tChildren[0].getAttribute('LabelAlignment'));
          if (runs.length > 0) text = { runs, justification };
          labelOrientation =
            justification === 'left'
              ? 'label-first'
              : justification === 'right'
                ? 'hydrogen-first'
                : undefined;
          const firstS = tChildren[0].querySelector('s');
          const fontSize = firstS ? parseFloat(firstS.getAttribute('size') ?? '12') : undefined;
          const fontId = firstS ? parseInt(firstS.getAttribute('font') ?? '1', 10) : undefined;
          const colorId = firstS ? parseInt(firstS.getAttribute('color') ?? '', 10) : undefined;
          style = {
            ...(fontSize != null && !isNaN(fontSize) ? { fontSize } : {}),
            ...(!isNaN(fontId ?? NaN) ? { fontFamily: fontNameById.get(fontId!) ?? 'Arial' } : {}),
            ...(!isNaN(colorId ?? NaN) ? { color: getImportColor(colorId!) } : {}),
          };
        }
        // No <t> child: fall back to GenericNickname attribute (e.g. TMS, Co2(CO)8).
        if (!alias && nodeType === 'GenericNickname') {
          alias = child.getAttribute('GenericNickname') ?? undefined;
        }
        // Skip ChemDraw structural annotations that are not real atoms.
        if (alias === 'ExternalConnectionPoint') {
          skippedNodeIds.add(cdxId);
          continue;
        }

        let query: ChemDrawNode['query'];
        if (nodeType === 'ElementList' || nodeType === 'ElementListNickname') {
          const list = genericList ?? elementList;
          if (list) {
            query = {
              type: list.negate ? 'not-list' : 'list',
              elements: list.values,
              label: alias,
              negateList: list.negate,
            };
          }
          warnings.push(`Query node ${cdxId} imported as ${nodeType}.`);
        } else if (
          nodeType === 'GenericNickname' ||
          nodeType === 'Nickname' ||
          nodeType === 'Fragment'
        ) {
          // Real superatom shorthand (OTBS, TMS, AcO, Co2(CO)8, etc.).
          // The alias text extracted from <t> above is the displayed label.
          // Treat as a regular atom with alias — no query semantics.
        } else if (
          nodeType === 'NamedAlternativeGroup' ||
          nodeType === 'AnonymousAlternativeGroup'
        ) {
          query = {
            type: 'r-group',
            label: alias,
            rGroupName: alias,
            ...(attachments?.length ? { attachments } : {}),
          };
          warnings.push(
            `Alternative-group node ${cdxId} preserved as R-group style query semantics.`,
          );
        } else if (nodeType === 'LinkNode') {
          query = {
            type: 'variable-attachment',
            label: alias,
            ...(linkCountLow != null && !Number.isNaN(parseInt(linkCountLow))
              ? { linkCountLow: parseInt(linkCountLow) }
              : {}),
            ...(linkCountHigh != null && !Number.isNaN(parseInt(linkCountHigh))
              ? { linkCountHigh: parseInt(linkCountHigh) }
              : {}),
            ...(attachments?.length ? { attachments } : {}),
          };
          warnings.push(`Link node ${cdxId} preserved with repeat-range query metadata.`);
        } else if (nodeType !== 'Element' && nodeType !== 'Unspecified') {
          query = {
            type: 'alias',
            label: alias ?? nodeType,
          };
          warnings.push(
            `Node ${cdxId} uses unsupported NodeType=${nodeType}; preserved as generic query metadata.`,
          );
        }

        let importedAlias = alias;
        let importedOrientation = labelOrientation;
        if (!query && alias) {
          const inferred = inferAtomLabelFromDisplayedText(alias, element);
          importedAlias = inferred.alias;
          importedOrientation = inferred.labelOrientation ?? importedOrientation;
        }

        // For GenericNickname atoms that are not recognized covalent shorthands
        // (e.g. Co2(CO)8, Fe4S4), inject coordination resolution to prevent
        // RDKit from marking the whole component red.
        if (
          !aliasResolution &&
          (nodeType === 'GenericNickname' || nodeType === 'Nickname' || nodeType === 'Fragment') &&
          importedAlias &&
          !SHORTHAND_DATA[importedAlias]
        ) {
          aliasResolution = {
            status: 'coordination_only',
            selectedLabel: importedAlias,
            semanticKind: 'coordination',
          };
        }
        const nodePreservationReasons: string[] = [];
        let nodePreservationCapability: ChemDrawPreservationMetadata['capability'];
        if (query) {
          nodePreservationCapability = 'round-trip-only';
          nodePreservationReasons.push(
            'Imported query or shorthand-node semantics are preserved but only partially editable.',
          );
        }

        const node: ChemDrawNode = {
          id: cdxId,
          type: 'node',
          position: { x, y },
          ...(geometry ? { geometry } : {}),
          ...(atomStereo ? { atomStereo } : {}),
          ...(bondOrdering?.length ? { bondOrdering } : {}),
          ...(sourceNodeType ? { sourceNodeType } : {}),
          ...(element ? { element } : {}),
          ...(importedAlias ? { alias: importedAlias } : {}),
          ...(charge != null ? { charge } : {}),
          ...(lonePairCount != null ? { lonePairCount } : {}),
          ...(radicalElectrons != null ? { radicalElectrons } : {}),
          ...(electronAngles?.length ? { electronAngles } : {}),
          ...(isotope != null ? { isotope } : {}),
          ...(importedAlias ? { alias: importedAlias } : {}),
          ...(text ? { text } : {}),
          ...(style && Object.keys(style).length > 0 ? { style } : {}),
          ...(importedOrientation ? { labelOrientation: importedOrientation } : {}),
          ...(labelAlignment ? { labelAlignment } : {}),
          ...(aliasResolution ? { aliasResolution } : {}),
          ...(ringTemplateMemberships?.length ? { ringTemplateMemberships } : {}),
          ...(query ? { query } : {}),
          ...(objectTags ? { objectTags } : {}),
        };
        const nodePreservation = buildPreservationMetadata({
          el: child,
          handledAttributeNames: [
            'id',
            'p',
            'p3',
            'Element',
            'Charge',
            'Radical',
            'NumUnpairedElectrons',
            'LonePairCount',
            CHEM_EDITOR_ELECTRON_ANGLES_ATTR,
            'Isotope',
            'Geometry',
            'AS',
            'BondOrdering',
            'NodeType',
            'ElementList',
            'GenericList',
            'Attachments',
            'LinkCountLow',
            'LinkCountHigh',
            'GenericNickname',
            'ChemEditorAliasResolution',
            CHEM_EDITOR_RING_TEMPLATE_ATOM_MEMBERSHIPS_ATTR,
          ],
          preserveChild: (grandchild) =>
            (grandchild.tagName !== 't' || grandchild !== tChildren[0]) &&
            grandchild.tagName !== 'objecttag' &&
            // Don't preserve embedded <fragment> sub-structure expansions. ChemDraw stores
            // the expanded atom graph of shorthand labels (OEt, TMS, …) as a <fragment>
            // child of the shorthand atom. Those atoms share IDs with top-level atoms,
            // causing ID collisions in our export that make ChemDraw silently drop bonds.
            // ChemDraw regenerates the sub-fragment from the label on import anyway.
            grandchild.tagName !== 'fragment',
          capability: nodePreservationCapability,
          reasons: nodePreservationReasons,
        });
        if (nodePreservation) {
          if (!nodePreservation.capability) {
            nodePreservation.capability = 'round-trip-only';
            if (!nodePreservation.reasons?.length) {
              nodePreservation.reasons = [
                'ChemDraw-specific node metadata is preserved for round-trip fidelity.',
              ];
            }
          }
          node.preservation = nodePreservation;
        }
        nodeIds.push(cdxId);
        nodeObjectIds.add(cdxId);
        objects.push(node);
      } else if (child.tagName === 'b') {
        const bondId = child.getAttribute('id') ?? makeIdGen()();
        const beginId = child.getAttribute('B');
        const endId = child.getAttribute('E');
        if (!beginId || !endId) continue;

        if (skippedNodeIds.has(beginId) || skippedNodeIds.has(endId)) continue;

        const orderStr = child.getAttribute('Order');
        const orderInfo = parseBondOrder(orderStr);
        const display = parseBondDisplay(child.getAttribute('Display'));
        const secondaryDisplay = parseBondDisplay(child.getAttribute('Display2'));
        const doubleBondModeAttr = child.getAttribute(CHEM_EDITOR_DOUBLE_BOND_MODE_ATTR);
        const doubleBondMode =
          doubleBondModeAttr === 'auto' ||
          doubleBondModeAttr === 'flipped' ||
          doubleBondModeAttr === 'symmetric'
            ? doubleBondModeAttr
            : undefined;
        const topology = child.getAttribute('Topology');
        const lineWidthAttr = child.getAttribute('LineWidth');
        const bondSpacingAttr = child.getAttribute('BondSpacing');
        const bondSpacingAbsAttr = child.getAttribute('BondSpacingAbs');
        const colorAttr = child.getAttribute('Color');
        let ringTemplateMemberships: ChemDrawBond['ringTemplateMemberships'];
        const ringTemplateMembershipsAttr = child.getAttribute(
          CHEM_EDITOR_RING_TEMPLATE_BOND_MEMBERSHIPS_ATTR,
        );
        if (ringTemplateMembershipsAttr) {
          try {
            const parsed = JSON.parse(ringTemplateMembershipsAttr) as Array<{
              structureId?: unknown;
              family?: unknown;
              preset?: unknown;
              bondKey?: unknown;
            }>;
            if (Array.isArray(parsed)) {
              ringTemplateMemberships = parsed
                .filter(
                  (entry) =>
                    typeof entry.structureId === 'string' &&
                    entry.family === 'chair' &&
                    (entry.preset === 'chair' || entry.preset === 'chair-flipped') &&
                    typeof entry.bondKey === 'string',
                )
                .map((entry) => ({
                  structureId: entry.structureId as string,
                  family: 'chair' as const,
                  preset: entry.preset as 'chair' | 'chair-flipped',
                  bondKey: entry.bondKey as string,
                }));
            }
          } catch {
            warnings.push(
              `Ring template metadata on bond ${bondId} could not be parsed and was ignored.`,
            );
          }
        }
        const bondPreservationReasons: string[] = [];
        let bondPreservationCapability: ChemDrawPreservationMetadata['capability'];
        if (secondaryDisplay || orderInfo.allowedOrders || topology) {
          bondPreservationCapability = 'round-trip-only';
          bondPreservationReasons.push(
            'Imported query or secondary-display bond semantics are preserved but only partially editable.',
          );
        }
        const bond: ChemDrawBond = {
          id: bondId,
          type: 'bond',
          beginNodeId: beginId,
          endNodeId: endId,
          ...(orderInfo.order != null ? { order: orderInfo.order } : {}),
          ...(orderInfo.order === 2 && doubleBondMode ? { doubleBondMode } : {}),
          ...(orderInfo.aromatic ? { aromatic: true } : {}),
          ...(display ? { display } : {}),
          ...(secondaryDisplay ? { secondaryDisplay } : {}),
          ...(ringTemplateMemberships?.length ? { ringTemplateMemberships } : {}),
          ...(bondSpacingAttr != null && !Number.isNaN(parseFloat(bondSpacingAttr))
            ? { bondSpacingPct: parseFloat(bondSpacingAttr) }
            : {}),
          ...(bondSpacingAbsAttr != null && !Number.isNaN(parseFloat(bondSpacingAbsAttr))
            ? { bondSpacingAbs: parseFloat(bondSpacingAbsAttr) }
            : {}),
          ...(lineWidthAttr || colorAttr
            ? {
                style: {
                  ...(lineWidthAttr != null && !Number.isNaN(parseFloat(lineWidthAttr))
                    ? { lineWidth: parseFloat(lineWidthAttr) }
                    : {}),
                  ...(colorAttr != null ? { color: getImportColor(parseInt(colorAttr, 10)) } : {}),
                },
              }
            : {}),
          ...(orderInfo.allowedOrders || topology
            ? {
                query: {
                  ...(orderInfo.allowedOrders ? { allowedOrders: orderInfo.allowedOrders } : {}),
                  ...(topology === 'Ring' ? { ringState: 'ring' } : {}),
                  ...(topology === 'Chain' ? { ringState: 'chain' } : {}),
                  ...(topology === 'RingOrChain' ? { ringState: 'either' } : {}),
                },
              }
            : {}),
        };
        const bondPreservation = buildPreservationMetadata({
          el: child,
          handledAttributeNames: [
            'id',
            'B',
            'E',
            'Order',
            'Display',
            'Display2',
            CHEM_EDITOR_DOUBLE_BOND_MODE_ATTR,
            'Topology',
            'LineWidth',
            'BondSpacing',
            'BondSpacingAbs',
            CHEM_EDITOR_RING_TEMPLATE_BOND_MEMBERSHIPS_ATTR,
            'color',
            'Color',
          ],
          preserveChild: () => true,
          capability: bondPreservationCapability,
          reasons: bondPreservationReasons,
        });
        if (bondPreservation) {
          if (!bondPreservation.capability) {
            bondPreservation.capability = 'round-trip-only';
            if (!bondPreservation.reasons?.length) {
              bondPreservation.reasons = [
                'ChemDraw-specific bond metadata is preserved for round-trip fidelity.',
              ];
            }
          }
          bond.preservation = bondPreservation;
        }
        if (secondaryDisplay) warnings.push(`Bond ${bondId} uses secondary display semantics.`);
        bondIds.push(bondId);
        objects.push(bond);
      }
    }

    const fragment: ChemDrawFragment = {
      id: fragmentId,
      type: 'fragment',
      nodeIds,
      bondIds,
    };
    const fragmentPreservation = buildPreservationMetadata({
      el: fragmentEl,
      handledAttributeNames: ['id'],
      preserveChild: () => false,
    });
    if (fragmentPreservation) {
      fragmentPreservation.capability = 'round-trip-only';
      fragmentPreservation.reasons = [
        'ChemDraw fragment metadata is preserved for round-trip fidelity.',
      ];
      fragment.preservation = fragmentPreservation;
    }
    objects.push(fragment);
  }

  const cdxArrows = doc.getElementsByTagName('arrow');
  for (let i = 0; i < cdxArrows.length; i++) {
    const a = cdxArrows[i];
    if (!isElementOnPage(a, pageEl) || hasAncestorTag(a, 'table')) continue;
    const id = a.getAttribute('id') ?? makeIdGen()();
    const head3D = a.getAttribute('Head3D');
    const tail3D = a.getAttribute('Tail3D');
    const center3D = a.getAttribute('Center3D');
    const majorAxisEnd3D = a.getAttribute('MajorAxisEnd3D');
    const minorAxisEnd3D = a.getAttribute('MinorAxisEnd3D');
    const curvePoints = a.getAttribute('CurvePoints');
    const bbox = a.getAttribute('BoundingBox');
    const angularSizeRaw = parseFloat(a.getAttribute('AngularSize') ?? '');

    let tail = { x: 0, y: 0 };
    let head = { x: 0, y: 0 };
    let controlPoint: { x: number; y: number } | undefined;
    let arcCenter: { x: number; y: number } | undefined;
    let majorAxisEnd: { x: number; y: number } | undefined;
    let minorAxisEnd: { x: number; y: number } | undefined;
    let isCurved = false;

    if (curvePoints) {
      const pts = curvePoints.trim().split(/\s+/).map(Number);
      if (pts.length >= 6) {
        tail = { x: pts[0] / importScaleFactor, y: pts[1] / importScaleFactor };
        controlPoint = { x: pts[2] / importScaleFactor, y: pts[3] / importScaleFactor };
        head = { x: pts[4] / importScaleFactor, y: pts[5] / importScaleFactor };
        isCurved = true;
      }
    } else if (head3D && tail3D) {
      const [hx, hy] = head3D.trim().split(/\s+/).map(Number);
      const [tx, ty] = tail3D.trim().split(/\s+/).map(Number);
      head = { x: hx / importScaleFactor, y: hy / importScaleFactor };
      tail = { x: tx / importScaleFactor, y: ty / importScaleFactor };
      arcCenter = parsePoint3D(center3D, importScaleFactor);
      majorAxisEnd = parsePoint3D(majorAxisEnd3D, importScaleFactor);
      minorAxisEnd = parsePoint3D(minorAxisEnd3D, importScaleFactor);
      isCurved = Boolean(arcCenter && majorAxisEnd && minorAxisEnd);
    } else if (bbox) {
      const [l, t, r, b] = bbox.trim().split(/\s+/).map(Number);
      tail = { x: l / importScaleFactor, y: t / importScaleFactor };
      head = { x: r / importScaleFactor, y: b / importScaleFactor };
      controlPoint = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
      warnings.push(`Arrow ${id} used BoundingBox fallback; exact geometry may be incomplete.`);
    }

    const typeStr = a.getAttribute('ArrowheadType') ?? '';
    const tailStr = a.getAttribute('ArrowheadTail') ?? '';
    const arrowTypeAttr = a.getAttribute('ArrowType') ?? '';
    const headStr = a.getAttribute('ArrowheadHead') ?? '';
    const fillType = a.getAttribute('FillType') ?? '';
    const noGo = a.getAttribute('NoGo') ?? '';
    const lineTypeAttr = (a.getAttribute('LineType') ?? '').toLowerCase();
    const editorArrowTypeAttr = a.getAttribute(CHEM_EDITOR_ARROW_TYPE_ATTR);
    const editorCurveEnabled = a.getAttribute(CHEM_EDITOR_ARROW_CURVE_ENABLED_ATTR) === 'true';
    const headType = parseChemDrawArrowHeadType(typeStr);

    const arrowLineWidthRaw = parseFloat(a.getAttribute('LineWidth') ?? '');
    const arrowLineWidth =
      !isNaN(arrowLineWidthRaw) && arrowLineWidthRaw > 0 ? arrowLineWidthRaw : undefined;
    const headSizeAttr = parseChemDrawArrowMetric(a.getAttribute('HeadSize'));
    const headCenterSizeAttr = parseChemDrawArrowMetric(
      a.getAttribute('ArrowheadCenterSize'),
      a.getAttribute('HeadCenterSize'),
    );
    const headWidthAttr = parseChemDrawArrowMetric(
      a.getAttribute('ArrowheadWidth'),
      a.getAttribute('HeadWidth'),
    );
    const shaftSpacingAttr = parseChemDrawArrowMetric(a.getAttribute('ArrowShaftSpacing'));
    const equilibriumRatioAttr = parseFloat(a.getAttribute('ArrowEquilibriumRatio') ?? '');

    let arrowType: ArrowType = isCurved ? 'curved' : 'reaction';
    if (
      noGo.toLowerCase() === 'retrosynthetic' ||
      typeStr.toLowerCase() === 'retrosynthetic' ||
      arrowTypeAttr.toLowerCase() === 'retrosynthetic' ||
      (headType === 'angle' && shaftSpacingAttr != null)
    ) {
      arrowType = 'retrosynthetic';
    } else if (noGo.toLowerCase() === 'cross') {
      arrowType = 'no-reaction';
    } else if (tailStr === 'Full') {
      arrowType = 'resonance';
    } else if (headStr === 'HalfRight' || headStr === 'HalfLeft') {
      arrowType = isCurved ? 'half-curved' : 'equilibrium';
    } else if (fillType === 'Solid' || headType === 'filled') {
      arrowType = 'fat';
    }
    if (
      editorArrowTypeAttr === 'reaction' ||
      editorArrowTypeAttr === 'equilibrium' ||
      editorArrowTypeAttr === 'retrosynthetic' ||
      editorArrowTypeAttr === 'curved' ||
      editorArrowTypeAttr === 'half-curved' ||
      editorArrowTypeAttr === 'no-reaction' ||
      editorArrowTypeAttr === 'dashed-reaction' ||
      editorArrowTypeAttr === 'resonance' ||
      editorArrowTypeAttr === 'fat'
    ) {
      arrowType = editorArrowTypeAttr;
    }
    const curveEnabled =
      arrowType === 'curved' || arrowType === 'half-curved' || editorCurveEnabled;

    const midY = (tail.y + head.y) / 2;
    let textAbove: ChemDrawArrow['textAbove'];
    let textBelow: ChemDrawArrow['textBelow'];
    let labelFontSize: number | undefined;
    let labelColor: string | undefined;

    for (let j = 0; j < a.children.length; j++) {
      const child = a.children[j];
      if (child.tagName !== 't') continue;
      const runs = parseSRuns(child);
      if (runs.length === 0) continue;
      const firstS = child.querySelector('s');
      const sizeAttr = firstS?.getAttribute('size');
      const colorAttr = firstS?.getAttribute('color');
      labelFontSize ??= sizeAttr ? parseFloat(sizeAttr) : undefined;
      labelColor ??= colorAttr != null ? getImportColor(parseInt(colorAttr)) : undefined;
      const block = { runs, justification: 'center' as const };

      const pAttr = child.getAttribute('p');
      if (pAttr) {
        const labelY = parseFloat(pAttr.trim().split(/\s+/)[1]) / importScaleFactor;
        if (labelY < midY) textAbove = block;
        else textBelow = block;
      } else {
        textAbove = block;
      }
    }

    const arrowColorAttr = a.getAttribute('color') ?? a.getAttribute('Color');
    const strokeColor =
      arrowColorAttr != null ? getImportColor(parseInt(arrowColorAttr, 10)) : undefined;
    const objectTags = parseObjectTags(a);
    const arrow: ChemDrawArrow = {
      id,
      type: 'arrow',
      arrowType,
      tail,
      head,
      ...(headType ? { headType } : {}),
      ...(headSizeAttr != null ? { headSize: headSizeAttr } : {}),
      ...(headCenterSizeAttr != null ? { headCenterSize: headCenterSizeAttr } : {}),
      ...(headWidthAttr != null ? { headWidth: headWidthAttr } : {}),
      ...(shaftSpacingAttr != null ? { shaftSpacing: shaftSpacingAttr } : {}),
      ...(!Number.isNaN(equilibriumRatioAttr) ? { equilibriumRatio: equilibriumRatioAttr } : {}),
      ...(controlPoint ? { controlPoint } : {}),
      ...(curveEnabled && arrowType !== 'curved' && arrowType !== 'half-curved'
        ? { curveEnabled: true }
        : {}),
      ...(textAbove ? { textAbove } : {}),
      ...(textBelow ? { textBelow } : {}),
      ...(arcCenter ? { arcCenter } : {}),
      ...(majorAxisEnd ? { majorAxisEnd } : {}),
      ...(minorAxisEnd ? { minorAxisEnd } : {}),
      ...(!Number.isNaN(angularSizeRaw) ? { angularSize: angularSizeRaw } : {}),
      style: {
        ...(labelFontSize != null ? { fontSize: labelFontSize } : {}),
        ...(labelColor ? { color: labelColor } : {}),
        ...(strokeColor ? { strokeColor } : {}),
        ...(arrowLineWidth != null ? { lineWidth: arrowLineWidth } : {}),
        ...(lineTypeAttr === 'dashed'
          ? { lineType: 'dashed' as const }
          : lineTypeAttr === 'bold'
            ? { lineType: 'bold' as const }
            : {}),
      },
      ...(objectTags ? { objectTags } : {}),
    };
    const arrowPreservationReasons: string[] = [];
    let arrowPreservationCapability: ChemDrawPreservationMetadata['capability'];
    if (bbox && !curvePoints && !(head3D && tail3D)) {
      arrowPreservationCapability = 'round-trip-only';
      arrowPreservationReasons.push(
        'Arrow geometry used a BoundingBox fallback and is preserved with limited editing fidelity.',
      );
    }
    const arrowPreservation = buildPreservationMetadata({
      el: a,
      handledAttributeNames: [
        'id',
        'Head3D',
        'Tail3D',
        'Center3D',
        'MajorAxisEnd3D',
        'MinorAxisEnd3D',
        'CurvePoints',
        'BoundingBox',
        'AngularSize',
        'ArrowheadType',
        'ArrowType',
        'ArrowheadHead',
        'ArrowheadTail',
        'FillType',
        'NoGo',
        CHEM_EDITOR_ARROW_TYPE_ATTR,
        CHEM_EDITOR_ARROW_CURVE_ENABLED_ATTR,
        'LineType',
        'LineWidth',
        'HeadSize',
        'ArrowheadCenterSize',
        'ArrowheadWidth',
        'HeadCenterSize',
        'HeadWidth',
        'ArrowShaftSpacing',
        'ArrowEquilibriumRatio',
        'color',
        'Color',
      ],
      preserveChild: (grandchild) =>
        grandchild.tagName !== 't' && grandchild.tagName !== 'objecttag',
      capability: arrowPreservationCapability,
      reasons: arrowPreservationReasons,
    });
    if (arrowPreservation) {
      if (!arrowPreservation.capability) {
        arrowPreservation.capability = 'round-trip-only';
        if (!arrowPreservation.reasons?.length) {
          arrowPreservation.reasons = [
            'ChemDraw-specific arrow metadata is preserved for round-trip fidelity.',
          ];
        }
      }
      arrow.preservation = arrowPreservation;
    }
    objects.push(arrow);
  }

  const tNodes = doc.getElementsByTagName('t');
  for (let i = 0; i < tNodes.length; i++) {
    const child = tNodes[i];
    if (!isElementOnPage(child, pageEl) || hasAncestorTag(child, 'table')) continue;
    // Only process standalone page-level text boxes. Skip <t> elements that are
    // children of structural containers (atom labels, arrow labels, bracket labels, etc.)
    const parentTag = child.parentElement?.tagName ?? '';
    if (parentTag !== 'page' && parentTag !== 'group') continue;

    const pAttr = child.getAttribute('p');
    if (!pAttr) continue;
    const parts = pAttr.trim().split(/\s+/);
    const x = parseFloat(parts[0]) / importScaleFactor;
    const y = parseFloat(parts[1]) / importScaleFactor;
    if (isNaN(x) || isNaN(y)) continue;

    const runs = parseSRuns(child);
    if (runs.length === 0) continue;
    const chemicalMetadata = parseChemicalMetadataAttr(
      child.getAttribute(CHEM_EDITOR_CHEMICAL_METADATA_ATTR),
      warnings,
      `Text object ${child.getAttribute('id') ?? 'without id'}`,
    );
    const semanticModeAttr = child.getAttribute(CHEM_EDITOR_TEXT_SEMANTIC_MODE_ATTR);
    const semanticMode =
      semanticModeAttr === 'plain' || semanticModeAttr === 'chemical' || semanticModeAttr === 'auto'
        ? semanticModeAttr
        : undefined;
    const conversionStatusAttr = child.getAttribute(CHEM_EDITOR_TEXT_CONVERSION_STATUS_ATTR);
    const conversionStatus =
      conversionStatusAttr === 'plain' ||
      conversionStatusAttr === 'resolved' ||
      conversionStatusAttr === 'unresolved'
        ? conversionStatusAttr
        : undefined;

    const justAttr =
      child.getAttribute('Justification') ?? child.getAttribute('LabelJustification') ?? 'Center';
    const justification = justAttr === 'Left' ? 'left' : justAttr === 'Right' ? 'right' : 'center';
    const rotationAttr = child.getAttribute('RotationAngle');
    const rotation = rotationAttr != null ? parseFloat(rotationAttr) / 65536 : undefined;
    const bboxAttr = child.getAttribute('BoundingBox');
    let width: number | undefined;
    let bounds: ChemDrawText['text']['bounds'];
    if (bboxAttr) {
      const [left, top, right, bottom] = bboxAttr.trim().split(/\s+/).map(Number);
      if (!isNaN(left) && !isNaN(right) && right > left) width = (right - left) / importScaleFactor;
      if (![left, top, right, bottom].some(Number.isNaN)) {
        bounds = {
          left: left / importScaleFactor,
          top: top / importScaleFactor,
          right: right / importScaleFactor,
          bottom: bottom / importScaleFactor,
        };
      }
    }

    const firstS = child.querySelector('s');
    const fontSizeRaw = firstS ? parseFloat(firstS.getAttribute('size') ?? '14') : 14;
    const fontSize = isNaN(fontSizeRaw) ? 14 : fontSizeRaw;
    const fontId = firstS ? parseInt(firstS.getAttribute('font') ?? '1') : 1;
    const fontFamily = fontNameById.get(fontId) ?? 'Arial';
    const textColor = runs.find((r) => r.color)?.color ?? '#000000';

    const textObject: ChemDrawText = {
      id: child.getAttribute('id') ?? makeIdGen()(),
      type: 'text',
      anchor: { x, y },
      text: {
        runs,
        justification,
        ...(width != null ? { width } : {}),
        ...(bounds ? { bounds } : {}),
      },
      style: {
        color: textColor,
        fontFamily,
        fontSize,
        ...(rotation != null && !isNaN(rotation) ? { rotation } : {}),
      },
      ...(semanticMode ? { semanticMode } : {}),
      ...(conversionStatus ? { conversionStatus } : {}),
      ...(chemicalMetadata ? { chemicalMetadata } : {}),
    };
    const textPreservationReasons: string[] = [];
    let textPreservationCapability: ChemDrawPreservationMetadata['capability'];
    if (parentTag === 'group') {
      textPreservationCapability = 'round-trip-only';
      textPreservationReasons.push(
        'Text imported from a ChemDraw group keeps its appearance, but group container semantics are only partially editable.',
      );
    }
    const textPreservation = buildPreservationMetadata({
      el: child,
      handledAttributeNames: [
        'id',
        'p',
        'Justification',
        'LabelJustification',
        'RotationAngle',
        'BoundingBox',
        CHEM_EDITOR_CHEMICAL_METADATA_ATTR,
        CHEM_EDITOR_TEXT_SEMANTIC_MODE_ATTR,
        CHEM_EDITOR_TEXT_CONVERSION_STATUS_ATTR,
      ],
      preserveChild: (grandchild) =>
        grandchild.tagName !== 's' && grandchild.tagName !== 'objecttag',
      capability: textPreservationCapability,
      reasons: textPreservationReasons,
    });
    if (textPreservation) {
      if (!textPreservation.capability) {
        textPreservation.capability = 'round-trip-only';
        if (!textPreservation.reasons?.length) {
          textPreservation.reasons = [
            'ChemDraw-specific text metadata is preserved for round-trip fidelity.',
          ];
        }
      }
      textObject.preservation = textPreservation;
    }
    objects.push(textObject);
  }

  const standaloneNodeCount = Array.from(doc.getElementsByTagName('n')).filter(
    (node) =>
      isElementOnPage(node, pageEl) &&
      !hasAncestorTag(node, 'table') &&
      !nodeObjectIds.has(node.getAttribute('id') ?? ''),
  ).length;
  if (standaloneNodeCount > 0) {
    warnings.push(
      `${standaloneNodeCount} node(s) appeared outside fragment scope and were ignored.`,
    );
  }

  const bracketEls = doc.getElementsByTagName('bracketedgroup');
  for (let i = 0; i < bracketEls.length; i++) {
    const bracket = bracketEls[i];
    if (!isElementOnPage(bracket, pageEl) || hasAncestorTag(bracket, 'table')) continue;
    const id = bracket.getAttribute('id') ?? makeIdGen()();
    const bracketType =
      bracket.getAttribute('BracketUsage') ?? bracket.getAttribute('RepeatPattern') ?? 'generic';
    const bounds =
      parseBounds(bracket.getAttribute('BoundingBox'), importScaleFactor) ??
      parseBounds(bracket.getAttribute('BracketedObjectBoundingBox'), importScaleFactor);
    const text = getFirstDirectChildByTagName(bracket, 't');
    const objectTags = parseObjectTags(bracket);
    const bracketObject: ChemDrawBracket = {
      id,
      type: 'bracket',
      bounds: bounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
      bracketType: bracketType.toLowerCase().includes('multiple')
        ? 'multiple-group'
        : bracketType.toLowerCase().includes('mix')
          ? 'mixture'
          : bracketType.toLowerCase().includes('repeat') ||
              bracketType.toLowerCase().includes('sru')
            ? 'sru'
            : 'generic',
      ...(text ? { label: extractTText(text) } : {}),
      ...(objectTags ? { objectTags } : {}),
    };
    const bracketPreservation = buildPreservationMetadata({
      el: bracket,
      handledAttributeNames: [
        'id',
        'BracketUsage',
        'RepeatPattern',
        'BoundingBox',
        'BracketedObjectBoundingBox',
      ],
      preserveChild: (child) =>
        (child.tagName !== 't' || child !== text) && child.tagName !== 'objecttag',
      capability: 'round-trip-only',
      reasons: ['Imported bracket-group semantics are preserved with limited native editing.'],
    });
    if (bracketPreservation) bracketObject.preservation = bracketPreservation;
    objects.push(bracketObject);
    if (!bounds) warnings.push(`Bracketed group ${id} is missing a usable bounding box.`);
  }

  const graphicObjectTypes = new Set([
    'graphic',
    'curve',
    'line',
    'rect',
    'rectangle',
    'oval',
    'ellipse',
    'polygon',
    'arc',
  ]);
  const seenGraphicIds = new Set<string>();
  for (const tagName of graphicObjectTypes) {
    const els = doc.getElementsByTagName(tagName);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!isElementOnPage(el, pageEl) || hasAncestorTag(el, 'table')) continue;
      const id = el.getAttribute('id') ?? makeIdGen()();
      if (seenGraphicIds.has(id)) continue;
      seenGraphicIds.add(id);
      if (el.getAttribute('SupersededBy')) continue;

      const bbox = parseBounds(el.getAttribute('BoundingBox'), importScaleFactor);
      const bboxEndpoints = parseBoundingBoxEndpoints(
        el.getAttribute('BoundingBox'),
        importScaleFactor,
      );
      const pointsAttr = el.getAttribute('CurvePoints') ?? el.getAttribute('Points');
      const explicitPoints = pointsAttr
        ? (() => {
            const nums = pointsAttr.trim().split(/\s+/).map(Number);
            if (nums.length < 2 || nums.some(Number.isNaN)) return undefined;
            const parsed = [];
            for (let j = 0; j + 1 < nums.length; j += 2) {
              parsed.push({ x: nums[j] / importScaleFactor, y: nums[j + 1] / importScaleFactor });
            }
            return parsed;
          })()
        : undefined;

      const normalizedTag = tagName.toLowerCase();
      const graphicTypeAttr = el.getAttribute('GraphicType')?.toLowerCase();
      const rectType = el.getAttribute('RectangleType')?.toLowerCase() ?? '';
      const isRect =
        normalizedTag === 'rect' ||
        normalizedTag === 'rectangle' ||
        (normalizedTag === 'graphic' && graphicTypeAttr === 'rectangle');
      const isRounded = isRect && rectType.includes('round');
      const graphicType: ChemDrawGraphic['graphicType'] =
        normalizedTag === 'line'
          ? 'line'
          : normalizedTag === 'graphic' && graphicTypeAttr === 'symbol'
            ? 'symbol'
            : normalizedTag === 'graphic' && graphicTypeAttr === 'bracket'
              ? 'bracket'
              : normalizedTag === 'graphic' && graphicTypeAttr === 'orbital'
                ? 'orbital'
                : normalizedTag === 'graphic' && graphicTypeAttr === 'line'
                  ? 'line'
                  : isRounded
                    ? 'rounded-rectangle'
                    : isRect
                      ? 'rectangle'
                      : normalizedTag === 'oval' ||
                          normalizedTag === 'ellipse' ||
                          (normalizedTag === 'graphic' && graphicTypeAttr === 'oval')
                        ? 'ellipse'
                        : normalizedTag === 'polygon' ||
                            (normalizedTag === 'graphic' && graphicTypeAttr === 'polygon')
                          ? 'polygon'
                          : 'unknown';
      const points =
        explicitPoints ??
        (bboxEndpoints &&
        (graphicType === 'line' || graphicType === 'bracket' || graphicType === 'orbital')
          ? [
              { x: bboxEndpoints[0], y: bboxEndpoints[1] },
              { x: bboxEndpoints[2], y: bboxEndpoints[3] },
            ]
          : undefined);

      // ChemDraw CornerRadius is in 1/65536 pt units. Convert to canvas px.
      // Fall back to 10px when the attribute is absent.
      const cornerRadiusRaw = el.getAttribute('CornerRadius');
      const cornerRadius =
        graphicType === 'rounded-rectangle'
          ? cornerRadiusRaw != null
            ? parseFloat(cornerRadiusRaw) / 100 / importScaleFactor
            : 10
          : undefined;

      const graphicColorAttr = el.getAttribute('color') ?? el.getAttribute('Color');
      const graphicColor =
        graphicColorAttr != null ? getImportColor(parseInt(graphicColorAttr, 10)) : undefined;
      const graphicFillColorAttr = el.getAttribute('FillColor');
      const graphicFillColor =
        graphicFillColorAttr != null
          ? getImportColor(parseInt(graphicFillColorAttr, 10))
          : undefined;
      const zIndexAttr = el.getAttribute('Z');
      const visibleAttr = parseChemDrawBoolean(el.getAttribute('Visible') ?? undefined);
      const graphicLineWidthRaw = el.getAttribute('LineWidth');
      const graphicLineWidth =
        graphicLineWidthRaw != null ? parseFloat(graphicLineWidthRaw) : undefined;
      const graphicLineTypeAttr = (el.getAttribute('LineType') ?? '').toLowerCase();
      const shadowSizeRaw = parseFloat(el.getAttribute('ShadowSize') ?? '');
      const shadowSize = Number.isFinite(shadowSizeRaw)
        ? shadowSizeRaw / 100 / importScaleFactor
        : undefined;
      const symbolType = el.getAttribute('SymbolType') ?? undefined;
      const representEl = el.getElementsByTagName('represent')[0];
      const bracketType = el.getAttribute('BracketType') ?? undefined;
      const bracketUsage = el.getAttribute('BracketUsage') ?? undefined;
      const lipSizeRaw = parseFloat(el.getAttribute('LipSize') ?? '');
      const lipSize = Number.isFinite(lipSizeRaw) ? lipSizeRaw / 6 : undefined;
      const orbitalType = el.getAttribute('OrbitalType') ?? undefined;
      const ovalType = el.getAttribute('OvalType') ?? undefined;
      const center = parsePoint3D(el.getAttribute('Center3D'), importScaleFactor);
      const majorAxisEnd = parsePoint3D(el.getAttribute('MajorAxisEnd3D'), importScaleFactor);
      const minorAxisEnd = parsePoint3D(el.getAttribute('MinorAxisEnd3D'), importScaleFactor);
      const objectTags = parseObjectTags(el);
      const bracketLabel =
        extractGraphicObjectTagText(el, 'parameterizedBracketLabel') ??
        extractGraphicObjectTagText(el, 'bracketusage');

      const graphicObject: ChemDrawGraphic = {
        id,
        type: 'graphic',
        graphicType,
        ...(points ? { points } : {}),
        ...(bbox ? { bounds: bbox } : {}),
        ...(cornerRadius != null ? { cornerRadius } : {}),
        ...(rectType ? { rectangleType: el.getAttribute('RectangleType') ?? undefined } : {}),
        ...(shadowSize != null ? { shadowSize } : {}),
        ...(symbolType ? { symbolType } : {}),
        ...(representEl?.getAttribute('object')
          ? { representedObjectId: representEl.getAttribute('object')! }
          : {}),
        ...(representEl?.getAttribute('attribute')
          ? { representedAttribute: representEl.getAttribute('attribute')! }
          : {}),
        ...(bracketType ? { bracketType } : {}),
        ...(bracketUsage ? { bracketUsage } : {}),
        ...(bracketLabel ? { label: bracketLabel } : {}),
        ...(lipSize != null ? { lipSize } : {}),
        ...(orbitalType ? { orbitalType } : {}),
        ...(ovalType ? { ovalType } : {}),
        ...(center ? { center } : {}),
        ...(majorAxisEnd ? { majorAxisEnd } : {}),
        ...(minorAxisEnd ? { minorAxisEnd } : {}),
        ...(graphicColor ||
        graphicFillColor ||
        graphicLineWidth != null ||
        graphicLineTypeAttr === 'dashed' ||
        graphicLineTypeAttr === 'bold' ||
        zIndexAttr != null ||
        visibleAttr != null ||
        (graphicType === 'orbital' && ovalType?.toLowerCase().includes('shaded'))
          ? {
              style: {
                ...(graphicColor ? { color: graphicColor } : {}),
                ...(graphicFillColor ? { fillColor: graphicFillColor } : {}),
                ...(graphicLineWidth != null ? { lineWidth: graphicLineWidth } : {}),
                ...(graphicLineTypeAttr === 'dashed'
                  ? { lineType: 'dashed' as const }
                  : graphicLineTypeAttr === 'bold'
                    ? { lineType: 'bold' as const }
                    : {}),
                ...(zIndexAttr != null && !Number.isNaN(parseInt(zIndexAttr, 10))
                  ? { zIndex: parseInt(zIndexAttr, 10) }
                  : {}),
                ...(visibleAttr != null ? { visible: visibleAttr } : {}),
                ...(graphicType === 'orbital' && ovalType?.toLowerCase().includes('shaded')
                  ? { fillColor: graphicColor ?? '#7f8cff' }
                  : {}),
              },
            }
          : {}),
        ...(objectTags ? { objectTags } : {}),
      };
      const graphicPreservation = buildPreservationMetadata({
        el,
        handledAttributeNames: [
          'id',
          'BoundingBox',
          'CurvePoints',
          'Points',
          'GraphicType',
          'color',
          'Color',
          'FillColor',
          'Visible',
          'Z',
          'LineWidth',
          'LineType',
          'RectangleType',
          'CornerRadius',
          'ShadowSize',
          'SymbolType',
          'BracketType',
          'BracketUsage',
          'LipSize',
          'OrbitalType',
          'OvalType',
          'Center3D',
          'MajorAxisEnd3D',
          'MinorAxisEnd3D',
          'SupersededBy',
        ],
        preserveChild: (child) => {
          if (child.tagName === 'represent') return false;
          if (child.tagName === 'objecttag') {
            return false;
          }
          return true;
        },
        capability: graphicType === 'unknown' ? 'render-only' : 'round-trip-only',
        reasons: [
          graphicType === 'unknown'
            ? 'Unsupported ChemDraw graphic content is preserved for export, but cannot be edited natively.'
            : 'Imported ChemDraw graphic content keeps its fidelity and round-trips with limited native editing.',
        ],
      });
      if (graphicPreservation) graphicObject.preservation = graphicPreservation;
      objects.push(graphicObject);
    }
  }

  const embeddedObjectEls = doc.getElementsByTagName('embeddedobject');
  for (let i = 0; i < embeddedObjectEls.length; i++) {
    const embeddedObjectEl = embeddedObjectEls[i];
    if (!isElementOnPage(embeddedObjectEl, pageEl) || hasAncestorTag(embeddedObjectEl, 'table')) {
      continue;
    }
    const id = embeddedObjectEl.getAttribute('id') ?? makeIdGen()();
    const bounds =
      parseBounds(embeddedObjectEl.getAttribute('BoundingBox'), importScaleFactor) ??
      parseBounds(embeddedObjectEl.getAttribute('Bounds'), importScaleFactor);
    const payloadHex =
      embeddedObjectEl.getAttribute('PDF') ??
      embeddedObjectEl.getAttribute('PNG') ??
      embeddedObjectEl.getAttribute('JPEG') ??
      '';
    const payloadKind = embeddedObjectEl.getAttribute('PDF')
      ? 'pdf'
      : embeddedObjectEl.getAttribute('PNG')
        ? 'png'
        : embeddedObjectEl.getAttribute('JPEG')
          ? 'jpeg'
          : 'unknown';
    const previewData = extractEmbeddedPreviewData(payloadKind, payloadHex);
    const style = {
      ...(embeddedObjectEl.getAttribute('Z') != null &&
      !Number.isNaN(parseInt(embeddedObjectEl.getAttribute('Z') ?? '', 10))
        ? { zIndex: parseInt(embeddedObjectEl.getAttribute('Z') ?? '', 10) }
        : {}),
      ...(parseChemDrawBoolean(embeddedObjectEl.getAttribute('Visible') ?? undefined) != null
        ? { visible: parseChemDrawBoolean(embeddedObjectEl.getAttribute('Visible') ?? undefined) }
        : {}),
    };
    const objectTags = parseObjectTags(embeddedObjectEl);
    const embeddedObject: ChemDrawEmbeddedObject = {
      id,
      type: 'embedded-object',
      bounds: bounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
      payloadKind,
      payloadHex,
      ...(previewData.previewDataUrl ? { previewDataUrl: previewData.previewDataUrl } : {}),
      ...(previewData.sourceMimeType ? { sourceMimeType: previewData.sourceMimeType } : {}),
      ...(previewData.sourceFileName ? { sourceFileName: previewData.sourceFileName } : {}),
      ...(Object.keys(style).length > 0 ? { style } : {}),
      ...(objectTags ? { objectTags } : {}),
    };
    const preservation = buildPreservationMetadata({
      el: embeddedObjectEl,
      handledAttributeNames: ['id', 'BoundingBox', 'Bounds', 'Z', 'Visible', 'PDF', 'PNG', 'JPEG'],
      preserveChild: (child) => child.tagName !== 'objecttag',
      capability: 'round-trip-only',
      reasons: [
        'Embedded ChemDraw objects keep fidelity and remain editable only at the object level.',
      ],
    });
    if (preservation) embeddedObject.preservation = preservation;
    objects.push(embeddedObject);
  }

  const tableEls = doc.getElementsByTagName('table');
  for (let i = 0; i < tableEls.length; i++) {
    const tableEl = tableEls[i];
    if (!isElementOnPage(tableEl, pageEl)) continue;
    const id = tableEl.getAttribute('id') ?? makeIdGen()();
    const bounds =
      parseBounds(tableEl.getAttribute('BoundingBox'), importScaleFactor) ??
      parseBounds(tableEl.getAttribute('Bounds'), importScaleFactor);
    const objectTags = parseObjectTags(tableEl);
    const cells = getDirectChildrenByTagName(tableEl, 'page').map((cellEl, index) => {
      const textEl = getFirstDirectChildByTagName(cellEl, 't');
      const preservation = buildPreservationMetadata({
        el: cellEl,
        handledAttributeNames: ['id', 'BoundsInParent'],
        preserveChild: (child) => child.tagName !== 't' || child !== textEl,
        capability: 'round-trip-only',
        reasons: ['ChemDraw table cell content is preserved for whole-table editing only.'],
      });
      return {
        id: cellEl.getAttribute('id') ?? `${id}-cell-${index + 1}`,
        boundsInParent: parseBounds(cellEl.getAttribute('BoundsInParent'), importScaleFactor) ??
          parseBounds(cellEl.getAttribute('BoundingBox'), importScaleFactor) ?? {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          },
        ...(textEl ? { text: parseTextBlock(textEl) } : {}),
        ...(preservation?.rawAttributes ? { rawAttributes: preservation.rawAttributes } : {}),
        ...(preservation?.rawChildrenXml ? { rawChildrenXml: preservation.rawChildrenXml } : {}),
        ...(preservation ? { preservation } : {}),
      };
    });
    const style = {
      ...(tableEl.getAttribute('Z') != null &&
      !Number.isNaN(parseInt(tableEl.getAttribute('Z') ?? '', 10))
        ? { zIndex: parseInt(tableEl.getAttribute('Z') ?? '', 10) }
        : {}),
      ...(parseChemDrawBoolean(tableEl.getAttribute('Visible') ?? undefined) != null
        ? { visible: parseChemDrawBoolean(tableEl.getAttribute('Visible') ?? undefined) }
        : {}),
      ...(tableEl.getAttribute('Color') != null
        ? { color: getImportColor(parseInt(tableEl.getAttribute('Color') ?? '', 10)) }
        : {}),
      ...(tableEl.getAttribute('FillColor') != null
        ? { fillColor: getImportColor(parseInt(tableEl.getAttribute('FillColor') ?? '', 10)) }
        : {}),
    };
    const table: ChemDrawTable = {
      id,
      type: 'table',
      bounds: bounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
      cells,
      ...(Object.keys(style).length > 0 ? { style } : {}),
      ...(objectTags ? { objectTags } : {}),
    };
    const preservation = buildPreservationMetadata({
      el: tableEl,
      handledAttributeNames: ['id', 'BoundingBox', 'Bounds', 'Z', 'Visible', 'Color', 'FillColor'],
      preserveChild: (child) => child.tagName !== 'page' && child.tagName !== 'objecttag',
      capability: 'round-trip-only',
      reasons: ['ChemDraw tables keep fidelity and support whole-table transforms only.'],
    });
    if (preservation) table.preservation = preservation;
    objects.push(table);
  }

  const handledTopLevelTags = new Set([
    'fragment',
    'arrow',
    't',
    'bracketedgroup',
    'embeddedobject',
    'table',
    'graphic',
    'curve',
    'line',
    'rect',
    'rectangle',
    'oval',
    'ellipse',
    'polygon',
    'arc',
  ]);
  if (pageEl) {
    for (let i = 0; i < pageEl.children.length; i++) {
      const child = pageEl.children[i];
      const tag = child.tagName.toLowerCase();
      if (handledTopLevelTags.has(tag)) continue;
      if (tag === 'n' || tag === 'b') continue;
      // <chemicalproperty> is ChemDraw CDX object type 97 — a stale computed-property
      // display element that ChemDraw regenerates from structure automatically. Preserving
      // it in our CDXML export causes ChemDraw to show a blocking "Unknown types: 97" dialog
      // on open (since it uses internal attribute encoding our export doesn't reproduce exactly).
      // ChemDraw drops it on re-export anyway, so preserving it has no round-trip value.
      if (tag === 'chemicalproperty') continue;
      if (tag === 'group' || tag === 'scheme' || tag === 'step') {
        const hasModeledDescendants = Boolean(
          child.querySelector(
            'fragment,arrow,t,bracketedgroup,embeddedobject,table,graphic,curve,line,rect,rectangle,oval,ellipse,polygon,arc',
          ),
        );
        if (!hasModeledDescendants) {
          preservedPageChildren.push({
            tagName: tag,
            xml: new XMLSerializer().serializeToString(child),
            capability: 'render-only',
            reason: `Unsupported page-level <${tag}> content is preserved for export only.`,
          });
        } else {
          warnings.push(
            `Top-level <${tag}> container semantics are only partially preserved and may not round-trip fully.`,
          );
        }
        continue;
      }
      preservedPageChildren.push({
        tagName: tag,
        xml: new XMLSerializer().serializeToString(child),
        capability: 'render-only',
        reason: `Unsupported top-level CDXML object <${tag}> is preserved for export only.`,
      });
      warnings.push(`Unsupported top-level CDXML object <${tag}> was preserved for export only.`);
    }
  }

  const firstReactionArrow = objects.find(
    (object): object is ChemDrawArrow =>
      object.type === 'arrow' &&
      (object.arrowType === 'reaction' ||
        object.arrowType === 'equilibrium' ||
        object.arrowType === 'retrosynthetic'),
  );
  if (firstReactionArrow) {
    const dx = firstReactionArrow.head.x - firstReactionArrow.tail.x;
    const dy = firstReactionArrow.head.y - firstReactionArrow.tail.y;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
      const nodeById = new Map(
        objects
          .filter((object): object is ChemDrawNode => object.type === 'node')
          .map((node) => [node.id, node]),
      );
      for (const object of objects) {
        if (object.type !== 'fragment') continue;
        const fragmentNodes = object.nodeIds
          .map((nodeId) => nodeById.get(nodeId))
          .filter(Boolean) as ChemDrawNode[];
        if (fragmentNodes.length === 0) continue;
        const centroid = fragmentNodes.reduce(
          (acc, node) => ({ x: acc.x + node.position.x, y: acc.y + node.position.y }),
          { x: 0, y: 0 },
        );
        centroid.x /= fragmentNodes.length;
        centroid.y /= fragmentNodes.length;

        const projection =
          ((centroid.x - firstReactionArrow.tail.x) * dx +
            (centroid.y - firstReactionArrow.tail.y) * dy) /
          len2;
        if (firstReactionArrow.arrowType === 'retrosynthetic') {
          object.role = projection < 0.5 ? 'product' : 'reactant';
        } else if (firstReactionArrow.arrowType === 'equilibrium') {
          object.role = 'unknown';
        } else {
          object.role = projection < 0.5 ? 'reactant' : 'product';
        }
      }
      warnings.push(
        'Fragment reaction roles were inferred heuristically from the first reaction arrow.',
      );
    }
  }

  const pageBoundsAttr = pageEl?.getAttribute('BoundingBox');
  const pageBounds = pageBoundsAttr ? parseBounds(pageBoundsAttr, importScaleFactor) : undefined;
  const importedWidthPages = Math.max(
    1,
    parseInt(pageEl?.getAttribute('WidthPages') ?? '1', 10) || 1,
  );
  const importedHeightPages = Math.max(
    1,
    parseInt(pageEl?.getAttribute('HeightPages') ?? '1', 10) || 1,
  );
  let importedAtomColors = DEFAULT_DOCUMENT_STYLE_SETTINGS.colors.atomColors;
  const atomColorsAttr = root.getAttribute('ChemEditorAtomColors');
  if (atomColorsAttr) {
    try {
      const parsed = JSON.parse(atomColorsAttr) as Record<string, string>;
      importedAtomColors = { ...importedAtomColors, ...parsed };
    } catch {
      // Keep defaults if custom metadata is malformed.
    }
  }
  const importedCanvasBondLength = root.getAttribute('ChemEditorBondLength')
    ? parseFloat(root.getAttribute('ChemEditorBondLength')!) ||
      DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength
    : CANVAS_BOND_PX;
  const legacyBondLineWidthRaw = parseFloat(root.getAttribute('ChemEditorBondLineWidth') ?? '');
  const legacyTextFontSizeRaw = parseFloat(root.getAttribute('ChemEditorTextFontSize') ?? '');
  const legacyTextFontFamily = root.getAttribute('ChemEditorTextFontFamily') ?? undefined;
  const rootLineWidth = parseFloat(root.getAttribute('LineWidth') ?? '');
  const rootBoldWidth = parseFloat(root.getAttribute('BoldWidth') ?? '');
  const rootBondSpacingPct = parseFloat(root.getAttribute('BondSpacing') ?? '');
  const rootBondSpacingAbs = parseFloat(root.getAttribute('BondSpacingAbs') ?? '');
  const rootMarginWidth = parseFloat(root.getAttribute('MarginWidth') ?? '');
  const rootHashSpacing = parseFloat(root.getAttribute('HashSpacing') ?? '');
  const rootLabelSize = parseFloat(root.getAttribute('LabelSize') ?? '');
  const rootCaptionSize = parseFloat(root.getAttribute('CaptionSize') ?? '');
  const rootLabelFace = parseFloat(root.getAttribute('LabelFace') ?? '');
  const rootCaptionFace = parseFloat(root.getAttribute('CaptionFace') ?? '');
  const labelFontId = parseInt(root.getAttribute('LabelFont') ?? '', 10);
  const captionFontId = parseInt(root.getAttribute('CaptionFont') ?? '', 10);
  const nativeMetrics = normalizeChemDrawStyleSheet(
    {
      bondLength: docBondLength,
      ...(Number.isFinite(rootLineWidth) && rootLineWidth > 0 ? { lineWidth: rootLineWidth } : {}),
      ...(Number.isFinite(rootBoldWidth) && rootBoldWidth > 0 ? { boldWidth: rootBoldWidth } : {}),
      ...(Number.isFinite(rootBondSpacingPct) && rootBondSpacingPct > 0
        ? { bondSpacingPct: rootBondSpacingPct }
        : Number.isFinite(rootBondSpacingAbs) && rootBondSpacingAbs > 0 && docBondLength > 0
          ? { bondSpacingPct: (rootBondSpacingAbs / docBondLength) * 100 }
          : {}),
      ...(Number.isFinite(rootMarginWidth) && rootMarginWidth > 0
        ? { marginWidth: rootMarginWidth }
        : {}),
      ...(Number.isFinite(rootHashSpacing) && rootHashSpacing > 0
        ? { hashSpacing: rootHashSpacing }
        : {}),
      ...(Number.isFinite(rootLabelSize) && rootLabelSize > 0 ? { labelSize: rootLabelSize } : {}),
      ...(Number.isFinite(rootCaptionSize) && rootCaptionSize > 0
        ? { captionSize: rootCaptionSize }
        : {}),
      ...(Number.isFinite(rootLabelFace) ? { labelFace: rootLabelFace } : {}),
      ...(Number.isFinite(rootCaptionFace) ? { captionFace: rootCaptionFace } : {}),
      ...(!Number.isNaN(labelFontId) && fontNameById.get(labelFontId)
        ? { labelFontFamily: fontNameById.get(labelFontId)! }
        : {}),
      ...(!Number.isNaN(captionFontId) && fontNameById.get(captionFontId)
        ? { captionFontFamily: fontNameById.get(captionFontId)! }
        : {}),
    },
    {
      canvasBondLength: importedCanvasBondLength,
      legacyBondLineWidth:
        !Number.isFinite(rootLineWidth) || rootLineWidth <= 0
          ? Number.isFinite(legacyBondLineWidthRaw)
            ? legacyBondLineWidthRaw
            : undefined
          : undefined,
      legacyTextFormat: {
        ...(legacyTextFontFamily ? { fontFamily: legacyTextFontFamily } : {}),
        ...(!Number.isFinite(rootCaptionSize) || rootCaptionSize <= 0
          ? Number.isFinite(legacyTextFontSizeRaw)
            ? { fontSize: legacyTextFontSizeRaw }
            : {}
          : {}),
      },
    },
  );
  const importedDocumentStyleSettings: DocumentStyleSettings = {
    bondLength: importedCanvasBondLength,
    nativeMetrics,
    bondLineWidth: getDocumentBondLineWidth({
      bondLength: importedCanvasBondLength,
      nativeMetrics,
    }),
    textFormat: {
      fontFamily: nativeMetrics.captionFontFamily,
      fontSize: getDocumentCaptionFontSize({
        bondLength: importedCanvasBondLength,
        nativeMetrics,
      }),
      color:
        root.getAttribute('ChemEditorTextColor') ??
        DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.color,
      textAlign:
        root.getAttribute('ChemEditorTextAlign') === 'left'
          ? 'left'
          : root.getAttribute('ChemEditorTextAlign') === 'right'
            ? 'right'
            : DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.textAlign,
    },
    colors: {
      bondColor:
        root.getAttribute('ChemEditorBondColor') ??
        DEFAULT_DOCUMENT_STYLE_SETTINGS.colors.bondColor,
      monochrome: root.getAttribute('ChemEditorMonochrome') === 'true',
      atomColorPalette: DEFAULT_DOCUMENT_STYLE_SETTINGS.colors.atomColorPalette,
      atomColors: importedAtomColors,
    },
  };
  const importedUnit = (root.getAttribute('ChemEditorPageUnit') as 'in' | 'cm' | null) ?? 'in';
  const explicitWidth = parseFloat(root.getAttribute('ChemEditorPageWidth') ?? '');
  const explicitHeight = parseFloat(root.getAttribute('ChemEditorPageHeight') ?? '');
  const importedPageSetup = inferImportedPageSetup({
    mode:
      root.getAttribute('ChemEditorPageMode') === 'finite'
        ? 'finite'
        : pageBounds
          ? 'finite'
          : 'infinite',
    unit: importedUnit,
    presetId: (root.getAttribute('ChemEditorPagePresetId') as PagePresetId | null) ?? undefined,
    orientation:
      (root.getAttribute('ChemEditorPageOrientation') as 'portrait' | 'landscape' | null) ??
      undefined,
    pageWidth: Number.isFinite(explicitWidth) ? explicitWidth : undefined,
    pageHeight: Number.isFinite(explicitHeight) ? explicitHeight : undefined,
    rows: parseInt(root.getAttribute('ChemEditorPageRows') ?? '', 10) || importedHeightPages,
    columns: parseInt(root.getAttribute('ChemEditorPageColumns') ?? '', 10) || importedWidthPages,
    pageBounds: pageBounds ?? null,
  });

  return {
    document: {
      schemaVersion: 1,
      source: 'cdxml-import',
      pages: [
        {
          id: pageEl?.getAttribute('id') ?? 'page-1',
          ...(pageBounds ? { bounds: pageBounds } : {}),
          objects,
          ...(preservedPageChildren.length ? { preservedPageChildren } : {}),
        },
      ],
      metadata: {
        bondLength: importedDocumentStyleSettings.nativeMetrics.bondLength,
        labelSize: importedDocumentStyleSettings.nativeMetrics.labelSize,
        captionSize: importedDocumentStyleSettings.nativeMetrics.captionSize,
        pageSetup: importedPageSetup,
        pageUnit: importedPageSetup.unit,
        pagePresetId: importedPageSetup.presetId,
        pageOrientation: importedPageSetup.orientation,
        widthPages: importedPageSetup.columns,
        heightPages: importedPageSetup.rows,
        documentStyleSettings: importedDocumentStyleSettings,
        ...(preservedDocumentAttributes ? { preservedDocumentAttributes } : {}),
        ...(preservedPageAttributes ? { preservedPageAttributes } : {}),
        ignoredSemantics: warnings.length ? warnings : undefined,
      },
    },
    warnings,
  };
}

export function cdxmlToState(xmlString: string): {
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  textBoxes: TextBox[];
} {
  const conversion = cdxmlToChemDrawDocument(xmlString);
  const state = chemDrawDocumentToCanvasState(conversion.document).state;
  return {
    atoms: state.atoms,
    bonds: state.bonds,
    arrows: state.arrows,
    textBoxes: state.textBoxes ?? [],
  };
}

// ─── Element tables ───────────────────────────────────────────────────────────

const ELEMENT_MAP: Record<number, string> = {
  1: 'H',
  2: 'He',
  3: 'Li',
  4: 'Be',
  5: 'B',
  6: 'C',
  7: 'N',
  8: 'O',
  9: 'F',
  10: 'Ne',
  11: 'Na',
  12: 'Mg',
  13: 'Al',
  14: 'Si',
  15: 'P',
  16: 'S',
  17: 'Cl',
  18: 'Ar',
  19: 'K',
  20: 'Ca',
  21: 'Sc',
  22: 'Ti',
  23: 'V',
  24: 'Cr',
  25: 'Mn',
  26: 'Fe',
  27: 'Co',
  28: 'Ni',
  29: 'Cu',
  30: 'Zn',
  31: 'Ga',
  32: 'Ge',
  33: 'As',
  34: 'Se',
  35: 'Br',
  36: 'Kr',
  37: 'Rb',
  38: 'Sr',
  // Fix 4: 4d transition metals
  39: 'Y',
  40: 'Zr',
  41: 'Nb',
  42: 'Mo',
  43: 'Tc',
  44: 'Ru',
  45: 'Rh',
  46: 'Pd',
  47: 'Ag',
  48: 'Cd',
  // Fix 4: In (was missing)
  49: 'In',
  50: 'Sn',
  51: 'Sb',
  52: 'Te',
  53: 'I',
  54: 'Xe',
  55: 'Cs',
  56: 'Ba',
  // Fix 4: lanthanides + 5d metals
  57: 'La',
  58: 'Ce',
  59: 'Pr',
  60: 'Nd',
  61: 'Pm',
  62: 'Sm',
  63: 'Eu',
  64: 'Gd',
  65: 'Tb',
  66: 'Dy',
  67: 'Ho',
  68: 'Er',
  69: 'Tm',
  70: 'Yb',
  71: 'Lu',
  72: 'Hf',
  73: 'Ta',
  74: 'W',
  75: 'Re',
  76: 'Os',
  77: 'Ir',
  78: 'Pt',
  79: 'Au',
  80: 'Hg',
  81: 'Tl',
  82: 'Pb',
  83: 'Bi',
  // Fix 4: heavy elements
  84: 'Po',
  85: 'At',
  86: 'Rn',
  87: 'Fr',
  88: 'Ra',
  89: 'Ac',
  90: 'Th',
  91: 'Pa',
  92: 'U',
  93: 'Np',
  94: 'Pu',
  95: 'Am',
  96: 'Cm',
  97: 'Bk',
  98: 'Cf',
  99: 'Es',
  100: 'Fm',
  101: 'Md',
  102: 'No',
  103: 'Lr',
  104: 'Rf',
  105: 'Db',
  106: 'Sg',
  107: 'Bh',
  108: 'Hs',
  109: 'Mt',
  110: 'Ds',
  111: 'Rg',
  112: 'Cn',
  113: 'Nh',
  114: 'Fl',
  115: 'Mc',
  116: 'Lv',
  117: 'Ts',
  118: 'Og',
};

const SYMBOL_TO_NUM = new Map<string, number>(
  Object.entries(ELEMENT_MAP).map(([n, s]) => [s, parseInt(n)]),
);

function getElementSymbol(num: number): string {
  return ELEMENT_MAP[num] ?? 'C';
}

function getAtomicNumber(symbol: string): number {
  return SYMBOL_TO_NUM.get(symbol) ?? 6;
}
