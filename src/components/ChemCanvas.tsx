import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Star } from 'react-konva';
import {
  createDeleteSelectionCommand,
  createMoveSelectionCommand,
  createReplaceDocumentCommand,
  createUpsertObjectsCommand,
} from '../editor/commands';
import { buildDocumentIndex } from '../editor/document';
import {
  DocumentRenderSurface,
  type DocumentRenderSurfaceRef,
} from '../editor/scene/DocumentRenderSurface';
import { buildDocumentSceneState, buildLegacySceneState } from '../editor/scene/buildScene';
import { hitTestDocumentScene } from '../editor/scene/hitTest';
import { buildPreviewScene } from '../editor/scene/preview';
import type { DocumentSceneState } from '../editor/scene/renderDocumentScene';
import { createEditorSessionState } from '../editor/session';
import { useCanvasDocumentController } from '../hooks/useCanvasDocumentController';
import { useCanvasKeyboard } from '../hooks/useCanvasKeyboard';
import { useRDKit } from '../hooks/useRDKit';
import { buildAliasResolutionSnapshot, resolveAliasChemistry } from '../lib/aliasChemistry';
import {
  getAtomAlias,
  getAtomLeadElement,
  getAtomNodeText,
  isAliasAtom,
  setAtomValue,
} from '../lib/atomIdentity';
import {
  aliasResolutionMessage,
  buildAliasValidator,
  buildChemistryMolblockInputs,
  getCanvasContentBounds,
  hasCustomChemistryLabel,
  resolveChemicalInput,
  tryGetSmilesFromMolblock,
} from '../lib/canvasChemistry';
import { getCornerPanelX } from '../lib/canvasPanels';
import {
  convertNativeToCanvas,
  DEFAULT_CANVAS_BOND_LENGTH,
  getDocumentCaptionFontSize,
  resolveDocumentCaptionTextStyle,
  resolveDocumentLabelTextStyle,
} from '../lib/chemdrawMetrics';
import {
  applyArrowStyleEdit,
  applyBondStyleEdit,
  applyNodeLabelStyleEdit,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
  reorderBondObjects,
} from '../lib/chemdrawModel';
import { evaluateTextBoxChemicalState } from '../lib/chemicalText';
import {
  applyElectronToolToAtom,
  getAtomElectronMarkerGeometry,
  updateAtomElectronMarkerAngle,
} from '../lib/electronAnnotations';
import { buildPdfHexForRasterImage, fitImageWithinViewport } from '../lib/embeddedObjects';
import {
  getConnectedComponents,
  getFullySelectedComponentAtomIds,
  graphToMolblock,
  hashCanvasState,
  molblockToState,
  normalizeMolblockBondLength,
  parseMolblockGeometry,
  SNAP_ANGLE,
} from '../lib/graph';
import { readModifierKeyState } from '../lib/keyboard';
import {
  arrowUsesControlPoint,
  DEFAULT_ATOM_LABEL_FONT_SIZE,
  DEFAULT_DOUBLE_BOND_MODE,
  getArrowSelectionPoints,
  getAtomLabelLayoutMetrics,
  getDefaultArrowControlPoint,
  getDefaultArrowLineWidth,
  resolveDoubleBondMode,
} from '../lib/renderGeometry';
import {
  getPreferredAttachmentAngle,
  getRegularRingGeometry,
  isRingTemplatePreset,
  materializeResolvedRingTemplatePlacement,
  materializeRingGeometry,
  resolveRingTemplatePlacement,
  type ResolvedRingTemplatePlacement,
  type RingGeometry,
} from '../lib/ringTemplates';
import { getPageSetupDimensionsPx, resolveAtomLabelColor, resolveBondColor } from '../lib/settings';
import {
  extractRunsFromDOM,
  getTextBoxDimensions,
  insertPlainTextIntoEditable,
  runsToHTML,
} from '../lib/textRunPresentation';
import type { SelectionPreviewTransform, ViewerStructureStatus } from '../store';
import { commitCanvasEdit, getCanvasEditorState, previewCanvasEdit, useStore } from '../store';
import { useAtomTool } from '../tools/useAtomTool';
import { useBondTool } from '../tools/useBondTool';
import { useSelectTool } from '../tools/useSelectTool';
import type { ChemCanvasRef, EditPanelLayout } from '../types/canvas';
import type { ChemDrawBracket, ChemDrawEmbeddedObject, ChemDrawGraphic } from '../types/chemdraw';
import type {
  Arrow,
  ArrowType,
  Atom,
  AtomLabelOrientation,
  Bond,
  BondDisplayStyle,
  CanvasState as ChemistryCanvasState,
  TextBox,
} from '../types/chemistry';
import { CanvasTextEditors } from './CanvasTextEditors';

interface Props {
  width: number;
  height: number;
}

export type { ChemCanvasRef } from '../types/canvas';

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
  } = getCanvasEditorState();

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
  const previewHiddenObjectIds = useMemo(() => new Set<string>(), []);

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
  const { atomById, bondById, arrowById, textBoxById, nativeNodes, nativeBonds, nativeArrows } =
    legacySceneState;
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
      getCanvasEditorState().showToast('Chemistry engine failed to load — drawing tools disabled');
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
    const tb = getCanvasEditorState().textBoxes?.find((t) => t.id === editingTextBoxId);
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
        previewMode: getCanvasEditorState().previewMode,
        showViewer: getCanvasEditorState().showViewer,
        viewerMode: getCanvasEditorState().viewerMode,
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
      showValenceErrors: true,
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
      showValenceErrors: true,
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
      const store = getCanvasEditorState();
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
  const prevDocumentRef = useRef(chemDrawDocument);
  useEffect(() => {
    if (prevToolRef.current !== tool || prevDocumentRef.current !== chemDrawDocument) {
      bondTool.cleanup();
      selectTool.cleanup();
      atomTool.cleanup();
      textToolDragRef.current = null;
      setArrowPreview(null);
      setRingPreview(null);
      getCanvasEditorState().clearPreviewChemDrawDocument();
      getCanvasEditorState().clearSelectionPreviewTransform();
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
      prevDocumentRef.current = chemDrawDocument;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, chemDrawDocument]);

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
          const { isInputFocused } = getCanvasEditorState();
          if (!isInputFocused) setEditableSmiles(fullSmiles);
        }

        // Always re-evaluate which component to display (cheap — just pick from cache)
        const cached = cachedCompsRef.current;
        if (!cached) return;
        const {
          selectedAtomIds: selIds,
          lastInteractedAtomId,
          isInputFocused,
        } = getCanvasEditorState();
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
    const {
      atoms: ka,
      bonds: kb,
      arrows: karr,
      groups: kg,
      textBoxes: ktb,
    } = getCanvasEditorState();
    commitCanvasEdit({
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
  }, [documentStyleSettings, editingArrowLabels]);

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
    } = getCanvasEditorState();

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

    commitCanvasEdit({
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
  }, [commitNativeDocument, editingArrowStyle, isDarkMode]);

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
    } = getCanvasEditorState();
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
    commitCanvasEdit({
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
  }, [commitNativeDocument, documentStyleSettings, editingBondStyle, isDarkMode]);

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
      } = getCanvasEditorState();
      const nextBonds = reorderBondStack(kb, editingBondStyle.id, direction);
      if (nextBonds === kb) return;
      if (nativeDocument) {
        const nextDocument = reorderBondObjects(nativeDocument, editingBondStyle.id, direction);
        commitNativeDocument(nextDocument, 'reorder-bond-objects');
        return;
      }
      commitCanvasEdit({
        atoms: ka,
        bonds: nextBonds,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: ktb ?? [],
      });
    },
    [commitNativeDocument, editingBondStyle],
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
    } = getCanvasEditorState();
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
      getCanvasEditorState().showToast(
        'Choose one alias interpretation before applying this label.',
      );
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

    commitCanvasEdit({
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
  ]);

  const handleTextEditBlur = useCallback(() => {
    if (ignoreNextBlurRef.current) {
      ignoreNextBlurRef.current = false;
      return;
    }
    if (!editingTextBoxId || !editOverlayRef.current) return;
    const {
      atoms: ka,
      bonds: kb,
      arrows: karr,
      groups: kg,
      textBoxes: ktb,
    } = getCanvasEditorState();
    const existingTextBox = (ktb ?? []).find((textBox) => textBox.id === editingTextBoxId);
    const semanticMode = existingTextBox?.semanticMode ?? 'auto';
    const chemistry = evaluateTextBoxChemicalState(
      extractRunsFromDOM(editOverlayRef.current),
      semanticMode,
      { validateSmiles: aliasValidator },
    );
    const runs = chemistry.normalizedRuns;
    if (runs.length === 0 || runs.every((r) => !r.text.trim())) {
      commitCanvasEdit({
        atoms: ka,
        bonds: kb,
        arrows: karr,
        groups: kg ?? [],
        textBoxes: (ktb ?? []).filter((t) => t.id !== editingTextBoxId),
      });
    } else {
      commitCanvasEdit({
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
  }, [aliasValidator, editingTextBoxId]);

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
      } = getCanvasEditorState();
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
      commitCanvasEdit({
        atoms: [...stAtoms, ...newAtoms],
        bonds: [...stBonds, ...newBonds],
        arrows: stArrows,
        groups: stGroups ?? [],
        textBoxes: stTextBoxes ?? [],
      });
    },
    [documentStyleSettings.bondLength, rdkit],
  );

  const resolveRingGeometryAtPointer = useCallback(
    (
      pos: { x: number; y: number },
      hitAtom: Atom | null,
      hitBond: Bond | null,
    ): RingPlacementPreview => {
      const { atoms: currentAtoms, bonds: currentBonds } = getCanvasEditorState();
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

  useCanvasKeyboard({
    cancelSelectionDrag: () => {
      selectionDragRef.current.isDragging = false;
      selectionDragRef.current.sourceDocument = null;
    },
    syncModifierKeys,
    atomTool,
    editingTextBoxId,
    editingArrowLabels,
    editingAtomLabel,
    editingBondStyle,
    editingArrowStyle,
    hoveredAtomId,
    hoveredBondId,
    setSelectedBondIds,
    setSelectedAtomIds,
    setSelectedArrowIds,
    setSelectedTextBoxIds,
    hoveredArrowId,
    hoveredTextBoxId,
    bondTool,
    selectTool,
    textToolDragRef,
    setArrowPreview,
    setRingPreview,
    setEditingArrowLabels,
    setEditingTextBoxId,
    setEditingAtomLabel,
    setEditingBondStyle,
    setEditingArrowStyle,
    bondLength,
    placeFragmentAt,
    setLastInteractedAtomId,
    commitNativeDocument,
    hoveredNativeObjectId,
    setIsCtrlDown,
  });

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
    } = getCanvasEditorState();
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
        } = getCanvasEditorState();
        commitCanvasEdit({
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
        } = getCanvasEditorState();
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
        commitCanvasEdit({
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
        if (result.message) getCanvasEditorState().showToast(result.message, 'info');
        return;
      }
      const nA = atoms.map((a) => (a.id === hitA.id ? result.atom : a));
      const { groups: kg, textBoxes: ktb } = getCanvasEditorState();
      commitCanvasEdit({ atoms: nA, bonds, arrows, groups: kg ?? [], textBoxes: ktb ?? [] });
      return;
    }
    if (tool === 'eraser') {
      const { groups: kg, textBoxes: ktb } = getCanvasEditorState();
      if (hitA)
        commitCanvasEdit({
          atoms: atoms.filter((a) => a.id !== hitA.id),
          bonds: bonds.filter((b) => b.from !== hitA.id && b.to !== hitA.id),
          arrows,
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else if (hitB)
        commitCanvasEdit({
          atoms,
          bonds: bonds.filter((b) => b.id !== hitB.id),
          arrows,
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else if (hitArr)
        commitCanvasEdit({
          atoms,
          bonds,
          arrows: arrows.filter((a) => a.id !== hitArr.id),
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      else {
        if (hitTB)
          commitCanvasEdit({
            atoms,
            bonds,
            arrows,
            groups: kg ?? [],
            textBoxes: (ktb ?? []).filter((t) => t.id !== hitTB.id),
          });
        else if (hitNative && getCanvasEditorState().chemDrawDocument) {
          getCanvasEditorState().dispatchEditorCommand(
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
      const { atoms: ka, bonds: kb, groups: kg, textBoxes: ktb } = getCanvasEditorState();
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
      commitCanvasEdit({
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
      } = getCanvasEditorState();
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
      previewCanvasEdit({
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
        } = getCanvasEditorState();
        previewCanvasEdit({
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
        const { groups: kg, textBoxes: ktb } = getCanvasEditorState();
        commitCanvasEdit({
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
      } = getCanvasEditorState();
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
      commitCanvasEdit({
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
        } = getCanvasEditorState();
        commitCanvasEdit({
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

  const fileController = useCanvasDocumentController(resetStageView, () =>
    sceneSurfaceRef.current?.toDataURL({
      pixelRatio: 3,
      width: finitePageMetrics?.totalWidthPx ?? width,
      height: finitePageMetrics?.totalHeightPx ?? height,
      stageScale,
      stagePos,
      drawPageChrome: false,
    }),
  );

  useImperativeHandle(
    ref,
    () => ({
      ...fileController,
      insertImage: async (options) => {
        try {
          await insertEmbeddedImage(options);
        } catch (error) {
          getCanvasEditorState().showToast('Image insertion failed');
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
        } = getCanvasEditorState();
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
          getCanvasEditorState().setChemDrawWarnings([]);
          commitCanvasEdit({
            atoms: [],
            bonds: [],
            arrows: getCanvasEditorState().arrows,
            groups: [],
            textBoxes: [],
          });
          return;
        }
        try {
          const resolved = resolveChemicalInput(rdkit, input, aliasValidator);
          if (!resolved?.molblock) {
            getCanvasEditorState().showToast('Invalid SMILES or formula');
            return;
          }
          const newState = molblockToState(
            resolved.molblock,
            width,
            height,
            getCanvasEditorState().arrows,
          );
          getCanvasEditorState().setChemDrawWarnings([]);
          commitCanvasEdit({ ...newState, textBoxes: [] });
        } catch (e) {
          getCanvasEditorState().showToast('Failed to load structure');
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
        } = getCanvasEditorState();
        commitCanvasEdit({
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
            getCanvasEditorState().showToast('Invalid SMILES or formula');
            return;
          }
          const parsed = molblockToState(resolved.molblock, width, height, []);
          const {
            atoms: ka,
            bonds: kb,
            arrows: karr,
            groups: kg,
            textBoxes: ktb,
          } = getCanvasEditorState();
          getCanvasEditorState().setChemDrawWarnings([]);
          commitCanvasEdit({
            atoms: [...ka, ...parsed.atoms],
            bonds: [...kb, ...parsed.bonds],
            arrows: karr,
            groups: kg ?? [],
            textBoxes: ktb ?? [],
          });
          setSelectedAtomIds(new Set(parsed.atoms.map((a) => a.id)));
          setSelectedArrowIds(new Set());
        } catch (e) {
          getCanvasEditorState().showToast('Failed to add structure');
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
        } = getCanvasEditorState();
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
            getCanvasEditorState().setChemDrawWarnings([]);
            commitCanvasEdit({
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
            getCanvasEditorState().showToast('Structure cleanup failed');
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
            getCanvasEditorState().setChemDrawWarnings([]);
            commitCanvasEdit({
              atoms: newAtoms,
              bonds: newBonds,
              arrows: arr,
              textBoxes: tb ?? [],
            });
          }
        } catch (e) {
          getCanvasEditorState().showToast('Structure cleanup failed');
          console.error(e);
        }
      },
      applyTextFormat: (cmd: string, value?: string) => {
        if (editOverlayRef.current && document.activeElement === editOverlayRef.current) {
          document.execCommand(cmd, false, value);
        }
      },
      fitToScreen: () => {
        const {
          atoms,
          arrows,
          textBoxes: tb,
          pageSetup: currentPageSetup,
        } = getCanvasEditorState();
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
        } = getCanvasEditorState();
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
          getCanvasEditorState().showToast(
            'Content is already inside the finite page area.',
            'info',
          );
          return;
        }
        commitCanvasEdit({
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
        getCanvasEditorState().showToast('Moved content into the finite page area.', 'info');
      },
      centerPageInView: () => {
        const { pageSetup: currentPageSetup } = getCanvasEditorState();
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
      fileController,
      aliasValidator,
      documentStyleSettings,
      insertEmbeddedImage,
      rdkit,
      resetStageView,
      width,
      height,

      setSelectedAtomIds,
      setSelectedArrowIds,
      setSelectedTextBoxIds,
      resolveAliasEntry,
    ],
  );

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
        } = getCanvasEditorState();
        previewCanvasEdit({
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
        } = getCanvasEditorState();
        commitCanvasEdit({
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
      } = getCanvasEditorState();
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
      if (commit) commitCanvasEdit(nextState);
      else previewCanvasEdit(nextState);
    },
    [],
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

  const activeDragPreview =
    tool === 'bond' ? bondTool.dragPreviewLine : tool === 'atom' ? atomTool.dragPreviewLine : null;
  const activeAtomId =
    tool === 'bond' ? bondTool.activeAtomId : tool === 'atom' ? atomTool.activeAtomId : null;
  const editingAtomId = atomTool.editingAtomId;
  const selCenter = getSelectionCenter();
  const selBBox = getSelectionBBox();

  const visibleScene = useMemo(
    () =>
      buildPreviewScene(contentDocumentScene, activeChemDrawDocument, {
        transform: selectionPreviewTransform,
        arrow: arrowPreview,
        ring: tool === 'ring' ? ringPreview : null,
        line:
          (tool === 'atom' || tool === 'bond') && activeDragPreview && activeAtomId
            ? {
                ...activeDragPreview,
                fromId: activeAtomId,
                element: tool === 'atom' ? useStore.getState().element : 'C',
                alias: tool === 'atom' && useStore.getState().atomToolMode === 'alias',
                order: tool === 'bond' ? useStore.getState().bondOrder : 1,
                stereo: tool === 'bond' ? useStore.getState().stereo : 0,
              }
            : null,
      }),
    [
      contentDocumentScene,
      activeChemDrawDocument,
      selectionPreviewTransform,
      arrowPreview,
      tool,
      ringPreview,
      activeDragPreview,
      activeAtomId,
    ],
  );
  const exportScene = useMemo(
    () =>
      buildDocumentSceneState({
        document: chemDrawDocument,
        canvasState: { atoms, bonds, arrows, groups, textBoxes },
        documentStyleSettings,
        documentViewSettings,
        pageSetup,
        interaction: { isDarkMode, showHydrogens },
      }),
    [
      chemDrawDocument,
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      documentStyleSettings,
      documentViewSettings,
      pageSetup,
      isDarkMode,
      showHydrogens,
    ],
  );

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
              getCanvasEditorState().showToast(`Failed to import ${file.name}`);
              console.error(error);
            }
          }
        })();
      }}
    >
      {
        <DocumentRenderSurface
          ref={sceneSurfaceRef}
          scene={visibleScene}
          exportScene={exportScene}
          width={width}
          height={height}
          stageScale={stageScale}
          stagePos={stagePos}
        />
      }
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
        <Layer>
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

      <CanvasTextEditors
        editingAtomId={editingAtomId}
        atoms={atoms}
        nativeNodes={nativeNodes}
        documentStyleSettings={documentStyleSettings}
        stageScale={stageScale}
        stagePos={stagePos}
        atomTool={atomTool}
        isDarkMode={isDarkMode}
        editingTextBoxId={editingTextBoxId}
        textBoxes={textBoxes}
        editOverlayRef={editOverlayRef}
        handleTextEditBlur={handleTextEditBlur}
        handleTextEditPaste={handleTextEditPaste}
        ignoreNextBlurRef={ignoreNextBlurRef}
        setSelectedTextBoxIds={setSelectedTextBoxIds}
        editMenusHidden={editMenusHidden}
        editingAtomLabel={editingAtomLabel}
        atomLabelPanelLayout={atomLabelPanelLayout}
        setEditMenusHidden={setEditMenusHidden}
        setAtomLabelPanelLayout={setAtomLabelPanelLayout}
        width={width}
        setEditingAtomLabel={setEditingAtomLabel}
        commitAtomLabelEdit={commitAtomLabelEdit}
        aliasValidator={aliasValidator}
        bonds={bonds}
        showHydrogens={showHydrogens}
        editingArrowStyle={editingArrowStyle}
        arrowStylePanelLayout={arrowStylePanelLayout}
        setArrowStylePanelLayout={setArrowStylePanelLayout}
        setEditingArrowStyle={setEditingArrowStyle}
        commitArrowStyleEdit={commitArrowStyleEdit}
        editingBondStyle={editingBondStyle}
        bondStylePanelLayout={bondStylePanelLayout}
        setBondStylePanelLayout={setBondStylePanelLayout}
        setEditingBondStyle={setEditingBondStyle}
        reorderEditingBond={reorderEditingBond}
        canBringBondToFront={canBringBondToFront}
        canBringBondToBack={canBringBondToBack}
        commitBondStyleEdit={commitBondStyleEdit}
        editingArrowLabels={editingArrowLabels}
        arrowLabelsPanelLayout={arrowLabelsPanelLayout}
        setArrowLabelsPanelLayout={setArrowLabelsPanelLayout}
        setEditingArrowLabels={setEditingArrowLabels}
        commitArrowLabels={commitArrowLabels}
      />

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
