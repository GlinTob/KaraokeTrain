import { $, toast, confirmDialog } from "./utils.js";
import {
  getLibraryItemsByTypeFromSupabase,
  getLibraryItemsByIdFromSupabase,
  getAllLibraryItemsFromSupabase,
  updateLibraryItemsFromSupabase,
  insertLibraryItemInSupabase,
  renderLibrary,
  escapeHTML
} from './biblioteca.js?v=4';
import { noteToFrequency, frequencyToMidi, midiToNoteName, frequencyToNoteName } from "./afinador.js?v=1";
// FIX #17: removido `destroyAudioController` del import. Se mantiene el
// singleton vivo durante toda la sesión del navegador (no se destruye en
// flujos normales de karaoke/estudio) para evitar romper las promesas en
// vuelo del afinador y otros consumidores. Si en el futuro algún módulo
// necesita workers dedicados, refactorizar a un pool.
import { getAudioController } from "./audio-controller.js";
// FIX #12: import ESTÁTICO de karaoke.js (misma ruta ?v=18 que usan script.js,
// biblioteca y cambiar-tono → sin doble instancia). Antes se llamaba a
// window.renderKaraokeLyrics / window.cargarLetrasEnMonitor con guard
// "typeof === function": si la pestaña Karaoke nunca se había abierto,
// karaoke.js no existía y la letra "se cargaba" en silencio sin pintarse.
import { renderKaraokeLyrics, cargarLetrasEnMonitor } from "./karaoke.js?v=18";

/** 
 * MÓDULO ESTUDIO — Sincronizador de Letras (Tap-Sync), Segmentación de Renglones e Inyección a Supabase
 */

// Variables de Control de Estado
let textSegments = [];
let autoScrollEnabled = true;
let studioTrackFileName = null;
let studioTrackBlob = null;
let studioTrackId = null;
let trackLoadSeq = 0;
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let selectedTextId = null; 
let voiceLoadSeq = 0;
let textLoadSeq = 0;

// Variables del Motor Tap-Sync en Tiempo Real
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;
let currentTapPart = "P1";
let tapSyncParts = [];
// Token de sesión: si el usuario cancela durante los await de arranque, el
// resolve tardío no debe hacer play() ni re-enganchar el teclado.
let tapSyncSession = 0;
// FIX #11: modo de la sesión de taps SOLO en memoria de este módulo. Antes
// vivía en tapSyncModeType, que loadKaraokeSong (karaoke.js)
// sobrescribía al cargar una canción: finishTapSync repartía los taps con el
// modo equivocado (línea→palabra) y guardaba un karaoke corrupto con
// startTime: 0 en cientos de palabras, marcado como "sincronizado".
let tapSyncModeType = "linea";
// E7: fuente explícita de audio para la sesión de taps ("auto" | "voz" | "pista").
let tapSyncSource = "auto";


// Checklist visible: qué falta para poder crear el karaoke. Se refresca al
// entrar al tab y tras cada carga.
export function refreshStudioChecklist() {
  const set = (id, ok, label) => {
    const el = $(id);
    if (el) el.textContent = `${ok ? "✅" : "⬜"} ${label}`;
  };
  set("checkPista", !!studioTrackId, "Pista cargada");
  set("checkVoz", !!selectedVoiceId, "Voz cargada");
  set("checkLetra", !!selectedTextId, "Letra cargada");
}

// E4: repoblar TODOS los selects de la pestaña Estudio (pistas / voces /
// letras) tras borrar o convertir un ítem. Cada entrada a la tab ya llama a esta
// función (script.js), así que aquí NO se repueblan en initEstudio (evita fetches
// dobles). Se hace en paralelo con Promise.allSettled: un fallo de un tipo no debe
// bloquear los otros dos.
export async function refreshStudioSelectors() {
  const results = await Promise.allSettled([
    loadTrackOptionsInStudio(),
    loadVoiceOptionsInStudio(),
    loadTextOptionsInStudio()
  ]);
  const fallos = results
    .map((r, i) => (r.status === "rejected" ? { i, err: r.reason } : null))
    .filter(Boolean);
  if (fallos.length) {
    console.warn("⚠️ No se pudieron refrescar algunos selectores de Estudio:", fallos.map(f => f.err));
  }
}

export function initEstudio() {
  console.log("🎚️ [estudio.js] Inicializado con éxito");
  refreshStudioChecklist();

  // FIX: los clics de loadStudioTrackBtn / loadSelectedVoiceBtn /
  // loadSelectedTextBtn los registra ÚNICAMENTE script.js en DOMContentLoaded.
  // Aquí se duplicaban (safeAdd no deduplica) y cada clic ejecutaba la carga
  // DOS veces en paralelo: doble descarga y revokeObjectURL prematuro.
  //safeAdd("studioTrackFile", "change", cargarAudioEstudio); 

  // E4: NO poblar los selects aquí. La entrada al tab ya hace refreshStudioSelectors
  // (script.js) tras el lazy-load; duplicar los fetches aquí provocaba renders
  // dobles y condiciones de carrera.
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
    toast("⚠️ Selecciona una pista", "warn");
    return;
  }

  // FIX #13: token de secuencia (mismo patrón que karaokeLoadSeq en
  // karaoke.js). Sin él, doble clic o red lenta hacía que la respuesta MÁS
  // VIEJA pisara el estado al final (gana el último fetch, no el último clic).
  const mySeq = ++trackLoadSeq;

  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (mySeq !== trackLoadSeq) return;
    if (!item) {
      toast("⚠️ No se encontró la pista", "warn");
      return;
    }

    studioTrackFileName = item.name;
    studioTrackId = item.id;

        const urlOrBlob = item.file_url || item.audioBlob;

    if (typeof urlOrBlob === 'string') {
      // Descarga ÚNICA: el blob alimenta al reproductor (object URL) y queda
      // guardado para el análisis de pitch. Antes se descargaba dos veces
      // (stream del player + fetch del blob).
      let urlConCacheBuster = urlOrBlob;
      try {
        const parsedUrl = new URL(urlOrBlob, window.location.href);
        parsedUrl.searchParams.set('_cb', String(Date.now()));
        urlConCacheBuster = parsedUrl.toString();
      } catch (_) {
        urlConCacheBuster = urlOrBlob.includes('?')
          ? `${urlOrBlob}&_cb=${Date.now()}`
          : `${urlOrBlob}?_cb=${Date.now()}`;
      }

      console.log("📡 Descargando binario con bypass de caché:", urlConCacheBuster);

      const response = await fetch(urlConCacheBuster);
      if (mySeq !== trackLoadSeq) return;
      if (!response.ok) {
        throw new Error(`No se pudo descargar la pista (HTTP ${response.status})`);
      }
      const blobDescargado = await response.blob();
      if (mySeq !== trackLoadSeq) return;
      studioTrackBlob = blobDescargado;
      // FIX #26: revocar SIEMPRE la URL anterior antes de crear la nueva
      // (antes la rama Blob pisaba dataset.blobUrl sin revocar → fuga).
      if (player.dataset.blobUrl) {
        try { URL.revokeObjectURL(player.dataset.blobUrl); } catch (e) {}
      }
      player.dataset.blobUrl = URL.createObjectURL(studioTrackBlob);
      player.removeAttribute("crossorigin");
      player.src = player.dataset.blobUrl;
    } else if (urlOrBlob instanceof Blob) {
      studioTrackBlob = urlOrBlob;
      if (player.dataset.blobUrl) {
        try { URL.revokeObjectURL(player.dataset.blobUrl); } catch (e) {}
      }
      player.dataset.blobUrl = URL.createObjectURL(urlOrBlob);
      player.src = player.dataset.blobUrl;
    } else {
      throw new Error("Formato de archivo no válido");
    }

    status.innerHTML = `🎵 <strong>Estado:</strong> pista cargada desde Biblioteca (<span style="color:#22c55e;">${escapeHTML(item.name)}</span>)`;
    // Checklist solo con blob verificado (antes marcaba con solo el id).
    refreshStudioChecklist();

  } catch (error) {
    // Una carga vieja que falla tarde no debe borrar el estado de la nueva.
    if (mySeq !== trackLoadSeq) return;
    console.error("Error cargando pista:", error);
    studioTrackId = null;
    studioTrackBlob = null;
    refreshStudioChecklist();
    toast("❌ No se pudo cargar la pista seleccionada: " + error.message, "error");
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
    toast("⚠️ Selecciona un archivo de voz", "warn");
    return;
  }

  // FIX #13: token de sesión (evita que una carga vieja pise la nueva).
  const mySeq = ++voiceLoadSeq;
  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (mySeq !== voiceLoadSeq) return;
    if (!item) {
      toast("⚠️ No se encontró el archivo de voz", "warn");
      return;
    }

    const urlOrBlob = item.file_url || item.audioBlob;

    selectedVoiceId = item.id;

    if (typeof urlOrBlob === 'string') {
      // E6: si antes había un blob: URL activo, revocarla antes de cambiar a string.
      if (player.dataset.blobUrl) {
        try { URL.revokeObjectURL(player.dataset.blobUrl); } catch (e) {}
        player.dataset.blobUrl = "";
      }
      selectedVoiceBlob = urlOrBlob;

      const urlConCacheBuster = urlOrBlob.includes('?')
        ? `${urlOrBlob}&_cb=${Date.now()}`
        : `${urlOrBlob}?_cb=${Date.now()}`;

      player.src = urlConCacheBuster;
    } else if (urlOrBlob instanceof Blob) {
      selectedVoiceBlob = urlOrBlob;
      // FIX #26: revocar la URL de blob anterior si existía (evita fuga).
      if (player.dataset.blobUrl) {
        try { URL.revokeObjectURL(player.dataset.blobUrl); } catch (e) {}
      }
      player.dataset.blobUrl = URL.createObjectURL(urlOrBlob);
      player.src = player.dataset.blobUrl;
    } else {
      selectedVoiceBlob = null;
      player.removeAttribute('src');
      player.load();
    }

    status.textContent = `Estado: voz seleccionada -> ${item.name}`;

    if (lyricsText && item.textoPlano) {
      lyricsText.value = item.textoPlano;
    }

    cargarLetrasEnMonitor();
    refreshStudioChecklist();

  } catch (error) {
    if (mySeq !== voiceLoadSeq) return;
    console.error(error);
    selectedVoiceId = null;
    selectedVoiceBlob = null;
    refreshStudioChecklist();
    toast("❌ No se pudo cargar el archivo de voz seleccionado", "error");
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
    toast("⚠️ Selecciona una letra de la lista primero.", "warn");
    return;
  }

  // FIX #13: token de sesión (evita que una carga vieja pise la nueva).
  const mySeq = ++textLoadSeq;
  try {
    const item = await getLibraryItemsByIdFromSupabase(selectedId);
    if (mySeq !== textLoadSeq) return;
    if (!item) {
      toast("⚠️ No se encontró la letra en la base de datos.", "warn");
      return;
    }

        selectedTextId = item.id;

    if (Array.isArray(item.lyrics) && item.lyrics.length > 0) {
      textSegments = item.lyrics;
      renderKaraokeLyrics(textSegments);

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
      // Actualizar textSegments para que el monitor refleje el texto plano.
      const flatSegments = segmentarTextoPlano(textInput.value);
      textSegments = flatSegments;
      if (flatSegments.length > 0) {
        renderKaraokeLyrics(flatSegments);
      }
      status.innerHTML = `📄 <strong>Estado:</strong> Letra plana cargada en el monitor ⚡`;
    } else {
      textSegments = [];
      textInput.value = "";
      status.textContent = "Estado: El archivo de texto no contiene palabras válidas.";
    }
    refreshStudioChecklist();
  } catch (error) {
    if (mySeq !== textLoadSeq) return;
    console.error(error);
    selectedTextId = null;
    refreshStudioChecklist();
    toast("❌ No se pudo cargar la letra seleccionada.", "error");
  }
}

// ==========================================
// 📝 MONITOR Y EDICIÓN MANUAL DE LETRAS
// ==========================================

export async function applyCorrectedLyrics() {
  const lyricsText = $("lyricsText");
  const text = $("text");
  const currentTextInput = lyricsText || text;
  // E1: las correcciones SIEMPRE apuntan a la fila de letra (selectedTextId).
  // Nunca a la fila de voz: mezclar una corrección de letra con la voz
  // invalidaba el karaoke ya generado.
  const currentId = selectedTextId;
  const statusId = "selectedTextStatus";
  const status = $(statusId);

  if (!currentTextInput) return;
  const correctedText = currentTextInput.value.trim();

  if (!correctedText) {
    toast("⚠️ No hay texto corregido para aplicar.", "warn");
    return;
  }
  if (!currentId) {
    toast("❌ Carga una letra desde la Biblioteca antes de aplicar correcciones.", "error");
    return;
  }

  try {
    const item = await getLibraryItemsByIdFromSupabase(currentId);
    if (!item) throw new Error("No se encontró el ítem en la base de datos");

    // Procesamos siempre como segmentación manual de texto plano para crear los renglones limpios
    const finalSegments = segmentarTextoPlano(correctedText);
    textSegments = finalSegments;

    renderKaraokeLyrics(textSegments);

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
    toast("✅ Cambios aplicados y guardados correctamente.", "ok");
  } catch (error) {
    console.error("Error al aplicar la letra corregida:", error);
    if (status) status.textContent = "Estado: Error al guardar las correcciones";
    toast("❌ No se pudieron salvar las modificaciones del monitor.", "error");
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
      throw new Error(`No se pudo descargar el audio para analizar (${response.status}).`);
    }
    blob = await response.blob();
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;

  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    try {
      await audioCtx.close();
    } catch (_) {}
  }

  if (!audioBuffer) throw new Error("Error al decodificar el audio.");

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
        // FIX (tema "palabra fuera de lugar"): descartar frecuencias imposibles
        // antes de convertir a MIDI. Una ventana corta puede dar un pico
        // espurio (ruido/harmónico) que terminaba en una nota muy por encima de
        // la que cantaba el cantante y aparecía "fuera de lugar" en el pentagrama.
        const FREQ_MIN = 50;
        const FREQ_MAX = 2000;
        if (typeof freq === "number" && freq > 0 && freq >= FREQ_MIN && freq <= FREQ_MAX) {
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
  // FIX #8: resetear el estado de tap-sync al inicio de cada sesión para
  // evitar que datos residuales de la sesión anterior (tapSyncLines,
  // tapSyncTimestamps, tapSyncCurrentIndex) contaminen la nueva.
  // Sin este reset, si el usuario hace "Volver a intentar" después de
  // un cancel o finish, podría ver progreso fantasma o saltos en el índice.
  tapSyncLines = [];
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;

  const lyricsText = $("lyricsText");
  const text = $("text");
  const voicePlayer = $("selectedVoicePlayer");
  const trackPlayer = $("player");
  const methodSelect = $("tapSyncMethodSelect");
  const modoSeleccionado = methodSelect ? methodSelect.value : "linea";
  const sourceSelect = $("tapSyncSourceSelect");
  const fuenteSeleccionada = sourceSelect ? sourceSelect.value : "auto";
  const activePlayer = (voicePlayer && voicePlayer.src) ? voicePlayer : trackPlayer;
  const textoActivo = (lyricsText && lyricsText.value.trim()) ? lyricsText.value.trim() : (text ? text.value.trim() : "");

  if (!textoActivo) {
    toast("⚠️ Primero escribe, carga o corrige la letra en el área de texto.", "warn");
    return;
  }
  if (!activePlayer || !activePlayer.src) {
    toast("⚠️ Primero carga un audio (Pista o Voz) en el Estudio para hacer los Taps.", "warn");
    return;
  }

  // E7: fuente de audio elegida por el usuario (Auto / Voz / Pista).
  let playerTaps = activePlayer;
  if (fuenteSeleccionada === "voz") {
    const vozPlayer = $("selectedVoicePlayer");
    if (!vozPlayer || !vozPlayer.src) {
      toast("⚠️ Selecciona una voz cargada en el Estudio antes de sincronizar con voz.", "warn");
      return;
    }
    playerTaps = vozPlayer;
  } else if (fuenteSeleccionada === "pista") {
    const track = $("player");
    if (!track || !track.src) {
      toast("⚠️ Selecciona una pista cargada en el Estudio antes de sincronizar con pista.", "warn");
      return;
    }
    playerTaps = track;
  }
  tapSyncSource = fuenteSeleccionada;
  const statusSync = $("tapSyncStatus");
  if (statusSync) {
    statusSync.textContent = fuenteSeleccionada === "auto"
      ? "⏳ Sincronizando con fuente automática…"
      : `⏳ Sincronizando con fuente: ${fuenteSeleccionada === "voz" ? "Voz" : "Pista"}…`;
  }

  tapSyncModeType = modoSeleccionado;
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  tapSyncParts = [];
  currentTapPart = "P1";
  tapSyncMode = true;
  const session = ++tapSyncSession;

  updateTapPartButtonsUI();

  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "none";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "inline-block";
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "block";
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "none";

  if (modoSeleccionado === "linea") {
    tapSyncLines = textoActivo.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  } else {
    tapSyncLines = textoActivo.split(/\s+/).map(palabra => palabra.trim()).filter(palabra => palabra.length > 0);
  }

  if (tapSyncLines.length === 0) {
    tapSyncMode = false;
    toast("⚠️ No hay elementos de texto válidos para sincronizar.", "warn");
    restoreTapSyncButtons();
    return;
  }

  updateTapSyncDisplay();
  playerTaps.currentTime = 0;

  console.log('⏳ Esperando a que el audio cargue en segundo plano...');

  try {
    await new Promise((resolve, reject) => {
      if (playerTaps.readyState >= 3) {
        window.activeTapPlayer = playerTaps;
        resolve();
        return;
      }

      const timeout = setTimeout(() => reject(new Error('Audio load timeout (60s)')), 60000);

      playerTaps.addEventListener('canplay', () => {
        clearTimeout(timeout);
        window.activeTapPlayer = playerTaps;
        resolve();
      }, { once: true });

      playerTaps.addEventListener('error', () => {
        clearTimeout(timeout);
        const mediaError = playerTaps.error;
        reject(new Error('Audio error: ' + (mediaError ? getMediaErrorDesc(mediaError.code) : "Desconocido")));
      }, { once: true });

      playerTaps.load();
    });

    // Si se canceló durante la espera, no hacer play ni enganchar teclado.
    // Se restauran los botones para no dejar la UI trabada.
    if (!tapSyncMode || session !== tapSyncSession) {
      restoreTapSyncButtons();
      return;
    }

    await playerTaps.play();
  } catch (e) {
    tapSyncMode = false;
    toast('❌ No se pudo reproducir el audio de taps: ' + e.message, "error");
    restoreTapSyncButtons();
    return;
  }

  if (!tapSyncMode || session !== tapSyncSession) {
    restoreTapSyncButtons();
    return;
  }

  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });
  document.addEventListener("keydown", handleTapSyncKeypress, { capture: true });
}

// Restaura los botones de tap-sync sin borrar el progreso (taps e índice).
function restoreTapSyncButtons() {
  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "inline-block";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "none";
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "none";
}

export function handleTapSyncKeypress(e) {
  if (!tapSyncMode) return;

  const key = e.key;
  const code = e.code;
  const isEscape = code === "Escape" || key === "Escape";

  // No robar teclas mientras se escribe en campos de texto (el espacio en el
  // editor de letra registraba taps fantasmas). Escape siempre funciona.
  if (!isEscape) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t && t.tagName === "BUTTON" && t.id !== "tapBeatBtn") return;
  }

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

  if (isEscape) {
    e.preventDefault();
    cancelTapSync();
  }
}

export function cancelTapSync() {
  tapSyncMode = false;
  tapSyncSession++;
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

// Vuelve a la sesión de taps en curso sin borrar el progreso (taps, índice,
// parte). Se usa al responder "No" en el confirm o cuando falta el currentId.
export function resumeTapSync() {
  tapSyncMode = true;
  tapSyncSession++;
  updateTapSyncDisplay();
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "block";
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "none";
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "inline-block";
  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "none";
  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });
  document.addEventListener("keydown", handleTapSyncKeypress, { capture: true });
  const player = window.activeTapPlayer || $("selectedVoicePlayer") || $("player");
  if (player && player.src) {
    try {
      const p = player.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
  }
  console.log("▶️ Sesión de taps reanudada sin perder el progreso.");
}

// Re-engancha el teclado tras volver al tab (el cleanup lo suelta sin
// cancelar la sesión). No-op si no hay taps en curso. También reanuda el
// audio: el cleanup lo pausa y sin esto los taps graban el tiempo detenido.
export function reattachTapKeys() {
  if (!tapSyncMode) return;
  document.removeEventListener("keydown", handleTapSyncKeypress, { capture: true });
  document.addEventListener("keydown", handleTapSyncKeypress, { capture: true });
  const player = window.activeTapPlayer || $("selectedVoicePlayer") || $("player");
  if (player && player.src && player.paused) {
    try {
      const p = player.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
  }
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

  const currentTime = Number(player.currentTime);
  if (!Number.isFinite(currentTime) || currentTime < 0) return;

  // Taps monótonos con intervalo mínimo: los dobles taps accidentales
  // generaban palabras de duración 0 o solapadas.
  const last = tapSyncTimestamps.length ? tapSyncTimestamps[tapSyncTimestamps.length - 1] : -1;
  const dur = Number(player.duration);
  if (currentTime < last + 0.05) return;
  if (Number.isFinite(dur) && dur > 0 && currentTime > dur) return;

  tapSyncTimestamps.push(currentTime);
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
    const tipoUnidad = (tapSyncModeType === "palabra") ? "palabras" : "líneas";
    progressEl.textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} ${tipoUnidad}`;
  }

  if (autoScrollEnabled) {
    const lyricsTextEl = $("lyricsText");
    if (lyricsTextEl && tapSyncLines.length > 1) {
      const ratio = tapSyncCurrentIndex / (tapSyncLines.length - 1);
      lyricsTextEl.scrollTop = (lyricsTextEl.scrollHeight - lyricsTextEl.clientHeight) * ratio;
    }
  }
}

export function toggleAutoScrollEstudio() {
  autoScrollEnabled = !autoScrollEnabled;
  return autoScrollEnabled;
}

// Puerta anti doble-clic: el aplicado tarda (red + pitch) y un segundo clic
// duplicaba guardados. Mientras está en curso se ignora y el botón se ve
// oscuro/deshabilitado hasta terminar.
let finishTapEnCurso = false;

function setBotonesAplicarTaps(trabajando) {
  const aplicar = $("applyTapSyncBtn");
  if (aplicar) {
    if (trabajando) {
      if (!aplicar.dataset.textoOriginal) aplicar.dataset.textoOriginal = aplicar.textContent;
      aplicar.disabled = true;
      aplicar.textContent = "⏳ Aplicando TAPS... no cierres ni repitas el clic";
    } else {
      aplicar.disabled = false;
      if (aplicar.dataset.textoOriginal) aplicar.textContent = aplicar.dataset.textoOriginal;
    }
  }
  const reintentar = $("redoTapSyncBtn");
  if (reintentar) reintentar.disabled = !!trabajando;
}

export async function finishTapSync() {
  if (finishTapEnCurso) {
    console.log("⏳ Aplicado de TAPS ya en curso, se ignora el clic repetido.");
    return;
  }
  finishTapEnCurso = true;
  tapSyncMode = false;

  if (tapSyncTimestamps.length !== tapSyncLines.length) {
    const remaining = tapSyncLines.length - tapSyncTimestamps.length;
    const tipoUnidad = (tapSyncModeType === "palabra") ? "palabras" : "líneas";

    const aplicarIgual = await confirmDialog(
      `⚠️ Sincronización incompleta: faltan ${remaining} ${tipoUnidad} por tocar.\n\n` +
      `Actualmente: ${tapSyncTimestamps.length} / ${tapSyncLines.length} ${tipoUnidad}\n\n` +
      `¿Deseas aplicar de todos modos?`,
      { okText: "Sí, aplicar", cancelText: "No, seguir" }
    );

    if (!aplicarIgual) {
      // "No" = seguir donde iba (sin borrar taps), no cancelar todo.
      finishTapEnCurso = false;
      resumeTapSync();
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

  const currentId = selectedVoiceId || selectedTextId;
  if (!currentId) {
    // Flujo válido (letra pegada + pista, sin exportar desde Biblioteca):
    // antes moría en silencio. Avisar qué falta sin borrar los taps.
    const statusId = selectedVoiceId ? "selectedVoiceStatus" : "selectedTextStatus";
    const status = $(statusId);
    if (status) status.textContent = "Estado: ⚠️ guarda la letra/voz en Biblioteca y vuelve a cargar para sincronizar.";
    toast("⚠️ Para terminar la sincronización, la voz o la letra deben venir de la Biblioteca (cárgalas en el Estudio y repite los taps). Tus taps se conservan.", "warn");
    finishTapEnCurso = false;
    resumeTapSync();
    return;
  }

  // Validaciones listas: empieza el trabajo largo (red + pitch). Se oscurece
  // e inhabilita el botón hasta terminar para evitar clics repetidos.
  setBotonesAplicarTaps(true);

  const statusId = selectedVoiceId ? "selectedVoiceStatus" : "selectedTextStatus";
  const status = $(statusId);
  if (status) {
    status.textContent = "Estado: sincronizando tiempos y analizando pitch... ⏳";
  }

  const audioDuration = activePlayer ? activePlayer.duration : 0;
  const avgInterval = tapSyncTimestamps.length >= 2
    ? (tapSyncTimestamps[tapSyncTimestamps.length - 1] - tapSyncTimestamps[0]) / (tapSyncTimestamps.length - 1)
    : (audioDuration || 3.0);

  try {
    const item = await getLibraryItemsByIdFromSupabase(currentId);
    if (!item) throw new Error("No se pudo obtener el elemento de la biblioteca remota");

    const isWordMode = (tapSyncModeType === "palabra");
    // En modo palabra los taps van 1:1 con las palabras del editor: la base
    // SIEMPRE sale del textarea. Usar item.lyrics (ya agrupado en segmentos
    // tras un sync previo) desalineaba taps y palabras (timestamps en 0).
    const baseWords = (!isWordMode && Array.isArray(item.lyrics) && item.lyrics.length)
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
    // isWordMode ya se calculó arriba (se usa para elegir baseWords).

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

    // E3: fuente EXPLÍCITA del análisis de pitch. Prioridad: la voz cargada
    // en Estudio. Si no hay voz, preguntar al usuario antes de continuar con la
    // nota por defecto (nunca usar silenciosamente la pista como fuente).
    let audioSourceForPitch = selectedVoiceBlob;
    if (!audioSourceForPitch) {
      const continuarConDefecto = await confirmDialog(
        "¿No hay una voz cargada en el Estudio? ¿Continuar la sincronización con la nota por defecto (Do4 / MIDI 60)?",
        { okText: "Sí, continuar", cancelText: "Cancelar" }
      );
      if (!continuarConDefecto) {
        if (status) status.textContent = "Estado: sincronización cancelada: no hay voz para analizar.";
        return;
      }
      audioSourceForPitch = item.file_url || item.audioBlob || null;
    }

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

    // E2: crear un KARAOKE NUEVO (fila separada) reutilizando el audio de la
    // pista. Nunca convertimos ni sobrescribimos la fila original de pista/voz/
    // texto: eso destruía la fuente original y mezclaba registros distintos.
    // El nombre NO lleva sufijo (el usuario no quiere la palabra "karaoke" en el
    // karaoke final); el tipo "karaoke" ya lo distingue en las listas.
    const karaokeNombre = (trackItem?.name || item.name || "Karaoke");
    const allItems = await getAllLibraryItemsFromSupabase();
    const karaokeExistente = (allItems || []).find(
      (k) => k && k.type === "karaoke" && (
        String(k.name || "") === String(karaokeNombre) ||
        String(k.name || "") === `${karaokeNombre} - [KARAOKE]`
      )
    );

    const karaokePayload = {
      name: karaokeNombre,
      type: "karaoke",
      lyrics: karaokeSegments,
      transcription: karaokeSegments,
      isSincronizada: true,
      isReadyKaraoke: true,
      tapModeStyle: tapSyncModeType,
      file_url: fileUrlFinal,
      file_path: filePathFinal
    };

    if (karaokeExistente) {
      await updateLibraryItemsFromSupabase(karaokeExistente.id, karaokePayload);
    } else {
      await insertLibraryItemInSupabase({ ...karaokePayload, date: new Date().toISOString() });
    }

    if (status) {
      status.textContent = "Estado: ¡Karaoke generado con tiempos y notas automáticas! ✅";
    }

    console.log("✅ Karaoke generado con pitch automático por palabra.", {
      totalWords: finalWords.length,
      totalSegments: karaokeSegments.length,
      mode: tapSyncModeType
    });

    await renderLibrary("todos");

    toast("✅ ¡Sincronización completada!\n\nSe guardaron los tiempos y las notas automáticas por palabra.", "ok");

  } catch (error) {
    console.error("Error al finalizar sincronización:", error);
    if (status) status.textContent = "Estado: Error al guardar la sincronización";
    toast("❌ Error al aplicar taps y analizar pitch: " + error.message, "error");
  } finally {
    finishTapEnCurso = false;
    setBotonesAplicarTaps(false);
  }
}

// Exponer globalmente para cloudflare-storage.js (script no-module)
window.segmentarTextoPlano = segmentarTextoPlano;

/**
 * AUTO-CARGA EN ESTUDIO: refresca el selector correspondiente y 
 * carga el ítem recién subido a la Biblioteca para usar sin buscarlo.
 * @param {string} type - "pista" | "voz" | "texto" / "letra"
 * @param {string} id - id del ítem recién guardado
 */
export async function autoLoadSelectedInEstudio(type, id) {
  if (!id) return;

  const isText = ["texto", "texto_plano", "letra", "ultrastar_txt", "letras"].includes(type);

  try {
    if (type === "pista") {
      await loadTrackOptionsInStudio();
      const select = $("studioTrackSelect");
      if (select && hasOptionValue(select, id)) {
        select.value = String(id);
        await loadSelectedTrackFromLibraryStudio();
      }
    } else if (type === "voz") {
      await loadVoiceOptionsInStudio();
      const select = $("voiceLibrarySelect");
      if (select && hasOptionValue(select, id)) {
        select.value = String(id);
        await loadSelectedVoiceFromLibrary();
      }
    } else if (isText) {
      await loadTextOptionsInStudio();
      const select = $("textLibrarySelect");
      if (select && hasOptionValue(select, id)) {
        select.value = String(id);
        await loadSelectedTextFromLibrary();
      }
    }
  } catch (e) {
    console.warn("⚠️ No se pudo auto-cargar en Estudio:", e);
  }
}

function hasOptionValue(select, id) {
  for (const option of select.options) {
    if (String(option.value) === String(id)) return true;
  }
  return false;
}

