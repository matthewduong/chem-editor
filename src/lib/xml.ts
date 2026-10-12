import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

export type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

export function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

export function parentElement(node: Node): Element | null {
  return node.parentNode?.nodeType === 1 ? (node.parentNode as Element) : null;
}

export function firstByTag(
  node: Document | Element | null | undefined,
  tag: string,
): Element | null {
  return node?.getElementsByTagName(tag).item(0) ?? null;
}

export function allElements(node: Document | Element): Element[] {
  return Array.from(node.getElementsByTagName('*'));
}

/** A single strict parser for Node, browsers, and workers. No global DOM is required. */
export function parseXml(source: string): Document {
  try {
    // CDXML's external DOCTYPE is normal, but custom entity declarations are not needed.
    if (/<!ENTITY\b/i.test(source)) throw new Error('custom XML entities are unsupported');
    const document = new DOMParser({
      onError: (_level, message) => {
        throw new Error(message);
      },
    }).parseFromString(source, 'application/xml');
    if (!document.documentElement) throw new Error('the document has no root element');
    return document;
  } catch (error) {
    throw new Error(
      `Invalid CDXML: expected well-formed XML (${error instanceof Error ? error.message : String(error)}).`,
      { cause: error },
    );
  }
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node, { requireWellFormed: true });
}
