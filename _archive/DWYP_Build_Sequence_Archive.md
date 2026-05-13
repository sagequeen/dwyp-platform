# DWYP Build Sequence Archive — Items 1-84

**Status:** Static archive. Will not be updated.
**Date range:** Project inception through May 2026 (Reels Surface inline player).
**Captured from:** `DWYP_Platform_State_v5.1.md`
**Successor:** Items 85 onward live in current State (`DWYP_Platform_State.md`) Build Sequence section + the changelog.

---

## Purpose

The Build Sequence in current State was condensed in v5.2 to keep the live State doc focused on current and forward-looking work. This archive preserves the full detail of historical items 1-84 for future reference — when a code path or design decision needs context, this document is the source of truth for "when was this built and why."

Reference this when:
- Investigating why an existing function looks the way it does
- Understanding the context for a past architectural decision
- Tracing the evolution of a subsystem (Image Workshop → Studio, Frame.io → Riverside, etc.)
- A spoke session needs historical detail not in current State

---

## Items 1-84

### Foundation (1-22)
1. Master Sheet — all tabs, headers, validation, protection
2. Governance_Config — populated and current
3. Intake Design — signed off
4. GAS sweep — all fairies patched against v1.5 schema
5. Master Template — locked
6. Social media strategy — playbook locked, Social_Assets schema designed
7. Episode Card + Guest Doc — redesigned, locked
8. Web app v1 — deployed, JT onboarded
9. PIN-based identity
10. Time-based triggers — dailyPulse @ 4am, checkCalendarForInterviews hourly
11. First Secretary run — Carrie Sipe ("Carrie Snipe")
12. Frame.io — fully retired
13. Safety Fairy — verified, retired
14. Web app fixes — Me filter, external links, spinner
15. Marcom + Image Workshop architecture locked. Marcom retired.
16. Web app — Episode Detail redesign. Assets + Tools card. Review shells. Fairy Remote Control.
17. Herald Fix 20 — thin-data hard-stop, checkGuestIdentity(), Pending path
18. Image Workshop — designed, built, Background Generator patched
19. Safety Fairy retired. Vertex AI RAG Engine locked.
20. housekeeping.gs — parsePipelineBlock(), nightly entry, per-section idempotency
21. Codebase audit — getManifest() corruption patched, Audit_Trail Level column added
22. Task copy + wiring patch — six files. Herald two-step Guest Brief. FRIENDLY_NAMES. Confetti.

### Core Build (23-42)
23. Missing task spoke — all tasks built and wired
24. GCP / RAG Engine setup — OAuth confirmed, corpus created
25. Secretary patches — Frame.io removed, subfolder structure corrected
26. Daily Pulse loops — A (proxy), B (Images), C (Reels). Idempotent.
27. dev_tools.gs built
28. CLAUDE.md created
29. Carrie Sipe clean-slate run — EP-260428-1928
30. Review task backend + frontend
31. Review task fixes
32. Review task hotfixes
33. Social Vert + Image Workshop spoke — GCS-backed, chip parsing, full polish
34. Image Workshop export fix
35. Images sorter redesign — arrow nav, one-at-a-time
36. Episode Detail label cleanup
37. Episode Detail cosmetic polish
38. Secretary: calendar keyword filter + hang fix
39. Contacts tab (Spoke 2) — list + detail, search, EH toggle, autosave
40. Reels sorter redesign — scroll-based, unified model
41. Dashboard spoke — home screen, episode cards, loose tasks, Guest Brief auto-close
42. RAG corpus rebuild — us-south1, Spanner, import confirmed

### Detailed Spokes (43-84)

43. **Recording Reminder timing fix** — Secretary spawn removed. Daily Pulse Loop 1 owns timing. D-1 + day-of only. Date-aware titles. HOST + PRODUCER tasks. ✅ Pushed and confirmed live.

44. **Secretary calendar Advanced Service** — `Calendar.Events.list()`, `wrapCalendarApiEvent()` adapter, sleep(3000) between events. ✅ Pushed and confirmed live.

45. **Social Vert → Vertex RAG** — `querySocialVert()` rewritten to `vertexRagStore`. GCS fallback retired. ✅ Pushed and confirmed live.

46. **Reels comment button** — `rvToggleComment()`, `rvSubmitComment()`, `submitReelRevision()`. Revise_Reels task spawned for Audra. ✅ Pushed and confirmed live.

47. **B-2 + D-0 UI fixes** — Studio → NotebookLM relabel, Dashboard sort fix (Release_Date sole key, TBD to bottom). ✅ Pushed and confirmed live.

48. **Image Workshop BG handles** — `iwAttachBgControls()` custom corner controls with clamped `positionHandler` (visual handle never leaves canvas). `scalingEqually` action handler. `lockUniScaling: true`. `iwReattachBgControls()` called after undo/redo/aspect-ratio change. ✅ Pushed and confirmed live.

49. **QUOTE chip two-object placement** — `svTapQuoteChip()` routes QUOTE chips through `iwPlaceQuote()`. Parses at last em-dash. Strips surrounding quotation marks. First-letter cap enforced. Quote in Libre Baskerville italic; attribution in separate Nunito textbox. ✅ Pushed and confirmed live.

50. **Image Workshop export picker** — `getActiveEpisodes()` + `#iwExportModal` before Drive write. Episode dropdown, confirm/cancel. `iw.pendingExportDataUrl` stash. ✅ Pushed and confirmed live.

51. **Social Vert prompt v3** — `SOCIAL_VERT_SYSTEM` constant replaced. Quotation marks on QUOTE chips. Standalone test mandatory gate. OUTPUT FORMATTING + HOW TO SPEAK sections. Forbidden phrases expanded. Catchphrase rule. PROMPT visual standard locked. `querySocialVertDirect()` wired to constant. ✅ Pushed and confirmed live.

52. **Quick Caption** — JT uploads a Reel or image from her phone; Gemini returns three labeled caption options (Short · Hook, Medium · Personal, Longer · Story); she can chat to request revisions. Avatar menu: "Image Workshop (test)" replaced by "Quick Caption" for both users. Backend: `getQuickCaptions()` (inline base64 for images; Gemini File API resumable upload + ACTIVE poll for video), `continueQuickCaption()` (multi-turn history, text-only). Frontend: `#quickCaption` fixed overlay, `qcParseCaptions()` regex parser, dark caption boxes with Copy button, `qc.history` tracks conversation. ✅ Pushed and confirmed live.

53. **Quick Caption — video ceiling fix** — Root cause: `Utilities.base64Decode` creates JS integer array at ~8 bytes/raw byte in V8 heap; 30MB video → ~240MB heap → GAS kills silently. Two secondary bugs: GAS normalizes response headers to lowercase; `withFailureHandler` ate opaque GAS errors. Fixes: video cap 30MB→15MB frontend; size guard in GAS before base64Decode; header name fix in `qcUploadToFileApi`; failure handler uses `toString()` fallback. Drive-as-bridge permanent path for >15MB video (designed, not built). ✅ Pushed and confirmed live.

54. **Dashboard tab refresh + Tasks section header** — `switchTab('dashboard')` fires silent background `getTasks()` on every return; re-renders with staleness guard. "Everything Else" header replaced with "Tasks" + lightweight red Add Task button (always visible). Partial fix for F-9 (entry point now on dashboard; Tasks tab nav still needed). ✅ Pushed and confirmed live.

55. **F-10 — Revise tasks Complete button** — `Revise_Reels`, `Revise_Images`, `Revise_Episode` added to `completeSteps` in `renderTaskButtons()`. Audra now has a Complete button on all Revise tasks. Re-appear mechanic was already correct — each JT comment spawns a new task. ✅ Pushed and confirmed live.

56. **RFR premature display fix** — `checkReadyForRelease()` adds `countApprovedFiles()` inner check. Gate is now `imagesEmpty && reelsEmpty && hasApproved` — suppresses button on fresh episodes where Approved/ subfolders have never received a file. ✅ Pushed and confirmed live.

57. **Vert→Artist pipeline spoke** — `artist_fairy.gs`: `Drive.Files.copy` with `mimeType: 'application/vnd.google-apps.presentation'` converts `.pptx` templates to native Slides on copy; two-step `moveTo()` for Shared Drive sources. Headshots disabled (null blobs). `DECKS_CREATED` log + `INFO` level. `exportSlidesToPng()` added (Slides thumbnail API → PNG in parent folder). `vert_fairy.gs`: `cleanHooksWithGemini()` secondary Gemini pass — rewrites person/event hooks to concept-forward statements, strips names and third-person pronouns, keeps social-media register; hooks section simplified to: synthesized from main themes, max 25 words, plain text only; faith-based prohibition added to VOICE PROHIBITIONS. `fairy_circle.gs`: null `systemInstruction` guard in `callGeminiAPINoSearch`. `dwyp_app.gs`: `STUDIO_SYSTEM_BASE` rewritten — removed "faith-based podcast" language, accurate show description + brand voice. `appsscript.json`: `presentations` OAuth scope + Slides v1 Advanced Service. `dwyp_ui.html`: green `.st-src-chip.prompt` CSS. `dev_tools.gs`: `test_exportSlidesToPng()` added. ✅ Pushed and confirmed live.

58. **Reels submit button — apostrophe filename fix** — Root cause: `esc(fileName)` converts `'` to `&#39;`; browser decodes HTML entity back to `'` before executing onclick JS → `SyntaxError: missing ) after argument list` → function never called, button never disables. Fix: `escapedName` removed from onclick string; stored in `data-file-name` attribute instead; `rvSubmitComment` reads via `submit.dataset.fileName`. `withFailureHandler` updated: now calls `showToast` with error text (was silently re-enabling button). `dwyp_ui.html`. ✅ Pushed and confirmed live.

59. **Publish tab — Studio left nav + tab restructure** — Horizontal tab bar replaced with collapsible left nav (`#stNavCol`). Tabs: Publish / Design / Write / Outreach / Ideas. Nav auto-collapses to icon-only on selection; `stNavToggle` arrow reopens. Episode picker compact — guest name only, lives inside `pb-week` header. No episode picker for Write/Ideas (free-form AI chat). `pbAutoSelectEpisode()` opens nearest upcoming episode on load. Slot "why" moves to top of workspace panel (`#pbWsWhy`). Underscore-free display labels throughout. `dwyp_ui.html`. 🔶 Written, not pushed.

60. **Publish tab — Episode accordion + Episode Review** — Episode entry at top of week accordion, above days. Expands to Episode workspace (`#pbWsEpisode`): proxy player embed (Riverside URL from `getEpisodeReviewContext()`), Approve button (calls `writeVideoStatus('approved')`), Comment field → `submitEpisodeRevisionRequest()` (F-4). `showEpisodeReview()` retired as nav destination; redirects to Publish + opens accordion (stub preserved per Preservation Mandate). New GAS: `getEpisodeReviewContext()` reads Episodes + Tasks sheets + proxy file ID; `submitEpisodeRevisionRequest()` — wrapper that calls `writeVideoStatus`, `appendEpisodeLogEntry`, and `submitEpisodeComments`. `dwyp_app.gs` + `dwyp_ui.html`. 🔶 Written, not pushed.

61. **Publish tab — Drive fallback for image candidates** — `getStagingCandidates_(episodeUid, assetType)` scans `Staging/Images/Approved/` (falls back to root) when `Social_Assets` has no rows for the episode. Folder routing: reel → `Reels/`, thumbnail → `Thumbnails/`, else → `Images/`. Returns Drive-sourced objects with `_fromDrive: true` and `Post_ID = fileId`. `placeAssetInSlot()` accepts optional `driveFileId + assetType` params — creates a new Social_Assets row on first Add. `dwyp_app.gs`. 🔶 Written, not pushed.

62. **Publish_Spoke_Update_01 — Social_Assets schema additions** — `SOCIAL_ASSETS_COLS` updated to 20 columns: `Slide_Index` (18), `Availability` (19), `Display_Name` (20). Both sheet columns already added manually by Audra for Slide_Index/Availability; Display_Name still needs adding. `getSocialAssets()` now filters `Availability ≠ placed AND Availability ≠ paired` (empty = available, for backward compatibility). Returns `Slide_Index`, `Availability`, `Display_Name` in asset objects. `getStagingCandidates_()` populates `Display_Name` (Reel 1 / Reel 2…), `Slide_Index` (""), `Availability` ("available"). `dwyp_app.gs`. 🔶 Written, not pushed.

63. **Publish_Spoke_Update_01 — Slide pairing logic** — `placeAssetInSlot()` sets `Availability = placed` on the row being placed; scans all rows for same `Slide_Index` + `Episode_UID` (different row) → sets `Availability = paired`. Drive-fallback new rows also get `Availability = placed`. `dwyp_app.gs`. 🔶 Written, not pushed.

64. **Publish_Spoke_Update_01 — Reel Display_Name editing** — `updateReelDisplayName(rowIndex, newName, fileId, postId)`: writes `Display_Name` to Social_Assets row; renames Drive file via `DriveApp.getFileById(id).setName(newName)`. Falls back to Post_ID scan when rowIndex is -1 (Drive-fallback assets). `dwyp_app.gs`. 🔶 Written, not pushed.

65. **Publish_Spoke_Update_01 — Vertical candidate panel (images)** — Horizontal candidate strip replaced with vertical left panel (`#pbLeftPanel`). Image slots: `#pbCandPanel` renders `.pb-cand-tile.ratio-4-5` tiles (4:5 aspect ratio, Drive thumbnail). Reel slots: `#pbReelBrowser`. `pbSelectSlot()` determines mode (reel vs image) and shows/hides correct panels + workspace areas. `pbRenderCandidates()` renders vertical panel with "Quote Graphics" section header. `dwyp_ui.html`. 🔶 Written, not pushed.

66. **Publish_Spoke_Update_01 — Reel browser panel** — `pbRenderReelBrowser()`: 9:16 aspect ratio tiles, Drive thumbnail, hover-reveal display name. `pbSelectReel()`: loads `<video>` element in 60vh × 9:16 player wrap; shows caption in reel controls panel. `pbUnlockReelName()`: double-click-to-unlock pattern on name overlay; commits via `updateReelDisplayName`, updates in-memory candidate. `dwyp_ui.html`. 🔶 Written, not pushed.

67. **Publish_Spoke_Update_01 — Reel workspace** — `#pbReelArea`: flex-wrap layout with 60vh × 9:16 player + `.pb-reel-controls` (caption area, Regenerate, Notes scratchpad, Add to Week). Wide screen: controls beside player. Narrow screen: controls wrap below. CSS breakpoint via `flex-wrap: wrap; min-width: 180px` — no JS breakpoint detection. `pbAddToSlot()` unified for image and reel modes; reads caption from appropriate element; removes placed candidate from `pb.candidates` on success. `dwyp_ui.html`. 🔶 Written, not pushed.

68. **Platform State update** — `DWYP_Platform_State.md` updated to v4.3. `Publish_Spoke_Update_01.md` incorporated (work complete). `DWYP_Social_Architecture_Redesign_v2.md` added to companion docs. Square deck template note added to Governance Keys. 🔶 Done.

69. **Social Architecture Redesign v3 — Publish image canvas** — Image workflow overhauled. Pre-assembled Artist Fairy slides retired as Publish source. New three-panel layout: week accordion · Hooks & Quotes panel · canvas + background workspace. Fabric.js canvas (360×450, export 1080×1350 PNG). Panel 3 reads hooks/quotes from manifest; falls through to manual text entry if empty. Background sidebar: prompt, Suggestions (manifest image_prompts), Generate (calls `generateBackground()` with `4:5`), Generated (session), Library. Canvas toolbar: Undo/Redo/Center/Logo. Text always `fontStyle: normal`; corner handles = font size; side handles = width; top/bottom disabled. `addToWeekAsImage()` exports canvas PNG and creates Social_Assets row on Add to Week. Reels workflow unchanged. No italics anywhere in Publish tab. `dwyp_app.gs` + `dwyp_ui.html`. 🔶 Written, not pushed.

70. **Platform State update** — `DWYP_Platform_State.md` updated to v4.4. `DWYP_Social_Architecture_Redesign_v3.md` incorporated (supersedes v2). 🔶 Done.

71. **Spoke 3 — Claude API** — `callClaudeAPI()` added to `fairy_circle.js`: Anthropic Messages API, `x-api-key` + `anthropic-version: 2023-06-01`, multi-turn history support, returns text string. `callGeminiImageConversational()` added: history-based image generation, preserves `thoughtSignature`, model governed by `STUDIO_IMAGE_MODEL` key (fallback `gemini-2.5-flash-image`). `callGeminiImageAPI()` removed. 🔶 Written, not pushed.

72. **Spoke 4 — Vert Fairy rewrite** — `vert_fairy.js` fully rewritten. Two-pass pipeline: Pass 1 = show notes via `retrieveVertexRAGContext()` + `generateShowNotesWithClaude()`; Pass 2 = episode index via `generateEpisodeIndex()` + `createEpisodeIndexDoc()`. `cleanHooksWithGemini` → `cleanHooksWithClaude`. Vertex RAG fix: `similarityTopK` moved into `query` object (was incorrectly inside `vertexRagStore`). 🔶 Written, not pushed.

73. **Spoke 5 — Episode Index** — `buildEpisodeIndexPrompt()` structured prompt (EPISODE SUMMARY, GUEST PROFILE, KEY THEMES, HOOKS, QUOTES, IMAGE PROMPTS, CAPTION SEEDS, TRANSCRIPT MAP, REEL DESCRIPTIONS). `createEpisodeIndexDoc()` writes Google Doc to `EPISODE_SEARCH_INDEX_KEY` folder, patches `manifest.episode_index`. `stLoadEpisodeIndex()` in `dwyp_app.js` searches folder by UID in filename, falls back to `manifest.episode_index`. 🔶 Written, not pushed.

74. **Spoke 6 — Studio backend** — `generateWithClaude()` new 5-param signature; `isImageRequest()` keyword heuristic; `saveBackgroundToLibrary()`; `generateBackground()` wired to `callGeminiImageConversational()`. Three publish callers updated to `callClaudeAPI()` directly. 🔶 Written, not pushed.

75. **Spoke 7 — Studio UI wiring** — Session state (`stConversationHistory`, `stImageHistory`, `stRagContext`, `stTokenTotal`). `stSelectEpisode()` fires index load async. `stSendMsg()` + `stAutoOpen()` use new signature. `stAppendImageBubble()` added. Token warning at 50k. 🔶 Written, not pushed.

76. **Spoke 1 — Spring clean** — Dead retired .js files (`safety_fairy.js`, `marcom_fairy.js`, `social_fairy.js`) confirmed already deleted from main branch. All function renames (`STUDIO_SYSTEM_BASE` → `CLAUDE_STUDIO_SYSTEM`, `callStudioLLM` → `generateWithClaude`) and `PUBLISH_LLM_MODE` removal confirmed already done. Quick Caption CSS block (~265 lines of `.qc-*` styles) and stump comment removed from `dwyp_ui.html`. `.iw-*` CSS retained — actively used by Studio canvas toolbar. `dwyp_ui.html`. ✅ Complete.

77. **Asset Enrichment pipeline** — `enrichQuoteAssetsFromTranscript(episodeUid)`: Gemini (`callGeminiTextAnalysis_()`) reads full transcript, line-based `HOOK:`/`QUOTE:` extraction (JSON abandoned — embedded quotes broke parsing), `generateCaptionVariantsBatch_()` single Claude call writes all caption variants in one shot. Idempotent: if any rows exist for episode, skips re-extraction and only backfills missing `Caption_Draft`. `enrichReelsForEpisode(episodeUid)`: scans `Staging/Reels/`, Gemini Files API video upload + analysis (`callGeminiVideoAnalysis_()`, `gemini-2.5-flash`), `generateCaptionVariants_()` per clip, writes `Reel_Summary` + `Caption_Draft` to Asset_Library. Time-guarded at 4.5 min — resumes cleanly on re-run. All 11 episodes fully enriched. `dwyp_app.js`, `dev_tools.js`. 🔶 Written, not pushed.

78. **Reels Surface partial** — Title card field added to reel controls (`#pbReelTitleCard`): click-to-unlock editing, Generate button → `generateReelTitleCard()` (Claude, 5–8 word overlay hook using `Reel_Summary` as context), localStorage per slot. `generateReelTitleCard()` reads AL for context, writes nothing to sheet — editorial reference for Audra in DaVinci. Duplicate `.pb-reel-ws` CSS cleaned up. Full surface redesign per `DWYP_Spoke_Reels_Surface.md` not yet built. `dwyp_app.js`, `dwyp_ui.html`. 🔶 Written, not pushed.

79. **Reel card layout + UX fixes** — CSS Grid `1fr` → `minmax(0,1fr)` on all flex columns (root cause of card overflow: `auto` minimum let long text expand columns beyond allocation). `overflow-x: hidden` on `.pb-reel-card-list` (implicit `overflow-x: auto` from `overflow-y: auto` was causing horizontal scroll). `min-width: 0` on `.pb-reel-card`. Card content + actions columns: `background: var(--surface)` (white); `.pb-reel-content-box:focus-within` → `background: var(--surface-2)` (one shade gray on click). `pbReelThumbError(img)`: hides broken `<img>`, reveals `▶` blank div. `dwyp_ui.html`. 🔶 Written, not pushed.

80. **Publish canvas polish** — Drop shadow `blur: 9` in both `pbToggleShadow` and `stToggleShadow` (~50% reduction from prior value). Attribution textbox in `pbAddTextToCanvas()`: `backgroundColor: 'rgba(0,0,0,0.52)'` (dark chip renders behind text via Fabric.js), `fill: '#FAB016'` (gold), `fontFamily: 'Nunito'`, `fontWeight: '700'` — visually distinct from quote body. `dwyp_ui.html`. 🔶 Written, not pushed.

81. **Write surface fixes** — `stDocClearEmpty()`: removes `.st-doc-empty` placeholder divs; called from `stDocSheet` `oninput`, "Copy to Doc" path, and `stTapChip()` — fixes placeholder persisting after user types or pastes. `isExplicitTextRequest(userMessage)` in `dwyp_app.js`: checks first 200 chars for caption/write/draft keywords; guards `generateWithClaude()` so pasted reel summaries (contain visual language that trips `isImageRequest`) don't misfire into Gemini image path. Try-catch fallback routes to text on image-path failure. `dwyp_ui.html`, `dwyp_app.js`. 🔶 Written, not pushed.

82. **Episode auto-select fix** — `pb._userChoseEpisode` flag: `pbAutoSelectEpisode()` only fires in `stSwitchTab()` when flag is false. Set to true on episode dropdown click and on `showEpisodeReview()` redirect. Fixes Publish tab re-running auto-select on every tab switch after user has made an explicit episode choice. `dwyp_ui.html`. 🔶 Written, not pushed.

83. **Reels Surface — inline card player** — Card layout redesigned from 4-column grid to flex-row: `pb-reel-card-media` left column (115px thumbnail, transitions to 240×427 player) + 3-column info grid (flex:1). Thumbnail fills media column absolutely (`inset:0`). On thumb click: `pbToggleCardPlayer()` closes any open player, adds `.playing` to media div, calls `getReelStreamUrl(fileId)` (GAS: sets Drive file to "anyone with link", returns `uc` URL), caches result on `reel._streamUrl` for instant subsequent taps, then creates a native `<video>` element that fills the container. Close button pauses and removes player. No iframe, no Drive player chrome, no timing workarounds — see Engineering Notes. `dwyp_app.js`, `dwyp_ui.html`. 🔶 Written, not pushed.

84. **Reels Surface — caption and title card Generate buttons** — Caption "Reset" button replaced with "Generate": `pbGenerateCaption()` calls new `generateReelCaption(assetId, episodeUid)` on backend. Backend reads `Reel_Summary` + `Display_Name` from Asset_Library, calls `generateCaptionVariants_()` (same engine as enrichment), writes fresh variants to `Caption_Draft`, clears `Caption_Final`, returns first variant. Title Card button renamed "Regenerate" → "Generate" (label only; `pbRegenCardTc` / `generateReelTitleCard` unchanged). `dwyp_app.js`, `dwyp_ui.html`. 🔶 Written, not pushed.

---

## Patterns observable in this history

A few patterns worth knowing, derived from this 84-item history:

- **Iterative architecture shifts.** Image Workshop → Publish canvas (item 69), Frame.io retired (item 12), Marcom retired (item 15), Studio personas → Claude (items 71-75), Quick Caption retired pending Daily Pulse audio path. The platform has gone through several major architecture pivots; "what we used to do" is often different from "what we do now."

- **GAS/V8 quirks captured.** Items 53 (base64 heap explosion), 58 (apostrophe HTML entity), 79 (CSS grid auto-minimum) document non-obvious technical gotchas that future code should avoid re-discovering.

- **Multi-spoke patterns.** Publish_Spoke_Update_01 (items 62-67) and Spokes 3-7 (items 71-75) show how complex features get built in coordinated multi-file patches.

- **Preservation Mandate examples.** Items 60 (showEpisodeReview retired but stub preserved), 76 (spring clean what was actually safe to remove), 14 (Web app fixes built on existing code) demonstrate the "never thin without explicit decision" rule in practice.

---

*Build Sequence Archive — Items 1-84. Static. Captured May 2026. Successor history lives in current State Build Sequence (item 85+) and the changelog.*
