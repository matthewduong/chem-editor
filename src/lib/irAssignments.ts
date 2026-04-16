export interface IrAssignment {
  label: string;
  group: string;
}

// Ranges sorted high-to-low; first match wins.
const ASSIGNMENTS: Array<{ min: number; max: number } & IrAssignment> = [
  { min: 3590, max: 3650, label: 'O-H stretch (free)', group: 'Hydroxyl' },
  { min: 3200, max: 3580, label: 'O-H stretch (H-bonded)', group: 'Hydroxyl' },
  { min: 3300, max: 3500, label: 'N-H stretch', group: 'Amine/Amide' },
  { min: 3280, max: 3340, label: 'C≡C-H stretch', group: 'Terminal alkyne' },
  { min: 3000, max: 3100, label: '=C-H stretch', group: 'Alkene/Arene' },
  { min: 2850, max: 3000, label: 'C-H stretch', group: 'Alkyl' },
  { min: 2690, max: 2850, label: 'O-H stretch', group: 'Carboxylic acid' },
  { min: 2500, max: 2700, label: 'S-H stretch', group: 'Thiol' },
  { min: 2100, max: 2260, label: 'C≡N stretch', group: 'Nitrile' },
  { min: 2100, max: 2150, label: 'C≡C stretch', group: 'Alkyne' },
  { min: 1800, max: 1850, label: 'C=O stretch', group: 'Acid anhydride' },
  { min: 1735, max: 1760, label: 'C=O stretch', group: 'Ester' },
  { min: 1715, max: 1740, label: 'C=O stretch', group: 'Aldehyde' },
  { min: 1700, max: 1725, label: 'C=O stretch', group: 'Ketone/Carboxylic acid' },
  { min: 1650, max: 1700, label: 'C=O stretch', group: 'Amide' },
  { min: 1620, max: 1680, label: 'C=C stretch', group: 'Alkene' },
  { min: 1580, max: 1620, label: 'N-H bend', group: 'Amine/Amide' },
  { min: 1500, max: 1560, label: 'N-O stretch (asymm)', group: 'Nitro' },
  { min: 1470, max: 1500, label: 'C-H bend', group: 'Methylene' },
  { min: 1370, max: 1390, label: 'C-H bend', group: 'Methyl' },
  { min: 1340, max: 1380, label: 'N-O stretch (symm)', group: 'Nitro' },
  { min: 1200, max: 1300, label: 'C-O stretch', group: 'Ester/Acid' },
  { min: 1050, max: 1200, label: 'C-O stretch', group: 'Ether/Alcohol' },
  { min: 900, max: 1000, label: '=C-H wag', group: 'Alkene' },
  { min: 690, max: 900, label: '=C-H bending', group: 'Arene' },
  { min: 600, max: 700, label: 'C-Cl stretch', group: 'Chloroalkyl' },
];

export function assignIrPeak(wavenumber: number): IrAssignment | null {
  for (const entry of ASSIGNMENTS) {
    if (wavenumber >= entry.min && wavenumber <= entry.max) {
      return { label: entry.label, group: entry.group };
    }
  }
  return null;
}
