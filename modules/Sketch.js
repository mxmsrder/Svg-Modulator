// Sketch.js — Pure serialization/deserialization helpers for full application state.
// All functions are side-effect-free: they take data in and return data out.
// UI interactions (panel renders, DOM updates) remain in main.js.

import { PathModel, Point, BezierHandle } from './PathModel.js';

// ── Path serialization ────────────────────────────────

export function serializePath(m) {
  return {
    id: m.id, closed: m.closed, fill: m.fill, stroke: m.stroke,
    strokeWidth: m.strokeWidth, baseStrokeWidth: m.baseStrokeWidth,
    fillOpacity: m.fillOpacity, baseFillOpacity: m.baseFillOpacity,
    strokeOpacity: m.strokeOpacity, baseStrokeOpacity: m.baseStrokeOpacity,
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

// ── Oscillator serialization ──────────────────────────

export function serializeOscillator(o) {
  return {
    id: o.id, name: o.name, type: o.type, color: o.color, enabled: o.enabled,
    waveform: o.waveform, frequency: o.frequency, amplitude: o.amplitude,
    phase: o.phase, offset: o.offset, curve: o.curve,
    stepCount: o.stepCount, stepRate: o.stepRate, stepValues: o.stepValues, stepAmp: o.stepAmp,
    rwRate: o.rwRate, rwSmooth: o.rwSmooth, rwMin: o.rwMin, rwMax: o.rwMax,
    audioBand: o.audioBand, audioSmooth: o.audioSmooth, audioAmplitude: o.audioAmplitude,
    expression: o.expression,
    trackName: o.trackName, trackBand: o.trackBand,
    trackSmooth: o.trackSmooth, trackAmplitude: o.trackAmplitude,
    trackMuted: o.trackMuted, trackThreshold: o.trackThreshold,
    envPoints: o.envPoints, envPeriod: o.envPeriod,
    envRate: o.envRate, envAmplitude: o.envAmplitude, envSmooth: o.envSmooth,
    envLoop: o.envLoop, envSnap: o.envSnap,
    deviceSensor: o.deviceSensor, deviceScale: o.deviceScale, deviceSmooth: o.deviceSmooth,
  };
}

// ── Full state serialization ──────────────────────────

export function serializeFullState(paths, oscEngine, bindingSys, viewport) {
  return {
    version: '1.1',
    type: 'svg-oscillator-sketch',
    paths: [...paths.values()].map(serializePath),
    oscillators: [...oscEngine.oscillators.values()].map(serializeOscillator),
    bindings: [...bindingSys.bindings.values()].map(b => ({
      id: b.id, oscillatorId: b.oscillatorId, target: b.target, scale: b.scale,
    })),
    viewBox: viewport.svgVB,
  };
}

// ── Path deserialization ──────────────────────────────

export function deserializePaths(data) {
  const paths = new Map();
  for (const d of data) {
    const m = new PathModel();
    Object.assign(m, {
      id: d.id, closed: d.closed, fill: d.fill, stroke: d.stroke,
      strokeWidth: d.strokeWidth, baseStrokeWidth: d.baseStrokeWidth,
      fillOpacity: d.fillOpacity, baseFillOpacity: d.baseFillOpacity,
      strokeOpacity: d.strokeOpacity ?? 1, baseStrokeOpacity: d.baseStrokeOpacity ?? 1,
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
    paths.set(m.id, m);
  }
  return paths;
}

// ── localStorage save slot helpers ───────────────────
// These only touch localStorage, no DOM.

const SAVE_KEY     = 'svg-osc-saves';
const AUTOSAVE_KEY = 'svg-osc-autosave';

export function getSaves() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; }
}

export function persistSaves(saves) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saves)); return true; }
  catch (e) { return false; }
}

export function autosave(stateData) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stateData)); } catch {}
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
