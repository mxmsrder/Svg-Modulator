// PathInspector.js — Path info, operations, and binding matrix
// Point table removed; binding matrix shown inline in vertical orientation.

import { resample, splitSegment, mirrorX, mirrorY, createLinkedMirrorClone } from '../modules/PathOperations.js';

export class PathInspector {
  constructor(els, paths, selection, onModified, pushHistory) {
    this.els        = els;
    this.paths      = paths;
    this.selection  = selection;
    this.onModified = onModified;
    this.pushHistory = pushHistory;

    this._bindOps();
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

    this.els.pathId.textContent     = model.id;
    this.els.pointCount.textContent = model.points.length;
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
      const segIdx = ptIdx === model.points.length - 1 ? ptIdx - 1 : ptIdx;
      splitSegment(model, segIdx, 0.5);
      this.onModified(pathId);
      this.render();
    });

    document.getElementById('btn-remove-point')?.addEventListener('click', () => {
      const pathId = this.selection.pathId;
      const model  = this.paths.get(pathId);
      if (!model) return;
      const ptId  = [...this.selection.pointIds][0];
      const ptIdx = model.points.findIndex(p => p.id === ptId);
      if (ptIdx < 0) return;
      if (model.points.length <= 2) return; // can't remove last 2
      this.pushHistory?.();
      model.points.splice(ptIdx, 1);
      this.selection.pointIds = new Set();
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
