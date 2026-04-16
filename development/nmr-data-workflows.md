# NMR Data Workflows

The NMR features in ChemEditor rely on two separate data products:

- a HOSE lookup database generated from NMRShiftDB2
- optional DFT reference shieldings used by the sidecar's DFT NMR path

Most contributors do not need to rebuild either by hand. The normal build and sidecar sync
scripts already manage the common path.

## What Is Automatic

These commands handle the normal sidecar preparation flow:

```bash
pnpm sync:sidecar
pnpm build
pnpm tauri:build
```

That flow can:

- sync the Python environment with `uv`
- build or reuse the packaged sidecar
- ensure the HOSE database exists
- stage `xtb`
- optionally generate `nmr_refs.json`

Use the manual scripts below only when you are working directly on the NMR data pipeline.

## Source Data And Outputs

| Input / output     | Path                                                   | Notes                                                                 |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Source SDF         | `development/nmr_model/data/nmrshiftdb2withsignals.sd` | Large NMRShiftDB2 source file used to build the HOSE lookup database. |
| Generated HOSE DB  | `src-tauri/bin/nmr_hose_db.sqlite`                     | SQLite lookup database used by the Python sidecar.                    |
| Generated DFT refs | `src-tauri/bin/nmr_refs.json`                          | Precomputed TMS reference shieldings for DFT NMR.                     |

## Rebuilding The HOSE Database

Use this when:

- the source SDF changed
- you changed HOSE database generation logic
- you want to verify database generation independently of the full sidecar build

### Preferred path

```bash
pnpm sync:sidecar
```

### Manual path

```bash
uv run --project src-tauri python development/build_nmr_hose_db.py
```

Optional arguments:

```bash
uv run --project src-tauri python development/build_nmr_hose_db.py \
  --input development/nmr_model/data/nmrshiftdb2withsignals.sd \
  --output src-tauri/bin/nmr_hose_db.sqlite
```

The script imports `nmr_hose.py` from `src-tauri/bin/` through
[`src_tauri_path.py`](./src_tauri_path.py), so run it from the repo root unless you are passing
fully explicit paths.

## Precomputing DFT Reference Shieldings

Use this when:

- the DFT NMR functional or basis assumptions changed
- the `xtb` geometry protocol changed
- you want an exact local `nmr_refs.json` instead of using the bundled fallback values

Manual command:

```bash
uv run --project src-tauri python development/precompute_nmr_refs.py
```

What it does:

1. builds a TMS geometry with RDKit
2. refines it with `xtb` when available
3. runs PySCF DFT NMR calculations
4. writes `src-tauri/bin/nmr_refs.json`

The script is designed to be non-fatal for builds. If PySCF NMR support is unavailable, it exits
with a warning and the sidecar keeps using fallback reference constants.

## Useful Environment Variables

| Variable                                | Effect                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CHEM_EDITOR_ENABLE_DFT_NMR=0`          | Skip the heavier DFT NMR dependency path for a lighter sidecar build.                        |
| `CHEM_EDITOR_PRECOMPUTE_NMR_REFS=1`     | Generate `nmr_refs.json` during the build instead of relying on bundled fallback references. |
| `CHEM_EDITOR_XTB_ROOT=/path/to/install` | Point the sidecar build at a local `xtb` installation when auto-detection misses it.         |
| `CHEM_EDITOR_SIDECAR_CLEAN=1`           | Force a clean sidecar rebuild instead of reusing cached artifacts.                           |

## Suggested Maintenance Workflow

### When changing HOSE rules or lookup logic

```bash
pnpm sync:sidecar
pnpm test:py
pnpm build
```

### When changing DFT NMR reference logic

```bash
uv run --project src-tauri python development/precompute_nmr_refs.py
pnpm test:py
pnpm build
```

### When changing both data generation and packaging

```bash
CHEM_EDITOR_SIDECAR_CLEAN=1 pnpm sync:sidecar
pnpm test:py
pnpm test:rust
pnpm build
```

## Large File And Licensing Notes

- The source SDF in `development/nmr_model/data/` is large and should be treated as source data,
  not as something to casually duplicate around the repo.
- The generated SQLite database and `nmr_refs.json` are build outputs used by the sidecar.
- Keep hand-edits out of generated outputs whenever possible; prefer regenerating them from the
  source data and scripts.
