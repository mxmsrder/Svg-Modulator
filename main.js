// main.js — SVG Oscillator Editor bootstrap
// Single rAF loop: oscillators → bindings → mirror sync → render

import { parseSVGString } from './modules/SVGParser.js';
import { CanvasViewport  } from './modules/CanvasViewport.js';
import { PointOverlay    } from './modules/PointOverlay.js';
import { OscillatorEngine } from './modules/OscillatorEngine.js';
import { BindingSystem   } from './modules/BindingSystem.js';
import { DragController, syncMirrorSlaves } from './modules/PathOperations.js';
import { OscillatorPanel } from './panels/OscillatorPanel.js';
import { BindingPanel    } from './panels/BindingPanel.js';
import { PathInspector   } from './panels/PathInspector.js';

// ────────────────────────────────────────────────────
// App State
// ────────────────────────────────────────────────────
const state = {
  paths:     new Map(),   // id → PathModel
  selection: { pathId: null, pointIds: new Set() },
  playback: {
    playing:    false,
    bpm:        120,
    globalTime: 0,
  },
  ui: {
    showAnchors:   true,
    showHandles:   true,
    showWireframe: false,
  },
};

// ────────────────────────────────────────────────────
// Module instances
// ────────────────────────────────────────────────────
const svgEl     = document.getElementById('editor-svg');
const contentG  = document.getElementById('svg-content-group');
const overlayG  = document.getElementById('overlay-group');
const interactG = document.getElementById('interaction-group');

const viewport      = new CanvasViewport(svgEl, contentG);
const overlay       = new PointOverlay(overlayG, interactG);
const oscEngine     = new OscillatorEngine();
const bindingSys    = new BindingSystem();

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
  () => {}
);

const inspector = new PathInspector(
  {
    content:     document.getElementById('inspector-content'),
    noSel:       document.getElementById('inspector-no-selection'),
    pathId:      document.getElementById('inspector-path-id'),
    pointCount:  document.getElementById('inspector-point-count'),
    tableBody:   document.getElementById('point-table-body'),
    ptDetail:    document.getElementById('selected-point-detail'),
    ptX:         document.getElementById('pt-x-input'),
    ptY:         document.getElementById('pt-y-input'),
    ptType:      document.getElementById('pt-type-select'),
  },
  state.paths,
  state.selection,
  (pathId) => {
    inspector.render();
    bindingPanel.render();
  }
);

new DragController(
  interactG,
  viewport,
  state.paths,
  state.selection,
  (pathId) => { inspector.render(); }
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
  try {
    result = parseSVGString(text);
  } catch(e) {
    alert('Could not parse SVG: ' + e.message);
    return;
  }

  // Clear existing
  state.paths.clear();
  state.selection.pathId   = null;
  state.selection.pointIds = new Set();
  bindingSys.bindings.clear();

  for (const model of result.paths) {
    state.paths.set(model.id, model);
  }

  viewport.setViewBox(result.viewBox);
  document.getElementById('drop-hint').classList.add('hidden');

  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

// File input
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadSVG(ev.target.result);
  reader.readAsText(file);
  e.target.value = ''; // allow re-importing same file
});

// Drag & drop
const dropZone = document.getElementById('canvas-drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
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

// ────────────────────────────────────────────────────
// Path selection (click on canvas path)
// ────────────────────────────────────────────────────
svgEl.addEventListener('click', (e) => {
  const pathEl = e.target.closest('[data-path-id]');
  if (!pathEl || e.target.dataset.role === 'anchor' || e.target.dataset.role === 'handle') return;

  const pathId = pathEl.dataset.pathId;
  if (!pathId) return;

  // Deselect previous
  if (state.selection.pathId) {
    const prev = state.paths.get(state.selection.pathId);
    if (prev) prev.selected = false;
  }

  state.selection.pathId   = pathId;
  state.selection.pointIds = new Set();
  const model = state.paths.get(pathId);
  if (model) model.selected = true;

  inspector.render();
  bindingPanel.render();
});

// Click background to deselect
svgEl.addEventListener('click', (e) => {
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

// Toggle overlays
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

// Play / Stop
document.getElementById('btn-play').addEventListener('click', () => {
  state.playback.playing = true;
  document.getElementById('btn-play').classList.add('active');
});

document.getElementById('btn-stop').addEventListener('click', () => {
  state.playback.playing = false;
  document.getElementById('btn-play').classList.remove('active');
  // Reset animated values to base
  bindingSys.resetToBase(state.paths);
});

// BPM (stored, used by oscillators if they wish to sync)
document.getElementById('bpm-input').addEventListener('input', (e) => {
  state.playback.bpm = parseFloat(e.target.value) || 120;
});

// Zoom controls
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  const rect   = svgEl.getBoundingClientRect();
  const cx     = rect.width  / 2;
  const cy     = rect.height / 2;
  const factor = 1.25;
  viewport.panX = cx - (cx - viewport.panX) * factor;
  viewport.panY = cy - (cy - viewport.panY) * factor;
  viewport.zoom = Math.min(50, viewport.zoom * factor);
  viewport._applyTransform();
  viewport._emitZoom();
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  const rect   = svgEl.getBoundingClientRect();
  const cx     = rect.width  / 2;
  const cy     = rect.height / 2;
  const factor = 1 / 1.25;
  viewport.panX = cx - (cx - viewport.panX) * factor;
  viewport.panY = cy - (cy - viewport.panY) * factor;
  viewport.zoom = Math.max(0.05, viewport.zoom * factor);
  viewport._applyTransform();
  viewport._emitZoom();
});

document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  viewport.fitToView();
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
document.getElementById('export-btn').addEventListener('click', () => {
  document.getElementById('export-menu').parentElement.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

document.getElementById('export-menu').querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    document.getElementById('export-menu').parentElement.classList.remove('open');
    if (action === 'export-svg')   exportStaticSVG();
    if (action === 'export-smil')  exportSMIL();
    if (action === 'export-state') exportState();
  });
});

function exportStaticSVG() {
  // Serialize current path states to an SVG string
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
  // Basic SMIL: sample each binding over one oscillator period
  const ns   = 'http://www.w3.org/2000/svg';
  const svgD = document.createElementNS(ns, 'svg');
  const vb   = viewport.svgVB;
  svgD.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svgD.setAttribute('xmlns', ns);

  for (const model of state.paths.values()) {
    if (!model.visible) continue;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', model.toPathString());
    p.setAttribute('fill', model.fill);
    p.setAttribute('stroke', model.stroke);
    p.setAttribute('stroke-width', model.strokeWidth);

    // Find bindings for this path
    for (const b of bindingSys.bindings.values()) {
      if (b.target.pathId !== model.id) continue;
      if (b.target.pointIndex !== null) continue; // skip per-point for SMIL (complex)
      const osc = oscEngine.oscillators.get(b.oscillatorId);
      if (!osc) continue;
      const duration = (1 / osc.frequency).toFixed(3);

      // Sample 60 frames of this oscillator
      const FRAMES = 60;
      const vals = [];
      for (let i = 0; i <= FRAMES; i++) {
        const t = i / FRAMES * (1 / osc.frequency);
        oscEngine.tick(t);
        vals.push((osc.currentValue * b.scale).toFixed(3));
      }

      const animEl = document.createElementNS(ns, 'animate');
      animEl.setAttribute('attributeName', b.target.property);
      animEl.setAttribute('values', vals.join(';'));
      animEl.setAttribute('dur', duration + 's');
      animEl.setAttribute('repeatCount', 'indefinite');
      animEl.setAttribute('calcMode', 'linear');
      p.appendChild(animEl);
    }

    svgD.appendChild(p);
  }

  downloadText(new XMLSerializer().serializeToString(svgD), 'animated.svg', 'image/svg+xml');
}

function exportState() {
  const obj = {
    paths:    [...state.paths.values()].map(m => ({
      id: m.id,
      points: m.points.map(p => ({
        x: p.baseX, y: p.baseY, type: p.type,
        hi: p.handleIn  ? { x: p.handleIn.baseX,  y: p.handleIn.baseY  } : null,
        ho: p.handleOut ? { x: p.handleOut.baseX, y: p.handleOut.baseY } : null,
      })),
      closed: m.closed,
      fill: m.fill, stroke: m.stroke,
      strokeWidth: m.baseStrokeWidth,
    })),
    oscillators: [...oscEngine.oscillators.values()].map(o => ({
      id: o.id, name: o.name, waveform: o.waveform,
      frequency: o.frequency, amplitude: o.amplitude,
      phase: o.phase, offset: o.offset, color: o.color,
    })),
    bindings: [...bindingSys.bindings.values()].map(b => ({
      id: b.id, oscillatorId: b.oscillatorId,
      target: b.target, scale: b.scale,
    })),
  };
  downloadText(JSON.stringify(obj, null, 2), 'svg-osc-state.json', 'application/json');
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
