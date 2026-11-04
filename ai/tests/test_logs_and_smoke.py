"""A6: structured logs, and the helpers of the Docker image smoke test (the image itself is tested in CI)."""

import importlib.util
import json
import logging
import sys
import time
from pathlib import Path

from service.auth import SecretResolver, Verifier
from service.logs import JsonFormatter

ROOT = Path(__file__).resolve().parents[2]


def smoke():
    spec = importlib.util.spec_from_file_location("smoke_image", ROOT / "ai" / "scripts" / "smoke_image.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["smoke_image"] = module
    spec.loader.exec_module(module)
    return module


def record(message="scored item", exc_info=None, **extra):
    r = logging.LogRecord("basira.scorer", logging.INFO, __file__, 1, message, None, exc_info)
    r.__dict__.update(extra)
    return r


def test_log_line_is_json_with_the_listed_fields_only():
    line = JsonFormatter().format(record(event="score_item", item_id="rw-1", user="u1", audio="must-not-appear"))
    entry = json.loads(line)
    assert "\n" not in line
    assert entry["level"] == "INFO" and entry["logger"] == "basira.scorer" and entry["message"] == "scored item"
    assert (entry["event"], entry["item_id"], entry["user"]) == ("score_item", "rw-1", "u1")
    assert "audio" not in entry and "must-not-appear" not in line


def test_exception_stays_on_one_json_line():
    try:
        raise ValueError("boom")
    except ValueError:
        line = JsonFormatter().format(record("unhandled error", exc_info=sys.exc_info()))
    assert "\n" not in line and "ValueError: boom" in json.loads(line)["exception"]


def test_arabic_is_readable_in_a_log_line():
    assert "خ" in JsonFormatter().format(record("خ"))


def test_minted_token_passes_the_service_verifier_as_a_scoring_role():
    secret = "test-only-not-a-real-secret-32-bytes-long"
    bearer = f"Bearer {smoke().mint_token(secret, time.time())}"
    assert Verifier(SecretResolver(secret)).require(bearer, {"specialist"})["sub"] == "smoke-test"


def test_smoke_item_is_an_approved_real_word_with_a_clip_on_disk():
    bank = json.loads((ROOT / "content" / "dist" / "item-bank.json").read_text(encoding="utf-8"))
    item = smoke().pick_item(bank)
    assert item["type"] == "real_word" and item["review"]["status"] == "approved"
    assert (ROOT / "content" / "dist" / item["audio_path"]).is_file()


def test_log_check_needs_a_json_line_with_the_event():
    has = smoke().has_json_log_line
    assert has('INFO: started\n{"event": "score_item"}\n', "score_item")
    assert not has('{"event": "probe"}\n[1, 2]\nscore_item\n', "score_item")
