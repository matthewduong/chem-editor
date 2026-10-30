import type { ChemDrawAtomQueryProperties, ChemDrawBondRxnParticipation } from '../types/chemdraw';

/**
 * Atom and bond query properties as CDXML writes them (the DTD in development/reference/cdxml):
 * which attribute holds each, and which values it may take. A value outside the DTD is not read,
 * so the attribute stays raw and is written back as the file had it.
 */
const ENUMS = {
  ringBondCount: ['SpiroOrHigher', 'Fusion', 'SimpleRing', 'AsDrawn', 'NoRingBonds'],
  unsaturatedBonds: ['MustBeAbsent', 'MustBePresent'],
  rxnStereo: ['Inversion', 'Retention'],
  translation: ['Broad', 'Narrow', 'Any'],
  isotopicAbundance: ['Any', 'Natural', 'Enriched', 'Deficient', 'Nonnatural'],
} as const;

const ATTRIBUTES = {
  substituentsExactly: 'SubstituentsExactly',
  substituentsUpTo: 'SubstituentsUpTo',
  freeSites: 'FreeSites',
  ringBondCount: 'RingBondCount',
  unsaturatedBonds: 'UnsaturatedBonds',
  implicitHydrogens: 'ImplicitHydrogens',
  rxnChange: 'RxnChange',
  rxnStereo: 'RxnStereo',
  translation: 'Translation',
  isotopicAbundance: 'IsotopicAbundance',
} as const satisfies Record<keyof ChemDrawAtomQueryProperties, string>;

const COUNTS = ['substituentsExactly', 'substituentsUpTo', 'freeSites'] as const;
const FLAGS = ['implicitHydrogens', 'rxnChange'] as const;

export function readAtomQueryProperties(get: (name: string) => string | null): {
  properties?: ChemDrawAtomQueryProperties;
  handled: string[];
} {
  const properties: ChemDrawAtomQueryProperties = {};
  const handled: string[] = [];
  for (const key of COUNTS) {
    const raw = get(ATTRIBUTES[key]);
    if (raw == null) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) continue;
    properties[key] = value;
    handled.push(ATTRIBUTES[key]);
  }
  for (const key of FLAGS) {
    const raw = get(ATTRIBUTES[key]);
    if (raw !== 'yes' && raw !== 'no') continue;
    // "no" is the DTD default; reading it is handling it.
    if (raw === 'yes') properties[key] = true;
    handled.push(ATTRIBUTES[key]);
  }
  for (const key of Object.keys(ENUMS) as Array<keyof typeof ENUMS>) {
    const raw = get(ATTRIBUTES[key]);
    if (raw == null) continue;
    const isDefault = raw === 'Unspecified' || (key === 'translation' && raw === 'Equal');
    if (!isDefault && !(ENUMS[key] as readonly string[]).includes(raw)) continue;
    if (!isDefault) (properties as Record<string, string>)[key] = raw;
    handled.push(ATTRIBUTES[key]);
  }
  return Object.keys(properties).length ? { properties, handled } : { handled };
}

export function writeAtomQueryProperties(
  properties: ChemDrawAtomQueryProperties | undefined,
): string {
  if (!properties) return '';
  let attrs = '';
  for (const [key, attribute] of Object.entries(ATTRIBUTES) as Array<
    [keyof ChemDrawAtomQueryProperties, string]
  >) {
    const value = properties[key];
    if (value == null || value === false) continue;
    attrs += ` ${attribute}="${value === true ? 'yes' : value}"`;
  }
  return attrs;
}

const RXN_PARTICIPATION: readonly ChemDrawBondRxnParticipation[] = [
  'ReactionCenter',
  'MakeOrBreak',
  'ChangeType',
  'MakeAndChange',
  'NotReactionCenter',
  'NoChange',
  'Unmapped',
];

export function readBondRxnParticipation(raw: string | null): {
  value?: ChemDrawBondRxnParticipation;
  handled: boolean;
} {
  if (raw === 'Unspecified') return { handled: true };
  if (raw && (RXN_PARTICIPATION as readonly string[]).includes(raw)) {
    return { value: raw as ChemDrawBondRxnParticipation, handled: true };
  }
  return { handled: false };
}
