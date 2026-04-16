import type { Atom, Arrow, Group, TextBox } from '../types/chemistry';
import type { Bond } from '../types/chemistry';
import { getConnectedComponents } from './graph';

export type AlignOp =
  | 'alignLeft'
  | 'alignRight'
  | 'alignTop'
  | 'alignBottom'
  | 'centerH'
  | 'centerV'
  | 'distributeH'
  | 'distributeV';

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

interface Unit {
  atomIds: string[];
  arrowId?: string;
  textBoxId?: string;
  bbox: BBox;
}

function atomsBBox(atoms: Atom[], ids: string[]): BBox {
  const pts = atoms.filter((a) => ids.includes(a.id));
  const minX = Math.min(...pts.map((a) => a.x));
  const maxX = Math.max(...pts.map((a) => a.x));
  const minY = Math.min(...pts.map((a) => a.y));
  const maxY = Math.max(...pts.map((a) => a.y));
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function textBoxBBox(tb: TextBox): BBox {
  // Estimate width using avg char width ~0.6× fontSize
  const totalChars = tb.runs.reduce((s, r) => s + r.text.length, 0);
  const w = Math.max(totalChars * tb.fontSize * 0.6, tb.fontSize);
  const h = tb.fontSize;
  const minX = tb.x,
    maxX = tb.x + w;
  const minY = tb.y - h,
    maxY = tb.y;
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function arrowBBox(arrow: Arrow): BBox {
  const minX = Math.min(arrow.x1, arrow.x2, arrow.cpx);
  const maxX = Math.max(arrow.x1, arrow.x2, arrow.cpx);
  const minY = Math.min(arrow.y1, arrow.y2, arrow.cpy);
  const maxY = Math.max(arrow.y1, arrow.y2, arrow.cpy);
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function buildAlignmentUnits(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  selectedAtomIds: Set<string>,
  selectedArrowIds: Set<string>,
  groups: Group[],
  textBoxes?: TextBox[],
  selectedTextBoxIds?: Set<string>,
): Unit[] {
  const units: Unit[] = [];
  const consumed = new Set<string>();

  // Sort groups smallest → largest so innermost (most specific) group is found first
  const sortedGroups = [...groups].sort((a, b) => a.atomIds.length - b.atomIds.length);

  // Assign each selected atom to its innermost group
  const atomToGroup = new Map<string, Group>();
  for (const id of selectedAtomIds) {
    for (const g of sortedGroups) {
      if (g.atomIds.includes(id)) {
        atomToGroup.set(id, g);
        break;
      }
    }
  }

  // Build one rigid unit per unique effective group
  const usedGroupIds = new Set<string>();
  for (const group of atomToGroup.values()) {
    if (usedGroupIds.has(group.id)) continue;
    usedGroupIds.add(group.id);
    // Only include atoms not yet consumed by a smaller nested group
    const ids = group.atomIds.filter((id) => atoms.some((a) => a.id === id) && !consumed.has(id));
    if (!ids.length) continue;
    units.push({ atomIds: ids, bbox: atomsBBox(atoms, ids) });
    ids.forEach((id) => consumed.add(id));
  }

  // Remaining selected atoms (not in any group) → connected-component units
  const remainingSelected = new Set([...selectedAtomIds].filter((id) => !consumed.has(id)));
  if (remainingSelected.size > 0) {
    const components = getConnectedComponents(atoms, bonds);
    const seen = new Set<string>();
    for (const comp of components) {
      if (![...comp].some((id) => remainingSelected.has(id))) continue;
      const key = [...comp].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const ids = [...comp];
      units.push({ atomIds: ids, bbox: atomsBBox(atoms, ids) });
    }
  }

  for (const arrow of arrows) {
    if (!selectedArrowIds.has(arrow.id)) continue;
    units.push({ atomIds: [], arrowId: arrow.id, bbox: arrowBBox(arrow) });
  }

  if (textBoxes && selectedTextBoxIds) {
    for (const tb of textBoxes) {
      if (!selectedTextBoxIds.has(tb.id)) continue;
      units.push({ atomIds: [], textBoxId: tb.id, bbox: textBoxBBox(tb) });
    }
  }

  return units;
}

export function applyAlignment(
  atoms: Atom[],
  arrows: Arrow[],
  units: Unit[],
  op: AlignOp,
  textBoxes?: TextBox[],
): { atoms: Atom[]; arrows: Arrow[]; textBoxes: TextBox[] } {
  const tb = textBoxes ?? [];
  if (units.length < 2) return { atoms, arrows, textBoxes: tb };
  if ((op === 'distributeH' || op === 'distributeV') && units.length < 3)
    return { atoms, arrows, textBoxes: tb };

  const deltas = new Map<string, { dx: number; dy: number }>();

  if (op === 'distributeH') {
    const sorted = [...units].sort((a, b) => a.bbox.cx - b.bbox.cx);
    const first = sorted[0].bbox.cx,
      last = sorted[sorted.length - 1].bbox.cx;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((u, i) => {
      const target = first + i * step;
      const dx = target - u.bbox.cx;
      u.atomIds.forEach((id) => deltas.set(id, { dx, dy: 0 }));
      if (u.arrowId) deltas.set(u.arrowId, { dx, dy: 0 });
      if (u.textBoxId) deltas.set(u.textBoxId, { dx, dy: 0 });
    });
  } else if (op === 'distributeV') {
    const sorted = [...units].sort((a, b) => a.bbox.cy - b.bbox.cy);
    const first = sorted[0].bbox.cy,
      last = sorted[sorted.length - 1].bbox.cy;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((u, i) => {
      const target = first + i * step;
      const dy = target - u.bbox.cy;
      u.atomIds.forEach((id) => deltas.set(id, { dx: 0, dy }));
      if (u.arrowId) deltas.set(u.arrowId, { dx: 0, dy });
      if (u.textBoxId) deltas.set(u.textBoxId, { dx: 0, dy });
    });
  } else {
    let targetX = 0,
      targetY = 0;
    if (op === 'alignLeft') targetX = Math.min(...units.map((u) => u.bbox.minX));
    if (op === 'alignRight') targetX = Math.max(...units.map((u) => u.bbox.maxX));
    if (op === 'alignTop') targetY = Math.min(...units.map((u) => u.bbox.minY));
    if (op === 'alignBottom') targetY = Math.max(...units.map((u) => u.bbox.maxY));
    if (op === 'centerH') targetX = units.reduce((s, u) => s + u.bbox.cx, 0) / units.length;
    if (op === 'centerV') targetY = units.reduce((s, u) => s + u.bbox.cy, 0) / units.length;

    for (const u of units) {
      let dx = 0,
        dy = 0;
      if (op === 'alignLeft') dx = targetX - u.bbox.minX;
      if (op === 'alignRight') dx = targetX - u.bbox.maxX;
      if (op === 'alignTop') dy = targetY - u.bbox.minY;
      if (op === 'alignBottom') dy = targetY - u.bbox.maxY;
      if (op === 'centerH') dx = targetX - u.bbox.cx;
      if (op === 'centerV') dy = targetY - u.bbox.cy;
      u.atomIds.forEach((id) => deltas.set(id, { dx, dy }));
      if (u.arrowId) deltas.set(u.arrowId, { dx, dy });
      if (u.textBoxId) deltas.set(u.textBoxId, { dx, dy });
    }
  }

  const newAtoms = atoms.map((a) => {
    const d = deltas.get(a.id);
    return d ? { ...a, x: a.x + d.dx, y: a.y + d.dy } : a;
  });

  const newArrows = arrows.map((ar) => {
    const d = deltas.get(ar.id);
    return d
      ? {
          ...ar,
          x1: ar.x1 + d.dx,
          y1: ar.y1 + d.dy,
          x2: ar.x2 + d.dx,
          y2: ar.y2 + d.dy,
          cpx: ar.cpx + d.dx,
          cpy: ar.cpy + d.dy,
        }
      : ar;
  });

  const newTextBoxes = tb.map((t) => {
    const d = deltas.get(t.id);
    return d ? { ...t, x: t.x + d.dx, y: t.y + d.dy } : t;
  });

  return { atoms: newAtoms, arrows: newArrows, textBoxes: newTextBoxes };
}
