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
export const VS_QUAD = `
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
export const VS_PARTICLES = `
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

export const FS_PARTICLES = `
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
export const VS_MESH = `
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

export const FS_MESH = `
precision highp float;
varying vec3 vCol;
varying float vFade;
void main(){ gl_FragColor = vec4(vCol * vFade, 1.0); }
`;

/* Ambient backdrop drawn behind the geometry-based scenes. ---------------- */
export const FS_BACKDROP = HEAD + `
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
export const FS_BRIGHT = `
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

export const FS_BLUR = `
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

export const FS_COMPOSITE = `
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
export const MODES = [
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
export const PALETTES = [
  { id: 'ultramarine', name: 'Ultramarine', colors: ['#04164a', '#3d8ef5', '#9fd8ff'] },
  { id: 'magenta',     name: 'Neon Dusk',   colors: ['#26063d', '#ff3fb4', '#ffb0e6'] },
  { id: 'solar',       name: 'Solar',       colors: ['#2e0803', '#ff7a1a', '#ffd27a'] },
  { id: 'toxic',       name: 'Toxic',       colors: ['#022619', '#1fe08a', '#9dffcf'] },
  { id: 'ice',         name: 'Glacier',     colors: ['#03202c', '#2fdcff', '#b5f1ff'] },
  { id: 'violet',      name: 'Nightshade',  colors: ['#130830', '#8b5cf6', '#c9b2ff'] },
  { id: 'ember',       name: 'Ember',       colors: ['#230410', '#ff2d55', '#ffa88c'] },
  { id: 'mono',        name: 'Platinum',    colors: ['#0a0e14', '#7f93b0', '#dfe9f5'] }
];
