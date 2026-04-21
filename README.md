# SVG Oscillator Editor

A browser-based animation sketchbook. Import SVG shapes, bind modulators to their geometry and colour, and export animated sequences. No build step — open `index.html` in a browser or serve with any static HTTP server.

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

## Getting Started

1. Open the editor — base shapes load automatically on first visit.
2. Import a shape — drag an `.svg` file onto the canvas, or use **IMPORT** in the toolbar.
3. Add a modulator — click **+ ADD** in the Modulators panel on the left.
4. Bind it — select a path, then find the Bindings table in the Inspector. Drag a slider in the row you want to animate (e.g. `tx` for horizontal movement).
5. Play — press **Space** or **▶ PLAY**. Stop with **■ STOP**.
6. Save — press **S**, or click **SAVE** in the toolbar to store in the browser. Use **EXPORT → Save Sketch (.osc)** to download a file.

---

## Navigation

| Action | Input |
|---|---|
| Pan | Hold **Alt/Option** + drag, or two-finger scroll on trackpad |
| Zoom | **Ctrl + scroll** or pinch on trackpad |
| Fit view | **H** or **F**, or the **FIT** button |
| Rubber-band select | Drag on empty canvas |
| Add to selection | **Shift + click** a path or point |
| Toggle play | **Space** |
| Save | **S** or **Cmd/Ctrl + S** |
| Undo / Redo | **Cmd/Ctrl + Z** / **Cmd/Ctrl + Shift + Z** |
| Delete selected | **Delete** or **Backspace** |

---

## Toolbar

**Left** — IMPORT (drag or browse) and EXPORT dropdown.

**Centre** — SAVE · LOAD▾ · CLEAR · ↩ · ↪ · then view toggles (● PTS, ◇ HDL, ⬜ WIRE).

The **LOAD** dropdown has three columns:

- **Recent** — last 10 browser saves (auto-filled when you press SAVE)
- **Shapes** — SVG files from `svg-library/` listed in `library.json`, plus Circle, Square, Triangle built-ins
- **Sketches** — `.osc` sketch files listed in `library.json`

**Right** — BPM input, zoom buttons, ▶ PLAY.

---

## Modulator Types

| Type | Description | Key parameters |
|---|---|---|
| **LFO** | Sine / triangle / square / sawtooth / noise oscillator | Frequency, Amplitude, Phase, Offset, Curve |
| **Step** | Beat-locked step sequencer | Steps (2–16), Rate (steps/beat), per-step values (drag up/down) |
| **Walk** | Random walk with low-pass smoothing | Rate, Smooth, Min, Max |
| **Audio** | Live microphone frequency analysis | Band (all/low/mid/high), Smooth, Amp |
| **Expr** | Custom JS formula — variables `t` (seconds) and `bpm` | Expression textarea with examples |
| **Track** | Audio file frequency analysis with spectrum display | Load audio, Band, Smooth, Amp, Threshold, Mute |
| **Env** | Freeform envelope — drag breakpoints on a canvas | Period, Amp, Smooth, SNAP, LOOP |
| **Device** | Live sensor input | Sensor selector, Scale, Smooth |

**Common controls on every card**

- **●/○** toggle — enable or disable without deleting
- **Double-click name** — rename inline
- **Type selector** — switch type (undoable)
- **×** — delete (undoable)

---

## Envelope Modulator

The Env type shows a canvas with draggable breakpoints:

- **Click** empty area → add a breakpoint
- **Drag** a breakpoint → move it
- **Double-click** a breakpoint → remove it (minimum 2 points)
- **SNAP** — snap to 1/8 grid
- **LOOP** — repeat continuously, or play once
- **Smooth** slider blends from linear interpolation to Catmull-Rom spline
- A dashed playhead shows the current position during playback

---

## Device / Sensor Modulator

Reads a live sensor and outputs its value multiplied by Scale.

The live readout above the sliders shows the raw sensor value before scaling.

| Sensor | Raw range | Notes |
|---|---|---|
| Mouse X / Y | 0–100 | Percentage of window size |
| Battery | 0–100 | Battery percentage |
| Clock | 0–59 | Seconds within the current minute |
| Orient α | 0–360° | Compass heading (device rotation around Z) |
| Orient β | −180–180° | Front-to-back tilt |
| Orient γ | −90–90° | Left-to-right tilt |
| Lid / Hinge | 0–360° | Foldable hinge angle (HingeAngleSensor API); falls back to screen orientation angle |
| Ambient Light | lux | Requires browser support and hardware sensor |

Orientation sensors on iOS require a permission prompt — selecting the sensor type triggers it automatically.

---

## Bindable Properties

Select a path to see the Bindings table in the Inspector. Drag a slider to set the scale (sensitivity), or double-click to type an exact value.

| Property | Effect |
|---|---|
| `tx` / `ty` | Translate the entire path |
| `rotation` | Rotate around centroid |
| `scaleX` / `scaleY` | Scale around centroid |
| `fillOpacity` | Fade fill in and out |
| `strokeWidth` | Animate stroke thickness |
| `fillH/S/L` | Animate fill hue, saturation, lightness |
| `strokeH/S/L` | Animate stroke hue, saturation, lightness |

Select a point to see per-point bindings: `x`, `y`, `handleIn.x/y`, `handleOut.x/y`.

---

## Shape Appearance

Select a path and use the **Appearance** section in the Inspector:

- **FILL / STROKE / BOTH** — draw mode
- Colour picker — base colour (oscillators modulate via HSL deltas on top)
- **Fill opacity** — base transparency
- **Stroke width** — base thickness in SVG units

**⬜ WIRE** mode overrides all appearance and shows every path as a 1 px screen-space line regardless of zoom.

Multi-select (Shift+click or rubber band) shows a shared appearance panel for changing fill and stroke across all selected shapes at once.

---

## File Library

Drop files into the folders below and update `library.json` to make them appear in the **LOAD** dropdown.

```
sketches/        .osc sketch files  (paths + modulators + bindings)
svg-library/     .svg shape libraries
library.json     manifest
```

`library.json` format:

```json
{
  "sketches": [
    { "name": "My sketch", "file": "sketches/my-sketch.osc" }
  ],
  "svgs": [
    { "name": "My shapes", "file": "svg-library/my-shapes.svg" }
  ]
}
```

---

## Export Options

| Export | Description |
|---|---|
| **Static SVG** | Current frame as a flat `.svg` |
| **Animated SVG (SMIL)** | LFO-driven animations baked as SVG `<animate>` elements |
| **Save Sketch (.osc)** | Full sketch JSON — reopen with LOAD or IMPORT |
| **Save State (JSON)** | Same as `.osc`, `.json` extension |
| **PNG Sequence / MP4…** | Opens the export dialog for a ZIP of frames or WebM video |

PNG/video export uses [JSZip](https://stuk.github.io/jszip/) from CDN — requires internet access.

---

## Undo / Redo

History captures the full state on every structural change: path edits, modulator adds/removes/type changes, binding edits, and appearance changes. Up to 60 steps are kept.

- **Cmd/Ctrl + Z** — undo
- **Cmd/Ctrl + Shift + Z** or **Cmd/Ctrl + Y** — redo
- Toolbar **↩ ↪** buttons reflect availability

---

## Source Map

```
index.html              Shell, toolbar, panels, export dialog
styles.css              Dark theme (near-black, monospace)
main.js                 App state, rAF loop, keyboard shortcuts,
                        import/export, LOAD dropdown, rubber-band selection

modules/
  PathModel.js          Point, BezierHandle, PathModel
                        Every animated field has a base* counterpart
  SVGParser.js          Parse SVG 'd', normalise to M/C/Z, arc→cubic
  CanvasViewport.js     viewBox pan/zoom, path render, HSL colour
  PointOverlay.js       Anchor + handle visuals and hit targets
  OscillatorEngine.js   8 modulator types, LFO curve shaping, audio track,
                        envelope, device/sensor
  BindingSystem.js      resetToBase() + applyAll() each frame
  PathOperations.js     DragController, resample, split, mirror
  History.js            Full-state 60-step undo/redo

panels/
  OscillatorPanel.js    Modulator cards, track spectrum visualizer,
                        envelope canvas editor, device live readout
  BindingPanel.js       Binding matrix with BoxSliders
  PathInspector.js      Single / multi-shape inspector

components/
  BoxSlider.js          Drag fill-in-rect slider; dblclick to type any value
```

---

## Known Limitations

- **Audio track** — AudioContext requires HTTPS or localhost. The spectrum visualizer still animates when audio isn't playing.
- **PNG/video export** — JSZip loads from CDN; export fails offline.
- **Microphone** — requires HTTPS or localhost.
- **Audio buffers** — not saved in `.osc` files; re-import audio each session.
- **Ambient Light / Hinge sensors** — hardware and browser support varies widely; the card shows "Not supported" or "Permission denied" when unavailable.
- **Mirror slaves** — share no bindings; geometry syncs from master after binding is applied.

---

Built iteratively with [Claude Code](https://claude.ai/code) (Anthropic).
