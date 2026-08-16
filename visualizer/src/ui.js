/* =========================================================================
   PULSE — demo page wiring.
   Only the showcase page uses this; the React component ships its own UI.
   ========================================================================= */

export function bootDemoUI({ createVisualizer, PALETTES }) {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const canvas = $('gl');
  const player = $('player');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const viz = createVisualizer(canvas, {
    mode: 0, palette: 0, intensity: 1.0, quality: 'high', reducedMotion: reduced
  });

  if (!viz) {
    $('gate').innerHTML =
      '<div class="gate-inner"><h1>WebGL unavailable</h1>' +
      '<p>This browser or device has WebGL disabled, so the visualizer can’t run here. ' +
      'Try a different browser, or enable hardware acceleration.</p></div>';
    return;
  }

  viz.start();

  /* ---- toast ----------------------------------------------------------- */
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---- mode rail ------------------------------------------------------- */
  const rail = $('rail');
  viz.modes.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mode';
    b.type = 'button';
    b.dataset.index = String(i);
    b.setAttribute('aria-current', i === viz.modeIndex ? 'true' : 'false');
    b.innerHTML =
      '<span class="num">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="txt"><span class="nm"></span><span class="bl"></span></span>';
    b.querySelector('.nm').textContent = m.name;
    b.querySelector('.bl').textContent = m.blurb;
    b.addEventListener('click', () => viz.setMode(i));
    rail.appendChild(b);
  });

  function labelMode(mode) { $('modeLabel').textContent = mode.name + ' — ' + mode.blurb; }
  labelMode(viz.mode);

  viz.on('mode', ({ index, mode }) => {
    rail.querySelectorAll('.mode').forEach((el, i) =>
      el.setAttribute('aria-current', i === index ? 'true' : 'false'));
    labelMode(mode);
    const active = rail.children[index];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  /* ---- palettes -------------------------------------------------------- */
  const sw = $('swatches');
  PALETTES.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'sw';
    b.type = 'button';
    b.title = p.name;
    b.setAttribute('aria-label', 'Palette: ' + p.name);
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    b.style.background = 'linear-gradient(135deg,' + p.colors[0] + ' 0%,' + p.colors[1] + ' 55%,' + p.colors[2] + ' 100%)';
    b.addEventListener('click', () => {
      viz.setPalette(i);
      sw.querySelectorAll('.sw').forEach((el, j) => el.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
      toast('Palette · ' + p.name);
    });
    sw.appendChild(b);
  });

  /* ---- sliders --------------------------------------------------------- */
  $('intensity').addEventListener('input', (e) => {
    const v = e.target.value / 100;
    viz.setIntensity(v);
    $('intensityOut').textContent = v.toFixed(1);
  });
  $('bloom').addEventListener('input', (e) => {
    const v = e.target.value / 100;
    viz.setBloom(v);
    $('bloomOut').textContent = v.toFixed(1);
  });

  /* ---- audio sources --------------------------------------------------- */
  const srcButtons = { demo: $('srcDemo'), mic: $('srcMic'), file: $('srcFile') };
  function markSource(which, label) {
    Object.keys(srcButtons).forEach((k) => srcButtons[k].classList.toggle('on', k === which));
    $('srcLabel').textContent = label;
  }

  async function useDemo() {
    await viz.audio.resume();
    player.pause();
    viz.audio.startDemo();
    markSource('demo', 'Demo track · 122 BPM');
    toast('Playing built-in demo track');
  }

  async function useMic() {
    try {
      await viz.audio.resume();
      player.pause();
      await viz.audio.connectMicrophone();
      markSource('mic', 'Live microphone input');
      toast('Listening to microphone');
    } catch (err) {
      toast('Microphone blocked');
      console.warn(err);
    }
  }

  function pickFile() { $('file').click(); }

  async function playFile(f) {
    if (!f) return;
    await viz.audio.resume();
    viz.audio.stopDemo();
    player.src = URL.createObjectURL(f);
    viz.audio.connectElement(player);
    try { await player.play(); } catch (e) { /* autoplay guard */ }
    markSource('file', f.name.replace(/\.[^.]+$/, '').slice(0, 34));
    toast('Now playing your file');
  }

  srcButtons.demo.addEventListener('click', useDemo);
  srcButtons.mic.addEventListener('click', useMic);
  srcButtons.file.addEventListener('click', pickFile);
  $('file').addEventListener('change', (e) => playFile(e.target.files[0]));

  ['dragover', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' && e.dataTransfer.files[0]) playFile(e.dataTransfer.files[0]);
  }));

  /* ---- gate ------------------------------------------------------------ */
  const gate = $('gate');
  function openStage() { gate.classList.add('hide'); }
  $('start').addEventListener('click', async () => { openStage(); await useDemo(); });
  $('gateMic').addEventListener('click', async (e) => { e.stopPropagation(); openStage(); await useMic(); });
  $('gateFile').addEventListener('click', (e) => { e.stopPropagation(); openStage(); pickFile(); });

  /* ---- toggles --------------------------------------------------------- */
  let cycling = false;
  $('cycle').addEventListener('click', (e) => {
    cycling = !cycling;
    viz.setAutoCycle(cycling ? 18 : 0);
    e.currentTarget.classList.toggle('on', cycling);
    toast(cycling ? 'Auto-cycling every 18s' : 'Auto-cycle off');
  });

  const qualities = ['high', 'medium', 'low'];
  $('quality').addEventListener('click', (e) => {
    const next = qualities[(qualities.indexOf(viz.quality) + 1) % qualities.length];
    viz.setAutoQuality(false);
    viz.setQuality(next);
    e.currentTarget.textContent = 'Quality · ' + next[0].toUpperCase() + next.slice(1);
  });

  $('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  });

  /* ---- keyboard -------------------------------------------------------- */
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key >= '1' && e.key <= '9') viz.setMode(+e.key - 1);
    else if (e.key === '0') viz.setMode(9);
    else if (e.key === 'ArrowRight') viz.nextMode();
    else if (e.key === 'ArrowLeft') viz.prevMode();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const n = PALETTES.length;
      const i = (viz.paletteIndex + (e.key === 'ArrowUp' ? 1 : n - 1)) % n;
      viz.setPalette(i);
      sw.querySelectorAll('.sw').forEach((el, j) => el.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
      toast('Palette · ' + PALETTES[i].name);
    } else if (e.key.toLowerCase() === 'f') $('full').click();
    else if (e.key === ' ') { e.preventDefault(); $('cycle').click(); }
  });

  /* ---- idle HUD -------------------------------------------------------- */
  let idleTimer = 0;
  function wake() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!gate.classList.contains('hide')) return;
      stage.classList.add('idle');
    }, 4200);
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach((ev) =>
    window.addEventListener(ev, wake, { passive: true }));
  wake();

  /* ---- readouts -------------------------------------------------------- */
  const meters = [$('mBass'), $('mMid'), $('mTreb')];
  setInterval(() => {
    const s = viz.audio.state;
    const v = [s.bass, s.mid, s.treb];
    meters.forEach((el, i) => {
      el.style.setProperty('--v', Math.max(4, Math.min(100, v[i] * 78)) + '%');
    });
    $('fps').textContent = Math.round(viz.fps) + ' fps';
  }, 90);

  /* ---- copy component source ------------------------------------------- */
  const copyBtn = $('copyBtn');
  if (copyBtn) {
    const label = copyBtn.lastChild;
    const say = (msg) => {
      label.textContent = ' ' + msg;
      setTimeout(() => { label.textContent = ' Copy the React component'; }, 3000);
    };

    // navigator.clipboard is unavailable in some embedded/sandboxed frames, so
    // fall back to a selection copy before giving up.
    function legacyCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    copyBtn.addEventListener('click', async () => {
      let src;
      try {
        const inline = document.getElementById('jsx-source');
        src = inline ? inline.textContent : await fetch('./AudioVisualizer.jsx').then((r) => r.text());
      } catch (err) {
        say('Could not read the source — open AudioVisualizer.jsx in the repo');
        return;
      }
      src = src.trim();
      const size = Math.round(src.length / 1024);
      try {
        await navigator.clipboard.writeText(src);
        say('Copied ' + size + ' KB — paste into components/AudioVisualizer.jsx');
      } catch (err) {
        if (legacyCopy(src)) say('Copied ' + size + ' KB — paste into components/AudioVisualizer.jsx');
        else say('Clipboard blocked here — open AudioVisualizer.jsx in the repo');
      }
    });
  }

  window.pulse = viz;
}
