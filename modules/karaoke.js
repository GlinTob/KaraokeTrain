// drawKaraokeMonitor.js - Módulo autónomo para el monitor de karaoke (Single y Dúo Split)
// Incluye: Dibujo del canvas, detección de pitch, grabación y sincronización con el teleprompter.

import { $ } from '../script.js'; // Asegúrate de que esta ruta sea correcta en tu proyecto

// --- Estado Global del Monitor ---
let karaokeDuoSplitMode = false; // Estado del modo dúo (true = dividido, false = single)
let karaokePitchP1 = -1;         // Pitch detectado del Mic 1
let karaokePitchP2 = -1;         // Pitch detectado del Mic 2
let pitchHistoryP1 = [];         // Historial de pitch para P1
let pitchHistoryP2 = [];         // Historial de pitch para P2
let karaokeMediaRecorder = null;
let karaokeRecordedBlob = null;
let karaokeStream = null;
let karaokeStream2 = null;
let karaokeDuoAudioContext = null;
let karaokeDuoAnalyser1 = null;
let karaokeDuoAnalyser2 = null;
let isPitchDetectionRunning = false;

// --- Configuración del Canvas ---
const MIDI_MIN = 36;
const MIDI_MAX = 84;
const MAX_PITCH_HISTORY = 90; // ~3 segundos a 30fps

// --- Función Principal: drawKaraokeMonitor ---
export async function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2, transcriptionSegments) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Actualizar estado global con los pitch actuales
  if (typeof currentFreq === "number") karaokePitchP1 = currentFreq;
  if (typeof currentFreq2 === "number") karaokePitchP2 = currentFreq2;

  // Calcular paleta de colores según el tema actual
  const paleta = obtenerPaletaTema();

  // Limpiar el canvas
  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Configurar el ancho de la línea de tiempo (playhead)
  const lineX = Math.max(80, Math.floor(canvas.width * 0.22));
  const pixelsPerSecond = (canvas.width - 50) / 6;

  // Datos de las letras (priorizar transcriptionSegments si viene como parámetro)
  const datos = transcriptionSegments || window.transcriptionSegments || [];

  // --- Dibujo según modo ---
  if (karaokeDuoSplitMode) {
    // Modo Dúo: Dividir el canvas en dos regiones
    const TELE_H = 100;
    const GAP = 14;
    const totalUsable = canvas.height - TELE_H - 20;
    const regionH = (totalUsable - GAP) / 2;
    const topP1 = 20;
    const bottomP1 = topP1 + regionH;
    const topP2 = bottomP1 + GAP;
    const bottomP2 = topP2 + regionH;

    // Actualizar historial de pitch
    pitchHistoryP1.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (pitchHistoryP1.length > MAX_PITCH_HISTORY) pitchHistoryP1.shift();
    pitchHistoryP2.push(karaokePitchP2 > 0 ? karaokePitchP2 : null);
    if (pitchHistoryP2.length > MAX_PITCH_HISTORY) pitchHistoryP2.shift();

    // Dibujar región P1
    drawRegion(ctx, topP1, bottomP1, karaokePitchP1, pitchHistoryP1, "P1", paleta, lineX, pixelsPerSecond, datos, "Wen-dolyne", "👩");

    // Dibujar región P2
    drawRegion(ctx, topP2, bottomP2, karaokePitchP2, pitchHistoryP2, "P2", paleta, lineX, pixelsPerSecond, datos, "To-bonito", "🧔🏾");

    // Línea divisoria sutil
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, bottomP1, canvas.width, GAP);

  } else {
    // Modo Single: Una sola región
    const P_TOP = 40;
    const P_BOTTOM = canvas.height - 110;

    // Actualizar historial de pitch (para single, usamos pitchHistoryP1)
    if (!window.pitchHistoryMic1) window.pitchHistoryMic1 = [];
    window.pitchHistoryMic1.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (window.pitchHistoryMic1.length > MAX_PITCH_HISTORY) window.pitchHistoryMic1.shift();

    drawRegion(ctx, P_TOP, P_BOTTOM, karaokePitchP1, window.pitchHistoryMic1, null, paleta, lineX, pixelsPerSecond, datos, null, null);
  }

  // --- Teleprompter (siempre visible en la parte inferior) ---
  if (Array.isArray(datos) && datos.length > 0) {
    const idx = datos.findIndex(s => currentTime >= (s.start || 0) && currentTime <= (s.end || (s.start + 1)));
    if (idx !== -1) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(0, canvas.height - 100, canvas.width, 100);

      ctx.textAlign = "center";
      ctx.fillStyle = "white";
      ctx.font = "bold 30px Arial";

      // Mostrar prefijo de parte si es modo dúo
      const parteActual = datos[idx].parte || "P1";
      const prefijo = karaokeDuoSplitMode ? (parteActual === "DUO" ? "🟪 DÚO · " : (parteActual === "P2" ? "🟧 P2 · " : "🟦 P1 · ")) : "";
      ctx.fillText(prefijo + (datos[idx].text || ""), canvas.width / 2, canvas.height - 65);

      if (datos[idx + 1]) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "italic 22px Arial";
        ctx.fillText(datos[idx + 1].text || "", canvas.width / 2, canvas.height - 25);
      }
    }
  }

  // --- Iniciar detección de pitch si no está corriendo ---
  if (!isPitchDetectionRunning) {
    isPitchDetectionRunning = true;
    startKaraokePitchDetection();
  }
}

// --- Función de Dibujo de Región (Single o Dúo) ---
export function drawRegion(ctx, pTop, pBottom, pitchVal, pitchHist, parteFiltro, paleta, lineX, pixelsPerSecond, datos, nombreAvatar, avatarEmoji) {
  const pHeight = pBottom - pTop;
  const midiToY = (midi) => {
    const val = (midi && midi > 0) ? midi : 60;
    const normalized = (MIDI_MAX - val) / (MIDI_MAX - MIDI_MIN);
    return pTop + (normalized * pHeight);
  };

  // Dibujar avatar y etiquetas (solo en modo dúo)
  if (nombreAvatar && avatarEmoji) {
    drawAvatarBlock(ctx, pTop, pBottom, nombreAvatar, avatarEmoji, paleta);
  }

  // Dibujar pentagrama
  ctx.strokeStyle = paleta.lineas;
  ctx.lineWidth = 1;
  const numLines = 10;
  for (let i = 0; i <= numLines; i++) {
    const y = pTop + (pHeight / numLines) * i;
    ctx.beginPath();
    ctx.moveTo(35, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Dibujar etiquetas de notas
  ctx.fillStyle = paleta.etiquetas;
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "right";
  const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
  noteLabels.forEach((label, i) => {
    const y = pTop + (pHeight / numLines) * i + 7;
    ctx.fillText(label, 28, y);
  });

  // Dibujar barras de notas
  if (Array.isArray(datos) && datos.length > 0) {
    datos.forEach((seg) => {
      // Filtrar por parte en modo dúo
      const parteSeg = seg.parte || "P1";
      if (parteFiltro && parteSeg !== parteFiltro && parteSeg !== "DUO") return;

      const words = Array.isArray(seg.words) ? seg.words : [];
      words.forEach(w => {
        const start = w.start || w.startTime || seg.start || 0;
        const end = w.end || (start + (w.duration || 0.5));
        if (end < currentTime - 1 || start > currentTime + (canvas.width / pixelsPerSecond)) return;

        const x = lineX + (start - currentTime) * pixelsPerSecond;
        const width = (end - start) * pixelsPerSecond;
        const midi = w.midi || seg.midi || 60;
        const y = midiToY(midi);
        const h = 24;

        const isActive = currentTime >= start && currentTime <= end;
        const isPast = currentTime > end;

        let barColor = paleta.barraFutura;
        let strokeColor = paleta.bordeFuturo;

        // Estilos para DUO y P2
        if (parteSeg === "DUO") {
          barColor = "#7c3aed";
          strokeColor = "#a855f7";
        } else if (parteSeg === "P2") {
          barColor = "#9a3412";
          strokeColor = "#f97316";
        }

        if (isPast) barColor = "#4b5563";

        if (isActive) {
          const userMidi = Math.round(12 * Math.log2(pitchVal / 440) + 69);
          const isCorrect = pitchVal > 0 && Math.abs(userMidi - midi) <= 2;
          barColor = isCorrect ? "#22c55e" : strokeColor;
          strokeColor = "white";
        }

        ctx.fillStyle = barColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y - h / 2, Math.max(width, 25), h, 5);
        else ctx.fillRect(x, y - h / 2, Math.max(width, 25), h);
        ctx.fill();

        if (isActive || !isPast) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = isActive ? 3 : 1;
          ctx.stroke();
        }

        ctx.fillStyle = "white";
        ctx.font = `bold 16px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(w.word || w.text || "", x + Math.max(width, 25) / 2, y + 5);
      });
    });
  }

  // Dibujar rastro y punto de pitch
  if (pitchVal > 0) {
    const userMidi = Math.round(12 * Math.log2(pitchVal / 440) + 69);
    const userY = midiToY(userMidi);

    // Rastro
    ctx.beginPath();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
    ctx.lineWidth = 4;
    let started = false;
    pitchHist.forEach((f, i) => {
      if (f) {
        const x = lineX - (pitchHist.length - i) * 3;
        const yPos = midiToY(Math.round(12 * Math.log2(f / 440) + 69));
        if (x < 35) return;
        if (!started) { ctx.moveTo(x, yPos); started = true; } else { ctx.lineTo(x, yPos); }
      }
    });
    ctx.stroke();

    // Punto
    ctx.beginPath();
    ctx.fillStyle = "#facc15";
    ctx.arc(lineX, userY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Línea roja (Ahora)
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lineX, pTop - 2);
  ctx.lineTo(lineX, pBottom + 2);
  ctx.stroke();
}

// --- Función de Dibujo del Avatar (solo en modo dúo) ---
export function drawAvatarBlock(ctx, pTop, pBottom, nombre, avatarEmoji, paleta) {
  const cx = 55;
  const blockTop = pTop + 10;
  const avatarSize = 56;
  const halfSize = 28;
  const nameH = 22;
  const gap = 6;

  // Nombre
  ctx.fillStyle = "white";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(nombre, cx, blockTop + nameH - 4);

  // Avatar
  const avTop = blockTop + nameH + gap;
  ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);

  // Íconos
  const rowTop = avTop + avatarSize + gap;
  const iconHalfFont = `${halfSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (nombre === "Wen-dolyne") {
    // Izquierda: cuadrado morado
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(cx - halfSize - gap / 2, rowTop, halfSize, halfSize);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - halfSize - gap / 2, rowTop, halfSize, halfSize);
    // Derecha: átomo
    ctx.fillStyle = "white";
    ctx.fillText("⚛️", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  } else {
    // Izquierda: gato
    ctx.fillStyle = "white";
    ctx.fillText("🐱", cx - halfSize / 2 - gap / 2, rowTop + halfSize / 2);
    // Derecha: pensativo
    ctx.fillText("🤔", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  }

  ctx.textBaseline = "alphabetic";
}

// --- Función para obtener la paleta de colores según el tema ---
export function obtenerPaletaTema() {
  const temaActual = localStorage.getItem("vocalApp_stage") || "theme-clasico";
  // Valor por defecto (theme-clasico o si falla el switch)
  let config = { fondo: "#111827", lineas: "#333333", etiquetas: "#666666", barraFutura: "#1e40af", bordeFuturo: "#3b82f6" };

  switch (temaActual) {
    case "theme-moderno":
      config = { fondo: "#082f49", lineas: "rgba(6, 182, 212, 0.2)", etiquetas: "#06b6d4", barraFutura: "#1e3a8a", bordeFuturo: "#06b6d4" };
      break;
    case "theme-disco":
      config = { fondo: "#2e1065", lineas: "rgba(219, 39, 119, 0.25)", etiquetas: "#facc15", barraFutura: "#701a75", bordeFuturo: "#db2777" };
      break;
    case "theme-acustico":
      config = { fondo: "#451a03", lineas: "rgba(120, 53, 15, 0.4)", etiquetas: "#fcd34d", barraFutura: "#78350f", bordeFuturo: "#b45309" };
      break;
    case "theme-fiesta":
      // Corrección: Solo la lógica válida
      const hue = (Date.now() / 20) % 360;
      config = {
        fondo: `hsl(${hue}, 40%, 12%)`,
        lineas: "rgba(255, 255, 255, 0.15)",
        etiquetas: "#ff007f",
        barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`,
        bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)`
      };
      break;
    // Opcional: Manejar casos no definidos explícitamente si no se usa el default de arriba
    default:
      break; 
  }
  return config;
}   

// --- Función para iniciar la detección de pitch ---
export async function startKaraokePitchDetection() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Obtener micrófono seleccionado
  const micId = getSelectedMicId(1);

  const audioConstraints = {
    audio: micId ? { deviceId: { exact: micId } } : true
  };

  const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
  const mic = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);

  // Si el Modo Dúo Split está activo, intentamos abrir Mic 2 en paralelo
  if (karaokeDuoSplitMode) {
    await ensureP2PitchTracking();
  }

  function loop() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  const currentTime = track ? track.currentTime : 0;

  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  const pitch = autoCorrelate(buffer, audioCtx.sampleRate);

  let pitch2 = -1;
  if (karaokeDuoSplitMode && karaokeSplitAnalyser2) {
    const buf2 = new Float32Array(karaokeSplitAnalyser2.fftSize);
    karaokeSplitAnalyser2.getFloatTimeDomainData(buf2);
    pitch2 = autoCorrelate(buf2, karaokeSplitAudioCtx.sampleRate);
  }

  // --- 🔒 PROTECCIÓN ANTES DE LLAMAR A drawKaraokeMonitor ---
  const canvas = $("karaokeCanvas");
  if (!canvas) {
    console.warn("[Pitch Detection] El canvas #karaokeCanvas no está disponible. Saltando dibujo.");
    // No llamamos a drawKaraokeMonitor si no hay canvas
    if (karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") {
      requestAnimationFrame(loop);
    }
    return;
  }

  // Llamar a la función principal de dibujo
  drawKaraokeMonitor(currentTime, pitch, pitch2);

  // Si la pista terminó, paramos
  if (track && track.ended) return;

  // Seguimos el loop mientras se graba
  if (karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") {
    requestAnimationFrame(loop);
  }
}
// --- Función para asegurar la detección de pitch en el Mic 2 ---
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
      audio: { deviceId: { exact: mic2Id }, echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }
    });
    const src2 = karaokeSplitAudioCtx.createMediaStreamSource(karaokeSplitStream2);
    karaokeSplitAnalyser2 = karaokeSplitAudioCtx.createAnalyser();
    karaokeSplitAnalyser2.fftSize = 2048;
    src2.connect(karaokeSplitAnalyser2);
    console.log("[DuoSplit] Pitch tracking del Mic 2 iniciado");
  } catch (e) {
    console.warn("No se pudo iniciar pitch del Mic 2 (P2):", e);
  }
}

// --- Función para detener la detección de pitch en el Mic 2 ---
function stopP2PitchTracking() {
  try {
    // Sólo paramos el stream si NOSOTROS lo abrimos
    if (karaokeSplitStream2) {
      karaokeSplitStream2.getTracks().forEach(t => t.stop());
    }
  } catch (e) {}
  karaokeSplitStream2 = null;
  karaokeSplitAnalyser2 = null;
  karaokePitchP2 = -1;
  pitchHistoryP2 = [];
}

// --- Función para iniciar la grabación ---
async function startKaraokeRecording() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");

  if (!karaokeSelectedTrackBlob || !karaokeLoadedItem) {
    alert("⚠️ Primero selecciona un karaoke de la lista.");
    return;
  }

  if (!track) {
    alert("⚠️ No se encontró el reproductor de karaoke.");
    return;
  }

  try {
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    karaokeChunks = [];
    karaokeRecordedBlob = null;
    $("karaokeVoicePlayer").src = "";

    const mic1Id = getSelectedMicId(1);
    const mic2Id = getSelectedMicId(2);

    const audioConstraints1 = {
      echoCancellation: { exact: false },
      noiseSuppression: { exact: false },
      autoGainControl: { exact: false },
      channelCount: 1,
      sampleRate: 48000
    };

    if (mic1Id) {
      audioConstraints1.deviceId = { exact: mic1Id };
    }

    karaokeStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints1
    });

    let finalStream = karaokeStream;

    if (isDuo && mic2Id) {
      const audioConstraints2 = {
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
        channelCount: 1,
        sampleRate: 48000,
        deviceId: { exact: mic2Id }
      };

      karaokeStream2 = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints2
      });

      karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();

      const source1 = karaokeDuoAudioContext.createMediaStreamSource(karaokeStream);
      const source2 = karaokeDuoAudioContext.createMediaStreamSource(karaokeStream2);

      karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser2 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser1.fftSize = 2048;
      karaokeDuoAnalyser2.fftSize = 2048;
      karaokeDuoAnalyser1.smoothingTimeConstant = 0.8;
      karaokeDuoAnalyser2.smoothingTimeConstant = 0.8;

      const merger = karaokeDuoAudioContext.createChannelMerger(2);
      const destination = karaokeDuoAudioContext.createMediaStreamDestination();

      source1.connect(karaokeDuoAnalyser1);
      source2.connect(karaokeDuoAnalyser2);
      karaokeDuoAnalyser1.connect(merger, 0, 0);
      karaokeDuoAnalyser2.connect(merger, 0, 1);
      merger.connect(destination);

      finalStream = destination.stream;

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) duoIndicator.style.display = "block";

      startKaraokeDuoLevelMonitor();
    }

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};

    karaokeMediaRecorder = new MediaRecorder(finalStream, options);

    karaokeMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) karaokeChunks.push(e.data);
    };

    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      $("karaokeVoicePlayer").src = URL.createObjectURL(karaokeRecordedBlob);
      $("karaokeStatus").textContent = "Estado: Grabación finalizada ✅";

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) duoIndicator.style.display = "none";

      stopKaraokeDuoLevelMonitor();
    };

    karaokeMediaRecorder.start();

    track.pause();
    track.currentTime = 0;
    await track.play();

    startKaraokePitchDetection();

    const mic1Select = $("mic1Select");
    const mic1Name = mic1Select ? mic1Select.options[mic1Select.selectedIndex]?.text : "Mic 1";

    if (isDuo && mic2Id) {
      const mic2Select = $("mic2Select");
      const mic2Name = mic2Select ? mic2Select.options[mic2Select.selectedIndex]?.text : "Mic 2";
      $("karaokeStatus").textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name}) con "${karaokeSelectedTrackName}"...`;
    } else {
      $("karaokeStatus").textContent = `Estado: 🔴 Grabando con ${mic1Name} sobre "${karaokeSelectedTrackName}"...`;
    }

    $("karaokeStartBtn").disabled = true;
  } catch (err) {
    console.error(err);
    alert("❌ Error al acceder al micrófono. Verifica en Configuración.");
  }
}

// --- Función para detener la grabación ---
function stopKaraokeRecording() {
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    karaokeMediaRecorder.stop();
  }

  // Detener Mic 1
  if (karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
  }

  // Detener Mic 2 (si existe)
  if (karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  // Cerrar contexto de audio dúo
  if (karaokeDuoAudioContext) {
    karaokeDuoAudioContext.close();
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;

  // Detener el segundo Mic abierto por el modo Dúo Split (si aplica)
  stopP2PitchTracking();

  stopKaraokeDuoLevelMonitor();

  // Ocultar indicador
  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) {
    duoIndicator.style.display = "none";
  }

  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  if (track) track.pause();

  $("karaokeStartBtn").disabled = false;
}

// --- Función para reiniciar la grabación ---
function restartKaraokeRecording() {
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");

  if (track) {
    track.pause();
    track.currentTime = 0;
  }

  $("karaokeVoicePlayer").src = "";
  karaokeChunks = [];
  karaokeRecordedBlob = null;
  $("karaokeStatus").textContent = "Estado: Esperando para grabar...";
  $("karaokeStartBtn").disabled = false;
}

// --- Función para mezclar la voz y la pista ---
async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) {
    alert("⚠️ Primero presiona 'Cantar' en un karaoke y luego graba tu voz.");
    return;
  }

  const trackFile = karaokeSelectedTrackBlob;
  const btn = $("karaokeMixBtn");
  const resultDiv = $("karaokeMixResult");

  btn.textContent = "🎧 Mezclando audios... ⏳";
  btn.disabled = true;
  resultDiv.innerHTML = "<p style='color: var(--text-muted);'>Uniendo la pista y tu voz. Esto puede tardar unos segundos...</p>";

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const fetchOptions = trackFile.startsWith("http") ? { mode: "cors" } : {};
    const response = await fetch(trackFile, fetchOptions);

    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo de audio base (Código: ${response.status})`);
    }
    const audioBlobFromCloud = await response.blob();

    const trackArrayBuffer = await audioBlobFromCloud.arrayBuffer();
    const trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer);

    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer();
    const voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer);

    const offlineCtx = new OfflineAudioContext(
      trackBuffer.numberOfChannels,
      trackBuffer.length,
      trackBuffer.sampleRate
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

    $("saveMixToLibBtn").onclick = async () => {
      const btnSave = $("saveMixToLibBtn");
      btnSave.textContent = "Guardando...";
      btnSave.disabled = true;

      await saveToLibrary(finalWavBlob, {
        name: `Mezcla - ${karaokeSelectedTrackName || "Canción"}`,
        type: "grabacion"
      });

      btnSave.textContent = "✅ ¡Guardado en Biblioteca!";
    };
  } catch (err) {
    console.error("Error al mezclar:", err);
    resultDiv.innerHTML = "<p style='color: #ef4444;'>❌ Hubo un error al mezclar los audios.</p>";
  } finally {
    btn.textContent = "🎧 Mezclar Pista + Voz";
    btn.disabled = false;
  }
}

// --- Función para cargar una canción de karaoke ---
async function loadKaraokeSong(id) {
  try {
    // Limpiar variables del monitor
    if (typeof limpiarVariablesMonitor === "function") {
      limpiarVariablesMonitor();
    }

    const item = await getLibraryItemByIdFromSupabase(id);
    if (!item) {
      alert("⚠️ No se encontró el karaoke.");
      return;
    }

    const urlAudioCloud = item.file_url || item.karaoke;
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

    if (Array.isArray(item.transcription) && item.transcription.length) {
      transcriptionSegments = item.transcription;
      karaokeLoadedLyrics = item.transcription;
    } else if (Array.isArray(item.lyrics) && item.lyrics.length) {
      transcriptionSegments = item.lyrics;
      karaokeLoadedLyrics = item.lyrics;
    } else {
      transcriptionSegments = [];
      karaokeLoadedLyrics = [];
    }

    cargarLetrasEnMonitor();

    const status = $("karaokeStatus");
        if (status) {
      status.textContent = `Estado: "${item.name}" cargada. ¡A cantar! 🎤`;
    }

    console.log("✅ Karaoke cargado desde Supabase con éxito", {
      id: item.id,
      name: item.name,
      trackSrc: track?.src,
      tapModeStyle: window.currentTapSyncModeType,
      datasetLoaded: track?.dataset?.karaokeLoaded
    });

  } catch (error) {
    console.error("Error cargando karaoke:", error);
    alert("❌ Error al cargar el karaoke.");
  }
}

// --- Función para limpiar las variables del monitor ---
function limpiarVariablesMonitor() {
  transcriptionSegments = [];
  baseTranscriptionSegments = [];
  textSegments = [];
  baseTextSegments = [];
  console.log("🧼 Variables del monitor de letras reseteadas");
}

// --- Función para cargar las letras en el monitor ---
function cargarLetrasEnMonitor() {
  const container = document.getElementById("karaokeLiveLyrics");
  if (!container) return;

  if (!window.transcriptionSegments || window.transcriptionSegments.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size: 16px; text-align: center;">⚠️ Monitor en reposo. Carga una pista instrumental o sincronizada.</p>`;
    return;
  }

  container.innerHTML = "";
  window.transcriptionSegments.forEach(seg => {
    const p = document.createElement("p");
    p.className = "karaoke-live-line";
    p.textContent = seg.text || "";
    container.appendChild(p);
  });
}

// --- Función para sincronizar el monitor con el tiempo actual ---
function syncKaraokeMonitor(time) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length || !window.transcriptionSegments) return;

  window.transcriptionSegments.forEach((seg, i) => {
    const el = lines[i];
    if (!el) return;
    el.classList.remove("active", "past", "upcoming");
    if (time >= seg.start && time <= seg.end + 0.5) el.classList.add("active");
    else if (time > seg.end) el.classList.add("past");
    else el.classList.add("upcoming");
  });
}

// --- Función para actualizar el resaltado de las letras ---
function updateKaraokeHighlight(time) {
  const container = document.getElementById("karaokeLyrics");
  if (!container || !window.transcriptionSegments) return;

  container.innerHTML = "";
  window.transcriptionSegments.forEach(seg => {
    const p = document.createElement("p");
    p.className = "karaoke-line";
    if (time >= seg.start && time <= seg.end + 0.5) p.className += " active";
    p.textContent = seg.text || "";
    container.appendChild(p);
  });
}

// --- Función para parsear un archivo UltraStar .txt ---
function parseUltrastarTxt(content) {
  const lines = content.split("\n");
  const metadata = {};
  const notes = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }

    if (trimmed.match(/^[:*F\-]/)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0];

      if (type === "-") continue;

      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        const syllable = parts.slice(4).join(" ");

        notes.push({
          type: type,
          startBeat: startBeat,
          duration: duration,
          pitch: pitch,
          syllable: syllable
        });
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
    notes: notes
  };
}

// --- Función para convertir un archivo UltraStar a segmentos ---
export function ultrastarToSegments(parsed) {
  if (!parsed || !parsed.notes || !parsed.notes.length) return [];

  const bpm = parsed.bpm;
  const gap = parsed.gap / 1000;
  const beatDuration = 60 / bpm / 4;

  const segments = [];
  let currentWords = [];
  let lastEndBeat = 0;

  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    const midiNote = 60 + parseInt(note.pitch, 10);

    if (note.startBeat - lastEndBeat > 8 && currentWords.length > 0) {
      segments.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map(w => w.word).join(""),
        words: currentWords,
        midi: currentWords[0].midi,
        note: currentWords[0].note
      });
      currentWords = [];
    }

    currentWords.push({
      word: note.syllable,
      start: startTime,
      end: endTime,
      midi: midiNote,
      note: safeGetNoteName(midiNote)
    });

    lastEndBeat = note.startBeat + note.duration;
  }

  if (currentWords.length > 0) {
    segments.push({
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(""),
      words: currentWords,
      midi: currentWords[0].midi,
      note: currentWords[0].note
    });
  }

  return segments;
}

// --- Función para obtener el nombre de una nota a partir de un MIDI ---
export function safeGetNoteName(midi) {
  const nombres = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${nombres[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// --- Función para cargar una pista de karaoke desde un archivo ---
export async function cargarPistaKaraoke(e) {
  const archivos = e.target.files;
  if (!archivos || archivos.length === 0) return;

  const statusEl = document.getElementById("karaokeStatus");
  const trackPlayer = document.getElementById("karaokeTrack");

  const archivoAudio = Array.from(archivos).find(file => file.type.startsWith("audio/"));
  const archivoTxt = Array.from(archivos).find(file => file.name.endsWith(".txt") || file.type === "text/plain");

  try {
    if (archivoAudio) {
      if (statusEl) statusEl.textContent = `Estado: Cargando audio instrumental... ⏳`;
      if (trackPlayer) {
        trackPlayer.src = URL.createObjectURL(archivoAudio);
        trackPlayer.dataset.name = archivoAudio.name;
      }
    }

    if (archivoTxt) {
      if (statusEl) statusEl.textContent = "Estado: Parseando partituras UltraStar... ⏳";
      const contenidoTxt = await archivoTxt.text();
      const datosParseados = parseUltrastarTxt(contenidoTxt);
      window.transcriptionSegments = ultrastarToSegments(datosParseados);
      cargarLetrasEnMonitor();
      console.log("🚀 [Karaoke] Letras .txt de UltraStar cargadas, escalonadas y sincronizadas en el Canvas.");
    }

    if (statusEl) statusEl.textContent = `Estado: 🎧 Pista lista (${archivoAudio ? archivoAudio.name : "Archivo local"}). Presiona Iniciar para cantar.`;
  } catch (error) {
    console.error(error);
    if (statusEl) statusEl.textContent = "Estado: ❌ Error cargando los archivos locales";
  }
}

// --- Función para alternar el modo dúo split ---
export function toggleKaraokeDuoSplitMode() {
  karaokeDuoSplitMode = !karaokeDuoSplitMode;
  const btn = $("karaokeDuoSplitToggleBtn");
  if (btn) {
    btn.textContent = karaokeDuoSplitMode ? "🎤🎤 Modo Dúo Split: ON" : "🎤🎤 Modo Dúo Split: OFF";
    btn.style.background = karaokeDuoSplitMode ? "#22c55e" : "#3b82f6";
  }

  // --- 🔒 PROTECCIÓN CRÍTICA: NO DIBUJES SI NO EXISTE EL CANVAS ---
  const canvas = $("karaokeCanvas");
  if (!canvas) {
    console.warn("⚠️ El canvas #karaokeCanvas no está disponible. No se puede repintar el monitor.");
    return; // Salimos aquí para evitar el error
  }

  // Re-pintar el canvas solo si existe
  if (typeof drawKaraokeMonitor === "function") {
    const track = $("karaokeTrack");
    const t = track ? track.currentTime : 0;
    drawKaraokeMonitor(t, karaokePitchP1, karaokePitchP2);
  }
}
