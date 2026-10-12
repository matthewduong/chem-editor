import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

TAURI_DIR = Path(__file__).resolve().parents[1]
ENGINE = TAURI_DIR / "bin" / "chem-engine.py"
LIB_RS = TAURI_DIR / "src" / "lib.rs"


class ProtocolHandshakeTests(unittest.TestCase):
    def test_python_and_rust_agree_on_the_protocol_version(self):
        python_version = int(re.search(r"^PROTOCOL_VERSION = (\d+)$", ENGINE.read_text(), re.M).group(1))
        rust_version = int(re.search(r"const EXPECTED_SIDECAR_PROTOCOL: i64 = (\d+);", LIB_RS.read_text()).group(1))
        self.assertEqual(
            python_version,
            rust_version,
            "bump PROTOCOL_VERSION in chem-engine.py and EXPECTED_SIDECAR_PROTOCOL in lib.rs together",
        )

    def test_protocol_command_replies_with_the_version(self):
        result = subprocess.run(
            [sys.executable, str(ENGINE), "protocol"],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        )
        reply = json.loads(result.stdout)
        self.assertEqual(set(reply), {"protocol"})
        self.assertIsInstance(reply["protocol"], int)


if __name__ == "__main__":
    unittest.main()
