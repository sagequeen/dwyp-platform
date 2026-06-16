# SPOKE 2-A — Episode Review-State Consolidation (D1) + Episode_Sequence Retirement (D2)
STATUS: ready for Code — execute Stage 1 (inventory) first, surface back before Stage 2

**Mode:** Spoke. Read fully before writing anything.
**Mandate:** Code Integrity Mandate (CLAUDE.md) governs. Targeted edits only; no wholesale rewrites. Schema-shaped functions and the `EPISODES_COLS` constant map are load-bearing — handle per the positional-read rule in CLAUDE.md "What Not to Do."
**Source decisions:** `PROPOSAL_DWYP_Schema_Reckoning.md` §3, §15 (D1, D2), §16 Phase 2.
**Deployment note:** routing always resolves the **production** sheet (`isStaging()` returns false; no staging-sheet isolation). The `/dev` URL exercises new code **against live production data**. Stage 1 is read-only and safe. For Stage 2, test against a disposable/test episode row — never a live in-flight episode.

**Prior-work reconciliation (REQUIRED — read before Stage 1).** `Video_Status` was already partly reworked by the Revision Conversation spokes (Spoke A pushed; Spoke B done 2026-06-12, see `PROPOSAL_DWYP_Revision_Conversation.md` + Platform State). That work **retired the client *writes*** of `Video_Status` and derives cycle/finalized state from **manifest flags** (`revision_cycle`, `finalized`) — NOT from open `Revise_Episode` tasks. This spoke's D1 target derives revision state from open `Revise_Episode` tasks. **These are two different derivation sources for the same concept.** Stage 1 MUST inventory what Revision Conversation already changed and explicitly reconcile the two — pick one derivation source (manifest flags vs. open-task predicate) and surface the choice in the Stage 1 report. Do not implement a second, contradictory derivation path.

---

## Why this spoke exists

`Episodes` carries two state axes describing the same review gate from two directions (Reckoning H4):

| Col | Field | Documented enum | Authority |
|---|---|---|---|
| 6 (F) | `Status` | `upcoming \| in_production \| review \| ready_to_release \| live \| archived` | AD #123/#129. Six-state. `review` is live (Episodes_Writer writes it). |
| 11 (K) | `Video_Status` | `pending \| approved \| revision_requested` | AD #22/#51. Web app writes on JT action. |

The axes contradict in practice (§3: Derek bounced `ready_to_release → review` while `Video_Status` sat at `pending` the whole time). The ADs themselves disagree with the enum — AD #74 prose says `completeUploadEpisode` flips `Video_Status → review`, but `review` is a `Status` value, not a `Video_Status` value. **Which column the code actually writes is unknown from docs.** That is the first thing Stage 1 resolves.

**Target (D1):** one lifecycle axis = `Status`. Revision state **derived**, not stored, from open `Revise_Episode` tasks (consistent with "Pending Is Derived, Not Stored"). `Video_Status` **logically retired** — writes stop, readers repoint. Physical column-delete is explicitly **out of scope** (deferred audited spoke).

**Target (D2):** `Episode_Sequence` (col 1) — GAS already never writes it (AD #28); display rank is computed from release order. Confirm no functional reader depends on it, mark inert. Physical delete deferred to the same future column-delete spoke.

---

## Scope

**In scope**
- Stage 1: full read/write inventory + current-state transition map for `Status` and `Video_Status` (verification only, no edits).
- Stage 2 (after Hub blesses the map): repoint all `Video_Status` readers to `Status` + derived revision state; stop all `Video_Status` writes; derive `revision_requested` equivalent from open `Revise_Episode` task presence.
- D2: confirm `Episode_Sequence` has no functional readers; leave column physically in place; remove/neutralize any dead reader if found (CIM-gated).
- `bumpVersion('episodes', <caller>)` on any new/changed write path.

**Out of scope — do not touch**
- **Physical deletion of any column.** `Video_Status` (col 11) and `Episode_Sequence` (col 1) stay physically in the sheet. Deleting either shifts every column to its right and breaks hardcoded-index readers (CLAUDE.md). That is a separate, dedicated, audited spoke.
- Reworking `Revise_Episode` task spawn/close logic beyond reading open-task presence.
- The six-state `Status` enum itself — it stays as-is.
- Any Audra sheet edit. Code does not write the Master Sheet schema. If a column header or enum value needs changing, surface it as an Audra hand-step.

---

## Stage 1 — Inventory & Map (verification mode, NO edits)

Produce a report, surface back to Hub/Audra. Do not proceed to Stage 2 without sign-off.

1. **Read-site inventory.** Every code site that **reads** `Video_Status` (by `EPISODES_COLS.Video_Status` index and by any `headers.indexOf("Video_Status")`). For each: file, function, what decision the read drives.
2. **Write-site inventory.** Every site that **writes** `Video_Status`. For each: file, function, the value written, the trigger. Resolve the AD #74 ambiguity explicitly — does `completeUploadEpisode()` write `Video_Status` or `Status` to `review`? Quote the line.
3. **Status write-site inventory.** Same for `Status` writes (the lifecycle transitions: `upcoming → in_production → review → ready_to_release → live → archived`), so the two axes can be reconciled into one.
4. **Revision-state derivation feasibility.** Confirm open `Revise_Episode` tasks are queryable per episode (FK path: `Tasks.Asset_ID` / episode UID). State the exact predicate that would replace `Video_Status = revision_requested`.
5. **Proposed mapping table** — `Video_Status` value → `Status` value or derived predicate:
   - `pending` → ? (likely `Status = review`)
   - `approved` → ? (likely `Status` advances to `ready_to_release`/`live`)
   - `revision_requested` → derived from open `Revise_Episode` task
   Fill from real code behavior; flag every UNCERTAIN.
6. **`Episode_Sequence` reader check (D2).** Grep all reads of `Episode_Sequence` (constant + `indexOf`). Confirm display rank is computed from release order and nothing else depends on the column. Report any reader found.
7. **Positional-read landmine note.** Confirm the inventory covers BOTH hardcoded `EPISODES_COLS` index reads AND dynamic `headers.indexOf` reads for both columns.

**Clasp checkpoint 1:** no push (read-only). Deliver the Stage 1 report in-thread. **Surface back. Stop.**

---

## Stage 2 — Implementation (only after Stage 1 sign-off)

Built from the blessed mapping. Expected shape (confirm against Stage 1):

1. Repoint every `Video_Status` reader to read `Status` + the derived revision predicate.
2. Stop every `Video_Status` write. Where a write previously advanced the verdict, advance `Status` instead (per the blessed mapping).
3. Replace `Video_Status = revision_requested` checks with the open-`Revise_Episode`-task predicate.
4. `Episode_Sequence`: neutralize/remove any dead reader found in Stage 1; column stays physical.
5. Every changed write path calls `bumpVersion('episodes', <callerName>)`.
6. Leave `Video_Status` and `Episode_Sequence` columns physically present and unwritten (inert).

**Do not** rename functions or change signatures touching multiple files without surfacing back (CIM §4).

**Clasp checkpoint 2:** clasp push → verify on `/dev` against a **test episode row** (not a live one) → surface back with what you exercised. **Audra promotes to `/exec`.**

---

## Acceptance

- One state axis (`Status`) governs the review lifecycle; revision state is derived, not stored.
- Zero live `Video_Status` writes remain; all former readers resolve correctly from `Status` + derived state.
- `Video_Status` and `Episode_Sequence` columns remain physically in the sheet, inert (no positional shift).
- `Episode_Sequence` confirmed reader-free.
- Changed write paths bump the `episodes` version.
- A test episode walks the full gate (upload → review → revision request → re-review → approve → release) correctly on `/dev`.

## Closeout

Per CLAUDE.md amended policy: capture outcomes in `DWYP_Platform_State.md`; set this doc's `STATUS:` first line to `COMPLETE — safe to delete` and **leave it in `docs/`** (batch purge on Audra's say-so, not auto-deleted). Note for Phase 3 doc-sync: Reference Schema §Episodes must record `Video_Status` + `Episode_Sequence` as logically retired/inert, and the single-axis review model.
