// PathInspector.js — Path info, appearance, point detail, operations
// Re-renders whenever selection changes.

import { resample, splitSegment, mirrorX, mirrorY, createLinkedMirrorClone } from '../modules/PathOperations.js';
import { BoxSlider } from '../components/BoxSlider.js';

export class PathInspector {
  constructor(els, paths, selection, onModified, pushHistory) {
    this.els         = els;
    this.paths       = paths;
    this.selection   = selection;
    this.onModified  = onModified;
    this.pushHistory = pushHistory;

    this._fillOpSlider    = null;
    this._strokeWSlider   = null;
    this._strokeOpSlider  = null;
    this._boundPtId       = null; // which point's inputs are bound

    this._recentColors = (() => {
      try { return JSON.parse(localStorage.getItem('svg-osc-recent-colors') || '[]'); }
      catch { return []; }
    })();
    this._fillSwatchesEl   = null;
    this._strokeSwatchesEl = null;

    this._bindOps();
    this._bindAppearance();
    this._bindPointInputs();
  }

  render() {
    const { content, noSel } = this.els;
    const pathId = this.selection.pathId;
    const model  = pathId ? this.paths.get(pathId) : null;

    // Multi-select handled by renderMultiSelectUI in main.js
    if ((this.selection.pathIds?.size ?? 0) > 1) {
      content.hidden = true;
      noSel.hidden   = true;
      document.getElementById('inspector-point-detail').hidden = true;
      return;
    }

    if (!model) {
      content.hidden = true;
      noSel.hidden   = false;
      document.getElementById('inspector-point-detail').hidden = true;
      return;
    }

    document.getElementById('inspector-multi-sel').hidden = true;
    content.hidden = false;
    noSel.hidden   = true;

    this.els.pathId.textContent     = model.id;
    this.els.pointCount.textContent = model.points.length;

    this._renderAppearance(model);
    this._renderPointDetail(model);
  }

  // ── Appearance ──────────────────────────────────────

  _renderAppearance(model) {
    this._ensureSwatchContainers();

    // Sync color inputs
    const fillInput   = document.getElementById('fill-color-input');
    const strokeInput = document.getElementById('stroke-color-input');

    if (model.fill && model.fill !== 'none') {
      fillInput.value = rgbToHex(model.fill) || fillInput.value;
    }
    if (model.stroke && model.stroke !== 'none') {
      strokeInput.value = rgbToHex(model.stroke) || strokeInput.value;
    }

    // Active mode buttons
    const fillNone   = model.fill   === 'none';
    const strokeNone = model.stroke === 'none';
    document.getElementById('btn-mode-fill').classList.toggle('active',   !fillNone &&  strokeNone);
    document.getElementById('btn-mode-stroke').classList.toggle('active',  fillNone && !strokeNone);
    document.getElementById('btn-mode-both').classList.toggle('active',   !fillNone && !strokeNone);

    // Fill opacity slider
    const fillWrap = document.getElementById('fill-opacity-wrap');
    if (!this._fillOpSlider) {
      this._fillOpSlider = new BoxSlider(fillWrap, {
        label: '', unit: '', min: 0, max: 1, step: 0, value: model.fillOpacity,
        color: '#7b72ff',
        onChange: v => {
          const m = this.paths.get(this.selection.pathId);
          if (m) { m.fillOpacity = v; m.baseFillOpacity = v; }
        },
      });
    } else {
      this._fillOpSlider.set(model.fillOpacity);
    }

    // Stroke width slider
    const strokeWrap = document.getElementById('stroke-width-wrap');
    if (!this._strokeWSlider) {
      this._strokeWSlider = new BoxSlider(strokeWrap, {
        label: '', unit: '', min: 0, max: 20, step: 0, value: model.strokeWidth,
        color: '#7b72ff',
        onChange: v => {
          const m = this.paths.get(this.selection.pathId);
          if (m) { m.strokeWidth = v; m.baseStrokeWidth = v; }
        },
      });
    } else {
      this._strokeWSlider.set(model.strokeWidth);
    }

    // Stroke opacity slider
    const strokeOpWrap = document.getElementById('stroke-opacity-wrap');
    if (strokeOpWrap) {
      if (!this._strokeOpSlider) {
        this._strokeOpSlider = new BoxSlider(strokeOpWrap, {
          label: '', unit: '', min: 0, max: 1, step: 0, value: model.strokeOpacity ?? 1,
          color: '#7b72ff',
          onChange: v => {
            const m = this.paths.get(this.selection.pathId);
            if (m) { m.strokeOpacity = v; m.baseStrokeOpacity = v; }
          },
        });
      } else {
        this._strokeOpSlider.set(model.strokeOpacity ?? 1);
      }
    }

    // Render recent swatches
    if (this._fillSwatchesEl) {
      this._renderSwatches(this._fillSwatchesEl, (c) => {
        const m = this.paths.get(this.selection.pathId);
        if (!m) return;
        m.fill = c;
        fillInput.value = c;
        this.onModified();
      });
    }
    if (this._strokeSwatchesEl) {
      this._renderSwatches(this._strokeSwatchesEl, (c) => {
        const m = this.paths.get(this.selection.pathId);
        if (!m) return;
        m.stroke = c;
        strokeInput.value = c;
        this.onModified();
      });
    }
  }

  _bindAppearance() {
    document.getElementById('fill-color-input').addEventListener('input', (e) => {
      const m = this.paths.get(this.selection.pathId);
      if (!m || m.fill === 'none') return;
      m.fill = e.target.value;
    });
    document.getElementById('fill-color-input').addEventListener('change', (e) => {
      this._addRecentColor(e.target.value);
      if (this._fillSwatchesEl) {
        this._renderSwatches(this._fillSwatchesEl, (c) => {
          const m = this.paths.get(this.selection.pathId);
          if (!m) return;
          m.fill = c;
          e.target.value = c;
          this.onModified();
        });
      }
    });

    document.getElementById('stroke-color-input').addEventListener('input', (e) => {
      const m = this.paths.get(this.selection.pathId);
      if (!m || m.stroke === 'none') return;
      m.stroke = e.target.value;
    });
    document.getElementById('stroke-color-input').addEventListener('change', (e) => {
      this._addRecentColor(e.target.value);
      if (this._strokeSwatchesEl) {
        this._renderSwatches(this._strokeSwatchesEl, (c) => {
          const m = this.paths.get(this.selection.pathId);
          if (!m) return;
          m.stroke = c;
          e.target.value = c;
          this.onModified();
        });
      }
    });

    document.getElementById('btn-mode-fill').addEventListener('click', () => {
      const m = this.paths.get(this.selection.pathId);
      if (!m) return;
      m.fill   = document.getElementById('fill-color-input').value;
      m.stroke = 'none';
      this._renderAppearance(m);
    });

    document.getElementById('btn-mode-stroke').addEventListener('click', () => {
      const m = this.paths.get(this.selection.pathId);
      if (!m) return;
      m.fill   = 'none';
      m.stroke = document.getElementById('stroke-color-input').value;
      this._strokeWSlider?.set(m.strokeWidth > 0 ? m.strokeWidth : 1);
      this._renderAppearance(m);
    });

    document.getElementById('btn-mode-both').addEventListener('click', () => {
      const m = this.paths.get(this.selection.pathId);
      if (!m) return;
      m.fill   = document.getElementById('fill-color-input').value;
      m.stroke = document.getElementById('stroke-color-input').value;
      this._renderAppearance(m);
    });
  }

  // ── Recent color swatches ─────────────────────────────

  _addRecentColor(hex) {
    if (!hex || hex.length !== 7) return;
    this._recentColors = [hex, ...this._recentColors.filter(c => c !== hex)].slice(0, 8);
    try { localStorage.setItem('svg-osc-recent-colors', JSON.stringify(this._recentColors)); } catch {}
  }

  _renderSwatches(container, onPick) {
    container.innerHTML = '';
    for (const c of this._recentColors) {
      const s = document.createElement('button');
      s.className = 'color-swatch';
      s.style.background = c;
      s.title = c;
      s.addEventListener('click', () => onPick(c));
      container.appendChild(s);
    }
  }

  _ensureSwatchContainers() {
    if (!this._fillSwatchesEl) {
      const fillRow = document.getElementById('fill-color-input')?.closest('.app-color-row');
      if (fillRow) {
        this._fillSwatchesEl = document.createElement('div');
        this._fillSwatchesEl.className = 'color-swatches';
        fillRow.after(this._fillSwatchesEl);
      }
    }
    if (!this._strokeSwatchesEl) {
      const strokeRow = document.getElementById('stroke-color-input')?.closest('.app-color-row');
      if (strokeRow) {
        this._strokeSwatchesEl = document.createElement('div');
        this._strokeSwatchesEl.className = 'color-swatches';
        strokeRow.after(this._strokeSwatchesEl);
      }
    }
  }

  // ── Selected point detail ────────────────────────────

  _renderPointDetail(model) {
    const ptId  = [...this.selection.pointIds][0];
    const ptIdx = ptId ? model.points.findIndex(p => p.id === ptId) : -1;
    const detailEl = document.getElementById('inspector-point-detail');

    if (ptIdx < 0) {
      detailEl.hidden = true;
      this._boundPtId = null;
      return;
    }

    const pt = model.points[ptIdx];
    detailEl.hidden = false;
    document.getElementById('pt-detail-idx').textContent = `#${ptIdx}`;

    // Prevent feedback when updating inputs programmatically
    this._boundPtId = ptId;

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el !== document.activeElement) el.value = parseFloat(v.toFixed(4));
    };

    setVal('pt-x', pt.baseX);
    setVal('pt-y', pt.baseY);

    const hiRows = document.getElementById('pt-handle-in-rows');
    const hoRows = document.getElementById('pt-handle-out-rows');

    if (pt.handleIn) {
      hiRows.hidden = false;
      setVal('pt-hi-x', pt.handleIn.baseX);
      setVal('pt-hi-y', pt.handleIn.baseY);
    } else {
      hiRows.hidden = true;
    }
    if (pt.handleOut) {
      hoRows.hidden = false;
      setVal('pt-ho-x', pt.handleOut.baseX);
      setVal('pt-ho-y', pt.handleOut.baseY);
    } else {
      hoRows.hidden = true;
    }

    document.getElementById('pt-type').value = pt.type || 'smooth';
  }

  _bindPointInputs() {
    const commit = (inputId, apply) => {
      document.getElementById(inputId).addEventListener('change', (e) => {
        const pathId = this.selection.pathId;
        const model  = this.paths.get(pathId);
        if (!model) return;
        const ptId  = [...this.selection.pointIds][0];
        const ptIdx = ptId ? model.points.findIndex(p => p.id === ptId) : -1;
        if (ptIdx < 0) return;
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        this.pushHistory?.();
        apply(model.points[ptIdx], val);
        this.onModified(pathId);
      });
    };

    commit('pt-x',   (pt, v) => { pt.baseX = v; pt.x = v; });
    commit('pt-y',   (pt, v) => { pt.baseY = v; pt.y = v; });
    commit('pt-hi-x',(pt, v) => { if (pt.handleIn)  { pt.handleIn.baseX  = v; pt.handleIn.x  = v; } });
    commit('pt-hi-y',(pt, v) => { if (pt.handleIn)  { pt.handleIn.baseY  = v; pt.handleIn.y  = v; } });
    commit('pt-ho-x',(pt, v) => { if (pt.handleOut) { pt.handleOut.baseX = v; pt.handleOut.x = v; } });
    commit('pt-ho-y',(pt, v) => { if (pt.handleOut) { pt.handleOut.baseY = v; pt.handleOut.y = v; } });

    document.getElementById('pt-type').addEventListener('change', (e) => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      const ptId  = [...this.selection.pointIds][0];
      const ptIdx = ptId ? model.points.findIndex(p => p.id === ptId) : -1;
      if (ptIdx < 0) return;
      model.points[ptIdx].type = e.target.value;
    });
  }

  // ── Operations ───────────────────────────────────────

  _bindOps() {
    document.getElementById('btn-delete-shape')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      if (!pathId) return;
      this.pushHistory?.();
      this.paths.delete(pathId);
      this.selection.pathId   = null;
      this.selection.pointIds = new Set();
      this.onModified(null);
      this.render();
    });

    document.getElementById('btn-resample')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      const count = parseInt(document.getElementById('resample-count').value, 10) || 32;
      resample(model, count);
      this.selection.pointIds = new Set();
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-split-point')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      const ptId  = [...this.selection.pointIds][0];
      const ptIdx = model.points.findIndex(p => p.id === ptId);
      if (ptIdx < 0) return;
      const segIdx = ptIdx === model.points.length - 1 ? ptIdx - 1 : ptIdx;
      splitSegment(model, segIdx, 0.5);
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-remove-point')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      const ptId  = [...this.selection.pointIds][0];
      const ptIdx = model.points.findIndex(p => p.id === ptId);
      if (ptIdx < 0 || model.points.length <= 2) return;
      this.pushHistory?.();
      model.points.splice(ptIdx, 1);
      this.selection.pointIds = new Set();
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-mirror-x')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      mirrorX(model);
      this.onModified(pathId);
    });

    document.getElementById('btn-mirror-y')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      mirrorY(model);
      this.onModified(pathId);
    });

    document.getElementById('btn-mirror-linked')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      if (model.mirrorSlaveId) {
        this.paths.delete(model.mirrorSlaveId);
        model.mirrorSlaveId = null;
        model.mirrorAxis    = null;
      } else {
        const clone = createLinkedMirrorClone(model, 'x');
        this.paths.set(clone.id, clone);
      }
      this.onModified(pathId, this.paths);
      this.render();
    });
  }
}

// Convert CSS color (could be #hex or rgb(...)) to #hex for input[type=color]
function rgbToHex(color) {
  if (!color || color === 'none') return null;
  if (color.startsWith('#') && (color.length === 4 || color.length === 7)) return color;
  // rgb(r,g,b) → #rrggbb
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return color;
  return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}
