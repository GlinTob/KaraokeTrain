export class PitchShifterProcessor extends AudioWorkletProcessor {
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
    this.readIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) return true;

    const outChannels = output.length;
    const pitchRatioValues = parameters.pitchRatio;
    const pitchRatio = pitchRatioValues.length ? pitchRatioValues[0] : 1.0;

    const inChannel = input[0] || new Float32Array(128);
    const numSamples = inChannel.length;

    // Escribir muestras en el búfer circular
    for (let i = 0; i < numSamples; i++) {
      this.buffer[this.writeIndex] = inChannel[i];
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    // Generar la salida interpolada
    for (let ch = 0; ch < outChannels; ch++) {
      const out = output[ch];

      for (let i = 0; i < out.length; i++) {
        const idx0 = Math.floor(this.readIndex) % this.bufferSize;
        const idx1 = (idx0 + 1) % this.bufferSize;
        const frac = this.readIndex - Math.floor(this.readIndex);

        const s0 = this.buffer[idx0] || 0;
        const s1 = this.buffer[idx1] || 0;

        out[i] = s0 + (s1 - s0) * frac;
        this.readIndex = (this.readIndex + pitchRatio) % this.bufferSize;
      }
    }

    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);