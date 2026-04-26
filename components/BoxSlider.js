// BoxSlider.js — Custom draggable box-slider component
// Visual: outlined rectangle with colored fill representing current value
// Drag left/right to change value; click sets value at click position.

export class BoxSlider {
  /**
   * @param {HTMLElement} parent - where to append
   * @param {object} opts
   *   min, max, step, value, label, unit, color, onChange
   */
  constructor(parent, opts = {}) {
    this.min      = opts.min      ?? 0;
    this.max      = opts.max      ?? 1;
    this.step     = opts.step     ?? 0;        // 0 = continuous
    this.value    = opts.value    ?? this.min;
    this.label    = opts.label    ?? '';
    this.unit     = opts.unit     ?? '';
    this.color    = opts.color    ?? '#6c63ff';
    this.onChange   = opts.onChange   ?? null;
    this.onDragStart = opts.onDragStart ?? null;
    this._startX  = 0;
    this._startVal = 0;

    this.el = document.createElement('div');
    this.el.className = 'box-slider';
    this.el.innerHTML = `
      <span class="bs-label">${this.label}</span>
      <div class="bs-track">
        <div class="bs-fill" style="background:${this.color}"></div>
        <span class="bs-val"></span>
      </div>`;

    this._fill  = this.el.querySelector('.bs-fill');
    this._valEl = this.el.querySelector('.bs-val');
    this._track = this.el.querySelector('.bs-track');

    this._bindDrag();
    this._update();
    parent.appendChild(this.el);
  }

  /** Programmatically set value (does not fire onChange) */
  set(value) {
    this.value = this._clamp(value);
    this._update();
  }

  setColor(color) {
    this.color = color;
    this._fill.style.background = color;
  }

  // ── Private ───────────────────────────────────────

  _clamp(v) {
    let val = Math.max(this.min, Math.min(this.max, v));
    if (this.step) val = Math.round(val / this.step) * this.step;
    return val;
  }

  _update() {
    const range = this.max - this.min;
    const pct   = range === 0 ? 0 : (this.value - this.min) / range * 100;
    this._fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    // Format value display
    const d = this.step && this.step >= 1 ? 0 : 2;
    this._valEl.textContent = this.value.toFixed(d) + this.unit;
  }

  _bindDrag() {
    let dragging = false;

    this._track.addEventListener('pointerdown', (e) => {
      dragging = true;
      this._startX   = e.clientX;
      this._startVal = this.value;
      this._track.setPointerCapture(e.pointerId);
      this.onDragStart?.();
      e.preventDefault();
    });

    this._track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect  = this._track.getBoundingClientRect();
      const range = this.max - this.min;
      const dx    = e.clientX - this._startX;
      // Sensitivity: full track width = full range
      const delta = (dx / rect.width) * range;
      const newVal = this._clamp(this._startVal + delta);
      if (newVal !== this.value) {
        this.value = newVal;
        this._update();
        this.onChange?.(this.value);
      }
    });

    this._track.addEventListener('pointerup', () => { dragging = false; });
    this._track.addEventListener('pointercancel', () => { dragging = false; });

    // Click (no drag) → set to clicked position
    this._track.addEventListener('click', (e) => {
      if (Math.abs(e.clientX - this._startX) > 4) return;
      const rect  = this._track.getBoundingClientRect();
      const range = this.max - this.min;
      const pct   = (e.clientX - rect.left) / rect.width;
      const newVal = this._clamp(this.min + pct * range);
      this.value = newVal;
      this._update();
      this.onChange?.(this.value);
    });

    // Double-click → type a value (no min/max restriction — allow any number)
    this._track.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const rect  = this._track.getBoundingClientRect();
      const input = document.createElement('input');
      input.type  = 'number';
      input.value = this.value;
      input.step  = this.step || 'any';
      // No input.min / input.max — allow negative and out-of-range values
      input.style.cssText = [
        `position:fixed`,
        `left:${rect.left}px`,
        `top:${rect.top}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        `z-index:9999`,
        `background:#151515`,
        `border:1px solid #7b72ff`,
        `color:#e8e8e8`,
        `font-size:10px`,
        `font-family:monospace`,
        `text-align:center`,
        `padding:0`,
        `outline:none`,
      ].join(';');
      document.body.appendChild(input);
      input.focus();
      input.select();
      let _typedHistoryPushed = false;
      const commit = () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          if (!_typedHistoryPushed) { _typedHistoryPushed = true; this.onDragStart?.(); }
          this.value = v;
          this._update();
          this.onChange?.(this.value);
        }
        input.remove();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter')  commit();
        if (ke.key === 'Escape') input.remove();
        ke.stopPropagation();
      });
    });
  }
}
