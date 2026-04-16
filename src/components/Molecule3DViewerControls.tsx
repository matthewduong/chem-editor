import { useEffect, useRef, useState } from 'react';
import type { ViewerForceField } from '../types/settings';
import { SelectMenu } from './SelectMenu';

type Representation = 'ball+stick' | 'licorice' | 'spacefill' | 'surface';

interface Props {
  isDarkMode: boolean;
  minimizeGeometry: boolean;
  spin: boolean;
  forceField: ViewerForceField;
  multiConformer: boolean;
  maxConformers: number;
  showAtomNumbers: boolean;
  showAtomLabels: boolean;
  showMeasureToolbar: boolean;
  representation: Representation;
  spinSpeed: number;
  atomScale: number;
  bondScale: number;
  perspectiveFov: number;
  backgroundColor: string;
  viewerBondColor: string;
  ambientLightIntensity: number;
  hemiLightIntensity: number;
  keyLightIntensity: number;
  fillLightIntensity: number;
  rimLightIntensity: number;
  setMinimizeGeometry: (value: boolean) => void;
  setRawConformer: (value: null) => void;
  setSpin: (value: boolean) => void;
  setForceField: (value: ViewerForceField) => void;
  setMultiConformer: (value: boolean) => void;
  setMaxConformers: (value: number) => void;
  setShowAtomNumbers: (value: boolean) => void;
  setShowAtomLabels: (value: boolean) => void;
  setShowMeasureToolbar: (value: boolean) => void;
  setRepresentation: (value: Representation) => void;
  setSpinSpeed: (value: number) => void;
  setAtomScale: (value: number) => void;
  setBondScale: (value: number) => void;
  setPerspectiveFov: (value: number) => void;
  setBackgroundColor: (value: string) => void;
  setViewerBondColor: (value: string) => void;
  setAmbientLightIntensity: (value: number) => void;
  setHemiLightIntensity: (value: number) => void;
  setKeyLightIntensity: (value: number) => void;
  setFillLightIntensity: (value: number) => void;
  setRimLightIntensity: (value: number) => void;
  onRecenter: () => void;
}

const representationOptions = [
  { value: 'ball+stick', label: 'Ball+Stick' },
  { value: 'licorice', label: 'Licorice' },
  { value: 'spacefill', label: 'Spacefill' },
  { value: 'surface', label: 'Surface' },
] as const;

const forceFieldOptions = [
  { value: 'UFF', label: 'UFF' },
  { value: 'MMFF94s', label: 'MMFF94s' },
  { value: 'xtb', label: 'xTB' },
  { value: 'hartree-fock', label: 'Hartree-Fock' },
] as const;

const sliderRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 56px',
  gap: 8,
  alignItems: 'center',
} as const;

export function Molecule3DViewerControls(props: Props) {
  const {
    isDarkMode,
    minimizeGeometry,
    spin,
    forceField,
    multiConformer,
    maxConformers,
    showAtomNumbers,
    showAtomLabels,
    showMeasureToolbar,
    representation,
    spinSpeed,
    atomScale,
    bondScale,
    perspectiveFov,
    backgroundColor,
    viewerBondColor,
    ambientLightIntensity,
    hemiLightIntensity,
    keyLightIntensity,
    fillLightIntensity,
    rimLightIntensity,
    setMinimizeGeometry,
    setRawConformer,
    setSpin,
    setForceField,
    setMultiConformer,
    setMaxConformers,
    setShowAtomNumbers,
    setShowAtomLabels,
    setShowMeasureToolbar,
    setRepresentation,
    setSpinSpeed,
    setAtomScale,
    setBondScale,
    setPerspectiveFov,
    setBackgroundColor,
    setViewerBondColor,
    setAmbientLightIntensity,
    setHemiLightIntensity,
    setKeyLightIntensity,
    setFillLightIntensity,
    setRimLightIntensity,
    onRecenter,
  } = props;

  const [showOptions, setShowOptions] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const appearanceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (appearanceRef.current?.contains(target)) return;
      if (optionsRef.current && !optionsRef.current.contains(target)) {
        setShowOptions(false);
        setShowAppearance(false);
      }
    };

    if (showOptions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOptions]);

  const borderColor = isDarkMode ? '#444444' : '#cccccc';
  const panelBg = isDarkMode ? '#121212' : '#ffffff';
  const textColor = isDarkMode ? '#ffffff' : '#333333';
  const selectBg = isDarkMode ? '#2a2d2e' : '#f0f0f0';
  const labelStyle = {
    fontSize: 11,
    color: textColor,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    userSelect: 'none',
  } as const;
  const numberInputStyle = {
    width: '100%',
    fontSize: 10,
    padding: '2px 4px',
    background: selectBg,
    color: textColor,
    border: `1px solid ${borderColor}`,
    borderRadius: 3,
  } as const;

  return (
    <div style={{ position: 'absolute', top: 5, right: 5, zIndex: 20 }}>
      <button
        onMouseDown={(event) => {
          event.stopPropagation();
          setShowOptions((prev) => !prev);
        }}
        onClick={(event) => event.stopPropagation()}
        style={{
          background: isDarkMode ? '#333' : '#fff',
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '36px',
          height: '36px',
          color: isDarkMode ? '#fff' : '#000',
          fontSize: 24,
        }}
        title="3D Viewer Settings"
      >
        ⚙
      </button>
      {showOptions && (
        <div
          ref={optionsRef}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            top: 25,
            right: 0,
            background: panelBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
            minWidth: 175,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: textColor,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              Viewer
            </span>
            <button
              onClick={() => setShowAppearance((value) => !value)}
              style={{
                fontSize: 10,
                background: isDarkMode ? '#1f2937' : '#eef2f7',
                color: textColor,
                border: `1px solid ${borderColor}`,
                borderRadius: 4,
                padding: '4px 8px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Appearance
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: textColor, fontWeight: '600' }}>
              Representation
            </span>
            <SelectMenu
              value={representation}
              options={[...representationOptions]}
              onChange={(value) => setRepresentation(value as Representation)}
              isDarkMode={isDarkMode}
              textColor={textColor}
              borderColor={borderColor}
              backgroundColor={selectBg}
              menuBackgroundColor={panelBg}
              activeBackgroundColor={isDarkMode ? '#2a5a8a' : '#007acc22'}
              fontSize={10}
              padding="3px 6px"
              minWidth={98}
              align="right"
            />
          </div>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={minimizeGeometry}
              onChange={(event) => {
                setMinimizeGeometry(event.target.checked);
                if (event.target.checked) setRawConformer(null);
              }}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Minimize Geometry
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={spin}
              onChange={(event) => setSpin(event.target.checked)}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Auto Spin
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: textColor, fontWeight: '600' }}>Engine</span>
            <SelectMenu
              value={forceField}
              options={[...forceFieldOptions]}
              onChange={(value) => setForceField(value as ViewerForceField)}
              isDarkMode={isDarkMode}
              textColor={textColor}
              borderColor={borderColor}
              backgroundColor={selectBg}
              menuBackgroundColor={panelBg}
              activeBackgroundColor={isDarkMode ? '#2a5a8a' : '#007acc22'}
              fontSize={10}
              padding="3px 6px"
              minWidth={88}
              align="right"
            />
          </div>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={multiConformer}
              onChange={(event) => setMultiConformer(event.target.checked)}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Multi-Conformer
          </label>
          {multiConformer && (
            <label
              style={{
                fontSize: 11,
                color: textColor,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontWeight: '600',
              }}
            >
              Max Confs
              <input
                type="number"
                min="1"
                max="50"
                value={maxConformers}
                onChange={(event) => setMaxConformers(parseInt(event.target.value) || 1)}
                style={{
                  ...numberInputStyle,
                  width: '40px',
                }}
              />
            </label>
          )}
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={showAtomNumbers}
              onChange={(event) => setShowAtomNumbers(event.target.checked)}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Atom Numbers
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={showAtomLabels}
              onChange={(event) => setShowAtomLabels(event.target.checked)}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Atom Labels
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={showMeasureToolbar}
              onChange={(event) => setShowMeasureToolbar(event.target.checked)}
              style={{ cursor: 'pointer', margin: 0, width: 14, height: 14 }}
            />
            Measure Tools
          </label>
          <button
            onClick={onRecenter}
            style={{
              fontSize: 11,
              background: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 0',
              cursor: 'pointer',
              marginTop: 4,
              fontWeight: 'bold',
            }}
          >
            Recenter View
          </button>
        </div>
      )}
      {showOptions && showAppearance && (
        <div
          ref={appearanceRef}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            top: 25,
            right: 188,
            background: panelBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
            minWidth: 238,
            zIndex: 2,
          }}
        >
          <div style={{ fontSize: 11, color: textColor, fontWeight: 700, letterSpacing: '0.04em' }}>
            Appearance
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Spin Speed</label>
            <input
              type="number"
              min="0.05"
              max="4"
              step="0.05"
              value={spinSpeed}
              onChange={(event) =>
                setSpinSpeed(
                  Math.max(0.05, Math.min(4, Number.parseFloat(event.target.value) || spinSpeed)),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Atom Size</label>
            <input
              type="number"
              min="0.4"
              max="2.5"
              step="0.05"
              value={atomScale}
              onChange={(event) =>
                setAtomScale(
                  Math.max(0.4, Math.min(2.5, Number.parseFloat(event.target.value) || atomScale)),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Bond Size</label>
            <input
              type="number"
              min="0.2"
              max="3"
              step="0.05"
              value={bondScale}
              onChange={(event) =>
                setBondScale(
                  Math.max(0.2, Math.min(3, Number.parseFloat(event.target.value) || bondScale)),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Perspective</label>
            <input
              type="number"
              min="12"
              max="75"
              step="1"
              value={perspectiveFov}
              onChange={(event) =>
                setPerspectiveFov(
                  Math.max(
                    12,
                    Math.min(75, Number.parseFloat(event.target.value) || perspectiveFov),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Background</label>
            <input
              type="color"
              value={backgroundColor}
              onChange={(event) => setBackgroundColor(event.target.value)}
              style={{
                width: '100%',
                height: 24,
                padding: 0,
                background: selectBg,
                border: `1px solid ${borderColor}`,
                borderRadius: 3,
              }}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Bond Color</label>
            <input
              type="color"
              value={viewerBondColor}
              onChange={(event) => setViewerBondColor(event.target.value)}
              style={{
                width: '100%',
                height: 24,
                padding: 0,
                background: selectBg,
                border: `1px solid ${borderColor}`,
                borderRadius: 3,
              }}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Ambient</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.05"
              value={ambientLightIntensity}
              onChange={(event) =>
                setAmbientLightIntensity(
                  Math.max(
                    0,
                    Math.min(3, Number.parseFloat(event.target.value) || ambientLightIntensity),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Hemisphere</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.05"
              value={hemiLightIntensity}
              onChange={(event) =>
                setHemiLightIntensity(
                  Math.max(
                    0,
                    Math.min(3, Number.parseFloat(event.target.value) || hemiLightIntensity),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Key</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.05"
              value={keyLightIntensity}
              onChange={(event) =>
                setKeyLightIntensity(
                  Math.max(
                    0,
                    Math.min(3, Number.parseFloat(event.target.value) || keyLightIntensity),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Fill</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.05"
              value={fillLightIntensity}
              onChange={(event) =>
                setFillLightIntensity(
                  Math.max(
                    0,
                    Math.min(3, Number.parseFloat(event.target.value) || fillLightIntensity),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
          <div style={sliderRowStyle}>
            <label style={{ fontSize: 11, color: textColor }}>Rim</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.05"
              value={rimLightIntensity}
              onChange={(event) =>
                setRimLightIntensity(
                  Math.max(
                    0,
                    Math.min(3, Number.parseFloat(event.target.value) || rimLightIntensity),
                  ),
                )
              }
              style={numberInputStyle}
            />
          </div>
        </div>
      )}
    </div>
  );
}
