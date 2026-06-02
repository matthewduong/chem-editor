import type {
  ChemDrawBounds,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawTable,
  ChemDrawText,
} from '../../types/chemdraw';
import type { DocumentStyleSettings } from '../../types/settings';
import { convertNativeToCanvas } from '../../lib/chemdrawMetrics';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../../lib/settings';
import { estimateRunWidth } from '../../lib/textRunPresentation';

type ChemDrawPage = ChemDrawDocument['pages'][number];

export interface SpatialEntry {
  id: string;
  object: ChemDrawObject;
  bounds: ChemDrawBounds;
}

export interface DocumentSpatialIndex {
  cellSize: number;
  cells: Map<string, string[]>;
}

export interface DocumentIndex {
  activePageId: string | null;
  activePage: ChemDrawPage | null;
  objectById: Map<string, ChemDrawObject>;
  objectOrder: string[];
  objectOrderIndexById: Map<string, number>;
  childrenByParent: Map<string, string[]>;
  nodeAdjacency: Map<string, Array<{ bondId: string; otherNodeId: string }>>;
  fragmentMembership: Map<string, string[]>;
  boundsById: Map<string, ChemDrawBounds>;
  spatialEntries: SpatialEntry[];
  spatialEntryById: Map<string, SpatialEntry>;
  spatialIndex: DocumentSpatialIndex;
  pageBounds: ChemDrawBounds | null;
}

const SPATIAL_INDEX_CELL_SIZE = 256;

function unionBounds(bounds: ChemDrawBounds[]): ChemDrawBounds | null {
  if (!bounds.length) return null;
  return {
    left: Math.min(...bounds.map((entry) => entry.left)),
    top: Math.min(...bounds.map((entry) => entry.top)),
    right: Math.max(...bounds.map((entry) => entry.right)),
    bottom: Math.max(...bounds.map((entry) => entry.bottom)),
  };
}

function intersects(a: ChemDrawBounds, b: ChemDrawBounds): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function getCellCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function getSpatialCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function populateSpatialIndex(index: DocumentSpatialIndex, entry: SpatialEntry) {
  const minX = getCellCoordinate(entry.bounds.left, index.cellSize);
  const maxX = getCellCoordinate(entry.bounds.right, index.cellSize);
  const minY = getCellCoordinate(entry.bounds.top, index.cellSize);
  const maxY = getCellCoordinate(entry.bounds.bottom, index.cellSize);
  for (let cellY = minY; cellY <= maxY; cellY += 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const key = getSpatialCellKey(cellX, cellY);
      const bucket = index.cells.get(key);
      if (bucket) bucket.push(entry.id);
      else index.cells.set(key, [entry.id]);
    }
  }
}

function collectCandidateIds(
  index: DocumentIndex,
  bounds: ChemDrawBounds,
): Array<{ id: string; orderIndex: number }> {
  const minX = getCellCoordinate(bounds.left, index.spatialIndex.cellSize);
  const maxX = getCellCoordinate(bounds.right, index.spatialIndex.cellSize);
  const minY = getCellCoordinate(bounds.top, index.spatialIndex.cellSize);
  const maxY = getCellCoordinate(bounds.bottom, index.spatialIndex.cellSize);
  const seen = new Set<string>();
  const candidates: Array<{ id: string; orderIndex: number }> = [];

  for (let cellY = minY; cellY <= maxY; cellY += 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const bucket = index.spatialIndex.cells.get(getSpatialCellKey(cellX, cellY));
      if (!bucket) continue;
      for (const id of bucket) {
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push({
          id,
          orderIndex: index.objectOrderIndexById.get(id) ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  candidates.sort((left, right) => left.orderIndex - right.orderIndex);
  return candidates;
}

function getTextRunLineCount(text: ChemDrawText['text']): number {
  return Math.max(
    1,
    text.runs.reduce((count, run) => count + (run.text === '\n' ? 1 : 0), 1),
  );
}

function getTextBounds(
  text: ChemDrawText,
  documentStyleSettings: DocumentStyleSettings,
): ChemDrawBounds {
  const fontSize =
    text.style?.fontSize != null
      ? convertNativeToCanvas(text.style.fontSize, documentStyleSettings)
      : documentStyleSettings.textFormat.fontSize;
  const width =
    text.text.width ??
    Math.max(
      text.text.runs.reduce((sum, run) => sum + estimateRunWidth(run, fontSize), 0),
      fontSize,
    );
  const height = getTextRunLineCount(text.text) * fontSize;
  return {
    left: text.anchor.x - width / 2,
    top: text.anchor.y - height / 2,
    right: text.anchor.x + width / 2,
    bottom: text.anchor.y + height / 2,
  };
}

function getGraphicBounds(graphic: ChemDrawGraphic): ChemDrawBounds | null {
  if (graphic.bounds) return graphic.bounds;
  if (!graphic.points?.length) return null;
  return {
    left: Math.min(...graphic.points.map((point) => point.x)),
    top: Math.min(...graphic.points.map((point) => point.y)),
    right: Math.max(...graphic.points.map((point) => point.x)),
    bottom: Math.max(...graphic.points.map((point) => point.y)),
  };
}

function getEmbeddedObjectBounds(embeddedObject: ChemDrawEmbeddedObject): ChemDrawBounds {
  return embeddedObject.bounds;
}

function getTableBounds(table: ChemDrawTable): ChemDrawBounds {
  return table.bounds;
}

function getObjectBounds(
  object: ChemDrawObject,
  objectById: Map<string, ChemDrawObject>,
  documentStyleSettings: DocumentStyleSettings,
  cache: Map<string, ChemDrawBounds>,
): ChemDrawBounds | null {
  const cached = cache.get(object.id);
  if (cached) return cached;

  let computed: ChemDrawBounds | null = null;
  if (object.type === 'node') {
    computed = {
      left: object.position.x,
      top: object.position.y,
      right: object.position.x,
      bottom: object.position.y,
    };
  } else if (object.type === 'bond') {
    const begin = objectById.get(object.beginNodeId);
    const end = objectById.get(object.endNodeId);
    if (begin?.type === 'node' && end?.type === 'node') {
      computed = {
        left: Math.min(begin.position.x, end.position.x),
        top: Math.min(begin.position.y, end.position.y),
        right: Math.max(begin.position.x, end.position.x),
        bottom: Math.max(begin.position.y, end.position.y),
      };
    }
  } else if (object.type === 'arrow') {
    const xs = [object.tail.x, object.head.x];
    const ys = [object.tail.y, object.head.y];
    if (object.controlPoint) {
      xs.push(object.controlPoint.x);
      ys.push(object.controlPoint.y);
    }
    computed = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  } else if (object.type === 'text') {
    computed = getTextBounds(object, documentStyleSettings);
  } else if (object.type === 'bracket') {
    computed = object.bounds;
  } else if (object.type === 'graphic') {
    computed = getGraphicBounds(object);
  } else if (object.type === 'embedded-object') {
    computed = getEmbeddedObjectBounds(object);
  } else if (object.type === 'table') {
    computed = getTableBounds(object);
  } else if (object.type === 'group') {
    const childBounds = object.childIds
      .map((childId) => objectById.get(childId))
      .filter((child): child is ChemDrawObject => Boolean(child))
      .map((child) => getObjectBounds(child, objectById, documentStyleSettings, cache))
      .filter((bounds): bounds is ChemDrawBounds => Boolean(bounds));
    computed = unionBounds(childBounds);
  } else if (object.type === 'fragment') {
    const memberBounds = [...object.nodeIds, ...object.bondIds]
      .map((childId) => objectById.get(childId))
      .filter((child): child is ChemDrawObject => Boolean(child))
      .map((child) => getObjectBounds(child, objectById, documentStyleSettings, cache))
      .filter((bounds): bounds is ChemDrawBounds => Boolean(bounds));
    computed = unionBounds(memberBounds);
  }

  if (computed) cache.set(object.id, computed);
  return computed;
}

function buildChildrenByParent(page: ChemDrawPage): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  for (const object of page.objects) {
    if (object.type === 'fragment') {
      childrenByParent.set(object.id, [...object.nodeIds, ...object.bondIds]);
    } else if (object.type === 'group') {
      childrenByParent.set(object.id, [...object.childIds]);
    }
  }
  return childrenByParent;
}

function buildNodeAdjacency(page: ChemDrawPage): DocumentIndex['nodeAdjacency'] {
  const adjacency = new Map<string, Array<{ bondId: string; otherNodeId: string }>>();
  for (const object of page.objects) {
    if (object.type === 'node') adjacency.set(object.id, []);
  }
  for (const object of page.objects) {
    if (object.type !== 'bond') continue;
    adjacency.get(object.beginNodeId)?.push({ bondId: object.id, otherNodeId: object.endNodeId });
    adjacency.get(object.endNodeId)?.push({ bondId: object.id, otherNodeId: object.beginNodeId });
  }
  return adjacency;
}

function buildFragmentMembership(page: ChemDrawPage): Map<string, string[]> {
  const membership = new Map<string, string[]>();
  for (const object of page.objects) {
    if (object.type !== 'fragment') continue;
    for (const memberId of [...object.nodeIds, ...object.bondIds]) {
      const current = membership.get(memberId) ?? [];
      current.push(object.id);
      membership.set(memberId, current);
    }
  }
  return membership;
}

export function getActivePage(
  document: ChemDrawDocument | null | undefined,
  activePageId?: string | null,
): ChemDrawPage | null {
  if (!document?.pages.length) return null;
  return document.pages.find((page) => page.id === activePageId) ?? document.pages[0] ?? null;
}

export function buildDocumentIndex(
  document: ChemDrawDocument | null | undefined,
  options?: {
    activePageId?: string | null;
    documentStyleSettings?: DocumentStyleSettings;
  },
): DocumentIndex {
  const activePage = getActivePage(document, options?.activePageId);
  const objectById = new Map<string, ChemDrawObject>();
  const boundsById = new Map<string, ChemDrawBounds>();
  const documentStyleSettings = options?.documentStyleSettings ?? DEFAULT_DOCUMENT_STYLE_SETTINGS;

  if (!activePage) {
    return {
      activePageId: null,
      activePage: null,
      objectById,
      objectOrder: [],
      objectOrderIndexById: new Map(),
      childrenByParent: new Map(),
      nodeAdjacency: new Map(),
      fragmentMembership: new Map(),
      boundsById,
      spatialEntries: [],
      spatialEntryById: new Map(),
      spatialIndex: {
        cellSize: SPATIAL_INDEX_CELL_SIZE,
        cells: new Map(),
      },
      pageBounds: null,
    };
  }

  for (const object of activePage.objects) objectById.set(object.id, object);
  for (const object of activePage.objects) {
    const bounds = getObjectBounds(object, objectById, documentStyleSettings, boundsById);
    if (bounds) boundsById.set(object.id, bounds);
  }

  const spatialEntries = activePage.objects
    .map((object) => {
      const bounds = boundsById.get(object.id);
      return bounds ? { id: object.id, object, bounds } : null;
    })
    .filter((entry): entry is SpatialEntry => Boolean(entry));
  const spatialEntryById = new Map(spatialEntries.map((entry) => [entry.id, entry]));
  const objectOrder = activePage.objects.map((object) => object.id);
  const objectOrderIndexById = new Map(objectOrder.map((id, index) => [id, index]));
  const spatialIndex: DocumentSpatialIndex = {
    cellSize: SPATIAL_INDEX_CELL_SIZE,
    cells: new Map(),
  };
  for (const entry of spatialEntries) populateSpatialIndex(spatialIndex, entry);

  return {
    activePageId: activePage.id,
    activePage,
    objectById,
    objectOrder,
    objectOrderIndexById,
    childrenByParent: buildChildrenByParent(activePage),
    nodeAdjacency: buildNodeAdjacency(activePage),
    fragmentMembership: buildFragmentMembership(activePage),
    boundsById,
    spatialEntries,
    spatialEntryById,
    spatialIndex,
    pageBounds: activePage.bounds ?? unionBounds(spatialEntries.map((entry) => entry.bounds)),
  };
}

export function queryObjectsInBounds(index: DocumentIndex, bounds: ChemDrawBounds): SpatialEntry[] {
  return collectCandidateIds(index, bounds)
    .map(({ id }) => index.spatialEntryById.get(id))
    .filter((entry): entry is SpatialEntry => Boolean(entry))
    .filter((entry) => intersects(entry.bounds, bounds));
}

export function getVisibleObjects(
  index: DocumentIndex,
  viewportBounds: ChemDrawBounds,
): ChemDrawObject[] {
  return queryObjectsInBounds(index, viewportBounds).map((entry) => entry.object);
}
