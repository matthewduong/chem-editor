import { useState } from 'react';
import { useStore } from '../store';
import type { AppTheme } from './ViewerPanel';
import { FloatingPanel } from './FloatingPanel';

interface TransformDialogsProps {
  theme: AppTheme;
  isDarkMode: boolean;
  showRotateDialog: boolean;
  rotateInput: string;
  setRotateInput: (value: string) => void;
  onRotate: () => void;
  onCloseRotate: () => void;
  showScaleDialog: boolean;
  scaleInput: string;
  setScaleInput: (value: string) => void;
  onScale: () => void;
  onCloseScale: () => void;
}

export function TransformDialogs({
  theme,
  isDarkMode,
  showRotateDialog,
  rotateInput,
  setRotateInput,
  onRotate,
  onCloseRotate,
  showScaleDialog,
  scaleInput,
  setScaleInput,
  onScale,
  onCloseScale,
}: TransformDialogsProps) {
  const [rotatePos, setRotatePos] = useState(() => ({
    x: Math.max(24, Math.round((window.innerWidth - 320) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - 180) / 2)),
  }));
  const [rotateSize, setRotateSize] = useState({ width: 320, height: 180 });
  const [scalePos, setScalePos] = useState(() => ({
    x: Math.max(24, Math.round((window.innerWidth - 340) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - 210) / 2)),
  }));
  const [scaleSize, setScaleSize] = useState({ width: 340, height: 210 });
  return (
    <>
      {showRotateDialog && (
        <FloatingPanel
          pos={rotatePos}
          size={rotateSize}
          minWidth={280}
          minHeight={160}
          title="Rotate Selection"
          theme={theme}
          isDarkMode={isDarkMode}
          zIndex={3000}
          positionMode="fixed"
          onClose={onCloseRotate}
          onPosChange={setRotatePos}
          onSizeChange={setRotateSize}
        >
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}
            >
              <input
                autoFocus
                type="number"
                value={rotateInput}
                onChange={(e) => setRotateInput(e.target.value)}
                onFocus={() => useStore.getState().setIsInputFocused(true)}
                onBlur={() => useStore.getState().setIsInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRotate();
                  if (e.key === 'Escape') onCloseRotate();
                }}
                placeholder="Degrees"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: isDarkMode ? '#1e1e1e' : '#fff',
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              />
              <span style={{ color: theme.text, fontSize: '13px' }}>°</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={onCloseRotate}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={onRotate}
                style={{
                  padding: '6px 14px',
                  background: '#007acc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Rotate
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {showScaleDialog && (
        <FloatingPanel
          pos={scalePos}
          size={scaleSize}
          minWidth={300}
          minHeight={190}
          title="Scale Selection"
          theme={theme}
          isDarkMode={isDarkMode}
          zIndex={3000}
          positionMode="fixed"
          onClose={onCloseScale}
          onPosChange={setScalePos}
          onSizeChange={setScaleSize}
        >
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '10px' }}>
              Scale factor (e.g. 1.5 = 150%, 0.5 = 50%)
            </div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}
            >
              <input
                autoFocus
                type="number"
                min="0.01"
                step="0.1"
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                onFocus={() => useStore.getState().setIsInputFocused(true)}
                onBlur={() => useStore.getState().setIsInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onScale();
                  if (e.key === 'Escape') onCloseScale();
                }}
                placeholder="Scale factor"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: isDarkMode ? '#1e1e1e' : '#fff',
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              />
              <span style={{ color: theme.text, fontSize: '13px' }}>×</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={onCloseScale}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={onScale}
                style={{
                  padding: '6px 14px',
                  background: '#007acc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Scale
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
