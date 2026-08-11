import {
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useRef,
  useMemo,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react';
import { Stage, Layer, Circle, Line, Text, Group, Rect, Shape, Star } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Context as KonvaContext } from 'konva/lib/Context';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { useRDKit } from '../hooks/useRDKit';
import {
  loadChemDrawDocumentForCanvasAsync,
  prepareChemDrawDocumentForSaveAsync,
} from '../lib/chemdrawDocumentCommandsAsync';
import type {
  Atom,
  AtomLabelOrientation,
  Bond,
  BondDisplayStyle,
  Arrow,
  ArrowType,
  CanvasState as ChemistryCanvasState,
  TextBox,
} from '../types/chemistry';
import type {
  ChemDrawArrow,
  ChemDrawBracket,
  ChemDrawEmbeddedObject,
  ChemDrawGraphic,
  ChemDrawTable,
} from '../types/chemdraw';
import type { RdkitModule, RdkitMol } from '../types/rdkit';
import { useStore } from '../store';
import type { SelectionPreviewTransform } from '../store';
import type { ViewerStructureStatus } from '../store';
import {
  graphToMolblock,
  getConnectedComponents,
  getFullySelectedComponentAtomIds,
  hashCanvasState,
  molblockToState,
  normalizeMolblockBondLength,
  parseMolblockGeometry,
  SNAP_ANGLE,
} from '../lib/graph';
import {
  buildAliasResolutionSnapshot,
  expandAliasSmiles,
  resolveAliasChemistry,
} from '../lib/aliasChemistry';
import { evaluateTextBoxChemicalState, resolveChemicalTextStructure } from '../lib/chemicalText';
import { expandSupportedAliasGraph } from '../lib/aliasGraphExpansion';
import { getAtomDisplayText, getAtomHydrogenCount } from '../lib/atomLabels';
import {
  applyElectronToolToAtom,
  getAtomElectronMarkerGeometry,
  updateAtomElectronMarkerAngle,
} from '../lib/electronAnnotations';
import { VALENCIES, isElementSymbol } from '../lib/elements';
import {
  getAtomAlias,
  getAtomLeadElement,
  getAtomNodeText,
  isAliasAtom,
  setAtomValue,
} from '../lib/atomIdentity';
import {
  buildAtomLabelRuns,
  getLeadElementAnchorOffset,
  getOrientationPreviewLabel,
} from '../lib/atomLabelPresentation';
import { SHORTHAND_DATA, type ShorthandEntry } from '../lib/shorthand';
import {
  extractRunsFromDOM,
  getTextRunFontStyle,
  getTextBoxDimensions,
  getTextBoxRenderLines,
  insertPlainTextIntoEditable,
  measureRunWidth,
  runsToHTML,
} from '../lib/textRunPresentation';
import { generateCanvasSVG } from '../lib/svgExport';
import {
  applyArrowStyleEdit,
  applyBondEdit,
  applyBondStyleEdit,
  applyNodeLabelStyleEdit,
  applyNodeValueEdit,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
  reorderBondObjects,
  reverseBondDirection,
} from '../lib/chemdrawModel';
import {
  convertNativeToCanvas,
  DEFAULT_CANVAS_BOND_LENGTH,
  getDocumentCaptionFontSize,
  getNodeLabelVerticalOffset,
  resolveArrowHeadType,
  resolveDocumentCaptionTextStyle,
  resolveDocumentLabelTextStyle,
} from '../lib/chemdrawMetrics';
import {
  arrowUsesControlPoint,
  collectBondNeighborVectors,
  DEFAULT_DOUBLE_BOND_MODE,
  getArrowGeometryMetrics,
  getArrowLabelAnchors,
  getArrowOffsetCurve,
  getArrowPointAt,
  getArrowSelectionPoints,
  getArrowTangentAt,
  getAtomBondClipOffset,
  getAtomLabelBoxWidth,
  getDefaultArrowControlPoint,
  getDefaultArrowLineWidth,
  getDoubleBondLineGeometry,
  getAtomLabelLayoutMetrics,
  getBondVisualMetrics,
  getNextDoubleBondToolMode,
  getOffsetBondLineGeometry,
  resolveDoubleBondMode,
  getTripleBondLineGeometry,
  isAtomLabelVisible,
  DEFAULT_ATOM_LABEL_FONT_SIZE,
} from '../lib/renderGeometry';
import { readModifierKeyState, shouldIgnoreKeyboardShortcuts } from '../lib/keyboard';
import {
  getPreferredAttachmentAngle,
  getRegularRingGeometry,
  isRingTemplatePreset,
  materializeResolvedRingTemplatePlacement,
  materializeRingGeometry,
  resolveRingTemplatePlacement,
  type RingGeometry,
  type ResolvedRingTemplatePlacement,
} from '../lib/ringTemplates';
import { useBondTool } from '../tools/useBondTool';
import { useSelectTool } from '../tools/useSelectTool';
import { useAtomTool } from '../tools/useAtomTool';
import { DeferredNumberInput } from './DeferredNumberInput';
import { FloatingPanel } from './FloatingPanel';
import { SelectMenu } from './SelectMenu';
import { getPageSetupDimensionsPx, resolveAtomLabelColor, resolveBondColor } from '../lib/settings';
import { buildDocumentIndex } from '../editor/document';
import {
  createDeleteSelectionCommand,
  createMoveSelectionCommand,
  createReplaceDocumentCommand,
  createUpsertObjectsCommand,
} from '../editor/commands';
import { createEditorSessionState } from '../editor/session';
import {
  DocumentRenderSurface,
  type DocumentRenderSurfaceRef,
} from '../editor/scene/DocumentRenderSurface';
import { buildLegacySceneState } from '../editor/scene/buildScene';
import { hitTestDocumentScene } from '../editor/scene/hitTest';
import type { DocumentSceneState } from '../editor/scene/renderDocumentScene';
import { saveBinaryWithDialog, saveTextToPath, saveTextWithDialog } from '../lib/fileDialogs';
import { buildPdfHexForRasterImage, fitImageWithinViewport } from '../lib/embeddedObjects';
import {
  ATOM_FRAGMENT_HOTKEY_VALUES,
  ATOM_FRAGMENT_OPTIONS,
  ATOM_HOTKEY_VALUES,
  BOND_HOTKEY_VALUES,
  eventMatchesShortcut,
  FRAGMENT_MIN_FV,
  getCanvasToolShortcut,
  getShortcutBinding,
} from '../lib/keybindings';

interface Props {
  width: number;
  height: number;
}

export interface ChemCanvasRef {
  saveNative: (options?: { path?: string | null; prompt?: boolean }) => Promise<{
    path: string | null;
    saved: boolean;
  }>;
  loadNative: (content: string) => Promise<void>;
  exportPNG: () => Promise<void>;
  exportSVG: () => Promise<void>;
  insertImage: (options: {
    bytes: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg';
    sourceFileName?: string;
  }) => Promise<void>;
  getMolblock: () => string;
  loadFromSmiles: (smiles: string) => void;
  cleanUp: () => void;
  addFromState: (buf: import('../lib/clipboard').ClipboardBuffer) => void;
  addFromSmiles: (input: string) => void;
  applyTextFormat: (cmd: string, value?: string) => void;
  fitToScreen: () => void;
  moveContentIntoPage: () => void;
  centerPageInView: () => void;
}

function collectPreviewMovedAtomIds(
  selectedAtomIds: Set<string>,
  selectedBondIds: Set<string>,
  bonds: Bond[],
): Set<string> {
  const movedAtomIds = new Set(selectedAtomIds);
  selectedBondIds.forEach((bondId) => {
    const bond = bonds.find((entry) => entry.id === bondId);
    if (!bond) return;
    movedAtomIds.add(bond.from);
    movedAtomIds.add(bond.to);
  });
  return movedAtomIds;
}

function collectPreviewAffectedBondIds(movedAtomIds: Set<string>, bonds: Bond[]): Set<string> {
  return new Set(
    bonds
      .filter((bond) => movedAtomIds.has(bond.from) || movedAtomIds.has(bond.to))
      .map((bond) => bond.id),
  );
}

function transformPreviewPoint(
  point: { x: number; y: number },
  preview: SelectionPreviewTransform,
): { x: number; y: number } {
  if (preview.kind === 'move') {
    return { x: point.x + preview.dx, y: point.y + preview.dy };
  }
  if (preview.kind === 'rotate') {
    const dx = point.x - preview.center.x;
    const dy = point.y - preview.center.y;
    return {
      x: preview.center.x + dx * Math.cos(preview.radians) - dy * Math.sin(preview.radians),
      y: preview.center.y + dx * Math.sin(preview.radians) + dy * Math.cos(preview.radians),
    };
  }
  return {
    x: preview.anchor.x + (point.x - preview.anchor.x) * preview.factor,
    y: preview.anchor.y + (point.y - preview.anchor.y) * preview.factor,
  };
}

function getPreviewGroupProps(preview: SelectionPreviewTransform | null) {
  if (!preview) return null;
  if (preview.kind === 'move') {
    return { x: preview.dx, y: preview.dy };
  }
  if (preview.kind === 'rotate') {
    return {
      x: preview.center.x,
      y: preview.center.y,
      offsetX: preview.center.x,
      offsetY: preview.center.y,
      rotation: (preview.radians * 180) / Math.PI,
    };
  }
  return {
    x: preview.anchor.x,
    y: preview.anchor.y,
    offsetX: preview.anchor.x,
    offsetY: preview.anchor.y,
    scaleX: preview.factor,
    scaleY: preview.factor,
  };
}

type EditPanelLayout = {
  pos: { x: number; y: number };
  size: { width: number; height: number };
  align: 'left' | 'right';
};

function getCornerPanelX(
  containerWidth: number,
  panelWidth: number,
  align: EditPanelLayout['align'],
) {
  return align === 'left' ? 12 : Math.max(12, containerWidth - panelWidth - 12);
}

function createDefaultEditPanelLayout(
  containerWidth: number,
  size: EditPanelLayout['size'],
  align: EditPanelLayout['align'] = 'right',
): EditPanelLayout {
  return {
    pos: { x: getCornerPanelX(containerWidth, size.width, align), y: 12 },
    size,
    align,
  };
}

// Returns free valence of an atom (max valence minus sum of existing bond orders).
// For atoms with unknown/variable valency (metals, etc.), returns a large number
// so the bond tool never refuses connections to them.
function getAtomFreeValence(atom: Atom, bonds: Bond[]): number {
  const knownVal = VALENCIES[getAtomLeadElement(atom)] ?? null;
  if (knownVal === null) return 100; // variable valency — always allow bonding
  const usedVal = bonds
    .filter((b) => b.from === atom.id || b.to === atom.id)
    .reduce((s, b) => s + (b.order || 1), 0);
  return Math.max(0, knownVal - usedVal);
}

function getCanvasContentBounds(
  atoms: Atom[],
  arrows: Arrow[],
  textBoxes: TextBox[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts: { x: number; y: number }[] = [
    ...atoms.map((a) => ({ x: a.x, y: a.y })),
    ...arrows.flatMap((a) => [
      { x: a.x1, y: a.y1 },
      { x: a.x2, y: a.y2 },
      { x: a.cpx, y: a.cpy },
    ]),
    ...textBoxes.map((t) => ({ x: t.x, y: t.y })),
  ];
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

function describeRdkitError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Chemistry engine rejected this structure';
}

function buildAliasValidator(rdkit: RdkitModule | null) {
  if (!rdkit) return undefined;
  return (fragmentSmiles: string) => {
    const fragment = getMolWithFallback(rdkit, fragmentSmiles);
    if (!fragment) return { error: 'Chemistry engine rejected alias fragment' };
    let canonicalSmiles: string;
    try {
      canonicalSmiles = fragment.get_smiles();
    } catch {
      canonicalSmiles = fragmentSmiles;
    }
    fragment.delete();
    return { canonicalSmiles };
  };
}

function getMolWithFallback(
  rdkit: RdkitModule | null,
  input: string,
  options?: { sanitizeOnly?: boolean },
): RdkitMol | null {
  if (!rdkit || !input.trim()) return null;

  const attempts: Array<() => RdkitMol | null> = options?.sanitizeOnly
    ? [() => rdkit.get_mol(input)]
    : [
        () => rdkit.get_mol(input),
        () => rdkit.get_mol(input, JSON.stringify({ sanitize: false, removeHs: false })),
      ];

  for (const attempt of attempts) {
    try {
      const mol = attempt();
      if (mol) return mol;
    } catch {
      /* intentional */
    }
  }
  return null;
}

interface ResolvedChemicalInput {
  smiles: string;
  molblock: string;
  source: 'smiles' | 'formula';
}

function resolveChemicalInput(
  rdkit: RdkitModule | null,
  input: string,
  validateSmiles?: ReturnType<typeof buildAliasValidator>,
): ResolvedChemicalInput | null {
  const trimmed = input.trim();
  if (!rdkit || !trimmed) return null;

  let mol = getMolWithFallback(rdkit, trimmed);
  let smiles = trimmed;
  let source: ResolvedChemicalInput['source'] = 'smiles';

  if (!mol) {
    const resolution = resolveChemicalTextStructure(trimmed, { validateSmiles });
    if (!resolution.ok || !resolution.smiles) return null;
    mol = getMolWithFallback(rdkit, resolution.smiles);
    if (!mol) return null;
    smiles = resolution.smiles;
    source = 'formula';
  }

  try {
    mol.set_new_coords?.();
  } catch {
    /* intentional */
  }

  let canonicalSmiles = smiles;
  try {
    canonicalSmiles = mol.get_smiles();
  } catch {
    /* intentional */
  }

  const molblock = mol.get_molblock?.() ?? '';
  mol.delete();
  return {
    smiles: canonicalSmiles || smiles,
    molblock,
    source,
  };
}

function aliasResolutionMessage(resolution: ReturnType<typeof resolveAliasChemistry>): string {
  if (resolution.reason === 'ambiguous')
    return 'Choose one interpretation for this label before enabling chemistry-backed features.';
  if (resolution.reason === 'chemically_invalid')
    return 'Chemistry engine rejected all parsed interpretations for this label.';
  if (resolution.selected?.semanticKind === 'coordination')
    return 'Coordination-style ligands are preserved, but chemistry-backed features need a curated covalent fallback.';
  return 'Chemistry-backed features are unavailable for this labeled alias.';
}

function extractImplicitHydrogensByMapNumber(molJson: string): Map<number, number> {
  const implicitHydrogensByMapNumber = new Map<number, number>();
  try {
    const parsed = JSON.parse(molJson) as {
      defaults?: { atom?: { impHs?: number } };
      molecules?: Array<{ atoms?: Array<{ impHs?: number }> }>;
    };
    const fallbackImplicitHydrogens = parsed.defaults?.atom?.impHs ?? 0;
    const atoms = parsed.molecules?.[0]?.atoms ?? [];
    atoms.forEach((atom, index) => {
      const implicitHydrogens =
        typeof atom?.impHs === 'number' ? atom.impHs : fallbackImplicitHydrogens;
      if (implicitHydrogens > 0) implicitHydrogensByMapNumber.set(index + 1, implicitHydrogens);
    });
  } catch {
    /* intentional */
  }
  return implicitHydrogensByMapNumber;
}

function tryGetSmilesFromMolblock(
  rdkit: RdkitModule | null,
  molblock: string,
  shorthandMap: Map<number, string>,
  options?: { preserveAtomMaps?: boolean },
): { smiles: string | null; error: string | null } {
  if (!rdkit || !molblock) return { smiles: null, error: null };
  let mol: RdkitMol | null = null;
  try {
    try {
      mol = rdkit.get_mol(molblock);
    } catch {
      /* sanitized parse may throw */
    }
    if (!mol) {
      try {
        mol = rdkit.get_mol(molblock, JSON.stringify({ sanitize: false, removeHs: false }));
      } catch {
        mol = null;
      }
    }
    if (!mol) return { smiles: null, error: 'Chemistry engine rejected this structure' };
    const implicitHydrogensByMapNumber =
      options?.preserveAtomMaps && typeof mol.get_json === 'function'
        ? extractImplicitHydrogensByMapNumber(mol.get_json())
        : undefined;
    const smiles = expandAliasSmiles(mol.get_smiles(), shorthandMap, {
      validateSmiles: buildAliasValidator(rdkit),
      preserveAtomMaps: options?.preserveAtomMaps,
      implicitHydrogensByMapNumber,
    });
    return { smiles, error: null };
  } catch (error) {
    return { smiles: null, error: describeRdkitError(error) };
  } finally {
    mol?.delete();
  }
}

function buildChemistryMolblockInputs(
  rdkit: RdkitModule | null,
  atoms: Atom[],
  bonds: Bond[],
  width: number,
  height: number,
  resolveAliasEntry: (atom: Atom, label: string | undefined) => ShorthandEntry | undefined,
) {
  const direct = graphToMolblock(atoms, bonds, width, height, resolveAliasEntry);
  const mapped = graphToMolblock(atoms, bonds, width, height, resolveAliasEntry, true);
  const expanded = expandSupportedAliasGraph(rdkit, atoms, bonds, resolveAliasEntry);
  if (!expanded) {
    return {
      molblock: direct.molblock,
      shorthandMap: direct.shorthandMap,
      mappedMolblock: mapped.molblock,
      mappedShorthandMap: mapped.shorthandMap,
      usesExpandedAliases: false,
    };
  }

  const expandedDirect = graphToMolblock(expanded.atoms, expanded.bonds, width, height);
  const expandedMapped = graphToMolblock(
    expanded.atoms,
    expanded.bonds,
    width,
    height,
    undefined,
    true,
  );
  return {
    molblock: expandedDirect.molblock,
    shorthandMap: new Map<number, string>(),
    mappedMolblock: expandedMapped.molblock,
    mappedShorthandMap: new Map<number, string>(),
    usesExpandedAliases: true,
  };
}

function hasCustomChemistryLabel(
  atom: Atom,
  resolveAlias: (atom: Atom, label: string | undefined) => ReturnType<typeof resolveAliasChemistry>,
): boolean {
  if (!isAliasAtom(atom)) {
    return !isElementSymbol(atom.element) && atom.element !== 'D';
  }
  const alias = getAtomAlias(atom);
  if (!alias) return false;
  const resolution = resolveAlias(atom, alias);
  if (resolution.selected?.semanticKind === 'coordination') return true;
  if (!resolution.selected?.subsSmiles) return true;
  return Boolean(!resolution.selected && !isElementSymbol(alias) && alias !== 'D');
}

function drawArrowShape(
  ctx: CanvasRenderingContext2D,
  arrow: Pick<
    Arrow,
    'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'cpx' | 'cpy' | 'lineWidth' | 'lineStyle' | 'curveEnabled'
  >,
  color: string,
  options?: {
    documentStyleSettings?: ReturnType<typeof useStore.getState>['documentStyleSettings'];
    nativeArrow?: ChemDrawArrow | null;
  },
) {
  const { type } = arrow;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const geometry = getArrowGeometryMetrics(
    arrow,
    options?.documentStyleSettings,
    options?.nativeArrow,
  );
  const headType = resolveArrowHeadType({ type }, options?.nativeArrow);
  const strokeWidth = geometry.lineWidth;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dashPattern =
    type === 'dashed-reaction' ? [6, 4] : arrow.lineStyle === 'dashed' ? [6, 4] : null;
  const dx = arrow.x2 - arrow.x1,
    dy = arrow.y2 - arrow.y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const usesControlPoint = arrowUsesControlPoint(arrow);
  const headLength = geometry.headSize;
  const headHalfWidth = geometry.headWidth;
  const halfHeadLength = geometry.headCenterSize;
  const parallelOffset = geometry.shaftSpacing;
  const endTangent = getArrowTangentAt(arrow, 1);
  const startTangent = getArrowTangentAt(arrow, 0);
  const endAngle = Math.atan2(endTangent.dy, endTangent.dx);
  const startAngle = Math.atan2(startTangent.dy, startTangent.dx);

  const strokePath = (
    points: { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number } = arrow,
    width = strokeWidth,
    dash = dashPattern,
    reverse = false,
  ) => {
    if (dash) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
    ctx.lineWidth = width;
    ctx.beginPath();
    if (reverse) {
      ctx.moveTo(points.x2, points.y2);
      if (usesControlPoint) ctx.quadraticCurveTo(points.cpx, points.cpy, points.x1, points.y1);
      else ctx.lineTo(points.x1, points.y1);
    } else {
      ctx.moveTo(points.x1, points.y1);
      if (usesControlPoint) ctx.quadraticCurveTo(points.cpx, points.cpy, points.x2, points.y2);
      else ctx.lineTo(points.x2, points.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const fillHead = (x: number, y: number, angle: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle),
    );
    ctx.lineTo(
      x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle),
    );
    ctx.closePath();
    ctx.fill();
  };

  const strokeHead = (x: number, y: number, angle: number) => {
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(
      x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle),
    );
    ctx.lineTo(x, y);
    ctx.lineTo(
      x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle),
    );
    ctx.stroke();
  };

  const strokeAngleHead = (x: number, y: number, angle: number) => {
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - headLength * Math.cos(angle) + headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) - headHalfWidth * Math.cos(angle),
    );
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - headLength * Math.cos(angle) - headHalfWidth * Math.sin(angle),
      y - headLength * Math.sin(angle) + headHalfWidth * Math.cos(angle),
    );
    ctx.stroke();
  };

  const strokeHalfHead = (x: number, y: number, angle: number, side: 1 | -1) => {
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(
      x - halfHeadLength * Math.cos(angle) + side * headHalfWidth * Math.sin(angle),
      y - halfHeadLength * Math.sin(angle) - side * headHalfWidth * Math.cos(angle),
    );
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const drawResolvedHead = (x: number, y: number, angle: number) => {
    if (headType === 'filled') fillHead(x, y, angle);
    else if (headType === 'angle') strokeAngleHead(x, y, angle);
    else strokeHead(x, y, angle);
  };

  if (type === 'fat') {
    strokePath(arrow, Math.max(6, strokeWidth * 1.8), null);
    fillHead(arrow.x2, arrow.y2, endAngle);
    return;
  }

  if (type === 'equilibrium') {
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
    strokePath(top, strokeWidth, null);
    strokeHalfHead(top.x2, top.y2, endAngle, -1);
    strokePath(bottom, strokeWidth, null, true);
    strokeHalfHead(bottom.x1, bottom.y1, startAngle + Math.PI, 1);
    return;
  }

  if (type === 'retrosynthetic') {
    strokePath(getArrowOffsetCurve(arrow, -parallelOffset));
    strokePath(getArrowOffsetCurve(arrow, parallelOffset));
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    return;
  }

  strokePath();
  if (type === 'reaction' || type === 'dashed-reaction' || type === 'curved') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    return;
  }
  if (type === 'no-reaction') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    const mid = getArrowPointAt(arrow, 0.5);
    const tangent = getArrowTangentAt(arrow, 0.5);
    const angle = Math.atan2(tangent.dy, tangent.dx);
    const crossLen = Math.max(9, geometry.headSize * 0.9);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    ctx.lineWidth = Math.max(strokeWidth, 2.5);
    ctx.beginPath();
    ctx.moveTo(
      mid.x - Math.cos(angle) * crossLen - perpX * crossLen,
      mid.y - Math.sin(angle) * crossLen - perpY * crossLen,
    );
    ctx.lineTo(
      mid.x + Math.cos(angle) * crossLen + perpX * crossLen,
      mid.y + Math.sin(angle) * crossLen + perpY * crossLen,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(
      mid.x + Math.cos(angle) * crossLen - perpX * crossLen,
      mid.y + Math.sin(angle) * crossLen - perpY * crossLen,
    );
    ctx.lineTo(
      mid.x - Math.cos(angle) * crossLen + perpX * crossLen,
      mid.y - Math.sin(angle) * crossLen + perpY * crossLen,
    );
    ctx.stroke();
    return;
  }
  if (type === 'resonance') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    drawResolvedHead(arrow.x1, arrow.y1, startAngle + Math.PI);
    return;
  }
  if (type === 'half-curved') {
    strokeHalfHead(arrow.x2, arrow.y2, endAngle, -1);
  }
}

function reorderBondStack(bonds: Bond[], bondId: string, direction: 'front' | 'back'): Bond[] {
  const currentIndex = bonds.findIndex((bond) => bond.id === bondId);
  if (currentIndex < 0 || bonds.length < 2) return bonds;
  if (direction === 'front' && currentIndex === bonds.length - 1) return bonds;
  if (direction === 'back' && currentIndex === 0) return bonds;

  const nextBonds = [...bonds];
  const [bond] = nextBonds.splice(currentIndex, 1);
  if (!bond) return bonds;
  if (direction === 'front') nextBonds.push(bond);
  else nextBonds.unshift(bond);
  return nextBonds;
}

type RingPlacementPreview =
  | { kind: 'polygon'; geometry: RingGeometry }
  | { kind: 'template'; placement: ResolvedRingTemplatePlacement };

const LEGACY_DEFAULT_VISUAL_BOND_LENGTH = 45;
const DEFAULT_STAGE_SCALE = LEGACY_DEFAULT_VISUAL_BOND_LENGTH / DEFAULT_CANVAS_BOND_LENGTH;

export const ChemCanvas = forwardRef<ChemCanvasRef, Props>(({ width, height }, ref) => {
  const { rdkit, failed: rdkitFailed } = useRDKit();
  const stageRef = useRef<KonvaStage>(null);
  const sceneSurfaceRef = useRef<DocumentRenderSurfaceRef>(null);

  const atoms = useStore((s) => s.atoms);
  const bonds = useStore((s) => s.bonds);
  const arrows = useStore((s) => s.arrows);
  const textBoxes = useStore((s) => s.textBoxes ?? []);
  const tool = useStore((s) => s.tool);
  const arrowType = useStore((s) => s.arrowType);
  const electronToolMode = useStore((s) => s.electronToolMode);
  const selectedFragment = useStore((s) => s.selectedFragment);
  const showHydrogens = useStore((s) => s.showHydrogens);
  const ringSize = useStore((s) => s.ringSize);
  const ringPreset = useStore((s) => s.ringPreset);
  const ringRotationSteps = useStore((s) => s.ringRotationSteps);
  const showGrid = useStore((s) => s.showGrid);
  const isDarkMode = useStore((s) => s.isDarkMode);
  const selectedAtomIds = useStore((s) => s.selectedAtomIds);
  const selectedBondIds = useStore((s) => s.selectedBondIds);
  const selectedObjectIds = useStore((s) => s.selectedObjectIds);
  const selectedArrowIds = useStore((s) => s.selectedArrowIds);
  const selectedTextBoxIds = useStore((s) => s.selectedTextBoxIds);
  const editMenusHidden = useStore((s) => s.editMenusHidden);
  const groups = useStore((s) => s.groups);
  const textFormat = useStore((s) => s.textFormat);
  const chemDrawDocument = useStore((s) => s.chemDrawDocument);
  const previewChemDrawDocument = useStore((s) => s.previewChemDrawDocument);
  const selectionPreviewTransform = useStore((s) => s.selectionPreviewTransform);
  const documentStyleSettings = useStore((s) => s.documentStyleSettings);
  const documentViewSettings = useStore((s) => s.documentViewSettings);
  const pageSetup = useStore((s) => s.pageSetup);
  const largeDocumentMode = useStore((s) => s.largeDocumentMode);
  const bondLength = documentStyleSettings.bondLength;
  const bondLineWidth = documentStyleSettings.bondLineWidth;

  const {
    pushToHistory,
    setCurrentCanvasState,
    setSelectedAtomIds,
    setSelectedBondIds,
    setSelectedArrowIds,
    setSelectedTextBoxIds,
    setLastInteractedAtomId,
    setViewerSmiles,
    setViewerGeometrySmiles,
    setViewerGeometryMolblock,
    setViewerMolblock,
    setViewerStructureStatus,
    setViewerAtomIndexById,
    setViewerAtomIdByMapNumber,
    setEditMenusHidden,
    setHoveredCanvasAtomId,
    setHoveredCanvasBondId,
    setEditableSmiles,
    setTextFormat,
    setSelectionPreviewTransform,
  } = useStore.getState();

  const [stageScale, setStageScale] = useState(DEFAULT_STAGE_SCALE);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isCtrlDown, setIsCtrlDown] = useState(false);
  const [hoveredAtomId, setHoveredAtomId] = useState<string | null>(null);
  const [hoveredBondId, setHoveredBondId] = useState<string | null>(null);
  const [hoveredArrowId, setHoveredArrowId] = useState<string | null>(null);
  const [hoveredTextBoxId, setHoveredTextBoxId] = useState<string | null>(null);
  const [hoveredNativeObjectId, setHoveredNativeObjectId] = useState<string | null>(null);
  const [hoveredScaleCorner, setHoveredScaleCorner] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(
    null,
  );
  const [rdkitInvalidAtomIds, setRdkitInvalidAtomIds] = useState<Set<string>>(new Set());
  const [atomLabelPanelLayout, setAtomLabelPanelLayout] = useState<EditPanelLayout | null>(null);
  const [arrowStylePanelLayout, setArrowStylePanelLayout] = useState<EditPanelLayout | null>(null);
  const [bondStylePanelLayout, setBondStylePanelLayout] = useState<EditPanelLayout | null>(null);
  const [arrowLabelsPanelLayout, setArrowLabelsPanelLayout] = useState<EditPanelLayout | null>(
    null,
  );
  const interactionActiveRef = useRef(false);
  const interactionIdleTimerRef = useRef<number | null>(null);
  const [interactionRevision, setInteractionRevision] = useState(0);

  const markInteractionActive = useCallback(() => {
    if (interactionIdleTimerRef.current !== null) {
      window.clearTimeout(interactionIdleTimerRef.current);
      interactionIdleTimerRef.current = null;
    }
    if (interactionActiveRef.current) return;
    interactionActiveRef.current = true;
    setInteractionRevision((value) => value + 1);
  }, []);

  const markInteractionIdle = useCallback(() => {
    if (interactionIdleTimerRef.current !== null) {
      window.clearTimeout(interactionIdleTimerRef.current);
    }
    interactionIdleTimerRef.current = window.setTimeout(
      () => {
        interactionIdleTimerRef.current = null;
        if (!interactionActiveRef.current) return;
        interactionActiveRef.current = false;
        setInteractionRevision((value) => value + 1);
      },
      largeDocumentMode ? 120 : 0,
    );
  }, [largeDocumentMode]);

  const resetStageView = useCallback(() => {
    setStageScale(DEFAULT_STAGE_SCALE);
    setStagePos({ x: 0, y: 0 });
  }, []);

  // Modifier keyup can be missed when focus shifts through toolbar/input UI, so keep
  // the canvas state synced to the latest real browser event instead of trusting local
  // state alone.
  const syncModifierKeys = useCallback((eventLike?: unknown) => {
    const next = readModifierKeyState(eventLike);
    setIsCtrlDown((prev) => (prev === next.primary ? prev : next.primary));
    return next;
  }, []);

  useEffect(
    () => () => {
      if (interactionIdleTimerRef.current !== null) {
        window.clearTimeout(interactionIdleTimerRef.current);
      }
    },
    [],
  );

  const [ringPreview, setRingPreview] = useState<RingPlacementPreview | null>(null);
  const activeChemDrawDocument = previewChemDrawDocument ?? chemDrawDocument;
  const sceneCanvasState = useMemo<ChemistryCanvasState>(() => {
    if (!previewChemDrawDocument) {
      return { atoms, bonds, arrows, groups, textBoxes };
    }
    const projected = chemDrawDocumentToCanvasState(previewChemDrawDocument).state;
    return {
      atoms: projected.atoms,
      bonds: projected.bonds,
      arrows: projected.arrows,
      groups,
      textBoxes: projected.textBoxes ?? [],
    };
  }, [arrows, atoms, bonds, groups, previewChemDrawDocument, textBoxes]);
  const sceneAtoms = sceneCanvasState.atoms;
  const sceneBonds = sceneCanvasState.bonds;
  const sceneArrows = sceneCanvasState.arrows;
  const sceneTextBoxes = useMemo(
    () => sceneCanvasState.textBoxes ?? [],
    [sceneCanvasState.textBoxes],
  );
  const previewHiddenObjectIds = useMemo(() => {
    if (!selectionPreviewTransform) return new Set<string>();
    return new Set([
      ...selectionPreviewTransform.selectedObjectIds,
      ...selectionPreviewTransform.movedAtomIds,
      ...selectionPreviewTransform.affectedBondIds,
    ]);
  }, [selectionPreviewTransform]);

  // Single source for every derived scene lookup. Built through the shared headless assembler
  // so the app, `node --test`, and the golden harness all render from an identically-derived
  // scene, and so the O(n^2) bond-crossing scan runs once rather than per consumer.
  const legacySceneState = useMemo(
    () =>
      buildLegacySceneState(
        {
          atoms: sceneAtoms,
          bonds: sceneBonds,
          arrows: sceneArrows,
          groups,
          textBoxes: sceneTextBoxes,
        },
        activeChemDrawDocument,
        documentStyleSettings,
      ),
    [
      activeChemDrawDocument,
      documentStyleSettings,
      groups,
      sceneArrows,
      sceneAtoms,
      sceneBonds,
      sceneTextBoxes,
    ],
  );
  const {
    atomById,
    bondById,
    arrowById,
    textBoxById,
    bondsByAtomId,
    ringCentroids,
    bondVisibleIntervals,
    nativeNodes,
    nativeBonds,
    nativeArrows,
  } = legacySceneState;
  const activePage = activeChemDrawDocument?.pages[0];
  const finitePageMetrics = useMemo(
    () => (pageSetup.mode === 'finite' ? getPageSetupDimensionsPx(pageSetup) : null),
    [pageSetup],
  );
  const nativeBrackets = useMemo(
    () =>
      (activePage?.objects ?? []).filter(
        (object): object is ChemDrawBracket => object.type === 'bracket',
      ),
    [activePage],
  );
  const nativeGraphics = useMemo(
    () =>
      (activePage?.objects ?? []).filter(
        (object): object is ChemDrawGraphic => object.type === 'graphic',
      ),
    [activePage],
  );
  const nativeEmbeddedObjects = useMemo(
    () =>
      (activePage?.objects ?? []).filter(
        (object): object is ChemDrawEmbeddedObject => object.type === 'embedded-object',
      ),
    [activePage],
  );
  const nativeTables = useMemo(
    () =>
      (activePage?.objects ?? []).filter(
        (object): object is ChemDrawTable => object.type === 'table',
      ),
    [activePage],
  );
  const getAtomElectronVisuals = useCallback(
    (atom: Atom) => {
      const nativeNode = nativeNodes.get(atom.id);
      const { fontSize } = resolveDocumentLabelTextStyle(documentStyleSettings, {
        authored: { fontSize: atom.labelFontSize },
        nativeStyle: nativeNode?.style,
      });
      const labelLayout = getAtomLabelLayoutMetrics(fontSize, fontSize, documentStyleSettings);
      return {
        labelLayout,
        markers: getAtomElectronMarkerGeometry(atom, {
          centerX: atom.x,
          centerY: atom.y,
          distance: labelLayout.electronDistance,
          pairSpacing: labelLayout.electronPairSpacing,
        }),
      };
    },
    [documentStyleSettings, nativeNodes],
  );
  const selectedElectronControlAtoms = useMemo(
    () =>
      sceneAtoms
        .filter((atom) => selectedAtomIds.has(atom.id))
        .map((atom) => ({ atom, ...getAtomElectronVisuals(atom) }))
        .filter((entry) => entry.markers.length > 0),
    [getAtomElectronVisuals, sceneAtoms, selectedAtomIds],
  );
  const [arrowPreview, setArrowPreview] = useState<Arrow | null>(null);

  const [editingArrowLabels, setEditingArrowLabels] = useState<{
    id: string;
    above: string;
    below: string;
    fontSize: number;
    color: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [editingAtomLabel, setEditingAtomLabel] = useState<{
    id: string;
    value: string;
    fontFamily: string;
    fontSize: number;
    color: string;
    defaultColor: string;
    colorExplicit: boolean;
    orientation: AtomLabelOrientation;
    resolution: ReturnType<typeof resolveAliasChemistry> | null;
    selectedCandidateId?: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [editingBondStyle, setEditingBondStyle] = useState<{
    id: string;
    order: number;
    color: string;
    lineWidth: number;
    display: BondDisplayStyle;
    doubleBondMode: 'auto' | 'flipped' | 'symmetric';
  } | null>(null);
  const [editingArrowStyle, setEditingArrowStyle] = useState<{
    id: string;
    type: ArrowType;
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'bold';
    curveEnabled: boolean;
  } | null>(null);
  const editingBondStackIndex = editingBondStyle
    ? bonds.findIndex((bond) => bond.id === editingBondStyle.id)
    : -1;
  const canBringBondToBack = editingBondStackIndex > 0;
  const canBringBondToFront =
    editingBondStackIndex >= 0 && editingBondStackIndex < bonds.length - 1;

  useEffect(() => {
    if (rdkitFailed)
      useStore.getState().showToast('Chemistry engine failed to load — drawing tools disabled');
  }, [rdkitFailed]);

  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const editOverlayRef = useRef<HTMLDivElement>(null);
  const ignoreNextBlurRef = useRef(false);
  const textToolDragRef = useRef<{
    textBoxId: string;
    startPos: { x: number; y: number };
    lastPos: { x: number; y: number };
    hasMoved: boolean;
  } | null>(null);
  useEffect(() => {
    if (!editingTextBoxId || !editOverlayRef.current) return;
    const el = editOverlayRef.current;
    // Set content imperatively — keeps React from resetting innerHTML on re-renders
    const tb = useStore.getState().textBoxes?.find((t) => t.id === editingTextBoxId);
    el.innerHTML = tb ? runsToHTML(tb.runs) : '';
    const t = setTimeout(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
    return () => clearTimeout(t);
  }, [editingTextBoxId]);
  const editorSession = useMemo(
    () =>
      createEditorSessionState({
        document: activeChemDrawDocument,
        canvasState: {
          atoms,
          bonds,
          arrows,
          groups,
          textBoxes,
        },
        selection: {
          objectIds: selectedObjectIds,
          atomIds: selectedAtomIds,
          bondIds: selectedBondIds,
          arrowIds: selectedArrowIds,
          textBoxIds: selectedTextBoxIds,
        },
        viewport: {
          width,
          height,
          scale: stageScale,
          x: stagePos.x,
          y: stagePos.y,
        },
        activeTool: tool,
        editMenusHidden,
        previewMode: useStore.getState().previewMode,
        showViewer: useStore.getState().showViewer,
        viewerMode: useStore.getState().viewerMode,
        documentStyleSettings,
        pageSetup,
      }),
    [
      activeChemDrawDocument,
      arrows,
      atoms,
      bonds,
      documentStyleSettings,
      editMenusHidden,
      groups,
      height,
      pageSetup,
      selectedArrowIds,
      selectedAtomIds,
      selectedBondIds,
      selectedObjectIds,
      selectedTextBoxIds,
      stagePos.x,
      stagePos.y,
      stageScale,
      textBoxes,
      tool,
      width,
    ],
  );
  const documentIndex = useMemo(
    () =>
      buildDocumentIndex(editorSession.document, {
        activePageId: editorSession.activePageId,
        documentStyleSettings,
      }),
    [documentStyleSettings, editorSession.activePageId, editorSession.document],
  );
  const fullySelectedComponentAtomIds = useMemo(
    () => getFullySelectedComponentAtomIds(sceneAtoms, sceneBonds, selectedAtomIds),
    [sceneAtoms, sceneBonds, selectedAtomIds],
  );
  // Built through the shared headless assembler so the app, `node --test`, and the golden
  // harness all render from an identically-derived scene.
  const documentScene = useMemo<DocumentSceneState>(
    () => ({
      index: documentIndex,
      legacy: legacySceneState,
      documentStyleSettings,
      documentViewSettings,
      pageSetup,
      isDarkMode,
      showHydrogens,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      selectedObjectIds,
      fullySelectedComponentAtomIds,
      hiddenObjectIds: previewHiddenObjectIds,
      hoveredAtomId,
      hoveredBondId,
      hoveredArrowId,
      hoveredTextBoxId,
      hoveredNativeObjectId,
      editingTextBoxId,
      rdkitInvalidAtomIds,
    }),
    [
      documentIndex,
      documentStyleSettings,
      documentViewSettings,
      editingTextBoxId,
      hoveredArrowId,
      hoveredAtomId,
      hoveredBondId,
      hoveredNativeObjectId,
      hoveredTextBoxId,
      isDarkMode,
      legacySceneState,
      pageSetup,
      rdkitInvalidAtomIds,
      selectedArrowIds,
      selectedAtomIds,
      selectedBondIds,
      fullySelectedComponentAtomIds,
      previewHiddenObjectIds,
      selectedObjectIds,
      selectedTextBoxIds,
      showHydrogens,
    ],
  );
  const contentHoveredAtomId = largeDocumentMode ? null : hoveredAtomId;
  const contentHoveredBondId = largeDocumentMode ? null : hoveredBondId;
  const contentHoveredArrowId = largeDocumentMode ? null : hoveredArrowId;
  const contentHoveredTextBoxId = largeDocumentMode ? null : hoveredTextBoxId;
  const contentHoveredNativeObjectId = largeDocumentMode ? null : hoveredNativeObjectId;
  const contentDocumentScene = useMemo<DocumentSceneState>(
    () => ({
      index: documentIndex,
      legacy: legacySceneState,
      documentStyleSettings,
      documentViewSettings,
      pageSetup,
      isDarkMode,
      showHydrogens,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      selectedObjectIds,
      fullySelectedComponentAtomIds,
      hiddenObjectIds: previewHiddenObjectIds,
      hoveredAtomId: contentHoveredAtomId,
      hoveredBondId: contentHoveredBondId,
      hoveredArrowId: contentHoveredArrowId,
      hoveredTextBoxId: contentHoveredTextBoxId,
      hoveredNativeObjectId: contentHoveredNativeObjectId,
      editingTextBoxId,
      rdkitInvalidAtomIds,
    }),
    [
      contentHoveredArrowId,
      contentHoveredAtomId,
      contentHoveredBondId,
      contentHoveredNativeObjectId,
      contentHoveredTextBoxId,
      documentIndex,
      documentStyleSettings,
      documentViewSettings,
      editingTextBoxId,
      isDarkMode,
      legacySceneState,
      pageSetup,
      rdkitInvalidAtomIds,
      selectedArrowIds,
      selectedAtomIds,
      selectedBondIds,
      fullySelectedComponentAtomIds,
      previewHiddenObjectIds,
      selectedObjectIds,
      selectedTextBoxIds,
      showHydrogens,
    ],
  );
  const commitNativeDocument = useCallback(
    (nextDocument: NonNullable<typeof chemDrawDocument>, description: string) => {
      useStore
        .getState()
        .dispatchEditorCommand(createReplaceDocumentCommand(nextDocument, description));
    },
    [],
  );
  const insertEmbeddedImage = useCallback(
    async (options: {
      bytes: Uint8Array;
      mimeType: 'image/png' | 'image/jpeg';
      sourceFileName?: string;
    }) => {
      const store = useStore.getState();
      const baseDocument =
        activeChemDrawDocument ??
        canvasStateToChemDrawDocument(
          {
            atoms: store.atoms,
            bonds: store.bonds,
            arrows: store.arrows,
            groups: store.groups,
            textBoxes: store.textBoxes,
          },
          {
            documentStyleSettings,
            pageSetup,
          },
        ).document;
      const activePage = baseDocument.pages[0];
      if (!activePage) return;

      const payload = await buildPdfHexForRasterImage({
        bytes: options.bytes,
        mimeType: options.mimeType,
        sourceFileName: options.sourceFileName,
      });
      const fitted = fitImageWithinViewport(
        payload.width,
        payload.height,
        Math.max(120, width * 0.4),
        Math.max(120, height * 0.35),
      );
      const centerX = (width / 2 - stagePos.x) / stageScale;
      const centerY = (height / 2 - stagePos.y) / stageScale;
      const imageId = crypto.randomUUID();
      const embeddedObject: ChemDrawEmbeddedObject = {
        id: imageId,
        type: 'embedded-object',
        bounds: {
          left: centerX - fitted.width / 2,
          top: centerY - fitted.height / 2,
          right: centerX + fitted.width / 2,
          bottom: centerY + fitted.height / 2,
        },
        payloadKind: 'pdf',
        payloadHex: payload.payloadHex,
        previewDataUrl: payload.previewDataUrl,
        sourceMimeType: options.mimeType,
        ...(options.sourceFileName ? { sourceFileName: options.sourceFileName } : {}),
        style: {
          zIndex: (activePage.objects.length ? activePage.objects.length + 1 : 1) * 10,
        },
      };

      const nextDocument =
        activeChemDrawDocument != null
          ? createUpsertObjectsCommand([embeddedObject], {
              description: 'insert-embedded-image',
            }).apply(baseDocument, {
              ...editorSession,
              activePageId: activePage.id,
            }).document
          : {
              ...baseDocument,
              pages: [
                {
                  ...activePage,
                  objects: [...activePage.objects, embeddedObject],
                },
              ],
            };

      commitNativeDocument(nextDocument, 'insert-embedded-image');
      store.setSelectedObjectIds(new Set([imageId]));
      store.setSelectedAtomIds(new Set());
      store.setSelectedBondIds(new Set());
      store.setSelectedArrowIds(new Set());
      store.setSelectedTextBoxIds(new Set());
      store.showToast('Image inserted into the ChemDraw document.', 'info');
    },
    [
      activeChemDrawDocument,
      commitNativeDocument,
      documentStyleSettings,
      editorSession,
      height,
      pageSetup,
      stagePos.x,
      stagePos.y,
      stageScale,
      width,
    ],
  );
  const useNativeSceneSurface = true;

  const selectionDragRef = useRef<{
    isDragging: boolean;
    startPos: { x: number; y: number } | null;
    sourceDocument: NonNullable<typeof chemDrawDocument> | null;
    totalDx: number;
    totalDy: number;
    selectedObjectIds: Set<string>;
    movedAtomIds: Set<string>;
    affectedBondIds: Set<string>;
  }>({
    isDragging: false,
    startPos: null,
    sourceDocument: null,
    totalDx: 0,
    totalDy: 0,
    selectedObjectIds: new Set(),
    movedAtomIds: new Set(),
    affectedBondIds: new Set(),
  });

  const bondTool = useBondTool();
  const selectTool = useSelectTool();
  const atomTool = useAtomTool();

  const prevToolRef = useRef(tool);
  useEffect(() => {
    if (prevToolRef.current !== tool) {
      bondTool.cleanup();
      selectTool.cleanup();
      atomTool.cleanup();
      textToolDragRef.current = null;
      setArrowPreview(null);
      setRingPreview(null);
      useStore.getState().clearPreviewChemDrawDocument();
      useStore.getState().clearSelectionPreviewTransform();
      selectionDragRef.current = {
        isDragging: false,
        startPos: null,
        sourceDocument: null,
        totalDx: 0,
        totalDy: 0,
        selectedObjectIds: new Set(),
        movedAtomIds: new Set(),
        affectedBondIds: new Set(),
      };
      prevToolRef.current = tool;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const lastHashRef = useRef('');
  const aliasResolutionCacheRef = useRef(
    new Map<string, ReturnType<typeof resolveAliasChemistry>>(),
  );
  const cachedCompsRef = useRef<{
    comps: Set<string>[];
    fullSmiles: string;
    invalidAtomIds: Set<string>;
    componentEntries: Array<{
      atomIds: Set<string>;
      molblock: string;
      prefersSmilesGeometry: boolean;
      geometrySmiles: string;
      geometryMolblock: string;
      atomIdByMapNumber: Record<string, string>;
      smiles: string;
      chemistryAvailable: boolean;
      smilesAvailable: boolean;
      fallbackGeometryAvailable: boolean;
      message: string | null;
    }>;
  } | null>(null);

  const aliasValidator = useMemo(() => buildAliasValidator(rdkit), [rdkit]);
  const resolveAliasForAtom = useMemo(() => {
    return (atom: Atom, label: string | undefined) => {
      if (!label) return { ok: false, reason: 'empty' as const, candidates: [] };
      const key = `${label.trim()}::${atom.aliasResolution?.selectedCandidateId ?? ''}`;
      const cached = aliasResolutionCacheRef.current.get(key);
      if (cached) return cached;
      const resolution = resolveAliasChemistry(label, {
        validateSmiles: aliasValidator,
        preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
      });
      aliasResolutionCacheRef.current.set(key, resolution);
      return resolution;
    };
  }, [aliasValidator]);

  const resolveAliasEntry = useMemo(() => {
    return (atom: Atom, label: string | undefined) =>
      isAliasAtom(atom) ? resolveAliasForAtom(atom, label).selected?.entry : undefined;
  }, [resolveAliasForAtom]);

  useEffect(() => {
    aliasResolutionCacheRef.current.clear();
  }, [aliasValidator]);

  useEffect(() => {
    if (largeDocumentMode && interactionActiveRef.current) {
      return undefined;
    }
    if (bondTool.isDragging && bondTool.activeAtomIsNew) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        if (largeDocumentMode && interactionActiveRef.current) return;
        // Rebuild full SMILES and component list only when atoms/bonds actually changed
        const currentHash = hashCanvasState(atoms, bonds);
        if (currentHash !== lastHashRef.current || !cachedCompsRef.current) {
          lastHashRef.current = currentHash;
          let fullSmiles = '';
          const hasDisplayOnlyLabels = atoms.some((atom) =>
            hasCustomChemistryLabel(atom, resolveAliasForAtom),
          );
          const fullChemistry = buildChemistryMolblockInputs(
            rdkit,
            atoms,
            bonds,
            width,
            height,
            resolveAliasEntry,
          );
          const fullResult = hasDisplayOnlyLabels
            ? {
                smiles: null,
                error:
                  'Chemistry-backed features are unavailable for one or more alias labels in this structure',
              }
            : tryGetSmilesFromMolblock(rdkit, fullChemistry.molblock, fullChemistry.shorthandMap);
          if (fullResult.smiles) fullSmiles = fullResult.smiles;
          const comps = getConnectedComponents(atoms, bonds);
          const invalidAtomIds = new Set<string>();
          const componentEntries = comps.map((component) => {
            const vA = atoms.filter((atom) => component.has(atom.id));
            const vB = bonds.filter((bond) => component.has(bond.from) && component.has(bond.to));
            const { molblock: vMb } = graphToMolblock(vA, vB, width, height, resolveAliasEntry);
            const hasCustomLabels = vA.some((atom) =>
              hasCustomChemistryLabel(atom, resolveAliasForAtom),
            );
            const chemistryInputs = buildChemistryMolblockInputs(
              rdkit,
              vA,
              vB,
              width,
              height,
              resolveAliasEntry,
            );
            const result = hasCustomLabels
              ? {
                  smiles: null,
                  error:
                    vA
                      .map((atom) =>
                        getAtomAlias(atom)
                          ? aliasResolutionMessage(resolveAliasForAtom(atom, getAtomAlias(atom)))
                          : null,
                      )
                      .find(Boolean) ??
                    'Chemistry-backed features are unavailable for this structure',
                }
              : tryGetSmilesFromMolblock(
                  rdkit,
                  chemistryInputs.molblock,
                  chemistryInputs.shorthandMap,
                );
            const geometrySmiles = !hasCustomLabels
              ? tryGetSmilesFromMolblock(
                  rdkit,
                  chemistryInputs.mappedMolblock,
                  chemistryInputs.mappedShorthandMap,
                  { preserveAtomMaps: true },
                ).smiles
              : null;
            const mappedGeometrySmiles = geometrySmiles ?? '';
            const prefersSmilesGeometry =
              (chemistryInputs.usesExpandedAliases ||
                chemistryInputs.mappedShorthandMap.size > 0) &&
              Boolean(mappedGeometrySmiles);
            const geometryMolblock = chemistryInputs.usesExpandedAliases
              ? chemistryInputs.mappedMolblock
              : '';
            const smilesAvailable = Boolean(result.smiles) && !hasCustomLabels;
            const chemistryAvailable = !hasCustomLabels;
            if (hasCustomLabels) {
              vA.forEach((atom) => invalidAtomIds.add(atom.id));
            }
            return {
              atomIds: component,
              molblock: vMb,
              prefersSmilesGeometry,
              geometrySmiles: mappedGeometrySmiles,
              geometryMolblock,
              atomIdByMapNumber: Object.fromEntries(
                vA.map((atom, index) => [String(index + 1), atom.id]),
              ),
              smiles: result.smiles ?? '',
              chemistryAvailable,
              smilesAvailable,
              fallbackGeometryAvailable: true,
              message: chemistryAvailable
                ? null
                : hasCustomLabels
                  ? (vA
                      .map((atom) =>
                        getAtomAlias(atom)
                          ? aliasResolutionMessage(resolveAliasForAtom(atom, getAtomAlias(atom)))
                          : null,
                      )
                      .find(Boolean) ??
                    'Chemistry-backed features are unavailable for this structure')
                  : (result.error ??
                    'Chemistry-backed features are unavailable for this structure'),
            };
          });
          cachedCompsRef.current = { comps, fullSmiles, invalidAtomIds, componentEntries };
          setRdkitInvalidAtomIds(invalidAtomIds);
          const { isInputFocused } = useStore.getState();
          if (!isInputFocused) setEditableSmiles(fullSmiles);
        }

        // Always re-evaluate which component to display (cheap — just pick from cache)
        const cached = cachedCompsRef.current;
        if (!cached) return;
        const {
          selectedAtomIds: selIds,
          lastInteractedAtomId,
          isInputFocused,
        } = useStore.getState();
        let ovSmiles = cached.fullSmiles;
        let ovGeometrySmiles = '';
        let ovGeometryMolblock = '';
        let ovMolblock = '';
        let ovStatus: ViewerStructureStatus =
          atoms.length === 0
            ? {
                kind: 'empty' as const,
                chemistryAvailable: false,
                fallbackGeometryAvailable: false,
                message: null,
              }
            : {
                kind: 'valid' as const,
                chemistryAvailable: true,
                fallbackGeometryAvailable: true,
                message: null,
              };
        let atomIndexById: Record<string, number> = {};
        let atomIdByMapNumber: Record<string, string> = {};
        const chemicalTextEntries = textBoxes.map((textBox) => {
          const chemicalState = evaluateTextBoxChemicalState(
            textBox.runs,
            textBox.semanticMode ?? 'auto',
            {
              validateSmiles: aliasValidator,
            },
          );
          const chemicalMetadata =
            (textBox.semanticMode ?? 'auto') === 'plain'
              ? null
              : (textBox.chemicalMetadata ?? chemicalState.metadata);
          if (!chemicalState.formula || chemicalState.formula.includes('\n')) {
            return {
              id: textBox.id,
              intent: false,
            };
          }

          if (!chemicalState.intent || !chemicalMetadata?.intent) {
            return {
              id: textBox.id,
              intent: false,
            };
          }

          if (!chemicalMetadata.chemistryAvailable || !chemicalMetadata.smiles) {
            return {
              id: textBox.id,
              intent: true,
              chemistryAvailable: false,
              fallbackGeometryAvailable: false,
              message:
                chemicalMetadata.message ??
                'Chemistry-backed features are unavailable for this text box.',
            };
          }

          const structure = resolveChemicalInput(rdkit, chemicalMetadata.smiles, aliasValidator);
          if (!structure) {
            return {
              id: textBox.id,
              intent: true,
              chemistryAvailable: false,
              fallbackGeometryAvailable: false,
              message:
                chemicalMetadata.message ??
                'Chemistry-backed features are unavailable for this text box.',
            };
          }

          return {
            id: textBox.id,
            intent: true,
            chemistryAvailable: true,
            fallbackGeometryAvailable: Boolean(structure.molblock),
            smiles: structure.smiles,
            molblock: structure.molblock,
            message: null,
          };
        });

        const selectedChemicalText = Array.from(selectedTextBoxIds)
          .map((id) => chemicalTextEntries.find((entry) => entry.id === id))
          .find((entry) => entry?.intent);

        if (selectedChemicalText?.intent) {
          if (selectedChemicalText.chemistryAvailable) {
            ovSmiles = selectedChemicalText.smiles ?? '';
            ovMolblock = selectedChemicalText.molblock ?? '';
            ovStatus = {
              kind: 'valid',
              chemistryAvailable: true,
              fallbackGeometryAvailable: selectedChemicalText.fallbackGeometryAvailable ?? true,
              message: null,
            };
            if (!isInputFocused) setEditableSmiles(ovSmiles);
          } else {
            ovSmiles = '';
            ovMolblock = '';
            ovStatus = {
              kind: 'display-only',
              chemistryAvailable: false,
              fallbackGeometryAvailable: selectedChemicalText.fallbackGeometryAvailable ?? false,
              message:
                selectedChemicalText.message ??
                'Chemistry-backed features are unavailable for this text box.',
            };
          }
        } else if (cached.comps.length > 0) {
          let target: Set<string> | null = null;
          if (selIds.size > 0) {
            const fid = Array.from(selIds)[0];
            target = cached.comps.find((c) => c.has(fid)) ?? null;
          }
          if (!target && lastInteractedAtomId)
            target = cached.comps.find((c) => c.has(lastInteractedAtomId)) ?? null;
          if (!target) target = cached.comps[0];
          if (target) {
            const vA = atoms.filter((a) => target.has(a.id));
            const entry =
              cached.componentEntries.find((component) => component.atomIds === target) ??
              cached.componentEntries.find((component) =>
                Array.from(component.atomIds).every((id) => target.has(id)),
              );
            const prefersSmilesGeometry = entry?.prefersSmilesGeometry ?? false;
            ovMolblock = entry?.molblock ?? '';
            ovGeometrySmiles = prefersSmilesGeometry
              ? (entry?.geometrySmiles ?? entry?.smiles ?? '')
              : '';
            ovGeometryMolblock = !prefersSmilesGeometry ? (entry?.geometryMolblock ?? '') : '';
            const usesMappedGeometry = prefersSmilesGeometry || Boolean(ovGeometryMolblock);
            atomIndexById = usesMappedGeometry
              ? {}
              : Object.fromEntries(vA.map((atom, index) => [atom.id, index]));
            atomIdByMapNumber = usesMappedGeometry ? (entry?.atomIdByMapNumber ?? {}) : {};
            if (entry?.chemistryAvailable) {
              ovSmiles = entry.smilesAvailable ? entry.smiles : '';
              ovStatus = {
                kind: 'valid',
                chemistryAvailable: true,
                fallbackGeometryAvailable: true,
                message: null,
              };
            } else {
              ovSmiles = '';
              ovStatus = {
                kind: 'display-only',
                chemistryAvailable: false,
                fallbackGeometryAvailable: entry?.fallbackGeometryAvailable ?? false,
                message:
                  entry?.message ?? 'Chemistry-backed features are unavailable for this structure',
              };
            }
          }
        } else {
          const fallbackChemicalText = chemicalTextEntries.find((entry) => entry.intent);
          if (fallbackChemicalText?.chemistryAvailable) {
            ovSmiles = fallbackChemicalText.smiles ?? '';
            ovMolblock = fallbackChemicalText.molblock ?? '';
            ovStatus = {
              kind: 'valid',
              chemistryAvailable: true,
              fallbackGeometryAvailable: fallbackChemicalText.fallbackGeometryAvailable ?? true,
              message: null,
            };
            if (!isInputFocused) setEditableSmiles(ovSmiles);
          } else if (fallbackChemicalText?.intent) {
            ovSmiles = '';
            ovGeometrySmiles = '';
            ovGeometryMolblock = '';
            ovStatus = {
              kind: 'display-only',
              chemistryAvailable: false,
              fallbackGeometryAvailable: fallbackChemicalText.fallbackGeometryAvailable ?? false,
              message:
                fallbackChemicalText.message ??
                'Chemistry-backed features are unavailable for this text box.',
            };
          } else {
            ovSmiles = '';
            ovGeometrySmiles = '';
            ovGeometryMolblock = '';
            ovStatus = {
              kind: 'empty',
              chemistryAvailable: false,
              fallbackGeometryAvailable: false,
              message: null,
            };
          }
        }

        setViewerSmiles(ovSmiles);
        setViewerGeometrySmiles(ovGeometrySmiles);
        setViewerGeometryMolblock(ovGeometryMolblock);
        setViewerMolblock(ovMolblock);
        setViewerStructureStatus(ovStatus);
        setViewerAtomIndexById(atomIndexById);
        setViewerAtomIdByMapNumber(atomIdByMapNumber);
      },
      largeDocumentMode ? 500 : 200,
    );
    return () => clearTimeout(timer);
  }, [
    aliasValidator,
    atoms,
    bonds,
    bondTool.isDragging,
    bondTool.activeAtomIsNew,
    rdkit,
    width,
    height,
    resolveAliasEntry,
    resolveAliasForAtom,
    interactionRevision,
    largeDocumentMode,
    selectedAtomIds,
    selectedTextBoxIds,
    setViewerSmiles,
    setViewerGeometrySmiles,
    setViewerGeometryMolblock,
    setViewerMolblock,
    setViewerStructureStatus,
    setViewerAtomIndexById,
    setViewerAtomIdByMapNumber,
    setEditableSmiles,
    textBoxes,
  ]);

  // Hit detection helpers
  const getRelativePointerPosition = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pointer = stage.getPointerPosition();
    if (!pointer) return { x: 0, y: 0 };
    return { x: (pointer.x - stagePos.x) / stageScale, y: (pointer.y - stagePos.y) / stageScale };
  };
  const getCanvasHitAt = useCallback(
    (x: number, y: number) => {
      const hit = hitTestDocumentScene(documentScene, { x, y }, { stageScale });
      return {
        atom: hit?.atomId ? (atomById.get(hit.atomId) ?? null) : null,
        bond: hit?.bondId ? (bondById.get(hit.bondId) ?? null) : null,
        arrow: hit?.arrowId ? (arrowById.get(hit.arrowId) ?? null) : null,
        textBox: hit?.textBoxId ? (textBoxById.get(hit.textBoxId) ?? null) : null,
        nativeObjectId: hit?.nativeObjectId ?? null,
      };
    },
    [arrowById, atomById, bondById, documentScene, stageScale, textBoxById],
  );

  const getSelectionPts = () => {
    const movedAtomIds = new Set(selectedAtomIds);
    selectedBondIds.forEach((bondId) => {
      const bond = sceneBonds.find((entry) => entry.id === bondId);
      if (!bond) return;
      movedAtomIds.add(bond.from);
      movedAtomIds.add(bond.to);
    });
    const selAtoms = sceneAtoms.filter((a) => movedAtomIds.has(a.id));
    const selArrows = sceneArrows.filter((a) => selectedArrowIds.has(a.id));
    const selTBs = sceneTextBoxes.filter((t) => selectedTextBoxIds.has(t.id));
    const selNativeBounds = [
      ...nativeBrackets
        .filter((object) => selectedObjectIds.has(object.id))
        .map((object) => object.bounds),
      ...nativeGraphics
        .filter((object) => selectedObjectIds.has(object.id))
        .map(
          (object) =>
            object.bounds ??
            (object.points?.length
              ? {
                  left: Math.min(...object.points.map((point) => point.x)),
                  top: Math.min(...object.points.map((point) => point.y)),
                  right: Math.max(...object.points.map((point) => point.x)),
                  bottom: Math.max(...object.points.map((point) => point.y)),
                }
              : null),
        )
        .filter((bounds): bounds is { left: number; top: number; right: number; bottom: number } =>
          Boolean(bounds),
        ),
    ];
    const points = [
      ...selAtoms.map((a) => ({ x: a.x, y: a.y })),
      ...selArrows.flatMap((a) => getArrowSelectionPoints(a)),
      ...selTBs.flatMap((t) => {
        const { textW, textH, cx, cy } = getTextBoxDimensions(t);
        const rot = ((t.rotation ?? 0) * Math.PI) / 180;
        const corners: [number, number][] = [
          [-textW / 2, -textH / 2],
          [textW / 2, -textH / 2],
          [-textW / 2, textH / 2],
          [textW / 2, textH / 2],
        ];
        return corners.map(([dx, dy]) => ({
          x: cx + dx * Math.cos(rot) - dy * Math.sin(rot),
          y: cy + dx * Math.sin(rot) + dy * Math.cos(rot),
        }));
      }),
      ...selNativeBounds.flatMap((bounds) => [
        { x: bounds.left, y: bounds.top },
        { x: bounds.right, y: bounds.top },
        { x: bounds.left, y: bounds.bottom },
        { x: bounds.right, y: bounds.bottom },
      ]),
    ];
    return selectionPreviewTransform
      ? points.map((point) => transformPreviewPoint(point, selectionPreviewTransform))
      : points;
  };

  const getSelectionCenter = () => {
    const pts = getSelectionPts();
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  };

  const SCALE_PAD =
    selectedAtomIds.size > 0 || selectedBondIds.size > 0 || selectedArrowIds.size > 0 ? 20 : 2;
  const getSelectionBBox = () => {
    const pts = getSelectionPts();
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    return {
      minX: Math.min(...xs) - SCALE_PAD,
      maxX: Math.max(...xs) + SCALE_PAD,
      minY: Math.min(...ys) - SCALE_PAD,
      maxY: Math.max(...ys) + SCALE_PAD,
    };
  };

  const commitArrowLabels = useCallback(() => {
    if (!editingArrowLabels) return;
    const { id, above, below, fontSize, color } = editingArrowLabels;
    const { atoms: ka, bonds: kb, arrows: karr, groups: kg, textBoxes: ktb } = useStore.getState();
    pushToHistory({
      atoms: ka,
      bonds: kb,
      arrows: karr.map((a) =>
        a.id === id
          ? {
              ...a,
              labelAbove: above || undefined,
              label: above || undefined,
              labelBelow: below || undefined,
              labelFontSize:
                fontSize !== getDocumentCaptionFontSize(documentStyleSettings)
                  ? fontSize
                  : undefined,
              labelColor: color || undefined,
            }
          : a,
      ),
      groups: kg ?? [],
      textBoxes: ktb ?? [],
    });
    setEditingArrowLabels(null);
  }, [documentStyleSettings, editingArrowLabels, pushToHistory]);

  useEffect(() => {
    if (
      editMenusHidden ||
      editingTextBoxId ||
      editingArrowLabels ||
      atomTool.editingAtomId ||
      editingAtomLabel ||
      editingBondStyle
    )
      return;
    if (
      selectedArrowIds.size !== 1 ||
      selectedAtomIds.size > 0 ||
      selectedBondIds.size > 0 ||
      selectedTextBoxIds.size > 0
    ) {
      setEditingArrowStyle(null);
      return;
    }

    const arrowId = Array.from(selectedArrowIds)[0];
    const arrow = arrows.find((entry) => entry.id === arrowId);
    if (!arrow) {
      setEditingArrowStyle(null);
      return;
    }

    setEditingArrowStyle((prev) => ({
      id: arrow.id,
      type: arrow.type,
      color: arrow.strokeColor ?? (isDarkMode ? '#ffffff' : '#222222'),
      lineWidth: Math.max(
        1,
        arrow.lineWidth ??
          getDefaultArrowLineWidth(arrow.type, arrow.lineStyle, documentStyleSettings),
      ),
      lineStyle: arrow.lineStyle ?? 'solid',
      curveEnabled: arrowUsesControlPoint(arrow),
      ...(prev?.id === arrow.id ? prev : {}),
    }));
  }, [
    arrows,
    atomTool.editingAtomId,
    documentStyleSettings,
    editingArrowLabels,
    editingAtomLabel,
    editingArrowStyle,
    editingBondStyle,
    editMenusHidden,
    editingTextBoxId,
    isDarkMode,
    selectedArrowIds,
    selectedAtomIds,
    selectedBondIds,
    selectedTextBoxIds,
  ]);

  useEffect(() => {
    if (
      editMenusHidden ||
      editingTextBoxId ||
      editingArrowLabels ||
      atomTool.editingAtomId ||
      editingAtomLabel ||
      editingArrowStyle
    )
      return;
    if (
      selectedBondIds.size !== 1 ||
      selectedAtomIds.size > 0 ||
      selectedArrowIds.size > 0 ||
      selectedTextBoxIds.size > 0
    ) {
      setEditingBondStyle(null);
      return;
    }
    const bondId = Array.from(selectedBondIds)[0];
    const bond = bonds.find((entry) => entry.id === bondId);
    if (!bond) {
      setEditingBondStyle(null);
      return;
    }
    const nativeBond = nativeBonds.get(bond.id);
    const display =
      bond.displayStyle ??
      (nativeBond?.display &&
      ['dash', 'bold', 'wavy', 'crossed', 'dative'].includes(nativeBond.display)
        ? (nativeBond.display as BondDisplayStyle)
        : 'solid');
    setEditingBondStyle((prev) => ({
      id: bond.id,
      order: bond.order,
      color: resolveBondColor(
        bond.color ?? nativeBond?.style?.color,
        documentStyleSettings,
        isDarkMode,
      ),
      lineWidth:
        bond.lineWidth ??
        (nativeBond?.style?.lineWidth != null
          ? convertNativeToCanvas(nativeBond.style.lineWidth, documentStyleSettings)
          : bondLineWidth),
      display,
      doubleBondMode:
        bond.order === 2
          ? resolveDoubleBondMode(bond.doubleBondMode ?? nativeBond?.doubleBondMode)
          : DEFAULT_DOUBLE_BOND_MODE,
      ...(prev?.id === bond.id ? prev : {}),
    }));
  }, [
    atomTool.editingAtomId,
    bondLineWidth,
    bonds,
    documentStyleSettings,
    editingArrowLabels,
    editingAtomLabel,
    editingArrowStyle,
    editMenusHidden,
    editingTextBoxId,
    isDarkMode,
    nativeBonds,
    selectedArrowIds,
    selectedAtomIds,
    selectedBondIds,
    selectedTextBoxIds,
  ]);

  const commitArrowStyleEdit = useCallback(() => {
    if (!editingArrowStyle) return;
    const nextColor = editingArrowStyle.color || (isDarkMode ? '#ffffff' : '#222222');
    const nextLineWidth = Math.max(1, Math.min(20, editingArrowStyle.lineWidth || 2));
    const {
      atoms: ka,
      bonds: kb,
      arrows: karr,
      groups: kg,
      textBoxes: ktb,
      chemDrawDocument: nativeDocument,
    } = useStore.getState();

    if (nativeDocument) {
      const nextDocument = applyArrowStyleEdit(nativeDocument, editingArrowStyle.id, {
        color: nextColor,
        lineWidth: nextLineWidth,
        lineStyle: editingArrowStyle.lineStyle,
        curveEnabled: editingArrowStyle.curveEnabled,
      });
      commitNativeDocument(nextDocument, 'edit-arrow-style');
      setEditingArrowStyle(null);
      return;
    }

    pushToHistory({
      atoms: ka,
      bonds: kb,
      arrows: karr.map((entry) => {
        if (entry.id !== editingArrowStyle.id) return entry;
        const next =
          editingArrowStyle.curveEnabled &&
          entry.type !== 'curved' &&
          entry.type !== 'half-curved' &&
          Math.hypot(
            entry.cpx - (entry.x1 + entry.x2) / 2,
            entry.cpy - (entry.y1 + entry.y2) / 2,
          ) <= 1
            ? {
                ...entry,
                ...getDefaultArrowControlPoint(entry.x1, entry.y1, entry.x2, entry.y2),
              }
            : entry;
        return {
          ...next,
          strokeColor: nextColor,
          lineWidth: nextLineWidth,
          lineStyle: editingArrowStyle.lineStyle,
          ...(entry.type === 'curved' || entry.type === 'half-curved'
            ? {}
            : editingArrowStyle.curveEnabled
              ? { curveEnabled: true }
              : { curveEnabled: undefined }),
        };
      }),
      groups: kg ?? [],
      textBoxes: ktb ?? [],
    });
    setEditingArrowStyle(null);
  }, [commitNativeDocument, editingArrowStyle, isDarkMode, pushToHistory]);

  const commitBondStyleEdit = useCallback(() => {
    if (!editingBondStyle) return;
    const nextColor =
      editingBondStyle.color || resolveBondColor(undefined, documentStyleSettings, isDarkMode);
    const nextLineWidth = Math.max(1, Math.min(12, editingBondStyle.lineWidth || 2));
    const nextDisplay = editingBondStyle.display;
    const {
      atoms: ka,
      bonds: kb,
      arrows: karr,
      groups: kg,
      textBoxes: ktb,
      chemDrawDocument: nativeDocument,
    } = useStore.getState();
    if (nativeDocument) {
      const nextDocument = applyBondStyleEdit(nativeDocument, editingBondStyle.id, {
        color: nextColor,
        lineWidth: nextLineWidth,
        display: nextDisplay,
        doubleBondMode: editingBondStyle.order === 2 ? editingBondStyle.doubleBondMode : undefined,
      });
      commitNativeDocument(nextDocument, 'edit-bond-style');
      setEditingBondStyle(null);
      return;
    }
    pushToHistory({
      atoms: ka,
      bonds: kb.map((bond) =>
        bond.id === editingBondStyle.id
          ? {
              ...bond,
              color: nextColor,
              lineWidth: nextLineWidth,
              displayStyle: nextDisplay,
              ...(bond.order === 2
                ? { doubleBondMode: editingBondStyle.doubleBondMode }
                : { doubleBondMode: undefined }),
            }
          : bond,
      ),
      arrows: karr,
      groups: kg ?? [],
      textBoxes: ktb ?? [],
    });
    setEditingBondStyle(null);
  }, [commitNativeDocument, documentStyleSettings, editingBondStyle, isDarkMode, pushToHistory]);

  const reorderEditingBond = useCallback(
    (direction: 'front' | 'back') => {
      if (!editingBondStyle) return;
      const {
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kg,
        textBoxes: ktb,
        chemDrawDocument: nativeDocument,
      } = useStore.getState();
      const nextBonds = reorderBondStack(kb, editingBondStyle.id, direction);
      if (nextBonds === kb) return;
      if (nativeDocument) {
        const nextDocument = reorderBondObjects(nativeDocument, editingBondStyle.id, direction);
        commitNativeDocument(nextDocument, 'reorder-bond-objects');
        return;
      }
      pushToHistory({
        atoms: ka,
        bonds: nextBonds,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: ktb ?? [],
      });
    },
    [commitNativeDocument, editingBondStyle, pushToHistory],
  );

  useEffect(() => {
    if (
      editMenusHidden ||
      editingTextBoxId ||
      editingArrowLabels ||
      atomTool.editingAtomId ||
      editingArrowStyle
    )
      return;
    if (
      selectedAtomIds.size !== 1 ||
      selectedBondIds.size > 0 ||
      selectedArrowIds.size > 0 ||
      selectedTextBoxIds.size > 0
    ) {
      setEditingAtomLabel(null);
      return;
    }

    const atomId = Array.from(selectedAtomIds)[0];
    const atom = atoms.find((entry) => entry.id === atomId);
    if (!atom) {
      setEditingAtomLabel(null);
      return;
    }

    const node = nativeNodes.get(atom.id);
    const screenX = atom.x * stageScale + stagePos.x;
    const screenY = atom.y * stageScale + stagePos.y;
    const resolution = resolveAliasForAtom(atom, getAtomNodeText(atom));
    const defaultColor = resolveAtomLabelColor(
      undefined,
      getAtomLeadElement(atom),
      documentStyleSettings,
      isDarkMode,
      documentViewSettings,
    );
    const explicitColor = atom.labelColor ?? node?.style?.color;
    const labelTextStyle = resolveDocumentLabelTextStyle(documentStyleSettings, {
      authored: {
        fontFamily: atom.labelFontFamily,
        fontSize: atom.labelFontSize,
      },
      nativeStyle: node?.style,
    });
    setEditingAtomLabel((prev) => ({
      id: atom.id,
      value: getAtomNodeText(atom),
      fontFamily: labelTextStyle.fontFamily,
      fontSize: labelTextStyle.fontSize,
      color: resolveAtomLabelColor(
        explicitColor,
        getAtomLeadElement(atom),
        documentStyleSettings,
        isDarkMode,
        documentViewSettings,
      ),
      defaultColor,
      colorExplicit: Boolean(explicitColor),
      orientation: atom.labelOrientation ?? node?.labelOrientation ?? 'auto',
      resolution,
      selectedCandidateId: atom.aliasResolution?.selectedCandidateId,
      screenX,
      screenY,
      ...(prev?.id === atom.id
        ? {
            value: prev.value,
            fontFamily: prev.fontFamily,
            fontSize: prev.fontSize,
            color: prev.color,
            defaultColor,
            colorExplicit: prev.colorExplicit,
            orientation: prev.orientation,
            resolution: prev.resolution,
            selectedCandidateId: prev.selectedCandidateId,
          }
        : {}),
    }));
  }, [
    atomTool.editingAtomId,
    atoms,
    documentViewSettings,
    editingArrowLabels,
    editingArrowStyle,
    editMenusHidden,
    editingTextBoxId,
    documentStyleSettings,
    isDarkMode,
    nativeNodes,
    selectedArrowIds,
    selectedAtomIds,
    selectedBondIds,
    selectedTextBoxIds,
    stagePos.x,
    stagePos.y,
    stageScale,
    resolveAliasForAtom,
  ]);

  useEffect(() => {
    if (!editMenusHidden) return;
    setEditingAtomLabel(null);
    setEditingArrowStyle(null);
    setEditingBondStyle(null);
    setEditingArrowLabels(null);
  }, [editMenusHidden]);

  useEffect(() => {
    if (!editingAtomLabel || atomLabelPanelLayout) return;
    setAtomLabelPanelLayout(
      createDefaultEditPanelLayout(width, { width: 252, height: 368 }, 'right'),
    );
  }, [atomLabelPanelLayout, editingAtomLabel, width]);

  useEffect(() => {
    if (!editingArrowStyle || arrowStylePanelLayout) return;
    setArrowStylePanelLayout(
      createDefaultEditPanelLayout(width, { width: 226, height: 286 }, 'right'),
    );
  }, [arrowStylePanelLayout, editingArrowStyle, width]);

  useEffect(() => {
    if (!editingBondStyle || bondStylePanelLayout) return;
    setBondStylePanelLayout(
      createDefaultEditPanelLayout(width, { width: 232, height: 342 }, 'right'),
    );
  }, [bondStylePanelLayout, editingBondStyle, width]);

  useEffect(() => {
    if (!editingArrowLabels || arrowLabelsPanelLayout) return;
    setArrowLabelsPanelLayout(
      createDefaultEditPanelLayout(width, { width: 190, height: 224 }, 'right'),
    );
  }, [arrowLabelsPanelLayout, editingArrowLabels, width]);

  useEffect(() => {
    if (!editingAtomLabel) return;
    const currentAtom = atoms.find((atom) => atom.id === editingAtomLabel.id);
    const resolution = resolveAliasChemistry(editingAtomLabel.value.trim() || 'C', {
      validateSmiles: aliasValidator,
      preferredCandidateId:
        editingAtomLabel.selectedCandidateId ?? currentAtom?.aliasResolution?.selectedCandidateId,
    });
    setEditingAtomLabel((prev) =>
      prev
        ? {
            ...prev,
            resolution,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depend on sub-properties to avoid infinite update loop (effect sets editingAtomLabel)
  }, [
    aliasValidator,
    atoms,
    editingAtomLabel?.id,
    editingAtomLabel?.selectedCandidateId,
    editingAtomLabel?.value,
  ]);

  const commitAtomLabelEdit = useCallback(() => {
    if (!editingAtomLabel) return;

    const nextValue = editingAtomLabel.value.trim() || 'C';
    const nextFontFamily =
      editingAtomLabel.fontFamily.trim() || documentStyleSettings.nativeMetrics.labelFontFamily;
    const nextFontSize = Math.max(
      6,
      Math.min(72, editingAtomLabel.fontSize || DEFAULT_ATOM_LABEL_FONT_SIZE),
    );
    const {
      atoms: ka,
      bonds: kb,
      arrows: karr,
      groups: kg,
      textBoxes: ktb,
      chemDrawDocument: nativeDocument,
    } = useStore.getState();
    const currentAtom = ka.find((atom) => atom.id === editingAtomLabel.id);
    const leadElement = currentAtom ? getAtomLeadElement(currentAtom) : 'C';
    const nextDefaultColor = resolveAtomLabelColor(
      undefined,
      leadElement,
      documentStyleSettings,
      isDarkMode,
      documentViewSettings,
    );
    const nextColor =
      editingAtomLabel.colorExplicit || editingAtomLabel.color !== editingAtomLabel.defaultColor
        ? editingAtomLabel.color || nextDefaultColor
        : undefined;
    const nextOrientation = editingAtomLabel.orientation;
    const nextResolution = resolveAliasChemistry(nextValue, {
      validateSmiles: aliasValidator,
      preferredCandidateId:
        editingAtomLabel.selectedCandidateId ?? currentAtom?.aliasResolution?.selectedCandidateId,
    });
    if (nextResolution.reason === 'ambiguous' && !nextResolution.selected) {
      useStore.getState().showToast('Choose one alias interpretation before applying this label.');
      setEditingAtomLabel((prev) => (prev ? { ...prev, resolution: nextResolution } : null));
      return;
    }
    const nextAliasResolution = buildAliasResolutionSnapshot(nextResolution);

    if (nativeDocument) {
      const nextDocument = applyNodeLabelStyleEdit(nativeDocument, editingAtomLabel.id, {
        value: nextValue,
        fontFamily: nextFontFamily,
        fontSize: nextFontSize,
        color: nextColor,
        labelOrientation: nextOrientation,
        aliasResolution: nextAliasResolution,
      });
      commitNativeDocument(nextDocument, 'edit-node-label-style');
      setEditingAtomLabel(null);
      return;
    }

    pushToHistory({
      atoms: ka.map((atom) => {
        if (atom.id !== editingAtomLabel.id) return atom;
        return {
          ...setAtomValue(atom, nextValue),
          labelFontFamily: nextFontFamily,
          labelFontSize: nextFontSize,
          labelColor: nextColor,
          labelOrientation: nextOrientation,
          aliasResolution: nextAliasResolution,
        };
      }),
      bonds: kb,
      arrows: karr,
      groups: kg ?? [],
      textBoxes: ktb ?? [],
    });
    setEditingAtomLabel(null);
  }, [
    aliasValidator,
    commitNativeDocument,
    documentStyleSettings,
    documentViewSettings,
    editingAtomLabel,
    isDarkMode,
    pushToHistory,
  ]);

  const handleTextEditBlur = useCallback(() => {
    if (ignoreNextBlurRef.current) {
      ignoreNextBlurRef.current = false;
      return;
    }
    if (!editingTextBoxId || !editOverlayRef.current) return;
    const { atoms: ka, bonds: kb, arrows: karr, groups: kg, textBoxes: ktb } = useStore.getState();
    const existingTextBox = (ktb ?? []).find((textBox) => textBox.id === editingTextBoxId);
    const semanticMode = existingTextBox?.semanticMode ?? 'auto';
    const chemistry = evaluateTextBoxChemicalState(
      extractRunsFromDOM(editOverlayRef.current),
      semanticMode,
      { validateSmiles: aliasValidator },
    );
    const runs = chemistry.normalizedRuns;
    if (runs.length === 0 || runs.every((r) => !r.text.trim())) {
      pushToHistory({
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: (ktb ?? []).filter((t) => t.id !== editingTextBoxId),
      });
    } else {
      pushToHistory({
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: (ktb ?? []).map((t) => {
          if (t.id !== editingTextBoxId) return t;
          const next = {
            ...t,
            runs,
            semanticMode,
            conversionStatus: chemistry.conversionStatus,
          };
          if (chemistry.metadata) return { ...next, chemicalMetadata: chemistry.metadata };
          const withoutChemicalMetadata = { ...next };
          delete withoutChemicalMetadata.chemicalMetadata;
          return withoutChemicalMetadata;
        }),
      });
    }
    setEditingTextBoxId(null);
  }, [aliasValidator, editingTextBoxId, pushToHistory]);

  const handleTextEditPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    insertPlainTextIntoEditable(event.currentTarget, event.clipboardData.getData('text/plain'));
  }, []);

  // placeFragmentAt — used by fragment tool and keyboard shortcuts
  const placeFragmentAt = useCallback(
    (
      smiles: string,
      pos: { x: number; y: number },
      hitAtom?: Atom,
      hitBond?: Bond,
      preferInterior = false,
    ) => {
      if (!rdkit) return;
      const mol = rdkit.get_mol(smiles);
      if (!mol) return;
      mol.set_new_coords?.();
      const molblock = mol.get_molblock?.();
      mol.delete();
      if (!molblock) return;
      const parsedFragment = parseMolblockGeometry(molblock, 1);
      if (!parsedFragment?.atoms.length) return;
      const normalizedFragment = normalizeMolblockBondLength(
        parsedFragment,
        documentStyleSettings.bondLength,
      );
      const fragAtoms = normalizedFragment.atoms;
      const fragBonds = normalizedFragment.bonds;

      const {
        atoms: stAtoms,
        bonds: stBonds,
        arrows: stArrows,
        groups: stGroups,
        textBoxes: stTextBoxes,
      } = useStore.getState();
      let rotationAngle = 0,
        translation = { x: pos.x, y: pos.y },
        mapAtom0 = -1,
        mapAtom1 = -1,
        mappedId0 = '',
        mappedId1 = '';

      if (hitBond && fragAtoms.length >= 2 && fragBonds.length > 0) {
        const atom1 = stAtoms.find((a) => a.id === hitBond.from)!,
          atom2 = stAtoms.find((a) => a.id === hitBond.to)!;
        const neighbors = stBonds.filter(
          (b) =>
            (b.from === atom1.id ||
              b.to === atom1.id ||
              b.from === atom2.id ||
              b.to === atom2.id) &&
            b.id !== hitBond.id,
        );
        let occX = 0,
          occY = 0;
        neighbors.forEach((nb) => {
          const oId = nb.from === atom1.id || nb.from === atom2.id ? nb.to : nb.from;
          const o = stAtoms.find((a) => a.id === oId);
          if (o) {
            occX += o.x - (atom1.x + atom2.x) / 2;
            occY += o.y - (atom1.y + atom2.y) / 2;
          }
        });
        const scoreMapping = (aA: Atom, aB: Atom) => {
          const tA = Math.atan2(aB.y - aA.y, aB.x - aA.x),
            fA = Math.atan2(fragAtoms[1].y - fragAtoms[0].y, fragAtoms[1].x - fragAtoms[0].x),
            rot = tA - fA;
          let cX = 0,
            cY = 0;
          for (let i = 0; i < fragAtoms.length; i++) {
            const rx = fragAtoms[i].x * Math.cos(rot) - fragAtoms[i].y * Math.sin(rot),
              ry = fragAtoms[i].x * Math.sin(rot) + fragAtoms[i].y * Math.cos(rot);
            cX += rx;
            cY += ry;
          }
          cX /= fragAtoms.length;
          cY /= fragAtoms.length;
          const trX = aA.x - (fragAtoms[0].x * Math.cos(rot) - fragAtoms[0].y * Math.sin(rot)),
            trY = aA.y - (fragAtoms[0].x * Math.sin(rot) + fragAtoms[0].y * Math.cos(rot));
          return {
            rot,
            score:
              (cX + trX - (atom1.x + atom2.x) / 2) * -occX +
              (cY + trY - (atom1.y + atom2.y) / 2) * -occY,
            trX,
            trY,
          };
        };
        const s1 = scoreMapping(atom1, atom2),
          s2 = scoreMapping(atom2, atom1);
        if (s2.score > s1.score) {
          rotationAngle = s2.rot;
          translation = { x: s2.trX, y: s2.trY };
          mappedId0 = atom2.id;
          mappedId1 = atom1.id;
        } else {
          rotationAngle = s1.rot;
          translation = { x: s1.trX, y: s1.trY };
          mappedId0 = atom1.id;
          mappedId1 = atom2.id;
        }
        mapAtom0 = 0;
        mapAtom1 = 1;
      } else if (hitAtom) {
        const bestAngle = getPreferredAttachmentAngle(hitAtom, stAtoms, stBonds, preferInterior);
        let fSin = 0,
          fCos = 0;
        for (let i = 1; i < fragAtoms.length; i++) {
          const a = Math.atan2(fragAtoms[i].y - fragAtoms[0].y, fragAtoms[i].x - fragAtoms[0].x);
          fSin += Math.sin(a);
          fCos += Math.cos(a);
        }
        const fragAngle = fragAtoms.length > 1 ? Math.atan2(fSin, fCos) : 0;
        rotationAngle = bestAngle - fragAngle;
        translation = {
          x:
            hitAtom.x -
            (fragAtoms[0].x * Math.cos(rotationAngle) - fragAtoms[0].y * Math.sin(rotationAngle)),
          y:
            hitAtom.y -
            (fragAtoms[0].x * Math.sin(rotationAngle) + fragAtoms[0].y * Math.cos(rotationAngle)),
        };
        mapAtom0 = 0;
        mappedId0 = hitAtom.id;
      }

      const idMap: string[] = [],
        newAtoms: Atom[] = [];
      for (let i = 0; i < fragAtoms.length; i++) {
        if (i === mapAtom0) {
          idMap.push(mappedId0);
          continue;
        }
        if (i === mapAtom1) {
          idMap.push(mappedId1);
          continue;
        }
        const rx =
            fragAtoms[i].x * Math.cos(rotationAngle) - fragAtoms[i].y * Math.sin(rotationAngle),
          ry = fragAtoms[i].x * Math.sin(rotationAngle) + fragAtoms[i].y * Math.cos(rotationAngle);
        const nid = crypto.randomUUID();
        idMap.push(nid);
        newAtoms.push({
          id: nid,
          x: rx + translation.x,
          y: ry + translation.y,
          kind: 'element',
          element: fragAtoms[i].element,
        });
      }
      const newBonds: Bond[] = [];
      for (let i = 0; i < fragBonds.length; i++) {
        const { from: fIdx, to: tIdx, order, stereo } = fragBonds[i]!;
        if (
          hitBond &&
          ((fIdx === mapAtom0 && tIdx === mapAtom1) || (fIdx === mapAtom1 && tIdx === mapAtom0))
        )
          continue;
        newBonds.push({
          id: crypto.randomUUID(),
          from: idMap[fIdx]!,
          to: idMap[tIdx]!,
          order,
          stereo,
        });
      }
      pushToHistory({
        atoms: [...stAtoms, ...newAtoms],
        bonds: [...stBonds, ...newBonds],
        arrows: stArrows,
        groups: stGroups ?? [],
        textBoxes: stTextBoxes ?? [],
      });
    },
    [documentStyleSettings.bondLength, pushToHistory, rdkit],
  );

  const resolveRingGeometryAtPointer = useCallback(
    (
      pos: { x: number; y: number },
      hitAtom: Atom | null,
      hitBond: Bond | null,
    ): RingPlacementPreview => {
      const { atoms: currentAtoms, bonds: currentBonds } = useStore.getState();
      if (!isRingTemplatePreset(ringPreset)) {
        return {
          kind: 'polygon',
          geometry: getRegularRingGeometry(pos, bondLength, ringSize),
        };
      }
      return {
        kind: 'template',
        placement: resolveRingTemplatePlacement({
          preset: ringPreset,
          bondLength,
          center: pos,
          pointer: pos,
          existingAtoms: currentAtoms,
          existingBonds: currentBonds,
          hitAtom: hitAtom ?? undefined,
          hitBond: hitBond ?? undefined,
          rotationSteps: ringRotationSteps,
        }),
      };
    },
    [bondLength, ringPreset, ringRotationSteps, ringSize],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifiers = syncModifierKeys(e);
      const shortcutsBlocked = shouldIgnoreKeyboardShortcuts(e.target, document.activeElement);
      if (useStore.getState().isInputFocused !== shortcutsBlocked) {
        useStore.getState().setIsInputFocused(shortcutsBlocked);
      }
      if (shortcutsBlocked) return;

      const isEditingAtom = atomTool.editingAtomId !== null;
      const isEditingTextBox = editingTextBoxId !== null;
      const isEditingArrow = editingArrowLabels !== null;
      const isEditingAtomLabel = editingAtomLabel !== null;
      const isEditingBondStyle = editingBondStyle !== null;
      const isEditingArrowStyle = editingArrowStyle !== null;
      if (
        isEditingAtom ||
        isEditingTextBox ||
        isEditingArrow ||
        isEditingAtomLabel ||
        isEditingBondStyle ||
        isEditingArrowStyle
      )
        return;

      const {
        atoms: kAtoms,
        bonds: kBonds,
        arrows: kArrows,
        groups: kGroups,
        textBoxes: kTextBoxes,
        selectedAtomIds: kSel,
        selectedBondIds: kSelBond,
        selectedArrowIds: kSelArr,
        selectedTextBoxIds: kSelTB,
        pushToHistory: kPush,
        appPreferences: currentPreferences,
      } = useStore.getState();
      const matches = (shortcutId: string) =>
        eventMatchesShortcut(e, getShortcutBinding(currentPreferences.keybindings, shortcutId));

      // Space → select connected component (hover), or deselect + select mode (empty)
      if (matches('canvas.selection.component')) {
        e.preventDefault();
        if (hoveredAtomId || hoveredBondId) {
          if (hoveredBondId && !hoveredAtomId) {
            if (modifiers.shift) {
              const n = new Set(kSelBond);
              if (n.has(hoveredBondId)) n.delete(hoveredBondId);
              else n.add(hoveredBondId);
              setSelectedBondIds(n);
            } else {
              setSelectedBondIds(new Set([hoveredBondId]));
              setSelectedAtomIds(new Set());
              setSelectedArrowIds(new Set());
              setSelectedTextBoxIds(new Set());
            }
          } else {
            const startId =
              hoveredAtomId ??
              (hoveredBondId ? kBonds.find((b) => b.id === hoveredBondId)?.from : null);
            if (startId) {
              const comps = getConnectedComponents(kAtoms, kBonds),
                target = comps.find((c) => c.has(startId));
              if (target) {
                if (modifiers.shift) {
                  const s = new Set(kSel);
                  target.forEach((id) => s.add(id));
                  setSelectedAtomIds(s);
                } else {
                  setSelectedAtomIds(new Set(target));
                  setSelectedBondIds(new Set());
                  setSelectedArrowIds(new Set());
                  setSelectedTextBoxIds(new Set());
                }
              }
            }
          }
        } else if (hoveredArrowId) {
          if (modifiers.shift) {
            const n = new Set(kSelArr);
            if (n.has(hoveredArrowId)) n.delete(hoveredArrowId);
            else n.add(hoveredArrowId);
            setSelectedArrowIds(n);
          } else {
            setSelectedArrowIds(new Set([hoveredArrowId]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedTextBoxIds(new Set());
          }
        } else if (hoveredTextBoxId) {
          if (modifiers.shift) {
            const n = new Set(kSelTB);
            if (n.has(hoveredTextBoxId)) n.delete(hoveredTextBoxId);
            else n.add(hoveredTextBoxId);
            setSelectedTextBoxIds(n);
          } else {
            setSelectedTextBoxIds(new Set([hoveredTextBoxId]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedArrowIds(new Set());
          }
        } else {
          useStore.getState().deselectAll();
          useStore.getState().setTool('select');
        }
        return;
      }

      // Enter → edit hovered atom
      if (matches('canvas.atom.edit') && hoveredAtomId) {
        const atom = kAtoms.find((a) => a.id === hoveredAtomId);
        if (atom) {
          atomTool.openEditor(atom.id, getAtomNodeText(atom));
        }
        return;
      }

      // Escape → close arrow label editor
      if (e.key === 'Escape') {
        setEditingArrowLabels(null);
        setEditingTextBoxId(null);
        setEditingAtomLabel(null);
        setEditingBondStyle(null);
        setEditingArrowStyle(null);
        return;
      }

      const atomShortcutEntry = Object.entries(ATOM_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.atom.${key}`),
      );
      const bondShortcutEntry = Object.entries(BOND_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.bond.${key}`),
      );
      const fragmentShortcutEntry = Object.entries(ATOM_FRAGMENT_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.fragment.${key}`),
      );
      const hE = atomShortcutEntry?.[1];
      const hB = bondShortcutEntry?.[1];
      const hAF = fragmentShortcutEntry?.[1];

      if (hoveredAtomId) {
        const atom = kAtoms.find((a) => a.id === hoveredAtomId);
        if (atom) {
          const atomFV = getAtomFreeValence(atom, kBonds);

          // Stereo bond shortcuts — only if atom has room for one more bond
          if (matches('canvas.stereo.wedge') || matches('canvas.stereo.hash')) {
            if (atomFV >= 1) {
              const angle = getPreferredAttachmentAngle(atom, kAtoms, kBonds, false);
              const nid = crypto.randomUUID();
              kPush({
                atoms: [
                  ...kAtoms,
                  {
                    id: nid,
                    x: atom.x + Math.cos(angle) * bondLength,
                    y: atom.y + Math.sin(angle) * bondLength,
                    kind: 'element',
                    element: 'C',
                  },
                ],
                bonds: [
                  ...kBonds,
                  {
                    id: crypto.randomUUID(),
                    from: atom.id,
                    to: nid,
                    order: 1,
                    stereo: matches('canvas.stereo.wedge') ? 1 : 6,
                  },
                ],
                arrows: kArrows,
                groups: kGroups ?? [],
                textBoxes: kTextBoxes ?? [],
              });
            }
            return;
          }

          // Fragment shortcuts — use ChemDraw-style smart SMILES based on free valence
          if (hAF) {
            const fragmentShortcutKey = fragmentShortcutEntry?.[0];
            const options = fragmentShortcutKey
              ? ATOM_FRAGMENT_OPTIONS[fragmentShortcutKey]
              : undefined;
            let smiles: string | null;
            if (options) {
              const match = options.find((o) => atomFV >= o.minFV);
              smiles = match ? match.smiles : null;
            } else {
              const minFV = fragmentShortcutKey ? (FRAGMENT_MIN_FV[fragmentShortcutKey] ?? 1) : 1;
              smiles = atomFV >= minFV ? hAF : null;
            }
            if (smiles) placeFragmentAt(smiles, { x: 0, y: 0 }, atom);
            return;
          }

          if (hE) {
            setLastInteractedAtomId(hoveredAtomId);
            if (useStore.getState().chemDrawDocument) {
              const nextDocument = applyNodeValueEdit(
                useStore.getState().chemDrawDocument!,
                hoveredAtomId,
                hE,
              );
              commitNativeDocument(nextDocument, 'edit-node-value');
            } else {
              kPush({
                atoms: kAtoms.map((a) => (a.id === hoveredAtomId ? { ...a, element: hE } : a)),
                bonds: kBonds,
                arrows: kArrows,
                groups: kGroups ?? [],
                textBoxes: kTextBoxes ?? [],
              });
            }
            return;
          }
        }
      }

      if (hB && hoveredBondId) {
        if (hB.ring) {
          const b = kBonds.find((x) => x.id === hoveredBondId);
          if (b) placeFragmentAt(hB.ring, { x: 0, y: 0 }, undefined, b);
        } else if (hB.order !== undefined) {
          const b = kBonds.find((x) => x.id === hoveredBondId);
          const nativeDocument = useStore.getState().chemDrawDocument;
          if (nativeDocument) {
            const nextDocument =
              b && b.stereo === hB.stereo && hB.stereo !== 0
                ? reverseBondDirection(nativeDocument, hoveredBondId)
                : applyBondEdit(nativeDocument, hoveredBondId, {
                    order: hB.order,
                    stereo: hB.stereo || 0,
                    ...(hB.order === 2 && (hB.stereo || 0) === 0
                      ? { doubleBondMode: getNextDoubleBondToolMode(b) }
                      : {}),
                  });
            commitNativeDocument(nextDocument, 'edit-bond');
          } else if (b && b.stereo === hB.stereo && hB.stereo !== 0) {
            kPush({
              atoms: kAtoms,
              bonds: kBonds.map((x) =>
                x.id === hoveredBondId ? { ...x, from: x.to, to: x.from } : x,
              ),
              arrows: kArrows,
              groups: kGroups ?? [],
              textBoxes: kTextBoxes ?? [],
            });
          } else {
            kPush({
              atoms: kAtoms,
              bonds: kBonds.map((x) =>
                x.id === hoveredBondId
                  ? {
                      ...x,
                      order: hB.order!,
                      stereo: hB.stereo || 0,
                      ...(hB.order === 2 && (hB.stereo || 0) === 0
                        ? { doubleBondMode: getNextDoubleBondToolMode(x) }
                        : { doubleBondMode: undefined }),
                    }
                  : x,
              ),
              arrows: kArrows,
              groups: kGroups ?? [],
              textBoxes: kTextBoxes ?? [],
            });
          }
        }
        return;
      }

      const hasHoveredObject = Boolean(
        hoveredAtomId ||
        hoveredBondId ||
        hoveredArrowId ||
        hoveredTextBoxId ||
        hoveredNativeObjectId,
      );
      const toolShortcut = getCanvasToolShortcut(currentPreferences.keybindings, e, {
        hasHoveredObject,
      });
      if (toolShortcut) {
        e.preventDefault();
        useStore.getState().setTool(toolShortcut.tool);
        if (toolShortcut.selectedFragment) {
          useStore.getState().setSelectedFragment(toolShortcut.selectedFragment);
        }
        return;
      }

      // Delete / Backspace
      if (matches('canvas.delete') || matches('canvas.delete.backspace')) {
        if (kSel.size > 0 || kSelBond.size > 0 || kSelArr.size > 0 || kSelTB.size > 0) {
          const nativeDocument = useStore.getState().chemDrawDocument;
          if (nativeDocument) {
            useStore.getState().dispatchEditorCommand(
              createDeleteSelectionCommand({
                objectIds: useStore.getState().selectedObjectIds,
                description: 'delete-selected-objects',
              }),
            );
          } else {
            kPush({
              atoms: kAtoms.filter((a) => !kSel.has(a.id)),
              bonds: kBonds.filter(
                (b) => !kSelBond.has(b.id) && !kSel.has(b.from) && !kSel.has(b.to),
              ),
              arrows: kArrows.filter((a) => !kSelArr.has(a.id)),
              groups: kGroups ?? [],
              textBoxes: (kTextBoxes ?? []).filter((t) => !kSelTB.has(t.id)),
            });
          }
          setSelectedAtomIds(new Set());
          setSelectedBondIds(new Set());
          setSelectedArrowIds(new Set());
          setSelectedTextBoxIds(new Set());
        } else if (hoveredAtomId) {
          kPush({
            atoms: kAtoms.filter((a) => a.id !== hoveredAtomId),
            bonds: kBonds.filter((b) => b.from !== hoveredAtomId && b.to !== hoveredAtomId),
            arrows: kArrows,
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        } else if (hoveredBondId) {
          kPush({
            atoms: kAtoms,
            bonds: kBonds.filter((b) => b.id !== hoveredBondId),
            arrows: kArrows,
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        } else if (hoveredArrowId) {
          kPush({
            atoms: kAtoms,
            bonds: kBonds,
            arrows: kArrows.filter((a) => a.id !== hoveredArrowId),
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      syncModifierKeys(e);
    };
    const clearModifierKeys = () => {
      setIsCtrlDown(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clearModifierKeys();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearModifierKeys);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearModifierKeys);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hoveredAtomId,
    hoveredBondId,
    hoveredArrowId,
    hoveredTextBoxId,
    hoveredNativeObjectId,
    placeFragmentAt,
    atomTool.editingAtomId,
    editingTextBoxId,
    editingArrowLabels,
    editingAtomLabel,
    editingArrowStyle,
    editingBondStyle,
    setLastInteractedAtomId,
    setSelectedAtomIds,
    setSelectedArrowIds,
    setSelectedTextBoxIds,
    syncModifierKeys,
  ]);

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const modifiers = syncModifierKeys(e.evt);
    if (
      atomTool.editingAtomId ||
      editingTextBoxId ||
      e.evt.button === 1 ||
      modifiers.primary ||
      tool === 'pan'
    )
      return;
    // Close arrow label editor on canvas click
    if (editingArrowLabels) {
      commitArrowLabels();
      return;
    }
    if (editingAtomLabel) {
      commitAtomLabelEdit();
      return;
    }
    if (editingBondStyle) {
      commitBondStyleEdit();
      return;
    }
    if (editingArrowStyle) {
      commitArrowStyleEdit();
      return;
    }
    markInteractionActive();
    const pos = getRelativePointerPosition();
    const hit = getCanvasHitAt(pos.x, pos.y);
    const hitA = hit.atom;
    const hitB = !hitA ? hit.bond : null;
    const hitArr = !hitA && !hitB ? hit.arrow : null;
    const hitTB = !hitA && !hitB && !hitArr ? hit.textBox : null;
    const hitNative = !hitA && !hitB && !hitArr && !hitTB ? hit.nativeObjectId : null;

    if (hitA) setLastInteractedAtomId(hitA.id);

    // Cross-tool: drag selected atoms/bonds
    const {
      chemDrawDocument: nativeDocument,
      selectedAtomIds: selIds,
      selectedBondIds: selBondIds,
      selectedObjectIds: selObjectIds,
      bonds: selectedBonds,
    } = useStore.getState();
    if (hitA && selIds.has(hitA.id) && !modifiers.shift && tool !== 'eraser') {
      const movedAtomIds = collectPreviewMovedAtomIds(selIds, selBondIds, selectedBonds);
      selectionDragRef.current = {
        isDragging: true,
        startPos: pos,
        sourceDocument: nativeDocument,
        totalDx: 0,
        totalDy: 0,
        selectedObjectIds: new Set(selObjectIds),
        movedAtomIds,
        affectedBondIds: collectPreviewAffectedBondIds(movedAtomIds, selectedBonds),
      };
      return;
    }
    if (
      hitB &&
      (selBondIds.has(hitB.id) || (selIds.has(hitB.from) && selIds.has(hitB.to))) &&
      !modifiers.shift &&
      tool !== 'eraser'
    ) {
      const movedAtomIds = collectPreviewMovedAtomIds(selIds, selBondIds, selectedBonds);
      selectionDragRef.current = {
        isDragging: true,
        startPos: pos,
        sourceDocument: nativeDocument,
        totalDx: 0,
        totalDy: 0,
        selectedObjectIds: new Set(selObjectIds),
        movedAtomIds,
        affectedBondIds: collectPreviewAffectedBondIds(movedAtomIds, selectedBonds),
      };
      return;
    }

    if (tool === 'arrow') {
      // Click existing arrow → reverse it (keep cpx/cpy so curved arrows don't flip)
      if (hitArr) {
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        pushToHistory({
          atoms: ka,
          bonds: kb,
          arrows: karr.map((a) =>
            a.id === hitArr.id ? { ...a, x1: a.x2, y1: a.y2, x2: a.x1, y2: a.y1 } : a,
          ),
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
        return;
      }
      setArrowPreview({
        id: 'preview',
        type: arrowType,
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
        cpx: pos.x,
        cpy: pos.y,
      });
      return;
    }

    if (tool === 'text') {
      if (hitA) {
        atomTool.openEditor(hitA.id, getAtomNodeText(hitA));
        setSelectedAtomIds(new Set([hitA.id]));
        setSelectedBondIds(new Set());
        setSelectedArrowIds(new Set());
        setSelectedTextBoxIds(new Set());
        return;
      }
      if (hitTB) {
        // Don't enter edit mode immediately — wait to distinguish click from drag
        textToolDragRef.current = {
          textBoxId: hitTB.id,
          startPos: { x: pos.x, y: pos.y },
          lastPos: { x: pos.x, y: pos.y },
          hasMoved: false,
        };
        setSelectedTextBoxIds(new Set([hitTB.id]));
        setSelectedAtomIds(new Set());
        setSelectedArrowIds(new Set());
      } else {
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        const newTB: TextBox = {
          id: crypto.randomUUID(),
          x: pos.x,
          y: pos.y,
          runs: [],
          fontSize: textFormat.fontSize,
          fontFamily: textFormat.fontFamily,
          color: isDarkMode ? '#ffffff' : textFormat.color,
          textAlign: textFormat.textAlign,
          semanticMode: 'auto',
          conversionStatus: 'plain',
        };
        pushToHistory({
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg ?? [],
          textBoxes: [...(ktb ?? []), newTB],
        });
        setEditingTextBoxId(newTB.id);
        setSelectedTextBoxIds(new Set([newTB.id]));
      }
      return;
    }

    if (tool === 'select') {
      const bbox = getSelectionBBox();
      let hitScale = null;
      if (bbox) {
        const corners = [
          { key: 'tl' as const, x: bbox.minX, y: bbox.minY, ax: bbox.maxX, ay: bbox.maxY },
          { key: 'tr' as const, x: bbox.maxX, y: bbox.minY, ax: bbox.minX, ay: bbox.maxY },
          { key: 'bl' as const, x: bbox.minX, y: bbox.maxY, ax: bbox.maxX, ay: bbox.minY },
          { key: 'br' as const, x: bbox.maxX, y: bbox.maxY, ax: bbox.minX, ay: bbox.minY },
        ];
        const hit = corners.find((c) => Math.hypot(pos.x - c.x, pos.y - c.y) < 10);
        if (hit) hitScale = { anchorX: hit.ax, anchorY: hit.ay };
      }
      const selCtr = getSelectionCenter();
      const rotHandlePos = selCtr && bbox ? { x: selCtr.x, y: bbox.minY - 30 } : selCtr;
      selectTool.onMouseDown(
        pos,
        hitA,
        hitB,
        hitArr,
        modifiers.shift,
        rotHandlePos,
        hitTB,
        hitScale,
        hitNative,
      );
      return;
    }
    if (tool === 'fragment' && selectedFragment) {
      placeFragmentAt(selectedFragment, pos, hitA ?? undefined, hitB ?? undefined);
      return;
    }
    if (tool === 'charge' && hitA) {
      const result = applyElectronToolToAtom(hitA, bonds, electronToolMode);
      if (!result.changed) {
        if (result.message) useStore.getState().showToast(result.message, 'info');
        return;
      }
      const nA = atoms.map((a) => (a.id === hitA.id ? result.atom : a));
      const { groups: kg, textBoxes: ktb } = useStore.getState();
      pushToHistory({ atoms: nA, bonds, arrows, groups: kg ?? [], textBoxes: ktb ?? [] });
      return;
    }
    if (tool === 'eraser') {
      const { groups: kg, textBoxes: ktb } = useStore.getState();
      if (hitA)
        pushToHistory({
          atoms: atoms.filter((a) => a.id !== hitA.id),
          bonds: bonds.filter((b) => b.from !== hitA.id && b.to !== hitA.id),
          arrows,
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else if (hitB)
        pushToHistory({
          atoms,
          bonds: bonds.filter((b) => b.id !== hitB.id),
          arrows,
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else if (hitArr)
        pushToHistory({
          atoms,
          bonds,
          arrows: arrows.filter((a) => a.id !== hitArr.id),
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else {
        if (hitTB)
          pushToHistory({
            atoms,
            bonds,
            arrows,
            groups: kg ?? [],
            textBoxes: (ktb ?? []).filter((t) => t.id !== hitTB.id),
          });
        else if (hitNative && useStore.getState().chemDrawDocument) {
          useStore.getState().dispatchEditorCommand(
            createDeleteSelectionCommand({
              objectIds: new Set([hitNative]),
              description: 'delete-selected-objects',
            }),
          );
        }
      }
      return;
    }
    if (tool === 'ring') {
      const { atoms: ka, bonds: kb, groups: kg, textBoxes: ktb } = useStore.getState();
      const previewPlacement = resolveRingGeometryAtPointer(pos, hitA, hitB);
      const { atoms: nextAtoms, bonds: nextBonds } =
        previewPlacement.kind === 'template'
          ? materializeResolvedRingTemplatePlacement(previewPlacement.placement, ka, kb)
          : (() => {
              const { atoms: rAtoms, bonds: rBonds } = materializeRingGeometry(
                previewPlacement.geometry,
              );
              return {
                atoms: [...ka, ...rAtoms],
                bonds: [...kb, ...rBonds],
              };
            })();
      pushToHistory({
        atoms: nextAtoms,
        bonds: nextBonds,
        arrows,
        groups: kg ?? [],
        textBoxes: ktb ?? [],
      });
      return;
    }
    if (tool === 'bond') {
      bondTool.onMouseDown(pos, hitA, hitB);
      return;
    }
    if (tool === 'atom') {
      atomTool.onMouseDown(pos, hitA);
      return;
    }
  };

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const modifiers = syncModifierKeys(e.evt);
    if (atomTool.editingAtomId) return;
    const pos = getRelativePointerPosition();
    const hit = getCanvasHitAt(pos.x, pos.y);
    const hitA = hit.atom;
    const hitB = !hitA ? hit.bond : null;
    const hitArr = !hitA && !hitB ? hit.arrow : null;
    const hitTB = !hitA && !hitB && !hitArr ? hit.textBox : null;
    const hitNative = !hitA && !hitB && !hitArr && !hitTB ? hit.nativeObjectId : null;
    setHoveredAtomId(hitA?.id ?? null);
    setHoveredCanvasAtomId(hitA?.id ?? null);
    setHoveredBondId(hitB?.id ?? null);
    setHoveredCanvasBondId(hitB?.id ?? null);
    setHoveredArrowId(hitArr?.id ?? null);
    setHoveredTextBoxId(hitTB?.id ?? null);
    setHoveredNativeObjectId(hitNative);

    // Arrow preview update with 15° snapping
    if (arrowPreview) {
      const { x1, y1, type } = arrowPreview;
      let ex = pos.x,
        ey = pos.y;
      if (type !== 'curved' && type !== 'half-curved') {
        const rawAngle = Math.atan2(pos.y - y1, pos.x - x1);
        const SNAP = SNAP_ANGLE;
        const snapped = Math.round(rawAngle / SNAP) * SNAP;
        const dist = Math.sqrt((pos.x - x1) ** 2 + (pos.y - y1) ** 2);
        ex = x1 + Math.cos(snapped) * dist;
        ey = y1 + Math.sin(snapped) * dist;
      }
      let cpx = (x1 + ex) / 2,
        cpy = (y1 + ey) / 2;
      if (
        (type === 'curved' || type === 'half-curved') &&
        Math.sqrt((pos.x - x1) ** 2 + (pos.y - y1) ** 2) > 1
      ) {
        const r = getDefaultArrowControlPoint(x1, y1, pos.x, pos.y);
        cpx = r.cpx;
        cpy = r.cpy;
      }
      setArrowPreview((prev) => (prev ? { ...prev, x2: ex, y2: ey, cpx, cpy } : null));
      return;
    }

    // Cross-tool selection drag
    if (selectionDragRef.current.isDragging && selectionDragRef.current.startPos) {
      const dx = pos.x - selectionDragRef.current.startPos.x,
        dy = pos.y - selectionDragRef.current.startPos.y;
      selectionDragRef.current.startPos = pos;
      const {
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kgrp,
        textBoxes: ktb,
        selectedAtomIds: ksel,
        selectedBondIds: kselBond,
        selectedObjectIds: kselObjects,
      } = useStore.getState();
      if (selectionDragRef.current.sourceDocument && kselObjects.size > 0) {
        selectionDragRef.current.totalDx += dx;
        selectionDragRef.current.totalDy += dy;
        setSelectionPreviewTransform({
          kind: 'move',
          selectedObjectIds:
            selectionDragRef.current.selectedObjectIds.size > 0
              ? selectionDragRef.current.selectedObjectIds
              : new Set(kselObjects),
          movedAtomIds: selectionDragRef.current.movedAtomIds,
          affectedBondIds: selectionDragRef.current.affectedBondIds,
          dx: selectionDragRef.current.totalDx,
          dy: selectionDragRef.current.totalDy,
        });
        return;
      }
      const movedAtomIds = new Set(ksel);
      kselBond.forEach((bondId) => {
        const bond = kb.find((entry) => entry.id === bondId);
        if (!bond) return;
        movedAtomIds.add(bond.from);
        movedAtomIds.add(bond.to);
      });
      setCurrentCanvasState({
        atoms: ka.map((a) => (movedAtomIds.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a)),
        bonds: kb,
        arrows: karr,
        groups: kgrp ?? [],
        textBoxes: ktb ?? [],
      });
      return;
    }

    if (tool === 'select') {
      const bbox = getSelectionBBox();
      if (bbox) {
        const corners = [
          { key: 'tl' as const, x: bbox.minX, y: bbox.minY },
          { key: 'tr' as const, x: bbox.maxX, y: bbox.minY },
          { key: 'bl' as const, x: bbox.minX, y: bbox.maxY },
          { key: 'br' as const, x: bbox.maxX, y: bbox.maxY },
        ];
        const hov = corners.find((c) => Math.hypot(pos.x - c.x, pos.y - c.y) < 10);
        setHoveredScaleCorner(hov?.key ?? null);
      } else {
        setHoveredScaleCorner(null);
      }
      selectTool.onMouseMove(pos, hitA, modifiers.shift);
      return;
    }
    setHoveredScaleCorner(null);
    if (tool === 'ring') {
      setRingPreview(resolveRingGeometryAtPointer(pos, hitA, hitB));
      return;
    }
    if (tool === 'bond') {
      bondTool.onMouseMove(pos, hitA);
      return;
    }
    if (tool === 'atom') {
      atomTool.onMouseMove(pos, hitA);
      return;
    }
    if (tool === 'text' && textToolDragRef.current) {
      const drag = textToolDragRef.current;
      const totalDist = Math.hypot(pos.x - drag.startPos.x, pos.y - drag.startPos.y);
      if (totalDist > 4 / stageScale) {
        const dx = pos.x - drag.lastPos.x;
        const dy = pos.y - drag.lastPos.y;
        drag.hasMoved = true;
        drag.lastPos = { x: pos.x, y: pos.y };
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        setCurrentCanvasState({
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg ?? [],
          textBoxes: (ktb ?? []).map((t) =>
            t.id === drag.textBoxId ? { ...t, x: t.x + dx, y: t.y + dy } : t,
          ),
        });
      }
    }
  };

  const handleMouseUp = (e: KonvaEventObject<MouseEvent>) => {
    syncModifierKeys(e.evt);
    markInteractionIdle();
    if (arrowPreview) {
      const { x1, y1, x2, y2, cpx, cpy, type } = arrowPreview;
      if (Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) > 10) {
        const { groups: kg, textBoxes: ktb } = useStore.getState();
        pushToHistory({
          atoms,
          bonds,
          arrows: [...arrows, { id: crypto.randomUUID(), type, x1, y1, x2, y2, cpx, cpy }],
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      }
      setArrowPreview(null);
      return;
    }
    if (selectionDragRef.current.isDragging) {
      const {
        atoms: ka,
        bonds: kb,
        arrows: karr,
        clearSelectionPreviewTransform,
        dispatchEditorCommand,
        groups: kgrp,
        textBoxes: ktb,
      } = useStore.getState();
      const moveSelection = selectionDragRef.current;
      selectionDragRef.current = {
        isDragging: false,
        startPos: null,
        sourceDocument: null,
        totalDx: 0,
        totalDy: 0,
        selectedObjectIds: new Set(),
        movedAtomIds: new Set(),
        affectedBondIds: new Set(),
      };
      if (moveSelection.sourceDocument && moveSelection.selectedObjectIds.size > 0) {
        clearSelectionPreviewTransform();
        if (Math.abs(moveSelection.totalDx) > 0.0001 || Math.abs(moveSelection.totalDy) > 0.0001) {
          dispatchEditorCommand(
            createMoveSelectionCommand(
              { dx: moveSelection.totalDx, dy: moveSelection.totalDy },
              {
                objectIds: moveSelection.selectedObjectIds,
                description: 'move-selection',
              },
            ),
          );
        }
        return;
      }
      pushToHistory({
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kgrp ?? [],
        textBoxes: ktb ?? [],
      });
      return;
    }
    if (tool === 'select') {
      selectTool.onMouseUp();
      return;
    }
    if (tool === 'bond') {
      bondTool.onMouseUp();
      return;
    }
    if (tool === 'atom') {
      atomTool.onMouseUp();
      return;
    }
    if (tool === 'text' && textToolDragRef.current) {
      const drag = textToolDragRef.current;
      textToolDragRef.current = null;
      if (!drag.hasMoved) {
        // Short click → enter edit mode
        ignoreNextBlurRef.current = true;
        setEditingTextBoxId(drag.textBoxId);
        const hitTB = textBoxes.find((t) => t.id === drag.textBoxId);
        if (hitTB) {
          setTextFormat({
            fontFamily: hitTB.fontFamily,
            fontSize: hitTB.fontSize,
            color: hitTB.color,
            textAlign: hitTB.textAlign ?? 'center',
          });
        }
      } else {
        // Drag → commit to history
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        pushToHistory({
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      }
      return;
    }
  };

  const handleDblClick = () => {
    const pos = getRelativePointerPosition();
    const hit = getCanvasHitAt(pos.x, pos.y);
    const hitArr = hit.arrow;
    if (hitArr) {
      const midX = (hitArr.x1 + hitArr.x2) / 2;
      const midY = (hitArr.y1 + hitArr.y2) / 2;
      const screenX = midX * stageScale + stagePos.x;
      const screenY = midY * stageScale + stagePos.y;
      const labelTextStyle = resolveDocumentCaptionTextStyle(documentStyleSettings, {
        authored: { fontSize: hitArr.labelFontSize },
        nativeStyle: nativeArrows.get(hitArr.id)?.style,
      });
      setEditingArrowLabels({
        id: hitArr.id,
        above: hitArr.labelAbove || hitArr.label || '',
        below: hitArr.labelBelow || '',
        fontSize: labelTextStyle.fontSize,
        color: hitArr.labelColor ?? '',
        screenX,
        screenY,
      });
      return;
    }
    const hitTB = hit.textBox;
    if (hitTB) {
      ignoreNextBlurRef.current = true;
      setEditingTextBoxId(hitTB.id);
      setSelectedTextBoxIds(new Set([hitTB.id]));
    }
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    syncModifierKeys(e.evt);
    if (e.evt.ctrlKey || e.evt.metaKey) return;
    e.evt.preventDefault();
    markInteractionActive();
    const stage = stageRef.current;
    if (!stage) return;
    const oldS = stageScale,
      p = stage.getPointerPosition();
    if (!p) return;
    const pt = { x: (p.x - stagePos.x) / oldS, y: (p.y - stagePos.y) / oldS };
    const newS = Math.min(Math.max(e.evt.deltaY < 0 ? oldS * 1.1 : oldS / 1.1, 0.1), 10);
    setStageScale(newS);
    setStagePos({ x: p.x - pt.x * newS, y: p.y - pt.y * newS });
    markInteractionIdle();
  };

  useImperativeHandle(
    ref,
    () => ({
      saveNative: async (options = {}) => {
        try {
          const store = useStore.getState();
          const {
            atoms: a,
            bonds: b,
            arrows: arr,
            textBoxes: tb,
            groups: g,
            chemDrawDocument,
          } = store;
          const canvasState = {
            atoms: a,
            bonds: b,
            arrows: arr,
            groups: g ?? [],
            textBoxes: tb ?? [],
          };
          const prepared = await prepareChemDrawDocumentForSaveAsync({
            canvasState,
            document: chemDrawDocument,
            documentStyleSettings,
            pageSetup,
          });
          if (prepared.document) {
            store.setChemDrawDocument(prepared.document);
            store.setChemDrawWarnings([]);
          }
          if (options.path && !options.prompt) {
            const path = await saveTextToPath(options.path, prepared.xml);
            return { path, saved: true };
          }
          const path = await saveTextWithDialog({
            title: options.prompt ? 'Save Sketch As' : 'Save Sketch',
            defaultPath: options.path ?? 'sketch.cdxml',
            name: 'ChemDraw XML',
            extensions: ['cdxml'],
            content: prepared.xml,
          });
          return { path, saved: Boolean(path) };
        } catch (e) {
          useStore.getState().showToast('Failed to save file');
          console.error(e);
          return { path: null, saved: false };
        }
      },
      loadNative: async (c: string) => {
        try {
          const loaded = await loadChemDrawDocumentForCanvasAsync(c);
          const store = useStore.getState();
          store.setChemDrawDocument(loaded.document);
          store.setChemDrawWarnings(loaded.warnings);
          for (const warning of loaded.warnings.slice(0, 3)) store.showToast(warning, 'info');
          resetStageView();
          pushToHistory(loaded.state);
        } catch (e) {
          useStore.getState().showToast('Failed to load file: invalid CDXML');
          console.error(e);
        }
      },
      exportPNG: async () => {
        try {
          const d =
            useNativeSceneSurface && sceneSurfaceRef.current
              ? sceneSurfaceRef.current.toDataURL({
                  pixelRatio: 3,
                  width: finitePageMetrics?.totalWidthPx ?? width,
                  height: finitePageMetrics?.totalHeightPx ?? height,
                  stageScale,
                  stagePos,
                })
              : finitePageMetrics && stageRef.current
                ? stageRef.current.toDataURL({
                    pixelRatio: 3,
                    x: 0,
                    y: 0,
                    width: finitePageMetrics.totalWidthPx,
                    height: finitePageMetrics.totalHeightPx,
                  })
                : stageRef.current?.toDataURL({ pixelRatio: 3 });
          if (!d) return;
          await saveBinaryWithDialog({
            title: 'Export PNG',
            defaultPath: 'molecule.png',
            name: 'PNG Image',
            extensions: ['png'],
            content: Uint8Array.from(atob(d.split(',')[1]), (c) => c.charCodeAt(0)),
          });
        } catch (e) {
          useStore.getState().showToast('PNG export failed');
          console.error(e);
        }
      },
      exportSVG: async () => {
        try {
          const {
            atoms: a,
            bonds: b,
            arrows: arr,
            isDarkMode: dm,
            textBoxes: tb,
            pageSetup: currentPageSetup,
          } = useStore.getState();
          const svg = generateCanvasSVG(a, b, arr, dm, false, tb ?? [], currentPageSetup);
          await saveTextWithDialog({
            title: 'Export SVG',
            defaultPath: 'molecule.svg',
            name: 'SVG Vector Image',
            extensions: ['svg'],
            content: svg,
          });
        } catch (e) {
          useStore.getState().showToast('SVG export failed');
          console.error(e);
        }
      },
      insertImage: async (options) => {
        try {
          await insertEmbeddedImage(options);
        } catch (error) {
          useStore.getState().showToast('Image insertion failed');
          console.error(error);
        }
      },
      getMolblock: () => {
        const {
          atoms: a,
          bonds: b,
          viewerMolblock,
          selectedTextBoxIds,
          textBoxes: tb,
        } = useStore.getState();
        if (
          selectedTextBoxIds.size > 0 &&
          viewerMolblock &&
          (tb ?? []).some((textBox) => {
            if (!selectedTextBoxIds.has(textBox.id)) return false;
            const chemistry = evaluateTextBoxChemicalState(
              textBox.runs,
              textBox.semanticMode ?? 'auto',
              { validateSmiles: aliasValidator },
            );
            return Boolean(chemistry.metadata?.chemistryAvailable);
          })
        ) {
          return viewerMolblock;
        }
        return graphToMolblock(a, b, width, height, resolveAliasEntry).molblock || viewerMolblock;
      },
      loadFromSmiles: (input: string) => {
        if (!rdkit) return;
        if (!input?.trim()) {
          useStore.getState().setChemDrawDocument(null);
          useStore.getState().setChemDrawWarnings([]);
          pushToHistory({
            atoms: [],
            bonds: [],
            arrows: useStore.getState().arrows,
            groups: [],
            textBoxes: [],
          });
          return;
        }
        try {
          const resolved = resolveChemicalInput(rdkit, input, aliasValidator);
          if (!resolved?.molblock) {
            useStore.getState().showToast('Invalid SMILES or formula');
            return;
          }
          const newState = molblockToState(
            resolved.molblock,
            width,
            height,
            useStore.getState().arrows,
          );
          useStore.getState().setChemDrawDocument(null);
          useStore.getState().setChemDrawWarnings([]);
          pushToHistory({ ...newState, textBoxes: [] });
        } catch (e) {
          useStore.getState().showToast('Failed to load structure');
          console.error(e);
        }
      },
      addFromState: (buf) => {
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        pushToHistory({
          atoms: [...ka, ...buf.atoms],
          bonds: [...kb, ...buf.bonds],
          arrows: [...karr, ...buf.arrows],
          groups: kg ?? [],
          textBoxes: [...(ktb ?? []), ...(buf.textBoxes ?? [])],
        });
        setSelectedAtomIds(new Set(buf.atoms.map((a) => a.id)));
        setSelectedArrowIds(new Set(buf.arrows.map((a) => a.id)));
        setSelectedTextBoxIds(new Set((buf.textBoxes ?? []).map((t) => t.id)));
      },
      addFromSmiles: (input) => {
        if (!rdkit || !input?.trim()) return;
        try {
          const resolved = resolveChemicalInput(rdkit, input, aliasValidator);
          if (!resolved?.molblock) {
            useStore.getState().showToast('Invalid SMILES or formula');
            return;
          }
          const parsed = molblockToState(resolved.molblock, width, height, []);
          const {
            atoms: ka,
            bonds: kb,
            arrows: karr,
            groups: kg,
            textBoxes: ktb,
          } = useStore.getState();
          useStore.getState().setChemDrawDocument(null);
          useStore.getState().setChemDrawWarnings([]);
          pushToHistory({
            atoms: [...ka, ...parsed.atoms],
            bonds: [...kb, ...parsed.bonds],
            arrows: karr,
            groups: kg ?? [],
            textBoxes: ktb ?? [],
          });
          setSelectedAtomIds(new Set(parsed.atoms.map((a) => a.id)));
          setSelectedArrowIds(new Set());
        } catch (e) {
          useStore.getState().showToast('Failed to add structure');
          console.error(e);
        }
      },
      cleanUp: () => {
        if (!rdkit) return;
        const {
          atoms: a,
          bonds: b,
          arrows: arr,
          groups: grp,
          textBoxes: tb,
          selectedAtomIds: selIds,
        } = useStore.getState();
        if (selIds.size > 0) {
          const sA = a.filter((x) => selIds.has(x.id)),
            sB = b.filter((x) => selIds.has(x.from) && selIds.has(x.to));
          if (!sA.length) return;
          const mb = graphToMolblock(sA, sB, width, height, resolveAliasEntry).molblock;
          if (!mb) return;
          try {
            const mol = rdkit.get_mol(mb);
            if (!mol) return;
            mol.set_new_coords?.();
            const nMb = mol.get_molblock?.();
            mol.delete();
            if (!nMb) return;
            const geom = parseMolblockGeometry(nMb, 1);
            if (!geom || geom.atoms.length !== sA.length) return;
            const normGeom = normalizeMolblockBondLength(geom, documentStyleSettings.bondLength);
            const rC = normGeom.atoms.map((atom, i) => ({
              id: sA[i]!.id,
              x: atom.x,
              y: atom.y,
            }));
            const oCx = sA.reduce((s, x) => s + x.x, 0) / sA.length,
              oCy = sA.reduce((s, x) => s + x.y, 0) / sA.length;
            const nCx = rC.reduce((s, c) => s + c.x, 0) / rC.length,
              nCy = rC.reduce((s, c) => s + c.y, 0) / rC.length;
            const dx = oCx - nCx,
              dy = oCy - nCy;
            const map = new Map(rC.map((c) => [c.id, { x: c.x + dx, y: c.y + dy }]));
            useStore.getState().setChemDrawDocument(null);
            useStore.getState().setChemDrawWarnings([]);
            pushToHistory({
              atoms: a.map((x) => {
                const nc = map.get(x.id);
                return nc ? { ...x, ...nc } : x;
              }),
              bonds: b,
              arrows: arr,
              groups: grp ?? [],
              textBoxes: tb ?? [],
            });
          } catch (e) {
            useStore.getState().showToast('Structure cleanup failed');
            console.error(e);
          }
          return;
        }
        const mb = graphToMolblock(a, b, width, height, resolveAliasEntry).molblock;
        if (!mb) return;
        try {
          const mol = rdkit.get_mol(mb);
          if (mol) {
            mol.set_new_coords?.();
            const nMb = mol.get_molblock?.();
            mol.delete();
            if (!nMb) return;
            const geomFull = parseMolblockGeometry(nMb, 1);
            if (!geomFull) return;
            const normFull = normalizeMolblockBondLength(
              geomFull,
              documentStyleSettings.bondLength,
            );
            const newAtoms: Atom[] = normFull.atoms.map((atom) => ({
              id: crypto.randomUUID(),
              x: width / 2 + atom.x,
              y: height / 2 + atom.y,
              kind: 'element' as const,
              element: atom.element,
              ...(atom.charge != null ? { charge: atom.charge } : {}),
              ...(atom.isotope != null ? { isotope: atom.isotope } : {}),
            }));
            const newBonds: Bond[] = normFull.bonds.map((bond) => ({
              id: crypto.randomUUID(),
              from: newAtoms[bond.from]!.id,
              to: newAtoms[bond.to]!.id,
              order: bond.order,
              stereo: bond.stereo,
            }));
            resetStageView();
            useStore.getState().setChemDrawDocument(null);
            useStore.getState().setChemDrawWarnings([]);
            pushToHistory({ atoms: newAtoms, bonds: newBonds, arrows: arr, textBoxes: tb ?? [] });
          }
        } catch (e) {
          useStore.getState().showToast('Structure cleanup failed');
          console.error(e);
        }
      },
      applyTextFormat: (cmd: string, value?: string) => {
        if (editOverlayRef.current && document.activeElement === editOverlayRef.current) {
          document.execCommand(cmd, false, value);
        }
      },
      fitToScreen: () => {
        const { atoms, arrows, textBoxes: tb, pageSetup: currentPageSetup } = useStore.getState();
        if (currentPageSetup.mode === 'finite') {
          const metrics = getPageSetupDimensionsPx(currentPageSetup);
          const pad = 30;
          const scaleX = width / (metrics.totalWidthPx + pad * 2);
          const scaleY = height / (metrics.totalHeightPx + pad * 2);
          const scale = Math.min(scaleX, scaleY, 4);
          setStageScale(scale);
          setStagePos({
            x: width / 2 - (metrics.totalWidthPx / 2) * scale,
            y: height / 2 - (metrics.totalHeightPx / 2) * scale,
          });
          return;
        }
        const pts: { x: number; y: number }[] = [
          ...atoms.map((a) => ({ x: a.x, y: a.y })),
          ...arrows.flatMap((a) => [
            { x: a.x1, y: a.y1 },
            { x: a.x2, y: a.y2 },
          ]),
          ...(tb ?? []).map((t) => ({ x: t.x, y: t.y })),
        ];
        if (pts.length === 0) {
          resetStageView();
          return;
        }
        const pad = 60;
        const minX = Math.min(...pts.map((p) => p.x)) - pad;
        const maxX = Math.max(...pts.map((p) => p.x)) + pad;
        const minY = Math.min(...pts.map((p) => p.y)) - pad;
        const maxY = Math.max(...pts.map((p) => p.y)) + pad;
        const scaleX = width / (maxX - minX),
          scaleY = height / (maxY - minY);
        const scale = Math.min(scaleX, scaleY, 4);
        const cx = (minX + maxX) / 2,
          cy = (minY + maxY) / 2;
        setStageScale(scale);
        setStagePos({ x: width / 2 - cx * scale, y: height / 2 - cy * scale });
      },
      moveContentIntoPage: () => {
        const {
          atoms,
          bonds,
          arrows,
          groups,
          textBoxes: tb,
          pageSetup: currentPageSetup,
        } = useStore.getState();
        if (currentPageSetup.mode !== 'finite') return;
        const bounds = getCanvasContentBounds(atoms, arrows, tb ?? []);
        if (!bounds) return;
        const metrics = getPageSetupDimensionsPx(currentPageSetup);
        const margin = 24;
        const dx =
          bounds.minX < margin
            ? margin - bounds.minX
            : bounds.maxX > metrics.totalWidthPx - margin
              ? metrics.totalWidthPx - margin - bounds.maxX
              : 0;
        const dy =
          bounds.minY < margin
            ? margin - bounds.minY
            : bounds.maxY > metrics.totalHeightPx - margin
              ? metrics.totalHeightPx - margin - bounds.maxY
              : 0;
        if (dx === 0 && dy === 0) {
          useStore.getState().showToast('Content is already inside the finite page area.', 'info');
          return;
        }
        pushToHistory({
          atoms: atoms.map((atom) => ({ ...atom, x: atom.x + dx, y: atom.y + dy })),
          bonds,
          arrows: arrows.map((arrow) => ({
            ...arrow,
            x1: arrow.x1 + dx,
            y1: arrow.y1 + dy,
            x2: arrow.x2 + dx,
            y2: arrow.y2 + dy,
            cpx: arrow.cpx + dx,
            cpy: arrow.cpy + dy,
          })),
          groups,
          textBoxes: (tb ?? []).map((textBox) => ({
            ...textBox,
            x: textBox.x + dx,
            y: textBox.y + dy,
          })),
        });
        useStore.getState().showToast('Moved content into the finite page area.', 'info');
      },
      centerPageInView: () => {
        const { pageSetup: currentPageSetup } = useStore.getState();
        if (currentPageSetup.mode !== 'finite') return;
        const metrics = getPageSetupDimensionsPx(currentPageSetup);
        const pad = 30;
        const scaleX = width / (metrics.totalWidthPx + pad * 2);
        const scaleY = height / (metrics.totalHeightPx + pad * 2);
        const scale = Math.min(scaleX, scaleY, 4);
        setStageScale(scale);
        setStagePos({
          x: width / 2 - (metrics.totalWidthPx / 2) * scale,
          y: height / 2 - (metrics.totalHeightPx / 2) * scale,
        });
      },
    }),
    [
      aliasValidator,
      documentStyleSettings,
      finitePageMetrics,
      insertEmbeddedImage,
      pageSetup,
      rdkit,
      resetStageView,
      stagePos,
      stageScale,
      useNativeSceneSurface,
      width,
      height,
      pushToHistory,
      setSelectedAtomIds,
      setSelectedArrowIds,
      setSelectedTextBoxIds,
      resolveAliasEntry,
    ],
  );

  const renderArrow = (a: Arrow, preview = false) => {
    const nativeArrow = nativeArrows.get(a.id);
    const isS = selectedArrowIds.has(a.id),
      isH = hoveredArrowId === a.id;
    const defaultColor = resolveBondColor(undefined, documentStyleSettings, isDarkMode);
    const color = isS || isH ? '#2196F3' : a.strokeColor ? adaptColor(a.strokeColor) : defaultColor;
    const labelAbove = a.labelAbove || a.label;
    const labelBelow = a.labelBelow;
    const { fontFamily: labelFontFamily, fontSize: labelFontSize } =
      resolveDocumentCaptionTextStyle(documentStyleSettings, {
        authored: { fontSize: a.labelFontSize },
        nativeStyle: nativeArrow?.style,
      });
    const labelColor = a.labelColor ? (isS || isH ? '#2196F3' : a.labelColor) : color;
    const anchors = getArrowLabelAnchors(a);
    return (
      <Group key={a.id + (preview ? '-p' : '')} opacity={preview ? 0.55 : isH && !isS ? 0.65 : 1}>
        <Shape
          listening={false}
          sceneFunc={(ctx: KonvaContext) => {
            const c = (ctx as KonvaContext & { _context: CanvasRenderingContext2D })._context;
            c.save();
            drawArrowShape(c, a, color, {
              documentStyleSettings,
              nativeArrow,
            });
            c.restore();
          }}
        />
        {labelAbove && (
          <Text
            x={anchors.above.x - 60}
            y={anchors.above.y - labelFontSize - 2}
            text={labelAbove}
            fontSize={labelFontSize}
            fill={labelColor}
            width={120}
            align="center"
            fontFamily={labelFontFamily}
          />
        )}
        {labelBelow && (
          <Text
            x={anchors.below.x - 60}
            y={anchors.below.y + 2}
            text={labelBelow}
            fontSize={labelFontSize}
            fill={labelColor}
            width={120}
            align="center"
            fontFamily={labelFontFamily}
          />
        )}
      </Group>
    );
  };

  const renderArrowControlHandle = (a: Arrow) => (
    <Star
      key={`${a.id}-control`}
      x={a.cpx}
      y={a.cpy}
      numPoints={5}
      innerRadius={3}
      outerRadius={7}
      fill="#2196F3"
      stroke="#fff"
      strokeWidth={1}
      opacity={0.95}
      draggable
      onMouseDown={(e) => {
        e.cancelBubble = true;
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        setCurrentCanvasState({
          atoms: ka,
          bonds: kb,
          arrows: karr.map((entry) =>
            entry.id === a.id ? { ...entry, cpx: e.target.x(), cpy: e.target.y() } : entry,
          ),
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const {
          atoms: ka,
          bonds: kb,
          arrows: karr,
          groups: kg,
          textBoxes: ktb,
        } = useStore.getState();
        pushToHistory({
          atoms: ka,
          bonds: kb,
          arrows: karr.map((entry) =>
            entry.id === a.id ? { ...entry, cpx: e.target.x(), cpy: e.target.y() } : entry,
          ),
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      }}
    />
  );

  const updateElectronMarkerAngleInCanvas = useCallback(
    (atomId: string, markerIndex: number, angle: number, commit: boolean) => {
      const {
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kg,
        textBoxes: ktb,
      } = useStore.getState();
      const nextAtoms = ka.map((entry) =>
        entry.id === atomId ? updateAtomElectronMarkerAngle(entry, markerIndex, angle) : entry,
      );
      const nextState = {
        atoms: nextAtoms,
        bonds: kb,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: ktb ?? [],
      };
      if (commit) pushToHistory(nextState);
      else setCurrentCanvasState(nextState);
    },
    [pushToHistory, setCurrentCanvasState],
  );

  const renderElectronControlHandles = (entry: (typeof selectedElectronControlAtoms)[number]) => (
    <Group key={`${entry.atom.id}-electron-controls`}>
      <Circle
        x={entry.atom.x}
        y={entry.atom.y}
        radius={entry.labelLayout.electronDistance}
        stroke="rgba(33,150,243,0.28)"
        strokeWidth={1}
        dash={[4, 3]}
        listening={false}
      />
      {entry.markers.map((marker) => (
        <Group key={`${entry.atom.id}-electron-${marker.index}`}>
          <Line
            points={[entry.atom.x, entry.atom.y, marker.center.x, marker.center.y]}
            stroke="rgba(33,150,243,0.6)"
            strokeWidth={1}
            dash={[2, 3]}
            listening={false}
          />
          <Circle
            x={marker.center.x}
            y={marker.center.y}
            radius={Math.max(5, entry.labelLayout.electronDotRadius * 2.8)}
            fill="#ffffff"
            stroke="#2196F3"
            strokeWidth={1.5}
            draggable
            dragBoundFunc={(pos) => {
              const dx = pos.x - entry.atom.x;
              const dy = pos.y - entry.atom.y;
              const length = Math.hypot(dx, dy) || 1;
              return {
                x: entry.atom.x + (dx / length) * entry.labelLayout.electronDistance,
                y: entry.atom.y + (dy / length) * entry.labelLayout.electronDistance,
              };
            }}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              event.cancelBubble = true;
              updateElectronMarkerAngleInCanvas(
                entry.atom.id,
                marker.index,
                Math.atan2(event.target.y() - entry.atom.y, event.target.x() - entry.atom.x),
                false,
              );
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateElectronMarkerAngleInCanvas(
                entry.atom.id,
                marker.index,
                Math.atan2(event.target.y() - entry.atom.y, event.target.x() - entry.atom.x),
                true,
              );
            }}
          />
        </Group>
      ))}
    </Group>
  );

  const adaptColor = (c: string) => {
    if (!isDarkMode) return c;
    const n = c.toLowerCase().trim();
    return n === '#000000' || n === '#000' || n === 'black' ? '#ffffff' : c;
  };

  const renderAtom = (a: Atom, options?: { keyPrefix?: string }) => {
    if (tool === 'bond' && bondTool.activeAtomIsNew && a.id === bondTool.activeAtomId) return null;
    const keyPrefix = options?.keyPrefix ? `${options.keyPrefix}-` : '';
    const nativeNode = nativeNodes.get(a.id);
    const conn = bondsByAtomId.get(a.id) ?? [];
    const sL = isAtomLabelVisible(a, conn.length),
      bC = conn.reduce((s, b) => s + b.order, 0);
    const leadElem = getAtomLeadElement(a);
    const knownVal: number | null = VALENCIES[leadElem] ?? null;
    const chg = a.charge || 0;
    let eVal = knownVal ?? 0;
    if (knownVal !== null) {
      if (leadElem === 'C') eVal = knownVal - Math.abs(chg);
      else if (leadElem === 'N' || leadElem === 'O') eVal = knownVal + chg;
      else if (leadElem === 'B') eVal = knownVal + Math.abs(chg);
    }
    const err = (knownVal !== null && bC > eVal) || rdkitInvalidAtomIds.has(a.id);
    const alias = getAtomAlias(a);
    const canShowImplicitHydrogens = !alias || Boolean(SHORTHAND_DATA[alias]);
    const hV =
      showHydrogens && canShowImplicitHydrogens && knownVal !== null
        ? getAtomHydrogenCount(a, sceneBonds, knownVal)
        : 0;
    const labelText = getAtomDisplayText(a, sceneAtoms, sceneBonds, hV).text;
    const isS = selectedAtomIds.has(a.id),
      isH = hoveredAtomId === a.id;
    const suppressSelectionAdornment = isS && fullySelectedComponentAtomIds.has(a.id);
    const showSelectionAdornment = isS && !suppressSelectionAdornment;
    const showAtomAdornment = err || isH || showSelectionAdornment;
    const labelTextStyle = resolveDocumentLabelTextStyle(documentStyleSettings, {
      authored: {
        fontFamily: a.labelFontFamily,
        fontSize: a.labelFontSize,
      },
      nativeStyle: nativeNode?.style,
    });
    const { fontFamily: labelFontFamily, fontSize: labelFontSize } = labelTextStyle;
    const labelColor = a.labelColor ?? nativeNode?.style?.color;
    const color = err
      ? '#FF0000'
      : isS
        ? '#2196F3'
        : resolveAtomLabelColor(
            labelColor,
            leadElem,
            documentStyleSettings,
            isDarkMode,
            documentViewSettings,
          );
    const displayRuns = buildAtomLabelRuns(
      a,
      labelText,
      color,
      documentStyleSettings,
      documentViewSettings,
      isDarkMode,
    );
    const cT =
      chg === 1
        ? '+'
        : chg === -1
          ? '−'
          : chg > 1
            ? `${chg}+`
            : chg < -1
              ? `${Math.abs(chg)}−`
              : '';
    const {
      offset: labelAnchorOffset,
      width: anchoredLabelWidth,
      padding: labelPadding,
    } = sL
      ? getLeadElementAnchorOffset(
          displayRuns,
          labelText,
          leadElem,
          labelFontSize,
          getAtomLabelBoxWidth,
          (run) => measureRunWidth(run, labelFontSize, labelFontFamily),
        )
      : { offset: 0, width: 0, padding: 0 };
    const lW = sL ? anchoredLabelWidth : 0;
    const labelLayout = getAtomLabelLayoutMetrics(labelFontSize, lW, documentStyleSettings);
    const verticalLabelOffset = getNodeLabelVerticalOffset(
      nativeNode?.labelAlignment,
      labelFontSize,
    );
    const labelBoxStartX = a.x - labelAnchorOffset;
    const labelTextStartX = labelBoxStartX + labelPadding;
    const cX = sL ? labelBoxStartX + lW - labelLayout.chargeOffsetX : a.x + 5,
      cY = a.y - labelLayout.chargeOffsetY + verticalLabelOffset;
    const electronMarkers = getAtomElectronMarkerGeometry(a, {
      centerX: a.x,
      centerY: a.y,
      distance: labelLayout.electronDistance,
      pairSpacing: labelLayout.electronPairSpacing,
    });
    const es = electronMarkers.flatMap((marker, markerIndex) =>
      marker.dots.map((dot, dotIndex) => (
        <Circle
          key={`${keyPrefix}electron-${a.id}-${markerIndex}-${dotIndex}`}
          x={dot.x}
          y={dot.y}
          radius={labelLayout.electronDotRadius}
          fill={color}
        />
      )),
    );
    return (
      <Group key={`${keyPrefix}${a.id}`}>
        {nativeNode?.query && (
          <Rect
            x={sL ? labelBoxStartX - labelLayout.queryPadX : a.x - Math.max(18, lW / 2 + 4)}
            y={a.y - labelLayout.boxHeight / 2 - labelLayout.queryPadY + verticalLabelOffset}
            width={Math.max(36, lW + labelLayout.queryPadX * 2)}
            height={labelLayout.boxHeight + labelLayout.queryPadY * 2}
            stroke={isS ? '#2196F3' : color}
            strokeWidth={labelLayout.hoverStrokeWidth}
            dash={[4, 3]}
            cornerRadius={labelLayout.queryCornerRadius}
            opacity={0.7}
            listening={false}
          />
        )}
        {showAtomAdornment && (
          <Circle
            x={a.x}
            y={a.y}
            radius={labelLayout.hoverRadius}
            fill={err ? '#FF0000' : isH ? '#2196F3' : 'transparent'}
            opacity={err ? 0.2 : isH ? 0.08 : 1}
            stroke={showSelectionAdornment ? '#2196F3' : err ? '#FF0000' : 'none'}
            strokeWidth={labelLayout.hoverStrokeWidth}
            dash={[2, 2]}
          />
        )}
        {sL &&
          (() => {
            let cursorX = labelTextStartX;
            return displayRuns.map((run, index) => {
              const runWidth = measureRunWidth(run, labelFontSize, labelFontFamily);
              const runFontSize = run.sub || run.sup ? labelFontSize * 0.65 : labelFontSize;
              const runY =
                a.y -
                labelFontSize * 0.36 +
                verticalLabelOffset +
                (run.sub ? labelFontSize * 0.22 : run.sup ? -labelFontSize * 0.18 : 0);
              const node = (
                <Text
                  key={`${keyPrefix}${a.id}-label-${index}`}
                  x={cursorX}
                  y={runY}
                  text={run.text}
                  fontSize={runFontSize}
                  fontStyle={getTextRunFontStyle(run)}
                  fontFamily={labelFontFamily}
                  fill={err || isS ? color : (run.color ?? color)}
                  wrap="none"
                />
              );
              cursorX += runWidth;
              return node;
            });
          })()}
        {!sL && showAtomAdornment && (
          <Circle
            x={a.x}
            y={a.y}
            radius={4}
            fill={err ? '#FF0000' : '#2196F3'}
            opacity={showSelectionAdornment || err ? 1 : 0.3}
          />
        )}
        {cT && (
          <Text
            x={cX}
            y={cY}
            text={cT}
            fontSize={labelLayout.chargeFontSize}
            fontStyle="bold"
            fill={color}
            fontFamily={labelFontFamily}
          />
        )}
        {es}
      </Group>
    );
  };

  const renderNativeGraphic = (graphic: ChemDrawGraphic) => {
    const isSelected = selectedObjectIds.has(graphic.id);
    const isHovered = hoveredNativeObjectId === graphic.id;
    const color =
      isSelected || isHovered
        ? '#2196F3'
        : adaptColor(graphic.style?.color ?? (isDarkMode ? '#ffffff' : '#333333'));
    const strokeWidth =
      graphic.style?.lineWidth != null
        ? convertNativeToCanvas(graphic.style.lineWidth, documentStyleSettings)
        : 1.5;
    const dash = graphic.style?.lineType === 'dashed' ? [6, 4] : undefined;
    const orbitalFill = graphic.style?.fillColor ? adaptColor(graphic.style.fillColor) : color;
    if (graphic.graphicType === 'line' && graphic.points && graphic.points.length >= 2) {
      return (
        <Line
          key={`graphic-${graphic.id}`}
          points={graphic.points.flatMap((point) => [point.x, point.y])}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          listening={false}
        />
      );
    }
    if (graphic.graphicType === 'polygon' && graphic.points && graphic.points.length >= 3) {
      return (
        <Line
          key={`graphic-${graphic.id}`}
          points={graphic.points.flatMap((point) => [point.x, point.y])}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          closed
          listening={false}
        />
      );
    }
    if (graphic.graphicType === 'rounded-rectangle' && graphic.bounds) {
      return (
        <Rect
          key={`graphic-${graphic.id}`}
          x={graphic.bounds.left}
          y={graphic.bounds.top}
          width={graphic.bounds.right - graphic.bounds.left}
          height={graphic.bounds.bottom - graphic.bounds.top}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          cornerRadius={graphic.cornerRadius ?? 10}
          shadowColor="rgba(0,0,0,0.35)"
          shadowBlur={8}
          shadowOffsetX={3}
          shadowOffsetY={3}
          listening={false}
        />
      );
    }
    if (graphic.graphicType === 'rectangle' && graphic.bounds) {
      return (
        <Rect
          key={`graphic-${graphic.id}`}
          x={graphic.bounds.left}
          y={graphic.bounds.top}
          width={graphic.bounds.right - graphic.bounds.left}
          height={graphic.bounds.bottom - graphic.bounds.top}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          listening={false}
        />
      );
    }
    if (graphic.graphicType === 'ellipse' && graphic.bounds) {
      const cx = (graphic.bounds.left + graphic.bounds.right) / 2;
      const cy = (graphic.bounds.top + graphic.bounds.bottom) / 2;
      return (
        <Circle
          key={`graphic-${graphic.id}`}
          x={cx}
          y={cy}
          radius={Math.max(
            (graphic.bounds.right - graphic.bounds.left) / 2,
            (graphic.bounds.bottom - graphic.bounds.top) / 2,
          )}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          listening={false}
          scaleY={
            (graphic.bounds.bottom - graphic.bounds.top) /
            Math.max(graphic.bounds.right - graphic.bounds.left, 1)
          }
        />
      );
    }
    if (graphic.graphicType === 'symbol' && graphic.bounds) {
      const width = Math.abs(graphic.bounds.right - graphic.bounds.left);
      const height = Math.abs(graphic.bounds.bottom - graphic.bounds.top);
      const cx = (graphic.bounds.left + graphic.bounds.right) / 2;
      const cy = (graphic.bounds.top + graphic.bounds.bottom) / 2;
      const radius = Math.max(width, height, 8) / 2;
      const arm = radius * 0.48;
      if (graphic.symbolType === 'CirclePlus' || graphic.symbolType === 'CircleMinus') {
        return (
          <Group key={`graphic-${graphic.id}`} listening={false}>
            <Circle x={cx} y={cy} radius={radius} stroke={color} strokeWidth={strokeWidth} />
            <Line points={[cx - arm, cy, cx + arm, cy]} stroke={color} strokeWidth={strokeWidth} />
            {graphic.symbolType === 'CirclePlus' && (
              <Line
                points={[cx, cy - arm, cx, cy + arm]}
                stroke={color}
                strokeWidth={strokeWidth}
              />
            )}
          </Group>
        );
      }
      if (graphic.symbolType === 'LonePair') {
        return (
          <Group key={`graphic-${graphic.id}`} listening={false}>
            <Circle x={cx - radius * 0.28} y={cy} radius={strokeWidth * 0.95} fill={color} />
            <Circle x={cx + radius * 0.28} y={cy} radius={strokeWidth * 0.95} fill={color} />
          </Group>
        );
      }
      if (graphic.symbolType === 'Electron') {
        return (
          <Circle
            key={`graphic-${graphic.id}`}
            x={cx}
            y={cy}
            radius={strokeWidth}
            fill={color}
            listening={false}
          />
        );
      }
    }
    if (graphic.graphicType === 'bracket' && graphic.points && graphic.points.length >= 2) {
      const [start, end] = graphic.points;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return null;
      const px = -dy / length;
      const py = dx / length;
      const lip = graphic.lipSize ?? Math.max(8, length * 0.35);
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      return (
        <Group key={`graphic-${graphic.id}`} listening={false}>
          <Shape
            sceneFunc={(ctx: KonvaContext) => {
              const c = (ctx as KonvaContext & { _context: CanvasRenderingContext2D })._context;
              c.save();
              c.strokeStyle = color;
              c.lineWidth = strokeWidth;
              c.lineCap = 'round';
              c.lineJoin = 'round';
              c.beginPath();
              if ((graphic.bracketType ?? '').toLowerCase() === 'square') {
                c.moveTo(start.x + px * lip, start.y + py * lip);
                c.lineTo(start.x, start.y);
                c.lineTo(end.x, end.y);
                c.lineTo(end.x + px * lip, end.y + py * lip);
              } else {
                c.moveTo(start.x + px * lip, start.y + py * lip);
                c.quadraticCurveTo(start.x, start.y, midX, midY);
                c.quadraticCurveTo(end.x, end.y, end.x + px * lip, end.y + py * lip);
              }
              c.stroke();
              c.restore();
            }}
          />
          {graphic.label && (
            <Text
              x={midX - px * (lip + 10) - 10}
              y={midY - py * (lip + 10) - 8}
              width={20}
              align="center"
              text={graphic.label}
              fontSize={11}
              fill={color}
              fontFamily="Arial"
            />
          )}
        </Group>
      );
    }
    if (graphic.graphicType === 'orbital') {
      const orbitalType = (graphic.orbitalType ?? '').toLowerCase();
      if (
        orbitalType.startsWith('s') &&
        graphic.center &&
        graphic.majorAxisEnd &&
        graphic.minorAxisEnd
      ) {
        const rx = Math.hypot(
          graphic.majorAxisEnd.x - graphic.center.x,
          graphic.majorAxisEnd.y - graphic.center.y,
        );
        const ry = Math.hypot(
          graphic.minorAxisEnd.x - graphic.center.x,
          graphic.minorAxisEnd.y - graphic.center.y,
        );
        const rotation = Math.atan2(
          graphic.majorAxisEnd.y - graphic.center.y,
          graphic.majorAxisEnd.x - graphic.center.x,
        );
        return (
          <Shape
            key={`graphic-${graphic.id}`}
            listening={false}
            sceneFunc={(ctx: KonvaContext) => {
              const c = (ctx as KonvaContext & { _context: CanvasRenderingContext2D })._context;
              c.save();
              c.translate(graphic.center!.x, graphic.center!.y);
              c.rotate(rotation);
              c.beginPath();
              c.ellipse(0, 0, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
              c.globalAlpha = (graphic.ovalType ?? '').toLowerCase().includes('shaded') ? 0.22 : 0;
              c.fillStyle = orbitalFill;
              c.fill();
              c.globalAlpha = 1;
              c.strokeStyle = color;
              c.lineWidth = strokeWidth;
              c.stroke();
              c.restore();
            }}
          />
        );
      }
      if (orbitalType === 'p' && graphic.points && graphic.points.length >= 2) {
        const [start, end] = graphic.points;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) return null;
        const angle = Math.atan2(dy, dx);
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const lobeRx = Math.max(length * 0.2, 4);
        const lobeRy = Math.max(length * 0.11, 3);
        const lobeOffset = length * 0.26;
        return (
          <Shape
            key={`graphic-${graphic.id}`}
            listening={false}
            sceneFunc={(ctx: KonvaContext) => {
              const c = (ctx as KonvaContext & { _context: CanvasRenderingContext2D })._context;
              c.save();
              c.translate(midX, midY);
              c.rotate(angle);
              c.fillStyle = orbitalFill;
              c.strokeStyle = color;
              c.lineWidth = strokeWidth;
              for (const offset of [-lobeOffset, lobeOffset]) {
                c.beginPath();
                c.ellipse(offset, 0, lobeRx, lobeRy, 0, 0, Math.PI * 2);
                c.globalAlpha = 0.18;
                c.fill();
                c.globalAlpha = 1;
                c.stroke();
              }
              c.restore();
            }}
          />
        );
      }
    }
    return null;
  };

  const renderNativeEmbeddedObject = (embeddedObject: ChemDrawEmbeddedObject) => {
    const isSelected = selectedObjectIds.has(embeddedObject.id);
    const isHovered = hoveredNativeObjectId === embeddedObject.id;
    const stroke = isSelected || isHovered ? '#2196F3' : adaptColor('#6f7c8f');
    const fill = adaptColor('#f7fafc');
    const width = embeddedObject.bounds.right - embeddedObject.bounds.left;
    const height = embeddedObject.bounds.bottom - embeddedObject.bounds.top;
    return (
      <Group key={`embedded-${embeddedObject.id}`} listening={false}>
        <Rect
          x={embeddedObject.bounds.left}
          y={embeddedObject.bounds.top}
          width={width}
          height={height}
          fill={fill}
          stroke={stroke}
          strokeWidth={isSelected ? 2 : 1.2}
          dash={[6, 4]}
          cornerRadius={6}
        />
        <Text
          x={embeddedObject.bounds.left + 6}
          y={embeddedObject.bounds.top + 6}
          width={Math.max(24, width - 12)}
          text={embeddedObject.sourceFileName ?? embeddedObject.payloadKind.toUpperCase()}
          fontSize={11}
          fill={stroke}
          fontFamily={documentStyleSettings.nativeMetrics.captionFontFamily}
          ellipsis
        />
      </Group>
    );
  };

  const renderNativeTable = (table: ChemDrawTable) => {
    const isSelected = selectedObjectIds.has(table.id);
    const isHovered = hoveredNativeObjectId === table.id;
    const stroke =
      isSelected || isHovered ? '#2196F3' : adaptColor(table.style?.color ?? '#666666');
    const fill = adaptColor(table.style?.fillColor ?? '#ffffff');
    return (
      <Group key={`table-${table.id}`} listening={false}>
        <Rect
          x={table.bounds.left}
          y={table.bounds.top}
          width={table.bounds.right - table.bounds.left}
          height={table.bounds.bottom - table.bounds.top}
          fill={fill}
          stroke={stroke}
          strokeWidth={isSelected ? 2 : 1.2}
        />
        {table.cells.map((cell) => (
          <Group key={`table-${table.id}-${cell.id}`}>
            <Rect
              x={cell.boundsInParent.left}
              y={cell.boundsInParent.top}
              width={cell.boundsInParent.right - cell.boundsInParent.left}
              height={cell.boundsInParent.bottom - cell.boundsInParent.top}
              stroke={stroke}
              strokeWidth={1}
            />
            {cell.text && (
              <Text
                x={cell.boundsInParent.left + 4}
                y={cell.boundsInParent.top + 4}
                width={Math.max(16, cell.boundsInParent.right - cell.boundsInParent.left - 8)}
                text={cell.text.runs.map((run) => run.text).join('')}
                fontSize={11}
                fill={stroke}
                fontFamily={documentStyleSettings.nativeMetrics.captionFontFamily}
                align={cell.text.justification ?? 'center'}
              />
            )}
          </Group>
        ))}
      </Group>
    );
  };

  const renderNativeBracket = (bracket: ChemDrawBracket) => {
    const isSelected = selectedObjectIds.has(bracket.id);
    const isHovered = hoveredNativeObjectId === bracket.id;
    const color =
      isSelected || isHovered ? '#2196F3' : adaptColor(bracket.style?.color ?? '#888888');
    const width = bracket.bounds.right - bracket.bounds.left;
    const lip = Math.max(6, Math.min(12, Math.abs(width) * 0.16));
    return (
      <Group key={`bracket-${bracket.id}`} listening={false}>
        <Shape
          sceneFunc={(ctx: KonvaContext) => {
            const c = (ctx as KonvaContext & { _context: CanvasRenderingContext2D })._context;
            c.save();
            c.strokeStyle = color;
            c.lineWidth = isSelected ? 2 : 1.5;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.beginPath();
            c.moveTo(bracket.bounds.left + lip, bracket.bounds.top);
            c.lineTo(bracket.bounds.left, bracket.bounds.top);
            c.lineTo(bracket.bounds.left, bracket.bounds.bottom);
            c.lineTo(bracket.bounds.left + lip, bracket.bounds.bottom);
            c.moveTo(bracket.bounds.right - lip, bracket.bounds.top);
            c.lineTo(bracket.bounds.right, bracket.bounds.top);
            c.lineTo(bracket.bounds.right, bracket.bounds.bottom);
            c.lineTo(bracket.bounds.right - lip, bracket.bounds.bottom);
            c.stroke();
            c.restore();
          }}
        />
        {bracket.label && (
          <Text
            x={bracket.bounds.left}
            y={bracket.bounds.top - 16}
            width={Math.abs(width)}
            align="center"
            text={bracket.label}
            fontSize={12}
            fill={color}
            fontFamily="Arial"
          />
        )}
      </Group>
    );
  };

  const renderTextBox = (tb: TextBox) => {
    const isS = selectedTextBoxIds.has(tb.id);
    const isEditing = editingTextBoxId === tb.id;
    const baseColor = adaptColor(tb.color);
    const align = tb.textAlign ?? 'center';
    const lines = getTextBoxRenderLines(tb);
    const { textW, textH, cx, cy } = getTextBoxDimensions(tb);

    const runNodes: React.ReactNode[] = [];
    if (!isEditing) {
      lines.forEach((lineRuns, lineIdx) => {
        const lineW = lineRuns.reduce(
          (s, r) => s + measureRunWidth(r, tb.fontSize, tb.fontFamily),
          0,
        );
        const lineStartX =
          align === 'center' ? -lineW / 2 : align === 'right' ? textW / 2 - lineW : -textW / 2;
        let xCursor = lineStartX;
        const lineY = -textH / 2 + lineIdx * tb.fontSize;
        lineRuns.forEach((run, i) => {
          const fs = run.sub || run.sup ? tb.fontSize * 0.65 : tb.fontSize;
          const dy = run.sup ? -tb.fontSize * 0.38 : run.sub ? tb.fontSize * 0.2 : 0;
          const fontStyle =
            run.italic && run.bold
              ? 'bold italic'
              : run.bold
                ? 'bold'
                : run.italic
                  ? 'italic'
                  : 'normal';
          const w = measureRunWidth(run, tb.fontSize, tb.fontFamily);
          runNodes.push(
            <Text
              key={`${lineIdx}-${i}`}
              x={xCursor}
              y={lineY + dy}
              text={run.text}
              fontSize={fs}
              fontFamily={tb.fontFamily}
              fontStyle={fontStyle}
              fill={isS ? '#2196F3' : adaptColor(run.color || baseColor)}
              listening={false}
            />,
          );
          xCursor += w;
        });
      });
    }
    const pad = tb.fontSize * 0.25;
    return (
      <Group key={tb.id} x={cx} y={cy} rotation={tb.rotation ?? 0}>
        {isS && (
          <Rect
            x={-textW / 2 - pad}
            y={-textH / 2 - pad}
            width={textW + pad * 2}
            height={textH + pad * 2}
            stroke="#2196F3"
            strokeWidth={0.5}
            dash={[3, 2]}
            fill="transparent"
            listening={false}
          />
        )}
        {runNodes}
      </Group>
    );
  };

  const renderBond = (
    b: Bond,
    options?: {
      atomLookup?: Map<string, Atom>;
      atoms?: Atom[];
      bonds?: Bond[];
      visibleIntervals?: Map<string, Array<[number, number]>>;
      ringCentroids?: Map<string, { cx: number; cy: number; n: number }>;
    },
  ) => {
    const atomLookup = options?.atomLookup ?? atomById;
    const allAtoms = options?.atoms ?? sceneAtoms;
    const allBonds = options?.bonds ?? sceneBonds;
    const visibleIntervalsMap = options?.visibleIntervals ?? bondVisibleIntervals;
    const ringCentroidsMap = options?.ringCentroids ?? ringCentroids;
    const fA = atomLookup.get(b.from),
      tA = atomLookup.get(b.to);
    if (!fA || !tA) return null;
    const nativeBond = nativeBonds.get(b.id);
    const dx = tA.x - fA.x,
      dy = tA.y - fA.y,
      dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return null;
    const uX = dx / dist,
      uY = dy / dist;
    const startClip = getAtomBondClipOffset(fA, allAtoms, allBonds, uX, uY, documentStyleSettings);
    const endClip = getAtomBondClipOffset(tA, allAtoms, allBonds, -uX, -uY, documentStyleSettings);
    const sX = fA.x + uX * startClip,
      sY = fA.y + uY * startClip,
      eX = tA.x - uX * endClip,
      eY = tA.y - uY * endClip;
    const isS =
      selectedBondIds.has(b.id) || (selectedAtomIds.has(fA.id) && selectedAtomIds.has(tA.id));
    const isH = hoveredBondId === b.id;
    const baseColor = resolveBondColor(
      b.color ?? nativeBond?.style?.color,
      documentStyleSettings,
      isDarkMode,
    );
    const color = isS || isH ? '#2196F3' : baseColor,
      op = isH && !isS ? 0.5 : 1;
    const displayStyle =
      b.displayStyle ??
      (nativeBond?.display &&
      ['wavy', 'dash', 'bold', 'crossed', 'dative'].includes(nativeBond.display)
        ? nativeBond.display
        : undefined);
    const lineWidth =
      b.lineWidth ??
      (nativeBond?.style?.lineWidth != null
        ? convertNativeToCanvas(nativeBond.style.lineWidth, documentStyleSettings)
        : bondLineWidth);
    const visual = getBondVisualMetrics(lineWidth, dist, {
      documentStyleSettings,
      nativeBond,
    });
    const boldWidth = visual.boldWidth;
    const oX = -uY * visual.parallelOffset,
      oY = uX * visual.parallelOffset,
      lP = {
        stroke: color,
        strokeWidth: lineWidth,
        lineCap: 'round' as const,
        lineJoin: 'round' as const,
      };
    const visibleIntervals = visibleIntervalsMap.get(b.id) ?? [[0, 1]];
    const drawSegmentedLine = (
      keyPrefix: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      strokeWidth = lineWidth,
      dash?: number[],
    ) =>
      visibleIntervals.map(([startT, endT], index) => (
        <Line
          key={`${keyPrefix}-${index}`}
          points={[
            x1 + (x2 - x1) * startT,
            y1 + (y2 - y1) * startT,
            x1 + (x2 - x1) * endT,
            y1 + (y2 - y1) * endT,
          ]}
          stroke={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          dash={dash}
          listening={false}
        />
      ));
    const bondNeighborVectors =
      b.order === 2 || b.order === 3
        ? collectBondNeighborVectors({
            bond: b,
            fromAtom: fA,
            toAtom: tA,
            atomLookup,
            bonds: allBonds,
          })
        : null;
    if (displayStyle === 'wavy') {
      const points: number[] = [];
      const segments = 12;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const px = sX + (eX - sX) * t;
        const py = sY + (eY - sY) * t;
        const wave = Math.sin((t * Math.PI * segments) / 2);
        points.push(px + -uY * visual.waveAmplitude * wave, py + uX * visual.waveAmplitude * wave);
      }
      return (
        <Line
          key={b.id}
          points={points}
          stroke={color}
          strokeWidth={lineWidth}
          tension={0.5}
          opacity={op}
          listening={false}
        />
      );
    }
    if (displayStyle === 'dash')
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-dash`, sX, sY, eX, eY, lineWidth, [6, 4])}
        </Group>
      );
    if (displayStyle === 'bold')
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-bold`, sX, sY, eX, eY, boldWidth)}
        </Group>
      );
    if (displayStyle === 'crossed') {
      const mx = (sX + eX) / 2;
      const my = (sY + eY) / 2;
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-crossed-base`, sX, sY, eX, eY)}
          <Line
            points={[
              mx + -uY * visual.crossHalfLength,
              my + uX * visual.crossHalfLength,
              mx - -uY * visual.crossHalfLength,
              my - uX * visual.crossHalfLength,
            ]}
            {...lP}
          />
        </Group>
      );
    }
    if (displayStyle === 'dative') {
      const angle = Math.atan2(eY - sY, eX - sX);
      const hs = visual.dativeHeadSize;
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(
            `${b.id}-dative-shaft`,
            sX,
            sY,
            eX - Math.cos(angle) * hs,
            eY - Math.sin(angle) * hs,
          )}
          <Line
            points={[
              eX,
              eY,
              eX - hs * Math.cos(angle - Math.PI / 7),
              eY - hs * Math.sin(angle - Math.PI / 7),
            ]}
            {...lP}
          />
          <Line
            points={[
              eX,
              eY,
              eX - hs * Math.cos(angle + Math.PI / 7),
              eY - hs * Math.sin(angle + Math.PI / 7),
            ]}
            {...lP}
          />
        </Group>
      );
    }
    if (b.stereo === 1)
      return (
        <Line
          key={b.id}
          points={[
            sX,
            sY,
            eX + -uY * visual.stereoHalfWidth,
            eY + uX * visual.stereoHalfWidth,
            eX - -uY * visual.stereoHalfWidth,
            eY - uX * visual.stereoHalfWidth,
          ]}
          fill={color}
          closed
          opacity={op}
          lineJoin="round"
        />
      );
    if (b.stereo === 6) {
      const ds = [];
      const hN = visual.hashStepCount;
      for (let i = 0; i <= hN; i++) {
        const r = i / hN,
          px = sX + (eX - sX) * r,
          py = sY + (eY - sY) * r,
          w = visual.hashStartWidth + i * visual.hashStepWidth,
          dX = -uY * w,
          dY = uX * w;
        ds.push(
          <Line
            key={`${b.id}-${i}`}
            points={[px - dX, py - dY, px + dX, py + dY]}
            {...lP}
            opacity={op}
          />,
        );
      }
      return <Group key={b.id}>{ds}</Group>;
    }
    if (b.order === 1)
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-single`, sX, sY, eX, eY)}
        </Group>
      );
    if (b.order === 1.5) {
      const centroid = ringCentroidsMap.get(b.id);
      let sign = 1;
      if (centroid) {
        const mx = (fA.x + tA.x) / 2,
          my = (fA.y + tA.y) / 2;
        if ((centroid.cx - mx) * oX + (centroid.cy - my) * oY < 0) sign = -1;
      }
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-aromatic-base`, sX, sY, eX, eY)}
          {drawSegmentedLine(
            `${b.id}-aromatic-dash`,
            sX + sign * oX,
            sY + sign * oY,
            eX + sign * oX,
            eY + sign * oY,
            lineWidth,
            [...visual.aromaticDashPattern],
          )}
        </Group>
      );
    }
    if (b.order === 2) {
      const nativeSecondaryLineGeometry =
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
        return (
          <Group key={b.id} opacity={op}>
            {drawSegmentedLine(`${b.id}-double-primary`, sX, sY, eX, eY)}
            {drawSegmentedLine(
              `${b.id}-double-secondary`,
              nativeSecondaryLineGeometry!.startX,
              nativeSecondaryLineGeometry!.startY,
              nativeSecondaryLineGeometry!.endX,
              nativeSecondaryLineGeometry!.endY,
              lineWidth,
              [6, 4],
            )}
          </Group>
        );
      }
      if (nativeBond?.secondaryDisplay === 'bold')
        return (
          <Group key={b.id} opacity={op}>
            {drawSegmentedLine(`${b.id}-double-primary`, sX, sY, eX, eY)}
            {drawSegmentedLine(
              `${b.id}-double-secondary`,
              nativeSecondaryLineGeometry!.startX,
              nativeSecondaryLineGeometry!.startY,
              nativeSecondaryLineGeometry!.endX,
              nativeSecondaryLineGeometry!.endY,
            )}
          </Group>
        );
      const doubleBondMode = resolveDoubleBondMode(b.doubleBondMode ?? nativeBond?.doubleBondMode);
      const [primaryLine, secondaryLineGeometry] = getDoubleBondLineGeometry({
        startX: sX,
        startY: sY,
        endX: eX,
        endY: eY,
        unitX: uX,
        unitY: uY,
        normalX: oX,
        normalY: oY,
        mode: doubleBondMode,
        visual,
        fromAtom: fA,
        toAtom: tA,
        ringCentroid: ringCentroidsMap.get(b.id),
        startNeighborVectors: bondNeighborVectors?.from,
        endNeighborVectors: bondNeighborVectors?.to,
      });
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(
            `${b.id}-double-primary`,
            primaryLine.startX,
            primaryLine.startY,
            primaryLine.endX,
            primaryLine.endY,
          )}
          {drawSegmentedLine(
            `${b.id}-double-secondary`,
            secondaryLineGeometry.startX,
            secondaryLineGeometry.startY,
            secondaryLineGeometry.endX,
            secondaryLineGeometry.endY,
          )}
        </Group>
      );
    }
    if (b.order === 3) {
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
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-triple-center`, sX, sY, eX, eY)}
          {drawSegmentedLine(
            `${b.id}-triple-top`,
            topLine.startX,
            topLine.startY,
            topLine.endX,
            topLine.endY,
          )}
          {drawSegmentedLine(
            `${b.id}-triple-bottom`,
            bottomLine.startX,
            bottomLine.startY,
            bottomLine.endX,
            bottomLine.endY,
          )}
        </Group>
      );
    }
    if (nativeBond?.query?.allowedOrders?.length) {
      const queryLabel = nativeBond.query.allowedOrders.join('/');
      const topology = nativeBond.query.ringState ? ` ${nativeBond.query.ringState}` : '';
      return (
        <Group key={b.id} opacity={op}>
          {drawSegmentedLine(`${b.id}-query`, sX, sY, eX, eY, lineWidth, [5, 5])}
          <Text
            x={(sX + eX) / 2 - 24}
            y={(sY + eY) / 2 - 18}
            text={`${queryLabel}${topology}`}
            fontSize={10}
            fill={color}
            width={48}
            align="center"
            fontFamily="Arial"
          />
        </Group>
      );
    }
    return (
      <Group key={b.id} opacity={op}>
        {drawSegmentedLine(`${b.id}-fallback`, sX, sY, eX, eY)}
      </Group>
    );
  };

  const previewGroupProps = useMemo(
    () => getPreviewGroupProps(selectionPreviewTransform),
    [selectionPreviewTransform],
  );
  const previewAtoms = useMemo(() => {
    if (!selectionPreviewTransform || selectionPreviewTransform.movedAtomIds.size === 0) {
      return sceneAtoms;
    }
    return sceneAtoms.map((atom) =>
      selectionPreviewTransform.movedAtomIds.has(atom.id)
        ? {
            ...atom,
            ...transformPreviewPoint({ x: atom.x, y: atom.y }, selectionPreviewTransform),
          }
        : atom,
    );
  }, [sceneAtoms, selectionPreviewTransform]);
  const previewAtomById = useMemo(
    () => new Map(previewAtoms.map((atom) => [atom.id, atom])),
    [previewAtoms],
  );
  const previewMovedAtoms = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : previewAtoms.filter((atom) => selectionPreviewTransform.movedAtomIds.has(atom.id)),
    [previewAtoms, selectionPreviewTransform],
  );
  const previewAffectedBonds = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : sceneBonds.filter((bond) => selectionPreviewTransform.affectedBondIds.has(bond.id)),
    [sceneBonds, selectionPreviewTransform],
  );
  const previewRigidArrows = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : sceneArrows.filter((arrow) => selectionPreviewTransform.selectedObjectIds.has(arrow.id)),
    [sceneArrows, selectionPreviewTransform],
  );
  const previewRigidTextBoxes = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : sceneTextBoxes.filter((textBox) =>
            selectionPreviewTransform.selectedObjectIds.has(textBox.id),
          ),
    [sceneTextBoxes, selectionPreviewTransform],
  );
  const previewRigidGraphics = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : nativeGraphics.filter((graphic) =>
            selectionPreviewTransform.selectedObjectIds.has(graphic.id),
          ),
    [nativeGraphics, selectionPreviewTransform],
  );
  const previewRigidBrackets = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : nativeBrackets.filter((bracket) =>
            selectionPreviewTransform.selectedObjectIds.has(bracket.id),
          ),
    [nativeBrackets, selectionPreviewTransform],
  );
  const previewRigidEmbeddedObjects = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : nativeEmbeddedObjects.filter((embeddedObject) =>
            selectionPreviewTransform.selectedObjectIds.has(embeddedObject.id),
          ),
    [nativeEmbeddedObjects, selectionPreviewTransform],
  );
  const previewRigidTables = useMemo(
    () =>
      !selectionPreviewTransform
        ? []
        : nativeTables.filter((table) => selectionPreviewTransform.selectedObjectIds.has(table.id)),
    [nativeTables, selectionPreviewTransform],
  );

  // Bond overlay (shared between bond and atom tools)
  const activeDragPreview =
    tool === 'bond' ? bondTool.dragPreviewLine : tool === 'atom' ? atomTool.dragPreviewLine : null;
  const activeAtomId =
    tool === 'bond' ? bondTool.activeAtomId : tool === 'atom' ? atomTool.activeAtomId : null;
  const editingAtomId = atomTool.editingAtomId;

  const selCenter = getSelectionCenter();
  const selBBox = getSelectionBBox();

  return (
    <div
      style={{
        background: isDarkMode ? '#1e1e1e' : '#f5f5f5',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        ...(showGrid
          ? {
              backgroundImage: isDarkMode
                ? 'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)'
                : 'linear-gradient(rgba(0,0,180,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,180,0.07) 1px, transparent 1px)',
              backgroundSize: `${50 * stageScale}px ${50 * stageScale}px`,
              backgroundPosition: `${stagePos.x}px ${stagePos.y}px`,
            }
          : {}),
      }}
      onDragOver={(event) => {
        const hasImageFile = Array.from(event.dataTransfer?.items ?? []).some(
          (item) =>
            item.kind === 'file' &&
            (item.type === 'image/png' || item.type === 'image/jpeg' || item.type === 'image/jpg'),
        );
        if (!hasImageFile) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) =>
            file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/jpg',
        );
        if (files.length === 0) return;
        event.preventDefault();
        void (async () => {
          for (const file of files) {
            try {
              await insertEmbeddedImage({
                bytes: new Uint8Array(await file.arrayBuffer()),
                mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
                sourceFileName: file.name,
              });
            } catch (error) {
              useStore.getState().showToast(`Failed to import ${file.name}`);
              console.error(error);
            }
          }
        })();
      }}
    >
      {useNativeSceneSurface && (
        <DocumentRenderSurface
          ref={sceneSurfaceRef}
          scene={contentDocumentScene}
          width={width}
          height={height}
          stageScale={stageScale}
          stagePos={stagePos}
        />
      )}
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDblClick={handleDblClick}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={isCtrlDown || tool === 'pan'}
        onDragStart={() => {
          markInteractionActive();
          if ((tool === 'pan' || isCtrlDown) && stageRef.current)
            stageRef.current.container().style.cursor = 'grabbing';
        }}
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          setStagePos({ x: e.target.x(), y: e.target.y() });
          markInteractionIdle();
          if ((tool === 'pan' || isCtrlDown) && stageRef.current)
            stageRef.current.container().style.cursor = 'grab';
        }}
        style={{
          cursor:
            isCtrlDown || tool === 'pan'
              ? 'grab'
              : tool === 'select' && (hoveredScaleCorner === 'tl' || hoveredScaleCorner === 'br')
                ? 'nwse-resize'
                : tool === 'select' && (hoveredScaleCorner === 'tr' || hoveredScaleCorner === 'bl')
                  ? 'nesw-resize'
                  : tool === 'charge'
                    ? hoveredAtomId
                      ? 'pointer'
                      : 'crosshair'
                    : hoveredAtomId || hoveredBondId || hoveredArrowId
                      ? 'pointer'
                      : tool === 'text' && hoveredTextBoxId
                        ? 'move'
                        : tool === 'text'
                          ? 'text'
                          : 'crosshair',
        }}
      >
        {!useNativeSceneSurface && (
          <Layer listening={false}>
            {finitePageMetrics &&
              Array.from({ length: pageSetup.rows * pageSetup.columns }, (_, index) => {
                const row = Math.floor(index / pageSetup.columns);
                const column = index % pageSetup.columns;
                return (
                  <Rect
                    key={`page-tile-${row}-${column}`}
                    x={column * finitePageMetrics.pageWidthPx}
                    y={row * finitePageMetrics.pageHeightPx}
                    width={finitePageMetrics.pageWidthPx}
                    height={finitePageMetrics.pageHeightPx}
                    fill={isDarkMode ? '#242424' : '#ffffff'}
                    stroke={isDarkMode ? '#7a7a7a' : '#8a8a8a'}
                    strokeWidth={1}
                  />
                );
              })}
            {arrows.map((a) => renderArrow(a))}
            {bonds.map((bond) => renderBond(bond))}
            {nativeGraphics.map(renderNativeGraphic)}
            {nativeBrackets.map(renderNativeBracket)}
            {nativeEmbeddedObjects.map(renderNativeEmbeddedObject)}
            {nativeTables.map(renderNativeTable)}
            {textBoxes.map((tb) => renderTextBox(tb))}

            {sceneAtoms.map((a) => renderAtom(a))}
          </Layer>
        )}

        <Layer>
          {arrowPreview && arrowPreview.x1 !== arrowPreview.x2 && renderArrow(arrowPreview, true)}
          {selectionPreviewTransform &&
            previewAffectedBonds.map((bond) =>
              renderBond(bond, {
                atomLookup: previewAtomById,
                atoms: previewAtoms,
                bonds: sceneBonds,
              }),
            )}
          {selectionPreviewTransform &&
            previewMovedAtoms.map((atom) => renderAtom(atom, { keyPrefix: 'preview' }))}
          {selectionPreviewTransform && previewGroupProps && (
            <Group {...previewGroupProps}>
              {previewRigidArrows.map((arrow) => renderArrow(arrow))}
              {previewRigidGraphics.map(renderNativeGraphic)}
              {previewRigidBrackets.map(renderNativeBracket)}
              {previewRigidEmbeddedObjects.map(renderNativeEmbeddedObject)}
              {previewRigidTables.map(renderNativeTable)}
              {previewRigidTextBoxes.map((textBox) => renderTextBox(textBox))}
            </Group>
          )}
          {tool === 'ring' &&
            ringPreview &&
            (ringPreview.kind === 'template'
              ? ringPreview.placement.bonds
              : ringPreview.geometry.bonds
            )
              .filter((_, index) =>
                ringPreview.kind === 'template'
                  ? !ringPreview.placement.skippedBondIndices.has(index)
                  : true,
              )
              .map((bond, index) => {
                const atomsForPreview =
                  ringPreview.kind === 'template'
                    ? ringPreview.placement.atoms
                    : ringPreview.geometry.atoms;
                const from = atomsForPreview[bond.from];
                const to = atomsForPreview[bond.to];
                if (!from || !to) return null;
                return (
                  <Line
                    key={`ring-preview-${index}`}
                    points={[from.x, from.y, to.x, to.y]}
                    stroke={isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'}
                    strokeWidth={1.5}
                    dash={[4, 3]}
                    lineCap="round"
                    listening={false}
                  />
                );
              })}

          {tool === 'bond' &&
            activeDragPreview &&
            activeAtomId &&
            (() => {
              const s = atomById.get(activeAtomId);
              if (!s) return null;
              const spokeColor = isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
              return Array.from({ length: 24 }, (_, i) => {
                const angle = i * SNAP_ANGLE;
                return (
                  <Line
                    key={i}
                    points={[
                      s.x,
                      s.y,
                      s.x + Math.cos(angle) * bondLength,
                      s.y + Math.sin(angle) * bondLength,
                    ]}
                    stroke={spokeColor}
                    strokeWidth={0.8}
                    listening={false}
                  />
                );
              });
            })()}

          {activeDragPreview &&
            activeAtomId &&
            (() => {
              const s = atomById.get(activeAtomId);
              if (!s) return null;
              return (
                <Line
                  points={[s.x, s.y, activeDragPreview.x2, activeDragPreview.y2]}
                  stroke="#aaa"
                  strokeWidth={bondLineWidth}
                  dash={[5, 3]}
                  listening={false}
                />
              );
            })()}

          {!selectionPreviewTransform &&
            groups
              .filter(
                (g) =>
                  g.atomIds.some((id) => selectedAtomIds.has(id)) ||
                  (g.arrowIds ?? []).some((id) => selectedArrowIds.has(id)) ||
                  (g.textBoxIds ?? []).some((id) => selectedTextBoxIds.has(id)),
              )
              .map((g) => {
                const gAtoms = atoms.filter((a) => g.atomIds.includes(a.id));
                const gArrows = arrows.filter((a) => (g.arrowIds ?? []).includes(a.id));
                const gTextBoxes = textBoxes.filter((t) => (g.textBoxIds ?? []).includes(t.id));
                if (!gAtoms.length && !gArrows.length && !gTextBoxes.length) return null;
                const isOuter = !!g.childGroupIds?.length;
                const pad = isOuter ? 30 : 20;
                const allXs: number[] = [
                  ...gAtoms.map((a) => a.x),
                  ...gArrows.flatMap((a) => [a.x1, a.x2, a.cpx]),
                  ...gTextBoxes.map((t) => t.x),
                ];
                const allYs: number[] = [
                  ...gAtoms.map((a) => a.y),
                  ...gArrows.flatMap((a) => [a.y1, a.y2, a.cpy]),
                  ...gTextBoxes.map((t) => t.y),
                ];
                const minX = Math.min(...allXs) - pad;
                const minY = Math.min(...allYs) - pad;
                const maxX = Math.max(...allXs) + pad;
                const maxY = Math.max(...allYs) + pad;
                return (
                  <Rect
                    key={'grp-' + g.id}
                    x={minX}
                    y={minY}
                    width={maxX - minX}
                    height={maxY - minY}
                    fill="rgba(33,150,243,0.04)"
                    stroke={isOuter ? 'rgba(33,150,243,0.28)' : 'rgba(33,150,243,0.55)'}
                    strokeWidth={1}
                    dash={isOuter ? [8, 5] : [5, 3]}
                    cornerRadius={8}
                    listening={false}
                  />
                );
              })}

          {selectTool.isSelectionBoxActive &&
            selectTool.selectionBoxStart &&
            selectTool.selectionBoxEnd && (
              <Rect
                x={Math.min(selectTool.selectionBoxStart.x, selectTool.selectionBoxEnd.x)}
                y={Math.min(selectTool.selectionBoxStart.y, selectTool.selectionBoxEnd.y)}
                width={Math.abs(selectTool.selectionBoxEnd.x - selectTool.selectionBoxStart.x)}
                height={Math.abs(selectTool.selectionBoxEnd.y - selectTool.selectionBoxStart.y)}
                fill="#2196F3"
                opacity={0.1}
                stroke="#2196F3"
                strokeWidth={1}
              />
            )}

          {!selectTool.isSelectionBoxActive &&
            !editingTextBoxId &&
            (selectedAtomIds.size > 0 ||
              selectedArrowIds.size > 0 ||
              selectedTextBoxIds.size > 0) &&
            selCenter &&
            selBBox && (
              <Group>
                <Line
                  points={[selCenter.x, selBBox.minY, selCenter.x, selBBox.minY - 30]}
                  stroke="#2196F3"
                  strokeWidth={1}
                  dash={[2, 2]}
                />
                <Circle
                  x={selCenter.x}
                  y={selBBox.minY - 30}
                  radius={6}
                  fill="white"
                  stroke="#2196F3"
                  strokeWidth={2}
                />
              </Group>
            )}

          {!selectTool.isSelectionBoxActive &&
            !editingTextBoxId &&
            selBBox &&
            (selectedAtomIds.size > 0 ||
              selectedArrowIds.size > 0 ||
              selectedTextBoxIds.size > 0) &&
            (() => {
              const { minX, maxX, minY, maxY } = selBBox;
              const corners = [
                { key: 'tl', x: minX, y: minY, cursor: 'nwse-resize' },
                { key: 'tr', x: maxX, y: minY, cursor: 'nesw-resize' },
                { key: 'bl', x: minX, y: maxY, cursor: 'nesw-resize' },
                { key: 'br', x: maxX, y: maxY, cursor: 'nwse-resize' },
              ] as const;
              return (
                <Group>
                  <Rect
                    x={minX}
                    y={minY}
                    width={maxX - minX}
                    height={maxY - minY}
                    stroke="#2196F3"
                    strokeWidth={0.5}
                    dash={[4, 3]}
                    fill="transparent"
                    listening={false}
                    opacity={0.5}
                  />
                  {corners.map((c) => (
                    <Group key={c.key}>
                      <Line
                        points={[c.x - 6, c.y, c.x + 6, c.y]}
                        stroke="#2196F3"
                        strokeWidth={1.5}
                        listening={false}
                      />
                      <Line
                        points={[c.x, c.y - 6, c.x, c.y + 6]}
                        stroke="#2196F3"
                        strokeWidth={1.5}
                        listening={false}
                      />
                      <Circle
                        x={c.x}
                        y={c.y}
                        radius={4}
                        fill="white"
                        stroke="#2196F3"
                        strokeWidth={1.5}
                        listening={false}
                      />
                    </Group>
                  ))}
                </Group>
              );
            })()}
        </Layer>
        <Layer>
          {!selectTool.isSelectionBoxActive &&
            !editingTextBoxId &&
            !selectionPreviewTransform &&
            selectedElectronControlAtoms.map(renderElectronControlHandles)}
        </Layer>
        <Layer>
          {!selectionPreviewTransform &&
            arrows
              .filter((arrow) => selectedArrowIds.has(arrow.id) && arrowUsesControlPoint(arrow))
              .map(renderArrowControlHandle)}
        </Layer>
      </Stage>

      {editingAtomId &&
        (() => {
          const a = atoms.find((x) => x.id === editingAtomId);
          if (!a) return null;
          const nativeNode = nativeNodes.get(a.id);
          const { fontSize } = resolveDocumentLabelTextStyle(documentStyleSettings, {
            authored: { fontSize: a.labelFontSize },
            nativeStyle: nativeNode?.style,
          });
          const labelLayout = getAtomLabelLayoutMetrics(
            fontSize,
            getAtomLabelBoxWidth(fontSize, fontSize),
            documentStyleSettings,
          );
          const sX = a.x * stageScale + stagePos.x,
            sY = a.y * stageScale + stagePos.y;
          return (
            <input
              autoFocus
              value={atomTool.editingValue}
              onChange={(ev) => atomTool.setEditingValue(ev.target.value)}
              onFocus={(ev) => ev.target.select()}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  atomTool.handleFinishEditing();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  atomTool.closeEditor();
                }
              }}
              onBlur={atomTool.handleFinishEditing}
              style={{
                position: 'absolute',
                top: sY - (labelLayout.boxHeight * stageScale) / 2,
                left: sX - (labelLayout.boxWidth * stageScale) / 2,
                width: `${Math.max(56, labelLayout.boxWidth * stageScale + 12)}px`,
                textAlign: 'center',
                border: '1px solid #2196F3',
                borderRadius: '3px',
                fontSize: `${Math.max(14, fontSize * stageScale * 0.8)}px`,
                outline: 'none',
                background: isDarkMode ? '#2d2d2d' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                zIndex: 2000,
              }}
            />
          );
        })()}

      {editingTextBoxId &&
        (() => {
          const tb = textBoxes.find((t) => t.id === editingTextBoxId);
          if (!tb) return null;
          const screenX = tb.x * stageScale + stagePos.x;
          const screenY = tb.y * stageScale + stagePos.y;
          const scaledFontSize = tb.fontSize * stageScale;
          const align = tb.textAlign ?? 'center';
          const transformX = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0%';
          const rotation = tb.rotation ?? 0;
          const overlayWidth = tb.width ? tb.width * stageScale : undefined;
          return (
            <div
              ref={editOverlayRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              spellCheck={false}
              onFocus={() => {
                if (!editOverlayRef.current) return;
                const range = document.createRange();
                range.selectNodeContents(editOverlayRef.current);
                range.collapse(false);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
              }}
              onBlur={handleTextEditBlur}
              onPaste={handleTextEditPaste}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  ignoreNextBlurRef.current = false;
                  handleTextEditBlur();
                  ignoreNextBlurRef.current = true;
                  setSelectedTextBoxIds(new Set());
                }
              }}
              style={{
                position: 'absolute',
                left: screenX,
                top: screenY - 2,
                transform: `translateX(${transformX}) rotate(${rotation}deg)`,
                transformOrigin:
                  align === 'left' ? 'top left' : align === 'right' ? 'top right' : 'top center',
                minWidth: overlayWidth ?? 80,
                width: overlayWidth,
                minHeight: scaledFontSize + 4,
                fontSize: scaledFontSize,
                lineHeight: `${scaledFontSize}px`,
                fontFamily: tb.fontFamily,
                color: tb.color,
                textAlign: align,
                background: 'transparent',
                border: '1px dashed #2196F3',
                outline: 'none',
                zIndex: 2000,
                padding: '2px 4px',
                whiteSpace: tb.width ? 'pre-wrap' : 'nowrap',
                overflowWrap: tb.width ? 'anywhere' : 'normal',
                boxSizing: 'border-box' as const,
              }}
            />
          );
        })()}

      {!editMenusHidden && editingAtomLabel && atomLabelPanelLayout && (
        <FloatingPanel
          pos={atomLabelPanelLayout.pos}
          size={atomLabelPanelLayout.size}
          minWidth={220}
          minHeight={280}
          title="Atom Label"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) => setAtomLabelPanelLayout((prev) => (prev ? { ...prev, pos } : prev))}
          onSizeChange={(size) =>
            setAtomLabelPanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = atomLabelPanelLayout.align === 'right' ? 'left' : 'right';
                setAtomLabelPanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                atomLabelPanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {atomLabelPanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            onMouseDown={(ev) => {
              ev.stopPropagation();
            }}
            onClick={(ev) => {
              ev.stopPropagation();
            }}
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <input
              autoFocus
              value={editingAtomLabel.value}
              onChange={(ev) =>
                setEditingAtomLabel((prev) =>
                  prev ? { ...prev, value: ev.target.value, selectedCandidateId: undefined } : null,
                )
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitAtomLabelEdit();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingAtomLabel(null);
                }
              }}
              style={{
                width: '100%',
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '3px 6px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {editingAtomLabel.resolution && editingAtomLabel.value.trim() && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      editingAtomLabel.resolution.selected?.semanticKind === 'coordination' ||
                      editingAtomLabel.resolution.reason
                        ? '#ff8a65'
                        : '#888',
                  }}
                >
                  {editingAtomLabel.resolution.selected?.semanticKind === 'coordination'
                    ? 'Coordination-style ligand detected'
                    : editingAtomLabel.resolution.reason
                      ? aliasResolutionMessage(editingAtomLabel.resolution)
                      : editingAtomLabel.resolution.selected
                        ? `Resolved to ${editingAtomLabel.resolution.selected.subsSmiles ?? editingAtomLabel.resolution.selected.displayLabel}`
                        : 'Alias resolution pending'}
                </div>
                {editingAtomLabel.resolution.candidates.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: '#888' }}>Interpretation</div>
                    {editingAtomLabel.resolution.candidates.slice(0, 4).map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(ev) => {
                          ev.stopPropagation();
                        }}
                        onClick={() =>
                          setEditingAtomLabel((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  selectedCandidateId: candidate.id,
                                  resolution: resolveAliasChemistry(prev.value.trim() || 'C', {
                                    validateSmiles: aliasValidator,
                                    preferredCandidateId: candidate.id,
                                  }),
                                }
                              : null,
                          )
                        }
                        style={{
                          textAlign: 'left',
                          padding: '4px 6px',
                          background:
                            editingAtomLabel.selectedCandidateId === candidate.id
                              ? '#2196F3'
                              : isDarkMode
                                ? '#333'
                                : '#f5f5f5',
                          color:
                            editingAtomLabel.selectedCandidateId === candidate.id
                              ? '#fff'
                              : isDarkMode
                                ? '#fff'
                                : '#000',
                          border: `1px solid ${editingAtomLabel.selectedCandidateId === candidate.id ? '#2196F3' : isDarkMode ? '#555' : '#ccc'}`,
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {candidate.displayLabel}
                        {candidate.subsSmiles
                          ? ` -> ${candidate.subsSmiles}`
                          : ` (${candidate.semanticKind})`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Font</div>
                <input
                  value={editingAtomLabel.fontFamily}
                  onChange={(ev) =>
                    setEditingAtomLabel((prev) =>
                      prev ? { ...prev, fontFamily: ev.target.value } : null,
                    )
                  }
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    ev.nativeEvent.stopImmediatePropagation();
                  }}
                  style={{
                    width: '100%',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    padding: '3px 6px',
                    background: isDarkMode ? '#333' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    fontSize: 12,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ width: 54 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Size</div>
                <DeferredNumberInput
                  value={editingAtomLabel.fontSize}
                  min={6}
                  max={72}
                  step={1}
                  integer
                  onCommit={(fontSize) =>
                    setEditingAtomLabel((prev) =>
                      prev
                        ? {
                            ...prev,
                            fontSize,
                          }
                        : null,
                    )
                  }
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    ev.nativeEvent.stopImmediatePropagation();
                  }}
                  style={{
                    width: '100%',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    padding: '3px 6px',
                    background: isDarkMode ? '#333' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    fontSize: 12,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingAtomLabel.color}
                onChange={(ev) =>
                  setEditingAtomLabel((prev) =>
                    prev
                      ? {
                          ...prev,
                          color: ev.target.value,
                          colorExplicit: true,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Order</div>
              <div style={{ flex: 1 }}>
                {(() => {
                  const currentAtom = atoms.find((atom) => atom.id === editingAtomLabel.id);
                  const labelFirstPreview = currentAtom
                    ? getOrientationPreviewLabel(
                        currentAtom,
                        editingAtomLabel.value,
                        'label-first',
                        atoms,
                        bonds,
                        showHydrogens,
                      )
                    : 'Label first';
                  const hydrogenFirstPreview = currentAtom
                    ? getOrientationPreviewLabel(
                        currentAtom,
                        editingAtomLabel.value,
                        'hydrogen-first',
                        atoms,
                        bonds,
                        showHydrogens,
                      )
                    : 'Hydrogen first';
                  return (
                    <SelectMenu
                      value={editingAtomLabel.orientation}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'label-first', label: `Label first: ${labelFirstPreview}` },
                        {
                          value: 'hydrogen-first',
                          label: `Hydrogen first: ${hydrogenFirstPreview}`,
                        },
                      ]}
                      onChange={(orientation) =>
                        setEditingAtomLabel((prev) =>
                          prev
                            ? { ...prev, orientation: orientation as AtomLabelOrientation }
                            : null,
                        )
                      }
                      isDarkMode={isDarkMode}
                      textColor={isDarkMode ? '#fff' : '#000'}
                      borderColor={isDarkMode ? '#555' : '#ccc'}
                      backgroundColor={isDarkMode ? '#333' : '#fff'}
                      fontSize={12}
                      padding="3px 4px"
                    />
                  );
                })()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitAtomLabelEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingArrowStyle && arrowStylePanelLayout && (
        <FloatingPanel
          pos={arrowStylePanelLayout.pos}
          size={arrowStylePanelLayout.size}
          minWidth={210}
          minHeight={230}
          title={`Arrow · ${editingArrowStyle.type.replace(/-/g, ' ')}`}
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) =>
            setArrowStylePanelLayout((prev) => (prev ? { ...prev, pos } : prev))
          }
          onSizeChange={(size) =>
            setArrowStylePanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = arrowStylePanelLayout.align === 'right' ? 'left' : 'right';
                setArrowStylePanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                arrowStylePanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {arrowStylePanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            onMouseDown={(ev) => {
              ev.stopPropagation();
            }}
            onClick={(ev) => {
              ev.stopPropagation();
            }}
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingArrowStyle.color}
                onChange={(ev) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, color: ev.target.value } : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Width</div>
              <DeferredNumberInput
                value={editingArrowStyle.lineWidth}
                min={1}
                max={20}
                step={0.1}
                onCommit={(lineWidth) =>
                  setEditingArrowStyle((prev) =>
                    prev
                      ? {
                          ...prev,
                          lineWidth,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 52,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '3px 6px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Stroke</div>
              <SelectMenu
                value={editingArrowStyle.lineStyle}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'bold', label: 'Bold' },
                ]}
                onChange={(lineStyle) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, lineStyle: lineStyle as 'solid' | 'dashed' | 'bold' } : null,
                  )
                }
                isDarkMode={isDarkMode}
                textColor={isDarkMode ? '#fff' : '#000'}
                borderColor={isDarkMode ? '#555' : '#ccc'}
                backgroundColor={isDarkMode ? '#333' : '#fff'}
                fontSize={12}
                padding="3px 4px"
                width="100%"
              />
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: isDarkMode ? '#fff' : '#000',
                cursor:
                  editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                    ? 'default'
                    : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={editingArrowStyle.curveEnabled}
                disabled={
                  editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                }
                onChange={(ev) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, curveEnabled: ev.target.checked } : null,
                  )
                }
              />
              Bend handle
            </label>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.35 }}>
              {editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                ? 'This arrow always uses the star handle.'
                : editingArrowStyle.curveEnabled
                  ? 'Drag the star handle on-canvas to bend the arrow.'
                  : 'Turn this on to bend the arrow with the star handle.'}
            </div>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.35 }}>
              Double-click the arrow to edit labels above and below it.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitArrowStyleEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingBondStyle && bondStylePanelLayout && (
        <FloatingPanel
          pos={bondStylePanelLayout.pos}
          size={bondStylePanelLayout.size}
          minWidth={220}
          minHeight={280}
          title="Bond Style"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) => setBondStylePanelLayout((prev) => (prev ? { ...prev, pos } : prev))}
          onSizeChange={(size) =>
            setBondStylePanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = bondStylePanelLayout.align === 'right' ? 'left' : 'right';
                setBondStylePanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                bondStylePanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {bondStylePanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingBondStyle.color}
                onChange={(ev) =>
                  setEditingBondStyle((prev) => (prev ? { ...prev, color: ev.target.value } : null))
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Width</div>
              <DeferredNumberInput
                value={editingBondStyle.lineWidth}
                min={1}
                max={12}
                step={0.1}
                onCommit={(lineWidth) =>
                  setEditingBondStyle((prev) =>
                    prev
                      ? {
                          ...prev,
                          lineWidth,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 52,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '3px 6px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Display</div>
              <SelectMenu
                value={editingBondStyle.display}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dash', label: 'Dashed' },
                  { value: 'bold', label: 'Bold' },
                  { value: 'wavy', label: 'Wavy' },
                  { value: 'crossed', label: 'Crossed' },
                  { value: 'dative', label: 'Dative' },
                ]}
                onChange={(display) =>
                  setEditingBondStyle((prev) =>
                    prev ? { ...prev, display: display as BondDisplayStyle } : null,
                  )
                }
                isDarkMode={isDarkMode}
                textColor={isDarkMode ? '#fff' : '#000'}
                borderColor={isDarkMode ? '#555' : '#ccc'}
                backgroundColor={isDarkMode ? '#333' : '#fff'}
                fontSize={12}
                padding="3px 4px"
                width="100%"
              />
            </div>
            {editingBondStyle.order === 2 && (
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Double Bond</div>
                <SelectMenu
                  value={editingBondStyle.doubleBondMode}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'flipped', label: 'Short Line Opposite Side' },
                    { value: 'symmetric', label: 'Equal Length' },
                  ]}
                  onChange={(doubleBondMode) =>
                    setEditingBondStyle((prev) =>
                      prev
                        ? {
                            ...prev,
                            doubleBondMode: doubleBondMode as 'auto' | 'flipped' | 'symmetric',
                          }
                        : null,
                    )
                  }
                  isDarkMode={isDarkMode}
                  textColor={isDarkMode ? '#fff' : '#000'}
                  borderColor={isDarkMode ? '#555' : '#ccc'}
                  backgroundColor={isDarkMode ? '#333' : '#fff'}
                  fontSize={12}
                  padding="3px 4px"
                  width="100%"
                />
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Order</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => reorderEditingBond('front')}
                  disabled={!canBringBondToFront}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: 'transparent',
                    color: !canBringBondToFront ? '#888' : isDarkMode ? '#fff' : '#000',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    cursor: canBringBondToFront ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: canBringBondToFront ? 1 : 0.6,
                  }}
                >
                  Bring to Front
                </button>
                <button
                  type="button"
                  onClick={() => reorderEditingBond('back')}
                  disabled={!canBringBondToBack}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: 'transparent',
                    color: !canBringBondToBack ? '#888' : isDarkMode ? '#fff' : '#000',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    cursor: canBringBondToBack ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: canBringBondToBack ? 1 : 0.6,
                  }}
                >
                  Bring to Back
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitBondStyleEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingArrowLabels && arrowLabelsPanelLayout && (
        <FloatingPanel
          pos={arrowLabelsPanelLayout.pos}
          size={arrowLabelsPanelLayout.size}
          minWidth={176}
          minHeight={190}
          title="Arrow Labels"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) =>
            setArrowLabelsPanelLayout((prev) => (prev ? { ...prev, pos } : prev))
          }
          onSizeChange={(size) =>
            setArrowLabelsPanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = arrowLabelsPanelLayout.align === 'right' ? 'left' : 'right';
                setArrowLabelsPanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                arrowLabelsPanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {arrowLabelsPanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 11, color: '#888' }}>Above</div>
            <input
              autoFocus
              value={editingArrowLabels.above}
              onChange={(ev) =>
                setEditingArrowLabels((prev) => (prev ? { ...prev, above: ev.target.value } : null))
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitArrowLabels();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingArrowLabels(null);
                }
              }}
              style={{
                width: 130,
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '2px 4px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ fontSize: 11, color: '#888' }}>Below</div>
            <input
              value={editingArrowLabels.below}
              onChange={(ev) =>
                setEditingArrowLabels((prev) => (prev ? { ...prev, below: ev.target.value } : null))
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitArrowLabels();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingArrowLabels(null);
                }
              }}
              style={{
                width: 130,
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '2px 4px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Size</div>
              <DeferredNumberInput
                value={editingArrowLabels.fontSize}
                min={6}
                max={72}
                step={1}
                integer
                onCommit={(fontSize) =>
                  setEditingArrowLabels((prev) =>
                    prev
                      ? {
                          ...prev,
                          fontSize,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 44,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '2px 4px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingArrowLabels.color || (isDarkMode ? '#ffffff' : '#000000')}
                onChange={(ev) =>
                  setEditingArrowLabels((prev) =>
                    prev ? { ...prev, color: ev.target.value } : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 28,
                  height: 22,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
            </div>
            <button
              onClick={commitArrowLabels}
              style={{
                marginTop: 4,
                padding: '3px 0',
                background: '#2196F3',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              OK
            </button>
          </div>
        </FloatingPanel>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
        }}
      >
        <button
          onClick={() => setStageScale((s) => Math.min(s * 1.2, 10))}
          style={{
            width: '28px',
            height: '28px',
            background: isDarkMode ? '#333' : '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDarkMode ? '#fff' : '#000',
          }}
        >
          +
        </button>
        <button
          onClick={() => setStageScale((s) => Math.max(s / 1.2, 0.1))}
          style={{
            width: '28px',
            height: '28px',
            background: isDarkMode ? '#333' : '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDarkMode ? '#fff' : '#000',
          }}
        >
          -
        </button>
      </div>
    </div>
  );
});
