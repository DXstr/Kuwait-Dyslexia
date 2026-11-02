"""Prove (A9): practised vs unseen accuracy per skill, and whether the skill transferred to unseen text.

Evidence is the audio `skill_evidence` of the scored items (A5): the items the child practised, and the unseen probe
passages (`probe_only` items the child never saw or heard). Per skill:

- insufficient_data: fewer than MIN_EVIDENCE observations on either side (accuracies are still reported);
- transfer_shown: unseen accuracy reaches the skill graph's "probe_due" band (contracts/skill-graph.json, 0.85);
- no_transfer_yet: otherwise.

The skill graph's mastered rule then needs both mastery >= 0.85 and transfer_shown; that bookkeeping is the web app's
learning map (B8). Short vowels are never inferred from audio, so they never appear here.
"""

from __future__ import annotations

import json
from collections import defaultdict
from functools import lru_cache

from basira_ai.reference import contracts_dir

MODEL_VERSION = "probe-0.1.0"
MIN_EVIDENCE = 5


@lru_cache(maxsize=1)
def transfer_threshold() -> float:
    graph = json.loads((contracts_dir() / "skill-graph.json").read_text(encoding="utf-8"))
    return float(graph["mastery_bands"]["probe_due"][0])


def _tally(items: list[dict]) -> dict[str, list[bool]]:
    out: dict[str, list[bool]] = defaultdict(list)
    for item in items:
        for ev in item["skill_evidence"]:
            if ev["source"] == "audio":
                out[ev["skill_id"]].append(bool(ev["correct"]))
    return out


def _accuracy(values: list[bool]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def probe(request: dict) -> dict:
    """ProbeResponse dict for a ProbeRequest dict."""
    practised, unseen = _tally(request["practised"]), _tally(request["unseen"])
    threshold = transfer_threshold()
    per_skill = []
    for skill_id in sorted(set(practised) | set(unseen)):
        p, u = practised.get(skill_id, []), unseen.get(skill_id, [])
        unseen_acc = _accuracy(u)
        if len(p) < MIN_EVIDENCE or len(u) < MIN_EVIDENCE:
            transfer = "insufficient_data"
        elif unseen_acc is not None and unseen_acc >= threshold:
            transfer = "transfer_shown"
        else:
            transfer = "no_transfer_yet"
        per_skill.append({
            "skill_id": skill_id,
            "practised_accuracy": _accuracy(p),
            "unseen_accuracy": unseen_acc,
            "n_practised": len(p),
            "n_unseen": len(u),
            "transfer": transfer,
        })
    items = request["practised"] + request["unseen"]
    return {
        "session_id": request["session_id"],
        "model_version": MODEL_VERSION,
        "synthetic": any(i["synthetic"] for i in items),
        "per_skill": per_skill,
    }
