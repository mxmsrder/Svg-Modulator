// OscillatorEngine.js — Multi-type modulator engine
// Types: 'lfo' | 'step' | 'randomwalk' | 'audio' | 'expression' | 'track' | 'envelope' | 'device'
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
export const MODULATOR_TYPES = ['lfo', 'step', 'envelope', 'audio', 'track', 'expression', 'randomwalk', 'device', 'phone'];

// ────────────────────────────────────────────────────
// PhoneDataBus — shared singleton WebSocket connection for all phone-type oscillators
// Prevents N oscillators from opening N parallel WebSocket connections.
// ────────────────────────────────────────────────────
class PhoneDataBus {
  constructor() {
    this._ws          = null;
    this._subscribers = new Set(); // Set<Oscillator>
    this._data        = {};
    this.status       = 'disconnected';
  }

  subscribe(osc) {
    this._subscribers.add(osc);
    osc._phoneData = this._data; // share reference — all subscribers see the same object
    if (!this._ws || this._ws.readyState > 1) this._connect();
    else osc._deviceStatus = this.status;
  }

  unsubscribe(osc) {
    this._subscribers.delete(osc);
    if (this._subscribers.size === 0 && this._ws) {
      this._ws.close();
      this._ws = null;
      this.status = 'disconnected';
    }
  }

  _connect() {
    const host = (typeof location !== 'undefined') ? location.hostname : 'localhost';
    const url  = `wss://${host}:3443/ws`;
    this.status = 'Connecting…';
    this._broadcastStatus();
    try {
      this._ws = new WebSocket(url);
      this._ws.addEventListener('open', () => {
        this._ws.send(JSON.stringify({ role: 'editor' }));
        this.status = 'Waiting for phone…';
        this._broadcastStatus();
      });
      this._ws.addEventListener('close', () => {
        this.status = 'Disconnected — run server.js';
        this._ws = null;
        this._broadcastStatus();
      });
      this._ws.addEventListener('error', () => {
        this.status = 'No server — run: node server.js';
        this._broadcastStatus();
      });
      this._ws.addEventListener('message', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'phone') {
            Object.assign(this._data, d);
            this.status = null;
            this._broadcastStatus();
          }
        } catch {}
      });
    } catch {
      this.status = 'WebSocket unavailable';
      this._broadcastStatus();
    }
  }

  _broadcastStatus() {
    for (const osc of this._subscribers) osc._deviceStatus = this.status;
  }
}

export const phoneBus = new PhoneDataBus();

// ────────────────────────────────────────────────────
// Modulator (supports all types)
// ────────────────────────────────────────────────────
export class Oscillator {
  constructor(params = {}) {
    this.id      = uid('mod');
    this.name    = params.name    || 'Mod 1';
    this.type    = params.type    || 'lfo';    // lfo|step|randomwalk|audio|expression|track|envelope|device
    this.color   = params.color   || randomColor();
    this.enabled = params.enabled ?? true;

    // ── LFO params ──────────────────────────────────
    this.waveform  = params.waveform  || 'sine';
    this.frequency = params.frequency ?? 0.5;   // Hz
    this.amplitude = params.amplitude ?? 50;
    this.phase     = params.phase     ?? 0;     // 0..1
    this.offset    = params.offset    ?? 0;
    // curve: 1 = unchanged, >1 = rounder peaks, <1 = sharper
    this.curve     = params.curve     ?? 1;

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

    // ── Track (audio file) params ────────────────────
    this.trackName      = params.trackName      || '';
    this.trackBand      = params.trackBand      ?? 'all'; // 'low'|'mid'|'high'|'all'
    this.trackSmooth    = params.trackSmooth    ?? 0.8;
    this.trackAmplitude = params.trackAmplitude ?? 100;
    this.trackMuted     = params.trackMuted     ?? false;
    this.trackThreshold = params.trackThreshold ?? 0;    // 0=all pass, 1=peaks only
    this.trackBuffer     = null;    // AudioBuffer — not serialized
    this._trackCtx       = null;
    this._trackSource    = null;
    this._trackAnalyser  = null;
    this._trackGainNode  = null;
    this._trackDataArr   = null;
    this._trackActive    = false;
    this._trackLevel     = 0;

    // ── Envelope params ──────────────────────────────
    this.envPoints    = params.envPoints    ?? [{x:0,y:0},{x:0.3,y:1},{x:0.7,y:0.6},{x:1,y:0}];
    this.envPeriod    = params.envPeriod    ?? 2;      // seconds per cycle (when envRate===0)
    this.envRate      = params.envRate      ?? 0;      // cycles per beat (0 = use envPeriod)
    this.envAmplitude = params.envAmplitude ?? 50;
    this.envSmooth    = params.envSmooth    ?? 0;      // 0=linear, 1=cubic-smooth
    this.envLoop      = params.envLoop      ?? true;
    this.envSnap      = params.envSnap      ?? false;

    // ── Device sensor params ─────────────────────────
    // Phone type defaults to first phone sensor; device type defaults to mouse-x
    this.deviceSensor  = params.deviceSensor  ?? (this.type === 'phone' ? 'phone-orient-alpha' : 'mouse-x');
    this.deviceScale   = params.deviceScale   ?? 1;
    this.deviceSmooth  = params.deviceSmooth  ?? 0.1;
    this._deviceRaw    = 0;
    this._deviceLevel  = 0;
    this._deviceStatus = null; // error/status string for display
    this._batteryMgr   = null;
    this._lightSensor  = null;
    this._mouseX       = 0;  // 0..1
    this._mouseY       = 0;  // 0..1
    this._deviceMouseHandler  = null;
    // Phone (WebSocket bridge) data — shared via PhoneDataBus singleton
    this._phoneData   = {};

    // Runtime output
    this.currentValue = 0;
  }

  // ── Type-specific tick helpers ───────────────────────

  _tickLFO(globalTimeSec) {
    const fn    = WAVEFORMS[this.waveform] || WAVEFORMS.sine;
    const phase = globalTimeSec * this.frequency + this.phase;
    let v = this.offset + this.amplitude * fn(phase);
    // Curve shaping: >1 = rounder, <1 = sharper
    if (this.curve !== 1 && this.amplitude !== 0) {
      const norm   = (v - this.offset) / this.amplitude;
      const shaped = Math.sign(norm) * Math.pow(Math.abs(norm), 1 / Math.max(0.05, this.curve));
      v = this.offset + shaped * this.amplitude;
    }
    this.currentValue = v;
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
    if (!this._audioActive) { this.currentValue = 0; return; }
    if (!this._audioDataArr) return;
    this._audioAnalyser.getByteFrequencyData(this._audioDataArr);
    this.currentValue = this.audioAmplitude * this._readBand(this._audioDataArr, this.audioBand, this._audioLevel, this.audioSmooth);
    this._audioLevel = this.currentValue / (this.audioAmplitude || 1);
  }

  _tickTrack() {
    // Always read analyser even when muted (audio is silenced via GainNode, not here)
    if (!this._trackActive) { this.currentValue = 0; return; }
    if (!this._trackDataArr || !this._trackAnalyser) return;
    this._trackAnalyser.getByteFrequencyData(this._trackDataArr);
    const level = this._readBandRaw(this._trackDataArr, this.trackBand);
    this._trackLevel = this._trackLevel * this.trackSmooth + level * (1 - this.trackSmooth);
    // Threshold: 0 = pass everything, 1 = only peaks (values above threshold)
    const t   = Math.max(0, Math.min(0.999, this.trackThreshold));
    const out = t === 0 ? this._trackLevel : Math.max(0, (this._trackLevel - t) / (1 - t));
    this.currentValue = out * this.trackAmplitude;
  }

  // Read band average from frequency data array, with smoothing
  _readBandRaw(data, band) {
    const len = data.length;
    let start = 0, end = len;
    if      (band === 'low')  { start = 0;                       end = Math.floor(len * 0.1); }
    else if (band === 'mid')  { start = Math.floor(len * 0.1);   end = Math.floor(len * 0.5); }
    else if (band === 'high') { start = Math.floor(len * 0.5);   end = len; }
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i];
    return (sum / (end - start)) / 255;
  }

  _readBand(data, band, prevLevel, smooth) {
    const raw = this._readBandRaw(data, band);
    return prevLevel * smooth + raw * (1 - smooth);
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

  // ── Envelope ─────────────────────────────────────────
  _tickEnvelope(globalTimeSec, bpm) {
    // envRate > 0: beat-synced (cycles per beat); otherwise: envPeriod in seconds
    const period = (this.envRate > 0 && bpm > 0)
      ? (60 / bpm) / this.envRate
      : (this.envPeriod > 0 ? this.envPeriod : 1);
    let phase;
    if (this.envLoop) {
      phase = (globalTimeSec / period) % 1;
    } else {
      phase = Math.max(0, Math.min(1, globalTimeSec / period));
    }

    // Sort points by x
    const pts = this.envPoints.slice().sort((a, b) => a.x - b.x);
    if (pts.length === 0) { this.currentValue = 0; return; }
    if (pts.length === 1) { this.currentValue = pts[0].y * this.envAmplitude; return; }

    // Find surrounding segment
    let i1 = pts.length - 1;
    for (let i = 0; i < pts.length - 1; i++) {
      if (phase <= pts[i + 1].x) { i1 = i + 1; break; }
    }
    const i0 = i1 - 1;
    const p1 = pts[i0];
    const p2 = pts[i1];

    let y;
    const dx = p2.x - p1.x;
    const t  = dx === 0 ? 0 : (phase - p1.x) / dx;

    if (this.envSmooth <= 0) {
      // Linear interpolation
      y = lerp(p1.y, p2.y, t);
    } else {
      // Catmull-Rom spline blended with linear by envSmooth
      const p0 = pts[i0 > 0 ? i0 - 1 : 0];
      const p3 = pts[i1 < pts.length - 1 ? i1 + 1 : pts.length - 1];
      const tension = 0.5;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom basis
      const cr = (
        (-tension * t3 + 2 * tension * t2 - tension * t) * p0.y +
        ((2 - tension) * t3 + (tension - 3) * t2 + 1) * p1.y +
        ((tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t) * p2.y +
        (tension * t3 - tension * t2) * p3.y
      );
      const linear = lerp(p1.y, p2.y, t);
      y = lerp(linear, cr, this.envSmooth);
    }

    this.currentValue = y * this.envAmplitude;
  }

  // ── Device / Sensor ───────────────────────────────────
  _tickDevice(dt) {
    // Raw values in natural units
    const pd = this._phoneData;
    switch (this.deviceSensor) {
      case 'battery':          this._deviceRaw = (this._batteryMgr?.level ?? 0) * 100; break;
      case 'light':            break; // updated by AmbientLightSensor event
      case 'mouse-x':          this._deviceRaw = this._mouseX * 100; break;
      case 'mouse-y':          this._deviceRaw = this._mouseY * 100; break;
      case 'clock':            this._deviceRaw = new Date().getSeconds(); break;
      // Phone sensors (received via WebSocket bridge)
      case 'phone-orient-alpha':   this._deviceRaw = pd.orientAlpha ?? 0; break;
      case 'phone-orient-beta':    this._deviceRaw = pd.orientBeta  ?? 0; break;
      case 'phone-orient-gamma':   this._deviceRaw = pd.orientGamma ?? 0; break;
      case 'phone-accel-x':        this._deviceRaw = pd.accelX  ?? 0; break;
      case 'phone-accel-y':        this._deviceRaw = pd.accelY  ?? 0; break;
      case 'phone-accel-z':        this._deviceRaw = pd.accelZ  ?? 0; break;
      case 'phone-gravity-x':      this._deviceRaw = pd.gravX   ?? 0; break;
      case 'phone-gravity-y':      this._deviceRaw = pd.gravY   ?? 0; break;
      case 'phone-gravity-z':      this._deviceRaw = pd.gravZ   ?? 0; break;
      case 'phone-rotation-alpha': this._deviceRaw = pd.rotAlpha ?? 0; break;
      case 'phone-rotation-beta':  this._deviceRaw = pd.rotBeta  ?? 0; break;
      case 'phone-rotation-gamma': this._deviceRaw = pd.rotGamma ?? 0; break;
      case 'phone-battery':        this._deviceRaw = pd.battery  ?? 0; break;
      case 'phone-touch':          this._deviceRaw = pd.touch    ?? 0; break;
      case 'phone-gps-speed':      this._deviceRaw = pd.gpsSpeed ?? 0; break;
      case 'phone-gps-altitude':   this._deviceRaw = pd.gpsAlt   ?? 0; break;
      default: this._deviceRaw = 0;
    }

    // Exponential smoothing
    const alpha = Math.max(0.001, Math.min(1, this.deviceSmooth));
    this._deviceLevel = this._deviceLevel * (1 - alpha) + this._deviceRaw * alpha;
    // currentValue = smoothed raw × scale  (display shows _deviceLevel, not currentValue)
    this.currentValue = this._deviceLevel * this.deviceScale;
  }

  async initDevice() {
    this._deviceStatus = null;
    switch (this.deviceSensor) {
      case 'battery': {
        try {
          const getBattery = navigator.getBattery?.bind(navigator);
          if (!getBattery) { this._deviceStatus = 'API unavailable'; break; }
          const mgr = await getBattery();
          this._batteryMgr = mgr;
          this._deviceRaw  = mgr.level * 100;
          mgr.addEventListener('levelchange', () => {
            this._deviceRaw = mgr.level * 100;
          });
        } catch (e) {
          this._deviceStatus = 'Battery unavailable';
        }
        break;
      }
      case 'light': {
        if (!window.isSecureContext) { this._deviceStatus = 'Needs HTTPS'; break; }
        try {
          if (!('AmbientLightSensor' in window)) {
            this._deviceStatus = 'Not supported';
            break;
          }
          this._lightSensor = new AmbientLightSensor();
          this._lightSensor.addEventListener('reading', () => {
            this._deviceRaw = this._lightSensor.illuminance;
          });
          this._lightSensor.addEventListener('error', (ev) => {
            this._deviceStatus = ev.error?.name === 'NotAllowedError'
              ? 'Permission denied' : (ev.error?.message ?? 'Sensor error');
          });
          this._lightSensor.start();
        } catch (e) {
          this._deviceStatus = e.name === 'SecurityError' ? 'Permission denied' : 'Not available';
        }
        break;
      }
      case 'mouse-x':
      case 'mouse-y': {
        this._deviceMouseHandler = (e) => {
          this._mouseX = e.clientX / (window.innerWidth  || 1);
          this._mouseY = e.clientY / (window.innerHeight || 1);
        };
        document.addEventListener('mousemove', this._deviceMouseHandler);
        break;
      }
      case 'clock':
        break; // updates every tick via new Date().getSeconds()
      default:
        // Phone sensors — connect via shared PhoneDataBus
        if (this.deviceSensor.startsWith('phone-') || this.type === 'phone') {
          phoneBus.subscribe(this);
        }
    }
  }

  stopDevice() {
    this._deviceStatus = null;
    if (this._deviceMouseHandler) {
      document.removeEventListener('mousemove', this._deviceMouseHandler);
      this._deviceMouseHandler = null;
    }
    if (this._lightSensor) {
      try { this._lightSensor.stop(); } catch {}
      this._lightSensor = null;
    }
    // Unsubscribe from shared phone bus (closes WS only when last subscriber leaves)
    phoneBus.unsubscribe(this);
    this._batteryMgr = null;
  }

  // ── Audio (microphone) ───────────────────────────────
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

  // ── Audio track (file) ───────────────────────────────
  async loadTrack(arrayBuffer) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._trackCtx    = ctx;
    this.trackBuffer  = await ctx.decodeAudioData(arrayBuffer);
  }

  playTrack(offsetSec = 0) {
    if (!this.trackBuffer || !this._trackCtx) return;
    this.stopTrack();
    const analyser  = this._trackCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0;
    // GainNode controls speaker output — analyser is before it so it always reads signal
    const gainNode = this._trackCtx.createGain();
    gainNode.gain.value = this.trackMuted ? 0 : 1;
    const src = this._trackCtx.createBufferSource();
    src.buffer = this.trackBuffer;
    src.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(this._trackCtx.destination);
    const safeOffset = Math.max(0, Math.min(offsetSec, this.trackBuffer.duration));
    src.start(0, safeOffset);
    this._trackSource   = src;
    this._trackAnalyser = analyser;
    this._trackGainNode = gainNode;
    this._trackDataArr  = new Uint8Array(analyser.frequencyBinCount);
    this._trackActive   = true;
  }

  setTrackMute(muted) {
    this.trackMuted = muted;
    if (this._trackGainNode) this._trackGainNode.gain.value = muted ? 0 : 1;
  }

  stopTrack() {
    try { this._trackSource?.stop(); } catch(e) { /* already stopped */ }
    this._trackSource   = null;
    this._trackActive   = false;
    this._trackAnalyser = null;
    this._trackGainNode = null;
    this._trackDataArr  = null;
  }

  disposeTrack() {
    this.stopTrack();
    if (this._trackCtx) { this._trackCtx.close().catch(() => {}); this._trackCtx = null; }
    this.trackBuffer = null;
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
    if (osc) { osc.stopAudio(); osc.disposeTrack?.(); osc.stopDevice?.(); }
    this.oscillators.delete(id);
  }

  get(id) { return this.oscillators.get(id); }

  // dt = frame delta in seconds; bpm from playback state
  tick(globalTimeSec, dt = 0, bpm = 120) {
    for (const osc of this.oscillators.values()) {
      if (!osc.enabled) { osc.currentValue = 0; continue; }
      switch (osc.type) {
        case 'lfo':        osc._tickLFO(globalTimeSec); break;
        case 'step':       osc._tickStep(globalTimeSec, bpm); break;
        case 'randomwalk': osc._tickRandomWalk(dt); break;
        case 'audio':      osc._tickAudio(); break;
        case 'expression': osc._tickExpression(globalTimeSec, bpm); break;
        case 'track':      osc._tickTrack(); break;
        case 'envelope':   osc._tickEnvelope(globalTimeSec, bpm); break;
        case 'device':     osc._tickDevice(dt); break;
        case 'phone':      osc._tickDevice(dt); break;
        default:           osc._tickLFO(globalTimeSec);
      }
    }
  }

  // Sample LFO waveform for waveform preview (applies curve shaping)
  sample(oscId, steps = 64) {
    const osc = this.oscillators.get(oscId);
    if (!osc || osc.type !== 'lfo') return [];
    const fn = WAVEFORMS[osc.waveform] || WAVEFORMS.sine;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      let v = fn(i / steps);
      if (osc.curve !== 1) {
        v = Math.sign(v) * Math.pow(Math.abs(v), 1 / Math.max(0.05, osc.curve));
      }
      pts.push(v);
    }
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
