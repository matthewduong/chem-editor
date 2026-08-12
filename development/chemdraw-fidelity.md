# ChemDraw Fidelity Workflow

This guide covers the real-ChemDraw macOS acceptance harness that round-trips a private local CDXML
corpus through the installed ChemDraw app.

## What The Harness Does

`pnpm test:chemdraw:mac` and `pnpm test:chemdraw:mac:private`:

1. load CDXML cases from the private local corpus
2. import them through ChemEditor's CDXML pipeline
3. export ChemEditor-authored CDXML
4. census the source and exported markup to see what the importer failed to carry over
5. open and re-save that output in the real ChemDraw app
6. re-import the ChemDraw output
7. compare compatibility summaries and, when enabled, visual artifacts

The harness uses a single long-lived background ChemDraw session per run. It does not relaunch the
app between passing cases, and it should not flash the desktop unless you explicitly opt in to
visible windows.

## Commands

```bash
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus pnpm test:chemdraw:mac
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus pnpm test:chemdraw:mac:private
```

- `pnpm test:chemdraw:mac`
  semantic-first smoke run over a small sorted subset of the configured private corpus
- `pnpm test:chemdraw:mac:private`
  recursive sweep of every `*.cdxml` file under the configured private corpus root

Set `CHEMDRAW_SMOKE_MANIFEST` if you want to drive smoke mode from your own private manifest
instead of the default first-`N` file selection.

By default both commands are semantic-first. Visual capture is opt-in and only becomes gating when
you explicitly enable it.

## Prerequisites

Required:

- macOS
- `osascript`
- an installed ChemDraw app addressable as `com.revvity.ChemDraw`
- a private CDXML corpus exposed via `CHEMDRAW_CORPUS_ROOT`
- `xmllint`

Additional tools for visual capture:

- `rsvg-convert`
- `pdftoppm`
- `magick`

Without the visual tools, the harness still runs semantic compatibility checks.

## Environment Variables

| Variable                             | Default                    | What it controls                                                                                      |
| ------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CHEMDRAW_CORPUS_ROOT`               | required                   | Root of the private local CDXML corpus.                                                               |
| `CHEMDRAW_THESIS_ROOT`               | legacy alias               | Backward-compatible alias for `CHEMDRAW_CORPUS_ROOT`.                                                 |
| `CHEMDRAW_SMOKE_MANIFEST`            | unset                      | Optional private manifest file for smoke mode.                                                        |
| `CHEMDRAW_SMOKE_LIMIT`               | `12`                       | Number of sorted corpus files used by smoke mode when no manifest is supplied.                        |
| `CHEMDRAW_APP_ID`                    | `com.revvity.ChemDraw`     | Bundle id used for AppleScript automation.                                                            |
| `CHEMDRAW_ARTIFACT_DIR`              | `.chemdraw-test-artifacts` | Root directory for failure and capture artifacts.                                                     |
| `CHEMDRAW_SHOW_WINDOWS=1`            | off                        | Makes the ChemDraw session visible for debugging.                                                     |
| `CHEMDRAW_CAPTURE_VISUAL_BASELINE=1` | off                        | Captures ChemDraw PDF/raster artifacts and ChemEditor renders without enforcing the visual threshold. |
| `CHEMDRAW_ENFORCE_VISUAL_DIFF=1`     | off                        | Enables visual diff failure mode on the configured enforced smoke subset.                             |
| `CHEMDRAW_ENFORCED_VISUAL_CASES`     | unset                      | Comma-separated relative paths to enforce when visual diffing is enabled.                             |
| `CHEMDRAW_VISUAL_DIFF_THRESHOLD`     | `0.0025`                   | Maximum allowed visual diff ratio when visual enforcement is active.                                  |

## Semantic vs Visual Modes

### Default Mode

The default smoke/full commands are semantic-first:

- XML must parse
- imported/exported ChemEditor summaries must stay stable
- ChemDraw must open and re-save the file cleanly
- compatibility fingerprint drift is treated as a failure

This is the mode to use for routine local work because it is fast and stable.

### Visual Capture

The comparison is **our drawing of the source file against ChemDraw's drawing of the same source
file**. Both sides render the original: ChemEditor from its import of it, ChemDraw by opening it
directly. Neither goes through our CDXML writer.

That matters. Taking the reference from our own exported CDXML instead would fold our writer's
mistakes into the reference — a construct we export wrongly would then be drawn wrongly by both
sides, and the comparison would pass. The round-trip through ChemDraw is still exercised, but by
the semantic check, which is the part that question belongs to.

Both renders are cropped to their drawing before they are compared. ChemDraw prints onto its own
paper while ChemEditor renders the authored page box, so the two do not share a page origin and
comparing them as laid out would measure that offset rather than the drawing. The trimmed sizes are
kept in the metrics so a size mismatch still reads as a scale problem rather than a drawing one.

When `CHEMDRAW_CAPTURE_VISUAL_BASELINE=1` is set, the harness additionally captures:

- `chem-editor-render.svg`
- `chem-editor-render.png`
- `chemdraw-render.pdf`
- `chemdraw-render.png`
- `overlay.png`
- `diff.png`

This mode is useful when chasing visual fidelity regressions but you do not want visual thresholds
to fail the run yet.

### Visual Enforcement

When `CHEMDRAW_ENFORCE_VISUAL_DIFF=1` is set, the harness also fails when the configured enforced
subset exceeds the visual diff threshold.

## Artifact Layout

Artifacts are written under:

```text
.chemdraw-test-artifacts/<run-id>/<case-id>/
```

Typical contents include:

- original corpus source
- ChemEditor-authored intermediate CDXML
- ChemDraw-resaved CDXML
- `before-summary.json`
- `after-summary.json`
- `diff.txt`
- `import-fidelity.json`
- `session.json`
- `fidelity-result.json`
- optional visual artifacts when visual capture is enabled

Case directories are written for passing cases too, not only failures: import fidelity is
report-only, so a run where every case passes is exactly the run whose data matters most.

`<run-id>/run-summary.json` aggregates the whole run — pass/fail counts, cases ranked by visual
diff, and how many cases each dropped construct affects. Read that first; the per-case directories
are for drilling into one failure.

## Import Fidelity

`import-fidelity.json` records what our own CDXML fails to carry over from the source file, as a
census of elements and attributes on both sides.

This exists because the before/after comparison cannot see import loss. Both of its summaries are
built from documents that already went through the importer, so a construct the importer drops is
missing from both sides and reads as agreement. Counting the markup itself is what makes "we never
read this" visible.

It is **report-only** — it never fails a case. `dropped` is the actionable half; `added` is
reported too because the writer emits ChemEditor-private attributes by design.

## What Gates And What Does Not

The before/after comparison asks one question: does ChemDraw round-trip **our output** stably? It
fails a case on any change to modelled content — object counts, node elements, bond kinds, arrow
kinds, text, container counts.

`preservedPageChildren` is recorded in the summary but excluded from that check. Preserved children
are raw XML we carry through without modelling, and ChemDraw rebuilds derived reaction metadata
from structure when it opens a file: a source with 3 `<scheme>` elements and 8 `<step>` children,
exported element for element, comes back as 6 and 9. That is ChemDraw normalising its own
bookkeeping, not our output drifting, and it is the same reasoning that already keeps
`<chemicalproperty>` out of our export.

Modelling schemes and steps as real objects — rather than preserving them verbatim — is what would
let this gate. Until then the counts stay visible in `diff.txt` and `before/after-summary.json`.

## Recommended Debugging Loop

1. Reproduce with `pnpm test:chemdraw:mac` first.
2. Inspect the case artifact directory under `.chemdraw-test-artifacts/`.
3. Compare:
   - `before-summary.json`
   - `after-summary.json`
   - `diff.txt`
4. If the failure looks visual rather than semantic, rerun with:

```bash
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus CHEMDRAW_CAPTURE_VISUAL_BASELINE=1 pnpm test:chemdraw:mac
```

5. Only use `CHEMDRAW_SHOW_WINDOWS=1` when you need to watch ChemDraw itself.

## How This Relates To The App

- ChemEditor's normal document view defaults to enhanced atom colors for readability.
- The fidelity harness forces `documentViewSettings.atomColorViewMode = 'chemdraw-fidelity'`
  when it renders ChemEditor-side comparison artifacts.
- CDXML export ignores display sugar entirely and always serializes authored ChemDraw semantics.

## Public Fixture Policy

The public repo intentionally does not ship `.cdxml` fixtures or thesis-derived case lists.

Use:

- inline or generated CDXML in automated tests for public regression coverage
- private local scratch files when you need a manual ChemDraw repro
- a private local corpus when you need broader realism or real-app fidelity checks
