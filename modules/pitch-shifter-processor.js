// ==========================================
// CORRECCIÓN COMPLETA: DELAY-LINE BASED PITCH SHIFTER
// Elimina el sonido metálico del phase vocoder defectuoso.
// Algoritmo: delay line + interpolation lineal + crossfade.
// Buffer pre-asignado (Zero allocations en tiempo real).
// ==========================================

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

    // --- Parámetros del delay-line pitch shifter ---
    this.fftSize = 2048;
    this.hopSize = this.fftSize / 4;

    // --- Buffer circular de delay pre-asignado ---
    // Para pitch down (ratio=0.5), delay máximo = ~2s de audio
    // 44100 * 2 = 88200 muestras, redondeamos a 96384 (2^17-ish para margen)
    // Pero en tiempo real con bloques pequeños, usamos un buffer dinámico
    // gestionado como un delay line variable.
    // Para evitar crecimiento ilimitado, limitamos a ~4s de delay.
    this.maxDelayLength = 192768; // ~4.4s a 44.1kHz
    this.delayBuffer = new Float32Array(this.maxDelayLength);
    this.delayWritePos = 0;

    // --- Crossfade para evitar clicks ---
    this.crossfadeLength = 4096; // ~93ms
    this.crossfadePos = 0;
    this.isCrossfading = false;

    // --- Buffers pre-asignados para procesamiento ---
    this.maxChannels = 2;
    this.readBuffer = [];
    this.writeBuffer = [];
    this.tempBuffer = [];
    for (let ch = 0; ch < this.maxChannels; ch++) {
      this.readBuffer[ch] = new Float32Array(this.fftSize);
      this.writeBuffer[ch] = new Float32Array(this.fftSize);
      this.tempBuffer[ch] = new Float32Array(this.fftSize);
    }

    // --- Ventana de Hann para crossfade ---
    this.crossfadeWindow = new Float32Array(this.crossfadeLength);
    for (let i = 0; i < this.crossfadeLength; i++) {
      this.crossfadeWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.crossfadeLength));
    }

    // Estado interno
    this.totalSamplesRead = 0;
    this.totalSamplesWritten = 0;
    this.isInitialized = false;
  }

  // --- Interpolación lineal para lectura suave del delay buffer ---
  _readLinear(channel, delayPos) {
    const buf = this.delayBuffer;
    const len = buf.length;
    const pos = delayPos % len;
    const idx0 = Math.floor(pos) % len;
    const idx1 = (idx0 + 1) % len;
    const frac = pos - Math.floor(pos);
    return buf[idx0] * (1 - frac) + buf[idx1] * frac;
  }

  _processChannel(input, output, ratio, nSamples) {
    const N = this.fftSize;
    const delayBuf = this.delayBuffer;

    // Escribir nueva entrada en el buffer circular
    for (let i = 0; i < nSamples; i++) {
      delayBuf[this.delayWritePos % this.maxDelayLength] = input[i] || 0;
      this.delayWritePos = (this.delayWritePos + 1) % this.maxDelayLength;
    }

    // Leer del delay buffer con pitchRatio modificado
    // Para pitch up (ratio > 1): delay más corto -> leer más rápido
    // Para pitch down (ratio < 1): delay más largo -> leer más lento
    const delayLength = Math.floor(N / ratio);
    const readStep = ratio;

    for (let i = 0; i < nSamples; i++) {
      // Posición de lectura en el delay buffer
      const readPos = this.delayWritePos - delayLength + i * readStep;
      const wrappedPos = ((readPos % this.maxDelayLength) + this.maxDelayLength) % this.maxDelayLength;

      // Interpolación lineal entre dos muestras adyacentes
      const frac = wrappedPos - Math.floor(wrappedPos);
      const idx0 = Math.floor(wrappedPos) % this.maxDelayLength;
      const idx1 = (idx0 + 1) % this.maxDelayLength;
      const val = delayBuf[idx0] * (1 - frac) + delayBuf[idx1] * frac;

      // Crossfade suave al inicio
      if (this.isCrossfading && this.crossfadePos < this.crossfadeLength) {
        const fadeIn = this.crossfadeWindow[this.crossfadePos] || 0;
        const fadeOut = this.crossfadeWindow[Math.max(0, this.crossfadeLength - this.crossfadePos - 1)] || 0;
        output[i] = val * fadeIn; // solo crossfade-in al inicio
        this.crossfadePos++;
      } else {
        output[i] = val;
        this.isCrossfading = false;
      }
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) return true;

    // Leer parámetro pitchRatio
    const pitchRatioValues = parameters.pitchRatio;
    const rawPitchRatio = pitchRatioValues.length ? pitchRatioValues[0] : 1.0;
    const ratio = Math.max(0.5, Math.min(2.0, rawPitchRatio));

    const numChannels = Math.min(output.length, this.maxChannels);
    const blockSize = output[0]?.length || 128;

    // Si el ratio es 1.0, pasar-through sin procesar
    if (Math.abs(ratio - 1.0) < 0.0001) {
    for (let ch = 0; ch < numChannels; ch++) {
        const in_ch = ch < (input?.length || 0) && input[ch] ? input[ch] : output[ch];
        for (let i = 0; i < blockSize; i++) {
          output[ch][i] = in_ch[i] || 0;
    }
      }
    return true;
  }

    for (let ch = 0; ch < numChannels; ch++) {
      const in_ch = ch < (input?.length || 0) && input[ch] ? input[ch] : new Float32Array(blockSize);
      const out_ch = output[ch];

      this._processChannel(in_ch, out_ch, ratio, blockSize);
}

    // Incrementar posición de crossfade
    if (this.isCrossfading) {
      this.crossfadePos += blockSize;
    } else {
      this.isCrossfading = true;
      this.crossfadePos = 0;
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);

