# Decision log

Any departure from `docs/IDEA.md` or `docs/DESIGN.md` is written here, with its reason, before work continues.
Newest first.

| Date | Decision | Why | By | ADR |
| --- | --- | --- | --- | --- |
| 2026-11-02 | Teach uses pre-recorded, specialist-approved Arabic voice prompts (gender-neutral "let us" form) chosen from the scorer result; no live voice agent | Interactive feel without child audio reaching an LLM, without unreviewed sentences, at $0 | Ayman (proposed), Mahmoud (to approve) | ADR-003 |
| 2026-11-01 | Arabic first: every screen defaults to Arabic; child screens and parent PDF Arabic only; English only as a specialist/examiner switch | Children learn to read Arabic; English switch lets English-speaking judges follow the demo | Ayman | — |
| 2026-11-01 | Branches named by task code (`feat/a1-...`, `feat/b3-...`); tasks tracked as GitHub issues #1-#26 | Matches the issues and briefs; one issue = one branch = one PR | Ayman | — |
| 2026-11-01 | Repo transferred to `DXstr/Kuwait-Dyslexia` (Ayman admin, Mahmoud write) | Owner change agreed by the team | both | — |
| 2026-10-31 | Scorer is stateless; the web app stores results | Removes every code dependency between A and B; simpler hosting and tests | Ayman (proposed), Mahmoud (to approve) | ADR-001 |
| 2026-10-31 | Practice items generated offline, no runtime LLM | $0 cost, instant load, child data never reaches an LLM | both | ADR-001 |
| 2026-10-31 | Workstreams: A = Ayman (ai/, content/), B = Mahmoud (web/, supabase/) | Agreed in the Idea Lock sign-off | both | — |
