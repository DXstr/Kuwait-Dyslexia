import json
import shutil
from pathlib import Path

import pytest

from basira_ai.reference import ReferenceDataError, contracts_dir, load_reference_data, reference_data

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


@pytest.fixture(scope="module")
def ref():
    return reference_data()


def test_all_28_letters_load_and_resolve_by_char(ref):
    tax = ref.taxonomy
    assert len(tax.letters) == 28
    for letter in tax.letters.values():
        assert tax.letter_by_char(letter.char) is letter
        assert tax.letter_by_ipa(letter.ipa) is letter


def test_dot_confusions(ref):
    tax = ref.taxonomy
    assert tax.is_dot_confusion("thaa", "taa")  # ث / ت
    assert tax.is_dot_confusion("jiim", "khaa")  # ج / خ
    assert not tax.is_dot_confusion("thaa", "thaa")  # same letter is not a confusion
    assert not tax.is_dot_confusion("baa", "jiim")  # different skeletons
    assert not tax.is_dot_confusion("alif", "baa")  # alif has no dot group


def test_emphatic_confusions_are_symmetric(ref):
    tax = ref.taxonomy
    for a, b in [("saad", "siin"), ("daad", "daal"), ("ttaa", "taa"), ("zhaa", "dhaal")]:
        assert tax.is_emphatic_confusion(a, b)
        assert tax.is_emphatic_confusion(b, a)
    assert not tax.is_emphatic_confusion("saad", "daal")


def test_every_letter_group_and_pair_has_a_skill(ref):
    tax, skills = ref.taxonomy, ref.skills
    for letter_id in tax.letters:
        assert skills.letter_sound(letter_id) == f"ls.{letter_id}"
    for group in tax.dot_groups:
        assert skills.dot_discrimination(group) in skills
    for pair in tax.emphatic_pairs:
        assert skills.emphatic_contrast(pair) in skills
    assert skills.positional("initial") == "pos.initial"
    with pytest.raises(KeyError):
        skills.letter_sound("not_a_letter")


def test_kuwaiti_lexicon_accepts_dialect_variants_and_msa_does_not(ref):
    kw, msa = ref.lexicons.get("kw"), ref.lexicons.get("msa")
    rule = kw.accepted_variant("qaaf", "g")
    assert rule is not None and rule.id == "kw.qaaf-g"
    assert kw.accepted_variant("jiim", "j").id == "kw.jiim-j"
    assert kw.accepted_variant("kaaf", "tʃ").id == "kw.kaaf-tsh"
    assert kw.accepted_variant("qaaf", "k") is None  # not an accepted variant
    assert msa.accepted_variant("qaaf", "g") is None  # MSA lexicon accepts nothing


def test_rules_are_flagged_unconfirmed_until_reviewer_signs_off(ref):
    assert all(not r.confirmed for r in ref.lexicons.get("kw").rules)


def test_unknown_lexicon_raises(ref):
    with pytest.raises(KeyError):
        ref.lexicons.get("xx")


def test_env_override_and_broken_reference_detected(tmp_path, monkeypatch):
    copy = tmp_path / "contracts"
    shutil.copytree(CONTRACTS, copy)
    monkeypatch.setenv("BASIRA_CONTRACTS_DIR", str(copy))
    assert contracts_dir() == copy
    assert len(load_reference_data().taxonomy.letters) == 28

    lex = json.loads((copy / "dialect-lexicons.json").read_text(encoding="utf-8"))
    lex["lexicons"][1]["rules"][0]["letter"] = "no_such_letter"
    (copy / "dialect-lexicons.json").write_text(json.dumps(lex, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ReferenceDataError, match="unknown letter"):
        load_reference_data()


def test_missing_contracts_folder_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setenv("BASIRA_CONTRACTS_DIR", str(tmp_path / "nowhere"))
    with pytest.raises(ReferenceDataError, match="contracts folder not found"):
        contracts_dir()
