# Spoke: Documentation Audit (Report-Only)

## Context

The DWYP Operations Platform repo has accumulated `.md` files across multiple build phases. A major hub-thread design session just completed and produced `DWYP_App_Structure.md` v1.1, which introduces eight reframes that supersede or partially supersede several existing docs.

Before the next design phase opens (Phase 2.0 — Action-Completeness Audit), the doc set needs to be audited so we know:
- Which docs are authoritative
- Which are superseded (in full or in part)
- Which conflict with current direction
- Which should be merged or culled
- What gaps exist that no doc currently covers

This spoke produces **a report only.** No edits, no rewrites, no deletions. Edits happen in separate, scoped passes after Audra reviews the report.

---

## Authoritative Documents

These three documents are authoritative. When older docs conflict with these, the older doc is wrong.

1. `DWYP_App_Structure.md` v1.1 — eight reframes, Phase 2.0 audit, derived structure
2. `DWYP_Platform_State.md` v4.4 — current build state
3. `DWYP_Build_Playbook.md` v3 — phased build sequence

Note: State v4.4 and Build Playbook v3 also need updates to reflect Reframe #8 (Scribe cancellation) and Phase 2.0 — flag this in the report as a gap, do not edit.

---

## Scope

Audit every `.md` file in the repo. Do not touch other file types.

For each `.md` file, produce a row in the inventory with:
- Path (relative to repo root)
- Last modified date
- File size (rough — KB)
- Stated purpose (from the doc's own header/intro, one line)
- Status (see status taxonomy below)
- Notes (what makes it that status; what's specifically affected)

---

## Status Taxonomy

Assign exactly one status per doc:

| Status | Definition |
|---|---|
| **Authoritative** | Current direction. Reflects latest reframes. |
| **Authoritative — needs update** | Mostly current, but missing recent changes (e.g., State v4.4 missing Reframe #8). |
| **Superseded** | Replaced by a newer doc. Should get a frontmatter banner pointing to its replacement. |
| **Partially superseded** | Some sections still useful, others contradict current direction. Should be split, merged, or annotated. |
| **Stale but still useful** | Older but no replacement exists yet. Content is still load-bearing. |
| **Cull candidate** | Obsolete and no historical value. Recommend removal (do not remove). |
| **Unclear** | Cannot determine status without Audra's input. |

---

## Required Outputs

Produce one report file: `DWYP_Doc_Audit_Report_[YYYYMMDD].md` at the repo root.

The report must contain these six sections, in order:

### Section 1: Inventory
Table of every `.md` file with the columns listed above. Sort by status, then by path.

### Section 2: Conflict Map
For each doc with status `Superseded`, `Partially superseded`, or `Authoritative — needs update`:
- Doc path
- Specific section / line / claim that conflicts
- Quote the conflicting text (short — under 15 words per quote, no more than one quote per doc per conflict)
- Quote or cite the authoritative source that contradicts it
- One-line reconciliation note (what should change)

Group by authoritative source (App_Structure conflicts together, State conflicts together, etc.).

### Section 3: Merge Candidates
Pairs or groups of docs covering the same territory. For each group:
- The docs involved
- What they all cover
- Proposed target doc name (if a new combined doc would be the right move)
- Whether merging is worth the lift, or whether superseding + banner is enough

### Section 4: Naming and Versioning Hygiene
Flag:
- Files without version numbers in filename or frontmatter
- Inconsistency between version-in-filename and version-in-frontmatter
- Orphaned handoff docs (handoff to a thread that's long closed)
- Files with ambiguous names that don't make their scope clear

### Section 5: Gap List
Things the eight reframes implied but no doc captures. Examples to look for:
- Scribe cancellation status (Reframe #8) — should land in State and Build Playbook
- Slot-type schema (Reframe #5) — should land in Platform Reference
- Mode list deprecation (Reframe #6) — should be reflected wherever modes are listed
- Phase 2.0 entry — should land in Build Playbook
- Companion docs list update — should land in State

This section is the most important. Look broadly.

### Section 6: Recommendations
Ordered list, highest-impact first. Each recommendation is one of:
- **Update [doc]** — what needs to change, why
- **Supersede [doc] with [doc]** — add banner, retain for history
- **Merge [docs] into [doc]** — proposed target, rough scope
- **Create [new doc]** — what gap it fills
- **Cull [doc]** — why it's safe to remove (Audra confirms before action)
- **Discuss [doc]** — needs hub-thread judgment, not a mechanical fix

Do not act on any recommendation. The next spoke (or hub session) will pick which ones to execute.

---

## Constraints

- **Read-only.** No file edits, deletions, renames, or moves in this spoke.
- **Do not regenerate or rewrite any doc.** The output is the audit report only.
- **Do not assume which reframes won the hub debate.** Read `DWYP_App_Structure.md` v1.1 to learn which did.
- **Preservation Mandate applies.** If a doc looks stale but its referenced concepts are still referenced elsewhere in the codebase, flag as `Stale but still useful` — do not recommend culling.
- **Headstones, not graves.** Default for superseded docs is "add frontmatter banner pointing to replacement," not deletion.
- **Quote limits.** When quoting from docs in the conflict map, keep quotes under 15 words. One quote per doc per conflict. Otherwise paraphrase.
- **No corpus deposit.** Do not write to any corpus folder or Asset_Library.

---

## Execution Order

1. List every `.md` file in the repo (and subdirectories).
2. Read `DWYP_App_Structure.md` first (full) to load the eight reframes into working context.
3. Read `DWYP_Platform_State.md` and `DWYP_Build_Playbook.md` (full) to load current build state.
4. For every other `.md`, read in full and assess against the authoritative trio.
5. Build the inventory table.
6. Build the conflict map.
7. Build the merge candidate list.
8. Build the naming/versioning hygiene list.
9. Build the gap list.
10. Build the recommendations list.
11. Write the report to repo root as `DWYP_Doc_Audit_Report_[YYYYMMDD].md`.
12. Output a short summary to terminal: total docs audited, count per status, top three recommendations.

---

## Done Criteria

- Report file exists at repo root with all six sections populated.
- Every `.md` file in repo appears in the inventory exactly once.
- Every doc marked `Superseded`, `Partially superseded`, or `Authoritative — needs update` appears in the conflict map.
- No source docs have been modified, renamed, or deleted.
- Terminal summary printed.

---

## After This Spoke

Audra reads the report. Hub thread reviews recommendations. Subsequent spokes (one per affected doc, or grouped where tightly coupled) execute the chosen recommendations.

Do not auto-open a follow-up spoke. Stop after the report is written.

---

*Spoke prompt — DWYP_DocAudit_v1. Report-only. Foundation for doc set realignment ahead of Phase 2.0.*
