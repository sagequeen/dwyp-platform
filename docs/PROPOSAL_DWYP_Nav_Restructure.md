# PROPOSAL — Left Nav Restructure
STATUS: exploring (captured 2026-06-14, Audra) — outside the Schema Reckoning arc; DWYP-feature layer. Interlocks with `PROPOSAL_DWYP_Command_Center.md`.

Two linked changes to the left nav. Both reduce nav nodes and resolve naming/ordering incoherence the current structure carries.

---

## Change A — Guest root points to Episode; drop the Episode sub-item

Today: **Guest Name** root points to nothing, with 4 sub-items — Images · Reels · Episode · Schedule.

Proposal: **Guest Name root points to the Episode surface** directly; remaining sub-items are **Images · Reels · Schedule** (3).

**Why**
- Episode is the dense recurring instance and Studio's knowledge layer (Reframe #4 "Project, Not Episode"; Operating Model §9 Episode Index). The guest's center of gravity is their Episode surface — land there.
- Removes a dead root target (a guest node that points nowhere is a cognitive-offload cost).
- Kills the **Episode (guest sub) vs. Episodes (Tasks mode) near-collision** — singular/plural, two clicks apart in one nav. (Note: this collision was NOT the Command Center rename's stated driver — that's functional accuracy — but Change A removes it regardless.)
- "Navigation carries no state signals" (Operating Model §6) preserved — a root pointing to a surface is navigation, not a state signal.

**Open considerations**
- **Root-absorbs-Episode vs. root-as-shortcut.** Is "Episode" still labeled anywhere, or is the guest name itself the label? Risk: losing the explicit affordance for a low-context user.
- **Mobile.** Episode surface is desktop-creation (Surface Principle). What does the guest-root tap do on mobile — hard wall, or mobile-legal view?
- **No-episode-yet guests.** Upcoming/TBD guests — does the root resolve to an Episode surface when the shell barely exists?
- **Sub-item ordering** after the drop (Images · Reels · Schedule).

---

## Change B — Drop the Tasks subnav; collapse to a single "Dashboard" root at top

Today: **Tasks** is a peer root with two modes — **Episodes** and **Buckets**. "Tasks → Episodes is the dashboard and app entry point" (App_Structure), yet it sits *below* the guest roots and Write in nav order.

Proposal: **drop the Episodes/Buckets subnav entirely.** Collapse Tasks to its single surface, **rename it "Dashboard," and promote it to the top of the nav** (the app opens here).

**Why**
- Command Center retires the **Buckets surface** (CC D2 — the user-defined-category concept relocates into the rail as accordion sections). Once Buckets-as-surface is gone, the Episodes/Buckets subnav is a one-item menu = pure noise. Change B finishes what Command Center starts.
- The entry point should be where the eye lands first. Today it's the app's home but sits mid-nav — a quiet incoherence. Top placement fixes it.
- **Resolves Command Center Q4** (the command-center rename) with a functional-accuracy name. "Dashboard" carries zero collision with the guest "Episode" sub.

**Critical dependency**
- **Change B is contingent on Command Center landing.** Until Buckets-as-surface is retired, the subnav has two real items and cannot collapse. B must NOT sequence ahead of Command Center (`exploring`, not yet scoped).

**Do not lose**
- "No subnav" ≠ "no organization." The Buckets *concept* (user-defined categories) survives — relocated from nav-level tabs to in-surface rail accordion sections (CC D2).

**Open considerations**
- **"Dashboard" name voice.** Slightly generic. Acceptable and functional; if a more on-voice word fits (Home / Today / other), Q4 is where it's decided. Default: "Dashboard."
- **Nav reorder touches canon.** Promoting Dashboard to top reorders the Operating Model §6 nav table (currently Guests · Write · Tasks) and the App_Structure left-rail spec.

---

## Net effect on the nav

| Before | After |
|---|---|
| Guest root (dead) → Images · Reels · Episode · Schedule | Guest root → **Episode surface**; subs: Images · Reels · Schedule |
| Write (Brainstorm) | Write (Brainstorm) |
| Tasks → Episodes · Buckets (mid-nav, app entry) | **Dashboard** (top of nav, app entry, no subnav) |

## Disposition

Idea-stage capture. Not for the Reckoning session. If pursued: lands as edits to `DWYP_App_Structure.md`, `DWYP_Surface_Principle.md` (left-rail spec), `DWYP_Operating_Model.md` §6 nav table, closes Command Center Q4, and a scoped UI spoke. **Sequence with/after Command Center; Change B is gated on it.**
