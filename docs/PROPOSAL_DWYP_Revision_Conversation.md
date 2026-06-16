STATUS: BUILT, awaiting validation (not open design) — Spoke A pushed; Spoke B done 2026-06-12, unpushed (hand to Audra). Validate live, then retire to State/Reference. NOTE: interacts with SPOKE 2-A (D1) on `Video_Status` + revision-state derivation — this proposal derives cycle/finalized from manifest flags (`revision_cycle`/`finalized`), 2-A targets open-`Revise_Episode`-task derivation; the two must be reconciled in 2-A Stage 1 before 2-A implements.

# PROPOSAL — Revision Conversation Model (v1: Checklist + Finalize)

**Replaces (when built):** round-seal revision loop on the episode review surface.
**Origin:** Hub thread 2026-06-12. Started as per-comment resolution checkmarks; widened to a loop redesign; simplified back when threading proved overengineered for v1. All decisions locked same session; `Video_Status` inventory run same session.

---

## Problem

The review loop runs on four overlapping signals: Episodes `Status`, `Video_Status`, task states (`Review_Episode` / `Revise_Episode`), and `Revision_Round`. Sync failures between them produced the composer-lock bug (AD #130 §1), the ungated `Review_Episode` respawn, and the round-seal orphan risk. The hard seal fights the real workflow: JT authors ~10 comments over 2–3 sessions; sealing freezes her out mid-thought.

## Target experience

Upload via task (GCS handled) → JT notified (existing `Review_Episode` spawn) → JT comments freely across sessions; submit appends each to the rail set and clears the compose box; she can withdraw (X) her own comments → first comment auto-spawns Audra's awareness task → JT hits **Finalize** → awareness task consumed, actionable revise task spawns with upload link; guarantee begins → Audra resolves comments one by one while editing (gray accumulates; declines carry a one-cell reason JT reads in the rail) → re-upload closes the cycle → repeat or Approve (terminal).

## Model (all decided 2026-06-12)

| Element | Behavior |
|---|---|
| Comment | One sheet row per comment (existing `submitEpisodeCommentRow` pattern). Compose box is client-only — nothing touches the sheet until submit. Submit appends the row; comment renders in the rail Revisions pane; workspace never accumulates comments. |
| Comment status | Blank/`false` = open → `resolved` (gray + check) or `declined` (+ one-cell `Resolution_Note`, JT reads it in the rail — no reply channel in v1). **Status writes: Audra only.** |
| Withdraw (JT) | X on her own comments, **pre-finalize only**. Render removes it; sheet keeps the row as `withdrawn` (tombstone). Rationale: row deletes shift rows below — same bug class the `_resolveTaskRow_`/`_resolveContactRow_` guards exist for. Tombstones may ride the AD #128 purge pattern later if wanted. |
| **Finalize** (JT's gesture) | Inverted seal — JT's commitment the set is complete. Locks new top-level comments and withdraw for the cycle. |
| Post-finalize lock rationale | **Timestamp anchoring.** Comments bind to the current video's timeline; editing shifts it — late comments are stale against the next version. Correctness, not policy. |
| Guarantee | Finalized set = every item resolved or declined. Pre-finalize, Audra may start/render at her discretion — zero obligation; trickling past her render is JT's risk. |
| Notifications (task relay) | (1) First comment of a cycle auto-spawns awareness task — "JT has begun revisions." (2) Finalize consumes it (auto-complete) and spawns "Revise episode: N items" with upload link (existing `Revise_Episode` card renders Upload Proxy). Upload completion closes the cycle. No per-comment notifications. |
| Urgency (T-minus) | Finalize deadline = `Release_Date` − `REVISION_FINALIZE_LEAD_DAYS` (Governance_Config; **0 at launch — Audra prefers 7, pending JT agreement**). Countdown on JT's surface + task. One anchor per episode; later cycles inherit remaining runway. No `Release_Date` → no countdown. T-0 = awareness only (red countdown + urgent bump). |
| Cycle | = video version. Re-upload resets; prior cycle renders historical (collapsed, non-actionable). Finalize/cycle state lives in the **manifest** (`revision_cycle` + `finalized` flag) — zero new Episodes columns. |
| Round | Display label on a cycle, nothing more. |
| Approve | Unchanged, terminal. |

## Episode_Log context (review finding, 2026-06-12)

Episode_Log is a shared episode **journal**, not a comments table: `Entry_Type` enum `revision|feedback|note|system`, `Asset_Type` enum `video|images|general`. Live writers: review comments (`feedback`/`video`), Secretary + Herald system notes (`system`/`general`). `images` rows are residue of the retired image-revision path (moved to AL `Revision_Notes`, May 2026) — nothing live writes it. `getEpisodeRevisionHistory` already filters; the Revisions pane inherits that. **Col 8 `Resolved` already exists** — every comment row written `false`, never flipped; repurposed below. **Build check:** `Visible_To` (col 9, `both|audra_only|jt_only`) — verify whether any reader honors it or it's dormant.

## Schema impact

| Change | Detail |
|---|---|
| Col 8 repurpose | `Resolved` holds status: blank/`false` = open, `resolved`, `declined`, `withdrawn`. All existing rows read as open — zero migration. Header rename to `Comment_Status` optional (code header-tolerant either way). |
| New col 11 | `Resolved_At` (Audra hand-adds header) |
| New col 12 | `Resolution_Note` (Audra hand-adds header) |
| Governance | `REVISION_FINALIZE_LEAD_DAYS` (Audra adds key; 0 at launch) |
| Episodes tab | No changes. Cycle state in manifest. |
| No IDs | `Comment_ID`/`Parent_ID` dropped with replies. Status writes target rows via rowIndex + body-text verify (mirror `_resolveTaskRow_` pattern). |

## `Video_Status` inventory verdict (2026-06-12, read-only pass)

**Keep the column, retire the lock.** Live values `pending|review|revision_requested|approved` (`"ready"` is comment residue). 7 GAS writers, no client writes. Readers split: (1) lock/loop mechanics ~8 client sites — **retired by this build** (mobile composer lock 10733, Studio optimistic lock + reconciler 10827–10900, rail seal rendering 11992–99/13239/13736, post-action local flips 12037–65/13776–800/14411); (2) display/awareness ~10 client sites — **kept untouched** (headphones 8886 / AD #124 cluster, card labels 8901/8909, blocking label 8934, Buckets `hasRevision`/`allApproved` 12461–68 incl. twin `Images_Status`, status dot 12607, proxy-slot 9258). No fairy/pulse logic branches on `Video_Status`. Post-build writers unchanged: Finalize writes `revision_requested` ("revision cycle active"), re-upload → `review`, approve → `approved`. No reader treats any value as a composer lock; post-finalize comment block checks manifest cycle state, not `Video_Status`.

## Surface impact

- **Layout unchanged:** video + compose left workspace, show notes right. Submit → rail, compose clears.
- **Revisions pane** in the icon rail, peer to Companion: Studio (Audra) + mobile review (JT). Checklist render, resolve/decline + note (Audra), withdraw-X pre-finalize (JT), Finalize button (JT), T-minus countdown, historical cycles collapsed.
- Round-card rendering replaced by cycle-labeled checklist.
- `requestEpisodeRevisions` re-semanticized seal → finalize (keeps `revision_requested` write).

## Deferred enhancements (not v1)

- **Comment replies/threading** — requires `Comment_ID`/`Parent_ID`; brings back declined-reply semantics and unread-reply badge questions (former OQ-2/OQ-3). Revisit after v1 lives.
- T-0 escalation beyond awareness (former OQ-8 residue).

## Sequencing

1. ~~`Video_Status` inventory~~ — done, verdict above.
2. **Spoke A — schema + GAS:** status/note writes (row-verify guard), withdraw, finalize + manifest cycle state, task relay, T-minus calc, `getEpisodeRevisionHistory` extension. Hand-steps first: 2 headers + governance key.
3. **Spoke B — surfaces:** Revisions rail pane both chromes, lock-reader retirement, seal-render replacement, countdown.
4. Build A → B (Hub-as-spoke or Code thread). Delete this doc when outcomes land in State.
