import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { DocumentSceneState, RenderSceneOptions } from './renderDocumentScene';
import { renderDocumentScene } from './renderDocumentScene';

export interface DocumentRenderSurfaceRef {
  toDataURL: (options?: Partial<RenderSceneOptions> & { pixelRatio?: number }) => string;
}

interface Props extends RenderSceneOptions {
  scene: DocumentSceneState;
  exportScene?: DocumentSceneState;
}

function paintScene(
  canvas: HTMLCanvasElement,
  scene: DocumentSceneState,
  options: RenderSceneOptions,
  pixelRatio = window.devicePixelRatio || 1,
) {
  const nextWidth = Math.max(1, Math.round(options.width * pixelRatio));
  const nextHeight = Math.max(1, Math.round(options.height * pixelRatio));
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
  canvas.style.width = `${options.width}px`;
  canvas.style.height = `${options.height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, options.width, options.height);
  renderDocumentScene(ctx, scene, options);
}

export const DocumentRenderSurface = forwardRef<DocumentRenderSurfaceRef, Props>(
  ({ scene, exportScene, width, height, stageScale, stagePos }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const latest = useRef({ scene, width, height, stageScale, stagePos });
    const frame = useRef<number | null>(null);
    useEffect(() => {
      latest.current = { scene, width, height, stageScale, stagePos };
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (canvasRef.current) {
          const { scene, ...options } = latest.current;
          paintScene(canvasRef.current, scene, options);
        }
      });
    }, [height, scene, stagePos, stageScale, width]);
    useEffect(
      () => () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        toDataURL: (options) => {
          const canvas = document.createElement('canvas');
          paintScene(
            canvas,
            exportScene ?? scene,
            {
              width: options?.width ?? width,
              height: options?.height ?? height,
              stageScale: options?.stageScale ?? stageScale,
              stagePos: options?.stagePos ?? stagePos,
              drawPageChrome: false,
            },
            options?.pixelRatio ?? 1,
          );
          return canvas.toDataURL('image/png');
        },
      }),
      [height, scene, exportScene, stagePos, stageScale, width],
    );

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: 'none',
        }}
      />
    );
  },
);
