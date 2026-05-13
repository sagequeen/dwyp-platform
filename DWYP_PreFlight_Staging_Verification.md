# DWYP Pre-Flight Staging Verification

**Tool:** Claude Code (not Cowork)
**Purpose:** Verify staging architecture is intact before opening any spoke that writes to sheets or modifies sheet schema. Claude Code runs verification faithfully — reports findings, does not fix. Cowork would too-helpfully paper over issues.

**When to run:**
- Before Phase 1.1 (Versions tab schema creation)
- Before Phase 1.3 (endpoint retrofit)
- Before Phase 4.1 (Asset_Library schema confirm)
- Before any future spoke that touches Master Sheet writes
- After any major refactor that touched routing code
- When you're not 100% sure what state staging is in

**What it catches:** missing wrapper functions, orphan call sites, missing config keys, schema drift between staging and production.
**What it does NOT catch:** runtime routing bugs, edge-case behavior, partial implementations that pass the static check. This is a smoke test, not a guarantee.

---

## Prompt to paste into Claude Code

```
You are running in VERIFICATION MODE.

DO NOT modify any code. DO NOT edit any files. DO NOT propose fixes.
Your job is to inspect the current codebase and report findings.

If you find issues, list them. Do not attempt to resolve them.
If you encounter ambiguity, mark UNCERTAIN and describe what's unclear.

Foundation docs (read if not in context):
- DWYP_Build_Playbook.md
- DWYP_Performance_Principle.md

Perform the following checks and produce a single markdown report.

---

CHECK 1: Discriminator function (isStaging)

Locate isStaging() in fairy_circle.gs (or wherever it lives) and confirm:
- Function exists
- Uses ScriptApp.getService().getUrl() for detection
- Reads STAGING_DEPLOYMENT_URL from Governance_Config via getGovernance()
- Comparison is exact-string (no normalization, no toLowerCase, no trim)
- Returns false on any error (fail-closed to production)

CHECK 2: Master Sheet wrapper (getMasterSheetId)

Locate getMasterSheetId() and confirm:
- Function exists
- Reads MASTER_SHEET_ID from Script Properties for production path
- Reads STAGING_SHEET_ID from Governance_Config for staging path
- Calls isStaging() to route
- Returns production ID if STAGING_SHEET_ID is missing or empty (fail-closed)

CHECK 3: No orphan sheet access

Run these searches and report every match:

grep -rn "MASTER_SHEET_ID" --include="*.gs" --include="*.html" .
grep -rn "openById(" --include="*.gs" --include="*.html" .
grep -rn "getProperty('MASTER_SHEET_ID')" --include="*.gs" --include="*.html" .
grep -rn 'getProperty("MASTER_SHEET_ID")' --include="*.gs" --include="*.html" .

For each match, classify:
- LEGITIMATE: inside getMasterSheetId() function body, or inside a comment, or inside isStaging()
- ORPHAN: any other location

List orphans with file path, line number, and the actual code snippet.

CHECK 4: Governance_Config required keys

Read production Governance_Config (use Script Property MASTER_SHEET_ID to resolve sheet, then read Governance_Config tab) and confirm:
- STAGING_DEPLOYMENT_URL is present and non-empty
- STAGING_SHEET_ID is present and non-empty
- Both values look like URLs/IDs (not placeholder text like "TODO" or "TBD")

CHECK 5: Staging sheet schema parity

Read the staging Master Sheet (using STAGING_SHEET_ID from production Governance_Config) and confirm:
- All production tabs present: Contacts, Tasks, Episodes, Episode_Log, Governance_Config, User_Registry, Audit_Trail, Social_Assets, Launch_Checklist, Reference, Asset_Library
- For each tab, compare column header row between staging and production
- Flag any column count mismatch or header text mismatch

CHECK 6: Trigger inventory

Locate all time-based triggers (project triggers panel or ScriptApp.getProjectTriggers() if accessible) and report:
- Number of triggers
- Function name each trigger calls
- Note: triggers always run with isStaging()=false (no service URL in trigger context). This is correct behavior — flagging for awareness, not as an error.

---

REPORTING FORMAT

Output a single markdown report with these sections:

# Pre-Flight Staging Verification — [DATE]

## Summary
PASS / FAIL / NEEDS ATTENTION (with one-sentence reason)

## Check 1: isStaging()
[PASS/FAIL/UNCERTAIN] — [details]

## Check 2: getMasterSheetId()
[PASS/FAIL/UNCERTAIN] — [details]

## Check 3: Orphan sheet access
- LEGITIMATE matches: [count]
- ORPHAN matches: [count, list each below]
- [if any orphans, list with file:line and code snippet]

## Check 4: Governance keys
- STAGING_DEPLOYMENT_URL: [PASS/FAIL with value preview]
- STAGING_SHEET_ID: [PASS/FAIL with value preview]

## Check 5: Schema parity
[PASS/DRIFT/UNCERTAIN] — [list any drift]

## Check 6: Trigger inventory
[informational only — list triggers]

## Recommendations
[If any FAIL or NEEDS ATTENTION items exist, describe what they affect — but do not propose code fixes. If all PASS, state that the architecture is verified and the spoke can proceed.]
```

---

## When the verification finishes

If everything passes: proceed with the planned spoke. Hand the spoke prompt to Cowork (or stay in Code, whichever you prefer for the work itself).

If anything fails or shows drift:
- **Don't let Cowork fix it.** Cowork will helpfully invent solutions. Bring fixes back through hub session or a focused Code session that explicitly addresses the failure.
- **Re-run verification after the fix.** The whole point is rigor.
- **Update the State doc** if the fix changed architecture in a way future sessions need to know about.

---

## Caveats this verification cannot catch

These require runtime testing or active monitoring, not static analysis:

- Routing actually working under live staging URL hits
- Drive operations being correctly aware of (or shared with) production folders
- External API calls being correctly attributed to the right environment
- Triggers respecting any environment guards you might add later
- Race conditions on simultaneous staging/production writes

Treat this verification as a confidence check on the architectural foundation, not as a green light for arbitrary risk. For higher-risk operations (data migrations, schema changes hitting production sheets, mass writes), add a manual smoke test pass before promoting.

---

*Pre-flight verification template, May 2026. Designed for Claude Code in verification mode. Re-runnable before any spoke that writes to sheets.*
