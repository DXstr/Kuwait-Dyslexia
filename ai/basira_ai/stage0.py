"""Stage 0 scoring (A10): each instrument's own rule, never invented norms.

Instruments are data (`data/stage0-instruments.json`). An instrument without a licence (or without its materials)
is `license_pending`: no raw score, no scaled score, and the response is marked synthetic because the examiner can
only have administered a placeholder. Basira's own tasks return a raw score only; `scaled_score` stays null until a
real norm table with a named source is added (it is never computed from anything else).

Response formats:
- proportion_correct: one response per item, boolean (true = correct); raw = correct / items.
- wcpm: one response per timed passage, number = words read correctly, `time_ms` = reading time; raw = words / min.
"""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources

SCORER_VERSION = "stage0-0.1.0"


class Stage0Error(ValueError):
    """The request cannot be scored as sent (unknown instrument, wrong construct, malformed responses)."""


@lru_cache(maxsize=1)
def instruments() -> dict[str, dict]:
    raw = json.loads(resources.files("basira_ai").joinpath("data/stage0-instruments.json").read_text(encoding="utf-8"))
    return {i["instrument_id"]: i for i in raw["instruments"]}


def _proportion_correct(responses: list[dict]) -> float:
    if not responses:
        raise Stage0Error("no responses to score")
    if any(not isinstance(r["response"], bool) for r in responses):
        raise Stage0Error("proportion_correct needs a boolean response per item")
    return round(sum(r["response"] for r in responses) / len(responses), 4)


def _wcpm(responses: list[dict]) -> float:
    if not responses:
        raise Stage0Error("no passages to score")
    words = 0.0
    ms = 0
    for r in responses:
        value = r["response"]
        if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
            raise Stage0Error(f"{r['item_id']}: wcpm needs the number of words read correctly")
        if not r.get("time_ms"):
            raise Stage0Error(f"{r['item_id']}: wcpm needs time_ms > 0")
        words += value
        ms += r["time_ms"]
    return round(words / (ms / 60_000), 1)


SCORERS = {"proportion_correct": _proportion_correct, "wcpm": _wcpm}


def score(request: dict) -> dict:
    """Stage0ScoreResponse dict for a Stage0ScoreRequest dict."""
    inst = instruments().get(request["instrument_id"])
    if inst is None:
        raise Stage0Error(f"unknown instrument {request['instrument_id']!r}")
    if inst["construct"] != request["construct"]:
        measures = inst["construct"]
        raise Stage0Error(f"instrument {inst['instrument_id']} measures {measures}, not {request['construct']}")
    pending = inst["licence_status"] == "license_pending"
    raw = None if pending else SCORERS[inst["scoring"]](request["responses"])
    return {
        "construct": inst["construct"],
        "instrument_id": inst["instrument_id"],
        "licence_status": inst["licence_status"],
        "raw_score": raw,
        "scaled_score": None,  # no norm table has been obtained for any instrument
        "norm_source": inst["norm_source"],
        "note_en": inst["note_en"],
        "scorer_version": SCORER_VERSION,
        "synthetic": pending,
    }
