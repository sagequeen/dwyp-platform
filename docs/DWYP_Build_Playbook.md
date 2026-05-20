# DWYP Build Playbook

**Version:** 5 | May 2026
**Status:** Active runbook
**Foundation references:**
- `DWYP_Surface_Principle.md` — where things live
- `DWYP_Performance_Principle.md` — how things feel
- `DWYP_App_Structure.md` — eight reframes + Phase 2.0 gate; input to all Phase 2 sessions
- `DWYP_Operating_Model.md` § 8 — Companion Model (Publish + Help Desk + Writer architectural decisions)
- `DWYP_PreFlight_Staging_Verification.md` — Code verification prompt for staging

**Purpose:** Sequence the work, specify ownership, define surface-back protocol. Each item points to a future spoke prompt — this document is not a spoke prompt itself.

**Sequencing authority:** This Playbook supersedes ad hoc spoke ordering. Phase 0 housekeeping → Phase 1 (versioning + perf foundation) parallel with Phase 2 (design system) → Phase 3 (application) → Phase 4 (Publish Companion).

---

## How to Use This Playbook

**Two parallel tracks:**
- **Backend track** — mostly autonomous Claude Code work, surface back at push checkpoints
- **Design track** — hub sessions with Audra, decisions captured before code written

Both run simultaneously. They converge at Phase 3.

**Per-item specification:**
- **Owner:** Who does the work
- **Done:** What "complete" looks like
- **Surface back:** What triggers stopping to ask
- **Depends on:** What must be done first

**Universal surface-back triggers (apply to all Claude Code work):**
- Schema decisions never assumed — surface back
- Naming conventions ambiguous — surface back
- Code Integrity Mandate uncomfortable — surface back
- Two reasonable approaches exist — surface back
- After every push, before next item — surface back
- Existing code pattern conflicts with new requirement — surface back

---

## Phase 0: Pre-Flight (Audra)

| # | Item | Owner | Done |
|---|---|---|---|
| 0.1 | Add foundation docs to project knowledge | Audra | Surface, Performance, Publish AI Companion, Help Desk Companion, Build Playbook docs persistent in project. CLAUDE.md too. |
| 0.2 | Add foundation docs to repo | Audra | All foundation docs in repo (root or `/docs`). CLAUDE.md updated and pushed. |
| 0.3 | Update State doc to v5.2+ | Audra | State references all foundation docs in companion list and Foundation Documents section |
| 0.4 | Confirm boundary calls in Surface Principle | Audra | Four open questions answered (add task on mobile, approve revisions on mobile, read creation output mobile, manual download mobile) |
| 0.5 | Run Pre-Flight Staging Verification | Audra (in Code) | Verification report shows PASS on all 6 checks |

**Done state:** Foundation is durable. State doc points at it. Boundary calls confirmed. Staging architecture verified.

---

## Phase 1: Performance Foundation (Backend Track)

**Goal:** Ship measurable perf wins. Establish the cache mechanism that makes everything else work.
**Critical path:** Yes. Unblocks Phase 4 (AI Companions) and indirectly improves all surfaces.
**Parallel safe:** Phase 2 can run alongside.

### 1.1 Versions Tab Schema ✅ Done
- **Owner:** Audra (sheet creation), Claude Code (helper code)
- **Done:** Versions tab created in Master Sheet. Columns: Domain, Version, Last_Modified, Modified_By. Initial rows backfilled for: tasks, episodes, contacts, asset_library, image_library, manifests, governance_config, brand_voice, playbook, content_sensitivity, audit_trail.
- **Surface back:** Confirm initial domain list before backfill.
- **Status:** Both production and staging sheets populated. `setup_versionsTab()` / `setup_versionsTab_staging()` helpers in dev_tools.js bypass `getMasterSheetId()` intentionally (editor context always routes to staging).

### 1.2 bumpVersion Helper + Versions Endpoints ✅ Done
- **Owner:** Claude Code, autonomous
- **Done:** `bumpVersion(domain, callerName)` in fairy_circle.gs with LockService wrapper. `getAllVersions()` and `getDomainVersion(domain)` endpoints in dwyp_app.gs. Drive folder hybrid for image_library.
- **Surface back:** After implementation, before retrofit.
- **Depends on:** 1.1.
- **Status:** Staged + verified. Note: `_resolveImageLibraryVersion()` corrected during 1.3 staging verification — scans file modification timestamps rather than `folder.getLastUpdated()` (which does not update when files are added to a folder).

### 1.3 Existing Endpoint Retrofit ✅ Done
- **Owner:** Claude Code, with checkpoints
- **Done:** 40 write paths retrofitted across fairy_circle.js (8), secretary_fairy.js (2), herald_fairy.js (4), dwyp_app.js (22). `suppressBump` param on `spawnTask()`/`updateTaskStatus()` — dailyPulse() suppresses per-row bumps and fires two unconditional bumps at end of run. audit_trail recursion guard in `bumpVersion()`.
- **Surface back:** Audit table for review before any code changes. Any write path with ambiguous domain.
- **Depends on:** 1.2.
- **Status:** All 11 domains verified via Phase 1 Test Protocol on staging. Production deploy pending (manual step).

### 1.4 Frontend Version-Aware Loader ✅ Done
- **Owner:** Claude Code, autonomous
- **Done:** `loadDomain(domain)` pattern implemented in dwyp_ui.html. Two-call ceiling on tab return: getAllVersions(), then batch fetch only stale domains. Local version cache stored in window.state.
- **Surface back:** After implementation, ready for migration of first surface.
- **Depends on:** 1.2.
- **Status:** `getDomainsBatch()` endpoint + three-bucket domain model (ACTIVE / TRACKED_ONLY / excluded) + `refreshVersions()` / `loadDomain()` / `_rerenderCurrentTab()` + `_coldStartComplete` flag. Staged + verified.

### 1.5 Migrate Dashboard to Version-Aware Loading ✅ Done
- **Owner:** Claude Code, autonomous
- **Done:** Dashboard tasks list, episode cards, and loose tasks all use version-aware loader. Tab return triggers version check, not full refetch. Verified in browser DevTools — second tab return makes one network call only when nothing changed.
- **Surface back:** After implementation, ready for QA.
- **Depends on:** 1.4.
- **Status:** `loadData()` waterfall replaced with getAllVersions → getDomainsBatch cold-start. Staged + verified. Production deploy pending (batched with 1.1–1.3).

### 1.6 Blurhash Thumbnail Generation
- **Owner:** Claude Code, autonomous
- **Done:** Reel rows and image library rows have a `blurhash` column. Filing Fairy generates blurhash at filing time. Reel cards and image grid render blurhash placeholder before real thumbnail loads. First paint <100ms even on slow network.
- **Surface back:** Library choice for blurhash generation in GAS (no native library — may need to use a hash-equivalent like average color or LQIP).
- **Depends on:** None.
- **Parallel safe:** Yes.

### 1.7 Pre-Compute Audit
- **Owner:** Claude Code, with checkpoints
- **Done:** Audit of all GAS endpoints. Anything taking >200ms identified and flagged for either pre-computation at write time or background pre-computation. Report produced. Implementation deferred to per-endpoint decisions.
- **Surface back:** Audit report for Audra review before implementing changes.
- **Depends on:** None.
- **Parallel safe:** Yes.

**Phase 1 done state:** Version stamps live across all domains. Dashboard demonstrates the pattern. Blurhash thumbnails showing. The app is measurably faster on tab return.

---

## Phase 2: Design System (Design Track — Audra-Led)

**Goal:** Lock the component library, mobile IA, and desktop chrome conventions before any visual work.
**Critical path:** Yes. Unblocks Phase 3 and Phase 4.
**Parallel safe:** Phase 1 runs alongside.
**Input doc:** `DWYP_App_Structure.md` v1.2 — eight reframes, surface roles, Phase 2.0 scope.

### 2.0 Action-Completeness Audit ← Gate for 2.1, 2.3, 2.4
- **Owner:** Audra (real workflows, JT shadow workflows, instincts) + Claude (scaffold, matrix template, pattern detection, drafting output doc)
- **Done:** `DWYP_User_Flows.md` produced. Per-surface action inventory complete. Scenarios walked. Surface × action matrix populated across all ten audit lenses (escape hatches, reversibility, recovery, dead ends, cross-surface need, state conflict, empty/error states, permission gradients, export/external, discovery).
- **Surface back:** N/A — hub sessions.
- **Depends on:** `DWYP_App_Structure.md` v1.2 (committed). Nothing else gates this.
- **Cost:** 2–3 hub sessions. More if scenarios reveal architectural gaps.
- **Note:** Full scope, method, and audit lenses in `DWYP_App_Structure.md` v1.2 — Action-Completeness Audit section.

### 2.1 Component Library Hub Session
- **Owner:** Audra (hub with Claude)
- **Done:** Document captures: card variants (entity vs action vs status), button variants (primary/secondary/destructive/icon), input variants, header pattern, status pill, progress indicator, empty state pattern, skeleton pattern, **chat bubble pattern**, **chip primitives** (text replacement, navigation, action). Each component specifies states (default/loading/saving/saved/failed/empty/disabled).
- **Surface back:** N/A — this is a hub session.
- **Note:** Chat bubble + chip primitives are reused across both Publish Companion and Help Desk Companion — design once, apply twice.

### 2.2 Status Indicator Component Design
- **Owner:** Audra (hub with Claude)
- **Done:** Designed pattern captured: visual treatment, position, animation, when shown vs hidden, save/saved/failed states, retry/rollback behavior. First-class component spec, not a toast pattern.
- **Surface back:** N/A.
- **Depends on:** 2.1 in flight (this is a member of the library).

### 2.3 Mobile IA Hub Session
- **Owner:** Audra (hub with Claude)
- **Done:** Document captures: navigation pattern (single feed, bottom nav, etc.), screen inventory (Dashboard, Tasks, Asset Review, Episode Review, Contacts, settings, Help Desk overlay), back behavior, what surfaces "show but don't edit," strict-wall messaging when desktop-only surface is tapped.
- **Surface back:** N/A.

### 2.4 Desktop Chrome Conventions Hub Session
- **Owner:** Audra (hub with Claude)
- **Done:** Document captures: Studio left nav pattern, tab content area structure, panel proportions, toolbar conventions, empty state per tab, episode picker placement, save indicator placement, **right-rail chat placement (Help Desk)**, **per-card chat placement (Publish)**, how the two coexist or toggle.
- **Surface back:** N/A.

**Phase 2 done state:** Three design documents added to project knowledge. Component library is real, mobile IA is real, desktop chrome is real. No code written yet.

---

## Phase 3: Application of Design System (Spoke Track)

**Goal:** Apply the design system to specific surfaces. Each is a propagation of the system, not a freelance redesign.
**Critical path:** Visual modernization (3.2) is high-leverage user-visible work.
**Parallel safe:** Items within Phase 3 can run in any order; pick by leverage.

### 3.1 Build Component Library in Code
- **Owner:** Claude Code, with checkpoints
- **Done:** Library implemented in dwyp_ui.html as reusable HTML/CSS/JS patterns. Each component has its specified states. Status indicator wired to global save-state mechanism. Chat bubble and chip primitives implemented (used by both AI companion spokes in Phase 4).
- **Surface back:** Per-component, after each major piece. Implementation patterns that conflict with existing code.
- **Depends on:** 2.1, 2.2.

### 3.2 Visual Modernization Spoke
- **Owner:** Claude Code, with checkpoints
- **Done:** Glassmorphism, layered shadows, larger corner radius, micro-animations, focus states applied across all five Studio tabs and Dashboard. Brand colors and font unchanged. Skeleton states in place for all list/grid surfaces.
- **Surface back:** Initial pass for visual review before propagation. Any surface where existing visual treatment is intentional and shouldn't change.
- **Depends on:** 3.1.

### 3.3 Schedule Panel UX
- **Owner:** Audra (hub design) → Claude Code (spoke implementation)
- **Done:** Hub design captures: slot state visual signals (filled/empty/draft/approved), sibling pairing indicator, week progress, activity recency. Spoke implements the redesigned panel.
- **Surface back:** Hub: N/A. Spoke: implementation patterns that conflict with existing code.
- **Depends on:** 3.1.

### 3.4 Design Tab Quote Graphic Workspace
- **Owner:** Audra (hub design) → Claude Code (spoke implementation)
- **Done:** Hub design captures: chat panel ↔ image library coexistence, horizontal split or other resolution. Spoke implements.
- **Surface back:** Hub: N/A. Spoke: implementation conflicts.
- **Depends on:** 3.1.

**Phase 3 done state:** App looks materially modernized while keeping brand identity. Schedule panel is no longer overwhelming. Design tab is no longer cramped.

---

## Phase 4: AI Companions (Spoke Track)

**Goal:** Two parallel AI surfaces — Publish per-card companion (creative) and Help Desk (informational). Same architectural pattern, different LLMs and scopes.
**Critical path:** No — but high user-value when shipped.
**Parallel safe:** Both companion spokes can run after Phase 1 + relevant pieces of Phase 3. Running them in close sequence reuses pattern knowledge and chip-rendering code.

### 4.1 Confirm Asset_Library Schema (Publish Companion prerequisite)
- **Owner:** Audra
- **Done:** Reference v2.8 reviewed. `chat_history` column either present (note its position) or added as column 19. Reference v2.9 published if added.
- **Surface back:** N/A.

### 4.2 Playbook Strategic Content (Publish Companion prerequisite)
- **Owner:** Audra (writing)
- **Done:** Playbook document expanded from slot mechanics to strategic reasoning. What each day type is good for. What kind of content lands in each slot. Why. Document lives in `CORPUS_DRIVE_FOLDER_ID` for cached prefix injection.
- **Surface back:** N/A.

### 4.3 AI Companion Governance Keys
- **Owner:** Audra
- **Done:** All companion-related Governance_Config keys decided and populated:
  - `PUBLISH_CHAT_HISTORY_TURN_CAP` (Publish — turns of conversation history per asset)
  - `PUBLISH_SIBLING_CONTEXT_CAP` (Publish — max siblings auto-included, default 4)
  - `HELP_DESK_HISTORY_TURN_CAP` (Help Desk — turns per session)
  - `HELP_DESK_AUDIT_TRAIL_DAYS` (Help Desk — recency window for Audit_Trail slice)
- **Surface back:** N/A.

### 4.4 Publish Companion Spoke
- **Owner:** Claude Code, with checkpoints
- **Done:** Per-card chat panel implemented. Card attaches as docked tab. Conversation history reads from Asset_Library on attach, writes back on send. Sibling context auto-injected at send time. Chip suggestion plumbing (text replacement chips for captions, scheduling commentary chips). Generation calls existing `generatePublishCaption()`/etc functions, wraps with prompt cache prefix and dynamic state assembly.
- **Surface back:** UI placement decisions (deferred to Phase 2.4 design). Send-time briefing assembly logic. Sibling cap mechanics.
- **Depends on:** 1.x (versioning), 3.1 (component library), 4.1, 4.2, 4.3.

### 4.5 Help Desk Companion Spoke
- **Owner:** Claude Code, with checkpoints
- **Done:** Right-rail chat panel implemented (desktop). Mobile overlay implemented. Briefing assembler reads Tasks, Episodes, Contacts, Asset_Library, recent Audit_Trail with version-stamp awareness. `callHelpDesk(question, history)` wraps `callGeminiAPI()` with system prompt + briefing. Navigation chip parsing (`[[NAV:...]]` markers) implemented and dispatches frontend routing. Session-scoped history (no persistence).
- **Surface back:** Briefing size budget decisions if Gemini context limits hit. Cross-user privacy default (filter by `who` parameter — confirm before locking).
- **Depends on:** 1.x (versioning), 3.1 (component library — chat bubble + chip primitives), 4.3.
- **Note:** Reuses chip parser pattern from 4.4 if 4.4 ships first. Worth running 4.4 → 4.5 in sequence to capture pattern reuse.

**Phase 4 done state:** Both AI companions live. JT can chat with Claude per Publish card. Both users can ask Help Desk questions across all surfaces. Each companion stays in its lane.

---

## Phase 5: Future Spokes (Queued)

Items confirmed but not yet sequenced. Pick up after Phase 4 stabilizes.

- **SupoClip evaluation** — open-source Reels clipping tool flagged for assessment.
- **NF-1 Quotes Dedup Review** — surface and resolve duplicate quote candidates.
- **NF-2 Reel Identity & Comment Portability** — reel-identity scheme that survives re-edits, preserves comments across reel iterations.
- **NF-3 AI Video Review (END ALL)** — speculative future: AI-assisted episode review pass.
- **Comment System + Revise Sync implementation** — per Reference architecture (see Episode Review — Comments & Revise Sync section in Platform Reference).
- **Design ↔ Publish asset travel implementation** — per Reference architecture (see Design ↔ Publish Asset Travel section in Platform Reference).

---

## Critical Path

```
Phase 0 → Phase 1 (parallel with Phase 2) → Phase 3 → Phase 4
                ↓                              ↑
           foundational              applies the system
```

**Soonest user-visible win:** Phase 1 lands first. Faster app, no UI redesign required.
**Biggest user-visible win:** Phase 3.2 (visual modernization) once Phase 2 is done.
**Highest JT/Audra leverage win:** Phase 4 (AI companions) once foundations are stable.

---

## Surface-Back Protocol for Claude Code

When chipping away autonomously, surface back at:

**Always:**
- Push checkpoints (after every code push)
- End of any numbered playbook item
- Before starting any item where dependencies aren't satisfied

**Decision-shaped:**
- Schema choice not specified
- Naming convention not obvious
- Two equally-defensible implementation paths
- Existing code pattern would need to change

**Risk-shaped:**
- Code Integrity Mandate gets uncomfortable
- Action would touch a domain outside the spoke's scope
- Tests reveal unexpected current behavior
- Push would deploy partial functionality

**Format when surfacing:**
- State current playbook item
- State what was completed
- State what triggered the surface-back
- Propose path forward, don't ask open-ended questions

**Format when finishing autonomously:**
- State playbook item completed
- State what's next per playbook
- Wait for Audra confirmation before proceeding to next item

---

## What This Playbook Does NOT Cover

- **Existing operational work** (Carrie episode finishing, Mr. Aggarwal pipeline, Filing Fairy runs) — separate operational queue
- **Spokes already in flight** (items 59–84 push, Reels Surface remaining work) — pre-existing
- **Future Force build** — separate engagement, separate scope
- **Bespoke business model work** — separate track entirely

---

## Cancelled Items

### Scribe Fairy spoke
**Was:** Queued indefinitely — autonomous email sender for pipeline communication events (guest invite, scheduling confirm, follow-ups, release announcements).
**Cancelled:** Reframe #8. Was never deployed; seven template keys blank; Daily Pulse Loop 2 indefinitely queued.
**What replaces it:** Pipeline email events spawn Writer email tasks that JT completes autonomously. Templates migrate to Writer Email quick-start templates (the seven blank Scribe keys finally have a home). Daily Pulse Loop 2 rewires to spawn a release reminder task rather than a Scribe send.
**Stub:** `scribe_fairy.gs` retained as dead-code stub (joins `safety_fairy.gs`, `marcom_fairy.gs` — pre-CIM exception, explicit retention). No new GAS wiring needed — trigger logic in Secretary and Daily Pulse already knows when events should fire.

---

## Update Cadence

This playbook gets updated when:
- A phase completes (mark done, identify what surfaced)
- A new design decision changes scope
- A spoke reveals scope smaller or larger than estimated
- A new surface gets added (like Help Desk Companion was added in v2)

Treat as a working document. Versions noted at the top.

---

## Version History

| Version | Date | Change |
|---|---|---|
| v1 | May 2026 | Initial playbook capture. Foundation principles + version stamp pattern + design system pass + Publish Companion. |
| v2 | May 2026 | Help Desk Companion added to Phase 4 alongside Publish Companion. Component library 2.1 expanded to include chat bubble + chip primitives (shared between companions). Desktop chrome conventions 2.4 expanded to include right-rail Help Desk placement and per-card Publish placement coexistence. Phase 0 expanded with State doc update + Pre-Flight Verification run. |
| v3 | May 2026 | Phase 1.1–1.3 marked complete. Status notes added to each item. _resolveImageLibraryVersion() fix documented in 1.2. |
| v4 | May 2026 | Phase 1.4–1.5 marked complete. Three-bucket domain model, loadData() migration, staging verification notes added. |
| v5 | May 2026 | Phase 2.0 (Action-Completeness Audit) added as gate for 2.1/2.3/2.4. App_Structure v1.2 added to foundation references and Phase 2 input. Scribe spoke cancelled (Reframe #8) — Writer tasks replace autonomous sends; templates migrate to Writer quick-starts. |

---

*Build playbook v5 — May 2026. Audra + Claude. Sequences foundation → design system → application → companions. Both autonomous and hub-led tracks specified. Phase 2.0 action-completeness audit gates all Phase 2 design sessions.*
