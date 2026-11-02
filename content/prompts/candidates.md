# Prompt used to author the candidate items in `content/source/`

The candidates were written offline by an LLM (Claude, model `claude-opus-5-5`, in a Claude Code session on
2026-11-02). The model received **only** the skill targets and the constraints below — never child audio, names,
results or any other child data (non-negotiable 7). Every candidate then goes through the deterministic validators in
`ai/basira_ai/content/validators.py`; any that fail are discarded, never repaired (non-negotiable 8). All candidates
ship as `review.status = "unreviewed"` until an Arabic-language specialist approves them.

## Prompt

> You are writing practice items for Arabic-speaking primary-school children (grades 2–6) who are learning to read
> Modern Standard Arabic. Write fully vowelled MSA (every letter carries its fatha, kasra, damma, sukun, shadda or
> tanwin; long-vowel letters and the article follow standard school spelling). Use only common, child-appropriate
> vocabulary; no violence, religion-specific content, brands or real people.
>
> 1. **Minimal pairs** for each skill target below: two real words that differ in exactly one letter at the same
>    position, with identical vowel marks, where the two letters are the target contrast.
>    - dot groups: ب ت ث ن ي · ج ح خ · د ذ · ر ز · س ش · ص ض · ط ظ · ع غ · ف ق
>    - emphatic vs plain: ص/س · ض/د · ط/ت · ظ/ذ
> 2. **Real words** for decoding practice, tagged grade band `2-3` (2–6 letters) or `4-6` (3–9 letters).
> 3. **Short passages** (grade band `2-3`: 8–30 words; `4-6`: 15–60 words) of simple narrative or factual text. Avoid
>    a conjunction or preposition fused to the article (وَال، بِال، لِل) and words normally written with a dagger alif
>    (هذا، ذلك), because the reference pronunciation reads each word in isolation.
>
> Give an English gloss for every word or passage so a non-Arabic reviewer can follow it.

Pseudowords, letter-sound items and vowel-tap items are not authored by the LLM; they are generated
deterministically by `ai/basira_ai/content/generate.py`.
