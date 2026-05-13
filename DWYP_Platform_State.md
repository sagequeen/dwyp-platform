# DWYP Operations Platform — Platform State
**Version: 5.6 | May 2026**
**Replaces: DWYP_Platform_State v5.5**
**Companion documents: DWYP_Platform_Reference.md | DWYP_Studio_v1.md | DWYP_Social_Architecture_Redesign_v3.md | DWYP_Surface_Principle.md | DWYP_Performance_Principle.md | DWYP_Publish_AI_Companion_Design.md | DWYP_Help_Desk_Companion_Design.md | DWYP_App_Structure.md | DWYP_User_Flows.md | DWYP_Phase2_0_Session_Archive.md | DWYP_Build_Playbook.md | DWYP_PreFlight_Staging_Verification.md**

---

## Current Position

**First episode run:** Carrie Sipe (EP-260428-1928) — at review stage. Name misspelled as "Carrie Snipe" — Mending Fairy fix deferred until episode completes. Enrichment Pending path (identity unconfirmed).

**Phase 1.1–1.3 (staging complete):** Versions tab live in staging sheet. All 40 write paths across 4 files retrofitted with `bumpVersion()`. `_resolveImageLibraryVersion()` corrected — scans file modification timestamps rather than folder metadata (folder.getLastUpdated() does not update on file additions). All 11 domains verified via Phase 1 Test Protocol. Production deploy pending (manual step).

**Phase 1.4–1.5 (staging complete):** Frontend version-aware loader pattern live. `getDomainsBatch()` endpoint in `dwyp_app.js`. `ACTIVE_LOADER_DOMAINS` / `TRACKED_ONLY_DOMAINS` three-bucket model — tasks/episodes/contacts version-tracked + batch-fetched; audit_trail version-tracked only (ready for Phase 4 Help Desk); asset_library/manifests out of scope. `refreshVersions()` + `loadDomain()` + `_rerenderCurrentTab()` in `dwyp_ui.html`. `loadData()` cold-start migrated to version-aware pattern (getAllVersions → getDomainsBatch, replaces getEpisodes/getTasks waterfall). `switchTab()` hooks `refreshVersions()` on every within-app tab switch. Verified on staging: cold start = 1× getAllVersions + 1× getDomainsBatch; warm tab switch with no changes = 1× getAllVersions + 0× getDomainsBatch; warm switch after change = 1× getAllVersions + 1× getDomainsBatch (stale domains only). Production deploy pending (manual step, batched with 1.1–1.3).

**GAS (deployed):** Items 43–58 confirmed pushed and live. Items 59–84 written, not yet pushed.

**Web app:** Dashboard live. Contacts tab live. All sorters operational. Dashboard now version-aware — tab return triggers version check, not full refetch. Revise_Reels / Revise_Images / Revise_Episode tasks have a Complete button for Audra. `checkReadyForRelease()` gates on at least one approved file existing. Dashboard "Tasks" header + red Add Task button live. **Not yet pushed (items 59–84):** Full Studio nav + Publish tab build + Spokes 3–7 backend and UI wiring + Reels Surface card layout. **Icon bug diagnosed:** `getTasks()` reads `Workflow_Step` by fixed column index rather than header name — icons won't light if sheet column order ever diverges from TASKS_COLS. Fix not yet written.

**RAG Engine:** Corpus confirmed live at `projects/dwyp-rag/locations/us-south1/ragCorpora/4611686018427387904`. Corpus populated manually via GCP Console. Programmatic sync via GAS blocked — `importRagFiles` API not available in us-south1. Drive connector works via GCP Console. Manual corpus import is current operational path; Filing Fairy deposit call written but commented out pending API availability.

**Studio:** Full Publish tab build written (items 59–84), not yet pushed. Full spec: `DWYP_Studio_v1.md`. Five tabs: Publish / Design / Write / Outreach / Ideas. Image Workshop fully retired — replaced by Publish canvas. Social Vert fully retired. Quick Caption retired as standalone. NotebookLM link retired — Studio is built-in.

**Master Sheet:** `Asset_Library` tab confirmed created with correct 18-column schema (Reference v2.8). `Social_Assets` tab confirmed with correct 13-column slim schema. Both ready for Spoke 2 push.

**Design Foundation (May 2026):** Major design session produced five foundation documents that govern all subsequent work — Surface Principle, Performance Principle, Publish AI Companion Design, Build Playbook, and Pre-Flight Staging Verification. These shift the platform from feature-by-feature growth to system-by-system construction. Component library, mobile IA, desktop chrome conventions, schedule panel UX, and visual modernization are all now applications of the foundation rather than freelance designs. **Phase 1 of the Build Playbook (Versions tab + performance foundation) is the next backend track.** See Foundation Documents section below.

**Frame.io:** Fully retired.
**Safety Fairy:** Fully retired.
**Marcom Fairy:** Fully retired.
**Scribe Fairy:** Retired (Reframe #8). Never deployed — seven template keys blank, Loop 2 indefinitely queued. Pipeline email events now spawn Writer email tasks (JT autonomous). Template keys migrate to Writer Email quick-start templates. Dead-code stub retained under Preservation Mandate.
**Social Vert:** Fully retired. Image Workshop retired.
**Image Workshop:** Fully retired. Replaced by Publish canvas in Studio.
**Quick Caption (standalone):** Retired. Caption generation moves to Daily Pulse audio path.
**Librarian Vert / Social Vert personas:** Retired. Claude introduces itself as Claude in Studio chat.

**Next:** Phase 1.6 Blurhash thumbnails (after Phase 1.1–1.5 production deploy). Continue Reels Surface spoke push when ready. Dr. Meenakshi Aggarwal Secretary run held until Herald verified on Carrie.

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
3. Preservation Mandate applies — never thin or rename `isStaging()`, `getMasterSheetId()`, or any function calling them.

### Caveats — What Routing Does NOT Cover

- **Drive folders are shared.** `IMAGE_BACKGROUND_LIBRARY_ID`, `CORPUS_DRIVE_FOLDER_ID`, episode folders — all production unless explicitly remapped on staging.
- **External APIs are shared.** Claude API key, Vertex RAG corpus, Gemini — same endpoints, real money on test runs.
- **Triggers always run as production.** `ScriptApp.getService().getUrl()` is null in trigger context, so `isStaging()` returns false. Trigger code paths cannot be tested via staging URL — use `dev_tools.gs` manual invocation.

### Pre-Flight Verification

`DWYP_PreFlight_Staging_Verification.md` provides a Claude Code prompt (verification mode) that checks discriminator function, wrapper presence, orphan call sites, governance key population, and schema parity. Run before any spoke that writes to sheets or modifies schema.

---

## Foundation Documents

The platform is governed by five foundation documents in addition to State and Reference. These were established in the May 2026 design session and apply to all subsequent work.

| Document | Role | When to Consult |
|---|---|---|
| `DWYP_Surface_Principle.md` | Where things live (mobile = ops, desktop = creation) | All UI work, all surface decisions |
| `DWYP_Performance_Principle.md` | How things feel (show first, sync second; version-stamp invalidation) | All new features, any performance work |
| `DWYP_Publish_AI_Companion_Design.md` | Per-card chat design for Publish | Publish AI feature work |
| `DWYP_Build_Playbook.md` | Sequenced runbook with ownership, dependencies, surface-back triggers | Picking next work, sequencing dependencies |
| `DWYP_PreFlight_Staging_Verification.md` | Claude Code verification prompt for staging architecture | Before any spoke writing to sheets |
| `DWYP_App_Structure.md` v1.3 | Eight reframes + 13 corollaries + 3 operational principles + Cognitive Offloading foundation principle — principles + refinements layer. Phase 2.0 closed. | Phase 2.1 / 2.3 / 2.4 / 3.3 design sessions; any app structure or surface work |
| `DWYP_User_Flows.md` v1.0 | Per-surface action inventory + 11 scenario walkthroughs from Phase 2.0. Surface-level companion to App_Structure v1.3. | Phase 2.1 / 2.3 / 2.4 / 3.3 design sessions; any verb-level question on a specific surface |
| `DWYP_Phase2_0_Session_Archive.md` | **Reference-only.** Verbatim concatenation of Phase 2.0 Sessions 1–5 yields. **Do not load by default.** | Only when a v1.3 or User_Flows claim needs source-texture trace; only when studying Phase 2.0 method patterns |

**Reading tier (per CLAUDE.md):**
- **Always loaded:** State, changelog
- **Always loaded for code/UI work:** Surface Principle, Performance Principle
- **When relevant:** Publish AI Companion Design, Build Playbook, Pre-Flight Verification, App_Structure v1.3, User_Flows v1.0

**Storage:**
- **Project knowledge (Hub sessions):** State, changelog, CLAUDE.md, Build Playbook, User_Flows v1.0, Session Archive
- **Repo (Code/Cowork sessions):** All five foundation docs + State + changelog + CLAUDE.md + User_Flows v1.0 *(Session Archive is project knowledge only — not in repo unless Audra adds manually)*

The Build Playbook supersedes ad hoc spoke ordering. Phase 0 housekeeping → Phase 1 (versioning + perf foundation, mostly autonomous backend) parallel with Phase 2 (design system hub sessions) → Phase 3 (application of design system) → Phase 4 (Publish Companion).

---

## GAS File Status

| File | Status | Notes |
|---|---|---|
| `fairy_circle.gs` | 🔶 Written, not pushed | **Loop 1 rewritten:** D-1 detection, date-aware task titles, spawns two tasks (HOST + PRODUCER). All other loops unchanged. **Null guard:** `callGeminiAPINoSearch` only sets `payload.systemInstruction` when non-null. **Spoke 3:** `callClaudeAPI(prompt, systemInstruction, callerName, history, options)` added — Anthropic Messages API. `callGeminiImageConversational(prompt, imageHistory, sourceImageBase64, sourceMimeType)` added. `callGeminiImageAPI()` removed. **Staging routing:** `isStaging()` and `getMasterSheetId()` helpers locked architectural pattern. **Phase 1.2–1.3:** `bumpVersion()` with LockService + audit_trail recursion guard. 8 write paths retrofitted. `spawnTask()`/`updateTaskStatus()` get `suppressBump` param. `dailyPulse()` bumps tasks + episodes once per run at end. Staged + verified. |
| `secretary_fairy.gs` | ✅ Pushed | Recording Reminder spawn removed. Calendar scan switched to `Calendar.Events.list()` Advanced Service. `wrapCalendarApiEvent()` adapter. `Utilities.sleep(3000)` between events. **Phase 1.3:** `updateLastActivity()` + `createContactStub()` bump contacts. Staged + verified. |
| `vert_fairy.gs` | 🔶 Written, not pushed | **Spoke 4 + 5:** Major rewrite. Two-pass pipeline. `MODEL_NAME` removed; `CLAUDE_MODEL`, `CLAUDE_API_KEY`, `EPISODE_SEARCH_INDEX_KEY` added. Pure Vertex RAG retrieval; Claude generation via `callClaudeAPI()`. Hook cleaning moved from Gemini to Claude. Pass 2 episode index doc creation. |
| `herald_fairy.gs` | ✅ Saved | Fix 20: thin-data hard-stop. checkGuestIdentity() helper. Pending path live. Corrupt guard + task spawn on catches. Guest Brief two-step. spawnGuestBriefReviewForJT() exported. **Phase 1.3:** 4 write paths bump contacts. Staged + verified. |
| `safety_fairy.gs` | ✅ Saved | **Fully retired.** Remove in Spoke 1 spring clean (already complete on main). |
| `marcom_fairy.gs` | ✅ Saved | **Retired.** Remove in Spoke 1 spring clean (already complete on main). |
| `artist_fairy.gs` | ✅ Pushed | `Drive.Files.copy` with native Slides mimeType. Two-step `moveTo()` for Shared Drive sources. Headshots disabled. `DECKS_CREATED` log + INFO level. `exportSlidesToPng()` added. |
| `filing_fairy.gs` | ✅ Saved | spawnTask() normalization. Dead writes removed. Post-filing tasks: Studio Assets Ready (JT, rename pending Spoke 1) + Produce Episode (Audra). Corpus deposit to `CORPUS_DRIVE_FOLDER_ID`. Direct `ragFiles:import` commented out — us-south1 unsupported. |
| `scribe_fairy.gs` | ✅ Saved | **Retired (Reframe #8).** Dead-code stub retained under Preservation Mandate (joins Safety, Marcom). Pipeline email events now spawn Writer email tasks. |
| `housekeeping.gs` | ✅ Saved | parsePipelineBlock(epUid): per-section idempotency. Corpus sync section commented out — us-south1 regional API unavailability. `test_syncCorpusFolder()` stubbed. |
| `social_fairy.gs` | ✅ Saved | **Fully commented out.** Dead code. Remove in Spoke 1 spring clean (already complete on main). |
| `clerk_fairy.gs` | 🔴 Rebuild queued | Owns doPost(). Routes: filing → runFilingFairy(), invite → scribeLetSchedule(). |
| `dev_tools.gs` | 🔶 Written, not pushed | Test wrappers for Vert, Artist, Slides export, asset enrichment, batch enrichment. Batch reels trigger registered (every 30 min) — **delete trigger now that enrichment is complete**. **Phase 1.2–1.3:** Full Phase 1 test suite added (8 functions: versions endpoints, bumpVersion, LockService stress, Drive hybrid, auditTrail, recursion guard, writeVideoStatus). Staged + verified. |
| `dwyp_app.gs` | 🔶 Written, not pushed (items 59–84) | `SOCIAL_ASSETS_COLS` 20-column map. Availability filter. Drive-fallback. Slide pairing. Reel Display_Name. v3 Publish image canvas + Hooks/Quotes. Spoke 6 `generateWithClaude()` 5-param signature. `isImageRequest()`/`isExplicitTextRequest()` heuristics. `saveBackgroundToLibrary()`. `stLoadEpisodeIndex()`. Asset enrichment functions. Reels Surface caption/title card Generate buttons. **Phase 1.2–1.3:** `getAllVersions()`, `getDomainVersion()` endpoints. 22 write paths retrofitted. `_resolveImageLibraryVersion()` corrected to scan file timestamps. Staged + verified. |
| `dwyp_ui.html` | 🔶 Written, not pushed (items 59–84) | Studio left nav (Publish/Design/Write/Outreach/Ideas). Episode accordion, proxy player, F-4 comment submit. Reel workflow card layout (inline player). Image workflow v3 three-panel layout. Fabric.js canvas 360×450, 4:5 export 1080×1350. Spoke 7 session state, episode index loading, mode-aware tab switching. Reel card grid `minmax(0,1fr)` overflow fix. Drop shadow blur reduced. Attribution chip dark + gold + Nunito. |

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

**Vert's role:** Retrieval only. Queries corpus → delivers chunks. Two patterns: (1) index creation — Daily Pulse triggers Vert → Claude writes episode index + starter pack; (2) live retrieval — on-demand for Write tab and index-fallback scenarios.

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
RAW_PRODUCTION/
  EP-YYMMDD-HHmm_GuestName/
    Production_Notes.gdoc
    [raw transcript]
    [headshot files]

STAGING_DRAFTS/
  EP-YYMMDD-HHmm_GuestName/
    manifest.json
    Episode/
      [finished transcript]
      [finished episode video]
      [proxy file: proxy_*.mp4]          ← Daily Pulse Loop A → Review Episode
    Images/                              ← Files here → Daily Pulse Loop B → Review Images
      Approved/
      Save/
      Delete/
    Thumbnails/
    Reels/                               ← Files here → Daily Pulse Loop C → Review Reels
      Approved/
      Save/
      Delete/

FINISHED_EPISODES/
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
| 6 | Review Episode | JT | Daily Pulse, proxy_ detected | ✅ Built. |
| 7 | Review Images | JT | Daily Pulse, files in Images/ | ✅ Built. |
| 8 | Review Reels | JT | Daily Pulse, files in Reels/ | ✅ Built. |
| 9 | Revise Reels | Audra | JT comment submit in Reels sorter | ✅ Written (not pushed). Revise_Episode for Audra still needed (F-4). |
| 10 | Runway Reminder | JT | Daily Pulse D-7 | ⏳ Not yet built. |
| 11 | Release Day Tomorrow / Release Day | Both | Daily Pulse D-1 | ✅ Built. |
| 12 | Errors / Admin | Audra | Various | Urgent. Never visible to JT. |

---

## Pipeline Sequence — Locked

1. Calendar event detected → Secretary runs → folders + manifest created
2. Daily Pulse Loop 1 fires D-1 → Recording Date Reminder spawned (HOST + PRODUCER)
3. Herald runs → Guest Brief written → Guest Brief Enrich task (Audra)
4. Audra enriches + approves → Guest Brief Review task (JT) — auto-closes
5. Audra uploads finished transcript + proxy to `Staging/Episode/`
6. Daily Pulse Loop A detects proxy → Review Episode task (JT)
7. Daily Pulse Loop B/C detects Images/Reels → Review tasks (JT)
8. JT sorts assets; comments on reels → Revise_Reels tasks for Audra
9. Daily Pulse D-7: Runway Reminder (if unresolved assets)
10. JT taps Ready for Release → Filing Fairy task for Audra
11. Audra triggers Filing Fairy → assets moved, finished assets deposited to `CORPUS_DRIVE_FOLDER_ID`
12. Audra triggers corpus sync in GCP Console
13. Post-filing: Studio Assets Ready (JT) + Produce Episode (Audra) spawned
14. Vert Fairy (future) runs on transcript → Show Notes → Artist Fairy handoff
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

**Full spec: `DWYP_Studio_v1.md` (authoritative). `DWYP_Social_Architecture_Redesign_v3.md` (Publish tab detail). Platform State carries overview only.**

### What It Is
JT's NotebookLM replacement. Corpus-powered creative surface. Bottom nav tab (replaces NotebookLM link). Not a pipeline step. Image Workshop fully retired — Publish canvas replaces it.

### Five Tabs
```
┌──────────┬──────────────────────────────────────┐
│ Left nav │  Tab content area                    │
│ (icons,  │                                      │
│collapse) │                                      │
│ Publish  │                                      │
│ Design   │                                      │
│ Write    │                                      │
│ Outreach │                                      │
│ Ideas    │                                      │
└──────────┴──────────────────────────────────────┘
```

| Tab | Status | Role |
|---|---|---|
| **Publish** | ✅ Written, not pushed (items 59–84) | Week accordion + Hooks & Quotes + Canvas + Background tools + Reels view |
| **Design** | ✅ Written, not pushed | Same Fabric.js canvas, deeper creative work. Design ↔ Publish asset travel. One autosave slot (last session only). |
| **Write** | 🔶 Backend wired, UI redesign pending | Chat + doc + My Docs. Newsletter, long-form copy. Cross-episode Vertex-first. Backend: session state, index loading, `generateWithClaude()` routing all wired. Gap: no episode picker in Write tab — `stRagContext` stays empty until UI redesign adds one. |
| **Outreach** | ⏳ Future | Guest comms. Scribe template dependency — not ready to design. |
| **Ideas** | ⏳ Future | Brainstorm + interview prep. No episode context required. |

### Publish AI Companion
Per-card chat with Claude, conversation history per asset in Asset_Library, same-date sibling context auto-injection, scheduling commentary via chips, chip suggestions never auto-write JT's draft. Full spec in `DWYP_Publish_AI_Companion_Design.md`. Build is Phase 4 in the playbook.

### Episode Navigation
- **Nav tab → Studio:** auto-selects nearest unfinalized episode (`pbAutoSelectEpisode()`).
- **Episode card → Studio:** episode UID passed as context payload — lands directly in that episode.
- **Mid-session episode switch:** safe — all canvas state persists to Asset Library; all docs save to My Docs.

### Retired
- Mode list (seven modes: Show Notes, Episode Copy, Interview Prep, Social Media, Newsletter, Outreach, Brainstorm) — retired. Three surfaces survive: **Publish** (schedule), **Writer** (compose written work), **Design** (compose visual work). Mode follows task — user taps a task, center pane assembles. Reference: App_Structure v1.2, Reframe #6.
- Starred — retired. My Docs + Asset Library persistence covers it.
- "Librarian Vert" and "Social Vert" personas — retired. Claude introduces itself as Claude.
- Image Workshop — fully retired. No bones carried forward.

---

## Background Generator — Locked (Fully Patched)

- **Model:** `gemini-2.5-flash-image`
- **Stateless:** Canvas background IS the context. No history.
- **Auto-save:** `IMAGE_BACKGROUND_LIBRARY_ID` as `bg_[slug]_YYMMDD-HHMM.ext`
- **Used in:** Image Workshop (left panel) + Studio right panel canvas mode

---

## Image Workshop — Retired

Image Workshop is fully retired. Replaced by the Publish canvas in Studio. No bones carried forward. Social Vert retired with it. Code preserved per spring-clean decision — dead code removed in Spoke 1.

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
| `show_notes` | Vert Fairy | Drive file ID of Show Notes doc. Written on Vert Fairy Pass 1. |
| `episode_index` | Vert Fairy | Drive doc ID of Episode Index doc. Written by Pass 2 via `createEpisodeIndexDoc()`. |

---

## Build Sequence

### ✅ Complete
1–84 — Master Sheet build through Reels Surface inline player + caption/title card Generate buttons (full historical sequence preserved in v5.1; condensed here for readability).

85. **Design Foundation Session (May 2026)** — Hub session produced five foundation documents: `DWYP_Surface_Principle.md` (mobile = ops, desktop = creation), `DWYP_Performance_Principle.md` (show first, sync second; version-stamp invalidation), `DWYP_Publish_AI_Companion_Design.md` (per-card chat with Claude, sibling context, chips not auto-write), `DWYP_Build_Playbook.md` (sequenced runbook, dual track ownership, surface-back protocol), `DWYP_PreFlight_Staging_Verification.md` (Code verification prompt). `CLAUDE.md` updated with foundation reading protocol, mode awareness (Hub/Spoke/Verification), and architectural pattern references. Foundation establishes platform-wide design system with two principles — repositions all subsequent UI/feature work as application of foundations rather than freelance design. ✅ Captured.

86. **Phase 1.1 — Versions Tab (May 2026)** — Versions tab created in both production and staging sheets. Columns: Domain, Version, Last_Modified, Modified_By. 11 domain rows: tasks, episodes, contacts, asset_library, image_library, manifests, governance_config, brand_voice, playbook, content_sensitivity, audit_trail. `setup_versionsTab()` / `setup_versionsTab_staging()` helpers in dev_tools.js bypass `getMasterSheetId()` intentionally (editor context always routes staging). ✅ Both sheets populated.

87. **Phase 1.2 — bumpVersion Helper + Versions Endpoints (May 2026)** — `bumpVersion(domain, callerName)` with LockService wrapper + audit_trail recursion guard in fairy_circle.js. `getAllVersions()` and `getDomainVersion(domain)` in dwyp_app.js. Drive folder hybrid for image_library — corrected during Phase 1.3 staging verification: scans file modification timestamps rather than `folder.getLastUpdated()` (which does not update on file additions). ✅ Staged + verified.

88. **Phase 1.3 — Endpoint Retrofit (May 2026)** — 40 write paths retrofitted: fairy_circle.js (8), secretary_fairy.js (2), herald_fairy.js (4), dwyp_app.js (22). `suppressBump` param on `spawnTask()`/`updateTaskStatus()` — dailyPulse() suppresses per-row bumps and fires two unconditional bumps (tasks, episodes) at end of run. All 11 domains verified via Phase 1 Test Protocol on staging. ✅ Staged + verified. Production deploy pending.

89. **Phase 1.4 — Frontend Version-Aware Loader (May 2026)** — `getDomainsBatch(domains)` endpoint in `dwyp_app.js` dispatches to existing per-domain fetchers with per-domain failure isolation. Three-bucket domain model: `ACTIVE_LOADER_DOMAINS` (tasks/episodes/contacts — version-tracked + batch-fetched), `TRACKED_ONLY_DOMAINS` (audit_trail — version recorded, no fetcher, ready for Phase 4 Help Desk), excluded (asset_library/manifests — out of scope). `state.versions {}` added to state object. `refreshVersions()` — getAllVersions() → compare → batch-fetch stale → `_rerenderCurrentTab()`. `loadDomain(domain, callback)` — cache-or-fetch utility. `_coldStartComplete` flag prevents redundant getAllVersions on initial switchTab. `refreshVersions()` hooked into `switchTab()`. Staged + verified.

90. **Phase 1.5 — Dashboard Migration (May 2026)** — `loadData()` cold-start waterfall (getEpisodes → getTasks) replaced with version-aware pattern (getAllVersions → getDomainsBatch). `state.versions` and `state.contactsLoaded` populated at cold start. `_rerenderCurrentTab()` wired into both refreshVersions() batch success paths. Inline `getTasks()` removed from `switchTab("dashboard")`. Verified on staging: cold start = 1× getAllVersions + 1× getDomainsBatch; warm tab switch unchanged = 1× getAllVersions + 0× getDomainsBatch; warm switch after change = stale domains only batched. Production deploy pending (batched with 1.1–1.3).

### ⏳ In Progress
- **Carrie Sipe episode run** — at review stage.

### Queued — Next

**Phase 0 — Pre-Flight Housekeeping (Audra)**
- Foundation docs to project knowledge (selective: State, changelog, CLAUDE.md, Build Playbook in PK; all five foundation docs in repo).
- State v5.2 to repo.
- Confirm four boundary calls in Surface Principle (see Pending Decisions).

**Phase 1 — Performance Foundation (Backend Track, mostly autonomous)**
✅ 1.1 Versions Tab schema in Master Sheet — both sheets populated.
✅ 1.2 `bumpVersion()` helper + `getAllVersions()` / `getDomainVersion()` endpoints + Drive folder file-scan hybrid.
✅ 1.3 Existing endpoint retrofit — 40 write paths across 4 files. Staging verified. Production deploy pending.
✅ 1.4 Frontend version-aware loader pattern. `getDomainsBatch()` endpoint + three-bucket domain model + `refreshVersions()` / `loadDomain()` / `_rerenderCurrentTab()`. Staged + verified.
✅ 1.5 Dashboard migrated to version-aware loading. `loadData()` waterfall replaced. Tab return = 1× getAllVersions + 0–1× getDomainsBatch. Staged + verified.
1.6 Blurhash thumbnails generated at filing time. **← Next**
1.7 Pre-compute audit — identify >200ms operations.

**Phase 2 — Design System (Hub-led, Audra)**
✅ 2.0 Action-Completeness Audit — Closed. Five sessions, saturation marker S5. Output: `DWYP_App_Structure.md` v1.3 + `DWYP_User_Flows.md` v1.0. Phase 2.1 / 2.3 / 2.4 / 3.3 hub sessions unblocked.
2.1 Component library design.
2.2 Status indicator component (first-class component for save/saved/failed).
2.3 Mobile IA design.
2.4 Desktop chrome conventions.

**Reels Surface push** (in-flight from items 83–84) — push remaining work, confirm with JT, continue from spec.

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
| 1 | Master Template | Hold for Audra's revised text. | Hold. |
| 2 | `dwyp_app.gs` | submitEpisodeComments() — Revise_Episode for Audra not yet spawned. | F-4 queued. Holding pending comment design decision. |
| 3 | RAG Engine | `importRagFiles` API unavailable in us-south1. | Corpus sync commented out. Manual GCP Console import is operational path. Revisit when us-south1 expands. |
| 4 | `herald_fairy.gs` / `secretary_fairy.gs` | Contact record exists but Contact Library folder missing → flags duplicate. | Fix before next new guest run. |
| 5 | `dwyp_ui.html` | B-4: JT couldn't save/add quote card to Carrie's file. | Awaiting clarification — error, nothing, or file lost? |
| 6 | `dwyp_ui.html` | B-5: Bottom border missing on quote card template. | Awaiting reference image from JT. |
| 7 | `dwyp_ui.html` | B-3: Fonts not rendering correctly in Add Text. Should be Libre Baskerville / Nunito (Sofia Pro sub). | IW polish spoke (F-5). |
| 8 | `dwyp_ui.html` | Write tab has no episode picker — `stSelectEpisode()` only fires from Design tab's dropdown. `stRagContext` stays empty in Write mode; Claude has no episode context. | Part of Write tab UI redesign (three-panel). Not a wiring bug. |
| 9 | `dwyp_ui.html` / `dwyp_app.gs` | Loose tasks (not linked to an episode) do not appear in the app. Pre-existing bug, predates Phase 1.3. Surfaced during Phase 1 staging verification. | Investigate in a separate spoke before next JT session. |

---

## Pending Decisions

| Item | Status |
|---|---|
| Corpus sync schedule | Drive connector daily via GCP Console. Manual trigger after each filing. |
| parsePipelineBlock() / housekeeping | Vestigial — Social Vert retired. Confirm removal before housekeeping spoke. |
| Sorter comment design | Per-asset or batch? Blocking F-4. |
| JT's device — iPhone SE? | Determines F-2. |
| Contacts completion signal | Bio + one social + Headshot? Not formally defined. |
| Contacts Relationship_Type editable? | Part of C-1. Awaiting JT feedback. |
| D-1 container architecture | User-created categories as data structure from day one. |
| Artist Fairy post-redesign role | No longer produces quote graphics. May handle Reel thumbnails or other assets. Confirm before that spoke opens. |
| **Asset_Library `chat_history` column (OQ-G)** | 18-col schema confirmed. Verify column 18 covers chat_history or add as column 19 before Phase 4 (Publish Companion). |
| **Reels video hosting — implementation details** | Direction set: GCS hosting, Make mirrors Drive → GCS, native `<video>` serves GCS URL. Remaining TBD: Make scenario design, bucket structure, GCS URL pattern, `getReelStreamUrl()` update. Resolve before Reels Surface push resumes. |
| **Conversation history turn cap (OQ-E)** | N=? Decide before Phase 4 spoke. |
| **Sibling context cap UX (OQ-D)** | What's the UX when over cap? Decide before Phase 4 spoke. |
| **Playbook strategic logic content (OQ-F)** | Authoring lift on Audra. Required before Phase 4 — Claude only knows what's in the briefing. |

---

## Reminders — Action Required

| Item | Status |
|---|---|
| Deploy Phase 1.1–1.3 to production | ⏳ Staging verified — Audra manual step (Manage Deployments → New version) |
| Add foundation docs to repo (5 files + CLAUDE.md update) | ⏳ Phase 0 |
| Add foundation docs to project knowledge (selective per CLAUDE.md tier) | ⏳ Phase 0 |
| Confirm Surface Principle boundary calls (4 items) | ⏳ Phase 0 |
| Register nightly trigger for `triggerNightlyHousekeeping()` | ⏳ Not yet done |
| After each episode files: trigger corpus sync in GCP Console | ⏳ Ongoing — manual step |
| Set `STUDIO_LLM_MODE = claude` in Governance_Config | ⏳ Before Studio backend spoke |
| `Asset_Library` tab created in Master Sheet (18 cols) | ✅ Done |
| `Social_Assets` tab updated to slim 13-col schema | ✅ Done |
| Add `ASSET_LIBRARY_TAB_NAME = Asset_Library` to Governance_Config | ⏳ Verify before Spoke 2 push |
| Add `STUDIO_IMAGE_MODEL` to Governance_Config | ⏳ Before Studio backend spoke — confirm model name first |
| Add `STUDIO_TOKEN_WARNING_THRESHOLD = 50000` to Governance_Config | ⏳ Before Studio backend spoke |
| Add `PUBLISH_CHAT_HISTORY_TURN_CAP` to Governance_Config | ⏳ Before Phase 4 (Publish Companion) |
| Delete `test_batchEnrichReels` time-based trigger (every 30 min) | ⏳ Enrichment complete — trigger no longer needed |
| Retire `PUBLISH_LLM_MODE` from Governance_Config | ⏳ After Spoke 1 removes code references |
| Retire `IMAGE_WORKSHOP_GEM`, `IW_EXPORT_FALLBACK_FOLDER_ID`, `NOTEBOOKLM_LINK` | ⏳ After Spoke 1 |
| JT's reels in `Reels/Approved/` | ✅ Done |
| `CLAUDE_API_KEY` active | ✅ Done |
| `STAGING_DEPLOYMENT_URL` populated | ✅ Done |
| `STAGING_SHEET_ID` populated | ✅ Done |
| Posting_Schedule tab populated | ✅ Done |
| `VERTEX_RAG_REGION = us-south1` in Governance_Config | ✅ Done |

---

## Governance Keys — Current State

**Full key list is authoritative in Governance_Config sheet.** This section tracks status only.

**Populated and confirmed:**
`GEMINI_API_KEY`, `MODEL_NAME`, `CLAUDE_API_KEY` ✅, `MASTER_SHEET_ID`, `MASTER_TEMPLATE_ID`, `STAGING_DEPLOYMENT_URL` ✅, `STAGING_SHEET_ID` ✅, `RAW_PRODUCTION`, `STAGING_DRAFTS`, `FINISHED_EPISODES`, `DWYP_CALENDAR_ID`, `CALENDAR_TRIGGER_PREFIX`, `ASSIGNEE_HOST`, `ASSIGNEE_PRODUCER`, `HOST_NAME`, `HOST_EMAIL`, `CONTACT_LIBRARY_FOLDER_ID`, `PODCAST_NAME`, `HERALD_RESEARCH_PROMPT_KEY`, `HERALD_BIO_PROMPT_KEY`, `HERALD_BRIEF_PROMPT_KEY`, `CONTENT_SENSITIVITY_ID`, `BRAND_VOICE_ID`, `NOTEBOOK_STAGING`, `ARCHIVE_FOLDER_ID`, `RELEASE_REMINDER_HOURS`, `SCRIPT_ID`, `INTAKE_NAME_KEY`, `INTAKE_EMAIL_KEY`, `INTAKE_REFERRAL_KEY`, `ARTIST_THUMBNAIL_DECK_ID`, `ARTIST_SQUARE_DECK_ID`, `ARTIST_VERTICAL_DECK_ID`, `IMAGE_BACKGROUND_LIBRARY_ID`, `STUDIO_CORPUS_ID`, `CORPUS_DRIVE_FOLDER_ID`, `VERTEX_RAG_REGION` (`us-south1`), `REELS_ARCHIVE_FOLDER_ID`, `POSTING_SCHEDULE_TAB_NAME`, `SOCIAL_ASSETS_TAB_NAME`, `STUDIO_ROOT_FOLDER_ID`, `STUDIO_CANVAS_MANIFEST_FOLDER_ID`, `STUDIO_DOCS_FOLDER_ID`, `STUDIO_SESSIONS_FOLDER_ID`, `EPISODE_SEARCH_INDEX_KEY`, `JT_TIMEZONE`, `AUDRA_TIMEZONE`, `PUBLISH_LLM_MODE` (gemini — retire after Spoke 1).

**Needs value set:**
`STUDIO_LLM_MODE` → `claude` (before Studio backend spoke).

**Add before Studio backend spoke:**
`ASSET_LIBRARY_TAB_NAME` = `Asset_Library`, `STUDIO_IMAGE_MODEL` (confirm model name), `STUDIO_TOKEN_WARNING_THRESHOLD` = `50000`.

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
| Items 59–84 pushed and deployed | ⏳ Pending push |

---

## Engineering Notes

### Drive Video Playback — Confirmed Strategy

Do **not** use Drive's `/preview` URL in an embedded player. The Drive player has fixed UI chrome (header, controls) that crowds the video at small sizes and cannot be overridden with CSS. The `transitionend`-delay workaround and large container sizes (360×640) were tried and discarded.

**Final solution (confirmed working):**
1. Call `getReelStreamUrl(fileId)` (GAS) — sets the Drive file to "anyone with link can view" via `DriveApp.setSharing()`, returns `https://drive.google.com/uc?id={fileId}`.
2. Use a native `<video src="...">` element. The browser's own player fills its container exactly, respects `object-fit: contain`, and has no external chrome.
3. Cache the URL on the in-memory reel object (`reel._streamUrl`) — first tap incurs one GAS round-trip to set sharing; every subsequent tap is instant.
4. Player container: **240×427** (9:16 at 240px) — card expands to this height when playing, collapses on close.

**Why "anyone with link" is acceptable:** Reels are produced for public posting. Making the source file link-accessible is not a meaningful privacy exposure. `setSharing()` is idempotent — safe to call on every first-play even if already set.

**Planned hosting:** Google Cloud Storage. Make scenario mirrors Drive → GCS on upload. App serves reels from GCS public URL via native `<video>` — JT's in-app review experience unchanged. `getReelStreamUrl()` will return GCS URL instead of Drive UC URL; `setSharing()` step drops. GCS bucket (`dwyp_corpus_episodes`) already exists in project. Implementation details (Make scenario, bucket structure, URL pattern) TBD before Reels Surface push.

---

## Known Issues / Troubleshooting

- **Carrie Sipe name typo:** "Carrie Snipe" — deferred. Mending Fairy `correctGuestName()` is the fix.
- **RAG corpus sync blocked in GAS:** `importRagFiles` API unavailable in us-south1. Manual GCP Console import is operational path. Code preserved in housekeeping.gs with dated comment.
- **Herald re-enrichment:** Run Herald button on Fairy Remote Control is the re-enrichment trigger.
- **F-7 timezone:** `JT_TIMEZONE` and `AUDRA_TIMEZONE` governance keys added. Verify recording reminder timing before first live recording.

---

## Episode Roster

| Seq | Guest | Release Date | Tier | Status |
|---|---|---|---|---|
| 1 | Carrie Sipe | May 26 | EH | At review stage (EP-260428-1928, name typo deferred) |
| 2 | Dr. Meenakshi Aggarwal | June 2 | EH | — |
| 3 | Mai Vo | June 9 | EH | — |
| 4 | Dr. Buck Blodgett | June 16 | HI | — |
| 5 | Eric Zimmer | June 23 | LF | — |
| 6 | Roundtable | June 30 | — | — |
| 7 | Becky Yee | July 7 | HI | — |
| 8 | Kyla Mitsunaga | July 14 | HI | — |
| 9 | Derek Peterson | Unscheduled | HI | — |
| 10 | Elizabeth Husserl | July 21 | HI | — |
| 11 | Angela Snow | July 28 | HI | — |
| 12 | Mahsa Darabi | Aug 4 | LF | — |
| 13 | David Bedrick | Aug 11 | LF | — |
| 14 | Adam Meyer | Aug 18 | EH | — |
| 15 | Marta Kagan | Aug 25 | LF | — |
| 16 | Molly Lastname | Sept 1 | HI | — |
| 17 | Rachelle Jeanty | Sept 8 | HI | — |

> Roundtable (Seq 6): Contact_ID points to permanent Roundtable contact record.

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

*Platform State v5.6 — 2026-05-12. Phase 2.0 (action-completeness audit) closed — five sessions, saturation marker S5. `DWYP_App_Structure.md` v1.3 published: Cognitive Offloading added as third foundation principle, 13 corollaries, 3 operational principles, eight reframes refined inline. `DWYP_User_Flows.md` v1.0 published: per-surface action inventory, 11 scenario walkthroughs, cumulative gap list. `DWYP_Phase2_0_Session_Archive.md` published (reference-only, do not load by default). Foundation Documents table updated. Reading tier "When relevant" gains User_Flows v1.0. Four Surface Principle boundary calls (mobile permissions) resolved per v1.3 Reframe #3 — all four confirmed yes. Phase 2.1 / 2.3 / 2.4 / 3.3 hub sessions unblocked.*

*Platform State v5.5 — May 2026. Scribe Fairy retired (Reframe #8) — pipeline email events spawn Writer tasks; template keys migrate to Writer quick-starts; Loop 2 rewires to release reminder task. Phase 2.0 Action-Completeness Audit added as gate for Phase 2 design sessions. App_Structure v1.2 and Help_Desk_Companion_Design added to companion docs. Mode list retired — three surfaces: Publish / Writer / Design. Reels video hosting flagged as open pending decision.*
