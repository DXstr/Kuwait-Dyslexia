"""Build content/dist/item-bank.json: generate candidates, validate, discard failures, render audio, check the schema.

    python -m basira_ai.content build                 # text only (audio_path = null, synthetic_audio = false)
    python -m basira_ai.content build --audio azure   # + pre-rendered TTS audio (needs AZURE_SPEECH_* env vars)
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from basira_ai.content import arabic, generate
from basira_ai.content.tts import TTSEngine, cache_key
from basira_ai.content.validators import Candidate, Context, validate
from basira_ai.reference import ReferenceData, contracts_dir, reference_data

BANK_VERSION = "1.0.0"
PREFIX = {
    "letter_sound": "ls",
    "vowel_tap": "vt",
    "minimal_pair": "mp",
    "real_word": "rw",
    "pseudoword": "pw",
    "passage_vowelized": "pv",
    "passage_unvowelized": "pu",
    "probe_passage": "pp",
}
TYPE_ORDER = list(PREFIX)


class ContractError(ValueError):
    """The built bank does not validate against its $defs (ItemBank or PromptBank)."""


def check_schema(bank: dict, definition: str = "ItemBank") -> None:
    """Validate against the canonical JSON Schema (not the generated pydantic model, which mis-types the nullable
    `options` array: datamodel-code-generator 0.26.3 drops the null from `type: ["array", "null"]`)."""
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    schema = json.loads((contracts_dir() / "schemas" / "basira.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
    validator = Draft202012Validator({"$ref": f"{schema['$id']}#/$defs/{definition}"}, registry=registry)
    errors = sorted(validator.iter_errors(bank), key=lambda e: list(e.absolute_path))
    if errors:
        first = errors[0]
        raise ContractError(f"{len(errors)} schema errors; first at {list(first.absolute_path)}: {first.message}")


def load_reviews(reviews_dir: Path) -> dict[str, dict]:
    """item id -> Item.review from the specialist's decision files (content/reviews/*.json, later files win).

    Item ids hash the item's content, so an approval lapses by itself when an item changes. A change request is not
    an approval: the item stays unreviewed until a new version is approved."""
    out: dict[str, dict] = {}
    for f in sorted(reviews_dir.glob("*.json")) if reviews_dir.is_dir() else []:
        data = json.loads(f.read_text(encoding="utf-8"))
        for iid, decision in data.get("items", {}).items():
            if decision in ("approved", "rejected"):
                out[iid] = {"status": decision, "reviewer": data["reviewer"]}
            else:
                out.pop(iid, None)
    return out


def content_dir() -> Path:
    return contracts_dir().parent / "content"


def item_id(c: Candidate) -> str:
    key = f"{c.type}|{c.text}|{'|'.join(c.options or ())}|{c.answer_index}"
    return f"{PREFIX[c.type]}-{hashlib.sha1(key.encode()).hexdigest()[:8]}"


def spoken_text(c: Candidate) -> str | None:
    """What the item audio says. Probe passages get no model reading: the child must meet them unseen and unheard."""
    if c.probe_only:
        return None
    if c.type == "minimal_pair":
        return c.options[c.answer_index]
    return c.text


def candidates(ref: ReferenceData, source_dir: Path) -> tuple[list[Candidate], Context]:
    lexicon = generate.lexicon(source_dir)
    passages = generate.passages(source_dir)
    ctx = Context(ref, lexicon, {p.text for p in passages if not p.probe_only})
    cands = (
        generate.letter_sounds(ref)
        + generate.vowel_taps()
        + generate.minimal_pairs(source_dir)
        + generate.real_words(source_dir)
        + generate.pseudowords(lexicon)
        + passages
    )
    return cands, ctx


@dataclass
class BuildResult:
    bank: dict
    report: dict


def build(
    out_dir: Path,
    *,
    source_dir: Path | None = None,
    engine: TTSEngine | None = None,
    generated_at: datetime | None = None,
    ref: ReferenceData | None = None,
    reviews_dir: Path | None = None,
) -> BuildResult:
    ref = ref or reference_data()
    source_dir = source_dir or content_dir() / "source"
    reviews = load_reviews(reviews_dir or content_dir() / "reviews")
    cands, ctx = candidates(ref, source_dir)

    items: list[tuple[Candidate, dict]] = []
    rejected: list[dict] = []
    seen: set[str] = set()
    for c in cands:
        names, failure = validate(c, ctx)
        iid = item_id(c)
        if failure is None and iid in seen:
            failure = "unique: duplicate item"
        if failure is not None:
            rejected.append({"type": c.type, "text": c.text, "source": c.source, "reason": failure})
            continue
        seen.add(iid)
        items.append(
            (
                c,
                {
                    "id": iid,
                    "type": c.type,
                    "skill_ids": list(c.skill_ids),
                    "grade_band": c.grade_band,
                    "text": c.text,
                    "text_plain": arabic.strip_diacritics(c.text),
                    "audio_path": None,
                    "options": list(c.options) if c.options else None,
                    "answer_index": c.answer_index,
                    "probe_only": c.probe_only,
                    "validation": {"passed": True, "validators": names + ["unique"]},
                    "review": reviews.get(iid, {"status": "unreviewed", "reviewer": None}),
                },
            )
        )
    items.sort(key=lambda pair: (TYPE_ORDER.index(pair[1]["type"]), pair[1]["id"]))

    audio = _render_audio(items, out_dir, engine) if engine else {"engine": None, "rendered": 0, "cached": 0}
    bank = {
        "version": BANK_VERSION,
        "generated_at": (generated_at or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "synthetic_audio": engine is not None,
        "items": [item for _, item in items],
    }
    check_schema(bank)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "item-bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "bank_version": BANK_VERSION,
        "generated_at": bank["generated_at"],
        "accepted": dict(Counter(i["type"] for i in bank["items"])),
        "accepted_total": len(bank["items"]),
        "rejected_total": len(rejected),
        "rejected": rejected,
        "audio": audio,
        "review": dict(Counter(i["review"]["status"] for i in bank["items"])),
    }
    return BuildResult(bank, report)


def _render_audio(items: list[tuple[Candidate, dict]], out_dir: Path, engine: TTSEngine) -> dict:
    audio_dir = out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = audio_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    new_manifest: dict[str, dict] = {}
    rendered = cached = 0
    for c, item in items:
        text = spoken_text(c)
        if text is None:
            continue
        name = f"{item['id']}.{engine.extension}"
        digest = cache_key(engine, text)  # sha256 of engine|voice|settings|text, not a credential
        path = audio_dir / name
        if not (path.is_file() and manifest.get(name, {}).get("text_sha256") == digest):
            path.write_bytes(engine.synthesize(text))
            rendered += 1
        else:
            cached += 1
        new_manifest[name] = {"text_sha256": digest, "engine": engine.name, "voice": engine.voice, "text": text}
        item["audio_path"] = f"audio/{name}"
    for stale in audio_dir.glob(f"*.{engine.extension}"):
        if stale.name not in new_manifest:
            stale.unlink()
    manifest_path.write_text(json.dumps(new_manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {"engine": engine.name, "voice": engine.voice, "rendered": rendered, "cached": cached}
