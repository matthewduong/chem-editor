# NMR Model Data

This directory contains the source data used to build ChemEditor's local HOSE lookup database.

## Contents

| Path                             | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `data/nmrshiftdb2withsignals.sd` | Large NMRShiftDB2 source SDF used to build `src-tauri/bin/nmr_hose_db.sqlite`. |

`data/` is gitignored and starts empty on a fresh clone. You do not normally need to populate it
by hand: `src-tauri/build-sidecar.js` downloads the SDF from SourceForge on demand when the HOSE
database is missing, which `pnpm sync:sidecar` triggers.

## What This Directory Is For

- keeping the heavyweight source dataset out of `src-tauri/bin/`
- making the HOSE database reproducible from a known input file
- giving development scripts a stable place to find the source data

## What This Directory Is Not For

- generated SQLite databases
- sidecar runtime artifacts
- hand-edited prediction results

Generated outputs belong in `src-tauri/bin/`.

## Rebuild The Database

From the repo root:

```bash
uv run --project src-tauri python development/build_nmr_hose_db.py
```

See [`../nmr-data-workflows.md`](../nmr-data-workflows.md) for the full workflow and the cases
where `pnpm sync:sidecar` is the better entry point.
