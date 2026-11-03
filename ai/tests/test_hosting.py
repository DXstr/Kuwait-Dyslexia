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
ROOT_CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


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


def test_docker_staging_matches_the_docker_context(tmp_path):
    load("deploy_hf_space").stage(tmp_path, "docker")
    assert (tmp_path / "Dockerfile").read_bytes() == (SCRIPTS.parent / "Dockerfile").read_bytes()
    card = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert "sdk: docker" in card and "app_port: 8000" in card
    _assert_payload(tmp_path)


def test_gradio_staging_is_the_free_zerogpu_route(tmp_path):
    load("deploy_hf_space").stage(tmp_path)
    card = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert "sdk: gradio" in card and "app_file: app.py" in card and 'python_version: "3.12"' in card
    assert 'sdk_version: "5.' in card  # 6.x cannot resolve with transformers<5 (huggingface_hub)
    # uvicorn never calls Blocks.launch(), so the app must send ZeroGPU's startup report itself
    assert "spaces.zero.startup()" in (tmp_path / "app.py").read_text(encoding="utf-8")
    reqs = (tmp_path / "requirements.txt").read_text(encoding="utf-8")
    assert "torch==2.8.0" in reqs  # ZeroGPU supports torch 2.8.0 and later only
    assert not (tmp_path / "Dockerfile").exists()
    _assert_payload(tmp_path)


def test_generated_space_app_serves_the_unchanged_rest_api(tmp_path, monkeypatch):
    """Run the staged app.py with a stand-in gradio module: FastAPI routes stay, / redirects to /docs."""
    import types

    from fastapi.testclient import TestClient

    load("deploy_hf_space").stage(tmp_path)
    fake = types.ModuleType("gradio")

    class Blocks:
        def __init__(self, **_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    fake.Blocks, fake.Markdown = Blocks, lambda *_a, **_k: None
    fake.mount_gradio_app = lambda api, _blocks, path: api
    monkeypatch.setitem(sys.modules, "gradio", fake)
    fake_spaces = types.ModuleType("spaces")
    gpu_functions = []
    fake_spaces.GPU = lambda **_: lambda fn: gpu_functions.append(fn) or fn
    monkeypatch.setitem(sys.modules, "spaces", fake_spaces)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-only-not-a-real-secret")
    # app.py sets these for the Space; patch them here so they are restored for the tests that run after this one
    monkeypatch.setenv("BASIRA_CONTRACTS_DIR", str(ROOT_CONTRACTS))
    monkeypatch.setenv("BASIRA_DEVICE", "")  # records the original value so it is restored afterwards
    monkeypatch.delenv("BASIRA_DEVICE")
    monkeypatch.setattr(sys, "path", list(sys.path))
    spec = importlib.util.spec_from_file_location("space_app", tmp_path / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert len(gpu_functions) == 1  # ZeroGPU needs one at startup; scoring itself stays on the CPU
    assert module.os.environ["BASIRA_DEVICE"] == "cpu"  # ZeroGPU reports CUDA as available, so never auto-detect
    paths = {r.path for r in module.app.routes}
    assert {"/health", "/score-item", "/fingerprint", "/probe"} <= paths
    with TestClient(module.app) as c:
        assert c.get("/", follow_redirects=False).headers["location"] == "/docs"
        assert c.post("/score-item").status_code == 401


def test_space_cards_pass_the_hub_description_limit():
    for card in load("deploy_hf_space").CARD.values():
        line = next(x for x in card.splitlines() if x.startswith("short_description:"))
        assert len(line.split(":", 1)[1].strip()) <= 60


def test_deploy_refuses_without_token_or_verifier(monkeypatch, capsys):
    deploy = load("deploy_hf_space")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert deploy.main(["--space", "u/basira-scorer"]) == 2
    monkeypatch.setenv("HF_TOKEN", "hf_placeholder")
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    assert deploy.main(["--space", "u/basira-scorer"]) == 2
    assert "jwks" in capsys.readouterr().err.lower()
    assert deploy.space_url("DXstr/Basira_Scorer") == "https://dxstr-basira-scorer.hf.space"


def _assert_payload(root):
    for rel in ("ai/pyproject.toml", "ai/basira_ai/data/referral-table.json", "ai/service/app.py",
                "contracts/schemas/basira.schema.json"):
        assert (root / rel).is_file(), rel
    staged = [p for p in root.rglob("*") if p.is_file()]
    assert not [p for p in staged if "__pycache__" in p.parts or p.suffix == ".pyc" or "tests" in p.parts]
