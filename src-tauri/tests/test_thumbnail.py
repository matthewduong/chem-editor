import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TAURI_DIR = Path(__file__).resolve().parents[1]
ENGINE = TAURI_DIR / "bin" / "chem-engine.py"
# Laid out as ChemDraw writes a file: tables at the root, then the page.
ETHANOL = """<?xml version="1.0" encoding="UTF-8" ?>
<CDXML BondLength="14.4"><fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable>
<page id="1"><fragment id="2"><n id="3" p="0 0"/><n id="4" p="12.47 -7.2"/>
<n id="5" p="24.94 0" Element="8"/><b id="6" B="3" E="4"/><b id="7" B="4" E="5"/></fragment>
</page></CDXML>
"""


def run(*args):
    return subprocess.run([sys.executable, str(ENGINE), "thumbnail", *args], capture_output=True, timeout=120)


class ThumbnailTests(unittest.TestCase):
    def test_a_cdxml_file_previews_as_a_png_of_the_asked_size(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "ethanol.cdxml"
            source.write_text(ETHANOL)
            out = Path(directory) / "thumb.png"
            result = run(str(source), str(out), "128")
            self.assertEqual(result.returncode, 0, result.stderr)
            data = out.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            width = int.from_bytes(data[16:20], "big")
            height = int.from_bytes(data[20:24], "big")
            self.assertEqual((width, height), (128, 128))

    def test_an_unreadable_file_writes_nothing_and_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = Path(directory) / "bad.cdxml"
            bad.write_text("<CDXML><page><fragment><n p='x y'/>")
            out = Path(directory) / "thumb.png"
            self.assertNotEqual(run(str(bad), str(out)).returncode, 0)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()


class ThumbnailerLauncherTests(unittest.TestCase):
    def test_the_launcher_finds_the_bundled_engine(self):
        launcher = TAURI_DIR / "linux" / "chem-editor-thumbnailer"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine_dir = root / "bin" / "chem-engine-test"
            engine_dir.mkdir(parents=True)
            engine = engine_dir / "chem-engine"
            engine.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ENGINE}" "$@"\n')
            engine.chmod(0o755)
            source = root / "ethanol.cdxml"
            source.write_text(ETHANOL)
            out = root / "thumb.png"
            result = subprocess.run(
                ["/bin/sh", str(launcher), str(source), str(out), "64"],
                env={"CHEM_EDITOR_LIB": str(root), "PATH": "/usr/bin:/bin"},
                capture_output=True,
                timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(out.read_bytes()[:4], b"\x89PNG")

    def test_the_thumbnailer_entry_names_the_launcher_and_cdxml(self):
        entry = (TAURI_DIR / "linux" / "chem-editor.thumbnailer").read_text()
        self.assertIn("Exec=/usr/bin/chem-editor-thumbnailer %i %o %s", entry)
        self.assertIn("MimeType=chemical/x-cdxml;", entry)
