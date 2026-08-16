/* ─────────────────────────────────────────────────────────────────────────
   PULSE — audio-reactive visualizer for React
   Eleven GPU scenes driven by live FFT analysis. No dependencies beyond
   React itself: raw WebGL 1 and the Web Audio API, one canvas, one context.

   Quick start
     import AudioVisualizer from "@/components/AudioVisualizer";
     const audioRef = useRef(null);
     <AudioVisualizer audioRef={audioRef} mode="aurora" showControls />
     <audio ref={audioRef} src={track.url} controls />

   Scenes  aurora · halo · tunnel · orb · vortex · city · mesh · terrain
           kaleido · fractal · plasma
   ───────────────────────────────────────────────────────────────────────── */

import React, { useRef, useEffect, useState, useCallback } from "react";

/* ══ engine ══════════════════════════════════════════════════════════ */

/* =========================================================================
   PULSE — GLSL shader library
   Eleven audio-reactive scenes + a small post-processing chain.
   WebGL1 (GLSL ES 1.00) for maximum device compatibility.
   ========================================================================= */

/* Shared header injected into every scene fragment shader. ---------------- */
const HEAD = `
precision highp float;

uniform vec2  uRes;      // render target size in pixels
uniform float uTime;     // wall clock seconds
uniform float uFlow;     // energy-accumulated clock (never jumps backwards)
uniform sampler2D uAudio;// row0 = log spectrum, row1 = waveform
uniform float uBass;
uniform float uMid;
uniform float uTreb;
uniform float uLevel;
uniform float uBeat;     // 1.0 on transient, decays to 0
uniform float uEnergy;   // smoothed overall loudness 0..1
uniform float uIntensity;// user reactivity multiplier
uniform float uMotion;   // 1.0 normal, lower when reduced-motion is on
uniform vec3  uA;
uniform vec3  uB;
uniform vec3  uC;

varying vec2 vUv;

#define PI  3.14159265359
#define TAU 6.28318530718

float spec(float x){ return texture2D(uAudio, vec2(clamp(x, 0.002, 0.998), 0.25)).r; }
float wav(float x){ return texture2D(uAudio, vec2(clamp(x, 0.002, 0.998), 0.75)).r * 2.0 - 1.0; }

// Symmetric lookup for radial layouts: x is a turn around the circle, and
// the result runs bass at the bottom up to treble at the top, mirrored
// left/right so the ring reads as one object rather than a spiral.
float specM(float x){ return spec(1.0 - abs(fract(x - 0.25) * 2.0 - 1.0)); }

mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

float vhash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float vhash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vhash(i + vec3(0.0, 0.0, 0.0)), vhash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(vhash(i + vec3(0.0, 1.0, 0.0)), vhash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vhash(i + vec3(0.0, 0.0, 1.0)), vhash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(vhash(i + vec3(0.0, 1.0, 1.0)), vhash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){
    s += a * noise3(p);
    p *= 2.03;
    p.xy = rot(0.6) * p.xy;
    a *= 0.5;
  }
  return s;
}

// Cheap 2D value noise. The scenes that warp a field call this many times
// per pixel, so it stays 3 octaves of 2D rather than 5 octaves of 3D.
float noise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = vhash2(i), b = vhash2(i + vec2(1.0, 0.0));
  float c = vhash2(i + vec2(0.0, 1.0)), d = vhash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){
    s += a * noise2(p);
    p = rot(0.7) * p * 2.07;
    a *= 0.5;
  }
  return s * 1.14;
}

// Three-stop palette ramp. Every scene colours through this so palette
// switching stays coherent across all eleven of them.
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uA, uB, t * 2.0) : mix(uB, uC, (t - 0.5) * 2.0);
}

vec2 screenUv(){ return (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; }

float starField(vec2 uv, float density, float tw){
  vec2 g = floor(uv * density);
  vec2 f = fract(uv * density) - 0.5;
  float h = vhash2(g);
  if (h < 0.965) return 0.0;
  float s = 0.6 + 0.4 * sin(uTime * (1.5 + h * 6.0) + h * 40.0) * tw;
  return smoothstep(0.34, 0.0, length(f - (vec2(vhash2(g + 3.7), vhash2(g + 9.1)) - 0.5) * 0.6)) * s;
}
`;

/* Fullscreen triangle / quad vertex shader. ------------------------------- */
const VS_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/* ── 1. AURORA — volumetric curtains ───────────────────────────────────── */
const FS_AURORA = HEAD + `
// Vertical sheets: warp a 2D field, then extrude it up the y axis so the
// structure reads as hanging curtains rather than an even cloud.
float curtain(vec3 p, out float band){
  float t = uFlow * 0.13;
  vec2 q = vec2(p.x * 0.40, p.z * 0.26);
  q.x += fbm2(q * 1.15 + vec2(t, 0.0)) * 1.7 - 0.85;
  // Ridged noise: the thin band around the crest is the curtain. A plain
  // threshold on fbm gives blobs, which read as fog rather than sheets.
  float n = fbm2(q * 1.6 + vec2(-t * 0.55, t * 0.25));
  float sheet = pow(clamp(1.0 - abs(n * 2.0 - 1.0), 0.0, 1.0), 7.0);
  float stri = 0.62 + 0.38 * sin(p.x * 8.0 + p.z * 2.5 - uFlow * 1.3);
  float h = smoothstep(-2.1, -0.5, p.y) * smoothstep(2.9, 0.1, p.y);
  band = spec(clamp((p.y + 2.1) * 0.18, 0.0, 1.0));
  return sheet * stri * h * (0.35 + band * 1.05 * uIntensity);
}

void main(){
  vec2 uv = screenUv();
  vec3 ro = vec3(0.0, -0.9, -6.2);
  vec3 rd = normalize(vec3(uv, 1.45));
  float sw = uTime * 0.05 * uMotion;
  rd.xz = rot(sin(sw) * 0.28) * rd.xz;
  rd.yz = rot(0.06 + cos(sw * 0.8) * 0.10) * rd.yz;

  vec3 col = vec3(0.0);
  float t = 0.6;
  float band = 0.0;

  for (int i = 0; i < 34; i++){
    vec3 p = ro + rd * t;
    float d = curtain(p, band);
    if (d > 0.002){
      vec3 c = ramp(clamp(0.02 + (p.y + 2.1) * 0.24 + band * 0.30, 0.0, 1.0));
      col += c * d * (0.20 + d * 0.55) * exp(-t * 0.24);
    }
    t += 0.27;
    if (t > 11.0) break;
  }

  // Horizon wash and stars behind the curtains.
  col += ramp(0.18) * exp(-abs(uv.y + 0.38) * 7.5) * (0.06 + uLevel * 0.10);
  col += starField(uv * 1.5 + vec2(uTime * 0.004, 0.0), 24.0, 1.0) * 0.30 * (0.35 + uTreb * 0.8)
       * smoothstep(-0.15, 0.5, uv.y);

  col *= 1.0 + uBeat * 0.35 * uIntensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 2. HYPERDRIVE — neon tunnel flythrough ────────────────────────────── */
const FS_TUNNEL = HEAD + `
void main(){
  vec2 uv = screenUv();
  uv += vec2(sin(uTime * 0.31), cos(uTime * 0.24)) * 0.05 * uMotion;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float z = 0.42 / (r + 0.035) + uFlow * 1.6;
  float twist = sin(z * 0.11) * 1.1 * uMotion + uTime * 0.06 * uMotion;
  float A = a + twist;

  float seg = 12.0;
  vec2 tc = vec2(A / TAU * seg, z);

  // Panel grid.
  vec2 gf = abs(fract(tc) - 0.5);
  float lw = 0.055 + 0.035 * uTreb * uIntensity;
  float grid = smoothstep(lw, 0.0, gf.x) + smoothstep(lw * 1.3, 0.0, gf.y);

  // Rings driven by the spectrum, one bin per ring.
  float ringId = floor(tc.y);
  float ringE  = spec(fract(ringId * 0.1373));
  float ringGlow = smoothstep(0.42, 0.0, gf.y) * ringE * (0.52 + uBeat * 0.7) * uIntensity;

  float t = fract(z * 0.06 + uTime * 0.02);
  vec3 base = ramp(t);
  vec3 col  = base * grid * 0.24;
  col += ramp(fract(t + 0.35)) * ringGlow;

  // Streaking speed lines near the walls. Feathering the cell edges keeps
  // them reading as light trails instead of rectangles.
  float sa = A * 40.0, sz = z * 0.5;
  float streak = max(0.0, vhash2(vec2(floor(sa), floor(sz))) - 0.72) * 8.0;
  streak *= smoothstep(0.5, 0.12, abs(fract(sa) - 0.5)) * smoothstep(0.5, 0.05, abs(fract(sz) - 0.5));
  col += base * streak * smoothstep(0.0, 0.6, r) * (0.12 + uEnergy * 0.40);

  float fog = exp(-max(0.0, z - uFlow * 1.6) * 0.055);
  col *= fog;

  // Bright core the tunnel recedes into.
  col += ramp(0.85) * pow(smoothstep(0.55, 0.0, r), 5.0) * (0.22 + uBass * 0.75 * uIntensity);
  col *= 1.0 + uBeat * 0.30;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 3. LIQUID CHROME — displaced metaball orb ─────────────────────────── */
const FS_ORB = HEAD + `
float orb(vec3 p){
  float ang = atan(p.z, p.x) / TAU + 0.5;
  float s = spec(ang) * uIntensity;
  float lat = acos(clamp(p.y / max(length(p), 1e-4), -1.0, 1.0)) / PI;

  float d = length(p) - (1.0 + 0.14 * uBass * uIntensity);
  d -= 0.11 * fbm(p * 1.15 + vec3(0.0, uFlow * 0.35, uFlow * 0.18));
  d -= 0.26 * s * smoothstep(0.05, 0.45, lat) * smoothstep(0.95, 0.55, lat);
  return d * 0.70;
}

vec3 nrm(vec3 p){
  vec2 e = vec2(0.0022, 0.0);
  return normalize(vec3(orb(p + e.xyy) - orb(p - e.xyy),
                        orb(p + e.yxy) - orb(p - e.yxy),
                        orb(p + e.yyx) - orb(p - e.yyx)));
}

// Procedural studio environment. Chrome only reads as chrome when there is
// something with hard edges to reflect, so this is a dark room hung with
// bright horizontal softboxes rather than a smooth gradient.
vec3 env(vec3 d){
  float y = d.y;
  float strip = smoothstep(0.055, 0.0, abs(fract(y * 2.2) - 0.5));
  vec3 c = vec3(0.004);
  c += vec3(1.0) * strip * 2.2;
  c += ramp(0.5 + 0.5 * sin(atan(d.z, d.x) * 3.0 + uTime * 0.25)) * 0.20 * smoothstep(0.0, 0.55, abs(y));
  c += mix(uA * 0.07, uC * 0.015, y * 0.5 + 0.5);
  c += vec3(1.0) * pow(max(0.0, dot(d, normalize(vec3(0.55, 0.8, -0.35)))), 90.0) * 3.0;
  c += uB * pow(max(0.0, dot(d, normalize(vec3(-0.75, 0.1, 0.55)))), 16.0) * 0.9;
  return c;
}

void main(){
  vec2 uv = screenUv();
  float orbit = uTime * 0.14 * uMotion;
  vec3 ro = vec3(sin(orbit) * 4.6, 0.75 + sin(uTime * 0.21 * uMotion) * 0.30, cos(orbit) * 4.6);
  vec3 ww = normalize(-ro), uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.9 * ww);

  float t = 0.0, d = 0.0;
  bool hit = false;
  for (int i = 0; i < 72; i++){
    vec3 p = ro + rd * t;
    d = orb(p);
    if (d < 0.0012){ hit = true; break; }
    t += d;
    if (t > 11.0) break;
  }

  vec3 col;
  if (hit){
    vec3 p = ro + rd * t;
    vec3 n = nrm(p);
    vec3 rf = reflect(rd, n);
    float fres = pow(1.0 - max(0.0, dot(n, -rd)), 4.0);

    float band = spec(clamp(atan(p.z, p.x) / TAU + 0.5, 0.0, 1.0));
    vec3 tint = ramp(clamp(0.20 + band * 0.85 + n.y * 0.22, 0.0, 1.0));

    // Pure specular: a metal has no diffuse term, and adding one is exactly
    // what makes a chrome shader look like painted plastic.
    col = env(rf) * mix(tint, vec3(1.0), 0.28) * (0.42 + 1.10 * fres);
    col += tint * fres * fres * (0.55 + uBeat * 0.7);
    col += ramp(0.5 + 0.5 * sin(dot(n, rd) * 7.0 + uTime * 0.5)) * 0.06;
    col *= 1.0 + uBeat * 0.22;
  } else {
    col = env(rd) * 0.16;
  }

  // Volumetric halo around the silhouette.
  float halo = exp(-abs(length(uv) - (0.30 + 0.04 * uBass)) * 9.0);
  col += ramp(0.7) * halo * (0.18 + uLevel * 0.55) * uIntensity;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 4. SPECTRUM CITY — 3D bar field with a wet floor ──────────────────── */
const FS_CITY = HEAD + `
float barHeight(vec2 id){
  // x maps straight onto the spectrum, mirrored about the centre line, so
  // the field reads as an equaliser rather than a random skyline. A per-cell
  // hash keeps successive rows from fusing into flat walls.
  float bin = clamp(abs(id.x) / 15.0, 0.0, 1.0);
  float k = 0.62 + 0.38 * vhash2(id * 0.731);
  return 0.05 + 11.0 * pow(spec(bin), 2.0) * k * uIntensity;
}

float mapCity(vec3 p, out float h){
  vec2 id = floor(p.xz) + 0.5;
  vec2 q  = p.xz - id;
  h = barHeight(id);
  vec3 d  = abs(vec3(q.x, p.y - h * 0.5, q.y)) - vec3(0.27, h * 0.5, 0.27);
  return (length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0)) * 0.75;
}

vec3 shadeBars(vec3 ro, vec3 rd, float maxT, int steps, out bool hit, out float hitT){
  float t = 0.05, h = 0.0;
  vec3 glow = vec3(0.0);
  hit = false;
  hitT = maxT;
  for (int i = 0; i < 76; i++){
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = mapCity(p, h);
    // Emissive haze rising off the columns.
    glow += ramp(clamp(0.15 + h * 0.24, 0.0, 1.0)) * exp(-d * 20.0) * 0.0026 * exp(-t * 0.16);
    if (d < 0.004){
      hit = true;
      hitT = t;
      vec2 id = floor(p.xz) + 0.5;
      float up = clamp(p.y / max(h, 0.001), 0.0, 1.0);
      vec3 c = ramp(clamp(0.14 + h * 0.16 + up * 0.34, 0.0, 1.0));
      float edge = smoothstep(0.215, 0.266, min(abs(p.x - id.x), abs(p.z - id.y)));
      float cap  = smoothstep(0.02, 0.0, abs(p.y - h));
      float scan = 0.5 + 0.5 * sin(p.y * 26.0 - uFlow * 4.0);
      // Dark faces, light along the corners: the towers read as lit edges
      // rather than solid blocks, which is what keeps them from blowing out.
      vec3 lit = c * (0.03 + 0.30 * up * up) * (0.60 + 0.40 * scan);
      lit += c * edge * 2.4;
      lit += ramp(0.85) * cap * (0.30 + uBeat * 0.5);
      return (lit * exp(-t * 0.075) + glow) * 1.0;
    }
    // Domain repetition makes the SDF lie across cell walls: an unbounded
    // step lets a grazing ray jump clean over a neighbouring tower.
    t += clamp(d, 0.012, 0.30);
    if (t > maxT) break;
  }
  return min(glow, vec3(0.30));
}

void main(){
  vec2 uv = screenUv();
  float drift = uFlow * 0.55;
  vec3 ro = vec3(sin(uTime * 0.07 * uMotion) * 2.2, 1.45 + 0.35 * sin(uTime * 0.11 * uMotion), -drift);
  vec3 ta = vec3(0.0, 1.15 + uBass * 0.35, -drift + 7.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.85 * ww);

  // Towers first — they stand on the floor, so a downward ray usually meets
  // one before the ground plane. Only a miss falls through to floor or sky.
  bool hit; float hitT;
  vec3 col = shadeBars(ro, rd, 26.0, 76, hit, hitT);

  if (!hit && rd.y < -0.001){
    float ft = -ro.y / rd.y;
    vec3 fp = ro + rd * ft;
    vec3 rrd = normalize(vec3(rd.x, -rd.y, rd.z));
    bool rhit; float rt;
    vec3 refl = shadeBars(fp + vec3(0.0, 0.002, 0.0), rrd, 14.0, 36, rhit, rt);
    vec2 g = abs(fract(fp.xz) - 0.5);
    float grid = smoothstep(0.03, 0.0, min(g.x, g.y));
    float fade = exp(-ft * 0.075);
    col += refl * 0.34 * fade;
    col += ramp(0.6) * grid * 0.22 * fade * (0.5 + uEnergy * 0.7);
    col += uA * 0.022 * fade;
  } else if (!hit){
    float sky = smoothstep(0.0, 0.5, rd.y);
    col += mix(uA * 0.055, uB * 0.035, sky) * (1.0 - smoothstep(0.0, 0.25, rd.y) * 0.3);
    col += starField(vec2(atan(rd.x, rd.z), rd.y) * 1.6, 18.0, 1.0) * 0.22 * sky;
  }

  col *= 1.0 + uBeat * 0.28;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 5. KALEIDO — mirrored prism ───────────────────────────────────────── */
const FS_KALEIDO = HEAD + `
uniform float uFolds;

void main(){
  vec2 uv = screenUv() * (1.18 - 0.12 * uBass * uIntensity);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + uTime * 0.055 * uMotion;

  float sector = TAU / uFolds;
  a = abs(mod(a, sector) - sector * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r - vec2(0.34, 0.0);

  vec3 col = vec3(0.0);
  float sc = 1.0;

  for (int i = 0; i < 6; i++){
    float e = spec(0.04 + float(i) * 0.15);
    p = abs(p) - vec2(0.26 + 0.11 * e * uIntensity, 0.15 + 0.05 * sin(uFlow * 0.3 + float(i)));
    p = rot(0.48 + uFlow * 0.05 + float(i) * 0.16) * p;
    p *= 1.27;
    sc *= 1.27;

    // Sharp facet edges: a squared falloff reads as cut glass, a linear one
    // smears into fog.
    float d = min(abs(p.x), abs(p.y));
    float w = 0.010 * sc;
    col += ramp(fract(float(i) * 0.14 + uTime * 0.035 + r * 0.55))
         * (w / (d * d / w + w)) * (0.060 + e * 0.42 * uIntensity);
  }

  col *= smoothstep(1.55, 0.15, r) * 0.55 + 0.5;
  col += ramp(0.95) * pow(max(0.0, 1.0 - r * 1.9), 8.0) * (0.12 + uBass * 0.45);
  col *= 1.0 + uBeat * 0.40 * uIntensity;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 6. HALO — radial spectrum ring, the "now playing" look ────────────── */
const FS_HALO = HEAD + `
void main(){
  vec2 uv = screenUv();
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float an = a / TAU + 0.5;

  vec3 col = vec3(0.0);

  // Backdrop wash.
  col += mix(uA * 0.075, vec3(0.0), smoothstep(0.0, 1.0, r)) * (0.5 + uEnergy * 0.6);
  col += ramp(0.5 + 0.5 * sin(an * TAU * 2.0 + uTime * 0.2)) * 0.028 * smoothstep(1.1, 0.2, r);

  float R0 = 0.30 + 0.035 * uBass * uIntensity;

  // 120 discrete bars radiating outward, mirrored left/right.
  float bars = 120.0;
  float cell = fract(an * bars);
  float idx  = floor(an * bars) / bars;
  float e    = specM(idx);
  e = pow(e, 1.15) * (0.9 + 0.5 * uIntensity);
  float len  = 0.03 + e * 0.42;

  float barW = smoothstep(0.36, 0.20, abs(cell - 0.5));
  float radial = smoothstep(R0 - 0.004, R0 + 0.006, r) * smoothstep(R0 + len, R0 + len - 0.05, r);
  vec3 bc = ramp(clamp(0.12 + e * 1.1, 0.0, 1.0));
  col += bc * barW * radial * (0.52 + uBeat * 0.34);
  // Bar tips picked out brighter.
  col += ramp(0.95) * barW * smoothstep(0.026, 0.0, abs(r - (R0 + len))) * (0.30 + e * 0.85);

  // Inner waveform circle.
  float w = wav(fract(an * 2.0)) * (0.055 + 0.05 * uIntensity);
  float wr = R0 - 0.055 + w;
  col += ramp(0.75) * (0.0028 / (abs(r - wr) + 0.0028)) * 0.62;

  // Beat rings expanding outward.
  for (int i = 0; i < 3; i++){
    float ph = fract(uTime * 0.45 - float(i) * 0.333);
    float rr = R0 + ph * 0.85;
    float amp = (1.0 - ph) * uBeat;
    col += ramp(0.55) * (0.0035 / (abs(r - rr) + 0.0035)) * amp * 0.40;
  }

  // Core.
  col += ramp(1.0) * pow(smoothstep(R0 - 0.05, 0.0, r), 2.4) * (0.10 + uLevel * 0.42);
  col += ramp(0.4) * exp(-abs(r - R0) * 9.0) * (0.07 + uBass * 0.26);

  // Drifting dust.
  col += starField(uv * 2.2 + vec2(uTime * 0.01, 0.0), 26.0, 1.0) * 0.16 * (0.3 + uTreb * 1.2);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 7. FRACTAL — Menger sponge ────────────────────────────────────────── */
const FS_FRACTAL = HEAD + `
float trap;

float sdBox(vec3 p, vec3 b){
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float mapF(vec3 p){
  p.xz = rot(uTime * 0.09 * uMotion) * p.xz;
  p.xy = rot(0.28 + sin(uFlow * 0.10) * 0.20) * p.xy;

  float d = sdBox(p, vec3(1.25 + 0.10 * uBass * uIntensity));
  float s = 1.0;
  trap = 1e9;

  for (int i = 0; i < 4; i++){
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    if (c > d){ d = c; trap = float(i) * 0.25 + 0.12; }
  }
  return d;
}

vec3 nrmF(vec3 p){
  vec2 e = vec2(0.0016, 0.0);
  return normalize(vec3(mapF(p + e.xyy) - mapF(p - e.xyy),
                        mapF(p + e.yxy) - mapF(p - e.yxy),
                        mapF(p + e.yyx) - mapF(p - e.yyx)));
}

void main(){
  vec2 uv = screenUv();
  float orbit = uTime * 0.11 * uMotion;
  float dist = 5.4 - 0.5 * uEnergy;
  vec3 ro = vec3(sin(orbit) * dist, 0.85 + 0.55 * sin(orbit * 0.6), cos(orbit) * dist);
  vec3 ww = normalize(-ro), uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

  float t = 0.0, tr = 0.0;
  vec3 glow = vec3(0.0);
  bool hit = false;

  for (int i = 0; i < 76; i++){
    vec3 p = ro + rd * t;
    float d = mapF(p);
    // Light bleeding out of the voids sells the depth of the cuts.
    glow += ramp(clamp(0.20 + spec(fract(t * 0.35)) * 0.7, 0.0, 1.0)) * exp(-d * 42.0) * 0.010;
    if (d < 0.0013){ hit = true; tr = trap; break; }
    t += d * 0.88;
    if (t > 14.0) break;
  }

  vec3 col = glow * (0.65 + uEnergy * 1.0);

  if (hit){
    vec3 p = ro + rd * t;
    vec3 n = nrmF(p);
    vec3 l = normalize(vec3(0.65, 0.85, -0.45));
    float dif = max(0.0, dot(n, l));
    float fres = pow(1.0 - max(0.0, dot(n, -rd)), 3.5);
    float ao = 1.0 / (1.0 + t * 0.22);
    float band = spec(clamp(length(p) * 0.55, 0.0, 1.0));
    vec3 base = ramp(clamp(0.14 + tr * 1.1 + band * 0.45, 0.0, 1.0));

    col += base * (0.06 + 0.60 * dif) * ao;
    col += ramp(0.92) * fres * (0.22 + uBeat * 0.45);
    col += mix(vec3(1.0), base, 0.5) * pow(max(0.0, dot(reflect(rd, n), l)), 40.0) * 0.35;
    col *= exp(-max(0.0, t - 2.5) * 0.10);
  }

  col *= 1.0 + uBeat * 0.30;
  col += starField(uv * 1.6, 20.0, 1.0) * 0.15;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 8. OUTRUN — synthwave terrain flyover ─────────────────────────────── */
const FS_TERRAIN = HEAD + `
float terr(vec2 p){
  float corridor = smoothstep(0.6, 3.4, abs(p.x));
  float n = fbm(vec3(p * 0.32, 0.0)) * 1.9;
  float s = spec(clamp((abs(p.x) - 0.6) * 0.10, 0.0, 1.0)) * 2.3 * uIntensity;
  return (n + s) * corridor - 0.25;
}

void main(){
  vec2 uv = screenUv();
  float drive = uFlow * 2.6;

  vec3 ro = vec3(sin(uTime * 0.09 * uMotion) * 0.35, 1.15 + 0.12 * sin(uTime * 0.3 * uMotion), -drive);
  vec3 rd = normalize(vec3(uv, 1.25));
  rd.xz = rot(sin(uTime * 0.05 * uMotion) * 0.08) * rd.xz;

  vec3 col;
  float t = 0.0;
  bool hit = false;

  if (rd.y < 0.28){
    float dt = 0.10;
    float lh = 0.0, lt = 0.0;
    for (int i = 0; i < 104; i++){
      vec3 p = ro + rd * t;
      float h = terr(p.xz);
      if (p.y < h){
        hit = true;
        t = mix(lt, t, (lh) / max(lh + (h - p.y), 1e-4));
        break;
      }
      lh = p.y - h; lt = t;
      t += dt;
      dt *= 1.035;
      if (t > 42.0) break;
    }
  }

  if (hit){
    vec3 p = ro + rd * t;
    float h = terr(p.xz);
    vec2 e = vec2(0.06, 0.0);
    vec3 n = normalize(vec3(terr(p.xz - e.xy) - terr(p.xz + e.xy), 2.0 * e.x, terr(p.xz - e.yx) - terr(p.xz + e.yx)));

    vec2 g = abs(fract(p.xz * 1.0) - 0.5);
    float gl = smoothstep(0.035, 0.0, min(g.x, g.y));
    float gl2 = smoothstep(0.012, 0.0, min(g.x, g.y));

    float hn = clamp(h * 0.35, 0.0, 1.0);
    vec3 wire = ramp(clamp(0.18 + hn * 0.9, 0.0, 1.0));
    col = wire * (gl * 0.30 + gl2 * 0.85) * (0.55 + uEnergy * 0.7);
    col += uA * 0.035 * (0.4 + max(0.0, n.y));
    col += wire * pow(max(0.0, n.y), 3.0) * 0.04;
    col *= exp(-t * 0.05);
  } else {
    // Sky, sun and horizon glow.
    float sy = rd.y;
    col = mix(uA * 0.16, vec3(0.0), smoothstep(0.0, 0.9, sy));
    vec2 sd = vec2(uv.x, uv.y - 0.10);
    float sr = length(sd * vec2(1.0, 1.15));
    float sun = smoothstep(0.30, 0.28, sr);
    float bands = step(0.42, fract(sd.y * 22.0 + 0.25)) * smoothstep(0.02, -0.26, sd.y);
    sun *= 1.0 - bands;
    col += ramp(clamp(0.88 - (0.28 - sd.y) * 1.45, 0.0, 1.0)) * sun * (0.52 + uBass * 0.40);
    col += ramp(0.55) * exp(-sr * 3.6) * 0.20 * (0.4 + uLevel * 0.7);
    col += ramp(0.35) * exp(-max(0.0, sy) * 14.0) * 0.22;
    col += starField(vec2(uv.x, uv.y) * 1.8, 24.0, 1.0) * 0.26 * smoothstep(0.02, 0.35, sy);
  }

  col *= 1.0 + uBeat * 0.3;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 9. PLASMA — flowing liquid gradient ───────────────────────────────── */
const FS_PLASMA = HEAD + `
void main(){
  vec2 uv = screenUv();
  vec2 p = uv * 1.6;

  // Domain-warped fbm — three chained warps for a lava-lamp feel.
  float tt = uFlow * 0.30;
  vec2 q = vec2(fbm2(p + vec2(0.0, tt)), fbm2(p + vec2(5.2, 1.3) - tt * 0.6));
  vec2 r = vec2(fbm2(p + 3.4 * q + vec2(1.7, 9.2) + tt * 0.5),
                fbm2(p + 3.4 * q + vec2(8.3, 2.8) - tt * 0.35));
  float f = fbm2(p + (2.6 + 1.6 * uBass * uIntensity) * r);

  float band = spec(clamp(length(uv) * 0.55, 0.0, 1.0));
  float v = clamp(f * 1.70 - 0.55 + length(q) * 0.16 + band * 0.22 * uIntensity, 0.0, 1.0);

  vec3 col = ramp(v);
  col *= 0.20 + 0.70 * smoothstep(0.10, 0.95, v);

  // Contour ribbons riding the field.
  float c = abs(fract(f * 6.0 + uTime * 0.1) - 0.5);
  col += ramp(fract(v + 0.4)) * smoothstep(0.06, 0.0, c) * (0.16 + uMid * 0.55);

  // Specular caustic highlights.
  float spec1 = pow(max(0.0, 1.0 - abs(length(r) - 0.55) * 3.2), 6.0);
  col += vec3(1.0) * spec1 * 0.16 * (0.3 + uTreb * 1.2);

  col *= 1.0 + uBeat * 0.34 * uIntensity;
  col *= smoothstep(1.5, 0.15, length(uv)) * 0.4 + 0.75;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── 10. VORTEX — particle galaxy (point sprites) ──────────────────────── */
const VS_PARTICLES = `
precision highp float;
attribute vec4 aSeed;      // x radius, y angle, z arm/type, w size/brightness
uniform float uTime, uFlow, uBass, uMid, uTreb, uLevel, uBeat, uEnergy, uIntensity, uMotion;
uniform vec2  uRes;
uniform float uPix;
uniform vec3  uA, uB, uC;
uniform sampler2D uAudio;
varying vec3 vCol;
varying float vFade;

#define TAU 6.28318530718
mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
float spec(float x){ return texture2D(uAudio, vec2(clamp(x, 0.002, 0.998), 0.25)).r; }
vec3 ramp(float t){ t = clamp(t, 0.0, 1.0); return t < 0.5 ? mix(uA, uB, t * 2.0) : mix(uB, uC, (t - 0.5) * 2.0); }

void main(){
  float r  = aSeed.x;
  float e  = spec(r);
  float arm = floor(aSeed.z * 4.0);

  // Four spiral arms: the seed only spreads a particle *around* its arm.
  float A = arm * (TAU / 4.0) + (aSeed.y - 0.5) * (0.45 + r * 1.2) + r * 5.6
          - uFlow * (0.42 / (0.25 + r)) * uMotion;

  float rr = r * (1.0 + 0.20 * uBass * uIntensity * sin(r * 7.0 - uTime * 1.6))
           + e * 0.22 * uIntensity;

  float thick = 0.30 * exp(-r * 2.4) + 0.05;
  float y = (aSeed.w - 0.5) * thick + 0.16 * sin(A * 2.0 + uTime * 0.6) * r
          + e * 0.55 * uIntensity * (0.15 + r);

  vec3 p = vec3(cos(A) * rr * 5.0, y, sin(A) * rr * 5.0);

  p.xz = rot(uTime * 0.07 * uMotion) * p.xz;
  p.yz = rot(-0.42 + sin(uTime * 0.12 * uMotion) * 0.12) * p.yz;
  p.z += 4.7 - uEnergy * 0.4;

  float w = max(p.z, 0.25);
  float f = 1.7;
  gl_Position = vec4(p.x * f / (uRes.x / uRes.y), p.y * f, 0.0, w);

  float sz = (1.1 + 9.0 * aSeed.w * aSeed.w) * (0.55 + e * 1.7 * uIntensity + uBeat * 0.4);
  gl_PointSize = clamp(sz / w * uPix, 1.0, 64.0);

  vCol = ramp(clamp(0.06 + r * 0.80 + e * 0.50 + aSeed.w * 0.10, 0.0, 1.0))
       * (1.5 + 6.0 * e * uIntensity + uBeat * 1.1);
  vFade = smoothstep(0.0, 1.2, w) * exp(-max(0.0, w - 4.5) * 0.22);
}
`;

const FS_PARTICLES = `
precision highp float;
varying vec3 vCol;
varying float vFade;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float a = exp(-r2 * 11.0);
  gl_FragColor = vec4(vCol * a * vFade, 1.0);
}
`;

/* ── 11. SPECTROGRAM — scrolling 3D wireframe of spectrum history ─────── */
const VS_MESH = `
precision highp float;
attribute vec2 aGrid;      // x 0..1 across, y 0..1 back in time
uniform float uTime, uFlow, uBass, uMid, uTreb, uLevel, uBeat, uEnergy, uIntensity, uMotion;
uniform vec2  uRes;
uniform float uHead;       // newest row position in the history texture
uniform vec3  uA, uB, uC;
uniform sampler2D uHist;
varying vec3 vCol;
varying float vFade;

mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
vec3 ramp(float t){ t = clamp(t, 0.0, 1.0); return t < 0.5 ? mix(uA, uB, t * 2.0) : mix(uB, uC, (t - 0.5) * 2.0); }

void main(){
  float row = fract(uHead - aGrid.y);
  float v = texture2D(uHist, vec2(aGrid.x, row)).r;

  float x = (aGrid.x - 0.5) * 9.6;
  float z = aGrid.y * 16.0;
  float taper = smoothstep(0.0, 0.10, aGrid.x) * smoothstep(1.0, 0.90, aGrid.x);
  float h = pow(v, 1.22) * (3.4 + 2.2 * uIntensity) * taper;

  vec3 p = vec3(x, h - 1.75, z + 0.9);
  p.xz = rot(sin(uTime * 0.09 * uMotion) * 0.18) * p.xz;
  p.yz = rot(-0.26 + sin(uTime * 0.06 * uMotion) * 0.05) * p.yz;
  p.z += 2.1;

  float w = max(p.z, 0.3);
  float f = 2.05;
  gl_Position = vec4(p.x * f / (uRes.x / uRes.y), p.y * f, 0.0, w);

  vCol = ramp(clamp(0.06 + v * 1.15, 0.0, 1.0)) * (0.40 + v * 3.2 + uBeat * 0.40);
  vFade = exp(-aGrid.y * 1.05) * (0.45 + 0.55 * uEnergy);
}
`;

const FS_MESH = `
precision highp float;
varying vec3 vCol;
varying float vFade;
void main(){ gl_FragColor = vec4(vCol * vFade, 1.0); }
`;

/* Ambient backdrop drawn behind the geometry-based scenes. ---------------- */
const FS_BACKDROP = HEAD + `
void main(){
  vec2 uv = screenUv();
  float r = length(uv);
  vec3 col = mix(uA * 0.11, vec3(0.0), smoothstep(0.05, 1.15, r));
  // Seam-free angular wash — fract() on an angle leaves a visible wedge.
  col += ramp(0.5 + 0.5 * sin(atan(uv.y, uv.x) * 2.0 + uTime * 0.18)) * 0.022 * smoothstep(1.2, 0.1, r);
  col *= 0.55 + uEnergy * 0.7;
  col += starField(uv * 1.5, 20.0, 1.0) * 0.20 * (0.35 + uTreb);
  col += ramp(0.5) * exp(-r * 2.6) * uBeat * 0.07;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ── Post-processing ───────────────────────────────────────────────────── */
const FS_BRIGHT = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThresh;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  s *= 0.25;
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(s * smoothstep(uThresh, uThresh + 0.30, l), 1.0);
}
`;

const FS_BLUR = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
  c += (texture2D(uTex, vUv + uDir * 1.3846).rgb + texture2D(uTex, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(uTex, vUv + uDir * 3.2308).rgb + texture2D(uTex, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FS_COMPOSITE = `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform vec2 uRes;
uniform float uTime, uBeat, uBloomAmt, uChroma, uVignette, uGrain, uExposure;
varying vec2 vUv;

void main(){
  vec2 d = vUv - 0.5;
  float ca = (0.0012 + 0.0045 * uBeat) * uChroma;
  vec3 c;
  c.r = texture2D(uScene, vUv + d * ca).r;
  c.g = texture2D(uScene, vUv).g;
  c.b = texture2D(uScene, vUv - d * ca).b;

  vec3 b = texture2D(uBloom1, vUv).rgb * 0.62 + texture2D(uBloom2, vUv).rgb * 0.55;
  c += b * uBloomAmt;
  c *= uExposure;

  // ACES-ish filmic curve.
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  c = clamp(c, 0.0, 1.0);
  c = pow(c, vec3(0.94));

  // The filmic curve desaturates as it rolls off; nudge chroma back so the
  // palette still reads at the bright end.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(luma), c, 1.22), 0.0, 1.0);

  float v = smoothstep(1.25, 0.30, length(d) * 1.42);
  c *= mix(1.0, v, uVignette);

  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 137.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * uGrain;

  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`;

/* Scene registry. `kind` tells the renderer how to draw the mode. --------- */
const MODES = [
  { id: 'halo',     name: 'Halo',          blurb: 'Radial spectrum ring',       kind: 'frag', fs: FS_HALO },
  { id: 'tunnel',   name: 'Hyperdrive',    blurb: 'Neon tunnel flythrough',     kind: 'frag', fs: FS_TUNNEL },
  { id: 'aurora',   name: 'Aurora',        blurb: 'Volumetric light curtains',  kind: 'frag', fs: FS_AURORA },
  { id: 'terrain',  name: 'Outrun',        blurb: 'Synthwave horizon flyover',  kind: 'frag', fs: FS_TERRAIN },
  { id: 'vortex',   name: 'Vortex',        blurb: '90k particle galaxy',        kind: 'points' },
  { id: 'city',     name: 'Spectrum City', blurb: '3D equaliser skyline',       kind: 'frag', fs: FS_CITY },
  { id: 'mesh',     name: 'Spectrogram',   blurb: 'Scrolling wireframe ridge',  kind: 'mesh' },
  { id: 'orb',      name: 'Liquid Chrome', blurb: 'Molten reflective orb',      kind: 'frag', fs: FS_ORB },
  { id: 'kaleido',  name: 'Kaleido',       blurb: 'Mirrored prism fold',        kind: 'frag', fs: FS_KALEIDO },
  { id: 'fractal',  name: 'Fractal',       blurb: 'Menger sponge, lit inside',  kind: 'frag', fs: FS_FRACTAL },
  { id: 'plasma',   name: 'Plasma',        blurb: 'Liquid gradient flow',       kind: 'frag', fs: FS_PLASMA }
];

/* Palettes. Three stops each: shadow → mid → highlight. ------------------ */
const PALETTES = [
  { id: 'ultramarine', name: 'Ultramarine', colors: ['#04164a', '#3d8ef5', '#9fd8ff'] },
  { id: 'magenta',     name: 'Neon Dusk',   colors: ['#26063d', '#ff3fb4', '#ffb0e6'] },
  { id: 'solar',       name: 'Solar',       colors: ['#2e0803', '#ff7a1a', '#ffd27a'] },
  { id: 'toxic',       name: 'Toxic',       colors: ['#022619', '#1fe08a', '#9dffcf'] },
  { id: 'ice',         name: 'Glacier',     colors: ['#03202c', '#2fdcff', '#b5f1ff'] },
  { id: 'violet',      name: 'Nightshade',  colors: ['#130830', '#8b5cf6', '#c9b2ff'] },
  { id: 'ember',       name: 'Ember',       colors: ['#230410', '#ff2d55', '#ffa88c'] },
  { id: 'mono',        name: 'Platinum',    colors: ['#0a0e14', '#7f93b0', '#dfe9f5'] }
];

/* =========================================================================
   PULSE — audio analysis
   Turns any Web Audio source into the small set of numbers the shaders want:
   a log-spaced spectrum, a waveform, three band energies, and a beat pulse.
   ========================================================================= */

const BINS = 256;          // texture width
const FFT_SIZE = 2048;
const MIN_HZ = 28;
const MAX_HZ = 16000;

function createAudioEngine(opts = {}) {
  const state = {
    ctx: null,
    analyser: null,
    source: null,
    gainTap: null,
    externalAnalyser: false,
    ownsContext: false,
    demo: null,

    freq: null,
    time: null,
    // Texture payload: row 0 spectrum, row 1 waveform.
    tex: new Uint8Array(BINS * 2),
    binMap: null,

    bass: 0, mid: 0, treb: 0, level: 0, energy: 0, beat: 0,
    peak: 0.15,
    // Each band tracks its own decaying peak so a bass-heavy master doesn't
    // pin every value at 1.0 — bands should breathe, not sit at the ceiling.
    bandPeak: { bass: 0.12, mid: 0.12, treb: 0.12 },
    history: new Float32Array(48),
    hIndex: 0,
    lastBeatAt: 0,
    silent: true,
    sourceLabel: 'none'
  };

  const smooth = {
    bass: 0, mid: 0, treb: 0, level: 0, energy: 0,
    spectrum: new Float32Array(BINS)
  };

  function ensureContext(external) {
    if (state.ctx) return state.ctx;
    if (external) { state.ctx = external; return state.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.ctx = new AC();
    state.ownsContext = true;
    return state.ctx;
  }

  function buildAnalyser() {
    if (state.analyser || !state.ctx) return;
    const an = state.ctx.createAnalyser();
    an.fftSize = FFT_SIZE;
    an.smoothingTimeConstant = 0.66;
    an.minDecibels = -92;
    an.maxDecibels = -12;
    attachAnalyser(an);
  }

  function attachAnalyser(an) {
    state.analyser = an;
    state.freq = new Uint8Array(an.frequencyBinCount);
    state.time = new Uint8Array(an.fftSize);
    buildBinMap();
  }

  // Precompute which FFT bins feed each of the 256 log-spaced texture columns.
  function buildBinMap() {
    const nyquist = (state.ctx ? state.ctx.sampleRate : 48000) / 2;
    const count = state.analyser.frequencyBinCount;
    const map = new Int32Array(BINS * 2);
    for (let i = 0; i < BINS; i++) {
      const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / BINS);
      const f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / BINS);
      let lo = Math.floor((f0 / nyquist) * count);
      let hi = Math.ceil((f1 / nyquist) * count);
      lo = Math.max(0, Math.min(count - 1, lo));
      hi = Math.max(lo + 1, Math.min(count, hi));
      map[i * 2] = lo;
      map[i * 2 + 1] = hi;
    }
    state.binMap = map;
  }

  /* ---- source wiring --------------------------------------------------- */

  function disconnectSource() {
    if (state.source) {
      try { state.source.disconnect(); } catch (e) { /* already gone */ }
      state.source = null;
    }
  }

  function connectAnalyser(an) {
    disconnectSource();
    stopDemo();
    state.externalAnalyser = true;
    state.ctx = an.context;
    attachAnalyser(an);
    state.sourceLabel = 'analyser';
  }

  // One MediaElementSource per element, ever. Reconnecting an element that
  // already has one throws, so the node is cached on the element itself.
  function connectElement(el, ctxIn) {
    const ctx = ensureContext(ctxIn);
    if (!ctx) return false;
    buildAnalyser();
    disconnectSource();
    stopDemo();
    let node = el.__pulseSourceNode;
    if (!node || node.context !== ctx) {
      try {
        node = ctx.createMediaElementSource(el);
        el.__pulseSourceNode = node;
      } catch (err) {
        console.warn('[pulse] could not tap audio element:', err);
        return false;
      }
    }
    state.source = node;
    node.connect(state.analyser);
    // Keep the element audible: the analyser is a tap, not a sink.
    try { state.analyser.connect(ctx.destination); } catch (e) { /* noop */ }
    state.sourceLabel = 'element';
    return true;
  }

  function connectStream(stream, ctxIn) {
    const ctx = ensureContext(ctxIn);
    if (!ctx) return false;
    buildAnalyser();
    disconnectSource();
    stopDemo();
    const node = ctx.createMediaStreamSource(stream);
    state.source = node;
    node.connect(state.analyser);
    // A live stream is not routed to the speakers — that would feed back.
    state.sourceLabel = 'stream';
    return true;
  }

  async function connectMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone capture is not available in this browser.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    connectStream(stream);
    state.sourceLabel = 'mic';
    return stream;
  }

  /* ---- built-in demo track --------------------------------------------- */

  function stopDemo() {
    if (state.demo) { state.demo.stop(); state.demo = null; }
  }

  function startDemo() {
    const ctx = ensureContext();
    if (!ctx) return false;
    buildAnalyser();
    disconnectSource();
    stopDemo();
    state.demo = createDemoTrack(ctx, state.analyser);
    try { state.analyser.connect(ctx.destination); } catch (e) { /* noop */ }
    state.sourceLabel = 'demo';
    return true;
  }

  /* ---- per-frame analysis ---------------------------------------------- */

  function update(dt, now) {
    const an = state.analyser;
    if (!an) {
      // Idle: gently breathe so the scene never looks frozen.
      const t = now * 0.001;
      const idle = 0.16 + 0.10 * Math.sin(t * 1.1) + 0.05 * Math.sin(t * 2.7);
      for (let i = 0; i < BINS; i++) {
        const f = i / BINS;
        const v = idle * Math.exp(-f * 2.2) * (0.6 + 0.4 * Math.sin(t * (1.0 + f * 6.0) + f * 12.0));
        smooth.spectrum[i] = v;
        state.tex[i] = Math.max(0, Math.min(255, v * 255)) | 0;
        state.tex[BINS + i] = 128 + Math.sin(f * 18.0 + t * 2.0) * 40 * idle;
      }
      state.bass = idle * 1.2; state.mid = idle * 0.7; state.treb = idle * 0.45;
      state.level = idle; state.energy = idle; state.silent = true;
      state.beat = Math.max(0, state.beat - dt * 2.4);
      if (Math.sin(t * 2.2) > 0.995) state.beat = 1;
      return;
    }

    an.getByteFrequencyData(state.freq);
    an.getByteTimeDomainData(state.time);

    const freq = state.freq, map = state.binMap;
    let sum = 0;

    for (let i = 0; i < BINS; i++) {
      const lo = map[i * 2], hi = map[i * 2 + 1];
      let m = 0;
      for (let b = lo; b < hi; b++) if (freq[b] > m) m = freq[b];
      // Tilt: high frequencies carry far less energy, lift them so the top
      // of the spectrum stays visible instead of dying out.
      const tilt = 0.58 + 0.55 * Math.pow(i / BINS, 0.8);
      const v = (m / 255) * tilt;
      // Asymmetric smoothing — snap up, ease down.
      const prev = smooth.spectrum[i];
      smooth.spectrum[i] = v > prev ? v : prev + (v - prev) * Math.min(1, dt * 9);
      sum += smooth.spectrum[i];
    }

    // Auto-gain so quiet masters still fill the frame, bounded so a loud
    // one doesn't get crushed into a flat wall of maximum values.
    const raw = sum / BINS;
    state.peak = Math.max(raw, state.peak - dt * 0.05);
    const gain = Math.max(0.7, Math.min(2.2, 0.40 / Math.max(0.08, state.peak)));

    for (let i = 0; i < BINS; i++) {
      // A little gamma keeps the spectrum from flattening into a solid wall
      // once auto-gain has lifted it.
      const v = Math.min(1, Math.pow(Math.min(1, smooth.spectrum[i] * gain), 1.45));
      state.tex[i] = (v * 255) | 0;
    }

    // Waveform, decimated to 256 columns.
    const td = state.time, step = td.length / BINS;
    for (let i = 0; i < BINS; i++) state.tex[BINS + i] = td[(i * step) | 0];

    const bands = bandEnergy(freq, state.ctx.sampleRate, an.frequencyBinCount);
    const bp = state.bandPeak;
    // Reference level per band is a slow (~2s) moving average, not a peak
    // hold: dividing by an instantaneous max would pin every band at 1.0.
    const normBand = (key, v) => {
      bp[key] += (v - bp[key]) * Math.min(1, dt * 0.5);
      return Math.min(1.35, v / Math.max(0.055, bp[key] * 1.9));
    };
    const tgt = {
      bass: normBand('bass', bands.bass),
      mid: normBand('mid', bands.mid),
      treb: normBand('treb', bands.treb),
      level: Math.min(1.1, raw * gain * 1.1)
    };

    const k = (cur, to, up, down) => cur + (to - cur) * Math.min(1, dt * (to > cur ? up : down));
    smooth.bass = k(smooth.bass, tgt.bass, 26, 9);
    smooth.mid = k(smooth.mid, tgt.mid, 20, 8);
    smooth.treb = k(smooth.treb, tgt.treb, 26, 11);
    smooth.level = k(smooth.level, tgt.level, 16, 6);
    smooth.energy = k(smooth.energy, (tgt.bass + tgt.mid + tgt.treb) / 3, 6, 1.6);

    state.bass = smooth.bass;
    state.mid = smooth.mid;
    state.treb = smooth.treb;
    state.level = smooth.level;
    state.energy = smooth.energy;
    state.silent = raw < 0.006;

    // Beat: bass spike above the recent running average.
    const hist = state.history;
    let avg = 0;
    for (let i = 0; i < hist.length; i++) avg += hist[i];
    avg /= hist.length;
    hist[state.hIndex] = tgt.bass;
    state.hIndex = (state.hIndex + 1) % hist.length;

    state.beat = Math.max(0, state.beat - dt * 3.1);
    if (tgt.bass > avg * 1.38 + 0.03 && tgt.bass > 0.13 && now - state.lastBeatAt > 190) {
      state.beat = 1;
      state.lastBeatAt = now;
    }
  }

  function bandEnergy(freq, sampleRate, count) {
    const hzPerBin = sampleRate / 2 / count;
    const acc = (f0, f1) => {
      const lo = Math.max(1, Math.floor(f0 / hzPerBin));
      const hi = Math.min(count, Math.ceil(f1 / hzPerBin));
      let s = 0;
      for (let i = lo; i < hi; i++) s += freq[i];
      return hi > lo ? s / (hi - lo) / 255 : 0;
    };
    return { bass: acc(28, 165), mid: acc(165, 2200), treb: acc(2200, 12000) };
  }

  function resume() {
    if (state.ctx && state.ctx.state === 'suspended') return state.ctx.resume();
    return Promise.resolve();
  }

  function dispose() {
    stopDemo();
    disconnectSource();
    if (state.ownsContext && state.ctx) { try { state.ctx.close(); } catch (e) { /* noop */ } }
    state.ctx = null;
    state.analyser = null;
  }

  return {
    state,
    update,
    resume,
    dispose,
    connectAnalyser,
    connectElement,
    connectStream,
    connectMicrophone,
    startDemo,
    stopDemo,
    get context() { return state.ctx; },
    get analyser() { return state.analyser; },
    get isDemo() { return !!state.demo; }
  };
}

/* =========================================================================
   Demo track — a small procedural house loop so the visualizer has
   something to react to before any real audio is connected.
   ========================================================================= */
function createDemoTrack(ctx, destination) {
  const BPM = 122;
  const beat = 60 / BPM;
  const out = ctx.createGain();
  out.gain.value = 0.0;
  out.connect(destination);
  out.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 1.2);

  // Shared send effects.
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.34;
  const dWet = ctx.createGain(); dWet.gain.value = 0.5;
  const dFilt = ctx.createBiquadFilter();
  dFilt.type = 'highpass'; dFilt.frequency.value = 420;
  delay.connect(fb); fb.connect(delay);
  delay.connect(dFilt); dFilt.connect(dWet); dWet.connect(out);

  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  const ROOT = 55; // A1
  const scale = [0, 3, 5, 7, 10, 12, 15, 19];
  const chords = [[0, 3, 7, 10], [-2, 3, 5, 10], [-4, 0, 3, 7], [-5, 2, 5, 9]];
  const hz = (semi) => ROOT * Math.pow(2, semi / 12);

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(132, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.05, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.4);

    const c = ctx.createBufferSource(), cg = ctx.createGain(), cf = ctx.createBiquadFilter();
    c.buffer = noiseBuf; c.playbackRate.value = 1.4;
    cf.type = 'lowpass'; cf.frequency.value = 2600;
    cg.gain.setValueAtTime(0.28, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    c.connect(cf); cf.connect(cg); cg.connect(out);
    c.start(t); c.stop(t + 0.05);
  }

  function snare(t) {
    const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    n.buffer = noiseBuf; n.playbackRate.value = 1 + Math.random() * 0.2;
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + 0.22);

    const b = ctx.createOscillator(), bg = ctx.createGain();
    b.type = 'triangle'; b.frequency.setValueAtTime(210, t);
    b.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    bg.gain.setValueAtTime(0.3, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    b.connect(bg); bg.connect(out);
    b.start(t); b.stop(t + 0.14);
  }

  function hat(t, open) {
    const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    n.buffer = noiseBuf; n.playbackRate.value = 1.7;
    f.type = 'highpass'; f.frequency.value = open ? 7000 : 9200;
    const dur = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(open ? 0.20 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + dur + 0.02);
  }

  function bass(t, semi, dur) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.value = hz(semi); o2.frequency.value = hz(semi - 12);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(240, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    f.Q.value = 7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    g.gain.setValueAtTime(0.42, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  function pluck(t, semi) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = hz(semi + 24);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(f); f.connect(g); g.connect(out); g.connect(delay);
    o.start(t); o.stop(t + 0.36);
  }

  function pad(t, semis, dur) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(out);
    semis.forEach((s) => {
      [-6, 6].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(s + 24) * Math.pow(2, det / 1200);
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.1);
      });
    });
  }

  let step = 0;
  let nextTime = ctx.currentTime + 0.12;
  const stepDur = beat / 4; // 16ths
  let timer = null;

  function schedule() {
    const ahead = ctx.currentTime + 0.25;
    while (nextTime < ahead) {
      const s = step % 16;
      const bar = Math.floor(step / 16);
      const chord = chords[bar % 4];

      if (s % 4 === 0) kick(nextTime);
      if (s === 4 || s === 12) snare(nextTime);
      if (s % 2 === 0) hat(nextTime, s % 8 === 6);
      if (s === 14 && bar % 2 === 1) hat(nextTime + stepDur * 0.5, true);

      if (s % 2 === 0) {
        const n = chord[0] + (s === 6 ? 7 : s === 10 ? 3 : 0);
        bass(nextTime, n, stepDur * 1.6);
      }
      if (bar % 8 >= 2 && (s === 2 || s === 5 || s === 9 || s === 11 || s === 14)) {
        pluck(nextTime, chord[(s + bar) % chord.length] + (s > 8 ? 12 : 0));
      }
      if (s === 0) pad(nextTime, chord, beat * 4);
      if (s === 0 && bar % 8 === 7) {
        for (let i = 0; i < 8; i++) snare(nextTime + beat * 2 + i * stepDur * 0.5);
      }

      nextTime += stepDur;
      step++;
    }
  }

  schedule();
  timer = setInterval(schedule, 60);

  return {
    stop() {
      clearInterval(timer);
      try {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        setTimeout(() => { try { out.disconnect(); } catch (e) { /* noop */ } }, 320);
      } catch (e) { try { out.disconnect(); } catch (e2) { /* noop */ } }
    },
    get bpm() { return BPM; }
  };
}

/* =========================================================================
   PULSE — WebGL renderer
   Owns the GL context, the ten scenes, the bloom chain and the frame loop.
   ========================================================================= */




const QUALITY = {
  low: { scale: 0.55, dpr: 1.0, particles: 24000, mesh: [128, 72], bloom: true },
  medium: { scale: 0.78, dpr: 1.25, particles: 55000, mesh: [160, 96], bloom: true },
  high: { scale: 1.0, dpr: 1.75, particles: 92000, mesh: [200, 120], bloom: true }
};

const HIST_ROWS = 128;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function createVisualizer(canvas, options = {}) {
  const opts = Object.assign({
    mode: 0,
    palette: 0,
    intensity: 1.0,
    quality: 'high',
    bloom: 0.65,
    grain: 0.035,
    chroma: 1.0,
    vignette: 0.85,
    exposure: 0.78,
    autoCycle: 0,           // seconds; 0 disables
    reducedMotion: false,
    onError: null
  }, options);

  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
  }) || canvas.getContext('experimental-webgl');

  if (!gl) {
    const err = new Error('WebGL is not available in this browser.');
    if (opts.onError) opts.onError(err); else console.error(err);
    return null;
  }

  const vertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
  const modes = MODES.filter((m) => vertexTextures || m.kind === 'frag');

  const audio = createAudioEngine();

  /* ---- GL helpers ------------------------------------------------------ */

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      console.error('[pulse] shader compile failed\n' + log + '\n' + numbered);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }

  function program(vsSrc, fsSrc, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link failed (' + name + '): ' + gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    const attribs = {};
    const an = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < an; i++) {
      const info = gl.getActiveAttrib(p, i);
      attribs[info.name] = gl.getAttribLocation(p, info.name);
    }
    return { p, u: uniforms, a: attribs, name };
  }

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  function freeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  }

  /* ---- static geometry ------------------------------------------------- */

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  /* ---- programs -------------------------------------------------------- */

  const progs = {};
  const failed = [];
  for (const m of modes) {
    if (m.kind !== 'frag') continue;
    try { progs[m.id] = program(VS_QUAD, m.fs, m.id); }
    catch (e) { failed.push(m.id); console.error('[pulse] scene "' + m.id + '" disabled:', e.message); }
  }

  let pParticles = null, pMesh = null, pBackdrop = null;
  try {
    pBackdrop = program(VS_QUAD, FS_BACKDROP, 'backdrop');
    if (vertexTextures) {
      pParticles = program(VS_PARTICLES, FS_PARTICLES, 'particles');
      pMesh = program(VS_MESH, FS_MESH, 'mesh');
    }
  } catch (e) {
    console.error('[pulse]', e.message);
  }

  const pBright = program(VS_QUAD, FS_BRIGHT, 'bright');
  const pBlur = program(VS_QUAD, FS_BLUR, 'blur');
  const pComp = program(VS_QUAD, FS_COMPOSITE, 'composite');

  const available = modes.filter((m) => {
    if (failed.indexOf(m.id) !== -1) return false;
    if (m.kind === 'points') return !!pParticles;
    if (m.kind === 'mesh') return !!pMesh;
    return true;
  });

  /* ---- audio textures -------------------------------------------------- */

  const audioTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, audioTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BINS, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const histTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, histTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BINS, HIST_ROWS, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE,
    new Uint8Array(BINS * HIST_ROWS));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  let histRow = 0;
  const histSlice = new Uint8Array(BINS);
  // Mirror the spectrum across the strip so the terrain grows a symmetric
  // ridge — bass in the middle, treble falling away to both edges.
  const histMirror = new Int32Array(BINS);
  for (let i = 0; i < BINS; i++) {
    histMirror[i] = Math.round(Math.abs(i / (BINS - 1) * 2 - 1) * (BINS - 1));
  }

  /* ---- particle + mesh buffers ---------------------------------------- */

  let particleBuf = null, particleCount = 0;
  function buildParticles(count) {
    if (!pParticles) return;
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const r = Math.pow(Math.random(), 1.35);
      data[i * 4] = r;
      data[i * 4 + 1] = Math.random();
      data[i * 4 + 2] = Math.random();
      data[i * 4 + 3] = Math.pow(Math.random(), 1.7);
    }
    if (!particleBuf) particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    particleCount = count;
  }

  let meshVBuf = null, meshIBuf = null, meshIndexCount = 0;
  function buildMesh(cols, rows) {
    if (!pMesh) return;
    const verts = new Float32Array(cols * rows * 2);
    let k = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        verts[k++] = x / (cols - 1);
        verts[k++] = y / (rows - 1);
      }
    }
    const idx = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols - 1; x++) {
        idx.push(y * cols + x, y * cols + x + 1);
      }
    }
    const stride = Math.max(2, Math.round(cols / 40));
    for (let x = 0; x < cols; x += stride) {
      for (let y = 0; y < rows - 1; y++) idx.push(y * cols + x, (y + 1) * cols + x);
    }
    if (!meshVBuf) meshVBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    if (!meshIBuf) meshIBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    meshIndexCount = idx.length;
  }

  /* ---- state ----------------------------------------------------------- */

  let quality = QUALITY[opts.quality] ? opts.quality : 'high';
  let modeIndex = Math.max(0, Math.min(available.length - 1,
    typeof opts.mode === 'string' ? available.findIndex((m) => m.id === opts.mode) : opts.mode));
  if (modeIndex < 0) modeIndex = 0;
  let paletteIndex = typeof opts.palette === 'string'
    ? Math.max(0, PALETTES.findIndex((p) => p.id === opts.palette))
    : opts.palette % PALETTES.length;

  let intensity = opts.intensity;
  let bloomAmt = opts.bloom;
  let autoCycle = opts.autoCycle;
  let reduced = opts.reducedMotion;

  let scene = null, b1a = null, b1b = null, b2a = null, b2b = null;
  let rw = 0, rh = 0;
  let running = false, raf = 0, lost = false;
  let time = 0, flow = 0, lastFrame = 0, cycleClock = 0;
  let fps = 60, fpsAccum = 0, fpsFrames = 0;
  let autoQuality = true;
  const listeners = { mode: [], error: [] };

  buildParticles(QUALITY[quality].particles);
  buildMesh(QUALITY[quality].mesh[0], QUALITY[quality].mesh[1]);

  /* ---- sizing ---------------------------------------------------------- */

  function resize() {
    const q = QUALITY[quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    const cw = Math.max(1, canvas.clientWidth || canvas.width || 640);
    const ch = Math.max(1, canvas.clientHeight || canvas.height || 360);
    const w = Math.max(2, Math.round(cw * dpr));
    const h = Math.max(2, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const sw = Math.max(2, Math.round(w * q.scale));
    const sh = Math.max(2, Math.round(h * q.scale));
    if (sw === rw && sh === rh && scene) return;
    rw = sw; rh = sh;
    freeTarget(scene); freeTarget(b1a); freeTarget(b1b); freeTarget(b2a); freeTarget(b2b);
    scene = makeTarget(rw, rh);
    b1a = makeTarget(Math.max(2, rw >> 1), Math.max(2, rh >> 1));
    b1b = makeTarget(b1a.w, b1a.h);
    b2a = makeTarget(Math.max(2, rw >> 2), Math.max(2, rh >> 2));
    b2b = makeTarget(b2a.w, b2a.h);
  }

  /* ---- drawing --------------------------------------------------------- */

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(prog.a.aPos);
    gl.vertexAttribPointer(prog.a.aPos, 2, gl.FLOAT, false, 0, 0);
  }

  function drawQuad(prog) {
    bindQuad(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function target(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    const w = t ? t.w : canvas.width;
    const h = t ? t.h : canvas.height;
    gl.viewport(0, 0, w, h);
  }

  function setCommon(prog) {
    const u = prog.u, s = audio.state;
    const pal = PALETTES[paletteIndex].colors.map(hexToRgb);
    if (u.uRes) gl.uniform2f(u.uRes, rw, rh);
    if (u.uTime) gl.uniform1f(u.uTime, time);
    if (u.uFlow) gl.uniform1f(u.uFlow, flow);
    if (u.uBass) gl.uniform1f(u.uBass, s.bass);
    if (u.uMid) gl.uniform1f(u.uMid, s.mid);
    if (u.uTreb) gl.uniform1f(u.uTreb, s.treb);
    if (u.uLevel) gl.uniform1f(u.uLevel, s.level);
    if (u.uBeat) gl.uniform1f(u.uBeat, s.beat);
    if (u.uEnergy) gl.uniform1f(u.uEnergy, s.energy);
    if (u.uIntensity) gl.uniform1f(u.uIntensity, intensity);
    if (u.uMotion) gl.uniform1f(u.uMotion, reduced ? 0.32 : 1.0);
    if (u.uA) gl.uniform3fv(u.uA, pal[0]);
    if (u.uB) gl.uniform3fv(u.uB, pal[1]);
    if (u.uC) gl.uniform3fv(u.uC, pal[2]);
    if (u.uFolds) gl.uniform1f(u.uFolds, 6 + (Math.floor(time / 9) % 5));
    if (u.uAudio) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, audioTex);
      gl.uniform1i(u.uAudio, 0);
    }
  }

  function renderScene() {
    const mode = available[modeIndex];
    target(scene);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (mode.kind === 'frag') {
      const prog = progs[mode.id];
      gl.useProgram(prog.p);
      setCommon(prog);
      drawQuad(prog);
      return;
    }

    // Geometry scenes get an ambient backdrop first, then draw additively.
    gl.useProgram(pBackdrop.p);
    setCommon(pBackdrop);
    drawQuad(pBackdrop);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (mode.kind === 'points') {
      const prog = pParticles;
      gl.useProgram(prog.p);
      setCommon(prog);
      if (prog.u.uPix) gl.uniform1f(prog.u.uPix, Math.max(1, rh / 900));
      gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
      gl.enableVertexAttribArray(prog.a.aSeed);
      gl.vertexAttribPointer(prog.a.aSeed, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, particleCount);
      gl.disableVertexAttribArray(prog.a.aSeed);
    } else if (mode.kind === 'mesh') {
      const prog = pMesh;
      gl.useProgram(prog.p);
      setCommon(prog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, histTex);
      if (prog.u.uHist) gl.uniform1i(prog.u.uHist, 1);
      if (prog.u.uHead) gl.uniform1f(prog.u.uHead, (histRow + 0.5) / HIST_ROWS);
      gl.bindBuffer(gl.ARRAY_BUFFER, meshVBuf);
      gl.enableVertexAttribArray(prog.a.aGrid);
      gl.vertexAttribPointer(prog.a.aGrid, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIBuf);
      gl.drawElements(gl.LINES, meshIndexCount, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(prog.a.aGrid);
    }

    gl.disable(gl.BLEND);
  }

  function renderPost() {
    gl.disable(gl.BLEND);

    if (bloomAmt > 0.001) {
      // Bright pass at half resolution.
      target(b1a);
      gl.useProgram(pBright.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.uniform1i(pBright.u.uTex, 0);
      gl.uniform2f(pBright.u.uTexel, 1 / scene.w, 1 / scene.h);
      gl.uniform1f(pBright.u.uThresh, 0.72);
      drawQuad(pBright);

      gl.useProgram(pBlur.p);
      gl.uniform1i(pBlur.u.uTex, 0);

      const blur = (src, dst, dx, dy) => {
        target(dst);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(pBlur.u.uDir, dx / dst.w, dy / dst.h);
        drawQuad(pBlur);
      };

      blur(b1a, b1b, 1, 0);
      blur(b1b, b1a, 0, 1);
      blur(b1a, b2a, 1, 0);
      blur(b2a, b2b, 0, 1);
      blur(b2b, b2a, 1.6, 0);
      blur(b2a, b2b, 0, 1.6);
    }

    target(null);
    gl.useProgram(pComp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(pComp.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (bloomAmt > 0.001 ? b1a : scene).tex);
    gl.uniform1i(pComp.u.uBloom1, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, (bloomAmt > 0.001 ? b2b : scene).tex);
    gl.uniform1i(pComp.u.uBloom2, 2);
    gl.uniform2f(pComp.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(pComp.u.uTime, time);
    gl.uniform1f(pComp.u.uBeat, audio.state.beat);
    gl.uniform1f(pComp.u.uBloomAmt, bloomAmt);
    gl.uniform1f(pComp.u.uChroma, opts.chroma);
    gl.uniform1f(pComp.u.uVignette, opts.vignette);
    gl.uniform1f(pComp.u.uGrain, opts.grain);
    gl.uniform1f(pComp.u.uExposure, opts.exposure);
    drawQuad(pComp);
  }

  function uploadAudio() {
    const s = audio.state;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BINS, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, s.tex);

    // Push the newest spectrum slice into the scrolling history. This runs
    // every frame, not only in the spectrogram scene, so switching into it
    // lands on a filled buffer rather than a flat plane.
    for (let i = 0; i < BINS; i++) histSlice[i] = s.tex[histMirror[i]];
    histRow = (histRow + 1) % HIST_ROWS;
    gl.bindTexture(gl.TEXTURE_2D, histTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, histRow, BINS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, histSlice);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (lost) return;

    if (!lastFrame) lastFrame = now;
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    dt = Math.min(0.05, Math.max(0.0005, dt));

    time += dt;
    audio.update(dt, now);
    flow += dt * (0.5 + audio.state.energy * 1.7) * (reduced ? 0.35 : 1);

    // Drop quality if the frame budget is consistently blown.
    fpsAccum += dt; fpsFrames++;
    if (fpsAccum > 1.4) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0; fpsFrames = 0;
      if (autoQuality && fps < 26 && quality !== 'low') {
        setQuality(quality === 'high' ? 'medium' : 'low');
      }
    }

    if (autoCycle > 0) {
      cycleClock += dt;
      if (cycleClock >= autoCycle) { cycleClock = 0; nextMode(); }
    }

    resize();
    uploadAudio();
    renderScene();
    renderPost();
  }

  /* ---- context loss ---------------------------------------------------- */

  function onLost(e) { e.preventDefault(); lost = true; }
  function onRestored() { lost = false; }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  /* ---- public API ------------------------------------------------------ */

  function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => fn(payload)); }

  function setMode(i) {
    modeIndex = ((i % available.length) + available.length) % available.length;
    cycleClock = 0;
    emit('mode', { index: modeIndex, mode: available[modeIndex] });
  }

  function setModeById(id) {
    const i = available.findIndex((m) => m.id === id);
    if (i >= 0) setMode(i);
  }

  function nextMode() { setMode(modeIndex + 1); }
  function prevMode() { setMode(modeIndex - 1); }

  function setQuality(q) {
    if (!QUALITY[q] || q === quality) return;
    quality = q;
    buildParticles(QUALITY[q].particles);
    buildMesh(QUALITY[q].mesh[0], QUALITY[q].mesh[1]);
    rw = 0; rh = 0;
    resize();
  }

  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    resize();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function dispose() {
    stop();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    audio.dispose();
    freeTarget(scene); freeTarget(b1a); freeTarget(b1b); freeTarget(b2a); freeTarget(b2b);
    gl.deleteTexture(audioTex);
    gl.deleteTexture(histTex);
    gl.deleteBuffer(quadBuf);
    if (particleBuf) gl.deleteBuffer(particleBuf);
    if (meshVBuf) gl.deleteBuffer(meshVBuf);
    if (meshIBuf) gl.deleteBuffer(meshIBuf);
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  resize();

  return {
    audio,
    modes: available,
    palettes: PALETTES,
    start, stop, dispose, resize,
    setMode, setModeById, nextMode, prevMode,
    setPalette(i) { paletteIndex = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length; },
    setPaletteById(id) { const i = PALETTES.findIndex((p) => p.id === id); if (i >= 0) paletteIndex = i; },
    setIntensity(v) { intensity = Math.max(0.1, Math.min(2.5, v)); },
    setBloom(v) { bloomAmt = Math.max(0, Math.min(2, v)); },
    setQuality,
    setAutoCycle(sec) { autoCycle = Math.max(0, sec || 0); cycleClock = 0; },
    setReducedMotion(v) { reduced = !!v; },
    setPostOption(key, value) { if (key in opts) opts[key] = value; },
    on(evt, fn) { if (listeners[evt]) listeners[evt].push(fn); },
    get modeIndex() { return modeIndex; },
    get mode() { return available[modeIndex]; },
    get paletteIndex() { return paletteIndex; },
    get quality() { return quality; },
    get fps() { return fps; },
    get intensity() { return intensity; },
    setAutoQuality(v) { autoQuality = !!v; },
    screenshot(type) { return canvas.toDataURL(type || 'image/png'); }
  };
}

/* ══ component ═══════════════════════════════════════════════════════ */

/* =========================================================================
   <AudioVisualizer />

   Props
     audioRef       React ref to an <audio>/<video> element to visualise.
     audioElement   The element itself, if you don't have a ref.
     analyser       An existing AnalyserNode, if your player already has one.
     stream         A MediaStream (mic, screen share, WebRTC) to visualise.
     mode           Scene id or index. Ids: aurora, halo, tunnel, orb, vortex,
                    city, mesh, terrain, kaleido, fractal, plasma.
     palette        Palette id or index (see PALETTES below).
     intensity      Reactivity multiplier, 0.3 – 2.2. Default 1.
     quality        'low' | 'medium' | 'high'. Default 'high', drops itself
                    if the frame rate can't keep up.
     bloom          Glow amount, 0 – 2. Default 0.65.
     autoCycle      Seconds between automatic scene changes. 0 = off.
     showControls   Render the built-in overlay controls. Default false.
     idleDemo       Play a built-in demo loop when no source is connected.
     paused         Freeze rendering (e.g. while a modal is open).
     className      Passed through to the wrapper div.
     style          Passed through to the wrapper div.
     onModeChange   Called with { index, mode } whenever the scene changes.
     onReady        Called with the engine handle once it has started.
   ========================================================================= */

export default function AudioVisualizer({
  audioRef,
  audioElement,
  analyser,
  stream,
  mode = 0,
  palette = 0,
  intensity = 1,
  quality = "high",
  bloom = 0.65,
  autoCycle = 0,
  showControls = false,
  idleDemo = false,
  paused = false,
  className = "",
  style,
  onModeChange,
  onReady
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const vizRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(0);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [uiVisible, setUiVisible] = useState(true);
  const [failed, setFailed] = useState(null);
  const idleTimer = useRef(0);

  /* ---- create the engine once ----------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let viz;
    try {
      viz = createVisualizer(canvas, {
        mode,
        palette,
        intensity,
        quality,
        bloom,
        autoCycle,
        reducedMotion:
          typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
      });
    } catch (err) {
      setFailed(err.message || "Visualizer failed to start");
      return undefined;
    }
    if (!viz) {
      setFailed("WebGL is not available on this device");
      return undefined;
    }

    vizRef.current = viz;
    viz.on("mode", (e) => {
      setCurrent(e.index);
      if (onModeChange) onModeChange(e);
    });
    setCurrent(viz.modeIndex);
    setPaletteIdx(viz.paletteIndex);
    viz.start();
    setReady(true);
    if (onReady) onReady(viz);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => viz.resize())
        : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);

    // Don't burn a GPU on a tab nobody is looking at.
    const onVis = () => (document.hidden ? viz.stop() : viz.start());
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (ro) ro.disconnect();
      viz.dispose();
      vizRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- keep props in sync --------------------------------------------- */
  useEffect(() => {
    const viz = vizRef.current;
    if (!viz) return;
    if (typeof mode === "string") viz.setModeById(mode);
    else viz.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const viz = vizRef.current;
    if (!viz) return;
    if (typeof palette === "string") viz.setPaletteById(palette);
    else viz.setPalette(palette);
    setPaletteIdx(viz.paletteIndex);
  }, [palette]);

  useEffect(() => {
    if (vizRef.current) vizRef.current.setIntensity(intensity);
  }, [intensity]);
  useEffect(() => {
    if (vizRef.current) vizRef.current.setBloom(bloom);
  }, [bloom]);
  useEffect(() => {
    if (vizRef.current) vizRef.current.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    if (vizRef.current) vizRef.current.setAutoCycle(autoCycle);
  }, [autoCycle]);
  useEffect(() => {
    const viz = vizRef.current;
    if (!viz) return;
    if (paused) viz.stop();
    else viz.start();
  }, [paused]);

  /* ---- connect the audio source --------------------------------------- */
  useEffect(() => {
    const viz = vizRef.current;
    if (!viz || !ready) return undefined;
    const el = audioElement || (audioRef && audioRef.current);

    if (analyser) {
      viz.audio.connectAnalyser(analyser);
    } else if (stream) {
      viz.audio.connectStream(stream);
    } else if (el) {
      // Browsers only let an AudioContext start from a user gesture, so the
      // tap is (re)attempted on the element's own play event as well.
      const attach = () => {
        viz.audio.resume();
        viz.audio.connectElement(el);
      };
      attach();
      el.addEventListener("play", attach);
      return () => el.removeEventListener("play", attach);
    } else if (idleDemo) {
      const start = () => {
        viz.audio.resume().then(() => viz.audio.startDemo());
        window.removeEventListener("pointerdown", start);
        window.removeEventListener("keydown", start);
      };
      window.addEventListener("pointerdown", start);
      window.addEventListener("keydown", start);
      return () => {
        window.removeEventListener("pointerdown", start);
        window.removeEventListener("keydown", start);
      };
    }
    return undefined;
  }, [ready, analyser, stream, audioElement, audioRef, idleDemo]);

  /* ---- overlay controls ------------------------------------------------ */
  const wake = useCallback(() => {
    if (!showControls) return;
    setUiVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setUiVisible(false), 3800);
  }, [showControls]);

  useEffect(() => {
    if (showControls) wake();
    return () => clearTimeout(idleTimer.current);
  }, [showControls, wake]);

  const viz = vizRef.current;
  const modes = viz ? viz.modes : [];

  const wrapStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background: "#04060b",
    ...style
  };

  const chip = (active) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    height: 28,
    padding: "0 12px",
    border: "1px solid " + (active ? "rgba(120,180,255,.55)" : "rgba(122,170,235,.18)"),
    borderRadius: 99,
    background: active ? "rgba(74,158,255,.14)" : "rgba(9,16,29,.55)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    color: active ? "#bcdcff" : "rgba(180,200,228,.62)",
    font: "500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: ".12em",
    textTransform: "uppercase",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "border-color .18s, color .18s, background .18s"
  });

  if (failed) {
    return (
      <div ref={wrapRef} className={className} style={wrapStyle}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 24,
            textAlign: "center",
            color: "rgba(180,200,228,.6)",
            font: "400 13px/1.6 system-ui, sans-serif"
          }}
        >
          {failed}. Playback is unaffected.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={className}
      style={wrapStyle}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />

      {showControls && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "40px 18px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            background: "linear-gradient(to top, rgba(2,5,10,.78), transparent)",
            opacity: uiVisible ? 1 : 0,
            pointerEvents: uiVisible ? "auto" : "none",
            transition: "opacity .4s ease"
          }}
        >
          <div style={{ display: "flex", gap: 6, overflowX: "auto", maxWidth: "100%", paddingBottom: 2 }}>
            {modes.map((m, i) => (
              <button
                key={m.id}
                type="button"
                title={m.blurb}
                onClick={() => vizRef.current && vizRef.current.setMode(i)}
                style={chip(i === current)}
              >
                {m.name}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {PALETTES.map((p, i) => (
              <button
                key={p.id}
                type="button"
                title={p.name}
                aria-label={"Palette: " + p.name}
                onClick={() => {
                  if (!vizRef.current) return;
                  vizRef.current.setPalette(i);
                  setPaletteIdx(i);
                }}
                style={{
                  width: 19,
                  height: 19,
                  borderRadius: "50%",
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,.16)",
                  background:
                    "linear-gradient(135deg," + p.colors[0] + " 0%," + p.colors[1] + " 55%," + p.colors[2] + " 100%)",
                  boxShadow: i === paletteIdx ? "0 0 0 2px #04060b, 0 0 0 3.5px #a8d3ff" : "none"
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { MODES, PALETTES };
