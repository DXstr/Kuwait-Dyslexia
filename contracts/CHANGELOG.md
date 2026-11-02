# Contracts changelog

## 0.2.0 — 2026-11-02
- Add `PromptTrigger`, `PromptClip`, `PromptBank`: pre-recorded voice prompts for Teach (ADR-003); fixture
  `PromptBank.sample.json`.
- Fix: `Item.options` written as `anyOf` [array, null] so generated models keep it nullable (datamodel-code-generator
  dropped the null from `type: ["array", "null"]`). No change to valid payloads.

## 0.1.0 — 2026-10-31
- First draft: scorer OpenAPI (stateless), shared JSON Schema, taxonomy (28 letters, 9 dot groups, 4 emphatic pairs),
  skill graph (53 skills), Kuwaiti dialect lexicon (3 unconfirmed rules), data model, 13 fixtures.
