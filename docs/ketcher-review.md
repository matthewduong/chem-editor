# Lessons from Ketcher

Source review, 2026-10-12. ChemEditor commit `5c8748aa7540501059e885200ad7f26e29c5e318`;
Ketcher commit `dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9`.
The working tree was clean before this review (the analysis below predates implementation; see
`development/gaps.md` for what has since landed). Ketcher was downloaded into
`/tmp/chem-editor-ketcher-review`; no Ketcher dependencies were installed.
This is an implementation comparison, not a hands-on usability benchmark or a passing
compatibility result. No application behavior was changed and no test suites were run.

## Recommendation

Use Ketcher as a reference for drawing workflows, chemistry service boundaries and
interaction tests. Preserve ChemEditor's CDXML document authority, preservation metadata,
shared screen/export renderer and native desktop integration. Replacing our document
model with Ketcher's chemical structure model would need a separate fidelity evaluation.

ChemEditor already has a single document/history authority, isolated previews, ring
attachment logic, alias resolution, valence highlighting, shared Canvas2D/SVG rendering,
and a licensed ChemDraw acceptance harness. Those are foundations to extend.
`CLAUDE.md` still describes two authoritative histories; current code and
`docs/engineering-validation.md` establish that this has already been replaced.

## Priorities

| Order | Improvement                                          | Benefit                                                       | Relative effort          |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| 1     | Make cleanup a coordinate-only document command      | Protect identity and styling during a common operation        | Medium                   |
| 2     | Add browser tests of actual drawing gestures         | Catch interaction failures across tools, history and export   | Small initially; ongoing |
| 3     | Give every tool one lifecycle and add chain drawing  | Faster drawing; consistent cancellation and commits           | Medium                   |
| 4     | Add a structured chemistry diagnostics panel         | Explain errors and locate affected objects                    | Medium                   |
| 5     | Add searchable user templates with attachment points | Reuse recurring structures and drawing fragments              | Medium                   |
| 6     | Introduce a chemistry capability/service boundary    | Consistent availability, results and backend handling         | Medium; incremental      |
| 7     | Profile and cache scene/index work                   | Improve large-document interaction if measurements justify it | Medium to large          |

Effort is a qualitative implementation estimate, not a delivery commitment.

## 1. Cleanup should change coordinates without rebuilding identity

Ketcher exposes separate `layout` and `clean` service operations. Its server-call adapter
clones structures with atom/bond ID maps and maps the selection into that representation.
This is a useful example of treating selection and correspondence explicitly; it does
not prove Ketcher's cleanup preserves every ChemDraw object or attribute.

Our `src/components/ChemCanvas.tsx` cleanup handler has two different behaviors:

- Selected cleanup retains atom IDs and updates positions, assuming output atom order
  matches input order after checking only the atom count.
- Full cleanup generates new atom/bond UUIDs and rebuilds a restricted set of fields
  from parsed molfile geometry. It does not carry the complete alias/style/template
  metadata forward.

`createProjectionEditCommand` protects unsupported objects, but a supported object with
a new ID is still a replacement. Fragment correspondence in
`mergeCanvasStateIntoChemDrawDocument` also depends on surviving node IDs. This is a
source-observed preservation risk; a full UI/CDXML reproduction remains to be written.

Implement one headless cleanup command with explicit engine-to-document correspondence.
Apply returned positions to existing document nodes; retain bonds, aliases, styles,
fragment/group membership and unknown metadata. Preserve stereochemical meaning when
coordinates change: verify the result or refuse cases requiring an unsupported stereo
transformation. Define partial-selection behavior for bonds crossing the selection.
Commit once and reject mismatched results before changing the document.

Acceptance: labeled/styled/grouped structures retain IDs, chemistry and preservation
metadata after cleanup/save/reopen; unselected objects stay unchanged; undo restores the
original; malformed results and unsupported edits leave the document untouched.

References: [Ketcher service contract](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-core/src/domain/services/struct/structService.types.ts),
[selection mapping and transforms](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-react/src/script/ui/state/server/index.js).

## 2. Test user gestures as well as rendering and commands

Ketcher's Playwright suite organizes scenarios around drawing, templates, file workflows
and undo/redo, with toolbar/page helpers and screenshot assertions. Our browser tests
cover XML workers and scene/export parity; the scene test constructs commands directly.
UI unit tests and the packaged native harness provide additional coverage, but the
browser suite has room for actual pointer/keyboard drawing flows.

Start with a small single-worker suite: draw a bond, close a ring, attach a ring template,
edit a label, drag a selection, cancel with Escape or a tool switch, undo/redo, then
save/reopen. Assert document identity and chemistry alongside rendered output. Include
zoom/device-scale cases and failed engine operations. Keep the existing independent
ChemDraw oracle: Ketcher output is comparison material, not a fidelity specification.

Reference: [Ketcher undo/redo scenarios](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/ketcher-autotests/tests/specs/User-Interface/Editing-Tools/Undo-Redo/undo-redo-actions.spec.ts).

## 3. Unify tool lifecycle; then add chain drawing and deliberate fusion

Ketcher has a common tool event interface including cancellation, separate chain/template
tools, and explicit fusion actions. Its chain tool previews a zigzag chain and reports
the added atom count.

Our bond, atom and selection hooks already expose cleanup and preview behavior. However,
ring, arrow and text interactions still share a 3,773-line `ChemCanvas.tsx`; tool event
contracts are separate interfaces. There is no dedicated chain tool in the inspected
tool modules. Basic bond-to-existing-atom snapping and chair attachment already exist.

Extract pure gesture calculations behind a shared begin/update/commit/cancel contract.
Retain the current separate preview state; do not copy a mutable preview implementation
that would weaken it. Add drag-to-length chain drawing with a visible count, then
explicit merge previews for fragment attachment. Fusion must reconcile duplicate bonds,
stereo, references and edit capabilities before it becomes a committed command.

Acceptance: one completed gesture creates one history entry; cancellation creates none;
the preview matches the result; ring closure and fusion never create duplicate bonds or
dangling references.

References: [tool interface](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-react/src/script/editor/tool/Tool.ts),
[chain tool](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-react/src/script/editor/tool/chain.ts).

## 4. Turn chemistry errors into actionable diagnostics

Ketcher's check dialog offers categories including valence, radicals, isotopes, stereo,
queries and overlapping atoms/bonds; its adapter combines local and engine checks.
Our editor already tracks invalid atoms and draws valence errors. The improvement is a
structured explanation and navigation layer, not adding valence highlighting from scratch.

Represent diagnostics as severity, code, message, affected document IDs and availability.
Clicking an issue should select/locate its objects. Start with existing validation and
geometry checks, then add engine-backed stereo checks where supported. Distinguish a
preserved query or coordination structure from invalid ordinary chemistry, and distinguish
an unavailable check from a successful check. Diagnostics should never rewrite chemistry.

Reference: [Ketcher check dialog](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-react/src/script/ui/views/modal/components/process/Check/Check.tsx).

## 5. Expand ring presets into reusable user templates

Ketcher has library search, user templates and editable atom/bond attachment points.
Our `src/lib/ringTemplates.ts` already provides substantial placement/fusion logic, while
shorthand entries solve chemical label interpretation. Build on both rather than treating
templates as another spelling of a shorthand alias.

Add save-selection-as-template, name/tags, search, thumbnails and attachment points.
Store a native document fragment plus attachment metadata so captions, arrows, styles and
preserved content can survive. Reuse document clipboard/reference-remapping logic for
placement. Initially restrict attachment to fragments whose edits are supported.

Acceptance: saved templates survive restart; repeated insertion yields unique consistent
IDs; detached and attached insertion preserve content and undo in one step.

Reference: [user-template actions and attachment metadata](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-react/src/script/ui/state/templates/index.ts).

## 6. Standardize chemistry services without changing the document codec

Ketcher separates `StructService` from standalone/remote providers. ChemEditor already
has RDKit WASM, typed panel data, cached task hooks and a Tauri adapter, but these do not
yet form one capability contract for drawing-related chemistry operations.

Introduce a small interface for capabilities, layout and diagnostics first. Return
typed errors and explicit object correspondence. Existing cancellation/stale-result
protection should apply to mutating results too. Grow the interface only when a real
consumer needs another operation. Keep quantum calculations explicitly initiated.

Keep CDXML parsing/preservation in the native document layer. RDKit or optional Indigo
can operate on explicit chemical projections. Adding Indigo needs separate evaluation
of coverage, bundle/startup cost, offline behavior and distribution obligations.

## 7. Learn from invalidation; measure before changing rendering/history

Ketcher groups reversible operations into actions and invalidates affected render objects.
Our commands already return inverse patches and `changedObjectIds`, but the store commits
documents and keeps at most 50 document snapshots. Snapshots reuse object references;
they should not be described as 50 unconditional deep copies. The render surface clears
and repaints the canvas, while scene assembly builds document indexes.

Measure ordinary edits and pointer-move previews on synthetic 100/1,000/5,000-atom
documents, including styled labels and groups. Track scene/index time, paint time and
history memory. First try cached indexes/geometry and one paint per animation frame.
Consider dependency-aware invalidation or patch history only if measurements justify
the complexity. Bonds, labels, crossings and groups create dependencies beyond changed IDs.

References: [reversible actions](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-core/src/application/editor/actions/action.ts),
[atom move and invalidation](https://github.com/epam/ketcher/blob/dd2c6804dfc3f79fa5c4a86010c4c1cfdbff0cd9/packages/ketcher-core/src/application/editor/operations/atom/AtomMove.ts).

## Later features

Reaction mapping/RXN interoperability, enhanced stereo editing, R-group/query authoring,
aromatize/dearomatize and broader format adapters are useful directions. Each needs a
semantic and round-trip contract before a toolbar button. Reaction arrows alone do not
define reactant/product roles or atom correspondence. Biomolecule/HELM mode and OCR
should follow demonstrated demand rather than displacing core drawing/fidelity work.

The first implementation batch should combine preservation-safe cleanup with real browser
gesture coverage. Follow it with the common tool lifecycle and chain tool, then diagnostics
and user templates. Current packaged-platform and licensed-ChemDraw acceptance requirements
remain in force; this review supplies no new evidence that they passed.
