# PROPOSAL — Contacts Surface Layout (master–detail)
STATUS: exploring (captured 2026-06-14, Audra) — surfaced while trying to reach Enrich during 2-B testing. UX/surface; not Reckoning arc.

## The ask

Current Contacts surface doesn't surface full contact details / the Enrich affordance well (Audra couldn't reach Enrich to test 2-B). Preferred layout:

- **Left half of the canvas: contact cards** (the list).
- **Click a card → details open on the right half, editable in place.**
- **No AI helper in the right rail** for this surface.

Classic master–detail: list left, editable detail right.

## Tension to resolve — conflicts with `PROPOSAL_DWYP_Contacts_Companion.md`

The Contacts Companion proposal designs a **Herald-powered AI companion in the Contacts right rail** (identity "is this them?" chips, headshot picking, bio/social enrichment). Audra's "no AI helper in the right rail" directly opposes putting that companion where the proposal puts it. Three ways this can reconcile (Audra's call):

1. **Companion dropped** — Contacts gets the plain master–detail layout; Enrich stays a button on the detail pane (no conversational companion).
2. **Companion relocated** — the Herald assist lives somewhere other than the right rail (e.g. inline actions on the detail pane), preserving the no-rail preference.
3. **Companion kept, layout adjusted** — reconsider the no-rail stance.

Lean (option 1, canon-aligned): drop the rail companion; master–detail layout with Enrich as a detail-pane button. Rationale: the original Companion Spectrum named exactly three companion surfaces — Publish (Claude), Writer (Claude), Help Desk/Tasks (Gemini). **Contacts was never one of them**; `Contacts_Companion` was a speculative *later add*. So declining it is consistent with the model, not a deviation. (Tasks → Episodes does have a companion — Help Desk — so this is surface-specific, not an anti-AI stance.) Needs Audra's ruling, but the default leans drop.

## Open

- Where does Enrich live in the master–detail model (detail-pane button)?
- Does the detail pane edit in place (per the Edit-is-a-mode corollary) or open an edit mode?
- Fate of `PROPOSAL_DWYP_Contacts_Companion.md` given the no-rail preference.

## Disposition

Idea-stage capture. If pursued: Contacts surface rebuild (master–detail), reconcile/park Contacts Companion, scoped UI spoke. Not blocking Phase 2 — 2-B verifies via the pipeline path regardless of this layout.
