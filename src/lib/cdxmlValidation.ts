/**
 * Whether `element` is an `<objecttag>` belonging to a `<graphic GraphicType="Bracket">`.
 *
 * ChemDraw gives these their own per-bracket id namespace: a document with several multiplied-
 * group brackets (each carrying a hidden "parameterizedBracketLabel"/"bracketusage" objecttag
 * pair showing the repeat count) legitimately reuses `id="1"`/`id="2"` once per bracket. Nothing
 * else in a real document references these ids, so excluding them from the page-wide uniqueness
 * check costs nothing. Measured against a real ChemDraw file.
 */
function isBracketObjectTag(element: Element): boolean {
  if (element.tagName !== 'objecttag') return false;
  const parent = element.parentElement;
  return parent?.tagName === 'graphic' && parent.getAttribute('GraphicType') === 'Bracket';
}

const NUMERIC_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const NON_FINITE_TOKEN = /^[+-]?(NaN|Infinity)$/i;

/**
 * True when `value` is made only of numbers (it is a numeric attribute or a list of them) and at
 * least one is NaN, Infinity or overflows to Infinity. Free text such as a name is never numeric
 * in this sense, so only genuinely numeric attributes are affected.
 */
function hasNonFiniteNumber(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === '') return false;
  let nonFinite = false;
  for (const token of tokens) {
    if (NON_FINITE_TOKEN.test(token)) nonFinite = true;
    else if (NUMERIC_TOKEN.test(token)) {
      if (!Number.isFinite(Number(token))) nonFinite = true;
    } else return false;
  }
  return nonFinite;
}

/** CDXML has separate font/color tables; drawing IDs are document-wide. */
export function validateCdxmlInput(xml: Document): void {
  if (xml.querySelector('parsererror') || xml.documentElement?.tagName !== 'CDXML') {
    throw new Error('Invalid CDXML: expected a well-formed CDXML document.');
  }
  const objects = new Map<string, Element>();
  for (const element of Array.from(xml.querySelectorAll('[id]'))) {
    if (element.tagName === 'font' || element.tagName === 'color') continue;
    if (isBracketObjectTag(element)) continue;
    const id = element.getAttribute('id')!;
    if (!id.trim() || objects.has(id))
      throw new Error(`Invalid CDXML: duplicate or empty object ID ${id}.`);
    objects.set(id, element);
  }
  // Attribute name -> allowed value counts. A value with the wrong arity is as unusable as a
  // non-numeric one: the importer would read the missing coordinates as NaN.
  const geometry = new Map<string, number[]>([
    ['p', [2, 3]],
    ['BoundingBox', [4]],
    ['BoundsInParent', [4]],
    ['Head3D', [3]],
    ['Tail3D', [3]],
    ['Center3D', [3]],
    ['MajorAxisEnd3D', [3]],
    ['MinorAxisEnd3D', [3]],
  ]);
  for (const element of Array.from(xml.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const arity = geometry.get(attribute.name);
      if (!arity) {
        if (hasNonFiniteNumber(attribute.value)) {
          throw new Error(
            `Invalid CDXML: ${element.tagName} ${attribute.name} contains a non-finite number.`,
          );
        }
        continue;
      }
      const values = attribute.value.trim().split(/\s+/);
      if (
        !arity.includes(values.length) ||
        values.some((value) => !value || !Number.isFinite(Number(value)))
      ) {
        throw new Error(
          `Invalid CDXML: ${element.tagName} ${attribute.name} contains invalid coordinates.`,
        );
      }
    }
    if (element.tagName === 'b') {
      for (const key of ['B', 'E']) {
        const reference = element.getAttribute(key);
        if (!reference || objects.get(reference)?.tagName !== 'n') {
          throw new Error(
            `Invalid CDXML: bond ${element.getAttribute('id')} references missing node ${reference}.`,
          );
        }
      }
    }
    const bracketed = element.getAttribute('BracketedObjectIDs');
    if (bracketed) {
      for (const reference of bracketed.trim().split(/\s+/)) {
        if (!objects.has(reference))
          throw new Error(`Invalid CDXML: missing bracketed object ${reference}.`);
      }
    }
  }
}

/**
 * Throw if any number reachable from `value` is NaN or infinite, naming the path to it. Walks
 * plain objects and arrays only, which is all the document model contains.
 */
export function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid CDXML: non-finite number at ${path}.`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) assertFiniteNumbers(item, `${path}.${key}`);
}
