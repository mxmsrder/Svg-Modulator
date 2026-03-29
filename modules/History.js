// History.js — Undo/redo stack using path snapshots

export class History {
  constructor(maxSize = 50) {
    this._undo = [];
    this._redo = [];
    this._max  = maxSize;
  }

  push(snapshot) {
    this._undo.push(snapshot);
    if (this._undo.length > this._max) this._undo.shift();
    this._redo = [];
    this._updateButtons();
  }

  undo(current) {
    if (!this._undo.length) return null;
    const prev = this._undo.pop();
    this._redo.push(current);
    this._updateButtons();
    return prev;
  }

  redo(current) {
    if (!this._redo.length) return null;
    const next = this._redo.pop();
    this._undo.push(current);
    this._updateButtons();
    return next;
  }

  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }

  _updateButtons() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = !this.canUndo();
    if (r) r.disabled = !this.canRedo();
  }
}
