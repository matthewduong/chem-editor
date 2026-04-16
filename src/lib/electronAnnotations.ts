import type { Atom, Bond, ElectronToolMode } from '../types/chemistry';
import { getAtomLeadElement } from './atomIdentity';

const VALENCE_ELECTRON_COUNTS: Record<string, number> = {
  H: 1,
  D: 1,
  B: 3,
  C: 4,
  N: 5,
  O: 6,
  F: 7,
  Si: 4,
  P: 5,
  S: 6,
  Cl: 7,
  Br: 7,
  I: 7,
};

const MAX_ELECTRON_DECORATION_SLOTS = 4;
const DEFAULT_ELECTRON_MARKER_ANGLES = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;

export interface AtomElectronAnnotations {
  lonePairs: number;
  radicalElectrons: number;
}

export interface AtomElectronMarkerPlacement {
  kind: 'lone-pair' | 'radical';
}

export interface AtomElectronMarkerDot {
  x: number;
  y: number;
}

export interface AtomElectronMarkerGeometry {
  kind: 'lone-pair' | 'radical';
  index: number;
  angle: number;
  center: AtomElectronMarkerDot;
  dots: AtomElectronMarkerDot[];
}

export interface AtomElectronToolResult {
  atom: Atom;
  changed: boolean;
  message?: string;
}

function normalizeCount(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  let normalized = angle % tau;
  if (normalized <= -Math.PI) normalized += tau;
  if (normalized > Math.PI) normalized -= tau;
  return normalized;
}

function normalizeElectronAngles(
  angles: number[] | undefined,
  markerCount: number,
): number[] | undefined {
  if (markerCount <= 0) return undefined;
  return Array.from({ length: markerCount }, (_, index) => {
    const angle = angles?.[index];
    if (typeof angle === 'number' && Number.isFinite(angle)) return normalizeAngle(angle);
    return DEFAULT_ELECTRON_MARKER_ANGLES[index % DEFAULT_ELECTRON_MARKER_ANGLES.length];
  });
}

function getDefaultNewElectronAngle(existingAngles: number[]): number {
  for (const candidate of DEFAULT_ELECTRON_MARKER_ANGLES) {
    const occupied = existingAngles.some(
      (angle) =>
        Math.abs(Math.atan2(Math.sin(angle - candidate), Math.cos(angle - candidate))) < 0.4,
    );
    if (!occupied) return candidate;
  }
  return DEFAULT_ELECTRON_MARKER_ANGLES[
    existingAngles.length % DEFAULT_ELECTRON_MARKER_ANGLES.length
  ];
}

function getElectronMarkerCountFromCounts(lonePairs: number, radicalElectrons: number): number {
  return lonePairs + radicalElectrons;
}

function getElectronMarkerCount(atom: Atom): number {
  const { lonePairs, radicalElectrons } = getAtomElectronAnnotations(atom);
  return getElectronMarkerCountFromCounts(lonePairs, radicalElectrons);
}

function setAtomElectronAnnotations(
  atom: Atom,
  lonePairs: number,
  radicalElectrons: number,
  electronAngles?: number[],
): Atom {
  const markerCount = getElectronMarkerCountFromCounts(lonePairs, radicalElectrons);
  const nextAngles = normalizeElectronAngles(electronAngles ?? atom.electronAngles, markerCount);
  return {
    ...atom,
    ...(lonePairs > 0 ? { lonePairs } : { lonePairs: undefined }),
    ...(radicalElectrons > 0 ? { radicalElectrons } : { radicalElectrons: undefined }),
    ...(nextAngles?.length ? { electronAngles: nextAngles } : { electronAngles: undefined }),
    electrons: undefined,
  };
}

function getNormalizedCurrentAngles(atom: Atom): number[] {
  return normalizeElectronAngles(atom.electronAngles, getElectronMarkerCount(atom)) ?? [];
}

export function getAtomElectronAnnotations(atom: Atom): AtomElectronAnnotations {
  if (atom.lonePairs != null || atom.radicalElectrons != null) {
    return {
      lonePairs: normalizeCount(atom.lonePairs),
      radicalElectrons: normalizeCount(atom.radicalElectrons),
    };
  }

  const legacyElectrons = normalizeCount(atom.electrons);
  return {
    lonePairs: Math.floor(legacyElectrons / 2),
    radicalElectrons: legacyElectrons % 2,
  };
}

export function updateAtomElectronMarkerAngle(
  atom: Atom,
  markerIndex: number,
  angle: number,
): Atom {
  const markerCount = getElectronMarkerCount(atom);
  if (markerCount <= 0 || markerIndex < 0 || markerIndex >= markerCount) return atom;
  const nextAngles = normalizeElectronAngles(atom.electronAngles, markerCount) ?? [];
  nextAngles[markerIndex] = normalizeAngle(angle);
  return {
    ...atom,
    electronAngles: nextAngles,
    electrons: undefined,
  };
}

export function getAtomElectronBudget(atom: Atom, bonds: Bond[]): number | null {
  const leadElement = getAtomLeadElement(atom);
  const valenceElectrons = VALENCE_ELECTRON_COUNTS[leadElement];
  if (valenceElectrons == null) return null;

  const bondOrderTotal = bonds
    .filter((bond) => bond.from === atom.id || bond.to === atom.id)
    .reduce((sum, bond) => sum + (bond.order || 1), 0);

  return Math.max(0, valenceElectrons - bondOrderTotal - (atom.charge || 0));
}

export function sanitizeAtomElectronAnnotations(atom: Atom, bonds: Bond[]): Atom {
  const current = getAtomElectronAnnotations(atom);
  const electronBudget = getAtomElectronBudget(atom, bonds);
  let radicalElectrons = current.radicalElectrons;
  let lonePairs = current.lonePairs;

  radicalElectrons = Math.min(radicalElectrons, MAX_ELECTRON_DECORATION_SLOTS);
  if (electronBudget != null) radicalElectrons = Math.min(radicalElectrons, electronBudget);

  const maxLonePairsByBudget =
    electronBudget == null
      ? Number.POSITIVE_INFINITY
      : Math.floor((electronBudget - radicalElectrons) / 2);
  lonePairs = Math.max(
    0,
    Math.min(lonePairs, maxLonePairsByBudget, MAX_ELECTRON_DECORATION_SLOTS - radicalElectrons),
  );

  return setAtomElectronAnnotations(atom, lonePairs, radicalElectrons, atom.electronAngles);
}

function canAddLonePair(atom: Atom, bonds: Bond[]): boolean {
  const { lonePairs, radicalElectrons } = getAtomElectronAnnotations(atom);
  if (lonePairs + radicalElectrons >= MAX_ELECTRON_DECORATION_SLOTS) return false;
  const electronBudget = getAtomElectronBudget(atom, bonds);
  if (electronBudget == null) return true;
  return lonePairs * 2 + radicalElectrons + 2 <= electronBudget;
}

function canAddRadical(atom: Atom, bonds: Bond[]): boolean {
  const { lonePairs, radicalElectrons } = getAtomElectronAnnotations(atom);
  if (lonePairs + radicalElectrons >= MAX_ELECTRON_DECORATION_SLOTS) return false;
  const electronBudget = getAtomElectronBudget(atom, bonds);
  if (electronBudget == null) return true;
  return lonePairs * 2 + radicalElectrons + 1 <= electronBudget;
}

export function applyElectronToolToAtom(
  atom: Atom,
  bonds: Bond[],
  mode: ElectronToolMode,
): AtomElectronToolResult {
  const current = getAtomElectronAnnotations(atom);

  if (mode === 'charge-positive' || mode === 'charge-negative') {
    const targetCharge = mode === 'charge-positive' ? 1 : -1;
    const nextCharge = atom.charge === targetCharge ? undefined : targetCharge;
    const next = sanitizeAtomElectronAnnotations({ ...atom, charge: nextCharge }, bonds);
    const changed =
      next.charge !== atom.charge ||
      next.lonePairs !== atom.lonePairs ||
      next.radicalElectrons !== atom.radicalElectrons ||
      next.electronAngles !== atom.electronAngles ||
      next.electrons !== atom.electrons;
    return { atom: next, changed };
  }

  if (mode === 'radical') {
    if (current.radicalElectrons > 0) {
      const nextAngles = getNormalizedCurrentAngles(atom);
      return {
        atom: setAtomElectronAnnotations(
          atom,
          current.lonePairs,
          current.radicalElectrons - 1,
          nextAngles.slice(0, current.lonePairs + current.radicalElectrons - 1),
        ),
        changed: true,
      };
    }
    if (!canAddRadical(atom, bonds)) {
      return {
        atom,
        changed: false,
        message:
          'This atom has no room for an unpaired electron at its current bonding and charge.',
      };
    }
    const nextAngles = getNormalizedCurrentAngles(atom);
    return {
      atom: setAtomElectronAnnotations(atom, current.lonePairs, current.radicalElectrons + 1, [
        ...nextAngles,
        getDefaultNewElectronAngle(nextAngles),
      ]),
      changed: true,
    };
  }

  if (mode === 'lone-pair-remove') {
    if (current.lonePairs <= 0) {
      return {
        atom,
        changed: false,
        message: 'This atom does not have a lone pair to remove.',
      };
    }
    const nextAngles = getNormalizedCurrentAngles(atom);
    return {
      atom: setAtomElectronAnnotations(atom, current.lonePairs - 1, current.radicalElectrons, [
        ...nextAngles.slice(0, Math.max(0, current.lonePairs - 1)),
        ...nextAngles.slice(current.lonePairs),
      ]),
      changed: true,
    };
  }

  if (!canAddLonePair(atom, bonds)) {
    return {
      atom,
      changed: false,
      message: 'This atom cannot accept another lone pair at its current bonding and charge.',
    };
  }

  const nextAngles = getNormalizedCurrentAngles(atom);
  return {
    atom: setAtomElectronAnnotations(atom, current.lonePairs + 1, current.radicalElectrons, [
      ...nextAngles.slice(0, current.lonePairs),
      getDefaultNewElectronAngle(nextAngles),
      ...nextAngles.slice(current.lonePairs),
    ]),
    changed: true,
  };
}

export function getAtomElectronMarkerPlacements(atom: Atom): AtomElectronMarkerPlacement[] {
  const { lonePairs, radicalElectrons } = getAtomElectronAnnotations(atom);
  const items: AtomElectronMarkerPlacement['kind'][] = [
    ...Array.from({ length: lonePairs }, () => 'lone-pair' as const),
    ...Array.from({ length: radicalElectrons }, () => 'radical' as const),
  ];

  return items.slice(0, MAX_ELECTRON_DECORATION_SLOTS).map((kind) => ({ kind }));
}

export function getAtomElectronMarkerGeometry(
  atom: Atom,
  metrics: {
    centerX: number;
    centerY: number;
    distance: number;
    pairSpacing: number;
  },
): AtomElectronMarkerGeometry[] {
  const placements = getAtomElectronMarkerPlacements(atom);
  const angles = normalizeElectronAngles(atom.electronAngles, placements.length) ?? [];
  return placements.map((placement, index) => {
    const angle = angles[index];
    const center = {
      x: metrics.centerX + Math.cos(angle) * metrics.distance,
      y: metrics.centerY + Math.sin(angle) * metrics.distance,
    };

    if (placement.kind === 'radical') {
      return {
        kind: placement.kind,
        index,
        angle,
        center,
        dots: [center],
      };
    }

    const tangent = {
      x: -Math.sin(angle) * metrics.pairSpacing,
      y: Math.cos(angle) * metrics.pairSpacing,
    };

    return {
      kind: placement.kind,
      index,
      angle,
      center,
      dots: [
        { x: center.x - tangent.x, y: center.y - tangent.y },
        { x: center.x + tangent.x, y: center.y + tangent.y },
      ],
    };
  });
}
