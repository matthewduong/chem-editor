#!/usr/bin/env node
// Converts the ring/fragment groups of Ketcher's template library (Apache-2.0, EPAM Systems)
// into normalized geometry: mean bond length 1, y down, centred on the centroid. The runtime
// (src/lib/builtinTemplates.ts) scales it to the document's bond length, so no absolute pixel
// size is baked in.
//
//   node scripts/import-ketcher-templates.mjs [--out file.ts] <library.sdf> [salts-and-solvents.sdf ...]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
let out = 'src/lib/builtinTemplates.data.ts';
const outAt = args.indexOf('--out');
if (outAt >= 0) [out] = args.splice(outAt, 2).slice(1);
const sources = args;
if (!sources.length) {
  console.error('usage: import-ketcher-templates.mjs [--out file.ts] <library.sdf> [more.sdf ...]');
  process.exit(2);
}
// Sugars, amino acids and 3D templates carry stereo and need their own review.
const GROUPS = new Set([
  'Rings',
  'Aromatics',
  'Heterocyclic Rings',
  'Bicycles',
  'Bridged Polycyclics',
  'Crown Ethers',
  'Nucleobases',
  'Salts and Solvents',
]);
// Ketcher draws some rings and bridged systems with uneven bond lengths (indole 0.93-1.62 of
// the mean, C60 0.27). ChemDraw fidelity wins: only geometry whose longest bond is within
// 15% of its shortest is imported; the rest are listed so they can be re-laid-out later.
const MAX_SPREAD = 1.15;
const round = (v) => Math.round(v * 1e4) / 1e4;
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const skipped = [];
const templates = [];
const seen = new Map();
const names = new Set();
const blocks = sources.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split(/^\$\$\$\$\s*$/m)
    .map((block) => block.replace(/^\s+/, ''))
    .filter((block) => block.trim()),
);
for (const block of blocks) {
  const lines = block.split('\n');
  const name = lines[0]?.trim();
  if (!name) continue;
  const fields = {};
  const props = block.split('M  END')[1] ?? '';
  for (const m of props.matchAll(/>\s+<(\w+)>\n([^\n]*)/g)) fields[m[1]] = m[2].trim();
  const group = fields.group;
  if (!GROUPS.has(group)) continue;
  const [nAtoms, nBonds] = [Number(lines[3].slice(0, 3)), Number(lines[3].slice(3, 6))];
  if (!Number.isInteger(nAtoms) || !Number.isInteger(nBonds) || lines[3].includes('V3000')) {
    skipped.push([name, 'unparsable counts']);
    continue;
  }
  const atoms = lines.slice(4, 4 + nAtoms).map((l) => ({
    x: Number(l.slice(0, 10)),
    y: Number(l.slice(10, 20)),
    element: l.slice(31, 34).trim(),
    charge: 0,
  }));
  const bonds = lines.slice(4 + nAtoms, 4 + nAtoms + nBonds).map((l) => ({
    a: Number(l.slice(0, 3)) - 1,
    b: Number(l.slice(3, 6)) - 1,
    order: Number(l.slice(6, 9)),
    stereo: Number(l.slice(9, 12)),
  }));
  for (const l of lines.slice(4 + nAtoms + nBonds)) {
    if (!l.startsWith('M  CHG')) continue;
    const parts = l.trim().split(/\s+/).slice(3);
    for (let i = 0; i + 1 < parts.length; i += 2)
      atoms[Number(parts[i]) - 1].charge = Number(parts[i + 1]);
  }
  const bad =
    atoms.some((a) => !a.element || ![a.x, a.y].every(Number.isFinite)) ||
    bonds.some((b) => ![1, 2, 3].includes(b.order) || b.stereo !== 0 || !atoms[b.a] || !atoms[b.b]);
  if (bad || nAtoms === 0 || nBonds === 0) {
    skipped.push([name, 'unsupported bond type, stereo or element']);
    continue;
  }
  const meanBond =
    bonds.reduce(
      (s, b) => s + Math.hypot(atoms[b.a].x - atoms[b.b].x, atoms[b.a].y - atoms[b.b].y),
      0,
    ) / bonds.length;
  const lengths = bonds.map((b) =>
    Math.hypot(atoms[b.a].x - atoms[b.b].x, atoms[b.a].y - atoms[b.b].y),
  );
  const spread = Math.max(...lengths) / Math.min(...lengths);
  if (!(spread <= MAX_SPREAD)) {
    skipped.push([name, `uneven bond lengths (spread ${spread.toFixed(2)})`]);
    continue;
  }
  const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
  const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
  const attachAtom = fields.atomid === undefined ? undefined : Number(fields.atomid);
  const attachBond = fields.bondid === undefined ? undefined : Number(fields.bondid);
  // A solvent that is also a ring (benzene, pyridine) is already listed under its ring group.
  if (names.has(name.toLowerCase())) {
    skipped.push([name, 'duplicate of an earlier template']);
    continue;
  }
  names.add(name.toLowerCase());
  const base = `${slug(group)}:${slug(name)}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  templates.push({
    id: n === 1 ? base : `${base}-${n}`,
    name,
    group,
    attachAtom: Number.isInteger(attachAtom) && atoms[attachAtom] ? attachAtom : null,
    attachBond: Number.isInteger(attachBond) && bonds[attachBond] ? attachBond : null,
    atoms: atoms.map((a) => ({
      element: a.element,
      x: round((a.x - cx) / meanBond),
      y: round(-(a.y - cy) / meanBond),
      ...(a.charge ? { charge: a.charge } : {}),
    })),
    bonds: bonds.map((b) => ({ a: b.a, b: b.b, order: b.order })),
  });
}
const header = `// GENERATED by scripts/import-ketcher-templates.mjs from Ketcher's library.sdf
// (Apache-2.0, Copyright EPAM Systems; see NOTICE). Do not edit by hand.
import type { BuiltinTemplateSource } from './builtinTemplates';

// prettier-ignore
export const BUILTIN_TEMPLATE_DATA: BuiltinTemplateSource[] = `;
writeFileSync(out, `${header}${JSON.stringify(templates)};\n`);
console.log(`wrote ${templates.length} templates to ${out}`);
for (const [name, why] of skipped) console.log(`skipped ${name}: ${why}`);
