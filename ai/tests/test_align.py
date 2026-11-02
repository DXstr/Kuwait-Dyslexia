import numpy as np
import pytest

from basira_ai.align import AlignmentError, Span, ctc_align, mean_log_prob


def posteriors(frames: list[int], vocab: int, p: float = 0.9) -> np.ndarray:
    """Log-posteriors where each frame is confidently one token."""
    lp = np.full((len(frames), vocab), np.log((1 - p) / (vocab - 1)))
    for t, k in enumerate(frames):
        lp[t, k] = np.log(p)
    return lp


BLANK, Q, A, L, M, G = 0, 1, 2, 3, 4, 5


def test_aligns_each_token_to_its_frames():
    lp = posteriors([BLANK, Q, Q, A, BLANK, L, A, M, M, BLANK], 6)
    spans = ctc_align(lp, [Q, A, L, A, M], BLANK)
    assert spans == [Span(1, 3), Span(3, 4), Span(5, 6), Span(6, 7), Span(7, 9)]
    assert spans[0].start_ms == 20 and spans[0].end_ms == 60


def test_expected_q_spoken_as_g_scores_g_higher_on_q_frames():
    lp = posteriors([BLANK, G, G, A, BLANK, L, A, M, BLANK], 6)
    spans = ctc_align(lp, [Q, A, L, A, M], BLANK)
    assert mean_log_prob(lp, spans[0], G) > mean_log_prob(lp, spans[0], Q)


def test_repeated_tokens_need_a_blank_between_them():
    lp = posteriors([Q, Q, BLANK, Q], 2)
    assert ctc_align(lp, [Q, Q], BLANK) == [Span(0, 2), Span(3, 4)]


def test_too_few_frames_raises():
    with pytest.raises(AlignmentError):
        ctc_align(posteriors([Q], 2), [Q, Q], BLANK)  # two identical tokens need at least 3 frames


def test_matches_brute_force_on_random_inputs():
    """Viterbi path score equals the best score over all monotonic CTC paths (small exhaustive check)."""
    from itertools import product

    rng = np.random.default_rng(0)
    for _ in range(20):
        frames, vocab = 5, 3
        lp = np.log(rng.dirichlet(np.ones(vocab), size=frames))
        targets = [1, 2]
        spans = ctc_align(lp, targets, 0)

        def collapse(path):
            out, prev = [], None
            for k in path:
                if k != prev and k != 0:
                    out.append(k)
                prev = k
            return out

        valid = [p for p in product(range(vocab), repeat=frames) if collapse(p) == targets]
        best = max((sum(lp[t, k] for t, k in enumerate(p)), p) for p in valid)
        path = best[1]
        # every frame inside a returned span must carry that span's token on the brute-force best path
        for span, tok in zip(spans, targets, strict=True):
            assert all(path[t] == tok for t in range(span.start, span.end))
