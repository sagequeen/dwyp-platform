# DWYP — Social & Publishing Architecture Redesign
**Version: 3.2 | May 2026**
**Status: LOCKED — Implementation underway**
**Replaces: DWYP_Social_Architecture_Redesign.md v2.0**

> **⚠️ Partial supersede notice — May 2026.** Three sections below have been superseded by later decisions. Tab structure, canvas mechanics, week accordion, slot logic, and brand voice sections remain authoritative.
> - **Reels Player** — Drive iframe approach superseded. Planned: GCS hosting + native `<video>`. See Platform State v5.5.
> - **Social_Assets schema** — 21-column schema superseded by Asset_Library 13-column slim schema. See Reference v2.9.
> - **LLM Architecture** — `PUBLISH_LLM_MODE` retired. Librarian Vert retired. `callStudioLLM()` → `generateWithClaude()`. Single key: `STUDIO_LLM_MODE = claude`. See Platform State v5.5 AI Layer.

---

## The Problem This Solves

JT's current workflow for getting content out the door requires four to six context switches per episode. She moves between Gemini, NotebookLM, Drive, Instagram, and her own notes — copying, pasting, hunting for files, trying to remember which reel goes with which caption. By the time she's done, she's exhausted and the content is inconsistent.

The platform's original design didn't fix this. It added AI surfaces without addressing the fundamental friction: JT had to go find everything, assemble everything, and make every decision in isolation. The AI was a feature, not a workflow.

The redesign inverts this. JT arrives at a surface where the episode's content is already organized and waiting. She makes creative choices — which quote, which background, which reel — and the platform handles the rest. The AI is ambient: it prepopulates, suggests, and assists on request. It is never the load-bearing wall.

The goal is one sitting. She opens Publish, works through the week, and closes it knowing everything is scheduled. No hunting, no copying, no context switching.

---

## Implementation Status (May 2026)

**Written, not yet pushed (items 59–70 in Platform State build sequence).**

| Area | Status | Notes |
|---|---|---|
| Studio nav restructure | ✅ Written | Collapsible left nav, Publish/Design/Write/Outreach/Ideas tabs |
| Publish tab — week accordion | ✅ Written | Episode entry + Monday–Saturday days + slots |
| Publish tab — image canvas | ✅ Written | Fabric.js, 360×450, hooks/quotes panel, bg sidebar |
| Publish tab — reel view | ✅ Written | Drive iframe player ⚠️, Librarian Vert caption ⚠️, flex-wrap controls — see banner |
| Social_Assets schema (cols 1–21) | ✅ Written | Slide_Index, Availability, Display_Name, Summary added |
| `placeAssetInSlot()` | ✅ Written | Availability=placed + sibling pairing |
| `unscheduleAsset()` | ✅ Written | × on filled slots, confirm dialog, un-pairs siblings |
| `addToWeekAsImage()` | ✅ Written | PNG export → Staging/Images/, Social_Assets row on Add to Week |
| `getEpisodeHooksAndQuotes()` | ✅ Written | Reads show_notes Doc; parses HOOKS / QUOTES / image_prompts sections |
| `generatePublishCaption()` | ✅ Written | Librarian Vert, platform-aware prompt, on-demand |
| `ensureReelSummaries()` | ✅ Written | Background batch; stores in Social_Assets Summary col 21 |
| localStorage persistence | ✅ Written | Notes + captions per slot; keys: `dwyp_notes_{uid}_{slotId}` |
| Episode Review (F-4) | ✅ Written | Proxy player, comment submit, Revise_Episode task for Audra |
| Drive fallback for candidates | ✅ Written | `getStagingCandidates_()` scans Staging/ when Social_Assets empty |
| Episode accordion + comments | ⏳ Pending | Full comment panel, timecode capture, task_item_id sync |
| Finalize / Filing Fairy trigger | ⏳ Pending | Finalize button, Filing Fairy wiring |
| Design ↔ Publish asset travel | ⏳ Pending | Edit button, Save & Return, slot context hold |
| Timecode comments in Reels | ⏳ Pending | `currentTime` capture, click-to-seek |
| Caption pre-population (Daily Pulse) | ⏳ Pending | Daily Pulse audio extraction path not yet built |

---

## Retirement Decisions

| Surface | Status | Reason |
|---|---|---|
| **Image Workshop** | Fully retired | Replaced by Publish canvas. No bones carried forward. |
| **Studio — Images tab** | Retired as named | Replaced by Design tab — same canvas, new name, new role |
| **Studio — Show Notes tab** | Retired | Claude handles show notes; no surface needed |
| **Studio — Social Media mode** | Retired | Replaced by Publish tab |
| **Social Vert — everywhere** | Fully retired | Not in Studio, not anywhere |
| **Quick Caption (standalone)** | Retired | Caption is a pipeline step, not a standalone feature |
| **Pre-assembled slides (Artist Fairy graphics)** | Retired | JT builds graphics live in Publish. Artist Fairy no longer produces quote graphics. |
| **Iterative GenGem chat loop** | Retired | Replaced with prompt entry + session strip model |
| **Horizontal candidate strip** | Retired | Replaced by Hooks & Quotes list panel |

---

## New Architecture

### Four surfaces. One workflow.

The Publish tab is organized as four panels left to right. Each panel has a single job. Together they take JT from "what do I post this week" to "everything is scheduled" without leaving the surface.

---

### Panel 1 — Nav (Far Left)

Collapsible icon navigation. Peer of Dashboard, Contacts, Studio. Collapses to icons after any tab selection. Expand arrow reopens it. Unchanged from current nav behavior.

---

### Panel 2 — Episode Scheduler

The week accordion. This is where JT sees the shape of the week and tracks her progress.

**Structure:**
- **Episode** entry at the top — twirls open to show episode context, notes, and the comment panel. See Episode Accordion section below.
- **Monday through Saturday** — each day twirls open to show its slots

**Each slot shows:**
- Colored rectangle — **gold** for playbook slots, **crimson** for custom-added slots
- Thumbnail inside the rectangle when filled
- Slot type label
- One-line "why" description — unobtrusive, skippable, there when she needs it
- **× button** (right edge, hover-reveal) — removes asset from schedule. Confirm before clearing. GAS `unscheduleAsset()` resets Status→candidate, Availability→available, clears Slot/Caption/Scheduled_At, un-pairs sibling slides. Slots that still have Availability=paired are restored to available on unschedule.

**Custom slots:**
Each day has a + button at the bottom. Tap + → choose platform and asset type → crimson slot appears after all playbook slots for that day.

**Filled slot behavior:**
Tapping a filled slot reloads it in the canvas panel. She can swap content, edit caption, or rebuild the graphic. Nothing is locked once placed.

**On load:**
First unfilled slot is active automatically. She sits down and works. No decision overhead about where to start.

**Finalize:**
Finalize button locked until all slot decisions are recorded — each slot either filled or explicitly skipped. Finalize fires Filing Fairy.

---

### Panel 3 — Hooks & Quotes

A list of content options for the active slot, populated from the episode. This is where JT selects what goes on the graphic.

**Content source (as built):**
`getEpisodeHooksAndQuotes(episodeUid)` reads the show_notes Doc (written by Vert Fairy) and parses it via `extractSectionFromProse()`. Pulls HOOKS section (cleaned by `cleanHooksWithGemini()` to remove person-forward framing) and QUOTES section (verbatim with attribution). Returns `{ hooks, quotes, imagePrompts }`. Manifest `raw_hooks` / `raw_quotes` fields are vestigial and not used.

**Each item is tappable.** Tapping calls `pbDropText(text)`, which:
1. Replaces the existing text object on canvas (if one exists) OR places a new Textbox if the canvas is blank
2. Marks the item as "used" (gold chip, dimmed with badge)
3. Tracks which content is in which slot via `pb.slotContent{}`
4. Auto-fires `pbRegenCaption()` to generate a caption for the placed content

**Text is editable on the canvas after placement.** She can tweak wording without going back to the list.

**"Used" tracking:**
Items marked used when placed. Persists in memory for the session. If she opens a previously-filled slot, the item that was placed shows as used based on `pb.slotContent{}`.

**If she wants different options:**
She goes to Studio → Write, asks Claude to generate more hooks or quotes, and sends them to Publish from there. They appear in this list. This is not an in-Publish action — it's a Studio action that feeds Publish.

**This panel replaces:**
The horizontal candidate strip, the pre-assembled slide approach, and the Artist Fairy graphic production pipeline. There are no pre-made graphics. JT builds the graphic in Panel 4 using content from this list.

---

### Panel 4 — Canvas + Backgrounds

The creative surface. This is where the graphic gets built.

**Left side — Canvas:**
The active graphic. Text overlay from Panel 3 sits on a background from the right side. Corner handles control text size. Side handles control text width. Text is editable inline — click to edit, click away to commit.

**Canvas dimensions:** 360×450px on screen. Fabric.js 5.3.1. Export via `canvas.toDataURL({ multiplier: 1920 / exportH })` — outputs 1920×2400px PNG (correct for 4:5 at 1920 height baseline). `enableRetinaScaling: true`.

**Canvas text behavior:**
- `fontStyle: normal` always — no italic anywhere in Publish tab
- Corner handles → font size (via `scalingBaseFontSize` + `scalingBaseWidth` on object)
- Side handles → text width
- Top/bottom center handles disabled (`mt: false, mb: false`)
- **Clicking a new hook/quote chip REPLACES existing text**, not adds a second object. `pbAddTextToCanvas()` checks for existing `_isText` object and calls `existing.set('text', newText)` before falling back to creating a new Textbox.

**Center button:**
Aligns selected object (or all non-bg objects) **horizontally only** — `viewportCenterObjectH()`. Does not touch Y position. She can move text up or down, then hit Center to align it symmetrically from the left and right edges.

**Caption:**
Lives to the right of the canvas (same position as Reels controls — `pb-canvas-controls` column). Rendered by default — looks finished, clearly attached to the graphic. Click to unlock for inline editing. Click away commits. Regenerate (`pbRegenCaption()`) calls Librarian Vert with:
- Platform from `pb.activeSlotPlatform` (e.g., "INSTAGRAM STORY")
- Content text extracted from canvas `_isText` objects
Returns platform-aware caption. Soft confirm before overwriting if she's edited manually (⏳ pending).

**Caption persistence:** Saved to `localStorage` on blur/regen. Key: `dwyp_caption_{episodeUid}_{slotId}`. Restored on slot re-entry. Notes also persist: `dwyp_notes_{episodeUid}_{slotId}`.

**Notes:**
Scratchpad in the controls column. Not a submission field. Does not post. JT-only.

**Add to Week:**
Exports the composed graphic as PNG, writes the Social_Assets row, marks the slot filled in Panel 2, advances to the next unfilled slot automatically. Image path calls `addToWeekAsImage(uid, slotId, b64, mimeType, caption)`.

**Right side — Background tools (top to bottom):**

*Prompt entry*
Text field where she types or edits a background image prompt. Generate button fires GenGem.

*Suggestions*
Pre-generated image prompts from `getEpisodeHooksAndQuotes().imagePrompts`. Tappable. Tapping drops the prompt into the prompt field above. She uses it as-is or tweaks before generating. Only shown if imagePrompts is non-empty.

*Generated*
Everything she's produced via Generate this session. Persists for the session. Tap any thumbnail to apply it to the canvas. Stays completely separate from the premade library — her scratch work doesn't pollute the curated set.

*Background library*
`IMAGE_BACKGROUND_LIBRARY_ID` — the curated premade library. Always at the bottom, always stable. Tap to apply. This is what she reaches for when the generated options aren't working.

---

## Reels

Reels have their own view within Publish. The slot structure and week accordion are identical — the canvas panel changes.

**Left panel (within Publish):**
Vertical scroll browser. MP4 files only.

**Intended source (spec):** Social_Assets rows only — `Asset_Type = Reel` (matching `Episode_UID`) or `Asset_Type = Bank_Clip` (any episode). Filter: `Availability = available`. If a reel is not registered as a Social_Assets row, it does not appear. Drive is not a fallback source for Reels per spec.

**As built (transition state):** `getStagingCandidates_()` currently falls back to scanning `Staging/Reels/Approved/` (then root) when Social_Assets has no rows for the episode. This fallback exists because Social_Assets rows for reels are not yet being created upstream at episode setup time. The fallback is a bridge — remove it once the upstream write path (Daily Pulse or Artist Fairy creating Reel rows on ingest) is live.

Each reel card shows:
- Video frame thumbnail (first or mid-point frame via Drive thumbnail endpoint)
- Display name shown on hover — editable. Click-to-unlock pattern. On commit: updates `Display_Name` in Social_Assets and renames the file in Drive silently via `DriveApp.getFileById(id).setName(newName)`.
- Default names: `Reel 1`, `Reel 2`, `Reel 3`, `Bank Clip` — populated by `getStagingCandidates_()` on row creation.

**Center — Player:**
**⚠️ Superseded.** Planned hosting: GCS (Make mirrors Drive → GCS). Player will use native `<video>` element with GCS URL. Drive iframe embed approach below is no longer current. See Platform State v5.5 Engineering Notes.

~~Drive iframe embed: `<iframe src="https://drive.google.com/file/d/{ID}/preview">`. Not a `<video>` tag — Drive auth redirects prevent direct MP4 streaming.~~ Player capped at approximately 60% of available height. Interactive elements are always visible without scrolling.

**Interactive elements — responsive:**
- **Wide screen:** Notes, Caption, Regenerate, Add to Week sit to the right of the player
- **Narrow screen:** wrap below via CSS `flex-wrap: wrap`. No JavaScript breakpoint logic needed.

**Reel summaries:**
`ensureReelSummaries(episodeUid)` fires background (fire-and-forget) on episode load. For each reel without a Summary, calls Librarian Vert to generate a 1–2 sentence context description from the reel's display name + episode metadata. Stored in Social_Assets `Summary` col 21. Used by `generatePublishCaption()` to give the LLM reel context when generating captions (the platform cannot transcribe audio in GAS).

**Caption:**
Same click-to-unlock pattern as graphics. Rendered below or beside the player. Auto-generates via Librarian Vert (`generatePublishCaption(uid, platform, contentText)`) — `contentText` is `Display_Name + reelSummary`. Platform-aware prompt includes `PLATFORM: {PLATFORM}` prefix. Regenerate available. Saved to localStorage per slot.

**Title card:**
⏳ Pending — needs design decision before it can be built. JT's expectation is that the reel view produces two named outputs: a **caption** (for the post body) and a **title card** (the text overlay displayed on the reel before posting on Instagram). Currently the platform only produces a caption. Title card generation should be added as a distinct field alongside caption in the Reels view — same click-to-unlock editing pattern, separate Generate button or combined with caption regen. Decide whether title card is stored in Social_Assets as a new column or kept in the manifest.

**Notes:**
Scratchpad. Not a submission field. Clearly labeled. Saved to localStorage per slot.

**Timecode comments:**
⏳ Pending. If she leaves a comment while the reel is playing, the player's `currentTime` is captured and attached. Clicking the timecode later jumps the player to that moment. Frame.io pattern.

---

## Episode Accordion

The Episode entry at the top of Panel 2 is JT's review shelf. It twirls open like a day, sits above the week, gives her a place to orient before she works.

**Contents:**
- Guest name, release date, episode status — read only
- JT's notes field — writable, free form
- "Review Episode" — embeds the proxy player inline. Full episode review lives here, not in a separate nav view. `episodeReviewView` is retired as a standalone surface.
- Comment panel on the right side — see Comment System below (⏳ pending)

**Backing storage:**
A Google Doc per episode created by Secretary at setup. Comments append as dated entries. Audra can read it in Drive without opening the app.

---

## Comment System

⏳ Pending implementation.

**Layout:**
Comments on the right side of the Episode accordion surface. Content on the left, comments on the right. Standard pattern — Google Docs, Frame.io, Notion.

**Comment card:**
- Author label (JT / Audra)
- Date/time timestamp
- Video timecode if she was watching the proxy player when she commented — clicking jumps the player to that moment
- Comment text
- Resolved/Unresolved toggle
- Delete option — small, requires confirm

**Views:**
- **Active (default):** Unresolved comments full size. Resolved collapsed at bottom behind "Show resolved" toggle.
- **All:** Everything visible. Full audit trail.

**Comment states:**

| State | Meaning |
|---|---|
| Active | Unresolved — JT still wants it addressed |
| Resolved | Audra checked it off via Revise task. JT sees it dimmed. |
| Struck through | JT deleted or retracted it. Still readable in Audra's task. Never truly gone. |
| JT self-resolved | She decided it was fine. No action needed from Audra. |

---

## Revise Task ↔ Comment Sync

⏳ Pending implementation.

One Revise task per episode. Checkboxes are dynamic — populated from JT's comments automatically.

**Flow:**
1. JT leaves a comment → appears unresolved in comment panel
2. Audra opens the Revise task → comment surfaces as a checkbox item, timecode included
3. Audra checks an item → comment auto-resolves in JT's view
4. JT edits a comment → checkbox updates to match. Task never goes stale.
5. JT deletes a comment → checkbox goes strikethrough in Audra's task. Still readable. Not gone.

**Schema:**
Comments need a `task_item_id` field linking to the specific Revise task checkbox. This drives two-way sync.

**Why strikethrough instead of delete:**
JT will ask about something she deleted. The log is permanent. Visual state changes; the record doesn't.

---

## Design ↔ Publish Asset Travel

⏳ Pending implementation.

Design and Publish share the same canvas. Assets move between them cleanly.

**Publish → Design → Publish:**
If JT wants deeper creative work than Publish's canvas offers, Edit button navigates to Design with the asset loaded. Design carries `publish_origin: { episode_uid, slot_id }`.

When done in Design, two actions:
- **Save & Stay** — saves, remains in Design. Slot context held in background.
- **Save & Return** — saves, returns to Publish. Correct slot is active. Updated asset in place.

Autosaves if she wanders off. Nothing lost.

**Design context awareness:**

| How she arrived | Actions shown |
|---|---|
| Directly from nav | Save & Stay only |
| Via Edit from Publish | Save & Stay + Save & Return |

**Design canvas state — Continue card:**
Design autosaves to a single manifest on every debounced pause. On open, side panel shows a Continue card with thumbnail and timestamp of the last unsaved session. Tap to restore. Ignore to start fresh.

Continue card clears when she saves explicitly or returns to Publish via Save & Return. Cleared canvas = done. Continue card = unfinished. No ambiguity.

---

## LLM Architecture

**⚠️ Superseded.** `PUBLISH_LLM_MODE` retired — replaced by single key `STUDIO_LLM_MODE = claude`. Librarian Vert persona retired — Claude introduces itself as Claude. `callStudioLLM()` renamed to `generateWithClaude()`. See Platform State v5.5 AI Layer table for current architecture.

### Caption and content generation
`generatePublishCaption(episodeUid, platform, contentText)` — calls `callStudioLLM()` (Librarian Vert / Vertex RAG + Gemini). Platform injected as `PLATFORM: {PLATFORM}` prefix. Content text is canvas text (images) or `Display_Name + reel summary` (reels). Fired on hook/quote chip tap and on Regenerate button.

`PUBLISH_LLM_MODE` in Governance_Config. Value: `gemini` now. Swap to `claude` when JT's API billing is configured — one key change, no UI impact.

### Reel summarization
`ensureReelSummaries(episodeUid)` / `getOrGenerateReelSummary(postId, episodeUid)` — background Vert calls that produce context descriptions for each reel. Stored in Social_Assets `Summary` col 21. GAS cannot transcribe audio (35MB ceiling hard limit); summaries are derived from metadata + display name + episode context, not audio.

### Cleanup layer
Claude generates:
- Hooks and quotes list (surfaces in Panel 3) — via `getEpisodeHooksAndQuotes()` parsing show_notes Doc
- Image prompt suggestions (surfaces in Panel 4 Suggestions section)
- Caption drafts (on-demand via Librarian Vert)

Gemini handles:
- Image generation (GenGem, fired from Panel 4 prompt entry)
- Audio extraction and caption grounding (Daily Pulse → Reels caption) — ⏳ pending Daily Pulse audio spoke

### AI Division of Labor (target state)

| Role | Technology | Jobs |
|---|---|---|
| **Brain** | Claude API (pending billing) | Hooks, quotes, image prompts, captions, show notes, voice-sensitive output |
| **Grunt** | Gemini API | Image generation, audio/video summarization, transcription, Herald web search |

---

## Platform Strategy — IG First

Instagram is the primary growth engine. All asset decisions optimize for Instagram first, reused on other platforms.

| Asset | Format | Platforms |
|---|---|---|
| Quote Graphic | 4:5 portrait (1080×1350) | Instagram feed, Facebook, LinkedIn — one file, all three |
| Reel | 9:16 (1080×1920) | Instagram, TikTok, YouTube Shorts, Facebook Reels — one file, all four |
| Thumbnail | 16:9 (1080×608) | YouTube only |
| Bank Clip | 9:16 | Same as Reel |

All static graphic slots are 4:5. No 1:1 slots remain. Square deck retired.

Platform routing lives in the slot. JT never selects a format or platform.

---

## Social_Assets Schema

**⚠️ Superseded.** This 21-column Social_Assets schema was replaced by the 13-column Asset_Library slim schema. See Reference v2.9 for the current authoritative schema. The section below is preserved for historical reference.

Column numbers match `SOCIAL_ASSETS_COLS` in `dwyp_app.gs`.

| Col | Field | Notes |
|---|---|---|
| 1 | Post_ID | System-generated |
| 2 | Episode_UID | Foreign key |
| 3 | Asset_Type | Quote_Graphic / Reel / Thumbnail / Bank_Clip |
| 4 | Platform | Instagram / Facebook / LinkedIn / YouTube / TikTok |
| 5 | Release_Week | Week of episode release |
| 6 | Status | candidate / scheduled / bank / rejected |
| 7 | Caption | Primary caption |
| 8 | Caption_Secondary | Secondary platform caption if needed |
| 9 | Drive_File_ID | Written on Add to Week (PNG export or Reel file ID) |
| 10 | Attribution_Label | Bank clips only |
| 11 | Scheduled_At | Date/time target |
| 12 | Scheduler_Status | pending / queued / posted / failed — Make writes back |
| 13 | Posted_At | Make writes on success |
| 14 | Created_At | Timestamp |
| 15 | Slot | Foreign key → Posting_Schedule tab |
| 16 | Created_By | system or user email |
| 17 | Thumbnails | (reserved) |
| 18 | Slide_Index | Integer — content identity key for pairing. Images only, null for Reels. |
| 19 | Availability | available / placed / paired — controls candidate panel visibility |
| 20 | Display_Name | Reel display name — editable by JT. Null for image assets. |
| 21 | Summary | Vert-generated context description. Reels only — used by caption LLM. Null for image assets. |

**Status flow:** candidate → (JT places) → scheduled + Scheduler_Status: pending → (Make picks up) → queued → (Make posts) → posted or failed

**Availability flow:**
- `available` → JT places → `placed`
- Sibling (same Slide_Index, same Episode_UID, different row) → `paired`
- JT unschedules → `placed` reverts to `available`; `paired` siblings revert to `available`

**Row creation:**
Social_Assets rows are created on Add to Week — not before. The candidate panel (Panel 3) reads from the episode's show_notes Doc, not from pre-written asset rows. Drive-fallback assets (`getStagingCandidates_()`) also get a row created on first Add to Week.

---

## Posting_Schedule Tab

Drives the week accordion template. One row per slot. Static — lock after entry.

| Column | Values |
|---|---|
| Slot_ID | Primary key |
| Day | Monday–Saturday |
| Asset_Type | Quote_Graphic / Reel / Thumbnail / Bank_Clip |
| Platform | Instagram / Facebook / LinkedIn / YouTube / TikTok |
| Ratio | 1:1 / 4:5 / 9:16 / 16:9 / null |
| Why | One-line description shown in slot |
| Sort_Order | Display order within day |

**Current rows:**

| Slot_ID | Day | Asset_Type | Platform | Ratio | Why | Sort_Order |
|---|---|---|---|---|---|---|
| SLOT-MON-01 | Monday | Quote_Graphic | Instagram Story | 4:5 | Warm up the audience. One striking line creates anticipation. | 1 |
| SLOT-TUE-01 | Tuesday | Reel | Instagram / TikTok / YouTube Shorts | 9:16 | Strongest clip. Primary discovery post. | 1 |
| SLOT-TUE-02 | Tuesday | Thumbnail | YouTube | 16:9 | Pick one of three. This is what viewers see before they click. | 2 |
| SLOT-TUE-03 | Tuesday | Quote_Graphic | LinkedIn / Facebook | 4:5 | Choose LinkedIn for transformation themes, Facebook for broader emotional appeal. | 3 |
| SLOT-TUE-04 | Tuesday | Quote_Graphic | Instagram Story | 4:5 | Vertical graphic with link sticker. Tells existing followers something is live. | 4 |
| SLOT-WED-01 | Wednesday | Reel | Instagram / TikTok / YouTube Shorts | 9:16 | Second best clip. Catches anyone who missed Tuesday. | 1 |
| SLOT-THU-01 | Thursday | Reel / Bank_Clip | Instagram / TikTok | 9:16 | Third clip if strong. Otherwise pull from the bank. | 1 |
| SLOT-FRI-01 | Friday | Quote_Graphic | Instagram | 4:5 | Extends the episode's life into the weekend. | 1 |

**Make handles time logic.** No time-of-day picker in the UI. DWYP writes the day target; Make determines optimal post time.

---

## Caption Pipeline

**Current state (as built):**
Caption is generated on demand by Librarian Vert (`generatePublishCaption()`). Fires automatically when JT taps a hook/quote chip; also available via Regenerate button. Platform-aware prompt — `PLATFORM: {PLATFORM}` prefix. Persisted to localStorage per slot.

**Future trigger (⏳ pending — Daily Pulse audio spoke):**
Daily Pulse detects reel uploaded → extracts audio → generates caption draft via Gemini → writes to manifest → Publish surfaces it pre-populated.

**Editable until Make fires** (Scheduler_Status = pending or queued). Once posted, locked.

**⚠️ File size dependency:** GAS 35MB ceiling. Audio-only extraction via Web Audio API is the proposed mitigation. Must be resolved before Daily Pulse audio spoke opens.

---

## Caption Brand Voice

**Reference:** JT approved this Carson episode caption as the calibration target for platform-generated captions. Use as a few-shot example when writing the Publish caption prompt.

> He could've chosen relief. He chose presence.
>
> Carson knew the cost — and paid it anyway.
>
> He stayed awake through a body that was shutting down, just to be with the people he loved for as long as he possibly could.
>
> Thirteen years old — and showing us what most of us spend a lifetime avoiding.
>
> This isn't just a story about dying. It's a masterclass in living. This is what not wasting your pain looks like.
>
> Link in bio.

**What makes this JT's voice:**
- Short declarative sentences
- Contrast as structure ("could've chosen / chose")
- Names the guest — never anonymizes
- Earns the show tagline at the end — never forces it in early
- Emotion is in the facts, not the adjectives
- No performed enthusiasm, no preamble

When the Publish caption prompt is written, this sample should be included as a few-shot example. The platform should be able to reproduce this register without being told "be emotional" — the model should derive tone from the example, not from adjectives in the system prompt.

---

## Thumbnail Slot

Tuesday, YouTube, 16:9. Three candidates surfaced from the episode record. JT picks one. Add to Week writes the chosen file ID to the Episodes tab (not Social_Assets — this isn't a Make-posted asset). The unchosen candidates stay in staging untouched. Audra pulls the chosen file for the YouTube upload.

---

## Audra Notifications

Audra only needs to know if JT has requested a revision. Scheduling confirmation is implicit in the sheet write. No other approval notifications required.

---

## SupoClip — Under Consideration
**Repo:** https://github.com/FujiwaraChoki/supoclip
Open-source OpusClip alternative. Self-hosted via Docker. AI-powered clip generation from long-form video. No watermarks, no monthly fees. Evaluate when Reels workflow is fully designed.

---

## Future Enhancements

Items confirmed by JT feedback. Not yet designed. Each needs a design decision before a spoke can open.

### NF-1 — Quotes Dedup Review
When the platform surfaces hooks and quotes for an episode, near-duplicate items should be visually grouped so JT can review them side by side and take one action: delete, approve, or edit. She shouldn't have to hunt for similar lines across a long list.

**Open design question:** Is this a pre-Publish quotes review step (before she opens the week), or does it happen live in Panel 3 while she's working the canvas? Decide before this spoke opens. The answer determines whether it's a separate surface or an inline grouping in the existing Hooks & Quotes panel.

### NF-2 — Reel Identity and Comment Portability
When reels are numbered (Reel 1, Reel 2, Reel 3), any notes or comments JT attaches to a reel need to stay associated with it permanently — so when she goes to post on Instagram the right title card and caption are already paired with the right reel. No manual matching.

**What's needed:** Reels need a stable identifier beyond filename (number or slug). The `Display_Name` column and `Summary` column in Social_Assets are the foundation. What's missing is surfacing those fields clearly alongside the reel when she's in the posting workflow, and confirming the title card field (see Reels section above) travels with the record.

**Note:** The Reels comment button is already wired in the current app. This is about making notes and title cards *persistent and portable*, not adding comment capability from scratch.

### NF-3 — AI Video Review (END ALL)
JT's described end-state: the platform reviews the reel automatically — AI watches the clip and suggests a title card and caption without her having to type anything. She reviews, approves, and schedules.

**Technology dependency:** Requires Gemini Video (multimodal video understanding). Not available within GAS's file size ceiling. This is a major future architecture item — flag when Gemini Video API becomes accessible and GAS file ceiling is resolved. The current notes → Librarian Vert → caption path is the interim version of this.

---

## Build Sequence

1. **Publish surface spoke** ✅ Written, not yet pushed — Four-panel layout, week accordion, hooks/quotes list, canvas + background tools, Reels view, Social_Assets write on Add to Week.
2. **Claude cleanup layer spoke** ✅ Partially built — `getEpisodeHooksAndQuotes()` parses show_notes Doc. `generatePublishCaption()` via Librarian Vert. Image prompt Suggestions wired. Caption auto-fires on chip tap. Full pre-population via Daily Pulse audio still pending.
3. **Studio restructure spoke** ✅ Written, not yet pushed — Publish / Design / Write / Outreach / Ideas. Show Notes tab removed. Social Media mode removed.
4. **Posting_Schedule tab** ✅ Created. Rows must be populated by Audra before week accordion renders slots.
5. **Make setup** ⏳ — Audra action after Publish spoke is pushed and confirmed stable.
6. **Comment system + Revise task sync spoke** ⏳ — Comment panel, timecode capture, task_item_id linking, two-way resolve sync.
7. **Design ↔ Publish asset travel spoke** ⏳ — Edit button, `publish_origin` payload, Save & Return.
8. **Daily Pulse audio spoke** ⏳ — Audio extraction, caption pre-population to manifest, reel caption grounding.

**Spokes not affected:** Herald, Vert Fairy retrieval logic, RAG corpus.
**Artist Fairy:** No longer produces quote graphics. `exportSlidesToPng()` written and available; role in post-redesign pipeline TBD — may still handle Reel thumbnails or other assets. Confirm before that spoke opens.

---

## Studio Backend Spoke — Spec (Pending)

This spoke is quarantined from Platform State until Studio is stable. Full spec preserved here.

**Scope:** Backend only. No UI changes. Files: `fairy_circle.gs`, `dwyp_app.gs`.
**Prerequisite:** Add `STUDIO_IMAGE_MODEL` and `STUDIO_TOKEN_WARNING_THRESHOLD` to Governance_Config before testing.

### Design Decisions (Locked)

- **Image model:** `gemini-2.5-flash-image` — read from `STUDIO_IMAGE_MODEL` governance key
- **Two separate histories:** Main Vert conversation history (text) and image session history kept in separate arrays. Image iterations never pollute the main conversation thread.
- **Thought signatures:** Gemini 3 Pro returns `thoughtSignature` fields in response parts. For image generation this is strictly enforced — missing signatures on the next call return a 400 error. Image history must store **full response parts arrays verbatim**, not extracted text/base64.
- **Ephemeral images:** Generated images are not saved automatically. Only saved when JT explicitly clicks in (UI calls `stSaveBackgroundToLibrary()`).
- **Token tracking:** `callStudioLLM()` accumulates token counts from `usageMetadata` and returns the running total. The UI (separate spoke) surfaces a warning at threshold.

---

### `callStudioImageGen(prompt, imageHistory)` — `fairy_circle.gs`

New shared utility. Calls `gemini-2.5-flash-image` with conversation memory.

**Parameters:**
- `prompt` — string
- `imageHistory` — array of prior turn objects `{role, parts}` where `parts` is the raw API parts array including any `thoughtSignature` fields. Pass `[]` on first call.

**Implementation:**
- Read model from `getGovernance('STUDIO_IMAGE_MODEL')`
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
- `generationConfig.responseModalities: ["TEXT", "IMAGE"]`
- **Critical — thought signature handling:** Store `candidates[0].content.parts` as-is in `updatedHistory`. Do NOT extract fields. The full parts array (which may contain `thoughtSignature`, `text`, and `inlineData` entries) must be the stored model turn or the next call returns 400.
- Parse response: find part where `part.inlineData` exists → extract `base64` and `mimeType`. Find text part if present.
- On error: `logToAuditTrail('Studio_ImageGen', 'IMAGE_GEN_ERROR', '', 'ERROR', errorMessage)` and throw.

**Returns:** `{ text, base64, mimeType, updatedHistory, tokenCount }`

---

### `stDetectImageIntent(userMessage)` — `dwyp_app.gs`

Lightweight keyword heuristic — no API call.

**Logic:** Lowercase the message, return `true` if any of these terms are present:
`background`, `image`, `generate`, `create`, `visualize`, `picture`, `photo`, `make me`, `show me`, `try something`, `different one`, `change it`, `new version`, `darker`, `lighter`, `more`, `less`, `option`, `instead`

Intentionally broad — false positives are acceptable, Vert handles them gracefully.

---

### `callStudioLLM(prompt, ragContext, conversationHistory, imageHistory, options)` — `dwyp_app.gs`

Full implementation replacing the existing stub. Preserve function name exactly.

**Parameters:**
- `prompt` — user message string
- `ragContext` — string of retrieved corpus context (already retrieved upstream by UI via Vertex RAG — this function does not call RAG itself)
- `conversationHistory` — array of `{role, parts: [{text}]}` for main Vert thread
- `imageHistory` — array of raw parts-based turn objects for image thread
- `options` — `{ mode: string, episodeUid: string | null }`

**Logic:**
1. Call `stDetectImageIntent(prompt)`
2. **If image intent:** Call `callStudioImageGen(prompt, imageHistory)`. Return `{ type: 'image', base64, mimeType, text, updatedImageHistory, tokenCount }`. Do NOT update `conversationHistory`.
3. **If text intent:** Build system prompt from `ragContext` + mode. Build contents array from `conversationHistory` + current user turn. Call `callGeminiAPINoSearch()` with `getGovernance('MODEL_NAME')`. Append new user + model turns to `conversationHistory`. Return `{ type: 'text', text, updatedConversationHistory, tokenCount }`.

On any error: log to Audit_Trail and throw. Never swallow silently.

---

### `stSaveBackgroundToLibrary(base64Data, mimeType, guestSlug)` — `dwyp_app.gs`

Called by UI when JT clicks a generated image into the library.

**Logic:**
- Read folder from `getGovernance('IMAGE_BACKGROUND_LIBRARY_ID')`
- Decode: `Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType)`
- Filename: `bg_${guestSlug}_${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmm')}.png`
- Create file, log: `logToAuditTrail('Studio', 'BG_SAVED', guestSlug, 'INFO', filename)`
- Return `{ fileId, url, filename }`

---

### Governance Keys to Add Before Testing

| Key | Value |
|---|---|
| `STUDIO_IMAGE_MODEL` | `gemini-2.5-flash-image` |
| `STUDIO_TOKEN_WARNING_THRESHOLD` | `50000` |

`STUDIO_TOKEN_WARNING_THRESHOLD` is read by the UI layer (separate spoke) to decide when to surface the "session getting long" warning. Backend returns cumulative `tokenCount`; UI checks against threshold. Backend does not check the threshold itself.

### Preservation Notes
- `callGeminiImageAPI()` is untouched — it belongs to Image Workshop, not Studio.
- The `callStudioLLM` stub may be sparse — replace its body, keep the function name exactly.
- Any existing references in `dwyp_app.gs` that call `callStudioLLM` must remain wired correctly after implementation.
