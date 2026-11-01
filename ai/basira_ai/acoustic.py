"""Load the two acoustic models (ADR-002) and turn 16 kHz audio into CTC log-posteriors.

Heavy dependencies (torch, transformers, soundfile) are an optional extra: `pip install -e ".[model]"`. They are
imported lazily so the rest of basira_ai (and CI) works without them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np

from basira_ai.contracts_gen import ScoreItemRequestMeta, ScoreItemResponse
from basira_ai.g2p import to_units
from basira_ai.pronunciation import AcousticOutput, UnitEvidence, missing_phone_tokens, routing, score_pronunciation
from basira_ai.reference import ReferenceData, reference_data
from basira_ai.verdict import audio_warnings, build_response

SAMPLE_RATE = 16_000


class ModelUnavailable(RuntimeError):
    """The optional model dependencies are not installed, or a model failed to load."""


def read_vocab(path: str) -> dict[str, int]:
    """A CTC vocab.json: flat {token: id}, or nested by language (first language is used)."""
    with open(path, encoding="utf-8") as f:
        vocab = json.load(f)
    if vocab and all(isinstance(v, dict) for v in vocab.values()):
        vocab = next(iter(vocab.values()))
    return {str(k): int(v) for k, v in vocab.items()}


@dataclass
class CTCModel:
    """Feature extractor + CTC model + vocabulary. Deliberately no tokenizer: the phoneme model's tokenizer requires
    phonemizer (GPL-3.0), which Basira does not use (ADR-002); only the vocabulary file is needed."""

    name: str
    _features: object = None
    _model: object = None
    _device: str = "cpu"
    vocab: dict[str, int] = field(default_factory=dict)
    blank: int = 0

    def load(self, device: str | None = None) -> CTCModel:
        try:
            import torch
            from huggingface_hub import hf_hub_download
            from transformers import AutoFeatureExtractor, AutoModelForCTC
        except ImportError as e:  # pragma: no cover - depends on optional extra
            raise ModelUnavailable('install the model extra: pip install -e ".[model]"') from e
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._features = AutoFeatureExtractor.from_pretrained(self.name)
        self._model = AutoModelForCTC.from_pretrained(self.name).to(self._device).eval()
        self.vocab = read_vocab(hf_hub_download(self.name, "vocab.json"))
        pad = self._model.config.pad_token_id
        self.blank = int(pad) if pad is not None else self.vocab["<pad>"]
        return self

    def __call__(self, wav: np.ndarray) -> AcousticOutput:
        import torch

        if self._model is None:
            raise ModelUnavailable(f"{self.name} is not loaded")
        inputs = self._features(wav, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_values.to(self._device)
        with torch.no_grad():
            logits = self._model(inputs).logits[0]
        return AcousticOutput(torch.log_softmax(logits, -1).cpu().numpy(), self.vocab, self.blank)


class Listener:
    """Both models loaded once; `listen` scores one recording against its known text."""

    def __init__(self, device: str | None = None, ref: ReferenceData | None = None, load_letter_model: bool = True):
        self.ref = ref or reference_data()
        self.phone = CTCModel(routing()["phone_model"]["id"]).load(device)
        missing = missing_phone_tokens(self.phone.vocab)
        if missing:
            raise ModelUnavailable(f"phone model vocabulary lacks routing tokens: {missing}")
        self.letter = CTCModel(routing()["letter_model"]["id"]).load(device) if load_letter_model else None

    def listen(self, wav: np.ndarray, text: str) -> list[UnitEvidence]:
        units = to_units(text, self.ref.taxonomy)
        letter_out = self.letter(wav) if self.letter is not None else None
        return score_pronunciation(text, units, self.phone(wav), letter_out, self.ref)

    def score_item(self, wav: np.ndarray, meta: ScoreItemRequestMeta, *, synthetic: bool) -> ScoreItemResponse:
        """The full contract response for one recorded item."""
        units = to_units(meta.expected_text, self.ref.taxonomy)
        letter_out = self.letter(wav) if self.letter is not None else None
        evidence = score_pronunciation(meta.expected_text, units, self.phone(wav), letter_out, self.ref)
        return build_response(
            meta,
            units,
            evidence,
            self.ref,
            audio_duration_ms=int(1000 * len(wav) / SAMPLE_RATE),
            synthetic=synthetic,
            warnings=audio_warnings(wav),
        )


def load_audio(path: str) -> np.ndarray:
    """Read any audio file as mono float32 at 16 kHz (needs the model extra)."""
    try:
        import librosa
    except ImportError as e:  # pragma: no cover
        raise ModelUnavailable('install the model extra: pip install -e ".[model]"') from e
    wav, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return wav.astype(np.float32)
