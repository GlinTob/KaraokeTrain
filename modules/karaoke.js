import { $, safeAdd } from "./utils.js";
import { getLibraryItemsByIdFromSupabase, getLibraryItemsByTypeFromSupabase, saveToLibrary } from "./biblioteca.js?v=4";
// FIX #17: removido `destroyAudioController` del import. Se mantiene el
// singleton vivo durante toda la sesión (no se destruye en flujos normales)
// para evitar romper las promesas en vuelo de otros consumidores (afina-dor).
// El encode WAV ahora corre en el worker (encodeWavToBlob) para no bloquear
// el hilo principal con mezclas largas.
import { getAudioController } from "./audio-controller.js";
import { getSelectedMicId } from "./config.js?v=8";
import { midiToNoteName } from "./afinador.js?v=1";

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
// Dúo: segundo micrófono con recorder propio (agnóstico al hardware:
// USB, 3.5mm o mixto; cada mic conserva su reloj y su encoding).
let karaokeChunks2 = [];
let karaokeRecordedBlob2 = null;
let karaokeMediaRecorder2 = null;
let duoPitchTurn = 0;
// Diagnóstico/endurecido dúo: P2 activo solo si su recorder arrancó de
// verdad; combinado listo para Mezclar; watchdog por si un onstop no llega.
let karaokeDuoP2Active = false;
let karaokeDuoCombined = false;
let karaokeFinalizeTimeout = null;
let karaokePitchDetectionAudioCtx = null;
let karaokePitchDetectionAnalyser = null;
let karaokeSplitAnalyser2 = null;
let karaokePitchLoopRafId = null;
let karaokeLoopBusy = false;
let karaokeRecordingActive = false;
let loopTick = 0;
let karaokeSelectedTrackBlob = null;
let karaokeSelectedTrackName = "";
let karaokeLoadedItem = null;
let avatarCache = { P1: null, P2: null }; 
let avatarImageCache = { P1: null, P2: null };

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

  drawKaraokeMonitor(0, -1, -1);

  console.log("🎤 Modo Dúo Split:", karaokeDuoSplitMode ? "ON" : "OFF");
}

function obtenerPaleta(hue = 0) {
  const temaActual = localStorage.getItem("karaokeTrain_stage") || "theme-clasico";
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

  if (typeof currentFreq === "number") karaokePitchP1 = currentFreq;
  if (typeof currentFreq2 === "number") karaokePitchP2 = currentFreq2;

  const paleta = obtenerPaleta(Math.floor((currentTime || 0) * 50) % 360);
  const AVATAR_BLOCK_W = karaokeDuoSplitMode ? 110 : 0;

  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (karaokeDuoSplitMode) {
    const TELE_H = 100;
    const GAP = 20;
    const regionH = (canvas.height - TELE_H - 40 - GAP) / 2;

    pitchHistoryP1.push(currentFreq > 0 ? currentFreq : null);
    if (pitchHistoryP1.length > 80) pitchHistoryP1.shift();
    pitchHistoryP2.push(currentFreq2 > 0 ? currentFreq2 : null);
    if (pitchHistoryP2.length > 80) pitchHistoryP2.shift();

    drawRegion(20, 20 + regionH, karaokePitchP1, pitchHistoryP1, "P1", "P1", paleta, currentTime, canvas, AVATAR_BLOCK_W);
    drawRegion(20 + regionH + GAP, 20 + regionH * 2 + GAP, karaokePitchP2, pitchHistoryP2, "P2", "P2", paleta, currentTime, canvas, AVATAR_BLOCK_W);
  } else {
    pitchHistory.push(currentFreq > 0 ? currentFreq : null);
    if (pitchHistory.length > 80) pitchHistory.shift();
    drawRegion(20, canvas.height - 122, karaokePitchP1, pitchHistory, null, null, paleta, currentTime, canvas, 0);
  }

  drawLyricsBar(canvas, ctx, currentTime);
}

function drawRegion(pTop, pBottom, pVal, pHist, filtro, etiqueta, paleta, currentTime, canvas, avatarBlockW) {
  const ctx = canvas.getContext("2d");
  const pHeight = pBottom - pTop;
  const pixelsPerSecond = (canvas.width - 150) / 7;
  const dynLineX = 130 + avatarBlockW;
  const pentagramStartX = 35 + avatarBlockW;
  const noteLabelsX = 28 + avatarBlockW;

  // FIX: escala del pentagrama sin medios tonos: solo las notas naturales de
  // la escala de Do mayor, de C3 (48) a E5 (76). Los sostenidos/bemoles caen
  // entre líneas. Notas fuera del rango se pinzan a los extremos.
  const MIN_MIDI = 48; // C3
  const MAX_MIDI = 76; // E5
  const MAJOR_NATURALS = [0, 2, 4, 5, 7, 9, 11];
  const midiToY = (midi) => pTop + ((MAX_MIDI - Math.min(MAX_MIDI, Math.max(MIN_MIDI, midi > 0 ? midi : MIN_MIDI))) / (MAX_MIDI - MIN_MIDI) * pHeight);

  if (etiqueta) drawAvatarBlock(pTop, pBottom, etiqueta, avatarBlockW, ctx);

  // Pentagrama: una línea (más gruesa/oscura) por cada nota natural C..B.
  ctx.strokeStyle = paleta.lineas;
  ctx.lineWidth = 2;
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (!MAJOR_NATURALS.includes(m % 12)) continue;
    const y = midiToY(m);
    ctx.beginPath();
    ctx.moveTo(pentagramStartX, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  // Etiquetas de TODAS las notas naturales. Solo en regiones muy pequeñas
  // se omiten algunas para evitar que el texto se solape.
  ctx.fillStyle = paleta.etiquetas;
  ctx.font = "bold 18px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  let lastLabelY = -1000;
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (!MAJOR_NATURALS.includes(m % 12)) continue;
    const y = midiToY(m);
    if (y - lastLabelY < 8) continue;
    lastLabelY = y;
    ctx.fillText(midiToNoteName(m), noteLabelsX, y + 7);
  }

  // Símbolo de pentagrama (clave de sol) en modo solitario; en dúo ese
  // espacio izquierdo lo ocupan los avatares. Se sitúa entre las etiquetas
  // de nota y la línea de disparo, detrás de las barras.
  if (!etiqueta) {
    const clefY = (pTop + pBottom) / 2;
    ctx.fillStyle = paleta.lineas;
    ctx.font = `bold ${Math.round(pHeight * 0.42)}px "Segoe UI Symbol", "Noto Music", Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\uD834\uDD1E", 85, clefY);
  }

  if (Array.isArray(textSegments)) {
    textSegments.forEach(seg => {
      if (filtro && seg.parte !== filtro && seg.parte !== "DUO") return;
      if (seg.start > currentTime + 8 || seg.end < currentTime - 1) return;
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

  if (pVal > 0) {
    const userMidi = Math.round(12 * Math.log2(pVal / 440) + 69);
    const userY = midiToY(userMidi);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
    ctx.lineWidth = 4;
    let started = false;
    (pHist || []).forEach((f, i) => {
      if (f && f > 0) {
        const x = dynLineX - (pHist.length - i) * 3;
        if (x < pentagramStartX) return;
        const yPos = midiToY(Math.round(12 * Math.log2(f / 440) + 69));
        if (!started) { ctx.moveTo(x, yPos); started = true; }
        else { ctx.lineTo(x, yPos); }
      }
    });
    ctx.stroke();

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


function getAvatarForUser(user) {
  try {
    if (avatarCache[user]) return avatarCache[user];
    if (typeof window.getAvatarForUser === "function") {
      const info = window.getAvatarForUser(user);
      if (info && info.avatar) {
        avatarCache[user] = info;
        return info;
      }
    }
  } catch (e) {}
  return null;
}

function drawAvatarBlock(pTop, pBottom, parte, avatarBlockW, ctx) {
  if (!parte || parte === "DUO") return;

  const isP1 = parte === "P1";
  const user = isP1 ? "P1" : "P2";
  const info = getAvatarForUser(user);

  const nombre = info && info.userName
    ? info.userName
    : (info && info.avatar && info.avatar.name
        ? info.avatar.name
        : (isP1 ? "Wen-dolyne" : "To-bonito"));
  const emoji1 = info && info.emoji1 ? info.emoji1 : (isP1 ? "⚛️" : "🐱");
  const emoji2 = info && info.emoji2 ? info.emoji2 : (isP1 ? "🤖" : "🤔");

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

  if (info && info.avatar && info.avatar.img) {
    let img = avatarImageCache[user];

    if (!img || img.datasetSrc !== info.avatar.img) {
      img = new Image();
      img.datasetSrc = info.avatar.img;
      img.onload = () => {
        const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
        const currentTime = track ? track.currentTime : 0;
        drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);
      };
      img.src = info.avatar.img;
      avatarImageCache[user] = img;
    }

    if (img.complete) {
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(cx - avatarSize / 2, avTop, avatarSize, avatarSize, 10);
      } else {
        ctx.rect(cx - avatarSize / 2, avTop, avatarSize, avatarSize);
      }
      ctx.clip();
      ctx.drawImage(img, cx - avatarSize / 2, avTop, avatarSize, avatarSize);
      ctx.restore();

      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - avatarSize / 2, avTop, avatarSize, avatarSize);
    }
  } else {
    const avatarEmoji = isP1 ? "👩" : "🧔🏾";
    ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);
  }

  const rowTop = avTop + avatarSize + gap;
  const iconHalfFont = `${halfSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;

  ctx.font = iconHalfFont;
  ctx.fillStyle = "white";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (isP1) {
    const sqX = cx - halfSize - gap / 2;
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(sqX, rowTop, halfSize, halfSize);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1;
    ctx.strokeRect(sqX, rowTop, halfSize, halfSize);
    ctx.fillText(emoji1, sqX + halfSize / 2, rowTop + halfSize / 2);
    ctx.fillText(emoji2, cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  } else {
    ctx.fillText(emoji1, cx - halfSize / 2 - gap / 2, rowTop + halfSize / 2);
    ctx.fillText(emoji2, cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  }

  ctx.textBaseline = "alphabetic";
}

function drawLyricsBar(canvas, ctx, currentTime) {
  if (!karaokeRecordingActive) return;
  if (!Array.isArray(textSegments) || !textSegments.length) return;

  const idx = textSegments.findIndex(s =>
    currentTime >= (s.start || 0) && currentTime <= ((s.end || 0) + 1.5)
  );
  let currentIdx = idx;
  if (currentIdx === -1) {
    currentIdx = textSegments.findIndex(s => (s.start || 0) > currentTime);
    if (currentIdx === -1) currentIdx = textSegments.length - 1;
  }

  const seg = textSegments[currentIdx];
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

  const next = textSegments[currentIdx + 1];
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

// Constraints agnósticos al hardware (USB / 3.5mm / mixto): sin
// procesamiento del navegador. El AEC/NS/AGC por defecto toma al segundo
// cantante como "eco/ruido" y lo deja bajo y entrecortado.
function buildMicConstraints(micId) {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (micId) return { audio: { ...base, deviceId: { exact: micId } } };
  return { audio: { ...base } };
}

async function requestMicStream(micId) {
  try {
    return await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId));
  } catch (err) {
    // Fallback agnóstico: si el deviceId exacto falla (dispositivo ocupado,
    // mismo hardware elegido dos veces, jack 3.5 compartido), reintentar sin
    // deviceId pero manteniendo el procesamiento desactivado.
    if (micId && (err?.name === "OverconstrainedError" || err?.name === "NotFoundError")) {
      console.warn("Reintentando micrófono sin deviceId exacto:", err?.message || err);
      return await navigator.mediaDevices.getUserMedia(buildMicConstraints(null));
    }
    throw err;
  }
}

function rmsOfAudioBuffer(buffer) {
  if (!buffer || !buffer.length) return 0;
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

// Mezcla las dos voces del dúo en un solo blob WAV con balance automático
// de niveles: el mic más bajito (p.ej. 3.5mm frente a USB) se sube hasta
// +12 dB para igualarlo al más fuerte. Así el fix no depende del hardware.
async function combineDuoVoiceBlobs(blob1, blob2) {
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const [buf1, buf2] = await Promise.all([
      decodeCtx.decodeAudioData((await blob1.arrayBuffer()).slice(0)),
      decodeCtx.decodeAudioData((await blob2.arrayBuffer()).slice(0))
    ]);
    const rms1 = rmsOfAudioBuffer(buf1);
    const rms2 = rmsOfAudioBuffer(buf2);
    const SILENCE_FLOOR = 0.005;
    let g1 = 1, g2 = 1;
    if (rms1 > SILENCE_FLOOR && rms2 > SILENCE_FLOOR) {
      if (rms1 >= rms2) g2 = Math.min(4, rms1 / rms2);
      else g1 = Math.min(4, rms2 / rms1);
    }
    const HEADROOM = 0.8;
    const sampleRate = buf1.sampleRate;
    const length = Math.max(buf1.length, buf2.length);
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const src1 = offline.createBufferSource();
    src1.buffer = buf1;
    const gain1 = offline.createGain();
    gain1.gain.value = g1 * HEADROOM;
    src1.connect(gain1);
    gain1.connect(offline.destination);
    const src2 = offline.createBufferSource();
    src2.buffer = buf2;
    const gain2 = offline.createGain();
    gain2.gain.value = g2 * HEADROOM;
    src2.connect(gain2);
    gain2.connect(offline.destination);
    src1.start(0);
    src2.start(0);
    const rendered = await offline.startRendering();
    console.log(`🎤🎤 Dúo balanceado: rms1=${rms1.toFixed(4)} g1=${g1.toFixed(2)}, rms2=${rms2.toFixed(4)} g2=${g2.toFixed(2)}`);
    return await getAudioController().encodeWavToBlob(rendered);
  } finally {
    try { await decodeCtx.close(); } catch (e) {}
  }
}

function publishVoicePreview(blob, enableMix = true) {
  const voicePlayer = $("karaokeVoicePlayer");
  if (voicePlayer) {
    voicePlayer.src = URL.createObjectURL(blob);
    voicePlayer.controls = true;
  }
  const mixBtn = $("karaokeMixBtn");
  if (mixBtn) mixBtn.disabled = !enableMix;
}

function duoStatus(text) {
  console.log(text);
  const statusEl = $("karaokeStatus");
  if (statusEl) statusEl.textContent = text;
}

function clearFinalizeWatchdog() {
  if (karaokeFinalizeTimeout) {
    clearTimeout(karaokeFinalizeTimeout);
    karaokeFinalizeTimeout = null;
  }
}

// En dúo, la vista previa final se publica cuando AMBOS recorders entregaron
// su blob; ahí se combinan con balance automático y ese combinado es lo que
// luego usa mixKaraoke. Si P2 nunca arrancó, se publica P1 para no perderlo.
async function tryFinalizeDuoVoice() {
  if (!karaokeDuoSplitMode) return;
  if (karaokeMediaRecorder || karaokeMediaRecorder2) return;
  if (!karaokeRecordedBlob) return;
  if (!karaokeDuoP2Active || !karaokeRecordedBlob2) {
    // P2 no aportó audio: se publica P1 con aviso en vez de silencio total.
    clearFinalizeWatchdog();
    karaokeDuoCombined = true;
    duoStatus(`⚠️ Solo llegó la voz P1 (${karaokeRecordedBlob.size} bytes). Revisa el mic 2 en Config. Escúchala abajo.`);
    publishVoicePreview(karaokeRecordedBlob);
    releaseKaraokeCaptureStreams();
    return;
  }
  try {
    const combinado = await combineDuoVoiceBlobs(karaokeRecordedBlob, karaokeRecordedBlob2);
    karaokeRecordedBlob = combinado;
    karaokeDuoCombined = true;
    clearFinalizeWatchdog();
    duoStatus(`✅ Dúo listo: P1+P2 combinadas (${combinado.size} bytes). Escucha tu voz abajo.`);
    publishVoicePreview(combinado);
  } catch (err) {
    console.error("No se pudieron combinar las voces del dúo:", err);
    karaokeDuoCombined = true;
    clearFinalizeWatchdog();
    duoStatus(`⚠️ No se pudieron combinar; se publica la voz P1 (${karaokeRecordedBlob.size} bytes).`);
    publishVoicePreview(karaokeRecordedBlob);
  }
  releaseKaraokeCaptureStreams();
}

// Watchdog: si tras Detener un onstop no llega (navegador/timing), publicar
// lo que haya en vez de dejar al usuario sin voz y sin mensaje.
function scheduleFinalizeWatchdog() {
  clearFinalizeWatchdog();
  if (!karaokeDuoSplitMode) return;
  karaokeFinalizeTimeout = setTimeout(() => {
    karaokeFinalizeTimeout = null;
    if (karaokeDuoCombined) return;
    if (karaokeMediaRecorder || karaokeMediaRecorder2) return;
    if (karaokeRecordedBlob && !karaokeRecordedBlob2) {
      karaokeDuoCombined = true;
      duoStatus(`⚠️ Solo llegó la voz P1 (${karaokeRecordedBlob.size} bytes). Escúchala abajo; revisa el mic 2.`);
      publishVoicePreview(karaokeRecordedBlob);
      releaseKaraokeCaptureStreams();
    } else if (!karaokeRecordedBlob) {
      duoStatus("❌ No llegó ninguna voz (0 chunks). Abre F12 → Consola, filtra 🎤 y envíame lo que salga.");
      releaseKaraokeCaptureStreams();
    }
  }, 8000);
}

function logStreamInfo(tag, stream) {
  try {
    const tracks = (stream?.getAudioTracks() || []).map(t => ({
      label: t.label, readyState: t.readyState, muted: t.muted, enabled: t.enabled
    }));
    console.log(`🎤 ${tag}:`, JSON.stringify(tracks));
  } catch (e) {
    console.warn(`🎤 ${tag}: no se pudo inspeccionar el stream.`);
  }
}

export async function startKaraokeRecording() {
  try {
    const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
    if (!track || !track.src) {
      alert("⚠️ Primero selecciona un karaoke desde la Biblioteca.");
      return;
    }

    if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
      // FIX #18: este recorder queda descartado (nueva sesión). Al no ser ya
      // la sesión actual, su onstop no debe publicar blob ni tocar streams.
      karaokeMediaRecorder.onstop = null;
      try { karaokeMediaRecorder.stop(); } catch (e) {}
    }
    if (karaokeMediaRecorder2 && karaokeMediaRecorder2.state !== "inactive") {
      karaokeMediaRecorder2.onstop = null;
      try { karaokeMediaRecorder2.stop(); } catch (e) {}
    }
    karaokeMediaRecorder2 = null;
    karaokeChunks = [];
    karaokeChunks2 = [];
    karaokeRecordedBlob = null;
    karaokeRecordedBlob2 = null;
    duoPitchTurn = 0;
    karaokeDuoP2Active = false;
    karaokeDuoCombined = false;
    clearFinalizeWatchdog();

    // Durante una grabación nueva no hay voz lista; se habilita "Mezclar"
    // recién cuando el onstop construye el blob (FIX #18).
    const mixBtnAtStart = $("karaokeMixBtn");
    if (mixBtnAtStart) mixBtnAtStart.disabled = true;

    if (karaokePitchDetectionAudioCtx) {
      try { karaokePitchDetectionAudioCtx.close(); } catch (e) {}
      karaokePitchDetectionAudioCtx = null;
    }
    karaokePitchDetectionAnalyser = null;
    karaokeSplitAnalyser2 = null;
    if (karaokeStream) { karaokeStream.getTracks().forEach(t => t.stop()); karaokeStream = null; }
    if (karaokeStream2) { karaokeStream2.getTracks().forEach(t => t.stop()); karaokeStream2 = null; }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    // FIX: reproducir la pista ANTES de pedir el micrófono, dentro del gesto
    // del usuario (click). Llamarlo después de `getUserMedia` solía provocar
    // NotAllowedError de autoplay y la pista quedaba muda.
    let trackPlaybackFailed = false;
    try {
      track.volume = 0.5;
      await track.play();
    } catch (e) {
      trackPlaybackFailed = true;
      console.warn("No se pudo reproducir la pista:", e);
    }

    karaokePitchDetectionAudioCtx = new AudioContextCtor();
    if (karaokePitchDetectionAudioCtx.state === "suspended") {
      await karaokePitchDetectionAudioCtx.resume();
    }

    const mic1 = getSelectedMicId(1);
    const mic2 = karaokeDuoSplitMode ? getSelectedMicId(2) : null;

    // En dúo hay que elegir dos micrófonos distintos en Config. Con el mismo
    // hardware (típico con jacks 3.5 compartidos) el segundo getUserMedia
    // falla o devuelve el mismo dispositivo duplicado.
    if (karaokeDuoSplitMode && mic1 && mic2 && mic1 === mic2) {
      if (track) { try { track.pause(); } catch (e) {} }
      try { karaokePitchDetectionAudioCtx && await karaokePitchDetectionAudioCtx.close(); } catch (e) {}
      karaokePitchDetectionAudioCtx = null;
      const statusEl = $("karaokeStatus");
      if (statusEl) statusEl.textContent = "⚠️ Elige dos micrófonos distintos en Config (Mic 1 ≠ Mic 2) para el dúo.";
      alert("⚠️ Para el dúo elige dos micrófonos distintos en Config (Mic 1 ≠ Mic 2).");
      karaokeRecordingActive = false;
      return;
    }

    karaokeStream = await requestMicStream(mic1);
    logStreamInfo("Mic 1 abierto", karaokeStream);

    if (karaokeDuoSplitMode) {
      try {
        karaokeStream2 = await requestMicStream(mic2);
        logStreamInfo("Mic 2 abierto", karaokeStream2);
      } catch (err2) {
        console.error("No se pudo abrir el segundo micrófono:", err2);
        if (karaokeStream) { karaokeStream.getTracks().forEach(t => t.stop()); karaokeStream = null; }
        if (track) { try { track.pause(); } catch (e) {} }
        try { karaokePitchDetectionAudioCtx && await karaokePitchDetectionAudioCtx.close(); } catch (e) {}
        karaokePitchDetectionAudioCtx = null;
        const statusEl = $("karaokeStatus");
        if (statusEl) statusEl.textContent = "❌ No se pudo abrir el micrófono 2. Revisa Config y los permisos.";
        alert("❌ No se pudo abrir el micrófono 2. Revisa en Config que esté conectado y permitido.");
        karaokeRecordingActive = false;
        return;
      }
    }

    const source1 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream);

    // El micrófono se usa SOLO para análisis (pitch) y grabación.
    // NUNCA se conecta al altavoz: así no se escucha la voz del usuario mientras canta.
    // La voz se graba en crudo y se reproduce después para que el usuario la evalúe.
    karaokePitchDetectionAnalyser = karaokePitchDetectionAudioCtx.createAnalyser();
    karaokePitchDetectionAnalyser.fftSize = 2048;
    // FIX: el pitch/dot solo reaccionaba al cantar muy fuerte o gritar porque
    // la señal cruda del micrófono queda por debajo del umbral de RMS de
    // detectPitch. Aplicamos una ganancia fija SOLO en la ruta de análisis;
    // la grabación sigue usando el micrófono en crudo.
    const pitchInputGain = karaokePitchDetectionAudioCtx.createGain();
    pitchInputGain.gain.value = 1;
    source1.connect(pitchInputGain);
    pitchInputGain.connect(karaokePitchDetectionAnalyser);

    if (karaokeDuoSplitMode && karaokeStream2) {
      const source2 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream2);
      karaokeSplitAnalyser2 = karaokePitchDetectionAudioCtx.createAnalyser();
      karaokeSplitAnalyser2.fftSize = 2048;
const pitchInputGain2 = karaokePitchDetectionAudioCtx.createGain();
    pitchInputGain2.gain.value = 1;
    source2.connect(pitchInputGain2);
    pitchInputGain2.connect(karaokeSplitAnalyser2);
    }

    karaokeAudioController = getAudioController();

    try {
      // FIX #18: chunks POR SESIÓN. Si un recorder viejo (p.ej. de un
      // "Volver a intentar") dispara su onstop DESPUÉS de iniciar una sesión
      // nueva, no debe leer ni mezclarse con los chunks de la sesión nueva.
      karaokeChunks = [];
      karaokeChunks2 = [];
      karaokeRecordedBlob2 = null;
      karaokeDuoP2Active = false;
      karaokeDuoCombined = false;
      const sessionChunks = karaokeChunks;
      karaokeMediaRecorder = new MediaRecorder(karaokeStream);
      window.karaokeMediaRecorder = karaokeMediaRecorder;
      const recorder = karaokeMediaRecorder;
      karaokeMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) sessionChunks.push(e.data);
      };
      karaokeMediaRecorder.onerror = (e) => {
        console.error("🎤 Error en MediaRecorder P1:", e?.error || e);
      };
      karaokeMediaRecorder.onstop = () => {
        // FIX #18: el blob de la voz solo está completo AQUÍ (evento async
        // tras stop()). Por eso liberamos los tracks del micrófono en este
        // punto y NO en stopKaraokeRecording(): si se paran antes, Chrome
        // puede entregar un chunk final vacío y la voz "no se graba"
        // (karaokeRecordedBlob queda null → "primero canta").
        // Solo actúa si ESTE recorder sigue siendo el actual (un onstop
        // tardío de un "Volver a intentar" no debe pisar la sesión nueva).
        if (karaokeMediaRecorder !== recorder) return;
        if (sessionChunks.length) {
          karaokeRecordedBlob = new Blob(sessionChunks, { type: recorder.mimeType || "audio/webm" });
          console.log("🎤 Voz P1 finalizada:", sessionChunks.length, "chunks,", karaokeRecordedBlob.size, "bytes, mime:", recorder.mimeType || "audio/webm");
          if (!karaokeDuoSplitMode) {
            publishVoicePreview(karaokeRecordedBlob);
            releaseKaraokeCaptureStreams();
          } else {
            // Vista previa temporal de P1 (sin habilitar Mezclar): si P2
            // falla, el usuario al menos escucha esta voz con su aviso.
            publishVoicePreview(karaokeRecordedBlob, false);
            const statusEl = $("karaokeStatus");
            if (statusEl) statusEl.textContent = "🎤 Voz P1 lista… esperando la voz P2 para combinar.";
            tryFinalizeDuoVoice();
          }
        } else {
          console.warn("🎤 No se capturaron chunks de voz P1 (grabación muy corta o chunk final vacío).");
        }
        karaokeMediaRecorder = null;
        window.karaokeMediaRecorder = null;
        if (!karaokeDuoSplitMode) releaseKaraokeCaptureStreams();
        else tryFinalizeDuoVoice();
      };
      // timeslice: entrega los chunks en intervalos; si el chunk final se
      // perdiera por cualquier razón, la grabación conserva los anteriores.
      karaokeMediaRecorder.start(500);

      // Dúo: recorder independiente para el mic 2. Cada mic se codifica con
      // su propio reloj (USB, 3.5mm o mixto) y se combinan al final con
      // balance automático; así ningún mic queda fuera de la mezcla.
      // Va en try/catch PROPIO: si P2 falla al construir, P1 sigue grabando
      // y al final se publica P1 con aviso (nunca silencio total).
      if (karaokeDuoSplitMode && karaokeStream2) {
        try {
          const liveTracks = karaokeStream2.getAudioTracks().filter(t => t.readyState === "live");
          if (!liveTracks.length) throw new Error("El stream del mic 2 no tiene pistas de audio activas.");
          karaokeMediaRecorder2 = new MediaRecorder(karaokeStream2);
          const recorderB = karaokeMediaRecorder2;
          const sessionChunksB = karaokeChunks2;
          karaokeMediaRecorder2.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) sessionChunksB.push(e.data);
          };
          karaokeMediaRecorder2.onerror = (e) => {
            console.error("🎤 Error en MediaRecorder P2:", e?.error || e);
          };
          karaokeMediaRecorder2.onstop = () => {
            if (karaokeMediaRecorder2 !== recorderB) return;
            if (sessionChunksB.length) {
              karaokeRecordedBlob2 = new Blob(sessionChunksB, { type: recorderB.mimeType || "audio/webm" });
              console.log("🎤 Voz P2 finalizada:", sessionChunksB.length, "chunks,", karaokeRecordedBlob2.size, "bytes, mime:", recorderB.mimeType || "audio/webm");
            } else {
              console.warn("🎤 No se capturaron chunks de voz P2.");
            }
            karaokeMediaRecorder2 = null;
            tryFinalizeDuoVoice();
          };
          karaokeMediaRecorder2.start(500);
          karaokeDuoP2Active = true;
        } catch (errRec2) {
          console.error("🎤 No se pudo grabar el mic 2, se continúa solo con P1:", errRec2);
          karaokeMediaRecorder2 = null;
          karaokeDuoP2Active = false;
          const statusEl = $("karaokeStatus");
          if (statusEl) statusEl.textContent = "⚠️ El mic 2 no pudo grabarse; se graba solo P1. Revisa Config.";
        }
      }
    } catch (e) {
      console.warn("MediaRecorder no disponible en este navegador:", e);
      karaokeMediaRecorder = null;
      karaokeMediaRecorder2 = null;
      karaokeDuoP2Active = false;
      window.karaokeMediaRecorder = null;
    }

    if (trackPlaybackFailed) {
      const warnEl = $("karaokeStatus");
      if (warnEl) warnEl.textContent = "⚠️ La pista no pudo reproducirse (autoplay/CORS). Grabando la voz de todos modos.";
    }

    const duoIndicator = $("karaokeDuoIndicator");
    if (duoIndicator) {
      duoIndicator.style.display = karaokeDuoSplitMode ? "block" : "none";
    }
    const soloMicIndicator = $("karaokeSoloMicIndicator");
    if (soloMicIndicator) {
      soloMicIndicator.style.display = karaokeDuoSplitMode ? "none" : "block";
    }

    const statusEl = $("karaokeStatus");
    if (statusEl) {
      statusEl.textContent = karaokeDuoSplitMode
        ? "🎤🎤 ¡Grabando DÚO! Canta y sigue las notas."
        : "🎤 ¡Grabando! Canta y sigue las notas.";
    }

    karaokeLoopBusy = false;
    karaokeRecordingActive = true;
    loop();
  } catch (err) {
    console.error("Error al iniciar karaoke:", err);
    const statusEl = $("karaokeStatus");
    if (statusEl) {
      statusEl.textContent = "❌ Error al iniciar: " + (err?.message || err);
    }
    if (karaokeStream) { karaokeStream.getTracks().forEach(t => t.stop()); karaokeStream = null; }
    if (karaokeStream2) { karaokeStream2.getTracks().forEach(t => t.stop()); karaokeStream2 = null; }
    if (track) { try { track.pause(); } catch (e) {} }
    karaokeRecordingActive = false;
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
    const isRecording = !!((karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") || (karaokeMediaRecorder2 && karaokeMediaRecorder2.state === "recording"));
    const trackEnded = !!(track && track.ended);
    // FIX #19: si el usuario "detiene la pista" (pausa o termina el audio),
    // hay que FINALIZAR la grabación aquí mismo. Antes solo se finalizaba en
    // `track.ended` o con el botón "Detener"; si la pista se pausaba de otra
    // forma, el MediaRecorder seguía en "recording" para siempre, nunca llegaba
    // el onstop y la voz jamás aparecía en el player (y "Mezclar" decía
    // "primero canta"). `currentTime > 0.15` evita detener por una pausa
    // momentánea del arranque (buffering) antes de que empiece a sonar.
    const trackPaused = !!(track && track.paused && !track.ended && track.currentTime > 0.15);
    const shouldFinalize = isRecording && (trackEnded || trackPaused);

    // FIX #20 (entrecortado del mic): el MediaRecorder corre en el hilo
    // principal y Chrome suelta tramas si el hilo está saturado. El análisis
    // de pitch + repintado del canvas cada frame (~60fps) satura el hilo y la
    // voz grabada sale entrecortada. Limitamos el trabajo pesado a ~30fps
// (un frame sí, uno no): el monitor no nota la diferencia y la grabación
// deja de laggear. El chequeo de finalizar grabación se mantiene siempre.
    loopTick ^= 1;
    const heavyFrame = (loopTick & 1) === 0;

    // Dúo: ping-pong de pitch (un mic por heavy-frame). Detectar P1+P2 en el
    // mismo frame duplicaba la carga del worker y agravaba el entrecortado
    // del MediaRecorder; alternando se mantiene ~30fps visual con la mitad
    // de trabajo pesado. Agnóstico al hardware.
    const detectP1ThisFrame = !karaokeDuoSplitMode || (duoPitchTurn & 1) === 0;
    const detectP2ThisFrame = karaokeDuoSplitMode && (duoPitchTurn & 1) === 1;
    if (heavyFrame && karaokeDuoSplitMode) duoPitchTurn ^= 1;

    if (heavyFrame && detectP1ThisFrame && karaokePitchDetectionAnalyser && karaokePitchDetectionAudioCtx && karaokeAudioController) {
      try {
        const buffer = new Float32Array(karaokePitchDetectionAnalyser.fftSize);
        karaokePitchDetectionAnalyser.getFloatTimeDomainData(buffer);
        karaokePitchP1 = await karaokeAudioController.detectPitch(buffer, karaokePitchDetectionAudioCtx.sampleRate);
      } catch (error) {
        console.error("Error detectando pitch P1 en karaoke:", error);
        karaokePitchP1 = -1;
      }
    }

    if (heavyFrame && detectP2ThisFrame && karaokeSplitAnalyser2 && karaokePitchDetectionAudioCtx && karaokeAudioController) {
      try {
        const buf2 = new Float32Array(karaokeSplitAnalyser2.fftSize);
        karaokeSplitAnalyser2.getFloatTimeDomainData(buf2);
        karaokePitchP2 = await karaokeAudioController.detectPitch(buf2, karaokePitchDetectionAudioCtx.sampleRate);
      } catch (error) {
        karaokePitchP2 = -1;
      }
    }

    if (heavyFrame) {
      if (!karaokeDuoSplitMode) karaokePitchP2 = -1;

      if (karaokeDuoSplitMode) updateDuoLevels();
      else setBarWidth("karaokeMic1Level", karaokePitchDetectionAnalyser);
    }

    drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);

    if (!isRecording || shouldFinalize) {
      karaokePitchLoopRafId = null;
      if (shouldFinalize) stopKaraokeRecording();
      return;
    }

    karaokePitchLoopRafId = requestAnimationFrame(() => {
      loop();
    });
  } finally {
    karaokeLoopBusy = false;
  }
}

// FIX #18: liberación idempotente de los streams del micrófono. Se invoca
// desde el onstop del MediaRecorder (una vez que el blob de la voz ya está
// finalizado) o inmediatamente cuando no hay recorder pendiente.
function releaseKaraokeCaptureStreams() {
  if (karaokeStream) {
    try { karaokeStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    karaokeStream = null;
  }
  if (karaokeStream2) {
    try { karaokeStream2.getTracks().forEach(t => t.stop()); } catch (e) {}
    karaokeStream2 = null;
  }
}

export function stopKaraokeRecording() {
  if (karaokePitchLoopRafId) {
    cancelAnimationFrame(karaokePitchLoopRafId);
    karaokePitchLoopRafId = null;
  }

  const recorder = karaokeMediaRecorder;
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch (e) {
      console.warn("No se pudo detener MediaRecorder:", e);
    }
  }
  const recorderB = karaokeMediaRecorder2;
  if (recorderB && recorderB.state !== "inactive") {
    try {
      recorderB.stop();
    } catch (e) {
      console.warn("No se pudo detener MediaRecorder P2:", e);
    }
  }
  window.karaokeMediaRecorder = null;

  // Si algún recorder está pending (stop() pedido), su onstop construirá el
  // blob Y liberará los tracks (FIX #18: no parar el mic antes de que el
  // blob finalice, o el chunk final llega vacío y la voz "no se graba").
  const pendingA = recorder && recorder.state !== "inactive";
  const pendingB = recorderB && recorderB.state !== "inactive";
  if (!pendingA && !pendingB) {
    releaseKaraokeCaptureStreams();
  } else if (karaokeDuoSplitMode) {
    // Watchdog por si algún onstop no llega: publica lo que haya.
    scheduleFinalizeWatchdog();
  }

  if (karaokePitchDetectionAudioCtx && karaokePitchDetectionAudioCtx.state !== "closed") {
    try { karaokePitchDetectionAudioCtx.close(); } catch (e) {}
  }
  karaokePitchDetectionAudioCtx = null;
  karaokePitchDetectionAnalyser = null;
  karaokeSplitAnalyser2 = null;

  // NOTA: los streams del mic se liberan en releaseKaraokeCaptureStreams().
  // No parar los tracks aquí si el recorder está pending: ya lo comentamos
  // (FIX #18), parar antes del onstop pierde el blob final.

  // FIX #17: NO destruimos el singleton de audio controller aquí. El worker
  // se comparte con el afinador y otros módulos. Destruirlo rompería sus
  // promesas en vuelo y la próxima iteración de su bucle de detección.
  // El siguiente `getAudioController()` devolverá la misma instancia sana
  // (chequea `isTerminated` y solo recrea si es necesario).
  // Si en el futuro algún módulo realmente necesita un worker dedicado,
  // se debe refactorizar `audio-controller.js` a un pool, no a un singleton
  // global compartido.
  karaokeAudioController = null; // solo soltamos la referencia local

  karaokeLoopBusy = false;
  karaokeRecordingActive = false;

  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) duoIndicator.style.display = "none";
  const soloMicIndicator = $("karaokeSoloMicIndicator");
  if (soloMicIndicator) soloMicIndicator.style.display = "none";

  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  if (track) {
    try { track.pause(); } catch (e) {}
  }

  const statusEl = $("karaokeStatus");
  if (statusEl) statusEl.textContent = "⏹️ Grabación detenida. Escucha tu voz abajo.";

  // El botón Mezclar se habilita en el onstop del recorder, cuando la voz ya
  // está construida (FIX #18). Aquí NO se habilita: si el blob aún no existe,
  // el usuario vería el aviso "primero canta" sin motivo.

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
  karaokeChunks2 = [];
  karaokeRecordedBlob = null;
  karaokeRecordedBlob2 = null;
  karaokeDuoP2Active = false;
  karaokeDuoCombined = false;
  clearFinalizeWatchdog();

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
  const karaokeTrackEl = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  textSegments = ensureTextLineTimings(normalizeKaraokeSegments(lyrics), karaokeTrackEl?.duration);
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

  drawKaraokeMonitor(0, -1, -1);

  console.log(`🎤 [Karaoke] "${karaokeSelectedTrackName}" sincronizado y listo para grabar.`);
}

function normalizeKaraokeSegments(rawSegments = []) {
  if (!Array.isArray(rawSegments)) return [];

  // Detectar si es una lista plana de palabras (con .word/.text y sin .words[])
  const isWordList = rawSegments.length > 0 &&
    rawSegments.every(item => item && typeof item === 'object' &&
      (item.word || item.text) &&
      !Array.isArray(item.words));

  if (isWordList) {
    const withTimes = rawSegments.every(item =>
      Number.isFinite(item.start) || Number.isFinite(item.startTime));
    if (withTimes) {
      return groupFlatWordsIntoSegments(rawSegments);
    }
    // Lista de palabras sin tiempos (p.ej. segmentarTextoPlano): agrupar por renglón
    return groupWordsByLineIntoSegments(rawSegments);
  }

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

/**
 * Agrupa una lista plana de palabras SIN tiempos en segmentos por renglón.
 * Usa el campo `.renglon` (segmentarTextoPlano) para reconstruir las líneas;
 * si no existe, agrupa en bloques de MAX_LINE_WORDS palabras.
 */
function groupWordsByLineIntoSegments(flatWords) {
  if (!flatWords.length) return [];

  const MAX_LINE_WORDS = 10;
  const lines = [];
  let currentRenglon = null;
  let currentLine = null;

  const pushLine = () => {
    if (!currentLine || !currentLine.words.length) return;
    lines.push({
      renglon: currentLine.renglon,
      text: currentLine.words.map(w => w.word).join(" "),
      parte: currentLine.words[0].parte || "P1",
      midi: 60,
      words: currentLine.words
    });
    currentLine = null;
  };

  flatWords.forEach((w) => {
    const text = (w.word || w.text || "").trim();
    if (!text) return;

    let renglon = null;
    if (w.renglon !== undefined && w.renglon !== null && String(w.renglon).trim() !== "") {
      renglon = Number(w.renglon);
      if (!Number.isFinite(renglon)) renglon = null;
    }

    if (!currentLine ||
        (renglon !== null && renglon !== currentRenglon) ||
        currentLine.words.length >= MAX_LINE_WORDS) {
      pushLine();
      currentRenglon = (renglon !== null) ? renglon : (currentRenglon ?? 0);
      currentLine = { renglon: currentRenglon, words: [] };
    }

    currentLine.words.push({
      word: text,
      text,
      start: null,
      end: null,
      midi: Number.isFinite(w.midi) ? w.midi : null,
      parte: w.parte || "P1"
    });
  });

  pushLine();

  return lines;
}

/**
 * Agrupa palabras en formato plano en segmentos de karaoke
 * Agrupa por proximidad temporal (gap > 1.5s = nuevo segmento) y por parte
 */
function groupFlatWordsIntoSegments(flatWords) {
  if (!flatWords.length) return [];
  
  // Normalizar palabras primero
  const normalizedWords = flatWords.map((w, idx) => ({
    word: w.word || w.text || "",
    text: w.text || w.word || "",
    start: Number.isFinite(w.start) ? w.start : (Number.isFinite(w.startTime) ? w.startTime : 0),
    end: Number.isFinite(w.end) ? w.end : null,
    midi: Number.isFinite(w.midi) ? w.midi : null,
    parte: w.parte || "P1",
    originalIndex: idx
  })).sort((a, b) => a.start - b.start);
  
  // Calcular end para palabras que no lo tienen (basado en la siguiente palabra)
  for (let i = 0; i < normalizedWords.length; i++) {
    if (!Number.isFinite(normalizedWords[i].end)) {
      const nextWord = normalizedWords[i + 1];
      if (nextWord && Number.isFinite(nextWord.start)) {
        normalizedWords[i].end = nextWord.start;
      } else {
        normalizedWords[i].end = normalizedWords[i].start + 0.35;
      }
    }
  }
  
  // FIX: si ninguna palabra trae tiempo (start=0), repartirlas uniformemente
  // para que las barras no se amontonen en una línea continua.
  const hasRealStart = normalizedWords.some(w => (w.start || 0) !== 0);
  if (!hasRealStart && normalizedWords.length > 1) {
    const step = 0.5;
    normalizedWords.forEach((w, i) => {
      w.start = +(i * step).toFixed(3);
      w.end = +(w.start + 0.45).toFixed(3);
    });
  }
  
  // Agrupar en segmentos
  const segments = [];
  let currentSegment = {
    words: [normalizedWords[0]],
    parte: normalizedWords[0].parte
  };
  
  for (let i = 1; i < normalizedWords.length; i++) {
    const word = normalizedWords[i];
    const prevWord = normalizedWords[i - 1];
    const gap = word.start - prevWord.end;
    const sameParte = word.parte === currentSegment.parte;
    
    // Nuevo segmento si: gap grande (>1.5s), cambio de parte, o es la primera palabra
    if (gap > 1.5 || !sameParte) {
      // Finalizar segmento actual
      segments.push(createSegmentFromWords(currentSegment.words));
      // Iniciar nuevo segmento
      currentSegment = {
        words: [word],
        parte: word.parte
      };
    } else {
      currentSegment.words.push(word);
    }
  }
  
  // Agregar el último segmento
  if (currentSegment.words.length > 0) {
    segments.push(createSegmentFromWords(currentSegment.words));
  }
  
  return segments;
}

function createSegmentFromWords(words) {
  if (!words.length) return null;
  
  const segStart = words[0].start;
  const segEnd = words[words.length - 1].end;
  const parte = words[0].parte;
  const midi = words.find(w => Number.isFinite(w.midi))?.midi ?? 60;
  
  return {
    start: segStart,
    end: segEnd,
    text: words.map(w => w.word).join(" "),
    parte,
    midi,
    words: words.map(w => ({
      word: w.word,
      text: w.text,
      start: w.start,
      end: w.end,
      midi: w.midi,
      parte: w.parte
    }))
  };
}

/**
 * FIX: cuando los segmentos llegan SIN tiempos reales (letra plana), reparte
 * los RENGLONES a lo largo de la duración total (para que el monitor muestre
 * una línea a la vez, no toda la letra junta) y las palabras DENTRO de cada
 * renglón (para que el canvas pinte las barras y el teleprompter ilumine
 * palabra por palabra en su línea).
 */
function ensureTextLineTimings(segments, totalDuration) {
  if (!Array.isArray(segments) || !segments.length) return segments;

  const starts = segments.map(s => Number.isFinite(s.start) ? s.start : 0);
  const ends = segments.map(s => Number.isFinite(s.end) ? s.end : starts[segments.indexOf(s)]);
  const span = Math.max(...ends) - Math.min(...starts);
  if (span >= 0.8) return segments; // ya tienen tiempos reales

  const dur = (Number.isFinite(totalDuration) && totalDuration > 1)
    ? totalDuration
    : Math.max(3, segments.length * 2.4);
  const usable = Math.max(2, dur - 1.0);
  const step = usable / segments.length;

  return segments.map((seg, i) => {
    const lineStart = 0.5 + i * step;
    const lineEnd = 0.5 + (i + 1) * step;
    const rawWords = (Array.isArray(seg.words) && seg.words.length)
      ? seg.words
      : null;

    let words = [];
    if (rawWords) {
      const totalChars = rawWords.reduce((sum, w) => {
        const txt = (w.text || w.word || "").trim();
        return sum + Math.max(1, txt.length);
      }, 0) || rawWords.length;
      let cursor = lineStart;
      words = rawWords.map((w, wi) => {
        const txt = (w.text || w.word || "").trim();
        const weight = Math.max(1, txt.length) / totalChars;
        let wDur = (lineEnd - lineStart) * weight;
        if (wi === rawWords.length - 1) wDur = Math.max(0.05, lineEnd - cursor);
        const start = Math.round(cursor * 1000) / 1000;
        cursor += wDur;
        const end = Math.round(Math.min(lineEnd, cursor) * 1000) / 1000;
        return {
          word: w.word || w.text || txt,
          text: w.text || w.word || txt,
          start,
          end,
          midi: Number.isFinite(w.midi) ? w.midi : null,
          parte: w.parte || seg.parte || "P1"
        };
      });
    }

    return {
      start: Math.round(lineStart * 1000) / 1000,
      end: Math.round(lineEnd * 1000) / 1000,
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
    items.forEach((w, i) => {
      const span = document.createElement("span");
      span.className = "karaoke-live-word";
      span.dataset.start = String(w.start);
      span.dataset.end = String(w.end);
      span.textContent = (i > 0 ? " " : "") + (w.word || w.text || "");
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

track.onloadedmetadata = () => {
        textSegments = ensureTextLineTimings(karaokeLoadedLyrics, track.duration);
        cargarLetrasEnMonitor();
        drawKaraokeMonitor(track.currentTime || 0, -1, -1);
      };
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

    textSegments = ensureTextLineTimings(karaokeLoadedLyrics, track?.duration);

    cargarLetrasEnMonitor();

    drawKaraokeMonitor(0, -1, -1);

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
  // FIX #19: si por lo que sea la pista se detuvo sin pasar por el onstop
  // (recorder aún en "recording"), finalizamos la grabación aquí y esperamos
  // el blob. Así "Mezclar" funciona aunque el usuario haya "detenido la pista"
  // de cualquier forma.
  if (!karaokeRecordedBlob && karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    console.log("🎤 Mezclar detectó recorder activo; finalizando grabación...");
    stopKaraokeRecording();
    for (let i = 0; i < 10 && !karaokeRecordedBlob; i++) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Dúo: esperar a que P1+P2 se combinen antes de mezclar. Sin esta espera,
  // "Mezclar" podía usar la vista previa temporal de P1 y dejar fuera a P2.
  if (karaokeDuoSplitMode && karaokeDuoP2Active && !karaokeDuoCombined) {
    for (let i = 0; i < 40 && !karaokeDuoCombined; i++) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (!karaokeDuoCombined) {
      alert("⚠️ Aún se están combinando las voces del dúo. Espera unos segundos y vuelve a pulsar Mezclar.");
      return;
    }
  }

  if (!karaokeRecordedBlob) {
    alert("⚠️ Tu voz no se grabó. Pulsa '▶️ Iniciar Grabación', canta, y al terminar presiona '⏹️ Detener'. Luego vuelve a intentar mezclar.");
    return;
  }
  if (!karaokeSelectedTrackBlob) {
    alert("⚠️ No hay pista seleccionada. Elige un karaoke desde la Biblioteca y vuelve a intentar.");
    return;
  }

  // FIX #7: validar que los Blobs no estén vacíos antes de intentar decodificar.
  // Sin esta guarda, un Blob de 0 bytes produce un EncodingError genérico
  // dentro de decodeAudioData(), que el catch de abajo muestra como
  // "Hubo un error al mezclar" sin contexto útil para el usuario.
  const isBlob = (v) => v instanceof Blob;
  if (
    (isBlob(karaokeSelectedTrackBlob) && karaokeSelectedTrackBlob.size === 0) ||
    (isBlob(karaokeRecordedBlob) && karaokeRecordedBlob.size === 0)
  ) {
    alert("⚠️ La pista o la grabación están vacías. Vuelve a grabar tu voz y/o selecciona otra pista.");
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

    // FIX #5: distinguir entre URL remota y Blob/objeto local para evitar
    // TypeError "Failed to fetch" cuando trackFile es un Blob (no string).
    // Antes, trackFile.startsWith("http") crasheaba si trackFile era un Blob
    // local (p.ej. tras usar setKaraokeData con un File del PC).
    let trackArrayBuffer;
    if (trackFile instanceof Blob) {
      trackArrayBuffer = await trackFile.arrayBuffer();
    } else if (typeof trackFile === "string") {
      const fetchOptions = /^https?:\/\//i.test(trackFile) ? { mode: "cors" } : {};
      const response = await fetch(trackFile, fetchOptions);
      if (!response.ok) {
        throw new Error(`No se pudo descargar el archivo de audio base (Código: ${response.status})`);
      }
      const audioBlobFromCloud = await response.blob();
      trackArrayBuffer = await audioBlobFromCloud.arrayBuffer();
    } else {
      throw new Error("Tipo de track no soportado: se esperaba URL (string) o Blob.");
    }

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

    // Balance de la pista: compresor suave para uniformar el volumen base
    const trackCompressor = offlineCtx.createDynamicsCompressor();
    trackCompressor.threshold.value = -14;
    trackCompressor.knee.value = 8;
    trackCompressor.ratio.value = 3;
    trackCompressor.attack.value = 0.005;
    trackCompressor.release.value = 0.2;

    const trackGain = offlineCtx.createGain();
    // FIX #20: equilibrio fijo voz/pista sin procesador vocal: la voz suena un
    // poquito más fuerte que la pista (~55/45). Queda a ~0.45/0.55.
    trackGain.gain.value = 0.45;
    const trackSource = offlineCtx.createBufferSource();
    trackSource.buffer = trackBuffer;
    trackSource.connect(trackCompressor);
    trackCompressor.connect(trackGain);
    trackGain.connect(offlineCtx.destination);

    // Balance de la voz: compresor dinámico para equilibrar el volumen de la voz
    // (reduce picos y sube el nivel promedio), sin depender del volumen del archivo.
    const voiceCompressor = offlineCtx.createDynamicsCompressor();
    voiceCompressor.threshold.value = -18;
    voiceCompressor.knee.value = 10;
    voiceCompressor.ratio.value = 4;
    voiceCompressor.attack.value = 0.003;
    voiceCompressor.release.value = 0.25;

    const voiceGain = offlineCtx.createGain();
    // FIX #20: la voz queda un poco por encima de la pista (55% vs 45%).
    voiceGain.gain.value = 0.55;
    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceCompressor);
    voiceCompressor.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    trackSource.start(0);
    voiceSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const finalWavBlob = await getAudioController().encodeWavToBlob(renderedBuffer);
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

/**
 * Renderiza los segmentos de letras en el monitor del karaoke.
 *
 * Se expone como window.renderKaraokeLyrics porque estudio.js, al ser un módulo
 * dinámico cargado con import(), no puede re-importar este archivo sin crear
 * un ciclo de imports (script.js → showTab → import estudio.js → renderKaraokeLyrics
 * necesita el monitor ya inicializado).
 *
 * Acepta tanto el formato normalizado de karaoke (con .words[]) como el formato
 * plano de segmento de letras (cada item con .text/.start/.end).
 *
 * @param {Array} segments
 */
export function renderKaraokeLyrics(segments) {
  if (!Array.isArray(segments)) {
    console.warn("renderKaraokeLyrics: se esperaba un array de segmentos.");
    return;
  }

  // Reutilizar el normalizador central para aceptar ambos formatos.
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  textSegments = ensureTextLineTimings(normalizeKaraokeSegments(segments), track?.duration);
  baseTextSegments = [...textSegments];

  cargarLetrasEnMonitor();

  // Repintar el canvas en t=0 con pitch neutro. Si el karaoke ya está abierto,
  // usamos el currentTime del reproductor para que el monitor se sincronice
  // visualmente con la posición actual.
  const t = track ? (track.currentTime || 0) : 0;
  drawKaraokeMonitor(t, -1, -1);

  console.log(`📝 [Karaoke] ${textSegments.length} segmentos renderizados en el monitor.`);
}
window.renderKaraokeLyrics = renderKaraokeLyrics;

/**
 * Alias compatible con el flujo de Estudio: mientras la canción suena en el
 * reproductor `studioPlayer`, se llama repetidamente desde script.js para
 * iluminar la línea/palabra activa en el monitor de letras del karaoke.
 *
 * @param {number} currentTime - tiempo de reproducción en segundos
 */
export function updateKaraokeHighlight(currentTime) {
  // `syncKaraokeMonitor` ya hace el trabajo de marcar la línea y palabras
  // activas; simplemente lo delegamos. Mantenemos la firma para que el
  // event-listener de `studioPlayer` en script.js funcione sin cambios.
  if (typeof currentTime !== "number" || !isFinite(currentTime)) return;
  syncKaraokeMonitor(currentTime);
}
window.updateKaraokeHighlight = updateKaraokeHighlight;

window.addEventListener("avatarChanged", () => {
  avatarCache.P1 = null;
  avatarCache.P2 = null;
  avatarImageCache.P1 = null;
  avatarImageCache.P2 = null;

  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  const currentTime = track ? track.currentTime : 0;
  drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);
});
