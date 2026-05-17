# DWYP_Codebase_Map.md
**Version:** 1.0 | May 2026
**Purpose:** Hub-session orientation. Describes what each file owns, what its major functions do, and how the pipeline flows end to end. Written at responsibility level — not implementation detail — so it stays accurate across code iterations.

---

## Tech Stack

- **Runtime:** Google Apps Script (GAS), server-side JavaScript
- **Data store:** Google Sheets (Master Sheet), Google Drive (episode folders, Docs, Slides)
- **UI:** Single HTML file (`dwyp_ui.html`) served by `doGet()` as a GAS web app
- **LLM:** Claude API (primary), Gemini (secondary/grounded search), Vertex AI RAG (brand corpus)
- **AppSheet:** Mobile app reads/writes sheets directly; triggers GAS via webhooks

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
| `getAllVersions()` / `getDomainVersion()` | Read paths call these to check staleness before fetching. |
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
| `appendRevisionComment(...)` | Writes a revision comment to the episode's RevisionNotes doc. |
| `draftPhaseEmail(emailConfig)` | Drafts a Gmail message (does not send). |
| `dailyPulse()` | Time-triggered orchestrator; runs 4 loops: recording reminder, release reminder, video-ready detection, corpus sync. |
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

**`herald_fairy.js`** — Research agent. Owns guest identity research, bio writing, social field extraction, and guest brief generation. Called by Secretary (automatic) or manually from AppSheet.

| Function | One-line responsibility |
|---|---|
| `runHerald(contactId, episodeUid)` | Orchestrator: identity check → Bio → Brief. |
| `runHeraldBio(contactId)` | Gemini-grounded research → writes Bio_Summary, social fields, Organization to Contacts tab. |
| `runHeraldBrief(contactId, episodeUid)` | Generates guest brief Google Doc in Contact Library; spawns Review_Guest_Brief task. |
| `checkGuestIdentity(...)` | Gemini identity confirmation; returns {confirmed, possibleMatches}; fail-open. |

---

**`vert_fairy.js`** — Show notes + content pipeline agent. Owns three pipeline tracks plus the original show notes pass.

| Function | One-line responsibility |
|---|---|
| `runVertFairy(epUid)` | Pass 1 orchestrator: Vertex RAG query → show notes doc → Episode Index → Artist handoff. |
| `gatherVertContext(epUid, agentName)` | Assembles transcript, guest brief, manifest, and staging folder for a run. |
| `queryVertexShowNotes(context, agentName, epUid)` | Sends Vertex RAG + Claude call to generate raw show notes. |
| `generateEpisodeIndex(context, showNotesContent, agentName, epUid)` | Pass 2: generates the Episode Index doc (deep knowledge, searchable). |
| `buildEpisodeIndexV2(epUid, opts)` | **Track A.** Produces a structured, timestamped Episode Index v2 document with speaker attribution and topic segmentation. |
| `runEditorialPass(epUid, opts)` | **Track B.** Rewrites show notes in JT's voice using brand voice corpus + Episode Index v2 as input. |
| `materializeQuoteGraphicAssets(epUid, opts)` | **Track C (Bridge).** Reads Episode Index v2 for ranked hooks/quotes; writes Asset_Library rows (Slot_Tags, Quality_Score, Caption_Draft with signoff) for quote graphics and reel caption stubs. Slide_Index write retired. |
| `runReelEditorialPass(epUid, {force=false})` | **Reel Editorial.** Batches all Reel-type AL rows for episode into one Claude call; writes cleaned Reel_Summary + Slot_Tags + Quality_Score. Idempotent (skips scored rows unless force:true). |
| `_bridgeParseRankedItems_(sectionText, labelPrefix)` | Parses v2.3 HOOK N: / QUOTE N: blocks with inline SLOT_TAGS + QUALITY_SCORE; defensive defaults, vocabulary validation, clamping, all anomalies logged. |
| `_parseReelEditorialOutput_(responseText)` | Parses Claude's reel editorial response into {asset_id, summary, slot_tags, quality_score} objects; same defensive rules as bridge parser. |
| `_appendCaptionSignoff_(captionText)` | Reads CAPTION_SIGNOFF from governance; appends to caption text; idempotent (no double-append). |
| `cleanHooksWithClaude(content, agentName, epUid)` | Post-processes raw hook list for format consistency. |

---

**`artist_fairy.js`** — Image production agent. Owns slide deck population for all template types and PNG export.

| Function | One-line responsibility |
|---|---|
| `runArtistFairy(epUid)` | Orchestrator: builds placeholder map, populates each slide deck template, exports PNGs to Staging. |
| `buildPlaceholderMap(...)` | Assembles all substitution values (hooks, quotes, image prompts, headshots) from manifest + show notes doc. |
| `populateSlideDeck(...)` | Copies a template deck, substitutes placeholders, exports slides as PNG to a named subfolder. |
| `processSlide(...)` / `processGroup(...)` | Walks slide elements and groups; applies text + image substitutions. |
| `exportSlidesToPng(presentationId)` | Calls Slides API to export each slide as PNG; returns array of image blobs. |

---

**`clerk_fairy.js`** — Webhook router. Owns `doPost()` exclusively. No business logic.

| Function | One-line responsibility |
|---|---|
| `doPost(e)` | Parses AppSheet webhook JSON; routes on `type` field to `runFilingFairy()` or `scribeLetSchedule()`. |

---

**`filing_fairy.js`** — Archive agent. Owns episode preflight check and packaging to Finished folder.

| Function | One-line responsibility |
|---|---|
| `preflightCheck(epUid, agentName)` | Validates all required assets are present before Filing runs. |
| `runFilingFairy(epUid)` | Packages episode: moves files from Staging to Finished folder, patches manifest and Episodes row. |
| `findGuestBriefInContactLibrary(...)` | Helper used by Vert Fairy to locate the guest brief doc by contact ID. |

---

**`housekeeping.js`** — Corpus maintenance + pipeline block parser. Called nightly or manually.

| Function | One-line responsibility |
|---|---|
| `runHousekeeping()` | Nightly job: corpus sync, stale episode checks, log pruning. |
| `parsePipelineBlock(epUid)` | Reads a Show Notes doc and parses the DWYP PIPELINE DATA block into structured sections. |
| `parseHooksSection()` / `parseQuotesSection()` / `parseImagePromptsSection()` | Section-specific parsers for the pipeline block. |
| `syncCorpusFolder()` | Syncs the brand corpus Drive folder to Vertex AI RAG; imports new/changed files. |
| `importFileToRagCorpus(fileId, fileName)` | Imports a single file into the Vertex RAG corpus. |
| `onCorpusFolderChange(e)` | Drive change trigger; fires incremental corpus sync on folder modification. |

---

**`dev_tools.js`** — Manual test wrappers. Not deployed to production users. Safe to call from Apps Script editor.

Contains test entry points for all three pipeline tracks (`buildEpisodeIndexV2`, `runEditorialPass`, `materializeQuoteGraphicAssets`) plus individual fairy invocations by episode UID. All wrappers use `IW_TEST_UID` or prompt for a UID.

---

### Web App Files

**`dwyp_app.js`** — GAS web app server. Owns `doGet()` and all client-callable functions (called via `google.script.run` from the UI). Grouped by domain:

| Domain | Key Functions |
|---|---|
| **App shell** | `doGet(e)` — serves `dwyp_ui.html`; `sanitizeEmail()`, `validatePin()` |
| **Versioning** | `getAllVersions()`, `getDomainVersion()`, `getDomainsBatch()` |
| **Episodes** | `getEpisodes()`, `getActiveEpisodes()`, `getEpisodeManifest()`, `getEpisodeReviewContext()`, `checkReadyForRelease()`, `triggerReadyForRelease()` |
| **Tasks** | `getTasks()`, `createTask()`, `writeTaskComplete()`, `deleteTaskRow()` |
| **Contacts** | `getContacts()`, `updateContactField()` |
| **Social/Publish** | `getPublishSchedule()`, `placeAssetInSlot()`, `unscheduleAsset()`, `unscheduleAssetById()`, `rescheduleAsset()`, `addPostingSlot()`, `getSocialAssets()`, `writeSocialAssetStatus()` |
| **Asset Library** | `getAssetLibraryRow()`, `patchAssetLibraryRow()`, `rejectAsset()`, `deleteSocialAssetByAssetLibraryId()`, `getSocialAssetCandidateCounts()`, `getAssetDisplayState()` |
| **Canvas / Studio** | `saveAssetDraft()`, `exportAssetToDrive()`, `addToWeekAsImage()` |
| **Background Library** | `getBackgroundLibrary()`, `getPrecompBgImages()`, `uploadBackgroundToLibrary()`, `deleteBackgroundFromLibrary()`, `deleteBackgroundPhoto()`, `generateBackground()`, `saveBackgroundToLibrary()` |
| **Review** | `listReviewFiles()`, `moveReviewFile()`, `submitEpisodeRevisionRequest()`, `submitImageRevision()`, `submitReelRevision()`, `submitEpisodeComments()`, `writeVideoStatus()` |
| **Reels** | `getReelStreamUrl()`, `generateReelCaption()`, `getOrGenerateReelSummary()`, `ensureReelSummaries()`, `updateReelDisplayName()` |
| **Content gen** | `generatePublishCaption()`, `generateReelTitleCard()`, `getEpisodeHooksAndQuotes()`, `enrichQuoteAssetsFromTranscript()`, `generateWithClaude()` |
| **Quick Captions** | `getQuickCaptions()`, `continueQuickCaption()` — Gemini multimodal caption flow |
| **Fairy triggers** | `runVertFairyForEpisode()`, `approveGuestBriefEnrich()`, `triggerFilingFromTask()` |
| **Logging** | `appendEpisodeLogEntry()` |
| **Episode Index** | `stLoadEpisodeIndex()` — loads Episode Index v2 doc for Studio context |

---

**`dwyp_ui.html`** — Client-side SPA. Served by `doGet()`. All user interaction happens here.

Surfaces:
- **Episodes tab** — episode list, episode detail, review workflow
- **Contacts tab** — contact list, contact detail
- **Studio tab** — Publish surface: week view, asset canvas, caption editor, scheduling

Key client-side patterns:
- `google.script.run.withSuccessHandler(...).withFailureHandler(...)` — all server calls
- `pb` object — global publisher state (selected episode, asset canvases, slot assignments)
- `pb.cardCanvases[assetId]` — full base64 canvas JSON per asset (in-memory only; stripped version sent to server)
- Render-on-send: Canvas_State JSON is the authored artifact; PNG rendered at dispatch time, not save time
- Version cache: client stores domain versions; checks `getAllVersions()` on load and before stale reads

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

RECORDING → (human step: Audra uploads finished episode to Staging/Episode/)

PRODUCTION TRIGGER
  fairy_circle.js: dailyPulse() Loop D
    → detects Video_Status = "ready"
    → spawns Review_Episode task for JT
    → JT approves → triggers Vert Fairy

SHOW NOTES (Pass 1)
  vert_fairy.js: runVertFairy(epUid)
    → gatherVertContext() — transcript + guest brief + manifest
    → queryVertexShowNotes() — Vertex RAG grounding + Claude generation
    → writes Show Notes Google Doc to Staging root
    → generateEpisodeIndex() — Pass 2: Episode Index doc in index folder
    → patchManifest() — show_notes doc ID locked
    → runArtistFairy() handoff

IMAGE PRODUCTION
  artist_fairy.js: runArtistFairy(epUid)
    → buildPlaceholderMap() — hooks, quotes, image prompts, headshots
    → populateSlideDeck() × N — each template type (host graphics, guest graphics, thumbnails)
    → exportSlidesToPng() → writes PNGs to Staging/Images/

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

PUBLISH (Studio — JT)
  dwyp_ui.html + dwyp_app.js
    → Studio tab: week view shows Social_Assets schedule
    → Asset canvas: JT edits quote graphic, caption, background
    → saveAssetDraft() → dual-JSON: full base64 stays client-side, stripped JSON → server
    → exportAssetToDrive() → PNG rendered server-side → Drive → Social_Assets row
    → placeAssetInSlot() → schedules post

ARCHIVE
  filing_fairy.js: runFilingFairy(epUid)  [triggered via AppSheet webhook → clerk_fairy.js doPost()]
    → preflightCheck() — validates all required assets
    → packages episode to Finished folder
    → patches Episodes row (Status = complete)
    → patches manifest (phase = 5_Complete)
```

---

## Key Architectural Patterns

### Routing (locked — never bypass)
All sheet access goes through `getMasterSheetId()`. The only exception is `getGovernance()`, which reads MASTER_SHEET_ID directly from Script Properties as a bootstrap step. Routing `getGovernance()` through the helper would create infinite recursion.

### Version Stamps
All write paths call `bumpVersion(domain, callerName)`. Client reads `getAllVersions()` on load; stale check on cache miss. Domains: episodes, contacts, tasks, versions, social_assets, asset_library, background_library.

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
| AppSheet webhook → doPost() | `runFilingFairy()` | On AppSheet action |

Triggers always run as production — `isStaging()` returns false in trigger context. Test trigger-path code via `dev_tools.js` manual invocation.

---

## Sheet Tab Reference

| Tab | Owner | Purpose |
|---|---|---|
| Governance_Config | Audra | All API keys, folder IDs, model names, config values |
| Episodes | Secretary, Filing | Episode records (14 cols, v1.5 schema) |
| Contacts | Secretary, Herald | Contact records (23 cols, v1.5 schema) |
| Tasks | fairy_circle | Action items for Audra / JT |
| Audit_Trail | fairy_circle | All system events (never truncated) |
| Episode_Log | fairy_circle | Per-episode notes, revision requests, commentary |
| Asset_Library | Bridge, Studio | All social asset candidates (images, reels, quote graphics) |
| Social_Assets | Studio | Scheduled post records |
| Versions | fairy_circle | Version stamps by domain |
| Master_Template | Governance | Prompt library (read via `extractPrompt()`) |

---

## Drive Folder Structure (per episode)

```
RAW_PRODUCTION/
  {EUID}_{GuestName}/          ← rawFolderId
    ProductionNotes_{EUID}.gdoc

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
