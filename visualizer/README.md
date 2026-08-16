# PULSE — audio-reactive visualizer

Eleven GPU scenes that react to whatever your player is playing. Written for
CastParty, but it has no dependency on it: the whole thing is raw WebGL 1 and
the Web Audio API on one canvas.

**Live demo:** `visualizer/index.html` (also served at
`/visualizer/` on GitHub Pages).

## Scenes

| # | Scene | What it is |
|---|---|---|
| 01 | Halo | Radial spectrum ring with a waveform core and beat rings |
| 02 | Hyperdrive | Neon tunnel flythrough; speed follows overall energy |
| 03 | Aurora | Raymarched light curtains keyed to the mid band |
| 04 | Outrun | Synthwave terrain flyover, ridges driven by the spectrum |
| 05 | Vortex | 90k-particle spiral galaxy, radius pulses on bass |
| 06 | Spectrum City | 3D equaliser skyline with a reflective floor |
| 07 | Spectrogram | Scrolling wireframe ridge of spectrum history |
| 08 | Liquid Chrome | Raymarched metal orb displaced by the spectrum |
| 09 | Kaleido | Mirrored prism fold, facet count drifts over time |
| 10 | Fractal | Menger sponge lit from inside its voids |
| 11 | Plasma | Domain-warped liquid gradient |

Eight palettes apply across all of them: Ultramarine, Neon Dusk, Solar, Toxic,
Glacier, Nightshade, Ember, Platinum.

## Dropping it into Base44 (or any React app)

1. Create `components/AudioVisualizer.jsx` and paste the contents of
   [`AudioVisualizer.jsx`](AudioVisualizer.jsx). It is one self-contained file —
   no npm packages, no three.js, no CDN.
2. Import and mount it, handing it the `<audio>` element your player controls:

```jsx
import React, { useRef } from "react";
import AudioVisualizer from "@/components/AudioVisualizer";

export default function NowPlaying({ track }) {
  const audioRef = useRef(null);
  return (
    <div className="relative h-screen w-full bg-black">
      <AudioVisualizer
        audioRef={audioRef}
        mode="halo"
        palette="ultramarine"
        intensity={1.15}
        quality="high"
        showControls
        className="absolute inset-0"
      />
      <audio ref={audioRef} src={track.url} controls autoPlay />
    </div>
  );
}
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `audioRef` | ref | — | Ref to an `<audio>`/`<video>` element to tap |
| `audioElement` | element | — | The element directly, if you have no ref |
| `analyser` | AnalyserNode | — | Use your player's existing analyser instead |
| `stream` | MediaStream | — | Mic, screen share or WebRTC track |
| `mode` | string \| number | `0` | Scene id or index |
| `palette` | string \| number | `0` | Palette id or index |
| `intensity` | number | `1` | Reactivity, roughly 0.3–2.2 |
| `quality` | string | `'high'` | `low` / `medium` / `high` |
| `bloom` | number | `0.65` | Glow amount, 0–2 |
| `autoCycle` | number | `0` | Seconds between automatic scene changes |
| `showControls` | bool | `false` | Built-in overlay: scene pills + palette dots |
| `idleDemo` | bool | `false` | Play a built-in loop when no source is connected |
| `paused` | bool | `false` | Freeze rendering |
| `onModeChange` | fn | — | `({ index, mode })` |
| `onReady` | fn | — | Receives the engine handle for imperative control |

### Notes on wiring audio

- The analyser is a **tap**, not a sink: the component connects it alongside
  `ctx.destination`, so playback stays audible and untouched.
- A media element can only be tapped once per page. The component caches the
  `MediaElementAudioSourceNode` on the element itself, so re-mounting or
  switching tracks is safe.
- Browsers block `AudioContext` until a user gesture. The component retries the
  tap on the element's own `play` event, so a normal press-play flow works.
- Cross-origin audio needs `crossOrigin="anonymous"` on the element **and** CORS
  headers on the file, otherwise the Web Audio API only ever sees silence.
- A `MediaStream` source is deliberately not routed to the speakers — that
  would feed a microphone straight back into itself.

## Performance

Render scale, particle count and mesh density all scale with `quality`, and the
engine steps down a level on its own if it sustains under ~26 fps. Rendering
stops while the tab is hidden. On a laptop GPU all eleven scenes hold 60 fps at
1440p; the software-rendered CI screenshots run 20–25 fps, which is the floor,
not the target.

## Working on the source

```
visualizer/
  index.html          demo page (imports src/ as ES modules)
  src/shaders.js      GLSL: 11 scenes + bloom / composite chain
  src/audio.js        FFT analysis, band energies, beat detection, demo track
  src/engine.js       WebGL renderer, framebuffers, frame loop
  src/ui.js           demo page wiring only
  src/component.jsx   the React wrapper
  build.mjs           bundles the above into the two shippable files
  AudioVisualizer.jsx generated — the file you paste into Base44
  preview.html        generated — self-contained single-file showcase
```

Edit anything under `src/`, then run:

```
node visualizer/build.mjs
```

`AudioVisualizer.jsx` and `preview.html` are build outputs; don't hand-edit them.
