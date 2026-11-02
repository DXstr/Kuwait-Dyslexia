"""A12: the phonetic inventory parses with the generated model and its Arabic cues are fully vowelled and kind."""

import json

import pytest

from basira_ai.content import arabic
from basira_ai.contracts_gen.models import PhoneticInventory
from basira_ai.reference import contracts_dir, reference_data

INV = json.loads((contracts_dir() / "phonetic-inventory.json").read_text(encoding="utf-8"))
TAX = reference_data().taxonomy


def test_inventory_parses_with_generated_model():
    parsed = PhoneticInventory.model_validate(INV)
    assert len(parsed.letters) == 28


@pytest.mark.parametrize("row", INV["letters"], ids=lambda r: r["letter_id"])
def test_cue_is_fully_vowelled_arabic(row):
    for word in arabic.words(row["cue_ar"]):
        assert arabic.undiacritized_letters(word, TAX) == [], (row["letter_id"], word)


@pytest.mark.parametrize("row", INV["letters"], ids=lambda r: r["letter_id"])
def test_cue_is_gender_neutral_and_never_negative(row):
    plain = arabic.strip_diacritics(row["cue_ar"])
    for banned in ("خطأ", "غلط", "خاطئ"):
        assert banned not in plain
    # first-person plural ("we ...") or an impersonal description, never a gendered command (ضع / ضعي)
    first = plain.split()[0]
    assert first.startswith("ن") or first.startswith("ي"), first


def test_every_row_is_unreviewed_until_signed_off():
    rows = INV["letters"] + INV["vowel_modifiers"]
    assert all(r["review"]["status"] == "unreviewed" and r["review"]["reviewer"] is None for r in rows)
