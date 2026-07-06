# Claude Code Prompt — CastParty Mobile Remote Redesign

Copy everything in the block below and paste it into Claude Code from the root of the CastParty app repo. Keep `SPEC.md` and `CastParty Remote D-Pad.dc.html` (this folder) accessible to Claude Code — drop this whole folder somewhere in the repo (e.g. `/design/remote-redesign/`) or attach the files when prompting.

---

We are redesigning the **mobile remote screen** in this CastParty app. I have a finished design reference and a full written spec. Your job is to re-implement our existing remote UI to match the new design **using this codebase's own framework, components, and conventions** — do NOT ship the HTML file; it is a visual reference only.

## Inputs (in this folder)
- `SPEC.md` — the authoritative spec: every screen, component, exact hex colors, typography, spacing, states, and interactions. Build from this.
- `CastParty Remote D-Pad.dc.html` — the working design prototype. Open it in a browser to see the exact look and behavior (hover, toggles, the collapsible section, the playlist sheet, the disconnected state). It is a self-contained HTML prototype — reference it, don't copy it.
- `reference-minimalist-remote.png` — the aesthetic north star (thin outlined, minimalist).
- `before-current-remote.png` — what our remote looks like today (the thing you're replacing).

## What to do
1. **Locate the current remote screen** in this repo and tell me the file(s) before you change anything. Map each existing control to its equivalent in the spec.
2. **Preserve all existing functionality and wiring.** Every button in today's remote must keep its current handler/behavior — this is a visual + layout redesign plus a few additive features (see SPEC "New behavior"). Do not remove features; do not invent backend calls. Where the spec adds UI (playlist sheet, TV-message styling, connection health, empty/disconnected states), wire it to the app's real data/services if they exist, otherwise stub with a clearly-marked TODO.
3. **Rebuild the UI to match the spec** using our existing design system / component library, tokens, and styling approach (do not hardcode a parallel style system if we already have one — map the spec's values onto our tokens, and only add new tokens where nothing equivalent exists).
4. **Match the visual details precisely** — colors, radii, spacing, typography, the outlined/hairline button treatment, the blue accent, and every interactive state described in the spec.
5. **Fonts:** the TV-message feature needs 10 Google Fonts (listed in SPEC). Load them the way our app already loads fonts.

## Constraints
- Follow the repo's existing patterns for state, styling, navigation, and file structure. Match neighboring code.
- Keep it accessible: real `aria-label`s on icon-only buttons, ≥44px hit targets, ≥10px label text (all specified in SPEC).
- Don't refactor unrelated code. Keep the diff scoped to the remote screen and any shared components it legitimately needs.

## Deliverables
- The reimplemented remote screen in our stack, matching the design.
- A short summary of which files you changed, which controls map to which existing handlers, and any place you had to stub because the underlying service/data wasn't obvious.

Start by exploring the repo and showing me the current remote implementation and your mapping plan before writing code.
