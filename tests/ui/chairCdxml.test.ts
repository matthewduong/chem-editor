import { describe, expect, it } from 'vitest';

import type { CanvasState } from '../../src/types/chemistry';
import type { ChemDrawBond, ChemDrawNode } from '../../src/types/chemdraw';
import {
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../../src/lib/chemdrawModel';
import {
  materializeResolvedRingTemplatePlacement,
  resolveRingTemplatePlacement,
} from '../../src/lib/ringTemplates';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML } from '../../src/utils/cdxml';

function buildStandaloneChairState(center: { x: number; y: number }): CanvasState {
  const placement = resolveRingTemplatePlacement({
    preset: 'chair',
    bondLength: 14.4,
    center,
    existingAtoms: [],
    existingBonds: [],
  });
  const state = materializeResolvedRingTemplatePlacement(placement, [], []);
  return { ...state, arrows: [], groups: [], textBoxes: [] };
}

function buildFusedChairState(preset: 'chair' | 'chair-flipped'): CanvasState {
  const baseState = buildStandaloneChairState(
    preset === 'chair' ? { x: 160.995, y: 333.645 } : { x: 254.105, y: 335.195 },
  );
  const hitBond = baseState.bonds.find((bond) =>
    bond.ringTemplateMemberships?.some(
      (membership) => membership.bondKey === (preset === 'chair' ? 'b3' : 'b2'),
    ),
  );
  if (!hitBond) {
    throw new Error('Missing chair fusion bond.');
  }
  const placement = resolveRingTemplatePlacement({
    preset,
    bondLength: 14.4,
    pointer: preset === 'chair' ? { x: 196, y: 333 } : { x: 268, y: 361 },
    existingAtoms: baseState.atoms,
    existingBonds: baseState.bonds,
    hitBond,
  });
  const state = materializeResolvedRingTemplatePlacement(
    placement,
    baseState.atoms,
    baseState.bonds,
  );
  return { ...state, arrows: [], groups: [], textBoxes: [] };
}

function getNodeObjects(state: CanvasState) {
  return canvasStateToChemDrawDocument(state).document.pages[0]!.objects.filter(
    (object): object is ChemDrawNode => object.type === 'node',
  );
}

function getBondObjects(state: CanvasState) {
  return canvasStateToChemDrawDocument(state).document.pages[0]!.objects.filter(
    (object): object is ChemDrawBond => object.type === 'bond',
  );
}

describe('chair CDXML fidelity', () => {
  it('emits native bridgehead stereo metadata for both chair presets', () => {
    for (const preset of ['chair', 'chair-flipped'] as const) {
      const state = buildFusedChairState(preset);
      const nodes = getNodeObjects(state);
      const bonds = getBondObjects(state);
      const bridgeheads = nodes.filter(
        (node) =>
          node.geometry === 'Tetrahedral' &&
          (node.atomStereo === 'r' || node.atomStereo === 's') &&
          node.bondOrdering?.length === 4,
      );
      const sharedBond = bonds.find(
        (bond) =>
          bond.ringTemplateMemberships?.filter((membership) => membership.family === 'chair')
            .length === 2,
      );

      expect(bridgeheads).toHaveLength(2);
      expect(sharedBond).toBeDefined();
      expect(
        bridgeheads.every((node) => node.atomStereo === (preset === 'chair' ? 'r' : 's')),
      ).toBe(true);
      expect(
        bridgeheads.every((node) => node.bondOrdering?.includes(sharedBond!.id) === true),
      ).toBe(true);

      const sharedBondDuplicates = bonds.filter(
        (bond) =>
          sharedBond &&
          ((bond.beginNodeId === sharedBond.beginNodeId &&
            bond.endNodeId === sharedBond.endNodeId) ||
            (bond.beginNodeId === sharedBond.endNodeId &&
              bond.endNodeId === sharedBond.beginNodeId)),
      );
      expect(sharedBondDuplicates).toHaveLength(1);

      const xml = chemDrawDocumentToCDXML(canvasStateToChemDrawDocument(state).document);
      expect(xml).toContain('Geometry="Tetrahedral"');
      expect(xml).toContain(`AS="${preset === 'chair' ? 'r' : 's'}"`);
      expect(xml).toContain('BondOrdering="');
      expect(xml).toContain('ChemEditorRingTemplateAtomMemberships=');
      expect(xml).toContain('ChemEditorRingTemplateBondMemberships=');
    }
  });

  it('round-trips chair memberships and reused-bond ordering through CDXML', () => {
    const state = buildFusedChairState('chair');
    const exported = chemDrawDocumentToCDXML(canvasStateToChemDrawDocument(state).document);
    const importedDocument = cdxmlToChemDrawDocument(exported).document;
    const importedState = chemDrawDocumentToCanvasState(importedDocument).state;

    const sharedBond = importedState.bonds.find(
      (bond) =>
        bond.ringTemplateMemberships?.filter((membership) => membership.family === 'chair')
          .length === 2,
    );
    const bridgeheads = importedState.atoms.filter((atom) =>
      atom.ringTemplateMemberships?.some((membership) => membership.nativeStereo?.as === 'r'),
    );

    expect(sharedBond).toBeDefined();
    expect(bridgeheads).toHaveLength(2);
    expect(
      bridgeheads.every((atom) =>
        atom.ringTemplateMemberships?.some(
          (membership) =>
            membership.nativeStereo?.bondOrdering.includes(sharedBond!.id) &&
            membership.nativeStereo.bondOrdering.length === 4,
        ),
      ),
    ).toBe(true);
  });
});
