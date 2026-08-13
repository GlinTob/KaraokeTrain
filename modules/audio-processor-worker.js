// ==========================================
// OPTIMIZED AUDIO PROCESSING WORKER
// ==========================================
// This Web Worker handles audio mixing + pitch detection off the main thread
// Prevents UI freezing during audio operations
// File: audio-processor.worker.js

class AudioProcessor {
  constructor() {
    this.isProcessing = false;
  }

  /**
   * Mix multiple audio buffers without blocking main thread
   */
  mixAudioBuffers(buffers, gains = null) {
    if (!buffers || buffers.length === 0) {
      throw new Error('No audio buffers to mix');
    }

    const maxLength = Math.max(...buffers.map(b => b.length));
    const mixed = new Float32Array(maxLength);

    buffers.forEach((buffer, index) => {
      const gain = gains && gains[index] ? gains[index] : 1;
      for (let i = 0; i < buffer.length; i++) {
        mixed[i] += buffer[i] * gain;
      }
    });

    // Normalize to prevent clipping
    let max = 0;
    for (let i = 0; i < mixed.length; i++) {
      if (Math.abs(mixed[i]) > max) max = Math.abs(mixed[i]);
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
    if (!buffer || buffer.length < 256) return -1;

    // 1. CÁLCULO DE ENERGÍA (RMS) DE ENTRADA
    let sum = 0;
    const len = buffer.length;
    for (let i = 0; i < len; i++) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / len);

    if (rms < 0.015) return -1;

    // 2. RECORTAR RUIDO PERIFÉRICO (Center Clipping)
    const clippedBuffer = new Float32Array(len);
    let maxVal = 0;
    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(buffer[i]);
      if (absVal > maxVal) maxVal = absVal;
    }
    const clipThreshold = maxVal * 0.3;
    for (let i = 0; i < len; i++) {
      if (Math.abs(buffer[i]) > clipThreshold) {
        clippedBuffer[i] = buffer[i] > 0 ? buffer[i] - clipThreshold : buffer[i] + clipThreshold;
      } else {
        clippedBuffer[i] = 0;
      }
    }

    // 3. AUTOCORRELACIÓN MATEMÁTICA REAL POR PRODUCTO CRUZADO
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

    // 4. INTERPOLACIÓN PARABÓLICA REFORZADA
    let finalOffset = bestOffset;
    if (bestOffset > 0 && bestOffset < bufferSize - 1) {
      let cMinus = 0, cPlus = 0;
      for (let i = 0; i < bufferSize - bestOffset; i++) {
        cMinus += clippedBuffer[i] * clippedBuffer[i + (bestOffset - 1)];
        cPlus += clippedBuffer[i] * clippedBuffer[i + (bestOffset + 1)];
      }
      const divisor = (2 * bestCorrelation - cMinus - cPlus);
      if (divisor !== 0) {
        finalOffset = bestOffset + (cMinus - cPlus) / divisor;
      }
    }

    if (!isFinite(finalOffset) || finalOffset <= 0) finalOffset = bestOffset;
    const frequency = sampleRate / finalOffset;

    if (!isFinite(frequency) || frequency < 55 || frequency > 1100) return -1;

    return frequency;
  }
  
  /**
   * Process audio in chunks to avoid memory issues
   */
  processAudioInChunks(audioBuffer, chunkSize = 4096) {
    const chunks = [];
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, audioBuffer.length);
      chunks.push(audioBuffer.slice(i, end));
    }
    return chunks;
  }

  /**
   * Apply gain to audio buffer
   */
  applyGain(buffer, gain) {
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
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    return rms < threshold;
  }

  /**
   * Normalize audio buffer
   */
  normalizeAudio(buffer, targetLevel = 0.9) {
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (Math.abs(buffer[i]) > max) max = Math.abs(buffer[i]);
    }

    if (max === 0) return buffer;

    const result = new Float32Array(buffer.length);
    const gain = targetLevel / max;
    for (let i = 0; i < buffer.length; i++) {
      result[i] = buffer[i] * gain;
    }

    return result;
  }
}

// Worker message handler
const processor = new AudioProcessor();

self.onmessage = function (event) {
  const { command, data, id } = event.data;

  try {
    let result;

    switch (command) {
      case 'mix':
        result = processor.mixAudioBuffers(data.buffers, data.gains);
        self.postMessage({ id, result, success: true });
        break;

      case 'detectPitch':
        result = processor.detectPitch(data.buffer, data.sampleRate);
        self.postMessage({ id, result, success: true });
        break;

      case 'applyGain':
        result = processor.applyGain(data.buffer, data.gain);
        self.postMessage({ id, result, success: true });
        break;

      case 'lowPassFilter':
        result = processor.applyLowPassFilter(
          data.buffer,
          data.cutoffFrequency,
          data.sampleRate
        );
        self.postMessage({ id, result, success: true });
        break;

      case 'detectSilence':
        result = processor.detectSilence(data.buffer, data.threshold);
        self.postMessage({ id, result, success: true });
        break;

      case 'normalize':
        result = processor.normalizeAudio(data.buffer, data.targetLevel);
        self.postMessage({ id, result, success: true });
        break;

      case 'processChunks':
        result = processor.processAudioInChunks(data.buffer, data.chunkSize);
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
      error: error.message,
      success: false
    });
  }
};