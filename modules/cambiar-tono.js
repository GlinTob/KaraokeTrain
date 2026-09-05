import { $ } from "./utils.js";
import { getLibraryItemsByTypeFromSupabase, getLibraryItemsByIdFromSupabase, renderLibrary } from "./biblioteca.js";
import { loadKaraokeSong } from "./karaoke.js";

/**
 * MÓDULO CAMBIAR TONO — Modulador de frecuencia por semitonos en archivos de audio decodificados
 */

export function initCambiarTono() {
  console.log("🎼 [cambiar-tono.js] Inicializado con éxito");

  const upSelect = $("pitchUpSelect");
  const downSelect = $("pitchDownSelect");

  if (upSelect) upSelect.onchange = onPitchSelectsChange;
  if (downSelect) downSelect.onchange = onPitchSelectsChange;

  onPitchSelectsChange();
}

// Variables de Control de Estado de Audio
let pitchAudioContext = null;
let pitchAudioBuffer = null;
let pitchSelectedItem = null;
let pitchWorkletNode = null;
let pitchSourceNode = null;
let pitchGainNode = null;
let pitchIsPlaying = false;
let pitchLastSavedId = null;

// Cache de promesas addModule por contexto
const _pitchWorkletLoaded = new WeakMap();

function _getWorkletUrl() {
  return window.__PITCH_WORKLET_URL__ || new URL("./pitch-shifter-processor.js", import.meta.url).href;
}

async function ensurePitchWorklet(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
    throw new Error("AudioWorklet no está soportado en este navegador.");
  }

  let p = _pitchWorkletLoaded.get(ctx);
  if (p) return p;

  const url = _getWorkletUrl();

  p = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} cargando ${url}`);
    }

    const text = await res.text();
    if (/<!doctype html>|<html/i.test(text)) {
      throw new Error(`La URL del worklet devolvió HTML en vez de JS: ${url}`);
    }

    // Cargar el worklet desde una URL blob: evita problemas de rutas, MIME y CORS
    // al servirlo desde un servidor estático como Vercel.
    const blobUrl = URL.createObjectURL(new Blob([text], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })().catch(err => {
    _pitchWorkletLoaded.delete(ctx);
    throw err;
  });

  _pitchWorkletLoaded.set(ctx, p);
  return p;
}

function getNetSemitones() {
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
// 🎧 SELECCIONAR Y DECODIFICAR AUDIO DESDE CLOUDFLARE STORAGE / SUPABASE
// ====================================================================
export async function loadSelectedPitchKaraoke() {
  const select = $("pitchKaraokeSelect");
  const status = $("pitchLoadStatus");

  const id = select?.value;
  if (!id) {
    alert("⚠️ Selecciona un archivo karaoke de la lista.");
    return;
  }

  try {
    if (status) status.textContent = "Estado: cargando y decodificando audio…";

    const item = await getLibraryItemsByIdFromSupabase(id);
    const audioUrlCloud = item ? (item.file_url || item.audioUrl || item.audioBlob) : null;
    console.log("[CambiarTono] item:", item ? item.id : null, item ? item.name : null);
    console.log("[CambiarTono] audioUrlCloud:", audioUrlCloud);

    if (!item || !audioUrlCloud) {
      if (status) status.textContent = "Estado: el archivo no tiene un enlace de audio válido.";
      alert("⚠️ Este archivo karaoke no contiene audio en la nube.");
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
        console.error("[CambiarTono] decodeAudioData falló:", decodeErr);
        throw new Error("El formato de audio no se pudo decodificar: " + decodeErr.message);
      }
    } catch (fetchErr) {
      console.error("[CambiarTono] error descargando/decodificando:", fetchErr);
      if (status) status.textContent = "Estado: ❌ no se pudo decodificar el audio (" + fetchErr.message + ").";
      alert("❌ No se pudo descargar/decodificar el audio: " + fetchErr.message);
      return;
    }
    console.log("[CambiarTono] audio decodificado OK, duración:", pitchAudioBuffer.duration, "canales:", pitchAudioBuffer.numberOfChannels);
    pitchSelectedItem = item;

    pitchLastSavedId = null;

    const sendBtn = $("pitchSendToKaraokeBtn");
    if (sendBtn) sendBtn.disabled = true;

    ensurePitchWorklet(pitchAudioContext).catch(err => {
      console.warn("No se pudo precargar el pitch worklet:", err);
    });

    if (status) {
      status.textContent = `Estado: "${item.name}" cargado (${pitchAudioBuffer.duration.toFixed(1)} s, ${pitchAudioBuffer.numberOfChannels} canal${pitchAudioBuffer.numberOfChannels === 1 ? "" : "es"}). Listo para reproducir.`;
    }

    const saveName = $("pitchSaveName");
    if (saveName && !saveName.value) {
      saveName.value = item.name + " (tono modificado)";
    }
  } catch (e) {
    console.error("Error cargando karaoke en pitch shifter:", e);
    if (status) status.textContent = "Estado: ❌ no se pudo decodificar el audio.";
    alert("❌ No se pudo decodificar el audio: " + e.message);
  }
}

// ====================================================================
// 🔊 REPRODUCCIÓN EN TIEMPO REAL UTILIZANDO AUDIO-WORKLET
// ====================================================================
export async function playPitchShifted() {
  if (!pitchAudioBuffer) {
    alert("⚠️ Primero carga un archivo karaoke desde Biblioteca.");
    return;
  }

  if (!pitchAudioContext || pitchAudioContext.state === "closed") {
    pitchAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  stopPitchShifted();

  try {
    await ensurePitchWorklet(pitchAudioContext);
  } catch (e) {
    console.error("Worklet no cargó:", e);
    alert("❌ No se pudo cargar el procesador de audio: " + e.message);
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

    // Reanudar el contexto DESPUÉS de stopPitchShifted() (que lo suspende)
    // y de armar el grafo, justo antes de reproducir, para que sí suene.
    if (pitchAudioContext.state === "suspended") {
      await pitchAudioContext.resume();
    }

    pitchSourceNode.start();
    pitchIsPlaying = true;

    const st = $("pitchPlayStatus");
    if (st) st.textContent = "Estado: ▶️ reproduciendo con tono modificado…";
  } catch (e) {
    console.error("Error iniciando reproducción con pitch shift:", e);
    alert("❌ Error iniciando el cambio de tono: " + e.message);
    stopPitchShifted();
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
  if (st) st.textContent = "Estado: ⏹️ detenido.";
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
    alert("⚠️ Primero carga un archivo karaoke desde Biblioteca.");
    return;
  }

  const semitones = getNetSemitones();
  if (semitones === 0) {
    if (!confirm("El cambio actual es 0 semitonos (sin modificación). ¿Guardar de todas formas?")) {
      return;
    }
  }

  const status = $("pitchSaveStatus");
  const btn = $("pitchSaveBtn");

  if (btn) btn.disabled = true;
  if (status) status.textContent = "Estado: 🔄 procesando audio con el nuevo tono…";

  try {
    if (!window.CloudflareStorage?.saveLibraryItemToCloudflare) {
      throw new Error("CloudflareStorage no está disponible.");
    }

    stopPitchShifted();

    const renderedBuffer = await renderPitchShiftOffline(pitchAudioBuffer, semitones);
    const wavBlob = audioBufferToWavBlob(renderedBuffer);

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

    if (status) status.textContent = "Estado: ¡Guardado en la nube con éxito! ✅";
    alert(`🎯 "${finalName}" guardado correctamente en tu biblioteca.`);

    await renderLibrary("todos");
    if (typeof window.loadMyKaraokeSongs === "function") {
      await window.loadMyKaraokeSongs();
    }
    await loadPitchKaraokeOptions();
  } catch (e) {
    console.error("Error guardando audio modificado:", e);
    if (status) status.textContent = "Estado: ❌ error al guardar.";
    alert("❌ Error al guardar las modificaciones en la base de datos: " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function sendPitchShiftedToKaraokeMonitor() {
  if (!pitchLastSavedId) {
    alert("⚠️ Primero guarda el archivo con tono cambiado para poder enviarlo al monitor.");
    return;
  }

  try {
    stopPitchShifted();
    await loadKaraokeSong(pitchLastSavedId);

    const status = $("pitchSaveStatus");
    if (status) {
      status.textContent = "Estado: ✅ archivo cargado en el monitor karaoke.";
    }

    alert("✅ Enviado al monitor karaoke.\n\nCuando estés listo, ve a la pestaña Karaoke y presiona '🎙️ Iniciar Grabación' para empezar a cantar.");
  } catch (e) {
    console.error("Error enviando al monitor karaoke desde Cambiar tono:", e);
    alert("❌ No se pudo enviar al monitor karaoke: " + e.message);
  }
}

export async function renderPitchShiftOffline(audioBuffer, semitones) {
  const ratio = Math.pow(2, semitones / 12);

  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  await ensurePitchWorklet(offlineCtx);

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

  const rendered = await offlineCtx.startRendering();

  try { source.disconnect(); } catch (e) {}
  try { worklet.disconnect(); } catch (e) {}

  return rendered;
}
