# DWYP Performance Principle — Show First, Sync Second

**Status:** Foundational design principle, locked May 2026
**Companion to:** DWYP Surface Principle
**Purpose:** Establish the operating model for responsiveness across the platform
**Feeds into:** Component library design, every UI spoke from this point forward

---

## The Test

A single principle resolves every responsiveness decision:

> **Show first, sync second. Latency is a UX failure.**

If the user has to wait on the backend before seeing the result of their action, the system is broken — even if the action eventually succeeds.

---

## Three Pillars

### 1. Cache aggressively, invalidate explicitly via version stamps
Most data on this platform changes infrequently. Tasks aren't created every second. Episode metadata is stable for days. Contacts change occasionally. Treat all reads as cached by default. Use version stamps to know exactly when a refetch is necessary — never refetch on a schedule.

### 2. Optimistic UI by default
User actions apply to local state immediately. Backend writes happen asynchronously. The user sees the result of their tap in <50ms, regardless of network. If the backend write fails, the failure surfaces visibly and rolls back. Never block on a round-trip for something the user just did.

### 3. Progressive loading
Lowest-fidelity placeholder first, real content second. Skeleton → thumbnail → high-res. Lazy-load below-the-fold content. Never block the user on the heaviest asset — let them see structure and start interacting while bytes arrive.

---

## Cache Invalidation — Version Stamp Pattern

Caching aggressively only works if invalidation is explicit and reliable. The mechanism: a `Versions` tab in Master Sheet that tracks a monotonically-increasing version number per data domain. Every write bumps the relevant version. Every read checks version before fetching.

### Versions Tab Schema

| Column | Purpose |
|---|---|
| Domain | tasks, episodes, contacts, asset_library, image_library, governance_config, etc. |
| Version | Integer, monotonically increasing |
| Last_Modified | ISO timestamp of last bump |
| Modified_By | Function name or user identifier |

### Write Pattern

Every mutation bumps its domain's version atomically:

```
LockService.getScriptLock().waitLock(5000);
try {
  // perform the mutation
  setVersion('image_library', currentVersion + 1, 'saveBackgroundToLibrary');
} finally {
  lock.releaseLock();
}
```

Lock contention is acceptable — writes are rare, reads are constant.

### Read Pattern (Frontend)

```
On tab return:
  1. Call getAllVersions() → { image_library: 48, tasks: 1234, ... }
  2. Compare to local versions in memory
  3. For unchanged domains: use local cache, zero fetch
  4. For changed domains: batch-fetch the new data in a single call
```

Two-call ceiling on tab return. Most returns hit only call #1.

### Drive Folder Hybrid (Self-Healing for External Changes)

Some domains can be modified outside the app — image library when Audra drops curated images directly into the Drive folder. Those mutations don't go through GAS and won't bump the version naturally.

Solution: when GAS reads a Drive-backed domain's version, it scans individual file modification timestamps within the folder. If any file has been modified since the stored last-known timestamp, GAS auto-bumps the sheet version and stores the new timestamp.

Self-healing. External Drive changes get picked up automatically on next read.

**Implementation note:** `DriveApp.getFolderById().getLastUpdated()` does NOT update when files are added to a folder — only when the folder metadata itself changes. The implementation scans individual file modification timestamps instead. Corrected during Phase 1.3 staging verification.

### Version Stamp Strategy by Data Type

| Domain | Version Source | Invalidation Trigger |
|---|---|---|
| Tasks | Sheet | spawnTask, complete, modify |
| Episodes | Sheet | Secretary run, status change, Filing Fairy |
| Contacts | Sheet | Tag/note edit, Herald enrichment, EH toggle |
| Asset_Library | Sheet | Card edit, chip apply, chat send, generation |
| Image_Library | Sheet + Drive timestamp | Background save, Drive-direct upload |
| Manifests | Sheet (per-episode) | Vert Fairy passes, manual edit |
| Governance_Config | Sheet | Manual edit only — rarely changes |
| Brand voice / playbook / sensitivity | Sheet (per-doc) | Manual edit only |

### Tradeoffs

- **Discipline required.** Every backend write must bump its domain version. A `bumpVersion(domain, callerName)` helper is mandatory; every mutation calls it. Pattern enforced by code review.
- **Granularity is coarse.** Domain-level, not row-level. If JT edits one task, "all tasks" look stale to the frontend. For v1 this is fine — domain refetches are cheap. Per-row versioning is overkill.
- **One-time backfill** to populate initial versions for existing data.

---

## Optimistic UI Patterns by Action Type

| Action | Optimistic Pattern |
|---|---|
| Tap "Complete" on task | Mark done locally, queue API write, show subtle saving indicator |
| Type in caption field | Update local state, debounce save (1s), show saving indicator |
| Apply Claude chip suggestion | Swap text immediately, write to Asset_Library async |
| Move asset between slots | Show new position immediately, reconcile on failure |
| Submit reel comment | Append comment immediately, queue submit, show pending state |
| Tag a contact | Add tag locally, debounced save, no blocking spinner |
| Toggle Influence_Tier | Update toggle immediately, write through |
| Drag-and-drop on canvas | Local state only until explicit save |

**Pattern: every user action has a local-first response.** No spinners on user-initiated changes.

**Composes with version stamps:** optimistic write succeeds → backend bumps version → next version check agrees, no conflict. Optimistic write fails → rollback locally, version was never bumped, no conflict.

---

## Progressive Loading by Surface

| Surface | Loading Stages |
|---|---|
| Tasks | Skeleton cards → cached data → version-check refresh |
| Episode card | Title + date → status pill → icon states |
| Reel thumbnail | Blurhash/placeholder → low-res → high-res on tap |
| Image library | Skeleton grid → low-res tiles → full res on hover/select |
| Canvas backgrounds | Placeholder color → preview JPEG → high-res PNG on commit |
| Contact list | Skeleton rows → name + org → completion dot + headshot |
| Asset_Library entries | Cached row → fresh data → linked content (image/audio) lazy |

**Pattern: structure visible before content. Content visible before quality.**

---

## GAS Latency Floor

GAS web app calls have an unavoidable cost: cold start ~500ms, warm call ~200-500ms, write operations ~500ms-2s. Caching cannot eliminate this — version stamps minimize how often users hit it.

**Architectural rules that follow:**

1. **Batch endpoints.** A single GAS call should return everything a screen needs, not waterfall multiple fetches. `getDashboardBundle()` returns tasks + episodes + status in one round-trip, not three.

2. **Versions endpoint is always batch.** `getAllVersions()` returns all domain versions in one read. Never check versions one at a time.

3. **Prefetch likely-next.** When JT taps an episode card, prefetch its detail data while the transition animates.

4. **Sheet reads are the bottleneck.** Read once per call, cache in script properties or CacheService where appropriate, write through. Don't re-read sheets within a single user action.

5. **Sheet writes batch.** Multiple updates to the same sheet bundle into a single `setValues()` call. Version bump is atomic and runs alongside.

6. **Drive operations are slow.** Cache file IDs aggressively. `setSharing()` is idempotent — call once, store result.

7. **Avoid full refreshes.** When returning to a tab, version-check first. Diff and patch — don't re-render everything.

---

## Failure Handling Pattern

Optimistic UI requires reliable failure surfacing. The pattern:

```
User action
  → Local state update (immediate)
  → Optimistic indicator (subtle: "Saving...")
  → Async backend call
  → On success: indicator clears, no fanfare
  → On failure: indicator goes red, action reverts, error surfaces
```

**Key elements:**
- **Status indicator is a first-class component.** Not a toast. Not a modal. A persistent corner element that shows save state across all actions.
- **Failures are loud, successes are silent.** JT shouldn't be congratulated on every successful save.
- **Rollback is automatic.** Failed writes revert local state — JT doesn't have to undo anything.
- **Retries are silent.** Transient failures retry once before surfacing.

This is a designed pattern, not a tossed-in toast system.

---

## What This Principle Does NOT Address

1. **Real-time multi-user sync.** If Audra and JT are both in the app, changes from one don't propagate to the other until tab return triggers version check. Acceptable for v1.

2. **Offline support.** Mobile is operations-only and assumes connectivity. Offline queueing is not in scope for v1.

3. **Background sync after close.** When JT closes the tab mid-action, pending writes queue and replay on next open. Not in scope for v1 — accept that closing the tab loses unwritten state, document the boundary.

4. **Heavy assets (video).** Reel playback uses native `<video>`. Planned hosting: Google Cloud Storage with Make mirroring Drive → GCS on upload. This principle doesn't extend to streaming optimization.

5. **Search performance.** Across-corpus search (Vert retrieval) has its own latency profile and can't always show first/sync second. Loading indicators are acceptable for explicit search actions.

---

## Implications for Component Library

Every component in the library needs to support these states out of the box:

| State | Visual Treatment |
|---|---|
| Skeleton (loading) | Subtle pulse, structural placeholder |
| Cached (stale) | Full content, no indicator |
| Refreshing (background) | No visible indicator (silent SWR) |
| Saving (user action) | Subtle inline indicator |
| Saved | Indicator clears |
| Failed | Red indicator, rollback message |
| Empty | Designed empty state, not a blank container |

These are baked into card, list, input, and form components — not bolted on per-feature.

---

## Implications for Backend Design

Going forward, every new GAS endpoint considered must answer:

1. **What single bundle does this screen need?** Endpoint returns it all in one call.
2. **What domains does this read from?** Each gets a version check before fetch.
3. **What's the write pattern?** Single sheet write, batch where possible. `bumpVersion()` called as part of the mutation.
4. **What's the failure mode?** What does the frontend do on each error path?
5. **What does this NOT need to fetch?** Aggressive scoping prevents waterfall fetches.

Existing endpoints get refactored as they're touched, not in a single migration spoke.

---

## Build Implications

This principle adds a track to the active design queue:

1. **Surface Principle** ✅ (locked)
2. **Performance Principle** ✅ (this document)
3. **Versions tab + bumpVersion helper spoke** — backend foundation. Modest lift. Unblocks everything below.
4. **Component library design** — must bake in cache/optimistic/progressive states from day one
5. **Backend bundle endpoint review** — identify which existing endpoints should batch
6. **Failure indicator component** — first-class component before any new UI surface ships
7. **Schedule panel UX (OQ-B)** — applies all three principles
8. **Visual modernization (OQ-C)** — propagates via component library

Step 3 is now a discrete prerequisite — it's the cache invalidation mechanism that makes everything else work. Roughly half a spoke: Versions tab schema, helper functions, retrofit existing endpoints to bump versions on write, frontend version-aware loading pattern.

---

## Performance Wins Available Right Now

Independent of the foundation work, three easy wins on the existing app:

1. **Tasks screen tab-return refresh is silent SWR — already partially there.** Audit what else could move from blocking refresh to background SWR.

2. **Reel thumbnails — blurhash placeholder.** Generate at filing time, store on row. First paint is instant.

3. **Episode index pre-population is already in place** for Publish — extend the pattern. Anything that takes >200ms to compute should be precomputed and stored.

These don't need new spokes — they're refinements to existing pushes.

---

*Captured Hub session, May 2026. Audra + Claude. Locks the foundational performance principle. Companion to Surface Principle. Feeds component library and all subsequent UI work.*
