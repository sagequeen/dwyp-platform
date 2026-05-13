# DWYP Handoff — Pipeline & Studio Pre-Population Architecture
**Date:** May 2026
**Thread type:** Hub
**Incorporate into:** DWYP_Platform_State v4.4
**Companion:** DWYP_Handoff_ClaudeAPI_EpisodeIndex.md (same session, incorporate together)

---

## Decisions Locked This Session

### 1. GAS Role — Canonical

GAS is the nervous system. It never thinks — it orchestrates. It knows when to call, what to send, where to write the response. Claude and Gemini are the brains. Vertex is the memory. GAS is the courier and the hands that write what the brain says. This framing is the mental model for all future AI integration design.

---

### 2. Vert Fairy — Multi-Pass Pipeline

Vert Fairy runs two sequential Claude passes after Vertex retrieval. Show notes and starter pack are separate jobs with separate prompts.

**Pass 1 — Show Notes + Podcast Description**
- Vertex retrieves episode context from corpus
- Claude writes show notes to Drive doc
- Claude writes podcast description in the same pass (same voice register, different format)
- Output: Show Notes Drive doc

**Pass 2 — Starter Pack**
- Claude reads Pass 1 output + Vertex context
- Generates: hooks, quotes, image prompts, one caption per asset candidate
- Output: written to episode index

GAS couriers both passes. Vertex is called once; both passes read from the same retrieved context.

---

### 3. Episode Index — Revised Creation Trigger

**Previous:** Daily Pulse checks for missing indices and builds them.
**Revised:** Index is created by **Vert Fairy** as part of the show notes run — not a separate Daily Pulse job. Index creation is a byproduct of the show notes pipeline, triggered by the same event (finished transcript detection).

Daily Pulse retains one index responsibility only: **reel sync** (add/remove reel descriptions as reel folder changes).

#### Revised Index Write Timing

| Section | Written by | Trigger |
|---|---|---|
| Episode summary | Vert Fairy Pass 2 | Show notes run |
| Guest profile snapshot | Concierge | Intake |
| Hooks & quotes | Vert Fairy Pass 2 | Show notes run |
| Image prompts | Vert Fairy Pass 2 | Show notes run |
| Starter captions | Vert Fairy Pass 2 | Show notes run |
| Key themes | Vert Fairy Pass 2 | Show notes run |
| Transcript map | Vert Fairy Pass 2 | Show notes run |
| Reel descriptions | Daily Pulse / Mending Fairy | Reel folder change |

---

### 4. Studio Pre-Population

Studio opens pre-populated. No generation wait for JT.

**How it works:**
- Vert Fairy writes starter pack to index at show notes time
- Studio reads index on open — hooks, quotes, image prompts, captions already present
- JT iterates from the starter pack via live Claude calls
- Live calls are on-demand only — for variation, refinement, or content the index doesn't cover

**Starter caption pack:**
- One caption per asset candidate (image or reel)
- All platforms generated in first pass — Instagram, Facebook, LinkedIn, TikTok, YouTube, podcast description
- Platform-specific variants only if real usage proves the need
- Podcast description treated as a distinct format — longer, SEO-aware — generated in Pass 1 alongside show notes, not as a caption variant

---

### 5. Claude Insertion Point Map

**Pipeline (GAS-triggered, automated):**

| Stage | Technology | Claude's role |
|---|---|---|
| Guest research | Herald → Gemini (permanent) | None |
| Show notes | Vert Fairy → Vertex + Claude | Pass 1: show notes + podcast description |
| Starter pack | Vert Fairy → Claude | Pass 2: hooks, quotes, image prompts, captions |
| Episode index | Vert Fairy → Claude | Written as byproduct of show notes run |
| Reel descriptions | Daily Pulse → Gemini | Gemini processes audio; Claude not involved |
| Guest comms (Scribe) | Template-driven | Candidate for Claude polish — not yet designed |

**Interactive (JT-facing, on-demand):**

| Surface | Claude's role | Retrieval source |
|---|---|---|
| Studio — Publish captions | Iteration from starter pack | Index-first |
| Studio — Librarian Vert chat | Generation on Vertex retrieval | Vertex-first |
| Studio — Write surface | Cross-episode synthesis | Vertex-first, on demand |
| Image compositing | SVG/HTML compositing (AD #65) | Brand context + asset |

**Stays Gemini permanently:**
- Herald (web search hard requirement)
- Image generation (GenGem)
- Reel audio processing / content descriptions
- Gemini auto-transcription (future)

---

### 6. API Mechanics — Locked Mental Model

- Every API call (Claude or Gemini) is a stateless packet: system instruction + message history + injected context
- Claude has no memory between calls — the index is what makes it feel continuous
- GAS assembles the packet every time; the AI only sees what GAS sends
- Prompt caching to be implemented from day one — avoids re-billing for static context (system instruction, index) on repeat calls
- In-session conversation history carried forward by GAS for iterative surfaces (Publish, Librarian Vert)
- Prompt library doc: deferred until index creation spoke — design with it in mind, don't build yet

---

## Pending Decisions / Open Items

- **Episode summary token target** — define before generation prompt is written
- **Starter pack prompt design** — to be tested in Vertex AI Studio / Anthropic Console playground before any spoke opens
- **Scribe guest comms** — Claude polish candidate, not yet formally designed
- **Write surface** — not yet built; Vertex-first, on-demand, JT expects latency

---

## Build Sequence Impact

1. Set up Console account → `CLAUDE_API_KEY` in Governance_Config
2. Write `callClaudeAPI()` — parallel to `callGeminiAPI()`
3. Flip `PUBLISH_LLM_MODE` to `claude`
4. Open Vert Fairy spoke — two-pass pipeline, index creation, starter pack
5. Open Studio spoke — pre-population from index, live iteration wiring
6. Reel sync — Daily Pulse / Mending Fairy integration with index
7. Write surface — design in hub before spoke opens

Steps 1–3: contained, sequential. Steps 4–7: larger builds, each needs hub design session first.

---

*Handoff produced in Hub thread. Incorporate into Platform State v4.4. No code written this session.*
