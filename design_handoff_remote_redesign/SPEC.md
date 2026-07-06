# SPEC — CastParty Mobile Remote Redesign

## Overview
Redesign of the CastParty **mobile remote** screen. The original remote's buttons, functions, and color meanings are **all preserved**; the visual language was rebuilt to a minimalist, thin-outlined aesthetic (hairline strokes, circular icon buttons, uppercase tracked micro-labels, generous spacing) on a dark theme with a **blue** brand accent. A D-pad control ring replaces the linear transport row, and several additive features were introduced (playlist sheet, TV-message styling, connection health, empty/disconnected states).

## About the design files
The files in this bundle are **design references created in HTML** — a prototype showing intended look and behavior, **not production code to copy**. Recreate this design in the CastParty app's existing environment (its framework, component library, styling system, and conventions). If a piece of UI here has no equivalent in the app yet, add it following the app's established patterns.

## Fidelity
**High-fidelity.** Exact colors, typography, spacing, radii, and interactions are specified below and should be matched precisely, mapped onto the app's existing design tokens where they exist.

---

## Design tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| Background (app) | `#070b12` | Page background |
| Surface / sheet | `#0a1120` | Playlist bottom sheet |
| Brand blue | `#4a9eff` | Primary accent, active states, primary buttons |
| Blue light | `#8cc4ff` | Play glyph gradient top, active text, icon highlights |
| Blue hover | `#5aa8ff` | Primary button hover |
| Text primary | `#e9f0f9` / `#eaf1fb` | Main text |
| Text on-blue | `#06101f` | Text/icons on blue fills |
| Text secondary | `#cfe0f5` | Icon buttons, secondary labels |
| Muted text | `rgba(185,203,230,.5)` | Section labels, meta |
| Danger red | `#ff8080` | End Session / End / remove |
| Hairline border | `rgba(122,170,235,.25)` | Default outlined borders |
| Hairline border strong | `rgba(122,170,235,.4–.55)` | Hover / emphasis borders |
| Track empty | `rgba(122,170,235,.18)` | Slider unfilled track |

TV-message text-color swatches: `#ffffff`, `#4a9eff`, `#ffd24a`, `#ff6b6b`, `#4ade80`, `#c084fc`.

### Typography
- UI font: **Manrope** (400–800). Uppercase tracked labels throughout (letter-spacing ~1.2–2px).
- Scale: hero/logo 23px/800; section titles 13–15px/700–800 uppercase; body 14px; micro-labels 8.5–10px/700 uppercase; tabular numerics for time/volume/counter.

### Radii & spacing
- Cards / inputs / pill buttons: `14px`; chips & small pills: `99px` (fully round); circular buttons: `50%`.
- Bottom sheet: `22px 22px 0 0`.
- Container: max-width **432px**, padding `22px 18px 40px`, centered.

### Shadows / effects
- Play/primary glow: `0 0 34–36px rgba(74,158,255,.55)`.
- Primary button: `0 6px 22px rgba(74,158,255,.32)`.
- Bottom sheet: `0 -20px 60px rgba(0,0,0,.55)`.
- Active-status pulse keyframe (dot): opacity + expanding ring, 2.2s ease-in-out infinite.

---

## Screen: Mobile Remote (single scrolling screen)

Top-to-bottom regions:

### 1. Header
- Left: wordmark **"Cast" (blue) + "Party" (white)**, 23px/800; subtitle micro-label **"Cast media over Wi-Fi"**.
- Right: **End Session** pill — outlined red (`#ff8080`, border `rgba(255,110,110,.5)`), power icon, uppercase. Ends the session → shows Disconnected state.

### 2. Status pill / connection health
- Full-width rounded pill, hairline border.
- Left: pulsing blue dot + status text: **"Playing on TV"** / **"Paused on TV"** / **"Nothing queued"** (reflects state).
- Right: device name **"LG OLED · Strong"** + a signal-bars icon (last bar dimmed).

### 3. Live preview
- 224px tall rounded card, hairline border, subtle vertical gradient.
- Top-left badge pill: **"Live Preview · Sound On"** / **"Live Preview · Muted"** (reflects mute).
- Center: play glyph + **"Playing on TV"**. (No real video frame — placeholder by design.)

### 4. Player drag handle
- Centered 44×4 rounded bar (visual affordance for the player sheet).

### 5. Now playing
- Left: current track title, uppercase, truncates with ellipsis.
- Right: **Menu** outlined pill + a circular chevron-down (collapse) button.

### 6. Progress
- `elapsed` (left) — range slider — `-remaining` (right), tabular nums. Slider fill uses brand blue up to progress %. Total duration derives from the current track's length.

### 7. D-pad transport (the signature control)
Centered layout: **left key column · circular ring · right key column**.

- **Ring (200px circle, hairline border):**
  - **Up** = Volume + (chevron-up, "VOL +")
  - **Down** = Volume − (chevron-down, "VOL −")
  - **Left** = Previous / skip back (−2.5% progress, "PREV")
  - **Right** = Next / skip forward (+2.5% progress, "NEXT")
  - **Center OK** = Play/Pause — 82px circle, radial blue gradient (`#8cc4ff→#4a9eff`), glow; shows pause bars when playing, play triangle when paused.
- **Left column:** **Loop** (toggle) and **Mute** (toggle). See toggle behavior below.
- **Right column:** **Full** (fullscreen) and **Recast** (re-establish stream).

### 8. Volume row
- Speaker icon (switches to muted glyph when muted) + range slider + readout.
- When muted: slider track greys (`#5a6b82`, 0%), readout shows **"Muted"** in dimmed color. Any volume change clears mute.

### 9. Actions row (3 up)
- **Replay** (outlined circle), **Playlist** (emphasized center — larger 68px circle, blue border + soft blue fill + glow), **Refresh** (outlined circle). Playlist opens the playlist sheet.

### 10. Source / add
- Two buttons: **Other source** (outlined) and **Add media** (solid blue primary, `+` icon, glow).

### 11. Resync
- Full-width **dashed** outlined button: **"Resync / Reconnect to TV"**. Reconnects.

### 12. TV Message — collapsible section (default collapsed)
Header is a full-width outlined toggle button: message icon + **"TV Message"** on the left; character counter (`n/60`, turns red `#ff8080` at cap) + a chevron on the right that **rotates 180° when expanded** (0.2s transition). Expanding reveals, in order:

- **TV Preview** card — renders the typed message live in the chosen font / color / shadow (placeholder "Your message on TV" in dim text when empty).
- **Message input** (max 60 chars) + solid-blue **send** button.
- **Font Style** — 2-column grid of font chips, each rendered **in its own typeface** with a use-case sublabel. Selected chip = blue border + blue tint. Full list & sublabels:
  1. Poppins — Primary UI
  2. Outfit — Premium look
  3. Fredoka — Celebration titles
  4. League Spartan — Large announcements
  5. Nunito — Instructions
  6. Montserrat — Formal events
  7. Cinzel — Classic engraved
  8. Great Vibes — Elegant script
  9. Allura — Flowing script
  10. Alex Brush — Brush handwriting
- **Text Color** — label on the left; **Text Shadow** toggle button on the right (highlighted blue when on, plain outlined when off; label always reads "Text Shadow"). Below: 6 round color swatches; selected swatch shows a blue focus ring.
- **Duration** — two pills: **5 seconds** (clock icon) and **Keep on until off** (pin icon); selected pill = blue tint/border. Controls how long the message stays on the TV.

### Overlay: Playlist bottom sheet
- Dimmed blurred backdrop; sheet slides from bottom (max-width 432px, surface `#0a1120`, rounded top).
- Drag handle; title **"Playlist"**; **Edit/Done** toggle + circular **close** (×).
- Meta line: `{count} items · {total runtime} · My Cast Queue`.
- **List rows:** circular index badge (active row shows pause bars on a blue gradient badge; others show the track number); track title (active = blue); duration on the right. The **active row shows a thin blue progress bar** along its bottom reflecting playback %.
- **Edit mode:** each row swaps duration for **move-up / move-down / remove** controls (remove is red-tinted).
- Tapping a row selects that track (becomes now-playing, progress resets, sheet closes).
- **Add to queue** — dashed button at the bottom appends a track.
- **Empty state:** icon + "Your queue is empty" + "Add media to start building your cast queue."

### Overlay: Disconnected state
- Full-screen dimmed/blurred layer shown after End Session.
- Disconnected-TV icon; title **"Not connected to TV"**; body "Your casting session has ended. Reconnect to pick up where you left off."; solid-blue **Reconnect to TV** button (also triggered by Resync).

---

## Interactions & behavior summary
- **Play/Pause** (OK): toggles `playing`; icon + status text + preview badge follow.
- **Volume up/down & slider:** clamp 0–100; any change clears mute.
- **Mute / Loop:** independent toggles; when on, the corner key highlights blue (text + subtle text-glow) and its label reads "Muted" / "Loop On". Mute also greys the volume slider/readout and swaps the speaker icons.
- **Prev/Next:** nudge progress ∓2.5% (stand-ins for seek/skip — wire to real skip if available).
- **Playlist:** open/close sheet; select / reorder / remove / add tracks; active-row progress bar.
- **TV Message:** collapsible; live styled preview; 10 fonts; 6 colors; shadow toggle; 60-char cap with counter; duration toggle.
- **Session:** End Session → Disconnected overlay; Reconnect / Resync → back to connected.

## State (prototype reference — map to app's real state/services)
`playing, volume (0–100), progress (0–100), muted, loop, currentTrack, queue[], showPlaylist, editMode, connected, msg, fontKey, fontColor, shadow, msgOpen, duration ('5s' | 'keep')`. In the real app these should be backed by the actual casting session / player / queue services; stub with TODOs where a service isn't obvious.

## Fonts to load (Google Fonts)
Manrope (UI) + the 10 message fonts: Poppins, Outfit, Fredoka, League Spartan, Nunito, Montserrat, Cinzel, Great Vibes, Allura, Alex Brush. Load via the app's existing font-loading mechanism.

## Accessibility
- `aria-label` on every icon-only button (labels are present in the prototype for reference).
- Hit targets ≥ 44px; micro-labels ≥ 10px.
- Color is never the only signal (icons + text accompany state).

## Files in this bundle
- `PROMPT.md` — paste-in Claude Code prompt.
- `SPEC.md` — this document.
- `CastParty Remote D-Pad.dc.html` — the interactive design prototype (open in a browser).
- `reference-minimalist-remote.png` — aesthetic reference.
- `before-current-remote.png` — the current remote being replaced.
