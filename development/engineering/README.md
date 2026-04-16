# Engineering Guide

This directory contains the long-form architecture guide for ChemEditor:

- [`engineering.tex`](./engineering.tex)
- [`Makefile`](./Makefile)

Use it when you want the conceptual overview of how the Tauri, React, Rust, Python, and ChemDraw
pieces fit together. For current setup commands and operational workflows, start with:

- [`../README.md`](../README.md)
- [`../getting-started.md`](../getting-started.md)

## Build The PDF

From the repo root:

```bash
make -C development/engineering
```

Or from this directory:

```bash
make
```

The build prefers `latexmk` when available and falls back to two `pdflatex` passes.

## Clean Generated Files

```bash
make clean
```

## Editing Notes

- Treat the LaTeX guide as the deep architectural reference, not the source of truth for build
  commands.
- Keep operational setup, testing, and fidelity instructions in the Markdown docs under
  `development/`.
- If a workflow changes, update the Markdown docs first, then adjust the long-form guide if the
  conceptual explanation also needs to move.
