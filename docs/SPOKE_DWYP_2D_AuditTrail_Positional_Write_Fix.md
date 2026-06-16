# SPOKE 2-D — Audit_Trail Positional-Write Fix
STATUS: ready for Code

**Mode:** Spoke. Read fully before writing.
**Mandate:** Code Integrity Mandate. Targeted edit at a single call site.
**Source decisions:** `PROPOSAL_DWYP_Schema_Reckoning.md` §8, §16 Phase 2.
**Deployment note:** `/dev` exercises production data; the audit write path is low-risk but writes to the live Audit_Trail.

## Why this spoke exists

One malformed Audit_Trail row (§8):

```
6/10 4:16:18 | DWYP_App | DERIVATIVE_SAVE | 755154ee… (Asset_ID)
```

The `Asset_ID` landed in the `Episode_UID` column and the event name landed in the `Actor` column. A single call site writes the audit row positionally wrong — the column order passed to the write doesn't match the Audit_Trail schema.

## The work (locate, then fix)

1. **Locate** the `DERIVATIVE_SAVE` audit-write call site (the derivative-save path in `dwyp_app.js` / the Studio backend). Grep `DERIVATIVE_SAVE`.
2. **Compare** the argument order it passes against the canonical Audit_Trail write signature (the helper the rest of the codebase uses). Identify the transposed/misaligned fields.
3. **Fix** the call site to pass fields in the correct positions: actor/event/episode_uid/asset_id per the canonical schema. Prefer routing through the standard audit-write helper rather than a bespoke positional write, if one exists and the site is bypassing it.
4. If multiple sites share the same defect, report them before fixing beyond the one named — do not expand scope silently.

## Scope

**In scope:** the `DERIVATIVE_SAVE` write site (and any identical-defect siblings, after surfacing).
**Out of scope:** the broader Audit_Trail column-semantics normalization (inverted `Event_Category`/`Actor`, severity-to-`Level`) — that is **D13**, Phase 2b, a separate spoke. Do not fold it in here. This spoke fixes only the positional transposition at the named call site.

**Note on overlap with D13:** if locating this site surfaces the inverted `Event_Category`/`Actor` usage, **note it for 2b, don't fix it here.**

**Clasp checkpoint:** clasp push → trigger a derivative save on `/dev` → confirm the Audit_Trail row lands with each value in its correct column → surface back. Audra promotes to `/exec`.

## Acceptance

- A derivative save writes an Audit_Trail row with `Asset_ID`, `Episode_UID`, `Actor`, and event name each in their correct columns.
- No other write site shares the defect, or any that does is reported (not silently expanded into).

## Closeout

Capture in State; `STATUS:` → `COMPLETE — safe to delete`, leave in `docs/`. Note in State that broader Audit_Trail semantics remain for D13/2b.
