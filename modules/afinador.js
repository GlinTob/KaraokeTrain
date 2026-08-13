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

// Auxiliares de cálculo de notas y frecuencias
function frequencyToCentsOff(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
}

function noteToFrequency(noteName) {
  const notes = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
  const match = noteName ? noteName.match(/^([A-G]#?)(\d)$/) : null;
  if (!match) return 164.81; // E3 por defecto
  const key = match[1];
  const octave = parseInt(match[2], 10);
  const semitones = notes[key] + (octave - 4) * 12;
  return 440 * Math.pow(2, semitones / 12);
}

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
    this.maxCents = 30;

    this.needleAngle = 0;
    this.targetAngle = 0;
    this.shakeIntensity = 0;
    this.shakeDecay = 0.85;
    this.burstRadius = 0;
    this.burstAlpha = 0;
    this.popScale = 1;
    this.popDecay = 0.8;

    this.particles = [];
    this.particleSpawnAccum = 0;
    this.ripples = [];
    this.wasInTolerance = false;
    this.rippleCooldown = 0;

    this.colors = {
      bg: '#0f172a',
      needle: '#facc15',
      needleGlow: 'rgba(250, 204, 21, 0.6)',
      center: '#22c55e',
      centerGlow: 'rgba(34, 197, 94, 0.5)',
      flat: '#3b82f6',
      sharp: '#f97316',
      ledOn: '#22c55e',
      ledOff: 'rgba(148, 163, 184, 0.15)',
      ledFlat: '#3b82f6',
      ledSharp: '#f97316',
      textMuted: '#94a3b8',
      grid: 'rgba(148, 163, 184, 0.08)',
    };

    this.rafId = null;
    this.lastTime = 0;
    this.running = false;

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
      this.cents = frequencyToCentsOff(freq, this.targetFreq);
      const targetAngle = Math.max(-1, Math.min(1, this.cents / this.maxCents));

      const isNowInTolerance = Math.abs(this.cents) <= this.maxCents;
      if (isNowInTolerance && !this.wasInTolerance && this.rippleCooldown <= 0) {
        this.triggerRipple();
        this.triggerBurst();
        this.rippleCooldown = 1.0;
      }
      this.wasInTolerance = isNowInTolerance;
      this.targetAngle = targetAngle;
    } else {
      this.cents = 0;
      this.targetAngle = 0;
      this.wasInTolerance = false;
    }
  }

  setTargetNote(noteName) {
    this.targetFreq = noteToFrequency(noteName);
  }

  setDifficulty(level) {
    const tolerances = { facil: 50, medio: 30, dificil: 15, experto: 5 };
    this.maxCents = tolerances[level] || 30;
  }

  triggerBurst() {
    this.burstRadius = 0;
    this.burstAlpha = 1;
    this.popScale = 1.3;
  }

  triggerRipple() {
    const cx = this.width / 2;
    const cy = this.height * 0.55;
    this.ripples.push({
      x: cx,
      y: cy,
      radius: 10,
      maxRadius: Math.max(this.width, this.height) * 0.5,
      alpha: 1,
      color: this.colors.center
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  tick(timestamp) {
    if (!this.running) return;
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  update(dt) {
    this.needleAngle += (this.targetAngle - this.needleAngle) * Math.min(1, dt * 10);

    if (this.burstAlpha > 0) {
      this.burstRadius += dt * 250;
      this.burstAlpha -= dt * 2;
    }

    if (this.popScale > 1) {
      this.popScale -= dt * 1.5;
      if (this.popScale < 1) this.popScale = 1;
    }

    if (this.rippleCooldown > 0) this.rippleCooldown -= dt;

    this.ripples.forEach(r => {
      r.radius += dt * 200;
      r.alpha = Math.max(0, 1 - r.radius / r.maxRadius);
    });
    this.ripples = this.ripples.filter(r => r.alpha > 0);

    this.spawnParticles(dt);
    this.particles.forEach(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  spawnParticles(dt) {
    if (this.currentFreq <= 0) return;

    this.particleSpawnAccum += dt;
    if (this.particleSpawnAccum > this.trailFreq && this.particles.length < this.maxParticles) {
      this.particleSpawnAccum = 0;
      const cx = this.width / 2;
      const cy = this.height * 0.55;
      const angle = (this.needleAngle * Math.PI / 6) - Math.PI / 2;
      const speed = 40 + Math.random() * 60;

      let color = this.colors.sharp;
      if (Math.abs(this.cents) <= this.maxCents) color = this.colors.center;
      else if (this.cents < 0) color = this.colors.flat;

      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 20,
        vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 20,
        life: this.particleLife,
        maxLife: this.particleLife,
        size: 2 + Math.random() * 4,
        color,
        alpha: 1
      });
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h * 0.55;

    ctx.clearRect(0, 0, w, h);

    // Fondo y Rejilla
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const x = (w / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Centro objetivo (Línea punteada)
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.2);
    ctx.lineTo(cx, h * 0.8);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ondas Ripple
    this.ripples.forEach(r => {
      ctx.strokeStyle = `rgba(34, 197, 94, ${r.alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Partículas
    this.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Aguja Principal
    const angle = this.needleAngle * (Math.PI / 6);
    const length = Math.min(w, h) * 0.35;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.strokeStyle = this.colors.needle;
    ctx.lineWidth = 4;
    ctx.shadowColor = this.colors.needleGlow;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Barra LED inferior
    this.renderLedBar(ctx, w, h);

    // Pivot Central
    ctx.fillStyle = this.colors.center;
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * this.popScale, 0, Math.PI * 2);
    ctx.fill();
  }

  renderLedBar(ctx, w, h) {
    const barY = h * 0.85;
    const barW = w * 0.6;
    const barX = (w - barW) / 2;
    const segmentCount = 21;
    const segmentW = barW / segmentCount;
    const centerIdx = Math.floor(segmentCount / 2);
    const litCount = Math.floor((this.needleAngle + 1) / 2 * segmentCount);

    for (let i = 0; i < segmentCount; i++) {
      const x = barX + i * segmentW + 2;
      const wSeg = segmentW - 4;
      let color = this.colors.ledOff;

      if (i === centerIdx && Math.abs(this.cents) <= this.maxCents && this.currentFreq > 0) {
        color = this.colors.ledOn;
      } else if (i < centerIdx && i >= litCount) {
        color = this.colors.ledFlat;
      } else if (i > centerIdx && i <= litCount) {
        color = this.colors.ledSharp;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, barY, wSeg, 12);
    }
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

    if (targetNoteEl) targetNoteEl.onchange = () => agujaVivaInstance.setTargetNote(targetNoteEl.value);
    if (difficultyEl) difficultyEl.onchange = () => agujaVivaInstance.setDifficulty(difficultyEl.value);

    agujaVivaInstance.start();
  }

  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtxClass();

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
