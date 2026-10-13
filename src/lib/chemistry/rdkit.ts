import type { RdkitModule } from '../../types/rdkit';
import { normalizeMolblockBondLength, parseMolblockGeometry } from '../graph';
import type { ChemistryResult, ChemistryService } from './service';

/** A headless adapter; all WASM objects are disposed even on malformed replies. */
export function createRDKitChemistryService(rdkit: RdkitModule | null): ChemistryService {
  const failure = (
    message: string,
    code: 'invalid-result' | 'stereo' | 'unavailable' = 'invalid-result',
  ) => ({ ok: false, code, message }) as const;
  const identity = (molblock: string): string => {
    const mol = rdkit?.get_mol(molblock);
    if (!mol) throw new Error('RDKit could not read the structure.');
    try {
      return mol.get_smiles();
    } finally {
      mol.delete();
    }
  };
  const validateIdentity = (before: string, candidate: string): ChemistryResult<true> => {
    if (!rdkit) return failure('RDKit is unavailable.', 'unavailable');
    try {
      const source = identity(before);
      if (!source || source !== identity(candidate))
        return failure(
          'Cleanup cannot preserve connectivity and stereochemical identity with the retained bond displays.',
          'stereo',
        );
      return { ok: true, value: true };
    } catch (error) {
      return failure(String(error), 'stereo');
    }
  };
  return {
    capabilities: {
      layout: Boolean(rdkit),
      stereo: Boolean(rdkit),
      ...(!rdkit ? { reason: 'RDKit is unavailable.' } : {}),
    },
    validateIdentity,
    async layout(request) {
      if (request.signal?.aborted)
        return { ok: false, code: 'cancelled', message: 'Cleanup cancelled.' };
      if (!rdkit) return failure('RDKit is unavailable.', 'unavailable');
      let mol: ReturnType<RdkitModule['get_mol']> = null;
      try {
        mol = rdkit.get_mol(request.molblock);
        if (!mol) return failure('RDKit could not read the structure.');
        if (!mol.set_new_coords || !mol.get_molblock)
          return failure('RDKit layout is unavailable.', 'unavailable');
        mol.set_new_coords();
        const output = mol.get_molblock();
        const parsed = parseMolblockGeometry(output, 1);
        if (!parsed || parsed.atoms.length !== request.atomMap.size)
          return failure('Layout returned an invalid atom count.');
        const correspondence = new Set<number>();
        for (const atom of parsed.atoms) {
          if (
            !atom.mapNumber ||
            !request.atomMap.has(atom.mapNumber) ||
            correspondence.has(atom.mapNumber)
          )
            return failure('Layout returned missing, duplicate or unknown atom maps.');
          correspondence.add(atom.mapNumber);
        }
        const input = parseMolblockGeometry(request.molblock, 1);
        if (!input) return failure('Invalid input geometry.');
        const topology = (g: typeof parsed) =>
          JSON.stringify(
            g.bonds
              .map((b) => {
                const maps = [g.atoms[b.from]?.mapNumber, g.atoms[b.to]?.mapNumber].sort(
                  (a, b) => (a ?? 0) - (b ?? 0),
                );
                return `${maps.join(':')}:${b.order}`;
              })
              .sort(),
          );
        if (topology(input) !== topology(parsed)) return failure('Layout changed connectivity.');
        for (const atom of parsed.atoms) {
          const original = input.atoms.find((a) => a.mapNumber === atom.mapNumber);
          if (
            !original ||
            ['element', 'charge', 'isotope', 'radicalElectrons'].some((key) => {
              const k = key as 'element' | 'charge' | 'isotope' | 'radicalElectrons';
              return (original[k] ?? 0) !== (atom[k] ?? 0);
            })
          )
            return failure('Layout changed atom properties.');
        }
        const check = validateIdentity(request.molblock, output);
        if (!check.ok) return check;
        const geometry = normalizeMolblockBondLength(parsed, request.bondLength);
        const coordinates = new Map(
          geometry.atoms.map((atom) => [
            request.atomMap.get(atom.mapNumber!)!,
            { x: atom.x, y: atom.y },
          ]),
        );
        if ([...coordinates.values()].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
          return failure('Layout returned non-finite coordinates.');
        if (request.signal?.aborted)
          return { ok: false, code: 'cancelled', message: 'Cleanup cancelled.' };
        return { ok: true, value: coordinates };
      } catch (error) {
        return failure(`Structure cleanup failed: ${String(error)}`);
      } finally {
        mol?.delete();
      }
    },
    async validate(molblock, objectIds) {
      if (!rdkit)
        return [
          {
            code: 'engine-unavailable',
            severity: 'info',
            message: 'RDKit checks are unavailable.',
            objectIds: [],
            availability: 'unavailable',
          },
        ];
      try {
        identity(molblock);
        return [];
      } catch {
        return [
          {
            code: 'invalid-chemistry',
            severity: 'error',
            message: 'RDKit cannot validate this structure.',
            objectIds,
            availability: 'available',
          },
        ];
      }
    },
  };
}
