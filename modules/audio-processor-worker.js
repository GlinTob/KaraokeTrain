// ==========================================
// OPTIMIZED AUDIO PROCESSING WORKER
// ==========================================
// This Web Worker handles audio mixing + pitch detection off the main thread
// Prevents UI freezing during audio operations
// File: audio-processor-worker.js

class AudioProcessor {
  /**
   * Mix multiple audio buffers without blocking main thread
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

    buffers.forEach((buffer, index) => {
      if (!buffer) return;

      const gain =
        gains && gains[index] !== undefined
          ? gains[index]
          : 1;

      for (let i = 0; i < buffer.length; i++) {
        mixed[i] += buffer[i] * gain;
      }
    });

    // Normalize to prevent clipping
    let max = 0;
    for (let i = 0; i < mixed.length; i++) {
      const abs = Math.abs(mixed[i]);
      if (abs > max) max = abs;
    }

    if (max > 1) {
      for (let i = 0; i < mixed.length; i++) {
        mixed[i] /= max;
      }
    }

    return mixed;
  }

  /**
   * Detect pitch using autocorrelation algorithm
   */
  detectPitch(buffer, sampleRate) {
    if (!buffer || buffer.length < 256 || !sampleRate || sampleRate <= 0) {
      return -1;
    }

    let sum = 0;
    const len = buffer.length;
    for (let i = 0; i < len; i++) {
      sum += buffer[i] * buffer[i];
    }

    const rms = Math.sqrt(sum / len);
    if (!isFinite(rms) || rms < 0.015) return -1;

    const clippedBuffer = new Float32Array(len);
    let maxVal = 0;

    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(buffer[i]);
      if (absVal > maxVal) maxVal = absVal;
    }

    const clipThreshold = maxVal * 0.3;
    for (let i = 0; i < len; i++) {
      if (Math.abs(buffer[i]) > clipThreshold) {
        clippedBuffer[i] =
          buffer[i] > 0
            ? buffer[i] - clipThreshold
            : buffer[i] + clipThreshold;
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

      const divisor = 2 * bestCorrelation - cMinus - cPlus;
      if (divisor !== 0 && isFinite(divisor)) {
        finalOffset = bestOffset + (cMinus - cPlus) / divisor;
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
        self.postMessage({ id, result, success: true });
        break;

      case "detectPitch":
        result = processor.detectPitch(data?.buffer, data?.sampleRate);
        self.postMessage({ id, result, success: true });
        break;

      case "applyGain":
        result = processor.applyGain(data?.buffer, data?.gain);
        self.postMessage({ id, result, success: true });
        break;

      case "lowPassFilter":
        result = processor.applyLowPassFilter(
          data?.buffer,
          data?.cutoffFrequency,
          data?.sampleRate
        );
        self.postMessage({ id, result, success: true });
        break;

      case "detectSilence":
        result = processor.detectSilence(data?.buffer, data?.threshold);
        self.postMessage({ id, result, success: true });
        break;

      case "normalize":
        result = processor.normalizeAudio(data?.buffer, data?.targetLevel);
        self.postMessage({ id, result, success: true });
        break;

      case "processChunks":
        result = processor.processAudioInChunks(data?.buffer, data?.chunkSize);
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
