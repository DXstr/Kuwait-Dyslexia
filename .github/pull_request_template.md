## What changed
<!-- One or two sentences. Link the issue: Closes #NN -->

## Workstream
- [ ] A (ai/, content/)  - [ ] B (web/, supabase/)  - [ ] Contracts (both must approve)

## How I tested it
<!-- Commands run, real inputs used, screenshots for UI. "Nobody marks their own feature done": the reviewer re-tests. -->

## Contract impact
- [ ] None
- [ ] Uses an existing contract unchanged
- [ ] Changes `contracts/` (version bumped, CHANGELOG updated, fixtures updated, validator passes)

## Non-negotiables check
- [ ] No score, label, risk level or "wrong" shown to a child or parent; no red in child screens
- [ ] Synthetic / fixture data is labelled where it is shown
- [ ] Approval gate and consent gate are respected (nothing reaches a child/parent unapproved)
- [ ] No child data sent to an LLM; no secrets committed
- [ ] New dependencies listed in `docs/DISCLOSURES.md`
- [ ] Anything unfinished is stated here, not hidden behind a mock
