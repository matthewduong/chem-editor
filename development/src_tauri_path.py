import sys
from pathlib import Path


def ensure_src_tauri_on_path() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    src_tauri_bin = repo_root / "src-tauri" / "bin"
    path_value = str(src_tauri_bin)
    if path_value not in sys.path:
        sys.path.insert(0, path_value)
