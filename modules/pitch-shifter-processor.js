// ==========================================
// PITCH SHIFTER — PHASE VOCODER (STFT) + RESAMPLE
// ==========================================
// Método correcto de pitch shifting por STFT (elimina el sonido metálico):
//   1. Análisis STFT por frames (N=2048, hop Ha=512), ventana Hann simétrica.
//   2. Fase → frecuencia instantánea por bin (unwrap + principal value).
//   3. TIME-STRETCH por factor R (el pitch NO cambia aquí): la fase de
//      síntesis se integra con el hop de síntesis Hs = Ha*R, y cada frame se
//      escribe al OLA espaciado Hs (duración ×R, tono constante).
//   4. RESAMPLE del resultado: se lee el buffer estirado avanzando R muestras
//      por muestra de salida (interpolación lineal) → tono ×R, duración 1:1.
// La combinación (3)+(4) da exactamente duración preservada y tono ×R.
//
// Cero allocations en el path de audio real.

const FFT_SIZE = 2048;
const ANALYSIS_HOP = 512;
const RING_IN = FFT_SIZE + 512;
const RING_T = FFT_SIZE * 4;

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
    this.outPhase = [];
    this.prevMag = [];
    this.wT = [];
    this.rPos = [];

    this.headIn = 0;
    this.frameStart = 0;
  }

  _ensureChannels(n) {
    if (this.inRing.length >= n) return;
    for (let c = this.inRing.length; c < n; c++) {
      this.inRing[c] = new Float32Array(RING_IN);
      this.ringT[c] = new Float32Array(RING_T);
      this.prevPhi[c] = new Float32Array(this.N);
      this.outPhase[c] = new Float32Array(this.N);
      this.prevMag[c] = new Float32Array(this.N);
      this.wT[c] = 0;
      this.rPos[c] = 0;
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
    const outPhase = this.outPhase[ch];
    const prevMag = this.prevMag[ch];

    const nyq = N >> 1;
    const twoPi = 2 * Math.PI;

    for (let k = 1; k <= nyq; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const rawPhase = Math.atan2(im[k], re[k]);
      const omega = (twoPi * k) / N;

      let delta = rawPhase - prevPhi[k];
      delta -= twoPi * Math.round(delta / twoPi);
      const instFreq = omega + delta / HA;

      prevPhi[k] = rawPhase;
      prevMag[k] = mag;

      if (instFreq >= Math.PI * 0.98) {
        re[k] = 0; im[k] = 0;
        re[N - k] = 0; im[N - k] = 0;
        continue;
      }

      // Time-stretch: integra la fase con el hop de síntesis Hs (tono intacto).
      outPhase[k] += instFreq * Hs;
      const magOut = prevMag[k] * 0.35 + mag * 0.65;
      const cp = Math.cos(outPhase[k]);
      const sp = Math.sin(outPhase[k]);

      re[k] = magOut * cp;
      im[k] = magOut * sp;
      re[N - k] = magOut * cp;
      im[N - k] = -magOut * sp;
    }

    re[0] = Math.hypot(re[0], im[0]);
    im[0] = 0;
    re[nyq] = Math.abs(re[nyq]);
    im[nyq] = 0;

    this.fft.transform(re, im, +1);
    for (let i = 0; i < N; i++) re[i] /= N;

    // Overlap-add en el buffer estirado (españado Hs = HA*ratio)
    // Escala ∝ ratio: compensa la reducción de solape OLA cuando Hs crece.
    const olaScale = 1.33 * ratio;
    const writeStart = Math.round(this.wT[ch]);
    const tRing = this.ringT[ch];
    for (let i = 0; i < N; i++) {
      tRing[(writeStart + i) % RING_T] += re[i] * this.hann[i] * olaScale;
    }
    this.wT[ch] = writeStart + Hs;
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

    // 2. Procesar frames completos
    while (this.frameStart + this.N <= headIn) {
      for (let c = 0; c < numCh; c++) this._processFrame(c, ratio);
      this.frameStart += this.HA;
    }

    // 3. Resample: leer el buffer estirado avanzando `ratio` por muestra
    for (let c = 0; c < numCh; c++) {
      const dst = output[c];
      const tRing = this.ringT[c];
      const avail = this.wT[c] - this.rPos[c];
      const readable = Math.min(block, Math.floor(avail));
      for (let i = 0; i < readable; i++) {
        const pos = this.rPos[c] + i * ratio;
        const base = Math.floor(pos);
        const frac = pos - base;
        const i0 = base % RING_T;
        const i1 = (i0 + 1) % RING_T;
        dst[i] = tRing[i0] * (1 - frac) + tRing[i1] * frac;
      }
      for (let i = readable; i < block; i++) dst[i] = 0;
      this.rPos[c] += readable * ratio;
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
