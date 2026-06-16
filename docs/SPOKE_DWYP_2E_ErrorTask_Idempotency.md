# SPOKE 2-E — Error-Task Idempotency
STATUS: ready for Code

**Mode:** Spoke. Read fully before writing.
**Mandate:** Code Integrity Mandate. Targeted edit to the error-task spawn path.
**Source decisions:** `PROPOSAL_DWYP_Schema_Reckoning.md` §3, §4, §16 Phase 2.
**Deployment note:** `/dev` exercises production data and spawns into the live Tasks tab. Test with a synthetic error condition, not by breaking a real episode.

## Why this spoke exists

The `Errors` workflow step re-spawns tasks every pulse (§4): `"Pipeline error: Adam Meyer — Track A"` spawned fresh 6/10, 6/11, 6/12 — each completed, then re-spawned next pulse because the underlying condition (missing transcript) persists. Either the idempotency check ("one open task per condition") isn't applied to the `Errors` step, or completion is being treated as resolution when the condition still holds.

This is the same pattern the Poke path already honors (CLAUDE.md / Operating Model §9: "one open task per `(episode_uid, asset_type, slot_day)`"). The fix brings the `Errors` step under the same idempotency rule.

## The work (locate, then fix)

1. **Locate** the error-task spawn path (the `Errors`-step `spawnTask` call in the Daily Pulse / pipeline error handler). Grep the error-task title pattern and the `Errors` workflow step.
2. **Determine the dedup key.** A stable condition identity — e.g. `(episode_uid, track/stage, error_condition)` — that survives across pulses. Confirm what's available on the error context.
3. **Apply the guard:** before spawning, check for an existing **open or in-progress** task matching the dedup key; spawn only if none exists. Mirror the existing idempotent-spawn helper if one exists (don't write a parallel one).
4. **Resolve the completion-vs-resolution question.** If a completed error task re-spawns because the condition persists, decide (surface back if ambiguous): either the guard counts recently-completed tasks for the same condition within a window, or completion should not fire while the condition holds. Prefer the open-task guard; flag if that alone doesn't stop the churn.

## Scope

**In scope:** idempotency guard on the `Errors`-step spawn; mirroring the existing one-open-task-per-condition pattern.
**Out of scope:** fixing the underlying missing-transcript condition itself; reworking other workflow steps' spawn logic; changing completion semantics for non-error tasks.

**Clasp checkpoint:** clasp push → simulate a persistent error condition across two `/dev` pulse runs → confirm exactly one open error task exists, no duplicate re-spawn → surface back. Audra promotes to `/exec`.

## Acceptance

- A persistent error condition yields exactly one open error task across repeated pulses (no daily re-spawn).
- The guard reuses the existing idempotent-spawn pattern, not a parallel implementation.
- The completion-vs-resolution behavior is resolved (or surfaced back if the open-task guard alone is insufficient).

## Closeout

Capture in State; `STATUS:` → `COMPLETE — safe to delete`, leave in `docs/`.
