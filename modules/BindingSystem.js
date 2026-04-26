// BindingSystem.js — Maps oscillator outputs → PathModel animated properties
// Each frame: resetToBase() then applyAll()

import { uid } from './PathModel.js';

// ────────────────────────────────────────────────────
// Binding
// ────────────────────────────────────────────────────
export class Binding {
  constructor(oscId, target, scale = 1) {
    this.id          = uid('bind');
    this.oscillatorId = oscId;
    // target: { pathId, pointIndex (or null), handleRole ('in'|'out'|null), property }
    // property: 'x'|'y'|'strokeWidth'|'fillOpacity'|'rotation'|'scaleX'|'scaleY'|'tx'|'ty'
    this.target   = target;
    this.scale    = scale;  // additional multiplier on top of osc.amplitude
    this.enabled  = true;
  }
}

// Friendly label for a binding target
export function bindingLabel(target) {
  if (target.pointIndex !== null && target.pointIndex !== undefined) {
    const h = target.handleRole ? `.handle${target.handleRole}` : '';
    return `pt[${target.pointIndex}]${h}.${target.property}`;
  }
  return target.property;
}

// List of available path-level binding properties
export const PATH_PROPERTIES = [
  'strokeWidth', 'fillOpacity',
  'rotation', 'scaleX', 'scaleY', 'tx', 'ty',
  'fillH', 'fillS', 'fillL',
  'strokeH', 'strokeS', 'strokeL',
];

// ────────────────────────────────────────────────────
// BindingSystem
// ────────────────────────────────────────────────────
export class BindingSystem {
  constructor() {
    this.bindings = new Map(); // id → Binding
  }

  add(oscId, target, scale) {
    const b = new Binding(oscId, target, scale);
    this.bindings.set(b.id, b);
    return b;
  }

  remove(id) { this.bindings.delete(id); }

  get(id) { return this.bindings.get(id); }

  // Shift all point-index bindings on a given path by +1 or -1 (wrapping)
  cyclePointIndices(pathId, direction, pointCount) {
    if (!pointCount) return;
    for (const b of this.bindings.values()) {
      if (b.target.pathId !== pathId) continue;
      if (b.target.pointIndex === null || b.target.pointIndex === undefined) continue;
      b.target.pointIndex = ((b.target.pointIndex + direction) % pointCount + pointCount) % pointCount;
    }
  }

  // ── Reset all animated values to their base ──────────
  resetToBase(paths) {
    for (const model of paths.values()) {
      model.strokeWidth  = model.baseStrokeWidth;
      model.fillOpacity  = model.baseFillOpacity;
      model.rotation     = model.baseRotation;
      model.scaleX       = model.baseScaleX;
      model.scaleY       = model.baseScaleY;
      model.tx           = model.baseTx;
      model.ty           = model.baseTy;
      model.fillH        = model.baseFillH;
      model.fillS        = model.baseFillS;
      model.fillL        = model.baseFillL;
      model.strokeH      = model.baseStrokeH;
      model.strokeS      = model.baseStrokeS;
      model.strokeL      = model.baseStrokeL;

      for (const pt of model.points) {
        pt.x = pt.baseX;
        pt.y = pt.baseY;
        if (pt.handleIn) {
          pt.handleIn.x = pt.handleIn.baseX;
          pt.handleIn.y = pt.handleIn.baseY;
        }
        if (pt.handleOut) {
          pt.handleOut.x = pt.handleOut.baseX;
          pt.handleOut.y = pt.handleOut.baseY;
        }
      }
    }
  }

  // ── Apply all active bindings ─────────────────────────
  applyAll(paths, oscillators) {
    for (const b of this.bindings.values()) {
      if (!b.enabled) continue;
      const osc = oscillators.get(b.oscillatorId);
      if (!osc) continue;
      const model = paths.get(b.target.pathId);
      if (!model) continue;

      const delta = osc.currentValue * b.scale;
      const t     = b.target;

      if (t.pointIndex !== null && t.pointIndex !== undefined) {
        const pt = model.points[t.pointIndex];
        if (!pt) continue;

        if (t.handleRole === 'in' && pt.handleIn) {
          applyToProp(pt.handleIn, t.property, delta);
        } else if (t.handleRole === 'out' && pt.handleOut) {
          applyToProp(pt.handleOut, t.property, delta);
        } else {
          applyToProp(pt, t.property, delta);
        }
      } else {
        applyToProp(model, t.property, delta);
      }
    }
  }
}

function applyToProp(obj, prop, delta) {
  if (prop in obj) obj[prop] += delta;
}
