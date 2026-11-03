"""A13 hosting tools: the hosted-contract checker against a real HTTP server, and the Space staging."""

import importlib.util
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from test_service import KEY, PerfectReader, token

from service.app import create_app
from service.auth import Verifier

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def server():
    app = create_app(
        listener_factory=PerfectReader,
        verifier=Verifier(lambda _token: (KEY.public_key(), ["ES256"])),
        allowed_origins=["http://localhost:5173"],
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    for _ in range(200):
        if srv.started:
            break
        time.sleep(0.025)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    thread.join(5)


def test_checker_passes_against_the_real_service(server, monkeypatch, capsys):
    monkeypatch.setenv("SCORER_TEST_TOKEN", token(role="examiner").removeprefix("Bearer "))
    assert load("check_hosted").main([server, "--wait", "10"]) == 0, capsys.readouterr().out
    out = capsys.readouterr().out
    assert "FAIL" not in out and "SKIP" not in out and "ALL CHECKS PASSED" in out


def test_checker_fails_when_the_origin_is_not_allowed(server, monkeypatch, capsys):
    monkeypatch.delenv("SCORER_TEST_TOKEN", raising=False)
    assert load("check_hosted").main([server, "--origin", "https://not-listed.example", "--wait", "10"]) == 1
    assert "FAIL  CORS allows https://not-listed.example" in capsys.readouterr().out


def test_space_staging_matches_the_docker_context(tmp_path):
    load("deploy_hf_space").stage(tmp_path)
    assert (tmp_path / "Dockerfile").read_bytes() == (SCRIPTS.parent / "Dockerfile").read_bytes()
    card = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert "sdk: docker" in card and "app_port: 8000" in card
    for rel in ("ai/pyproject.toml", "ai/basira_ai/data/referral-table.json", "ai/service/app.py",
                "contracts/schemas/basira.schema.json"):
        assert (tmp_path / rel).is_file(), rel
    staged = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert not [p for p in staged if "__pycache__" in p.parts or p.suffix == ".pyc" or "tests" in p.parts]
