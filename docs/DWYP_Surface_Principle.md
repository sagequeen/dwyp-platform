# DWYP Surface Principle — Mobile vs Desktop

**Status:** Foundational design principle, locked May 2026 | Boundary calls confirmed May 2026
**Purpose:** Establish the operating model for all surface design decisions across the platform
**Feeds into:** Component library design, schedule panel UX (OQ-B), visual modernization (OQ-C), all future UI spokes

---

## The Test

A single question resolves every surface decision:

> **Is this a decision, approval, or awareness?** → Mobile.
>
> **Is this composition, creation, or sustained focus work?** → Desktop.

If the answer is unclear, the work probably belongs on desktop. Default in favor of the focused surface — composition is the more failure-sensitive task.

---

## The Split

### Mobile = Operations Layer

JT is on her phone. She's between things. She has 30 seconds. She wants to know what needs her, then tap to handle it.

**Lives on mobile:**
- Tasks — what's pending right now (episode cards + loose task containers)
- Episode status awareness — release date, current phase, gating status
- Asset review (images, reels) — sort, approve, comment
- Episode review — proxy player, timecoded comments
- Contacts — browse, read, light edits (tags, notes)
- Ready for Release toggle
- Manual asset download for off-platform posting
- Notifications and quick acknowledgments
- Adding a loose task
- Approving Audra's revision turnarounds
- Write Lite — idea capture only (see Write Lite section below)

**Posture:** "Show me what needs me. Let me tap. Done."

### Desktop = Creation Layer

JT is at her computer. She's sitting down to make things. She has time and focus.

**Lives on desktop:**
- All of Studio (guest nav surfaces: Images, Reels, Episode, Show Notes, Schedule; Write → Brainstorm)
- AI Chat per-asset (Images / Reels)
- Canvas work (Fabric.js, backgrounds, quote graphics, layouts)
- Long-form writing (newsletters, outreach drafts, brainstorms)
- Multi-panel iteration
- Caption refinement via Claude chips
- Reading Studio output (newsletters, plans, drafts) even read-only
- Audra's production work — Filing Fairy, Herald re-enrichment, governance edits, all of `dwyp_app.gs` ops

**Posture:** "I'm here to make something. Give me the room."

---

## Boundary Calls (Locked)

### 1. Strict separation, not graceful degradation
When a mobile user taps a desktop-only surface, the response is a **hard wall**: "Studio is desktop-only. Open [URL] on your computer."

Not a read-only mobile view. Not "tweak the caption from your phone." Awareness lives on mobile (status, scheduled content visible). Composition does not (Claude chat, canvas, refinement chips, editable fields all suppressed).

**Rationale:** Soft degradation breaks the principle quietly. Once "just a small caption tweak" works on mobile, every subsequent feature gets pulled into a mobile compromise. The hard wall keeps the discipline intact.

### 2. Single deploy, responsive breakpoint
One web app URL. Same auth, same data, same backend. Frontend renders mobile chrome below breakpoint, desktop chrome above. Surface logic decides what surfaces appear, not separate codebases.

### 3. Awareness ≠ tools
Mobile can *show* the scheduled posts, captions, plans. Mobile cannot *modify* them. If JT taps a scheduled post on mobile, she sees the caption and image read-only. The "edit caption" affordance simply isn't there. To edit, she switches to desktop.

### 4. Audra is desktop-primary
Production actions (Filing Fairy trigger, Herald re-enrichment, governance config) are maintenance/creation work. Not ops. No phone-based admin panel. Audra's mobile surface looks the same as JT's — just task list and status awareness.

### 5. Manual post download is mobile-allowed
The exception that proves the rule: when posting requires manual platform access (e.g., a platform Make can't reach), JT downloads the asset on mobile and posts via the native app. Download = execution, not creation. Stays mobile-eligible.

### 6. Write Lite is mobile-allowed — capture, not composition
JT can open a Write Lite surface on mobile to capture ideas before they disappear. This is a narrow, explicitly-scoped exception to the desktop-only Studio rule.

**What Write Lite is:**
- Chat input only — keyboard (with mic/voice) or typed text
- Claude responds (real back-and-forth conversation)
- No corpus, no episode context, no episode picker, no RAG
- No canvas, no chips, no My Docs panel, no Studio chrome

**What Write Lite saves:**
- The conversation (both sides) → one new Drive doc per session, named by date/timestamp
- Doc appears in the Brainstorm Docs picker (Write → Brainstorm) on desktop — she continues composition there

**What Write Lite is not:**
- A read-only view of Studio output
- A stripped-down Write tab
- A way to publish or act on anything

**Rationale:** Capture is an ops gesture — quick action, done before the idea evaporates. The composition happens on desktop. The hard wall holds for everything else in Studio; this surface intentionally has no path to creation tools.

---

## Edge Cases Resolved

| Scenario | Surface | Why |
|---|---|---|
| JT reviews reels on her phone on the couch | Mobile | Sort/approve = ops decision |
| JT taps "Ready for Release" from her phone | Mobile | Approval = ops decision |
| JT writes a newsletter | Desktop | Composition |
| JT iterates on a caption with Claude | Desktop | Composition |
| JT wants to read last week's plan in bed | Desktop | Reading creation output is creation-context. Tasks screen is the mobile equivalent. |
| JT has an idea while walking and opens Write Lite | Mobile | Capture gesture — chat only, saves to Drive doc, continues on desktop |
| JT spots a typo in a scheduled caption from her phone | Desktop (to fix) | Awareness on mobile, fix on desktop. Friction is acceptable — it protects the principle. |
| Audra checks if an episode is gated | Mobile | Status awareness |
| Audra triggers Filing Fairy | Desktop | Production action with consequences |
| Audra fixes a hotfix | Desktop | All code work is desktop |
| JT downloads an asset to post manually on TikTok | Mobile | Execution, not creation |
| JT comments on a reel during review | Mobile | Decision-adjacent ops |
| JT approves Audra's caption revision | Mobile | Approval = ops decision |
| JT adds a loose task | Mobile | Ops decision |
| JT browses guest contacts | Mobile | Read + light tag edits = ops |
| JT edits a contact's organization or relationship type | Desktop | Core field edit = production |

---

## What This Principle Does NOT Address

These are downstream from the principle and need their own design pass once the principle is locked:

1. **Component library** — shared genes for cards, buttons, inputs, headers, pills, badges across both surfaces. This principle says *what* lives where; the component library says *how things look* when they get there.

2. **Mobile information architecture** — once mobile is operations-only, what's the navigation pattern? Single feed? Tabs? Bottom nav? Needs separate decision.

3. **Desktop chrome conventions** — Studio tab structure exists, but pattern conventions across tabs (toolbars, empty states, panel proportions) need to be consolidated.

4. **State language** — empty / loading / draft / approved / done — needs to be one visual vocabulary across all entity types.

5. **Schedule panel UX (OQ-B)** — this is a desktop redesign and now an *application* of this principle, not a freelance fix.

6. **Visual modernization (OQ-C)** — Riverside-inspired treatment is also an application of this principle, propagated via the component library.

---

## Implications

### For the AI Companion spoke
The companion is desktop-only. No mobile equivalent. JT's phone shows scheduled posts read-only — she cannot use AI Chat or apply chips on mobile. Companion lives in the AI Chat rail icon on Images and Reels surfaces; desktop-only, full stop.

### For Tasks screen half-width-tasks-alongside-episode-cards
The complaint that started this conversation. Resolution: episodes and tasks are *different entity classes*. Tasks screen treats them with distinct visual hierarchy — one not mistakable for the other. Component library work, not principle work, but the principle says they deserve different shapes because they serve different roles (entity vs action).

### For Studio tab parity
Tabs vary in maturity (Publish detailed, Write half-built, Outreach/Ideas placeholders). The principle doesn't fix that — but the design system pass that follows should standardize tab chrome so half-built tabs at least *look* coherent with built ones, even when their content is thin.

### For future feature decisions
When a new feature is proposed, ask the test first. "JT wants to draft outreach emails on her phone" → composition → desktop. "JT wants to forward a guest brief from her phone" → ops → mobile. The decision falls out automatically.

---

## Build Implications

This principle reorders the active design queue:

1. **Lock this principle** ✅ (this document)
2. **Component library design** — shared genes across both surfaces. Foundation for everything below.
3. **Mobile IA design** — navigation pattern, screen inventory, what stays vs goes
4. **Desktop chrome conventions** — Studio tab consistency, panel patterns
5. **Schedule panel UX (OQ-B)** — applies the principle and the system
6. **Visual modernization (OQ-C)** — propagates Riverside-inspired treatment via the system

Steps 2–4 are the design system pass that makes 5 and 6 possible without freelance drift.

---

## Boundary Calls — Confirmed (May 2026)

All four boundary calls confirmed by Audra.

| Call | Decision |
|---|---|
| Adding a task on mobile | ✅ Mobile — confirmed ops |
| Approving Audra's revision turnarounds on mobile | ✅ Mobile — confirmed ops |
| Reading creation output on mobile | **Modified** — Write Lite replaces "desktop only, strict." See Boundary Call #6 above. Reading Studio output (newsletters, plans) remains desktop-only. |
| Manual asset download on mobile | ✅ Mobile — confirmed exception |

---

*Captured Hub session, May 2026. Audra + Claude. Locks the foundational surface principle. Feeds component library design and all subsequent UI work. Boundary calls confirmed May 2026 — Write Lite (mobile idea capture) added as Boundary Call #6.*
