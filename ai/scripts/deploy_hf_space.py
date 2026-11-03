"""Deploy the scorer to a Hugging Face Docker Space (task A13).

Stages exactly what ai/Dockerfile.dockerignore lets into the image (ai/pyproject.toml, ai/basira_ai, ai/service,
contracts/), puts ai/Dockerfile at the Space root with a Space card, and mirrors it to the Space. Hugging Face then
builds the image itself, so nothing heavy runs on this machine.

Usage (from the repo root):
    HF_TOKEN=hf_... python ai/scripts/deploy_hf_space.py --space <user>/basira-scorer \
        --jwks-url https://<project>.supabase.co/auth/v1/.well-known/jwks.json \
        --allowed-origins https://basira.pages.dev,http://localhost:5173

The Space is public (the web app calls it without a Hugging Face token); every scoring endpoint still requires a
Supabase access token, so public only means "reachable", as for any API.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INCLUDE = ["ai/pyproject.toml", "ai/basira_ai", "ai/service", "contracts"]
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info")

CARD = """---
title: Basira Scorer
emoji: 📖
colorFrom: green
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
license: apache-2.0
short_description: Stateless Arabic reading scorer for the Basira app (API only)
---

# Basira scorer (API only)

Deployed from [DXstr/Kuwait-Dyslexia](https://github.com/DXstr/Kuwait-Dyslexia) by `ai/scripts/deploy_hf_space.py`.
Do not edit files here; change the repository and redeploy.

- `GET /health` is public. Every other endpoint needs a Supabase access token with an allowed `app_role`.
- Stateless: audio is scored in memory and never stored (ADR-001).
- Models: facebook/wav2vec2-xlsr-53-espeak-cv-ft and jonatasgrosman/wav2vec2-large-xlsr-53-arabic (Apache-2.0).
"""


def stage(dest: Path) -> None:
    for rel in INCLUDE:
        src = ROOT / rel
        if src.is_dir():
            shutil.copytree(src, dest / rel, ignore=SKIP)
        else:
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest / rel)
    shutil.copy2(ROOT / "ai" / "Dockerfile", dest / "Dockerfile")
    (dest / "README.md").write_text(CARD, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--space", required=True, help="<hf-user>/<space-name>")
    p.add_argument("--jwks-url", default=os.environ.get("SUPABASE_JWKS_URL"), help="Supabase JWKS URL (public)")
    p.add_argument("--allowed-origins", default=os.environ.get("ALLOWED_ORIGINS"), help="comma-separated origins")
    p.add_argument("--dry-run", action="store_true", help="stage into ./space-preview and stop")
    a = p.parse_args(argv)

    if a.dry_run:
        out = Path("space-preview")
        shutil.rmtree(out, ignore_errors=True)
        stage(out)
        print(f"staged into {out.resolve()}")
        return 0

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("set HF_TOKEN (a Hugging Face token with write access)", file=sys.stderr)
        return 2
    from huggingface_hub import HfApi

    api = HfApi(token=token)
    api.create_repo(a.space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
    # configuration is not secret: the JWKS URL and origins are public values, so they are Space variables
    for key, value in (("SUPABASE_JWKS_URL", a.jwks_url), ("ALLOWED_ORIGINS", a.allowed_origins)):
        if value:
            api.add_space_variable(a.space, key, value)
    with tempfile.TemporaryDirectory() as tmp:
        stage(Path(tmp))
        info = api.upload_folder(
            repo_id=a.space, repo_type="space", folder_path=tmp, delete_patterns="*",
            commit_message=f"deploy from {os.environ.get('GITHUB_SHA', 'local')[:12]}",
        )
    user, name = a.space.split("/", 1)
    print(f"pushed {info.oid[:12]}; build log: https://huggingface.co/spaces/{a.space}")
    print(f"API URL: https://{user.lower()}-{name.lower().replace('_', '-')}.hf.space")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
