// PointOverlay.js — Renders anchor points and bezier handles on the overlay SVG layer
// Also manages interaction targets for dragging.

const NS = 'http://www.w3.org/2000/svg';

export class PointOverlay {
  constructor(overlayGroup, interactionGroup) {
    this.overlay     = overlayGroup;
    this.interaction = interactionGroup;
    this.showAnchors = true;
    this.showHandles = true;

    // Cache of SVG elements  { key → el }
    this._els = new Map();
  }

  // ── Render ────────────────────────────────────────────

  render(paths, selection, zoom) {
    if (!this.showAnchors && !this.showHandles) {
      this.overlay.innerHTML = '';
      this.interaction.innerHTML = '';
      return;
    }

    const used = new Set();
    const invZoom = 1 / zoom; // scale handle/anchor sizes independent of zoom

    for (const [pathId, model] of paths) {
      if (!model.visible || !model.selected) continue;

      model.points.forEach((pt, ptIdx) => {
        if (this.showHandles) {
          // handleIn line + dot
          if (pt.handleIn) {
            this._renderHandle(pathId, ptIdx, 'in', pt.handleIn, pt, invZoom, used);
          }
          // handleOut line + dot
          if (pt.handleOut) {
            this._renderHandle(pathId, ptIdx, 'out', pt.handleOut, pt, invZoom, used);
          }
        }

        if (this.showAnchors) {
          this._renderAnchor(pathId, ptIdx, pt, invZoom, selection, used);
        }
      });
    }

    // Remove unused elements
    for (const [key, el] of this._els) {
      if (!used.has(key)) {
        el.remove();
        this._els.delete(key);
      }
    }
  }

  _renderHandle(pathId, ptIdx, role, handle, anchor, invZoom, used) {
    // Line: anchor → handle
    const lineKey = `${pathId}:${ptIdx}:line-${role}`;
    used.add(lineKey);
    let line = this._els.get(lineKey);
    if (!line) {
      line = el('line', { class: 'handle-line' }, this.overlay);
      this._els.set(lineKey, line);
    }
    setAttr(line, { x1: anchor.x, y1: anchor.y, x2: handle.x, y2: handle.y,
                    'stroke-width': 1 * invZoom });

    // Handle dot
    const dotKey = `${pathId}:${ptIdx}:hdot-${role}`;
    used.add(dotKey);
    let dot = this._els.get(dotKey);
    if (!dot) {
      dot = el('circle', {
        class: 'handle-pt',
        'data-role': 'handle',
        'data-path-id': pathId,
        'data-pt-idx': ptIdx,
        'data-handle-role': role,
      }, this.interaction);
      this._els.set(dotKey, dot);
    }
    setAttr(dot, { cx: handle.x, cy: handle.y, r: 3 * invZoom,
                   'stroke-width': 1 * invZoom });
  }

  _renderAnchor(pathId, ptIdx, pt, invZoom, selection, used) {
    const key = `${pathId}:${ptIdx}:anchor`;
    used.add(key);
    let circle = this._els.get(key);
    if (!circle) {
      circle = el('circle', {
        class: 'anchor-pt',
        'data-role': 'anchor',
        'data-path-id': pathId,
        'data-pt-idx': ptIdx,
      }, this.interaction);
      this._els.set(key, circle);
    }

    const isSelected = selection.pointIds.has(pt.id);
    circle.setAttribute('class', `anchor-pt${isSelected ? ' selected' : ''}`);
    setAttr(circle, { cx: pt.x, cy: pt.y,
                      r: (isSelected ? 5 : 4) * invZoom,
                      'stroke-width': 1.5 * invZoom });
  }

  clearAll() {
    this.overlay.innerHTML     = '';
    this.interaction.innerHTML = '';
    this._els.clear();
  }
}

// ────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function setAttr(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}
