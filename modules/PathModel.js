// PathModel.js — Core data model: Point, BezierHandle, PathModel
// All coordinates are absolute SVG user units.
// Each animatable field has a matching `base*` field.
// BindingSystem resets to base each frame, then adds oscillator contributions.

let _idCounter = 0;
export function uid(prefix = 'id') {
  return `${prefix}-${++_idCounter}`;
}

// ────────────────────────────────────────────────────
// BezierHandle
// ────────────────────────────────────────────────────
export class BezierHandle {
  constructor(x, y) {
    this.id   = uid('h');
    this.x    = x;
    this.y    = y;
    this.baseX = x;
    this.baseY = y;
  }

  clone() {
    const h = new BezierHandle(this.x, this.y);
    h.baseX = this.baseX;
    h.baseY = this.baseY;
    return h;
  }
}

// ────────────────────────────────────────────────────
// Point
// type: 'smooth' | 'symmetric' | 'cusp'
//   symmetric – in/out handles are equal length & mirrored
//   smooth    – handles are collinear but can differ in length
//   cusp      – handles move independently
// ────────────────────────────────────────────────────
export class Point {
  constructor(x, y, type = 'smooth') {
    this.id    = uid('pt');
    this.x     = x;
    this.y     = y;
    this.baseX = x;
    this.baseY = y;
    this.type  = type;
    this.handleIn  = null;  // BezierHandle | null
    this.handleOut = null;  // BezierHandle | null
  }

  clone() {
    const p = new Point(this.x, this.y, this.type);
    p.baseX = this.baseX;
    p.baseY = this.baseY;
    if (this.handleIn)  p.handleIn  = this.handleIn.clone();
    if (this.handleOut) p.handleOut = this.handleOut.clone();
    return p;
  }
}

// ────────────────────────────────────────────────────
// PathModel
// ────────────────────────────────────────────────────
export class PathModel {
  constructor() {
    this.id      = uid('path');
    this.points  = [];
    this.closed  = false;

    // Style — animated fields paired with base values
    this.fill            = 'none';
    this.stroke          = '#ffffff';
    this.strokeWidth     = 1;
    this.baseStrokeWidth = 1;
    this.fillOpacity     = 1;
    this.baseFillOpacity = 1;

    // Transform — animated fields
    this.tx        = 0; this.baseTx     = 0;
    this.ty        = 0; this.baseTy     = 0;
    this.rotation  = 0; this.baseRotation = 0;
    this.scaleX    = 1; this.baseScaleX  = 1;
    this.scaleY    = 1; this.baseScaleY  = 1;

    // Editor state
    this.selected  = false;
    this.visible   = true;

    // Linked mirror slave path id (if any)
    this.mirrorSlaveId  = null;
    this.mirrorAxis     = null; // 'x' | 'y' | null

    // Original element reference (from SVG parse)
    this.originalElement = null;
  }

  // ── Geometry helpers ──────────────────────────────

  // Evaluate a cubic bezier at parameter t ∈ [0,1]
  // Returns {x, y}
  evalSegment(segIndex, t) {
    const p0 = this.points[segIndex];
    const p1 = this.points[(segIndex + 1) % this.points.length];
    const cp1 = p0.handleOut || p0;
    const cp2 = p1.handleIn  || p1;
    return cubicBezier(p0, cp1, cp2, p1, t);
  }

  // Arc-length of one segment (subdivide into `steps` samples)
  segmentLength(segIndex, steps = 50) {
    let len = 0;
    let prev = this.evalSegment(segIndex, 0);
    for (let i = 1; i <= steps; i++) {
      const curr = this.evalSegment(segIndex, i / steps);
      len += dist(prev, curr);
      prev = curr;
    }
    return len;
  }

  // Total arc-length across all segments
  totalLength(steps = 50) {
    const n = this.segmentCount();
    let total = 0;
    for (let i = 0; i < n; i++) total += this.segmentLength(i, steps);
    return total;
  }

  segmentCount() {
    if (this.points.length < 2) return 0;
    return this.closed ? this.points.length : this.points.length - 1;
  }

  getBoundingBox() {
    if (!this.points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of this.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ── Serialization ──────────────────────────────────

  // Emit the 'd' attribute string from current (animated) point positions
  toPathString() {
    const pts = this.points;
    if (pts.length === 0) return '';
    let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;

    const segs = this.segmentCount();
    for (let i = 0; i < segs; i++) {
      const p0  = pts[i];
      const p1  = pts[(i + 1) % pts.length];
      const cp1 = p0.handleOut || p0;
      const cp2 = p1.handleIn  || p1;
      d += ` C ${fmt(cp1.x)} ${fmt(cp1.y)} ${fmt(cp2.x)} ${fmt(cp2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`;
    }
    if (this.closed) d += ' Z';
    return d;
  }

  // Build CSS transform attribute for the path group
  toTransformString() {
    const parts = [];
    if (this.tx || this.ty) parts.push(`translate(${fmt(this.tx)},${fmt(this.ty)})`);
    if (this.rotation) {
      const bb = this.getBoundingBox();
      const cx = bb.x + bb.w / 2;
      const cy = bb.y + bb.h / 2;
      parts.push(`rotate(${fmt(this.rotation)},${fmt(cx)},${fmt(cy)})`);
    }
    if (this.scaleX !== 1 || this.scaleY !== 1) {
      parts.push(`scale(${fmt(this.scaleX)},${fmt(this.scaleY)})`);
    }
    return parts.join(' ');
  }

  clone() {
    const c = new PathModel();
    c.closed  = this.closed;
    c.fill    = this.fill;
    c.stroke  = this.stroke;
    c.strokeWidth     = this.strokeWidth;
    c.baseStrokeWidth = this.baseStrokeWidth;
    c.fillOpacity     = this.fillOpacity;
    c.baseFillOpacity = this.baseFillOpacity;
    c.tx = this.tx; c.baseTx = this.baseTx;
    c.ty = this.ty; c.baseTy = this.baseTy;
    c.rotation = this.rotation; c.baseRotation = this.baseRotation;
    c.scaleX = this.scaleX; c.baseScaleX = this.baseScaleX;
    c.scaleY = this.scaleY; c.baseScaleY = this.baseScaleY;
    c.points = this.points.map(p => p.clone());
    return c;
  }
}

// ────────────────────────────────────────────────────
// Math helpers
// ────────────────────────────────────────────────────
function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  };
}

function dist(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx*dx + dy*dy);
}

function fmt(n) { return +n.toFixed(4); }
