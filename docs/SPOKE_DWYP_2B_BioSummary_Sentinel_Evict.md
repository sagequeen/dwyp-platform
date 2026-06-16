# SPOKE 2-B — Bio_Summary Sentinel Eviction (D12)
STATUS: ready for Code

**Mode:** Spoke. Read fully before writing.
**Mandate:** Code Integrity Mandate. Targeted edits only.
**Source decisions:** `PROPOSAL_DWYP_Schema_Reckoning.md` §2, §13, §15 (D12), §16 Phase 2.
**Deployment note:** `/dev` exercises production data. Test against a test contact row, not a live guest.

## Why this spoke exists

`Contacts.Bio_Summary` doubles as a status field (Reckoning §2): it holds real bio content, but also sentinel strings — `"Enrichment Pending"` (Carrie), Herald failure prose, and markdown artifacts (`**Bio_Summary:**` prefix). Generated content and its status share one cell (AppSheet-era hack). A fresh deployable instance cannot begin in a sentinel state — status must derive from tasks (kit test, D12).

**Target:** `Bio_Summary` becomes **content-or-blank**. Enrichment status lives **only** in tasks (`Guest_Brief_Enrich`). The O1 nightly bio-enrich sweep is disabled; on-demand enrichment + the ShowNotes Resource Append path (separate proposal) carry the cue going forward.

## Scope

**In scope**
- Gate `_mend_O1_guestBioEnrich` (Mending Fairy) behind `MEND_O1_GUESTBIO_ENABLED` — skip the op when the key is `false`. Log the skip as `state_change`/`info`, not error.
- Herald: stop writing `"Enrichment Pending"` (or any sentinel) into `Bio_Summary`. On enrichment-not-yet-done, leave `Bio_Summary` blank; the `Guest_Brief_Enrich` task already carries the status signal.
- Locate every **reader** that treats `Bio_Summary == "Enrichment Pending"` (or sentinel-detects on this cell) and repoint it to derive enrichment status from open `Guest_Brief_Enrich` task presence. Report any found before changing (CIM).
- Strip the `**Bio_Summary:**` markdown-prefix artifact on write if Herald is the source of it.
- `bumpVersion('contacts', <caller>)` on changed write paths.

**Out of scope**
- Backfilling/cleaning existing sentinel cells in live data — that's an Audra hand-step (see below), not code.
- Reworking the `Guest_Brief_Enrich` spawn logic beyond reading its presence.
- The ShowNotes Resource Append on-demand path (separate proposal).

## Audra hand-steps (not Code)

- Add/confirm Governance_Config key `MEND_O1_GUESTBIO_ENABLED = false`.
- Clean existing sentinel cells: blank out `"Enrichment Pending"` / failure prose / markdown-prefix residue in `Bio_Summary` where the cell is not real content.

## The work (single stage)

1. Inventory `Bio_Summary` read/write sites (`CONTACTS_COLS` index + `indexOf`). Report sentinel-detecting readers.
2. Repoint readers to the task-presence predicate.
3. Gate O1; stop Herald sentinel writes.
4. Bump version on changed writes.

**Clasp checkpoint:** clasp push → verify on `/dev` with a test contact (enrichment pending → blank `Bio_Summary` + open task; enriched → content in cell) → surface back. Audra promotes to `/exec`.

## Acceptance

- No code path writes a sentinel string into `Bio_Summary`.
- Enrichment status resolves from `Guest_Brief_Enrich` task presence, not from cell contents.
- O1 sweep no-ops when `MEND_O1_GUESTBIO_ENABLED=false`, logged as info.
- `Bio_Summary` is content-or-blank in all new writes.

## Closeout

Capture in State; set `STATUS:` → `COMPLETE — safe to delete`, leave in `docs/`. Phase 3 doc-sync: Reference §Contacts records `Bio_Summary` as content-or-blank; enrichment status is task-derived.
