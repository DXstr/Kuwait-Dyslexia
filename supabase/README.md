# Basira Supabase

B3 supplies the standalone database platform, private Storage policies and a server-only audio-cleanup function. It does **not** provision a hosted project, deploy functions, activate a hosted schedule or implement Google/Microsoft sign-in. OAuth provider integration is B4; web hosting remains Cloudflare Pages. No platform-specific OAuth, storage or database service is required.

## Local setup

Use Node.js 22+, a PostgreSQL client (`psql`) and Docker for the standard Supabase stack. The CLI is pinned to **3.0.0** in `package-lock.json`; upstream service resolutions are committed in `supabase.lock`.

From the repository root:

```sh
cd supabase
npm ci
npm start
npm run reset
npm run typecheck
npm run test:db
npm run test:unit
npm run test:integration
npx supabase db lint --local --level error --workdir ..
npm run stop
```

`npm start` first prepares an ignored `functions/.env` with a random local cleanup secret if the file is absent. It never overwrites existing configuration, rejects an existing weak/missing secret, and does not configure any hosted secret. The actual Deno integration test uses that disposable local file.

All CLI scripts explicitly use the repository root as `--workdir ..`. Reset is destructive **only to the disposable local database**, and applies all migrations followed by the labelled seed. Do not use local test commands against hosted data. The integration runner rejects any non-loopback API or database host before accessing it.

### Experimental native stack

Docker is the CI/default path. On Linux, CLI 3.0.0's experimental native stack was also verified with real Auth, PostgREST, Storage, database and Deno requests:

```sh
npm run prepare:local
SUPABASE_EXPERIMENTAL_STACK=1 npx supabase start --runtime native --preparation on-demand --workdir ..
SUPABASE_EXPERIMENTAL_STACK=1 npm run reset
SUPABASE_EXPERIMENTAL_STACK=1 npm run test:db
SUPABASE_EXPERIMENTAL_STACK=1 npm run test:integration
SUPABASE_EXPERIMENTAL_STACK=1 npm run stop
```

Keep that opt-in on every local-stack command; committed config leaves it off. The feature remains experimental, not a promise of support on every operating system. Both paths use stock Supabase, not another hosted application platform.

## Migrations and contracts

The migrations create exactly the twelve public tables documented in `../contracts/data-model.md`:

- `20261102000000_contract_validation.sql` is generated from the canonical JSON Schema, skill graph and dialect lexicons. It supplies the complete `ParentReport` schema and reference-ID constraints; no scorer type is redefined by hand.
- `20261102000100_platform.sql` creates `profiles`, `children`, `consents`, `sessions`, `item_results`, `tap_results`, `fingerprints`, `skill_mastery`, `plans`, `parent_reports`, `stage0_results` and `audit_log`, plus the role hook, database guards and RLS.
- `20261102000200_storage.sql` creates private `audio`/`reports` buckets, Storage policies, expiry helpers, service-only cleanup RPCs and the optional native scheduler setup function.

Regenerate and check contract-derived SQL with:

```sh
npm run generate:contracts
npm run check:contracts
```

The check is read-only and runs in `typecheck`/CI. For future approved contract changes **after deployment**, add a new forward migration rather than editing already-applied migrations; adapt the generator's output path for that migration. Full scorer-response validation remains B5. B3 stores scorer JSON unchanged and makes original evidence immutable; the database separately validates the entire parent-facing report shape to prevent raw/nested score fields being published.

## Security decisions

Profiles, not JWT `app_role` claims or user metadata, are authoritative. New Auth users receive a guardian profile; admin and professional roles require trusted provisioning. The custom access-token hook adds the profile-backed `app_role` for routing, but every database authorization rechecks current profile roles. A role change cannot leave children assigned to a non-guardian/non-specialist, or demote an examiner with an active assigned session: reassign children or close the active session first.

Consent scopes are `assessment`, `practice` and `audio_research`. Assessment, Stage 0 and probe sessions require current assessment consent; practice requires practice consent. Research consent alone never starts a session. Consents must match the child's guardian and specialist of record, and include timestamped evidence. Only the guardian signs through the authenticated API. Existing consent can be shortened/revoked, not rewritten or extended; a new grant is a new consent record. No seed fabricates consent.

Only the assigned specialist/admin creates sessions. Examiners cannot self-assign and access only their explicitly assigned Stage 0 sessions. Sessions start in progress with server time, and terminal sessions cannot be reopened. Guardians never read raw item/tap results, fingerprints, Stage 0 responses, mastery or audio. Parent-facing output is restricted to their own approved/delivered rows.

Review transitions are `draft → pending_review → approved → delivered`, with rejection possible only from pending review. Fingerprints begin pending review. Only the assigned specialist/admin approves or rejects. Approval attribution/time is server-owned, including clearing forged values while pending. Reviewed/terminal content is immutable; changes require a new draft. Every mutation and review transition is recorded in the append-only audit log; mastery history is append-only too.

For supervised child practice, use `public.approved_practice_plan(p_child_id)` rather than the specialist review table query. The RPC returns only the latest **approved** plan's ID and skill/item references; it never returns a draft, pending, rejected or delivered historical plan. The later practice UI must use this database-filtered path.

## Private Storage and retention

Object keys are `audio/{child_id}/{session_id}/{item_id}.wav` inside bucket `audio`, and `reports/{child_id}/{report_id}.pdf` inside bucket `reports`. The first segment is part of the object key, not a substitute for the bucket. Safe item filenames support Unicode, dots and spaces but exclude separators/control characters. Audio is WAV-only and capped at 10 MiB; reports accept PDF only.

Audio retention defaults to 30 days from session start. A valid, matching written research consent can extend that only until its own expiry. Shortening/expiry removes that extension immediately. RLS denies expired audio access even before physical deletion runs. Uploads also require current session consent. Audio cannot be overwritten, and report bytes can be inserted/updated only while the report is draft; pending/approved PDFs cannot be replaced, moved over or removed by authenticated callers.

`audio-cleanup` handles at most 100 expired items per request. It deletes real bytes through the Storage API, then acknowledges exact item-ID/object-path pairs. The database clears only a still-expired, matching pointer whose Storage metadata is absent. The scorer JSON and remaining evidence never change. Failed deletion/DB calls are surfaced and safely logged, and no failed batch is acknowledged. Tests use metadata-only SQL fixtures where needed; production code never deletes `storage.objects` rows directly.

See [`functions/audio-cleanup/README.md`](functions/audio-cleanup/README.md) for server-only environment and optional Supabase-native scheduling. Deployment must configure that function and schedule before automatic physical deletion is active; migrations alone do not claim it is running.

## Demo seed and tests

The seed contains six `.invalid` identities without passwords and two `is_demo = true` children. Every profile/child name includes `(ملف تجريبي)`. There are no seed consents, sessions, signatures, scores, audio or real child data. Seed accounts cannot sign in; B4's real Google/Microsoft integration is not replaced by a demo login.

`test:db` runs adversarial pgTAP tests for role isolation, cross-family access, consent bypasses, approval states, attribution, raw evidence, canonical references, auditing, Storage policies, retention and scheduler secrecy. `test:unit` covers cleanup failures/authentication/batch limits, deterministic contract generation and local-only environment preparation. `test:integration` uploads a silent synthetic WAV, proves its bytes are deleted before pointer acknowledgement, preserves canonical synthetic scorer JSON, checks canonical report validation and SQL-to-handler HMAC compatibility, exercises approved-PDF HTTP update/upsert/copy/move/delete denial, and authenticates the actual Deno entrypoint. It mints short-lived **localhost test JWTs** from the disposable stack key; this is not an application sign-in flow.

The CI database job installs the pinned toolchain, typechecks, starts Docker-backed Supabase, resets/seeds, runs pgTAP, function lint, unit tests and the live Storage integration tests, then always attempts shutdown. Existing web/AI/contract/security jobs remain intact. All new external components are recorded in `../docs/DISCLOSURES.md`.
