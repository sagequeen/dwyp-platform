# CLAUDE.md — Repo Instructions for Claude (Code and Cowork)

## Session Start Protocol

Read in this order before doing any work in this codebase:

**Always (every session):**
1. `DWYP_Operating_Model.md` — Spine doc. Compression of principles + chrome + companion model + slot model + cardinal rules. **Read first on any new session.** Points to deeper sources when needed.
2. Most recent `DWYP_Platform_State_v*` doc

**Always for any code, UI, or design work:**
3. `DWYP_Surface_Principle.md` — where things live (mobile = ops, desktop = creation)
4. `DWYP_Performance_Principle.md` — how things feel (show first, sync second; version-stamp invalidation)

**When relevant to the current task:**
- `DWYP_Build_Playbook.md` — when picking next work or sequencing dependencies
- `DWYP_Publish_AI_Companion_Design.md` — when working on Publish AI features
- `DWYP_PreFlight_Staging_Verification.md` — when handed a verification prompt
- `DWYP_App_Structure.md` v1.3 — Phase 2 design sessions; any app structure or surface work
- `DWYP_User_Flows.md` v1.0 — any verb-level question on a specific surface; Phase 2.1 / 2.3 / 2.4 / 3.3 design sessions
- Other one-off `.md` files (spoke prompts, design notes) when included in the session

If a referenced doc is not in context, ask before proceeding rather than assuming.

---

## Mode Awareness

Audra works in three modes. Each has different rules.

### Hub mode
Big-picture context, design decisions, documentation. Audra leads, Claude reasons and captures.
- **No code is written in Hub threads.** Surface implementation questions but don't generate code.
- Output is structured markdown (handoff docs, design specs, playbook updates).
- Decisions get locked, then handed off to Spoke threads.

### Spoke mode
One focused unit of implementation work. Spoke prompt provides the scope; Claude executes.
- Read the spoke prompt fully before writing anything.
- Stay within the scope of the spoke. If something tangential appears, surface it — don't expand the spoke unilaterally.
- Multi-file patches are fine when files are tightly coupled.
- Surface back at push checkpoints, before moving to the next item.

### Verification mode
Explicit static-analysis check (e.g., pre-flight staging verification).
- **Do not modify code. Do not propose fixes.** Report findings only.
- Mark UNCERTAIN where ambiguous; don't paper over.
- Use the structured reporting format the verification prompt specifies.
- This mode is the antidote to "helpful" — be deliberate.

If the mode of the current session is unclear, ask.

---

## Architectural Patterns (Locked, Non-Negotiable)

### Staging Environment

The DWYP Operations Platform runs on a two-deployment model.

| | URL | Sheet |
|---|---|---|
| **Staging** (`/dev`) | `https://script.google.com/a/macros/wiseonewithin.com/s/AKfycbwHRxyQ22Zi0TFwT3av5jf30MiPhxBtV9tjb4hMxm0/dev` | `13bXMjxEf_L-BFH69OtUGOU6ywxt6BTat1kO9ik46Swk` |
| **Production** (`/exec`) | `https://script.google.com/macros/s/AKfycbzCed5Fmv9TNDf6ivQUcmhgUWWOyEVK4P3sxS8_KMQx7YOY6JeY7r-dh8jEw5DpecrI/exec` | `1p5ahHe4hgG6sHN4u13UyvEJWg5IwCkAfADjeqxwlTnw` |

Staging always serves the latest pushed code. Production serves only the version explicitly deployed via Manage Deployments → pencil → New version.

**Routing helpers (locked architectural pattern):**

Two helpers in `fairy_circle.js` route all sheet access by deployment:
- `isStaging()` — compares `ScriptApp.getService().getUrl()` to `STAGING_DEPLOYMENT_URL` in Governance_Config. Exact-string match. Fails closed to production on any error.
- `getMasterSheetId()` — returns `STAGING_SHEET_ID` from Governance_Config when `isStaging()` is true; returns `MASTER_SHEET_ID` from Script Properties otherwise.

**Rules for all new code:**

1. **All sheet access goes through `getMasterSheetId()`** — never read `MASTER_SHEET_ID` directly via `PropertiesService.getScriptProperties().getProperty()` in operational code.
2. **One exception: `getGovernance()` itself.** It reads `MASTER_SHEET_ID` directly from Script Properties — this is the bootstrap that resolves the routing table. Routing it through `getMasterSheetId()` would create infinite recursion.
3. **No hardcoded URLs or sheet IDs** — staging values live in production Governance_Config under `STAGING_DEPLOYMENT_URL` and `STAGING_SHEET_ID`.
4. **Preservation Mandate** — never thin, rename, or simplify the helpers or any function that calls them.

**Caveats this routing does NOT cover:**
- **Drive folders are shared** between staging and production unless duplicated. `IMAGE_BACKGROUND_LIBRARY_ID`, `CORPUS_DRIVE_FOLDER_ID`, episode folders — all production unless explicitly remapped.
- **External APIs are shared.** Claude API key, Vertex RAG corpus, Gemini — same endpoints, real money, real corpus deposits.
- **Triggers always run as production.** `ScriptApp.getService().getUrl()` returns null in trigger context, so `isStaging()` returns false. Trigger-based code paths cannot be tested via staging URL routing — use `dev_tools.gs` manual invocation instead.

**Testing with staging:**
- Hit the `/dev` URL to exercise staging — no separate test deployment needed.
- Never write code that bypasses the helper to "force production" — `isStaging()` fails closed and handles that case already.

### Surface Principle (UI work)

When designing or building any UI surface, apply the test:

> Is this a *decision, approval, or awareness*? → **Mobile.**
> Is this *composition, creation, or sustained focus work*? → **Desktop.**

Mobile is operations-only. Desktop is the creation layer. No graceful degradation — if a mobile user taps a desktop-only surface, the response is a hard wall ("open on desktop"), not a read-only mobile view.

Full spec: `DWYP_Surface_Principle.md`. Surface decisions that conflict with this principle should be flagged, not silently resolved.

### Performance Principle (any new feature)

Three pillars apply to every new feature:

1. **Cache aggressively, invalidate explicitly via version stamps.** A `Versions` tab tracks domain-level version numbers. Reads check version before fetching. Writes bump the relevant domain's version atomically.
2. **Optimistic UI by default.** User actions apply to local state immediately, backend writes happen async, failures surface visibly with rollback.
3. **Progressive loading.** Skeleton → low-fi → high-fi. Never block on the heaviest asset.

Full spec: `DWYP_Performance_Principle.md`.

**Versioning pattern (live as of Phase 1.2):**
- All new write paths must call `bumpVersion(domain, callerName)` for the affected domain.
- All new read paths should check version via `getAllVersions()` or `getDomainVersion()` before fetching data.

### Preservation Mandate (universal)

Never thin, rename, or simplify any existing function without an explicit decision captured in a hub session and reflected in State or Reference.

This applies to:
- Routing helpers (`isStaging`, `getMasterSheetId`, `getGovernance`)
- Fairy entry points and their orchestration logic
- Anything in the `Fairy / File Architecture — Locked` table in State
- Schema-shaped functions (anything that reads/writes specific sheet columns)

Dead code stubs are intentionally retained per past decisions. Do not remove them without confirmation.

---

## State Update Protocol

After completing a spoke, task set, or significant session:
1. **Offer to update Platform State.** Name the specific changes you'd make before writing.
2. **Update the Reference doc only when** a new architectural decision is locked or schema changes — not for bug fixes or polish.
3. **One-off `.md` files** brought to a session (prompt files, design notes) get incorporated into State when the work they describe is complete.
4. **Update the Build Playbook** when a phase or item completes — mark done, note any surface-back items that emerged, identify what's next.

Do not silently proceed to the next item without confirming the State update is captured. The State doc is the contract between sessions.

---

## What Not to Do

- Do not invent design decisions. If a UI question doesn't have a decision in foundation docs, surface it as a hub-session topic.
- Do not "optimize" by bypassing routing helpers, schema patterns, or version-stamp invalidation once those are in place.
- Do not expand spoke scope unilaterally. Surface tangential issues, don't fix them.
- Do not paper over UNCERTAIN findings in verification mode.
- Do not assume Drive folders, API keys, or external services are isolated for staging — they are not unless explicitly remapped.
- Do not promote staging to production. That's a manual Audra step (Manage Deployments → New version).
