# PROPOSAL_DWYP_Mending_Fairy.md

STATUS: v1 BUILT (not open design) — I4 + I1 + O1 shipped 2026-06-09, UNVALIDATED (test via `test_runMendingFairy` or next nightly). **O1 (guest-bio enrich) is DISABLED by Reckoning D12 / SPOKE 2-B** (`MEND_O1_GUESTBIO_ENABLED=false`) — do not treat O1 as a live op. Outstanding spokes: §6B (per-section show-notes provenance; §6A/§6B forks decided) and the future Spoke 3 (show-notes additive-insert, depends on provenance spoke). Once v1 validated + §6B/Spoke 3 done, retire to State/Reference.

**Owner:** Hub. **Host file:** `housekeeping.js` (reserved spot — existing header comment: "Mending Fairy (AI-assisted repair tasks) will live here. Do not scaffold.").

---

## 1. Identity & Seam

The Mending Fairy is the **AI-assisted / judgment-requiring** repair layer. It is distinct from the deterministic repairs already in `housekeeping.js`.

| | Deterministic housekeeping (exists) | Mending Fairy (new) |
|---|---|---|
| Decision type | One correct answer, no judgment | Requires a model, a lookup, or content generation |
| Examples | `repairStagingSubfolders()`, `parsePipelineBlock()`, `archiveLiveEpisodes()` | Regenerate malformed header, reconcile drifted status, enrich empty guest bio |
| Form | Plain functions | New nightly pass + operation catalog |

**Boundary test:** *"Does fixing this require a model, an external lookup, or a content decision?"* No → deterministic housekeeping. Yes → Mending Fairy.

**Locked: does NOT absorb existing repairs.** `repairStagingSubfolders`, `parsePipelineBlock`, `archiveLiveEpisodes` stay as-is. Mending is a new pass layered into `runHousekeeping()`, not a restructure (Code Integrity Mandate).

**Locked: heal by delegation, not duplication.** When an issue is owned by an existing fairy (Herald = guest research; Vert = index/show-notes/quotes), the Mending Fairy **re-triggers that fairy**, it does not re-implement its logic. It does direct work only for gaps no existing fairy owns. This preserves single-source-of-truth and keeps the catalog thin.

---

## 2. Trigger

Rides the nightly `runHousekeeping()` sweep as a new pass that runs **after** the deterministic repairs (folders/manifest must be sound before judgment-level mends run). One trigger, current cadence, already sees all active episodes.

A `dev_tools.js` single-episode test wrapper is required for testing/manual recovery (existing pattern — every fairy has one). No user-facing on-demand surface in scope.

---

## 3. Autonomy Tiers (spine)

T0 = deterministic housekeeping (out of scope, already exists). Mending operates in T1–T3.

| Tier | Class | Default action | Rule |
|---|---|---|---|
| **T1** | Additive / reversible | **Auto-apply + log** | Fills an empty field or creates a missing artifact. Never overwrites existing content. Reversible. |
| **T2** | Content regeneration | **Auto only if target is empty or system-authored AND untouched by a human; else spawn Task** | Writing/overwriting generated content. Gated on the human-provenance signal (§6, open). |
| **T3** | Destructive / ambiguous | **Always spawn Task** | Deletion, foreign-key cleanup, anything with more than one defensible fix, anything touching released content. |

---

## 4. Guard Rails (non-negotiable, regardless of tier)

| Guard | Rule |
|---|---|
| Content-state scope | Content mutation only on `in_production` / `ready_to_release`. **Never** `live` / `complete` / archived. |
| Contact enrichment scope | Contact-bound, exempt from episode-state guard. Own gate: never overwrite a human-entered field; only fill empty / `Enrichment Pending`. |
| Manifest-corrupt | Inherit existing fail-closed pattern — never write over a corrupt manifest; spawn urgent Task. (Already established in `parsePipelineBlock`.) |
| Attempt ledger | Per-issue counter + last-attempt timestamp in manifest (`manifest.mend_ledger[issueKey] = {attempts, lastAttempt, status}`). After N failed auto-attempts → escalate to Task, stop auto-retrying. Prevents nightly spam / retry loops. |
| Idempotency | Re-run safe; skip already-healed issues. |
| Versioning | Every write bumps the correct domain version stamp. |
| Audit | New actor string `Mending`. Log every detection: issue, tier, action (auto vs Task), outcome. `state_change` for fixes, `error` for unfixable. |

---

## 5. Operation Catalog (candidate)

Sorted by class. `Auto/Task` shows the *typical* resolution; T2 entries flip to Task when the human-provenance gate trips.

### Internal-consistency (no outbound cost)

| # | Issue | Detection | Tier | Auto/Task | Owner / Notes |
|---|---|---|---|---|---|
| I1 | Manifest ↔ Episodes field drift (e.g. `Production_Folder_ID`, status) | Compare manifest vs Episodes row | T2/T3 | Auto if one side empty; Task if both set & conflict | Direct |
| ~~I2~~ | ~~Missing show-notes header~~ **DROPPED** | — | — | — | Missing header is a legitimate JT finished state (§6B). Not a defect. |
| I3 | Hooks/quotes generation defect | `gen_outcome.status` = failed/degraded **at production time** (§6B), pristine doc only | T2 | Production-time: Vert flags/re-triggers. Nightly Mending: pre-handoff stall only; touched doc → Task that asks | Moved to Vert completeness gate; Mending reads `gen_outcome`, never infers from live doc |
| I4 | Missing companion `.txt` for an exported asset | Asset PNG present, `.txt` absent | T1 | Auto-regen from caption | Direct |
| I5 | Reel description out of sync after reel add/remove | Reel set changed, description stale | T2 | Auto-regen | Operating Model already assigns this co-ownership |
| I6 | Status drift: manifest phase=archived but Episodes Status=live (or vice-versa) | Phase/status mismatch | T3 | Task | Ambiguous which is truth |
| I7 | Orphaned Asset_Library row (points to deleted episode/folder) | FK resolves to nothing | T3 | Task (flag, never auto-delete) | Direct |
| I8 | Dangling Social_Assets → deleted Asset_Library row | FK resolves to nothing | T3 | Task | Direct |
| I9 | Pipeline stalled: transcript present, no index/show-notes after window | Stage 2 conditions met but outputs absent | T2 | Auto re-trigger owning track; Task after N | Delegate → Vert |
| I10 | Transcript present but unmatched by name (detection false-negative) | Content-chain stage failed the transcript gate, yet a transcript-shaped/document file exists in the staging/raw folder under a name not matching the detection pattern | T3 (T2 if unambiguous) | Task naming the candidate file ("rename to `*transcript*`"); auto-rename only when exactly one document-shaped candidate exists, no ambiguity (guarded) | The textbook Mending case — human naming slip derails the whole pipeline. Replaces the misleading generic "no transcript" Errors task with an actionable one. Relates to `findTranscriptInFolder` name-match fragility + SPOKE 2-E error-task churn. Captured 2026-06-14 from a live miss (Adam Meyer — Track A: transcript present, filename lacked "transcript"). |

### Outbound enrichment (Gemini-grounded — real API cost, external calls; distinct tier)

| # | Issue | Detection | Tier | Auto/Task | Owner / Notes |
|---|---|---|---|---|---|
| O1 | Empty / `Enrichment Pending` guest Bio_Summary | Contacts field empty/sentinel | T2 | Auto re-run Herald bio; Task if identity unconfirmed | Delegate → Herald (`runHeraldBio`) |
| O2 | Missing social handles / Organization on contact | Fields empty, identity confirmed | T2 | Auto grounded lookup (fill-only) | Delegate → Herald |
| O3 | Stale guest info refresh (already populated) | Age threshold | T3 | Task (propose, never auto-overwrite) | Don't auto-mutate good data |

---

## 6A. Provenance Resolver (D1 — resolved)

**Resolution: no universal "human-touched" flag. Use a per-content-type resolver built on signals that already exist.** A single global flag would require a schema migration and still be weaker than the type-specific signals already in the system.

**Governing rule.** Mending may auto-mutate a content type only if **either**:
- (a) the operation is **additive / fill-when-absent** (writes only into an empty slot) — no provenance check needed; or
- (b) the type has a defined signal below showing **no human touch**.

Otherwise → spawn Task. **Any content type without a row in this table is Task-only** until a signal is defined. Fail-safe default when a signal is expected but unreadable: treat as human-touched → Task.

| Content type | Human-touch signal (already in system) | Dependency | Notes |
|---|---|---|---|
| Asset_Library row | `Created_By != 'system'` **OR** `Canvas_State` non-empty | None (sheet columns) | Vert already honors this ("rows JT has touched are preserved untouched"). Strongest signal in the system. |
| Episode index (gdoc) | `BUILT_AT` stamp in doc vs transcript `lastUpdated` | None (already embedded) | Staleness hook already designed in (vert_fairy ~L374). |
| Show notes (typed sections) | **Per-section provenance record on manifest**, written at the controlled in-app save (`saveShowNotes`). `source: 'jt' \| 'vert'` per section. | App-side: `saveShowNotes` records per-section provenance + UI knows which sections changed (dirty flag or diff-vs-generated) | Edits flow through typed sections (`{header, type, items}`); gdoc is a render target rebuilt each save. No Drive-last-editor inference needed. Race-free. |
| Contact field | None per-field (`updateContactField` stamps nothing) | n/a | Gate is structural: **fill-only-if-empty / `Enrichment Pending`**, never overwrite. Provenance not required. |
| Manifest field | System-authored by nature | None | Reconcile freely (T2); genuine conflict (both sides set, disagree) → Task. |

**Design standard adopted:** all Mending-generated content carries a stamp-on-write marker (the `BUILT_AT` pattern), so every future pass can compute provenance/staleness without guessing.

**Key viability insight — D1 does not block v1.** All three recommended v1 ops (I4, I1, O1) are **fill-when-absent**, so they pass under rule (a) and need no provenance signal at all. The hard case — Drive last-editor detection on gdocs — is only required when Mending starts **overwriting** existing generated content (I2-class header regen). That can be deferred to a later tier. v1 ships without solving it.

**Gdoc-signal sub-decision — RETIRED.** Show notes edit through the controlled in-app path (`saveShowNotes`, typed sections), so provenance is captured at the save, per section. No Drive-last-editor inference needed.

---

## 6B. Provenance vs. Completeness — two axes, not one (refines 6A)

**The flaw in a pure human-edit gate:** last-edited answers *who touched the doc*, not *whether the content is valid*. These are independent axes. Collapsing them produces two failure modes:

- **False negative (the race):** JT starts editing show notes before the system/Mending notices quotes failed to generate. Doc now reads "last edited: human" → gate suppresses a repair for content that is genuinely broken by a generation defect.
- **Legitimate divergence misread as defect:** JT varies hook/quote counts, and **a missing header is sometimes her normal finished state.** "Doesn't match expected structure" is therefore NOT a valid defect signal on a human-touched doc — divergence is the spec there.

**Resolution — two principles:**

1. **One per-section provenance record on the manifest, two writers — never infer from the live doc.** Show notes edit through the controlled in-app path (`saveShowNotes`, typed sections); the gdoc is a render target rebuilt each save. So provenance is captured at the write, per section:
   ```
   manifest.show_notes_sections[type] = { source: 'vert'|'jt', status: ok|degraded|failed, itemCount: N, at: ts }
   ```
   - **Vert** writes it at generation (`source:'vert'` + status/itemCount).
   - **`saveShowNotes`** flips the sections JT changed to `source:'jt'`.
   Mending reads `source` per section. The race dies because saves are per typed section — editing the prose section never marks the quotes section, so a human edit elsewhere can't mask a quotes generation failure.

2. **Do not gate on JT's editing state — it is unpredictable and unknowable. Gate the *action* on overwrite risk, at section granularity.** There is no reliable "pristine window" (JT may edit at any moment, in any order). Detection leans entirely on the stamp (race-free, above). Repairs are **section-level, never wholesale** — touch only the broken section, never the rest of the doc. Wholesale regeneration is dropped entirely.

   **Safe-to-insert condition (the only auto-write path on a JT-reachable doc):** writing a section is *additive*, not an overwrite, **only when its provenance is `source:'vert'` with status failed/degraded** (system tried and missed; JT never authored it). Anchors are stable — JT can delete only the `INSIGHT BULLETS` header — so hook/quote splice points are guaranteed present. Decision tree per section:
   - `source:'vert'`, status failed/degraded, section absent/empty → **insert under its (stable) anchor.** Additive, safe, auto.
   - `source:'jt'` (she authored or adjusted it), any state → **leave alone.**
   - `source:'vert'`, status ok, but section now empty → treated as JT removal via the app → **leave alone.**
   - `INSIGHT BULLETS` missing → **not a repair target** (only header she can delete; intentional).

   The `source` field separates a safe additive insert from a destructive overwrite. **In-place rewrite of `source:'jt'` content is never an auto-action.** Inside Vert's own execution (doc not yet human-reachable) regeneration is still free; every later pass obeys the tree above.

**Scope consequence:** hooks/quotes integrity is read from the per-section provenance record. Mending's role for this class: read `source`/status, apply the decision tree — additive insert where provably safe, else Task. Header auto-repair (old op I2) is **dropped** — `INSIGHT BULLETS` is the only deletable header and its absence is intentional.

**New dependencies (two writers, one record):**
- **Vert** writes `manifest.show_notes_sections[type] = {source:'vert', status, itemCount, at}` per section at generation (small addition to `patchManifest` in `runEditorialPass`).
- **`saveShowNotes`** (app-side, Studio) flips changed sections to `source:'jt'` by **diffing each submitted section against the Vert baseline** stored in the record. No new per-section dirty UI needed — the Episode review surface already tracks form-level dirty state and writes back on Save; the diff supplies section granularity.

Mending only reads the record.

**Decision for Audra (D6):** confirm — (a) the per-section provenance record, written by Vert (generation) and `saveShowNotes` (human edit); (b) Mending repairs at section granularity per the decision tree — additive insert only when `source:'vert'` + failed/degraded, else Task; never rewrites `source:'jt'` content. Recommended. Alternatives (wholesale regeneration; inferring JT's editing state from the doc) are not viable.

---

## 6. Open Decisions / Dependencies (surface — not Hub's to invent)

| # | Item | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | **Human-provenance signal** — RESOLVED, see §6A. | — | Per-type provenance resolver; no global flag. Does not block v1 (all v1 ops are fill-when-absent). |
| D2 | **v1 operation set** — which catalog rows ship first | Operating Principle: ship the function, defer enhancements. Shipping all 12 at once is a scope balloon. | v1 = the mend-loop scaffold (ledger, tiering, logging, nightly hook, dev_tools wrapper) proven on 2–3 low-risk ops. Suggest **I4 (T1, trivial)**, **I1 (T2 internal)**, **O1 (T2 outbound, delegates to Herald)** — one per class, exercises every code path. Expand after the loop is trusted. |
| D3 | Re-trigger vs re-implement | Determines whether catalog "Owner=Delegate" rows call existing fairy entry points | Confirm delegate (recommended, §1). |
| D4 | New actor string `Mending` in Audit_Trail | Logging convention | Confirm. |
| D5 | Detection source of truth — live scan vs health snapshot each night | Cost / complexity | Live scan, bounded to active episodes only (matches housekeeping's existing per-episode loop; negligible added cost except outbound ops). |

---

## 7. Thread-End Handoff

**All decisions locked.** Scoped into two **independent** spokes (v1 ops deliberately avoid show-notes provenance, so neither blocks the other) plus a deferred third.

| Spoke | Scope | Depends on | File |
|---|---|---|---|
| **Spoke 1 — Show-notes provenance** | Vert writes per-section `{source,status,itemCount,baseline,at}` at generation; `saveShowNotes` diffs submitted vs baseline → flips changed sections to `source:'jt'`. Manifest only, no UI change. | — | `SPOKE_DWYP_ShowNotes_Provenance.md` |
| **Spoke 2 — Mending loop + v1** | Nightly pass in `housekeeping.js` after deterministic repairs: tiering, attempt-ledger (backoff→Task), `Mending` audit actor, pre-release guard, manifest-corrupt fail-closed, `dev_tools` wrapper. v1 ops: **I4** (companion .txt regen, T1), **I1** (manifest↔Episodes reconcile, T2), **O1** (empty/Enrichment-Pending bio → delegate Herald, T2). | — | `SPOKE_DWYP_Mending_Loop_v1.md` |
| **Spoke 3 — Show-notes additive insert** (deferred) | Mending reads provenance record; safe additive insert per §6B decision tree. | Spoke 1 | not yet written |

Both spoke prompts carry: Code Integrity Mandate ref, in/out scope, explicit clasp checkpoints, delegate-don't-reimplement guard, routing via `getMasterSheetId()`. No Master Sheet schema edits in either (manifest-only writes) — no Audra hand-edits required.

**Next:** paste Spoke 1 and/or Spoke 2 into Code (any order). Outcomes land in `DWYP_Platform_State.md`; spoke files discarded after the session.
