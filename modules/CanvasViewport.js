// CanvasViewport.js — Pan/zoom via SVG viewBox + path rendering
// viewBox (not group transform) guarantees repaints each frame.

const NS = 'http://www.w3.org/2000/svg';

// ── HSL color helpers ────────────────────────────────
function hexToHSL(hex) {
  if (!hex || hex.length < 7) return [0, 0, 50];
  let r = parseInt(hex.slice(1,3), 16) / 255;
  let g = parseInt(hex.slice(3,5), 16) / 255;
  let b = parseInt(hex.slice(5,7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch(max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function applyHSLDelta(hexColor, dh, ds, dl) {
  if (!hexColor || hexColor === 'none' || (!dh && !ds && !dl)) return hexColor;
  // Handle non-hex colors gracefully
  if (!hexColor.startsWith('#')) return hexColor;
  const [h, s, l] = hexToHSL(hexColor);
  const nh = ((h + dh) % 360 + 360) % 360;
  const ns = Math.max(0, Math.min(100, s + ds));
  const nl = Math.max(0, Math.min(100, l + dl));
  return `hsl(${nh.toFixed(1)},${ns.toFixed(1)}%,${nl.toFixed(1)}%)`;
}

export class CanvasViewport {
  constructor(svgEl, contentGroup) {
    this.svg   = svgEl;
    this.group = contentGroup;

    this.panX  = 0;
    this.panY  = 0;
    this.zoom  = 1;
    this.svgVB = { x: 0, y: 0, w: 500, h: 500 };

    this._pathEls = new Map();
    this._hitEls  = new Map();

    this.group.removeAttribute('transform');
    const ol = document.getElementById('overlay-group');
    if (ol) ol.removeAttribute('transform');
    const ig = document.getElementById('interaction-group');
    if (ig) ig.removeAttribute('transform');

    this._setupPanZoom();
    requestAnimationFrame(() => this._updateViewBox());
  }

  setViewBox(vb) {
    this.svgVB = { ...vb };
    this.fitToView();
  }

  fitToView() {
    const rect = this.svg.getBoundingClientRect();
    const W = rect.width  || (window.innerWidth  - 460);
    const H = rect.height || (window.innerHeight - 100);
    const vb = this.svgVB;
    const scaleX = W / (vb.w || 1);
    const scaleY = H / (vb.h || 1);
    this.zoom = Math.min(scaleX, scaleY) * 0.9;
    this.panX = (W - vb.w * this.zoom) / 2 - vb.x * this.zoom;
    this.panY = (H - vb.h * this.zoom) / 2 - vb.y * this.zoom;
    this._updateViewBox();
  }

  screenToSVG(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top  - this.panY) / this.zoom,
    };
  }

  _updateViewBox() {
    const rect = this.svg.getBoundingClientRect();
    const W = rect.width  || (window.innerWidth  - 460);
    const H = rect.height || (window.innerHeight - 100);
    const vbX = -this.panX / this.zoom;
    const vbY = -this.panY / this.zoom;
    const vbW =  W / this.zoom;
    const vbH =  H / this.zoom;
    this.svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    this._vbW = vbW; this._vbH = vbH;
    this._emitZoom();
  }

  _applyTransform() { this._updateViewBox(); }

  _emitZoom() {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(this.zoom * 100) + '%';
  }

  _setupPanZoom() {
    const svg = this.svg;
    let isPanning = false;
    let startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    // External rubber-band callback — set by main.js
    // onBackgroundPointerDown(e) → return true to suppress pan
    this.onBackgroundPointerDown = null;
    this.onBackgroundPointerMove = null;
    this.onBackgroundPointerUp   = null;

    // Space-key state (set by main.js keyboard handler)
    this.spaceDown = false;

    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-role]')) return;
      // If space held → pan regardless
      if (this.spaceDown) {
        isPanning = true;
        startX = e.clientX; startY = e.clientY;
        startPanX = this.panX; startPanY = this.panY;
        svg.setPointerCapture(e.pointerId);
        svg.style.cursor = 'grabbing';
        return;
      }
      // Delegate to rubber-band handler if registered
      if (this.onBackgroundPointerDown) {
        this.onBackgroundPointerDown(e);
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (isPanning) {
        this.panX = startPanX + (e.clientX - startX);
        this.panY = startPanY + (e.clientY - startY);
        this._updateViewBox();
        return;
      }
      if (this.onBackgroundPointerMove) this.onBackgroundPointerMove(e);
    });

    svg.addEventListener('pointerup', (e) => {
      if (isPanning) { isPanning = false; svg.style.cursor = ''; return; }
      if (this.onBackgroundPointerUp) this.onBackgroundPointerUp(e);
    });
    svg.addEventListener('pointercancel', () => { isPanning = false; svg.style.cursor = ''; });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;

      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad pinch sends wheel + ctrlKey)
        const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.max(0.02, Math.min(100, this.zoom * factor));
        this.panX = mx - (mx - this.panX) * (newZoom / this.zoom);
        this.panY = my - (my - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
      } else {
        // Two-finger scroll → pan
        this.panX -= e.deltaX;
        this.panY -= e.deltaY;
      }
      this._updateViewBox();
    }, { passive: false });
  }

  render(paths, showWireframe) {
    const active = new Set();
    const invZ   = 1 / this.zoom;

    for (const [id, model] of paths) {
      active.add(id);

      let el = this._pathEls.get(id);
      if (!el) {
        el = document.createElementNS(NS, 'path');
        el.setAttribute('pointer-events', 'none');
        this.group.appendChild(el);
        this._pathEls.set(id, el);
      }

      // Cache path string and transform — reused for both visual and hit elements
      const d = model.toPathString();
      const t = model.toTransformString();

      if (!model.visible) {
        el.setAttribute('visibility', 'hidden');
      } else {
        el.setAttribute('visibility', 'visible');
        el.setAttribute('d', d);
        if (t) el.setAttribute('transform', t); else el.removeAttribute('transform');

        if (showWireframe) {
          el.setAttribute('fill', 'none');
          const wfStroke = model.stroke !== 'none' ? applyHSLDelta(model.stroke, model.strokeH, model.strokeS, model.strokeL) : '#888888';
          el.setAttribute('stroke', wfStroke);
          el.setAttribute('stroke-width', invZ.toFixed(6));
          el.setAttribute('fill-opacity', '0');
        } else {
          el.setAttribute('fill',         applyHSLDelta(model.fill,   model.fillH,   model.fillS,   model.fillL));
          el.setAttribute('fill-opacity', model.fillOpacity);
          el.setAttribute('stroke',       applyHSLDelta(model.stroke, model.strokeH, model.strokeS, model.strokeL));
          el.setAttribute('stroke-width', model.strokeWidth);
        }
        if (model.selected) el.setAttribute('stroke-opacity', '1');
        else                 el.removeAttribute('stroke-opacity');
      }

      let hit = this._hitEls.get(id);
      if (!hit) {
        hit = document.createElementNS(NS, 'path');
        hit.setAttribute('fill',           'transparent');
        hit.setAttribute('stroke',         'transparent');
        hit.setAttribute('pointer-events', 'all');
        hit.style.cursor = 'pointer';
        hit.dataset.pathId = id;
        hit.dataset.role   = 'path';
        this.group.appendChild(hit);
        this._hitEls.set(id, hit);
      }

      if (!model.visible) {
        hit.setAttribute('visibility', 'hidden');
      } else {
        hit.setAttribute('visibility', 'visible');
        hit.setAttribute('d', d);
        hit.setAttribute('stroke-width', Math.max(10 * invZ, 2));
        if (t) hit.setAttribute('transform', t); else hit.removeAttribute('transform');
      }
    }

    for (const [id, el] of this._pathEls) {
      if (!active.has(id)) { el.remove(); this._pathEls.delete(id); }
    }
    for (const [id, el] of this._hitEls) {
      if (!active.has(id)) { el.remove(); this._hitEls.delete(id); }
    }
  }

  getPathElement(pathId) { return this._pathEls.get(pathId) || null; }
}
