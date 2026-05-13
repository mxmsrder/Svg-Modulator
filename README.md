# SVG Modulator

A browser-based animation sketchbook. Import SVG shapes, connect oscillators to their geometry and colour, and watch them animate in real time — no installation needed.

---

## Quick start

Open `index.html` in a browser, or run a local server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

1. A set of base shapes loads automatically on first visit.
2. Click a shape to select it.
3. In the left panel, click **+ ADD** to create an oscillator.
4. In the right panel (Inspector), drag the slider next to a property (e.g. `tx`) to connect the oscillator and set its strength.
5. Press **▶ PLAY** or **Space** to animate.
6. Press **S** to save to the browser.

---

## Navigation

| Action | Input |
|---|---|
| Pan canvas | Hold **Alt/Option** + drag |
| Pan (trackpad / touch) | Two-finger scroll |
| Zoom | **Ctrl + scroll** or pinch |
| Fit view | **H** or **F** |
| Select shape | Click it |
| Multi-select | **Shift + click** or drag on empty area |
| Toggle play/stop | **Space** |
| Save | **S** |
| Undo / Redo | **Cmd/Ctrl + Z** / **Cmd/Ctrl + Shift + Z** |
| Delete selected | **Delete** / **Backspace** |

On iOS, selecting the **Device** oscillator's orientation sensor triggers an automatic permission prompt.

---

## Points and handles

Enable **● PTS** in the toolbar to show a shape's anchor points and Bézier handles. Click an anchor dot to select it — the Inspector then shows per-point bindings (`x`, `y`, `handleIn`, `handleOut`) so you can connect oscillators directly to individual points for organic, morphing animation.
