import { $, safeAdd } from "../script.js";
import {
  getLibraryItemsByTypeFromSupabase,
  getLibraryItemsByIdFromSupabase,
  updateLibraryItemsFromSupabase,
  renderLibrary
} from './biblioteca.js'; 

/** 
 * MÓDULO ESTUDIO — Sincronizador de Letras (Tap-Sync), Segmentación de Renglones e Inyección a Supabase
 */

// Variables de Control de Estado
let baseTranscriptionSegments = [];
let transcriptionSegments = [];
let textSegments = [];
let baseTextSegments = [];
let autoScrollEnabled = true;
let studioTrackFileName = "";
let studioTrackBlob = null;
let studioTrackId = null;
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let studioTextFileName = "";
let selectedTextId = null;
let studioTextBlob = null;
let selectedTextBlob = null; 

// Variables del Motor Tap-Sync en Tiempo Real
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;
let tapSyncParts = [];
let currentTapPart = "P1"; 

export function initEstudio() {
  console.log("🎚️ [estudio.js] Inicializado con éxito"); 

  safeAdd("loadStudioTrackBtn", "click", loadSelectedTrackFromLibraryStudio);
  safeAdd("loadSelectedVoiceBtn", "click", loadSelectedVoiceFromLibrary);
  safeAdd("studioTrackFile", "change", cargarAudioEstudio); 

  loadTrackOptionsInStudio();
  loadVoiceOptionsInStudio();
} 

function getMediaErrorDesc(code) {
  const errors = { 1: "MEDIA_ERR_ABORTED", 2: "MEDIA_ERR_NETWORK", 3: "MEDIA_ERR_DECODE", 4: "MEDIA_ERR_SRC_NOT_SUPPORTED" };
  return errors[code] || "Error desconocido de reproducción";
} 

// ==========================================
// 🎵 PROCESAMIENTO Y CARGA DE PISTAS BASE
// ========================================== 

export async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect");
  if (!select) return; 

  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  try {
    const tracks = await getLibraryItemsByTypeFromSupabase("pista");
    if (!tracks.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay pistas guardadas";
      select.appendChild(option);
      return;
    }
    tracks.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date ? new Date(item.date).toLocaleDateString() : "sin fecha"})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

function cargarAudioEstudio(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  studioTrackFileName = file.name;
  studioTrackBlob = file;
  studioTrackId = null;

  const player = $("player");
  const status = $("studioStatus");

  if (player) {
    player.src = URL.createObjectURL(file);
  }
  if (status) {
    status.textContent = `Estado: pista cargada (${file.name})`;
  }
}

export async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect");
  const player = $("player");
  let status = $("studioStatus");

  if (!status && player) {
    status = document.createElement("p");
    status.id = "studioStatus";
    status.style.fontSize = "14px";
    status.style.marginTop = "10px";
    player.parentNode.insertBefore(status, player.nextSibling);
  }

  if (!select || !player || !status) return;

  const selectedId = select.value;
  if (!selectedId) {
    alert("⚠️ Selecciona una pista");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró la pista");
      return;
    }

    studioTrackFileName = item.name;
    studioTrackId = item.id;
    studioTrackBlob = item.file_url || item.audioBlob;
    player.src = item.file_url || item.audioBlob || "";
    status.innerHTML = `🎵 <strong>Estado:</strong> pista cargada desde Biblioteca (<span style="color:#22c55e;">${item.name}</span>)`;
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar la pista seleccionada");
  }
}

// ==========================================
// 🎙️ GESTIÓN Y DESPLIEGUE DE VOCES / LETRAS
// ==========================================

export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;
  try {
    const voces = await getLibraryItemsByTypeFromSupabase("voz");
    const grabaciones = await getLibraryItemsByTypeFromSupabase("grabacion");
    const merged = [...voces, ...grabaciones];

    if (!merged.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay voces guardadas";
      select.appendChild(option);
      return;
    }

    merged.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date ? new Date(item.date).toLocaleDateString() : "sin fecha"})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

export async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect");
  const player = $("selectedVoicePlayer");
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  if (!select || !player || !status) return;

  const selectedId = select.value;
  if (!selectedId) {
    alert("⚠️ Selecciona un archivo");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró el archivo");
      return;
    }

    if (item.type === "texto") {
      selectedVoiceBlob = null;
      selectedVoiceId = item.id;
      player.src = "";
      status.textContent = `Estado: Letra manual seleccionada -> ${item.name}`;

      if (Array.isArray(item.lyrics) && item.lyrics.length > 0) {
        transcriptionSegments = item.lyrics.map(word => ({
          id: word.id,
          text: word.text,
          startTime: word.startTime,
          duration: word.duration,
          pitch: word.pitch
        }));

        if (typeof window.renderKaraokeLyrics === "function") window.renderKaraokeLyrics(transcriptionSegments);
        if (typeof window.cargarLetrasEnMonitor === "function") window.cargarLetrasEnMonitor();

        if (lyricsText) {
          lyricsText.value = transcriptionSegments.map(seg => seg.text || "").join(" ").trim();
        }
        status.textContent = "Estado: Letra manual cargada en el Monitor ⚡";
      } else {
        transcriptionSegments = [];
        if (lyricsText) lyricsText.value = "";
        status.textContent = "Estado: El archivo de texto está vacío";
      }
      return;
    }

    selectedVoiceBlob = item.file_url || item.audioBlob;
    selectedVoiceId = item.id;
    player.src = item.file_url || item.audioBlob || "";
    status.textContent = `Estado: voz seleccionada -> ${item.name}`;

    if (Array.isArray(item.transcription) && item.transcription.length > 0) {
      baseTranscriptionSegments = item.transcription.map(seg =>
        window.AudioUtils && window.AudioUtils.buildWordTimingFromSegment
          ? window.AudioUtils.buildWordTimingFromSegment(seg)
          : seg
      );
      transcriptionSegments = baseTranscriptionSegments;

      if (typeof window.renderKaraokeLyrics === "function") window.renderKaraokeLyrics(transcriptionSegments);
      if (typeof window.cargarLetrasEnMonitor === "function") window.cargarLetrasEnMonitor();

      if (lyricsText) {
        lyricsText.value = transcriptionSegments.map(seg => seg.text || "").join("\n").trim();
      }
      status.textContent = "Estado: Voz seleccionada (Letras cargadas de memoria ⚡)";
    } else {
      baseTranscriptionSegments = [];
      transcriptionSegments = [];
      if (lyricsText) lyricsText.value = "";
      status.textContent = `Estado: voz seleccionada -> ${item.name} (sin transcripción)`;
    }
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar el archivo seleccionado");
  }
}

export async function loadTextOptionsInStudio() {
  const select = $("textLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una letra desde Biblioteca</option>`;
  try {
    const items = await getLibraryItemsByTypeFromSupabase("texto");
    items.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
  } catch (e) {
    console.error(e);
  }
}

export async function loadSelectedTextFromLibrary() {
  const select = $("textLibrarySelect");
  const status = $("selectedTextStatus");
  const textInput = $("lyricsText");

  if (!select || !status || !textInput) return;

  const selectedId = select.value;
  if (!selectedId) {
    alert("⚠️ Selecciona una letra de la lista primero.");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró la letra en la base de datos.");
      return;
    }

    selectedTextId = item.id;
    selectedVoiceId = item.id;
    studioTextFileName = item.name;
    studioTextBlob = item.file_url || null;

    if (Array.isArray(item.lyrics) && item.lyrics.length > 0) {
      textSegments = item.lyrics;
      if (typeof window.renderKaraokeLyrics === "function") window.renderKaraokeLyrics(textSegments);

      let textoFormateadoParaPantalla = "";
      textSegments.forEach((word, index) => {
        textoFormateadoParaPantalla += word.text;
        const nextWord = textSegments[index + 1];
        if (nextWord) {
          textoFormateadoParaPantalla += nextWord.renglon !== word.renglon ? "\n" : " ";
        }
      });

      textInput.value = textoFormateadoParaPantalla;
      status.innerHTML = `📄 <strong>Estado:</strong> Letra cargada respetando tus líneas de estrofa original ⚡`;
    } else {
      textSegments = [];
      textInput.value = "";
      status.textContent = "Estado: El archivo de texto no contiene palabras válidas.";
    }
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar la letra seleccionada.");
  }
}

// ==========================================
// 📝 MONITOR Y EDICIÓN MANUAL DE LETRAS
// ==========================================

export async function applyCorrectedLyrics() {
  const lyricsText = $("lyricsText");
  const text = $("text");
  const currentTextInput = lyricsText || text;
  const currentId = selectedVoiceId || selectedTextId;
  const statusId = selectedVoiceId ? "selectedVoiceStatus" : "selectedTextStatus";
  const status = $(statusId);

  if (!currentTextInput) return;
  const correctedText = currentTextInput.value.trim();

  if (!correctedText) {
    alert("⚠️ No hay texto corregido para aplicar.");
    return;
  }
  if (!currentId) {
    alert("❌ No hay ninguna canción o letra seleccionada en el sistema.");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(currentId);
    if (!item) throw new Error("No se encontró el ítem en la base de datos");

    let finalSegments = [];

    if (item.type === "texto") {
      finalSegments = segmentarTextoPlano(correctedText);
      baseTextSegments = finalSegments;
      textSegments = finalSegments;

      if (typeof window.renderKaraokeLyrics === "function") window.renderKaraokeLyrics(textSegments);

      let textoFormateado = "";
      textSegments.forEach((word, index) => {
        textoFormateado += word.text;
        const nextWord = textSegments[index + 1];
        if (nextWord) {
          textoFormateado += (nextWord.renglon !== word.renglon) ? "\n" : " ";
        }
      });

      if (text) text.value = textoFormateado;
      if (lyricsText) lyricsText.value = textoFormateado;

      await updateLibraryItemsFromSupabase(currentId, {
        lyrics: finalSegments,
        isSincronizada: false
      });
    } else {
      if (!Array.isArray(baseTranscriptionSegments) || !baseTranscriptionSegments.length) {
        alert("Se aplican los cambios básicos.");
        return;
      }

      if (typeof window.buildSegmentsFromMultilineLyrics === "function") {
        finalSegments = window.buildSegmentsFromMultilineLyrics(correctedText, baseTranscriptionSegments);
      } else {
        throw new Error("No está disponible la función buildSegmentsFromMultilineLyrics para reconstruir la letra corregida.");
      }

      baseTranscriptionSegments = finalSegments;
      transcriptionSegments = finalSegments;

      if (typeof window.renderKaraokeLyrics === "function") window.renderKaraokeLyrics(transcriptionSegments);
      if (lyricsText) lyricsText.value = transcriptionSegments.map(seg => seg.text || "").join("\n").trim();

      await updateLibraryItemsFromSupabase(currentId, { transcription: baseTranscriptionSegments });
    }

    if (status) status.textContent = "Estado: letra corregida aplicada y guardada ✅";
    alert("✅ Cambios aplicados y guardados correctamente.");
  } catch (error) {
    console.error("Error al aplicar la letra corregida:", error);
    if (status) status.textContent = "Estado: Error al guardar las correcciones";
    alert("❌ No se pudieron salvar las modificaciones del monitor.");
  }
}

export function segmentarTextoPlano(texto) {
  if (!texto || texto.trim() === "") return [];

  const textoLimpio = texto.replace(/[ \t]+/g, ' ').trim();
  const lineas = textoLimpio.split('\n');
  let palabraGlobalIndex = 1;
  let todasLasPalabras = [];

  lineas.forEach((lineaTexto, renglonIndex) => {
    const lineaLimpia = lineaTexto.trim();
    if (!lineaLimpia) return;

    const palabrasDeLaLinea = lineaLimpia.split(' ');
    palabrasDeLaLinea.forEach((palabra) => {
      todasLasPalabras.push({
        id: palabraGlobalIndex++,
        text: palabra,
        renglon: renglonIndex + 1,
        startTime: 0,
        duration: 0,
        pitch: 0
      });
    });
  });

  return todasLasPalabras;
}

// ==========================================
// ⏱️ MOTOR TAP-SYNC EN TIEMPO REAL
// ==========================================

export async function startTapSync() {
  const lyricsText = $("lyricsText");
  const text = $("text");
  const voicePlayer = $("selectedVoicePlayer");
  const trackPlayer = $("player");
  const methodSelect = $("tapSyncMethodSelect");
  const modoSeleccionado = methodSelect ? methodSelect.value : "linea";
  const activePlayer = (voicePlayer && voicePlayer.src) ? voicePlayer : trackPlayer;
  const textoActivo = (lyricsText && lyricsText.value.trim()) ? lyricsText.value.trim() : (text ? text.value.trim() : "");

  if (!textoActivo) {
    alert("⚠️ Primero escribe, carga o corrige la letra en el área de texto.");
    return;
  }
  if (!activePlayer || !activePlayer.src) {
    alert("⚠️ Primero carga un audio (Pista o Voz) en el Estudio para hacer los Taps.");
    return;
  }

  window.currentTapSyncModeType = modoSeleccionado;
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  tapSyncParts = [];
  currentTapPart = "P1";
  tapSyncMode = true;

  updateTapPartButtonsUI();

  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "none";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "inline-block";
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "block";
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "none";

  updateTapSyncDisplay();
  activePlayer.currentTime = 0;

  console.log('⏳ Esperando a que el audio cargue en segundo plano...');

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Audio load timeout (60s)')), 60000);

    activePlayer.addEventListener('canplay', () => {
      clearTimeout(timeout);
      window.activeTapPlayer = activePlayer;
      resolve();
    }, { once: true });

    activePlayer.addEventListener('error', () => {
      clearTimeout(timeout);
      const mediaError = activePlayer.error;
      reject(new Error('Audio error: ' + (mediaError ? getMediaErrorDesc(mediaError.code) : "Desconocido")));
    }, { once: true });

    if (activePlayer.readyState < 3) activePlayer.load();
  });

  if (modoSeleccionado === "linea") {
    tapSyncLines = textoActivo.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  } else {
    tapSyncLines = textoActivo.split(/\s+/).map(palabra => palabra.trim()).filter(palabra => palabra.length > 0);
  }

  if (tapSyncLines.length === 0) {
    alert("⚠️ No hay elementos de texto válidos para sincronizar.");
    return;
  }

  try {
    await activePlayer.play();
  } catch (e) {
    alert('❌ No se pudo reproducir el audio de taps: ' + e.message);
    return;
  }

  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });
  document.addEventListener("keydown", handleTapSyncKeypress, { capture: true });
}

export function handleTapSyncKeypress(e) {
  if (!tapSyncMode) return;
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    recordTap();
    return;
  }
  if (e.key === "1") { setCurrentTapPart("P1"); return; }
  if (e.key === "2") { setCurrentTapPart("P2"); return; }
  if (e.key === "3") { setCurrentTapPart("DUO"); return; }
  if (e.code === "Escape") { cancelTapSync(); }
}

export function cancelTapSync() {
  tapSyncMode = false;
  const player = window.activeTapPlayer || $("selectedVoicePlayer") || $("player");
  if (player) {
    try {
      player.pause();
      player.currentTime = 0;
    } catch(e) {}
  }
  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });
  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "inline-block";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "none";
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "none";
  console.log("⏹️ Sesión de marcación de taps cancelada.");
}

function setCurrentTapPart(part) {
  if (part !== "P1" && part !== "P2" && part !== "DUO") return;
  currentTapPart = part;
  updateTapPartButtonsUI();
}

function updateTapPartButtonsUI() {
  const btnP1 = $("tapPartP1Btn");
  const btnP2 = $("tapPartP2Btn");
  const btnDuo = $("tapPartDuoBtn");
  if (btnP1) btnP1.classList.toggle("active", currentTapPart === "P1");
  if (btnP2) btnP2.classList.toggle("active", currentTapPart === "P2");
  if (btnDuo) btnDuo.classList.toggle("active", currentTapPart === "DUO");
}

function recordTap() {
  if (!tapSyncMode) return;
  const player = window.activeTapPlayer || $("selectedVoicePlayer");
  if (!player || player.paused || player.ended || player.readyState < 2) return;

  const currentTime = player.currentTime;
  tapSyncTimestamps.push(currentTime);
  tapSyncParts.push(currentTapPart);
  tapSyncCurrentIndex++;

  const tapBtn = $("tapBeatBtn");
  if (tapBtn) {
    tapBtn.style.transform = "scale(0.95)";
    tapBtn.style.background = "linear-gradient(135deg, #16a34a, #14532d)";
    setTimeout(() => {
      tapBtn.style.transform = "scale(1)";
      tapBtn.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
    }, 100);
  }

  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    finishTapSync();
  } else {
    updateTapSyncDisplay();
  }
}

function updateTapSyncDisplay() {
  const currentLineEl = $("tapCurrentLine");
  const progressEl = $("tapProgress");

  if (currentLineEl && tapSyncCurrentIndex < tapSyncLines.length) {
    currentLineEl.textContent = tapSyncLines[tapSyncCurrentIndex];
  }
  if (progressEl) {
    const tipoUnidad = (window.currentTapSyncModeType === "palabra") ? "palabras" : "líneas";
    progressEl.textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} ${tipoUnidad}`;
  }
}

export async function finishTapSync() {
  tapSyncMode = false;

  if (tapSyncTimestamps.length !== tapSyncLines.length) {
    const remaining = tapSyncLines.length - tapSyncTimestamps.length;
    const tipoUnidad = (window.currentTapSyncModeType === "palabra") ? "palabras" : "líneas";

    if (!confirm(
      `⚠️ Sincronización incompleta: faltan ${remaining} ${tipoUnidad} por tocar.\n\n` +
      `Actualmente: ${tapSyncTimestamps.length} / ${tapSyncLines.length} ${tipoUnidad}\n\n` +
      `¿Deseas aplicar de todos modos?`
    )) {
      cancelTapSync();
      return;
    }
  }

  const activePlayer = window.activeTapPlayer || $("selectedVoicePlayer") || $("player");
  if (activePlayer) {
    try { activePlayer.pause(); } catch (e) {}
  }

  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });

  if ($("tapSyncActive")) $("tapSyncActive").style.display = "none";
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "block";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "none";
  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "inline-block";

  const statusId = selectedVoiceId ? "selectedVoiceStatus" : "selectedTextStatus";
  const status = $(statusId);
  if (status) status.textContent = "Estado: Aplicando tiempos y analizando notas...";

  const audioDuration = activePlayer ? activePlayer.duration : 0;
  const avgInterval = tapSyncTimestamps.length >= 2
    ? (tapSyncTimestamps[tapSyncTimestamps.length - 1] - tapSyncTimestamps[0]) / (tapSyncTimestamps.length - 1)
    : (audioDuration || 3.0);

  const currentId = selectedVoiceId || selectedTextId;
  if (!currentId) return;

  try {
    const item = await getLibraryItemsByIdFromSupabase(currentId);
    if (!item) throw new Error("No se pudo obtener el elemento de la biblioteca remota");

    let finalSegments = [];

    if (item.type === "texto") {
      const esPalabraPorPalabra = (window.currentTapSyncModeType === "palabra");

      if (esPalabraPorPalabra) {
        finalSegments = item.lyrics.map((word, index) => {
          const startTime = tapSyncTimestamps[index] || 0;
          const nextTime = tapSyncTimestamps[index + 1] || (startTime + avgInterval);

          return {
            id: word.id,
            text: word.text,
            renglon: word.renglon || 1,
            startTime,
            duration: Math.max(0.1, nextTime - startTime),
            pitch: word.pitch || 0,
            parte: tapSyncParts[index] || "P1"
          };
        });
      } else {
        let globalWordId = 1;

        tapSyncLines.forEach((lineText, lineIndex) => {
          const startTimeFrase = tapSyncTimestamps[lineIndex] || 0;
          const endTimeFrase = tapSyncTimestamps[lineIndex + 1] || (startTimeFrase + avgInterval);
          const duracionTotalFrase = endTimeFrase - startTimeFrase;
          const parteLinea = tapSyncParts[lineIndex] || "P1";

          const palabrasDeLaLinea = lineText.split(/\s+/).filter(w => w.trim().length > 0);
          const totalPalabras = palabrasDeLaLinea.length;
          if (totalPalabras === 0) return;

          const duracionPorPalabra = duracionTotalFrase / totalPalabras;

          palabrasDeLaLinea.forEach((palabraText, wordIndex) => {
            const wordStart = startTimeFrase + (wordIndex * duracionPorPalabra);

            finalSegments.push({
              id: globalWordId++,
              text: palabraText,
              renglon: lineIndex + 1,
              startTime: wordStart,
              duration: duracionPorPalabra,
              pitch: null,
              parte: parteLinea,
              words: [{
                start: wordStart,
                end: wordStart + duracionPorPalabra,
                word: palabraText
              }]
            });
          });
        });
      }

      textSegments = finalSegments;
      baseTextSegments = finalSegments;

      await updateLibraryItemsFromSupabase(currentId, {
        lyrics: finalSegments,
        isSincronizada: true,
        tapModeStyle: window.currentTapSyncModeType
      });
    } else {
      const esPalabraPorPalabra = (window.currentTapSyncModeType === "palabra");

      if (esPalabraPorPalabra && Array.isArray(baseTranscriptionSegments) && baseTranscriptionSegments.length) {
        finalSegments = baseTranscriptionSegments.map((seg, index) => {
          const startTime = tapSyncTimestamps[index] || seg.startTime || seg.start || 0;
          const nextTime = tapSyncTimestamps[index + 1] || (startTime + avgInterval);

          return {
            ...seg,
            startTime,
            start: startTime,
            duration: Math.max(0.1, nextTime - startTime),
            end: nextTime,
            parte: tapSyncParts[index] || seg.parte || "P1"
          };
        });
      } else {
        let globalWordId = 1;

        tapSyncLines.forEach((lineText, lineIndex) => {
          const startTimeFrase = tapSyncTimestamps[lineIndex] || 0;
          const endTimeFrase = tapSyncTimestamps[lineIndex + 1] || (startTimeFrase + avgInterval);
          const duracionTotalFrase = endTimeFrase - startTimeFrase;
          const parteLinea = tapSyncParts[lineIndex] || "P1";

          const palabrasDeLaLinea = lineText.split(/\s+/).filter(w => w.trim().length > 0);
          const totalPalabras = palabrasDeLaLinea.length;
          if (totalPalabras === 0) return;

          const duracionPorPalabra = duracionTotalFrase / totalPalabras;

          palabrasDeLaLinea.forEach((palabraText, wordIndex) => {
            const wordStart = startTimeFrase + (wordIndex * duracionPorPalabra);

            finalSegments.push({
              id: globalWordId++,
              text: palabraText,
              startTime: wordStart,
              start: wordStart,
              duration: duracionPorPalabra,
              end: wordStart + duracionPorPalabra,
              pitch: null,
              parte: parteLinea,
              words: [{
                start: wordStart,
                end: wordStart + duracionPorPalabra,
                word: palabraText
              }]
            });
          });
        });
      }

      transcriptionSegments = finalSegments;
      baseTranscriptionSegments = finalSegments;

      await updateLibraryItemsFromSupabase(currentId, {
        transcription: finalSegments,
        isSincronizada: true,
        tapModeStyle: window.currentTapSyncModeType
      });
    }

    if (status) status.textContent = "Estado: Sincronización guardada ✅";
    await renderLibrary("todos");
    alert("✅ ¡Sincronización por taps guardada con éxito!");
  } catch (error) {
    console.error("Error al finalizar sincronización:", error);
    if (status) status.textContent = "Estado: Error al guardar la sincronización";
    alert("❌ Error al guardar la línea final de taps en la base de datos.");
  }
}
