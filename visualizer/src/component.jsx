import React, { useRef, useEffect, useState, useCallback } from "react";

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
