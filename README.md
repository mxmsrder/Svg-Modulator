# SVG Oscillator Editor

A browser-based animation sketchbook. Import SVG shapes, bind modulators to their geometry and colour, and export animated sequences. No build step — open `index.html` in a browser or serve with any static HTTP server.

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

<details>
<summary><strong>Getting Started</strong></summary>

1. **Open** the editor — `sketches/starter.osc` loads automatically. If you want a blank slate, use **OPEN → New Canvas**.
2. **Import a shape** — drag an `.svg` file onto the canvas, or use **IMPORT** in the toolbar. Shapes appear white-filled with no stroke by default.
3. **Add a modulator** — click **+ ADD** in the Modulators panel. An LFO starts playing immediately.
4. **Bind it** — select a path, then find the Bindings table in the Inspector. Drag the slider in the row you want to animate (e.g. `tx` for horizontal movement).
5. **Play** — press **Space** or **▶ PLAY**. Stop with **■ STOP** — shapes freeze at their animated position.
6. **Save** — use **EXPORT → Save Sketch (.osc)** to download the full sketch file, or **SAVE** to store in the browser.

</details>

---

<details>
<summary><strong>Navigation</strong></summary>

| Action | Input |
|---|---|
| Pan | Hold **Space** + drag, or two-finger scroll on trackpad |
| Zoom | **Ctrl + scroll** (pinch on trackpad) |
| Fit view | **H** or **F**, or **FIT** button |
| Rubber-band select | Drag on empty canvas |
| Add to selection | **Shift + click** path or point |
| Toggle play | **Space** (tap) |
| Undo / Redo | **Cmd/Ctrl + Z** / **Cmd/Ctrl + Shift + Z** |
| Delete selected | **Delete** or **Backspace** |

</details>

---

<details>
<summary><strong>Modulator Types</strong></summary>

| Type | Description | Key parameters |
|---|---|---|
| **LFO** | Sine / triangle / square / sawtooth / noise oscillator | Frequency, Amplitude, Phase, Offset, **Curve** (waveform roundness) |
| **Step** | Beat-locked step sequencer | Steps, Rate (steps/beat), per-step values |
| **Walk** | Random walk with low-pass smoothing | Rate, Smooth, Min, Max |
| **Audio** | Live microphone frequency analysis | Band (all/low/mid/high), Smooth, Amp |
| **Expr** | Custom JS formula — variables `t` (seconds) and `bpm` | Expression textarea |
| **Track** | Audio file frequency analysis with spectrum display | Load audio, Band, Smooth, Amp |

**Common controls**
- **●/○** toggle — enable or disable the modulator without deleting it
- **Double-click name** — rename inline
- **×** — delete (undoable with Cmd/Ctrl + Z)
- **Type selector** — switch type; history is pushed so the switch is undoable

</details>

---

<details>
<summary><strong>Bindable Properties</strong></summary>

Every row in the Bindings table is a path property that can be driven by any modulator. Drag the slider to set the scale (sensitivity). Double-click to type an exact value.

| Property | Effect |
|---|---|
| `tx` / `ty` | Translate (move) the entire path |
| `rotation` | Rotate around centroid |
| `scaleX` / `scaleY` | Scale around centroid |
| `fillOpacity` | Fade fill in and out |
| `strokeWidth` | Animate stroke thickness |
| `fillH/S/L` | Animate fill hue, saturation, lightness |
| `strokeH/S/L` | Animate stroke hue, saturation, lightness |

Per-point bindings (visible when a point is selected): `x`, `y`, `handleIn.x/y`, `handleOut.x/y`.

</details>

---

<details>
<summary><strong>Shape Appearance</strong></summary>

Select a path, then use the **Appearance** section in the Inspector:

- **FILL / STROKE / BOTH** — switch the draw mode
- **Colour picker** — sets the base colour; oscillators modulate it via HSL deltas on top
- **Fill opacity slider** — base fill transparency (0–1)
- **Stroke width slider** — base stroke thickness in SVG units

Wireframe mode (**⬜ WIRE** toolbar button) overrides all appearance and shows every path as a 1 px screen-space line, regardless of zoom.

</details>

---

<details>
<summary><strong>File Library</strong></summary>

The editor loads files from two folders. Drop new files into these folders and update `library.json` to make them appear in the **OPEN** dropdown.

```
sketches/          .osc sketch files (full state: paths + modulators + bindings)
svg-library/       .svg shape libraries
library.json       manifest — lists what appears in the OPEN dropdown
```

**`library.json` format**

```json
{
  "sketches": [
    { "name": "My sketch",  "file": "sketches/my-sketch.osc" }
  ],
  "svgs": [
    { "name": "My shapes",  "file": "svg-library/my-shapes.svg" }
  ]
}
```

**New Canvas** — clears all paths, modulators and bindings (asks for confirmation if the canvas has content).

</details>

---

<details>
<summary><strong>Export Options</strong></summary>

| Export | Description |
|---|---|
| **Static SVG** | Current frame as a flat `.svg` file |
| **Animated SVG (SMIL)** | LFO-driven animations baked into SVG `<animate>` elements |
| **Save Sketch (.osc)** | Full sketch JSON — reopen with OPEN or IMPORT |
| **Save State (JSON)** | Same as `.osc`, `.json` extension |
| **PNG Sequence / MP4…** | Opens the export dialog for ZIP of frames or WebM video |

> PNG/video export uses [JSZip](https://stuk.github.io/jszip/) from CDN — requires internet access.

</details>

---

<details>
<summary><strong>Undo / Redo</strong></summary>

History captures the **full state** on every structural change: path edits, modulator adds/deletes/type changes, binding edits, and appearance changes. Up to 60 steps are kept.

- **Cmd/Ctrl + Z** — undo
- **Cmd/Ctrl + Shift + Z** or **Cmd/Ctrl + Y** — redo
- Toolbar **↩ ↪** buttons reflect availability

> Slider drag changes during playback do not currently push individual history steps per frame — only structural changes do.

</details>

---

<details>
<summary><strong>Source Code Map</strong></summary>

```
index.html                  Shell, toolbar, panels, export dialog
styles.css                  Dark theme (near-black, monospace)
main.js                     App state, rAF loop, keyboard, import/export,
                            library/open dropdown, rubber-band selection

modules/
  PathModel.js              Point, BezierHandle, PathModel
                            Every animated field has a base* counterpart
  SVGParser.js              Parse SVG 'd', normalise to M/C/Z, arc→cubic
                            Closes duplicate end-points on import
  CanvasViewport.js         viewBox pan/zoom, path render, HSL colour compute
                            Wireframe always 1 px screen-space
  PointOverlay.js           Anchor + handle visual + hit targets (3× invisible)
  OscillatorEngine.js       6 modulator types, LFO curve shaping, audio track
  BindingSystem.js          resetToBase() + applyAll() every frame
  PathOperations.js         DragController, resample, split, mirror
  History.js                Full-state 60-step undo/redo

panels/
  OscillatorPanel.js        Modulator cards, Rekordbox visualizer for Track type
  BindingPanel.js           Binding matrix (BoxSliders)
  PathInspector.js          Single / multi-shape inspector

components/
  BoxSlider.js              Drag fill-in-rect slider; dblclick to type value
```

</details>

---

<details>
<summary><strong>Known Limitations</strong></summary>

- **Audio track** — browser security (CORS / AudioContext) may block audio file analysis depending on how the editor is served. The Track card always shows the spectrum visualizer; audio reactivity requires HTTPS or localhost.
- **PNG/video export** — JSZip loads from CDN; export fails offline.
- **Microphone** — requires HTTPS or localhost (browser security policy).
- **Audio buffers** — not saved in `.osc` files; re-import audio each session.
- **Mirror slaves** — share no bindings; geometry syncs from master post-bind.

</details>

---

<details>
<summary><strong>Project Context</strong></summary>

This repository is used for:

- **Prototyping animation and web effects**
- **Experimenting with AI-assisted creative coding**
- **Exploring SVG-driven generative design**
- **Experience design research and visual experiments**

Built iteratively with Claude Code (Anthropic).

</details>
