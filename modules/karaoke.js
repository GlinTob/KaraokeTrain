// ====================================================================
// 🎨 MONITOR DE RENDERIZADO Y FLUJO DE REPRODUCCIÓN DEL KARAOKE
// ====================================================================
import { $, safeAdd } from "../script.js";

// Declaración de historiales locales para evitar errores de referencia en el render
let pitchHistory = [];
let karaokePitchDetectionAudioCtx = null;
let karaokePitchDetectionAnalyser = null;
let karaokePitchLoopRafId = null;
let karaokePitchSourceNode = null;
let karaokePitchWorkletNode = null;

export function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const hueFiesta = (currentTime * 50) % 360;
  const paleta = obtenerPaletaTema(hueFiesta);

  // Guardamos pitch global para repintados manuales (toggle, etc.)
  if (typeof currentFreq === "number") karaokePitchP1 = currentFreq;
  if (typeof currentFreq2 === "number") karaokePitchP2 = currentFreq2;

  // --- CONFIGURACIÓN COMÚN ---
  const MIDI_MIN = 36;
  const MIDI_MAX = 84;
  const lineX = 80; // Línea roja (Ahora)
  const pixelsPerSecond = (canvas.width - 50) / 7;

  function obtenerPaletaTema(hue = 0) {
    const temaActual = localStorage.getItem("vocalApp_stage") || "theme-clasico";
    let config = { fondo: "#111827", lineas: "#333333", etiquetas: "#666666", barraFutura: "#1e40af", bordeFuturo: "#3b82f6", tamanoTexto: "15px" };
    switch (temaActual) {
      case "theme-moderno":
        config = { fondo: "#082f49", lineas: "rgba(6, 182, 212, 0.2)", etiquetas: "#06b6d4", barraFutura: "#1e3a8a", bordeFuturo: "#06b6d4", tamanoTexto: "16px" };
        break;
      case "theme-disco":
        config = { fondo: "#2e1065", lineas: "rgba(219, 39, 119, 0.25)", etiquetas: "#facc15", barraFutura: "#701a75", bordeFuturo: "#db2777", tamanoTexto: "18px" };
        break;
      case "theme-acustico":
        config = { fondo: "#451a03", lineas: "rgba(120, 53, 15, 0.4)", etiquetas: "#fcd34d", barraFutura: "#78350f", bordeFuturo: "#b45309", tamanoTexto: "14px" };
        break;
      case "theme-fiesta":
        config = {
          fondo: `hsl(${hue}, 40%, 12%)`,
          lineas: "rgba(255, 255, 255, 0.15)",
          etiquetas: "#ff007f",
          barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`,
          bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)`,
          tamanoTexto: "19px"
        };
        break;
    }
    return config;
  }

  // 1. LIMPIAR TODO EL CANVAS
  ctx.fillStyle = paleta.fondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Fuente de datos (palabras con tiempos) - asegurar arrays inicializados
  const datos = (typeof textSegments !== 'undefined' && textSegments && textSegments.length > 0) ? textSegments : transcriptionSegments;

  // Offset extra cuando hay etiqueta de avatar (split mode)
  const AVATAR_BLOCK_W = karaokeDuoSplitMode ? 110 : 0;
  const noteLabelsX = 28 + AVATAR_BLOCK_W;
  const pentagramStartX = 35 + AVATAR_BLOCK_W;
  const dynLineX = lineX + AVATAR_BLOCK_W;

  function drawAvatarBlock(pTop, pBottom, parte) {
    if (!parte || parte === "DUO") return;
    const isP1 = (parte === "P1");
    const nombre = isP1 ? "Wen-dolyne" : "To-bonito";
    const avatarEmoji = isP1 ? "👩" : "🧔🏾";

    const cx = 5 + AVATAR_BLOCK_W / 2;
    const blockTop = pTop + 10;
    const avatarSize = 56;
    const halfSize = 28; 
    const nameH = 22;
    const gap = 6;

    // 1) Nombre
    ctx.fillStyle = "white";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(nombre, cx, blockTop + nameH - 4);

    // 2) Avatar emoji
    const avTop = blockTop + nameH + gap;
    ctx.font = `${avatarSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(avatarEmoji, cx, avTop + avatarSize / 2);

    // 3) Fila inferior con dos íconos al lado
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

  function drawRegion(pTop, pBottom, pitchVal, pitchHist, parteFiltro, etiquetaParte) {
    const pHeight = pBottom - pTop;
    const numLines = 10;
    const midiToY = (midi) => {
      const val = (midi && midi > 0) ? midi : 60;
      const normalized = (MIDI_MAX - val) / (MIDI_MAX - MIDI_MIN);
      return pTop + (normalized * pHeight);
    };

    drawAvatarBlock(pTop, pBottom, etiquetaParte);

    // Pentagrama
    ctx.strokeStyle = paleta.lineas;
    ctx.lineWidth = 1;
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

    // Barras de notas
    if (Array.isArray(datos) && datos.length > 0) {
      datos.forEach((seg) => {
        const parteSeg = seg.parte || "P1";
        if (parteFiltro && parteSeg !== parteFiltro && parteSeg !== "DUO") return;

        const words = Array.isArray(seg.words) ? seg.words : [];
        words.forEach(w => {
          const start = w.start || w.startTime || seg.start || 0;
          const end = w.end || (start + (w.duration || 0.5));
          if (end < currentTime - 1 || start > currentTime + (canvas.width / pixelsPerSecond)) return;
          
          const x = dynLineX + (start - currentTime) * pixelsPerSecond;
          const width = (end - start) * pixelsPerSecond;
          const midi = w.midi || seg.midi || 60;
          const y = midiToY(midi);
          const h = 24;

          const isActive = currentTime >= start && currentTime <= end;
          const isPast = currentTime > end;

          let barColor = paleta.barraFutura;
          let strokeColor = paleta.bordeFuturo;

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

    // Rastro de pitch y punto del usuario
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
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "#facc15";
    ctx.arc(dynLineX, userY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
      
    // Línea roja (Ahora)
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dynLineX, pTop - 2);
    ctx.lineTo(dynLineX, pBottom + 2);
    ctx.stroke();
    
    // 2. Renderizar según modo (Single vs Dúo Split)
    if (karaokeDuoSplitMode) {
      const TELE_H = 100;
      const GAP = 14;
      const totalUsable = canvas.height - TELE_H - 20;
      const regionH = (totalUsable - GAP) / 2;
      const topP1 = 20;
      const bottomP1 = topP1 + regionH;
      const topP2 = bottomP1 + GAP;
      const bottomP2 = topP2 + regionH;

      pitchHistoryP1.push(currentFreq > 0 ? currentFreq : null);
      if (pitchHistoryP1.length > 60) pitchHistoryP1.shift();
      pitchHistoryP2.push(currentFreq2 > 0 ? currentFreq2 : null);
      if (pitchHistoryP2.length > 60) pitchHistoryP2.shift();

      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, bottomP1, canvas.width, GAP);

      drawRegion(topP1, bottomP1, currentFreq, pitchHistoryP1, "P1", "P1");
      drawRegion(topP2, bottomP2, currentFreq2, pitchHistoryP2, "P2", "P2");
    } else {
        const P_TOP = 40;
        const P_BOTTOM = canvas.height - 110;
        pitchHistory.push(currentFreq > 0 ? currentFreq : null);
        if (pitchHistory.length > 60) pitchHistory.shift();
        drawRegion(P_TOP, P_BOTTOM, currentFreq, pitchHistory, null, null);
    }
    
    // 3. TELEPROMPTER DOBLE LÍNEA
    if (Array.isArray(datos) && datos.length > 0) {
      const idx = datos.findIndex(s => currentTime >= (s.start || 0) && currentTime <= (s.end || (s.start + 1)));
      if (idx !== -1) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(0, canvas.height - 100, canvas.width, 100);
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.font = "bold 30px Arial";
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

    const mic1Id = getSelectedMicId?.(1);
    const mic2Id = getSelectedMicId?.(2);

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

      startKaraokeDuoLevelMonitor?.();
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

      stopKaraokeDuoLevelMonitor?.();
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

    if (karaokeDuoAudioContext) {
      try { await karaokeDuoAudioContext.close(); } catch (e) {}
      karaokeDuoAudioContext = null;
    }

    if (karaokeStream) {
      karaokeStream.getTracks().forEach(t => t.stop());
      karaokeStream = null;
    }

    if (karaokeStream2) {
      karaokeStream2.getTracks().forEach(t => t.stop());
      karaokeStream2 = null;
    }

    stopKaraokeDuoLevelMonitor?.();

    const duoIndicator = $("karaokeDuoIndicator");
    if (duoIndicator) {
      duoIndicator.style.display = "none";
    }

    alert("❌ No se pudo iniciar la grabación de karaoke: " + err.message);
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
      updateVocalProcessorParams?.(karaokePitchWorkletNode);

      karaokePitchSourceNode.connect(karaokePitchWorkletNode);
      finalNode = karaokePitchWorkletNode;
    } catch (e) {
      console.warn("Vocal processor no disponible para karaoke:", e);
      karaokePitchWorkletNode = null;
      finalNode = karaokePitchSourceNode;
    }
  }

  finalNode.connect(karaokePitchDetectionAnalyser);

  if (karaokeDuoSplitMode) {
    try {
      await ensureP2PitchTracking?.();
    } catch (e) {
      console.warn("No se pudo inicializar P2 pitch tracking:", e);
    }
  }

  loop();
}

export function loop() {
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
      (window.AudioUtils?.detectPitch || AudioUtils?.detectPitch)
    ) {
      const detectPitchFn = window.AudioUtils?.detectPitch || AudioUtils.detectPitch;

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
      karaokeDuoSplitMode &&
      karaokeSplitAnalyser2 &&
      sr2 &&
      (window.AudioUtils?.detectPitch || AudioUtils?.detectPitch)
    ) {
      const detectPitchFn = window.AudioUtils?.detectPitch || AudioUtils.detectPitch;

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

  drawKaraokeMonitor(currentTime, karaokePitchP1, karaokePitchP2);

  if (!isRecording || trackEnded) {
    karaokePitchLoopRafId = null;
    return;
  }

  karaokePitchLoopRafId = requestAnimationFrame(loop);
}

function stopKaraokeRecording() {
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

  // Detener Mic 1
  if (karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
    karaokeStream = null;
  }

  // Detener Mic 2
  if (karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  // Cerrar contexto de audio dúo
  if (karaokeDuoAudioContext) {
    try { karaokeDuoAudioContext.close(); } catch (e) {}
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;

  stopP2PitchTracking?.();
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

function syncKaraokeMonitor(currentTime) {
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
  
  let currentBeat = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Metadatos (líneas que empiezan con #)
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }
    
    // Notas (líneas que empiezan con :, *, F, o -)
    if (trimmed.match(/^[:*F-]/)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0]; // : = normal, * = golden, F = freestyle, - = line break
      
      if (type === "-") {
        // Line break - marca fin de línea
        continue;
      }
      
      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        const syllable = parts.slice(4).join(" ");
        
        notes.push({
          type: type,
          startBeat: startBeat,
          duration: duration,
          pitch: pitch, // Nota MIDI relativa
          syllable: syllable
        });
      }
    }
  }
  
  return {
    title: metadata.TITLE || "Sin título",
    artist: metadata.ARTIST || "Desconocido",
    bpm: parseFloat(metadata.BPM) || 120,
    gap: parseFloat(metadata.GAP) || 0, // Milisegundos antes de la primera nota
    videoGap: parseFloat(metadata.VIDEOGAP) || 0,
    genre: metadata.GENRE || "",
    language: metadata.LANGUAGE || "",
    year: metadata.YEAR || "",
    notes: notes
  };
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
  let currentSegment = null;
  let currentWords = [];
  let lastEndBeat = 0;
  
  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    const midiNote = 60 + note.pitch; // UltraStar usa pitch relativo, base = C4 (60)
    
    // Detectar si hay un salto grande (nueva línea)
    const gapFromLast = note.startBeat - lastEndBeat;
    
    if (gapFromLast > 8 && currentWords.length > 0) {
      // Guardar segmento anterior
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
      currentWords = [];
    }
    
    // Agregar palabra/sílaba
    currentWords.push({
      word: note.syllable,
      start: startTime,
      end: endTime,
      pitch: AudioUtils.midiToFrequency(midiNote),
      midi: midiNote,
      note: getNoteFromFrequency(AudioUtils.midiToFrequency(midiNote))
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

function ultrastarToSegments(parsed) {
  if (!parsed || !Array.isArray(parsed.notes) || parsed.notes.length === 0) {
    return [];
  }

  const bpm = parsed.bpm;
  const gap = parsed.gap / 1000;
  const beatDuration = 60 / bpm / 4;

  const segments = [];
  let currentWords = [];
  let lastEndBeat = 0;

  const midiToFrequencyFn =
    window.AudioUtils?.midiToFrequency ||
    ((midi) => 440 * Math.pow(2, (midi - 69) / 12));

  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];

    const startTime = gap + note.startBeat * beatDuration;
    const endTime = startTime + note.duration * beatDuration;
    const midiNote = 60 + note.pitch;
    const freq = midiToFrequencyFn(midiNote);

    const gapFromLast = note.startBeat - lastEndBeat;

    if (gapFromLast > 8 && currentWords.length > 0) {
      segments.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map((w) => w.word).join(""),
        words: currentWords,
        pitch: currentWords[0].pitch,
        midi: currentWords[0].midi,
        note: currentWords[0].note
      });
      currentWords = [];
    }

    currentWords.push({
      word: note.syllable,
      start: startTime,
      end: endTime,
      pitch: freq,
      midi: midiNote,
      note: typeof getNoteFromFrequency === "function"
        ? getNoteFromFrequency(freq)
        : null
    });

    lastEndBeat = note.startBeat + note.duration;
  }

  if (currentWords.length > 0) {
    segments.push({
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map((w) => w.word).join(""),
      words: currentWords,
      pitch: currentWords[0].pitch,
      midi: currentWords[0].midi,
      note: currentWords[0].note
    });
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

let currentKaraokeAudioURL = null; // Mantenemos tu variable de control local
  
async function loadKaraokeSong(id) {
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
      tapModeStyle: window.currentTapSyncModeType,
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
  
export async function exportKaraokeSong(id) {
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
