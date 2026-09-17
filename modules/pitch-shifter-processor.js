// ==========================================
// PITCH SHIFTER — PHASE VOCODER (STFT) + RESAMPLE
// ==========================================
// Método correcto de pitch shifting por STFT (elimina el sonido metálico):
//   1. Análisis STFT por frames (N=2048, hop Ha=512), ventana Hann simétrica.
//   2. Fase → frecuencia instantánea por bin (unwrap + principal value).
//   3. TIME-STRETCH por factor R (el pitch NO cambia aquí): la fase de
//      síntesis se integra con el hop de síntesis Hs = Ha*R acoplado a la
//      posición entera de escritura (phsinc), y cada frame se escribe al OLA
//      espaciado Hs (duración ×R, tono constante) con escala 1.33·R.
//   4. RESAMPLE del resultado: se lee el buffer estirado avanzando R muestras
//      por muestra de salida (interpolación lineal) → tono ×R, duración 1:1.
// La combinación (3)+(4) da exactamente duración preservada y tono ×R.
// Coherencia de fase por bin (sin phase-locking): la frecuencia instantánea
// se acopla a la posición entera de escritura (phsinc) y se acumula en un
// registro Float64 para evitar pérdida de precisión (sonido tembloroso).
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
    this.instSm = [];
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
      this.outPhase[c] = new Float64Array(this.N);
      this.prevMag[c] = new Float32Array(this.N);
      this.instSm[c] = new Float32Array(this.N);
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
    const outPhase = this.outPhase[ch];
    const prevMag = this.prevMag[ch];
    const instSm = this.instSm[ch];
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

    // Síntesis por bin: frecuencia instantánea → avance de fase acoplado
    // a la posición de escritura, acumulada en Float64 (evita el temblor).
    for (let k = 1; k <= nyq; k++) {
      const omega = (twoPi * k) / N;
      let delta = phaseTmp[k] - prevPhi[k];
      delta -= twoPi * Math.round(delta / twoPi);
      const instFreq = omega + delta / HA;
      prevPhi[k] = phaseTmp[k];
      if (instFreq < 0 || instFreq >= Math.PI * 0.98) {
        re[k] = 0; im[k] = 0;
        re[N - k] = 0; im[N - k] = 0;
        continue;
      }
      // Suavizado de magnitud bin a bin: leer el previo ANTES de actualizar
      const oldM = prevMag[k];
      const instF = instSm[k] + 0.5 * (instFreq - instSm[k]);
      instSm[k] = instF;
      outPhase[k] += instF * phsinc;
      const m = oldM + 0.5 * (magTmp[k] - oldM);
      prevMag[k] = magTmp[k];
      const sp = outPhase[k];
      const cp = Math.cos(sp);
      const sn = Math.sin(sp);
      re[k] = m * cp; im[k] = m * sn;
      re[N - k] = m * cp; im[N - k] = -m * sn;
    }

    re[0] = Math.hypot(re[0], im[0]);
    im[0] = 0;
    re[nyq] = Math.abs(re[nyq]);
    im[nyq] = 0;

    this.fft.transform(re, im, +1);
    for (let i = 0; i < N; i++) re[i] /= N;

    // Overlap-add en el buffer estirado (espaciado Hs = HA*ratio)
    // OlaScale calibrado sobre la normalización por cobertura de la lectura.
    const tRing = this.ringT[ch];
    const olaScale = 2.56;
    for (let i = 0; i < N; i++) {
      tRing[(writeStart + i) % RING_T] += re[i] * this.hann[i] * olaScale;
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

    // 1b. Rebase deslizante: evita que el OLA se corrompa al dar la vuelta
    //     al anillo (frames de épocas distintas caerían en los mismos índices).
    //     Copia la región activa hacia abajo y resetea topes (posiciones relativas).
    {
      const margin = this.N + 512 + 1024;
      for (let c = 0; c < numCh; c++) {
        if (this.wT[c] >= RING_T - margin) {
          const shift = Math.floor(RING_T / 2);
          if (this.rPos[c] >= shift) {
            this.ringT[c].copyWithin(0, shift, RING_T);
            this.ringT[c].fill(0, RING_T - shift);
            this.wT[c] -= shift;
            this.rPos[c] -= shift;
            this.lastW[c] -= shift;
          } else {
            this.ringT[c].fill(0);
            this.rPos[c] = this.wT[c];
            this.wT[c] = 0;
            this.lastW[c] = 0;
          }
        }
      }
    }

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
        const raw = tRing[i0] * (1 - frac) + tRing[i1] * frac;
        // Normalización por cobertura OLA con posiciones enteras reales round(k·Hs)
        let cov = 0;
        const Ns = this.N;
        const HsC = this.HA * ratio;
        const piOverN = Math.PI / (Ns - 1);
        const j0 = Math.floor((pos - (Ns >> 1)) / HsC - 1);
        const j1 = Math.ceil((pos + (Ns >> 1)) / HsC + 1);
        for (let j = j0; j <= j1; j++) {
          const pj = Math.round(j * HsC);
          const xi = pos - pj;
          if (Math.abs(xi) > (Ns >> 1)) continue;
          const wv = Math.sin(piOverN * (xi + (Ns >> 1)));
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
