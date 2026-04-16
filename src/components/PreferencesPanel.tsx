import { useState } from 'react';
import { ELEMENT_COLORS } from '../lib/elements';
import {
  ATOM_COLOR_PALETTE_OPTIONS,
  buildAtomColorsForPalette,
  getMonochromeForeground,
  PAGE_PRESET_SIZES_IN,
  updatePageSetup,
} from '../lib/settings';
import type {
  AppPreferences,
  AtomColorPaletteId,
  DocumentStyleSettings,
  PagePresetId,
} from '../types/settings';
import { SelectMenu } from './SelectMenu';
import type { AppTheme } from './ViewerPanel';
import { DeferredNumberInput } from './DeferredNumberInput';
import { FloatingPanel } from './FloatingPanel';
import { KeybindingsPanel } from './KeybindingsPanel';

export type PreferencesTab = 'drawing' | 'colors' | 'viewer' | 'app';

// Periodic table layout (18 columns × 7 rows); '' = gap, 'La-Lu'/'Ac-Lr' = f-block placeholders
const PT_MAIN = [
  ['H', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'He'],
  ['Li', 'Be', '', '', '', '', '', '', '', '', '', '', 'B', 'C', 'N', 'O', 'F', 'Ne'],
  ['Na', 'Mg', '', '', '', '', '', '', '', '', '', '', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar'],
  [
    'K',
    'Ca',
    'Sc',
    'Ti',
    'V',
    'Cr',
    'Mn',
    'Fe',
    'Co',
    'Ni',
    'Cu',
    'Zn',
    'Ga',
    'Ge',
    'As',
    'Se',
    'Br',
    'Kr',
  ],
  [
    'Rb',
    'Sr',
    'Y',
    'Zr',
    'Nb',
    'Mo',
    'Tc',
    'Ru',
    'Rh',
    'Pd',
    'Ag',
    'Cd',
    'In',
    'Sn',
    'Sb',
    'Te',
    'I',
    'Xe',
  ],
  [
    'Cs',
    'Ba',
    'La-Lu',
    'Hf',
    'Ta',
    'W',
    'Re',
    'Os',
    'Ir',
    'Pt',
    'Au',
    'Hg',
    'Tl',
    'Pb',
    'Bi',
    'Po',
    'At',
    'Rn',
  ],
  [
    'Fr',
    'Ra',
    'Ac-Lr',
    'Rf',
    'Db',
    'Sg',
    'Bh',
    'Hs',
    'Mt',
    'Ds',
    'Rg',
    'Cn',
    'Nh',
    'Fl',
    'Mc',
    'Lv',
    'Ts',
    'Og',
  ],
];
const PT_LANTHANIDES = [
  'La',
  'Ce',
  'Pr',
  'Nd',
  'Pm',
  'Sm',
  'Eu',
  'Gd',
  'Tb',
  'Dy',
  'Ho',
  'Er',
  'Tm',
  'Yb',
  'Lu',
];
const PT_ACTINIDES = [
  'Ac',
  'Th',
  'Pa',
  'U',
  'Np',
  'Pu',
  'Am',
  'Cm',
  'Bk',
  'Cf',
  'Es',
  'Fm',
  'Md',
  'No',
  'Lr',
];

/** Returns black or white for legible text on the given hex background. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance (sRGB)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#000000' : '#ffffff';
}

interface PreferencesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  preferencesHydrated: boolean;
  preferencesTab: PreferencesTab;
  setPreferencesTab: (tab: PreferencesTab) => void;
  appPreferences: AppPreferences;
  setAppPreferences: (appPreferences: AppPreferences) => void;
  documentStyleSettings: DocumentStyleSettings;
  handleResetPreferencesToDefaults: () => void;
  handleUseForNewDocumentContent: () => void;
  handleApplyDefaultsToCurrentDocument: () => void;
  handleCenterPageInView: () => void;
  handleMoveContentIntoPage: () => void;
  hasOffPageContent: boolean;
  theme: AppTheme;
  isDarkMode: boolean;
}

export function PreferencesPanel({
  isOpen,
  onClose,
  preferencesHydrated,
  preferencesTab,
  setPreferencesTab,
  appPreferences,
  setAppPreferences,
  documentStyleSettings,
  handleResetPreferencesToDefaults,
  handleUseForNewDocumentContent,
  handleApplyDefaultsToCurrentDocument,
  handleCenterPageInView,
  handleMoveContentIntoPage,
  hasOffPageContent,
  theme,
  isDarkMode,
}: PreferencesPanelProps) {
  const [panelPos, setPanelPos] = useState(() => ({
    x: Math.max(24, Math.round((window.innerWidth - 640) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - 760) / 2)),
  }));
  const [panelSize, setPanelSize] = useState({ width: 640, height: 760 });
  const [isKeybindingsOpen, setIsKeybindingsOpen] = useState(false);

  if (!isOpen) {
    return null;
  }

  const pagePresetOptions = [
    { value: 'custom', label: 'Custom' },
    ...Object.entries(PAGE_PRESET_SIZES_IN).map(([value, preset]) => ({
      value: value as PagePresetId,
      label: preset.label,
    })),
  ];
  const numberInputStyle = {
    width: '100%',
    marginTop: '4px',
    padding: '6px',
    background: isDarkMode ? '#333' : '#fff',
    color: theme.text,
    border: `1px solid ${theme.border}`,
    borderRadius: '4px',
  };
  const applyAtomColorPalette = (paletteId: AtomColorPaletteId) =>
    setAppPreferences({
      ...appPreferences,
      drawing: {
        ...appPreferences.drawing,
        colors: {
          ...appPreferences.drawing.colors,
          monochrome: false,
          atomColorPalette: paletteId,
          atomColors: buildAtomColorsForPalette(paletteId),
        },
      },
    });

  return (
    <FloatingPanel
      pos={panelPos}
      size={panelSize}
      minWidth={520}
      minHeight={520}
      title="Preferences"
      theme={theme}
      isDarkMode={isDarkMode}
      zIndex={3100}
      positionMode="fixed"
      onClose={onClose}
      onPosChange={setPanelPos}
      onSizeChange={setPanelSize}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '18px',
        }}
      >
        {!preferencesHydrated && (
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>
            Loading saved preferences…
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 14,
            borderBottom: `1px solid ${theme.border}`,
            paddingBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          {(
            [
              ['drawing', 'Drawing'],
              ['colors', 'Colors'],
              ['viewer', 'Viewer'],
              ['app', 'App'],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPreferencesTab(tab)}
              style={{
                padding: '6px 12px',
                borderRadius: 5,
                border: `1px solid ${preferencesTab === tab ? '#007acc' : theme.border}`,
                background: preferencesTab === tab ? '#007acc' : isDarkMode ? '#2b2b2b' : '#fff',
                color: preferencesTab === tab ? '#fff' : theme.text,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {preferencesTab === 'drawing' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 14,
              }}
            >
              <div
                style={{
                  gridColumn: '1 / -1',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#888',
                  marginBottom: -4,
                }}
              >
                PAGE SETUP
              </div>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Canvas Mode
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.pageSetup.mode}
                    options={[
                      { value: 'infinite', label: 'Infinite' },
                      { value: 'finite', label: 'Finite' },
                    ]}
                    onChange={(mode) =>
                      setAppPreferences({
                        ...appPreferences,
                        pageSetup: updatePageSetup(appPreferences.pageSetup, { mode }),
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Paper Preset
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.pageSetup.presetId}
                    options={pagePresetOptions}
                    onChange={(presetId) =>
                      setAppPreferences({
                        ...appPreferences,
                        pageSetup: updatePageSetup(appPreferences.pageSetup, {
                          presetId: presetId as PagePresetId,
                        }),
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Orientation
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.pageSetup.orientation}
                    options={[
                      { value: 'portrait', label: 'Portrait' },
                      { value: 'landscape', label: 'Landscape' },
                    ]}
                    onChange={(orientation) =>
                      setAppPreferences({
                        ...appPreferences,
                        pageSetup: updatePageSetup(appPreferences.pageSetup, { orientation }),
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Units
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.pageSetup.unit}
                    options={[
                      { value: 'in', label: 'Inches' },
                      { value: 'cm', label: 'Centimeters' },
                    ]}
                    onChange={(unit) =>
                      setAppPreferences({
                        ...appPreferences,
                        pageSetup: updatePageSetup(
                          appPreferences.pageSetup,
                          { unit },
                          { preservePhysicalSizeOnUnitChange: true },
                        ),
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Page Width ({appPreferences.pageSetup.unit})
                <DeferredNumberInput
                  value={appPreferences.pageSetup.pageWidth}
                  min={0.5}
                  max={200}
                  step={0.01}
                  onCommit={(pageWidth) =>
                    setAppPreferences({
                      ...appPreferences,
                      pageSetup: updatePageSetup(appPreferences.pageSetup, {
                        presetId: 'custom',
                        pageWidth,
                      }),
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Page Height ({appPreferences.pageSetup.unit})
                <DeferredNumberInput
                  value={appPreferences.pageSetup.pageHeight}
                  min={0.5}
                  max={200}
                  step={0.01}
                  onCommit={(pageHeight) =>
                    setAppPreferences({
                      ...appPreferences,
                      pageSetup: updatePageSetup(appPreferences.pageSetup, {
                        presetId: 'custom',
                        pageHeight,
                      }),
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Rows
                <DeferredNumberInput
                  value={appPreferences.pageSetup.rows}
                  min={1}
                  max={20}
                  step={1}
                  integer
                  onCommit={(rows) =>
                    setAppPreferences({
                      ...appPreferences,
                      pageSetup: updatePageSetup(appPreferences.pageSetup, { rows }),
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Columns
                <DeferredNumberInput
                  value={appPreferences.pageSetup.columns}
                  min={1}
                  max={20}
                  step={1}
                  integer
                  onCommit={(columns) =>
                    setAppPreferences({
                      ...appPreferences,
                      pageSetup: updatePageSetup(appPreferences.pageSetup, { columns }),
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              {appPreferences.pageSetup.mode === 'finite' && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <button
                    type="button"
                    onClick={handleCenterPageInView}
                    style={{
                      padding: '6px 10px',
                      background: 'transparent',
                      color: theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Center Page In View
                  </button>
                  <button
                    type="button"
                    onClick={handleMoveContentIntoPage}
                    style={{
                      padding: '6px 10px',
                      background: 'transparent',
                      color: theme.text,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Move Content Onto Page
                  </button>
                  <span style={{ fontSize: '11px', color: hasOffPageContent ? '#d9534f' : '#888' }}>
                    {hasOffPageContent
                      ? 'Some content is outside the finite page area and may be clipped in export/print.'
                      : 'All current content is inside the finite page area.'}
                  </span>
                </div>
              )}
              <div
                style={{
                  gridColumn: '1 / -1',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#888',
                  marginBottom: -4,
                  marginTop: 6,
                }}
              >
                DOCUMENT DRAWING DEFAULTS
              </div>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Font Family
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.drawing.textFormat.fontFamily}
                    options={[
                      'Arial',
                      'Times New Roman',
                      'Courier New',
                      'Georgia',
                      'Verdana',
                      'Helvetica',
                    ].map((f) => ({ value: f, label: f }))}
                    onChange={(fontFamily) =>
                      setAppPreferences({
                        ...appPreferences,
                        drawing: {
                          ...appPreferences.drawing,
                          textFormat: { ...appPreferences.drawing.textFormat, fontFamily },
                        },
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Font Size
                <DeferredNumberInput
                  value={appPreferences.drawing.textFormat.fontSize}
                  min={8}
                  max={72}
                  step={1}
                  integer
                  onCommit={(fontSize) =>
                    setAppPreferences({
                      ...appPreferences,
                      drawing: {
                        ...appPreferences.drawing,
                        textFormat: {
                          ...appPreferences.drawing.textFormat,
                          fontSize,
                        },
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Text Alignment
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.drawing.textFormat.textAlign}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Center' },
                      { value: 'right', label: 'Right' },
                    ]}
                    onChange={(textAlign) =>
                      setAppPreferences({
                        ...appPreferences,
                        drawing: {
                          ...appPreferences.drawing,
                          textFormat: { ...appPreferences.drawing.textFormat, textAlign },
                        },
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Bond Length
                <DeferredNumberInput
                  value={appPreferences.drawing.bondLength}
                  min={8}
                  max={120}
                  step={0.1}
                  onCommit={(bondLength) =>
                    setAppPreferences({
                      ...appPreferences,
                      drawing: {
                        ...appPreferences.drawing,
                        bondLength,
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Bond Line Width
                <DeferredNumberInput
                  value={appPreferences.drawing.bondLineWidth}
                  min={0.1}
                  max={12}
                  step={0.1}
                  onCommit={(bondLineWidth) =>
                    setAppPreferences({
                      ...appPreferences,
                      drawing: {
                        ...appPreferences.drawing,
                        bondLineWidth,
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
            </div>
          )}
          {preferencesTab === 'colors' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 14,
                }}
              >
                <label style={{ fontSize: '12px', color: theme.text }}>
                  Bond Color
                  <input
                    type="color"
                    value={appPreferences.drawing.colors.bondColor}
                    onChange={(e) =>
                      setAppPreferences({
                        ...appPreferences,
                        drawing: {
                          ...appPreferences.drawing,
                          colors: { ...appPreferences.drawing.colors, bondColor: e.target.value },
                        },
                      })
                    }
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      height: '34px',
                      padding: '4px',
                      background: isDarkMode ? '#333' : '#fff',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                    }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: theme.text }}>
                  Text Color
                  <input
                    type="color"
                    value={appPreferences.drawing.textFormat.color}
                    onChange={(e) =>
                      setAppPreferences({
                        ...appPreferences,
                        drawing: {
                          ...appPreferences.drawing,
                          textFormat: {
                            ...appPreferences.drawing.textFormat,
                            color: e.target.value,
                          },
                        },
                      })
                    }
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      height: '34px',
                      padding: '4px',
                      background: isDarkMode ? '#333' : '#fff',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                    }}
                  />
                </label>
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#888' }}>
                    ATOM COLORS
                    {!appPreferences.drawing.colors.monochrome &&
                      ' — click any element to change its color'}
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '12px',
                      color: theme.text,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!appPreferences.drawing.colors.monochrome}
                      onChange={(e) =>
                        setAppPreferences({
                          ...appPreferences,
                          drawing: {
                            ...appPreferences.drawing,
                            colors: {
                              ...appPreferences.drawing.colors,
                              monochrome: !e.target.checked,
                            },
                          },
                        })
                      }
                    />
                    Color atom labels
                  </label>
                </div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: theme.text,
                    marginBottom: 10,
                  }}
                >
                  Atom Color Palette
                  <div style={{ marginTop: '4px' }}>
                    <SelectMenu
                      value={appPreferences.drawing.colors.atomColorPalette}
                      options={ATOM_COLOR_PALETTE_OPTIONS}
                      onChange={(value) => applyAtomColorPalette(value as AtomColorPaletteId)}
                      isDarkMode={isDarkMode}
                      textColor={theme.text}
                      borderColor={theme.border}
                    />
                  </div>
                </label>
                {/* Periodic table grid */}
                {(() => {
                  const CELL = 28;
                  const GAP = 2;
                  const isMonochrome = appPreferences.drawing.colors.monochrome;
                  const monochromeForeground = getMonochromeForeground(isDarkMode);
                  const getBackground = (sym: string) =>
                    isMonochrome
                      ? isDarkMode
                        ? '#2b2b2b'
                        : '#ffffff'
                      : (appPreferences.drawing.colors.atomColors[sym] ??
                        ELEMENT_COLORS[sym] ??
                        '#909090');
                  const getForeground = (sym: string) =>
                    isMonochrome ? monochromeForeground : contrastText(getBackground(sym));
                  const handleChange = (sym: string, color: string) =>
                    setAppPreferences({
                      ...appPreferences,
                      drawing: {
                        ...appPreferences.drawing,
                        colors: {
                          ...appPreferences.drawing.colors,
                          atomColors: { ...appPreferences.drawing.colors.atomColors, [sym]: color },
                        },
                      },
                    });
                  const renderCell = (sym: string) => {
                    if (!sym) return <div key="_gap" style={{ width: CELL, height: CELL }} />;
                    if (sym === 'La-Lu' || sym === 'Ac-Lr') {
                      return (
                        <div
                          key={sym}
                          style={{
                            width: CELL,
                            height: CELL,
                            border: '1px dashed #888',
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 5,
                            color: '#888',
                          }}
                        >
                          {sym}
                        </div>
                      );
                    }
                    const bg = getBackground(sym);
                    const fg = getForeground(sym);
                    return (
                      <label
                        key={sym}
                        title={sym}
                        style={{
                          width: CELL,
                          height: CELL,
                          background: bg,
                          border: `1px solid rgba(0,0,0,0.25)`,
                          borderRadius: 3,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isMonochrome ? 'default' : 'pointer',
                          position: 'relative',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 600,
                            color: fg,
                            pointerEvents: 'none',
                            lineHeight: 1,
                          }}
                        >
                          {sym}
                        </span>
                        <input
                          type="color"
                          value={
                            appPreferences.drawing.colors.atomColors[sym] ??
                            ELEMENT_COLORS[sym] ??
                            '#909090'
                          }
                          disabled={isMonochrome}
                          onChange={(e) => handleChange(sym, e.target.value)}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            opacity: 0,
                            width: '100%',
                            height: '100%',
                            cursor: isMonochrome ? 'default' : 'pointer',
                            padding: 0,
                            border: 'none',
                          }}
                        />
                      </label>
                    );
                  };
                  return (
                    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                      {/* Main table */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(18, ${CELL}px)`,
                          gap: GAP,
                          marginBottom: GAP * 2,
                        }}
                      >
                        {PT_MAIN.flat().map((sym, i) => (
                          <div key={i}>{renderCell(sym)}</div>
                        ))}
                      </div>
                      {/* f-block rows, indented by 3 cells */}
                      {[PT_LANTHANIDES, PT_ACTINIDES].map((row, ri) => (
                        <div
                          key={ri}
                          style={{
                            display: 'flex',
                            gap: GAP,
                            marginBottom: GAP,
                            paddingLeft: (CELL + GAP) * 3,
                          }}
                        >
                          {row.map((sym) => renderCell(sym))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* Reset atom colors button */}
                <button
                  type="button"
                  disabled={appPreferences.drawing.colors.monochrome}
                  onClick={() =>
                    applyAtomColorPalette(appPreferences.drawing.colors.atomColorPalette)
                  }
                  style={{
                    marginTop: 8,
                    padding: '4px 10px',
                    fontSize: 11,
                    background: 'transparent',
                    color: theme.text,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 4,
                    cursor: appPreferences.drawing.colors.monochrome ? 'default' : 'pointer',
                  }}
                >
                  Reset atom colors to selected palette
                </button>
              </div>
            </div>
          )}
          {preferencesTab === 'viewer' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 14,
              }}
            >
              <label style={{ fontSize: '12px', color: theme.text }}>
                Viewer Layout
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.viewer.mode}
                    options={[
                      { value: 'split', label: 'Split' },
                      { value: 'floating', label: 'Floating' },
                      { value: 'pinned', label: 'Pinned' },
                    ]}
                    onChange={(mode) =>
                      setAppPreferences({
                        ...appPreferences,
                        viewer: { ...appPreferences.viewer, mode },
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                3D Force Field
                <div style={{ marginTop: '4px' }}>
                  <SelectMenu
                    value={appPreferences.viewer.forceField}
                    options={[
                      { value: 'UFF', label: 'UFF' },
                      { value: 'MMFF94s', label: 'MMFF94s' },
                      { value: 'xtb', label: 'xTB' },
                      { value: 'hartree-fock', label: 'Hartree-Fock' },
                    ]}
                    onChange={(forceField) =>
                      setAppPreferences({
                        ...appPreferences,
                        viewer: { ...appPreferences.viewer, forceField },
                      })
                    }
                    isDarkMode={isDarkMode}
                    textColor={theme.text}
                    borderColor={theme.border}
                    backgroundColor={isDarkMode ? '#333' : '#fff'}
                  />
                </div>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                  marginTop: 20,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.viewer.multiConformer}
                  onChange={(e) =>
                    setAppPreferences({
                      ...appPreferences,
                      viewer: { ...appPreferences.viewer, multiConformer: e.target.checked },
                    })
                  }
                />
                Multi-conformer
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                  marginTop: 20,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.viewer.showAtomNumbers}
                  onChange={(e) =>
                    setAppPreferences({
                      ...appPreferences,
                      viewer: { ...appPreferences.viewer, showAtomNumbers: e.target.checked },
                    })
                  }
                />
                Show Atom Numbers
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                  marginTop: 20,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.viewer.showAtomLabels}
                  onChange={(e) =>
                    setAppPreferences({
                      ...appPreferences,
                      viewer: { ...appPreferences.viewer, showAtomLabels: e.target.checked },
                    })
                  }
                />
                Show Atom Labels
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                Max Conformers
                <DeferredNumberInput
                  value={appPreferences.viewer.maxConformers}
                  min={1}
                  max={50}
                  step={1}
                  integer
                  onCommit={(maxConformers) =>
                    setAppPreferences({
                      ...appPreferences,
                      viewer: {
                        ...appPreferences.viewer,
                        maxConformers,
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
            </div>
          )}
          {preferencesTab === 'app' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.isDarkMode}
                  onChange={(e) =>
                    setAppPreferences({ ...appPreferences, isDarkMode: e.target.checked })
                  }
                />
                Dark Mode
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.showGrid}
                  onChange={(e) =>
                    setAppPreferences({ ...appPreferences, showGrid: e.target.checked })
                  }
                />
                Grid
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: theme.text,
                }}
              >
                <input
                  type="checkbox"
                  checked={appPreferences.showHydrogens}
                  onChange={(e) =>
                    setAppPreferences({ ...appPreferences, showHydrogens: e.target.checked })
                  }
                />
                Implied Hydrogens
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                UI Scale
                <DeferredNumberInput
                  value={appPreferences.ui.scale}
                  min={0.8}
                  max={1.5}
                  step={0.05}
                  onCommit={(scale) =>
                    setAppPreferences({
                      ...appPreferences,
                      ui: {
                        ...appPreferences.ui,
                        scale,
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <label style={{ fontSize: '12px', color: theme.text }}>
                UI Font Size
                <DeferredNumberInput
                  value={appPreferences.ui.fontSize}
                  min={11}
                  max={18}
                  step={1}
                  integer
                  onCommit={(fontSize) =>
                    setAppPreferences({
                      ...appPreferences,
                      ui: {
                        ...appPreferences.ui,
                        fontSize,
                      },
                    })
                  }
                  style={numberInputStyle}
                />
              </label>
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px',
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  background: isDarkMode ? '#262626' : '#fafafa',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>
                    Keyboard Shortcuts
                  </span>
                  <span style={{ fontSize: 11, color: isDarkMode ? '#b5b5b5' : '#666' }}>
                    View every shortcut, grouped by category, and customize the bindings.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsKeybindingsOpen(true)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: `1px solid ${theme.border}`,
                    background: isDarkMode ? '#333' : '#fff',
                    color: theme.text,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  Open Keybinds
                </button>
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: '14px',
            paddingTop: '12px',
            borderTop: `1px solid ${theme.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '11px', color: '#888' }}>
            Current document defaults: {documentStyleSettings.textFormat.fontFamily},{' '}
            {documentStyleSettings.textFormat.fontSize}px, bond {documentStyleSettings.bondLength}px
            / {documentStyleSettings.bondLineWidth}px,{' '}
            {documentStyleSettings.colors.monochrome ? 'monochrome' : 'color'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleResetPreferencesToDefaults}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                color: theme.text,
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reset to Defaults
            </button>
            <button
              onClick={handleUseForNewDocumentContent}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                color: theme.text,
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Use for New Document Content
            </button>
            <button
              onClick={handleApplyDefaultsToCurrentDocument}
              disabled={!preferencesHydrated}
              style={{
                padding: '6px 10px',
                background: '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: preferencesHydrated ? 'pointer' : 'default',
                opacity: preferencesHydrated ? 1 : 0.6,
              }}
            >
              Apply to Current Document
            </button>
          </div>
        </div>
      </div>
      <KeybindingsPanel
        isOpen={isKeybindingsOpen}
        onClose={() => setIsKeybindingsOpen(false)}
        appPreferences={appPreferences}
        setAppPreferences={setAppPreferences}
        theme={theme}
        isDarkMode={isDarkMode}
      />
    </FloatingPanel>
  );
}
