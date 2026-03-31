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
  selection: { pathId: null, pointIds: new Set(), highlightTarget: null },
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

// ── History ─────────────────────────────────────────

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

function pushHistory() { history.push(snapshotPaths()); }

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
  if (state.selection.pathId && !state.paths.has(state.selection.pathId)) {
    state.selection.pathId   = null;
    state.selection.pointIds = new Set();
  }
  inspector.render();
  bindingPanel.render();
}

// ── Full state save/restore (includes oscillators + bindings) ──

function serializeFullState() {
  return {
    paths: [...state.paths.values()].map(serializePath),
    oscillators: [...oscEngine.oscillators.values()].map(o => ({
      id: o.id, name: o.name, type: o.type,
      waveform: o.waveform, frequency: o.frequency, amplitude: o.amplitude,
      phase: o.phase, offset: o.offset, color: o.color,
      stepCount: o.stepCount, stepRate: o.stepRate,
      stepValues: o.stepValues, stepAmp: o.stepAmp,
      rwRate: o.rwRate, rwSmooth: o.rwSmooth, rwMin: o.rwMin, rwMax: o.rwMax,
      expression: o.expression,
    })),
    bindings: [...bindingSys.bindings.values()].map(b => ({
      id: b.id, oscillatorId: b.oscillatorId, target: b.target, scale: b.scale,
    })),
    viewBox: viewport.svgVB,
  };
}

function restoreFullState(obj) {
  // Restore paths
  if (obj.paths) {
    restoreSnapshot(JSON.stringify(obj.paths));
  }
  // Restore oscillators
  if (obj.oscillators) {
    oscEngine.oscillators.clear();
    for (const od of obj.oscillators) {
      const osc = oscEngine.add(od);
      osc.id = od.id; // preserve IDs
    }
  }
  // Restore bindings
  if (obj.bindings) {
    bindingSys.bindings.clear();
    for (const bd of obj.bindings) {
      const b = bindingSys.add(bd.oscillatorId, bd.target, bd.scale);
      b.id = bd.id;
    }
  }
  // Restore viewBox
  if (obj.viewBox) viewport.setViewBox(obj.viewBox);

  state.selection.pathId   = null;
  state.selection.pointIds = new Set();
  document.getElementById('drop-hint').classList.add('hidden');

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
    oscPanel.tick(state.playback.globalTime);
  }

  viewport.render(state.paths, state.ui.showWireframe);
  overlay.render(state.paths, state.selection, viewport.zoom);
}

requestAnimationFrame(t => { lastTime = t; requestAnimationFrame(tick); });

// ── SVG Import ───────────────────────────────────────

function loadSVG(text) {
  let result;
  try { result = parseSVGString(text); }
  catch(e) { alert('Could not parse SVG: ' + e.message); return; }

  state.paths.clear();
  state.selection.pathId   = null;
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

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadSVG(ev.target.result);
  reader.readAsText(file);
  e.target.value = '';
});

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

document.getElementById('drop-hint').addEventListener('click', () => fileInput.click());

// ── Path selection ───────────────────────────────────

svgEl.addEventListener('click', (e) => {
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
  // Don't steal keys when user is typing in an input
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  const cmd = e.metaKey || e.ctrlKey;

  if (cmd) {
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); applyUndo(); }
    if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); applyRedo(); }
    if (e.key === 'y')                 { e.preventDefault(); applyRedo(); }
    return;
  }

  // Space — toggle play / stop
  if (e.key === ' ') {
    e.preventDefault();
    if (state.playback.playing) {
      state.playback.playing = false;
      document.getElementById('btn-play').classList.remove('active');
      bindingSys.resetToBase(state.paths);
    } else {
      state.playback.playing = true;
      document.getElementById('btn-play').classList.add('active');
    }
    return;
  }

  // H or F — fit view
  if (e.key === 'h' || e.key === 'H' || e.key === 'f' || e.key === 'F') {
    viewport.fitToView();
    return;
  }

  // Delete / Backspace — remove selected points or whole shape
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const pathId = state.selection.pathId;
    if (!pathId) return;
    const model = state.paths.get(pathId);
    if (!model) return;

    if (state.selection.pointIds.size > 0) {
      pushHistory();
      model.points = model.points.filter(pt => !state.selection.pointIds.has(pt.id));
      state.selection.pointIds = new Set();
      inspector.render();
      bindingPanel.render();
    } else {
      if (confirm('Delete this shape?')) {
        pushHistory();
        state.paths.delete(pathId);
        state.selection.pathId   = null;
        state.selection.pointIds = new Set();
        inspector.render();
        bindingPanel.render();
      }
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
