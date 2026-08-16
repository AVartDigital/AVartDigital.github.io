# Visualizer Reference Analysis — batch 1 of 2

Analysis of the first five reference clips for the ReadySet Audio Visualizer
feature. Batch 2 (five more clips) is pending.

**Target app:** `ReadySet (Copy)` — `6a55453d45b64999490b66f6`. It is the only
app carrying `VisualizerControls`, `AudioVisualizer`, `src/lib/visualizer/*`
and the `audio_visualizer*` Session fields.

## How these numbers were produced

Every clip was decoded to raw RGB at 96×54 / 15 fps and measured with numpy —
luma envelope, hue histogram weighted by brightness, frame-to-frame motion,
vertical/horizontal energy distribution, mirror symmetry, radial profile and
loop-seam error. Nothing below is eyeballed from a thumbnail.

Common format: **960×540, 30 fps, H.264.** Durations 5.0–20.0 s.

### Audio: not available in this batch

Only clip 5 carries an audio track, and it is **digital silence** (peak 0.0,
RMS 0.0 across all 320,171 samples). No correlation between sound and image can
be measured from these files. Every "Audio Response" section below is therefore
a **design proposal inferred from the visual behaviour** — which element moves,
how fast, and on what rhythm — not a measured relationship. Flagged explicitly
so nobody later mistakes it for analysis of the source.

## Name mapping status

Two clips map to a screenshot name with confidence. Two are proposed. One is
held.

| Clip | Assignment | Confidence |
|---|---|---|
| Style 3 | **Hyperdrive** — "Neon wireframe tunnel flythrough" | Confident |
| Style 4 | **Core** — "Pulsing energy orb with corona" | Confident |
| Style 1 | **Signal** — "Cyberpunk data-rain glitch" | Proposed |
| Style 2 | **Stage** — "Concert lighting rig with haze" | Proposed |
| Style 5 | *held for batch 2* | — |

The arithmetic supports holding clip 5: six screenshot names remain unmatched
(Terrain, Swarm, Chrome, Prism, Aurora, Warp) against clip 5 plus the five
incoming clips — exactly six. Assigning clip 5 now would likely mis-seat one of
batch 2.

Note also that the **current code has drifted off the screenshot**: `styles.js`
routes all ten styles through `referenceShaders.js`, and `hyperdrive` is
presently labelled "Nebula Pulse — Swirling cosmic cloud". The screenshot (the
stated design reference) and clip 3 agree that Hyperdrive is a tunnel. The
original, on-identity shaders still exist in `src/lib/visualizer/shaders.js`
(`FRAG_HYPERDRIVE` is commented "neon wireframe tunnel flythrough") and are now
dead code.

---

## Style 3 → Hyperdrive

**Reference:** `AudioVisualizerReferenceStyle3.mp4` — 9.60 s, 288 frames.

### Overall visual identity
A corridor of neon dashes rushing past the camera toward a vanishing point.
Recognisable in one frame by the split palette: hot red/orange above, electric
cyan below, meeting at a bright point dead centre.

### Composition
Measured horizontal energy is **L 0.214 | C 0.099 | R 0.214** — the centre is
the *darkest* region. Energy lives on the walls; the middle is the hole the
viewer is travelling into. Radial profile is U-shaped (0.227 centre → 0.164 at
mid-radius → 0.192 at the edge), confirming a bright-walled, dark-cored tunnel
rather than a centre-weighted burst.

### Geometry
Discrete dash segments — not continuous lines — arranged on the walls of a
rectangular corridor, scaling and streaking toward the vanishing point. A
reflective floor doubles the lower bank.

### Colour / lighting
Cyan 36%, rose 26%, red 19%, azure 12%. Two opposed families (warm above, cool
below) with almost nothing in the greens/yellows. 45% of pixels sit below luma
0.05: the black is genuinely black and carries the contrast. Bloom is heavy on
the dashes, and the floor reflection is blurred and dimmer.

### Motion
Continuous forward flythrough at constant heading. Frame delta averages 0.060.
The luma envelope is by far the most dynamic of the five — **std/mean 0.66**,
ranging 0.001 → 0.366 — i.e. the whole frame surges and goes near-black
repeatedly. That is a strobe/impact behaviour, not a steady drift.
**Left-right symmetry 0.99** — near-perfect mirror. Top-bottom 0.23 — deliberately
not mirrored, because the palette splits on that axis.
**Loop seam 0.0036** — the cleanest of the batch; this clip loops seamlessly.

### Audio response (proposed)
- **Bass / kick** → forward velocity surge and the global brightness pulse that
  produces the measured 0.66 envelope swing.
- **Mids** → dash density and wall brightness.
- **Highs** → the fine dash flicker and sparkle near the vanishing point.
- **Beat** → a short camera punch toward the vanishing point plus chromatic
  aberration, decaying over ~200 ms.
- **Idle** → constant forward travel continues at a base speed; music modulates
  it rather than starting it.

### Recommended rendering approach
Single fullscreen fragment shader. Tunnel coordinates by polar remap
(`z = k/r`), dashes from a quantised grid in (angle, z), palette split by sign
of `uv.y`, floor reflection by mirroring the lower half with blur and falloff.
No geometry needed. This is the cheapest of the five to run and the best first
vertical slice.

---

## Style 4 → Core

**Reference:** `AudioVisualizerReferenceStyle4.mp4` — 6.70 s, 201 frames.

### Overall visual identity
A luminous ring with a dark hole at its centre, wrapped in a spiky iridescent
corona, floating in front of a soft blurred spectrum backdrop.

### Composition
Strongly centre-weighted: radial profile falls **0.467 → 0.153** from centre to
edge, the steepest of the five. Left-right symmetry 0.85 and top-bottom 0.78 —
close to radially symmetric, which is what separates it from every other clip
here. A dim reflection sits below the ring.

### Geometry
Two or three concentric rings; the outermost is broken into fine radial spikes
whose lengths vary around the circumference. The centre is a true void, not a
bright core. Behind it, heavily defocused vertical bars.

### Colour / lighting
Cyan 72%, azure 25% — the most monochromatic clip in the batch, essentially a
single hue with brightness doing all the work. Small violet/magenta glints ride
the spike tips. Backdrop is desaturated grey-teal.

### Motion
Base motion is slow rotation and breathing. Frame delta averages 0.039 but
**peaks at 0.153** — nearly 4× the mean. The movement is punctuated: long calm
passages interrupted by sharp corona flares. Luma envelope is moderate
(std/mean 0.15). Loop seam 0.099 — does not loop cleanly.

### Audio response (proposed)
- **Sub/bass** → ring radius and the hole's diameter, breathing slowly.
- **Mids** → backdrop bar heights behind the ring.
- **Highs** → per-spike lengths around the rim (the spikes *are* a circular
  spectrum, so map FFT bins to angle directly).
- **Transient** → the flare bursts that produce the 0.153 motion peaks; this is
  the clip's signature and must be onset-driven, not level-driven.
- **Idle** → slow rotation plus a gentle radius breath continues in silence.

### Recommended rendering approach
Fragment shader in polar coordinates. Rim spikes from a mirrored spectrum
lookup by angle; corona from radial noise modulated by the same lookup; backdrop
as a cheap blurred bar field composited behind. Bloom carries the glow.

---

## Style 1 → Signal *(proposed)*

**Reference:** `AudioVisualizerReferenceStyle1.mp4` — 18.83 s, 565 frames.

### Overall visual identity
Columns of light rising and falling from a hard horizon line, mirrored into a
wet floor beneath. Reads as data/telemetry rather than music: fine, dense,
high-contrast.

### Composition
Energy is tightly banded: **top 0.063 | mid 0.334 | bottom 0.055**. Everything
happens in a horizontal strip across the middle third; the top and bottom are
near-empty. Radial profile falls 0.405 → 0.023, so the band is also vignetted
toward the frame edges. Left-right symmetry is only 0.51 — the bar pattern is
genuinely asymmetric, as a real spectrum would be.

### Geometry
Vertical bars of varying height, many broken into dashes/segments rather than
solid, sitting on a bright horizontal rule. Below it, a blurred, streaked
reflection.

### Colour / lighting
Red 55%, spring-green/teal 28%, orange 12%. A two-family palette — warm bars
against teal — on deep black (45% of pixels below luma 0.05). The horizon rule
is the brightest single element.

### Motion
Frame delta 0.034 — the second calmest clip. Luma envelope std/mean 0.21, so
brightness varies moderately as bars rise and fall. Loop seam 0.116 — no clean
loop. Motion is dominated by bar height changes, not camera movement.

### Audio response (proposed)
- **Spectrum → bar heights directly**, log-spaced bins across x. This clip is
  literally a spectrum analyser; anything else would lose its identity.
- **Bass** → horizon-rule brightness and the reflection's intensity.
- **Highs** → the dash/segment breakup within tall bars.
- **Beat** → brief horizon flash.
- **Idle** → bars settle to a low shimmer; the rule keeps glowing.

### Recommended rendering approach
Fragment shader sampling a spectrum texture by x, with segment quantisation in
y and a mirrored, blurred lower half. Very cheap.

---

## Style 2 → Stage *(proposed)*

**Reference:** `AudioVisualizerReferenceStyle2.mp4` — 5.03 s, 151 frames.

### Overall visual identity
The same bar-field concept as Style 1, restaged as a festival: full-spectrum
beams, thick atmospheric haze, and a floor of glittering bokeh.

### Composition
The brightest clip by a distance — mean luma 0.324 with **only 1% of pixels
near black**. There is no empty space; haze fills everything. Energy: mid 0.401,
bottom 0.323, top 0.247 — the floor carries almost as much as the beams.

### Geometry
Vertical beams rising from a luminous horizon, plus a dense field of out-of-focus
circular bokeh particles occupying the lower half and drifting upward.

### Colour / lighting
The most polychromatic clip: rose 18%, blue 16%, violet 16%, magenta 15%, with
the remainder spread across green/yellow. No dominant hue — each beam takes its
own colour. Purple atmospheric haze binds it together.

### Motion
Frame delta **0.081 — the highest of the five**. Busy and fast. Yet the luma
envelope is the *flattest* (std/mean 0.08): lots of local movement, little
global brightness change, because the haze floors the histogram. Loop seam
0.169 — the worst; no clean loop.

### Audio response (proposed)
- **Spectrum** → beam heights, with per-beam hue fixed by bin index so the
  rainbow stays stable rather than cycling.
- **Bass** → haze density and floor glow.
- **Highs** → bokeh particle count, drift speed and twinkle.
- **Beat** → a burst of upward particles.
- **Idle** → haze breathes and particles keep drifting; beams idle low.

### Recommended rendering approach
Two layers: a fragment-shader beam field plus an additive point-sprite particle
system for the bokeh (depth-of-field look needs real sprites, not a shader
fake). This is the most expensive of the batch and the one that will need
quality scaling on TV hardware.

---

## Style 5 → *held for batch 2*

**Reference:** `AudioVisualizerReferenceStyle5.mp4` — 20.01 s, 600 frames.

### Overall visual identity
A technical HUD: concentric thin rings with a circular spectrum readout around
the rim, deep blue, with a soft glow source at the top of the frame.

### Composition
Left-right symmetry 0.94; horizontal energy L 0.059 | C 0.128 | R 0.058 — a
centred, symmetric instrument. The radial profile peaks slightly *off* centre
(0.115 → 0.120 → 0.098 → …), i.e. the energy is in a ring band, not at the
middle.

### Geometry
Several perfectly concentric circles of differing radius and line weight; one
rim carries a fine tick/spectrum readout; occasional straight diagonal
scan-lines sweep through.

### Colour / lighting
**Azure 95%** — the most single-hue clip in the batch. Very dark overall (mean
luma 0.082, 27% of pixels near black). Lighting is a single soft bloom at top
centre.

### Motion
The calmest clip by an order of magnitude: frame delta **0.0036** (Style 2 is
22× more active) and luma envelope std/mean **0.03** — essentially constant
brightness. This is an ambient, slow-rotation piece. Loop seam 0.010 — loops
almost cleanly.

### Audio response (proposed)
- **Spectrum** → rim tick heights, mapped around the circle.
- **Mids** → ring rotation rate.
- **Transient** → the diagonal scan-line sweeps.
- Deliberately restrained: this reference's identity *is* its calmness, so
  audio should modulate it subtly. Over-driving it would destroy what makes it
  recognisable.

### Recommended rendering approach
Polar fragment shader; near-free to run. A good candidate for the low-power
fallback on weak TV hardware.

---

## Cross-cutting observations for the implementation

1. **Three of five are spectrum-bar or ring instruments** (1, 2, 5). The shared
   infrastructure needs one good log-spaced spectrum texture and a mirrored
   polar lookup; those two primitives cover most of this batch.
2. **Black level is a design element.** Clips 1 and 3 put 45% of pixels below
   luma 0.05. The current renderer's UnrealBloom defaults will wash that out —
   bloom threshold needs to sit high enough to preserve it.
3. **Only clip 3 loops cleanly** (seam 0.0036). Since we render procedurally
   rather than looping video this doesn't constrain us, but it does mean clip 3
   is the honest one to calibrate motion speed against.
4. **Motion budget varies 22×** across the batch (0.0036 → 0.081). Per-style
   idle-motion constants must be tuned individually, not shared.
5. **Palette handling differs by clip.** Styles 3 and 4 are one or two hues and
   will recolour cleanly from a user palette. Style 2 is intrinsically
   polychromatic — forcing a single user colour onto it destroys its identity,
   so it should map the user's palette across its beams as a *gradient range*
   rather than a flat replacement.
