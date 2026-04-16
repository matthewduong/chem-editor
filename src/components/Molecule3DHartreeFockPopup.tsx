import { startTransition, useEffect, useRef, useState } from 'react';
import type { ViewerOrbitalMetadata } from '../lib/viewer3d';
import type { ViewerOrbitalBasis, ViewerOrbitalMaterial } from '../types/settings';
import { SelectMenu } from './SelectMenu';

interface Props {
  isDarkMode: boolean;
  disabled?: boolean;
  orbitalBasis: ViewerOrbitalBasis;
  orbitalOpacity: number;
  orbitalPositiveColor: string;
  orbitalNegativeColor: string;
  orbitalMaterial: ViewerOrbitalMaterial;
  orbitalOutline: boolean;
  orbitalIsovalue: number;
  orbitalShowPositivePhase: boolean;
  orbitalShowNegativePhase: boolean;
  orbitalOptions: ViewerOrbitalMetadata[];
  selectedOrbitalKey: string | null;
  orbitalLoading: boolean;
  orbitalError: string | null;
  orbitalWarnings: string[];
  orbitalStale: boolean;
  optimizeLoading: boolean;
  optimizeError: string | null;
  optimizeWarnings: string[];
  setOrbitalBasis: (value: ViewerOrbitalBasis) => void;
  setOrbitalOpacity: (value: number) => void;
  setOrbitalPositiveColor: (value: string) => void;
  setOrbitalNegativeColor: (value: string) => void;
  setOrbitalMaterial: (value: ViewerOrbitalMaterial) => void;
  setOrbitalOutline: (value: boolean) => void;
  setOrbitalIsovalue: (value: number) => void;
  setOrbitalShowPositivePhase: (value: boolean) => void;
  setOrbitalShowNegativePhase: (value: boolean) => void;
  setSelectedOrbitalKey: (value: string | null) => void;
  onCalculateOrbitals: () => void;
  onOptimizeGeometry: () => void;
}

const orbitalBasisOptions = [
  { value: 'STO-3G', label: 'STO-3G' },
  { value: '3-21G', label: '3-21G' },
  { value: '6-31G*', label: '6-31G*' },
] as const;

const orbitalMaterialOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'glassy', label: 'Glassy' },
  { value: 'wireframe-overlay', label: 'Wireframe' },
] as const;

function buildToggleButtonStyle(active: boolean, isDarkMode: boolean, borderColor: string) {
  return {
    border: `1px solid ${active ? '#0f766e' : borderColor}`,
    background: active ? '#0f766e' : isDarkMode ? '#1f2937' : '#f8fafc',
    color: active ? '#ffffff' : isDarkMode ? '#f8fafc' : '#0f172a',
    borderRadius: 5,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
  } as const;
}

export function Molecule3DHartreeFockPopup({
  isDarkMode,
  disabled = false,
  orbitalBasis,
  orbitalOpacity,
  orbitalPositiveColor,
  orbitalNegativeColor,
  orbitalMaterial,
  orbitalOutline,
  orbitalIsovalue,
  orbitalShowPositivePhase,
  orbitalShowNegativePhase,
  orbitalOptions,
  selectedOrbitalKey,
  orbitalLoading,
  orbitalError,
  orbitalWarnings,
  orbitalStale,
  optimizeLoading,
  optimizeError,
  optimizeWarnings,
  setOrbitalBasis,
  setOrbitalOpacity,
  setOrbitalPositiveColor,
  setOrbitalNegativeColor,
  setOrbitalMaterial,
  setOrbitalOutline,
  setOrbitalIsovalue,
  setOrbitalShowPositivePhase,
  setOrbitalShowNegativePhase,
  setSelectedOrbitalKey,
  onCalculateOrbitals,
  onOptimizeGeometry,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const borderColor = isDarkMode ? '#475569' : '#cbd5e1';
  const panelBg = isDarkMode ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)';
  const textColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const mutedColor = isDarkMode ? '#94a3b8' : '#64748b';
  const inputBg = isDarkMode ? '#0f172a' : '#f8fafc';

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        style={{
          border: `1px solid ${borderColor}`,
          background: open ? '#0f766e' : isDarkMode ? '#1f2937' : '#ffffff',
          color: open ? '#ffffff' : textColor,
          borderRadius: 4,
          padding: '4px 9px',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          opacity: disabled ? 0.72 : 1,
        }}
        title="Hartree-Fock orbitals"
      >
        HF
      </button>
      {open && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: 292,
            background: panelBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 8,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.24)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 12,
            backdropFilter: 'blur(10px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: textColor }}>HF Orbitals</div>
              <div style={{ fontSize: 10, color: mutedColor }}>Current conformer only</div>
            </div>
            <SelectMenu
              value={orbitalBasis}
              options={[...orbitalBasisOptions]}
              onChange={(value) => setOrbitalBasis(value as ViewerOrbitalBasis)}
              isDarkMode={isDarkMode}
              textColor={textColor}
              borderColor={borderColor}
              backgroundColor={inputBg}
              menuBackgroundColor={panelBg}
              activeBackgroundColor={isDarkMode ? '#14532d' : '#dcfce7'}
              fontSize={10}
              padding="4px 8px"
              minWidth={88}
              align="right"
              disabled={disabled || orbitalLoading || optimizeLoading}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {orbitalOptions.length > 0 ? (
              orbitalOptions.map((orbital) => (
                <button
                  key={orbital.key}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    startTransition(() => {
                      setSelectedOrbitalKey(orbital.key);
                    })
                  }
                  style={buildToggleButtonStyle(
                    selectedOrbitalKey === orbital.key,
                    isDarkMode,
                    borderColor,
                  )}
                  title={`${orbital.label} (${orbital.energyEv.toFixed(2)} eV)`}
                >
                  {orbital.label}
                </button>
              ))
            ) : (
              <div style={{ fontSize: 10, color: mutedColor }}>
                Calculate orbitals to enable HOMO/LUMO shortcuts.
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: textColor }}>
                Isovalue {orbitalIsovalue.toFixed(3)}
              </span>
              <input
                type="range"
                min="0.01"
                max="0.12"
                step="0.002"
                value={orbitalIsovalue}
                onChange={(event) => setOrbitalIsovalue(Number.parseFloat(event.target.value))}
                disabled={disabled}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: textColor }}>
                Opacity {orbitalOpacity.toFixed(2)}
              </span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.02"
                value={orbitalOpacity}
                onChange={(event) => setOrbitalOpacity(Number.parseFloat(event.target.value))}
                disabled={disabled}
              />
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <label
              style={{ display: 'grid', gap: 4, fontSize: 10, color: textColor, fontWeight: 600 }}
            >
              Positive
              <input
                type="color"
                value={orbitalPositiveColor}
                onChange={(event) => setOrbitalPositiveColor(event.target.value)}
                style={{
                  width: '100%',
                  height: 28,
                  padding: 0,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 4,
                  background: inputBg,
                }}
              />
            </label>
            <label
              style={{ display: 'grid', gap: 4, fontSize: 10, color: textColor, fontWeight: 600 }}
            >
              Negative
              <input
                type="color"
                value={orbitalNegativeColor}
                onChange={(event) => setOrbitalNegativeColor(event.target.value)}
                style={{
                  width: '100%',
                  height: 28,
                  padding: 0,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 4,
                  background: inputBg,
                }}
              />
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <SelectMenu
              value={orbitalMaterial}
              options={[...orbitalMaterialOptions]}
              onChange={(value) => setOrbitalMaterial(value as ViewerOrbitalMaterial)}
              isDarkMode={isDarkMode}
              textColor={textColor}
              borderColor={borderColor}
              backgroundColor={inputBg}
              menuBackgroundColor={panelBg}
              activeBackgroundColor={isDarkMode ? '#14532d' : '#dcfce7'}
              fontSize={10}
              padding="4px 8px"
            />
            <button
              type="button"
              onClick={() => setOrbitalShowPositivePhase(!orbitalShowPositivePhase)}
              style={buildToggleButtonStyle(orbitalShowPositivePhase, isDarkMode, borderColor)}
            >
              + Lobe
            </button>
            <button
              type="button"
              onClick={() => setOrbitalShowNegativePhase(!orbitalShowNegativePhase)}
              style={buildToggleButtonStyle(orbitalShowNegativePhase, isDarkMode, borderColor)}
            >
              - Lobe
            </button>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              fontWeight: 600,
              color: textColor,
            }}
          >
            <input
              type="checkbox"
              checked={orbitalOutline}
              onChange={(event) => setOrbitalOutline(event.target.checked)}
              style={{ margin: 0 }}
            />
            Edge outline
          </label>

          <button
            type="button"
            onClick={onCalculateOrbitals}
            disabled={disabled || orbitalLoading || optimizeLoading}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '9px 10px',
              background: orbitalLoading ? (isDarkMode ? '#334155' : '#cbd5e1') : '#0f766e',
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 700,
              cursor: disabled || orbitalLoading || optimizeLoading ? 'default' : 'pointer',
            }}
          >
            {orbitalLoading
              ? 'Calculating…'
              : orbitalStale
                ? 'Recalculate Orbitals'
                : 'Calculate Orbitals'}
          </button>

          {(orbitalStale ||
            orbitalError ||
            optimizeError ||
            orbitalWarnings.length > 0 ||
            optimizeWarnings.length > 0) && (
            <div style={{ display: 'grid', gap: 4 }}>
              {orbitalStale && !orbitalLoading && (
                <div style={{ fontSize: 10, color: isDarkMode ? '#facc15' : '#a16207' }}>
                  Geometry or HF settings changed. Recalculate to update the orbital surfaces.
                </div>
              )}
              {orbitalError && <div style={{ fontSize: 10, color: '#ef4444' }}>{orbitalError}</div>}
              {optimizeError && (
                <div style={{ fontSize: 10, color: '#ef4444' }}>{optimizeError}</div>
              )}
              {orbitalWarnings.map((warning) => (
                <div
                  key={`orbital-${warning}`}
                  style={{ fontSize: 10, color: isDarkMode ? '#facc15' : '#a16207' }}
                >
                  {warning}
                </div>
              ))}
              {optimizeWarnings.map((warning) => (
                <div
                  key={`opt-${warning}`}
                  style={{ fontSize: 10, color: isDarkMode ? '#facc15' : '#a16207' }}
                >
                  {warning}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onOptimizeGeometry}
            disabled={disabled || optimizeLoading || orbitalLoading}
            style={{
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              padding: '9px 10px',
              background: isDarkMode ? '#1e293b' : '#eff6ff',
              color: textColor,
              fontSize: 11,
              fontWeight: 700,
              cursor: disabled || optimizeLoading || orbitalLoading ? 'default' : 'pointer',
            }}
          >
            {optimizeLoading ? 'Optimizing Geometry…' : 'Optimize Geometry (HF)'}
          </button>
        </div>
      )}
    </div>
  );
}
