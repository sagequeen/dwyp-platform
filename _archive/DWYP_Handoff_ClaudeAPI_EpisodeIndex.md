# DWYP Handoff — Claude API Integration & Episode Index Architecture
**Date:** May 2026
**Thread type:** Hub
**Incorporate into:** DWYP_Platform_State v4.4

---

## Decisions Locked This Session

### 1. Claude API Account Setup

- Console account to be created at **console.anthropic.com** using the **DWYP Google Workspace email**
- Billing owner: JT. Setup managed by Audra.
- API key named `dwyp-platform-prod`
- Key stored in `Governance_Config` as `CLAUDE_API_KEY`
- `PUBLISH_LLM_MODE` already exists in Governance_Config with value `gemini`. Flip to `claude` once billing is configured — **one key change, no UI impact**

---

### 2. Claude as Intelligent Interface Between Vertex and JT

Claude API is the generation and polish layer. Vertex AI RAG Engine remains the retrieval and grounding layer. Claude never touches the corpus directly — it reads what Vertex retrieves and produces polished output.

**Call sequence:**
1. Vertex retrieves relevant chunks from corpus
2. GAS passes chunks + original query + system instruction to Claude API
3. Claude generates response

**Division of labor (target state):**

| Role | Technology | Jobs |
|---|---|---|
| Brain | Claude API | Hooks, quotes, image prompts, captions, show notes, voice-sensitive output |
| Grunt | Gemini API | Image generation, audio/video processing, Herald web search |

---

### 3. Episode Index Architecture

A permanent, episode-scoped index document written once per episode. Stored in a dedicated **index folder**, separate from episode assets, transcripts, and Drive folders.

**Purpose:** Eliminate real-time Vertex calls for predictable, episode-specific queries. Claude reads the index first. Vertex is called only if the answer isn't there.

#### Index Contents

| Section | Source | Written | Updated |
|---|---|---|---|
| Episode summary | Gemini/Claude — token-optimized | Once, on creation | Never |
| Guest profile snapshot | Concierge output | Once, on creation | Never |
| Hooks & quotes (transcript-sourced) | Parsed from transcript, not show notes | Once, on creation | Never |
| Social asset seeds | Derived — image prompt angles, caption seeds | Once, on creation | Never |
| Key themes | Derived — for long-form/article use | Once, on creation | Never |
| Transcript map | Gemini-processed — chapter-style, landmark-dense | Once, on creation | Never |
| Reel content descriptions | Gemini audio processing | On reel detection | On reel add/remove |

**Notes:**
- Episode content sections are **evergreen** — the episode doesn't change
- Reel descriptions are the only living section — they follow the reel folder
- Hooks and quotes should be sourced from the **transcript**, not the show notes pipeline — closer to source, more generative raw material
- Episode summary should be sized to answer ~80% of what JT will ever ask about an episode without additional context. Token target to be defined before generation prompt is written
- Transcript map should be **landmark-dense**: timestamps, speaker turns, topic shifts, emotional moments, key phrases. Gemini should over-describe here
- Guest profile snapshot: Concierge already generates this — include it rather than waste it

#### Index Creation Trigger

**Daily Pulse** checks for missing indices across active episodes and builds them. Index creation is a Pulse responsibility, not triggered by JT opening an episode.

#### Reel Sync Logic

Daily Pulse (via **Mending Fairy**) watches each episode's reel folder:
- New reel detected → Gemini processes audio → description written to index
- Reel removed → corresponding description pruned from index

Gemini reads reel audio natively (within its own limits) and produces a **rich content description** — key moments, notable quotes, emotional beats, spoken content summary — sufficient for Claude to regenerate from without needing the raw transcript. This sidesteps GAS's 35MB ceiling entirely.

#### Index Folder

Dedicated folder in Drive, separate from all episode asset folders. One index document per episode, named by episode UID.

---

### 4. Surface-Specific Retrieval Strategy

Two surfaces, two retrieval strategies:

**Publish surface — index-first:**
- Claude works from the episode index
- Fast, no Vertex call for common queries
- Vertex called only if query goes beyond index coverage
- Serves: captions, hook variations, image prompts, reel-based content, social assets

**Write surface — Vertex-first, on demand:**
- Cross-episode queries — patterns, themes, synthesis across the corpus
- Inherently unpredictable; on-demand Vertex calls, no pre-fetch
- JT expects to wait; the output is worth it
- Episode summary from index may be used to orient Claude before a cross-episode Vertex call

---

## Pending Decisions / Open Items

- **Episode summary token target** — needs a defined number before generation prompt is written
- **Index creation spoke** — not yet scoped; depends on billing being configured first
- **`callClaudeAPI()` function** — parallel to `callGeminiAPI()`, needs writing once Console account and API key are live
- **Article generation** — mentioned as a use case for the index (key themes section included in anticipation), but not yet a formal planned feature
- **Reel transcription gap** — resolved: Gemini processes audio and writes rich descriptions. No literal transcription needed.

---

## Build Sequence Impact

1. Set up Console account (DWYP email, JT billing)
2. Add `CLAUDE_API_KEY` to Governance_Config
3. Write `callClaudeAPI()` spoke
4. Flip `PUBLISH_LLM_MODE` to `claude`
5. Design and build Episode Index (Daily Pulse integration, index folder, Mending Fairy reel sync)
6. Wire Publish surface to read index before calling Vertex
7. Wire Write surface to call Vertex directly

Steps 1–4 are a contained spoke. Steps 5–7 are a larger build that should be designed in hub before any spoke opens.

---

*Handoff produced in Hub thread. Incorporate into Platform State v4.4. No code written this session.*
