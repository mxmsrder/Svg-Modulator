# SVG Oscillator Editor — Architecture Reference

## Quick orientation
Vanilla JS ES modules, no build step. Serve with `python3 -m http.server 8000`.
All state lives in `main.js`. Rendering happens every rAF frame.

---

## File map

```
index.html              Layout shell, JSZip CDN
styles.css              Dark theme (Milian-Mori aesthetic — near-black, monospace, no radius)
main.js                 Bootstrap, app state, rAF loop, keyboard shortcuts, exports

modules/
  PathModel.js          Point, BezierHandle, PathModel classes — ALL animated fields have base* counterpart
  SVGParser.js          Tokenises SVG 'd', normalises all commands to absolute M/C/Z. Arc → cubic.
  CanvasViewport.js     viewBox pan/zoom, path rendering + hit targets, HSL delta computation
  PointOverlay.js       SVG overlay: visual circles/diamonds + large invisible hit areas (3×)
  OscillatorEngine.js   5 modulator types: lfo, step, randomwalk, audio, expression
  BindingSystem.js      resetToBase() + applyAll() per rAF frame
  PathOperations.js     DragController (shift=multiselect), resample, split, mirror, cusp detect
  History.js            60-step undo/redo stack, updates toolbar buttons

panels/
  OscillatorPanel.js    Left panel: per-type modulator cards with BoxSliders
  BindingPanel.js       Right panel: vertical matrix (params=rows, oscs=cols), highlights selected point
  PathInspector.js      Right panel: point coords, appearance, operations, delete shape

components/
  BoxSlider.js          Draggable fill-in-rect slider; dblclick opens fixed-positioned number input
```

---

## Data flow (one rAF frame)

```
oscEngine.tick(t, dt, bpm)          each oscillator → currentValue
bindingSys.resetToBase(paths)       animated fields ← base fields
bindingSys.applyAll(paths, oscs)    model.prop += osc.currentValue × binding.scale
syncMirrorSlaves(paths)             slave path mirrors master (after bindings)
viewport.render(paths, wireframe)   updates SVG <path d="..."> + HSL color compute
overlay.render(paths, selection, z) anchors + handles + hit circles
```

## Key design decisions

### viewBox not group transforms
`CanvasViewport` sets `svg.setAttribute('viewBox', ...)` instead of a `<g transform>`.
Group transforms create compositor layers — browser won't repaint path `d` changes.
viewBox forces a full repaint every frame, guaranteeing animation is visible.

### base* fields prevent drift
Every animatable field (x, y, strokeWidth, fillH, …) has a `base*` counterpart.
`resetToBase` runs BEFORE `applyAll` each frame, so oscillators can't accumulate drift.

### HSL deltas (fillH, fillS, fillL)
`model.fillH/S/L` are animated deltas (reset to 0 each frame) applied on TOP of the
stored `model.fill` hex color at render time. This means the color picker always sets
the base color; oscillators modulate it. Same pattern for stroke.

### Point types
- `smooth`    — in/out handles collinear, independent lengths
- `symmetric` — in/out handles collinear, equal lengths (auto-mirrors)
- `cusp`      — handles move independently (hard corner preserved)
After SVG import, `inferPointTypes()` checks handle angles: if dot product of normalised
in/out vectors > −0.985 (i.e. NOT anti-parallel) → cusp. Otherwise smooth/symmetric.

### Hit targets
`CanvasViewport` renders invisible wide-stroke `<path>` overlays (10px) for path click.
`PointOverlay` renders invisible circles r=14px and diamonds hh=12px for point/handle
grab. Visual elements are much smaller (r=4, hh=3.2) — scaled by 1/zoom.

### Coordinate space
All coordinates are in SVG user units (the original imported SVG space).
`viewport.screenToSVG(clientX, clientY)` converts screen → SVG units via:
  `x = (clientX - rect.left - panX) / zoom`

---

## Adding a new animatable path property

1. Add to `PathModel`: `this.myProp = 0; this.baseMyProp = 0;`
2. Add to `BindingSystem.PATH_PROPERTIES`: `'myProp'`
3. Add to `BindingSystem.resetToBase`: `model.myProp = model.baseMyProp;`
4. Handle in `CanvasViewport.render` if it needs special rendering logic (like HSL)
5. Add to `serializePath`/`restoreSnapshot` in `main.js` if persistence needed

## Adding a new modulator type

1. Add type string to `OscillatorEngine.MODULATOR_TYPES`
2. Add tick method `_tickMyType(dt, globalTime, bpm)` on `Oscillator` class
3. Add case to `OscillatorEngine.tick()` switch
4. Add panel builder `_buildMyType(osc, body, sliders)` in `OscillatorPanel`
5. Add `TYPE_LABELS` entry in `OscillatorPanel`

---

## Keyboard shortcuts

| Key              | Action                        |
|------------------|-------------------------------|
| Space            | Toggle play/stop              |
| H or F           | Fit view                      |
| Delete/Backspace | Delete selected pts or shape  |
| Shift+click pt   | Multi-select points           |
| Cmd/Ctrl+Z       | Undo                          |
| Cmd/Ctrl+Shift+Z | Redo                          |
| Cmd/Ctrl+Y       | Redo                          |

---

## Testing checklist

### After any change to BindingSystem
- [ ] Play animation — paths animate, no drift after stop
- [ ] HSL binding: bind fillH to LFO, verify color cycles on play
- [ ] Stop → resetToBase → shape returns to original position/color

### After any change to CanvasViewport
- [ ] Pan and zoom work (scroll wheel, drag)
- [ ] Fit view centers content
- [ ] Path `d` updates visible each frame (no stale compositor cache)

### After any change to PointOverlay / PathOperations
- [ ] Click anchor: selects point, inspector shows coords
- [ ] Shift+click: adds to selection (point fills white)
- [ ] Drag anchor: moves point + handles together
- [ ] Drag handle on cusp point: only THAT handle moves
- [ ] Drag handle on smooth point: opposite handle mirrors direction
- [ ] Delete key with point selected: removes point
- [ ] Delete key with no point (just path): removes path

### After any change to BoxSlider
- [ ] Drag left/right: value changes
- [ ] Click: sets value at click position
- [ ] Dblclick: shows fixed-position number input, type + Enter commits
- [ ] Works inside binding matrix cells (no overflow clipping)

### Import / Export
- [ ] Import SVG: paths appear, cusp corners preserved
- [ ] Export Static SVG: downloads file, opens in browser
- [ ] Save (localStorage) then reload page then Load: restores full state
- [ ] PNG sequence: produces ZIP with correctly named frames
- [ ] WebM: produces valid video file

---

## Gotchas / known issues

- `model.fill` must be a hex string (or 'none') for HSL computation to work.
  CSS colors like `rgb(...)` go through `rgbToHex()` in PathInspector before storing.
- JSZip loads from CDN — PNG export fails offline (check console).
- MediaRecorder codec support varies: VP9 preferred, falls back to VP8/webm.
- Point IDs are monotonically increasing (`uid('pt')`). After undo/restore, IDs stay
  consistent (preserved in snapshot JSON), so selection.pointIds remain valid.
- Mirror slaves share no bindings — bindings on master propagate via geometry sync.
- Audio modulator requires HTTPS in most browsers (microphone permission).
