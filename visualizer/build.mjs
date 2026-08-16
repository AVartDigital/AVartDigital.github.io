/* Bundles the ES modules in src/ into the two shippable artefacts:
     AudioVisualizer.jsx  — single-file React component for Base44
     preview.html         — self-contained showcase page (no external files)
   Run with: node visualizer/build.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(HERE, "src", f), "utf8");

function flatten(code) {
  return code
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, "")
    .replace(/^export\s*\{[^}]*\}\s*;\s*$/gm, "")
    .replace(/^export\s+(const|function|class|let)\b/gm, "$1")
    .trim();
}

const engineBundle = [flatten(src("shaders.js")), flatten(src("audio.js")), flatten(src("engine.js"))].join(
  "\n\n"
);

/* ---------- 1. React component ------------------------------------------ */
const component = src("component.jsx");
const reactImport = component.match(/^import React[^\n]*\n/)[0];
const componentBody = component.slice(reactImport.length).trim();

const banner = `/* ─────────────────────────────────────────────────────────────────────────
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

`;

const jsx = [banner + reactImport.trim(), "", "/* ══ engine ══════════════════════════════════════════════════════════ */", "", engineBundle, "", "/* ══ component ═══════════════════════════════════════════════════════ */", "", componentBody, ""].join(
  "\n"
);

fs.writeFileSync(path.join(HERE, "AudioVisualizer.jsx"), jsx);

/* ---------- 2. Self-contained preview page ------------------------------ */
const page = src("../index.html");
const style = page.match(/<style>[\s\S]*?<\/style>/)[0];
const bodyInner = page
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module">[\s\S]*?<\/script>/, "")
  .trim();

if (jsx.includes("</script")) throw new Error("component source would close the embedding script tag");

const inline = `
<title>PULSE — audio-reactive visualizer</title>
${style}
${bodyInner}
<script type="text/plain" id="jsx-source">${jsx}</script>
<script>
(function(){
${engineBundle}

${flatten(src("ui.js"))}

bootDemoUI({ createVisualizer: createVisualizer, MODES: MODES, PALETTES: PALETTES });
})();
</script>
`;

fs.writeFileSync(path.join(HERE, "preview.html"), inline.trim() + "\n");

const kb = (s) => (s.length / 1024).toFixed(1) + " KB";
console.log("AudioVisualizer.jsx  " + kb(jsx));
console.log("preview.html         " + kb(inline));
