"""Load the two acoustic models (ADR-002) and turn 16 kHz audio into CTC log-posteriors.

Heavy dependencies (torch, transformers, soundfile) are an optional extra: `pip install -e ".[model]"`. They are
imported lazily so the rest of basira_ai (and CI) works without them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from basira_ai.g2p import to_units
from basira_ai.pronunciation import AcousticOutput, UnitEvidence, missing_phone_tokens, routing, score_pronunciation
from basira_ai.reference import ReferenceData, reference_data

SAMPLE_RATE = 16_000


class ModelUnavailable(RuntimeError):
    """The optional model dependencies are not installed, or a model failed to load."""


@dataclass
class CTCModel:
    name: str
    _processor: object = None
    _model: object = None
    _device: str = "cpu"

    def load(self, device: str | None = None) -> CTCModel:
        try:
            import torch
            from transformers import AutoModelForCTC, AutoProcessor
        except ImportError as e:  # pragma: no cover - depends on optional extra
            raise ModelUnavailable('install the model extra: pip install -e ".[model]"') from e
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._processor = AutoProcessor.from_pretrained(self.name)
        self._model = AutoModelForCTC.from_pretrained(self.name).to(self._device).eval()
        return self

    def __call__(self, wav: np.ndarray) -> AcousticOutput:
        import torch

        if self._model is None:
            raise ModelUnavailable(f"{self.name} is not loaded")
        inputs = self._processor(wav, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_values.to(self._device)
        with torch.no_grad():
            logits = self._model(inputs).logits[0]
        tok = self._processor.tokenizer
        return AcousticOutput(torch.log_softmax(logits, -1).cpu().numpy(), tok.get_vocab(), tok.pad_token_id)


class Listener:
    """Both models loaded once; `listen` scores one recording against its known text."""

    def __init__(self, device: str | None = None, ref: ReferenceData | None = None, load_letter_model: bool = True):
        self.ref = ref or reference_data()
        self.phone = CTCModel(routing()["phone_model"]["id"]).load(device)
        missing = missing_phone_tokens(self.phone(np.zeros(SAMPLE_RATE, dtype=np.float32)).vocab)
        if missing:
            raise ModelUnavailable(f"phone model vocabulary lacks routing tokens: {missing}")
        self.letter = CTCModel(routing()["letter_model"]["id"]).load(device) if load_letter_model else None

    def listen(self, wav: np.ndarray, text: str) -> list[UnitEvidence]:
        units = to_units(text, self.ref.taxonomy)
        letter_out = self.letter(wav) if self.letter is not None else None
        return score_pronunciation(text, units, self.phone(wav), letter_out, self.ref)


def load_audio(path: str) -> np.ndarray:
    """Read any audio file as mono float32 at 16 kHz (needs the model extra)."""
    try:
        import librosa
    except ImportError as e:  # pragma: no cover
        raise ModelUnavailable('install the model extra: pip install -e ".[model]"') from e
    wav, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return wav.astype(np.float32)
