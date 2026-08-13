import { getAudioController } from './audio-controller.js';

const $ = (id) => document.getElementById(id);

const state = {
  isRecording: false
};

let agujaVivaInstance = null;
let pitchLoopTimeout = null;
const pitchBuffer = new Float32Array(2048);
let audioContext = null;
let analyser = null;
let stream = null;

export class AgujaViva {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    this.maxParticles = options.maxParticles || 120;
    this.particleLife = options.particleLife || 2.5;
    this.trailFreq = options.trailFreq || 0.025;

    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;

    this.currentFreq = -1;
    this.targetFreq = 164.81;
    this.cents = 0;
    this.maxCents = 50;

    this.needleAngle = 0;
    this.targetAngle = 0;

    this.running = false;
    this.rafId = null;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  setPitch(freq) {
    this.currentFreq = freq;
    if (freq > 0 && this.targetFreq > 0) {
      this.cents = 1200 * Math.log2(freq / this.targetFreq);
      this.targetAngle = Math.max(-1, Math.min(1, this.cents / this.maxCents));
    } else {
      this.cents = 0;
      this.targetAngle = 0;
    }
  }

  setTargetNote(noteName) {
    const notes = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
    const match = noteName ? noteName.match(/^([A-G]#?)(\d)$/) : null;
    if (!match) {
      this.targetFreq = 164.81;
      return;
    }
    const semitones = notes[match[1]] + (parseInt(match[2], 10) - 4) * 12;
    this.targetFreq = 440 * Math.pow(2, semitones / 12);
  }

  setDifficulty(level) {
    const tolerances = { facil: 50, medio: 30, dificil: 15, experto: 5 };
    this.maxCents = tolerances[level] || 30;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  tick() {
    if (!this.running) return;
    this.needleAngle += (this.targetAngle - this.needleAngle) * 0.15;
    this.render();
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h * 0.6;

    ctx.clearRect(0, 0, w, h);

    // Dibuja la aguja
    const angle = this.needleAngle * (Math.PI / 4);
    const length = Math.min(w, h) * 0.4;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();

    ctx.restore();

    // Pivot central
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.resize);
  }
}

export async function toggleRecording() {
  const btn = $("recordBtn");

  if (!state.isRecording) {
    state.isRecording = true;
    if (btn) {
      btn.innerHTML = '🎤 Detener';
      btn.classList.add("recording");
    }
    await startAfinador();
  } else {
    state.isRecording = false;
    if (btn) {
      btn.innerHTML = '🎤 Iniciar';
      btn.classList.remove("recording");
    }
    stopAfinador();

    const noteDisplay = $("currentNoteDisplay");
    const centsDisplay = $("centsDisplay");
    const guideText = $("guideText");

    if (noteDisplay) noteDisplay.textContent = "--";
    if (centsDisplay) centsDisplay.textContent = "";
    if (guideText) guideText.textContent = "🎤 Esperando voz...";
  }
}

async function startAfinador() {
  const canvas = $("agujaCanvas");
  if (canvas) {
    agujaVivaInstance = new AgujaViva(canvas);
    const targetNoteEl = $("targetNote");
    const difficultyEl = $("afinadorDifficulty");

    if (targetNoteEl) agujaVivaInstance.setTargetNote(targetNoteEl.value);
    if (difficultyEl) agujaVivaInstance.setDifficulty(difficultyEl.value);

    agujaVivaInstance.start();
  }

  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtxClass();

  // Solución para Brave/Chrome
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const mic = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);

  runPitchDetectionLoop();
}

function stopAfinador() {
  if (pitchLoopTimeout) {
    clearTimeout(pitchLoopTimeout);
    pitchLoopTimeout = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyser = null;
  if (agujaVivaInstance) {
    agujaVivaInstance.destroy();
    agujaVivaInstance = null;
  }
}

async function runPitchDetectionLoop() {
  if (!state.isRecording || !analyser || !audioContext) return;
  analyser.getFloatTimeDomainData(pitchBuffer);

  try {
    const audioController = typeof getAudioController === 'function' ? getAudioController() : null;
    let pitch = -1;
    let note = null;
    let cents = 0;

    if (audioController && typeof audioController.detectPitch === 'function') {
      const res = await audioController.detectPitch(pitchBuffer, audioContext.sampleRate);
      if (res) {
        pitch = res.pitch || -1;
        note = res.note || null;
        cents = res.cents || 0;
      }
    }

    const guideText = $("guideText");
    const noteDisplay = $("currentNoteDisplay");
    const centsDisplay = $("centsDisplay");

    if (agujaVivaInstance) {
      if (pitch > 0) {
        agujaVivaInstance.setPitch(pitch);
        if (guideText) guideText.textContent = `🎤 Escuchando (${Math.round(pitch)} Hz)`;
        if (noteDisplay && note) noteDisplay.textContent = note;
        if (centsDisplay) centsDisplay.textContent = `${cents > 0 ? '+' : ''}${Math.round(cents)}¢`;
      } else {
        agujaVivaInstance.setPitch(-1);
        if (guideText) guideText.textContent = "🎤 Esperando voz...";
      }
    }
  } catch (err) {
    console.error("Error en bucle de detección:", err);
  }

  if (state.isRecording) {
    pitchLoopTimeout = setTimeout(runPitchDetectionLoop, 20);
  }
}
