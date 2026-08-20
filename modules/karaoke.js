// drawKaraokeMonitor.js - Módulo autónomo para el monitor de karaoke (Single y Dúo Split)
// Incluye: Dibujo del canvas, detección de pitch, grabación y sincronización con el teleprompter.

import { $ } from '../script.js'; // Asegúrate de que esta ruta sea correcta en tu proyecto

// ============================================================================
// MONITOR KARAOKE CANVAS (1800x600px) - MÓDULO ES6 COMPATIBLE
// ============================================================================

// --- ESTADO Y CONFIGURACIÓN DEL MONITOR ---
let monitorConfig = {
  width: 1800,
  height: 600,
  fontFamily: "Arial, sans-serif",
  fontSize: 20,
  activeLyricColor: "#00ffcc",
  inactiveLyricColor: "#888888",
  pastLyricColor: "#444444",
  noteBarColor: "#ff007f",
  activeNoteBarColor: "#00ffcc",
  pitchLineColorP1: "#00e5ff",
  pitchLineColorP2: "#ff0055",
  pitchDotColorP1: "#ffffff",
  pitchDotColorP2: "#ffffff",
  separatorColor: "#ff0000",
  duoSplitMode: true,
  
  c1AvatarUrl: "",
  c1Icon1Url: "",
  c1Icon2Url: "",
  c2AvatarUrl: "",
  c2Icon1Url: "",
  c2Icon2Url: "",
  
  images: {
    c1Avatar: null,
    c1Icon1: null,
    c1Icon2: null,
    c2Avatar: null,
    c2Icon1: null,
    c2Icon2: null
  }
};

let karaokeDuoSplitMode = false;
let currentLyricsSegments = [];
let karaokePitchP1 = [];
let karaokePitchP2 = [];
let pitchHistoryP1 = [];
let pitchHistoryP2 = [];
let drawTeleprompter = false;
const MAX_PITCH_HISTORY = 120;

const NOTE_SCALE = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];

export function toggleKaraokeDuoSplitMode() {
  karaokeDuoSplitMode = !karaokeDuoSplitMode;
  const btn = $("karaokeDuoSplitToggleBtn");
  if (btn) {
    btn.textContent = karaokeDuoSplitMode ? "🎤🎤 Modo Dúo Split: ON" : "🎤🎤 Modo Dúo Split: OFF";
    btn.style.background = karaokeDuoSplitMode ? "#22c55e" : "#3b82f6";
  }
  // Re-pintar el canvas para reflejar el cambio aunque no haya pitch activo
  if (typeof drawKaraokeMonitor === "function") {
    const track = $("karaokeTrack");
    const t = track ? track.currentTime : 0;
    drawKaraokeMonitor(t, karaokePitchP1, karaokePitchP2);
  }
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function updateMonitorConfig(newConfig = {}) {
  monitorConfig = { ...monitorConfig, ...newConfig };

  if (newConfig.c1AvatarUrl) monitorConfig.images.c1Avatar = await loadImage(newConfig.c1AvatarUrl);
  if (newConfig.c1Icon1Url) monitorConfig.images.c1Icon1 = await loadImage(newConfig.c1Icon1Url);
  if (newConfig.c1Icon2Url) monitorConfig.images.c1Icon2 = await loadImage(newConfig.c1Icon2Url);
  if (newConfig.c2AvatarUrl) monitorConfig.images.c2Avatar = await loadImage(newConfig.c2AvatarUrl);
  if (newConfig.c2Icon1Url) monitorConfig.images.c2Icon1 = await loadImage(newConfig.c2Icon1Url);
  if (newConfig.c2Icon2Url) monitorConfig.images.c2Icon2 = await loadImage(newConfig.c2Icon2Url);
}

export function cargarLetrasEnMonitor(segments = []) {
  currentLyricsSegments = Array.isArray(segments) ? segments : [];
}

export function limpiarVariablesMonitor() {
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  baseTextSegments = [];
  pitchHistory = [];
  currentLyricsSegments = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;
  karaokeLoadedLyrics = [];
  console.log("🧼 Variables del monitor de letras y pitch reseteadas");
}

export const resetMonitorHistories = limpiarVariablesMonitor;

function convertFrequencyToNoteName(freq) {
  if (!freq || freq <= 0) return null;
  const A4 = 440;
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const midi = Math.round(12 * Math.log2(freq / A4)) + 69;
  const noteIndex = (midi % 12 + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[noteIndex]}${octave}`;
}

function getNoteY(noteName, topY, height) {
  if (!noteName) return null;
  const cleanNote = noteName.trim().toUpperCase();
  const index = NOTE_SCALE.indexOf(cleanNote);
  if (index === -1) return null;

  const step = height / (NOTE_SCALE.length + 1);
  return topY + step * (index + 1);
}

function drawPentagram(ctx, x, topY, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.5;

  const pentagramNotes = ["G4", "E4", "C4", "A3", "F3"];
  pentagramNotes.forEach((note) => {
    const y = getNoteY(note, topY, height);
    if (y !== null) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawAvatarAndIcons(ctx, x, y, avatarImg, icon1Img, icon2Img, label) {
  ctx.save();
  
  const avatarSize = 50;
  ctx.beginPath();
  ctx.arc(x + avatarSize / 2, y + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();

  if (avatarImg) {
    ctx.drawImage(avatarImg, x, y, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = "#333333";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px " + monitorConfig.fontFamily;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + avatarSize / 2, y + avatarSize / 2);
  }
  ctx.restore();

  const iconSize = 24;
  if (icon1Img) {
    ctx.drawImage(icon1Img, x + avatarSize + 10, y + 13, iconSize, iconSize);
  }
  if (icon2Img) {
    ctx.drawImage(icon2Img, x + avatarSize + 40, y + 13, iconSize, iconSize);
  }
}

function drawPitchTrail(ctx, pitchHistory, topY, height, regionX, regionWidth, colorLine, colorDot) {
  if (!pitchHistory || pitchHistory.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 3;

  let lastX = null;
  let lastY = null;

  const stepX = regionWidth / MAX_PITCH_HISTORY;

  for (let i = 0; i < pitchHistory.length; i++) {
    const freq = pitchHistory[i];
    const x = regionX + i * stepX;

    if (freq > 0) {
      const noteName = convertFrequencyToNoteName(freq);
      const y = getNoteY(noteName, topY, height);

      if (y !== null) {
        if (lastX === null) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        lastX = x;
        lastY = y;
      }
    }
  }
  ctx.stroke();

  if (lastX !== null && lastY !== null) {
    ctx.beginPath();
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
    ctx.fillStyle = colorDot;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorLine;
    ctx.stroke();
  }

  ctx.restore();
}

function drawKaraokeLyrics(ctx, datos, currentTime, x, y, width, height) {
  if (!Array.isArray(datos) || datos.length === 0) return;

  // 1. Búsqueda optimizada (como en la 2da función)
  const idx = datos.findIndex(s => 
    currentTime >= (s.start || 0) && 
    currentTime <= (s.end || (s.start + 1))
  );

  if (idx === -1) return;

  // 2. Fondo y Marco (Estilo de la 1ra función, aplicado a coords dinámicas)
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; // Opacidad de la 2da función
  ctx.fillRect(x, y, width, height);
  
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.strokeRect(x, y, width, height);

  // 3. Preparación de Textos con Lógica Dúo
  const segmentoActual = datos[idx];
  const segmentoSiguiente = datos[idx + 1];
  
  // Lógica de prefijo Dúo (de la 2da función)
  const parteActual = segmentoActual.parte || "P1";
  const prefijo = (typeof karaokeDuoSplitMode !== 'undefined' && karaokeDuoSplitMode) 
    ? (parteActual === "DUO" ? "🟪 DÚO · " : (parteActual === "P2" ? "🟧 P2 · " : "🟦 P1 · ")) 
    : "";

  const currentText = prefijo + (segmentoActual.text || "");
  const nextText = segmentoSiguiente ? (segmentoSiguiente.text || "") : "";

  // 4. Dibujo Línea Actual (Configurable)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  
  ctx.font = `bold 30px ${monitorConfig.fontFamily}`; // Fuente configurable
  ctx.fillStyle = monitorConfig.activeLyricColor;     // Color configurable
  // Posición relativa al nuevo 'y' y 'height'
  ctx.fillText(currentText, x + width / 2, y + height / 3); 

  // 5. Dibujo Siguiente Línea (Configurable)
  if (nextText) {
    ctx.font = `italic 22px ${monitorConfig.fontFamily}`;
    ctx.fillStyle = monitorConfig.inactiveLyricColor;
    ctx.fillText(nextText, x + width / 2, y + (height * 3) / 4);
  }

  ctx.restore();

  // 6. Efecto Secundario (Mantener lógica de pitch)
  if (typeof isPitchDetectionRunning !== 'undefined' && !isPitchDetectionRunning) {
    isPitchDetectionRunning = true;
    if (typeof startKaraokePitchDetection === 'function') {
      startKaraokePitchDetection();
    }
  }
}

function drawNotesAndLyrics(ctx, segments, currentTime, regionX, regionY, regionWidth, regionHeight) {
  if (!Array.isArray(segments) || !segments.length) return;

  ctx.save();
  const timeWindow = 6;
  const pixelsPerSecond = regionWidth / timeWindow;

  segments.forEach((seg) => {
    const words = seg.words || [{ word: seg.text, start: seg.start, end: seg.end, note: seg.note }];

    words.forEach((w) => {
      if (w.start > currentTime + timeWindow || w.end < currentTime - 2) return;

      const startX = regionX + (w.start - currentTime + 2) * pixelsPerSecond;
      const barWidth = Math.max((w.end - w.start) * pixelsPerSecond, 10);
      const noteName = w.note || convertFrequencyToNoteName(w.pitch);
      const y = getNoteY(noteName, regionY, regionHeight);

      if (y !== null) {
        const isActive = currentTime >= w.start && currentTime <= w.end;
        const isPast = currentTime > w.end;

        ctx.fillStyle = isActive
          ? monitorConfig.activeNoteBarColor
          : isPast
          ? monitorConfig.pastLyricColor
          : monitorConfig.noteBarColor;

        ctx.beginPath();
        ctx.roundRect(startX, y - 6, barWidth, 12, 4);
        ctx.fill();

        ctx.font = `bold 14px ${monitorConfig.fontFamily}`;
        ctx.fillStyle = isActive
          ? monitorConfig.activeLyricColor
          : isPast
          ? monitorConfig.pastLyricColor
          : monitorConfig.inactiveLyricColor;

        ctx.textAlign = "center";
        ctx.fillText(w.word || "", startX + barWidth / 2, y - 10);
      }
    });
  });

  ctx.restore();
}

// ============================================================================
// FUNCIÓN PRINCIPAL RENDERIZADORA (COMPATIBLE CON FIRMA ANTIGUA Y NUEVA)
// ============================================================================


async function ensureP2PitchTracking() {
  // Reutilizar el analyser de la grabación dúo si está disponible
  if (karaokeDuoAnalyser2 && karaokeDuoAudioContext) {
    karaokeSplitAnalyser2 = karaokeDuoAnalyser2;
    karaokeSplitAudioCtx = karaokeDuoAudioContext;
    return;
  }
  if (karaokeSplitAnalyser2) return;
  try {
    const mic2Id = (typeof getSelectedMicId === "function") ? getSelectedMicId(2) : null;
    if (!mic2Id) {
      console.warn("[DuoSplit] No hay Mic 2 seleccionado; el rastro P2 no se podrá dibujar.");
      return;
    }
    if (!karaokeSplitAudioCtx) {
      karaokeSplitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    karaokeSplitStream2 = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: mic2Id }, echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false }}
    });
    const src2 = karaokeSplitAudioCtx.createMediaStreamSource(karaokeSplitStream2);
    karaokeSplitAnalyser2 = karaokeSplitAudioCtx.createAnalyser();
    karaokeSplitAnalyser2.fftSize = 4800;
    src2.connect(karaokeSplitAnalyser2);
    console.log("[DuoSplit] Pitch tracking del Mic 2 iniciado");
  } catch (e) {
    console.warn("No se pudo iniciar pitch del Mic 2 (P2):", e);
  }
}

function stopP2PitchTracking() {
  try {
    // Sólo paramos el stream si NOSOTROS lo abrimos (no si lo prestamos del flujo dúo)
    if (karaokeSplitStream2) {
      karaokeSplitStream2.getTracks().forEach(t => t.stop());
    }
  } catch (e) {}
  karaokeSplitStream2 = null;
  karaokeSplitAnalyser2 = null;
  karaokePitchP2 = -1;
  pitchHistoryP2 = [];
}

export function drawKaraokeMonitor(arg1, arg2, arg3, arg4, arg5) {
  let canvasTarget = null;
  let currentTime = 0;
  let pitchP1 = -1;
  let pitchP2 = -1;
  let lyricsSegments = currentLyricsSegments;

  // Detección polimórfica de firma de llamada
  if (typeof arg1 === "number") {
    // Firma Antigua: (currentTime, pitchP1, pitchP2, [canvasTarget], [lyrics])
    currentTime = arg1 || 0;
    pitchP1 = arg2 ?? -1;
    pitchP2 = arg3 ?? -1;
    canvasTarget = arg4 || $("karaokeCanvas") || $("monitorCanvas") || document.querySelector("canvas");
    if (Array.isArray(arg5)) lyricsSegments = arg5;
  } else {
    // Firma Nueva: (canvasIdOrElement, currentTime, pitchP1, pitchP2, [lyrics])
    canvasTarget = arg1 || $("karaokeCanvas") || $("monitorCanvas") || document.querySelector("canvas");
    currentTime = arg2 || 0;
    pitchP1 = arg3 ?? -1;
    pitchP2 = arg4 ?? -1;
    if (Array.isArray(arg5)) lyricsSegments = arg5;
  }

  const canvas = typeof canvasTarget === "string" ? $(canvasTarget) : canvasTarget;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (canvas.width !== monitorConfig.width) canvas.width = monitorConfig.width;
  if (canvas.height !== monitorConfig.height) canvas.height = monitorConfig.height;

  ctx.fillStyle = "#0d0e15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  pitchHistoryP1.push(pitchP1);
  if (pitchHistoryP1.length > MAX_PITCH_HISTORY) pitchHistoryP1.shift();

  pitchHistoryP2.push(pitchP2);
  if (pitchHistoryP2.length > MAX_PITCH_HISTORY) pitchHistoryP2.shift();

  const teleprompterHeight = 70;
  const mainY = teleprompterHeight + 10;
  const mainHeight = canvas.height - mainY - 10;

  if (monitorConfig.duoSplitMode) {
    const halfHeight = mainHeight / 2 - 5;

    // Región Cantante 1 (C1)
    const c1TopY = mainY;
    drawAvatarAndIcons(
      ctx,
      20,
      c1TopY + 10,
      monitorConfig.images.c1Avatar,
      monitorConfig.images.c1Icon1,
      monitorConfig.images.c1Icon2,
      "C1"
    );
    drawPentagram(ctx, 150, c1TopY, canvas.width - 170, halfHeight);
    drawNotesAndLyrics(ctx, lyricsSegments, currentTime, 150, c1TopY, canvas.width - 170, halfHeight);
    drawPitchTrail(
      ctx,
      pitchHistoryP1,
      c1TopY,
      halfHeight,
      150,
      canvas.width - 170,
      monitorConfig.pitchLineColorP1,
      monitorConfig.pitchDotColorP1
    );

    // Separador Dúo Split
    const separatorY = mainY + halfHeight + 5;
    ctx.save();
    ctx.strokeStyle = monitorConfig.separatorColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, separatorY);
    ctx.lineTo(canvas.width - 20, separatorY);
    ctx.stroke();
    ctx.restore();

    // Región Cantante 2 (C2)
    const c2TopY = separatorY + 5;
    drawAvatarAndIcons(
      ctx,
      20,
      c2TopY + 10,
      monitorConfig.images.c2Avatar,
      monitorConfig.images.c2Icon1,
      monitorConfig.images.c2Icon2,
      "C2"
    );
    drawPentagram(ctx, 150, c2TopY, canvas.width - 170, halfHeight);
    drawNotesAndLyrics(ctx, lyricsSegments, currentTime, 150, c2TopY, canvas.width - 170, halfHeight);
    drawPitchTrail(
      ctx,
      pitchHistoryP2,
      c2TopY,
      halfHeight,
      150,
      canvas.width - 170,
      monitorConfig.pitchLineColorP2,
      monitorConfig.pitchDotColorP2
    );

  } else {
    // Modo Unificado / Solo
    drawAvatarAndIcons(
      ctx,
      20,
      mainY + 10,
      monitorConfig.images.c1Avatar,
      monitorConfig.images.c1Icon1,
      monitorConfig.images.c1Icon2,
      "SOLO"
    );
    drawPentagram(ctx, 150, mainY, canvas.width - 170, mainHeight);
    drawNotesAndLyrics(ctx, lyricsSegments, currentTime, 150, mainY, canvas.width - 170, mainHeight);
    drawPitchTrail(
      ctx,
      pitchHistoryP1,
      mainY,
      mainHeight,
      150,
      canvas.width - 170,
      monitorConfig.pitchLineColorP1,
      monitorConfig.pitchDotColorP1
    );
  }

  // Teleprompter Superior
  drawTeleprompter(ctx, lyricsSegments, currentTime, 150, 5, canvas.width - 300, teleprompterHeight);
}

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
