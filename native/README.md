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
4. Status 2026-11-03 (macOS 27, ChemDraw 26.1 installed): `build.sh` compiles and signs the
   extension; the bundled engine layout matches `engineURL()`; `pluginkit` lists and elects it.
   But `QLThumbnailGenerator` (use a small Swift caller; `qlmanage -t` hangs with "No sandbox
   token") never launches it for a `.cdxml`: the ThumbnailsAgent starts
   `com.apple.quicklook.thumbnail.TextExtension` (cdxml conforms to `public.text`), which
   replies "Invalid thumbnail request". On this Mac `.cdxml` is `com.revvity.cdxml` (added to
   the plist). Still to find: why the agent skips ours (check System Settings > General >
   Login Items & Extensions > Quick Look; try a signed build rather than ad hoc). Keep one
   registered copy of the app (`lsregister -dump | grep ChemEditor`); stale copies confuse
   registration. Control experiment: with `public.json` added to `QLSupportedContentTypes` the
   agent does launch our extension for a `.json` file, so signing and registration are fine;
   for `.cdxml` it keeps choosing TextExtension even with `com.cambridgesoft.cdxml` (the
   extension's second UTI) and `public.xml` listed. Selection for text-conforming
   third-party types is the unsolved part.
   The engine also writes no thumbnail for CDXML with `<fonttable>` inside
   `<page>` (RDKit rejects it): 18 of 33 test fixtures.
5. Open questions: the sandboxed extension running the bundled engine (it may need the engine
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

## Windows: OLE embedding (`windows-ole/`)

`chem-editor-ole.exe` is a COM local server for `ChemEditor.Document`, with open editing only
(as ChemDraw's objects open in ChemDraw): the embedded object's storage holds its CDXML (stream
`CDXML`); the container's picture is a DIB of the sidecar's rendering, decoded with WIC;
double-clicking writes the CDXML to a temporary file, runs `ChemEditor.exe` on it, waits for it
to close, reads the edits back, and asks the container to save. In-place activation is not
offered.

1. `cargo build --release` in `native/windows-ole` on Windows (MSVC); this has never been
   compiled, and the `windows` 0.58 signatures will need checking.
2. Put `chem-editor-ole.exe` next to `ChemEditor.exe`, edit and import `register.reg`.
3. Check in Word: Insert > Object > ChemEditor Drawing; double-click to edit; save, reopen.
4. ChemEditor opens a `.cdxml` path given on its command line and saves back to it (the
   `startup_document` command, Rust- and UI-tested). Open questions: Copy from ChemEditor does not yet put an
   embeddable object on the clipboard (`OleSetClipboard`), so objects are created from Insert >
   Object only; the server registers through the installer rather than a `.reg` file.
