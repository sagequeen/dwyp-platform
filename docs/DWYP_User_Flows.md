# DWYP User Flows
**Version: 1.0 | May 2026**
**Status: Foundation document — surface-level companion to App_Structure v1.3**
**Companion documents:** `DWYP_App_Structure.md` v1.3 · `DWYP_Surface_Principle.md` · `DWYP_Performance_Principle.md`

---

## Purpose

The surface-level application of App_Structure v1.3's principles. Where v1.3 says *what's true*, this doc says *what verbs exist on what surfaces*, *which scenarios stressed which lenses*, and *which gaps still route forward*.

Phase 2.0 output, paired with v1.3. Input to Phases 2.1 (component library), 2.3 (mobile IA), 2.4 (desktop chrome), 3.3 (schedule panel).

---

## How to Read This Doc

- **Surface inventory** — the ten surfaces in scope plus a one-line role each
- **Per-surface action inventory** — for each surface, a verb-by-verb status table:
  - ✅ supported — exists or has a confirmed design
  - 🟡 planned — design exists, build pending
  - ❓ open question — routes to a future phase
  - — not applicable on this surface
- **Scenario walkthroughs** — 11 scenarios from S1–S5, one paragraph each, naming the lens(es) stressed and architectural outcome
- **Cumulative gap list** — every numbered gap from S1–S5 deduped, with phase routing
- **Open questions** — what v1.3 still leaves open

Mobile is treated as a **permission profile**, not a separate surface. Per Reframe #3 (Mobile = state viewer + reaction), mobile-permissible verbs are noted inline per surface; mobile-forbidden verbs are flagged.

---

## Surfaces in Scope

| # | Surface | Role | Lives in |
|---|---|---|---|
| 1 | Left Rail | Triage — "what needs me" via icon states + tab order | App chrome |
| 2 | Episode Tab | Project workspace — task feed, schedule, assets, reviews, reference docs | Center pane, scoped to episode |
| 3 | Free Workspace Tab | Project workspace — non-episode-scoped equivalent | Center pane |
| 4 | Contacts | Reference + edit — guest brief source-of-truth | Left rail tab |
| 5 | Publish (canvas) | Schedule — pre-composed slots, refined and queued | Episode tab center pane |
| 6 | Writer (canvas) | Compose — written work (docs, emails, briefs) | Episode or free workspace center pane |
| 7 | Design (canvas) | Compose — visual work (quote graphics, backgrounds) | Episode or free workspace center pane |
| 8 | Help Desk | Informational ops chat (Gemini, read-only across app state) | Right rail icon → center-right pane |
| 9 | Audra Ops | Pipeline ops — revision queue (in-rail), Easy Fix, Fairy Remote, Audit_Trail | Left rail icons + Hidden Until Engaged drawer |
| 10 | Loose Tasks | Untethered tasks (Personal / Launch / no project) | Left rail tab |

---

## Per-Surface Action Inventory

### 1. Left Rail

The triage surface. Doesn't hold actions of its own beyond navigation; its job is to communicate state.

| Verb | Status | Notes |
|---|---|---|
| Read icon state | ✅ | Three-color machine (gold/red/gray), role-filtered (S2 + S3 + S5) |
| Tap episode tab → open | ✅ | Center pane assembles by within-session state OR Resume By Priority (S5) |
| Tap Free Workspace / Contacts / Loose Tasks → open | ✅ | Same navigation pattern |
| Sort tabs | ✅ | Date-Driven Priority (S1); fallback chain Release_Date → Recording_Date → TBD (S5) |
| Filter by role | ✅ | Audra sees ops drawer/icon entry; JT does not (Hidden Until Engaged) |
| Search tabs | ❓ | Out of scope until episode count justifies it (S5 archive deferral) |
| Add episode | — | Booking is upstream (Calendar trigger → Secretary); no rail-level add |

**Mobile:** Same shape, vertically compact. State icons are the entire payload.

---

### 2. Episode Tab

The default view when an episode tab is tapped with no within-session state and no priority task to pop into a canvas.

| Verb | Status | Notes |
|---|---|---|
| View summary (Guest Name, Date, asset state, reference panel) | 🟡 | Component spec at Phase 2.1; summary view contents Q8 |
| View task list (this episode) | ✅ | Role-filtered |
| Tap task → center pane assembles | ✅ | Mode follows task (Reframe #6); never a mode picker |
| Add task (note-attached-to-episode) | ✅ | Inspiration release valve; mobile-permitted (Reframe #3) |
| View reference docs (Episode Card, Guest Brief, transcript link) | 🟡 | Read-only by default (Edit Is A Mode); Phase 2.1 component |
| Edit reference doc | 🟡 | Contextual `Edit Contact` / `Edit Description` buttons; Save commits + triggers automation (S3) |
| Open Publish week | ✅ | Tap Publish task or Schedule entry; canvas assembles |
| Open Writer doc | ✅ | Tap Writer task or doc tile; canvas assembles |
| Open Design canvas | ✅ | Tap Design task or asset tile; canvas assembles |
| Open Episode Review (audio/video) | ✅ | Custom HTML5 player, GCS-served (S2) |
| View transcript | 🟡 | Discreet payload link in reference panel; placement Phase 2.4 (S3 finding) |
| Approve / Request Revisions on episode | ✅ | Episode revision workflow spec-complete (S2) |
| Spawn ad-hoc reel (non-episode-scoped) | ✅ | Add Slot affordance with Reel type; Upload + Get Summary (S4) |

**Mobile:** Triage + react + add task. No canvas origination. No reference edit (defer to desktop).

---

### 3. Free Workspace Tab

Same shape as Episode Tab, but no project scope. Non-episode-scoped content lives here OR as siblings inside an episode tab via nullable Episode_UID (Sibling Not Sibling Surface, S4).

| Verb | Status | Notes |
|---|---|---|
| View task list (untethered) | ✅ | Same component as episode-scoped tasks |
| Add task | ✅ | Mobile-permitted |
| Open Writer doc | ✅ | Non-episode docs (newsletters when manual, brainstorms, outreach drafts) |
| Open Design canvas | ✅ | Non-episode designs |
| Spawn standalone reel | ✅ | Same Add Slot mechanism as episode tab (Sibling Not Sibling Surface, S4) |

**Mobile:** Same constraints as episode tab.

**Open question:** Verbs unprobed in Phase 2.0 beyond confirmed existence (S4 flagged this as carry-forward). Specific use cases — JT-driven newsletter, cross-episode design work — need scenario stress before this table is complete.

---

### 4. Contacts

Source-of-truth for guest records. Reference + edit surface. Feeds Herald enrichment when contact data changes.

| Verb | Status | Notes |
|---|---|---|
| View contact list | ✅ | Existing |
| Open contact record | ✅ | Existing |
| Edit contact (Edit Is A Mode) | 🟡 | Contextual `Edit Contact` button → editable record (LinkedIn, social handles, disambiguators, personal notes, Herald hints) — S3 |
| Save edit | 🟡 | Save = Herald re-enrichment trigger (S3); component Phase 2.1 |
| Filter contacts | ✅ | Existing |
| Search contacts | ✅ | Existing |
| Delete contact | ❓ | Not addressed in Phase 2.0 |

**Mobile:** View + filter + search. Edit defers to desktop.

---

### 5. Publish (canvas)

Schedule surface inside episode tab. Week view of pre-composed slots.

| Verb | Status | Notes |
|---|---|---|
| View week (left rail by Sort_Order from slot recipe) | 🟡 | S4 operationalized slot recipe; render component Phase 2.1 |
| View slot canvas | 🟡 | Default state per Q1 (resolved: pre-composed-as-drafts uncommitted, Pending if no available asset) |
| Choose between pre-composed options | 🟡 | 2–3 options per slot from Vert Fairy Pass 2 (v1.1); count Q3 |
| Edit selected option (caption text) | 🟡 | Inline edit in canvas; commits to Asset_Library row |
| Generate / regenerate background | 🟡 | Library-first vs Gemini fresh per Q13 |
| Refine via Claude chat | 🟡 | Per-card chat = refinement, not creation (v1.1); right-rail Claude icon (S5) |
| Schedule slot | ✅ | Schedule Button Is The Verb (S1); slot fills (S2) |
| Unschedule slot | ✅ | Reversibility — mobile-permitted (S1) |
| Tap Pending slot | 🟡 | Two-button canvas: Next + Poke (S4); component Phase 2.1 |
| Poke (spawn upstream task, idempotent) | 🟡 | Composite key `(episode_uid, asset_type, slot_day)`; spawnTask helper update (S4) |
| Next (skip to next actionable slot) | 🟡 | Resume By Priority in button form (S4) |
| Add Slot (Reel — standalone or extra) | ✅ | Existing `+ Add` affordance; canvas reacts on Reel type (S4) |
| Upload Reel | 🟡 | Within Add Slot canvas for Reel type (S4) |
| Get Summary on Reel | 🟡 | Gemini transcribe/summarize → `Asset_Library.Reel_Summary` → caption chat unlocks (S4) |
| Star / Unstar reel | ✅ | Symmetric reversibility (S2) |
| Edit Reel (Vids trim path) | 🟡 | 3-state button (S2); workfile handshake + Sentinel Fairy |
| Sync (after Vids export) | 🟡 | Fires Sentinel Fairy (S2) |
| Request Revisions (reel) | ✅ | Schedule gate flips on (Availability=blocked); icon flips gold→red (S2) |
| Approve (reel) | ✅ | Terminal "no revisions needed" gesture (S2) |
| Mark Urgent (JT-side toggle) | 🟡 | Two-step friction; SMSes Audra (S2) |
| Cannot schedule reel if revision pending | ✅ | Availability gate (S2); UX surfacing Q (S2-4) |

**Mobile:** View scheduled slots, unschedule, edit precomp text, schedule, swap between options (Q2). Cannot originate, regenerate background, trim, or use Add Slot creation flow.

---

### 6. Writer (canvas)

Compose surface for written work. Read-only by default for reference docs; quick-start templates for new docs.

| Verb | Status | Notes |
|---|---|---|
| Open empty canvas (chooser) | 🟡 | Quick-start buttons: Newsletter / Email / Outreach / Brainstorm / ... (v1.1); seven Scribe template keys land here (S3) |
| Pick quick-start template | 🟡 | Template storage Q10 |
| Open Writer doc | ✅ | From task tap, doc tile, or pinned panel |
| View reference doc (Episode Card, Guest Brief) read-only | 🟡 | Edit Is A Mode (S3); component Phase 2.1 |
| Edit reference doc (Episode Card description) | 🟡 | `Edit Description` button → editable; Save triggers Gemini grammar diff (S3) |
| Edit contact from Writer | 🟡 | `Edit Contact` from Guest Brief view (S3) → Contacts record opens; same Save → Herald re-enrich |
| Write / edit JT-owned doc | ✅ | Existing |
| Refine via Claude chat (right rail) | 🟡 | Scope: pinned + open docs (Reframe #7); right-rail icon (S5) |
| Send to Drafts (email) | 🟡 | Terminal action for email tasks; GAS verifies pipeline payload link at send (S3) |
| Add doc (to My Docs) | 🟡 | Writes to `JT_FOLDER_ID` directly (v1.1) |
| Drop doc via Drive directly | ✅ | Out-of-app path; My Docs reads `JT_FOLDER_ID` |

**Mobile:** Read open docs, edit text on existing docs (state viewer + reaction). No quick-start chooser, no compose-from-empty.

---

### 7. Design (canvas)

Compose surface for visual work. Quote graphics, hook images, custom slot backgrounds.

| Verb | Status | Notes |
|---|---|---|
| Open empty canvas | 🟡 | Phase 2.1 component |
| Open existing design | ✅ | From task or asset tile |
| Generate background (Gemini) | 🟡 | Per Phase 4 plan; cost gate Q13 |
| Pick from Image Library | 🟡 | `IMAGE_BACKGROUND_LIBRARY_ID` (v1.1) |
| Edit design canvas | ✅ | Existing Studio mechanism |
| Save design | ✅ | Existing |
| Export / download | ❓ | Phase 2.0 didn't probe Design's export verbs in detail |
| Refine via Claude chat | ❓ | Q15 — is Claude on the right rail when Design canvas is open? |

**Mobile:** Read existing designs (state viewer per Reframe #3). No origination. Manual download permitted on mobile (S1 boundary call).

**Open question:** Design's verb inventory beyond the canvas itself — Library management, escape hatches, export targets — wasn't stressed in Phase 2.0. Stress in Phase 2.1 session.

---

### 8. Help Desk

Informational ops chat. Right-rail icon → center-right pane. Gemini (per Phase 4.5).

| Verb | Status | Notes |
|---|---|---|
| Open Help Desk | 🟡 | Right-rail icon (Reframe #7 + S5) |
| Ask question (app state, schedule, tasks, episodes, contacts) | 🟡 | Phase 4.5 plan |
| Read Audit_Trail recency window | 🟡 | Background scope; not user-facing detail |
| Tap navigation chip in response | 🟡 | `[[NAV:...]]` markers route frontend (per Build Playbook 4.5) |

**Mobile:** Right-rail equivalent on mobile (overlay) — per Build Playbook 4.5.

**Open question:** Help Desk's specific use cases inside Phase 2.0's audit window weren't probed. Q6 partial-resolution (right-rail icon) holds; deeper verb inventory deferred to Phase 4.5 spoke.

---

### 9. Audra Ops

Multi-surface ops. Primary daily work lives in the left rail via icon state. Rare ops drop to Hidden Until Engaged.

| Verb | Status | Notes |
|---|---|---|
| See JT revision queue (red icons across left rail) | ✅ | Same dashboard structure, icon semantics flipped per role (S2) |
| Upload v2 (closes revision) | ✅ | Triggers resolved-checkmarks on comments (S2); cannot edit JT's comments |
| Easy Fix on failed task | 🟡 | Fairy name + step + timestamp + audit deep-link + Re-trigger (S2) |
| Tap audit deep-link → Audit_Trail entry | 🟡 | Embedded expandable panel from task context (S2) |
| Re-trigger failed task | 🟡 | Action embedded in Easy Fix (S2) |
| Open Fairy Remote Control | ✅ | Avatar dropdown — existing |
| Edit Governance_Config | 🟡 | Hidden Until Engaged; placement Q16 |
| View full Audit_Trail | 🟡 | Hidden Until Engaged; placement Q16 |
| Receive SMS for blocking failure / urgent revision | 🟡 | Infrastructure carried from S1 AO-2 → S2-7 |

**Mobile:** Receive SMS. Tap deep-link to Easy Fix in-app. Otherwise same constraints as JT.

---

### 10. Loose Tasks

Tasks not scoped to any project. Personal, Launch (Audra's), untethered.

| Verb | Status | Notes |
|---|---|---|
| View loose tasks list | ✅ | Existing |
| Add loose task | ✅ | Existing |
| Tap task → center pane assembles | ✅ | Mode follows task |
| Complete loose task | ✅ | Existing |

**Mobile:** Same.

**Open question:** Phase 2.0 confirmed existence but did not probe verbs in depth. Container behavior (filtering, archiving completed) deferred to Phase 2.4.

---

## Scenario Walkthroughs

Eleven scenarios walked across Phase 2.0. Each compressed to a paragraph naming the lens(es) stressed and the architectural outcome.

### Foundation scenario — David Bedrick image work *(S1)*

JT works on images mid-week, sporadic Wed–Thurs, image-driven posting. **Lenses stressed:** Cognitive Load (entry point); Discovery; Reversibility; Escape hatches. **Outcome:** Cognitive Offloading promoted to third foundation principle. Eight corollaries surfaced. Lens 11 (Cognitive Load) added. Audit user reframed to JT + Audra. Mobile Publish verb inventory locked. Three concentric definitions of "done" (atomic / sustained-momentum / real). Reframes #1, #3, #5, #7 confirmed under real workflow signal. Resume By Priority formalized.

### Audra critical-failure *(S2)*

A pipeline-blocking fairy fails. Audra has been ignoring email pings; the platform must route her to the diagnostic surface. **Lenses stressed:** Cognitive Load (Audra-side); Action Lives Where Awareness Arrived; Channel selection. **Outcome:** Easy Fix spec finalized — fairy name + step + timestamp + audit deep-link + Re-trigger, no prose generation (Point, Don't Narrate surfaces as new corollary). Email channel killed for Audra; SMS chosen for blocking failures + JT-urgent. Audra ops drawer reframed: revision queue lives in left rail (same icon machinery, role-filtered); rare ops drop to Hidden Until Engaged.

### Episode revision workflow *(S2)*

JT reviews a Carrie-cut episode and flags timestamped comments; Audra batches v2 work. **Lenses stressed:** Reversibility; State conflict; Permission gradients; Cognitive Load. **Outcome:** Spec-complete. Custom HTML5 player with comment overlay (GCS-served). Comment data model: add + delete only (no edit, eliminates edit-drift class entirely); states Active / Resolved (✓+strikethrough demoted) / Deleted (strikethrough demoted). Request Revisions is soft commit — JT retains comment ability until v2 lands. Approve is the terminal "no revisions" gesture. Icon state machine three colors established here (gold = JT's court, red = Audra's, gray = nobody's).

### Reel revision workflow incl. Vids trim path *(S2)*

JT wants a reel trimmed without leaving the loop, but render compute can't live in our project. **Lenses stressed:** Reversibility; Cross-surface need; State conflict; Discovery. **Outcome:** Spec-complete. 3-state Edit Reel button → workfile handshake → Sentinel Fairy (separate GAS project bound to JT's account) handles the cross-account Drive move. Schema collapse to ID-as-address pattern — `Asset_Library_ID` is stable, file bytes mutable, integer `Version_Number` suffices. No Version_History JSON. Comments anchor via `Resolved_At_Version`. **The Slot Is The State** operational principle surfaced — slot is filled or empty, Make pulls at post time, no commit/approval/lock state distinctions.

### Quote graphic to guest *(S3)*

JT wants to send a guest a quote graphic from a released episode. **Lenses stressed:** Export / external; Cross-surface need. **Outcome:** Export lens collapsed. Pipeline email already lives as a Drafts task (Reframe #8 + Filing Fairy payload injection). Absence Is A Signal emerged here — missing assets folder link in the email body tells JT she hasn't finalized assets yet; no platform narration required. Gmail Drafts is the gate. GAS verifies Finished folder ID at Send-to-Drafts; mismatch blocks send. Email-forward escape hatch explicitly killed (JT doesn't check email).

### Herald enriched wrong *(S3)*

Herald produced a wrong guest brief — 25% real rework rate. **Lenses stressed:** Recovery; State correction; Permission gradients. **Outcome:** Edit Is A Mode pattern locked. Guest Brief opens read-only in Writer. `Edit Contact` button → editable Contacts record → Save triggers Herald re-enrichment. Episode Card uses same pattern with different action (`Edit Description` → Save → Gemini grammar diff). Interview Prep is the authoring workspace where brief gaps get filled. Workspace Persistence corollary surfaced — one editable copy per reference doc per user, persists across sessions.

### Two devices, same asset *(S3)*

JT on mobile while Audra is mid-v2 work on the same reel. **Lenses stressed:** State conflict. **Outcome:** Lens closed by operational reality. Reframe #3 (mobile can't originate) + Audra's batch work pattern + Availability gate = collision space narrows to non-event. JT sees red icon, can add a task, cannot schedule (Availability blocked), cannot trim (desktop-only). Three-round collisions self-correct via volume. No new state machinery, no confirmation modal.

### Newsletter due tomorrow *(S3 — killed)*

Intended to stress RW-1 (pre-compose runway). **Lenses stressed:** *(scenario killed; didn't probe what it was meant to)*. **Outcome:** Newsletter is currently optional, JT-driven, fully manual — no pre-compose engine to fail. Scenario killed from audit. Side finding: JT asked if the app exposes transcripts; no current surface does. Discreet transcript payload link needed in episode tab reference panel (S3-9, routes Phase 2.4).

### Task lands somewhere unhelpful *(S3)*

A task lands at a moment when JT can't act on it. **Lenses stressed:** Dead ends. **Outcome:** Lens closed by operational reality + existing architecture. Tasks only spawn when their predicate is satisfied (Daily Pulse runway + Herald speed + reel-render learned behavior). Soft handle for Herald-mid-enrichment: "In Progress" header at top of brief template, auto-removes on completion (Point, Don't Narrate). Revisions are "two ADHD humans talking through a computer" — platform is robust and flexible enough.

### Pre-compose runway at launch (RW-1) *(S4)*

Original framing: 10 episodes simultaneous, un-pre-composed at launch. **Lenses stressed:** Empty/error; Discovery; Dead end. **Outcome:** Original framing rejected as wrong stress. Real stress: asset-class asymmetry inside the week (images engine-driven; reels JT-driven sourcing; episode pending until release day). Reframe #1 refined — **Playbook-as-Engine handles refinement, not sourcing.** Pending Is Derived, Not Stored operational principle surfaced — computed at render from slot recipe + Asset_Library presence; no Status enum value. Pending slot canvas locked at Next + Poke (two buttons; three lenses collapsed simultaneously). Three Cognitive Offloading corollaries converge here: Absence Is A Signal + Resume By Priority + Point, Don't Narrate.

### Standalone reel caption (Reframe #4 stress) *(S4)*

JT wants to transcribe and caption a non-episode-scoped reel. **Lenses stressed:** Cross-surface need; Permission gradients. **Outcome:** Reframe #4 confirmed without new surface. Existing Add Slot affordance handles the entire flow: pick Reel type → leftover reels appear OR Upload → Get Summary (Gemini) → caption chat unlocks (Claude reads Reel_Summary + Why + brand voice + episode index). **Sibling Not Sibling Surface** operational principle surfaced — nullable `Asset_Library.Episode_UID` is sufficient; non-episode reels schedule alongside episode reels in the same week view. Make doesn't care; it reads Social_Assets.

### Reframe #2 stress — Studio-as-the-App + Episodes-as-Tabs *(S5)*

The dashboard card surface had to be proven vestigial. **Lenses stressed:** Discovery; Cognitive Load; navigation cost. **Outcome:** Reframe #2 confirmed. JT's most frequent action is "open and triage" — left-rail icon states deliver this more directly than a dashboard intermediate surface. Four-pane desktop chrome locked (Left tabs / Center-left canvas / Center-right contextual / Right rail icons). Episode tab anatomy locked (Guest Name + Date + 🎧 🖼 🎬). Date fallback chain established. Active set rule (Drive folder exists → final post end-of-day) closed Q5. Within-Session State Persists; Cross-Session Resets To Priority corollary surfaced. Reframe #7 implemented at chrome level — Claude lives in right rail.

---

## Cumulative Gap List

Every numbered gap from S1–S5, deduped, routed. Gap IDs preserved from source yields for traceability.

### Spoke prerequisites (must resolve before specific spokes open)

| ID | Description | Spoke |
|---|---|---|
| S2-1 | Sentinel Fairy authorization & onboarding for JT (one-time consent for Drive scope) | Reel revision spoke |
| S2-2 | Sentinel Fairy web app access scope (Anyone-with-link vs. domain-restricted) | Reel revision spoke |
| S2-7 | SMS infrastructure for pipeline-blocking failures + JT-urgent *(carried S1 AO-2)* | Phase 4 infra |
| S2-11 | Status/Availability separation in Asset_Library schema | Schema |
| S3-1 | Filing Fairy subfolder condensation logic | Filing Fairy spoke |
| S3-2 | Release-day email template link injection at Filing | Filing Fairy spoke |
| S3-3 | GAS Send-to-Drafts verification (link vs. recorded Finished folder ID) | Filing Fairy / Writer |
| S3-6 | Workspace Persistence storage pattern — where does the editable copy live, how does it associate with original | Schema + Phase 2.1 |
| S4-2 | Slot recipe table schema lock (column names finalized) | Vert Fairy Pass 2 |
| S4-4 | Pending derivation logic at week-view render — fetch+compute pattern | Publish surface |
| S4-5 | Poke idempotency uniqueness key + spawnTask helper update | Publish spoke + spawnTask helper |
| S4-7 | On-demand Reel summary doPost endpoint | Standalone-reel caption / Reel surface |
| S5-1 | Daily Pulse sweep to compute active-set tab visibility | Daily Pulse extension |

### Component specs (Phase 2.1)

| ID | Description |
|---|---|
| S2-3 | Episode player + comment overlay component |
| S2-5 | 3-state Edit Reel button — visual spec, error recovery |
| S2-8 | JT urgent two-step toggle on Revise task |
| S2-9 | Comment list version-aware rendering (active + resolved-strikethrough + deleted-strikethrough, demoted bottom) |
| S3-4 | Contextual Edit button pattern (`Edit Contact`, `Edit Description`) |
| S3-5 | Read-only-by-default reference doc viewer in Writer |
| S4-3 | Pending slot canvas — `Next` + `Poke` button component spec |
| S4-8 | Add Slot canvas behavior when slot type = Reel — Upload + Get Summary affordances |
| S4-10 | Component-level rendering of Pending slot in week view (visual distinction from Ready/Scheduled) |
| S5-4 | Episode tab component spec (Guest Name + Date + 3 icons + possibly 4th icon for Episode itself) |

### Mobile IA (Phase 2.3)

| ID | Description |
|---|---|
| S2-4 | "Cannot schedule if revision pending" UX — how does the scheduling surface communicate the block |
| S2-12 | "Cannot schedule if revision pending" — partial-scheduling state on reels (gold until last slot, no intermediate) |
| CP-1 *(S1)* | Cursor persistence for new mobile surfaces (build requirement, not polish) |

### Desktop chrome (Phase 2.4)

| ID | Description |
|---|---|
| S2-6 | Hidden-Until-Engaged ops drawer for Audra (Fairy Remote, Audit_Trail panel, Governance) |
| S3-9 | Transcript payload link placement in episode tab reference panel |
| S5-3 | Right rail icon registry per canvas type |
| S5-5 | Audra ops drawer final placement (avatar dropdown vs. right-rail Ops icon) |
| S5-6 | Center-right pane behavior — does it overlay canvas, push it, or float |

### Schema / build-time decisions

| ID | Description |
|---|---|
| S2-11 *(also above)* | Status/Availability separation in Asset_Library |
| S4-1 | Slot recipe table storage location (Master Sheet tab vs. Governance_Config) |
| S4-9 | `Asset_Library.Episode_UID` nullability / sentinel pattern lock |

### Phase 3+ build details

| ID | Description |
|---|---|
| MM-1 *(S1)* | Momentum — transition between scheduled slot and next loaded slot must be invisible |
| MM-2 *(S1)* | Week completion state — quiet acknowledgment, not celebration |
| S5-2 | Within-session state persistence implementation pattern |
| S2-10 | Audra's image icon lit-state semantics — Phase 4 routing TBD |

### Phase 4 (AI Companions + infra)

| ID | Description |
|---|---|
| RW-1 *(S1)* | Pre-compose runway at launch — resolved S4 (reframed to asset-class asymmetry, not backlog) |
| RW-2 *(S1)* | Playbook strategic content load-bearing — promoted Phase 4.2 |
| AO-1 *(S1)* | Audra ops surface — Audit_Trail viewing — resolved S2 (Easy Fix deep-link) |
| AO-2 *(S1)* | Admin Alert channel — SMS chosen; infra TBD — carries to S2-7 |
| EH-1 *(S1)* | Escape hatch consistency — hooks/quotes lack originator path | Phase 2.1 / Phase 4.4 |
| EH-2 *(S1)* | Output continuity — escape hatch → editable canvas | Phase 2.1 |
| S3-7 | `Edit Contact` → Save → Herald re-enrichment trigger wiring | Herald spoke |
| S3-8 | Gemini grammar diff service for Episode Card edits | Future spoke |
| S3-10 | Pipeline email template registry (release-day + Scribe's seven template keys migrating to Writer quick-starts) | Writer spoke |
| S4-6 | Vert Fairy Pass 2 prompt construction reads recipe `Why` column | Vert Fairy spoke (next iteration) |

### Open scenario gaps (Phase 2.0 didn't probe; carry forward)

| Source | Description |
|---|---|
| Free Workspace verbs | Specific use cases — JT-driven newsletter, cross-episode design work — unprobed (S4 carry) |
| Design verb inventory | Library management, escape hatches, export targets — unstressed (Phase 2.1) |
| Help Desk verbs | Specific questions and chip patterns — deferred to Phase 4.5 spoke |
| Loose Tasks verbs | Container existence confirmed; verbs unprobed |
| JT-1 *(S1)* | "Work on the images" phrasing — survives or dies post-pre-compose | Resolve mid-pre-compose-rollout |
| JT-2 *(S1)* | Empty-slot failure mode — resolved S4 (Pending canvas) |

---

## Open Questions

From `DWYP_App_Structure.md` v1.3:

| # | Question | Lands in |
|---|---|---|
| Q2 | Swap between pre-composed options on mobile — pure selection vs forbidden | Surface Principle update |
| Q3 | Option count — exactly 3 always, or variable by episode richness | Vert Fairy job spec |
| Q8 | Default center pane when episode tab is selected and has no pending task | Phase 2.4 |
| Q9 | Pinned-docs context budget — default-pinned ≠ default-injected vs whole-panel-injects-with-truncation | Phase 2.4 + Publish AI Companion design |
| Q10 | Templates location — storage scheme | Phase 2.1 + Writer spoke |
| Q11 | Schedule placement — inside Publish per-project, or a level above as roll-up | Phase 2.4 |
| Q12 | Feedback loop capture target — Interactions tab vs Audit_Trail append vs Asset_Library chat_history column | Phase 2 schema review |
| Q13 | Background image strategy at pre-compose — library-first with Gemini fallback, or fresh per slot | Vert Fairy job spec |
| Q14 | Slot recipe table storage location | Build-time decision |
| Q15 | Right rail icon registry per canvas type | Phase 2.4 |
| Q16 | Audra ops drawer final placement | Phase 2.4 |
| Q17 | Center-right pane behavior — overlay / push / float | Phase 2.4 |
| Q18 | Within-session vs cross-session state distinction — implementation pattern | Phase 3 build |

---

*DWYP_User_Flows v1.0 — May 2026. Surface-level companion to App_Structure v1.3. Per-surface action inventory across ten surfaces. Eleven scenario walkthroughs from Phase 2.0 (S1–S5). Cumulative gap list with routing. Input to Phases 2.1 / 2.3 / 2.4 / 3.3.*
