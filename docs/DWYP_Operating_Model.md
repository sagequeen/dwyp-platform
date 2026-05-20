# DWYP Operating Model
**Version:** 1.1 | May 2026
**Replaces:** DWYP_Operating_Model.md v1.0
**Status:** Synthesis doc. Code-portable spine. Replaces nothing; compresses everything.


---

## Purpose

A single short reference that gives Claude — Code or Hub — the spine of the DWYP app in one read. Each section points to its authoritative source. If you're touching the platform and need to know *what's true*, start here.

This doc does not introduce new design. Anything still being decided is named in §11 Open, not invented inline.

### What changed from v1.0
- §2 Foundation Principles now carries the mechanism for each principle (version stamps, mobile/desktop boundary calls, cognitive offloading corollaries), not just one-liners.
- §8 Companion Model gains the **Companion Spectrum** table — Publish, Help Desk, and Writer are different lanes with different LLMs. Help Desk uses Gemini; Publish and Writer use Claude. Chip pattern named as a shared UI primitive.
- §9 Slot Model gains the Publish surface 4-panel layout, Design tab Save & Stay / Save & Return, Continue card, and Episode Index as Studio's knowledge layer.
- §11 Open and §12 Sources expanded.

---

## 1. Who and Why

**JT** — podcast host. ADHD, intuition-driven, design-involved, extremely not tech-savvy. Talent role only: reviews, uses Publish, hosts. Avoids Drive. Primary user of creative surfaces. Trust is built through polished output, not system explanations.

**Audra** — platform architect, producer, developer. Also a user: episode review, revision queue, ops drawer. Audra-as-architect builds; Audra-as-user works inside.

**The show:** *Don't Waste Your Pain.* Honest about hard things — illness, loss, grief, trauma. Wisdom, not self-help. JT's voice is a documented voice — every Claude call references `DWYP_BrandVoice_v1.md`.

**Success metric:** *how little JT has to do in the app.* The platform earns its keep by spending its own memory so JT doesn't have to spend hers. The goal of every Publish session is **one sitting** — opens Publish, works through the week, closes it knowing everything is scheduled. No hunting, no copying, no context switching.

---

## 2. Foundation Principles

Three principles. Each governs a different axis. They cooperate; none stands alone.

### Surface Principle — *where things live*

**The test:** *Is this a decision, approval, or awareness?* → Mobile. *Is this composition, creation, or sustained focus work?* → Desktop. When unclear, default desktop. Composition is the more failure-sensitive task.

**Strict separation, not graceful degradation.** When a mobile user taps a desktop-only surface, the response is a hard wall: "Studio is desktop-only. Open [URL] on your computer." Soft degradation breaks the principle quietly — once "just a small caption tweak" works on mobile, every subsequent feature gets pulled into a mobile compromise.

**Single deploy, responsive breakpoint.** One web app URL. Same auth, same data, same backend. Frontend renders mobile chrome below breakpoint, desktop chrome above. Surface logic decides what surfaces appear, not separate codebases.

**Six boundary calls (locked May 2026):**

| Call | Decision |
|---|---|
| Adding a task on mobile | ✅ Mobile — ops |
| Approving Audra's revision turnarounds on mobile | ✅ Mobile — ops |
| Reading creation output on mobile | ❌ Desktop — *exception: Write Lite (below)* |
| Manual asset download on mobile | ✅ Mobile — execution, not creation |
| Write Lite (idea capture only) | ✅ Mobile — chat input → Drive doc, continues on desktop |
| Audra mobile production actions | ❌ Desktop — Filing Fairy, Herald re-enrichment, governance edits |

**Write Lite (Boundary Call #6) is the narrow exception.** Chat input only — keyboard or voice. Claude responds. *No corpus, no episode context, no canvas, no chips.* The conversation saves to one new Drive doc per session, appears in Write tab's My Docs panel on desktop. Composition continues on desktop. The hard wall holds for everything else in Studio.

**Authoritative source:** `DWYP_Surface_Principle.md`.

### Performance Principle — *how things feel*

**Show first, sync second. Latency is a UX failure.** If the user has to wait on the backend before seeing the result of their action, the system is broken — even if the action eventually succeeds.

**Three pillars:**
1. **Cache aggressively, invalidate explicitly via version stamps.** Treat all reads as cached by default. Use version stamps to know exactly when a refetch is necessary — never refetch on a schedule.
2. **Optimistic UI by default.** User actions apply to local state immediately. Backend writes happen asynchronously. The user sees the result in <50ms regardless of network. Failures surface visibly and roll back.
3. **Progressive loading.** Lowest-fidelity placeholder first, real content second. Skeleton → thumbnail → high-res. Never block on the heaviest asset.

**Version stamp mechanism (load-bearing — every new write path must respect this):**

A `Versions` tab in Master Sheet tracks a monotonically-increasing version number per data domain.

```
Domain | Version | Last_Modified | Modified_By
```

**Write pattern:** every mutation calls `bumpVersion(domain, callerName)` inside a LockService critical section.

**Frontend read pattern (two-call ceiling on tab return):**
1. `getAllVersions()` → `{ image_library: 48, tasks: 1234, ... }`
2. Compare to local versions. Unchanged domains → local cache, zero fetch. Changed domains → batch-fetch in a single call.

Most tab returns hit only call #1.

**Drive folder hybrid (self-healing for external changes).** Some domains (e.g., image library) can be modified outside the app. GAS scans individual file modification timestamps when reading; if any file changed since the stored timestamp, GAS auto-bumps the sheet version. *`DriveApp.getFolderById().getLastUpdated()` does NOT update on file additions — scan individual file timestamps.*

**Optimistic UI patterns** — every user action has a local-first response:

| Action | Pattern |
|---|---|
| Tap Complete on task | Mark done locally, queue API write, subtle saving indicator |
| Type in caption field | Update local state, debounce save (1s), saving indicator |
| Apply Claude chip suggestion | Swap text immediately, write to Asset_Library async |
| Move asset between slots | Show new position immediately, reconcile on failure |
| Toggle Influence_Tier | Update toggle immediately, write through |
| Drag-and-drop on canvas | Local state only until explicit save |

**Failure handling:** failures are loud, successes are silent. A first-class status indicator (not a toast) shows save state. Failed writes auto-revert local state; JT doesn't have to undo anything. Transient failures retry once before surfacing.

**Architectural rules that follow:**
- Batch endpoints. A single GAS call should return everything a screen needs (e.g., `getDashboardBundle`, `getInitialPayload`).
- Versions endpoint is always batch. Never check versions one at a time.
- Sheet reads are the bottleneck. Read once per call. Sheet writes batch via `setValues()`.
- Drive operations are slow. Cache file IDs aggressively.
- Avoid full refreshes. Version-check first; diff and patch.

**Authoritative source:** `DWYP_Performance_Principle.md`.

### Cognitive Offloading — *what the user holds*

The platform holds what JT and Audra would otherwise have to remember, decide, or repeat. Memory is finite; the platform spends its own so theirs is freed.

Applies to *both* users. Audra-as-architect builds; Audra-as-user works inside.

See §4 for the corollary table — 13 operational rules under this principle.

**Authoritative source:** `DWYP_App_Structure.md` v1.3.

---

## 3. The Eight Reframes

The spine. One line each. Listed in the order they emerged.

1. **Playbook-as-Engine** — A pre-compose engine reads a Playbook (the `Why` column in the slot recipe table) to fill the week's slots with ranked drafts *before* JT opens the app. AI chat = refinement, not creation.
2. **Studio-as-the-App + Episodes-as-Tabs** — No dashboard. No separate Studio surface. The app is one surface; episodes are tabs in the left rail.
3. **Mobile = What Is, Not What Should Be** — Mobile is read/react/schedule. Origination lives on desktop. Hard wall, not graceful degradation.
4. **Project, Not Episode** — Episode is the dense recurring instance of a more general shape. Build for the specific case; generalize only when a second case shows up with real evidence.
5. **Slot-Type Unifies Outbound** — The schedule is a unified calendar of typed slots. Slot type determines recipe, platform target, asset shape, review affordance.
6. **Modes Die — Three Surfaces** — JT never picks a mode. She taps a task; the center pane assembles Publish, Writer, or Design.
7. **AI Context = User Surface** — The assistant on every surface knows what the user sees plus the corpus. Nothing more. No cross-session memory.
8. **Pipeline Emails Become Writer Tasks** — No autonomous send. Pipeline-triggered emails open as Writer tasks pre-seeded with template + payload. Gmail Drafts is the terminal gate.

---

## 4. Corollaries — Operational Rules Under Cognitive Offloading

Compact. Cite when explaining a design choice.

| Corollary | One-line |
|---|---|
| Date-Driven Priority | Default order = soonest due, actionable for current user. Completion sinks. |
| Decisions Are Binary | Default surfaces narrow to binary or small-N. |
| Hidden Until Engaged | Originator escape hatches live behind a deliberate gesture. |
| Escape Hatch Returns You Home | Tools generate; the canvas owns. |
| Schedule Button Is The Verb | Atomic done = Schedule pressed. Make's read time is the technical lock. |
| Resume By Priority | Across sessions, app opens to what needs doing next. |
| Action Lives Where Awareness Arrived | Remediation gesture sits where awareness landed. |
| Use The Channel That Arrives In Your Hand | Optimize the channel for reach, not rich content. Rich content lives in the app. |
| Point, Don't Narrate | Link to ground truth; don't re-render it. Platform = pointer (default), generator (last resort). |
| Absence Is A Signal | Missing payload tells the user about upstream work. The gap *is* the message. |
| Edit Is A Mode, Not A Default | Reference surfaces open read-only. Edit is a deliberate gesture; Save flips it back. |
| Workspace Persistence | One editable copy per reference doc per user. Persists across sessions. |
| Within-Session State Persists; Cross-Session Resets To Priority | Mid-session navigation is JT's. Session start resumes by need. |

---

## 5. Operational Principles — Architectural Constraints

Not user-facing. These make Cognitive Offloading possible.

### The Slot Is The State
A slot is filled or empty. Make pulls slot contents at post time. No commit-vs-approved-vs-scheduled distinctions. JT sees state, not mechanism.

*Caveat (reels only):* `Asset_Library.Availability` blocks reels with active revision requests from entering slots. `Status` governs lifecycle; `Availability` governs schedulability — separate columns.

### Pending Is Derived, Not Stored
"Pending" is computed at render time from the join between the slot recipe table and Asset_Library presence. No Status enum value, no schema migration, single source of truth.

`Asset_Library.Availability` has exactly two values: `available` / `placed`. No `pending`. No `bank`.

### Sibling, Not Sibling Surface
Non-episode-scoped content that follows the same scheduling pattern lives in the *same* surface as episode content. Nullable `Episode_UID` is sufficient. No parallel UI for "standalone" work.

---

## 6. The Four-Pane Chrome (Desktop)

The app's spatial contract. Every surface sits inside it.

| Pane | Width | What it holds |
|---|---|---|
| Left — Episode tabs | Compact | Episode list, free workspace, contacts, loose tasks, (Audra) ops |
| Center-left — Canvas | Largest, primary | Active workspace (Publish week, Writer doc, Design canvas, episode review, task surface) |
| Center-right — Contextual / expanded menu | Variable | Whatever the rail icon expanded |
| Right — Rail | Narrow icon column | Canvas-aware tools; Claude is one icon |

**Mobile** is the same chrome with reaction-only verbs per the Surface Principle. Not a separate surface — a permission profile.

### Episode Tab Anatomy

```
[Guest Name]
[Release Date or fallback]
🎧 🖼 🎬
```

No blocking task text. Icons carry the signal. Tasks for an episode live *inside* the tab once tapped.

**Date fallback chain:** `Release_Date` → `Recording_Date` → `TBD`. TBD sorts to bottom under Date-Driven Priority.

**Active set:** Episode lives in left rail from Drive folder creation (Secretary at scheduling) through end-of-day of the final social post for that episode. Then it leaves the rail. Archive surface deferred until JT asks for it.

### Icon State Machine (Locked at 3 Colors, Role-Filtered)

| State | Audra | JT |
|---|---|---|
| Gray | nothing to do | nothing to do |
| Gold | ready to deliver | ready to review/schedule |
| Red | revision in queue/progress | Audra has it; add tasks at your own risk |

**Gold = JT's court. Red = Audra's court. Gray = nobody's.** One icon tells both parties the same truth about who holds the work.

### Within-Session vs. Cross-Session

| Trigger | Behavior |
|---|---|
| New session (first open of the day / after close) | Resume By Priority. Last navigation NOT preserved. |
| Mid-session tab/canvas changes | Last state IS preserved on return. |

---

## 7. The Rail Contract

The right rail is **canvas-aware**. Composition reflects what's open in the center pane.

**Cardinal rule:** the rail never has its own destination. Everything in the rail acts on the center pane. If a control wouldn't make sense as "applies to what's open," it doesn't belong in the rail.

**Default expectation: two panels open at once.** Claude (top) + active contextual panel (bottom). Riverside-style stacking. Not the exception.

**Per-surface composition:**

| Surface | Rail composition |
|---|---|
| Universal | Claude (open by default) |
| Publish — Quote Graphic canvas | Library \| Generate toggle below Claude |
| Publish — Reel canvas | TBD (Edit Reel / Trim affordance lives here when Sentinel ships) |
| Writer | Vert panel; Claude still primary |
| Help Desk | Right-rail icon → center-right pane (Gemini, ops Q&A) |
| Design / Outreach / Ideas | Same contract; per-surface composition walked individually |

**Rail icons are verbs, not vendors.** JT picks "Generate" or "Library," not "Gemini" or "Adobe."

**Center-right pane** is the expanded panel of whatever right-rail icon was activated. Transient; not always present. Overlay-vs-push-vs-float behavior is open (Q17).

---

## 8. The Companion Model

The most condensed section because the most assumptions live here. Read carefully.

### Three AI Layers — Locked

| Layer | Tech | Role | Surfacing |
|---|---|---|---|
| **Claude** | Claude API | All human-facing creative copy — captions, hooks, chat responses, scheduling commentary. | Right rail, top half. Publish + Writer + Design. |
| **Vert** | Vertex AI RAG (us-south1, Spanner) | Retrieval only. Queries the corpus. Never generates. | Dual-access: Claude calls it as a tool (transparent, mid-response); JT opens it directly as a search panel in Writer when she wants to drive the query herself. |
| **Gemini** | Gemini API | Image generation (**GenGem**), audio/video processing, Herald guest research, Help Desk Q&A. | Invisible to JT inside Generate panel; visible to her as the Help Desk chat. |

**Retired:** "Social Vert" and "Librarian Vert" as named personas. The roles are now Vert (retrieval) and Claude (generation). Claude introduces itself as Claude in Studio chat.

**GAS is the nervous system, not a brain.** Every API call is a stateless packet: system instruction + message history + injected context. Claude and Gemini only see what GAS sends.

**Single governance key:** `STUDIO_LLM_MODE = claude` covers all Claude text generation. Code-level Gemini fallback on Claude API failure — automatic, logged to Audit_Trail.

### Companion Spectrum

Three companions, three lanes. Same chip primitive, different LLMs, different scopes.

| Companion | LLM | Scope | History | Surfacing |
|---|---|---|---|---|
| **Publish AI Companion** | Claude | Active card + same-date siblings (cap 4) + episode index | Per-asset, persisted in `Asset_Library.chat_history` (column 19, schema delta pending) | Per-card chat panel; card "docks" as tab header |
| **Writer Companion** | Claude | Pinned episode docs + open canvas + user-added docs + corpus (Vert-first) | Per-session, in-memory | Right-rail Claude icon |
| **Help Desk Companion** | **Gemini** | Tasks + episodes + contacts + Asset_Library + recent Audit_Trail. **Read-only on data.** | Session-scoped (closes tab = clears). No persistence. | Right-rail icon → center-right pane |

**Why Gemini for Help Desk:** ~10× cheaper, doesn't need brand voice or reasoning — just "given this data, answer the question." Already wired (`callGeminiAPI()` from Herald). Lane preservation: Claude for human-facing creative copy; Gemini for grunt work.

**Help Desk tone — direct, no padding.** Functional Q&A, not conversational rapport. System prompt enforces concise, factual register: "Three open tasks: Review Reels (Carrie), Guest Brief Enrich (Aggarwal)…" — not "Sure! Let me check that for you." Out-of-scope requests (mutations, corpus search, creative work) get graceful redirects with navigation chips where applicable.

### Claude's Posture (Creative Companions)

From JT's own words (captured S1):

> A patient assistant who presents options, then chills out in the corner unless she speaks.

Implications:
- Claude does not generate unsolicited prose.
- Claude offers **chips first**, prose only when chips can't carry it.
- Claude speaks JT's voice — system instruction references Brand Voice.
- **Chips never auto-write.** Claude never modifies JT's text directly. All suggestions arrive as tappable chips. JT chooses whether to apply. This preserves her draft and removes the trust risk.

### The Phone Call Model (All Companions)

Stateless. Every send fires a fresh API call. No persistent memory on the LLM side.

```
User asks question → GAS assembles packet → Claude/Gemini → response → forget
```

GAS is the courier. Browser hands GAS the page state, GAS prepends static prefix (brand voice, sensitivity, playbook, system prompt) and conversation history, makes the API call, returns response. **Prompt caching from day one** — static prefix cached at API layer; dynamic block re-sent fresh.

### Foreground = Current Room

What each companion sees per call:

| Companion | Foreground |
|---|---|
| Publish per-slot chat | Active card + same-date siblings (cap 4) + episode metadata + episode index |
| Writer | Pinned episode docs + open canvas + user-added docs |
| Help Desk | Tasks + episodes + contacts + Asset_Library + Audit_Trail (last N days) |

**Persistent + contextual — both true.** Claude *is* always in the rail; what she *sees* depends on what's foregrounded. Same conversation thread per episode tab; refreshed context per slot.

**No cross-session memory at the LLM layer.** Asset-attached `chat_history` is the per-asset durable thread (Publish). Session-scoped clears for Writer and Help Desk. Feedback loop is *Audra-tuned via `Why` cells*, not auto-learned.

**Publish Companion hard exclusions.** Past closed episodes, full corpus search, other platform tabs (Tasks/Contacts/Dashboard), and production status (review gating, proxy approvals) are out of scope. When JT asks Publish-scope Claude something corpus-shaped, graceful handoff: "I can see this week's content. For full archive search, Studio is your tool."

### Chip Routing — How Claude Acts On The Canvas

Claude's chat output can include tappable chips. Routing is foreground-aware:

| Chip type | Action |
|---|---|
| Quote/hook chip | Inserts text into active canvas |
| Image-prompt chip | Fills Generate panel prompt. Auto-toggles bottom panel to Generate if Library is currently showing. |
| Caption variant chip | Replaces caption text in active card |
| Scheduling commentary chip | "Try moving this to Thursday" — tap to act, ignore otherwise. Grounded in cached playbook strategic logic. |

**Help Desk navigation chips use a parallel pattern:**

```
[[NAV:task:<task_id>]]   [[NAV:episode:<episode_uid>]]   [[NAV:contact:<contact_id>]]
```

Gemini emits inline; frontend parses and renders as tappable elements. Tap dispatches the navigation through existing routing. **Same UI primitive, different action type.** Caption chips act on the canvas; navigation chips act on the route.

Chips are *Point, Don't Narrate* expressed as a UI mechanism. JT taps; canvas (or route) updates. No copy/paste, no parsing prose for actionable items.

### Vert-as-Tool Latency

When Claude calls Vert mid-response, surface a brief "checking the corpus…" indicator. Latency reads as intentional.

### Token Warning

`STUDIO_TOKEN_WARNING_THRESHOLD = 50000`. When a session crosses the threshold, surface soft warning: "This session is getting long — consider starting a new one." Not a hard stop.

### Card Attachment as Visual Indicator (Publish)

Selected card docks into the chat panel as a "tab" header — visual confirmation of what Claude is briefed on. Switch cards → docked tab updates → conversation history swaps from Asset_Library.

```
[ ATTACHED: Tuesday IG Reel — Carrie Sipe ]
─────────────────────────────────────────────
[ chat history ]
─────────────────────────────────────────────
[ message input ]
```

---

## 9. The Slot Model

Heart of the Publish surface.

### Episode Index — Studio's Knowledge Layer

A permanent markdown document, one per episode, stored in a dedicated index folder (`EPISODE_SEARCH_INDEX_KEY`). Written by Vert Fairy as part of the show notes run. Studio reads it on open.

| Section | Source | Living? |
|---|---|---|
| Episode summary | Vert Fairy Pass 2 | No — evergreen |
| Guest profile snapshot | Herald + Secretary | No |
| Hooks & quotes (transcript-sourced) | Vert Fairy Pass 2 | No |
| Social asset seeds (image prompts + caption seeds) | Vert Fairy Pass 2 | No |
| Key themes | Vert Fairy Pass 2 | No |
| Transcript map (landmark-dense) | Vert Fairy Pass 2 | No |
| Reel descriptions | Daily Pulse / Mending Fairy | **Yes** — updated on reel add/remove |

Index makes Claude feel continuous despite having no memory. Studio loads index on open; hooks/quotes/prompts/captions already present. No generation wait.

**Retrieval strategy by surface:**

| Surface | Retrieval | Latency expectation |
|---|---|---|
| Publish | Index-first; Vertex only if insufficient | Fast — pre-populated |
| Writer | Vertex-first, cross-episode | Moderate — on demand |
| Studio chat | Vertex-first | Moderate — on demand |

### Recipe-Driven Week

A **slot recipe table** (storage Q14 open — Master Sheet tab vs. Governance_Config) defines what a week looks like per episode:

`Slot_ID · Day · Asset_Type · Platform · Why · Sort_Order · Ratio`

`Why` is the load-bearing field. Not UI copy — it's a generation parameter consumed by Vert Fairy Pass 2 during overnight enrichment, AND it's the operational Playbook expressed as text Claude can reason against.

**Audra tunes the Playbook by editing `Why` cells.** Weekly cadence. No code change.

### Pre-Composition (Overnight, Heavy)

For Quote Graphics: per slot, overnight enrichment delivers **three ranked pre-composed canvases**.

Per ranked Asset_Library row, Claude writes:

| Field | Notes |
|---|---|
| `Quote_Text` | Exact extracted text (existing) |
| `Quality_Score` | 1–5 integer, slot-independent. **New column.** |
| `Tags` | CSV/JSON array from `ASSET_TAG_VOCABULARY`. **New column.** |
| `Caption_Draft` | 3 variants, JSON array (existing) |
| `Image_Prompt` | Claude-authored. Generate panel pre-fill, not a render trigger. |
| `Background_ID` | Library image picked by Claude based on quote tone + slot's Why. |
| `Canvas_State` | Text + background = ready-to-ship composition. |
| `chat_history` | Per-asset JSON blob. Read on card attach, written on send. **Column 19 — schema delta pending.** |

**Zero Gemini image calls overnight.** Library does the heavy lifting. GenGem fires only when JT presses Generate in-session.

### Ranking and Display

Per slot, candidate order:
1. `Quality_Score` DESC (primary)
2. Tag-match to `slot.Why` (secondary)

Computed at render time. Cheap. No Claude call.

### Asset-Class Asymmetry

Pre-compose is not uniform across asset types:

| Asset class | Source | Engine role |
|---|---|---|
| Images (Quote Graphics, Thumbnails) | Vert Fairy Pass 2 from episode index | Generates options |
| Reels | Audra grabs from Riverside (baseline); JT marks in/outs during Episode Review (trickle) | Generates captions on existing reels |
| Episode (release-day) | Render pipeline | Pending until release day |

**Playbook-as-Engine handles refinement of options, not asset sourcing.** Reel sourcing remains JT-driven and won't be automated.

### Reels — Two Asset Types

Reels carry two distinct generation contexts:

| Type | Purpose | Generation context |
|---|---|---|
| **Title card** | On-image text overlay | Short, hook-energy, voice-driven |
| **Caption** | Post copy on social | Guest name, episode topic, brand voice, CTA structure, audio-grounded summary |

Each gets its own system prompt and chip suggestions. Audio summary requirement for captions remains locked (Gemini audio extraction prerequisite — `GAS_AUDIO_CEILING_35MB` unresolved risk).

### Pending Canvas (When Slot Has No Available Asset)

Two buttons. No narration.

| Button | Behavior |
|---|---|
| **Next** | Skip to next actionable slot/task. Resume By Priority in button form. |
| **Poke** | Spawn an idempotent task targeting upstream (Audra). One open task per `(episode_uid, asset_type, slot_day)`. |

### Reels Surface — Accordion-as-Focus (Scoped to Reels in v0.1)

One reel card expanded per slot at a time. Opening another collapses the previous.

| Collapsed | Expanded |
|---|---|
| Thumbnail + truncated Reel_Summary + slot indicator + Star | Inline player + full Reel_Summary + Caption + Title Card + Generate + Schedule + Request Revisions + Star |

One card expanded = Claude's working context. **Slot-level prompts** are legal when nothing is expanded ("which of these is strongest for Tuesday?").

**Reels have two asset types per card** — title card (on-image text overlay; hook-energy) and caption (post copy; audio-grounded summary required). Each gets its own system prompt and chip suggestions. Audio summary requirement remains locked (Gemini audio extraction, GAS 35MB ceiling unresolved).

*Note: v0.1 scopes Accordion-as-Focus to Reels. Quote Graphics are single-asset-per-slot (3 ranked variants live within one slot, no per-card accordion). Whether Accordion-as-Focus also applies at the slot-stack-level on the day grid is currently being walked in hub — see §11.*

### Publish Surface — 4-Panel Layout (v2 Authoritative; v3 Remodeling)

The current Publish surface (v2 layout):

1. **Panel 1 — Nav (far left).** Collapsible icon navigation. Peer of other Studio tabs.
2. **Panel 2 — Week accordion.** Episode entry + Monday–Saturday days + slots. Slots gold (playbook) or crimson (custom). Filled slot taps reload canvas. Finalize button locked until all slots decided.
3. **Panel 3 — Hooks & Quotes panel / Canvas workspace.** Populated from episode index. Tapping places text on canvas and fires caption generation.
4. **Panel 4 — Background tools.** Prompt → Generate (GenGem, `4:5`) → Generated strip (session) → Library (curated).

**Canvas:** Fabric.js 360×450 display, exports 1080×1350 PNG (4:5). Text always `fontStyle: normal`. Toolbar: Undo / Redo / Center / Logo.

**v3 in-flight remodel:** Hooks & Quotes panel migrating to Claude chip routing in the right rail; Background tools migrating to Library | Generate toggle in the right rail. Panels 3 and 4 partially collapse into the right rail; center pane becomes day-stack with Accordion-as-Focus at the slot level. See §11 for current open items.

### Design Tab — Save & Stay / Save & Return / Continue Card

Same Fabric.js canvas as Publish. JT does deeper creative work here when she wants more than Publish's canvas offers.

**Asset travel between Design and Publish:**
- Edit button in Publish navigates to Design with asset loaded. Context held: `publish_origin: { episode_uid, slot_id }`.
- In Design: **Save & Stay** or **Save & Return** (returns to correct Publish slot).
- If accessed directly from nav: Save & Stay only — no return context.

**Canvas state — Continue card:**
- Autosaves to a single manifest per session on every debounced pause.
- On open: Continue card with thumbnail + timestamp. Tap to restore. Ignore to start fresh.
- Continue card clears on explicit Save or Save & Return.

### Image Workshop — Fully Retired

Replaced by Publish canvas. No bones carried forward. Code removed in Spoke 1 spring clean.

### Slot Pairing by Slide_Index

Multi-platform slots (LinkedIn + Facebook for the same quote) share `Slide_Index`. Placing one pairs the other automatically (`Availability=paired`). Three-option carousel = three Slide_Index groups stacked.

---

## 10. Cardinal Rules

Compact restatements. Cite when locking a decision.

- **Library-first.** Library covers the common case. Generate is the refinement path. Holds image-gen volume to ~1–3 calls per episode in-session rather than 12 overnight.
- **Pre-population over creation.** JT edits 80% ready, not generates from zero. Chat is the 20% tangent.
- **Chips never auto-write.** Claude suggests; JT chooses. Preserves the draft, removes trust risk, matches the existing chip pattern.
- **One foreground at a time.** Where Accordion-as-Focus applies, one card expanded = Claude's working context. No ambient promote/demote logic.
- **Why is durable.** `Why` is stable, load-bearing, human-readable. Not a runtime UI edit. Audra tunes the Playbook by editing `Why` cells.
- **Closed tag vocabulary.** Free-form tags drift. `ASSET_TAG_VOCABULARY` in Governance_Config is the controlled list. Claude must pick from it during enrichment; Audra authors Whys against the same list.
- **GAS is the nervous system, not a brain.** Stateless packets in; structured output written back.
- **Rail icons are verbs, not vendors.** "Generate" or "Library" — never "Gemini" or "Adobe."
- **Make reads at post time.** Technical lock on a scheduled slot happens silently at Make's read. No platform-side commit gesture beyond Schedule pressed.
- **Star stays semantic.** Star = "request revisions auto-applied" + JT's manual marker. Accordion handles focus; Star stays clean.
- **No hardcoded strings.** All config in Governance_Config. Prose behavior in Master Template, not code.
- **Engine stays, chassis changes (v2 → v3 transition).** Visual treatment and spatial arrangement are remodeling targets. Function signatures and behavior, data layer schemas and access patterns, server endpoints, and state semantics are preserved. The Code Integrity Mandate protects the engine; the surface around it changes. When in doubt, ask — over-preservation creates duplicate components and orphaned columns. *Transitional clause; remove when v3 chrome stabilizes.*
- **Code Integrity Mandate.** Targeted edits over wholesale rewrites. Schema-shaped functions, routing helpers, and fairy entry points require care. Deletions require an explicit decision (but dead stubs are not retained by default — CIM-era retired code can be deleted). Full mandate in `CLAUDE.md`.
- **Every write bumps a version.** Every mutation calls `bumpVersion(domain, callerName)`. The version stamp is what makes optimistic UI safe.
- **Lane preservation for LLMs.** Claude for human-facing creative copy. Gemini for grunt work (Help Desk Q&A, image generation, Herald research, audio processing). Don't mix them.

---

## 11. Open — Decisions Not Yet Made

Live tensions. Do not invent answers; surface them to Audra.

### Current hub session (Studio v3 Center Canvas + Companion)

| Question | Framing |
|---|---|
| **Accordion-as-Focus scope** | v0.1 locks it for Reels only. Hub conversation has evolved to apply it at the slot-stack level on the day grid (one slot expanded at a time in the center pane). Two layers — slot-stack-level AND reel-candidate-level inside a slot — need explicit naming. |
| **Center canvas behavior inside an expanded slot** | Spatial arrangement of canvas + 3 pre-composed options + Claude awareness — undefined. How does the Reels slot canvas differ from the Quote Graphic slot canvas? |
| **Companion surfacing details** | When Claude speaks first vs. waits. How loading state shows. Whether Claude has a visible header or floats. How the "persistent + contextual" duality is communicated. |
| **Collapsible right rail** | Whole-rail edge tab vs. Claude-only minimize vs. both panels independent. The "Riverside feel of collapsible right side menu" JT named. |

### Companion design open items (from Publish AI Companion Design)

| # | Question |
|---|---|
| OQ-A | Chat panel ↔ image library competition (Design tab quote graphic workspace) — horizontal split candidate |
| OQ-D | Sibling context cap mechanics — what's the UX when capped (warning, graceful drop, "showing 4 of 7")? |
| OQ-E | Conversation history turn cap — what's N? Trade-off cost vs. continuity. |
| OQ-F | Playbook strategic logic content — needs to graduate from slot definitions to strategic reasoning. Content lift. |
| OQ-G | Asset_Library `chat_history` column — confirm/add as column 19. Schema delta. |
| OQ-H | Studio → Publish handoff (deferred but flagged) — how does a Studio-built plan flow into Publish slots? |

### Help Desk open items

| # | Question |
|---|---|
| OQ-HD-1 | Briefing size budget — how big before performance degrades? Likely 20–50KB for active state. |
| OQ-HD-2 | Audit_Trail slice window — default 7 days, configurable in Governance_Config |
| OQ-HD-3 | Cross-user privacy — filter by `who` (Audra sees Audra's, JT sees JT's), with explicit override |
| OQ-HD-4 | Question logging — log to Audit_Trail for pattern observation, or skip for v1? |

### Deferred to later phases

| # | Question | Routes to |
|---|---|---|
| Q14 | Slot recipe table storage — Master Sheet tab vs. Governance_Config | Build-time |
| Q15 | Right rail icon registry per canvas type | Phase 2.4 |
| Q16 | Audra ops drawer placement — avatar dropdown vs. right-rail Ops icon | Phase 2.4 |
| Q17 | Center-right pane behavior — overlay / push / float | Phase 2.4 |
| Q18 | Within-session vs. cross-session state persistence pattern | Phase 3 build |
| — | Reels rail composition — what's below Claude when a Reel canvas is open | Reels hub continuation |
| Q2 | Swap between pre-composed options on mobile — pure selection vs. forbidden | Surface Principle update |
| Q3 | Option count — exactly 3 always, or variable | Vert Fairy job spec |
| Q9 | Pinned-docs context budget for Claude | Phase 4.4 |
| Q12 | Feedback loop capture target | Schema review |
| — | Mobile IA chat overlay pattern (Help Desk on mobile) | Phase 2.3 |
| — | Reels Player — GCS hosting + native `<video>` (Drive iframe retired) | Future spoke |
| — | GAS 35MB audio ceiling — blocks reel caption pre-population | Infrastructure |

---

## 12. Where to Read More

When this synthesis is insufficient:

| Need | Source |
|---|---|
| Doc inventory + reading order + mode rules + mandates | `CLAUDE.md` |
| Mobile/desktop boundary calls | `DWYP_Surface_Principle.md` |
| Version stamps + optimistic UI patterns + bumpVersion mechanics | `DWYP_Performance_Principle.md` |
| Principles + reframes + corollaries (authoritative) | `DWYP_App_Structure.md` |
| Per-surface action inventory + scenario walkthroughs | `DWYP_User_Flows.md` |
| Schema, ADs, AI Layer Architecture, Episode Index, Comment System, Design ↔ Publish travel | `DWYP_Platform_Reference.md` |
| Code architecture, file ownership, function locations | `DWYP_Codebase_Map.md` |
| Current build state | `DWYP_Platform_State.md` |
| Phase sequencing + future spokes queue | `DWYP_Build_Playbook.md` |
| Voice constraints for Claude's system instruction (Drive corpus doc, runtime reference — not a repo doc) | `DWYP_BrandVoice_v1.md` |
