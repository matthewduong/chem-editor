# Native platform pieces (UNBUILT)

Written on Linux, where they cannot be compiled or run. Nothing here is part of any build,
installer or test until it has been built and checked on its platform.

Both render through the sidecar's `chem-engine thumbnail INPUT OUTPUT SIZE` command
(`src-tauri/bin/chem-engine.py`), which is tested, and which the Linux thumbnailer
(`src-tauri/linux/`) already uses.

## macOS: QuickLook thumbnails (`macos-quicklook/`)

1. `pnpm tauri build` on a Mac, giving `ChemEditor.app`.
2. `native/macos-quicklook/build.sh path/to/ChemEditor.app` (needs Xcode command-line tools).
3. Check: `qlmanage -r && qlmanage -t -s 256 some.cdxml`, then Finder's icon view.
4. Open questions: the sandboxed extension running the bundled engine (it may need the engine
   signed with the same team and the `com.apple.security.inherit` entitlement); the CDXML UTI
   ChemDraw declares (`com.perkinelmer.chemdraw.cdxml` is assumed); wiring step 2 into the
   bundle (Tauri's `bundle.macOS.files` can place the `.appex` in `Contents/PlugIns`).

## Windows: Explorer thumbnails (`windows-thumbnail/`)

1. `cargo build --release` in `native/windows-thumbnail` on Windows (MSVC toolchain); fix
   whatever the `windows` 0.58 API needs, as this has never been compiled.
2. Copy `chem_editor_thumbnail.dll` next to the installed `ChemEditor.exe`, edit the path in
   `register.reg`, import it, restart Explorer.
3. Check a folder of `.cdxml` files in large-icon view.
4. Then register it from the NSIS/WiX installer hooks instead of the `.reg` file.

## OLE embedding: not written

An embeddable, editable object in Word or PowerPoint needs a COM local server implementing
`IOleObject`, `IDataObject`, `IPersistStorage` and in-place activation, registered by the
installer. That is a separate native application, not a few hundred lines; it is left for a
Windows machine where it can be built and tested.
