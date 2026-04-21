# SVG Oscillator Editor — Architecture Reference

A Milian Mori–inspired SVG animation sketchbook: import an SVG, bind oscillators
to path properties (geometry, color, stroke, handles), scrub/play back, export.

Vanilla JS ES modules, no build step. Serve the directory and open `index.html`:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

All state lives in `main.js`. Rendering is driven by a single rAF loop.

---

## File map

```
index.html              Layout shell, toolbar, panels, motion-blur canvas, JSZip CDN
styles.css              Dark theme (near-black, monospace, no radius)
main.js                 App state, rAF loop, keyboard, import/export, rubber band
base.svg                Starter SVG loaded when no localStorage state exists

modules/
  PathModel.js          Point, BezierHandle, PathModel — every animated field
                        has a base* counterpart. HSL deltas (fillH/S/L).
  SVGParser.js          Parses 'd', normalises to absolute M/C/Z, arc → cubic.
                        Default fill='#ffffff', stroke='none', strokeWidth=0.05.
  CanvasViewport.js     viewBox pan/zoom + path render + HSL compute.
                        Exposes onBackgroundPointerDown/Move/Up for rubber band.
                        Wireframe strokes always 1px screen-space.
  PointOverlay.js       SVG overlay: visual dots/diamonds + fat invisible hit areas.
  OscillatorEngine.js   6 modulator types: lfo | step | randomwalk | audio |
                        expression | track. LFO curve-shaping, per-osc enabled flag.
  BindingSystem.js      resetToBase() + applyAll() — runs every frame.
  PathOperations.js     DragController, resample, split, mirror, cusp inference,
                        linked mirror clone.
  History.js            Full-state snapshots (paths + oscillators + bindings).
                        60-step stack, updates toolbar buttons.

panels/
  OscillatorPanel.js    Per-oscillator card with type-specific sliders, enable
                        toggle, inline rename, waveform/step preview.
  BindingPanel.js       Vertical matrix (params = rows, oscs = cols) of BoxSliders.
  PathInspector.js      Single-shape: appearance, point coords, operations.
                        Multi-shape UI lives in main.js (renderMultiSelectUI).

components/
  BoxSlider.js          Drag fill-in-rect slider; dblclick opens fixed-position
                        numeric input (works inside clipped containers).
```

---

## State shape (main.js)

```js
state = {
  paths:       Map<string, PathModel>,
  oscEngine:   OscillatorEngine,
  bindingSys:  BindingSystem,
  history:     History,

  selection: {
    pathId:          string | null,   // primary (bindings/inspector key)
    pathIds:         Set<string>,     // multi-select
    pointIds:        Set<string>,     // points on primary path
    highlightTarget: string | null,
  },

  playback: {
    playing:    boolean,
    globalTime: number,               // seconds
    bpm:        number,
  },

  ui: {
    wireframe:        boolean,
    snap:             boolean,
    gridSize:         number,
    motionBlurDecay:  number,         // 0 = off, ≤ 0.95
  },
};
```

---

## Data flow — one rAF frame

```
  oscEngine.tick(t, dt, bpm)            each osc → currentValue (0 if !enabled)
  bindingSys.resetToBase(paths)         animated fields ← base fields
  bindingSys.applyAll(paths, oscs)      model.prop += osc.currentValue × scale
  syncMirrorSlaves(paths)               slave paths mirror master (post-bind)
  viewport.render(paths, wireframe)     updates <path d>, fill/stroke, HSL
  overlay.render(paths, selection, z)   anchors, handles, hit circles
  renderMotionBlurFrame()               (if decay > 0) fade + copy SVG → canvas
```

---

## PathModel animatable properties

Every animated field has a `base*` counterpart. `resetToBase` copies base → live
before bindings apply, so oscillators can't accumulate drift across frames.

| Property       | Base          | Notes                                    |
|----------------|---------------|------------------------------------------|
| x, y           | baseX, baseY  | translate whole path                     |
| rotation       | baseRotation  | radians around centroid                  |
| scaleX, scaleY | baseScale*    | about centroid                           |
| skewX, skewY   | baseSkew*     | radians                                  |
| fillOpacity    | baseFillOp…   | 0–1 (requires non-'none' fill)           |
| strokeOpacity  | baseStrokeOp… | 0–1                                      |
| strokeWidth    | baseStrokeW…  | SVG units (1 = 1 user unit)              |
| fillH/S/L      | 0 (delta)     | added to stored hex fill at render       |
| strokeH/S/L    | 0 (delta)     | added to stored hex stroke at render     |

Per-point: `baseX/baseY`, plus `handleIn.baseX/baseY`, `handleOut.baseX/baseY`.

Defaults for a new/imported shape: `fill='#ffffff'`, `stroke='none'`,
`strokeWidth=0.05`. `fillOpacity` modulation is visible because fill is opaque
white by default.

---

## Oscillator types

Defined in `OscillatorEngine.MODULATOR_TYPES`:

| Type        | Output driver                               | Key params                         |
|-------------|---------------------------------------------|------------------------------------|
| lfo         | waveform(phase) × amp + offset, curve-shaped | waveform, frequency, amp, phase, offset, **curve** |
| step        | quantised beat-locked sequence              | stepCount, stepRate, stepValues[], stepAmp |
| randomwalk  | random walk + low-pass                      | rwRate, rwSmooth, rwMin, rwMax     |
| audio       | live mic FFT band                           | audioBand, audioSmooth, audioAmp   |
| expression  | `new Function('t','bpm', expr)`             | expression string                  |
| track       | decoded audio file FFT band                 | trackBand, trackSmooth, trackAmp   |

All oscillators have `enabled: bool`, `name: string`, `color: hex`. Engine
skips disabled ones (`currentValue = 0`).

**LFO curve shaping** — applied to the normalised output:
```
shaped = sign(norm) * |norm|^(1/curve)
curve = 1  → unchanged
curve > 1  → rounder peaks
curve < 1  → sharper peaks
```

**Track playback** — `loadTrack(arrayBuffer)` decodes file to an AudioBuffer.
`playTrack(offset)` creates a BufferSource + AnalyserNode on each start; the
buffer is re-used, the source is single-shot. Not serialised (re-import per
session).

---

## Navigation model (viewport)

| Input                         | Action                          |
|-------------------------------|---------------------------------|
| Wheel (no modifier)           | Two-finger / trackpad pan       |
| Wheel + Ctrl (pinch)          | Zoom at cursor                  |
| Space + drag                  | Pan                             |
| Drag on empty canvas          | Rubber-band select              |
| Drag on path/point/handle     | Drag that thing                 |
| Click path                    | Select (clears prior)           |
| Shift-click path              | Toggle in multi-selection       |
| Shift-click point             | Toggle in point multi-selection |

`CanvasViewport.spaceDown: boolean` — set by main.js keydown/keyup.
`CanvasViewport.onBackgroundPointerDown/Move/Up` — main.js wires rubber-band
creation/update/hit-test to these callbacks.

---

## Selection system

Primary identifier is `selection.pathId` (single "focused" path used by the
inspector and binding panel). `selection.pathIds: Set` carries the full
multi-selection.

Invariants:
- `pathIds` size 0: no selection.
- size 1: `pathId` equals the sole member.
- size > 1: `pathId` is the last-added member; inspector switches to the
  multi-select view (`renderMultiSelectUI` in main.js), showing the count,
  shared fill/stroke color pickers, and a "DEL ALL" button.

`PathInspector.render()` early-returns for multi-select — main.js owns that UI.

---

## Undo / redo

Snapshots are full-state JSON strings built by `snapshotAll()`:

```js
snapshotAll() = JSON.stringify(serializeFullState())
  → { paths: [...], oscillators: [...], bindings: [...], viewBox: {...} }
```

Undo/redo call `restoreFullState(JSON.parse(snapshot))`. Stack cap: 60.
Push points: after path edits, oscillator structural changes (add/remove/type),
binding edits, delete operations. Slider param changes inside oscillators push
history via their `onChange` callbacks.

This means undo restores oscillator frequency changes, binding tweaks, and
path geometry uniformly.

---

## File formats

### `.osc` (sketch)
JSON, extension `.osc` (or `.json` accepted on import):
```json
{
  "version":   "1.0",
  "type":      "svg-oscillator-sketch",
  "timestamp": "2026-04-21T...",
  "paths":         [ /* full PathModel data */ ],
  "oscillators":   [ /* full Oscillator params incl. enabled, curve, track* */ ],
  "bindings":      [ /* all bindings */ ],
  "viewBox":       { x, y, width, height }
}
```
Audio buffers are NOT serialised — the user re-imports audio each session.

### Export options
- **Static SVG** — current frame, flat serialisation
- **PNG sequence** — ZIP, frames named `frame-0000.png` … via JSZip
- **WebM** — MediaRecorder, VP9 → VP8 fallback
- **Save .osc** — sketch file above

### Import
File input accepts `.svg,.osc,.json`. `loadFile(file)` dispatches by extension:
SVG → `loadSVG(text)`; `.osc`/`.json` → `restoreFullState(JSON.parse(text))`.

### Startup
`loadStartupSVG()` fetches `./base.svg` if `localStorage['svg-osc-v1']` is
empty. Users can replace `base.svg` with their own starter.

---

## Coordinate system

All stored coordinates are SVG user units (the imported SVG's native space).
The viewport's `viewBox` + `panX/panY/zoom` map user units to screen pixels.

```
screenToSVG(clientX, clientY):
  x = (clientX - rect.left - panX) / zoom
  y = (clientY - rect.top  - panY) / zoom
```

`invZ = 1 / zoom` — used to scale overlay hit targets and wireframe strokes so
they stay a constant number of screen pixels regardless of zoom.

---

## Colour pipeline

`model.fill` / `model.stroke` are stored as hex strings (or `'none'`).
`model.fillH/S/L` are **deltas**, reset to 0 each frame, accumulated by
oscillator bindings on `fillH/S/L`. At render time:

```js
renderFill = applyHSLDelta(model.fill, model.fillH, model.fillS, model.fillL)
```

This means the colour picker always edits the base colour; oscillators modulate
on top without ever mutating the stored value. Same pattern for stroke.

Any CSS color coming in from the DOM (`rgb(...)`) is converted to hex by
`rgbToHex()` in PathInspector before being stored.

---

## Wireframe mode

`ui.wireframe = true` → viewport renders each path with:
- `fill = "none"`
- `stroke = model.stroke` (or `#888` if 'none')
- `stroke-width = invZ` — always **one screen pixel**, independent of zoom
  and of the path's actual `strokeWidth`.

This gives a zoom-stable technical-drawing look that's always legible.

---

## Motion blur

Opt-in via the BLUR slider (`ui.motionBlurDecay: 0…0.95`). When > 0:

1. `<canvas id="motion-blur-canvas">` is shown behind the SVG, sized by
   `ResizeObserver` to match.
2. Each frame, the canvas is first overdrawn with
   `rgba(bg, 1 - decay)` — this fades previous content.
3. The current SVG is serialised to a blob-URL and drawn into the canvas via
   `Image` + `drawImage`.
4. Higher decay → longer trails.

Performance: renders every other frame to keep rAF budget. Disable by dragging
the slider back to 0.

---

## Keyboard shortcuts

| Key                | Action                              |
|--------------------|-------------------------------------|
| Space              | Toggle play/stop (tap)              |
| Space (held)       | Temporary pan mode                  |
| H or F             | Fit view                            |
| Delete / Backspace | Delete selected points / shape(s)   |
| Shift + click      | Multi-select                        |
| Cmd/Ctrl + Z       | Undo                                |
| Cmd/Ctrl + Shift+Z | Redo                                |
| Cmd/Ctrl + Y       | Redo (alt)                          |

Space is intentionally dual-purpose — a quick tap toggles playback; a held
press enables pan. The keydown/keyup listeners distinguish via duration +
pointer state.

---

## Extending

### Add an animated path property
1. `PathModel`: `this.myProp = 0; this.baseMyProp = 0;`
2. `BindingSystem.PATH_PROPERTIES`: add `'myProp'`
3. `BindingSystem.resetToBase`: `model.myProp = model.baseMyProp;`
4. `CanvasViewport.render`: apply `myProp` in SVG output if it needs rendering
5. `serializePath` / restore helpers in `main.js`: add field

### Add a modulator type
1. `OscillatorEngine.MODULATOR_TYPES`: add the type string
2. `Oscillator` constructor: init per-type fields
3. `Oscillator._tickMyType(…)`: compute `this.currentValue`
4. `OscillatorEngine.tick` switch: add case
5. `OscillatorPanel`: `_buildMyType(osc, body, sliders)` + `TYPE_LABELS` entry
6. `serializeFullState` / `restoreFullState`: include the new params

### Add a keyboard shortcut
`main.js` → `document.addEventListener('keydown', ...)` block. Guard against
editable elements: `if (e.target.matches('input, textarea, [contenteditable]')) return;`

---

## Gotchas

- **`model.fill` must be hex** (or `'none'`) for HSL delta math. Never store
  `rgb(...)` directly — convert in the inspector first.
- **JSZip is a CDN script** — PNG export fails offline.
- **MediaRecorder codec support varies** — VP9 preferred, VP8 fallback.
- **Mic oscillator needs HTTPS** (or localhost) — browser security.
- **Audio buffers are not saved** in `.osc` files — re-import per session.
- **Point IDs persist through undo** — `selection.pointIds` remains valid
  after restoreFullState.
- **Mirror slaves share no bindings** — they sync geometry from master post-bind.
- **Wireframe ignores `strokeWidth`** by design — always 1px screen-space.
- **Default fill is `#ffffff`, not `'none'`** — change this carefully, it
  affects whether `fillOpacity` modulation is visible.
- **Two-finger pan uses `wheel` without `ctrlKey`** — trackpads synthesise
  ctrlKey for pinch. Some mice will trigger pan on a vertical wheel.

---

## Testing checklist

### BindingSystem changes
- Play animation — paths animate, no drift after stop
- HSL binding: bind `fillH` to LFO → colour cycles
- Stop → shapes return to their base position/color

### CanvasViewport changes
- Pan: space-drag, two-finger scroll
- Zoom: pinch / ctrl+wheel
- Fit view (H) centres content
- Wireframe stays 1px at any zoom
- Path `d` updates every frame (no stale compositor cache)

### Selection / rubber band
- Drag empty canvas → rect appears, paths inside become selected
- Shift-click path: toggles in multi-selection
- Click path in empty space: clears other selection
- Multi-select inspector shows count + shared color pickers
- DEL ALL button removes every selected path

### Oscillator / binding
- Enable toggle: disabled osc contributes 0 to bindings
- Rename (dblclick): new name appears in binding panel header
- LFO curve slider: preview reshapes; playback matches
- Track: load audio → play → bound property reacts to beat

### Import / Export
- Import SVG: paths appear, cusp corners preserved (no round-off of sharp
  corners during inference)
- Export Static SVG: file downloads and opens in browser
- Save `.osc` → clear localStorage → Load `.osc` → full state restored
  (oscillators, bindings, HSL, track metadata)
- PNG sequence: ZIP opens, frame count matches duration
- WebM: produces playable video

### Undo / redo
- Change LFO frequency → undo → frequency restored
- Add path → undo → path removed
- Edit binding scale → undo → scale restored
- Mix path + oscillator + binding edits → repeated undo unwinds all

### Motion blur
- Slider at 0 → canvas hidden, no overhead
- Slider at 0.3 → visible smear during playback
- Slider at 0 again → canvas cleared
