# DWYP Spoke — Bridge v2 + Caption Signoff + Reel Editorial Pass

**Thread type:** Spoke
**Scope:** Bridge updates to consume Master Template v2.3 (Slot_Tags + Quality_Score writes, drop Slide_Index writes, signoff append). New Reel Editorial pass. Compositional prompt assembly across Voice Prohibitions + Ranking Schema + content section.
**Files touched (expected):** `vert_fairy.js`, `dev_tools.js`, plus any file containing Caption_Draft write paths (audit step below).

---

## Preservation Mandate

Do not simplify, rename, remove, or thin any existing function, variable, handler, or constant that is not explicitly in this spoke's scope. Read the full current state of every file you touch before writing a single line. Confirm your understanding of existing structure before proceeding. If you discover an obvious refinement adjacent to the scope, surface it for approval rather than implementing it silently.

---

## Constraints

- No hardcoded strings. All configurable values read from `Governance_Config` via `getGovernance(key)`.
- `MASTER_TEMPLATE_ID = 1ytbOmCAaKfwaHg_XCwefkUYqQUN2a4YUqem1LAnjA0o` — already updated in governance. Use `getGovernance("MASTER_TEMPLATE_ID")` everywhere; do not hardcode.
- All sheet access routes through `getMasterSheetId()` (do not call `getActiveSpreadsheet()` or hardcode sheet IDs).
- All LLM text generation routes through `callClaudeAPI()`. `STUDIO_LLM_MODE = claude` is governance-locked.
- Asset_Library schema includes `Slot_Tags` and `Quality_Score` columns. **Verify column positions before writing** by reading the live header row. Do not assume positions from any documentation — read and verify.
- `Slide_Index` column exists in the sheet but is being retired from write paths. Leave the column in place. Stop writing to it. Existing data not touched.
- Brand colors / fonts not relevant to this spoke (no UI work).

---

## Context

Master Template v2.3 ships a structural change that Bridge must adapt to:

1. **Voice Prohibitions** and **Ranking Schema** are now top-level `#` sections in the Master Template. They are composed into prompts at call time alongside the content section being generated (Show Notes or Reel Editorial).
2. **Hooks** and **Guest Quotes** sections now produce per-asset `SLOT_TAGS:` and `QUALITY_SCORE:` lines that Bridge must parse and write to Asset_Library.
3. **Slide_Index** is no longer written. Item 92 Phase 1 retired Slide_Index pairing logic. This spoke completes the retirement on the write side.
4. **Starter captions** are written without a signoff. Bridge appends the standard signoff programmatically from `CAPTION_SIGNOFF` governance key.
5. **Reel Editorial** is a new pass. It reads Reel-type rows from Asset_Library that have a raw `Reel_Summary` (Gemini-populated) and writes a cleaned summary plus `Slot_Tags` and `Quality_Score`.

The compositional pattern matters: every audience-facing Claude pass loads Voice Prohibitions + Ranking Schema + the content section as a single composed prompt. This is the durable pattern for future passes.

---

## Pre-Flight: Read Current State

Before writing anything, read and confirm the following:

1. **Read `vert_fairy.js` in full.** Specifically locate:
   - `runEditorialPass(epUid, opts)`
   - `materializeQuoteGraphicAssets(epUid, opts)`
   - Helpers: `_bridgeSliceSection_`, `_bridgeParseLabeledCaptions_`
   - Any other functions calling `extractPrompt("# Show Notes")` or older section names.
2. **Read `fairy_circle.js`** — confirm signature and behavior of `extractPrompt(headingName, docId)`. Specifically confirm it accepts an optional `docId` argument or defaults to `MASTER_TEMPLATE_ID`. If it does not accept a docId override, that is fine — the live Master Template Doc is the single source.
3. **Read the live Asset_Library sheet header row.** Confirm exact column positions for: `Slot_Tags`, `Quality_Score`, `Slide_Index`, `Reel_Summary`, `Quote_Text`, `Caption_Draft`. Write column position constants at the top of any function that needs them — do not assume.
4. **Grep the codebase for all writes to `Caption_Draft`.** List every function that writes to that column. This list becomes the audit set for signoff append (Task 4). Likely candidates: `materializeQuoteGraphicAssets`, Publish canvas caption regenerate handlers, any chat panel "use this caption" actions.
5. **Grep for all writes to `Slide_Index`.** Confirm `materializeQuoteGraphicAssets` is the only writer. If others exist, surface for approval before touching.

After reading, write a 5–10 line confirmation of what you found before starting Task 1.

---

## Tasks

### Task 1 — Compositional Prompt Assembly

In `vert_fairy.js`, update `runEditorialPass(epUid, opts)`:

- Replace the current single-section prompt load with a composed prompt:
  ```
  const voice    = extractPrompt("# Voice Prohibitions");
  const ranking  = extractPrompt("# Ranking Schema");
  const showNotes = extractPrompt("# Show Notes");
  const prompt = `${voice}\n\n${ranking}\n\n${showNotes}`;
  ```
- The exact heading strings must match v2.3 of the Master Template: `# Voice Prohibitions`, `# Ranking Schema`, `# Show Notes`.
- Do not change any other behavior of `runEditorialPass`. The output destination, manifest patch, audit trail logging, and error handling stay identical.
- If `extractPrompt` is being called elsewhere in `vert_fairy.js` with the old section name (e.g., `# Episode Card and Indexing Template` or similar legacy headers), surface for approval. Do not silently rewrite other callers.

### Task 2 — Bridge Parsing for SLOT_TAGS + QUALITY_SCORE

Update `materializeQuoteGraphicAssets(epUid, opts)` in `vert_fairy.js`:

The new HOOKS section format in the Show Notes doc is:
```
HOOK 1: [hook text]
SLOT_TAGS: [comma-separated days]
QUALITY_SCORE: [1-5 integer]

HOOK 2: [hook text]
SLOT_TAGS: ...
QUALITY_SCORE: ...
```

Same shape for GUEST QUOTES:
```
QUOTE 1: "[quote text]" — [Guest Name]
SLOT_TAGS: ...
QUALITY_SCORE: ...
```

**Parsing rules:**

- HOOK and QUOTE label patterns: `^HOOK\s+\d+:` and `^QUOTE\s+\d+:` at the start of a line (case-sensitive).
- `SLOT_TAGS:` and `QUALITY_SCORE:` are line-prefixed, anchored at start of line, case-sensitive.
- A hook/quote block ends at the next HOOK/QUOTE label, the next section header, or end of section.
- Blank lines between blocks are expected and must be tolerated.

**Add a helper** `_bridgeParseRankedItems_(sectionText, labelPrefix)`:

- Input: section text (output of `_bridgeSliceSection_`) and a label prefix (`"HOOK"` or `"QUOTE"`).
- Output: array of objects `{ index, text, slot_tags, quality_score }` where:
  - `index` is the integer from the label (1, 2, ...)
  - `text` is the trimmed hook/quote text (without the label)
  - `slot_tags` is a comma-trimmed array of strings: `["Monday", "Friday"]` or `["Any"]`
  - `quality_score` is an integer 1–5
- Defensive parsing: if `SLOT_TAGS` is missing or unparseable, default `slot_tags = ["Any"]` and log a warning to audit trail. If `QUALITY_SCORE` is missing or unparseable, default `quality_score = 3` and log a warning.
- Validate `quality_score` is 1–5; clamp out-of-range values and log a warning.
- Validate each tag in `slot_tags` against the vocabulary `["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Any"]`. Drop unrecognized tags and log a warning. If all tags are dropped, fall back to `["Any"]`.

**Write to Asset_Library:**

- Each Asset_Library row written by Bridge now sets:
  - `Slot_Tags` = comma-separated string (e.g., `"Monday, Friday"`). Store as a plain string in the cell — `getRankedAssetLibraryCandidates` already splits on comma.
  - `Quality_Score` = integer.
- **Do not write to `Slide_Index`.** Leave the cell empty for new rows.

### Task 3 — Caption Signoff Append

**Add governance key** in `Governance_Config`:

```
Key:   CAPTION_SIGNOFF
Value: Link in bio. Follow and subscribe to hear about future episodes.
```

(Audra will add this to the governance sheet before running. Reference the key via `getGovernance("CAPTION_SIGNOFF")`. If the key is missing, fall back to an empty string and log a warning.)

**Add a helper** `_appendCaptionSignoff_(captionText)` in `vert_fairy.js` (or a shared utility file if one already exists for caption operations — confirm placement before writing):

- Reads `CAPTION_SIGNOFF` from governance.
- If `captionText` already ends with the signoff (exact match, ignoring trailing whitespace), returns `captionText` unchanged. Prevents double-append.
- Otherwise returns `captionText.trimEnd() + "\n\n" + signoff`.
- If signoff is empty, returns `captionText` unchanged.

**Apply the helper at every Caption_Draft write site identified in pre-flight step 4.** This includes (at minimum):

- `materializeQuoteGraphicAssets` — wrap the Caption_Draft assignment.
- Any Publish canvas caption regeneration paths (likely `pb*` handlers in `dwyp_ui.html` or server endpoints in `dwyp_app.js`).
- Any chat panel "apply this caption" handler.
- The Reel Editorial pass (Task 5) — Caption_Draft is not written by that pass, so no append needed there. But verify.

Audit list from pre-flight step 4 is the canonical set. Do not miss any.

### Task 4 — Stop Writing Slide_Index

In `materializeQuoteGraphicAssets`:

- Remove the Slide_Index assignment for new rows.
- Add a comment at the removed location: `// RETIRED Slide_Index write (May 2026) — Item 92 Phase 1 retired pairing logic; v2.3 retired write path.`
- Leave the `Slide_Index` column position constant in place if it is used by any other read path. Do not remove the column or modify existing data.

If any other writer of Slide_Index was found in pre-flight step 5, surface for approval before touching.

### Task 5 — New: `runReelEditorialPass(epUid, opts)`

Add to `vert_fairy.js`. Signature: `runReelEditorialPass(epUid, {force = false} = {})`.

**Behavior:**

1. Read all Asset_Library rows where `Episode_UID = epUid` AND `Asset_Type = 'Reel'` (case-insensitive on Asset_Type — match existing convention).
2. Filter: rows where `Reel_Summary` is non-empty AND (`Quality_Score` is empty OR `force === true`).
   - Skip rows with empty Reel_Summary (Gemini hasn't run on them yet) — log INFO.
   - Skip rows that already have Quality_Score unless force — log INFO with skip count.
3. If filtered set is empty, return `{ status: 'no_work', processed: 0, skipped: <count>, errors: [] }`.
4. Compose prompt:
   ```
   const voice   = extractPrompt("# Voice Prohibitions");
   const ranking = extractPrompt("# Ranking Schema");
   const reelEd  = extractPrompt("# Reel Editorial");
   const systemPrompt = `${voice}\n\n${ranking}\n\n${reelEd}`;
   ```
5. Assemble user message: a structured list of reels to process. Format:
   ```
   Process the following reels. For each, return a block in the exact format specified in the Reel Editorial template.

   REEL aw-1234-abc:
   RAW_SUMMARY: [Gemini's raw Reel_Summary text]

   REEL aw-5678-def:
   RAW_SUMMARY: [Gemini's raw Reel_Summary text]

   (continue for all reels)
   ```
   Use the actual `Asset_ID` values from the rows.
6. Call `callClaudeAPI(systemPrompt, userMessage, opts)`. Use existing call patterns from `runEditorialPass` for max_tokens, model, etc.
7. Parse Claude's response. Expected format per the Reel Editorial template:
   ```
   REEL [Asset_ID]:
   SUMMARY: [cleaned 2-3 sentence summary]
   SLOT_TAGS: [day list]
   QUALITY_SCORE: [1-5]
   ```
   Blocks separated by blank lines.

**Add a helper** `_parseReelEditorialOutput_(responseText)`:

- Splits on blank lines, then per-block matches `REEL ([^:]+):`, `SUMMARY:`, `SLOT_TAGS:`, `QUALITY_SCORE:`.
- Returns array of objects `{ asset_id, summary, slot_tags, quality_score }`.
- Apply same defensive parsing as Task 2 (default Any, default 3, vocabulary validation, clamping). Log warnings to audit trail.
- If Claude returns the sentinel block (`SUMMARY: [unavailable — raw summary missing or unintelligible]`), still write it through — that's the agreed graceful failure mode.

8. For each parsed reel, locate the AL row by `Asset_ID` and write back:
   - `Reel_Summary` = cleaned summary (overwrites Gemini's raw — this is the intended behavior; the raw is in audit trail if needed).
   - `Slot_Tags` = comma-separated string.
   - `Quality_Score` = integer.
9. Return `{ status: 'processed', processed: <int>, skipped: <int>, errors: [<any>] }`.

**Logging:**

- Log `REEL_EDITORIAL_START` with epUid and reel count at start.
- Log `REEL_EDITORIAL_COMPLETE` with result summary at end.
- Log `REEL_EDITORIAL_ERROR` for any per-reel write failures (continue processing others).

**Idempotency:**

- Default: skips rows with existing Quality_Score. Re-running on the same episode is a no-op.
- `force=true`: processes all rows regardless of existing Quality_Score. Used for re-ranking after manual edits.

### Task 6 — Test Wrappers

Add to `dev_tools.js`:

```javascript
function test_runReelEditorialPass() {
  const epUid = "EP-260430-1427"; // David Bedrick — replace at run time
  const result = runReelEditorialPass(epUid, { force: false });
  Logger.log(JSON.stringify(result, null, 2));
}

function test_runReelEditorialPass_force() {
  const epUid = "EP-260430-1427";
  const result = runReelEditorialPass(epUid, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
}
```

No trigger registration.

Confirm existing test wrappers (`test_runEditorialPass`, `test_materializeQuoteGraphicAssets`) still work after the Task 1 + Task 2 changes — they should not need code changes, but verify the wrappers point at correct epUids before testing.

---

## Checkpoint Sequence

### Checkpoint 1 — Pre-flight read confirmation

Before any code is written, post a 5–10 line summary of what you found in the pre-flight read:

- Confirm signature and behavior of `extractPrompt`.
- List Caption_Draft write sites discovered.
- List Slide_Index write sites discovered.
- Confirm column positions for `Slot_Tags`, `Quality_Score`, `Slide_Index`, `Reel_Summary` in the live Asset_Library sheet.
- Surface any surprises before proceeding.

**Stop. Wait for Audra's confirmation before writing code.**

### Checkpoint 2 — Tasks 1–4 (Bridge updates) shipped to staging

After Tasks 1, 2, 3, 4 are implemented:

1. `clasp push` to staging.
2. Test on `/dev` URL using staging sheet:
   - Re-run `test_runEditorialPass` on a test episode (epUid TBD by Audra). Confirm composed prompt loads correctly. Verify the Show Notes doc looks structurally correct.
   - Re-run `test_materializeQuoteGraphicAssets` on the same episode with `force: true`. Verify Asset_Library rows now have `Slot_Tags` and `Quality_Score` populated, `Slide_Index` blank, `Caption_Draft` ending with the signoff (no double-append on re-run).
3. Surface any anomalies. Wait for Audra's review before Task 5.

### Checkpoint 3 — Task 5 (Reel Editorial) shipped to staging

After Task 5:

1. `clasp push` to staging.
2. Test on `/dev`:
   - Identify an episode with Reel-type AL rows that have populated `Reel_Summary` but empty `Quality_Score`.
   - Run `test_runReelEditorialPass`. Verify cleaned summaries, Slot_Tags, Quality_Score populated.
   - Re-run without force — should be a no-op (skip count = full set).
   - Run `test_runReelEditorialPass_force`. Verify rows are reprocessed.
3. Surface results. Wait for Audra before production deploy.

### Checkpoint 4 — Production deploy

After Audra's sign-off on Checkpoint 3: Manage Deployments → New version → Deploy.

---

## What This Spoke Is Not

- Not changing how Reels are detected or how Gemini writes `Reel_Summary` initially. Mending Fairy / Daily Pulse path is upstream and untouched.
- Not building the Daily Pulse wiring for `runReelEditorialPass`. Manual trigger only for now. Wiring is a follow-on once this pass is verified working.
- Not building the future `runSearchIndexPass`. The AI Search Index section exists in the template for future use.
- Not touching any Publish UI rendering. The candidate ranking (`getRankedAssetLibraryCandidates`) already reads Slot_Tags + Quality_Score correctly; this spoke fills the columns it reads.
- Not modifying `extractPrompt` itself. If the current implementation supports the new top-level sections correctly (markdown `#` headings, case-insensitive match, captures until next heading), no helper changes needed.

---

## Schema Reference (verify against live sheet)

**Asset_Library columns Bridge writes/reads in this spoke:**

| Column | Read | Write (this spoke) |
|---|---|---|
| Asset_ID | yes | yes (on create) |
| Episode_UID | yes (filter) | yes (on create) |
| Asset_Type | yes (filter) | yes (on create) |
| Quote_Text | — | yes (Quote_Graphic only, unchanged) |
| Reel_Summary | yes (Reel pass) | yes (Reel pass: cleaned) |
| Caption_Draft | — | yes (with signoff append) |
| Slot_Tags | — | yes (new) |
| Quality_Score | — | yes (new) |
| Slide_Index | — | **NO — retired write** |
| Status | — | yes (on create: candidate) |
| Availability | — | yes (on create: available) |
| Created_At | — | yes (on create) |
| Created_By | — | yes (on create: system) |

If the live sheet header row does not include `Slot_Tags` and `Quality_Score` columns, **stop and surface to Audra** — the schema needs to be confirmed before proceeding.

---

## Final Notes

- This spoke is one logical unit. Tasks are sequenced for clean checkpoints, not separable into different spokes.
- If you discover the new template doc has any section heading mismatches (e.g., template has `# Voice Prohibitions` but code expects `# VOICE PROHIBITIONS`), surface immediately — Audra will fix the doc rather than the code, since markdown convention is the standard.
- Preservation Mandate applies in full. Several functions are touched in this spoke; preserve every line not explicitly in scope.
