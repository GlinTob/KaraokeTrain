// modules/audio-controller.js - PROCESADOR ACÚSTICO COMPARTIDO Y ENCODER WAV PCM

export class AudioProcessorController {
  constructor(workerPath = new URL('./audio-processor-worker.js', import.meta.url)) {
    this.worker = new Worker(workerPath);
    this.pendingRequests = new Map();
    this.requestId = 0;

    this.worker.onmessage = (event) => {
      const { id, result, error, success } = event.data;
      const request = this.pendingRequests.get(id);
      if (!request) return;

      if (success) {
        request.resolve(result);
      } else {
        request.reject(new Error(error));
      }
      this.pendingRequests.delete(id);
    };

    this.worker.onerror = (error) => {
      console.error('Audio Worker Error:', error);
    };
  }

  async execute(command, data) {
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
    const bufferData = buffers.map(b => ({
      buffer: b instanceof Float32Array ? b : new Float32Array(b)
    }));
    const result = await this.execute('mix', {
      buffers: bufferData.map(b => b.buffer),
      gains
    });
    return new Float32Array(result);
  }

  async detectPitch(buffer, sampleRate) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    return await this.execute('detectPitch', {
      buffer: floatBuffer,
      sampleRate
    });
  }

  async applyGain(buffer, gain) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('applyGain', { buffer: floatBuffer, gain });
    return new Float32Array(result);
  }

  async applyLowPassFilter(buffer, cutoffFrequency, sampleRate) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('lowPassFilter', { buffer: floatBuffer, cutoffFrequency, sampleRate });
    return new Float32Array(result);
  }

  async detectSilence(buffer, threshold = 0.01) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    return await this.execute('detectSilence', { buffer: floatBuffer, threshold });
  }

  async normalizeAudio(buffer, targetLevel = 0.9) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('normalize', { buffer: floatBuffer, targetLevel });
    return new Float32Array(result);
  }

  async processInChunks(buffer, chunkSize = 4096) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const chunks = await this.execute('processChunks', { buffer: floatBuffer, chunkSize });
    return chunks.map(c => new Float32Array(c));
  }

  terminate() {
    this.worker.terminate();
  }
}

let audioController = null;

export function getAudioController() {
  if (!audioController) {
    audioController = new AudioProcessorController();
  }
  return audioController;
}

// ====================================================================
// 🎧 SUBRUTINAS DE CODIFICACIÓN WAV ADICIONADAS PARA EL SPLITTER IA
// ====================================================================
export function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

export function exportStereoWav(audioBuffer) {
  if (!audioBuffer) return null;
  const numOfChan = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; 
  const bitDepth = 16;
  
  let result;
  if (numOfChan === 2) {
    result = interleave(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1));
  } else {
    result = audioBuffer.getChannelData(0);
  }
  
  const buffer = new ArrayBuffer(44 + result.length * 2);
  const view = new DataView(buffer);
  
  const writeString = (viewObj, offset, string) => {
    for (let i = 0; i < string.length; i++) viewObj.setUint8(offset + i, string.charCodeAt(i));
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + result.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, result.length * 2, true);
  
  let offset = 44;
  for (let i = 0; i < result.length; i++) {
    let sample = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
