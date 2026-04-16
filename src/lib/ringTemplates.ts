import type {
  Atom,
  Bond,
  CanvasState,
  RingTemplateAtomGeometry,
  RingTemplateAtomMembership,
  RingTemplateAtomStereo,
  RingTemplateBondMembership,
  RingTemplateNativeStereo,
  RingTemplatePreset as TemplatePreset,
} from '../types/chemistry';
import { DEFAULT_CHEMDRAW_STYLE_SHEET } from './chemdrawMetrics';

export type RingPreset = 'polygon' | TemplatePreset;
export type RingTemplatePreset = TemplatePreset;

type TemplateAtom = {
  key: string;
  x: number;
  y: number;
  element: string;
};

type TemplateBond = {
  key: string;
  from: number;
  to: number;
  order: number;
};

type BondFusionCandidate = {
  bondIndex: number;
  reversed: boolean;
};

export type ChairAttachmentKind = 'axial' | 'equatorial';

type TemplateAttachmentDirection = {
  axial: { x: number; y: number };
  equatorial: { x: number; y: number };
};

type BondOrderingToken = 'existing' | 'shared' | 'new' | 0;

type FusionStereoPattern = {
  as: Exclude<RingTemplateAtomStereo, 'N'>;
  bondOrderingTemplate: BondOrderingToken[];
};

type RingTemplate = {
  label: string;
  referenceBondLength: number;
  atoms: TemplateAtom[];
  bonds: TemplateBond[];
  attachmentDirectionsByAtomKey: Record<string, TemplateAttachmentDirection>;
  atomAttachmentCandidates: number[];
  bondFusionCandidates: BondFusionCandidate[];
  fusionStereoByEndpoint: {
    from: FusionStereoPattern;
    to: FusionStereoPattern;
  };
};

export type RingGeometry = {
  atoms: TemplateAtom[];
  bonds: TemplateBond[];
};

export type ResolvedRingTemplatePlacement = RingGeometry & {
  preset: RingTemplatePreset;
  mappedAtomIdsByIndex: Map<number, string>;
  mappedBondIdsByIndex: Map<number, string>;
  skippedBondIndices: Set<number>;
};

export type ResolveRingTemplatePlacementOptions = {
  preset: RingTemplatePreset;
  bondLength: number;
  center?: { x: number; y: number };
  pointer?: { x: number; y: number };
  existingAtoms: Atom[];
  existingBonds: Bond[];
  hitAtom?: Atom;
  hitBond?: Bond;
  preferInterior?: boolean;
  rotationSteps?: number;
};

export type ChairAttachmentCandidate = {
  kind: ChairAttachmentKind;
  x: number;
  y: number;
  angle: number;
  occupied: boolean;
  structureIds: string[];
  atomKeys: string[];
};

export type ResolvedChairAttachmentSnapping = {
  candidates: ChairAttachmentCandidate[];
  selectedCandidate?: ChairAttachmentCandidate;
  quickClickCandidate?: ChairAttachmentCandidate;
};

type InternalChairAttachmentCandidate = ChairAttachmentCandidate & {
  stableOrder: number;
};

type StructureMembershipRecord = {
  preset: RingTemplatePreset;
  atomMemberships: Array<{ atomId: string; membership: RingTemplateAtomMembership }>;
  bondMemberships: Array<{ bond: Bond; membership: RingTemplateBondMembership }>;
};

const CHAIR_REFERENCE_BOND_LENGTH = DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength;
const CHAIR_FAMILY = 'chair' as const;
const ROTATION_STEP_RADIANS = Math.PI / 3;
const DEFAULT_TEMPLATE_STEREO: RingTemplateAtomStereo = 'N';
const TEMPLATE_STEREO_GEOMETRY: RingTemplateAtomGeometry = 'Tetrahedral';
const CHAIR_ATTACHMENT_DEDUPE_DISTANCE_FRACTION = 0.2;
const CHAIR_ATTACHMENT_DEDUPE_ANGLE = Math.PI / 18;
const CHAIR_ATTACHMENT_OCCUPANCY_ANGLE = Math.PI / 8;
const CHAIR_POINTER_MIN_DISTANCE = 0.5;

function createChairTemplate(
  label: string,
  atomCoordinates: Array<{ x: number; y: number }>,
  attachmentDirections: TemplateAttachmentDirection[],
  fusionStereoByEndpoint: RingTemplate['fusionStereoByEndpoint'],
): RingTemplate {
  return {
    label,
    referenceBondLength: CHAIR_REFERENCE_BOND_LENGTH,
    atoms: atomCoordinates.map((atom, index) => ({
      key: `a${index}`,
      x: atom.x,
      y: atom.y,
      element: 'C',
    })),
    bonds: atomCoordinates.map((_, index) => ({
      key: `b${index}`,
      from: index,
      to: (index + 1) % atomCoordinates.length,
      order: 1,
    })),
    attachmentDirectionsByAtomKey: Object.fromEntries(
      attachmentDirections.map((direction, index) => [
        `a${index}`,
        {
          axial: normalizeVector(direction.axial),
          equatorial: normalizeVector(direction.equatorial),
        },
      ]),
    ),
    atomAttachmentCandidates: atomCoordinates.map((_, index) => index),
    bondFusionCandidates: atomCoordinates.flatMap((_, index) => [
      { bondIndex: index, reversed: false },
      { bondIndex: index, reversed: true },
    ]),
    fusionStereoByEndpoint,
  };
}

// Coordinates sampled from ChemDraw's native chair tool output in chairs.cdxml.
const RING_TEMPLATES: Record<RingTemplatePreset, RingTemplate> = {
  chair: createChairTemplate(
    'Cyclohexane Chair',
    [
      { x: 0, y: 0 },
      { x: 7.2, y: 12.47 },
      { x: 21.13, y: 8.82 },
      { x: 34.97, y: 12.47 },
      { x: 27.77, y: 0 },
      { x: 13.84, y: 3.65 },
    ],
    [
      { axial: { x: 0, y: -1 }, equatorial: { x: -13.84, y: -3.65 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: -13.93, y: 3.65 } },
      { axial: { x: 0, y: -1 }, equatorial: { x: 13.93, y: -3.65 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: 13.84, y: 3.65 } },
      { axial: { x: 0, y: -1 }, equatorial: { x: 13.93, y: -3.65 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: -13.93, y: 3.65 } },
    ],
    {
      from: { as: 'r', bondOrderingTemplate: ['shared', 'existing', 0, 'new'] },
      to: { as: 'r', bondOrderingTemplate: ['existing', 'shared', 'new', 0] },
    },
  ),
  'chair-flipped': createChairTemplate(
    'Cyclohexane Chair (Flipped)',
    [
      { x: 0, y: 0 },
      { x: -7.2, y: 12.47 },
      { x: 6.64, y: 8.51 },
      { x: 20.57, y: 12.47 },
      { x: 27.77, y: 0 },
      { x: 13.93, y: 3.96 },
    ],
    [
      { axial: { x: 0, y: -1 }, equatorial: { x: -13.93, y: -3.96 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: -13.84, y: 3.96 } },
      { axial: { x: 0, y: -1 }, equatorial: { x: -13.93, y: -3.96 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: 13.93, y: 3.96 } },
      { axial: { x: 0, y: -1 }, equatorial: { x: 13.84, y: -3.96 } },
      { axial: { x: 0, y: 1 }, equatorial: { x: 13.93, y: 3.96 } },
    ],
    {
      from: { as: 's', bondOrderingTemplate: ['shared', 'existing', 0, 'new'] },
      to: { as: 's', bondOrderingTemplate: ['existing', 'shared', 0, 'new'] },
    },
  ),
};

export function getRingPresetLabel(preset: RingPreset, ringSize = 6): string {
  if (preset === 'polygon') return `${ringSize}-Membered Ring`;
  return RING_TEMPLATES[preset].label;
}

export function isRingTemplatePreset(preset: RingPreset): preset is RingTemplatePreset {
  return preset === 'chair' || preset === 'chair-flipped';
}

export function getRegularRingGeometry(
  center: { x: number; y: number },
  bondLength: number,
  size: number,
): RingGeometry {
  const radius = bondLength / (2 * Math.sin(Math.PI / size));
  const atoms: TemplateAtom[] = Array.from({ length: size }, (_, index) => ({
    key: `a${index}`,
    x: center.x + radius * Math.cos((2 * Math.PI * index) / size - Math.PI / 2),
    y: center.y + radius * Math.sin((2 * Math.PI * index) / size - Math.PI / 2),
    element: 'C',
  }));
  const bonds: TemplateBond[] = Array.from({ length: size }, (_, index) => ({
    key: `b${index}`,
    from: index,
    to: (index + 1) % size,
    order: 1,
  }));
  return { atoms, bonds };
}

export function materializeRingGeometry(geometry: RingGeometry): { atoms: Atom[]; bonds: Bond[] } {
  const atoms = geometry.atoms.map((atom) => ({
    id: crypto.randomUUID(),
    x: atom.x,
    y: atom.y,
    kind: 'element' as const,
    element: atom.element,
  }));
  const bonds = geometry.bonds.map((bond) => ({
    id: crypto.randomUUID(),
    from: atoms[bond.from]!.id,
    to: atoms[bond.to]!.id,
    order: bond.order,
    stereo: 0,
  }));
  return { atoms, bonds };
}

export function materializeResolvedRingTemplatePlacement(
  placement: ResolvedRingTemplatePlacement,
  existingAtoms: Atom[],
  existingBonds: Bond[],
): { atoms: Atom[]; bonds: Bond[] } {
  const template = RING_TEMPLATES[placement.preset];
  const structureId = crypto.randomUUID();
  const atoms = existingAtoms.map(cloneAtomWithMemberships);
  const bonds = existingBonds.map(cloneBondWithMemberships);
  const atomIndexById = new Map(atoms.map((atom, index) => [atom.id, index]));
  const bondIndexById = new Map(bonds.map((bond, index) => [bond.id, index]));
  const atomIdByTemplateIndex = new Map<number, string>();
  const bondIdByTemplateIndex = new Map<number, string>();

  placement.atoms.forEach((atom, index) => {
    const templateAtom = template.atoms[index];
    if (!templateAtom) return;
    const membership = buildAtomMembership(structureId, placement.preset, templateAtom.key);
    const mappedId = placement.mappedAtomIdsByIndex.get(index);
    if (mappedId) {
      atomIdByTemplateIndex.set(index, mappedId);
      const atomIndex = atomIndexById.get(mappedId);
      if (atomIndex == null) return;
      const existingAtom = atoms[atomIndex]!;
      atoms[atomIndex] = {
        ...existingAtom,
        ringTemplateMemberships: appendAtomMembership(
          existingAtom.ringTemplateMemberships,
          membership,
        ),
      };
      return;
    }
    const id = crypto.randomUUID();
    atomIdByTemplateIndex.set(index, id);
    atoms.push({
      id,
      x: atom.x,
      y: atom.y,
      kind: 'element',
      element: atom.element,
      ringTemplateMemberships: [membership],
    });
    atomIndexById.set(id, atoms.length - 1);
  });

  placement.bonds.forEach((bond, index) => {
    const templateBond = template.bonds[index];
    if (!templateBond) return;
    const membership = buildBondMembership(structureId, placement.preset, templateBond.key);
    const mappedBondId = placement.mappedBondIdsByIndex.get(index);
    if (mappedBondId) {
      bondIdByTemplateIndex.set(index, mappedBondId);
      const bondIndex = bondIndexById.get(mappedBondId);
      if (bondIndex == null) return;
      const existingBond = bonds[bondIndex]!;
      bonds[bondIndex] = {
        ...existingBond,
        ringTemplateMemberships: appendBondMembership(
          existingBond.ringTemplateMemberships,
          membership,
        ),
      };
      return;
    }

    const from = atomIdByTemplateIndex.get(bond.from);
    const to = atomIdByTemplateIndex.get(bond.to);
    if (!from || !to || from === to) return;
    const id = crypto.randomUUID();
    bondIdByTemplateIndex.set(index, id);
    bonds.push({
      id,
      from,
      to,
      order: bond.order,
      stereo: 0,
      ringTemplateMemberships: [membership],
    });
    bondIndexById.set(id, bonds.length - 1);
  });

  const sharedBondIndex = placement.mappedBondIdsByIndex.size
    ? placement.mappedBondIdsByIndex.keys().next().value
    : undefined;
  if (typeof sharedBondIndex === 'number') {
    applyFusionStereoMetadata({
      template,
      placement,
      structureId,
      sharedBondIndex,
      atoms,
      bonds,
      atomIndexById,
      bondIndexById,
      atomIdByTemplateIndex,
      bondIdByTemplateIndex,
    });
  }

  return { atoms, bonds };
}

export function resolveRingTemplatePlacement(
  options: ResolveRingTemplatePlacementOptions,
): ResolvedRingTemplatePlacement {
  const template = getPreparedTemplate(
    RING_TEMPLATES[options.preset],
    options.bondLength,
    options.rotationSteps ?? 0,
  );
  const center = options.center ?? options.pointer;
  if (options.hitBond) {
    const resolved = resolveBondPlacement(template, options);
    if (resolved) return resolved;
  }
  if (options.hitAtom) {
    const resolved = resolveAtomPlacement(template, options);
    if (resolved) return resolved;
  }
  if (!center) {
    throw new Error('Ring template placement requires a center or pointer position.');
  }
  return resolveStandalonePlacement(options.preset, template, center);
}

export function getAtomRingTemplateNativeMetadata(atom: Atom): {
  atomStereo?: RingTemplateAtomStereo;
  geometry?: RingTemplateAtomGeometry;
  bondOrdering?: Array<string | 0>;
} {
  const nativeMembership = atom.ringTemplateMemberships?.find(
    (membership) => membership.nativeStereo,
  );
  if (nativeMembership?.nativeStereo) {
    return {
      atomStereo: nativeMembership.nativeStereo.as,
      geometry: nativeMembership.nativeStereo.geometry,
      bondOrdering: [...nativeMembership.nativeStereo.bondOrdering],
    };
  }
  if (atom.ringTemplateMemberships?.some((membership) => membership.family === CHAIR_FAMILY)) {
    return { atomStereo: DEFAULT_TEMPLATE_STEREO };
  }
  return {};
}

export function sanitizeRingTemplateState<T extends CanvasState>(state: T): T {
  const structures = collectStructureMemberships(state.atoms, state.bonds);
  if (structures.size === 0) return state;

  const componentIdByAtomId = getComponentIdByAtomId(state.atoms, state.bonds);
  const invalidComponentIds = new Set<number>();

  structures.forEach((record) => {
    if (isStructureMembershipValid(record, state.bonds)) return;
    record.atomMemberships.forEach(({ atomId }) => {
      const componentId = componentIdByAtomId.get(atomId);
      if (componentId != null) invalidComponentIds.add(componentId);
    });
    record.bondMemberships.forEach(({ bond }) => {
      const componentId = componentIdByAtomId.get(bond.from);
      if (componentId != null) invalidComponentIds.add(componentId);
      const endComponentId = componentIdByAtomId.get(bond.to);
      if (endComponentId != null) invalidComponentIds.add(endComponentId);
    });
  });

  if (invalidComponentIds.size === 0) return state;

  let changed = false;
  const atoms = state.atoms.map((atom) => {
    const componentId = componentIdByAtomId.get(atom.id);
    if (
      componentId == null ||
      !invalidComponentIds.has(componentId) ||
      !atom.ringTemplateMemberships
    ) {
      return atom;
    }
    changed = true;
    return { ...atom, ringTemplateMemberships: undefined };
  });
  const bonds = state.bonds.map((bond) => {
    const componentId = componentIdByAtomId.get(bond.from);
    if (
      componentId == null ||
      !invalidComponentIds.has(componentId) ||
      !bond.ringTemplateMemberships
    ) {
      return bond;
    }
    changed = true;
    return { ...bond, ringTemplateMemberships: undefined };
  });

  return changed ? ({ ...state, atoms, bonds } as T) : state;
}

export function resolveChairAttachmentSnapping(options: {
  atomId: string;
  atoms: Atom[];
  bonds: Bond[];
  bondLength: number;
  pointer?: { x: number; y: number };
  fallbackAngle?: number;
}): ResolvedChairAttachmentSnapping | null {
  const atomById = new Map(options.atoms.map((atom) => [atom.id, atom]));
  const startAtom = atomById.get(options.atomId);
  if (!startAtom?.ringTemplateMemberships?.length) return null;

  const structures = collectStructureMemberships(options.atoms, options.bonds);
  const rawCandidates: InternalChairAttachmentCandidate[] = [];

  let stableOrder = 0;
  startAtom.ringTemplateMemberships.forEach((membership) => {
    if (membership.family !== CHAIR_FAMILY) return;
    const record = structures.get(membership.structureId);
    if (!record || !isStructureMembershipValid(record, options.bonds)) return;
    const rotation = getStructureRotationRadians(record, atomById);
    if (rotation == null) return;
    const directions =
      RING_TEMPLATES[record.preset].attachmentDirectionsByAtomKey[membership.atomKey];
    if (!directions) return;

    (
      [
        ['equatorial', directions.equatorial],
        ['axial', directions.axial],
      ] as const
    ).forEach(([kind, vector]) => {
      const rotatedVector = rotatePoint(vector, rotation);
      rawCandidates.push({
        kind,
        x: startAtom.x + rotatedVector.x * options.bondLength,
        y: startAtom.y + rotatedVector.y * options.bondLength,
        angle: Math.atan2(rotatedVector.y, rotatedVector.x),
        occupied: false,
        structureIds: [membership.structureId],
        atomKeys: [membership.atomKey],
        stableOrder,
      });
      stableOrder += 1;
    });
  });

  if (rawCandidates.length === 0) return null;

  const dedupedCandidates = dedupeChairAttachmentCandidates(rawCandidates, startAtom, options);
  if (dedupedCandidates.length === 0) return null;

  const selectedCandidate =
    options.pointer &&
    Math.hypot(options.pointer.x - startAtom.x, options.pointer.y - startAtom.y) >
      CHAIR_POINTER_MIN_DISTANCE
      ? selectChairAttachmentCandidate(
          dedupedCandidates,
          Math.atan2(options.pointer.y - startAtom.y, options.pointer.x - startAtom.x),
        )
      : undefined;
  const quickClickCandidate = selectChairQuickClickCandidate(
    dedupedCandidates,
    options.fallbackAngle,
  );
  const candidates = dedupedCandidates.map(toPublicChairAttachmentCandidate);

  return {
    candidates,
    ...(selectedCandidate
      ? { selectedCandidate: toPublicChairAttachmentCandidate(selectedCandidate) }
      : {}),
    ...(quickClickCandidate
      ? { quickClickCandidate: toPublicChairAttachmentCandidate(quickClickCandidate) }
      : {}),
  };
}

function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 1e-6) return { x: 0, y: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function dedupeChairAttachmentCandidates(
  candidates: InternalChairAttachmentCandidate[],
  startAtom: Atom,
  options: { bonds: Bond[]; atoms: Atom[]; bondLength: number },
): InternalChairAttachmentCandidate[] {
  const deduped: InternalChairAttachmentCandidate[] = [];
  const outgoingAngles = getOutgoingNonChairBondAngles(startAtom.id, options.atoms, options.bonds);
  const distanceThreshold = options.bondLength * CHAIR_ATTACHMENT_DEDUPE_DISTANCE_FRACTION;

  candidates.forEach((candidate) => {
    const existingCandidate = deduped.find(
      (entry) =>
        Math.hypot(entry.x - candidate.x, entry.y - candidate.y) <= distanceThreshold ||
        getAbsoluteAngleDifference(entry.angle, candidate.angle) <= CHAIR_ATTACHMENT_DEDUPE_ANGLE,
    );
    if (!existingCandidate) {
      deduped.push({
        ...candidate,
        occupied: outgoingAngles.some(
          (angle) =>
            getAbsoluteAngleDifference(angle, candidate.angle) <= CHAIR_ATTACHMENT_OCCUPANCY_ANGLE,
        ),
      });
      return;
    }

    existingCandidate.kind =
      existingCandidate.kind === 'equatorial' || candidate.kind === 'equatorial'
        ? 'equatorial'
        : 'axial';
    existingCandidate.occupied =
      existingCandidate.occupied ||
      outgoingAngles.some(
        (angle) =>
          getAbsoluteAngleDifference(angle, candidate.angle) <= CHAIR_ATTACHMENT_OCCUPANCY_ANGLE,
      );
    if (!existingCandidate.structureIds.includes(candidate.structureIds[0]!)) {
      existingCandidate.structureIds.push(candidate.structureIds[0]!);
    }
    if (!existingCandidate.atomKeys.includes(candidate.atomKeys[0]!)) {
      existingCandidate.atomKeys.push(candidate.atomKeys[0]!);
    }
    existingCandidate.stableOrder = Math.min(existingCandidate.stableOrder, candidate.stableOrder);
  });

  return deduped.sort((left, right) => {
    if (left.stableOrder !== right.stableOrder) return left.stableOrder - right.stableOrder;
    if (left.kind !== right.kind) return left.kind === 'equatorial' ? -1 : 1;
    return left.angle - right.angle;
  });
}

function getOutgoingNonChairBondAngles(atomId: string, atoms: Atom[], bonds: Bond[]): number[] {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  return bonds
    .filter(
      (bond) =>
        (bond.from === atomId || bond.to === atomId) &&
        !bond.ringTemplateMemberships?.some((membership) => membership.family === CHAIR_FAMILY),
    )
    .map((bond) => {
      const otherId = bond.from === atomId ? bond.to : bond.from;
      const startAtom = atomById.get(atomId);
      const otherAtom = atomById.get(otherId);
      if (!startAtom || !otherAtom) return null;
      return Math.atan2(otherAtom.y - startAtom.y, otherAtom.x - startAtom.x);
    })
    .filter((angle): angle is number => angle != null);
}

function selectChairAttachmentCandidate(
  candidates: InternalChairAttachmentCandidate[],
  pointerAngle: number,
): InternalChairAttachmentCandidate | undefined {
  return [...candidates].sort((left, right) => {
    const leftDifference = getAbsoluteAngleDifference(left.angle, pointerAngle);
    const rightDifference = getAbsoluteAngleDifference(right.angle, pointerAngle);
    if (Math.abs(leftDifference - rightDifference) > 1e-6) return leftDifference - rightDifference;
    if (left.occupied !== right.occupied) return left.occupied ? 1 : -1;
    if (left.kind !== right.kind) return left.kind === 'equatorial' ? -1 : 1;
    return left.stableOrder - right.stableOrder;
  })[0];
}

function selectChairQuickClickCandidate(
  candidates: InternalChairAttachmentCandidate[],
  fallbackAngle?: number,
): InternalChairAttachmentCandidate | undefined {
  const unoccupiedEquatorial = candidates.filter(
    (candidate) => !candidate.occupied && candidate.kind === 'equatorial',
  );
  if (unoccupiedEquatorial.length > 0) {
    return selectCandidateClosestToAngle(unoccupiedEquatorial, fallbackAngle);
  }

  const unoccupiedAxial = candidates.filter(
    (candidate) => !candidate.occupied && candidate.kind === 'axial',
  );
  if (unoccupiedAxial.length > 0) {
    return selectCandidateClosestToAngle(unoccupiedAxial, fallbackAngle);
  }

  return undefined;
}

function selectCandidateClosestToAngle(
  candidates: InternalChairAttachmentCandidate[],
  targetAngle?: number,
): InternalChairAttachmentCandidate | undefined {
  return [...candidates].sort((left, right) => {
    if (targetAngle != null) {
      const leftDifference = getAbsoluteAngleDifference(left.angle, targetAngle);
      const rightDifference = getAbsoluteAngleDifference(right.angle, targetAngle);
      if (Math.abs(leftDifference - rightDifference) > 1e-6) {
        return leftDifference - rightDifference;
      }
    }
    if (left.kind !== right.kind) return left.kind === 'equatorial' ? -1 : 1;
    return left.stableOrder - right.stableOrder;
  })[0];
}

function toPublicChairAttachmentCandidate(
  candidate: InternalChairAttachmentCandidate,
): ChairAttachmentCandidate {
  return {
    kind: candidate.kind,
    x: candidate.x,
    y: candidate.y,
    angle: candidate.angle,
    occupied: candidate.occupied,
    structureIds: [...candidate.structureIds],
    atomKeys: [...candidate.atomKeys],
  };
}

function getStructureRotationRadians(
  record: StructureMembershipRecord,
  atomById: Map<string, Atom>,
): number | null {
  if (!isRingTemplatePreset(record.preset)) return null;
  const template = RING_TEMPLATES[record.preset];
  const templateAtomByKey = new Map(template.atoms.map((atom) => [atom.key, atom]));
  const actualPoints: Array<{ x: number; y: number }> = [];
  const templatePoints: Array<{ x: number; y: number }> = [];

  record.atomMemberships.forEach(({ atomId, membership }) => {
    const actualAtom = atomById.get(atomId);
    const templateAtom = templateAtomByKey.get(membership.atomKey);
    if (!actualAtom || !templateAtom) return;
    actualPoints.push({ x: actualAtom.x, y: actualAtom.y });
    templatePoints.push({ x: templateAtom.x, y: templateAtom.y });
  });

  if (actualPoints.length < 2) return null;

  const actualCentroid = actualPoints.reduce(
    (acc, point) => ({
      x: acc.x + point.x / actualPoints.length,
      y: acc.y + point.y / actualPoints.length,
    }),
    { x: 0, y: 0 },
  );
  const templateCentroid = templatePoints.reduce(
    (acc, point) => ({
      x: acc.x + point.x / templatePoints.length,
      y: acc.y + point.y / templatePoints.length,
    }),
    { x: 0, y: 0 },
  );

  let dot = 0;
  let cross = 0;
  let magnitude = 0;
  for (let index = 0; index < actualPoints.length; index += 1) {
    const actualPoint = actualPoints[index]!;
    const templatePoint = templatePoints[index]!;
    const centeredTemplate = subtractPoints(templatePoint, templateCentroid);
    const centeredActual = subtractPoints(actualPoint, actualCentroid);
    dot += centeredTemplate.x * centeredActual.x + centeredTemplate.y * centeredActual.y;
    cross += centeredTemplate.x * centeredActual.y - centeredTemplate.y * centeredActual.x;
    magnitude +=
      Math.hypot(centeredTemplate.x, centeredTemplate.y) *
      Math.hypot(centeredActual.x, centeredActual.y);
  }

  if (magnitude <= 1e-6) return null;
  return Math.atan2(cross, dot);
}

function getAbsoluteAngleDifference(left: number, right: number): number {
  const difference = normalizeAngle(left - right);
  return Math.abs(difference);
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

function getPreparedTemplate(
  template: RingTemplate,
  bondLength: number,
  rotationSteps: number,
): RingGeometry {
  const scale = bondLength / template.referenceBondLength;
  const scaledAtoms = template.atoms.map((atom) => ({
    ...atom,
    x: atom.x * scale,
    y: atom.y * scale,
  }));
  const normalizedRotationSteps = normalizeRotationSteps(rotationSteps);
  if (normalizedRotationSteps === 0) {
    return {
      atoms: scaledAtoms,
      bonds: template.bonds.map((bond) => ({ ...bond })),
    };
  }
  const centroid = getCentroid(scaledAtoms);
  return {
    atoms: scaledAtoms.map((atom) => rotateAtomAround(atom, centroid, normalizedRotationSteps)),
    bonds: template.bonds.map((bond) => ({ ...bond })),
  };
}

function resolveStandalonePlacement(
  preset: RingTemplatePreset,
  geometry: RingGeometry,
  center: { x: number; y: number },
): ResolvedRingTemplatePlacement {
  const bounds = getGeometryBounds(geometry.atoms);
  const dx = center.x - (bounds.minX + bounds.maxX) / 2;
  const dy = center.y - (bounds.minY + bounds.maxY) / 2;
  return {
    preset,
    atoms: geometry.atoms.map((atom) => ({ ...atom, x: atom.x + dx, y: atom.y + dy })),
    bonds: geometry.bonds.map((bond) => ({ ...bond })),
    mappedAtomIdsByIndex: new Map(),
    mappedBondIdsByIndex: new Map(),
    skippedBondIndices: new Set(),
  };
}

function resolveBondPlacement(
  geometry: RingGeometry,
  options: ResolveRingTemplatePlacementOptions,
): ResolvedRingTemplatePlacement | null {
  const { hitBond, existingAtoms, pointer, preset } = options;
  if (!hitBond) return null;
  const beginAtom = existingAtoms.find((atom) => atom.id === hitBond.from);
  const endAtom = existingAtoms.find((atom) => atom.id === hitBond.to);
  if (!beginAtom || !endAtom) return null;

  const midpoint = {
    x: (beginAtom.x + endAtom.x) / 2,
    y: (beginAtom.y + endAtom.y) / 2,
  };
  const pointerVector = pointer
    ? { x: pointer.x - midpoint.x, y: pointer.y - midpoint.y }
    : { x: 0, y: 0 };

  let bestCandidate:
    | {
        score: number;
        candidateOrder: number;
        atoms: TemplateAtom[];
        mappedAtomIdsByIndex: Map<number, string>;
        mappedBondIdsByIndex: Map<number, string>;
        skippedBondIndex: number;
      }
    | undefined;

  RING_TEMPLATES[preset].bondFusionCandidates.forEach((candidate, candidateOrder) => {
    const templateBond = geometry.bonds[candidate.bondIndex];
    if (!templateBond) return;
    const beginIndex = candidate.reversed ? templateBond.to : templateBond.from;
    const endIndex = candidate.reversed ? templateBond.from : templateBond.to;
    const transformedAtoms = alignPointsToSegment(
      geometry.atoms,
      geometry.atoms[beginIndex]!,
      geometry.atoms[endIndex]!,
      beginAtom,
      endAtom,
    );
    const centroidVector = subtractPoints(getCentroid(transformedAtoms), midpoint);
    const score = getDirectionalAlignmentScore(centroidVector, pointerVector);
    if (
      !bestCandidate ||
      score > bestCandidate.score + 1e-6 ||
      (Math.abs(score - bestCandidate.score) <= 1e-6 &&
        candidateOrder < bestCandidate.candidateOrder)
    ) {
      bestCandidate = {
        score,
        candidateOrder,
        atoms: transformedAtoms,
        mappedAtomIdsByIndex: new Map([
          [beginIndex, beginAtom.id],
          [endIndex, endAtom.id],
        ]),
        mappedBondIdsByIndex: new Map([[candidate.bondIndex, hitBond.id]]),
        skippedBondIndex: candidate.bondIndex,
      };
    }
  });

  if (!bestCandidate) return null;
  return {
    preset,
    atoms: bestCandidate.atoms,
    bonds: geometry.bonds.map((bond) => ({ ...bond })),
    mappedAtomIdsByIndex: bestCandidate.mappedAtomIdsByIndex,
    mappedBondIdsByIndex: bestCandidate.mappedBondIdsByIndex,
    skippedBondIndices: new Set([bestCandidate.skippedBondIndex]),
  };
}

function resolveAtomPlacement(
  geometry: RingGeometry,
  options: ResolveRingTemplatePlacementOptions,
): ResolvedRingTemplatePlacement | null {
  const {
    hitAtom,
    existingAtoms,
    existingBonds,
    pointer,
    preferInterior = false,
    preset,
  } = options;
  if (!hitAtom) return null;

  const desiredAngle =
    pointer && Math.hypot(pointer.x - hitAtom.x, pointer.y - hitAtom.y) > 0.5
      ? Math.atan2(pointer.y - hitAtom.y, pointer.x - hitAtom.x)
      : getPreferredAttachmentAngle(hitAtom, existingAtoms, existingBonds, preferInterior);
  const desiredVector = { x: Math.cos(desiredAngle), y: Math.sin(desiredAngle) };

  let bestCandidate:
    | {
        score: number;
        candidateOrder: number;
        atoms: TemplateAtom[];
        anchorIndex: number;
      }
    | undefined;

  RING_TEMPLATES[preset].atomAttachmentCandidates.forEach((anchorIndex, candidateOrder) => {
    const transformedAtoms = translatePointsToAnchor(
      geometry.atoms,
      geometry.atoms[anchorIndex]!,
      hitAtom,
    );
    const attachmentVector = getAttachmentVector(transformedAtoms, geometry.bonds, anchorIndex);
    const score = getDirectionalAlignmentScore(attachmentVector, desiredVector);
    if (
      !bestCandidate ||
      score > bestCandidate.score + 1e-6 ||
      (Math.abs(score - bestCandidate.score) <= 1e-6 &&
        candidateOrder < bestCandidate.candidateOrder)
    ) {
      bestCandidate = {
        score,
        candidateOrder,
        atoms: transformedAtoms,
        anchorIndex,
      };
    }
  });

  if (!bestCandidate) return null;
  return {
    preset,
    atoms: bestCandidate.atoms,
    bonds: geometry.bonds.map((bond) => ({ ...bond })),
    mappedAtomIdsByIndex: new Map([[bestCandidate.anchorIndex, hitAtom.id]]),
    mappedBondIdsByIndex: new Map(),
    skippedBondIndices: new Set(),
  };
}

function applyFusionStereoMetadata(options: {
  template: RingTemplate;
  placement: ResolvedRingTemplatePlacement;
  structureId: string;
  sharedBondIndex: number;
  atoms: Atom[];
  bonds: Bond[];
  atomIndexById: Map<string, number>;
  bondIndexById: Map<string, number>;
  atomIdByTemplateIndex: Map<number, string>;
  bondIdByTemplateIndex: Map<number, string>;
}) {
  const {
    template,
    structureId,
    sharedBondIndex,
    atoms,
    bonds,
    atomIndexById,
    bondIndexById,
    atomIdByTemplateIndex,
    bondIdByTemplateIndex,
  } = options;
  const sharedBondId = bondIdByTemplateIndex.get(sharedBondIndex);
  const templateBond = template.bonds[sharedBondIndex];
  if (!sharedBondId || !templateBond) return;

  const sharedBond = bonds[bondIndexById.get(sharedBondId) ?? -1];
  const existingStructureMembership = sharedBond?.ringTemplateMemberships?.find(
    (membership) => membership.structureId !== structureId && membership.family === CHAIR_FAMILY,
  );
  if (!sharedBond || !existingStructureMembership) return;

  const endpoints = [
    {
      templateAtomIndex: templateBond.from,
      pattern: template.fusionStereoByEndpoint.from,
    },
    {
      templateAtomIndex: templateBond.to,
      pattern: template.fusionStereoByEndpoint.to,
    },
  ] as const;

  const resolvedStereo = endpoints.map(({ templateAtomIndex, pattern }) => {
    const atomId = atomIdByTemplateIndex.get(templateAtomIndex);
    if (!atomId) return null;
    const existingAdjacentBondId = findAdjacentBondIdForStructure(
      bonds,
      existingStructureMembership.structureId,
      atomId,
      sharedBondId,
    );
    const newAdjacentBondId = findAdjacentBondIdForStructure(
      bonds,
      structureId,
      atomId,
      sharedBondId,
    );
    if (!existingAdjacentBondId || !newAdjacentBondId) return null;
    return {
      atomId,
      nativeStereo: {
        geometry: TEMPLATE_STEREO_GEOMETRY,
        as: pattern.as,
        bondOrdering: pattern.bondOrderingTemplate.map((token) =>
          resolveBondOrderingToken(token, sharedBondId, existingAdjacentBondId, newAdjacentBondId),
        ),
      } satisfies RingTemplateNativeStereo,
    };
  });

  if (resolvedStereo.some((entry) => entry == null)) return;

  resolvedStereo.forEach((entry) => {
    if (!entry) return;
    const atomIndex = atomIndexById.get(entry.atomId);
    if (atomIndex == null) return;
    const atom = atoms[atomIndex]!;
    atoms[atomIndex] = withStructureNativeStereo(atom, structureId, entry.nativeStereo);
  });
}

function buildAtomMembership(
  structureId: string,
  preset: RingTemplatePreset,
  atomKey: string,
): RingTemplateAtomMembership {
  return {
    structureId,
    family: CHAIR_FAMILY,
    preset,
    atomKey,
  };
}

function buildBondMembership(
  structureId: string,
  preset: RingTemplatePreset,
  bondKey: string,
): RingTemplateBondMembership {
  return {
    structureId,
    family: CHAIR_FAMILY,
    preset,
    bondKey,
  };
}

function appendAtomMembership(
  memberships: RingTemplateAtomMembership[] | undefined,
  membership: RingTemplateAtomMembership,
): RingTemplateAtomMembership[] {
  const cloned = cloneAtomMemberships(memberships);
  cloned.push(membership);
  return cloned;
}

function appendBondMembership(
  memberships: RingTemplateBondMembership[] | undefined,
  membership: RingTemplateBondMembership,
): RingTemplateBondMembership[] {
  const cloned = cloneBondMemberships(memberships);
  cloned.push(membership);
  return cloned;
}

function withStructureNativeStereo(
  atom: Atom,
  structureId: string,
  nativeStereo: RingTemplateNativeStereo,
): Atom {
  return {
    ...atom,
    ringTemplateMemberships: atom.ringTemplateMemberships?.map((membership) =>
      membership.structureId === structureId
        ? {
            ...membership,
            nativeStereo: {
              geometry: nativeStereo.geometry,
              as: nativeStereo.as,
              bondOrdering: [...nativeStereo.bondOrdering],
            },
          }
        : membership,
    ),
  };
}

function findAdjacentBondIdForStructure(
  bonds: Bond[],
  structureId: string,
  atomId: string,
  excludedBondId: string,
): string | undefined {
  return bonds.find(
    (bond) =>
      bond.id !== excludedBondId &&
      (bond.from === atomId || bond.to === atomId) &&
      bond.ringTemplateMemberships?.some((membership) => membership.structureId === structureId),
  )?.id;
}

function resolveBondOrderingToken(
  token: BondOrderingToken,
  sharedBondId: string,
  existingBondId: string,
  newBondId: string,
): string | 0 {
  if (token === 'shared') return sharedBondId;
  if (token === 'existing') return existingBondId;
  if (token === 'new') return newBondId;
  return 0;
}

function collectStructureMemberships(
  atoms: Atom[],
  bonds: Bond[],
): Map<string, StructureMembershipRecord> {
  const records = new Map<string, StructureMembershipRecord>();

  atoms.forEach((atom) => {
    atom.ringTemplateMemberships?.forEach((membership) => {
      const record = records.get(membership.structureId) ?? {
        preset: membership.preset,
        atomMemberships: [],
        bondMemberships: [],
      };
      record.preset = membership.preset;
      record.atomMemberships.push({ atomId: atom.id, membership: cloneAtomMembership(membership) });
      records.set(membership.structureId, record);
    });
  });

  bonds.forEach((bond) => {
    bond.ringTemplateMemberships?.forEach((membership) => {
      const record = records.get(membership.structureId) ?? {
        preset: membership.preset,
        atomMemberships: [],
        bondMemberships: [],
      };
      record.preset = membership.preset;
      record.bondMemberships.push({
        bond: cloneBondWithMemberships(bond),
        membership: { ...membership },
      });
      records.set(membership.structureId, record);
    });
  });

  return records;
}

function isStructureMembershipValid(record: StructureMembershipRecord, bonds: Bond[]): boolean {
  if (!isRingTemplatePreset(record.preset)) return false;
  const template = RING_TEMPLATES[record.preset];
  const atomIdByKey = new Map<string, string>();
  const bondByKey = new Map<string, Bond>();

  if (record.atomMemberships.length !== template.atoms.length) return false;
  if (record.bondMemberships.length !== template.bonds.length) return false;

  for (const { membership, atomId } of record.atomMemberships) {
    if (membership.family !== CHAIR_FAMILY || membership.preset !== record.preset) return false;
    if (!template.atoms.some((atom) => atom.key === membership.atomKey)) return false;
    if (atomIdByKey.has(membership.atomKey)) return false;
    atomIdByKey.set(membership.atomKey, atomId);
    if (
      membership.nativeStereo &&
      membership.nativeStereo.bondOrdering.some(
        (bondId) => bondId !== 0 && !bonds.some((bond) => bond.id === bondId),
      )
    ) {
      return false;
    }
  }

  for (const { membership, bond } of record.bondMemberships) {
    if (membership.family !== CHAIR_FAMILY || membership.preset !== record.preset) return false;
    if (!template.bonds.some((templateBond) => templateBond.key === membership.bondKey))
      return false;
    if (bondByKey.has(membership.bondKey)) return false;
    bondByKey.set(membership.bondKey, bond);
  }

  for (const templateBond of template.bonds) {
    const bond = bondByKey.get(templateBond.key);
    const fromId = atomIdByKey.get(template.atoms[templateBond.from]!.key);
    const toId = atomIdByKey.get(template.atoms[templateBond.to]!.key);
    if (!bond || !fromId || !toId) return false;
    if (bond.order !== templateBond.order) return false;
    const matchesEndpoints =
      (bond.from === fromId && bond.to === toId) || (bond.from === toId && bond.to === fromId);
    if (!matchesEndpoints) return false;
  }

  return true;
}

function getComponentIdByAtomId(atoms: Atom[], bonds: Bond[]): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  atoms.forEach((atom) => {
    adjacency.set(atom.id, new Set());
  });
  bonds.forEach((bond) => {
    adjacency.get(bond.from)?.add(bond.to);
    adjacency.get(bond.to)?.add(bond.from);
  });

  const componentIdByAtomId = new Map<string, number>();
  let nextComponentId = 0;
  atoms.forEach((atom) => {
    if (componentIdByAtomId.has(atom.id)) return;
    const queue = [atom.id];
    componentIdByAtomId.set(atom.id, nextComponentId);
    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index]!;
      adjacency.get(currentId)?.forEach((neighborId) => {
        if (componentIdByAtomId.has(neighborId)) return;
        componentIdByAtomId.set(neighborId, nextComponentId);
        queue.push(neighborId);
      });
    }
    nextComponentId += 1;
  });
  return componentIdByAtomId;
}

function cloneAtomWithMemberships(atom: Atom): Atom {
  return {
    ...atom,
    ringTemplateMemberships: cloneAtomMemberships(atom.ringTemplateMemberships),
  };
}

function cloneBondWithMemberships(bond: Bond): Bond {
  return {
    ...bond,
    ringTemplateMemberships: cloneBondMemberships(bond.ringTemplateMemberships),
  };
}

function cloneAtomMemberships(
  memberships: RingTemplateAtomMembership[] | undefined,
): RingTemplateAtomMembership[] {
  return memberships?.map(cloneAtomMembership) ?? [];
}

function cloneAtomMembership(membership: RingTemplateAtomMembership): RingTemplateAtomMembership {
  return {
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
  };
}

function cloneBondMemberships(
  memberships: RingTemplateBondMembership[] | undefined,
): RingTemplateBondMembership[] {
  return memberships?.map((membership) => ({ ...membership })) ?? [];
}

function rotateAtomAround(
  atom: TemplateAtom,
  center: { x: number; y: number },
  rotationSteps: number,
): TemplateAtom {
  const angle = rotationSteps * ROTATION_STEP_RADIANS;
  const dx = atom.x - center.x;
  const dy = atom.y - center.y;
  return {
    ...atom,
    x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function translatePointsToAnchor(
  atoms: TemplateAtom[],
  anchor: TemplateAtom,
  target: { x: number; y: number },
): TemplateAtom[] {
  const translation = {
    x: target.x - anchor.x,
    y: target.y - anchor.y,
  };
  return atoms.map((atom) => ({
    ...atom,
    x: atom.x + translation.x,
    y: atom.y + translation.y,
  }));
}

function alignPointsToSegment(
  atoms: TemplateAtom[],
  templateBegin: TemplateAtom,
  templateEnd: TemplateAtom,
  targetBegin: { x: number; y: number },
  targetEnd: { x: number; y: number },
): TemplateAtom[] {
  const targetAngle = Math.atan2(targetEnd.y - targetBegin.y, targetEnd.x - targetBegin.x);
  const templateAngle = Math.atan2(
    templateEnd.y - templateBegin.y,
    templateEnd.x - templateBegin.x,
  );
  const rotation = targetAngle - templateAngle;
  const rotatedBegin = rotatePoint(templateBegin, rotation);
  const translation = {
    x: targetBegin.x - rotatedBegin.x,
    y: targetBegin.y - rotatedBegin.y,
  };
  return atoms.map((atom) => {
    const rotated = rotatePoint(atom, rotation);
    return {
      ...atom,
      x: rotated.x + translation.x,
      y: rotated.y + translation.y,
    };
  });
}

function rotatePoint(point: { x: number; y: number }, rotation: number): { x: number; y: number } {
  return {
    x: point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
    y: point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
  };
}

function getAttachmentVector(
  atoms: TemplateAtom[],
  bonds: TemplateBond[],
  anchorIndex: number,
): { x: number; y: number } {
  const anchor = atoms[anchorIndex]!;
  const neighborPositions = bonds
    .filter((bond) => bond.from === anchorIndex || bond.to === anchorIndex)
    .map((bond) => atoms[bond.from === anchorIndex ? bond.to : bond.from]!)
    .filter(Boolean);

  if (neighborPositions.length === 0) {
    const centroid = getCentroid(atoms);
    return { x: anchor.x - centroid.x, y: anchor.y - centroid.y };
  }

  const averageNeighbor = neighborPositions.reduce(
    (acc, atom) => ({
      x: acc.x + atom.x / neighborPositions.length,
      y: acc.y + atom.y / neighborPositions.length,
    }),
    { x: 0, y: 0 },
  );
  return {
    x: anchor.x - averageNeighbor.x,
    y: anchor.y - averageNeighbor.y,
  };
}

function normalizeRotationSteps(rotationSteps: number): number {
  const normalized = rotationSteps % 6;
  return normalized < 0 ? normalized + 6 : normalized;
}

const SNAP_ANGLE = Math.PI / 12; // 15° snap grid

function snapToGrid(angle: number): number {
  return Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
}

export function getPreferredAttachmentAngle(
  hitAtom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  preferInterior: boolean,
): number {
  const neighbors = bonds.filter((bond) => bond.from === hitAtom.id || bond.to === hitAtom.id);
  if (neighbors.length === 0) return -Math.PI / 6;
  if (neighbors.length === 1) {
    const onlyBond = neighbors[0]!;
    const otherAtom = atoms.find(
      (atom) => atom.id === (onlyBond.from === hitAtom.id ? onlyBond.to : onlyBond.from),
    );
    if (!otherAtom) return -Math.PI / 6;
    return snapToGrid(Math.atan2(hitAtom.y - otherAtom.y, hitAtom.x - otherAtom.x) + Math.PI / 3);
  }

  const angles = neighbors
    .map((bond) => {
      const otherId = bond.from === hitAtom.id ? bond.to : bond.from;
      const otherAtom = atoms.find((atom) => atom.id === otherId);
      return otherAtom ? Math.atan2(otherAtom.y - hitAtom.y, otherAtom.x - hitAtom.x) : 0;
    })
    .sort((a, b) => a - b);

  let maxGap = 0;
  let maxAngle = -Math.PI / 6;
  let minGap = Number.POSITIVE_INFINITY;
  let minAngle = -Math.PI / 6;
  for (let index = 0; index < angles.length; index += 1) {
    const first = angles[index]!;
    const second = angles[(index + 1) % angles.length]!;
    let gap = second - first;
    if (gap <= 0) gap += Math.PI * 2;
    const mid = first + gap / 2;
    if (gap > maxGap) {
      maxGap = gap;
      maxAngle = mid;
    }
    if (gap < minGap) {
      minGap = gap;
      minAngle = mid;
    }
  }
  return snapToGrid(preferInterior ? minAngle : maxAngle);
}

function getDirectionalAlignmentScore(
  vector: { x: number; y: number },
  target: { x: number; y: number },
): number {
  const vectorLength = Math.hypot(vector.x, vector.y);
  const targetLength = Math.hypot(target.x, target.y);
  if (vectorLength <= 1e-6 || targetLength <= 1e-6) return 0;
  return (vector.x * target.x + vector.y * target.y) / (vectorLength * targetLength);
}

function getCentroid(atoms: TemplateAtom[]): { x: number; y: number } {
  const sum = atoms.reduce(
    (acc, atom) => {
      acc.x += atom.x;
      acc.y += atom.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  return {
    x: sum.x / atoms.length,
    y: sum.y / atoms.length,
  };
}

function getGeometryBounds(atoms: TemplateAtom[]) {
  return atoms.reduce(
    (acc, atom) => ({
      minX: Math.min(acc.minX, atom.x),
      minY: Math.min(acc.minY, atom.y),
      maxX: Math.max(acc.maxX, atom.x),
      maxY: Math.max(acc.maxY, atom.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function subtractPoints(
  left: { x: number; y: number },
  right: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
  };
}
