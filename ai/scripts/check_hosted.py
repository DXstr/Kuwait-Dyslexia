"""Contract checks against a running scorer (task A13): the hosted Space, Cloud Run or docker compose.

    python ai/scripts/check_hosted.py https://<user>-basira-scorer.hf.space --origin http://localhost:5173

Without a token it checks what any caller can see: /health matches the Health schema (waiting through a cold start
until the models are loaded), every scoring endpoint rejects missing and forged tokens with the contract Error shape,
and CORS answers only the allowed origin. With SCORER_TEST_TOKEN (a real Supabase access token of a specialist or
examiner demo account) it also calls /fingerprint with the contract fixture and /score-item with one second of
silence, and validates those responses. --speech-clip adds /score-item with a real recording, which must return 200.
Exit code 0 only if every check passed. Standard library + jsonschema.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import wave
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA = json.loads((CONTRACTS / "schemas" / "basira.schema.json").read_text(encoding="utf-8"))
REGISTRY = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))
def b64(obj: dict | str) -> str:
    raw = obj.encode() if isinstance(obj, str) else json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# well-formed token with a signature Supabase never made; built at runtime so no token literal sits in the repo
FORGED = ".".join([b64({"alg": "HS256", "typ": "JWT"}),
                   b64({"sub": "forged", "aud": "authenticated", "exp": 4102444800, "app_role": "admin"}),
                   b64("not-a-signature")])


def schema_errors(definition: str, payload: object) -> list[str]:
    v = Draft202012Validator({"$ref": f"{SCHEMA['$id']}#/$defs/{definition}"}, registry=REGISTRY)
    return [e.message for e in v.iter_errors(payload)]


def call(url: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None, timeout: float = 60):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def multipart(fields: dict[str, tuple[str | None, str, bytes]]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for name, (filename, ctype, data) in fields.items():
        disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        out.write(f"--{boundary}\r\nContent-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n".encode())
        out.write(data + b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def silence_wav(seconds: float = 1.0, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


class Checks:
    def __init__(self) -> None:
        self.failed = 0

    def __call__(self, name: str, ok: bool, detail: str = "") -> bool:
        self.failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
        return ok


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("base_url")
    p.add_argument("--origin", default="http://localhost:5173", help="an origin listed in ALLOWED_ORIGINS")
    p.add_argument("--wait", type=float, default=900, help="seconds to wait for a cold start (default 900)")
    p.add_argument("--proxy-echoes-cors", action="store_true",
                   help="the host's proxy echoes any Origin before the app sees it (Hugging Face Spaces)")
    p.add_argument("--speech-clip", type=Path, help="16 kHz mono 16-bit WAV of speech; needs SCORER_TEST_TOKEN")
    p.add_argument("--speech-meta", type=Path, help="ScoreItemRequestMeta JSON for --speech-clip")
    a = p.parse_args(argv)
    if bool(a.speech_clip) != bool(a.speech_meta):
        p.error("--speech-clip and --speech-meta go together")
    base = a.base_url.rstrip("/")
    check = Checks()

    # 1. health, waiting through a sleeping Space's rebuild + model load
    deadline, health = time.monotonic() + a.wait, None
    while True:
        try:
            status, _, body = call(f"{base}/health", timeout=30)
            health = json.loads(body) if status == 200 else None
        except (OSError, ValueError):
            status, health = 0, None
        if (health and health.get("model_loaded")) or time.monotonic() > deadline:
            break
        print(f"waiting: /health -> {status} {health.get('status') if health else ''}".rstrip())
        time.sleep(20)
    if check("GET /health is 200", health is not None, f"last status {status}"):
        check("/health matches Health schema", not (errs := schema_errors("Health", health)), "; ".join(errs[:3]))
        check("models loaded", bool(health.get("model_loaded")), f"status={health.get('status')}")
        print(f"      versions: {health.get('model_version')} | {health.get('rules_version')} | "
              f"contracts {health.get('contracts_version')}")

    # 2. auth: missing and forged tokens get the contract Error with 401, before any body validation
    meta = (CONTRACTS / "fixtures" / "ScoreItemRequestMeta.example.json").read_bytes()
    form, ctype = multipart({"audio": ("a.wav", "audio/wav", silence_wav()), "meta": (None, "application/json", meta)})
    fp = (CONTRACTS / "fixtures" / "FingerprintRequest.example.json").read_bytes()
    targets = [("/score-item", form, ctype), ("/fingerprint", fp, "application/json")]
    for path, body, ct in targets:
        for label, auth in (("no token", None), ("forged token", f"Bearer {FORGED}")):
            headers = {"Content-Type": ct} | ({"Authorization": auth} if auth else {})
            status, _, raw = call(f"{base}{path}", "POST", body, headers)
            try:
                errs = schema_errors("Error", json.loads(raw))
            except ValueError:
                errs = ["not JSON"]
            check(f"POST {path} with {label} -> 401 Error", status == 401 and not errs, f"{status} {errs[:2]}")

    # 3. CORS: the allowed origin is echoed, a foreign one is not
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
    _, h, _ = call(f"{base}/score-item", "OPTIONS", headers=pre | {"Origin": a.origin})
    got = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    check(f"CORS allows {a.origin}", got == a.origin, f"got {got!r}; is it in ALLOWED_ORIGINS?")
    _, h, _ = call(f"{base}/score-item", "OPTIONS", headers=pre | {"Origin": "https://evil.example"})
    got = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    if a.proxy_echoes_cors:
        print(f"NOTE  not enforced on this host: its proxy answered a foreign origin with {got!r}. "
              "Browsers from any site can reach the API; only the Supabase bearer token protects it.")
    else:
        check("CORS refuses a foreign origin", got is None, f"got {got!r}")

    # 4. optional authenticated calls with a real demo-account token
    token = os.environ.get("SCORER_TEST_TOKEN")
    if not token:
        print("SKIP  authenticated calls (set SCORER_TEST_TOKEN to a specialist/examiner demo token)")
        if a.speech_clip:
            check("POST /score-item (speech clip)", False, "--speech-clip needs SCORER_TEST_TOKEN")
    else:
        auth = {"Authorization": f"Bearer {token}"}
        status, _, raw = call(f"{base}/fingerprint", "POST", fp, auth | {"Content-Type": "application/json"})
        body = json.loads(raw)
        defn = "FingerprintResponse" if status == 200 else "Error"
        check("POST /fingerprint (fixture) -> 200 FingerprintResponse", status == 200 and not schema_errors(defn, body),
              f"{status} {body}")
        status, _, raw = call(f"{base}/score-item", "POST", form, auth | {"Content-Type": ctype}, timeout=120)
        body = json.loads(raw)
        defn = "ScoreItemResponse" if status == 200 else "Error"
        check(f"POST /score-item (1 s silence) -> {status} valid {defn}", status in (200, 422) and
              not schema_errors(defn, body), f"{status} {schema_errors(defn, body)[:2]}")
        if a.speech_clip:
            clip = {"audio": ("clip.wav", "audio/wav", a.speech_clip.read_bytes()),
                    "meta": (None, "application/json", a.speech_meta.read_bytes())}
            form, ctype = multipart(clip)
            started = time.monotonic()
            status, _, raw = call(f"{base}/score-item", "POST", form, auth | {"Content-Type": ctype}, timeout=300)
            seconds, body = time.monotonic() - started, json.loads(raw)
            errs = schema_errors("ScoreItemResponse" if status == 200 else "Error", body)
            check("POST /score-item (speech clip) -> 200 valid ScoreItemResponse", status == 200 and not errs,
                  f"{status} {errs[:2] or body}")
            print(f"      speech clip scored in {seconds:.1f} s on this host")

    print(f"\n{'ALL CHECKS PASSED' if not check.failed else f'{check.failed} CHECK(S) FAILED'} for {base}")
    return 1 if check.failed else 0


if __name__ == "__main__":
    sys.exit(main())
