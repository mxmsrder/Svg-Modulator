// PointOverlay.js — Renders anchor points and bezier handles
// Visual elements: small outlined circles (anchors) and diamonds (handles)
// Hit targets: large invisible circles/diamonds for easy grabbing
// Highlight support: highlighted points/handles get white fill

const NS   = 'http://www.w3.org/2000/svg';
const COL  = 'rgba(255,255,255,0.6)';
const SEL  = '#6c63ff';
const HL   = '#ffffff';   // highlight fill (from matrix click)
const SW   = 1.5;

const A_R  = 4.5;   // anchor visual radius (screen px)
const H_S  = 3.5;   // handle diamond visual half-size (screen px)
const HIT_R = 14;   // anchor hit radius (screen px) — bigger than visual
const HIT_H = 12;   // handle hit half-size (screen px)

export class PointOverlay {
  constructor(overlayGroup, interactionGroup) {
    this.overlay     = overlayGroup;
    this.interaction = interactionGroup;
    this.showAnchors = true;
    this.showHandles = true;
    // highlightTarget: { pathId, pointIndex, handleRole, property } or null
    this.highlightTarget = null;
    this._els = new Map(); // key → SVG element
  }

  render(paths, selection, zoom) {
    if (!this.showAnchors && !this.showHandles) {
      this._clearAll();
      return;
    }

    const used = new Set();
    const iz   = 1 / zoom;
    const ar   = A_R  * iz;
    const hs   = H_S  * iz;
    const sw   = SW   * iz;
    const hr   = HIT_R * iz;
    const hh   = HIT_H * iz;

    for (const [pathId, model] of paths) {
      if (!model.visible || !model.selected) continue;

      model.points.forEach((pt, ptIdx) => {
        const isHlAnchor = this._isHighlighted(pathId, ptIdx, null);
        const isHlIn     = this._isHighlighted(pathId, ptIdx, 'in');
        const isHlOut    = this._isHighlighted(pathId, ptIdx, 'out');

        if (this.showHandles) {
          if (pt.handleIn)  this._renderHandle(pathId, ptIdx, 'in',  pt.handleIn,  pt, hs, sw, hh, isHlIn,  used);
          if (pt.handleOut) this._renderHandle(pathId, ptIdx, 'out', pt.handleOut, pt, hs, sw, hh, isHlOut, used);
        }
        if (this.showAnchors) {
          this._renderAnchor(pathId, ptIdx, pt, ar, sw, hr, selection, isHlAnchor, used);
        }
      });
    }

    // Remove unused
    for (const [key, el] of this._els) {
      if (!used.has(key)) { el.remove(); this._els.delete(key); }
    }
  }

  // ── Private ───────────────────────────────────────

  _isHighlighted(pathId, ptIdx, handleRole) {
    const ht = this.highlightTarget;
    if (!ht) return false;
    if (ht.pathId !== pathId) return false;
    if (ht.pointIndex !== ptIdx) return false;
    if (handleRole === null) {
      return ht.handleRole === null || ht.handleRole === undefined;
    }
    return ht.handleRole === handleRole;
  }

  _renderHandle(pathId, ptIdx, role, handle, anchor, hs, sw, hh, highlight, used) {
    // Tangent line
    const lineKey = `${pathId}:${ptIdx}:line-${role}`;
    used.add(lineKey);
    let line = this._els.get(lineKey);
    if (!line) {
      line = makeEl('line', { class: 'handle-line', 'pointer-events': 'none' }, this.overlay);
      this._els.set(lineKey, line);
    }
    setAttr(line, {
      x1: anchor.x, y1: anchor.y,
      x2: handle.x, y2: handle.y,
      'stroke-width': sw * 0.8,
    });

    // Visual diamond (overlay, no pointer events)
    const dotKey = `${pathId}:${ptIdx}:hdot-${role}`;
    used.add(dotKey);
    let diamond = this._els.get(dotKey);
    if (!diamond) {
      diamond = makeEl('path', {
        class: 'handle-pt',
        'pointer-events': 'none',
      }, this.overlay);
      this._els.set(dotKey, diamond);
    }
    const { x, y } = handle;
    diamond.setAttribute('d', `M ${x},${y-hs} L ${x+hs},${y} L ${x},${y+hs} L ${x-hs},${y} Z`);
    diamond.setAttribute('stroke-width', sw);
    if (highlight) {
      diamond.setAttribute('fill', HL);
      diamond.setAttribute('stroke', HL);
    } else {
      diamond.setAttribute('fill', 'none');
      diamond.setAttribute('stroke', COL);
    }

    // Large invisible hit diamond (interaction group)
    const hitKey = `${pathId}:${ptIdx}:hhit-${role}`;
    used.add(hitKey);
    let hitDiamond = this._els.get(hitKey);
    if (!hitDiamond) {
      hitDiamond = makeEl('path', {
        class:              'handle-hit',
        fill:               'transparent',
        stroke:             'transparent',
        'pointer-events':   'all',
        'data-role':        'handle',
        'data-path-id':     pathId,
        'data-pt-idx':      ptIdx,
        'data-handle-role': role,
      }, this.interaction);
      this._els.set(hitKey, hitDiamond);
    }
    hitDiamond.setAttribute('d', `M ${x},${y-hh} L ${x+hh},${y} L ${x},${y+hh} L ${x-hh},${y} Z`);
    hitDiamond.setAttribute('stroke-width', sw * 2);
  }

  _renderAnchor(pathId, ptIdx, pt, ar, sw, hr, selection, highlight, used) {
    // Visual circle (overlay, no pointer events)
    const visKey = `${pathId}:${ptIdx}:avis`;
    used.add(visKey);
    let visCircle = this._els.get(visKey);
    if (!visCircle) {
      visCircle = makeEl('circle', {
        class: 'anchor-pt',
        'pointer-events': 'none',
      }, this.overlay);
      this._els.set(visKey, visCircle);
    }
    const isSelected = selection.pointIds.has(pt.id);
    setAttr(visCircle, {
      cx: pt.x, cy: pt.y,
      r:  isSelected ? ar * 1.3 : ar,
      'stroke':       highlight ? HL : (isSelected ? SEL : COL),
      'stroke-width': sw,
      'fill':         highlight ? HL : 'none',
    });

    // Large invisible hit circle (interaction group)
    const hitKey = `${pathId}:${ptIdx}:ahit`;
    used.add(hitKey);
    let hitCircle = this._els.get(hitKey);
    if (!hitCircle) {
      hitCircle = makeEl('circle', {
        fill:             'transparent',
        stroke:           'transparent',
        'pointer-events': 'all',
        'data-role':      'anchor',
        'data-path-id':   pathId,
        'data-pt-idx':    ptIdx,
      }, this.interaction);
      this._els.set(hitKey, hitCircle);
    }
    setAttr(hitCircle, { cx: pt.x, cy: pt.y, r: hr });
  }

  _clearAll() {
    this.overlay.innerHTML     = '';
    this.interaction.innerHTML = '';
    this._els.clear();
  }
}

// ── Helpers ───────────────────────────────────────────
function makeEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function setAttr(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}
