// BindingPanel.js — Vertical binding matrix for the inspector panel
// Rows = Parameters (path-level + per-point coords)
// Columns = Oscillators
// Each cell: empty → click to bind; filled → scale box + remove

import { PATH_PROPERTIES } from '../modules/BindingSystem.js';
import { BoxSlider } from '../components/BoxSlider.js';

const MAX_PT_ROWS = 24; // max point rows to show

export class BindingPanel {
  constructor(containerEl, bindingSystem, engine, paths, selection, onChange, onHighlight, pushHistory) {
    this.container    = containerEl;
    this.bs           = bindingSystem;
    this.engine       = engine;
    this.paths        = paths;
    this.selection    = selection;
    this.onChange     = onChange;
    this.onHighlight  = onHighlight  || null;
    this.pushHistory  = pushHistory  || (() => {});
  }

  render() {
    this.container.innerHTML = '';

    const selPointIds = this.selection.pointIds;
    const selPathIds  = this.selection.pathIds;

    // Determine which view to show
    // If specific points are selected: show per-point bindings grouped by path
    // Otherwise: show path-level + all-point rows for primary path

    if (selPointIds && selPointIds.size > 0) {
      this._renderPointView(selPointIds, selPathIds);
      return;
    }

    const pathId = this.selection.pathId;
    const model  = pathId ? this.paths.get(pathId) : null;

    if (!model) {
      this._hint('Select a path');
      return;
    }

    if (!this.engine.oscillators.size) {
      this._hint('Add an oscillator');
      return;
    }

    const oscs = [...this.engine.oscillators.values()];
    const rows = this._buildRows(model);
    this._renderTable(rows, oscs);
  }

  // ── Point view: selected points across potentially multiple paths ──

  _renderPointView(selPointIds, selPathIds) {
    if (!this.engine.oscillators.size) {
      this._hint('Add an oscillator');
      return;
    }

    const oscs = [...this.engine.oscillators.values()];

    // Collect rows: for each selected path, gather only the selected points
    const allRows = [];

    for (const pathId of (selPathIds || [])) {
      const model = this.paths.get(pathId);
      if (!model) continue;

      // Path-level properties first (once per path in multi-path mode)
      if ((selPathIds?.size ?? 0) > 1) {
        for (const prop of PATH_PROPERTIES) {
          allRows.push({
            label: `[${model.id.slice(-4)}] ${prop}`,
            group: 'path',
            pathId,
            target: (pid) => ({ pathId: pid, pointIndex: null, handleRole: null, property: prop }),
          });
        }
      }

      // Only selected points on this path
      for (let i = 0; i < model.points.length; i++) {
        const pt = model.points[i];
        if (!selPointIds.has(pt.id)) continue;
        for (const prop of ['x', 'y']) {
          allRows.push({
            label: (selPathIds?.size ?? 0) > 1 ? `[${model.id.slice(-4)}] p${i}.${prop}` : `p${i}.${prop}`,
            group: 'point',
            pathId,
            ptId:  pt.id,
            ptIdx: i,
            target: (pid) => ({ pathId: pid, pointIndex: i, handleRole: null, property: prop }),
          });
        }
      }
    }

    // If only one path selected, also show its path-level params first
    if ((selPathIds?.size ?? 0) <= 1 && this.selection.pathId) {
      const model = this.paths.get(this.selection.pathId);
      if (model) {
        const pathRows = PATH_PROPERTIES.map(prop => ({
          label: prop,
          group: 'path',
          pathId: this.selection.pathId,
          target: (pid) => ({ pathId: pid, pointIndex: null, handleRole: null, property: prop }),
        }));
        allRows.unshift(...pathRows);
      }
    }

    if (!allRows.length) {
      this._hint('No selected points');
      return;
    }

    this._renderTable(allRows, oscs);
  }

  _hint(text) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.fontSize = '11px';
    hint.textContent = text;
    this.container.appendChild(hint);
  }

  _renderTable(rows, oscs) {
    const wrap = document.createElement('div');
    wrap.className = 'bm-v-wrap';

    const table = document.createElement('table');
    table.className = 'bm-v-table';

    // Column headers
    const thead = table.createTHead();
    const hrow  = thead.insertRow();
    const cornerTh = document.createElement('th');
    cornerTh.className = 'bm-v-corner';
    hrow.appendChild(cornerTh);

    for (const osc of oscs) {
      const th = document.createElement('th');
      th.className = 'bm-v-osc-th';
      th.title    = osc.name;
      th.innerHTML = `<span class="bm-osc-dot" style="background:${osc.color}"></span><span class="bm-v-osc-name">${osc.name}</span>`;
      hrow.appendChild(th);
    }

    // Parameter rows
    const tbody = table.createTBody();
    const selIds = this.selection.pointIds;
    const primaryPathId = this.selection.pathId;

    for (const row of rows) {
      const rowPathId = row.pathId || primaryPathId;
      const tr = tbody.insertRow();
      tr.className = row.group === 'path' ? 'bm-v-path-row' : 'bm-v-pt-row';

      const label = document.createElement('td');
      label.className = 'bm-v-param-label';
      if (row.group === 'point' && row.ptId && selIds?.has(row.ptId)) {
        label.classList.add('bm-v-pt-sel');
      }
      label.textContent = row.label;
      label.title = row.label;
      if (row.target && this.onHighlight && rowPathId) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          this.onHighlight(row.target(rowPathId));
        });
        label.addEventListener('mouseleave', () => {
          this.onHighlight(null);
        });
      }
      tr.appendChild(label);

      for (const osc of oscs) {
        const td = document.createElement('td');
        td.className = 'bm-v-cell';

        const target   = row.target(rowPathId);
        const existing = this._findBinding(osc.id, target);

        if (existing) {
          td.classList.add('bm-v-has');
          td.style.setProperty('--bm-col', hexToRgba(osc.color, 0.25));

          const inner = document.createElement('div');
          inner.className = 'bm-v-cell-inner';

          const scaleSlider = new BoxSlider(inner, {
            label: '', unit: '', min: -10, max: 10, step: 0,
            value: existing.scale, color: osc.color,
            onDragStart: () => { this.pushHistory(); },
            onChange: v => { existing.scale = v; this.onChange(); },
          });
          scaleSlider.el.style.padding = '0';

          const rm = document.createElement('button');
          rm.className   = 'bm-cell-rm';
          rm.textContent = '×';
          rm.title       = 'Remove binding';
          rm.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pushHistory();
            this.bs.remove(existing.id);
            this.onChange();
            this.render();
          });
          inner.appendChild(rm);
          td.appendChild(inner);
        } else {
          td.classList.add('bm-v-empty');
          td.title = `Bind ${osc.name} → ${row.label}`;
          td.addEventListener('click', () => {
            this.pushHistory();
            this.bs.add(osc.id, row.target(rowPathId), 1);
            this.onChange();
            this.render();
          });
          const plus = document.createElement('span');
          plus.className   = 'bm-v-plus';
          plus.textContent = '+';
          td.appendChild(plus);
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    this.container.appendChild(wrap);
  }

  // ── Private ─────────────────────────────────────────

  _buildRows(model) {
    const rows = [];
    const pathId = this.selection.pathId;

    for (const prop of PATH_PROPERTIES) {
      rows.push({
        label: prop,
        group: 'path',
        pathId,
        target: (pid) => ({ pathId: pid, pointIndex: null, handleRole: null, property: prop }),
      });
    }

    const n = Math.min(model.points.length, MAX_PT_ROWS);
    for (let i = 0; i < n; i++) {
      const pt = model.points[i];
      for (const prop of ['x', 'y']) {
        rows.push({
          label: `p${i}.${prop}`,
          group: 'point',
          pathId,
          ptId:  pt.id,
          ptIdx: i,
          target: (pid) => ({ pathId: pid, pointIndex: i, handleRole: null, property: prop }),
        });
      }
    }

    return rows;
  }

  _findBinding(oscId, target) {
    for (const b of this.bs.bindings.values()) {
      if (b.oscillatorId !== oscId)          continue;
      if (b.target.pathId     !== target.pathId)     continue;
      if (b.target.property   !== target.property)   continue;
      if (b.target.pointIndex !== target.pointIndex) continue;
      if (b.target.handleRole !== target.handleRole) continue;
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
