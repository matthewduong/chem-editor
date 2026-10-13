import type { ChemDrawDocument } from '../../types/chemdraw';
import { chemDrawDocumentToCanvasState } from '../chemdrawModel';
import { getConnectedComponents, graphToMolblock } from '../graph';
import { CHAIR_ATTACHMENT_DEDUPE_DISTANCE_FRACTION } from '../ringTemplates';
import type { ChemistryDiagnostic, ChemistryService } from './service';
import { checkValence } from './valence';

export async function checkStructure(
  document: ChemDrawDocument,
  service: ChemistryService,
): Promise<ChemistryDiagnostic[]> {
  const objects = document.pages[0]?.objects ?? [];
  const ids = new Set(objects.map((o) => o.id));
  const issues: ChemistryDiagnostic[] = [];
  const add = (
    code: string,
    severity: ChemistryDiagnostic['severity'],
    message: string,
    objectIds: string[],
    availability: ChemistryDiagnostic['availability'] = 'available',
  ) => issues.push({ code, severity, message, objectIds, availability });
  const nodes = objects.filter((o) => o.type === 'node');
  const nodeIds = new Set(nodes.map((o) => o.id));
  const duplicatePairs = new Map<string, string>();
  for (const o of objects) {
    const refs =
      o.type === 'bond'
        ? [o.beginNodeId, o.endNodeId]
        : o.type === 'fragment'
          ? [...o.nodeIds, ...o.bondIds]
          : o.type === 'group'
            ? o.childIds
            : o.type === 'graphic' && o.representedObjectId
              ? [o.representedObjectId]
              : [];
    if (
      refs.some((id) => !ids.has(id)) ||
      (o.type === 'bond' && refs.some((id) => !nodeIds.has(id)))
    )
      add('invalid-reference', 'error', `Object ${o.id} has missing or invalid references.`, [
        o.id,
      ]);
    if (o.type === 'bond') {
      const key = [o.beginNodeId, o.endNodeId].sort().join('\0');
      const duplicate = duplicatePairs.get(key);
      if (duplicate)
        add('duplicate-bond', 'error', 'Two bonds connect the same atoms.', [
          duplicate,
          o.id,
          o.beginNodeId,
          o.endNodeId,
        ]);
      duplicatePairs.set(key, o.id);
      if (o.beginNodeId === o.endNodeId)
        add('self-bond', 'error', 'A bond connects an atom to itself.', [o.id, o.beginNodeId]);
    }
    if (
      (o.type === 'node' && o.query) ||
      (o.type === 'bond' && (o.query || o.display === 'dative')) ||
      (['node', 'bond', 'fragment'].includes(o.type) &&
        (o.preservation?.capability ?? 'editable') !== 'editable')
    )
      add(
        'preserved-unsupported',
        'info',
        `Object ${o.id} contains preserved chemistry that these checks cannot validate.`,
        [o.id],
        'unavailable',
      );
    if (o.type === 'node' && o.alias && !o.aliasResolution?.selectedCandidateId)
      add(
        'unresolved-alias',
        'warning',
        `Resolve the alias “${o.alias}” before using chemistry checks.`,
        [o.id],
        'unavailable',
      );
  }
  const { atoms, bonds } = chemDrawDocumentToCanvasState(document).state;
  const length = document.metadata?.documentStyleSettings?.bondLength ?? 14.4;
  const tolerance = length * CHAIR_ATTACHMENT_DEDUPE_DISTANCE_FRACTION;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      if (Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < tolerance)
        add('overlapping-atoms', 'warning', 'Atoms occupy overlapping positions.', [a.id, b.id]);
    }
  }
  for (const component of getConnectedComponents(atoms, bonds)) {
    const unsupported =
      objects.some(
        (o) =>
          component.has(o.id) &&
          o.type === 'node' &&
          (o.alias || o.query || (o.preservation?.capability ?? 'editable') !== 'editable'),
      ) ||
      objects.some(
        (o) =>
          o.type === 'bond' &&
          component.has(o.beginNodeId) &&
          (o.query ||
            o.display === 'dative' ||
            (o.preservation?.capability ?? 'editable') !== 'editable'),
      );
    if (unsupported) continue;
    const a = atoms.filter((a) => component.has(a.id));
    const b = bonds.filter((b) => component.has(b.from) && component.has(b.to));
    for (const atom of a) {
      const sum = b
        .filter((b) => b.from === atom.id || b.to === atom.id)
        .reduce((sum, b) => sum + b.order, 0);
      const result = checkValence(atom.element, atom.charge ?? 0, atom.radicalElectrons ?? 0, sum);
      if (!result.ok)
        add(
          'invalid-valence',
          'error',
          `${atom.element} has bond order ${sum}, exceeding its supported valence ${result.allowed[result.allowed.length - 1]}.`,
          [atom.id],
        );
    }
    // A wedge or hash is drawn from the stereocenter (narrow end). These are drawing errors
    // that the molfile route silently turns into wrong chemistry, so they are reported; the
    // document is never changed.
    for (const o of objects) {
      if (o.type !== 'bond' || !component.has(o.beginNodeId)) continue;
      const display = o.display;
      if (
        display !== 'wedge-begin' &&
        display !== 'wedge-end' &&
        display !== 'hash-begin' &&
        display !== 'hash-end'
      )
        continue;
      const narrowId = display.endsWith('-begin') ? o.beginNodeId : o.endNodeId;
      const narrow = a.find((atom) => atom.id === narrowId);
      if (!narrow) continue;
      const touching = b.filter((bond) => bond.from === narrowId || bond.to === narrowId);
      if (touching.length === 1) {
        add(
          'stereo-bond-terminal-center',
          'warning',
          'A wedge or hash starts at an atom with no other bonds. Its narrow end belongs at the stereocenter.',
          [o.id, narrowId],
        );
      } else if (
        ['C', 'N'].includes(narrow.element) &&
        touching.some((bond) => bond.order >= 2 || !Number.isInteger(bond.order))
      ) {
        add(
          'stereo-bond-sp2-center',
          'warning',
          `A wedge or hash starts at a ${narrow.element} with a double, triple or aromatic bond, which is not a tetrahedral stereocenter.`,
          [o.id, narrowId],
        );
      }
    }
    if (a.length > 999) {
      add(
        'engine-size-limit',
        'info',
        'Engine validation supports at most 999 atoms per molecule.',
        [...component],
        'unavailable',
      );
      continue;
    }
    try {
      issues.push(
        ...(await service.validate(graphToMolblock(a, b, 0, 0, undefined, true).molblock, [
          ...component,
        ])),
      );
    } catch (error) {
      add(
        'engine-unavailable',
        'info',
        `Engine validation failed: ${String(error)}`,
        [...component],
        'unavailable',
      );
    }
  }
  if (!service.capabilities.layout && !issues.some((i) => i.code === 'engine-unavailable'))
    add(
      'engine-unavailable',
      'info',
      service.capabilities.reason ?? 'RDKit checks are unavailable.',
      [],
      'unavailable',
    );
  // The installed minimal API can compare stereo identities, but does not expose a reliable
  // completeness/ambiguity checker. Never label a successful parse a passed stereo check.
  add(
    'stereo-check-unavailable',
    'info',
    'Stereo completeness and ambiguity checks are unavailable in the installed RDKit API.',
    [],
    'unavailable',
  );
  return issues;
}
