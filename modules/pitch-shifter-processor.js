// ==========================================
// PITCH SHIFTER — PHASE VOCODER (STFT) + RESAMPLE
// ==========================================
// Método correcto de pitch shifting por STFT (elimina el sonido metálico):
//   1. Análisis STFT por frames (N=2048, hop Ha=512), ventana Hann simétrica.
//   2. Fase → frecuencia instantánea por bin (unwrap + principal value).
//   3. TIME-STRETCH por factor R (el pitch NO cambia aquí): la fase de
//      síntesis se integra con el hop de síntesis Hs = Ha*R acoplado a la
//      posición entera de escritura (phsinc), y cada frame se escribe al OLA
//      espaciado Hs (duración ×R, tono constante).
//   4. RESAMPLE del resultado: se lee el buffer estirado avanzando R muestras
//      por muestra de salida (interpolación lineal) → tono ×R, duración 1:1.
// La combinación (3)+(4) da exactamente duración preservada y tono ×R.
// Coherencia de fase: PHASE-LOCKING a picos espectrales (Oli Larkin) — cada
// bin hereda la fase acumulada de su pico cercano, preservando la forma de
// onda entre parciales (evita phasiness/chorus en música real).
//
// Cero allocations en el path de audio real.

const FFT_SIZE = 2048;
const ANALYSIS_HOP = 512;
const RING_IN = FFT_SIZE + 512;
const RING_T = FFT_SIZE * 4;
const PEAK_WIN = 6;

function makeHann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = Math.pow(Math.sin((Math.PI * i) / (n - 1)), 2);
  }
  return w;
}

class FFTImpl {
  constructor(n) {
    this.n = n;
    this.logN = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      let v = i;
      for (let b = 0; b < this.logN; b++) {
        r = (r << 1) | (v & 1);
        v >>= 1;
      }
      this.rev[i] = r;
    }
    this.wc = new Float32Array(n >> 1);
    this.ws = new Float32Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      const ang = (-2 * Math.PI * i) / n;
      this.wc[i] = Math.cos(ang);
      this.ws[i] = Math.sin(ang);
    }
  }

  transform(re, im, sign) {
    const { n, logN, rev, wc, ws } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    let half = 1;
    for (let s = 0; s < logN; s++) {
      const step = half << 1;
      for (let i = 0; i < n; i += step) {
        for (let j = 0; j < half; j++) {
          const k = (j * n) / step;
          const wr = wc[k];
          const wi = ws[k] * sign;
          const tr = wr * re[i + j + half] - wi * im[i + j + half];
          const ti = wr * im[i + j + half] + wi * re[i + j + half];
          re[i + j + half] = re[i + j] - tr;
          im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr;
          im[i + j] += ti;
        }
      }
      half = step;
    }
  }
}

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "pitchRatio",
        defaultValue: 1.0,
        minValue: 0.5,
        maxValue: 2.0,
        automationRate: "k-rate"
      }
    ];
  }

  constructor() {
    super();
    this.N = FFT_SIZE;
    this.HA = ANALYSIS_HOP;
    this.hann = makeHann(FFT_SIZE);
    this.fft = new FFTImpl(FFT_SIZE);

    this.frame = new Float32Array(FFT_SIZE);
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);

    this.inRing = [];
    this.ringT = [];
    this.prevPhi = [];
    this.peakAcc = [];
    this.peakIdx = [];
    this.wT = [];
    this.rPos = [];
    this.lastW = [];
    this.magTmp = new Float32Array(FFT_SIZE);
    this.phaseTmp = new Float32Array(FFT_SIZE);

    this.headIn = 0;
    this.frameStart = 0;
  }

  _ensureChannels(n) {
    if (this.inRing.length >= n) return;
    for (let c = this.inRing.length; c < n; c++) {
      this.inRing[c] = new Float32Array(RING_IN);
      this.ringT[c] = new Float32Array(RING_T);
      this.prevPhi[c] = new Float32Array(this.N);
      this.peakAcc[c] = new Float64Array(this.N);
      this.peakIdx[c] = new Int16Array(this.N);
      this.wT[c] = 0;
      this.rPos[c] = 0;
      this.lastW[c] = 0;
    }
  }

  _processFrame(ch, ratio) {
    const N = this.N;
    const HA = this.HA;
    const Hs = HA * ratio;

    const ring = this.inRing[ch];
    const frame = this.frame;
    const re = this.re;
    const im = this.im;

    for (let i = 0; i < N; i++) {
      frame[i] = ring[(this.frameStart + i) % RING_IN] * this.hann[i];
      re[i] = frame[i];
      im[i] = 0;
    }

    this.fft.transform(re, im, -1);

    const prevPhi = this.prevPhi[ch];
    const peakAcc = this.peakAcc[ch];
    const peakIdx = this.peakIdx[ch];
    const magTmp = this.magTmp;
    const phaseTmp = this.phaseTmp;

    // Posición de escritura entera + avance de fase acoplado (phsinc)
    const writeStart = Math.round(this.wT[ch]);
    const phsinc = writeStart - this.lastW[ch];
    this.lastW[ch] = writeStart;
    this.wT[ch] = writeStart + Hs;

    const nyq = N >> 1;
    const twoPi = 2 * Math.PI;

    for (let k = 1; k <= nyq; k++) {
      magTmp[k] = Math.hypot(re[k], im[k]);
      phaseTmp[k] = Math.atan2(im[k], re[k]);
    }

    // Picos espectrales y asignación de bins (phase-locking, Oli Larkin)
    let pmax = 0;
    for (let k = 3; k < nyq - 3; k++) if (magTmp[k] > pmax) pmax = magTmp[k];
    const peakThr = pmax * 0.0005;
    for (let k = 1; k <= nyq; k++) {
      peakIdx[k] = k;
      if (k >= PEAK_WIN && k <= nyq - PEAK_WIN && magTmp[k] > pmax * 0.05) {
        let p = k;
        let bv = magTmp[k];
        for (let j = k - PEAK_WIN; j <= k + PEAK_WIN; j++) {
          if (magTmp[j] > bv) { bv = magTmp[j]; p = j; }
        }
        peakIdx[k] = p;
      }
    }

    // Avanza la fase acumulada de cada pico con su frecuencia instantánea
    for (let k = 1; k <= nyq; k++) {
      if (magTmp[k] <= magTmp[k - 1] || magTmp[k] < magTmp[k + 1]) continue;
      if (k >= nyq - PEAK_WIN) continue;
      if (magTmp[k] < pmax * 0.05) continue;
      const omega = (twoPi * k) / N;
      let delta = phaseTmp[k] - prevPhi[k];
      delta -= twoPi * Math.round(delta / twoPi);
      const instFreq = omega + delta / HA;
      if (instFreq >= Math.PI * 0.98) continue;
      peakAcc[k] += instFreq * phsinc;
    }

    // Síntesis: fase del pico + fase relativa (preserva la forma de onda)
    for (let k = 1; k <= nyq; k++) {
      prevPhi[k] = phaseTmp[k];
      if (magTmp[k] < peakThr) {
        re[k] = 0; im[k] = 0;
        re[N - k] = 0; im[N - k] = 0;
        continue;
      }
      const pk = peakIdx[k];
      const sp = peakAcc[pk] + (phaseTmp[k] - phaseTmp[pk]);
      const cp = Math.cos(sp);
      const sn = Math.sin(sp);
      const m = magTmp[k];
      re[k] = m * cp; im[k] = m * sn;
      re[N - k] = m * cp; im[N - k] = -m * sn;
    }

    re[0] = Math.hypot(re[0], im[0]);
    im[0] = 0;
    re[nyq] = Math.abs(re[nyq]);
    im[nyq] = 0;

    this.fft.transform(re, im, +1);
    for (let i = 0; i < N; i++) re[i] /= N;

    // Overlap-add en el buffer estirado (españado Hs = HA*ratio)
    // Sin escala fija: la normalización se hace por cobertura en la lectura.
    const tRing = this.ringT[ch];
    for (let i = 0; i < N; i++) {
      tRing[(writeStart + i) % RING_T] += re[i] * this.hann[i];
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const block = output[0].length;
    const input = inputs[0];
    const numCh = Math.min(output.length, Math.max(1, input ? input.length : 1), 32);
    this._ensureChannels(numCh);

    const pv = parameters.pitchRatio;
    const raw = pv.length ? pv[0] : 1.0;
    const ratio = Math.max(0.5, Math.min(2.0, raw));

    if (Math.abs(ratio - 1.0) < 0.0001) {
      for (let c = 0; c < numCh; c++) {
        const src = input && input[c] ? input[c] : output[c];
        const dst = output[c];
        for (let i = 0; i < block; i++) dst[i] = src[i] || 0;
      }
      return true;
    }

    // 1. Append de entrada
    for (let c = 0; c < numCh; c++) {
      const src = input && input[c] ? input[c] : null;
      const ring = this.inRing[c];
      for (let i = 0; i < block; i++) {
        ring[(this.headIn + i) % RING_IN] = src ? src[i] || 0 : 0;
      }
    }
    const headIn = this.headIn + block;
    this.headIn = headIn;

    // 2. Procesar frames completos
    while (this.frameStart + this.N <= headIn) {
      for (let c = 0; c < numCh; c++) this._processFrame(c, ratio);
      this.frameStart += this.HA;
    }

    // 3. Resample: leer el buffer estirado avanzando `ratio` por muestra
    //    Normalización por cobertura OLA: divide por Σ w⁴ sobre los frames
    //    que cubren cada punto (frames phase-locked suman coherentemente).
    for (let c = 0; c < numCh; c++) {
      const dst = output[c];
      const tRing = this.ringT[c];
      const avail = this.wT[c] - this.rPos[c];
      const readable = Math.min(block, Math.floor(avail));
      const HsC = this.HA * ratio;
      const piOverN = Math.PI / (this.N - 1);
      for (let i = 0; i < readable; i++) {
        const pos = this.rPos[c] + i * ratio;
        const base = Math.floor(pos);
        const frac = pos - base;
        const i0 = base % RING_T;
        const i1 = (i0 + 1) % RING_T;
        const raw = tRing[i0] * (1 - frac) + tRing[i1] * frac;
        let cov = 0;
        const jLast = Math.floor((pos + (this.N >> 1)) / HsC);
        for (let j = Math.max(0, Math.ceil((pos - (this.N >> 1)) / HsC)); j <= jLast; j++) {
          const xi = pos - j * HsC;
          const wv = Math.sin(piOverN * (xi + (this.N >> 1)));
          cov += wv * wv;
        }
        dst[i] = raw / Math.max(0.2, cov);
      }
      for (let i = readable; i < block; i++) dst[i] = 0;
      this.rPos[c] += readable * ratio;
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
