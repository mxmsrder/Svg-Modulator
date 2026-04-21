# SVG Oscillator Editor

A browser-based animation sketchbook. Import SVG shapes, connect modulators to their geometry and colour, and watch them animate in real time. No installation, no build step — open `index.html` in a browser or run a local server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

For a full technical reference of every file and module, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## What it does

You draw or import shapes. You add oscillators (LFOs, step sequencers, envelopes, audio reactivity, sensors, and more). You connect an oscillator to a shape property — position, rotation, scale, colour — and press Play. The shapes animate.

Everything is stored in the browser or exported as a `.osc` sketch file you can reopen later.

---

## Quick start

1. Open the editor. A set of base shapes loads automatically on the first visit.
2. Press **▶ PLAY** (or Space) to see animation if oscillators are already present.
3. Click a shape to select it. The right panel (Inspector) shows its properties and a Bindings table.
4. In the left panel (Modulators), click **+ ADD** to create a new oscillator.
5. In the Inspector Bindings table, drag the slider next to a property (e.g. `tx`) to connect that oscillator to it. The slider value sets the strength of the effect.
6. Press **▶ PLAY** and watch the shape move.
7. Press **S** or click **SAVE** to save to the browser.

---

## Navigation

| Action | Input |
|---|---|
| Pan canvas | Hold **Alt/Option** + drag |
| Pan (trackpad) | Two-finger scroll |
| Zoom | **Ctrl + scroll** or pinch |
| Fit view | **H** or **F**, or **FIT** button |
| Select shape | Click it |
| Add to selection | **Shift + click** |
| Rubber-band select | Drag on empty canvas area |
| Toggle play/stop | **Space** |
| Save | **S** or **Cmd/Ctrl + S** |
| Undo / Redo | **Cmd/Ctrl + Z** / **Cmd/Ctrl + Shift + Z** |
| Delete selected | **Delete** or **Backspace** |

---

## Toolbar

**Left** — IMPORT (drag an `.svg` or `.osc` file, or browse) and EXPORT dropdown.

**Centre** — SAVE · LOAD▾ · CLEAR · ↩ Undo · ↪ Redo · then view toggles: ● PTS (anchor points), ◇ HDL (bezier handles), ⬜ WIRE (wireframe mode).

**Right** — BPM input, zoom controls, ▶ PLAY / ■ STOP.

### LOAD dropdown

The LOAD dropdown has three columns that populate when you open it:

- **Recent** — last 10 browser saves (filled automatically when you press SAVE)
- **Shapes** — Circle, Square, Triangle built-ins, plus any `.svg` files found in `svg-library/`
- **Sketches** — any `.osc` sketch files found in `sketches/`

Drop a new file into `svg-library/` or `sketches/` and it appears the next time you open the dropdown — no configuration file needed.

---

## Modulators

Add a modulator with **+ ADD** in the left panel. Each modulator card shows:

- **●/○** — enable or disable the modulator (disabled outputs zero)
- **Double-click the name** — rename it inline
- **Type selector** — switch between modulator types at any time
- **×** — delete (undoable)

### Modulator types

| Type | What it does |
|---|---|
| **LFO** | Periodic oscillation — sine, triangle, square, sawtooth, or noise. Controls: Frequency, Amplitude, Phase, Offset, Curve (waveshape roundness). |
| **Step** | Beat-locked step sequencer. Up to 16 steps; drag each step value up or down. |
| **Walk** | Random walk with smoothing — wanders continuously between Min and Max. |
| **Audio** | Reacts to live microphone input. Choose a frequency band (all / low / mid / high). |
| **Expr** | Write a custom JavaScript formula using `t` (seconds) and `bpm`. |
| **Track** | Reacts to an audio file you load — same band/smooth/amp controls as Audio. |
| **Env** | Freeform envelope — place and drag breakpoints on a small canvas. Loops or plays once. |
| **Device** | Reads a live sensor: mouse position, battery, clock, device orientation, hinge angle, ambient light. |

---

## Envelope modulator

The Env type shows a small canvas with draggable breakpoints:

- **Click** empty area → add a breakpoint
- **Drag** a breakpoint → reposition it
- **Double-click** a breakpoint → remove it (minimum 2 points)
- **SNAP** — snap breakpoints to a 1/8 grid
- **LOOP** — repeat continuously, or play once and hold
- **Smooth** slider — blend from linear to Catmull-Rom spline interpolation
- A dashed line shows the current playhead position during playback

---

## Device / Sensor modulator

Reads a live sensor and multiplies by Scale to produce the output value. The live readout above the sliders shows the raw sensor value (before scaling).

| Sensor | Raw range | Notes |
|---|---|---|
| Mouse X / Y | 0–100 | Percentage of window width/height |
| Battery | 0–100 | Battery percentage |
| Clock | 0–59 | Seconds within the current minute |
| Orient α | 0–360° | Compass heading |
| Orient β | −180–180° | Front-to-back tilt |
| Orient γ | −90–90° | Left-to-right tilt |
| Lid / Hinge | 0–360° | Foldable device hinge angle; falls back to screen orientation angle |
| Ambient Light | lux | Requires browser support and hardware sensor |

Orientation sensors on iOS require a permission prompt — selecting the sensor triggers it automatically.

---

## Shape bindings

Select a shape to open its Bindings table in the Inspector. Each row is one bindable property. Drag the slider in a row to connect the currently active oscillator and set the scale (effect strength). Double-click the slider to type an exact value.

| Property | Effect |
|---|---|
| `tx` / `ty` | Translate horizontally / vertically |
| `rotation` | Rotate around the shape's centroid |
| `scaleX` / `scaleY` | Scale around the centroid |
| `fillOpacity` | Fade the fill in and out |
| `strokeWidth` | Animate stroke thickness |
| `fillH/S/L` | Animate fill hue, saturation, or lightness |
| `strokeH/S/L` | Animate stroke hue, saturation, or lightness |

Select a point (click an anchor dot) to see per-point bindings: `x`, `y`, `handleIn.x/y`, `handleOut.x/y`.

---

## Shape appearance

Select a shape and use the **Appearance** section in the Inspector:

- **FILL / STROKE / BOTH** — which surfaces to draw
- Colour picker — base colour
- Fill opacity — base transparency
- Stroke width — base thickness in SVG units

Oscillator bindings add deltas on top of these base values.

**⬜ WIRE** mode shows every path as a 1 px screen-space line at any zoom level, ignoring fill and stroke settings.

**Multi-select** (Shift+click or rubber-band) shows a shared appearance panel so you can change fill colour, stroke colour, opacity, and stroke width across all selected shapes at once.

---

## Saving and exporting

| Action | How |
|---|---|
| Save to browser | Press **S**, or click **SAVE** in the toolbar |
| Load a save | LOAD ▾ → Recent |
| Export sketch file | EXPORT → Save Sketch (.osc) |
| Re-import sketch | Drag `.osc` onto the canvas, or IMPORT |
| Export static SVG | EXPORT → Static SVG |
| Export animated SVG | EXPORT → Animated SVG (SMIL) — LFO bindings only |
| Export PNG sequence / video | EXPORT → PNG Sequence / MP4… |

PNG and video export use JSZip from CDN and require an internet connection.

---

## Adding your own files

Drop files into the folders below — they appear in the LOAD dropdown automatically next time you open it:

```
svg-library/     .svg shape files
sketches/        .osc sketch files
```

---

## Known limitations

- AudioContext (Audio, Track modulators) requires HTTPS or localhost.
- PNG/video export requires an internet connection (JSZip CDN).
- Microphone access requires HTTPS or localhost.
- Audio buffers are not saved in `.osc` files — re-import audio each session.
- Ambient Light and Hinge sensors have limited hardware and browser support.
- Mirror slave paths share no bindings; geometry syncs from the master after binding is applied.

---

Built iteratively with [Claude Code](https://claude.ai/code) (Anthropic).
