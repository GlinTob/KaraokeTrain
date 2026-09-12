class VocalProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "highpass", defaultValue: 120, minValue: 20, maxValue: 300, automationRate: "k-rate" },
      { name: "lowGain", defaultValue: -2, minValue: -12, maxValue: 12, automationRate: "k-rate" },
      { name: "midGain", defaultValue: 5, minValue: -12, maxValue: 12, automationRate: "k-rate" },
      { name: "highGain", defaultValue: 4, minValue: -12, maxValue: 12, automationRate: "k-rate" },
      { name: "gateThreshold", defaultValue: -40, minValue: -60, maxValue: 0, automationRate: "k-rate" },
      { name: "compThreshold", defaultValue: -18, minValue: -40, maxValue: 0, automationRate: "k-rate" },
      { name: "compRatio", defaultValue: 4, minValue: 1, maxValue: 20, automationRate: "k-rate" },
      { name: "attackMs", defaultValue: 10, minValue: 1, maxValue: 200, automationRate: "k-rate" },
      { name: "releaseMs", defaultValue: 100, minValue: 10, maxValue: 2000, automationRate: "k-rate" },
      { name: "outputGain", defaultValue: 3, minValue: -24, maxValue: 24, automationRate: "k-rate" },
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }
    ];
  }

  constructor() {
    super();
    this.hpState = [];
    this.lowState = [];
    this.midState = [];
    this.highState = [];
    this.gateEnv = [];
    this.compEnv = [];
    this.messageCounter = 0; // Control de frecuencia de mensajes
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0 || !input || input.length === 0) {
      return true;
    }

    const outChannels = output.length;
    const bypassOn = (parameters.bypass?.[0] ?? 0) > 0.5;
    const highpass = parameters.highpass?.[0] ?? 120;
    const lowGainLin = Math.pow(10, (parameters.lowGain?.[0] ?? -2) / 20);
    const midGainLin = Math.pow(10, (parameters.midGain?.[0] ?? 5) / 20);
    const highGainLin = Math.pow(10, (parameters.highGain?.[0] ?? 4) / 20);
    const gateThreshLin = Math.pow(10, (parameters.gateThreshold?.[0] ?? -40) / 20);
    const compThreshLin = Math.pow(10, (parameters.compThreshold?.[0] ?? -18) / 20);
    const compRatio = Math.max(1, parameters.compRatio?.[0] ?? 4);
    const attackMs = Math.max(0.5, parameters.attackMs?.[0] ?? 10);
    const releaseMs = Math.max(1, parameters.releaseMs?.[0] ?? 100);
    const outputGainLin = Math.pow(10, (parameters.outputGain?.[0] ?? 3) / 20);

    const sr = sampleRate;
    const hpCoeff = Math.exp(-2 * Math.PI * highpass / sr);
    const hpGain = 1 + hpCoeff;
    const lowCoeff = Math.exp(-2 * Math.PI * 100 / sr);
    const midCoeff = Math.exp(-2 * Math.PI * 3000 / sr);
    const highCoeff = Math.exp(-2 * Math.PI * 8000 / sr);
    const attackCoeff = Math.exp(-1000 / (attackMs * sr));
    const releaseCoeff = Math.exp(-1000 / (releaseMs * sr));

    for (let ch = 0; ch < outChannels; ch++) {
      const out = output[ch];
      const inp = input[ch] || input[0];
      if (!inp) { out.fill(0); continue; }

      if (bypassOn) {
        for (let i = 0; i < Math.min(inp.length, out.length); i++) {
          out[i] = Math.max(-1, Math.min(1, inp[i]));
        }
        continue;
      }

      if (!this.hpState[ch]) this.hpState[ch] = { x1: 0, y1: 0 };
      if (!this.lowState[ch]) this.lowState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      if (!this.midState[ch]) this.midState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      if (!this.highState[ch]) this.highState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      if (this.gateEnv[ch] === undefined) this.gateEnv[ch] = 0;
      if (this.compEnv[ch] === undefined) this.compEnv[ch] = 0;

      const hp = this.hpState[ch], low = this.lowState[ch], mid = this.midState[ch], high = this.highState[ch];
      let gateEnv = this.gateEnv[ch], compEnv = this.compEnv[ch];

      for (let i = 0; i < Math.min(inp.length, out.length); i++) {
        let sample = inp[i];
        const hpOut = sample - hp.x1 + hpCoeff * hp.y1;
        hp.x1 = sample; hp.y1 = hpOut; sample = hpOut * hpGain;

        low.x2 = low.x1; low.x1 = sample; low.y2 = low.y1;
        const lowIn = sample * 0.5 + low.x1 * 0.25 + low.x2 * 0.25;
        low.y1 = lowIn * lowCoeff + low.y2 * (1 - lowCoeff);
        sample = sample + (low.y1 - sample) * (lowGainLin - 1) * 0.5;

        mid.x2 = mid.x1; mid.x1 = sample; mid.y2 = mid.y1;
        const midIn = (sample - mid.x2) * 0.5;
        mid.y1 = midIn * midCoeff + mid.y2 * (1 - midCoeff);
        sample = sample + mid.y1 * (midGainLin - 1);

        high.x2 = high.x1; high.x1 = sample; high.y2 = high.y1;
        const highIn = (sample - high.x2) * 0.5;
        high.y1 = highIn * highCoeff + high.y2 * (1 - highCoeff);
        sample = sample + high.y1 * (highGainLin - 1);

        const absSample = Math.abs(sample);
        gateEnv = gateEnv * 0.999 + absSample * 0.001;
        if (gateEnv < gateThreshLin) sample *= 0.001;

        if (absSample > compEnv) {
          compEnv = compEnv * attackCoeff + absSample * (1 - attackCoeff);
        } else {
          compEnv = compEnv * releaseCoeff + absSample * (1 - releaseCoeff);
        }
        if (compEnv > compThreshLin) {
          const over = compEnv / compThreshLin;
          sample *= Math.pow(over, 1 - 1 / compRatio) / over;
        }

        out[i] = Math.max(-1, Math.min(1, sample * outputGainLin));
      }
      this.gateEnv[ch] = gateEnv; this.compEnv[ch] = compEnv;
    }

    // --- CÁLCULO DE VOLUMEN PARA LA BARRA (ENVÍO LIMITADO A ~30 Hz) ---
    this.messageCounter++;
    if (this.messageCounter >= 12) {
    let maxVolume = 0;
    if (input[0]) {
      for (let i = 0; i < input[0].length; i++) {
        const v = Math.abs(input[0][i]);
        if (v > maxVolume) maxVolume = v;
      }
    }
    this.port.postMessage({ volume: maxVolume });
      this.messageCounter = 0;
  }
    // ----------------------------------------

    return true;
}
}
registerProcessor("vocal-processor", VocalProcessor);
