# Getting Started

This guide is the quickest path from a fresh machine to a working ChemEditor development setup.

For deeper workflow docs, see:

- [`README.md`](./README.md)
- [`chemdraw-fidelity.md`](./chemdraw-fidelity.md)
- [`nmr-data-workflows.md`](./nmr-data-workflows.md)

## What You Are Setting Up

ChemEditor is a Tauri desktop app with three active layers:

- React + TypeScript frontend in `src/`
- Rust backend in `src-tauri/src/`
- Python sidecar in `src-tauri/bin/`

The normal developer entry points are:

- `pnpm tauri:dev` for day-to-day app development
- `pnpm test:all` for the default automated suites
- `pnpm build` for the full packaged app

## Required Tooling

| Tool                | Why it is needed                              |
| ------------------- | --------------------------------------------- |
| Rust stable         | Tauri backend and packaging                   |
| Node.js 20+         | frontend build and dev tooling                |
| pnpm                | package manager and script entry point        |
| uv                  | Python environment management for the sidecar |
| Python 3.12 or 3.13 | Python sidecar runtime                        |

Optional but important depending on what you are touching:

| Tool                                      | When you need it                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| ChemDraw on macOS                         | real-app CDXML compatibility testing                                    |
| `xtb`                                     | sidecar workflows that need the local `xtb` binary, especially on macOS |
| `rsvg-convert`, `pdftoppm`, `magick`      | visual ChemDraw fidelity capture and diffing                            |
| LaTeX toolchain (`latexmk` or `pdflatex`) | rebuilding the engineering PDF                                          |

## Fast Path

Once the platform prerequisites below are installed:

```bash
git clone <repo-url>
cd chem-editor
pnpm install
pnpm sync:sidecar
pnpm install-hooks
pnpm tauri:dev
```

What those commands do:

- `pnpm install`
  installs the Node and frontend toolchain dependencies
- `pnpm sync:sidecar`
  prepares the Python sidecar environment, runtime assets, and generated data
- `pnpm install-hooks`
  installs the local git hook wrapper
- `pnpm tauri:dev`
  runs the full app in development mode

`pnpm tauri:dev` triggers `scripts/prepare-tauri-dev.mjs`, which:

1. builds or refreshes the sidecar
2. syncs the built sidecar into `src-tauri/target/debug/bin`
3. starts the Vite web dev server

## Platform Prerequisites

### macOS

Tested primarily on macOS 13+.

1. Install Xcode Command Line Tools:

```bash
xcode-select --install
```

2. Install Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

3. Install `uv` and Python:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.12
```

4. Install Node.js and pnpm, for example with Homebrew:

```bash
brew install node
npm install -g pnpm
```

5. Install `xtb` if you plan to use the local sidecar DFT path:

```bash
brew install xtb
```

If the build cannot auto-detect your install, set `CHEM_EDITOR_XTB_ROOT` to the installation root
that contains `bin/xtb` and `share/xtb`.

### Linux

Tested on current Ubuntu and Arch-style setups.

Install the platform dependencies for Tauri/WebKit, then install Rust, `uv`, Python, Node, and
pnpm.

Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  build-essential \
  curl \
  wget
```

Arch:

```bash
sudo pacman -S \
  base-devel \
  curl \
  wget \
  openssl \
  libsoup3 \
  gtk3 \
  webkit2gtk-4.1 \
  librsvg \
  libayatana-appindicator
```

Then:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.12
```

Install Node 20+ and pnpm using your preferred toolchain manager or distro packages.

### Windows

Tested on Windows 11 with the MSVC toolchain.

1. Install Visual Studio Build Tools with the Desktop development with C++ workload.
2. Ensure WebView2 is available.
3. Install Rust with the `x86_64-pc-windows-msvc` toolchain.
4. Install `uv` and Python 3.12.
5. Install Node.js 20+ and pnpm.

Typical PowerShell setup snippets:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv python install 3.12
npm install -g pnpm
```

On Windows, `xtb` can be staged automatically for supported builds. If Defender quarantines a
fresh sidecar build, add an exclusion for `src-tauri/bin/`.

## Day-To-Day Commands

| Command                          | When to use it                                                           |
| -------------------------------- | ------------------------------------------------------------------------ |
| `pnpm tauri:dev`                 | Normal app development.                                                  |
| `pnpm dev:web`                   | Frontend-only Vite preview without the Tauri shell.                      |
| `pnpm sync:sidecar`              | Refresh the Python sidecar environment and generated assets.             |
| `pnpm test:js`                   | Fast Node-based regression suite for pure logic and document/model code. |
| `pnpm test:js:ui`                | Vitest + jsdom + React Testing Library suite.                            |
| `pnpm test:py`                   | Python sidecar tests.                                                    |
| `pnpm test:rust`                 | Rust tests.                                                              |
| `pnpm test:all`                  | Default all-up test sweep.                                               |
| `pnpm test:chemdraw:mac`         | Local macOS ChemDraw smoke compatibility harness over a private corpus.  |
| `pnpm test:chemdraw:mac:private` | Full private-corpus ChemDraw sweep.                                      |
| `pnpm lint`                      | TypeScript, formatting, Python, and Rust lint checks.                    |
| `pnpm build`                     | Full production build and bundle.                                        |

## Sidecar And Build Notes

### What `pnpm sync:sidecar` handles

The sidecar build script in `src-tauri/build-sidecar.js` is the main orchestration point for:

- syncing the Python environment with `uv`
- building or reusing the PyInstaller sidecar bundle
- staging `xtb`
- ensuring the HOSE database exists
- optionally generating `nmr_refs.json`

In other words, most contributors should use `pnpm sync:sidecar` rather than calling the
development Python scripts directly.

### Useful Environment Variables

| Variable                            | Purpose                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `CHEM_EDITOR_XTB_ROOT`              | Explicitly points the build at an `xtb` installation root.                        |
| `CHEM_EDITOR_ENABLE_DFT_NMR=0`      | Skips the heavier DFT NMR dependency path.                                        |
| `CHEM_EDITOR_PRECOMPUTE_NMR_REFS=1` | Generates `nmr_refs.json` during sidecar prep.                                    |
| `CHEM_EDITOR_SIDECAR_CLEAN=1`       | Forces a clean sidecar rebuild.                                                   |
| `CHEM_EDITOR_BUNDLE_TARGETS=...`    | Overrides the default Tauri bundle targets for `pnpm tauri:build` / `pnpm build`. |

The internal `CHEM_EDITOR_SKIP_BEFORE_BUILD` variable is used by the build scripts themselves and
is not a normal developer-facing entry point.

### Bundle Targets

On macOS, `pnpm build` defaults to the `.app` bundle.

On other platforms, bundle behavior follows the Tauri configuration unless you override it:

```bash
CHEM_EDITOR_BUNDLE_TARGETS=appimage pnpm tauri:build
```

## ChemDraw Compatibility Prerequisites

If you want to run the real ChemDraw harness:

- install ChemDraw on macOS
- set `CHEMDRAW_CORPUS_ROOT` to a private local CDXML corpus
- read [`chemdraw-fidelity.md`](./chemdraw-fidelity.md) for harness env vars and artifact layout

The default harness mode is semantic-only and runs ChemDraw in the background. Visual capture and
diff enforcement are opt-in.

## Repo Structure At A Glance

```text
chem-editor/
├── src/                    React frontend
├── src-tauri/              Rust backend + Python sidecar packaging
├── tests/                  JS and UI regression tests
├── scripts/                Build, test, and harness orchestration
└── development/            Developer docs, fixtures, source data, helper scripts
```

Key files for common work:

- `src/components/ChemCanvas.tsx`
  main 2D editor shell
- `src/App.tsx`
  app-level menus, panels, layout, and orchestration
- `src/utils/cdxml.ts`
  CDXML import/export pipeline
- `src/lib/chemdrawModel.ts`
  typed ChemDraw document projection and editing helpers
- `src-tauri/src/lib.rs`
  Tauri command surface and sidecar invocation
- `src-tauri/bin/chem-engine.py`
  Python chemistry sidecar

## Recommended First-Day Validation

After setup, this is a good sanity pass:

```bash
pnpm test:js
pnpm test:js:ui
pnpm lint
pnpm build
```

If you also have ChemDraw installed locally:

```bash
CHEMDRAW_CORPUS_ROOT=/path/to/private/corpus pnpm test:chemdraw:mac
```
