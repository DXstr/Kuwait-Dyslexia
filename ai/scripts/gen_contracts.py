"""Regenerate Pydantic models from the shared contract schema.

    python scripts/gen_contracts.py           # write basira_ai/contracts_gen/models.py
    python scripts/gen_contracts.py --check   # exit 1 if the committed file is out of date (used by tests/CI)

Never edit basira_ai/contracts_gen/models.py by hand; change contracts/schemas/basira.schema.json in a contracts PR.
"""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

AI = Path(__file__).resolve().parents[1]
SCHEMA = AI.parent / "contracts" / "schemas" / "basira.schema.json"
OUT = AI / "basira_ai" / "contracts_gen" / "models.py"

HEADER = "# GENERATED from contracts/schemas/basira.schema.json by ai/scripts/gen_contracts.py - do not edit."

ARGS = [
    "--input-file-type", "jsonschema",
    "--output-model-type", "pydantic_v2.BaseModel",
    "--target-python-version", "3.11",
    "--use-standard-collections",
    "--use-union-operator",
    "--use-schema-description",
    "--use-field-description",
    "--field-constraints",
    "--enum-field-as-literal", "all",
    "--disable-timestamp",
    "--custom-file-header", HEADER,
]


def generate(target: Path) -> None:
    subprocess.run(
        [sys.executable, "-m", "datamodel_code_generator", "--input", str(SCHEMA), "--output", str(target), *ARGS],
        check=True,
        env={**os.environ, "PYTHONUTF8": "1"},  # the schema has Arabic text; Windows defaults to cp1252
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d) / "models.py"
            generate(tmp)
            if tmp.read_text(encoding="utf-8") != OUT.read_text(encoding="utf-8"):
                print("contracts_gen/models.py is out of date: run python scripts/gen_contracts.py")
                return 1
        print("contracts_gen/models.py is up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    generate(OUT)
    print(f"wrote {OUT.relative_to(AI)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
