import { lazy, Suspense, type CSSProperties } from 'react';
import type { Molecule3DRef } from './Molecule3DRef';
import type { PreviewMode, ViewerMode } from '../store';
import { IconButton, OptionButton, SegmentedControl } from './ui/Controls';

const Molecule = lazy(() => import('./Molecule').then((m) => ({ default: m.Molecule })));
const Molecule3DThreePanel = lazy(() => import('./Molecule3DThreePanel'));

const PREVIEW_MODE_OPTIONS: Array<{ value: PreviewMode; label: string }> = [
  { value: '2D', label: '2D' },
  { value: '3D', label: '3D' },
];

const VIEWER_MODE_OPTIONS: ViewerMode[] = ['pinned', 'floating', 'split'];

const VIEWER_MODE_LABELS: Record<ViewerMode, string> = {
  pinned: 'Pinned',
  floating: 'Floating',
  split: 'Split',
};

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
  const viewerPanelStyle = {
    '--viewer-header-bg': theme.header,
    '--viewer-border': theme.border,
  } as CSSProperties;

  return (
    <div className="viewer-panel" style={viewerPanelStyle}>
      <div
        className="viewer-panel__header"
        onMouseDown={onStartDragging}
        style={{ cursor: viewerMode === 'split' ? 'default' : 'move' }}
      >
        <IconButton
          label="Save Image"
          size="sm"
          className="viewer-panel__save-button"
          onClick={(e) => {
            e.stopPropagation();
            onScreenshot();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <CameraIcon />
        </IconButton>
        <SegmentedControl
          label="Preview mode"
          value={previewMode}
          options={PREVIEW_MODE_OPTIONS}
          onChange={setPreviewMode}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div className="viewer-panel__settings">
          <IconButton
            label="Viewer Settings"
            onClick={(e) => {
              e.stopPropagation();
              setIsSettingsOpen(!isSettingsOpen);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <SettingsIcon />
          </IconButton>
          {isSettingsOpen && (
            <div
              className="viewer-panel__settings-menu"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="viewer-panel__settings-label">LAYOUT</div>
              <div className="viewer-panel__settings-options">
                {VIEWER_MODE_OPTIONS.map((mode) => (
                  <OptionButton
                    key={mode}
                    active={viewerMode === mode}
                    onClick={() => {
                      setViewerMode(mode);
                      setIsSettingsOpen(false);
                    }}
                  >
                    {VIEWER_MODE_LABELS[mode]}
                  </OptionButton>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="viewer-panel__content">
        <Suspense fallback={null}>
          <div className="viewer-panel__mode-pane" hidden={previewMode !== '2D'}>
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
          <div className="viewer-panel__mode-pane" hidden={previewMode !== '3D'}>
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

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
