import { getPageSetupDimensionsPx } from '../../lib/settings';
import type { DocumentSceneState, RenderSceneOptions } from './types';

export function createViewportBounds(options: RenderSceneOptions) {
  return {
    left: -options.stagePos.x / options.stageScale,
    top: -options.stagePos.y / options.stageScale,
    right: (options.width - options.stagePos.x) / options.stageScale,
    bottom: (options.height - options.stagePos.y) / options.stageScale,
  };
}

export function drawPageTiles(ctx: CanvasRenderingContext2D, scene: DocumentSceneState) {
  if (scene.pageSetup.mode !== 'finite') return;
  const metrics = getPageSetupDimensionsPx(scene.pageSetup);
  for (let index = 0; index < scene.pageSetup.rows * scene.pageSetup.columns; index += 1) {
    const row = Math.floor(index / scene.pageSetup.columns);
    const column = index % scene.pageSetup.columns;
    ctx.fillStyle = scene.isDarkMode ? '#242424' : '#ffffff';
    ctx.strokeStyle = scene.isDarkMode ? '#7a7a7a' : '#8a8a8a';
    ctx.lineWidth = 1;
    ctx.fillRect(
      column * metrics.pageWidthPx,
      row * metrics.pageHeightPx,
      metrics.pageWidthPx,
      metrics.pageHeightPx,
    );
    ctx.strokeRect(
      column * metrics.pageWidthPx,
      row * metrics.pageHeightPx,
      metrics.pageWidthPx,
      metrics.pageHeightPx,
    );
  }
}
