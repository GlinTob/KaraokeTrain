import { $, safeAdd } from "../script.js";
import { getLibraryItemsByIdFromSupabase, getLibraryItemsByTypeFromSupabase, saveToLibrary } from "./biblioteca.js";
import { getAudioController, destroyAudioController, exportStereoWav } from "./audio-controller.js";
import { getSelectedMicId } from "./config.js";

let textSegments = [];
let baseTextSegments = [];
let karaokeLoadedLyrics = [];
let pitchHistory = [];
let pitchHistoryP1 = [];
let pitchHistoryP2 = [];
let karaokePitchP1 = -1;
let karaokePitchP2 = -1;
let karaokeDuoSplitMode = false;
let autoScrollEnabled = true;
let lastActiveLine = null;
let karaokeAudioController = null;
let karaokeStream = null;
let karaokeStream2 = null;
let karaokeChunks = [];
let karaokeRecordedBlob = null;
let karaokeMediaRecorder = null;
let karaokePitchDetectionAudioCtx = null;
let karaokePitchDetectionAnalyser = null;
let karaokeSplitAnalyser2 = null;
let karaokePitchWorkletNode = null;
let karaokePitchLoopRafId = null;
let karaokeLoopBusy = false;
let karaokeSelectedTrackBlob = null;
let karaokeSelectedTrackName = "";
let karaokeLoadedItem = null;

window.karaokeMediaRecorder = null;

export function toggleKaraokeDuoSplitMode() {
  karaokeDuoSplitMode = !karaokeDuoSplitMode;
  const btn = $("karaokeDuoSplitToggleBtn");
  if (btn) {
    btn.textContent = karaokeDuoSplitMode
      ? "🎤🎤 Modo Dúo Split: ON (activo)"
      : "👩‍🎤🧔‍🎤 Modo Dúo Split: Inactivo. Haz click aquí para activarlo.";
    btn.style.background = karaokeDuoSplitMode ? "#22c55e" : "#3b82f6";
  }
  const hint = $("karaokeDuoSplitHint");
  if (hint) hint.textContent = karaokeDuoSplitMode ? "Monitor dividido + 2 micrófonos." : "Monitor dividido.";

  pitchHistory = [];
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;

  console.log("🎤 Modo Dúo Split:", karaokeDuoSplitMode ? "ON" : "OFF");
}

function obtenerPaleta(hue = 0) {
  const temaActual = localStorage.getItem("vocalApp_stage") || "theme-clasico";
  let config = { fondo: "#111827", lineas: "#333333", etiquetas: "#666666", barraFutura: "#1e40af", bordeFuturo: "#3b82f6", tamanoTexto: "15px" };

  switch (temaActual) {
    case "theme-moderno": config = { fondo: "#082f49", lineas: "rgba(6, 182, 212, 0.2)", etiquetas: "#06b6d4", barraFutura: "#1e3a8a", bordeFuturo: "#06b6d4", tamanoTexto: "16px" }; break;
    case "theme-disco": config = { fondo: "#2e1065", lineas: "rgba(219, 39, 119, 0.25)", etiquetas: "#facc15", barraFutura: "#701a75", bordeFuturo: "#db2777", tamanoTexto: "18px" }; break;
    case "theme-acustico": config = { fondo: "#451a03", lineas: "rgba(120, 53, 15, 0.4)", etiquetas: "#fcd34d", barraFutura: "#78350f", bordeFuturo: "#b45309", tamanoTexto: "14px" }; break;
    case "theme-fiesta": config = { fondo: `hsl(${hue}, 40%, 12%)`, lineas: "rgba(255, 255, 255, 0.15)", etiquetas: "#ff007f", barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`, bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)`, tamanoTexto: "19px" }; break;
  }
  return config;
}

export function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (typeof currentFreq === "number" && currentFreq > 0) karaokePitchP1 = currentFreq;
  if (typeof currentFreq2 === "number" && currentFreq2 > 0) karaokePitchP2 = currentFreq2;

  const paleta = obtenerPaleta(Math.floor((currentTime || 0) * 50) % 360);
  const AVATAR_BLOCK_W = karaokeDuoSplitMode ? 110 : 0;

  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (karaokeDuoSplitMode) {
    const TELE_H = 100;
    const GAP = 20;
    const regionH = (canvas.height - TELE_H - 40 - GAP) / 2;

    pitchHistoryP1.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (pitchHistoryP1.length > 80) pitchHistoryP1.shift();
    pitchHistoryP2.push(karaokePitchP2 > 0 ? karaokePitchP2 : null);
    if (pitchHistoryP2.length > 80) pitchHistoryP2.shift();

    drawRegion(20, 20 + regionH, karaokePitchP1, pitchHistoryP1, "P1", "P1", paleta, currentTime, canvas, AVATAR_BLOCK_W);
    drawRegion(20 + regionH + GAP, 20 + regionH * 2 + GAP, karaokePitchP2, pitchHistoryP2, "P2", "P2", paleta, currentTime, canvas, AVATAR_BLOCK_W);
  } else {
    pitchHistory.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (pitchHistory.length > 80) pitchHistory.shift();
    drawRegion(20, canvas.height - 100, karaokePitchP1, pitchHistory, null, null, paleta, currentTime, canvas, 0);
  }

  drawLyricsBar(canvas, ctx, currentTime);
}

function drawRegion(pTop, pBottom, pVal, pHist, filtro, etiqueta, paleta, currentTime, canvas, avatarBlockW) {
  const ctx = canvas.getContext("2d");
  const pHeight = pBottom - pTop;
  const pixelsPerSecond = (canvas.width - 150) / 7;
  const dynLineX = 80 + avatarBlockW;
  const pentagramStartX = 35 + avatarBlockW;
  const noteLabelsX = 28 + avatarBlockW;
  const midiToY = (midi) => pTop + ((84 - (midi > 0 ? midi : 60)) / (84 - 36) * pHeight);

  if (etiqueta) drawAvatarBlock(pTop, pBottom, etiqueta, avatarBlockW, ctx);

  ctx.strokeStyle = paleta.lineas;
  ctx.lineWidth = 1;
  const numLines = 10;
  for (let i = 0; i <= numLines; i++) {
    const y = pTop + (pHeight / numLines) * i;
    ctx.beginPath();
    ctx.moveTo(pentagramStartX, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = paleta.etiquetas;
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const noteLabels = ["C6", "A5", "F5", "D5", "B4", "G4", "E4", "C4", "A3", "F3", "D3", "C3"];
  noteLabels.forEach((label, i) => {
    const y = pTop + (pHeight / numLines) * i + 7;
    ctx.fillText(label, noteLabelsX, y);
  });

  if (Array.isArray(textSegments)) {
    textSegments.forEach(seg => {
      if (filtro && seg.parte !== filtro && seg.parte !== "DUO") return;
      (seg.words || []).forEach(w => {
        if (w.end < currentTime - 1 || w.start > currentTime + 8) return;
        const x = dynLineX + (w.start - currentTime) * pixelsPerSecond;
        if (x < pentagramStartX) return;
        const y = midiToY(w.midi || seg.midi || 60);
        const width = Math.max(25, (w.end - w.start) * pixelsPerSecond);
        const h = Math.max(10, pHeight / 14);
        const isPast = currentTime > w.end;
        const isActive = !isPast && currentTime >= w.start;

        let barColor = paleta.barraFutura;
        let strokeColor = paleta.bordeFuturo;
        if (isPast) {
          barColor = "#4b5563";
        } else if (isActive && pVal > 0) {
          const userMidi = Math.round(12 * Math.log2(pVal / 440) + 69);
          const isCorrect = Math.abs(userMidi - (w.midi || seg.midi || 60)) <= 2;
          barColor = isCorrect ? "#22c55e" : "#f59e0b";
          strokeColor = "white";
        }

        ctx.fillStyle = barColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y - h / 2, width, h, 5);
        else ctx.fillRect(x, y - h / 2, width, h);
        ctx.fill();

        if (isActive || !isPast) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = isActive ? 3 : 1;
          ctx.stroke();
        }

        ctx.fillStyle = "white";
        ctx.font = `bold ${paleta.tamanoTexto || "15px"} Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(w.word || w.text || "", x + width / 2, y + 5);
      });
    });
  }

  const points = (pHist || []).filter(f => f && f > 0);
  let started = false;
  if (points.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
    ctx.lineWidth = 4;
    for (let i = 0; i < points.length; i++) {
      const x = dynLineX - (points.length - i) * 3;
      if (x < pentagramStartX) continue;
      const yPos = midiToY(Math.round(12 * Math.log2(points[i] / 440) + 69));
      if (!started) { ctx.moveTo(x, yPos); started = true; }
      else { ctx.lineTo(x, yPos); }
    }
    ctx.stroke();
  }

  if (pVal > 0) {
    const userY = midiToY(Math.round(12 * Math.log2(pVal / 440) + 69));
    ctx.beginPath();
    ctx.fillStyle = "#facc15";
    ctx.arc(dynLineX, userY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dynLineX, pTop - 2);
  ctx.lineTo(dynLineX, pBottom + 2);
  ctx.stroke();
}

function drawAvatarBlock(pTop, pBottom, parte, avatarBlockW, ctx) {
  if (!parte || parte === "DUO") return;
  const isP1 = parte === "P1";
  const nombre = isP1 ? "Wen-dolyne" : "To-bonito";
  const avatarEmoji = isP1 ? "👩" : "🧔🏾";

  const cx = 5 + avatarBlockW / 2;
  const blockTop = pTop + 10;
  const avatarSize = 56;
  const halfSize = 28;
  const nameH = 22;
  const gap = 6;

  ctx.fillStyle = "white";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(nombre, cx, blockTop + nameH - 4);

  const avTop = blockTop + nameH + gap;
  ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);

  const rowTop = avTop + avatarSize + gap;
  const iconHalfFont = `${halfSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;

  if (isP1) {
    const sqX = cx - halfSize - gap / 2;
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(sqX, rowTop, halfSize, halfSize);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1;
    ctx.strokeRect(sqX, rowTop, halfSize, halfSize);
    ctx.font = iconHalfFont;
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("⚛️", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  } else {
    ctx.font = iconHalfFont;
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("🐱", cx - halfSize / 2 - gap / 2, rowTop + halfSize / 2);
    ctx.fillText("🤔", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  }

  ctx.textBaseline = "alphabetic";
}

function drawLyricsBar(canvas, ctx, currentTime) {
  if (!Array.isArray(textSegments) || !textSegments.length) return;
  const idx = textSegments.findIndex(s =>
    currentTime >= (s.start || 0) && currentTime <= ((s.end || 0) + 1.5)
  );
  if (idx === -1) return;

  const seg = textSegments[idx];
  const parteActual = seg.parte || "P1";
  const prefijo = karaokeDuoSplitMode
    ? (parteActual === "DUO" ? "🟪 DÚO · " : parteActual === "P2" ? "🟧 P2 · " : "🟦 P1 · ")
    : "";

  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, canvas.height - 100, canvas.width, 100);

  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.font = "bold 30px Arial";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(prefijo + (seg.text || ""), canvas.width / 2, canvas.height - 65);

  const next = textSegments[idx + 1];
  if (next) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "italic 22px Arial";
    ctx.fillText(next.text || "", canvas.width / 2, canvas.height - 25);
  }
}

function setBarWidth(barId, analyser) {
  const bar = document.getElementById(barId);
  if (!bar || !analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  bar.style.width = Math.min(100, rms * 220) + "%";
}

function updateDuoLevels() {
  setBarWidth("karaokeDuoMic1Level", karaokePitchDetectionAnalyser);
  setBarWidth("karaokeDuoMic2Level", karaokeSplitAnalyser2);
}

export async function startKaraokeRecording() {
  try {
    const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
    if (!track || !track.src) {
      alert("⚠️ Primero selecciona un karaoke desde la Biblioteca.");
      return;
    }

    if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
      try { karaokeMediaRecorder.stop(); } catch (e) {}
    }
    karaokeChunks = [];
    karaokeRecordedBlob = null;

    if (karaokePitchWorkletNode) {
      try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
      karaokePitchWorkletNode = null;
    }
    if (karaokePitchDetectionAudioCtx) {
      try { karaokePitchDetectionAudioCtx.close(); } catch (e) {}
      karaokePitchDetectionAudioCtx = null;
    }
    karaokePitchDetectionAnalyser = null;
    karaokeSplitAnalyser2 = null;
    if (karaokeStream) { karaokeStream.getTracks().forEach(t => t.stop()); karaokeStream = null; }
    if (karaokeStream2) { karaokeStream2.getTracks().forEach(t => t.stop()); karaokeStream2 = null; }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    karaokePitchDetectionAudioCtx = new AudioContextCtor();
    if (karaokePitchDetectionAudioCtx.state === "suspended") {
      await karaokePitchDetectionAudioCtx.resume();
    }

    let constraints1 = { audio: true };
    const mic1 = getSelectedMicId(1);
    if (mic1) constraints1 = { audio: { deviceId: { exact: mic1 } } };
    karaokeStream = await navigator.mediaDevices.getUserMedia(constraints1);

    if (karaokeDuoSplitMode) {
      let constraints2 = { audio: true };
      const mic2 = getSelectedMicId(2);
      if (mic2) constraints2 = { audio: { deviceId: { exact: mic2 } } };
      karaokeStream2 = await navigator.mediaDevices.getUserMedia(constraints2);
    }

    try {
      const workletUrl = new URL("./vocal-processor.js", import.meta.url).href;
      await karaokePitchDetectionAudioCtx.audioWorklet.addModule(workletUrl);
    } catch (e) {
      console.warn("Worklet vocal no disponible:", e);
    }

    const source1 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream);
    let chainNode = source1;

    if ($("vocalProcessorEnabled")?.checked) {
      try {
        karaokePitchWorkletNode = new AudioWorkletNode(karaokePitchDetectionAudioCtx, "vocal-processor");
        source1.connect(karaokePitchWorkletNode);
        karaokePitchWorkletNode.connect(karaokePitchDetectionAudioCtx.destination);
        chainNode = karaokePitchWorkletNode;
      } catch (e) {
        console.warn("Vocal processor no aplicado en karaoke:", e);
        karaokePitchWorkletNode = null;
      }
    }

    karaokePitchDetectionAnalyser = karaokePitchDetectionAudioCtx.createAnalyser();
    karaokePitchDetectionAnalyser.fftSize = 2048;
    chainNode.connect(karaokePitchDetectionAnalyser);

    if (karaokeDuoSplitMode && karaokeStream2) {
      const source2 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream2);
      karaokeSplitAnalyser2 = karaokePitchDetectionAudioCtx.createAnalyser();
      karaokeSplitAnalyser2.fftSize = 2048;
      source2.connect(karaokeSplitAnalyser2);
    }

    karaokeAudioController = getAudioController();

    try {
      karaokeMediaRecorder = new MediaRecorder(karaokeStream);
      window.karaokeMediaRecorder = karaokeMediaRecorder;
      karaokeMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) karaokeChunks.push(e.data);
      };
      karaokeMediaRecorder.onstop = () => {
        if (karaokeChunks.length) {
          karaokeRecordedBlob = new Blob(karaokeChunks, { type: karaokeMediaRecorder?.mimeType || "audio/webm" });
          const voicePlayer = $("karaokeVoicePlayer");
          if (voicePlayer) {
            voicePlayer.src = URL.createObjectURL(karaokeRecordedBlob);
            voicePlayer.controls = true;
          }
        }
        window.karaokeMediaRecorder = null;
      };
      karaokeMediaRecorder.start();
    } catch (e) {
      console.warn("MediaRecorder no disponible en este navegador:", e);
      karaokeMediaRecorder = null;
    }

    try {
      await track.play();
      track.volume = 0.7;
    } catch (e) {
      console.warn("No se pudo reproducir la pista:", e);
    }

    const duoIndicator = $("karaokeDuoIndicator");
    if (duoIndicator) {
      duoIndicator.style.display = karaokeDuoSplitMode ? "block" : "none";
    }

    const statusEl = $("karaokeStatus");
    if (statusEl) {
      statusEl.textContent = karaokeDuoSplitMode
        ? "🎤🎤 ¡Grabando DÚO! Canta y sigue las notas."
        : "🎤 ¡Grabando! Canta y sigue las notas.";
    }

    karaokeLoopBusy = false;
    loop();
  } catch (err) {
    console.error("Error al iniciar karaoke:", err);
    const statusEl = $("karaokeStatus");
    if (statusEl) {
      statusEl.textContent = "❌ Error al iniciar: " + (err?.message || err);
    }
    if (karaokeStream) { karaokeStream.getTracks().forEach(t => t.stop()); karaokeStream = null; }
    if (karaokeStream2) { karaokeStream2.getTracks().forEach(t => t.stop()); karaokeStream2 = null; }
    alert("❌ No se pudo iniciar la grabación. Revisa que el micrófono esté permitido.");
  }
}

export async function startKaraokePitchDetection() {
  if (!karaokeStream) {
    console.warn("⚠️ No hay stream principal para detección de pitch en karaoke.");
    return;
  }
  if (!karaokeAudioController) karaokeAudioController = getAudioController();
  karaokeLoopBusy = false;
  loop();
}

async function loop() {
  if (karaokeLoopBusy) return;
  karaokeLoopBusy = true;

  try {
    const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
    const currentTime = track ? track.currentTime : 0;
    const isRecording = !!(karaokeMediaRecorder && karaokeMediaRecorder.state === "recording");
    const trackEnded = !!(track && track.ended);

    let pitch = -1;
    let pitch2 = -1;

    if (karaokePitchDetectionAnalyser && karaokePitchDetectionAudioCtx && karaokeAudioController) {
      try {
        const buffer = new Float32Array(karaokePitchDetectionAnalyser.fftSize);
        karaokePitchDetectionAnalyser.getFloatTimeDomainData(buffer);
        pitch = await karaokeAudioController.detectPitch(buffer, karaokePitchDetectionAudioCtx.sampleRate);
      } catch (error) {
        console.error("Error detectando pitch P1 en karaoke:", error);
        pitch = -1;
      }
    }

    if (karaokeDuoSplitMode && karaokeSplitAnalyser2 && karaokePitchDetectionAudioCtx && karaokeAudioController) {
      try {
        const buf2 = new Float32Array(karaokeSplitAnalyser2.fftSize);
        karaokeSplitAnalyser2.getFloatTimeDomainData(buf2);
        pitch2 = await karaokeAudioController.detectPitch(buf2, karaokePitchDetectionAudioCtx.sampleRate);
      } catch (error) {
        pitch2 = -1;
      }
    }

    karaokePitchP1 = pitch > 0 ? pitch : -1;
    karaokePitchP2 = pitch2 > 0 ? pitch2 : -1;

    if (karaokeDuoSplitMode) updateDuoLevels();

    drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);

    if (!isRecording || trackEnded) {
      karaokePitchLoopRafId = null;
      if (trackEnded && isRecording) stopKaraokeRecording();
      return;
    }

    karaokePitchLoopRafId = requestAnimationFrame(() => {
      loop();
    });
  } finally {
    karaokeLoopBusy = false;
  }
}

export function stopKaraokeRecording() {
  if (karaokePitchLoopRafId) {
    cancelAnimationFrame(karaokePitchLoopRafId);
    karaokePitchLoopRafId = null;
  }

  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    try {
      karaokeMediaRecorder.stop();
    } catch (e) {
      console.warn("No se pudo detener MediaRecorder:", e);
    }
  }
  window.karaokeMediaRecorder = null;

  if (karaokePitchWorkletNode) {
    try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
    karaokePitchWorkletNode = null;
  }

  if (karaokePitchDetectionAudioCtx && karaokePitchDetectionAudioCtx.state !== "closed") {
    try { karaokePitchDetectionAudioCtx.close(); } catch (e) {}
  }
  karaokePitchDetectionAudioCtx = null;
  karaokePitchDetectionAnalyser = null;
  karaokeSplitAnalyser2 = null;

  if (karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
    karaokeStream = null;
  }
  if (karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  if (karaokeAudioController) {
    destroyAudioController();
    karaokeAudioController = null;
  }

  karaokeLoopBusy = false;

  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) duoIndicator.style.display = "none";

  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  if (track) {
    try { track.pause(); } catch (e) {}
  }

  const statusEl = $("karaokeStatus");
  if (statusEl) statusEl.textContent = "⏹️ Grabación detenida. Escucha tu voz abajo.";

  const mixBtn = $("karaokeMixBtn");
  if (mixBtn) {
    mixBtn.disabled = false;
  }

  const startBtn = $("karaokeStartBtn");
  if (startBtn) startBtn.disabled = false;

  console.log("🛑 Grabación de karaoke detenida.");
}

export async function restartKaraokeRecording() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("trackPlayer");
  if (track) {
    try { track.pause(); } catch (e) {}
    track.currentTime = 0;
  }
  const voicePlayer = $("karaokeVoicePlayer");
  if (voicePlayer) voicePlayer.src = "";
  karaokeChunks = [];
  karaokeRecordedBlob = null;

  const statusEl = $("karaokeStatus");
  if (statusEl) statusEl.textContent = "Estado: Reiniciando grabación...";

  await startKaraokeRecording();
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

export function setKaraokeData(lyrics, name, fileUrl) {
  textSegments = normalizeKaraokeSegments(lyrics);
  baseTextSegments = [...textSegments];

  karaokeSelectedTrackName = name || "Sin nombre";
  karaokeSelectedTrackBlob = fileUrl;

  const statusEl = $("karaokeStatus");
  if (statusEl) {
    statusEl.textContent = `Listos para cantar: ${karaokeSelectedTrackName}`;
  }

  pitchHistory = [];
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;

  cargarLetrasEnMonitor();

  console.log(`🎤 [Karaoke] "${karaokeSelectedTrackName}" sincronizado y listo para grabar.`);
}

function normalizeKaraokeSegments(rawSegments = []) {
  if (!Array.isArray(rawSegments)) return [];

  return rawSegments.map((seg) => {
    const rawWords = Array.isArray(seg.words) ? seg.words : [];

    const words = rawWords.map((w, wordIndex) => {
      const start = Number.isFinite(w.start)
        ? w.start
        : (Number.isFinite(w.startTime) ? w.startTime : 0);

      const nextWord = rawWords[wordIndex + 1];
      const end = Number.isFinite(w.end)
        ? w.end
        : (
            Number.isFinite(nextWord?.start)
              ? nextWord.start
              : Number.isFinite(nextWord?.startTime)
                ? nextWord.startTime
                : start + 0.35
          );

      return {
        word: w.word || w.text || "",
        text: w.text || w.word || "",
        start,
        end,
        midi: Number.isFinite(w.midi) ? w.midi : null,
        parte: w.parte || seg.parte || "P1"
      };
    });

    const segStart = Number.isFinite(seg.start)
      ? seg.start
      : (words[0]?.start ?? 0);

    const segEnd = Number.isFinite(seg.end)
      ? seg.end
      : (words[words.length - 1]?.end ?? segStart + 0.5);

    return {
      start: segStart,
      end: segEnd,
      text: seg.text || words.map(w => w.word).join(" "),
      parte: seg.parte || words[0]?.parte || "P1",
      midi: Number.isFinite(seg.midi)
        ? seg.midi
        : (Number.isFinite(words[0]?.midi) ? words[0].midi : 60),
      words
    };
  });
}

export function cargarLetrasEnMonitor() {
  const container = $("karaokeLiveLyrics");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(textSegments) || !textSegments.length) return;

  textSegments.forEach(seg => {
    const line = document.createElement("div");
    line.className = "karaoke-live-line";
    line.dataset.start = String(seg.start);
    line.dataset.end = String(seg.end);

    const items = (seg.words && seg.words.length) ? seg.words : [seg];
    items.forEach(w => {
      const span = document.createElement("span");
      span.className = "karaoke-live-word";
      span.dataset.start = String(w.start);
      span.dataset.end = String(w.end);
      span.textContent = w.word || w.text || "";
      line.appendChild(span);
    });

    container.appendChild(line);
  });
}
window.cargarLetrasEnMonitor = cargarLetrasEnMonitor;

export async function loadKaraokeSong(id) {
  try {
    limpiarVariablesMonitor();

    const item = await getLibraryItemsByIdFromSupabase(id);
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
    window.currentTapSyncModeType = item.tapModeStyle || "linea";

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

    if (Array.isArray(item.lyrics) && item.lyrics.length) {
      textSegments = normalizeKaraokeSegments(item.lyrics);
      karaokeLoadedLyrics = textSegments;
    } else if (Array.isArray(item.transcription) && item.transcription.length) {
      textSegments = normalizeKaraokeSegments(item.transcription);
      karaokeLoadedLyrics = textSegments;
    } else {
      textSegments = [];
      karaokeLoadedLyrics = [];
    }

    cargarLetrasEnMonitor();

    const status = $("karaokeStatus");
    if (status) {
      status.textContent = `Estado: "${item.name}" cargada. ¡A cantar! 🎤`;
    }

    console.log("✅ Karaoke cargado desde Supabase con éxito:", {
      id: item.id,
      name: item.name,
      trackSrc: track?.src
    });
  } catch (error) {
    console.error("Error cargando karaoke:", error);
    alert("❌ Error al cargar el karaoke.");
  }
}

export async function loadTrackOptionsInKaraoke() {
  try {
    const items = await getLibraryItemsByTypeFromSupabase("karaoke");
    const select = $("karaokeTrackSelect");
    if (select) {
      select.innerHTML = '<option value="">Selecciona un karaoke</option>';
      (items || []).forEach(item => {
        const opt = document.createElement("option");
        opt.value = String(item.id);
        opt.textContent = item.name || "Karaoke";
        select.appendChild(opt);
      });
    }
    const list = $("karaokeSongList");
    if (list) {
      list.innerHTML = "";
      (items || []).forEach(item => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = `🎤 ${item.name || "Karaoke"}`;
        btn.onclick = () => loadKaraokeSong(item.id);
        list.appendChild(btn);
      });
    }
  } catch (error) {
    console.warn("No se pudieron cargar los karaokes:", error);
  }
}

export async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) {
    alert("⚠️ Primero presiona 'Iniciar Grabación' en un karaoke y luego detén la grabación.");
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
    const finalWavBlob = exportStereoWav(renderedBuffer);
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
          await saveToLibrary(finalWavBlob, {
            name: `Mezcla - ${karaokeSelectedTrackName || "Canción"}`,
            type: "grabacion"
          });
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

function limpiarVariablesMonitor() {
  textSegments = [];
  baseTextSegments = [];
  pitchHistory = [];
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;
  karaokeLoadedLyrics = [];
}

window.syncKaraokeMonitor = syncKaraokeMonitor;
