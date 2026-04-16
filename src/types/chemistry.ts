export type ArrowType =
  | 'reaction'
  | 'equilibrium'
  | 'retrosynthetic'
  | 'curved'
  | 'half-curved'
  | 'no-reaction'
  | 'dashed-reaction'
  | 'resonance'
  | 'fat';
export type AtomLabelOrientation = 'auto' | 'label-first' | 'hydrogen-first';
export type BondDisplayStyle = 'solid' | 'dash' | 'bold' | 'wavy' | 'crossed' | 'dative';
export type DoubleBondMode = 'auto' | 'flipped' | 'symmetric';
export type AtomKind = 'element' | 'alias';
export type ElectronToolMode =
  | 'charge-positive'
  | 'charge-negative'
  | 'radical'
  | 'lone-pair-add'
  | 'lone-pair-remove';
export type AtomAliasResolutionStatus =
  | 'resolved'
  | 'ambiguous'
  | 'unsupported_syntax'
  | 'unsupported_structure'
  | 'chemically_invalid'
  | 'coordination_only';
export type AtomAliasSemanticKind = 'covalent' | 'coordination';
export type RingTemplatePreset = 'chair' | 'chair-flipped';
export type RingTemplateFamily = 'chair';
export type RingTemplateAtomStereo = 'N' | 'r' | 's';
export type RingTemplateAtomGeometry = 'Tetrahedral';

export interface RingTemplateNativeStereo {
  geometry: RingTemplateAtomGeometry;
  as: Exclude<RingTemplateAtomStereo, 'N'>;
  bondOrdering: Array<string | 0>;
}

export interface RingTemplateAtomMembership {
  structureId: string;
  family: RingTemplateFamily;
  preset: RingTemplatePreset;
  atomKey: string;
  nativeStereo?: RingTemplateNativeStereo;
}

export interface RingTemplateBondMembership {
  structureId: string;
  family: RingTemplateFamily;
  preset: RingTemplatePreset;
  bondKey: string;
}

export interface AtomAliasCandidateSnapshot {
  id: string;
  label: string;
  semanticKind: AtomAliasSemanticKind;
  source: 'shorthand' | 'parsed' | 'ligand' | 'rewrite';
  subsSmiles?: string;
}

export interface AtomAliasResolution {
  status: AtomAliasResolutionStatus;
  selectedCandidateId?: string;
  selectedLabel?: string;
  semanticKind?: AtomAliasSemanticKind;
  reason?: string;
  candidates?: AtomAliasCandidateSnapshot[];
}

export interface Atom {
  id: string;
  x: number;
  y: number;
  kind: AtomKind;
  element: string;
  alias?: string; // explicit alias/superatom text
  charge?: number;
  lonePairs?: number;
  radicalElectrons?: number;
  electronAngles?: number[];
  electrons?: number; // legacy total nonbonding electron count
  isotope?: number; // mass number, e.g. 13 for ¹³C, 2 for ²H (D)
  labelFontFamily?: string;
  labelFontSize?: number;
  labelColor?: string;
  labelRuns?: TextRun[];
  labelOrientation?: AtomLabelOrientation;
  aliasResolution?: AtomAliasResolution;
  ringTemplateMemberships?: RingTemplateAtomMembership[];
}

export interface Bond {
  id: string;
  from: string;
  to: string;
  order: number;
  doubleBondMode?: DoubleBondMode;
  stereo?: number;
  color?: string;
  lineWidth?: number;
  displayStyle?: BondDisplayStyle;
  ringTemplateMemberships?: RingTemplateBondMembership[];
}

export interface Arrow {
  id: string;
  type: ArrowType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cpx: number;
  cpy: number;
  curveEnabled?: boolean;
  label?: string; // backward-compat alias for labelAbove
  labelAbove?: string; // conditions above arrow
  labelBelow?: string; // conditions below arrow
  labelFontSize?: number; // default 12
  labelColor?: string; // default inherits from canvas theme
  strokeColor?: string; // arrow shaft/head stroke color (distinct from label color)
  lineWidth?: number; // shaft width for any arrow type
  lineStyle?: 'solid' | 'dashed' | 'bold';
}

export interface Group {
  id: string;
  atomIds: string[]; // all atoms in this group (flattened, includes child group atoms)
  childGroupIds?: string[]; // sub-groups directly nested inside this group
  arrowIds?: string[]; // arrows included in this group
  textBoxIds?: string[]; // text boxes included in this group
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  sub?: boolean;
  sup?: boolean;
  color?: string;
}

export type ChemicalTextSource = 'exact' | 'alias' | 'repeated-root' | 'hydrogen-led';

export type ChemicalTextReason = 'empty' | 'unsupported_syntax' | 'chemically_invalid';

export interface ChemicalTextMetadata {
  intent: boolean;
  formula: string;
  chemistryAvailable: boolean;
  smiles?: string;
  source?: ChemicalTextSource;
  reason?: ChemicalTextReason;
  message?: string;
}

export type TextBoxSemanticMode = 'plain' | 'auto' | 'chemical';

export type TextBoxChemicalConversionStatus = 'plain' | 'resolved' | 'unresolved';

export interface TextBox {
  id: string;
  x: number;
  y: number;
  runs: TextRun[];
  fontSize: number; // default 14
  fontFamily: string; // default 'Arial'
  color: string; // default '#000000' / '#ffffff' in dark mode
  textAlign?: 'left' | 'center' | 'right'; // default 'center'; x is the anchor point
  width?: number; // optional fixed width, else auto
  rotation?: number; // degrees, Konva convention (clockwise)
  semanticMode?: TextBoxSemanticMode;
  conversionStatus?: TextBoxChemicalConversionStatus;
  chemicalMetadata?: ChemicalTextMetadata;
}

export interface CanvasState {
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  groups?: Group[];
  textBoxes?: TextBox[];
}

export interface MoleculeProperties {
  formula: string;
  mw: number;
  exact_mass: number;
  logp: number;
  tpsa: number;
  hbd: number;
  hba: number;
  rotatable_bonds: number;
  rings: number;
  aromatic_rings: number;
  charge: number;
  heavy_atoms: number;
}

export interface IrPeak {
  wavenumber: number; // cm⁻¹
  intensity: number; // km/mol (raw xtb output)
}

export interface MsPeak {
  mz: number; // m/z (neutral molecule mass)
  intensity: number; // relative intensity 0–100
}

export interface MsSpectrum {
  peaks: MsPeak[];
  exact_mass: number; // monoisotopic mass in Da
  formula: string;
}

export interface NmrTransition {
  ppm: number;
  intensity: number;
  label?: string | null;
}

export interface NmrSignal {
  atom_idxs: number[];
  center_ppm: number;
  integral: number;
  multiplicity: string;
  couplings_hz: number[];
  confidence: number;
  source: string;
  mad?: number;
  explanation?: string[];
  transitions: NmrTransition[];
}

export interface NmrSpectrum {
  signals_1h: NmrSignal[];
  signals_13c: NmrSignal[];
  dft_geometry_refinement?: 'xtb' | 'mmff94s';
}
