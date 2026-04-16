import { useDraggableResizable } from '../hooks/useDraggableResizable';
import type { PanelTheme } from '../types/panelTheme';

interface FloatingPanelProps {
  pos: { x: number; y: number };
  size: { width: number; height: number };
  minWidth: number;
  minHeight: number;
  title: string;
  theme: PanelTheme;
  isDarkMode: boolean;
  zIndex?: number;
  borderRadius?: number;
  background?: string;
  boxShadow?: string;
  positionMode?: 'absolute' | 'fixed';
  style?: React.CSSProperties;
  onClose: () => void;
  onPosChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  headerExtra?: React.ReactNode;
  /** Replaces the entire header interior (title + headerExtra + close button). The drag handler is still applied. */
  headerChildren?: React.ReactNode;
  children: React.ReactNode;
}

export function FloatingPanel({
  pos,
  size,
  minWidth,
  minHeight,
  title,
  theme,
  isDarkMode,
  zIndex = 500,
  borderRadius = 4,
  background,
  boxShadow,
  positionMode = 'absolute',
  style,
  onClose,
  onPosChange,
  onSizeChange,
  headerExtra,
  headerChildren,
  children,
}: FloatingPanelProps) {
  const { handleDragStart, handleResizeStart } = useDraggableResizable({
    pos,
    size,
    minWidth,
    minHeight,
    onPosChange,
    onSizeChange,
  });
  const bg = background ?? (isDarkMode ? 'rgba(45,45,45,0.95)' : 'rgba(255,255,255,0.95)');
  const shadow = boxShadow ?? '0 2px 8px rgba(0,0,0,0.3)';

  return (
    <div
      style={{
        position: positionMode,
        top: pos.y,
        left: pos.x,
        width: size.width,
        height: size.height,
        background: bg,
        border: `1px solid ${theme.border}`,
        borderRadius,
        boxShadow: shadow,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          background: theme.header,
          borderBottom: `1px solid ${theme.border}`,
          cursor: 'move',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {headerChildren ?? (
          <>
            <span style={{ fontSize: 11, fontWeight: 'bold', color: theme.text }}>{title}</span>
            {headerExtra}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: theme.text,
                fontSize: 14,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 14,
          height: 14,
          cursor: 'nwse-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRight: `2px solid ${isDarkMode ? '#888' : '#aaa'}`,
            borderBottom: `2px solid ${isDarkMode ? '#888' : '#aaa'}`,
          }}
        />
      </div>
    </div>
  );
}
