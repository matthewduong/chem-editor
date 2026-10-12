/** CDXML has separate font/color tables; drawing IDs are document-wide. */
export function validateCdxmlInput(xml: Document): void {
  if (xml.querySelector('parsererror') || xml.documentElement?.tagName !== 'CDXML') {
    throw new Error('Invalid CDXML: expected a well-formed CDXML document.');
  }
  const objects = new Map<string, Element>();
  for (const element of Array.from(xml.querySelectorAll('[id]'))) {
    if (element.tagName === 'font' || element.tagName === 'color') continue;
    const id = element.getAttribute('id')!;
    if (!id.trim() || objects.has(id))
      throw new Error(`Invalid CDXML: duplicate or empty object ID ${id}.`);
    objects.set(id, element);
  }
  const geometry = new Set([
    'p',
    'BoundingBox',
    'Head3D',
    'Tail3D',
    'Center3D',
    'MajorAxisEnd3D',
    'MinorAxisEnd3D',
  ]);
  for (const element of Array.from(xml.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (!geometry.has(attribute.name)) continue;
      const values = attribute.value.trim().split(/\s+/);
      if (!values.length || values.some((value) => !value || !Number.isFinite(Number(value)))) {
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
