import { useRef, useEffect, useCallback, useState, lazy, Suspense, useMemo } from 'react';
import {
  extractSelection,
  applyPasteOffset,
  detectPasteFormat,
  setClipboardBuffer,
  getClipboardBuffer,
  resetPasteCount,
  bumpPasteCount,
} from './lib/clipboard';
import { generateCanvasSVG } from './lib/svgExport';
import type { Molecule3DRef } from './components/Molecule3DRef';
const PropertiesPanel = lazy(() =>
  import('./components/PropertiesPanel').then((m) => ({ default: m.PropertiesPanel })),
);
const IrPanel = lazy(() => import('./components/IrPanel').then((m) => ({ default: m.IrPanel })));
const MsPanel = lazy(() => import('./components/MsPanel').then((m) => ({ default: m.MsPanel })));
const NmrPanel = lazy(() => import('./components/NmrPanel').then((m) => ({ default: m.NmrPanel })));
import { ChemCanvas, ChemCanvasRef } from './components/ChemCanvas';
import { ViewerPanel, type AppTheme } from './components/ViewerPanel';
import { PreferencesPanel, type PreferencesTab } from './components/PreferencesPanel';
import { TransformDialogs } from './components/TransformDialogs';
import { DeferredNumberInput } from './components/DeferredNumberInput';
import { ArrowType } from './types/chemistry';
import { useRDKit } from './hooks/useRDKit';
import { useToolPaletteManager } from './hooks/useToolPaletteManager';
import { useStore } from './store';
import './App.css';
import { stateToCDXML, cdxmlToState } from './utils/cdxml';
import {
  createDeleteSelectionCommand,
  createRotateSelectionCommand,
  createScaleSelectionCommand,
} from './editor/commands';
import {
  getChemDrawObjectCapability,
  getChemDrawObjectPreservationReasons,
  summarizeChemDrawCompatibility,
} from './lib/chemdrawDocumentCommands';
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TOOL_PALETTES,
  getPageSetupDimensionsPx,
  loadAppPreferences,
  resolveAtomLabelColor,
} from './lib/settings';
import { shouldIgnoreKeyboardShortcuts } from './lib/keyboard';
import { evaluateTextBoxChemicalState } from './lib/chemicalText';
import { SUPPORTED_ALIAS_LIBRARY, type AliasLibrarySupport } from './lib/aliasChemistry';
import { getArrowSelectionPoints } from './lib/renderGeometry';
import { FloatingPanel } from './components/FloatingPanel';
import { SelectMenu } from './components/SelectMenu';
import type { ToolPaletteId } from './types/settings';
import {
  openChemicalTextFile,
  openImageBinaryFile,
  saveBinaryWithDialog,
  saveTextWithDialog,
} from './lib/fileDialogs';
import { AMINO_ACID_SHORTHANDS } from './lib/shorthand';
import { eventMatchesShortcut, getShortcutBinding } from './lib/keybindings';
import { getRingPresetLabel, type RingPreset } from './lib/ringTemplates';
import {
  getCurrentAppWindow,
  invokeTauri,
  readClipboardText,
  writeClipboardText,
  type AppWindowTheme,
} from './lib/tauri';

const isMacOS = navigator.platform.startsWith('Mac');

function withAppWindow(action: (appWindow: ReturnType<typeof getCurrentAppWindow>) => void) {
  try {
    action(getCurrentAppWindow());
  } catch {
    // Browser preview does not provide Tauri window metadata.
  }
}

function getCanvasContentBounds(
  atoms: Array<{ x: number; y: number }>,
  arrows: Array<{ x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number }>,
  textBoxes: Array<{ x: number; y: number }>,
) {
  const pts = [
    ...atoms.map((atom) => ({ x: atom.x, y: atom.y })),
    ...arrows.flatMap((arrow) => [
      { x: arrow.x1, y: arrow.y1 },
      { x: arrow.x2, y: arrow.y2 },
      { x: arrow.cpx, y: arrow.cpy },
    ]),
    ...textBoxes.map((textBox) => ({ x: textBox.x, y: textBox.y })),
  ];
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((point) => point.x)),
    minY: Math.min(...pts.map((point) => point.y)),
    maxX: Math.max(...pts.map((point) => point.x)),
    maxY: Math.max(...pts.map((point) => point.y)),
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

function createCenteredPanelPosition(width: number, height: number, topOffset = 48) {
  return {
    x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(24, Math.min(topOffset, Math.round((window.innerHeight - height) / 2))),
  };
}

function hexToRgba(color: string, alpha: number): string {
  const normalized = color.trim();
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const hex = match[1];
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Sidecar result types
interface SidecarParseResult {
  error?: string;
  molblock: string;
}
interface SidecarExportResult {
  error?: string;
  content: string;
}
interface SidecarXyzConformerResult {
  error?: string;
  conformers?: Array<{ atoms: Array<{ x: number; y: number; z: number; element: string }> }>;
  bonds?: Array<{ a1: number; a2: number; order: number }>;
}

const PT_MAIN = [
  ['H', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'He'],
  ['Li', 'Be', '', '', '', '', '', '', '', '', '', '', 'B', 'C', 'N', 'O', 'F', 'Ne'],
  ['Na', 'Mg', '', '', '', '', '', '', '', '', '', '', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar'],
  [
    'K',
    'Ca',
    'Sc',
    'Ti',
    'V',
    'Cr',
    'Mn',
    'Fe',
    'Co',
    'Ni',
    'Cu',
    'Zn',
    'Ga',
    'Ge',
    'As',
    'Se',
    'Br',
    'Kr',
  ],
  [
    'Rb',
    'Sr',
    'Y',
    'Zr',
    'Nb',
    'Mo',
    'Tc',
    'Ru',
    'Rh',
    'Pd',
    'Ag',
    'Cd',
    'In',
    'Sn',
    'Sb',
    'Te',
    'I',
    'Xe',
  ],
  [
    'Cs',
    'Ba',
    'La-Lu',
    'Hf',
    'Ta',
    'W',
    'Re',
    'Os',
    'Ir',
    'Pt',
    'Au',
    'Hg',
    'Tl',
    'Pb',
    'Bi',
    'Po',
    'At',
    'Rn',
  ],
  [
    'Fr',
    'Ra',
    'Ac-Lr',
    'Rf',
    'Db',
    'Sg',
    'Bh',
    'Hs',
    'Mt',
    'Ds',
    'Rg',
    'Cn',
    'Nh',
    'Fl',
    'Mc',
    'Lv',
    'Ts',
    'Og',
  ],
];
const PT_LANTHANIDES = [
  'La',
  'Ce',
  'Pr',
  'Nd',
  'Pm',
  'Sm',
  'Eu',
  'Gd',
  'Tb',
  'Dy',
  'Ho',
  'Er',
  'Tm',
  'Yb',
  'Lu',
];
const PT_ACTINIDES = [
  'Ac',
  'Th',
  'Pa',
  'U',
  'Np',
  'Pu',
  'Am',
  'Cm',
  'Bk',
  'Cf',
  'Es',
  'Fm',
  'Md',
  'No',
  'Lr',
];

const FRAGMENTS = [
  { id: 'benzene', label: '⌬', smiles: 'c1ccccc1' },
  { id: 'cyclohexane', label: '⬡', smiles: 'C1CCCCC1' },
  { id: 'cyclopentane', label: '⬠', smiles: 'C1CCCC1' },
  { id: 'cyclobutane', label: '◻', smiles: 'C1CCC1' },
  { id: 'cyclopropane', label: '△', smiles: 'C1CC1' },
];

const RING_PRESET_OPTIONS: Array<{
  preset: RingPreset;
  title: string;
  iconId:
    | 'cyclohexane'
    | 'cyclopentane'
    | 'cyclobutane'
    | 'cyclopropane'
    | 'chair'
    | 'chair-flipped';
}> = [
  { preset: 'polygon', title: 'Regular Ring', iconId: 'cyclohexane' },
  { preset: 'chair', title: 'Cyclohexane Chair', iconId: 'chair' },
  { preset: 'chair-flipped', title: 'Cyclohexane Chair (Flipped)', iconId: 'chair-flipped' },
];

const PALETTE_META: Record<ToolPaletteId, { label: string; description: string }> = {
  tools: {
    label: 'Canvas',
    description: 'Navigation and general editing tools.',
  },
  ring: {
    label: 'Structure',
    description: 'Bond, ring, and fragment drawing tools.',
  },
  arrow: {
    label: 'Reaction',
    description: 'Reaction arrows and electron-flow tools.',
  },
  text: {
    label: 'Text',
    description: 'Annotation, chemistry text, and structure input tools.',
  },
  atom: {
    label: 'Atoms',
    description: 'Element and shorthand atom labels.',
  },
  charge: {
    label: 'Electrons',
    description: 'Formal charges, radicals, and lone-pair annotations.',
  },
};

const REACTION_ARROW_OPTIONS: Array<{ type: ArrowType; title: string }> = [
  { type: 'reaction', title: 'Reaction' },
  { type: 'dashed-reaction', title: 'Dashed Reaction' },
  { type: 'no-reaction', title: 'No Reaction' },
  { type: 'equilibrium', title: 'Equilibrium' },
  { type: 'resonance', title: 'Resonance' },
  { type: 'retrosynthetic', title: 'Retrosynthetic' },
  { type: 'fat', title: 'Filled / Fat Arrow' },
  { type: 'curved', title: 'Curved Arrow' },
  { type: 'half-curved', title: 'Hook Arrow' },
];

function ReactionArrowIcon({ type, size = 20 }: { type: ArrowType; size?: number }) {
  const strokeProps = {
    stroke: 'currentColor',
    strokeWidth: 2.15,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  switch (type) {
    case 'reaction':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4.5 12H17.2" {...strokeProps} />
          <path d="M13.2 8.2L18.7 12L13.2 15.8" {...strokeProps} />
        </svg>
      );
    case 'dashed-reaction':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4.5 12H14.4" strokeDasharray="4.6 3.2" {...strokeProps} />
          <path d="M13.1 8.2L18.7 12L13.1 15.8" {...strokeProps} />
        </svg>
      );
    case 'no-reaction':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4.5 12H17.2" {...strokeProps} />
          <path d="M13.2 8.2L18.7 12L13.2 15.8" {...strokeProps} />
          <path d="M8.8 15.2L14.5 8.8" {...strokeProps} />
        </svg>
      );
    case 'equilibrium':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4.3 9H16.7" {...strokeProps} />
          <path d="M13.2 7L17.7 9L13.2 11" {...strokeProps} />
          <path d="M19.7 15H7.3" {...strokeProps} />
          <path d="M10.8 13L6.3 15L10.8 17" {...strokeProps} />
        </svg>
      );
    case 'resonance':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M5.8 12H18.2" {...strokeProps} />
          <path d="M9.1 8.2L4.5 12L9.1 15.8" {...strokeProps} />
          <path d="M14.9 8.2L19.5 12L14.9 15.8" {...strokeProps} />
        </svg>
      );
    case 'retrosynthetic':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4.2 10.1H14.2" {...strokeProps} />
          <path d="M4.2 13.9H14.2" {...strokeProps} />
          <path d="M13.2 7.2L19.5 12L13.2 16.8" {...strokeProps} />
        </svg>
      );
    case 'fat':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M4 9.2H11.6V6.7L20 12L11.6 17.3V14.8H4Z" fill="currentColor" />
        </svg>
      );
    case 'curved':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M6 18V13.2C6 8.6 9.2 6 13.8 6H16.1" {...strokeProps} />
          <path d="M13.4 3.8L17.2 6L13.4 8.2" {...strokeProps} />
        </svg>
      );
    case 'half-curved':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d="M6.4 18V13.5C6.4 10.1 8.6 7.7 11.9 7.4" {...strokeProps} />
          <path d="M10.5 5.9L13.9 7.2L11.1 9.6" {...strokeProps} />
        </svg>
      );
    default:
      return null;
  }
}

function StructureFragmentIcon({
  id,
  size = 22,
}: {
  id:
    | 'bond'
    | 'benzene'
    | 'cyclohexane'
    | 'cyclopentane'
    | 'cyclobutane'
    | 'cyclopropane'
    | 'chair'
    | 'chair-flipped';
  size?: number;
}) {
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  const polygon = (sides: number, radius: number, rotation = -Math.PI / 2) =>
    Array.from({ length: sides }, (_, index) => {
      const angle = rotation + (Math.PI * 2 * index) / sides;
      const x = 12 + Math.cos(angle) * radius;
      const y = 12 + Math.sin(angle) * radius;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  const chairPath = (flipped = false) =>
    [
      [flipped ? 5.6 : 6.1, 7.2],
      [flipped ? 3.4 : 7.7, 16.4],
      [flipped ? 9.6 : 13.1, 13.6],
      [flipped ? 14.8 : 18.4, 16.3],
      [flipped ? 20.0 : 17.8, 7.2],
      [flipped ? 14.9 : 12.6, 9.9],
      [flipped ? 5.6 : 6.1, 7.2],
    ]
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');

  if (id === 'bond') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 12H19.5" {...stroke} />
      </svg>
    );
  }

  if (id === 'benzene') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <polygon points={polygon(6, 6.7)} {...stroke} />
        <circle cx="12" cy="12" r="3.8" {...stroke} />
      </svg>
    );
  }

  if (id === 'chair' || id === 'chair-flipped') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <polyline points={chairPath(id === 'chair-flipped')} {...stroke} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points={polygon(
          id === 'cyclohexane' ? 6 : id === 'cyclopentane' ? 5 : id === 'cyclobutane' ? 4 : 3,
          id === 'cyclobutane' ? 5.7 : id === 'cyclopropane' ? 6.4 : 6.8,
          id === 'cyclobutane' ? Math.PI / 4 : -Math.PI / 2,
        )}
        {...stroke}
      />
    </svg>
  );
}

const ELEMENT_SHORTCUTS = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'H', 'D'];
const SHORTHAND_GROUP_ORDER = ['amino-acids', 'C', 'N', 'O', 'S', 'Si', 'B', 'P', 'other'] as const;
const SHORTHAND_GROUP_LABELS: Record<string, string> = {
  'amino-acids': 'Amino Acids',
  C: 'Carbon',
  N: 'Nitrogen',
  O: 'Oxygen',
  S: 'Sulfur',
  Si: 'Silicon',
  B: 'Boron',
  P: 'Phosphorus',
  other: 'Other',
};
const SHORTHAND_LIBRARY = SUPPORTED_ALIAS_LIBRARY.map((entry) => ({
  ...entry,
  group: AMINO_ACID_SHORTHANDS.has(entry.label)
    ? 'amino-acids'
    : SHORTHAND_GROUP_LABELS[entry.lead]
      ? entry.lead
      : 'other',
})).sort((a, b) => {
  const groupDelta =
    SHORTHAND_GROUP_ORDER.indexOf(a.group as (typeof SHORTHAND_GROUP_ORDER)[number]) -
    SHORTHAND_GROUP_ORDER.indexOf(b.group as (typeof SHORTHAND_GROUP_ORDER)[number]);
  if (groupDelta !== 0) return groupDelta;
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
});
const SHORTHAND_LABELS = new Set(SHORTHAND_LIBRARY.map((entry) => entry.label));

function truncateToolbarText(value: string, max = 28) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function cloneDefaultToolPalettes() {
  return {
    order: [...DEFAULT_TOOL_PALETTES.order],
    items: Object.fromEntries(
      DEFAULT_TOOL_PALETTES.order.map((paletteId) => [
        paletteId,
        {
          ...DEFAULT_TOOL_PALETTES.items[paletteId],
          position: { ...DEFAULT_TOOL_PALETTES.items[paletteId].position },
        },
      ]),
    ) as typeof DEFAULT_TOOL_PALETTES.items,
  };
}

function App() {
  const { rdkit } = useRDKit();
  const canvasRef = useRef<ChemCanvasRef>(null);
  const molecule3DRef = useRef<Molecule3DRef>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const structureInputRef = useRef<HTMLInputElement>(null);
  const sidebarDockRef = useRef<HTMLDivElement>(null);
  const bondBtnRef = useRef<HTMLDivElement>(null);
  const ringBtnRef = useRef<HTMLDivElement>(null);
  const paletteRefs = useRef<Partial<Record<ToolPaletteId, HTMLDivElement | null>>>({});
  const shorthandSearchRef = useRef<HTMLInputElement>(null);

  const tool = useStore((s) => s.tool);
  const atoms = useStore((s) => s.atoms);
  const arrows = useStore((s) => s.arrows);
  const element = useStore((s) => s.element);
  const atomToolMode = useStore((s) => s.atomToolMode);
  const bondOrder = useStore((s) => s.bondOrder);
  const stereo = useStore((s) => s.stereo);
  const arrowType = useStore((s) => s.arrowType);
  const electronToolMode = useStore((s) => s.electronToolMode);
  const selectedFragment = useStore((s) => s.selectedFragment);
  const ringSize = useStore((s) => s.ringSize);
  const ringPreset = useStore((s) => s.ringPreset);
  const ringRotationSteps = useStore((s) => s.ringRotationSteps);
  const isDarkMode = useStore((s) => s.isDarkMode);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const editMenusHidden = useStore((s) => s.editMenusHidden);
  const showBondMenu = useStore((s) => s.showBondMenu);
  const showSmilesBar = useStore((s) => s.showSmilesBar);
  const showGrid = useStore((s) => s.showGrid);
  const showHydrogens = useStore((s) => s.showHydrogens);
  const appPreferences = useStore((s) => s.appPreferences);
  const pageSetup = useStore((s) => s.pageSetup);
  const documentStyleSettings = useStore((s) => s.documentStyleSettings);
  const documentViewSettings = useStore((s) => s.documentViewSettings);
  const preferencesHydrated = useStore((s) => s.preferencesHydrated);
  const isFileDropdownOpen = useStore((s) => s.isFileDropdownOpen);
  const isExportSubmenuOpen = useStore((s) => s.isExportSubmenuOpen);
  const isEditDropdownOpen = useStore((s) => s.isEditDropdownOpen);
  const isAlignSubmenuOpen = useStore((s) => s.isAlignSubmenuOpen);
  const isSettingsDropdownOpen = useStore((s) => s.isSettingsDropdownOpen);
  const isPreferencesPanelOpen = useStore((s) => s.isPreferencesPanelOpen);
  const isPeriodicTableOpen = useStore((s) => s.isPeriodicTableOpen);
  const isAboutOpen = useStore((s) => s.isAboutOpen);
  const licensesText = useStore((s) => s.licensesText);
  const toasts = useStore((s) => s.toasts);
  const viewerSmiles = useStore((s) => s.viewerSmiles);
  const viewerMolblock = useStore((s) => s.viewerMolblock);
  const editableSmiles = useStore((s) => s.editableSmiles);
  const previewMode = useStore((s) => s.previewMode);
  const showViewer = useStore((s) => s.showViewer);
  const viewerMode = useStore((s) => s.viewerMode);
  const viewerPos = useStore((s) => s.viewerPos);
  const viewerSize = useStore((s) => s.viewerSize);
  const splitWidth = useStore((s) => s.splitWidth);
  const isViewerSettingsOpen = useStore((s) => s.isViewerSettingsOpen);
  const isCalculateDropdownOpen = useStore((s) => s.isCalculateDropdownOpen);
  const showPropertiesPanel = useStore((s) => s.showPropertiesPanel);
  const showIrPanel = useStore((s) => s.showIrPanel);
  const showNmrPanel = useStore((s) => s.showNmrPanel);
  const showMsPanel = useStore((s) => s.showMsPanel);
  const viewerHoveredAtomIdx = useStore((s) => s.viewerHoveredAtomIdx);
  const viewerSelectedAtomIdx = useStore((s) => s.viewerSelectedAtomIdx);
  const hoveredCanvasAtomId = useStore((s) => s.hoveredCanvasAtomId);
  const hoveredCanvasBondId = useStore((s) => s.hoveredCanvasBondId);
  const viewerAtomIndexById = useStore((s) => s.viewerAtomIndexById);
  const bonds = useStore((s) => s.bonds);
  const selectedAtomIds = useStore((s) => s.selectedAtomIds);
  const selectedBondIds = useStore((s) => s.selectedBondIds);
  const selectedArrowIds = useStore((s) => s.selectedArrowIds);
  const selectedObjectIds = useStore((s) => s.selectedObjectIds);
  const lastInteractedAtomId = useStore((s) => s.lastInteractedAtomId);
  const canvasSize = useStore((s) => s.canvasSize);
  const selectedTextBoxIds = useStore((s) => s.selectedTextBoxIds);
  const textBoxes = useStore((s) => s.textBoxes ?? []);
  const textFormat = useStore((s) => s.textFormat);
  const chemDrawDocument = useStore((s) => s.chemDrawDocument);
  const chemDrawWarnings = useStore((s) => s.chemDrawWarnings);
  const selectedTextBoxes = useMemo(
    () => textBoxes.filter((textBox) => selectedTextBoxIds.has(textBox.id)),
    [selectedTextBoxIds, textBoxes],
  );
  const selectedTextBox = selectedTextBoxes.length === 1 ? selectedTextBoxes[0] : null;
  const selectedTextPreview = useMemo(
    () =>
      selectedTextBox
        ? truncateToolbarText(
            selectedTextBox.runs
              .map((run) => run.text)
              .join('')
              .replace(/\s+/g, ' ')
              .trim(),
            32,
          )
        : '',
    [selectedTextBox],
  );
  const selectedTextChemistry = useMemo(
    () =>
      selectedTextBox
        ? evaluateTextBoxChemicalState(selectedTextBox.runs, selectedTextBox.semanticMode ?? 'auto')
        : null,
    [selectedTextBox],
  );
  const selectedTextChemicalMetadata = selectedTextChemistry?.metadata ?? null;
  const selectedTextSemanticModes = useMemo(
    () => new Set(selectedTextBoxes.map((textBox) => textBox.semanticMode ?? 'auto')),
    [selectedTextBoxes],
  );
  const selectedTextSemanticMode =
    selectedTextSemanticModes.size === 1 ? Array.from(selectedTextSemanticModes)[0] : null;
  const selectedChemicalFormula =
    selectedTextChemicalMetadata?.formula ??
    (selectedTextChemistry?.intent ? selectedTextChemistry.formula : '');
  const structureInputValue = editableSmiles.trim();
  const hasStructureInput = structureInputValue.length > 0;
  const textPaletteStructureValue = selectedChemicalFormula || structureInputValue;
  const hasTextPaletteStructureValue = textPaletteStructureValue.length > 0;
  const hasResummonableEditMenu =
    tool === 'text' ||
    selectedTextBoxIds.size > 0 ||
    (selectedAtomIds.size === 1 &&
      selectedBondIds.size === 0 &&
      selectedArrowIds.size === 0 &&
      selectedTextBoxIds.size === 0) ||
    (selectedBondIds.size === 1 &&
      selectedAtomIds.size === 0 &&
      selectedArrowIds.size === 0 &&
      selectedTextBoxIds.size === 0) ||
    (selectedArrowIds.size === 1 &&
      selectedAtomIds.size === 0 &&
      selectedBondIds.size === 0 &&
      selectedTextBoxIds.size === 0);
  const textChemistryStatus = useMemo(() => {
    if (selectedTextBoxes.length > 1) {
      return {
        tone: 'plain' as const,
        title: `${selectedTextBoxes.length} text boxes selected`,
        detail: 'Select one text box to inspect or convert its chemistry.',
        note:
          selectedTextSemanticModes.size > 1
            ? 'These boxes use mixed text modes.'
            : selectedTextSemanticMode
              ? `Current text mode: ${selectedTextSemanticMode}.`
              : 'Chemistry intent stays attached to each text box.',
      };
    }
    if (!selectedTextBox) {
      return {
        tone: 'plain' as const,
        title: 'No text selected',
        detail: 'Use Place Annotation to add captions, labels, or formulas to the canvas.',
        note: hasStructureInput
          ? `Structure input ready: ${truncateToolbarText(structureInputValue, 24)}`
          : 'Chemical-looking text such as Co_2(CO)_8 can still auto-format when you want annotation text to behave chemically.',
      };
    }
    if ((selectedTextBox.semanticMode ?? 'auto') === 'plain') {
      return {
        tone: 'plain' as const,
        title: 'Annotation text',
        detail: selectedTextPreview || 'Selected text',
        note: 'This text box is locked to plain text and will not try to become chemistry.',
      };
    }
    if (selectedTextChemicalMetadata?.chemistryAvailable) {
      return {
        tone: 'ready' as const,
        title:
          (selectedTextBox.semanticMode ?? 'auto') === 'chemical'
            ? 'Chemical mode resolved'
            : 'Chemical text recognized',
        detail: selectedTextChemicalMetadata.formula,
        note: 'This text can feed the viewer, structure input, and export paths.',
      };
    }
    if (selectedTextChemicalMetadata) {
      return {
        tone: 'pending' as const,
        title:
          (selectedTextBox.semanticMode ?? 'auto') === 'chemical'
            ? 'Chemical mode unresolved'
            : 'Chemical-looking text',
        detail: selectedTextChemicalMetadata.formula,
        note:
          selectedTextChemicalMetadata.message ??
          'Formatting is preserved, but the structure is not resolved yet.',
      };
    }
    return {
      tone: 'plain' as const,
      title: 'Plain annotation',
      detail: selectedTextPreview || 'Selected text',
      note: 'Ordinary captions stay as text until you give them strong chemistry cues or switch modes.',
    };
  }, [
    hasStructureInput,
    selectedTextBox,
    selectedTextBoxes.length,
    selectedTextChemicalMetadata,
    selectedTextPreview,
    selectedTextSemanticMode,
    selectedTextSemanticModes,
    structureInputValue,
  ]);
  const textChemistryBorderColor =
    textChemistryStatus.tone === 'ready'
      ? '#2e7d32'
      : textChemistryStatus.tone === 'pending'
        ? '#a86800'
        : isDarkMode
          ? '#525252'
          : '#d3d3d3';
  const textChemistryBackgroundColor =
    textChemistryStatus.tone === 'ready'
      ? isDarkMode
        ? 'rgba(46, 125, 50, 0.2)'
        : '#edf8f0'
      : textChemistryStatus.tone === 'pending'
        ? isDarkMode
          ? 'rgba(168, 104, 0, 0.18)'
          : '#fff6e5'
        : isDarkMode
          ? '#2d2d2d'
          : '#f7f7f7';
  const textPaletteStatusSummary =
    !textChemistryStatus.detail || textChemistryStatus.detail === textChemistryStatus.title
      ? textChemistryStatus.title
      : `${textChemistryStatus.title}: ${textChemistryStatus.detail}`;
  const textPaletteStatusTooltip = [
    textChemistryStatus.title,
    textChemistryStatus.detail,
    textChemistryStatus.note,
  ]
    .filter(Boolean)
    .join('\n');
  const textPaletteStructureSummary = selectedChemicalFormula
    ? `Ready: ${truncateToolbarText(selectedChemicalFormula, 20)}`
    : hasStructureInput
      ? `Input: ${truncateToolbarText(structureInputValue, 20)}`
      : 'No structure queued';
  const chemDrawCompatibility = useMemo(
    () => summarizeChemDrawCompatibility(chemDrawDocument, chemDrawWarnings),
    [chemDrawDocument, chemDrawWarnings],
  );
  const selectedLimitedNativeObjects = useMemo(() => {
    const page = chemDrawDocument?.pages[0];
    if (!page || selectedObjectIds.size === 0) return [];
    return page.objects
      .filter((object) => selectedObjectIds.has(object.id))
      .map((object) => ({
        id: object.id,
        type: object.type,
        capability: getChemDrawObjectCapability(object),
        reasons: getChemDrawObjectPreservationReasons(object),
      }))
      .filter((object) => object.capability !== 'editable');
  }, [chemDrawDocument, selectedObjectIds]);
  const showCompatibilityPanel =
    Boolean(chemDrawDocument) &&
    (chemDrawDocument?.source === 'cdxml-import' ||
      chemDrawCompatibility.warningCount > 0 ||
      chemDrawCompatibility.preservedObjectCount > 0 ||
      selectedLimitedNativeObjects.length > 0);

  const canvasHoveredAtomIdx = useMemo(() => {
    if (!hoveredCanvasAtomId) return null;
    return viewerAtomIndexById[hoveredCanvasAtomId] ?? null;
  }, [hoveredCanvasAtomId, viewerAtomIndexById]);

  const canvasSelectedAtomIndices = useMemo(() => {
    const mapped = Array.from(selectedAtomIds)
      .map((atomId) => viewerAtomIndexById[atomId])
      .filter((idx): idx is number => idx !== undefined)
      .filter((idx, index, arr) => arr.indexOf(idx) === index);
    const visibleAtomCount = Object.keys(viewerAtomIndexById).length;
    if (visibleAtomCount > 0 && mapped.length === visibleAtomCount) {
      return [];
    }
    return mapped;
  }, [selectedAtomIds, viewerAtomIndexById]);

  const canvasSelectedAtomIdx = useMemo(() => {
    if (canvasSelectedAtomIndices.length === 0) return null;
    if (lastInteractedAtomId && viewerAtomIndexById[lastInteractedAtomId] !== undefined) {
      return viewerAtomIndexById[lastInteractedAtomId];
    }
    return canvasSelectedAtomIndices[0] ?? null;
  }, [canvasSelectedAtomIndices, lastInteractedAtomId, viewerAtomIndexById]);

  const activeViewerHoveredAtomIdx = canvasHoveredAtomIdx ?? viewerHoveredAtomIdx;
  const activeViewerSelectedAtomIdx = canvasSelectedAtomIdx ?? viewerSelectedAtomIdx;
  const activeViewerSelectedAtomIndices =
    canvasSelectedAtomIndices.length > 0
      ? canvasSelectedAtomIndices
      : viewerSelectedAtomIdx !== null
        ? [viewerSelectedAtomIdx]
        : [];
  const finitePageMetrics = useMemo(
    () => (pageSetup.mode === 'finite' ? getPageSetupDimensionsPx(pageSetup) : null),
    [pageSetup],
  );
  const offPageContent = useMemo(() => {
    if (!finitePageMetrics) return false;
    const bounds = getCanvasContentBounds(atoms, arrows, textBoxes);
    if (!bounds) return false;
    return (
      bounds.minX < 0 ||
      bounds.minY < 0 ||
      bounds.maxX > finitePageMetrics.totalWidthPx ||
      bounds.maxY > finitePageMetrics.totalHeightPx
    );
  }, [atoms, arrows, finitePageMetrics, textBoxes]);
  const finitePrintSvg = useMemo(
    () =>
      pageSetup.mode === 'finite'
        ? generateCanvasSVG(atoms, bonds, arrows, false, false, textBoxes, pageSetup)
        : null,
    [arrows, atoms, bonds, pageSetup, textBoxes],
  );
  const finitePrintSvgUrl = useMemo(
    () =>
      finitePrintSvg
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(finitePrintSvg)}`
        : null,
    [finitePrintSvg],
  );

  const getViewerBondAtoms = useCallback(
    (bondId: string): [number, number] | null => {
      const bond = bonds.find((entry) => entry.id === bondId);
      if (!bond) return null;
      const fromIdx = viewerAtomIndexById[bond.from];
      const toIdx = viewerAtomIndexById[bond.to];
      if (fromIdx === undefined || toIdx === undefined) return null;
      return fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    },
    [bonds, viewerAtomIndexById],
  );

  const activeViewerHoveredBondAtoms = useMemo(() => {
    if (!hoveredCanvasBondId) return null;
    return getViewerBondAtoms(hoveredCanvasBondId);
  }, [getViewerBondAtoms, hoveredCanvasBondId]);

  const activeViewerSelectedBondAtoms = useMemo(
    () =>
      Array.from(selectedBondIds)
        .map((bondId) => getViewerBondAtoms(bondId))
        .filter((bond): bond is [number, number] => Boolean(bond))
        .filter(
          ([a1, a2], index, arr) => arr.findIndex(([b1, b2]) => b1 === a1 && b2 === a2) === index,
        ),
    [getViewerBondAtoms, selectedBondIds],
  );

  // Store actions (destructured once)
  const {
    setTool,
    setElement,
    setAtomToolSelection,
    setBondOrder,
    setStereo,
    setArrowType,
    setCurrentCharge,
    setElectronToolMode,
    setSelectedFragment,
    setIsDarkMode,
    setSidebarWidth,
    setEditMenusHidden,
    setShowBondMenu,
    setShowSmilesBar,
    setTextFormat,
    setIsFileDropdownOpen,
    setIsExportSubmenuOpen,
    setIsEditDropdownOpen,
    setIsSettingsDropdownOpen,
    setIsAlignSubmenuOpen,
    setIsPeriodicTableOpen,
    setIsAboutOpen,
    setIsViewerSettingsOpen,
    setIsPreferencesPanelOpen,
    setEditableSmiles,
    setIsInputFocused,
    setPreviewMode,
    setShowViewer,
    setViewerMode,
    setViewerPos,
    setViewerSize,
    setSplitWidth,
    setCanvasSize,
    setLicensesText,
    setIsCalculateDropdownOpen,
    setShowPropertiesPanel,
    setShowIrPanel,
    setShowNmrPanel,
    setShowMsPanel,
    closeAllMenus,
    undo,
    redo,
    selectAll,
    deselectAll,
    clearCanvas,
    groupSelected,
    ungroupSelected,
    alignSelection,
    setRingSize,
    setRingPreset,
    rotateRingTemplate,
    hydrateAppPreferences,
    setAppPreferences,
    setDocumentStyleSettings,
    setDocumentViewSettings,
    applyDefaultsToCurrentDocument,
    showToast,
  } = useStore.getState();

  // Resizing refs
  const isResizing = useRef(false);
  const isViewerResizing = useRef(false);
  const isViewerDragging = useRef(false);
  const isSplitResizing = useRef(false);
  const offPageNoticeShownRef = useRef(false);

  // Rotation dialog
  const [showRotateDialog, setShowRotateDialog] = useState(false);
  const [rotateInput, setRotateInput] = useState('');

  // Scale dialog
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [scaleInput, setScaleInput] = useState('');
  const [periodicTablePos, setPeriodicTablePos] = useState(() =>
    createCenteredPanelPosition(860, 560, 36),
  );
  const [periodicTableSize, setPeriodicTableSize] = useState({ width: 860, height: 560 });
  const [aboutPos, setAboutPos] = useState(() => createCenteredPanelPosition(600, 520, 44));
  const [aboutSize, setAboutSize] = useState({ width: 600, height: 520 });
  const [preferencesTab, setPreferencesTab] = useState<PreferencesTab>('drawing');
  const [textEditPanelLayout, setTextEditPanelLayout] = useState<EditPanelLayout | null>(null);
  const [isShorthandLibraryOpen, setIsShorthandLibraryOpen] = useState(false);
  const [shorthandQuery, setShorthandQuery] = useState('');
  const [shorthandSupportFilter, setShorthandSupportFilter] = useState<'all' | AliasLibrarySupport>(
    'all',
  );
  const [shorthandLibraryPos, setShorthandLibraryPos] = useState({ x: 188, y: 126 });
  const [shorthandLibrarySize, setShorthandLibrarySize] = useState({ width: 380, height: 520 });
  const {
    toolPalettes,
    dockedPaletteIds,
    floatingPaletteIds,
    paletteDrag,
    togglePaletteCollapsed,
    beginPaletteDrag,
    dockPalette,
    dockGuideTop,
  } = useToolPaletteManager({
    appPreferences,
    setAppPreferences,
    appShellRef,
    sidebarDockRef,
    paletteRefs,
  });
  const setPaletteRef = useCallback((paletteId: ToolPaletteId, element: HTMLDivElement | null) => {
    paletteRefs.current[paletteId] = element;
  }, []);
  const selectedShorthand =
    atomToolMode === 'alias' && SHORTHAND_LABELS.has(element) ? element : null;
  const filteredShorthandLibrary = useMemo(() => {
    const query = shorthandQuery.trim().toLowerCase();
    return SHORTHAND_LIBRARY.filter(
      (entry) =>
        (shorthandSupportFilter === 'all' || entry.support === shorthandSupportFilter) &&
        (!query ||
          entry.label.toLowerCase().includes(query) ||
          entry.lead.toLowerCase().includes(query) ||
          entry.source.toLowerCase().includes(query)),
    );
  }, [shorthandQuery, shorthandSupportFilter]);
  const groupedShorthandLibrary = useMemo(
    () =>
      SHORTHAND_GROUP_ORDER.map((group) => ({
        group,
        label: SHORTHAND_GROUP_LABELS[group],
        items: filteredShorthandLibrary.filter((entry) => entry.group === group),
      })).filter((section) => section.items.length > 0),
    [filteredShorthandLibrary],
  );
  const shorthandLibraryCounts = useMemo(
    () => ({
      all: SHORTHAND_LIBRARY.length,
      structure: SHORTHAND_LIBRARY.filter((entry) => entry.support === 'structure').length,
      coordination: SHORTHAND_LIBRARY.filter((entry) => entry.support === 'coordination').length,
      'display-only': SHORTHAND_LIBRARY.filter((entry) => entry.support === 'display-only').length,
    }),
    [],
  );

  useEffect(() => {
    if (!isShorthandLibraryOpen) return;
    const focusId = requestAnimationFrame(() => {
      shorthandSearchRef.current?.focus();
      shorthandSearchRef.current?.select();
    });
    return () => cancelAnimationFrame(focusId);
  }, [isShorthandLibraryOpen]);

  useEffect(() => {
    if ((tool !== 'text' && selectedTextBoxIds.size === 0) || textEditPanelLayout) return;
    const containerWidth = appShellRef.current?.clientWidth ?? Math.max(320, canvasSize.width);
    setTextEditPanelLayout(
      createDefaultEditPanelLayout(containerWidth, { width: 212, height: 360 }, 'right'),
    );
  }, [canvasSize.width, selectedTextBoxIds.size, textEditPanelLayout, tool]);

  useEffect(() => {
    if (!isShorthandLibraryOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsShorthandLibraryOpen(false);
        setShorthandQuery('');
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isShorthandLibraryOpen]);

  useEffect(() => {
    if (!isShorthandLibraryOpen && shorthandQuery) setShorthandQuery('');
  }, [isShorthandLibraryOpen, shorthandQuery]);

  const handleUseForNewDocumentContent = useCallback(() => {
    setDocumentStyleSettings(appPreferences.drawing);
    showToast('Updated defaults for new document content.', 'info');
  }, [appPreferences.drawing, setDocumentStyleSettings, showToast]);

  const handleCenterPageInView = useCallback(() => {
    canvasRef.current?.centerPageInView();
  }, []);

  const handleMoveContentIntoPage = useCallback(() => {
    canvasRef.current?.moveContentIntoPage();
  }, []);

  const handlePrint = useCallback(() => {
    if (pageSetup.mode === 'finite' && offPageContent) {
      showToast(
        'Some content is outside the finite page area and may be clipped in print.',
        'info',
      );
    }
    window.print();
  }, [offPageContent, pageSetup.mode, showToast]);

  const handleApplyDefaultsToCurrentDocument = useCallback(() => {
    applyDefaultsToCurrentDocument();
    showToast('Applied current defaults to this document.', 'info');
  }, [applyDefaultsToCurrentDocument, showToast]);

  const handleResetPreferencesToDefaults = useCallback(() => {
    setAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      drawing: {
        ...DEFAULT_APP_PREFERENCES.drawing,
        textFormat: { ...DEFAULT_APP_PREFERENCES.drawing.textFormat },
        colors: {
          ...DEFAULT_APP_PREFERENCES.drawing.colors,
          atomColors: { ...DEFAULT_APP_PREFERENCES.drawing.colors.atomColors },
        },
      },
      pageSetup: { ...DEFAULT_APP_PREFERENCES.pageSetup },
      viewer: { ...DEFAULT_APP_PREFERENCES.viewer },
      toolPalettes: cloneDefaultToolPalettes(),
    });
    setPreferencesTab('drawing');
    showToast('Preferences reset to defaults.', 'info');
  }, [setAppPreferences, showToast]);

  const focusStructureInput = useCallback(
    (nextValue?: string) => {
      if (typeof nextValue === 'string') setEditableSmiles(nextValue);
      setShowSmilesBar(true);
      window.requestAnimationFrame(() => {
        structureInputRef.current?.focus();
        structureInputRef.current?.select();
      });
    },
    [setEditableSmiles, setShowSmilesBar],
  );

  const handleLoadStructureInput = useCallback(
    (input = editableSmiles) => {
      const value = input.trim();
      if (!value) {
        focusStructureInput(input);
        return;
      }
      canvasRef.current?.loadFromSmiles(value);
    },
    [editableSmiles, focusStructureInput],
  );

  const handleAddStructureInput = useCallback(
    (input = editableSmiles) => {
      const value = input.trim();
      if (!value) {
        focusStructureInput(input);
        return;
      }
      canvasRef.current?.addFromSmiles(value);
    },
    [editableSmiles, focusStructureInput],
  );

  const applySelectedTextSemanticMode = useCallback(
    (semanticMode: 'plain' | 'auto' | 'chemical') => {
      if (selectedTextBoxIds.size === 0) return;
      const { atoms: a, bonds: b, arrows: arr, groups: g, textBoxes: tb } = useStore.getState();
      useStore.getState().pushToHistory({
        atoms: a,
        bonds: b,
        arrows: arr,
        groups: g ?? [],
        textBoxes: (tb ?? []).map((textBox) => {
          if (!selectedTextBoxIds.has(textBox.id)) return textBox;
          const chemistry = evaluateTextBoxChemicalState(textBox.runs, semanticMode);
          const next = {
            ...textBox,
            runs: chemistry.normalizedRuns,
            semanticMode,
            conversionStatus: chemistry.conversionStatus,
          };
          if (chemistry.metadata) return { ...next, chemicalMetadata: chemistry.metadata };
          const withoutChemicalMetadata = { ...next };
          delete withoutChemicalMetadata.chemicalMetadata;
          return withoutChemicalMetadata;
        }),
      });
      showToast(
        semanticMode === 'plain'
          ? 'Selected text boxes now stay plain.'
          : semanticMode === 'chemical'
            ? 'Selected text boxes now force chemical interpretation.'
            : 'Selected text boxes now auto-detect chemistry.',
        'info',
      );
    },
    [selectedTextBoxIds, showToast],
  );

  useEffect(() => {
    if (pageSetup.mode !== 'finite') {
      offPageNoticeShownRef.current = false;
      return;
    }
    if (offPageContent && !offPageNoticeShownRef.current) {
      showToast(
        'Some content is outside the finite page area. Use Move Content Onto Page to fix it.',
        'info',
      );
      offPageNoticeShownRef.current = true;
      return;
    }
    if (!offPageContent) {
      offPageNoticeShownRef.current = false;
    }
  }, [offPageContent, pageSetup.mode, showToast]);

  const handleRotate = useCallback(() => {
    const degrees = parseFloat(rotateInput);
    if (isNaN(degrees)) return;
    const rad = (degrees * Math.PI) / 180;
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
    } = useStore.getState();
    const movedAtomIds = new Set(selectedAtomIds);
    bonds.forEach((bond) => {
      if (!selectedBondIds.has(bond.id)) return;
      movedAtomIds.add(bond.from);
      movedAtomIds.add(bond.to);
    });
    const selAtoms = atoms.filter((a) => movedAtomIds.has(a.id));
    const selArrows = arrows.filter((a) => selectedArrowIds.has(a.id));
    const selTBs = (textBoxes ?? []).filter((t) => selectedTextBoxIds.has(t.id));
    const pts = [
      ...selAtoms.map((a) => ({ x: a.x, y: a.y })),
      ...selArrows.flatMap((a) => getArrowSelectionPoints(a)),
      ...selTBs.map((t) => ({ x: t.x, y: t.y })),
    ];
    if (!pts.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const rot = (x: number, y: number) => ({
      x: cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
      y: cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad),
    });
    const selectedObjectIds = useStore.getState().selectedObjectIds;
    const nativeDocument = useStore.getState().chemDrawDocument;
    if (nativeDocument && selectedObjectIds.size > 0) {
      useStore.getState().dispatchEditorCommand(
        createRotateSelectionCommand({ x: cx, y: cy }, rad, {
          objectIds: selectedObjectIds,
          description: 'rotate-selected-objects',
        }),
      );
    } else {
      pushToHistory({
        atoms: atoms.map((a) => {
          if (!movedAtomIds.has(a.id)) return a;
          const r = rot(a.x, a.y);
          return { ...a, x: r.x, y: r.y };
        }),
        bonds,
        arrows: arrows.map((a) => {
          if (!selectedArrowIds.has(a.id)) return a;
          const r1 = rot(a.x1, a.y1),
            r2 = rot(a.x2, a.y2),
            rc = rot(a.cpx, a.cpy);
          return { ...a, x1: r1.x, y1: r1.y, x2: r2.x, y2: r2.y, cpx: rc.x, cpy: rc.y };
        }),
        groups: groups ?? [],
        textBoxes: (textBoxes ?? []).map((t) => {
          if (!selectedTextBoxIds.has(t.id)) return t;
          const r = rot(t.x, t.y);
          return { ...t, x: r.x, y: r.y };
        }),
      });
    }
    setShowRotateDialog(false);
    setRotateInput('');
  }, [rotateInput]);

  const handleScale = useCallback(() => {
    const factor = parseFloat(scaleInput);
    if (isNaN(factor) || factor <= 0) return;
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
    } = useStore.getState();
    const movedAtomIds = new Set(selectedAtomIds);
    bonds.forEach((bond) => {
      if (!selectedBondIds.has(bond.id)) return;
      movedAtomIds.add(bond.from);
      movedAtomIds.add(bond.to);
    });
    const selAtoms = atoms.filter((a) => movedAtomIds.has(a.id));
    const selArrows = arrows.filter((a) => selectedArrowIds.has(a.id));
    const selTBs = (textBoxes ?? []).filter((t) => selectedTextBoxIds.has(t.id));
    const pts = [
      ...selAtoms.map((a) => ({ x: a.x, y: a.y })),
      ...selArrows.flatMap((a) => getArrowSelectionPoints(a)),
      ...selTBs.map((t) => ({ x: t.x, y: t.y })),
    ];
    if (!pts.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const sc = (x: number, y: number) => ({
      x: cx + (x - cx) * factor,
      y: cy + (y - cy) * factor,
    });
    const selectedObjectIds = useStore.getState().selectedObjectIds;
    const nativeDocument = useStore.getState().chemDrawDocument;
    if (nativeDocument && selectedObjectIds.size > 0) {
      useStore.getState().dispatchEditorCommand(
        createScaleSelectionCommand({ x: cx, y: cy }, factor, {
          objectIds: selectedObjectIds,
          description: 'scale-selected-objects',
        }),
      );
    } else {
      pushToHistory({
        atoms: atoms.map((a) => {
          if (!movedAtomIds.has(a.id)) return a;
          const r = sc(a.x, a.y);
          return { ...a, x: r.x, y: r.y };
        }),
        bonds,
        arrows: arrows.map((a) => {
          if (!selectedArrowIds.has(a.id)) return a;
          const r1 = sc(a.x1, a.y1),
            r2 = sc(a.x2, a.y2),
            rc = sc(a.cpx, a.cpy);
          return { ...a, x1: r1.x, y1: r1.y, x2: r2.x, y2: r2.y, cpx: rc.x, cpy: rc.y };
        }),
        groups: groups ?? [],
        textBoxes: (textBoxes ?? []).map((t) => {
          if (!selectedTextBoxIds.has(t.id)) return t;
          const r = sc(t.x, t.y);
          return { ...t, x: r.x, y: r.y };
        }),
      });
    }
    setShowScaleDialog(false);
    setScaleInput('');
  }, [scaleInput]);

  // Dark mode body class
  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    const syncInputFocusState = () => {
      const root = appShellRef.current;
      const focused = shouldIgnoreKeyboardShortcuts(
        document.activeElement,
        document.activeElement,
        root,
      );
      if (useStore.getState().isInputFocused !== focused) {
        useStore.getState().setIsInputFocused(focused);
      }
    };

    const scheduleSync = () => {
      window.requestAnimationFrame(syncInputFocusState);
    };

    syncInputFocusState();
    document.addEventListener('focusin', scheduleSync, true);
    document.addEventListener('focusout', scheduleSync, true);
    window.addEventListener('blur', scheduleSync);
    document.addEventListener('visibilitychange', scheduleSync);
    return () => {
      document.removeEventListener('focusin', scheduleSync, true);
      document.removeEventListener('focusout', scheduleSync, true);
      window.removeEventListener('blur', scheduleSync);
      document.removeEventListener('visibilitychange', scheduleSync);
    };
  }, [setIsInputFocused]);

  useEffect(() => {
    let cancelled = false;
    loadAppPreferences()
      .then((prefs) => {
        if (!cancelled) hydrateAppPreferences(prefs);
      })
      .catch(() => {
        /* intentional */
      });
    return () => {
      cancelled = true;
    };
  }, [hydrateAppPreferences]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const isAppTarget = (target: EventTarget | null) =>
      target instanceof Node && root.contains(target);

    const preventPageZoomWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !isAppTarget(event.target)) return;
      event.preventDefault();
    };

    const preventPageZoomGesture = (event: Event) => {
      if (!isAppTarget(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener('wheel', preventPageZoomWheel, { passive: false, capture: true });
    document.addEventListener('gesturestart', preventPageZoomGesture as EventListener, {
      passive: false,
      capture: true,
    });
    document.addEventListener('gesturechange', preventPageZoomGesture as EventListener, {
      passive: false,
      capture: true,
    });
    document.addEventListener('gestureend', preventPageZoomGesture as EventListener, {
      passive: false,
      capture: true,
    });
    return () => {
      document.removeEventListener('wheel', preventPageZoomWheel, true);
      document.removeEventListener('gesturestart', preventPageZoomGesture as EventListener, true);
      document.removeEventListener('gesturechange', preventPageZoomGesture as EventListener, true);
      document.removeEventListener('gestureend', preventPageZoomGesture as EventListener, true);
    };
  }, []);

  // Sync textFormat from first selected text box
  useEffect(() => {
    if (selectedTextBoxIds.size > 0) {
      const firstId = Array.from(selectedTextBoxIds)[0];
      const tb = textBoxes.find((t) => t.id === firstId);
      if (tb)
        setTextFormat({
          fontFamily: tb.fontFamily,
          fontSize: tb.fontSize,
          color: tb.color,
          textAlign: tb.textAlign ?? 'center',
        });
    }
  }, [selectedTextBoxIds, textBoxes, setTextFormat]);

  // Viewer mode reset position
  useEffect(() => {
    if (viewerMode === 'pinned') setViewerPos({ x: 10, y: 10 });
  }, [viewerMode, setViewerPos]);

  // Viewer split width initial
  useEffect(() => {
    if (viewerMode === 'split' && splitWidth === 450 && workspaceRef.current) {
      setSplitWidth(workspaceRef.current.clientWidth / 2);
    }
  }, [viewerMode, splitWidth, setSplitWidth]);

  // Canvas size update — use ResizeObserver so any layout change triggers a re-measure
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const updateSize = () => {
      let w = el.clientWidth;
      const h = el.clientHeight;
      if (viewerMode === 'split' && showViewer) {
        const maxSplit = Math.max(100, w - 150);
        if (splitWidth > maxSplit) setSplitWidth(maxSplit);
        w -= Math.min(splitWidth, maxSplit) + 4;
      }
      setCanvasSize({ width: Math.max(100, w), height: Math.max(100, h) });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sidebarWidth, viewerMode, splitWidth, showViewer, setCanvasSize, setSplitWidth]);

  // Load licenses
  useEffect(() => {
    const loadLicenses = async () => {
      const licenseFiles = import.meta.glob('./assets/licenses/*.txt', {
        query: '?raw',
        import: 'default',
      });
      const texts: string[] = [];
      for (const path of Object.keys(licenseFiles).sort()) {
        try {
          const text = await (licenseFiles[path] as () => Promise<string>)();
          texts.push(
            `========================================================================\n${text}`,
          );
        } catch {
          /* intentional */
        }
      }
      setLicensesText(
        'ChemEditor uses the following open-source software:\n\n' + texts.join('\n\n'),
      );
    };
    loadLicenses();
  }, [setLicensesText]);

  // Click-outside for menus
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const calculateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(ev.target as Node)) {
        setIsFileDropdownOpen(false);
        setIsExportSubmenuOpen(false);
      }
      if (editMenuRef.current && !editMenuRef.current.contains(ev.target as Node))
        setIsEditDropdownOpen(false);
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(ev.target as Node))
        setIsSettingsDropdownOpen(false);
      if (calculateMenuRef.current && !calculateMenuRef.current.contains(ev.target as Node))
        setIsCalculateDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [
    setIsFileDropdownOpen,
    setIsExportSubmenuOpen,
    setIsEditDropdownOpen,
    setIsSettingsDropdownOpen,
    setIsCalculateDropdownOpen,
  ]);

  // File operations
  const handleOpen = useCallback(async () => {
    setIsFileDropdownOpen(false);
    try {
      const file = await openChemicalTextFile();
      if (!file) {
        return;
      }
      if (file.extension === 'cdxml') {
        await canvasRef.current?.loadNative(file.content);
      } else {
        const result = await invokeTauri<SidecarParseResult>('parse_chemical_file', {
          content: file.content,
          format: file.extension,
        });
        if (result.error) useStore.getState().showToast(`Could not parse file: ${result.error}`);
        else canvasRef.current?.loadFromSmiles(result.molblock);
      }
    } catch (e) {
      useStore.getState().showToast('Failed to open file');
      console.error(e);
    }
  }, [setIsFileDropdownOpen]);

  const handleSaveNative = useCallback(async () => {
    setIsFileDropdownOpen(false);
    try {
      await canvasRef.current?.saveNative();
    } catch (e) {
      useStore.getState().showToast('Failed to save file');
      console.error(e);
    }
  }, [setIsFileDropdownOpen]);

  const handleInsertImage = useCallback(async () => {
    setIsFileDropdownOpen(false);
    try {
      const file = await openImageBinaryFile();
      if (!file) return;
      await canvasRef.current?.insertImage({
        bytes: file.content,
        mimeType: file.mimeType,
        sourceFileName: file.filePath.split('/').pop() ?? file.filePath,
      });
    } catch (error) {
      useStore.getState().showToast('Failed to insert image');
      console.error(error);
    }
  }, [setIsFileDropdownOpen]);

  const handleExport = async (format: 'png' | 'svg' | 'cdxml' | 'sdf' | 'mol' | 'rxn' | 'smi') => {
    setIsFileDropdownOpen(false);
    setIsExportSubmenuOpen(false);
    try {
      if (format === 'png') {
        await canvasRef.current?.exportPNG();
      } else if (format === 'svg') {
        await canvasRef.current?.exportSVG();
      } else if (format === 'cdxml') {
        await canvasRef.current?.saveNative();
      } else if (format === 'smi') {
        const smiles = useStore.getState().viewerSmiles;
        if (smiles) {
          await saveTextWithDialog({
            title: 'Export SMILES',
            defaultPath: 'structure.smi',
            name: 'SMILES',
            extensions: ['smi'],
            content: smiles + '\n',
          });
        }
      } else {
        const molblock = canvasRef.current?.getMolblock();
        if (!molblock) return;
        const arrowsJson =
          format === 'rxn' ? JSON.stringify(useStore.getState().arrows) : undefined;
        const result = await invokeTauri<SidecarExportResult>('export_chemical_file', {
          molblock,
          format,
          arrowsJson,
        });
        if (!result.error) {
          const names: Record<string, string> = {
            sdf: 'SD File',
            mol: 'MDL Molfile',
            rxn: 'RXN File',
          };
          await saveTextWithDialog({
            title: `Export as ${names[format] || format.toUpperCase()}`,
            defaultPath: `structure.${format}`,
            name: names[format] || format.toUpperCase(),
            extensions: [format],
            content: result.content,
          });
        }
      }
    } catch (e) {
      useStore.getState().showToast('Export failed');
      console.error('Export failed:', e);
    }
  };

  const handleViewerScreenshot = async () => {
    if (previewMode === '3D') {
      const dataUrl = molecule3DRef.current?.captureViewer();
      if (dataUrl) {
        try {
          await saveBinaryWithDialog({
            title: 'Export 3D PNG',
            defaultPath: 'molecule_3d.png',
            name: 'PNG Image',
            extensions: ['png'],
            content: Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0)),
          });
        } catch {
          /* intentional */
        }
      }
    } else if (rdkit && viewerSmiles) {
      try {
        const mol = rdkit.get_mol(viewerSmiles);
        if (mol) {
          const svg = mol.get_svg(1200, 1200);
          mol.delete();
          await saveTextWithDialog({
            title: 'Export 2D SVG',
            defaultPath: 'molecule_2d.svg',
            name: 'SVG Image',
            extensions: ['svg'],
            content: svg,
          });
        }
      } catch {
        /* intentional */
      }
    }
  };

  // Clipboard handlers
  const handleCopy = useCallback(() => {
    const {
      atoms,
      bonds,
      arrows,
      textBoxes,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      isDarkMode: dm,
    } = useStore.getState();
    const buf = extractSelection(
      atoms,
      bonds,
      arrows,
      textBoxes,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
    );
    setClipboardBuffer(buf);
    resetPasteCount();
    writeClipboardText(stateToCDXML(buf, { documentStyleSettings })).catch(() => {
      /* intentional */
    });
    try {
      const svg = generateCanvasSVG(buf.atoms, buf.bonds, buf.arrows, dm, true, buf.textBoxes);
      const widthMatch = svg.match(/width="([^"]+)"/);
      const heightMatch = svg.match(/height="([^"]+)"/);
      const w = widthMatch ? Math.ceil(parseFloat(widthMatch[1])) : 400;
      const h = heightMatch ? Math.ceil(parseFloat(heightMatch[1])) : 300;
      const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = 3;
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w * scale, h * scale);
        const rgba = ctx.getImageData(0, 0, w * scale, h * scale).data;
        const bytes = new Uint8Array(rgba.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const b64 = btoa(binary);
        invokeTauri('copy_image_to_clipboard', {
          rgbaB64: b64,
          width: w * scale,
          height: h * scale,
        }).catch(console.error);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    } catch {
      /* intentional */
    }
  }, [documentStyleSettings]);

  const handleCut = useCallback(() => {
    handleCopy();
    const {
      atoms,
      bonds,
      arrows,
      textBoxes,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      selectedObjectIds,
      chemDrawDocument,
      pushToHistory: kPush,
    } = useStore.getState();
    if (
      selectedAtomIds.size > 0 ||
      selectedBondIds.size > 0 ||
      selectedArrowIds.size > 0 ||
      selectedTextBoxIds.size > 0
    ) {
      if (chemDrawDocument && selectedObjectIds.size > 0) {
        useStore.getState().dispatchEditorCommand(
          createDeleteSelectionCommand({
            objectIds: selectedObjectIds,
            description: 'delete-selected-objects',
          }),
        );
      } else {
        kPush({
          atoms: atoms.filter((a) => !selectedAtomIds.has(a.id)),
          bonds: bonds.filter(
            (b) =>
              !selectedBondIds.has(b.id) &&
              !selectedAtomIds.has(b.from) &&
              !selectedAtomIds.has(b.to),
          ),
          arrows: arrows.filter((a) => !selectedArrowIds.has(a.id)),
          textBoxes: textBoxes.filter((t) => !selectedTextBoxIds.has(t.id)),
        });
      }
      useStore.getState().setSelectedAtomIds(new Set());
      useStore.getState().setSelectedBondIds(new Set());
      useStore.getState().setSelectedArrowIds(new Set());
      useStore.getState().setSelectedTextBoxIds(new Set());
    } else {
      kPush({ atoms: [], bonds: [], arrows: [], textBoxes: [] });
    }
  }, [handleCopy]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await readClipboardText();
      const fmt = detectPasteFormat(text);
      if (fmt === 'cdxml') {
        const parsed = cdxmlToState(text);
        const offset = bumpPasteCount();
        canvasRef.current?.addFromState(applyPasteOffset(parsed, offset));
        return;
      }
      if (fmt === 'smiles' || fmt === 'molblock') {
        useStore.getState().setRawConformer(null);
        useStore.getState().setMinimizeGeometry(true);
        canvasRef.current?.addFromSmiles(text);
        return;
      }
      if (fmt === 'xyz') {
        useStore.getState().setMinimizeGeometry(false);
        useStore.getState().setRawConformer(null);
        try {
          const [result, xyz3d] = await Promise.all([
            invokeTauri<SidecarParseResult>('parse_chemical_file', {
              content: text,
              format: 'xyz',
            }),
            invokeTauri<SidecarXyzConformerResult>('xyz_to_conformer', { xyzText: text }),
          ]);
          if (!result.error) canvasRef.current?.addFromSmiles(result.molblock);
          if (!xyz3d.error && xyz3d.conformers && xyz3d.conformers.length > 0) {
            useStore.getState().setRawConformer({
              structureKey: result.molblock || text,
              forceField: 'UFF',
              atoms: xyz3d.conformers[0].atoms,
              bonds: xyz3d.bonds ?? [],
            });
          }
        } catch {
          /* intentional */
        }
        return;
      }
    } catch {
      /* intentional */
    }
    // Fall back to internal buffer
    useStore.getState().setRawConformer(null);
    useStore.getState().setMinimizeGeometry(true);
    const buf = getClipboardBuffer();
    if (buf) {
      const offset = bumpPasteCount();
      canvasRef.current?.addFromState(applyPasteOffset(buf, offset));
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const shortcutsBlocked = shouldIgnoreKeyboardShortcuts(
        e.target,
        document.activeElement,
        appShellRef.current,
      );
      if (useStore.getState().isInputFocused !== shortcutsBlocked) {
        useStore.getState().setIsInputFocused(shortcutsBlocked);
      }
      if (shortcutsBlocked) return;
      const matches = (shortcutId: string) =>
        eventMatchesShortcut(e, getShortcutBinding(appPreferences.keybindings, shortcutId));

      if (matches('app.file.save')) {
        e.preventDefault();
        handleSaveNative();
      }
      if (matches('app.file.open')) {
        e.preventDefault();
        handleOpen();
      }
      if (matches('app.file.print')) {
        e.preventDefault();
        handlePrint();
      }
      if (matches('app.edit.undo')) {
        e.preventDefault();
        undo();
      }
      if (matches('app.edit.redo')) {
        e.preventDefault();
        redo();
      }
      if (matches('app.edit.select-all')) {
        e.preventDefault();
        selectAll();
      }
      if (matches('app.edit.copy')) {
        e.preventDefault();
        handleCopy();
      }
      if (matches('app.edit.cut')) {
        e.preventDefault();
        handleCut();
      }
      if (matches('app.edit.paste')) {
        e.preventDefault();
        handlePaste();
      }
      if (matches('app.edit.cleanup')) {
        e.preventDefault();
        canvasRef.current?.cleanUp();
      }
      if (matches('app.view.fit')) {
        e.preventDefault();
        canvasRef.current?.fitToScreen();
      }
      if (matches('app.view.toggle-theme')) {
        e.preventDefault();
        setIsDarkMode(!useStore.getState().isDarkMode);
      }
      if (isMacOS && matches('app.view.fullscreen')) {
        e.preventDefault();
        void invokeTauri('toggle_native_fullscreen');
      }
      if (matches('app.arrange.rotate')) {
        e.preventDefault();
        setRotateInput('');
        setShowRotateDialog(true);
      }
      if (matches('app.arrange.group')) {
        e.preventDefault();
        groupSelected();
      }
      if (matches('app.arrange.ungroup')) {
        e.preventDefault();
        ungroupSelected();
      }
      if (matches('app.arrange.align-left')) {
        e.preventDefault();
        alignSelection('alignLeft');
      }
      if (matches('app.arrange.align-right')) {
        e.preventDefault();
        alignSelection('alignRight');
      }
      if (matches('app.arrange.align-top')) {
        e.preventDefault();
        alignSelection('alignTop');
      }
      if (matches('app.arrange.align-bottom')) {
        e.preventDefault();
        alignSelection('alignBottom');
      }
      if (matches('app.arrange.center-h')) {
        e.preventDefault();
        alignSelection('centerH');
      }
      if (matches('app.arrange.center-v')) {
        e.preventDefault();
        alignSelection('centerV');
      }
      if (matches('app.arrange.distribute-h')) {
        e.preventDefault();
        alignSelection('distributeH');
      }
      if (matches('app.arrange.distribute-v')) {
        e.preventDefault();
        alignSelection('distributeV');
      }
      if (matches('app.selection.clear')) {
        deselectAll();
        closeAllMenus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    handleSaveNative,
    handleOpen,
    handleCopy,
    handleCut,
    handlePaste,
    undo,
    redo,
    selectAll,
    deselectAll,
    closeAllMenus,
    alignSelection,
    groupSelected,
    ungroupSelected,
    handlePrint,
    appPreferences.keybindings,
    setIsDarkMode,
  ]);

  // Sidebar resize
  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const move = (ev: MouseEvent) => {
        if (isResizing.current) setSidebarWidth(Math.min(Math.max(50, ev.clientX), 150));
      };
      const up = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = 'default';
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    },
    [setSidebarWidth],
  );

  // Viewer drag
  const startViewerDragging = useCallback(
    (e: React.MouseEvent) => {
      if (viewerMode === 'split') return;
      e.preventDefault();
      isViewerDragging.current = true;
      const startX = e.clientX,
        startY = e.clientY,
        initialPos = { ...viewerPos };
      const move = (ev: MouseEvent) => {
        if (!isViewerDragging.current) return;
        const dx = ev.clientX - startX,
          dy = ev.clientY - startY;
        setViewerPos({
          x: initialPos.x + (viewerMode === 'pinned' ? -dx : dx),
          y: initialPos.y + dy,
        });
      };
      const up = () => {
        isViewerDragging.current = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [viewerMode, viewerPos, setViewerPos],
  );

  // Viewer resize
  const startViewerResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isViewerResizing.current = true;
      const startX = e.clientX,
        startY = e.clientY,
        initSize = { ...viewerSize };
      const move = (ev: MouseEvent) => {
        if (!isViewerResizing.current) return;
        const dx = ev.clientX - startX,
          dy = ev.clientY - startY;
        const newW = viewerMode === 'pinned' ? initSize.width - dx : initSize.width + dx;
        setViewerSize({
          width: Math.min(Math.max(150, newW), 800),
          height: Math.min(Math.max(120, initSize.height + dy), 600),
        });
      };
      const up = () => {
        isViewerResizing.current = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = 'default';
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'nwse-resize';
    },
    [viewerMode, viewerSize, setViewerSize],
  );

  // Split resize
  const startSplitResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isSplitResizing.current = true;
      const move = (ev: MouseEvent) => {
        if (!isSplitResizing.current || !workspaceRef.current) return;
        const rect = workspaceRef.current.getBoundingClientRect();
        setSplitWidth(Math.min(Math.max(100, rect.right - ev.clientX), rect.width - 100));
      };
      const up = () => {
        isSplitResizing.current = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = 'default';
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    },
    [setSplitWidth],
  );

  const theme: AppTheme = {
    bg: isDarkMode ? '#1e1e1e' : '#ebebeb',
    sidebar: isDarkMode ? '#252526' : '#f3f3f3',
    header: isDarkMode ? '#333333' : '#ffffff',
    text: isDarkMode ? '#cccccc' : '#444444',
    border: isDarkMode ? '#444444' : '#dcdcdc',
    canvas: isDarkMode ? '#1e1e1e' : '#f5f5f5',
  };

  useEffect(() => {
    if (!isMacOS) return;
    const windowTheme: AppWindowTheme = isDarkMode ? 'dark' : 'light';
    withAppWindow((appWindow) => {
      void appWindow.setTheme(windowTheme);
    });
    void invokeTauri('sync_macos_window_theme', { isDarkMode });
  }, [isDarkMode]);

  const uiScale = appPreferences.ui.scale;
  const uiFontSize = appPreferences.ui.fontSize;
  const buttonScale = Math.min(Math.max(0.82, sidebarWidth / 72), 1.15);
  const buttonSize = 34 * buttonScale;
  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    width: `${buttonSize}px`,
    height: `${buttonSize}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: active ? (isDarkMode ? '#37373d' : '#e0e0e0') : 'transparent',
    border: active ? `1px solid ${isDarkMode ? '#007acc' : '#bbb'}` : '1px solid transparent',
    borderRadius: '4px',
    fontSize: `${18 * buttonScale}px`,
    transition: 'background 0.1s',
    position: 'relative',
    flexShrink: 0,
    color: theme.text,
  });
  const elementBtnStyle = (active: boolean): React.CSSProperties => ({
    width: `${buttonSize * 0.8}px`,
    height: `${buttonSize * 0.8}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: active ? '#007acc' : isDarkMode ? '#333' : '#fff',
    color: active ? '#fff' : theme.text,
    border: `1px solid ${isDarkMode ? '#444' : '#ccc'}`,
    borderRadius: '50%',
    fontSize: `${12 * buttonScale}px`,
    fontWeight: 'bold',
    margin: '2px',
    transition: 'all 0.1s',
    flexShrink: 0,
  });
  const palettePillStyle = (active: boolean): React.CSSProperties => ({
    minWidth: `${buttonSize * 0.95}px`,
    height: `${buttonSize * 0.7}px`,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: active ? '#007acc' : isDarkMode ? '#333' : '#fff',
    color: active ? '#fff' : theme.text,
    border: `1px solid ${active ? '#007acc' : isDarkMode ? '#444' : '#ccc'}`,
    borderRadius: 999,
    fontSize: `${10.5 * buttonScale}px`,
    fontWeight: 600,
    transition: 'all 0.1s',
    flexShrink: 0,
  });
  const paletteWideButtonStyle = (active = false, disabled = false): React.CSSProperties => ({
    width: '100%',
    minHeight: `${buttonSize * 0.74}px`,
    padding: '6px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: active ? '#007acc' : isDarkMode ? '#333' : '#fff',
    color: active ? '#fff' : theme.text,
    border: `1px solid ${active ? '#007acc' : isDarkMode ? '#444' : '#ccc'}`,
    borderRadius: 6,
    fontSize: `${10.5 * buttonScale}px`,
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: 'center',
    opacity: disabled ? 0.45 : 1,
    transition: 'all 0.1s',
  });
  const paletteSectionLabelStyle: React.CSSProperties = {
    width: '100%',
    fontSize: `${10.75 * buttonScale}px`,
    fontWeight: 'bold',
    letterSpacing: '0.04em',
    color: isDarkMode ? '#8f8f8f' : '#707070',
    textTransform: 'uppercase',
    textAlign: 'left',
    marginTop: 2,
  };
  const isCompactTextPalette = sidebarWidth < 118;
  const textPalettePrimaryGridColumns = `repeat(auto-fit, minmax(${isCompactTextPalette ? 72 : 84}px, 1fr))`;
  const textPaletteSemanticGridColumns = `repeat(auto-fit, minmax(${isCompactTextPalette ? 54 : 64}px, 1fr))`;
  const textPaletteBodyCopyStyle: React.CSSProperties = {
    width: '100%',
    fontSize: `${isCompactTextPalette ? 8.75 : 9.1 * buttonScale}px`,
    lineHeight: 1.35,
    color: isDarkMode ? '#b8b8b8' : '#666',
  };
  const textPaletteInfoCardStyle: React.CSSProperties = {
    width: '100%',
    border: `1px solid ${textChemistryBorderColor}`,
    background: textChemistryBackgroundColor,
    borderRadius: 8,
    padding: isCompactTextPalette ? '6px 7px' : '7px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  };
  const periodicTableMonochrome = documentViewSettings.atomColorViewMode === 'chemdraw-fidelity';
  const getPeriodicTableElementColor = useCallback(
    (symbol: string) =>
      resolveAtomLabelColor(
        undefined,
        symbol,
        documentStyleSettings,
        isDarkMode,
        documentViewSettings,
      ),
    [documentStyleSettings, documentViewSettings, isDarkMode],
  );
  const setPeriodicTableMonochrome = useCallback(
    (monochrome: boolean) => {
      setDocumentViewSettings({
        ...documentViewSettings,
        atomColorViewMode: monochrome ? 'chemdraw-fidelity' : 'enhanced-defaults',
      });
    },
    [documentViewSettings, setDocumentViewSettings],
  );

  const getBondIcon = () => {
    if (stereo === 1) {
      return (
        <svg
          width={22 * buttonScale}
          height={22 * buttonScale}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4.5 15.8L12 8.2L19.5 15.8Z" fill="currentColor" />
        </svg>
      );
    }
    if (stereo === 6) {
      return (
        <svg
          width={22 * buttonScale}
          height={22 * buttonScale}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((index) => (
            <path
              key={index}
              d={`M${6 + index * 2.4} ${16 - index * 2.2}L${10 + index * 2.2} ${8 + index * 2.2}`}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}
        </svg>
      );
    }
    if (bondOrder === 2) {
      return (
        <svg
          width={22 * buttonScale}
          height={22 * buttonScale}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4.5 9H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 15H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    }
    if (bondOrder === 3) {
      return (
        <svg
          width={22 * buttonScale}
          height={22 * buttonScale}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4.5 8H19.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M4.5 12H19.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M4.5 16H19.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    }
    return <StructureFragmentIcon id="bond" size={22 * buttonScale} />;
  };

  const renderAtomShortcut = (label: string) => {
    const active = tool === 'atom' && atomToolMode === 'element' && element === label;
    const style = label.length <= 2 ? elementBtnStyle(active) : palettePillStyle(active);
    return (
      <button
        key={label}
        type="button"
        onClick={() => {
          setTool('atom');
          setElement(label);
          setShowBondMenu(false);
        }}
        style={style}
        title={label}
      >
        {label}
      </button>
    );
  };
  const handleSelectShorthand = useCallback(
    (label: string) => {
      setTool('atom');
      setAtomToolSelection(label, 'alias');
      setShowBondMenu(false);
    },
    [setAtomToolSelection, setShowBondMenu, setTool],
  );
  const openShorthandLibrary = useCallback(
    (anchorElement?: HTMLElement | null) => {
      if (anchorElement && appShellRef.current) {
        const anchorRect = anchorElement.getBoundingClientRect();
        const shellRect = appShellRef.current.getBoundingClientRect();
        const maxX = Math.max(24, shellRect.width - shorthandLibrarySize.width - 24);
        const maxY = Math.max(24, shellRect.height - shorthandLibrarySize.height - 24);
        setShorthandLibraryPos({
          x: Math.max(24, Math.min(anchorRect.right - shellRect.left + 12, maxX)),
          y: Math.max(24, Math.min(anchorRect.top - shellRect.top, maxY)),
        });
      }
      setShowBondMenu(false);
      setIsShorthandLibraryOpen(true);
    },
    [setShowBondMenu, shorthandLibrarySize.height, shorthandLibrarySize.width],
  );
  const renderShorthandLibrary = () => {
    const buttonActive = isShorthandLibraryOpen || (tool === 'atom' && Boolean(selectedShorthand));
    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          type="button"
          onClick={(event) => {
            if (isShorthandLibraryOpen) {
              setIsShorthandLibraryOpen(false);
              setShorthandQuery('');
              return;
            }
            openShorthandLibrary(event.currentTarget);
          }}
          style={{
            ...paletteWideButtonStyle(buttonActive),
            minHeight: 0,
            padding: '7px 9px',
          }}
          title="Open the shorthand library window"
        >
          Library
        </button>
        <div
          style={{
            width: '100%',
            fontSize: `${9 * buttonScale}px`,
            lineHeight: 1.3,
            color: isDarkMode ? '#b8b8b8' : '#666',
          }}
          title={
            selectedShorthand
              ? `Selected shorthand: ${selectedShorthand}`
              : `${shorthandLibraryCounts.structure} structure, ${shorthandLibraryCounts.coordination} ligand, ${shorthandLibraryCounts['display-only']} label-only`
          }
        >
          {selectedShorthand
            ? `Selected: ${truncateToolbarText(selectedShorthand, 18)}`
            : `${SHORTHAND_LIBRARY.length} aliases`}
        </div>
      </div>
    );
  };
  const renderShorthandSupportBadge = (support: AliasLibrarySupport) => {
    const palette =
      support === 'structure'
        ? isDarkMode
          ? { bg: 'rgba(46, 125, 50, 0.22)', border: '#2e7d32', text: '#d7f0db' }
          : { bg: '#edf8f0', border: '#8dc69a', text: '#1f5b25' }
        : support === 'coordination'
          ? isDarkMode
            ? { bg: 'rgba(21, 101, 192, 0.22)', border: '#1565c0', text: '#d9eaff' }
            : { bg: '#edf4ff', border: '#9bb9ea', text: '#184a94' }
          : isDarkMode
            ? { bg: 'rgba(112, 112, 112, 0.24)', border: '#686868', text: '#dddddd' }
            : { bg: '#f2f2f2', border: '#d0d0d0', text: '#585858' };
    return (
      <span
        style={{
          padding: '2px 6px',
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: palette.bg,
          color: palette.text,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {support === 'structure'
          ? 'Structure'
          : support === 'coordination'
            ? 'Ligand'
            : 'Label only'}
      </span>
    );
  };
  const renderShorthandLibraryPanel = () => {
    if (!isShorthandLibraryOpen) return null;
    return (
      <FloatingPanel
        pos={shorthandLibraryPos}
        size={shorthandLibrarySize}
        minWidth={320}
        minHeight={360}
        title="Shorthand Library"
        theme={theme}
        isDarkMode={isDarkMode}
        zIndex={910}
        borderRadius={10}
        onClose={() => {
          setIsShorthandLibraryOpen(false);
          setShorthandQuery('');
        }}
        onPosChange={setShorthandLibraryPos}
        onSizeChange={setShorthandLibrarySize}
      >
        <div
          style={{
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0,
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <input
              ref={shorthandSearchRef}
              type="text"
              value={shorthandQuery}
              onChange={(event) => setShorthandQuery(event.target.value)}
              placeholder="Filter shorthand labels"
              style={{
                flex: '1 1 190px',
                minWidth: 0,
                border: `1px solid ${theme.border}`,
                borderRadius: 7,
                padding: '7px 9px',
                fontSize: `${10.5 * buttonScale}px`,
                background: isDarkMode ? '#1f1f22' : '#fafafa',
                color: theme.text,
                outline: 'none',
              }}
            />
            {(
              [
                ['all', `All (${shorthandLibraryCounts.all})`],
                ['structure', `Structure (${shorthandLibraryCounts.structure})`],
                ['coordination', `Ligand (${shorthandLibraryCounts.coordination})`],
                ['display-only', `Label (${shorthandLibraryCounts['display-only']})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setShorthandSupportFilter(value)}
                style={palettePillStyle(shorthandSupportFilter === value)}
                title={
                  value === 'all'
                    ? 'Show every shorthand'
                    : value === 'structure'
                      ? 'Show shorthands that expand into editable structure'
                      : value === 'coordination'
                        ? 'Show coordination-aware ligand shorthands'
                        : 'Show compact label-only shorthands'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: isDarkMode ? '#b8b8b8' : '#666',
            }}
          >
            Shorthands let you place common groups, ligands, residues, and protecting groups as a
            single label. Most expand into editable atoms and bonds, while ligand entries preserve
            their shorthand behavior for coordination chemistry.
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            {groupedShorthandLibrary.length === 0 ? (
              <div
                style={{
                  padding: '10px 4px',
                  fontSize: `${10 * buttonScale}px`,
                  color: isDarkMode ? '#b0b0b0' : '#666',
                }}
              >
                No shorthand labels match “{shorthandQuery.trim()}”.
              </div>
            ) : (
              groupedShorthandLibrary.map((section) => (
                <div
                  key={section.group}
                  style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                >
                  <div
                    style={{
                      fontSize: `${8.5 * buttonScale}px`,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: isDarkMode ? '#8f8f8f' : '#707070',
                      padding: '0 2px',
                    }}
                  >
                    {section.label}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {section.items.map((entry) => {
                      const active =
                        tool === 'atom' && atomToolMode === 'alias' && element === entry.label;
                      return (
                        <button
                          key={entry.label}
                          type="button"
                          onClick={() => handleSelectShorthand(entry.label)}
                          style={{
                            minHeight: `${buttonSize * 0.7}px`,
                            padding: '7px 8px',
                            borderRadius: 7,
                            border: `1px solid ${
                              active ? '#007acc' : isDarkMode ? '#444' : '#d0d0d0'
                            }`,
                            background: active ? '#007acc' : isDarkMode ? '#333' : '#fff',
                            color: active ? '#fff' : theme.text,
                            fontSize: `${10.25 * buttonScale}px`,
                            fontWeight: 600,
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                          }}
                          title={`${entry.label}\nLead: ${entry.lead}\nType: ${
                            entry.support === 'structure'
                              ? 'Expands into editable structure'
                              : entry.support === 'coordination'
                                ? 'Coordination-aware ligand shorthand'
                                : 'Compact shorthand label'
                          }`}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {entry.label}
                          </span>
                          {renderShorthandSupportBadge(entry.support)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </FloatingPanel>
    );
  };

  const bondMenuPos = bondBtnRef.current?.getBoundingClientRect();
  const ringBtnPos = ringBtnRef.current?.getBoundingClientRect();
  const paletteHeaderButtonStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  };

  const renderPaletteBody = (paletteId: ToolPaletteId) => {
    switch (paletteId) {
      case 'tools':
        return (
          <>
            <div
              title="Pan"
              onClick={() => {
                setTool('pan');
                setShowBondMenu(false);
              }}
              style={toolBtnStyle(tool === 'pan')}
            >
              <svg
                width={18 * buttonScale}
                height={18 * buttonScale}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
                <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v10" />
                <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
                <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
              </svg>
            </div>
            <div
              title="Select"
              onClick={() => {
                setTool('select');
                setShowBondMenu(false);
              }}
              style={toolBtnStyle(tool === 'select')}
            >
              ✥
            </div>
            <div
              title="Text"
              onClick={() => {
                setTool('text');
                setShowBondMenu(false);
              }}
              style={toolBtnStyle(tool === 'text')}
            >
              T
            </div>
            <div
              title="Eraser"
              onClick={() => {
                setTool('eraser');
                setShowBondMenu(false);
              }}
              style={toolBtnStyle(tool === 'eraser')}
            >
              ▱
            </div>
          </>
        );
      case 'ring':
        return (
          <>
            <div
              ref={bondBtnRef}
              title="Bond Tool"
              onClick={() => {
                if (tool !== 'bond') setTool('bond');
                else setShowBondMenu(!showBondMenu);
              }}
              style={toolBtnStyle(tool === 'bond')}
            >
              {getBondIcon()}
            </div>
            <div
              ref={ringBtnRef}
              title={getRingPresetLabel(ringPreset, ringSize)}
              onClick={() => {
                setTool('ring');
                setShowBondMenu(false);
              }}
              style={toolBtnStyle(tool === 'ring')}
            >
              <div
                style={{ position: 'relative', width: 22 * buttonScale, height: 22 * buttonScale }}
              >
                <StructureFragmentIcon
                  id={
                    ringPreset === 'chair'
                      ? 'chair'
                      : ringPreset === 'chair-flipped'
                        ? 'chair-flipped'
                        : ringSize === 3
                          ? 'cyclopropane'
                          : ringSize === 4
                            ? 'cyclobutane'
                            : ringSize === 5
                              ? 'cyclopentane'
                              : 'cyclohexane'
                  }
                  size={22 * buttonScale}
                />
                {ringPreset === 'polygon' && (
                  <div
                    style={{
                      position: 'absolute',
                      right: -2,
                      bottom: -2,
                      minWidth: 12 * buttonScale,
                      height: 12 * buttonScale,
                      borderRadius: 999,
                      background: tool === 'ring' ? '#1565C0' : isDarkMode ? '#303030' : '#ffffff',
                      border: `1px solid ${tool === 'ring' ? '#1565C0' : isDarkMode ? '#666' : '#bbb'}`,
                      color: tool === 'ring' ? '#fff' : isDarkMode ? '#fff' : '#444',
                      fontSize: `${8 * buttonScale}px`,
                      lineHeight: `${12 * buttonScale}px`,
                      fontWeight: 700,
                      textAlign: 'center',
                      padding: `0 ${2 * buttonScale}px`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {ringSize}
                  </div>
                )}
              </div>
            </div>
            {FRAGMENTS.map((f) => (
              <div
                key={f.id}
                title={f.id.charAt(0).toUpperCase() + f.id.slice(1)}
                onClick={() => {
                  setTool('fragment');
                  setSelectedFragment(f.smiles);
                  setShowBondMenu(false);
                }}
                style={toolBtnStyle(tool === 'fragment' && selectedFragment === f.smiles)}
              >
                <StructureFragmentIcon
                  id={
                    f.id as
                      | 'benzene'
                      | 'cyclohexane'
                      | 'cyclopentane'
                      | 'cyclobutane'
                      | 'cyclopropane'
                  }
                  size={22 * buttonScale}
                />
              </div>
            ))}
          </>
        );
      case 'arrow':
        return (
          <>
            {REACTION_ARROW_OPTIONS.map(({ type, title }) => (
              <div
                key={type}
                title={title}
                onClick={() => {
                  setTool('arrow');
                  setArrowType(type);
                  setShowBondMenu(false);
                }}
                style={toolBtnStyle(tool === 'arrow' && arrowType === type)}
              >
                <ReactionArrowIcon type={type} size={22 * buttonScale} />
              </div>
            ))}
          </>
        );
      case 'text': {
        return (
          <>
            <div
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: textPalettePrimaryGridColumns,
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setTool('text');
                  setShowBondMenu(false);
                }}
                style={paletteWideButtonStyle(tool === 'text')}
                title="Place notes, captions, labels, or formula text on the canvas"
              >
                Annotate
              </button>
              <button
                type="button"
                onClick={() =>
                  focusStructureInput(
                    selectedChemicalFormula || (hasStructureInput ? editableSmiles : undefined),
                  )
                }
                style={paletteWideButtonStyle(false)}
                title="Open the structure input bar. It accepts SMILES, formulas, and shorthand aliases."
              >
                Input
              </button>
            </div>
            <div style={paletteSectionLabelStyle}>Selected Text</div>
            <div
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: textPaletteSemanticGridColumns,
                gap: 4,
              }}
            >
              {(
                [
                  ['plain', 'Text'],
                  ['auto', 'Auto'],
                  ['chemical', 'Chem'],
                ] as const
              ).map(([mode, label]) => {
                const active = selectedTextSemanticMode === mode;
                const mixed = selectedTextBoxIds.size > 1 && selectedTextSemanticMode == null;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={selectedTextBoxIds.size === 0}
                    onClick={() => applySelectedTextSemanticMode(mode)}
                    style={{
                      ...paletteWideButtonStyle(active, selectedTextBoxIds.size === 0),
                      minHeight: 0,
                      padding: '5px 6px',
                      fontSize: `${isCompactTextPalette ? 9 : 10}px`,
                      ...(mixed && mode === 'auto'
                        ? {
                            boxShadow: `inset 0 0 0 1px ${isDarkMode ? '#7aa2d6' : '#7a9acc'}`,
                          }
                        : {}),
                    }}
                    title={
                      mode === 'plain'
                        ? 'Keep the selected text as plain annotation'
                        : mode === 'chemical'
                          ? 'Force chemistry interpretation for the selected text'
                          : 'Only interpret the selected text as chemistry when it clearly looks molecular'
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={textPaletteInfoCardStyle} title={textPaletteStatusTooltip}>
              <div
                style={{
                  fontSize: `${isCompactTextPalette ? 9.5 : 9.9 * buttonScale}px`,
                  fontWeight: 700,
                  color: theme.text,
                  lineHeight: 1.2,
                }}
              >
                {textChemistryStatus.title}
              </div>
              <div
                style={{
                  fontSize: `${isCompactTextPalette ? 8.75 : 9.1 * buttonScale}px`,
                  color: isDarkMode ? '#c2c2c2' : '#5b5b5b',
                  lineHeight: 1.35,
                }}
              >
                {truncateToolbarText(textPaletteStatusSummary, 34)}
              </div>
            </div>
            <div style={paletteSectionLabelStyle}>Structure</div>
            <div
              style={textPaletteBodyCopyStyle}
              title={
                selectedChemicalFormula
                  ? `Selected formula ready: ${selectedChemicalFormula}`
                  : hasStructureInput
                    ? `Prepared input ready: ${structureInputValue}`
                    : 'Open the structure input bar to prepare a structure to add or replace.'
              }
            >
              {textPaletteStructureSummary}
            </div>
            <div
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: textPalettePrimaryGridColumns,
                gap: 4,
              }}
            >
              <button
                type="button"
                disabled={!hasTextPaletteStructureValue}
                onClick={() =>
                  handleLoadStructureInput(selectedChemicalFormula || structureInputValue)
                }
                style={paletteWideButtonStyle(false, !hasTextPaletteStructureValue)}
                title="Replace the current drawing with the selected formula or prepared input"
              >
                Replace
              </button>
              <button
                type="button"
                disabled={!hasTextPaletteStructureValue}
                onClick={() =>
                  handleAddStructureInput(selectedChemicalFormula || structureInputValue)
                }
                style={paletteWideButtonStyle(false, !hasTextPaletteStructureValue)}
                title="Add the selected formula or prepared input alongside the current drawing"
              >
                Add
              </button>
            </div>
          </>
        );
      }
      case 'atom':
        return (
          <>
            <div style={paletteSectionLabelStyle}>Elements</div>
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              {ELEMENT_SHORTCUTS.map(renderAtomShortcut)}
            </div>
            <div style={paletteSectionLabelStyle}>Shorthand</div>
            {renderShorthandLibrary()}
            <button
              type="button"
              onClick={() => {
                setIsShorthandLibraryOpen(false);
                setShorthandQuery('');
                setIsPeriodicTableOpen(true);
              }}
              style={{
                ...paletteWideButtonStyle(false),
                paddingInline: 10,
              }}
              title="Periodic Table"
            >
              <span>Periodic Table</span>
            </button>
          </>
        );
      case 'charge':
        return (
          <>
            <div style={paletteSectionLabelStyle}>Formal Charge</div>
            <div
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (tool === 'charge' && electronToolMode === 'charge-positive') {
                    setTool('select');
                    setCurrentCharge(0);
                  } else {
                    setTool('charge');
                    setCurrentCharge(1);
                    setElectronToolMode('charge-positive');
                    setShowBondMenu(false);
                  }
                }}
                style={{
                  ...paletteWideButtonStyle(
                    tool === 'charge' && electronToolMode === 'charge-positive',
                  ),
                  minHeight: `${buttonSize * 0.78}px`,
                  color:
                    tool === 'charge' && electronToolMode === 'charge-positive'
                      ? '#fff'
                      : '#d63b3b',
                  fontSize: `${12 * buttonScale}px`,
                }}
                title="Click atoms to toggle a +1 formal charge"
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tool === 'charge' && electronToolMode === 'charge-negative') {
                    setTool('select');
                    setCurrentCharge(0);
                  } else {
                    setTool('charge');
                    setCurrentCharge(-1);
                    setElectronToolMode('charge-negative');
                    setShowBondMenu(false);
                  }
                }}
                style={{
                  ...paletteWideButtonStyle(
                    tool === 'charge' && electronToolMode === 'charge-negative',
                  ),
                  minHeight: `${buttonSize * 0.78}px`,
                  color:
                    tool === 'charge' && electronToolMode === 'charge-negative'
                      ? '#fff'
                      : '#1565c0',
                  fontSize: `${12 * buttonScale}px`,
                }}
                title="Click atoms to toggle a -1 formal charge"
              >
                -1
              </button>
            </div>
            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <div style={{ ...paletteSectionLabelStyle, marginTop: 0 }}>Electrons</div>
              <button
                type="button"
                title="Click atoms to apply the selected charge or electron marker. Select an atom afterward to drag lone pairs and radicals around the orbit ring."
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: `1px solid ${isDarkMode ? '#555' : '#c7c7c7'}`,
                  background: isDarkMode ? '#2f2f2f' : '#f6f6f6',
                  color: isDarkMode ? '#c6c6c6' : '#666',
                  fontSize: `${9 * buttonScale}px`,
                  lineHeight: '14px',
                  padding: 0,
                  cursor: 'help',
                  flexShrink: 0,
                }}
              >
                ?
              </button>
            </div>
            <div
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (tool === 'charge' && electronToolMode === 'radical') {
                    setTool('select');
                  } else {
                    setTool('charge');
                    setElectronToolMode('radical');
                    setShowBondMenu(false);
                  }
                }}
                style={paletteWideButtonStyle(tool === 'charge' && electronToolMode === 'radical')}
                title="Click atoms to toggle one unpaired electron"
              >
                Radical
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tool === 'charge' && electronToolMode === 'lone-pair-add') {
                    setTool('select');
                  } else {
                    setTool('charge');
                    setElectronToolMode('lone-pair-add');
                    setShowBondMenu(false);
                  }
                }}
                style={paletteWideButtonStyle(
                  tool === 'charge' && electronToolMode === 'lone-pair-add',
                )}
                title="Click atoms to add one lone pair when chemically allowed"
              >
                Add
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (tool === 'charge' && electronToolMode === 'lone-pair-remove') {
                  setTool('select');
                } else {
                  setTool('charge');
                  setElectronToolMode('lone-pair-remove');
                  setShowBondMenu(false);
                }
              }}
              style={paletteWideButtonStyle(
                tool === 'charge' && electronToolMode === 'lone-pair-remove',
              )}
              title="Click atoms to remove one lone pair"
            >
              Remove
            </button>
          </>
        );
    }
  };

  const renderDockedPalette = (paletteId: ToolPaletteId) => {
    const paletteState = toolPalettes.items[paletteId];
    const isDragging = paletteDrag?.id === paletteId;
    const paletteMeta = PALETTE_META[paletteId];

    return (
      <div
        ref={(element) => setPaletteRef(paletteId, element)}
        data-tool-palette-root="true"
        style={{
          opacity: isDragging ? 0.35 : 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          onMouseDown={(event) => beginPaletteDrag(paletteId, event)}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '80%',
            marginBottom: '4px',
            cursor: paletteDrag ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          title="Drag out or reorder"
        >
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => togglePaletteCollapsed(paletteId)}
            style={{
              ...paletteHeaderButtonStyle,
              width: 14,
              marginRight: 4,
              fontSize: `${10.75 * buttonScale}px`,
              fontWeight: 'bold',
              color: theme.text,
              flexShrink: 0,
              textAlign: 'left',
            }}
          >
            {paletteState.collapsed ? '▸' : '▾'}
          </button>
          <span
            style={{
              fontSize: `${13 * buttonScale}px`,
              fontWeight: 'bold',
              color: theme.text,
              flex: 1,
              textAlign: 'left',
            }}
            title={paletteMeta.description}
          >
            {paletteMeta.label}
          </span>
        </div>
        {!paletteState.collapsed && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              width: '80%',
            }}
          >
            {renderPaletteBody(paletteId)}
          </div>
        )}
        <div style={{ width: '80%', height: '1px', background: theme.border, margin: '8px 0' }} />
      </div>
    );
  };

  const renderFloatingPalette = (paletteId: ToolPaletteId, mode: 'floating' | 'drag') => {
    const paletteState = toolPalettes.items[paletteId];
    const paletteMeta = PALETTE_META[paletteId];

    return (
      <div
        ref={mode === 'drag' ? undefined : (element) => setPaletteRef(paletteId, element)}
        data-tool-palette-root="true"
        style={{
          width: Math.max(108, sidebarWidth + 16),
          border: `1px solid ${theme.border}`,
          borderRadius: 6,
          background: isDarkMode ? '#2b2b2b' : '#fafafa',
          overflow: 'hidden',
          boxShadow: isDarkMode ? '0 1px 3px rgba(0,0,0,0.28)' : '0 1px 3px rgba(0,0,0,0.08)',
          pointerEvents: mode === 'drag' ? 'none' : 'auto',
        }}
      >
        <div
          onMouseDown={(event) => beginPaletteDrag(paletteId, event)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 6px',
            background: theme.header,
            borderBottom: paletteState.collapsed ? 'none' : `1px solid ${theme.border}`,
            userSelect: 'none',
            cursor: paletteDrag ? 'grabbing' : 'grab',
          }}
        >
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => togglePaletteCollapsed(paletteId)}
            style={{
              ...paletteHeaderButtonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: `${12.5 * buttonScale}px`,
              fontWeight: 'bold',
              flex: 1,
              justifyContent: 'flex-start',
              letterSpacing: '0.03em',
            }}
            title={paletteMeta.description}
          >
            <span>{paletteState.collapsed ? '▸' : '▾'}</span>
            {paletteMeta.label}
          </button>
          <button
            type="button"
            onClick={() => dockPalette(paletteId, dockedPaletteIds.length)}
            onMouseDown={(event) => event.stopPropagation()}
            style={{ ...paletteHeaderButtonStyle, fontSize: 12, opacity: 0.8 }}
            title="Dock palette"
          >
            ⇤
          </button>
        </div>
        {!paletteState.collapsed && (
          <div
            style={{
              padding: '6px 4px 7px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              width: '100%',
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {renderPaletteBody(paletteId)}
          </div>
        )}
      </div>
    );
  };

  const renderPaletteCard = (paletteId: ToolPaletteId, mode: 'docked' | 'floating' | 'drag') => {
    if (mode === 'docked') {
      return renderDockedPalette(paletteId);
    }
    return (
      <div style={{ opacity: paletteDrag?.id === paletteId && mode === 'drag' ? 0.96 : 1 }}>
        {renderFloatingPalette(paletteId, mode)}
      </div>
    );
  };

  return (
    <div
      ref={appShellRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        background: theme.bg,
        overflow: 'hidden',
        fontSize: `${uiFontSize}px`,
        zoom: uiScale,
        position: 'relative',
      }}
    >
      <style>
        {pageSetup.mode === 'finite'
          ? `@media print { @page { size: ${pageSetup.pageWidth}${pageSetup.unit} ${pageSetup.pageHeight}${pageSetup.unit}; margin: 0; } }`
          : ''}
      </style>
      {/* Header */}
      <div
        className="no-print"
        data-tauri-drag-region
        style={{
          background: theme.header,
          borderBottom: `1px solid ${theme.border}`,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          height: '36px',
          fontSize: '13px',
          position: 'relative',
          zIndex: 1000,
          flexShrink: 0,
          color: theme.text,
        }}
      >
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          {/* File menu */}
          <div ref={fileMenuRef} style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setIsFileDropdownOpen(!isFileDropdownOpen);
                setIsEditDropdownOpen(false);
                setIsSettingsDropdownOpen(false);
                setIsExportSubmenuOpen(false);
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              File ▾
            </span>
            {isFileDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: theme.header,
                  border: `1px solid ${theme.border}`,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  minWidth: '180px',
                  padding: '4px 0',
                  marginTop: '5px',
                }}
              >
                <div
                  onClick={handleOpen}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Open... <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+O</span>
                </div>
                <div
                  onClick={handleSaveNative}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Save (.cdxml) <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+S</span>
                </div>
                <div
                  onClick={handleInsertImage}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Insert Image...
                </div>
                <div
                  onMouseEnter={() => setIsExportSubmenuOpen(true)}
                  onMouseLeave={() => setIsExportSubmenuOpen(false)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    position: 'relative',
                  }}
                >
                  Export As <span>▸</span>
                  {isExportSubmenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: '100%',
                        background: theme.header,
                        border: `1px solid ${theme.border}`,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                        minWidth: '120px',
                        padding: '4px 0',
                      }}
                    >
                      <div
                        onClick={() => handleExport('png')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        PNG Image
                      </div>
                      <div
                        onClick={() => handleExport('svg')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        SVG Vector
                      </div>
                      <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                      <div
                        onClick={() => handleExport('mol')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        Molfile (.mol)
                      </div>
                      <div
                        onClick={() => handleExport('sdf')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        SD File (.sdf)
                      </div>
                      <div
                        onClick={() => handleExport('rxn')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        RXN File (.rxn)
                      </div>
                      <div
                        onClick={() => handleExport('smi')}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                      >
                        SMILES (.smi)
                      </div>
                    </div>
                  )}
                </div>
                <div
                  onClick={() => {
                    setIsFileDropdownOpen(false);
                    handlePrint();
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Print / PDF <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+P</span>
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    clearCanvas();
                    setIsFileDropdownOpen(false);
                  }}
                  style={{ padding: '8px 12px', cursor: 'pointer', color: '#d9534f' }}
                >
                  Clear Canvas
                </div>
              </div>
            )}
          </div>

          {/* Edit menu */}
          <div ref={editMenuRef} style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setIsEditDropdownOpen(!isEditDropdownOpen);
                setIsFileDropdownOpen(false);
                setIsSettingsDropdownOpen(false);
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              Edit ▾
            </span>
            {isEditDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: theme.header,
                  border: `1px solid ${theme.border}`,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  minWidth: '200px',
                  padding: '4px 0',
                  marginTop: '5px',
                  zIndex: 1001,
                }}
              >
                <div
                  onClick={() => {
                    undo();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Undo <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Z</span>
                </div>
                <div
                  onClick={() => {
                    redo();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Redo <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Y</span>
                </div>
                <div
                  onClick={() => {
                    selectAll();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Select All <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+A</span>
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    handleCopy();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Copy <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+C</span>
                </div>
                <div
                  onClick={() => {
                    handleCut();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Cut <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+X</span>
                </div>
                <div
                  onClick={() => {
                    handlePaste();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Paste <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+V</span>
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    groupSelected();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Group <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+G</span>
                </div>
                <div
                  onClick={() => {
                    ungroupSelected();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Ungroup <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+G</span>
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onMouseEnter={() => setIsAlignSubmenuOpen(true)}
                  onMouseLeave={() => setIsAlignSubmenuOpen(false)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    position: 'relative',
                  }}
                >
                  Align ▸
                  {isAlignSubmenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: '100%',
                        background: theme.header,
                        border: `1px solid ${theme.border}`,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                        minWidth: '200px',
                        padding: '4px 0',
                      }}
                    >
                      <div
                        style={{
                          padding: '4px 12px 2px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          color: '#888',
                        }}
                      >
                        ALIGN
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('alignLeft');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Align Left{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+L</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('alignRight');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Align Right{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+R</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('alignTop');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Align Top{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+T</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('alignBottom');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Align Bottom{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+B</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('centerH');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Center Horizontally{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+H</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('centerV');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Center Vertically{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+V</span>
                      </div>
                      <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                      <div
                        style={{
                          padding: '4px 12px 2px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          color: '#888',
                        }}
                      >
                        DISTRIBUTE
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('distributeH');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Distribute Horizontally{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+D</span>
                      </div>
                      <div
                        onClick={() => {
                          alignSelection('distributeV');
                          setIsEditDropdownOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        Distribute Vertically{' '}
                        <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+Shift+E</span>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    canvasRef.current?.cleanUp();
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: '#007acc',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Clean Up <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+K</span>
                </div>
                <div
                  onClick={() => {
                    setRotateInput('');
                    setShowRotateDialog(true);
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Rotate... <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+R</span>
                </div>
                <div
                  onClick={() => {
                    setScaleInput('');
                    setShowScaleDialog(true);
                    setIsEditDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  Scale...
                </div>
              </div>
            )}
          </div>

          {/* Settings menu */}
          <div ref={settingsMenuRef} style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setIsSettingsDropdownOpen(!isSettingsDropdownOpen);
                setIsFileDropdownOpen(false);
                setIsEditDropdownOpen(false);
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              Settings ▾
            </span>
            {isSettingsDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: theme.header,
                  border: `1px solid ${theme.border}`,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  minWidth: '160px',
                  padding: '4px 0',
                  marginTop: '5px',
                  zIndex: 1002,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '4px 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isDarkMode}
                    onChange={() => setIsDarkMode(!isDarkMode)}
                    style={{ marginRight: '8px' }}
                  />
                  Dark Mode
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '4px 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showHydrogens}
                    onChange={() => useStore.getState().setShowHydrogens(!showHydrogens)}
                    style={{ marginRight: '8px' }}
                  />
                  Auto-H (Implied Hydrogens)
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '4px 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showSmilesBar}
                    onChange={() => setShowSmilesBar(!showSmilesBar)}
                    style={{ marginRight: '8px' }}
                  />
                  Structure Input Bar
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '4px 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={() => useStore.getState().setShowGrid(!showGrid)}
                    style={{ marginRight: '8px' }}
                  />
                  Grid
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: '4px 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={documentViewSettings.atomColorViewMode === 'enhanced-defaults'}
                    onChange={(event) =>
                      setDocumentViewSettings({
                        ...documentViewSettings,
                        atomColorViewMode: event.target.checked
                          ? 'enhanced-defaults'
                          : 'chemdraw-fidelity',
                      })
                    }
                    style={{ marginRight: '8px' }}
                  />
                  Enhanced Atom Colors
                </label>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    setIsPreferencesPanelOpen(true);
                    setIsSettingsDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                  }}
                >
                  Preferences...
                </div>
                <div
                  onClick={() => {
                    canvasRef.current?.fitToScreen();
                    setIsSettingsDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                  }}
                >
                  Fit to Screen <span style={{ color: '#888', fontSize: '11px' }}>Ctrl+0</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setIsAboutOpen(true);
                closeAllMenus();
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              About
            </span>
          </div>
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '15px',
          }}
        >
          {/* Calculate menu */}
          <div ref={calculateMenuRef} style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setIsCalculateDropdownOpen(!isCalculateDropdownOpen);
                setIsFileDropdownOpen(false);
                setIsEditDropdownOpen(false);
                setIsSettingsDropdownOpen(false);
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              Calculate ▾
            </span>
            {isCalculateDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  background: theme.header,
                  border: `1px solid ${theme.border}`,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  minWidth: '160px',
                  padding: '4px 0',
                  marginTop: '5px',
                  zIndex: 1002,
                }}
              >
                <div
                  onClick={() => {
                    setShowViewer(!showViewer);
                    setIsCalculateDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  3D Geometry
                  {showViewer && <span style={{ fontSize: 10, color: '#007acc' }}>●</span>}
                </div>
                <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
                <div
                  onClick={() => {
                    setShowPropertiesPanel(!showPropertiesPanel);
                    setIsCalculateDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  Properties
                  {showPropertiesPanel && <span style={{ fontSize: 10, color: '#007acc' }}>●</span>}
                </div>
                <div
                  onClick={() => {
                    setShowIrPanel(!showIrPanel);
                    setIsCalculateDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  IR Spectrum
                  {showIrPanel && <span style={{ fontSize: 10, color: '#007acc' }}>●</span>}
                </div>
                <div
                  onClick={() => {
                    setShowNmrPanel(!showNmrPanel);
                    setIsCalculateDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  NMR Prediction
                  {showNmrPanel && <span style={{ fontSize: 10, color: '#007acc' }}>●</span>}
                </div>
                <div
                  onClick={() => {
                    setShowMsPanel(!showMsPanel);
                    setIsCalculateDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  Mass Spectrum
                  {showMsPanel && <span style={{ fontSize: 10, color: '#007acc' }}>●</span>}
                </div>
              </div>
            )}
          </div>
          {!isMacOS && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginLeft: '10px',
                borderLeft: `1px solid ${theme.border}`,
                paddingLeft: '12px',
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  withAppWindow((appWindow) => {
                    void appWindow.minimize();
                  });
                }}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#ffbd2e',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  withAppWindow((appWindow) => {
                    void appWindow.toggleMaximize();
                  });
                }}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#27c93f',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  withAppWindow((appWindow) => {
                    void appWindow.close();
                  });
                }}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#ff5f56',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            background: theme.sidebar,
            borderRight: `1px solid ${theme.border}`,
            width: `${sidebarWidth}px`,
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            onMouseDown={startResizing}
            style={{
              position: 'absolute',
              top: 0,
              right: '-2px',
              width: '6px',
              height: '100%',
              cursor: 'col-resize',
              zIndex: 10,
            }}
          />
          <div
            ref={sidebarDockRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '10px 6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '8px',
              position: 'relative',
            }}
          >
            {dockedPaletteIds.map((paletteId) => (
              <div key={paletteId}>{renderPaletteCard(paletteId, 'docked')}</div>
            ))}
            {dockGuideTop !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  top: dockGuideTop,
                  height: 2,
                  background: '#007acc',
                  borderRadius: 999,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>

        {/* Text / chemistry panel — shown when text tool active or text box selected */}
        {!editMenusHidden &&
          (tool === 'text' || selectedTextBoxIds.size > 0) &&
          textEditPanelLayout && (
            <FloatingPanel
              pos={textEditPanelLayout.pos}
              size={textEditPanelLayout.size}
              minWidth={196}
              minHeight={260}
              title="Text / Chemistry"
              theme={theme}
              isDarkMode={isDarkMode}
              zIndex={250}
              onClose={() => setEditMenusHidden(true)}
              onPosChange={(pos) =>
                setTextEditPanelLayout((prev) => (prev ? { ...prev, pos } : prev))
              }
              onSizeChange={(size) =>
                setTextEditPanelLayout((prev) => (prev ? { ...prev, size } : prev))
              }
              headerExtra={
                <button
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    const nextAlign = textEditPanelLayout.align === 'right' ? 'left' : 'right';
                    const containerWidth =
                      appShellRef.current?.clientWidth ?? Math.max(320, canvasSize.width);
                    setTextEditPanelLayout((prev) =>
                      prev
                        ? {
                            ...prev,
                            align: nextAlign,
                            pos: {
                              x: getCornerPanelX(containerWidth, prev.size.width, nextAlign),
                              y: 12,
                            },
                          }
                        : createDefaultEditPanelLayout(
                            containerWidth,
                            { width: 212, height: 360 },
                            nextAlign,
                          ),
                    );
                  }}
                  style={{
                    marginLeft: 'auto',
                    border: 'none',
                    background: 'transparent',
                    color: theme.text,
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: '0 2px',
                    opacity: 0.8,
                  }}
                  title={
                    textEditPanelLayout.align === 'right'
                      ? 'Attach to top left'
                      : 'Attach to top right'
                  }
                >
                  {textEditPanelLayout.align === 'right' ? '⇤' : '⇥'}
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
                {/* Font family */}
                <SelectMenu
                  value={textFormat.fontFamily}
                  options={[
                    'Arial',
                    'Times New Roman',
                    'Courier New',
                    'Georgia',
                    'Verdana',
                    'Helvetica',
                  ].map((f) => ({ value: f, label: f }))}
                  onChange={(ff) => {
                    setTextFormat({ fontFamily: ff });
                    if (selectedTextBoxIds.size > 0) {
                      const {
                        atoms: a,
                        bonds: b,
                        arrows: arr,
                        groups: g,
                        textBoxes: tb,
                      } = useStore.getState();
                      useStore.getState().pushToHistory({
                        atoms: a,
                        bonds: b,
                        arrows: arr,
                        groups: g ?? [],
                        textBoxes: (tb ?? []).map((t) =>
                          selectedTextBoxIds.has(t.id) ? { ...t, fontFamily: ff } : t,
                        ),
                      });
                    }
                  }}
                  isDarkMode={isDarkMode}
                  textColor={theme.text}
                  borderColor={theme.border}
                  backgroundColor={isDarkMode ? '#333' : '#fff'}
                  fontSize={11}
                  padding="2px 4px"
                />
                {/* Font size */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: theme.text }}>Size</span>
                  <DeferredNumberInput
                    value={textFormat.fontSize}
                    min={8}
                    max={72}
                    step={1}
                    integer
                    onCommit={(fs) => {
                      setTextFormat({ fontSize: fs });
                      if (selectedTextBoxIds.size > 0) {
                        const {
                          atoms: a,
                          bonds: b,
                          arrows: arr,
                          groups: g,
                          textBoxes: tb,
                        } = useStore.getState();
                        useStore.getState().pushToHistory({
                          atoms: a,
                          bonds: b,
                          arrows: arr,
                          groups: g ?? [],
                          textBoxes: (tb ?? []).map((t) =>
                            selectedTextBoxIds.has(t.id) ? { ...t, fontSize: fs } : t,
                          ),
                        });
                      }
                    }}
                    style={{
                      width: 50,
                      fontSize: 11,
                      padding: '2px 4px',
                      background: isDarkMode ? '#333' : '#fff',
                      color: theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      textAlign: 'center',
                    }}
                  />
                </div>
                {/* Bold / Italic */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      canvasRef.current?.applyTextFormat('bold');
                      setTextFormat({ bold: !textFormat.bold });
                    }}
                    style={{
                      flex: 1,
                      fontWeight: 'bold',
                      padding: '2px 0',
                      background: textFormat.bold ? '#007acc' : isDarkMode ? '#333' : '#f0f0f0',
                      color: textFormat.bold ? '#fff' : theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    B
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      canvasRef.current?.applyTextFormat('italic');
                      setTextFormat({ italic: !textFormat.italic });
                    }}
                    style={{
                      flex: 1,
                      fontStyle: 'italic',
                      padding: '2px 0',
                      background: textFormat.italic ? '#007acc' : isDarkMode ? '#333' : '#f0f0f0',
                      color: textFormat.italic ? '#fff' : theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    I
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => canvasRef.current?.applyTextFormat('subscript')}
                    style={{
                      flex: 1,
                      padding: '2px 0',
                      background: isDarkMode ? '#333' : '#f0f0f0',
                      color: theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                    title="Subscript"
                  >
                    x₂
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => canvasRef.current?.applyTextFormat('superscript')}
                    style={{
                      flex: 1,
                      padding: '2px 0',
                      background: isDarkMode ? '#333' : '#f0f0f0',
                      color: theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                    title="Superscript"
                  >
                    x²
                  </button>
                </div>
                {/* Alignment */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button
                      key={a}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextFormat({ textAlign: a })}
                      style={{
                        flex: 1,
                        padding: '2px 0',
                        background:
                          textFormat.textAlign === a ? '#007acc' : isDarkMode ? '#333' : '#f0f0f0',
                        color: textFormat.textAlign === a ? '#fff' : theme.text,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 3,
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                      title={`Align ${a}`}
                    >
                      {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                    </button>
                  ))}
                </div>
                {/* Color */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: theme.text }}>Color</span>
                  <input
                    type="color"
                    value={textFormat.color}
                    onChange={(ev) => {
                      const c = ev.target.value;
                      setTextFormat({ color: c });
                      canvasRef.current?.applyTextFormat('foreColor', c);
                      if (selectedTextBoxIds.size > 0) {
                        const {
                          atoms: a,
                          bonds: b,
                          arrows: arr,
                          groups: g,
                          textBoxes: tb,
                        } = useStore.getState();
                        useStore.getState().pushToHistory({
                          atoms: a,
                          bonds: b,
                          arrows: arr,
                          groups: g ?? [],
                          textBoxes: (tb ?? []).map((t) =>
                            selectedTextBoxIds.has(t.id) ? { ...t, color: c } : t,
                          ),
                        });
                      }
                    }}
                    style={{
                      width: 28,
                      height: 22,
                      padding: 0,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <div style={{ height: 1, background: theme.border, margin: '2px 0' }} />
                <div style={{ fontSize: 10, fontWeight: 'bold', color: '#888' }}>CHEMISTRY</div>
                <div
                  style={{
                    border: `1px solid ${textChemistryBorderColor}`,
                    background: textChemistryBackgroundColor,
                    borderRadius: 6,
                    padding: '7px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text }}>
                    {textChemistryStatus.title}
                  </div>
                  <div style={{ fontSize: 11, color: theme.text }}>
                    {textChemistryStatus.detail}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: isDarkMode ? '#b0b0b0' : '#666',
                      lineHeight: 1.35,
                    }}
                  >
                    {textChemistryStatus.note}
                  </div>
                </div>
                <div
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: textPaletteSemanticGridColumns,
                    gap: 4,
                  }}
                >
                  {(
                    [
                      ['plain', 'Plain'],
                      ['auto', 'Auto'],
                      ['chemical', 'Chemical'],
                    ] as const
                  ).map(([mode, label]) => {
                    const active = selectedTextSemanticMode === mode;
                    const mixed = selectedTextBoxIds.size > 1 && selectedTextSemanticMode == null;
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={selectedTextBoxIds.size === 0}
                        onClick={() => applySelectedTextSemanticMode(mode)}
                        style={{
                          ...paletteWideButtonStyle(active, selectedTextBoxIds.size === 0),
                          minHeight: 0,
                          padding: '5px 6px',
                          fontSize: `${isCompactTextPalette ? 9 : 10}px`,
                          ...(mixed && mode === 'auto'
                            ? {
                                boxShadow: `inset 0 0 0 1px ${isDarkMode ? '#7aa2d6' : '#7a9acc'}`,
                              }
                            : {}),
                        }}
                        title={
                          mode === 'plain'
                            ? 'Keep this text as non-chemical annotation'
                            : mode === 'chemical'
                              ? 'Force chemistry interpretation for this text box'
                              : 'Use chemistry heuristics only when the text clearly looks molecular'
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: textPalettePrimaryGridColumns,
                    gap: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      focusStructureInput(
                        selectedChemicalFormula || (hasStructureInput ? editableSmiles : undefined),
                      )
                    }
                    style={{
                      ...paletteWideButtonStyle(false),
                      minHeight: 0,
                      padding: '5px 6px',
                      fontSize: `${isCompactTextPalette ? 9 : 10}px`,
                    }}
                  >
                    Input
                  </button>
                  <button
                    type="button"
                    disabled={!selectedChemicalFormula && !hasStructureInput}
                    onClick={() =>
                      handleLoadStructureInput(selectedChemicalFormula || structureInputValue)
                    }
                    style={{
                      ...paletteWideButtonStyle(
                        false,
                        !selectedChemicalFormula && !hasStructureInput,
                      ),
                      minHeight: 0,
                      padding: '5px 6px',
                      fontSize: `${isCompactTextPalette ? 9 : 10}px`,
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    disabled={!selectedChemicalFormula && !hasStructureInput}
                    onClick={() =>
                      handleAddStructureInput(selectedChemicalFormula || structureInputValue)
                    }
                    style={{
                      ...paletteWideButtonStyle(
                        false,
                        !selectedChemicalFormula && !hasStructureInput,
                      ),
                      minHeight: 0,
                      padding: '5px 6px',
                      fontSize: `${isCompactTextPalette ? 9 : 10}px`,
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </FloatingPanel>
          )}

        {/* Main workspace */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            ref={workspaceRef}
            className={pageSetup.mode === 'finite' ? 'print-container no-print' : 'print-container'}
            style={{
              flex: 1,
              position: 'relative',
              background: theme.canvas,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            {editMenusHidden && hasResummonableEditMenu && (
              <button
                type="button"
                onClick={() => setEditMenusHidden(false)}
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  zIndex: 240,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 999,
                  background: isDarkMode ? 'rgba(45,45,45,0.94)' : 'rgba(255,255,255,0.96)',
                  color: theme.text,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                }}
                title="Show edit menus"
              >
                Show Edit
              </button>
            )}
            <div style={{ flex: 1, position: 'relative', height: '100%' }}>
              <ChemCanvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} />
              {showCompatibilityPanel && (
                <div
                  className="no-print"
                  style={{
                    position: 'absolute',
                    left: 12,
                    bottom: 12,
                    width: 320,
                    maxWidth: 'calc(100% - 24px)',
                    background: isDarkMode ? 'rgba(25,25,25,0.9)' : 'rgba(255,255,255,0.94)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    padding: '10px 12px',
                    zIndex: 260,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: theme.text,
                      }}
                    >
                      ChemDraw Compatibility
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: isDarkMode ? '#a9a9a9' : '#6f6f6f',
                      }}
                    >
                      {chemDrawDocument?.source === 'cdxml-import'
                        ? 'Imported CDXML'
                        : 'Native document'}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#333' : '#f1f1f1',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.warningCount} warnings
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#2f3844' : '#edf3fb',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.roundTripOnlyCount} round-trip only
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#44352d' : '#fff3e8',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.renderOnlyCount +
                        chemDrawCompatibility.preservedPageChildCount}{' '}
                      render only
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#2f4332' : '#edf7ef',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.graphicCount} graphics
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#3b3044' : '#f4eefb',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.objectTagCount} object tags
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#2d3d44' : '#ebf7fb',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.embeddedObjectCount} embedded
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: isDarkMode ? '#443f2d' : '#fbf7eb',
                        color: theme.text,
                      }}
                    >
                      {chemDrawCompatibility.tableCount} tables
                    </span>
                  </div>
                  {selectedLimitedNativeObjects.length > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: theme.text,
                        lineHeight: 1.4,
                      }}
                    >
                      {selectedLimitedNativeObjects.length === 1
                        ? `Selected ${selectedLimitedNativeObjects[0].type} is ${selectedLimitedNativeObjects[0].capability}.`
                        : `${selectedLimitedNativeObjects.length} selected native objects have limited editing support.`}
                      {selectedLimitedNativeObjects[0]?.reasons[0]
                        ? ` ${selectedLimitedNativeObjects[0].reasons[0]}`
                        : ''}
                    </div>
                  )}
                  {chemDrawWarnings.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      {chemDrawWarnings.slice(0, 3).map((warning, index) => (
                        <div
                          key={`${warning}-${index}`}
                          style={{
                            fontSize: 10,
                            color: isDarkMode ? '#c7c7c7' : '#555',
                            lineHeight: 1.35,
                          }}
                        >
                          {warning}
                        </div>
                      ))}
                      {chemDrawWarnings.length > 3 && (
                        <div
                          style={{
                            fontSize: 10,
                            color: isDarkMode ? '#9f9f9f' : '#777',
                          }}
                        >
                          {chemDrawWarnings.length - 3} more warning(s) kept with the document.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Split viewer */}
            {showViewer && viewerMode === 'split' && (
              <>
                <div
                  className="no-print"
                  onMouseDown={startSplitResizing}
                  style={{
                    width: '4px',
                    cursor: 'col-resize',
                    background: theme.border,
                    zIndex: 10,
                  }}
                />
                <div
                  className="no-print"
                  style={{
                    width: `${splitWidth}px`,
                    background: theme.sidebar,
                    borderLeft: `1px solid ${theme.border}`,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <ViewerPanel
                    previewMode={previewMode}
                    viewerSmiles={viewerSmiles}
                    viewerMolblock={viewerMolblock}
                    viewerSize={{ width: splitWidth, height: canvasSize.height }}
                    isDarkMode={isDarkMode}
                    viewerHoveredAtomIdx={activeViewerHoveredAtomIdx}
                    viewerSelectedAtomIdx={activeViewerSelectedAtomIdx}
                    viewerSelectedAtomIndices={activeViewerSelectedAtomIndices}
                    viewerHoveredBondAtoms={activeViewerHoveredBondAtoms}
                    viewerSelectedBondAtoms={activeViewerSelectedBondAtoms}
                    theme={theme}
                    viewerMode={viewerMode}
                    setViewerMode={setViewerMode}
                    setPreviewMode={setPreviewMode}
                    isSettingsOpen={isViewerSettingsOpen}
                    setIsSettingsOpen={setIsViewerSettingsOpen}
                    onStartDragging={startViewerDragging}
                    onScreenshot={handleViewerScreenshot}
                    molecule3DRef={molecule3DRef}
                  />
                </div>
              </>
            )}

            {/* Floating / pinned viewer */}
            {showViewer && viewerMode !== 'split' && (
              <div
                id="viewer-overlay"
                className="no-print"
                style={{
                  position: 'absolute',
                  top: `${viewerPos.y}px`,
                  right: viewerMode === 'pinned' ? `${viewerPos.x}px` : 'auto',
                  left: viewerMode === 'floating' ? `${viewerPos.x}px` : 'auto',
                  background: isDarkMode ? 'rgba(45,45,45,0.9)' : 'rgba(255,255,255,0.9)',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  padding: '5px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  zIndex: 500,
                  width: viewerSize.width,
                  height: viewerSize.height,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <ViewerPanel
                  previewMode={previewMode}
                  viewerSmiles={viewerSmiles}
                  viewerMolblock={viewerMolblock}
                  viewerSize={viewerSize}
                  isDarkMode={isDarkMode}
                  viewerHoveredAtomIdx={activeViewerHoveredAtomIdx}
                  viewerSelectedAtomIdx={activeViewerSelectedAtomIdx}
                  viewerSelectedAtomIndices={activeViewerSelectedAtomIndices}
                  viewerHoveredBondAtoms={activeViewerHoveredBondAtoms}
                  viewerSelectedBondAtoms={activeViewerSelectedBondAtoms}
                  theme={theme}
                  viewerMode={viewerMode}
                  setViewerMode={setViewerMode}
                  setPreviewMode={setPreviewMode}
                  isSettingsOpen={isViewerSettingsOpen}
                  setIsSettingsOpen={setIsViewerSettingsOpen}
                  onStartDragging={startViewerDragging}
                  onScreenshot={handleViewerScreenshot}
                  molecule3DRef={molecule3DRef}
                />
                <div
                  onMouseDown={startViewerResizing}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: viewerMode === 'pinned' ? 0 : 'auto',
                    right: viewerMode === 'floating' ? 0 : 'auto',
                    width: '15px',
                    height: '15px',
                    cursor: 'nwse-resize',
                    zIndex: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderLeft:
                        viewerMode === 'pinned'
                          ? `2px solid ${isDarkMode ? '#888' : '#aaa'}`
                          : 'none',
                      borderRight:
                        viewerMode === 'floating'
                          ? `2px solid ${isDarkMode ? '#888' : '#aaa'}`
                          : 'none',
                      borderBottom: `2px solid ${isDarkMode ? '#888' : '#aaa'}`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Properties panel */}
            {showPropertiesPanel && (
              <Suspense fallback={null}>
                <PropertiesPanel
                  theme={theme}
                  isDarkMode={isDarkMode}
                  viewerSmiles={viewerSmiles}
                />
              </Suspense>
            )}

            {/* IR panel */}
            {showIrPanel && (
              <Suspense fallback={null}>
                <IrPanel theme={theme} isDarkMode={isDarkMode} viewerSmiles={viewerSmiles} />
              </Suspense>
            )}

            {/* MS panel */}
            {showMsPanel && (
              <Suspense fallback={null}>
                <MsPanel theme={theme} isDarkMode={isDarkMode} viewerSmiles={viewerSmiles} />
              </Suspense>
            )}

            {/* NMR panel */}
            {showNmrPanel && (
              <Suspense fallback={null}>
                <NmrPanel theme={theme} isDarkMode={isDarkMode} viewerSmiles={viewerSmiles} />
              </Suspense>
            )}
          </div>

          {/* Structure input bar */}
          {showSmilesBar && (
            <div
              className="no-print"
              style={{
                background: theme.header,
                borderTop: `1px solid ${theme.border}`,
                padding: '8px 15px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 150,
                  gap: 1,
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: isDarkMode ? '#888' : '#666',
                  }}
                >
                  Structure Input
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    color: isDarkMode ? '#9a9a9a' : '#7a7a7a',
                  }}
                >
                  SMILES, formulas, and shorthand aliases
                </span>
              </div>
              <input
                ref={structureInputRef}
                value={editableSmiles}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onChange={(e) => setEditableSmiles(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (e.shiftKey) {
                    handleAddStructureInput();
                    return;
                  }
                  handleLoadStructureInput();
                }}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '3px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  background: isDarkMode ? '#2d2d2d' : '#fff',
                  color: theme.text,
                }}
                placeholder="Enter SMILES, a formula like Co_2(CO)_8, or shorthand such as PPh3"
              />
              <button
                type="button"
                disabled={!hasStructureInput}
                onClick={() => handleLoadStructureInput()}
                style={{
                  padding: '4px 10px',
                  background: hasStructureInput ? (isDarkMode ? '#333' : '#f0f0f0') : theme.header,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '3px',
                  cursor: hasStructureInput ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  color: theme.text,
                  opacity: hasStructureInput ? 1 : 0.55,
                }}
              >
                Replace
              </button>
              <button
                type="button"
                disabled={!hasStructureInput}
                onClick={() => handleAddStructureInput()}
                style={{
                  padding: '4px 10px',
                  background: hasStructureInput ? (isDarkMode ? '#333' : '#f0f0f0') : theme.header,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '3px',
                  cursor: hasStructureInput ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  color: theme.text,
                  opacity: hasStructureInput ? 1 : 0.55,
                }}
                title="Add alongside the current drawing"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </div>

      {renderShorthandLibraryPanel()}

      {floatingPaletteIds.map((paletteId) => {
        if (paletteDrag?.id === paletteId) return null;
        const paletteState = toolPalettes.items[paletteId];
        return (
          <div
            key={paletteId}
            className="no-print"
            style={{
              position: 'absolute',
              left: paletteState.position.x,
              top: paletteState.position.y,
              zIndex: 850,
            }}
          >
            {renderPaletteCard(paletteId, 'floating')}
          </div>
        );
      })}

      {paletteDrag && (
        <div
          className="no-print"
          style={{
            position: 'absolute',
            left: paletteDrag.pos.x,
            top: paletteDrag.pos.y,
            zIndex: 1200,
            opacity: 0.96,
          }}
        >
          {renderPaletteCard(paletteDrag.id, 'drag')}
        </div>
      )}

      {/* Bond menu popup */}
      {tool === 'ring' && ringBtnPos && (
        <div
          style={{
            position: 'fixed',
            top: ringBtnPos.top,
            left: ringBtnPos.right + 5,
            background: theme.header,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            padding: '4px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '2px 2px 10px rgba(0,0,0,0.2)',
            zIndex: 3000,
            color: theme.text,
            fontSize: '12px',
          }}
        >
          {RING_PRESET_OPTIONS.map((option) => (
            <button
              key={option.preset}
              type="button"
              title={option.title}
              onClick={() => setRingPreset(option.preset)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 4,
                border: `1px solid ${ringPreset === option.preset ? '#1565C0' : theme.border}`,
                background: ringPreset === option.preset ? '#1565C0' : theme.bg,
                color: ringPreset === option.preset ? '#ffffff' : theme.text,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              <StructureFragmentIcon id={option.iconId} size={18} />
            </button>
          ))}
          {ringPreset === 'polygon' && (
            <>
              <span>n=</span>
              <DeferredNumberInput
                value={ringSize}
                min={3}
                max={12}
                step={1}
                integer
                onCommit={setRingSize}
                style={{
                  width: 36,
                  fontSize: 12,
                  textAlign: 'center',
                  border: `1px solid ${theme.border}`,
                  borderRadius: 3,
                  background: theme.bg,
                  color: theme.text,
                  padding: '2px',
                }}
              />
            </>
          )}
          {ringPreset !== 'polygon' && (
            <>
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: theme.border,
                  opacity: 0.8,
                }}
              />
              <button
                type="button"
                title="Rotate chair 60° counterclockwise"
                onClick={() => rotateRingTemplate(-1)}
                style={{
                  height: 28,
                  minWidth: 36,
                  borderRadius: 4,
                  border: `1px solid ${theme.border}`,
                  background: theme.bg,
                  color: theme.text,
                  cursor: 'pointer',
                  padding: '0 8px',
                }}
              >
                -60
              </button>
              <div
                style={{
                  minWidth: 34,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {ringRotationSteps * 60}°
              </div>
              <button
                type="button"
                title="Rotate chair 60° clockwise"
                onClick={() => rotateRingTemplate(1)}
                style={{
                  height: 28,
                  minWidth: 36,
                  borderRadius: 4,
                  border: `1px solid ${theme.border}`,
                  background: theme.bg,
                  color: theme.text,
                  cursor: 'pointer',
                  padding: '0 8px',
                }}
              >
                +60
              </button>
            </>
          )}
        </div>
      )}

      {showBondMenu && bondMenuPos && (
        <div
          style={{
            position: 'fixed',
            top: bondMenuPos.top,
            left: bondMenuPos.right + 5,
            background: theme.header,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            padding: '4px',
            display: 'flex',
            gap: '4px',
            boxShadow: '2px 2px 10px rgba(0,0,0,0.2)',
            zIndex: 3000,
          }}
        >
          {[
            { label: '⎯', order: 1, stereo: 0 },
            { label: '═', order: 2, stereo: 0 },
            { label: '≡', order: 3, stereo: 0 },
            { label: '▲', order: 1, stereo: 1 },
            { label: '▤', order: 1, stereo: 6 },
          ].map(({ label, order, stereo: s }) => (
            <div
              key={label}
              onClick={() => {
                setBondOrder(order);
                setStereo(s);
                setShowBondMenu(false);
              }}
              style={{
                padding: '5px',
                cursor: 'pointer',
                border:
                  bondOrder === order && stereo === s
                    ? '1px solid #007acc'
                    : '1px solid transparent',
                color: theme.text,
              }}
              title={label}
            >
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Periodic table modal */}
      {isPeriodicTableOpen && (
        <FloatingPanel
          pos={periodicTablePos}
          size={periodicTableSize}
          minWidth={720}
          minHeight={420}
          title="Periodic Table"
          theme={theme}
          isDarkMode={isDarkMode}
          zIndex={2000}
          positionMode="fixed"
          onClose={() => setIsPeriodicTableOpen(false)}
          onPosChange={setPeriodicTablePos}
          onSizeChange={setPeriodicTableSize}
          headerExtra={
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setPeriodicTableMonochrome(!periodicTableMonochrome)}
              title="Toggle between ChemDraw-fidelity black atom labels and ChemEditor's enhanced atom-color view"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginLeft: 'auto',
                padding: '6px 10px',
                borderRadius: 999,
                border: `1px solid ${periodicTableMonochrome ? '#007acc' : theme.border}`,
                background: periodicTableMonochrome
                  ? hexToRgba('#007acc', isDarkMode ? 0.28 : 0.12)
                  : isDarkMode
                    ? '#2c2c2c'
                    : '#f6f6f6',
                color: theme.text,
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <span>B/W</span>
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 16,
                  borderRadius: 999,
                  background: periodicTableMonochrome ? '#007acc' : isDarkMode ? '#555' : '#cfcfcf',
                  padding: 2,
                  display: 'flex',
                  justifyContent: periodicTableMonochrome ? 'flex-end' : 'flex-start',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'block',
                  }}
                />
              </span>
            </button>
          }
        >
          <div
            style={{
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
            }}
          >
            <div style={{ overflow: 'auto', padding: '4px' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  minWidth: 'max-content',
                }}
              >
                {/* Main table: periods 1–7 */}
                {PT_MAIN.map((row, r) => (
                  <div key={r} style={{ display: 'flex', gap: '4px' }}>
                    {row.map((symbol, c) => {
                      const isEmpty = !symbol;
                      const isPlaceholder = symbol === 'La-Lu' || symbol === 'Ac-Lr';
                      const elementColor =
                        !isEmpty && !isPlaceholder ? getPeriodicTableElementColor(symbol) : '#888';
                      const tintedBackground =
                        !isEmpty && !isPlaceholder
                          ? periodicTableMonochrome
                            ? isDarkMode
                              ? '#2d2d2d'
                              : '#ffffff'
                            : hexToRgba(elementColor, isDarkMode ? 0.18 : 0.12)
                          : undefined;
                      return (
                        <div
                          key={c}
                          onClick={() => {
                            if (!isEmpty && !isPlaceholder) {
                              setAtomToolSelection(symbol, 'element');
                              setTool('atom');
                              setIsPeriodicTableOpen(false);
                            }
                          }}
                          style={{
                            width: '36px',
                            height: '36px',
                            border: isEmpty ? 'none' : `1px solid ${theme.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: isPlaceholder ? '9px' : '12px',
                            fontWeight: '600',
                            cursor: isEmpty || isPlaceholder ? 'default' : 'pointer',
                            background: isEmpty
                              ? 'transparent'
                              : isPlaceholder
                                ? isDarkMode
                                  ? '#383838'
                                  : '#e8e8e8'
                                : tintedBackground,
                            borderRadius: '4px',
                            color: isPlaceholder ? '#888' : elementColor,
                            boxShadow:
                              !isEmpty && !isPlaceholder
                                ? `inset 0 0 0 1px ${hexToRgba(elementColor, isDarkMode ? 0.28 : 0.18)}`
                                : undefined,
                            flexShrink: 0,
                          }}
                        >
                          {symbol}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {/* 8px gap before f-block rows */}
                <div style={{ height: '8px' }} />
                {/* Lanthanide row — 2 empty cells to align under column 3 */}
                {[PT_LANTHANIDES, PT_ACTINIDES].map((fRow, fi) => (
                  <div key={`f${fi}`} style={{ display: 'flex', gap: '4px' }}>
                    <div style={{ width: '36px', height: '36px', flexShrink: 0 }} />
                    <div style={{ width: '36px', height: '36px', flexShrink: 0 }} />
                    <div style={{ width: '36px', height: '36px', flexShrink: 0 }} />
                    {fRow.map((symbol) =>
                      (() => {
                        const elementColor = getPeriodicTableElementColor(symbol);
                        return (
                          <div
                            key={symbol}
                            onClick={() => {
                              setAtomToolSelection(symbol, 'element');
                              setTool('atom');
                              setIsPeriodicTableOpen(false);
                            }}
                            style={{
                              width: '36px',
                              height: '36px',
                              border: `1px solid ${theme.border}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              background: periodicTableMonochrome
                                ? isDarkMode
                                  ? '#2d2d2d'
                                  : '#ffffff'
                                : hexToRgba(elementColor, isDarkMode ? 0.18 : 0.12),
                              borderRadius: '4px',
                              color: elementColor,
                              boxShadow: `inset 0 0 0 1px ${hexToRgba(
                                elementColor,
                                isDarkMode ? 0.28 : 0.18,
                              )}`,
                              flexShrink: 0,
                            }}
                          >
                            {symbol}
                          </div>
                        );
                      })(),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </FloatingPanel>
      )}

      <PreferencesPanel
        isOpen={isPreferencesPanelOpen}
        onClose={() => setIsPreferencesPanelOpen(false)}
        preferencesHydrated={preferencesHydrated}
        preferencesTab={preferencesTab}
        setPreferencesTab={setPreferencesTab}
        appPreferences={appPreferences}
        setAppPreferences={setAppPreferences}
        documentStyleSettings={documentStyleSettings}
        handleResetPreferencesToDefaults={handleResetPreferencesToDefaults}
        handleUseForNewDocumentContent={handleUseForNewDocumentContent}
        handleApplyDefaultsToCurrentDocument={handleApplyDefaultsToCurrentDocument}
        handleCenterPageInView={handleCenterPageInView}
        handleMoveContentIntoPage={handleMoveContentIntoPage}
        hasOffPageContent={offPageContent}
        theme={theme}
        isDarkMode={isDarkMode}
      />

      <TransformDialogs
        theme={theme}
        isDarkMode={isDarkMode}
        showRotateDialog={showRotateDialog}
        rotateInput={rotateInput}
        setRotateInput={setRotateInput}
        onRotate={handleRotate}
        onCloseRotate={() => {
          useStore.getState().setIsInputFocused(false);
          setShowRotateDialog(false);
        }}
        showScaleDialog={showScaleDialog}
        scaleInput={scaleInput}
        setScaleInput={setScaleInput}
        onScale={handleScale}
        onCloseScale={() => {
          useStore.getState().setIsInputFocused(false);
          setShowScaleDialog(false);
        }}
      />

      {/* About modal */}

      {isAboutOpen && (
        <FloatingPanel
          pos={aboutPos}
          size={aboutSize}
          minWidth={420}
          minHeight={320}
          title="About"
          theme={theme}
          isDarkMode={isDarkMode}
          zIndex={3000}
          positionMode="fixed"
          onClose={() => setIsAboutOpen(false)}
          onPosChange={setAboutPos}
          onSizeChange={setAboutSize}
        >
          <div
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <img
                  src="/Chem-Editor.svg"
                  alt="ChemEditor"
                  style={{ width: '52px', height: '52px', display: 'block', flexShrink: 0 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <h3 style={{ margin: 0, color: theme.text, fontSize: '24px', lineHeight: 1.1 }}>
                    ChemEditor
                  </h3>
                  <div style={{ fontSize: '12px', color: '#777' }}>Version 0.1.0</div>
                </div>
              </div>
            </div>
            <div style={{ color: theme.text, marginBottom: '15px', fontSize: '14px' }}>
              <p style={{ marginTop: 0 }}>Cross Platform Chemistry Editor.</p>
              <p style={{ marginBottom: 0, color: '#777', fontSize: '12px' }}>
                The notices below cover bundled third-party libraries and sidecar components used by
                the application.
              </p>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                background: isDarkMode ? '#1e1e1e' : '#f5f5f5',
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                padding: '15px',
              }}
            >
              <pre
                style={{
                  margin: 0,
                  fontSize: '11px',
                  color: theme.text,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                }}
              >
                {licensesText || 'Loading open-source license notices...'}
              </pre>
            </div>
            <div style={{ marginTop: '15px', textAlign: 'right' }}>
              <button
                onClick={() => setIsAboutOpen(false)}
                style={{
                  padding: '6px 16px',
                  background: '#007acc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {pageSetup.mode === 'finite' && finitePrintSvgUrl && finitePageMetrics && (
        <div className="print-pages">
          {Array.from({ length: pageSetup.rows * pageSetup.columns }, (_, index) => {
            const row = Math.floor(index / pageSetup.columns);
            const column = index % pageSetup.columns;
            return (
              <div
                key={`print-page-${row}-${column}`}
                className="print-page"
                style={{
                  width: `${pageSetup.pageWidth}${pageSetup.unit}`,
                  height: `${pageSetup.pageHeight}${pageSetup.unit}`,
                }}
              >
                <img
                  src={finitePrintSvgUrl}
                  alt=""
                  style={{
                    position: 'absolute',
                    left: `-${column * pageSetup.pageWidth}${pageSetup.unit}`,
                    top: `-${row * pageSetup.pageHeight}${pageSetup.unit}`,
                    width: `${pageSetup.pageWidth * pageSetup.columns}${pageSetup.unit}`,
                    height: `${pageSetup.pageHeight * pageSetup.rows}${pageSetup.unit}`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 9999,
            pointerEvents: 'none',
            alignItems: 'center',
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                background: t.type === 'error' ? '#c0392b' : '#2980b9',
                color: '#fff',
                padding: '8px 18px',
                borderRadius: '4px',
                fontSize: '13px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
