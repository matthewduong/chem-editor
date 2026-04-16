import { getVisibleObjects } from '../document';
import { OBJECT_MODULES } from './objectModules';
import { createViewportBounds, drawPageTiles } from './page';
import type { DocumentSceneState, RenderSceneOptions } from './types';

export type {
  DocumentSceneState,
  LegacyCanvasSceneState,
  ObjectModule,
  ObjectModuleContext,
  RenderSceneOptions,
  SceneHitTestOptions,
} from './types';

export { OBJECT_MODULES } from './objectModules';
export { createViewportBounds } from './page';

export function renderDocumentScene(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  options: RenderSceneOptions,
) {
  const viewportBounds = createViewportBounds(options);
  ctx.save();
  ctx.translate(options.stagePos.x, options.stagePos.y);
  ctx.scale(options.stageScale, options.stageScale);

  drawPageTiles(ctx, scene);

  const visibleObjects = getVisibleObjects(scene.index, viewportBounds);
  for (const object of visibleObjects) {
    if (scene.hiddenObjectIds.has(object.id)) continue;
    OBJECT_MODULES[object.type].draw(object, { ctx, scene });
  }

  ctx.restore();
}
