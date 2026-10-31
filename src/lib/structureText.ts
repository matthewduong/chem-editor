import type { RdkitModule } from '../types/rdkit';

export type StructureTextFormat = 'smiles' | 'inchi' | 'inchikey' | 'molfile';

/** Enhanced stereo groups by 1-based molfile atom index. */
export interface EnhancedStereoGroups {
  absolute: number[];
  and: Map<number, number[]>;
  or: Map<number, number[]>;
}

/**
 * Edit > Copy As (ChemDraw 17.1 guide, "Copy As"): the structure as SMILES, InChI, InChIKey or a
 * molfile, by RDKit from `molblock`. A molfile with enhanced stereo groups is V3000 with the
 * groups as `MDLV30/STEABS`, `MDLV30/STERACn` (AND) and `MDLV30/STERELn` (OR) collections, the
 * form V2000 cannot hold; otherwise it is V2000.
 */
export function structureAsText(
  rdkit: RdkitModule,
  molblock: string,
  format: StructureTextFormat,
  groups?: EnhancedStereoGroups,
): string | null {
  const mol = rdkit.get_mol(molblock);
  if (!mol) return null;
  try {
    if (format === 'smiles') return mol.get_smiles();
    if (format === 'inchi' || format === 'inchikey') {
      const inchi = mol.get_inchi?.() ?? '';
      if (!inchi) return null;
      return format === 'inchi' ? inchi : (rdkit.get_inchikey_for_inchi?.(inchi) ?? null);
    }
    const hasGroups =
      groups && (groups.absolute.length > 0 || groups.and.size > 0 || groups.or.size > 0);
    if (!hasGroups) return mol.get_molblock?.() ?? null;
    const v3000 = mol.get_v3Kmolblock?.();
    return v3000 ? withStereoCollections(v3000, groups) : null;
  } finally {
    mol.delete();
  }
}

/** Adds (or replaces) the enhanced stereo collection block of a V3000 molfile. */
export function withStereoCollections(v3000: string, groups: EnhancedStereoGroups): string {
  const atoms = (indices: number[]) => `ATOMS=(${indices.length} ${indices.join(' ')})`;
  const lines = [
    ...(groups.absolute.length ? [`M  V30 MDLV30/STEABS ${atoms(groups.absolute)}`] : []),
    ...[...groups.and].map(([n, indices]) => `M  V30 MDLV30/STERAC${n} ${atoms(indices)}`),
    ...[...groups.or].map(([n, indices]) => `M  V30 MDLV30/STEREL${n} ${atoms(indices)}`),
  ];
  const withoutOld = v3000.replace(
    /M {2}V30 BEGIN COLLECTION[\s\S]*?M {2}V30 END COLLECTION\n/,
    '',
  );
  return withoutOld.replace(
    'M  V30 END CTAB',
    ['M  V30 BEGIN COLLECTION', ...lines, 'M  V30 END COLLECTION', 'M  V30 END CTAB'].join('\n'),
  );
}
