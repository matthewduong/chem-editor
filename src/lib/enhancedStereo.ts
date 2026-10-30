import type { ChemDrawDocument, ChemDrawNode, ChemDrawObjectTag } from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';
import { convertNativeToCanvas } from './chemdrawMetrics';

export type EnhancedStereoType = 'Absolute' | 'And' | 'Or';

/**
 * Enhanced stereochemistry (ChemDraw 17.1 guide, "Enhanced Stereochemistry"): a stereocentre is
 * Absolute, or in a numbered AND or OR group. ChemDraw writes `EnhancedStereoType` and
 * `EnhancedStereoGroupNum` on the atom and shows the group as an `<objecttag
 * Name="enhancedstereo">` reading `abs`, `&1` or `or1`. Measured from ChemDraw's own files
 * (RDKit's ChemDraw test data): the tag is 7.5 pt, centred under the atom, its baseline 10.4 pt
 * below it.
 */
export const ENHANCED_STEREO_TAG = 'enhancedstereo';
const TAG_SIZE_PT = 7.5;
const TAG_BASELINE_PT = 10.4;

export function enhancedStereoLabel(stereo: NonNullable<ChemDrawNode['enhancedStereo']>): string {
  if (stereo.type === 'Absolute') return 'abs';
  return `${stereo.type === 'And' ? '&' : 'or'}${stereo.group ?? 1}`;
}

/**
 * Puts the selected atoms into one enhanced stereo group: Absolute, or a new AND or OR group
 * numbered one past the highest of its kind; `null` takes them out of any group.
 */
export function setEnhancedStereo(
  document: ChemDrawDocument,
  nodeIds: ReadonlySet<string>,
  type: EnhancedStereoType | null,
  settings: DocumentStyleSettings,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  const editable = (object: (typeof page.objects)[number]): object is ChemDrawNode =>
    object.type === 'node' &&
    nodeIds.has(object.id) &&
    object.preservation?.capability !== 'render-only';
  if (!page.objects.some(editable)) return document;
  const used = page.objects
    .filter((object): object is ChemDrawNode => object.type === 'node')
    .filter((node) => !nodeIds.has(node.id) && node.enhancedStereo?.type === type)
    .map((node) => node.enhancedStereo?.group ?? 0);
  const stereo: ChemDrawNode['enhancedStereo'] =
    type === null
      ? undefined
      : type === 'Absolute'
        ? { type }
        : { type, group: Math.max(0, ...used) + 1 };
  const objects = page.objects.map((object) => {
    if (!editable(object)) return object;
    const otherTags = (object.objectTags ?? []).filter((tag) => tag.name !== ENHANCED_STEREO_TAG);
    const tag: ChemDrawObjectTag | null = stereo
      ? {
          name: ENHANCED_STEREO_TAG,
          tagType: 'Unknown',
          text: { runs: [{ text: enhancedStereoLabel(stereo) }], justification: 'center' },
          textAnchor: {
            x: object.position.x,
            y: object.position.y + convertNativeToCanvas(TAG_BASELINE_PT, settings),
          },
          style: { fontFamily: settings.nativeMetrics.captionFontFamily, fontSize: TAG_SIZE_PT },
        }
      : null;
    const objectTags = tag ? [...otherTags, tag] : otherTags;
    const next: ChemDrawNode = { ...object, objectTags };
    if (stereo) next.enhancedStereo = stereo;
    else delete next.enhancedStereo;
    if (objectTags.length === 0) delete next.objectTags;
    return next;
  });
  return { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] };
}
