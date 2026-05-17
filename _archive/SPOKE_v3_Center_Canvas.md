# Spoke: v3 Center Canvas — Day-Stack, Twirl Sections, Card States, Companion Unification

**Mode:** Build. Substantial spoke. Phased internally — checkpoint between phases.
**Goal:** Replace the current stub center pane with the v3 design Audra walked: day-level navigation → twirl-collapsible post-type sections → cards with three states (collapsed thumbnail / expanded full canvas / scheduled faded) → unified right-rail Claude as the only companion across all card types.

---

## Status — May 2026

**Cosmetic pass complete (all phases — UI only, stub data, no GAS wiring).**

All four phases implemented and on staging. Cards expand/collapse/animate, reel and image layouts are final, accordion enforces one-card-per-section, right-rail companion shell is in place. See Platform State v5.8 item 91 for full change list.

**Wiring phase is next** — the hub session scopes the GAS connections:
- `getRankedCandidates()` → real Asset_Library data via `getPublishSchedule()` / `getReelsForEpisode()`
- Image card expand → real `pbInitCanvas` + canvas state restore
- Reel card expand → real `getReelStreamUrl()` GCS URL
- Schedule button → `pbAddToSlot()` / `placeAssetInSlot()` wired end-to-end
- `pbRailSetActiveSlot()` context injection into Claude API packet

**Deferred (confirmed, not forgotten):**
- Trim deep-link to specific file (needs GCS + Sentinel; Open Issue 10)
- Processing overlay real async trigger (Open Issue 11)
- Chip routing actions (quote → canvas, image-prompt → Generate, caption → caption box)
- Left rail icon state machine (dots → 🎧🖼🎬, green/red states)

---

---

## Read First

Before writing anything:

1. **`DWYP_Operating_Model.md` v1.1** — the spine. Read once, end to end. Pay attention to §7 (Rail Contract), §8 (Companion Model), §9 (Slot Model), §10 (Cardinal Rules, especially "engine stays, chassis changes").
2. **`DWYP_Platform_State.md`** — for current build state.
3. **The Preservation Audit output** (last spoke's report) — for the function inventory of what's intact.

If you don't have one of these, stop and ask.

---

## Mandate Scope (for this spoke)

**Engine stays, chassis changes** applies fully.

**Preserved (must not be renamed, refactored, or have internal logic altered):**
- All canvas functions: `pbInitCanvas`, `pbDisposeCanvas`, `pbSaveCanvasState`, `pbCanvasUndo`, `pbCanvasRedo`, `pbAttachBgControls`, `pbClampBackground`, `pbReattachBgControls`, `pbAddTextToCanvas`, `pbToggleShadow`, `pbCenterText`, `pbPlaceLogo`
- All scheduling functions: `pbConfirmSchedule`, `pbUnscheduleSlot`, `pbOpenSchedPopover`, `pbSchedSelectSlot`, `pbSchedUpdateConfirmBtn`, `pbSchedPickCustomDay`, `pbAddToSlot`
- All reel functions: `pbSelectReel`, `pbToggleCardPlayer`, `pbGenerateCaption`, `pbRegenCardTc`, `pbReelThumbError`, `pbUnlockReelName`, `pbUnlockCardName`, `pbUnlockCardCaption`
- All candidate/rendering: `pbSelectCandidate`, `pbSelectSlot`, `pbRenderCandidates`, `pbRenderReelBrowser`
- All server functions: `scheduleReel`, `placeAssetInSlot`, `getPublishSchedule`, `getReelsForEpisode`, `enrichReelsForEpisode`, `updateReelDisplayName`, `generateReelCaption`, `getReelStreamUrl`, `addToWeekAsImage`, `generateBackground`
- All data layer constants and read/write patterns (`ASSET_LIBRARY_COLS`, `SOCIAL_ASSETS_COLS`, `POSTING_SCHEDULE_COLS`)

**Replacing (chassis change — fair game):**
- `v3RenderOptionCards()` and its stub hardcoded bundles
- The reel-side chat panel (`pb-reel-chat` and `pbReelChat*` if separate from right-rail Claude)
- Stub option-card visual layout

**Adding (new):**
- Day-stack with twirl-collapsible post-type sections
- Card state machine (collapsed → expanded → scheduled-faded)
- Canvas-on-expand wiring for Quote Graphic + Thumbnail cards
- Reel-on-expand wiring (player + caption only, no canvas)
- Active-card → right-rail Claude context handoff (via existing `pbRailSetActiveSlot` shape)

**Deferred (do not build in this spoke):**
- Real Vert Fairy Pass 2 enrichment data (use stub data — see below)
- Chip routing actions (quote → canvas, image-prompt → Generate, caption → caption box) — separate spoke after this lands
- Slot context injection into the Claude API packet (this spoke just hands the rail an activeCardId; the actual context shape is the next spoke)
- `Asset_Library.chat_history` column 19 persistence — Phase 4 schema work
- Pending Canvas (Next/Poke buttons) — needs recipe table + Q14 first
- Left rail icon state machine fix (dots → 🎧🖼🎬, green → red) — separate small spoke
- `st-header` white bar removal — separate cosmetic spoke
- Loose-task onclick wiring — separate small spoke

---

## The Design (Audra's Walkthrough — Authoritative)

### Day-level navigation

Day cards across the top (already exists in `pb-day-card-row`). Tap a day → that day's posts appear in the center pane stack below. Day cards continue to show dots per slot (gold = filled, muted = empty) on the day strip itself.

### Day stack contents

For the selected day, render one **twirl-collapsible section per post type** that has slots that day. Possible sections: **Reels**, **Quote Graphics**, **Thumbnails**, plus any other slot type the recipe defines for that day.

Section order: Reels first if present, then Quote Graphics, then Thumbnails, then others by slot recipe `Sort_Order`. *When multiple post types exist on one day, all sections render stacked. JT twirls them open/closed as she works.*

Section headers show: post-type name + count ("Quote Graphics · 1 of 3 scheduled") + twirl arrow. Default state: top section open, others collapsed. Tapping a section's header toggles its open/closed state. Multiple sections can be open at once — twirl is not exclusive.

### Cards within a section

Each section contains the cards available for that post type on that day. Three card states:

**State 1 — Collapsed (thumbnail):**
- Small thumbnail (image preview for Quote Graphic / Thumbnail; reel cover frame for Reel)
- Cleaned-up summary line (Reel_Summary for Reel; quote text snippet for Quote Graphic; title text for Thumbnail)
- Status indicator if scheduled (see State 3)
- Ranked-set tint: top 3 ranked candidates have a subtle background tint distinguishing them from the rest-of-pool below

**State 2 — Expanded:**
- Card grows in place; other cards in same section stay collapsed (Accordion-as-Focus *within* the section)
- For Quote Graphic / Thumbnail: Fabric.js canvas appears, identical pattern to Design tab — canvas + design tools beneath it (Undo / Redo / Center / Logo + text controls). Caption box below canvas, prefilled, editable.
- For Reel: inline `<video>` player using `getReelStreamUrl()`. Full Reel_Summary. Caption box, prefilled, editable. **"Edit Reel" button** that routes to Google Vids (Sentinel Fairy / `pbEditReel` path — preserve existing).
- **Claude in right rail gets this card as foreground context.** Call `pbRailSetActiveSlot(slotId, assetType)` on expand. *Actual context-injection into the Claude packet is a follow-up spoke; this spoke just calls the rail API with the active card identity.*
- Schedule button. Unschedule button (if already scheduled, see State 3 reversal).

**State 3 — Scheduled (faded lock):**
- Card returns to collapsed thumbnail size
- Faded styling (~50% opacity, or however the brand tokens express "locked but not gone")
- Status indicator visible (e.g., "Scheduled for 9:00 AM" or similar)
- Affordances: **Unschedule** and **Edit** buttons accessible on hover/tap. Unschedule reverts to State 1; Edit re-expands to State 2 with all prior state restored.

State transitions are reversible. Schedule visually locks; Make's read-time technical lock is unchanged (per *The Slot Is The State*).

### Ranked set — 6 surface per slot, top 3 tinted

The pre-composed pool per episode:
- **Quote Graphics:** 20 text candidates (10 hooks + 10 quotes), 20 background images. Each pre-composed AL row pairs text with a background and pre-composes `Canvas_State`. *Pool is already being produced by the enrichment design — this spoke does not change the enrichment.*
- **Reels:** All reels JT/Audra have added to the episode (typically 4–8). Quality_Score + tag-match applied.
- **Thumbnails:** Per the enrichment design (TBD count; stub with 5).

Per section, **6 candidates surface per slot** via ranking:
1. Order by **Quality_Score (DESC)**. Quality_Score is absolute, not relative — ties allowed (multiple 5s).
2. Within ties, **tag-match to `slot.Why`** breaks them. Closest match floats higher.
3. Top 6 surface as cards in the section.
4. **Top 3 of the 6 are tinted** as Claude's strongest picks; the next 3 are shown un-tinted (close-but-not-quite).

**No rest-of-pool displayed below.** The remaining 14 Quote Graphic candidates (or all-but-6 reels, etc.) exist in `Asset_Library` with `Availability = available` but do not render in the section. **Claude is the long-tail access path** — JT asks Claude for a different quote, Claude surfaces options from the hidden 14 as chips. *Chip routing that delivers this is deferred to a follow-up spoke; this spoke only renders the 6.*

`Availability = placed` rows are filtered out of the pool entirely — they don't appear in any section. The pool naturally shrinks as JT schedules through the week. By Friday, the pool may be smaller than 6; surface whatever's left.

### Right rail — companion unification

The right rail's Claude panel is **the only Claude chat surface in the entire Publish view.** Remove the reel-side chat panel; its function is absorbed.

When JT taps a card to expand it (any type — Reel, Quote Graphic, Thumbnail), `pbRailSetActiveSlot(slotId, assetType)` is called. The rail's Claude header updates to show what card is foregrounded (the docked-tab visual indicator from Operating Model §8 — for this spoke, a simple text label is fine; full visual treatment can be polish).

Below Claude: the Library | Generate toggle, conditionally rendered based on active card type (already wired from previous spoke; verify it works for Reel slots showing the "Backgrounds don't apply to Reels" empty state).

### Caption editing + state persistence

Caption box in expanded card is prefilled (from `Caption_Draft` or `Caption_Final`). Editable. Edits write to the Asset_Library row using the existing pattern (debounced save). Already-existing localStorage pattern for caption draft persistence per slot can be reused.

Canvas state autosaves per existing pattern (`pbSaveCanvasState`). On collapse and re-expand, prior canvas state restores.

---

## Phased Build

This spoke has four phases. Checkpoint between each — verify the previous phase works before starting the next.

### Phase 1 — Twirl-collapsible sections + card state shells

- Replace `v3RenderOptionCards()` with a new render function (e.g., `pbRenderDayStack(dayKey)`) that:
  - Reads which post types have slots for this day
  - Renders one section per post type, with section headers + twirl toggle
  - Inside each section, renders cards (use stub data — see "Stub Data" below)
  - Cards render in State 1 (collapsed thumbnail) only at this phase
- Twirl behavior: tap section header → toggle open/closed. Multiple sections can be open. Save twirl state in component state, not localStorage.
- Top 3 of the 6 surfaced cards per section get the ranked-tint class; next 3 get the plain class. **No rest-of-pool rendered below the 6** — the long tail is accessed via Claude (future spoke).

**Checkpoint 1:** Day taps reveal stacked sections; sections twirl correctly; cards render with appropriate tints; nothing schedules yet. Existing pb-day-card-row still works.

### Phase 2 — Card expand → State 2

- Tapping a collapsed card transitions it to State 2 (expanded).
- For Quote Graphic / Thumbnail: invoke existing canvas init (`pbInitCanvas` on the card's canvas element); show design tools toolbar; show prefilled caption box.
- For Reel: insert `<video>` element with `getReelStreamUrl()` source; show Reel_Summary; show prefilled caption box; show "Edit Reel" button (wired to existing edit-reel handler).
- Within a section, only one card can be in State 2 at a time. Expanding another collapses the current.
- On expand, call `pbRailSetActiveSlot(slotId, assetType)`. Verify the right-rail Claude header updates.
- On collapse, dispose the canvas via existing `pbDisposeCanvas()` (or equivalent for the reel video).

**Checkpoint 2:** Cards expand cleanly to canvas (image types) or player (reels). Right-rail Claude shows correct active-card label. No two cards expanded in same section at once.

### Phase 3 — Schedule → State 3 (and reversal)

- Schedule button in State 2 routes through existing `pbConfirmSchedule` / `pbScheduleSlot` / `pbAddToSlot` paths. No new server logic.
- On successful schedule, card transitions to State 3 (faded thumbnail). Canvas/player disposed.
- State 3 card shows status indicator + Unschedule + Edit affordances.
- Unschedule routes through existing `pbUnscheduleSlot`. Card returns to State 1.
- Edit routes the card to State 2 with prior canvas state restored.

**Checkpoint 3:** Full schedule → fade → unschedule loop works. No data layer changes. Server endpoints unchanged.

### Phase 4 — Retire dual chat surfaces

- Remove the reel-side chat panel markup (`pb-reel-chat` and related).
- Remove any reel-side chat JS handlers that duplicate right-rail Claude (e.g., `pbReelChat*` functions if they exist separately from rail send).
- Verify the right-rail Claude panel is the only chat surface in the Publish view across all slot types.
- The reel caption *editing* (caption box in the expanded card) is unchanged — that's not chat, that's direct text edit. Only the *chat* surface is removed.

**Checkpoint 4:** One Claude chat in Publish. Reel cards still expand cleanly. Caption box on reel cards still editable.

---

## Stub Data (Vert Fairy Pass 2 hasn't run yet)

The real ranked candidate pool requires `Quality_Score`, `Tags`, `Image_Prompt`, `Background_ID`, `Canvas_State` populated per Asset_Library row. Those columns are *added* but not yet *populated* — Vert Fairy Pass 2 enrichment is a separate spoke.

For this build:

- Write a `getRankedCandidates(episodeUid, assetType, slotWhy)` helper on the client side (no new server endpoint).
- For now, return a structured stub. **Stub pool sizes reflect the locked enrichment design** (already being done; not new):
  - **Quote Graphics:** 20 candidates per episode (10 hooks + 10 quotes). Mock Quality_Scores spread 3–5. Mock tags from the starter vocab (`discovery`, `reflective`, `narrative`, `vulnerable`, `witty`, `provocative`, `practical`, `evergreen`). Each paired with a stub `Background_ID` (one of 20).
  - **Reels:** Read from existing `getReelsForEpisode()`, assign mock Quality_Scores (e.g., first 3 = 5,5,4; rest distributed 3–4).
  - **Thumbnails:** Return 5 stub candidates with mock titles and Quality_Scores.
- Helper applies the ranking algorithm (`Quality_Score DESC`, tag-match tiebreaker against `slotWhy`) and **returns only the top 6** — not the full pool. The other 14 Quote Graphic candidates (or all-but-6 reels) stay in the source pool and will be accessible via Claude when chip routing ships.
- Helper must respect `Availability = available` — never return `placed` rows.
- Stub helper must have the **same return shape** that the real Vert Fairy enrichment will produce, so swapping to real data later is a one-line change.

Return shape per candidate (suggested):

```javascript
{
  asset_id: string,
  asset_type: string,        // "Reel" | "Quote_Graphic" | "Thumbnail"
  quality_score: number,     // 1-5, ties allowed
  tags: string[],            // controlled vocab
  thumb_url: string,
  preview_text: string,      // Reel_Summary for reels, quote for QG, title for thumbnails
  caption_draft: string,
  background_id: string | null,
  canvas_state: object | null,  // null for reels
  // ... whatever else fits
}
```

Mark the helper clearly with a `// STUB: replace with Vert Fairy Pass 2 output when enrichment ships` comment.

---

## Constraints

- **All preserved functions stay intact.** Names, parameters, return shapes, internal logic. Re-wire what calls them; don't rewrite them.
- **No new server endpoints.** Wire to existing GAS server functions.
- **No browser storage APIs.** Use in-memory JS state for twirl/expand state. Existing localStorage patterns for caption/notes can stay.
- **No external dependencies.** No new CDN imports.
- **Preserve all currently working surfaces.** Reels playback, scheduling, canvas tools, candidate selection — all must continue working through the new chassis.
- **Use existing brand tokens (CSS variables).** Don't introduce new color/font tokens. If the spec needs a token that doesn't exist, flag it and pause.
- **Phase checkpoints are real checkpoints.** Don't skip ahead to phase 4 if phase 2 isn't solid. If a phase reveals something Audra didn't anticipate, surface it before continuing.

---

## Open Questions to Flag (Not Resolve)

If you encounter any of these during build, flag them in your output — don't decide unilaterally:

- **Section twirl default state across days.** Should top section default-open per-day, or remember last twirl state across day-switches within a session? Spec says default-open top section; mid-session state TBD.
- **Faded card opacity value.** Audra said "faded version" — pick a reasonable default (e.g., `opacity: 0.55` or use a brand token if `--faded` or similar exists) and note it. Easy to tune later.
- **Card width within section.** Currently `pb-day-card-row` uses fixed widths. Cards-in-sections might want different sizing — full-width within section vs. side-by-side. Pick what looks cleanest given current spacing and note the choice.
- **Tag-match algorithm at render time.** Stub helper can mock this; real ranking with tag vocabulary is Vert Fairy's job. Just note the contract.
- **Schedule popover positioning** when card is expanded — should it anchor to the Schedule button in the expanded card, or to the day header? Existing popover code may need to relocate; surface this if it's non-trivial.

---

## Definition of Done

- Tapping a day shows the day's stacked post-type sections (Reels / Quote Graphics / Thumbnails, as applicable for that day)
- Each section twirl-collapses cleanly with header + count + arrow affordance
- Cards within sections render in State 1 (collapsed thumbnail). **6 cards per section, top 3 tinted, no rest-of-pool below.** Pool filtered to `Availability = available`.
- Tapping a card expands it to State 2 (canvas+tools for image types; player+caption for reels)
- Within a section, only one card in State 2 at a time
- `pbRailSetActiveSlot()` fires on expand; right-rail Claude header updates
- Schedule button on State 2 transitions the card to State 3 (faded thumbnail with Unschedule/Edit)
- Unschedule reverses State 3 → State 1; Edit reverses State 3 → State 2 with restored state
- Reel-side chat panel removed; right-rail Claude is the only chat surface in Publish
- All preserved functions intact (verify via grep against the audit's function list)
- Existing scheduling, canvas, reel playback paths continue to work end-to-end
- Stub `getRankedCandidates()` helper exists with clear comment marking the swap point for Vert Fairy data

---

## Clasp Push Checkpoint

After all four phases land and are tested:

```bash
clasp push
```

Test on the GAS `/dev` URL (staging). Do not push to production. Confirm visually with Audra before any production deploy.

---

## After This Spoke

The following are explicit follow-ups, in rough priority order. Do not start any of them in this session:

1. **Left rail icon state machine** — dots → 🎧🖼🎬, add red state for Audra's court
2. **Slot context injection into Claude API packet** — what shape, what fields, sibling cap
3. **Chip routing actions** — quote → canvas, image-prompt → Generate auto-toggle, caption → caption box
4. **Card attachment as docked tab visual** — currently a text label; promote to full tab-shape per spine
5. **Loose task onclick wiring**
6. **`st-header` white bar removal + Studio overlay shell decision**
7. **Vert Fairy Pass 2 enrichment** — populates real Quality_Score/Tags/Image_Prompt/Canvas_State per AL row (replaces stub)
8. **`Asset_Library.chat_history` column 19** — schema delta + persistence wiring

---

*Spoke prompt — v3 Center Canvas rebuild. Self-contained for Claude Code execution. Phased build with four checkpoints. Preservation Mandate scoped per "engine stays, chassis changes."*
