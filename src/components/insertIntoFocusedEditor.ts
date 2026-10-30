import { insertPlainTextIntoEditable } from '../lib/textRunPresentation';

/**
 * Types `text` into whichever text editor has focus: an atom label input (through the value
 * setter React listens to) or a caption's contentEditable. Returns false when no editor is open,
 * which is when ChemDraw's map is inactive too.
 */
export function insertIntoFocusedEditor(text: string): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    const next = `${active.value.slice(0, start)}${text}${active.value.slice(end)}`;
    const prototype = Object.getPrototypeOf(active) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(active, next);
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.setSelectionRange(start + text.length, start + text.length);
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    insertPlainTextIntoEditable(active, text);
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}
