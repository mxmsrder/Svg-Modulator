// PointOverlay.js — Renders anchor points and bezier handles
// Anchors: circle outlines (60% white)
// Handles: 45° diamond outlines (60% white)
// All sizes are fixed in screen pixels (scaled by 1/zoom)

const NS   = 'http://www.w3.org/2000/svg';
const COL  = 'rgba(255,255,255,0.6)';   // 60% white
const SEL  = '#6c63ff';                  // accent for selected anchor
const SW   = 1.5;                        // stroke-width in screen px

// Anchor radius and handle half-size in screen pixels (capped)
const A_R  = 4.5;   // anchor circle radius (px)
const H_S  = 3.5;   // handle diamond half-size (px)

export class PointOverlay {
  constructor(overlayGroup, interactionGroup) {
    this.overlay     = overlayGroup;
    this.interaction = interactionGroup;
    this.showAnchors = true;
    this.showHandles = true;
    this._els = new Map();
  }

  render(paths, selection, zoom) {
    if (!this.showAnchors && !this.showHandles) {
      this._clearAll();
      return;
    }

    const used  = new Set();
    const iz    = 1 / zoom;    // 1 SVG unit = this many screen px → invert
    const ar    = A_R * iz;    // anchor radius in SVG units
    const hs    = H_S * iz;    // handle diamond half-size in SVG units
    const sw    = SW  * iz;    // stroke-width in SVG units

    for (const [pathId, model] of paths) {
      if (!model.visible || !model.selected) continue;

      model.points.forEach((pt, ptIdx) => {
        if (this.showHandles) {
          if (pt.handleIn)  this._renderHandle(pathId, ptIdx, 'in',  pt.handleIn,  pt, hs, sw, used);
          if (pt.handleOut) this._renderHandle(pathId, ptIdx, 'out', pt.handleOut, pt, hs, sw, used);
        }
        if (this.showAnchors) {
          this._renderAnchor(pathId, ptIdx, pt, ar, sw, selection, used);
        }
      });
    }

    // Remove unused elements
    for (const [key, el] of this._els) {
      if (!used.has(key)) { el.remove(); this._els.delete(key); }
    }
  }

  _renderHandle(pathId, ptIdx, role, handle, anchor, hs, sw, used) {
    // Tangent line: anchor → handle
    const lineKey = `${pathId}:${ptIdx}:line-${role}`;
    used.add(lineKey);
    let line = this._els.get(lineKey);
    if (!line) {
      line = makeEl('line', { class: 'handle-line' }, this.overlay);
      this._els.set(lineKey, line);
    }
    setAttr(line, { x1: anchor.x, y1: anchor.y, x2: handle.x, y2: handle.y,
                    'stroke-width': sw * 0.8 });

    // Diamond shape at handle position
    const dotKey = `${pathId}:${ptIdx}:hdot-${role}`;
    used.add(dotKey);
    let diamond = this._els.get(dotKey);
    if (!diamond) {
      diamond = makeEl('path', {
        class:              'handle-pt',
        'data-role':        'handle',
        'data-path-id':     pathId,
        'data-pt-idx':      ptIdx,
        'data-handle-role': role,
      }, this.interaction);
      this._els.set(dotKey, diamond);
    }
    const { x, y } = handle;
    diamond.setAttribute('d',
      `M ${x},${y-hs} L ${x+hs},${y} L ${x},${y+hs} L ${x-hs},${y} Z`);
    diamond.setAttribute('stroke-width', sw);
  }

  _renderAnchor(pathId, ptIdx, pt, ar, sw, selection, used) {
    const key = `${pathId}:${ptIdx}:anchor`;
    used.add(key);
    let circle = this._els.get(key);
    if (!circle) {
      circle = makeEl('circle', {
        class:          'anchor-pt',
        'data-role':    'anchor',
        'data-path-id': pathId,
        'data-pt-idx':  ptIdx,
      }, this.interaction);
      this._els.set(key, circle);
    }

    const isSelected = selection.pointIds.has(pt.id);
    setAttr(circle, {
      cx:             pt.x,
      cy:             pt.y,
      r:              isSelected ? ar * 1.3 : ar,
      'stroke':       isSelected ? SEL : COL,
      'stroke-width': sw,
    });
  }

  _clearAll() {
    this.overlay.innerHTML     = '';
    this.interaction.innerHTML = '';
    this._els.clear();
  }
}

// ────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────
function makeEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function setAttr(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}
