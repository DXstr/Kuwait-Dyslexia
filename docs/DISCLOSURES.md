# External components and licences

Required by the competition and by non-negotiable 10. Add a row in the same PR that adds the dependency.

| Component | Used for | Licence / terms | Added by | Verified |
| --- | --- | --- | --- | --- |
| facebook/wav2vec2-xlsr-53-espeak-cv-ft | Phoneme acoustic model (Listen, primary) — ADR-002 | Apache-2.0 | A3 | 2026-11-01 |
| jonatasgrosman/wav2vec2-large-xlsr-53-arabic | Arabic letter acoustic model (emphatics, خ/ح) — ADR-002 | Apache-2.0 | A3 | 2026-11-01 |
| torch | Running the acoustic models (optional `model` extra) | BSD-3-Clause | A3 | 2026-11-01 |
| transformers | Loading the acoustic models (optional `model` extra) | Apache-2.0 | A3 | 2026-11-01 |
| librosa | Audio loading/resampling (optional `model` extra) | ISC | A3 | 2026-11-01 |
| soundfile | Audio decoding (optional `model` extra) | BSD-3-Clause | A3 | 2026-11-01 |
| gTTS (research notebooks only) | Synthetic Arabic test audio in Colab experiments; never shipped | MIT (client); uses Google Translate TTS | A3 | 2026-11-01 |
| FastAPI | Scorer HTTP API (`service` extra) | MIT | A6 | 2026-11-01 |
| uvicorn | ASGI server for the scorer | BSD-3-Clause | A6 | 2026-11-01 |
| python-multipart | Audio upload parsing | Apache-2.0 | A6 | 2026-11-01 |
| PyJWT (+ cryptography) | Supabase token verification | MIT (cryptography: Apache-2.0 / BSD) | A6 | 2026-11-01 |
| httpx | Test client (dev only) | BSD-3-Clause | A6 | 2026-11-01 |
| pydantic | Contract data models in `ai/` (runtime) | MIT | A1 | 2026-11-01 |
| datamodel-code-generator | Generates `ai/basira_ai/contracts_gen/models.py` from the schema (dev only) | MIT | A1 | 2026-11-01 |
| black, isort | Formatting used by the model generator (dev only) | MIT | A1 | 2026-11-01 |
| pytest | Tests (dev only) | MIT | A1 | 2026-11-01 |
| ruff | Lint (dev only) | MIT | A1 | 2026-11-01 |
| numpy | Alignment and scoring math in `ai/` (runtime) | BSD-3-Clause | A3 | 2026-11-01 |
| jsonschema | Contract validation (dev/CI only); also validates the built item bank against `$defs/ItemBank` (content build, offline) | MIT | bootstrap, A11 | 2026-11-02 |
| Azure AI Speech, text-to-speech (voice `ar-YE-MaryamNeural`, pitch +9%, rate -20%) | Pre-rendered item audio in `content/dist/audio/` and Teach voice prompts in `content/dist/prompt-audio/` (A14, ADR-003), built offline once; every clip is synthetic (`synthetic_audio = true`); no child data is sent | Microsoft Product Terms for Azure AI services (paid/free Azure subscription); no runtime calls from the app | A11 | 2026-11-02 |
| Claude (Anthropic, `claude-opus-5-5`) | Authored the candidate words, minimal pairs and passages in `content/source/` offline; the prompt held only skill targets and constraints (`content/prompts/candidates.md`); every candidate passes deterministic validators and is shipped `unreviewed` | Anthropic Commercial/Consumer Terms; outputs owned by the user | A11 | 2026-11-02 |
| react, react-dom | Standalone web UI | MIT | B1 | 2026-11-02 |
| react-router-dom | Role-based client navigation (not database authorization) | MIT | B1 | 2026-11-02 |
| @fontsource/noto-naskh-arabic | Self-hosted Arabic/diacritic font; copyright 2022 The Noto Project Authors; licence shipped in `web/public/licenses/` | [OFL-1.1](https://fontsource.org/fonts/noto-naskh-arabic/about) | B1 | 2026-11-02 |
| typescript | Web type checking (dev only) | Apache-2.0 | B1 | 2026-11-02 |
| vite, @vitejs/plugin-react | Static web build and local server (dev only) | MIT | B1 | 2026-11-02 |
| vite-plugin-pwa, Workbox | Install manifest and static-shell-only service worker; build tooling and generated worker | MIT | B1 | 2026-11-02 |
| vitest, jsdom | Unit/component test runner and DOM (dev only) | MIT | B1 | 2026-11-02 |
| @testing-library/react, @testing-library/jest-dom, @testing-library/user-event | Accessible UI assertions and interactions (dev only) | MIT | B1 | 2026-11-02 |
| @playwright/test | Chromium browser tests (dev/CI only), including the B11 Arabic print/PDF route evidence | Apache-2.0 | B1, B11 | 2026-11-04 |
| eslint, @eslint/js, typescript-eslint, globals | Web lint configuration and language rules (dev only) | MIT | B1 | 2026-11-02 |
| eslint-plugin-react-hooks, eslint-plugin-react-refresh | React lint rules (dev only) | MIT | B1 | 2026-11-02 |
| @types/node, @types/react, @types/react-dom | Type declarations (dev only) | MIT | B1 | 2026-11-02 |
| json-schema-to-typescript 16.0.0 | Generates web contract types from the canonical JSON Schema; read-only drift checks (dev/CI only) | [MIT](https://github.com/bcherny/json-schema-to-typescript/blob/master/LICENSE) | B2 | 2026-11-02 |
| Supabase CLI 3.0.0 | Pinned local/CI stack and migration/test commands; service versions in `supabase/supabase.lock` | [MIT](https://github.com/supabase/cli/blob/develop/LICENSE) | B3 | 2026-11-02 |
| pg_jsonschema | Database validation of parent-facing JSON using generated canonical `ParentReport` schema | [Apache-2.0](https://github.com/supabase/pg_jsonschema/blob/master/LICENSE) | B3 | 2026-11-02 |
| pgTAP | Adversarial database policy/trigger tests (dev/CI only) | [PostgreSQL](https://github.com/theory/pgtap#copyright-and-license) | B3 | 2026-11-02 |
| pg_cron | Supabase-native five-minute audio cleanup scheduling; activation requires deployment configuration | [PostgreSQL](https://github.com/citusdata/pg_cron/blob/main/LICENSE) | B3 | 2026-11-02 |
| pg_net | Supabase-native HTTP invocation of the cleanup function | [Apache-2.0](https://github.com/supabase/pg_net/blob/master/LICENSE) | B3 | 2026-11-02 |
| Supabase Vault | Server-only encrypted cleanup scheduling secret | [Apache-2.0](https://github.com/supabase/vault/blob/main/LICENSE) | B3 | 2026-11-02 |
| Supabase Edge Runtime, Deno | Server-only cleanup function using Fetch/Web Crypto; no third-party JavaScript runtime dependencies | [MIT](https://github.com/supabase/edge-runtime/blob/main/LICENSE), [MIT](https://github.com/denoland/deno/blob/main/LICENSE.md) | B3 | 2026-11-02 |
| pgcrypto | PostgreSQL HMAC-SHA256 for short-lived cleanup scheduler signatures; long-lived secret remains in Vault | [PostgreSQL](https://www.postgresql.org/about/licence/) | B3 | 2026-11-02 |
| typescript 6.0.3, @types/node 26.6.6 | Strict checking of database cleanup/tooling/tests (dev/CI only), matching the existing web toolchain | Apache-2.0, MIT | B3 | 2026-11-02 |
| Supabase Auth (GoTrue) | Standard backend authentication service; Google integration is B4 under the recorded Google-only scope | [MIT](https://github.com/supabase/auth/blob/master/LICENSE) | B3 | 2026-11-02 |
| Supabase Storage | Private audio/PDF objects and API-based deletion | [Apache-2.0](https://github.com/supabase/storage/blob/master/LICENSE) | B3 | 2026-11-02 |
| PostgREST | Standard Supabase Data API with PostgreSQL RLS | [MIT](https://github.com/PostgREST/postgrest/blob/main/LICENSE) | B3 | 2026-11-02 |
| PostgreSQL | Canonical relational data, transactions, roles and audit/approval triggers | [PostgreSQL](https://www.postgresql.org/about/licence/) | B3 | 2026-11-02 |
| @supabase/supabase-js 2.118.0 | Official browser SDK for Supabase Google PKCE sign-in, server-verified identity and RLS-protected profile lookup | [MIT](https://github.com/supabase/supabase-js/blob/master/LICENSE) | B4 | 2026-11-02 |
| Google OAuth / OpenID Connect | Adult identity provider through Supabase Auth; activation requires a real registration | [Google APIs Terms of Service](https://developers.google.com/terms) and applicable user-data policies | B4 | 2026-11-02 |
| ajv 8.20.0 | Browser-side, non-mutating JSON Schema draft 2020-12 validation of canonical scorer requests, responses and errors | [MIT](https://github.com/ajv-validator/ajv/blob/master/LICENSE) | B5 | 2026-11-02 |
| ajv-formats 3.0.1 | Canonical date/date-time format checks in contract validators; no remote schema fetching | [MIT](https://github.com/ajv-validator/ajv-formats/blob/master/LICENSE) | B5 | 2026-11-02 |
| Cloudflare Pages | Static deployment of the Vite frontend from `web/dist`; no runtime platform API or Manus dependency | [Cloudflare Pages terms](https://developers.cloudflare.com/pages/) | B13 | 2026-11-03 |
| GitHub Actions / `ubuntu-latest` runner | Optional scheduled read-only Supabase PostgREST keep-alive; uses the runner’s built-in `curl`, with no added package | [GitHub Actions terms and documentation](https://docs.github.com/en/actions) | B13 | 2026-11-03 |
| cloudflare/wrangler-action v3.9.0 (immutable commit `9681c2997648301493e78cacbfb790a9f19c833f`) | Official GitHub Action that installs Wrangler for the optional Direct Upload of `web/dist` to Cloudflare Pages; no web runtime dependency | [Apache-2.0](https://github.com/cloudflare/wrangler-action) | B13 | 2026-11-04 |
| Hugging Face Spaces (ZeroGPU hardware) | Hosts the stateless scorer API; models run on the Space CPU; audio is scored in memory and not stored by our code | [Hugging Face Terms of Service](https://huggingface.co/terms-of-service) | A13 | 2026-11-04 |
| gradio 5.49.1 | Required by the Space SDK; one-page API notice at `/ui`, not used for scoring | Apache-2.0 | A13 | 2026-11-04 |
| spaces 0.51.3 | ZeroGPU runtime on the Space (includes bundled third-party code under its own licences) | Apache-2.0 | A13 | 2026-11-04 |
| huggingface_hub | Downloads the model files (`model` extra); uploads the Space from the deploy script | Apache-2.0 | A3, A13 | 2026-11-04 |
| B12 Stage 0/consent browser coverage | Synthetic loopback Playwright tests only; uses the existing `@playwright/test` dependency and no external service, child data, browser microphone or native-browser interaction | Apache-2.0 (existing dependency; no new dependency) | B12 | 2026-11-04 |


## B9 Teach disclosure

B9 Teach adds no external runtime component or service. It uses the already disclosed React, Supabase SDK, canonical contract validation, self-hosted Noto Naskh Arabic font, and Playwright/Vitest development tooling; reviewed item-bank audio and phonetic inventory data remain repository assets, with no child data sent to a model or external generator.
