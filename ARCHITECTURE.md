# Architecture Reference

Technical reference for the SVG Oscillator Editor codebase. For a user-facing guide see [README.md](README.md).

---

## Stack

Vanilla JavaScript ES modules. No build step, no framework, no bundler. Served by any static HTTP server. The only external dependency is JSZip (CDN, used only for PNG sequence export).

---

## Entry point

| File | Role |
|---|---|
| `index.html` | Shell — toolbar, panels, export dialog, SVG canvas elements |
| `styles.css` | Dark theme (near-black background, monospace font) |
| `main.js` | App bootstrap — state, rAF loop, keyboard shortcuts, import/export, LOAD dropdown, rubber-band selection |

---

## Module map

```
modules/
  PathModel.js          Point, BezierHandle, PathModel
                        Every animated field has a base* counterpart (e.g. tx / baseTx)
  SVGParser.js          Parse SVG 'd', normalise to M/C/Z, convert arcs to cubics
  CanvasViewport.js     viewBox pan/zoom, path render, HSL colour compositing
  PointOverlay.js       Anchor + handle visuals and hit targets
  OscillatorEngine.js   8 modulator types — tick() dispatches to type-specific methods
  BindingSystem.js      resetToBase() + applyAll() run every frame
  PathOperations.js     DragController, resample, split, mirror
  History.js            Full-state 60-step undo/redo ring buffer

panels/
  OscillatorPanel.js    Modulator cards, waveform preview, envelope canvas editor,
                        track spectrum visualizer, device live readout
  BindingPanel.js       Binding matrix with BoxSlider rows
  PathInspector.js      Single-path and multi-path inspector

components/
  BoxSlider.js          Drag fill-in-rect slider; double-click to type any value
```

---

## Data flow

```
rAF tick()
  ├─ oscEngine.tick(globalTime, dt, bpm)   → updates osc.currentValue for each oscillator
  ├─ bindingSys.resetToBase(paths)         → copies base* → live fields on every PathModel
  ├─ bindingSys.applyAll(paths, oscs)      → adds (osc.currentValue × binding.scale) to live fields
  ├─ syncMirrorSlaves(paths)               → copies geometry from mirror master to slave
  ├─ viewport.render(paths, wireframe)     → builds SVG path strings, sets fill/stroke/transform
  └─ overlay.render(paths, selection, z)  → draws anchor + handle dots
```

When playback is stopped, device oscillators are still ticked every frame so their live display stays current.

---

## State structure

```js
state = {
  paths:     Map<id, PathModel>,
  selection: {
    pathId:          string | null,   // primary selected path
    pathIds:         Set<string>,     // all selected paths
    pointIds:        Set<string>,     // selected points (single path context)
    highlightTarget: object | null,
  },
  playback: {
    playing:    boolean,
    bpm:        number,
    globalTime: number,   // seconds, accumulates while playing
  },
  ui: {
    showAnchors:   boolean,
    showHandles:   boolean,
    showWireframe: boolean,
  },
}
```

---

## PathModel

Every path property that can be animated has two fields:

```js
m.tx     // current animated value  — written by BindingSystem.applyAll()
m.baseTx // base (static) value     — written by BindingSystem.resetToBase()
```

`resetToBase()` runs first each frame to copy `base*` → live, then `applyAll()` adds oscillator deltas.

Animated properties: `tx`, `ty`, `rotation`, `scaleX`, `scaleY`, `fillOpacity`, `strokeWidth`, `fillH`, `fillS`, `fillL`, `strokeH`, `strokeS`, `strokeL`.

Per-point properties: `x`, `y`, `handleIn.x`, `handleIn.y`, `handleOut.x`, `handleOut.y`.

---

## OscillatorEngine

```js
class OscillatorEngine {
  oscillators: Map<id, Oscillator>
  tick(globalTime, dt, bpm)   // called every rAF frame when playing
  add(params)                 // create and register a new oscillator
}
```

`tick()` iterates all oscillators. For each enabled one it calls the type-specific tick method:

| Type | Method | Key params |
|---|---|---|
| lfo | `_tickLFO(dt)` | waveform, frequency, amplitude, phase, offset, curve |
| step | `_tickStep(dt, bpm)` | stepCount, stepRate, stepValues, stepAmp |
| randomwalk | `_tickWalk(dt)` | rwRate, rwSmooth, rwMin, rwMax |
| audio | `_tickAudio(dt)` | audioBand, audioSmooth, audioAmplitude |
| expression | `_tickExpr(t, bpm)` | expression (JS string, vars: t, bpm) |
| track | `_tickTrack(dt)` | trackBand, trackSmooth, trackAmplitude |
| envelope | `_tickEnvelope(t)` | envPoints, envPeriod, envAmplitude, envSmooth, envLoop |
| device | `_tickDevice(dt)` | deviceSensor, deviceScale, deviceSmooth |

`osc.currentValue` is the output. `BindingSystem.applyAll()` multiplies it by `binding.scale` and adds it to the target property.

### LFO curve shaping

When `curve ≠ 1`, the normalised wave value is shaped by `sign(v) * |v|^(1/curve)` before amplitude scaling. Values > 1 round the peaks; values < 1 sharpen them.

### Device sensors

`_deviceRaw` is the natural-unit reading. It feeds a one-pole low-pass filter (coefficient = `deviceSmooth`) to produce `_deviceLevel`. `currentValue = _deviceLevel * deviceScale`.

The live display in the panel shows `_deviceLevel` (before scaling).

If a sensor is unavailable, `_deviceStatus` is set to a human-readable string (e.g. `'Not supported'`, `'Permission denied'`) and shown in the readout div instead.

---

## BindingSystem

```js
class BindingSystem {
  bindings: Map<id, Binding>
  add(oscillatorId, target, scale)
  resetToBase(paths)    // copy base* → live for all paths
  applyAll(paths, oscs) // for each binding: path[prop] += osc.currentValue * scale
}
```

`target` is `{ pathId, property, pointIndex }`. `pointIndex` is `null` for path-level properties and an integer for per-point properties.

---

## History

Full-state snapshots (paths + oscillators + bindings serialised to JSON) stored in a 60-step ring buffer. `pushHistory()` captures before any structural change. Undo/redo call `restoreFullState()` to replay.

---

## CanvasViewport

Manages the SVG `viewBox` for pan/zoom. Renders path geometry and HSL colour each frame.

- Pan: `viewport.panX / panY` offset in screen pixels
- Zoom: `viewport.zoom` (1 = 100%)
- `screenToSVG(x, y)` — convert pointer coordinates to SVG content space
- `spaceDown` flag: set by `main.js` when Alt/Option is held; switches pointerdown to pan instead of rubber-band

Wireframe mode: stroke is always `1 / zoom` wide (= 1 screen pixel) regardless of the model's `strokeWidth`.

---

## Rubber-band selection

`viewport.onBackgroundPointerDown/Move/Up` hooks are called by `CanvasViewport` when a pointerdown lands on the SVG background (not on a `[data-role]` element). `main.js` draws an SVG `<rect class="rubber-band">` in the interaction group and tests each path's bounding box on pointerup.

---

## Dynamic folder loading

`fetchFolderFiles(folderPath, ext)` fetches the directory URL, parses the HTML directory listing returned by Python `http.server` / nginx / Apache autoindex, extracts `<a href>` links, and returns `{ name, file }` objects for all matching files. Called each time the LOAD dropdown opens — no manifest file needed.

---

## Serialisation format (.osc / .json)

```json
{
  "version": "1.1",
  "type": "svg-oscillator-sketch",
  "timestamp": "...",
  "paths": [...],
  "oscillators": [...],
  "bindings": [...],
  "viewBox": { "x": 0, "y": 0, "w": 500, "h": 500 }
}
```

Audio buffers are not serialised — re-import audio each session.

---

## File library

```
svg-library/     .svg shape files   — appear in LOAD → Shapes
sketches/        .osc sketch files  — appear in LOAD → Sketches
library.json     (legacy manifest, superseded by dynamic scanning)
```

Drop a file in a folder and it appears in the dropdown the next time it is opened.
