// OscillatorEngine.js — LFO engine with 5 waveforms
// tick(t) is called each rAF frame; updates each oscillator's currentValue.

import { uid } from './PathModel.js';

// ────────────────────────────────────────────────────
// Waveform functions  (input: phase in [0,∞), output: [-1,1])
// ────────────────────────────────────────────────────
const WAVEFORMS = {
  sine:     t => Math.sin(2 * Math.PI * t),
  triangle: t => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * t)),
  square:   t => Math.sign(Math.sin(2 * Math.PI * t)) || 0,
  sawtooth: t => 2 * (t - Math.floor(t + 0.5)),
  noise:    t => {
    const i  = Math.floor(t);
    const f  = t - i;
    const s  = f * f * f * (f * (f * 6 - 15) + 10); // smoothstep
    return lerp(pseudoRandom(i), pseudoRandom(i + 1), s);
  },
};

function pseudoRandom(n) {
  n = (n ^ (n << 13)) ^ n;
  return (((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x3fffffff) - 1;
}

function lerp(a, b, t) { return a + (b - a) * t; }

export const WAVEFORM_NAMES = Object.keys(WAVEFORMS);

// ────────────────────────────────────────────────────
// Oscillator class
// ────────────────────────────────────────────────────
export class Oscillator {
  constructor(params = {}) {
    this.id        = uid('osc');
    this.name      = params.name      || 'LFO';
    this.waveform  = params.waveform  || 'sine';
    this.frequency = params.frequency !== undefined ? params.frequency : 0.5; // Hz
    this.amplitude = params.amplitude !== undefined ? params.amplitude : 50;  // px or unit
    this.phase     = params.phase     !== undefined ? params.phase     : 0;   // 0..1
    this.offset    = params.offset    !== undefined ? params.offset    : 0;
    this.color     = params.color     || randomColor();
    // Runtime
    this.currentValue = 0; // updated each tick, range: [offset - amplitude, offset + amplitude]
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
    this.oscillators.delete(id);
  }

  get(id) { return this.oscillators.get(id); }

  tick(globalTimeSec) {
    for (const osc of this.oscillators.values()) {
      const fn    = WAVEFORMS[osc.waveform] || WAVEFORMS.sine;
      const phase = globalTimeSec * osc.frequency + osc.phase;
      osc.currentValue = osc.offset + osc.amplitude * fn(phase);
    }
  }

  // Sample waveform for visualizer (returns array of y values, length=steps)
  sample(oscId, steps = 64) {
    const osc = this.oscillators.get(oscId);
    if (!osc) return [];
    const fn = WAVEFORMS[osc.waveform] || WAVEFORMS.sine;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      pts.push(fn(i / steps));
    }
    return pts;
  }
}

function randomColor() {
  const colors = ['#6c63ff','#ff6363','#63ffa0','#ffd163','#63d4ff','#ff63d4','#a0ff63'];
  return colors[Math.floor(Math.random() * colors.length)];
}
