# Basira (بصيرة) — Idea Lock

Locked 2026-10-31 by Ayman and Mahmoud. Live version: https://claude.ai/artifact/BznYqAfET2AvLxaPRLHyrP
(this file is the repo copy; if they differ, raise it in the daily check-in and fix both).

Basira listens to primary-school children read Arabic aloud, scores each sound while respecting their Kuwaiti dialect,
builds a personal learning map from their errors, adapts practice session by session, and sends parents a plain-language
PDF with the home part of the plan. Specialists review every flag and plan; nothing here diagnoses.

## The idea

- **Problem.** Kuwaiti children speak Kuwaiti Arabic at home but are taught and assessed in MSA. Existing tools ignore
  dialect, so a child who reads correctly in their own dialect gets marked wrong. Specialists score by ear, one child at a
  time, with no structured progress record, and treatment stops at the clinic door.
- **Users.** Children grades 2–6 (focus 2–4) speaking Kuwaiti/Gulf Arabic; specialists and learning-support teachers;
  parents, who carry the home part of the plan.
- **What it does.** Child reads a known passage → forced alignment to expected sounds → per-phoneme score, dialect
  variants accepted → Arabic error categories → personal learning map → next practice → unseen-passage probes check
  transfer → specialist approves a parent PDF with the home plan.
- **Why different.** No system found combines dialect-aware phoneme scoring, an Arabic error taxonomy, explainable
  referral rules, an adaptive learning map and a parent-in-the-loop plan. Closest: Hussein et al. (2025) — classifies
  dyslexia type from audio; no dialect awareness, no taxonomy-level scoring, no learning loop.

## The loop

Listen → Fingerprint → Learning map → **Specialist approves** → Teach → Prove → (next session) Listen.
Specialist approval also releases the Parent PDF after each session.

## Locked scope (build order)

| Order | Feature | Competition build | Owner |
| --- | --- | --- | --- |
| 1 | Listen | Letter-sounds, real words, pseudowords, passage; forced alignment + per-phoneme score | A |
| 1 | Dialect lexicon | Per-child accepted variants; 3–4 Gulf rules (ق→g, ج→j, ك→tʃ), reviewer-confirmed | A |
| 2 | Fingerprint | Error categories, session features, rough-set referral rules + "specialist decision needed" region | A |
| 2 | Specialist review screen | Confirm flags, approve plan and parent PDF | B |
| 3 | Adaptive learning map | Skill graph, mastery per skill, next plan, re-tailor every session | B (graph data: A) |
| 3 | Progress tracking | Child profile, multi-session history, per-skill progress | B |
| 4 | Teach | Validated pre-generated practice; tracing, cues, articulation, mnemonics; no red | B (items: A) |
| 4 | Prove | Unseen-passage probe; practised vs unseen side by side | A scores, B runs/screens |
| 5 | Parent session PDF | Arabic plain-language summary + home plan, specialist-approved | B |
| 5 | Hosted demo | Judges try it in a browser with labelled demo profiles; rate-limited | B (scorer host: A) |
| Alongside | Stage 0 battery | All 7 constructs: digital administration, instrument scoring, examiner-gated; unlicensed items run as `LICENSE PENDING` placeholders, never invented substitutes | A scoring + norms, B examiner screens + consent gate |

Deadline: 5 November 2026. Whatever ships must be complete end to end.

## Stage 0 constructs

1. ITPA, Arabic-normed (candidate norms: Azzam 2007, Ain Shams; full thesis requested).
2. Directional/reversal screening (Houbben & Vannuscorps 2022) — supplementary only.
3. Nonverbal IQ screening (e.g. Raven's variant, regional norms) — exclusionary only.
4. Visual agnosia screening from a published protocol (physician to confirm inclusion).
5. Dyscalculia screening (2025 comorbidity review).
6. Phonological awareness (rhyme, blending, segmentation, syllables), Arabic and dialect-aware.
7. Reading speed and fluency: timed passages, WCPM with age-band norms.

All feed the same child record. Consent gate: no session without a recorded, timestamped guardian consent tied to a
specialist of record, plus ethics sign-off before any real child; enforced in code.

## Adaptive learning map

- Skills: letter–sound per letter; dot-discrimination sets; emphatic pairs; short vowels; positional forms; real and
  pseudo word decoding; passage fluency (`contracts/skill-graph.json`).
- Evidence: audio (scorer `skill_evidence`), taps (short vowels — the speech model cannot hear them), probes (transfer).
- Rule: mastery 0–1; < 0.6 working on, 0.6–0.85 growing, > 0.85 probe due. Mastered only after a probe shows transfer.
  Each session: mostly the weakest unlocked skill + review of growing skills. No gain after N probe cycles → flag for
  specialist. Specialist sees mastery over time; parents see only plain words.

## Parent session report

Contains: what was practised, encouraging notes, 2–3 home activities (5–10 min) with words and how to cue kindly, next
focus, specialist contact. Never: scores, counts, percentages, risk, "dyslexia", labels, comparisons, audio.
Arabic; downloaded from the specialist screen in the competition build.

## Mouth-shape generator

`phonetics/arabic_inventory.json` (IPA, place, manner, voicing, emphatic, rendering notes; verified against Watson 2002)
drives a parametric mouth model (jaw, lip rounding, lip closure, tongue tip, tongue dorsum, pharyngeal constriction).
Vowels/sukun are modifiers → all 28 letters × each vowel modifier, each shape reviewed by a linguist/SLP. Child sees a
friendly front-facing mouth; the sagittal view is for the specialist.

## Engineering standards

Arabic first: every screen, message, audio prompt and document defaults to Arabic; child screens and the parent PDF
are Arabic only; English exists only as an optional switch on specialist/examiner screens for English-speaking judges.
Browser-based, tablet width. OAuth2/OIDC roles (guardian, child-supervised, specialist, examiner, admin) proven with two
identity providers; PostgreSQL; secrets from env + CI secret scan; Docker/compose and a fresh-environment deploy proven
from docs; approval state machine in code; CI unit tests; WCAG 2.1 AA; honest status; errors surfaced; children's data
treated as regulated with a written data-protection review; security, accessibility and load passes before launch.

## Non-negotiables

See `CLAUDE.md` (13 rules, identical to the Idea Lock).

## Claims

| We can say | We cannot say |
| --- | --- |
| Scoring works on controlled synthetic speech with known injected errors (re-run on the rebuilt pipeline) | It detects dyslexia, or any accuracy on children |
| Lexicon dialect variants are not flagged (measured rate, synthetic) | It is fair to all Kuwaiti children |
| Referral rules are readable, demonstrated on synthetic data | The rules are accurate or validated |
| The learning map adapts practice to each child's error profile | Practice improves reading |
| Short-vowel skills are measured through tap tasks | The system hears short-vowel errors |
| A 40–60 child pilot is designed with targets | The pilot has been run |
| No system found combines all five parts (Hussein et al. 2025 differentiated) | No one else uses AI for Arabic dyslexia |

## Prior work

Clean-room rebuild. Keep as requirements: problem, loop, taxonomy, psychological-safety rules, consent/ethics, Stage 0
constructs, prior-art comparisons (SARD, 2011 IJCIS rough sets, Hazoury et al. 2009, Hussein et al. 2025).
Discard all old code and the 16-profile rule table.
