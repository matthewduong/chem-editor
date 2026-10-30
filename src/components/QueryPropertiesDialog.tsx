import { createSelectionEditCommand } from '../editor/commands';
import {
  updateAtomQueryProperties,
  updateBondQuery,
  type BondTopology,
} from '../lib/queryProperties';
import { useStore } from '../store';
import type {
  ChemDrawAtomQueryProperties,
  ChemDrawBond,
  ChemDrawBondRxnParticipation,
  ChemDrawNode,
} from '../types/chemdraw';
import { FloatingPanel } from './FloatingPanel';
import { useState } from 'react';

type PanelTheme = Parameters<typeof FloatingPanel>[0]['theme'];

const ENUM_CHOICES: Array<[keyof ChemDrawAtomQueryProperties, string, string[]]> = [
  [
    'ringBondCount',
    'Ring bonds',
    ['SpiroOrHigher', 'Fusion', 'SimpleRing', 'AsDrawn', 'NoRingBonds'],
  ],
  ['unsaturatedBonds', 'Unsaturation', ['MustBeAbsent', 'MustBePresent']],
  ['rxnStereo', 'Reaction stereo', ['Inversion', 'Retention']],
  ['translation', 'Translation', ['Broad', 'Narrow', 'Any']],
  [
    'isotopicAbundance',
    'Isotopic abundance',
    ['Any', 'Natural', 'Enriched', 'Deficient', 'Nonnatural'],
  ],
];

const RXN_PARTICIPATION: ChemDrawBondRxnParticipation[] = [
  'ReactionCenter',
  'MakeOrBreak',
  'ChangeType',
  'MakeAndChange',
  'NotReactionCenter',
  'NoChange',
  'Unmapped',
];

/** Spaces a DTD value for reading: "MustBePresent" → "Must be present". */
const readable = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);

/**
 * Atom and bond query properties for the selection (ChemDraw 17.1 guide, "Atom Properties" and
 * "Bond Properties"), as the CDXML DTD names them. Each change is one undo step; the controls show
 * the first selected atom's or bond's values.
 */
export function QueryPropertiesDialog({
  theme,
  isDarkMode,
  onClose,
}: {
  theme: PanelTheme;
  isDarkMode: boolean;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ x: 240, y: 110 });
  const [size, setSize] = useState({ width: 300, height: 420 });
  const document = useStore((s) => s.chemDrawDocument);
  const selectedAtomIds = useStore((s) => s.selectedAtomIds);
  const selectedBondIds = useStore((s) => s.selectedBondIds);
  const objects = document?.pages[0]?.objects ?? [];
  const nodes = objects.filter(
    (object): object is ChemDrawNode => object.type === 'node' && selectedAtomIds.has(object.id),
  );
  const bonds = objects.filter(
    (object): object is ChemDrawBond =>
      object.type === 'bond' &&
      (selectedBondIds.has(object.id) ||
        (selectedAtomIds.has(object.beginNodeId) && selectedAtomIds.has(object.endNodeId))),
  );
  const atomQuery = nodes[0]?.queryProperties ?? {};
  const bondIds = new Set(bonds.map((bond) => bond.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  const setAtom = (patch: Partial<Record<keyof ChemDrawAtomQueryProperties, unknown>>) =>
    useStore
      .getState()
      .dispatchEditorCommand(
        createSelectionEditCommand(
          'atom-query-properties',
          (doc, ids) => updateAtomQueryProperties(doc, ids, patch),
          nodeIds,
        ),
      );
  const setBond = (patch: Parameters<typeof updateBondQuery>[2]) =>
    useStore
      .getState()
      .dispatchEditorCommand(
        createSelectionEditCommand(
          'bond-query-properties',
          (doc, ids) => updateBondQuery(doc, ids, patch),
          bondIds,
        ),
      );

  const row = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' };
  const count = (key: 'substituentsExactly' | 'substituentsUpTo' | 'freeSites', label: string) => (
    <label style={row}>
      {label}
      <input
        aria-label={label}
        type="number"
        min={0}
        style={{ width: 60 }}
        value={atomQuery[key] ?? ''}
        onFocus={() => useStore.getState().setIsInputFocused(true)}
        onBlur={() => useStore.getState().setIsInputFocused(false)}
        onChange={(event) => {
          const value = event.target.value === '' ? undefined : Number(event.target.value);
          if (value === undefined || (Number.isInteger(value) && value >= 0)) {
            setAtom({ [key]: value });
          }
        }}
      />
    </label>
  );

  return (
    <FloatingPanel
      pos={pos}
      size={size}
      minWidth={260}
      minHeight={200}
      title="Query Properties"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={onClose}
      onPosChange={setPos}
      onSizeChange={setSize}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 10,
          fontSize: 12,
          color: theme.text,
          overflowY: 'auto',
        }}
      >
        {nodes.length === 0 && bonds.length === 0 && (
          <div style={{ opacity: 0.7 }}>Select atoms or bonds to set their query properties.</div>
        )}
        {nodes.length > 0 && (
          <>
            <strong>Atoms ({nodes.length})</strong>
            {count('substituentsExactly', 'Substituents exactly')}
            {count('substituentsUpTo', 'Substituents up to')}
            {count('freeSites', 'Free sites')}
            {ENUM_CHOICES.map(([key, label, values]) => (
              <label key={key} style={row}>
                {label}
                <select
                  aria-label={label}
                  value={(atomQuery[key] as string | undefined) ?? ''}
                  onChange={(event) => setAtom({ [key]: event.target.value || undefined })}
                >
                  <option value="">Unspecified</option>
                  {values.map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {(
              [
                ['implicitHydrogens', 'Implicit hydrogens'],
                ['rxnChange', 'Reaction change'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={row}>
                {label}
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={atomQuery[key] === true}
                  onChange={(event) => setAtom({ [key]: event.target.checked })}
                />
              </label>
            ))}
          </>
        )}
        {bonds.length > 0 && (
          <>
            <strong style={{ marginTop: 6 }}>Bonds ({bonds.length})</strong>
            <label style={row}>
              Topology
              <select
                aria-label="Topology"
                value={bonds[0]!.query?.ringState ?? ''}
                onChange={(event) =>
                  setBond({ topology: (event.target.value || undefined) as BondTopology })
                }
              >
                <option value="">Unspecified</option>
                <option value="ring">Ring</option>
                <option value="chain">Chain</option>
                <option value="either">Ring or chain</option>
              </select>
            </label>
            <label style={row}>
              Reaction center
              <select
                aria-label="Reaction center"
                value={bonds[0]!.rxnParticipation ?? ''}
                onChange={(event) =>
                  setBond({
                    rxnParticipation: (event.target.value ||
                      null) as ChemDrawBondRxnParticipation | null,
                  })
                }
              >
                <option value="">Unspecified</option>
                {RXN_PARTICIPATION.map((value) => (
                  <option key={value} value={value}>
                    {readable(value)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
