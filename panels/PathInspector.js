// PathInspector.js — Shows selected path info, operations, and point table

import { resample, splitSegment, mirrorX, mirrorY, createLinkedMirrorClone } from '../modules/PathOperations.js';

export class PathInspector {
  constructor(els, paths, selection, onModified, pushHistory) {
    this.els        = els;
    this.paths      = paths;
    this.selection  = selection;
    this.onModified = onModified;
    this.pushHistory = pushHistory;

    this._bindOps();
    this._bindPointEdit();
  }

  render() {
    const { content, noSel } = this.els;
    const pathId = this.selection.pathId;
    const model  = pathId ? this.paths.get(pathId) : null;

    if (!model) {
      content.hidden = true;
      noSel.hidden   = false;
      return;
    }

    content.hidden = false;
    noSel.hidden   = true;

    this.els.pathId.textContent      = model.id;
    this.els.pointCount.textContent  = model.points.length;

    this._renderTable(model);
    this._renderSelectedPoint(model);
  }

  _renderTable(model) {
    const tbody = this.els.tableBody;
    tbody.innerHTML = '';
    model.points.forEach((pt, i) => {
      const tr = document.createElement('tr');
      const isSelected = this.selection.pointIds.has(pt.id);
      if (isSelected) tr.classList.add('selected');
      tr.innerHTML = `<td>${i}</td><td>${pt.x.toFixed(1)}</td><td>${pt.y.toFixed(1)}</td><td>${pt.type}</td>`;
      tr.addEventListener('click', () => {
        this.selection.pointIds = new Set([pt.id]);
        this.render();
      });
      tbody.appendChild(tr);
    });
  }

  _renderSelectedPoint(model) {
    const detail = this.els.ptDetail;
    const ptId   = [...this.selection.pointIds][0];
    const pt     = model.points.find(p => p.id === ptId);
    if (!pt) { detail.hidden = true; return; }
    detail.hidden = false;
    this.els.ptX.value  = pt.baseX.toFixed(2);
    this.els.ptY.value  = pt.baseY.toFixed(2);
    this.els.ptType.value = pt.type;
  }

  _bindPointEdit() {
    const applyCoord = () => {
      const pathId = this.selection.pathId;
      const model  = pathId ? this.paths.get(pathId) : null;
      if (!model) return;
      const ptId = [...this.selection.pointIds][0];
      const pt   = model.points.find(p => p.id === ptId);
      if (!pt) return;
      const x = parseFloat(this.els.ptX.value);
      const y = parseFloat(this.els.ptY.value);
      if (!isNaN(x)) { pt.baseX = x; pt.x = x; }
      if (!isNaN(y)) { pt.baseY = y; pt.y = y; }
      this.onModified(pathId);
    };

    this.els.ptX.addEventListener('change', applyCoord);
    this.els.ptY.addEventListener('change', applyCoord);

    this.els.ptType.addEventListener('change', () => {
      const pathId = this.selection.pathId;
      const model  = pathId ? this.paths.get(pathId) : null;
      if (!model) return;
      const ptId = [...this.selection.pointIds][0];
      const pt   = model.points.find(p => p.id === ptId);
      if (pt) {
        pt.type = this.els.ptType.value;
        this.onModified(pathId);
      }
    });
  }

  _bindOps() {
    document.getElementById('btn-resample')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      const count = parseInt(document.getElementById('resample-count').value, 10) || 32;
      resample(model, count);
      this.selection.pointIds = new Set();
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-split-point')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      const ptId  = [...this.selection.pointIds][0];
      const ptIdx = model.points.findIndex(p => p.id === ptId);
      if (ptIdx < 0) return;
      // Split the segment starting at this point
      const segIdx = ptIdx === model.points.length - 1 ? ptIdx - 1 : ptIdx;
      splitSegment(model, segIdx, 0.5);
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-mirror-x')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      mirrorX(model);
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-mirror-y')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      this.pushHistory?.();
      mirrorY(model);
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-mirror-linked')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      if (model.mirrorSlaveId) {
        // Already linked — remove slave
        this.paths.delete(model.mirrorSlaveId);
        model.mirrorSlaveId = null;
        model.mirrorAxis    = null;
      } else {
        const clone = createLinkedMirrorClone(model, 'x');
        this.paths.set(clone.id, clone);
      }
      this.onModified(pathId, this.paths);
      this.render();
    });
  }
}
