# PROPOSAL — `removeEpisode` Dev Tool (cascading episode purge)
STATUS: exploring (captured 2026-06-14, Audra) — dev/housekeeping utility; decisions DR1–DR5 open. Reckoning-adjacent (clean removal vs. orphaned rows), but a new build.

## Purpose

A `dev_tools.gs` utility that, given one `Episode_UID`, removes the episode and **everything associated across the Master Sheet + Drive — except Contacts** (the guest persists). For clearing test episodes, mistakes, and abandoned records cleanly instead of leaving orphaned rows scattered across tabs.

## Cascade — what gets removed (keyed by `Episode_UID`)

| Target | Tab / location | Notes |
|---|---|---|
| Episode row | Episodes | the record itself |
| Task rows | Tasks (`Episode_UID`) | all: Review/Revise/Upload/etc. |
| Log rows | Episode_Log (`Episode_UID`) | revision comments |
| Asset rows | Asset_Library (`Episode_UID`) | hooks, quotes, reels, images |
| Placement rows | Social_Assets (`Episode_UID`) | |
| Schedule rows | Posting_Schedule | only if episode-keyed |
| Manifest | per-episode manifest | wherever stored |
| Drive folders | Raw (`02_RAW_PRODUCTION`), Staging (`03_STAGING_DRAFTS`) + subfolders (Images/Reels/Episode/Schedule), Episode Index doc (`EPISODE_SEARCH_INDEX_KEY`), Manual_Exports for the episode | per DR2 |
| GCS proxy | `dwyp-review-playback/episodes/{EUID}/proxy.mp4` | per DR5 |
| Version bumps | Versions | bump every domain touched, after the purge |

**Explicitly NOT touched:** Contacts (guest persists). Audit_Trail per DR1.

## Open decisions (with leans)

| # | Decision | Lean |
|---|---|---|
| DR1 | Audit_Trail rows for this episode — purge or preserve? | **Preserve** — it's the historical record; deleting audit entries defeats the audit. Instead, **log the removal itself** as an audit event. |
| DR2 | Drive folders — move to Trash or permanent delete? | **Trash** (recoverable) over `setTrashed(true)`; permanent delete is unrecoverable and easy to regret on a misfire. |
| DR3 | Calendar event (`Calendar_Event_ID`) — remove or leave? | **Leave** — external side-effect, low harm to keep; Audra didn't list it under "associated." Flag, don't auto-remove. |
| DR4 | Safety: dry-run first? | **Yes — two-step.** `removeEpisode(uid, {dryRun:true})` reports exactly what *would* be deleted (row counts per tab + folder names + GCS path); a second explicit call executes. Cascading deletes need eyes-on-target before firing. |
| DR5 | GCS proxy — delete with the rest? | **Yes** — episode-specific, part of "everything associated." |

## Safety design (regardless of decisions)

- `dev_tools.gs` only; **manual invocation; never production-triggered.**
- Takes one explicit `Episode_UID`; no lifecycle guard (the point is to remove even live/test episodes).
- Logs the full operation to Audit_Trail (what was removed, counts, actor `dev_tools`/`Mending`?).
- Reads tab structures header-driven (no hardcoded positional assumptions — schema-shaped).

## Future-aware (not blocking)

- **Multi-part / roundtable** (`PROPOSAL_DWYP_Episode_Guest_Cardinality.md`): when `Contact_ID_2` / series links exist, removal must not orphan a sibling episode or mis-handle a shared guest. Not built yet — note for when it is.

## Disposition

Idea-stage capture. Converts to a `SPOKE_` once DR1–DR5 land (accept the leans = decision-complete). Then: one CIM-scoped Code spoke in `dev_tools.gs`, dry-run first, `/dev` test on a disposable episode.
