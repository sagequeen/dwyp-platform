# Spoke: v3 Wiring — Real Data Connections + Slot Context Injection

**Mode:** Build. Substantial spoke. Phased internally — checkpoint between phases.

**Goal:** Wire the v3 center pane cosmetic shell to real GAS data and connect the active-card → right-rail Claude context handoff. Replaces the stub `getRankedCandidates()` with live Asset_Library reads, wires image and reel card expand to real canvas/player, completes end-to-end scheduling, and feeds slot foreground context into the Claude API packet.

---

## Status

Cosmetic pass landed (item 91 in Platform State v5.9). All UI shells in place — twirl sections, card states, accordion enforcement, right-rail companion. Stub data drives everything. This spoke replaces the stubs with real connections.

**Phase progress:**
- **Phase 1** ✅ Confirmed live — `getRankedCandidates()` reads live Asset_Library data. All new server functions written and pushed.
- **Phase 2** ✅ Substantially complete — image card expand → canvas hydration wired. Checkpoint 2 (Audra formal confirm) pending.
- **Phase 3** ← Next
- **Phase 4** ← Last

**Schema additions (Audra, complete before this spoke runs):**
- `Asset_Library` col 19: `Quality_Score` (int 1–5)
- `Asset_Library` col 20: `Slot_Tags` (comma-separated Posting_Schedule Slot_IDs — `ASSET_TAG_VOCABULARY` retired; not a Governance key)

Both empty for existing rows. Midnight pass spoke (separate, future) populates them. This spoke reads them only; never writes.

**Confirmed deferred (do not build):**
- GCS migration — Drive `uc?id=` path stays
- Sentinel Fairy / Trim deep-link / Processing overlay — Trim button gets disabled state + tooltip
- Chip routing actions — separate spoke after real slot context flows
- Midnight pass (Stage 2 Claude editorial + Stage 3 GAS pairing) — separate spoke
- Left rail icon state machine
- `Asset_Library.chat_history` column

---

## Read First

Before writing anything:

1. **`DWYP_Operating_Model.md` v1.1** — the spine. §7 (Rail Contract), §8 (Companion Model — *especially building/room framing*), §9 (Slot Model), §10 (Cardinal Rules — "engine stays, chassis changes").
2. **`DWYP_Platform_State.md` v5.8** — current build state. Item 91 captures what the cosmetic pass landed.
3. **`SPOKE_v3_Center_Canvas.md`** — what the cosmetic pass delivered. Preserved function list at top of that doc is authoritative.
4. **`SPOKE_Publish_Right_Rail.md`** — right rail shell, including the Library | Generate auto-toggle pattern (chip dispatcher seed).
5. **Live Asset_Library** — current rows are Gemini-written. `Quality_Score` and `Slot_Tags` empty for now. Wiring reads what's there.

If you don't have one of these, stop and ask.

---

## Mandate Scope

**Engine stays, chassis changes** applies fully.

**Preserved (do not rename, refactor, or alter internal logic):**

All functions in SPOKE_v3_Center_Canvas.md "Preserved" list, plus the cosmetic-pass additions:
- Card state transition handlers
- Twirl section toggles
- `pbRailSetActiveSlot()` cosmetic stub — this spoke extends behavior; signature stays the same

**Wiring (chassis change — fair game):**
- Stub `getRankedCandidates()` body → live data read
- Image card State 1 → State 2 expand handler → real canvas init + state hydration
- Reel card State 1 → State 2 expand handler → real player wiring
- Schedule button handler → end-to-end scheduling + State 3 transition
- Right-rail Claude call path → slot context injection

**Adding (new):**
- Server-side helper for ranked Asset_Library reads per episode + asset_type
- Server-side helper for slot foreground context assembly
- Frontend `activeSlotId` / `activeAssetType` tracking, threaded into right-rail Claude calls

**Deferred (do not build in this spoke):**
- Chip routing actions
- Trim button real wiring (disabled state + tooltip only)
- Real async processing overlay
- GCS swap in `getReelStreamUrl()`
- Midnight pass
- Sibling cap UX (OQ-D)
- Conversation history turn cap (OQ-E)

---

## The Wiring

### Connection 1: `getRankedCandidates()` → live data

Replace the stub's hardcoded bundles with reads from existing GAS functions + Asset_Library.

**Behavior:**
- `Reel`: call existing `getReelsForEpisode(episodeUid)`. Map result to candidate return shape.
- `Quote_Graphic` / `Thumbnail`: read Asset_Library rows where:
  - `Episode_UID = episodeUid`
  - `Asset_Type = assetType`
  - `Availability = 'available'`
- Sort: `Quality_Score` DESC, then `Created_At` ASC (stable secondary). Empty `Quality_Score` treated as 0.
- Return top 6.

**New server function:** `getRankedAssetLibraryCandidates(episodeUid, assetType, slotId)` in `dwyp_app.js`. Server-side ranking — frontend never sees the full pool. Ranking: (1) tag-match primary — rows where `slotId` appears in `Slot_Tags` rank first; (2) Quality_Score DESC; (3) Created_At ASC (stable). Mark with comment: *`Slot_Tags` empty until midnight pass runs; tag-match tiebreaker will activate automatically once populated*. ✅ Written and live (Phase 1).

**Same return shape as cosmetic-pass stub.** Verify field-for-field before swapping in.

**Tag-match tiebreaker:** explicitly skipped this spoke. Existing rows have empty `Slot_Tags`. Defer.

---

### Connection 2: Image card expand → canvas init + state restore

When a `Quote_Graphic` or `Thumbnail` card transitions to State 2:

1. Call existing `pbInitCanvas` on the card's canvas element.
2. If AL row has non-empty `Canvas_State`: deserialize JSON, load via existing Fabric.js pattern (`canvas.loadFromJSON()` or whatever the existing path uses).
3. Else: build fresh:
   - Resolve precomp background by `_candidateIndex % bgPool.length` (PRECOMP_BACKGROUND_LIBRARY_ID governance key; pool fetched via `getPrecompBgImages()`; filename convention: `bg_NNN_darktext` / `bg_NNN_lighttext` encoding text color)
   - Set `pb._defaultTextColor` from bg textColor signal (#1a1714 dark / #ffffff light)
   - Add text overlay from `Quote_Text` using `pbAddTextToCanvas()` (preserved — replaces existing text object if one exists)
   - Lock undo floor to hydrated state (prevents undo back to blank)
4. Caption box prefills from `Caption_Draft` **if no localStorage caption exists for this slot**. `Caption_Final` column preserved under Preservation Mandate — existing reads/writes untouched; no new code reads it for prefill.

**Empty-state row** (both `Canvas_State` and `Background_ID` empty — pre-midnight-pass rows for episodes not yet processed): card opens with blank canvas + just text. JT places background manually from the Library panel. Don't gate Schedule on canvas content — that's policy, not wiring.

---

### Connection 3: Reel card expand → player

When a `Reel` card transitions to State 2:

1. Read `Drive_File_ID` from AL row (or reel object from `getReelsForEpisode()`).
2. Call existing `getReelStreamUrl(fileId)` (Drive `uc?id=` path; idempotent `setSharing()` server-side).
3. Cache returned URL on in-memory reel object as `_streamUrl` (existing pattern; subsequent expands hit cache).
4. Render native `<video src="...">` element in player container at existing 240×427 dimensions.
5. Show:
   - `Reel_Summary` (raw Gemini text — midnight pass will clean later)
   - Caption box prefilled from `Caption_Final` / `Caption_Draft`
   - **Edit Reel button: `disabled` attribute + tooltip "Trim coming soon"**. Do not wire to the existing edit-reel handler. Handler stays in code under Preservation Mandate; UI affordance is disabled only.

---

### Connection 4: Schedule button end-to-end

When JT taps Schedule on an expanded card (State 2):

1. Open schedule popover via existing `pbOpenSchedPopover()`.
2. Slot selection via existing `pbSchedSelectSlot()`.
3. On confirm via existing `pbConfirmSchedule()`:
   - `Reel`: existing `scheduleReel()` server call
   - `Quote_Graphic` / `Thumbnail`: existing `pbAddToSlot()` → `placeAssetInSlot()` server call
4. Server success → frontend transitions card to State 3 (faded thumbnail + Unschedule/Edit affordances).
5. Unschedule from State 3 → existing `pbUnscheduleSlot()` → revert to State 1.
6. Edit from State 3 → re-expand to State 2 with prior `Canvas_State` restored.

All existing popover positioning preserved. This spoke wires *transitions* into State 3 visual treatment; the scheduling pipeline is intact.

---

### Connection 5: `pbRailSetActiveSlot()` → Claude packet slot context injection

Right-rail Claude needs slot foreground context per Operating Model §8. **Building stays pinned across the episode tab; room refreshes on slot change.**

**Frontend:**
- Track `activeSlotId` and `activeAssetType` in JS state. Set on `pbRailSetActiveSlot()` fire.
- Every right-rail Claude `send` includes both in the request payload to GAS.

**Server-side** (in whichever file the publish Claude call lives — verify before patching, likely `fairy_circle.js` or `dwyp_app.js`):

New helper: `assembleSlotForegroundContext(activeSlotId, activeAssetType, episodeUid)`. Returns:

```javascript
{
  active_card: {
    asset_id, asset_type, quote_text, reel_summary,
    caption_draft, caption_final, background_id,
    quality_score, slot_tags
  },
  same_date_siblings: [up to 4 AL rows for cards on the same day, same episode,
                       sorted by quality_score DESC, ties broken by asset_id ASC],
  episode: { episode_uid, guest_name, release_date }
}
```

**Injection point:** the existing publish Claude packet assembler. Inject as a structured block after the static prefix (brand voice, playbook, system prompt) and before user input. Format as labeled fields or readable JSON — Claude consumes; humans don't read this.

**Building context (persistent — episode index, brand voice, playbook):** stays as it already is. Not this spoke's concern.

**Sibling cap = 4, hardcoded.** OQ-D is the deferred UX question; hard cap is the implementation default. Comment marks where a Governance key replaces the literal when OQ-D resolves.

---

## Phased Build

Four phases. Checkpoint after each. Do not skip ahead.

### Phase 1 — `getRankedCandidates()` live data

- New server function: `getRankedAssetLibraryCandidates(episodeUid, assetType)`.
- Replace stub helper body in frontend; call server function.
- Verify Reels still render via existing `getReelsForEpisode()` path.
- Verify Quote_Graphics and Thumbnails render from live data.
- Verify empty `Quality_Score` rows sort cleanly (no NaN, no crashes).

**Checkpoint 1:** Day stack renders real cards. Cosmetic pass behavior unchanged. Confirm with Audra. ✅ Confirmed.

---

### Phase 2 — Image card expand wiring

- Hook `pbInitCanvas` into image card State 1 → State 2 transition.
- Wire `Canvas_State` hydration with fallback to fresh build from `Quote_Text` + `Background_ID`.
- Verify caption box prefills correctly.
- Verify canvas tools (text, background, undo/redo, center, logo) work end-to-end on real data.

**Checkpoint 2:** Tapping a Quote_Graphic or Thumbnail card opens a real canvas with row content. Confirm with Audra. ⏳ Pending — code complete, Audra confirm outstanding.

---

### Phase 3 — Reel card expand + Schedule end-to-end

- Wire reel expand to `getReelStreamUrl()` + native `<video>`.
- Disable Edit Reel button with tooltip.
- Wire Schedule button → existing scheduling pipeline → State 3 transition.
- Verify Unschedule reverses to State 1 and Edit re-expands to State 2 with state restored.

**Checkpoint 3:** Reels play. Scheduling completes end-to-end. State 3 visuals correct. Unschedule + Edit reversible. Confirm with Audra.

---

### Phase 4 — Slot context injection

- Frontend: `activeSlotId` / `activeAssetType` tracking; threaded into right-rail Claude payload.
- Server: `assembleSlotForegroundContext()` helper.
- Inject into existing publish Claude packet at the appropriate point.
- Manual verification: ask Claude in the rail about the active card; confirm reply references real card content.

**Checkpoint 4:** Claude in the rail demonstrably knows what card is foregrounded. Confirm with Audra.

---

## Constraints

- All preserved functions stay intact. Names, parameters, return shapes, internal logic.
- No new server endpoints beyond the two named helpers (`getRankedAssetLibraryCandidates`, `assembleSlotForegroundContext`).
- No browser storage APIs. In-memory JS state for `activeSlotId`. Existing localStorage patterns (caption/notes per slot) untouched.
- No external dependencies. No new CDN imports.
- No new color/font tokens. Use existing brand tokens.
- No schema changes in this spoke. Cols 19–20 added by Audra manually; code references in read paths only — never writes.
- No writes to `Quality_Score` or `Slot_Tags`. Read-only. Midnight pass owns those writes.
- All currently working surfaces preserved. Cosmetic-pass behavior unchanged outside actively wired surfaces.
- Phase checkpoints are real. Phase N+1 does not start until Phase N is verified.

---

## Open Questions to Flag (Not Resolve)

Flag if encountered — don't decide:

- **Existing publish Claude call structure.** If `generateWithClaude()` or the equivalent has a different packet shape than expected, surface the actual structure and propose the injection point before patching.
- **Sibling cap behavior when 0 same-date siblings.** Likely empty array — confirm graceful handling in context assembly.
- **Empty `Quality_Score` sort behavior.** If existing data mixes empty / populated, confirm sort is stable (no NaN bubbling, no crashes).
- **Trim button disabled visual.** Existing button class + `disabled` + tooltip — or a specific brand pattern? Pick the simpler if no pattern exists; flag for Audra.
- **Where the publish Claude call lives.** State doc says `fairy_circle.js` for shared utilities; `dwyp_app.js` for endpoints. Verify the actual file before patching.

---

## Definition of Done

- Live Asset_Library data drives the day-stack render. Stub bundles removed.
- Image card expand opens a real canvas with row content (text + background, or restored `Canvas_State`).
- Reel card expand plays the file via native `<video>` + `getReelStreamUrl()`.
- Edit Reel button disabled with tooltip "Trim coming soon".
- Schedule button completes end-to-end. State 3 renders. Unschedule reverses. Edit re-expands with state restored.
- `pbRailSetActiveSlot()` updates `activeSlotId` / `activeAssetType` and threads into right-rail Claude requests.
- Claude responses in the rail reference active card content (verifiable by asking).
- All preserved functions intact (verify via grep against SPOKE_v3_Center_Canvas.md function list).
- No new browser storage. No new external deps. No new server endpoints beyond the two named.
- Cosmetic pass UI behavior unchanged outside wired surfaces.

---

## After This Spoke

Explicit follow-ups, rough priority:

1. **Chip routing actions** — quote → canvas, image-prompt → Generate, caption → caption box, scheduling commentary → schedule popover. Real chips arrive once Phase 4 is live.
2. **Midnight pass spoke** — Stage 2 Claude editorial pass + Stage 3 GAS pairing. Fills `Quality_Score`, `Slot_Tags`, cleaned reel summaries, `Background_ID`, `Caption_Draft`.
3. **Left rail icon state machine** — dots → 🎧🖼🎬, gold/red role-filtered states.
4. **Sentinel Fairy + Trim deep-link + Processing overlay** — JT-account-bound script + real async path. Re-enables Edit Reel.
5. **GCS migration** — replace Drive `uc?id=` in `getReelStreamUrl()` with GCS public URL. Make scenario design + bucket structure decisions.
6. **`Asset_Library.chat_history` column** — append at col 21 + persistence wiring.

---

## Clasp Push Checkpoint

After each phase, push and verify:

```bash
clasp push
```

Production deployment (Manage Deployments → pencil → New version → Deploy) is Audra's manual step — timing is her call (per-phase or batched). Confirm with Audra at each checkpoint before proceeding to the next phase.

---

*Spoke prompt — v3 Wiring. Self-contained for Claude Code execution. Five connections across four phased checkpoints. Preservation Mandate scoped per "engine stays, chassis changes."*
