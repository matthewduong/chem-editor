# Feature todo

ChemDraw features chem-editor does not yet offer, taken from the ChemDraw 17.1 User Guide and
checked against the code on 2026-10-29. `gaps.md` tracks where existing behaviour diverges from
ChemDraw; this file tracks features that are missing. "Render-only" means the object is read,
drawn and written back from CDXML, but no tool creates or edits it.

Section references are to the 17.1 guide (chapter: section).

## Shape tools

Done in Phase I (2026-10-29): Drawing palette, Edit > Add Frame, Edit > Curve. Per-axis reshape
handles for boxes and arc end/curvature handles moved to Phase II with the other handles.

- [x] **Box, rounded rectangle, ellipse and circle tool** — render-only · 6: Objects, Drawing
      Elements
- [x] **Line and arc tools** — render-only; lines also fail to round-trip through ChemDraw
      (`gaps.md`) · 6: Objects, Lines / Arcs
- [x] **Brackets, braces and ‡ daggers** — brackets render-only; braces and daggers absent ·
      6: Objects, Brackets / Daggers
- [x] **Pen (Bezier) and freehand curves** — curves round-trip but cannot be drawn · 6: Objects,
      Pen Tools / Freehand Shapes

## Annotation objects

- [x] **Orbital tool, and every orbital type** — only s and p render today; d and single-lobe
      draw nothing (`gaps.md`) · 12: Chemical Annotations, Orbitals
- [x] **Circled charges and radical-cation/anion symbols** — circled charges render-only; radical
      ions only as separate charge + radical · 12: Chemical Annotations, Chemical Symbols
- [x] **Character map** — no special-character picker for captions and labels · 6: Atoms,
      Character Map

## Selection and arrange

Done in Phase II (2026-10-30), with ChemDraw's keys (preferences version 11).

- [x] **Lasso selection** — marquee only · 6: Selecting Objects, The Lasso Tool
- [x] **Flip / mirror horizontally and vertically** — absent · 6: Objects, Mirror Images
- [x] **Rotation about a movable centre** — always pivots on the selection centre · 6: Objects,
      Moving the Center of Rotation
- [x] **Z-order for every object, and centre on page** — bring-to-front/send-to-back covers bonds
      only; Center aligns items to each other, not the page · 6: Objects, Centering Objects; 5:
      Shortcuts (F2/F3)

## Editing aids

- [x] **Join structures** — dropping an atom on an atom does not merge; only ring/template
      placement fuses · 6: Objects, Joining Structures
- [x] **Typed chain length, and fixed-length/fixed-angle toggles** — chain length is drag-only;
      snapping is always on · 6: Chains, Specifying Chain Length; 6: Bonds, Fixed Bonds

## Bonds and labels

- [x] **Quadruple bond** — no bond order 4 · 6: Bonds, Quadruple Bonds
- [x] **Expand / contract nicknames on the canvas** — expansion exists only internally
      (`aliasGraphExpansion.ts`) · 6: Atoms, Expanding Nicknames; 10: Labels
- [x] **User-defined nicknames** — the shorthand library is fixed · 10: Defining Nicknames
- [x] **Isotope labels** — stored in molfile/CDXML, but no UI and not drawn · 17: Isotopes and
      Elements

## Reactions

- [x] **Clean Up Reaction** — Clean Up ignores arrows and reaction layout · 10: Drawing
      Reactions, Clean Up Reactions
- [x] **Reaction roles UI** — roles are guessed on import only and cannot be viewed or edited ·
      10: The Reaction Interpreter
- [x] **Arrows attached to objects** (ChemDraw's Connecting Arrows: arrow to arrow, Shift at an end or the middle) — arrows are free endpoints · 6: Arrows, Connecting Arrows
- [x] **Mass fragmentation tool** — absent · 10: Mass Fragmentation
- [x] **Insert analysis as a caption** — Properties panel has no insert action · 12: Structure
      Analysis

## Stereochemistry and numbering

- [x] **CIP R/S and E/Z labels on the canvas** — not computed; imported tags are drawn · 12:
      Stereochemistry, Stereochemistry Indicators
- [x] **Enhanced stereo flags (abs/AND/OR, chiral flag)** — CDXML done; V3000 collections and the molfile chiral flag wait for the V3000 writer (gaps.md) · 17:
      Stereochemical Flags
- [x] **2D atom numbering** — only in the 3D viewer, or tags imported from CDXML · 10: Atom
      Numbering
- [x] **Structure Perspective** — absent · 10: Structure Perspective

## Naming and analysis

- [x] **Struct>Name** — no naming code anywhere · 11: Struct>Name
- [x] **Name>Struct, including captions** — only a fixed acronym dictionary · 11: Name>Struct
- [x] **m/z and elemental analysis** — Properties shows formula, MW and exact mass only · 12:
      Structure Analysis

## Query structures

- [x] **Typed generic labels as queries** (R, R1, X, A, Q, M, Ar, Het) — imported
      `GenericNickname` renders; typed ones do not become queries (`gaps.md`) · 15: Generic Labels
- [x] **Atom and bond query property editing** — preserved from CDXML, edits blocked
      (`blocksSemanticEdit`) · 15: Atom Properties / Bond Properties
- [x] **R-groups with R-logic, and expanding generic structures** (R-logic read-only; gaps.md) — R-groups import as queries;
      no definition editing or enumeration · 15: Alternative Groups / Expand Generic Structures

## Page and printing

- [x] **Print preview and print scaling** — File > Print Preview, scale 25-400% · 3: Printing
- [x] **Print margins** — each page's drawing fitted inside the paper margins (Print Preview)
      · 3: Page Setup
- [x] **Multiple open documents** — File > New Window, one document per window · 2: Documents

## Document settings

- [x] **Full drawing settings UI** — bold width, margin width, hash spacing and bond spacing are
      stored (`nativeMetrics`) but not editable · 4: Document and Object Settings
- [x] **Caption line spacing and a Formula style control** — formula face renders on import
      only · 4: Formatting Captions, Specifying Line Spacing
- [x] **Document background colour** — was fixed by theme; now CDXML `bgcolor`, set in
      Document Properties · 4: Working with Color
- [x] **A saved colour palette** — native colour pickers only · 4: Working with Color

## View and document

- [x] **Zoom commands** — zoom in/out, actual size and a zoom readout; today wheel zoom and Fit
      to Screen only · 3: Viewing Drawings, Magnification
- [x] **Document properties** — no metadata dialog · 2: Documents, Document Properties
- [x] **Autosave to the open file** — only a recovery snapshot is written · 2: Autosave and
      Autorecovery
- [x] **Export border preference** — fixed 40-unit margin (`DEFAULT_EXPORT_PADDING`, now an export option) in `svgExport.ts` · 16:
      Graphics Export Border Preference

## Clipboard and export

- [x] **Copy As SMILES, InChI, InChIKey and molfile** — copy writes CDXML and PNG only · 16:
      The Clipboard, Text Line Notation
- [x] **JPEG export** — the PNG raster on its paper · 16: File Formats
- [x] **Direct PDF, EPS, EMF and TIFF export** — the export raster in each format, written
      without a library (`rasterExports.ts`) · 16: File Formats
- [x] **Drag out to other apps** — the Drag handle carries CDXML, SMILES and a PNG · 16:
      Transferring Objects
- [ ] **OLE embedding** — Windows COM server; not buildable in this stack (gaps.md) · 16:
      Embedding Objects
- [x] **CDXML file thumbnails on Linux** — freedesktop thumbnailer via the sidecar · 2:
      Previewing CDX and CDXML Files
- [ ] **CDX/CDXML thumbnails on macOS and Windows** — QuickLook / shell extensions are native
      plugins outside this stack (gaps.md) · 2: Previewing CDX and CDXML Files

## Considered, not now

Reviewed on 2026-10-29 and left off the list:

- Table tool; Info window; repeat last action/label; stoichiometry grid; compound
  autonumbering; atom-to-atom mapping; predicted physical properties (bp, mp, CLogP, CMR, logS,
  ΔHf); element and NOT-list UI; headers and footers; rulers and crosshairs; style sheet picker
  and `.cds` loading.
- Polymer bracket usage, link nodes, multi-centre (η) attachments, attachment points.
- TLC, gel electrophoresis, retrosynthesis tool, resonance structure generation.
- File formats: binary CDX, V3000 writer and RXN reader, multi-record SDF, CML/SKC/SLN/JCAMP-DX
  ("not for now").
- BioDraw, biopolymers/HELM, ChemDraw/Excel and CombiChem, ChemScript, add-ins, cloud, SciFinder.
