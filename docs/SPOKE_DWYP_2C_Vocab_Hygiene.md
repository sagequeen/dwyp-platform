# SPOKE 2-C — Vocab Hygiene: Enum Trim (D6) + Workflow_Step Inventory (D7)
STATUS: ready for Code — confirm-dead before any trim; surface back if anything is live

**Mode:** Spoke. Read fully before writing.
**Mandate:** Code Integrity Mandate. Enum values and schema-shaped reads are load-bearing. Confirm dead before removing anything.
**Source decisions:** `PROPOSAL_DWYP_Schema_Reckoning.md` §2, §3, §6, §15 (D6, D7), §16 Phase 2.
**Deployment note:** `/dev` exercises production data.

## Why this spoke exists

Enum drift across tabs (Reckoning §2, §3, §6): undocumented/unused values blur the schema and block closed-enum data validation (kit test). Two decisions ride together because both are vocabulary hygiene.

---

## Part A — D6 enum hygiene

### A1. `Contacts.Source` — legalize `quick_add`
Live value `quick_add` is not in the documented enum (`form | manual`). It is a real value the QuickAdd path writes. **Legalize it** — it's a doc/validation fix, not a code change. (Audra hand-step + Phase 3 doc.) Code action: confirm the writer that emits `quick_add` and report its call site so the doc records it accurately.

### A2. `Episodes.Episode_Type` — fix values
All live rows say `standard`; documented enum is `guest | roundtable | solo`. One is wrong. **Confirm which is intended** (almost certainly the documented set; `standard` is the drift). Code action: find the writer of `Episode_Type` and report what it emits and where. Do **not** mass-rewrite live data — value correction is an Audra hand-step once the intended set is confirmed. If code writes `standard` literally, that write is the bug to fix (Code, CIM-gated).

### A3. Confirm-dead-then-trim: `Asset_Library.Status = bank`, `Availability = paired`, `Slide_Index`
All three appear nowhere in live data; `Slide_Index` is never populated though Slide_Index pairing is a locked AD.
- **Inventory first.** Grep every read/write/branch referencing `bank`, `paired`, and `Slide_Index` (constant + `indexOf`).
- If **truly unexercised**: logically retire — remove dead code branches handling `bank`/`paired`; **leave the `Slide_Index` column physically in place** (positional-read landmine — do not delete the column). Enum-value removal from sheet data validation is an Audra hand-step.
- If **any path is live** (esp. Slide_Index pairing in `materializeQuoteGraphicAssets` or placement): **stop, surface back.** Do not trim a load-bearing AD without a hub decision.

---

## Part B — D7 `Workflow_Step` inventory (catalog only, NO validation)

`Workflow_Step` is an open vocabulary (AD #23) that now routes behavior (`GENERIC_COMPLETE_STEPS`, `BK_POD_SPECIAL_STEPS`). Live values drift beyond AD #23: `Intake`, `Scheduling`, `Errors`, `Upload_Raw_Assets`.

- **Produce a complete catalog** of every `Workflow_Step` value the code writes (grep all `spawnTask`/Workflow_Step write sites) and every value live data contains. One table.
- **No hard validation, no enum enforcement this spoke** (D7 = inventory first). Output feeds command-center categories and the future closed-vocabulary decision.
- Flag any value that routes in `GENERIC_COMPLETE_STEPS`/`BK_POD_SPECIAL_STEPS` vs. those that fall to "no completion affordance" by design.

## Scope

**In scope:** the inventories above; legalizing `quick_add` (report); dead-branch removal for confirmed-dead `bank`/`paired`; reporting `Episode_Type` and `Slide_Index` findings.
**Out of scope:** any physical column delete; mass live-data rewrites (Audra hand); closing the `Workflow_Step` vocabulary; trimming anything found live.

## Audra hand-steps (not Code)

- Legalize `quick_add` in `Contacts.Source` data validation.
- Correct `Episode_Type` live values once intended set confirmed.
- Remove `bank`/`paired` from Asset_Library data validation if Code confirms dead.

**Clasp checkpoint:** deliver the two inventories + `Episode_Type`/`Slide_Index` findings in-thread first (largely read-only). Push only the confirmed-dead branch removals → verify on `/dev` → surface back. Audra promotes to `/exec`.

## Acceptance

- `Workflow_Step` full catalog delivered (code-written + live values, routing flags).
- `quick_add` writer confirmed and reported.
- `Episode_Type` writer reported; intended enum confirmed with Audra.
- `bank`/`paired`/`Slide_Index` each confirmed dead-or-live; dead branches removed, `Slide_Index` column left physical; anything live surfaced back, untouched.

## Closeout

Capture in State; `STATUS:` → `COMPLETE — safe to delete`, leave in `docs/`. Phase 3 doc-sync: Reference enums updated (`quick_add` legalized, `Episode_Type` corrected, dead values dropped); `Workflow_Step` catalog routed to Governance_Config candidate list (closing the vocab is a later decision).
