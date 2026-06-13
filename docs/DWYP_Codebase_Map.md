# DWYP_Codebase_Map.md
**Version:** 1.1 | May 2026
**Purpose:** Hub-session orientation. Describes what each file owns, what its major functions do, and how the pipeline flows end to end. Written at responsibility level — not implementation detail — so it stays accurate across code iterations.

---

## Tech Stack

- **Runtime:** Google Apps Script (GAS), server-side JavaScript
- **Data store:** Google Sheets (Master Sheet), Google Drive (episode folders, Docs, Slides)
- **UI:** Single HTML file (`dwyp_ui.html`) served by `doGet()` as a GAS web app
- **LLM:** Claude API (primary), Gemini (secondary/grounded search), Vertex AI RAG (brand corpus)
---

## File Inventory

### Shared Infrastructure

**`fairy_circle.js`** — Shared kernel. Every fairy depends on this file. Owns: routing helpers, all LLM calls, audit logging, task spawning, manifest read/write, episode + contact sheet helpers, version stamp system, daily pulse trigger, and id generators. Nothing in this file is optional.

| Function | One-line responsibility |
|---|---|
| `getGovernance(key)` | Reads Governance_Config tab. **The only function that opens the sheet via raw MASTER_SHEET_ID.** |
| `isStaging()` | Returns true if serving the /dev deployment. Fails closed to production. |
| `getMasterSheetId()` | Routes all other sheet access — returns staging or production sheet ID. |
| `bumpVersion(domain, callerName)` | Increments version stamp for a domain; all write paths must call this. |
| `callClaudeAPI(prompt, systemInstruction, callerName, history, options)` | All Claude LLM calls. |
| `callGeminiAPIGrounded()` / `callGeminiAPINoSearch()` | Gemini paths (grounded = web search; no-search = structured extraction). |
| `callGeminiImageConversational()` | Gemini multimodal image conversation. |
| `logToAuditTrail(actor, eventCategory, episodeUid, contactId, detail, level)` | Writes every system event. eventCategory: error \| state_change \| human_action. |
| `spawnTask(taskConfig)` | Creates a Tasks tab row when human action is required; all fairies use this for error recovery. |
| `updateTaskStatus(taskId, newStatus)` | Closes or updates a task; suppressBump optional. |
| `spawnReviseAssetTask(episodeUid, assetType)` | Idempotent spawn of a revision task for Audra (skips if open task exists). |
| `getManifest(stagingFolderId)` | Reads episode_manifest.json from a staging folder. |
| `writeManifest(stagingFolderId, manifestData)` | Writes/overwrites episode_manifest.json. |
| `patchManifest(stagingFolderId, updates)` | Reads manifest, merges updates, writes back. |
| `getStagingFolderIdByUid(epUid)` | Looks up Production_Folder_ID in Episodes tab for a given UID. |
| `getRawFolderIdByUid(epUid)` | Looks up Raw_Folder_ID for a given UID. |
| `upsertEpisodes(episodeData)` | Write-or-update an episode row (header-driven). |
| `patchEpisodes(epUid, fields)` | Partial update of an existing episode row. |
| `appendEpisodeLog(logConfig)` | Appends a row to Episode_Log tab (system or human note). |
| `appendRevisionComment(...)` | Writes a revision comment to Episode_Log. Episode_Log is the sole revision record. |
| `dailyPulse()` | Time-triggered state-driven orchestrator (Stages 0–6, keyed on episode `Status`); `_pulse_*` helpers handle calendar intake, recording/release reminders, transcript-detect content chain, and final-video detect. |
| `generateEpisodeUid()` / `generateContactId()` / `generateTaskId()` | ID generators. Sole authority for each ID type. |
| `extractPrompt(sectionHeading)` | Reads a named prompt from the Master_Template sheet section. |
| `extractSectionFromProse(proseText, sectionName)` | Parses a named section out of a prose doc (used by Artist + Vert). |
| `processForensicTranscript(...)` | Chunks and processes a long transcript via LLM. |
| `splitContentIntoChunks(text, chunkSize)` | Splits text into N-char chunks for chunked LLM processing. |

---

### Fairy Files (Pipeline Agents)

**`secretary_fairy.js`** — Intake agent. Owns calendar scanning, identity resolution, episode record creation, Drive folder structure creation, and manifest initialization. Hands off to Herald.

| Function | One-line responsibility |
|---|---|
| `checkCalendarForInterviews()` | Time-triggered scan; detects DWYP-prefixed calendar events via Calendar API v3. |
| `processFormSubmission(e)` | Form-submit trigger; resolves identity, fires Herald Bio, writes FormContext file. |
| `buildFormContextFile(...)` | Writes verbatim Q&A from form submission to Contact Library folder. |
| `resolveIdentity(signals)` | Concierge logic: email → name+org → name; creates stub if no match. |
| `createContactStub(signals)` | Header-driven write of a new contact row (v1.5 schema, 23 cols). |
| `createEpisodeRecord(...)` | Header-driven write of a new episode row (v1.5 schema, 14 cols). |
| `runSecretaryForNewEvent(...)` | Orchestrator for a new calendar event: folders, manifest, episode row, Herald handoff. |
| `handlePotentialReschedule(...)` | Detects date change on existing episode; patches row and spawns task. |
| `createEpisodeFolder(parentFolderId, folderName)` | Creates a Drive subfolder; sole authority for episode folder structure. |

---

**`herald_fairy.js`** — Research agent. Owns guest identity research, bio writing, social field extraction, and guest brief generation. Called by Secretary (automatic).

| Function | One-line responsibility |
|---|---|
| `runHerald(contactId, episodeUid)` | Orchestrator: identity check → Bio → Brief. |
| `runHeraldBio(contactId)` | Gemini-grounded research → writes Bio_Summary, social fields, Organization to Contacts tab. |
| `runHeraldBrief(contactId, episodeUid)` | Generates guest brief Google Doc in Contact Library; spawns Review_Guest_Brief task. |
| `checkGuestIdentity(...)` | Gemini identity confirmation; returns {confirmed, possibleMatches}; fail-open. |

---

**`vert_fairy.js`** — Content pipeline agent. Owns three pipeline tracks (A/B/C). All tracks auto-triggered by the `dailyPulse()` content chain (Stage 2 / `in_production`) except Track C (manual).

| Function | One-line responsibility |
|---|---|
| `gatherVertContext(epUid, agentName)` | Assembles transcript, guest brief, manifest, and staging folder for a run. |
| `buildEpisodeIndexPrompt(context)` | Builds the structured prompt for Track A index generation. |
| `buildEpisodeIndexV2(epUid, opts)` | **Track A.** Reads injected transcript via Claude; produces structured Episode Index v2 (.md) with speaker attribution, topic segments, ranked hooks/quotes. Patches `manifest.episode_index_v2`. |
| `runEditorialPass(epUid, opts)` | **Track B.** Rewrites show notes in JT's voice using in-template brand voice sections + Episode Index v2. Patches `manifest.show_notes`. |
| `materializeQuoteGraphicAssets(epUid, opts)` | **Track C (Bridge).** Reads Episode Index v2 for ranked hooks/quotes; writes Asset_Library rows (Caption_Host with signoff) for quote graphics and reel caption stubs. |
| `_bridgeParseRankedItems_(sectionText, labelPrefix)` | Parses hooks (N. text) and QUOTE N: blocks; defensive defaults, vocabulary validation, all anomalies logged. |
| `_appendCaptionSignoff_(captionText)` | Reads CAPTION_SIGNOFF from governance; appends to caption text; idempotent (no double-append). |

---

**`artist_fairy.js`** — Image production agent. **Stripped to single function (janitorial 2026-06-05):** `runArtistFairy` and all image-pipeline helpers deleted; sole survivor is `exportSlidesToPng`.

| Function | One-line responsibility |
|---|---|
| `exportSlidesToPng(presentationId)` | Exports each slide in a presentation as PNG to the same Drive folder. Called from Track C / dev_tools Stage 5. |

---

**`clerk_fairy.js`** — Webhook router. Owns `doPost()` exclusively. No business logic. **No active routes (AD #24 rebuild queued).**

| Function | One-line responsibility |
|---|---|
| `doPost(e)` | Parses webhook JSON; logs "no active routes" error for all payload types (Clerk rebuild queued, AD #24). |

---

**`filing_fairy.js`** — Archive agent. Moves Staging folder wholesale to Finished; patches manifest and Episodes row. Triggered by nightly housekeeping on the Sunday after release.

| Function | One-line responsibility |
|---|---|
| `runFilingFairy(epUid)` | Patches manifest + Episodes tab, then moves Staging folder to Finished Episodes. |

---

**`housekeeping.js`** — Nightly maintenance runner. Pipeline block parsing, subfolder repair, episode archival, and Mending Fairy AI repair pass.

| Function | One-line responsibility |
|---|---|
| `runHousekeeping()` | Nightly entry point: runs per-episode maintenance (parsePipelineBlock → repairStagingSubfolders → runMendingFairy) then archive sweep. |
| `parsePipelineBlock(epUid)` | Reads raw transcript, parses the DWYP PIPELINE DATA block, writes raw_hooks / raw_quotes / image_prompts to manifest. |
| `repairStagingSubfolders(epUid)` | Ensures full Staging subfolder tree exists; creates any missing folders without touching existing ones. |
| `archiveLiveEpisodes()` | Sweeps Episodes for Status=live where Release_Date + 5 days ≤ today; calls runFilingFairy() for each. |
| `parseHooksSection()` / `parseQuotesSection()` / `parseImagePromptsSection()` | Section-specific parsers for the pipeline block. |
| `runMendingFairy(epUid, status)` | Orchestrator: loads manifest + ledger, calls I4/I1/O1 ops, commits `mend_ledger` patch. Pre-release guard (`in_production`\|`ready_to_release`). |
| `_mend_I4_txtRegen(epUid, prodFolderId, ledger)` | I4 op: writes missing `.txt` caption sidecars for PNGs in Manual_Exports/. Caption sourced from Asset_Library. T1 auto, 3-attempt backoff. |
| `_mend_I4_buildCaptionMap(epUid)` | Reads Asset_Library for episode (skips reels); returns map of `_safeFilename(Display_Name)` → `Caption_Host`. |
| `_mend_I1_reconcile(epUid, prodFolderId, manifest, ledger)` | I1 op: compares `guest_name` / `contact_id` between manifest and Episodes row. Fill-when-absent: backoff. Conflict: immediate task + `task_spawned`. |
| `_mend_O1_guestBioEnrich(epUid, contactId, contact, ledger)` | O1 op: runs `runHeraldBio(contactId)` when Bio_Summary is empty or 'Enrichment Pending'. No signals: immediate task. Escalate: task with research hint. |
| `_mendDecide(ledger, key, maxAttempts)` | Backoff axis: returns 'run' / 'skip' / 'escalate' based on ledger entry state and attempt count. |
| `_mendUpdate(ledger, key, status, bumpAttempts)` | Writes/updates a ledger entry; bumps attempt count when bumpAttempts is true. |

---

**`dev_tools.js`** — Manual test wrappers. Not deployed to production users. Safe to call from Apps Script editor.

Paste the target episode UID into `ACTIVE_EP_UID` at the top of the file before running any wrapper. Covers: system triggers (`dailyPulse`, `checkCalendarForInterviews`), all three pipeline tracks, Artist Fairy + PNG export, and Mending Fairy (`test_runMendingFairy`).

---

### Web App Files

**`dwyp_app.js`** — GAS web app server. Owns `doGet()` and all client-callable functions (called via `google.script.run` from the UI). Grouped by domain:

| Domain | Key Functions |
|---|---|
| **App shell** | `doGet(e)` — serves `dwyp_ui.html`; `sanitizeEmail()`, `validatePin()` |
| **Versioning** | `getAllVersions()`, `getDomainVersion()`, `getDomainsBatch()` |
| **Episodes** | `getEpisodes()`, `getActiveEpisodes()`, `getEpisodeManifest()`, `approveEpisodeForRelease()`, `completeFinalEpisodeUpload()`, `completeReelRevision()`, `removeFinalEpisodeUpload()`, `reconcileFinalEpisodeSlot()` |
| **Tasks** | `getTasks()`, `createTask()`, `writeTaskComplete()`, `deleteTaskRow()` |
| **Contacts** | `getContacts()`, `updateContactField()`, `createContactFromApp()`, `enrichContactFromApp()` |
| **Social / Assets** | `getPublishSchedule()`, `unscheduleAsset()`, `unscheduleAssetById()`, `getSocialAssets()`, `writeSocialAssetStatus()` |
| **Schedule surface** | `getScheduleData()`, `placeAssetSchedule()`, `removeAssetFromSchedule()`, `sendImageToSchedule()`, `sendReelToSchedule()`, `unscheduleReel()`, `exportSingleScheduleAsset()`, `exportAllSchedule()` |
| **Asset Library** | `getAssetLibraryRow()`, `patchAssetLibraryRow()`, `rejectAsset()`, `deleteSocialAssetByAssetLibraryId()`, `getSocialAssetCandidateCounts()`, `getAssetDisplayState()`, `updateCaption()` |
| **Canvas / Studio** | `saveAssetDraft()`, `saveDerivativeAsset()` |
| **Background Library** | `getBackgroundLibrary()`, `getPrecompBgImages()`, `uploadBackgroundToLibrary()`, `deleteBackgroundFromLibrary()`, `deleteBackgroundPhoto()`, `generateBackground()`, `saveBackgroundToLibrary()` |
| **Review** | `listReviewFiles()`, `moveReviewFile()`, `submitEpisodeRevisionRequest()`, `submitImageRevision()`, `submitReelRevision()`, `submitEpisodeComments()`, `writeVideoStatus()` |
| **Reels** | `getReelStreamUrl()`, `getReelsForEpisode()`, `syncReelAssets()`, `generateReelCaption()`, `updateReelDisplayName()`, `requestReelRevision()`, `closeReelRevision()` |
| **Content gen** | `getEpisodeHooksAndQuotes()` |
| **Companion** | `companionChat()` — single entry point for all four surfaces (Episode, Images, Reels, Schedule) |
| **Quick Captions** | `getQuickCaptions()`, `continueQuickCaption()` — Gemini multimodal caption flow |
| **Fairy triggers** | `runVertFairyForEpisode()`, `approveGuestBriefEnrich()`, `triggerFilingFromTask()` |
| **Logging** | `appendEpisodeLogEntry()` |
| **Episode Index** | `stLoadEpisodeIndex()` — loads full episode transcript for Studio context |

---

**`dwyp_ui.html`** — Client-side SPA. Served by `doGet()`. All user interaction happens here.

Surfaces:
- **Episodes tab** — episode list, episode detail, review workflow
- **Contacts surface (Studio)** — left-rail root item; card feed with in-place editing, desktop Add overlay, mobile Quick Add + dupe warn, per-card Enrich; mobile chrome below 700px (`body.ct-active`); right rail reserved for Phase 2 Companion. `ct-*` function/CSS family. Legacy #app-shell Contacts tab is dead chrome (shell never shown).
- **Studio tab** — Guest-name root nav accordion (Images, Reels, Episode, Schedule per guest; one guest expanded at a time); Write → Brainstorm; Tasks → Episodes/Buckets. Design as standalone root surface retired (Hub May 2026). Canvas editor, H&Q chips, export wired under guest → Images/Reels. Episode view split: `#stEpVideoWrap` (top) + `#stEpShowNotesWrap` (bottom, inert). Rail Remodel Pass 1/1.5/1.6 complete.

Key client-side patterns:
- `google.script.run.withSuccessHandler(...).withFailureHandler(...)` — all server calls
- `st` object / `stRagContext` — global Studio state; `stRagContext` holds raw Episode Index v2 blob loaded by `stLoadEpisodeIndex()` for all Claude chat calls
- Render-on-send: Canvas_State JSON is the authored artifact; PNG rendered at export time via `exportAssetToDrive()`, not at save time
- Studio surface cache: `st._cache` — session-scoped in-memory cache for Images/Reels/Episode/Schedule. Helpers: `_cacheGet`, `_cacheSet`, `_cacheIsStale`, `_cacheInvalidate`. Pattern: cache hit → render immediately → background `getAllVersions()` staleness check → quiet refetch if bumped. `stSyncFlush()` — global cache flush triggered from avatar-menu Sync button; re-triggers captured surface loader in place.

---

## Pipeline Flow — End to End

```
INTAKE
  Google Calendar event (DWYP prefix) or Form submission
    → secretary_fairy.js: checkCalendarForInterviews() / processFormSubmission()
        → resolveIdentity() → create or match contact
        → createEpisodeRecord() + Drive folders (Raw, Staging, subfolders)
        → writeManifest() — episode_manifest.json initialized
        → runHerald() handoff

RESEARCH
  herald_fairy.js: runHerald(contactId, episodeUid)
    → checkGuestIdentity() — Gemini grounded identity check
    → runHeraldBio() — Gemini research → Bio_Summary + social fields → Contacts tab
    → runHeraldBrief() — generates guest brief Google Doc → Contact Library
    → spawns Review_Guest_Brief task for JT

RECORDING → (human step: Audra uploads finished transcript to Staging/Episode/)

TRANSCRIPT PIPELINE — auto-triggered by dailyPulse() content chain (Stage 2 / in_production)
  fairy_circle.js: dailyPulse()
    → scans each non-complete episode's Staging/Episode/ folder for a transcript file
    → Condition A: transcript present + episode_index_v2 absent → buildEpisodeIndexV2 (Track A)
    → Condition B: episode_index_v2 set + show_notes absent → runEditorialPass (Track B)
    → At most one condition fires per episode per pulse run
    (Track C — materializeQuoteGraphicAssets — not yet auto-triggered; run manually via dev_tools.js)

IMAGE PRODUCTION — retired
  artist_fairy.js: runArtistFairy() removed; file stripped to exportSlidesToPng() only.

TRACK A — Episode Index v2
  vert_fairy.js: buildEpisodeIndexV2(epUid)
    → Vertex RAG + Claude
    → Structured doc: speaker-attributed segments, timestamps, topic markers, ranked hooks/quotes

TRACK B — Editorial Pass
  vert_fairy.js: runEditorialPass(epUid)
    → Reads brand voice corpus + Episode Index v2
    → Generates JT-voice show notes rewrite
    → Writes editorial doc to Staging

TRACK C — Bridge (Quote Graphic Assets)
  vert_fairy.js: materializeQuoteGraphicAssets(epUid)
    → Reads Episode Index v2 for ranked hooks + quotes
    → Writes Asset_Library rows: type=Quote_Graphic, status=candidate
    → Writes reel caption stubs to existing Asset_Library Reel rows

DESIGN (Studio — JT)
  dwyp_ui.html + dwyp_app.js
    → Studio guest → Images: JT edits quote graphic canvas, caption, background
    → exportAssetToDrive() → PNG + .txt companion rendered server-side → Manual_Exports/ subfolder
    → placeAssetInSlot() → schedules post in Social_Assets

ARCHIVE
  housekeeping.js: archiveLiveEpisodes()  [nightly — Sunday after release]
    → filing_fairy.js: runFilingFairy(epUid)
      → patches manifest (phase = 4_Archived, status = complete)
      → patches Episodes row (Status = complete)
      → moves Staging folder wholesale to Finished Episodes
```

---

## Key Architectural Patterns

### Routing (locked — never bypass)
All sheet access goes through `getMasterSheetId()`. The only exception is `getGovernance()`, which reads MASTER_SHEET_ID directly from Script Properties as a bootstrap step. Routing `getGovernance()` through the helper would create infinite recursion.

### Version Stamps
All write paths call `bumpVersion(domain, callerName)`. Client reads `getAllVersions()` on load; stale check on cache miss. Domains (Versions tab): tasks, episodes, contacts, asset_library, image_library, manifests, governance_config, brand_voice, playbook, content_sensitivity, audit_trail.

### Episode Manifest
`episode_manifest.json` lives in the episode's staging folder. It is the backbone of pipeline state — tracks phase, fairy dispatch history, asset doc IDs, and herald flags. Every pipeline stage reads and patches the manifest.

### Dual-JSON Canvas
Studio asset canvas stores state in two forms: a full base64 Fabric.js JSON object in `pb.cardCanvases[assetId]` (client memory only), and a stripped JSON string sent to the server for persistence. PNG is never rendered at edit time — it is rendered by the server at export/dispatch (render-on-send).

### LLM Calls
All Claude calls go through `callClaudeAPI()`. Gemini calls use `callGeminiAPIGrounded()` (web search) or `callGeminiAPINoSearch()` (pure extraction). `STUDIO_LLM_MODE = "claude"` is the governance key for all Studio text generation — no branching on this.

### Triggers
| Trigger | Function | Frequency |
|---|---|---|
| Time-based | `checkCalendarForInterviews()` | Every N hours (Secretary) |
| Form submit | `processFormSubmission(e)` | On form submit |
| Time-based | `dailyPulse()` | Daily |
| Time-based | `triggerNightlyHousekeeping()` | Nightly |
| Drive change | `onCorpusFolderChange(e)` | On corpus folder modification |

Triggers always run as production — `isStaging()` returns false in trigger context. Test trigger-path code via `dev_tools.js` manual invocation.

---

## Sheet Tab Reference

| Tab | Owner | Purpose |
|---|---|---|
| Governance_Config | Audra | All API keys, folder IDs, model names, config values |
| Episodes | Secretary, Filing | Episode records (14 cols, v1.5 schema). Col 12 was `Images_Status` (retired, inert); now `Final_Episode_ID` — Drive file ID of the final mastered episode. |
| Contacts | Secretary, Herald | Contact records (23 cols, v1.5 schema) |
| Tasks | fairy_circle | Action items for Audra / JT |
| Audit_Trail | fairy_circle | All system events (never truncated) |
| Episode_Log | fairy_circle | Per-episode notes, revision requests, commentary |
| Asset_Library | Bridge, Studio | All social asset candidates (images, reels, quote graphics) |
| Social_Assets | Studio | Scheduled post records |
| Versions | fairy_circle | Version stamps by domain |
| Posting_Schedule | Audra | Slot template driving the week accordion (one row per slot) |
| User_Registry | Audra | User identity, role, PIN, buckets |
| Reference | — | Single-row config values (schema undocumented) |
| Social_Posts | — | Scheduling sheet (schema undocumented in these docs) |

> `Master_Template` is **not a sheet tab** — it is an external Google Doc read via `MASTER_TEMPLATE_ID` / `extractPrompt()`.

---

## Drive Folder Structure (per episode)

```
RAW_PRODUCTION/
  {EUID}_{GuestName}/          ← rawFolderId

STAGING_DRAFTS/
  {EUID}_{GuestName}/          ← Production_Folder_ID (stagingFolderId)
    episode_manifest.json
    ShowNotes_{EUID}.gdoc
    Editorial_{EUID}.gdoc      (Track B output)
    EpisodeIndex_v2_{EUID}.gdoc (Track A output)
    Episode/                   (finished video — Audra uploads)
    Images/
      Approved/                (PNGs approved for social)
      Save/
      Delete/
    Thumbnails/
    Reels/
      Approved/
      Save/
      Delete/
```

Contact Library folder (per contact, separate from episode):
```
CONTACT_LIBRARY/
  {GuestName}/
    FormContext_{contactId}.txt
    GuestBrief_{episodeUid}.gdoc
```
