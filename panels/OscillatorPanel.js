// OscillatorPanel.js — Modulator card list UI
// Supports types: lfo, step, randomwalk, audio, expression, track
// Uses BoxSlider for all continuous parameters.

import { WAVEFORM_NAMES, MODULATOR_TYPES } from '../modules/OscillatorEngine.js';
import { BoxSlider } from '../components/BoxSlider.js';

const NS = 'http://www.w3.org/2000/svg';

const TYPE_LABELS = {
  lfo:        'LFO',
  step:       'Step',
  randomwalk: 'Walk',
  audio:      'Audio',
  expression: 'Expr',
  track:      'Track',
};

export class OscillatorPanel {
  constructor(listEl, engine, onChange, pushHistory) {
    this.listEl       = listEl;
    this.engine       = engine;
    this.onChange     = onChange;
    this.pushHistory  = pushHistory || (() => {});
    this._cards       = new Map(); // oscId → { el, sliders }
  }

  render() {
    // Remove cards whose id is gone OR whose osc object was replaced (e.g. after restore)
    for (const [id, card] of this._cards) {
      const live = this.engine.oscillators.get(id);
      if (!live || live !== card.osc) { card.el.remove(); this._cards.delete(id); }
    }
    // Add cards for any osc not yet represented
    for (const osc of this.engine.oscillators.values()) {
      if (!this._cards.has(osc.id)) this._addCard(osc);
    }
  }

  tick(globalTime) {
    for (const osc of this.engine.oscillators.values()) {
      if (!osc.enabled) continue;
      const card = this._cards.get(osc.id);
      if (!card) continue;
      if (osc.type === 'lfo')  this._tickWaveform(osc, card);
      if (osc.type === 'step') this._tickStepPreview(osc, card);
      if (osc.type === 'randomwalk') this._tickRandomWalkDisplay(osc, card);
    }
  }

  // ── Card factory ──────────────────────────────────────

  _addCard(osc) {
    const card = document.createElement('div');
    card.className = 'osc-card';
    if (!osc.enabled) card.classList.add('osc-disabled');
    card.dataset.oscId = osc.id;

    // Header: enable toggle + color dot + name + type selector + delete
    const header = document.createElement('div');
    header.className = 'osc-card-header';

    // Enable/disable toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'osc-toggle';
    toggleBtn.title = 'Enable / disable';
    toggleBtn.textContent = osc.enabled ? '●' : '○';
    toggleBtn.addEventListener('click', () => {
      osc.enabled = !osc.enabled;
      toggleBtn.textContent = osc.enabled ? '●' : '○';
      card.classList.toggle('osc-disabled', !osc.enabled);
      this.onChange();
    });
    header.appendChild(toggleBtn);

    // Color dot (click to cycle)
    const colorDot = document.createElement('span');
    colorDot.className = 'osc-color-dot';
    colorDot.style.background = osc.color;
    colorDot.title = 'Click to change color';
    colorDot.addEventListener('click', () => {
      const colors = ['#6c63ff','#ff6363','#63ffa0','#ffd163','#63d4ff','#ff63d4','#a0ff63'];
      const idx = colors.indexOf(osc.color);
      osc.color = colors[(idx + 1) % colors.length];
      colorDot.style.background = osc.color;
      this.onChange();
    });
    header.appendChild(colorDot);

    // Name — dblclick to rename inline
    const nameSpan = document.createElement('span');
    nameSpan.className = 'osc-name';
    nameSpan.textContent = osc.name;
    nameSpan.title = 'Double-click to rename';
    this._attachRename(nameSpan, osc);
    header.appendChild(nameSpan);

    // Type selector
    const typeSel = document.createElement('select');
    typeSel.className = 'osc-type-sel';
    typeSel.innerHTML = MODULATOR_TYPES.map(t =>
      `<option value="${t}" ${t === osc.type ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`
    ).join('');
    typeSel.addEventListener('change', (e) => {
      this.pushHistory();
      osc.type = e.target.value;
      this._rebuildBody(osc, body);
      this.onChange();
    });
    header.appendChild(typeSel);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'osc-delete';
    delBtn.title = 'Delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      this.pushHistory();
      this.engine.remove(osc.id);
      card.remove();
      this._cards.delete(osc.id);
      this.onChange();
    });
    header.appendChild(delBtn);

    card.appendChild(header);

    // Type-specific body container
    const body = document.createElement('div');
    body.className = 'osc-body';
    card.appendChild(body);

    this.listEl.appendChild(card);
    const sliders = {};
    this._cards.set(osc.id, { el: card, body, sliders, osc });
    this._rebuildBody(osc, body);
  }

  _attachRename(nameSpan, osc) {
    nameSpan.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.className = 'osc-name-input';
      input.value = osc.name;
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const newName = input.value.trim() || osc.name;
        osc.name = newName;
        const newSpan = document.createElement('span');
        newSpan.className = 'osc-name';
        newSpan.textContent = osc.name;
        newSpan.title = 'Double-click to rename';
        this._attachRename(newSpan, osc);
        input.replaceWith(newSpan);
        this.onChange();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.value = osc.name; commit(); }
      });
    });
  }

  _rebuildBody(osc, body) {
    body.innerHTML = '';
    const card = this._cards.get(osc.id);
    if (!card) return;
    card.sliders = {};

    switch (osc.type) {
      case 'lfo':        this._buildLFO(osc, body, card.sliders);        break;
      case 'step':       this._buildStep(osc, body, card.sliders);        break;
      case 'randomwalk': this._buildRandomWalk(osc, body, card.sliders);  break;
      case 'audio':      this._buildAudio(osc, body, card.sliders);       break;
      case 'expression': this._buildExpression(osc, body, card.sliders);  break;
      case 'track':      this._buildTrack(osc, body, card.sliders);       break;
    }
  }

  // ── LFO ──────────────────────────────────────────────

  _buildLFO(osc, body, sliders) {
    // Waveform preview
    const waveDiv = document.createElement('div');
    waveDiv.className = 'osc-waveform';
    waveDiv.innerHTML = `
      <svg width="100%" height="32" viewBox="0 0 96 32" preserveAspectRatio="none" class="osc-wave-svg">
        <polyline class="osc-wave-poly" fill="none" stroke="${osc.color}" stroke-width="1.5" points=""/>
        <line class="osc-playhead" x1="0" y1="0" x2="0" y2="32" stroke="${osc.color}" stroke-width="1" opacity="0.5"/>
      </svg>`;
    body.appendChild(waveDiv);

    // Waveform buttons
    const waveBtns = document.createElement('div');
    waveBtns.className = 'osc-wave-btns';
    waveBtns.innerHTML = WAVEFORM_NAMES.map(w =>
      `<button data-waveform="${w}" class="${w === osc.waveform ? 'active' : ''}">${w.slice(0,3)}</button>`
    ).join('');
    waveBtns.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        osc.waveform = btn.dataset.waveform;
        waveBtns.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        this._updateWaveformPreview(osc);
        this.onChange();
      });
    });
    body.appendChild(waveBtns);

    // Box sliders
    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.freq = new BoxSlider(params, {
      label: 'Freq', unit: 'Hz', min: 0.01, max: 10, step: 0, value: osc.frequency,
      color: osc.color,
      onChange: v => { osc.frequency = v; this._updateWaveformPreview(osc); this.onChange(); },
    });
    sliders.amp = new BoxSlider(params, {
      label: 'Amp', unit: '', min: 0, max: 500, step: 1, value: osc.amplitude,
      color: osc.color,
      onChange: v => { osc.amplitude = v; this._updateWaveformPreview(osc); this.onChange(); },
    });
    sliders.phase = new BoxSlider(params, {
      label: 'Phase', unit: '', min: 0, max: 1, step: 0, value: osc.phase,
      color: osc.color,
      onChange: v => { osc.phase = v; this._updateWaveformPreview(osc); this.onChange(); },
    });
    sliders.offset = new BoxSlider(params, {
      label: 'Offset', unit: '', min: -300, max: 300, step: 1, value: osc.offset,
      color: osc.color,
      onChange: v => { osc.offset = v; this.onChange(); },
    });
    sliders.curve = new BoxSlider(params, {
      label: 'Curve', unit: '', min: 0.1, max: 4, step: 0, value: osc.curve,
      color: osc.color,
      onChange: v => { osc.curve = v; this._updateWaveformPreview(osc); this.onChange(); },
    });
    body.appendChild(params);
    this._updateWaveformPreview(osc);
  }

  _tickWaveform(osc, card) {
    const ph = card.body.querySelector('.osc-playhead');
    if (!ph) return;
    const phase = (performance.now() / 1000 * osc.frequency + osc.phase) % 1;
    ph.setAttribute('x1', (phase * 96).toFixed(1));
    ph.setAttribute('x2', (phase * 96).toFixed(1));
  }

  _updateWaveformPreview(osc) {
    const card = this._cards.get(osc.id);
    if (!card) return;
    const poly = card.body.querySelector('.osc-wave-poly');
    if (!poly) return;
    const samples = this.engine.sample(osc.id, 96);
    const pts = samples.map((v, i) => `${i},${16 - v * 14}`).join(' ');
    poly.setAttribute('points', pts);
    poly.setAttribute('stroke', osc.color);
    const ph = card.body.querySelector('.osc-playhead');
    if (ph) ph.setAttribute('stroke', osc.color);
  }

  // ── Step Sequencer ────────────────────────────────────

  _buildStep(osc, body, sliders) {
    const patternDiv = document.createElement('div');
    patternDiv.className = 'step-pattern';
    this._renderStepPattern(osc, patternDiv);
    body.appendChild(patternDiv);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.stepCount = new BoxSlider(params, {
      label: 'Steps', unit: '', min: 2, max: 16, step: 1, value: osc.stepCount,
      color: osc.color,
      onChange: v => {
        osc.stepCount = Math.round(v);
        while (osc.stepValues.length < osc.stepCount) osc.stepValues.push(0);
        this._renderStepPattern(osc, patternDiv);
        this.onChange();
      },
    });
    sliders.stepRate = new BoxSlider(params, {
      label: 'Rate', unit: '/beat', min: 0.25, max: 8, step: 0.25, value: osc.stepRate,
      color: osc.color,
      onChange: v => { osc.stepRate = v; this.onChange(); },
    });
    sliders.stepAmp = new BoxSlider(params, {
      label: 'Amp', unit: '', min: 0, max: 500, step: 1, value: osc.stepAmp,
      color: osc.color,
      onChange: v => { osc.stepAmp = v; this.onChange(); },
    });
    body.appendChild(params);
  }

  _renderStepPattern(osc, container) {
    container.innerHTML = '';
    const N = osc.stepCount;
    for (let i = 0; i < N; i++) {
      const cell = document.createElement('div');
      cell.className = 'step-cell';
      const val  = osc.stepValues[i] ?? 0;
      const pct  = (val + 1) / 2 * 100;
      const fill = document.createElement('div');
      fill.className = 'step-fill';
      fill.style.background = osc.color;
      fill.style.height = pct + '%';
      fill.style.bottom = '0';
      cell.appendChild(fill);

      let dragging = false, startY = 0, startVal = val;
      cell.addEventListener('pointerdown', e => {
        dragging = true; startY = e.clientY; startVal = osc.stepValues[i] ?? 0;
        cell.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      cell.addEventListener('pointermove', e => {
        if (!dragging) return;
        const rect = cell.getBoundingClientRect();
        const dy = startY - e.clientY;
        const delta = dy / rect.height * 2;
        const newVal = Math.max(-1, Math.min(1, startVal + delta));
        osc.stepValues[i] = newVal;
        fill.style.height = ((newVal + 1) / 2 * 100) + '%';
        this.onChange();
      });
      cell.addEventListener('pointerup', () => { dragging = false; });
      container.appendChild(cell);
    }
  }

  _tickStepPreview() { /* static display for now */ }

  // ── Random Walk ───────────────────────────────────────

  _buildRandomWalk(osc, body, sliders) {
    const liveDiv = document.createElement('div');
    liveDiv.className = 'osc-live-val';
    liveDiv.textContent = '~';
    body.appendChild(liveDiv);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.rwRate = new BoxSlider(params, {
      label: 'Rate', unit: '/s', min: 0.01, max: 5, step: 0, value: osc.rwRate,
      color: osc.color,
      onChange: v => { osc.rwRate = v; this.onChange(); },
    });
    sliders.rwSmooth = new BoxSlider(params, {
      label: 'Smooth', unit: '', min: 0, max: 0.99, step: 0, value: osc.rwSmooth,
      color: osc.color,
      onChange: v => { osc.rwSmooth = v; this.onChange(); },
    });
    sliders.rwMin = new BoxSlider(params, {
      label: 'Min', unit: '', min: -500, max: 0, step: 1, value: osc.rwMin,
      color: osc.color,
      onChange: v => { osc.rwMin = v; this.onChange(); },
    });
    sliders.rwMax = new BoxSlider(params, {
      label: 'Max', unit: '', min: 0, max: 500, step: 1, value: osc.rwMax,
      color: osc.color,
      onChange: v => { osc.rwMax = v; this.onChange(); },
    });
    body.appendChild(params);
  }

  _tickRandomWalkDisplay(osc, card) {
    const lv = card.body.querySelector('.osc-live-val');
    if (lv) lv.textContent = osc.currentValue.toFixed(1);
  }

  // ── Audio ─────────────────────────────────────────────

  _buildAudio(osc, body, sliders) {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'audio-status';
    statusDiv.textContent = osc._audioActive ? '● Listening' : '○ Mic off';
    body.appendChild(statusDiv);

    const btnRow = document.createElement('div');
    btnRow.className = 'inspector-row';
    btnRow.style.padding = '4px 0';
    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-sm';
    startBtn.style.flex = '1';
    startBtn.textContent = osc._audioActive ? 'Stop Mic' : 'Start Mic';
    startBtn.addEventListener('click', async () => {
      if (osc._audioActive) {
        osc.stopAudio();
        startBtn.textContent = 'Start Mic';
        statusDiv.textContent = '○ Mic off';
      } else {
        startBtn.textContent = 'Connecting…';
        await osc.startAudio();
        startBtn.textContent = osc._audioActive ? 'Stop Mic' : 'Start Mic';
        statusDiv.textContent = osc._audioActive ? '● Listening' : '✕ Denied';
      }
      this.onChange();
    });
    btnRow.appendChild(startBtn);
    body.appendChild(btnRow);

    const bandRow = document.createElement('div');
    bandRow.className = 'inspector-row';
    bandRow.innerHTML = `
      <span class="label" style="width:44px;font-size:10px;color:var(--text-dim)">Band</span>
      <select class="audio-band-sel">
        <option value="all"  ${osc.audioBand==='all'  ? 'selected':''}>All</option>
        <option value="low"  ${osc.audioBand==='low'  ? 'selected':''}>Low</option>
        <option value="mid"  ${osc.audioBand==='mid'  ? 'selected':''}>Mid</option>
        <option value="high" ${osc.audioBand==='high' ? 'selected':''}>High</option>
      </select>`;
    bandRow.querySelector('.audio-band-sel').addEventListener('change', e => {
      osc.audioBand = e.target.value; this.onChange();
    });
    body.appendChild(bandRow);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.audioSmooth = new BoxSlider(params, {
      label: 'Smooth', unit: '', min: 0, max: 0.99, step: 0, value: osc.audioSmooth,
      color: osc.color,
      onChange: v => { osc.audioSmooth = v; this.onChange(); },
    });
    sliders.audioAmp = new BoxSlider(params, {
      label: 'Amp', unit: '', min: 0, max: 500, step: 1, value: osc.audioAmplitude,
      color: osc.color,
      onChange: v => { osc.audioAmplitude = v; this.onChange(); },
    });
    body.appendChild(params);
  }

  // ── Expression ────────────────────────────────────────

  _buildExpression(osc, body, sliders) {
    const hint = document.createElement('div');
    hint.className = 'expr-hint';
    hint.textContent = 'Variable: t (seconds), bpm';
    body.appendChild(hint);

    const textarea = document.createElement('textarea');
    textarea.className = 'expr-input';
    textarea.rows = 3;
    textarea.value = osc.expression;
    textarea.placeholder = 'Math.sin(t * 2 * Math.PI) * 50';
    textarea.addEventListener('change', () => {
      osc.expression = textarea.value;
      osc.invalidateExpr();
      errorDiv.textContent = '';
      this.onChange();
    });
    textarea.addEventListener('keydown', e => e.stopPropagation());
    body.appendChild(textarea);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'expr-error';
    body.appendChild(errorDiv);

    const checkError = setInterval(() => {
      if (!body.isConnected) { clearInterval(checkError); return; }
      errorDiv.textContent = osc._exprError || '';
    }, 500);

    const examples = [
      { label: 'Sine wave ×50',       expr: 'Math.sin(t * 2 * Math.PI) * 50' },
      { label: 'Slow wobble',          expr: 'Math.sin(t * 0.5) * 80' },
      { label: 'Pulsating (sin²)',     expr: 'Math.pow(Math.sin(t * Math.PI), 2) * 100' },
      { label: 'Bounce (abs sin)',     expr: 'Math.abs(Math.sin(t * 2 * Math.PI)) * 60 - 30' },
      { label: 'Double freq beat',     expr: 'Math.sin(t * 2 * Math.PI) * Math.sin(t * 4 * Math.PI) * 60' },
      { label: 'Tremolo (AM)',         expr: '(1 + Math.sin(t * 6 * Math.PI)) * 0.5 * Math.sin(t * 2 * Math.PI) * 50' },
      { label: 'BPM-synced',          expr: '(bpm / 60 > 0 ? Math.sin(t * bpm / 60 * 2 * Math.PI) : 0) * 50' },
      { label: 'Sawtooth ×40',        expr: '(((t * 0.5) % 1) * 2 - 1) * 40' },
      { label: 'Random spike',        expr: '(Math.sin(t * 7.3) > 0.9 ? 80 : 0)' },
      { label: 'Slow drift + fast',   expr: 'Math.sin(t * 0.3) * 40 + Math.sin(t * 3) * 10' },
    ];

    const details = document.createElement('details');
    details.className = 'expr-examples';
    const summary = document.createElement('summary');
    summary.textContent = 'Examples';
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'expr-ex-list';
    for (const ex of examples) {
      const btn = document.createElement('button');
      btn.className = 'expr-ex-btn';
      btn.title     = ex.expr;
      btn.textContent = ex.label;
      btn.addEventListener('click', () => {
        textarea.value  = ex.expr;
        osc.expression  = ex.expr;
        osc.invalidateExpr();
        errorDiv.textContent = '';
        this.onChange();
      });
      list.appendChild(btn);
    }
    details.appendChild(list);
    body.appendChild(details);
  }

  // ── Track (Audio File) ────────────────────────────────

  _buildTrack(osc, body, sliders) {
    // Track name / status
    const statusDiv = document.createElement('div');
    statusDiv.className = 'audio-status';
    statusDiv.textContent = osc.trackName ? `◈ ${osc.trackName}` : '○ No file loaded';
    body.appendChild(statusDiv);

    // Load file button
    const loadRow = document.createElement('div');
    loadRow.className = 'inspector-row';
    loadRow.style.padding = '4px 0';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      osc.trackName = file.name.replace(/\.[^.]+$/, '');
      statusDiv.textContent = `⏳ Loading ${osc.trackName}…`;
      try {
        const buf = await file.arrayBuffer();
        await osc.loadTrack(buf);
        statusDiv.textContent = `◈ ${osc.trackName}`;
        this.onChange();
      } catch(err) {
        statusDiv.textContent = `✕ Error: ${err.message}`;
      }
      e.target.value = '';
    });
    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-sm';
    loadBtn.style.flex = '1';
    loadBtn.textContent = 'Load Audio…';
    loadBtn.addEventListener('click', () => fileInput.click());
    loadRow.appendChild(fileInput);
    loadRow.appendChild(loadBtn);
    body.appendChild(loadRow);

    // Band selector
    const bandRow = document.createElement('div');
    bandRow.className = 'inspector-row';
    bandRow.innerHTML = `
      <span class="label" style="width:44px;font-size:10px;color:var(--text-dim)">Band</span>
      <select class="track-band-sel">
        <option value="all"  ${osc.trackBand==='all'  ? 'selected':''}>All</option>
        <option value="low"  ${osc.trackBand==='low'  ? 'selected':''}>Low</option>
        <option value="mid"  ${osc.trackBand==='mid'  ? 'selected':''}>Mid</option>
        <option value="high" ${osc.trackBand==='high' ? 'selected':''}>High</option>
      </select>`;
    bandRow.querySelector('.track-band-sel').addEventListener('change', e => {
      osc.trackBand = e.target.value; this.onChange();
    });
    body.appendChild(bandRow);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.trackSmooth = new BoxSlider(params, {
      label: 'Smooth', unit: '', min: 0, max: 0.99, step: 0, value: osc.trackSmooth,
      color: osc.color,
      onChange: v => { osc.trackSmooth = v; this.onChange(); },
    });
    sliders.trackAmp = new BoxSlider(params, {
      label: 'Amp', unit: '', min: 0, max: 500, step: 1, value: osc.trackAmplitude,
      color: osc.color,
      onChange: v => { osc.trackAmplitude = v; this.onChange(); },
    });
    body.appendChild(params);
  }
}
