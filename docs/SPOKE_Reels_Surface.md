# DWYP Spoke — Reels Surface (Studio / Publish)
**Thread type:** Spoke
**Scope:** Reels scheduling surface — list view, card interaction, caption chat panel, schedule popover, Asset_Library + Social_Assets writes
**Files touched:** `dwyp_ui.html`, `dwyp_app.gs`

---

> ⚠️ **REFRESH REQUIRED BEFORE EXECUTION**
>
> This spoke was written before the May 2026 sprint. The following items are stale and must be corrected before opening a spoke thread:
>
> 1. **"Preservation Mandate" section** — retired (AD #101). Replace with: *"Nothing is removed without an explicit decision. Renames and dead code removal require explicit approval. Active function behavior is never changed without a confirmed design decision."*
> 2. **`Caption_Draft`** → `Caption_Host` (Asset_Library col 10) throughout this doc and all generated code.
> 3. **`Caption_Final`** → `Caption_Guest` (Asset_Library col 11) throughout this doc and all generated code.
> 4. **Schema section** — column list is wrong. Correct Asset_Library schema is 20 columns: `Asset_ID, Episode_UID, Asset_Type, Drive_File_ID, Display_Name, Slide_Index, Quote_Text, Reel_Summary, Image_Prompt, Caption_Host, Caption_Guest, Notes, Background_ID, Canvas_State, Status, Availability, Created_At, Created_By, Quality_Score, Slot_Tags`. Cross-check against Reference v3.3 before opening spoke.
> 5. **"Reference v2.9"** reference in Constraints — Reference is now v3.3.
> 6. **Context section** references "Vert Fairy Pass 2" and "Daily Pulse (Mending Fairy)" for reel detection — pipeline has been rewired. Track A/B/C language and `syncReelAssets` are the current model. Verify against Platform State before writing reel detection logic.
> 7. **Publish tab** is retired. This spoke's surface entry point description references "Studio Publish" — update framing to "Studio Design."

---

## Code Integrity Mandate

Nothing is removed without an explicit decision. Renames and dead code removal require explicit approval. Active function behavior is never changed without a confirmed design decision. Read the full current state of both files before writing a single line. Confirm your understanding of existing structure before proceeding.

---

## Constraints

- No hardcoded strings. All configurable values (sheet names, column names, LLM mode, API keys) read from `Governance_Config`.
- `STUDIO_LLM_MODE = claude` is the single governance key for all text generation. All LLM calls go through `callClaudeAPI()`. Do not read `PUBLISH_LLM_MODE` — it is retired.
- GAS is stateless between calls. Conversation history for the chat panel is managed client-side in JS and passed on each call.
- Asset_Library and Social_Assets schemas are locked (see Schema section). Do not add, rename, or reorder columns. Cross-check against Reference v2.9 before opening spoke — spoke schema section below may be missing column 17.
- Brand colors: gold `#FEBE18`, crimson `#D12225`, near-black `#0D0A0A`. Fonts: Libre Baskerville (headings), Nunito (body). Icons: Lucide.
- Reels are played via native `<video>` element using GCS URLs. Drive file IDs are retained on the row but not used for playback. `getReelStreamUrl(assetId)` returns the GCS URL.

---

## Context

The Studio Publish surface allows JT to schedule social assets for an episode's release week. This spoke builds the Reels section of that surface.

Reels are video clips stored in the episode's Drive reel folder. They are detected by Daily Pulse (Mending Fairy), which calls Gemini to process each reel's audio and write a rich content description (`Reel_Summary`) to the episode's Asset_Library rows. By the time JT opens Studio, Asset_Library rows for reels already exist with `Asset_Type = Reel`, `Status = candidate`, and `Reel_Summary` populated.

Starter captions (`Caption_Draft`) are pre-populated by Vert Fairy Pass 2 at show notes time. JT iterates on them via the chat panel — she does not generate from scratch.

---

## Schema Reference

**Asset_Library** (read + write):
`Asset_ID, Episode_UID, Asset_Type, Drive_File_ID, Display_Name, Slide_Index, Quote_Text, Reel_Summary, Image_Prompt, Caption_Draft, Caption_Final, Notes, Background_ID, Status, Availability, Created_At, Created_By`

**Social_Assets** (write on schedule confirm):
`Post_ID, Asset_Library_ID, Episode_UID, Slot, Asset_Type, Platform, Caption, Drive_File_ID, Scheduled_At, Scheduler_Status, Posted_At, Created_At, Created_By`

---

## Surface Entry Point

JT arrives at the Reels surface by selecting a Reel slot from the week view (left panel). The slot carries: `day`, `slot_type = Reel`, `platform` (e.g. "Instagram / TikTok / YouTube Shorts"). The week view is existing — do not modify it except where noted below.

**Week view slot states (update existing slot rendering):**
- Empty slot: white background, left border `3px solid #D12225` (crimson), slot label in muted text (`color: #888`), light weight. Barely there.
- Filled slot: white background, left border `3px solid #FEBE18` (gold), asset type + one line of `Caption_Final` visible. The content does the work.

---

## Reels List View

When a Reel slot is selected, the working area renders the Reels list.

### Slot Context Bar
Pinned above the list. Shows: `[Slot type] · [Day]` — e.g. "Reel · Tuesday". Muted, small. Confirms which slot is active without dominating the view.

### Reel Cards

Vertical scrollable list. Each card is a horizontal row. Generous padding between cards (`margin-bottom: 16px`). Clear visual separation.

**Card anatomy (left to right):**
1. **Thumbnail** — 9:16 ratio, fixed height ~100px, Drive thumbnail URL. If unavailable, show a dark placeholder with a play icon. Tapping the thumbnail plays the reel inline (see below).
2. **Summary column** — `Display_Name` (editable inline, pencil icon on hover) + `Reel_Summary` (read-only, 3 lines max, truncated with ellipsis). This is the primary differentiator — give it room.
3. **Caption column** — `Caption_Draft` if `Caption_Final` is empty, else `Caption_Final`. Click to edit inline (textarea, click away to commit and write `Caption_Final` to Asset_Library debounced). Slightly muted until interacted with.
4. **Action column (far right)** — two elements, vertically stacked:
   - **Generate Captions button** — opens chat panel (see below)
   - **Schedule button** — opens schedule popover (see below)

### Active Card State
When JT taps a card body (not the thumbnail, not a specific button), that card becomes active:
- Card snaps smoothly to vertical mid-screen (scroll into view, `scrollIntoView({ behavior: 'smooth', block: 'center' })`)
- Subtle active indicator: light gold left border `3px solid #FEBE18` on the card, or a faint gold background tint (`#FEBE1808`). Not heavy — she should still be able to read the full list.
- Only one card active at a time.

### Inline Reel Playback
Tapping the thumbnail expands it in place (within the card) to a slightly larger inline player — native `<video>` element, `src` from `getReelStreamUrl(assetId)`. Does not navigate away. Tapping again collapses it.

---

## Chat Panel

Triggered by the **Generate Captions** button on a card. Slides in from the right, overlaying the action column area. The card row compresses slightly to accommodate, or the panel overlays — whichever renders cleanly at typical desktop width.

### Panel anatomy (top to bottom):
1. **Close arrow** — top left of panel. Closes panel without any other action. This is the only dismissal mechanism — no Done button needed.
2. **Reel_Summary** — displayed at top of panel, read-only. Gives JT and the AI shared context at a glance.
3. **Conversation area** — scrollable message thread. Previous conversation (if any) loads here — conversation persists per card in session memory.
4. **Chat input** — bottom of panel, fixed. Text input + send button.

### Behavior:
- On open: if no prior conversation exists for this card, immediately call the LLM and render 3 caption chips without waiting for JT to type. She should see options within seconds of opening.
- If prior conversation exists: render the history, do not auto-generate. She picks up where she left off.
- LLM responses render as a mix of: plain conversational text + tappable caption chips at the end of each generation turn.
- Tapping a chip: writes that text to `Caption_Final` on the card (visible update, brief "Saved" confirmation), closes the chat panel automatically.
- JT can continue conversation after a chip populates the field — she can reopen the panel from the same card.
- Clicking a different card while the panel is open: closes the panel for the current card (saves conversation state), activates the new card. No confirmation required — conversation history is preserved.

### Context injected into every LLM call (assembled by GAS, never shown to JT):
```
System: You are a social media caption collaborator for the Don't Waste Your Pain podcast, hosted by JT (Jennifer Trepanier). You write in JT's brand voice: warm, direct, faith-adjacent but not churchy, emotionally honest. You are a collaborator, not a caption bot. Respond conversationally. When generating caption options, return them as discrete options formatted with [[CAPTION:]] delimiters so the UI can render them as tappable chips.

Context:
- Episode guest: {guest_name}
- Episode UID: {episode_uid}
- Slot: {slot_type} for {platform} on {day}
- Reel summary: {reel_summary}
- Current caption: {caption_final or caption_draft}
```

### Caption chip parsing:
Parse `[[CAPTION:]]` delimiters from LLM response and render as tappable chips. Plain text outside delimiters renders as conversational message text. Reuse or create the `[[CAPTION:]]` chip parser — same pattern is shared with Publish AI Companion and Help Desk chip rendering. Social Vert is retired and is not the reference implementation.

### Conversation persistence:
Stored in a JS object keyed by `Asset_ID`. Survives card switching within the session. Does not survive page reload — ephemeral. The caption written to Asset_Library is the only permanent artifact.

---

## Schedule Popover

Triggered by the **Schedule** button on a card. Opens a popover/modal over the current view.

### Popover anatomy:
- **Header:** "Schedule Reel · {Day}" — confirms the slot context
- **Week calendar view:** 7 columns (days), horizontal. Each column shows pills for already-scheduled assets of any type on that day. Pre-selected day is highlighted (the slot JT came from). She can see the full week at a glance.
- **Available slots of the same type:** If there are other empty Reel slots in the week, they appear as selectable empty pills. She can reassign to a different day.
- **Add custom:** A "+ Add" option to pick any day without a pre-defined slot.
- **Confirm button:** "Schedule [DAY], [DATE]" — full width, gold (`#FEBE18`), prominent. Pressing this:
  1. Writes a row to Social_Assets: `Post_ID` (generated), `Asset_Library_ID`, `Episode_UID`, `Slot`, `Asset_Type = Reel`, `Platform` (from slot definition), `Caption` (Caption_Final), `Drive_File_ID`, `Scheduled_At` (chosen date, noon in JT's timezone), `Scheduler_Status = pending`, `Created_At`, `Created_By`
  2. Updates Asset_Library row: `Status = scheduled`, `Availability = placed`
  3. Closes popover
  4. Week view slot updates to filled state (gold left border + one line of caption)

### Timezone note:
JT's timezone is stored in Governance_Config as `JT_TIMEZONE`. All scheduled times must be calculated in JT's local timezone, not Audra's or the server's.

---

## GAS Functions Required

Write or extend the following in `dwyp_app.gs`:

### `getReelsForEpisode(episodeUid)`
- Reads Asset_Library
- Returns all rows where `Episode_UID = episodeUid` AND `Asset_Type = Reel` AND `Status != rejected`
- Returns: array of objects with all Asset_Library fields

### `updateCaption(assetId, captionFinal)`
- Writes `Caption_Final` to the Asset_Library row matching `Asset_ID`
- Called debounced on caption blur from UI

### `updateDisplayName(assetId, displayName)`
- Writes `Display_Name` to the Asset_Library row matching `Asset_ID`
- Called on title edit commit

### `callPublishLLM(payload)`
- Calls `callClaudeAPI()` with payload. `STUDIO_LLM_MODE = claude` is the single key — no branching logic. Gemini fallback is automatic on API failure, logged to Audit_Trail.
- Returns raw LLM response string

### `scheduleReel(schedulePayload)`
- Writes Social_Assets row (fields listed above)
- Updates Asset_Library: `Status = scheduled`, `Availability = placed`
- Returns success/error

---

## Clasp Push Checkpoint

After all changes are written and verified locally, run:
```
clasp push
```
from within `C:\Projects\DWYP`. Confirm no errors before closing the spoke.
