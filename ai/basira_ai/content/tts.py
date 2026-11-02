"""Pre-rendered item audio (offline, at build time). All of it is TTS: the bank carries synthetic_audio = true.

Engines are chosen explicitly; there is no silent fallback. Secrets come from environment variables only.
"""

from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.request
from typing import Protocol
from xml.sax.saxutils import escape


class TTSError(RuntimeError):
    pass


class TTSEngine(Protocol):
    name: str
    voice: str
    extension: str

    def synthesize(self, text: str) -> bytes: ...


def cache_key(engine: TTSEngine, text: str) -> str:
    settings = getattr(engine, "settings", "")
    return hashlib.sha256(f"{engine.name}|{engine.voice}|{settings}|{text}".encode()).hexdigest()


# team choice after listening tests on 2026-11-02: plain text (the voice reads the vowelled text itself; exact-IPA
# phoneme tags were tried and not preferred), Microsoft Tuning panel pitch 1.09, rate 0.8, volume 1
DEFAULT_VOICE = "ar-YE-MaryamNeural"
DEFAULT_PITCH = "+9%"
DEFAULT_RATE = "-20%"
OUTPUT_FORMAT = "audio-48khz-192kbitrate-mono-mp3"


class AzureTTS:
    """Azure AI Speech REST API (no SDK).

    Env: AZURE_SPEECH_KEY, plus either AZURE_SPEECH_ENDPOINT (an AI Foundry / AI services resource, e.g.
    https://<name>.cognitiveservices.azure.com/) or AZURE_SPEECH_REGION (a plain Speech resource, e.g. uaenorth).
    Optional: AZURE_TTS_VOICE (default ar-YE-MaryamNeural, team choice),
    AZURE_TTS_LOCALE (default ar-SA for a multilingual
    voice, else the voice's own locale).
    """

    name = "azure-speech"
    extension = "mp3"

    def __init__(
        self,
        voice: str | None = None,
        locale: str | None = None,
        pitch: str = DEFAULT_PITCH,
        rate: str = DEFAULT_RATE,
    ) -> None:
        self.key = os.environ.get("AZURE_SPEECH_KEY")
        endpoint = os.environ.get("AZURE_SPEECH_ENDPOINT")
        region = os.environ.get("AZURE_SPEECH_REGION")
        if not self.key or not (endpoint or region):
            raise TTSError("set AZURE_SPEECH_KEY and AZURE_SPEECH_ENDPOINT (or AZURE_SPEECH_REGION) to render audio")
        self.url = (
            f"{endpoint.rstrip('/')}/tts/cognitiveservices/v1"
            if endpoint
            else f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
        )
        self.voice = voice or os.environ.get("AZURE_TTS_VOICE") or DEFAULT_VOICE
        own = "-".join(self.voice.split("-")[:2])
        multilingual = "Multilingual" in self.voice
        self.locale = locale or os.environ.get("AZURE_TTS_LOCALE") or ("ar-SA" if multilingual else own)
        self._wrap_lang = self.locale != own
        self.pitch = pitch
        self.rate = rate
        self.settings = f"{self.locale}|{pitch}|{rate}|{OUTPUT_FORMAT}"

    def ssml(self, text: str) -> str:
        body = f'<prosody pitch="{self.pitch}" rate="{self.rate}">{escape(text)}</prosody>'
        if self._wrap_lang:  # a multilingual voice must be told which language to speak
            body = f'<lang xml:lang="{self.locale}">{body}</lang>'
        return f'<speak version="1.0" xml:lang="{self.locale}"><voice name="{self.voice}">{body}</voice></speak>'

    def synthesize(self, text: str) -> bytes:
        req = urllib.request.Request(
            self.url,
            data=self.ssml(text).encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": self.key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
                "User-Agent": "basira-content-pipeline",
            },
            method="POST",
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return resp.read()
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 4:  # throttled: back off and retry
                    time.sleep(2 ** attempt * 3)
                    continue
                raise TTSError(f"Azure TTS failed for {text[:30]!r}: HTTP {exc.code}") from exc
            except OSError as exc:
                raise TTSError(f"Azure TTS failed for {text[:30]!r}: {exc}") from exc
        raise TTSError("unreachable")


ENGINES = {"azure": AzureTTS}


def make_engine(name: str) -> TTSEngine:
    try:
        return ENGINES[name]()
    except KeyError:
        raise TTSError(f"unknown TTS engine {name!r}; choose one of {sorted(ENGINES)}") from None
