"""CLI: python -m basira_ai.content build [--audio azure] [--generated-at ISO]"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from basira_ai.content.build import build, content_dir
from basira_ai.content.tts import make_engine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m basira_ai.content")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build content/dist/item-bank.json")
    b.add_argument("--audio", choices=["azure"], default=None, help="render item audio with this TTS engine")
    b.add_argument("--generated-at", default=None, help="ISO timestamp to stamp (default: now)")
    args = parser.parse_args(argv)

    root = content_dir()
    engine = make_engine(args.audio) if args.audio else None
    when = datetime.fromisoformat(args.generated_at.replace("Z", "+00:00")) if args.generated_at else None
    result = build(root / "dist", engine=engine, generated_at=when)
    report_path = root / "reports" / "build-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result.report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    r = result.report
    print(f"accepted {r['accepted_total']} {r['accepted']}; rejected {r['rejected_total']}; audio {r['audio']}")
    for rej in r["rejected"]:
        print(f"  rejected [{rej['type']}] {rej['text'][:40]} -> {rej['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
