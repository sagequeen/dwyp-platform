# DWYP App Structure
**Version: 1.4 | May 2026**
**Status: Foundation document — principles + refinements layer for Phase 2 design work**
**Companion documents:** `DWYP_Surface_Principle.md` · `DWYP_Performance_Principle.md` · `DWYP_User_Flows.md` · `DWYP_Build_Playbook.md` · `DWYP_Platform_State.md`

---

## Purpose

Captures the foundation principles, operational principles, and eight reframes that govern the DWYP app. v1.3 supersedes v1.2 by integrating the full output of Phase 2.0 (five hub sessions, May 2026), which saturated the action-completeness audit.

v1.3 is the principles layer. Its surface-level companion is `DWYP_User_Flows.md` v1.0 — per-surface action inventory + scenario walkthroughs + gap list.

The eight reframes are the spine of this document. They don't change in v1.3; they get refined inline. New material lives in two added sections — **Foundation Principles** (Cognitive Offloading + corollaries) and **Operational Principles** (Slot Is The State; Pending Is Derived; Sibling Not Sibling Surface).

---

---

## Foundation Principles

The platform sits on three foundation principles. Each governs a different axis. They cooperate; none stands alone.

| Principle | Axis | One-line |
|---|---|---|
| **Surface Principle** | Where things live | Mobile = ops + reaction; desktop = origination |
| **Performance Principle** | How things feel | Show first; sync second; version-stamp invalidation |
| **Cognitive Offloading** | What the user holds | The platform spends its own memory so JT and Audra don't spend theirs |

Surface and Performance are documented in their own foundation files. v1.3 introduces Cognitive Offloading and its corollary set below.

### Cognitive Offloading

> The platform exists to hold what JT and Audra would otherwise have to remember, decide, or repeat. Any action that can be inferred from an action they were already taking should be inferred. Any context that can be carried forward should be carried forward. Memory is a finite resource; the platform spends its own so theirs is freed. *— S1*

Applies to **both users.** Audra-as-architect builds; Audra-as-user works inside the platform. Both users' surfaces are in scope under this principle.

### Corollaries (operational rules under Cognitive Offloading)

| Corollary | Source | One-line |
|---|---|---|
| Date-Driven Priority | S1 | Default order across every surface = soonest due, actionable for the current user. Completion sinks. Blocked items don't appear. |
| Decisions Are Binary | S1 | N-way choices consume working memory. Default surfaces narrow to binary or small-N. |
| Hidden Until Engaged | S1 | Originator escape hatches live behind a deliberate gesture. Don't fight the approver default for screen real estate. |
| Escape Hatch Returns You Home | S1 | Originator output (Claude chat, GenGem) terminates in the same editable element as the default path. Tools generate; the canvas owns. |
| The Schedule Button Is The Verb | S1 (refined S2) | Atomic done = Schedule pressed. JT sees state, not mechanism — the technical lock happens silently at Make's read time. |
| Resume By Priority, Not By Cursor | S1 (refined S5) | Across sessions, the app opens to what needs doing next, not where the user was last. Within session, navigation is preserved. |
| Action Lives Where Awareness Arrived | S1 | Whether discovered proactively, via SMS, or in-app, the remediation gesture sits at the surface where awareness landed. |
| Use The Channel That Arrives In Your Hand | S1 | Don't optimize the channel for rich content. Optimize for whether it reaches the user. Rich content lives in the app. |
| Point, Don't Narrate | S2 | When context exists in a system surface, link to it rather than re-render it. Platform is pointer (default), generator (last resort). |
| Absence Is A Signal | S3 | When an expected payload is missing from a surface, the empty state itself communicates upstream work. The gap is the message. |
| Edit Is A Mode, Not A Default | S3 | Reference surfaces open read-only. Edit is a deliberate gesture; Save flips back and triggers any associated automation. |
| Workspace Persistence | S3 | Each user has exactly one editable copy per reference doc. The copy persists across sessions. No version proliferation. |
| Within-Session State Persists; Cross-Session Resets To Priority | S5 | Within a working session, navigation is the user's. Across sessions, the app resumes by need. |

---

## Operational Principles

These describe how specific subsystems behave. They're not user-facing; they're architectural constraints that make Cognitive Offloading possible.

### The Slot Is The State *(S2)*

A slot is filled or empty. Make pulls slot contents at post time. There is no commit moment, no approval state separate from filled, no lock gesture, no cutoff visibility. JT can swap contents until Make reads.

**Refines Schedule Button Is The Verb:** Schedule is JT's intent commit — the icon flips, the slot fills, the episode closes from her POV. The technical lock happens silently at Make's read time.

**Caveat (reels only):** *Cannot schedule a reel if revision pending.* `Asset_Library.Availability` (separate from Status — Status governs lifecycle, Availability governs schedulability) blocks reels with active revision requests from entering slots. Once v2 lands, reel returns to available.

**Clarifications (Hub, May 2026):**
- **Lock is per-slot, derived from Make's read.** When Make pulls a slot at its post time, that slot renders locked and grayed — derived from `Scheduler_Status` (`queued`/`posted`). No Finalize button; no week-level commit. Slots whose post time hasn't arrived stay editable.
- **Locked slots stay visible.** Grayed, read-only, asset + caption shown — supports themed-week planning.
- **Guest export is a point-in-time snapshot.** Post-export edits do not trigger re-sync or notification — the guest copy was a courtesy snapshot, never a guarantee.
- **Finalize rejected.** A week-level commit would lock Saturday along with earlier slots, contradicting last-minute editability. Per-slot lock-on-read is the mechanism.

### Pending Is Derived, Not Stored *(S4)*

Slot states like "Pending" are computed at render time from the join between a slot recipe table and Asset_Library presence. They are not values in a Status enum.

Implications:
- No schema migration to introduce a Pending state
- Single source of truth (presence of an available Asset_Library row)
- Same logic generalizes across asset types
- `Asset_Library.Availability` has exactly two values: `available` / `placed`. No `pending`. No `bank`.

**Three derived slot render states (Hub, May 2026):**
- **Filled** — an available Asset_Library row is placed in the slot
- **Pending** — slot recipe exists, no available asset yet
- **Locked/grayed** — derived from `Scheduler_Status` = `queued`/`posted`; read-only render

No Status enum growth. Lock is computed at render time, not stored. Closes gap S4-10 (visual distinction of pending vs locked slots in week view).

### Sibling, Not Sibling Surface *(S4)*

Non-episode-scoped content that follows the same scheduling pattern lives in the same surface as episode content. The distinction between scoped and unscoped is a data-layer fact (nullable foreign key), not a UI boundary.

Sits under Cognitive Offloading (no second mental model for JT) and Generic In Name, Specific In Build (don't generalize until forced).

### Library Holds Kept Things Only *(Hub, May 2026)*

The Asset_Library holds only what JT **made and kept** — never what the platform merely **offered**. Claude generates an abundance of hooks and quotes so JT has choices; selecting and composing one is the act of creation, and saving is the act of keeping. Suggestions are not assets until a tap turns an offer into work.

**Three-tier persistence:**

| Tier | Holds | Persistence | Reason |
|---|---|---|---|
| **Transcript** | Episode source text | Permanent | Durable source of truth; suggestions derive from it |
| **Suggestion store** (side sheet, keyed by EUID) | Hooks + quotes + starter captions | Self-clearing (~1 week after release date) | Regenerable from transcript; disposable because re-drawable |
| **Asset_Library** | What JT made + kept (composed quote graphics, reels) | Permanent | Kept work; canonical editable object |
| **Finished folder** | As-posted assets | Permanent | Archive of record — what actually went out |

**Regenerate, don't archive.** Unused suggestions aren't precious because they aren't scarce — Claude redraws from the transcript in seconds. Worst case after a self-clear is a few seconds of regeneration, not lost work.

**Reels vs Quote Graphics — different on-ramps, same library rule:**

| | Reels | Quote graphics / hooks |
|---|---|---|
| Count | Few | Many (buffet) |
| Origin | Made upstream (Audra grabs, JT marks in/outs) | Claude offers; JT taps to compose |
| Library entry | Born into Asset_Library (durable, identity matters) | Enters Asset_Library only on Save (after tap + compose) |
| Disposability | Not disposable | Disposable by design — regenerable from transcript |

**Feed-default aspect ratio:** Quote-graphic compose defaults to Feed (4:5 / 1080×1350). JT picks a ratio only when deviating — one fewer decision per asset. Reels are exempt (9:16 by nature). Ratio-pick is a quote-graphic affordance only.

⚠ **Code confirm required before implementing:** AD #109 has `materializeQuoteGraphicAssets` writing one Asset_Library row per hook/quote at materialization. Under this principle, those suggestions should land in the suggestion store, and only saved ones become Asset_Library rows. Whether that's a rename (candidate rows are already lightweight) or a rewire (downstream reads depend on them) is an inspection question — do not implement until Code sizes the change.

### Two-Room Model — Design ↔ Schedule *(Hub, May 2026)*

Create and schedule are two surfaces, not one chained flow. The chained per-card flow is retired.

- **Design** = where assets are made and edited (canvas + caption). The only place Canvas_State is written.
- **Schedule** = placement only. Drag/drop (desktop) or tap-to-place (mobile) assets into week slots; view thumbnail + caption/summary in slot. Not an editor.

**Doorways pass intent + ID, never state:**

| Door | From → To | Mechanism |
|---|---|---|
| **Go to Schedule** | Design → Schedule | Optional bridge (offer, not march). Eases creation→placement friction. |
| **Edit in Design** | Schedule → Design | Opens asset by `Asset_Library_ID`. Jump, not inline edit. Suppressed on locked slots. |

**Live-reference consequence:** editing an asset in Design that is placed in a slot updates the slot — Social_Assets foreign-keys to Asset_Library; no per-slot copy. Suppressed only when slot is locked. Recommended UI cue: when opening an asset currently placed in an unlocked slot, signal "this asset is scheduled [day] — editing changes the scheduled post." Not a lock; awareness only.

**Resolves Q11 (updated)** — Schedule is per-guest, accessed as a sub-item under each guest's nav root. Not a global surface above projects.

---

## The Eight Reframes (with v1.3 refinements)

Listed in the order they emerged. They interlock — none stands fully alone.

### 1. Playbook-as-Engine *(refined S4)*

The Social Media Playbook is the primary generative system. A pre-compose engine reads the Playbook to fill the week's slots with drafts (caption + background) before JT opens the app. **AI chat is the refinement escape hatch, not the creation interface.**

80% of what JT will need is already there when she sits down. Chat handles the 20% tangent.

Pre-compose quality = Playbook quality. **OQ-F (playbook strategic content) is promoted from prerequisite to load-bearing.**

**S4 refinement: `Why` column IS the operational Playbook.** A slot recipe table (governance — Master Sheet tab or Governance_Config, see Q14) carries columns:

`Slot_ID · Day · Asset_Type · Platform · Why · Sort_Order · Ratio`

`Why` is not UI copy. It is a generation parameter consumed by Vert Fairy Pass 2. Editing a `Why` cell tunes the Playbook without code change. This is the weekly feedback loop operationalized.

**S4 refinement: engine handles refinement of options, not asset sourcing.** Pre-compose is asymmetric across asset types:

| Asset class | Source | Engine role |
|---|---|---|
| Images (quote graphics, thumbnails) | Vert Fairy Pass 2 from episode index | Generates options |
| Reels | Audra grabs from Riverside; JT marks in/outs during Episode Review | Generates captions on existing reels |
| Episode (release-day) | Render pipeline | Pending until release day |

Reel sourcing remains JT-driven and won't be automated.

### 2. Tasks-as-Home + Studio-as-Creation

The app lands on the **Tasks screen** — the ops home: episode cards (release + asset
state) and loose-task containers (Podcast / People / Personal). Card spec is
authoritative in `DWYP_Platform_State.md`.

**Studio** is the desktop creation environment, entered from the Tasks screen. Its
left rail uses guest names as root nav items, each with sub-surfaces (Images, Reels,
Episode, Show Notes, Schedule). **Write** (with Brainstorm) and **Tasks** (with
Buckets and Episodes) are peer root items. Design as a standalone root surface is
retired. Navigation carries no state signals; state rides the card.

Mobile is the Tasks screen plus reaction verbs (Surface Principle); origination lives
in desktop Studio. Mode follows task — the user never picks Design / Write / Schedule.

**S5 — Desktop chrome locked at four panes:**

| Pane | Width | Content |
|---|---|---|
| Left — Navigation | Compact | Guest names (root items) with sub-surfaces; Write; Tasks; (Audra) ops |
| Center-left — Canvas | Largest, primary | Active workspace (Write doc, canvas, episode review, task surface) |
| Center-right — Contextual / expanded menu | Variable | Whatever the rail icon expanded |
| Right — Rail | Narrow icon column | Canvas-aware tools; AI Chat is one icon among others |

**Episode left nav anatomy:**

```
[GUEST NAME]
    Images
    Reels
    Episode
    Show Notes
    Schedule
```

Guest name is the root item. Sub-items are the per-episode surfaces. Date fallback chain: `Release_Date` → `Recording_Date` → `TBD`. TBD entries sort to bottom under Date-Driven Priority.

**S5 — Active set rule:** Episode is in the left rail from the moment its Drive folder exists (Secretary Fairy creates at scheduling) through end-of-day of the final social media post. Archive surface deferred to future demand.

### 3. Mobile = What Is, Not What Should Be *(confirmed S1)*

**Mobile is a state viewer plus reaction surface. Desktop is origination.**

JT can, on mobile:
- See what's scheduled
- Unschedule
- Edit text on a scheduled slot (at the very most)
- Review and approve assets
- Write a note (task attached to an episode) when inspired

JT cannot, on mobile:
- Originate content
- Generate or change background images
- Choose between pre-composed options *(TBD — Q2)*

Notes-as-tasks is the inspiration release valve. The note becomes desktop's problem later, and is also a clean signal for the feedback loop.

Audra's mobile permissions extend the rule, not break it.

Surface Principle boundary calls (resolved S1):

| Boundary call | Answer |
|---|---|
| Add task on mobile | Yes — as note-attached-to-episode |
| Approve revisions on mobile | Yes |
| Read creation output on mobile | Yes — mobile IS that |
| Manual download on mobile | Yes |

### 4. Project, Not Episode *(confirmed S4)*

Episode is the dense, recurring instance of a more general shape. **A project is a tabbed workspace that holds its own tasks, assets, schedule view, review states, and AI context.** Episodes are projects. A future newsletter series, course, or client engagement could be projects. The free workspace is the no-project mode.

**Discipline: generic in name, specific in build.** Code, schema, and UI use "project" where it's cheap. A Project_Types registry, generic routing, and multi-project schema are NOT built. They become byproducts of the eventual second project — when one shows up with real evidence.

**S4 refinement: non-episode-scoped content uses the existing surface.** JT's standalone reel caption use case confirmed: `Asset_Library.Episode_UID` accepts null (or sentinel like `STANDALONE`); existing Add Slot, Upload, Get Summary affordances handle the entire flow. No new surface. No generic-project machinery built. (See Sibling Not Sibling Surface.)

### 5. Slot-Type Unifies Outbound Scheduling *(operationalized S4)*

The schedule is a unified calendar of slots. Each slot has a type. Type determines:
- Playbook recipe (how the pre-compose engine fills it)
- Platform target (IG, email, podcast feed, ...)
- Asset shape (reel, image, doc, audio, ...)
- Review/edit affordances on that slot

Newsletter is a slot type. Email blast is a slot type. Instagram reel is a slot type. Podcast release-day announcement is a slot type. Same row shape, same architecture, different recipes.

**Same discipline applies.** Build the social slot types first. Newsletter slot type is the *test* of the abstraction — proves the pattern works when it ships.

**S4 operationalization: slot recipe table is the governance home.** Recipe row drives both pre-compose prompt construction (Vert Fairy Pass 2 reads `Why`, Platform, Ratio) and week-view rendering (`Sort_Order` drives left rail render order). Storage location is Q14 (build-time decision).

Architectural note: the schedule may end up sitting one level *above* projects (a roll-up view of all projects' slots). Decision deferred (Q11).

### 6. Modes Die — Three Surfaces *(refined S3)*

What survives:

| Surface | Role | Used for |
|---|---|---|
| **Design** | Compose visual work (canvas) | Quote graphics, hook images, custom slot backgrounds. Sole active Studio landing tab. |
| **Write** | Compose written work (docs) | Interview prep, show notes, episode copy, newsletters, emails, outreach, brainstorming |
| **Schedule** | Assign pre-composed assets to day slots | All outbound scheduled content. Not yet built — separate surface from Studio tabs. |

The seven-mode list collapses:
- Show Notes / Episode Copy / Brainstorm → Write with a doc
- Interview Prep → Write on episode tab, episode docs pinned
- Social Media → Schedule surface (not yet built)
- Newsletter / Email → Write doc + Schedule slot (future)
- Outreach → Write doc + Send-to-Drafts action

JT never picks a mode. She taps a task; the center pane assembles.

**S3 refinement: Edit Is A Mode pattern for reference docs.** Reference surfaces (Episode Card, Guest Brief, etc.) open read-only inside Writer. Contextual `Edit Contact` / `Edit Description` buttons unlock the relevant editable shape (contact record for brief; description for episode card). Save commits and triggers any associated automation (Gemini grammar diff for Episode Card; Herald re-enrichment for contact).

### 7. AI's Context = User's Surface *(implemented S5)*

The assistant on every surface knows what the user is currently looking at, plus the corpus. Nothing more.

| Surface | Foreground (what the user sees) | Background |
|---|---|---|
| Images / Reels per-asset chat | The asset in focus | Corpus, always available |
| Write | Pinned episode docs + open canvas + user-added docs | Corpus, always available |
| Help Desk | App state (tasks, episodes, contacts, schedule) | Audit_Trail recency window |

**Pinning is a Drive folder convention, not a UI state.** Secretary writes episode-scoped docs to a new `Episode_Copy/` subfolder. Writer, opened on an episode tab, reads that folder. No pin/unpin toggle exists. Naming/structure is the contract.

Known relationships (guest brief from `CONTACT_LIBRARY/{contact_id}/`, transcript from `STAGING_DRAFTS/{epUid}/Episode/`) resolve into the pinned panel at open time — computed, not just folder-scanned. JT does not need to know about Contact Library; she just sees "her docs for this episode."

**My Docs is separate scope.** Cross-episode, user-owned, lives under `JT_FOLDER_ID`. JT can drop docs in via Drive directly, or via Writer's "Add doc" affordance that writes there. Mirrored for Audra eventually.

**Empty Writer canvas is a chooser.** Quick-start buttons (Newsletter / Email / Outreach / Brainstorm / ...) pre-seed half the prompt and pull a doc template. The seven blank Scribe template keys in Governance_Config finally have a home.

**Locked (Hub May 2026): AI Chat lives in the right rail as one icon among others.** Single panel active at a time — no stacking. Rail adapts to whatever canvas is open. Center-right pane = the expanded panel of whatever right-rail icon was activated. Rail composition per surface is locked in Operating Model §7. AI assignment per surface is parked (Q15).

### 8. Pipeline Emails Become Writer Tasks *(confirmed S3)*

Scribe Fairy as an autonomous sender retires. Pipeline communication events (guest invite, scheduling confirm, follow-ups, etc.) spawn **tasks** that, when tapped, open Writer with the right email template pre-seeded and date variables resolved. JT or Audra reviews, edits, sends.

Scribe was never deployed — seven template keys blank, Daily Pulse Loop 2 indefinitely queued — so this cancels a planned build rather than retiring a live system. Scribe Fairy joins Safety and Marcom as a retained dead-code stub (pre-CIM exception).

**What survives from Scribe's plan:**
- Trigger logic (Secretary, Daily Pulse) that already knows *when* pipeline emails should happen. Now spawns tasks instead of teeing up sends.
- Email templates (the seven blank keys) — migrate to Writer Email quick-start templates per Reframe #6.
- Send-to-Drafts action in Writer (already planned).

**S3 confirmation: payload injection happens at Filing time.** Pipeline emails carry payloads (assets folder link for release-day email; Finished folder URL). Filing Fairy writes the payload into the email doc template; GAS verifies the link at Send-to-Drafts against the recorded Finished folder ID. Mismatch blocks send. Gmail Drafts is the terminal gate; JT edits prose, then sends from Drafts. Email-forward escape hatch explicitly killed (JT doesn't check email).

**Connection to Reframe #5:** Some "send-this-once" communication may actually be scheduled outbound content (release-day announcement is the clearest candidate). The audit settles which is which.

---

## Audit Method Reference

The action-completeness audit (Phase 2.0) is **saturated** as of May 2026 — five sessions, all eight reframes confirmed, all eleven lenses touched. The method below is documented as reference for future audit passes; the original audit is complete.

### Lenses (eleven)

| Lens | What it catches |
|---|---|
| Escape hatches | Action paths off the happy path (download from Design, copy text only, ...) |
| Reversibility | Every commit has an uncommit |
| Recovery | Interrupted mid-flow → resume cleanly? lose work? |
| Dead ends | Land on a surface where no action exists |
| Cross-surface need | Want something from another surface without leaving |
| State conflict | Two users act on the same thing |
| Empty / error states | Surface with no data, or after a failure |
| Permission gradients | Audra ≠ JT; mobile ≠ desktop |
| Export / external | Asset leaving the app (download, share, send) |
| Discovery | Can the user *find* the action when they need it |
| **Cognitive Load** *(S1)* | Does this surface state require the user to remember, decide, or repeat something the platform could carry? |

### Audit user

**JT + Audra.** *(reframed S1)* Audra-as-architect builds; Audra-as-user works inside the platform. Both users' surfaces are in scope under the same principles.

### Phase 2.0 Saturation Marker

- **5 sessions** (S1–S5, May 11–12 2026)
- **All 8 reframes confirmed** under real workflow signal
- **All 11 lenses touched** — export, state conflict, dead end, discovery, empty/error, permission gradients closed by operational reality + existing architecture rather than new design
- **Net new design surfaces from Phase 2.0:** Pending slot canvas (Next + Poke buttons); Edit Is A Mode pattern; four-pane desktop chrome; episode tab anatomy; icon state machine three-color lock

---

## Derived Structure

### Surface Roles
Every surface answers to exactly one role. If a surface wants to do two things, it's the wrong surface.

| Role | Purpose | Surfaces |
|---|---|---|
| Triage | What needs you right now | Left rail with state icons; per-tab Resume By Priority |
| Schedule | Pre-composed assets assigned to day slots | Schedule surface (not yet built — separate from Studio tabs) |
| Compose | Sit-down creative work | Writer, Design (canvases inside episode tab or free workspace) |
| Browse | Reference and state lookup | Contacts, episode tab summary view |

### Two Rhythms (JT)
- **Daily, mobile** — "What needs me?" Small bites. Triage + review + edit-and-react.
- **Weekly, desktop** — "Get the week scheduled." One sitting. Publish surface.
- **Occasional, desktop** — Specific creative work. Writer or Design.

Audra: same rhythms + pipeline ops (filing, herald, debug) via role-filtered icons on the same left rail.

### Left Rail Composition

Guest names are root nav items. Each guest expands to: **Images · Reels · Episode · Show Notes · Schedule**. **Write** (with Brainstorm) and **Tasks** (with Buckets and Episodes) are peer root items. Design as a standalone root surface is retired. (Audra only) Ops drawer or right-rail Ops icon (placement Q16).

**Conceptual note:** Tasks is the lens. Episodes and Buckets are organization modes within Tasks. Tasks → Episodes is the dashboard and app entry point.

Pure navigation — no state signals, no badges. State rides the card on the Tasks screen.

### Three AI Surfaces
All three follow Reframe #7 (context = surface). All three sit in the same chat-bubble + chip primitives spec.

| Surface | LLM | Scope |
|---|---|---|
| Images / Reels per-asset | Claude (Phase 4 — not yet built) | Refinement of asset-in-focus; companion scoped to active asset only |
| Writer canvas | Claude | Writing assistance scoped to pinned + open docs |
| Help Desk | Gemini | Informational ops chat — read-only across app state |


### Canvas Open-State Rule *(refined S5)*

- **New session (first app open of the day / after close):** top-priority surface auto-selects. Last navigation state is NOT preserved.
- **Direct navigation while already in-app:** last state IS preserved on return.

Within-Session State Persists; Cross-Session Resets To Priority *(corollary, S5)* governs this.

### Pending Slot Canvas *(locked S4)*

When JT taps a Pending slot, the canvas opens with two buttons. No narration, no error.

| Button | Behavior |
|---|---|
| **Next** | Skip to the next actionable slot/task. Resume By Priority in button form. |
| **Poke** | Spawn an idempotent task targeting upstream (Audra). One open task per `(episode_uid, asset_type, slot_day)` regardless of how many times JT pokes. |

Poke channel: task spawn only. SMS is reserved for pipeline-blocking failures (S2). "JT wants this faster" doesn't meet that bar.

Three Cognitive Offloading corollaries converge here: Absence Is A Signal + Resume By Priority + Point, Don't Narrate. Two buttons. Three lenses simultaneously closed (dead end, discovery, empty/error).

### Episode Revision Workflow *(spec-complete S2)*

- **Player:** Custom HTML5 player, GCS-served (signed URL + native `<video>`), timestamped comment overlay
- **Commit gesture:** *Request Revisions* button. Soft commit — Audra's icon flips gold→red (her batch signal), but JT retains add/delete comment ability until Audra uploads v2
- **Comment data model:** Add and delete only — no edit (eliminates edit-drift class entirely). States: Active (top) / Resolved (✓ + strikethrough, demoted bottom) / Deleted (strikethrough only, demoted bottom). Sorted by episode timestamp within each section. Both demoted states persistent and visible to both parties.
- **Approve:** Explicit terminal gesture for "no revisions needed." Late changes go through text/Slack to Audra.
- **Permission gradient:** JT adds/deletes own comments + Request Revisions + Approve. Audra uploads v2 (triggers resolved-checkmarks); cannot edit JT's comments.

### Reel Revision Workflow *(spec-complete S2)*

- **State machine:** Star (existing) auto-applies on Request Revisions; manual Star + unstar allowed. Star ≠ schedule gate. Revision pending = schedule gate (`Availability = blocked`). "Edited" pill after v2, auto-clears on view.
- **Trim path (JT self-service via Vids):** 3-state Edit Reel button → workfile saves in shared drive Reels folder → JT trims by transcript → exports to her My Drive → Sync moves export to shared drive via Sentinel Fairy.
- **Sentinel Fairy** (separate GAS project bound to JT's account): triggers time-based (hourly fallback) + on-demand via Sync. Scans Vids Exports → matches by root-filename + timestamp → moves to shared drive → notifies project's web app.
- **Asset_Library schema (final):** `Asset_Library_ID · Source_Filename · Episode_UID · Asset_Type · GCS_Path/Drive_File_ID · Version_Number · Status · Availability · Starred · Vids_Workfile_ID · Updated_At`. No Version_History JSON. Comments anchor via `Resolved_At_Version` integer.

### Audra Ops Surface *(reframed S2 + carried S5)*

**Primary (daily):** JT revision queue → already lives in left rail via icon states. No new surface.

**On-demand / rare:** Fairy Remote Control, Audit_Trail viewing, Governance edits, Failed task re-trigger. All drop to *Hidden Until Engaged* — accessible behind avatar dropdown OR right-rail Ops icon. Final placement Q16.

**Easy Fix spec (finalized S2):** Fairy name + step + timestamp + one link (deep-link to Audit_Trail entry) + Re-trigger button. No prose generation (Point, Don't Narrate).

### Channel Rules — Audra *(locked S2)*

- **SMS:** pipeline-blocking failures + JT-marked-urgent revisions only. Low volume; no rollup, no throttle.
- **In-app overlay/badge:** dashboard card icons satisfy this; no separate badge build.
- **Email killed.** Audra doesn't check it.
- **JT-urgent toggle:** two-step friction ("Mark Urgent" → "Confirm — this SMSes Audra").

---

## Pipeline Implications

### Secretary Fairy
- Creates new subfolder `Episode_Copy/` under `STAGING_DRAFTS/{epUid}/`
- Episode Card writes here (was: ambiguous location)
- Herald form answers, if persisted as a doc, write here
- Existing folder structure otherwise unchanged

### Vert Fairy (Pass 2 redesign)
- Per slot in the upcoming week, generates 2–3 pre-composed option records, each with:
  - Caption (platform-aware, slot-type-aware) — prompt reads `Why` cell from slot recipe table *(S4)*
  - Background image — chosen from `IMAGE_BACKGROUND_LIBRARY_ID` OR Gemini-generated at pre-compose time
- Writes records to Asset_Library, one row per option
- Selection state, edits, and chat history per option are columns on the row

Cost note: image generation per slot × options × episodes is a real API spend bump. Strategy decision deferred (Q13).

### Filing Fairy *(expanded S3)*
- `Episode_Copy/` moves with the rest of the episode at filing time (treat as standard asset subfolder)
- **New: subfolder condensation at staging → Final move** (assets + social media swipe copy → one designated spot)
- **New: release-day email template link injection** (write Finished folder ID-derived link into the email doc)
- **New: Finished folder ID recorded in Episodes tab** for GAS Send-to-Drafts verification
- No corpus deposit changes

### Daily Pulse *(expanded S4 + S5)*
- **New: on-demand Reel summary trigger** — doPost endpoint for mid-week JT-uploaded reels (Daily Pulse handles scheduled batch; on-demand for ad-hoc)
- **New: active-set tab sweep** — daily re-evaluation of which episode tabs render (Drive folder exists → final post end-of-day)

### Scribe Fairy
- Retires as autonomous sender (was never deployed)
- Dead-code stub retained (joins Safety, Marcom — pre-CIM exception)
- Trigger logic that already exists in Secretary and Daily Pulse rewires to spawn email tasks instead of teeing up Scribe sends
- Seven blank Scribe template keys (`SCRIBE_INVITE_KEY` et al.) migrate to Writer Email quick-start templates

### Sentinel Fairy *(new, S2)*
- Separate GAS project, bound to JT's account (project service account can't read JT's My Drive)
- Triggers: time-based hourly fallback + on-demand via web app `doPost()` called by Sync button
- Logic: scan Vids Exports folder → find file matching reel root → exponential backoff for render-not-yet-complete → move to shared drive → notify project's web app → archive older versions
- Failure mode: after 3rd attempt, surface "Google is still cooking your video. Tap Sync again in a minute."

### Slot Recipe Table *(new, S4)*
- Columns: `Slot_ID · Day · Asset_Type · Platform · Why · Sort_Order · Ratio`
- Read at pre-compose time (Vert Fairy Pass 2) and at week-view render time (Publish surface)
- Authority on what a week looks like per episode
- Storage location Q14

### Playbook (the doc)
- Currently social-only
- `Why` column entries in slot recipe table are the operational Playbook *(S4)*
- Doc-form Playbook expands to a library of slot-type recipes (social first; newsletter / email recipes added when those slot types ship)
- Lives in `CORPUS_DRIVE_FOLDER_ID` for cached prefix injection (per Phase 4.2 plan)

---

## Feedback Loop

Pre-compose engine learns over time without machine learning — authored iteration.

- Every chat (Publish refinement, Writer assist, Help Desk) is JSON in/out. Capture is cheap.
- Selections (which of the 2–3 options JT chose) are explicit signal.
- Edits to selected options are implicit signal.
- Weekly audit by Audra: read the week's conversations + selections + edits → refine Playbook content + prompts.
- **The Playbook tunes by Audra editing `Why` cells in the slot recipe table.** *(S4)* No code change.
- The Playbook gets sharper. Pre-compose gets closer to "what JT would have written" each cycle.

Capture target is an Open Question (Q12).

---

## Open Questions (cumulative; resolved entries dropped)

| # | Question | Status | Lands in |
|---|---|---|---|
| Q1 | Default state of a pre-composed slot | **Resolved S2 / S4** — Slot Is The State + Pending Is Derived. Default = pre-composed-as-drafts uncommitted; Pending derived when no available asset. | — |
| Q2 | Swap between pre-composed options on mobile — pure selection vs forbidden | Open | Surface Principle update |
| Q3 | Option count — exactly 3 always, or variable by episode richness | Open | Vert Fairy job spec |
| Q4 | Episode Detail — survive as "more" destination, or fold into episode tab default | **Resolved S5** — no Episode Detail; episode tab summary view + reference panel. | — |
| Q5 | Tab scaling — archiving / collapse rules for 17+ episodes | **Resolved S5** — active set rule; archive surface deferred. | — |
| Q6 | Help Desk placement — right rail or folded into free workspace tab | **Partially resolved S5** — right-rail icon. Canvas-aware visibility detail = Q15. | Phase 2.4 |
| Q7 | Audra's ops surfaces — hidden tab, drawer, or out of scope | **Resolved S2 + S5** — same left rail, role-filtered icons; ops drawer Hidden Until Engaged. Drawer placement = Q16. | — |
| Q8 | Default center pane when episode tab is selected and has no pending task | Open | Phase 2.4 |
| Q9 | Pinned-docs context budget — default-pinned ≠ default-injected vs whole-panel-injects-with-truncation | Open | Phase 2.4 + Publish AI Companion design |
| Q10 | Templates location — seven Scribe template keys + new ones; storage scheme | Open *(S3 confirmed migration to Writer quick-starts; storage scheme still TBD)* | Phase 2.1 + Writer spoke |
| Q11 | Schedule placement — inside Publish per-project, or a level above as roll-up | **Resolved Hub, May 2026 (updated May 2026)** — Schedule is per-guest, a sub-item under each guest's nav root. Not a global surface. | — |
| Q12 | Feedback loop capture target — Interactions tab vs Audit_Trail append vs Asset_Library chat_history column | Open | Phase 2 schema review |
| Q13 | Background image strategy at pre-compose — library-first with Gemini fallback, or fresh per slot | Open | Vert Fairy job spec |
| **Q14** *(new S4)* | Slot recipe table storage location — Master Sheet tab vs Governance_Config | Open | Build-time decision |
| **Q15** *(new S5)* | Right rail icon registry per canvas type — which canvases show which icons | **Partially resolved** — table locked in Operating Model §7; AI assignment per surface parked for follow-up Hub | Follow-up Hub |
| **Q16** *(new S5)* | Audra ops drawer final placement — avatar dropdown vs right-rail Ops icon | Open | Phase 2.4 |
| **Q17** *(new S5)* | Center-right pane behavior — overlay canvas, push it, or float | **Resolved — push.** Canvas and panel both visible simultaneously. Rail panel sits to the right of the canvas; both occupy the center area together. | — |
| **Q18** *(new S5)* | Within-session vs cross-session state distinction — implementation pattern (session token? timestamp window?) | Open | Phase 3 build |

---

## What Is NOT Decided

Listed explicitly so future sessions don't drift into assuming any of these:

- The component library card design (Phase 2.1)
- The mobile chrome details beyond the rule (Phase 2.3)
- The desktop chrome details beyond the four-pane structure + left rail shape (Phase 2.4)
- The schedule panel visual design (Phase 3.3)
- The Writer canvas chooser visual (Phase 3.x)
- ~~Whether the schedule view is per-project, global, or both (Q11)~~ **Resolved** — global surface, grouped by guest/week
- Project_Types registry, multi-project routing, generic data model — **do not build until a second project appears**
- Slot-type recipes for non-social types — **do not build until those slot types ship**
- Bank_Clip pool (flagged S4 as deferred; future feature, architecture already supports it via nullable Episode_UID)
- Archive surface for past episodes (deferred S5 until JT asks for it)

---

## Principles Captured (cumulative)

In addition to the three foundation principles (Surface, Performance, Cognitive Offloading), this design phase names:

**Generic in name, specific in build.** *(v1.1)* Use abstract nouns and structures wherever they don't cost extra. Build only the case currently in front of you. The day a second case appears, generalize then — with real evidence, not a guess.

**AI's context = user's surface.** *(v1.1)* The assistant knows what the user sees, not what's in the database. Corpus is always available; foreground is the current surface only.

**Mode follows task.** *(v1.1)* The user does not choose between Publish, Writer, and Design. The task they tap determines which surface assembles.

**Pinning is a folder convention.** *(v1.1)* Drive folder structure is the contract. The UI reads it. There is no pin state to manage.

**The slot is the state.** *(v1.3, S2)* No commit moments separate from filled. JT sees state, not mechanism.

**Pending is derived.** *(v1.3, S4)* Slot states computed at render time. No Status enum drift.

**Sibling, not sibling surface.** *(v1.3, S4)* Same scheduling pattern → same surface. Nullable foreign keys, not parallel UIs.

**Library holds kept things only.** *(v1.4, Hub May 2026)* Asset_Library is the permanent record of things JT chose. Suggestions live in a self-clearing store; only tapped/accepted work crosses into Asset_Library.

**Two-room model.** *(v1.4, Hub May 2026)* Design (make/edit) and Schedule (place/assign) are separate rooms with bidirectional ID-passing doorways. No chained flow; no modal within modal.

---

## Sequencing Impact on Build Playbook v5

This document remains input to Phase 2 work. Specifically:

- **Phase 2.0 (Action-Completeness Audit)** — **complete.** Saturation marker locked S5. Output: this v1.3 + `DWYP_User_Flows.md` v1.0.
- **Phase 2.1 (Component Library)** — card design reflects: episode-tab-as-card, Design canvas interaction, refinement-chat-as-chip, Edit Is A Mode pattern, three-color icon state machine, Pending slot canvas (Next + Poke buttons), 3-state Edit Reel button
- **Phase 2.3 (Mobile IA)** — Reframe #3 is the spine; mobile verb inventory locked S1
- **Phase 2.4 (Desktop Chrome)** — four-pane structure locked S5; resolve Q6, Q8, Q9, Q15, Q16 (Q17 resolved: push)
- **Phase 3.3 (Schedule Panel)** — Pending-as-derived render pattern; option chooser UX (resolve Q3, Q13)
- **Phase 4.2 (Playbook Strategic Content)** — load-bearing; `Why` cell content is where this lands
- **Phase 4 (AI Companions)** — per-asset chat in Images / Reels surfaces; refinement-only scope confirmed. Publish tab retired; companion now targets Images/Reels within guest nav.

Build Playbook v5 sequencing otherwise unchanged. Phase 1 (perf foundation) and Phase 0 (housekeeping) are unaffected.

**Scribe spoke (cancelled v1.1):** Confirmed. Triggers rewire to spawn Writer email tasks. Templates migrate to Writer quick-starts. Scribe Fairy stub stays (pre-CIM exception — explicit retention decision).

---

*DWYP_App_Structure v1.4 — May 2026. Companion: `DWYP_User_Flows.md` v1.1.*
