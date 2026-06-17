# PROPOSAL — Contacts Companion (Herald-powered)
STATUS: exploring

**Origin:** Bug-fix thread 2026-06-11, items #9/#13. Audra direction: "Contacts is the only surface without a companion. This one should help JT find info about her contacts."

---

## Premise

Contacts is the only Studio surface without a companion. Boundary Call #7 already reserves the desktop right rail for a Phase 2 Companion ("conversational research/enrichment — separate design pass"). This proposal is that design pass, seeded.

**Engine:** Gemini (lane preservation — research is grunt work; Herald is already permanently on Gemini for web search). Surfaces as a rail companion, not as "Gemini" — rail icons are verbs, not vendors.

## What it does (sketch)

- Conversational research about the focused contact: "find her podcast," "what's his book," "is this the same person as @handle."
- Grounded web search via the existing `callGeminiAPIGrounded` path; contact row + guest brief + FormContext + transcript (when present) as the foreground packet.
- Suggestions arrive as chips (chips never auto-write): tap to write a social field, organization, or bio line to the contact record via existing write helpers (`writeSocialFields`, `writeOrganization`, `writeBioSummary` — all bump `contacts`).
- **"Is this them?" lives here**, not as a modal enrich interrupt: when Herald's identity check is unsure, the companion presents candidate profiles as chips; JT taps the right one or dismisses. Confirmed anchor feeds re-enrich.
- **Headshot suggestions (#13) ride here:** when Herald is unsure or `Headshot_URL` is empty, companion surfaces candidate profile images from research; JT clicks the right one or dismisses. Accept = save image to Contact Library with `_headshot` filename + write `Headshot_URL` (existing AD #45 pattern).

## Boundaries (from existing canon)

- Desktop-only (Companion rule; Boundary Call #7 gives mobile full CRM-lite *without* companion — JT is the researcher on her phone).
- Read-only by default; all writes via explicit chip taps.
- Stateless phone-call model; session-scoped history; no cross-session memory.
- `companionChat()` is the existing single entry point for the four current surfaces — extend with a `contacts` surface mode rather than a parallel entry point.

## Open questions

| # | Question |
|---|---|
| CC-1 | Foreground packet size: contact row + brief + transcript can be large. Cap strategy? (Herald transcript cap is 50k chars — reuse?) |
| CC-2 | Chip action vocabulary: which fields are chip-writable? (Personal_Note is JT-only — never chip-written. Tags post-episode only.) |
| CC-3 | Headshot accept flow: who downloads the image — GAS server-side fetch of the URL into Contact Library? CORS/auth limits on profile-image URLs need a spike. |
| CC-4 | Relationship to per-card Enrich button: companion replaces it, or coexists (Enrich = batch pass, companion = interactive)? |
| CC-5 | Audit actor name for companion-initiated writes. |
| CC-6 | Rail icon + pane: Contacts surface currently has no icon rail — needs `contacts` entry in `railState`/`railPaneMeta` (icon-rail unification pattern, 2026-06-09). |

## Not in scope

- Mobile companion (excluded by canon).
- Autonomous writes of any kind.
- Cross-contact research sessions ("find me five potential guests") — Boundary Call #7 names companion-driven guest *research sessions* as desktop; multi-contact prospecting is a separate, later conversation.
