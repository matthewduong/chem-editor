import argparse
from pathlib import Path

from src_tauri_path import ensure_src_tauri_on_path

ensure_src_tauri_on_path()

from nmr_hose import build_hose_database_sqlite  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the HOSE lookup database for NMR prediction."
    )
    parser.add_argument(
        "--input",
        default="development/nmr_model/data/nmrshiftdb2withsignals.sd",
        help="Path to the source SDF with NMRShiftDB2 spectra.",
    )
    parser.add_argument(
        "--output",
        default="src-tauri/bin/nmr_hose_db.sqlite",
        help="Path to the generated HOSE database SQLite file.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.is_file():
        raise SystemExit(f"Input SDF not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    build_hose_database_sqlite(str(input_path), str(output_path))
    print(f"Wrote HOSE database to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
