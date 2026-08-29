import { $, safeAdd } from "../script.js";
import {
  getLibraryItemsByTypeFromSupabase,
  getLibraryItemsByIdFromSupabase,
  getAllLibraryItemsFromSupabase,
  updateLibraryItemsFromSupabase,
  renderLibrary,
} from './biblioteca.js';
import { noteToFrequency, frequencyToMidi, midiToNoteName, frequencyToNoteName } from "./afinador.js";
import { getAudioController, destroyAudioController, exportStereoWav, interleave } from "./audio-controller.js";

/** 
 * MÓDULO ESTUDIO — Sincronizador de Letras (Tap-Sync), Segmentación de Renglones e Inyección a Supabase
 */

// Variables de Control de Estado
let textSegments = [];
let baseTextSegments = [];
let autoScrollEnabled = true;
let studioTrackFileName = null;
let studioTrackBlob = null;
let studioSelectedTrackBlob = null;
let studioTrackId = null;
let studioSelectedTrackId = null;
let selectedVoiceBlob = null;
let studioChunks = [];
let selectedVoiceId = null;
let studioSelectedTrackName = null;
let selectedTextId = null;
let studioTextBlob = null;
let selectedTextBlob = null; 

// Variables del Motor Tap-Sync en Tiempo Real
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;
let currentTapPart = "P1";
let tapSyncParts = [];


export function initEstudio() {
  console.log("🎚️ [estudio.js] Inicializado con éxito"); 

  // Enlazar los tres clics de tus botones rosas del HTML
  safeAdd("loadStudioTrackBtn", "click", loadSelectedTrackFromLibraryStudio);
  safeAdd("loadSelectedVoiceBtn", "click", loadSelectedVoiceFromLibrary);
  safeAdd("loadSelectedTextBtn", "click", loadSelectedTextFromLibrary); // Vincula tu botón de letras manuales
  //safeAdd("studioTrackFile", "change", cargarAudioEstudio); 

  // Llenar automáticamente los tres menús desplegables al abrir la pestaña
  loadTrackOptionsInStudio();
  loadVoiceOptionsInStudio();
  loadTextOptionsInStudio(); // Alimenta el selector azul 'textLibrarySelect'
} 

function buildWordTimingFromSegment(seg) {
  if (!seg.words || seg.words.length === 0) {
    const wordsArr = (seg.text || "").split(" ").filter(Boolean);
    const duration = (seg.end || 0) - (seg.start || 0);
    const wordDuration = duration / Math.max(1, wordsArr.length);
    seg.words = wordsArr.map((word, i) => ({
      word: word,
      start: seg.start + i * wordDuration,
      end: seg.start + (i + 1) * wordDuration,
      pitch: 0,
      note: "C4"
    }));
  }
  return seg;
}

function splitSegmentsIntoKaraokeLines(segments, maxWordsPerLine = 6) {
  let output = [];
  segments.forEach(seg => {
    const words = seg.words || [];
    if (words.length <= maxWordsPerLine) {
      output.push(seg);
      return;
    }
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      const chunkWords = words.slice(i, i + maxWordsPerLine);
      const textLine = chunkWords.map(w => w.word).join(" ");
      output.push({
        start: chunkWords[0].start,
        end: chunkWords[chunkWords.length - 1].end,
        text: textLine,
        words: chunkWords
      });
    }
  });
  return output;
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

/*
export function cargarAudioEstudio(e) {
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
*/

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

    const urlOrBlob = item.file_url || item.audioBlob;

    if (typeof urlOrBlob === 'string') {
      // 1. Indicarle al reproductor que use permisos de origen cruzado nativos
      player.crossOrigin = "anonymous";
      player.src = item.file_url || item.audioBlob || "";
      
      // 2. SOLUCIÓN CRÍTICA: Añadir un "cache-buster" (?_cb=...) para obligar al navegador 
      // a ignorar la caché vieja y leer la nueva política CORS de Cloudflare
      const urlConCacheBuster = urlOrBlob.includes('?') 
        ? `${urlOrBlob}&_cb=${Date.now()}` 
        : `${urlOrBlob}?_cb=${Date.now()}`;

      console.log("📡 Descargando binario con bypass de caché:", urlConCacheBuster);
      
      const response = await fetch(urlConCacheBuster);
      studioTrackBlob = await response.blob();
    } else if (urlOrBlob instanceof Blob) {
      studioTrackBlob = urlOrBlob;
      player.src = URL.createObjectURL(urlOrBlob);
    } else {
      throw new Error("Formato de archivo no válido");
    }

    status.innerHTML = `🎵 <strong>Estado:</strong> pista cargada desde Biblioteca (<span style="color:#22c55e;">${item.name}</span>)`;

  } catch (error) {
    console.error("Error cargando pista:", error);
    alert("❌ No se pudo cargar la pista seleccionada: " + error.message);
  }
}

// ==========================================
// 🎙️ GESTIÓN Y DESPLIEGUE DE VOCES / LETRAS
// ==========================================
export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona un archivo</option>`;
  try {
    const voces = await getLibraryItemsByTypeFromSupabase("voz");
    //const grabaciones = await getLibraryItemsByTypeFromSupabase("grabacion");
    const merged = [...voces];

    console.log(`🔍 Buscando 'voz': se encontraron ${voces.length} coincidencias.`);
    //console.log(`🔍 Buscando 'grabacion': se encontraron ${grabaciones.length} coincidencias.`);

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

/**
 * Carga el archivo de audio de voz en el reproductor de la tarjeta de VOZ
 */
export async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect");
  const player = $("selectedVoicePlayer");
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  if (!select || !player || !status) return;

  const selectedId = select.value;
  if (!selectedId) {
    alert("⚠️ Selecciona un archivo de voz");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró el archivo de voz");
      return;
    }

    selectedVoiceBlob = item.file_url || item.audioBlob;
    selectedVoiceId = item.id;
    player.src = item.file_url || item.audioBlob || "";
    status.textContent = `Estado: voz seleccionada -> ${item.name}`;

    if (lyricsText && item.textoPlano) {
      lyricsText.value = item.textoPlano;
    }

    if (typeof window.cargarLetrasEnMonitor === "function") {
      window.cargarLetrasEnMonitor();
    }

  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar el archivo de voz seleccionado");
  }
}

export async function loadTextOptionsInStudio() {
  const select =
    document.getElementById("textLibrarySelect") ||
    $("textLibrarySelect");

  if (!select) {
    console.warn("⚠️ No se encontró el selector de letras en Estudio.");
    return;
  }

  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Selecciona un archivo";
  select.appendChild(defaultOption);

  try {
    const items = await getAllLibraryItemsFromSupabase();

    const textItems = items.filter(item =>
      item.type === "texto" ||
      item.type === "letra" ||
      item.type === "texto_plano"
    );

    console.log(`🔍 Buscando letras en Estudio: se encontraron ${textItems.length} coincidencias.`);

    if (!textItems.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay letras guardadas";
      select.appendChild(option);
      return;
    }

    textItems.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date ? new Date(item.date).toLocaleDateString() : "sin fecha"})`;
      select.appendChild(option);
    });

    console.log("🎨 Opciones de letras cargadas correctamente en Estudio.");
  } catch (e) {
    console.error("❌ Error al rellenar el menú de letras:", e);
  }
}

/**
 * 2. CARGAR LA LETRA SELECCIONADA EN EL MONITOR (Se ejecuta al pulsar el botón rosa)
 */
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
    //studioTextFileName = item.name;
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
    } else if (item.textoPlano || item.metadata?.textoPlano) {
      textInput.value = item.textoPlano || item.metadata?.textoPlano || "";
      status.innerHTML = `📄 <strong>Estado:</strong> Letra plana cargada en el monitor ⚡`;
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

    // Procesamos siempre como segmentación manual de texto plano para crear los renglones limpios
    const finalSegments = segmentarTextoPlano(correctedText);
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

    // Guardar únicamente la estructura limpia en Supabase
    await updateLibraryItemsFromSupabase(currentId, {
      name: item.name,
      textoPlano: correctedText,
      lyrics: finalSegments,
      isSincronizada: false
    });

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
        time: 0 // Usaremos una única marca de tiempo limpia para la sincronización nativa
      });
    });
  });

  return todasLasPalabras;
}

function isFiniteMidi(value) {
  return Number.isFinite(value) && value > 0 && value < 128;
}

function estimateWordWindowsFromLine(lineWords, lineStart, lineEnd) {
  const safeWords = Array.isArray(lineWords) ? lineWords : [];
  const duration = Math.max(0.05, (lineEnd || 0) - (lineStart || 0));

  if (!safeWords.length) return [];

  const totalChars = safeWords.reduce((sum, w) => {
    const txt = (w.text || w.word || "").trim();
    return sum + Math.max(1, txt.length);
  }, 0) || safeWords.length;

  let cursor = lineStart;

  return safeWords.map((w, index) => {
    const txt = (w.text || w.word || "").trim();
    const weight = Math.max(1, txt.length) / totalChars;

    let wordDuration = duration * weight;
    if (index === safeWords.length - 1) {
      wordDuration = Math.max(0.05, lineEnd - cursor);
    }

    const start = cursor;
    const end = cursor + wordDuration;
    cursor = end;

    return {
      ...w,
      text: w.text || w.word || "",
      word: w.word || w.text || "",
      startTime: start,
      start,
      end
    };
  });
}

async function decodeAudioBlobToMono(audioSource) {
  if (!audioSource) throw new Error("No hay audio para analizar pitch.");

  let blob = audioSource;

  if (typeof audioSource === "string") {
    const response = await fetch(audioSource);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el audio para análisis (${response.status}).`);
    }
    blob = await response.blob();
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const sampleRate = audioBuffer.sampleRate;

  let monoData;

  if (audioBuffer.numberOfChannels === 1) {
    monoData = new Float32Array(audioBuffer.getChannelData(0));
  } else {
    const length = audioBuffer.length;
    monoData = new Float32Array(length);

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channel = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        monoData[i] += channel[i] / audioBuffer.numberOfChannels;
      }
    }
  }

  try {
    await audioCtx.close();
  } catch (_) {}

  return { monoData, sampleRate };
}

function getMedianMidi(values) {
  const valid = values.filter(isFiniteMidi).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? Math.round((valid[mid - 1] + valid[mid]) / 2)
    : valid[mid];
}

function fillMissingMidis(words, fallbackMidi = 60) {
  if (!Array.isArray(words) || !words.length) return words || [];

  const existing = words.map(w => isFiniteMidi(w.midi) ? w.midi : null);
  const median = getMedianMidi(existing) || fallbackMidi;

  for (let i = 0; i < words.length; i++) {
    if (isFiniteMidi(words[i].midi)) continue;

    let replacement = null;

    for (let left = i - 1; left >= 0; left--) {
      if (isFiniteMidi(words[left].midi)) {
        replacement = words[left].midi;
        break;
      }
    }

    if (!isFiniteMidi(replacement)) {
      for (let right = i + 1; right < words.length; right++) {
        if (isFiniteMidi(words[right].midi)) {
          replacement = words[right].midi;
          break;
        }
      }
    }

    words[i].midi = isFiniteMidi(replacement) ? replacement : median;
  }

  return words;
}

async function analyzePitchForTimedWords(audioSource, timedWords) {
  if (!audioSource) {
    console.warn("⚠️ No hay audio fuente para analizar pitch.");
    return fillMissingMidis(
      timedWords.map(w => ({ ...w, midi: null })),
      60
    );
  }

  const { monoData, sampleRate } = await decodeAudioBlobToMono(audioSource);
  const audioController = getAudioController();

  const analyzedWords = [];

  for (const w of timedWords) {
    const start = Math.max(0, Number(w.start ?? w.startTime ?? 0));
    const end = Math.max(start + 0.05, Number(w.end ?? (start + 0.3)));

    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const endSample = Math.min(monoData.length, Math.floor(end * sampleRate));

    let midi = null;

    if (endSample - startSample >= 256) {
      const slice = monoData.slice(startSample, endSample);
      try {
        const freq = await audioController.detectPitch(slice, sampleRate);
        if (typeof freq === "number" && freq > 0) {
          midi = frequencyToMidi(freq);
        }
      } catch (err) {
        console.warn("⚠️ Error detectando pitch para palabra:", w.word || w.text, err);
      }
    }

    analyzedWords.push({
      ...w,
      text: w.text || w.word || "",
      word: w.word || w.text || "",
      midi: isFiniteMidi(midi) ? midi : null
    });
  }

  return fillMissingMidis(analyzedWords, 60);
}

function groupWordsToKaraokeSegments(words) {
  if (!Array.isArray(words) || !words.length) return [];

  const grouped = new Map();

  words.forEach((w) => {
    const renglon = w.renglon || 1;
    if (!grouped.has(renglon)) {
      grouped.set(renglon, []);
    }
    grouped.get(renglon).push(w);
  });

  const segments = [];

  for (const [, rowWords] of grouped.entries()) {
    const ordered = [...rowWords].sort((a, b) => {
      const sa = Number(a.start ?? a.startTime ?? 0);
      const sb = Number(b.start ?? b.startTime ?? 0);
      return sa - sb;
    });

    const normalizedWords = ordered.map((w, idx) => {
      const start = Number(w.start ?? w.startTime ?? 0);
      const next = ordered[idx + 1];
      const end = Number(
        w.end ??
        (next ? (next.start ?? next.startTime ?? (start + 0.3)) : (start + 0.3))
      );

      return {
        word: w.word || w.text || "",
        text: w.text || w.word || "",
        start,
        end,
        midi: isFiniteMidi(w.midi) ? w.midi : 60,
        parte: w.parte || "P1"
      };
    });

    const parteDominante = ordered[0]?.parte || "P1";

    segments.push({
      start: normalizedWords[0]?.start || 0,
      end: normalizedWords[normalizedWords.length - 1]?.end || 0,
      text: normalizedWords.map(w => w.word).join(" "),
      parte: parteDominante,
      midi: normalizedWords[0]?.midi || 60,
      words: normalizedWords
    });
  }

  return segments.sort((a, b) => (a.start || 0) - (b.start || 0));
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

  const key = e.key;
  const code = e.code;

  if (code === "Space" || key === " ") {
    e.preventDefault();
    recordTap();
    return;
  }

  if (key === "1" || code === "Digit1" || code === "Numpad1") {
    e.preventDefault();
    setCurrentTapPart("P1");
    console.log("🎤 Parte activa: P1");
    return;
  }

  if (key === "2" || code === "Digit2" || code === "Numpad2") {
    e.preventDefault();
    setCurrentTapPart("P2");
    console.log("🎤 Parte activa: P2");
    return;
  }

  if (key === "3" || code === "Digit3" || code === "Numpad3") {
    e.preventDefault();
    setCurrentTapPart("DUO");
    console.log("🎤 Parte activa: DÚO");
    return;
  }

  if (code === "Escape" || key === "Escape") {
    e.preventDefault();
    cancelTapSync();
  }
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

export function setCurrentTapPart(part) {
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

export function recordTap() {
  const player = window.activeTapPlayer || $("selectedVoicePlayer") || $("player");
  if (!tapSyncMode || !player) return;

  tapSyncTimestamps.push(player.currentTime);
  tapSyncParts.push(currentTapPart);

  console.log(
    `🎵 [estudio.js] TAP REGISTRADO -> Línea ${tapSyncCurrentIndex + 1}: "${tapSyncLines[tapSyncCurrentIndex]}" a los ${player.currentTime.toFixed(2)}s [${currentTapPart}]`
  );

  tapSyncCurrentIndex++;

  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    tapSyncMode = false;
    player.pause();
    document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });

    if ($("tapSyncActive")) $("tapSyncActive").style.display = "none";
    if ($("tapSyncResult")) $("tapSyncResult").style.display = "block";
    if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "none";
    if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "inline-block";
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

function convertirWordsASegmentos(words) {
  if (!Array.isArray(words) || words.length === 0) return [];

  const agrupados = new Map();

  words.forEach((w) => {
    const renglon = w.renglon || 1;
    if (!agrupados.has(renglon)) {
      agrupados.set(renglon, []);
    }
    agrupados.get(renglon).push(w);
  });

  const segmentos = [];

  for (const [, lineWords] of agrupados.entries()) {
    const sorted = [...lineWords].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    const wordsNormalizadas = sorted.map((w, idx) => {
      const start = Number.isFinite(w.start) ? w.start : (w.startTime || 0);
      const next = sorted[idx + 1];
      const end = Number.isFinite(w.end)
        ? w.end
        : (next ? (next.startTime || start + 0.6) : start + 0.6);

      return {
        word: w.word || w.text || "",
        text: w.text || w.word || "",
        start,
        end,
        midi: Number.isFinite(w.midi) ? w.midi : null
      };
    });

    segmentos.push({
      start: wordsNormalizadas[0]?.start || 0,
      end: wordsNormalizadas[wordsNormalizadas.length - 1]?.end || 0,
      text: wordsNormalizadas.map(w => w.word).join(" "),
      parte: sorted[0]?.parte || "P1",
      words: wordsNormalizadas,
      midi: Number.isFinite(wordsNormalizadas[0]?.midi) ? wordsNormalizadas[0].midi : null
    });
  }

  return segmentos.sort((a, b) => (a.start || 0) - (b.start || 0));
}

export async function applyTapSync() {
  const player = $("selectedVoicePlayer") || $("player");
  const total = player ? player.duration : 0;
  const syncMode = window.currentTapSyncModeType || "linea";

  const segments = tapSyncLines.map((line, i) => {
    const start = tapSyncTimestamps[i] || 0;
    let end = tapSyncTimestamps[i + 1] || total || start + (syncMode === "palabra" ? 0.6 : 3);

    const numPalabras = line.split(/\s+/).filter(Boolean).length;

    if (syncMode === "linea" && end - start > 1.2) {
      end = start + Math.min(end - start, numPalabras * 0.45);
    } else if (syncMode === "palabra" && end - start > 0.8) {
      end = start + 0.8;
    }

    const seg = buildWordTimingFromSegment({ start, end, text: line });

    if (Array.isArray(seg.words)) {
      seg.words = seg.words.map(w => ({
        ...w,
        midi: Number.isFinite(w.midi) ? w.midi : null
      }));
    }

    seg.midi = Number.isFinite(seg.midi) ? seg.midi : null;
    return seg;
  });

  baseTextSegments = segments;
  textSegments = segments;

  const pistaInstrumentalActiva = studioSelectedTrackBlob || studioTrackBlob;
  const nombrePistaActiva = studioSelectedTrackName || studioTrackFileName || "Canción Sincronizada";

  if (pistaInstrumentalActiva) {
    try {
      console.log(`💾 [estudio.js] Guardando proyecto: "Karaoke - ${nombrePistaActiva}" en biblioteca.`);
      await addLibraryItem({
        name: `Karaoke - ${nombrePistaActiva}`,
        type: "karaoke",
        audioBlob: pistaInstrumentalActiva,
        date: new Date().toLocaleString("es-ES"),
        transcription: segments,
        metadata: { title: nombrePistaActiva, origen: "Estudio Sync Master" }
      });
    } catch (err) {
      console.error("❌ Error guardando karaoke:", err);
    }
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
  if (status) {
    status.textContent = "Estado: sincronizando tiempos y analizando pitch... ⏳";
  }

  const audioDuration = activePlayer ? activePlayer.duration : 0;
  const avgInterval = tapSyncTimestamps.length >= 2
    ? (tapSyncTimestamps[tapSyncTimestamps.length - 1] - tapSyncTimestamps[0]) / (tapSyncTimestamps.length - 1)
    : (audioDuration || 3.0);

  const currentId = selectedVoiceId || selectedTextId;
  if (!currentId) return;

  try {
    const item = await getLibraryItemsByIdFromSupabase(currentId);
    if (!item) throw new Error("No se pudo obtener el elemento de la biblioteca remota");

    const baseWords = Array.isArray(item.lyrics) && item.lyrics.length
      ? item.lyrics.map((w, idx) => ({
          id: w.id || (idx + 1),
          text: w.text || w.word || "",
          word: w.word || w.text || "",
          renglon: w.renglon || 1,
          parte: w.parte || "P1"
        }))
      : segmentarTextoPlano(($("lyricsText")?.value || "").trim());

    if (!baseWords.length) {
      throw new Error("No hay palabras base para sincronizar.");
    }

    let timedWords = [];
    const isWordMode = (window.currentTapSyncModeType === "palabra");

    if (isWordMode) {
      timedWords = baseWords.map((word, index) => {
        const startTime = tapSyncTimestamps[index] || 0;
        const nextTap = tapSyncTimestamps[index + 1];
        const endTime = Number.isFinite(nextTap) ? nextTap : (startTime + Math.max(0.2, avgInterval || 0.5));

        return {
          id: word.id || (index + 1),
          text: word.text || word.word || "",
          word: word.word || word.text || "",
          renglon: word.renglon || 1,
          parte: tapSyncParts[index] || word.parte || "P1",
          startTime,
          start: startTime,
          end: endTime
        };
      });
    } else {
      let globalWordIndex = 0;

      tapSyncLines.forEach((lineText, lineIndex) => {
        const startTimeLine = tapSyncTimestamps[lineIndex] || 0;
        const endTimeLine = tapSyncTimestamps[lineIndex + 1] || (startTimeLine + avgInterval);
        const parteLinea = tapSyncParts[lineIndex] || "P1";

        const wordsInRow = baseWords.filter(w => (w.renglon || 1) === (lineIndex + 1));

        const sourceWords = wordsInRow.length
          ? wordsInRow
          : lineText.split(/\s+/).filter(Boolean).map((txt) => ({
              id: ++globalWordIndex,
              text: txt,
              word: txt,
              renglon: lineIndex + 1,
              parte: parteLinea
            }));

        const estimated = estimateWordWindowsFromLine(sourceWords, startTimeLine, endTimeLine);

        estimated.forEach((w) => {
          timedWords.push({
            id: w.id || (++globalWordIndex),
            text: w.text || w.word || "",
            word: w.word || w.text || "",
            renglon: w.renglon || (lineIndex + 1),
            parte: parteLinea,
            startTime: w.startTime,
            start: w.start,
            end: w.end
          });
        });
      });
    }

    if (status) {
      status.textContent = "Estado: detectando notas por palabra desde la voz seleccionada... 🎵";
    }

    const audioSourceForPitch =
      selectedVoiceBlob ||
      item.file_url ||
      item.audioBlob ||
      null;

    const analyzedWords = await analyzePitchForTimedWords(audioSourceForPitch, timedWords);

    const finalWords = analyzedWords.map((w, index) => ({
      id: w.id || (index + 1),
      text: w.text || w.word || "",
      word: w.word || w.text || "",
      renglon: w.renglon || 1,
      parte: w.parte || "P1",
      startTime: Number(w.startTime ?? w.start ?? 0),
      start: Number(w.start ?? w.startTime ?? 0),
      end: Number(w.end ?? ((w.start ?? w.startTime ?? 0) + 0.3)),
      midi: isFiniteMidi(w.midi) ? w.midi : 60
    }));

    const karaokeSegments = groupWordsToKaraokeSegments(finalWords);

    textSegments = finalWords;
    baseTextSegments = finalWords;

    const trackItem = studioTrackId
      ? await getLibraryItemsByIdFromSupabase(studioTrackId)
      : null;

    const fileUrlFinal =
      trackItem?.file_url ||
      item.file_url ||
      item.audioUrl ||
      item.audioBlob ||
      null;

    const filePathFinal =
      trackItem?.file_path ||
      item.file_path ||
      null;

    await updateLibraryItemsFromSupabase(currentId, {
      name: `${item.name.replace(" - [KARAOKE]", "")} - [KARAOKE]`,
      type: "karaoke",
      lyrics: karaokeSegments,
      transcription: karaokeSegments,
      isSincronizada: true,
      isReadyKaraoke: true,
      tapModeStyle: window.currentTapSyncModeType,
      file_url: fileUrlFinal,
      file_path: filePathFinal
    });

    if (status) {
      status.textContent = "Estado: ¡Karaoke generado con tiempos y notas automáticas! ✅";
    }

    console.log("✅ Karaoke generado con pitch automático por palabra.", {
      totalWords: finalWords.length,
      totalSegments: karaokeSegments.length,
      mode: window.currentTapSyncModeType
    });

    await renderLibrary("todos");

    alert(
      "✅ ¡Sincronización completada!\n\n" +
      "Se guardaron los tiempos y las notas automáticas por palabra."
    );

  } catch (error) {
    console.error("Error al finalizar sincronización:", error);
    if (status) status.textContent = "Estado: Error al guardar la sincronización";
    alert("❌ Error al aplicar taps y analizar pitch: " + error.message);
  }
}
