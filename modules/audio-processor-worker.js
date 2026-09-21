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
    this._tempCorr = new Float32Array(0);
  }

    /**
   * Mix multiple audio buffers without blocking main thread
   * Optimizado: 2 pasadas (mezcla+busca pico -> normaliza)
   */
  mixAudioBuffers(buffers, gains = null) {
    if (!Array.isArray(buffers) || buffers.length === 0) {
      throw new Error("No audio buffers to mix");
    }

    let maxLength = 0;
    for (let b = 0; b < buffers.length; b++) {
      const l = (buffers[b] && buffers[b].length) || 0;
      if (l > maxLength) maxLength = l;
    }
    if (maxLength === 0) {
      return new Float32Array(0);
    }

    const mixed = new Float32Array(maxLength);

    buffers.forEach((buffer, index) => {
      if (!buffer) return;

      let gain =
        gains && gains[index] !== undefined
          ? gains[index]
          : 1;
      // Un gain NaN/Infinito contaminaría todo el mix sin que ningún max lo
      // detecte (NaN > max siempre es falso).
      if (!Number.isFinite(gain)) gain = 1;

      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        mixed[i] += Number.isFinite(v) ? v * gain : 0;
      }
    });

    // Pico del MIX (no por fuente): dos voces a 0.6 suman 1.2 y clipean
    // aunque cada una mida 0.6. Segunda pasada dedicada.
    let max = 0;
    for (let i = 0; i < mixed.length; i++) {
      const abs = mixed[i] >= 0 ? mixed[i] : -mixed[i];
      if (abs > max) max = abs;
    }

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
    if (!isFinite(rms) || rms < 0.006) return -1;
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
    const maxOff = Math.min(maxOffset, bufferSize / 2);

    // Calcular la correlación de TODOS los offsets de una vez (y reutilizar
    // el buffer) para poder elegir el pico fundamental de forma informada.
    if (this._tempCorr.length < maxOff + 1) this._tempCorr = new Float32Array(maxOff + 1);
    const corrArr = this._tempCorr;
    for (let offset = minOffset; offset < maxOff; offset++) {
      let correlation = 0;
      for (let i = 0; i < bufferSize - offset; i++) {
        correlation += clippedBuffer[i] * clippedBuffer[i + offset];
      }
      corrArr[offset] = correlation;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (bestOffset === -1 || bestCorrelation <= 0) return -1;

    // FIX sub-octava: el pico del fundamental suele ser MÁS DÉBIL que el de
    // sus armónicos, así que el offset ganador tiende a 2x/3x el periodo real
    // (el punto cae una octava o más "hacia el suelo"). Preferimos el offset
    // más temprano cuya correlación sea >= 90% de la máxima, si además forma
    // un pico local. Si no hay candidato temprano fuerte, se conserva el mejor.
    let chosenOffset = bestOffset;
    for (let offset = minOffset; offset < bestOffset; offset++) {
      const c = corrArr[offset];
      if (c < bestCorrelation * 0.9) continue;
      const cPrev = offset > minOffset ? corrArr[offset - 1] : 0;
      const cNext = offset + 1 < maxOff ? corrArr[offset + 1] : c;
      if (c >= cPrev && c >= cNext) {
        chosenOffset = offset;
        break;
      }
    }
    const chosenCorr = corrArr[chosenOffset];

    // FIX #17: OCTAVA ALTA EXIGENTE. El piso de ruido de un mic USB (espectro
    // 1/f "rosa") produce una autocorrelación que decae monótonamente; su
    // pico cae casi siempre en el PRIMER lag (f ~ 1000 Hz, "B5") de forma
    // CONSTANTE de frame a frame — insostenible de filtrar solo en la app.
    // Un tono/voz real (>630 Hz) vuelve a correlar fuerte en sus múltiplos
    // (2x, 3x); el ruido rosa no (mide ~0.75/0.60 vs 0.90+ del tono real).
    // Se exige esa evidencia SOLO en esta octava alta; el resto del rango
    // (donde el ruido no correlaciona y la voz de karaoke vive) no se toca.
    if (chosenOffset < sampleRate / 630) {
      const secondOk = chosenOffset * 2 < maxOff ? corrArr[chosenOffset * 2] >= chosenCorr * 0.85 : false;
      const thirdOk = chosenOffset * 3 < maxOff ? corrArr[chosenOffset * 3] >= chosenCorr * 0.7 : false;
      if (!secondOk || !thirdOk) return -1;
    }

    bestOffset = chosenOffset;
    bestCorrelation = chosenCorr;

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
    if (!Number.isFinite(targetLevel) || targetLevel <= 0) {
      throw new Error("normalizeAudio requiere targetLevel finito y positivo.");
    }

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
    // Validar longitudes: antes se usaba solo channels[0] y el resto se
    // rellenaba en silencio (o se cortaba a 2ch sin aviso).
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (!(ch instanceof Float32Array) || ch.length === 0 || ch.byteLength === 0) {
        throw new Error(`encodeWav: canal ${c} vacío o detached.`);
      }
    }
    const numSamples = channels[0].length;
    for (let c = 1; c < channels.length; c++) {
      if (channels[c].length !== numSamples) {
        throw new Error(`encodeWav: canales con longitudes distintas (${numSamples} vs ${channels[c].length}).`);
      }
    }
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
