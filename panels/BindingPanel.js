// BindingPanel.js — Ableton-style binding matrix
// Rows = Oscillators, Columns = Parameters (for selected path)
// Each cell: empty → click to bind; filled → inline scale slider + remove

import { PATH_PROPERTIES } from '../modules/BindingSystem.js';

// Max points to show as columns (can scroll for more)
const MAX_PT_COLS = 20;

export class BindingPanel {
  constructor(containerEl, bindingSystem, engine, paths, selection, onChange) {
    this.container = containerEl;
    this.bs        = bindingSystem;
    this.engine    = engine;
    this.paths     = paths;
    this.selection = selection;
    this.onChange  = onChange;
  }

  render() {
    this.container.innerHTML = '';

    const pathId = this.selection.pathId;
    const model  = pathId ? this.paths.get(pathId) : null;

    if (!model || !this.engine.oscillators.size) {
      const hint = document.createElement('div');
      hint.className = 'binding-empty-hint';
      hint.textContent = !model
        ? 'Click a path to enable bindings'
        : 'Add an oscillator to create bindings';
      this.container.appendChild(hint);
      return;
    }

    // Build column definitions
    const cols = this._buildCols(model);

    // Build table
    const wrap = document.createElement('div');
    wrap.className = 'binding-matrix-wrap';

    const table = document.createElement('table');
    table.className = 'binding-matrix';

    // Header row
    const thead = table.createTHead();
    const hrow  = thead.insertRow();
    const corner = document.createElement('th');
    corner.className = 'bm-corner';
    corner.textContent = '';
    hrow.appendChild(corner);

    for (const col of cols) {
      const th = document.createElement('th');
      th.className    = 'bm-param-col';
      th.textContent  = col.label;
      th.title        = col.label;
      hrow.appendChild(th);
    }

    // Oscillator rows
    const tbody = table.createTBody();
    for (const [oscId, osc] of this.engine.oscillators) {
      const tr = tbody.insertRow();

      // Row header (oscillator name + color)
      const rowHead = document.createElement('td');
      rowHead.className = 'bm-osc-header';
      rowHead.innerHTML = `
        <span class="bm-osc-dot" style="background:${osc.color}"></span>
        <span class="bm-osc-name">${osc.name}</span>`;
      tr.appendChild(rowHead);

      // Cells
      for (const col of cols) {
        const td  = document.createElement('td');
        td.className = 'bm-cell';

        // Find existing binding for this osc × param
        const existing = this._findBinding(oscId, col.target(pathId));

        if (existing) {
          td.classList.add('has-binding');
          td.style.setProperty('--cell-color', hexToRgba(osc.color, 0.18));

          const slider = document.createElement('input');
          slider.type  = 'range';
          slider.min   = -10; slider.max = 10; slider.step = 0.1;
          slider.value = existing.scale;
          slider.title = `Scale: ${(+existing.scale).toFixed(2)}`;
          slider.addEventListener('input', () => {
            existing.scale = parseFloat(slider.value);
            valEl.textContent = (+slider.value).toFixed(1);
            this.onChange();
          });

          const valEl = document.createElement('span');
          valEl.className   = 'bm-cell-val';
          valEl.textContent = (+existing.scale).toFixed(1);

          const rmBtn = document.createElement('button');
          rmBtn.className   = 'bm-cell-rm';
          rmBtn.textContent = '×';
          rmBtn.title       = 'Remove binding';
          rmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.bs.remove(existing.id);
            this.onChange();
            this.render();
          });

          td.appendChild(slider);
          td.appendChild(valEl);
          td.appendChild(rmBtn);
        } else {
          // Empty cell — click to add binding
          td.classList.add('empty-cell');
          td.title = `Bind ${osc.name} → ${col.label}`;
          td.addEventListener('click', () => {
            const target = col.target(pathId);
            this.bs.add(oscId, target, 1);
            this.onChange();
            this.render();
          });

          const plus = document.createElement('span');
          plus.className   = 'bm-cell-plus';
          plus.textContent = '+';
          td.appendChild(plus);
        }

        tr.appendChild(td);
      }
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    this.container.appendChild(wrap);
  }

  // ── Private ────────────────────────────────────────

  _buildCols(model) {
    const cols = [];

    // Path-level columns
    for (const prop of PATH_PROPERTIES) {
      cols.push({
        label:  prop,
        target: (pathId) => ({ pathId, pointIndex: null, handleRole: null, property: prop }),
      });
    }

    // Point columns (x, y for each point)
    const n = Math.min(model.points.length, MAX_PT_COLS);
    for (let i = 0; i < n; i++) {
      for (const prop of ['x', 'y']) {
        cols.push({
          label:  `p${i}.${prop}`,
          target: (pathId) => ({ pathId, pointIndex: i, handleRole: null, property: prop }),
        });
      }
    }

    return cols;
  }

  _findBinding(oscId, target) {
    for (const b of this.bs.bindings.values()) {
      if (b.oscillatorId !== oscId) continue;
      const t = b.target;
      if (t.pathId      !== target.pathId)      continue;
      if (t.property    !== target.property)    continue;
      if (t.pointIndex  !== target.pointIndex)  continue;
      if (t.handleRole  !== target.handleRole)  continue;
      return b;
    }
    return null;
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
