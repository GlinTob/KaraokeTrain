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

    // FFT size - potencia de 2. 2048 = ~46ms a 44.1kHz (buen compromiso latencia/calidad)
    this.fftSize = 2048;
    this.hopSize = this.fftSize / 4; // 512 = 4x overlap (estándar phase vocoder)
    
    // Buffer circular de entrada
    this.inputBufferSize = this.fftSize * 4;
    this.inputBuffer = new Float32Array(this.inputBufferSize);
    this.inputWritePos = 0;
    this.inputReadPos = 0;
    this.totalInputWritten = 0;

    // Buffers FFT por canal
    this.maxChannels = 2;
    this.fftBuffers = [];
    this.magnitudes = [];
    this.phases = [];
    this.prevPhases = [];
    this.outputPhases = [];
    this.synthesisBuffer = [];
    this.synthesisWritePos = 0;
    this.synthesisReadPos = 0;
    this.synthesisBufferSize = this.fftSize * 4;
    
    for (let c = 0; c < this.maxChannels; c++) {
      this.fftBuffers[c] = new Float32Array(this.fftSize);
      this.magnitudes[c] = new Float32Array(this.fftSize / 2 + 1);
      this.phases[c] = new Float32Array(this.fftSize / 2 + 1);
      this.prevPhases[c] = new Float32Array(this.fftSize / 2 + 1);
      this.outputPhases[c] = new Float32Array(this.fftSize / 2 + 1);
      this.synthesisBuffer[c] = new Float32Array(this.synthesisBufferSize);
    }

    // Ventana de análisis/síntesis (Hann)
    this.window = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
    }

    // Ventana de síntesis normalizada para overlap-add perfecto (Hann^2 = 0.5 con 4x overlap)
    this.synthWindow = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      const w = this.window[i];
      this.synthWindow[i] = w * w * 2; // Normalización para 4x overlap
    }

    // Frecuencias esperadas por bin (para cálculo de desviación de fase)
    this.expectedPhaseIncrements = new Float32Array(this.fftSize / 2 + 1);
    for (let k = 0; k <= this.fftSize / 2; k++) {
      this.expectedPhaseIncrements[k] = (2 * Math.PI * k * this.hopSize) / this.fftSize;
    }
  }

  // FFT real iterativa (Cooley-Tukey, decimation-in-time)
  _fftReal(input, outputReal, outputImag) {
    const N = this.fftSize;
    const halfN = N / 2;
    
    // Bit-reversal permutation
    for (let i = 0, j = 0; i < N; i++) {
      if (i < j) {
        const tmp = input[i];
        input[i] = input[j];
        input[j] = tmp;
      }
      let bit = halfN;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
    }

    // Cooley-Tukey iterative
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const angle = -2 * Math.PI / len;
      const wlenCos = Math.cos(angle);
      const wlenSin = Math.sin(angle);
      
      for (let i = 0; i < N; i += len) {
        let wCos = 1;
        let wSin = 0;
        for (let j = 0; j < halfLen; j++) {
          const uIdx = i + j;
          const vIdx = i + j + halfLen;
          const uReal = input[uIdx];
          const uImag = 0; // Real input
          const vReal = input[vIdx] * wCos - 0 * wSin;
          const vImag = input[vIdx] * wSin + 0 * wCos;
          
          input[uIdx] = uReal + vReal;
          input[N + uIdx] = uImag + vImag; // Store imag in second half temporarily
          input[vIdx] = uReal - vReal;
          input[N + vIdx] = uImag - vImag;
          
          // Next twiddle factor
          const nextWCos = wCos * wlenCos - wSin * wlenSin;
          const nextWSin = wCos * wlenSin + wSin * wlenCos;
          wCos = nextWCos;
          wSin = nextWSin;
        }
      }
    }

    // Extract real/imag from packed array
    for (let k = 0; k <= halfN; k++) {
      outputReal[k] = input[k];
      outputImag[k] = input[N + k];
    }
  }

  // IFFT real (inversa)
  _ifftReal(inputReal, inputImag, output) {
    const N = this.fftSize;
    const halfN = N / 2;
    
    // Pack into work array
    const work = new Float32Array(N * 2);
    for (let k = 0; k <= halfN; k++) {
      work[k] = inputReal[k];
      work[N + k] = inputImag[k];
    }
    // Mirror for negative frequencies (conjugate symmetry)
    for (let k = 1; k < halfN; k++) {
      work[halfN + k] = inputReal[halfN - k];
      work[N + halfN + k] = -inputImag[halfN - k];
    }
    work[halfN] = inputReal[halfN];
    work[N + halfN] = 0;

    // Bit-reversal
    for (let i = 0, j = 0; i < N; i++) {
      if (i < j) {
        const tmp = work[i];
        work[i] = work[j];
        work[j] = tmp;
      }
      let bit = halfN;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
    }

    // Inverse Cooley-Tukey
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const angle = 2 * Math.PI / len; // Positive for inverse
      const wlenCos = Math.cos(angle);
      const wlenSin = Math.sin(angle);
      
      for (let i = 0; i < N; i += len) {
        let wCos = 1;
        let wSin = 0;
        for (let j = 0; j < halfLen; j++) {
          const uIdx = i + j;
          const vIdx = i + j + halfLen;
          const uReal = work[uIdx];
          const uImag = work[N + uIdx];
          const vReal = work[vIdx] * wCos - work[N + vIdx] * wSin;
          const vImag = work[vIdx] * wSin + work[N + vIdx] * wCos;
          
          work[uIdx] = uReal + vReal;
          work[N + uIdx] = uImag + vImag;
          work[vIdx] = uReal - vReal;
          work[N + vIdx] = uImag - vImag;
          
          const nextWCos = wCos * wlenCos - wSin * wlenSin;
          const nextWSin = wCos * wlenSin + wSin * wlenCos;
          wCos = nextWCos;
          wSin = nextWSin;
        }
      }
    }

    // Normalize and extract real part
    for (let i = 0; i < N; i++) {
      output[i] = work[i] / N;
    }
  }

  _processChannel(channel, input, output, ratio) {
    const N = this.fftSize;
    const halfN = N / 2;
    const hopIn = this.hopSize;
    const hopOut = Math.round(hopIn * ratio); // Síntesis hop = análisis hop * ratio

    // Escribir entrada en buffer circular
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos] = input[i];
      this.inputWritePos = (this.inputWritePos + 1) % this.inputBufferSize;
      this.totalInputWritten++;
    }

    // Procesar tantos frames de análisis como quepan
    while (this.totalInputWritten - this.inputReadPos >= N) {
      // 1. Extraer frame de análisis con ventana
      for (let i = 0; i < N; i++) {
        const idx = (this.inputReadPos + i) % this.inputBufferSize;
        this.fftBuffers[channel][i] = this.inputBuffer[idx] * this.window[i];
      }

      // 2. FFT
      const fftReal = new Float32Array(halfN + 1);
      const fftImag = new Float32Array(halfN + 1);
      this._fftReal(this.fftBuffers[channel], fftReal, fftImag);

      // 3. Convertir a magnitud/fase
      for (let k = 0; k <= halfN; k++) {
        const real = fftReal[k];
        const imag = fftImag[k];
        this.magnitudes[channel][k] = Math.sqrt(real * real + imag * imag);
        this.phases[channel][k] = Math.atan2(imag, real);
      }

      // 4. Phase vocoder: calcular incremento de fase real y desviación
      for (let k = 0; k <= halfN; k++) {
        // Diferencia de fase entre frames consecutivos
        let deltaPhase = this.phases[channel][k] - this.prevPhases[channel][k];
        
        // Desenrollar fase (unwrap)
        const expected = this.expectedPhaseIncrements[k];
        deltaPhase = deltaPhase - expected;
        deltaPhase = deltaPhase - 2 * Math.PI * Math.round(deltaPhase / (2 * Math.PI));
        deltaPhase = deltaPhase + expected;
        
        // Frecuencia real del bin
        const trueFreq = deltaPhase / hopIn;
        
        // Fase de síntesis = fase anterior + frecuencia real * hop de síntesis
        this.outputPhases[channel][k] += trueFreq * hopOut;
        
        // Guardar fase actual para próximo frame
        this.prevPhases[channel][k] = this.phases[channel][k];
      }

      // 5. Reconstruir espectro con magnitudes originales y fases corregidas
      for (let k = 0; k <= halfN; k++) {
        const mag = this.magnitudes[channel][k];
        const phase = this.outputPhases[channel][k];
        fftReal[k] = mag * Math.cos(phase);
        fftImag[k] = mag * Math.sin(phase);
      }

      // 6. IFFT
      this._ifftReal(fftReal, fftImag, this.fftBuffers[channel]);

      // 7. Overlap-add en buffer de síntesis con ventana de síntesis
      for (let i = 0; i < N; i++) {
        const idx = (this.synthesisWritePos + i) % this.synthesisBufferSize;
        this.synthesisBuffer[channel][idx] += this.fftBuffers[channel][i] * this.synthWindow[i];
      }

      this.inputReadPos = (this.inputReadPos + hopIn) % this.inputBufferSize;
      this.synthesisWritePos = (this.synthesisWritePos + hopOut) % this.synthesisBufferSize;
      this.totalInputWritten -= hopIn; // Aproximado, en realidad movemos inputReadPos
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    const pitchRatioValues = parameters.pitchRatio;
    const rawPitchRatio = pitchRatioValues.length ? pitchRatioValues[0] : 1.0;
    const ratio = Math.max(0.5, Math.min(2.0, rawPitchRatio));

    const numOutput = output[0]?.length || 128;
    const numChannels = output.length;

    // Limpiar salidas
    for (let ch = 0; ch < numChannels; ch++) {
      output[ch].fill(0);
    }

    // Obtener entrada (canal 0 o silencio)
    const in0 = input && input[0] ? input[0] : new Float32Array(numOutput);
    
    // Procesar cada canal de salida
    for (let ch = 0; ch < numChannels; ch++) {
      const inputChannel = ch < (input?.length || 0) && input[ch] ? input[ch] : in0;
      this._processChannel(ch, inputChannel, output[ch], ratio);

      // Leer del buffer de síntesis
      let available = this.synthesisWritePos - this.synthesisReadPos;
      if (available < 0) available += this.synthesisBufferSize;
      
      const toRead = Math.min(numOutput, available);
      if (toRead > 0) {
        for (let i = 0; i < toRead; i++) {
          const idx = (this.synthesisReadPos + i) % this.synthesisBufferSize;
          output[ch][i] = this.synthesisBuffer[ch][idx];
          // Limpiar para evitar acumulación
          this.synthesisBuffer[ch][idx] = 0;
        }
        this.synthesisReadPos = (this.synthesisReadPos + toRead) % this.synthesisBufferSize;
      }
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
