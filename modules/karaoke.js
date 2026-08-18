/**
 * MÓDULO INTEGRADO DE MONITOR DE KARAOKE (MODO SOLO & DÚO SPLIT)
 * Soporta Canvas de 1800x600px, escala de 10 notas, avatares/íconos dinámicos,
 * rastro de pitch suave, detección dual y teleprompter compartido.
 */
import { $, safeAdd } from "../script.js";

let pitchHistory = [];
let karaokePitchDetectionAudioCtx = null;
let karaokePitchDetectionAnalyser = null;
let karaokePitchLoopRafId = null;
let karaokePitchSourceNode = null;
let karaokePitchWorkletNode = null;

/**
 * Conmuta el modo Dúo Split ON/OFF
 */
function toggleKaraokeDuoSplitMode() {
  window.karaokeDuoSplitMode = !window.karaokeDuoSplitMode;
  const btn = $("karaokeDuoSplitToggleBtn");
  if (btn) {
    btn.textContent = window.karaokeDuoSplitMode ? "🎤🎤 Modo Dúo Split: ON" : "🎤🎤 Modo Dúo Split: OFF";
    btn.style.background = window.karaokeDuoSplitMode ? "#22c55e" : "#3b82f6";
  }

  if (window.karaokeDuoSplitMode) {
    ensureP2PitchTracking();
  } else {
    stopP2PitchTracking();
  }

  if (window.karaokeRendererInstance) {
    const track = $("karaokeTrack");
    const t = track ? track.currentTime : 0;
    window.karaokeRendererInstance.render(t, window.karaokePitchP1, window.karaokePitchP2);
  }
}

/**
 * Inicia el seguimiento de pitch para el Micrófono 2 (Cantante 2)
 */
async function ensureP2PitchTracking() {
  if (window.karaokeDuoAnalyser2 && window.karaokeDuoAudioContext) {
    karaokeSplitAnalyser2 = window.karaokeDuoAnalyser2;
    karaokeSplitAudioCtx = window.karaokeDuoAudioContext;
    return;
  }
  if (karaokeSplitAnalyser2) return;

  try {
    const mic2Id = (typeof window.getSelectedMicId === "function") ? window.getSelectedMicId(2) : null;
    if (!mic2Id) {
      console.warn("[DuoSplit] No hay Mic 2 seleccionado en la configuración.");
      return;
    }
    if (!karaokeSplitAudioCtx) {
      karaokeSplitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    karaokeSplitStream2 = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: mic2Id },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const src2 = karaokeSplitAudioCtx.createMediaStreamSource(karaokeSplitStream2);
    karaokeSplitAnalyser2 = karaokeSplitAudioCtx.createAnalyser();
    karaokeSplitAnalyser2.fftSize = 2048;
    src2.connect(karaokeSplitAnalyser2);
    console.log("[DuoSplit] Pitch tracking del Mic 2 iniciado correctamente.");
  } catch (e) {
    console.warn("No se pudo iniciar pitch tracking en Mic 2 (P2):", e);
  }
}

/**
 * Detiene el rastreo de audio del Micrófono 2
 */
function stopP2PitchTracking() {
  try {
    if (karaokeSplitStream2) {
      karaokeSplitStream2.getTracks().forEach(t => t.stop());
    }
  } catch (e) {}
  karaokeSplitStream2 = null;
  karaokeSplitAnalyser2 = null;
  window.karaokePitchP2 = -1;
  window.pitchHistoryMic2 = [];
}


// --- CLASE PRINCIPAL DEL RENDERIZADOR ---

export class KaraokeCanvasRenderer {
  constructor(canvasId, options = {}) {
    this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!this.canvas) throw new Error(`Canvas no encontrado`);
    this.ctx = this.canvas.getContext('2d');

    // Configuración por defecto y calibración para monitor 1800x600px
    this.options = { maxFrameRate: options.maxFrameRate || 30, ...options };
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / this.options.maxFrameRate;

    // Escala fija de 10 notas requerida: A4 (69) a F3 (53)
    this.noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
    this.midiMax = 69; // A4
    this.midiMin = 53; // F3
    this.midiRange = this.midiMax - this.midiMin;

    window.karaokeRendererInstance = this;
  }

  shouldRender() {
    const now = performance.now();
    if (now - this.lastFrameTime < this.frameInterval) return false;
    this.lastFrameTime = now;
    return true;
  }

  frequencyToMidi(freq) {
    if (!freq || freq <= 0) return 0;
    return Math.round(12 * Math.log2(freq / 440) + 69);
  }

  midiToY(midi, pTop, pBottom) {
    let m = midi || 60;
    if (m < this.midiMin) m = this.midiMin;
    if (m > this.midiMax) m = this.midiMax;

    const pHeight = pBottom - pTop;
    const normalized = (this.midiMax - m) / this.midiRange;
    return pTop + normalized * pHeight;
  }

  obtenerPaletaTema(hue = 0) {
    const temaActual = localStorage.getItem("singIt_stage") || localStorage.getItem("vocalApp_stage") || "theme-clasico";
    const fuenteBase = localStorage.getItem("singIt_font") || "Arial";

    let config = {
      fondo: "#111827",
      lineas: "#333333",
      etiquetas: "#9ca3af",
      barraFutura: "#1e40af",
      bordeFuturo: "#3b82f6",
      fuente: fuenteBase,
      tamanoTexto: "16px"
    };

    if (temaActual === "theme-moderno") {
      config = { fondo: "#082f49", lineas: "rgba(6, 182, 212, 0.2)", etiquetas: "#06b6d4", barraFutura: "#1e3a8a", bordeFuturo: "#06b6d4", fuente: fuenteBase, tamanoTexto: "16px" };
    } else if (temaActual === "theme-disco") {
      config = { fondo: "#2e1065", lineas: "rgba(219, 39, 119, 0.25)", etiquetas: "#facc15", barraFutura: "#701a75", bordeFuturo: "#db2777", fuente: fuenteBase, tamanoTexto: "18px" };
    } else if (temaActual === "theme-acustico") {
      config = { fondo: "#451a03", lineas: "rgba(120, 53, 15, 0.4)", etiquetas: "#fcd34d", barraFutura: "#78350f", bordeFuturo: "#b45309", fuente: fuenteBase, tamanoTexto: "15px" };
    } else if (temaActual === "theme-fiesta") {
      config = {
        fondo: `hsl(${hue}, 40%, 12%)`,
        lineas: "rgba(255, 255, 255, 0.15)",
        etiquetas: "#ff007f",
        barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`,
        bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)`,
        fuente: fuenteBase,
        tamanoTexto: "18px"
      };
    } else if (temaActual === "theme-retrowave") {
      config = { fondo: "#1e0b36", lineas: "rgba(255, 0, 127, 0.25)", etiquetas: "#38bdf8", barraFutura: "#4c1d95", bordeFuturo: "#ff007f", fuente: fuenteBase, tamanoTexto: "16px" };
    }
    return config;
  }

  /**
   * Dibuja el bloque lateral de Avatar e Íconos configurables
   */
  drawAvatarBlock(pTop, pBottom, parte) {
    if (!parte) return;
    const isP1 = (parte === "C1" || parte === "P1");

    // Datos configurables desde la pestaña de configuración (localStorage)
    const nombre = isP1 
      ? (localStorage.getItem("singIt_c1_name") || "Wen-dolyne")
      : (localStorage.getItem("singIt_c2_name") || "To-bonito");
    
    const avatarEmoji = isP1 
      ? (localStorage.getItem("singIt_c1_avatar") || "👩")
      : (localStorage.getItem("singIt_c2_avatar") || "🧔🏾");

    const icon1 = isP1 
      ? (localStorage.getItem("singIt_c1_icon1") || "SQUARE_PURPLE")
      : (localStorage.getItem("singIt_c2_icon1") || "🐱");

    const icon2 = isP1 
      ? (localStorage.getItem("singIt_c1_icon2") || "⚛️")
      : (localStorage.getItem("singIt_c2_icon2") || "🤔");

    const cx = 60;
    const blockTop = pTop + 8;
    const avatarSize = 48;
    const halfSize = 24;
    const nameH = 20;
    const gap = 4;

    // 1) Nombre arriba
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = `bold 15px ${localStorage.getItem("singIt_font") || "Arial"}`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.fillText(nombre, cx, blockTop + nameH);

    // 2) Avatar Emoji al centro (sin círculo)
    const avTop = blockTop + nameH + gap;
    this.ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);

    // 3) Fila inferior con 2 íconos seleccionables
    const rowTop = avTop + avatarSize + gap;
    const iconFont = `${halfSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;

    // Ícono 1
    if (icon1 === "SQUARE_PURPLE") {
      const sqX = cx - halfSize - 4;
      this.ctx.fillStyle = "#7c3aed";
      this.ctx.fillRect(sqX, rowTop, halfSize, halfSize);
      this.ctx.strokeStyle = "#a855f7";
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(sqX, rowTop, halfSize, halfSize);
    } else {
      this.ctx.font = iconFont;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(icon1, cx - halfSize / 2 - 2, rowTop + halfSize / 2);
    }

    // Ícono 2
    this.ctx.font = iconFont;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(icon2, cx + halfSize / 2 + 2, rowTop + halfSize / 2);

    this.ctx.textBaseline = "alphabetic";
  }

  /**
   * Dibuja el rastro continuo del pitch del usuario (Fading Trail)
   */
  _drawPitchTrace(history, rgbStr, lineWidth, pTop, pBottom, startX) {
    if (!history || history.length === 0) return;

    const VISIBLE_SAMPLES = 75;
    const start = Math.max(0, history.length - VISIBLE_SAMPLES);
    const visible = history.slice(start);
    const totalSlots = visible.length;
    if (totalSlots < 2) return;

    const lineX = Math.max(80, Math.floor(this.canvas.width * 0.22));
    const traceWidth = lineX - startX;
    const slotWidth = traceWidth / VISIBLE_SAMPLES;

    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    let prevX = null, prevY = null;
    for (let i = 0; i < totalSlots; i++) {
      const freq = visible[i];
      if (!freq || freq <= 0) { prevX = null; prevY = null; continue; }

      const midi = this.frequencyToMidi(freq);
      const y = this.midiToY(midi, pTop, pBottom);
      const x = startX + (i + (VISIBLE_SAMPLES - totalSlots)) * slotWidth;

      if (prevX !== null) {
        const alpha = Math.pow(i / (totalSlots - 1), 1.6);
        this.ctx.beginPath();
        this.ctx.strokeStyle = `rgba(${rgbStr}, ${alpha.toFixed(3)})`;
        this.ctx.lineWidth = lineWidth;
        this.ctx.moveTo(prevX, prevY);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
      }
      prevX = x; prevY = y;
    }
  }

  /**
   * Renderiza una región del pentagrama (Modo Solo o Split)
   */
  drawRegion(pTop, pBottom, pitchVal, pitchHist, parteFiltro, etiquetaParte, paleta, segmentosLetras, currentTime) {
    const isSplit = window.karaokeDuoSplitMode;
    const avatarBlockW = isSplit ? 120 : 0;
    const noteLabelsX = 28 + avatarBlockW;
    const pentagramStartX = 35 + avatarBlockW;
    const lineX = Math.max(80 + avatarBlockW, Math.floor(this.canvas.width * 0.22));
    const pixelsPerSecond = (this.canvas.width - 50 - avatarBlockW) / 6;

    // 1. Dibujar Avatares e Íconos
    if (isSplit) {
      this.drawAvatarBlock(pTop, pBottom, etiquetaParte);
    }

    // 2. Pentagrama de 5 líneas estructuradas con espacio proporcional para 10 notas
    const pHeight = pBottom - pTop;
    this.ctx.strokeStyle = paleta.lineas;
    this.ctx.lineWidth = 1;
    const numLines = 5;
    for (let i = 0; i < numLines; i++) {
      const y = pTop + (pHeight / (numLines - 1)) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(pentagramStartX, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    // 3. Escala de 10 Notas requeridas: ["A4","G4","F4","E4","D4","C4","B3","A3","G3","F3"]
    this.ctx.fillStyle = paleta.etiquetas;
    this.ctx.font = `bold 18px ${paleta.fuente}`;
    this.ctx.textAlign = "right";
    this.ctx.textBaseline = "middle";

    const totalNotes = this.noteLabels.length;
    this.noteLabels.forEach((label, i) => {
      const y = pTop + (pHeight / (totalNotes - 1)) * i;
      this.ctx.fillText(label, noteLabelsX, y);
    });

    // 4. Barras de Notas y Letras
    if (Array.isArray(segmentosLetras) && segmentosLetras.length > 0) {
      const timeWindowStart = currentTime - 1;
      const timeWindowEnd = currentTime + 6;

      segmentosLetras.forEach((segment) => {
        const parteSeg = segment.parte || "C1";
        if (parteFiltro && parteSeg !== parteFiltro && parteSeg !== "DUO" && parteSeg !== "DÚO") return;

        const words = Array.isArray(segment.words) ? segment.words : [];
        words.forEach((word) => {
          const wStart = word.start || word.startTime || segment.start || 0;
          const wEnd = word.end || (wStart + (word.duration || 0.5));

          if (wEnd < timeWindowStart || wStart > timeWindowEnd) return;

          const wordStartX = lineX + (wStart - currentTime) * pixelsPerSecond;
          const wordEndX = lineX + (wEnd - currentTime) * pixelsPerSecond;
          const barWidth = Math.max(wordEndX - wordStartX, 35);

          const midi = word.midi || segment.midi || 60;
          const barY = this.midiToY(midi, pTop, pBottom);
          const barHeight = 22;

          const isActive = currentTime >= wStart && currentTime <= wEnd;
          const isPast = currentTime > wEnd;

          let isCorrect = false;
          if (isActive && pitchVal > 0) {
            const userMidi = this.frequencyToMidi(pitchVal);
            if (Math.abs(userMidi - midi) <= 2) isCorrect = true;
          }

          let barColor, textColor, borderColor;
          if (isPast) {
            barColor = "#4b5563"; // Nota inactiva / ya cantada
            textColor = "#9ca3af";
            borderColor = "#6b7280";
          } else if (isActive) {
            barColor = isCorrect ? "#22c55e" : "#3b82f6";
            textColor = "#ffffff";
            borderColor = isCorrect ? "#4ade80" : "#60a5fa";
          } else {
            barColor = (parteSeg === "DUO" || parteSeg === "DÚO") ? "#7c3aed" : paleta.barraFutura;
            textColor = "rgba(255, 255, 255, 0.85)";
            borderColor = (parteSeg === "DUO" || parteSeg === "DÚO") ? "#a855f7" : paleta.bordeFuturo;
          }

          this.ctx.fillStyle = barColor;
          this.ctx.strokeStyle = borderColor;
          this.ctx.lineWidth = isActive ? 2 : 1;

          this.ctx.beginPath();
          if (this.ctx.roundRect) {
            this.ctx.roundRect(wordStartX, barY - barHeight / 2, barWidth, barHeight, 5);
          } else {
            this.ctx.fillRect(wordStartX, barY - barHeight / 2, barWidth, barHeight);
          }
          this.ctx.fill();
          this.ctx.stroke();

          // Texto de la sílaba/palabra sobre la barra
          this.ctx.fillStyle = textColor;
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          const displayWord = word.word || word.text || "";
          this.ctx.font = `${isActive ? "bold " : ""}${displayWord.length > 8 ? "18" : "22"}px ${paleta.fuente}`;
          this.ctx.fillText(displayWord, wordStartX + barWidth / 2, barY);
        });
      });
    }

    // 5. Rastro de Pitch (Fading Trail) por región
    const traceColor = (etiquetaParte === "C2" || etiquetaParte === "P2") ? "6, 182, 212" : "250, 204, 21";
    this._drawPitchTrace(pitchHist, traceColor, 5, pTop, pBottom, pentagramStartX);

    // 6. Punto Flotante del Usuario en la línea de tiempo
    if (typeof pitchVal === 'number' && isFinite(pitchVal) && pitchVal > 0) {
      const userY = this.midiToY(this.frequencyToMidi(pitchVal), pTop, pBottom);
      const dotColor = (etiquetaParte === "C2" || etiquetaParte === "P2") ? "#06b6d4" : "#facc15";

      this.ctx.beginPath();
      this.ctx.fillStyle = dotColor;
      this.ctx.shadowColor = dotColor;
      this.ctx.shadowBlur = 15;
      this.ctx.arc(lineX, userY, 12, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.lineWidth = 2.5;
      this.ctx.stroke();
    }

    // 7. Línea Roja de Separación (Playhead "Ahora")
    this.ctx.strokeStyle = "#ef4444";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(lineX, pTop);
    this.ctx.lineTo(lineX, pBottom);
    this.ctx.stroke();
  }

  /**
   * Método de renderizado principal
   */
  render(currentTime = 0, currentFreq = -1, currentFreq2 = -1, transcriptionSegments = null) {
    if (!this.shouldRender()) return;

    const hueFiesta = (currentTime * 40) % 360;
    const paleta = this.obtenerPaletaTema(hueFiesta);

    // Actualización de variables de tono e historial
    if (typeof currentFreq === "number") window.karaokePitchP1 = currentFreq;
    if (typeof currentFreq2 === "number") window.karaokePitchP2 = currentFreq2;

    const freq1 = window.karaokePitchP1;
    const freq2 = window.karaokePitchP2;

    window.pitchHistoryMic1.push(freq1 > 0 ? freq1 : null);
    window.pitchHistoryMic2.push(freq2 > 0 ? freq2 : null);

    const maxHistory = 80;
    if (window.pitchHistoryMic1.length > maxHistory) window.pitchHistoryMic1.shift();
    if (window.pitchHistoryMic2.length > maxHistory) window.pitchHistoryMic2.shift();

    const segmentosLetras = transcriptionSegments || window.transcriptionSegments || window.textSegments || [];

    // Limpieza general del fondo
    this.ctx.fillStyle = paleta.fondo;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // DIBUJO SEGÚN MODO (SOLO vs DÚO SPLIT)
    if (window.karaokeDuoSplitMode) {
      const TELE_H = 95;
      const GAP = 12;
      const totalUsable = this.canvas.height - TELE_H - 15;
      const regionH = (totalUsable - GAP) / 2;

      const topC1 = 15;
      const bottomC1 = topC1 + regionH;
      const topC2 = bottomC1 + GAP;
      const bottomC2 = topC2 + regionH;

      // Línea divisoria central entre mitades
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      this.ctx.fillRect(0, bottomC1 + 2, this.canvas.width, GAP - 4);

      // Render Región C1 (Arriba)
      this.drawRegion(topC1, bottomC1, freq1, window.pitchHistoryMic1, "C1", "C1", paleta, segmentosLetras, currentTime);

      // Render Región C2 (Abajo)
      this.drawRegion(topC2, bottomC2, freq2, window.pitchHistoryMic2, "C2", "C2", paleta, segmentosLetras, currentTime);
    } else {
      // Modo Clásico (Región Única)
      const topP = 35;
      const bottomP = this.canvas.height - 110;
      this.drawRegion(topP, bottomP, freq1, window.pitchHistoryMic1, null, null, paleta, segmentosLetras, currentTime);
    }

    // TELEPROMPTER COMPARTIDO FIXO (Línea inferior compartida)
    if (Array.isArray(segmentosLetras) && segmentosLetras.length > 0) {
      const idx = segmentosLetras.findIndex(s => currentTime >= (s.start || 0) && currentTime <= (s.end || ((s.start || 0) + 1.5)));

      const teleHeight = 90;
      const teleTop = this.canvas.height - teleHeight;

      this.ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
      this.ctx.fillRect(0, teleTop, this.canvas.width, teleHeight);

      if (idx !== -1) {
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        // Prefijo por cantante en modo split
        const parteActual = segmentosLetras[idx].parte || "C1";
        let prefijo = "";
        if (window.karaokeDuoSplitMode) {
          prefijo = (parteActual === "DUO" || parteActual === "DÚO") 
            ? "🟪 DÚO · " 
            : (parteActual === "C2" || parteActual === "P2" ? "🟧 C2 · " : "🟦 C1 · ");
        }

        // Línea Actual (Principal)
        this.ctx.fillStyle = "#ffffff";
        this.ctx.font = `bold 28px ${paleta.fuente}`;
        this.ctx.fillText(prefijo + (segmentosLetras[idx].text || ""), this.canvas.width / 2, teleTop + 32);

        // Línea Siguiente (Preview)
        if (segmentosLetras[idx + 1]) {
          this.ctx.fillStyle = "#94a3b8";
          this.ctx.font = `italic 20px ${paleta.fuente}`;
          this.ctx.fillText(segmentosLetras[idx + 1].text || "", this.canvas.width / 2, teleTop + 68);
        }
      }
    }
  }

  handleResize() {
    // Recalcular métricas en caso de cambio de dimensión del viewport
    this.lastFrameTime = 0;
  }
}

// Función global de retrocompatibilidad
window.drawKaraokeMonitor = function(currentTime, currentFreq, currentFreq2) {
  if (window.karaokeRendererInstance) {
    window.karaokeRendererInstance.render(currentTime, currentFreq, currentFreq2);
  }
};

const $ = (id) => document.getElementById(id);

export async function startKaraokeRecording() {
  const track = $("karaokeTrack") || $("trackPlayer");

  if (!karaokeSelectedTrackBlob) {
    alert("⚠️ Primero selecciona un karaoke de la lista.");
    return;
  }

  if (!track) {
    alert("⚠️ No se encontró el reproductor de karaoke.");
    return;
  }

  try {
    const micCount = $("micCount");
    const isDuo = !!(micCount && micCount.value === "2");

    karaokeChunks = [];
    karaokeRecordedBlob = null;

    const voicePlayer = $("karaokeVoicePlayer");
    if (voicePlayer) {
      voicePlayer.src = "";
    }

    // Cargar pista si hace falta
    if (!track.src || track.src !== karaokeSelectedTrackBlob) {
      track.pause();
      track.currentTime = 0;
      track.src = karaokeSelectedTrackBlob;
      track.volume = 0.5;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Audio load timeout (60s)"));
        }, 60000);

        const onCanPlay = () => {
          clearTimeout(timeout);
          track.removeEventListener("canplay", onCanPlay);
          track.removeEventListener("error", onError);
          resolve();
        };

        const onError = () => {
          clearTimeout(timeout);
          track.removeEventListener("canplay", onCanPlay);
          track.removeEventListener("error", onError);
          reject(new Error("Error cargando la pista de karaoke (Cloudflare R2 / CORS)"));
        };

        track.addEventListener("canplay", onCanPlay);
        track.addEventListener("error", onError);
        track.load();
      });
    }

    const mic1Id = typeof getSelectedMicId === "function" ? getSelectedMicId(1) : null;
    const mic2Id = typeof getSelectedMicId === "function" ? getSelectedMicId(2) : null;

    karaokeStream = await navigator.mediaDevices.getUserMedia({
      audio: mic1Id
        ? {
            deviceId: { exact: mic1Id },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        : {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
    });

    finalStream = karaokeStream;

    if (isDuo && mic2Id) {
      karaokeStream2 = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: mic2Id },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const mergeCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000
      });

      karaokeDuoAudioContext = mergeCtx;
      karaokeDuoAnalyser1 = mergeCtx.createAnalyser();
      karaokeDuoAnalyser2 = mergeCtx.createAnalyser();

      const merger = mergeCtx.createChannelMerger(2);
      const destination = mergeCtx.createMediaStreamDestination();

      const src1 = mergeCtx.createMediaStreamSource(karaokeStream);
      const src2 = mergeCtx.createMediaStreamSource(karaokeStream2);

      src1.connect(karaokeDuoAnalyser1);
      src2.connect(karaokeDuoAnalyser2);

      karaokeDuoAnalyser1.connect(merger, 0, 0);
      karaokeDuoAnalyser2.connect(merger, 0, 1);
      merger.connect(destination);

      finalStream = destination.stream;

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "block";
      }

      if (typeof startKaraokeDuoLevelMonitor === "function") {
        startKaraokeDuoLevelMonitor();
      }
    }

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};

    karaokeMediaRecorder = new MediaRecorder(finalStream, options);

    karaokeMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        karaokeChunks.push(e.data);
      }
    };

    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, {
        type: "audio/webm"
      });

      const voicePlayerEl = $("karaokeVoicePlayer");
      if (voicePlayerEl) {
        voicePlayerEl.src = URL.createObjectURL(karaokeRecordedBlob);
      }

      const statusEl = $("karaokeStatus");
      if (statusEl) {
        statusEl.textContent = "Estado: Grabación finalizada ✅";
      }

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "none";
      }

      if (typeof stopKaraokeDuoLevelMonitor === "function") {
        stopKaraokeDuoLevelMonitor();
      }
    };

    karaokeMediaRecorder.start();

    await startKaraokePitchDetection();
    await track.play();

    const startBtn = $("karaokeStartBtn");
    if (startBtn) {
      startBtn.disabled = true;
    }

    const statusEl = $("karaokeStatus");
    if (statusEl) {
      statusEl.textContent = "Estado: Grabando... 🎤";
    }
  } catch (err) {
    console.error("Error iniciando grabación karaoke:", err);

    if (typeof karaokeDuoAudioContext !== "undefined" && karaokeDuoAudioContext) {
      try { await karaokeDuoAudioContext.close(); } catch (e) {}
      karaokeDuoAudioContext = null;
    }

    if (typeof karaokeStream !== "undefined" && karaokeStream) {
      karaokeStream.getTracks().forEach(t => t.stop());
      karaokeStream = null;
    }

    if (typeof karaokeStream2 !== "undefined" && karaokeStream2) {
      karaokeStream2.getTracks().forEach(t => t.stop());
      karaokeStream2 = null;
    }

    if (typeof stopKaraokeDuoLevelMonitor === "function") {
      stopKaraokeDuoLevelMonitor();
    }

    const duoIndicator = $("karaokeDuoIndicator");
    if (duoIndicator) {
      duoIndicator.style.display = "none";
    }

    alert("❌ No se pudo iniciar la grabación de karaoke: " + err.message);
  }
}

export async function startKaraokePitchDetection() {
  // Limpiar sesión previa
  if (typeof karaokePitchLoopRafId !== "undefined" && karaokePitchLoopRafId) {
    cancelAnimationFrame(karaokePitchLoopRafId);
    karaokePitchLoopRafId = null;
  }

  if (typeof karaokePitchWorkletNode !== "undefined" && karaokePitchWorkletNode) {
    try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
    karaokePitchWorkletNode = null;
  }

  if (typeof karaokePitchSourceNode !== "undefined" && karaokePitchSourceNode) {
    try { karaokePitchSourceNode.disconnect(); } catch (e) {}
    karaokePitchSourceNode = null;
  }

  if (typeof karaokePitchDetectionAudioCtx !== "undefined" && karaokePitchDetectionAudioCtx) {
    try {
      if (karaokePitchDetectionAudioCtx.state !== "closed") {
        await karaokePitchDetectionAudioCtx.close();
      }
    } catch (e) {}
    karaokePitchDetectionAudioCtx = null;
  }

  if (typeof karaokeStream === "undefined" || !karaokeStream) {
    console.warn("⚠️ No hay stream principal para detección de pitch en karaoke.");
    return;
  }

  karaokePitchDetectionAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioCtx = karaokePitchDetectionAudioCtx;

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  karaokePitchSourceNode = audioCtx.createMediaStreamSource(karaokeStream);
  karaokePitchDetectionAnalyser = audioCtx.createAnalyser();
  karaokePitchDetectionAnalyser.fftSize = 2048;

  let finalNode = karaokePitchSourceNode;

  if ($("vocalProcessorEnabled")?.checked) {
    try {
      const vocalProcessorUrl =
        (typeof VOCAL_PROCESSOR_URL !== "undefined" && VOCAL_PROCESSOR_URL) ||
        new URL("./vocal-processor.js", import.meta.url).href;

      await audioCtx.audioWorklet.addModule(vocalProcessorUrl);

      karaokePitchWorkletNode = new AudioWorkletNode(audioCtx, "vocal-processor");
      if (typeof updateVocalProcessorParams === "function") {
        updateVocalProcessorParams(karaokePitchWorkletNode);
      }

      karaokePitchSourceNode.connect(karaokePitchWorkletNode);
      finalNode = karaokePitchWorkletNode;
    } catch (e) {
      console.warn("Vocal processor no disponible para karaoke:", e);
      karaokePitchWorkletNode = null;
      finalNode = karaokePitchSourceNode;
    }
  }

  finalNode.connect(karaokePitchDetectionAnalyser);

  if (typeof karaokeDuoSplitMode !== "undefined" && karaokeDuoSplitMode) {
    try {
      if (typeof ensureP2PitchTracking === "function") {
        await ensureP2PitchTracking();
      }
    } catch (e) {
      console.warn("No se pudo inicializar P2 pitch tracking:", e);
    }
  }

  loop();
}

export function loop() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  const currentTime = track ? track.currentTime : 0;
  const isRecording = !!(typeof karaokeMediaRecorder !== "undefined" && karaokeMediaRecorder && karaokeMediaRecorder.state === "recording");
  const trackEnded = !!(track && track.ended);

  let pitch = -1;
  let pitch2 = -1;

  try {
    if (
      typeof karaokePitchDetectionAnalyser !== "undefined" && karaokePitchDetectionAnalyser &&
      typeof karaokePitchDetectionAudioCtx !== "undefined" && karaokePitchDetectionAudioCtx &&
      typeof AudioUtils !== "undefined" && AudioUtils?.detectPitch
    ) {
      const detectPitchFn = AudioUtils.detectPitch;

      const buffer = new Float32Array(karaokePitchDetectionAnalyser.fftSize);
      karaokePitchDetectionAnalyser.getFloatTimeDomainData(buffer);
      pitch = detectPitchFn(buffer, karaokePitchDetectionAudioCtx.sampleRate);
    }
  } catch (error) {
    console.error("Error detectando pitch P1 en karaoke:", error);
    pitch = -1;
  }

  try {
    if (
      typeof karaokeDuoSplitMode !== "undefined" && karaokeDuoSplitMode &&
      typeof karaokeSplitAnalyser2 !== "undefined" && karaokeSplitAnalyser2 &&
      typeof sr2 !== "undefined" && sr2 &&
      typeof AudioUtils !== "undefined" && AudioUtils?.detectPitch
    ) {
      const detectPitchFn = AudioUtils.detectPitch;

      const buf2 = new Float32Array(karaokeSplitAnalyser2.fftSize);
      karaokeSplitAnalyser2.getFloatTimeDomainData(buf2);
      pitch2 = detectPitchFn(buf2, sr2);
    }
  } catch (error) {
    console.error("Error detectando pitch P2 en karaoke:", error);
    pitch2 = -1;
  }

  karaokePitchP1 = typeof pitch === "number" ? pitch : -1;
  karaokePitchP2 = typeof pitch2 === "number" ? pitch2 : -1;

  if (typeof drawKaraokeMonitor === "function") {
    drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);
  }

  if (!isRecording || trackEnded) {
    if (typeof karaokePitchLoopRafId !== "undefined") {
      karaokePitchLoopRafId = null;
    }
    return;
  }

  karaokePitchLoopRafId = requestAnimationFrame(loop);
}

export function stopKaraokeRecording() {
  if (typeof karaokePitchLoopRafId !== "undefined" && karaokePitchLoopRafId) {
    cancelAnimationFrame(karaokePitchLoopRafId);
    karaokePitchLoopRafId = null;
  }

  if (typeof karaokeMediaRecorder !== "undefined" && karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    try {
      karaokeMediaRecorder.stop();
    } catch (e) {
      console.warn("No se pudo detener MediaRecorder:", e);
    }
  }

  if (typeof karaokePitchWorkletNode !== "undefined" && karaokePitchWorkletNode) {
    try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
    karaokePitchWorkletNode = null;
  }

  if (typeof karaokePitchSourceNode !== "undefined" && karaokePitchSourceNode) {
    try { karaokePitchSourceNode.disconnect(); } catch (e) {}
    karaokePitchSourceNode = null;
  }

  if (typeof karaokePitchDetectionAudioCtx !== "undefined" && karaokePitchDetectionAudioCtx && karaokePitchDetectionAudioCtx.state !== "closed") {
    try {
      karaokePitchDetectionAudioCtx.close();
    } catch (e) {}
    karaokePitchDetectionAudioCtx = null;
  }

  if (typeof karaokePitchDetectionAnalyser !== "undefined") {
    karaokePitchDetectionAnalyser = null;
  }

  // Detener Mic 1
  if (typeof karaokeStream !== "undefined" && karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
    karaokeStream = null;
  }

  // Detener Mic 2
  if (typeof karaokeStream2 !== "undefined" && karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  // Cerrar contexto de audio dúo
  if (typeof karaokeDuoAudioContext !== "undefined" && karaokeDuoAudioContext) {
    try { karaokeDuoAudioContext.close(); } catch (e) {}
    karaokeDuoAudioContext = null;
  }

  if (typeof karaokeDuoAnalyser1 !== "undefined") karaokeDuoAnalyser1 = null;
  if (typeof karaokeDuoAnalyser2 !== "undefined") karaokeDuoAnalyser2 = null;

  if (typeof stopP2PitchTracking === "function") stopP2PitchTracking();
  if (typeof stopKaraokeDuoLevelMonitor === "function") stopKaraokeDuoLevelMonitor();

  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) {
    duoIndicator.style.display = "none";
  }

  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  if (track) {
    try { track.pause(); } catch (e) {}
  }

  const startBtn = $("karaokeStartBtn");
  if (startBtn) {
    startBtn.disabled = false;
  }
}

export function restartKaraokeRecording() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");

  if (track) {
    track.pause();
    track.currentTime = 0;
  }

  const voicePlayer = $("karaokeVoicePlayer");
  if (voicePlayer) voicePlayer.src = "";

  karaokeChunks = [];
  karaokeRecordedBlob = null;

  const status = $("karaokeStatus");
  if (status) status.textContent = "Estado: Esperando para grabar...";

  const startBtn = $("karaokeStartBtn");
  if (startBtn) startBtn.disabled = false;
}

export function syncKaraokeMonitor(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) return;

  let activeLine = null;

  lines.forEach(line => {
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end) + 1.5;

    line.classList.remove("active", "past");

    if (currentTime >= start && currentTime <= end) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end) {
      line.classList.add("past");
    }

    const words = line.querySelectorAll(".karaoke-live-word");
    words.forEach(word => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  });

  if (activeLine && activeLine !== lastActiveLine && autoScrollEnabled) {
    activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
    lastActiveLine = activeLine;
  }
}

function ultrastarToSegments(parsed) {
  if (!parsed || !parsed.notes || !parsed.notes.length) {
    return [];
  }
  
  const bpm = parsed.bpm;
  const gap = parsed.gap / 1000; // Convertir a segundos
  const beatDuration = 60 / bpm / 4; // Duración de un beat en segundos (UltraStar usa quarter beats)
  
  // Agrupar sílabas en líneas/palabras
  const segments = [];
  let currentWords = [];
  let lastEndBeat = 0;

  const audioUtilsObj = typeof AudioUtils !== "undefined" ? AudioUtils : null;
  const getNoteFn = typeof getNoteFromFrequency === "function" ? getNoteFromFrequency : () => "";
  
  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    const midiNote = 60 + note.pitch; // UltraStar usa pitch relativo, base = C4 (60)
    
    // Detectar si hay un salto grande (nueva línea)
    const gapFromLast = note.startBeat - lastEndBeat;
    
    if (gapFromLast > 8 && currentWords.length > 0) {
      // Guardar segmento anterior
      segments.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map(w => w.word).join(""),
        words: currentWords,
        pitch: currentWords[0].pitch,
        midi: currentWords[0].midi,
        note: currentWords[0].note
      });
      currentWords = [];
    }
    
    const freq = audioUtilsObj?.midiToFrequency ? audioUtilsObj.midiToFrequency(midiNote) : 0;

    // Agregar palabra/sílaba
    currentWords.push({
      word: note.syllable,
      start: startTime,
      end: endTime,
      pitch: freq,
      midi: midiNote,
      note: getNoteFn(freq)
    });
    
    lastEndBeat = note.startBeat + note.duration;
  }
  
  // Agregar último segmento
  if (currentWords.length > 0) {
    segments.push({
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(""),
      words: currentWords,
      pitch: currentWords[0].pitch,
      midi: currentWords[0].midi,
      note: currentWords[0].note
    });
  }
  
  return segments;
}
    
function parseUltrastarTxt(content) {
  const lines = content.split("\n");
  const metadata = {};
  const notes = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Metadatos
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }

    // Notas
    if (/^[:*F-]/.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0];

      if (type === "-") {
        continue;
      }

      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        const syllable = parts.slice(4).join(" ");

        if (
          Number.isFinite(startBeat) &&
          Number.isFinite(duration) &&
          Number.isFinite(pitch)
        ) {
          notes.push({
            type,
            startBeat,
            duration,
            pitch,
            syllable
          });
        }
      }
    }
  }

  return {
    title: metadata.TITLE || "Sin título",
    artist: metadata.ARTIST || "Desconocido",
    bpm: parseFloat(metadata.BPM) || 120,
    gap: parseFloat(metadata.GAP) || 0,
    videoGap: parseFloat(metadata.VIDEOGAP) || 0,
    genre: metadata.GENRE || "",
    language: metadata.LANGUAGE || "",
    year: metadata.YEAR || "",
    notes
  };
}

export async function handleUltrastarTxtChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    parsedUltrastar = parseUltrastarTxt(content);

    const titleEl = $("ultrastarTitle");
    if (titleEl) titleEl.innerHTML = `<strong>Título:</strong> ${parsedUltrastar.title}`;
    
    const artistEl = $("ultrastarArtist");
    if (artistEl) artistEl.innerHTML = `<strong>Artista:</strong> ${parsedUltrastar.artist}`;
    
    const bpmEl = $("ultrastarBpm");
    if (bpmEl) bpmEl.innerHTML = `<strong>BPM:</strong> ${parsedUltrastar.bpm}`;
    
    const notesEl = $("ultrastarNotes");
    if (notesEl) notesEl.innerHTML = `<strong>Notas:</strong> ${parsedUltrastar.notes.length} sílabas`;
    
    const previewEl = $("ultrastarPreview");
    if (previewEl) previewEl.style.display = "block";

    console.log("📄 UltraStar parseado:", parsedUltrastar);
  } catch (error) {
    console.error("Error parseando UltraStar:", error);
    alert("❌ Error al leer el archivo. Verifica que sea un .txt de UltraStar válido.");
  }
}

export async function confirmUltrastarImport() {
  if (!parsedUltrastar) {
    alert("⚠️ Primero selecciona un archivo .txt de UltraStar");
    return;
  }

  const audioFile = $("ultrastarAudioFile")?.files?.[0];
  if (!audioFile) {
    alert("⚠️ Selecciona el archivo de audio de la canción");
    return;
  }

  const vocalsFile = $("ultrastarVocalsFile")?.files?.[0];

  try {
    const segments = ultrastarToSegments(parsedUltrastar);

    if (!segments.length) {
      alert("⚠️ No se pudieron extraer las notas del archivo");
      return;
    }

    if (typeof CloudflareStorage !== "undefined" && CloudflareStorage?.saveLibraryItemToCloudflare) {
      await CloudflareStorage.saveLibraryItemToCloudflare({
        name: `Pista - ${parsedUltrastar.title} (${parsedUltrastar.artist})`,
        type: "pista",
        blob: audioFile,
        date: new Date().toISOString()
      });

      if (vocalsFile) {
        await CloudflareStorage.saveLibraryItemToCloudflare({
          name: `Voz - ${parsedUltrastar.title} (${parsedUltrastar.artist})`,
          type: "voz",
          blob: vocalsFile,
          transcription: segments
        });
      }

      await CloudflareStorage.saveLibraryItemToCloudflare({
        name: `${parsedUltrastar.title} - ${parsedUltrastar.artist}`,
        type: "karaoke",
        blob: audioFile,
        transcription: segments,
        metadata: {
          title: parsedUltrastar.title,
          artist: parsedUltrastar.artist,
          bpm: parsedUltrastar.bpm,
          genre: parsedUltrastar.genre,
          language: parsedUltrastar.language,
          year: parsedUltrastar.year,
          hasVocalsSeparated: !!vocalsFile
        }
      });
    }

    if (typeof renderLibrary === "function") {
      await renderLibrary("todos");
    }
    if (typeof loadMyKaraokeSongs === "function") {
      await loadMyKaraokeSongs();
    }

    if (typeof closeUltrastarModal === "function") {
      closeUltrastarModal();
    }

    alert(`✅ ¡"${parsedUltrastar.title}" importada exitosamente!\n\nLa encontrarás en "Mis Canciones" lista para cantar.`);
  } catch (error) {
    console.error("Error importando:", error);
    alert("❌ Error al importar la canción. Revisa la consola para más detalles.");
  }
}

export async function loadKaraokeSong(id) {
  try {
    limpiarVariablesMonitor();

    const getItemFn = typeof getLibraryItemsByIdFromSupabase === "function" ? getLibraryItemsByIdFromSupabase : null;
    
    if (!getItemFn) {
      alert("⚠️ Función de lectura de base de datos no disponible.");
      return;
    }

    const item = await getItemFn(id);
    if (!item) {
      alert("⚠️ No se encontró el karaoke.");
      return;
    }

    const urlAudioCloud = item.file_url || item.karaoke || item.audioUrl || item.audioBlob;
    if (!urlAudioCloud) {
      alert("⚠️ Este karaoke no tiene audio en la nube.");
      return;
    }

    karaokeLoadedItem = item;
    karaokeSelectedTrackBlob = urlAudioCloud;
    karaokeSelectedTrackName = item.name || "Karaoke";
    currentTapSyncModeType = item.tapModeStyle || "linea";

    const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
    if (track) {
      try { track.pause(); } catch (e) {}
      track.currentTime = 0;
      track.src = urlAudioCloud;
      track.dataset.objectUrl = "";
      track.dataset.karaokeId = String(item.id);
      track.dataset.karaokeLoaded = "1";
      track.volume = 0.5;
      track.load();
    }

    if (Array.isArray(item.transcription) && item.transcription.length) {
      transcriptionSegments = item.transcription;
      textSegments = item.transcription;
      karaokeLoadedLyrics = item.transcription;
    } else if (Array.isArray(item.lyrics) && item.lyrics.length) {
      transcriptionSegments = item.lyrics;
      textSegments = item.lyrics;
      karaokeLoadedLyrics = item.lyrics;
    } else {
      transcriptionSegments = [];
      textSegments = [];
      karaokeLoadedLyrics = [];
    }

    if (typeof cargarLetrasEnMonitor === "function") {
      cargarLetrasEnMonitor();
    }

    const status = $("karaokeStatus");
    if (status) {
      status.textContent = `Estado: "${item.name}" cargada. ¡A cantar! 🎤`;
    }

    console.log("✅ Karaoke cargado desde Supabase con éxito", {
      id: item.id,
      name: item.name,
      trackSrc: track?.src,
      tapModeStyle: currentTapSyncModeType,
      datasetLoaded: track?.dataset?.karaokeLoaded
    });
  } catch (error) {
    console.error("Error cargando karaoke:", error);
    alert("❌ Error al cargar el karaoke.");
  }
}

function limpiarVariablesMonitor() {
  transcriptionSegments = [];
  baseTranscriptionSegments = [];
  textSegments = [];
  baseTextSegments = [];
  pitchHistory = [];
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;
  karaokeLoadedLyrics = [];
  console.log("🧼 Variables del monitor de letras y pitch reseteadas");
}

export function blobToBase64Full(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;

  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*?);base64/) || [, "audio/mpeg"])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    arr[i] = bin.charCodeAt(i);
  }

  return new Blob([arr], { type: mime });
}

export async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) {
    alert("⚠️ Primero presiona 'Cantar' en un karaoke y luego graba tu voz.");
    return;
  }

  const trackFile = karaokeSelectedTrackBlob;
  const btn = $("karaokeMixBtn");
  const resultDiv = $("karaokeMixResult");

  if (btn) {
    btn.textContent = "🎧 Mezclando audios... ⏳";
    btn.disabled = true;
  }

  if (resultDiv) {
    resultDiv.innerHTML = "<p style='color: var(--text-muted);'>Uniendo la pista y tu voz. Esto puede tardar unos segundos...</p>";
  }

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const fetchOptions = trackFile.startsWith("http") ? { mode: "cors" } : {};
    const response = await fetch(trackFile, fetchOptions);

    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo de audio base (Código: ${response.status})`);
    }

    const audioBlobFromCloud = await response.blob();
    const trackArrayBuffer = await audioBlobFromCloud.arrayBuffer();
    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer();

    const trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer.slice(0));
    const voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer.slice(0));

    const renderLength = Math.max(trackBuffer.length, voiceBuffer.length);
    const renderChannels = Math.max(trackBuffer.numberOfChannels, voiceBuffer.numberOfChannels);
    const sampleRate = trackBuffer.sampleRate;

    const offlineCtx = new OfflineAudioContext(
      renderChannels,
      renderLength,
      sampleRate
    );

    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = 0.4;

    const trackSource = offlineCtx.createBufferSource();
    trackSource.buffer = trackBuffer;
    trackSource.connect(trackGain);
    trackGain.connect(offlineCtx.destination);

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.value = 2.6;

    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    trackSource.start(0);
    voiceSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    
    const exportWavFn = typeof exportStereoWav === "function" ? exportStereoWav : null;
    if (!exportWavFn) throw new Error("Exportador a WAV no disponible.");

    const finalWavBlob = exportWavFn(renderedBuffer);
    const finalUrl = URL.createObjectURL(finalWavBlob);

    if (resultDiv) {
      resultDiv.innerHTML = `
        <h4 style="color: #22c55e;">✅ ¡Mezcla completada!</h4>
        <audio controls src="${finalUrl}" style="width: 100%; margin-bottom: 15px; border-radius: 8px;"></audio>
        <div style="display: flex; gap: 10px;">
          <a href="${finalUrl}" download="Mezcla_${karaokeSelectedTrackName || "Karaoke"}.wav" style="flex: 1;">
            <button type="button" style="width: 100%; background: #22c55e; color: black;">💾 Descargar Archivo</button>
          </a>
          <button id="saveMixToLibBtn" type="button" style="flex: 1; background: #3b82f6; color: white;">📁 Guardar en Biblioteca</button>
        </div>
      `;

      const saveBtn = $("saveMixToLibBtn");
      if (saveBtn) {
        saveBtn.onclick = async () => {
          saveBtn.textContent = "Guardando...";
          saveBtn.disabled = true;

          if (typeof saveToLibrary === "function") {
            await saveToLibrary(finalWavBlob, {
              name: `Mezcla - ${karaokeSelectedTrackName || "Canción"}`,
              type: "grabacion"
            });
          }

          saveBtn.textContent = "✅ ¡Guardado en Biblioteca!";
        };
      }
    }

    try { await audioCtx.close(); } catch (e) {}
  } catch (err) {
    console.error("Error al mezclar:", err);
    if (resultDiv) {
      resultDiv.innerHTML = "<p style='color: #ef4444;'>❌ Hubo un error al mezclar los audios.</p>";
    }
  } finally {
    if (btn) {
      btn.textContent = "🎧 Mezclar Pista + Voz";
      btn.disabled = false;
    }
  }
}

export async function exportKaraokeSong(id) {
  try {
    const getItemFn = typeof getLibraryItemsByIdFromSupabase === "function" ? getLibraryItemsByIdFromSupabase : null;
    if (!getItemFn) throw new Error("Función getLibraryItemsByIdFromSupabase no disponible.");

    const item = await getItemFn(id);
    if (!item) {
      alert("⚠️ No se encontró el karaoke");
      return;
    }

    const audioUrlCloud = item.file_url || item.audioUrl || item.audioBlob;
    if (!audioUrlCloud) {
      alert("⚠️ Este karaoke no tiene un enlace de audio válido para exportar.");
      return;
    }

    const payload = {
      app: "vocalApp",
      version: 2,
      exportedAt: new Date().toISOString(),
      name: item.name,
      type: item.type,
      metadata: item.metadata || {},
      transcription: item.transcription || [],
      lyrics: item.lyrics || [],
      file_url: audioUrlCloud,
      file_path: item.file_path || null
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const safeName = (item.name || "karaoke").replace(/[^a-zA-Z0-9-_]+/g, "_");

    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.vocalApp.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 5000);

    console.log("✅ Karaoke exportado con éxito:", safeName);
  } catch (err) {
    console.error("❌ Error exportando:", err);
    alert("❌ Error al exportar el karaoke");
  }
}

export async function importKaraokeFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || data.app !== "vocalApp") {
      alert("⚠️ Archivo no válido (No es un formato de VocalApp reconocido)");
      return;
    }

    const nuevoItemKaraoke = {
      name: data.name || "Karaoke importado",
      type: "karaoke",
      transcription: data.transcription || [],
      lyrics: data.lyrics || [],
      metadata: data.metadata || {},
      date: new Date().toISOString()
    };

    if (data.version === 2 && data.file_url) {
      nuevoItemKaraoke.file_url = data.file_url;
      nuevoItemKaraoke.file_path = data.file_path || null;
    } else if (data.audio) {
      const audioRecuperadoBlob = dataUrlToBlob(data.audio);

      if (typeof CloudflareStorage !== "undefined" && CloudflareStorage?.uploadFileToCloudflare) {
        const { filePath, fileUrl } = await CloudflareStorage.uploadFileToCloudflare(
          audioRecuperadoBlob,
          `${nuevoItemKaraoke.name}_importado.mp3`,
          audioRecuperadoBlob.type,
          "karaoke"
        );

        nuevoItemKaraoke.file_url = fileUrl;
        nuevoItemKaraoke.file_path = filePath;
      }
    } else {
      alert("⚠️ El archivo de configuración no contiene rutas de audio válidas.");
      return;
    }

    const dbObj = typeof db !== "undefined" ? db : null;
    if (!dbObj) throw new Error("La base de datos no está inicializada.");

    const { error } = await dbObj
      .from("library")
      .insert([nuevoItemKaraoke]);

    if (error) throw new Error(error.message);

    if (typeof renderLibrary === "function") {
      await renderLibrary("todos");
    }

    alert(`✅ "${nuevoItemKaraoke.name}" importado con éxito en la Biblioteca`);
  } catch (err) {
    console.error("❌ Error importando archivo:", err);
    alert("❌ Archivo inválido, corrupto o error de subida a la nube.");
  }
}

export function actualizarSelectoresGlobales() {
  if (typeof loadVoiceOptionsInStudio === "function") loadVoiceOptionsInStudio();
  if (typeof loadTrackOptionsInStudio === "function") loadTrackOptionsInStudio();
  if (typeof loadTrackOptionsInKaraoke === "function") loadTrackOptionsInKaraoke();
  if (typeof loadTextOptionsInStudio === "function") loadTextOptionsInStudio();
  if (typeof loadPitchKaraokeOptions === "function") loadPitchKaraokeOptions();

  console.log("🔄 Selectores de la interfaz actualizados");
}
