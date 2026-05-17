# Spoke: Publish Surface Right Rail (v3)

**Hub session:** Studio v3 Design hub, May 2026
**Spoke scope:** Build the right rail of the Publish surface (Claude panel + Library/Generate toggle). Companion to the Claude Design mockup output for the center pane.

**Companion artifacts (read these first):**
- Claude Design output zip — `[filename].zip` in the repo. Contains the mockup of the Publish center pane (left rail + center pane only; right rail intentionally absent — that's this spoke's job).
- `DWYP_Studio_v3_Publish_Mockup_Brief.md` — original design brief handed to Claude Design (gives context for the mockup's design decisions)

**Architectural authority:** `DWYP_Studio_v3_Design.md` v0.5

---

## Preservation Mandate

Do not simplify, rename, or thin any existing function in the codebase. This spoke adds new components and wires them to the existing Publish surface logic. If you need to extend an existing function, extend it — don't rewrite it. If a function name feels wrong to you, leave it. Surface concerns in your output for Audra to review.

---

## Goal

Build the right rail panel of the Publish surface — two stacked components in a fixed ~420px-wide column on the right edge of the Publish view:

1. **Claude panel** (top half) — persistent AI companion with message history, suggestion chips, and chat input
2. **Library | Generate toggle** (bottom half) — background image picker (Library) with toggle to image-prompt composition (Generate)

The right rail is **always visible** on the Publish surface. Both components are visible simultaneously (not tabs). A subtle star-icon divider separates them.

---

## Context

The DWYP Operations Platform's Studio app is being upgraded from v2 to v3. The center pane of the Publish surface is being mocked up by Claude Design (HTML mockup attached). The right rail wasn't mocked, so this spoke builds it directly.

The right rail's purpose: give JT (the podcast host, the primary end user) a persistent assistant + image-selection tools while she works through her week's social posts. Claude is the reasoner. Library is the asset bank. Generate is the refinement path when Library doesn't have what she needs.

### Companion surfaces

- **Center pane:** Carrie Sipe episode, week strip, day-scoped slot cards stacked vertically, Accordion-as-Focus pattern (one expanded at a time)
- **Left rail:** Episode tabs (initials + state icons) + Loose tasks below
- **Right rail (this spoke):** Claude + Library/Generate

The active slot in the center pane is the right rail's foreground context. Claude's message references it. The Library/Generate panel acts on its canvas.

---

## Design Specs

### Overall right rail

- Fixed width: ~420px
- Full height of the Publish view
- Background: `#FFFFFF` (paper)
- Left border: 1px solid `#E8DFD0` (line)
- Internal padding: 20–22px

### Brand tokens (use as CSS variables)

```css
--cream: #FAF6F0;
--cream-2: #F4EDDF;
--paper: #FFFFFF;
--line: #E8DFD0;
--red: #D12026;
--gold: #FAB016;
--gold-soft: rgba(250, 176, 22, 0.18);
--ink: #1a1a1a;
--ink-soft: #6B6258;
--gray: #D1D1D1;
```

Fonts (Google Fonts, already loaded at the document level):
- `Libre Baskerville` — titles, italic emphasis
- `Nunito` — body, UI, buttons

---

### Claude Panel (top half)

**Header row:**
- Left: word "Claude" in Libre Baskerville italic, 15–16px, color `--ink`
- Right: a small minimize/expand button (icon, optional — JT may want to collapse Claude to reclaim space)

**Thin divider** below the header: 1px `--line`

**Message stream area:**
- Vertical stack of message bubbles
- Latest message at the bottom (chat-style)
- Auto-scrolls to bottom when a new message arrives
- Max-height bounded by available space; scrolls internally if overflows

**Message bubble (Claude):**
- Background: `--cream`
- Border-radius: 10px
- Padding: 14px 16px
- Font: Nunito, 12.5px, line-height 1.55
- Italic emphasis (`<em>`) styled in `--red` italic for tag-call-outs like `<em>discovery + vulnerable</em>`

**Message bubble (user):**
- Background: `--gold-soft`
- Same shape as Claude bubble
- Right-aligned in the column (small inset on the left side)
- Smaller — user messages are typically short

**Suggestion chips** (appear below a Claude message when Claude provides them):
- Pill-shaped, ~30px tall, ~10–14px horizontal padding
- Primary chip: white background, `--gold` border, `#A87000` text, weight 600
- Secondary chip: white background, `--gray` border, `--ink-soft` text
- Tappable; for the spoke, wire them to `sendUserMessage(chipText)` (which routes to the existing Claude API path)

**Chat input** (bottom of Claude panel):
- Single-line input, ~38px tall
- Background: `--cream`
- Border: 1px `--line`
- Border-radius: 19px (fully rounded ends)
- Placeholder: "Ask Claude..." in italic Nunito, color `--ink-soft`
- Send button: small dark circle on the right end with an arrow icon (or use Enter to send)

### Divider between panels

A star-icon-flanked divider:

```
─────── ★ ───────
```

- Two thin horizontal lines (1.5px, `--line`)
- A red star (★) in the center, 12px, `--red`
- ~14px vertical margin above and below

### Library | Generate Toggle (bottom half)

**Toggle bar:**
- Width: 100% of the rail interior
- Background: `--cream-2`
- Padding: 4px
- Border-radius: 18px
- Two segments, each ~50% width:
  - Active: background `--gold`, text `--ink`, weight 700
  - Inactive: transparent, text `--ink-soft`, weight 600
- Smooth transition between states (~150ms)

**Library state (default):**
- Section title above the grid: "Backgrounds" in italic Libre Baskerville, 14–15px
- 3-column grid of image thumbnails
- Each thumbnail:
  - 1:1 aspect ratio
  - Border-radius: 4px
  - Subtle name caption below or overlaid at the bottom (small Nunito, 10px, low-contrast)
- Selected thumbnail: 2px solid `--red` border
- Scrollable internally if grid overflows
- For the spoke, populate with 6 mock entries (gradient/solid-color rectangles in brand colors)

**Generate state:**
- Section title: "Generate" in italic Libre Baskerville
- Prompt textarea:
  - Multi-line, ~80px tall
  - Background: `--cream`
  - Border: 1px `--line`
  - Border-radius: 8px
  - Padding: 12px
  - Font: Nunito 12px, color `--ink`
- Below the textarea, aspect ratio toggle: three pills (4:5, 16:9, 1:1) — active uses `--gold-soft` background
- Generate button:
  - Full-width
  - Background: `--gold`
  - Text: `--ink`, weight 700
  - Padding: 12px
  - Border-radius: 22px
- For the spoke, the Generate button calls a stubbed `triggerGenGem()` that logs to console — real wiring is a future spoke

---

## Behavior Specs

### Foreground awareness

The right rail's components respond to the active slot in the center pane (one accordion-expanded slot at a time):

- **Claude panel:** When the active slot changes, Claude's context updates. For the spoke, this is a JS state variable `activeSlotId` that gets passed into the Claude API call's system prompt. No need to fully implement context-injection — just expose the hook for a future Claude wiring spoke.
- **Library:** Selected thumbnail = `Background_ID` for the active slot's `Canvas_State`. Tapping a thumbnail updates the slot's canvas (call existing `applyBackgroundToSlot(slotId, bgId)` if it exists; if not, add it as a thin wrapper).
- **Generate:** When the active slot changes, the prompt textarea pre-fills with the slot's `Image_Prompt` from its Asset_Library row. JT can edit and trigger Generate.

### Auto-toggle: Library → Generate

If Claude includes an **image-prompt chip** (a chip whose action is "fill the prompt and switch to Generate"), tapping it:
1. Switches the bottom panel toggle from Library to Generate
2. Pre-fills the Generate prompt textarea with the chip's text
3. Focuses the textarea

This is the chip routing from `DWYP_Studio_v3_Design.md` v0.5 — implement the dispatcher pattern so other chip types can be added later.

### Minimize Claude

A small toggle in Claude's header lets JT collapse the Claude panel down to just the header strip. Library/Generate expands to fill the freed space.

When Claude is collapsed:
- Show "Claude" header + maybe a one-line latest-message preview
- Tap header to expand back

### Persistent Claude state

Claude conversation state persists per episode tab. Switching to a different episode shows that episode's separate conversation. Switching back restores it.

For the spoke, store this in a JS Map keyed by `episodeUid`. Real persistence (sheet or session storage) is a future spoke — the storage instructions in this environment don't support browser storage APIs.

---

## Mock Data (for the spoke's working state)

### Initial Claude message (default, when JT lands on Carrie Sipe → Tuesday → Reel slot)

```
I ranked three caption variants for Tuesday's release-day Reel. **Variant 2** ranked highest — it opens with action, names the unspeakable, and lands on the line we tagged <em>discovery + vulnerable</em>. Want to see why the other two ranked lower?
```

(Render `**bold**` as bold; `<em>` as italic with `--red` color.)

### Initial chips on that message

- Primary: "Show comparison"
- Secondary: "Try a different angle"

### Library thumbnails (6 entries)

| Name | Visual |
|---|---|
| Candle, flame | Gradient `#1a1a1a → #6B0010 → #D12026` |
| Linen, morning | Gradient `#FAF6F0 → #F4EDDF → #FAB016` |
| Ash, after | Gradient `#2A2A2A → #3a3a3a` |
| Cloth, red | Solid `#D12026` with subtle texture |
| Dawn, kitchen | Gradient `#FAB016 → #FFE4A0` |
| Field, dusk | Gradient `#2A4030 → #6B6258` |

For the spoke, render these as CSS gradients on `<div>` elements (no real image assets needed).

### Generate panel default state (when Tuesday's Reel slot is active)

- Prompt textarea pre-filled with: *(Reels don't use background images — Generate disabled for Reel slots; show empty state instead. See "Conditional behavior" below.)*

### Generate panel default state (when Monday's Quote Graphic slot is active)

- Prompt textarea pre-filled with: `Soft morning light through linen curtains, warm and grounded, no people, photographic — evokes the quiet moment before speaking a hard truth.`
- Aspect ratio: 4:5 selected (Instagram Story default for this slot)

### Conditional behavior

The Library/Generate panel is **canvas-aware**. Different slot types unlock different panel behavior:

| Active slot type | Library behavior | Generate behavior |
|---|---|---|
| Quote Graphic | Show backgrounds grid | Show prompt + AR toggle (4:5 default) |
| YouTube Thumbnail | Show backgrounds grid (16:9 filter) | Show prompt + AR toggle (16:9 default) |
| Reel | Show "Backgrounds don't apply to Reels" empty state | Hide / show empty state |
| Pending slot | Show "Pick a slot to see options" empty state | Same |

Empty state styling: warm cream block with italic centered text in `--ink-soft`, ~14px Nunito.

---

## Integration with Existing Code

### Before writing anything

1. Unzip the Claude Design output to a working directory
2. Open the mockup HTML in a browser, inspect the structure
3. View the CSS — note the class naming conventions and brand token usage Claude Design landed on
4. Read the existing `dwyp_ui.html` Publish surface section (search for `pb-` prefix)
5. Plan the integration: which Design components replace existing v2 markup, which extend it, which are new

If the unzipped directory has large auto-generated boilerplate (build artifacts, node_modules-equivalents), skip those — focus on `index.html` + the main CSS file. Quick `ls -la` first to see what you're working with.

### Existing functions to reuse

The current Publish surface in `dwyp_ui.html` uses these functions (verify before extending):

- `pbToggleCardPlayer(assetId, e)` — expands a Reel card
- `pbGenerateCaption(assetId, e)` — runs Claude caption generation
- `pbRegenCardTc(assetId, e)` — regenerates title card
- `pbScheduleSlot(...)` / `pbUnscheduleSlot(...)` — slot scheduling
- `getReelsForEpisode(episodeUid)` — fetches reel pool
- `getPublishSchedule(episodeUid)` — fetches recipe + slot states
- `callClaudeAPI(...)` (or similar) — server-side path for Claude calls

For this spoke:

1. Add a new section to the Publish surface markup for the right rail (likely at the end of the existing surface HTML inside `dwyp_ui.html`)
2. Add the CSS for the right rail components (scope under a `.pb-rail` class or similar to avoid collisions)
3. Add JS handlers for:
   - Chip routing (dispatcher pattern — call a chip's action by type)
   - Library thumbnail selection
   - Generate panel state
   - Minimize/expand Claude
   - Auto-toggle Library → Generate on image-prompt chip
4. Expose `pbRailSetActiveSlot(slotId, assetType)` so the existing accordion expansion can call into the rail when a slot opens

### Where to add the markup

Find the existing Publish surface root element in `dwyp_ui.html`. The right rail should be a sibling of the existing center-pane content, inside a flex container. If the surface isn't currently a flex layout, refactor minimally to add the rail without disrupting the center pane.

### Reuse, don't replicate

- Don't write a new Claude API caller — call into the existing `callClaudeAPI` path
- Don't create a separate state machine for slot expansion — read from the existing accordion state
- Don't store Library data in a new sheet — use the existing background asset pattern (or a constants array in JS for the spoke, since real Library storage is a later spoke)

---

## Constraints

- **No browser storage APIs.** Use in-memory JS Map for conversation state. Storage is for a later spoke.
- **No new GAS server functions** — this spoke is client-side only. Wire to existing endpoints.
- **No external dependencies.** No new npm packages, no CDN imports beyond what's already loaded.
- **Preserve all existing Publish surface behavior.** Adding the rail should not change anything about the center pane's current behavior.
- **No real Library or Generate execution.** Library taps update local state; Generate button logs a console message and shows a placeholder loading state.

---

## Deliverable

A patch to `dwyp_ui.html` (and `dwyp_app.js` if any server-side helper is needed — likely not for this spoke) that:

1. Adds the right rail markup, scoped under a clear class prefix
2. Adds CSS for the rail components using the brand tokens
3. Adds JS handlers for the rail's interactive behaviors
4. Wires foreground awareness to the existing slot-expansion state
5. Stubs `pbRailSetActiveSlot()` and the chip dispatcher

### Definition of done

- Right rail renders correctly on the existing Publish surface
- Claude panel shows the initial message + chips
- Library grid renders the 6 mock thumbnails, selectable
- Generate panel toggles correctly, pre-fills based on active slot, shows AR toggle
- Conditional behavior works for Quote Graphic, Thumbnail, Reel, and Pending slot types
- Minimize/expand Claude works
- Auto-toggle Library → Generate on image-prompt chip works
- Existing Publish surface functionality is unchanged
- All existing tests (if any) still pass

---

## Clasp Push Checkpoint

After patches applied and tested locally:

```bash
clasp push
```

Test in the GAS `/dev` URL (staging). Do not push to production. Confirm with Audra before any production deploy.

---

*Spoke prompt — Studio v3 Publish Right Rail — May 2026. Self-contained for Claude Code execution.*
