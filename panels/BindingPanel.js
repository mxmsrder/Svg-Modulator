// BindingPanel.js — Shows active bindings as chips + "Add Binding" button
// Provides a modal-style picker to create new bindings.

import { bindingLabel, PATH_PROPERTIES } from '../modules/BindingSystem.js';

export class BindingPanel {
  constructor(listEl, bindingSystem, engine, paths, selection, onChange) {
    this.listEl    = listEl;
    this.bs        = bindingSystem;
    this.engine    = engine;
    this.paths     = paths;
    this.selection = selection;
    this.onChange  = onChange;
  }

  render() {
    this.listEl.innerHTML = '';

    // Render existing binding chips
    for (const [id, binding] of this.bs.bindings) {
      const osc   = this.engine.oscillators.get(binding.oscillatorId);
      if (!osc) continue;
      const chip  = document.createElement('div');
      chip.className = 'binding-chip';
      chip.innerHTML = `
        <span class="binding-dot" style="background:${osc.color}"></span>
        <span>${osc.name}</span>
        <span style="color:var(--text-dim)">→</span>
        <span>${bindingLabel(binding.target)}</span>
        <button class="binding-remove" title="Remove binding">×</button>`;
      chip.querySelector('.binding-remove').addEventListener('click', () => {
        this.bs.remove(id);
        this.onChange();
        this.render();
      });
      this.listEl.appendChild(chip);
    }

    // "Add Binding" button (only shown when path is selected and oscillators exist)
    if (this.selection.pathId && this.engine.oscillators.size > 0) {
      const addBtn = document.createElement('button');
      addBtn.className = 'add-binding-btn';
      addBtn.textContent = '+ Bind';
      addBtn.addEventListener('click', () => this._showPicker());
      this.listEl.appendChild(addBtn);
    }
  }

  _showPicker() {
    // Remove any existing picker
    document.getElementById('binding-picker')?.remove();

    const model = this.paths.get(this.selection.pathId);
    if (!model) return;

    const picker = document.createElement('div');
    picker.id = 'binding-picker';
    picker.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000;
      display:flex; align-items:center; justify-content:center;`;

    // Build oscillator options
    const oscOptions = [...this.engine.oscillators.values()]
      .map(o => `<option value="${o.id}">${o.name} (${o.waveform})</option>`).join('');

    // Build target options: path-level props + per-point props
    let targetOptions = PATH_PROPERTIES
      .map(p => `<option value="path:${p}">${p}</option>`).join('');

    model.points.forEach((pt, i) => {
      targetOptions += `<option value="pt:${i}:anchor:x">pt[${i}].x</option>`;
      targetOptions += `<option value="pt:${i}:anchor:y">pt[${i}].y</option>`;
      targetOptions += `<option value="pt:${i}:in:x">pt[${i}].handleIn.x</option>`;
      targetOptions += `<option value="pt:${i}:in:y">pt[${i}].handleIn.y</option>`;
      targetOptions += `<option value="pt:${i}:out:x">pt[${i}].handleOut.x</option>`;
      targetOptions += `<option value="pt:${i}:out:y">pt[${i}].handleOut.y</option>`;
    });

    picker.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:280px;display:flex;flex-direction:column;gap:12px;">
        <div style="font-weight:600;font-size:13px;">Add Binding</div>
        <label style="font-size:11px;color:var(--text-dim);">Oscillator
          <select id="bind-osc-sel" style="width:100%;margin-top:4px;">${oscOptions}</select>
        </label>
        <label style="font-size:11px;color:var(--text-dim);">Target Parameter
          <select id="bind-target-sel" style="width:100%;margin-top:4px;">${targetOptions}</select>
        </label>
        <label style="font-size:11px;color:var(--text-dim);">Scale
          <input type="number" id="bind-scale" value="1" step="0.1" style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:3px;color:var(--text);padding:3px 6px;">
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="bind-cancel" class="btn btn-sm">Cancel</button>
          <button id="bind-confirm" class="btn btn-sm" style="background:var(--accent);border-color:var(--accent);">Add</button>
        </div>
      </div>`;

    picker.querySelector('#bind-cancel').addEventListener('click', () => picker.remove());
    picker.addEventListener('click', e => { if (e.target === picker) picker.remove(); });

    picker.querySelector('#bind-confirm').addEventListener('click', () => {
      const oscId  = picker.querySelector('#bind-osc-sel').value;
      const tVal   = picker.querySelector('#bind-target-sel').value;
      const scale  = parseFloat(picker.querySelector('#bind-scale').value) || 1;
      const target = parseTargetValue(tVal, this.selection.pathId);
      if (target) {
        this.bs.add(oscId, target, scale);
        this.onChange();
        this.render();
      }
      picker.remove();
    });

    document.body.appendChild(picker);
  }
}

function parseTargetValue(val, pathId) {
  const parts = val.split(':');
  if (parts[0] === 'path') {
    return { pathId, pointIndex: null, handleRole: null, property: parts[1] };
  } else if (parts[0] === 'pt') {
    const ptIdx      = parseInt(parts[1], 10);
    const handleRole = parts[2] === 'anchor' ? null : parts[2];
    const prop       = parts[3];
    return { pathId, pointIndex: ptIdx, handleRole, property: prop };
  }
  return null;
}
