"""Synthetic CTC posteriors that imitate the real models, shared by scorer tests."""

import numpy as np

from basira_ai.pronunciation import AcousticOutput, routing
from basira_ai.reference import reference_data

REF = reference_data()
PHONE_TOKENS = ["<pad>"] + sorted(set(routing()["phone_model"]["tokens"].values()))
PHONE_VOCAB = {t: i for i, t in enumerate(PHONE_TOKENS)}
LETTER_TOKENS = ["<pad>", "|"] + [letter.char for letter in REF.taxonomy.letters.values()] + list("ءأإؤئةى")
LETTER_VOCAB = {t: i for i, t in enumerate(LETTER_TOKENS)}


def frames(tokens: list[str], vocab: dict[str, int], p: float = 0.9) -> AcousticOutput:
    """Two frames per token with a blank between tokens, each frame confidently its token."""
    seq: list[int] = []
    for tok in tokens:
        seq += [vocab[tok], vocab[tok], 0]
    lp = np.full((len(seq) + 1, len(vocab)), np.log((1 - p) / (len(vocab) - 1)))
    for t, k in enumerate(seq):
        lp[t, k] = np.log(p)
    lp[-1, 0] = np.log(p)
    return AcousticOutput(lp, vocab, 0)


def phones_for(text: str) -> list[str]:
    """The phone-model tokens of a perfect reading of `text`."""
    from basira_ai.g2p import to_units

    return [routing()["phone_model"]["tokens"][u.ipa] for u in to_units(text, REF.taxonomy)]
