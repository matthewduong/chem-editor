import type {
  ViewerOrbitalBasis,
  ViewerOrbitalMaterial,
  ViewerOrbitalPreferences,
} from '../types/settings';

export interface Viewer3DAtom {
  x: number;
  y: number;
  z: number;
  element: string;
  atomMapNum?: number;
}

export interface Viewer3DBond {
  a1: number;
  a2: number;
  order: number;
}

export interface Viewer3DMolecule {
  atoms: Viewer3DAtom[];
  bonds: Viewer3DBond[];
  energy?: number;
  delta_e?: number;
}

export interface ViewerOrbitalMetadata {
  key: string;
  label: string;
  moIndex: number;
  occupation: number;
  energyHartree: number;
  energyEv: number;
}

export interface ViewerOrbitalMesh {
  key: string;
  positivePositions: number[];
  negativePositions: number[];
}

export interface ViewerOrbitalGrid {
  origin: [number, number, number];
  spacing: number;
  dims: [number, number, number];
}

export interface ViewerOrbitalField {
  key: string;
  values: number[];
  minValue: number;
  maxValue: number;
}

export interface ViewerOrbitalResult {
  basis: ViewerOrbitalBasis;
  orbitals: ViewerOrbitalMetadata[];
  grid: ViewerOrbitalGrid;
  fields: Record<string, ViewerOrbitalField>;
  warnings?: string[];
}

export interface ViewerOrbitalAppearance extends ViewerOrbitalPreferences {
  material: ViewerOrbitalMaterial;
}

export type ViewerRepresentation = 'ball+stick' | 'spacefill' | 'surface' | 'licorice';

export const VIEWER_DEFAULT_BACKGROUND_LIGHT = '#f5f5f5';
export const VIEWER_DEFAULT_BACKGROUND_DARK = '#1e1e1e';

const VIEWER_DEFAULT_ATOM_RADIUS = 0.3;
const VIEWER_ATOM_RADIUS_SCALE: Record<string, number> = {
  H: 0.62,
  C: 1,
  N: 0.98,
  O: 0.95,
  F: 0.93,
  P: 1.06,
  S: 1.07,
  Cl: 1.08,
  Br: 1.12,
  I: 1.18,
};

export function normalizeViewerElementSymbol(element: string): string {
  const trimmed = element.trim();
  if (!trimmed) return 'C';
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

export function viewer3dAtomRadius(element: string) {
  return VIEWER_DEFAULT_ATOM_RADIUS * (VIEWER_ATOM_RADIUS_SCALE[element] ?? 1);
}

export function resolveViewerBackgroundColor(
  backgroundColor: string | undefined,
  isDarkMode: boolean,
) {
  const themeDefault = isDarkMode
    ? VIEWER_DEFAULT_BACKGROUND_DARK
    : VIEWER_DEFAULT_BACKGROUND_LIGHT;
  if (typeof backgroundColor !== 'string' || !backgroundColor.trim()) return themeDefault;
  const normalized = backgroundColor.trim().toLowerCase();
  if (
    normalized === VIEWER_DEFAULT_BACKGROUND_LIGHT ||
    normalized === VIEWER_DEFAULT_BACKGROUND_DARK
  ) {
    return themeDefault;
  }
  return backgroundColor.trim();
}

export function orientViewerMoleculeForDisplay(
  molecule: Viewer3DMolecule | null,
): Viewer3DMolecule | null {
  if (!molecule || molecule.atoms.length < 2) return molecule;

  const focusIndices = molecule.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => atom.element !== 'H')
    .map(({ index }) => index);
  if (focusIndices.length <= 2) return molecule;
  const workingIndices =
    focusIndices.length >= 2 ? focusIndices : molecule.atoms.map((_, index) => index);

  let pair: [number, number] | null = null;
  let maxDistanceSq = -1;
  for (let i = 0; i < workingIndices.length; i += 1) {
    for (let j = i + 1; j < workingIndices.length; j += 1) {
      const a = molecule.atoms[workingIndices[i]];
      const b = molecule.atoms[workingIndices[j]];
      const distanceSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq;
        pair = [workingIndices[i], workingIndices[j]];
      }
    }
  }
  if (!pair) return molecule;

  const center = scaleVec(centroid(molecule.atoms), 1 / molecule.atoms.length);

  const primaryStart = subtractVec(molecule.atoms[pair[0]], center);
  const primaryEnd = subtractVec(molecule.atoms[pair[1]], center);
  const primaryAxis = normalizeVec(subtractVec(primaryEnd, primaryStart));
  if (Math.hypot(primaryAxis.x, primaryAxis.y, primaryAxis.z) <= 1e-8) return molecule;

  const alignPrimary = quaternionFromUnitVectors(primaryAxis, { x: 1, y: 0, z: 0 });
  let secondaryIndex = workingIndices[0];
  let secondaryDistance = -1;
  for (const index of molecule.atoms.map((_, atomIndex) => atomIndex)) {
    const atom = molecule.atoms[index];
    const position = applyQuaternion(subtractVec(atom, center), alignPrimary);
    const radialDistance = Math.hypot(position.y, position.z);
    if (radialDistance > secondaryDistance) {
      secondaryDistance = radialDistance;
      secondaryIndex = index;
    }
  }

  const secondaryPosition = applyQuaternion(
    subtractVec(molecule.atoms[secondaryIndex], center),
    alignPrimary,
  );
  const flattenSecondary = quaternionFromAxisAngle(
    { x: 1, y: 0, z: 0 },
    -Math.atan2(secondaryPosition.z, secondaryPosition.y || 1e-8),
  );
  const revealRotation = multiplyQuaternions(
    quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5),
    quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.32),
  );
  const transform = multiplyQuaternions(
    revealRotation,
    multiplyQuaternions(flattenSecondary, alignPrimary),
  );

  return {
    ...molecule,
    atoms: molecule.atoms.map((atom) => {
      const position = applyQuaternion(subtractVec(atom, center), transform);
      return { ...atom, x: position.x, y: position.y, z: position.z };
    }),
  };
}

export function viewer3DMoleculeFromMolblock(molblock: string): Viewer3DMolecule | null {
  if (!molblock.trim()) return null;
  const lines = molblock.split('\n');
  const countsLine = lines[3];
  if (!countsLine || countsLine.length < 6) return null;

  const atomCount = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  const bondCount = Number.parseInt(countsLine.slice(3, 6).trim(), 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount <= 0) return null;

  const atoms: Viewer3DAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 4];
    if (!line || line.length < 34) return null;
    const x = Number.parseFloat(line.slice(0, 10).trim());
    const y = Number.parseFloat(line.slice(10, 20).trim());
    const z = Number.parseFloat(line.slice(20, 30).trim());
    const element = normalizeViewerElementSymbol(line.slice(31, 34));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !element) return null;
    atoms.push({ x, y, z, element });
  }

  const bonds: Viewer3DBond[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[atomCount + index + 4];
    if (!line || line.length < 9) return null;
    const a1 = Number.parseInt(line.slice(0, 3).trim(), 10) - 1;
    const a2 = Number.parseInt(line.slice(3, 6).trim(), 10) - 1;
    const order = Number.parseFloat(line.slice(6, 9).trim()) || 1;
    if (a1 < 0 || a2 < 0 || a1 >= atomCount || a2 >= atomCount) continue;
    bonds.push({ a1, a2, order });
  }

  return { atoms, bonds };
}

export function viewer3DFormalChargeFromMolblock(molblock: string): number | null {
  if (!molblock.trim()) return null;
  const lines = molblock.split('\n');
  const countsLine = lines[3];
  if (!countsLine || countsLine.length < 6) return null;

  const atomCount = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  if (!Number.isFinite(atomCount) || atomCount < 0) return null;

  const charges = new Array<number>(atomCount).fill(0);
  for (const line of lines.slice(4 + atomCount)) {
    if (!line.startsWith('M  CHG')) continue;
    const count = Number.parseInt(line.slice(6, 9).trim(), 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    for (let index = 0; index < count; index += 1) {
      const cursor = 10 + index * 8;
      const atomIndex = Number.parseInt(line.slice(cursor, cursor + 4).trim(), 10) - 1;
      const charge = Number.parseInt(line.slice(cursor + 4, cursor + 8).trim(), 10);
      if (
        Number.isFinite(atomIndex) &&
        atomIndex >= 0 &&
        atomIndex < charges.length &&
        Number.isFinite(charge)
      ) {
        charges[atomIndex] = charge;
      }
    }
  }

  return charges.reduce((sum, charge) => sum + charge, 0);
}

export interface Viewer3DVec3 {
  x: number;
  y: number;
  z: number;
  serial?: number;
}

export type Viewer3DMeasureMode = 'none' | 'distance' | 'angle' | 'dihedral';

export function viewer3dDistance(a: Viewer3DVec3, b: Viewer3DVec3) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
}

export function viewer3dCross(a: Viewer3DVec3, b: Viewer3DVec3): Viewer3DVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function viewer3dDot(a: Viewer3DVec3, b: Viewer3DVec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function viewer3dNorm(v: Viewer3DVec3): Viewer3DVec3 {
  const magnitude = Math.sqrt(viewer3dDot(v, v));
  return { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude };
}

export function viewer3dSub(a: Viewer3DVec3, b: Viewer3DVec3): Viewer3DVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function viewer3dAngle(a: Viewer3DVec3, b: Viewer3DVec3, c: Viewer3DVec3) {
  const v1 = viewer3dSub(a, b);
  const v2 = viewer3dSub(c, b);
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          viewer3dDot(v1, v2) /
            (viewer3dDistance({ x: 0, y: 0, z: 0 }, v1) *
              viewer3dDistance({ x: 0, y: 0, z: 0 }, v2)),
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}

export function viewer3dDihedral(
  a: Viewer3DVec3,
  b: Viewer3DVec3,
  c: Viewer3DVec3,
  d: Viewer3DVec3,
) {
  const b1 = viewer3dSub(b, a);
  const b2 = viewer3dSub(c, b);
  const b3 = viewer3dSub(d, c);
  const n1 = viewer3dCross(b1, b2);
  const n2 = viewer3dCross(b2, b3);
  const m1 = viewer3dCross(n1, viewer3dNorm(b2));
  return (Math.atan2(viewer3dDot(m1, n2), viewer3dDot(n1, n2)) * 180) / Math.PI;
}

export function viewer3dVisualBounds(atoms: Viewer3DAtom[], atomScale = 1, extraRadius = 0) {
  if (atoms.length === 0) {
    return {
      center: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 },
      radius: 1,
    };
  }

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const atom of atoms) {
    const radius = viewer3dAtomRadius(atom.element) * atomScale + extraRadius;
    min.x = Math.min(min.x, atom.x - radius);
    min.y = Math.min(min.y, atom.y - radius);
    min.z = Math.min(min.z, atom.z - radius);
    max.x = Math.max(max.x, atom.x + radius);
    max.y = Math.max(max.y, atom.y + radius);
    max.z = Math.max(max.z, atom.z + radius);
  }

  const size = {
    x: Math.max(1e-6, max.x - min.x),
    y: Math.max(1e-6, max.y - min.y),
    z: Math.max(1e-6, max.z - min.z),
  };
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  let radius = 0;
  for (const atom of atoms) {
    const atomRadius = viewer3dAtomRadius(atom.element) * atomScale + extraRadius;
    radius = Math.max(radius, viewer3dDistance(atom, center) + atomRadius);
  }
  return {
    center,
    size,
    radius: Math.max(radius, 1e-6),
  };
}

export function viewer3dFitDistance(
  radius: number,
  fovDegrees: number,
  aspect = 1,
  padding = 1.18,
) {
  const safeRadius = Math.max(radius, 1e-6);
  const verticalHalfAngle = (Math.max(1, fovDegrees) * Math.PI) / 360;
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * Math.max(aspect, 0.1));
  const limitingHalfAngle = Math.max(
    1e-3,
    Math.min(verticalHalfAngle, horizontalHalfAngle || verticalHalfAngle),
  );
  return (safeRadius / Math.tan(limitingHalfAngle)) * padding;
}

function topologyBondKey(bond: Viewer3DBond) {
  const a1 = Math.min(bond.a1, bond.a2);
  const a2 = Math.max(bond.a1, bond.a2);
  return `${a1}:${a2}:${Math.round(bond.order)}`;
}

export function viewer3dHasMatchingTopology(
  reference: Viewer3DMolecule | null,
  candidate: Viewer3DMolecule | null,
) {
  if (!reference || !candidate) return false;
  if (reference.atoms.length !== candidate.atoms.length) return false;
  if (reference.bonds.length !== candidate.bonds.length) return false;
  for (let index = 0; index < reference.atoms.length; index += 1) {
    if (
      normalizeViewerElementSymbol(reference.atoms[index].element) !==
      normalizeViewerElementSymbol(candidate.atoms[index].element)
    ) {
      return false;
    }
  }
  const referenceBonds = reference.bonds.map(topologyBondKey).sort();
  const candidateBonds = candidate.bonds.map(topologyBondKey).sort();
  for (let index = 0; index < referenceBonds.length; index += 1) {
    if (referenceBonds[index] !== candidateBonds[index]) return false;
  }
  return true;
}

interface Viewer3DMatrix3 {
  0: [number, number, number];
  1: [number, number, number];
  2: [number, number, number];
}

function centroid(atoms: Viewer3DAtom[]) {
  return atoms.reduce(
    (sum, atom) => ({
      x: sum.x + atom.x,
      y: sum.y + atom.y,
      z: sum.z + atom.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

function subtractVec(a: Viewer3DVec3, b: Viewer3DVec3): Viewer3DVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addVec(a: Viewer3DVec3, b: Viewer3DVec3): Viewer3DVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec(v: Viewer3DVec3, scalar: number): Viewer3DVec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

type ViewerQuaternion = [number, number, number, number];

function normalizeVec(v: Viewer3DVec3): Viewer3DVec3 {
  const magnitude = Math.hypot(v.x, v.y, v.z);
  if (magnitude <= 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude };
}

function quaternionFromAxisAngle(axis: Viewer3DVec3, angle: number): ViewerQuaternion {
  const normalizedAxis = normalizeVec(axis);
  const halfAngle = angle / 2;
  const sinHalf = Math.sin(halfAngle);
  return normalizeQuaternion([
    Math.cos(halfAngle),
    normalizedAxis.x * sinHalf,
    normalizedAxis.y * sinHalf,
    normalizedAxis.z * sinHalf,
  ]);
}

function quaternionFromUnitVectors(from: Viewer3DVec3, to: Viewer3DVec3): ViewerQuaternion {
  const normalizedFrom = normalizeVec(from);
  const normalizedTo = normalizeVec(to);
  const dot = viewer3dDot(normalizedFrom, normalizedTo);
  if (dot > 0.999999) return [1, 0, 0, 0];
  if (dot < -0.999999) {
    const axis =
      Math.abs(normalizedFrom.x) < 0.1
        ? viewer3dCross(normalizedFrom, { x: 1, y: 0, z: 0 })
        : viewer3dCross(normalizedFrom, { x: 0, y: 1, z: 0 });
    return quaternionFromAxisAngle(axis, Math.PI);
  }
  const cross = viewer3dCross(normalizedFrom, normalizedTo);
  return normalizeQuaternion([1 + dot, cross.x, cross.y, cross.z]);
}

function multiplyQuaternions(a: ViewerQuaternion, b: ViewerQuaternion): ViewerQuaternion {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return normalizeQuaternion([
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ]);
}

function applyQuaternion(vector: Viewer3DVec3, quaternion: ViewerQuaternion): Viewer3DVec3 {
  const [w, x, y, z] = normalizeQuaternion(quaternion);
  const uv = viewer3dCross({ x, y, z }, vector);
  const uuv = viewer3dCross({ x, y, z }, uv);
  return addVec(vector, addVec(scaleVec(uv, 2 * w), scaleVec(uuv, 2)));
}

function multiplyMatrix3Vector(matrix: Viewer3DMatrix3, vector: Viewer3DVec3): Viewer3DVec3 {
  return {
    x: matrix[0][0] * vector.x + matrix[0][1] * vector.y + matrix[0][2] * vector.z,
    y: matrix[1][0] * vector.x + matrix[1][1] * vector.y + matrix[1][2] * vector.z,
    z: matrix[2][0] * vector.x + matrix[2][1] * vector.y + matrix[2][2] * vector.z,
  };
}

function normalizeQuaternion(
  quaternion: [number, number, number, number],
): [number, number, number, number] {
  const magnitude = Math.hypot(...quaternion);
  if (magnitude <= 1e-12) return [1, 0, 0, 0];
  return quaternion.map((value) => value / magnitude) as [number, number, number, number];
}

function transposeMatrix3(matrix: Viewer3DMatrix3): Viewer3DMatrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function distanceSq(a: Viewer3DVec3, b: Viewer3DVec3) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function orthogonalVector(axis: Viewer3DVec3) {
  const reference = Math.abs(axis.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalizeVec(viewer3dCross(axis, reference));
}

function distanceToLine(point: Viewer3DVec3, start: Viewer3DVec3, end: Viewer3DVec3) {
  const axis = subtractVec(end, start);
  const axisLengthSq = viewer3dDot(axis, axis);
  if (axisLengthSq <= 1e-10) return viewer3dDistance(point, start);
  const relative = subtractVec(point, start);
  const projectionScale = viewer3dDot(relative, axis) / axisLengthSq;
  const closest = addVec(start, scaleVec(axis, projectionScale));
  return viewer3dDistance(point, closest);
}

function findAlignmentAnchorIndices(molecule: Viewer3DMolecule) {
  if (molecule.atoms.length <= 1) return [0, 0, null] as const;
  const center = scaleVec(centroid(molecule.atoms), 1 / molecule.atoms.length);
  let anchorA = 0;
  let maxDistanceFromCenter = -1;
  for (let index = 0; index < molecule.atoms.length; index += 1) {
    const distance = distanceSq(molecule.atoms[index], center);
    if (distance > maxDistanceFromCenter) {
      maxDistanceFromCenter = distance;
      anchorA = index;
    }
  }

  let anchorB = anchorA === 0 ? 1 : 0;
  let maxDistanceFromA = -1;
  for (let index = 0; index < molecule.atoms.length; index += 1) {
    if (index === anchorA) continue;
    const distance = distanceSq(molecule.atoms[index], molecule.atoms[anchorA]);
    if (distance > maxDistanceFromA) {
      maxDistanceFromA = distance;
      anchorB = index;
    }
  }

  let anchorC: number | null = null;
  let maxLineDistance = -1;
  for (let index = 0; index < molecule.atoms.length; index += 1) {
    if (index === anchorA || index === anchorB) continue;
    const lineDistance = distanceToLine(
      molecule.atoms[index],
      molecule.atoms[anchorA],
      molecule.atoms[anchorB],
    );
    if (lineDistance > maxLineDistance) {
      maxLineDistance = lineDistance;
      anchorC = index;
    }
  }
  return [anchorA, anchorB, anchorC] as const;
}

function buildAlignmentBasis(
  molecule: Viewer3DMolecule,
  anchorA: number,
  anchorB: number,
  anchorC: number | null,
): Viewer3DMatrix3 {
  const axisX = normalizeVec(subtractVec(molecule.atoms[anchorB], molecule.atoms[anchorA]));
  const safeAxisX = Math.hypot(axisX.x, axisX.y, axisX.z) <= 1e-10 ? { x: 1, y: 0, z: 0 } : axisX;
  const ySeed =
    anchorC != null
      ? subtractVec(molecule.atoms[anchorC], molecule.atoms[anchorA])
      : orthogonalVector(safeAxisX);
  const projectedYSeed = subtractVec(ySeed, scaleVec(safeAxisX, viewer3dDot(ySeed, safeAxisX)));
  const axisY = normalizeVec(projectedYSeed);
  const safeAxisY =
    Math.hypot(axisY.x, axisY.y, axisY.z) <= 1e-10 ? orthogonalVector(safeAxisX) : axisY;
  const axisZ = normalizeVec(viewer3dCross(safeAxisX, safeAxisY));
  const safeAxisZ =
    Math.hypot(axisZ.x, axisZ.y, axisZ.z) <= 1e-10
      ? normalizeVec(viewer3dCross(safeAxisX, orthogonalVector(safeAxisX)))
      : axisZ;
  const orthogonalY = normalizeVec(viewer3dCross(safeAxisZ, safeAxisX));

  return [
    [safeAxisX.x, orthogonalY.x, safeAxisZ.x],
    [safeAxisX.y, orthogonalY.y, safeAxisZ.y],
    [safeAxisX.z, orthogonalY.z, safeAxisZ.z],
  ];
}

export function alignViewerMoleculeToReference(
  reference: Viewer3DMolecule,
  candidate: Viewer3DMolecule,
) {
  if (!viewer3dHasMatchingTopology(reference, candidate)) return candidate;
  if (candidate.atoms.length === 0) return candidate;

  const referenceCentroid = scaleVec(centroid(reference.atoms), 1 / reference.atoms.length);
  const candidateCentroid = scaleVec(centroid(candidate.atoms), 1 / candidate.atoms.length);

  if (candidate.atoms.length === 1) {
    return {
      ...candidate,
      atoms: candidate.atoms.map((atom) => ({
        ...atom,
        x: atom.x - candidateCentroid.x + referenceCentroid.x,
        y: atom.y - candidateCentroid.y + referenceCentroid.y,
        z: atom.z - candidateCentroid.z + referenceCentroid.z,
      })),
    };
  }

  const [anchorA, anchorB, anchorC] = findAlignmentAnchorIndices(reference);
  const referenceBasis = buildAlignmentBasis(reference, anchorA, anchorB, anchorC);
  const candidateBasis = buildAlignmentBasis(candidate, anchorA, anchorB, anchorC);
  const candidateToLocal = transposeMatrix3(candidateBasis);
  return {
    ...candidate,
    atoms: candidate.atoms.map((atom, index) => {
      const centeredAtom = subtractVec(candidate.atoms[index], candidateCentroid);
      const local = multiplyMatrix3Vector(candidateToLocal, centeredAtom);
      const aligned = addVec(multiplyMatrix3Vector(referenceBasis, local), referenceCentroid);
      return {
        ...atom,
        x: aligned.x,
        y: aligned.y,
        z: aligned.z,
      };
    }),
  };
}

export function alignViewerConformerSeries(conformers: Viewer3DMolecule[]) {
  if (conformers.length === 0) return [];
  const aligned: Viewer3DMolecule[] = [];
  for (const conformer of conformers) {
    if (aligned.length === 0) {
      aligned.push(orientViewerMoleculeForDisplay(conformer) ?? conformer);
      continue;
    }
    aligned.push(alignViewerMoleculeToReference(aligned[aligned.length - 1], conformer));
  }
  return aligned;
}
