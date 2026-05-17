// main.js — SVG Oscillator Editor bootstrap

import { parseSVGString }   from './modules/SVGParser.js';
import { CanvasViewport }   from './modules/CanvasViewport.js';
import { PointOverlay }     from './modules/PointOverlay.js';
import { OscillatorEngine } from './modules/OscillatorEngine.js';
import { BindingSystem }    from './modules/BindingSystem.js';
import { DragController, syncMirrorSlaves, inferPointTypes } from './modules/PathOperations.js';
import { History }          from './modules/History.js';
import { serializeFullState, deserializePaths, getSaves, persistSaves, autosave, loadAutosave } from './modules/Sketch.js';
import { OscillatorPanel }  from './panels/OscillatorPanel.js';
import { BindingPanel }     from './panels/BindingPanel.js';
import { PathInspector }    from './panels/PathInspector.js';
import { BoxSlider }        from './components/BoxSlider.js';

// ────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────
const state = {
  paths:     new Map(),
  selection: { pathId: null, pathIds: new Set(), pointIds: new Set(), highlightTarget: null },
  playback:  { playing: false, bpm: 120, globalTime: 0 },
  ui:        { showAnchors: true, showHandles: true, showWireframe: false },
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
  return JSON.stringify(serializeCurrentState());
}

function restorePathsFromData(data) {
  state.paths.clear();
  for (const [id, m] of deserializePaths(data)) state.paths.set(id, m);
}

let _autoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    autosave(serializeCurrentState());
  }, 1500);
}

function pushHistory() {
  history.push(snapshotAll());
  scheduleAutoSave();
}

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

// ── Full state serialization — delegates to Sketch.js pure helpers ──

function serializeCurrentState() {
  return serializeFullState(state.paths, oscEngine, bindingSys, viewport);
}

function stopAllTracks() {
  for (const osc of oscEngine.oscillators.values()) {
    if (osc.type === 'track') osc.stopTrack?.();
    if (osc.type === 'phone') osc.stopDevice?.();
  }
}

function restoreFullState(obj) {
  stopAllTracks();
  if (obj.paths) restorePathsFromData(obj.paths);
  if (obj.oscillators) {
    oscEngine.oscillators.clear();
    for (const od of obj.oscillators) {
      const osc = oscEngine.add(od);
      // Re-register under the original id (add() uses a new random uid)
      oscEngine.oscillators.delete(osc.id);
      osc.id = od.id;
      oscEngine.oscillators.set(osc.id, osc);
    }
  }
  if (obj.bindings) {
    bindingSys.clear();
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
  () => { bindingPanel.render(); },
  pushHistory
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
  pushHistory,
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
  (pathId) => { inspector.render(); bindingPanel.render(); },
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

// Multi-select fill opacity + stroke width sliders
const _multiFillOpSlider = new BoxSlider(document.getElementById('multi-fill-opacity-wrap'), {
  label: '', unit: '', min: 0, max: 1, step: 0, value: 1, color: '#7b72ff',
  onChange: v => {
    for (const id of state.selection.pathIds) {
      const m = state.paths.get(id);
      if (m) { m.fillOpacity = v; m.baseFillOpacity = v; }
    }
  },
});
const _multiStrokeWSlider = new BoxSlider(document.getElementById('multi-stroke-width-wrap'), {
  label: '', unit: '', min: 0, max: 20, step: 0, value: 1, color: '#7b72ff',
  onChange: v => {
    for (const id of state.selection.pathIds) {
      const m = state.paths.get(id);
      if (m) { m.strokeWidth = v; m.baseStrokeWidth = v; }
    }
  },
});
const _multiStrokeOpSlider = new BoxSlider(document.getElementById('multi-stroke-opacity-wrap'), {
  label: '', unit: '', min: 0, max: 1, step: 0, value: 1, color: '#7b72ff',
  onChange: v => {
    for (const id of state.selection.pathIds) {
      const m = state.paths.get(id);
      if (m) { m.strokeOpacity = v; m.baseStrokeOpacity = v; }
    }
  },
});

document.getElementById('btn-delete-multi').addEventListener('click', () => {
  if (!state.selection.pathIds.size) return;
  pushHistory();
  for (const id of state.selection.pathIds) state.paths.delete(id);
  clearPathSelection();
  renderMultiSelectUI();
  bindingPanel.render();
});

// Multi-select fill/stroke/both mode buttons
function _applyModeToSelection(fillVal, strokeVal) {
  pushHistory();
  for (const id of state.selection.pathIds) {
    const m = state.paths.get(id);
    if (!m) continue;
    if (fillVal !== null)   m.fill   = fillVal   === 'keep' ? (m.fill   !== 'none' ? m.fill   : '#ffffff') : fillVal;
    if (strokeVal !== null) m.stroke = strokeVal === 'keep' ? (m.stroke !== 'none' ? m.stroke : '#ffffff') : strokeVal;
  }
}
document.getElementById('btn-multi-mode-fill').addEventListener('click', () => {
  _applyModeToSelection('keep', 'none');
});
document.getElementById('btn-multi-mode-stroke').addEventListener('click', () => {
  _applyModeToSelection('none', 'keep');
});
document.getElementById('btn-multi-mode-both').addEventListener('click', () => {
  _applyModeToSelection('keep', 'keep');
});

// Cycle binding point indices ±1 for selected path
document.getElementById('btn-cycle-pts-back').addEventListener('click', () => {
  const pathId = state.selection.pathId;
  const model  = state.paths.get(pathId);
  if (!model) return;
  pushHistory();
  bindingSys.cyclePointIndices(pathId, -1, model.points.length);
  bindingPanel.render();
});
document.getElementById('btn-cycle-pts-fwd').addEventListener('click', () => {
  const pathId = state.selection.pathId;
  const model  = state.paths.get(pathId);
  if (!model) return;
  pushHistory();
  bindingSys.cyclePointIndices(pathId, 1, model.points.length);
  bindingPanel.render();
});

// ── rAF Loop ─────────────────────────────────────────

let lastTime = 0;

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
  } else {
    // Always update device/phone sensors so the live display works when stopped
    for (const osc of oscEngine.oscillators.values()) {
      if (osc.enabled && (osc.type === 'device' || osc.type === 'phone')) osc._tickDevice(dt);
    }
  }

  // Always tick panel so track/walk/device visualizers animate even when stopped
  oscPanel.tick(state.playback.globalTime, state.playback.playing);

  viewport.render(state.paths, state.ui.showWireframe);
  overlay.render(state.paths, state.selection, viewport.zoom);
}

requestAnimationFrame(t => { lastTime = t; requestAnimationFrame(tick); });

// ── Dynamic folder scanning ───────────────────────────
// Reads a directory listing served by any static HTTP server
// (Python http.server, nginx, Apache autoindex, etc.)

const BUILT_IN_SHAPES = {
  circle:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><circle cx="250" cy="250" r="200" fill="#ffffff" stroke="none"/></svg>`,
  square:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><rect x="75" y="75" width="350" height="350" fill="#ffffff" stroke="none"/></svg>`,
  triangle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><polygon points="250,50 475,450 25,450" fill="#ffffff" stroke="none"/></svg>`,
};

async function fetchFolderFiles(folderPath, ext) {
  try {
    const resp = await fetch(folderPath);
    if (!resp.ok) return [];
    const html = await resp.text();
    // Must look like an HTML directory listing
    if (!html.toLowerCase().includes('<html')) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const raw = decodeURIComponent(a.getAttribute('href') || '');
      // Strip trailing slash (dirs) and any path prefix — keep just the filename
      const filename = raw.replace(/\/$/, '').split('/').pop();
      if (!filename || !filename.toLowerCase().endsWith(ext)) continue;
      results.push({
        name: filename.slice(0, -ext.length),
        file: folderPath.replace(/\/$/, '') + '/' + filename,
      });
    }
    return results;
  } catch { return []; }
}

async function fetchLibraryJsonFiles(kind) {
  try {
    const resp = await fetch('./library.json');
    if (!resp.ok) return [];
    const lib  = await resp.json();
    const key  = kind === 'svg' ? 'svgs' : 'sketches';
    return (lib[key] || []).map(e => ({ name: e.name, file: e.file }));
  } catch { return []; }
}

async function openLibraryFile(file, kind) {
  try {
    const resp = await fetch(file.startsWith('./') ? file : './' + file);
    if (!resp.ok) throw new Error(resp.status);
    const text = await resp.text();
    if (kind === 'osc') restoreFullState(JSON.parse(text));
    else loadSVG(text);
  } catch(e) { alert('Could not open ' + file + ': ' + e.message); }
}

// CLEAR button
document.getElementById('btn-clear-canvas').addEventListener('click', () => {
  const hasContent = state.paths.size > 0 || oscEngine.oscillators.size > 0;
  if (!hasContent || confirm('Clear the canvas?')) newCanvas();
});

function newCanvas() {
  pushHistory();
  state.paths.clear();
  oscEngine.oscillators.clear();
  bindingSys.clear();
  state.selection = { pathId: null, pathIds: new Set(), pointIds: new Set(), highlightTarget: null };
  history.clear();
  viewport.setViewBox({ x: 0, y: 0, w: 500, h: 500 });
  document.getElementById('drop-hint').classList.remove('hidden');
  inspector.render();
  bindingPanel.render();
  oscPanel.render();
}

// ── Auto-save on page hide (iOS switches app → page stays alive but hidden) ──
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave(serializeCurrentState());
});
window.addEventListener('beforeunload', () => {
  autosave(serializeCurrentState());
});

// ── Startup ───────────────────────────────────────────

async function startup() {
  await new Promise(r => requestAnimationFrame(r));
  // Restore last autosave if present
  try {
    const saved = loadAutosave();
    if (saved) { restoreFullState(saved); return; }
  } catch {}
  // Load starter sketch and begin playing
  try {
    const resp = await fetch('./sketches/starter.osc');
    if (resp.ok) {
      restoreFullState(JSON.parse(await resp.text()));
      startPlayback();
      return;
    }
  } catch {}
}
startup();

// ── SVG Import ───────────────────────────────────────

function loadSVG(text) {
  let result;
  try { result = parseSVGString(text); }
  catch(e) { alert('Could not parse SVG: ' + e.message); return; }

  state.paths.clear();
  state.selection.pathId   = null;
  state.selection.pathIds  = new Set();
  state.selection.pointIds = new Set();
  bindingSys.clear();
  history.clear();

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
  // Consume _rbMoved: ignore this click if a drag just ended, but always reset the flag
  const wasDrag = _rbMoved;
  _rbMoved = false;
  if (wasDrag) return;

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
        // Remove points of deselected path
        for (const pt of model.points) state.selection.pointIds.delete(pt.id);
      } else {
        state.selection.pathIds.add(pathId);
        model.selected = true;
        state.selection.pathId = pathId;
        // Add all points of newly selected path
        for (const pt of model.points) state.selection.pointIds.add(pt.id);
      }
    } else {
      clearPathSelection();
      state.selection.pathIds.add(pathId);
      state.selection.pathId = pathId;
      model.selected = true;
      // Select all points of clicked path
      state.selection.pointIds = new Set(model.points.map(p => p.id));
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
        // Select all points of matched path
        for (const pt of model.points) state.selection.pointIds.add(pt.id);
      }
    }
    renderMultiSelectUI();
    if (state.selection.pathIds.size <= 1) inspector.render();
    bindingPanel.render();
  }
};

// Alt/Option key → pan mode (Space still only toggles play)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) {
    e.preventDefault(); // prevent browser Alt-menu activation
    viewport.spaceDown = true;
    svgEl.style.cursor = 'grab';
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') {
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


function startPlayback() {
  state.playback.playing = true;
  const btn = document.getElementById('btn-play');
  btn.classList.add('active');
  btn.textContent = '■ STOP';
  for (const osc of oscEngine.oscillators.values()) {
    if (osc.type === 'track' && osc.trackBuffer) osc.playTrack(state.playback.globalTime);
  }
}

function stopPlayback() {
  state.playback.playing = false;
  const btn = document.getElementById('btn-play');
  btn.classList.remove('active');
  btn.textContent = '▶ PLAY';
  for (const osc of oscEngine.oscillators.values()) {
    if (osc.type === 'track') osc.stopTrack();
  }
}

document.getElementById('btn-play').addEventListener('click', () => {
  if (state.playback.playing) stopPlayback(); else startPlayback();
});

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
    if (e.key === 's')                 { e.preventDefault(); saveSketch(); }
    return;
  }

  // S — quick save sketch
  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    saveSketch();
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
  oscEngine.add({ name: `Mod ${oscEngine.oscillators.size + 1}` });
  oscPanel.render();
  bindingPanel.render();
});

// ── Save / Load history ───────────────────────────────
// getSaves / persistSaves / autosave / loadAutosave imported from modules/Sketch.js

function saveSketch(name) {
  const saves = getSaves();
  const ts    = Date.now();
  const label = name || new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  saves.unshift({ name: label, ts, data: serializeCurrentState() });
  if (saves.length > 10) saves.length = 10;
  if (!persistSaves(saves)) { alert('Save failed: localStorage quota exceeded'); return; }
  const btn = document.getElementById('btn-save-local');
  if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = 'SAVE'; }, 1000); }
  _rebuildHistoryList();
}

function _rebuildHistoryList() {
  const histEl = document.getElementById('load-history-list');
  if (!histEl) return;
  const saves = getSaves();
  histEl.innerHTML = '';
  if (!saves.length) {
    histEl.innerHTML = '<span class="dropdown-empty">No saves yet</span>';
    return;
  }
  for (const s of saves) {
    const row = document.createElement('div');
    row.className = 'save-row';

    const btn = document.createElement('button');
    btn.className = 'save-row-btn';
    btn.textContent = s.name;
    btn.title = new Date(s.ts).toLocaleString();
    btn.addEventListener('click', () => {
      document.getElementById('load-btn').closest('.dropdown').classList.remove('open');
      try { restoreFullState(s.data); } catch(e) { alert('Load failed'); }
    });

    const del = document.createElement('button');
    del.className = 'save-row-del';
    del.textContent = '×';
    del.title = 'Remove this save';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      persistSaves(getSaves().filter(x => x.ts !== s.ts));
      _rebuildHistoryList();
    });

    row.appendChild(btn);
    row.appendChild(del);
    histEl.appendChild(row);
  }
}

async function rebuildLoadMenu() {
  _rebuildHistoryList();

  // Shapes — built-ins + scan svg-library/ (fallback: library.json)
  const shapesEl = document.getElementById('load-shapes-list');
  if (shapesEl) {
    shapesEl.innerHTML = '';
    for (const [shape, label] of [['circle','Circle'],['square','Square'],['triangle','Triangle']]) {
      const btn = document.createElement('button');
      btn.textContent = label; btn.dataset.shape = shape;
      shapesEl.appendChild(btn);
    }
    const placeholder = document.createElement('span');
    placeholder.className = 'dropdown-empty'; placeholder.textContent = '…';
    shapesEl.appendChild(placeholder);
    let svgFiles = await fetchFolderFiles('./svg-library/', '.svg');
    if (!svgFiles.length) svgFiles = await fetchLibraryJsonFiles('svg');
    placeholder.remove();
    for (const f of svgFiles) {
      if (f.name === 'base-shapes') continue;
      const btn = document.createElement('button');
      btn.textContent = f.name; btn.dataset.file = f.file;
      shapesEl.appendChild(btn);
    }
  }

  // Sketches — scan sketches/ (fallback: library.json)
  const sketchesEl = document.getElementById('load-sketches-list');
  if (sketchesEl) {
    sketchesEl.innerHTML = '<span class="dropdown-empty">…</span>';
    let oscFiles = await fetchFolderFiles('./sketches/', '.osc');
    if (!oscFiles.length) oscFiles = await fetchLibraryJsonFiles('sketches');
    sketchesEl.innerHTML = '';
    if (!oscFiles.length) {
      sketchesEl.innerHTML = '<span class="dropdown-empty">No sketches yet</span>';
    } else {
      for (const f of oscFiles) {
        const btn = document.createElement('button');
        btn.textContent = f.name; btn.dataset.file = f.file; btn.dataset.kind = 'osc';
        sketchesEl.appendChild(btn);
      }
    }
  }
}

document.getElementById('btn-save-local').addEventListener('click', () => saveSketch());

// Load dropdown toggle — trigger async scan each time
document.getElementById('load-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('load-btn').closest('.dropdown');
  const opening = !dropdown.classList.contains('open');
  dropdown.classList.toggle('open');
  if (opening) rebuildLoadMenu();
});

// Load menu: shapes column (library SVGs + built-in shapes)
document.getElementById('load-shapes-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.getElementById('load-btn').closest('.dropdown').classList.remove('open');
  if (btn.dataset.file) {
    openLibraryFile(btn.dataset.file, 'svg');
  } else if (btn.dataset.shape) {
    const svg = BUILT_IN_SHAPES[btn.dataset.shape];
    if (svg) loadSVG(svg);
  }
});

document.getElementById('load-sketches-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-file]');
  if (!btn) return;
  document.getElementById('load-btn').closest('.dropdown').classList.remove('open');
  openLibraryFile(btn.dataset.file, 'osc');
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
    if (action === 'export-svg')    exportStaticSVG();
    if (action === 'export-osc')    exportOSC();
    if (action === 'export-lottie') openLottieDialog();
    if (action === 'export-anim')   openAnimDialog();
  });
});

function showExportEmptyToast() {
  let t = document.getElementById('export-empty-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'export-empty-toast';
    t.className = 'export-toast';
    t.textContent = 'Nothing to export — import an SVG first';
    document.body.appendChild(t);
  }
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}

function exportStaticSVG() {
  if (state.paths.size === 0) { showExportEmptyToast(); return; }
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
    p.setAttribute('stroke-opacity', model.strokeOpacity ?? 1);
    const t = model.toTransformString();
    if (t) p.setAttribute('transform', t);
    svgDoc.appendChild(p);
  }
  downloadText(new XMLSerializer().serializeToString(svgDoc), 'export.svg', 'image/svg+xml');
}

function exportOSC() {
  if (state.paths.size === 0) { showExportEmptyToast(); return; }
  const data = serializeCurrentState();
  data.timestamp = new Date().toISOString();
  downloadText(JSON.stringify(data, null, 2), 'sketch.osc', 'application/json');
}

function openLottieDialog() {
  if (state.paths.size === 0) { showExportEmptyToast(); return; }
  document.getElementById('export-lottie-dialog').classList.remove('hidden');
}

document.getElementById('lottie-cancel-btn').addEventListener('click', () => {
  document.getElementById('export-lottie-dialog').classList.add('hidden');
});

document.getElementById('lottie-start-btn').addEventListener('click', () => {
  const fps         = parseInt(document.getElementById('lottie-fps').value, 10) || 30;
  const durationSec = parseFloat(document.getElementById('lottie-duration').value) || 4;
  const showPts     = document.getElementById('lottie-show-points').checked;
  document.getElementById('export-lottie-dialog').classList.add('hidden');
  runLottieExport(fps, durationSec, showPts);
});

function runLottieExport(fps, durationSec, showPoints) {
  const totalFrames = Math.round(fps * durationSec);
  const dt  = 1 / fps;
  const vb  = viewport.svgVB;
  const W   = Math.round(vb.w);
  const H   = Math.round(vb.h);

  const lottie = {
    v: '5.9.0', fr: fps, ip: 0, op: totalFrames,
    w: W, h: H,
    nm: 'SVG Oscillator Export',
    ddd: 0, assets: [], layers: [],
  };

  // Sample every frame so the animation plays at full fidelity
  const sampleEvery = 1;
  const numSamples  = totalFrames + 1;

  // Save current playback state
  const savedTime    = state.playback.globalTime;
  const savedPlaying = state.playback.playing;
  state.playback.playing = false;

  const pathData = new Map();
  for (const id of state.paths.keys()) {
    pathData.set(id, { tx:[], ty:[], rot:[], sX:[], sY:[], fO:[], fill:null, stroke:null });
  }

  for (let f = 0; f < numSamples; f++) {
    const t = f * dt;
    oscEngine.tick(t, dt, state.playback.bpm);
    bindingSys.resetToBase(state.paths);
    bindingSys.applyAll(state.paths, oscEngine.oscillators);
    for (const [id, m] of state.paths) {
      const pd = pathData.get(id);
      pd.tx.push(m.tx); pd.ty.push(m.ty);
      pd.rot.push(m.rotation);
      pd.sX.push(m.scaleX); pd.sY.push(m.scaleY);
      pd.fO.push(m.fillOpacity);
      if (pd.fill === null) { pd.fill = m.fill; pd.stroke = m.stroke; }
    }
  }

  state.playback.globalTime = savedTime;
  state.playback.playing    = savedPlaying;
  bindingSys.resetToBase(state.paths);
  bindingSys.applyAll(state.paths, oscEngine.oscillators);

  function hexToLottieRgb(hex) {
    if (!hex || hex === 'none') return [1, 1, 1];
    const r = parseInt(hex.slice(1,3), 16) / 255;
    const g = parseInt(hex.slice(3,5), 16) / 255;
    const b = parseInt(hex.slice(5,7), 16) / 255;
    return [r, g, b];
  }

  // Modern Lottie keyframe format: just {t, s} per keyframe.
  // The renderer linearly interpolates between consecutive keyframes.
  function buildKfs(values, mapFn) {
    const kfs = [];
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const s = mapFn(values[i], i);
      // Skip keyframes that are identical to the previous one (compact output)
      if (prev !== null && _arrEq(prev, s) && i !== values.length - 1) continue;
      kfs.push({ t: i * sampleEvery, s });
      prev = s;
    }
    if (kfs.length < 2) {
      // Static — emit a second keyframe so renderers detect "animated" properly
      kfs.push({ t: totalFrames, s: kfs[0]?.s ?? [0] });
    }
    return kfs;
  }

  let layerIndex = 1;
  for (const [id, m] of state.paths) {
    if (!m.visible) continue;
    const pd = pathData.get(id);
    const [fr, fg, fb] = hexToLottieRgb(pd.fill);

    const posKfs = buildKfs(pd.tx, (tx, i) => [tx, pd.ty[i], 0]);
    const rotKfs = buildKfs(pd.rot, v => [v]);
    const scKfs  = buildKfs(pd.sX,  (sx, i) => [sx * 100, pd.sY[i] * 100, 100]);
    const opKfs  = buildKfs(pd.fO,  v => [v * 100]);

    const bezier = _modelToLottieBezier(m, vb);

    const layer = {
      ddd: 0, ind: layerIndex++, ty: 4, nm: id, sr: 1,
      ks: {
        o: { a: 1, k: opKfs },
        r: { a: 1, k: rotKfs },
        p: { a: 1, k: posKfs },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: scKfs },
      },
      ao: 0, ip: 0, op: totalFrames, st: 0, bm: 0,
      shapes: [
        { ty: 'gr', nm: 'Shape', it: [
          { ty: 'sh', nm: 'Path', ks: { a: 0, k: bezier } },
          { ty: 'fl', nm: 'Fill', o: { a: 0, k: 100 }, c: { a: 0, k: [fr, fg, fb, 1] }, r: 1 },
          { ty: 'tr', p: { a:0, k:[0,0] }, a: { a:0, k:[0,0] }, s: { a:0, k:[100,100] }, r: { a:0, k:0 }, o: { a:0, k:100 } },
        ]},
      ],
    };
    lottie.layers.push(layer);
  }

  downloadText(JSON.stringify(lottie), 'animation.json', 'application/json');
}

function _arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

function _modelToLottieBezier(model, vb) {
  const pts = model.points;
  if (!pts.length) return { i: [], o: [], v: [], c: false };
  const v = [], i = [], o = [];
  for (const pt of pts) {
    // Vertices in composition space (SVG coords offset by viewBox origin)
    v.push([pt.baseX - vb.x, pt.baseY - vb.y]);
    // Handles relative to their vertex
    i.push(pt.handleIn  ? [pt.handleIn.baseX  - pt.baseX, pt.handleIn.baseY  - pt.baseY] : [0, 0]);
    o.push(pt.handleOut ? [pt.handleOut.baseX - pt.baseX, pt.handleOut.baseY - pt.baseY] : [0, 0]);
  }
  return { v, i, o, c: model.closed };
}

// ── Animation export ─────────────────────────────────

function openAnimDialog() {
  if (state.paths.size === 0) { showExportEmptyToast(); return; }
  document.getElementById('export-anim-dialog').classList.remove('hidden');
}

document.getElementById('exp-cancel-btn').addEventListener('click', () => {
  document.getElementById('export-anim-dialog').classList.add('hidden');
});

document.getElementById('exp-start-btn').addEventListener('click', async () => {
  const format    = document.getElementById('exp-format').value;
  const fps       = parseInt(document.getElementById('exp-fps').value, 10) || 30;
  const duration  = parseFloat(document.getElementById('exp-duration').value) || 3;
  const width     = parseInt(document.getElementById('exp-width').value, 10)  || 1920;
  const height    = parseInt(document.getElementById('exp-height').value, 10) || 1080;
  const showPts   = document.getElementById('exp-show-points').checked;

  const startBtn = document.getElementById('exp-start-btn');
  const prog     = document.getElementById('exp-progress');
  startBtn.disabled = true;
  prog.textContent  = 'Preparing…';

  try {
    await runAnimExport(format, fps, duration, width, height, showPts, (msg) => { prog.textContent = msg; });
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

async function runAnimExport(format, fps, durationSec, width, height, showPoints, onProgress) {
  const totalFrames = Math.round(durationSec * fps);
  const dt          = 1 / fps;

  // Offscreen canvas at target resolution
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { alert('Canvas 2D context unavailable — try a smaller resolution.'); return; }

  // Save current playback state
  const savedTime    = state.playback.globalTime;
  const savedPlaying = state.playback.playing;
  state.playback.playing = false;

  // Hide point overlay during export if not requested
  const ovG     = document.getElementById('overlay-group');
  const prevVis = ovG ? ovG.style.visibility : '';
  if (ovG && !showPoints) ovG.style.visibility = 'hidden';

  // Compute SVG element's current display rect for aspect-correct scaling
  const svgRect = svgEl.getBoundingClientRect();
  const scaleX  = width  / (svgRect.width  || width);
  const scaleY  = height / (svgRect.height || height);

  let recorder = null;
  try {
    if (format === 'webm') {
      const stream   = canvas.captureStream(fps);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
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
        await yieldFrame(fps);
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
  } finally {
    // Always restore playback state and overlay, even if export errors mid-way
    state.playback.globalTime = savedTime;
    state.playback.playing    = savedPlaying;
    if (ovG) ovG.style.visibility = prevVis;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }
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

function yieldFrame(fps = 30) {
  return new Promise(r => setTimeout(r, 1000 / fps));
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
