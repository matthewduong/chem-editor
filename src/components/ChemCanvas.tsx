import type { UserTemplate } from '../lib/templates';
import { cancelGestures, ToolLifecycle } from '../editor/toolLifecycle';
import { useArrowTool } from '../tools/useArrowTool';
import { useShapeTool } from '../tools/useShapeTool';
import {
  applyShapeHandle,
  getShapeHandles,
  hasShapeHandles,
  type ShapeHandleId,
} from '../lib/shapeHandles';
import { useRingTool } from '../tools/useRingTool';
import { useTemplatePlacementTool } from '../tools/useTemplatePlacementTool';
import { useTextDragTool } from '../tools/useTextDragTool';
import { applyRingPlacement, type RingPlacementPreview } from '../lib/ringGesture';
import { useChainTool } from '../tools/useChainTool';
import { prepareCleanupCommand } from '../editor/commands/cleanup';
import { createRDKitChemistryService } from '../lib/chemistry/rdkit';
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
import { createProjectionEditCommand } from '../editor/commands/projectionEdit';
import { contractSelection, findNicknameForSelection } from '../lib/nicknames';
import { arrowConnectionPoint } from '../lib/arrowGesture';
import { genericNicknameBase } from '../lib/genericLabels';
import {
  fragmentAcross,
  fragmentationCaptions,
  fragmentationRadicals,
} from '../lib/massFragmentation';
import { createSymbolGraphic } from '../lib/shapeGesture';
import { extractDocumentSelection } from '../lib/documentClipboard';
import { prepareChemDrawDocumentForSave } from '../lib/chemdrawDocumentCommands';
import { computeStereoLabels } from '../lib/stereoLabels';
import { nameToSmiles, resolveNameToSmiles, structureToName } from '../lib/naming';
import {
  structureAsText,
  type EnhancedStereoGroups,
  type StructureTextFormat,
} from '../lib/structureText';
import { SHORTHAND_DATA } from '../lib/shorthand';
import {
  createDeleteSelectionCommand,
  createEditorCommandContext,
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
  applyNodeValueEdit,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
  reorderBondObjects,
} from '../lib/chemdrawModel';
import { evaluateTextBoxChemicalState } from '../lib/chemicalText';
import { chargeSymbolPlace, toggleChargeSymbol, type ChargeSymbolType } from '../lib/chargeSymbols';
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
  resolveRingTemplatePlacement,
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
import type {
  ChemDrawBracket,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawNode,
} from '../types/chemdraw';
import type {
  Arrow,
  ArrowType,
  Atom,
  AtomLabelOrientation,
  Bond,
  BondDisplayStyle,
  CanvasState as ChemistryCanvasState,
  ElectronToolMode,
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

const LEGACY_DEFAULT_VISUAL_BOND_LENGTH = 45;
const CHARGE_SYMBOL_BY_MODE: Partial<Record<ElectronToolMode, ChargeSymbolType>> = {
  'charge-positive-circled': 'CirclePlus',
  'charge-negative-circled': 'CircleMinus',
  'radical-cation': 'RadicalCation',
  'radical-anion': 'RadicalAnion',
};

/** A typed mass number: a positive integer, or null to clear the isotope. */
function parseIsotopeInput(value: string): number | null {
  const mass = Number.parseInt(value.trim(), 10);
  return Number.isInteger(mass) && mass > 0 && mass < 400 ? mass : null;
}

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
  const shapeKind = useStore((s) => s.shapeKind);
  const rotationPivot = useStore((s) => s.rotationPivot);
  const pivotDragRef = useRef(false);
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
  // A moved rotation centre belongs to the selection it was moved for.
  useEffect(() => {
    useStore.getState().setRotationPivot(null);
  }, [selectedObjectIds]);
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
  const [rdkitValidation, setRdkitValidation] = useState<{
    source: typeof chemDrawDocument;
    ids: Set<string>;
  } | null>(null);
  const rdkitInvalidAtomIds = useMemo(
    () => (rdkitValidation?.source === chemDrawDocument ? rdkitValidation.ids : new Set<string>()),
    [chemDrawDocument, rdkitValidation],
  );
  // View > Show Stereochemistry: CIP labels for the document they were computed from.
  const stereoLabelState = useStore((s) => s.stereoLabels);
  const showReactionRoles = useStore((s) => s.showReactionRoles);
  const stereoLabels = useMemo(
    () => (stereoLabelState?.source === chemDrawDocument ? stereoLabelState : undefined),
    [chemDrawDocument, stereoLabelState],
  );
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

  /**
   * Zoom so that `focus` (document coordinates; the middle of the view by default) stays where it
   * is on screen. The +/- buttons used to scale about the stage origin, so the view drifted off.
   */
  const zoomTo = useCallback(
    (nextScale: number, focus?: { x: number; y: number }) => {
      const clamped = Math.min(10, Math.max(0.1, nextScale));
      const screen = focus
        ? { x: focus.x * stageScale + stagePos.x, y: focus.y * stageScale + stagePos.y }
        : { x: width / 2, y: height / 2 };
      const anchor = focus ?? {
        x: (width / 2 - stagePos.x) / stageScale,
        y: (height / 2 - stagePos.y) / stageScale,
      };
      setStageScale(clamped);
      setStagePos({ x: screen.x - anchor.x * clamped, y: screen.y - anchor.y * clamped });
    },
    [height, stagePos, stageScale, width],
  );

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

  const activeChemDrawDocument = previewChemDrawDocument ?? chemDrawDocument;
  /** The one selected shape or arc that shows reshape handles, if any. */
  const reshapeTarget = useMemo(() => {
    if (tool !== 'select' || selectedObjectIds.size !== 1) return null;
    const [id] = selectedObjectIds;
    const object = chemDrawDocument?.pages[0]?.objects.find((entry) => entry.id === id);
    return object && hasShapeHandles(object) ? object : null;
  }, [chemDrawDocument, selectedObjectIds, tool]);
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
  const arrowTool = useArrowTool();
  const shapeTool = useShapeTool();
  const textDragTool = useTextDragTool();
  const arrowPreview = arrowTool.preview;
  const shapePreview = shapeTool.preview;
  // Reshaping one selected shape or arc by its handles: a gesture like the tools', previewed
  // through the scene and committed as one upsert.
  const reshapeRef = useRef<{
    source: ChemDrawDocument;
    object: ChemDrawObject;
    handle: ShapeHandleId;
    /** The shape as last dragged; state can lag a fast release by a render. */
    latest?: ChemDrawObject;
  } | null>(null);
  const [reshapePreview, setReshapePreview] = useState<ChemDrawObject | null>(null);
  const reshapeGesture = useMemo(
    () => ({
      isActive: () => reshapeRef.current !== null,
      cancel: () => {
        reshapeRef.current = null;
        setReshapePreview(null);
      },
    }),
    [],
  );

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
    /** Mass number as typed; empty for the natural element. */
    isotope: string;
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
      stereoLabels,
      showReactionRoles,
      showValenceErrors: true,
      showQueryMarkers: true,
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
      stereoLabels,
      showReactionRoles,
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
      stereoLabels,
      showReactionRoles,
      showValenceErrors: true,
      showQueryMarkers: true,
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
      stereoLabels,
      showReactionRoles,
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

  const templateTool = useTemplatePlacementTool();
  const gestureLifecycle = useRef(
    new ToolLifecycle<ReturnType<typeof getCanvasHitAt>, typeof chemDrawDocument>(),
  );
  const chainTool = useChainTool();
  const bondTool = useBondTool();
  const selectTool = useSelectTool();
  const atomTool = useAtomTool();

  const prevToolRef = useRef(tool);
  const prevDocumentRef = useRef(chemDrawDocument);
  useEffect(() => {
    if (prevToolRef.current !== tool || prevDocumentRef.current !== chemDrawDocument) {
      cancelAllGestures();
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
  // The bonds an atom has decide whether a whole-molecule acronym (DMF) is that molecule or a
  // substituent, so the resolver reads them through a ref rather than closing over stale state.
  const aliasBondsRef = useRef(bonds);
  aliasBondsRef.current = bonds;
  const resolveAliasForAtom = useMemo(() => {
    return (atom: Atom, label: string | undefined) => {
      if (!label) return { ok: false, reason: 'empty' as const, candidates: [] };
      const attachments = aliasBondsRef.current.reduce(
        (count, bond) => count + (bond.from === atom.id || bond.to === atom.id ? 1 : 0),
        0,
      );
      const key = `${label.trim()}::${atom.aliasResolution?.selectedCandidateId ?? ''}::${attachments === 0 ? 0 : 1}`;
      const cached = aliasResolutionCacheRef.current.get(key);
      if (cached) return cached;
      const resolution = resolveAliasChemistry(label, {
        validateSmiles: aliasValidator,
        preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
        attachments,
      });
      aliasResolutionCacheRef.current.set(key, resolution);
      return resolution;
    };
  }, [aliasValidator]);

  const resolveAliasEntry = useMemo(() => {
    return (atom: Atom, label: string | undefined) =>
      isAliasAtom(atom) ? resolveAliasForAtom(atom, label).selected?.entry : undefined;
  }, [resolveAliasForAtom]);

  const showStereochemistry = documentViewSettings.showStereochemistry === true;
  useEffect(() => {
    if (!showStereochemistry || !rdkit) return;
    const source = chemDrawDocument;
    const timer = window.setTimeout(() => {
      useStore.getState().setStereoLabels({
        source,
        ...computeStereoLabels(rdkit, atoms, bonds, resolveAliasEntry),
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [atoms, bonds, chemDrawDocument, rdkit, resolveAliasEntry, showStereochemistry]);

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
            // A generic label (R1, X, Q…) is a query atom, not a mistake: the structure has no
            // single chemistry, but it is not flagged.
            const hasUnknownLabels = vA.some(
              (atom) =>
                hasCustomChemistryLabel(atom, resolveAliasForAtom) &&
                genericNicknameBase(getAtomAlias(atom)) === null,
            );
            if (hasUnknownLabels) {
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
          setRdkitValidation({ source: chemDrawDocument, ids: invalidAtomIds });
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
    chemDrawDocument,
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

  /** Magnify / Reduce keep the selection in view (ChemDraw 17.1 guide, "Magnify"). */
  const zoomBy = (factor: number) => zoomTo(stageScale * factor, getSelectionCenter() ?? undefined);
  const zoomPercent = Math.round((stageScale / DEFAULT_STAGE_SCALE) * 100);
  // The imperative handle is built once; these read the current view when called.
  const zoomActionsRef = useRef({ zoomBy, zoomTo, getSelectionCenter });
  zoomActionsRef.current = { zoomBy, zoomTo, getSelectionCenter };

  /**
   * Structure > Expand Label: each selected nickname atom becomes its lead element and its
   * structure is laid out from it, away from the bond it hangs on, as one undo step.
   */
  const expandSelectedLabels = () => {
    const state = getCanvasEditorState();
    const source = state.chemDrawDocument;
    if (!source) return;
    const targets = state.atoms.filter(
      (atom) =>
        state.selectedAtomIds.has(atom.id) &&
        atom.alias &&
        SHORTHAND_DATA[atom.alias]?.subsSmiles &&
        SHORTHAND_DATA[atom.alias]?.valency === 1,
    );
    if (targets.length === 0) {
      state.showToast('Select a nickname label to expand.', 'info');
      return;
    }
    let document = source;
    for (const atom of targets) {
      document = applyNodeValueEdit(document, atom.id, SHORTHAND_DATA[atom.alias!]!.lead);
    }
    let next = chemDrawDocumentToCanvasState(document).state;
    for (const target of targets) {
      const atom = next.atoms.find((entry) => entry.id === target.id);
      if (!atom) continue;
      next =
        placeFragmentAt(
          SHORTHAND_DATA[target.alias!]!.subsSmiles!,
          { x: atom.x, y: atom.y },
          atom,
          undefined,
          false,
          { base: next },
        ) ?? next;
    }
    const expanded = createProjectionEditCommand(document, next, 'expand-label').apply(
      document,
      createEditorCommandContext({
        activePageId: document.pages[0]?.id ?? null,
        documentStyleSettings: state.documentStyleSettings,
        pageSetup: state.pageSetup,
      }),
    ).document;
    commitNativeDocument(expanded, 'expand-label');
  };

  /** Structure > Contract Label: the selected group becomes the nickname it is. */
  const contractSelectedLabel = () => {
    const state = getCanvasEditorState();
    const plan = findNicknameForSelection(state.atoms, state.bonds, state.selectedAtomIds);
    if ('error' in plan) {
      state.showToast(plan.error, 'info');
      return;
    }
    commitCanvasEdit(
      contractSelection(
        {
          atoms: state.atoms,
          bonds: state.bonds,
          arrows: state.arrows,
          groups: state.groups ?? [],
          textBoxes: state.textBoxes ?? [],
        },
        state.selectedAtomIds,
        plan,
      ),
    );
    state.setSelectedAtomIds(new Set([plan.rootId]));
  };
  /**
   * Edit > Copy As: the selection (or everything) as SMILES, InChI, InChIKey or a molfile, with
   * nicknames expanded; the text, or null when the chemistry engine cannot read it.
   */
  const structureTextForSelection = (format: StructureTextFormat): string | null => {
    if (!rdkit) return null;
    const state = getCanvasEditorState();
    const chosen = state.selectedAtomIds.size
      ? state.atoms.filter((atom) => state.selectedAtomIds.has(atom.id))
      : state.atoms;
    if (chosen.length === 0) return null;
    const ids = new Set(chosen.map((atom) => atom.id));
    const chosenBonds = state.bonds.filter((bond) => ids.has(bond.from) && ids.has(bond.to));
    const { molblock } = buildChemistryMolblockInputs(
      rdkit,
      chosen,
      chosenBonds,
      1,
      1,
      resolveAliasEntry,
    );
    // Enhanced stereo by molfile index: the canvas atoms come first, in order.
    const groups: EnhancedStereoGroups = { absolute: [], and: new Map(), or: new Map() };
    const nodes = new Map(
      (state.chemDrawDocument?.pages[0]?.objects ?? [])
        .filter((object): object is ChemDrawNode => object.type === 'node')
        .map((node) => [node.id, node]),
    );
    chosen.forEach((atom, index) => {
      const stereo = nodes.get(atom.id)?.enhancedStereo;
      if (!stereo) return;
      if (stereo.type === 'Absolute') groups.absolute.push(index + 1);
      else {
        const bucket = stereo.type === 'And' ? groups.and : groups.or;
        const n = stereo.group ?? 1;
        bucket.set(n, [...(bucket.get(n) ?? []), index + 1]);
      }
    });
    try {
      return structureAsText(rdkit, molblock, format, groups);
    } catch {
      return null;
    }
  };
  const labelActionsRef = useRef({ expandSelectedLabels, contractSelectedLabel });
  labelActionsRef.current = { expandSelectedLabels, contractSelectedLabel };
  /**
   * Structure > Name to Structure: the named structure, drawn where a selected caption holding the
   * name was (which it replaces) or at the middle of the view; one undo step. False when the name
   * is not read.
   */
  const structureFromName = (typed?: string): boolean => {
    if (!rdkit) return false;
    const state = getCanvasEditorState();
    const caption =
      typed === undefined
        ? (state.textBoxes ?? []).find((box) => state.selectedTextBoxIds.has(box.id))
        : undefined;
    const name = typed ?? caption?.runs.map((run) => run.text).join('') ?? '';
    const smiles = resolveNameToSmiles(name);
    const mol = smiles ? rdkit.get_mol(smiles) : null;
    if (!smiles || !mol) {
      state.showToast(`No structure for "${name.trim()}".`, 'info');
      return false;
    }
    mol.delete();
    const base = {
      atoms: state.atoms,
      bonds: state.bonds,
      arrows: state.arrows,
      groups: state.groups ?? [],
      textBoxes: (state.textBoxes ?? []).filter((box) => box.id !== caption?.id),
    };
    const point = caption
      ? { x: caption.x, y: caption.y }
      : { x: (width / 2 - stagePos.x) / stageScale, y: (height / 2 - stagePos.y) / stageScale };
    const next = placeFragmentAt(smiles, point, undefined, undefined, false, { base });
    if (!next) return false;
    commitCanvasEdit(next);
    return true;
  };

  /**
   * Structure > Structure to Name: each selected structure (or every one) named under itself as a
   * caption, one undo step. A name is used only if it reads back to the same structure.
   */
  const nameSelectedStructures = () => {
    if (!rdkit) return;
    const state = getCanvasEditorState();
    const chosen = state.selectedAtomIds.size
      ? new Set([...state.selectedAtomIds])
      : new Set(state.atoms.map((atom) => atom.id));
    const components = getConnectedComponents(state.atoms, state.bonds).filter((component) =>
      [...component].some((id) => chosen.has(id)),
    );
    const canonical = (molblockOrSmiles: string) => {
      const mol = rdkit.get_mol(molblockOrSmiles);
      if (!mol) return null;
      const out = mol.get_smiles();
      mol.delete();
      return out;
    };
    const style = resolveDocumentCaptionTextStyle(state.documentStyleSettings);
    const captions: TextBox[] = [];
    let unnamed = 0;
    for (const component of components) {
      const atoms = state.atoms.filter((atom) => component.has(atom.id));
      const bonds = state.bonds.filter(
        (bond) => component.has(bond.from) && component.has(bond.to),
      );
      const name = structureToName(atoms, bonds);
      const drawn = canonical(graphToMolblock(atoms, bonds, 1, 1).molblock);
      const read = name ? nameToSmiles(name) : null;
      if (!name || !drawn || !read || canonical(read) !== drawn) {
        unnamed += 1;
        continue;
      }
      const xs = atoms.map((atom) => atom.x);
      captions.push({
        id: crypto.randomUUID(),
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: Math.max(...atoms.map((atom) => atom.y)) + state.documentStyleSettings.bondLength,
        runs: [{ text: name }],
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: state.textFormat.color,
        textAlign: 'center',
        semanticMode: 'plain',
        conversionStatus: 'plain',
      });
    }
    if (captions.length) {
      commitCanvasEdit({
        atoms: state.atoms,
        bonds: state.bonds,
        arrows: state.arrows,
        groups: state.groups ?? [],
        textBoxes: [...(state.textBoxes ?? []), ...captions],
      });
    }
    if (unnamed) {
      state.showToast(
        `${unnamed} structure${unnamed === 1 ? ' has' : 's have'} no name here (only simple chains, cycloalkanes and benzenes are named).`,
        'info',
      );
    }
  };
  /**
   * Drag out to another app (ChemDraw 17.1 guide, "Transferring Objects"): the selection, or the
   * drawing, as CDXML, as SMILES where the chemistry engine reads it, and as a PNG of the drawing.
   */
  const dragPayload = (): { cdxml: string; smiles: string | null; png: string | null } | null => {
    const state = getCanvasEditorState();
    const document = state.chemDrawDocument;
    if (!document) return null;
    const selection = new Set([...state.selectedObjectIds, ...state.selectedAtomIds]);
    const fragment = selection.size ? extractDocumentSelection(document, selection) : null;
    const cdxml = prepareChemDrawDocumentForSave({ document: fragment ?? document }).xml;
    const png =
      sceneSurfaceRef.current?.toDataURL({
        pixelRatio: 2,
        width: finitePageMetrics?.totalWidthPx ?? width,
        height: finitePageMetrics?.totalHeightPx ?? height,
        stageScale,
        stagePos,
        drawPageChrome: false,
      }) ?? null;
    return { cdxml, smiles: structureTextForSelection('smiles'), png };
  };
  const namingRef = useRef({ structureFromName, nameSelectedStructures });
  namingRef.current = { structureFromName, nameSelectedStructures };

  const dragPayloadRef = useRef(dragPayload);
  dragPayloadRef.current = dragPayload;
  const structureTextRef = useRef(structureTextForSelection);
  structureTextRef.current = structureTextForSelection;

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
      isotope: atom.isotope != null ? String(atom.isotope) : '',
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
            isotope: prev.isotope,
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
        isotope: parseIsotopeInput(editingAtomLabel.isotope),
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
      /** Lay the fragment out on `base` and hand back the result instead of committing it. */
      dryRun?: { base: ChemistryCanvasState },
    ): ChemistryCanvasState | undefined => {
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
      } = dryRun?.base ?? getCanvasEditorState();
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
        // Orient by the anchor's own bonds, not every fragment atom: the bonds meeting the
        // hovered atom are what must fill its open side.
        const anchorNeighbors = fragBonds.flatMap((b) =>
          b.from === 0 ? [b.to] : b.to === 0 ? [b.from] : [],
        );
        const bestAngle = getPreferredAttachmentAngle(
          hitAtom,
          stAtoms,
          stBonds,
          preferInterior,
          anchorNeighbors.length,
        );
        let fSin = 0,
          fCos = 0;
        for (const i of anchorNeighbors) {
          const a = Math.atan2(fragAtoms[i].y - fragAtoms[0].y, fragAtoms[i].x - fragAtoms[0].x);
          fSin += Math.sin(a);
          fCos += Math.cos(a);
        }
        const fragAngle = anchorNeighbors.length > 0 ? Math.atan2(fSin, fCos) : 0;
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
      const next = {
        atoms: [...stAtoms, ...newAtoms],
        bonds: [...stBonds, ...newBonds],
        arrows: stArrows,
        groups: stGroups ?? [],
        textBoxes: stTextBoxes ?? [],
      };
      if (dryRun) return next;
      commitCanvasEdit(next);
      return undefined;
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

  const ringTool = useRingTool(resolveRingGeometryAtPointer);

  /**
   * Abandons every gesture in progress and clears their previews. The single place that
   * knows the full list, so Escape, a tool change, a document replacement and a cancelled
   * pointer cannot drift apart.
   */
  const cancelAllGestures = () => {
    gestureLifecycle.current.cancel();
    cancelGestures([
      templateTool,
      chainTool,
      ringTool,
      arrowTool,
      shapeTool,
      reshapeGesture,
      textDragTool,
      bondTool,
      atomTool,
      selectTool,
    ]);
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
    useStore.getState().clearPreviewChemDrawDocument();
    useStore.getState().clearSelectionPreviewTransform();
  };

  useCanvasKeyboard({
    cancelSelectionDrag: cancelAllGestures,
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
    // Reshape handles answer before anything else, even with a style panel open (clicking an
    // arc opens its panel, and the next press would otherwise only close it).
    if (reshapeTarget && chemDrawDocument) {
      const press = getRelativePointerPosition();
      const handle = getShapeHandles(reshapeTarget).find(
        (entry) => Math.hypot(press.x - entry.x, press.y - entry.y) < 6 / stageScale,
      );
      if (handle) {
        if (editingArrowStyle) commitArrowStyleEdit();
        if (editingArrowLabels) commitArrowLabels();
        // Closing a panel commits its edit, so the gesture starts on the document that leaves.
        const source = useStore.getState().chemDrawDocument;
        const object = source?.pages[0]?.objects.find((entry) => entry.id === reshapeTarget.id);
        if (!source || !object) return;
        // That change is this gesture's own; the document-change effect must not cancel it.
        prevDocumentRef.current = source;
        // Through the shared lifecycle, whose commit gates every pointer-up.
        gestureLifecycle.current.begin(source, {
          point: press,
          hit: getCanvasHitAt(press.x, press.y),
          modifiers,
        });
        reshapeRef.current = { source, object, handle: handle.id };
        return;
      }
    }
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

    gestureLifecycle.current.begin(useStore.getState().chemDrawDocument, {
      point: pos,
      hit,
      modifiers,
    });
    if (templateTool.isActive()) return;
    if (tool === 'chain') {
      chainTool.begin({ point: pos, hit: hitA, modifiers }, { repeatLast: e.evt.altKey });
      return;
    }
    if (hitA) setLastInteractedAtomId(hitA.id);

    // Cross-tool: drag selected atoms/bonds
    const {
      chemDrawDocument: nativeDocument,
      selectedAtomIds: selIds,
      selectedBondIds: selBondIds,
      selectedObjectIds: selObjectIds,
      bonds: selectedBonds,
      selectMode,
    } = getCanvasEditorState();
    // Structure Perspective tilts what is pressed inside the selection instead of moving it.
    const tiltsSelection = tool === 'select' && selectMode === 'perspective';
    if (hitA && selIds.has(hitA.id) && !modifiers.shift && tool !== 'eraser' && !tiltsSelection) {
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
      tool !== 'eraser' &&
      !tiltsSelection
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
      // Shift over an arrow's end or middle starts a connecting arrow there.
      const connection = modifiers.shift
        ? arrowConnectionPoint(pos, getCanvasEditorState().arrows, 8 / stageScale)
        : null;
      if (connection) {
        arrowTool.begin(arrowType, connection);
        return;
      }
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
      arrowTool.begin(arrowType, pos);
      return;
    }

    if (tool === 'shape') {
      // An orbital is centred on the atom it is drawn on.
      shapeTool.begin(
        shapeKind,
        shapeKind.startsWith('orbital-') && hitA ? { x: hitA.x, y: hitA.y } : pos,
        {
          symbolSize: bondLength * 0.5,
          orbitalSize: bondLength * 0.8,
          handleTolerance: 8 / stageScale,
        },
      );
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
        textDragTool.begin(hitTB.id, { x: pos.x, y: pos.y });
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
        previewCanvasEdit({
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
      const pivot = rotationPivot ?? selCtr;
      // Alt-drag the '+' to move the centre of rotation (ChemDraw 17.1 guide, "Moving the
      // Center of Rotation").
      if (e.evt.altKey && pivot && Math.hypot(pos.x - pivot.x, pos.y - pivot.y) < 8 / stageScale) {
        pivotDragRef.current = true;
        return;
      }
      const rotHandlePos = selCtr && bbox ? { x: selCtr.x, y: bbox.minY - 30 } : selCtr;
      selectTool.begin(
        pos,
        hitA,
        hitB,
        hitArr,
        modifiers.shift,
        rotHandlePos,
        hitTB,
        hitScale,
        hitNative,
        pivot,
      );
      return;
    }
    if (tool === 'fragment' && selectedFragment) {
      placeFragmentAt(selectedFragment, pos, hitA ?? undefined, hitB ?? undefined);
      return;
    }
    if (tool === 'charge' && hitA && CHARGE_SYMBOL_BY_MODE[electronToolMode]) {
      // A circled charge or radical ion: a symbol beside the atom, on its clearest diagonal.
      const document = getCanvasEditorState().chemDrawDocument;
      if (!document) return;
      const neighbours = bonds
        .filter((bond) => bond.from === hitA.id || bond.to === hitA.id)
        .map((bond) =>
          atoms.find((atom) => atom.id === (bond.from === hitA.id ? bond.to : bond.from)),
        )
        .filter((atom): atom is Atom => Boolean(atom));
      commitNativeDocument(
        toggleChargeSymbol(
          document,
          hitA.id,
          CHARGE_SYMBOL_BY_MODE[electronToolMode]!,
          chargeSymbolPlace(hitA, neighbours, bondLength),
          bondLength * 0.55,
          () => crypto.randomUUID(),
        ),
        'charge-symbol',
      );
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
      ringTool.begin(pos, hitA, hitB);
      return;
    }
    if (tool === 'bond') {
      bondTool.begin(pos, hitA, hitB);
      return;
    }
    if (tool === 'atom') {
      atomTool.begin(pos, hitA);
      return;
    }
  };

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const modifiers = syncModifierKeys(e.evt);
    if (atomTool.editingAtomId) return;
    const pos = getRelativePointerPosition();
    const hit = getCanvasHitAt(pos.x, pos.y);
    const hitA = hit.atom;
    gestureLifecycle.current.update({ point: pos, hit, modifiers });
    if (templateTool.isActive()) {
      templateTool.update(
        pos,
        modifiers.shift
          ? hitTestDocumentScene(exportScene, pos, { stageScale })?.objectId
          : undefined,
      );
      return;
    }
    if (tool === 'chain') {
      chainTool.update({ point: pos, hit: hitA, modifiers });
      return;
    }
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
      arrowTool.update(pos);
      return;
    }
    if (pivotDragRef.current) {
      useStore.getState().setRotationPivot(pos);
      return;
    }
    if (reshapeRef.current) {
      const drag = reshapeRef.current;
      drag.latest = applyShapeHandle(drag.object, drag.handle, pos);
      setReshapePreview(drag.latest);
      return;
    }
    if (shapeTool.isActive()) {
      shapeTool.update(pos, e.evt.shiftKey);
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
      selectTool.update(pos, hitA, modifiers.shift);
      return;
    }
    setHoveredScaleCorner(null);
    if (tool === 'ring') {
      ringTool.hover(pos, hitA, hitB);
      return;
    }
    if (tool === 'bond') {
      bondTool.update(pos, hitA, e.evt.altKey);
      return;
    }
    if (tool === 'atom') {
      atomTool.update(pos, hitA, e.evt.altKey);
      return;
    }
    if (tool === 'text' && textDragTool.isActive()) {
      const step = textDragTool.update({ x: pos.x, y: pos.y }, stageScale);
      if (step) {
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
            t.id === step.textBoxId ? { ...t, x: t.x + step.dx, y: t.y + step.dy } : t,
          ),
        });
      }
    }
  };

  const handleMouseUp = (e: KonvaEventObject<MouseEvent>) => {
    syncModifierKeys(e.evt);
    markInteractionIdle();
    if (!gestureLifecycle.current.commit(useStore.getState().chemDrawDocument)) return;
    if (templateTool.isActive()) {
      const pos = getRelativePointerPosition();
      templateTool.commit(
        pos,
        e.evt.shiftKey
          ? hitTestDocumentScene(exportScene, pos, { stageScale })?.objectId
          : undefined,
      );
      return;
    }
    if (tool === 'chain') {
      chainTool.commit();
      return;
    }
    if (tool === 'ring' && ringTool.isActive()) {
      const placement = ringTool.commit();
      if (!placement) return;
      const { atoms: ka, bonds: kb, groups: kg, textBoxes: ktb } = getCanvasEditorState();
      const next = applyRingPlacement(placement, ka, kb);
      commitCanvasEdit({
        atoms: next.atoms,
        bonds: next.bonds,
        arrows,
        groups: kg ?? [],
        textBoxes: ktb ?? [],
      });
      return;
    }
    if (pivotDragRef.current) {
      pivotDragRef.current = false;
      return;
    }
    if (reshapeRef.current) {
      const drag = reshapeRef.current;
      const reshaped = drag.latest;
      reshapeGesture.cancel();
      // As with the tools: a press on a document since replaced edits nothing.
      if (reshaped && useStore.getState().chemDrawDocument === drag.source) {
        useStore
          .getState()
          .dispatchEditorCommand(
            createUpsertObjectsCommand([reshaped], { description: 'reshape' }),
          );
      }
      return;
    }
    if (shapeTool.isActive()) {
      const shapes = shapeTool.commit();
      // Mass Fragmentation: the cut line becomes each side's formula and exact mass; it stays
      // drawn only with Alt.
      if (shapes && shapeKind === 'mass-fragmentation') {
        const line = shapes[0];
        if (line?.type !== 'arrow') return;
        const path = [line.tail, line.head];
        const sides = fragmentAcross(path, atoms, bonds);
        if (!sides) {
          useStore.getState().showToast('Drag across the bonds to break.', 'info');
          return;
        }
        const captions = fragmentationCaptions(
          sides,
          atoms,
          path,
          useStore.getState().documentStyleSettings,
          () => crypto.randomUUID(),
        );
        // Each cut atom becomes a radical, as in ChemDraw: its flag and an electron symbol.
        const state = useStore.getState();
        const page = state.chemDrawDocument?.pages[0];
        const marks = fragmentationRadicals(path, atoms, bonds);
        const radicalNodes = [...new Set(marks.map((mark) => mark.atomId))].flatMap((atomId) => {
          const node = page?.objects.find((o) => o.type === 'node' && o.id === atomId);
          return node?.type === 'node'
            ? [{ ...node, radicalElectrons: marks.filter((m) => m.atomId === atomId).length }]
            : [];
        });
        const electrons = marks.map((mark) => ({
          ...createSymbolGraphic(crypto.randomUUID(), 'Electron', mark.points[0], 0),
          points: mark.points,
          representedObjectId: mark.atomId,
          representedAttribute: 'Radical',
        }));
        state.dispatchEditorCommand(
          createUpsertObjectsCommand(
            [...captions, ...radicalNodes, ...electrons, ...(e.evt.altKey ? [line] : [])],
            { description: 'mass-fragmentation' },
          ),
        );
        return;
      }
      if (shapes) {
        useStore
          .getState()
          .dispatchEditorCommand(createUpsertObjectsCommand(shapes, { description: 'draw-shape' }));
      }
      return;
    }
    if (arrowPreview) {
      const arrow = arrowTool.commit();
      if (arrow) {
        const { groups: kg, textBoxes: ktb } = getCanvasEditorState();
        commitCanvasEdit({
          atoms,
          bonds,
          arrows: [...arrows, { ...arrow, id: crypto.randomUUID() }],
          groups: kg ?? [],
          textBoxes: ktb ?? [],
        });
      }
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
      selectTool.commit();
      return;
    }
    if (tool === 'bond') {
      bondTool.commit();
      return;
    }
    if (tool === 'atom') {
      atomTool.commit();
      return;
    }
    if (tool === 'text' && textDragTool.isActive()) {
      const drag = textDragTool.commit();
      if (!drag) return;
      if (drag.kind === 'click') {
        // Short click → enter edit mode
        ignoreNextBlurRef.current = true;
        setEditingTextBoxId(drag.textBoxId);
        const hitTB = textBoxes.find((t) => t.id === drag.textBoxId);
        if (hitTB) {
          useStore.getState().syncTextFormat({
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

  const cancelPointerGesture = cancelAllGestures;

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

  const fileController = useCanvasDocumentController(resetStageView, (format) =>
    sceneSurfaceRef.current?.toDataURL({
      format,
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
      beginTemplatePlacement: (template: UserTemplate) => templateTool.arm(template),
      revealObjects: (ids: string[]) => {
        const document = useStore.getState().chemDrawDocument;
        if (!document) return;
        const store = useStore.getState();
        const objects = document.pages[0]?.objects.filter((o) => ids.includes(o.id)) ?? [];
        store.deselectAll();
        store.setSelectedObjectIds(new Set(ids));
        store.setSelectedAtomIds(
          new Set(objects.filter((o) => o.type === 'node').map((o) => o.id)),
        );
        store.setSelectedBondIds(
          new Set(objects.filter((o) => o.type === 'bond').map((o) => o.id)),
        );
        store.setSelectedArrowIds(
          new Set(objects.filter((o) => o.type === 'arrow').map((o) => o.id)),
        );
        store.setSelectedTextBoxIds(
          new Set(objects.filter((o) => o.type === 'text').map((o) => o.id)),
        );
        const index = buildDocumentIndex(document, {
          documentStyleSettings: useStore.getState().documentStyleSettings,
        });
        const bounds = ids.flatMap((id) => {
          const b = index.boundsById.get(id);
          return b ? [b] : [];
        });
        if (!bounds.length) return;
        const cx =
          (Math.min(...bounds.map((b) => b.left)) + Math.max(...bounds.map((b) => b.right))) / 2;
        const cy =
          (Math.min(...bounds.map((b) => b.top)) + Math.max(...bounds.map((b) => b.bottom))) / 2;
        setStagePos({ x: width / 2 - cx * stageScale, y: height / 2 - cy * stageScale });
      },
      cleanUp: async () => {
        const state = useStore.getState();
        const source = state.chemDrawDocument;
        if (!source) return;
        const revision = state.documentRevision;
        const session = state.documentSessionId;
        try {
          const command = await prepareCleanupCommand(
            source,
            new Set([
              ...state.selectedObjectIds,
              ...state.selectedAtomIds,
              ...state.selectedBondIds,
              ...state.selectedArrowIds,
              ...state.selectedTextBoxIds,
            ]),
            createRDKitChemistryService(rdkit),
            state.documentStyleSettings.bondLength,
          );
          const current = useStore.getState();
          if (current.documentRevision !== revision || current.documentSessionId !== session) {
            current.showToast(
              'The document changed during cleanup; no changes were applied.',
              'info',
            );
            return;
          }
          current.dispatchEditorCommand(command);
        } catch (error) {
          useStore
            .getState()
            .showToast(error instanceof Error ? error.message : 'Structure cleanup failed');
        }
      },
      applyTextFormat: (cmd: string, value?: string) => {
        if (editOverlayRef.current && document.activeElement === editOverlayRef.current) {
          document.execCommand(cmd, false, value);
        }
      },
      structureText: (format: StructureTextFormat) => structureTextRef.current(format),
      structureFromName: (name?: string) => namingRef.current.structureFromName(name),
      nameStructures: () => namingRef.current.nameSelectedStructures(),
      dragPayload: () => dragPayloadRef.current(),
      expandLabels: () => labelActionsRef.current.expandSelectedLabels(),
      contractLabel: () => labelActionsRef.current.contractSelectedLabel(),
      zoomIn: () => zoomActionsRef.current.zoomBy(1.25),
      zoomOut: () => zoomActionsRef.current.zoomBy(1 / 1.25),
      actualSize: () =>
        zoomActionsRef.current.zoomTo(
          DEFAULT_STAGE_SCALE,
          zoomActionsRef.current.getSelectionCenter() ?? undefined,
        ),
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
      templateTool,
      stageScale,
      aliasValidator,
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

  /**
   * Edit Curve's handles on the curve being edited (the one under the pointer's drag, else the
   * selected one): square anchors, round direction-line ends, and the lines joining them.
   */
  const renderEditCurveHandles = () => {
    if (tool !== 'shape' || shapeKind !== 'edit-curve') return null;
    const previewCurve = shapePreview?.find(
      (object) => object.type === 'graphic' && object.graphicType === 'curve',
    );
    const curve =
      previewCurve ??
      chemDrawDocument?.pages[0]?.objects.find(
        (object) =>
          object.type === 'graphic' &&
          object.graphicType === 'curve' &&
          selectedObjectIds.has(object.id),
      );
    if (curve?.type !== 'graphic' || !curve.points) return null;
    const size = 6 / stageScale;
    const stroke = 1 / stageScale;
    return (
      <Group>
        {curve.points.map((point, index) => {
          if (index % 3 !== 1) return null;
          const incoming = curve.points![index - 1];
          const outgoing = curve.points![index + 1];
          return (
            <Group key={`curve-handle-${index}`}>
              {[incoming, outgoing].map((control, side) =>
                control ? (
                  <Group key={side}>
                    <Line
                      points={[point.x, point.y, control.x, control.y]}
                      stroke="#2196F3"
                      strokeWidth={stroke}
                    />
                    <Circle
                      x={control.x}
                      y={control.y}
                      radius={size / 2}
                      fill="#fff"
                      stroke="#2196F3"
                      strokeWidth={stroke}
                    />
                  </Group>
                ) : null,
              )}
              <Rect
                x={point.x - size / 2}
                y={point.y - size / 2}
                width={size}
                height={size}
                fill="#2196F3"
              />
            </Group>
          );
        })}
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
        objects:
          shapePreview || reshapePreview
            ? [...(shapePreview ?? []), ...(reshapePreview ? [reshapePreview] : [])]
            : null,
        ring: tool === 'ring' ? ringTool.preview : null,
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
      shapePreview,
      reshapePreview,
      tool,
      ringTool.preview,
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
      {tool === 'chain' && chainTool.count > 0 && (
        <div
          role="status"
          style={{ position: 'absolute', bottom: 20, left: 20, pointerEvents: 'none' }}
        >
          {chainTool.count} added atoms
        </div>
      )}
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onPointerCancel={cancelPointerGesture}
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

          {selectTool.lassoPath && selectTool.lassoPath.length > 1 && (
            <Line
              points={selectTool.lassoPath.flatMap((point) => [point.x, point.y])}
              closed
              fill="rgba(33,150,243,0.1)"
              stroke="#2196F3"
              strokeWidth={1 / stageScale}
              dash={[4 / stageScale, 3 / stageScale]}
              listening={false}
            />
          )}
          {selectTool.isSelectionBoxActive &&
            !selectTool.lassoPath &&
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
            selectedObjectIds.size > 0 &&
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
                {(() => {
                  // The centre of rotation, '+' as in ChemDraw; Alt-drag moves it.
                  const pivot = rotationPivot ?? selCenter;
                  const arm = 5 / stageScale;
                  return (
                    <Group listening={false}>
                      <Line
                        points={[pivot.x - arm, pivot.y, pivot.x + arm, pivot.y]}
                        stroke="#2196F3"
                        strokeWidth={1.5 / stageScale}
                      />
                      <Line
                        points={[pivot.x, pivot.y - arm, pivot.x, pivot.y + arm]}
                        stroke="#2196F3"
                        strokeWidth={1.5 / stageScale}
                      />
                    </Group>
                  );
                })()}
              </Group>
            )}

          {!selectTool.isSelectionBoxActive &&
            !editingTextBoxId &&
            selBBox &&
            selectedObjectIds.size > 0 &&
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
        <Layer listening={false}>
          {renderEditCurveHandles()}
          {reshapeTarget &&
            !selectionPreviewTransform &&
            getShapeHandles(reshapePreview ?? reshapeTarget).map((handle) => (
              <Rect
                key={handle.id}
                x={handle.x - 3.5 / stageScale}
                y={handle.y - 3.5 / stageScale}
                width={7 / stageScale}
                height={7 / stageScale}
                fill="#fff"
                stroke="#2196F3"
                strokeWidth={1.2 / stageScale}
              />
            ))}
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
        textBoxes={sceneTextBoxes}
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
          title="Magnify (F7)"
          onClick={() => zoomBy(1.25)}
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
        <input
          aria-label="Magnification"
          title="Magnification (1-999%)"
          key={zoomPercent}
          defaultValue={`${zoomPercent}%`}
          onFocus={() => getCanvasEditorState().setIsInputFocused(true)}
          onBlur={(e) => {
            getCanvasEditorState().setIsInputFocused(false);
            e.target.value = `${zoomPercent}%`;
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const percent = Number.parseFloat(e.currentTarget.value);
            if (Number.isFinite(percent) && percent >= 1 && percent <= 999) {
              zoomTo((percent / 100) * DEFAULT_STAGE_SCALE);
            }
            e.currentTarget.blur();
          }}
          style={{
            width: '44px',
            height: '22px',
            fontSize: '11px',
            textAlign: 'center',
            background: isDarkMode ? '#333' : '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            color: isDarkMode ? '#fff' : '#000',
            padding: 0,
          }}
        />
        <button
          title="Reduce (F8)"
          onClick={() => zoomBy(1 / 1.25)}
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
