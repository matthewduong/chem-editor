import type { ChemDrawDocument } from '../types/chemdraw';
import type {
  AppPreferences,
  AtomColorPaletteId,
  DocumentViewSettings,
  DocumentStyleSettings,
  KeybindingPreferences,
  PageMode,
  DrawingColorSettings,
  PageOrientation,
  PagePresetId,
  PageSetup,
  PageUnit,
  RecentFileEntry,
  TextFormat,
  ToolPaletteId,
  ToolPalettesPreferences,
  UiPreferences,
  ViewerOrbitalPreferences,
} from '../types/settings';
import type { Atom, CanvasState } from '../types/chemistry';
import { invokeTauri } from './tauri';
import {
  DEFAULT_CHEMDRAW_CAPTION_FONT_SIZE,
  DEFAULT_CANVAS_BOND_LENGTH,
  DEFAULT_CHEMDRAW_STYLE_SHEET,
  getDocumentBondLineWidth,
  getDocumentCaptionFontSize,
  normalizeChemDrawStyleSheet,
} from './chemdrawMetrics';
import { ELEMENT_COLORS, ELEMENTS } from './elements';
import {
  areShortcutBindingsEqual,
  buildDefaultKeybindingPreferences,
  normalizeShortcutBinding,
  SHORTCUT_DEFINITIONS,
} from './keybindings';

export const DEFAULT_ATOM_COLOR_KEYS = [
  'C',
  'H',
  'N',
  'O',
  'P',
  'S',
  'F',
  'Cl',
  'Br',
  'I',
] as const;

export const DEFAULT_ATOM_COLORS: Record<string, string> = {
  C: '#000000',
  H: '#000000',
  N: ELEMENT_COLORS.N,
  O: ELEMENT_COLORS.O,
  P: ELEMENT_COLORS.P,
  S: ELEMENT_COLORS.S,
  F: ELEMENT_COLORS.F,
  Cl: ELEMENT_COLORS.Cl,
  Br: ELEMENT_COLORS.Br,
  I: ELEMENT_COLORS.I,
};

export const DEFAULT_ATOM_COLOR_PALETTE: AtomColorPaletteId = 'classic';

const NOBLE_GASES = new Set(['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn', 'Og']);
const HALOGENS = new Set(['F', 'Cl', 'Br', 'I', 'At', 'Ts']);
const METALLOIDS = new Set(['B', 'Si', 'Ge', 'As', 'Sb', 'Te']);
const OTHER_NONMETALS = new Set(['H', 'C', 'N', 'O', 'P', 'S', 'Se']);
const POST_TRANSITION_METALS = new Set([
  'Al',
  'Ga',
  'In',
  'Sn',
  'Tl',
  'Pb',
  'Bi',
  'Po',
  'Nh',
  'Fl',
  'Mc',
  'Lv',
]);
const LANTHANIDES = new Set([
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
]);
const ACTINIDES = new Set([
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
]);

type AtomColorCategory =
  | 'alkali-metal'
  | 'alkaline-earth'
  | 'transition-metal'
  | 'post-transition-metal'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble-gas'
  | 'lanthanide'
  | 'actinide';

function getAtomColorCategory(symbol: string): AtomColorCategory {
  if (LANTHANIDES.has(symbol)) return 'lanthanide';
  if (ACTINIDES.has(symbol)) return 'actinide';
  if (NOBLE_GASES.has(symbol)) return 'noble-gas';
  if (HALOGENS.has(symbol)) return 'halogen';
  if (METALLOIDS.has(symbol)) return 'metalloid';
  if (OTHER_NONMETALS.has(symbol)) return 'nonmetal';
  if (POST_TRANSITION_METALS.has(symbol)) return 'post-transition-metal';
  const atomic = ELEMENTS[symbol]?.atomic ?? 0;
  if ([3, 11, 19, 37, 55, 87].includes(atomic)) return 'alkali-metal';
  if ([4, 12, 20, 38, 56, 88].includes(atomic)) return 'alkaline-earth';
  return 'transition-metal';
}

function paletteFromCategories(colors: Record<AtomColorCategory, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(ELEMENT_COLORS).map((symbol) => [symbol, colors[getAtomColorCategory(symbol)]]),
  );
}

export const ATOM_COLOR_PALETTE_OPTIONS: Array<{ value: AtomColorPaletteId; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'group', label: 'By Group' },
  { value: 'neon', label: 'Neon' },
  { value: 'pastel', label: 'Pastel' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'earth', label: 'Earth' },
];

export function buildAtomColorsForPalette(palette: AtomColorPaletteId): Record<string, string> {
  switch (palette) {
    case 'high-contrast':
      return {
        ...paletteFromCategories({
          'alkali-metal': '#7b2cff',
          'alkaline-earth': '#0b8f3a',
          'transition-metal': '#7a3d00',
          'post-transition-metal': '#6d4c41',
          metalloid: '#9c27b0',
          nonmetal: '#202124',
          halogen: '#008a2e',
          'noble-gas': '#00838f',
          lanthanide: '#ad1457',
          actinide: '#5e35b1',
        }),
        H: '#4a4a4a',
        C: '#111111',
        N: '#004dff',
        O: '#e31b23',
        P: '#c56a00',
        S: '#9a7a00',
      };
    case 'group':
      return paletteFromCategories({
        'alkali-metal': '#8e44ad',
        'alkaline-earth': '#27ae60',
        'transition-metal': '#2980b9',
        'post-transition-metal': '#7f8c8d',
        metalloid: '#d35400',
        nonmetal: '#2c3e50',
        halogen: '#16a085',
        'noble-gas': '#3498db',
        lanthanide: '#c0392b',
        actinide: '#8e44ad',
      });
    case 'neon':
      return paletteFromCategories({
        'alkali-metal': '#ff4dff',
        'alkaline-earth': '#7dff00',
        'transition-metal': '#00e5ff',
        'post-transition-metal': '#ff9f1c',
        metalloid: '#ff4f81',
        nonmetal: '#39ff14',
        halogen: '#00ffa6',
        'noble-gas': '#00b8ff',
        lanthanide: '#ff6ad5',
        actinide: '#9d4dff',
      });
    case 'pastel':
      return paletteFromCategories({
        'alkali-metal': '#c9a7ff',
        'alkaline-earth': '#b8e0a5',
        'transition-metal': '#a8d8ea',
        'post-transition-metal': '#c7c7c7',
        metalloid: '#f2c6a0',
        nonmetal: '#7c8aa5',
        halogen: '#9dd9d2',
        'noble-gas': '#bde0fe',
        lanthanide: '#f4a6c1',
        actinide: '#cdb4db',
      });
    case 'ocean':
      return paletteFromCategories({
        'alkali-metal': '#5b6ee1',
        'alkaline-earth': '#2a9d8f',
        'transition-metal': '#1d5c83',
        'post-transition-metal': '#5c7c99',
        metalloid: '#4d96ff',
        nonmetal: '#264653',
        halogen: '#00b4d8',
        'noble-gas': '#90e0ef',
        lanthanide: '#3a86ff',
        actinide: '#4361ee',
      });
    case 'earth':
      return paletteFromCategories({
        'alkali-metal': '#8d6e63',
        'alkaline-earth': '#6a994e',
        'transition-metal': '#7f5539',
        'post-transition-metal': '#9c8f7a',
        metalloid: '#bc6c25',
        nonmetal: '#4f5d2f',
        halogen: '#588157',
        'noble-gas': '#6c91bf',
        lanthanide: '#b56576',
        actinide: '#7f4f24',
      });
    case 'classic':
    default:
      return Object.fromEntries(
        Object.keys(ELEMENT_COLORS).map((symbol) => [
          symbol,
          symbol === 'C' || symbol === 'H' ? '#000000' : (ELEMENT_COLORS[symbol] ?? '#909090'),
        ]),
      );
  }
}

export const DEFAULT_DRAWING_COLORS: DrawingColorSettings = {
  bondColor: '#000000',
  atomColors: DEFAULT_ATOM_COLORS,
  monochrome: true,
  atomColorPalette: DEFAULT_ATOM_COLOR_PALETTE,
};

export const DEFAULT_DOCUMENT_VIEW_SETTINGS: DocumentViewSettings = {
  atomColorViewMode: 'enhanced-defaults',
};

export const CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS: DocumentViewSettings = {
  atomColorViewMode: 'chemdraw-fidelity',
};

export const DEFAULT_TEXT_FORMAT: TextFormat = {
  fontFamily: DEFAULT_CHEMDRAW_STYLE_SHEET.captionFontFamily,
  fontSize: DEFAULT_CHEMDRAW_CAPTION_FONT_SIZE,
  bold: false,
  italic: false,
  color: '#000000',
  textAlign: 'center',
};

const LEGACY_DEFAULT_CANVAS_BOND_LENGTH = 45;
const MIN_DOCUMENT_BOND_LENGTH = 8;

function buildDefaultDocumentStyleSettings(bondLength: number): DocumentStyleSettings {
  return {
    bondLength,
    nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
    bondLineWidth: getDocumentBondLineWidth({
      bondLength,
      nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
    }),
    textFormat: {
      fontFamily: DEFAULT_CHEMDRAW_STYLE_SHEET.captionFontFamily,
      fontSize: getDocumentCaptionFontSize({
        bondLength,
        nativeMetrics: DEFAULT_CHEMDRAW_STYLE_SHEET,
      }),
      color: DEFAULT_TEXT_FORMAT.color,
      textAlign: DEFAULT_TEXT_FORMAT.textAlign,
    },
    colors: DEFAULT_DRAWING_COLORS,
  };
}

export const DEFAULT_DOCUMENT_STYLE_SETTINGS = buildDefaultDocumentStyleSettings(
  DEFAULT_CANVAS_BOND_LENGTH,
);

const LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS = buildDefaultDocumentStyleSettings(
  LEGACY_DEFAULT_CANVAS_BOND_LENGTH,
);

const CM_PER_INCH = 2.54;

export const PAGE_PRESET_SIZES_IN: Record<
  Exclude<PagePresetId, 'custom'>,
  { width: number; height: number; label: string }
> = {
  letter: { width: 8.5, height: 11, label: 'Letter' },
  legal: { width: 8.5, height: 14, label: 'Legal' },
  tabloid: { width: 11, height: 17, label: 'Tabloid' },
  a0: { width: 33.11, height: 46.81, label: 'A0' },
  a1: { width: 23.39, height: 33.11, label: 'A1' },
  a2: { width: 16.54, height: 23.39, label: 'A2' },
  a3: { width: 11.69, height: 16.54, label: 'A3' },
  a4: { width: 8.27, height: 11.69, label: 'A4' },
  a5: { width: 5.83, height: 8.27, label: 'A5' },
  a6: { width: 4.13, height: 5.83, label: 'A6' },
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  mode: 'infinite',
  unit: 'in',
  presetId: 'letter',
  orientation: 'portrait',
  pageWidth: PAGE_PRESET_SIZES_IN.letter.width,
  pageHeight: PAGE_PRESET_SIZES_IN.letter.height,
  rows: 1,
  columns: 1,
};

export const DEFAULT_TOOL_PALETTE_ORDER: ToolPaletteId[] = [
  'tools',
  'ring',
  'arrow',
  'text',
  'atom',
  'charge',
];

export const DEFAULT_TOOL_PALETTES: ToolPalettesPreferences = {
  order: DEFAULT_TOOL_PALETTE_ORDER,
  items: {
    tools: { docked: true, collapsed: true, position: { x: 88, y: 84 } },
    ring: { docked: true, collapsed: true, position: { x: 88, y: 164 } },
    arrow: { docked: true, collapsed: true, position: { x: 88, y: 244 } },
    text: { docked: true, collapsed: true, position: { x: 88, y: 324 } },
    atom: { docked: true, collapsed: true, position: { x: 88, y: 404 } },
    charge: { docked: true, collapsed: true, position: { x: 88, y: 484 } },
  },
};

const APP_PREFERENCES_VERSION = 10;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  version: APP_PREFERENCES_VERSION,
  isDarkMode: false,
  showGrid: false,
  showHydrogens: true,
  drawing: DEFAULT_DOCUMENT_STYLE_SETTINGS,
  documentView: DEFAULT_DOCUMENT_VIEW_SETTINGS,
  pageSetup: DEFAULT_PAGE_SETUP,
  viewer: {
    mode: 'split',
    representation: 'ball+stick',
    spin: false,
    spinSpeed: 0.6,
    forceField: 'UFF',
    multiConformer: false,
    maxConformers: 5,
    showAtomNumbers: false,
    showAtomLabels: false,
    showMeasureToolbar: true,
    atomScale: 1,
    bondScale: 1,
    perspectiveFov: 28,
    backgroundColor: '#f5f5f5',
    bondColor: '#3f4d5c',
    ambientLightIntensity: 1,
    hemiLightIntensity: 0.72,
    keyLightIntensity: 1.15,
    fillLightIntensity: 0.58,
    rimLightIntensity: 0.36,
    orbitals: {
      basis: '3-21G',
      opacity: 0.52,
      positiveColor: '#2563eb',
      negativeColor: '#ef4444',
      material: 'solid',
      outline: true,
      isovalue: 0.045,
      showPositivePhase: true,
      showNegativePhase: true,
    },
  },
  ui: {
    scale: 1,
    fontSize: 13,
  },
  toolPalettes: DEFAULT_TOOL_PALETTES,
  keybindings: buildDefaultKeybindingPreferences(),
  recentFiles: [],
};

interface PersistedSettingsPayload {
  version: 7 | 8 | 9 | 10;
  appPreferences: AppPreferences;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeTextFormat(value: Partial<TextFormat> | undefined): TextFormat {
  return {
    fontFamily:
      typeof value?.fontFamily === 'string' && value.fontFamily.trim()
        ? value.fontFamily
        : DEFAULT_TEXT_FORMAT.fontFamily,
    fontSize: clampNumber(value?.fontSize, DEFAULT_TEXT_FORMAT.fontSize, 4, 72),
    bold: typeof value?.bold === 'boolean' ? value.bold : DEFAULT_TEXT_FORMAT.bold,
    italic: typeof value?.italic === 'boolean' ? value.italic : DEFAULT_TEXT_FORMAT.italic,
    color:
      typeof value?.color === 'string' && value.color ? value.color : DEFAULT_TEXT_FORMAT.color,
    textAlign:
      value?.textAlign === 'left' || value?.textAlign === 'right'
        ? value.textAlign
        : DEFAULT_TEXT_FORMAT.textAlign,
  };
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

function normalizeViewerOrbitalPreferences(
  value: Partial<ViewerOrbitalPreferences> | undefined,
): ViewerOrbitalPreferences {
  return {
    basis:
      value?.basis === 'STO-3G' || value?.basis === '6-31G*' || value?.basis === '3-21G'
        ? value.basis
        : DEFAULT_APP_PREFERENCES.viewer.orbitals.basis,
    opacity: clampNumber(value?.opacity, DEFAULT_APP_PREFERENCES.viewer.orbitals.opacity, 0.1, 1),
    positiveColor: normalizeColor(
      value?.positiveColor,
      DEFAULT_APP_PREFERENCES.viewer.orbitals.positiveColor,
    ),
    negativeColor: normalizeColor(
      value?.negativeColor,
      DEFAULT_APP_PREFERENCES.viewer.orbitals.negativeColor,
    ),
    material:
      value?.material === 'glassy' ||
      value?.material === 'wireframe-overlay' ||
      value?.material === 'solid'
        ? value.material
        : DEFAULT_APP_PREFERENCES.viewer.orbitals.material,
    outline:
      typeof value?.outline === 'boolean'
        ? value.outline
        : DEFAULT_APP_PREFERENCES.viewer.orbitals.outline,
    isovalue: clampNumber(
      value?.isovalue,
      DEFAULT_APP_PREFERENCES.viewer.orbitals.isovalue,
      0.01,
      0.12,
    ),
    showPositivePhase:
      typeof value?.showPositivePhase === 'boolean'
        ? value.showPositivePhase
        : DEFAULT_APP_PREFERENCES.viewer.orbitals.showPositivePhase,
    showNegativePhase:
      typeof value?.showNegativePhase === 'boolean'
        ? value.showNegativePhase
        : DEFAULT_APP_PREFERENCES.viewer.orbitals.showNegativePhase,
  };
}

function normalizeDrawingColorSettings(
  value: Partial<DrawingColorSettings> | undefined,
): DrawingColorSettings {
  // Start with the 10 default keys, normalized with fallbacks
  const atomColors: Record<string, string> = Object.fromEntries(
    DEFAULT_ATOM_COLOR_KEYS.map((symbol) => [
      symbol,
      normalizeColor(value?.atomColors?.[symbol], DEFAULT_ATOM_COLORS[symbol]),
    ]),
  );
  // Preserve any valid custom colors for other elements (e.g. from the full periodic table editor)
  if (value?.atomColors) {
    for (const [symbol, color] of Object.entries(value.atomColors)) {
      if (!(symbol in atomColors)) {
        const normalized = normalizeColor(color, '');
        if (normalized) atomColors[symbol] = normalized;
      }
    }
  }
  return {
    bondColor: normalizeColor(value?.bondColor, DEFAULT_DRAWING_COLORS.bondColor),
    atomColors,
    monochrome:
      typeof value?.monochrome === 'boolean' ? value.monochrome : DEFAULT_DRAWING_COLORS.monochrome,
    atomColorPalette:
      value?.atomColorPalette === 'classic' ||
      value?.atomColorPalette === 'high-contrast' ||
      value?.atomColorPalette === 'group' ||
      value?.atomColorPalette === 'neon' ||
      value?.atomColorPalette === 'pastel' ||
      value?.atomColorPalette === 'ocean' ||
      value?.atomColorPalette === 'earth'
        ? value.atomColorPalette
        : DEFAULT_DRAWING_COLORS.atomColorPalette,
  };
}

export function normalizeDocumentViewSettings(
  value: Partial<DocumentViewSettings> | undefined,
): DocumentViewSettings {
  return {
    atomColorViewMode:
      value?.atomColorViewMode === 'chemdraw-fidelity' ||
      value?.atomColorViewMode === 'enhanced-defaults'
        ? value.atomColorViewMode
        : DEFAULT_DOCUMENT_VIEW_SETTINGS.atomColorViewMode,
  };
}

export function normalizeDocumentStyleSettings(
  value: Partial<DocumentStyleSettings> | undefined,
): DocumentStyleSettings {
  const bondLength = clampNumber(
    value?.bondLength,
    DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength,
    MIN_DOCUMENT_BOND_LENGTH,
    120,
  );
  const textFormat = normalizeTextFormat(value?.textFormat);
  const nativeMetrics = normalizeChemDrawStyleSheet(value?.nativeMetrics, {
    canvasBondLength: bondLength,
    legacyBondLineWidth: value?.bondLineWidth,
    legacyTextFormat: {
      fontFamily: textFormat.fontFamily,
      fontSize: textFormat.fontSize,
    },
  });
  const derivedTextFormat = {
    fontFamily: nativeMetrics.captionFontFamily,
    fontSize: getDocumentCaptionFontSize({ bondLength, nativeMetrics }),
    color: textFormat.color,
    textAlign: textFormat.textAlign,
  };
  return {
    bondLength,
    nativeMetrics,
    bondLineWidth: getDocumentBondLineWidth({ bondLength, nativeMetrics }),
    textFormat: derivedTextFormat,
    colors: normalizeDrawingColorSettings(value?.colors),
  };
}

function normalizePageUnit(value: unknown): PageUnit {
  return value === 'cm' ? 'cm' : DEFAULT_PAGE_SETUP.unit;
}

function normalizePageOrientation(value: unknown): PageOrientation {
  return value === 'landscape' ? 'landscape' : DEFAULT_PAGE_SETUP.orientation;
}

function normalizePagePresetId(value: unknown): PagePresetId {
  if (typeof value !== 'string') return DEFAULT_PAGE_SETUP.presetId;
  if (value === 'custom') return value;
  return value in PAGE_PRESET_SIZES_IN
    ? (value as Exclude<PagePresetId, 'custom'>)
    : DEFAULT_PAGE_SETUP.presetId;
}

function roundPageDimension(value: number): number {
  return Math.round(value * 100) / 100;
}

function convertPageDimension(value: number, fromUnit: PageUnit, toUnit: PageUnit): number {
  if (fromUnit === toUnit) return roundPageDimension(value);
  return roundPageDimension(fromUnit === 'in' ? value * CM_PER_INCH : value / CM_PER_INCH);
}

function getPresetDimensions(
  presetId: Exclude<PagePresetId, 'custom'>,
  orientation: PageOrientation,
  unit: PageUnit,
): { width: number; height: number } {
  const preset = PAGE_PRESET_SIZES_IN[presetId];
  const portrait =
    unit === 'in'
      ? { width: preset.width, height: preset.height }
      : {
          width: convertPageDimension(preset.width, 'in', 'cm'),
          height: convertPageDimension(preset.height, 'in', 'cm'),
        };
  return orientation === 'landscape'
    ? { width: portrait.height, height: portrait.width }
    : portrait;
}

export function normalizePageSetup(value: Partial<PageSetup> | undefined): PageSetup {
  const mode = value?.mode === 'finite' ? 'finite' : DEFAULT_PAGE_SETUP.mode;
  const unit = normalizePageUnit(value?.unit);
  const orientation = normalizePageOrientation(value?.orientation);
  const presetId = normalizePagePresetId(value?.presetId);

  if (presetId !== 'custom') {
    const dimensions = getPresetDimensions(presetId, orientation, unit);
    return {
      mode,
      unit,
      presetId,
      orientation,
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
      rows: clampNumber(value?.rows, DEFAULT_PAGE_SETUP.rows, 1, 20),
      columns: clampNumber(value?.columns, DEFAULT_PAGE_SETUP.columns, 1, 20),
    };
  }

  return {
    mode,
    unit,
    presetId,
    orientation,
    pageWidth: clampNumber(value?.pageWidth, DEFAULT_PAGE_SETUP.pageWidth, 0.5, 200),
    pageHeight: clampNumber(value?.pageHeight, DEFAULT_PAGE_SETUP.pageHeight, 0.5, 200),
    rows: clampNumber(value?.rows, DEFAULT_PAGE_SETUP.rows, 1, 20),
    columns: clampNumber(value?.columns, DEFAULT_PAGE_SETUP.columns, 1, 20),
  };
}

export function updatePageSetup(
  current: PageSetup,
  updates: Partial<PageSetup>,
  options?: { preservePhysicalSizeOnUnitChange?: boolean },
): PageSetup {
  const nextUnit = normalizePageUnit(updates.unit ?? current.unit);
  const base =
    options?.preservePhysicalSizeOnUnitChange && updates.unit && updates.unit !== current.unit
      ? {
          ...current,
          unit: nextUnit,
          pageWidth: convertPageDimension(current.pageWidth, current.unit, nextUnit),
          pageHeight: convertPageDimension(current.pageHeight, current.unit, nextUnit),
        }
      : current;
  return normalizePageSetup({ ...base, ...updates, unit: nextUnit });
}

export function getPageSetupDimensionsPx(
  pageSetup: PageSetup,
  pixelsPerInch = 72,
): {
  pageWidthPx: number;
  pageHeightPx: number;
  totalWidthPx: number;
  totalHeightPx: number;
} {
  const unitScale = pageSetup.unit === 'cm' ? pixelsPerInch / CM_PER_INCH : pixelsPerInch;
  const pageWidthPx = pageSetup.pageWidth * unitScale;
  const pageHeightPx = pageSetup.pageHeight * unitScale;
  return {
    pageWidthPx,
    pageHeightPx,
    totalWidthPx: pageWidthPx * pageSetup.columns,
    totalHeightPx: pageHeightPx * pageSetup.rows,
  };
}

export function detectPagePreset(
  pageWidth: number,
  pageHeight: number,
  unit: PageUnit,
  toleranceInches = 0.03,
): { presetId: PagePresetId; orientation: PageOrientation } {
  const widthIn = unit === 'cm' ? pageWidth / CM_PER_INCH : pageWidth;
  const heightIn = unit === 'cm' ? pageHeight / CM_PER_INCH : pageHeight;

  for (const [presetId, preset] of Object.entries(PAGE_PRESET_SIZES_IN) as Array<
    [
      Exclude<PagePresetId, 'custom'>,
      (typeof PAGE_PRESET_SIZES_IN)[Exclude<PagePresetId, 'custom'>],
    ]
  >) {
    if (
      Math.abs(widthIn - preset.width) <= toleranceInches &&
      Math.abs(heightIn - preset.height) <= toleranceInches
    ) {
      return { presetId, orientation: 'portrait' };
    }
    if (
      Math.abs(widthIn - preset.height) <= toleranceInches &&
      Math.abs(heightIn - preset.width) <= toleranceInches
    ) {
      return { presetId, orientation: 'landscape' };
    }
  }

  return { presetId: 'custom', orientation: widthIn > heightIn ? 'landscape' : 'portrait' };
}

export function inferImportedPageSetup(options: {
  mode?: PageMode;
  unit?: PageUnit;
  presetId?: PagePresetId | null;
  orientation?: PageOrientation | null;
  pageWidth?: number;
  pageHeight?: number;
  rows?: number;
  columns?: number;
  pageBounds?: { left: number; top: number; right: number; bottom: number } | null;
}): PageSetup {
  const unit = options.unit ?? 'in';
  const rows = Math.max(1, options.rows ?? 1);
  const columns = Math.max(1, options.columns ?? 1);
  const importedWidth =
    options.pageWidth ??
    (options.pageBounds
      ? (options.pageBounds.right - options.pageBounds.left) / 72 / columns
      : DEFAULT_PAGE_SETUP.pageWidth);
  const importedHeight =
    options.pageHeight ??
    (options.pageBounds
      ? (options.pageBounds.bottom - options.pageBounds.top) / 72 / rows
      : DEFAULT_PAGE_SETUP.pageHeight);
  const inferredPreset = detectPagePreset(importedWidth, importedHeight, unit);
  return normalizePageSetup({
    mode: options.mode ?? (options.pageBounds ? 'finite' : 'infinite'),
    unit,
    presetId: options.presetId ?? inferredPreset.presetId,
    orientation: options.orientation ?? inferredPreset.orientation,
    pageWidth: importedWidth,
    pageHeight: importedHeight,
    rows,
    columns,
  });
}

export function loadDocumentPageSetup(
  document: ChemDrawDocument | null | undefined,
): PageSetup | null {
  if (!document) return null;
  return normalizePageSetup(document.metadata?.pageSetup);
}

export function applyDocumentPageSetup(
  document: ChemDrawDocument,
  pageSetup: PageSetup,
): ChemDrawDocument {
  const dimensions = getPageSetupDimensionsPx(pageSetup);
  return {
    ...document,
    pages: document.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            bounds:
              pageSetup.mode === 'finite'
                ? {
                    left: 0,
                    top: 0,
                    right: dimensions.totalWidthPx,
                    bottom: dimensions.totalHeightPx,
                  }
                : undefined,
          }
        : page,
    ),
    metadata: {
      ...document.metadata,
      pageSetup,
    },
  };
}

function normalizeUiPreferences(value: Partial<UiPreferences> | undefined): UiPreferences {
  return {
    scale: clampNumber(value?.scale, DEFAULT_APP_PREFERENCES.ui.scale, 0.8, 1.5),
    fontSize: clampNumber(value?.fontSize, DEFAULT_APP_PREFERENCES.ui.fontSize, 11, 18),
  };
}

function normalizeToolPalettes(
  value: Partial<ToolPalettesPreferences> | undefined,
): ToolPalettesPreferences {
  const orderCandidates = Array.isArray(value?.order) ? value.order : [];
  const dedupedOrder = orderCandidates
    .filter(
      (paletteId): paletteId is ToolPaletteId =>
        typeof paletteId === 'string' &&
        DEFAULT_TOOL_PALETTE_ORDER.includes(paletteId as ToolPaletteId),
    )
    .filter((paletteId, index, arr) => arr.indexOf(paletteId) === index);
  const order = [
    ...dedupedOrder,
    ...DEFAULT_TOOL_PALETTE_ORDER.filter((paletteId) => !dedupedOrder.includes(paletteId)),
  ];

  return {
    order,
    items: Object.fromEntries(
      DEFAULT_TOOL_PALETTE_ORDER.map((paletteId) => {
        const current = value?.items?.[paletteId];
        const fallback = DEFAULT_TOOL_PALETTES.items[paletteId];
        return [
          paletteId,
          {
            docked: typeof current?.docked === 'boolean' ? current.docked : fallback.docked,
            collapsed:
              typeof current?.collapsed === 'boolean' ? current.collapsed : fallback.collapsed,
            position: {
              x: clampNumber(current?.position?.x, fallback.position.x, 0, 5000),
              y: clampNumber(current?.position?.y, fallback.position.y, 0, 5000),
            },
          },
        ];
      }),
    ) as ToolPalettesPreferences['items'],
  };
}

function normalizeKeybindingPreferences(
  value: Partial<KeybindingPreferences> | undefined,
  sourceVersion: number | undefined,
): KeybindingPreferences {
  const defaults = buildDefaultKeybindingPreferences();
  const legacyToolDefaults: Record<
    string,
    NonNullable<KeybindingPreferences['bindings'][string]>
  > = {
    'canvas.tools.select': { key: 'v' },
    'canvas.tools.pan': { key: 'h' },
    'canvas.tools.bond': { key: 'b' },
    'canvas.tools.ring': { key: 'r' },
    'canvas.tools.eraser': { key: 'x' },
  };
  const shouldMigrateLegacyToolDefaults =
    typeof sourceVersion === 'number' && sourceVersion < APP_PREFERENCES_VERSION;

  return {
    bindings: Object.fromEntries(
      SHORTCUT_DEFINITIONS.map((definition) => {
        const normalizedBinding = normalizeShortcutBinding(value?.bindings?.[definition.id]);
        const legacyDefault = legacyToolDefaults[definition.id];
        const binding =
          shouldMigrateLegacyToolDefaults &&
          legacyDefault &&
          areShortcutBindingsEqual(normalizedBinding, legacyDefault)
            ? defaults.bindings[definition.id]
            : (normalizedBinding ?? defaults.bindings[definition.id]);
        return [definition.id, binding];
      }),
    ),
  };
}

function getRecentFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function normalizeRecentFiles(value: unknown): RecentFileEntry[] {
  if (!Array.isArray(value)) return [];
  const byPath = new Map<string, RecentFileEntry>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Partial<RecentFileEntry>;
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (!path) continue;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : getRecentFileName(path);
    const openedAt =
      typeof raw.openedAt === 'number' && Number.isFinite(raw.openedAt) ? raw.openedAt : 0;
    const current = byPath.get(path);
    if (!current || openedAt >= current.openedAt) {
      byPath.set(path, { path, name, openedAt });
    }
  }
  return Array.from(byPath.values())
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, 10);
}

function numbersMatch(left: number, right: number, epsilon = 1e-6): boolean {
  return Math.abs(left - right) <= epsilon;
}

function chemDrawStyleSheetsMatch(left: DocumentStyleSettings['nativeMetrics']): boolean {
  return (
    numbersMatch(left.bondLength, DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength) &&
    numbersMatch(left.lineWidth, DEFAULT_CHEMDRAW_STYLE_SHEET.lineWidth) &&
    numbersMatch(left.boldWidth, DEFAULT_CHEMDRAW_STYLE_SHEET.boldWidth) &&
    numbersMatch(left.bondSpacingPct, DEFAULT_CHEMDRAW_STYLE_SHEET.bondSpacingPct) &&
    numbersMatch(left.marginWidth, DEFAULT_CHEMDRAW_STYLE_SHEET.marginWidth) &&
    numbersMatch(left.hashSpacing, DEFAULT_CHEMDRAW_STYLE_SHEET.hashSpacing) &&
    numbersMatch(left.labelSize, DEFAULT_CHEMDRAW_STYLE_SHEET.labelSize) &&
    numbersMatch(left.captionSize, DEFAULT_CHEMDRAW_STYLE_SHEET.captionSize) &&
    numbersMatch(left.labelFace, DEFAULT_CHEMDRAW_STYLE_SHEET.labelFace) &&
    numbersMatch(left.captionFace, DEFAULT_CHEMDRAW_STYLE_SHEET.captionFace) &&
    left.labelFontFamily === DEFAULT_CHEMDRAW_STYLE_SHEET.labelFontFamily &&
    left.captionFontFamily === DEFAULT_CHEMDRAW_STYLE_SHEET.captionFontFamily
  );
}

function defaultDrawingColorsMatch(colors: DrawingColorSettings): boolean {
  return (
    colors.bondColor === DEFAULT_DRAWING_COLORS.bondColor &&
    colors.monochrome === DEFAULT_DRAWING_COLORS.monochrome &&
    colors.atomColorPalette === DEFAULT_DRAWING_COLORS.atomColorPalette &&
    DEFAULT_ATOM_COLOR_KEYS.every(
      (symbol) => colors.atomColors[symbol] === DEFAULT_DRAWING_COLORS.atomColors[symbol],
    )
  );
}

function matchesLegacyDefaultDocumentStyleSettings(settings: DocumentStyleSettings): boolean {
  return (
    numbersMatch(settings.bondLength, LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength) &&
    numbersMatch(settings.bondLineWidth, LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLineWidth) &&
    settings.textFormat.fontFamily ===
      LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.fontFamily &&
    numbersMatch(
      settings.textFormat.fontSize,
      LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.fontSize,
    ) &&
    settings.textFormat.color === LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.color &&
    settings.textFormat.textAlign === LEGACY_DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.textAlign &&
    chemDrawStyleSheetsMatch(settings.nativeMetrics) &&
    defaultDrawingColorsMatch(settings.colors)
  );
}

function isLegacyPreferencesVersion(version: number | undefined): boolean {
  return typeof version !== 'number' || version < 8;
}

export function normalizeAppPreferences(
  value: Partial<AppPreferences> | undefined,
): AppPreferences {
  const viewer: Partial<AppPreferences['viewer']> = value?.viewer ?? {};
  const persistedViewerForceField = (value?.viewer as { forceField?: string } | undefined)
    ?.forceField;
  const normalizedViewerForceField =
    persistedViewerForceField === 'MMFF94'
      ? 'MMFF94s'
      : persistedViewerForceField === 'MMFF94s' ||
          persistedViewerForceField === 'UFF' ||
          persistedViewerForceField === 'xtb' ||
          persistedViewerForceField === 'hartree-fock'
        ? persistedViewerForceField
        : DEFAULT_APP_PREFERENCES.viewer.forceField;
  const normalizedDrawing = normalizeDocumentStyleSettings(value?.drawing);
  const migrateLegacyDefaults =
    isLegacyPreferencesVersion(value?.version) &&
    matchesLegacyDefaultDocumentStyleSettings(normalizedDrawing);
  const normalizedDocumentView = migrateLegacyDefaults
    ? DEFAULT_DOCUMENT_VIEW_SETTINGS
    : normalizeDocumentViewSettings(value?.documentView);

  return {
    version: APP_PREFERENCES_VERSION,
    isDarkMode:
      typeof value?.isDarkMode === 'boolean'
        ? value.isDarkMode
        : DEFAULT_APP_PREFERENCES.isDarkMode,
    showGrid:
      typeof value?.showGrid === 'boolean' ? value.showGrid : DEFAULT_APP_PREFERENCES.showGrid,
    showHydrogens:
      typeof value?.showHydrogens === 'boolean'
        ? value.showHydrogens
        : DEFAULT_APP_PREFERENCES.showHydrogens,
    drawing: migrateLegacyDefaults ? DEFAULT_DOCUMENT_STYLE_SETTINGS : normalizedDrawing,
    documentView: normalizedDocumentView,
    pageSetup: normalizePageSetup(value?.pageSetup),
    viewer: {
      mode:
        viewer.mode === 'pinned' || viewer.mode === 'floating'
          ? viewer.mode
          : DEFAULT_APP_PREFERENCES.viewer.mode,
      representation:
        viewer.representation === 'spacefill' ||
        viewer.representation === 'surface' ||
        viewer.representation === 'licorice'
          ? viewer.representation
          : DEFAULT_APP_PREFERENCES.viewer.representation,
      spin: typeof viewer.spin === 'boolean' ? viewer.spin : DEFAULT_APP_PREFERENCES.viewer.spin,
      spinSpeed: clampNumber(viewer.spinSpeed, DEFAULT_APP_PREFERENCES.viewer.spinSpeed, 0.05, 4),
      forceField: normalizedViewerForceField,
      multiConformer:
        typeof viewer.multiConformer === 'boolean'
          ? viewer.multiConformer
          : DEFAULT_APP_PREFERENCES.viewer.multiConformer,
      maxConformers: clampNumber(
        viewer.maxConformers,
        DEFAULT_APP_PREFERENCES.viewer.maxConformers,
        1,
        50,
      ),
      showAtomNumbers:
        typeof viewer.showAtomNumbers === 'boolean'
          ? viewer.showAtomNumbers
          : DEFAULT_APP_PREFERENCES.viewer.showAtomNumbers,
      showAtomLabels:
        typeof viewer.showAtomLabels === 'boolean'
          ? viewer.showAtomLabels
          : DEFAULT_APP_PREFERENCES.viewer.showAtomLabels,
      showMeasureToolbar:
        typeof viewer.showMeasureToolbar === 'boolean'
          ? viewer.showMeasureToolbar
          : DEFAULT_APP_PREFERENCES.viewer.showMeasureToolbar,
      atomScale: clampNumber(viewer.atomScale, DEFAULT_APP_PREFERENCES.viewer.atomScale, 0.4, 2.5),
      bondScale: clampNumber(viewer.bondScale, DEFAULT_APP_PREFERENCES.viewer.bondScale, 0.2, 3),
      perspectiveFov: clampNumber(
        viewer.perspectiveFov,
        DEFAULT_APP_PREFERENCES.viewer.perspectiveFov,
        12,
        75,
      ),
      backgroundColor: normalizeColor(
        viewer.backgroundColor,
        DEFAULT_APP_PREFERENCES.viewer.backgroundColor,
      ),
      bondColor: normalizeColor(viewer.bondColor, DEFAULT_APP_PREFERENCES.viewer.bondColor),
      ambientLightIntensity: clampNumber(
        viewer.ambientLightIntensity,
        DEFAULT_APP_PREFERENCES.viewer.ambientLightIntensity,
        0,
        3,
      ),
      hemiLightIntensity: clampNumber(
        viewer.hemiLightIntensity,
        DEFAULT_APP_PREFERENCES.viewer.hemiLightIntensity,
        0,
        3,
      ),
      keyLightIntensity: clampNumber(
        viewer.keyLightIntensity,
        DEFAULT_APP_PREFERENCES.viewer.keyLightIntensity,
        0,
        3,
      ),
      fillLightIntensity: clampNumber(
        viewer.fillLightIntensity,
        DEFAULT_APP_PREFERENCES.viewer.fillLightIntensity,
        0,
        3,
      ),
      rimLightIntensity: clampNumber(
        viewer.rimLightIntensity,
        DEFAULT_APP_PREFERENCES.viewer.rimLightIntensity,
        0,
        3,
      ),
      orbitals: normalizeViewerOrbitalPreferences(viewer.orbitals),
    },
    ui: normalizeUiPreferences(value?.ui),
    toolPalettes: normalizeToolPalettes(value?.toolPalettes),
    keybindings: normalizeKeybindingPreferences(value?.keybindings, value?.version),
    recentFiles: normalizeRecentFiles(value?.recentFiles),
  };
}

export function loadDocumentStyleSettings(
  document: ChemDrawDocument | null | undefined,
): DocumentStyleSettings | null {
  if (!document) return null;
  return normalizeDocumentStyleSettings(document.metadata?.documentStyleSettings);
}

export function loadDocumentViewSettings(
  document: ChemDrawDocument | null | undefined,
): DocumentViewSettings | null {
  if (!document) return null;
  return document.metadata?.documentViewSettings
    ? normalizeDocumentViewSettings(document.metadata.documentViewSettings)
    : null;
}

export function applyDocumentStyleSettings(
  document: ChemDrawDocument,
  documentStyleSettings: DocumentStyleSettings,
): ChemDrawDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      documentStyleSettings,
    },
  };
}

export function applyDocumentViewSettings(
  document: ChemDrawDocument,
  documentViewSettings: DocumentViewSettings,
): ChemDrawDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      documentViewSettings,
    },
  };
}

export function resolveDocumentPageSetup(
  document: ChemDrawDocument | null | undefined,
  appPreferences: AppPreferences,
): PageSetup {
  return loadDocumentPageSetup(document) ?? normalizePageSetup(appPreferences.pageSetup);
}

export function resolveDocumentStyleSettings(
  document: ChemDrawDocument | null | undefined,
  appPreferences: AppPreferences,
): DocumentStyleSettings {
  return (
    loadDocumentStyleSettings(document) ?? normalizeDocumentStyleSettings(appPreferences.drawing)
  );
}

export function resolveDocumentViewSettings(
  document: ChemDrawDocument | null | undefined,
  appPreferences: AppPreferences,
): DocumentViewSettings {
  return (
    loadDocumentViewSettings(document) ?? normalizeDocumentViewSettings(appPreferences.documentView)
  );
}

export function buildTextFormatFromDocumentSettings(settings: DocumentStyleSettings): TextFormat {
  return {
    ...DEFAULT_TEXT_FORMAT,
    ...settings.textFormat,
  };
}

export function getDefaultAtomColor(symbol: string, settings: DocumentStyleSettings): string {
  return (
    settings.colors.atomColors[symbol] ?? ELEMENT_COLORS[symbol] ?? DEFAULT_DRAWING_COLORS.bondColor
  );
}

export function getMonochromeForeground(isDarkMode: boolean): string {
  return isDarkMode ? '#ffffff' : '#000000';
}

function adaptLegacyBlack(color: string, isDarkMode: boolean): string {
  if (!isDarkMode) return color;
  const normalized = color.trim().toLowerCase();
  return normalized === '#000000' || normalized === '#000' || normalized === 'black'
    ? '#ffffff'
    : color;
}

export function resolveBondColor(
  color: string | undefined,
  settings: DocumentStyleSettings,
  isDarkMode: boolean,
): string {
  if (color) return adaptLegacyBlack(color, isDarkMode);
  if (settings.colors.monochrome) return getMonochromeForeground(isDarkMode);
  return adaptLegacyBlack(settings.colors.bondColor, isDarkMode);
}

export interface AtomLabelColorResolution {
  authoredColor: string | null;
  documentDefaultColor: string;
  displayOverlayColor: string | null;
  resolvedColor: string;
}

export function resolveAtomLabelColorLayers(
  explicitColor: string | undefined,
  leadElement: string,
  settings: DocumentStyleSettings,
  isDarkMode: boolean,
  documentViewSettings: DocumentViewSettings = CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
): AtomLabelColorResolution {
  const authoredColor = explicitColor ? adaptLegacyBlack(explicitColor, isDarkMode) : null;
  const documentDefaultColor = settings.colors.monochrome
    ? getMonochromeForeground(isDarkMode)
    : adaptLegacyBlack(getDefaultAtomColor(leadElement, settings), isDarkMode);
  const displayOverlayColor =
    !authoredColor &&
    settings.colors.monochrome &&
    documentViewSettings.atomColorViewMode === 'enhanced-defaults'
      ? adaptLegacyBlack(getDefaultAtomColor(leadElement, settings), isDarkMode)
      : null;
  return {
    authoredColor,
    documentDefaultColor,
    displayOverlayColor,
    resolvedColor: authoredColor ?? displayOverlayColor ?? documentDefaultColor,
  };
}

export function resolveAtomLabelColor(
  explicitColor: string | undefined,
  leadElement: string,
  settings: DocumentStyleSettings,
  isDarkMode: boolean,
  documentViewSettings: DocumentViewSettings = CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
): string {
  return resolveAtomLabelColorLayers(
    explicitColor,
    leadElement,
    settings,
    isDarkMode,
    documentViewSettings,
  ).resolvedColor;
}

export async function loadAppPreferences(): Promise<AppPreferences> {
  try {
    const raw = await invokeTauri<string | null>('load_app_settings');
    if (!raw) return DEFAULT_APP_PREFERENCES;
    const parsed = JSON.parse(raw) as PersistedSettingsPayload | Partial<AppPreferences>;
    if ('appPreferences' in parsed) return normalizeAppPreferences(parsed.appPreferences);
    return normalizeAppPreferences(parsed);
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export async function saveAppPreferences(appPreferences: AppPreferences): Promise<void> {
  const payload: PersistedSettingsPayload = { version: APP_PREFERENCES_VERSION, appPreferences };
  await invokeTauri('save_app_settings', { content: JSON.stringify(payload, null, 2) });
}

function scaleAtoms(atoms: Atom[], ratio: number): Atom[] {
  if (!atoms.length || ratio === 1) return atoms;
  const center = atoms.reduce((acc, atom) => ({ x: acc.x + atom.x, y: acc.y + atom.y }), {
    x: 0,
    y: 0,
  });
  const cx = center.x / atoms.length;
  const cy = center.y / atoms.length;
  return atoms.map((atom) => ({
    ...atom,
    x: cx + (atom.x - cx) * ratio,
    y: cy + (atom.y - cy) * ratio,
  }));
}

export function applyDocumentStyleSettingsToCanvas(
  state: CanvasState,
  current: DocumentStyleSettings,
  next: DocumentStyleSettings,
): CanvasState {
  const ratio = current.bondLength > 0 ? next.bondLength / current.bondLength : 1;
  return {
    ...state,
    atoms: scaleAtoms(state.atoms, ratio),
    bonds: state.bonds.map((bond) => ({
      ...bond,
      color: bond.color ?? next.colors.bondColor,
    })),
    textBoxes: state.textBoxes,
  };
}
