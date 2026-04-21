// SVGParser.js — Parse SVG file/string → PathModel[]
// Normalizes all path commands to absolute M, C, Z only.

import { PathModel, Point, BezierHandle } from './PathModel.js';

// ────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────

/**
 * Parse an SVG string and return { paths, viewBox, width, height }
 * paths is an array of PathModel
 */
export function parseSVGString(svgString) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl  = doc.querySelector('svg');
  if (!svgEl) throw new Error('No <svg> element found');

  const vb  = parseViewBox(svgEl);
  const paths = [];

  // Walk all path-like elements
  svgEl.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon').forEach(el => {
    const d = elementToPathD(el);
    if (!d) return;
    const model = parsePathD(d);
    if (!model.points.length) return;

    // Copy style — default fill white (visible), stroke none
    model.fill        = el.getAttribute('fill')   || '#ffffff';
    model.stroke      = el.getAttribute('stroke') || 'none';
    const sw          = parseFloat(el.getAttribute('stroke-width')) || 0.05;
    model.strokeWidth     = sw;
    model.baseStrokeWidth = sw;
    const fo          = parseFloat(el.getAttribute('fill-opacity') ?? el.getAttribute('opacity') ?? '1');
    model.fillOpacity     = isNaN(fo) ? 1 : fo;
    model.baseFillOpacity = model.fillOpacity;
    model.originalElement = el;

    paths.push(model);
  });

  return { paths, viewBox: vb };
}

// ────────────────────────────────────────────────────
// Element → path 'd' string
// ────────────────────────────────────────────────────
function elementToPathD(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'path') return el.getAttribute('d') || '';

  if (tag === 'rect') {
    const x  = +el.getAttribute('x')  || 0;
    const y  = +el.getAttribute('y')  || 0;
    const w  = +el.getAttribute('width')  || 0;
    const h  = +el.getAttribute('height') || 0;
    const rx = +el.getAttribute('rx') || 0;
    const ry = +el.getAttribute('ry') || rx;
    if (!rx) return `M ${x},${y} H ${x+w} V ${y+h} H ${x} Z`;
    // Rounded rect — approximate with cubic beziers
    const k = 0.5523;
    return `M ${x+rx},${y} H ${x+w-rx} C ${x+w-rx+k*rx},${y} ${x+w},${y+ry-k*ry} ${x+w},${y+ry}` +
           ` V ${y+h-ry} C ${x+w},${y+h-ry+k*ry} ${x+w-rx+k*rx},${y+h} ${x+w-rx},${y+h}` +
           ` H ${x+rx} C ${x+rx-k*rx},${y+h} ${x},${y+h-ry+k*ry} ${x},${y+h-ry}` +
           ` V ${y+ry} C ${x},${y+ry-k*ry} ${x+rx-k*rx},${y} ${x+rx},${y} Z`;
  }

  if (tag === 'circle' || tag === 'ellipse') {
    const cx = +(el.getAttribute('cx') || 0);
    const cy = +(el.getAttribute('cy') || 0);
    const rx = tag === 'circle' ? +(el.getAttribute('r') || 0) : +(el.getAttribute('rx') || 0);
    const ry = tag === 'circle' ? rx : +(el.getAttribute('ry') || 0);
    const k  = 0.5523;
    return `M ${cx},${cy-ry}` +
           ` C ${cx+k*rx},${cy-ry} ${cx+rx},${cy-k*ry} ${cx+rx},${cy}` +
           ` C ${cx+rx},${cy+k*ry} ${cx+k*rx},${cy+ry} ${cx},${cy+ry}` +
           ` C ${cx-k*rx},${cy+ry} ${cx-rx},${cy+k*ry} ${cx-rx},${cy}` +
           ` C ${cx-rx},${cy-k*ry} ${cx-k*rx},${cy-ry} ${cx},${cy-ry} Z`;
  }

  if (tag === 'line') {
    const x1 = el.getAttribute('x1')||0, y1 = el.getAttribute('y1')||0;
    const x2 = el.getAttribute('x2')||0, y2 = el.getAttribute('y2')||0;
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  if (tag === 'polyline' || tag === 'polygon') {
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/);
    let d = '';
    for (let i = 0; i < pts.length; i += 2) {
      d += (i === 0 ? 'M ' : ' L ') + pts[i] + ',' + pts[i+1];
    }
    if (tag === 'polygon') d += ' Z';
    return d;
  }

  return '';
}

// ────────────────────────────────────────────────────
// Parse viewBox
// ────────────────────────────────────────────────────
function parseViewBox(svgEl) {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  return {
    x: 0, y: 0,
    w: parseFloat(svgEl.getAttribute('width'))  || 500,
    h: parseFloat(svgEl.getAttribute('height')) || 500,
  };
}

// ────────────────────────────────────────────────────
// Main path 'd' parser
// ────────────────────────────────────────────────────
export function parsePathD(d) {
  const cmds    = tokenize(d);
  const absCmd  = normalize(cmds);
  return buildModel(absCmd);
}

// ── Step 1: Tokenize ─────────────────────────────────
// Split 'd' into [{cmd, args}] keeping original case
function tokenize(d) {
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  const tokens = [];
  let current  = null;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) {
      if (current) tokens.push(current);
      current = { cmd: m[1], args: [] };
    } else if (m[2] && current) {
      current.args.push(+m[2]);
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── Step 2: Normalize to absolute M, L, C, Z ─────────
function normalize(tokens) {
  const out = [];
  let cx = 0, cy = 0;  // current point
  let mx = 0, my = 0;  // last moveto (for Z)
  let prevCmd = null, prevCP = null; // for S/T

  for (const tok of tokens) {
    const { cmd, args } = tok;
    const upper = cmd.toUpperCase();
    const rel   = cmd !== upper;

    switch (upper) {
      case 'M': {
        // Each pair after the first becomes an implicit L
        for (let i = 0; i < args.length; i += 2) {
          const x = rel ? cx + args[i]   : args[i];
          const y = rel ? cy + args[i+1] : args[i+1];
          out.push({ cmd: i === 0 ? 'M' : 'L', args: [x, y] });
          cx = x; cy = y;
          if (i === 0) { mx = x; my = y; }
        }
        break;
      }
      case 'Z': {
        out.push({ cmd: 'Z', args: [] });
        cx = mx; cy = my;
        break;
      }
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          const x = rel ? cx + args[i]   : args[i];
          const y = rel ? cy + args[i+1] : args[i+1];
          out.push({ cmd: 'L', args: [x, y] });
          cx = x; cy = y;
        }
        break;
      }
      case 'H': {
        for (let i = 0; i < args.length; i++) {
          const x = rel ? cx + args[i] : args[i];
          out.push({ cmd: 'L', args: [x, cy] });
          cx = x;
        }
        break;
      }
      case 'V': {
        for (let i = 0; i < args.length; i++) {
          const y = rel ? cy + args[i] : args[i];
          out.push({ cmd: 'L', args: [cx, y] });
          cy = y;
        }
        break;
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const [x1,y1,x2,y2,x,y] = rel
            ? [cx+args[i],cy+args[i+1], cx+args[i+2],cy+args[i+3], cx+args[i+4],cy+args[i+5]]
            : args.slice(i, i+6);
          out.push({ cmd: 'C', args: [x1,y1,x2,y2,x,y] });
          prevCP = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 'S': {
        // Smooth cubic: reflect previous control point
        for (let i = 0; i < args.length; i += 4) {
          const [x2,y2,x,y] = rel
            ? [cx+args[i],cy+args[i+1], cx+args[i+2],cy+args[i+3]]
            : args.slice(i, i+4);
          const x1 = prevCP && (prevCmd==='C'||prevCmd==='S') ? 2*cx - prevCP.x : cx;
          const y1 = prevCP && (prevCmd==='C'||prevCmd==='S') ? 2*cy - prevCP.y : cy;
          out.push({ cmd: 'C', args: [x1,y1,x2,y2,x,y] });
          prevCP = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 'Q': {
        // Quadratic → cubic upgrade
        for (let i = 0; i < args.length; i += 4) {
          const [qx,qy,x,y] = rel
            ? [cx+args[i],cy+args[i+1], cx+args[i+2],cy+args[i+3]]
            : args.slice(i, i+4);
          const x1 = cx + 2/3*(qx-cx);
          const y1 = cy + 2/3*(qy-cy);
          const x2 = x  + 2/3*(qx-x);
          const y2 = y  + 2/3*(qy-y);
          out.push({ cmd: 'C', args: [x1,y1,x2,y2,x,y] });
          prevCP = { x: qx, y: qy };
          cx = x; cy = y;
        }
        break;
      }
      case 'T': {
        // Smooth quadratic → cubic
        for (let i = 0; i < args.length; i += 2) {
          const x = rel ? cx + args[i]   : args[i];
          const y = rel ? cy + args[i+1] : args[i+1];
          const qx = prevCP && (prevCmd==='Q'||prevCmd==='T') ? 2*cx - prevCP.x : cx;
          const qy = prevCP && (prevCmd==='Q'||prevCmd==='T') ? 2*cy - prevCP.y : cy;
          const x1 = cx + 2/3*(qx-cx);
          const y1 = cy + 2/3*(qy-cy);
          const x2 = x  + 2/3*(qx-x);
          const y2 = y  + 2/3*(qy-y);
          out.push({ cmd: 'C', args: [x1,y1,x2,y2,x,y] });
          prevCP = { x: qx, y: qy };
          cx = x; cy = y;
        }
        break;
      }
      case 'A': {
        // Arc → cubic bezier approximation
        for (let i = 0; i < args.length; i += 7) {
          const [rx,ry,xRot,largeArc,sweep,x,y] = rel
            ? [args[i],args[i+1],args[i+2],args[i+3],args[i+4], cx+args[i+5],cy+args[i+6]]
            : args.slice(i, i+7);
          const arcs = arcToCubic(cx,cy, rx,ry, xRot, largeArc, sweep, x, y);
          for (const a of arcs) out.push({ cmd: 'C', args: a });
          cx = x; cy = y;
        }
        break;
      }
    }
    prevCmd = upper;
  }
  return out;
}

// ── Step 3: Build PathModel from normalized commands ──
function buildModel(cmds) {
  const model = new PathModel();
  let i = 0;

  while (i < cmds.length) {
    const { cmd, args } = cmds[i];
    if (cmd === 'M') {
      const pt = new Point(args[0], args[1]);
      // Peek: if next is C, it will set handleOut later
      model.points.push(pt);
      i++;
    } else if (cmd === 'L') {
      // Degenerate cubic: handles collapse to the line endpoints
      const prev = model.points[model.points.length - 1];
      const x0 = prev ? prev.x : 0;
      const y0 = prev ? prev.y : 0;
      const x3 = args[0], y3 = args[1];
      // Control points at 1/3 and 2/3 along the line
      const x1 = x0 + (x3-x0)/3, y1 = y0 + (y3-y0)/3;
      const x2 = x0 + 2*(x3-x0)/3, y2 = y0 + 2*(y3-y0)/3;
      if (prev) prev.handleOut = new BezierHandle(x1, y1);
      const pt = new Point(x3, y3);
      pt.handleIn = new BezierHandle(x2, y2);
      model.points.push(pt);
      i++;
    } else if (cmd === 'C') {
      const [x1,y1,x2,y2,x3,y3] = args;
      const prev = model.points[model.points.length - 1];
      if (prev && !prev.handleOut) prev.handleOut = new BezierHandle(x1, y1);
      else if (prev) { prev.handleOut = new BezierHandle(x1, y1); }
      const pt = new Point(x3, y3);
      pt.handleIn = new BezierHandle(x2, y2);
      model.points.push(pt);
      i++;
    } else if (cmd === 'Z') {
      model.closed = true;
      // Link last point's handleOut toward first point (if missing)
      const first = model.points[0];
      const last  = model.points[model.points.length - 1];
      if (last && !last.handleOut && first) {
        last.handleOut = new BezierHandle(last.x, last.y);
      }
      if (first && !first.handleIn && last) {
        first.handleIn = new BezierHandle(first.x, first.y);
      }
      i++;
    } else {
      i++;
    }
  }

  // Fill in any missing handles as degenerate (handle = anchor)
  for (const pt of model.points) {
    if (!pt.handleIn)  pt.handleIn  = new BezierHandle(pt.x, pt.y);
    if (!pt.handleOut) pt.handleOut = new BezierHandle(pt.x, pt.y);
  }

  return model;
}

// ────────────────────────────────────────────────────
// Arc → cubic bezier conversion (SVG spec algorithm)
// Returns array of [x1,y1,x2,y2,x,y] arrays
// ────────────────────────────────────────────────────
function arcToCubic(x1,y1, rx,ry, phi, largeArc, sweep, x2,y2) {
  if (rx===0 || ry===0) return [[x1,y1,x2,y2,x2,y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const sin = Math.sin(phi * Math.PI/180);
  const cos = Math.cos(phi * Math.PI/180);

  // Step 1: Compute (x1', y1')
  const dx = (x1-x2)/2, dy = (y1-y2)/2;
  const x1p =  cos*dx + sin*dy;
  const y1p = -sin*dx + cos*dy;

  // Step 2: Check and scale radii
  let denom = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p;
  const numer = rx*rx*y1p*y1p + ry*ry*x1p*x1p;
  if (denom < 0) {
    const s = Math.sqrt(1 - denom/numer);
    rx *= s; ry *= s; denom = 0;
  }

  const sq = (largeArc===sweep ? -1 : 1) * Math.sqrt(denom / numer || 0);
  const cxp =  sq * rx * y1p / ry;
  const cyp = -sq * ry * x1p / rx;

  // Step 3: Compute (cx, cy) from (cx', cy')
  const cx = cos*cxp - sin*cyp + (x1+x2)/2;
  const cy = sin*cxp + cos*cyp + (y1+y2)/2;

  // Step 4: Compute θ1 and dθ
  const ux = ( x1p-cxp)/rx, uy = ( y1p-cyp)/ry;
  const vx = (-x1p-cxp)/rx, vy = (-y1p-cyp)/ry;
  let theta1 = angleBetween({x:1,y:0}, {x:ux,y:uy});
  let dTheta  = angleBetween({x:ux,y:uy}, {x:vx,y:vy});

  if (!sweep && dTheta > 0)  dTheta -= 2*Math.PI;
  if ( sweep && dTheta < 0)  dTheta += 2*Math.PI;

  // Approximate with cubic bezier segments (≤90° each)
  const nSegs = Math.ceil(Math.abs(dTheta) / (Math.PI/2));
  const result = [];
  for (let s = 0; s < nSegs; s++) {
    const t1 = theta1 + s * dTheta / nSegs;
    const t2 = theta1 + (s+1) * dTheta / nSegs;
    result.push(...arcSegmentToCubic(cx,cy, rx,ry, phi, t1, t2));
  }
  return result;
}

function arcSegmentToCubic(cx,cy, rx,ry, phi, t1, t2) {
  const alpha = Math.sin(t2-t1) * (Math.sqrt(4+3*Math.tan((t2-t1)/2)**2)-1)/3;
  const cos = Math.cos(phi*Math.PI/180), sin = Math.sin(phi*Math.PI/180);
  const p1x = cx + cos*rx*Math.cos(t1) - sin*ry*Math.sin(t1);
  const p1y = cy + sin*rx*Math.cos(t1) + cos*ry*Math.sin(t1);
  const d1x = -cos*rx*Math.sin(t1) - sin*ry*Math.cos(t1);
  const d1y = -sin*rx*Math.sin(t1) + cos*ry*Math.cos(t1);
  const p2x = cx + cos*rx*Math.cos(t2) - sin*ry*Math.sin(t2);
  const p2y = cy + sin*rx*Math.cos(t2) + cos*ry*Math.sin(t2);
  const d2x = -cos*rx*Math.sin(t2) - sin*ry*Math.cos(t2);
  const d2y = -sin*rx*Math.sin(t2) + cos*ry*Math.cos(t2);
  return [[
    p1x + alpha*d1x, p1y + alpha*d1y,
    p2x - alpha*d2x, p2y - alpha*d2y,
    p2x, p2y,
  ]];
}

function angleBetween(u, v) {
  const cross = u.x*v.y - u.y*v.x;
  const dot   = u.x*v.x + u.y*v.y;
  return Math.atan2(cross, dot);
}
