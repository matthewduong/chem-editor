import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { getObjectTagAnchor, getTextBlockPlainText } from '../../../lib/objectTags';
import { measureRunWidth } from '../../../lib/textRunPresentation';
import type { ChemDrawObjectTag, ChemDrawPoint } from '../../../types/chemdraw';
import type { DocumentSceneState } from '../types';
import { adaptColor, drawRunText } from '../drawPrimitives';

export function drawObjectTags(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  objectTags: ChemDrawObjectTag[] | undefined,
  options?: {
    fallbackAnchor?: ChemDrawPoint;
    fallbackColor?: string;
  },
) {
  if (!objectTags?.length) return;
  for (const tag of objectTags) {
    if (tag.visible === false) continue;
    const plainText = getTextBlockPlainText(tag.text);
    if (!plainText) continue;
    const anchor = getObjectTagAnchor(tag) ?? options?.fallbackAnchor;
    if (!anchor) continue;
    const baseAnchor =
      tag.positioningOffset && options?.fallbackAnchor
        ? {
            x: options.fallbackAnchor.x + tag.positioningOffset.x,
            y: options.fallbackAnchor.y + tag.positioningOffset.y,
          }
        : anchor;
    const fontFamily =
      tag.style?.fontFamily ?? scene.documentStyleSettings.nativeMetrics.captionFontFamily;
    const fontSize =
      tag.style?.fontSize != null
        ? convertNativeToCanvas(tag.style.fontSize, scene.documentStyleSettings)
        : convertNativeToCanvas(
            scene.documentStyleSettings.nativeMetrics.captionSize,
            scene.documentStyleSettings,
          );
    const color = adaptColor(
      tag.style?.color ?? options?.fallbackColor ?? '#000000',
      scene.isDarkMode,
    );
    const runs = tag.text?.runs ?? [{ text: plainText }];
    const totalWidth = runs.reduce(
      (sum, run) => sum + measureRunWidth(run, fontSize, fontFamily),
      0,
    );
    const startX =
      tag.text?.justification === 'left'
        ? baseAnchor.x
        : tag.text?.justification === 'right'
          ? baseAnchor.x - totalWidth
          : baseAnchor.x - totalWidth / 2;
    let cursorX = startX;
    const startY = baseAnchor.y - fontSize * 0.45;
    for (const run of runs) {
      drawRunText(
        ctx,
        run,
        cursorX,
        startY,
        fontSize,
        fontFamily,
        adaptColor(run.color ?? color, scene.isDarkMode),
      );
      cursorX += measureRunWidth(run, fontSize, fontFamily);
    }
  }
}
