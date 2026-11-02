"""CTC forced alignment: which audio frames belong to which expected token.

Works on a (frames x vocabulary) matrix of log-posteriors from any CTC model, so it is tested without loading a model.
Viterbi over the standard CTC topology (blank, t1, blank, t2, ..., blank); repeated identical tokens need a blank
between them, exactly as in CTC training.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FRAME_MS = 20  # wav2vec2: 320-sample stride at 16 kHz


class AlignmentError(ValueError):
    """The audio is too short to contain the expected tokens, or the inputs are malformed."""


@dataclass(frozen=True)
class Span:
    start: int  # first frame (inclusive)
    end: int  # last frame (exclusive)

    @property
    def start_ms(self) -> int:
        return self.start * FRAME_MS

    @property
    def end_ms(self) -> int:
        return self.end * FRAME_MS


def ctc_align(log_probs: np.ndarray, targets: list[int], blank: int) -> list[Span]:
    """Return one frame span per target token (Viterbi best path)."""
    lp = np.asarray(log_probs, dtype=np.float64)
    if lp.ndim != 2:
        raise AlignmentError("log_probs must be (frames, vocab)")
    if not targets:
        raise AlignmentError("no target tokens")
    n_frames = lp.shape[0]
    ext = np.full(2 * len(targets) + 1, blank, dtype=np.int64)
    ext[1::2] = targets
    n_states = len(ext)
    repeats = sum(1 for a, b in zip(targets, targets[1:], strict=False) if a == b)
    if n_frames < len(targets) + repeats:
        raise AlignmentError(f"{n_frames} frames cannot hold {len(targets)} tokens")

    neg = -np.inf
    # a skip from s-2 to s is allowed when s is a token that differs from the token two states back
    can_skip = np.zeros(n_states, dtype=bool)
    can_skip[2:] = (ext[2:] != blank) & (ext[2:] != ext[:-2])

    score = np.full(n_states, neg)
    score[0] = lp[0, ext[0]]
    score[1] = lp[0, ext[1]]
    back = np.zeros((n_frames, n_states), dtype=np.int8)  # 0 stay, 1 from s-1, 2 from s-2
    for t in range(1, n_frames):
        stay = score
        step = np.concatenate(([neg], score[:-1]))
        skip = np.where(can_skip, np.concatenate(([neg, neg], score[:-2])), neg)
        stacked = np.stack([stay, step, skip])
        choice = np.argmax(stacked, axis=0)
        score = stacked[choice, np.arange(n_states)] + lp[t, ext]
        back[t] = choice

    end_state = n_states - 1 if score[-1] >= score[-2] else n_states - 2
    if not np.isfinite(score[end_state]):
        raise AlignmentError("no valid alignment")
    states = np.empty(n_frames, dtype=np.int64)
    s = end_state
    for t in range(n_frames - 1, -1, -1):
        states[t] = s
        s -= int(back[t, s])

    spans: list[list[int]] = [[-1, -1] for _ in targets]
    for t, s in enumerate(states):
        if s % 2 == 1:
            k = s // 2
            if spans[k][0] < 0:
                spans[k][0] = t
            spans[k][1] = t + 1
    if any(a < 0 for a, _ in spans):
        raise AlignmentError("a target token received no frames")
    return [Span(a, b) for a, b in spans]


def mean_log_prob(log_probs: np.ndarray, span: Span, token: int) -> float:
    return float(np.mean(log_probs[span.start : span.end, token]))
