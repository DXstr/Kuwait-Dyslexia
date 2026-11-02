"""Fingerprint (A8): session features and explainable rough-set referral output.

Features are computed from the session's scored items (A3-A5) and the app's tap results. A feature with too little
evidence is null, never guessed. Omission, insertion and self-correction are null until the scorer measures them
(#32). WCPM and the vowelization gap are reported but not used in referral rules (no Arabic age-band norms yet).

Referral uses rough sets (Pawlak 1982) over a decision table that is data (`data/referral-table.json`), so a
specialist can edit it without code changes:
- each feature is discretized to ok / concern / unknown;
- minimal readable rules are induced from the table at load time (shortest consistent condition sets per row);
- a session with unknown attributes is compared with every table row it is compatible with (tolerance relation,
  Kryszkiewicz 1998). One possible decision -> that decision (lower approximation). Several -> the boundary region:
  `specialist_decision_needed`.

Basira never diagnoses: the output is a suggestion that starts `pending_review`; only a specialist decides.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

from basira_ai.reference import ReferenceData

MODEL_VERSION = "fingerprint-0.1.0"
MIN_OPPORTUNITIES = 5  # scored sounds or taps behind a rate
MIN_ITEMS = 3  # items of each kind behind a gap
SCORED = ("correct", "dialect_variant", "error")


# ---------------------------------------------------------------- features


def _rate(errors: int, total: int) -> float | None:
    return round(errors / total, 4) if total >= MIN_OPPORTUNITIES else None


def _accuracy(values: list[bool]) -> float | None:
    return sum(values) / len(values) if len(values) >= MIN_ITEMS else None


def _gap(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(a - b, 4)


def _taps(taps: Iterable[dict], prefix: str) -> tuple[int, int]:
    rows = [t for t in taps if t["skill_id"].startswith(prefix)]
    return sum(not t["correct"] for t in rows), len(rows)


def session_features(items: list[dict], taps: list[dict], ref: ReferenceData) -> dict:
    """FingerprintResponse.features from ScoreItemResponse dicts and SkillEvidence (tap) dicts."""
    tax = ref.taxonomy
    emphatic_letters = {x for p in tax.emphatic_pairs for x in (p.emphatic, p.plain)}
    dot = [0, 0]
    emph = [0, 0]
    subst = [0, 0]
    for item in items:
        for ph in item["phonemes"]:
            letter = ph["expected_letter"]
            if letter is None or ph["status"] not in SCORED:
                continue
            cat = ph["error_category"]
            subst[0] += cat == "substitution"
            subst[1] += 1
            if tax.dot_group_of(letter) is not None and cat in (None, "dot_confusion"):
                dot[0] += cat == "dot_confusion"
                dot[1] += 1
            if letter in emphatic_letters and cat in (None, "emphatic_confusion"):
                emph[0] += cat == "emphatic_confusion"
                emph[1] += 1
    for prefix, acc in (("dot.", dot), ("emph.", emph)):  # minimal-pair taps count as opportunities too
        e, n = _taps(taps, prefix)
        acc[0] += e
        acc[1] += n

    def item_ok(item: dict) -> bool:
        return bool(item["words"]) and all(w["correct"] for w in item["words"])

    def word_acc(kind: str) -> float | None:
        words = [w["correct"] for i in items if i["item_type"] == kind for w in i["words"]]
        n_items = sum(i["item_type"] == kind for i in items)
        return sum(words) / len(words) if n_items >= 1 and len(words) >= MIN_OPPORTUNITIES else None

    real = _accuracy([item_ok(i) for i in items if i["item_type"] == "real_word"])
    pseudo = _accuracy([item_ok(i) for i in items if i["item_type"] == "pseudoword"])
    wcpms = [i["wcpm"] for i in items if i.get("wcpm") is not None]
    return {
        "dot_confusion_rate": _rate(*dot),
        "emphatic_confusion_rate": _rate(*emph),
        "short_vowel_error_rate": _rate(*_taps(taps, "vowel.")),
        "positional_error_rate": _rate(*_taps(taps, "pos.")),
        "omission_rate": None,  # not measured yet (#32)
        "insertion_rate": None,  # not measured yet (#32)
        "substitution_rate": _rate(*subst),
        "wcpm": round(sum(wcpms) / len(wcpms), 1) if wcpms else None,
        "self_correction_rate": None,  # not measured
        "pseudoword_gap": _gap(real, pseudo),
        "vowelization_gap": _gap(word_acc("passage_vowelized"), word_acc("passage_unvowelized")),
    }


# ---------------------------------------------------------------- rough-set model


@dataclass(frozen=True)
class Rule:
    conditions: tuple[tuple[str, str], ...]  # ((attribute id, value), ...)
    decision: str

    def matches(self, case: dict[str, str | None]) -> bool:
        return all(case.get(a) == v for a, v in self.conditions)


class RoughSetModel:
    def __init__(self, table: dict) -> None:
        self.table = table
        self.attrs = [a["id"] for a in table["attributes"]]
        self.by_id = {a["id"]: a for a in table["attributes"]}
        self.rows = [(r["values"], r["decision"]) for r in table["rows"]]
        self._check_table()
        self.rules = self._induce()
        digest = hashlib.sha256(json.dumps(table, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:8]
        self.version = f"referral-table {table['version']} ({digest})"

    def _check_table(self) -> None:
        seen: dict[tuple, str] = {}
        for values, decision in self.rows:
            if set(values) != set(self.attrs) or set(values.values()) - {"ok", "concern"}:
                raise ValueError(f"table row has wrong attributes/values: {values}")
            if decision not in self.table["decision_text"]:
                raise ValueError(f"unknown decision {decision!r}")
            key = tuple(values[a] for a in self.attrs)
            if seen.get(key, decision) != decision:
                raise ValueError(f"inconsistent table: {values} has two decisions")
            seen[key] = decision

    def _consistent(self, conditions: tuple[tuple[str, str], ...], decision: str) -> bool:
        return all(d == decision for v, d in self.rows if all(v[a] == x for a, x in conditions))

    def _induce(self) -> list[Rule]:
        """For every row, its shortest condition sets that still single out the row's decision."""
        rules: set[Rule] = set()
        for values, decision in self.rows:
            for size in range(1, len(self.attrs) + 1):
                found = [
                    Rule(tuple((a, values[a]) for a in subset), decision)
                    for subset in itertools.combinations(self.attrs, size)
                    if self._consistent(tuple((a, values[a]) for a in subset), decision)
                ]
                if found:
                    rules.update(found)
                    break
        # drop a rule when a more general rule (subset of its conditions) gives the same decision
        general = [r for r in rules if not any(o != r and o.decision == r.decision and set(o.conditions) < set(
            r.conditions) for o in rules)]
        return sorted(general, key=lambda r: (r.decision, len(r.conditions), r.conditions))

    def discretize(self, features: dict) -> dict[str, str | None]:
        case: dict[str, str | None] = {}
        for a in self.table["attributes"]:
            x = features.get(a["feature"])
            case[a["id"]] = None if x is None else ("concern" if x >= a["threshold"] else "ok")
        return case

    def classify(self, case: dict[str, str | None]) -> tuple[str, list[dict]]:
        compatible = {d for v, d in self.rows if all(case[a] is None or v[a] == case[a] for a in self.attrs)}
        if len(compatible) != 1:
            missing = [a for a in self.attrs if case[a] is None]
            return "specialist_decision_needed", [self._boundary_text(missing, compatible)]
        (decision,) = compatible
        fired = [self.rule_text(r) for r in self.rules if r.decision == decision and r.matches(case)]
        if not fired:  # certain only because every completion of the missing evidence agrees
            fired = [self._consistent_text(decision, [a for a in self.attrs if case[a] is None])]
        return decision, fired

    # ---------------------------------------------------------------- readable text

    def _cond_en(self, a: str, v: str) -> str:
        return f"{self.by_id[a]['label_en']}: {'elevated' if v == 'concern' else 'within expected range'}"

    def _cond_ar(self, a: str, v: str) -> str:
        return f"{self.by_id[a]['label_ar']} {'مرتفع' if v == 'concern' else 'ضمن المتوقع'}"

    def rule_id(self, r: Rule) -> str:
        short = {"no_referral_indicated": "none", "refer_for_specialist_assessment": "refer",
                 "specialist_decision_needed": "specialist"}[r.decision]
        return "R-" + short + "-" + "+".join(a + ("" if v == "concern" else "0") for a, v in r.conditions)

    def rule_text(self, r: Rule) -> dict:
        dt = self.table["decision_text"][r.decision]
        return {
            "rule_id": self.rule_id(r),
            "text_en": "IF " + " AND ".join(self._cond_en(a, v) for a, v in r.conditions) + f" THEN {dt['en']}.",
            "text_ar": "إذا كان " + "، و".join(self._cond_ar(a, v) for a, v in r.conditions) + f" فإن: {dt['ar']}.",
        }

    def _labels(self, attrs: list[str], lang: str) -> str:
        sep = ", " if lang == "en" else "، "
        return sep.join(self.by_id[a][f"label_{lang}"] for a in attrs)

    def _boundary_text(self, missing: list[str], decisions: set[str]) -> dict:
        dt = self.table["decision_text"]
        options_en = " / ".join(dt[d]["en"] for d in sorted(decisions))
        options_ar = " / ".join(dt[d]["ar"] for d in sorted(decisions))
        return {
            "rule_id": "R-boundary",
            "text_en": f"Not enough evidence for {self._labels(missing, 'en')}: the session is compatible with "
                       f"{options_en}, so a specialist decision is needed.",
            "text_ar": f"لا توجد أدلة كافية عن {self._labels(missing, 'ar')}، والجلسة تحتمل: {options_ar}؛ "
                       "لذلك القرار للأخصائي.",
        }

    def _consistent_text(self, decision: str, missing: list[str]) -> dict:
        dt = self.table["decision_text"][decision]
        return {
            "rule_id": "R-consistent",
            "text_en": f"Every possible value of the missing evidence ({self._labels(missing, 'en')}) leads to: "
                       f"{dt['en']}.",
            "text_ar": f"كل القيم المحتملة للأدلة الناقصة ({self._labels(missing, 'ar')}) تؤدي إلى: {dt['ar']}.",
        }


@lru_cache(maxsize=1)
def default_model() -> RoughSetModel:
    raw = resources.files("basira_ai").joinpath("data/referral-table.json").read_text(encoding="utf-8")
    return RoughSetModel(json.loads(raw))


def fingerprint(request: dict, ref: ReferenceData, model: RoughSetModel | None = None) -> dict:
    """FingerprintResponse dict for a FingerprintRequest dict."""
    model = model or default_model()
    features = session_features(request["items"], request["tap_results"], ref)
    decision, fired = model.classify(model.discretize(features))
    return {
        "session_id": request["session_id"],
        "model_version": MODEL_VERSION,
        "rules_version": model.version,
        "synthetic": any(i["synthetic"] for i in request["items"]),
        "features": features,
        "referral": {"decision": decision, "rules_fired": fired},
        "review_status": "pending_review",
    }
