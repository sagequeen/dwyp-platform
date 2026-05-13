# Spoke: Phase 1.4 — Frontend Version-Aware Loader

**Mode:** Spoke (Claude Code, autonomous with surface-back at push checkpoints)
**File(s):** `dwyp_ui.html` primary; may need minor `dwyp_app.js` additions for batch fetch endpoint if one isn't already present.
**Estimated scope:** Modest. Most of the work is the loader pattern + window.state wiring. Cold start, version-check on tab return, batch fetch dispatch. No surface migration in this spoke.

---

## Read First

Before writing any code, read these in order:
1. **`DWYP_Platform_State.md`** — current state (Phase 1.1–1.3 complete and staged)
2. **`DWYP_Build_Playbook.md`** Phase 1.4 spec — done criteria
3. **`DWYP_Performance_Principle.md`** — three pillars, cache invalidation pattern
4. **`DWYP_Phase1_Test_Protocol.md`** Section 1.4 — verification checklist (this is what proves the spoke complete)

Read the relevant sections of `dwyp_ui.html` before writing — current loader patterns must be preserved.

---

## Goal

Implement the version-aware loader pattern in `dwyp_ui.html` so any surface that opts in fetches data only when version stamps indicate something has changed.

**Two-call ceiling on tab return** (within-app tab switching, not browser tab focus):
1. One call to `getAllVersions()`
2. One batch fetch for domains whose version increased — or zero calls if everything matches cache

**This spoke builds the pattern only. Surface migration (Dashboard etc.) is Phase 1.5.** Existing surfaces must continue working as they do today.

---

## What Already Exists

From Phase 1.2–1.3 (staged, verified):
- `getAllVersions()` GAS endpoint → returns `{tasks: 47, episodes: 12, ...}` for all 11 domains
- `getDomainVersion(domain)` GAS endpoint → returns single number
- `bumpVersion(domain, callerName)` — 40 write paths retrofitted to call this
- Versions tab in production and staging Master Sheets

What frontend has today (do not change without surfacing back):
- `window.state` object with various fields (tasks, episodes, contacts, etc.)
- Existing per-domain loaders: `loadTasks()`, `getTasks()`, etc.
- Tab switching logic (varies by surface)

---

## Domains the Frontend Reads

Only these six domains need to be in the loader's purview:

- `tasks`
- `episodes`
- `contacts`
- `asset_library`
- `manifests`
- `audit_trail` (read by future Help Desk; safe to include now)

Excluded from frontend loader (read by GAS only, not the browser):
- `image_library`, `governance_config`, `brand_voice`, `playbook`, `content_sensitivity`

If you find a frontend code path that reads from any of the excluded domains, surface back — that's an unexpected dependency.

---

## Required Implementation

### 1. `window.state.versions`
Add a `versions` object to `window.state` that mirrors the six domains above. Cold start: empty `{}`. After first `getAllVersions()` call: populated with the current version numbers.

Do **not** restructure `window.state`. Add `versions` alongside existing fields.

### 2. `loadDomain(domain)` function
The new wrapper. Called by surface code that wants version-aware loading.

Logic:
```
if window.state.versions[domain] is undefined  → fetch fresh, update cache
if current version > window.state.versions[domain]  → fetch fresh, update cache
if current version === window.state.versions[domain]  → return cached data
```

The cached data lives in `window.state` under the existing field names (`window.state.tasks`, `window.state.episodes`, etc.). The loader updates those fields after fetching.

### 3. `refreshVersions()` function
Called on within-app tab switching. Logic:

```
Fetch getAllVersions() — single call
For each domain in {6 domains}:
  If returned version > cached version:
    Mark as stale
Batch fetch all stale domains in one call
Update window.state for each
Update window.state.versions
```

**Zero fetches** when nothing changed — return immediately after `getAllVersions()`.

### 4. Batch fetch endpoint
If `getDomainsBatch({domains: [...]})` doesn't already exist in `dwyp_app.js`, build it. It should accept an array of domain names and return an object keyed by domain with the current data for each.

If it exists, use it.

If you're not sure whether to build a new endpoint or call existing per-domain endpoints individually, **surface back** — this is a meaningful architectural decision worth confirming.

### 5. Tab switching hook
Within-app tab switching (not browser tab focus/blur) calls `refreshVersions()` automatically.

Identify the current tab-switching logic in `dwyp_ui.html` and wrap it. **Preservation Mandate**: do not refactor the tab-switching function itself, just hook into it.

### 6. Cold start
On initial app load, all domains are stale (cache empty). All six domains get fetched. This is expected — no special optimization for cold start.

### 7. Failure handling
If `getAllVersions()` fails (network error, GAS error, etc.):
- Fall back to fetching all six domains directly (correctness > speed)
- Log the failure to the console
- Do **not** silently use stale cached data — that's worse than slow

If the batch fetch fails for one domain:
- That domain's cache remains stale (unchanged)
- Other domains succeed normally
- Log the partial failure

---

## Things NOT to Do

1. **Do not migrate any surface to use the new pattern.** That's Phase 1.5. This spoke builds the pattern; the next spoke applies it.
2. **Do not modify or replace existing loaders** (`loadTasks()`, `getTasks()`, etc.). The new `loadDomain()` is additive — it wraps or coexists. Per the Preservation Mandate.
3. **Do not restructure `window.state`.** Add `versions` alongside existing fields, don't reorganize.
4. **Do not add browser-tab-focus listeners.** "Tab return" means within-app tab switching only. Browser tab focus is a different problem and out of scope.
5. **Do not bypass `getMasterSheetId()` or hardcode any sheet IDs.** All GAS reads route through the existing wrapper.
6. **Do not read or write `MASTER_SHEET_ID` directly** anywhere outside the established `getGovernance()` bootstrap exception.

---

## Surface-Back Triggers

Pause and ask before proceeding if:

- The batch fetch endpoint architecture is unclear (build new vs. compose existing).
- A frontend code path reads from a domain not in the six-domain list (unexpected dependency — needs review).
- The existing tab-switching logic in `dwyp_ui.html` is structured in a way that doesn't allow a clean hook (refactoring it is out of scope; need to find another integration point).
- Performance Principle has a guidance that conflicts with implementation choices.
- Any test in Phase 1 Test Protocol Section 1.4 can't be satisfied by the implementation as designed.

---

## Done Criteria

All items in **Phase 1 Test Protocol — Section 1.4** must pass on staging:

- [ ] On app load (cold start): observe one call to `getAllVersions()` → followed by batch fetches for stale domains
- [ ] After app loaded, switching tabs within app (no changes made): one `getAllVersions()` call fires, no domain fetch calls follow
- [ ] After making one change and switching tabs: `getAllVersions()` call fires, single domain fetch fires for the changed domain only
- [ ] Local cache in `window.state.versions` reflects current state
- [ ] Closing and reopening tab → cache cleared, full reload on next open

Plus the failure-handling cases:
- [ ] `getAllVersions()` failure → fall-back fetch of all six domains
- [ ] Single-domain batch fetch failure → other domains succeed, failed one stays stale

---

## Workflow

1. Read the four foundation/state docs listed above.
2. Read relevant sections of `dwyp_ui.html` to understand current loader and tab-switching patterns.
3. Confirm whether `getDomainsBatch()` exists in `dwyp_app.js` (or surface back).
4. Implement `window.state.versions`, `loadDomain()`, `refreshVersions()`, batch fetch endpoint if needed, tab-switching hook, failure handling.
5. Run Phase 1 Test Protocol Section 1.4 checklist on staging.
6. Surface back with status: PASS, or specific item failed and why.

---

## clasp push checkpoint

After implementation, run `clasp push` to deploy to staging. **Do not deploy a new production version** — staging only. Production deploy of Phase 1.1–1.4 happens in one batch after 1.4 verifies clean.

---

## Universal Reminders

- Read State + changelog + foundation docs (per CLAUDE.md tier) at session start.
- Surface back at every push checkpoint and end of numbered item.
- `bumpVersion()` is not invoked by this spoke — it's the cache invalidation source the loader *reads from*. No new write paths in this spoke.
- All sheet access goes through `getMasterSheetId()`.
- No hardcoded strings or sheet IDs.
- Preservation Mandate: existing functions and patterns retained unless explicitly approved otherwise.

---

*Spoke prompt for Phase 1.4. May 2026. Self-contained. Audra + Claude (Hub-drafted).*
