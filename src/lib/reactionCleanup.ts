import type {
  ChemDrawArrow,
  ChemDrawDocument,
  ChemDrawObject,
  ChemDrawReactionStep,
  ChemDrawText,
} from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';
import { resolveArcArrow } from './arrowArc';
import { getObjectsBounds, mapArrow, moveSelectedObjects } from './chemdrawModel';

/**
 * Structure > Clean Up Reaction (ChemDraw 17.1 guide): lays a step out along its arrow.
 * Reactants go in a row before the arrow's tail and products after its head, centred on the
 * arrow's line, in the order they already stand; objects above and below the arrow are stacked
 * over and under its middle; and the arrow is lengthened when what it carries is wider than it.
 *
 * Spacing was measured on ChemDraw 26.1.0.6801 (gaps.md): the gap between a reactant or product
 * and its neighbour, the plus sign or the arrow's end, is 1.515 x the CaptionSize (15.1pt at 10,
 * 21.2pt at 14; the bond length does not enter), the arrow is the widest label it carries plus
 * two of those gaps, and text above or below stands 0.575 x the CaptionSize from the arrow. It
 * also inserts a `+` between reactants that have none, which this does not.
 */
const GAP_OF_CAPTION = 1.515;
/**
 * Between two reactants ChemDraw puts a `+` (text at the caption size) centred on the arrow's line
 * with a gap on each side: its box was 0.473 x the size wide, its left edge 0.056 x the size right
 * of the anchor, and its baseline 0.352 x the size below the line.
 */
const PLUS_WIDTH_OF_SIZE = 0.473;
const PLUS_LEFT_OF_ANCHOR = 0.056;
const PLUS_BASELINE_BELOW_LINE = 0.352;
const TEXT_OFFSET_OF_CAPTION = 0.575;

export function cleanUpReaction(
  document: ChemDrawDocument,
  settings: DocumentStyleSettings,
  newId: () => string = () => crypto.randomUUID(),
): ChemDrawDocument {
  let result = document;
  for (const step of document.pages[0]?.schemes?.flatMap((scheme) => scheme.steps) ?? []) {
    result = cleanUpStep(result, step, settings, newId);
  }
  return result;
}

function cleanUpStep(
  document: ChemDrawDocument,
  step: ChemDrawReactionStep,
  settings: DocumentStyleSettings,
  newId: () => string,
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
  const captionSize = settings.nativeMetrics.captionSize;
  const gap = GAP_OF_CAPTION * captionSize;
  const textOffset = TEXT_OFFSET_OF_CAPTION * captionSize;
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

  // Reactants: right to left from the tail, a `+` in each gap between them.
  const plusWidth = PLUS_WIDTH_OF_SIZE * captionSize;
  const reactants = inOrder(step.reactants).reverse();
  const plusLefts: number[] = [];
  let edge = -gap;
  reactants.forEach(({ id, box }, index) => {
    doc = moveBy(doc, id, edge - box.s1, -(box.t0 + box.t1) / 2);
    edge -= box.s1 - box.s0;
    if (index < reactants.length - 1) {
      edge -= gap;
      edge -= plusWidth;
      plusLefts.push(edge);
      edge -= gap;
    }
  });
  if (plusLefts.length > 0) {
    const isPlus = (object: ChemDrawObject): object is ChemDrawText =>
      object.type === 'text' &&
      object.text.runs
        .map((run) => run.text)
        .join('')
        .trim() === '+' &&
      (() => {
        const rel = { x: object.anchor.x - arrow.tail.x, y: object.anchor.y - arrow.tail.y };
        const s = rel.x * u.x + rel.y * u.y;
        const t = rel.x * up.x + rel.y * up.y;
        return Math.abs(t) < 3 * gap && s < 0 && s > -(1 + plusLefts.length) * 6 * gap - 400;
      })();
    const existing = doc.pages[0]!.objects.filter(isPlus).sort((a, b) => b.anchor.x - a.anchor.x);
    const spots = plusLefts.map((left) => {
      const s = left - PLUS_LEFT_OF_ANCHOR * captionSize;
      const t = -PLUS_BASELINE_BELOW_LINE * captionSize;
      return {
        x: arrow.tail.x + u.x * s + up.x * t,
        y: arrow.tail.y + u.y * s + up.y * t,
      };
    });
    const created: ChemDrawText[] = [];
    spots.forEach((spot, index) => {
      const found = existing[index];
      if (found) {
        doc = moveSelectedObjects(
          doc,
          new Set([found.id]),
          spot.x - found.anchor.x,
          spot.y - found.anchor.y,
        );
      } else {
        created.push({
          id: newId(),
          type: 'text',
          anchor: spot,
          text: { runs: [{ text: '+' }], justification: 'left' },
          style: {
            fontFamily: settings.nativeMetrics.captionFontFamily,
            fontSize: captionSize,
          },
        });
      }
    });
    if (created.length > 0) {
      doc = {
        ...doc,
        pages: [
          { ...doc.pages[0]!, objects: [...doc.pages[0]!.objects, ...created] },
          ...doc.pages.slice(1),
        ],
      };
    }
  }
  // Products: left to right from the head.
  edge = arrowLength + gap;
  for (const { id, box } of inOrder(step.products)) {
    doc = moveBy(doc, id, edge - box.s0, -(box.t0 + box.t1) / 2);
    edge += box.s1 - box.s0 + gap;
  }
  // Above and below: stacked outward from the arrow, centred on its middle.
  const middle = arrowLength / 2;
  let level = textOffset;
  for (const { id, box } of inOrder(step.aboveArrow)) {
    doc = moveBy(doc, id, middle - (box.s0 + box.s1) / 2, level - box.t0);
    level += box.t1 - box.t0 + gap / 4;
  }
  level = -textOffset;
  for (const { id, box } of inOrder(step.belowArrow)) {
    doc = moveBy(doc, id, middle - (box.s0 + box.s1) / 2, level - box.t1);
    level -= box.t1 - box.t0 + gap / 4;
  }
  return doc;
}
