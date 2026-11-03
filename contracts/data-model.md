# Data model (v0.2.0)

Implemented by workstream B in `supabase/migrations/`. Workstream A never reads or writes these tables
(the scorer is stateless, see `docs/ADR/ADR-001-architecture.md`). Columns that store scorer output hold
the scorer's JSON **unchanged** so the contract stays the single source of truth.

This is a proposed contract boundary. It does not approve or implement a migration or live storage before both
workstream owners review it.

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
| `probe_results` | `id` UUID primary key, `session_id` UUID UNIQUE NOT NULL FK `sessions.id`, `child_id` UUID NOT NULL FK `children.id`, `event_id` UUID NOT NULL, `response` JSONB = unchanged `ProbeResponse`, `synthetic` boolean, `created_at` timestamptz | One acknowledged result per probe session. UNIQUE (`child_id`, `event_id`) makes `event_id` the stable cycle identity within a child. `child_id` must equal the correlated session child; `response.session_id` and `session_id` must match; `synthetic` must equal `response.synthetic`. `created_at` is server-owned. |
| `skill_mastery` | `child_id`, `skill_id`, `mastery` 0–1, `updated_at`, `source_session_id` | Append-only history; current value = latest row |
| `plans` | `id`, `child_id`, `skill_ids` text[], `item_ids` text[], `review_status`, `approved_by`, `approved_at` | Proposed by the learning-map engine |
| `parent_reports` | `id`, `child_id`, `session_id`, `content` jsonb = `ParentReport`, `pdf_path`, `review_status`, `approved_by` | |
| `stage0_results` | `id`, `child_id`, `session_id`, `request` jsonb = `Stage0ScoreRequest`, `response` jsonb = `Stage0ScoreResponse`, `examiner_id`, `review_status` | |
| `audit_log` | `id`, `actor_id`, `action`, `table_name`, `row_id`, `before` jsonb, `after` jsonb, `at` | Append-only; no update/delete grants |

## Probe-result enforcement and consumer boundary

`probe_results` is the durable acknowledgement boundary for a real probe cycle. It is deliberately separate from
`item_results` and `fingerprints`: no probe payload may be tucked into either table or into client metadata.
The unchanged `ProbeRequest`/`ProbeResponse` JSON contracts and the scorer HTTP interface are not changed by this
row boundary, and this data-model document does not add a database-row JSON Schema definition.

### Write and access rules

- A server transaction may insert only for a `sessions` row whose `type` is `probe` and which has a valid,
  existing, unexpired consent for that child and the session's specialist of record (the existing `assessment`
  consent scope covers probe assessment). The actor must be a profile-backed `specialist` assigned to that child,
  or an `admin`; guardian and child identities cannot insert or read raw probe results. The trusted actor and
  child/session association come from server-side records, never client metadata.
- Before insertion, the server validates `response` against the unchanged canonical `$defs/ProbeResponse` and
  stores that JSON unchanged. It must reject a response whose `response.session_id` differs from `session_id`, a
  `child_id` that differs from the session's `child_id`, or a `synthetic` value that differs from
  `response.synthetic`. `id`, `created_at`, and the trusted actor identity are server-owned; clients cannot set
  or alter the timestamp.
- The row is insert-only evidence. There are no update or delete grants, including no mutable upsert that could
  replace evidence. `session_id` is unique, and (`child_id`, `event_id`) is unique. A retry with the same
  session, correlated child, stable event UUID, exact response JSON, and matching synthetic flag returns the
  existing identical row (including its original server timestamp) without updating it or creating a cycle.
  Any changed response, synthetic marker, session/child association, or event identity is a conflict and fails;
  a new event UUID cannot create a second result for the same session.
- Successful probe-result writes and successful session transitions use the append-only `audit_log`. A SQL
  exception rolls back audit inserts made in the same transaction, so rejected conflicts and other failed writes
  must not be described as logged here. Logging rejected attempts would require an explicitly committed safe-error
  boundary, which is outside this proposal. Normal failed writes are safely refused.
- Probe finalization is atomic: the server must acknowledge an actual validated `probe_results` row before it
  declares the probe session `completed` or exposes any server-side `probe_done` state. The completion transition,
  its evidence check, and its audit entry are one server-controlled transaction; a UI-only publication gate is not
  sufficient. A completed probe without an acknowledged canonical result is invalid.

### Consumer semantics for B8

B8 consumes only the durable acknowledged row and correlates it as follows:

| Consumer field | Source |
| --- | --- |
| `eventId` | `probe_results.event_id` |
| `sessionId` | `probe_results.session_id` |
| `childId` | correlated `probe_results.child_id` |
| `at` | server-owned `probe_results.created_at` |
| `completed` | true only when the actual probe session is `completed` **and** its canonical result is acknowledged in `probe_results` |
| probe payload | `probe_results.response`, preserved unchanged |

B8 must not infer a completed event from practice accuracy, `probe_done` alone, stored mastery, a row timestamp,
or a fixture/cached in-tab result. Missing, insufficient, or incomplete probe evidence does not count toward
provisional transfer/no-gain; the consumer uses the existing canonical `transfer` state (`transfer_shown`,
`no_transfer_yet`, or `insufficient_data`) without adding clinical adequacy thresholds, norms, formulas, or
licence claims. Retry timestamps cannot manufacture a new cycle. Any new plan or report publication continues to
use the existing specialist approval gates.

### Synthetic persisted-cycle example (not a real result)

The following metadata association is **synthetic only**. Its `response` is the separately validated canonical
example [`contracts/examples/ProbeResponse.persisted-cycle.synthetic.json`](examples/ProbeResponse.persisted-cycle.synthetic.json);
it is not a real child's result and must remain visibly synthetic wherever shown:

```yaml
synthetic_example_only: true
session_id: 11111111-1111-4111-8111-111111111111
child_id: 22222222-2222-4222-8222-222222222222
event_id: 33333333-3333-4333-8333-333333333333
response_example: contracts/examples/ProbeResponse.persisted-cycle.synthetic.json
synthetic: true
created_at: server-owned
```

The payload's `response.session_id` is the same UUID as this example's `session_id`; the database row must also
correlate `child_id` to that session rather than trusting this illustrative metadata.

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
