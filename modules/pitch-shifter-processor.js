// ==========================================
// PITCH SHIFTER - PHASE VOCODER (Laroche-Dolson region shift)
// ==========================================
// Port fiel al PhaseVocoderProcessor de olvb/phaze (Unlicense):
//   hop small (128 = un bloque de Web Audio) y ventana larga (2048) -> 16
//   solapes acumulados en OLA (excelente coherencia de fase).
//   1. STFT del bloque (real -> complejo) con ventana Hann.
//   2. findPeaks: maximos locales con margen de 2 bins.
//   3. shiftPeaks: cada pico y su region de influencia (corte a mitad de
//      camino con el pico vecino) se desplaza a round(peak * pitchRatio),
//      aplicando correccion de fase e^{j*dOmega*timeCursor} por bin.
//   4. IFFT + ventana de sintesis + OLA acumulando (1/nbOverlaps).
// La posicion de cada bin en el tiempo se conserva con timeCursor (suma de
// los hops), lo que evita el "temblor"/desafinado del acumulador por bin.
//
// Cero allocations en el path de audio real.

const BLOCK_SIZE = 2048;
const HOP_SIZE = 128;
const NB_OVERLAPS = BLOCK_SIZE / HOP_SIZE;
const RING_IN = BLOCK_SIZE + HOP_SIZE;
const SOURCE_LEN = BLOCK_SIZE - HOP_SIZE; // copia / relleno del acumulador OLA
const BOOST = 2.0; // compensacion de nivel del algoritmo region-shift en R!=1

function genHannWindow(length) {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
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
    this.N = BLOCK_SIZE;
    this.hann = genHannWindow(BLOCK_SIZE);
    this.fft = new FFTImpl(BLOCK_SIZE);

    this.frame = new Float32Array(BLOCK_SIZE);
    this.re = new Float32Array(BLOCK_SIZE);
    this.im = new Float32Array(BLOCK_SIZE);

    this.freqComplexBuffer = new Float32Array(2 * BLOCK_SIZE);
    this.freqComplexBufferShifted = new Float32Array(2 * BLOCK_SIZE);
    this.timeComplexBuffer = new Float32Array(2 * BLOCK_SIZE);

    this.magnitudes = new Float32Array(BLOCK_SIZE / 2 + 1);
    this.peakIndexes = new Int32Array(this.magnitudes.length);
    this.nbPeaks = 0;

    this.timeCursor = 0;

    this.inRing = [];
    this.outBuf = [];
    this.headIn = 0;
    this.frameStart = 0;
  }

  _ensureChannels(n) {
    if (this.inRing.length >= n) return;
    for (let c = this.inRing.length; c < n; c++) {
      this.inRing[c] = new Float32Array(RING_IN);
      this.outBuf[c] = new Float32Array(BLOCK_SIZE);
    }
  }

  computeMagnitudes() {
    const mag = this.magnitudes;
    const buf = this.freqComplexBuffer;
    let i = 0, j = 0;
    const L = mag.length;
    while (i < L) {
      const real = buf[j];
      const imag = buf[j + 1];
      mag[i] = real * real + imag * imag;
      i += 1;
      j += 2;
    }
  }

  findPeaks() {
    const mag = this.magnitudes;
    const L = mag.length;
    this.nbPeaks = 0;
    let i = 2;
    const end = L - 2;
    while (i < end) {
      const m = mag[i];
      if (mag[i - 1] >= m || mag[i - 2] >= m) { i++; continue; }
      if (mag[i + 1] >= m || mag[i + 2] >= m) { i++; continue; }
      this.peakIndexes[this.nbPeaks] = i;
      this.nbPeaks++;
      i += 2;
    }
  }

  shiftPeaks(pitchFactor) {
    const buf = this.freqComplexBuffer;
    const out = this.freqComplexBufferShifted;
    const magLen = this.magnitudes.length;
    out.fill(0);

    for (let i = 0; i < this.nbPeaks; i++) {
      const peakIndex = this.peakIndexes[i];
      const peakIndexShifted = Math.round(peakIndex * pitchFactor);

      if (peakIndexShifted > magLen) break;

      let startIndex = 0;
      // Tope en Nyquist (magLen): más allá solo hay espejo conjugado; sin
      // tope ese contenido se pliega al rango audible como aspereza metálica.
      let endIndex = magLen;
      if (i > 0) {
        const peakIndexBefore = this.peakIndexes[i - 1];
        startIndex = peakIndex - Math.floor((peakIndex - peakIndexBefore) / 2);
      }
      if (i < this.nbPeaks - 1) {
        const peakIndexAfter = this.peakIndexes[i + 1];
        endIndex = peakIndex + Math.ceil((peakIndexAfter - peakIndex) / 2);
      }

      const startOffset = startIndex - peakIndex;
      const endOffset = endIndex - peakIndex;
      for (let j = startOffset; j < endOffset; j++) {
        const binIndex = peakIndex + j;
        const binIndexShifted = peakIndexShifted + j;

        if (binIndexShifted >= magLen) break;

        const omegaDelta = (2 * Math.PI * (binIndexShifted - binIndex)) / this.N;
        const phaseShiftReal = Math.cos(omegaDelta * this.timeCursor);
        const phaseShiftImag = Math.sin(omegaDelta * this.timeCursor);

        const indexReal = binIndex * 2;
        const indexImag = indexReal + 1;
        const valueReal = buf[indexReal];
        const valueImag = buf[indexImag];

        const valueShiftedReal = valueReal * phaseShiftReal - valueImag * phaseShiftImag;
        const valueShiftedImag = valueReal * phaseShiftImag + valueImag * phaseShiftReal;

        const indexShiftedReal = binIndexShifted * 2;
        const indexShiftedImag = indexShiftedReal + 1;
        out[indexShiftedReal] += valueShiftedReal;
        out[indexShiftedImag] += valueShiftedImag;
      }
    }
  }

  _processFrame(ch, ratio) {
    const N = this.N;
    const ring = this.inRing[ch];
    const frame = this.frame;
    const re = this.re;
    const im = this.im;

    for (let i = 0; i < N; i++) {
      frame[i] = ring[(this.frameStart + i) % RING_IN] * this.hann[i];
      re[i] = frame[i];
      im[i] = 0;
    }

    this.fft.transform(re, im, +1);
    for (let k = 0; k < N; k++) {
      this.freqComplexBuffer[2 * k] = re[k];
      this.freqComplexBuffer[2 * k + 1] = im[k];
    }

    this.computeMagnitudes();
    this.findPeaks();
    this.shiftPeaks(ratio);

    // completeSpectrum: rellenar la mitad negativa por conjugacion
    const out = this.freqComplexBufferShifted;
    for (let k = 1; k < N / 2; k++) {
      out[2 * (N - k)] = out[2 * k];
      out[2 * (N - k) + 1] = -out[2 * k + 1];
    }

    const tcb = this.timeComplexBuffer;
    for (let k = 0; k < N; k++) {
      tcb[2 * k] = out[2 * k];
      tcb[2 * k + 1] = out[2 * k + 1];
      re[k] = tcb[2 * k];
      im[k] = tcb[2 * k + 1];
    }
    this.fft.transform(re, im, -1);

    const ola = this.outBuf[ch];
    for (let i = 0; i < N; i++) {
      ola[i] += (re[i] / N) * this.hann[i] * (BOOST / NB_OVERLAPS);
    }

    // NOTA: timeCursor NO avanza aquí. Todos los canales comparten el mismo
    // cursor temporal; avanzarlo por canal (2×HOP por bloque en estéreo)
    // rompía la corrección de fase e^{j·Δω·timeCursor} y el estéreo sonaba
    // entrecortado/vibrante. Avanza una vez por frame en process().
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const block = output[0].length;
    const input = inputs[0];
    const numCh = Math.min(output.length, Math.max(1, input ? input.length : 1), 32);
    this._ensureChannels(numCh);

    const pv = parameters.pitchRatio;
    const raw = pv.length ? pv[pv.length - 1] : 1.0;
    const ratio = Math.max(0.5, Math.min(2.0, raw));

    if (Math.abs(ratio - 1.0) < 0.0001) {
      for (let c = 0; c < numCh; c++) {
        const src = input && input[c] ? input[c] : output[c];
        const dst = output[c];
        for (let i = 0; i < block; i++) dst[i] = src[i] || 0;
      }
      // Purga: al volver a ratio!=1 la cola vieja del OLA sonaría como burst.
      for (let c = 0; c < this.outBuf.length; c++) {
        if (this.outBuf[c]) this.outBuf[c].fill(0);
      }
      return true;
    }

    // 1. Append de entrada al anillo. Se filtra Infinity (truthy y envenena
    // la FFT y el acumulador OLA para siempre vía copyWithin); NaN ya lo
    // tragaba el || 0.
    for (let c = 0; c < numCh; c++) {
      const src = input && input[c] ? input[c] : null;
      const ring = this.inRing[c];
      for (let i = 0; i < block; i++) {
        const v = src ? src[i] : 0;
        ring[(this.headIn + i) % RING_IN] = Number.isFinite(v) ? v : 0;
      }
    }
    const headIn = this.headIn + block;
    this.headIn = headIn;

    // 2. Procesar frames completos (hop = block de Web Audio).
    // timeCursor avanza UNA vez por frame (no por canal): todos los canales
    // comparten la misma referencia temporal para la corrección de fase.
    while (this.frameStart + this.N <= headIn) {
      for (let c = 0; c < numCh; c++) this._processFrame(c, ratio);
      this.timeCursor += HOP_SIZE;
      this.frameStart += HOP_SIZE;
    }

    // 3. Salida OLA: copiar el primer bloque y desplazar el acumulador
    for (let c = 0; c < numCh; c++) {
      const dst = output[c];
      const ola = this.outBuf[c];
      for (let i = 0; i < block; i++) dst[i] = ola[i];
      ola.copyWithin(0, block);
      for (let i = SOURCE_LEN; i < this.N; i++) ola[i] = 0;
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
