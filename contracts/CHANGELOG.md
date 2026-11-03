# Contracts changelog

## phonetic-inventory.json 0.2.0 — 2026-11-03
- Specialist review: all 28 letters and 8 vowel modifiers approved by R1 (psychologist; name withheld at the
  reviewer's request), no corrections (review pack of 2026-11-02). Schema unchanged (still contracts 0.4.0).

## 0.4.0 — 2026-11-03
- Add `Stage0TaskSet`, `Stage0Block`, `Stage0TaskItem`, `Stage0Option`, `TaskReview`: Basira-authored Stage 0
  screening tasks (published task format, entirely new generated items, raw score only, "not standardized" notice).
  Fixtures `Stage0TaskSet.orientation-sample.json` and `Stage0TaskSet.number-sense-sample.json`. Additive: no
  existing payload changes. Task files: `content/dist/stage0/<instrument_id>.json`.

## 0.3.0 — 2026-11-02
- Add `PhoneticInventory`, `PhoneticLetter`, `MouthShape`, `VowelModifier`, `PhoneticReview` (A12) and the data
  file `phonetic-inventory.json` (28 letters + 8 vowel modifiers, all unreviewed); fixture `PhoneticInventory.sample.json`.
- `validate_contracts.py` check 6: the inventory validates and agrees with `taxonomy.json` (ids, char, IPA, emphatic).

## 0.2.0 — 2026-11-02
- Add `PromptTrigger`, `PromptClip`, `PromptBank`: pre-recorded voice prompts for Teach (ADR-003); fixture
  `PromptBank.sample.json`.
- Fix: `Item.options` written as `anyOf` [array, null] so generated models keep it nullable (datamodel-code-generator
  dropped the null from `type: ["array", "null"]`). No change to valid payloads.

## 0.1.0 — 2026-10-31
- First draft: scorer OpenAPI (stateless), shared JSON Schema, taxonomy (28 letters, 9 dot groups, 4 emphatic pairs),
  skill graph (53 skills), Kuwaiti dialect lexicon (3 unconfirmed rules), data model, 13 fixtures.
