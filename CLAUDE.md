# CLAUDE.md — Repo Instructions for Claude (Code and Cowork)

## Session Start Protocol

Read in this order before doing any work in this codebase:

**Always (every session):**
1. `DWYP_Operating_Model.md` — Spine doc. Compression of principles + chrome + companion model + slot model + cardinal rules. **Read first on any new session.**
2. `DWYP_Platform_State.md` — Active working state. Current position, GAS file status, pipeline status, open issues.

**Always for any code, UI, or design work:**
3. `DWYP_Surface_Principle.md` — where things live (mobile = ops, desktop = creation)
4. `DWYP_Performance_Principle.md` — how things feel (show first, sync second; version-stamp invalidation)

**When relevant to the current task:**
- `DWYP_Build_Playbook.md` — when picking next work or sequencing dependencies
- `DWYP_Publish_AI_Companion_Design.md` — when working on Publish AI features
- `DWYP_PreFlight_Staging_Verification.md` — when handed a verification prompt
- `DWYP_App_Structure.md` v1.3 — Phase 2 design sessions; any app structure or surface work
- `DWYP_User_Flows.md` v1.0 — any verb-level question on a specific surface
- Active spoke prompt — when included in the session (current: `DWYP_Spoke_Bridge_v2_Reel_Editorial.md`)

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

### Deployment Model

Code pushes directly to production. Staging-first cadence retired May 2026.

| | URL | Sheet |
|---|---|---|
| **Production** (`/exec`) | `https://script.google.com/macros/s/AKfycbzCed5Fmv9TNDf6ivQUcmhgUWWOyEVK4P3sxS8_KMQx7YOY6JeY7r-dh8jEw5DpecrI/exec` | `1p5ahHe4hgG6sHN4u13UyvEJWg5IwCkAfADjeqxwlTnw` |
| **Staging** (`/dev`) | `https://script.google.com/a/macros/wiseonewithin.com/s/AKfycbwHRxyQ22Zi0TFwT3av5jf30MiPhxBtV9tjb4hMxm0/dev` | `13bXMjxEf_L-BFH69OtUGOU6ywxt6BTat1kO9ik46Swk` |

Staging deployment exists but `STAGING_DEPLOYMENT_URL` is blanked in Governance_Config — `isStaging()` returns false everywhere, `getMasterSheetId()` always resolves production.

**Routing helpers (locked):**

Two helpers in `fairy_circle.js` route all sheet access:
- `isStaging()` — compares `ScriptApp.getService().getUrl()` to `STAGING_DEPLOYMENT_URL`. Fails closed to production on any error.
- `getMasterSheetId()` — returns staging sheet when `isStaging()` is true; production `MASTER_SHEET_ID` otherwise.

**Rules for all new code:**

1. **All sheet access goes through `getMasterSheetId()`** — never read `MASTER_SHEET_ID` directly via `PropertiesService` in operational code.
2. **One exception: `getGovernance()` itself.** Reads `MASTER_SHEET_ID` directly from Script Properties — the bootstrap that resolves the routing table. Routing it through `getMasterSheetId()` would create infinite recursion.
3. **No hardcoded URLs or sheet IDs** — values live in Governance_Config.
4. **Do not remove or rename `isStaging()` or `getMasterSheetId()`** without a hub decision. They are locked architectural artifacts.

**What routing does NOT isolate (shared between deployments):**
- Drive folders: `IMAGE_BACKGROUND_LIBRARY_ID`, `CORPUS_DRIVE_FOLDER_ID`, episode folders — all production.
- External APIs: Claude API key, Vertex RAG corpus, Gemini — same endpoints, real money.
- Triggers: `ScriptApp.getService().getUrl()` returns null in trigger context — `isStaging()` always returns false. Test trigger paths via `dev_tools.gs` manual invocation.

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

### Code Integrity Mandate

Replaces the old Preservation Mandate. The original mandate existed to prevent AI rewrites from silently compressing or simplifying working code. That risk has changed — targeted edits are the default, not wholesale regeneration. The mandate now focuses on protecting code integrity during iteration.

**What is protected:**

1. **No wholesale rewrites.** If a targeted edit achieves the goal, use it. Do not regenerate a function or file from scratch when an Edit would do.
2. **Schema-shaped functions require care.** Anything that reads or writes specific sheet columns (by index or header name) is load-bearing. Rename or restructure only with an explicit decision.
3. **Routing helpers are locked.** `isStaging()`, `getMasterSheetId()`, `getGovernance()` — do not rename, thin, or restructure without a hub decision.
4. **Fairy entry points and orchestration logic** — surface back before changing signatures or moving responsibilities between files.
5. **Dead code stubs are no longer required.** Retired code can be deleted when a decision has been made. Deletion still requires an explicit decision — but do not retain stubs by default.
6. **History lives in git.** Implementation context and version history belong in commit messages and `git log`, not in the KB or as inline code comments.

**When to surface back before acting:**
- Before deleting anything not explicitly listed in the spoke's scope
- Before renaming or moving a function used across multiple files
- Before changing a function signature in a way that touches callers
- Whenever the action feels outside the spoke's stated scope

---

## State Update Protocol

After completing a spoke, task set, or significant session:
1. **Offer to update Platform State.** Name the specific changes you'd make before writing.
2. **Update the Reference doc only when** a new architectural decision is locked or schema changes — not for bug fixes or polish.
3. **One-off `.md` files** brought to a session (spoke prompts, design notes) get incorporated into State when the work they describe is complete. Closed spokes are deleted, not archived.
4. **Update the Build Playbook** when a phase or item completes — mark done, note any surface-back items that emerged, identify what's next.

Do not silently proceed to the next item without confirming the State update is captured. The State doc is the contract between sessions.

---

## What Not to Do

- Do not invent design decisions. If a UI question doesn't have a decision in foundation docs, surface it as a hub-session topic.
- Do not bypass routing helpers, schema patterns, or version-stamp invalidation.
- Do not expand spoke scope unilaterally. Surface tangential issues, don't fix them.
- Do not paper over UNCERTAIN findings in verification mode.
- Do not assume Drive folders, API keys, or external services are isolated between deployments — they are shared unless explicitly stated otherwise.
- Do not promote staging to production. That's a manual Audra step (Manage Deployments → New version).
