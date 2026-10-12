# Known gaps

Status as of 2026-10-12. "Measured" means a test pins it; "observed" means seen by hand.

## CDXML import/export

| Gap                                                                              | Status                  | Notes                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `<group>` containers are flattened on export                                     | measured (warning only) | `groups` exist only in the flat editing state; needs a `group` in `ChemDrawDocument`            |
| `<polygon>` is written as a bare element, which real ChemDraw silently drops on open | confirmed against real ChemDraw, 2026-10-12 | DTD has no `<polygon>`/`GraphicType="Polygon"`; closed shapes are `<curve Closed="yes" CurvePoints="...">`. ChemDraw doesn't error or convert it — the shape is just gone from the resave. Fixture: `graphics.cdxml`. See `development/mac-verification-2026-10.md` step 4. |
| Pages after the first are preserved but not editable or rendered                 | measured; real ChemDraw's AppleScript `open` only loads page one, confirmed 2026-10-12 | `metadata.preservedExtraPages`; dropped if their IDs would collide. Unknown whether ChemDraw's own UI "Insert New Page" uses a different on-disk shape — not probed (needs `sdef`, unavailable without Xcode). |
| Node/bond IDs are renumbered                                                     | by design               | now avoids IDs kept by other objects; raw cross-references into renumbered IDs may still dangle |
| Labels from implicit hydrogens are written as explicit `<t>`                     | observed                | ChemDraw computes these itself                                                                  |
| `<graphic GraphicType="Line">` does not round-trip through real ChemDraw          | confirmed against real ChemDraw, 2026-10-12 | ChemDraw rewrites it to an `<arrow>` with no head plus a dead `SupersededBy` stub, growing on every resave. `GraphicType="Oval"` round-trips fine. Not yet fixed in the writer. |
| `validateCdxmlInput` rejects a real ChemDraw file over per-bracket `<objecttag>` id reuse | **bug, found 2026-10-12** | `<objecttag>` children of a `GraphicType="Bracket"`/`BracketUsage="MultipleGroup"` graphic legitimately reuse `id="1"`/`id="2"` per bracket; the validator treats the whole page as one ID namespace. Real corpus file: `rychnovsky_himeradine.cdxml`. See `development/mac-verification-2026-10.md` step 1. |

## Rendering

| Gap                                                             | Status   | Notes                                                                   |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Three renderers (scene, legacy SVG, Konva overlays)             | known    | `sceneSvgExport.ts` + `scene-svg-parity.test.mjs` is the migration path |
| Legacy SVG export clips and under-measures text                 | measured | `text-boxes.cdxml`; scene export is sized from ink                      |
| Orbital types other than s/p draw nothing in the scene          | measured | `orbitals.cdxml` golden                                                 |
| Bond object tags are not drawn by the scene                     | measured | `object-tags.cdxml`                                                     |
| Transparent export has no label knockout mask in the scene path | open     | bonds are clipped by geometry instead; unverified against ChemDraw      |

## Chemistry interchange

| Gap                         | Status                                             | Notes                                   |
| --------------------------- | -------------------------------------------------- | --------------------------------------- |
| Isotope/radical in molfiles | fixed 2026-10-12                                   | `tests/molblock-properties.test.mjs`    |
| V3000 reading               | fixed 2026-10-12 (atoms, bonds, CHG/MASS/RAD, CFG) | no V3000 writer; no SGroups/collections |
| Clipboard buffer is flat    | open                                               | drops native objects (audit item 5)     |

## Robustness

| Gap                                                                 | Status | Notes                                                                                             |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| No timeout on one-shot sidecar calls                                | open   | `run_bundled_engine` in `src-tauri/src/lib.rs`; the right limit for QM jobs is a product decision |
| Sidecar protocol has no version handshake; errors are plain strings | open   |                                                                                                   |
| No fuzz/property tests beyond the deterministic damage corpus       | open   |                                                                                                   |
| `expect` in non-test Rust (`lib.rs`)                                | open   | two remain; clippy does not deny them                                                             |

## Process

| Gap                                                                            | Status | Notes                                                |
| ------------------------------------------------------------------------------ | ------ | ---------------------------------------------------- |
| Rust CI runs on Linux only; the sidecar and packaged app are never built in CI | open   |                                                      |
| Two authoritative document models and two undo stacks                          | open   | `src/store/index.ts`; ~76 `pushToHistory` call sites |
| No headless CLI / agent control surface                                        | open   | `src/editor/commands` is the natural base            |
| No asset ledger (RDKit, font metrics, HOSE DB, ring templates)                 | open   |                                                      |
