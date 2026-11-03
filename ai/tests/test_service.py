"""Scorer HTTP service against the contract: auth, roles, rate limit, audio validation, error format, health."""

import io
import json
import time
import wave
from pathlib import Path

import jwt
import numpy as np
import pytest
from _synthetic import PHONE_VOCAB, REF, frames, phones_for
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from basira_ai.g2p import to_units
from basira_ai.pronunciation import score_pronunciation
from basira_ai.verdict import build_response
from service.app import create_app, decode_wav
from service.auth import Verifier

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "contracts/schemas/basira.schema.json").read_text("utf-8"))
REGISTRY = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def valid(definition: str, payload: dict) -> list[str]:
    v = Draft202012Validator({"$ref": f"{SCHEMA['$id']}#/$defs/{definition}"}, registry=REGISTRY)
    return [e.message for e in v.iter_errors(payload)]


def token(role="specialist", key=KEY, exp_in=300, sub="user-1"):
    claims = {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + exp_in, "app_role": role}
    return "Bearer " + jwt.encode(claims, key, algorithm="ES256")


class PerfectReader:
    """Test stand-in for Listener: real verdict code on synthetic posteriors of a perfect reading."""

    def score_item(self, wav, meta, *, synthetic):
        units = to_units(meta.expected_text, REF.taxonomy)
        phone = frames(phones_for(meta.expected_text), PHONE_VOCAB)
        ev = score_pronunciation(meta.expected_text, units, phone, None, REF)
        return build_response(meta, units, ev, REF, audio_duration_ms=int(len(wav) / 16), synthetic=synthetic)


def wav_bytes(seconds=1.0, rate=16000, channels=1, width=2, amplitude=0.2):
    n = int(seconds * rate)
    samples = (amplitude * 32767 * np.sin(np.linspace(0, 200 * np.pi, n))).astype("<i2")
    if channels == 2:
        samples = np.repeat(samples, 2)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(samples.tobytes() if width == 2 else (samples // 256).astype("i1").tobytes())
    return buf.getvalue()


META = json.dumps({"item_id": "rw-0001", "item_type": "real_word", "expected_text": "قَلَم", "dialect_lexicon_id": "kw"})


@pytest.fixture
def client():
    app = create_app(
        listener_factory=PerfectReader,
        verifier=Verifier(lambda _token: (KEY.public_key(), ["ES256"])),
        allowed_origins=["http://localhost:5173"],
        rate_limit_per_min=5,
    )
    with TestClient(app) as c:
        for _ in range(100):
            if c.get("/health").json()["status"] == "ok":
                break
            time.sleep(0.01)
        yield c


def post(client, auth=None, audio=None, meta=META):
    headers = {"Authorization": auth} if auth else {}
    files = {"audio": ("a.wav", audio if audio is not None else wav_bytes(), "audio/wav")}
    return client.post("/score-item", headers=headers, files=files, data={"meta": meta})


def test_health_needs_no_auth_and_matches_contract(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["contracts_version"] == "0.4.0"
    assert valid("Health", r.json()) == []


def test_score_item_success_matches_contract(client):
    r = post(client, token())
    assert r.status_code == 200, r.text
    body = r.json()
    assert valid("ScoreItemResponse", body) == []
    assert body["item_id"] == "rw-0001" and body["synthetic"] is False
    assert body["words"][0]["correct"] is True


@pytest.mark.parametrize(
    "auth, status, code",
    [
        (None, 401, "unauthorized"),
        ("Basic abc", 401, "unauthorized"),
        (token(key=OTHER_KEY), 401, "unauthorized"),  # wrong signing key
        (token(exp_in=-10), 401, "unauthorized"),  # expired
        (token(role="guardian"), 403, "forbidden"),  # parents cannot call the scorer
        (token(role=None), 403, "forbidden"),
    ],
)
def test_auth_failures_use_contract_error_format(client, auth, status, code):
    r = post(client, auth)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert valid("Error", r.json()) == []


@pytest.mark.parametrize("role", ["specialist", "examiner", "admin"])
def test_allowed_roles(client, role):
    assert post(client, token(role=role, sub=role)).status_code == 200


def test_rate_limit_per_user(client):
    for _ in range(5):
        assert post(client, token(sub="busy")).status_code == 200
    r = post(client, token(sub="busy"))
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    assert post(client, token(sub="someone-else")).status_code == 200


@pytest.mark.parametrize(
    "audio",
    [
        b"not audio",
        wav_bytes(rate=44100),
        wav_bytes(channels=2),
        wav_bytes(seconds=0.1),
        wav_bytes(seconds=16),
    ],
    ids=["garbage", "44khz", "stereo", "too-short", "too-long"],
)
def test_bad_audio_is_rejected_not_resampled(client, audio):
    r = post(client, token(sub="audio"), audio=audio)
    assert r.status_code == 422 and r.json()["error"]["code"] == "audio_invalid"


@pytest.mark.parametrize(
    "meta",
    [
        "not json",
        json.dumps({"item_id": "x"}),
        json.dumps({"item_id": "x", "item_type": "real_word", "expected_text": "hello", "dialect_lexicon_id": "kw"}),
        json.dumps({"item_id": "x", "item_type": "real_word", "expected_text": "قَلَم", "dialect_lexicon_id": "zz"}),
    ],
    ids=["not-json", "missing-fields", "non-arabic-text", "unknown-lexicon"],
)
def test_bad_meta_is_invalid_request(client, meta):
    r = post(client, token(sub="meta"), meta=meta)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_cors_allows_only_configured_origin(client):
    def preflight(origin):
        return client.options("/score-item", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})

    ok, bad = preflight("http://localhost:5173"), preflight("https://evil.example")
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_warming_returns_503_until_models_load():
    import threading

    gate = threading.Event()

    def slow_factory():
        gate.wait(5)
        return PerfectReader()

    app = create_app(listener_factory=slow_factory, verifier=Verifier(lambda _t: (KEY.public_key(), ["ES256"])))
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "warming"
        r = post(c, token())
        assert r.status_code == 503 and r.json()["error"]["code"] == "model_unavailable"
        gate.set()


def test_decode_wav_scales_to_unit_range():
    wav = decode_wav(wav_bytes(amplitude=0.5))
    assert wav.dtype == np.float32 and 0.45 < np.abs(wav).max() <= 0.5


def test_missing_token_is_401_even_when_the_body_is_empty(client):
    r = client.post("/score-item")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"


def test_missing_upload_is_contract_invalid_request(client):
    r = client.post("/score-item", headers={"Authorization": token(sub="empty")}, data={"meta": META})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    assert "audio" in r.json()["error"]["message"]
    assert valid("Error", r.json()) == []
