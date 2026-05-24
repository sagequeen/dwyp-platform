# CLAUDE.md — Operating Canon

**Audience:** Hub Claude and Claude Code. Not Audra.
**Role:** Single source of truth for reading order, mode behavior, mandates, and locked architectural patterns. Supersedes any reading-tier guidance elsewhere in the docs.

---

## Session Start Protocol

Load in tier order. Do not pre-load Tier 3 unless triggered.

### Tier 1 — Always loaded (every session)

1. `CLAUDE.md` — this doc.
2. `docs/DWYP_Operating_Model.md` — spine. Compression of principles, chrome, companion model, slot model, cardinal rules.
3. `docs/DWYP_Platform_State.md` — active working state.
4. `docs/DWYP_Platform_Reference.md` — locked architectural decisions, authoritative schema.
   - **Hub:** always loaded.
   - **Code:** load when schema, ADs, or governance are in scope.

### Tier 2 — Always for code, UI, or design work

5. `docs/DWYP_Surface_Principle.md` — where things live (mobile = ops, desktop = creation).
6. `docs/DWYP_Performance_Principle.md` — how things feel (show first, sync second; version-stamp invalidation).

### Tier 3 — Situational, load when triggered

| Doc | Load when |
|---|---|
| `docs/DWYP_App_Structure.md` | App-structure or surface-design work |
| `docs/DWYP_User_Flows.md` | Verb-level question on a specific surface |
| `docs/DWYP_Codebase_Map.md` | Entering a new file area; orienting on code architecture |
| `docs/DWYP_Build_Playbook.md` | Picking next work; sequencing dependencies |
| `docs/DWYP_PreFlight_Staging_Verification.md` | Routing-integrity check before any sheet-writing spoke |
| Active spec doc | Referenced in session or in State |

If a referenced doc is not in context, ask before proceeding rather than assuming.

---

## Mode Awareness

Three modes. Each has different rules. If the mode is unclear, ask.

### Hub mode
Big-picture context, design decisions, documentation. Audra leads; Claude reasons and captures.
- **No code is written in Hub threads.** Surface implementation questions; do not generate code.
- Output is structured markdown (handoff docs, design specs, playbook updates).
- Decisions get locked, then handed off to Spoke threads.
- **Spoke prompts authored by Hub include:** Code Integrity Mandate reference, scope statement (in/out), explicit clasp push checkpoints, and fully self-contained context. Audra works intermittently between recording sessions — spokes that omit these slip scope or stall.

### Spoke mode
One focused unit of implementation work. Spoke prompt provides scope; Claude executes.
- Read the spoke prompt fully before writing anything.
- Stay within scope. Surface tangential issues — do not expand the spoke unilaterally.
- Multi-file patches are fine when files are tightly coupled.
- Surface back at push checkpoints before moving to the next item.

### Verification mode
Explicit static-analysis check (e.g., pre-flight verification).
- **Do not modify code. Do not propose fixes.** Report findings only.
- Mark UNCERTAIN where ambiguous; do not paper over.
- Use the structured reporting format the verification prompt specifies.
- This mode is the antidote to "helpful" — be deliberate.

---

## Doc Inventory — Canonical

Permanent docs only. Anything in repo or project knowledge not on this list is an open spoke prompt, a one-shot artifact, or cruft to retire — surface before treating as authoritative.

| Doc | Tier | Owner |
|---|---|---|
| `CLAUDE.md` | 1 | Hub |
| `DWYP_Operating_Model.md` | 1 | Hub |
| `DWYP_Platform_State.md` | 1 | Hub + Code |
| `DWYP_Platform_Reference.md` | 1 | Hub (append-only) |
| `DWYP_Surface_Principle.md` | 2 | Hub |
| `DWYP_Performance_Principle.md` | 2 | Hub |
| `DWYP_App_Structure.md` | 3 | Hub |
| `DWYP_User_Flows.md` | 3 | Hub |
| `DWYP_Codebase_Map.md` | 3 | Code |
| `DWYP_Build_Playbook.md` | 3 | Hub + Code |
| `DWYP_PreFlight_Staging_Verification.md` | 3 | Hub |

**Active specs (temporary, deleted on incorporation):**
- `DWYP_Outstanding_Build_Items.md` — Phase 3 prioritization inventory. Retires when items are sequenced into Build Playbook.
- `DWYP_Index_Audit_Design.md` — pre-execution design doc. Becomes spoke prompt when picked up; deleted after incorporation.
- `SPOKE_B_Display_Review_View.md` — spoke prompt for Display Review view (item A2). Deleted on execution.
- `DWYP_Spoke_Reels_Surface.md` — in-flight spoke (items 83–84). Refresh required before resuming — warning block at top of doc lists specifics. Delete on completion.

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

Test:
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

---

## Mandates

### Code Integrity Mandate

Targeted edits are the default, not wholesale regeneration.

**Protected:**

1. **No wholesale rewrites.** If a targeted edit achieves the goal, use it. Do not regenerate a function or file from scratch when an Edit would do.
2. **Schema-shaped functions require care.** Anything that reads or writes specific sheet columns (by index or header name) is load-bearing. Rename or restructure only with an explicit decision.
3. **Routing helpers are locked.** `isStaging()`, `getMasterSheetId()`, `getGovernance()` — do not rename, thin, or restructure without a hub decision.
4. **Fairy entry points and orchestration logic** — surface back before changing signatures or moving responsibilities between files.
5. **Dead code stubs are not required.** Retired code can be deleted when a decision has been made. Deletion still requires an explicit decision — but do not retain stubs by default.
6. **History lives in git.** Implementation context and version history belong in commit messages and `git log`, not in the KB or as inline code comments.

**Surface back before acting when:**
- Deleting anything not explicitly listed in the spoke's scope
- Renaming or moving a function used across multiple files
- Changing a function signature in a way that touches callers
- The action feels outside the spoke's stated scope

### Documentation Integrity Mandate

Documentation is forward-looking, not technical history. Project knowledge is read by AI for retrieval — optimize for precision, not narrative.

**Protected:**

1. **Forward-looking only.** Capture what's useful for operating, extending, or troubleshooting the system — not what changed, when, or why a previous approach was dropped.
2. **Single source of truth per fact.** When the same fact would appear in two docs, one is canonical and the other points at it. No silent duplication.
3. **No supersede notices, no "what this displaces" tables, no version-trail prose.** History lives in git. If a doc replaces another, the replaced doc is deleted in the same commit.
4. **Cross-reference drift is a bug.** If doc X says "see Y v2.9" and Y is now v3.1, fix the reference at the source. Do not add a "still applies despite version" note.
5. **Closed spokes: outcomes captured in State (done + hanging).** The spoke doc itself is discarded — never repo'd, never archived.
6. **AI audience.** Tables, bullets, terse phrasing. No narrative throat-clearing. No prose flourishes that don't survive retrieval chunking.

**Surface back before acting when:**
- A change would create overlapping content between two permanent docs
- A doc you'd write doesn't fit any tier in the inventory above
- A retired doc has content that isn't yet routed into a permanent doc

---

## Doc-Sync SoP (Hub + Code)

**Repo boundary.** Only the canonical permanent docs (Tier 1–3) are `.md` files in the repo. Spoke prompts and handoff/design `.md`s are **never** repo files — pasted directly into Code, discarded after the session. Repo'ing working docs is the failure mode this SoP prevents.

**Code — session end.** Update `DWYP_Platform_State.md` with **done** + **hanging**. State is the only working artifact that touches the repo; it is the contract between sessions. Mechanics: State Update Protocol, below.

**Hub — thread start.** Confirm Audra has synced State before relying on it. This is the *only* sync prompt Hub gives.

**Hub — in-thread (correct; keep).** Warn when a thread nears compression limits; move multi-step processes to an artifact. Do **not** prompt to sync working docs to the repo mid-thread.

---

## State Update Protocol

After completing a spoke, task set, or significant session:

1. **Offer to update Platform State.** Name the specific changes before writing.
2. **Update Platform Reference only when** a new architectural decision is locked or schema changes — not for bug fixes or polish. Reference is append-only.
3. **One-off `.md` files** (spoke prompts, design notes) are pasted into Code, never repo'd. Outcomes land in State; the file is discarded.
4. **Update Build Playbook** when a phase or item completes — mark done, note any surface-back items, identify next.
5. **Codebase Map** updated by Code when responsibility-level changes happen (new file, deleted file, function moved between files). Implementation-detail changes do not trigger an update.

Do not silently proceed to the next item without confirming the State update is captured. The State doc is the contract between sessions.

---

## What Not to Do

- Do not invent design decisions. If a UI question doesn't have a decision in foundation docs, surface it as a hub-session topic.
- Do not bypass routing helpers, schema patterns, or version-stamp invalidation.
- Do not expand spoke scope unilaterally. Surface tangential issues; do not fix them.
- Do not paper over UNCERTAIN findings in verification mode.
- Do not assume Drive folders, API keys, or external services are isolated between deployments — they are shared unless explicitly stated otherwise.
- Do not promote staging to production. That is a manual Audra step (Manage Deployments → New version).
- Do not write supersede notices, what-this-displaces tables, or version-trail prose in any doc. See Documentation Integrity Mandate.
- Do not load Tier 3 docs pre-emptively. Trigger-load only.
