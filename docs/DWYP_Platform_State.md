# DWYP Operations Platform — Platform State
**Version: 7.0 | May 2026**

**Companion documents:** see `CLAUDE.md` for canonical doc inventory.

> Changelogs v6.1–v6.5 stripped. See git history for session-by-session detail.

---
## Current Position

- **Active episode:** Dr. Meenakshi Aggarwal (EP-260504-0736) — pipeline open. Show notes pass re-run (2026-05-22) reads transcript directly. Carrie Sipe (EP-260428-1928) released 2026-05-19.
- **Pipeline:** Tracks A/B/C all shipped. Bridge v2 (May 2026) shipped: compositional prompt assembly, v2.3 HOOK/QUOTE parsing (Slot_Tags + Quality_Score writes), Slide_Index write retired, `_appendCaptionSignoff_` helper (`CAPTION_SIGNOFF` key populated — programmatic sign-off live), Reel Editorial pass (`runReelEditorialPass`). Verified on Derek Peterson (EP-260430-1427).
- **Locked hub decision (2026-05-22): Transcript is the single source of truth for all copy passes.** Track A (Index) and Track B (Show Notes) both read the raw transcript independently via `gatherVertContext`. Neither is downstream of the other. No Vertex/RAG retrieval in either pass. Transcript injected directly.
- **Track A (CP1+CP2 — 2026-05-22):** Truncation cap removed from `buildEpisodeIndexPrompt` (was `.substring(0, 15000)`). Verified on Meenakshi — full arc now spans to Seeds of Wisdom close. AI Search Index block appended after REEL DESCRIPTIONS via `extractPrompt("# AI Search Index")` + `extractPrompt("# Pillars")` + `extractPrompt("# Voice Prohibitions")`, fenced by boundary line (literal extraction / curatorial indexing). First test run returned no AI Search Index block — section confirmed in template; retry pending.
- **Track B (CP3 — 2026-05-22):** `runEditorialPass` repointed to transcript. No longer requires index v2 to exist first (dependency removed). `_buildEditorialPassPrompt_` now injects `FINISHED TRANSCRIPT:` instead of `EPISODE INDEX V2:`. Guest brief now sourced from `gatherVertContext` (duplicate Contact Library lookup removed). Verbatim-quote rule is now honest — Claude selects from real words on the page.
- **Reel Editorial — test pending.** `runReelEditorialPass` written and pushed. Needs an episode with Reel-type Asset_Library rows with `Reel_Summary` populated.
- **`syncReelAssets` + Gemini video analysis (2026-05-22):** `syncReelAssets(epUid, opts)` added to `dwyp_app.js` — creates AL rows for MP4s in Staging/Reels/, runs `callGeminiVideoAnalysis_` per reel (45MB limit; 4.5-min timeout guard; resumes on re-run). `test_syncReelAssets` wrapper in `dev_tools.js`. Tested on Meenakshi — worked (one 3-min clip skipped at size limit, expected).
- **Episode tab (Design) — live (2026-05-26).** Native `<video>` in `stEpView` fed by `getEpisodeStreamUrl` (V4-signed GCS GET URL, bucket `dwyp-review-playback`, path `episodes/{EUID}/proxy.mp4`, 8h expiry, signBlob via owner OAuth). Compose loop functional: focus-pause-freeze-timestamp, Send = optimistic rail append + `submitEpisodeCommentRow` + resume, Cancel = discard + resume. Request Revisions and Approve wired. Detection retired from Loop A (Drive folder-watch); producer marks `Upload_Produced_Episode` task complete → `completeUploadEpisode` flips `Video_Status → review` and spawns `Review_Episode`. Governance keys needed: `REVIEW_GCS_BUCKET`, `GCS_SIGNER_SA`, `GCS_EXPIRY_SECONDS`.
- **Reels sub-tab (Design) — live (2026-05-24, refined 2026-05-25).** Drive `/preview` playback in phone frame. Caption box reads `Caption_Host`; Generate writes caption from `Reel_Summary` via Claude (`generateReelCaption`). Two verbs: Export (moves reel → `Manual_Exports/`, filename = title slug; paired `.txt`), Request Revision (popup task form → `requestReelRevision` → `Revision_Notes`). Edit with Vids and day-picker removed. `closeReelRevision`: swaps `Drive_File_ID` on AL row by `Asset_ID`, moves old file → `Reels/Superseded/`, completes open `Revise_Reels` task, `bumpVersion` both domains, next Pulse re-spawns `Review_Reels`. **Drive chrome shown** — two-person internal app; crop hack retired. `getReelStreamUrl` returns `/preview` URL (was `uc?id=`). Reel cards: thumbnail left 1/3 (Drive thumbnail API `?sz=w200`), name + full summary right 2/3, no truncation. Modal z-index bug fixed (duplicate `z-index:200` was overriding `400`, hiding modal behind Studio Overlay at z-index 300). Reel revision modal centered with full corner radius.
- **Revision Flow spoke — live (2026-05-24).** Episode review compose loop: focus pauses video + freezes timestamp; Send = optimistic rail append + `submitEpisodeCommentRow` write + resume; Cancel = discard + resume; empty Send = no-op + resume. Rail receipts: round-grouped sealed cards (`Revision_Round` from Episode_Log). Request Revisions = hard-seal → `requestEpisodeRevisions` GAS call → composer locks → sealed notice appended to round card. `Revise_Episode` Complete button wired to `completeEpisodeRevisionTask` → validates Episode/ single-video invariant before completing. Reel revision: inline textarea replaced by popup task form; fix text → `Revision_Notes` via `requestReelRevision(epUid, assetId, notes)`. Episode_Log extended to 10 cols (`Revision_Round` col 10; header added manually). `spawnTask()` now reads `revisionNotes` from taskConfig (fixes blank-instruction bug on all revision tasks). Note: episode player source was Drive `uc?id=` (broken for large files) → repointed to GCS signed URL in the 2026-05-26 spoke.
- **Tasks schema — col 17 added: `Asset_ID`** (FK to Asset_Library for revision tasks). `TASKS_COLS.Asset_ID = 17` in `dwyp_app.js`; `spawnTask()` in `fairy_circle.js` writes it header-driven. **Manual step required:** add `Asset_ID` header in column 17 of Tasks tab in production Master Sheet.
- **Master Template — v3.0 live.** Paste + B6 #3 (ATTRIBUTION parser) + B6 #2 (extractPrompt consolidation) all shipped 2026-05-20. extractPrompt CR/LF fix applied (fairy_circle.js) — v3.0 paste introduced \r line endings; split now handles \r/\n/\r\n. Smoke test (test_extractPromptSmokeTest) confirmed all 5 new section keys return non-empty. `# AI Search Index` section added to template (2026-05-22).
- **v3.0 coupling — B6 #3: SHIPPED.** ATTRIBUTION-line parser live. QUOTE block format and _bridgeParseRankedItems_ / materializeQuoteGraphicAssets shipped together 2026-05-20.
- **v3.0 coupling — B6 #2: SHIPPED.** ${brandVoice} retired. extractPrompt consolidation live: Guest Brief pulls # Show Philosophy / # Pillars / # Peer Shows; Editorial pass pulls # Host Voice / # Voice Prohibitions / # Caption Mechanics / # Ranking Schema / # Show Notes.
- **Voice-injection keys retired.** BRAND_VOICE_ID, CAPTION_VOICE_SUPPLEMENT_ID, DELIVERABLES_VOICE_SPEC_ID blanked 2026-05-19; B6 #2 shipped 2026-05-20 completes the retirement. In-template section extraction via extractPrompt is the active path.
- **Spoke 0 — Caption Consolidation: complete.** `Caption_Host` (col 10) and `Caption_Guest` (col 11) schema live. 3-variant JSON format + `_parseCaptionDraft_` parser retired. Enrichment generators (`generateReelCaption`, `enrichQuoteAssetsFromTranscript`, `enrichReelsForEpisode`) and caption UI affordances (`pbRegenCaption`, `pbGenerateCaption`, Regenerate + Generate caption buttons) retired.
- **v3 Wiring:** Phase 2 shipped (dual-JSON canvas, Export button, viewport fix). Phase 3 (reel card expand) queued. Scheduling = separate Schedule surface, not yet built.
- **Design surface overhaul (May 2026).** Text scaling: corner drag normalizes scaleY→fontSize + scaleX→width, scale resets to 1; A+/A− buttons (2pt steps). Color picker: popover with brand row + complementary row (#235789 / #CBCBD4 / #638475 / #8D918B); `stApplyColor` clears per-character fill overrides. Overlay reset: circular arrow SVG replaces ✕, pushes history. Export PNG fix: `multiplier:2` removed (was producing blank canvas at 4K); `discardActiveObject` before capture. Export txt: caption field passed as second argument. Delete key guard: `isContentEditable` check prevents caption-field edits from removing canvas objects.
- **Publish tab retired (May 2026).** ~7,000 lines of `pb*` code removed: all CSS, stPublishPanel HTML, var pb state, ~120 `pb*` functions. Design is the sole landing route: `openStudio()` defaults to `'design'`; `stSwitchTab()` Publish branch gone; `stStudioMain` always visible; `showEpisodeReview()` → `openStudio('design')`. `pbAutoSelectEpisode()` retired; data-load auto-select wired to `stSelectGuest()` directly. 6 reusable feature patterns preserved in `docs/DWYP_Publish_Feature_Patterns.md`.
- **Asset surfacing — rankings retired.** JT curates by hand. No `Quality_Score` sort, no auto-surfaced ranked candidates, no slot auto-pairing. Vestigial ranking artifacts remain in code and are harmless — defensive parsing tolerates them. Removal is a future cleanup spoke that touches the Master Template (CIM-protected). **Do not delete the columns ahead of the code change — writes are by index.** Vestigial artifacts: `Quality_Score` (Asset_Library col 19) + `Slot_Tags` (col 20), still written by `materializeQuoteGraphicAssets` and `runReelEditorialPass`; `getRankedAssetLibraryCandidates` / `getRankedCandidates` read paths; `Slide_Index` pairing; `SIBLING_CAP` / `assembleSlotForegroundContext`; Master Template `SLOT_TAGS:` / `QUALITY_SCORE:` emit lines.
- **Design and Schedule are separate surfaces.**
  - **Design** — compose. Pick hook/quote (images) or reel; author/edit caption; place on canvas; pick background.
  - **Schedule** *(not built)* — Saved candidates surface here; JT drag-drops into day slots.
  - **Terminal actions:** **Export** *(live)* renders PNG + `.txt` companion via `exportAssetToDrive` / `exportReelToDrive` — the working path today. **Save → candidate** *(future)* stages an asset for the Schedule surface.
  - **Companion scope:** with Schedule separate, the per-asset companion needs only the asset-in-focus — no slot-stack siblings to thread.
- **Performance Foundation:** Phase 1.1–1.5 complete and live in production.
- **Staging retired as workflow.** Code pushes directly to production. Routing helpers preserved in codebase.
- **Index Audit step — designed, parked.** Inserts between Track A and Track B. Claude builds index from injected transcript → Gemini audits index against Vertex-retrieved corpus chunks (filtered to epUid) → appends `## Audit Findings` section to index doc with severity + location anchor + citation + suggested correction → spawns `Review_Index_Audit` task → HITL gate → next pulse: Claude produces clean revised index, re-reads transcript only if any finding marked CRITICAL → Tracks B/C run against revised index. Architecture role split: Claude generates (synthesis, nuance), Gemini audits (literal, source-checking), Vertex retrieves (corpus-grounded independence from Claude's injected source). Design doc: `DWYP_Index_Audit_Design.md`. **Parked:** corpus confirmed name-keyed, not epUid-keyed (verified 2026-05-19); retrieval workaround: "[guest name]'s episode" queries yield good results; episode-scoped indexing requires corpus re-tag/re-import before audit spoke opens. **Lift shift (May 2026):** `_vertexMarkerQuery_` (the Vertex retrieval helper the audit design planned to reuse) was deleted in the pipeline rewire spoke. Audit spoke must write a new epUid-filtered Vertex retrieval function — not a reuse. Function recoverable from git.
- **Track A "extract-not-interpret" posture — code-level implementation shipped (May 2026).** `buildEpisodeIndexPrompt` enforces: speakers' interpretations belong in the index; auditor interpretations do not; no attribution of intent, motivation, or causation beyond speaker's own words. Synthesis happens downstream in B/C. Sections: EPISODE SUMMARY / GUEST PROFILE / KEY THEMES / CAPTION SEEDS / TRANSCRIPT MAP / REEL DESCRIPTIONS.
- **Track A/B/C Pipeline Rewire — complete (May 2026).** `buildEpisodeIndexV2` now Claude-based: reads injected raw transcript directly, no Vertex RAG. `runVertFairy` retired. Loop D rewired to two-condition logic: `episode_index_v2` absent → Track A (`buildEpisodeIndexV2`); `episode_index_v2` set + `show_notes` absent → Track B (`runEditorialPass`). At most one pipeline step per pulse run. `runVertFairyForEpisode` in `dwyp_app.gs` repointed to `buildEpisodeIndexV2` (Fairy Remote Control button remains live).
- **Design Surface fixes (May 2026):** Right rail — `#stBgPane` CSS override (`flex-direction:column; padding:0; overflow:hidden`) so Upload/Generate stack at top and bg pool scrolls below. Attribution canvas — `stDropText` rewritten to place quote and attribution as two independent Fabric.js `Textbox` objects (`_textType:'quote'` at `ch/2 - 40`, `originY:'bottom'`; `_textType:'attribution'` at `ch/2 + 40`, `originY:'top'`). Attribution box removed if `isHook` or no `st.guestName`.
- **dev_tools.js cleanup (May 2026):** `ACTIVE_EP_UID` constant at top — single paste point for all test wrappers. Vestigial functions removed: Phase 1.2–1.3 full test suite (8 functions), all `setup_*` / `migrate_*` one-time functions, diagnostic + smoke tests, `test_runReelEditorialPass_force` (merged into parameterized `test_runReelEditorialPass(force)`). Track A comment corrected to reflect Claude intent.
- **Parked for hub:** Stub → real card swap on first paint (skeleton-first, closes orphaned-Card-1 race); AL row as single source of truth across surfaces (audit-first spoke before patch); Gemini-as-fallback for all Claude writing paths (generalize existing `STUDIO_LLM_MODE = claude` fallback pattern into `callClaudeAPI()` so every writer — Tracks A/B/C, audit revision, reel editorial, captions, chat — falls back to Gemini on Claude API failure, logged to Audit_Trail; single point of fallback logic; open design question); consolidate/retire stale Brand Identity Drive files after v3.0 lands — fix `DWYP_BrandVoice_v1.md` cross-ref in Operating Model §12 (and retire Caption Supplement reference) once v3.0 supplies in-template `# Forbidden Phrases` / `# Substitutions`.

**Retired surfaces:** Frame.io, Safety Fairy, Marcom Fairy, Scribe Fairy, Social Vert, Image Workshop, Quick Caption (standalone), Librarian Vert/Social Vert personas, Publish tab.

### App
- **Web app URL (production):** https://script.google.com/macros/s/AKfycbzCed5Fmv9TNDf6ivQUcmhgUWWOyEVK4P3sxS8_KMQx7YOY6JeY7r-dh8jEw5DpecrI/exec
- **JT's URL:** Same URL + `?who=jt`
- **Staging URL (`/dev`):** https://script.google.com/a/macros/wiseonewithin.com/s/AKfycbwHRxyQ22Zi0TFwT3av5jf30MiPhxBtV9tjb4hMxm0/dev
- **Deployment model:** Execute as Me (Audra). USER_ACCESSING rejected — locked, do not revisit.
- **Identity:** PIN-based. PIN screen appears once on first load; identity persists until sign-out.

### Master Sheet
- **Production URL:** https://docs.google.com/spreadsheets/d/1p5ahHe4hgG6sHN4u13UyvEJWg5IwCkAfADjeqxwlTnw/edit
- **Staging Sheet ID:** `13bXMjxEf_L-BFH69OtUGOU6ywxt6BTat1kO9ik46Swk`
- **Tabs:** Contacts, Tasks, Episodes, Episode_Log, Governance_Config, User_Registry, Audit_Trail, Social_Assets, Launch_Checklist, Reference, Asset_Library

---

## Staging Environment — Locked Architecture

The platform runs on a two-deployment model. One script project, two master sheets, deployment-aware routing.

**Operational change (May 2026 hub):** Staging-first cadence retired. Code pushes directly to production going forward. Staging sheet (`13bXMjxEf…`) remains available but is no longer maintained in sync. Routing helpers and architecture remain in place under the Code Integrity Mandate (see `CLAUDE.md`).

### Deployments

| | URL | Sheet |
|---|---|---|
| **Staging** (`/dev`) | `/a/macros/wiseonewithin.com/s/.../dev` | `13bXMjxEf_L-BFH69OtUGOU6ywxt6BTat1kO9ik46Swk` |
| **Production** (`/exec`) | `/macros/s/.../exec` | `1p5ahHe4hgG6sHN4u13UyvEJWg5IwCkAfADjeqxwlTnw` |

Staging always serves the latest pushed code. Production serves only the version explicitly deployed via Manage Deployments → pencil → New version.

### Routing Helpers (in `fairy_circle.js`)

- `isStaging()` — compares `ScriptApp.getService().getUrl()` to `STAGING_DEPLOYMENT_URL` in Governance_Config. Exact-string match. Fails closed to production on any error.
- `getMasterSheetId()` — returns `STAGING_SHEET_ID` from Governance_Config when `isStaging()` is true; returns `MASTER_SHEET_ID` from Script Properties otherwise. Fails closed to production if `STAGING_SHEET_ID` is missing.

**Bootstrap exception:** `getGovernance()` reads `MASTER_SHEET_ID` directly from Script Properties. Routing it through `getMasterSheetId()` would create infinite recursion. The routing table lives in production Governance_Config; staging reads bootstrap from production.

### Rules for All New Code

1. All sheet access goes through `getMasterSheetId()`. Audit complete — all existing call sites use the wrapper.
2. No hardcoded URLs or sheet IDs. Staging values in `STAGING_DEPLOYMENT_URL` and `STAGING_SHEET_ID`.
3. Code Integrity Mandate applies — never thin or rename `isStaging()`, `getMasterSheetId()`, or any function calling them.

### Caveats — What Routing Does NOT Cover

- **Drive folders are shared.** `IMAGE_BACKGROUND_LIBRARY_ID`, `CORPUS_DRIVE_FOLDER_ID`, episode folders — all production unless explicitly remapped on staging.
- **External APIs are shared.** Claude API key, Vertex RAG corpus, Gemini — same endpoints, real money on test runs.
- **Triggers always run as production.** `ScriptApp.getService().getUrl()` is null in trigger context, so `isStaging()` returns false. Trigger code paths cannot be tested via staging URL — use `dev_tools.gs` manual invocation.

### Pre-Flight Verification

`DWYP_PreFlight_Staging_Verification.md` provides a Claude Code prompt (verification mode) that checks discriminator function, wrapper presence, orphan call sites, governance key population, and schema parity. Run before any spoke that writes to sheets or modifies schema.

---

## Foundation Documents

See `CLAUDE.md` for canonical doc inventory and reading order.
---

## GAS File Status

| File | Status | Notes |
|---|---|---|
| `fairy_circle.gs` | ✅ Pushed | **Loop 1 rewritten:** D-1 detection, date-aware task titles, spawns two tasks (HOST + PRODUCER). All other loops unchanged. **Null guard:** `callGeminiAPINoSearch` only sets `payload.systemInstruction` when non-null. **Spoke 3:** `callClaudeAPI(prompt, systemInstruction, callerName, history, options)` added — Anthropic Messages API. `callGeminiImageConversational(prompt, imageHistory, sourceImageBase64, sourceMimeType)` added. `callGeminiImageAPI()` removed. **Staging routing:** `isStaging()` and `getMasterSheetId()` helpers locked architectural pattern. **Phase 1.2–1.3:** `bumpVersion()` with LockService + audit_trail recursion guard. 8 write paths retrofitted. `spawnTask()`/`updateTaskStatus()` get `suppressBump` param. `dailyPulse()` bumps tasks + episodes once per run at end. Staged + verified. **Reels Surface spoke (2026-05-24):** `spawnTask()` — `Asset_ID` field added to `fields` object; written header-driven to Tasks col 17. **Revision Flow spoke (2026-05-24):** `appendEpisodeLog` writes 10-element row (`Revision_Round` as element 10). `spawnTask()` reads `revisionNotes` from taskConfig — fixes blank-instruction bug on all revision tasks. |
| `secretary_fairy.gs` | ✅ Pushed | Recording Reminder spawn removed. Calendar scan switched to `Calendar.Events.list()` Advanced Service. `wrapCalendarApiEvent()` adapter. `Utilities.sleep(3000)` between events. **Phase 1.3:** `updateLastActivity()` + `createContactStub()` bump contacts. Staged + verified. |
| `vert_fairy.gs` | ✅ Pushed | **Spoke 4 + 5:** Major rewrite. Two-pass pipeline. `MODEL_NAME` removed; `CLAUDE_MODEL`, `CLAUDE_API_KEY`, `EPISODE_SEARCH_INDEX_KEY` added. Pure Vertex RAG retrieval; Claude generation via `callClaudeAPI()`. Hook cleaning moved from Gemini to Claude. Pass 2 episode index doc creation. **Track B (May 2026):** `runEditorialPass` + `_buildEditorialPassSystemInstruction_` + `_buildEditorialPassPrompt_`. **Track C (May 2026):** `_bridgeSliceSection_` + `_bridgeParseLabeledCaptions_` + `materializeQuoteGraphicAssets`. Bridge agent writes 16 Asset_Library rows (10 hooks + 6 guest quotes). **Bridge v2 (May 2026):** `runEditorialPass` prompt now compositional — three `extractPrompt` calls (`# Voice Prohibitions`, `# Ranking Schema`, `# Show Notes`). `_bridgeSliceSection_` — em/en/horizontal bar dash normalization (never again fails on Unicode dash variants). `_bridgeParseLabeledCaptions_` — inline caption text fix (captures text on label line, not only body). `_bridgeParseRankedItems_` — new helper, parses v2.3 `HOOK N:` / `QUOTE N:` blocks with inline `SLOT_TAGS:` + `QUALITY_SCORE:` lines; defensive: unrecognized tags → Any, missing score → 3, out-of-range clamped, all anomalies logged. `_appendCaptionSignoff_` — new helper, reads `CAPTION_SIGNOFF` governance key, idempotent (no double-append), applied to all `Caption_Draft` writes in `materializeQuoteGraphicAssets`. `materializeQuoteGraphicAssets` write path: `Slot_Tags` + `Quality_Score` populated from parsed items; `Slide_Index` write retired (commented with dated note). **Reel Editorial (May 2026):** `runReelEditorialPass(epUid, {force=false})` — composes same three template sections, batches all reels in one Claude call, writes cleaned `Reel_Summary` + `Slot_Tags` + `Quality_Score` back per row; idempotent (skips already-scored unless `force:true`). `_parseReelEditorialOutput_` — same defensive parsing as bridge. Test pending (needs episode with Reel-type AL rows with `Reel_Summary` populated). **Pipeline Rewire (May 2026):** `runVertFairy` + all show-notes pipeline functions retired (deleted): `queryVertexShowNotes`, `generateShowNotesWithClaude`, `cleanHooksWithClaude`, `buildShowNotesSystemInstruction`, `buildShowNotesPrompt`, `generateEpisodeIndex`, `createEpisodeIndexDoc`, `createShowNotesDoc`, `writeShowNotesDoc`. Vertex helpers deleted: `_vertexMarkerQuery_`, `_parseTimestamp_`, `_parseTimestampSecs_`, `_parseSpeaker_`, `_extractFirstSentence_`, `_estimateTokens_`, `retrieveVertexRAGContext`. `EPISODE_INDEX_V2_MARKERS` constant deleted. `testRunVertFairy` test wrapper deleted. `buildEpisodeIndexV2` rewritten: Claude reads injected raw transcript via `gatherVertContext`, calls `callClaudeAPI`, writes `.md` file to `EPISODE_SEARCH_INDEX_KEY` folder, patches `manifest.episode_index_v2`. `buildEpisodeIndexPrompt` rewritten: knowledge-only (no HOOKS/QUOTES/IMAGE PROMPTS), extract-not-interpret posture, six sections. `gatherVertContext` and `findTranscriptInFolder` kept (used by new `buildEpisodeIndexV2`). **Transcript-as-source rewire (2026-05-22):** `buildEpisodeIndexPrompt` — truncation cap (`.substring(0, 15000)`) removed; full transcript now reaches Claude. AI Search Index block appended after REEL DESCRIPTIONS: `extractPrompt("# AI Search Index")` + `extractPrompt("# Pillars")` + `extractPrompt("# Voice Prohibitions")` composed + fenced by boundary line (literal extraction / curatorial indexing); silently omitted if sections missing. `gatherVertContext` — third fallback added: Raw Production folder via `manifest.raw_folder_id` (lookup order: Episode/ → Staging root → Raw Production). `runEditorialPass` — index v2 dependency removed (Track B now independent of Track A); transcript + guest brief loaded via `gatherVertContext`; duplicate Contact Library guest brief lookup removed. `_buildEditorialPassPrompt_` — `episodeIndexV2Text` → `transcriptText`; label `EPISODE INDEX V2:` → `FINISHED TRANSCRIPT:`; "reading a curated index" framing → "quotes must be verbatim from the page." |
| `herald_fairy.gs` | ✅ Saved | Fix 20: thin-data hard-stop. checkGuestIdentity() helper. Pending path live. Corrupt guard + task spawn on catches. Guest Brief two-step. spawnGuestBriefReviewForJT() exported. **Phase 1.3:** 4 write paths bump contacts. Staged + verified. |
| `artist_fairy.gs` | ✅ Pushed | `Drive.Files.copy` with native Slides mimeType. Two-step `moveTo()` for Shared Drive sources. Headshots disabled. `DECKS_CREATED` log + INFO level. `exportSlidesToPng()` added. |
| `filing_fairy.gs` | ✅ Saved | spawnTask() normalization. Dead writes removed. Post-filing tasks: Studio Assets Ready (JT, rename pending Spoke 1) + Produce Episode (Audra). Corpus deposit to `CORPUS_DRIVE_FOLDER_ID`. Direct `ragFiles:import` commented out — us-south1 unsupported. |
| `housekeeping.gs` | ✅ Saved | parsePipelineBlock(epUid): per-section idempotency. Corpus sync section commented out — us-south1 regional API unavailability. `test_syncCorpusFolder()` stubbed. |
| `clerk_fairy.gs` | 🔴 Rebuild queued | Owns doPost(). Routes: filing → runFilingFairy(), invite → scribeLetSchedule(). |
| `dev_tools.gs` | ✅ Pushed | `ACTIVE_EP_UID` constant at top — paste UID here before running any function. **Current wrappers (May 2026):** SYSTEM — `test_dailyPulse`, `test_checkCalendarForInterviews`; VERT FAIRY PIPELINE — `test_buildEpisodeIndexV2` (force:true), `test_runEditorialPass` (force:true), `test_materializeQuoteGraphicAssets` (force:true), `test_runReelEditorialPass(force)` (parameterized), `test_syncReelAssets` (picks up where it left off on re-run); ARTIST FAIRY — `test_artistFairy`, `test_exportSlidesToPng`; REELS SURFACE — `test_closeReelRevision` (paste `ASSET_ID` + `NEW_DRIVE_FILE` before running; tests §4 atomic close). **Removed:** Phase 1.2–1.3 full test suite (8 functions), all `setup_*`/`migrate_*` one-time functions, diagnostic + smoke tests, enrichment wrappers, caption backfill utilities, `test_runReelEditorialPass_force` (merged into parameterized wrapper), `test_vertShowNotes` (called retired `runVertFairy`). |
| `dwyp_app.gs` | ✅ Pushed (items 59–84; item 92 Phases 1–2; pipeline rewire; 2026-05-22 session; Reels spoke 2026-05-24; 2026-05-25 session) | **Pipeline Rewire (May 2026):** `runVertFairyForEpisode` repointed to `buildEpisodeIndexV2` — function name preserved (Fairy Remote Control UI button calls it by name). `SOCIAL_ASSETS_COLS` 20-column map. Availability filter. Drive-fallback. Slide pairing. Reel Display_Name. v3 Publish image canvas + Hooks/Quotes. Spoke 6 `generateWithClaude()` 5-param signature. `isImageRequest()`/`isExplicitTextRequest()` heuristics. `saveBackgroundToLibrary()`. `stLoadEpisodeIndex()`. Asset enrichment functions. Reels Surface caption/title card Generate buttons. **Phase 1.2–1.3:** `getAllVersions()`, `getDomainVersion()` endpoints. 22 write paths retrofitted. `_resolveImageLibraryVersion()` corrected to scan file timestamps. Staged + verified. **Item 92 Phase 1 (May 2026):** `_parseCaptionDraft_(raw)` — defensive parse for Caption_Draft (handles JSON-stringified array from Gemini pre-pass output; picks parsed[0] if array). `getRankedAssetLibraryCandidates(episodeUid, assetType, slotId)` — **[vestigial — rankings retired; see Current Position]** server-side ranked read: Reel delegates to `getReelsForEpisode()`; image types filter Episode_UID + Asset_Type + Availability='available', rank by tag-match (slotId in Slot_Tags) then Quality_Score DESC then Created_At ASC (null QS = 0), return top 6. `assembleSlotForegroundContext(activeAssetId, activeAssetType, episodeUid)` — written, not yet wired (Phase 4); returns {active_card, same_date_siblings (cap 4, SIBLING_CAP hardcoded — OQ-D), episode}. `getPrecompBgImages()` — reads PRECOMP_BACKGROUND_LIBRARY_ID folder; returns {fileId, name, textColor, thumbnailUrl}; textColor from `_darktext`/`_lighttext` filename suffix (#1a1714 / #ffffff); sorted by filename; limit 60. `ASSET_LIBRARY_COLS` updated: col 19 = Quality_Score (vestigial-ranking), col 20 = Slot_Tags (vestigial-ranking); written by pipeline execution (`materializeQuoteGraphicAssets`, `runReelEditorialPass`) — no active midnight ranking pass under rankings-retired model. See Current Position. **Item 92 Phase 2 (May 2026):** `exportAssetToDrive(episodeUid, slotId, assetId, b64, canvasJson)` — resolves episode working folder, creates `Manual_Exports/` subfolder, writes PNG blob as `{slotId}_{assetId}_{YYYYMMDD-HHMM}.png` (JT_TIMEZONE), writes Canvas_State to AL row, logs `MANUAL_EXPORT` to Audit_Trail, returns `{url, filename, folderUrl}`. **Spoke 0 — Caption Consolidation (May 2026):** `ASSET_LIBRARY_COLS` keys renamed: `Caption_Draft` → `Caption_Host` (col 10), `Caption_Final` → `Caption_Guest` (col 11). All read/write paths updated. Enrichment generators (`generatePublishCaption`, `generateReelCaption`, `enrichQuoteAssetsFromTranscript`, `enrichReelsForEpisode`, `generateCaptionVariants_`, `callGeminiVideoAnalysis_`, `callGeminiTextAnalysis_`, `generateCaptionVariantsBatch_`) and `_parseCaptionDraft_` retired. Vert Fairy guard: `Canvas_State === ''` alone (Caption_Host removed — always set by system on row creation). **Design Sprint (May 2026):** `exportAssetToDrive` extended: `day` param adds day prefix (e.g. `MON_`) to filename; `canvasText` + `caption` params write paired `.txt` companion blob to `Manual_Exports/`. `exportReelToDrive(episodeUid, day, reelAssetId, titleText, caption)` added — resolves Drive file ID from Asset_Library (ASSET_LIBRARY_COLS.Drive_File_ID col 4), copies reel with day prefix to `Manual_Exports/`, writes paired `.txt` (titleText + caption), logs `REEL_EXPORT` to Audit_Trail. **2026-05-22 session:** `callGeminiVideoAnalysis_(driveFileId, prompt, apiKey)` restored — resumable upload to Gemini Files API, polls until ACTIVE, generateContent, DELETE temp file; 45MB size limit guard. `syncReelAssets(epUid, opts)` added — scans Staging/Reels/ (Approved/ first, then root) for MP4s, creates AL rows for unregistered files (Asset_ID = UUID, Status = candidate, Availability = available), runs `callGeminiVideoAnalysis_` per row; 4.5-min timeout guard (re-run picks up where it left off); `bumpVersion` + `logToAuditTrail` on completion. `stLoadEpisodeIndex()` rewritten — primary path: `gatherVertContext(episodeUid, "Studio")` → returns `transcriptText` (full transcript, same three-tier lookup as Track A/B); fallback: `manifest.episode_index_v2` blob read. Companion now grounded in full transcript. `STUDIO_MODE_INSTRUCTIONS.images` — `[[PROMPT: ...]]` instruction and `PROMPT —` definition removed. **Reels Surface spoke (2026-05-24):** `TASKS_COLS.Asset_ID: 17` added. `getTasks()` returns `Asset_ID`. `createTask()` writes 17-col row. `exportReelToDrive` changed copy→move. New: `generateReelCaption(assetId)` (reads `Reel_Summary`, calls Claude with `# Caption Mechanics` + `# Voice Prohibitions` system prompt, writes `Caption_Host`); `spawnReelEditTask(epUid, assetId, type)` (spawns `Revise_Reels`/`edit_vids` task with `Asset_ID` FK); `requestReelRevision(epUid, assetId)` (completes `Review_Reels`, spawns `Revise_Reels`); `closeReelRevision(epUid, assetId, newDriveFileId)` (swaps `Drive_File_ID` on AL row by `Asset_ID`, moves old → `Reels/Superseded/`, completes `Revise_Reels`, `bumpVersion` both domains). **2026-05-25 session:** `exportReelToDrive` — filename now uses title slug (sanitized `titleText`, max 120 chars) instead of day prefix + timestamp; day param removed. `getReelStreamUrl` — returns `/preview` URL (`https://drive.google.com/file/d/{fileId}/preview`); was `uc?id=`. |
| `dwyp_ui.html` | ✅ Pushed (items 59–84 + item 91 + 2026-05-22 session; Reels spoke 2026-05-24; reel player revert 2026-05-25) | Studio left nav (Publish/Design/Write/Outreach/Ideas). Episode accordion, proxy player, F-4 comment submit. Reel workflow card layout (inline player). Image workflow v3 three-panel layout. Fabric.js canvas 360×450, 4:5 export 1080×1350. Spoke 7 session state, episode index loading, mode-aware tab switching. Reel card grid `minmax(0,1fr)` overflow fix. Drop shadow blur reduced. Attribution chip dark + gold + Nunito. **UI polish (May 2026):** Reel trim overlay (Ouroboros SVG + `pbLogoPulse` CSS keyframe, replaces amber bar); trim state persists across day-stack nav (`pb._trimPending` + `_pbApplyPendingTrimOverlays()`). Image card stack — 4:5 thumbnail with padding, red serif title, Drive CDN stubs (`_PB_FEED_STUBS`, 6 URLs). Image editor — toolbar + caption + actions in right column; canvas-left / controls-right layout; slot header platform/why rows hidden via CSS; Back-to-cards inline in header row. Scroll padding on `.pb-ws-active`. Right-rail drag resize handle between Claude and Backgrounds panels. **v3 Center Canvas cosmetic pass (May 2026):** Left rail font/color/size fixes; urgent=red rule removed; active=gold CSS fix; rail never collapses. Reel card collapsed = 9:16 placeholder + title card + summary. Reel expanded = animated side-by-side, header click to collapse, height-capped. Image card whole-card-clickable + hint text. `pbCardNameInput` stub. `title_card` in reel stubs. SVG gradient IDs made unique per card. Urgency past-date bug fixed. **Deferred (wiring phase):** Trim deep-link to specific GCS/Vids file; Processing overlay real async trigger. **Item 92 Phases 1–2 (May 2026):** `_parseCaptionDraft(raw)` (client-side mirror). `_pbNormType(assetType)` — normalizes all bank/bankclip variants to 'reel'. `_pbPrefetchAssets(uid, schedule)` — pre-fetches image-type candidates async per assetType into `pb._alCandidateCache`; pre-fetches reels into `pb.reelCards`. `_pbFindCandidateById(assetId, assetType)` — searches candidate cache. `getRankedCandidates()` **[vestigial — rankings retired; see Current Position]** updated: reads from `pb._alCandidateCache` for image types; falls back to stub pool during async load; shows precomp bg thumbnail (by canvas index) for cards with no Drive export. `_pbHydrateCardCanvas()` — three-tier hydration: (1) restore from `pb.cardCanvases[assetId]` (in-session state); (2) restore from `c.canvas_state` (AL row JSON, undo floor locked); (3) fresh build — resolves precomp bg by `_candidateIndex % bgPool.length`, sets `pb._defaultTextColor` from bg textColor signal, calls `pbAddTextToCanvas(c.quote_text)` then `pbApplyBackground()`, locks undo floor. `pbToolAddText()` — selects existing text object for editing or creates new via `pbAddTextToCanvas('Type your text here…')`. `loadPrecompBgImages()` — async fetch; retroactively applies background + corrects text fill if canvas open during load (race-condition handling). `pbCardClick` non-reel path: snapshots outgoing card to `pb.cardCanvases[outgoingAssetId]` before dispose; calls `_pbHydrateCardCanvas()`. `pbSaveAndExit` critical identity fix: saves to `pb.cardCanvases[assetId]` (not `pb.slotCanvases[slotId]`) — each image card has independent per-assetId storage; `pbSelectSlot` always calls `pbInitCanvas()` fresh for image cards. `pb` state additions: `_alCandidateCache`, `_activeCandidateData`, `_reelCardsLoaded`, `cardCanvases`, `_defaultTextColor`, `_precompBgImages`. Caption prefill from Caption_Draft only if no localStorage caption for this slot. Phase 2 ✅ shipped (May 2026): Fix 1 — `pbSaveAndExit` strips `obj.src` for data URIs + nulls filter matrices before server call (Canvas_State now writes to AL row). Fix A — Save button retired, Export button added (calls `exportAssetToDrive`); all exit paths route through save core before teardown; three exit semantics locked. Fix B — `_pbHydrateCardCanvas` Tier 2 resets `viewportTransform` + clears `backgroundImage` before bg re-apply (eliminates coordinate drift). Fix C — dual-JSON in save-core: `fullCanvasJson` (full base64) → `pb.cardCanvases[assetId]` (synchronous Tier 1 reopen, no async race); `serverCanvasJson` (stripped src, null filters) → server. **Spoke 0 — Caption Consolidation (May 2026):** `caption_draft` → `caption_host` throughout. `_parseCaptionDraft()` client-side retired; all call sites replaced with `String(...)`. `pbSetCaptionFromDraft()` simplified (no JSON.parse, `captionVariants` cleared). Regenerate caption button retired from image canvas + reel workspace. Generate caption button retired from reel card list. `pbRegenCaption()` and `pbGenerateCaption()` retired. **Design Surface Sprint — Round 1 (May 2026):** Design tab shipped as persistent standalone surface. H&Q chips panel in chat col — tap drops text onto `st.fabricCanvas`. QG/Reels sub-tabs (`stSetDesignTab`), Mon–Sat day picker + Export (`stExportQg`, `stExportReel`). Reel list view in content col. "Export Image" button removed from canvas toolbar. `stLoadHqContent`, `stRenderHqPanel`, `stDropText`, `stLoadReels`, `stRenderReelList`, `stSelectReel`, `stSetExportDay` added. **Design Restructure CP1+2 — needs revision (May 2026):** Left rail replaced with accordion (Design/Write/Schedule/Tasks headers). Guest picker removed from chat col — rail owns guest selection via `stRenderRailGuests`, `stSelectGuest`. Images|Reels segmented toggle (`stSegRow`) moved to chat col top. H&Q panel wrapped in collapsible tray (`stHqTray`): open by default, collapses on chip tap, tap header to reopen. Reel browser stub added to right rail (`stReelBrowser`, shown in Reels mode). `stAccToggle`, `stAccOpen`, `stAccSelectMode`, `stToggleHqTray`, `stCollapseHqTray`, `stLoadRailReels`, `stRenderRailReelList`, `stSelectRailReel` added. **Status: needs revision — bugs not yet diagnosed. CP3+4 (caption pinned field in chat col, Reels companion, reel player in center col) deferred. Tasks accordion data source (actual to-do items) needs Hub session to define.** **Design Surface Overhaul (May 2026):** Text scaling (normalize-on-scale corner drag + A+/A− buttons), color picker popover (brand + complementary rows), `stApplyColor` per-char fill clear, overlay reset (circular arrow SVG, pushes history), export PNG fix (`multiplier:2` removed), export txt passes caption field, delete key guard (`isContentEditable`). **Publish Retirement (May 2026):** All `pb*` CSS (~2,150 lines), stPublishPanel HTML, var pb state, ~120 `pb*` functions removed. Left nav: Publish entry gone, Design is default. `openStudio()` defaults to `'design'`. `showEpisodeReview()` → `openStudio('design')`. `pbAutoSelectEpisode()` retired; auto-select wired to `stSelectGuest()`. **2026-05-22 session:** Reels center panel background changed from `#111` to `#f0f0f0`. Phone frame made height-driven (`min(72vh, 560px)` aspect-ratio:9/16) replacing fixed 200px width; iframe absolutely positioned with top:-52px / height:calc(100%+100px) to clip Drive preview toolbar chrome. `stRenderRailReelList` — `Reel_Summary` now rendered in reel cards (`.st-reel-card-summary`, 3-line clamp). Reels selector disabled: `stSegReels` button set `disabled`; `stSetDesignTab` guards `tab==='reels'` → redirects to `'qg'` (blocks button, programmatic calls, and persisted state on load). Companion image prompts removed: `[[PROMPT:]]` instruction + `PROMPT —` definition stripped from `STUDIO_MODE_INSTRUCTIONS.images`; regex in `stFormatResponse` changed from `HOOK\|QUOTE\|PROMPT` to `HOOK\|QUOTE`; `stTapChip` prompt branch removed. **Reels Surface spoke (2026-05-24):** `stSegReels` re-enabled (disabled attr removed, `stSetDesignTab` guard removed). Caption box wired to `Caption_Host`. Generate caption button + `stGenerateReelCaption()`. Action bar (`stReelActions`): Export day-picker → `stPickReelDay` → `stExportReel`; Edit with Vids → `stEditWithVids()`; Request Revision → `stRequestRevision()`. `stSelectRailReel` shows action bar on reel select. `stExportReel` ref fixed: `stExportBtn` → `stReelExportBtn`. New: `stToggleReelDayPicker`, `stPickReelDay`, `stEditWithVids`, `stRequestRevision`. **Revision Flow spoke (2026-05-24):** Episode review rewritten — native `<video>` via `getProxyStreamUrl` (was Drive iframe), compose loop (`epComposerFocus/Send/Cancel`), rail receipts (`epRailAppendRow`, `epRenderRailFromHistory`), hard-seal Request Revisions (`epRequestRevisions`). `epReviewState` replaces `reviewSession`. `Revise_Episode` Complete → `completeEpisodeRevisionTask`. Reel revision popup (`reelRevisionModal`) replaces inline path; `stRequestRevision` opens popup; `stSubmitReelRevisionPopup` passes notes to `requestReelRevision`. **2026-05-25 session:** Drive chrome accepted — iframe crop hack retired; `#stReelPlayerFrame` now `position:absolute; inset:0; width:100%; height:100%`. Modal z-index bug fixed (duplicate `z-index:200` overrode `z-index:400`; modal was rendering behind Studio Overlay at z-index 300). `#reelRevisionModal` centered + full corner radius. Reel card layout redesigned: `st-reel-card-inner` row layout; `.st-reel-thumb-col` (flex 0 0 33%) + `.st-reel-body-col` (flex 1); thumbnail via Drive thumbnail API (`?sz=w200`); `Reel_Summary` shown in full (3-line clamp removed). Action bar simplified: day-picker and Edit with Vids removed; Export calls `stExportReel(st.episodeUid)` directly. `stToggleReelDayPicker`, `stPickReelDay`, `stEditWithVids` removed. |

---

## Fairy / File Architecture — Locked

| Role | File | Notes |
|---|---|---|
| Front desk | `fairy_circle.gs` | Shared utilities + all time-triggered entry points + staging routing helpers |
| Maintenance runner | `housekeeping.gs` | Nightly utility jobs + Mending Fairy (future). Called by `fairy_circle.gs`. |
| Dev / test scaffolding | `dev_tools.gs` | Manual test wrappers only. Never called by production. |
| Manual / on-demand triggers | `fairy_remote.gs` | Deferred. Opens when `dwyp_app.gs` gets heavy. |

---

## AI Layer Architecture — Locked

| Layer | Name | Technology | Role |
|---|---|---|---|
| **Retrieval** | Vert | Vertex AI RAG Engine (us-south1) | Queries corpus, delivers chunks to Drive docs or Claude. Never generates. |
| **Generation** | Claude | Claude API (`callClaudeAPI()`) | Receives Vert chunks, writes all human-facing copy — show notes, captions, hooks, chat responses. |
| **Orchestration** | GAS | Apps Script | Assembles packets, routes calls, writes outputs. Never generates. |
| **Image generation** | GenGem | Gemini image API (`callGeminiImageConversational()`) | Background image generation. History-based; preserves thoughtSignature. Always Gemini — no exceptions. |
| **Guest research** | Herald | Gemini API (`callGeminiAPI()`) | Guest research, bio, Guest Brief. Always Gemini — web search is a hard requirement. |

**Single governance key:** `STUDIO_LLM_MODE = claude` — governs all Claude text generation across Studio and Publish. Code-level Gemini fallback on Claude API failure — automatic, logged to Audit_Trail, no manual intervention.

**Vert's role:** Retrieval only. Queries corpus → delivers chunks. Track A no longer routes through Vertex — `buildEpisodeIndexV2` reads injected raw transcript directly via `gatherVertContext`. Vertex remains active for: (1) live retrieval — on-demand for Write tab and index-fallback scenarios; (2) future Index Audit step (Gemini audits Claude index against Vertex corpus chunks).

**`generateWithClaude()`** is the GAS wrapper in `dwyp_app.gs` that receives Vert chunks and routes to Claude API (replaces `callStudioLLM()`).

---

## Vertex AI RAG Engine — Setup (Complete)

**GCP project:** DWYP RAG (`309883149140`)
- All OAuth, IAM, scope configuration confirmed ✅

**Corpus:** `dwyp-studio-corpus`, **us-south1 (Dallas)**, `text-embedding-005`, **Spanner** vector backend
- Resource: `projects/dwyp-rag/locations/us-south1/ragCorpora/4611686018427387904`
- `STUDIO_CORPUS_ID` confirmed ✅
- Drive connector: watches `CORPUS_DRIVE_FOLDER_ID` — configured in GCP Console ✅
- Corpus populated manually — Vert has content to query ✅

**Corpus sync — current operational state:**
- Programmatic sync via GAS: **BLOCKED.** `importRagFiles` API returns 404 in us-south1. Both v1 and v1beta1 endpoints tested. Code preserved, commented out.
- Drive connector via GCP Console: **WORKS.** Vertex Drive connector watches `CORPUS_DRIVE_FOLDER_ID` and syncs on schedule.
- **Operational path:** Filing Fairy deposits assets to `CORPUS_DRIVE_FOLDER_ID`. Audra triggers sync in GCP Console after each episode files. One manual step per episode.
- **Future reactivation:** Check us-south1 regional expansion for `importRagFiles`. Code is preserved and commented — uncomment when available.

**GCS bucket (`dwyp_corpus_episodes`):** Retired from corpus pipeline. Bucket dormant.

---

## Transcript Source — Locked

| Source | Status |
|---|---|
| DaVinci Resolve (exported) | ✅ Preferred |
| Whisper (local) | ✅ Fallback |
| Gemini auto-transcription | 🔴 Future spoke |
| Riverside transcripts | ⛔ Never — hallucination risk |

---

## Asset Folder Structure — Locked

```
02_RAW_PRODUCTION/
  EP-YYMMDD-HHmm_GuestName/             ← Raw_Folder_ID on Episodes tab
    Production_Notes.gdoc
    [raw transcript]
    [headshot files]

03_STAGING_DRAFTS/
  EP-YYMMDD-HHmm_GuestName/             ← Production_Folder_ID on Episodes tab
    manifest.json
    Episode/
      [finished transcript]
      [finished episode video]
      [finished transcript]
    Images/                              ← Files here → Daily Pulse Loop B → Review Images
      Approved/
      Save/
      Delete/
    Thumbnails/
    Reels/                               ← Files here → Daily Pulse Loop C → Review Reels
      Approved/
      Save/
      Delete/

04_FINISHED_EPISODES/
  EP-YYMMDD-HHmm_GuestName/             ← Filing Fairy moves here

CONTACT_LIBRARY/
  [Contact_ID]/
    Guest_Brief.gdoc
    [headshot files: *_headshot.png/jpg]

IMAGE_BACKGROUND_LIBRARY_ID/
    [Gemini-generated backgrounds]
    [Audra-curated backgrounds]

CORPUS_DRIVE_FOLDER_ID/                  ← Watched by Vertex Drive connector
    [finished transcripts]
    [Episode Cards]
    [Guest Briefs]
    [Brand Voice doc]
    [Content Sensitivity doc]
    [Ops Prompts doc — remove Image Creator section first]
    [Brand Brain doc]
```

---

## Asset Review Flow — Locked

**Images:** Arrow nav (← →), one at a time, Approve/Save with auto-advance, Submit All, untouched → Save.

**Reels:** Scroll-based, tap-to-commit via moveReviewFile(), state badges persist, Submit All. Comment button wired — tap opens inline textarea, Submit spawns Revise_Reels task for Audra.

**Runway Reminder:** Daily Pulse D-7, unresolved assets or open episode review only, idempotent. Ready for Release button on task card only.

---

## Task Inventory — Confirmed

| # | Task | Assignee | Trigger | Notes |
|---|---|---|---|---|
| 1 | Recording Date Reminder | Both | Daily Pulse Loop 1, D-1 and day-of only | Date-aware titles. ✅ Written (not pushed). |
| 2 | Guest Brief Enrich | Audra | Herald on brief completion | ✅ Wired. |
| 3 | Guest Brief Review | JT | Audra approval of #2 | Auto-closes; JT pulls from Contact Library. ✅ Wired. |
| 4 | Image Workshop Ready | JT | Filing Fairy | ✅ Built. ⚠️ Name stale — IW retired. Rename to "Studio Assets Ready" in Spoke 1. |
| 5 | Produce Episode | Audra | Filing Fairy | ✅ Built. |
| 5b | Upload Produced Episode | Audra | Spawned after Produce Episode (manual step for now) | ✅ Built (2026-05-26). Payload_Link = GCS bucket console deep-link. Complete → `completeUploadEpisode` → flips `Video_Status → review` + spawns Review_Episode. |
| 6 | Review Episode | JT | Upload_Produced_Episode task completion | ✅ Built. Trigger changed from Loop A folder-watch to task completion handler. |
| 7 | Review Images | JT | Daily Pulse, files in Images/ | ✅ Built. |
| 8 | Review Reels | JT | Daily Pulse, files in Reels/ | ✅ Built. |
| 9 | Revise Reels / Revise Episode | Audra | `Revise_Reels`: §4 Request Revision or Edit with Vids. `Revise_Episode`: JT Request Revisions in Episode review. | ✅ Live. `Revise_Reels`: spawned by `requestReelRevision` (§4 close) and `spawnReelEditTask`; carries `Asset_ID` FK. `Revise_Episode`: spawned by `requestEpisodeRevisions`; carries `Episode_UID` + Drive folder deep-link in Payload_Link; Complete validates Episode/ single-video invariant via `completeEpisodeRevision`. |
| 10 | Runway Reminder | JT | Daily Pulse D-7 | ⏳ Not yet built. |
| 11 | Release Day Tomorrow / Release Day | Both | Daily Pulse D-1 | ✅ Built. |
| 12 | Errors / Admin | Audra | Various | Urgent. Never visible to JT. |

---

## Pipeline Sequence — Locked

1. Calendar event detected → Secretary runs → folders + manifest created
2. Daily Pulse Loop 1 fires D-1 → Recording Date Reminder spawned (HOST + PRODUCER)
3. Herald runs → Guest Brief written → Guest Brief Enrich task (Audra)
4. Audra enriches + approves → Guest Brief Review task (JT) — auto-closes
5. Audra uploads finished transcript to `Staging/Episode/`; uploads proxy mp4 to GCS `dwyp-review-playback/episodes/{EUID}/proxy.mp4`
6. Audra marks Upload_Produced_Episode task complete → `completeUploadEpisode` → `Video_Status → review` + Review Episode task (JT)
7. Daily Pulse Loop B/C detects Images/Reels → Review tasks (JT)
8. JT sorts assets; comments on reels → Revise_Reels tasks for Audra
9. Daily Pulse D-7: Runway Reminder (if unresolved assets)
10. JT taps Ready for Release → Filing Fairy task for Audra
11. Audra triggers Filing Fairy → assets moved, finished assets deposited to `CORPUS_DRIVE_FOLDER_ID`
12. Audra triggers corpus sync in GCP Console
13. Post-filing: Studio Assets Ready (JT) + Produce Episode (Audra) spawned
14. Daily Pulse Loop D: transcript detected → Track A (`buildEpisodeIndexV2`, Claude) → Track B (`runEditorialPass`) → Track C (`materializeQuoteGraphicAssets`) → Artist Fairy handoff
15. Release Day Tomorrow / Release Day tasks (Daily Pulse D-1)

---

## Tasks & Episodes UI — Design (Locked)

### Dashboard (home screen — live)
`renderDashboard()` entry point. Episode cards sort by Release_Date only — TBD to bottom, recording date never influences sort (D-0 fix written, not yet pushed).

#### Episode Cards
- Release_Date is the sole sort key. TBD sorts below all dated episodes.
- Action line bold when task waiting; muted "Up next" when idle.
- Release pill: green/amber/TBD. Four tappable icons with state.

#### Loose Tasks
Three containers: Podcast · People · Personal. Tap to expand inline. Personal hidden from Audra.

### Contacts Tab (live)
See Contacts Tab section below.

### Episode Detail
All production-forward tasks visible to both. Errors excluded from JT view. Quick Links: Studio / Drive Folder. (Image Workshop and NotebookLM links retired — Spoke 1 removes them.)

---

## Contacts Tab — Design (Locked, Spoke 2 Complete)

**List View:** Display_Name, Organization, Relationship_Type, completion dot. Search by name/org/tag/relationship. Sorted by Last_Activity desc.

**Detail View:** All fields, graceful empties. Social links as tappable icons. Tags + Research Note editable with debounced autosave. EH toggle writes `Influence_Tier = "EH"`. Headshot if URL populated.

**Write paths:** Tags (debounced), Personal_Note (debounced), Influence_Tier (EH toggle only).

**Not in scope:** New contact creation (Secretary owns), core field edits, Herald from Contacts, CRM automation.

**Open Questions:**
| Question | Notes |
|---|---|
| Completion signal criteria | Bio + at least one social + Headshot? Not formally defined. |
| Relationship_Type editable? | Needed if guests become sponsors. Part of C-1. |

---

## Studio — Design (Locked May 2026)

**Architectural details:** `DWYP_Platform_Reference.md` § AI Layer Architecture (Episode Index, retrieval strategy), § Schema (Posting_Schedule), and `DWYP_Operating_Model.md` § 8 (Companion Model). Platform State carries overview only.

### What It Is
JT's NotebookLM replacement. Corpus-powered creative surface. Bottom nav tab (replaces NotebookLM link). Not a pipeline step. Image Workshop fully retired — Design canvas replaces it.

### Four Tabs
```
┌──────────┬──────────────────────────────────────┐
│ Left nav │  Tab content area                    │
│ (icons,  │                                      │
│collapse) │                                      │
│ Design   │                                      │
│ Write    │                                      │
│ Outreach │                                      │
│ Ideas    │                                      │
└──────────┴──────────────────────────────────────┘
```

| Tab | Status | Role |
|---|---|---|
| **Design** | 🔶 Active, CP1+2 needs revision | Persistent standalone surface. `st.fabricCanvas` ring-fenced. H&Q chips panel drops text onto canvas. QG/Reels sub-tabs + Mon–Sat day picker + Export + `.txt` companion files. Rail accordion (Design/Write/Schedule/Tasks). Images\|Reels segmented toggle. H&Q collapsible tray. Reel browser stub in right rail. Text scaling (A+/A− + normalize-on-scale). Color picker (brand + complementary rows). Export PNG fixed (`multiplier:2` removed). CP1+2 needs revision (bugs not yet diagnosed). **Reels sub-tab live (2026-05-24):** Drive `/preview` playback, `Caption_Host` wired, Generate caption, three action verbs (Export/Edit with Vids/Request Revision); cosmetic pass pending. CP3+4 (caption pinned field, Reels companion, reel player) deferred. |
| **Write** | 🔶 Backend wired, UI redesign pending | Chat + doc + My Docs. Newsletter, long-form copy. Cross-episode Vertex-first. Backend: session state, index loading, `generateWithClaude()` routing all wired. Gap: no episode picker in Write tab — `stRagContext` stays empty until UI redesign adds one. |
| **Outreach** | ⏳ Future | Guest comms. Scribe template dependency — not ready to design. |
| **Ideas** | ⏳ Future | Brainstorm + interview prep. No episode context required. |

### AI Companion (Phase 4)
Per-asset chat with Claude, conversation history per asset in Asset_Library, same-date sibling context auto-injection, scheduling commentary via chips, chip suggestions never auto-write JT's draft. Full spec in `DWYP_Operating_Model.md` § 8 (Companion Model). Reusable implementation patterns in `docs/DWYP_Publish_Feature_Patterns.md`. Build is Phase 4 in the playbook.

### Episode Navigation
- **Nav tab → Studio:** auto-selects via `stSelectGuest()` on data-load.
- **Episode card → Studio:** episode UID passed as context payload — lands directly in that episode.
- **Mid-session episode switch:** safe — all canvas state persists to Asset Library; all docs save to My Docs.

### Retired
- Publish tab — retired May 2026. All `pb*` code removed. Design is the sole landing route.
- Mode list (seven modes: Show Notes, Episode Copy, Interview Prep, Social Media, Newsletter, Outreach, Brainstorm) — retired. Two active surfaces: **Design** (compose) and **Write** (compose written work). Schedule is a separate surface — not yet built. See Current Position. Reference: App_Structure v1.2, Reframe #6.
- Starred — retired. My Docs + Asset Library persistence covers it.
- "Librarian Vert" and "Social Vert" personas — retired. Claude introduces itself as Claude.
- Image Workshop — fully retired. No bones carried forward.

---

## UI Design Workflow

**Rule: values, not adjectives.** Audra composes the target look in Figma (visual builder + imported modern UI kit). The handoff artifact is a screenshot plus exact values from Figma Dev Mode — color (hex), spacing (px), font, radius. Code implements the values directly; descriptive language ("make it feel warmer") is not a valid handoff.

**Scope:** App chrome only — all HTML/CSS surfaces (panels, buttons, layout, type). Excludes Studio canvas composition (Fabric.js quote-graphic layout: `stDropText`, `Textbox` positions), which is JS-driven and tuned via JS params — a separate mechanism.

**Optional:** Full HTML/CSS markup exportable from Figma via Anima plugin when a layout needs structure, not just styling values.

---

## Background Generator — Locked (Fully Patched)

- **Model:** `gemini-2.5-flash-image`
- **Stateless:** Canvas background IS the context. No history.
- **Auto-save:** `IMAGE_BACKGROUND_LIBRARY_ID` as `bg_[slug]_YYMMDD-HHMM.ext`
- **Used in:** Studio Design tab right rail

---

## Image Workshop — Retired

Image Workshop is fully retired. Replaced by the Design canvas in Studio. No bones carried forward. Social Vert retired with it. Code preserved per spring-clean decision — dead code removed in Spoke 1.

---

## Manifest Schema — Current

| Field | Writer | Notes |
|---|---|---|
| `episode_uid` | Secretary | |
| `contact_id` | Secretary | |
| `guest_name` | Secretary | |
| `recording_date` | Secretary | |
| `raw_folder_id` | Secretary | |
| `staging_folder_id` | Secretary | |
| `status` | Various | |
| `phase` | Various | |
| `created_at` | Secretary | |
| `herald_form_data` | Secretary | |
| `identity_pending` | Herald | Set true on Enrichment Pending path |
| `raw_hooks` | housekeeping.gs | Vestigial — Social Vert retired. Remove in Spoke 1. |
| `raw_quotes` | housekeeping.gs | Vestigial — Social Vert retired. Remove in Spoke 1. |
| `image_prompts` | housekeeping.gs | Vestigial |
| `show_notes` | Vert Fairy (`runEditorialPass`) | Drive file ID of Show Notes doc. Track B. |
| `episode_index` | — | Drive doc ID of Episode Index doc (v1). `createEpisodeIndexDoc()` deleted. Field vestigial — no writer, no reader in active code. Remove in housekeeping spoke. |
| `episode_index_v2` | Vert Fairy (`buildEpisodeIndexV2`) | Drive file ID of Episode Index v2 doc. Track A. |
| `quote_graphic_assets_built` | Bridge Fairy (`materializeQuoteGraphicAssets`) | Boolean. Set true after Track C writes Asset_Library rows. Track C. |
| `quote_graphic_asset_count` | Bridge Fairy (`materializeQuoteGraphicAssets`) | Integer. Total Asset_Library rows written (hooks + quotes). Track C. |

---

## Build Sequence

### ✅ Complete

| Item | Description | Notes |
|---|---|---|
| 1–84 | Master Sheet build through Reels Surface inline player | See git history for detail |
| 85 | Design Foundation Session — five foundation docs | Surface, Performance, Publish AI, Build Playbook, PreFlight |
| 86 | Phase 1.1 — Versions Tab | 11 domain rows in production sheet |
| 87 | Phase 1.2 — `bumpVersion()` + version endpoints | LockService + audit_trail recursion guard |
| 88 | Phase 1.3 — Endpoint retrofit | 40 write paths across 4 files |
| 89 | Phase 1.4 — Frontend version-aware loader | `getDomainsBatch()`, three-bucket domain model |
| 90 | Phase 1.5 — Dashboard migration | Version-aware cold start; tab return = 0–1 batch calls |
| 91 | v3 Center Canvas — cosmetic pass | Left rail, reel card, image card, urgency fix |
| Track C | Bridge — `materializeQuoteGraphicAssets` | Vert → Claude → Bridge pipeline closed; verified on David Bedrick |
| 92 | v3 Wiring Phases 1–2 | Dual-JSON canvas, Export button, viewport fix, per-asset storage |
| Pipeline Rewire | Track A/B/C Pipeline Rewire | `buildEpisodeIndexV2` rewritten (Claude, extract-not-interpret); Loop D rewired (two-condition A→B); `runVertFairy` + all show-notes + Vertex helpers deleted; `dev_tools.js` cleaned; `runVertFairyForEpisode` repointed |

### ⏳ In Progress
- **Carrie Sipe episode run** — at review stage.
- **v3 Wiring spoke (item 92)** — Phase 1 ✅ confirmed. Phase 2 ✅ shipped (Fix 1: base64 strip; Fix A: Save→Export, exit paths unified; Fix B: viewport reset in Tier 2; Fix C: dual-JSON save-core). Phase 3 (reel card expand) next. Scheduling = separate Schedule surface, not yet built.
- **Design Surface Sprint (May 2026)** — Round 1 pushed: H&Q chips, QG/Reels subtabs, day picker + Export, `.txt` companions, `exportReelToDrive` GAS function, `exportAssetToDrive` extended. CP1+2 pushed (accordion, segmented toggle, H&Q tray, reel browser stub) — **needs revision, bugs not yet diagnosed.** CP3+4 deferred. Tasks accordion data source needs Hub session. **Design fixes pushed (May 2026):** right rail flex-direction fix (`#stBgPane`); `stDropText` two-box rewrite (quote + attribution as independent Textbox objects).

### Queued — Next

**Phase 1 — Performance Foundation**
✅ 1.1–1.5 Complete (see Build Sequence table above).
1.6 Blurhash thumbnails generated at filing time. **← Next**
1.7 Pre-compute audit — identify >200ms operations.

**Phase 2 — Design System (Hub-led, Audra)**
✅ 2.0 Action-Completeness Audit — Closed. Five sessions, saturation marker S5. Output: `DWYP_App_Structure.md` v1.3 + `DWYP_User_Flows.md` v1.0. Phase 2.1 / 2.3 / 2.4 / 3.3 hub sessions unblocked.
2.1 Component library design.
2.2 Status indicator component (first-class component for save/saved/failed).
2.3 Mobile IA design.
2.4 Desktop chrome conventions.

**Reels Surface push** — Verbs shipped (2026-05-24): export move, generate caption, edit with vids, request revision, §4 atomic close. Cosmetic/UI polish pass pending.

**Spoke 8 — Daily Pulse audio** *(after Phase 1)*
- Reel upload detected → audio extraction → transcription → episode index reel descriptions.
- Quick Caption path via Studio (not standalone).
- `fairy_circle.js`, `dwyp_app.js`.

**Other queued (not Studio):**
- Runway Reminder spoke — Daily Pulse D-7, idempotent.
- F-7 timezone — wire `JT_TIMEZONE` / `AUDRA_TIMEZONE` into recording reminder logic.
- F-9 — Tasks tab nav entry.
- getTasks() header-driven fix.
- Review_Images close path.
- C-3 — Re-run Herald button (Audra-only, Contact Detail).
- C-4 — Influence Tier three-way toggle (EH / HI / LF).
- D-1 — Dashboard Loose Task Containers.
- C-2 — Revision Task inline checkboxes.
- C-1 — Contacts Add/Edit (awaiting JT feedback).
- F-2 — Reels Viewport Fit (iPhone SE) (pending device confirmation).

**Parked — Hub Backlog (Item 92 Phase 2 session):**
- Stub → real card swap on first paint: render skeleton card frames (no text, no bg) until `_pbPrefetchAssets` resolves, then single swap to real content. Skeleton-first preferred over block-until-ready — also closes orphaned-Card-1 race (click before prefetch returns → stub ID → hydration bails) as a side effect.
- AL row as single source of truth across surfaces: every surface displaying asset content (stack card thumbnail text/bg, caption draft chip, details panel quote text) should read from AL row, not derived or cached copies. Requires audit-first spoke (map all surfaces + current vs. should-be sources), then patch spoke. Open design decisions for hub: overwrite `Quote_Text` on edit or new `Display_Text` column? Write to AL on save or derive from Canvas_State on every read? Does caption draft regenerate against edited text or stay locked to original?

### Later
- Dr. Meenakshi Aggarwal Secretary run — held until Herald verified on Carrie
- Filing Fairy expansion — subfolder moves on filing; uncomment corpus deposit when us-south1 API available
- Gemini auto-transcription spoke
- Clerk Fairy rebuild
- Mending Fairy — `correctGuestName()`, `archiveEpisode()`, re-enrichment trigger
- Guest Brief formatter + Guest Doc formatter
- JT social tasks + Audra release tasks
- Restore dailyPulse() Loop 2 (release reminder) — spawns Writer email task; JT completes autonomously
- Zernio integration
- Herald suppression — delay Guest Brief Review task until closer to recording date
- Server-side task security filtering — v2
- Contact folder recreation — graceful recovery when folder missing
- Task List visual polish
- JT Clip Review Tool
- AI reel hook/title analysis — Gemini multimodal video review. Major lift. Architecture TBD.
- F-8 — Un-approve / un-sort asset toggle

### Ideas — Back Burner
*(Not sized, not sequenced — come back to these in a hub session)*

- **JT episode promo Reel** — short promo Reel per episode (not a clip). Optional Tuesday drop cadence. Optional: Micropod drops 2x/week. Generated in the Write tab.
- **Episode detail page** — each episode gets its own page with longer notes.
- **Podcast URL** — dedicated podcast URL for discoverability.


---

## Open Issues

| # | Area | Issue | Action |
|---|---|---|---|
| 15 | `dwyp_ui.html` | **CLOSED (2026-05-25).** Drive chrome now shown intentionally. Crop hack retired. | — |
| 16 | `dwyp_app.gs` / `dwyp_ui.html` | **Companion image prompts temporarily removed (2026-05-22).** `[[PROMPT:]]` instruction + definition stripped from `STUDIO_MODE_INSTRUCTIONS.images`; regex and `stTapChip` handler removed from UI. | Re-add when image prompt → background generation flow is ready to be wired properly. |
| 2 | `dwyp_app.gs` | **RESOLVED (2026-05-24).** `requestEpisodeRevisions` spawns/appends `Revise_Episode` task for Audra with folder deep-link. Compose loop writes individual Episode_Log rows via `submitEpisodeCommentRow`. | — |
| 3 | RAG Engine | `importRagFiles` API unavailable in us-south1. | Corpus sync commented out. Manual GCP Console import is operational path. Revisit when us-south1 expands. |
| 4 | `herald_fairy.gs` / `secretary_fairy.gs` | Contact record exists but Contact Library folder missing → flags duplicate. | Fix before next new guest run. |
| 6 | `dwyp_ui.html` | B-5: Bottom border missing on quote card template. | Awaiting reference image from JT. |
| 7 | `dwyp_ui.html` | B-3: Fonts not rendering correctly in Add Text. Should be Libre Baskerville / Nunito (Sofia Pro sub). | IW polish spoke (F-5). |
| 8 | `dwyp_ui.html` | Write tab has no episode picker — `stSelectEpisode()` only fires from Design tab's dropdown. `stRagContext` stays empty in Write mode; Claude has no episode context. | Part of Write tab UI redesign (three-panel). Not a wiring bug. |
| 9 | `dwyp_ui.html` / `dwyp_app.gs` | Loose tasks (not linked to an episode) do not appear in the app. Pre-existing bug, predates Phase 1.3. Surfaced during Phase 1 staging verification. | Investigate in a separate spoke before next JT session. |
| 10 | `dwyp_ui.html` | Trim button opens `vids.google.com` root — needs a deep-link to the specific Drive/GCS file. | Deferred until GCS embed + Sentinel confirmed. Scope in wiring hub. |
| 11 | `dwyp_ui.html` | Processing overlay fires immediately on Trim click — should only show while async work is in progress. | Deferred until real Trim async path is wired. |
| 12 | `artist_fairy.js` | Host Quotes downstream cleanup. Audit `buildPlaceholderMap()` for HOST QUOTES extraction; remove `{{HOST_QUOTE_*}}` placeholders from Square/Horizontal/Vertical slide deck templates in Drive. Cosmetic — not load-bearing. `{{HOST_QUOTE_*}}` tokens already resolve to empty strings via graceful-degradation. | Open spoke. |
| 13 | Caption Voice Supplement | Doc states "em-dash as breath beats" — directly contradicts v2.4 Voice Prohibitions (em-dashes forbidden everywhere except quote attribution). | Fix at source before next editorial pass. |
| 14 | `fairy_circle.js` | Pile of Puppies footer hardcoded in template. Migrate to `DESCRIPTION_FOOTER` key in Governance_Config; append at assembly time parallel to `_appendCaptionSignoff_`. | Spoke-sized. Queue after v2.4 patch applied. |

---

## Pending Decisions

| Item | Status |
|---|---|
| Corpus sync schedule | Drive connector daily via GCP Console. Manual trigger after each filing. |
| `parsePipelineBlock()` / housekeeping | Vestigial — Social Vert retired. Confirm removal before housekeeping spoke. |
| JT's device — iPhone SE? | Determines F-2. |
| Contacts completion signal | Bio + one social + Headshot? Not formally defined. |
| Contacts Relationship_Type editable? | Part of C-1. Awaiting JT feedback. |
| D-1 container architecture | User-created categories as data structure from day one. |
| Artist Fairy post-redesign role | No longer produces quote graphics. May handle Reel thumbnails or other assets. Confirm before that spoke opens. |
| Voice Prohibitions ↔ Brand_Identity_V2 reconciliation | v2.4 absorbed Brand_Identity_V2 forbidden phrases into Voice Prohibitions, but a full cross-doc reconciliation remains. Decision-heavy — separate hub session. |
| **Asset_Library `chat_history` column (OQ-G)** | 20-col schema confirmed (Quality_Score col 19, Slot_Tags col 20 — both vestigial-ranking, not deleted). Add `chat_history` as col 21 before Phase 4 (Publish Companion). |
| **Conversation history turn cap (OQ-E)** | N=? Decide before Phase 4 spoke. |
| **Sibling context cap UX (OQ-D)** | Reduced/moot under Design–Schedule split; companion = asset-in-focus only. Revisit only if Schedule surface reintroduces stacks. |
| **Reels revision input design** | Text box → task spawn with JT's words (Option A/Notes). Small spoke. Ping Audra when ready to spec. |

---

## Reminders — Action Required

| Item | Status |
|---|---|
| Register nightly trigger for `triggerNightlyHousekeeping()` | ⏳ Not yet done |
| After each episode files: trigger corpus sync in GCP Console | ⏳ Ongoing — manual step |
| Set `STUDIO_LLM_MODE = claude` in Governance_Config | ⏳ Before Studio backend spoke |
| Add `ASSET_LIBRARY_TAB_NAME = Asset_Library` to Governance_Config | ⏳ Verify before Spoke 2 push |
| Add `STUDIO_TOKEN_WARNING_THRESHOLD = 50000` to Governance_Config | ⏳ Before Studio backend spoke |
| Add `PUBLISH_CHAT_HISTORY_TURN_CAP` to Governance_Config | ⏳ Before Phase 4 (Publish Companion) |
| Delete `test_batchEnrichReels` time-based trigger (every 30 min) | ⏳ Enrichment complete — trigger no longer needed |
| Retire `PUBLISH_LLM_MODE`, `IMAGE_WORKSHOP_GEM`, `IW_EXPORT_FALLBACK_FOLDER_ID`, `NOTEBOOKLM_LINK` | ⏳ Pipeline cleanup spoke |

---

## Governance Keys — Current State

**Full key list is authoritative in Governance_Config sheet.** This section tracks status only.

**Populated and confirmed:**
`GEMINI_API_KEY`, `MODEL_NAME`, `CLAUDE_API_KEY` ✅, `MASTER_SHEET_ID`, `MASTER_TEMPLATE_ID`, `STAGING_DEPLOYMENT_URL` ✅, `STAGING_SHEET_ID` ✅, `RAW_PRODUCTION`, `STAGING_DRAFTS`, `FINISHED_EPISODES`, `DWYP_CALENDAR_ID`, `CALENDAR_TRIGGER_PREFIX`, `ASSIGNEE_HOST`, `ASSIGNEE_PRODUCER`, `HOST_NAME`, `HOST_EMAIL`, `CONTACT_LIBRARY_FOLDER_ID`, `PODCAST_NAME`, `HERALD_RESEARCH_PROMPT_KEY`, `HERALD_BIO_PROMPT_KEY`, `HERALD_BRIEF_PROMPT_KEY`, `CONTENT_SENSITIVITY_ID`, `BRAND_VOICE_ID`, `NOTEBOOK_STAGING`, `ARCHIVE_FOLDER_ID`, `RELEASE_REMINDER_HOURS`, `SCRIPT_ID`, `INTAKE_NAME_KEY`, `INTAKE_EMAIL_KEY`, `INTAKE_REFERRAL_KEY`, `ARTIST_THUMBNAIL_DECK_ID`, `ARTIST_SQUARE_DECK_ID`, `ARTIST_VERTICAL_DECK_ID`, `IMAGE_BACKGROUND_LIBRARY_ID`, `STUDIO_CORPUS_ID`, `CORPUS_DRIVE_FOLDER_ID`, `VERTEX_RAG_REGION` (`us-south1`), `REELS_ARCHIVE_FOLDER_ID`, `POSTING_SCHEDULE_TAB_NAME`, `SOCIAL_ASSETS_TAB_NAME`, `STUDIO_ROOT_FOLDER_ID`, `STUDIO_CANVAS_MANIFEST_FOLDER_ID`, `STUDIO_DOCS_FOLDER_ID`, `STUDIO_SESSIONS_FOLDER_ID`, `EPISODE_SEARCH_INDEX_KEY`, `JT_TIMEZONE`, `AUDRA_TIMEZONE`, `PUBLISH_LLM_MODE` (gemini — retire after Spoke 1), `PRECOMP_BACKGROUND_LIBRARY_ID` (Drive folder `1Tyw7ArpdmYiKZNL4FOQNIpA4fTXkwkh6`; currently same as IMAGE_BACKGROUND_LIBRARY_ID — curated set to be built and swapped; filename convention: `bg_NNN_darktext` / `bg_NNN_lighttext`), `STUDIO_IMAGE_MODEL` = `gemini-2.5-flash-image` (locked — hub decision May 2026), `CAPTION_VOICE_SUPPLEMENT_ID` ✅ (Track B voice authority patch), `DELIVERABLES_VOICE_SPEC_ID` ✅ (Track B voice authority patch).

**Needs value set:**
`STUDIO_LLM_MODE` → `claude` (before Studio backend spoke).
`REVIEW_GCS_BUCKET` → `dwyp-review-playback`; `GCS_SIGNER_SA` → `309883149140-compute@developer.gserviceaccount.com`; `GCS_EXPIRY_SECONDS` → `28800` — all required before episode GCS player is live.

**Add before Studio backend spoke:**
`ASSET_LIBRARY_TAB_NAME` = `Asset_Library`, `STUDIO_TOKEN_WARNING_THRESHOLD` = `50000`.

**Add before Phase 4 (Publish Companion):**
`PUBLISH_CHAT_HISTORY_TURN_CAP` = (TBD), `PUBLISH_SIBLING_CONTEXT_CAP` = `4`.

**Present but blank — populate when ready:**
`SCHEDULING_LINK`, `RIVERSIDE_LINK`, `INTAKE_FORM_ID`, `INVITE_EMAIL_TEMPLATE_KEY`, `DAILY_DIGEST_TIME`, `GUEST_BRIEF_TEMPLATE_ID`, `EPISODE_CARD_TEMPLATE_ID`, all seven Scribe template keys (migrate to Writer Email quick-start templates — Reframe #8).

**Retire after Spoke 1:**
`PUBLISH_LLM_MODE`, `IMAGE_WORKSHOP_GEM`, `IW_EXPORT_FALLBACK_FOLDER_ID`, `NOTEBOOKLM_LINK`.

**Already retired:**
`FRAMEIO_API_TOKEN`, `FRAMEIO_TEAM_ID`, `MAKE_FRAMEIO_WEBHOOK_URL`, `FRAMEIO_WORKSPACE_ID`, `VISUAL_DESIGNER_GEM_ID`, `GUEST_BRIEF_LIBRARY_ID`, `MAKE_PNG_CONVERSION_WEBHOOK_URL`, `PRODUCTION_NOTES_PROMPT_KEY`, `SAFETY_IMAGE_PROMPT_KEY`, `PREP_GEM_ID`, `COWORK_TRIGGER_FOLDER_ID`, `COWORK_OUTPUT_FOLDER_ID`, `MARCOM_COWORK_TIMEOUT_HOURS`, `STUDIO_CORPUS_FOLDER_ID` (renamed to `CORPUS_DRIVE_FOLDER_ID`), `SOCIAL_VERT_BUCKET`.

---

## GAS Deployment Checklist

| Item | Status |
|---|---|
| `MASTER_SHEET_ID` Script Property | ✅ Set |
| `STAGING_DEPLOYMENT_URL` and `STAGING_SHEET_ID` in Governance_Config | ✅ Set |
| `isStaging()` and `getMasterSheetId()` helpers in `fairy_circle.js` | ✅ Locked architectural pattern |
| All sheet access routes through `getMasterSheetId()` | ✅ Audit complete |
| `onFormSubmit` → `processFormSubmission` | ✅ Wired |
| `dailyPulse` time-based trigger | ✅ Set — 4am daily |
| `checkCalendarForInterviews` time-based trigger | ✅ Set — hourly |
| Web app deployed (dwyp_app.gs) | ✅ Deployed. executeAs: USER_DEPLOYING. |
| `triggerNightlyHousekeeping` time-based trigger | ⏳ Not yet registered |
| `clerk_fairy` doPost() | ⏳ Rebuild queued |
| Items 43–58 pushed and deployed | ✅ Done |
| Items 59–84 + item 91 pushed and deployed | ✅ Done |

---

## Engineering Notes

### Video Playback — Current Strategy

**Episode proxy:** Native `<video id="stEpVideo">` fed by `getEpisodeStreamUrl(episodeUid)` — a V4-signed GCS GET URL (bucket `dwyp-review-playback`, path `episodes/{EUID}/proxy.mp4`, 8h expiry). Signing: IAM signBlob API via owner's `ScriptApp.getOAuthToken()` (`cloud-platform` scope already in manifest). URL is re-minted on every open; never stored. Enables JS control (focus-pause-freeze-timestamp, scrub, resume). Troubleshooting: if signBlob returns 403, verify `iamcredentials.googleapis.com` API is enabled in GCP Console. File must exist at exact GCS path before the player is opened.

**Reels:** Drive `/preview` iframe. `getReelStreamUrl(fileId)` sets sharing to anyone-with-link and returns `/preview` URL. URL cached on `reel._streamUrl` — first tap pays GAS round-trip, subsequent taps instant. Drive chrome shown intentionally (two-person internal app). Crop hack retired 2026-05-25 — produced a 2px left-edge artifact unreachable from CSS. See memory: `project_video_hosting.md` — Cloudflare Stream or Mux when ready to upgrade.

**Paths ruled out for reels:**
- `uc?id=` + native `<video>` — Drive returns a virus-scan HTML interstitial for files over ~25MB; scrubbing broken (no byte-range). Dead on real reels.
- GCS migration for reels — deferred; GAS blob ceiling + microservice requirement. Bucket `dwyp-reel-playback` is an orphan (zero code references) — safe to delete in GCP Console at discretion.

---

## Canvas State Architecture — Locked Principles

### Render-on-send
Canvas_State JSON is the authored artifact. PNG is rendered at dispatch time — never stored as a pre-render that must be kept in sync. The `addToWeekAsImage` schedule-time PNG creation is a vestigial preview/backup path. `exportAssetToDrive` is the formal manual-backup channel. JT can edit canvas state until the moment of send.

### Dual-JSON for canvas state
Canvas state has two destinations with different constraints:
- **In-memory (`pb.cardCanvases[assetId]`):** full JSON with embedded base64 background. Enables synchronous restore on reopen. No async race window.
- **Server (`Canvas_State` cell on AL row):** stripped JSON — `obj.src` emptied for data URIs, filter matrices nulled. Fits under GAS URL-encoded payload limit and Sheets 50k char cell cap. Reload-time hydration re-applies background from precomp pool by index.

`pbSaveAndExit` save-core produces both via different post-processing from one `canvas.toJSON()` call. Never collapse them into one variable — they serve different consumers with different constraints.

---

## Known Issues / Troubleshooting

- **RAG corpus sync blocked in GAS:** `importRagFiles` API unavailable in us-south1. Manual GCP Console import is operational path. Code preserved in housekeeping.gs with dated comment.
- **Herald re-enrichment:** Run Herald button on Fairy Remote Control is the re-enrichment trigger.
- **F-7 timezone:** `JT_TIMEZONE` and `AUDRA_TIMEZONE` governance keys added. Verify recording reminder timing before first live recording.

---

## Episode Roster

| Seq | Guest | Release Date | Tier | Status |
|---|---|---|---|---|
| 1 | Carrie Sipe | — | EH | Released 2026-05-19 (EP-260428-1928) |
| 2 | Dr. Meenakshi Aggarwal | June 2 | EH | Active episode (EP-260504-0736) |

> Full release schedule lives in the Episodes tab of the Master Sheet — that is the authoritative source.

---

## Rules for This Codebase

- All GAS code written by Claude only. Never edited directly in Apps Script or by Gemini.
- Claude Code (VS Code + Claude Code extension) is the preferred workflow.
- Prose behavior controlled through Master Template, not code.
- All config values in Governance_Config. No hardcoded strings.
- Confirm before writing or patching any script. Confirm save/push before moving on.
- Multi-file patches fine when tightly coupled.
- Intentional deletion policy (replaced Preservation Mandate): nothing removed without explicit decision. Renames and dead code removal require explicit approval. Active function behavior never changed without a confirmed design decision.
- All sheet access goes through `getMasterSheetId()` — never read `MASTER_SHEET_ID` directly except inside `getGovernance()` (the bootstrap exception).
- New features must apply Surface Principle (mobile = ops, desktop = creation) and Performance Principle (show first, sync second; version-stamp invalidation). Surface decisions that conflict with the principles are flagged, not silently resolved.
- Once `bumpVersion()` ships in Phase 1.2, every write path must call it for the affected domain. Until then, surface back when writing data-mutation code so the versioning gets retrofitted cleanly.
- Mode awareness governs session behavior — Hub mode (no code, design and capture), Spoke mode (one focused unit, surface back at push checkpoints), Verification mode (report findings only, do not fix).
- `CLAUDE.md` in repo root instructs Claude Code to read State + changelog + foundation docs (per tier) on every session.

---

*Version history stripped. See git log for session-by-session detail.*


