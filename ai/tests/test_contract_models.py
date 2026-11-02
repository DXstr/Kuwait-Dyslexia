"""The generated models must agree with the shared contract, its fixtures and its JSON Schema."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from basira_ai.contracts_gen import models

AI = Path(__file__).resolve().parents[1]
CONTRACTS = AI.parent / "contracts"
FIXTURES = sorted((CONTRACTS / "fixtures").glob("*.json"))


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def model_for(fixture: Path):
    return getattr(models, fixture.name.split(".")[0])


def test_fixtures_exist():
    assert FIXTURES, "contracts/fixtures is empty"


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda p: p.name)
def test_fixture_round_trips_through_generated_model(fixture: Path):
    data = load(fixture)
    parsed = model_for(fixture).model_validate(data)
    assert parsed.model_dump(mode="json", by_alias=True, exclude_unset=True) == data


def test_unknown_fields_are_rejected():
    data = load(CONTRACTS / "fixtures" / "ScoreItemResponse.dot-confusion.json")
    data["risk_score"] = 0.9
    with pytest.raises(ValidationError):
        models.ScoreItemResponse.model_validate(data)


def test_phoneme_score_is_bounded():
    data = load(CONTRACTS / "fixtures" / "ScoreItemResponse.dot-confusion.json")
    data["phonemes"][0]["score"] = 1.5
    with pytest.raises(ValidationError):
        models.ScoreItemResponse.model_validate(data)


def test_fingerprint_can_only_start_pending_review():
    data = load(CONTRACTS / "fixtures" / "FingerprintResponse.example.json")
    data["review_status"] = "approved"
    with pytest.raises(ValidationError):
        models.FingerprintResponse.model_validate(data)


def test_parent_report_cannot_carry_a_score():
    data = load(CONTRACTS / "fixtures" / "ParentReport.sample.json")
    data["score"] = 0.4
    with pytest.raises(ValidationError):
        models.ParentReport.model_validate(data)


def test_item_bank_rejects_items_that_failed_validation():
    data = load(CONTRACTS / "fixtures" / "ItemBank.sample.json")
    data["items"][0]["validation"]["passed"] = False
    with pytest.raises(ValidationError):
        models.ItemBank.model_validate(data)


def test_generated_models_are_up_to_date():
    result = subprocess.run(
        [sys.executable, str(AI / "scripts" / "gen_contracts.py"), "--check"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_contract_validator_passes():
    result = subprocess.run(
        [sys.executable, str(CONTRACTS / "tools" / "validate_contracts.py")], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
