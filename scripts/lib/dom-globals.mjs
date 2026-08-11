import { JSDOM } from 'jsdom';

/**
 * Installs the XML DOM globals that `src/utils/cdxml.ts` needs to parse CDXML.
 *
 * `node --test` has no DOMParser, which silently skipped every CDXML import test. Load this
 * via `node --import` so the globals exist before any test module is evaluated.
 */
export function ensureDomParserGlobals() {
  if (typeof globalThis.DOMParser === 'function') return;
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
  globalThis.XMLSerializer = window.XMLSerializer;
}

ensureDomParserGlobals();
