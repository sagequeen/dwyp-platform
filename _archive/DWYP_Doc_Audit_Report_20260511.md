# DWYP Documentation Audit Report
**Date:** 2026-05-11
**Spoke:** DWYP_DocAudit_v1 — Report only. No source files were modified.
**Auditor:** Claude Code (Verification mode)

---

## Preflight Note — Missing Primary Authoritative Source

`DWYP_App_Structure.md` v1.1, which the spoke prompt designates as the *primary* authoritative source and the origin of "eight reframes," **does not exist in the repo.** Because that document is absent, this report cannot:
- Verify whether specific reframes have or have not landed in other docs
- Confirm which claims in existing docs contradict which specific reframe
- Populate the Conflict Map against App_Structure

What this report *can* do: assess each doc's internal consistency, its relationship to the other two named authoritative docs (Platform State and Build Playbook), and identify gaps implied by their combined content. All conflict-map entries reference Platform State v5.4 and/or Build Playbook v4 as the applicable authority.

**Version discrepancies in the spoke prompt itself:**
- Spoke says "State v4.4" — actual version is **v5.4** (header) / v5.3 (footer, mismatch within the doc)
- Spoke says "Build Playbook v3" — actual version is **v4**
These are the most current versions present. The spoke prompt was apparently drafted against an older baseline.

---

## Section 1: Inventory

Sorted by status, then by path. 21 in-scope `.md` files audited. Two `.claude/worktrees/` copies of NOTES.md are excluded from the full audit (auto-generated worktree artifacts) but noted at bottom of table.

| Path | Modified | KB | Stated Purpose | Status | Notes |
|---|---|---|---|---|---|
| `DWYP_Build_Playbook.md` | 2026-05-10 | 17.7 | Sequenced runbook with ownership, dependencies, and surface-back protocol | **Authoritative — needs update** | v4. Missing Phase 2.0 entry and Reframe #8 (Scribe cancellation, if confirmed). Phase 1 status notes accurate. |
| `DWYP_Platform_State.md` | 2026-05-10 | 48.1 | Active working state of the platform | **Authoritative — needs update** | Header says v5.4, footer says v5.3 (internal mismatch). Missing Help Desk Companion from companion list. Internal contradiction: Studio section says "Drive iframe player" for reels; Engineering Notes say "native `<video>`" is confirmed working. |
| `CLAUDE.md` | 2026-05-09 | 8.3 | Repo instructions for Claude — session start protocol, mode awareness, architectural patterns | **Authoritative — needs update** | References `changelog_v*` as "always read" on session start, but no changelog doc exists in the repo. |
| `DWYP_Help_Desk_Companion_Design.md` | 2026-05-09 | 11.0 | Locked design decisions for Help Desk AI companion | **Authoritative — needs update** | Synced to "Platform State v5.2" — stale sync marker (actual: v5.4). Prerequisite status table shows Phase 1.1–1.2 as ⏳ — these are now complete (Phase 1.5 verified). Not listed in Platform State's companion doc header. |
| `DWYP_Publish_AI_Companion_Design.md` | 2026-05-09 | 12.6 | Locked design decisions for Publish per-card AI companion | **Authoritative — needs update** | Synced to "Platform State v5.1" — stale sync marker. Still references `PUBLISH_LLM_MODE`, which State marks for retirement after Spoke 1. OQ-G (chat_history column) remains open. |
| `DWYP_Studio_v1.md` | 2026-05-06 | 19.1 | Consolidation of Studio design — architecture, tabs, backend and UI specs | **Authoritative — needs update** | Build sequence shows Spoke 3 (callClaudeAPI) as ⏳, but State confirms it is complete. Reels spec says "Drive iframe player (not `<video>` tag)" — contradicts confirmed working strategy in State Engineering Notes. References `gemini-3-pro-image-preview` for STUDIO_IMAGE_MODEL — model name likely stale. |
| `DWYP_Platform_Reference.md` | 2026-05-06 | 53.9 | Stable reference — locked architectural decisions, authoritative schema, codebase inventory | **Authoritative — needs update** | v2.8. Versions tab schema not present (added in Phase 1.1). Contacts schema (23 columns) omits `Last_Activity` — referenced in State Contacts tab section and written by Phase 1.3 helpers. Social_Assets schema shows 13 columns, consistent with State, but Social Architecture Redesign v3.2 references an older 21-column design — Reference is authoritative on this. |
| `DWYP_Performance_Principle.md` | 2026-05-09 | 12.2 | Foundational performance principle — cache-first, optimistic UI, progressive loading | **Partially superseded** | Drive folder hybrid section (p. 3) describes returning "higher of (sheet version, `folder.getLastUpdated()` epoch)" — but Phase 1.3 verification corrected this: `getLastUpdated()` does NOT update on file additions; implementation was changed to scan file modification timestamps. The Principle doc describes the original design intent, not the working implementation. The policy intent (self-healing hybrid) still stands; the mechanism described is wrong. |
| `DWYP_Social_Architecture_Redesign_v3.md` | 2026-05-06 | 36.1 | Publish tab architecture redesign — panels, slots, reels, episode accordion | **Partially superseded** | v3.2. Studio_v1.md explicitly supersedes "Studio sections in Social Architecture Redesign v3.2." Still the authoritative spec for Publish tab interaction detail (Studio_v1.md calls it the "full spec"). Social_Assets schema section references 21-column design superseded by the 13-column slim schema (Reference v2.8 + State v5.4). Reels player spec says Drive iframe embed — contradicts confirmed working native `<video>` strategy in State Engineering Notes. References "Librarian Vert" persona, which is retired (AD #97). |
| `DWYP_Spoke_Reels_Surface.md` | 2026-05-07 | 10.5 | Spoke prompt — Reels scheduling surface build (Publish tab) | **Partially superseded** | References `PUBLISH_LLM_MODE` (marked for retirement). Specifies Drive iframe embed for reel playback — contradicts confirmed native `<video>` strategy. Still partially in-flight (items 83–84 per State). Not yet a cull candidate — active work reference. |
| `DWYP_Deploy_Cheat_Sheet.md` | 2026-05-08 | 6.5 | Operational cheat sheet for clasp push / production deploy / rollback | **Stale but still useful** | No version number or frontmatter. URLs and instructions are accurate. No architectural conflicts. Not load-bearing for code decisions. |
| `DWYP_Build_Sequence_Archive.md` | 2026-05-09 | 23.4 | Static archive of build sequence items 1–84 | **Stale but still useful** | Self-describes as static archive. No version number. References pre-retirement features (Social Vert, Image Workshop, Frame.io) — expected for an archive. Captured from State v5.1; current State v5.4. Not a conflict — intentionally frozen. |
| `DWYP_Episode_Index_Template.md` | 2026-05-06 | 3.0 | Template for the per-episode index document written by Vert Fairy | **Stale but still useful** | No version number. Referenced by Platform Reference AD #103. No conflicts detected. Still load-bearing for Vert Fairy spoke (not yet built). |
| `DWYP_PreFlight_Staging_Verification.md` | 2026-05-09 | 6.2 | Claude Code prompt template for pre-flight staging architecture verification | **Stale but still useful** | No version number. "When to run" list references future phases (1.1, 1.3, 4.1) in future tense — 1.1 and 1.3 are now complete. Not a conflict — the instruction is still valid, just the timing context is stale. |
| `NOTES.md` | 2026-04-21 | 1.2 | Dev quick-reference — clasp/git sync commands and troubleshooting | **Stale but still useful** | No version. Oldest doc by modification date. Commands accurate. No architectural relevance. |
| `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` | 2026-05-10 | 8.7 | Spoke prompt for Phase 1.4 — frontend version-aware loader implementation | **Stale but still useful** | Phase 1.4 is complete (State v5.4). References `DWYP_Phase1_Test_Protocol.md` as a required read — that doc does not exist in the repo. Historical spoke prompt with no active use, but preserves intent record for Phase 1.4 decisions. |
| `DWYP_Spoke_DocAudit.md` | 2026-05-11 | 7.1 | Spoke prompt — this documentation audit | **Unclear** | Today's spoke prompt. Contains version references to State v4.4 and Playbook v3 that don't match current versions (v5.4 and v4). Unclear whether this was drafted against an older baseline intentionally or represents a stale handoff. |
| `_archive/DWYP_Handoff_ClaudeAPI_EpisodeIndex.md` | 2026-05-06 | 5.9 | Hub handoff — Claude API setup + episode index architecture | **Superseded** | Self-says "Incorporate into: Platform State v4.4." Decisions incorporated into State v5.x. References `PUBLISH_LLM_MODE` flip and Librarian Vert — both retired. In `_archive/`. |
| `_archive/DWYP_Handoff_Pipeline_Studio_Architecture.md` | 2026-05-06 | 6.1 | Hub handoff — pipeline and Studio pre-population architecture | **Superseded** | Self-says "Incorporate into: Platform State v4.4." Decisions incorporated. References PUBLISH_LLM_MODE and Librarian Vert — both retired. In `_archive/`. |
| `_archive/DWYP_StudioDesign_ContextBrief.md` | 2026-05-06 | 4.0 | Context brief for Studio design thread — decisions locked in Claude API hub thread | **Superseded** | Self-says "Do not incorporate into Platform State." Thread is closed; Studio_v1.md is the output. References `DWYP_BrandVoice_v1.md` (not in repo) and "Librarian Vert" (retired). In `_archive/`. |
| `DWYP_Surface_Principle.md` | 2026-05-09 | 10.1 | Foundational surface principle — mobile vs desktop split | **Authoritative** | Boundary calls confirmed May 2026. Write Lite added as Boundary Call #6. No conflicts with State or Playbook. Current. |

**Excluded from audit (auto-generated worktree copies, not repo docs):**
- `.claude/worktrees/inspiring-herschel-f7c939/NOTES.md`
- `.claude/worktrees/exciting-brattain-9fc784/NOTES.md`

**Missing referenced doc (not in repo, listed for gap awareness):**
- `DWYP_App_Structure.md` v1.1 — primary authoritative source per this spoke prompt. Does not exist.

---

## Section 2: Conflict Map

Grouped by authoritative source. Only docs with status Superseded, Partially superseded, or Authoritative — needs update are included.

---

### Platform State v5.4 as authority

**1. `DWYP_Performance_Principle.md` — Drive folder hybrid mechanism**
- Conflicting text: "returns the *higher* of (sheet version, `folder.getLastUpdated()` epoch)"
- Authoritative source: State v5.4: "`_resolveImageLibraryVersion()` corrected — scans file modification timestamps rather than folder metadata (folder.getLastUpdated() does not update on file additions)"
- Reconciliation note: Performance Principle must update Drive hybrid section to describe file-timestamp scan, not folder epoch.

**2. `DWYP_Studio_v1.md` — Reels player tech**
- Conflicting text: "Reels view: Drive iframe player (not `<video>` tag)"
- Authoritative source: State v5.4 Engineering Notes: "Do not use Drive's `/preview` URL... Final solution (confirmed working): Use a native `<video>` element."
- Reconciliation note: Studio_v1.md Reels spec must be updated to reflect native `<video>` with Drive UC URL.

**3. `DWYP_Social_Architecture_Redesign_v3.md` — Reels player tech**
- Conflicting text: "Drive iframe embed: `<iframe src="https://drive.google.com/file/d/{ID}/preview">`"
- Authoritative source: State v5.4 Engineering Notes: confirmed native `<video>` strategy.
- Reconciliation note: Social Architecture Reels section needs a superseded banner or annotation. The iframe pattern is incorrect per the confirmed working strategy.

**4. `DWYP_Social_Architecture_Redesign_v3.md` — Social_Assets column count**
- Conflicting text: "Social_Assets schema (cols 1–21) ✅ Written | Slide_Index, Availability, Display_Name, Summary added"
- Authoritative source: State v5.4: "Social_Assets tab confirmed with correct 13-column slim schema." Platform Reference v2.8 shows 13 columns.
- Reconciliation note: Social Architecture Social_Assets schema is the prior expanded design. Reference v2.8 and State are authoritative. Social Architecture section should be annotated as superseded.

**5. `DWYP_Social_Architecture_Redesign_v3.md` — Persona references**
- Conflicting text: "Librarian Vert" used throughout (caption generation, chat panel)
- Authoritative source: State v5.4 / AD #97: "Social Vert and Librarian Vert as named personas are retired."
- Reconciliation note: All Librarian Vert references should be replaced with "Claude" in any future revision of the doc.

**6. `DWYP_Spoke_Reels_Surface.md` — LLM mode key**
- Conflicting text: "`PUBLISH_LLM_MODE` governs whether caption generation calls Gemini or Claude."
- Authoritative source: State v5.4: "Retire `PUBLISH_LLM_MODE`... Replaced by `STUDIO_LLM_MODE`."
- Reconciliation note: Spoke prompt must reference `STUDIO_LLM_MODE` if the spoke is re-opened. Dead key reference.

**7. `DWYP_Spoke_Reels_Surface.md` — Reels player tech**
- Conflicting text: "played via iframe embed"
- Authoritative source: State v5.4 Engineering Notes: confirmed native `<video>`.
- Reconciliation note: Spoke prompt must be updated before re-opening to specify native `<video>` + Drive UC URL.

**8. `DWYP_Help_Desk_Companion_Design.md` — Phase 1 prerequisite status**
- Conflicting text: "Versions tab + getAllVersions() — ⏳ Phase 1.1–1.2 (depends on)"
- Authoritative source: State v5.4: Phase 1.1–1.5 complete on staging.
- Reconciliation note: Prerequisites table should be updated. Phase 1.x dependencies are now satisfied.

**9. `DWYP_Publish_AI_Companion_Design.md` — LLM mode key**
- Conflicting text: "`STUDIO_LLM_MODE = claude`... `PUBLISH_LLM_MODE` retired"
- Authoritative source: State v5.4: same — this doc correctly notes `PUBLISH_LLM_MODE` retiring.
- Reconciliation note: Not a conflict per se, but sync marker "Synced to: Platform State v5.1" is stale. Update to v5.4.

**10. `DWYP_Studio_v1.md` — Spoke completion status**
- Conflicting text: Spoke 3 "Write callClaudeAPI()" shown as ⏳
- Authoritative source: State v5.4 GAS File Status: "fairy_circle.gs — Spoke 3: `callClaudeAPI()` added."
- Reconciliation note: Studio_v1.md build sequence should mark Spoke 3 complete.

---

### Platform Reference v2.8 as authority

**11. `DWYP_Platform_State.md` — internal contradiction (Reels player)**
- Conflicting text within same doc: Studio tab says "Drive iframe player (not `<video>` tag)"; Engineering Notes says "Do not use Drive's `/preview` URL... use native `<video>`."
- Authority: Engineering Notes is the later, confirmed-working decision.
- Reconciliation note: State must correct the Studio tab description to match Engineering Notes.

**12. `DWYP_Platform_State.md` — version mismatch**
- Conflicting text: Header "Version: 5.4" vs footer "*Platform State v5.3 — May 2026*"
- Authority: Header is the intended current version.
- Reconciliation note: Footer must be updated to v5.4.

---

### Build Playbook v4 as authority

**13. `DWYP_Spoke_DocAudit.md` — version references**
- Conflicting text: "DWYP_Platform_State.md v4.4" and "DWYP_Build_Playbook.md v3" named as authoritative
- Authoritative source: Build Playbook v4, Platform State v5.4.
- Reconciliation note: DocAudit spoke prompt was drafted against an older baseline. Noting only — it's a prompt doc, not a reference doc.

---

## Section 3: Merge Candidates

**Group A: Archive handoff pair**
- Docs: `_archive/DWYP_Handoff_ClaudeAPI_EpisodeIndex.md`, `_archive/DWYP_Handoff_Pipeline_Studio_Architecture.md`
- What they cover: Both are May 2026 hub thread outputs from the same session. Both target "incorporate into Platform State v4.4." Both are now fully superseded.
- Proposed target: N/A — already in _archive. Decisions are in State.
- Verdict: Superseding + banner is sufficient. They are already isolated in `_archive/`. No merge lift needed.

**Group B: AI companion design pair**
- Docs: `DWYP_Publish_AI_Companion_Design.md`, `DWYP_Help_Desk_Companion_Design.md`
- What they cover: Both capture design decisions for AI companion surfaces (Claude for Publish, Gemini for Help Desk). Same pattern — stateless API, chip model, briefing assembly, session scope.
- Proposed target: A merged `DWYP_AI_Companion_Design.md` with Publish and Help Desk as sub-sections would reduce duplication of pattern documentation.
- Verdict: Not worth the merge lift yet. They're used differently (Publish companion is Phase 4.4, Help Desk is Phase 4.5). Keep separate until both spokes open — the spoke prompts reference these docs individually. Revisit after Phase 4.

**Group C: Studio architecture**
- Docs: `DWYP_Studio_v1.md`, `DWYP_Social_Architecture_Redesign_v3.md`
- What they cover: Studio_v1.md is the consolidation doc. Social Architecture is the original Publish tab design spec still referenced by Studio_v1.md as "Full spec."
- Proposed target: Studio_v1.md absorbs the Publish spec detail, Social Architecture gets a superseded banner.
- Verdict: Worth the lift — Social Architecture is now partially superseded and the iframe/persona conflicts make it hazardous for spoke reference. Studio_v1.md should absorb the Publish panel interaction detail and Social Architecture should get a frontmatter banner.

**Group D: Completed spoke prompts**
- Docs: `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` (complete), and future: `DWYP_Spoke_Reels_Surface.md` (when complete)
- What they cover: Execution instructions for spokes that have been (or will be) completed.
- Proposed target: `_archive/` for completed spokes.
- Verdict: Move completed spoke prompts to `_archive/` as a general hygiene practice. Phase 1.4 spoke is a candidate now. Reels Surface spoke moves when work closes.

---

## Section 4: Naming and Versioning Hygiene

### Files without version numbers (in filename or frontmatter)
| File | Impact |
|---|---|
| `NOTES.md` | Low — not a design doc |
| `DWYP_Deploy_Cheat_Sheet.md` | Low — operational guide, not versioned content |
| `DWYP_Episode_Index_Template.md` | Medium — is a template for a living system component |
| `DWYP_PreFlight_Staging_Verification.md` | Medium — a reusable verification prompt |
| `DWYP_Spoke_Reels_Surface.md` | Medium — spoke prompt; version would help distinguish from future revisions |
| `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` | Low — completed spoke |
| `DWYP_Spoke_DocAudit.md` | Low — this spoke |
| `DWYP_Build_Sequence_Archive.md` | Low — self-describes as static archive |

### Version number inconsistencies
| File | Issue |
|---|---|
| `DWYP_Platform_State.md` | Header says v5.4; footer says v5.3. Header is intended current. |
| `DWYP_Social_Architecture_Redesign_v3.md` | Filename says "v3"; content says "Version: 3.2". Minor — but filename is imprecise. |

### Stale sync markers
| File | Stale claim |
|---|---|
| `DWYP_Publish_AI_Companion_Design.md` | "Synced to: Platform State v5.1" (actual: v5.4) |
| `DWYP_Help_Desk_Companion_Design.md` | "Synced to: Platform State v5.2" (actual: v5.4) |

### Orphaned handoff docs (thread closed)
| File | Status |
|---|---|
| `_archive/DWYP_Handoff_ClaudeAPI_EpisodeIndex.md` | Thread closed. Decisions in State v5.x. Already in _archive. |
| `_archive/DWYP_Handoff_Pipeline_Studio_Architecture.md` | Thread closed. Decisions in State v5.x. Already in _archive. |
| `_archive/DWYP_StudioDesign_ContextBrief.md` | Thread closed. Studio_v1.md is the output. Already in _archive. |

### Files with ambiguous names
| File | Ambiguity |
|---|---|
| `NOTES.md` | Generic name — not clear this is a developer ops reference vs project notes |
| `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` | "OVERHAUL" prefix has no established meaning in the naming convention. Departs from the `DWYP_Spoke_[name].md` pattern. |

### Missing docs referenced by name in other docs
| Referenced doc | Referenced by | Status |
|---|---|---|
| `DWYP_App_Structure.md` v1.1 | `DWYP_Spoke_DocAudit.md` | **Does not exist** — PRIMARY gap |
| `changelog_v*` | `CLAUDE.md` (session start protocol) | **Does not exist** — CLAUDE.md says "read changelog" on every session |
| `DWYP_Phase1_Test_Protocol.md` | `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` | **Does not exist** |
| `DWYP_BrandVoice_v1.md` | `_archive/DWYP_StudioDesign_ContextBrief.md` | **Does not exist** (archive only — lower urgency) |

---

## Section 5: Gap List

This section identifies things implied by the combined content of the authoritative docs that no doc currently captures — or captures imprecisely.

### Gap 1 — DWYP_App_Structure.md does not exist (CRITICAL)
The primary authoritative source for this audit and the origin of eight reframes is missing from the repo. Without it:
- The eight reframes are undocumented
- Future spokes have no reference for what was decided in the design session that prompted this audit
- Conflicts against reframes cannot be identified
- Phase 2.0 — Action-Completeness Audit has no documented rationale

**What to create:** `DWYP_App_Structure.md` v1.1 from the hub session that produced it.

### Gap 2 — Scribe cancellation (Reframe #8) not documented
The spoke prompt explicitly flags "Reframe #8 (Scribe cancellation)" as a gap in State and Build Playbook. Current State lists Scribe in "Later" queue (not cancelled) and Pending Decisions includes "Scribe normalization format standard — Confirm before Scribe spoke." If Scribe is cancelled, State and Playbook must be updated to reflect it. If it's deferred, the current language is arguably accurate. Either way the status is ambiguous.

**What to update:** Platform State Pending Decisions and Build Playbook "Later" section to reflect the confirmed Scribe status (cancelled vs deferred).

### Gap 3 — Phase 2.0 entry absent from Build Playbook
The spoke prompt references "Phase 2.0 — Action-Completeness Audit" as a named upcoming phase. Build Playbook v4 has a Phase 2 (Design System) but no Phase 2.0 entry. Either Phase 2.0 is a sub-phase of Phase 2 or a new distinct phase following it. No doc establishes this.

**What to update:** Build Playbook v4 — add Phase 2.0 with scope and dependencies.

### Gap 4 — Slot-type schema (Reframe #5) not in Platform Reference
If Reframe #5 introduced a revised slot-type schema, it should land in Platform Reference. Current Reference does not document slot types explicitly. Social Assets has `Slot` as a column but the slot-type taxonomy (gold playbook slots vs crimson custom) is only described narratively in Social Architecture Redesign v3.2.

**What to update:** Platform Reference v2.9 — add Slot type schema as a locked architectural item.

### Gap 5 — Mode list deprecation (Reframe #6) has no single home
Mode list retirement is partially captured (AD #102 in Reference, Studio_v1.md tab structure section, State Studio section) but no doc explicitly says "these are the retired modes and why" in a reader-facing way. Future sessions seeded from any single doc may miss the context.

**What to update:** Platform Reference AD #102 should be expanded with the full mode list and explicit retirement note. Studio_v1.md could carry a "Retired surfaces" section already exists — this is mostly fine.

### Gap 6 — Platform State companion doc list incomplete
State v5.4 companion list (line 4) includes: `DWYP_Platform_Reference.md | DWYP_Studio_v1.md | DWYP_Social_Architecture_Redesign_v3.md | DWYP_Surface_Principle.md | DWYP_Performance_Principle.md | DWYP_Publish_AI_Companion_Design.md | DWYP_Build_Playbook.md | DWYP_PreFlight_Staging_Verification.md`

Missing: `DWYP_Help_Desk_Companion_Design.md` (present in Build Playbook's foundation references, not in State).

**What to update:** Platform State companion list — add Help Desk Companion Design.

### Gap 7 — changelog_v* referenced but does not exist
CLAUDE.md session start protocol says "read changelog_v*" on every session start. No changelog document exists in the repo. This means the "always loaded" reading protocol is impossible to follow for changelogs. Sessions starting from scratch have no changelog to read.

**What to create:** `changelog_v*.md` OR update CLAUDE.md to remove the changelog requirement if the Build Sequence Archive + State version history have replaced it.

### Gap 8 — Phase 1 Test Protocol referenced but does not exist
`OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md` says "read `DWYP_Phase1_Test_Protocol.md` Section 1.4 — verification checklist." That doc does not exist. The Phase 1.4 spoke is complete, so this is no longer an active blocker — but the gap means no formal test protocol is documented for any Phase 1 phase.

**What to note:** If a Phase 1 test protocol was written and used for staging verification, it should be in the repo. If it never existed as a formal doc, the spoke prompt was aspirational. Either way, clarify before Phase 1.6 opens.

### Gap 9 — Performance Principle drive hybrid description is wrong
The working implementation (file-timestamp scan) differs from the Principle's description (getLastUpdated epoch). Any developer reading the Principle will implement the wrong mechanism.

**What to update:** Performance Principle — Drive folder hybrid section.

### Gap 10 — Contacts Last_Activity column not in Reference schema
Platform State Contacts tab section and Herald Fairy notes reference `Last_Activity` on the Contacts tab (e.g., "Sorted by Last_Activity desc," Phase 1.3 added `updateLastActivity()` write path). Platform Reference v2.8 Contacts schema (23 columns) does not include this column.

**What to update:** Platform Reference v2.9 Contacts schema — add `Last_Activity` column with writer and notes.

### Gap 11 — Versions tab schema not in Platform Reference
The Versions tab was created in Phase 1.1 and is now the schema foundation for all version-stamp behavior. Platform Reference v2.8 schema section does not include it.

**What to update:** Platform Reference v2.9 — add Versions tab schema (Domain, Version, Last_Modified, Modified_By).

### Gap 12 — DWYP_App_Structure.md's other reframes (2, 3, 4, 7)
The spoke mentions Reframes #5, #6, and #8 by name. Reframes #1, #2, #3, #4, and #7 are not described anywhere in the repo. Their content and implications are unknown without the source document.

---

## Section 6: Recommendations

Ordered by highest impact first.

---

**1. Create `DWYP_App_Structure.md` v1.1**
Gap: The primary authoritative source for this audit does not exist. Without it, the eight reframes are undocumented, this audit is incomplete, and Phase 2.0 has no foundation.
Why first: Everything in this audit orbits this missing document. The conflict map against reframes cannot be completed without it.

---

**2. Update `DWYP_Platform_State.md` → v5.5**
Specific changes needed:
- Fix footer version (v5.3 → v5.5)
- Remove "Drive iframe player" from Studio Reels spec — replace with confirmed native `<video>` strategy
- Add `DWYP_Help_Desk_Companion_Design.md` to companion doc list
- Reflect Scribe status (cancelled vs deferred) once confirmed per Reframe #8

---

**3. Update `DWYP_Build_Playbook.md` → v5**
Specific changes needed:
- Add Phase 2.0 — Action-Completeness Audit entry (scope and dependencies)
- Reflect Scribe cancellation/deferral status once confirmed per Reframe #8

---

**4. Update `DWYP_Performance_Principle.md`**
Specific changes needed:
- Drive folder hybrid section: replace `folder.getLastUpdated()` description with file-timestamp scan. Note: "Implementation note — `getLastUpdated()` does not update when files are added; implementation scans individual file modification timestamps instead."
Why: Any developer reading this section will implement the wrong mechanism.

---

**5. Update `DWYP_Platform_Reference.md` → v2.9**
Specific changes needed:
- Add Versions tab schema (Phase 1.1 — Domain, Version, Last_Modified, Modified_By; 11 domain rows)
- Add `Last_Activity` to Contacts tab schema (position and writer TBD from live sheet)
- Add Slot-type schema if Reframe #5 defines one
Why: Reference is the schema authority. Two schema elements are now missing.

---

**6. Supersede `DWYP_Social_Architecture_Redesign_v3.md` with banner**
Add frontmatter banner pointing to `DWYP_Studio_v1.md` (for Studio specs) and `DWYP_Platform_Reference.md` v2.9 (for schema). Annotate:
- Social_Assets schema section — superseded by Reference v2.8 13-column slim schema
- Reels player spec — superseded by State Engineering Notes (native `<video>`)
- Librarian Vert / Social Vert references — retired per AD #97
Retain the doc. The Publish panel interaction detail is still referenced by Studio_v1.md and has not been fully absorbed.

---

**7. Update `DWYP_Studio_v1.md`**
Specific changes needed:
- Mark Spoke 3 (callClaudeAPI) as ✅ complete in build sequence
- Update Reels spec: replace "Drive iframe player (not `<video>` tag)" with native `<video>` + Drive UC URL pattern
- Update STUDIO_IMAGE_MODEL value if model name has changed since writing

---

**8. Create or suppress `changelog_v*`**
Either create a changelog document that CLAUDE.md's session start protocol references, or update CLAUDE.md to remove the changelog read requirement if Build Sequence Archive + State version history serve this purpose.
Why: Currently CLAUDE.md instructs Claude to "read changelog" but no changelog exists. Every session silently skips this step.

---

**9. Update `DWYP_Help_Desk_Companion_Design.md`**
Specific changes needed:
- Update sync marker from v5.2 to v5.5 (after State update)
- Update prerequisite status table: Phase 1.1–1.2 (Versions tab, bumpVersion) marked ✅ Done
Why: Stale prerequisites create false impression of unmet dependencies for Phase 4.5 spoke.

---

**10. Update `DWYP_Publish_AI_Companion_Design.md`**
Specific changes needed:
- Update sync marker from v5.1 to v5.5 (after State update)
- Resolve OQ-G (chat_history column) before Phase 4.4 spoke opens — flag as blocking prerequisite

---

**11. Discuss `DWYP_Spoke_DocAudit.md` version references**
The spoke prompt that launched this audit references State v4.4 and Playbook v3 as authoritative — both significantly older than current versions. If the "eight reframes" came from a session held while those versions were current, the reframes may already be partially reflected in v5.x. Hub session needed to clarify what's been incorporated and what's still a gap.

---

**12. Archive `OVERHAUL_DWYP_Spoke_Phase1.4_Frontend_Version_Loader.md`**
Phase 1.4 is complete. Move to `_archive/`. Note the reference to `DWYP_Phase1_Test_Protocol.md` (which doesn't exist) in the archive copy's notes so future sessions know a test protocol was referenced but never formally doc'd.

---

**13. Cull `_archive/DWYP_StudioDesign_ContextBrief.md`**
Thread is closed. Content either incorporated or superseded. References a non-existent doc (`DWYP_BrandVoice_v1.md`). Low historical value relative to the other archive handoffs. Recommend removal — Audra confirms before action.

---

*DWYP Doc Audit Report — 2026-05-11. Report-only. 21 source docs read; 0 source docs modified. All findings are observations. Subsequent spokes or hub sessions execute chosen recommendations.*
