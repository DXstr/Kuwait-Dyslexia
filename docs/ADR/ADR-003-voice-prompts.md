# ADR-003: Pre-recorded voice prompts, not a live voice agent

- Status: Proposed (in the `contract/voice-prompts` PR; Mahmoud to approve)
- Date: 2026-11-02
- Decider: Ayman (A), with Mahmoud (B) as approver

## Context

The Teach stage already promises "cues" (`docs/IDEA.md`, stage 4). The team wants practice to feel interactive: the
child should hear a voice that reacts to what they just read. A live speech-to-speech agent (e.g. Azure Voice Live /
GPT-4o realtime) was considered and rejected for this release because it would:

- stream child audio to an LLM (breaks non-negotiable 7 and the "no runtime LLM" decision, ADR-001);
- produce unreviewed sentences on the fly that could say "wrong" or imply a label (non-negotiables 2 and 4);
- be billed per minute (breaks zero-cost hosting) and be impossible to audit in advance.

## Decision

Basira plays **pre-recorded Arabic voice prompts**, chosen by the app from the scorer result:

1. A fixed set of short prompt clips is written offline, validated deterministically (script, full diacritics, no
   word meaning "wrong" or "mistake"), rendered once with the same TTS voice as the item bank, and approved by a
   specialist before it reaches a child. Unapproved prompts are not played to children.
2. Each clip has a `trigger` (`$defs/PromptTrigger`): `session_start`, `listen_repeat`, `item_correct`,
   `item_retry` (the neutral retry cue of non-negotiable 3), `hint_dot_confusion`, `hint_emphatic_confusion`,
   `hint_short_vowel`, `hint_positional`, `session_end`. Omission, insertion and substitution use `item_retry`.
3. The app (B) maps the item's scorer result to a trigger, plays one clip for it (several variants per trigger, chosen
   at random so it does not feel robotic), then may replay the item's model audio.
4. Prompts are gender-neutral: first-person plural ("هَيَّا نُحَاوِلُ مَرَّةً أُخْرَى", let us try again), so the app
   never needs the child's gender.
5. Output: `content/dist/prompt-bank.json` (+ `audio/`), valid against `$defs/PromptBank`, produced by the A11
   content pipeline (task A14). Played by the Teach screens (task B14).

## Consequences

- The child hears a responsive voice while every sentence is known, reviewed and free to serve.
- Prompt audio is TTS: `synthetic_audio = true`, disclosed with the engine in `docs/DISCLOSURES.md`.
- A dialect variant (non-negotiable 5) is never a hint trigger: it plays `item_correct`.
- A live conversational agent stays on the post-competition roadmap, only with parental consent, a privacy review and
  a design that keeps child audio away from any LLM.
