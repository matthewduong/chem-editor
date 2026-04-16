export interface TextFormat {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

export interface ChemDrawStyleSheet {
  bondLength: number;
  lineWidth: number;
  boldWidth: number;
  bondSpacingPct: number;
  marginWidth: number;
  hashSpacing: number;
  labelSize: number;
  captionSize: number;
  labelFace: number;
  captionFace: number;
  labelFontFamily: string;
  captionFontFamily: string;
}

export type ViewerForceField = 'MMFF94s' | 'UFF' | 'xtb' | 'hartree-fock';
export type ViewerOrbitalBasis = 'STO-3G' | '3-21G' | '6-31G*';
export type ViewerOrbitalMaterial = 'solid' | 'glassy' | 'wireframe-overlay';

export interface ViewerOrbitalPreferences {
  basis: ViewerOrbitalBasis;
  opacity: number;
  positiveColor: string;
  negativeColor: string;
  material: ViewerOrbitalMaterial;
  outline: boolean;
  isovalue: number;
  showPositivePhase: boolean;
  showNegativePhase: boolean;
}

export interface ViewerPreferences {
  mode: 'pinned' | 'floating' | 'split';
  representation: 'ball+stick' | 'spacefill' | 'surface' | 'licorice';
  spin: boolean;
  spinSpeed: number;
  forceField: ViewerForceField;
  multiConformer: boolean;
  maxConformers: number;
  showAtomNumbers: boolean;
  showAtomLabels: boolean;
  showMeasureToolbar: boolean;
  atomScale: number;
  bondScale: number;
  perspectiveFov: number;
  backgroundColor: string;
  bondColor: string;
  ambientLightIntensity: number;
  hemiLightIntensity: number;
  keyLightIntensity: number;
  fillLightIntensity: number;
  rimLightIntensity: number;
  orbitals: ViewerOrbitalPreferences;
}

export interface UiPreferences {
  scale: number;
  fontSize: number;
}

export interface ShortcutBinding {
  key: string;
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeybindingPreferences {
  bindings: Record<string, ShortcutBinding | null>;
}

export type ToolPaletteId = 'tools' | 'ring' | 'arrow' | 'text' | 'atom' | 'charge';

export interface ToolPaletteState {
  docked: boolean;
  collapsed: boolean;
  position: { x: number; y: number };
}

export interface ToolPalettesPreferences {
  order: ToolPaletteId[];
  items: Record<ToolPaletteId, ToolPaletteState>;
}

export interface DrawingColorSettings {
  bondColor: string;
  atomColors: Record<string, string>;
  monochrome: boolean;
  atomColorPalette: AtomColorPaletteId;
}

export type AtomColorViewMode = 'enhanced-defaults' | 'chemdraw-fidelity';

export interface DocumentViewSettings {
  atomColorViewMode: AtomColorViewMode;
}

export type AtomColorPaletteId =
  | 'classic'
  | 'high-contrast'
  | 'group'
  | 'neon'
  | 'pastel'
  | 'ocean'
  | 'earth';

export type PageUnit = 'in' | 'cm';
export type PageMode = 'infinite' | 'finite';
export type PageOrientation = 'portrait' | 'landscape';
export type PagePresetId =
  | 'custom'
  | 'letter'
  | 'legal'
  | 'tabloid'
  | 'a0'
  | 'a1'
  | 'a2'
  | 'a3'
  | 'a4'
  | 'a5'
  | 'a6';

export interface PageSetup {
  mode: PageMode;
  unit: PageUnit;
  presetId: PagePresetId;
  orientation: PageOrientation;
  pageWidth: number;
  pageHeight: number;
  rows: number;
  columns: number;
}

export interface DocumentStyleSettings {
  bondLength: number;
  bondLineWidth: number;
  textFormat: Pick<TextFormat, 'fontFamily' | 'fontSize' | 'color' | 'textAlign'>;
  colors: DrawingColorSettings;
  nativeMetrics: ChemDrawStyleSheet;
}

export interface AppPreferences {
  version: 7 | 8;
  isDarkMode: boolean;
  showGrid: boolean;
  showHydrogens: boolean;
  drawing: DocumentStyleSettings;
  documentView: DocumentViewSettings;
  pageSetup: PageSetup;
  viewer: ViewerPreferences;
  ui: UiPreferences;
  toolPalettes: ToolPalettesPreferences;
  keybindings: KeybindingPreferences;
}
