export interface RdkitMol {
  get_smiles(): string;
  get_svg(width: number, height: number): string;
  delete(): void;
  get_json?(): string;
  get_molblock?(): string;
  get_svg_with_highlights?(details: string): string;
  set_new_coords?(): void;
}

export interface RdkitModule {
  get_mol(input: string, details?: string): RdkitMol | null;
}
