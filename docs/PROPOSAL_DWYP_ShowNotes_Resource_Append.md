STATUS: exploring — spec from Audra 2026-06-14; not yet scoped for handoff.

# PROPOSAL — Show-Notes Resource Append (on-demand guest contact info → notes doc)

## Purpose
An on-demand, human-verified action that appends a guest's resources + social handles to the show-notes doc. Saves manual copying; keeps unverified data out of auto-generated editorial.

## Pipeline write order (context — locked sequence)
1. **Guest Brief** — Herald (initial).
2. **Editorial passes** — show notes, Reels (vert). Guest brief is *deliberately excluded* from the pulse editorial pass (bad-brief-info guard).
3. **Enrich Contact** — Herald, on demand, when info is thin (uses new human-entered info and/or the transcript).
4. **Append show notes with resources + social handles** — on demand. **NEW.**

## The new step (4)
- Appends the guest's resources/links + social handles to the show-notes doc.
- Trigger: human, on demand (button), *after* the info is verified.
- **Hard constraint: never automatic.** Audra must verify contact info before it lands in the notes — the same principle that removed the guest brief from the editorial pass: **unverified brief/contact data must not auto-flow into editorial output.**

## Open questions
| # | Question |
|---|---|
| Q1 | Trigger location — show-notes editor button? Contacts card? Episode surface? |
| Q2 | Which fields, in what order — social handles, websites, other resources? |
| Q3 | Append target + format — where in the notes doc (a Resources section?), and formatting. |
| Q4 | Idempotency — re-running must not double-append; update-in-place vs append-once. |
| Q5 | Source of truth for handles/websites — Contacts fields, populated via the Enrich button (step 3). |

## Relationship
- Resolves the real "enrichment cue" need surfaced in Schema Reckoning **D12** — the cue Audra wanted is *contact-info-for-show-notes*, not the `Bio_Summary` sentinel (now evicted to content-or-blank).
- Depends on Contacts handle/website fields being populated (step 3, Enrich).
- Net-new feature, not Reckoning cleanup — develop deliberately, don't bolt on.
