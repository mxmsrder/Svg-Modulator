// main.js — SVG Oscillator Editor bootstrap

import { parseSVGString }   from './modules/SVGParser.js';
import { PathModel, Point, BezierHandle } from './modules/PathModel.js';
import { CanvasViewport }   from './modules/CanvasViewport.js';
import { PointOverlay }     from './modules/PointOverlay.js';
import { OscillatorEngine } from './modules/OscillatorEngine.js';
import { BindingSystem }    from './modules/BindingSystem.js';
import { DragController, syncMirrorSlaves, inferPointTypes } from './modules/PathOperations.js';
import { History }          from './modules/History.js';
import { OscillatorPanel }  from './panels/OscillatorPanel.js';
import { BindingPanel }     from './panels/BindingPanel.js';
import { PathInspector }    from './panels/PathInspector.js';

// ────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────
const state = {
  paths:     new Map(),
  selection: { pathId: null, pathIds: new Set(), pointIds: new Set(), highlightTarget: null },
  playback:  { playing: false, bpm: 120, globalTime: 0 },
  ui:        { showAnchors: true, showHandles: true, showWireframe: false, motionBlurDecay: 0 },
};

// ── DOM ─────────────────────────────────────────────
const svgEl     = document.getElementById('editor-svg');
const contentG  = document.getElementById('svg-content-group');
const overlayG  = document.getElementById('overlay-group');
const interactG = document.getElementById('interaction-group');

const viewport   = new CanvasViewport(svgEl, contentG);
const overlay    = new PointOverlay(overlayG, interactG);
const oscEngine  = new OscillatorEngine();
const bindingSys = new BindingSystem();
const history    = new History(60);

// ── History — snapshots include full state (paths + oscillators + bindings) ──

function snapshotAll() {
  return JSON.stringify(serializeFullState());
}

function restorePathsFromData(data) {
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
      fillH: d.fillH ?? 0, baseFillH: d.baseFillH ?? 0,
      fillS: d.fillS ?? 0, baseFillS: d.baseFillS ?? 0,
      fillL: d.fillL ?? 0, baseFillL: d.baseFillL ?? 0,
      strokeH: d.strokeH ?? 0, baseStrokeH: d.baseStrokeH ?? 0,
      strokeS: d.strokeS ?? 0, baseStrokeS: d.baseStrokeS ?? 0,
      strokeL: d.strokeL ?? 0, baseStrokeL: d.baseStrokeL ?? 0,
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

function pushHistory() { history.push(snapshotAll()); }

function applyUndo() {
  if (!history.canUndo()) return;
  const prev = history.undo(snapshotAll());
  if (prev) { restoreFullState(JSON.parse(prev)); _afterRestore(); }
}

function applyRedo() {
  if (!history.canRedo()) return;
  const next = history.redo(snapshotAll());
  if (next) { restoreFullState(JSON.parse(next)); _afterRestore(); }
}

function _afterRestore() {
  if (state.selection.pathId && !state.paths.has(state.selection.pathId)) {
    state.selection.pathId   = null;
    state.selection.pathIds  = new Set();
    state.selection.pointIds = new Set();
  }
  renderMultiSelectUI();
  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

// ── Full state save/restore (includes oscillators + bindings) ──

function serializeFullState() {
  return {
    version: '1.1',
    type: 'svg-oscillator-sketch',
    paths: [...state.paths.values()].map(serializePath),
    oscillators: [...oscEngine.oscillators.values()].map(o => ({
      id: o.id, name: o.name, type: o.type, color: o.color, enabled: o.enabled,
      // LFO
      waveform: o.waveform, frequency: o.frequency, amplitude: o.amplitude,
      phase: o.phase, offset: o.offset, curve: o.curve,
      // Step
      stepCount: o.stepCount, stepRate: o.stepRate, stepValues: o.stepValues, stepAmp: o.stepAmp,
      // Random walk
      rwRate: o.rwRate, rwSmooth: o.rwSmooth, rwMin: o.rwMin, rwMax: o.rwMax,
      // Audio
      audioBand: o.audioBand, audioSmooth: o.audioSmooth, audioAmplitude: o.audioAmplitude,
      // Expression
      expression: o.expression,
      // Track
      trackName: o.trackName, trackBand: o.trackBand,
      trackSmooth: o.trackSmooth, trackAmplitude: o.trackAmplitude,
    })),
    bindings: [...bindingSys.bindings.values()].map(b => ({
      id: b.id, oscillatorId: b.oscillatorId, target: b.target, scale: b.scale,
    })),
    viewBox: viewport.svgVB,
  };
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
    fillH: m.fillH, baseFillH: m.baseFillH,
    fillS: m.fillS, baseFillS: m.baseFillS,
    fillL: m.fillL, baseFillL: m.baseFillL,
    strokeH: m.strokeH, baseStrokeH: m.baseStrokeH,
    strokeS: m.strokeS, baseStrokeS: m.baseStrokeS,
    strokeL: m.strokeL, baseStrokeL: m.baseStrokeL,
    selected: m.selected, visible: m.visible,
    mirrorSlaveId: m.mirrorSlaveId, mirrorAxis: m.mirrorAxis,
    points: m.points.map(p => ({
      id: p.id, x: p.x, y: p.y, baseX: p.baseX, baseY: p.baseY, type: p.type,
      handleIn:  p.handleIn  ? { id: p.handleIn.id,  x: p.handleIn.x,  y: p.handleIn.y,  baseX: p.handleIn.baseX,  baseY: p.handleIn.baseY  } : null,
      handleOut: p.handleOut ? { id: p.handleOut.id, x: p.handleOut.x, y: p.handleOut.y, baseX: p.handleOut.baseX, baseY: p.handleOut.baseY } : null,
    })),
  };
}

function restoreFullState(obj) {
  if (obj.paths) restorePathsFromData(obj.paths);
  if (obj.oscillators) {
    oscEngine.oscillators.clear();
    for (const od of obj.oscillators) {
      const osc = oscEngine.add(od);
      osc.id = od.id;
    }
  }
  if (obj.bindings) {
    bindingSys.bindings.clear();
    for (const bd of obj.bindings) {
      const b = bindingSys.add(bd.oscillatorId, bd.target, bd.scale);
      b.id = bd.id;
    }
  }
  if (obj.viewBox) viewport.setViewBox(obj.viewBox);

  state.selection.pathId   = null;
  state.selection.pathIds  = new Set();
  state.selection.pointIds = new Set();
  const hint = document.getElementById('drop-hint');
  if (hint && state.paths.size > 0) hint.classList.add('hidden');

  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

// ── Panels ──────────────────────────────────────────

const oscPanel = new OscillatorPanel(
  document.getElementById('osc-list'),
  oscEngine,
  () => { bindingPanel.render(); }
);

const bindingPanel = new BindingPanel(
  document.getElementById('inspector-binding-wrap'),
  bindingSys,
  oscEngine,
  state.paths,
  state.selection,
  () => { bindingPanel.render(); },
  (target) => {
    state.selection.highlightTarget = target;
    overlay.highlightTarget = target;
  },
);

const inspector = new PathInspector(
  {
    content:    document.getElementById('inspector-content'),
    noSel:      document.getElementById('inspector-no-selection'),
    pathId:     document.getElementById('inspector-path-id'),
    pointCount: document.getElementById('inspector-point-count'),
  },
  state.paths,
  state.selection,
  (pathId) => { inspector.render(); bindingPanel.render(); },
  pushHistory,
);

const dragCtrl = new DragController(
  interactG,
  viewport,
  state.paths,
  state.selection,
  (pathId) => { inspector.render(); },
  pushHistory,
);

// ── Multi-selection inspector UI ─────────────────────

function renderMultiSelectUI() {
  const count = state.selection.pathIds.size;
  const multiEl  = document.getElementById('inspector-multi-sel');
  const singleEl = document.getElementById('inspector-content');
  const noSelEl  = document.getElementById('inspector-no-selection');

  if (count > 1) {
    multiEl.hidden  = false;
    singleEl.hidden = true;
    noSelEl.hidden  = true;
    document.getElementById('multi-sel-label').textContent = `${count} shapes`;
    document.getElementById('inspector-point-detail').hidden = true;
  } else if (count === 1) {
    multiEl.hidden = true;
    // delegate to single-path inspector
  } else {
    multiEl.hidden  = true;
    singleEl.hidden = true;
    noSelEl.hidden  = false;
  }
}

document.getElementById('multi-fill-color').addEventListener('input', (e) => {
  for (const id of state.selection.pathIds) {
    const m = state.paths.get(id);
    if (m && m.fill !== 'none') m.fill = e.target.value;
  }
});

document.getElementById('multi-stroke-color').addEventListener('input', (e) => {
  for (const id of state.selection.pathIds) {
    const m = state.paths.get(id);
    if (m && m.stroke !== 'none') m.stroke = e.target.value;
  }
});

document.getElementById('btn-delete-multi').addEventListener('click', () => {
  if (!state.selection.pathIds.size) return;
  pushHistory();
  for (const id of state.selection.pathIds) state.paths.delete(id);
  clearPathSelection();
  renderMultiSelectUI();
  bindingPanel.render();
});

// ── Motion blur canvas ────────────────────────────────

const mbCanvas = document.getElementById('motion-blur-canvas');
const mbCtx    = mbCanvas ? mbCanvas.getContext('2d') : null;

if (mbCanvas) {
  const ro = new ResizeObserver(() => {
    const r = svgEl.getBoundingClientRect();
    mbCanvas.width  = r.width  || window.innerWidth;
    mbCanvas.height = r.height || window.innerHeight;
    if (mbCtx) { mbCtx.clearRect(0, 0, mbCanvas.width, mbCanvas.height); }
  });
  ro.observe(svgEl);
}

async function renderMotionBlurFrame() {
  if (!mbCtx || !mbCanvas) return;
  const decay = state.ui.motionBlurDecay;
  // Fade previous content
  mbCtx.fillStyle = `rgba(11,11,11,${1 - decay})`;
  mbCtx.fillRect(0, 0, mbCanvas.width, mbCanvas.height);

  // Draw current SVG into canvas
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width',  mbCanvas.width);
  clone.setAttribute('height', mbCanvas.height);
  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob   = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url    = URL.createObjectURL(blob);
  await new Promise(resolve => {
    const img = new Image();
    img.onload = () => { mbCtx.drawImage(img, 0, 0); URL.revokeObjectURL(url); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ── rAF Loop ─────────────────────────────────────────

let lastTime = 0;
let _mbFrameCount = 0;

function tick(timestamp) {
  requestAnimationFrame(tick);
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  if (state.playback.playing) {
    state.playback.globalTime += dt;
    oscEngine.tick(state.playback.globalTime, dt, state.playback.bpm);
    bindingSys.resetToBase(state.paths);
    bindingSys.applyAll(state.paths, oscEngine.oscillators);
    syncMirrorSlaves(state.paths);
    oscPanel.tick(state.playback.globalTime);
  }

  viewport.render(state.paths, state.ui.showWireframe);
  overlay.render(state.paths, state.selection, viewport.zoom);

  // Motion blur: render every other frame to keep perf reasonable
  if (state.ui.motionBlurDecay > 0 && state.playback.playing) {
    _mbFrameCount++;
    if (_mbFrameCount % 2 === 0) renderMotionBlurFrame();
  } else if (mbCtx && state.ui.motionBlurDecay === 0 && _mbFrameCount > 0) {
    // Clear when turned off
    mbCtx.clearRect(0, 0, mbCanvas.width, mbCanvas.height);
    _mbFrameCount = 0;
  }
}

requestAnimationFrame(t => { lastTime = t; requestAnimationFrame(tick); });

// ── Base.svg startup ──────────────────────────────────

async function loadStartupSVG() {
  if (localStorage.getItem('svg-osc-v1')) return; // user has saved state
  try {
    const resp = await fetch('./base.svg');
    if (resp.ok) { loadSVG(await resp.text()); }
  } catch(e) { /* silent fail — no base.svg available */ }
}
loadStartupSVG();

// ── SVG Import ───────────────────────────────────────

function loadSVG(text) {
  let result;
  try { result = parseSVGString(text); }
  catch(e) { alert('Could not parse SVG: ' + e.message); return; }

  state.paths.clear();
  state.selection.pathId   = null;
  state.selection.pathIds  = new Set();
  state.selection.pointIds = new Set();
  bindingSys.bindings.clear();
  history._undo = []; history._redo = [];
  history._updateButtons();

  for (const model of result.paths) {
    inferPointTypes(model);
    state.paths.set(model.id, model);
  }

  viewport.setViewBox(result.viewBox);
  document.getElementById('drop-hint').classList.add('hidden');

  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.readAsText(file);
  reader.onload = ev => {
    const text = ev.target.result;
    if (file.name.endsWith('.osc') || file.name.endsWith('.json')) {
      try { restoreFullState(JSON.parse(text)); }
      catch(e) { alert('Could not load .osc file: ' + e.message); }
    } else {
      loadSVG(text);
    }
  };
}

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});

const dropZone = document.getElementById('canvas-drop-zone');
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

document.getElementById('drop-hint').addEventListener('click', () => fileInput.click());

// ── Path selection helpers ────────────────────────────

function clearPathSelection() {
  for (const id of state.selection.pathIds) {
    const m = state.paths.get(id);
    if (m) m.selected = false;
  }
  state.selection.pathId   = null;
  state.selection.pathIds  = new Set();
  state.selection.pointIds = new Set();
}

// ── Path selection ────────────────────────────────────

svgEl.addEventListener('click', (e) => {
  if (e.target.dataset.role === 'anchor' || e.target.dataset.role === 'handle') return;
  // Ignore if rubber band was active (movement happened)
  if (_rbMoved) return;

  const pathEl = e.target.closest('[data-path-id]');
  if (pathEl) {
    const pathId = pathEl.dataset.pathId;
    if (!pathId) return;
    const model = state.paths.get(pathId);
    if (!model) return;

    if (e.shiftKey) {
      if (state.selection.pathIds.has(pathId)) {
        state.selection.pathIds.delete(pathId);
        model.selected = false;
        state.selection.pathId = [...state.selection.pathIds].at(-1) ?? null;
      } else {
        state.selection.pathIds.add(pathId);
        model.selected = true;
        state.selection.pathId = pathId;
      }
      state.selection.pointIds = new Set();
    } else {
      clearPathSelection();
      state.selection.pathIds.add(pathId);
      state.selection.pathId = pathId;
      model.selected = true;
    }
    renderMultiSelectUI();
    if (state.selection.pathIds.size <= 1) { inspector.render(); }
    bindingPanel.render();
    return;
  }

  if (e.target === svgEl || e.target === contentG ||
      e.target === overlayG || e.target === interactG) {
    if (!e.shiftKey) {
      clearPathSelection();
      renderMultiSelectUI();
      inspector.render();
      bindingPanel.render();
    }
  }
});

// ── Rubber-band selection ─────────────────────────────

const NS_SVG = 'http://www.w3.org/2000/svg';
let _rbRect = null;
let _rbStart = { x: 0, y: 0 };
let _rbMoved = false;

viewport.onBackgroundPointerDown = (e) => {
  if (e.button !== 0) return;
  const pt = viewport.screenToSVG(e.clientX, e.clientY);
  _rbStart = pt;
  _rbMoved = false;
  _rbRect = document.createElementNS(NS_SVG, 'rect');
  _rbRect.classList.add('rubber-band');
  _rbRect.setAttribute('vector-effect', 'non-scaling-stroke');
  interactG.appendChild(_rbRect);
  svgEl.setPointerCapture(e.pointerId);
};

viewport.onBackgroundPointerMove = (e) => {
  if (!_rbRect) return;
  _rbMoved = true;
  const pt = viewport.screenToSVG(e.clientX, e.clientY);
  const x = Math.min(pt.x, _rbStart.x);
  const y = Math.min(pt.y, _rbStart.y);
  const w = Math.abs(pt.x - _rbStart.x);
  const h = Math.abs(pt.y - _rbStart.y);
  _rbRect.setAttribute('x', x);
  _rbRect.setAttribute('y', y);
  _rbRect.setAttribute('width',  w);
  _rbRect.setAttribute('height', h);
};

viewport.onBackgroundPointerUp = (e) => {
  if (!_rbRect) return;
  const rx = parseFloat(_rbRect.getAttribute('x'));
  const ry = parseFloat(_rbRect.getAttribute('y'));
  const rw = parseFloat(_rbRect.getAttribute('width'));
  const rh = parseFloat(_rbRect.getAttribute('height'));
  _rbRect.remove();
  _rbRect = null;

  if (_rbMoved && rw > 2 && rh > 2) {
    if (!e.shiftKey) clearPathSelection();
    for (const [id, model] of state.paths) {
      const bb = model.getBoundingBox();
      if (bb.x + bb.w >= rx && bb.x <= rx + rw &&
          bb.y + bb.h >= ry && bb.y <= ry + rh) {
        state.selection.pathIds.add(id);
        model.selected = true;
        state.selection.pathId = id;
      }
    }
    renderMultiSelectUI();
    if (state.selection.pathIds.size <= 1) inspector.render();
    bindingPanel.render();
  }
};

// Space key → pan mode
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) {
    viewport.spaceDown = true;
    svgEl.style.cursor = 'grab';
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    viewport.spaceDown = false;
    svgEl.style.cursor = '';
  }
});

// ── Toolbar ───────────────────────────────────────────

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

document.getElementById('motion-blur-slider').addEventListener('input', (e) => {
  state.ui.motionBlurDecay = parseFloat(e.target.value);
  if (mbCanvas) mbCanvas.style.display = state.ui.motionBlurDecay > 0 ? 'block' : 'none';
});

function startPlayback() {
  state.playback.playing = true;
  document.getElementById('btn-play').classList.add('active');
  // Start any track oscillators from current global time
  for (const osc of oscEngine.oscillators.values()) {
    if (osc.type === 'track' && osc.trackBuffer) {
      osc.playTrack(state.playback.globalTime);
    }
  }
}

function stopPlayback() {
  state.playback.playing = false;
  document.getElementById('btn-play').classList.remove('active');
  bindingSys.resetToBase(state.paths);
  for (const osc of oscEngine.oscillators.values()) {
    if (osc.type === 'track') osc.stopTrack();
  }
}

document.getElementById('btn-play').addEventListener('click', startPlayback);
document.getElementById('btn-stop').addEventListener('click', stopPlayback);

document.getElementById('bpm-input').addEventListener('input', (e) => {
  state.playback.bpm = parseFloat(e.target.value) || 120;
});

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  const rect = svgEl.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2, f = 1.25;
  viewport.panX = cx - (cx - viewport.panX) * f;
  viewport.panY = cy - (cy - viewport.panY) * f;
  viewport.zoom = Math.min(100, viewport.zoom * f);
  viewport._updateViewBox();
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  const rect = svgEl.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2, f = 1 / 1.25;
  viewport.panX = cx - (cx - viewport.panX) * f;
  viewport.panY = cy - (cy - viewport.panY) * f;
  viewport.zoom = Math.max(0.02, viewport.zoom * f);
  viewport._updateViewBox();
});

document.getElementById('btn-zoom-fit').addEventListener('click', () => viewport.fitToView());
document.getElementById('btn-undo').addEventListener('click', applyUndo);
document.getElementById('btn-redo').addEventListener('click', applyRedo);

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  const cmd = e.metaKey || e.ctrlKey;

  if (cmd) {
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); applyUndo(); }
    if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); applyRedo(); }
    if (e.key === 'y')                 { e.preventDefault(); applyRedo(); }
    return;
  }

  // Space — toggle play / stop (also used as pan modifier — keydown above sets spaceDown)
  if (e.key === ' ') {
    e.preventDefault();
    if (state.playback.playing) stopPlayback(); else startPlayback();
    return;
  }

  // H or F — fit view
  if (e.key === 'h' || e.key === 'H' || e.key === 'f' || e.key === 'F') {
    viewport.fitToView();
    return;
  }

  // Delete / Backspace — remove selected points or selected shapes
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (state.selection.pointIds.size > 0 && state.selection.pathId) {
      // Remove selected points from primary path
      const model = state.paths.get(state.selection.pathId);
      if (model) {
        pushHistory();
        model.points = model.points.filter(pt => !state.selection.pointIds.has(pt.id));
        state.selection.pointIds = new Set();
        inspector.render();
        bindingPanel.render();
      }
    } else if (state.selection.pathIds.size > 0) {
      // Delete all selected paths (no confirm)
      pushHistory();
      for (const id of state.selection.pathIds) state.paths.delete(id);
      clearPathSelection();
      inspector.render();
      bindingPanel.render();
    }
  }
});

document.getElementById('add-osc-btn').addEventListener('click', () => {
  oscEngine.add({ name: `LFO ${oscEngine.oscillators.size + 1}` });
  oscPanel.render();
  bindingPanel.render();
});

// ── Save / Load (localStorage) ───────────────────────

document.getElementById('btn-save-local').addEventListener('click', () => {
  const btn = document.getElementById('btn-save-local');
  try {
    localStorage.setItem('svg-osc-v1', JSON.stringify(serializeFullState()));
    btn.textContent = '✓ SAVED';
    setTimeout(() => { btn.textContent = 'SAVE'; }, 1500);
  } catch(e) {
    alert('Save failed: ' + e.message);
  }
});

document.getElementById('btn-load-local').addEventListener('click', () => {
  const raw = localStorage.getItem('svg-osc-v1');
  if (!raw) { alert('No saved state found in browser storage.'); return; }
  try {
    restoreFullState(JSON.parse(raw));
  } catch(e) {
    alert('Load failed: ' + e.message);
  }
});

// ── Export ───────────────────────────────────────────

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
    if (action === 'export-state') exportStateJSON();
    if (action === 'export-osc')   exportOSC();
    if (action === 'export-anim')  openAnimDialog();
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
      if (!osc || osc.type !== 'lfo') continue;
      const dur   = (1 / osc.frequency).toFixed(3);
      const FRAMES = 60;
      const vals  = [];
      for (let i = 0; i <= FRAMES; i++) {
        osc._tickLFO(i / FRAMES / osc.frequency);
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

function exportStateJSON() {
  downloadText(JSON.stringify(serializeFullState(), null, 2), 'svg-osc-state.json', 'application/json');
}

function exportOSC() {
  const data = serializeFullState();
  data.timestamp = new Date().toISOString();
  downloadText(JSON.stringify(data, null, 2), 'sketch.osc', 'application/json');
}

// ── Animation export ─────────────────────────────────

function openAnimDialog() {
  document.getElementById('export-anim-dialog').classList.remove('hidden');
}

document.getElementById('exp-cancel-btn').addEventListener('click', () => {
  document.getElementById('export-anim-dialog').classList.add('hidden');
});

document.getElementById('exp-start-btn').addEventListener('click', async () => {
  const format   = document.getElementById('exp-format').value;
  const fps      = parseInt(document.getElementById('exp-fps').value, 10) || 30;
  const duration = parseFloat(document.getElementById('exp-duration').value) || 3;
  const width    = parseInt(document.getElementById('exp-width').value, 10)  || 1920;
  const height   = parseInt(document.getElementById('exp-height').value, 10) || 1080;

  const startBtn = document.getElementById('exp-start-btn');
  const prog     = document.getElementById('exp-progress');
  startBtn.disabled = true;
  prog.textContent  = 'Preparing…';

  try {
    await runAnimExport(format, fps, duration, width, height, (msg) => { prog.textContent = msg; });
    prog.textContent = '✓ Done!';
  } catch(e) {
    prog.textContent = 'Error: ' + e.message;
    console.error(e);
  }

  startBtn.disabled = false;
  setTimeout(() => {
    prog.textContent = '';
    document.getElementById('export-anim-dialog').classList.add('hidden');
  }, 2000);
});

async function runAnimExport(format, fps, durationSec, width, height, onProgress) {
  const totalFrames = Math.round(durationSec * fps);
  const dt          = 1 / fps;

  // Offscreen canvas at target resolution
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Save current playback state
  const savedTime    = state.playback.globalTime;
  const savedPlaying = state.playback.playing;
  state.playback.playing = false;

  // Compute SVG element's current display rect for aspect-correct scaling
  const svgRect = svgEl.getBoundingClientRect();
  const scaleX  = width  / (svgRect.width  || width);
  const scaleY  = height / (svgRect.height || height);

  if (format === 'webm') {
    const stream   = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(100);

    for (let f = 0; f < totalFrames; f++) {
      state.playback.globalTime = f * dt;
      oscEngine.tick(f * dt, dt, state.playback.bpm);
      bindingSys.resetToBase(state.paths);
      bindingSys.applyAll(state.paths, oscEngine.oscillators);
      syncMirrorSlaves(state.paths);
      viewport.render(state.paths, state.ui.showWireframe);

      await svgToCanvas(svgEl, canvas, ctx, scaleX, scaleY);
      onProgress(`Encoding frame ${f + 1} / ${totalFrames}`);
      await yieldFrame();
    }

    recorder.stop();
    await new Promise(r => recorder.onstop = r);
    downloadBlob(new Blob(chunks, { type: mimeType }), 'animation.webm');

  } else {
    // PNG sequence → JSZip
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('JSZip not loaded. Check CDN connection.');
    const zip = new JSZip();

    for (let f = 0; f < totalFrames; f++) {
      state.playback.globalTime = f * dt;
      oscEngine.tick(f * dt, dt, state.playback.bpm);
      bindingSys.resetToBase(state.paths);
      bindingSys.applyAll(state.paths, oscEngine.oscillators);
      syncMirrorSlaves(state.paths);
      viewport.render(state.paths, state.ui.showWireframe);

      await svgToCanvas(svgEl, canvas, ctx, scaleX, scaleY);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      zip.file(`frame_${String(f).padStart(5, '0')}.png`, blob);
      onProgress(`Processing frame ${f + 1} / ${totalFrames}`);
      await yieldFrame();
    }

    onProgress('Compressing ZIP…');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, meta => {
      onProgress(`Compressing: ${meta.percent.toFixed(0)}%`);
    });
    downloadBlob(zipBlob, 'animation_frames.zip');
  }

  // Restore playback state
  state.playback.globalTime = savedTime;
  state.playback.playing    = savedPlaying;
}

async function svgToCanvas(svgEl, canvas, ctx, scaleX, scaleY) {
  // Clone SVG, set explicit size so it renders correctly
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width',  canvas.width);
  clone.setAttribute('height', canvas.height);

  const svgStr  = new XMLSerializer().serializeToString(clone);
  const blob    = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url     = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#0b0b0b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

function yieldFrame() {
  return new Promise(r => setTimeout(r, 0));
}

// ── Panel resizers ────────────────────────────────────

function initResizer(resizerId, panelId, cssVar, minW, maxW, side) {
  const resizer = document.getElementById(resizerId);
  const panel   = document.getElementById(panelId);
  let dragging = false;
  let startX = 0, startW = 0;

  resizer.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    e.preventDefault();
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx  = side === 'right' ? startX - e.clientX : e.clientX - startX;
    const newW = Math.max(minW, Math.min(maxW, startW + dx));
    panel.style.width = newW + 'px';
    document.documentElement.style.setProperty(cssVar, newW + 'px');
  });
  resizer.addEventListener('pointerup', () => {
    dragging = false;
    resizer.classList.remove('dragging');
  });
}

initResizer('left-resizer',  'osc-panel',       '--panel-l', 140, 520, 'left');
initResizer('right-resizer', 'inspector-panel',  '--panel-r', 160, 560, 'right');

// ── Download helpers ──────────────────────────────────

function downloadText(text, filename, mime) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}
