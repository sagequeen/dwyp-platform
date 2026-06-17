# PROPOSAL — Episode–Guest Cardinality (multi-part + roundtable)
STATUS: exploring; roundtable half NEAR-TERM (one episode recorded, one scheduled — 2026-06-14). Direction leans locked (appended columns). Schema/source-of-truth adjacent; not in the Reckoning execution arc, but time-pressured.

Root cause for both halves: the Episodes schema assumes **one episode ↔ one guest** (single `Contact_ID`, denormalized single `Guest_Name`). Two real cases break that assumption from opposite directions.

---

## Half A — Roundtable: one episode, two guests (NEAR-TERM)

> **Scoped into `SPOKE_DWYP_Roundtable_Cardinality.md` (2026-06-14, re-scoped same day)** — v1 = **Herald-driven auto-detection**: Secretary creates the episode + folder; Herald (LLM) reads the event title, matches guests to existing Contacts, sets the dual linkage + type. Manual entry **rejected** (Audra won't hand-materialize folders). Half B (multi-part) remains exploring here.

**Fact:** a roundtable is **always exactly two previous guests** — people already in Contacts with their own prior episodes. Today the schema flattens them into free-text `Guest_Name` and a single `Contact_ID`, discarding the structured link to both guests' profiles and histories.

**Legacy mechanism this retires (AD #42):** roundtable episodes currently point their single `Contact_ID` at a **permanent, manually-created "Roundtable" pseudo-contact** (`Source=manual`, `Relationship_Type=Roundtable`), with real names in free-text `Guest_Name`. The pseudo-contact exists *only* to give the one-FK schema something to point at. Once `Contact_ID` + `Contact_ID_2` point at the two real guests, the pseudo-contact has no job — **retire it** (and supersede AD #42 at the Reference source in Phase 3 doc-sync). Interim: episodes added before `Contact_ID_2` ships should still use the AD #42 pattern (point at the pseudo-contact) and be migrated by the cardinality spoke.

**Decision (leaning locked, Audra 2026-06-14): appended second FK column, not CSV-in-cell.**

- Add **`Contact_ID_2`** appended at the END of the Episodes schema (Audra hand-adds header; `EPISODES_COLS` gains one entry — no positional shift since appended, so no positional-read landmine).
- `Contact_ID` = guest 1 (primary), `Contact_ID_2` = guest 2. Both stay clean single FKs.
- `Guest_Name` becomes a display derivation ("A & B") for roundtables.

**Why appended column over comma-separated `Contact_ID` (the actual constraint, not the rule):** a CSV `Contact_ID` (`"id1,id2"`) **breaks every existing single-value reader** — match/lookup/join/folder-name all fail on a multi-ID cell, on exactly the roundtable rows. The appended column leaves existing readers untouched (they read `Contact_ID` = guest 1, graceful degradation), and only roundtable-aware code opts into `Contact_ID_2`. The anti-denorm principle agrees, but the deciding factor is non-breakage, not philosophy. (CSV would only be safe if all `Contact_ID` reads funneled through one resolver — unverified, and moot given the appended column is unconditionally safe.)

**Detection — Herald-driven (decided 2026-06-14).** Roundtables MUST be auto-detected via the calendar — no manual entry (Audra won't hand-materialize folders). Secretary creates the episode + folder; **Herald (the existing LLM call) reads the event title, identifies the guest(s), matches them to existing Contacts, and decides single-vs-roundtable.** LLM interpretation, not brittle marker/regex parsing — tolerant of JT's natural title variation (`Buck and Mai` / `Buck & Mai` / `Buck, Mai`). Confidence-gated: an unmatched/ambiguous name spawns a `Verify_Guest_Identity` task rather than a silent guess.
- **Rejected: manual app promotion** — Audra won't hand-enter or materialize folders.
- **Rejected: brittle attendee-email / regex inference** — superseded by LLM interpretation in Herald.

**Pipeline behavior + detection-repoint (sharpened):** two *previous* guests = already enriched, so a roundtable must **skip Herald/intake enrichment**. Open question, now concrete: **how does current code detect a roundtable — via the AD #42 pseudo-contact (`Contact_ID == Roundtable contact`) or via `Episode_Type`?** Since `Episode_Type` was all `standard` until 2-C, detection almost certainly keys on the pseudo-contact today. The cardinality spoke must **repoint detection to `Episode_Type = roundtable`** (now that the enum value is meaningful) and the two real `Contact_ID`s, then retire the pseudo-contact. Confirm the current detection path in the spoke's Stage-1 inventory before changing it.

**Briefs-to-folder (locked, orthogonal — do regardless):** copy both guests' existing briefs into the roundtable episode folder so the session has full context at hand. Low-tech, independent of representation.

**Reverse-lookup cost (accepted):** "which episodes feature guest X" now checks both `Contact_ID` and `Contact_ID_2` — clean two-column check, bounded.

---

## Half B — Multi-part: one guest, multiple episodes

(Originally `PROPOSAL_DWYP_MultiPart_Episodes.md`, folded here.)

**Need:** Part 1 / Part 2 of the same guest — one interview split across two released episodes. Part-ness is orthogonal to `Episode_Type` KIND (a Part-1 episode is still a `guest` episode).

**Candidate mechanism (unvetted lean):** `Series_Group_ID` + `Part_Number`, two nullable appended Episodes columns; null = standalone. Parts share the group id, order by part number. Consistent with the appended-column approach in Half A.

**Open:** storage (two nullable columns vs. grouping construct); UX surfacing (nav/Tasks/Schedule); shared vs. per-part Episode Index; pipeline skip for part-2 (guest already enriched in part 1 — mirrors the roundtable skip).

---

## Open questions (both halves)

- Is `bonus` truly a KIND (stays in the `Episode_Type` enum), or a flag-on-top that belongs on this cardinality axis? (raised during 2-C)
- Does the pipeline already branch on `Episode_Type` at all, or does everything flow single-guest today?
- Display/derivation rules for `Guest_Name` once it's multi-guest.

## Disposition

`Episode_Type` KIND enum (`guest | roundtable | solo | bonus`) is settled independently in 2-C and is compatible with whatever this lands on. **Roundtable half is near-term** (live cases exist) and wants its own scoped spoke + Audra hand-add of `Contact_ID_2`. Multi-part half is lower urgency. If pursued together: Episodes schema columns (Audra hand-adds, appended), pipeline enrichment-skip branch, nav/display handling.
