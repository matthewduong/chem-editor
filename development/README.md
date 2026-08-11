# Development Docs

This directory holds the human-facing engineering notes, large source data, and one-off developer
scripts that support ChemEditor development.

If you are new to the repo, start here and then follow the topic guides below.

## Start Here

1. [Getting Started](./getting-started.md)
   Set up the toolchain, run the app, and learn the day-to-day commands.
2. [ChemDraw Fidelity](./chemdraw-fidelity.md)
   Understand the real-ChemDraw compatibility harness, private-corpus workflow, and artifact output.
3. [NMR Data Workflows](./nmr-data-workflows.md)
   Rebuild the HOSE database, precompute DFT reference data, and understand what the sidecar builds automatically.
4. [Three.js Viewer Status](./three-viewer-plan.md)
   See the current 3D viewer architecture, strengths, and active limitations.
5. [Engineering Guide](./engineering/README.md)
   Build and navigate the long-form LaTeX architecture guide.

## Directory Map

| Path                                                 | What it is                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`getting-started.md`](./getting-started.md)         | Current setup, build, test, and release-prep guide.                              |
| [`chemdraw-fidelity.md`](./chemdraw-fidelity.md)     | Real-ChemDraw macOS compatibility workflow and artifact/debugging guide.         |
| [`nmr-data-workflows.md`](./nmr-data-workflows.md)   | NMR-side data generation and maintenance notes.                                  |
| [`three-viewer-plan.md`](./three-viewer-plan.md)     | Current state and roadmap for the custom Three.js viewer stack.                  |
| [`engineering/`](./engineering/)                     | Long-form architectural guide in LaTeX plus a small build wrapper.               |
| [`nmr_model/`](./nmr_model/)                         | Large source data used to build the local HOSE lookup database.                  |
| [`build_nmr_hose_db.py`](./build_nmr_hose_db.py)     | Generates `src-tauri/bin/nmr_hose_db.sqlite` from the NMRShiftDB2 SDF.           |
| [`precompute_nmr_refs.py`](./precompute_nmr_refs.py) | Computes TMS DFT reference shieldings and writes `src-tauri/bin/nmr_refs.json`.  |
| [`src_tauri_path.py`](./src_tauri_path.py)           | Small helper that lets development scripts import modules from `src-tauri/bin/`. |

## Common Workflows

### New Machine

```bash
pnpm install
pnpm sync:sidecar
pnpm install-hooks
pnpm tauri:dev
```

Then read:

- [Getting Started](./getting-started.md) for platform-specific prerequisites
- [ChemDraw Fidelity](./chemdraw-fidelity.md) if you also want local ChemDraw acceptance tests

### Daily Development

```bash
pnpm tauri:dev
pnpm test:js
pnpm test:js:ui
pnpm lint
```

Use `pnpm test:all` before bigger merges or releases. It runs the default JS, UI, Python, and Rust suites.

### ChemDraw Compatibility

```bash
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus pnpm test:chemdraw:mac
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus pnpm test:chemdraw:mac:private
```

Those commands are local-only and require:

- macOS
- an installed copy of ChemDraw
- a private CDXML corpus exposed via `CHEMDRAW_CORPUS_ROOT`

The harness keeps one background ChemDraw session alive per run and writes failure artifacts to
`.chemdraw-test-artifacts/`.

The public repo intentionally does not ship `.cdxml` fixture files. Keep any manual ChemDraw
repros or private corpora outside git.

### NMR Data Maintenance

Most contributors do not need to run the scripts manually. `pnpm sync:sidecar`, `pnpm build`,
and `pnpm tauri:build` already take care of the normal sidecar preparation path.

When you do need manual control, start with [NMR Data Workflows](./nmr-data-workflows.md).

### Release-Oriented Build

```bash
pnpm lint
pnpm test:all
pnpm build
```

On macOS the default bundle target is the `.app`. On every other platform the default is
`--no-bundle`, producing a bare executable and no installer; `tauri.conf.json`'s
`bundle.targets` is not consulted unless `CHEM_EDITOR_BUNDLE_TARGETS` is set. See
[`getting-started.md`](./getting-started.md) for the exact invocations.

## What Is Current vs Historical

- The Markdown files in this directory are the current operational docs.
- The LaTeX guide in [`engineering/engineering.tex`](./engineering/engineering.tex) is the deeper
  conceptual architecture reference.
- Package scripts, test harnesses, and build scripts are the source of truth when documentation
  and behavior ever disagree.
