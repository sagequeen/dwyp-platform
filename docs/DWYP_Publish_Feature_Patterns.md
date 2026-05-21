# Publish Feature Patterns — Studio Migration Reference

**Status:** Temporary. Delete after each feature is incorporated into Studio.
**Purpose:** Implementation patterns captured from the retired Publish surface. Each section is self-contained — pick up any feature without reading the others.

---

## Feature 1 — Caption Variants

**User-facing:** User sees 2–3 caption options as clickable chips; selecting one fills the caption field.

### GAS
```
getEpisodeHooksAndQuotes(episodeUid)
→ { hooks: [{text, imagePrompts}], quotes: [{Quote_Text, Reel_Summary, ...}], imagePrompts: [string] }
```
Reads Asset_Library: Episode_UID, Asset_Type, Quote_Text, Reel_Summary, Caption_Host.

### JS Pattern
1. Call GAS on episode load; store response array in `st.captionVariants[]`.
2. Render variant buttons below the caption field. Each button holds the full variant text.
3. On click: set `stCaptionField.textContent = variant`; persist to localStorage (`st_caption_{reelId}` key already exists).
4. Clear `st.captionVariants` when episode changes.

### Studio wiring needed
- `st.captionVariants` array on state object
- Variant chip strip below `stCaptionField` (conditionally shown when array is non-empty)
- Call `getEpisodeHooksAndQuotes` alongside existing episode load — response reuses the H&Q data already displayed in the H&Q panel

---

## Feature 2 — Scheduling / Slot Placement

**User-facing:** User picks a day and slot from a week grid, then confirms to publish an asset into that slot. Asset status updates in the sheet.

### GAS
```
placeAssetInSlot(episodeUid, slotId, assetId, caption, driveFileId, assetType)
→ { success: true, assetLibraryId: string, postId: string }

rescheduleAsset(assetLibraryId, postId, null, null, caption, null, null)

unscheduleAsset(episodeUid, slotId)
```

**Writes — Social_Assets tab (new row):**
Post_ID, Asset_Library_ID, Episode_UID, Slot, Asset_Type, Caption, Drive_File_ID, Scheduled_At, Status

**Writes — Asset_Library tab (existing row):**
Availability → "placed", Status → "scheduled"

### JS Pattern
1. Load schedule via `getPublishSchedule(episodeUid)` → `{ days: [{ day, slots: [{slotId, filled, assetType}] }] }`.
2. Render week grid from `schedule.days`. Selecting a slot sets `st.activeSlotId` + `st.activeSlotDay`.
3. On confirm: check if slot is already filled → call `placeAssetInSlot` (new) or `rescheduleAsset` (update).
4. On success: update `st.schedule.days[].slots[].filled` in memory; re-render grid.

### Studio wiring needed
- Week grid view (new surface or modal) — can reuse the Export day picker concept but expanded to full slot grid
- `st.schedule`, `st.activeSlotId`, `st.activeSlotDay` on state object
- Export button could optionally route through `placeAssetInSlot` instead of `exportAssetToDrive` when a slot is selected
- `getPublishSchedule` is still live in `dwyp_app.js`

---

## Feature 3 — Slot-Aware Claude Chat

**User-facing:** Claude chat rail knows which slot/day/asset type is active; chip actions can pre-fill image prompts and switch tabs.

### GAS
None — the Publish implementation was stubbed (console.log only). Claude integration would need to be wired to the same endpoint Studio Chat already uses.

### JS Pattern
1. Maintain conversation state in a Map keyed by episode UID: `Map<episodeUid, { messages: [{role, html, chips?}] }>`.
2. When slot changes, update context object: `{ slotId, assetType, day, aspectRatio }`. Pass as system context in Claude call.
3. Chip dispatch: assistant messages may include `data-chip-action` + `data-chip-label` + `data-chip-prompt`. On click:
   - `'image-prompt'` → pre-fill generation prompt field, switch to Generate tab
   - default → send chip label as user message
4. Context label shown in rail header: `"MON · THUMBNAIL"` format.

### Studio wiring needed
- Studio Chat already has the Claude endpoint and conversation model
- Add slot context to the system prompt when a slot is active (`st.activeSlotId`, `st.activeSlotDay`)
- Add chip rendering to assistant message output (already partially present via H&Q chip pattern)
- Aspect ratio auto-selection: 4:5 for images/reels, 16:9 for thumbnails

---

## Feature 4 — Candidate Ranking

**User-facing:** Ranked tile grid of available assets for the active episode; user selects one to load into the workspace.

### GAS
```
getRankedAssetLibraryCandidates(episodeUid, assetType)
→ [{
    asset_id, asset_type, quality_score, slot_tags,
    thumb_url, preview_text, title_card,
    caption_host, caption_guest,
    drive_file_id, quote_text
  }]
```
Reads Asset_Library. Sorted server-side: Quality_Score DESC, Created_At ASC. Top 6 returned.

```
getReelsForEpisode(episodeUid)
→ array of reel rows from Asset_Library
```

### JS Pattern
1. Call `getRankedAssetLibraryCandidates(uid, assetType)` on episode/tab load; store in `st.candidates[]`.
2. Render a tile grid (thumbnail + preview_text). Auto-select first.
3. `selectCandidate(assetId)`: toggle `.selected` on tile, hydrate caption/title-card fields, load canvas state if present.
4. Cache by asset type: `st._candidateCache[assetType]` to avoid re-fetching on tab switch.

### Studio wiring needed
- Candidate panel in the left rail or as a sub-tab of the Images view
- Tile grid reuses existing background thumbnail pattern (lazy load, selected state)
- `st.candidates`, `st._candidateCache` on state object
- `getRankedAssetLibraryCandidates` is still live in `dwyp_app.js`

---

## Feature 5 — Revision Submission

**User-facing:** User opens a modal on a reel, types feedback, submits. Creates a row in Revision_Requests tab.

### GAS
```
submitRevisionRequest({ episodeUid, assetId, assetType, reelName, requestText })
→ { success: true }
```

**Writes — Revision_Requests tab (creates tab if missing):**
Request_ID ("REV-{timestamp}"), Episode_UID, Asset_ID, Asset_Type, Reel_Name, Request_Text, Status ("open"), Created_At, Created_By

### JS Pattern
1. Trigger: button on reel card → store `_revisionAssetId`, show modal with textarea.
2. Submit: read textarea, validate non-empty, disable button, call GAS.
3. On success: hide modal, show toast. No local state update needed (revision is backend-only).

### Studio wiring needed
- "Request revision" button on reel cards in the Reels panel
- Simple modal: textarea + Cancel / Submit buttons
- `submitRevisionRequest` is still live in `dwyp_app.js`
- Lightest lift of all six features

---

## Feature 6 — Star / Favorite System

**User-facing:** Star button on reel cards and background tiles; starred items sort to top of their list.

### localStorage keys
```
'dwyp_star_' + assetId      → 'true' | 'false'   (reels)
'dwyp_star_bg_' + fileId    → 'true' | 'false'   (backgrounds)
```
No GAS, no sheet writes.

### JS Pattern
```js
function isStarred(key) { return localStorage.getItem(key) === 'true'; }

function toggleStar(key, rerenderFn) {
  localStorage.setItem(key, String(!isStarred(key)));
  rerenderFn();
}
```
Sort in render: `isStarred(b.id) - isStarred(a.id)` (starred items → index 0).

### Studio wiring needed
- Star button (★/☆) on reel cards in `stRenderReelCardList`
- Star button on background tiles in `stRenderBgGridFiltered`
- Sort pass before render in both functions
- localStorage keys are already collision-safe with `st_caption_` and `st_tc_` prefixes in Studio

---

## GAS Functions Retained (not deleted with Publish)

These functions in `dwyp_app.js` serve the features above and should stay until their Studio counterparts are built:

| Function | Used by |
|---|---|
| `getPublishSchedule(episodeUid)` | Feature 2 |
| `placeAssetInSlot(...)` | Feature 2 |
| `rescheduleAsset(...)` | Feature 2 |
| `unscheduleAsset(...)` | Feature 2 |
| `getRankedAssetLibraryCandidates(episodeUid, assetType)` | Feature 4 |
| `submitRevisionRequest(payload)` | Feature 5 |

`getEpisodeHooksAndQuotes` is already called by Studio for the H&Q panel — no change needed.
