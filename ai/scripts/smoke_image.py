"""Smoke test of the scorer image running under docker compose (task A6). From the repo root:

    # .env holds SUPABASE_JWT_SECRET=<random throwaway value>, and the same value is exported in this shell
    docker compose -f ai/compose.yaml up --build -d
    python ai/scripts/smoke_image.py

Signs a short-lived specialist token with that throwaway secret (no Supabase project is involved, so this does not
prove hosted sign-in), runs check_hosted.py with a real item clip, then checks the service wrote a JSON log line. The
clip is synthetic TTS from content/dist/audio; this tests that the image works, not how accurate the scoring is.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import jwt

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-f", str(ROOT / "ai" / "compose.yaml")]
# Runs inside the image: the runner needs no audio tools, and the image's own librosa + soundfile get exercised
TO_WAV = (
    "import io, sys, librosa, soundfile as sf; "
    "y, _ = librosa.load(io.BytesIO(sys.stdin.buffer.read()), sr=16000, mono=True); "
    "out = io.BytesIO(); sf.write(out, y, 16000, format='WAV', subtype='PCM_16'); "
    "sys.stdout.buffer.write(out.getvalue())"
)


def mint_token(secret: str, now: float) -> str:
    claims = {"sub": "smoke-test", "aud": "authenticated", "exp": int(now) + 3600, "app_role": "specialist"}
    return jwt.encode(claims, secret, algorithm="HS256")


def pick_item(bank: dict) -> dict:
    """The first approved real word: long enough to pass the audio duration check, unlike a single letter sound."""
    return next(i for i in bank["items"] if i["type"] == "real_word" and i["review"]["status"] == "approved")


def has_json_log_line(logs: str, event: str) -> bool:
    for line in logs.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("event") == event:
            return True
    return False


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from check_hosted import main as check_hosted

    os.environ["SCORER_TEST_TOKEN"] = mint_token(os.environ["SUPABASE_JWT_SECRET"], time.time())
    bank = json.loads((ROOT / "content" / "dist" / "item-bank.json").read_text(encoding="utf-8"))
    item = pick_item(bank)
    fixture = ROOT / "contracts" / "fixtures" / "ScoreItemRequestMeta.example.json"
    meta = json.loads(fixture.read_text(encoding="utf-8")) | {
        "item_id": item["id"], "item_type": item["type"], "expected_text": item["text"],
    }
    mp3 = (ROOT / "content" / "dist" / item["audio_path"]).read_bytes()
    wav = subprocess.run([*COMPOSE, "exec", "-T", "scorer", "python", "-c", TO_WAV],
                         input=mp3, stdout=subprocess.PIPE, check=True).stdout

    with tempfile.TemporaryDirectory() as folder:
        clip, meta_file = Path(folder) / "clip.wav", Path(folder) / "meta.json"
        clip.write_bytes(wav)
        meta_file.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        print(f"Using synthetic TTS clip of item {item['id']}")
        failed = check_hosted(["http://localhost:8000", "--wait", "1200",
                               "--speech-clip", str(clip), "--speech-meta", str(meta_file)])

    logs = subprocess.run([*COMPOSE, "logs", "--no-log-prefix", "scorer"],
                          capture_output=True, encoding="utf-8", errors="replace", check=True).stdout
    if not has_json_log_line(logs, "score_item"):
        print("FAIL  no JSON log line with event=score_item")
        return 1
    print("PASS  scoring wrote a JSON log line")
    return failed


if __name__ == "__main__":
    sys.exit(main())
