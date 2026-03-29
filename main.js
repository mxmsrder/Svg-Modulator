// main.js — SVG Oscillator Editor bootstrap
// Single rAF loop: oscillators → bindings → mirror sync → render

import { parseSVGString }   from './modules/SVGParser.js';
import { PathModel, Point, BezierHandle } from './modules/PathModel.js';
import { CanvasViewport }   from './modules/CanvasViewport.js';
import { PointOverlay }     from './modules/PointOverlay.js';
import { OscillatorEngine } from './modules/OscillatorEngine.js';
import { BindingSystem }    from './modules/BindingSystem.js';
import { DragController, syncMirrorSlaves } from './modules/PathOperations.js';
import { History }          from './modules/History.js';
import { OscillatorPanel }  from './panels/OscillatorPanel.js';
import { BindingPanel }     from './panels/BindingPanel.js';
import { PathInspector }    from './panels/PathInspector.js';

// ────────────────────────────────────────────────────
// App State
// ────────────────────────────────────────────────────
const state = {
  paths:    new Map(),
  selection: { pathId: null, pointIds: new Set() },
  playback: { playing: false, bpm: 120, globalTime: 0 },
  ui: { showAnchors: true, showHandles: true, showWireframe: false },
};

// ────────────────────────────────────────────────────
// Module instances
// ────────────────────────────────────────────────────
const svgEl     = document.getElementById('editor-svg');
const contentG  = document.getElementById('svg-content-group');
const overlayG  = document.getElementById('overlay-group');
const interactG = document.getElementById('interaction-group');

const viewport   = new CanvasViewport(svgEl, contentG);
const overlay    = new PointOverlay(overlayG, interactG);
const oscEngine  = new OscillatorEngine();
const bindingSys = new BindingSystem();
const history    = new History(60);

// ── History helpers ─────────────────────────────────

function snapshotPaths() {
  return JSON.stringify([...state.paths.entries()].map(([, m]) => serializePath(m)));
}

function serializePath(m) {
  return {
    id: m.id, closed: m.closed, fill: m.fill, stroke: m.stroke,
    strokeWidth: m.strokeWidth, baseStrokeWidth: m.baseStrokeWidth,
    fillOpacity: m.fillOpacity, baseFillOpacity: m.baseFillOpacity,
    tx: m.tx, baseTx: m.baseTx, ty: m.ty, baseTy: m.baseTy,
    rotation: m.rotation, baseRotation: m.baseRotation,
    scaleX: m.scaleX, baseScaleX: m.baseScaleX,
    scaleY: m.scaleY, baseScaleY: m.baseScaleY,
    selected: m.selected, visible: m.visible,
    mirrorSlaveId: m.mirrorSlaveId, mirrorAxis: m.mirrorAxis,
    points: m.points.map(p => ({
      id: p.id, x: p.x, y: p.y, baseX: p.baseX, baseY: p.baseY, type: p.type,
      handleIn:  p.handleIn  ? { id: p.handleIn.id,  x: p.handleIn.x,  y: p.handleIn.y,  baseX: p.handleIn.baseX,  baseY: p.handleIn.baseY  } : null,
      handleOut: p.handleOut ? { id: p.handleOut.id, x: p.handleOut.x, y: p.handleOut.y, baseX: p.handleOut.baseX, baseY: p.handleOut.baseY } : null,
    })),
  };
}

function restoreSnapshot(json) {
  const data = JSON.parse(json);
  state.paths.clear();
  for (const d of data) {
    const m = new PathModel();
    Object.assign(m, {
      id: d.id, closed: d.closed, fill: d.fill, stroke: d.stroke,
      strokeWidth: d.strokeWidth, baseStrokeWidth: d.baseStrokeWidth,
      fillOpacity: d.fillOpacity, baseFillOpacity: d.baseFillOpacity,
      tx: d.tx, baseTx: d.baseTx, ty: d.ty, baseTy: d.baseTy,
      rotation: d.rotation, baseRotation: d.baseRotation,
      scaleX: d.scaleX, baseScaleX: d.baseScaleX,
      scaleY: d.scaleY, baseScaleY: d.baseScaleY,
      selected: d.selected, visible: d.visible,
      mirrorSlaveId: d.mirrorSlaveId, mirrorAxis: d.mirrorAxis,
    });
    m.points = d.points.map(pd => {
      const pt = new Point(pd.x, pd.y, pd.type);
      pt.id = pd.id; pt.baseX = pd.baseX; pt.baseY = pd.baseY;
      if (pd.handleIn) {
        const h = new BezierHandle(pd.handleIn.x, pd.handleIn.y);
        h.id = pd.handleIn.id; h.baseX = pd.handleIn.baseX; h.baseY = pd.handleIn.baseY;
        pt.handleIn = h;
      }
      if (pd.handleOut) {
        const h = new BezierHandle(pd.handleOut.x, pd.handleOut.y);
        h.id = pd.handleOut.id; h.baseX = pd.handleOut.baseX; h.baseY = pd.handleOut.baseY;
        pt.handleOut = h;
      }
      return pt;
    });
    state.paths.set(m.id, m);
  }
}

function pushHistory() {
  history.push(snapshotPaths());
}

function applyUndo() {
  if (!history.canUndo()) return;
  const prev = history.undo(snapshotPaths());
  if (prev) { restoreSnapshot(prev); _afterRestore(); }
}

function applyRedo() {
  if (!history.canRedo()) return;
  const next = history.redo(snapshotPaths());
  if (next) { restoreSnapshot(next); _afterRestore(); }
}

function _afterRestore() {
  // Re-validate selection
  if (state.selection.pathId && !state.paths.has(state.selection.pathId)) {
    state.selection.pathId   = null;
    state.selection.pointIds = new Set();
  }
  inspector.render();
  bindingPanel.render();
}

// ── Panels ──────────────────────────────────────────

const oscPanel = new OscillatorPanel(
  document.getElementById('osc-list'),
  oscEngine,
  () => { bindingPanel.render(); }
);

const bindingPanel = new BindingPanel(
  document.getElementById('binding-list'),
  bindingSys,
  oscEngine,
  state.paths,
  state.selection,
  () => { bindingPanel.render(); }
);

const inspector = new PathInspector(
  {
    content:    document.getElementById('inspector-content'),
    noSel:      document.getElementById('inspector-no-selection'),
    pathId:     document.getElementById('inspector-path-id'),
    pointCount: document.getElementById('inspector-point-count'),
    tableBody:  document.getElementById('point-table-body'),
    ptDetail:   document.getElementById('selected-point-detail'),
    ptX:        document.getElementById('pt-x-input'),
    ptY:        document.getElementById('pt-y-input'),
    ptType:     document.getElementById('pt-type-select'),
  },
  state.paths,
  state.selection,
  () => { inspector.render(); bindingPanel.render(); },
  pushHistory,
);

new DragController(
  interactG,
  viewport,
  state.paths,
  state.selection,
  (pathId) => { inspector.render(); },
  pushHistory,
);

// ────────────────────────────────────────────────────
// rAF Loop
// ────────────────────────────────────────────────────
let lastTime = 0;

function tick(timestamp) {
  requestAnimationFrame(tick);

  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  if (state.playback.playing) {
    state.playback.globalTime += dt;
    oscEngine.tick(state.playback.globalTime);
    bindingSys.resetToBase(state.paths);
    bindingSys.applyAll(state.paths, oscEngine.oscillators);
    syncMirrorSlaves(state.paths);
    oscPanel.tick(state.playback.globalTime);
  }

  viewport.render(state.paths, state.ui.showWireframe);
  overlay.render(state.paths, state.selection, viewport.zoom);
}

requestAnimationFrame(t => { lastTime = t; requestAnimationFrame(tick); });

// ────────────────────────────────────────────────────
// SVG Import
// ────────────────────────────────────────────────────
function loadSVG(text) {
  let result;
  try { result = parseSVGString(text); }
  catch(e) { alert('Could not parse SVG: ' + e.message); return; }

  // Clear state (fresh load — also clear undo stack)
  state.paths.clear();
  state.selection.pathId   = null;
  state.selection.pointIds = new Set();
  bindingSys.bindings.clear();
  history._undo = []; history._redo = [];
  history._updateButtons();

  for (const model of result.paths) state.paths.set(model.id, model);

  viewport.setViewBox(result.viewBox);
  document.getElementById('drop-hint').classList.add('hidden');

  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

// File input
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadSVG(ev.target.result);
  reader.readAsText(file);
  e.target.value = '';
});

// Drag & drop
const dropZone = document.getElementById('canvas-drop-zone');
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadSVG(ev.target.result);
  reader.readAsText(file);
});

// Click empty canvas (no SVG loaded yet) → open file picker
document.getElementById('drop-hint').addEventListener('click', () => fileInput.click());

// ────────────────────────────────────────────────────
// Path selection
// ────────────────────────────────────────────────────
svgEl.addEventListener('click', (e) => {
  // Ignore clicks on anchor/handle controls
  if (e.target.dataset.role === 'anchor' || e.target.dataset.role === 'handle') return;

  const pathEl = e.target.closest('[data-path-id]');
  if (pathEl) {
    const pathId = pathEl.dataset.pathId;
    if (!pathId) return;

    if (state.selection.pathId && state.selection.pathId !== pathId) {
      const prev = state.paths.get(state.selection.pathId);
      if (prev) prev.selected = false;
    }

    state.selection.pathId   = pathId;
    state.selection.pointIds = new Set();
    const model = state.paths.get(pathId);
    if (model) model.selected = true;

    inspector.render();
    bindingPanel.render();
    return;
  }

  // Click on background → deselect
  if (e.target === svgEl || e.target === contentG ||
      e.target === overlayG || e.target === interactG) {
    if (state.selection.pathId) {
      const prev = state.paths.get(state.selection.pathId);
      if (prev) prev.selected = false;
    }
    state.selection.pathId   = null;
    state.selection.pointIds = new Set();
    inspector.render();
    bindingPanel.render();
  }
});

// ────────────────────────────────────────────────────
// Toolbar controls
// ────────────────────────────────────────────────────

document.getElementById('toggle-anchors').addEventListener('click', (e) => {
  state.ui.showAnchors = !state.ui.showAnchors;
  overlay.showAnchors  = state.ui.showAnchors;
  e.currentTarget.classList.toggle('active', state.ui.showAnchors);
});

document.getElementById('toggle-handles').addEventListener('click', (e) => {
  state.ui.showHandles = !state.ui.showHandles;
  overlay.showHandles  = state.ui.showHandles;
  e.currentTarget.classList.toggle('active', state.ui.showHandles);
});

document.getElementById('toggle-wireframe').addEventListener('click', (e) => {
  state.ui.showWireframe = !state.ui.showWireframe;
  e.currentTarget.classList.toggle('active', state.ui.showWireframe);
});

document.getElementById('btn-play').addEventListener('click', () => {
  state.playback.playing = true;
  document.getElementById('btn-play').classList.add('active');
});

document.getElementById('btn-stop').addEventListener('click', () => {
  state.playback.playing = false;
  document.getElementById('btn-play').classList.remove('active');
  bindingSys.resetToBase(state.paths);
});

document.getElementById('bpm-input').addEventListener('input', (e) => {
  state.playback.bpm = parseFloat(e.target.value) || 120;
});

// Zoom controls
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  const rect = svgEl.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const f  = 1.25;
  viewport.panX = cx - (cx - viewport.panX) * f;
  viewport.panY = cy - (cy - viewport.panY) * f;
  viewport.zoom = Math.min(100, viewport.zoom * f);
  viewport._updateViewBox();
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  const rect = svgEl.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const f  = 1 / 1.25;
  viewport.panX = cx - (cx - viewport.panX) * f;
  viewport.panY = cy - (cy - viewport.panY) * f;
  viewport.zoom = Math.max(0.02, viewport.zoom * f);
  viewport._updateViewBox();
});

document.getElementById('btn-zoom-fit').addEventListener('click', () => viewport.fitToView());

// Undo / Redo buttons
document.getElementById('btn-undo').addEventListener('click', applyUndo);
document.getElementById('btn-redo').addEventListener('click', applyRedo);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  if (!cmd) return;

  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); applyUndo(); }
  if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); applyRedo(); }
  if (e.key === 'y')                 { e.preventDefault(); applyRedo(); }
});

// ────────────────────────────────────────────────────
// Add Oscillator button
// ────────────────────────────────────────────────────
document.getElementById('add-osc-btn').addEventListener('click', () => {
  oscEngine.add({ name: `LFO ${oscEngine.oscillators.size + 1}` });
  oscPanel.render();
  bindingPanel.render();
});

// ────────────────────────────────────────────────────
// Export
// ────────────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('export-menu').parentElement.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown'))
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});

document.getElementById('export-menu').querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('export-menu').parentElement.classList.remove('open');
    const action = btn.dataset.action;
    if (action === 'export-svg')   exportStaticSVG();
    if (action === 'export-smil')  exportSMIL();
    if (action === 'export-state') exportState();
  });
});

function exportStaticSVG() {
  const ns = 'http://www.w3.org/2000/svg';
  const svgDoc = document.createElementNS(ns, 'svg');
  const vb = viewport.svgVB;
  svgDoc.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svgDoc.setAttribute('xmlns', ns);

  for (const model of state.paths.values()) {
    if (!model.visible) continue;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', model.toPathString());
    p.setAttribute('fill', model.fill);
    p.setAttribute('fill-opacity', model.fillOpacity);
    p.setAttribute('stroke', model.stroke);
    p.setAttribute('stroke-width', model.strokeWidth);
    const t = model.toTransformString();
    if (t) p.setAttribute('transform', t);
    svgDoc.appendChild(p);
  }

  downloadText(new XMLSerializer().serializeToString(svgDoc), 'export.svg', 'image/svg+xml');
}

function exportSMIL() {
  const ns  = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(ns, 'svg');
  const vb  = viewport.svgVB;
  out.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  out.setAttribute('xmlns', ns);

  for (const model of state.paths.values()) {
    if (!model.visible) continue;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', model.toPathString());
    p.setAttribute('fill', model.fill);
    p.setAttribute('stroke', model.stroke);
    p.setAttribute('stroke-width', model.strokeWidth);

    for (const b of bindingSys.bindings.values()) {
      if (b.target.pathId !== model.id || b.target.pointIndex !== null) continue;
      const osc = oscEngine.oscillators.get(b.oscillatorId);
      if (!osc) continue;
      const dur  = (1 / osc.frequency).toFixed(3);
      const FRAMES = 60;
      const vals = [];
      for (let i = 0; i <= FRAMES; i++) {
        const t = (i / FRAMES) / osc.frequency;
        oscEngine.tick(t);
        vals.push((osc.currentValue * b.scale).toFixed(3));
      }
      const anim = document.createElementNS(ns, 'animate');
      anim.setAttribute('attributeName', b.target.property);
      anim.setAttribute('values', vals.join(';'));
      anim.setAttribute('dur', dur + 's');
      anim.setAttribute('repeatCount', 'indefinite');
      p.appendChild(anim);
    }

    out.appendChild(p);
  }

  downloadText(new XMLSerializer().serializeToString(out), 'animated.svg', 'image/svg+xml');
}

function exportState() {
  const obj = {
    paths: [...state.paths.values()].map(serializePath),
    oscillators: [...oscEngine.oscillators.values()].map(o => ({
      id: o.id, name: o.name, waveform: o.waveform,
      frequency: o.frequency, amplitude: o.amplitude,
      phase: o.phase, offset: o.offset, color: o.color,
    })),
    bindings: [...bindingSys.bindings.values()].map(b => ({
      id: b.id, oscillatorId: b.oscillatorId, target: b.target, scale: b.scale,
    })),
  };
  downloadText(JSON.stringify(obj, null, 2), 'svg-osc-state.json', 'application/json');
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Small delay before cleanup so browser can start the download
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}
