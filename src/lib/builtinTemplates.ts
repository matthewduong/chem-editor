import type { ChemDrawBond, ChemDrawDocument, ChemDrawNode } from '../types/chemdraw';
import { BUILTIN_TEMPLATE_DATA } from './builtinTemplates.data';
import type { UserTemplate } from './templates';

/** One imported ring/fragment, in units of one bond length, y down, centred on its centroid. */
export interface BuiltinTemplateSource {
  id: string;
  name: string;
  group: string;
  attachAtom: number | null;
  attachBond: number | null;
  atoms: Array<{ element: string; x: number; y: number; charge?: number }>;
  bonds: Array<{ a: number; b: number; order: number }>;
}

/**
 * Read-only templates bundled with the application, scaled to `bondLength` so the fragment
 * matches the document's drawing style rather than a baked-in pixel size. The geometry is
 * imported from Ketcher (see NOTICE) and then gated for regular bond lengths.
 */
export function buildBuiltinTemplates(bondLength: number): UserTemplate[] {
  if (!Number.isFinite(bondLength) || bondLength <= 0) throw new Error('Invalid bond length.');
  return BUILTIN_TEMPLATE_DATA.map((source): UserTemplate => {
    const nodes: ChemDrawNode[] = source.atoms.map((atom, i) => ({
      id: `a${i}`,
      type: 'node',
      position: { x: atom.x * bondLength, y: atom.y * bondLength },
      element: atom.element,
      ...(atom.charge ? { charge: atom.charge } : {}),
    }));
    const bonds: ChemDrawBond[] = source.bonds.map((bond, i) => ({
      id: `b${i}`,
      type: 'bond',
      beginNodeId: `a${bond.a}`,
      endNodeId: `a${bond.b}`,
      order: bond.order,
    }));
    const fragment: ChemDrawDocument = {
      schemaVersion: 1,
      source: 'canvas-state',
      pages: [
        {
          id: 'page',
          objects: [
            ...nodes,
            ...bonds,
            {
              id: 'f0',
              type: 'fragment',
              nodeIds: nodes.map((n) => n.id),
              bondIds: bonds.map((b) => b.id),
            },
          ],
        },
      ],
    };
    return {
      id: `builtin:${source.id}`,
      name: source.name,
      tags: [source.group],
      fragment,
      ...(source.attachAtom !== null
        ? { attachment: { atomId: `a${source.attachAtom}` } }
        : source.attachBond !== null
          ? { attachment: { bondId: `b${source.attachBond}` } }
          : {}),
    };
  });
}

export const isBuiltinTemplate = (template: Pick<UserTemplate, 'id'>) =>
  template.id.startsWith('builtin:');
