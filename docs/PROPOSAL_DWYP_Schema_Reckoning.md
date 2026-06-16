# PROPOSAL — DWYP Schema Reckoning
STATUS: exploring

**Source basis:** Live Master Sheet synced 2026-06-12 (all tabs) vs `DWYP_Platform_Reference.md` v3.7 schema + `CLAUDE.md` + `DWYP_Platform_State.md` v7.9.
**Scope (per hub session 2026-06-12):** the sheet first. Schema review, all tabs — statuses that don't make sense, duplicates, removable columns, AppSheet-era ghosts.
**Out of scope (this pass):** datastore migration, app shell. Code-level **normalization** (actor naming, script boundaries) added as an audit/decision track 2026-06-12 (§14) — findings and decisions only; no code changes in this doc.
**Kit lens (added 2026-06-12):** every decision carries the kit test from `PROPOSAL_DWYP_Deployable_Kit.md`: *could the provisioning wizard produce this state, and could an assistant maintain it?*
**North star (Audra, 2026-06-14):** the Reckoning hardens the source of truth — sheet schema, tabs, safeguards, model control — into a **deployable product**. DWYP's own features are enhancements built on top, not Reckoning scope.

---

## 0. Headline Findings (read these first)

| # | Finding | Severity |
|---|---|---|
| H1 | **API keys stored as plaintext sheet values.** `CLAUDE_API_KEY` and `GEMINI_API_KEY` live in Governance_Config — readable by anyone with sheet access, and they travel with every sheet sync/export (including AI-context syncs like today's). User_Registry PINs same class. | Security — **rotation decided 2026-06-14 (rotate both now, Audra hand-step)**; keys stay in Governance per D5; move-to-Script-Properties declined |
| H2 | **URL half RESOLVED (2026-06-13, Manage Deployments).** Truth: production `/exec` = `AKfycbyz…ENlR2wxT` (CLAUDE.md already correct); dev/head `/dev` = `AKfycbwHRxyQ…hMxm0`. **Routing reads NONE of these URLs** — `getMasterSheetId()` keys off Script Property `MASTER_SHEET_ID` (→ prod sheet `1p5ahHe…`) and `isStaging()` reads only `STAGING_DEPLOYMENT_URL` (blank → always production). So the three-way conflict was cosmetic, never a live hazard. Fixes (Phase 1): correct Governance `PRODUCTION_DEPLOYMENT_URL` `AKfycbzC…`→`AKfycbyz…`; the stale Reference `Web App URL` (`AKfycbxJ…`) dies with the Reference tab (D3). **Still open (dormant):** `STAGING_SHEET_ID` conflict (Governance `1ymUhwuy…` vs CLAUDE.md `13bXMjxEf…`) — irrelevant while staging is off, but must be reconciled before `STAGING_DEPLOYMENT_URL` is ever wired, or `getMasterSheetId()` fails closed to prod and a "sandbox" writes live. | Integrity — URL half resolved; staging-sheet-ID deferred |
| H3 | **Two undocumented tabs (`Reference`, `Social_Posts`)** carrying a legacy episode/contact identity universe, conflicting deployment IDs, orphaned 20-col Asset_Library rows with the retired Quality_Score/Slot_Tags data, and a pre-launch campaign calendar. Classic AppSheet-era sediment. | Cruft — quarantine |
| H4 | **Duplicate state axes on Episodes.** `Status` (six-state) and `Video_Status` (pending/approved/revision_requested) describe the same review gate from two directions. | Schema design — core reckoning item |
| H5 | **Live sheet has drifted ahead of Reference v3.7** — Episodes 15 cols (doc says 14), Episode_Log 12 (doc says 10), Versions 12 domains (doc says 11), multiple enum values undocumented. | Doc drift — sync after decisions land |
| H6 | **Resolved (2026-06-12):** "shell" = AppSheet-era `max-width: 480px` on `#app`, retiring in Phase 3.1 shell re-layout. CSS ghost, not a live AppSheet app. One-time AppSheet account check (no app still bound to this sheet) remains cheap insurance. | Resolved — minor verify |

---

## 1. Tab Inventory

| Tab | In Reference v3.7? | Verdict |
|---|---|---|
| Contacts | Yes | Keep — findings §2 |
| Episodes | Yes | Keep — findings §3 |
| Tasks | Yes | Keep — findings §4 |
| Episode_Log | Yes | Keep — findings §5 |
| Asset_Library | Yes | Keep — findings §6 |
| Social_Assets | Yes | Keep — redesign question §7 |
| Posting_Schedule | Yes | Clean — matches doc |
| Audit_Trail | Yes | Keep — minor finding §8 |
| Versions | Yes | Keep — doc drift §9 |
| Governance_Config | Yes | Keep — key audit §10 |
| User_Registry | Yes | Clean — PIN note in H1 |
| **Reference** | **No** | Disperse + delete §11 |
| **Social_Posts** | **No** | Archive out §12 |

---

## 2. Contacts (23 cols — header matches doc)

| Finding | Detail |
|---|---|
| Enum drift: `Source` | Live value `quick_add` not in documented enum (`form \| manual`). Legalize in doc or remap. |
| `Relationship_Type` nearly empty | 1 of 17 rows populated. AD #44 makes this the role authority; the data doesn't express it. Roundtable contact lacks `Relationship_Type = Roundtable` despite AD #42. Backfill or accept it as decorative. |
| `Influence_Tier` nearly empty | Only Carrie (EH). Same question: load-bearing or decorative? |
| Sentinel-in-data | `Bio_Summary` doubles as a status field: "Enrichment Pending" (Carrie), Herald failure prose ("cannot be definitively identified…" — Aggarwal, Test QuickAdd), markdown artifacts ("**Bio_Summary:**" prefix). An AppSheet-style hack: generated content and its status share one cell. Candidate: enrichment status is expressed by tasks only, and Bio_Summary is either real content or blank. |
| Test rows | 3 rows (`Test Contact DWYP`, `Test QuickAdd DWYP`, `Test NameOnly DWYP`) — purge. |

## 3. Episodes (15 live cols vs 14 documented)

| Finding | Detail |
|---|---|
| **Undocumented col 15: `Upload_Started_At`** | Written by Episodes_Writer (upload-stale detection, pairs with `UPLOAD_STALE_MINUTES`). Reference schema not updated. |
| **Duplicate state axes (H4)** | `Status = review` and `Video_Status` cover the same gate. AD #123's lifecycle narrative (upcoming → in_production → ready_to_release → live → archived) omits `review`, but the schema enum and live data both use it. Derek bounced ready_to_release → review while `Video_Status` sat at `pending` throughout — the two axes don't even agree mid-flow. Consolidation candidate: one lifecycle, revision state derived from open `Revise_Episode` tasks (consistent with "Pending Is Derived, Not Stored"). |
| `Episode_Sequence` | Populated only on 4 archived rows. GAS never writes; display rank is computed from release order. Candidate for removal. |
| Date typing | `Release_Date` stored as `19-May`-style strings; `Recording_Date` as full datetimes. AppSheet-era formatting artifact — any sort/compare depends on Sheets' parse mood. Normalize to real dates. |
| Data quality | Carrie `Recording_Date` = 4/29/**2024** (wrong year). Mai Vo = 10/22/2025 (predates the pipeline — re-used calendar event?). |
| `Episode_Type` enum | All rows say `standard`; documented enum is `guest \| roundtable \| solo`. One of them is wrong. |

## 4. Tasks (18 cols — matches doc)

| Finding | Detail |
|---|---|
| `Workflow_Step` open vocabulary drifting | Live values not in AD #23: `Intake`, `Scheduling`, `Errors`, `Upload_Raw_Assets`. This now matters more than it used to: `GENERIC_COMPLETE_STEPS` and `BK_POD_SPECIAL_STEPS` route on these strings. Unknown steps fall to "no completion affordance" by design — but the vocabulary should be closed (Governance_Config list) or at least centrally inventoried. |
| Error-task re-spawn | "Pipeline error: Adam Meyer — Track A" spawned fresh 6/10, 6/11, 6/12 (each completed, then re-spawned next pulse). Idempotency check ("one open task per condition") not applied to the `Errors` step, or completion is treated as resolution when the underlying condition (missing transcript) persists. Behavior finding — queue for a spoke, not a schema change. |
| `Completed_At` typing | Date-only strings ("6/11/2026") vs full timestamps elsewhere. Minor; normalize when touched. |

## 5. Episode_Log (12 live cols vs 10 documented)

| Finding | Detail |
|---|---|
| Undocumented cols 11–12 | `Resolved_At`, `Resolution_Note` — in live header, absent from Reference. |
| `Author` mixed identity scheme | Persona names (`Herald`) and emails (`audra@…`) in one column. Decide one scheme. |
| `Revision_Round` unpopulated | Present in schema (added for rail grouping) but blank in all live rows — revision entries may be writing elsewhere or the column is dormant. Verify writer. |

## 6. Asset_Library (18 cols — header matches doc)

| Finding | Detail |
|---|---|
| **Orphan col-19 data** | At least one row (Guest Quote 4, Aggarwal, `rejected`) carries a 19th value past `Created_By` — residue from the Quality_Score/Slot_Tags column deletion. Sweep all rows for stray data beyond col 18. |
| Two coexisting row formats | Carrie-era rows: `Hook: <text…>` Display_Names + JSON-array `Caption_Host` (retired 3-variant format). Current rows: `Hook N` + plain-string captions. Documented as inert, but every `Caption_Host` consumer must handle both shapes forever, and the legacy `Hook:` prefix already miscounts in the Track C gate. Decide: migrate, archive, or formally accept. |
| Unused enum values | `Status = bank` and `Availability = paired` appear nowhere in live data. `Slide_Index` never populated — Slide_Index pairing (locked AD) appears unexercised. Confirm still load-bearing or trim. |
| Junk row | `d8fb7a9e…` (Elizabeth, created_by `jt`): empty Display_Name, empty quote, empty canvas. UI allowed a blank asset commit. Purge row; note UI guard for later. |
| Cell-size pressure | Reel rows carry full Gemini analysis essays in `Reel_Transcript`/`Reel_Summary` (multi-KB cells; Sheets cap is 50k chars/cell). Fine today; a known ceiling if analyses grow. |

## 7. Social_Assets (13 cols)

The one live row has `Asset_Type`, `Platform`, `Caption`, `Drive_File_ID` all empty and `Scheduled_At = Created_At`. The documented denormalization contract (cols 5–8 copied from Asset_Library) is not being written by the current Schedule-surface writer. No external posting integration is wired, so nothing is broken — but the schema describes a consumer that doesn't exist yet and a writer that doesn't honor it. **Make is cancelled; Outstand is the likely integration target (not yet locked). The Make-era denormalization assumptions are void — do not carry them forward.** Decide at Outstand-wiring time, against Outstand's actual needs: fix writers to honor a contract, or slim the tab to `Post_ID / Asset_Library_ID / Episode_UID / Slot / status` and let the integration resolve the rest by join.

## 8. Audit_Trail (7 cols)

One malformed write: `6/10 4:16:18 | DWYP_App | DERIVATIVE_SAVE | 755154ee…` — Asset_ID written into the `Episode_UID` column, event name into `Actor`. Single call site writing positionally wrong. Code finding; queue.

## 9. Versions

12 live domains vs 11 documented (`social_assets` added — State knows, Reference doesn't). `governance_config`, `brand_voice`, `playbook`, `content_sensitivity` frozen at version 0 since creation — no writer bumps them. Either wire their write paths or accept them as reserved rows; if a domain can change without a bump, the version contract is silently void for that domain.

## 10. Governance_Config — key audit

| Class | Keys | Action candidate |
|---|---|---|
| **Secrets (H1)** | `CLAUDE_API_KEY`, `GEMINI_API_KEY` | Move to Script Properties; **rotate both** (they have left the sheet via syncs). PINs: accept (low stakes) or move. |
| Conflicting facts (H2) | `PRODUCTION_DEPLOYMENT_URL`, `STAGING_SHEET_ID` | Verify against Apps Script Manage Deployments; fix sheet + CLAUDE.md to the one truth; delete Reference-tab copies. |
| Retired-feature ghosts | `SOCIAL_VERT_BUCKET` (Social Vert retired), `SAFETY_IMAGE_PROMPT_KEY` (Safety Fairy retired), `NOTEBOOK_STAGING`, `NOTEBOOKLM_LINK`, `PRECOMP_BACKGROUND_LIBRARY_ID` (pre-comp rankings retired), `SCHEDULING_LINK` (blank) | Keep/retire decision per key. `ARTIST_*_DECK_ID` ×3 — confirm Artist Fairy's current status first. |
| No-consumer keys | `CAPTION_SIGNOFF` (known State gap), `PULSE_RECORDING_REMINDERS_ENABLED`, `PULSE_RELEASE_REMINDERS_ENABLED` (permanent no-ops per AD #126) | Build the consumer (CAPTION_SIGNOFF) or delete. |

## 11. Reference tab — undocumented; three unrelated payloads

1. **Legacy registry:** a release plan keyed by *old-generation* Episode_UIDs (`EP-2603xx-…`) and Contact_IDs that match nothing in Contacts/Episodes. A parallel identity universe from the previous sheet build. Dangerous if any lookup ever scans it; dead weight otherwise. *(Audra confirmed 2026-06-12: the unmatched names — Angela Snow, Mahsa Darabi, etc. — are dummy data. No season plan to rehome.)*
2. **Deployment IDs/URLs** conflicting with Governance_Config (H2).
3. **Orphaned 20-col Asset_Library rows** (Aggarwal hooks/quotes with Quality_Score + Slot_Tags values) — duplicates of rows that also exist in Asset_Library proper, preserving the deleted ranking data.

**Candidate disposition:** deployment facts → Governance_Config only; everything else → delete the tab outright.

## 12. Social_Posts tab — undocumented

Pre-launch campaign calendar (May 2026), manually managed, historical. No code readers known. Archive to Drive (or a standalone sheet) and remove from the operational Master Sheet.

---

## 13. Cross-Cutting Themes

| Theme | Instances |
|---|---|
| Duplicate/contradictory state | Episodes `Status` vs `Video_Status` (H4); manifest still writes `status: active` (retired enum — every Jason_Protocol audit line says "Status: active") while Episodes carries the six-state |
| Sentinels & open vocabularies | "Enrichment Pending" in Bio_Summary; `Workflow_Step` open vocabulary feeding allow-lists |
| Typing laxity | Dates as display strings (`19-May`), date-only timestamps, JSON-in-cells in two formats |
| Single-source-per-fact violations | Deployment URLs ×3, staging sheet ID ×2, season plan living in a cruft tab |
| Doc drift | Episodes, Episode_Log, Versions, enums (H5) — Reference v3.7 "Authority: live Master Sheet as of May 2026" is stale by its own definition |

---

## 14. Normalization Track — Fairy Language & Script Boundaries (added 2026-06-12)

Scope expansion per hub 2026-06-12: anything normalizable is a win. Two families. Both decision-gated — Code Integrity Mandate applies; no renames or file moves without a hub-approved map.

### 14a. Actor language

The Audit_Trail is the tell. Live `Actor` values are one open vocabulary mixing five naming schemes:

| Scheme | Live examples |
|---|---|
| Personas | `Herald`, `Secretary`, `Mending`, `The Fairy Team` |
| Subsystems | `Daily_Pulse`, `Jason_Protocol`, `Bridge_Fairy`, `Vert_Fairy_IndexV2`, `Vert_Fairy_Editorial` |
| Function names | `bumpVersion`, `completeFinalEpisodeUpload`, `requestEpisodeRevisions`, `generateReelCaption`, `SyncReelAssets` |
| Surfaces | `Studio`, `Contacts_Surface`, `Schedule_RemovePool`, `Show_Notes_Editor`, `Episodes_Writer` |
| App aliases | `DwypApp` **and** `DWYP_App` — both live |

Compounding findings:

| Finding | Detail |
|---|---|
| Column semantics vs Reference | Live usage: `Event_Category` holds the type enum (`human_action` / `state_change` / `error`), `Actor` holds the originator — Reference §Audit_Trail documents the inverse. Severity rides as `[INFO]` / `[WARNING]` text prefixes inside `Detail` while the `Level` column sits empty. Doc, code, and data are three different contracts. |
| Names assert retired architecture | `Vert_Fairy_IndexV2` / `Vert_Fairy_Editorial` call Claude with no Vertex in the critical path (ADs #97, #114). The name claims a retrieval layer the locked decisions removed. |
| Positional write bug | §8 malformed row (`DWYP_App` row with Asset_ID in the Episode_UID column) — open vocabularies hide positional bugs; a closed vocabulary makes them validation errors. |

### 14b. Script boundaries

| Finding | Detail |
|---|---|
| Kernel overload | `fairy_circle.js` owns routing, LLM calls, audit, task spawning, manifests, version stamps, ID generation, prompt extraction, chunking, **and** the `dailyPulse()` orchestrator. The orchestrator especially is a tenant in the kernel. Candidate split: infra (routing/versions/audit/IDs) · LLM (calls/prompt extraction/chunking) · pulse (orchestration). |
| Actors not in their files | Bridge (Track C) lives in `vert_fairy.js`; Mending lives in `housekeeping.js`. File name ≠ actor inventory — grep finds the file, not the fairy. |
| Husk files | `clerk_fairy.js` — `doPost()` with zero active routes (AD #24 rebuild queued); `artist_fairy.js` — one surviving function. Keep-as-seam vs fold, per file. |
| Catch-all backend | `dwyp_app.js` spans ~17 client-callable domains. Workable today; grouping is a normalization candidate, not a defect. |
| Same disease, UI-side | `.st-ep-*` prefix collision (already in CLAUDE.md What-Not-To-Do) — the naming problem isn't confined to server files. |

**Candidate principle (D15): one actor = one file = one audit name.** Cheapest-first execution: registry (doc-level) → audit-write normalization (one function) → renames (mechanical) → file moves (scoped spokes, each CIM-gated).

**Side finding:** `DWYP_Codebase_Map.md` v1.1 has drifted — still claims Episodes at 14 cols, Filing writing `Status = complete` (retired enum), and describes the Reference tab as "single-row config values." Add to Phase 3 doc sync.

---

## 15. Decision Queue (decisions captured 2026-06-14 below; D9 / D11 / D13–D15 open)

Kit test column = *could the provisioning wizard produce this state, and could an assistant maintain it?* (per `PROPOSAL_DWYP_Deployable_Kit.md`).

### Decisions — 2026-06-14 (Audra)

| # | Call | Execution note |
|---|---|---|
| D1 | Settled earlier — logical retirement | `Video_Status` logically retired; physical column-delete is a deferred audited spoke |
| D2 | **DEFERRED (2-A Stage 1, 2026-06-14)** — not retirable now | Premise corrected: `Episode_Sequence` is GAS-unwritten (AD #28) **but NOT reader-free** — live sort key (`getEpisodes`/`getActiveEpisodes`) + "EP N" display readers. Logical retirement is blocked until the rank-by-release-order replacement (State line 639, unbuilt half of Arrange decision #5) lands; only then do readers repoint and the column retires. Do NOT touch readers in 2-A. Physical removal stays in the later column-delete spoke, gated on this. |
| D3 | **Keep** `Reference` tab — Audra's scratchpad (NOT deleted) | Verify no code reads it (read-isolation); deployment facts single-sourced to Governance_Config |
| D4 | **Archive** `Social_Posts` out of Master Sheet | |
| D5 | **Declined (move)** — secrets stay in Governance, NOT moved to Script Properties. **Rotation decided separately (2026-06-14): ROTATE both now.** | Move-declined is Audra's risk call (2-person team). Rotation was never weighed on its own — it had ridden into the bin bundled with the move. Decoupled 2026-06-14: rotate both keys as damage control (they leaked via sheet syncs, H1), independent of where they live. BYO-key mechanism = MCL Governance role rows (role → provider + model + key-ref), not Script Properties. |
| D6 | **Yes** — enum audit then trim | Confirm `bank` / `paired` / `Slide_Index` dead first; legalize `quick_add`; fix `Episode_Type` |
| D7 | **Inventory first** | Catalog live `Workflow_Step` values; no hard validation yet; feeds command-center categories |
| D8 | **Defer to Outstand** (Make cancelled) | See §7 |
| D12 | **Evict** `Bio_Summary` sentinel → content-or-blank | O1 nightly sweep disabled (`MEND_O1_GUESTBIO_ENABLED=false`); Herald stops writing `Enrichment Pending`; enrichment cue handled on-demand + ShowNotes Resource Append (separate proposal) |
| D9 | **Archive** legacy Carrie-era Asset_Library rows | Episode archived; rows never re-enter chains; treat as inert so live consumers drop the dual-format burden |
| D13 | **Yes (full)** — actor registry + Audit_Trail semantics | One canonical name per actor; close actor vocab; fix inverted `Event_Category`/`Actor`; route severity to the `Level` column |
| D14 | **Yes — rename by role; SPLIT (2026-06-14)** | **D14a** (alias collapse `DwypApp`/`DWYP_App` + non-LLM actor honesty) = mechanical Phase 2b, ships now, no MCL dependency. **D14b** (LLM-calling actors `Vert_Fairy_IndexV2`/`_Editorial`) = gated on `PROPOSAL_DWYP_Model_Control_Layer.md` — they become role names (`EDITORIAL_WRITER` etc.), rename once. Resolves the §16-vs-handoff drift: D14 is not wholly mechanical, not wholly gated. |
| D15 | **Selective** — husks + principle; defer kernel split | Adopt one-actor=one-file as principle; resolve husk files (`clerk_fairy` empty, `artist_fairy` 1 fn); DEFER `fairy_circle.js` split + file moves |
| D10 | **After** — Phase 3 doc sync. Scoped as **kit template spec** (K5/W2), not doc hygiene: every col/enum must pass the kit test, not merely match the post-reckoning sheet. Bundles **Make→Outstand State capture** (Make cancelled; Social_Assets denorm assumptions void per D8) | One rewrite against settled state; authored against kit lens |
| D11 | **Verified — app IS bound** to prod sheet `1p5ahHe…`, but inert: no human use since April, **all bots are placeholders (no steps)** → no automated writes possible. **Disposition: unbind/delete** (data untouched; one programmatic actor on source of truth per kit north-star). NOT a Phase 2 gate — plain hygiene, batch with Phase 1 or defer. H6 fully closed | AppSheet writes bypass Audit_Trail — dormancy confirmed by placeholder bots + no human use, not by audit log |

Decision queue **fully closed (2026-06-14)**. Execution proceeds per §16.

| # | Decision | Default lean | Kit test |
|---|---|---|---|
| D1 | Consolidate Episodes review state: fold `Video_Status` into `Status`, derive revision state from open Revise tasks? | Yes — one lifecycle axis | **Pass required** — derived state needs no per-instance backfill; one axis to teach an assistant |
| D2 | Retire `Episode_Sequence` column? | Yes | One less hand-managed column in the runbook |
| D3 | Reference tab: delete outright? (dummy data confirmed; only deployment facts need rehoming to Governance_Config) | Yes — straight delete | Template carries zero cruft tabs |
| D4 | Social_Posts tab: archive out of Master Sheet? | Yes | Same |
| D5 | Secrets → Script Properties + rotate both API keys? | Yes — soonest | Doubles as the per-instance BYO-key slot (Kit W4) — one change, both purposes |
| D6 | Enum hygiene: legalize `quick_add`; fix `Episode_Type` values; trim `bank` / `paired` if confirmed unused | Audit-confirm, then trim | Closed enums become template data-validation — self-documenting for an assistant |
| D7 | Close the `Workflow_Step` vocabulary (Governance_Config list)? | Yes | Ships as Governance config = per-client vocabulary for free; respects the customization boundary (Kit K6) |
| D8 | Social_Assets: fix denormalization writers vs slim schema? | Defer to Outstand-wiring spoke (Make cancelled); decide against Outstand's needs | Kit tilts **slim** — smaller denormalization contract to honor per instance |
| D9 | Legacy Carrie-era Asset_Library rows: migrate, archive, or formally accept dual format? | Archive (episode is archived; rows never re-enter chains) | Kit-neutral — template starts empty; DWYP-only hygiene |
| D10 | Refresh Reference v3.7 schema now, or after reckoning changes land? | After — one rewrite, not two | Upgraded from doc hygiene to **mandatory**: the rewritten schema *is* the template spec (Kit K5/W2) |
| D11 | AppSheet account: one-time check that no app remains bound to this sheet | Verify (H6 resolved to minor) | Kit-neutral |
| D12 | Sentinel removal: Bio_Summary becomes content-or-blank; enrichment status lives in tasks only? | Yes | **Pass required** — a fresh instance cannot begin in a sentinel state; status must derive from tasks |
| D13 | Canonical actor registry: one name per actor across code identifiers, `Audit_Trail.Actor`, and prose; close the Actor vocabulary; fix Audit_Trail column semantics (live usage vs Reference, §14a) and route severity to `Level` instead of `Detail` prefixes | Yes — registry appended to Reference; vocabulary list in Governance_Config | Per-instance debugging is assistant work; a closed actor list makes N audit trails legible |
| D14 | Rename actors whose names assert retired architecture (`Vert_Fairy_*` call Claude, not Vertex — ADs #97/#114) and collapse aliases (`DwypApp` / `DWYP_App`) | Names first; file moves only per D15 | Misleading names are a tax on every operator who isn't Audra |
| D15 | Adopt **one actor = one file = one audit name**: split `fairy_circle.js` kernel (infra / LLM / pulse), relocate Bridge + Mending, resolve husk files, group `dwyp_app.js` domains | Adopt the rule; execute cheapest-first (§14b) — inventory spoke, then mechanical move spokes, CIM-gated | clasp multi-push (Kit W7) distributes whole files; clean boundaries = reviewable per-client diffs |

## 16. Proposed Sequencing (post-decisions)

| Phase | Contents | Breakage risk |
|---|---|---|
| 0 | Hub decisions (D1–D15), kit test applied per row | None |
| 1 | Non-breaking cleanup: D3, D4, D5, D11 + test rows, junk row, orphan col-19 sweep, data-quality date fixes + **H2 URL hand-edits** (Governance `PRODUCTION_DEPLOYMENT_URL` → `AKfycbyz…`; Reference `Web App URL` retired with the tab) | Low — no code reads these |
| 2 | Schema changes with code: D1, D2, D6, D7, D12 (+ Audit_Trail positional-write fix, error-task idempotency) — each its own spoke with Code Integrity Mandate scope | Medium — schema-shaped functions touched |
| 2b | Normalization: D13 registry + Audit_Trail semantics fix (cheap, early); **D14a** alias collapse (`DwypApp`/`DWYP_App`) + non-LLM actor honesty renames (mechanical, no MCL dependency — ship now); **D14b** LLM-calling actor renames (`Vert_Fairy_*`) **gated on MCL** (they become role names — rename once); D15 file moves last, each a scoped CIM-gated spoke — defer moves until v3 chrome work isn't competing for the same files | Medium — wide but mechanical; verification-mode inventory precedes every move |
| 3 | Doc sync: Reference schema rewrite (D10 — now the kit template spec), Codebase Map refresh (§14b side finding), CLAUDE.md URL corrections, Versions domain list | None |

---

*Open input needed from Audra: H6 ("Shell? 460?") — what do you remember, and does the AppSheet account still show an app bound to this sheet?*
