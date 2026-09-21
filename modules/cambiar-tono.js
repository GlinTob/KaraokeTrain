import { $ } from "./utils.js";
import { getLibraryItemsByTypeFromSupabase, getLibraryItemsByIdFromSupabase, renderLibrary } from "./biblioteca.js?v=4";
import { loadKaraokeSong } from "./karaoke.js?v=18";
import { loadPitchShifterProcessor } from "./worklets.js?v=5";
import { getAudioController } from "./audio-controller.js";

/**
 * MÃ“DULO CAMBIAR TONO â€” Modulador de frecuencia por semitonos en archivos de audio decodificados
 */

export function initCambiarTono() {
  console.log("ðŸŽ¼ [cambiar-tono.js] Inicializado con Ã©xito");

  const semiSelect = $("pitchSemitones");
  // Compatibilidad con la UI anterior de dos selectores (ya retirada).
  const upSelect = $("pitchUpSelect");
  const downSelect = $("pitchDownSelect");

  if (semiSelect) semiSelect.onchange = onPitchSelectsChange;
  if (upSelect) upSelect.onchange = onPitchSelectsChange;
  if (downSelect) downSelect.onchange = onPitchSelectsChange;

  onPitchSelectsChange();
}

export function destroyCambiarTono() {
  pitchRenderSession++;
  stopPitchShifted();

  if (pitchAudioContext && pitchAudioContext.state !== "closed") {
    pitchAudioContext.close().catch(() => {});
  }
  pitchAudioContext = null;
  pitchAudioBuffer = null;
  pitchSelectedItem = null;
  pitchWorkletNode = null;
  pitchSourceNode = null;
  pitchGainNode = null;
  pitchIsPlaying = false;
  pitchLastSavedId = null;

  // Limpiar handlers del DOM
  const semiSelect = $("pitchSemitones");
  const upSelect = $("pitchUpSelect");
  const downSelect = $("pitchDownSelect");
  if (semiSelect) semiSelect.onchange = null;
  if (upSelect) upSelect.onchange = null;
  if (downSelect) downSelect.onchange = null;
}

// Variables de Control de Estado de Audio
let pitchAudioContext = null;
let pitchAudioBuffer = null;
let pitchSelectedItem = null;
let pitchWorkletNode = null;
let pitchSourceNode = null;
let pitchGainNode = null;
let pitchIsPlaying = false;
let pitchStartPending = false;
let pitchLastSavedId = null;
// Token anti-zombi: si el usuario cambia de tab a mitad del render offline,
// el save continúa en segundo plano. Se invalida en destroyCambiarTono.
let pitchRenderSession = 0;

function getNetSemitones() {
  // Control único -12…+12. Se mantiene lectura de los selectores viejos por
  // compatibilidad (si existieran, se suman como antes).
  const single = $("pitchSemitones");
  if (single) {
    const v = parseInt(single.value || "0", 10);
    return Number.isFinite(v) ? Math.max(-12, Math.min(12, v)) : 0;
  }
  const up = parseInt(($("pitchUpSelect")?.value) || "0", 10);
  const down = parseInt(($("pitchDownSelect")?.value) || "0", 10);
  return up - down;
}

function getPitchRatio() {
  return Math.pow(2, getNetSemitones() / 12);
}

function onPitchSelectsChange() {
  const net = getNetSemitones();
  const display = $("pitchCurrentDisplay");

  if (display) {
    const signo = net > 0 ? "+" : "";
    display.textContent = `Cambio actual: ${signo}${net} semitono${Math.abs(net) === 1 ? "" : "s"}`;
  }

  if (pitchWorkletNode && pitchAudioContext) {
    try {
      const pitchParam = pitchWorkletNode.parameters.get("pitchRatio");
      if (pitchParam) {
        pitchParam.setValueAtTime(getPitchRatio(), pitchAudioContext.currentTime);
      }
    } catch (e) {
      console.warn("No se pudo actualizar pitchRatio en tiempo real:", e);
    }
  }
}

export async function loadPitchKaraokeOptions() {
  const select = $("pitchKaraokeSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona un archivo karaoke</option>`;

  try {
    const items = await getLibraryItemsByTypeFromSupabase("karaoke");

    if (!items.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No hay archivos karaoke guardados";
      select.appendChild(opt);
      return;
    }

    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error("Error cargando karaokes en Cambiar tono:", e);
  }
}

// ====================================================================
// ðŸŽ§ SELECCIONAR Y DECODIFICAR AUDIO DESDE CLOUDFLARE STORAGE / SUPABASE
// ====================================================================
export async function loadSelectedPitchKaraoke() {
  const select = $("pitchKaraokeSelect");
  const status = $("pitchLoadStatus");

  const id = select?.value;
  if (!id) {
    alert("âš ï¸ Selecciona un archivo karaoke de la lista.");
    return;
  }

  try {
    if (status) status.textContent = "Estado: cargando y decodificando audioâ€¦";

    const item = await getLibraryItemsByIdFromSupabase(id);
    const audioUrlCloud = item ? (item.file_url || item.audioUrl || item.audioBlob) : null;
    console.log("[CambiarTono] item:", item ? item.id : null, item ? item.name : null);
    console.log("[CambiarTono] audioUrlCloud:", audioUrlCloud);

    if (!item || !audioUrlCloud) {
      if (status) status.textContent = "Estado: el archivo no tiene un enlace de audio vÃ¡lido.";
      alert("âš ï¸ Este archivo karaoke no contiene audio en la nube.");
      return;
    }

    stopPitchShifted();

    if (!pitchAudioContext || pitchAudioContext.state === "closed") {
      pitchAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    try {
      const response = await fetch(audioUrlCloud);
      console.log("[CambiarTono] fetch status:", response.status, "type:", response.type, "url:", response.url);
      if (!response.ok) {
        throw new Error(`No se pudo descargar el audio (${response.status})`);
      }

      const cloudBlob = await response.blob();
      console.log("[CambiarTono] blob size:", cloudBlob.size, "tipo:", cloudBlob.type);
      const arrayBuffer = await cloudBlob.arrayBuffer();

      try {
        pitchAudioBuffer = await pitchAudioContext.decodeAudioData(arrayBuffer.slice(0));
      } catch (decodeErr) {
        console.error("[CambiarTono] decodeAudioData fallÃ³:", decodeErr);
        throw new Error("El formato de audio no se pudo decodificar: " + decodeErr.message);
      }
    } catch (fetchErr) {
      console.error("[CambiarTono] error descargando/decodificando:", fetchErr);
      if (status) status.textContent = "Estado: âŒ no se pudo decodificar el audio (" + fetchErr.message + ").";
      alert("âŒ No se pudo descargar/decodificar el audio: " + fetchErr.message);
      return;
    }
    console.log("[CambiarTono] audio decodificado OK, duraciÃ³n:", pitchAudioBuffer.duration, "canales:", pitchAudioBuffer.numberOfChannels);
    pitchSelectedItem = item;

    pitchLastSavedId = null;

    const sendBtn = $("pitchSendToKaraokeBtn");
    if (sendBtn) sendBtn.disabled = true;

        // FIX: await para evitar race condition si el usuario da a Play inmediatamente
                    try {
                      await loadPitchShifterProcessor(pitchAudioContext);
                    } catch (err) {
                      console.warn("No se pudo precargar el pitch worklet:", err);
                    }

            if (status) {
      status.textContent = `Estado: "${item.name}" cargado (${pitchAudioBuffer.duration.toFixed(1)} s, ${pitchAudioBuffer.numberOfChannels} canal${pitchAudioBuffer.numberOfChannels === 1 ? "" : "es"}). Listo para reproducir.`;
    }

    const saveName = $("pitchSaveName");
    if (saveName && !saveName.value) {
      saveName.value = item.name + " (tono modificado)";
    }
  } catch (e) {
    console.error("Error cargando karaoke en pitch shifter:", e);
    if (status) status.textContent = "Estado: âŒ no se pudo decodificar el audio.";
    alert("âŒ No se pudo decodificar el audio: " + e.message);
  }
}

// ====================================================================
// ðŸ”Š REPRODUCCIÃ“N EN TIEMPO REAL UTILIZANDO AUDIO-WORKLET
// ====================================================================
export async function playPitchShifted() {
  if (!pitchAudioBuffer) {
    alert("âš ï¸ Primero carga un archivo karaoke desde Biblioteca.");
    return;
  }

  // FIX: evitar doble arranque (dos clicks rÃ¡pidos durante el await de carga
  // del worklet / resume) que dejaba dos BufferSource sonando a la vez, con
  // pitchSourceNode apuntando solo al Ãºltimo (el otro quedaba huÃ©rfano).
  if (pitchStartPending) return;
  if (pitchIsPlaying) return;
  pitchStartPending = true;

  try {
    if (!pitchAudioContext || pitchAudioContext.state === "closed") {
      pitchAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    stopPitchShifted();

    try {
      await loadPitchShifterProcessor(pitchAudioContext);
    } catch (e) {
      console.error("Worklet no cargÃ³:", e);
      alert("âŒ No se pudo cargar el procesador de audio: " + e.message);
      return;
    }

    try {
      pitchSourceNode = pitchAudioContext.createBufferSource();
      pitchSourceNode.buffer = pitchAudioBuffer;

      pitchWorkletNode = new AudioWorkletNode(pitchAudioContext, "pitch-shifter-processor");

      const pitchParam = pitchWorkletNode.parameters.get("pitchRatio");
      if (pitchParam) {
        pitchParam.setValueAtTime(getPitchRatio(), pitchAudioContext.currentTime);
      }

      pitchGainNode = pitchAudioContext.createGain();
      pitchGainNode.gain.value = 1.0;

      pitchSourceNode.connect(pitchWorkletNode);
      pitchWorkletNode.connect(pitchGainNode);
      pitchGainNode.connect(pitchAudioContext.destination);

      pitchSourceNode.onended = () => {
        if (pitchIsPlaying) stopPitchShifted();
      };

      // Reanudar el contexto DESPUÃ‰S de stopPitchShifted() (que lo suspende)
      // y de armar el grafo, justo antes de reproducir, para que sÃ­ suene.
      if (pitchAudioContext.state === "suspended") {
        await pitchAudioContext.resume();
      }

      pitchSourceNode.start();
      pitchIsPlaying = true;

      const st = $("pitchPlayStatus");
      if (st) st.textContent = "Estado: â–¶ï¸ reproduciendo con tono modificadoâ€¦";
    } catch (e) {
      console.error("Error iniciando reproducciÃ³n con pitch shift:", e);
      alert("âŒ Error iniciando el cambio de tono: " + e.message);
      stopPitchShifted();
    }
  } finally {
    pitchStartPending = false;
  }
}

export function stopPitchShifted() {
  if (pitchSourceNode) {
    try { pitchSourceNode.onended = null; } catch (e) {}
    try { pitchSourceNode.stop(); } catch (e) {}
    try { pitchSourceNode.disconnect(); } catch (e) {}
    pitchSourceNode = null;
  }

  if (pitchWorkletNode) {
    try { pitchWorkletNode.disconnect(); } catch (e) {}
    pitchWorkletNode = null;
  }

  if (pitchGainNode) {
    try { pitchGainNode.disconnect(); } catch (e) {}
    pitchGainNode = null;
  }

  if (pitchAudioContext && pitchAudioContext.state === "running") {
    try { pitchAudioContext.suspend(); } catch (e) {}
  }

  pitchIsPlaying = false;

  const st = $("pitchPlayStatus");
  if (st) st.textContent = "Estado: â¹ï¸ detenido.";
}

export function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const ab = new ArrayBuffer(bufferSize);
  const view = new DataView(ab);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

export async function savePitchShiftedToLibrary() {
  if (!pitchAudioBuffer) {
    alert("âš ï¸ Primero carga un archivo karaoke desde Biblioteca.");
    return;
  }

  const semitones = getNetSemitones();

  const status = $("pitchSaveStatus");
  const btn = $("pitchSaveBtn");

  if (btn) btn.disabled = true;
  if (status) status.textContent = "Estado: ðŸ”„ procesando audio con el nuevo tonoâ€¦";

  try {
    if (!window.CloudflareStorage?.saveLibraryItemToCloudflare) {
      throw new Error("CloudflareStorage no estÃ¡ disponible.");
    }

    stopPitchShifted();

    // FIX: Bypass si no hay cambio de tono (|semitones| < 0.5)
    // Evita procesamiento innecesario y preserva la calidad original.
    const renderSession = pitchRenderSession;
    let renderedBuffer;
    if (Math.abs(semitones) < 0.5) {
      renderedBuffer = pitchAudioBuffer;
    } else {
      // Progreso real del render (el phase-vocoder offline tarda minutos en
      // canciones largas: avisa el % para no parecer colgado).
      renderedBuffer = await renderPitchShiftOffline(pitchAudioBuffer, semitones, (p) => {
        if (status) status.textContent = `Estado: 🔄 procesando audio con el nuevo tono… ${Math.round(p * 100)}%`;
      });
    }
    // Si se cambió de tab durante el render, no seguir (ni codificar ni subir).
    if (renderSession !== pitchRenderSession) {
      console.log("🧹 Render de tono descartado: se cambió de pestaña.");
      if (status) status.textContent = "Estado: cancelado (cambiaste de pestaña).";
      return;
    }
    if (status) status.textContent = "Estado: 💾 codificando WAV…";
    // Ceder un frame para que el estado pinte antes del trabajo pesado.
    await new Promise(r => setTimeout(r, 30));
    // Codificar en el worker (no bloquea la UI como el bucle manual).
    let wavBlob;
    try {
      wavBlob = await getAudioController().encodeWavToBlob(renderedBuffer);
    } catch (encodeErr) {
      console.warn("Encode en worker falló, usando codificador local:", encodeErr);
      wavBlob = audioBufferToWavBlob(renderedBuffer);
    }
    if (status) status.textContent = `Estado: ☁️ subiendo a la nube (${(wavBlob.size / 1048576).toFixed(1)} MB, puede tardar)…`;

    const nameInput = $("pitchSaveName");
    const signo = semitones > 0 ? "+" : "";
    const baseName = (pitchSelectedItem?.name || "Karaoke").replace(/\s*\(tono modificado\)\s*$/i, "");
    const finalName = (nameInput && nameInput.value.trim())
      ? nameInput.value.trim()
      : `${baseName} (${signo}${semitones} semitonos)`;

    const resultadoSubida = await window.CloudflareStorage.saveLibraryItemToCloudflare({
      name: finalName,
      type: "karaoke",
      blob: wavBlob,
      transcription: pitchSelectedItem?.transcription || [],
      metadata: {
        ...(pitchSelectedItem?.metadata || {}),
        pitchShiftedSemitones: semitones,
        isModifiedTono: true
      }
    });

    if (resultadoSubida && resultadoSubida.id) {
      pitchLastSavedId = resultadoSubida.id;
      const sendBtn = $("pitchSendToKaraokeBtn");
      if (sendBtn) sendBtn.disabled = false;
    }

    if (status) status.textContent = "Estado: Â¡Guardado en la nube con Ã©xito! âœ…";
    alert(`ðŸŽ¯ "${finalName}" guardado correctamente en tu biblioteca.`);

    await renderLibrary("todos");
    if (typeof window.loadMyKaraokeSongs === "function") {
      await window.loadMyKaraokeSongs();
    }
    await loadPitchKaraokeOptions();
  } catch (e) {
    console.error("Error guardando audio modificado:", e);
    if (status) status.textContent = "Estado: âŒ error al guardar.";
    alert("âŒ Error al guardar las modificaciones en la base de datos: " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function sendPitchShiftedToKaraokeMonitor() {
  if (!pitchLastSavedId) {
    alert("âš ï¸ Primero guarda el archivo con tono cambiado para poder enviarlo al monitor.");
    return;
  }

  try {
    stopPitchShifted();
    await loadKaraokeSong(pitchLastSavedId);

    const status = $("pitchSaveStatus");
    if (status) {
      status.textContent = "Estado: âœ… archivo cargado en el monitor karaoke.";
    }

    alert("âœ… Enviado al monitor karaoke.\n\nCuando estÃ©s listo, ve a la pestaÃ±a Karaoke y presiona 'ðŸŽ™ï¸ Iniciar GrabaciÃ³n' para empezar a cantar.");
  } catch (e) {
    console.error("Error enviando al monitor karaoke desde Cambiar tono:", e);
    alert("âŒ No se pudo enviar al monitor karaoke: " + e.message);
  }
}

export async function renderPitchShiftOffline(audioBuffer, semitones, onProgress) {
  if (!audioBuffer) {
    throw new Error("renderPitchShiftOffline requiere un audioBuffer vÃ¡lido.");
  }

  const ratio = Math.pow(2, semitones / 12);
    // FIX: DuraciÃ³n invariante 1:1 para sincronÃ­a con karaoke.
    // FIX phase vocoder: el worklet es STFT con ventana de 2048 muestras.
    // Su latencia de anÃ¡lisis es exactamente 2048 muestras: los primeros
    // `latency` samples del render son silencio y el contenido del audio
    // aparece desplazado a partir de ahÃ­. Recortamos ese prefijo y
    // compensamos con un colchÃ³n al final para que no se pierda la cola.
    const latencySamples = 2048 + 128; // fftSize del worklet + bloque de margen
    const outputLength = audioBuffer.length + latencySamples;

  const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      outputLength,
      audioBuffer.sampleRate
    );

    // FIX: usar loadPitchShifterProcessor de worklets.js (idempotente)
    await loadPitchShifterProcessor(offlineCtx);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  const worklet = new AudioWorkletNode(
    offlineCtx,
    "pitch-shifter-processor"
  );

  const pitchParam = worklet.parameters.get("pitchRatio");
  if (pitchParam) {
    pitchParam.setValueAtTime(ratio, offlineCtx.currentTime);
  }

  source.connect(worklet);
  worklet.connect(offlineCtx.destination);
  source.start();

  // Suspensiones programadas para reportar %: el render corre en otro hilo
  // pero suspend() permite actualizar la UI entre tramos.
  if (typeof onProgress === "function") {
    try {
      const totalSec = outputLength / audioBuffer.sampleRate;
      const steps = 10;
      for (let k = 1; k < steps; k++) {
        const t = (totalSec * k) / steps;
        offlineCtx.suspend(t).then(() => {
          try { onProgress(k / steps); } catch (e) {}
          offlineCtx.resume();
        }).catch(() => {});
      }
    } catch (e) {}
  }

  const rendered = await offlineCtx.startRendering();
  if (typeof onProgress === "function") {
    try { onProgress(1); } catch (e) {}
  }

  try { source.disconnect(); } catch (e) {}
  try { worklet.disconnect(); } catch (e) {}

  return trimAudioBufferFront(rendered, latencySamples);
}

function trimAudioBufferFront(buffer, skip) {
  const out = new AudioBuffer({
    length: Math.max(1, buffer.length - skip),
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(skip));
  }
  return out;
}
