import type {
  ChemDrawDocument,
  ChemDrawReactionRole,
  ChemDrawReactionScheme,
  ChemDrawReactionStep,
} from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';
import { getObjectsBounds } from './chemdrawModel';

/**
 * Reaction roles (ChemDraw 17.1 guide, "Reaction Interpretation"): what each object is in a
 * step — a reactant, a product, or written above or below the arrow. The roles live in the
 * page's `<scheme>/<step>`, which is what ChemDraw reads.
 */
export type StepRole = 'reactants' | 'products' | 'aboveArrow' | 'belowArrow';

const FRAGMENT_ROLE: Record<StepRole, ChemDrawReactionRole> = {
  reactants: 'reactant',
  products: 'product',
  aboveArrow: 'agent',
  belowArrow: 'agent',
};

/** The objects a selection stands for in a step: whole structures, texts and drawings. */
export function reactionObjectIds(
  document: ChemDrawDocument,
  selectedIds: ReadonlySet<string>,
): string[] {
  const objects = document.pages[0]?.objects ?? [];
  const ids = new Set<string>();
  for (const object of objects) {
    if (object.type === 'fragment') {
      if (selectedIds.has(object.id) || object.nodeIds.some((id) => selectedIds.has(id))) {
        ids.add(object.id);
      }
    } else if (
      selectedIds.has(object.id) &&
      object.type !== 'node' &&
      object.type !== 'bond' &&
      object.type !== 'arrow'
    ) {
      ids.add(object.id);
    }
  }
  return [...ids];
}

/**
 * Gives the selection `role` in the step whose arrow is nearest it, or takes it out of every step
 * (`role` null). Without a scheme, one is made around the nearest reaction arrow; without an
 * arrow there is no step to put anything in, and the document is returned unchanged.
 */
export function assignReactionRole(
  document: ChemDrawDocument,
  selectedIds: ReadonlySet<string>,
  role: StepRole | null,
  settings: DocumentStyleSettings,
  newId: () => string,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  const ids = reactionObjectIds(document, selectedIds);
  if (ids.length === 0) return document;
  const idSet = new Set(ids);
  const strip = (step: ChemDrawReactionStep): ChemDrawReactionStep => ({
    ...step,
    reactants: step.reactants.filter((id) => !idSet.has(id)),
    products: step.products.filter((id) => !idSet.has(id)),
    aboveArrow: step.aboveArrow.filter((id) => !idSet.has(id)),
    belowArrow: step.belowArrow.filter((id) => !idSet.has(id)),
  });
  let schemes: ChemDrawReactionScheme[] = (page.schemes ?? []).map((scheme) => ({
    ...scheme,
    steps: scheme.steps.map(strip),
  }));

  if (role) {
    const bounds = getObjectsBounds(document, ids, settings);
    const center = bounds
      ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
      : null;
    const arrows = page.objects.filter(
      (object) => object.type === 'arrow' && !(object.headEnd === 'none' && !object.tailEnd),
    );
    const distanceTo = (arrowId: string) => {
      const arrow = page.objects.find((object) => object.id === arrowId);
      if (arrow?.type !== 'arrow' || !center) return Infinity;
      const mid = { x: (arrow.head.x + arrow.tail.x) / 2, y: (arrow.head.y + arrow.tail.y) / 2 };
      return Math.hypot(mid.x - center.x, mid.y - center.y);
    };
    const located = schemes
      .flatMap((scheme, schemeIndex) =>
        scheme.steps.map((step, stepIndex) => ({
          schemeIndex,
          stepIndex,
          distance: Math.min(...step.arrows.map(distanceTo)),
        })),
      )
      .sort((a, b) => a.distance - b.distance)[0];
    if (located) {
      schemes = schemes.map((scheme, schemeIndex) =>
        schemeIndex !== located.schemeIndex
          ? scheme
          : {
              ...scheme,
              steps: scheme.steps.map((step, stepIndex) =>
                stepIndex === located.stepIndex
                  ? { ...step, [role]: [...step[role], ...ids] }
                  : step,
              ),
            },
      );
    } else {
      const arrow = [...arrows].sort((a, b) => distanceTo(a.id) - distanceTo(b.id))[0];
      if (!arrow) return document;
      schemes = [
        ...schemes,
        {
          id: newId(),
          steps: [
            {
              id: newId(),
              reactants: [],
              products: [],
              arrows: [arrow.id],
              aboveArrow: [],
              belowArrow: [],
              [role]: ids,
            },
          ],
        },
      ];
    }
  }

  const objects = page.objects.map((object) => {
    if (object.type !== 'fragment' || !idSet.has(object.id)) return object;
    const next = { ...object };
    if (role) next.role = FRAGMENT_ROLE[role];
    else delete next.role;
    return next;
  });
  const nextPage = { ...page, objects, schemes };
  if (schemes.length === 0) delete (nextPage as { schemes?: unknown }).schemes;
  return { ...document, pages: [nextPage, ...document.pages.slice(1)] };
}
