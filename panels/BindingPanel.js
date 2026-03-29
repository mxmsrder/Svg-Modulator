// BindingPanel.js — Vertical binding matrix for the inspector panel
// Rows = Parameters (path-level + per-point coords)
// Columns = Oscillators
// Each cell: empty → click to bind; filled → scale box + remove

import { PATH_PROPERTIES } from '../modules/BindingSystem.js';
import { BoxSlider } from '../components/BoxSlider.js';

const MAX_PT_ROWS = 24; // max point rows to show

export class BindingPanel {
  constructor(containerEl, bindingSystem, engine, paths, selection, onChange, onHighlight) {
    this.container   = containerEl;
    this.bs          = bindingSystem;
    this.engine      = engine;
    this.paths       = paths;
    this.selection   = selection;
    this.onChange    = onChange;
    this.onHighlight = onHighlight || null; // fn(target | null) → highlight in viewer
  }

  render() {
    this.container.innerHTML = '';

    const pathId = this.selection.pathId;
    const model  = pathId ? this.paths.get(pathId) : null;

    if (!model) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.style.fontSize = '11px';
      hint.textContent = 'Select a path';
      this.container.appendChild(hint);
      return;
    }

    if (!this.engine.oscillators.size) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.style.fontSize = '11px';
      hint.textContent = 'Add an oscillator';
      this.container.appendChild(hint);
      return;
    }

    const oscs = [...this.engine.oscillators.values()];
    const rows = this._buildRows(model);

    // Outer scroll wrapper
    const wrap = document.createElement('div');
    wrap.className = 'bm-v-wrap';

    const table = document.createElement('table');
    table.className = 'bm-v-table';

    // ── Column headers (oscillator names) ──────────────
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

    // ── Parameter rows ─────────────────────────────────
    const tbody = table.createTBody();

    for (const row of rows) {
      const tr = tbody.insertRow();
      tr.className = row.group === 'path' ? 'bm-v-path-row' : 'bm-v-pt-row';

      // Row label
      const label = document.createElement('td');
      label.className = 'bm-v-param-label';
      label.textContent = row.label;
      label.title = row.label;
      // Click label → highlight point in viewer
      if (row.target && this.onHighlight) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          this.onHighlight(row.target(pathId));
        });
        label.addEventListener('mouseleave', () => {
          this.onHighlight(null);
        });
      }
      tr.appendChild(label);

      // Oscillator cells
      for (const osc of oscs) {
        const td = document.createElement('td');
        td.className = 'bm-v-cell';

        const target = row.target(pathId);
        const existing = this._findBinding(osc.id, target);

        if (existing) {
          td.classList.add('bm-v-has');
          td.style.setProperty('--bm-col', hexToRgba(osc.color, 0.25));

          // Compact scale: box slider + remove
          const inner = document.createElement('div');
          inner.className = 'bm-v-cell-inner';

          const scaleSlider = new BoxSlider(inner, {
            label: '', unit: '', min: -10, max: 10, step: 0,
            value: existing.scale, color: osc.color,
            onChange: v => { existing.scale = v; this.onChange(); },
          });
          // Make slider compact
          scaleSlider.el.style.padding = '0';

          const rm = document.createElement('button');
          rm.className   = 'bm-cell-rm';
          rm.textContent = '×';
          rm.title       = 'Remove binding';
          rm.addEventListener('click', (e) => {
            e.stopPropagation();
            this.bs.remove(existing.id);
            this.onChange();
            this.render();
          });
          inner.appendChild(rm);
          td.appendChild(inner);
        } else {
          // Empty — click to add
          td.classList.add('bm-v-empty');
          td.title = `Bind ${osc.name} → ${row.label}`;
          td.addEventListener('click', () => {
            this.bs.add(osc.id, row.target(pathId), 1);
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

    // Path-level rows
    for (const prop of PATH_PROPERTIES) {
      rows.push({
        label: prop,
        group: 'path',
        target: (pathId) => ({ pathId, pointIndex: null, handleRole: null, property: prop }),
      });
    }

    // Per-point rows
    const n = Math.min(model.points.length, MAX_PT_ROWS);
    for (let i = 0; i < n; i++) {
      for (const prop of ['x', 'y']) {
        rows.push({
          label: `p${i}.${prop}`,
          group: 'point',
          target: (pathId) => ({ pathId, pointIndex: i, handleRole: null, property: prop }),
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
