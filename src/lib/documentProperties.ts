import type { ChemDrawDocument } from '../types/chemdraw';

/**
 * File > Document Properties (ChemDraw 17.1 guide, "Document Properties"): the document's own
 * metadata, which CDXML keeps as attributes of `<CDXML>` (DTD): Name, Comment and
 * CreationUserName are edited here; CreationProgram, CreationDate and the Modification* set are
 * shown as the file has them. They live with the document's other preserved root attributes.
 */
export const EDITABLE_DOCUMENT_PROPERTIES = ['Name', 'Comment', 'CreationUserName'] as const;
export const READ_ONLY_DOCUMENT_PROPERTIES = [
  'CreationProgram',
  'CreationDate',
  'ModificationProgram',
  'ModificationDate',
  'ModificationUserName',
] as const;

export type EditableDocumentProperty = (typeof EDITABLE_DOCUMENT_PROPERTIES)[number];

export function readDocumentProperties(document: ChemDrawDocument | null): Record<string, string> {
  const attributes = document?.metadata?.preservedDocumentAttributes ?? {};
  const properties: Record<string, string> = {};
  for (const name of [...EDITABLE_DOCUMENT_PROPERTIES, ...READ_ONLY_DOCUMENT_PROPERTIES]) {
    if (attributes[name] != null) properties[name] = attributes[name]!;
  }
  return properties;
}

/** Sets the editable properties; an empty value removes the attribute. */
export function setDocumentProperties(
  document: ChemDrawDocument,
  patch: Partial<Record<EditableDocumentProperty, string>>,
): ChemDrawDocument {
  const attributes = { ...document.metadata?.preservedDocumentAttributes };
  let changed = false;
  for (const [name, value] of Object.entries(patch)) {
    if (!(EDITABLE_DOCUMENT_PROPERTIES as readonly string[]).includes(name)) continue;
    const next = value?.trim() ?? '';
    if ((attributes[name] ?? '') === next) continue;
    changed = true;
    if (next) attributes[name] = next;
    else delete attributes[name];
  }
  if (!changed) return document;
  return {
    ...document,
    metadata: { ...document.metadata, preservedDocumentAttributes: attributes },
  };
}

/** The document background (CDXML `bgcolor`); null returns it to the default white. */
export function setDocumentBackground(
  document: ChemDrawDocument,
  color: string | null,
): ChemDrawDocument {
  const current = document.metadata?.backgroundColor ?? null;
  const next =
    color && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== '#ffffff'
      ? color.toLowerCase()
      : null;
  if (current === next) return document;
  const metadata = { ...document.metadata };
  if (next) metadata.backgroundColor = next;
  else delete metadata.backgroundColor;
  return { ...document, metadata };
}
