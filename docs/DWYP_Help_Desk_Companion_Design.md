# DWYP Help Desk Companion — Design Decisions

**Status:** Locked design decisions from Hub session, May 2026
**Synced to:** Platform State v5.5
**Parallel to:** `DWYP_Publish_AI_Companion_Design.md` (different surface, same architectural pattern)
**Feeds into:** Future Help Desk spoke prompt, Component library design (right-rail chat as shared layout primitive), Desktop chrome conventions

---

## What It Is

A persistent informational chat surface that lets Audra and JT ask questions about platform state without navigating to find the answer themselves. Read-only on data. Can navigate the user as a convenience.

**Example questions:**
- "Which episode was I supposed to upload reels for?"
- "What tasks are open for me?"
- "When did Audra last touch Carrie's Guest Brief?"
- "Has Derek's brief review been completed?"
- "What's blocking the Carrie release?"

**Example non-questions (handled elsewhere):**
- "Mark Derek's brief review complete." → Existing task UI
- "Write a caption for Tuesday's reel." → Publish AI Companion
- "Find me the Sipe quote about her mother." → Studio (corpus retrieval)

The boundary is: **looking up vs. doing vs. creating.** Help Desk is looking up — and offering to take you there.

---

## Core Architecture

### The phone call model
Stateless. Every send fires a fresh API call.

```
User asks question  → GAS assembles briefing → Gemini → response → forget
```

GAS is the courier. Reads relevant sheet domains, formats as compact briefing, sends with user question and in-session history. Gemini answers from the briefing. No persistence beyond current session.

### LLM choice: Gemini, deliberately
Help Desk uses Gemini API (`callGeminiAPI()`), not Claude. Reasons:

- **~10x cheaper** for the same Q&A workload
- **Doesn't need brand voice, reasoning, or creative output** — just "given this data, answer the question"
- **Already wired** — `callGeminiAPI()` exists for Herald
- **Composes with version stamps** — briefing assembly is cheap when nothing changed

This is the only surface that uses Gemini for text generation. Studio, Publish, and pipeline generation all stay on Claude. Lane is preserved: Claude for human-facing creative copy; Gemini for grunt work (Herald research, image generation, Help Desk Q&A).

### Briefing assembly with version stamp awareness
Help Desk briefing reads the same domains that drive the operations layer:

- Tasks (open, recent completions)
- Episodes (active roster, status, gating)
- Contacts (recent activity)
- Asset_Library (per-asset state and recent edits)
- Audit_Trail (recent slice — "what changed when")

Briefing assembler checks `getAllVersions()` first. If no relevant domain has changed since last assembly, reuses the cached briefing. Only rebuilds on actual mutation.

This makes Help Desk essentially free between data changes. Costs only accrue when data is fresh and the user is actively asking.

---

## Scope

### What Help Desk knows
Compact summaries of:
- Open tasks (assignee, age, type, related episode/contact)
- Active episodes (status, phase, gating)
- Contacts touched recently (last_activity slice)
- Asset_Library entries for active episodes
- Audit_Trail recent slice (last N days, configurable)

### What Help Desk does NOT know
- Past closed episodes outside the active roster
- Full corpus content (transcripts, episode index docs, brand voice doc)
- Governance_Config values
- Code, deployment state, GAS internals
- Anything in Drive that isn't already represented in sheets

### Hard exclusions on actions
- **Cannot mutate data** — no writes, no task completion, no field updates, no record creation
- **Cannot trigger backend actions** — no Filing Fairy, no Herald, no notifications, no GAS calls beyond read
- **Cannot generate creative content** — no captions, no copy, no plans, no design output

### What Help Desk CAN do
- **Navigate the user via chips.** Answers can include tappable chips that take the user to the relevant task, episode, or contact. UI navigation only — no data changes.

### Graceful redirects
- Mutation request → "I can't change that — use the [task UI / Studio / Contacts tab]." (with a navigation chip if applicable)
- Corpus question → "That's a Studio question. Want to open Studio?"
- Creative request → "That's Studio's role. Want to open Studio?"

---

## Conversation Model

### Session-scoped statelessness
- Conversation history lives only in the current browser session
- Closing the tab clears it
- Refreshing the page clears it
- No persistence to Asset_Library, sheets, or any storage
- No midnight reset, no clock dependency — session is the boundary

The intuition "Help Desk doesn't remember anything from yesterday" is satisfied because the user closes the tab daily. Tabs that stay open for days remain coherent within that session — fine, real cost is negligible at session scale.

### In-session history sent every turn
Stateless API: each send includes the conversation so far. Cap at last N turns (configurable, default TBD in spoke) to bound briefing size.

---

## Interaction Model

### Q&A surface, not a chat partner
Functional: ask, receive answer, move on. Not conversational rapport. Not iterative refinement.

Follow-up clarifications are fine — but the shape is sequential Q&A, not creative dialogue.

### Tone
Direct, short, accurate. No padding. "Three open tasks: Review Reels (Carrie), Guest Brief Enrich (Aggarwal), Revise Reels (Sipe)." Not "Sure! Let me check that for you. Looking at your tasks..."

System prompt enforces concise, factual register.

### Navigation chips
Help Desk responses can include tappable navigation chips that take the user to the relevant surface. Example:

> "Your Review Reels task for Carrie is still open."
> `[Show me the task]` `[Show me Carrie's episode]`

User taps a chip → frontend navigates → no data changes.

**Chip rendering pattern** (mirrors existing caption chip pattern in Publish):
- Gemini returns answer text plus optional navigation hints inline
- Format: `[[NAV:task:<task_id>]]`, `[[NAV:episode:<episode_uid>]]`, `[[NAV:contact:<contact_id>]]`
- Frontend parses chip markers from response, renders them as tappable elements
- Tap dispatches the navigation action through existing routing

System prompt instructs Gemini to include navigation chips when the answer references a specific record the user might want to see.

### What Help Desk does NOT render
- Inline tables, charts, or rich formatting beyond plain text + chips
- Images, file previews, or asset thumbnails
- Action buttons that mutate data ("Mark Complete," "Approve," etc.) — those live on the task itself, not in chat

---

## Where It Lives

The placement is a **Desktop chrome convention** (Phase 2.4 in the Build Playbook), not locked here. Audra's instinct: persistent right-rail on desktop, present across views (Dashboard, Tasks, Episode detail, Contacts).

This design captures the **AI shape**, not the layout. Final placement, animation, and overlay behavior get decided in the design system pass.

**Mobile presence:**
Surface Principle says mobile is operations-only. Help Desk is the ops AI surface — fits cleanly. Mobile likely gets a chat icon that opens an overlay (not a persistent rail — no real estate). Same brain, different chrome. Decided in Mobile IA design (Phase 2.3).

---

## Decisions Locked

1. Help Desk is read-only on data — no mutations of any kind
2. Help Desk can navigate the user via chips (UI action, not data action)
3. Gemini API (`callGeminiAPI()`) is the LLM, not Claude
4. Session-scoped statelessness — no persistence, no midnight reset, conversation lives until tab close/refresh
5. Conversation history capped at N turns per session (configurable)
6. Briefing reads Tasks, Episodes, Contacts, Asset_Library, recent Audit_Trail
7. Briefing assembly is version-stamp aware — cached when domains haven't changed
8. Tone is direct and concise — system prompt enforces no padding
9. Out-of-scope requests (mutations, corpus search, creative work) get graceful redirects with navigation chips where applicable
10. Help Desk character = Gemini (different lane from Claude, which owns all creative text)
11. Navigation chip pattern parallel to Publish caption chip pattern — same UI primitive, different action type

---

## Prerequisites

| Item | Status |
|---|---|
| `callGeminiAPI()` exists | ✅ Done (Herald) |
| Versions tab + `getAllVersions()` | ✅ Done (Phase 1.1–1.2 complete) |
| Component library — chat bubble, chip primitives | ⏳ Phase 2.1 (Help Desk reuses) |
| Desktop chrome conventions — right-rail layout | ⏳ Phase 2.4 (Help Desk lives in this) |
| Mobile IA — chat overlay pattern | ⏳ Phase 2.3 (mobile Help Desk lives in this) |
| `HELP_DESK_HISTORY_TURN_CAP` in Governance_Config | ⏳ Decide before spoke |
| `HELP_DESK_AUDIT_TRAIL_DAYS` in Governance_Config | ⏳ Decide before spoke |

---

## Build Implications

Help Desk is its own spoke, queueing after the design system foundation lands. Roughly:

1. **Briefing assembler** — GAS function that reads relevant domains (version-aware), formats compact text briefing
2. **Help Desk endpoint** — `callHelpDesk(question, history)` that wraps `callGeminiAPI()` with system prompt + briefing
3. **Frontend chat panel** — uses component library primitives, lives in right rail (desktop) or overlay (mobile)
4. **Chip parsing and navigation dispatch** — extends the existing chip parser pattern
5. **System prompt authoring** — enforces tone, scope, navigation chip format

**Modest spoke** — most of the heavy lifting is reused (Gemini wiring, version stamps, component library). The new code is briefing assembly, system prompt, and chip dispatch.

**Phase placement:** after Phase 2 design system, parallel to Phase 4 Publish Companion. Both are AI surface spokes with similar architectural shapes; running them in close sequence reuses pattern knowledge and chip-rendering code.

---

## Open Issues

### OQ-HD-1: Briefing size budget
How big can the briefing get before performance degrades? Active roster of 17 episodes + 30 open tasks + 100 contacts + 200 Asset_Library rows + 7 days of Audit_Trail might be 20-50KB of text. Likely fine for Gemini Flash. Worth measuring before locking the model.

### OQ-HD-2: Audit_Trail slice window
How many days of Audit_Trail does Help Desk see? Default 7 days seems reasonable. Configurable in Governance_Config.

### OQ-HD-3: Cross-user privacy
Audra's tasks and JT's tasks are in the same Tasks sheet. Does Help Desk filter by `who` parameter (matches existing app pattern), or does it show everything regardless of who's asking?

Default: filter by `who`. Audra asking sees Audra's tasks; JT sees JT's. Audra can override with explicit "show me JT's tasks too" if useful.

### OQ-HD-4: Question logging
Should Help Desk questions be logged (to Audit_Trail or a dedicated tab) for debugging or pattern observation? Probably not for v1 — adds privacy concern, marginal value. Decide before spoke.

---

*Captured Hub session, May 2026. Audra + Claude. Locks Help Desk Companion design. Parallel to Publish AI Companion. Feeds Help Desk spoke prompt and design system passes.*
