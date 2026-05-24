# DWYP — Index Audit Design

**Status:** Hub-locked design. Ready for spoke.
**Owner:** Audra (architecture), Claude Code (implementation)
**Companion docs:** `DWYP_Platform_State.md`, `DWYP_Platform_Reference.md`, `DWYP_Codebase_Map.md`, `DWYP_Master_Template_v2-4.md`

---

## Purpose

Insert an automated accuracy audit between Claude's index generation (Track A) and downstream content generation (Tracks B and C). Catches factual errors, misattributed quotes, and unsupported attributions of intent/motivation/causation before they propagate into show notes, hooks, quotes, captions, or any other downstream surface.

Originating failure mode: Carson-shaped synthesis errors — content that is factually adjacent to the transcript but inverts or fabricates meaning by attributing intent the speaker did not express. ("Carson asked God to give him cancer" as a misreading of "Carson was glad it was him, not a family member.")

---

## Architecture Role Split

Each model used for what it is good at:

- **Claude** — synthesis, nuance, voice work. Writes the index. Writes the editorial pass. Writes hooks/quotes.
- **Gemini** — research, literal source-checking, methodical verification. Audits the index.
- **Vertex AI RAG Engine** — retrieval substrate for the auditor. Provides corpus-grounded chunks independent of the injected transcript Claude saw during Track A.

Independence holds because the auditor (Gemini) reads a different representation of the same source (Vertex-retrieved chunks from the corpus) than the generator (Claude) read (directly-injected transcript). Real cross-check, not self-check.

---

## Pipeline Flow

```
RAW TRANSCRIPT (Drive, staging folder)
  ↓
TRACK A — Claude builds Episode Index v2
  Manifest phase: index_pending → index_complete
  ↓
AUDIT — Gemini audits the index
  Reads: index doc + Vertex retrieval (filtered to this epUid)
  Writes: appends "## Audit Findings" section to the index doc
  Spawns: Review_Index_Audit task
  Manifest phase: index_complete → audit_pending_review
  ↓
HITL GATE — JT/Audra reviews audit findings
  Action: task completion = approval to proceed
  Manifest phase: audit_pending_review → audit_reviewed
  ↓ (next dailyPulse)
INDEX REVISION — Claude produces clean revised index
  Reads: annotated index + audit findings (severity-weighted)
  Re-reads transcript only if any finding marked CRITICAL
  Writes: revised index doc (new file, original preserved as audit history)
  Manifest phase: audit_reviewed → index_revised
  ↓
TRACK B — Claude editorial pass against revised index
  ↓
TRACK C — Claude hooks/quotes against revised index, populates Asset_Library
```

Future evolution (post-trust): HITL becomes notification only. Pipeline advances regardless on next pulse. Manifest phase transitions remain the same; only the task semantics change.

---

## Locked Design Decisions

| Decision | Value |
|---|---|
| Audit surface | Every factual claim, every attributed quote, every characterization of intent/motivation/causation in the index |
| Audit model | Gemini via `callGeminiAPINoSearch()` |
| Retrieval substrate | Vertex AI RAG Engine, filtered to `epUid` metadata |
| Output shape | Appended `## Audit Findings` section at bottom of index doc |
| Location anchor | First 6–10 words of the audited sentence/section + line number if available |
| Pipeline insertion | Automatic after Track A; gates Track B/C |
| HITL gating | Task completion required to advance manifest phase |
| Failure handling | Claude revises index using audit findings; re-reads transcript only on CRITICAL severity |
| Clean revised index | New doc, original annotated index preserved as audit history |

---

## Severity Criteria (for Gemini auditor prompt)

**CRITICAL** — Claude must re-read transcript when revising:
- Factual contradiction (date, name, event, sequence)
- Misattributed quote (assigned to wrong speaker, or wording materially altered)
- Unsupported attribution of intent, motivation, or causation
- Inverted meaning (Carson-shaped errors — content that flips the sense of what was said)

**NON-CRITICAL** — Claude applies correction without re-reading transcript:
- Minor characterization drift
- Soft inferential leaps that don't change meaning
- Missing nuance or qualifier
- Tone or framing adjustments

---

## Audit Findings Format

Appended to index doc as a structured markdown section. JT/Audra reviews top-to-bottom.

```
## Audit Findings

### Finding 1 — CRITICAL
**Location:** Line 47, "Carson asked God to give him cancer..."
**Index claim:** Carson asked God to give him cancer so his family wouldn't have to suffer.
**Verdict:** CONTRADICTED
**Source says:** Carson expressed gratitude that he was the one with cancer rather than a family member. No statement of having asked or prayed for the diagnosis.
**Citation:** "I'm just glad it was me. I couldn't have watched [family member] go through this." (Vertex chunk, transcript line ~1340)
**Suggested correction:** Carson expressed relief that the diagnosis fell on him rather than a family member.

### Finding 2 — NON-CRITICAL
**Location:** Line 112, "After years of struggling..."
**Index claim:** Guest described decades of struggle before the turning point.
**Verdict:** UNSUPPORTED
**Source says:** Guest describes "years" without specifying duration. "Decades" is auditor inference.
**Citation:** "I spent years before I figured out..." (Vertex chunk, transcript ~3200)
**Suggested correction:** Replace "decades" with "years."

### Audit Summary
- Total findings: 2 (1 critical, 1 non-critical)
- Recommended action: Critical finding requires transcript re-read on revision.
```

Format is fixed at the Gemini prompt level so the downstream revision step can parse it reliably.

---

## Track A Prompt Revision (Master Template)

Track A's current prompt allows characterization. The audit is a safety net; the upstream fix is tightening Track A to extract rather than interpret.

**Principle to add to Master Template, Track A section:**

> **Extract, do not interpret.** Capture what speakers say in language close to their own. Speakers' interpretations of their own experience belong in the index — they own those. Auditor interpretations of speakers' experiences do not. Specifically, do not attribute intent, motivation, or causation that the speaker did not express in their own words. If the speaker said "I'm glad it was me," the index records that; it does not record "the guest asked for it" or "the guest welcomed the diagnosis."

> Synthesis and characterization happen downstream in Track B and Track C, where voice transformation is the point. The index stays neutral.

This is the same definition-first move v2.4 applied to Hooks, now applied upstream to the index itself.

---

## New Files / Functions / Schema

### `vert_fairy.js` — new function

`runIndexAudit(epUid, opts)`
- Reads: Episode Index v2 doc + episode_manifest
- Vertex retrieval per claim, filtered to `epUid`
- Gemini call per claim batch (one call per audit run, claims passed as structured input)
- Appends `## Audit Findings` section to index doc
- Spawns `Review_Index_Audit` task
- Patches manifest: `index_complete → audit_pending_review`
- Logs to Audit_Trail

### `vert_fairy.js` — new function

`reviseIndexFromAudit(epUid, opts)`
- Reads: annotated index + audit findings + (conditional) full transcript
- Loads transcript only if any finding marked CRITICAL
- Claude call: applies corrections, produces clean revised index doc
- Writes: revised index as new file in index folder; original retained
- Patches manifest: `audit_reviewed → index_revised`
- Triggers Track B

### `fairy_circle.js` — daily pulse loop addition

New phase transitions in dailyPulse:
- `index_complete` → fire `runIndexAudit()`
- `audit_reviewed` → fire `reviseIndexFromAudit()`
- `index_revised` → fire `runEditorialPass()` (Track B)

### New task type

`Review_Index_Audit`
- Spawned by `runIndexAudit()`
- Completion advances manifest from `audit_pending_review` to `audit_reviewed`
- Link to annotated index doc included in task body

### Episode manifest — new phase states

- `audit_pending` (transitional, audit running)
- `audit_pending_review` (audit complete, HITL gate)
- `audit_reviewed` (HITL approval given)
- `index_revised` (clean revised index produced, ready for Track B)

### Governance_Config — new keys

| Key | Purpose | Default |
|---|---|---|
| `AUDIT_MODEL` | Gemini model name for audit | `gemini-2.5-pro` (verify current) |
| `AUDIT_RETRIEVAL_TOP_K` | Chunks per Vertex query | `5` |
| `AUDIT_CRITICAL_TRIGGERS_RETRANSCRIPT` | Whether CRITICAL severity forces transcript re-read on revision | `true` |

### Master Template additions

- `# Track A — Extract Not Interpret` section (principle stated above)
- `# Index Audit Prompt` section (Gemini auditor prompt, severity criteria, output format spec — all template-controlled per platform pattern)

---

## Dependencies / Viability Flags

**Major dependency — corpus metadata filtering by epUid.** Gemini's audit independence requires Vertex retrieval to return chunks from *this episode only*. Other episodes will contain semantically similar passages ("I had cancer," "I was glad," "my family") that could falsely support or contradict a claim if retrieved.

**Verification step before spoke opens:** Run one Vertex retrieval call against a known claim from Carrie's episode with `epUid` filter clause. Confirm:
1. Filter syntax works on current corpus
2. Returned chunks are all from Carrie's transcript
3. Chunk metadata includes line/position reference for citation anchoring

**If filter doesn't work:** Prerequisite fix is re-tagging or re-importing transcripts with `epUid` metadata. Owner: Audra. Approx 30 min if corpus tooling cooperates.

**Minor dependency — Master Template patch order.** Track A prompt revision belongs in the same patch cycle as v2.4. Audit prompt is a new section. Both should land before the spoke fires so the audit has its template-controlled prompt to extract.

**Uncertainty — Gemini model selection.** `gemini-2.5-pro` is the candidate (matches the corpus parser). `gemini-2.5-flash` is cheaper but may under-flag. Worth running both against Carrie's index as a calibration pass once the audit function is built and decide based on output quality.

**Risk — over-flagging.** Gemini's literal posture is the audit strength but may produce noise on benign characterizations. First-month operational pattern: review every audit, calibrate severity criteria in the Master Template based on what you actually want flagged vs. ignored. Treat the first ~5 episodes' audits as calibration data.

---

## Build Sequence

1. **Verification (Audra, 5 min):** Vertex retrieval call with `epUid` filter. Confirm metadata supports the filter.
2. **If verification fails:** Re-tag/re-import transcripts with `epUid` metadata. Spoke for this.
3. **Master Template patches:** Track A "extract-not-interpret" principle + new `# Index Audit Prompt` section. Hub artifact, paste into live doc.
4. **Governance_Config:** Add `AUDIT_MODEL`, `AUDIT_RETRIEVAL_TOP_K`, `AUDIT_CRITICAL_TRIGGERS_RETRANSCRIPT`.
5. **Spoke 1 — Audit function:** Build `runIndexAudit(epUid, opts)` in `vert_fairy.js`. Test against Carrie's existing index (which contains the known Carson error).
6. **Spoke 2 — Revision function:** Build `reviseIndexFromAudit(epUid, opts)`. Test on Carrie's audited index.
7. **Spoke 3 — Pipeline wiring:** dailyPulse phase transitions, task type, manifest phase states. Test full flow on next episode (Dr. Meenakshi Aggarwal).
8. **Calibration window:** First 5 episodes run with manual review of every audit. Tune severity criteria in Master Template.
9. **Trust transition (future):** Once calibrated, task becomes notification only.

---

## Lift Assessment

**Medium.** Three function additions, three manifest phase states, one new task type, two new Master Template sections, three new governance keys. No new infrastructure — reuses `callGeminiAPINoSearch()`, existing Vertex RAG helpers, existing task/manifest/dailyPulse patterns.

Riskiest single item is the corpus metadata filter dependency. Resolve that first, before any spoke opens. If it's clean, the rest is straightforward.

---

## Open Items

- [ ] Verify Vertex corpus supports `epUid` metadata filter
- [ ] Confirm `gemini-2.5-pro` is current Gemini model string (or whatever has superseded it)
- [ ] Decide on revised index file naming convention (`EpisodeIndex_v2_{EUID}_revised.gdoc`?)
- [ ] Confirm whether annotated original index lives in index folder or moves to an audit history subfolder
