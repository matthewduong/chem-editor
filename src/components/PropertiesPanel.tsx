import { useCallback } from 'react';
import { useStore } from '../store';
import { useCachedStructureTask } from '../hooks/useCachedStructureTask';
import { FloatingPanel } from './FloatingPanel';
import type { MoleculeProperties } from '../types/chemistry';
import type { PanelTheme } from '../types/panelTheme';
import { invokeTauri } from '../lib/tauri';
import { commitCanvasEdit } from '../store';
import { resolveDocumentCaptionTextStyle } from '../lib/chemdrawMetrics';
import {
  exactMass,
  formatElementalAnalysis,
  formatMassPeaks,
  isotopePeaks,
  molecularWeight,
  parseFormula,
} from '../lib/massAnalysis';
import type { TextRun } from '../types/chemistry';

/**
 * Analysis > Paste (ChemDraw 17.1 guide, "Structure Analysis"): the chosen values as one caption
 * under the structure analysed (the selection, or else everything), one undo step.
 */
function pasteAnalysisCaption(lines: Array<{ label: string; value: string; formula?: boolean }>) {
  const state = useStore.getState();
  const atoms = state.selectedAtomIds.size
    ? state.atoms.filter((atom) => state.selectedAtomIds.has(atom.id))
    : state.atoms;
  if (atoms.length === 0 || lines.length === 0) return;
  const xs = atoms.map((atom) => atom.x);
  const bottom = Math.max(...atoms.map((atom) => atom.y));
  const style = resolveDocumentCaptionTextStyle(state.documentStyleSettings);
  const runs: TextRun[] = lines.flatMap((line, index) => [
    { text: `${index > 0 ? '\n' : ''}${line.label}: ` },
    { text: line.value, ...(line.formula ? { formula: true } : {}) },
  ]);
  commitCanvasEdit({
    atoms: state.atoms,
    bonds: state.bonds,
    arrows: state.arrows,
    groups: state.groups ?? [],
    textBoxes: [
      ...(state.textBoxes ?? []),
      {
        id: crypto.randomUUID(),
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: bottom + state.documentStyleSettings.bondLength,
        runs,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: state.textFormat.color,
        textAlign: 'center',
        semanticMode: 'plain',
        conversionStatus: 'plain',
      },
    ],
  });
}

interface Props {
  theme: PanelTheme;
  isDarkMode: boolean;
  viewerSmiles: string;
}

interface SidecarPropsResult {
  error?: string;
  formula?: string;
  mw?: number;
  exact_mass?: number;
  logp?: number;
  tpsa?: number;
  hbd?: number;
  hba?: number;
  rotatable_bonds?: number;
  rings?: number;
  aromatic_rings?: number;
  charge?: number;
  heavy_atoms?: number;
}

export function PropertiesPanel({ theme, isDarkMode, viewerSmiles }: Props) {
  const {
    propertiesPos,
    propertiesSize,
    setPropertiesPos,
    setPropertiesSize,
    setShowPropertiesPanel,
    viewerStructureStatus,
  } = useStore();
  const run = useCallback(
    (smiles: string) => invokeTauri<SidecarPropsResult>('compute_properties', { smiles }),
    [],
  );
  const selectData = useCallback((response: SidecarPropsResult) => {
    if (!response.error && response.formula !== undefined) {
      return { data: response as MoleculeProperties };
    }
    return { error: response.error ?? 'Computation failed.' };
  }, []);
  const state = useCachedStructureTask({
    viewerSmiles,
    viewerStructureStatus,
    unavailableMessage: 'Properties are unavailable for this structure.',
    run,
    selectData,
  });

  const p = state.data;
  const parsed = p ? parseFormula(p.formula) : null;
  // ChemDraw's own tables and electron handling when the formula reads; RDKit's values otherwise.
  const molecularWeightValue = p ? (parsed ? molecularWeight(parsed) : p.mw) : 0;
  const exactMassValue = p ? (parsed ? exactMass(parsed) : p.exact_mass) : 0;
  // The Analysis window's values, under the labels ChemDraw pastes them with.
  const analysis = p
    ? [
        { label: 'Chemical Formula', value: p.formula, formula: true },
        { label: 'Exact Mass', value: exactMassValue.toFixed(2) },
        { label: 'Molecular Weight', value: molecularWeightValue.toFixed(2) },
        ...(parsed
          ? [
              { label: 'm/z', value: formatMassPeaks(isotopePeaks(parsed)) },
              {
                label: 'Elemental Analysis',
                value: formatElementalAnalysis(parsed.counts, 2, parsed.charge),
              },
            ]
          : []),
      ]
    : [];
  const rows: [string, string][] = p
    ? [
        ['Formula', p.formula],
        ['MW', `${molecularWeightValue.toFixed(2)} g/mol`],
        ['Exact Mass', `${exactMassValue.toFixed(4)} Da`],
        ...analysis
          .filter((line) => line.label === 'm/z' || line.label === 'Elemental Analysis')
          .map((line): [string, string] => [line.label, line.value]),
        ['LogP', p.logp.toFixed(2)],
        ['TPSA', `${p.tpsa.toFixed(1)} Å²`],
        ['H-Bond Donors', String(p.hbd)],
        ['H-Bond Acceptors', String(p.hba)],
        ['Rotatable Bonds', String(p.rotatable_bonds)],
        ['Rings', String(p.rings)],
        ['Aromatic Rings', String(p.aromatic_rings)],
        ['Formal Charge', String(p.charge)],
        ['Heavy Atoms', String(p.heavy_atoms)],
      ]
    : [];

  const analysisLineFor = (rowLabel: string) =>
    analysis.find(
      (line) =>
        line.label === rowLabel ||
        (rowLabel === 'Formula' && line.label === 'Chemical Formula') ||
        (rowLabel === 'MW' && line.label === 'Molecular Weight'),
    );
  const pasteButtonStyle = {
    border: 'none',
    background: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
    opacity: 0.7,
  };

  return (
    <FloatingPanel
      pos={propertiesPos}
      size={propertiesSize}
      minWidth={200}
      minHeight={150}
      title="Properties"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={() => setShowPropertiesPanel(false)}
      onPosChange={setPropertiesPos}
      onSizeChange={setPropertiesSize}
    >
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {state.status === 'idle' && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            Draw a structure to see properties.
          </div>
        )}
        {state.status === 'loading' && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            Computing…
          </div>
        )}
        {state.status === 'error' && (
          <div
            style={{
              fontSize: 11,
              color: '#c0392b',
              textAlign: 'center',
              marginTop: 20,
              padding: '0 8px',
              border: '1px solid #c0392b',
              borderRadius: 4,
              background: isDarkMode ? 'rgba(192,57,43,0.12)' : 'rgba(192,57,43,0.06)',
              margin: 8,
            }}
          >
            {state.error}
          </div>
        )}
        {state.status === 'success' && p && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} style={{ borderBottom: `1px solid ${theme.border}` }}>
                  <td style={{ width: 18, padding: 0 }}>
                    {analysisLineFor(label) && (
                      <button
                        type="button"
                        title={`Paste ${label} as a caption`}
                        aria-label={`Paste ${label} as a caption`}
                        onClick={() => pasteAnalysisCaption([analysisLineFor(label)!])}
                        style={pasteButtonStyle}
                      >
                        ⤓
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '4px 6px', color: '#888', whiteSpace: 'nowrap' }}>
                    {label}
                  </td>
                  <td
                    style={{
                      padding: '4px 6px',
                      color: theme.text,
                      fontFamily: 'monospace',
                      textAlign: 'right',
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {state.status === 'success' && p && (
          <button
            type="button"
            onClick={() => pasteAnalysisCaption(analysis)}
            style={{ marginTop: 8, fontSize: 11, width: '100%' }}
          >
            Paste analysis as caption
          </button>
        )}
      </div>
    </FloatingPanel>
  );
}
