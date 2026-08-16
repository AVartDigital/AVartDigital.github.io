/* =========================================================================
   PULSE — audio analysis
   Turns any Web Audio source into the small set of numbers the shaders want:
   a log-spaced spectrum, a waveform, three band energies, and a beat pulse.
   ========================================================================= */

export const BINS = 256;          // texture width
const FFT_SIZE = 2048;
const MIN_HZ = 28;
const MAX_HZ = 16000;

export function createAudioEngine(opts = {}) {
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
export function createDemoTrack(ctx, destination) {
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
