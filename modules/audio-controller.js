// modules/audio-controller.js
// PROCESADOR ACÚSTICO COMPARTIDO Y ENCODER WAV PCM

export class AudioProcessorController {
  constructor(workerPath = new URL("./audio-processor-worker.js", import.meta.url)) {
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.isTerminated = false;

    this.worker = new Worker(workerPath, { type: "module" });

    this.worker.onmessage = (event) => {
      const data = event.data;

      if (!data || typeof data.id === "undefined") {
        console.warn("Mensaje inválido recibido del audio worker:", data);
        return;
      }

      const { id, result, error, success } = data;
      const request = this.pendingRequests.get(id);

      if (!request) {
        console.warn(`No se encontró request pendiente para id=${id}`);
        return;
      }

      if (success) {
        request.resolve(result);
      } else {
        request.reject(new Error(error || "Error desconocido en audio worker"));
      }

      this.pendingRequests.delete(id);
    };

    this.worker.onerror = (error) => {
      console.error("Audio Worker Error:", error);
      this.rejectAllPending(new Error("El audio worker falló."));
    };

    this.worker.onmessageerror = (error) => {
      console.error("Audio Worker Message Error:", error);
      this.rejectAllPending(new Error("Error al deserializar mensaje del audio worker."));
    };
  }

  rejectAllPending(error) {
    for (const [, request] of this.pendingRequests) {
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  async execute(command, data = {}) {
    if (this.isTerminated) {
      throw new Error("El audio controller fue terminado y no puede procesar más comandos.");
    }

    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.worker.postMessage({ command, data, id });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async mixAudio(buffers, gains = null) {
    if (!Array.isArray(buffers) || buffers.length === 0) {
      throw new Error("mixAudio requiere un array no vacío de buffers.");
    }

    const normalizedBuffers = buffers.map((b, index) => {
      try {
        return b instanceof Float32Array ? b : new Float32Array(b);
      } catch {
        throw new Error(`Buffer inválido en posición ${index} dentro de mixAudio.`);
      }
    });

    const result = await this.execute("mix", {
      buffers: normalizedBuffers,
      gains
    });

    return new Float32Array(result);
  }

  async detectPitch(buffer, sampleRate) {
    if (!buffer) throw new Error("detectPitch requiere un buffer válido.");
    if (!sampleRate) throw new Error("detectPitch requiere sampleRate.");

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    return await this.execute("detectPitch", {
      buffer: floatBuffer,
      sampleRate
    });
  }

  async applyGain(buffer, gain) {
    if (!buffer) throw new Error("applyGain requiere un buffer válido.");

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute("applyGain", { buffer: floatBuffer, gain });

    return new Float32Array(result);
  }

  async applyLowPassFilter(buffer, cutoffFrequency, sampleRate) {
    if (!buffer) throw new Error("applyLowPassFilter requiere un buffer válido.");
    if (!cutoffFrequency || !sampleRate) {
      throw new Error("applyLowPassFilter requiere cutoffFrequency y sampleRate.");
    }

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute("lowPassFilter", {
      buffer: floatBuffer,
      cutoffFrequency,
      sampleRate
    });

    return new Float32Array(result);
  }

  async detectSilence(buffer, threshold = 0.01) {
    if (!buffer) throw new Error("detectSilence requiere un buffer válido.");

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    return await this.execute("detectSilence", {
      buffer: floatBuffer,
      threshold
    });
  }

  async normalizeAudio(buffer, targetLevel = 0.9) {
    if (!buffer) throw new Error("normalizeAudio requiere un buffer válido.");

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute("normalize", {
      buffer: floatBuffer,
      targetLevel
    });

    return new Float32Array(result);
  }

  async processInChunks(buffer, chunkSize = 4096) {
    if (!buffer) throw new Error("processInChunks requiere un buffer válido.");

    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const chunks = await this.execute("processChunks", {
      buffer: floatBuffer,
      chunkSize
    });

    if (!Array.isArray(chunks)) {
      throw new Error("Respuesta inválida del worker en processInChunks.");
    }

    return chunks.map((c) => new Float32Array(c));
  }

  terminate() {
    if (this.isTerminated) return;

    this.isTerminated = true;
    this.rejectAllPending(new Error("Audio worker terminado."));
    this.worker.terminate();
  }
}

let audioController = null;

export function getAudioController() {
  if (!audioController || audioController.isTerminated) {
    audioController = new AudioProcessorController();
  }
  return audioController;
}

export function destroyAudioController() {
  if (audioController) {
    audioController.terminate();
    audioController = null;
  }
}

// ====================================================================
// SUBRUTINAS DE CODIFICACIÓN WAV
// ====================================================================

export function interleave(inputL, inputR) {
  if (!inputL || !inputR) {
    throw new Error("interleave requiere dos buffers válidos.");
  }

  const minLength = Math.min(inputL.length, inputR.length);
  const result = new Float32Array(minLength * 2);

  let index = 0;
  for (let i = 0; i < minLength; i++) {
    result[index++] = inputL[i];
    result[index++] = inputR[i];
  }

  return result;
}

export function exportStereoWav(audioBuffer) {
  if (!audioBuffer) return null;

  const originalChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  let result;
  let outputChannels;

  if (originalChannels >= 2) {
    result = interleave(
      audioBuffer.getChannelData(0),
      audioBuffer.getChannelData(1)
    );
    outputChannels = 2;
  } else {
    result = audioBuffer.getChannelData(0);
    outputChannels = 1;
  }

  const buffer = new ArrayBuffer(44 + result.length * 2);
  const view = new DataView(buffer);

  const writeString = (viewObj, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      viewObj.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + result.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, outputChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * outputChannels * (bitDepth / 8), true);
  view.setUint16(32, outputChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, result.length * 2, true);

  let offset = 44;
  for (let i = 0; i < result.length; i++) {
    const sample = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
