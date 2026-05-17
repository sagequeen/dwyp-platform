# SPOKE — Editorial Pass (Track B)

**Hub:** Day plan Track B. Blocks Track C (bridge parses Show Notes Doc written by this pass).
**File:** `vert_fairy.js` primarily, `dev_tools.js` for test wrapper.
**Mode:** Spoke.
**Depends on:** Track A (`buildEpisodeIndexV2`) shipped + Master Template v2.1 patched in the Google Doc.

---

## Intentional Deletion Policy

Nothing in this spoke deletes or renames existing code. Old pipeline functions stay in place. This spoke **adds** a new function: `runEditorialPass(epUid, opts)`.

Old Vert Fairy passes (Pass 1, Pass 2, Pass 3, `cleanHooksWithClaude`), the current Show Notes Doc writers, and `runArtistFairy` are not touched. Pipeline cutover and retirements happen in a separate later spoke after Tracks B and C both ship and verify.

---

## Scope

Build `runEditorialPass(epUid, {force = false} = {})` in `vert_fairy.js`. It reads the Episode Index v2 doc and writes a complete Show Notes Doc using the Master Template v2.1 structure, by way of a single Claude API call.

It does **not** read transcripts (Index is the source). It does **not** touch Asset_Library (Track C). It does **not** generate images. It does **not** call Vertex / Vert.

---

## Read Before Writing

1. **`vert_fairy.js` current state.** Specifically:
   - The existing Claude pass that writes Show Notes Doc (the current Pass 1 + Pass 2 logic that produces Podcast Player Copy, Takeaways, Hooks, Quotes, etc.). Read its prompt scaffolding and Master Template extraction pattern.
   - `callClaudeAPI()` usage — confirm max input tokens it allows. The editorial pass sends ~70K Index + ~15K supplementary docs + Master Template + scaffolding ≈ 90–100K input. If the existing helper caps lower, bump or pass through a higher limit.
   - How the existing pass writes to a Google Doc in the Staging folder (assume `DocumentApp.create()` → `moveTo(stagingFolder)` pattern). Replicate.

2. **`fairy_circle.js`** for shared helpers:
   - `extractPrompt(sectionName)` — extracts Master Template sections. Used here to pull "PASS 1: EPISODE CARD" exactly as the existing pipeline does.
   - `getGovernance(key)` — config reads.
   - Audit log helper.

3. **Master Template v2.1** in Google Doc. Confirm Audra has applied the patch (sections in order, no HOST QUOTES, YT DESCRIPTION + STARTER CAPTIONS sections present). If template appears unpatched, surface back — do not proceed.

4. **`buildEpisodeIndexV2`** from Track A — used here as the input source. Read `manifest.episode_index_v2` to get the Index doc ID.

5. **Existing manifest write helpers** for `manifest.show_notes`. Use the same pattern.

If anything is unclear or appears inconsistent, surface back before writing.

---

## Function Specification

### Signature

```javascript
/**
 * Reads Episode Index v2, calls Claude with Master Template v2.1 structure,
 * writes complete Show Notes Doc to the episode's Staging folder. Writes file ID
 * to manifest.show_notes.
 *
 * @param {string} epUid - Episode UID
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - If true, trashes existing Show Notes Doc and rewrites
 * @return {object} - { status, fileId, fileName, sizeChars, claudeMs }
 */
function runEditorialPass(epUid, opts) { ... }
```

### Behavior

1. **Resolve episode.** Read Episodes row. Pull guest name, manifest, staging folder ID, release date.
2. **Idempotency check.** Read `manifest.show_notes`. If set and `!force`, return `{ status: 'skipped_exists', fileId }`.
3. **Force path.** If `force === true` and Show Notes Doc exists: trash existing doc, clear `manifest.show_notes`, audit-log `SHOW_NOTES_FORCE_DELETE`.
4. **Verify Index v2.** Read `manifest.episode_index_v2`. If unset, throw — Track A must run first.
5. **Read inputs:**
   - Episode Index v2 (full doc body via `DriveApp.getFileById(...).getBlob().getDataAsString()` for markdown, or `DocumentApp.openById(...).getBody().getText()` per Track A's file format — match what Track A wrote).
   - Brand Voice doc (governance key `BRAND_VOICE_ID`, full text).
   - Content Sensitivity doc (governance key `CONTENT_SENSITIVITY_ID`, full text).
   - Guest Brief — resolve via Contact_ID → Contacts row → guest brief Drive ID if stored, else skip (best-effort). Match how the existing pipeline locates it.
   - Master Template "PASS 1: EPISODE CARD" structure via `extractPrompt("PASS 1: EPISODE CARD")` or equivalent existing call.
6. **Build Claude prompt.** Use the existing prompt scaffolding pattern (system + voice authority + voice prohibitions + template structure + inputs). Key replacements vs. existing pass:
   - **Input source label:** "EPISODE INDEX V2" instead of "FINISHED TRANSCRIPT."
   - **No truncation.** Send the full Index. Strike any `substring(0, 25000)` truncation logic — Index is curated, intentional, and within budget.
   - **Directive line:** "You are reading a curated Episode Index, not a raw transcript. The Index has been organized by editorial markers — vulnerability, narrative pivots, distinctive phrasing, emotional peaks, reframing language, concrete anecdotes, wisdom statements, speaker dynamics, callbacks, and topic boundaries. Use it. Trust the markers. Find the moments that will make someone stop what they are doing and listen."
7. **Call Claude.** Single call. Existing `callClaudeAPI` (or whatever current helper). Use the highest-context model variant available per `CLAUDE_MODEL` config. If existing helper has token-cap issues, either bump the helper's cap or pass through a per-call override.
8. **Write Show Notes Doc.**
   - Create Google Doc via `DocumentApp.create(...)`. Filename: `Show_Notes_{epUid}_{guestNameSlug}.gdoc` (or whatever the existing pipeline pattern is — match exactly).
   - Set body text to Claude's response, preserving paragraph breaks per existing pattern.
   - Move file to episode's Staging folder (match existing `moveTo` pattern).
   - Save and close.
9. **Manifest write.** Set `manifest.show_notes = <new doc ID>` on Episodes row.
10. **Audit log.** `SHOW_NOTES_GENERATED_V2` with metadata: epUid, fileId, sizeChars, claudeMs (latency).
11. **Return.** `{ status: 'generated', fileId, fileName, sizeChars, claudeMs }`.

### Error handling

- Episode row missing → throw `Error('runEditorialPass: episode not found: ' + epUid)`.
- `manifest.episode_index_v2` missing → throw `Error('runEditorialPass: Episode Index v2 not built — run buildEpisodeIndexV2 first')`.
- Brand Voice doc / Content Sensitivity doc unreadable → log warning, continue with empty placeholder (`callClaudeAPI` should fall back to its built-in voice authority string, per existing pattern).
- Guest Brief missing → continue without it (best-effort).
- Master Template unreadable → throw `Error('runEditorialPass: Master Template not accessible')`.
- Claude call fails after retries → throw, no doc created, no manifest update.
- Doc creation/write fails → throw, manifest not updated.

---

## Prompt Construction (Reference Shape)

Match the existing pipeline's structure. Key sections, in order:

```
[System / Voice Authority block — pulled from Brand Voice doc, or default fallback string from existing helper]

[Voice prohibitions — pulled from existing pattern; do NOT redesign]

[REQUIRED EPISODE CARD STRUCTURE (from Master Template) — verbatim extractPrompt output]

CRITICAL OUTPUT RULES:
- The template above is your exact required structure. It is not a suggestion.
- Every ALL CAPS line ending in a colon is a required section heading. Output it verbatim, then complete that section per its instructions.
- Work through every section in order. Do not skip any. Do not add any sections not in the template.
- Write in plain prose. No JSON. No markdown. No asterisks. No code fences.
- This output will be written directly to a Google Doc. Do not add preamble, sign-off, or commentary.
- Start immediately with the first section heading.

[User prompt:]

Build the complete audience-facing content package for this episode.

GUEST: {guestName}
EPISODE UID: {epUid}
RELEASE DATE: {releaseDate}

GUEST BRIEF (Concierge Research):
{guestBriefText OR "Not available — work from the Episode Index."}

CONTENT SENSITIVITY GUIDE:
{contentSensitivityText}

EPISODE INDEX V2:
{episodeIndexV2FullText}

You are reading a curated Episode Index, not a raw transcript. The Index has been organized by editorial markers — vulnerability, narrative pivots, distinctive phrasing, emotional peaks, reframing language, concrete anecdotes, wisdom statements, speaker dynamics, callbacks, and topic boundaries. Use it. Trust the markers. Find the moments that will make someone stop what they are doing and listen.

Surface the Medicine. Write copy that earns trust, not clicks. Complete every section.
```

Voice authority and prohibitions come from existing patterns — do not redesign.

---

## Idempotency and Force Flag

| State | `force=false` | `force=true` |
|---|---|---|
| `manifest.show_notes` unset | Generate. | Generate. |
| `manifest.show_notes` set, file exists | Skip. Return `{status: 'skipped_exists', fileId}`. | Trash existing file, clear manifest, regenerate. Audit-log `SHOW_NOTES_FORCE_DELETE`. |
| `manifest.show_notes` set, file missing in Drive | Treat as unset. Generate. Audit-log `SHOW_NOTES_MANIFEST_REPAIR`. | Same — generate. |

Episode-level granularity. Partial-section regeneration is not supported in this spoke.

---

## Dev Tools Wrapper

Add to `dev_tools.js`:

```javascript
/**
 * Manual test wrapper for runEditorialPass.
 * Usage: test_runEditorialPass('EP-260512-1430', { force: true })
 */
function test_runEditorialPass(epUid, opts) {
  opts = opts || {};
  const result = runEditorialPass(epUid, opts);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
```

No trigger registration.

---

## Constraints

- **No transcript reads.** Episode Index v2 is the source.
- **No Vertex / Vert calls.** Index is already retrieved.
- **No truncation.** Send the full Index to Claude. Strike `substring(0, 25000)` patterns if mirroring existing scaffolding.
- **No Asset_Library writes.** Track C.
- **No modification to `runVertFairy`, `runArtistFairy`, old passes.** Add-only.
- **No redesign of voice authority or prohibitions.** Match existing pattern exactly.
- **All sheet access via `getMasterSheetId()`.**
- **All config from Governance_Config.** No hardcoded IDs.
- **Master Template is the prose authority.** Do not embed section instructions into code; rely on `extractPrompt`.

---

## Verification (Post-Build, Pre-Push)

1. Read the new function back. Confirm:
   - Reads `manifest.episode_index_v2`, not `manifest.episode_index`.
   - Single Claude call. No looping over passes.
   - No transcript references anywhere in the function.
   - Force flag deletes existing doc and re-runs.
   - Audit logs fire on generate, on force-delete, on errors.
   - Output written to staging folder, doc ID on `manifest.show_notes`.
2. Confirm no existing function was modified.
3. Confirm `dev_tools.js` wrapper does not register a trigger.
4. Confirm `extractPrompt` is called with the correct Master Template section identifier — match existing pattern verbatim.

---

## Clasp Push Checkpoint

After implementation and verification:

```
clasp push
```

Surface back to Hub with:
- File diff summary (which files touched, new function lines added).
- Confirmation that no existing function bodies were modified.
- Any read-first uncertainty hit (e.g., existing Claude helper signature, Brand Voice doc structure, Master Template section name not matching).
- Token estimate from a dry run if cheap to obtain.

Audra runs `test_runEditorialPass('EP-<david-uid>', { force: true })` against David's episode (Track A must have run first to produce his Index v2). She inspects the resulting Show Notes Doc against Master Template v2.1 — counts correct (10 hooks, 6 guest quotes, no host quotes), new sections present (YT DESCRIPTION, both STARTER CAPTIONS), voice on-brand.

---

## Out of Scope (Explicit)

- Pipeline wiring changes — old Vert passes still fire on `dailyPulse` until cleanup spoke.
- Artist Fairy retirement — separate cleanup spoke.
- Asset_Library writes — Track C.
- UI surfaces — none affected.
- Master Template editing — done manually by Audra (patch doc separate).
- Brand Voice / Content Sensitivity / Guest Brief redesigns — none.

---

*Spoke prompt — May 14, 2026. Track B of Vert → Claude → Bridge day plan.*
