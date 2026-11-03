"""Teach voice prompts (A14, ADR-003): content/source/prompts.json -> content/dist/prompt-bank.json (+ prompt-audio/).

Each prompt passes deterministic validators or is discarded (never repaired):
- script: Arabic letters, vowel marks, Arabic punctuation and spaces only
- diacritized: every letter carries its vowel mark (same rule as the item bank)
- no_negative_words: no word meaning wrong / mistake / failure, nor a judgement of the child (non-negotiable 2)
- gender_neutral: no second-person singular forms, so the app never needs the child's gender (ADR-003)
- length: 1-12 words, short enough to play between items

Audio is rendered once with the item-bank voice when an engine is given (`--audio azure`); otherwise `audio_path` is
null and the app shows nothing new to the child until the clips exist. Every prompt ships `unreviewed`.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from basira_ai.content import arabic
from basira_ai.content.build import check_schema, content_dir
from basira_ai.content.tts import TTSEngine, cache_key
from basira_ai.g2p import FATHA, KASRA, SHADDA
from basira_ai.reference import ReferenceData, contracts_dir, reference_data

BANK_VERSION = "0.1.0"
AUDIO_DIR = "prompt-audio"
VALIDATORS = ("script", "diacritized", "no_negative_words", "gender_neutral", "length")

#: undiacritized stems that mean wrong / mistake / failure or judge the child; matched inside words, after the
#: optional prefixes و ف ب ل ك ال and with the hamza forms folded, so أَخْطَأْنَا and الخطأ are both caught
NEGATIVE_STEMS = ("خطا", "خاطي", "غلط", "فشل", "فاشل", "سيي", "ضعيف", "كسول", "غبي", "خسر", "عيب")
#: whole words in the second person singular (gendered): you (m/f), well done (m/f), your (m/f) on common nouns
GENDERED_WORDS = {"انت", "احسنت", "انتي", "شاطر", "شاطرة", "بطل", "بطلة"}
HAMZA_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ؤ": "و", "ئ": "ي", "ء": "", "ى": "ي"})


@dataclass(frozen=True)
class Prompt:
    trigger: str
    text: str
    gloss: str = ""


def _fold(word: str) -> str:
    return arabic.strip_diacritics(arabic.strip_punctuation(word)).translate(HAMZA_FOLD)


def script(p: Prompt, ref: ReferenceData) -> str | None:
    allowed = arabic.arabic_letters(ref.taxonomy) | arabic.MARKS | arabic.PUNCTUATION | {" "}
    bad = sorted({ch for ch in p.text if ch not in allowed})
    return "non-Arabic characters: " + " ".join(f"U+{ord(ch):04X}" for ch in bad) if bad else None


def diacritized(p: Prompt, ref: ReferenceData) -> str | None:
    for word in arabic.words(p.text):
        bad = arabic.undiacritized_letters(word, ref.taxonomy)
        if bad:
            return f"missing vowel mark in {word!r} at letter {bad[0]}"
    return None


def no_negative_words(p: Prompt, ref: ReferenceData) -> str | None:
    for word in arabic.words(p.text):
        folded = _fold(word)
        core = re.sub(r"^(و|ف)?(ب|ل|ك)?(ال)?", "", folded)
        for stem in NEGATIVE_STEMS:
            if stem in folded or core.startswith(stem):
                return f"negative word {word!r}"
    return None


def gender_neutral(p: Prompt, ref: ReferenceData) -> str | None:
    """Second-person singular is gendered in Arabic: reject 'you', 'well done (you)' and a final -تَ / -تِ / -كَ / -كِ
    suffix (past-tense 'you did', 'your'). A false alarm only discards a prompt; it never lets one through."""
    for word in arabic.words(p.text):
        if _fold(word) in GENDERED_WORDS:
            return f"gendered word {word!r}"
        letters = arabic.split_letters(arabic.strip_punctuation(word))
        if len(letters) >= 3:
            last, marks = letters[-1]
            plural = last == "ت" and letters[-2][0] == "ا"  # feminine plural -اتِ (الْحَرَكَاتِ), not "you"
            if last in {"ت", "ك"} and marks - {SHADDA} in ({FATHA}, {KASRA}) and not plural:
                return f"second-person singular form {word!r}"
    return None


def length(p: Prompt, ref: ReferenceData) -> str | None:
    n = len(arabic.words(p.text))
    return None if 1 <= n <= 12 else f"{n} words (1-12 allowed)"


CHECKS = {"script": script, "diacritized": diacritized, "no_negative_words": no_negative_words,
          "gender_neutral": gender_neutral, "length": length}


def validate(p: Prompt, ref: ReferenceData) -> str | None:
    for name in VALIDATORS:
        reason = CHECKS[name](p, ref)
        if reason:
            return f"{name}: {reason}"
    return None


def prompt_id(p: Prompt) -> str:
    return f"pr-{p.trigger.replace('_', '-')}-{hashlib.sha1(p.text.encode()).hexdigest()[:6]}"


def load_source(path: Path) -> list[Prompt]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [Prompt(r["trigger"], r["text"], r.get("gloss", "")) for r in raw["prompts"]]


def build_prompts(out_dir: Path, source: Path | None = None, engine: TTSEngine | None = None,
                  generated_at: datetime | None = None, ref: ReferenceData | None = None) -> tuple[dict, dict]:
    ref = ref or reference_data()
    source = source or content_dir() / "source" / "prompts.json"
    triggers = json.loads((contracts_dir() / "schemas" / "basira.schema.json").read_text(encoding="utf-8"))
    triggers = triggers["$defs"]["PromptTrigger"]["enum"]
    clips, rejected, seen = [], [], set()
    for p in load_source(source):
        reason = "unknown trigger" if p.trigger not in triggers else validate(p, ref)
        if reason is None and p.text in seen:
            reason = "duplicate"
        if reason:
            rejected.append({"trigger": p.trigger, "text": p.text, "reason": reason})
            continue
        seen.add(p.text)
        clips.append({"id": prompt_id(p), "trigger": p.trigger, "text": p.text,
                      "text_plain": arabic.strip_diacritics(p.text), "audio_path": None,
                      "validation": {"passed": True, "validators": list(VALIDATORS)},
                      "review": {"status": "unreviewed", "reviewer": None}})
    missing = sorted(set(triggers) - {c["trigger"] for c in clips})
    if missing:
        raise ValueError(f"no valid prompt for trigger(s) {missing}: every trigger needs at least one clip")
    audio = _render(clips, out_dir / AUDIO_DIR, engine) if engine else None
    stamp = (generated_at or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    bank = {"version": BANK_VERSION, "generated_at": stamp, "synthetic_audio": True, "prompts": clips}
    check_schema(bank, "PromptBank")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "prompt-bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n",
                                              encoding="utf-8", newline="\n")
    report = {"accepted": len(clips), "per_trigger": {t: sum(c["trigger"] == t for c in clips) for t in triggers},
              "rejected": rejected, "audio": audio,
              "review": "all prompts unreviewed: a specialist must approve them before they are played to a child"}
    return bank, report


def _render(clips: list[dict], audio_dir: Path, engine: TTSEngine) -> dict:
    """Render each clip once; reuse a file whose text, voice and settings are unchanged (manifest of hashes)."""
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = audio_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    new_manifest: dict[str, dict] = {}
    rendered = cached = 0
    for clip in clips:
        name = f"{clip['id']}.{engine.extension}"
        digest = cache_key(engine, clip["text"])  # sha256 of engine|voice|settings|text, not a credential
        path = audio_dir / name
        if path.is_file() and manifest.get(name, {}).get("text_sha256") == digest:
            cached += 1
        else:
            path.write_bytes(engine.synthesize(clip["text"]))
            rendered += 1
        new_manifest[name] = {"text_sha256": digest, "engine": engine.name, "voice": engine.voice,
                              "text": clip["text"]}
        clip["audio_path"] = f"{AUDIO_DIR}/{name}"
    for stale in audio_dir.glob(f"*.{engine.extension}"):
        if stale.name not in new_manifest:
            stale.unlink()
    manifest_path.write_text(json.dumps(new_manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                             newline="\n")
    return {"engine": engine.name, "voice": engine.voice, "rendered": rendered, "cached": cached}
