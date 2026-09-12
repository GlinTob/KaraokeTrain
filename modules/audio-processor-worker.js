// ==========================================
// OPTIMIZED AUDIO PROCESSING WORKER
// ==========================================
// This Web Worker handles audio mixing + pitch detection off the main thread
// Prevents UI freezing during audio operations
// File: audio-processor-worker.js

class AudioProcessor {
  constructor() {
    // Buffer temporal reutilizable para detectPitch (evita GC pressure)
    this._tempClipped = new Float32Array(4096);
  }

    /**
   * Mix multiple audio buffers without blocking main thread
   * Optimizado: 2 pasadas (mezcla+busca pico -> normaliza)
   */
  mixAudioBuffers(buffers, gains = null) {
    if (!Array.isArray(buffers) || buffers.length === 0) {
      throw new Error("No audio buffers to mix");
    }

    const maxLength = Math.max(...buffers.map((b) => b.length || 0));
    if (maxLength === 0) {
      return new Float32Array(0);
    }

    const mixed = new Float32Array(maxLength);
    let max = 0;

    buffers.forEach((buffer, index) => {
      if (!buffer) return;

      const gain =
        gains && gains[index] !== undefined
          ? gains[index]
          : 1;

      for (let i = 0; i < buffer.length; i++) {
        const val = buffer[i] * gain;
        mixed[i] += val;
        const abs = val >= 0 ? val : -val; // Math.abs inline
        if (abs > max) max = abs;
      }
    });

    // Normalize to prevent clipping (solo si max > 1)
    if (max > 1) {
      const invMax = 1 / max;
      for (let i = 0; i < mixed.length; i++) {
        mixed[i] *= invMax;
      }
    }

    return mixed;
  }

    /**
   * Detect pitch using autocorrelation algorithm with correct parabolic interpolation
   */
  detectPitch(buffer, sampleRate) {
    if (!buffer || buffer.length < 256 || !sampleRate || sampleRate <= 0) {
      return -1;
    }

    const len = buffer.length;
    let sum = 0;
    let maxVal = 0;

    // Pasada única: RMS + Max Value
    for (let i = 0; i < len; i++) {
      const v = buffer[i];
      sum += v * v;
      const absV = v >= 0 ? v : -v;
      if (absV > maxVal) maxVal = absV;
    }

    const rms = Math.sqrt(sum / len);
    // FIX: umbral bajo para que el pitch responda al canto normal (no solo
    // gritando). A 0.0015 solo reaccionaba a voces muy fuertes. 0.008 sigue
    // descartando silencio puro/ruido de fondo pero admite voz suave.
    if (!isFinite(rms) || rms < 0.005) return -1;
    if (maxVal === 0) return -1;

    // Asegurar buffer temporal lo suficientemente grande
    const clipLen = Math.min(len, this._tempClipped.length);
    if (clipLen < len) {
      this._tempClipped = new Float32Array(len);
    }
    const clippedBuffer = this._tempClipped;

    const clipThreshold = maxVal * 0.3;
    for (let i = 0; i < len; i++) {
      const v = buffer[i];
      const absV = v >= 0 ? v : -v;
      if (absV > clipThreshold) {
        clippedBuffer[i] = v > 0 ? v - clipThreshold : v + clipThreshold;
      } else {
        clippedBuffer[i] = 0;
      }
    }

    const bufferSize = Math.min(2048, len);
    let bestOffset = -1;
    let bestCorrelation = -1;

    const minOffset = Math.floor(sampleRate / 1000); // 1000 Hz
    const maxOffset = Math.ceil(sampleRate / 60);    // 60 Hz

    for (let offset = minOffset; offset < Math.min(maxOffset, bufferSize / 2); offset++) {
      let correlation = 0;

      for (let i = 0; i < bufferSize - offset; i++) {
        correlation += clippedBuffer[i] * clippedBuffer[i + offset];
      }

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (bestOffset === -1 || bestCorrelation <= 0) return -1;

    let finalOffset = bestOffset;
    if (bestOffset > 1 && bestOffset < bufferSize - 1) {
      let cMinus = 0;
      let cPlus = 0;

      for (let i = 0; i < bufferSize - bestOffset - 1; i++) {
        cMinus += clippedBuffer[i] * clippedBuffer[i + (bestOffset - 1)];
        cPlus += clippedBuffer[i] * clippedBuffer[i + (bestOffset + 1)];
      }

      const denom = 2 * (2 * bestCorrelation - cMinus - cPlus);
        if (denom !== 0 && isFinite(denom)) {
          const delta = (cMinus - cPlus) / denom;
          finalOffset = bestOffset + delta;
        }
    }

    if (!isFinite(finalOffset) || finalOffset <= 0) {
      finalOffset = bestOffset;
    }

    const frequency = sampleRate / finalOffset;

    if (!isFinite(frequency) || frequency < 55 || frequency > 1100) {
      return -1;
    }

    return frequency;
  }

  /**
   * Process audio in chunks to avoid memory issues
   */
  processAudioInChunks(audioBuffer, chunkSize = 4096) {
    if (!audioBuffer || !audioBuffer.length) {
      return [];
    }

    const safeChunkSize = Math.max(1, chunkSize | 0);
    const chunks = [];

    for (let i = 0; i < audioBuffer.length; i += safeChunkSize) {
      const end = Math.min(i + safeChunkSize, audioBuffer.length);
      chunks.push(audioBuffer.slice(i, end));
    }

    return chunks;
  }

  /**
   * Apply gain to audio buffer
   */
  applyGain(buffer, gain = 1) {
    if (!buffer) throw new Error("Invalid buffer");

    const result = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] * gain;
    }
    return result;
  }

  /**
   * Apply simple low-pass filter
   */
  applyLowPassFilter(buffer, cutoffFrequency, sampleRate) {
    if (!buffer || !buffer.length) {
      return new Float32Array(0);
    }

    if (!cutoffFrequency || cutoffFrequency <= 0) {
      throw new Error("Invalid cutoffFrequency");
    }

    if (!sampleRate || sampleRate <= 0) {
      throw new Error("Invalid sampleRate");
    }

    const result = new Float32Array(buffer.length);
    const rc = 1 / (2 * Math.PI * cutoffFrequency);
    const dt = 1 / sampleRate;
    const alpha = dt / (rc + dt);

    result[0] = buffer[0];
    for (let i = 1; i < buffer.length; i++) {
      result[i] = result[i - 1] + alpha * (buffer[i] - result[i - 1]);
    }

    return result;
  }

  /**
   * Detect silence in audio buffer
   */
  detectSilence(buffer, threshold = 0.01) {
    if (!buffer || buffer.length === 0) return true;

    let rms = 0;
    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }

    rms = Math.sqrt(rms / buffer.length);
    return !isFinite(rms) ? true : rms < threshold;
  }

  /**
   * Normalize audio buffer
   */
  normalizeAudio(buffer, targetLevel = 0.9) {
    if (!buffer) throw new Error("Invalid buffer");

    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > max) max = abs;
    }

    if (max === 0) {
      return new Float32Array(buffer);
    }

    const result = new Float32Array(buffer.length);
    const gain = targetLevel / max;

    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] * gain;
    }

    return result;
  }

  /**
   * Codifica AudioBuffer channels (Float32Array[]) a WAV PCM16 en un ArrayBuffer.
   * Estéreo si hay >= 2 canales, mono en caso contrario.
   */
  encodeWav(channels, sampleRate, numberOfChannels = (channels && channels.length) || 1) {
    if (!channels || !channels.length || !sampleRate || sampleRate <= 0) {
      throw new Error("encodeWav requiere channels y sampleRate válidos.");
    }

    const requestedChannels = Math.max(1, numberOfChannels | 0);
    const numChannels = requestedChannels >= 2 ? 2 : 1;
    const numSamples = channels[0].length || 0;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const chL = channels[0] || new Float32Array(numSamples);
    const chR = numChannels === 2 ? (channels[1] || chL) : chL;

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s0 = Math.max(-1, Math.min(1, chL[i] || 0));
      view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF, true);
      offset += 2;

      if (numChannels === 2) {
        const s1 = Math.max(-1, Math.min(1, chR[i] || 0));
        view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF, true);
        offset += 2;
      }
    }

    return buffer;
  }
}

const processor = new AudioProcessor();

self.onmessage = function (event) {
  const { command, data, id } = event.data || {};

  if (typeof id === "undefined") {
    self.postMessage({
      id: null,
      error: "Missing message id",
      success: false
    });
    return;
  }

  try {
    let result;

        switch (command) {
      case "mix":
        result = processor.mixAudioBuffers(data?.buffers, data?.gains);
        // Transferir el buffer de resultado (Zero-Copy)
        self.postMessage({ id, result, success: true }, [result.buffer]);
        break;

      case "detectPitch":
        result = processor.detectPitch(data?.buffer, data?.sampleRate);
        self.postMessage({ id, result, success: true });
        break;

      case "applyGain":
        result = processor.applyGain(data?.buffer, data?.gain);
        self.postMessage({ id, result, success: true }, [result.buffer]);
        break;

      case "encodeWav":
        result = processor.encodeWav(data?.channels, data?.sampleRate, data?.numberOfChannels);
        // Transferir el ArrayBuffer de la WAV (Zero-Copy)
        self.postMessage({ id, result, success: true }, [result]);
        break;

      case "lowPassFilter":
        result = processor.applyLowPassFilter(
          data?.buffer,
          data?.cutoffFrequency,
          data?.sampleRate
        );
        self.postMessage({ id, result, success: true }, [result.buffer]);
        break;

      case "detectSilence":
        result = processor.detectSilence(data?.buffer, data?.threshold);
        self.postMessage({ id, result, success: true });
        break;

      case "normalize":
        result = processor.normalizeAudio(data?.buffer, data?.targetLevel);
        self.postMessage({ id, result, success: true }, [result.buffer]);
        break;

      case "processChunks":
        result = processor.processAudioInChunks(data?.buffer, data?.chunkSize);
        // processChunks devuelve array de Float32Arrays, no se puede transferir fácilmente el array padre
        // pero los buffers internos sí son transferibles si el receptor lo espera.
        // Por simplicidad y compatibilidad, enviamos normal.
        self.postMessage({ id, result, success: true });
        break;

      default:
        self.postMessage({
          id,
          error: `Unknown command: ${command}`,
          success: false
        });
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || "Unknown worker error",
      success: false
    });
  }
};
