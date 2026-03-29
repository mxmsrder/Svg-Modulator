// PointOverlay.js — Renders anchor points and bezier handles
// Selected anchors: filled white. Highlighted (matrix hover): filled white.
// Large invisible hit areas for easy grabbing.

const NS   = 'http://www.w3.org/2000/svg';
const COL  = 'rgba(255,255,255,0.55)';
const SEL_FILL = '#ffffff';
const HL_FILL  = '#ffffff';
const SW   = 1.2;

const A_R  = 4;    // visual anchor radius (screen px)
const H_S  = 3.2;  // visual handle half-size (screen px)
const HIT_R = 14;  // anchor hit radius (screen px)
const HIT_H = 12;  // handle hit half-size (screen px)

export class PointOverlay {
  constructor(overlayGroup, interactionGroup) {
    this.overlay     = overlayGroup;
    this.interaction = interactionGroup;
    this.showAnchors = true;
    this.showHandles = true;
    this.highlightTarget = null;
    this._els = new Map();
  }

  render(paths, selection, zoom) {
    if (!this.showAnchors && !this.showHandles) { this._clearAll(); return; }

    const used = new Set();
    const iz   = 1 / zoom;
    const ar   = A_R   * iz;
    const hs   = H_S   * iz;
    const sw   = SW    * iz;
    const hr   = HIT_R * iz;
    const hh   = HIT_H * iz;

    for (const [pathId, model] of paths) {
      if (!model.visible || !model.selected) continue;

      model.points.forEach((pt, ptIdx) => {
        const isSelAnchor = selection.pointIds.has(pt.id);
        const isHlAnchor  = this._isHighlighted(pathId, ptIdx, null);
        const isHlIn      = this._isHighlighted(pathId, ptIdx, 'in');
        const isHlOut     = this._isHighlighted(pathId, ptIdx, 'out');

        if (this.showHandles) {
          if (pt.handleIn)  this._renderHandle(pathId, ptIdx, 'in',  pt.handleIn,  pt, hs, sw, hh, isHlIn,  used);
          if (pt.handleOut) this._renderHandle(pathId, ptIdx, 'out', pt.handleOut, pt, hs, sw, hh, isHlOut, used);
        }
        if (this.showAnchors) {
          this._renderAnchor(pathId, ptIdx, pt, ar, sw, hr, isSelAnchor, isHlAnchor, used);
        }
      });
    }

    for (const [key, el] of this._els) {
      if (!used.has(key)) { el.remove(); this._els.delete(key); }
    }
  }

  _isHighlighted(pathId, ptIdx, handleRole) {
    const ht = this.highlightTarget;
    if (!ht || ht.pathId !== pathId || ht.pointIndex !== ptIdx) return false;
    if (handleRole === null) return !ht.handleRole;
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
    setAttr(line, { x1: anchor.x, y1: anchor.y, x2: handle.x, y2: handle.y, 'stroke-width': sw * 0.7 });

    // Visual diamond
    const dotKey = `${pathId}:${ptIdx}:hdot-${role}`;
    used.add(dotKey);
    let diamond = this._els.get(dotKey);
    if (!diamond) {
      diamond = makeEl('path', { class: 'handle-pt', 'pointer-events': 'none' }, this.overlay);
      this._els.set(dotKey, diamond);
    }
    const { x, y } = handle;
    diamond.setAttribute('d', `M ${x},${y-hs} L ${x+hs},${y} L ${x},${y+hs} L ${x-hs},${y} Z`);
    diamond.setAttribute('stroke-width', sw);
    diamond.setAttribute('fill',   highlight ? HL_FILL : 'none');
    diamond.setAttribute('stroke', highlight ? HL_FILL : COL);

    // Large invisible hit diamond
    const hitKey = `${pathId}:${ptIdx}:hhit-${role}`;
    used.add(hitKey);
    let hitDiamond = this._els.get(hitKey);
    if (!hitDiamond) {
      hitDiamond = makeEl('path', {
        fill: 'transparent', stroke: 'transparent', 'pointer-events': 'all',
        'data-role': 'handle', 'data-path-id': pathId,
        'data-pt-idx': ptIdx, 'data-handle-role': role,
      }, this.interaction);
      this._els.set(hitKey, hitDiamond);
    }
    hitDiamond.setAttribute('d', `M ${x},${y-hh} L ${x+hh},${y} L ${x},${y+hh} L ${x-hh},${y} Z`);
    hitDiamond.setAttribute('stroke-width', sw * 2);
  }

  _renderAnchor(pathId, ptIdx, pt, ar, sw, hr, isSelected, isHighlighted, used) {
    // Visual circle
    const visKey = `${pathId}:${ptIdx}:avis`;
    used.add(visKey);
    let vis = this._els.get(visKey);
    if (!vis) {
      vis = makeEl('circle', { class: 'anchor-pt', 'pointer-events': 'none' }, this.overlay);
      this._els.set(visKey, vis);
    }
    const filled = isSelected || isHighlighted;
    setAttr(vis, {
      cx: pt.x, cy: pt.y,
      r:  isSelected ? ar * 1.4 : ar,
      stroke: COL,
      'stroke-width': sw,
      fill: filled ? SEL_FILL : 'none',
    });

    // Large invisible hit circle
    const hitKey = `${pathId}:${ptIdx}:ahit`;
    used.add(hitKey);
    let hit = this._els.get(hitKey);
    if (!hit) {
      hit = makeEl('circle', {
        fill: 'transparent', stroke: 'transparent', 'pointer-events': 'all',
        'data-role': 'anchor', 'data-path-id': pathId, 'data-pt-idx': ptIdx,
      }, this.interaction);
      this._els.set(hitKey, hit);
    }
    setAttr(hit, { cx: pt.x, cy: pt.y, r: hr });
  }

  _clearAll() {
    this.overlay.innerHTML = '';
    this.interaction.innerHTML = '';
    this._els.clear();
  }
}

function makeEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}
function setAttr(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}
