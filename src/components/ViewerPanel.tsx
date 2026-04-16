import { lazy, Suspense } from 'react';
import type { Molecule3DRef } from './Molecule3DRef';
import type { PreviewMode, ViewerMode } from '../store';

const Molecule = lazy(() => import('./Molecule').then((m) => ({ default: m.Molecule })));
const Molecule3DThreePanel = lazy(() => import('./Molecule3DThreePanel'));

export interface AppTheme {
  bg: string;
  sidebar: string;
  header: string;
  text: string;
  border: string;
  canvas: string;
}

interface ViewerPanelProps {
  previewMode: PreviewMode;
  viewerSmiles: string;
  viewerMolblock: string;
  viewerSize: { width: number; height: number };
  isDarkMode: boolean;
  viewerHoveredAtomIdx: number | null;
  viewerSelectedAtomIdx: number | null;
  viewerSelectedAtomIndices: number[];
  viewerHoveredBondAtoms: [number, number] | null;
  viewerSelectedBondAtoms: Array<[number, number]>;
  theme: AppTheme;
  viewerMode: ViewerMode;
  setViewerMode: (mode: ViewerMode) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  onStartDragging: (e: React.MouseEvent) => void;
  onScreenshot: () => void;
  molecule3DRef: React.RefObject<Molecule3DRef | null>;
}

export function ViewerPanel({
  previewMode,
  viewerSmiles,
  viewerMolblock,
  viewerSize,
  isDarkMode,
  theme,
  viewerHoveredAtomIdx,
  viewerSelectedAtomIdx,
  viewerSelectedAtomIndices,
  viewerHoveredBondAtoms,
  viewerSelectedBondAtoms,
  viewerMode,
  setViewerMode,
  setPreviewMode,
  isSettingsOpen,
  setIsSettingsOpen,
  onStartDragging,
  onScreenshot,
  molecule3DRef,
}: ViewerPanelProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={onStartDragging}
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '6px 10px',
          gap: '10px',
          background: theme.header,
          borderBottom: `1px solid ${theme.border}`,
          zIndex: 10,
          alignItems: 'center',
          cursor: viewerMode === 'split' ? 'default' : 'move',
          flexShrink: 0,
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onScreenshot();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: theme.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            marginRight: 'auto',
            opacity: 0.8,
            borderRadius: '4px',
          }}
          title="Save Image"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </button>
        <div
          style={{
            display: 'flex',
            background: isDarkMode ? '#333' : '#e0e0e0',
            borderRadius: '6px',
            padding: '2px',
            height: '26px',
            alignItems: 'center',
            border: `1px solid ${theme.border}`,
          }}
        >
          {(['2D', '3D'] as const).map((m) => (
            <button
              key={m}
              onClick={(e) => {
                e.stopPropagation();
                setPreviewMode(m);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                fontSize: '10px',
                padding: '0 6px',
                height: '16px',
                cursor: 'pointer',
                background: previewMode === m ? '#007acc' : 'transparent',
                border: 'none',
                borderRadius: '2px',
                color: previewMode === m ? '#fff' : theme.text,
                fontWeight: previewMode === m ? 'bold' : 'normal',
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsSettingsOpen(!isSettingsOpen);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '24px',
              color: theme.text,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '4px',
              opacity: 0.8,
            }}
            title="Viewer Settings"
          >
            ⚙
          </button>
          {isSettingsOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '32px',
                right: 0,
                background: theme.header,
                border: `1px solid ${theme.border}`,
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                minWidth: '120px',
                padding: '8px',
                zIndex: 1000,
                borderRadius: '4px',
              }}
            >
              <div
                style={{ fontSize: '11px', fontWeight: 'bold', color: '#888', marginBottom: '8px' }}
              >
                LAYOUT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(['pinned', 'floating', 'split'] as ViewerMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setViewerMode(m);
                      setIsSettingsOpen(false);
                    }}
                    style={{
                      textAlign: 'left',
                      fontSize: '11px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      background:
                        viewerMode === m ? (isDarkMode ? '#37373d' : '#e0e0e0') : 'transparent',
                      border: 'none',
                      borderRadius: '3px',
                      color: theme.text,
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Suspense fallback={null}>
          <div
            style={{
              display: previewMode === '2D' ? 'block' : 'none',
              width: '100%',
              height: '100%',
            }}
          >
            <Molecule
              smiles={viewerSmiles}
              molblock={viewerMolblock}
              width={viewerSize.width - 10}
              height={viewerSize.height - 42}
              isDarkMode={isDarkMode}
              hoveredAtomIdx={viewerHoveredAtomIdx}
              selectedAtomIdx={viewerSelectedAtomIdx}
            />
          </div>
        </Suspense>
        <Suspense fallback={null}>
          <div
            style={{
              display: previewMode === '3D' ? 'block' : 'none',
              width: '100%',
              height: '100%',
            }}
          >
            <Molecule3DThreePanel
              ref={molecule3DRef}
              smiles={viewerSmiles}
              width={viewerSize.width - 10}
              height={viewerSize.height - 42}
              isDarkMode={isDarkMode}
              hoveredAtomIdx={viewerHoveredAtomIdx}
              selectedAtomIdx={viewerSelectedAtomIdx}
              selectedAtomIndices={viewerSelectedAtomIndices}
              hoveredBondAtoms={viewerHoveredBondAtoms}
              selectedBondAtoms={viewerSelectedBondAtoms}
            />
          </div>
        </Suspense>
      </div>
    </div>
  );
}
