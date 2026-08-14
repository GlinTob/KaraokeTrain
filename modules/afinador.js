import { getAudioController } from './audio-controller.js';

/**
 * AFINADOR VOCAL — indicador vertical con punto neón, partículas y ondas
 */

const $ = (id) => document.getElementById(id);

const state = {
  isRecording: false
};

let afinadorVisual = null;
let pitchLoopTimeout = null;
const pitchBuffer = new Float32Array(2048);
let audioContext = null;
let analyser = null;
let stream = null;

// ==========================================================
// UTILIDADES MUSICALES
// ==========================================================

function frequencyToCentsOff(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
}

function noteToFrequency(noteName) {
  const notes = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const match = noteName.match(/^([A-G]#?)(\d)$/);
  if (!match) return 164.81; // E3 por defecto
  const key = match[1];
  const octave = parseInt(match[2], 10);
  const semitonesFromA4 = (notes[key] - 9) + (octave - 4) * 12;
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function frequencyToNoteName(freq) {
  if (!freq || freq <= 0) return '--';
  return midiToNoteName(frequencyToMidi(freq));
}

// ==========================================================
// VISUAL PRINCIPAL DEL AFINADOR
// ==========================================================

export class AfinadorVisual {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;

    this.currentFreq = -1;
    this.targetFreq = 82.41; // E2 aprox
    this.currentNote = '--';
    this.cents = 0;
    this.maxCents = 30;

    this.markerOffset = 0;
    this.targetMarkerOffset = 0;

    this.glowPulse = 0;
    this.particles = [];
    this.maxParticles = 100;
    this.ripples = [];
    this.wasTuned = false;
    this.rippleCooldown = 0;
    this.particleAccum = 0;

    this.colors = {
      bg: '#081226',
      axis: '#facc15',
      axisGlow: 'rgba(250, 204, 21, 0.35)',
      marker: '#22c55e',
      markerGlow: 'rgba(34, 197, 94, 0.8)',
      flat: '#3b82f6',
      sharp: '#f97316',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      decoBlue: 'rgba(59, 130, 246, 0.22)',
      decoOrange: 'rgba(249, 115, 22, 0.22)',
      ripple: '#22c55e',
      grid: 'rgba(148, 163, 184, 0.08)'
    };

    this.running = false;
    this.rafId = null;
    this.lastTime = 0;

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
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  setTargetNote(noteName) {
    this.targetFreq = noteToFrequency(noteName);
  }

  setDifficulty(level) {
    const tolerances = {
      facil: 50,
      medio: 30,
      dificil: 15,
      experto: 5
    };
    this.maxCents = tolerances[level] || 30;
  }

  setPitch(freq) {
    this.currentFreq = freq;

    if (!freq || freq <= 0 || !this.targetFreq) {
      this.currentNote = '--';
      this.cents = 0;
      this.targetMarkerOffset = 0;
      this.wasTuned = false;
      return;
    }

    this.currentNote = frequencyToNoteName(freq);
    this.cents = frequencyToCentsOff(freq, this.targetFreq);

    const limited = Math.max(-1, Math.min(1, this.cents / this.maxCents));
    const maxTravel = this.height * 0.23;

    // Grave = abajo / Agudo = arriba
    this.targetMarkerOffset = -limited * maxTravel;

    const inTune = Math.abs(this.cents) <= this.maxCents * 0.25;

    if (inTune && !this.wasTuned && this.rippleCooldown <= 0) {
      this.triggerRipple();
      this.rippleCooldown = 1.0;
    }

    this.wasTuned = inTune;
  }

  triggerRipple() {
    const cx = this.width / 2;
    const cy = this.height * 0.55;

    for (let i = 0; i < 4; i++) {
      this.ripples.push({
        x: cx,
        y: cy,
        radius: i * 10,
        alpha: 0.8 - i * 0.12,
        lineWidth: 3 - i * 0.4,
        maxRadius: Math.max(this.width, this.height) * 0.5
      });
    }
  }

  spawnParticle() {
    const cx = this.width / 2;
    const cy = this.height * 0.55 + this.markerOffset;

    const closeness = 1 - Math.min(1, Math.abs(this.cents) / Math.max(this.maxCents, 1));
    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 80 * (0.5 + closeness);

    let color = this.colors.marker;
    if (this.cents < -this.maxCents * 0.25) color = this.colors.flat;
    if (this.cents > this.maxCents * 0.25) color = this.colors.sharp;

    this.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.6,
      maxLife: 1,
      alpha: 1,
      size: 2 + Math.random() * 4,
      color
    });
  }

  update(dt) {
    const diff = this.targetMarkerOffset - this.markerOffset;
    this.markerOffset += diff * Math.min(1, dt * 10);

    this.glowPulse += dt * 5;

    if (this.rippleCooldown > 0) {
      this.rippleCooldown -= dt;
    }

    const closeness = this.currentFreq > 0
      ? 1 - Math.min(1, Math.abs(this.cents) / Math.max(this.maxCents, 1))
      : 0;

    if (this.currentFreq > 0) {
      this.particleAccum += dt * (3 + closeness * 20);
      while (this.particleAccum >= 1 && this.particles.length < this.maxParticles) {
        this.spawnParticle();
        this.particleAccum -= 1;
      }
    } else {
      this.particleAccum = 0;
    }

    this.particles = this.particles.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      return p.life > 0;
    });

    this.ripples = this.ripples.filter(r => {
      r.radius += dt * 140;
      r.alpha -= dt * 0.9;
      return r.alpha > 0 && r.radius < r.maxRadius;
    });

    this.updateThemeColors();
  }

  updateThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    this.colors.bg = cs.getPropertyValue('--bg-main').trim() || '#081226';
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h * 0.55;

    ctx.clearRect(0, 0, w, h);

    // Fondo
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Decoración vertical sutil
    for (let i = 1; i < 10; i++) {
      const x = (w / 10) * i;
      ctx.strokeStyle = this.colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.28);
      ctx.lineTo(x, h * 0.82);
      ctx.stroke();
    }

    // Líneas decorativas laterales
    ctx.strokeStyle = this.colors.decoBlue;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, h * 0.28);
    ctx.lineTo(cx - w * 0.22, h * 0.82);
    ctx.stroke();

    ctx.strokeStyle = this.colors.decoOrange;
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.22, h * 0.28);
    ctx.lineTo(cx + w * 0.22, h * 0.82);
    ctx.stroke();

    // Línea central fija
    ctx.strokeStyle = this.colors.axisGlow;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.18);
    ctx.lineTo(cx, h * 0.82);
    ctx.stroke();

    ctx.strokeStyle = this.colors.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.18);
    ctx.lineTo(cx, h * 0.82);
    ctx.stroke();

    // Marca objetivo central
    ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.fillRect(cx - 38, cy - 10, 76, 20);

    // Ripples al afinar
    this.ripples.forEach(r => {
      ctx.strokeStyle = `rgba(34, 197, 94, ${r.alpha})`;
      ctx.lineWidth = r.lineWidth;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Partículas
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
      const rgb = this.hexToRgb(p.color);
      g.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.9)`);
      g.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Punto móvil
    const markerY = cy + this.markerOffset;
    const tuned = this.currentFreq > 0 && Math.abs(this.cents) <= this.maxCents * 0.25;

    const markerColor = tuned
      ? this.colors.marker
      : (this.cents < 0 ? this.colors.flat : this.cents > 0 ? this.colors.sharp : this.colors.marker);

    const pulse = 1 + Math.sin(this.glowPulse * 3) * 0.08;

    ctx.save();
    ctx.shadowColor = tuned ? this.colors.markerGlow : markerColor;
    ctx.shadowBlur = tuned ? 28 : 18;

    ctx.fillStyle = markerColor;
    ctx.beginPath();
    ctx.arc(cx, markerY, 7 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Puntitos decorativos
    if (this.currentFreq <= 0) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.5)';
      ctx.beginPath();
      ctx.arc(cx - 18, cy + 70, 2, 0, Math.PI * 2);
      ctx.arc(cx + 12, cy + 80, 2, 0, Math.PI * 2);
      ctx.arc(cx + 34, cy + 68, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barra decorativa inferior
    this.renderDecorativeBar(ctx, w, h);
  }

  renderDecorativeBar(ctx, w, h) {
    const barY = h * 0.9;
    const barW = w * 0.6;
    const barX = (w - barW) / 2;
    const segments = 21;
    const segW = barW / segments;
    const center = Math.floor(segments / 2);

    for (let i = 0; i < segments; i++) {
      const x = barX + i * segW + 2;
      const y = barY;
      const width = segW - 4;
      const height = 10;

      let color = 'rgba(148,163,184,0.16)';
      if (i < center) color = this.colors.decoBlue;
      if (i > center) color = this.colors.decoOrange;
      if (i === center) color = 'rgba(96, 165, 250, 0.45)';

      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    }

    ctx.fillStyle = this.colors.textMuted;
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GRAVE', barX - 20, barY + 8);
    ctx.fillText('AGUDO', barX + barW + 24, barY + 8);
  }

  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  tick(timestamp) {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}

// ==========================================================
// CONTROL DE GRABACIÓN
// ==========================================================

export async function toggleRecording() {
  const btn = $('recordBtn');
  if (!btn) return;

  if (!state.isRecording) {
    try {
      state.isRecording = true;
      btn.innerHTML = '🎤 Detener';
      btn.classList.add('recording');
      btn.setAttribute('aria-pressed', 'true');

      await startAfinador();
    } catch (error) {
      console.error('No se pudo iniciar el afinador:', error);

      state.isRecording = false;
      btn.innerHTML = '🎤 Iniciar';
      btn.classList.remove('recording');
      btn.setAttribute('aria-pressed', 'false');

      alert('❌ No se pudo iniciar el micrófono del afinador: ' + error.message);
      stopAfinador();
    }
  } else {
    state.isRecording = false;
    btn.innerHTML = '🎤 Iniciar';
    btn.classList.remove('recording');
    btn.setAttribute('aria-pressed', 'false');

    stopAfinador();
    resetAfinadorUI();
  }
}

function resetAfinadorUI() {
  const noteDisplay = $('currentNoteDisplay');
  const centsDisplay = $('centsDisplay');
  const guideText = $('guideText');

  if (noteDisplay) {
    noteDisplay.textContent = '--';
    noteDisplay.className = 'current-note state-idle';
  }

  if (centsDisplay) {
    centsDisplay.textContent = '';
    centsDisplay.className = 'cents-display';
  }

  if (guideText) {
    guideText.textContent = '🎤 Esperando voz...';
    guideText.className = 'guide-text';
  }
}

async function startAfinador() {
  if (afinadorVisual) {
    afinadorVisual.destroy();
    afinadorVisual = null;
  }

  const canvas = $('agujaCanvas');
  if (canvas) {
    afinadorVisual = new AfinadorVisual(canvas);

    const targetNoteEl = $('targetNote');
    const difficultyEl = $('afinadorDifficulty');

    if (targetNoteEl) afinadorVisual.setTargetNote(targetNoteEl.value);
    if (difficultyEl) afinadorVisual.setDifficulty(difficultyEl.value);

    if (targetNoteEl) {
      targetNoteEl.onchange = () => afinadorVisual?.setTargetNote(targetNoteEl.value);
    }
    if (difficultyEl) {
      difficultyEl.onchange = () => afinadorVisual?.setDifficulty(difficultyEl.value);
    }

    afinadorVisual.start();
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

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

  setTimeout(() => {
    if (state.isRecording) {
      runPitchDetectionLoop();
    }
  }, 200);
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
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  analyser = null;

  if (afinadorVisual) {
    afinadorVisual.destroy();
    afinadorVisual = null;
  }
}

// ==========================================================
// LOOP DE DETECCIÓN
// ==========================================================

async function runPitchDetectionLoop() {
  if (!state.isRecording || !analyser || !audioContext) return;

  analyser.getFloatTimeDomainData(pitchBuffer);

  try {
    const audioController = getAudioController();
    const result = await audioController.detectPitch(pitchBuffer, audioContext.sampleRate);

    const noteDisplay = $('currentNoteDisplay');
    const centsDisplay = $('centsDisplay');
    const guideText = $('guideText');

    if (typeof result === 'number' && result > 0) {
      if (afinadorVisual) {
        afinadorVisual.setPitch(result);
      }

      const detectedNote = frequencyToNoteName(result);
      const targetNoteName = $('targetNote')?.value || 'E2';
      const targetFreq = noteToFrequency(targetNoteName);
      const cents = frequencyToCentsOff(result, targetFreq);

      if (noteDisplay) {
        noteDisplay.textContent = detectedNote;
        noteDisplay.className = 'current-note state-active';
      }

      if (centsDisplay) {
        const rounded = Math.round(cents);
        const sign = rounded > 0 ? '+' : '';
        centsDisplay.textContent = `${sign}${rounded}¢`;
        centsDisplay.className = 'cents-display';
      }

      if (guideText) {
        const difficultyEl = $('afinadorDifficulty');
        const level = difficultyEl?.value || 'medio';
        const tolerances = { facil: 50, medio: 30, dificil: 15, experto: 5 };
        const tolerance = tolerances[level] || 30;

        if (Math.abs(cents) <= tolerance * 0.25) {
          guideText.textContent = '✅ Afinado';
          guideText.className = 'guide-text state-good';
        } else if (cents < 0) {
          guideText.textContent = '⬆️ Sube la voz';
          guideText.className = 'guide-text state-low';
        } else {
          guideText.textContent = '⬇️ Baja la voz';
          guideText.className = 'guide-text state-high';
        }
      }
    } else {
      if (afinadorVisual) {
        afinadorVisual.setPitch(-1);
      }

      if (noteDisplay) {
        noteDisplay.textContent = '--';
        noteDisplay.className = 'current-note state-idle';
      }

      if (centsDisplay) {
        centsDisplay.textContent = '';
        centsDisplay.className = 'cents-display';
      }

      if (guideText) {
        guideText.textContent = '🎤 Esperando voz...';
        guideText.className = 'guide-text';
      }
    }
  } catch (error) {
    console.error('Fallo en bucle de detección:', error);
  }

  if (state.isRecording) {
    pitchLoopTimeout = setTimeout(runPitchDetectionLoop, 16);
  }
}
