// CanvasViewport.js — Pan/zoom SVG viewport and path rendering
// Manages the <svg id="editor-svg"> element.

export class CanvasViewport {
  constructor(svgEl, contentGroup) {
    this.svg    = svgEl;
    this.group  = contentGroup; // <g id="svg-content-group">

    // Viewport state
    this.panX  = 0;
    this.panY  = 0;
    this.zoom  = 1;
    this.svgVB = { x: 0, y: 0, w: 500, h: 500 }; // loaded SVG viewBox

    // DOM elements for rendered paths  { pathId → <path> }
    this._pathEls = new Map();

    this._setupPanZoom();
  }

  // ── Viewport helpers ─────────────────────────────────

  // Set which SVG content is displayed (fit to view)
  setViewBox(vb) {
    this.svgVB = { ...vb };
    this.fitToView();
  }

  fitToView() {
    const rect = this.svg.getBoundingClientRect();
    const W = rect.width  || window.innerWidth  - 440;
    const H = rect.height || window.innerHeight - 180;
    const vb = this.svgVB;

    // Scale to fit, centered
    const scaleX = W / vb.w;
    const scaleY = H / vb.h;
    this.zoom = Math.min(scaleX, scaleY) * 0.9;

    this.panX = (W - vb.w * this.zoom) / 2 - vb.x * this.zoom;
    this.panY = (H - vb.h * this.zoom) / 2 - vb.y * this.zoom;

    this._applyTransform();
    this._emitZoom();
  }

  // Convert screen coords → SVG content coords
  screenToSVG(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  svgToScreen(x, y) {
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
    };
  }

  _applyTransform() {
    this.group.setAttribute('transform',
      `translate(${this.panX.toFixed(2)},${this.panY.toFixed(2)}) scale(${this.zoom.toFixed(5)})`);
    // Also apply to sibling overlay group
    const ol = document.getElementById('overlay-group');
    if (ol) ol.setAttribute('transform', this.group.getAttribute('transform'));
    const ig = document.getElementById('interaction-group');
    if (ig) ig.setAttribute('transform', this.group.getAttribute('transform'));
  }

  _emitZoom() {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(this.zoom * 100) + '%';
  }

  // ── Pan & Zoom events ────────────────────────────────

  _setupPanZoom() {
    const svg = this.svg;
    let isPanning = false;
    let startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    svg.addEventListener('pointerdown', (e) => {
      // Only pan on background (no target with data-role)
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
      this._applyTransform();
    });

    svg.addEventListener('pointerup', () => {
      isPanning = false;
      svg.style.cursor = '';
    });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
      const newZoom = Math.max(0.05, Math.min(50, this.zoom * factor));

      // Zoom toward mouse pointer
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this._applyTransform();
      this._emitZoom();
    }, { passive: false });
  }

  // ── Path rendering ───────────────────────────────────

  /**
   * Render all paths from the AppState.paths Map.
   * Creates or updates <path> elements inside the content group.
   */
  render(paths, showWireframe) {
    const active = new Set();

    for (const [id, model] of paths) {
      if (!model.visible) {
        // Hide if exists
        const el = this._pathEls.get(id);
        if (el) el.setAttribute('visibility', 'hidden');
        continue;
      }

      active.add(id);
      let el = this._pathEls.get(id);

      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.dataset.pathId = id;
        el.dataset.role   = 'path';
        el.style.cursor   = 'pointer';
        this.group.appendChild(el);
        this._pathEls.set(id, el);
      }

      el.setAttribute('visibility', 'visible');
      el.setAttribute('d', model.toPathString());

      const t = model.toTransformString();
      if (t) el.setAttribute('transform', t);
      else   el.removeAttribute('transform');

      if (showWireframe) {
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', model.stroke || '#888');
        el.setAttribute('stroke-width', (model.strokeWidth / this.zoom).toFixed(3));
        el.setAttribute('fill-opacity', '0');
      } else {
        el.setAttribute('fill', model.fill);
        el.setAttribute('fill-opacity', model.fillOpacity);
        el.setAttribute('stroke', model.stroke);
        el.setAttribute('stroke-width', model.strokeWidth);
      }
    }

    // Remove stale elements
    for (const [id, el] of this._pathEls) {
      if (!active.has(id)) {
        el.remove();
        this._pathEls.delete(id);
      }
    }
  }

  // Get a rendered path element by pathId
  getPathElement(pathId) {
    return this._pathEls.get(pathId) || null;
  }
}
