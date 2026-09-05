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

    // Ventana (grano) en muestras. ~93 ms a 44.1 kHz.
    this.windowSize = 4096;
    // Solape del 50% en la síntesis (ventana Hann -> crossfade suave).
    this.synthesisHop = this.windowSize / 2;

    // Buffer circular de ENTRADA.
    this.inputSize = this.windowSize * 6;
    this.input = new Float32Array(this.inputSize);
    this.writeIndex = 0;
    // Total de muestras escritas (para saber si hay entrada disponible).
    this.totalWritten = 0;

    // Inicio del análisis con un retraso inicial de un grano para tener datos.
    this.analysisReadPos = this.windowSize;

    // Bus de salida (overlap-add). Buffer lineal con poda.
    this.mixBusSize = this.windowSize * 4;
    this.mixBus = new Float32Array(this.mixBusSize);
    this.mixWrite = 0;
    this.mixRead = 0;

    // Ventana Hann.
    this.window = new Float32Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.windowSize - 1)));
    }
  }

  _compactBus() {
    if (this.mixWrite > this.mixBusSize - this.windowSize) {
      const remaining = this.mixWrite - this.mixRead;
      if (remaining > 0) {
        this.mixBus.copyWithin(0, this.mixRead, this.mixWrite);
      }
      // Limpiar la región desplazada que quedó duplicada al final del buffer
      this.mixBus.fill(0, remaining, this.mixBusSize);

      const shift = this.mixRead;
      this.mixRead = 0;
      this.mixWrite -= shift;
    }
  }

  _synthesize(ratio) {
    // Salto de análisis proporcional al tono. Con esto la cantidad de salida
    // por grano es contante y el flujo queda 1:1 con la entrada en tiempo real.
    const analysisHop = Math.round(this.windowSize * ratio);

    while (true) {
      // Suficiente entrada para otro grano?
      if (this.analysisReadPos + this.windowSize > this.totalWritten) break;
      // Espacio en el bus?
      if (this.mixWrite + this.windowSize > this.mixBusSize) break;

      for (let i = 0; i < this.windowSize; i++) {
        const src = (this.analysisReadPos + i) % this.inputSize;
        const dest = this.mixWrite + i;
        this.mixBus[dest] += this.input[src] * this.window[i];
      }

      this.analysisReadPos += analysisHop;
      this.mixWrite += this.synthesisHop;
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
    for (let ch = 0; ch < output.length; ch++) {
      output[ch].fill(0);
    }

    const numChannels = Math.max(inputs[0] ? inputs[0].length : 0, 1);
    const inBlock = (input && input[0]) ? input[0].length : numOutput;

    // 1. Escribir la entrada (se procesa por canal; usamos el canal 0 como
    //    referencia para el análisis, y reproducimos el resultado en todos).
    const in0 = input && input[0];
    for (let i = 0; i < inBlock; i++) {
      const sample = in0 ? in0[i] : 0;
      this.input[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.inputSize;
      this.totalWritten++;
    }

    // 2. Generar granos overlap-add.
    this._synthesize(ratio);

    // 3. Leer el bloque de salida (avanzando 1 muestra por muestra).
    const have = this.mixWrite - this.mixRead;
    if (have > 0) {
      let idx = this.mixRead;
      for (let ch = 0; ch < output.length; ch++) {
        const channelOut = output[ch];
        let j = idx;
        for (let i = 0; i < numOutput; i++) {
          if (j >= this.mixWrite) break;
          channelOut[i] = this.mixBus[j];
          j++;
        }
      }

      // Limpiar muestras consumidas en mixBus para evitar distorsión metálica
      this.mixBus.fill(0, this.mixRead, Math.min(this.mixRead + numOutput, this.mixBusSize));

      this.mixRead += numOutput;
      if (this.mixRead > this.mixWrite) this.mixRead = this.mixWrite;
    }

    // 4. Podar.
    this._compactBus();

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);

