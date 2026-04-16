import { describe, expect, it } from 'vitest';

import type { Atom, Bond } from '../../src/types/chemistry';
import {
  getRegularRingGeometry,
  materializeResolvedRingTemplatePlacement,
  resolveChairAttachmentSnapping,
  resolveRingTemplatePlacement,
  sanitizeRingTemplateState,
} from '../../src/lib/ringTemplates';

function expectPointsClose(
  actual: Array<{ x: number; y: number }>,
  expected: Array<{ x: number; y: number }>,
  tolerance = 0.35,
) {
  const remaining = [...actual];
  expect(remaining).toHaveLength(expected.length);
  expected.forEach((reference) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((point, index) => {
      const distance = Math.hypot(point.x - reference.x, point.y - reference.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    expect(bestIndex).toBeGreaterThanOrEqual(0);
    const [point] = remaining.splice(bestIndex, 1);
    expect(point).toBeDefined();
    expect(Math.abs(point!.x - reference.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(point!.y - reference.y)).toBeLessThanOrEqual(tolerance);
  });
}

function getStandaloneChairState(
  center: { x: number; y: number },
  options: { preset?: 'chair' | 'chair-flipped'; rotationSteps?: number } = {},
) {
  const placement = resolveRingTemplatePlacement({
    preset: options.preset ?? 'chair',
    bondLength: 14.4,
    center,
    existingAtoms: [],
    existingBonds: [],
    rotationSteps: options.rotationSteps ?? 0,
  });
  return {
    placement,
    ...materializeResolvedRingTemplatePlacement(placement, [], []),
  };
}

function findBondByTemplateKey(bonds: Bond[], bondKey: string): Bond {
  const bond = bonds.find((entry) =>
    entry.ringTemplateMemberships?.some((membership) => membership.bondKey === bondKey),
  );
  if (!bond) {
    throw new Error(`Missing bond for template key ${bondKey}`);
  }
  return bond;
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

function getNewStructureId(atoms: Atom[], previousAtoms: Atom[]): string {
  const existingStructureIds = new Set(
    previousAtoms.flatMap(
      (atom) => atom.ringTemplateMemberships?.map((membership) => membership.structureId) ?? [],
    ),
  );
  const newStructureId = atoms
    .flatMap(
      (atom) => atom.ringTemplateMemberships?.map((membership) => membership.structureId) ?? [],
    )
    .find((structureId) => !existingStructureIds.has(structureId));
  if (!newStructureId) {
    throw new Error('Expected a newly materialized chair structure.');
  }
  return newStructureId;
}

function getSegmentsForBonds(atoms: Atom[], bonds: Bond[]) {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  return bonds
    .map((bond) => {
      const from = atomById.get(bond.from);
      const to = atomById.get(bond.to);
      if (!from || !to) return null;
      const ordered =
        from.x < to.x || (from.x === to.x && from.y <= to.y)
          ? [
              [from.x, from.y],
              [to.x, to.y],
            ]
          : [
              [to.x, to.y],
              [from.x, from.y],
            ];
      return ordered.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' -> ');
    })
    .filter((segment): segment is string => Boolean(segment))
    .sort();
}

describe('ringTemplates', () => {
  it('matches the ChemDraw standalone chair geometry', () => {
    const placement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      center: { x: 101.645, y: 333.255 },
      existingAtoms: [],
      existingBonds: [],
    });

    expectPointsClose(placement.atoms, [
      { x: 84.16, y: 327.02 },
      { x: 91.36, y: 339.49 },
      { x: 105.29, y: 335.84 },
      { x: 119.13, y: 339.49 },
      { x: 111.93, y: 327.02 },
      { x: 98.0, y: 330.67 },
    ]);
  });

  it('matches both ChemDraw decalin fusion geometries', () => {
    const firstChair = getStandaloneChairState({ x: 160.995, y: 333.645 });
    const firstHitBond = findBondByTemplateKey(firstChair.bonds, 'b3');
    const chairPlacement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      pointer: { x: 196, y: 333 },
      existingAtoms: firstChair.atoms,
      existingBonds: firstChair.bonds,
      hitBond: firstHitBond,
    });
    const chairNewAtoms = chairPlacement.atoms.filter(
      (_, index) => !chairPlacement.mappedAtomIdsByIndex.has(index),
    );
    expectPointsClose(chairNewAtoms, [
      { x: 192.42, y: 336.23 },
      { x: 206.26, y: 339.88 },
      { x: 199.07, y: 327.41 },
      { x: 185.13, y: 331.05 },
    ]);

    const secondChair = getStandaloneChairState({ x: 254.105, y: 335.195 });
    const secondHitBond = findBondByTemplateKey(secondChair.bonds, 'b2');
    const flippedPlacement = resolveRingTemplatePlacement({
      preset: 'chair-flipped',
      bondLength: 14.4,
      pointer: { x: 268, y: 361 },
      existingAtoms: secondChair.atoms,
      existingBonds: secondChair.bonds,
      hitBond: secondHitBond,
    });
    const flippedNewAtoms = flippedPlacement.atoms.filter(
      (_, index) => !flippedPlacement.mappedAtomIdsByIndex.has(index),
    );
    expectPointsClose(flippedNewAtoms, [
      { x: 265.17, y: 350.03 },
      { x: 265.17, y: 364.35 },
      { x: 279.01, y: 368.0 },
      { x: 271.6, y: 355.75 },
    ]);
  });

  it('applies 60 degree chair rotations deterministically', () => {
    const basePlacement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      center: { x: 120, y: 160 },
      existingAtoms: [],
      existingBonds: [],
    });
    const rotatedPlacement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      center: { x: 120, y: 160 },
      existingAtoms: [],
      existingBonds: [],
      rotationSteps: 1,
    });

    const centroid = basePlacement.atoms.reduce(
      (acc, atom) => ({
        x: acc.x + atom.x / basePlacement.atoms.length,
        y: acc.y + atom.y / basePlacement.atoms.length,
      }),
      { x: 0, y: 0 },
    );
    const expectedRotated = basePlacement.atoms.map((atom) => {
      const dx = atom.x - centroid.x;
      const dy = atom.y - centroid.y;
      return {
        x: centroid.x + dx * Math.cos(Math.PI / 3) - dy * Math.sin(Math.PI / 3),
        y: centroid.y + dx * Math.sin(Math.PI / 3) + dy * Math.cos(Math.PI / 3),
      };
    });

    expectPointsClose(rotatedPlacement.atoms, expectedRotated, 0.02);

    const repeatedPlacement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      center: { x: 120, y: 160 },
      existingAtoms: [],
      existingBonds: [],
      rotationSteps: 1,
    });
    expect(rotatedPlacement.atoms).toEqual(repeatedPlacement.atoms);
  });

  it('scales the chair template to the active bond length', () => {
    const placement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 18,
      center: { x: 100, y: 100 },
      existingAtoms: [],
      existingBonds: [],
    });
    const firstBondLength = Math.hypot(
      placement.atoms[1]!.x - placement.atoms[0]!.x,
      placement.atoms[1]!.y - placement.atoms[0]!.y,
    );
    expect(firstBondLength).toBeCloseTo(18, 2);
  });

  it('resolves axial and equatorial snap candidates on a standalone chair atom', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const startAtom = findAtomByTemplateKey(chairState.atoms, 'a0');
    const upwardSnap = resolveChairAttachmentSnapping({
      atomId: startAtom.id,
      atoms: chairState.atoms,
      bonds: chairState.bonds,
      bondLength: 14.4,
      pointer: { x: startAtom.x, y: startAtom.y - 50 },
    });
    const sideSnap = resolveChairAttachmentSnapping({
      atomId: startAtom.id,
      atoms: chairState.atoms,
      bonds: chairState.bonds,
      bondLength: 14.4,
      pointer: { x: startAtom.x - 50, y: startAtom.y - 20 },
    });

    expect(upwardSnap?.candidates).toHaveLength(2);
    expect(upwardSnap?.selectedCandidate?.kind).toBe('axial');
    expect(sideSnap?.selectedCandidate?.kind).toBe('equatorial');
    upwardSnap?.candidates.forEach((candidate) => {
      expect(Math.hypot(candidate.x - startAtom.x, candidate.y - startAtom.y)).toBeCloseTo(14.4, 2);
    });
  });

  it('keeps chair attachment directions aligned after rotation and for flipped chairs', () => {
    const baseChair = getStandaloneChairState({ x: 120, y: 140 });
    const rotatedChair = getStandaloneChairState({ x: 120, y: 140 }, { rotationSteps: 1 });
    const flippedChair = getStandaloneChairState(
      { x: 160, y: 180 },
      { preset: 'chair-flipped', rotationSteps: 2 },
    );

    const baseAtom = findAtomByTemplateKey(baseChair.atoms, 'a0');
    const rotatedAtom = findAtomByTemplateKey(rotatedChair.atoms, 'a0');
    const flippedAtom = findAtomByTemplateKey(flippedChair.atoms, 'a3');
    const baseSnap = resolveChairAttachmentSnapping({
      atomId: baseAtom.id,
      atoms: baseChair.atoms,
      bonds: baseChair.bonds,
      bondLength: 14.4,
      pointer: { x: baseAtom.x - 50, y: baseAtom.y - 20 },
    });
    const rotatedSnap = resolveChairAttachmentSnapping({
      atomId: rotatedAtom.id,
      atoms: rotatedChair.atoms,
      bonds: rotatedChair.bonds,
      bondLength: 14.4,
      pointer: { x: rotatedAtom.x - 20, y: rotatedAtom.y - 50 },
    });
    const flippedSnap = resolveChairAttachmentSnapping({
      atomId: flippedAtom.id,
      atoms: flippedChair.atoms,
      bonds: flippedChair.bonds,
      bondLength: 14.4,
      pointer: { x: flippedAtom.x + 50, y: flippedAtom.y + 20 },
    });

    const baseEquatorial = baseSnap?.candidates.find(
      (candidate) => candidate.kind === 'equatorial',
    );
    const rotatedEquatorial = rotatedSnap?.candidates.find(
      (candidate) => candidate.kind === 'equatorial',
    );

    expect(baseEquatorial).toBeDefined();
    expect(rotatedEquatorial).toBeDefined();
    const baseVector = {
      x: baseEquatorial!.x - baseAtom.x,
      y: baseEquatorial!.y - baseAtom.y,
    };
    const expectedRotatedVector = {
      x: baseVector.x * Math.cos(Math.PI / 3) - baseVector.y * Math.sin(Math.PI / 3),
      y: baseVector.x * Math.sin(Math.PI / 3) + baseVector.y * Math.cos(Math.PI / 3),
    };
    expect(rotatedEquatorial!.x - rotatedAtom.x).toBeCloseTo(expectedRotatedVector.x, 2);
    expect(rotatedEquatorial!.y - rotatedAtom.y).toBeCloseTo(expectedRotatedVector.y, 2);
    expect(flippedSnap?.selectedCandidate?.kind).toBe('equatorial');
  });

  it('dedupes fused bridgehead chair directions across decalin memberships', () => {
    const baseChair = getStandaloneChairState({ x: 160.995, y: 333.645 });
    const hitBond = findBondByTemplateKey(baseChair.bonds, 'b3');
    const fusedPlacement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      pointer: { x: 196, y: 333 },
      existingAtoms: baseChair.atoms,
      existingBonds: baseChair.bonds,
      hitBond,
    });
    const fusedState = materializeResolvedRingTemplatePlacement(
      fusedPlacement,
      baseChair.atoms,
      baseChair.bonds,
    );
    const sharedBond = fusedState.bonds.find(
      (bond) => bond.id === hitBond.id && bond.ringTemplateMemberships?.length === 2,
    );
    expect(sharedBond).toBeDefined();

    const bridgeheadSnap = resolveChairAttachmentSnapping({
      atomId: sharedBond!.from,
      atoms: fusedState.atoms,
      bonds: fusedState.bonds,
      bondLength: 14.4,
      pointer: { x: 185, y: 320 },
    });

    expect(bridgeheadSnap).not.toBeNull();
    expect(bridgeheadSnap!.candidates.length).toBeLessThan(4);
    expect(
      bridgeheadSnap!.candidates.some(
        (candidate) => candidate.structureIds.length > 1 || candidate.atomKeys.length > 1,
      ),
    ).toBe(true);
  });

  it('prefers the unoccupied chair direction for quick-click placement', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const startAtom = findAtomByTemplateKey(chairState.atoms, 'a0');
    const initialSnap = resolveChairAttachmentSnapping({
      atomId: startAtom.id,
      atoms: chairState.atoms,
      bonds: chairState.bonds,
      bondLength: 14.4,
    });
    const equatorialCandidate = initialSnap?.candidates.find(
      (candidate) => candidate.kind === 'equatorial',
    );
    const axialCandidate = initialSnap?.candidates.find((candidate) => candidate.kind === 'axial');

    expect(initialSnap?.quickClickCandidate?.kind).toBe('equatorial');
    expect(equatorialCandidate).toBeDefined();
    expect(axialCandidate).toBeDefined();

    const equatorialOccupied = addSubstituent(
      chairState.atoms,
      chairState.bonds,
      startAtom.id,
      equatorialCandidate!,
    );
    const axialOccupied = addSubstituent(
      chairState.atoms,
      chairState.bonds,
      startAtom.id,
      axialCandidate!,
    );
    const bothOccupied = addSubstituent(
      equatorialOccupied.atoms,
      equatorialOccupied.bonds,
      startAtom.id,
      axialCandidate!,
    );

    expect(
      resolveChairAttachmentSnapping({
        atomId: startAtom.id,
        atoms: equatorialOccupied.atoms,
        bonds: equatorialOccupied.bonds,
        bondLength: 14.4,
      })?.quickClickCandidate?.kind,
    ).toBe('axial');
    expect(
      resolveChairAttachmentSnapping({
        atomId: startAtom.id,
        atoms: axialOccupied.atoms,
        bonds: axialOccupied.bonds,
        bondLength: 14.4,
      })?.quickClickCandidate?.kind,
    ).toBe('equatorial');
    expect(
      resolveChairAttachmentSnapping({
        atomId: startAtom.id,
        atoms: bothOccupied.atoms,
        bonds: bothOccupied.bonds,
        bondLength: 14.4,
      })?.quickClickCandidate,
    ).toBeUndefined();
  });

  it('returns null when chair metadata is missing or invalid', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const startAtom = findAtomByTemplateKey(chairState.atoms, 'a0');
    const brokenBonds = chairState.bonds.map((bond, index) =>
      index === 0 ? { ...bond, order: 2 } : bond,
    );

    expect(
      resolveChairAttachmentSnapping({
        atomId: 'plain-atom',
        atoms: [{ id: 'plain-atom', x: 0, y: 0, kind: 'element', element: 'C' }],
        bonds: [],
        bondLength: 14.4,
      }),
    ).toBeNull();
    expect(
      resolveChairAttachmentSnapping({
        atomId: startAtom.id,
        atoms: chairState.atoms,
        bonds: brokenBonds,
        bondLength: 14.4,
      }),
    ).toBeNull();
  });

  it('uses the same resolved geometry for preview and insertion, reusing the shared bond', () => {
    const baseChair = getStandaloneChairState({ x: 160.995, y: 333.645 });
    const hitBond = findBondByTemplateKey(baseChair.bonds, 'b3');
    const placement = resolveRingTemplatePlacement({
      preset: 'chair',
      bondLength: 14.4,
      pointer: { x: 196, y: 333 },
      existingAtoms: baseChair.atoms,
      existingBonds: baseChair.bonds,
      hitBond,
    });
    const nextState = materializeResolvedRingTemplatePlacement(
      placement,
      baseChair.atoms,
      baseChair.bonds,
    );

    const baseBondIds = new Set(baseChair.bonds.map((bond) => bond.id));
    const previewSegments = getSegmentsForBonds(
      placement.atoms.map((atom, index) => ({
        id: `preview-${index}`,
        x: atom.x,
        y: atom.y,
        kind: 'element',
        element: atom.element,
      })),
      placement.bonds
        .filter((_, index) => !placement.skippedBondIndices.has(index))
        .map((bond, index) => ({
          id: `preview-bond-${index}`,
          from: `preview-${bond.from}`,
          to: `preview-${bond.to}`,
          order: bond.order,
        })),
    );
    const insertedSegments = getSegmentsForBonds(
      nextState.atoms,
      nextState.bonds.filter((bond) => !baseBondIds.has(bond.id)),
    );

    expect(insertedSegments).toEqual(previewSegments);
    expect(nextState.bonds).toHaveLength(baseChair.bonds.length + 5);
  });

  it('strips chair metadata when a chair bond no longer matches the template topology', () => {
    const chairState = getStandaloneChairState({ x: 120, y: 140 });
    const brokenState = sanitizeRingTemplateState({
      atoms: chairState.atoms,
      bonds: chairState.bonds.map((bond, index) => (index === 0 ? { ...bond, order: 2 } : bond)),
      arrows: [],
      groups: [],
      textBoxes: [],
    });

    expect(brokenState.atoms.every((atom) => !atom.ringTemplateMemberships?.length)).toBe(true);
    expect(brokenState.bonds.every((bond) => !bond.ringTemplateMemberships?.length)).toBe(true);
  });

  it('leaves regular polygon placement unchanged', () => {
    const geometry = getRegularRingGeometry({ x: 50, y: 75 }, 14.4, 6);
    expect(geometry.atoms).toHaveLength(6);
    expect(geometry.bonds).toHaveLength(6);
    expect(geometry.atoms[0]!.x).toBeCloseTo(50, 3);
    expect(geometry.atoms[0]!.y).toBeLessThan(75);
    expect(geometry.bonds[0]).toMatchObject({ from: 0, to: 1, order: 1 });
  });
});
