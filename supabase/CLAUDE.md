# supabase/ — owned by Mahmoud (workstream B)

Read the root `CLAUDE.md` and `contracts/data-model.md` first; the tables, roles and approval state machine there are
the contract. Changing a table shape documented in `data-model.md` needs a contracts PR.

- Migrations only (`supabase/migrations/`); never edit the hosted database by hand.
- Consent and approval rules are enforced by triggers + row-level security, not by the UI.
- Every policy and trigger has a test in `supabase/tests/` that runs in CI, including attempts to bypass consent.
- Seed data: demo profiles only, `is_demo = true`, names marked "(ملف تجريبي)".
- The service-role key never reaches the browser or the repo.
