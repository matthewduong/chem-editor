export interface RdkitMol {
  get_smiles(): string;
  get_svg(width: number, height: number): string;
  delete(): void;
  get_json?(): string;
  get_molblock?(): string;
  get_svg_with_highlights?(details: string): string;
  set_new_coords?(): void;
  /** CIP labels: JSON `{CIP_atoms: [[index, "(R)"]…], CIP_bonds: [[begin, end, "(E)"]…]}`. */
  get_stereo_tags?(): string;
  /** RDKit descriptors as JSON, including `exactmw` and `amw`. */
  get_descriptors?(): string;
  get_inchi?(): string;
  get_v3Kmolblock?(): string;
}

export interface RdkitModule {
  get_mol(input: string, details?: string): RdkitMol | null;
  get_inchikey_for_inchi?(inchi: string): string;
}
