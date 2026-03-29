// PathOperations.js — Resample, split, mirror, and drag operations on PathModel

import { Point, BezierHandle, uid } from './PathModel.js';

// ────────────────────────────────────────────────────
// Drag Controller
// ────────────────────────────────────────────────────
export class DragController {
  constructor(interactionGroup, viewport, paths, selection, onModified, pushHistory) {
    this.group       = interactionGroup;
    this.viewport    = viewport;
    this.paths       = paths;
    this.selection   = selection;
    this.onModified  = onModified;
    this.pushHistory = pushHistory; // called once at drag start

    // Snap-to-grid settings (updated externally)
    this.snapEnabled = false;
    this.snapSize    = 10;

    this._dragging  = null;

    interactionGroup.addEventListener('pointerdown', e => this._onDown(e));
    window.addEventListener('pointermove', e => this._onMove(e));
    window.addEventListener('pointerup',  e => this._onUp(e));
  }

  _snap(val) {
    if (!this.snapEnabled) return val;
    return Math.round(val / this.snapSize) * this.snapSize;
  }

  _onDown(e) {
    const role       = e.target.dataset.role;
    const pathId     = e.target.dataset.pathId;
    const ptIdx      = parseInt(e.target.dataset.ptIdx, 10);
    const handleRole = e.target.dataset.handleRole || null;

    if (!role || !pathId) return;
    e.stopPropagation();

    // Snapshot before first drag move
    this._historyPushed = false;

    const model = this.paths.get(pathId);
    if (!model) return;

    // Select point — fire immediately so inspector shows coords
    if (role === 'anchor') {
      this.selection.pathId = pathId;
      this.selection.pointIds = new Set([model.points[ptIdx]?.id]);
      this.onModified(pathId); // update inspector immediately on click
    }

    const svgCoord = this.viewport.screenToSVG(e.clientX, e.clientY);

    this._dragging = { type: role, pathId, ptIdx, handleRole, startSVG: svgCoord };
    this.group.setPointerCapture(e.pointerId);
    e.target.style.cursor = 'grabbing';
  }

  _onMove(e) {
    if (!this._dragging) return;
    // Push history once at the start of a drag gesture
    if (!this._historyPushed) {
      this.pushHistory?.();
      this._historyPushed = true;
    }
    const { pathId, ptIdx, handleRole, type } = this._dragging;
    const model = this.paths.get(pathId);
    if (!model) return;

    const raw = this.viewport.screenToSVG(e.clientX, e.clientY);
    const svgCoord = { x: this._snap(raw.x), y: this._snap(raw.y) };

    if (type === 'anchor') {
      const pt = model.points[ptIdx];
      if (!pt) return;
      const dx = svgCoord.x - pt.baseX;
      const dy = svgCoord.y - pt.baseY;

      // Move anchor and keep handles at same relative offset
      const hInDx = pt.handleIn  ? pt.handleIn.baseX  - pt.baseX : 0;
      const hInDy = pt.handleIn  ? pt.handleIn.baseY  - pt.baseY : 0;
      const hOutDx = pt.handleOut ? pt.handleOut.baseX - pt.baseX : 0;
      const hOutDy = pt.handleOut ? pt.handleOut.baseY - pt.baseY : 0;

      pt.baseX = svgCoord.x; pt.x = svgCoord.x;
      pt.baseY = svgCoord.y; pt.y = svgCoord.y;
      if (pt.handleIn) {
        pt.handleIn.baseX = svgCoord.x + hInDx; pt.handleIn.x = pt.handleIn.baseX;
        pt.handleIn.baseY = svgCoord.y + hInDy; pt.handleIn.y = pt.handleIn.baseY;
      }
      if (pt.handleOut) {
        pt.handleOut.baseX = svgCoord.x + hOutDx; pt.handleOut.x = pt.handleOut.baseX;
        pt.handleOut.baseY = svgCoord.y + hOutDy; pt.handleOut.y = pt.handleOut.baseY;
      }

    } else if (type === 'handle') {
      const pt = model.points[ptIdx];
      if (!pt) return;
      const handle = handleRole === 'in' ? pt.handleIn : pt.handleOut;
      if (!handle) return;

      handle.baseX = svgCoord.x; handle.x = svgCoord.x;
      handle.baseY = svgCoord.y; handle.y = svgCoord.y;

      // Enforce symmetry / smoothness constraints
      if (pt.type === 'symmetric') {
        const other = handleRole === 'in' ? pt.handleOut : pt.handleIn;
        if (other) {
          const dx = svgCoord.x - pt.baseX;
          const dy = svgCoord.y - pt.baseY;
          const len = Math.sqrt(dx*dx + dy*dy);
          other.baseX = pt.baseX - dx; other.x = other.baseX;
          other.baseY = pt.baseY - dy; other.y = other.baseY;
        }
      } else if (pt.type === 'smooth') {
        const other = handleRole === 'in' ? pt.handleOut : pt.handleIn;
        if (other) {
          const dx = svgCoord.x - pt.baseX;
          const dy = svgCoord.y - pt.baseY;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const oDx = other.baseX - pt.baseX;
          const oDy = other.baseY - pt.baseY;
          const oLen = Math.sqrt(oDx*oDx + oDy*oDy);
          other.baseX = pt.baseX - (dx/len)*oLen; other.x = other.baseX;
          other.baseY = pt.baseY - (dy/len)*oLen; other.y = other.baseY;
        }
      }
    }

    this.onModified(pathId);
  }

  _onUp(e) {
    if (this._dragging) {
      this._dragging = null;
    }
  }
}

// ────────────────────────────────────────────────────
// Resample
// ────────────────────────────────────────────────────

/**
 * Redistribute path points at uniform arc-length intervals.
 * Returns a new PathModel (mutates the passed model's points in-place).
 */
export function resample(model, targetCount) {
  if (model.points.length < 2 || targetCount < 2) return model;

  const nSegs = model.segmentCount();
  const STEPS = 100;

  // Build LUT: { t_global, x, y } where t_global ∈ [0, nSegs]
  const lut = [];
  let totalLen = 0;

  for (let seg = 0; seg < nSegs; seg++) {
    let prev = model.evalSegment(seg, 0);
    for (let s = 1; s <= STEPS; s++) {
      const t = s / STEPS;
      const curr = model.evalSegment(seg, t);
      totalLen += dist(prev, curr);
      lut.push({ tGlobal: seg + t, len: totalLen, x: curr.x, y: curr.y });
      prev = curr;
    }
  }

  // Sample at uniform intervals
  const newPoints = [];
  for (let i = 0; i < targetCount; i++) {
    const targetLen = (i / (targetCount - 1)) * totalLen;
    const pos = sampleLUT(lut, targetLen);

    // Approximate tangent via finite difference for handle direction
    const dLen = totalLen * 0.01;
    const posA = sampleLUT(lut, Math.max(0, targetLen - dLen));
    const posB = sampleLUT(lut, Math.min(totalLen, targetLen + dLen));
    const tx = posB.x - posA.x, ty = posB.y - posA.y;
    const tLen = Math.sqrt(tx*tx + ty*ty) || 1;
    const tnx = tx/tLen, tny = ty/tLen;

    // Handle length: fraction of total length
    const hLen = totalLen / (targetCount - 1) / 3;
    const pt = new Point(pos.x, pos.y, 'smooth');
    pt.handleIn  = new BezierHandle(pos.x - tnx*hLen, pos.y - tny*hLen);
    pt.handleOut = new BezierHandle(pos.x + tnx*hLen, pos.y + tny*hLen);
    newPoints.push(pt);
  }

  model.points = newPoints;
  return model;
}

function sampleLUT(lut, targetLen) {
  if (targetLen <= 0)           return lut[0];
  if (targetLen >= lut[lut.length-1].len) return lut[lut.length-1];

  // Binary search
  let lo = 0, hi = lut.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lut[mid].len < targetLen) lo = mid; else hi = mid;
  }
  const a = lut[lo], b = lut[hi];
  const frac = (targetLen - a.len) / (b.len - a.len + 1e-10);
  return { x: lerp(a.x, b.x, frac), y: lerp(a.y, b.y, frac) };
}

// ────────────────────────────────────────────────────
// Split point (De Casteljau)
// ────────────────────────────────────────────────────

/**
 * Split the segment ending at pointIndex at parameter t.
 * Inserts a new point between points[segIndex] and points[segIndex+1].
 */
export function splitSegment(model, segIndex, t = 0.5) {
  const pts  = model.points;
  const n    = pts.length;
  if (n < 2) return model;

  const i0 = segIndex;
  const i1 = (segIndex + 1) % n;
  const p0 = pts[i0];
  const p3 = pts[i1];
  const p1 = p0.handleOut || p0;
  const p2 = p3.handleIn  || p3;

  // De Casteljau
  const q0 = lerp2(p0, p1, t);
  const q1 = lerp2(p1, p2, t);
  const q2 = lerp2(p2, p3, t);
  const r0 = lerp2(q0, q1, t);
  const r1 = lerp2(q1, q2, t);
  const s  = lerp2(r0, r1, t); // new anchor

  // Update existing handles
  p0.handleOut = new BezierHandle(q0.x, q0.y);
  p0.handleOut.baseX = q0.x; p0.handleOut.baseY = q0.y;
  p3.handleIn  = new BezierHandle(q2.x, q2.y);
  p3.handleIn.baseX  = q2.x; p3.handleIn.baseY  = q2.y;

  // Create new point
  const newPt = new Point(s.x, s.y, 'smooth');
  newPt.baseX = s.x; newPt.baseY = s.y;
  newPt.handleIn  = new BezierHandle(r0.x, r0.y);
  newPt.handleIn.baseX  = r0.x; newPt.handleIn.baseY  = r0.y;
  newPt.handleOut = new BezierHandle(r1.x, r1.y);
  newPt.handleOut.baseX = r1.x; newPt.handleOut.baseY = r1.y;

  // Insert after segIndex (use actual index, not modulo)
  pts.splice(i0 + 1, 0, newPt);
  return model;
}

// ────────────────────────────────────────────────────
// Mirror
// ────────────────────────────────────────────────────

export function mirrorX(model) {
  const bb  = model.getBoundingBox();
  const cx  = bb.x + bb.w / 2;
  return _mirrorAxis(model, cx, null);
}

export function mirrorY(model) {
  const bb  = model.getBoundingBox();
  const cy  = bb.y + bb.h / 2;
  return _mirrorAxis(model, null, cy);
}

function _mirrorAxis(model, cx, cy) {
  for (const pt of model.points) {
    if (cx !== null) {
      pt.x = 2*cx - pt.x;
      pt.baseX = pt.x;
      if (pt.handleIn)  { pt.handleIn.x  = 2*cx - pt.handleIn.x;  pt.handleIn.baseX  = pt.handleIn.x; }
      if (pt.handleOut) { pt.handleOut.x = 2*cx - pt.handleOut.x; pt.handleOut.baseX = pt.handleOut.x; }
    }
    if (cy !== null) {
      pt.y = 2*cy - pt.y;
      pt.baseY = pt.y;
      if (pt.handleIn)  { pt.handleIn.y  = 2*cy - pt.handleIn.y;  pt.handleIn.baseY  = pt.handleIn.y; }
      if (pt.handleOut) { pt.handleOut.y = 2*cy - pt.handleOut.y; pt.handleOut.baseY = pt.handleOut.y; }
    }
    // Swap handles so the curve direction is preserved
    const tmp       = pt.handleIn;
    pt.handleIn     = pt.handleOut;
    pt.handleOut    = tmp;
  }
  model.points.reverse();
  return model;
}

/**
 * Create a linked mirror clone of the model.
 * The clone's points are recomputed from master each sync call.
 */
export function createLinkedMirrorClone(masterModel, axis) {
  const clone = masterModel.clone();
  clone.mirrorSlaveId = null;
  masterModel.mirrorSlaveId = clone.id;
  masterModel.mirrorAxis    = axis;
  clone.selected = false;
  if (axis === 'x') mirrorX(clone); else mirrorY(clone);
  return clone;
}

/**
 * Sync all slave paths from their masters.
 * Call after BindingSystem.applyAll().
 */
export function syncMirrorSlaves(paths) {
  for (const [, model] of paths) {
    if (!model.mirrorSlaveId) continue;
    const slave = paths.get(model.mirrorSlaveId);
    if (!slave) continue;

    // Rebuild slave from master's current animated state
    const bb = getBBFromPoints(model.points);
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;

    // Copy master points into slave (reversed, mirrored)
    const srcPts = [...model.points].reverse();
    slave.points = srcPts.map((pt, i) => {
      const sp = new Point(pt.x, pt.y, pt.type);
      if (model.mirrorAxis === 'x') {
        sp.x = 2*cx - pt.x; sp.baseX = sp.x;
        sp.y = pt.y;        sp.baseY = sp.y;
      } else {
        sp.x = pt.x;        sp.baseX = sp.x;
        sp.y = 2*cy - pt.y; sp.baseY = sp.y;
      }
      // Swap handles
      if (pt.handleOut) {
        sp.handleIn = new BezierHandle(
          model.mirrorAxis === 'x' ? 2*cx - pt.handleOut.x : pt.handleOut.x,
          model.mirrorAxis === 'y' ? 2*cy - pt.handleOut.y : pt.handleOut.y,
        );
      }
      if (pt.handleIn) {
        sp.handleOut = new BezierHandle(
          model.mirrorAxis === 'x' ? 2*cx - pt.handleIn.x : pt.handleIn.x,
          model.mirrorAxis === 'y' ? 2*cy - pt.handleIn.y : pt.handleIn.y,
        );
      }
      return sp;
    });

    slave.closed = model.closed;
  }
}

// ────────────────────────────────────────────────────
// Math helpers
// ────────────────────────────────────────────────────
function dist(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx*dx + dy*dy);
}
function lerp(a, b, t) { return a + (b-a)*t; }
function lerp2(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function getBBFromPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX-minX, h: maxY-minY };
}
