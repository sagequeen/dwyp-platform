# DWYP Publish AI Companion — Design Decisions

**Status:** Locked design decisions from Hub session, May 2026
**Synced to:** Platform State v5.5
**Supersedes:** Per-asset chat panel design in Social Architecture Redesign v3 (chat panel mechanics; pre-population unchanged)
**Feeds into:** Future Publish AI Companion spoke prompt

---

## Context

This design layers **per-card chat iteration** on top of the asset-first pre-population already wired in `dwyp_app.gs`. Generation paths (`generatePublishCaption()`, `getOrGenerateReelSummary()`, `ensureReelSummaries()`) exist. The companion is the surface where JT iterates on what's already been written.

---

## Core Architecture

### The phone call model
Stateless. Every send fires a fresh API call. No persistent memory on Claude's side.

```
JT clicks card        → UI updates only, no API call
JT types message      → no API call
JT taps send          → GAS assembles briefing → Claude → response → forget
JT switches cards     → UI swap, history swap from Asset_Library, no API call
```

GAS is the courier. Browser hands GAS the page state, GAS prepends the static prefix and conversation history, calls Claude via `callClaudeAPI()`, returns the response.

### Prompt caching is day-one mandatory
Static prefix (brand voice, sensitivity, playbook with strategic logic, system prompt) cached at API layer after first call. Dynamic block (card state, history, message) re-sent fresh every turn. Cache breakpoint sits between the two.

### State assembly happens at send time
The package only exists when JT taps send. Browsing cards is free.

---

## AI Layer (Synced to State v5.5)

| Layer | Name | Technology | Role |
|---|---|---|---|
| Retrieval | Vert | Vertex AI RAG (us-south1) | Queries corpus → delivers chunks. Never generates. |
| Generation | **Claude** | Claude API (`callClaudeAPI()`) | Single text generator across all surfaces. |
| Orchestration | GAS | Apps Script | Assembles packets, routes calls. Never generates. |
| Image generation | GenGem | Gemini image API | Background image generation only. |
| Guest research | Herald | Gemini API | Web search hard requirement. |

**Claude is the only character across the platform.** Vert and Social Vert personas retired. Claude introduces itself as Claude.

**Single governance key:** `STUDIO_LLM_MODE = claude` covers all Claude text generation Studio-wide and Publish-wide. Code-level Gemini fallback on Claude API failure — automatic, logged to Audit_Trail.

---

## Scope: Present, Not Omniscient

The Publish companion is *scoped*, not *characterized*, differently from Studio. Same Claude, different briefing.

### Default context bundle (every call, Publish)
- Brand voice + content sensitivity (cached prefix)
- Playbook with strategic slot logic (cached prefix) — *what each slot type is good for: Monday curiosity, Thursday depth, etc.*
- Posting template (cached prefix)
- Currently attached card's full state (caption draft, background, hook source, slot, episode)
- Conversation history for the attached card (read from Asset_Library)
- Episode metadata for the card's episode (topic, guest, hooks/quotes from manifest, episode_index)

### Sibling context (when applicable)
Same-date siblings auto-included as read-only context.
- Cap: 4 siblings default (configurable in Governance_Config)
- Filter: Status ≠ posted
- Use case: same-day multi-platform releases that should feel cohesive
- Claude can see and reference siblings, can advise on coherence
- Claude cannot edit siblings — JT switches cards to edit

### Hard exclusions
- Past episodes → Studio scope (Vert retrieval over corpus)
- Full corpus → Studio scope
- Other platform tabs (Tasks, Contacts, Dashboard)
- Production status (review gating, proxy approvals)

### Cross-surface boundary (scope, not character)
**Studio** — corpus-grounded, archive-aware, strategic week planning.
**Publish** — workspace-aware, per-asset execution + light scheduling commentary.

When JT asks Publish-scope Claude something corpus-shaped, graceful handoff: "I can see this week's content. For full archive search, Studio is your tool."

---

## Interaction Model

### Chips, never auto-write
**Claude never modifies JT's text directly.** All suggestions arrive as tappable chips. JT chooses whether to apply.

This preserves her draft, removes the trust risk, and matches the existing per-asset caption chip pattern.

### Pre-populated editable text boxes stay
Content arrives pre-populated by the existing pipeline (Vert Fairy Pass 1/2 → episode index → `generatePublishCaption()` etc.). JT edits inline. Companion supplements but never replaces this flow.

### Card attachment as visual indicator
Selected card docks into the chat panel as a "tab" header — visual confirmation of what Claude is briefed on.

```
[ ATTACHED: Tuesday IG Reel — Carrie Sipe ]
─────────────────────────────────────────────
[ chat history ]
─────────────────────────────────────────────
[ message input ]
```

Switch cards → docked tab updates → conversation history swaps from Asset_Library.

### Scheduling commentary
Claude can offer light strategic input on placement, grounded in the cached playbook logic.

Examples:
- "This reads like a Thursday post — strong story arc. Want me to move it?"
- "Monday is a good choice. The curiosity factor lands."
- "I wonder if this would be better paired with the LinkedIn graphic on Wednesday?"

Surfaced as tappable chips when applicable. JT taps to act, ignores otherwise. Same trust model — no automatic moves.

**Implication:** the playbook content (in cached prefix) needs strategic reasoning baked in, not just slot mechanics. Content lift in the playbook itself, not an architecture change.

---

## Reel Asset Structure

Reels have two distinct generation contexts:

| Type | Purpose | Generation Context |
|---|---|---|
| **Title card** | On-image text overlay | Short, hook-energy, voice-driven |
| **Caption** | Post copy on social | Guest name, episode topic, brand voice, CTA structure, audio-grounded summary |

Each gets its own system prompt and chip suggestions. Audio summary requirement for captions remains locked (Gemini audio extraction prerequisite — note GAS 35MB ceiling unresolved risk).

Generation paths already exist (`generatePublishCaption()`, `getOrGenerateReelSummary()`). Companion adds the iteration loop on top.

---

## Data

### Conversation history
- Stored as JSON blob in Asset_Library, one column: `chat_history`
- Capped at last N turns (configurable, default TBD in spoke)
- Read alongside the asset, never queried independently

### Schema impact
Asset_Library is currently 18 columns (Reference v2.9). **`chat_history` is NOT in the current schema — column 18 is `Created_By`. Must be added as column 19 before spoke opens.** See Reference v2.9 schema and Build Playbook Phase 4.1.

### Distinction from existing Studio session state
Studio currently has per-mode session vars: `stConversationHistory`, `stImageHistory`, `stRagContext`, `stTokenTotal`. These reset on `openStudio()` and on `stSelectEpisode()`.

The Publish companion uses a **different mechanism**: per-asset persistence keyed on `asset_id`, read from Asset_Library on card attach, written back on send. Not session-scoped. Survives navigation, survives session close.

---

## Decisions Locked

1. Per-card attachment, single card at a time (v1)
2. API call fires on send only — no calls on card selection
3. Conversation history persists per asset, JSON blob in Asset_Library `chat_history` column
4. Same-date siblings auto-included as read-only context, cap 4
5. Strategic week planning is a Studio scope; per-asset execution is a Publish scope (same Claude, different briefing)
6. Claude suggests via chips only — never auto-writes JT's draft
7. Pre-populated editable text boxes preserved
8. Reels have two asset types (title card + caption), each with its own generation context
9. Claude can offer scheduling commentary via chips, grounded in cached playbook logic
10. Studio handoff to Publish (how a Studio-built plan flows into Publish slots) deferred to v2
11. Multi-card attachment deferred — implicit sibling context handles the same-day pairing case

---

## Prerequisites — Status

| Item | Status |
|---|---|
| `callClaudeAPI()` exists | ✅ Done (fairy_circle.gs Spoke 3) |
| `CLAUDE_API_KEY` in Governance_Config | ✅ Done |
| `CLAUDE_MODEL` in Governance_Config | ✅ Done |
| `JT_TIMEZONE` in Governance_Config | ✅ Done |
| `STUDIO_LLM_MODE = claude` | ✅ Single key resolved |
| `generateWithClaude()` wrapper | ✅ Done (dwyp_app.gs Spoke 6) |
| Asset_Library `chat_history` column | ⏳ Confirm or add |
| Playbook strategic logic content (OQ-F) | ⏳ Authoring lift |
| Conversation history turn cap (OQ-E) | ⏳ Decide |
| GAS 35MB audio ceiling | ⏳ Reel captions only |

Most foundational plumbing exists. The companion spoke is narrower than originally framed.

---

## Open Issues — Next Design Pass

These surfaced this session but are **separate problems** from the AI companion architecture. They deserve their own design pass before the spoke opens.

### OQ-A: Chat panel ↔ image library competition (Design tab / quote graphic workflow)
When JT is building a quote graphic, the chat panel and image library both want screen real estate. Candidate: **horizontal split** (library top, chat bottom, or inverse) so both have full width. Need to mock and test.

Note: this is the **Design tab quote graphic workspace**, not the per-card chat in the schedule view. Different surface, different solution.

### OQ-B: Schedule panel clunkiness + visual indicators
Left-side week accordion still reads overwhelming. Missing visual signals:
- Slot state at a glance (filled / empty / draft / approved)
- Sibling pairing indicator across same-date slots
- Week progress sense (week is 60% complete)
- Activity recency (what changed today)

The companion architecture above doesn't solve this — UI redesign required.

### OQ-C: Modern visual treatment (Riverside-inspired, brand-locked)
Brand constraint: **font and color stay locked.** Libre Baskerville + crimson/gold. The modernization lift is in:
- Glassmorphism on overlays/modals (subtle backdrop blur)
- Layered depth shadows replacing flat current shadows
- Larger corner radius (16px cards, 24px containers)
- Skeleton loaders + 200ms hover/focus micro-animations
- Floating sidebar with backdrop blur
- Better focus states

This is a separate visual design spoke — touches all five Studio tabs (Publish/Design/Write/Outreach/Ideas), not just the companion.

### OQ-D: Sibling context cap mechanics
Default 4 confirmed, but: what's the UX when capped (warning? graceful drop? "showing 4 of 7"?). Spoke decision.

### OQ-E: Conversation history turn cap
What's N? 10 turns? 20? Trade-off between cost (every turn re-sends history) and continuity (JT references something from earlier). Decide before spoke.

### OQ-F: Playbook strategic logic content
Playbook in cached prefix needs to graduate from slot definitions to strategic reasoning (what each day/slot type is good for, why). Content lift, not code lift. Authored before spoke opens — Claude only knows what's in the briefing.

### OQ-G: Asset_Library `chat_history` column
Confirm whether 18-column schema (Reference v2.8) already includes `chat_history` or whether it's a schema delta. Check before spoke.

### OQ-H: Studio → Publish handoff (deferred but flagged)
When v2 happens: how does a Studio-scoped release plan flow into Publish slots? Saved doc parsed? Direct write to playbook override? Asset_Library notes? Don't try to solve until per-card companion is live and observed in real use.

---

## Build Order Implications

Three potential spokes:

1. **Visual redesign spoke** (OQ-B + OQ-C) — schedule panel UX + Riverside-inspired modernization across all five Studio tabs. Brand-locked. Independent of AI work.
2. **Publish companion spoke** — per-card chat panel, card-attach UI, sibling context assembly, chip suggestion plumbing, Asset_Library `chat_history` read/write. Generation paths already exist.
3. **Design tab quote graphic workspace spoke** (OQ-A) — horizontal split + chat/library coexistence.

Order: 1 before 2 (visual foundation first so companion lands in a clean shell). 3 can run parallel to either.

**Pre-spoke prerequisites for spoke 2 (remaining):**
- Confirm/add Asset_Library `chat_history` column (OQ-G)
- Playbook strategic logic content authored (OQ-F)
- Conversation history turn cap decided (OQ-E)
- GAS 35MB audio ceiling resolved (blocks reel captions specifically)

---

*Captured Hub session, May 2026. Audra + Claude. Synced to Platform State v5.5. Feeds Publish AI Companion spoke prompt and visual redesign spoke.*
