/** 
 * AgujaViva — Hero-mode tuner needle with particle trail
 * Canvas 2D renderer, 60fps, theme-aware, no dependencies
 */

// Utilidad abreviada para buscar elementos del DOM
const $ = (id) => document.getElementById(id); 

// Estado de grabación global de la pestaña Afinador
const state = {
  isRecording: false
}; 

// Instancias y buffers globales internos
let agujaVivaInstance = null;
let pitchLoopTimeout = null;
const pitchBuffer = new Float32Array(2048);
let audioContext = null;
let analyser = null;
let stream = null; 

// Auxiliares matemáticos
function frequencyToCentsOff(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
} 

function noteToFrequency(noteName) {
  const notes = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
  const match = noteName.match(/^([A-G]#?)(\d)$/);
  if (!match) return 164.81; // E3 por defecto
  const key = match[1];
  const octave = parseInt(match[2], 10);
  const semitones = notes[key] + (octave - 4) * 12;
  return 440 * Math.pow(2, semitones / 12);
} 

// Algoritmo de autocorrelación para la detección de frecuencia fundamental (Pitch)
function autoCorrelate(buf, sampleRate) {
  let SIZE = buf.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // Señal insuficiente

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }

  const slicedBuf = buf.slice(r1, r2);
  SIZE = slicedBuf.length;

  const c = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - i; j++) {
      c[i] = c[i] + slicedBuf[j] * slicedBuf[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  let T0 = maxpos;

  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
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
    this.lastParticleTime = 0;
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
      flatGlow: 'rgba(59, 130, 246, 0.5)',
      sharp: '#f97316',
      sharpGlow: 'rgba(249, 115, 22, 0.5)',
      ledOn: '#22c55e',
      ledOff: 'rgba(148, 163, 184, 0.15)',
      ledFlat: '#3b82f6',
      ledSharp: '#f97316',
      text: '#f8fafc',
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
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 300;
    this.height = rect.height || 150;
    this.dpr = window.devicePixelRatio || 1; 

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  } 

  setPitch(freq) {
    this.currentFreq = freq; 

    if (freq > 0 && this.targetFreq > 0) {
      this.cents = frequencyToCentsOff(freq, this.targetFreq);
      const targetAngle = Math.max(-1, Math.min(1, this.cents / this.maxCents));

      const toleranceThreshold = 0.15;
      const wasInTolerance = Math.abs(this.needleAngle) <= toleranceThreshold;
      const nowInTolerance = Math.abs(targetAngle) <= toleranceThreshold;
      if (wasInTolerance !== nowInTolerance) {
        this.triggerBurst();
      }

      const isNowInTolerance = Math.abs(this.cents) <= (this.maxCents * 0.15);
      if (isNowInTolerance && !this.wasInTolerance && this.rippleCooldown <= 0) {
        this.triggerRipple();
        this.rippleCooldown = 1.5;
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
  } 

  triggerRipple() {
    const cx = this.width / 2;
    const cy = this.height * 0.55;
    const color = this.colors.center;
    const maxR = Math.max(this.width, this.height) * 0.8; 

    const crestCount = 4;
    for (let i = 0; i < crestCount; i++) {
      const delay = i * 0.06;
      const initialRadius = i * 12;

      this.ripples.push({
        x: cx,
        y: cy,
        radius: initialRadius,
        maxRadius: maxR,
        alpha: 0.9 - i * 0.15,
        color,
        lineWidth: Math.max(1, 3 - i * 0.5),
        delay,
        age: -delay,
      });
    }
  } 

  triggerPop() {
    this.popScale = 1.4;
  } 

  triggerShake(intensity = 0.3) {
    this.shakeIntensity = intensity;
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

  update(dt) {
    const diff = this.targetAngle - this.needleAngle;
    this.needleAngle += diff * Math.min(1, dt * 8); 

    if (this.shakeIntensity > 0.01) {
      this.shakeIntensity *= this.shakeDecay;
    } else {
      this.shakeIntensity = 0;
    }

    if (this.burstAlpha > 0) {
      this.burstRadius += dt * 300;
      this.burstAlpha -= dt * 2.5;
    }

    if (this.popScale > 1) {
      this.popScale = 1 + (this.popScale - 1) * this.popDecay;
      if (this.popScale < 1.01) this.popScale = 1;
    }

    if (this.rippleCooldown > 0) {
      this.rippleCooldown -= dt;
    }

    this.ripples = this.ripples.filter(r => {
      r.age += dt;
      if (r.age < 0) return true;

      r.radius += dt * 180;
      r.alpha = Math.max(0, 1 - r.radius / r.maxRadius);
      r.lineWidth = Math.max(0.5, 3 * (1 - r.radius / r.maxRadius));
      return r.alpha > 0;
    });

    this.spawnParticles(dt);

    this.particles = this.particles.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      p.rotation += p.rotSpeed * dt;
      return p.life > 0;
    });

    this.updateThemeColors();
  } 

  spawnParticles(dt) {
    if (this.currentFreq <= 0) {
      this.particleSpawnAccum += dt;
      if (this.particleSpawnAccum > 0.5 && this.particles.length < 30) {
        this.spawnSleepParticle();
        this.particleSpawnAccum = 0;
      }
      return;
    } 

    const stability = 1 - Math.min(1, Math.abs(this.needleAngle));
    const spawnRate = this.trailFreq * (0.5 + stability * 2);

    this.particleSpawnAccum += dt;
    while (this.particleSpawnAccum > spawnRate && this.particles.length < this.maxParticles) {
      this.spawnActiveParticle();
      this.particleSpawnAccum -= spawnRate;
    }
  } 

  spawnActiveParticle() {
    const cx = this.width / 2;
    const cy = this.height * 0.55; 

    const angle = this.needleAngle * Math.PI / 6 + (Math.random() - 0.5) * 0.3;
    const speed = 80 + Math.random() * 120;

    let color;
    if (Math.abs(this.cents) <= (this.maxCents * 0.15)) {
      color = this.colors.center;
    } else if (this.cents < 0) {
      color = this.colors.flat;
    } else {
      color = this.colors.sharp;
    }

    this.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 30,
      vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 30,
      gravity: 20,
      life: this.particleLife * (0.6 + Math.random() * 0.4),
      maxLife: this.particleLife,
      size: 3 + Math.random() * 4,
      color,
      alpha: 1,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 4,
    });
  } 

  spawnSleepParticle() {
    const cx = this.width / 2;
    const cy = this.height * 0.55;
    const angle = Math.random() * Math.PI * 2;
    const radius = 40 + Math.random() * 80; 

    this.particles.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: Math.cos(angle) * 10,
      vy: Math.sin(angle) * 10,
      gravity: 0,
      life: 4 + Math.random() * 3,
      maxLife: 7,
      size: 2 + Math.random() * 3,
      color: this.colors.needle,
      alpha: 0.3,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 1,
    });
  } 

  updateThemeColors() {
    if (typeof document === 'undefined') return;
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg-main').trim() || '#0f172a';
    this.colors.bg = bg;
  } 

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h * 0.55; 

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const x = (w / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.3);
      ctx.lineTo(x, h * 0.8);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.3);
    ctx.lineTo(cx, h * 0.8);
    ctx.stroke();
    ctx.setLineDash([]);

    const tolerancePx = (this.maxCents > 0) ? (w * 0.4) * (this.maxCents / 50) : w * 0.4;
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.lineWidth = 1;
    [-1, 1].forEach(side => {
      const x = cx + side * tolerancePx;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.3);
      ctx.lineTo(x, h * 0.8);
      ctx.stroke();
    });

    if (this.burstAlpha > 0) {
      const burstColor = Math.abs(this.cents) <= (this.maxCents * 0.15) ? this.colors.center : 
        (this.cents < 0 ? this.colors.flat : this.colors.sharp);
      ctx.strokeStyle = `rgba(${this.hexToRgb(burstColor).join(',')}, ${this.burstAlpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, this.burstRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.ripples.forEach(r => {
      ctx.strokeStyle = this.hexToRgba(r.color, r.alpha);
      ctx.lineWidth = r.lineWidth;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    });

    this.renderLedBar(ctx, w, h);
    this.renderParticles(ctx);
    this.renderNeedle(ctx, cx, cy, w, h);

    ctx.fillStyle = this.colors.center;
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * this.popScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = this.colors.centerGlow;
    ctx.shadowBlur = 20 * this.popScale;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  renderNeedle(ctx, cx, cy, w, h) {
    const angle = this.needleAngle * Math.PI / 6;
    const shake = this.shakeIntensity * (Math.random() - 0.5) * 0.2;
    const length = Math.min(w, h) * 0.38;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle + shake);

    const grad = ctx.createLinearGradient(0, 0, 0, -length);
    grad.addColorStop(0, this.colors.needleGlow);
    grad.addColorStop(1, 'rgba(250,204,21,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();

    ctx.strokeStyle = this.colors.needle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();

    ctx.fillStyle = this.colors.needle;
    ctx.beginPath();
    ctx.moveTo(-6, -length);
    ctx.lineTo(6, -length);
    ctx.lineTo(0, -length - 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderLedBar(ctx, w, h) {
    const barY = h * 0.88;
    const barW = w * 0.6;
    const barX = (w - barW) / 2;
    const segmentCount = 21;
    const segmentW = barW / segmentCount;
    const centerIdx = Math.floor(segmentCount / 2);
    const currentIdx = Math.max(0, Math.min(segmentCount - 1, Math.round((this.needleAngle + 1) / 2 * (segmentCount - 1))));

    for (let i = 0; i < segmentCount; i++) {
      const x = barX + i * segmentW + 2;
      const y = barY;
      const wSeg = segmentW - 4;
      const hSeg = 14;
      let color = this.colors.ledOff;
      let alpha = 0.3;

      if (i === centerIdx) {
        if (Math.abs(this.cents) <= (this.maxCents * 0.15) && this.currentFreq > 0) {
          color = this.colors.ledOn;
          alpha = 1;
        } else if (this.currentFreq > 0) {
          color = this.cents < 0 ? this.colors.ledFlat : this.colors.ledSharp;
          alpha = 0.5;
        }
      } else if (this.currentFreq > 0) {
        if (currentIdx < centerIdx && i >= currentIdx && i < centerIdx) {
          color = this.colors.ledFlat;
          alpha = 0.6 + (i / centerIdx) * 0.4;
        } else if (currentIdx > centerIdx && i > centerIdx && i <= currentIdx) {
          color = this.colors.ledSharp;
          alpha = 0.6 + ((segmentCount - 1 - i) / (segmentCount - 1 - centerIdx)) * 0.4;
        }
      }

      ctx.fillStyle = this.hexToRgba(color, alpha);
      ctx.fillRect(x, y, wSeg, hSeg);

      if (this.currentFreq > 0 && (i === currentIdx || (i === centerIdx && Math.abs(this.cents) <= (this.maxCents * 0.15)))) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillRect(x, y, wSeg, hSeg);
        ctx.shadowBlur = 0;
      }
    }

    ctx.fillStyle = this.colors.textMuted;
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GRAVE', barX - 30, barY + 10);
    ctx.fillText('AGUDO', barX + barW + 30, barY + 10);
  }

  renderParticles(ctx) {
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      grad.addColorStop(0, this.hexToRgba(p.color, p.alpha));
      grad.addColorStop(1, this.hexToRgba(p.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return [250, 204, 21];
    let h = hex.replace('#', '').trim();
    if (h.length === 3) {
      h = h.split('').map(c => c + c).join('');
    }
    const bigint = parseInt(h, 16);
    if (isNaN(bigint)) return [250, 204, 21];
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  hexToRgba(hex, alpha) {
    const rgb = this.hexToRgb(hex);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.resize);
    if (this.ctx && this.width && this.height) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }
}

function updateUI(freq) {
  const noteDisplay = $("currentNoteDisplay") || $("noteDisplay");
  const centsDisplay = $("centsDisplay");
  const guideText = $("guideText");

  if (!state.isRecording || freq <= 0) {
    if (noteDisplay) {
      noteDisplay.textContent = "--";
      noteDisplay.className = "current-note state-idle";
    }
    if (centsDisplay) {
      centsDisplay.textContent = "";
      centsDisplay.className = "cents-display";
    }
    if (guideText) {
      guideText.textContent = "🎤 Escuchando...";
      guideText.className = "guide-text";
    }
    return;
  }

  if (agujaVivaInstance) {
    const cents = agujaVivaInstance.cents;
    const absCents = Math.abs(cents);
    const targetNoteEl = $("targetNote");
    const targetNoteName = targetNoteEl ? targetNoteEl.value : "E3";

    if (noteDisplay) {
      noteDisplay.textContent = targetNoteName;
    }

    if (absCents <= agujaVivaInstance.maxCents * 0.15) {
      if (noteDisplay) noteDisplay.className = "current-note state-on";
      if (centsDisplay) {
        centsDisplay.textContent = "Afinado (0 cents)";
        centsDisplay.className = "cents-display visible cents-on";
      }
      if (guideText) {
        guideText.textContent = "¡Nota Perfecta!";
        guideText.className = "guide-text state-on";
      }
    } else if (cents < 0) {
      if (noteDisplay) noteDisplay.className = "current-note state-flat";
      if (centsDisplay) {
        centsDisplay.textContent = `${Math.round(cents)} cents`;
        centsDisplay.className = "cents-display visible cents-flat";
      }
      if (guideText) {
        guideText.textContent = "▲ Sube la voz (Grave)";
        guideText.className = "guide-text state-flat";
      }
    } else {
      if (noteDisplay) noteDisplay.className = "current-note state-sharp";
      if (centsDisplay) {
        centsDisplay.textContent = `+${Math.round(cents)} cents`;
        centsDisplay.className = "cents-display visible cents-sharp";
      }
      if (guideText) {
        guideText.textContent = "▼ Baja la voz (Agudo)";
        guideText.className = "guide-text state-sharp";
      }
    }
  }
}

function runPitchDetectionLoop() {
  if (!state.isRecording || !analyser || !audioContext) return;

  analyser.getFloatTimeDomainData(pitchBuffer);
  const freq = autoCorrelate(pitchBuffer, audioContext.sampleRate);

  if (agujaVivaInstance) {
    agujaVivaInstance.setPitch(freq);
  }

  updateUI(freq);

  pitchLoopTimeout = setTimeout(runPitchDetectionLoop, 50);
}

export async function toggleRecording() {
  const btn = $("recordBtn");
  if (!btn) return;

  if (!state.isRecording) {
    state.isRecording = true;
    btn.innerHTML = '🎤 Detener';
    btn.classList.add("recording");
    btn.setAttribute("aria-pressed", "true");
    try {
      await startAfinador();
    } catch (err) {
      console.error("Error al iniciar el afinador:", err);
      state.isRecording = false;
      btn.innerHTML = '🎤 Iniciar';
      btn.classList.remove("recording");
      btn.setAttribute("aria-pressed", "false");
      stopAfinador();
    }
  } else {
    state.isRecording = false;
    btn.innerHTML = '🎤 Iniciar';
    btn.classList.remove("recording");
    btn.setAttribute("aria-pressed", "false");
    stopAfinador();

    const noteDisplay = $("currentNoteDisplay") || $("noteDisplay");
    const centsDisplay = $("centsDisplay");
    const guideText = $("guideText");

    if (noteDisplay) {
      noteDisplay.textContent = "--";
      noteDisplay.className = "current-note state-idle";
    }
    if (centsDisplay) {
      centsDisplay.textContent = "";
      centsDisplay.className = "cents-display";
    }
    if (guideText) {
      guideText.textContent = "🎤 Esperando voz...";
      guideText.className = "guide-text";
    }
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

    if (targetNoteEl) {
      targetNoteEl.onchange = () => agujaVivaInstance && agujaVivaInstance.setTargetNote(targetNoteEl.value);
    }
    if (difficultyEl) {
      difficultyEl.onchange = () => agujaVivaInstance && agujaVivaInstance.setDifficulty(difficultyEl.value);
    }
    agujaVivaInstance.start();
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtx();
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
    runPitchDetectionLoop();
  }, 300);
}

function stopAfinador() {
  if (pitchLoopTimeout) {
    clearTimeout(pitchLoopTimeout);
    pitchLoopTimeout = null;
  }
  if (agujaVivaInstance) {
    agujaVivaInstance.destroy();
    agujaVivaInstance = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}
