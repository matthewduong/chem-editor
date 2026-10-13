# ChemDraw implicit-hydrogen display

Measured 2026-10-13 on ChemDraw 26.1.0.6801 (macOS) with `createChemDrawSession`: one document per
element holding 27 fragments, each an unlabelled heteroatom (integer ids, `LabelSize` 10) bonded to
unlabelled carbons. ChemDraw generated the label itself; the hydrogen count is read from the `<s>`
runs of the `<t>` it saved, and agrees with the `NumHydrogens` attribute it wrote on all 315 labelled
atoms. Unlabelled carbon gets no label, so carbon is not tabulated.

Columns are the bonding: `0d+ns` is n single bonds, `1d+ns` one double bond plus n singles.

| element | charge | 0d+0s | 0d+1s | 0d+2s | 0d+3s | 0d+4s | 1d+0s | 1d+1s | 1d+2s | 1d+3s |
| ------- | ------ | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| N       | -1     | 2     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| N       | +0     | 3     | 2     | 1     | 0     | 0     | 1     | 0     | 0     | 0     |
| N       | +1     | 4     | 3     | 2     | 1     | 0     | 2     | 1     | 0     | 0     |
| O       | -1     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| O       | +0     | 2     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| O       | +1     | 3     | 2     | 1     | 0     | 0     | 1     | 0     | 0     | 0     |
| S       | -1     | 1     | 0     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| S       | +0     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| S       | +1     | 0     | 2     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| P       | -1     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| P       | +0     | 0     | 2     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| P       | +1     | 4     | 3     | 2     | 1     | 0     | 2     | 1     | 0     | 0     |
| B       | -1     | 4     | 3     | 2     | 1     | 0     | 2     | 1     | 0     | 0     |
| B       | +0     | 3     | 2     | 1     | 0     | 0     | 1     | 0     | 0     | 0     |
| B       | +1     | 0     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| Cl      | -1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| Cl      | +0     | 1     | 0     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| Cl      | +1     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| Br      | -1     | 0     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| Br      | +0     | 1     | 0     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| Br      | +1     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| I       | -1     | 0     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| I       | +0     | 1     | 0     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| I       | +1     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| F       | -1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| F       | +0     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| F       | +1     | 2     | 1     | 0     | 0     | 0     | 0     | 0     | 0     | 0     |
| Si      | -1     | 0     | 2     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| Si      | +0     | 4     | 3     | 2     | 1     | 0     | 2     | 1     | 0     | 0     |
| Si      | +1     | 3     | 2     | 1     | 0     | 0     | 1     | 0     | 0     | 0     |
| Se      | -1     | 1     | 0     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |
| Se      | +0     | 2     | 1     | 0     | 1     | 0     | 0     | 1     | 0     | 1     |
| Se      | +1     | 0     | 2     | 1     | 0     | 1     | 1     | 0     | 1     | 0     |

## What it follows

The count of the neutral element isoelectronic with the charged atom (N+ as C, S+ as P, Cl+ as S),
with the hypervalent ladder for row 3 and later (P and S and Cl reach 5, 6 and 7 valence, so an
S with a double bond and a single shows one H, as in `SH`). Hydrogens fill up to the smallest valence
not below the bond order sum, and none are shown above the top of the ladder. Implemented as
`chemDrawImplicitHydrogens` in `src/lib/chemistry/displayHydrogens.ts`; every row of the table is pinned
by `tests/chemdraw-implicit-hydrogens.test.mjs`.

Exceptions that are measurements, not consequences of the rule:

- An isolated atom (no bond) with five valence electrons in row 3 or later shows no hydrogen: P, Si-,
  S+, Se+. B+ also shows none.
- An isolated halide ion shows none.
- Br- shows one H on one bond and none on three or five. I- shows one on one, three or five. Cl- shows
  none on any. These are all that was measured for halide anions with bonds.

## Divergences from the previous rule

Before this change `getAtomHydrogenCount` took the element's single valence and adjusted charge for C,
N, O and B only. It disagreed with ChemDraw on 104 of the 315 displayed cases. Classes: every S, Se, P, Si, Cl, Br, I and F case with a charge; every
hypervalent neutral S/Se/P/Cl/Br/I with a double bond or three or more bonds (for instance neutral S with
three single bonds drew `S`, ChemDraw draws `SH`); B+ (drew `BH4+`); and isolated P.
