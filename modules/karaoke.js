import { $, safeAdd } from "../script.js";
import { getLibraryItemsByIdFromSupabase } from "./biblioteca.js";
import { getAudioController, destroyAudioController, exportStereoWav, interleave } from "./audio-controller.js";
import { startLiveAudio, stopLiveAudio, getLiveAudioState, setMonitoringEnabled } from "./liveAudioService.js";
import { noteToFrequency, frequencyToMidi, midiToNoteName, frequencyToNoteName } from "./afinador.js";



let textSegments = [];
let baseTextSegments = [];
let karaokeLoadedLyrics = [];
let pitchHistory = [];
let karaokeAudioController = null;
let karaokeLoopBusy = false;
let karaokePitchDetectionAudioCtx = null;
let karaokePitchDetectionAnalyser = null;
let karaokeSplitAnalyser2 = null;
let karaokeSplitAudioCtx2 = null;
let karaokeSplitSource2 = null;
let sr2 = null;
let karaokePitchLoopRafId = null;
let karaokePitchSourceNode = null;
let karaokePitchWorkletNode = null;
let karaokeSelectedTrackBlob = null;
let karaokeLoadedItem = null;
let karaokeSelectedTrackName = "";
let karaokeDuoSplitMode = false;
let pitchHistoryP1 = [];
let pitchHistoryP2 = [];
let karaokePitchP1 = -1;
let karaokePitchP2 = -1;
let karaokeChunks = [];
let karaokeRecordedBlob = null;
let karaokeMediaRecorder = null;
let getSelectedMicId = null;
let karaokeStream = null;
let karaokeStream2 = null;
let finalStream = null;
let stopKaraokeDuoLevelMonitor = null;
let karaokeDuoAudioContext = null;
let karaokeDuoAnalyser1 = null;
let karaokeDuoAnalyser2 = null;

export function toggleKaraokeDuoSplitMode() {
  karaokeDuoSplitMode = !karaokeDuoSplitMode;
  const btn = $("karaokeDuoSplitToggleBtn");
  if (btn) {
    btn.textContent = karaokeDuoSplitMode ? "🎤🎤 Modo Dúo Split: ON" : "🎤🎤 Modo Dúo Split: OFF";
    btn.style.background = karaokeDuoSplitMode ? "#22c55e" : "#3b82f6";
  }
}

// Reset de históricos para evitar arrastre visual raro
pitchHistory = [];
pitchHistoryP1 = [];
pitchHistoryP2 = [];


// 1. Definición de Temas (VITAL para no perder opciones)
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
  const paleta = obtenerPaleta((currentTime * 50) % 360);
}

function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (typeof drawKaraokeMonitor === "function") {
  // Redibujar inmediatamente aunque no haya grabación en curso
  const track = $("karaokeTrack") || $("karaokeAudio") || $("audioKaraoke") || $("trackPlayer");
  const currentTime = track ? track.currentTime : 0;

  drawKaraokeMonitor(currentTime, karaokePitchP1 || -1, karaokePitchP2 || -1);
  }
  // Actualizar frecuencias globales
  if (typeof currentFreq === "number") karaokePitchP1 = currentFreq;
  if (typeof currentFreq2 === "number") karaokePitchP2 = currentFreq2;

  const AVATAR_BLOCK_W = karaokeDuoSplitMode ? 110 : 0;
  const noteLabelsX = 28 + AVATAR_BLOCK_W;
  const pentagramStartX = 35 + AVATAR_BLOCK_W;
  const dynLineX = lineX + AVATAR_BLOCK_W;

   // 2. Limpiar Canvas
  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawAvatarBlock(pTop, pBottom, parte) {
  if (!parte || parte === "DUO") return;
  const isP1 = (parte === "P1");
  const nombre = isP1 ? "Wen-dolyne" : "To-bonito";
  // P1: mujer. P2: persona con barba + piel morena (forma compacta sin ZWJ
  // para evitar que algunos sistemas pinten un ♂ extra al lado).
  const avatarEmoji = isP1 ? "👩" : "🧔🏾";

  const cx = 5 + AVATAR_BLOCK_W / 2;
  const blockTop = pTop + 10;
  const avatarSize = 56;
  const halfSize = 28; // mitad del tamaño original del cuadrado
  const nameH = 22;
  const gap = 6;

  // 1) Nombre (arriba)
  ctx.fillStyle = "white";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(nombre, cx, blockTop + nameH - 4);

  // 2) Avatar emoji (centro, sin círculo de fondo)
  const avTop = blockTop + nameH + gap;
  ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);

  // 3) Fila inferior con dos íconos al lado (cada uno de halfSize)
  const rowTop = avTop + avatarSize + gap;
  const iconHalfFont = `${halfSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;

  if (isP1) {
    // Izquierda: cuadrado morado (mitad de tamaño)
    const sqX = cx - halfSize - gap / 2;
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(sqX, rowTop, halfSize, halfSize);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1;
    ctx.strokeRect(sqX, rowTop, halfSize, halfSize);
    // Derecha: átomo ⚛️
    ctx.font = iconHalfFont;
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("⚛️", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  } else {
    // Izquierda: cara de gato 🐱 (mitad de tamaño)
    ctx.font = iconHalfFont;
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("🐱", cx - halfSize / 2 - gap / 2, rowTop + halfSize / 2);
    // Derecha: hombre pensante 🤔
    ctx.fillText("🤔", cx + halfSize / 2 + gap / 2, rowTop + halfSize / 2);
  }
  // Reset baseline para no romper otros dibujos
  ctx.textBaseline = "alphabetic";
}

function drawRegion(pTop, pBottom, pVal, pHist, filtro, etiqueta, paleta, currentTime) {
  const canvas = $("karaokeCanvas");
  const ctx = canvas.getContext("2d");
  const pHeight = pBottom - pTop;
  const pixelsPerSecond = (canvas.width - 150) / 7;
  const dynLineX = 80 + (karaokeDuoSplitMode ? 110 : 0);
  const pentagramStartX = 35 + (karaokeDuoSplitMode ? 110 : 0);
  const midiToY = (midi) => pTop + ((84 - (midi > 0 ? midi : 60)) / (84 - 36) * pHeight);

  // Avatar block (sólo en split mode)
  drawAvatarBlock(pTop, pBottom, etiquetaParte);

  // Pentagrama
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

  // Notas a la izquierda
  ctx.fillStyle = paleta.etiquetas;
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "right";
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
        const y = midiToY(w.midi || seg.midi || 60);
      
        let color = paleta.barraFutura;
        if (currentTime >= w.start && currentTime <= w.end && pVal > 0) {
          const userMidi = Math.round(12 * Math.log2(pVal / 440) + 69);
          if (Math.abs(userMidi - (w.midi || 60)) <= 2) color = "#22c55e"; 
        }
        if (currentTime > w.end) color = "#4b5563";

        const isActive = currentTime >= start && currentTime <= end;
        const isPast = currentTime > end;

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
          ctx.font = `bold ${paleta.tamanoTexto || "15px"} Arial`;
          ctx.textAlign = "center";
          ctx.fillText(w.word || w.text || "", x + Math.max(width, 25) / 2, y + 5);
        });
      });
    }

    // Rastro de pitch y punto del usuario (por región)
    if (pitchVal > 0) {
      const userMidi = Math.round(12 * Math.log2(pitchVal / 440) + 69);
      const userY = midiToY(userMidi);

      ctx.beginPath();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
      ctx.lineWidth = 4;
      let started = false;
      pitchHist.forEach((f, i) => {
        if (f) {
          const x = dynLineX - (pitchHist.length - i) * 3;
          const yPos = midiToY(Math.round(12 * Math.log2(f / 440) + 69));
          if (x < pentagramStartX) return;
          if (!started) { ctx.moveTo(x, yPos); started = true; } else { ctx.lineTo(x, yPos); }
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

    // Línea roja (Ahora) que cruza solo esta región
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dynLineX, pTop - 2);
    ctx.lineTo(dynLineX, pBottom + 2);
    ctx.stroke();
  
  if (karaokeDuoSplitMode) {
    const TELE_H = 100; 
    const GAP = 20;
    const regionH = (canvas.height - TELE_H - 40) / 2;
    
    // Actualizar históricos individuales
    pitchHistoryP1.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (pitchHistoryP1.length > 80) pitchHistoryP1.shift();
    pitchHistoryP2.push(karaokePitchP2 > 0 ? karaokePitchP2 : null);
    if (pitchHistoryP2.length > 80) pitchHistoryP2.shift();

    // DIBUJAR AMBAS REGIONES
    drawRegion(20, 20 + regionH, karaokePitchP1, pitchHistoryP1, "P1", "P1", paleta, currentTime);
    drawRegion(20 + regionH + GAP, 20 + regionH * 2 + GAP, karaokePitchP2, pitchHistoryP2, "P2", "P2", paleta, currentTime);
    
  } else {
    pitchHistory.push(karaokePitchP1 > 0 ? karaokePitchP1 : null);
    if (pitchHistory.length > 80) pitchHistory.shift();
    drawRegion(20, canvas.height - 110, karaokePitchP1, pitchHistory, null, null, paleta, currentTime);
  }
  if (Array.isArray(textSegments)) {
    textSegments.forEach(seg => {
      const idx = datos.findIndex(s => currentTime >= (s.start || 0) && currentTime <= (s.end || (s.start + 1)));
      if (idx !== -1) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(0, canvas.height - 100, canvas.width, 100);
  
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.font = "bold 30px Arial";

        // En split, mostramos también la parte cantando
        const parteActual = datos[idx].parte || "P1";
        const prefijo = karaokeDuoSplitMode ? (parteActual === "DUO" ? "🟪 DÚO · " : (parteActual === "P2" ? "🟧 P2 · " : "🟦 P1 · ")) : "";
        ctx.fillText(prefijo + (datos[idx].text || ""), canvas.width / 2, canvas.height - 65);
        
        if (datos[idx + 1]) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "italic 22px Arial";
          ctx.fillText(datos[idx + 1].text || "", canvas.width / 2, canvas.height - 25);
        }
      }
    });
  }
}
  
export async function startKaraokeRecording() {
  try {
    // 1. Obtener micrófonos
    const micId1 = typeof getSelectedMicId === "function" ? getSelectedMicId() : null;
    karaokeStream = await navigator.mediaDevices.getUserMedia({ audio: micId1 ? { deviceId: micId1 } : true });

    // 2. AudioContext y Carga de Procesador
    karaokePitchDetectionAudioCtx = new AudioContext();
    await karaokePitchDetectionAudioCtx.audioWorklet.addModule('./modules/vocal-processor.js');

    // 3. Configurar Cantante 1
    const source1 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream);
    karaokePitchWorkletNode = new AudioWorkletNode(karaokePitchDetectionAudioCtx, 'vocal-processor');
    
    karaokePitchWorkletNode.port.onmessage = (e) => {
      if (e.data.volume !== undefined) {
        const bar = document.querySelector('.mic-tester-card .mic-level-fill');
        if (bar) bar.style.width = (e.data.volume * 100) + '%';
      }
    };
    source1.connect(karaokePitchWorkletNode).connect(karaokePitchDetectionAudioCtx.destination);

    // 4. Configurar Cantante 2 (Dúo)
    if (karaokeDuoSplitMode) {
      const micId2 = document.getElementById("micSelect2")?.value;
      karaokeStream2 = await navigator.mediaDevices.getUserMedia({ audio: micId2 ? { deviceId: micId2 } : true });
      const source2 = karaokePitchDetectionAudioCtx.createMediaStreamSource(karaokeStream2);
      const proc2 = new AudioWorkletNode(karaokePitchDetectionAudioCtx, 'vocal-processor');
      
      proc2.port.onmessage = (e) => {
        if (e.data.volume !== undefined) {
          const fills = document.querySelectorAll('.mic-level-fill');
          if (fills[1]) fills[1].style.width = (e.data.volume * 100) + '%';
        }
      };
      source2.connect(proc2).connect(karaokePitchDetectionAudioCtx.destination);
    }

    startKaraokePitchDetection();
  } catch (err) {
    console.error("Error al iniciar karaoke:", err);
  }
}
export async function startKaraokePitchDetection() {
  // Limpiar sesión previa
  if (karaokePitchLoopRafId) {
    cancelAnimationFrame(karaokePitchLoopRafId);
    karaokePitchLoopRafId = null;
  }

  if (karaokePitchWorkletNode) {
    try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
    karaokePitchWorkletNode = null;
  }

  if (karaokePitchSourceNode) {
    try { karaokePitchSourceNode.disconnect(); } catch (e) {}
    karaokePitchSourceNode = null;
  }

  if (karaokePitchDetectionAudioCtx) {
    try {
      if (karaokePitchDetectionAudioCtx.state !== "closed") {
        await karaokePitchDetectionAudioCtx.close();
      }
    } catch (e) {}
    karaokePitchDetectionAudioCtx = null;
  }

  if (!karaokeStream) {
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
        window.VOCAL_PROCESSOR_URL ||
        new URL("./vocal-processor.js", import.meta.url).href;
  
      await audioCtx.audioWorklet.addModule(vocalProcessorUrl);
  
      karaokePitchWorkletNode = new AudioWorkletNode(audioCtx, "vocal-processor");
  
      if (typeof updateVocalProcessorParams === "function") {
        updateVocalProcessorParams(karaokePitchWorkletNode);
      } else {
        console.warn("⚠️ updateVocalProcessorParams no está disponible. Se usarán parámetros por defecto.");
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

  // Dentro de startKaraokePitchDetection, después de configurar P1:
  if (karaokeDuoSplitMode && karaokeStream2) {
    // Usar el mismo AudioContext para evitar problemas de sincronización
    const source2 = audioCtx.createMediaStreamSource(karaokeStream2);
    karaokeSplitAnalyser2 = audioCtx.createAnalyser();
    karaokeSplitAnalyser2.fftSize = 2048;
    source2.connect(karaokeSplitAnalyser2);
    
    console.log("Análisis de Pitch para P2 inicializado correctamente.");
  }
}

async function ensureP2PitchTracking() {
  if (!karaokeStream2) {
    console.warn("⚠️ No hay karaokeStream2 para analizar pitch de P2.");
    return;
  }

  if (karaokeSplitAudioCtx2 && karaokeSplitSource2 && karaokeSplitAnalyser2 && sr2) {
    return;
  }

  await stopP2PitchTracking();

  karaokeSplitAudioCtx2 = new (window.AudioContext || window.webkitAudioContext)();

  if (karaokeSplitAudioCtx2.state === "suspended") {
    await karaokeSplitAudioCtx2.resume();
  }

  karaokeSplitSource2 = karaokeSplitAudioCtx2.createMediaStreamSource(karaokeStream2);
  karaokeSplitAnalyser2 = karaokeSplitAudioCtx2.createAnalyser();
  karaokeSplitAnalyser2.fftSize = 2048;

  karaokeSplitSource2.connect(karaokeSplitAnalyser2);
  sr2 = karaokeSplitAudioCtx2.sampleRate;

  console.log("🎙️ P2 pitch tracking inicializado correctamente.", {
    sampleRate: sr2,
    fftSize: karaokeSplitAnalyser2.fftSize
  });
}

async function stopP2PitchTracking() {
  if (karaokeSplitSource2) {
    try { karaokeSplitSource2.disconnect(); } catch (e) {}
    karaokeSplitSource2 = null;
  }

  karaokeSplitAnalyser2 = null;
  sr2 = null;

  if (karaokeSplitAudioCtx2) {
    try {
      if (karaokeSplitAudioCtx2.state !== "closed") {
        await karaokeSplitAudioCtx2.close();
      }
    } catch (e) {}
    karaokeSplitAudioCtx2 = null;
  }

  console.log("🛑 P2 pitch tracking detenido.");
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

    try {
      if (
        karaokePitchDetectionAnalyser &&
        karaokePitchDetectionAudioCtx &&
        karaokeAudioController
      ) {
        const buffer = new Float32Array(karaokePitchDetectionAnalyser.fftSize);
        karaokePitchDetectionAnalyser.getFloatTimeDomainData(buffer);

        pitch = await karaokeAudioController.detectPitch(
          buffer,
          karaokePitchDetectionAudioCtx.sampleRate
        );
      }
    } catch (error) {
      console.error("Error detectando pitch P1 en karaoke:", error);
      pitch = -1;
    }

    try {
      if (
        karaokeDuoSplitMode &&
        karaokeSplitAnalyser2 &&
        sr2 &&
        karaokeAudioController
      ) {
        const buf2 = new Float32Array(karaokeSplitAnalyser2.fftSize);
        karaokeSplitAnalyser2.getFloatTimeDomainData(buf2);

        pitch2 = await karaokeAudioController.detectPitch(buf2, sr2);
      }
    } catch (error) {
      console.error("Error detectando pitch P2 en karaoke:", error);
      pitch2 = -1;
    }

    karaokePitchP1 = typeof pitch === "number" ? pitch : -1;
    karaokePitchP2 = typeof pitch2 === "number" ? pitch2 : -1;
    
    console.log("🎯 Pitch loop karaoke", {
      p1: karaokePitchP1,
      p2: karaokePitchP2,
      hasStream1: !!karaokeStream,
      hasStream2: !!karaokeStream2,
      hasAnalyser1: !!karaokePitchDetectionAnalyser,
      hasAnalyser2: !!karaokeSplitAnalyser2,
      sr1: karaokePitchDetectionAudioCtx?.sampleRate || null,
      sr2: sr2 || null,
      duoSplit: karaokeDuoSplitMode
    });
    
    drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);
    if (!isRecording || trackEnded) {
      karaokePitchLoopRafId = null;
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

  if (karaokePitchWorkletNode) {
    try { karaokePitchWorkletNode.disconnect(); } catch (e) {}
    karaokePitchWorkletNode = null;
  }

  if (karaokePitchSourceNode) {
    try { karaokePitchSourceNode.disconnect(); } catch (e) {}
    karaokePitchSourceNode = null;
  }

  if (karaokePitchDetectionAudioCtx && karaokePitchDetectionAudioCtx.state !== "closed") {
    try {
      karaokePitchDetectionAudioCtx.close();
    } catch (e) {}
    karaokePitchDetectionAudioCtx = null;
  }

  karaokePitchDetectionAnalyser = null;

  if (karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
    karaokeStream = null;
  }

  if (karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  if (karaokeDuoAudioContext) {
    try { karaokeDuoAudioContext.close(); } catch (e) {}
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;

  karaokeLoopBusy = false;

  if (karaokeAudioController) {
    destroyAudioController();
    karaokeAudioController = null;
  }

  Promise.resolve(stopP2PitchTracking()).catch(() => {});
  stopKaraokeDuoLevelMonitor?.();

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
  const track = $("karaokeTrack") || $("karaokeAudio") || $("trackPlayer");

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

function safeGetNoteName(midi) {
  const nombres = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${nombres[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function ultrastarToSegments(parsed) {
  console.log("📝 [karaoke.js] Despertando transformador lineal de partituras UltraStar Master...");
  if (!parsed || !parsed.notes || !parsed.notes.length) return [];
  const bpm = parsed.bpm, gap = parsed.gap / 1000, beatDuration = 60 / bpm / 4;
  const segments = []; let currentWords = [], lastEndBeat = 0;

  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    const startTime = gap + (note.startBeat * beatDuration), endTime = startTime + (note.duration * beatDuration);
    let midiNote = 60 + parseInt(note.pitch, 10);
    if (midiNote < 36) midiNote = 36; if (midiNote > 84) midiNote = 84;
    if (note.startBeat - lastEndBeat > 8 && currentWords.length > 0) {
      segments.push({ start: currentWords[0].start, end: currentWords[currentWords.length - 1].end, text: currentWords.map(w => w.word).join(""), words: currentWords, midi: currentWords[0].midi, note: currentWords[0].note });
      currentWords = [];
    }
    currentWords.push({ word: note.syllable || "", start: startTime, end: endTime, midi: midiNote, note: safeGetNoteName(midiNote) });
    lastEndBeat = note.startBeat + note.duration;
  }
  if (currentWords.length > 0) {
    segments.push({ start: currentWords[0].start, end: currentWords[currentWords.length - 1].end, text: currentWords.map(w => w.word).join(""), words: currentWords, midi: currentWords[0].midi, note: currentWords[0].note });
  }
  return segments;
}

async function handleUltrastarTxtChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    parsedUltrastar = parseUltrastarTxt(content);

    $("ultrastarTitle").innerHTML = `<strong>Título:</strong> ${parsedUltrastar.title}`;
    $("ultrastarArtist").innerHTML = `<strong>Artista:</strong> ${parsedUltrastar.artist}`;
    $("ultrastarBpm").innerHTML = `<strong>BPM:</strong> ${parsedUltrastar.bpm}`;
    $("ultrastarNotes").innerHTML = `<strong>Notas:</strong> ${parsedUltrastar.notes.length} sílabas`;
    $("ultrastarPreview").style.display = "block";

    console.log("📄 UltraStar parseado:", parsedUltrastar);
  } catch (error) {
    console.error("Error parseando UltraStar:", error);
    alert("❌ Error al leer el archivo. Verifica que sea un .txt de UltraStar válido.");
  }
}

/*
async function confirmUltrastarImport() {
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

    await window.CloudflareStorage.saveLibraryItemToCloudflare({
      name: `Pista - ${parsedUltrastar.title} (${parsedUltrastar.artist})`,
      type: "pista",
      blob: audioFile,
      date: new Date().toISOString()
    });

    if (vocalsFile) {
      await window.CloudflareStorage.saveLibraryItemToCloudflare({
        name: `Voz - ${parsedUltrastar.title} (${parsedUltrastar.artist})`,
        type: "voz",
        blob: vocalsFile,
        transcription: segments
      });
    }

    await window.CloudflareStorage.saveLibraryItemToCloudflare({
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

    await renderLibrary("todos");
    if (typeof loadMyKaraokeSongs === "function") {
      await loadMyKaraokeSongs();
    }

    closeUltrastarModal?.();

    alert(`✅ ¡"${parsedUltrastar.title}" importada exitosamente!\n\nLa encontrarás en "Mis Canciones" lista para cantar.`);
  } catch (error) {
    console.error("Error importando:", error);
    alert("❌ Error al importar la canción. Revisa la consola para más detalles.");
  }
}
*/

/**
 * Sincroniza los datos del monitor desde la Biblioteca 
 * evitando recargas innecesarias y habilitando la grabación.
 */
export function setKaraokeData(lyrics, name, fileUrl) {
  // 1. Normalizar y asignar segmentos para el renderizado del Canvas
  textSegments = normalizeKaraokeSegments(lyrics);
  baseTextSegments = [...textSegments];
  
  // 2. Sincronizar metadatos internos
  karaokeSelectedTrackName = name || "Sin nombre";
  
  // CRÍTICO: Esto evita el alert("Selecciona un karaoke...") en startKaraokeRecording
  karaokeSelectedTrackBlob = fileUrl; 

  // 3. Actualizar la interfaz de usuario
  const statusEl = $("karaokeStatus");
  if (statusEl) {
    statusEl.textContent = `Listos para cantar: ${karaokeSelectedTrackName}`;
  }

  // 4. Limpiar históricos de interpretación previa
  pitchHistory = [];
  pitchHistoryP1 = [];
  pitchHistoryP2 = [];
  karaokePitchP1 = -1;
  karaokePitchP2 = -1;

  console.log(`🎤 [Karaoke] "${karaokeSelectedTrackName}" sincronizado y listo para grabar.`);
}

/**
 * Normaliza la estructura de datos de Supabase al formato interno del Monitor
 */
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


export async function loadKaraokeSong(id) {
  try {
    if (typeof limpiarVariablesMonitor === "function") {
      limpiarVariablesMonitor();
    }

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
      tapModeStyle: window.currentTapSyncModeType,
      datasetLoaded: track?.dataset?.karaokeLoaded
    });
  } catch (error) {
    console.error("Error cargando karaoke:", error);
    alert("❌ Error al cargar el karaoke.");
  }
}

function limpiarVariablesMonitor() {
  //transcriptionSegments = [];
  //baseTranscriptionSegments = [];
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

function blobToBase64Full(blob) {
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

async function mixKaraoke() {
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

async function exportKaraokeSong(id) {
  try {
    const item = await getLibraryItemsByIdFromSupabase(id);
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
      textSegments: item.textSegments || [],
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

async function importKaraokeFile(file) {
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
      textSegments: data.textSegments || [],
      lyrics: data.lyrics || [],
      metadata: data.metadata || {},
      date: new Date().toISOString()
    };

    if (data.version === 2 && data.file_url) {
      nuevoItemKaraoke.file_url = data.file_url;
      nuevoItemKaraoke.file_path = data.file_path || null;
    } else if (data.audio) {
      const audioRecuperadoBlob = dataUrlToBlob(data.audio);

      const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(
        audioRecuperadoBlob,
        `${nuevoItemKaraoke.name}_importado.mp3`,
        audioRecuperadoBlob.type,
        "karaoke"
      );

      nuevoItemKaraoke.file_url = fileUrl;
      nuevoItemKaraoke.file_path = filePath;
    } else {
      alert("⚠️ El archivo de configuración no contiene rutas de audio válidas.");
      return;
    }

    if (!db) throw new Error("La base de datos no está inicializada.");

    const { error } = await db
      .from("library")
      .insert([nuevoItemKaraoke]);

    if (error) throw new Error(error.message);

    await loadMyKaraokeSongs?.();
    await renderLibrary("todos");

    alert(`✅ "${nuevoItemKaraoke.name}" importado con éxito en la Biblioteca y en Karaoke → Mis Canciones`);
  } catch (err) {
    console.error("❌ Error importando archivo:", err);
    alert("❌ Archivo inválido, corrupto o error de subida a la nube.");
  }
}

function actualizarSelectoresGlobales() {
  if (typeof loadVoiceOptionsInStudio === "function") loadVoiceOptionsInStudio();
  if (typeof loadTrackOptionsInStudio === "function") loadTrackOptionsInStudio();
  if (typeof loadTrackOptionsInKaraoke === "function") loadTrackOptionsInKaraoke();
  if (typeof loadTextOptionsInStudio === "function") loadTextOptionsInStudio();
  if (typeof loadPitchKaraokeOptions === "function") loadPitchKaraokeOptions();

  console.log("🔄 Selectores de la interfaz actualizados");
}
