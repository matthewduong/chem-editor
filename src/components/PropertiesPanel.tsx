import { useCallback } from 'react';
import { useStore } from '../store';
import { useCachedStructureTask } from '../hooks/useCachedStructureTask';
import { FloatingPanel } from './FloatingPanel';
import type { MoleculeProperties } from '../types/chemistry';
import type { PanelTheme } from '../types/panelTheme';
import { invokeTauri } from '../lib/tauri';

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
  const rows: [string, string][] = p
    ? [
        ['Formula', p.formula],
        ['MW', `${p.mw.toFixed(2)} g/mol`],
        ['Exact Mass', `${p.exact_mass.toFixed(4)} Da`],
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
      </div>
    </FloatingPanel>
  );
}
