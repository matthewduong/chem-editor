import type { Atom, Bond, Arrow, TextBox } from '../types/chemistry';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from './settings';
import { useStore } from '../store';

export interface ClipboardBuffer {
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  textBoxes: TextBox[];
}

let _buffer: ClipboardBuffer | null = null;
let _pasteCount = 0;

const PASTE_OFFSET = DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength; // one bond-length in canvas coords, zoom-invariant

export function extractSelection(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  textBoxes: TextBox[],
  selectedAtomIds: Set<string>,
  selectedBondIds: Set<string>,
  selectedArrowIds: Set<string>,
  selectedTextBoxIds: Set<string>,
): ClipboardBuffer {
  if (
    selectedAtomIds.size === 0 &&
    selectedBondIds.size === 0 &&
    selectedArrowIds.size === 0 &&
    selectedTextBoxIds.size === 0
  ) {
    return { atoms: [...atoms], bonds: [...bonds], arrows: [...arrows], textBoxes: [...textBoxes] };
  }
  const movedAtomIds = new Set(selectedAtomIds);
  bonds.forEach((bond) => {
    if (!selectedBondIds.has(bond.id)) return;
    movedAtomIds.add(bond.from);
    movedAtomIds.add(bond.to);
  });
  const selAtoms = atoms.filter((a) => movedAtomIds.has(a.id));
  const selBonds = bonds.filter(
    (b) => selectedBondIds.has(b.id) || (movedAtomIds.has(b.from) && movedAtomIds.has(b.to)),
  );
  const selArrows = arrows.filter((a) => selectedArrowIds.has(a.id));
  const selTextBoxes = textBoxes.filter((t) => selectedTextBoxIds.has(t.id));
  return { atoms: selAtoms, bonds: selBonds, arrows: selArrows, textBoxes: selTextBoxes };
}

export function applyPasteOffset(buf: ClipboardBuffer, pasteCount: number): ClipboardBuffer {
  const offset =
    pasteCount * (useStore.getState().documentStyleSettings.bondLength || PASTE_OFFSET);
  const idMap = new Map<string, string>();

  const newAtoms: Atom[] = buf.atoms.map((a) => {
    const newId = crypto.randomUUID();
    idMap.set(a.id, newId);
    return { ...a, id: newId, x: a.x + offset, y: a.y + offset };
  });

  const newBonds: Bond[] = buf.bonds.map((b) => ({
    ...b,
    id: crypto.randomUUID(),
    from: idMap.get(b.from) ?? b.from,
    to: idMap.get(b.to) ?? b.to,
  }));

  const newArrows: Arrow[] = buf.arrows.map((a) => {
    const newId = crypto.randomUUID();
    idMap.set(a.id, newId);
    return {
      ...a,
      id: newId,
      x1: a.x1 + offset,
      y1: a.y1 + offset,
      x2: a.x2 + offset,
      y2: a.y2 + offset,
      cpx: a.cpx + offset,
      cpy: a.cpy + offset,
    };
  });

  const newTextBoxes: TextBox[] = buf.textBoxes.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    x: t.x + offset,
    y: t.y + offset,
  }));

  return { atoms: newAtoms, bonds: newBonds, arrows: newArrows, textBoxes: newTextBoxes };
}

export async function svgToPngBlob(svgString: string): Promise<Blob> {
  const widthMatch = svgString.match(/width="([^"]+)"/);
  const heightMatch = svgString.match(/height="([^"]+)"/);
  const w = widthMatch ? parseFloat(widthMatch[1]) : 800;
  const h = heightMatch ? parseFloat(heightMatch[1]) : 600;

  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('no 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg load failed'));
    };
    img.src = url;
  });
}

export function detectPasteFormat(
  text: string,
): 'smiles' | 'xyz' | 'molblock' | 'cdxml' | 'unknown' {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';
  const lines = text.trim().split('\n');

  if (
    /<\?xml[\s\S]*?<CDXML[\s>]/i.test(trimmed) ||
    /<!DOCTYPE\s+CDXML/i.test(trimmed) ||
    /<CDXML[\s>]/i.test(trimmed)
  ) {
    return 'cdxml';
  }

  // Molblock: line 4 (index 3) matches V2000 counts line
  if (lines.length >= 4 && /^\s*\d+\s+\d+.*V2000/.test(lines[3])) return 'molblock';

  // XYZ: line 1 is a pure integer, line 3+ is <element> <float> <float> <float>
  if (
    lines.length >= 3 &&
    /^\s*\d+\s*$/.test(lines[0]) &&
    /^\s*[A-Za-z]+\s+-?\d+\.?\d*\s+-?\d+\.?\d*\s+-?\d+\.?\d*/.test(lines[2])
  )
    return 'xyz';

  // SMILES / formula: single-line token of chemistry chars, including formula markup.
  if (/^[A-Za-z0-9@+\-[\]()=#%./\\_^₀₁₂₃₄₅₆₇₈₉₊₋₍₎⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+$/.test(trimmed)) return 'smiles';

  return 'unknown';
}

export function setClipboardBuffer(buf: ClipboardBuffer) {
  _buffer = buf;
}
export function getClipboardBuffer(): ClipboardBuffer | null {
  return _buffer;
}
export function resetPasteCount() {
  _pasteCount = 0;
}
export function bumpPasteCount(): number {
  return ++_pasteCount;
}
