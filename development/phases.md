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
| III   | Annotations, bonds and labels       | **ready** (plan below) |
| IV    | Stereo, numbering and analysis      |                        |
| V     | Reactions                           |                        |
| VI    | Query structures                    |                        |
| VII   | Document, output and app shell      |                        |
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
