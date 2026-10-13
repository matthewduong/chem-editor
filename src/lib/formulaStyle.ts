import type { TextRun } from '../types/chemistry';

const SUBSCRIPT_DIGITS = /[0-9]/;
const SIGN = /[+\-−]/;
const ANCHOR = /[A-Za-z)\]]/;

/**
 * ChemDraw's "formula" face (CDXML `face="96"`, the default for atom labels) subscripts the
 * digits of a chemical formula as it draws, while the file keeps the plain text: `CO2Et` is stored
 * as one run and drawn CO₂Et, `Pd(PPh3)4` as Pd(PPh₃)₄, `NH4+` as NH₄⁺, `Mg2+` as Mg²⁺.
 *
 * Observed behaviour of ChemDraw 26.1.0.6801 (2026-10-13, labels `Et3N`, `Pd(PPh3)4`, `LiAlH4`,
 * `NaBH4`, `CO2Me`, `NH4+`, `SO42-`):
 *
 * - a digit run that follows a letter or a closing bracket is a subscript;
 * - digits at the start of the text, or after anything else, stay at the baseline (`2-Np`);
 * - a sign after a letter, digit or bracket is a superscript charge, and so is the digit run
 *   directly before it when it is the charge magnitude: the last digit of a run of two or more
 *   (`SO42-` is SO₄²⁻), or a lone digit after a single element symbol (`Mg2+`, `Ca2+`) but not
 *   after a polyatomic group (`NH4+` is NH₄⁺).
 */
export function expandFormulaText(text: string): Array<{ text: string; sub?: true; sup?: true }> {
  const out: Array<{ text: string; sub?: true; sup?: true }> = [];
  const push = (value: string, kind?: 'sub' | 'sup') => {
    if (!value) return;
    const last = out[out.length - 1];
    const same =
      last && (kind === 'sub' ? last.sub : kind === 'sup' ? last.sup : !last.sub && !last.sup);
    if (same) last.text += value;
    else
      out.push(
        kind === 'sub'
          ? { text: value, sub: true }
          : kind === 'sup'
            ? { text: value, sup: true }
            : { text: value },
      );
  };

  let i = 0;
  let afterFormulaDigit = false;
  while (i < text.length) {
    const c = text[i]!;
    if (SUBSCRIPT_DIGITS.test(c)) {
      let j = i;
      while (j < text.length && SUBSCRIPT_DIGITS.test(text[j]!)) j += 1;
      const digits = text.slice(i, j);
      const before = i > 0 ? text[i - 1]! : '';
      if (!ANCHOR.test(before)) {
        push(digits);
        afterFormulaDigit = false;
        i = j;
        continue;
      } else if (j < text.length && SIGN.test(text[j]!)) {
        // digits then a charge sign
        const head = text.slice(0, i);
        const singleElement =
          /(^|[^A-Za-z])[A-Z][a-z]?$/.test(head) && !/[A-Z][a-z]?[A-Za-z]*[0-9]/.test(head);
        if (digits.length >= 2) {
          push(digits.slice(0, -1), 'sub');
          push(digits.slice(-1), 'sup');
        } else if (singleElement) {
          push(digits, 'sup');
        } else {
          push(digits, 'sub');
        }
      } else {
        push(digits, 'sub');
      }
      afterFormulaDigit = true;
      i = j;
      continue;
    }
    if (
      SIGN.test(c) &&
      i > 0 &&
      (/[A-Za-z)\]]/.test(text[i - 1]!) || (afterFormulaDigit && /[0-9]/.test(text[i - 1]!)))
    ) {
      // a sign that ends a label or is followed by more charge text is a charge
      push(c, 'sup');
      i += 1;
      continue;
    }
    push(c);
    afterFormulaDigit = false;
    i += 1;
  }
  return out;
}

/** Splits runs carrying the formula flag into baseline, subscript and superscript segments. */
export function expandFormulaRuns(runs: TextRun[]): TextRun[] {
  if (!runs.some((run) => run.formula && !run.sub && !run.sup)) return runs;
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!run.formula || run.sub || run.sup) {
      out.push(run);
      continue;
    }
    const { formula: _formula, ...rest } = run;
    void _formula;
    for (const piece of expandFormulaText(run.text)) {
      out.push({
        ...rest,
        text: piece.text,
        ...(piece.sub ? { sub: true } : {}),
        ...(piece.sup ? { sup: true } : {}),
      });
    }
  }
  return out;
}

const HAS_UNICODE_SUBSCRIPT = /[\u2080-\u2089]/;

/**
 * Turns the Unicode subscript digits of a generated label (`H\u2082`) into subscript runs of the
 * ASCII digit, so a generated label is set exactly as a typed formula is: at the measured
 * subscript size and drop rather than at whatever the font draws a subscript glyph at.
 */
export function expandUnicodeSubscripts(runs: TextRun[]): TextRun[] {
  if (!runs.some((run) => HAS_UNICODE_SUBSCRIPT.test(run.text))) return runs;
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!HAS_UNICODE_SUBSCRIPT.test(run.text) || run.sub || run.sup) {
      out.push(run);
      continue;
    }
    let last = 0;
    for (const match of run.text.matchAll(/[\u2080-\u2089]+/g)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ ...run, text: run.text.slice(last, index) });
      const digits = [...match[0]].map((c) => String(c.charCodeAt(0) - 0x2080)).join('');
      out.push({ ...run, text: digits, sub: true });
      last = index + match[0].length;
    }
    if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) });
  }
  return out;
}
