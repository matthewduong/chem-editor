# Ketcher chemistry audit

2026-10-12. ChemEditor at the commit that adds this file; Ketcher at
`dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9` (Apache-2.0, EPAM Systems). Follows
`docs/ketcher-review.md`, which compared architecture; this compares the chemistry and drawing
knowledge itself and records what was taken, what was not, and why.

Oracles. Chemistry (valence, SMILES validity) is checked against RDKit. Geometry and rendering
are ChemDraw's, and **no ChemDraw run was available for any of this work**, so every drawing
convention taken from Ketcher is marked unverified in `development/gaps.md` and should be
compared with `pnpm test:chemdraw:mac` before it is relied on. Ketcher is comparison material,
not a specification.

## Verdicts

| Area                                  | Verdict                        | What was done                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valence validation                    | **Ported**                     | `src/lib/chemistry/valence.ts`: isoelectronic charge rule, radicals, hypervalent states for row 3+. Used by diagnostics and by `getAtomFreeValence` for single-valence elements.                    | Sulfoxides, sulfones, phosphates, ClF3 were flagged invalid before. `tests/valence.test.mjs`.                                                                                                                                                                                                          |
| Drawn implicit-H counts               | **Kept**                       | `getAtomHydrogenCount` unchanged.                                                                                                                                                                   | It decides what is painted, so ChemDraw is the oracle and was unavailable. Open in gaps.md.                                                                                                                                                                                                            |
| New-atom direction                    | **Ported, unverified**         | `src/lib/newBondAngle.ts`: zigzag away from the neighbour's substituents; double/double, triple/triple and single/triple straight. Bond tool quick click and the keyboard wedge/hash shortcut only. | Repeated clicks used to curl into a hexagon (browser test fails without the change). Ring-tool placement is unchanged.                                                                                                                                                                                 |
| Largest-gap bisection (2+ neighbours) | **Kept**                       | Already equivalent.                                                                                                                                                                                 | Same rule in both.                                                                                                                                                                                                                                                                                     |
| Chain tool                            | **Kept**                       | Already equivalent (15 degree snap, 30 degree zigzag).                                                                                                                                              | `src/lib/chain.ts`.                                                                                                                                                                                                                                                                                    |
| Ring templates                        | **Ported with a quality gate** | 72 of 142 in-scope entries bundled, scaled to the document bond length.                                                                                                                             | Ketcher draws bicycles, indole, purine and C60/C80 with bond lengths up to 1.7x apart; a ratio gate of 1.15 excludes them rather than shipping distorted rings. They need a re-layout.                                                                                                                 |
| Salts and solvents                    | **Ported as templates**        | 126 of 135 bundled (water and single-ion salts have no bonds).                                                                                                                                      | These are whole named molecules, not label abbreviations.                                                                                                                                                                                                                                              |
| Functional-group labels               | **Ported, delta only**         | 13 explicit entries.                                                                                                                                                                                | Of 62: 33 already present, 25 resolved through the formula parser (11 wrongly: NCO as an amide, SO4/PO4 with four double bonds), 4 unresolved. RDKit parses all 13.                                                                                                                                    |
| Stereo validity                       | **Reimplemented, not ported**  | Two warnings in diagnostics: narrow end at an atom with no other bond; narrow end at a C/N with a double, triple or aromatic bond.                                                                  | Ketcher's `isCorrectStereoCenter` is a heuristic on `implicitH % 2` and neighbour counts. A verbatim port would not be an improvement. The test corpus has five wedges, all isolated two-atom bonds, so a false-positive rate on real molecules is **not measured**.                                   |
| Ring perception                       | **Kept; no module added**      | `computeRingCentroids` unchanged.                                                                                                                                                                   | Ketcher's `findLoops` is geometric face finding, not SSSR, and is not more general. Ours already returns the shortest cycle through each bond, which is what double-bond placement consumes. Lifting its 8-atom cap would change ring double-bond drawing, which cannot be justified without ChemDraw. |
| Double-bond side                      | **Kept**                       | Unchanged.                                                                                                                                                                                          | ChemDraw fixtures are the reference.                                                                                                                                                                                                                                                                   |
| Aromatize, CIP, layout                | **Not applicable**             | None.                                                                                                                                                                                               | Ketcher delegates these to Indigo; ChemEditor uses RDKit.                                                                                                                                                                                                                                              |

## Not taken, and why

- **Sugars, amino acids and 3D templates.** They carry wedge/hash stereo that the importer
  rejects. Importing them needs a stereo review, not a coordinate conversion.
- **Drag-to-fuse** (`closelyFusing`: merge at 10 degrees and 20% scale). Needs duplicate-bond,
  stereo and reference reconciliation and capability gating. Left for its own plan.
- **Ionised forms of oxo-acid labels as written by Ketcher.** SO3, SO4, PO2, PO3, PO4 are
  taken as Ketcher draws them (anionic). ChemDraw's reading of these labels was not checked.

## Performance findings made along the way

The benchmark added for the roadmap found two cubic and quadratic scans in rendering that were
unrelated to Ketcher and are fixed (see `development/gaps.md`): scene assembly 33 s at 800
atoms to 8 ms at 1,000, and paint 670-850 ms to 22 ms at 5,000. Pointer preview at 5,000 atoms
is still 320-420 ms.

## Verification still owed

1. `pnpm test:chemdraw:mac`: zigzag and straight-multiple-bond placement, ring and solvent
   template double-bond placement, and drawn H counts for S+/P+.
2. A real stereo-heavy document set for the new diagnostics.
3. The packaged-app run of template persistence.
