STATUS: exploring — decisions locked where marked (D1–D6); open questions (Q1–Q5) unresolved. Not yet scoped for handoff.

# PROPOSAL — Command Center Task Rail (Episodes-surface rename + Buckets retirement)

## Purpose
One persistent, ADHD-safe task surface. Tasks fragment across surfaces today and vanish when tucked into episode detail. Replace the bolted-on Buckets surface with a single global task rail on the (renamed) Episodes surface.

## Problem
- **Object permanence:** consolidating tasks into episode detail = tucked away = forgotten. Tucking is the trap, not the cure.
- **Clutter:** Buckets surface was bolted on, filled to justify itself, now noisy (bars, tiny headers, too many items).
- **Drift (#3):** two task render paths (`renderTaskButtons` dashboard, `st-ep-task` Studio) re-implement per-step affordances and diverge — root of the composer-lock bug class. Correctness cleanup, tracked separately from this rail's UX.
- **Tension to honor:** persistent visibility vs. overwhelm. Too tucked → forgotten. Too much surfaced → tuned out.

## Core model
- The Episodes surface becomes the **command center** (home base), not an episode list. Rail = home; episode detail = drill-in.
- One **global task rail** is the single task home. Accordion.
- Tasks still live on their episode card. The rail is a filtered, organized *view*, not a separate store.

## Locked decisions
| # | Decision |
|---|---|
| D1 | **Relevance filter:** rail shows only tasks whose episode has a release date AND release date ≤ 2 weeks out. All other tasks stay on the episode card, off the rail. |
| D2 | **Grouping axis = user-defined categories** (JT request). Buckets *surface* retired; the category *concept* relocates into the rail as accordion sections. Per-user category sets. |
| D3 | **Empty categories show no header.** |
| D4 | **Collapsed ≠ invisible** (permanence rule): every shown header carries a count; Today/overdue auto-expands and cannot be fully hidden. |
| D5 | **Transient undo toast retires.** Recovery becomes a persistent, global **"Recently completed" panel** (icon) with one-tap un-complete. Deterministic — not routed through Gemini help desk. |
| D6 | **"Oh Shit" producer panel** (`isOwner`, icon-opened): collects dangerous/recovery affordances out of the inline flow — Replace-proxy (Door-2 oopsie), un-complete, dev/recovery functions (e.g. `clear-finalized`). Nothing dangerous sits in the normal path. |

## Open questions
| # | Question | Hub lean |
|---|---|---|
| Q1 | Date vs. category — how do they compose as the rail's organization? (a) category top-level, date-sorted within; (b) date bands top-level (Today / This week / Next week), categories within; (c) toggle the spine. | Date-proximity as spine (matches the 2-wk gate, more actionable), categories as sub-groups. Audra's call. |
| Q2 | Scope: rail shows all statuses, or only open/actionable? | TBD |
| Q3 | Help desk: rail replaces it, or rail gains a mode and help desk stays? | TBD |
| Q4 | Command-center rename — actual name. | **Lean: "Dashboard"** — pending `PROPOSAL_DWYP_Nav_Restructure.md` (Change B). That restructure drops the Tasks subnav and promotes this surface to a top-of-nav "Dashboard" root, resolving the rename + entry-point nav-order + Episode/Episodes collision in one move. If the nav restructure is declined, rename reverts to open. |
| Q5 | Recovery foundation: existing `getEpisodeCompletedTasks` + un-complete affordance is episode-scoped — what does a global panel need? | TBD |

## Candidate enhancements (optional — keep or cut)
| # | Idea |
|---|---|
| E1 | **Resume marker.** Pin the in-flight task at top with progress ("Keanu revise — 4 of 6 addressed — resume"). Kills between-sittings evaporation. |
| E2 | **App-wide count badge** on the command-center nav icon — task presence follows the user across all surfaces, not just the rail's home. |
| E3 | **"Next action" line** at the very top — the single most-urgent item, surfaced for zero-decision days. |
| E4 | **Snooze-with-resurface** — defer a task with a return date; reduce on-screen load without fear of forgetting (system holds it, not the user). |

## Edges
- **No-release-date / >2-wk episodes are invisible on the rail** (intended now-focus). Add a small "N episodes need a date" nudge so the pre-date pipeline doesn't silently rot.
- Per-user categories: JT and Audra hold separate category sets; rail is per-user.

## Retires / survives
- **Retires:** Buckets surface. No data migration — a bucket is a per-user grouping lens in the registry, not a task store; tasks persist in the Tasks sheet.
- **Survives:** user-defined category concept (relocated to rail grouping); Door-2 oopsie (absorbed into the Oh Shit panel).

## Sequencing / caution
- Do **not** bolt on — Buckets is the cautionary precedent. Develop deliberately.
- Mid-Reckoning: stage after current schema work unless explicitly prioritized.
- #3 render-path unification (dashboard vs Studio task cards) is a related correctness fix; may precede or accompany, not gated by this rail's UX decisions.

## Not in scope
- The episode-as-unit / Arrange surface — already exists. This layers attention/visibility on top; not a rebuild.
