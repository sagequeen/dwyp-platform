STATUS: exploring — direction confirmed by Audra 2026-06-14; central fork (role-owns-prompt) open. Absorbs Reckoning D14. Not yet scoped for handoff.

# PROPOSAL — Model Control Layer (role-based LLM routing via Governance)

## Purpose
Decouple *which model* runs a task from *what the task is*. Code calls a semantic **role**; Governance_Config maps role → provider + model + key (+ prompt). Swap Gemini↔Claude for a role by editing the sheet, never the code. Ends provider-name lying (`Vert`/`V2`/`Vertex`), gives the kit a BYO-model slot, and makes model choice a governed safeguard.

## Why (three drivers)
- **Operational:** Audra runs Gemini and will push Claude; must not rewire code per swap.
- **Deployability (kit):** a new instance picks providers/keys in Governance — zero code.
- **Honesty (absorbs Reckoning D14):** names describe purpose, not provider. `EDITORIAL_WRITER` can't lie the way `Vert_Fairy_IndexV2` does.

## The role model
A role = **{ purpose, category, provider, model, key-ref, system-prompt }**, all in Governance_Config. Code calls `runRole('EDITORIAL_WRITER', input, …)`; the layer resolves the binding and dispatches.

## Categories (the axis)
- **Research** (internal analysis; cheaper/faster acceptable): e.g. `GUEST_BRIEF_WRITER`, `TRANSCRIPT_ANALYZER`, `IDENTITY_VERIFIER`.
- **Audience-facing** (ships; brand voice; quality-first): e.g. `EDITORIAL_WRITER` (show notes), `REELS_CAPTION_WRITER`, `SOCIAL_WRITER`, `NEWSLETTER_WRITER`.

*Seed list — Audra to redraw.* Category lets policy be set once ("audience-facing → Claude") with per-role override.

## The substantive work (not the key naming)
A thin **provider adapter** per model: normalizes request shape, token limits, and response parsing across Claude and Gemini so a role can point at either. This is the engineering core — not a lookup table.

## Central open fork
**Does a role own its prompt?**
- **Role owns prompt** → a model swap is pure config (+ optional prompt review). Makes "don't rewire" actually true.
- **Binding only** → prompts stay in code; a swap may still need a code-side prompt edit when a prompt is model-tuned.

Lean: role owns prompt — the only version where the decoupling is real.

## Open questions
| # | Question |
|---|---|
| Q1 | Role-owns-prompt vs binding-only (central fork). |
| Q2 | Governance layout — one row per role with provider/model/key/prompt columns? Keys stay in Governance (D5 declined moving them). |
| Q3 | Fallback when a provider errors/rate-limits — fail, retry, or fall back to the other provider? |
| Q4 | Migration order — wrap existing call sites incrementally (research first, lower stakes) vs all at once. |
| Q5 | Prompt storage if role-owns-prompt — inline Governance cell vs a prompt registry referenced by id. |

## Relationships
- **Absorbs Reckoning D14** — renaming becomes rename-by-role; resolves the `Vert`/`V2`/`Vertex` confusion by purpose-naming.
- **Rides with D13** — the canonical registry also lists model-roles (one name per actor *and* role).
- **Same family as D7** — `Workflow_Step` closure and model-roles are both Governance-driven safeguards / closed vocabularies.
- Net-new architecture — sequence deliberately after the non-breaking Reckoning cleanup; do not bolt on.
