class VocalProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "highpass",
        defaultValue: 120,
        minValue: 20,
        maxValue: 300,
        automationRate: "k-rate"
      },
      {
        name: "lowGain",
        defaultValue: -2,
        minValue: -12,
        maxValue: 12,
        automationRate: "k-rate"
      },
      {
        name: "midGain",
        defaultValue: 5,
        minValue: -12,
        maxValue: 12,
        automationRate: "k-rate"
      },
      {
        name: "highGain",
        defaultValue: 4,
        minValue: -12,
        maxValue: 12,
        automationRate: "k-rate"
      },
      {
        name: "gateThreshold",
        defaultValue: -40,
        minValue: -60,
        maxValue: 0,
        automationRate: "k-rate"
      },
      {
        name: "compThreshold",
        defaultValue: -18,
        minValue: -40,
        maxValue: 0,
        automationRate: "k-rate"
      },
      {
        name: "outputGain",
        defaultValue: 3,
        minValue: -24,
        maxValue: 24,
        automationRate: "k-rate"
      }
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
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0 || !input || input.length === 0) {
      return true;
    }

    const outChannels = output.length;

    const highpass = parameters.highpass?.[0] ?? 120;
    const lowGain = parameters.lowGain?.[0] ?? -2;
    const midGain = parameters.midGain?.[0] ?? 5;
    const highGain = parameters.highGain?.[0] ?? 4;
    const gateThreshold = parameters.gateThreshold?.[0] ?? -40;
    const compThreshold = parameters.compThreshold?.[0] ?? -18;
    const outputGain = parameters.outputGain?.[0] ?? 3;

    const lowGainLin = Math.pow(10, lowGain / 20);
    const midGainLin = Math.pow(10, midGain / 20);
    const highGainLin = Math.pow(10, highGain / 20);
    const outputGainLin = Math.pow(10, outputGain / 20);
    const gateThreshLin = Math.pow(10, gateThreshold / 20);
    const compThreshLin = Math.pow(10, compThreshold / 20);

    const sr = sampleRate;

    const hpCoeff = Math.exp(-2 * Math.PI * highpass / sr);
    const hpGain = 1 + hpCoeff;

    const lowFreq = 100;
    const lowCoeff = Math.exp(-2 * Math.PI * lowFreq / sr);

    const midFreq = 3000;
    const midCoeff = Math.exp(-2 * Math.PI * midFreq / sr);

    const highFreq = 8000;
    const highCoeff = Math.exp(-2 * Math.PI * highFreq / sr);

    for (let ch = 0; ch < outChannels; ch++) {
      const out = output[ch];
      const inp = input[ch] || input[0];

      if (!inp) {
        out.fill(0);
        continue;
      }

      if (!this.hpState[ch]) {
        this.hpState[ch] = { x1: 0, y1: 0 };
      }
      if (!this.lowState[ch]) {
        this.lowState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      if (!this.midState[ch]) {
        this.midState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      if (!this.highState[ch]) {
        this.highState[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      if (this.gateEnv[ch] === undefined) {
        this.gateEnv[ch] = 0;
      }
      if (this.compEnv[ch] === undefined) {
        this.compEnv[ch] = 0;
      }

      const hp = this.hpState[ch];
      const low = this.lowState[ch];
      const mid = this.midState[ch];
      const high = this.highState[ch];
      let gateEnv = this.gateEnv[ch];
      let compEnv = this.compEnv[ch];

      const frames = Math.min(inp.length, out.length);

      for (let i = 0; i < frames; i++) {
        let sample = inp[i];

        const hpOut = sample - hp.x1 + hpCoeff * hp.y1;
        hp.x1 = sample;
        hp.y1 = hpOut;
        sample = hpOut * hpGain;

        low.x2 = low.x1;
        low.x1 = sample;
        low.y2 = low.y1;
        const lowIn = sample * 0.5 + low.x1 * 0.25 + low.x2 * 0.25;
        low.y1 = lowIn * lowCoeff + low.y2 * (1 - lowCoeff);
        sample = sample + (low.y1 - sample) * (lowGainLin - 1) * 0.5;

        mid.x2 = mid.x1;
        mid.x1 = sample;
        mid.y2 = mid.y1;
        const midIn = (sample - mid.x2) * 0.5;
        mid.y1 = midIn * midCoeff + mid.y2 * (1 - midCoeff);
        sample = sample + mid.y1 * (midGainLin - 1);

        high.x2 = high.x1;
        high.x1 = sample;
        high.y2 = high.y1;
        const highIn = (sample - high.x2) * 0.5;
        high.y1 = highIn * highCoeff + high.y2 * (1 - highCoeff);
        sample = sample + high.y1 * (highGainLin - 1);

        const absSample = Math.abs(sample);
        gateEnv = gateEnv * 0.999 + absSample * 0.001;
        if (gateEnv < gateThreshLin) {
          sample *= 0.001;
        }

        compEnv = compEnv * 0.999 + absSample * 0.001;
        if (compEnv > compThreshLin) {
          const ratio = 4;
          const over = compEnv / compThreshLin;
          const gainReduction = Math.pow(over, 1 - 1 / ratio) / over;
          sample *= gainReduction;
        }

        const finalSample = sample * outputGainLin;
        out[i] = Math.max(-1, Math.min(1, finalSample));
      }

      if (out.length > frames) {
        out.fill(0, frames);
      }

      this.hpState[ch] = hp;
      this.lowState[ch] = low;
      this.midState[ch] = mid;
      this.highState[ch] = high;
      this.gateEnv[ch] = gateEnv;
      this.compEnv[ch] = compEnv;
    }

    return true;
  }
}

registerProcessor("vocal-processor", VocalProcessor);
