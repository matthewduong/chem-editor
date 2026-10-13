import type { Atom, Bond } from '../types/chemistry';
import { SNAP_ANGLE } from './graph';
import { bondsOfAtom, findAtomById } from './graphLookup';
import { getPreferredAttachmentAngle } from './ringTemplates';

/** Directions this close to parallel carry no side preference (about 1 degree). */
const COLLINEAR_TOLERANCE = 0.02;
const TURN = Math.PI / 3;
const snap = (angle: number) => Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;

export interface NewBondAngleOptions {
  /** Order of the bond being drawn. Enables the straight-line rule for multiple bonds. */
  newBondOrder?: number;
  /** A wedge or hash is never collinear with the previous bond. */
  stereo?: number;
}

/**
 * Direction for a new bond drawn from `atom` when the user did not drag.
 *
 * Extends `getPreferredAttachmentAngle` with two conventions of chain drawing:
 *
 * - zigzag: from a terminal atom whose neighbour carries other substituents, the new bond turns
 *   away from them, so repeated clicks draw a zigzag chain instead of curling into a ring;
 * - straight line: a double or triple bond continues a double or triple bond, and a triple bond
 *   continues a single one, so alkynes and cumulenes come out linear.
 *
 * Both are the behaviour of Ketcher's `atomForNewBond`. Neither has been compared with ChemDraw
 * (see development/gaps.md); callers that must stay as they were use
 * `getPreferredAttachmentAngle` directly.
 */
export function getNewBondAngle(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  options: NewBondAngleOptions = {},
): number {
  const connections = bondsOfAtom(atom.id, bonds);
  const fallback = getPreferredAttachmentAngle(atom, atoms, bonds, false);
  if (connections.length !== 1) return fallback;

  const previous = connections[0]!;
  const neighbour = findAtomById(previous.from === atom.id ? previous.to : previous.from, atoms);
  if (!neighbour) return fallback;
  const dx = atom.x - neighbour.x;
  const dy = atom.y - neighbour.y;
  if (Math.hypot(dx, dy) < 1e-6) return fallback;
  const straight = Math.atan2(dy, dx);

  const next = options.newBondOrder;
  const before = previous.order;
  const plain = (options.stereo ?? 0) === 0 && !previous.stereo;
  if (
    plain &&
    next !== undefined &&
    ((next === before && (next === 2 || next === 3)) ||
      (before === 1 && next === 3) ||
      (before === 3 && next === 1))
  ) {
    return snap(straight);
  }

  // Which side of the previous bond do the neighbour's other substituents lie on?
  let side = 0;
  for (const other of bondsOfAtom(neighbour.id, bonds)) {
    if (other.id === previous.id) continue;
    const far = findAtomById(other.from === neighbour.id ? other.to : other.from, atoms);
    if (!far || far.id === atom.id) continue;
    const vx = far.x - neighbour.x;
    const vy = far.y - neighbour.y;
    const length = Math.hypot(vx, vy);
    if (length < 1e-6) continue;
    const cross = (dx * vy - dy * vx) / (Math.hypot(dx, dy) * length);
    if (Math.abs(cross) < COLLINEAR_TOLERANCE) continue;
    const sign = Math.sign(cross);
    if (side !== 0 && sign !== side) return fallback; // both sides occupied: no preference
    side = sign;
  }
  if (side === 0) return fallback;
  // The previous turn was towards the substituent's side, so turn the other way.
  return snap(straight - side * TURN);
}
