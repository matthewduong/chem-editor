# Ketcher chemistry audit

2026-10-12. ChemEditor at the commit that adds this file; Ketcher at
`dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9` (Apache-2.0, EPAM Systems). Follows
`docs/ketcher-review.md`, which compared architecture; this compares the chemistry and drawing
knowledge itself and records what was taken, what was not, and why.

Oracles. Chemistry (valence, SMILES validity) is checked against RDKit. Geometry and rendering
are ChemDraw's. **No ChemDraw run was available when this was written (2026-10-12);** the
conventions taken from Ketcher were then measured on a licensed machine on 2026-10-13, and the
verdict column below says which held. Ketcher is comparison material, not a specification.

## Verdicts

| Area                                  | Verdict                                          | What was done                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valence validation                    | **Ported**                                       | `src/lib/chemistry/valence.ts`: isoelectronic charge rule, radicals, hypervalent states for row 3+. Used by diagnostics and by `getAtomFreeValence` for single-valence elements.                    | Sulfoxides, sulfones, phosphates, ClF3 were flagged invalid before. `tests/valence.test.mjs`.                                                                                                                                                                                                                                                               |
| Drawn implicit-H counts               | **Contradicted by ChemDraw; replaced**           | `chemDrawImplicitHydrogens` (`src/lib/chemistry/displayHydrogens.ts`) now decides the count for B, Si, N, P, O, S, Se, F, Cl, Br, I at charge -1 to +1.                                             | Probed 324 cases in ChemDraw 26.1.0.6801 (2026-10-13). The single-valence rule disagreed on 104 of 315 displayed ones. `development/chemdraw-implicit-hydrogens.md`.                                                                                                                                                                                        |
| New-atom direction                    | **Ported, confirmed by ChemDraw**                | `src/lib/newBondAngle.ts`: zigzag away from the neighbour's substituents; double/double, triple/triple and single/triple straight. Bond tool quick click and the keyboard wedge/hash shortcut only. | Clicking a chain end in ChemDraw 26.1.0.6801 gave zigzag 30/-30, straight double after double, straight triple after single and triple (2026-10-13). Pinned in `tests/new-bond-angle.test.mjs`. Repeated clicks used to curl into a hexagon (browser test fails without the change).                                                                        |
| Largest-gap bisection (2+ neighbours) | **Kept**                                         | Already equivalent.                                                                                                                                                                                 | Same rule in both.                                                                                                                                                                                                                                                                                                                                          |
| Chain tool                            | **Kept**                                         | Already equivalent (15 degree snap, 30 degree zigzag).                                                                                                                                              | `src/lib/chain.ts`.                                                                                                                                                                                                                                                                                                                                         |
| Ring templates                        | **Ported with a quality gate**                   | 72 of 142 in-scope entries bundled, scaled to the document bond length.                                                                                                                             | Ketcher draws bicycles, indole, purine and C60/C80 with bond lengths up to 1.7x apart; a ratio gate of 1.15 excludes them rather than shipping distorted rings. They need a re-layout.                                                                                                                                                                      |
| Salts and solvents                    | **Ported as templates**                          | 126 of 135 bundled (water and single-ion salts have no bonds).                                                                                                                                      | These are whole named molecules, not label abbreviations.                                                                                                                                                                                                                                                                                                   |
| Functional-group labels               | **Ported, then partly contradicted by ChemDraw** | 13 explicit entries; 7 (SO3, SO4H, SO4, PO2, PO3, PO4H2, PO4) changed to ChemDraw's expansion.                                                                                                      | ChemDraw reads these labels literally from the first atom and infers no charge: SO4H and PO4H2 attach through S/P with an O-O bond, SO3/SO4/PO2/PO3/PO4 are neutral oxyl radicals. Ketcher's ionised, O-attached forms were wrong for ChemDraw. NCO, NCS, SO2H, PO3H2, Cy, C2H5 agreed. `tests/shorthand-oxo.test.mjs`.                                     |
| Stereo validity                       | **Reimplemented; measured and narrowed**         | Two warnings in diagnostics, now run before the unsupported-component skip, and a terminal narrow end is not reported when the wide end is a metal centre.                                          | Over 121 real ChemDraw documents (912 wedges) the rules never ran as first written (every component skipped); un-skipped they flag 4: 3 reversed hashes at OH, 1 narrow end on an sp2 carbon. Three cobalt-complex perspective wedges were false positives and are exempt. Ketcher's `isCorrectStereoCenter` is a heuristic on `implicitH % 2`, not ported. |
| Ring perception                       | **Kept; cap lifted for double bonds**            | `computeRingCentroids` keeps the shortest-cycle search; double bonds are no longer capped at 8 atoms.                                                                                               | ChemDraw drew 9 of 9 (18-annulene) and 6 of 7 (14-annulene) double bonds inside. Ketcher's `findLoops` is geometric face finding, not SSSR, and is not more general.                                                                                                                                                                                        |
| Double-bond side                      | **Contradicted by ChemDraw; replaced**           | A fusion double bond now takes ChemDraw's ring: more double bonds, then more conjugated ones, then the ring left of the bond direction.                                                             | Measured on 196 bicyclic skeletons, 142 of 142 and 52 of 54 follow it; moved the fusion bond of indene, pyrene, quinoline, isoquinoline and 18-annulene. `tests/double-bond-ring-choice.test.mjs`.                                                                                                                                                          |
| Aromatize, CIP, layout                | **Not applicable**                               | None.                                                                                                                                                                                               | Ketcher delegates these to Indigo; ChemEditor uses RDKit.                                                                                                                                                                                                                                                                                                   |

## Not taken, and why

- **Sugars, amino acids and 3D templates.** They carry wedge/hash stereo that the importer
  rejects. Importing them needs a stereo review, not a coordinate conversion.
- **Drag-to-fuse** (`closelyFusing`: merge at 10 degrees and 20% scale). Needs duplicate-bond,
  stereo and reference reconciliation and capability gating. Left for its own plan.
- **Ketcher's ionised oxo-acid forms.** Taken at first, then replaced: ChemDraw does not infer charges
  from SO3, SO4, PO2, PO3 or PO4 (see Functional-group labels).

## Performance findings made along the way

The benchmark added for the roadmap found two cubic and quadratic scans in rendering that were
unrelated to Ketcher and are fixed (see `development/gaps.md`): scene assembly 33 s at 800
atoms to 8 ms at 1,000, and paint 670-850 ms to 22 ms at 5,000. Pointer preview at 5,000 atoms
is still 320-420 ms.

## Shorthand coverage

See `development/gaps.md`, "Shorthand acronyms, compounds and isolated atoms". Ketcher's 13 functional
group entries were one input; the audit that followed measured 518 labels against ChemDraw.

## Verification still owed

Measured on ChemDraw 26.1.0.6801, 2026-10-13: zigzag and straight multiple-bond placement
(confirmed), ring and solvent template double-bond placement (fusion side contradicted and
fixed; 179 of 198 templates match line for line), drawn H counts (contradicted and replaced),
functional-group labels (7 of 13 contradicted), stereo diagnostics on 912 real wedges.

Still owed:

1. The keyboard wedge/hash and Escape paths of the new-atom direction. ChemDraw's own were not
   driven.
2. Label layout of generated labels: ring NH stacks its H below the N in ChemDraw (15 templates
   8pt taller), Cl and charged-ion labels anchor differently (14 templates).
3. Whether ChemDraw reads a wedge whose narrow end is on a terminal OH as stereo. The 4 flagged
   cases were only located, not interpreted in ChemDraw.
4. Label expansion when the label sits left of its attachment.
5. The packaged-app run (tauri-driver is not installed and has no macOS driver) and Rust
   clippy (needs the PyInstaller sidecar in `src-tauri/bin`).
