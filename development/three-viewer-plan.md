# Three.js Viewer Status And Roadmap

ChemEditor now uses a custom Three.js-based small-molecule viewer throughout the app. The previous
NGL path is no longer the production renderer.

This file is the short operational status note for the viewer stack. The deeper architecture and
setup context live in:

- [`getting-started.md`](./getting-started.md)
- [`engineering/engineering.tex`](./engineering/engineering.tex)

## Current Production Stack

The viewer path is split across a small number of focused modules:

- `src/lib/viewer3d.ts`
  shared viewer math such as fit distance, bounds, topology checks, conformer alignment, and
  background defaults
- `src/hooks/useMolecule3DData.ts`
  conformer fetching, caching, topology validation, and pre-alignment before display
- `src/components/Molecule3DThree.tsx`
  low-level Three.js scene setup, camera controls, lighting, measurement interaction, and image
  export
- `src/components/Molecule3DThreePanel.tsx`
  panel shell, representation controls, conformer browser, and viewer-level UI orchestration

## What Works Well Today

- ball-and-stick, licorice, spacefill, and shell-style surface representations
- theme-aware background handling and explicit background color export behavior
- high-resolution PNG export
- conformer-to-conformer alignment so orientation stays stable while browsing
- atom and bond highlighting
- distance, angle, and dihedral measurements
- a testable shared math layer in `src/lib/viewer3d.ts`

## Current Constraints

- `surface` is still a shell-style approximation, not a true computed SES or SAS molecular surface
- large molecules can still stress the per-object mesh strategy more than an instanced approach
- measurement overlays optimize for readability in-app, not publication-grade layout parity
- volumetric and orbital rendering still sit adjacent to the viewer instead of being fully unified
  under one artifact-quality rendering contract

## Testing Situation

Current coverage is strongest in the shared math/data layer and weaker in the interactive renderer
itself.

Well covered:

- fit-distance math
- visual bounds calculations
- topology matching
- conformer alignment behavior
- 3D data hooks

Lighter coverage:

- direct interaction testing inside the Three.js canvas
- screenshot or visual regression coverage for representation changes
- measurement overlay parity and screenshot fidelity

## Next Work Worth Doing

1. Replace the current shell-style surface mode with a real computed molecular surface.
2. Move larger structures toward instanced rendering where that materially improves performance.
3. Add visual regression coverage for representation changes, backgrounds, and measurement overlays.
4. Continue consolidating orbital and volumetric rendering onto the same scene and export pipeline.

## Explicit Non-Goals

- reintroducing a second viewer engine
- expanding into biomolecular or protein-viewer workflows that need a fundamentally different stack
- treating the current viewer as a generic visualization framework outside the needs of ChemEditor
