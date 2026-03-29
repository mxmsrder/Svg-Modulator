// CanvasViewport.js — Pan/zoom via SVG viewBox + path rendering
// viewBox (not group transform) guarantees repaints each frame.

const NS = 'http://www.w3.org/2000/svg';

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

    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-role]')) return;
      isPanning = true;
      startX = e.clientX; startY = e.clientY;
      startPanX = this.panX; startPanY = this.panY;
      svg.setPointerCapture(e.pointerId);
      svg.style.cursor = 'grabbing';
    });
    svg.addEventListener('pointermove', (e) => {
      if (!isPanning) return;
      this.panX = startPanX + (e.clientX - startX);
      this.panY = startPanY + (e.clientY - startY);
      this._updateViewBox();
    });
    svg.addEventListener('pointerup',    () => { isPanning = false; svg.style.cursor = ''; });
    svg.addEventListener('pointercancel', () => { isPanning = false; svg.style.cursor = ''; });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.02, Math.min(100, this.zoom * factor));
      this.panX = mx - (mx - this.panX) * (newZoom / this.zoom);
      this.panY = my - (my - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
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

      if (!model.visible) {
        el.setAttribute('visibility', 'hidden');
      } else {
        el.setAttribute('visibility', 'visible');
        el.setAttribute('d', model.toPathString());
        const t = model.toTransformString();
        if (t) el.setAttribute('transform', t); else el.removeAttribute('transform');

        if (showWireframe) {
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', model.stroke || '#888');
          el.setAttribute('stroke-width', (model.strokeWidth * invZ).toFixed(4));
          el.setAttribute('fill-opacity', '0');
        } else {
          el.setAttribute('fill',         model.fill);
          el.setAttribute('fill-opacity', model.fillOpacity);
          el.setAttribute('stroke',       model.stroke);
          el.setAttribute('stroke-width', model.strokeWidth);
        }
        if (model.selected) {
          el.setAttribute('stroke-opacity', '1');
        } else {
          el.removeAttribute('stroke-opacity');
        }
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
        hit.setAttribute('d', model.toPathString());
        hit.setAttribute('stroke-width', Math.max(10 * invZ, 2));
        const t = model.toTransformString();
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
