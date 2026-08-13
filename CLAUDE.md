# chem-editor

A cross-platform ChemDraw replacement. **CDXML compatibility and rendering fidelity with real
ChemDraw are the project's defining goals** — when a change trades fidelity for convenience,
fidelity wins.

Stack: Tauri 2 (Rust shell) + React 19 + Konva + Zustand, RDKit-wasm for chemistry, Three.js for
the 3D viewer, and a PyInstaller Python sidecar (PySCF + xtb) for QM, NMR, IR and MS.

## Commands

```bash
pnpm dev              # Tauri desktop app (builds the Python sidecar first)
pnpm dev:web          # browser-only, no sidecar
pnpm lint             # typecheck + eslint + prettier + ruff + clippy
pnpm test             # every suite: js, ui, python, rust
pnpm test:js          # node --test over tsc-compiled tests/*.test.mjs
pnpm test:js:ui       # vitest + jsdom over tests/ui/
pnpm clean            # build artifacts;  pnpm clean:deep  also drops src-tauri/target
```

## Architecture

Rendering is the part most likely to surprise you.

- `src/editor/scene/` is the **live renderer**: an immediate-mode Canvas2D pipeline.
  `renderDocumentScene.ts` walks the document in object order and dispatches to a per-type module
  in `modules/`. `DocumentRenderSurface.tsx` is the canvas it paints onto, sitting _under_ the
  Konva `<Stage>`.
- `src/components/ChemCanvas.tsx` still contains a second, Konva-based set of `renderX` functions.
  They are dead for committed content (`useNativeSceneSurface` is hardcoded `true`) and survive
  only as drag/selection preview overlays.
- `src/lib/svgExport.ts` no longer draws anything. Both entry points assemble a scene and call
  `renderDocumentScene` with `SvgCanvasContext` (`src/lib/svgCanvasContext.ts`), a
  CanvasRenderingContext2D-shaped object that emits markup. Screen, PNG and SVG come from one set
  of draw calls.

So **a change to how an object is drawn belongs in that object's scene module, and lands
everywhere at once.** The remaining duplication is the Konva preview code in `ChemCanvas.tsx`;
folding that in is the last step of the consolidation.

Two things guard the draw path. `scripts/lib/recording-canvas.mjs` records the ops a scene emits
and throws on any context member it does not model, so a module reaching for something new fails
the suite rather than silently diverging in SVG. `tests/fixtures/goldens/ops/` pins the op stream
per fixture — **a golden that moves means rendering changed, and the diff should say how.**

Document model:

- `ChemDrawDocument` (`src/types/chemdraw.ts`) mirrors the CDXML object tree and carries
  round-trip preservation metadata.
- `CanvasState` (flat `atoms`/`bonds`/`arrows`/`groups`/`textBoxes`) is the legacy editing model.
- **Both are currently authoritative** in `src/store/index.ts`, with two parallel undo stacks kept
  index-aligned. Unifying onto the document is planned work. Note that `groups` exist only in the
  flat arrays, which is why `<group>` does not serialize yet.

`src/utils/cdxml.ts` is the CDXML reader/writer. It preserves unknown attributes and children via
`ChemDrawPreservationMetadata` and gates edits with an `editable`/`round-trip-only`/`render-only`
capability tri-state. **Extend that mechanism rather than routing around it** — it is what keeps
files authored in real ChemDraw from degrading on a round trip.

CDXML conventions are a recurring source of silent infidelity, because a wrong reading is
invisible until compared against ChemDraw itself. None of these were discoverable by reading the
format:

- an absent `Justification` means Left, not Center
- colour indices 0 and 1 are the reserved black and white, not absent colours
- `<t BoundingBox>` measures laid-out text; `LineStarts` is where the breaks are recorded
- `LineStarts` offsets are **UTF-8 bytes**, so any caption containing `°`, a subscript or Greek
  breaks in the wrong place if they are read as characters
- `p` on a `<t>` is the first line's baseline, and on an atom label sits 0.529 cap heights below
  the atom
- an arrow is an arc only when it carries `AngularSize`, not merely the axis attributes ChemDraw
  writes on every arrow
- a bracket's lip is a fraction of its own height, not the `LipSize` value in points

**When a convention is in doubt, measure it rather than assume it** — and prefer asking ChemDraw
directly over mining the corpus, which confounds what you are measuring with everything else on the
page. `development/chemdraw-fidelity.md` describes both, and the traps in driving ChemDraw.

## Testing

Two JS suites exist because of a DOM split:

- `tests/*.test.mjs` run under `node --test` against `.unit-test-dist/`, compiled by
  `tsconfig.unit.json`, which whitelists only DOM-free modules. `scripts/lib/dom-globals.mjs` is
  `--import`ed to provide `DOMParser`/`XMLSerializer` for the CDXML tests.
- `tests/ui/` run under vitest + jsdom for anything needing React or Konva.

Anything DOM-free belongs in the first suite. If you add a module there, add it to
`tsconfig.unit.json`'s `include` list.

`pnpm test:chemdraw:mac` is the real-ChemDraw acceptance harness. It needs macOS, an installed
ChemDraw, and a private corpus via `CHEMDRAW_CORPUS_ROOT`. See
`development/chemdraw-fidelity.md`.

## Conventions

- The ACS Document 1996 stylesheet is the default; its constants live in `src/lib/chemdrawMetrics.ts`.
  Prefer deriving geometry from those metrics over absolute pixel constants — hardcoded px floors
  break at non-default bond lengths.
- `pnpm install` runs `scripts/copy-rdkit.mjs`, which stages the RDKit wasm into `public/rdkit/`.
  That directory is generated; do not commit it.
- Never hand-copy sidecar binaries into `src-tauri/bin/`. Use `pnpm sync:sidecar`.
