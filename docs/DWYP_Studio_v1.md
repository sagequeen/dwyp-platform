# DWYP — Studio
**Version: 1.1 | May 2026**
**Status: Consolidation document — Hub thread. No code written here.**
**Supersedes:** `DWYP_Studio_Design_Summary.docx`, `DWYP_Studio_Design_Addendum.md`, Studio sections in Platform State v4.4 and Social Architecture Redesign v3.2
**Companion:** `DWYP_Platform_State.md`, `DWYP_Social_Architecture_Redesign_v3.md`

---

## What Studio Is

Studio is JT's NotebookLM replacement — a corpus-powered creative surface that lives in the bottom nav (replacing the NotebookLM link). It is not a pipeline step. It is a workspace where JT does creative and strategic work with the episode corpus as context.

Studio opens pre-populated. Vert Fairy writes a starter pack to the episode index before JT ever arrives. By the time she opens any Studio tab, hooks, quotes, image prompts, and captions are already there. No generation wait on open.

---

## Architecture (Locked)

```
GAS = courier. Never thinks. Orchestrates.
Claude = brain. Generation, polish, voice-sensitive output.
Vertex AI RAG = memory. Retrieval and grounding.
Gemini = grunt. Image generation, audio/video processing, Herald web search.
```

**Call sequence (every AI call):**
1. Vertex retrieves relevant chunks from corpus
2. GAS assembles packet: system instruction + message history + injected context
3. Claude (or Gemini, mode-dependent) generates response
4. GAS writes result to the appropriate destination

**Claude has no memory between calls.** The episode index is what makes it feel continuous. GAS carries conversation history forward for iterative surfaces.

**Prompt caching** from day one — avoids re-billing for static context (system instruction, index content) on repeat calls.

**What stays on Gemini permanently:**
- Image generation (GenGem)
- Audio/video processing + reel descriptions
- Herald web search (hard requirement)
- Gemini auto-transcription (future)

---

## Episode Index — Studio's Knowledge Layer

A permanent markdown document, one per episode, stored in a dedicated index folder in Drive. Written by Vert Fairy as part of the show notes run. Studio reads it on open.

**Contents:**

| Section | Source | Living? |
|---|---|---|
| Episode summary | Vert Fairy Pass 2 | No — evergreen |
| Guest profile snapshot | Herald + Secretary (intake) | No — evergreen |
| Hooks & quotes (transcript-sourced) | Vert Fairy Pass 2 | No — evergreen |
| Social asset seeds (image prompts + caption seeds) | Vert Fairy Pass 2 | No — evergreen |
| Key themes | Vert Fairy Pass 2 | No — evergreen |
| Transcript map (landmark-dense) | Vert Fairy Pass 2 | No — evergreen |
| Reel descriptions | Daily Pulse / Mending Fairy | Yes — updated on reel add/remove |

**Index creation:** Vert Fairy creates the index during the show notes run. Not a Daily Pulse job.
**Reel sync:** Daily Pulse watches each reel folder. New reel → Gemini processes audio → description written to index. Reel removed → description pruned.
**Index folder:** Dedicated Drive folder, separate from all episode asset folders. Governance key: `EPISODE_SEARCH_INDEX_KEY` (to be added before Vert Fairy spoke).

**How Studio reads the index:**
- Studio loads index on open for the selected episode
- Hooks, quotes, image prompts, captions already present — no generation wait
- JT iterates from the starter pack via live Claude calls (on-demand only)

**Retrieval strategy by surface:**

| Surface | Retrieval | Latency |
|---|---|---|
| Publish | Index-first; Vertex only if insufficient | Fast — pre-populated |
| Write | Vertex-first, cross-episode | Moderate — on demand |
| Studio chat (Claude) | Vertex-first | Moderate — on demand |

---

## Studio Tab Structure (Locked)

Studio contains five tabs behind a collapsible left nav:

```
┌──────────┬──────────────────────────────────────┐
│ Left nav │  Tab content area                    │
│ (icons)  │                                      │
│          │                                      │
│ Publish  │                                      │
│ Design   │                                      │
│ Write    │                                      │
│ Outreach │                                      │
│ Ideas    │                                      │
└──────────┴──────────────────────────────────────┘
```

Left nav collapses to icon-only on tab selection. Arrow reopens. Written (not yet pushed) as item 59 in build sequence.

**Image Workshop status:** Fully retired. Replaced by the Publish canvas. No bones carried forward.

---

## Tab: Publish

**Status:** Fully designed and written (items 59–70). Not yet pushed.
**Full spec:** `DWYP_Social_Architecture_Redesign_v3.md`

Four panels left to right: Week accordion → Hooks & Quotes → Canvas workspace → Background tools.

Summarized:
- **Week accordion:** Episode entry + Mon–Sat slot structure. Slots gold (playbook) or crimson (custom). Filled slot taps reload canvas. Finalize button locked until all slots decided.
- **Hooks & Quotes panel:** Populated from episode index. Tapping places text on canvas and fires caption generation.
- **Canvas:** Fabric.js 360×450px, exports 1920×2400 PNG (4:5). Text always `fontStyle: normal`. Toolbar: Undo/Redo/Center/Logo.
- **Background tools:** Prompt → Generate (GenGem, `4:5`) → Generated strip (session) → Library (curated).
- **Caption:** Auto-generated on chip tap. Click-to-unlock editing. Persisted to localStorage per slot.
- **Reels view:** Native `<video>` element. Planned hosting: GCS (Make mirrors Drive → GCS). Caption + Regenerate + Notes + Add to Week.

`STUDIO_LLM_MODE` in Governance_Config — set to `claude`. No UI impact.

---

## Tab: Design

**Status:** Written (not yet pushed, part of Studio restructure). Role defined, detailed UX pending.

Same Fabric.js canvas as Publish. JT does deeper creative work here when she wants more than Publish's canvas offers.

**Design ↔ Publish asset travel:**
- Edit button in Publish navigates to Design with asset loaded. Context held: `publish_origin: { episode_uid, slot_id }`.
- In Design: **Save & Stay** or **Save & Return** (returns to correct Publish slot).
- If accessed directly from nav: Save & Stay only — no return context.
- Autosaves on debounced pause. Continue card shows on open (thumbnail + timestamp of last unsaved session).

**GenGem lives here:** Background generation from prompt. Stateless — one prompt = one result. Auto-saves to `IMAGE_BACKGROUND_LIBRARY_ID` as `bg_[slug]_YYMMDD-HHMM.ext`.

**Canvas state (Continue card):**
- Autosaves to a single manifest per episode on every debounced pause.
- On open: Continue card with thumbnail + timestamp. Tap to restore. Ignore to start fresh.
- Continue card clears on explicit Save or Save & Return.

---

## Tab: Write

**Status:** Architecture locked. UX not yet fully designed. ⚠️ Design decisions needed before spoke opens.

Cross-episode research. JT asks Claude questions that span the whole corpus — patterns, themes, synthesis. She expects to wait. The output is worth it.

**Retrieval:** Vertex-first. On-demand. No pre-fetch.
**Generation:** Claude (`STUDIO_LLM_MODE = claude`).
**Episode index:** Episode summary may be injected to orient Claude before a cross-episode Vertex call.

**What JT does here:**
- Asks Claude questions about themes across episodes
- Generates article drafts, talking points, newsletter content
- Results saved to My Drive (JT folder + Recents)

**Design (locked May 2026):**
- Chat left, open doc middle, saved docs right.
- No episode picker — Write is cross-episode/free-form.
- Copy from Write → paste into Publish. No explicit bridge button.

---

## Tab: Outreach

**Status:** Not yet designed. Scoped as a future spoke.

Guest comms surface. Claude polish candidate. Dependency: Write tab design and Send-to-Drafts wiring.

**Intended role:** JT drafts or reviews outreach messages here. Claude assists with tone, polish, or drafting from template. Send to Drafts action wires to email.

**⚠️ Not ready for spoke.** Write tab design and Send-to-Drafts architecture must be finalized before this tab is designed.

---

## Tab: Ideas

**Status:** Not yet designed.

Brainstorm surface. Brand brain doc integration. Anything-goes creative space. No episode context required.

---

## LLM / API Architecture (Detailed)

### Governance Keys

| Key | Value | Status |
|---|---|---|
| `STUDIO_LLM_MODE` | `claude` | ✅ Set. Single key for all Claude text generation. Gemini fallback on failure — automatic, logged. |
| `CLAUDE_API_KEY` | (set) | ✅ Set. Console account active. |
| `STUDIO_IMAGE_MODEL` | `gemini-2.5-flash-image` | ⏳ Add before Studio build. |
| `STUDIO_TOKEN_WARNING_THRESHOLD` | `50000` | ⏳ Add before Studio build. |
| `ASSET_LIBRARY_TAB_NAME` | `Asset_Library` | ⏳ Add before Studio build. |
| `PUBLISH_LLM_MODE` | — | ⛔ Retiring. Replaced by `STUDIO_LLM_MODE`. Remove from Governance_Config after Spoke 1. |

**Keys to add before Studio UI spoke:**
- `STUDIO_SESSIONS_FOLDER_ID` — Google Doc per session saved here
- `STUDIO_BRAIN_DOC_ID` — backing brand brain doc for Ideas tab
- `EPISODE_SEARCH_INDEX_KEY` — index folder (Drive folder ID)

---

## Backend Spoke Spec (Complete — Ready for Code)

**Files:** `fairy_circle.gs` + `dwyp_app.gs`
**Prerequisite:** Add `STUDIO_IMAGE_MODEL`, `STUDIO_TOKEN_WARNING_THRESHOLD`, and `ASSET_LIBRARY_TAB_NAME` to Governance_Config before testing.
**Renames apply before this spoke opens** (see Spoke 1 in build sequence).

---

### `callGeminiImageConversational(prompt, imageHistory)` — `fairy_circle.gs`

*Renamed from `callStudioImageGen` in Spoke 1 spring clean.*

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

### `isImageRequest(userMessage)` — `dwyp_app.gs`

*Renamed from `stDetectImageIntent` in Spoke 1 spring clean.*

Lightweight keyword heuristic. No API call.

**Logic:** Lowercase the message, return `true` if any of these terms are present:
`background`, `image`, `generate`, `create`, `visualize`, `picture`, `photo`, `make me`, `show me`, `try something`, `different one`, `change it`, `new version`, `darker`, `lighter`, `more`, `less`, `option`, `instead`

Intentionally broad — false positives acceptable, Vert handles them gracefully.

---

### `generateWithClaude(prompt, ragContext, conversationHistory, imageHistory, options)` — `dwyp_app.gs`

*Renamed from `callStudioLLM` in Spoke 1 spring clean. Full implementation replaces existing stub.*

**Parameters:**
- `prompt` — user message string
- `ragContext` — string of retrieved corpus context (retrieved upstream by UI via Vertex RAG — this function does not call RAG itself)
- `conversationHistory` — array of `{role, parts: [{text}]}` for main Vert thread
- `imageHistory` — array of raw parts-based turn objects for image thread
- `options` — `{ mode: string, episodeUid: string | null }`

**Logic:**
1. Call `isImageRequest(prompt)`
2. **If image intent:** Call `callStudioImageGen(prompt, imageHistory)`. Return `{ type: 'image', base64, mimeType, text, updatedImageHistory, tokenCount }`. Do NOT update `conversationHistory`.
3. **If text intent:** Build system prompt from `ragContext` + mode. Build contents array from `conversationHistory` + current user turn. Call `callClaudeAPI()` (Gemini fallback on failure, logged). Append new user + model turns to `conversationHistory`. Return `{ type: 'text', text, updatedConversationHistory, tokenCount }`.

On any error: log to Audit_Trail and throw. Never swallow silently.

**Two separate histories:** Main Vert conversation history (text) and image session history kept in separate arrays. Image iterations never pollute the main conversation thread.

**Token tracking:** `generateWithClaude()` accumulates token counts from `usageMetadata` and returns running total. UI (separate spoke) surfaces warning at threshold. Backend does not check threshold itself.

---

### `saveBackgroundToLibrary(base64Data, mimeType, guestSlug)` — `dwyp_app.gs`

*Renamed from `stSaveBackgroundToLibrary` in Spoke 1 spring clean.*

Called by UI when JT clicks a generated image into the library.

**Logic:**
- Read folder from `getGovernance('IMAGE_BACKGROUND_LIBRARY_ID')`
- Decode: `Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType)`
- Filename: `bg_${guestSlug}_${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmm')}.png`
- Create file, log: `logToAuditTrail('Studio', 'BG_SAVED', guestSlug, 'INFO', filename)`
- Return `{ fileId, url, filename }`

---

### Backend Spoke Notes

- `callGeminiImageAPI()` is dead code (Image Workshop retired) — remove in Spoke 1 spring clean before this spoke opens.
- `generateWithClaude` replaces `callStudioLLM`. All call sites in `dwyp_app.gs` must be updated in the rename pass.
- `CLAUDE_STUDIO_SYSTEM` is the renamed system prompt constant (was `STUDIO_SYSTEM_BASE`). Persona text must read "You are Claude..." not "You are Librarian Vert...".

---

## UI Spoke Spec (Partial — Gaps Flagged)

**Files:** `dwyp_ui.html`
**Prerequisite:** Backend spoke must be pushed and confirmed before UI spoke opens.

**What is written (not yet pushed):**
- Item 59: Collapsible left nav. Publish/Design/Write/Outreach/Ideas tabs. Nav auto-collapses on selection. Arrow reopens. Episode picker compact (guest name only) in `pb-week` header.
- Items 60–70: Full Publish tab build (see Social Architecture v3 for complete spec).

**What needs to be built (not yet written):**

### Studio Chat
The center panel — present across Write and possibly Design tabs. Full-screen chat area. Streaming responses. Source chips from corpus. Save buttons. Claude introduces itself as Claude (not "Librarian Vert" — that persona is retired).

**Spec status:** Layout defined (three-panel ASCII in Platform State). Interaction details below.

**Chat behavior:**
- Episode picker bar at top — selects episode context. Compact red-left-border accent.
- Message history persists for session. Each response may include corpus source chips (tappable).
- Chip tap behavior: in canvas context → `pbDropText(text)`. In doc context → insert at cursor.
- Blank state + setup card on first open: Vert intro → "Get started →" → opens episode picker + format pills.
- `stShowWelcomeCard()` / `#studio-blank-state` / `#studio-setup-card` already written.

### Right Panel Toggle (Canvas vs Doc)
Two icons at top of right panel. No context loss on switch. Chat stays.
- **Canvas mode:** GenGem stateless image generator. Background images only. Saves to library.
- **Doc mode:** Interactive document. Chip tap inserts at cursor. JT writes, edits, saves. Autosaves to backing Google Doc via debounced flush using `DocumentApp.openById()`.

### Token Warning UI
When GAS returns `tokenCount` ≥ `STUDIO_TOKEN_WARNING_THRESHOLD` (50000), surface a soft warning: "This session is getting long — consider starting a new one." Not a hard stop.

---

## Governance Keys — Studio-Specific

See LLM / API Architecture section above for complete key status table.

---

## Build Sequence

| Spoke | Description | Status |
|---|---|---|
| 1 | **Spring clean + renames** — remove dead code (safety_fairy, marcom_fairy, social_fairy, IW functions, Social Vert functions, Quick Caption nav), rename functions (callStudioLLM → generateWithClaude, etc.), retire PUBLISH_LLM_MODE references | ⏳ Next |
| 2 | **Push items 59–70** — Studio left nav + full Publish tab | ⏳ After Spoke 1 |
| 3 | **Claude API** — write `callClaudeAPI()` in fairy_circle.gs, set `STUDIO_LLM_MODE = claude` | ✅ Done |
| 4 | **Vert update** — rewrite vert_fairy.gs: retrieval only, hands off to Claude. Two-pass pipeline (Pass 1: show notes + podcast description; Pass 2: starter pack to episode index). | ⏳ |
| 5 | **Episode Index** — index creation, template, index folder governance key | ⏳ |
| 6 | **Studio backend** — `generateWithClaude()`, `isImageRequest()`, `callGeminiImageConversational()`, `saveBackgroundToLibrary()` | ⏳ |
| 7 | **Studio UI** — chat panel, right panel toggle (Canvas/Doc), token warning, Write tab, Ideas tab | ⏳ |
| 8 | **Daily Pulse audio** — reel upload detected → audio extracted → transcription → reel description → index sync | ⏳ |

**Also queued (after core spokes):**
- Outreach tab (depends on Write tab design + Send-to-Drafts architecture)
- Write surface deeper design session
- Housekeeping trigger registration (`triggerNightlyHousekeeping()`)

**Audra pre-spoke actions:**
- Set `STUDIO_LLM_MODE = claude` in Governance_Config
- Add `ASSET_LIBRARY_TAB_NAME = Asset_Library`
- Add `STUDIO_IMAGE_MODEL = gemini-2.5-flash-image`
- Add `STUDIO_TOKEN_WARNING_THRESHOLD = 50000`
- Retire `PUBLISH_LLM_MODE`, `IMAGE_WORKSHOP_GEM`, `IW_EXPORT_FALLBACK_FOLDER_ID`, `NOTEBOOKLM_LINK` after Spoke 1

---

## Open Questions — Resolved (May 2026)

| # | Question | Resolution |
|---|---|---|
| OQ-1 | `STUDIO_LLM_MODE` vs `PUBLISH_LLM_MODE` — one key or two? | One key: `STUDIO_LLM_MODE = claude`. `PUBLISH_LLM_MODE` retired. |
| OQ-2 | Starred — sessions or outputs? | Dropped. Docs save like Drive — asset details persist in Asset_Library regardless. |
| OQ-3 | Can JT switch episodes mid-session? | Yes. Episode picker context switches without loss. Asset_Library and Drive persistence mean nothing is lost on switch. |
| OQ-4 | Episode Detail → Studio button — payload or simple link? | Simple nav. Tapping Studio button from bottom nav opens Studio/Publish. Tapping from episode card loads episode context. |
| OQ-5 | Write tab UI — chat panel only? Split view? | Three-panel: chat left, open doc middle, saved docs right. |
| OQ-6 | How does JT send Write output to Publish? | Copy from Write, paste into Publish. No explicit bridge button. |
| OQ-7 | Design Continue card — per episode or per session? | Per session. Last session only. Explicit Save clears the card. |

---

*DWYP_Studio_v1.md — v1.1, May 2026. Hub thread. No code written. Consolidates: Platform State v4.4 Studio section, Social Architecture Redesign v3.2 Studio specs, Handoff Pipeline/Studio Architecture, Handoff Claude API/Episode Index, Studio Design Context Brief.*
