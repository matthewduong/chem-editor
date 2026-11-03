# Mac session handoff (branch `main`)

Everything in `development/todo.md` is done and tested except two items, whose code is in
`native/` and has never run (`native/README.md` has the details):

1. **macOS QuickLook thumbnails** (`native/macos-quicklook/`) — never compiled.
   - `pnpm install && pnpm sync:sidecar && pnpm tauri build` to get `ChemEditor.app`
     (never hand-copy sidecar binaries).
   - `native/macos-quicklook/build.sh path/to/ChemEditor.app`; fix compile errors.
   - Check: `qlmanage -r && qlmanage -t -s 256 tests/fixtures/cdxml/reaction-step.cdxml`, then
     Finder's icon view on a folder of `.cdxml` files. Expect sandbox trouble running the bundled
     engine; see the open questions in `native/README.md`.
   - Status 2026-11-03: builds and registers, but QuickLook never launches it; see
     `native/README.md`.
   - Wire the `.appex` into the bundle (`bundle.macOS.files`) once it works.
2. **Windows thumbnail handler and OLE server** (`native/windows-thumbnail/`,
   `native/windows-ole/`) — need a Windows machine to run, but compile-check from the Mac:
   `rustup target add x86_64-pc-windows-msvc`, then `cargo check --target x86_64-pc-windows-msvc`
   in each. The thumbnail handler already type-checks. The OLE server has 9 errors against
   windows 0.58. Fixed 2026-11-03: it now passes `cargo check`. `STGM_*` are in `Com`,
   `IPersistStorage` in `Com::StructuredStorage` and needs `IPersist_Impl` implemented
   separately, and the `IOleObject_Impl` methods take typed enums. Still never run.

Also on the Mac, while ChemDraw is installed: the "to probe on mac" rows in
`development/gaps.md` (stereo indicator placement, query indicators, Clean Up Reaction spacing,
mass fragmentation captions, naming choices…), measured with `pnpm test:chemdraw:mac` as
`development/chemdraw-fidelity.md` describes.

Gate before each commit: `pnpm lint && pnpm test`.
