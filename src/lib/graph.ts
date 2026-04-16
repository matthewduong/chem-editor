import type { Atom, Bond, CanvasState } from '../types/chemistry';
import { getAtomAlias, getAtomNodeText, getAtomKind, getAtomLeadElement } from './atomIdentity';
import { getAliasChemistry } from './aliasChemistry';
import { DEFAULT_CANVAS_BOND_LENGTH } from './chemdrawMetrics';
import type { ShorthandEntry } from './shorthand';

/** Canvas pixels per Å — matches ChemDraw 30pt bond = 1.5Å standard C-C */
export const MOLBLOCK_SCALE = 30;

/** Default bond length in canvas pixels */
export const BOND_LENGTH = DEFAULT_CANVAS_BOND_LENGTH;

/** Snap angle increment in radians (15°) */
export const SNAP_ANGLE = Math.PI / 12;

type AdjacencyMap = Map<string, string[]>;

function buildAdjacencyMap(atoms: Atom[], bonds: Bond[]): AdjacencyMap {
  const adj: AdjacencyMap = new Map();
  for (const a of atoms) adj.set(a.id, []);
  for (const b of bonds) {
    adj.get(b.from)?.push(b.to);
    adj.get(b.to)?.push(b.from);
  }
  return adj;
}

/** BFS connected components */
export function getConnectedComponents(atoms: Atom[], bonds: Bond[]): Set<string>[] {
  const adj = buildAdjacencyMap(atoms, bonds);
  const visited = new Set<string>();
  const components: Set<string>[] = [];
  for (const a of atoms) {
    if (visited.has(a.id)) continue;
    const comp = new Set<string>();
    const q = [a.id];
    visited.add(a.id);
    while (q.length) {
      const curr = q.shift()!;
      comp.add(curr);
      for (const n of adj.get(curr) ?? []) {
        if (!visited.has(n)) {
          visited.add(n);
          q.push(n);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

export function getFullySelectedComponentAtomIds(
  atoms: Atom[],
  bonds: Bond[],
  selectedAtomIds: ReadonlySet<string>,
): Set<string> {
  const fullySelectedAtomIds = new Set<string>();
  for (const component of getConnectedComponents(atoms, bonds)) {
    if (component.size <= 1) continue;
    let isFullySelected = true;
    for (const atomId of component) {
      if (!selectedAtomIds.has(atomId)) {
        isFullySelected = false;
        break;
      }
    }
    if (!isFullySelected) continue;
    component.forEach((atomId) => fullySelectedAtomIds.add(atomId));
  }
  return fullySelectedAtomIds;
}

export interface MolblockResult {
  molblock: string;
  shorthandMap: Map<number, string>;
}

export interface ParsedMolblockAtom {
  x: number;
  y: number;
  element: string;
  charge?: number;
  isotope?: number;
}

export interface ParsedMolblockBond {
  from: number;
  to: number;
  order: number;
  stereo: number;
}

export interface ParsedMolblockGeometry {
  atoms: ParsedMolblockAtom[];
  bonds: ParsedMolblockBond[];
}

export type AliasEntryResolver = (
  atom: Atom,
  label: string | undefined,
) => ShorthandEntry | undefined;

function parseMolblockCounts(mb: string): { lines: string[]; atomCount: number; bondCount: number } | null {
  const lines = mb.split('\n');
  if (lines.length < 4) return null;
  const countsLine = lines[3];
  if (countsLine.length < 6) return null;
  const atomCount = Number.parseInt(countsLine.substring(0, 3).trim(), 10);
  const bondCount = Number.parseInt(countsLine.substring(3, 6).trim(), 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount < 0 || bondCount < 0) {
    return null;
  }
  return { lines, atomCount, bondCount };
}

export function parseMolblockGeometry(
  mb: string,
  coordinateScale = MOLBLOCK_SCALE,
): ParsedMolblockGeometry | null {
  const parsedCounts = parseMolblockCounts(mb);
  if (!parsedCounts) return null;

  const { lines, atomCount, bondCount } = parsedCounts;
  const atoms: ParsedMolblockAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 4];
    if (!line || line.length < 34) return null;
    atoms.push({
      x: Number.parseFloat(line.substring(0, 10)) * coordinateScale,
      y: -Number.parseFloat(line.substring(10, 20)) * coordinateScale,
      element: line.substring(31, 34).trim(),
    });
  }

  const bonds: ParsedMolblockBond[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[atomCount + index + 4];
    if (!line || line.length < 9) return null;
    const from = Number.parseInt(line.substring(0, 3).trim(), 10) - 1;
    const to = Number.parseInt(line.substring(3, 6).trim(), 10) - 1;
    if (from < 0 || from >= atoms.length || to < 0 || to >= atoms.length) continue;
    bonds.push({
      from,
      to,
      order: Number.parseInt(line.substring(6, 9).trim(), 10) || 1,
      stereo: Number.parseInt(line.substring(9, 12).trim(), 10) || 0,
    });
  }

  for (const line of lines.slice(atomCount + bondCount + 4)) {
    if (line.startsWith('M  CHG')) {
      const count = Number.parseInt(line.substring(6, 9).trim(), 10);
      for (let index = 0; index < count; index += 1) {
        const atomIndex = Number.parseInt(line.substring(9 + index * 8, 13 + index * 8).trim(), 10) - 1;
        const charge = Number.parseInt(line.substring(13 + index * 8, 17 + index * 8).trim(), 10);
        if (atomIndex >= 0 && atomIndex < atoms.length && !Number.isNaN(charge)) {
          atoms[atomIndex] = { ...atoms[atomIndex], charge };
        }
      }
      continue;
    }

    if (line.startsWith('M  ISO')) {
      const count = Number.parseInt(line.substring(6, 9).trim(), 10);
      for (let index = 0; index < count; index += 1) {
        const atomIndex = Number.parseInt(line.substring(9 + index * 8, 13 + index * 8).trim(), 10) - 1;
        const isotope = Number.parseInt(line.substring(13 + index * 8, 17 + index * 8).trim(), 10);
        if (atomIndex >= 0 && atomIndex < atoms.length && !Number.isNaN(isotope)) {
          atoms[atomIndex] = { ...atoms[atomIndex], isotope };
        }
      }
    }
  }

  return { atoms, bonds };
}

export function getMedianBondLength(geometry: Pick<ParsedMolblockGeometry, 'atoms' | 'bonds'>): number | null {
  const lengths = geometry.bonds
    .map((bond) => {
      const fromAtom = geometry.atoms[bond.from];
      const toAtom = geometry.atoms[bond.to];
      if (!fromAtom || !toAtom) return NaN;
      return Math.hypot(toAtom.x - fromAtom.x, toAtom.y - fromAtom.y);
    })
    .filter((length) => Number.isFinite(length) && length > 0)
    .sort((left, right) => left - right);
  if (lengths.length === 0) return null;
  const middle = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 0
    ? (lengths[middle - 1]! + lengths[middle]!) / 2
    : lengths[middle]!;
}

export function normalizeMolblockBondLength(
  geometry: ParsedMolblockGeometry,
  targetBondLength: number,
  fallbackScale = MOLBLOCK_SCALE,
): ParsedMolblockGeometry {
  const sourceBondLength = getMedianBondLength(geometry);
  const scale =
    typeof sourceBondLength === 'number' &&
    Number.isFinite(sourceBondLength) &&
    sourceBondLength > 0 &&
    Number.isFinite(targetBondLength) &&
    targetBondLength > 0
      ? targetBondLength / sourceBondLength
      : fallbackScale;
  return {
    atoms: geometry.atoms.map((atom) => ({
      ...atom,
      x: atom.x * scale,
      y: atom.y * scale,
    })),
    bonds: geometry.bonds.map((bond) => ({ ...bond })),
  };
}

/** Convert canvas graph to V2000 Molblock string */
export function graphToMolblock(
  atoms: Atom[],
  bonds: Bond[],
  canvasWidth: number,
  canvasHeight: number,
  resolveAliasEntry: AliasEntryResolver = (_atom, label) => getAliasChemistry(label),
  mapAllAtoms = false,
): MolblockResult {
  if (atoms.length === 0) return { molblock: '', shorthandMap: new Map() };
  const header = `\n  ChemEditor\n\n`;
  const counts = `${atoms.length.toString().padStart(3)}${bonds.length.toString().padStart(3)}  0  0  0  0  0  0  0  0999 V2000\n`;
  let atomBlock = '';
  const shorthandMap = new Map<number, string>();
  const atomIndexById = new Map<string, number>();
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    atomIndexById.set(atom.id, i + 1);
    const key = getAtomNodeText(atom);
    const entry = getAtomKind(atom) === 'alias' ? resolveAliasEntry(atom, key) : undefined;
    const elem = entry?.lead ?? getAtomLeadElement(atom);
    const mapNum = mapAllAtoms || entry?.subsSmiles ? i + 1 : 0;
    if (entry?.subsSmiles && mapNum) shorthandMap.set(mapNum, key);
    const x = ((atom.x - canvasWidth / 2) / MOLBLOCK_SCALE).toFixed(4).padStart(10);
    const y = (-(atom.y - canvasHeight / 2) / MOLBLOCK_SCALE).toFixed(4).padStart(10);
    const z = (0.0).toFixed(4).padStart(10);
    atomBlock += `${x}${y}${z} ${elem.padEnd(3)} 0  0  0  0  0  0  0  0  0${mapNum.toString().padStart(3)}  0  0\n`;
  }
  let bondBlock = '';
  for (const bond of bonds) {
    const fi = atomIndexById.get(bond.from) ?? 0;
    const ti = atomIndexById.get(bond.to) ?? 0;
    if (fi <= 0 || ti <= 0) continue;
    bondBlock += `${fi.toString().padStart(3)}${ti.toString().padStart(3)}${bond.order.toString().padStart(3)}${(bond.stereo ?? 0).toString().padStart(3)}  0  0  0\n`;
  }
  const charged = atoms.filter((a) => a.charge);
  let chgBlock = '';
  for (let i = 0; i < charged.length; i += 8) {
    const chunk = charged.slice(i, i + 8);
    chgBlock += `M  CHG${chunk.length.toString().padStart(3)}`;
    for (const a of chunk) {
      const idx = atomIndexById.get(a.id) ?? 0;
      chgBlock += `${idx.toString().padStart(4)}${a.charge!.toString().padStart(4)}`;
    }
    chgBlock += '\n';
  }
  return {
    molblock: `${header}${counts}${atomBlock}${bondBlock}${chgBlock}M  END\n`,
    shorthandMap,
  };
}

/** Cheap hash of canvas state for SMILES memoization */
export function hashCanvasState(atoms: Atom[], bonds: Bond[]): string {
  let h = `${atoms.length}:${bonds.length}`;
  for (const a of atoms) {
    h += `|${a.id}${a.x.toFixed(1)}${a.y.toFixed(1)}${getAtomKind(a)}${a.element}${getAtomAlias(a) ?? ''}${a.charge ?? 0}${a.lonePairs ?? ''}${a.radicalElectrons ?? ''}${a.electrons ?? 0}${a.isotope ?? 0}`;
  }
  for (const b of bonds) h += `|${b.from}${b.to}${b.order}${b.stereo ?? 0}`;
  return h;
}

/** Parse a V2000 Molblock into canvas atoms and bonds centered on canvas */
export function molblockToState(
  mb: string,
  canvasWidth: number,
  canvasHeight: number,
  existingArrows: CanvasState['arrows'] = [],
): CanvasState {
  const geometry = parseMolblockGeometry(mb, MOLBLOCK_SCALE);
  if (!geometry) return { atoms: [], bonds: [], arrows: existingArrows };

  const atoms: Atom[] = geometry.atoms.map((atom) => ({
    id: crypto.randomUUID(),
    x: canvasWidth / 2 + atom.x,
    y: canvasHeight / 2 + atom.y,
    kind: 'element',
    element: atom.element,
    ...(atom.charge != null ? { charge: atom.charge } : {}),
    ...(atom.isotope != null ? { isotope: atom.isotope } : {}),
  }));
  const bonds: Bond[] = geometry.bonds.map((bond) => ({
    id: crypto.randomUUID(),
    from: atoms[bond.from]!.id,
    to: atoms[bond.to]!.id,
    order: bond.order,
    stereo: bond.stereo,
  }));
  return { atoms, bonds, arrows: existingArrows };
}
