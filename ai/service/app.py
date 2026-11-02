"""FastAPI app implementing contracts/scorer.openapi.yaml (only the endpoints that are actually built).

Implemented: GET /health, POST /score-item.
Not registered yet (they return 404 instead of fake data): /fingerprint (A8), /probe (A9), /stage0/score (A10).

Run:  uvicorn service.app:build --factory --host 0.0.0.0 --port 8000   (from ai/)
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import wave
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from basira_ai.contracts_gen import ScoreItemRequestMeta
from basira_ai.contracts_gen.models import (
    FingerprintRequest,
    FingerprintResponse,
    Stage0ScoreRequest,
    Stage0ScoreResponse,
)
from basira_ai.fingerprint import fingerprint
from basira_ai.g2p import G2PError
from basira_ai.pronunciation import routing
from basira_ai.reference import contracts_dir, reference_data
from basira_ai.stage0 import Stage0Error
from basira_ai.stage0 import score as score_stage0
from service.auth import AuthError, JWKSResolver, SecretResolver, Verifier

log = logging.getLogger("basira.scorer")
SAMPLE_RATE = 16_000
MIN_S, MAX_S = 0.3, 15.0
SCORING_ROLES = {"specialist", "examiner", "admin"}
STAGE0_ROLES = {"examiner", "admin"}  # scorer.openapi.yaml: /stage0/score requires examiner or admin


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def contracts_version() -> str:
    title = json.loads((contracts_dir() / "schemas" / "basira.schema.json").read_text(encoding="utf-8"))["title"]
    match = re.search(r"v(\d+\.\d+\.\d+)", title)
    return match.group(1) if match else "unknown"


def decode_wav(data: bytes) -> np.ndarray:
    """Contract audio: WAV, 16 kHz, mono, 16-bit PCM, 0.3-15 s. Anything else is rejected, never resampled silently."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            rate, channels, width, frames = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            raw = w.readframes(frames)
    except (wave.Error, EOFError) as e:
        raise ApiError(422, "audio_invalid", f"not a readable WAV file: {e}") from e
    if (rate, channels, width) != (SAMPLE_RATE, 1, 2):
        got = f"{rate} Hz, {channels} ch, {8 * width}-bit"
        raise ApiError(422, "audio_invalid", f"need 16 kHz mono 16-bit PCM, got {got}")
    seconds = frames / rate
    if not MIN_S <= seconds <= MAX_S:
        raise ApiError(422, "audio_invalid", f"duration {seconds:.2f}s outside {MIN_S}-{MAX_S}s")
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


@dataclass
class RateLimiter:
    per_minute: int
    _hits: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                raise ApiError(429, "rate_limited", f"more than {self.per_minute} requests per minute")
            hits.append(now)


class ModelHolder:
    """Loads the Listener once, in the background, so /health answers 'warming' during a cold start."""

    def __init__(self, factory: Callable[[], object]):
        self._factory, self._listener, self._error = factory, None, None
        self._thread = threading.Thread(target=self._load, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def _load(self) -> None:
        try:
            self._listener = self._factory()
            log.info("models loaded")
        except Exception as e:  # surfaced through /health and 503s, never swallowed
            self._error = e
            log.exception("model loading failed")

    @property
    def status(self) -> str:
        return "ok" if self._listener is not None else ("degraded" if self._error is not None else "warming")

    def get(self):
        if self._listener is None:
            detail = f"model loading failed: {self._error}" if self._error else "models are still loading"
            raise ApiError(503, "model_unavailable", detail)
        return self._listener


def _default_listener():
    from basira_ai.acoustic import Listener

    return Listener(load_letter_model=os.environ.get("LOAD_LETTER_MODEL", "1") != "0")


def _default_verifier() -> Verifier:
    if os.environ.get("SUPABASE_JWKS_URL"):
        return Verifier(JWKSResolver(os.environ["SUPABASE_JWKS_URL"]))
    if os.environ.get("SUPABASE_JWT_SECRET"):
        return Verifier(SecretResolver(os.environ["SUPABASE_JWT_SECRET"]))
    raise RuntimeError("set SUPABASE_JWKS_URL (or the legacy SUPABASE_JWT_SECRET)")


def create_app(
    listener_factory: Callable[[], object] | None = None,
    verifier: Verifier | None = None,
    allowed_origins: list[str] | None = None,
    rate_limit_per_min: int | None = None,
) -> FastAPI:
    holder = ModelHolder(listener_factory or _default_listener)
    auth = verifier or _default_verifier()
    limiter = RateLimiter(rate_limit_per_min or int(os.environ.get("RATE_LIMIT_PER_MIN", "120")))
    origins = allowed_origins
    if origins is None:
        origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        holder.start()
        yield

    app = FastAPI(title="Basira Scorer API", version="0.1.0", docs_url="/docs", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.state.holder = holder

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError) -> JSONResponse:
        return error_response(e.status, e.code, e.message)

    @app.exception_handler(AuthError)
    async def _auth_error(_: Request, e: AuthError) -> JSONResponse:
        return error_response(e.status, e.code, e.message)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, e: RequestValidationError) -> JSONResponse:
        fields = sorted({".".join(str(p) for p in err.get("loc", [])[1:]) for err in e.errors()})
        return error_response(422, "invalid_request", f"invalid or missing fields: {', '.join(fields) or 'request'}")

    def scorer_claims(authorization: Annotated[str | None, Header()] = None) -> dict:
        """Runs before body validation, so an unauthenticated caller always gets 401, never a field error."""
        return auth.require(authorization, SCORING_ROLES)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, e: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return error_response(500, "internal", "internal error (logged)")

    @app.get("/health")
    def health() -> dict:
        r = routing()
        return {
            "status": holder.status,
            "model_loaded": holder.status == "ok",
            "model_version": f"{r['phone_model']['id']}; {r['letter_model']['id']}",
            "rules_version": f"routing {r['version']}",
            "contracts_version": contracts_version(),
        }

    @app.post("/score-item")
    async def score_item(
        audio: Annotated[UploadFile, File()],
        meta: Annotated[str, Form()],
        claims: dict = Depends(scorer_claims),  # noqa: B008 - local dependency; Annotated cannot see it under PEP 563
    ) -> JSONResponse:
        limiter.check(str(claims.get("sub", "anonymous")))
        try:
            request_meta = ScoreItemRequestMeta.model_validate_json(meta)
        except ValidationError as e:
            raise ApiError(422, "invalid_request", f"meta does not match ScoreItemRequestMeta: {e.errors()[:3]}") from e
        wav = decode_wav(await audio.read())
        listener = holder.get()
        try:
            result = listener.score_item(wav, request_meta, synthetic=False)
        except G2PError as e:
            raise ApiError(422, "invalid_request", f"expected_text: {e}") from e
        except KeyError as e:
            raise ApiError(422, "invalid_request", str(e).strip("'\"")) from e
        log.info("scored item %s for %s", request_meta.item_id, claims.get("sub"))
        return JSONResponse(result.model_dump(mode="json", by_alias=True))

    @app.post("/fingerprint")
    async def fingerprint_session(
        request: Request,
        claims: dict = Depends(scorer_claims),  # noqa: B008 - see /score-item
    ) -> JSONResponse:
        limiter.check(str(claims.get("sub", "anonymous")))
        try:
            body = FingerprintRequest.model_validate_json(await request.body())
        except ValidationError as e:
            raise ApiError(422, "invalid_request", f"body does not match FingerprintRequest: {e.errors()[:3]}") from e
        result = fingerprint(body.model_dump(mode="json", by_alias=True), reference_data())
        log.info("fingerprint for session %s by %s: %s", body.session_id, claims.get("sub"),
                 result["referral"]["decision"])
        return JSONResponse(FingerprintResponse.model_validate(result).model_dump(mode="json", by_alias=True))

    def examiner_claims(authorization: Annotated[str | None, Header()] = None) -> dict:
        return auth.require(authorization, STAGE0_ROLES)

    @app.post("/stage0/score")
    async def stage0_score(
        request: Request,
        claims: dict = Depends(examiner_claims),  # noqa: B008 - see /score-item
    ) -> JSONResponse:
        limiter.check(str(claims.get("sub", "anonymous")))
        try:
            body = Stage0ScoreRequest.model_validate_json(await request.body())
        except ValidationError as e:
            raise ApiError(422, "invalid_request", f"body does not match Stage0ScoreRequest: {e.errors()[:3]}") from e
        try:
            result = score_stage0(body.model_dump(mode="json", by_alias=True, exclude_none=True))
        except Stage0Error as e:
            raise ApiError(422, "invalid_request", str(e)) from e
        log.info("stage0 %s/%s by %s: %s", result["construct"], body.instrument_id, claims.get("sub"),
                 result["licence_status"])
        return JSONResponse(Stage0ScoreResponse.model_validate(result).model_dump(mode="json", by_alias=True))

    return app


def build() -> FastAPI:
    """uvicorn factory: configuration comes from environment variables (see .env.example)."""
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    os.environ.setdefault("BASIRA_CONTRACTS_DIR", str(Path(__file__).resolve().parents[2] / "contracts"))
    return create_app()
