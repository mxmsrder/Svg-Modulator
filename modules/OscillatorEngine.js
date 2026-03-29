// OscillatorEngine.js — Multi-type modulator engine
// Types: 'lfo' | 'step' | 'randomwalk' | 'audio' | 'expression'
// tick(globalTimeSec, dt, bpm) → updates each modulator's currentValue

import { uid } from './PathModel.js';

// ────────────────────────────────────────────────────
// LFO Waveform functions  (input: phase ∈ [0,∞), output: [-1,1])
// ────────────────────────────────────────────────────
const WAVEFORMS = {
  sine:     t => Math.sin(2 * Math.PI * t),
  triangle: t => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * t)),
  square:   t => Math.sign(Math.sin(2 * Math.PI * t)) || 0,
  sawtooth: t => 2 * (t - Math.floor(t + 0.5)),
  noise:    t => {
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * f * (f * (f * 6 - 15) + 10); // smoothstep
    return lerp(pseudoRandom(i), pseudoRandom(i + 1), s);
  },
};

function pseudoRandom(n) {
  n = (n ^ (n << 13)) ^ n;
  return (((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x3fffffff) - 1;
}

function lerp(a, b, t) { return a + (b - a) * t; }

export const WAVEFORM_NAMES = Object.keys(WAVEFORMS);
export const MODULATOR_TYPES = ['lfo', 'step', 'randomwalk', 'audio', 'expression'];

// ────────────────────────────────────────────────────
// Modulator (supports all types)
// ────────────────────────────────────────────────────
export class Oscillator {
  constructor(params = {}) {
    this.id    = uid('mod');
    this.name  = params.name  || 'LFO 1';
    this.type  = params.type  || 'lfo';    // lfo|step|randomwalk|audio|expression
    this.color = params.color || randomColor();

    // ── LFO params ──────────────────────────────────
    this.waveform  = params.waveform  || 'sine';
    this.frequency = params.frequency ?? 0.5;   // Hz
    this.amplitude = params.amplitude ?? 50;
    this.phase     = params.phase     ?? 0;     // 0..1
    this.offset    = params.offset    ?? 0;

    // ── Step sequencer params ────────────────────────
    this.stepCount   = params.stepCount   ?? 8;
    this.stepRate    = params.stepRate    ?? 2;  // steps per beat
    this.stepValues  = params.stepValues  ?? Array.from({ length: 8 }, (_, i) =>
      [1, 0.5, 0, -0.5, -1, -0.5, 0, 0.5][i]);
    this.stepAmp     = params.stepAmp     ?? 50;

    // ── Random walk params ───────────────────────────
    this._rwPos     = params.rwPos    ?? 0;    // current position [-1,1]
    this.rwRate     = params.rwRate   ?? 0.5;  // max change per second (normalized)
    this.rwSmooth   = params.rwSmooth ?? 0.1;  // low-pass coefficient per frame
    this.rwMin      = params.rwMin    ?? -50;
    this.rwMax      = params.rwMax    ?? 50;
    this._rwTarget  = this._rwPos;

    // ── Audio (microphone) params ────────────────────
    this.audioBand      = params.audioBand      ?? 'all'; // 'low'|'mid'|'high'|'all'
    this.audioSmooth    = params.audioSmooth    ?? 0.8;
    this.audioAmplitude = params.audioAmplitude ?? 100;
    this._audioAnalyser = null;
    this._audioDataArr  = null;
    this._audioCtx      = null;
    this._audioActive   = false;
    this._audioLevel    = 0;

    // ── Expression params ────────────────────────────
    this.expression = params.expression ?? 'Math.sin(t * 2 * Math.PI) * 50';
    this._exprFn    = null;
    this._exprError = null;

    // Runtime output
    this.currentValue = 0;
  }

  // ── Type-specific tick helpers ───────────────────────

  _tickLFO(globalTimeSec) {
    const fn    = WAVEFORMS[this.waveform] || WAVEFORMS.sine;
    const phase = globalTimeSec * this.frequency + this.phase;
    this.currentValue = this.offset + this.amplitude * fn(phase);
  }

  _tickStep(globalTimeSec, bpm) {
    const beatsPerSec = bpm / 60;
    const stepsPerSec = beatsPerSec * this.stepRate;
    const stepIdx     = Math.floor(globalTimeSec * stepsPerSec) % this.stepCount;
    const v           = this.stepValues[Math.max(0, Math.min(this.stepCount - 1, stepIdx))] ?? 0;
    this.currentValue = v * this.stepAmp;
  }

  _tickRandomWalk(dt) {
    if (dt <= 0) return;
    // Move target randomly
    const maxDelta = this.rwRate * dt * 2;
    this._rwTarget += (Math.random() * 2 - 1) * maxDelta;
    // Bounce off bounds
    const norm = (this.rwMax - this.rwMin) / 2 || 1;
    if (this._rwTarget > 1)  this._rwTarget =  2 - this._rwTarget;
    if (this._rwTarget < -1) this._rwTarget = -2 - this._rwTarget;
    this._rwTarget = Math.max(-1, Math.min(1, this._rwTarget));
    // Low-pass filter toward target
    const alpha = Math.max(0.001, Math.min(1, this.rwSmooth));
    this._rwPos += (this._rwTarget - this._rwPos) * (1 - alpha);
    // Map [-1,1] to [rwMin, rwMax]
    const mid  = (this.rwMax + this.rwMin) / 2;
    const half = (this.rwMax - this.rwMin) / 2;
    this.currentValue = mid + this._rwPos * half;
  }

  _tickAudio() {
    if (!this._audioActive) {
      this.currentValue = 0;
      return;
    }
    if (!this._audioDataArr) return;
    this._audioAnalyser.getByteFrequencyData(this._audioDataArr);
    const data = this._audioDataArr;
    const len  = data.length;

    let start = 0, end = len;
    if      (this.audioBand === 'low')  { start = 0;        end = Math.floor(len * 0.1); }
    else if (this.audioBand === 'mid')  { start = Math.floor(len * 0.1); end = Math.floor(len * 0.5); }
    else if (this.audioBand === 'high') { start = Math.floor(len * 0.5); end = len; }

    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i];
    const rms = (sum / (end - start)) / 255; // 0..1

    this._audioLevel = this._audioLevel * this.audioSmooth + rms * (1 - this.audioSmooth);
    this.currentValue = this._audioLevel * this.audioAmplitude;
  }

  _tickExpression(globalTimeSec, bpm) {
    if (!this._exprFn) {
      try {
        // eslint-disable-next-line no-new-func
        this._exprFn = new Function('t', 'bpm', `"use strict"; return (${this.expression});`);
        this._exprError = null;
      } catch (e) {
        this._exprError = e.message;
        this.currentValue = 0;
        return;
      }
    }
    try {
      const v = this._exprFn(globalTimeSec, bpm);
      this.currentValue = isFinite(v) ? v : 0;
      this._exprError = null;
    } catch (e) {
      this._exprError = e.message;
      this.currentValue = 0;
    }
  }

  // Invalidate cached expression function when expression text changes
  invalidateExpr() { this._exprFn = null; }

  // Start microphone capture
  async startAudio() {
    if (this._audioActive) return;
    try {
      const stream  = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src      = this._audioCtx.createMediaStreamSource(stream);
      this._audioAnalyser = this._audioCtx.createAnalyser();
      this._audioAnalyser.fftSize = 256;
      this._audioAnalyser.smoothingTimeConstant = 0;
      src.connect(this._audioAnalyser);
      this._audioDataArr = new Uint8Array(this._audioAnalyser.frequencyBinCount);
      this._audioActive = true;
    } catch (e) {
      console.warn('Microphone access denied:', e);
    }
  }

  stopAudio() {
    if (this._audioCtx) { this._audioCtx.close().catch(() => {}); this._audioCtx = null; }
    this._audioActive   = false;
    this._audioAnalyser = null;
    this._audioDataArr  = null;
  }
}

// ────────────────────────────────────────────────────
// OscillatorEngine
// ────────────────────────────────────────────────────
export class OscillatorEngine {
  constructor() {
    this.oscillators = new Map(); // id → Oscillator
  }

  add(params = {}) {
    const osc = new Oscillator(params);
    this.oscillators.set(osc.id, osc);
    return osc;
  }

  remove(id) {
    const osc = this.oscillators.get(id);
    if (osc) osc.stopAudio();
    this.oscillators.delete(id);
  }

  get(id) { return this.oscillators.get(id); }

  // dt = frame delta in seconds; bpm from playback state
  tick(globalTimeSec, dt = 0, bpm = 120) {
    for (const osc of this.oscillators.values()) {
      switch (osc.type) {
        case 'lfo':        osc._tickLFO(globalTimeSec); break;
        case 'step':       osc._tickStep(globalTimeSec, bpm); break;
        case 'randomwalk': osc._tickRandomWalk(dt); break;
        case 'audio':      osc._tickAudio(); break;
        case 'expression': osc._tickExpression(globalTimeSec, bpm); break;
        default:           osc._tickLFO(globalTimeSec);
      }
    }
  }

  // Sample LFO waveform for waveform preview
  sample(oscId, steps = 64) {
    const osc = this.oscillators.get(oscId);
    if (!osc) return [];
    if (osc.type !== 'lfo') return [];
    const fn = WAVEFORMS[osc.waveform] || WAVEFORMS.sine;
    const pts = [];
    for (let i = 0; i < steps; i++) pts.push(fn(i / steps));
    return pts;
  }

  // Sample step sequencer pattern for preview
  sampleSteps(oscId) {
    const osc = this.oscillators.get(oscId);
    if (!osc || osc.type !== 'step') return [];
    return osc.stepValues.slice(0, osc.stepCount);
  }
}

function randomColor() {
  const colors = ['#6c63ff','#ff6363','#63ffa0','#ffd163','#63d4ff','#ff63d4','#a0ff63'];
  return colors[Math.floor(Math.random() * colors.length)];
}
