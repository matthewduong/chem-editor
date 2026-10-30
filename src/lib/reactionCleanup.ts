import type { ChemDrawArrow, ChemDrawDocument, ChemDrawReactionStep } from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';
import { resolveArcArrow } from './arrowArc';
import { getObjectsBounds, mapArrow, moveSelectedObjects } from './chemdrawModel';

/**
 * Structure > Clean Up Reaction (ChemDraw 17.1 guide): lays a step out along its arrow.
 * Reactants go in a row before the arrow's tail and products after its head, centred on the
 * arrow's line, in the order they already stand; objects above and below the arrow are stacked
 * over and under its middle; and the arrow is lengthened when what it carries is wider than it.
 * Gaps are one bond length (ChemDraw's own spacing is not measured; gaps.md).
 */
export function cleanUpReaction(
  document: ChemDrawDocument,
  settings: DocumentStyleSettings,
): ChemDrawDocument {
  let result = document;
  for (const step of document.pages[0]?.schemes?.flatMap((scheme) => scheme.steps) ?? []) {
    result = cleanUpStep(result, step, settings);
  }
  return result;
}

function cleanUpStep(
  document: ChemDrawDocument,
  step: ChemDrawReactionStep,
  settings: DocumentStyleSettings,
): ChemDrawDocument {
  const page = document.pages[0];
  const arrow = page?.objects.find(
    (object): object is ChemDrawArrow => object.type === 'arrow' && object.id === step.arrows[0],
  );
  if (!page || !arrow || resolveArcArrow(arrow)) return document;
  const length = Math.hypot(arrow.head.x - arrow.tail.x, arrow.head.y - arrow.tail.y);
  if (length < 1e-6) return document;
  const u = {
    x: (arrow.head.x - arrow.tail.x) / length,
    y: (arrow.head.y - arrow.tail.y) / length,
  };
  // "Up" from the arrow: its left normal, which is up the page for a left-to-right arrow.
  const up = { x: u.y, y: -u.x };
  const gap = settings.bondLength;
  const present = new Set(page.objects.map((object) => object.id));
  const ids = (list: string[]) => list.filter((id) => present.has(id));

  // An object's extent along the arrow (s) and across it (t), in the arrow's frame at its tail.
  const frame = (doc: ChemDrawDocument, id: string) => {
    const bounds = getObjectsBounds(doc, [id], settings);
    if (!bounds) return null;
    const corners = [
      [bounds.left, bounds.top],
      [bounds.right, bounds.top],
      [bounds.left, bounds.bottom],
      [bounds.right, bounds.bottom],
    ].map(([x, y]) => ({
      s: (x! - arrow.tail.x) * u.x + (y! - arrow.tail.y) * u.y,
      t: (x! - arrow.tail.x) * up.x + (y! - arrow.tail.y) * up.y,
    }));
    return {
      s0: Math.min(...corners.map((c) => c.s)),
      s1: Math.max(...corners.map((c) => c.s)),
      t0: Math.min(...corners.map((c) => c.t)),
      t1: Math.max(...corners.map((c) => c.t)),
    };
  };
  const moveBy = (doc: ChemDrawDocument, id: string, ds: number, dt: number) => {
    const object = doc.pages[0]!.objects.find((entry) => entry.id === id);
    const targets = new Set(object?.type === 'fragment' ? object.nodeIds : [id]);
    return moveSelectedObjects(doc, targets, ds * u.x + dt * up.x, ds * u.y + dt * up.y);
  };

  let doc = document;
  // The arrow first, so the rest is laid out against its final length.
  const carried = [...ids(step.aboveArrow), ...ids(step.belowArrow)]
    .map((id) => frame(doc, id))
    .filter((entry) => entry !== null);
  const widest = Math.max(0, ...carried.map((entry) => entry.s1 - entry.s0));
  const arrowLength = Math.max(length, widest + 2 * gap);
  if (arrowLength > length + 1e-6) {
    doc = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          objects: doc.pages[0]!.objects.map((object) =>
            object.id === arrow.id && object.type === 'arrow'
              ? mapArrow(object, (x, y) => {
                  const s = (x - arrow.tail.x) * u.x + (y - arrow.tail.y) * u.y;
                  const extra = (s / length) * (arrowLength - length);
                  return { x: x + u.x * extra, y: y + u.y * extra };
                })
              : object,
          ),
        },
        ...doc.pages.slice(1),
      ],
    };
  }

  const inOrder = (list: string[]) =>
    ids(list)
      .map((id) => ({ id, box: frame(doc, id) }))
      .filter((entry): entry is { id: string; box: NonNullable<ReturnType<typeof frame>> } =>
        Boolean(entry.box),
      )
      .sort((a, b) => a.box.s0 - b.box.s0);

  // Reactants: right to left from the tail.
  let edge = -gap;
  for (const { id, box } of inOrder(step.reactants).reverse()) {
    doc = moveBy(doc, id, edge - box.s1, -(box.t0 + box.t1) / 2);
    edge -= box.s1 - box.s0 + gap;
  }
  // Products: left to right from the head.
  edge = arrowLength + gap;
  for (const { id, box } of inOrder(step.products)) {
    doc = moveBy(doc, id, edge - box.s0, -(box.t0 + box.t1) / 2);
    edge += box.s1 - box.s0 + gap;
  }
  // Above and below: stacked outward from the arrow, centred on its middle.
  const middle = arrowLength / 2;
  let level = gap / 2;
  for (const { id, box } of inOrder(step.aboveArrow)) {
    doc = moveBy(doc, id, middle - (box.s0 + box.s1) / 2, level - box.t0);
    level += box.t1 - box.t0 + gap / 4;
  }
  level = -gap / 2;
  for (const { id, box } of inOrder(step.belowArrow)) {
    doc = moveBy(doc, id, middle - (box.s0 + box.s1) / 2, level - box.t1);
    level -= box.t1 - box.t0 + gap / 4;
  }
  return doc;
}
