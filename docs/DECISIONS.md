# Decision log

Any departure from `docs/IDEA.md` or `docs/DESIGN.md` is written here, with its reason, before work continues.
Newest first.

| Date | Decision | Why | By | ADR |
| --- | --- | --- | --- | --- |
| 2026-10-31 | Scorer is stateless; the web app stores results | Removes every code dependency between A and B; simpler hosting and tests | Ayman (proposed), Mahmoud (to approve) | ADR-001 |
| 2026-10-31 | Practice items generated offline, no runtime LLM | $0 cost, instant load, child data never reaches an LLM | both | ADR-001 |
| 2026-10-31 | Workstreams: A = Ayman (ai/, content/), B = Mahmoud (web/, supabase/) | Agreed in the Idea Lock sign-off | both | — |
