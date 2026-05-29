# DWYP Operations Platform — Platform Reference
**Version: 3.4 | May 2026**
**Type: Stable reference — append only. Decisions and history do not change once locked.**
**Companion: DWYP_Platform_State.md (active working state)**

---

## What This Document Is

Stable half of the platform documentation. Locked architectural decisions, authoritative schema, codebase inventory, folder structure, approval gate design, breaking changes, and schema drift reference. When something moves from in-progress to done, a summary is appended here and cleared from State.

---

## Architectural Decisions — Locked

> ADs 9, 46–47, 56–58, 60–68, 70–71, 79–88 removed (fully superseded by retired features: Marcom Fairy, Safety Fairy, Image Workshop, Frame.io, old Preservation Mandate). See git history for removed text.

1. **CRM-first, podcast-first UX.** Contacts is the primary object. JT's surface feels guest/podcast-first.
2. **No emoji statuses.** Plain enums everywhere. (Emoji in task `actionTitle` freetext is technically compliant — decision pending on spirit-of-rule enforcement.)
3. **No Evergreen_Registry.** Identity lives in Contacts tab.
4. **Episode foreign key is `Contact_ID`, not `Guest_Email`.**
5. **Episode_Log replaces Revision_Log.** Entry types: `revision | feedback | note | system`. `Visible_To`: `both | audra_only | jt_only`.
6. **Bootstrap pattern.** `getGovernance()` reads `MASTER_SHEET_ID` from Script Properties → `SpreadsheetApp.openById()`. Sheet-bound project.
7. **Manifest pattern carries forward.** Jason Protocol architecturally unchanged. Folder/UID lookup remaps to Episodes tab.
8. **Intake is a hard gate.** Signed off. No further changes without explicit design session.
10. **Prose behavior in templates, not code.** All audience-facing copy and AI prompt behavior controlled through Master Template.
11. **PoP is legally separate from DWYP.** Contacts and financials must never be commingled. Workstream field enforces this at data level.
12. **Safety Fairy mission statement: Truth over Sanitation.** Curse words not flagged by default. Logic lives in Content Sensitivity doc, not code.
13. **Raw transcript timestamps shift after editing.** Safety Fairy flag output timestamps reflect raw transcript position only.
14. **Episode UID format: time-based.** `EP-YYMMDD-HHmm`. Defined once in `fairy_circle`. No local overrides.
15. **Returning guest context (Podcast_Player_Copy): deferred.** Feature removed from `herald_fairy` pending storage design. Revisit after first end-to-end test.
16. **Approval gate is subfolder-level — Artist Fairy handoff only.** `_ready` suffix on subfolder name is the handoff signal from Audra to Daily Pulse for Artist Fairy output. **Superseded for Images/Reels review:** New review flow uses file-presence detection in `Images/` and `Reels/` root folders — no `_ready` suffix involved. See Asset Review Flow (locked).
17. **Artist Fairy spawns no tasks.** Audra signals readiness via `_ready`.
18. **Filing Fairy is Audra-triggered.** Single `doPost()` call from task button. Preflight check is the safety net.
19. **AppSheet retired.** Web app (shadow-build) is the primary frontend. AppSheet is no longer in use.
20. **`createEpisodeFolder()` is private to `secretary_fairy`.** Not promoted to `fairy_circle`.
21. **Initial manifest shape locked.** Fields: `episode_uid, contact_id, guest_name, recording_date, raw_folder_id, staging_folder_id, status, phase, created_at, herald_form_data`.
22. **Approval state authority is Episodes tab.** `Video_Status` and `Images_Status` written by web app on JT action. GAS does not independently verify.
23. **`Workflow_Step` is system-written.** GAS sets this field; no locked Enum list governs writes. Known values: `Review_Guest_Brief` | `Review_Episode` | `Review_Images` | `Review_Host_Graphics` | `Review_Guest_Graphics` | `Review_Thumbnails` | `Review_Reels` | `Revise_Reels` | `Revise_Episode` | `Filing` | `Produce_Episode` | `Upload_Produced_Episode` | `Custom_Images` | `Review_Social_Assets` | `Post_Social` | `Review_Episode_Card`
24. **`clerk_fairy.gs` owns `doPost()`.** Routes: `filing` → `runFilingFairy()`, `invite` → `scribeLetSchedule()`. `filing_fairy` exposes `runFilingFairy()` as callable entry point only. ⚠️ *`invite → scribeLetSchedule()` route is dead — Scribe Fairy retired (AD #111). Update when Clerk Fairy rebuild opens.*
25. **Scribe Fairy is a new file, not a port.** Five defined touchpoints. No `doPost()`.
26. **Filing and Scribe stay separate files.**
27. **AppSheet webhook actions use POST + JSON body.** `doGet()` / query string pattern retired.
28. **Episode_Sequence and Release_Date are plain values.** GAS never writes either column. Manually managed. Load-bearing constraint.
29. **App-triggered invite creates Gmail draft only.** JT creates calendar event manually. Secretary fires when recording date appears on calendar.
30. **Three Scribe T1 template variants.** `SCRIBE_LETS_SCHEDULE_LINK_KEY`, `SCRIBE_LETS_SCHEDULE_SUGGESTED_KEY`, `SCRIBE_LETS_SCHEDULE_MANUAL_KEY`.
31. **Guest denial path: web app only.** `Relationship_Type` update. No GAS required. Contact record and history preserved.
32. **Form submission always triggers Herald.** `processFormSubmission()` fires `runHeraldBio()` directly.
33. **Personal Note is JT-only.** System never writes to it. Simple overwrite — no append or timestamp logic.
34. **`herald_form_data` flag lives in manifest.** Secretary checks it before Herald handoff. If true, skips `runHerald()`.
35. **Sheet helper promotion pattern.** New lookup helpers defined locally. Promoted to `fairy_circle` only when a second consumer exists.
36. **`Pipeline_Status` is a web app virtual field.** GAS never writes it. Derived client-side.
37. **`callerName` parameter pattern established** for shared lookup helpers in `fairy_circle`.
38. **Episode Card created by Marcom, not Secretary.** *Correction: Marcom retired (AD #89). Episode titles and show notes are now Claude-generated via Vert pipeline (AD #97). Secretary creates the card structure.*
39. **Guest Brief lookup via Contact Library.** Not episode Staging folder.
40. **`Contact_Library_Folder_ID` lives on Contacts tab.**
41. **Production Notes lives in Raw folder.** Guest Brief lives in Contact Library folder.
42. **Roundtable episodes: permanent Roundtable contact record.** `Contact_ID` on episode row points to a manually-created Roundtable contact (`Source = manual`, `Relationship_Type = Roundtable`). Actual guest names in freetext `Guest_Name` field.
43. **Guest tab retired.** All fields migrated to Contacts tab. No Guest tab references remain in codebase.
44. **Contacts tab is the single contact authority.** Role flags (`Is_Guest`, `Is_Sponsor`, `Is_Donor`) retired — replaced by `Relationship_Type` EnumList on Contacts tab. `Relationship_Type` describes both role and relationship state.
45. **Headshot URL pattern.** Herald detects `_headshot` in filename in Contact Library folder, resolves Drive URL (`uc?export=view&id=FILE_ID`), writes to `Headshot_URL` on Contacts tab.
48. **Google Slides export: manual.** Audra exports via personal script, drops image files into asset subfolders. Artist Fairy unchanged.
49. **Shadow-build is the primary frontend.** Custom HTML/JS web app deployed as GAS web app. Auth: Google OAuth. Data: Sheets API reads + `clerk_fairy doPost()` writes. AppSheet is retired.
50. **Web app security filter.** `HOST_EMAIL` from Governance_Config. JT sees only tasks where `Assignee = HOST_EMAIL` OR `Assignee` is blank. Audra sees all tasks.
51. **Approve action in web app writes `Video_Status` on episode row directly.** Does not depend on Courier Fairy or Frame.io webhooks.
52. **`DAILY_DIGEST_TIME` governance key intentionally blank.** Pulse trigger time managed in Apps Script trigger UI only.
53. **Non-fatal failure paths.** Integrations spawn recovery tasks when external calls fail — pipeline must not block on third-party availability.
54. **Idempotency is a core GAS design principle.** All loops check before spawning to prevent duplicate tasks.
55. **Drive folder IDs, not names, are load-bearing.** Folder lookups use Drive folder IDs across all fairies.
59. **Mending Fairy — `correctGuestName()` is the canonical fix for guest name errors.** Corrects name across: Contacts tab, Episodes tab, Tasks, Drive folder names, manifest, Production Notes. Logs all changes to Audit_Trail. Triggered manually. Build after Carrie Sipe episode completes.
69. **JT is a Claude Pro subscriber.** JT has her own Claude Pro account. This enables direct Claude.ai access for creative sessions independent of the platform's API calls.
72. **Frame.io retired entirely. In-app review replaces all Frame.io workflows.** Frame.io removed from the stack. All review workflows (episodes, reels, images) handled natively in the DWYP web app. Make.com Frame.io scenario deprecated. Clerk Fairy webhook receiver not built. `Frameio_Project_ID` column on Episodes tab is retired.
73. **Episode review uses a proxy video on GCS.** Audra exports a proxy from DaVinci Resolve and uploads it to GCS bucket `dwyp-review-playback` at path `episodes/{EUID}/proxy.mp4`. One proxy per episode; a new upload overwrites the old. Player is native `<video>` fed by a V4-signed GCS GET URL (8h expiry, re-minted on every open). Drive `Staging/Episode/` subfolder still receives the finished transcript; no proxy file is placed there.
74. **Episode detection is task-completion based.** Audra marks the `Upload_Produced_Episode` task complete after uploading to GCS. `completeUploadEpisode()` in `dwyp_app.js` handles: mark task complete, flip `Video_Status → review`, spawn `Review_Episode` task, bump `episodes` + `tasks` versions. Drive folder-watch (Loop A) is retired. `Upload_Produced_Episode` task carries `Payload_Link` = GCS bucket console deep-link.
75. **`Proxy_File_ID` column (Episodes col 15) — dormant.** Was written by the retired Loop A drive-watch. GAS no longer writes it; review player resolves video from GCS path by EUID alone. Column stays in sheet — no destructive column removal without explicit decision.
76. **In-app Episode Review gate.** Review_Episode task stays open until Filing Fairy closes the episode. Timestamped comments sent by JT create or append to a Revise task for Audra. Request Revisions spawns revision task for Audra, task remains open.
77. **Social_Assets loop in Daily Pulse: queued.** Candidate row creation on file detection — not yet built.
78. **GCS signing — signBlob path (locked).** `getEpisodeStreamUrl()` uses IAM signBlob API (`https://iam.googleapis.com/v1/projects/-/serviceAccounts/{SA}:signBlob`). Signer: `309883149140-compute@developer.gserviceaccount.com`. Auth: owner's `ScriptApp.getOAuthToken()` (`cloud-platform` scope in manifest). V4 canonical request: `UNSIGNED-PAYLOAD`, `host` signed-headers only, credential scope `{date}/auto/storage/goog4_request`. No stored JSON key. Prerequisite: `iamcredentials.googleapis.com` API enabled in GCP Console.
89. **Vert Fairy / Vertex AI RAG Engine replaces Marcom Fairy entirely.** Marcom Fairy retired. Vert Fairy: automated pipeline, Show Notes → Artist Fairy handoff, triggered by Daily Pulse on finished transcript. Social Vert and Librarian Vert as named sub-roles were subsequently retired (AD #97) — superseded by Vert (retrieval) + Claude (generation) model. Herald stays on Gemini API permanently — web search is a hard requirement for guest research. See AI Layer Architecture section.
90. **Tasks is the primary home screen.** `renderDashboard()` is the entry point. Episode cards at top (action state, release pill, four tappable icons); loose tasks at bottom (Podcast · People · Personal containers). Release_Date is the sole sort key for episode cards — recording date is display context only, never a sort signal. TBD episodes sort below all dated episodes.
91. **EH flag is implemented via `Influence_Tier = "EH"` on the Contacts tab.** No separate `Everyday_Hero` column. `EH` is a valid `Influence_Tier` enum value (LF | HI | EH). The EH toggle in the Contacts front end writes `Influence_Tier = "EH"`. Herald reads `Influence_Tier` to detect EH guest designation. No trigger fires on EH toggle.
92. **Guest Brief removed from task flow.** Brief auto-closes after Herald creates it. JT pulls directly from Contact Library when she is ready. Guest Brief Enrich (Audra) and Guest Brief Review (JT) tasks remain in the pipeline, but the brief itself is not surfaced via a task card in the dashboard.
93. **Vertex AI RAG corpus relocated to us-south1 (Dallas) with Spanner vector backend.** Previous corpus (us-central1, Managed Agent Retrieval) is retired. Working configuration: us-south1, Spanner. All GAS functions querying the corpus must reference us-south1 explicitly. Governance key: `VERTEX_RAG_REGION = us-south1` — must be populated in Governance_Config before Vert Fairy spoke opens. `STUDIO_CORPUS_ID` must be updated to reflect the new us-south1 corpus resource path.
94. **Snapping spoke closed.** Center button in Publish canvas covers the alignment need. No further snapping work planned.
95. **Secretary Governance_Config field notes (locked).** `DWYP_CALENDAR_ID`: must be in `xxx@group.calendar.google.com` format for shared calendars, or an email address for personal calendars. Advanced Service uses this directly — no `CalendarApp` wrapper. `CALENDAR_TRIGGER_PREFIX`: must be `DWYP Interview` with no trailing space. Secretary uses server-side `startsWith` match on event summary. Sleep behavior: 3-second pause fires *between* events, not before the first — single-episode scans have zero added delay.
96. **Image Workshop fully retired.** Replaced by the Publish canvas in Studio. Social Vert retired with it. No bones carried forward. Code removed in Spoke 1 spring clean.
97. **AI layer simplified: Vert retrieves, Claude generates.** Vert (Vertex AI RAG) is the retrieval layer only — it queries the corpus and delivers chunks to Drive docs or Claude. Claude API is the generation layer for all human-facing copy. GAS orchestrates. Gemini handles image generation (GenGem) and Herald web search permanently. `Social Vert` and `Librarian Vert` as named personas are retired — the roles are now just Vert (retrieval) and Claude (generation). Claude introduces itself as Claude in Studio chat.
98. **Single governance key for all Claude text generation: `STUDIO_LLM_MODE = claude`.** Replaces `PUBLISH_LLM_MODE`. Code-level Gemini fallback on Claude API failure — automatic, logged to Audit_Trail. No manual toggle.
99. **Asset Library is the single source of truth for all content assets.** `Social_Assets` tab handles scheduling and Make integration only. Asset Library stores: asset metadata, content text, Drive file ID, canvas state JSON (Fabric.js serialization for 1:1 reconstruction), background reference, captions, reel summaries. One row per asset. Permanent — rows are never deleted.
100. **Canvas state serialized to Asset Library on Add to Week.** `canvas.toJSON()` stored in `Canvas_State` column. `canvas.loadFromJSON()` rebuilds exact editable state on slot re-entry. Enables 1:1 reconstruction and episode switching without loss.
101. **Preservation Mandate replaced with intentional deletion policy.** Original mandate ("never simplify, rename, or thin any function") was a guardrail against Gemini's aggressive pruning. Replaced with: nothing gets removed without an explicit decision. Renames and dead code removal require explicit approval. Active function behavior is never changed without a confirmed design decision.
102. **Studio tab structure (updated May 2026).** Four tabs: Design / Write / Outreach / Ideas. Publish tab retired — Design is the sole landing route. Old mode list (Show Notes, Episode Copy, Interview Prep, Social Media, Newsletter, Brainstorm) retired — replaced by tab structure. ~7,000 lines of `pb*` code removed. See AD #116. Episode Index data model: see § AI Layer Architecture in this doc.
103. **Episode index created by Vert on Daily Pulse trigger.** Index is a permanent markdown document per episode stored in `EPISODE_SEARCH_INDEX_KEY` Drive folder. Vert retrieves corpus context; Claude writes the index content (episode summary, hooks, quotes, image prompts, starter captions, transcript map). Reel descriptions are the only living section — updated by Daily Pulse on reel add/remove. Template: `DWYP_Episode_Index_Template.md`.
104. **Quick Caption retired as standalone feature.** Caption generation moves to Daily Pulse audio extraction path: reel upload detected → audio extracted → transcription → episode index reel descriptions → Studio surfaces captions pre-populated.
105. **Optimistic UI pattern adopted for approve/save/place actions.** UI updates immediately; GAS writes async. On GAS failure: UI reverts, toast shown, failure logged to Audit_Trail.
106. **Progressive image loading adopted.** Thumbnails render first; high-res swaps in on load. Drive thumbnail URLs used for initial render.
107. **Image caption grounding requirements (locked).** Every image caption call must include: `Quote_Text` (exact quote on canvas, from Asset_Library), `Speaker` (host or guest), `HOST_NAME` (from Governance_Config), guest name (from episode record), episode topic/emotional core (from episode record), brand voice (from `BRAND_VOICE_ID` doc). Required prompt instruction: *"Do not restate the quote. Write a caption that responds to it — what does this quote make someone feel? What does it mean for someone sitting with pain right now? Write in JT's voice. Short, punchy, direct. End with 'Link in bio.'"* Caption regenerates automatically when a new quote is placed on the canvas — not on a manual tap.
108. **Reel caption grounding requirements (locked).** Every reel caption call must include: `Reel_Summary` (Gemini audio summary for this specific reel, from Asset_Library), guest name, episode topic (from episode record), brand voice. `Reel_Summary` must exist before caption generates — if null, show "Summarizing reel…" and trigger the summary call first. Required prompt instruction: *"Write a caption for this reel clip. Use the summary as your source — the caption should reflect what's actually in this clip, not the episode generally. Write in JT's voice. 2–3 lines maximum. End with 'Link in bio.'"*
109. **Asset_Library row creation triggers (locked).** Reel: Daily Pulse detects reel file in Drive → row created immediately. Bank_Clip: Audra adds to bank → row created at that moment. Quote_Graphic: `materializeQuoteGraphicAssets` (Bridge Fairy, Track C) reads Show Notes Doc → one row per hook or guest quote, written in a single batch. Thumbnail: Artist Fairy or equivalent → one row per variant. Social_Assets row is created only on Add to Week (commit). Social_Assets row is deleted (clean delete — no cancelled status) on Unschedule.
110. **Unschedule flow (locked).** (1) Social_Assets row deleted. (2) Asset_Library `Status` → `available`. (3) Asset_Library `Availability` → `available`. (4) If Quote_Graphic: find sibling row (same `Slide_Index`, same `Episode_UID`) → `Availability` → `available`. (5) Slot clears in Panel 2. Asset reappears in candidate pool.
111. **Scribe Fairy retired. Never deployed.** Pipeline email events now spawn Writer email tasks (JT autonomous). Seven blank template keys migrate to Writer Email quick-start templates. Scribe Fairy joins Safety Fairy and Marcom Fairy as a dead-code stub under the intentional deletion policy (AD #101). `clerk_fairy.gs` AD #24 route `invite → scribeLetSchedule()` is dead — address when Clerk Fairy rebuild opens. Retirement confirmed Reframe #8, May 2026.
112. **Quote attribution schema (QUOTE blocks).** Guest-quote blocks in Master Template `# Show Notes` section carry attribution on a dedicated `ATTRIBUTION:` line, not inline with the quote text. Block format: `QUOTE N: "[quote text]"` / `ATTRIBUTION: [Guest First Name Last Name]` / `SLOT_TAGS: [tags]` / `QUALITY_SCORE: [1-5]`. `_bridgeParseRankedItems_` (vert_fairy.js) reads the `ATTRIBUTION:` line and reconstructs `Quote_Text` as `"[quote text]" — [Name]` — this is the canonical downstream format; no downstream caller changed. Missing `ATTRIBUTION:` logs WARNING to Audit_Trail and passes bare quote text through — no hard fail. HOOK blocks have no `ATTRIBUTION:` line and parse unchanged. `materializeQuoteGraphicAssets` consumes `Quote_Text` by field name.
113. **Master Template voice injection: in-template sections, not external docs.** Brand-voice and show-philosophy content lives in keyed sections of the Master Template and is composed into prompts at call time via `extractPrompt("# Section Name")`. `BRAND_VOICE_ID`, `CAPTION_VOICE_SUPPLEMENT_ID`, and `DELIVERABLES_VOICE_SPEC_ID` governance keys are retired (all blanked 2026-05-19). `extractPrompt` matches on literal section-key text as plain text lines beginning with `# `; not dependent on Google Docs heading styling. Call-site composition: Guest Brief (herald_fairy.js) — `# Show Philosophy`, `# Pillars`, `# Peer Shows` assembled into `brandContext`, substituted for `${brandVoice}` token. Editorial pass (vert_fairy.js `runEditorialPass`) — `# Host Voice`, `# Voice Prohibitions`, `# Caption Mechanics`, `# Ranking Schema`, `# Show Notes`. Soft-fail contract: empty `extractPrompt` return logged per-section to Audit_Trail, generation continues — a voiceless prompt that silently succeeds is the failure mode this guards against; `test_extractPromptSmokeTest` is the verification gate. `buildEpisodeIndexV2` has no injection point (pure Vertex RAG retrieval, no Claude calls). `_buildEditorialPassSystemInstruction_` signature: `(masterTemplateStructure)`; retains hardcoded voice-prohibitions block as redundant safeguard.
114. **Transcript-as-source-of-truth (locked hub decision 2026-05-22).** The finished transcript placed in `Staging/Episode/` is the single source of truth for all copy passes. Track A (`buildEpisodeIndexV2`) and Track B (`runEditorialPass`) both read the transcript directly via `gatherVertContext()`. Neither route through Vertex RAG for transcript content — Vertex RAG provides cross-episode context only, and is not in the critical path for either track.
115. **Caption field consolidation (Spoke 0, May 2026).** `Caption_Draft` and `Caption_Final` columns on Asset_Library renamed to `Caption_Host` and `Caption_Guest` respectively. Semantics preserved: `Caption_Host` (col 10) is Claude-generated and frozen after write; `Caption_Guest` (col 11) is JT-edited and the source of truth for card render and Make.com post. All GAS write paths updated. Schema v2.0.
116. **Publish tab retired (May 2026). Design is the sole landing route.** Studio tab structure reduced from five tabs to four (Design / Write / Outreach / Ideas). ~7,000 lines of `pb*` code removed from `dwyp_app.gs` and `dwyp_ui.html`. AD #102 updated.
117. **Staging-first deployment cadence retired (May 2026).** Code pushes directly to production. `STAGING_DEPLOYMENT_URL` blanked in Governance_Config — `isStaging()` returns false everywhere. Staging deployment exists but is not an active step in the release workflow. `getMasterSheetId()` always resolves the production sheet.
118. **Reel revision §4 atomic close — `Reels/Superseded/` subfolder.** `closeReelRevision()` creates `Reels/Superseded/` inside the episode Staging folder on first use. Superseded reel file moves here, evacuating it from Loop C's watched root (`Reels/`). Revised file lands in `Reels/` root → next Daily Pulse re-spawns `Review_Reels`. AL row `Drive_File_ID` updated in-place by `Asset_ID` (no new row). Open `Revise_Reels` task auto-completed on close. `bumpVersion` fires for both `asset_library` and `tasks` domains.
119. **Icon state machine retired; state rides the card in words.** The 3-color
machine (gold/red/gray = whose court) is retired. Navigation surfaces carry no state
signals. Persistent state is expressed as words on the card — In Revision (Audra's
court) / Ready for Review (JT's court) / scheduled / not. Novelty ("new since last
view") is a separate, ephemeral signal: a red circle on the card that clears on view,
never on a navigation rail. Design target for the Task surface (Push 3); not yet
built. Current Tasks screen cards carry a release pill + per-asset icons (see Platform
State) until that build.
120. **Episode Card = head + body.** HEAD (Tier 3, the gate): episode pipeline state —
Pending / In Revision / Ready for Review / Approved / Released; entry to Episode
Review; tempers the body (an unapproved episode must visibly caveat scheduled
outbound shown below it). BODY (uniform every episode): quote graphics (Tier 1,
quiet — scheduled/not), reels (Tier 2, loud — novelty ● / scheduled / not),
scheduling slots (open/filled). Asset loudness is set by predictability: Tier 1
auto/quiet, Tier 2 shifty/loud, Tier 3 gate. Work is entered by tapping a card
element; the element type is the route (no Target_Surface needed for card elements).
Design target for the Task surface (Push 3); not yet built.
121. **Task dispatch — two origins, two-tier ladder.** Card elements route by element
type (structural): empty image slot → Design; reel → Reels Review; head → Episode
Review. Real task rows (revisions, loose, coordination) route by a two-tier ladder:
(1) explicit `Target_Surface` stamped at creation — spawner knows the room; manual
creation stamps from context or a picker; talk-to-text parse stamps it if confident;
(2) floor = the directory itself — an empty target opens the task in the directory
with a route-or-resolve affordance, so misroute is impossible. `none` ≠ null: `none`
= intentional no-room (coordination / self-resolve → checkbox); `null` = unresolved
target → "route this" prompt; both floor to the directory but read differently. Parse
attempts a target, never gates on it.

**Task taxonomy — three independent axes:** Origin (system-spawned / manual /
self-assigned) · Scope (episode-linked `Episode_UID` / loose null / set-scoped
[parked, no live case]) · Destination (routes to a room / resolve-in-place).

**Tasks schema deltas (17 cols today):** add `Raw_Input` (talk-to-text keeper); add
`Target_Surface` enum (`design | writer | schedule | review | none` + null; vocab in
Governance_Config). Design target for the Task surface (Push 3); not yet built.
Reel-revision (§4) schema deps — S2-11 Status/Availability separation, reel-linkage
FK, `revision_requested` status — tracked in Build Playbook, not resolved here.

122. **GCS signed URL signing and resumable upload — org policy constraints + browser gotchas (May 2026).**

   **signBlob org policy:** `iam.automaticIamGrantsForDefaultServiceAccounts` is active on the wiseonewithin.com org — Owner alone does NOT implicitly grant `iam.serviceAccounts.signBlob` on the compute SA. The grant must be set explicitly at the project level (`roles/iam.serviceAccountTokenCreator` or equivalent). SA keys are also forbidden (`disableServiceAccountKeyCreation` + `disableServiceAccountKeyUpload` active) — stored-key approaches including HMAC are not viable. Keyless signing via `iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa}:signBlob` with the Apps Script OAuth token is the only path. Applies to both the playback GET URL and upload POST URL (both flow through `_signV4`).

   **CORS origin:** Confirmed origin is `https://n-z5do…-script.googleusercontent.com` (Apps Script sandbox host). If uploads CORS-fail in the future, read the exact origin from the DevTools console preflight error and update the bucket allow-list. A broader allow-list is the fallback if drift proves frequent — defer until it actually happens.

   **Browser gotchas for resumable uploads** (server-side examples don't warn about these):
   1. **Init can return 201, not just 200.** Handle both status codes when reading the `Location` session URI.
   2. **308 Resume Incomplete kills XHR.** Browsers fire `onerror` (status 0) on a 308 with no `Location` header — they treat it as a failed redirect. Use `fetch(redirect:'manual')` instead; a 308 resolves as `response.type === 'opaqueredirect'`.
   3. **Do not set `Content-Length`.** It is a forbidden request header in browsers. The browser computes it from the body. Attempting to set it throws a console error and may abort the request.

---

## Schema — Authoritative (v2.0)

> Authority: live Master Sheet as of May 2026.

### Contacts (23 columns)

| # | Col | Field | Type | Notes |
|---|---|---|---|---|
| 1 | A | Contact_ID | String (UUID) | Primary key. System-generated. |
| 2 | B | Display_Name | String | Required. |
| 3 | C | Influence_Tier | Enum: LF \| HI \| EH | JT-managed. LF = Large Following; HI = High Influence; EH = Everyday Hero. EH toggle in front end sets this field. |
| 4 | D | Email | String | Optional. Not a unique identifier. |
| 5 | E | Phone | String | Optional. |
| 6 | F | Website | URL | Optional. |
| 7 | G | Social_Instagram | URL | Herald extracts and writes. |
| 8 | H | Social_YouTube | URL | Herald extracts and writes. |
| 9 | I | Social_Podcast | URL | Spotify or Apple — one URL. Herald extracts and writes. |
| 10 | J | Social_LinkedIn | URL | Herald extracts and writes. |
| 11 | K | Social_X | URL | Herald extracts and writes. |
| 12 | L | Social_Other | URL | Catchall — TikTok, Facebook, etc. Herald extracts and writes. |
| 13 | M | Organization | String | Lower-third format: "Title, Role at Org". Herald extracts and writes. |
| 14 | N | Referred_By | String (freetext) | JT-managed. Never system-written. |
| 15 | O | Personal_Note | LongText | JT-only. Never system-written. Simple overwrite. Herald uses as research anchor. |
| 16 | P | Bio_Summary | LongText | Herald-written. 75-word hard limit. |
| 17 | Q | Tags | Multi-value | Freeform. JT-managed. Post-episode only. No automation writes Tags. |
| 18 | R | Relationship_Type | EnumList | Multi-value. Values include: Guest, Sponsor, Donor, Roundtable, Prospect, Denied. |
| 19 | S | Source | Enum: form \| manual | How contact entered the system. |
| 20 | T | Headshot_URL | URL | Herald-written. Drive direct-access URL. |
| 21 | U | Contact_Library_Folder_ID | String | Drive folder ID for this contact's library assets. Hard required for Guest Brief. |
| 22 | V | Created_At | Timestamp | System-set on creation. |
| 23 | W | Last_Activity | Timestamp | Written by `updateLastActivity()`. Updated by secretary_fairy.gs (contact stub creation) and herald_fairy.gs (enrichment, brief). Used to sort Contacts list desc. Added Phase 1.3. |

### Episodes (14 columns)

| # | Col | Field | Type | Notes |
|---|---|---|---|---|
| 1 | A | Episode_Sequence | Integer | Manually managed. GAS never writes. AD #28. |
| 2 | B | Release_Date | Date | Manually managed. GAS never writes. AD #28. |
| 3 | C | Episode_UID | String | Primary key. Format: `EP-YYMMDD-HHmm`. |
| 4 | D | Contact_ID | String | Foreign key → Contacts. |
| 5 | E | Guest_Name | String | Denormalized display name. Freetext for Roundtable. |
| 6 | F | Status | Enum: active \| complete \| archived | Secretary sets active on creation. |
| 7 | G | Raw_Folder_ID | String | Drive folder ID of the episode subfolder inside `02_RAW_PRODUCTION`. Secretary writes. |
| 8 | H | Production_Folder_ID | String | Drive folder ID of the episode subfolder inside `03_STAGING_DRAFTS`. Secretary writes. |
| 9 | I | Recording_Date | Date | Secretary writes on calendar match. |
| 10 | J | Calendar_Event_ID | String | Google Calendar event ID. Secretary writes on calendar match. |
| 11 | K | Video_Status | Enum: pending \| approved \| revision_requested | Web app writes on JT action. AD #22. |
| 12 | L | Images_Status | Enum: pending \| approved \| revision_requested | Web app writes on JT action. AD #22. |
| 13 | M | Episode_URL | URL | Podcast episode URL. Manually managed. |
| 14 | N | Episode_Type | Enum | Episode type (e.g., guest \| roundtable \| solo). Manually managed. |

### Tasks (17 columns)

| # | Col | Field | Type | Notes |
|---|---|---|---|---|
| 1 | A | Task_ID | String | Primary key. Format: `TASK-YYMMDD-HHMM-NNN`. |
| 2 | B | Action_Title | String | Human-readable task title. |
| 3 | C | Assignee | String | Email address. Required. |
| 4 | D | Assigned_By | String | Email or "The Fairy Team". |
| 5 | E | Status | Enum: open \| in_progress \| complete \| blocked | |
| 6 | F | Priority | Enum: normal \| urgent | |
| 7 | G | Due_Date | Date | Optional. |
| 8 | H | Contact_ID | String | Foreign key → Contacts. Optional. |
| 9 | I | Episode_UID | String | Foreign key → Episodes. Optional (manual tasks may be episode-agnostic). |
| 10 | J | Workflow_Step | String | System-written by GAS. Open vocabulary — see AD #23 for known values. Blank for manual tasks. |
| 11 | K | Executive_Summary | LongText | Context for the assignee. |
| 12 | L | Payload_Link | URL | Optional. Drive doc, review link, etc. |
| 13 | M | Revision_Notes | LongText | Optional. Context for revision tasks. |
| 14 | N | Created_At | Timestamp | System-set. |
| 15 | O | Completed_At | Timestamp | System-set on completion. |
| 16 | P | Note_Sent_At | Timestamp | Timestamp of last notification sent for this task. |
| 17 | Q | Asset_ID | String | FK → Asset_Library.Asset_ID. Set on revision tasks (`Revise_Reels`, `edit_vids`). Empty for all other task types. Added Reels Surface spoke 2026-05-24. |

### Episode_Log (9 columns)

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Log_ID | String (UUID) | Primary key. Format: `LOG-YYMMDD-HHMM-NNN` |
| 2 | Episode_UID | String | Foreign key → Episodes. |
| 3 | Timestamp | Timestamp | Auto-set. |
| 4 | Author | String | Who wrote this entry. |
| 5 | Entry_Type | Enum: revision \| feedback \| note \| system | |
| 6 | Asset_Type | Enum: video \| images \| general | |
| 7 | Body | LongText | For video feedback: `[MM:SS] comment text` format. |
| 8 | Resolved | Boolean | FALSE on creation. TRUE when Filing Fairy closes episode, or manually. |
| 9 | Visible_To | Enum: both \| audra_only \| jt_only | Defaults to both. |

### Asset_Library (20 columns)

Single source of truth for all content assets. One row per asset. Permanent — rows are never deleted. Canvas state stored for 1:1 reconstruction.

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Asset_ID | String (UUID) | Primary key. System-generated. |
| 2 | Episode_UID | String | Foreign key → Episodes. |
| 3 | Asset_Type | Enum: quote_graphic \| Reel \| thumbnail | All lowercase except Reel — validated by sheet data validation. Code must write exact values. |
| 4 | Drive_File_ID | String | Exported PNG (Quote_Graphic), reel file, or thumbnail file. |
| 5 | Display_Name | String | Human-readable name. Editable by JT (Reels). |
| 6 | Slide_Index | Integer | Content identity key for pairing. Quote_Graphic only. |
| 7 | Quote_Text | LongText | Hook or quote text placed on canvas. Quote_Graphic only. |
| 8 | Reel_Summary | LongText | Gemini-generated context description. Reels only. Used by caption generation. |
| 9 | Image_Prompt | LongText | Prompt used to generate background. Quote_Graphic only. |
| 10 | Caption_Host | LongText | Claude-generated caption. Frozen after AI write — never overwritten. (Formerly Caption_Draft — AD #115.) |
| 11 | Caption_Guest | LongText | JT-approved/edited caption. Source of truth for card render and Make.com post. (Formerly Caption_Final — AD #115.) |
| 12 | Notes | LongText | JT scratchpad. Not posted. |
| 13 | Background_ID | String | Drive file ID of background image from `IMAGE_BACKGROUND_LIBRARY_ID`. Quote_Graphic only. |
| 14 | Canvas_State | LongText | Fabric.js `canvas.toJSON()` serialization. Enables 1:1 reconstruction on slot re-entry. Quote_Graphic only. |
| 15 | Status | Enum: candidate \| scheduled \| bank \| rejected | |
| 16 | Availability | Enum: available \| placed \| paired | Controls candidate panel visibility. |
| 17 | Created_At | Timestamp | |
| 18 | Created_By | String | `system` for GAS rows. User email for manual rows. |
| 19 | Quality_Score | Integer (1–5) | Vestigial ranking artifact. Pipeline writes; rankings UI retired. Column retained — writes are by index. |
| 20 | Slot_Tags | String | Vestigial ranking artifact. Comma-separated Posting_Schedule Slot_IDs. Rankings UI retired. Column retained — writes are by index. |

### Social_Assets (13 columns)

Scheduling and Make integration only. Foreign key to Asset_Library. One row per scheduled post.

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Post_ID | String (UUID) | Primary key. System-generated. |
| 2 | Asset_Library_ID | String | Foreign key → Asset_Library. |
| 3 | Episode_UID | String | Foreign key → Episodes. Denormalized for querying. |
| 4 | Slot | String | Foreign key → Posting_Schedule tab. |
| 5 | Asset_Type | Enum: Quote_Graphic \| Reel \| Thumbnail | Denormalized from Asset_Library. |
| 6 | Platform | String | Target platform. |
| 7 | Caption | LongText | Final caption for this post. May differ from Asset_Library caption for platform variants. |
| 8 | Drive_File_ID | String | Denormalized from Asset_Library for Make. |
| 9 | Scheduled_At | Timestamp | |
| 10 | Scheduler_Status | Enum: pending \| queued \| posted \| failed | Make writes back. |
| 11 | Posted_At | Timestamp | Make writes on success. |
| 12 | Created_At | Timestamp | |
| 13 | Created_By | String | |

### Posting_Schedule (7 columns)

Drives the week accordion template. One row per slot. Static — lock after entry.

| Col | Field | Type | Notes |
|---|---|---|---|
| 1 | Slot_ID | String | Primary key (e.g., `SLOT-TUE-01`) |
| 2 | Day | Enum | Monday–Saturday |
| 3 | Asset_Type | Enum | Quote_Graphic / Reel / Thumbnail / Bank_Clip |
| 4 | Platform | String | Instagram / Facebook / LinkedIn / YouTube / TikTok (multi-platform allowed) |
| 5 | Why | String | One-line description shown in slot |
| 6 | Sort_Order | Integer | Display order within day |
| 7 | Ratio | Enum | 1:1 / 4:5 / 9:16 / 16:9 / null |

**Make handles time logic.** No time-of-day picker in UI. DWYP writes the day target; Make determines optimal post time.

### Audit_Trail (7 columns)

Append-only event log. All mutating operations, AI calls, and gate transitions write here.

| Col | Field | Type | Notes |
|---|---|---|---|
| 1 | Timestamp | DateTime | Event time |
| 2 | Event_Category | String | Originator (e.g., `Studio_ImageGen`, `Mending_Fairy`, `Schedule_Reel`) |
| 3 | Actor | String | User_ID or system identifier |
| 4 | Episode_UID | String | Foreign key — nullable |
| 5 | Contact_ID | String | Foreign key — nullable |
| 6 | Detail | String | Event payload — free-text or structured |
| 7 | Level | Enum | INFO / WARNING / ERROR |

**Write path:** `logToAuditTrail(category, eventType, foreignKey, level, detail)`. Help Desk Companion reads a recent slice (configurable window, default 7 days).

### User_Registry (3 columns)

| # | Field | Notes |
|---|---|---|
| 1 | User_ID | Google account email. Primary key. |
| 2 | Display_Name | Shown in task assignee display. |
| 3 | Role | Enum: host \| producer \| admin \| contributor |

**Live values:** `jt@wiseonewithin.com` (JT, host) | `audra@wiseonewithin.com` (Audra, producer)

### Versions (4 columns)

Cache invalidation foundation. One row per data domain. Written by `bumpVersion(domain, callerName)` in `fairy_circle.gs`. Added Phase 1.1.

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Domain | String | Identifies the data domain. See domain list below. |
| 2 | Version | Integer | Monotonically increasing. Bumped atomically on every mutation to that domain. |
| 3 | Last_Modified | Timestamp | ISO timestamp of last bump. |
| 4 | Modified_By | String | Calling function name or user identifier. |

**Domain rows (11):** `tasks` · `episodes` · `contacts` · `asset_library` · `image_library` · `manifests` · `governance_config` · `brand_voice` · `playbook` · `content_sensitivity` · `audit_trail`

`image_library` uses a Drive folder hybrid: GAS scans individual file modification timestamps to detect external uploads (see Performance Principle). All other domains are sheet-only.

### Governance_Config

Key-value store. No hardcoded strings in GAS code.

---

## Manifest — Field Reference

Fields written by GAS to the episode manifest JSON file in the Staging folder.

| Field | Writer | Notes |
|---|---|---|
| `episode_uid` | Secretary | Primary key. |
| `contact_id` | Secretary | |
| `guest_name` | Secretary | |
| `recording_date` | Secretary | |
| `raw_folder_id` | Secretary | |
| `staging_folder_id` | Secretary | |
| `status` | Various | Current episode status. |
| `phase` | Various | Current pipeline phase. |
| `created_at` | Secretary | |
| `herald_form_data` | Secretary | Boolean. True if Herald already ran from form. |
| `identity_pending` | Herald | Boolean. Set true on Enrichment Pending path. |
| `raw_hooks` | Vestigial — Social Vert retired. | Remove in Spoke 1 spring clean. |
| `raw_quotes` | Vestigial — Social Vert retired. | Remove in Spoke 1 spring clean. |
| `show_notes` | Vert Fairy (`runEditorialPass`) | Drive file ID of Show Notes doc. Track B. |
| `episode_index` | Vert Fairy | Drive doc ID of Episode Index doc (old Pass 2). Vestigial. |
| `episode_index_v2` | Vert Fairy (`buildEpisodeIndexV2`) | Drive file ID of Episode Index v2 doc. Track A. |
| `quote_graphic_assets_built` | Bridge Fairy (`materializeQuoteGraphicAssets`) | Boolean. Set true after Track C writes Asset_Library rows. |
| `quote_graphic_asset_count` | Bridge Fairy (`materializeQuoteGraphicAssets`) | Integer. Total rows written (hooks + guest quotes). |
| `artist_assets_complete` | Artist Fairy | Boolean. |
| `asset_ids` | Various | IDs of generated docs and assets. |

---

## Approval Gate Design

### Guest Brief Gate
- Herald writes Guest Brief doc to Contact Library folder.
- Herald spawns `Guest_Brief_Enrich` task for Audra with confidence level.
- Audra reviews, enriches, approves → `spawnGuestBriefReviewForJT()` → `Review_Guest_Brief` task for JT.
- JT's task auto-closes. JT pulls brief directly from Contact Library when ready.
- JT never receives a brief that hasn't been reviewed by Audra first.

### Episode Review Gate
- Audra uploads proxy mp4 to GCS bucket `dwyp-review-playback` at `episodes/{EUID}/proxy.mp4`.
- Audra marks `Upload_Produced_Episode` task complete → `completeUploadEpisode()` → `Video_Status → review` → `Review_Episode` task spawned for JT.
- JT watches via native `<video>` player (GCS V4-signed URL, 8h expiry). Marks timestamps, types notes, taps Send → creates or appends Revise task for Audra.
- Task stays open until Filing Fairy closes episode.

### Images / Reels Review Gate
- Audra drops files into `Staging/Images/` or `Staging/Reels/` root.
- Daily Pulse Loop B (Images) / Loop C (Reels) detects files → spawns `Review_Images` / `Review_Reels` task for JT (idempotent).
- Images sorter: arrow nav (← →), one asset at a time, Approve / Save / Delete per asset, auto-advance, Submit All.
- Reels sorter: scroll-based, tap-to-commit via moveReviewFile(), badges persist, Submit All.
- Untouched assets are banked (Save) on Submit All — JT is never penalized for indecision.
- Runway Reminder (D-7) has Ready for Release button. JT taps → confirmation popup → spawns Filing task for Audra.

### Social Assets Gate
- Studio canvas export lands in Staging/Images/ folder.
- Daily Pulse Social_Assets loop (queued — not yet built) creates candidate rows in Asset_Library.
- JT reviews via `Review_Social_Assets` task.

---

## Episode Review — Comments & Revise Sync

Two-way sync between JT's video review comments and Audra's Revise task. One Revise task per episode. Checkboxes populated automatically from JT's comments.

### Comment Card Fields

- Author (JT / Audra)
- Timestamp
- Video timecode (if commented during proxy playback — click jumps player to moment)
- Comment text
- Resolved / Unresolved toggle
- Delete (small, requires confirm)

### Comment States

| State | Meaning |
|---|---|
| Active | Unresolved — JT still wants it addressed |
| Resolved | Audra checked it off via Revise task. JT sees it dimmed. |
| Struck through | JT deleted or retracted. Still readable in Audra's task. Never gone. |
| JT self-resolved | She decided it was fine. No action needed from Audra. |

### Two-Way Sync Flow

1. JT comment → appears unresolved in panel.
2. Audra opens Revise task → comment surfaces as checkbox, timecode included.
3. Audra checks item → comment auto-resolves in JT's view.
4. JT edits comment → checkbox updates. Task never stale.
5. JT deletes comment → checkbox goes strikethrough in Audra's task. Permanent log.

### Schema Hook

Comments table needs `task_item_id` field linking to specific Revise task checkbox. Drives sync.

### Views

- **Active (default):** Unresolved comments full size. Resolved collapsed behind "Show resolved" toggle.
- **All:** Everything visible. Full audit trail.

---

## Design ↔ Publish Asset Travel

Design and Publish share the same Fabric.js canvas. Assets move between them with context preserved.

### Round Trip: Publish → Design → Publish

- Edit button in Publish navigates to Design with asset loaded. Context held: `publish_origin: { episode_uid, slot_id }`.
- In Design, two save actions when origin is held:
  - **Save & Stay** — saves, remains in Design.
  - **Save & Return** — saves, returns to correct Publish slot. Updated asset in place.

### Context Awareness

| Entry path | Save actions |
|---|---|
| Direct from nav | Save & Stay only |
| Via Edit from Publish | Save & Stay + Save & Return |

### Continue Card (Design canvas state)

- Design autosaves to a single manifest per episode on every debounced pause.
- On open, side panel shows Continue card with thumbnail + timestamp of last unsaved session.
- Tap to restore. Ignore to start fresh.
- Card clears on explicit Save or Save & Return.
- Cleared canvas = done. Continue card present = unfinished. No ambiguity.

---

## Folder Structure

```
02_RAW_PRODUCTION/
  EP-YYMMDD-HHmm_GuestName/          ← Raw folder (Raw_Folder_ID on Episodes tab)
    Production_Notes.gdoc
    [transcript file — raw]
    [headshot files]

03_STAGING_DRAFTS/
  EP-YYMMDD-HHmm_GuestName/          ← Production folder (Production_Folder_ID on Episodes tab)
    manifest.json
    Episode/
      [finished transcript]
      [finished episode video]
    Images/                           ← Files here → Daily Pulse Loop B → Review Images task
      Approved/                       ← Filing Fairy moves to Finished Episodes
      Save/                           ← Filing Fairy moves to REELS_ARCHIVE_FOLDER_ID
      Delete/                         ← Filing Fairy trashes
    Thumbnails/
    Reels/                            ← Files here → Daily Pulse Loop C → Review Reels task
      Approved/                       ← Filing Fairy moves to Finished Episodes
      Save/                           ← Filing Fairy moves to REELS_ARCHIVE_FOLDER_ID
      Delete/                         ← Filing Fairy trashes
      Superseded/                     ← §4 close moves superseded originals here (out of Loop C root watch)

04_FINISHED_EPISODES/
  EP-YYMMDD-HHmm_GuestName/          ← Filing Fairy moves here

CONTACT_LIBRARY/
  [Contact_ID]/                       ← Contact Library folder (Contact_Library_Folder_ID on Contacts tab)
    Guest_Brief.gdoc
    [headshot files: *_headshot.png/jpg]

IMAGE_BACKGROUND_LIBRARY_ID/         ← Shared background pool for Studio canvas
    [Gemini-generated backgrounds]
    [Audra-curated backgrounds]
```

---

## Codebase Inventory

| File | Role | Entry Point | Status |
|---|---|---|---|
| `fairy_circle.gs` | Shared utilities, Daily Pulse orchestrator | `dailyPulse()` | ✅ Active |
| `secretary_fairy.gs` | Episode creation, folder setup, scheduling | `runSecretary()` | ✅ Active |
| `herald_fairy.gs` | Guest research, bio, brief generation (Gemini API) | `runHerald()` | ✅ Active |
| `artist_fairy.gs` | Slide deck generation from Show Notes placeholders | `runArtistFairy()` | ✅ Active |
| `filing_fairy.gs` | Episode archival, asset moves, corpus import | `runFilingFairy()` | ✅ Active |
| `scribe_fairy.gs` | Guest communication touchpoints | `scribeLetSchedule()` et al. | ⛔ Retired (AD #111). Dead-code stub retained under intentional deletion policy. |
| `housekeeping.gs` | Nightly utility jobs, Mending Fairy (future) | `triggerNightlyHousekeeping()` | ✅ Active |
| `clerk_fairy.gs` | `doPost()` router | `doPost()` | 🔴 Rebuild queued |
| `vert_fairy.gs` | Corpus retrieval, episode index (Track A), show notes/editorial pass (Track B), quote graphic asset materialization (Track C / Bridge Fairy) | `runVertFairy()` · `buildEpisodeIndexV2()` · `runEditorialPass()` · `materializeQuoteGraphicAssets()` | ✅ Active — all three pipeline tracks live |
| `dwyp_app.gs` | Web app server, review backend, Studio backend, Contacts | `doGet()` | ✅ Active — Spoke 1 spring clean pending |
| `dwyp_ui.html` | Web app client | — | ✅ Active — Spoke 1 spring clean pending |
| `dev_tools.gs` | Manual test wrappers only. Never called by production. | `test_*` prefix | ✅ Active |
| `safety_fairy.gs` | **Retired.** Remove in Spoke 1 spring clean. | — | ⛔ Retired |
| `marcom_fairy.gs` | **Retired.** Remove in Spoke 1 spring clean. | — | ⛔ Retired |
| `social_fairy.gs` | **Retired.** Dead code. Remove in Spoke 1 spring clean. | — | ⛔ Retired |
| `dwyp_ouroboros.svg` | Brand logo + universal loading indicator. Inlined into `dwyp_ui.html` for `.dwyp-loader` component (CSS pulse animation, white background). Source of truth for the SVG path data. | — | ✅ Active |

---

## AI Layer Architecture — Locked (May 2026)

Clean four-layer model. Vert retrieves. Claude generates. GAS orchestrates. Gemini handles image generation and Herald permanently.

| Layer | Name | Technology | Role |
|---|---|---|---|
| Retrieval | Vert | Vertex AI RAG Engine (us-south1) | Queries corpus, delivers chunks to Drive docs or Claude. Never generates. |
| Generation | Claude | Claude API (`callClaudeAPI()`) | All human-facing copy — show notes, captions, hooks, chat responses. |
| Orchestration | GAS | Apps Script | Assembles packets, routes calls, writes outputs. Never generates. |
| Image generation | GenGem | Gemini image API | Canvas background generation only. Always Gemini. |
| Guest research | Herald | Gemini API (`callGeminiAPI()`) | Guest research, bio, Guest Brief generation. Always Gemini — web search hard requirement. |

**GAS is the nervous system, not a brain.** It knows when to call, what to send, where to write. Every API call is a stateless packet: system instruction + message history + injected context. Claude and Gemini only see what GAS sends.

**Social Vert and Librarian Vert as named personas are retired.** The roles are now Vert (retrieval) and Claude (generation). Claude introduces itself as Claude in Studio chat.

**Track A and Track B are transcript-direct (AD #114).** `buildEpisodeIndexV2` (Track A) and `runEditorialPass` (Track B) both call `gatherVertContext()` which reads the finished transcript from `Staging/Episode/` subfolder. Vertex RAG provides cross-episode context only — it is not in the critical path for either track. The table below shows Vertex in the pipeline; the operative source for episode-specific content is always the local transcript.

### Automated Pipeline (GAS-triggered)

| Stage | Technology | Role |
|---|---|---|
| Guest research | Herald → Gemini API | Bio, Guest Brief. No Claude involvement. |
| Show Notes | Vert → transcript + Claude | Track B: `runEditorialPass` reads transcript directly via `gatherVertContext()`. Claude writes show notes + podcast description. |
| Episode index | Vert → transcript + Claude | Track A: `buildEpisodeIndexV2` reads transcript directly via `gatherVertContext()`. Claude writes hooks, quotes, image prompts, captions, transcript map. |
| Quote graphic assets | Bridge Fairy → Claude | Track C: `materializeQuoteGraphicAssets` reads Show Notes doc → one Asset_Library row per hook or guest quote. |
| Reel descriptions | Daily Pulse → Gemini | Gemini processes reel audio. Claude not involved. |
| Canvas backgrounds | GenGem → Gemini image API | User-triggered. Always Gemini. |

### Interactive Surfaces (JT-facing, on-demand)

| Surface | Claude's role | Retrieval source |
|---|---|---|
| Studio — Publish tab | Caption iteration from starter pack | Episode index (index-first) |
| Studio — Write tab | Newsletter / longform copy generation | Vertex-first, cross-episode |
| Studio — Ideas tab | Brainstorm, interview prep | Vertex-first, on demand |
| Studio — chat | General creative generation | Episode index + Vertex as needed |

### Image Generation Models

| Model | Status |
|---|---|
| `gemini-2.5-flash-image` | ✅ Current production model |
| `gemini-3-pro-image-preview` (Nano Banana Pro) | ⚠️ Available. Requires thought-signature preservation across API calls — store full response `parts` arrays verbatim. |
| `gemini-2.0-flash-preview-image-generation` | ⛔ Retired |
| Imagen 3 | ⛔ Deprecated June 30, 2026 |

**Web search responsibility:** Gemini permanently. Vertex RAG cannot meet the web-search requirement.

**Claude API key:** stored as `CLAUDE_API_KEY` in `Governance_Config`.

### Episode Index — Studio's Knowledge Layer

Permanent markdown document, one per episode, stored in a dedicated Drive folder. Written by Vert Fairy during the show notes run. Studio reads it on open.

| Section | Source | Living? |
|---|---|---|
| Episode summary | Vert Fairy Pass 2 | No — evergreen |
| Guest profile snapshot | Herald + Secretary (intake) | No — evergreen |
| Hooks & quotes (transcript-sourced) | Vert Fairy Pass 2 | No — evergreen |
| Social asset seeds (image prompts + caption seeds) | Vert Fairy Pass 2 | No — evergreen |
| Key themes | Vert Fairy Pass 2 | No — evergreen |
| Transcript map (landmark-dense) | Vert Fairy Pass 2 | No — evergreen |
| Reel descriptions | Daily Pulse / Mending Fairy | Yes — updated on reel add/remove |

**Index folder:** Dedicated Drive folder, separate from episode asset folders. Governance key: `EPISODE_SEARCH_INDEX_KEY`.

**Retrieval strategy by surface:**

| Surface | Retrieval | Latency |
|---|---|---|
| Publish | Index-first; Vertex only if insufficient | Fast — pre-populated |
| Write | Vertex-first, cross-episode | Moderate — on demand |
| Studio chat (Claude) | Vertex-first | Moderate — on demand |

### Vertex AI RAG Engine — Setup (Complete April 2026)

- **GCP project:** DWYP RAG (`309883149140`)
- **Region:** us-south1 (Dallas) — us-central1, us-east1, us-east4 are restricted for new projects (allowlisted only)
- **Corpus:** `dwyp-studio-corpus`, `text-embedding-005`, **Spanner** vector backend
- **Parser:** Gemini 2.5 Pro (LLM parser for ingest)
- **Corpus resource path:** confirm in `STUDIO_CORPUS_ID` governance key — reflects us-south1 path
- **Auth:** `ScriptApp.getOAuthToken()` → RAG Engine direct call (200 confirmed)
- **Import pattern:** `ragFiles:import` POST, `resourceType: 2` (integer enum, not string)
- **Import status:** RESOLVED — document confirmed in corpus
- **Governance key:** `STUDIO_CORPUS_ID` ✅ populated (⚠️ confirm reflects us-south1 path), `VERTEX_RAG_REGION = us-south1` ⏳ must be added before Vert Fairy spoke

**What failed before us-south1 + Spanner:**
- Vector Search → QPS quota exceeded on every call
- Serverless → not available in us-south1
- Managed Agent Retrieval → Preview, failed
- Spanner in us-central1/us-east1/us-east4 → allowlisted projects only

**GCS bucket:** `dwyp_corpus_episodes` — intended as corpus source for future imports.

**Corpus sources (curated folder only):** Finished transcripts, Episode Cards, Guest Briefs, Brand Voice doc, Content Sensitivity doc, Ops Prompts doc (remove Image Creator section before populating), Brand Brain doc. Raw and Staging folders are never corpus sources.

### Transcript Source — Locked

| Source | Status |
|---|---|
| DaVinci Resolve (exported) | ✅ Preferred |
| Whisper (local) | ✅ Fallback |
| Gemini auto-transcription | 🔴 Future spoke |
| Riverside transcripts | ⛔ Never — hallucination risk |

Finished transcript placed manually in `Staging/Episode/` subfolder by Audra.

---

## Content Generation — Prompt Design Principles

Locked principles for prompts targeting Claude. Apply across all generation work — show notes, hooks, quotes, captions, chat.

- **Definition-first, not rules-first.** A section needs a clear definition of what it produces before rules are added. Adding rules to a section without a clear definition compounds drift; it does not fix it.
- **Hooks are synthesis, not recap.** A hook captures a universal or hidden truth drawn from the source material — not a summary of what the guest said. Address: collective "you," not third-person guest.
- **Five hook stances** (Claim, Paradox, Permission, Reframe, Statement of Cost) function as a jungle gym, not a cage. Internal orientation for Claude — does not surface in output.
- **Guardrails, not handcuffs.** Minimal, precise constraints outperform prescriptive rule stacks.
- **Surface internal contradictions; do not silently resolve.** Contradictions in the prompt (e.g., em-dash prohibition vs. attribution format) require explicit carve-outs — flag before resolving.

---

## Retired Patterns

| Pattern | Status |
|---|---|
| AppSheet as frontend | Retired (AD #19). |
| Frame.io for asset review | Retired (AD #72). |
| Make.com → Frame.io outbound | Retired (AD #72). |
| Gemini as Marcom fallback | Retired (AD #81). |
| Cowork + NotebookLM as primary Marcom path | Retired (AD #81). |
| Marcom Fairy | Retired (AD #89). Superseded by Vert Fairy + Vertex AI RAG Engine. |
| Safety Fairy | Retired. Dead code — remove in Spoke 1 spring clean. |
| Stable Diffusion for background generation | Deferred. Gemini image API is active path via Studio Design tab background generator. |
| `doGet()` / query string webhook pattern | Retired. POST + JSON body only. |
| Any read/write to Guest tab | Retired. All contact fields live on Contacts tab. |
| `fairyNudge` key in `spawnTask()` | Retired. Use `executiveSummary` only. |
| `Staging_Folder_ID` column | Renamed `Production_Folder_ID` in live sheet. Points to `03_STAGING_DRAFTS` episode subfolder. Distinct from `Raw_Folder_ID` (`02_RAW_PRODUCTION`). |
| `Relationship_Status` / Contact_Type enum | Replaced by `Relationship_Type` EnumList on Contacts tab. |
| `Pipeline_Status` AppSheet virtual column | Web app derives pipeline state client-side. |
| Secretary creating Frame.io project | Retired (AD #72). |
| Safety Fairy creating Frame.io project via Make.com | Retired (AD #72). `callMakeCreateProject()` is dead code. |
| Make.com Frame.io outbound scenario | Retired (AD #72). |
| Courier Fairy writing `Video_Status` via Frame.io webhook | Web app writes `Video_Status` directly on JT action (AD #72). |
| `Frameio_Project_ID` column | Retired (AD #72). Column stays in sheet but GAS must not write to it. |
| `MAKE_FRAMEIO_WEBHOOK_URL` / `FRAMEIO_WORKSPACE_ID` governance keys | Retired (AD #72). |
| `Social_Assets.Status` enum value `saved` | Corrected to `bank` — April 2026. |
| `_ready` suffix on asset subfolders for Images/Reels review | Retired. File-presence detection in Images/ and Reels/ root is the active pattern. |
| `prox_` filename prefix for proxy files | Corrected to `proxy_` prefix. Proxy lives in `Staging/Episode/` subfolder, not Production folder. |
| `transcript_index.json` Gemini chunk index | Retired with Marcom architecture. Vertex AI RAG Engine handles retrieval. |
| Safety Fairy auto-generating backgrounds at transcript intake | Retired. User-triggered via Studio Design tab background generator. |
| `raw_hooks` / `raw_quotes` written by Safety Fairy or Marcom | Both fairies retired. Social Vert retired. Fields are vestigial — remove in Spoke 1. |
| Episodes tab as standalone view | Retired (AD #90). |
| Snapping in Image Workshop | Closed (AD #94). Center button covers the alignment need. |
| Vertex AI RAG corpus in us-central1 with Managed Agent Retrieval | Retired (AD #93). us-south1 + Spanner is the working configuration. |
| Make.com PNG conversion for Image Workshop output | Retired. Image Workshop exports directly to Drive. |
| Image Workshop | Retired (AD #96). Replaced by Studio Publish canvas. |
| Social Vert persona | Retired (AD #97). Role replaced by Vert (retrieval) + Claude (generation). |
| Librarian Vert persona | Retired (AD #97). Studio chat is Claude. |
| Quick Caption standalone feature | Retired (AD #104). Caption generation moves to Studio Publish tab via episode index. |
| Preservation Mandate | Replaced (AD #101). Nothing removed without explicit decision. Renames and dead code removal require explicit approval. |
| `PUBLISH_LLM_MODE` governance key | Retired. Replaced by `STUDIO_LLM_MODE = claude`. |
| Social_Assets schema (17 columns, April 2026) | Replaced by Asset_Library (18 cols) + Social_Assets (13 cols) in schema v1.7. |
| Image Workshop Background Generator as standalone trigger | Retired with Image Workshop (AD #96). Background generation now accessed via Studio Design tab. |

---

## Build History

### v3.4 → v3.5 (May 2026)

- **Episode GCS player shipped.** `getEpisodeStreamUrl(episodeUid)` added to `dwyp_app.js` — mints a V4-signed GCS GET URL (`dwyp-review-playback/episodes/{EUID}/proxy.mp4`, 8h expiry) via IAM signBlob. Owner's `ScriptApp.getOAuthToken()` is the signer; `cloud-platform` scope already in manifest. No stored key. Episode Design tab (`stEpView`) repointed from Drive iframe to native `<video id="stEpVideo">` — compose loop (focus-pause-freeze-timestamp, send/cancel/resume) fully functional now that the element exists.
- **Episode detection replaced.** `completeUploadEpisode(rowIndex, episodeUid)` added — marks `Upload_Produced_Episode` task complete, flips `Video_Status → review`, spawns `Review_Episode`, bumps both `episodes` and `tasks` versions. UI handler `completeUploadEpisodeTask` added; `Upload_Produced_Episode` branch added to task button rendering. Daily Pulse Loop A (Drive folder-watch `proxy_` detection) retired in `fairy_circle.js`.
- **ADs 73, 74, 75, 78 updated.** Proxy-on-GCS, task-completion detection, `Proxy_File_ID` column dormant, signBlob signing pattern locked. AD #23 `Workflow_Step` known values extended: `Upload_Produced_Episode` added.
- **Governance keys required:** `REVIEW_GCS_BUCKET` = `dwyp-review-playback`; `GCS_SIGNER_SA` = `309883149140-compute@developer.gserviceaccount.com`; `GCS_EXPIRY_SECONDS` = `28800`. Populate before opening episode in Design tab.

---

### v3.3 → v3.4 (May 2026)

- **Reels sub-tab shipped.** Selector re-enabled in Studio Design tab with Drive `/preview` playback. `Caption_Host` wired to caption field; `generateReelCaption` calls Claude with `# Caption Mechanics` + `# Voice Prohibitions` system prompt, writes caption from `Reel_Summary`. Three action verbs: Export (copy→move to `Manual_Exports/`), Edit with Vids (spawns `edit_vids` task stub), Request Revision (§4 atomic close). `closeReelRevision`: swaps `Drive_File_ID` on AL row by `Asset_ID`, moves old file → `Reels/Superseded/`, completes open `Revise_Reels` task, `bumpVersion` both domains. AD #118 added.
- **Tasks schema extended to 17 columns.** `Asset_ID` (col 17, FK → Asset_Library) added for revision tasks. `spawnTask()` writes it header-driven. Schema v2.1. Manual step: add `Asset_ID` header in col 17 of Tasks tab in production Master Sheet.
- **`Workflow_Step` known values extended.** `Revise_Reels` added (AD #23 updated).
- **Folder structure updated.** `Reels/Superseded/` subfolder documented in Folder Structure and AD #118.

---

### v3.2 → v3.3 (May 2026)

- **Spoke 0 shipped: Caption field consolidation.** `Caption_Draft` → `Caption_Host`, `Caption_Final` → `Caption_Guest` on Asset_Library tab (cols 10–11). All GAS write paths updated. Semantics unchanged: Caption_Host is Claude-generated/frozen; Caption_Guest is JT-edited/source of truth for card render and Make.com post. AD #115 added.
- **Transcript-as-source-of-truth locked.** Hub decision 2026-05-22: finished transcript in `Staging/Episode/` is the single source of truth for all copy passes. Track A (`buildEpisodeIndexV2`) and Track B (`runEditorialPass`) both call `gatherVertContext()` to read transcript directly — Vertex RAG is not in the critical path for either. AD #114 added. AI Layer Architecture section updated.
- **Publish tab retired.** ~7,000 lines of `pb*` code removed from `dwyp_app.gs` and `dwyp_ui.html`. Studio tab structure: four tabs (Design / Write / Outreach / Ideas). Design is the sole landing route. AD #116 added; AD #102 updated.
- **Staging-first deployment cadence retired.** Code now pushes directly to production. `STAGING_DEPLOYMENT_URL` blanked in Governance_Config. AD #117 added.
- **Schema corrected to v2.0** (live sheet as of May 2026): Episodes (16→14 cols, complete column order correction), Tasks (14→16 cols, complete column order correction), Asset_Library (21→20 cols, Caption_Host/Caption_Guest rename, Display_Text removed, Quality_Score/Slot_Tags marked vestigial), Contacts (24→23 cols, Workstream removed).

---

### v3.1 → v3.2 (May 2026)

- **B6 #3 shipped: ATTRIBUTION-line parser.** `_bridgeParseRankedItems_` extended to parse the `ATTRIBUTION:` line from QUOTE blocks in Master Template v3.0 format. `Quote_Text` reconstructed as `"[quote text]" — [Name]`. Missing ATTRIBUTION logs WARNING to Audit_Trail, bare text passes through. HOOK blocks unchanged. AD #112 added.
- **B6 #2 shipped: `extractPrompt` consolidation / `${brandVoice}` retirement.** External doc injection via `BRAND_VOICE_ID`, `CAPTION_VOICE_SUPPLEMENT_ID`, `DELIVERABLES_VOICE_SPEC_ID` retired. Voice and show-philosophy content now sourced from in-template sections via `extractPrompt`. Note: `CAPTION_VOICE_SUPPLEMENT_ID` and `DELIVERABLES_VOICE_SPEC_ID` were marked "confirmed active" in v3.1 history — all three keys were blanked 2026-05-19 before B6 #2 opened; provisional foundation docs (`DWYP_Caption_Voice_Supplement_v0`, `DWYP_Episode_Deliverables_Voice_Spec_v1`) retired with them. AD #113 added.
- **Master Template v3.0 fully live.** Paste + B6 #3 + B6 #2 all shipped in one session. The "v3.0 fully live = paste + consolidation spoke" condition from Platform State coupling flag is met.
- **`test_extractPromptSmokeTest` added to `dev_tools.js`.** Tests all five new `extractPrompt` keys (`# Host Voice`, `# Caption Mechanics`, `# Show Philosophy`, `# Pillars`, `# Peer Shows`) against the live Master Template. Required pre-gate before first Meenakshi pipeline run.

---

### v3.0 → v3.1 (May 2026)

- **Track C shipped: Bridge Fairy (`materializeQuoteGraphicAssets`).** Pipeline closed — Vert → Claude → Bridge runs end to end. Verified on David Bedrick (EP-260430-1427): 16 Asset_Library rows (10 hooks + 6 guest quotes). First bridge-produced rows in Asset_Library. Quote_Text on guest quote rows includes full attribution (`"[text]" — David Bedrick`). Caption_Draft populated from label-paired STARTER CAPTIONS sections. All render-on-send fields (Drive_File_ID, Canvas_State, Background_ID, Image_Prompt) empty at creation. Status=candidate, Availability=available.
- **AD #109 updated:** Quote_Graphic row creation trigger corrected from "Claude cleanup layer" to `materializeQuoteGraphicAssets` (Bridge Fairy, Track C).
- **Asset_Library schema col 3 corrected:** Enum values are `quote_graphic | Reel | thumbnail` (mixed case per live sheet data validation). Code must write exact values.
- **New governance keys confirmed active:** `CAPTION_VOICE_SUPPLEMENT_ID` (Caption Voice Supplement doc — voice authority layer in Track B system instruction), `DELIVERABLES_VOICE_SPEC_ID` (Episode Deliverables Voice Spec doc — voice authority layer in Track B system instruction). Both degrade gracefully on missing key (WARNING logged, block skipped).
- **New foundation docs (provisional):** `DWYP_Caption_Voice_Supplement_v0` and `DWYP_Episode_Deliverables_Voice_Spec_v1` added to voice authority stack. Promote from provisional status once a second episode runs through the full pipeline and voice holds.
- **Manifest Field Reference updated:** `show_notes` writer corrected to `runEditorialPass` (Track B); `episode_index_v2` added (Track A); `quote_graphic_assets_built` and `quote_graphic_asset_count` added (Track C).
- **Codebase Inventory:** `vert_fairy.gs` updated to reflect all three pipeline tracks live (Track A / Track B / Track C). Bridge Fairy is an agent name (audit log actor), not a separate file — lives in `vert_fairy.gs`.

---

### v2.9 → v3.0 (May 2026)

- Asset_Library schema updated to v2.0 (21 columns): Quality_Score (col 19) and Slot_Tags (col 20) added retrospectively (existed in code since Phase 2 wiring; absent from Reference until now). Display_Text (col 21) added — JT-edited card text; source of truth for card stack render; null until first canvas edit. Caption_Draft note updated: frozen after AI write, never overwritten. Caption_Final note updated: source of truth for card render and Make.com post.
- Item 92 Phase 2 shipped: Fix 1 (base64 strip in save core), Fix A (Save→Export unified exit paths), Fix B (viewport reset in Tier 2 hydration), Fix C (dual-JSON save-core for synchronous Tier 1 reopen). Canvas State Architecture locked: Render-on-send and Dual-JSON patterns.
- Item 93 shipped: Display_Text + Caption_Final persistence. `saveAssetDraft` extended with `displayText` (4th) and `captionFinal` (5th) params. Caption hydration precedence locked: AL row wins on every canvas open (Caption_Final preferred, Caption_Draft fallback). Card stack render and reel textarea updated to prefer Caption_Final. `getAssetDisplayState()` endpoint added for targeted refreshes.
- `setup_displayTextColumn()` and `migrate_captionFinalBackfill()` added to `dev_tools.js`.

### v2.8 → v2.9 (May 2026)

- AD #111 added: Scribe Fairy retired — never deployed, pipeline email events spawn Writer tasks, template keys migrate to Writer quick-starts, dead-code stub retained (joins Safety, Marcom). AD #24 dead-route note added.
- Schema updated to v1.8: Contacts column 24 (`Last_Activity`) added — written by `updateLastActivity()`, added Phase 1.3. Versions tab schema added (Domain, Version, Last_Modified, Modified_By; 11 domain rows) — added Phase 1.1. Column count header corrected: Contacts now 24 columns.
- Codebase Inventory: `scribe_fairy.gs` status corrected to Retired (AD #111).

### v2.7 → v2.8 (May 2026)

- ADs #107–110 added: image caption grounding requirements locked (Quote_Text, Speaker, HOST_NAME, guest name, topic, brand voice; auto-regenerates on canvas change); reel caption grounding requirements locked (Reel_Summary required before generation); Asset_Library row creation triggers locked (Reel on Drive detect, Quote_Graphic on hooks/quotes list, Thumbnail on Artist Fairy, Social_Assets on Add to Week only); Unschedule flow locked (clean delete of Social_Assets row, Asset_Library status + availability reset, sibling pairing cleared).
- Manifest Field Reference: `episode_index` field added (Vert Fairy Pass 2, Drive doc ID).
- `Publish_Architecture_Handoff.md` incorporated and deleted (schema was already in v2.7; caption grounding, row triggers, and Unschedule flow are the new additions).

---

### v2.6 → v2.7 (May 2026)

- ADs #96–106 added: Image Workshop retired; AI layer simplified (Vert retrieves, Claude generates); single governance key (`STUDIO_LLM_MODE`); Asset Library as source of truth; Canvas_State for 1:1 reconstruction; Preservation Mandate replaced with intentional deletion policy; Studio tab structure locked (five tabs); episode index locked; Quick Caption retired; optimistic UI and progressive loading adopted.
- AI Layer Architecture section rewritten: four-layer model (Vert / Claude / GAS / Gemini), Social Vert and Librarian Vert personas retired, automated pipeline table and interactive surfaces table added.
- Schema updated to v1.7: old Social_Assets (17 cols) replaced by Asset_Library (18 cols) + Social_Assets (13 cols). Asset_Library is single source of truth. Canvas_State column added.
- Manifest Field Reference updated: `raw_hooks`/`raw_quotes` marked vestigial (remove in Spoke 1); `show_notes` updated to Drive file ID of Show Notes doc.
- Codebase Inventory updated: `vert_fairy.gs` added (active, Spoke 4 rewrite pending); `dwyp_app.gs` description updated (Image Workshop → Studio backend); `social_fairy.gs` added as retired; Preservation Mandate language removed from retired file notes.
- Retired Patterns updated: Image Workshop, Social Vert, Librarian Vert, Quick Caption, Preservation Mandate, `PUBLISH_LLM_MODE`, old Social_Assets schema, Image Workshop Background Generator all added.
- Folder Structure updated: background library comment updated to Studio canvas; Social Assets Gate updated to Studio canvas export path.
- Companion doc pointer corrected.
- Three handoff docs (Pipeline_Studio_Architecture, ClaudeAPI_EpisodeIndex, StudioDesign_ContextBrief) incorporated into State and Reference — archive after v2.7 is committed.

---

### v2.5 → v2.6 (April 2026)

- ADs #90–95 added: Tasks is primary home screen; EH flag via Influence_Tier; Guest Brief auto-close; RAG corpus relocated to us-south1/Spanner; Snapping closed; Secretary governance notes locked.
- Vertex AI RAG Engine section updated: region corrected to us-south1, vector backend corrected to Spanner, import status changed from blocked to resolved, working/failed configuration history documented.
- Codebase Inventory updated: `dwyp_app.gs` noted as including Contacts backend (getContacts, updateContactField); `dwyp_ui.html` noted as including Tasks and Contacts tab.
- Approval Gate Design updated: Guest Brief gate updated to reflect auto-close; Images/Reels gate updated to reflect sorter designs (arrow nav vs. scroll-based).
- Schema updated: Contacts `Influence_Tier` field notes updated to reflect EH toggle usage; `Personal_Note` notes updated to include Herald research anchor role.
- Retired Patterns updated: Episodes tab, Tasks tab, Snapping, us-central1 corpus, Make.com PNG conversion all added.

---

### v2.4 → v2.5 (April 2026)
- AI Layer Architecture section added: Vert Fairy / Social Vert / Librarian Vert / Vertex AI RAG Engine locked. GCP setup confirmed.
- Transcript Source section added: Riverside locked out, DaVinci Resolve preferred, Whisper fallback.
- AD #89 added: Vert Fairy / Vertex AI architecture supersedes Marcom Fairy.
- ADs #60–62, #70, #79–87 marked superseded — Marcom Fairy and Safety Fairy retired.
- AD #16 updated: `_ready` suffix pattern retired for Images/Reels review; file-presence detection is active pattern.
- AD #23 updated: `Review_Images` added to `Workflow_Step` known values.
- ADs #73, #74, #76, #78 corrected: proxy prefix corrected to `proxy_`, proxy location corrected to `Staging/Episode/` subfolder.
- Folder Structure rewritten: Images/Reels Approved/Save/Delete subfolders added, proxy location corrected, Raw Production cleaned.
- Approval Gate Design rewritten: Guest Brief two-step (Herald → Audra → JT), Episode Review Gate (timestamped comments → Revise task), Images/Reels Review Gate (file-presence detection, sorter flow, Ready for Release).
- Manifest Field Reference updated: `raw_hooks`/`raw_quotes` marked vestigial, `identity_pending` added, `show_notes` added, `transcript_index` removed.
- Codebase Inventory updated: safety_fairy and marcom_fairy marked retired, dev_tools.gs added, clerk_fairy marked rebuild queued, all status flags added.
- Retired Patterns updated: Marcom Fairy, Safety Fairy, `_ready` suffix for review, `prox_` prefix, `transcript_index.json`, Safety Fairy background generation, raw_hooks/raw_quotes writers all added.

---

### v2.3 → v2.4 (April 2026)
- Safety Fairy extended: hook/quote extraction to manifest (`raw_hooks`, `raw_quotes`) + Gemini image API call for background generation to `IMAGE_BACKGROUND_LIBRARY_ID` (ADs #84–85).
- Manifest field reference added: `raw_hooks`, `raw_quotes`, `transcript_index`.
- Two-Claude-touch architecture locked (AD #87): Touch 1 = Safety Fairy on raw transcript (extraction only); Touch 2 = Marcom on finished transcript (curation + voice).
- Manifest overwrite pattern confirmed: Safety Fairy writes raw candidates; Marcom/Claude overwrites with polished. No versioning. Image Workshop reads current state (AD #86).
- Image Workshop picker reads from manifest, not Social_Assets query (AD #88).
- Background library source updated: Gemini image API replaces Stable Diffusion as active path (AD #64 revised, AD #67 deferred note added).
- `Social_Assets.Status` enum corrected: `saved` → `bank` (schema table updated, Retired Patterns entry added).
- Marcom two-engine pipeline description clarified (AD #80).

### v2.2 → v2.3 (April 2026)
- Marcom architecture redesigned: Gemini extraction engine + Claude curation/voice engine (ADs #81–83). Supersedes ADs #60–62.
- Web app: Episode Detail redesigned. Frame.io UI removed. Assets + Tools card. Review view shells (Episode, Reels, Images). Fairy Remote Control. Deployed and confirmed.
- Social_Assets schema designed and locked (17 columns).
- Episode Card + Guest Doc redesigned and locked.

### v2.1 → v2.2 (April 2026)
- Frame.io retired entirely (AD #72). All review workflows move in-app.
- In-app review view scoped: proxy embed, timestamped comments to Episode_Log, Approve/Revisions buttons, task stays open until Filing.
- Proxy detection pattern locked: `proxy_` filename prefix, Daily Pulse folder-watch, `Proxy_File_ID` written to Episodes tab.
- `Proxy_File_ID` column added to Episodes tab — schema now v1.6 (16 columns).
- `Frameio_Project_ID` column retired in schema (column remains in sheet, GAS must not write to it).
- `Video_Status` authority moved from Courier Fairy/Frame.io webhook to web app direct write.
- Frame.io governance keys retired.
- `callMakeCreateProject()` in safety_fairy.gs flagged as dead code — remove when spoke opens.
- Clerk Fairy webhook receiver not built — no longer needed.
- Episode Review Gate added to Approval Gate section.
- Proxy file location added to Folder Structure.

### v2.0 → v2.1 (April 2026)
- Frame.io auth approach finalized: inbound (webhooks/Custom Actions) requires no auth. Outbound routed through Make.com. Adobe IMS OAuth path abandoned.
- Frame.io project creation responsibility moved from Secretary to Safety Fairy (AD #71). Secretary Frame.io code removed entirely.
- Make.com outbound integration live. GAS → Make.com → Frame.io project creation working end to end.
- Carrie Sipe episode in-flight under misspelled name "Carrie Snipe" — intentional deferral.
- HOST_EMAIL, ASSIGNEE_HOST, ASSIGNEE_PRODUCER corrected to canonical email addresses.
- Marcom architecture locked: Cowork + NotebookLM primary, Gemini API fallback.
- Image Workshop scoped: native web app view, Drive background library, Claude API compositing, Make.com PNG conversion.
- JT confirmed as Claude Pro subscriber.

