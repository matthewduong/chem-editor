import type { ChemDrawObject, ChemDrawObjectType } from '../../types/chemdraw';
import { queryObjectsInBounds } from '../document';
import { OBJECT_MODULES } from './objectModules';
import type { DocumentSceneState } from './types';

export interface DocumentSceneHit {
  objectId: string;
  objectType: ChemDrawObjectType;
  object: ChemDrawObject;
  atomId: string | null;
  bondId: string | null;
  arrowId: string | null;
  textBoxId: string | null;
  nativeObjectId: string | null;
}

const HIT_PRIORITY: ChemDrawObjectType[] = [
  'node',
  'bond',
  'arrow',
  'text',
  'embedded-object',
  'table',
  'bracket',
  'graphic',
  'fragment',
  'group',
];

function buildSearchBounds(point: { x: number; y: number }, stageScale: number) {
  const tolerance = 18 / stageScale;
  return {
    left: point.x - tolerance,
    top: point.y - tolerance,
    right: point.x + tolerance,
    bottom: point.y + tolerance,
  };
}

function buildHit(object: ChemDrawObject): DocumentSceneHit {
  return {
    objectId: object.id,
    objectType: object.type,
    object,
    atomId: object.type === 'node' ? object.id : null,
    bondId: object.type === 'bond' ? object.id : null,
    arrowId: object.type === 'arrow' ? object.id : null,
    textBoxId: object.type === 'text' ? object.id : null,
    nativeObjectId:
      object.type === 'graphic' ||
      object.type === 'embedded-object' ||
      object.type === 'table' ||
      object.type === 'bracket' ||
      object.type === 'fragment' ||
      object.type === 'group'
        ? object.id
        : null,
  };
}

export function hitTestDocumentScene(
  scene: DocumentSceneState,
  point: { x: number; y: number },
  options: { stageScale: number },
): DocumentSceneHit | null {
  const candidates = queryObjectsInBounds(scene.index, buildSearchBounds(point, options.stageScale))
    .map((entry) => entry.object)
    .reverse();
  const context = { scene, ctx: null as unknown as CanvasRenderingContext2D };
  for (const type of HIT_PRIORITY) {
    for (const object of candidates) {
      if (object.type !== type) continue;
      if (scene.hiddenObjectIds.has(object.id)) continue;
      const module = OBJECT_MODULES[object.type];
      if (!module.hitTest) continue;
      if (module.hitTest(object, point, context, { stageScale: options.stageScale })) {
        return buildHit(object);
      }
    }
  }
  return null;
}
