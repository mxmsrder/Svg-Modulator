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
  envelope:   'Env',
  device:     'Device',
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

  tick(globalTime, playing = true) {
    for (const osc of this.engine.oscillators.values()) {
      const card = this._cards.get(osc.id);
      if (!card) continue;
      if (!osc.enabled) continue;
      if (osc.type === 'lfo')        this._tickWaveform(osc, card);
      if (osc.type === 'step')       this._tickStepPreview(osc, card);
      if (osc.type === 'randomwalk') this._tickRandomWalkDisplay(osc, card);
      if (osc.type === 'track')      this._tickTrackViz(osc, card, globalTime);
      if (osc.type === 'envelope')   this._tickEnvelopePreview(osc, card, globalTime);
      if (osc.type === 'device')     this._tickDeviceDisplay(osc, card);
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

    // (type picker is inside body, built by _rebuildBody)

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

    // Type picker — collapsible dropdown
    const typeWrap = document.createElement('div');
    typeWrap.className = 'osc-type-wrap';

    const typeToggle = document.createElement('button');
    typeToggle.className = 'osc-type-toggle';
    typeToggle.innerHTML = `<span class="osc-type-cur">${TYPE_LABELS[osc.type]}</span><span class="osc-type-arrow">▾</span>`;
    typeWrap.appendChild(typeToggle);

    const typeList = document.createElement('div');
    typeList.className = 'osc-type-list';
    for (const t of MODULATOR_TYPES) {
      const item = document.createElement('button');
      item.className = 'osc-type-item' + (t === osc.type ? ' active' : '');
      item.textContent = TYPE_LABELS[t];
      if (t === osc.type) item.style.color = osc.color;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        typeList.classList.remove('open');
        typeToggle.querySelector('.osc-type-arrow').textContent = '▾';
        if (osc.type === t) return;
        this.pushHistory();
        osc.type = t;
        this._rebuildBody(osc, body);
        this.onChange();
      });
      typeList.appendChild(item);
    }
    typeWrap.appendChild(typeList);

    typeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = typeList.classList.toggle('open');
      typeToggle.querySelector('.osc-type-arrow').textContent = open ? '▴' : '▾';
    });
    // Self-cleaning outside-click handler: removes itself once the node leaves the DOM
    const closeOnOutside = (e) => {
      if (!typeWrap.isConnected) { document.removeEventListener('click', closeOnOutside); return; }
      if (!typeWrap.contains(e.target)) {
        typeList.classList.remove('open');
        typeToggle.querySelector('.osc-type-arrow').textContent = '▾';
      }
    };
    document.addEventListener('click', closeOnOutside);

    body.appendChild(typeWrap);

    switch (osc.type) {
      case 'lfo':        this._buildLFO(osc, body, card.sliders);        break;
      case 'step':       this._buildStep(osc, body, card.sliders);        break;
      case 'randomwalk': this._buildRandomWalk(osc, body, card.sliders);  break;
      case 'audio':      this._buildAudio(osc, body, card.sliders);       break;
      case 'expression': this._buildExpression(osc, body, card.sliders);  break;
      case 'track':      this._buildTrack(osc, body, card.sliders);       break;
      case 'envelope':   this._buildEnvelope(osc, body, card.sliders);    break;
      case 'device':     this._buildDevice(osc, body, card.sliders);      break;
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
    // Rekordbox-style spectrum visualizer
    const vizCanvas = document.createElement('canvas');
    vizCanvas.className = 'track-viz';
    vizCanvas.width  = 256;
    vizCanvas.height = 48;
    body.appendChild(vizCanvas);
    this._drawTrackVizIdle(vizCanvas, osc.color);

    // Status row with mute button
    const statusRow = document.createElement('div');
    statusRow.className = 'inspector-row';
    statusRow.style.gap = '6px';

    const statusDiv = document.createElement('div');
    statusDiv.className = 'audio-status';
    statusDiv.style.flex = '1';
    statusDiv.textContent = osc.trackName ? `◈ ${osc.trackName}` : '○ No file loaded';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'btn btn-sm' + (osc.trackMuted ? ' active' : '');
    muteBtn.textContent = osc.trackMuted ? 'MUTED' : 'MUTE';
    muteBtn.addEventListener('click', () => {
      osc.setTrackMute?.(!osc.trackMuted);
      muteBtn.textContent = osc.trackMuted ? 'MUTED' : 'MUTE';
      muteBtn.classList.toggle('active', osc.trackMuted);
      this.onChange();
    });

    statusRow.appendChild(statusDiv);
    statusRow.appendChild(muteBtn);
    body.appendChild(statusRow);

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
    sliders.trackThreshold = new BoxSlider(params, {
      label: 'Thresh', unit: '', min: 0, max: 1, step: 0, value: osc.trackThreshold,
      color: osc.color,
      onChange: v => { osc.trackThreshold = v; this.onChange(); },
    });
    body.appendChild(params);
  }

  // ── Track visualizer ──────────────────────────────────

  _tickTrackViz(osc, card, globalTime) {
    const canvas = card.body.querySelector('.track-viz');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const BARS = 48;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    let data;
    if (osc._trackDataArr && osc._trackActive) {
      // Real frequency data from the analyser
      data = osc._trackDataArr;
    } else {
      // Simulate idle/breathing animation — very low amplitude noise
      data = new Uint8Array(BARS);
      const t = globalTime || (performance.now() / 1000);
      for (let i = 0; i < BARS; i++) {
        const idle = Math.max(0, Math.sin(t * 0.8 + i * 0.4) * 12 + Math.sin(t * 1.7 + i * 0.9) * 6);
        data[i] = idle;
      }
    }

    const step = Math.max(1, Math.floor(data.length / BARS));
    const barW = W / BARS;

    for (let b = 0; b < BARS; b++) {
      // Downsample frequency data to BARS buckets
      let sum = 0;
      for (let k = 0; k < step; k++) sum += data[b * step + k] || 0;
      const norm = (sum / step) / 255; // 0..1

      const barH = Math.max(1, norm * H);
      const x = b * barW;

      // Colour gradient: teal → yellow → red (Rekordbox style)
      const r = norm < 0.6 ? Math.floor(norm / 0.6 * 80)  : Math.floor(80  + (norm - 0.6) / 0.4 * 175);
      const g = norm < 0.5 ? Math.floor(norm / 0.5 * 220) : Math.floor(220 - (norm - 0.5) / 0.5 * 220);
      const bl= norm < 0.4 ? Math.floor(norm / 0.4 * 180) : Math.floor(180 - (norm - 0.4) / 0.6 * 180);
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(Math.floor(x), H - barH, Math.ceil(barW) - 1, barH);

      // Peak dot
      if (norm > 0.05) {
        ctx.fillStyle = `rgba(${r},${g},${bl},0.6)`;
        ctx.fillRect(Math.floor(x), H - barH - 2, Math.ceil(barW) - 1, 1);
      }
    }

    // Playhead / status line at top
    if (osc._trackActive) {
      ctx.fillStyle = osc.color + 'cc';
      ctx.fillRect(0, 0, W, 1);
    }
  }

  _drawTrackVizIdle(canvas, color) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw flat baseline
    ctx.fillStyle = color + '44';
    ctx.fillRect(0, canvas.height - 2, canvas.width, 1);
  }

  // ── Envelope editor ───────────────────────────────────

  _buildEnvelope(osc, body, sliders) {
    const canvas = document.createElement('canvas');
    canvas.className = 'env-canvas';
    canvas.width  = 200;
    canvas.height = 72;
    canvas.style.cursor = 'crosshair';
    body.appendChild(canvas);

    // SNAP + LOOP toggles
    const ctrlRow = document.createElement('div');
    ctrlRow.className = 'osc-wave-btns';
    ctrlRow.style.marginBottom = '4px';

    const snapBtn = document.createElement('button');
    snapBtn.textContent = 'SNAP';
    if (osc.envSnap) snapBtn.classList.add('active');
    snapBtn.addEventListener('click', () => {
      osc.envSnap = !osc.envSnap;
      snapBtn.classList.toggle('active', osc.envSnap);
      draw();
      this.onChange();
    });

    const loopBtn = document.createElement('button');
    loopBtn.textContent = 'LOOP';
    if (osc.envLoop) loopBtn.classList.add('active');
    loopBtn.addEventListener('click', () => {
      osc.envLoop = !osc.envLoop;
      loopBtn.classList.toggle('active', osc.envLoop);
      this.onChange();
    });

    ctrlRow.appendChild(snapBtn);
    ctrlRow.appendChild(loopBtn);
    body.appendChild(ctrlRow);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.envRate = new BoxSlider(params, {
      label: 'Rate', unit: '/beat', min: 0, max: 8, step: 0.0625, value: osc.envRate,
      color: osc.color,
      onDragStart: () => this.pushHistory(),
      onChange: v => { osc.envRate = v; this.onChange(); },
    });
    sliders.envPeriod = new BoxSlider(params, {
      label: 'Period', unit: 's', min: 0.1, max: 60, step: 0, value: osc.envPeriod,
      color: osc.color,
      onDragStart: () => this.pushHistory(),
      onChange: v => { osc.envPeriod = v; this.onChange(); },
    });
    sliders.envAmp = new BoxSlider(params, {
      label: 'Amp', unit: '', min: 0, max: 500, step: 1, value: osc.envAmplitude,
      color: osc.color,
      onChange: v => { osc.envAmplitude = v; this.onChange(); },
    });
    sliders.envSmooth = new BoxSlider(params, {
      label: 'Smooth', unit: '', min: 0, max: 1, step: 0, value: osc.envSmooth,
      color: osc.color,
      onChange: v => { osc.envSmooth = v; draw(); this.onChange(); },
    });
    body.appendChild(params);

    // ── Canvas drawing ────────────────────────────────
    const SNAP_N = 8;
    const PX = 8, PY = 6;
    const W = canvas.width, H = canvas.height;
    const cW = W - PX * 2, cH = H - PY * 2;

    function toC(p) {
      return { x: PX + p.x * cW, y: PY + (1 - p.y) * cH };
    }
    function fromC(cx, cy) {
      return {
        x: Math.max(0, Math.min(1, (cx - PX) / cW)),
        y: Math.max(0, Math.min(1, 1 - (cy - PY) / cH)),
      };
    }
    function snapV(v) { return osc.envSnap ? Math.round(v * SNAP_N) / SNAP_N : v; }

    function draw(playPhase) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);

      if (osc.envSnap) {
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 0.5;
        for (let i = 1; i < SNAP_N; i++) {
          const gx = PX + i / SNAP_N * cW;
          const gy = PY + i / SNAP_N * cH;
          ctx.beginPath(); ctx.moveTo(gx, PY); ctx.lineTo(gx, PY + cH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(PX, gy); ctx.lineTo(PX + cW, gy); ctx.stroke();
        }
      }

      const pts = osc.envPoints.slice().sort((a, b) => a.x - b.x);

      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = osc.color;
        ctx.lineWidth = 1.5;
        for (let s = 0; s <= cW; s++) {
          const phase = s / cW;
          let i1 = pts.length - 1;
          for (let i = 0; i < pts.length - 1; i++) {
            if (phase <= pts[i + 1].x) { i1 = i + 1; break; }
          }
          const i0 = i1 - 1;
          const p1 = pts[i0], p2 = pts[i1];
          const dpx = p2.x - p1.x;
          const t   = dpx === 0 ? 0 : (phase - p1.x) / dpx;
          let y;
          if (osc.envSmooth <= 0) {
            y = p1.y + (p2.y - p1.y) * t;
          } else {
            const p0  = pts[i0 > 0 ? i0 - 1 : 0];
            const p3  = pts[i1 < pts.length - 1 ? i1 + 1 : pts.length - 1];
            const ten = 0.5, t2 = t * t, t3 = t2 * t;
            const cr  = (-ten * t3 + 2 * ten * t2 - ten * t) * p0.y
              + ((2 - ten) * t3 + (ten - 3) * t2 + 1) * p1.y
              + ((ten - 2) * t3 + (3 - 2 * ten) * t2 + ten * t) * p2.y
              + (ten * t3 - ten * t2) * p3.y;
            y = p1.y + (p2.y - p1.y) * t * (1 - osc.envSmooth) + cr * osc.envSmooth;
          }
          const cy2 = PY + (1 - y) * cH;
          if (s === 0) ctx.moveTo(PX, cy2); else ctx.lineTo(PX + s, cy2);
        }
        ctx.stroke();
      }

      for (const p of osc.envPoints) {
        const { x: cx, y: cy } = toC(p);
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = osc.color;
        ctx.fill();
      }

      if (playPhase !== undefined) {
        const ph = PX + playPhase * cW;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(ph, PY); ctx.lineTo(ph, PY + cH); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    draw();
    canvas._envDraw = draw;

    // ── Pointer interaction ───────────────────────────
    let _dragIdx = -1;
    let _pdX = 0, _pdY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * W / rect.width;
      const cy = (e.clientY - rect.top)  * H / rect.height;
      _pdX = e.clientX; _pdY = e.clientY;
      _dragIdx = -1;
      for (let i = 0; i < osc.envPoints.length; i++) {
        const c = toC(osc.envPoints[i]);
        if (Math.hypot(cx - c.x, cy - c.y) < 10) { _dragIdx = i; break; }
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (_dragIdx < 0) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * W / rect.width;
      const cy = (e.clientY - rect.top)  * H / rect.height;
      const p = fromC(cx, cy);
      osc.envPoints[_dragIdx].x = snapV(p.x);
      osc.envPoints[_dragIdx].y = snapV(p.y);
      draw();
      this.onChange();
    });

    canvas.addEventListener('pointerup',     () => { _dragIdx = -1; });
    canvas.addEventListener('pointercancel', () => { _dragIdx = -1; });

    canvas.addEventListener('click', (e) => {
      if (Math.hypot(e.clientX - _pdX, e.clientY - _pdY) > 4) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * W / rect.width;
      const cy = (e.clientY - rect.top)  * H / rect.height;
      for (const p of osc.envPoints) {
        if (Math.hypot(cx - toC(p).x, cy - toC(p).y) < 10) return;
      }
      const p = fromC(cx, cy);
      osc.envPoints.push({ x: snapV(p.x), y: snapV(p.y) });
      draw();
      this.onChange();
    });

    canvas.addEventListener('dblclick', (e) => {
      if (osc.envPoints.length <= 2) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * W / rect.width;
      const cy = (e.clientY - rect.top)  * H / rect.height;
      let nearest = -1, minDist = 12;
      for (let i = 0; i < osc.envPoints.length; i++) {
        const c = toC(osc.envPoints[i]);
        const d = Math.hypot(cx - c.x, cy - c.y);
        if (d < minDist) { minDist = d; nearest = i; }
      }
      if (nearest >= 0) { osc.envPoints.splice(nearest, 1); draw(); this.onChange(); }
    });
  }

  _tickEnvelopePreview(osc, card, globalTime) {
    const canvas = card.body.querySelector('.env-canvas');
    if (!canvas?._envDraw) return;
    const period = osc.envPeriod > 0 ? osc.envPeriod : 1;
    const phase  = osc.envLoop
      ? (globalTime / period) % 1
      : Math.max(0, Math.min(1, globalTime / period));
    canvas._envDraw(phase);
  }

  // ── Device / Sensor ───────────────────────────────────

  _buildDevice(osc, body, sliders) {
    const liveDiv = document.createElement('div');
    liveDiv.className = 'osc-live-val';
    liveDiv.textContent = '~';
    body.appendChild(liveDiv);

    const sensorRow = document.createElement('div');
    sensorRow.className = 'inspector-row';
    sensorRow.style.paddingBottom = '4px';

    const SENSORS = [
      // Desktop
      ['mouse-x',              'Mouse X (0-100)'],
      ['mouse-y',              'Mouse Y (0-100)'],
      ['battery',              'Battery (0-100%)'],
      ['clock',                'Clock (0-59 sec)'],
      ['light',                'Ambient Light (lux)'],
      // Phone via WebSocket bridge (server.js)
      ['phone-orient-alpha',   'Phone: Compass/Yaw (0-360°)'],
      ['phone-orient-beta',    'Phone: Front/Back tilt (±180°)'],
      ['phone-orient-gamma',   'Phone: Left/Right tilt (±90°)'],
      ['phone-accel-x',        'Phone: Accel X (m/s²)'],
      ['phone-accel-y',        'Phone: Accel Y (m/s²)'],
      ['phone-accel-z',        'Phone: Accel Z (m/s²)'],
      ['phone-gravity-x',      'Phone: Gravity X (m/s²)'],
      ['phone-gravity-y',      'Phone: Gravity Y (m/s²)'],
      ['phone-gravity-z',      'Phone: Gravity Z (m/s²)'],
      ['phone-rotation-alpha', 'Phone: Gyro Yaw (°/s)'],
      ['phone-rotation-beta',  'Phone: Gyro Pitch (°/s)'],
      ['phone-rotation-gamma', 'Phone: Gyro Roll (°/s)'],
      ['phone-battery',        'Phone: Battery (0-100%)'],
      ['phone-touch',          'Phone: Touch (0/1)'],
      ['phone-gps-speed',      'Phone: GPS Speed (m/s)'],
      ['phone-gps-altitude',   'Phone: GPS Altitude (m)'],
    ];
    const sel = document.createElement('select');
    sel.style.flex = '1';
    for (const [val, label] of SENSORS) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (osc.deviceSensor === val) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', async (e) => {
      osc.stopDevice?.();
      osc.deviceSensor  = e.target.value;
      osc._deviceRaw    = 0;
      osc._deviceLevel  = 0;
      await osc.initDevice?.();
      infoBtn.style.display = e.target.value.startsWith('phone-') ? '' : 'none';
      this.onChange();
    });
    sensorRow.appendChild(sel);

    // Info button for phone sensors
    const infoBtn = document.createElement('button');
    infoBtn.className = 'osc-info-btn';
    infoBtn.textContent = 'ℹ';
    infoBtn.title = 'How to connect iPhone';
    infoBtn.style.display = osc.deviceSensor.startsWith('phone-') ? '' : 'none';
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showPhoneInfo(infoBtn);
    });
    sensorRow.appendChild(infoBtn);

    body.appendChild(sensorRow);

    const params = document.createElement('div');
    params.className = 'osc-params';
    sliders.deviceScale = new BoxSlider(params, {
      label: 'Scale', unit: '×', min: 0, max: 50, step: 0, value: osc.deviceScale,
      color: osc.color,
      onChange: v => { osc.deviceScale = v; this.onChange(); },
    });
    sliders.deviceSmooth = new BoxSlider(params, {
      label: 'Smooth', unit: '', min: 0, max: 0.99, step: 0, value: osc.deviceSmooth,
      color: osc.color,
      onChange: v => { osc.deviceSmooth = v; this.onChange(); },
    });
    body.appendChild(params);

    osc.stopDevice?.();
    osc.initDevice?.();
  }

  _tickDeviceDisplay(osc, card) {
    const lv = card.body.querySelector('.osc-live-val');
    if (!lv) return;
    if (osc._deviceStatus) {
      lv.textContent = osc._deviceStatus;
    } else {
      lv.textContent = osc._deviceLevel.toFixed(1);
    }
  }

  _showPhoneInfo(anchorEl) {
    // Remove any existing popover
    document.querySelector('.phone-info-popover')?.remove();

    const host = location.hostname || 'your-ip';
    const url  = `https://${host}:3443/phone.html`;

    const pop = document.createElement('div');
    pop.className = 'phone-info-popover';
    pop.innerHTML = `
      <div class="pip-title">Connect iPhone</div>
      <div class="pip-step">1. On your computer, run:<br><code>node server.js</code></div>
      <div class="pip-step">2. Open on iPhone (Safari):<br><a class="pip-url" href="${url}" target="_blank">${url}</a></div>
      <div class="pip-step">3. Tap <b>Start Sharing</b> and allow sensor access.</div>
      <div class="pip-step">4. Both devices must be on the same Wi-Fi.</div>
      <button class="pip-close">✕</button>
    `;
    pop.querySelector('.pip-close').addEventListener('click', () => pop.remove());
    document.body.appendChild(pop);

    // Position near the anchor
    const rect = anchorEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + 6) + 'px';
    pop.style.left = Math.max(8, rect.left - 160) + 'px';

    // Close on outside click
    setTimeout(() => {
      const close = (e) => {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 0);
  }
}
