# Feature phases

How the items in `todo.md` are being built. Each phase ends by readying the next: its plan is
written here, its fixtures and groundwork land, and conventions it cannot confirm without
ChemDraw are logged in `gaps.md` as "to probe on mac".

Source of ChemDraw behaviour: the ChemDraw 17.1 User Guide (chapter and section given per item),
ChemDraw's own files (the `chemdraw_template*.cdxml` set in RDKit's test data), and
`pnpm test:chemdraw:mac` where a measurement is needed.

| Phase | Theme                               | Status                 |
| ----- | ----------------------------------- | ---------------------- |
| I     | Graphics foundation and shape tools | **done 2026-10-29**    |
| II    | Selection and arrange               | **done 2026-10-30**    |
| III   | Annotations, bonds and labels       | **done 2026-10-30**    |
| IV    | Stereo, numbering and analysis      | **done 2026-10-30**    |
| V     | Reactions                           | **done 2026-10-30**    |
| VI    | Query structures                    | **done 2026-10-30**    |
| VII   | Document, output and app shell      | **ready** (plan below) |
| VIII  | Naming                              |                        |

## Phase I — done

Round-trip fixes for lines, arcs, curves, rectangles, ovals and symbols as ChemDraw writes them;
the Drawing palette (rectangle, rounded rectangle, oval, circle, solid/dashed/bold line, 90-270°
arcs, single and paired square/round/curly brackets, daggers, pen and Edit Curve); Edit > Add
Frame; Edit > Curve. Carried into Phase II: per-shape reshape handles.

## Phase II — selection and arrange

ChemDraw's specified behaviour (guide chapter 6 unless noted), and its keys (chapter 5,
"Shortcuts"):

| Item                           | Behaviour                                                                                                                                                                                        | Keys                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Lasso                          | Freehand selection area; press off any object and drag around. Objects are selected only if entirely inside. Shift adds.                                                                         | —                                              |
| Flip                           | Object > Flip Horizontal / Flip Vertical reflect the selection through a vertical / horizontal line through its centre ("Mirror Images"). Rotate 180° horizontal/vertical are separate commands. | Shift+Ctrl+H, Shift+Ctrl+V; Alt+Shift+Ctrl+H/V |
| Rotation centre                | A '+' marks the centre of rotation; Alt-drag it elsewhere (an atom, any point) and rotation turns about it.                                                                                      | Alt+drag                                       |
| Z-order                        | Bring to Front / Send to Back for any object.                                                                                                                                                    | F2, F3                                         |
| Centre on page                 | The selection rectangle's centre moves to the page centre.                                                                                                                                       | Shift+Ctrl+C                                   |
| Join                           | Two selected atoms (moved near each other) fuse into one; two selected bonds fuse into one shared bond. The front atom's label and colour win.                                                   | Ctrl+J                                         |
| Chain length                   | Clicking with the chain tool asks for a carbon count; Alt+click repeats the last length.                                                                                                         | Alt+click                                      |
| Fixed lengths / angles         | Object > Fixed Lengths and Fixed Angles (on by default) constrain bonds to the document bond length and to 120° chains / 15° steps; Alt while dragging suspends both.                            | Ctrl+L, Ctrl+E                                 |
| Zoom                           | View > Magnify, Reduce, Actual Size, Fit; a magnification readout accepting 1-999%; magnify about the selection (or the last object drawn).                                                      | F7, F8, F5, F6                                 |
| Reshape handles (from Phase I) | Rectangles and ovals resize per axis, circles by radius, rectangle corners proportionally; arcs by their end and middle points.                                                                  | —                                              |

### Groundwork landed in I.6

- Arc arrows keep their centre and axes under move, rotate and scale (`mapArrow`).
- The select tool rotates about a pivot passed separately from the rotate handle's position
  (`useSelectTool.begin(..., rotationPivot)`), and measures the drag angle about it.

### Sub-steps

Each is one commit with node, UI and browser tests, as Phase I's were.

**II.1 Z-order and centre on page.**

- `reorderSelectedObjects(doc, ids, 'front' | 'back')` in `chemdrawModel.ts`: move the objects
  (a node or bond resolves to its fragment, as `createGroupFromSelection` does) to the end or
  start of `page.objects`, keeping their relative order, and set `style.zIndex` past every other
  object's so the order survives a ChemDraw save: the writer groups objects by type
  (`cdxml.ts` ~1205), so only `Z` carries cross-type order. Command beside
  `createMoveSelectionCommand`; Edit menu items; keys F2/F3. Replaces `reorderBondObjects` for the
  bond panel's buttons.
- Centre on page: `getObjectsBounds` -> delta to the page centre from
  `getPageSetupDimensionsPx` (`settings.ts:674`) -> `createMoveSelectionCommand`; disabled for an
  infinite page. Shift+Ctrl+C.

**II.2 Flip.** `flipSelectedObjects(doc, ids, center, 'horizontal' | 'vertical')` and its command,
not a negative scale (the Scale dialog keeps rejecting factors <= 0). Mirror node positions,
`electronAngles` (180-a / -a) and label alignment left<->right; keep wedge/hash `display` as is
(ChemDraw's flip draws the mirror-image stereoisomer); mirror arrow points and swap
`headSide`/`half-left`<->`half-right`; mirror arc axes (the AngularSize sign stays right); mirror
curve points; text moves by its visual centre and keeps upright glyphs (rotation r -> -r or
180-r). Rotate 180° horizontal/vertical are the existing rotate by pi. Keys Shift+Ctrl+H/V,
Alt+Shift+Ctrl+H/V. Fixture: a wedged stereocentre, an arc, a half-headed arrow, a caption.

**II.3 Movable rotation centre.** `rotationPivot` in the store (reset when the selection set
changes); a '+' marker at the pivot, Alt-drag to move it (hit-tested before the rotate handle);
App's Rotate... dialog uses it too. Show the rotate handle for graphics-only selections as well.

**II.4 Lasso.** A `selectMode: 'marquee' | 'lasso'` option on the select tool; refactor the
marquee's per-object test (`useSelectTool.ts` ~603-710) into a predicate shared by both; the
lasso keeps whole objects only (the guide: "entirely within"), tests graphics by their bounds'
corners, and snapshots the base selection at begin for Shift. Point-in-polygon in `src/lib`;
a closed Konva `Line` for the outline.

**II.5 Join.** `mergeNodes(doc, pairs)` in `src/lib`, modelled on `placeTemplate`'s merge
(`templates.ts` ~164-340): re-point bonds, drop self and duplicate bonds, merge the fragments,
fix groups and ring-template memberships; the front atom's label and colour win. Object > Join
(Ctrl+J) for two selected atoms or two selected bonds (bond join maps both ends). Dragging a
selection so an atom lands on another highlights the target and joins on release, as one
transaction with the move.

**II.6 Chain length and fixed toggles.** `chainGeometry(..., count?)`; a click with the chain
tool opens a count prompt, Alt+click repeats the last count. `fixedLengths` / `fixedAngles`
preferences (app preferences, not document style), Object menu checkboxes, Ctrl+L / Ctrl+E;
bond, atom, chain, arrow and line tools read them, and Alt suspends both while dragging. The
snapping sites: `useBondTool.ts:193`, `useAtomTool.ts:144`, `newBondAngle.ts:9`,
`arrowGesture.ts:25`, `shapeGesture.ts` `lineEnd`, `chain.ts:12`.

**II.7 Zoom.** `zoomBy(factor)` about the viewport centre (the +/- buttons currently zoom about
the stage origin), `actualSize` (`resetStageView`), magnify about the selection; on
`ChemCanvasRef` beside `fitToScreen`; View items and F5-F8; a readout and input (1-999%,
relative to `DEFAULT_STAGE_SCALE`) via an `onZoomChange` prop.

**II.8 Reshape handles.** `getShapeHandles(object)` / `applyShapeHandle(object, id, point,
constrain)` in `src/lib`: rectangle and oval per-axis edges, rectangle corners proportional,
circle radius, arc ends and midpoint (recomputing centre, axes and control point). Shown when
exactly one editable shape or arc is selected; commit through `createUpsertObjectsCommand`.
Imported shapes stay gated by `blocksTransform`.

**II.9 Ready Phase III.**

### To probe on mac

- Whether ChemDraw's Flip keeps wedge/hash as drawn (the guide implies the mirror-image
  stereoisomer) and how it treats atom label alignment.
- How ChemDraw writes `Z` after Bring to Front / Send to Back.

Phase II done 2026-10-30: lasso, flip and Rotate 180°, movable rotation centre, z-order, centre
on page, join, typed chain length, Fixed Lengths/Angles, zoom commands and readout, reshape
handles, and ChemDraw's keys for all of them (preferences version 11).

## Phase III — annotations, bonds and labels

### Groundwork landed in II.9

- `Order="4"` reads as a quadruple bond (it read as a triple) and the 0x0008 query bit maps both
  ways; formula-face text (face 96) is written back as 96 (it was written as 0).

### Sub-steps

**III.1 Orbitals.** Draw every `OrbitalType` from what the file gives (Center3D/axes, else the
BoundingBox points the reader already derives): s, oval, p, lobe, hybrid, dz2, dxy, with the
Shaded/Filled suffix parsed off the type and Plus/Minus phases as filled versus open lobes
(`graphicModule.ts` ~538-607; today only `s` with axes and plain `p` draw, so most of
`orbitals.cdxml` is blank). Then an orbital tool: `OrbitalShapeKind` in `shapeGesture.ts`, a
drag from the atom outward setting the axis (the guide: click an atom for s, drag for p), and
palette entries. Golden for `orbitals.cdxml` will move: that is the point.

**III.2 Circled charges and radical ions.** New `ElectronToolMode`s (circled +/-, radical cation,
radical anion) beside the Electrons palette's +1/-1 (`App.tsx` ~3136): set the node's charge (and
radical) and add a Symbol graphic with `<represent attribute="Charge" object=…>` at a free angle
(`createSymbolGraphic`); toggling off removes it. The label must not draw the charge a symbol
represents (`nodeModule.ts` ~121, and the exported label text), or it shows twice.

**III.3 Character map.** A floating panel of Greek, arrows, degree, ±, ‡, †, ·, primes and
sub/superscript digits, with recently used characters first (guide "Character Map"); active only
while a text editor is open. Buttons `preventDefault` on mousedown so the editor keeps focus; a
`canvasRef.insertText(char)` inserts into whichever editor is open (atom label inputs by
selection splice, captions by `insertPlainTextIntoEditable`).

**III.4 Quadruple bond.** Draw four parallel lines (±0.5 and ±1.5 × `parallelOffset`,
`renderGeometry.ts` `getOffsetBondLineGeometry`); bond menu entry and icon; the guide's three
ways to make one (tool, drag along a triple, key on a bond; our `4` is the cyclobutane hotkey, so
the key path uses the bond menu). Molfile export must not write order 4 (V2000 aromatic).

**III.5 Isotope labels.** Draw the mass number as a superscript before the element
(`atomLabelPresentation.ts` `buildAtomLabelRuns`), make an isotope make a carbon's label visible
(`isAtomLabelVisible`), and add an isotope field to the atom label panel
(`CanvasTextEditors.tsx` ~407) committing through `applyNodeLabelStyleEdit`.

**III.6 Expand / contract nicknames.** Edit > Expand Label replaces a selected alias atom with its
structure (from `expandSupportedAliasGraph`'s template, scaled to the bond length and turned so
the attachment bond leaves its neighbour), as one undo step; Contract Label replaces a selected
substructure with one external bond by the matching shorthand (canonical SMILES against
`shorthand.ts`) or a typed label.

**III.7 User-defined nicknames.** Structure > Define Nickname: a selected substructure with
attachment points becomes a named shorthand stored in app preferences (or a nickname library file
beside the template library), and lookups of `SHORTHAND_DATA[...]` go through one registry that
includes them.

**III.8 Caption line spacing and formula style.** `lineHeight` on text (Automatic, Variable,
Fixed; CDXML `LineHeight` on `<t>` and the document's `CaptionLineHeight`), used in place of
`AUTO_LINE_HEIGHT_RATIO`; a formula-style toggle on the text toolbar setting `formula` on runs,
and the contentEditable round trip keeping it (a data attribute on formula spans).

**III.9 Ready Phase IV.**

### To probe on mac

- Symbol size and placement for circled charges next to atoms; orbital proportions per type;
  how ChemDraw writes a user nickname into a document that uses it.

Phase III done 2026-10-30: every orbital type and orbital tools, circled charges and radical
ions, character map, quadruple bonds, isotope labels, Expand/Contract Label, user nicknames,
caption line spacing and formula style.

## Phase IV — stereo, numbering and analysis

ChemDraw (17.1 guide): stereo indicators are shown per structure (Object Settings > Show
Stereochemistry) and update as the drawing changes; atom numbers are shown on selected atoms
with the `'` hotkey; Structure Perspective tilts a selection in 3D by dragging (Shift limits it to
the X or Y axis); the Analysis window gives formula, exact mass, MW, m/z with isotope abundance,
and elemental analysis, for the selection or else the document; stereochemical flags (Absolute,
Relative, Racemic) attach to the nearest structure.

### Groundwork landed in III.9

- Atom object tags (stereo labels, numbers) move with their atom under move, rotate, scale and
  flip; they were left behind.
- `RdkitMol.get_stereo_tags` / `get_descriptors` typed (RDKit-wasm 2025.3.4 has both).

### Sub-steps

**IV.1 CIP labels.** Per structure, `rdkit.get_mol(molblock)` then `get_stereo_tags()` (the
molblock's atom i is `atoms[i]`, `graphToMolblock`); map to atom and bond ids as the viewer
already does (`ChemCanvas.tsx` ~1004-1095, debounced on `hashCanvasState`). Draw as a derived
overlay in the scene (`stereoLabelsByAtomId/ByBondId` beside `rdkitInvalidAtomIds`): `(R)`/`(S)`
beside the atom, `(E)`/`(Z)` at the bond's middle, caption font. A Show Stereochemistry toggle
(document view setting). Bond `<objecttag>`s from files are parsed and drawn too
(`parseObjectTags` is not called for `<b>` today).

**IV.2 Enhanced stereo and flags.** `ChemDrawNode.enhancedStereo { type: abs|and|or; group }`
read and written as CDXML `EnhancedStereoType` / `EnhancedStereoGroupNum` (raw today); an Atom
panel control; V3000 `MDLV30/STEABS|STERAC|STEREL` collections in the molfile writer; the chiral
flag (molfile counts line field 5). Stereochemical flag symbols (Absolute/Relative/Racemic, already
drawn as symbols) placeable from the Drawing palette.

**IV.3 2D atom numbering.** Show Atom Numbers on the selection (`'` hotkey, Atom menu), stored as
ChemDraw does (`ShowAtomNumber`/`AtomNumber` on `<n>`, raw today), drawn beside the atom away
from its bonds (`labelPlacement.ts`).

**IV.4 Structure perspective.** `perspectiveSelectedObjects(doc, ids, center, tiltX, tiltY)`:
rotate positions about the X/Y axes through the centre and project back to the page (2D
coordinates only, as ChemDraw); a perspective tool dragging inside the selection (Shift: one
axis), as one command like rotate.

**IV.5 Analysis.** Elemental analysis (% by weight from the formula and `ELEMENTS[].weight`) and
m/z (exact mass less electron mass times charge, over |charge|, with the main isotope peaks from
`predict_ms`'s isotope spread) in the Properties panel, for the selection or else the document.

**IV.6 Analysis as caption.** A button per row (and "all") inserting the value as a caption under
the structure's bounds in the document caption style (`resolveDocumentCaptionTextStyle`), one
undo step.

**IV.7 Ready Phase V.**

### To probe on mac

- How ChemDraw writes computed stereo indicators (objecttag name and placement), and
  `ShowAtomNumber` / `AtomNumber` placement.

Phase IV done 2026-10-30: CIP indicators (Show Stereochemistry, kept as ChemDraw's
ShowAtomStereo/ShowBondStereo), bond object tags drawn, enhanced stereo groups and flags, atom
numbers (`'`), Structure Perspective, m/z, elemental analysis and Paste analysis as caption.
Molfile enhanced stereo waits for the V3000 writer (Phase VII).

## Phase V — reactions

What ChemDraw records, measured from a ChemDraw 23.1 file: a reaction is a page-level
`<scheme id>` holding `<step>`s, each with id lists `ReactionStepReactants`,
`ReactionStepProducts`, `ReactionStepArrows`, `ReactionStepObjectsAboveArrow` and
`ReactionStepObjectsBelowArrow`. Arrows carry no attachment attributes in any file to hand (87
arrows across RDKit's ChemDraw test data and the user's ChemDraw 23 files), so how ChemDraw
stores an attached ("connecting") arrow is unknown.

Today a `<scheme>` with no modelled children is preserved as raw page XML, and fragment roles
are guessed on import from the first arrow (`cdxml.ts`, "inferred heuristically").

### Groundwork landed in IV.7

- `tests/fixtures/cdxml/reaction-step.cdxml`: a one-step reaction (reactant, arrow, reagent
  text above, product) with ChemDraw's step record; its golden and raw round trip are pinned.

### Sub-steps

**V.1 Model schemes and steps.** `ChemDrawReactionScheme { id, steps: ChemDrawReactionStep[] }`
on the page, read from `<scheme>/<step>` (ids kept as lists; unknown attributes preserved) and
written back; ids of deleted objects dropped on export so the step never dangles; when a step
exists, fragment roles come from it, not the arrow heuristic. Robustness cases (dangling ids,
empty lists) in `cdxml-robustness`.

**V.2 Reaction roles UI.** Structure > Reaction: "Show Reaction Interpretation" outlines the
step's reactants, products and above/below objects (an editing affordance, like the valence
marks, never exported); "Set as Reactant / Product / Above Arrow / Below Arrow" on the selection
edits the step (creating a scheme and step around the nearest arrow when none exists), one undo
step.

**V.3 Clean Up Reaction.** From a step: reactants in a row left of the arrow, products right,
centred on the arrow's line; above/below objects centred over and under the arrow; the arrow
stretched to fit the widest of them. Spacing from the document's bond length (ChemDraw's exact
gaps to probe on mac).

**V.4 Connecting arrows.** The guide's "Connecting Arrows" joins arrows to arrows, not to
objects: Shift over an existing arrow's tail, head or midpoint starts a new arrow exactly there
(a curved arrow's midpoint on its curve). Geometry only, so nothing new is written to files.
(Planned first as object-following attachment; corrected on reading the guide.)

**V.5 Mass fragmentation tool.** Drag a line across bonds of a structure: the bonds it crosses
split the molecule into fragments, each labelled with its formula and m/z (`massAnalysis.ts`)
as a caption beside it; ChemDraw's fragmentation-line object and caption placement are to probe.

**V.6 Ready Phase VI.**

### To probe on mac

- Clean Up Reaction spacing; the mass fragmentation line's CDXML.

Phase V done 2026-10-30: schemes and steps modelled, reaction roles UI and Show Reaction
Interpretation, Clean Up Reaction, connecting arrows, the Mass Fragmentation tool.

## Phase VI — query structures

Source: the CDXML DTD, now in `development/reference/cdxml/` (Revvity's open-sourced CDX
library, the version RDKit pins). On `<n>` it gives the query attributes and their values:
`NodeType` (… `GenericNickname`, `ElementList`, `AnonymousAlternativeGroup`,
`NamedAlternativeGroup`, `MultiAttachment`, `VariableAttachment` …), `GenericNickname`,
`ElementList` / `GenericList`, `AltGroupID`, `SubstituentsExactly` / `SubstituentsUpTo`,
`FreeSites`, `RingBondCount (SpiroOrHigher|Fusion|SimpleRing|AsDrawn|NoRingBonds|Unspecified)`,
`UnsaturatedBonds (Unspecified|MustBeAbsent|MustBePresent)`, `ImplicitHydrogens`,
`RxnChange`, `RxnStereo (Unspecified|Inversion|Retention)`, `Translation`,
`IsotopicAbundance`, `LinkCountLow` / `LinkCountHigh`, `ShowAtomQuery`. R-logic is a page-level
`<rlogic>` of `<rlogicitem RLogicGroup RLogicOccurrence RLogicIfThenGroup RLogicRestH>`;
alternative groups are `<altgroup>` holding the fragments an R stands for. Measured from files:
`NodeType="GenericNickname" GenericNickname="R"` (11 in RDKit's ChemDraw test data).

Today `ChemDrawQueryAtom` carries type, element list, R-group / generic name, link counts and
attachments; other query attributes survive as raw attributes and query nodes are projected to
display labels with edits blocked.

### Groundwork landed in V.6

- The DTD and property table in `development/reference/cdxml/` (with licence and README);
  CLAUDE.md's "the CDXML DTD" now points there.

### Sub-steps

**VI.1 Typed generic labels.** Typing R, R1…, X, A, Q, M, Ar, Het (the DTD's GenericNickname
values ChemDraw's label tool uses) makes a `GenericNickname` node, drawn as its label and written
with `NodeType="GenericNickname"`, not an unresolved alias; bonds clip as for any label.

**VI.2 Atom and bond query properties.** Model the atom attributes listed above and the bond's
(`Topology`, `BondOrder` lists, `RxnParticipation`) as typed fields instead of raw ones; an
Atom/Bond Query panel edits them (one undo step each); `ShowAtomQuery` draws ChemDraw's query
indicators beside the atom (their text to probe on mac). Robustness cases for every enum.

**VI.3 R-groups and R-logic.** Model `<altgroup>` (an R's members) and `<rlogic>`/`<rlogicitem>`;
an R-Logic dialog (occurrence, if-then, RestH); **Expand Generic Structure** enumerates the
combinations into new structures on the page, each member bonded at the R's attachment.

**VI.4 Ready Phase VII.**

### To probe on mac

- Query indicator text and placement; how an altgroup frame draws; the enumerated layout.

Phase VI done 2026-10-30: typed generic labels as ChemDraw writes them, atom and bond query
properties modelled and edited, R-group definitions read (and no longer written twice), Expand
Generic Structure. R-logic is kept raw, neither applied nor edited (gaps.md).

## Phase VII — document, output and app shell

What exists: SVG/PNG export through the one scene renderer (`svgExport.ts`, margin now the
`padding` option, default `DEFAULT_EXPORT_PADDING`); printing is `window.print()` (`App.tsx`);
a recovery snapshot (`documentRecovery.ts`, `useDocumentLifecycle.tsx`) but no autosave to the
open file; Copy writes CDXML and PNG (`clipboard.ts`); the sidecar exports chemical files
(`export_chemical_file`); RDKit-wasm offers `get_inchi`, `get_inchikey_for_inchi` and
`get_v3Kmolblock`. One document per window. Drawing settings in Preferences lack bold width,
margin width, hash spacing and bond spacing.

### Groundwork landed in VI.4

- `generateCanvasSVGWithContext` takes `padding`; the export border is no longer a constant.

### Sub-steps, in order of dependency

**VII.1 Drawing settings UI.** Bold width, margin width, hash spacing and bond spacing in
Preferences > Drawing (the ACS metrics in `chemdrawMetrics.ts`), with live preview.
**VII.2 Background colour and colour palette.** Document background (CDXML `bgcolor`, DTD) and
a saved palette in preferences.
**VII.3 Document properties.** A dialog for the document's metadata (`Name`, `Comment`,
`CreationUserName`… the CDXML root attributes the DTD lists), kept on round trip.
**VII.4 Export border preference.** A preference feeding `padding` to SVG, PNG and Copy.
**VII.5 Copy As SMILES / InChI / InChIKey / molfile.** From RDKit for the selection (or
document); molfile as V3000 when enhanced stereo is present (`MDLV30/STEABS|STERAC|STEREL`,
counts-line chiral flag), closing Phase IV's gap.
**VII.6 Autosave to the open file.** Opt-in interval save to the open path (never a failed
import's source), beside the recovery snapshot.
**VII.7 Print preview, scaling and margins.** A preview of the printed pages from the scene
renderer with scale and margins from page setup.
**VII.8 More export formats.** PDF (vector, from the SVG), JPEG and TIFF (from the PNG path);
EMF/EPS through the sidecar if a library allows, else recorded as gaps.
**VII.9 Multiple open documents.** Tabs or windows, each with its own store slice.
**VII.10 Drag out / OLE, and thumbnails.** Drag a selection out as CDXML+PNG; OLE and OS
thumbnails are platform work, likely partial (gaps).
**VII.11 Ready Phase VIII.**
