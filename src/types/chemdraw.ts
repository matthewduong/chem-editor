import type {
  ArrowType,
  AtomAliasResolution,
  ChemicalTextMetadata,
  DoubleBondMode,
  AtomLabelOrientation,
  CanvasState,
  RingTemplateAtomGeometry,
  RingTemplateAtomMembership,
  RingTemplateAtomStereo,
  RingTemplateBondMembership,
  TextBoxChemicalConversionStatus,
  TextBoxSemanticMode,
  TextRun,
} from './chemistry';
import type {
  DocumentViewSettings,
  DocumentStyleSettings,
  PageOrientation,
  PagePresetId,
  PageSetup,
  PageUnit,
} from './settings';

export type ChemDrawObjectType =
  | 'fragment'
  | 'node'
  | 'bond'
  | 'text'
  | 'arrow'
  | 'bracket'
  | 'graphic'
  | 'embedded-object'
  | 'table'
  | 'group';

export type ChemDrawEditingCapability = 'editable' | 'round-trip-only' | 'render-only';

export type ChemDrawTextJustification = 'left' | 'center' | 'right';

export type ChemDrawQueryAtomType =
  | 'any'
  | 'list'
  | 'not-list'
  | 'r-group'
  | 'alias'
  | 'variable-attachment';

export type ChemDrawBondDisplay =
  | 'solid'
  | 'wedge-begin'
  | 'wedge-end'
  | 'hash-begin'
  | 'hash-end'
  | 'wavy'
  | 'crossed'
  | 'dative'
  | 'dash'
  | 'dotted-hydrogen'
  | 'bold';

export type ChemDrawReactionRole =
  | 'reactant'
  | 'product'
  | 'agent'
  | 'solvent'
  | 'catalyst'
  | 'annotation'
  | 'unknown';

export type ChemDrawArrowHeadType = 'solid' | 'angle' | 'filled' | 'hollow';

export interface ChemDrawPoint {
  x: number;
  y: number;
}

export interface ChemDrawBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChemDrawStyle {
  color?: string;
  strokeColor?: string;
  lineWidth?: number;
  lineType?: 'solid' | 'dashed' | 'bold';
  boldWidth?: number;
  hashSpacing?: number;
  fillColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  rotation?: number;
  zIndex?: number;
  visible?: boolean;
}

export interface ChemDrawTextBlock {
  runs: TextRun[];
  justification?: ChemDrawTextJustification;
  width?: number;
  bounds?: ChemDrawBounds;
}

export interface ChemDrawPreservationMetadata {
  capability?: ChemDrawEditingCapability;
  reasons?: string[];
  rawAttributes?: Record<string, string>;
  rawChildrenXml?: string[];
}

export interface ChemDrawObjectTag {
  id?: string;
  name: string;
  tagType?: string;
  value?: string;
  visible?: boolean;
  positioningType?: string;
  positioningAngle?: number;
  positioningOffset?: ChemDrawPoint;
  text?: ChemDrawTextBlock;
  textAnchor?: ChemDrawPoint;
  style?: ChemDrawStyle;
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawQueryAtom {
  type: ChemDrawQueryAtomType;
  elements?: string[];
  label?: string;
  rGroupName?: string;
  genericName?: string;
  negateList?: boolean;
  linkCountLow?: number;
  linkCountHigh?: number;
  attachments?: string[];
}

export interface ChemDrawNode {
  id: string;
  type: 'node';
  position: ChemDrawPoint;
  sourceNodeType?: string;
  element?: string;
  charge?: number;
  lonePairCount?: number;
  radicalElectrons?: number;
  electronAngles?: number[];
  isotope?: number;
  alias?: string;
  text?: ChemDrawTextBlock;
  query?: ChemDrawQueryAtom;
  style?: ChemDrawStyle;
  labelOrientation?: AtomLabelOrientation;
  labelAlignment?: 'left' | 'center' | 'right' | 'above' | 'below';
  aliasResolution?: AtomAliasResolution;
  geometry?: RingTemplateAtomGeometry;
  atomStereo?: RingTemplateAtomStereo;
  bondOrdering?: Array<string | 0>;
  ringTemplateMemberships?: RingTemplateAtomMembership[];
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawBond {
  id: string;
  type: 'bond';
  beginNodeId: string;
  endNodeId: string;
  order?: number;
  doubleBondMode?: DoubleBondMode;
  display?: ChemDrawBondDisplay;
  secondaryDisplay?: ChemDrawBondDisplay;
  aromatic?: boolean;
  bondSpacingAbs?: number;
  bondSpacingPct?: number;
  query?: {
    allowedOrders?: number[];
    ringState?: 'ring' | 'chain' | 'either';
  };
  style?: ChemDrawStyle;
  ringTemplateMemberships?: RingTemplateBondMembership[];
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawFragment {
  id: string;
  type: 'fragment';
  nodeIds: string[];
  bondIds: string[];
  role?: ChemDrawReactionRole;
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawArrow {
  id: string;
  type: 'arrow';
  arrowType: ArrowType;
  headType?: ChemDrawArrowHeadType;
  tail: ChemDrawPoint;
  head: ChemDrawPoint;
  headSize?: number;
  headCenterSize?: number;
  headWidth?: number;
  shaftSpacing?: number;
  equilibriumRatio?: number;
  controlPoint?: ChemDrawPoint;
  curveEnabled?: boolean;
  arcCenter?: ChemDrawPoint;
  majorAxisEnd?: ChemDrawPoint;
  minorAxisEnd?: ChemDrawPoint;
  angularSize?: number;
  textAbove?: ChemDrawTextBlock;
  textBelow?: ChemDrawTextBlock;
  role?: ChemDrawReactionRole;
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawText {
  id: string;
  type: 'text';
  anchor: ChemDrawPoint;
  text: ChemDrawTextBlock;
  style?: ChemDrawStyle;
  semanticMode?: TextBoxSemanticMode;
  conversionStatus?: TextBoxChemicalConversionStatus;
  chemicalMetadata?: ChemicalTextMetadata;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawBracket {
  id: string;
  type: 'bracket';
  bounds: ChemDrawBounds;
  bracketType?: 'sru' | 'multiple-group' | 'mixture' | 'generic';
  label?: string;
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawGraphic {
  id: string;
  type: 'graphic';
  graphicType:
    | 'line'
    | 'rectangle'
    | 'rounded-rectangle'
    | 'ellipse'
    | 'polygon'
    | 'symbol'
    | 'bracket'
    | 'orbital'
    | 'unknown';
  points?: ChemDrawPoint[];
  bounds?: ChemDrawBounds;
  cornerRadius?: number; // canvas px, for rounded-rectangle
  rectangleType?: string;
  shadowSize?: number;
  symbolType?: 'CirclePlus' | 'CircleMinus' | 'LonePair' | 'Electron' | string;
  representedObjectId?: string;
  representedAttribute?: string;
  bracketType?: string;
  bracketUsage?: string;
  label?: string;
  lipSize?: number;
  orbitalType?: string;
  ovalType?: string;
  center?: ChemDrawPoint;
  majorAxisEnd?: ChemDrawPoint;
  minorAxisEnd?: ChemDrawPoint;
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawEmbeddedObject {
  id: string;
  type: 'embedded-object';
  bounds: ChemDrawBounds;
  payloadKind: 'pdf' | 'png' | 'jpeg' | 'unknown';
  payloadHex: string;
  previewDataUrl?: string;
  sourceMimeType?: string;
  sourceFileName?: string;
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawTableCell {
  id: string;
  boundsInParent: ChemDrawBounds;
  text?: ChemDrawTextBlock;
  rawAttributes?: Record<string, string>;
  rawChildrenXml?: string[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawTable {
  id: string;
  type: 'table';
  bounds: ChemDrawBounds;
  cells: ChemDrawTableCell[];
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export interface ChemDrawGroup {
  id: string;
  type: 'group';
  childIds: string[];
  style?: ChemDrawStyle;
  objectTags?: ChemDrawObjectTag[];
  preservation?: ChemDrawPreservationMetadata;
}

export type ChemDrawObject =
  | ChemDrawFragment
  | ChemDrawNode
  | ChemDrawBond
  | ChemDrawArrow
  | ChemDrawText
  | ChemDrawBracket
  | ChemDrawGraphic
  | ChemDrawEmbeddedObject
  | ChemDrawTable
  | ChemDrawGroup;

export interface ChemDrawPage {
  id: string;
  bounds?: ChemDrawBounds;
  objects: ChemDrawObject[];
  preservedPageChildren?: Array<{
    tagName: string;
    xml: string;
    capability: ChemDrawEditingCapability;
    reason: string;
  }>;
}

export interface ChemDrawDocument {
  schemaVersion: 1;
  source: 'canvas-state' | 'cdxml-import' | 'manual';
  pages: ChemDrawPage[];
  metadata?: {
    bondLength?: number;
    captionSize?: number;
    labelSize?: number;
    pageSetup?: PageSetup;
    pageUnit?: PageUnit;
    pagePresetId?: PagePresetId;
    pageOrientation?: PageOrientation;
    widthPages?: number;
    heightPages?: number;
    documentStyleSettings?: DocumentStyleSettings;
    documentViewSettings?: DocumentViewSettings;
    preservedDocumentAttributes?: Record<string, string>;
    preservedPageAttributes?: Record<string, string>;
    ignoredSemantics?: string[];
  };
}

export interface ChemDrawConversionResult {
  document: ChemDrawDocument;
  warnings: string[];
}

export interface CanvasConversionResult {
  state: CanvasState;
  warnings: string[];
}
