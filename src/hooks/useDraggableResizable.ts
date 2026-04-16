import { useCallback } from 'react';

interface Options {
  pos: { x: number; y: number };
  size: { width: number; height: number };
  minWidth: number;
  minHeight: number;
  onPosChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
}

export function useDraggableResizable({
  pos,
  size,
  minWidth,
  minHeight,
  onPosChange,
  onSizeChange,
}: Options) {
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const initPos = { ...pos };
      const move = (ev: MouseEvent) => {
        onPosChange({
          x: Math.max(0, initPos.x + ev.clientX - startX),
          y: Math.max(0, initPos.y + ev.clientY - startY),
        });
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [pos, onPosChange],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const initSize = { ...size };
      document.body.style.cursor = 'nwse-resize';
      const move = (ev: MouseEvent) => {
        onSizeChange({
          width: Math.max(minWidth, initSize.width + ev.clientX - startX),
          height: Math.max(minHeight, initSize.height + ev.clientY - startY),
        });
      };
      const up = () => {
        document.body.style.cursor = 'default';
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [size, minWidth, minHeight, onSizeChange],
  );

  return { handleDragStart, handleResizeStart };
}
