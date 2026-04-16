import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Atom, Bond } from '../../src/types/chemistry';
import {
  materializeResolvedRingTemplatePlacement,
  resolveChairAttachmentSnapping,
  resolveRingTemplatePlacement,
} from '../../src/lib/ringTemplates';
import { useStore } from '../../src/store';
import { useAtomTool } from '../../src/tools/useAtomTool';
import { useBondTool } from '../../src/tools/useBondTool';
import { SNAP_ANGLE } from '../../src/lib/graph';
import { resetStore } from './helpers';

const CHAIR_BOND_LENGTH = 14.4;

function getChairDocumentStyleSettings() {
  return {
    ...useStore.getInitialState().documentStyleSettings,
    bondLength: CHAIR_BOND_LENGTH,
  };
}

function getStandaloneChairState(center: { x: number; y: number }) {
  const placement = resolveRingTemplatePlacement({
    preset: 'chair',
    bondLength: CHAIR_BOND_LENGTH,
    center,
    existingAtoms: [],
    existingBonds: [],
  });
  return {
    placement,
    ...materializeResolvedRingTemplatePlacement(placement, [], []),
  };
}

function findAtomByTemplateKey(atoms: Atom[], atomKey: string): Atom {
  const atom = atoms.find((entry) =>
    entry.ringTemplateMemberships?.some((membership) => membership.atomKey === atomKey),
  );
  if (!atom) {
    throw new Error(`Missing atom for template key ${atomKey}`);
  }
  return atom;
}

function addSubstituent(
  atoms: Atom[],
  bonds: Bond[],
  startAtomId: string,
  candidate: { x: number; y: number },
) {
  const substituentId = `substituent-${bonds.length}`;
  return {
    atoms: [
      ...atoms,
      {
        id: substituentId,
        x: candidate.x,
        y: candidate.y,
        kind: 'element' as const,
        element: 'C',
      },
    ],
    bonds: [
      ...bonds,
      {
        id: `substituent-bond-${bonds.length}`,
        from: startAtomId,
        to: substituentId,
        order: 1,
        stereo: 0,
      },
    ],
  };
}

describe('chair attachment snapping tools', () => {
  beforeEach(() => {
    resetStore();
  });

  it('uses the unoccupied axial direction for bond-tool quick clicks when equatorial is occupied', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const startAtom = findAtomByTemplateKey(chairState.atoms, 'a0');
    const snap = resolveChairAttachmentSnapping({
      atomId: startAtom.id,
      atoms: chairState.atoms,
      bonds: chairState.bonds,
      bondLength: CHAIR_BOND_LENGTH,
    });
    const equatorialCandidate = snap?.candidates.find(
      (candidate) => candidate.kind === 'equatorial',
    );
    const axialCandidate = snap?.candidates.find((candidate) => candidate.kind === 'axial');
    expect(equatorialCandidate).toBeDefined();
    expect(axialCandidate).toBeDefined();

    const occupiedState = addSubstituent(
      chairState.atoms,
      chairState.bonds,
      startAtom.id,
      equatorialCandidate!,
    );
    resetStore({
      atoms: occupiedState.atoms,
      bonds: occupiedState.bonds,
      arrows: [],
      groups: [],
      textBoxes: [],
      history: [],
      historyIndex: -1,
      documentStyleSettings: getChairDocumentStyleSettings(),
    });

    const { result } = renderHook(() => useBondTool());
    const storeStartAtom = findAtomByTemplateKey(useStore.getState().atoms, 'a0');
    const existingAtomIds = new Set(useStore.getState().atoms.map((atom) => atom.id));
    const existingBondIds = new Set(useStore.getState().bonds.map((bond) => bond.id));

    act(() => {
      result.current.onMouseDown(
        { x: storeStartAtom.x, y: storeStartAtom.y },
        storeStartAtom,
        null,
      );
    });
    act(() => {
      result.current.onMouseUp();
    });

    const nextState = useStore.getState();
    const newAtom = nextState.atoms.find((atom) => !existingAtomIds.has(atom.id));
    const newBond = nextState.bonds.find((bond) => !existingBondIds.has(bond.id));
    expect(newAtom).toBeDefined();
    expect(newBond).toBeDefined();
    expect(newAtom!.x).toBeCloseTo(axialCandidate!.x, 2);
    expect(newAtom!.y).toBeCloseTo(axialCandidate!.y, 2);
    expect([newBond!.from, newBond!.to]).toContain(storeStartAtom.id);
  });

  it('shares the same chair-aware drag snap endpoint between bond and atom tools', () => {
    const chairState = getStandaloneChairState({ x: 140, y: 180 });
    resetStore({
      atoms: chairState.atoms,
      bonds: chairState.bonds,
      arrows: [],
      groups: [],
      textBoxes: [],
      history: [],
      historyIndex: -1,
      documentStyleSettings: getChairDocumentStyleSettings(),
    });

    const { result: bondTool } = renderHook(() => useBondTool());
    const { result: atomTool } = renderHook(() => useAtomTool());
    const startAtom = findAtomByTemplateKey(useStore.getState().atoms, 'a0');
    const pointer = { x: startAtom.x - 50, y: startAtom.y - 20 };
    const resolved = resolveChairAttachmentSnapping({
      atomId: startAtom.id,
      atoms: useStore.getState().atoms,
      bonds: useStore.getState().bonds,
      bondLength: CHAIR_BOND_LENGTH,
      pointer,
    });

    act(() => {
      bondTool.current.onMouseDown({ x: startAtom.x, y: startAtom.y }, startAtom, null);
      atomTool.current.onMouseDown({ x: startAtom.x, y: startAtom.y }, startAtom);
    });
    act(() => {
      bondTool.current.onMouseMove(pointer, null);
      atomTool.current.onMouseMove(pointer, null);
    });

    expect(bondTool.current.dragPreviewLine?.x2).toBeCloseTo(resolved!.selectedCandidate!.x, 2);
    expect(bondTool.current.dragPreviewLine?.y2).toBeCloseTo(resolved!.selectedCandidate!.y, 2);
    expect(atomTool.current.dragPreviewLine?.x2).toBeCloseTo(resolved!.selectedCandidate!.x, 2);
    expect(atomTool.current.dragPreviewLine?.y2).toBeCloseTo(resolved!.selectedCandidate!.y, 2);
  });

  it('bypasses chair snapping when the drag is targeting an existing atom', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const targetAtom: Atom = {
      id: 'target-atom',
      x: 210,
      y: 205,
      kind: 'element',
      element: 'N',
    };
    resetStore({
      atoms: [...chairState.atoms, targetAtom],
      bonds: chairState.bonds,
      arrows: [],
      groups: [],
      textBoxes: [],
      history: [],
      historyIndex: -1,
      documentStyleSettings: getChairDocumentStyleSettings(),
    });

    const { result } = renderHook(() => useBondTool());
    const startAtom = findAtomByTemplateKey(useStore.getState().atoms, 'a0');

    act(() => {
      result.current.onMouseDown({ x: startAtom.x, y: startAtom.y }, startAtom, null);
    });
    act(() => {
      result.current.onMouseMove({ x: targetAtom.x, y: targetAtom.y }, targetAtom);
    });

    expect(result.current.dragPreviewLine).toMatchObject({
      x2: targetAtom.x,
      y2: targetAtom.y,
      targetId: targetAtom.id,
    });
  });

  it('falls back to generic 15 degree snapping on non-chair atoms', () => {
    const startAtom: Atom = {
      id: 'plain-start',
      x: 100,
      y: 80,
      kind: 'element',
      element: 'C',
    };
    resetStore({
      atoms: [startAtom],
      bonds: [],
      arrows: [],
      groups: [],
      textBoxes: [],
      history: [],
      historyIndex: -1,
      documentStyleSettings: getChairDocumentStyleSettings(),
    });

    const { result } = renderHook(() => useAtomTool());
    const pointer = { x: 130, y: 88 };
    const expectedAngle =
      Math.round(Math.atan2(pointer.y - startAtom.y, pointer.x - startAtom.x) / SNAP_ANGLE) *
      SNAP_ANGLE;

    act(() => {
      result.current.onMouseDown({ x: startAtom.x, y: startAtom.y }, startAtom);
    });
    act(() => {
      result.current.onMouseMove(pointer, null);
    });

    expect(result.current.dragPreviewLine?.x2).toBeCloseTo(
      startAtom.x + Math.cos(expectedAngle) * CHAIR_BOND_LENGTH,
      2,
    );
    expect(result.current.dragPreviewLine?.y2).toBeCloseTo(
      startAtom.y + Math.sin(expectedAngle) * CHAIR_BOND_LENGTH,
      2,
    );
  });
});
