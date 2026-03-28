// OscillatorPanel.js — Oscillator card list UI
// Calls engine.add/remove/update and renders waveform previews.

import { WAVEFORM_NAMES } from '../modules/OscillatorEngine.js';

const NS = 'http://www.w3.org/2000/svg';

export class OscillatorPanel {
  constructor(listEl, engine, onChange) {
    this.listEl   = listEl;
    this.engine   = engine;
    this.onChange = onChange; // called when oscillators change
    this._cards   = new Map(); // oscId → { el, waveformSvg }
  }

  // Render all oscillator cards (full rebuild for simplicity)
  render() {
    // Keep existing cards, add/remove as needed
    const ids = new Set(this.engine.oscillators.keys());

    // Remove stale
    for (const [id, card] of this._cards) {
      if (!ids.has(id)) {
        card.el.remove();
        this._cards.delete(id);
      }
    }

    // Add new / update
    for (const osc of this.engine.oscillators.values()) {
      if (!this._cards.has(osc.id)) {
        this._addCard(osc);
      } else {
        // Update waveform preview
        this._updateWaveform(osc);
      }
    }
  }

  // Update waveform playheads each frame
  tick(globalTime) {
    for (const osc of this.engine.oscillators.values()) {
      const card = this._cards.get(osc.id);
      if (!card) continue;
      // Move playhead line
      const ph = card.el.querySelector('.osc-playhead');
      if (!ph) continue;
      const phase = (globalTime * osc.frequency + osc.phase) % 1;
      ph.setAttribute('x1', (phase * 96).toFixed(1));
      ph.setAttribute('x2', (phase * 96).toFixed(1));
    }
  }

  _addCard(osc) {
    const card = document.createElement('div');
    card.className = 'osc-card';
    card.dataset.oscId = osc.id;

    card.innerHTML = `
      <div class="osc-card-header">
        <span class="osc-color-dot" style="background:${osc.color}"></span>
        <span class="osc-name">${osc.name}</span>
        <button class="osc-delete" title="Delete">×</button>
      </div>
      <div class="osc-waveform">
        <svg width="100%" height="32" viewBox="0 0 96 32" preserveAspectRatio="none" class="osc-wave-svg">
          <polyline class="osc-wave-poly" fill="none" stroke="${osc.color}" stroke-width="1.5" points=""/>
          <line class="osc-playhead" x1="0" y1="0" x2="0" y2="32" stroke="${osc.color}" stroke-width="1" opacity="0.5"/>
        </svg>
      </div>
      <div class="osc-wave-btns">
        ${WAVEFORM_NAMES.map(w =>
          `<button data-waveform="${w}" class="${w === osc.waveform ? 'active' : ''}">${w.slice(0,3)}</button>`
        ).join('')}
      </div>
      <div class="osc-params">
        <div class="param-row">
          <span class="param-label">Freq</span>
          <input type="range" class="param-slider" data-param="frequency" min="0.01" max="10" step="0.01" value="${osc.frequency}">
          <span class="param-value freq-val">${osc.frequency.toFixed(2)}Hz</span>
        </div>
        <div class="param-row">
          <span class="param-label">Amp</span>
          <input type="range" class="param-slider" data-param="amplitude" min="0" max="300" step="1" value="${osc.amplitude}">
          <span class="param-value amp-val">${osc.amplitude.toFixed(0)}</span>
        </div>
        <div class="param-row">
          <span class="param-label">Phase</span>
          <input type="range" class="param-slider" data-param="phase" min="0" max="1" step="0.01" value="${osc.phase}">
          <span class="param-value phase-val">${osc.phase.toFixed(2)}</span>
        </div>
        <div class="param-row">
          <span class="param-label">Offset</span>
          <input type="range" class="param-slider" data-param="offset" min="-200" max="200" step="1" value="${osc.offset}">
          <span class="param-value offset-val">${osc.offset.toFixed(0)}</span>
        </div>
      </div>`;

    // Waveform buttons
    card.querySelectorAll('.osc-wave-btns button').forEach(btn => {
      btn.addEventListener('click', () => {
        osc.waveform = btn.dataset.waveform;
        card.querySelectorAll('.osc-wave-btns button').forEach(b => b.classList.toggle('active', b === btn));
        this._updateWaveform(osc);
        this.onChange();
      });
    });

    // Param sliders
    card.querySelectorAll('.param-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const param = slider.dataset.param;
        osc[param] = parseFloat(slider.value);
        // Update value label
        const row = slider.closest('.param-row');
        const valEl = row.querySelector('.param-value');
        if (param === 'frequency') valEl.textContent = osc.frequency.toFixed(2) + 'Hz';
        else if (param === 'amplitude') valEl.textContent = osc.amplitude.toFixed(0);
        else if (param === 'phase')     valEl.textContent = osc.phase.toFixed(2);
        else if (param === 'offset')    valEl.textContent = osc.offset.toFixed(0);
        this._updateWaveform(osc);
        this.onChange();
      });
    });

    // Delete button
    card.querySelector('.osc-delete').addEventListener('click', () => {
      this.engine.remove(osc.id);
      card.remove();
      this._cards.delete(osc.id);
      this.onChange();
    });

    this.listEl.appendChild(card);
    this._cards.set(osc.id, { el: card });
    this._updateWaveform(osc);
  }

  _updateWaveform(osc) {
    const card = this._cards.get(osc.id);
    if (!card) return;
    const poly = card.el.querySelector('.osc-wave-poly');
    if (!poly) return;
    const samples = this.engine.sample(osc.id, 96);
    const pts = samples.map((v, i) => `${i},${16 - v * 14}`).join(' ');
    poly.setAttribute('points', pts);
  }
}
