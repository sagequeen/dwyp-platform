# DWYP — Outstanding Build Items Inventory

**Purpose:** Working list for Phase 3 build playbook prioritization. Each item: action title + 1-sentence description. Numbered for ranking reference.

Compiled from: Platform State v6.5, Build Playbook v5, App Structure v1.3, User Flows v1.0, Publish/Help Desk Companion Designs, Operating Model v1.1, this session's locks.

---

## A. App Functionality — Just Locked This Session

| # | Action | Description |
|---|---|---|
| A1 | Schedule fan-out | Make `Schedule` write PNG + `.txt` to `Approved/` alongside filling the slot, with slot-stable post-date filenames (`SLOT-MON-01_MAR-12-26.png`). |
| A2 | Display Review view | New toggle inside Publish episode tab showing the week's posts side-by-side with captions; empty slots show `Why` from slot recipe. |
| A3 | Omni-voice prompt authoring | Hub session to draft `DWYP_OmniVoice_Prompt.md` — banned phrases inherited from JT's prohibitions + new ones; brand-neutral first-person guest voice target. |
| A4 | Guest Package builder | Filing-to-Finished trigger assembles flat asset folder + Google Doc companion + Gmail autodraft with omni-voice captions inline. |
| A5 | Schema additions | Add Asset_Library col 22 `Caption_Guest`; Episode `Guest_Package_URL` field. |

---

## B. AI Companions — Build Playbook Phase 4

| # | Action | Description |
|---|---|---|
| B1 | `chat_history` schema delta | Confirm or add Asset_Library `chat_history` column (OQ-G). |
| B2 | Playbook strategic content | Author cached-prefix content — what each slot type is good for, why each day's posture (load-bearing for Claude in Publish). |
| B3 | AI Companion governance keys | Populate `PUBLISH_CHAT_HISTORY_TURN_CAP`, `PUBLISH_SIBLING_CONTEXT_CAP`, `HELP_DESK_HISTORY_TURN_CAP`, `HELP_DESK_AUDIT_TRAIL_DAYS`. |
| B4 | Publish Companion spoke | Per-card chat panel docks as card tab; reads/writes `chat_history` per asset; sibling context auto-injected at send. |
| B5 | Help Desk Companion spoke | Right-rail Gemini chat with navigation chips; read-only over Tasks/Episodes/Contacts/AL/Audit_Trail. |

---

## C. New Surfaces / External Integrations

| # | Action | Description |
|---|---|---|
| C1 | Vert RAG search panel (Writer) | JT-driven corpus search surfaced in Writer right rail (separate from Claude's tool-call use). |
| C2 | Writer surface MVP | Doc list + quick-start templates (the seven Scribe template keys land here) + Claude scoped to pinned/open docs + Send-to-Drafts pipeline. |
| C3 | Google Vids trim | 3-state Edit Reel button + Sentinel Fairy (separate GAS project bound to JT's account) + workfile handshake; **major lift**. |
| C4 | Reel Get Summary | Within Add Slot canvas: Gemini transcribe → `Reel_Summary` written → caption chat unlocks. |
| C5 | Design tab quote graphic workspace | Phase 3.4 — chat panel ↔ image library coexistence (horizontal split candidate). |

---

## D. Design System — Build Playbook Phase 2 & 3 (Hub-led + Spoke)

| # | Action | Description |
|---|---|---|
| D1 | Component library design (2.1) | Hub session — card design, chip primitive, chat bubble primitive, status indicator spec. |
| D2 | Status indicator component (2.2) | First-class component for save/saved/failed states. |
| D3 | Mobile IA design (2.3) | Hub session — mobile chrome rules per Surface Principle; reaction-only verb inventory. |
| D4 | Desktop chrome conventions (2.4) | Hub session — four-pane structure details (Q6/Q8/Q9/Q11/Q15/Q16/Q17). |
| D5 | Component library implementation (3.1) | Spoke — implement the library in `dwyp_ui.html`. |
| D6 | Visual modernization (3.2) | Spoke — glassmorphism, layered shadows, larger radius, micro-animations across all five Studio tabs. |
| D7 | Schedule Panel UX (3.3) | Largely subsumed by A1 + A2 this session; flagged as deprecated/reduced scope. |

---

## E. Performance — Build Playbook Phase 1 Remaining + Parked

| # | Action | Description |
|---|---|---|
| E1 | Blurhash thumbnails (1.6) | Generated at filing time for instant grid renders. |
| E2 | Pre-compute audit (1.7) | Identify all >200ms operations; build sequence for moving them off the critical path. |
| E3 | Stub → real card swap | Skeleton-first hydration pattern; closes orphaned-Card-1 race as side effect. |
| E4 | AL row as single source of truth | Audit-first spoke; resolves `Quote_Text` vs `Display_Text` writes and caption-regen behavior across surfaces. |

---

## F. Pipeline / Fairies

| # | Action | Description |
|---|---|---|
| F1 | Mending Fairy build-out | `correctGuestName()`, `archiveEpisode()`, re-enrichment trigger. |
| F2 | Filing Fairy expansion | Subfolder moves on filing; corpus deposit when us-south1 API available. |
| F3 | Clerk Fairy rebuild | Owns `doPost()` routing; queued. |
| F4 | Gemini auto-transcription spoke | Replace Riverside / manual upload path with native transcription. |
| F5 | Restore dailyPulse Loop 2 | Release reminder spawns Writer email task (post-Scribe-retirement pattern). |
| F6 | Herald suppression | Delay Guest Brief Review task until closer to recording date. |
| F7 | Contact folder recreation | Graceful recovery when folder missing (currently flags duplicate). |
| F8 | Runway Reminder spoke | Daily Pulse D-7, idempotent, surfaces unresolved assets. |

---

## G. Smaller Fixes / Open Issues

| # | Action | Description |
|---|---|---|
| G1 | Master Template v3.0 activation | v3.0 full-document replacement drafted (15 keyed sections, consolidates Brand Voice in-template). Two hard sequencing gates: (1) QUOTE-block `ATTRIBUTION:` line + `_bridgeParseRankedItems_`/`materializeQuoteGraphicAssets` parser (B6 #3 — can ship on live v2.5); (2) `${brandVoice}` retirement ↔ `extractPrompt` consolidation spoke (B6 #2 — ships with v3.0 paste). Activation is two-step: paste + B6 #2. |
| G2 | Reel Editorial test | `runReelEditorialPass` ready; needs next episode with enriched reels to verify. |
| G3 | Caption_Draft format reform | Generators write JSON array of 3 variants; move to single-string format. |
| G4 | Host Quotes downstream cleanup | Remove HOST QUOTES from `buildPlaceholderMap()` + slide deck templates. |
| G5 | F-4 Revise_Episode for Audra | `submitEpisodeComments()` doesn't spawn the revision task. |
| G6 | F-7 timezone wiring | Wire `JT_TIMEZONE` / `AUDRA_TIMEZONE` into recording reminder. |
| G7 | F-9 Tasks tab nav entry | Add nav entry for direct tasks tab access. |
| G8 | F-8 Un-approve / un-sort | Asset toggle to reverse approval state. |
| G9 | F-2 Reels viewport fit | iPhone SE viewport sizing (device confirmation pending). |
| G10 | `getTasks()` header-driven fix | Refactor to read headers dynamically. |
| G11 | Review_Images close path | Task close logic incomplete. |
| G12 | B-5 Quote card bottom border | Bottom border missing on quote card template. |
| G13 | B-3 Add Text font rendering | Should be Libre Baskerville / Nunito (Sofia Pro sub currently). |
| G14 | C-1 Contacts Add/Edit | Awaiting JT feedback on form layout. |
| G15 | C-2 Revision Task inline checkboxes | Add inline checkbox UI in revision tasks. |
| G16 | C-3 Re-run Herald button | Audra-only, on Contact Detail. |
| G17 | C-4 Influence Tier toggle | Three-way (EH / HI / LF). |
| G18 | D-1 Dashboard Loose Task Containers | Three containers (Podcast / People / Personal). |
| G19 | JT social tasks + Audra release tasks | Task spawning still incomplete for these flows. |

---

## H. Major Lifts / Future Architecture

| # | Action | Description |
|---|---|---|
| H1 | AI reel hook/title analysis | Gemini multimodal video review; architecture TBD. |
| H2 | Zernio integration | Affiliate/payout flow; not yet scoped. |
| H3 | JT Clip Review Tool | Standalone reel review surface; deferred. |
| H4 | Server-side task security v2 | Filter at server, not just client. |
| H5 | JT episode promo Reel | Optional Tuesday drop; generated in Write tab. |
| H6 | Episode detail page / Podcast URL | Per-episode page + dedicated podcast URL for discoverability. |

---

## Notes on this inventory

- **Skipped:** Items already shipped (Phase 1.1–1.5, Phase 2.0, Bridge v2, Tracks A/B/C, v3 Wiring Phases 1–2, Master Template v2.4 patch → v2.5 live, Spoke 0 Caption Consolidation).
- **Skipped:** Pure operational items (Carrie finishing, Mr. Aggarwal Secretary run).
- **Skipped:** Items explicitly in "Ideas — Back Burner" without sizing.
- **Section A vs. D7:** This session's Display work (A2) largely supersedes the legacy Phase 3.3 Schedule Panel UX — D7 flagged as reduced scope, not duplicate work.
- **C3 (Vids) carries the largest unknowns** — separate GAS project, cross-account auth, render timing.
- **B4 and C2 overlap on Writer infrastructure** — Writer Companion is part of C2's MVP scope.
