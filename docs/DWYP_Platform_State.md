# DWYP Operations Platform — Platform State
**Version: 7.3 | June 2026**

**Companion documents:** see `CLAUDE.md` for canonical doc inventory.

> Changelogs v6.1–v6.5 stripped. See git history for session-by-session detail.

---
## Current Position

- **Pipeline:** Tracks A/B/C all shipped. Bridge v2 (May 2026) shipped: compositional prompt assembly, v2.3 HOOK/QUOTE parsing (Slot_Tags + Quality_Score writes), Slide_Index write retired, `_appendCaptionSignoff_` helper (`CAPTION_SIGNOFF` key populated — programmatic sign-off live), Reel Editorial pass (`runReelEditorialPass`). Verified on Derek Peterson (EP-260430-1427).
- **Locked hub decision (2026-05-22): Transcript is the single source of truth for all copy passes.** Track A (Index) and Track B (Show Notes) both read the raw transcript independently via `gatherVertContext`. Neither is downstream of the other. No Vertex/RAG retrieval in either pass. Transcript injected directly.
- **Track A (CP1+CP2 — 2026-05-22):** Truncation cap removed from `buildEpisodeIndexPrompt` (was `.substring(0, 15000)`). Verified on Meenakshi — full arc now spans to Seeds of Wisdom close. AI Search Index block appended after REEL DESCRIPTIONS via `extractPrompt("# AI Search Index")` + `extractPrompt("# Pillars")` + `extractPrompt("# Voice Prohibitions")`, fenced by boundary line (literal extraction / curatorial indexing). **AI Search Index — redesigned and validated (2026-06-04):** section redesigned: Orientation + Location and Defining Arc sections added; Search Keywords cut; cross-episode references removed. Emission bug fixed in `buildEpisodeIndexPrompt` (block was silently absent). Freshness build-stamp added to index header. Anchor uniqueness instruction hardened (uniqueness-first anchor rule in template). Index now emits and has been validated on real episodes. **Open:** full-library rebuild verification (existing indexes pre-date redesign); anchor uniqueness at scale.
- **Track B (CP3 — 2026-05-22):** `runEditorialPass` repointed to transcript. No longer requires index v2 to exist first (dependency removed). `_buildEditorialPassPrompt_` now injects `FINISHED TRANSCRIPT:` instead of `EPISODE INDEX V2:`. Guest brief now sourced from `gatherVertContext` (duplicate Contact Library lookup removed). Verbatim-quote rule is now honest — Claude selects from real words on the page.
- **Reel Editorial — column split wired (2026-06-04); end-to-end test pending.** `runReelEditorialPass` written and pushed. Col-8/col-9 split complete: col 8 (`Reel_Summary`) = Gemini raw — companion grounding only, never displayed; col 9 (`Reel_Summary_Clean`) = Claude editorial — all display + caption surfaces. All write, read, and display sites repointed: `runReelEditorialPass` writes to col 9; `generateReelCaption` reads col 9; reel card render reads col 9 (`—` placeholder when empty); `getSocialAssets` and `getScheduleData` read col 9. Dedup scoring uses either column. `normalizeSummary` helper (collapses `\n\n` → `\n`, trims line-trailing whitespace) applied to both write paths; Gemini prompt updated to instruct against consecutive newlines. **Still needs:** episode with Reel-type Asset_Library rows + `Reel_Summary` populated to run end-to-end. **Parked fast-follow:** backfill button — JT-triggered pass across a guest's reel folder to populate col 9 where missing (hook: call `runReelEditorialPass(epUid)` from UI).
- **`syncReelAssets` + Gemini video analysis (2026-05-22):** `syncReelAssets(epUid, opts)` added to `dwyp_app.js` — creates AL rows for MP4s in Staging/Reels/, runs `callGeminiVideoAnalysis_` per reel (45MB limit; 4.5-min timeout guard; resumes on re-run). `test_syncReelAssets` wrapper in `dev_tools.js`. Tested on Meenakshi — worked (one 3-min clip skipped at size limit, expected).
- **Episode tab (Design) — live (2026-05-26).** Native `<video>` in `stEpView` fed by `getEpisodeStreamUrl` (V4-signed GCS GET URL, bucket `dwyp-review-playback`, path `episodes/{EUID}/proxy.mp4`, 8h expiry). Signing via `iamcredentials.googleapis.com :signBlob` using owner's `ScriptApp.getOAuthToken()`; explicit project-level signBlob grant required — `iam.automaticIamGrantsForDefaultServiceAccounts` org policy is active (AD #122). Governance keys `REVIEW_GCS_BUCKET`, `GCS_SIGNER_SA`, `GCS_EXPIRY_SECONDS` populated. Compose loop functional: focus-pause-freeze-timestamp, Send = optimistic rail append + `submitEpisodeCommentRow` + resume, Cancel = discard + resume. Request Revisions and Approve wired. **Upload affordance (2026-05-26, end-to-end test pending):** `Upload_Produced_Episode` task card renders "Upload Proxy" button → browser-side resumable chunked upload direct to GCS (`getEpisodeUploadUrl` mints a V4-signed POST URL; 5 MB chunks via `Content-Range`; 308 = continue, 200/201 = done). On success `completeUploadEpisode` fires automatically → `Video_Status → review` + `Review_Episode` spawned (loop A folder-watch retired). Self-heal path: if browser died after upload but before completion, re-clicking "Upload Proxy" detects existing proxy via `checkEpisodeProxyExists` and offers to complete without re-uploading. CORS: allow-list pinned to Apps Script `googleusercontent.com` sandbox origin — if origin drifts, preflight fails (AD #122). **Confirmed working 2026-05-26** on a 3-second and a 60-minute+ video. Known behavior (deferred): manually pausing the video before sending a comment produces no timestamp — only focus-triggered pauses stamp a time.
- **Reels sub-tab (Design) — live (2026-05-24, refined 2026-05-25).** Drive `/preview` playback in phone frame. Caption box reads `Caption_Host`; Generate writes caption from `Reel_Summary_Clean` via Claude (`generateReelCaption`). Two verbs: Export (moves reel → `Manual_Exports/`, filename = title slug; paired `.txt`), Request Revision (popup task form → `requestReelRevision` → `Revision_Notes`). Edit with Vids and day-picker removed. `closeReelRevision`: swaps `Drive_File_ID` on AL row by `Asset_ID`, moves old file → `Reels/Superseded/`, completes open `Revise_Reels` task, `bumpVersion` both domains, next Pulse re-spawns `Review_Reels`. **Drive chrome shown** — two-person internal app; crop hack retired. `getReelStreamUrl` returns `/preview` URL (was `uc?id=`). Reel cards: thumbnail left 1/3 (Drive thumbnail API `?sz=w200`), name + full summary right 2/3, no truncation. Modal z-index bug fixed (duplicate `z-index:200` was overriding `400`, hiding modal behind Studio Overlay at z-index 300). Reel revision modal centered with full corner radius.
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
- **Asset surfacing — rankings retired; code cleanup complete (2026-06-05).** JT curates by hand. No `Quality_Score` sort, no auto-surfaced ranked candidates, no slot auto-pairing. `Quality_Score` (col 19) + `Slot_Tags` (col 20) dropped from Asset_Library sheet; `ASSET_LIBRARY_COLS` entries removed; all write paths (`materializeQuoteGraphicAssets`) + read paths (`getRankedAssetLibraryCandidates` deleted) cleaned. **Open Audra hand-step:** Master Template `SLOT_TAGS:` / `QUALITY_SCORE:` emit lines — remove when convenient (benign with cols absent; no code readers remain).
- **Design and Schedule are separate surfaces.**
  - **Design** — compose. Pick hook/quote (images) or reel; author/edit caption; place on canvas; pick background.
  - **Schedule (Spokes 1–3 + 2.1 + 3b complete, 2026-06-05).** Left-rail guest sub-item (peer to Images · Reels · Episode). Pool = AL rows for this episode where `Status='schedule'`; placed assets badged + sunk (`Availability='placed'`). Workspace toggles The Week ↔ Swipe Package. The Week is template-driven from `Posting_Schedule` (no hardcoded days/slots/sentences). Drag from pool → slot places asset; drag slot card → pool or another slot to move or remove. Swipe = per-card rows above always-present drop zone; deduplication enforced. `edit ↗` round-trips to Images (canvas restored via `getAssetDisplayState` + `loadFromJSON`) or Reels (auto-selects rail card). Optimistic UI with server-revert on failure. Send to Schedule on Images: AL upsert at `Status:'schedule'` — no Drive render, no `Drive_File_ID` write. Pool card QG previews: offscreen Fabric bake from `Canvas_State` + `bgCache` (no Drive fetch for QG). Export buttons removed from Images surface (Export + day-picker) and Reels surface. **Export is Schedule-surface only.** **Single Export (2026-06-05):** "export" button on each pool card; `schExportSingle(assetId)` renders full-res PNG client-side (3× multiplier, 1080×1350) and calls `exportSingleScheduleAsset` → `Manual_Exports/Singles/`; reel COPY (archive stays in `Reels/`). Untested. **Export All (2026-06-05, rewritten):** `schExportAll()` renders all placed QG offscreen client-side, passes `imageRenders` map to `exportAllSchedule(episodeUid, imageRenders)` → `Manual_Exports/[Day]/`+`/SWIPE/` (flat, episode-scoped by staging location; no guest wrapper). Gate: `Availability=placed` on AL row. Re-run: day/SWIPE folders cleared; `Singles/` preserved. Reels COPIED (not link-in-text). Untested — needs a full week of placed assets. **Edit return path:** resolved by derivative mode — all three exit triad buttons (Save / Save a Copy / Discard) auto-switch to Schedule on commit.
  - **`Availability` removal rule (confirmed, 2026-06-02):** on week-slot removal, always flip to `'available'`. Binary flag is week-only; double week-placement is discouraged by sink+badge; rule is minimal and accepted.
  - **Ratio column present in `Posting_Schedule` (col 7).** Slot glow currently uses type-only matching (both sides normalize to `'reel'` or `'image'`); `schTypeMatches` is the single edit point if ratio matching is wired.
  - **`Staging/Schedule_Renders/`** — folder may exist in Drive from prior runs; no code writers remain. Flag for manual cleanup (Audra).
  - **Companion scope:** with Schedule separate, the per-asset companion needs only the asset-in-focus — no slot-stack siblings to thread.
- **Performance Foundation:** Phase 1.1–1.5 complete and live in production.
- **Staging retired as workflow.** Code pushes directly to production. Routing helpers preserved in codebase.
- **Governance_Config needs review** — keys should be audited for completeness and stale entries. No blocker, but flag before next feature that adds a governance key.
- **PIN-login-inert recurring bug** — symptom: PIN boxes don't auto-advance, Continue never enables (whole front-end dead). Cause is never the PIN code — it's a JS parse error in the main script block, usually smart/curly quotes in a hand-authored `innerHTML` string from a companion/chat build. Fix at the bad quote, not the PIN handler. Diagnostic: `node -e "new Function(scriptBlockContent)"` per `<script>` block surfaces the dead block fast.
- **Index Audit step — designed, parked.** Inserts between Track A and Track B. Claude builds index from injected transcript → Gemini audits index against Vertex-retrieved corpus chunks (filtered to epUid) → appends `## Audit Findings` section to index doc with severity + location anchor + citation + suggested correction → spawns `Review_Index_Audit` task → HITL gate → next pulse: Claude produces clean revised index, re-reads transcript only if any finding marked CRITICAL → Tracks B/C run against revised index. Architecture role split: Claude generates (synthesis, nuance), Gemini audits (literal, source-checking), Vertex retrieves (corpus-grounded independence from Claude's injected source). Design doc: `DWYP_Index_Audit_Design.md`. **Parked:** corpus confirmed name-keyed, not epUid-keyed (verified 2026-05-19); retrieval workaround: "[guest name]'s episode" queries yield good results; episode-scoped indexing requires corpus re-tag/re-import before audit spoke opens. **Lift shift (May 2026):** `_vertexMarkerQuery_` (the Vertex retrieval helper the audit design planned to reuse) was deleted in the pipeline rewire spoke. Audit spoke must write a new epUid-filtered Vertex retrieval function — not a reuse. Function recoverable from git.
- **Derivative Edit Surface — Spokes A/B/C (2026-06-05, pushed, untested).** `edit ↗` from Schedule enters derivative mode (`st.derivativeMode = true`). Action bar: creation verbs (Schedule / Clear) replaced by exit triad (Save / Save a Copy / Discard). Images: H&Q rail tab hidden; Backgrounds + AI Chat remain; canvas non-attribution text extracted via `imgChatGetCanvasText()` → `Quote_Text`; Save commits same AL row (`Quote_Text` + `Canvas_State` + `Caption_Host`), bumpVersion; Save a Copy appends new unplaced `Status='schedule'` AL row sharing `Episode_UID`/`Asset_Type`/`Display_Name`/`Canvas_State`; Discard client-only. Reels: rail locked to one reel under edit (`stRenderRailReelList` filters to `st.selectedReelId` in derivative mode); Save writes `Quote_Text` (title card) + `Caption_Host` (no `Canvas_State`); Reel Save a Copy shares `Drive_File_ID` (same clip, new AL row with edited title/caption — TikTok vs IG use case); Discard client-only. GAS: `saveDerivativeAsset(assetId, action, canvasJson, captionText, quoteText)` — single endpoint, `action='save'|'save_copy'`, AL-only (no Social_Assets touch), normalizes `Quote_Text` via `normalizeQuoteText`, bumpVersion + Audit_Trail on both paths. Export: `_uniqueFilename(folder, baseName, ext)` helper prevents collision when two AL rows share the same title slug; suffix scheme `-2`, `-3`; applied to `_writeAssetToExportFolder` + `exportSingleScheduleAsset` (paired `.txt` sidecar tracks same suffix). `stSyncDerivativeUI()` reads `st.derivativeMode` + `st.designTab` and shows/hides all action buttons; called at end of `stSelectDesignTab`. **Untested — needs placed week (Images Save/Copy) + reel Save-a-Copy validation across both export paths.**
- **Companion spine + Episode companion — Pass 1 of 4 (2026-06-03).** Reusable companion architecture built and wired to Episode surface. **GAS (`dwyp_app.js`):** `companionChat(surface, episodeUid, history, userMessage, workspaceState)` — single entry point for all four surfaces; `_companionBuildSystem` assembles system instruction from `extractPrompt("# Companion Voice")` + `# Show Philosophy` + `# Pillars` + full episode transcript (via `stLoadEpisodeIndex`; transcript injected into system instruction each call, history stays clean); `_companionBuildUserPrompt` prepends show-notes text as per-turn workspace context with anti-self-eating guard. Reels/Schedule are explicit stubs (`// Pass 3/4`). Voice comes from template — `CLAUDE_STUDIO_SYSTEM` / `STUDIO_MODE_INSTRUCTIONS` untouched (zero-caller, janitorial pass after all four companions built). **Client (`dwyp_ui.html`):** `epChat` state (history, loading, uid); `#stEpChatPane` wired with scrollable history, textarea (Enter=send, Shift+Enter=newline), Send button; `epChatReset` called on every episode switch; `epChatMarkdown` inline renderer; workspace state = `#stEpShowNotesBox.innerText`. **Master Template:** `# Companion Voice` section added (Audra, 2026-06-03). **Workspace-state contract locked** (fits all four surfaces without spine changes): `{ showNotesText }` → Episode; `{ activeAssetText }` → Images; `{ titleCardText, captionText }` → Reels; `{ placedAssets }` → Schedule. **Episode companion validated.**
- **Images companion — Pass 2 of 4 (2026-06-04).** `images` case filled in `_companionBuildSystem` and `_companionBuildUserPrompt` — no spine changes. System instruction: full transcript (verbatim-quote discipline), do-not-repeat pool from `getEpisodeHooksAndQuotes` (exclusion list, server-side pull), canvas-awareness + iteration-on-variation instruction. Per-turn workspace: `activeAssetText` from canvas `_isText` objects (sent on every send). Client: `#stImgChatPane` pane wired; `stSetRailTab` extended to handle `'chat'`; `imgChat` state (history, loading, uid); `imgChatReset` called on episode switch; reuses `ep-chat-*` CSS. History is per-episode (not per-asset). **Mostly validated. Attribution wrinkle:** companion may include attribution line in quote output — requires human judgment on whether to use. No code fix; (resolved 2026-06-05, see Companion Voice sweep).
- **Reels companion — Pass 3 of 4 (2026-06-05).** `reels` case filled in `_companionBuildSystem` and `_companionBuildUserPrompt` — no spine changes. System instruction: full transcript (verbatim-quote discipline), refine-first posture (default to sharpening the title card and caption JT already has; produce net-new options only on explicit request), stay-on-surface guard. Per-turn workspace: `{ titleCardText, captionText }` from `stTitleCardField` + `stCaptionField` DOM nodes (sent on every send; anti-self-eating guard). Client: `stReelBrowser` restructured to tab-bar model (Reels | AI Chat) via `stSetReelRailTab`; `#stReelChatPane` created; `reelChat` state (history, loading, uid); `reelChatReset` called on episode switch; reuses `ep-chat-*` CSS. History is per-episode (not per-reel). **Pending validation.**
- **Schedule companion — Pass 4 of 4 (2026-06-05).** `schedule` case filled in `_companionBuildSystem` and `_companionBuildUserPrompt` — no spine changes. **THE FIREWALL:** `stLoadEpisodeIndex` is deliberately NOT called in the schedule case — companion has no transcript, forcing audience-shaped judgment. System instruction: social-media strategist role, firewall stated in prose (belt-and-suspenders), advise-first posture (assess the week JT has, no unprompted strategy), stay-on-surface guard (arrangement only; copy work redirected to Images/Reels), slot-intent literacy (template `why` as slot goal; ad-hoc slots respected from craft), source-awareness (cite trends cache if present, else flag as general). Per-turn workspace: `{ placedAssets, unplacedPool }` assembled client-side by `schedChatBuildWorkspace()` from live `sch.placements` × `sch.candidates` × `sch.days` — no new GAS round-trip. Each placed item carries: slot identity (day/platform/slotId), slot intent (`why`) or `adHoc:true`, asset type, surface text (captionHost / quoteText / reelSummary per type), placement status (week vs. swipe). Unplaced pool items also included. Anti-self-eating: workspace is live week state only. Client: `stSchedulePool` restructured to tab-bar model (Candidates | AI Chat) via `schSetRailTab`; `#schedChatPane` created; `schedChat` state (history, loading, uid); `schedChatReset` called on episode switch; reuses `ep-chat-*` CSS. History is per-episode. **Pending validation (needs placed week).**
- **Companion Recon + Teardown (2026-06-03).** All Publish-era and orphaned companion/chat plumbing removed from `dwyp_app.js` and `dwyp_ui.html`. **GAS deleted:** `generateWithClaude`, `isImageRequest`, `isExplicitTextRequest`, `callPublishLLM`, `generateReelTitleCard`, `getOrGenerateReelSummary`, `ensureReelSummaries`, `assembleSlotForegroundContext`. **Kept for build:** `stLoadEpisodeIndex` (full-transcript loader, now wired into companion spine); `CLAUDE_STUDIO_SYSTEM` + `STUDIO_MODE_INSTRUCTIONS` (zero-caller — janitorial pass after all four companions built). **HTML shells:** Images AI Chat button gutted (`onclick` removed), ID preserved as build target (`#stRailTabChatImg`). Reels AI Chat fully wired (Pass 3). Schedule AI Chat fully wired (Pass 4). **CSS removed:** `.sv-*` Social Vert block, `.st-chat-col`, `.st-chat-brand-*`, `.st-chat-hist`, `.st-chat-header*`, `.st-chat-input*`, `.st-reels-fields`. **Asset_Library schema — `Image_Prompt` (col 9) renamed `Reel_Summary_Clean`** in `ASSET_LIBRARY_COLS` map (`dwyp_app.js:136`) + both blank-init sites in `vert_fairy.js`. Sheet header col 9 renamed (Audra hand-edit, complete). See Reel Editorial bullet above for the active col-8 overwrite blocker.
- **Pulse content chain wiring — verified (2026-06-03).** `buildEpisodeIndexV2` confirmed reachable via `in_production` branch of `dailyPulse()` → `_pulse_contentChain` (`fairy_circle.js:2011 → 2131`). Idempotency gate: two-layer — manifest field check in chain (`!manifest.episode_index_v2`, `fairy_circle.js:2124`) + Drive file-presence verification inside `buildEpisodeIndexV2` (`vert_fairy.js:327-351`; self-repairs dangling pointer). `PULSE_CONTENT_ENABLED` independently confirmed `FALSE` in live config — chain dark. Throttle: `PULSE_HEAVY_PASS_BUDGET = 2` per pulse run. **Template precondition before bringing Track A online:** redesigned `# AI Search Index` section must be pasted into Master Template before `PULSE_CONTENT_ENABLED → TRUE`.
- **Track A "extract-not-interpret" posture — code-level implementation shipped (May 2026).** `buildEpisodeIndexPrompt` enforces: speakers' interpretations belong in the index; auditor interpretations do not; no attribution of intent, motivation, or causation beyond speaker's own words. Synthesis happens downstream in B/C. Sections: EPISODE SUMMARY / GUEST PROFILE / KEY THEMES / CAPTION SEEDS / TRANSCRIPT MAP / REEL DESCRIPTIONS.
- **Track A/B/C Pipeline Rewire — complete (May 2026).** `buildEpisodeIndexV2` now Claude-based: reads injected raw transcript directly, no Vertex RAG. `runVertFairy` retired. Loop D rewired to two-condition logic: `episode_index_v2` absent → Track A (`buildEpisodeIndexV2`); `episode_index_v2` set + `show_notes` absent → Track B (`runEditorialPass`). At most one pipeline step per pulse run. `runVertFairyForEpisode` in `dwyp_app.gs` repointed to `buildEpisodeIndexV2` (Fairy Remote Control button remains live).
- **Design Surface fixes (May 2026):** Right rail — `#stBgPane` CSS override (`flex-direction:column; padding:0; overflow:hidden`) so Upload/Generate stack at top and bg pool scrolls below. Attribution canvas — `stDropText` rewritten to place quote and attribution as two independent Fabric.js `Textbox` objects (`_textType:'quote'` at `ch/2 - 40`, `originY:'bottom'`; `_textType:'attribution'` at `ch/2 + 40`, `originY:'top'`). Attribution box removed if `isHook` or no `st.guestName`.
- **dev_tools.js cleanup (May 2026):** `ACTIVE_EP_UID` constant at top — single paste point for all test wrappers. Vestigial functions removed: Phase 1.2–1.3 full test suite (8 functions), all `setup_*` / `migrate_*` one-time functions, diagnostic + smoke tests, `test_runReelEditorialPass_force` (merged into parameterized `test_runReelEditorialPass(force)`). Track A comment corrected to reflect Claude intent.
- **Companion Voice template sweep — complete (2026-06-05).** Three `# Companion Voice` additions authored (voice thread) and pasted into Master Template, replacing the prior section wholesale. (1) Surface-ownership clause in the firewall: companion produces copy its own surface owns; redirects copy belonging to another surface by packaging a clickable instruction that round-trips to the owning surface (not a draft — diagnosis crosses, copy doesn't). (2) Misattribution guard: a line that might be someone else's words renders as an unattributed hook, not an attributed quote; phrased as posture-toward-doubt so it holds for both transcript-grounded (Episode/Images/Reels) and transcript-firewalled (Schedule) companions. (3) Schedule Strategist register added (fourth register): transcript-firewalled by design (judges standalone audience resonance), authority order performance-data > trends-cache > general-craft, companion names its source. Authority order reads correctly with performance-data absent today (degrades to trends/craft) and absorbs analytics when wired.
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
- **Tabs:** Contacts, Tasks, Episodes, Episode_Log, Asset_Library, Social_Assets, Audit_Trail, Versions, Governance_Config, Posting_Schedule, Reference, User_Registry, Social_Posts

---

## Staging Environment — Locked Architecture

The platform runs on a two-deployment model. One script project, two master sheets, deployment-aware routing.

**Operational change (May 2026 hub):** Staging-first cadence retired. Code pushes directly to production going forward. Staging sheet (`13bXMjxEf…`) remains available but is no longer maintained in sync. Routing helpers and architecture remain in place under the Code Integrity Mandate (see `CLAUDE.md`).

**Deployment workflow (June 2026):** GAS (clasp push) and GitHub are deployed simultaneously. There is no longer a separate "clasp re-auth pending" step — they go together.

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
| `fairy_circle.gs` | ✅ Pushed | **Janitorial (2026-06-05):** THE SCRIBE section deleted — `draftPhaseEmail` + `scribeWriteAndDraft` removed (zero callers; Scribe Fairy retired AD #111). `BRAND_VOICE_ID` key untouched — still live in Herald. `getBodyTextSkippingHeadings` also removed (janitorial Item 2 — sole caller `buildPlaceholderMap` in artist_fairy already gone). | **SPOKE_Orchestrator_Pulse (2026-06-01):** `dailyPulse()` rewritten as single state-driven orchestrator. Old loop stack (Loops 1/2/3/B/C/D) replaced. Stage 0: `checkCalendarForInterviews()`. Stage 1 (`upcoming`): `_pulse_recordingReminders` + transcript watch → `patchEpisodes({Status:"in_production"})` + chain. Stage 2 (`in_production`): `_pulse_contentChain` (A→B→C, chained-within-pulse, per-stage try/catch + error task); `_pulse_reelChain` (syncReelAssets → runReelEditorialPass). Stage 3 (`review`): `_pulse_releaseReminders` + `_pulse_finalVideoDetect` backup (calls `completeFinalEpisodeUpload(epUid)` — no rowIndex). Stages 4/5/6: no-op / stub. Loops 3 + B deleted outright (Safety Fairy retired; images untracked). Helper functions: `_pulse_detectTranscript`, `_pulse_contentChain`, `_pulse_reelChain`, `_pulse_spawnErrorTask`, `_pulse_recordingReminders`, `_pulse_releaseReminders`. **SPOKE_Tasks_1:** All 6 active dailyPulse loop skips: `complete`→`archived`. Loop D: `patchEpisodes(epUid, { Status: "in_production" })` fires on transcript detect (idempotent). **Loop 1 rewritten:** D-1 detection, date-aware task titles, spawns two tasks (HOST + PRODUCER). All other loops unchanged. **Null guard:** `callGeminiAPINoSearch` only sets `payload.systemInstruction` when non-null. **Spoke 3:** `callClaudeAPI(prompt, systemInstruction, callerName, history, options)` added — Anthropic Messages API. `callGeminiImageConversational(prompt, imageHistory, sourceImageBase64, sourceMimeType)` added. `callGeminiImageAPI()` removed. **Staging routing:** `isStaging()` and `getMasterSheetId()` helpers locked architectural pattern. **Phase 1.2–1.3:** `bumpVersion()` with LockService + audit_trail recursion guard. 8 write paths retrofitted. `spawnTask()`/`updateTaskStatus()` get `suppressBump` param. `dailyPulse()` bumps tasks + episodes once per run at end. Staged + verified. **Reels Surface spoke (2026-05-24):** `spawnTask()` — `Asset_ID` field added to `fields` object; written header-driven to Tasks col 17. **Revision Flow spoke (2026-05-24):** `appendEpisodeLog` writes 10-element row (`Revision_Round` as element 10). `spawnTask()` reads `revisionNotes` from taskConfig — fixes blank-instruction bug on all revision tasks. **Team assignee spoke (2026-06-01):** `_pulse_recordingReminders` and `_pulse_releaseReminders` — paired HOST + PRODUCER spawns collapsed to single spawn with `assignee: "team"`. One task row per reminder instead of two. |
| `secretary_fairy.gs` | ✅ Pushed | **SPOKE_Tasks_1:** `createEpisodeRecord()` init: `Status:"upcoming"` (was `"active"`). Calendar handler: `!== "archived"` (was `!== "complete"`). Recording Reminder spawn removed. Calendar scan switched to `Calendar.Events.list()` Advanced Service. `wrapCalendarApiEvent()` adapter. `Utilities.sleep(3000)` between events. **Phase 1.3:** `updateLastActivity()` + `createContactStub()` bump contacts. Staged + verified. |
| `vert_fairy.gs` | ✅ Pushed | **Janitorial (2026-06-05):** Quality_Score + Slot_Tags write lines removed from `materializeQuoteGraphicAssets` (4 writes: hookRow + quoteRow). `runReelEditorialPass` stale skip-guard comment cleaned. | **Spoke 4 + 5:** Major rewrite. Two-pass pipeline. `MODEL_NAME` removed; `CLAUDE_MODEL`, `CLAUDE_API_KEY`, `EPISODE_SEARCH_INDEX_KEY` added. Pure Vertex RAG retrieval; Claude generation via `callClaudeAPI()`. Hook cleaning moved from Gemini to Claude. Pass 2 episode index doc creation. **Track B (May 2026):** `runEditorialPass` + `_buildEditorialPassSystemInstruction_` + `_buildEditorialPassPrompt_`. **Track C (May 2026):** `_bridgeSliceSection_` + `_bridgeParseLabeledCaptions_` + `materializeQuoteGraphicAssets`. Bridge agent writes 16 Asset_Library rows (10 hooks + 6 guest quotes). **Bridge v2 (May 2026):** `runEditorialPass` prompt now compositional — three `extractPrompt` calls (`# Voice Prohibitions`, `# Ranking Schema`, `# Show Notes`). `_bridgeSliceSection_` — em/en/horizontal bar dash normalization (never again fails on Unicode dash variants). `_bridgeParseLabeledCaptions_` — inline caption text fix (captures text on label line, not only body). `_bridgeParseRankedItems_` — new helper, parses v2.3 `HOOK N:` / `QUOTE N:` blocks with inline `SLOT_TAGS:` + `QUALITY_SCORE:` lines; defensive: unrecognized tags → Any, missing score → 3, out-of-range clamped, all anomalies logged. `_appendCaptionSignoff_` — new helper, reads `CAPTION_SIGNOFF` governance key, idempotent (no double-append), applied to all `Caption_Draft` writes in `materializeQuoteGraphicAssets`. `materializeQuoteGraphicAssets` write path: `Slot_Tags` + `Quality_Score` populated from parsed items; `Slide_Index` write retired (commented with dated note). **Reel Editorial (May 2026):** `runReelEditorialPass(epUid, {force=false})` — composes same three template sections, batches all reels in one Claude call, writes cleaned `Reel_Summary` + `Slot_Tags` + `Quality_Score` back per row; idempotent (skips already-scored unless `force:true`). `_parseReelEditorialOutput_` — same defensive parsing as bridge. Test pending (needs episode with Reel-type AL rows with `Reel_Summary` populated). **Pipeline Rewire (May 2026):** `runVertFairy` + all show-notes pipeline functions retired (deleted): `queryVertexShowNotes`, `generateShowNotesWithClaude`, `cleanHooksWithClaude`, `buildShowNotesSystemInstruction`, `buildShowNotesPrompt`, `generateEpisodeIndex`, `createEpisodeIndexDoc`, `createShowNotesDoc`, `writeShowNotesDoc`. Vertex helpers deleted: `_vertexMarkerQuery_`, `_parseTimestamp_`, `_parseTimestampSecs_`, `_parseSpeaker_`, `_extractFirstSentence_`, `_estimateTokens_`, `retrieveVertexRAGContext`. `EPISODE_INDEX_V2_MARKERS` constant deleted. `testRunVertFairy` test wrapper deleted. `buildEpisodeIndexV2` rewritten: Claude reads injected raw transcript via `gatherVertContext`, calls `callClaudeAPI`, writes `.md` file to `EPISODE_SEARCH_INDEX_KEY` folder, patches `manifest.episode_index_v2`. `buildEpisodeIndexPrompt` rewritten: knowledge-only (no HOOKS/QUOTES/IMAGE PROMPTS), extract-not-interpret posture, six sections. `gatherVertContext` and `findTranscriptInFolder` kept (used by new `buildEpisodeIndexV2`). **Transcript-as-source rewire (2026-05-22):** `buildEpisodeIndexPrompt` — truncation cap (`.substring(0, 15000)`) removed; full transcript now reaches Claude. AI Search Index block appended after REEL DESCRIPTIONS: `extractPrompt("# AI Search Index")` + `extractPrompt("# Pillars")` + `extractPrompt("# Voice Prohibitions")` composed + fenced by boundary line (literal extraction / curatorial indexing); silently omitted if sections missing. `gatherVertContext` — third fallback added: Raw Production folder via `manifest.raw_folder_id` (lookup order: Episode/ → Staging root → Raw Production). `runEditorialPass` — index v2 dependency removed (Track B now independent of Track A); transcript + guest brief loaded via `gatherVertContext`; duplicate Contact Library guest brief lookup removed. `_buildEditorialPassPrompt_` — `episodeIndexV2Text` → `transcriptText`; label `EPISODE INDEX V2:` → `FINISHED TRANSCRIPT:`; "reading a curated index" framing → "quotes must be verbatim from the page." |
| `herald_fairy.gs` | ✅ Pushed | **SPOKE_Tasks_1:** Prior-episode filter: `ready_to_release` OR `archived` counts as a prior appearance (was `complete` only). Fix 20: thin-data hard-stop. checkGuestIdentity() helper. Pending path live. Corrupt guard + task spawn on catches. Guest Brief two-step. spawnGuestBriefReviewForJT() exported. **Phase 1.3:** 4 write paths bump contacts. Staged + verified. |
| `artist_fairy.gs` | ✅ Pushed | `exportSlidesToPng()` — sole survivor; called from Track C / pulse (dev_tools.js Stage 5). **Janitorial (2026-06-05):** All dead helpers removed: `buildPlaceholderMap`, `resolveGuestHeadshotBlob`, `resolveHostHeadshotBlob`, `populateSlideDeck`, `processSlide`, `processGroup`, `replaceTextPlaceholders`. File header and stale section comments cleaned up. |
| `filing_fairy.gs` | ✅ Saved | spawnTask() normalization. Dead writes removed. Post-filing tasks: Studio Assets Ready (JT, rename pending Spoke 1) + Produce Episode (Audra). Corpus deposit to `CORPUS_DRIVE_FOLDER_ID`. Direct `ragFiles:import` commented out — us-south1 unsupported. |
| `housekeeping.gs` | ✅ Pushed | **SPOKE_Tasks_1:** Loop filter: processes `in_production` + `ready_to_release` only (was `active`). `upcoming` excluded — no transcript to parse. parsePipelineBlock(epUid): per-section idempotency. Corpus sync section commented out — us-south1 regional API unavailability. `test_syncCorpusFolder()` stubbed. |
| `clerk_fairy.gs` | 🔴 Rebuild queued | Owns doPost(). **Janitorial (2026-06-05):** Dead `invite → scribeLetSchedule()` route removed — `scribeLetSchedule` never existed; any `invite` POST was throwing ReferenceError. doPost() now returns a logged "no active routes" error for all payload types. Clerk rebuild still queued (AD #24). |
| `dev_tools.gs` | ✅ Pushed | `ACTIVE_EP_UID` = `EP-260430-1458` (Mai). **SPOKE_Orchestrator_Pulse (2026-06-01):** Rewritten in lifecycle order: DIAGNOSTICS (`test_checkTokenScopes`, `test_checkSignerSa`); STAGE 0 (`test_checkCalendarForInterviews`); STAGE 1 (`test_buildEpisodeIndexV2`); STAGE 2 (`test_runEditorialPass`); STAGE 3 (`test_materializeQuoteGraphicAssets`); STAGE 4 (`test_syncReelAssets`, `test_runReelEditorialPass`); STAGE 5 (`test_exportSlidesToPng`); STAGE 6 (`test_spawnUploadEpisodeTask`); REELS REVISION (`test_closeReelRevision`); SYSTEM-LEVEL (`test_dailyPulse`); MAINTENANCE (`test_repairStagingSubfolders`, `test_runFilingFairy`, `test_archiveLiveEpisodes`). `test_artistFairy` deleted (runArtistFairy retired). |
| `dwyp_app.gs` | ✅ Pushed | **Janitorial (2026-06-05):** `Display_Text: 21` removed from `ASSET_LIBRARY_COLS` (phantom col — sheet is 20 cols); col-21 write removed from `saveAssetDraft`; `display_text` field removed from `getAssetDisplayState` return; `_displayText` reference in `getRankedAssetLibraryCandidates` nulled. Dead Publish-era functions deleted: `placeAssetInSlot`, `rescheduleAsset`, `scheduleReel`, plus their sole-consumer helpers `getOrCreateApprovedFolder`, `buildApprovedFilename`, `writeApprovedAsset`. **Janitorial Item 2 complete (2026-06-05):** `Quality_Score`/`Slot_Tags` entries removed from `ASSET_LIBRARY_COLS`; 4 empty-string writes removed from `materializeQuoteGraphicAssets`; `getRankedAssetLibraryCandidates` deleted (zero callers). Open Audra hand-step: remove `SLOT_TAGS:`/`QUALITY_SCORE:` emit lines from Master Template. | **SPOKE_4 (2026-06-05):** `saveDerivativeAsset(assetId, action, canvasJson, captionText, quoteText)` added — `action='save'` overwrites same AL row (`Quote_Text`, `Canvas_State`, `Caption_Host`); `action='save_copy'` appends new AL row (`Status='schedule'`, `Availability='available'`, shares `Drive_File_ID`); AL-only, no Social_Assets touch; bumpVersion + Audit_Trail. `_uniqueFilename(folder, baseName, ext)` helper added — collision-safe export filenames; suffix `-2`/`-3`; applied to `_writeAssetToExportFolder` + `exportSingleScheduleAsset` (reel and image paths; paired `.txt` sidecar follows same suffix). | **SPOKE_2.1+3b (2026-06-05):** `addToWeekAsImage` deleted (legacy Publish canvas path; was the only `"scheduled"` enum write source). `exportAssetToDrive` + `exportReelToDrive` deleted (internals relocated to Schedule export path). `exportSingleScheduleAsset(episodeUid, assetId, base64Png)` added — QG: writes client-rendered PNG to `Manual_Exports/Singles/` + `.txt` (Caption_Host); reel: COPY Drive file to `Singles/` + `.txt`; no Status/Availability changes. `exportAllSchedule(episodeUid, imageRenders)` rewritten — accepts `imageRenders` map from client; gate `Availability=placed` on AL row; flat `Manual_Exports/[Day]/`+`/SWIPE/` structure (no guest wrapper); day/SWIPE cleared on re-run, `Singles/` preserved; reels COPIED. `_writeAssetToExportFolder` updated (new `base64Png` param; reel COPY instead of link-only). `closeReelRevision` stale Loop C docstring corrected (Loop C confirmed deleted AD #93). Vestigial `"scheduled"` writes (`placeAssetInSlot`, `scheduleReel`, `rescheduleAsset`) deleted in janitorial spoke 2026-06-05. | **SPOKE_Schedule_1 (2026-06-02):** Three new GAS endpoints. `getScheduleData(episodeUid)` — single round-trip: AL candidates (`Status='schedule'`), Posting_Schedule week structure (days/slots/why), Social_Assets placements for the episode. `placeAssetSchedule(episodeUid, assetId, slotId, caption)` — appends SA row; week slot sets `AL.Availability='placed'`; swipe slot skips Availability. `removeAssetFromSchedule(episodeUid, assetId, slotId)` — deletes first matching SA row (assetId+slotId+epUid); week slot flips `AL.Availability='available'`. All three call `bumpVersion('social_assets', ...)`. **SPOKE_Schedule_3 (2026-06-02):** `exportAllSchedule(episodeUid)` — reads SA placements for episode, partitions day-slots vs. SWIPE, resolves AL rows, builds `Staging/[GuestName]/` folder tree (only non-empty day folders + SWIPE if needed), copies image PNGs via `makeCopy` + writes matching `.txt` (Caption_Host), writes reel `.txt` (Display_Name + caption + Drive link). Re-run: clear-and-rebuild (trash + recreate guest folder). Caption selection: image always Caption_Host; reel Caption_Host for week, Caption_Guest for SWIPE. Helper: `_writeAssetToExportFolder(al, folder, isSwipe)`. Sanitizer: `_safeFilename(name)`. **Untested — push pending clasp re-auth.** | **SPOKE_Tasks_1:** `getEpisodes()` + `getActiveEpisodes()`: filter `archived` (was `complete`). `triggerReadyForRelease()`: `patchEpisodes(episodeUid, { Status: "ready_to_release" })` added before Filing task spawn. `EPISODES_COLS`: `Frameio_Project_ID` (col 15) + `Guest_Package_URL` (col 16) retired. **Episode Upload spoke (2026-05-26):** `_signV4(method, objectPath, expirySec, bucket, signerSa, extraHeaders)` — shared V4 signing helper; signs via `iamcredentials.googleapis.com :signBlob` (not `iam.googleapis.com`); `payload` field in request body (iamcredentials schema). `getEpisodeStreamUrl` refactored to use `_signV4`. `getEpisodeUploadUrl(episodeUid)` — mints V4 POST signed URL for resumable upload initiation; `x-goog-resumable:start` in signed headers. `checkEpisodeProxyExists(episodeUid)` — GCS JSON API HEAD/GET metadata check using owner OAuth token; returns `{exists:true|false}`. Also in this session: removed stale `Logger.log(JSON.stringify(tasks))` + misindented `return tasks` from `getTasks()`. | **Pipeline Rewire (May 2026):** `runVertFairyForEpisode` repointed to `buildEpisodeIndexV2` — function name preserved (Fairy Remote Control UI button calls it by name). `SOCIAL_ASSETS_COLS` 20-column map. Availability filter. Drive-fallback. Slide pairing. Reel Display_Name. v3 Publish image canvas + Hooks/Quotes. Spoke 6 `generateWithClaude()` 5-param signature. `isImageRequest()`/`isExplicitTextRequest()` heuristics. `saveBackgroundToLibrary()`. `stLoadEpisodeIndex()`. Asset enrichment functions. Reels Surface caption/title card Generate buttons. **Phase 1.2–1.3:** `getAllVersions()`, `getDomainVersion()` endpoints. 22 write paths retrofitted. `_resolveImageLibraryVersion()` corrected to scan file timestamps. Staged + verified. **Item 92 Phase 1 (May 2026):** `_parseCaptionDraft_(raw)` — defensive parse for Caption_Draft (handles JSON-stringified array from Gemini pre-pass output; picks parsed[0] if array). `getRankedAssetLibraryCandidates(episodeUid, assetType, slotId)` — **[vestigial — rankings retired; see Current Position]** server-side ranked read: Reel delegates to `getReelsForEpisode()`; image types filter Episode_UID + Asset_Type + Availability='available', rank by tag-match (slotId in Slot_Tags) then Quality_Score DESC then Created_At ASC (null QS = 0), return top 6. `assembleSlotForegroundContext(activeAssetId, activeAssetType, episodeUid)` — written, not yet wired (Phase 4); returns {active_card, same_date_siblings (cap 4, SIBLING_CAP hardcoded — OQ-D), episode}. `getPrecompBgImages()` — reads PRECOMP_BACKGROUND_LIBRARY_ID folder; returns {fileId, name, textColor, thumbnailUrl}; textColor from `_darktext`/`_lighttext` filename suffix (#1a1714 / #ffffff); sorted by filename; limit 60. `ASSET_LIBRARY_COLS` updated: col 19 = Quality_Score (vestigial-ranking), col 20 = Slot_Tags (vestigial-ranking); written by pipeline execution (`materializeQuoteGraphicAssets`, `runReelEditorialPass`) — no active midnight ranking pass under rankings-retired model. See Current Position. **Item 92 Phase 2 (May 2026):** `exportAssetToDrive(episodeUid, slotId, assetId, b64, canvasJson)` — resolves episode working folder, creates `Manual_Exports/` subfolder, writes PNG blob as `{slotId}_{assetId}_{YYYYMMDD-HHMM}.png` (JT_TIMEZONE), writes Canvas_State to AL row, logs `MANUAL_EXPORT` to Audit_Trail, returns `{url, filename, folderUrl}`. **Spoke 0 — Caption Consolidation (May 2026):** `ASSET_LIBRARY_COLS` keys renamed: `Caption_Draft` → `Caption_Host` (col 10), `Caption_Final` → `Caption_Guest` (col 11). All read/write paths updated. Enrichment generators (`generatePublishCaption`, `generateReelCaption`, `enrichQuoteAssetsFromTranscript`, `enrichReelsForEpisode`, `generateCaptionVariants_`, `callGeminiVideoAnalysis_`, `callGeminiTextAnalysis_`, `generateCaptionVariantsBatch_`) and `_parseCaptionDraft_` retired. Vert Fairy guard: `Canvas_State === ''` alone (Caption_Host removed — always set by system on row creation). **Design Sprint (May 2026):** `exportAssetToDrive` extended: `day` param adds day prefix (e.g. `MON_`) to filename; `canvasText` + `caption` params write paired `.txt` companion blob to `Manual_Exports/`. `exportReelToDrive(episodeUid, day, reelAssetId, titleText, caption)` added — resolves Drive file ID from Asset_Library (ASSET_LIBRARY_COLS.Drive_File_ID col 4), copies reel with day prefix to `Manual_Exports/`, writes paired `.txt` (titleText + caption), logs `REEL_EXPORT` to Audit_Trail. **2026-05-22 session:** `callGeminiVideoAnalysis_(driveFileId, prompt, apiKey)` restored — resumable upload to Gemini Files API, polls until ACTIVE, generateContent, DELETE temp file; 45MB size limit guard. `syncReelAssets(epUid, opts)` added — scans Staging/Reels/ (Approved/ first, then root) for MP4s, creates AL rows for unregistered files (Asset_ID = UUID, Status = candidate, Availability = available), runs `callGeminiVideoAnalysis_` per row; 4.5-min timeout guard (re-run picks up where it left off); `bumpVersion` + `logToAuditTrail` on completion. `stLoadEpisodeIndex()` rewritten — primary path: `gatherVertContext(episodeUid, "Studio")` → returns `transcriptText` (full transcript, same three-tier lookup as Track A/B); fallback: `manifest.episode_index_v2` blob read. Companion now grounded in full transcript. `STUDIO_MODE_INSTRUCTIONS.images` — `[[PROMPT: ...]]` instruction and `PROMPT —` definition removed. **Reels Surface spoke (2026-05-24):** `TASKS_COLS.Asset_ID: 17` added. `getTasks()` returns `Asset_ID`. `createTask()` writes 17-col row. `exportReelToDrive` changed copy→move. New: `generateReelCaption(assetId)` (reads `Reel_Summary`, calls Claude with `# Caption Mechanics` + `# Voice Prohibitions` system prompt, writes `Caption_Host`); `spawnReelEditTask(epUid, assetId, type)` (spawns `Revise_Reels`/`edit_vids` task with `Asset_ID` FK); `requestReelRevision(epUid, assetId)` (completes `Review_Reels`, spawns `Revise_Reels`); `closeReelRevision(epUid, assetId, newDriveFileId)` (swaps `Drive_File_ID` on AL row by `Asset_ID`, moves old → `Reels/Superseded/`, completes `Revise_Reels`, `bumpVersion` both domains). **2026-05-25 session:** `exportReelToDrive` — filename now uses title slug (sanitized `titleText`, max 120 chars) instead of day prefix + timestamp; day param removed. `getReelStreamUrl` — returns `/preview` URL (`https://drive.google.com/file/d/{fileId}/preview`); was `uc?id=`. | **SPOKE_Tasks_2 + SPOKE_Tasks_3:** No dwyp_app.gs changes (UI-only). **SPOKE_Episode_Tasks_1 (2026-05-31):** `EPISODES_COLS.Images_Status` renamed to `Final_Episode_ID` (col 12). `getEpisodes()` return field renamed to match. `spawnReelEditTask` adds `Drive_File_ID` lookup from Asset_Library; writes `payloadLink` (Drive file URL) to Revise_Reels spawn. New `approveEpisodeForRelease(episodeUid)` — calls `writeVideoStatus(approved)` then idempotently spawns `Upload_Final_Episode` task; replaces `writeVideoStatus` as the UI endpoint. New `completeFinalEpisodeUpload(episodeUid, rowIndex)` — scans `Staging/Episode/` for exactly one file, writes Drive ID to `Final_Episode_ID`, calls `patchEpisodes({Status:"ready_to_release",...})`, closes open Review_ tasks defensively, spawns Filing + Release tasks (Release idempotent), bumps versions, logs audit trail. New `completeReelRevision(episodeUid, assetId)` — scans `Reels/` root for any file whose Drive ID differs from the AL row current `Drive_File_ID`; expects exactly one new file; delegates to `closeReelRevision`. RFR cleanup complete (2026-05-31): `triggerReadyForRelease`, `checkReadyForRelease`, RFR modal, `.btn-ready-for-release` CSS deleted. **SPOKE_Orchestrator_Pulse (2026-06-01):** `completeUploadEpisode` — adds `patchEpisodes(episodeUid, { Status: 'review' })` after `Video_Status → review` write (same trigger, one added write: proxy-receipt now flips both Video_Status and Episode.Status). `completeFinalEpisodeUpload(episodeUid, rowIndex)` — `rowIndex` now optional; when absent (pulse backup path), scans Tasks for open `Upload_Final_Episode` task and completes it by row-scan; UI path (rowIndex present) unchanged. |
| `dwyp_ui.html` | ✅ Pushed (items 59–84 + item 91 + 2026-05-22 session; Reels spoke 2026-05-24; reel player revert 2026-05-25; Episode Upload spoke 2026-05-26; SPOKE_2.1+3b 2026-06-05; SPOKE_4 2026-06-05) | **SPOKE_4 (2026-06-05):** Derivative edit mode built end-to-end. `st.derivativeMode` flag added to studio state. `schEditCard` sets flag (removes old `publishOrigin` assignment). `stSyncDerivativeUI()` — reads `st.derivativeMode` + `st.designTab`, shows/hides action buttons; called at end of `stSelectDesignTab`. Images toolbar: derivative triad buttons (`stDerivSaveBtn`, `stDerivCopyBtn`, `stDerivDiscardBtn`) added (hidden by default); Schedule + Clear hidden in derivative mode. Reels action bar: reel derivative triad (`stReelDerivSaveBtn`, `stReelDerivCopyBtn`, `stReelDerivDiscardBtn`) added (hidden by default); Send to Schedule + Request Revision hidden in derivative mode. `stSetRailTab` — redirects `'hq'` → `'bg'` in derivative mode. `stRenderRailReelList` — filters to `st.selectedReelId` when `st.derivativeMode` (locked rail); `st.selectedReelId` pre-set in the edit round-trip block so filter activates before GAS async returns. Image derivative functions: `_derivImgExtract`, `derivativeSave`, `derivativeSaveACopy`, `derivativeDiscard`. Reel derivative functions: `derivativeReelSave`, `derivativeReelSaveACopy`, `derivativeReelDiscard`. All exit paths clear `st.derivativeMode`, call `stSyncDerivativeUI`, navigate to Schedule. `stCloseStudio` clears `derivativeMode`. | **SPOKE_2.1+3b (2026-06-05):** Export button + day-picker removed from Images canvas toolbar; `#stReelExportBtn` removed from Reels action bar. JS removed: `stToggleDayPicker`, `stPickDay`, `stExportDesign`, `stExportQg`, `stExportReel`. Pool card: "export" button added per asset → `schExportSingle(assetId)`. New `schExportSingle(assetId)` — QG renders full-res offscreen via `_schRenderQgFullRes` then calls `exportSingleScheduleAsset`; reel calls GAS directly. New `_schRenderQgFullRes(canvasStateJson, backgroundId, callback)` — offscreen Fabric StaticCanvas, multiplier:3 (1080×1350), same `bgCache`/`_schLoadBgForThumb` dedup path as thumbnail renderer. `schExportAll()` rewritten — collects placed QG candidates, renders each sequentially via `_schRenderQgFullRes`, passes `imageRenders` map to `exportAllSchedule(episodeUid, imageRenders)`. | **Episode Upload spoke (2026-05-26):** CSS — `.ep-upload-panel`, `.ep-upload-bar-wrap`, `.ep-upload-bar`, `.ep-upload-status`. `renderTaskButtons` — `Upload_Produced_Episode` task type renders "Upload Proxy" button calling `startEpisodeUpload`. `renderTaskCard` — injects hidden file picker + upload panel div for `Upload_Produced_Episode` tasks. Upload flow: `startEpisodeUpload` (existence check → self-heal dialog or file picker), `onEpisodeFileSelected` (hides button, shows panel, calls `getEpisodeUploadUrl`, initiates session), `_initiateResumableSession` (XHR POST to signed URL — `X-Goog-Resumable: start` + `Content-Type`; handles 200 and 201; reads `Location` header), `_doResumableUpload` (5 MB chunks via `fetch()` with `redirect:'manual'` — 308 Resume Incomplete resolves as `response.type === 'opaqueredirect'`; 200/201 = finalized; XHR rejected because browsers fire `onerror` on 308 with no Location header), `_onEpUploadComplete` (calls `completeUploadEpisode`), `_updateEpUploadUI`, `_resetEpUploadUI`, `_fmtBytes`. **`stRenderAccordionTasks()` rewritten** — previously filtered to `!t.Episode_UID` (loose only) and showed "No loose tasks"; now renders all tasks via `renderTaskCard()`. `loadData()` success handler — added `stRenderAccordionTasks()` call. `refreshCurrentView()` — added `stRenderAccordionTasks()` at top so task completions update accordion. | Studio left nav (Publish/Design/Write/Outreach/Ideas). Episode accordion, proxy player, F-4 comment submit. Reel workflow card layout (inline player). Image workflow v3 three-panel layout. Fabric.js canvas 360×450, 4:5 export 1080×1350. Spoke 7 session state, episode index loading, mode-aware tab switching. Reel card grid `minmax(0,1fr)` overflow fix. Drop shadow blur reduced. Attribution chip dark + gold + Nunito. **UI polish (May 2026):** Reel trim overlay (Ouroboros SVG + `pbLogoPulse` CSS keyframe, replaces amber bar); trim state persists across day-stack nav (`pb._trimPending` + `_pbApplyPendingTrimOverlays()`). Image card stack — 4:5 thumbnail with padding, red serif title, Drive CDN stubs (`_PB_FEED_STUBS`, 6 URLs). Image editor — toolbar + caption + actions in right column; canvas-left / controls-right layout; slot header platform/why rows hidden via CSS; Back-to-cards inline in header row. Scroll padding on `.pb-ws-active`. Right-rail drag resize handle between Claude and Backgrounds panels. **v3 Center Canvas cosmetic pass (May 2026):** Left rail font/color/size fixes; urgent=red rule removed; active=gold CSS fix; rail never collapses. Reel card collapsed = 9:16 placeholder + title card + summary. Reel expanded = animated side-by-side, header click to collapse, height-capped. Image card whole-card-clickable + hint text. `pbCardNameInput` stub. `title_card` in reel stubs. SVG gradient IDs made unique per card. Urgency past-date bug fixed. **Deferred (wiring phase):** Trim deep-link to specific GCS/Vids file; Processing overlay real async trigger. **Item 92 Phases 1–2 (May 2026):** `_parseCaptionDraft(raw)` (client-side mirror). `_pbNormType(assetType)` — normalizes all bank/bankclip variants to 'reel'. `_pbPrefetchAssets(uid, schedule)` — pre-fetches image-type candidates async per assetType into `pb._alCandidateCache`; pre-fetches reels into `pb.reelCards`. `_pbFindCandidateById(assetId, assetType)` — searches candidate cache. `getRankedCandidates()` **[vestigial — rankings retired; see Current Position]** updated: reads from `pb._alCandidateCache` for image types; falls back to stub pool during async load; shows precomp bg thumbnail (by canvas index) for cards with no Drive export. `_pbHydrateCardCanvas()` — three-tier hydration: (1) restore from `pb.cardCanvases[assetId]` (in-session state); (2) restore from `c.canvas_state` (AL row JSON, undo floor locked); (3) fresh build — resolves precomp bg by `_candidateIndex % bgPool.length`, sets `pb._defaultTextColor` from bg textColor signal, calls `pbAddTextToCanvas(c.quote_text)` then `pbApplyBackground()`, locks undo floor. `pbToolAddText()` — selects existing text object for editing or creates new via `pbAddTextToCanvas('Type your text here…')`. `loadPrecompBgImages()` — async fetch; retroactively applies background + corrects text fill if canvas open during load (race-condition handling). `pbCardClick` non-reel path: snapshots outgoing card to `pb.cardCanvases[outgoingAssetId]` before dispose; calls `_pbHydrateCardCanvas()`. `pbSaveAndExit` critical identity fix: saves to `pb.cardCanvases[assetId]` (not `pb.slotCanvases[slotId]`) — each image card has independent per-assetId storage; `pbSelectSlot` always calls `pbInitCanvas()` fresh for image cards. `pb` state additions: `_alCandidateCache`, `_activeCandidateData`, `_reelCardsLoaded`, `cardCanvases`, `_defaultTextColor`, `_precompBgImages`. Caption prefill from Caption_Draft only if no localStorage caption for this slot. Phase 2 ✅ shipped (May 2026): Fix 1 — `pbSaveAndExit` strips `obj.src` for data URIs + nulls filter matrices before server call (Canvas_State now writes to AL row). Fix A — Save button retired, Export button added (calls `exportAssetToDrive`); all exit paths route through save core before teardown; three exit semantics locked. Fix B — `_pbHydrateCardCanvas` Tier 2 resets `viewportTransform` + clears `backgroundImage` before bg re-apply (eliminates coordinate drift). Fix C — dual-JSON in save-core: `fullCanvasJson` (full base64) → `pb.cardCanvases[assetId]` (synchronous Tier 1 reopen, no async race); `serverCanvasJson` (stripped src, null filters) → server. **Spoke 0 — Caption Consolidation (May 2026):** `caption_draft` → `caption_host` throughout. `_parseCaptionDraft()` client-side retired; all call sites replaced with `String(...)`. `pbSetCaptionFromDraft()` simplified (no JSON.parse, `captionVariants` cleared). Regenerate caption button retired from image canvas + reel workspace. Generate caption button retired from reel card list. `pbRegenCaption()` and `pbGenerateCaption()` retired. **Design Surface Sprint — Round 1 (May 2026):** Design tab shipped as persistent standalone surface. H&Q chips panel in chat col — tap drops text onto `st.fabricCanvas`. QG/Reels sub-tabs (`stSetDesignTab`), Mon–Sat day picker + Export (`stExportQg`, `stExportReel`). Reel list view in content col. "Export Image" button removed from canvas toolbar. `stLoadHqContent`, `stRenderHqPanel`, `stDropText`, `stLoadReels`, `stRenderReelList`, `stSelectReel`, `stSetExportDay` added. **Design Restructure CP1+2 — needs revision (May 2026):** Left rail replaced with accordion (Design/Write/Schedule/Tasks headers). Guest picker removed from chat col — rail owns guest selection via `stRenderRailGuests`, `stSelectGuest`. Images|Reels segmented toggle (`stSegRow`) moved to chat col top. H&Q panel wrapped in collapsible tray (`stHqTray`): open by default, collapses on chip tap, tap header to reopen. Reel browser stub added to right rail (`stReelBrowser`, shown in Reels mode). `stAccToggle`, `stAccOpen`, `stAccSelectMode`, `stToggleHqTray`, `stCollapseHqTray`, `stLoadRailReels`, `stRenderRailReelList`, `stSelectRailReel` added. **Status: needs revision — bugs not yet diagnosed. CP3+4 (caption pinned field in chat col, Reels companion, reel player in center col) deferred. Tasks accordion data source (actual to-do items) needs Hub session to define.** **Design Surface Overhaul (May 2026):** Text scaling (normalize-on-scale corner drag + A+/A− buttons), color picker popover (brand + complementary rows), `stApplyColor` per-char fill clear, overlay reset (circular arrow SVG, pushes history), export PNG fix (`multiplier:2` removed), export txt passes caption field, delete key guard (`isContentEditable`). **Publish Retirement (May 2026):** All `pb*` CSS (~2,150 lines), stPublishPanel HTML, var pb state, ~120 `pb*` functions removed. Left nav: Publish entry gone, Design is default. `openStudio()` defaults to `'design'`. `showEpisodeReview()` → `openStudio('design')`. `pbAutoSelectEpisode()` retired; auto-select wired to `stSelectGuest()`. **2026-05-22 session:** Reels center panel background changed from `#111` to `#f0f0f0`. Phone frame made height-driven (`min(72vh, 560px)` aspect-ratio:9/16) replacing fixed 200px width; iframe absolutely positioned with top:-52px / height:calc(100%+100px) to clip Drive preview toolbar chrome. `stRenderRailReelList` — `Reel_Summary` now rendered in reel cards (`.st-reel-card-summary`, 3-line clamp). Reels selector disabled: `stSegReels` button set `disabled`; `stSetDesignTab` guards `tab==='reels'` → redirects to `'qg'` (blocks button, programmatic calls, and persisted state on load). Companion image prompts removed: `[[PROMPT:]]` instruction + `PROMPT —` definition stripped from `STUDIO_MODE_INSTRUCTIONS.images`; regex in `stFormatResponse` changed from `HOOK\|QUOTE\|PROMPT` to `HOOK\|QUOTE`; `stTapChip` prompt branch removed. **Reels Surface spoke (2026-05-24):** `stSegReels` re-enabled (disabled attr removed, `stSetDesignTab` guard removed). Caption box wired to `Caption_Host`. Generate caption button + `stGenerateReelCaption()`. Action bar (`stReelActions`): Export day-picker → `stPickReelDay` → `stExportReel`; Edit with Vids → `stEditWithVids()`; Request Revision → `stRequestRevision()`. `stSelectRailReel` shows action bar on reel select. `stExportReel` ref fixed: `stExportBtn` → `stReelExportBtn`. New: `stToggleReelDayPicker`, `stPickReelDay`, `stEditWithVids`, `stRequestRevision`. **Revision Flow spoke (2026-05-24):** Episode review rewritten — native `<video>` via `getProxyStreamUrl` (was Drive iframe), compose loop (`epComposerFocus/Send/Cancel`), rail receipts (`epRailAppendRow`, `epRenderRailFromHistory`), hard-seal Request Revisions (`epRequestRevisions`). `epReviewState` replaces `reviewSession`. `Revise_Episode` Complete → `completeEpisodeRevisionTask`. Reel revision popup (`reelRevisionModal`) replaces inline path; `stRequestRevision` opens popup; `stSubmitReelRevisionPopup` passes notes to `requestReelRevision`. **2026-05-25 session:** Drive chrome accepted — iframe crop hack retired; `#stReelPlayerFrame` now `position:absolute; inset:0; width:100%; height:100%`. Modal z-index bug fixed (duplicate `z-index:200` overrode `z-index:400`; modal was rendering behind Studio Overlay at z-index 300). `#reelRevisionModal` centered + full corner radius. Reel card layout redesigned: `st-reel-card-inner` row layout; `.st-reel-thumb-col` (flex 0 0 33%) + `.st-reel-body-col` (flex 1); thumbnail via Drive thumbnail API (`?sz=w200`); `Reel_Summary` shown in full (3-line clamp removed). Action bar simplified: day-picker and Edit with Vids removed; Export calls `stExportReel(st.episodeUid)` directly. `stToggleReelDayPicker`, `stPickReelDay`, `stEditWithVids` removed. **Nav Panel Teardown Fix (2026-05-30):** `stHideAllPanels()` added — hides all 11 content/assets panels; called first in `stSetDesignTab`, `stAccSelectTaskView`, `stShowScheduleStub`, `stAccSelectMode`. `stSyncSubItemActive` extended to clear Tasks `active` state when Guest sub-item activates. `stAccSelectTaskView` extended to clear Guest sub-item `active` state when Tasks item activates. | **SPOKE_Tasks_2:** `stRenderEpBandCard` (action label + state line + icon placeholders), `stRenderEpUpcomingCard`, `stRenderEpTbdCard`, `stRenderEpisodesView`. `stEpisodesView` added to `stHideAllPanels`. **SPOKE_Tasks_3:** `stBucketsView` panel — bucket bands, Quick Tasks, Capture form. `stRenderBucketsView` + helpers. `renderDashboardLoose` retired. **SPOKE_Episode_Tasks_1 (2026-05-31):** `approveEpisodeVideo` wired to `approveEpisodeForRelease`. `stRenderEpBandCard` rewritten — two-column layout (left: name/dateline/blocking task; right: state+icon/action dots); card-body tap = expand/collapse task list; lit headphones → Studio Episode; lit film → Studio Reels; calendar always inert stub. `stRenderEpUpcomingCard` — mic replaced by feather (quill) inert stub. New helpers: `stGetEpStateIcon(ep)` (Status→label+icon: in_production→activity, review→eye, ready_to_release→check, live→radio); `stGetEpBlockingTask` (state-advancing task or "Approve episode" when Video_Status=review); `stToggleEpCard`; `stRenderEpCardTaskList` (four kinds: GCS upload / Revise_Reels link+Complete / Upload_Final_Episode Complete / release checkbox+link / generic Done). Action functions: `stCompleteEpCardTask`, `stCompleteReelRevision`, `stCompleteFinalEpisodeUpload`, `stConfirmReleaseTask`. CSS: two-column card layout + task list/row styles. Dead ref: `ep.Images_Status` in `getEpisodeBadges` — field gone; cleanup with icon spoke. **Team assignee spoke (2026-06-01):** `securityFilter` — `assignee === "team"` passes JT's filter. `applyFilters` "me" branch — includes team tasks alongside personal. **Review signal cleanup (2026-06-02):** `stGetEpFilm` repointed from Review_Reels task-existence to `Episode.Status >= in_production`. `getEpisodeBadges` — `hasReel` repointed to Status; `hasImage` removed (images pipeline retired). `getDashboardIconStates` — reels: Status-based; images: always gray. `dbTapIcon` — reels route directly from Status, no task gate. `renderEpisodeToolsCard` — Reels active from Status; Images always muted. `renderTaskButtons` — Review_Images and Review_Reels branches removed (dead code; tasks never spawn). `REVIEW_STEPS_ALL`/`REVIEW_STEPS_WITH_LINK` — Review_Reels and Review_Images removed. `stGetEpBlockingTask` BLOCKING_ORDER — Review_Reels removed. |

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

**`generateWithClaude()`** — retired (deleted 2026-06-03; see Companion Recon + Teardown above).

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
    Images/                              ← Images pipeline retired; folder exists, untracked
      Approved/
      Save/
      Delete/
    Thumbnails/
    Reels/                               ← syncReelAssets scans here → AL rows; reel card routes via Episode.Status (AD #93)
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
| 5b | Upload Produced Episode | Audra | Spawned after Produce Episode (manual step for now) | ✅ Built (2026-05-26). Task card renders "Upload Proxy" button → browser-side resumable chunked upload to GCS. Upload success auto-calls `completeUploadEpisode` → flips `Video_Status → review` + spawns `Review_Episode`. Self-heal: re-click detects existing proxy and offers to complete without re-uploading. End-to-end test pending (2026-05-26). |
| 6 | Review Episode | JT | Upload_Produced_Episode task completion (upload success) | ✅ Built. Lifecycle-gate task: completion is the system of record for review → approved transition. |
| 7 | ~~Review Images~~ | — | Retired (AD #92) | Images pipeline retired. Spawn removed (Loop B deleted). UI signals repointed to Episode.Status or removed. |
| 8 | ~~Review Reels~~ | — | Retired (AD #93) | Reel card elements route directly via Episode.Status. Spawn removed (Loop C deleted). UI signals repointed to Episode.Status. |
| 9 | Revise Reels / Revise Episode | Audra | `Revise_Reels`: JT Request Revision in Reels surface. `Revise_Episode`: JT Request Revisions in Episode review. | ✅ Live. `Revise_Reels`: spawned by `requestReelRevision`; carries `Asset_ID` FK + `Payload_Link` (Drive URL of old reel). Card: link + Complete button → `completeReelRevision()` scans `Reels/` root for non-original file and delegates to `closeReelRevision`. `Revise_Episode`: card renders GCS upload affordance (same path as Upload_Produced_Episode — `startEpisodeUpload` → `completeUploadEpisode`). |
| 10 | Upload Final Episode | Audra | JT approves episode proxy → `approveEpisodeForRelease()` | ✅ Built. Card: instruction to place final file in `Staging/Episode/` + Complete button → `completeFinalEpisodeUpload()` → `Final_Episode_ID` written, `Status: ready_to_release`, Filing + Release tasks spawned. |
| 11 | Release | Audra | `completeFinalEpisodeUpload()` | ✅ Built. Card: checkbox + link to `SPOTIFY_EPISODE_BASE`. Check → `writeTaskComplete`. |
| 12 | Runway Reminder | JT | Daily Pulse D-7 | ⏳ Not yet built. |
| 13 | Release Day Tomorrow / Release Day | Both | Daily Pulse D-1 | ✅ Built. |
| 14 | Errors / Admin | Audra | Various | Urgent. Never visible to JT (filtered by assignee via `securityFilter`). |

---

## Pipeline Sequence — Locked

1. Calendar event detected → Secretary runs → folders + manifest created
2. Daily Pulse Loop 1 fires D-1 → Recording Date Reminder spawned (HOST + PRODUCER)
3. Herald runs → Guest Brief written → Guest Brief Enrich task (Audra)
4. Audra enriches + approves → Guest Brief Review task (JT) — auto-closes
5. Audra uploads finished transcript to `Staging/Episode/`; uploads proxy mp4 to GCS `dwyp-review-playback/episodes/{EUID}/proxy.mp4` via "Upload Proxy" button on the Upload_Produced_Episode task card (browser-side resumable upload)
6. Upload success auto-fires `completeUploadEpisode` → `Video_Status → review` + Review Episode task spawned (JT)
7. Reel card elements light from Episode.Status (in_production+); reel surface accessible directly — no task gate (AD #93)
8. JT sorts assets; comments on reels → Revise_Reels tasks for Audra
9. Daily Pulse D-7: Runway Reminder (if unresolved assets)
10. JT approves episode proxy → `approveEpisodeForRelease()` → `Video_Status: approved` + `Upload_Final_Episode` task spawned for Audra
10b. Audra places final mastered episode file in `Staging/Episode/` → taps Complete on card task → `completeFinalEpisodeUpload()` → `Final_Episode_ID` written, `Status: ready_to_release`, Filing + Release tasks spawned
10c. Audra confirms Release task (checkbox + Spotify link) → Release task complete
11. Audra manually sets `Status: live` at release (Tuesday)
12. Nightly housekeeping (Sunday after release): `archiveLiveEpisodes()` detects `Release_Date + 5 days ≤ today` → `runFilingFairy()` → Staging folder moved wholesale to Finished, `Status: archived`
13. Corpus deposit: manual — Audra drops assets to `CORPUS_DRIVE_FOLDER_ID` and triggers sync in GCP Console
14. Daily Pulse Loop D: transcript detected → Track A (`buildEpisodeIndexV2`, Claude) → Track B (`runEditorialPass`) → Track C (`materializeQuoteGraphicAssets`) → Artist Fairy handoff
15. Release Day Tomorrow / Release Day tasks (Daily Pulse D-1)

---

## Tasks — Design (Locked, May 2026)

`renderDashboard()` entry point. Two workspaces selectable via Tasks sub-items in the left rail.

### Episodes workspace (Tasks → Episodes)

**Ordering principle:** Release date is the spine. The operator arrives with zero loaded state; only a stable, monotonic index can re-ground the view instantly. Workflow `Status` is read off the card after the index places the episode — not used as the grouping axis.

**Left column — month bands.** Episodes with a `Release_Date` group by release month. Conditional render: only months with episodes paint. Sort within band: `Release_Date` asc.

**Right column — two workspace regions:**
- **Upcoming Recordings** — `Status = upcoming` (no release date yet; recording not yet happened).
- **TBD Episodes** — `Status ≥ in_production`, `Release_Date` blank.

**Episode card (band — two-column layout):** Left: guest name / release date / blocking task (most state-advancing open task title, or "Approve episode" when `Video_Status = review`). Right: state indicator top (Episode.Status → label + Lucide icon: `in_production` → activity, `review` → eye, `ready_to_release` → check, `live` → radio); three action icon dots bottom (headphones / film / calendar). Card-body tap = expand/collapse inline task list. `Episode.Status` drives release-month vs. right-column placement.

**Upcoming Recordings side cards:** feather (quill) inert stub icon replaces mic. **TBD Episodes side cards:** calendar stub unchanged. Neither side card expands.

**Per-asset icon routing:** Lit/secondary headphones → Studio Guest → Episode sub-tab (`stSelectGuestView`). Lit film → Studio Guest → Reels sub-tab. Calendar always inert (Schedule not built). Muted icons have no handler. Icon color model (muted/red/gold truth-fix) is a deferred spoke — current build uses the existing `stGetEpHeadphones`/`stGetEpFilm` signals as-is.

### Buckets workspace (Tasks → Buckets)

User-organized loose task mode. Podcast · People · Personal grouping is retired (AppSheet-era residue; `renderDashboardLoose` removed from `renderDashboard()`). Buckets is the live model.

**Three regions, one teardown-registered panel (`stBucketsView`):**
- **Left — bucket bands.** Each user-defined bucket = one band; conditional render (empty buckets absent). Standard task cards: Title / Due / Notes / Complete.
- **Top-right — Quick Tasks.** Flat per-user list; tagged `Workflow_Step = "quick"`. Enter-to-add input + checkbox. Checked → `Status = "complete"` (done-and-hidden, not deleted — Preservation Mandate).
- **Bottom-right — Capture form.** Title → Assignee (defaults to self; other users available for cross-assignment) → Bucket dropdown → Due → Notes → Create Task. Voice-keyboard compatible on mobile.

**Bucket source of truth:** User Registry tab, `Buckets` column (comma-delimited list) and `Default_Bucket` column (single value). Both are Audra hand-edits; system never supplies bucket values. No fallback defaults.

**Cross-assignment:** Assignee ≠ creator → task routes to assignee's `Default_Bucket`; creator's chosen bucket is ignored. Blocks with toast if assignee has no default set. `bumpVersion("tasks")` fires on all task-write paths.

**Episode tasks — absent function, next focused build.** Episodes are viewable in the workspace but have no task surface yet. Sketch: card-expand reveals the episode's task list; each task has a route. Own fresh thread; needs a short design beat first.

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

### Navigation Structure

```
[GUEST NAME]
    Images
    Reels
    Episode
    Schedule

[GUEST NAME]
    ...

WRITE
    Brainstorm

TASKS
    Buckets
    Episodes    ← app entry / home
```

| Surface | Status | Notes |
|---|---|---|
| **Guest → Images** | 🔶 Active | Canvas: `st.fabricCanvas` ring-fenced. H&Q chip drop, background library/generate, Export PNG + `.txt`. **Caption and Title Card live on the center canvas with the asset — not rail panels.** Text scaling (A+/A− + normalize-on-scale). Color picker (brand + complementary rows). Export PNG fix (`multiplier:2` removed). CP3+4 deferred. Right panel: Hooks & Quotes · Backgrounds · AI Chat (AI Chat inert, pending AI wiring spoke). |
| **Guest → Reels** | 🔶 Active, cosmetic pass pending | Drive `/preview` player, `Caption_Host` wired, Generate caption, Export, Request Revision. |
| **Guest → Episode** | ✅ Live | Native `<video>` proxy player, timestamped comments, Request Revisions, Approve. View split: `#stEpVideoWrap` (top, regenerated per load) + `#stEpShowNotesWrap` (bottom, static; holds inert Show Notes box; vertical drag handle to resize). Right panel: Revision Comments · AI Chat tabs (AI Chat inert). |
| **Show Notes** | ⏳ TBD spec (not a nav sub-item) | Not in left rail. Lives as an inert `contenteditable` box in `#stEpShowNotesWrap`, below the episode video. Wiring spoke pending — will connect to a Show Notes doc. Full spec (JT Copy Google Doc fairy, AI Chat scoped to transcript, Hook/Quote/Caption Submission rail icon) is a separate hub session. |
| **Guest → Schedule** | 🔶 Active, Export All untested | Pool = `Status='schedule'` AL rows for episode; placed assets badged + sunk (`Availability='placed'`). Workspace toggles The Week ↔ Swipe Package. The Week template-driven from `Posting_Schedule`. Drag pool → slot; drag slot card → pool/another slot. Swipe = free-pick bag, dedup enforced. Send to Schedule live on Images (canvas upsert + thumbnail render to `Schedule_Renders/`) and Reels (status-flip). `edit ↗` round-trips to Images (canvas restored) or Reels. Export All code complete (untested — needs full week of placed assets). **Open:** aesthetic polish deferred; `edit ↗` back-button parked for Hub. Companion = Pass 3 stub. |
| **Write → Brainstorm** | ⏳ Not built | Global, non-episode-scoped. AI Chat: Research (Gemini + Vert) / Polish (Claude) toggle. Doc-generation pattern: AI output → new Drive doc in JT's Drive; JT switches center pane to it. Desktop continuation of Write Lite (Write Lite saves Drive doc; Brainstorm reads those docs in Docs picker). Replaces standalone Ideas tab. |
| **Tasks → Episodes** | ✅ Live | App entry/home. Episode-organized task view. |
| **Tasks → Buckets** | ⏳ TBD spec | Bucket organization pattern (Erin's concept). Internal structure needs Hub session before implementation. |
| **Write → Outreach** | ⏳ Future | Guest comms. Scribe template dependency — not ready to design. |

### Current Structure Notes (Rail Remodel Pass 1 / 1.5 / 1.6)

**Left rail — guest accordions.** Guest names are accordion headers; one guest expanded at a time (expanding one collapses the rest). Expanded guest shows sub-items **Images · Reels · Episode · Schedule** (no Show Notes — see above). Active guest is expanded on render. Write (Brainstorm) and Tasks (Buckets, Episodes) are peer root items with the same accordion treatment. Selection styling: red→gold gradient bar on the expanded guest header (`#d12026` solid to ~65%, then → `#faae17` tail); active sub-item is solid gold text; white left-aligned text held over the red zone for contrast.

**Caption and Title Card** live in the center workspace — not rail panels. Element IDs preserved so reel-select population still works.

**Episode view — two containers.** `#stEpView` is split into `#stEpVideoWrap` (top; regenerated on each episode load) and `#stEpShowNotesWrap` (bottom; static). A vertical drag handle between them lets JT favor the video or the notes. The lower wrap holds the Show Notes box — **present but unwired** (no content load/save yet; that is its own spoke). Episode right panel shows **Revision Comments · AI Chat** tabs.

**Right rail — current interim.** The right-side panel is presently a fixed panel with tabs (Hooks & Quotes · Backgrounds · AI Chat on Images; Browser · AI Chat on Reels; Revision Comments · AI Chat on Episode). The §7 icon-rail-with-popout is the Pass 2 target; visual reference is `simple_mockup.png`. AI Chat renders as an inert tab pending the AI wiring spoke.

### AI Companion (Phase 4)
Per-asset chat with Claude in the AI Chat rail icon. Conversation history per asset in Asset_Library. Companion scope = asset-in-focus only (Design–Schedule split means no same-date sibling injection). Chip suggestions never auto-write JT's draft. Full spec in `DWYP_Operating_Model.md` § 8 (Companion Model). Reusable implementation patterns in `docs/DWYP_Publish_Feature_Patterns.md`. Build is Phase 4 in the playbook.

### Episode Navigation
- **Nav tab → Studio:** auto-selects via `stSelectGuest()` on data-load.
- **Episode card → Studio:** episode UID passed as context payload — lands directly in that episode.
- **Mid-session episode switch:** safe — all canvas state persists to Asset Library; all docs save to My Docs.

### Retired
- Publish tab — retired May 2026. All `pb*` code removed.
- Design as standalone root surface — retired Hub May 2026. Canvas access now via guest → Images and guest → Reels within guest nav.
- Left-center chat panel (`#stChatCol`) — **retired** (Rail Remodel Pass 1). Dissolved entirely. Chat removed; will be rebuilt later as the AI Chat rail icon (AI wiring spoke). The segmented Images/Reels/Episode toggle (`#stSegRow`) that lived inside it is also gone — view-switching is now driven by left-rail sub-items calling `stSetDesignTab`.
- `#stSegRow` (Images/Reels/Episode segmented toggle) — retired with `#stChatCol`; view-switching now driven by left-rail guest sub-items.
- Mode list (seven modes: Show Notes, Episode Copy, Interview Prep, Social Media, Newsletter, Outreach, Brainstorm) — retired. Surfaces now organized by guest nav sub-items + Write/Tasks root items.
- Ideas tab — retired. Brainstorm (Write → Brainstorm) replaces it.
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
| 90 | Phase 1.5 — Tasks screen migration | Version-aware cold start; tab return = 0–1 batch calls |
| 91 | v3 Center Canvas — cosmetic pass | Left rail, reel card, image card, urgency fix |
| Track C | Bridge — `materializeQuoteGraphicAssets` | Vert → Claude → Bridge pipeline closed; verified on David Bedrick |
| 92 | v3 Wiring Phases 1–2 | Dual-JSON canvas, Export button, viewport fix, per-asset storage |
| Pipeline Rewire | Track A/B/C Pipeline Rewire | `buildEpisodeIndexV2` rewritten (Claude, extract-not-interpret); Loop D rewired (two-condition A→B); `runVertFairy` + all show-notes + Vertex helpers deleted; `dev_tools.js` cleaned; `runVertFairyForEpisode` repointed |
| Episode Upload Affordance | Browser-side resumable upload + auto-handoff to Review | Confirmed 2026-05-26 on 3-sec and 60-min+ videos. Playback, comments, and auto-handoff all live. |
| Rail Remodel Pass 1 / 1.5 / 1.6 | Left-rail guest accordion + sub-item nav + Episode view split | Guest accordion (one open, red→gold gradient), sub-items Images·Reels·Episode·Schedule, stSetDesignTab wiring, Episode view split (#stEpVideoWrap + drag + #stEpShowNotesWrap inert), right-rail AI Chat inert stubs, Schedule stub. |
| Document Provenance | PROPOSAL_ / SPOKE_ prefix scheme added to CLAUDE.md | Canon is unprefixed. Build_Playbook rename/exception open. |
| Nav Panel Teardown Fix | Studio: panel leak + double-active nav corrected | `stHideAllPanels()` hides all 11 content/assets panels; called first in `stSetDesignTab`, `stAccSelectTaskView`, `stShowScheduleStub`, `stAccSelectMode`. `stSyncSubItemActive` clears Tasks items on Guest activate. `stAccSelectTaskView` clears Guest sub-items on Tasks activate. `stEpView` container mount confirmed correctly scoped inside `stContentCol` (not hoisted). `stSwitchTab` is a known exception site — sets panels via `isImg` ternary but always delegates to a teardown-owning function (design → `stSetDesignTab`; write path enters through `stAccSelectMode`); no independent leak risk. |
| SPOKE_Tasks_1 | Episode State — five-state Status model | `upcoming`→`in_production`→`ready_to_release`→`archived`. `archived` is the sole terminal gate (replaces `complete`). Creation init: `upcoming`. Loop D flip: `in_production` on transcript detect. `triggerReadyForRelease()` flip: `ready_to_release`. All 6 active dailyPulse loops: `complete`→`archived`. `getEpisodes()` + `getActiveEpisodes()` + secretary calendar + herald prior filter: all updated. Housekeeping: processes `in_production` + `ready_to_release` only. `EPISODES_COLS`: `Frameio_Project_ID` + `Guest_Package_URL` columns retired. `Images_Status` column left in place (inert — no write path; Filing redesign will resolve). Dead writer `filing_fairy.js:301` (`Status:"complete"`) parked for Filing redesign. **✅ Enum complete:** Episodes sheet Status enum = `upcoming` / `in_production` / `review` / `ready_to_release` / `live` / `archived`. |
| SPOKE_Tasks_2 | Episodes workspace — month calendar + two workspace regions | Left column: release-month bands (conditional render, `Release_Date` as sort key). Right column: Upcoming Recordings (`Status = upcoming`) + TBD Episodes (`Status ≥ in_production`, no release date). Episode card: action label + state line + per-asset icons (placeholder — icon model deferred). `stRenderEpisodesView()` + `stRenderEpBandCard()` + side-card renderers. `stEpisodesView` panel registered in `stHideAllPanels()`. |
| SPOKE_Tasks_3 | Buckets workspace — three-region task mode | `stBucketsView` panel; bucket bands (left), Quick Tasks (top-right), Capture form (bottom-right). Buckets sourced from User Registry `Buckets` + `Default_Bucket` columns (Audra hand-edits; no system defaults). Cross-user assignment routes to assignee's `Default_Bucket`. `Workflow_Step = "quick"` tags stickies. `Tasks.Bucket` col 18 added to `TASKS_COLS`, `getTasks()`, `createTask()`, `spawnTask()`. `renderDashboardLoose` retired from `renderDashboard()` (Podcast/People/Personal gone). **Audra hand-edits required:** User Registry — add `Buckets` + `Default_Bucket` columns and populate. Tasks tab — add `Bucket` header in col R (18). |
| SPOKE_Episode_Tasks_1 | Episodes workspace — episode task surface + release flow | Band card: two-column layout (left: name/dateline/blocking task; right: state+icon/action dots), card-body tap = expand/collapse inline task list, lit icon routing to Studio sub-tabs. Upcoming side card: quill (feather) replaces mic. State icon map: in_production→activity, review→eye, ready_to_release→check, live→radio. Task kinds on card: GCS upload (Produce/Upload_Produced/Revise_Episode via `startEpisodeUpload`), Revise_Reels (Drive link + Complete → `completeReelRevision`), Upload_Final_Episode (Complete → `completeFinalEpisodeUpload`), release (checkbox + Spotify link). `approveEpisodeForRelease` replaces direct `writeVideoStatus` call on JT approval. `completeFinalEpisodeUpload`: scans Episode/ folder, writes `Final_Episode_ID`, flips Status→ready_to_release, spawns Filing + Release tasks. `EPISODES_COLS.Images_Status` → `Final_Episode_ID` (col 12). `SPOTIFY_EPISODE_BASE` governance key populated. `live` added as recognized Episode.Status. RFR cleanup complete: `triggerReadyForRelease`, `checkReadyForRelease`, RFR modal, `.btn-ready-for-release` CSS deleted. Testing in progress (2026-05-31). |
| SPOKE_Orchestrator_Pulse | State-driven pulse — replace loop stack with lifecycle orchestrator | `dailyPulse()` rewritten: single entry point, 6-stage lifecycle, no per-pulse throttle. Loops 1/2/3/B/C/D retired; Loops 3 + B deleted outright. Content chain (A→B→C) chained-within-pulse with per-stage try/catch + alert task. Reel chain independent (syncReelAssets → runReelEditorialPass). Stage 3 backup final-video detect (dual-trigger with UI Complete button; `Final_Episode_ID empty` gate makes them mutually exclusive). `runArtistFairy` deleted (Track C owns). `dev_tools.js` rewritten in lifecycle order. Full 6-state model: `upcoming → in_production → review → ready_to_release → live → archived`. ✅ Enum includes `review`. |
| SPOKE_Pulse_Throttle | Per-run heavy-pass budget + per-stage enable flags | **Throttle:** `PULSE_HEAVY_PASS_BUDGET` governance key (default 2 if absent). `_pulse_contentChain` accepts `heavyBudgetRemaining` param and returns count of heavy passes fired; `dailyPulse` accumulates with `heavyUsed`. Track A (`buildEpisodeIndexV2`) + Track B (`runEditorialPass`) are counted; if budget exhausted before a pass is needed, the pass is deferred (audit-logged) and the episode is picked up next run — idempotent by existing per-episode conditions. Track C (`materializeQuoteGraphicAssets`) is not counted and always runs when its condition is met. Reel chain is not counted. When Track C is auto-triggered it will join the budget — flagged for that spoke. Stage dispatch in `dailyPulse` confirms that `_pulse_contentChain` is only called for `upcoming` (transcript-detect path) and `in_production` — never for `review` or beyond. **Enable flags (opt-in, blank/absent/FALSE = no-op):** `PULSE_CONTENT_ENABLED`, `PULSE_REELS_ENABLED`, `PULSE_RECORDING_REMINDERS_ENABLED`, `PULSE_RELEASE_REMINDERS_ENABLED`. Each is the first check in its corresponding stage helper; checked via case-insensitive `=== "TRUE"`. No master `PULSE_ENABLED` key — the time trigger is the master switch. **Governance keys populated (2026-06-01):** All five keys added to Governance_Config. `PULSE_HEAVY_PASS_BUDGET = 2`. All four enable flags set to `FALSE` — stages are dark while trigger is verified. New daily pulse trigger created. Bring stages online by flipping each flag to `TRUE` individually. |
| Verify_Index_Wiring | Index stage wiring verification (report-only) | `buildEpisodeIndexV2` confirmed wired and reachable via `in_production` path. Kill switch (`PULSE_CONTENT_ENABLED`) confirmed `FALSE` — chain dark. Throttle (`PULSE_HEAVY_PASS_BUDGET = 2`) is per-run across all episodes; Track A can be deferred (not blocked) when earlier episodes consume budget. Idempotency gate confirmed two-layer (manifest field + Drive file-presence self-repair). Template precondition open: revised `# AI Search Index` section must be pasted into Master Template before chain goes live. No code changed. |
| SPOKE_Schedule_1–3 | Schedule surface — pool, placement, send verbs, Export All | **Spoke 1 (2026-06-02):** Surface scaffolding. Left-rail guest sub-item. `getScheduleData`, `placeAssetSchedule`, `removeAssetFromSchedule`. Pool = `Status='schedule'` AL rows. Drag-to-slot week placement + swipe placement. Optimistic UI. **Spoke 2 (2026-06-02):** Send to Schedule verbs on Images and Reels surfaces. Images: `sendImageToSchedule` — AL row upsert at `Status:'schedule'`, PNG thumbnail rendered via `canvas.toDataURL()` and written to `Staging/[ep]/Schedule_Renders/`, `Drive_File_ID` stored on row. Reels: `sendReelToSchedule` — status-flip of existing AL row to `'schedule'`. **Spoke 3 (2026-06-02 — code complete, untested):** `exportAllSchedule` — assembles hand-off package in `Staging/[GuestName]/`. Day folders (non-empty only) + SWIPE folder. Images: PNG copied from Schedule_Renders + Caption_Host `.txt`. Reels: `.txt` with title + caption (Caption_Host week / Caption_Guest SWIPE) + Drive link. Clear-and-rebuild re-run strategy. `schExportAll()` frontend handler opens folder on success. **Needs a full week of placed assets to test.** |

### ⏳ In Progress
- **v3 Wiring spoke (item 92)** — Phase 1 ✅ confirmed. Phase 2 ✅ shipped. Phase 3 (reel card expand) next.

### 🔜 Soon

- **Rail Remodel** — next left-rail pass.
- **Schedule companion — Pass 4 of 4** — AI Chat for Schedule surface. Prerequisite (Pass 3) complete. Build from scratch; no existing footprint on Schedule surface.
- **Episode show notes display** — wire the inert Show Notes `contenteditable` box in `#stEpShowNotesWrap` to a real doc.

### Queued — Next

**Phase 1 — Performance Foundation**
✅ 1.1–1.5 Complete (see Build Sequence table above).
1.6 Blurhash thumbnails — **parked** (deprioritised; not blocking anything).
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
- C-2 — Revision Task inline checkboxes.
- C-1 — Contacts Add/Edit (awaiting JT feedback).
- F-2 — Reels Viewport Fit (iPhone SE) (pending device confirmation).

**Parked — Hub Backlog (Item 92 Phase 2 session):**
- Stub → real card swap on first paint: render skeleton card frames (no text, no bg) until `_pbPrefetchAssets` resolves, then single swap to real content. Skeleton-first preferred over block-until-ready — also closes orphaned-Card-1 race (click before prefetch returns → stub ID → hydration bails) as a side effect.
- AL row as single source of truth across surfaces: every surface displaying asset content (stack card thumbnail text/bg, caption draft chip, details panel quote text) should read from AL row, not derived or cached copies. Requires audit-first spoke (map all surfaces + current vs. should-be sources), then patch spoke. Open design decisions for hub: overwrite `Quote_Text` on edit or new `Display_Text` column? Write to AL on save or derive from Canvas_State on every read? Does caption draft regenerate against edited text or stay locked to original?

**Parked — this session (2026-05-30/31):**
- Episode video reload optimization: `stLoadDesignEpisode` fires unconditionally on every Guest → Episode switch — no UID guard. Fix is `st._lastEpLoaded` early-return guard at the `stLoadDesignEpisode` call site in `stSetDesignTab`. Self-contained; no architectural impact.
- Filing-redesign cluster (from SPOKE_Tasks_1): `Images_Status` column inert (no write path); dead read sites; dead `Status:"complete"` writer at `filing_fairy.js:301`; date-based archive trigger undefined. Resolve together in Filing redesign spoke.
- Icon rebuild: film icon is muted-always (lit-always is mildly wrong, not just unpolished). Headphones gold/red inverted in current build. Full muted/red/gold icon pass required — batches with the icon-model build. Do not fix piecemeal.
- Gemini brain-dump parse (unstructured paragraph → four task fields). Capture works via form + voice-keyboard; parse is convenience on a working function. Help-Desk-as-task-inlet parked with it.
- artist_fairy.js janitorial: dead helpers (`buildPlaceholderMap`, `resolveGuestHeadshotBlob`, `resolveHostHeadshotBlob`, `populateSlideDeck`, `processSlide`, `processGroup`, `replaceTextPlaceholders`) + stale file header comment.
- `upsertEpisodes` DEFAULTS stale entry: `Images_Status: "pending"` (harmless, header-driven, silently skipped).

### Upcoming (no order)

- **Identity addition in Master Template** — guest/host identity block in v3 template.
- **Prettify the app** — visual polish pass; Figma-first with exact values.

### Later
- Filing Fairy expansion — subfolder moves on filing; uncomment corpus deposit when us-south1 API available
- Gemini auto-transcription spoke
- Clerk Fairy rebuild
- Mending Fairy — `correctGuestName()`, `archiveEpisode()`, re-enrichment trigger
- Guest Brief formatter + Guest Doc formatter
- JT social tasks + Audra release tasks
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
| 9 | `dwyp_ui.html` / `dwyp_app.gs` | **CLOSED (2026-05-26).** `stRenderAccordionTasks()` rewritten to show all tasks via `renderTaskCard()`, removing the loose-tasks-only filter. All tasks (episode-linked and loose) now appear in the Studio Tasks accordion. | — |
| 10 | `dwyp_ui.html` | Trim button opens `vids.google.com` root — needs a deep-link to the specific Drive/GCS file. | Deferred until GCS embed + Sentinel confirmed. Scope in wiring hub. |
| 11 | `dwyp_ui.html` | Processing overlay fires immediately on Trim click — should only show while async work is in progress. | Deferred until real Trim async path is wired. |
| 17 | `dwyp_ui.html` | Manually pausing the episode video then sending a comment produces no timestamp. Only focus-triggered pauses (clicking the comment field while the video is playing) stamp a time. | Deferred — log for a future spoke. |
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
| **Schedule rail composition** | What rail icons appear on guest → Schedule. Gated on Build Playbook 3.3 (Schedule Panel UX Hub session). |
| **Audra Ops as User Bucket** | Bucket spec doesn't exist yet. Define Buckets internal structure first (Tasks → Buckets Hub session). |
| **Help Desk placement** | Universal right-rail icon vs. off-rail. Role-filtered availability is a separate question. Never formally resolved. |
| **AI assignment per surface** | Model choice for Guest → Episode, Guest → Reels, Guest → Images, Guest → Schedule — TBD in rail composition table. Parked for follow-up Hub. |
| **JT-variant asset schema** | Show Notes Hook/Quote/Caption submissions arrive pre-bundled with caption. Caption-traveling-with-asset for JT-variants: reuse `Caption_Host` or add sibling field. Decide before Show Notes spoke. |
| **Canon pass — Platform_Reference task-dispatch AD** | Three-axis taxonomy in task-dispatch AD is obsolete; needs forward-looking correction. No code impact — doc-only pass. |
| **Canon pass — Reels Surface doc rename** | `DWYP_Spoke_Reels_Surface.md` does not follow Document Provenance scheme (should be `SPOKE_Reels_Surface.md`). Rename on next canon pass or before that spoke resumes. |

---

## Reminders — Action Required

| Item | Status |
|---|---|
| **[SPOKE_Tasks_1]** Run `clasp login` + `clasp push` to deploy five-state Status changes to GAS | ⏳ Blocked — clasp re-auth required |
| **[SPOKE_Tasks_1]** Update Episodes sheet Status data-validation: `upcoming`, `in_production`, `review`, `ready_to_release`, `live`, `archived` (remove `active`, `complete`) | ⏳ Audra — in-sheet |
| **[SPOKE_Episode_Tasks_1]** Episodes sheet col L: confirm header is `Final_Episode_ID` | ✅ Done (2026-05-31) |
| **[SPOKE_Episode_Tasks_1]** `SPOTIFY_EPISODE_BASE` in Governance_Config | ✅ Done (2026-05-31) |
| **[SPOKE_Episode_Tasks_1]** Cleanup spoke: remove orphaned `triggerReadyForRelease`, `checkReadyForRelease`, RFR modal, `.btn-ready-for-release` CSS | ⏳ Future cleanup spoke |
| **[SPOKE_Tasks_1]** Relabel existing `active` rows: transcript+index_v2 set → `in_production`; review tasks closed → `ready_to_release`; no transcript yet → `upcoming` | ⏳ Audra — in-sheet |
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
`GEMINI_API_KEY`, `MODEL_NAME`, `CLAUDE_API_KEY` ✅, `MASTER_SHEET_ID`, `SPOTIFY_EPISODE_BASE` ✅ (base URL for Release task Payload_Link — populated 2026-05-31), `MASTER_TEMPLATE_ID`, `STAGING_DEPLOYMENT_URL` ✅, `STAGING_SHEET_ID` ✅, `REVIEW_GCS_BUCKET` (`dwyp-review-playback`) ✅, `GCS_SIGNER_SA` (`309883149140-compute@developer.gserviceaccount.com`) ✅, `GCS_EXPIRY_SECONDS` (`28800`) ✅ — note: signing requires explicit project-level signBlob grant (AD #122), `RAW_PRODUCTION`, `STAGING_DRAFTS`, `FINISHED_EPISODES`, `DWYP_CALENDAR_ID`, `CALENDAR_TRIGGER_PREFIX`, `ASSIGNEE_HOST`, `ASSIGNEE_PRODUCER`, `HOST_NAME`, `HOST_EMAIL`, `CONTACT_LIBRARY_FOLDER_ID`, `PODCAST_NAME`, `HERALD_RESEARCH_PROMPT_KEY`, `HERALD_BIO_PROMPT_KEY`, `HERALD_BRIEF_PROMPT_KEY`, `CONTENT_SENSITIVITY_ID`, `BRAND_VOICE_ID`, `NOTEBOOK_STAGING`, `ARCHIVE_FOLDER_ID`, `RELEASE_REMINDER_HOURS`, `SCRIPT_ID`, `INTAKE_NAME_KEY`, `INTAKE_EMAIL_KEY`, `INTAKE_REFERRAL_KEY`, `ARTIST_THUMBNAIL_DECK_ID`, `ARTIST_SQUARE_DECK_ID`, `ARTIST_VERTICAL_DECK_ID`, `IMAGE_BACKGROUND_LIBRARY_ID`, `STUDIO_CORPUS_ID`, `CORPUS_DRIVE_FOLDER_ID`, `VERTEX_RAG_REGION` (`us-south1`), `REELS_ARCHIVE_FOLDER_ID`, `POSTING_SCHEDULE_TAB_NAME`, `SOCIAL_ASSETS_TAB_NAME`, `STUDIO_ROOT_FOLDER_ID`, `STUDIO_CANVAS_MANIFEST_FOLDER_ID`, `STUDIO_DOCS_FOLDER_ID`, `STUDIO_SESSIONS_FOLDER_ID`, `EPISODE_SEARCH_INDEX_KEY`, `JT_TIMEZONE`, `AUDRA_TIMEZONE`, `PUBLISH_LLM_MODE` (gemini — retire after Spoke 1), `PRECOMP_BACKGROUND_LIBRARY_ID` (Drive folder `1Tyw7ArpdmYiKZNL4FOQNIpA4fTXkwkh6`; currently same as IMAGE_BACKGROUND_LIBRARY_ID — curated set to be built and swapped; filename convention: `bg_NNN_darktext` / `bg_NNN_lighttext`), `STUDIO_IMAGE_MODEL` = `gemini-2.5-flash-image` (locked — hub decision May 2026), `CAPTION_VOICE_SUPPLEMENT_ID` ✅ (Track B voice authority patch), `DELIVERABLES_VOICE_SPEC_ID` ✅ (Track B voice authority patch).

**Needs value set:**
`STUDIO_LLM_MODE` → `claude` (before Studio backend spoke).
`GCS_UPLOAD_EXPIRY_SECONDS` → `3600` (defaults to 3600 in code if absent; set explicitly for clarity).

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

**Episode proxy:** Native `<video id="stEpVideo">` fed by `getEpisodeStreamUrl(episodeUid)` — a V4-signed GCS GET URL (bucket `dwyp-review-playback`, path `episodes/{EUID}/proxy.mp4`, 8h expiry). Signing: `iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa}:signBlob` via owner's `ScriptApp.getOAuthToken()` (`cloud-platform` scope in manifest). Both playback and upload URLs flow through shared `_signV4()` helper. URL re-minted on every open; never stored. Enables JS control (focus-pause-freeze-timestamp, scrub, resume). File must exist at exact GCS path before player opens. **Troubleshooting signBlob 403:** `iam.automaticIamGrantsForDefaultServiceAccounts` org policy is active — Owner on the project does NOT implicitly grant `iam.serviceAccounts.signBlob`; the grant must be set explicitly at project level. Use GCP Console → IAM & Admin → Policy Troubleshooter to verify. SA keys are forbidden (AD #122) — keyless signBlob only.

**Episode proxy upload:** Browser-side resumable upload direct to GCS. `getEpisodeUploadUrl(episodeUid)` mints a V4-signed POST URL (1h expiry). Client POSTs to signed URL with `X-Goog-Resumable: start` → reads `Location` session URI → sends 5 MB chunks via PUT with `Content-Range`; 308 = continue, 200/201 = done.

**CORS:** Confirmed origin is `https://n-z5do…-script.googleusercontent.com` (Apps Script sandbox host). If uploads CORS-fail in the future, read the exact origin from the DevTools console preflight error and update the bucket's CORS allow-list. See AD #122.

**Browser gotchas** (server examples don't warn about these):
1. **Init can return 201, not just 200.** Handle both. Our code does.
2. **308 Resume Incomplete kills XHR.** Browsers fire `onerror` (status 0) on a 308 with no `Location` header — they can't complete the redirect. Use `fetch(redirect:'manual')` instead; a 308 resolves as `response.type === 'opaqueredirect'`. Our code does this.
3. **Do not set `Content-Length`.** It's a forbidden request header in browsers. The browser computes it from the body automatically. Setting it throws a console error and may cause the request to fail. Our code does not set it.

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


