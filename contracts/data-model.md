# Data model (v0.1.0)

Implemented by workstream B in `supabase/migrations/`. Workstream A never reads or writes these tables
(the scorer is stateless, see `docs/ADR/ADR-001-architecture.md`). Columns that store scorer output hold
the scorer's JSON **unchanged** so the contract stays the single source of truth.

## Roles

`profiles.role` ∈ `guardian | specialist | examiner | admin`. A Supabase custom access token hook copies the
role into the JWT claim `app_role` (the scorer requires it). Children never sign in; a child session runs
under the supervising specialist's or examiner's login.

## Tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= auth.users.id), `role`, `display_name` | |
| `children` | `id` uuid, `first_name`, `grade` 1–6, `birth_month` (yyyy-mm), `dialect_lexicon_id` (from `contracts/dialect-lexicons.json`), `guardian_id`, `specialist_id`, `is_demo` bool | Pseudonymous; no national id, no school name. Demo rows have `is_demo=true` and the UI labels them "seed data" |
| `consents` | `id`, `child_id`, `guardian_id`, `specialist_id`, `scope` (`assessment`, `practice`, `audio_research`), `signed_at`, `expires_at`, `evidence_path`, `ethics_ref` | Trigger: no `sessions` insert without a valid, unexpired consent covering the session type |
| `sessions` | `id`, `child_id`, `type` (`stage0`, `assessment`, `practice`, `probe`), `status` (`in_progress`, `completed`, `abandoned`), `started_at`, `ended_at`, `run_by` | |
| `item_results` | `id`, `session_id`, `item_id`, `response` jsonb = `ScoreItemResponse`, `audio_path`, `audio_expires_at`, `synthetic` | `response` validated against the contract in the web client before insert |
| `tap_results` | `id`, `session_id`, `item_id`, `evidence` jsonb = `SkillEvidence` | Short-vowel and discrimination taps |
| `fingerprints` | `id`, `session_id`, `response` jsonb = `FingerprintResponse`, `review_status`, `reviewed_by`, `reviewed_at`, `review_note` | |
| `skill_mastery` | `child_id`, `skill_id`, `mastery` 0–1, `updated_at`, `source_session_id` | Append-only history; current value = latest row |
| `plans` | `id`, `child_id`, `skill_ids` text[], `item_ids` text[], `review_status`, `approved_by`, `approved_at` | Proposed by the learning-map engine |
| `parent_reports` | `id`, `child_id`, `session_id`, `content` jsonb = `ParentReport`, `pdf_path`, `review_status`, `approved_by` | |
| `stage0_results` | `id`, `child_id`, `session_id`, `request` jsonb = `Stage0ScoreRequest`, `response` jsonb = `Stage0ScoreResponse`, `examiner_id`, `review_status` | |
| `audit_log` | `id`, `actor_id`, `action`, `table_name`, `row_id`, `before` jsonb, `after` jsonb, `at` | Append-only; no update/delete grants |

## Approval state machine

```
draft → pending_review → approved → delivered
              └────────→ rejected
```

Applies to `fingerprints`, `plans`, `parent_reports`, `stage0_results`.

- Only the child's `specialist_id` (or an `admin`) may set `approved` or `rejected`; enforced by a trigger.
- Guardians may `select` only `approved` / `delivered` rows of their own children (row-level security).
- Child-facing practice reads only `approved` plans.
- Every transition inserts into `audit_log`.
- Tests for each rule live in `supabase/tests/` and run in CI.

## Storage

Bucket `audio` (private): `audio/{child_id}/{session_id}/{item_id}.wav`, deleted at `audio_expires_at`
(default 30 days) unless a consent with scope `audio_research` exists. Bucket `reports` (private): parent PDFs.
