# Document and packaged-app validation

The editor stores one ChemDrawDocument and a history of at most 50 document snapshots.
The atom/bond/arrow/text arrays are cached projections for tools and hit testing. Tool
geometry crosses the document boundary through a projection-edit command that retains
untouched source objects. Native document commands handle selections and transforms.
Previews have separate state and never enter history, recovery, save, SVG or PNG export.
The first page remains editable; additional imported pages remain opaque export data.

Canvas2D scene modules draw committed content and geometric previews. Konva provides
interaction targets and selection handles. ChemCanvas coordinates the canvas; text/style
panels, keyboard shortcuts, document I/O and chemistry helpers are separate modules.

CDXML uses @xmldom/xmldom in browsers, Node and workers. All parser diagnostics fail
explicitly. Custom entity declarations are rejected. A worker must announce readiness
before accepting a task. Only unavailable initialization permits a logged synchronous
fallback. Task errors, cancellation, unreadable replies and the 120-second timeout reject
and terminate the worker. Overlapping loads are aborted; a completion cannot replace a
document edited or replaced while parsing or confirmation was pending.

## Automated checks

- `pnpm typecheck`, `pnpm lint:js`, `pnpm test:js`, `pnpm test:js:ui`.
- `pnpm test:browser`: real Chromium module-worker load/save, malformed XML, abort and
  timeout. Set `CHROMIUM_PATH` to use a system Chromium; otherwise install Playwright's
  Chromium with `pnpm exec playwright install chromium`.
- `.github/workflows/packaged.yml` builds Linux x64 DEB, Windows x64 NSIS and macOS
  arm64 APP bundles on main/manual runs. It extracts or installs each outside the checkout.
- `node scripts/check-packaged-app.mjs /absolute/install/root` verifies the installed
  sidecar protocol, NMR JSON/SQLite data, xTB parameters and native dependencies
  (NumPy, PySCF/libcint and NMR modules on Linux/macOS, xTB version), ethanol properties and one MMFF
  conformer. It performs no SCF, DFT, HF optimization or xTB minimization.
- `node scripts/test-packaged-ui.mjs /absolute/app/executable` uses tauri-driver on
  Linux and Windows. It uses actual settings, file and clipboard IPC, normal recent-file
  opening, canvas editing, undo/redo, native save, native PNG/SVG export dialogs, close/new cancellation and crash-recovery restart.
  It seeds only a recent-file preference; it adds no application test bridge or mocked IPC.
  Run in an isolated user/VM: the test intentionally writes app preferences. Linux needs
  WebKitWebDriver, Xvfb and xdotool; Windows needs a matching msedgedriver.
- Release orbital commands never search the checkout or invoke workspace Python.
  PySCF 2.12.1 has no supported native Windows package: Windows reports HF/DFT as unavailable, while RDKit, HOSE NMR and xTB remain required. See [PySCF installation support](https://pyscf.org/user/install.html).
  Frozen sidecars never substitute a PATH xTB binary when the bundled binary is missing.
- The licensed ChemDraw harness fails an import-fidelity stage when unexplained elements
  or attributes disappear. Attribute comparisons retain their owning tag/context so a
  known derived group bounding box cannot excuse a lost text bounding box. Exceptions
  are explained in scripts/lib/chemdraw-harness.mjs and included in reports.

## Acceptance evidence still required

A workflow definition is not a passing packaged run. Preserve the workflow run URL,
commit, package SHA-256 and JSON reports when the platform jobs run. CI records SHA-256 hashes and archives the macOS APP with symlinks/permissions intact. Local browser and
unit tests do not establish installed WebKit/WebView2 behavior. No native platform run
or licensed ChemDraw run is implied by those checks.

macOS native UI acceptance remains manual because the open-source native Tauri driver
supports Linux/Windows. Use the exact APP artifact from the workflow, outside the
checkout, with no workspace Python on PATH. Record the checklist below alongside the
artifact. Also run the licensed ChemDraw smoke harness on that Mac; retain its report.

| Evidence                                                                   | Result  |
| -------------------------------------------------------------------------- | ------- |
| Commit, workflow URL, APP SHA-256                                          | Pending |
| macOS version, Apple Silicon model                                         | Pending |
| Installed resource/self-check JSON                                         | Pending |
| Open representative CDXML (groups, query, text, opaque object, extra page) | Pending |
| Edit ordinary atom/bond, arrow, text; unsupported edits refused            | Pending |
| Drag/rotate/scale preview, Escape and tool-switch cancellation             | Pending |
| Undo/redo and dirty state after returning to saved snapshot                | Pending |
| Native save/reopen; extra pages and unsupported content retained           | Pending |
| SVG/PNG exports exclude transient preview/selection                        | Pending |
| Close/new/open unsaved prompt, save cancellation, recovery restart         | Pending |
| Clipboard, window controls and platform appearance                         | Pending |
| Licensed ChemDraw harness report and import-fidelity gate                  | Pending |

Do not replace Pending with Pass without the artifact, report or recorded observation.

## Local implementation evidence (2026-10-12)

Baseline checkpoint: `8b8979c`. The implementation was checked with TypeScript, ESLint,
the production web build, 398 JS regressions, 149 UI regressions, and three real Chromium
checks (including pixel parity and committed PNG export during previews). Rust unit
tests and the Python unit suite also passed. The local dependency self-check loaded
NumPy, PySCF/libcint, NMR data and xTB without running a quantum calculation.

Packaged workflow jobs, native WebDriver flows and the licensed ChemDraw harness have
not been run in this Linux development session. Their acceptance evidence remains Pending.
