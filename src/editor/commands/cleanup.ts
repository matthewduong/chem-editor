import type { ChemDrawDocument, ChemDrawPoint } from '../../types/chemdraw';
import type { ChemistryService } from '../../lib/chemistry/service';
import { chemDrawDocumentToCanvasState } from '../../lib/chemdrawModel';
import { getConnectedComponents, graphToMolblock } from '../../lib/graph';
import type { EditorCommand } from '../types';

/** Prepare atomically. This never mutates the source or any editor state. */
export async function prepareCleanupCommand(
  source: ChemDrawDocument,
  selection: ReadonlySet<string>,
  service: ChemistryService,
  bondLength: number,
  signal?: AbortSignal,
): Promise<EditorCommand> {
  const page = source.pages[0];
  if (!page) throw new Error('No editable page.');
  if (!service.capabilities.layout)
    throw new Error(service.capabilities.reason ?? 'Layout is unavailable.');
  const { atoms, bonds } = chemDrawDocumentToCanvasState(source).state;
  if (!Number.isFinite(bondLength) || bondLength <= 0)
    throw new Error('Invalid document bond length.');
  const atomIds = new Set(atoms.map((a) => a.id));
  if (bonds.some((b) => !atomIds.has(b.from) || !atomIds.has(b.to)))
    throw new Error('Cleanup cannot process dangling bond references.');
  const byId = new Map(page.objects.map((o) => [o.id, o]));
  const selected = new Set(selection);
  const expand = (id: string) => {
    const o = byId.get(id);
    const children =
      o?.type === 'group' ? o.childIds : o?.type === 'fragment' ? [...o.nodeIds, ...o.bondIds] : [];
    for (const child of children)
      if (!selected.has(child)) {
        selected.add(child);
        expand(child);
      }
  };
  [...selected].forEach(expand);
  const components = getConnectedComponents(atoms, bonds).filter(
    (ids) =>
      !selection.size ||
      [...ids].some((id) => selected.has(id)) ||
      bonds.some((b) => selected.has(b.id) && ids.has(b.from)),
  );
  if (!components.length)
    throw new Error(
      'Select a complete molecule to clean; the selection contains no chemical objects.',
    );
  for (const ids of components) {
    if (selection.size && [...ids].some((id) => !selected.has(id)))
      throw new Error(
        'Cleanup requires every atom in each selected molecule. Partial selections are not expanded.',
      );
    const affected = new Set([
      ...ids,
      ...bonds.filter((b) => ids.has(b.from) || ids.has(b.to)).map((b) => b.id),
    ]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const o of page.objects) {
        const children = o.type === 'group' ? o.childIds : o.type === 'fragment' ? o.nodeIds : [];
        if (!affected.has(o.id) && children.some((id) => affected.has(id))) {
          affected.add(o.id);
          expanded = true;
        }
      }
    }
    for (const o of page.objects) {
      if (!affected.has(o.id)) continue;
      if ((o.preservation?.capability ?? 'editable') !== 'editable')
        throw new Error(`Object ${o.id} restricts editing; cleanup was not applied.`);
      if (
        (o.type === 'node' && (o.query || o.alias || o.atomStereo || o.bondOrdering)) ||
        (o.type === 'bond' &&
          (o.query ||
            o.secondaryDisplay ||
            o.aromatic ||
            ![1, 2, 3].includes(o.order ?? 1) ||
            (o.display &&
              !['solid', 'bold', 'wedge-begin', 'wedge-end', 'hash-begin', 'hash-end'].includes(
                o.display,
              ))))
      )
        throw new Error(
          `Object ${o.id} has alias, query or stereo properties that cleanup cannot safely validate.`,
        );
    }
  }
  const positions = new Map<string, ChemDrawPoint>();
  for (const ids of components) {
    if (signal?.aborted) throw new Error('Cleanup cancelled.');
    const a = atoms.filter((a) => ids.has(a.id));
    const b = bonds.filter((b) => ids.has(b.from) && ids.has(b.to));
    if (a.length > 999) throw new Error('Cleanup supports at most 999 atoms per molecule.');
    const input = graphToMolblock(a, b, 0, 0, undefined, true).molblock;
    const result = await service.layout({
      molblock: input,
      atomMap: new Map(a.map((a, i) => [i + 1, a.id])),
      bondLength,
      signal,
    });
    if (!result.ok) throw new Error(result.message);
    if (
      result.value.size !== a.length ||
      [...result.value].some(
        ([id, p]) => !ids.has(id) || !Number.isFinite(p.x) || !Number.isFinite(p.y),
      )
    )
      throw new Error('Layout returned invalid coordinate correspondence.');
    const cx = a.reduce((s, a) => s + a.x, 0) / a.length;
    const cy = a.reduce((s, a) => s + a.y, 0) / a.length;
    const nx = [...result.value.values()].reduce((s, p) => s + p.x, 0) / a.length;
    const ny = [...result.value.values()].reduce((s, p) => s + p.y, 0) / a.length;
    const candidate = a.map((atom) => {
      const p = result.value.get(atom.id);
      if (!p) throw new Error('Layout omitted an atom.');
      const position = { x: p.x + cx - nx, y: p.y + cy - ny };
      positions.set(atom.id, position);
      return { ...atom, ...position };
    });
    // Rebuild from original bonds, never from RDKit's regenerated wedge directions.
    const verified = service.validateIdentity(
      input,
      graphToMolblock(candidate, b, 0, 0, undefined, true).molblock,
    );
    if (!verified.ok) throw new Error(verified.message);
  }
  if (signal?.aborted) throw new Error('Cleanup cancelled.');
  return {
    type: 'cleanup-coordinates',
    apply(document) {
      if (document !== source) throw new Error('The document changed during cleanup.');
      if (signal?.aborted) throw new Error('Cleanup cancelled.');
      const objects = page.objects.map((o) =>
        o.type === 'node' && positions.has(o.id) ? { ...o, position: positions.get(o.id)! } : o,
      );
      return {
        document: { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] },
        inversePatch: {
          type: 'undo-cleanup',
          apply: () => ({
            document,
            inversePatch: null,
            changedObjectIds: new Set(positions.keys()),
          }),
        },
        changedObjectIds: new Set(positions.keys()),
      };
    },
  };
}
