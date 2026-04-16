import type { AtomLabelOrientation, CanvasState, DoubleBondMode } from '../types/chemistry';
import type {
  CanvasConversionResult,
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawBondDisplay,
  ChemDrawBounds,
  ChemDrawConversionResult,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawFragment,
  ChemDrawGroup,
  ChemDrawGraphic,
  ChemDrawNode,
  ChemDrawObject,
  ChemDrawObjectTag,
  ChemDrawTable,
  ChemDrawText,
} from '../types/chemdraw';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';
import { buildAliasResolutionSnapshot, resolveAliasChemistry } from './aliasChemistry';
import { getAtomAlias, getAtomNodeText } from './atomIdentity';
import {
  convertCanvasToNative,
  convertNativeToCanvas,
  getDocumentCaptionFontSize,
} from './chemdrawMetrics';
import { getAtomElectronAnnotations } from './electronAnnotations';
import { getConnectedComponents } from './graph';
import {
  atomLabelOrientationToJustification,
  justificationToAtomLabelOrientation,
} from './atomLabels';
import { isElementSymbol } from './elements';
import { getAtomRingTemplateNativeMetadata } from './ringTemplates';
import { DEFAULT_DOUBLE_BOND_MODE, getDefaultArrowControlPoint } from './renderGeometry';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS, normalizeDocumentStyleSettings } from './settings';
import { DEFAULT_PAGE_SETUP, getPageSetupDimensionsPx, normalizePageSetup } from './settings';

type EditCapability = 'editable' | 'round-trip-only' | 'render-only';

function toCanvasBondDisplay(
  display: ChemDrawBond['display'] | undefined,
): 'dash' | 'bold' | 'wavy' | 'crossed' | 'dative' | undefined {
  if (
    display === 'dash' ||
    display === 'bold' ||
    display === 'wavy' ||
    display === 'crossed' ||
    display === 'dative'
  )
    return display;
  return undefined;
}

function cloneNodeRingTemplateMemberships(
  node: ChemDrawNode,
): NonNullable<CanvasState['atoms'][number]['ringTemplateMemberships']> | undefined {
  if (!node.ringTemplateMemberships?.length) return undefined;
  const hasNativeStereo =
    node.geometry === 'Tetrahedral' &&
    (node.atomStereo === 'r' || node.atomStereo === 's') &&
    node.bondOrdering?.length;
  const nativeStereoIndex = node.ringTemplateMemberships.findIndex(
    (membership) => membership.nativeStereo,
  );
  return node.ringTemplateMemberships.map((membership, index) => ({
    ...membership,
    ...(hasNativeStereo && (nativeStereoIndex < 0 ? index === 0 : index === nativeStereoIndex)
      ? {
          nativeStereo: {
            geometry: 'Tetrahedral',
            as: node.atomStereo as 'r' | 's',
            bondOrdering: [...(node.bondOrdering ?? [])],
          },
        }
      : membership.nativeStereo
        ? {
            nativeStereo: {
              geometry: membership.nativeStereo.geometry,
              as: membership.nativeStereo.as,
              bondOrdering: [...membership.nativeStereo.bondOrdering],
            },
          }
        : {}),
  }));
}

function cloneBondRingTemplateMemberships(
  bond: ChemDrawBond,
): NonNullable<CanvasState['bonds'][number]['ringTemplateMemberships']> | undefined {
  return bond.ringTemplateMemberships?.map((membership) => ({ ...membership })) ?? undefined;
}

function makeId(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

function getObjectEditCapability(object: ChemDrawObject): EditCapability {
  if (object.preservation?.capability) return object.preservation.capability;
  if (
    object.type === 'graphic' ||
    object.type === 'bracket' ||
    object.type === 'embedded-object' ||
    object.type === 'table' ||
    object.type === 'group'
  ) {
    return 'round-trip-only';
  }
  return 'editable';
}

function blocksSemanticEdit(object: ChemDrawObject): boolean {
  const capability = getObjectEditCapability(object);
  if (capability === 'render-only') return true;
  if (
    capability === 'round-trip-only' &&
    (object.type === 'node' || object.type === 'bond' || object.type === 'fragment')
  ) {
    return true;
  }
  if (object.type === 'node' && object.query) return true;
  if (object.type === 'bond' && (object.query || object.secondaryDisplay)) return true;
  return false;
}

function blocksStyleEdit(object: ChemDrawObject): boolean {
  return getObjectEditCapability(object) === 'render-only';
}

function blocksTransform(object: ChemDrawObject): boolean {
  return getObjectEditCapability(object) === 'render-only';
}

function blocksDelete(object: ChemDrawObject): boolean {
  return getObjectEditCapability(object) !== 'editable';
}

function clonePageObjects(document: ChemDrawDocument): ChemDrawObject[] | null {
  const page = document.pages[0];
  if (!page) return null;
  return [...page.objects];
}

function getSelectedNodeIds(
  objects: ChemDrawObject[],
  selectedObjectIds: Set<string>,
): Set<string> {
  const nodeIds = new Set<string>();
  for (const object of objects) {
    if (object.type === 'node' && selectedObjectIds.has(object.id)) nodeIds.add(object.id);
    if (object.type === 'bond' && selectedObjectIds.has(object.id)) {
      nodeIds.add(object.beginNodeId);
      nodeIds.add(object.endNodeId);
    }
  }
  return nodeIds;
}

function mapBounds(
  bounds: ChemDrawBounds,
  project: (x: number, y: number) => { x: number; y: number },
): ChemDrawBounds {
  const corners = [
    project(bounds.left, bounds.top),
    project(bounds.right, bounds.top),
    project(bounds.left, bounds.bottom),
    project(bounds.right, bounds.bottom),
  ];
  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

function mapOffset(
  point: { x: number; y: number },
  project: (x: number, y: number) => { x: number; y: number },
) {
  const origin = project(0, 0);
  const mapped = project(point.x, point.y);
  return { x: mapped.x - origin.x, y: mapped.y - origin.y };
}

function mapTextBlockBounds<T extends { bounds?: ChemDrawBounds }>(
  text: T | undefined,
  project: (x: number, y: number) => { x: number; y: number },
): T | undefined {
  if (!text?.bounds) return text;
  return {
    ...text,
    bounds: mapBounds(text.bounds, project),
  };
}

function mapObjectTags(
  objectTags: ChemDrawObjectTag[] | undefined,
  project: (x: number, y: number) => { x: number; y: number },
): ChemDrawObjectTag[] | undefined {
  return objectTags?.map((tag) => ({
    ...tag,
    ...(tag.textAnchor ? { textAnchor: project(tag.textAnchor.x, tag.textAnchor.y) } : {}),
    ...(tag.positioningOffset
      ? { positioningOffset: mapOffset(tag.positioningOffset, project) }
      : {}),
    ...(tag.text ? { text: mapTextBlockBounds(tag.text, project) } : {}),
  }));
}

function mapGraphic(
  graphic: ChemDrawGraphic,
  project: (x: number, y: number) => { x: number; y: number },
): ChemDrawGraphic {
  return {
    ...graphic,
    ...(graphic.points ? { points: graphic.points.map((point) => project(point.x, point.y)) } : {}),
    ...(graphic.bounds ? { bounds: mapBounds(graphic.bounds, project) } : {}),
    ...(graphic.objectTags ? { objectTags: mapObjectTags(graphic.objectTags, project) } : {}),
  };
}

function mapEmbeddedObject(
  embeddedObject: ChemDrawEmbeddedObject,
  project: (x: number, y: number) => { x: number; y: number },
): ChemDrawEmbeddedObject {
  return {
    ...embeddedObject,
    bounds: mapBounds(embeddedObject.bounds, project),
    ...(embeddedObject.objectTags
      ? { objectTags: mapObjectTags(embeddedObject.objectTags, project) }
      : {}),
  };
}

function mapTable(
  table: ChemDrawTable,
  project: (x: number, y: number) => { x: number; y: number },
): ChemDrawTable {
  return {
    ...table,
    bounds: mapBounds(table.bounds, project),
    cells: table.cells.map((cell) => ({
      ...cell,
      boundsInParent: mapBounds(cell.boundsInParent, project),
    })),
    ...(table.objectTags ? { objectTags: mapObjectTags(table.objectTags, project) } : {}),
  };
}

function cleanupDocument(objects: ChemDrawObject[]): ChemDrawObject[] {
  const nodeIds = new Set(
    objects
      .filter((object): object is ChemDrawNode => object.type === 'node')
      .map((node) => node.id),
  );
  const bondIds = new Set(
    objects
      .filter((object): object is ChemDrawBond => object.type === 'bond')
      .map((bond) => bond.id),
  );
  const nextObjects = objects
    .filter((object) => {
      if (object.type === 'bond')
        return nodeIds.has(object.beginNodeId) && nodeIds.has(object.endNodeId);
      return true;
    })
    .map((object) => {
      if (object.type !== 'fragment') return object;
      return {
        ...object,
        nodeIds: object.nodeIds.filter((id) => nodeIds.has(id)),
        bondIds: object.bondIds.filter((id) => bondIds.has(id)),
      };
    })
    .filter((object) => object.type !== 'fragment' || object.nodeIds.length > 0);
  return nextObjects;
}

function objectBounds(
  object: ChemDrawObject,
  objectMap: Map<string, ChemDrawObject>,
  documentStyleSettings: DocumentStyleSettings = DEFAULT_DOCUMENT_STYLE_SETTINGS,
): ChemDrawBounds | null {
  if (object.type === 'node') {
    return {
      left: object.position.x,
      top: object.position.y,
      right: object.position.x,
      bottom: object.position.y,
    };
  }
  if (object.type === 'bond') {
    const begin = objectMap.get(object.beginNodeId);
    const end = objectMap.get(object.endNodeId);
    if (begin?.type !== 'node' || end?.type !== 'node') return null;
    return {
      left: Math.min(begin.position.x, end.position.x),
      top: Math.min(begin.position.y, end.position.y),
      right: Math.max(begin.position.x, end.position.x),
      bottom: Math.max(begin.position.y, end.position.y),
    };
  }
  if (object.type === 'arrow') {
    const xs = [object.tail.x, object.head.x, object.controlPoint?.x ?? object.tail.x];
    const ys = [object.tail.y, object.head.y, object.controlPoint?.y ?? object.tail.y];
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }
  if (object.type === 'text') {
    const fontSize =
      object.style?.fontSize != null
        ? convertNativeToCanvas(object.style.fontSize, documentStyleSettings)
        : 14;
    const width =
      object.text.width ??
      Math.max(
        object.text.runs.reduce((sum, run) => sum + run.text.length, 0) * fontSize * 0.6,
        fontSize,
      );
    const height = fontSize;
    return {
      left: object.anchor.x - width / 2,
      top: object.anchor.y - height / 2,
      right: object.anchor.x + width / 2,
      bottom: object.anchor.y + height / 2,
    };
  }
  if (object.type === 'bracket') return object.bounds;
  if (object.type === 'graphic') {
    if (object.bounds) return object.bounds;
    if (object.points?.length) {
      return {
        left: Math.min(...object.points.map((point) => point.x)),
        top: Math.min(...object.points.map((point) => point.y)),
        right: Math.max(...object.points.map((point) => point.x)),
        bottom: Math.max(...object.points.map((point) => point.y)),
      };
    }
    return null;
  }
  if (object.type === 'embedded-object') return object.bounds;
  if (object.type === 'table') return object.bounds;
  if (object.type === 'group') {
    const childBounds = object.childIds
      .map((id) => objectMap.get(id))
      .filter((child): child is ChemDrawObject => Boolean(child))
      .map((child) => objectBounds(child, objectMap, documentStyleSettings))
      .filter((bounds): bounds is ChemDrawBounds => Boolean(bounds));
    if (!childBounds.length) return null;
    return {
      left: Math.min(...childBounds.map((bounds) => bounds.left)),
      top: Math.min(...childBounds.map((bounds) => bounds.top)),
      right: Math.max(...childBounds.map((bounds) => bounds.right)),
      bottom: Math.max(...childBounds.map((bounds) => bounds.bottom)),
    };
  }
  return null;
}

function commitObjects(document: ChemDrawDocument, objects: ChemDrawObject[]): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  return {
    ...document,
    pages: [
      {
        ...page,
        objects,
      },
    ],
  };
}

function stereoToDisplay(stereo: number | undefined): ChemDrawBondDisplay | undefined {
  if (stereo === 1) return 'wedge-begin';
  if (stereo === 6) return 'hash-begin';
  return undefined;
}

function isLikelyElementToken(value: string): boolean {
  return isElementSymbol(value) || value === 'D';
}

export function queryNodeLabel(node: ChemDrawNode): string | undefined {
  const query = node.query;
  if (!query) return node.alias;
  if (query.type === 'any') return query.label ?? 'A';
  if (query.type === 'list') return query.label ?? (query.elements?.join(',') || 'List');
  if (query.type === 'not-list') {
    const list = query.elements?.join(',') || query.label || 'List';
    return `NOT ${list}`;
  }
  if (query.type === 'r-group') return query.rGroupName ?? query.label ?? 'R';
  if (query.type === 'alias') return query.label ?? query.genericName ?? node.alias;
  if (query.type === 'variable-attachment') {
    const low = query.linkCountLow ?? '?';
    const high = query.linkCountHigh ?? '?';
    return query.label ?? `Link ${low}-${high}`;
  }
  return node.alias;
}

function projectEllipsePointToControlPoint(
  arrow: ChemDrawArrow,
): { x: number; y: number } | undefined {
  if (!arrow.arcCenter || !arrow.majorAxisEnd || !arrow.minorAxisEnd) return undefined;
  const ux = arrow.majorAxisEnd.x - arrow.arcCenter.x;
  const uy = arrow.majorAxisEnd.y - arrow.arcCenter.y;
  const vx = arrow.minorAxisEnd.x - arrow.arcCenter.x;
  const vy = arrow.minorAxisEnd.y - arrow.arcCenter.y;
  const uLen2 = ux * ux + uy * uy;
  const vLen2 = vx * vx + vy * vy;
  if (uLen2 <= 0 || vLen2 <= 0) return undefined;

  const tx = arrow.tail.x - arrow.arcCenter.x;
  const ty = arrow.tail.y - arrow.arcCenter.y;
  const tailAngle = Math.atan2((tx * vx + ty * vy) / vLen2, (tx * ux + ty * uy) / uLen2);
  const sweepRadians =
    arrow.angularSize != null && Number.isFinite(arrow.angularSize)
      ? (arrow.angularSize * Math.PI) / 180
      : (() => {
          const hx = arrow.head.x - arrow.arcCenter!.x;
          const hy = arrow.head.y - arrow.arcCenter!.y;
          const headAngle = Math.atan2((hx * vx + hy * vy) / vLen2, (hx * ux + hy * uy) / uLen2);
          let delta = headAngle - tailAngle;
          while (delta <= -Math.PI) delta += Math.PI * 2;
          while (delta > Math.PI) delta -= Math.PI * 2;
          return delta;
        })();
  const midAngle = tailAngle + sweepRadians / 2;
  const midX = arrow.arcCenter.x + Math.cos(midAngle) * ux + Math.sin(midAngle) * vx;
  const midY = arrow.arcCenter.y + Math.cos(midAngle) * uy + Math.sin(midAngle) * vy;
  return {
    x: midX * 2 - (arrow.tail.x + arrow.head.x) / 2,
    y: midY * 2 - (arrow.tail.y + arrow.head.y) / 2,
  };
}

export function canvasStateToChemDrawDocument(
  state: CanvasState,
  options?: {
    documentStyleSettings?: Partial<DocumentStyleSettings> | DocumentStyleSettings;
    pageSetup?: PageSetup;
  },
): ChemDrawConversionResult {
  const warnings: string[] = [];
  const objects: ChemDrawObject[] = [];
  const documentStyleSettings = options?.documentStyleSettings
    ? normalizeDocumentStyleSettings(options.documentStyleSettings)
    : DEFAULT_DOCUMENT_STYLE_SETTINGS;

  for (const atom of state.atoms) {
    const electronAnnotations = getAtomElectronAnnotations(atom);
    const ringTemplateMetadata = getAtomRingTemplateNativeMetadata(atom);
    const hasStyledLabel = Boolean(
      getAtomAlias(atom) ||
      atom.labelFontFamily ||
      atom.labelFontSize != null ||
      atom.labelColor ||
      atom.labelRuns?.length ||
      atom.labelOrientation,
    );
    const node: ChemDrawNode = {
      id: atom.id,
      type: 'node',
      position: { x: atom.x, y: atom.y },
      geometry: ringTemplateMetadata.geometry,
      atomStereo: ringTemplateMetadata.atomStereo,
      bondOrdering: ringTemplateMetadata.bondOrdering,
      ringTemplateMemberships:
        atom.ringTemplateMemberships?.map((membership) => ({
          ...membership,
          ...(membership.nativeStereo
            ? {
                nativeStereo: {
                  geometry: membership.nativeStereo.geometry,
                  as: membership.nativeStereo.as,
                  bondOrdering: [...membership.nativeStereo.bondOrdering],
                },
              }
            : {}),
        })) ?? undefined,
      ...(atom.element ? { element: atom.element } : {}),
      ...(atom.charge != null ? { charge: atom.charge } : {}),
      ...(electronAnnotations.lonePairs > 0
        ? { lonePairCount: electronAnnotations.lonePairs }
        : {}),
      ...(electronAnnotations.radicalElectrons > 0
        ? { radicalElectrons: electronAnnotations.radicalElectrons }
        : {}),
      ...(atom.electronAngles?.length ? { electronAngles: atom.electronAngles } : {}),
      ...(atom.isotope != null ? { isotope: atom.isotope } : {}),
      ...(getAtomAlias(atom) ? { alias: getAtomAlias(atom) } : {}),
      ...(hasStyledLabel
        ? {
            text: {
              runs: atom.labelRuns?.length ? atom.labelRuns : [{ text: getAtomNodeText(atom) }],
              justification: atomLabelOrientationToJustification(atom.labelOrientation) ?? 'center',
            },
          }
        : {}),
      ...(atom.labelOrientation ? { labelOrientation: atom.labelOrientation } : {}),
      ...(atom.aliasResolution ? { aliasResolution: atom.aliasResolution } : {}),
      ...(atom.labelFontFamily || atom.labelFontSize != null || atom.labelColor
        ? {
            style: {
              ...(atom.labelFontFamily ? { fontFamily: atom.labelFontFamily } : {}),
              ...(atom.labelFontSize != null
                ? { fontSize: convertCanvasToNative(atom.labelFontSize, documentStyleSettings) }
                : {}),
              ...(atom.labelColor ? { color: atom.labelColor } : {}),
            },
          }
        : {}),
    };
    objects.push(node);
  }

  for (const bond of state.bonds) {
    const entry: ChemDrawBond = {
      id: bond.id,
      type: 'bond',
      beginNodeId: bond.from,
      endNodeId: bond.to,
      ringTemplateMemberships:
        bond.ringTemplateMemberships?.map((membership) => ({ ...membership })) ?? undefined,
      ...(bond.order != null ? { order: bond.order } : {}),
      doubleBondMode: bond.order === 2 ? bond.doubleBondMode : undefined,
      ...(bond.order === 1.5 ? { aromatic: true } : {}),
      ...(bond.displayStyle && bond.displayStyle !== 'solid'
        ? { display: bond.displayStyle }
        : bond.stereo === 1
          ? { display: 'wedge-begin' }
          : bond.stereo === 6
            ? { display: 'hash-begin' }
            : {}),
      ...(bond.color || bond.lineWidth != null
        ? {
            style: {
              ...(bond.color ? { color: bond.color } : {}),
              ...(bond.lineWidth != null
                ? { lineWidth: convertCanvasToNative(bond.lineWidth, documentStyleSettings) }
                : {}),
            },
          }
        : {}),
    };
    objects.push(entry);
  }

  const components = getConnectedComponents(state.atoms, state.bonds);
  components.forEach((component, index) => {
    const nodeIds = Array.from(component);
    const bondIds = state.bonds
      .filter((bond) => component.has(bond.from) && component.has(bond.to))
      .map((bond) => bond.id);
    const fragment: ChemDrawFragment = {
      id: makeId('fragment', index + 1),
      type: 'fragment',
      nodeIds,
      bondIds,
    };
    objects.push(fragment);
  });

  state.arrows.forEach((arrow) => {
    const entry: ChemDrawArrow = {
      id: arrow.id,
      type: 'arrow',
      arrowType: arrow.type,
      tail: { x: arrow.x1, y: arrow.y1 },
      head: { x: arrow.x2, y: arrow.y2 },
      controlPoint: { x: arrow.cpx, y: arrow.cpy },
      ...(arrow.curveEnabled ? { curveEnabled: true } : {}),
      ...(arrow.labelAbove || arrow.label
        ? {
            textAbove: {
              runs: [{ text: arrow.labelAbove ?? arrow.label ?? '' }],
              justification: 'center',
            },
          }
        : {}),
      ...(arrow.labelBelow
        ? {
            textBelow: {
              runs: [{ text: arrow.labelBelow }],
              justification: 'center',
            },
          }
        : {}),
      style: {
        ...(arrow.labelFontSize != null
          ? { fontSize: convertCanvasToNative(arrow.labelFontSize, documentStyleSettings) }
          : {}),
        ...(arrow.labelColor ? { color: arrow.labelColor } : {}),
        ...(arrow.strokeColor ? { strokeColor: arrow.strokeColor } : {}),
        ...(arrow.lineWidth != null
          ? { lineWidth: convertCanvasToNative(arrow.lineWidth, documentStyleSettings) }
          : {}),
        ...(arrow.lineStyle ? { lineType: arrow.lineStyle } : {}),
      },
    };
    objects.push(entry);
  });

  state.textBoxes?.forEach((textBox) => {
    const entry: ChemDrawText = {
      id: textBox.id,
      type: 'text',
      anchor: { x: textBox.x, y: textBox.y },
      text: {
        runs: textBox.runs,
        justification: textBox.textAlign ?? 'center',
        ...(textBox.width != null ? { width: textBox.width } : {}),
      },
      style: {
        color: textBox.color,
        fontFamily: textBox.fontFamily,
        fontSize: convertCanvasToNative(textBox.fontSize, documentStyleSettings),
        ...(textBox.rotation != null ? { rotation: textBox.rotation } : {}),
      },
      ...(textBox.semanticMode ? { semanticMode: textBox.semanticMode } : {}),
      ...(textBox.conversionStatus ? { conversionStatus: textBox.conversionStatus } : {}),
      ...(textBox.chemicalMetadata ? { chemicalMetadata: textBox.chemicalMetadata } : {}),
    };
    objects.push(entry);
  });

  if ((state.groups?.length ?? 0) > 0) {
    warnings.push('Editor groups are not yet mapped into the ChemDraw document model.');
  }

  const pageSetup = normalizePageSetup(options?.pageSetup ?? DEFAULT_PAGE_SETUP);
  const pageBounds =
    pageSetup.mode === 'finite'
      ? (() => {
          const dimensions = getPageSetupDimensionsPx(pageSetup);
          return {
            left: 0,
            top: 0,
            right: dimensions.totalWidthPx,
            bottom: dimensions.totalHeightPx,
          };
        })()
      : undefined;

  return {
    document: {
      schemaVersion: 1,
      source: 'canvas-state',
      pages: [{ id: 'page-1', ...(pageBounds ? { bounds: pageBounds } : {}), objects }],
      metadata: {
        bondLength: documentStyleSettings.nativeMetrics.bondLength,
        labelSize: documentStyleSettings.nativeMetrics.labelSize,
        captionSize: documentStyleSettings.nativeMetrics.captionSize,
        documentStyleSettings,
        pageSetup,
        pageUnit: pageSetup.unit,
        pagePresetId: pageSetup.presetId,
        pageOrientation: pageSetup.orientation,
        widthPages: pageSetup.columns,
        heightPages: pageSetup.rows,
        ignoredSemantics: warnings.length ? warnings : undefined,
      },
    },
    warnings,
  };
}

export function chemDrawDocumentToCanvasState(document: ChemDrawDocument): CanvasConversionResult {
  const warnings: string[] = [];
  const page = document.pages[0];
  const documentStyleSettings =
    document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;
  if (!page) {
    return { state: { atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] }, warnings };
  }

  const atoms = page.objects
    .filter((object): object is ChemDrawNode => object.type === 'node')
    .map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      kind: queryNodeLabel(node) ? ('alias' as const) : ('element' as const),
      ...(queryNodeLabel(node) ? { alias: queryNodeLabel(node) } : {}),
      element: node.element ?? 'C',
      ...(node.charge != null ? { charge: node.charge } : {}),
      ...(node.lonePairCount != null ? { lonePairs: node.lonePairCount } : {}),
      ...(node.radicalElectrons != null ? { radicalElectrons: node.radicalElectrons } : {}),
      ...(node.electronAngles?.length ? { electronAngles: node.electronAngles } : {}),
      ...(node.isotope != null ? { isotope: node.isotope } : {}),
      ...(node.style?.fontFamily ? { labelFontFamily: node.style.fontFamily } : {}),
      ...(node.style?.fontSize != null
        ? { labelFontSize: convertNativeToCanvas(node.style.fontSize, documentStyleSettings) }
        : {}),
      ...(node.style?.color ? { labelColor: node.style.color } : {}),
      ...(node.text?.runs?.length ? { labelRuns: node.text.runs } : {}),
      ...((node.labelOrientation ?? justificationToAtomLabelOrientation(node.text?.justification))
        ? {
            labelOrientation: (node.labelOrientation ??
              justificationToAtomLabelOrientation(
                node.text?.justification,
              )) as AtomLabelOrientation,
          }
        : {}),
      ...(node.aliasResolution ? { aliasResolution: node.aliasResolution } : {}),
      ...(cloneNodeRingTemplateMemberships(node)
        ? { ringTemplateMemberships: cloneNodeRingTemplateMemberships(node) }
        : {}),
    }));

  const bonds = page.objects
    .filter((object): object is ChemDrawBond => object.type === 'bond')
    .map((bond) => {
      // wedge-end / hash-end: the wide end is at the BEGIN atom, narrow at END.
      // Our renderer always draws wedge/hash narrow-at-from → wide-at-to, so we
      // flip the atom order and use the corresponding *-begin stereo code.
      const flipDir = bond.display === 'wedge-end' || bond.display === 'hash-end';
      return {
        id: bond.id,
        from: flipDir ? bond.endNodeId : bond.beginNodeId,
        to: flipDir ? bond.beginNodeId : bond.endNodeId,
        order: bond.aromatic && bond.order == null ? 1.5 : (bond.order ?? 1),
        ...(bond.display === 'wedge-begin' || bond.display === 'wedge-end' ? { stereo: 1 } : {}),
        ...(bond.display === 'hash-begin' || bond.display === 'hash-end' ? { stereo: 6 } : {}),
        ...(bond.style?.color ? { color: bond.style.color } : {}),
        ...(bond.style?.lineWidth != null
          ? { lineWidth: convertNativeToCanvas(bond.style.lineWidth, documentStyleSettings) }
          : {}),
        ...(toCanvasBondDisplay(bond.display)
          ? { displayStyle: toCanvasBondDisplay(bond.display) }
          : {}),
        ...(bond.order === 2 && bond.doubleBondMode ? { doubleBondMode: bond.doubleBondMode } : {}),
        ...(cloneBondRingTemplateMemberships(bond)
          ? { ringTemplateMemberships: cloneBondRingTemplateMemberships(bond) }
          : {}),
      };
    });

  const arrows = page.objects
    .filter((object): object is ChemDrawArrow => object.type === 'arrow')
    .map((arrow) => {
      const controlPoint = arrow.controlPoint ??
        projectEllipsePointToControlPoint(arrow) ?? {
          x: (arrow.tail.x + arrow.head.x) / 2,
          y: (arrow.tail.y + arrow.head.y) / 2,
        };
      return {
        id: arrow.id,
        type: arrow.arrowType,
        x1: arrow.tail.x,
        y1: arrow.tail.y,
        x2: arrow.head.x,
        y2: arrow.head.y,
        cpx: controlPoint.x,
        cpy: controlPoint.y,
        ...(arrow.curveEnabled ? { curveEnabled: true } : {}),
        ...(arrow.textAbove
          ? {
              labelAbove: arrow.textAbove.runs.map((run) => run.text).join(''),
              label: arrow.textAbove.runs.map((run) => run.text).join(''),
            }
          : {}),
        ...(arrow.textBelow
          ? { labelBelow: arrow.textBelow.runs.map((run) => run.text).join('') }
          : {}),
        ...(arrow.style?.fontSize != null
          ? { labelFontSize: convertNativeToCanvas(arrow.style.fontSize, documentStyleSettings) }
          : {}),
        ...(arrow.style?.color ? { labelColor: arrow.style.color } : {}),
        ...(arrow.style?.strokeColor ? { strokeColor: arrow.style.strokeColor } : {}),
        ...(arrow.style?.lineWidth != null
          ? { lineWidth: convertNativeToCanvas(arrow.style.lineWidth, documentStyleSettings) }
          : {}),
        ...(arrow.style?.lineType ? { lineStyle: arrow.style.lineType } : {}),
      };
    });

  const textBoxes = page.objects
    .filter((object): object is ChemDrawText => object.type === 'text')
    .map((text) => ({
      id: text.id,
      x: text.anchor.x,
      y: text.anchor.y,
      runs: text.text.runs,
      fontSize:
        text.style?.fontSize != null
          ? convertNativeToCanvas(text.style.fontSize, documentStyleSettings)
          : getDocumentCaptionFontSize(documentStyleSettings),
      fontFamily: text.style?.fontFamily ?? documentStyleSettings.nativeMetrics.captionFontFamily,
      color: text.style?.color ?? '#000000',
      textAlign: text.text.justification ?? 'center',
      ...(text.text.width != null ? { width: text.text.width } : {}),
      ...(text.style?.rotation != null ? { rotation: text.style.rotation } : {}),
      ...(text.semanticMode ? { semanticMode: text.semanticMode } : {}),
      ...(text.conversionStatus ? { conversionStatus: text.conversionStatus } : {}),
      ...(text.chemicalMetadata ? { chemicalMetadata: text.chemicalMetadata } : {}),
    }));

  const queryNodes = page.objects.filter(
    (object): object is ChemDrawNode => object.type === 'node' && object.query != null,
  );
  if (queryNodes.length > 0) {
    warnings.push(
      `${queryNodes.length} query node(s) were projected into canvas labels for display only.`,
    );
  }
  const queryBonds = page.objects.filter(
    (object): object is ChemDrawBond => object.type === 'bond' && object.query != null,
  );
  if (queryBonds.length > 0) {
    warnings.push(
      `${queryBonds.length} query bond(s) were projected into approximate canvas bonds only.`,
    );
  }
  const embeddedObjects = page.objects.filter(
    (object): object is ChemDrawEmbeddedObject => object.type === 'embedded-object',
  );
  if (embeddedObjects.length > 0) {
    warnings.push(
      `${embeddedObjects.length} embedded object(s) remain native-only and render directly from the ChemDraw document.`,
    );
  }
  const tables = page.objects.filter((object): object is ChemDrawTable => object.type === 'table');
  if (tables.length > 0) {
    warnings.push(
      `${tables.length} table object(s) remain native-only and render directly from the ChemDraw document.`,
    );
  }
  return {
    state: {
      atoms,
      bonds,
      arrows,
      groups: [],
      textBoxes,
    },
    warnings,
  };
}

export function mergeCanvasStateIntoChemDrawDocument(
  document: ChemDrawDocument,
  state: CanvasState,
): ChemDrawConversionResult {
  const basePage = document.pages[0];
  const fromCanvas = canvasStateToChemDrawDocument(state, {
    documentStyleSettings:
      document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: document.metadata?.pageSetup ?? DEFAULT_PAGE_SETUP,
  }).document;
  const canvasPage = fromCanvas.pages[0] ?? { id: 'page-1', objects: [] };
  if (!basePage) return { document: fromCanvas, warnings: [] };

  const baseById = new Map(basePage.objects.map((object) => [object.id, object]));
  const mergedObjects: ChemDrawObject[] = [];

  for (const object of canvasPage.objects) {
    const base = baseById.get(object.id);
    if (object.type === 'node' && base?.type === 'node') {
      mergedObjects.push({
        ...base,
        ...object,
        query: base.query ?? object.query,
        text: object.text ?? base.text,
        labelOrientation: object.labelOrientation ?? base.labelOrientation,
        geometry: object.geometry,
        atomStereo: object.atomStereo,
        bondOrdering: object.bondOrdering,
        ringTemplateMemberships: object.ringTemplateMemberships,
        style: { ...base.style, ...object.style },
      });
    } else if (object.type === 'bond' && base?.type === 'bond') {
      mergedObjects.push({
        ...base,
        ...object,
        query: base.query ?? object.query,
        display: object.display ?? base.display,
        secondaryDisplay: object.secondaryDisplay ?? base.secondaryDisplay,
        doubleBondMode: object.order === 2 ? object.doubleBondMode : undefined,
        ringTemplateMemberships: object.ringTemplateMemberships,
        style: { ...base.style, ...object.style },
      });
    } else if (object.type === 'arrow' && base?.type === 'arrow') {
      mergedObjects.push({
        ...base,
        ...object,
        textAbove: object.textAbove ?? base.textAbove,
        textBelow: object.textBelow ?? base.textBelow,
        style: { ...base.style, ...object.style },
      });
    } else if (object.type === 'text' && base?.type === 'text') {
      mergedObjects.push({
        ...base,
        ...object,
        text: { ...base.text, ...object.text },
        style: { ...base.style, ...object.style },
        semanticMode: object.semanticMode ?? base.semanticMode,
        conversionStatus: object.conversionStatus ?? base.conversionStatus,
      });
    } else if (object.type === 'fragment' && base?.type === 'fragment') {
      mergedObjects.push({
        ...base,
        ...object,
        role: base.role ?? object.role,
        style: { ...base.style, ...object.style },
      });
    } else {
      mergedObjects.push(object);
    }
  }

  for (const object of basePage.objects) {
    if (mergedObjects.some((existing) => existing.id === object.id)) continue;
    if (
      object.type === 'bracket' ||
      object.type === 'graphic' ||
      object.type === 'embedded-object' ||
      object.type === 'table' ||
      object.type === 'group'
    ) {
      mergedObjects.push(object);
    }
  }

  return {
    document: {
      ...document,
      pages: [
        {
          ...basePage,
          ...canvasPage,
          objects: mergedObjects,
        },
      ],
    },
    warnings: [],
  };
}

export function applyNodeValueEdit(
  document: ChemDrawDocument,
  nodeId: string,
  value: string,
  aliasResolution?: ChemDrawNode['aliasResolution'],
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentNode = objects.find(
    (object): object is ChemDrawNode => object.type === 'node' && object.id === nodeId,
  );
  if (!currentNode || blocksSemanticEdit(currentNode)) return document;
  const trimmed = value.trim() || 'C';
  const resolvedAlias =
    aliasResolution ??
    (isElementSymbol(trimmed)
      ? undefined
      : buildAliasResolutionSnapshot(resolveAliasChemistry(trimmed)));
  const nextObjects = objects.map((object) => {
    if (object.type !== 'node' || object.id !== nodeId) return object;
    const next: ChemDrawNode = { ...object };
    if (next.query) {
      const nextQuery = { ...next.query };
      if (nextQuery.type === 'r-group') nextQuery.rGroupName = trimmed;
      nextQuery.label = trimmed;
      next.query = nextQuery;
      next.alias = trimmed;
      next.aliasResolution = resolvedAlias;
      next.text = { ...(next.text ?? { runs: [] }), runs: [{ text: trimmed }] };
      return next;
    }
    if (isLikelyElementToken(trimmed)) {
      next.element = trimmed;
      next.text = undefined;
      delete next.alias;
      delete next.aliasResolution;
      return next;
    }
    next.alias = trimmed;
    next.aliasResolution = resolvedAlias;
    next.text = { ...(next.text ?? { runs: [] }), runs: [{ text: trimmed }] };
    return next;
  });
  return commitObjects(document, nextObjects);
}

export function applyNodeLabelStyleEdit(
  document: ChemDrawDocument,
  nodeId: string,
  edits: {
    value?: string;
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    labelOrientation?: AtomLabelOrientation;
    aliasResolution?: ChemDrawNode['aliasResolution'];
  },
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentNode = objects.find(
    (object): object is ChemDrawNode => object.type === 'node' && object.id === nodeId,
  );
  if (!currentNode || blocksSemanticEdit(currentNode)) return document;

  const nextObjects = objects.map((object) => {
    if (object.type !== 'node' || object.id !== nodeId) return object;

    const next: ChemDrawNode = { ...object };
    const trimmed = edits.value?.trim();
    const nextValue =
      trimmed && trimmed.length > 0
        ? trimmed
        : (queryNodeLabel(next) ?? next.alias ?? next.element ?? 'C');
    const nextAliasResolution =
      edits.aliasResolution ??
      (edits.value !== undefined && !isLikelyElementToken(nextValue)
        ? buildAliasResolutionSnapshot(resolveAliasChemistry(nextValue))
        : next.aliasResolution);

    if (next.query) {
      const nextQuery = { ...next.query };
      if (nextQuery.type === 'r-group') nextQuery.rGroupName = nextValue;
      nextQuery.label = nextValue;
      next.query = nextQuery;
    }

    if (isLikelyElementToken(nextValue) && !next.query) {
      next.element = nextValue;
      delete next.alias;
      delete next.aliasResolution;
    } else {
      next.alias = nextValue;
      next.aliasResolution = nextAliasResolution;
    }

    next.text = {
      runs: [{ text: nextValue }],
      justification:
        atomLabelOrientationToJustification(edits.labelOrientation ?? next.labelOrientation) ??
        'center',
    };
    next.labelOrientation = edits.labelOrientation ?? next.labelOrientation;
    next.style = {
      ...next.style,
      ...(edits.fontFamily ? { fontFamily: edits.fontFamily } : {}),
      ...(edits.fontSize != null ? { fontSize: edits.fontSize } : {}),
      ...(edits.color ? { color: edits.color } : {}),
    };
    return next;
  });

  return commitObjects(document, nextObjects);
}

export function reverseBondDirection(document: ChemDrawDocument, bondId: string): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentBond = objects.find(
    (object): object is ChemDrawBond => object.type === 'bond' && object.id === bondId,
  );
  if (!currentBond || blocksSemanticEdit(currentBond)) return document;
  const nextObjects = objects.map((object) => {
    if (object.type !== 'bond' || object.id !== bondId) return object;
    return {
      ...object,
      beginNodeId: object.endNodeId,
      endNodeId: object.beginNodeId,
    } satisfies ChemDrawBond;
  });
  return commitObjects(document, nextObjects);
}

export function applyBondEdit(
  document: ChemDrawDocument,
  bondId: string,
  options: { order?: number; stereo?: number; doubleBondMode?: DoubleBondMode },
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentBond = objects.find(
    (object): object is ChemDrawBond => object.type === 'bond' && object.id === bondId,
  );
  if (!currentBond || blocksSemanticEdit(currentBond)) return document;
  const nextObjects = objects.map((object) => {
    if (object.type !== 'bond' || object.id !== bondId) return object;
    const next: ChemDrawBond = { ...object };
    const display = stereoToDisplay(options.stereo);
    if (display) {
      next.order = 1;
      next.display = display;
      delete next.doubleBondMode;
      delete next.secondaryDisplay;
      delete next.query;
      delete next.aromatic;
      return next;
    }
    if (options.order != null) {
      next.order = options.order;
      next.aromatic = options.order === 1.5 ? true : undefined;
      if (options.order === 2)
        next.doubleBondMode = options.doubleBondMode ?? DEFAULT_DOUBLE_BOND_MODE;
      else delete next.doubleBondMode;
      delete next.display;
      delete next.secondaryDisplay;
      delete next.query;
    } else if (options.doubleBondMode != null && next.order === 2) {
      next.doubleBondMode = options.doubleBondMode;
    }
    return next;
  });
  return commitObjects(document, nextObjects);
}

export function applyBondStyleEdit(
  document: ChemDrawDocument,
  bondId: string,
  options: {
    color?: string;
    lineWidth?: number;
    display?: 'solid' | 'dash' | 'bold' | 'wavy' | 'crossed' | 'dative';
    doubleBondMode?: DoubleBondMode;
  },
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentBond = objects.find(
    (object): object is ChemDrawBond => object.type === 'bond' && object.id === bondId,
  );
  if (!currentBond || blocksStyleEdit(currentBond)) return document;
  const documentStyleSettings =
    document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;
  const nextObjects = objects.map((object) => {
    if (object.type !== 'bond' || object.id !== bondId) return object;
    const next: ChemDrawBond = { ...object };
    next.style = {
      ...next.style,
      ...(options.color ? { color: options.color } : {}),
      ...(options.lineWidth != null
        ? { lineWidth: convertCanvasToNative(options.lineWidth, documentStyleSettings) }
        : {}),
    };
    if (options.display && options.display !== 'solid') next.display = options.display;
    else if (options.display === 'solid') delete next.display;
    if (next.order === 2 && options.doubleBondMode != null)
      next.doubleBondMode = options.doubleBondMode;
    else if (next.order !== 2) delete next.doubleBondMode;
    return next;
  });
  return commitObjects(document, nextObjects);
}

export function applyArrowStyleEdit(
  document: ChemDrawDocument,
  arrowId: string,
  options: {
    color?: string;
    lineWidth?: number;
    lineStyle?: 'solid' | 'dashed' | 'bold';
    curveEnabled?: boolean;
  },
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentArrow = objects.find(
    (object): object is ChemDrawArrow => object.type === 'arrow' && object.id === arrowId,
  );
  if (!currentArrow || blocksStyleEdit(currentArrow)) return document;
  const documentStyleSettings =
    document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;
  const nextObjects = objects.map((object) => {
    if (object.type !== 'arrow' || object.id !== arrowId) return object;
    const next: ChemDrawArrow = { ...object };
    next.style = {
      ...next.style,
      ...(options.color ? { strokeColor: options.color } : {}),
      ...(options.lineWidth != null
        ? { lineWidth: convertCanvasToNative(options.lineWidth, documentStyleSettings) }
        : {}),
      ...(options.lineStyle && options.lineStyle !== 'solid'
        ? { lineType: options.lineStyle }
        : {}),
    };
    if (options.lineStyle === 'solid' && next.style) delete next.style.lineType;
    if (options.curveEnabled != null) {
      if (next.arrowType === 'curved' || next.arrowType === 'half-curved') {
        next.curveEnabled = true;
      } else if (options.curveEnabled) {
        next.curveEnabled = true;
        const midX = (next.tail.x + next.head.x) / 2;
        const midY = (next.tail.y + next.head.y) / 2;
        const hasCustomControlPoint =
          next.controlPoint &&
          Math.hypot(next.controlPoint.x - midX, next.controlPoint.y - midY) > 1;
        if (!hasCustomControlPoint) {
          const defaultControlPoint = getDefaultArrowControlPoint(
            next.tail.x,
            next.tail.y,
            next.head.x,
            next.head.y,
          );
          next.controlPoint = { x: defaultControlPoint.cpx, y: defaultControlPoint.cpy };
        }
      } else {
        delete next.curveEnabled;
      }
    }
    return next;
  });
  return commitObjects(document, nextObjects);
}

export function reorderBondObjects(
  document: ChemDrawDocument,
  bondId: string,
  direction: 'front' | 'back',
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects) return document;
  const currentBond = objects.find(
    (object): object is ChemDrawBond => object.type === 'bond' && object.id === bondId,
  );
  if (!currentBond || blocksStyleEdit(currentBond)) return document;

  const bondIndices = objects
    .map((object, index) => (object.type === 'bond' ? index : -1))
    .filter((index) => index >= 0);
  if (bondIndices.length < 2) return document;

  const currentIndex = objects.findIndex(
    (object) => object.type === 'bond' && object.id === bondId,
  );
  if (currentIndex < 0) return document;

  const targetIndex = direction === 'front' ? bondIndices[bondIndices.length - 1] : bondIndices[0];
  if (currentIndex === targetIndex) return document;

  const [bond] = objects.splice(currentIndex, 1);
  objects.splice(targetIndex, 0, bond);
  return commitObjects(document, objects);
}

export function moveSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
  dx: number,
  dy: number,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size === 0) return document;
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  const selectedNodeIds = getSelectedNodeIds(objects, selectedObjectIds);
  const nextObjects = objects.map((object) => {
    if (object.type === 'node' && selectedNodeIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return { ...object, position: { x: object.position.x + dx, y: object.position.y + dy } };
    }
    if (object.type === 'arrow' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        tail: { x: object.tail.x + dx, y: object.tail.y + dy },
        head: { x: object.head.x + dx, y: object.head.y + dy },
        ...(object.controlPoint
          ? { controlPoint: { x: object.controlPoint.x + dx, y: object.controlPoint.y + dy } }
          : {}),
      };
    }
    if (object.type === 'text' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        anchor: { x: object.anchor.x + dx, y: object.anchor.y + dy },
        ...(object.objectTags
          ? { objectTags: mapObjectTags(object.objectTags, (x, y) => ({ x: x + dx, y: y + dy })) }
          : {}),
      };
    }
    if (object.type === 'bracket' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        bounds: {
          left: object.bounds.left + dx,
          top: object.bounds.top + dy,
          right: object.bounds.right + dx,
          bottom: object.bounds.bottom + dy,
        },
        ...(object.objectTags
          ? { objectTags: mapObjectTags(object.objectTags, (x, y) => ({ x: x + dx, y: y + dy })) }
          : {}),
      };
    }
    if (object.type === 'graphic' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapGraphic(object, (x, y) => ({ x: x + dx, y: y + dy }));
    }
    if (object.type === 'embedded-object' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapEmbeddedObject(object, (x, y) => ({ x: x + dx, y: y + dy }));
    }
    if (object.type === 'table' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapTable(object, (x, y) => ({ x: x + dx, y: y + dy }));
    }
    if (object.type === 'group' && selectedObjectIds.has(object.id)) {
      const groupObject = objectMap.get(object.id);
      if (groupObject && blocksTransform(groupObject)) return object;
    }
    return object;
  });
  return commitObjects(document, nextObjects);
}

export function rotateSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
  center: { x: number; y: number },
  radians: number,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size === 0) return document;
  const selectedNodeIds = getSelectedNodeIds(objects, selectedObjectIds);
  const rotate = (x: number, y: number) => ({
    x: center.x + (x - center.x) * Math.cos(radians) - (y - center.y) * Math.sin(radians),
    y: center.y + (x - center.x) * Math.sin(radians) + (y - center.y) * Math.cos(radians),
  });
  const nextObjects = objects.map((object) => {
    if (object.type === 'node' && selectedNodeIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return { ...object, position: rotate(object.position.x, object.position.y) };
    }
    if (object.type === 'arrow' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        tail: rotate(object.tail.x, object.tail.y),
        head: rotate(object.head.x, object.head.y),
        ...(object.controlPoint
          ? { controlPoint: rotate(object.controlPoint.x, object.controlPoint.y) }
          : {}),
      };
    }
    if (object.type === 'text' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        anchor: rotate(object.anchor.x, object.anchor.y),
        style: {
          ...object.style,
          rotation: ((object.style?.rotation ?? 0) + (radians * 180) / Math.PI + 360) % 360,
        },
        ...(object.objectTags ? { objectTags: mapObjectTags(object.objectTags, rotate) } : {}),
      };
    }
    if (object.type === 'bracket' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        bounds: mapBounds(object.bounds, rotate),
        ...(object.objectTags ? { objectTags: mapObjectTags(object.objectTags, rotate) } : {}),
      };
    }
    if (object.type === 'graphic' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapGraphic(object, rotate);
    }
    if (object.type === 'embedded-object' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapEmbeddedObject(object, rotate);
    }
    if (object.type === 'table' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapTable(object, rotate);
    }
    return object;
  });
  return commitObjects(document, nextObjects);
}

export function scaleSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
  center: { x: number; y: number },
  factor: number,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size === 0) return document;
  const selectedNodeIds = getSelectedNodeIds(objects, selectedObjectIds);
  const scale = (x: number, y: number) => ({
    x: center.x + (x - center.x) * factor,
    y: center.y + (y - center.y) * factor,
  });
  const nextObjects = objects.map((object) => {
    if (object.type === 'node' && selectedNodeIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return { ...object, position: scale(object.position.x, object.position.y) };
    }
    if (object.type === 'arrow' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        tail: scale(object.tail.x, object.tail.y),
        head: scale(object.head.x, object.head.y),
        ...(object.controlPoint
          ? { controlPoint: scale(object.controlPoint.x, object.controlPoint.y) }
          : {}),
      };
    }
    if (object.type === 'text' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        anchor: scale(object.anchor.x, object.anchor.y),
        style: {
          ...object.style,
          ...(object.style?.fontSize != null
            ? { fontSize: Math.max(6, object.style.fontSize * factor) }
            : {}),
        },
        ...(object.objectTags ? { objectTags: mapObjectTags(object.objectTags, scale) } : {}),
      };
    }
    if (object.type === 'bracket' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return {
        ...object,
        bounds: mapBounds(object.bounds, scale),
        ...(object.objectTags ? { objectTags: mapObjectTags(object.objectTags, scale) } : {}),
      };
    }
    if (object.type === 'graphic' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapGraphic(object, scale);
    }
    if (object.type === 'embedded-object' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapEmbeddedObject(object, scale);
    }
    if (object.type === 'table' && selectedObjectIds.has(object.id)) {
      if (blocksTransform(object)) return object;
      return mapTable(object, scale);
    }
    return object;
  });
  return commitObjects(document, nextObjects);
}

export function deleteSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size === 0) return document;
  const protectedObjectIds = new Set(
    objects
      .filter((object) => selectedObjectIds.has(object.id) && blocksDelete(object))
      .map((object) => object.id),
  );
  const effectiveSelection = new Set(
    [...selectedObjectIds].filter((id) => !protectedObjectIds.has(id)),
  );
  if (effectiveSelection.size === 0) return document;
  const selectedNodeIds = new Set(
    [...getSelectedNodeIds(objects, effectiveSelection)].filter((id) => {
      const object = objects.find(
        (entry): entry is ChemDrawNode => entry.type === 'node' && entry.id === id,
      );
      return object ? !blocksDelete(object) : true;
    }),
  );
  const kept = objects.filter((object) => {
    if (effectiveSelection.has(object.id)) return false;
    if (object.type === 'node' && selectedNodeIds.has(object.id)) return false;
    if (
      object.type === 'bond' &&
      (selectedNodeIds.has(object.beginNodeId) || selectedNodeIds.has(object.endNodeId))
    )
      return false;
    return true;
  });
  return commitObjects(document, cleanupDocument(kept));
}

export function createGroupFromSelection(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size < 2) return document;
  const group: ChemDrawGroup = {
    id: crypto.randomUUID(),
    type: 'group',
    childIds: [...selectedObjectIds],
  };
  return commitObjects(document, [...objects, group]);
}

export function removeGroupsFromSelection(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size === 0) return document;
  const groups = objects.filter((object): object is ChemDrawGroup => object.type === 'group');
  const groupToRemove = groups.find(
    (group) =>
      selectedObjectIds.has(group.id) || group.childIds.some((id) => selectedObjectIds.has(id)),
  );
  if (!groupToRemove) return document;
  const nextObjects = objects
    .filter((object) => object.id !== groupToRemove.id)
    .map((object) => {
      if (object.type !== 'group') return object;
      return { ...object, childIds: object.childIds.filter((id) => id !== groupToRemove.id) };
    });
  return commitObjects(document, nextObjects);
}

export function alignSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
  op:
    | 'alignLeft'
    | 'alignRight'
    | 'alignTop'
    | 'alignBottom'
    | 'centerH'
    | 'centerV'
    | 'distributeH'
    | 'distributeV',
): ChemDrawDocument {
  const objects = clonePageObjects(document);
  if (!objects || selectedObjectIds.size < 2) return document;
  const documentStyleSettings =
    document.metadata?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  const units = [...selectedObjectIds]
    .map((id) => {
      const object = objectMap.get(id);
      const bounds = object ? objectBounds(object, objectMap, documentStyleSettings) : null;
      return object && bounds ? { id, bounds } : null;
    })
    .filter((unit): unit is { id: string; bounds: ChemDrawBounds } => Boolean(unit));
  if (units.length < 2) return document;

  const deltas = new Map<string, { dx: number; dy: number }>();
  if ((op === 'distributeH' || op === 'distributeV') && units.length < 3) return document;

  if (op === 'distributeH') {
    const sorted = [...units].sort(
      (a, b) => (a.bounds.left + a.bounds.right) / 2 - (b.bounds.left + b.bounds.right) / 2,
    );
    const first = (sorted[0].bounds.left + sorted[0].bounds.right) / 2;
    const last =
      (sorted[sorted.length - 1].bounds.left + sorted[sorted.length - 1].bounds.right) / 2;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((unit, index) => {
      const target = first + index * step;
      deltas.set(unit.id, { dx: target - (unit.bounds.left + unit.bounds.right) / 2, dy: 0 });
    });
  } else if (op === 'distributeV') {
    const sorted = [...units].sort(
      (a, b) => (a.bounds.top + a.bounds.bottom) / 2 - (b.bounds.top + b.bounds.bottom) / 2,
    );
    const first = (sorted[0].bounds.top + sorted[0].bounds.bottom) / 2;
    const last =
      (sorted[sorted.length - 1].bounds.top + sorted[sorted.length - 1].bounds.bottom) / 2;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((unit, index) => {
      const target = first + index * step;
      deltas.set(unit.id, { dx: 0, dy: target - (unit.bounds.top + unit.bounds.bottom) / 2 });
    });
  } else {
    let targetX = 0;
    let targetY = 0;
    if (op === 'alignLeft') targetX = Math.min(...units.map((unit) => unit.bounds.left));
    if (op === 'alignRight') targetX = Math.max(...units.map((unit) => unit.bounds.right));
    if (op === 'alignTop') targetY = Math.min(...units.map((unit) => unit.bounds.top));
    if (op === 'alignBottom') targetY = Math.max(...units.map((unit) => unit.bounds.bottom));
    if (op === 'centerH')
      targetX =
        units.reduce((sum, unit) => sum + (unit.bounds.left + unit.bounds.right) / 2, 0) /
        units.length;
    if (op === 'centerV')
      targetY =
        units.reduce((sum, unit) => sum + (unit.bounds.top + unit.bounds.bottom) / 2, 0) /
        units.length;
    units.forEach((unit) => {
      let dx = 0;
      let dy = 0;
      if (op === 'alignLeft') dx = targetX - unit.bounds.left;
      if (op === 'alignRight') dx = targetX - unit.bounds.right;
      if (op === 'alignTop') dy = targetY - unit.bounds.top;
      if (op === 'alignBottom') dy = targetY - unit.bounds.bottom;
      if (op === 'centerH') dx = targetX - (unit.bounds.left + unit.bounds.right) / 2;
      if (op === 'centerV') dy = targetY - (unit.bounds.top + unit.bounds.bottom) / 2;
      deltas.set(unit.id, { dx, dy });
    });
  }

  let nextDocument = document;
  for (const [id, delta] of deltas) {
    nextDocument = moveSelectedObjects(nextDocument, new Set([id]), delta.dx, delta.dy);
  }
  return nextDocument;
}
