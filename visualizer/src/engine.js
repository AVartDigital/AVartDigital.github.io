/* =========================================================================
   PULSE — WebGL renderer
   Owns the GL context, the ten scenes, the bloom chain and the frame loop.
   ========================================================================= */

import {
  MODES, PALETTES, VS_QUAD, VS_PARTICLES, FS_PARTICLES, VS_MESH, FS_MESH,
  FS_BACKDROP, FS_BRIGHT, FS_BLUR, FS_COMPOSITE
} from './shaders.js';
import { createAudioEngine, BINS } from './audio.js';

export { MODES, PALETTES };

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

export function createVisualizer(canvas, options = {}) {
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
