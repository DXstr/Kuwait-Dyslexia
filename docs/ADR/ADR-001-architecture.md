# ADR-001: Modular architecture with a stateless scorer

- Status: Proposed — both must approve in the first PR review
- Date: 2026-10-31
- Deciders: Ayman (A), Mahmoud (B)

## Context

Two people with separate Claude sessions must build in parallel for a 5 November 2026 deadline, at zero hosting cost,
without editing each other's code. The System Design doc originally had the scorer write results to Supabase.

## Decision

1. Monorepo with one owner per folder; `contracts/` is the only shared interface.
2. **The scorer is stateless.** It receives audio + metadata (or prior results for `/fingerprint` and `/probe`) and returns
   contract JSON. It holds no database credentials. The web app persists everything.
3. The scorer exposes the REST API in `contracts/scorer.openapi.yaml`. Whatever host is used must serve that REST API;
   if a Hugging Face ZeroGPU (Gradio) Space cannot, the scorer runs on Cloud Run instead. The contract does not change
   with the host.
4. Practice items and their audio are generated offline, validated, reviewed and shipped as static files. No runtime LLM.
5. Hosting: Cloudflare Pages, Supabase Free, HF ZeroGPU Space or Cloud Run; docker compose for development.

## Consequences

- A never depends on B's schema; B can finish the whole app against `contracts/fixtures/`.
- Integration is one test: real audio → scorer → contract-valid JSON → stored and shown in the specialist screen.
- Trade-off: a client could in principle tamper with scores before storing them. Acceptable for the competition demo
  (only specialists can write results, under RLS). Later fix: the scorer signs responses (HMAC) and a database function
  verifies the signature on insert. Logged as a known limitation.
- Cold starts and sleeping free tiers are handled by warm-up pings and a daily keep-alive job.
