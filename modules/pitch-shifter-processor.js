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

    this.bufferSize = 8192;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;

    // Empezar leyendo con un pequeño retraso para evitar leer zonas vacías al inicio
    this.readIndex = this.bufferSize / 2;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    const pitchRatioValues = parameters.pitchRatio;
    const rawPitchRatio = pitchRatioValues.length ? pitchRatioValues[0] : 1.0;
    const pitchRatio = Math.max(0.5, Math.min(2.0, rawPitchRatio));

    const inChannel = input && input.length > 0 ? input[0] : null;
    const numSamples = output[0]?.length || 128;

    // Si no hay entrada, emitir silencio
    if (!inChannel) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    // Escribir muestras en el buffer circular
    for (let i = 0; i < inChannel.length; i++) {
      this.buffer[this.writeIndex] = inChannel[i];
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    // Generar salida interpolada
    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];

      for (let i = 0; i < numSamples; i++) {
        const baseIndex = Math.floor(this.readIndex);
        const idx0 = ((baseIndex % this.bufferSize) + this.bufferSize) % this.bufferSize;
        const idx1 = (idx0 + 1) % this.bufferSize;
        const frac = this.readIndex - baseIndex;

        const s0 = this.buffer[idx0];
        const s1 = this.buffer[idx1];

        out[i] = s0 + (s1 - s0) * frac;

        this.readIndex += pitchRatio;
        if (this.readIndex >= this.bufferSize) {
          this.readIndex -= this.bufferSize;
        }
      }
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
