// ==========================================
// CENTRALIZED AUDIO WORKLET LOADER
// ==========================================
//
// Por qué existe este archivo:
// ---------------------------
// AudioWorkletNode requiere cargar el módulo del worklet vía `addModule(url)`
// ANTES de instanciar cualquier nodo. Si dos archivos del proyecto cargan el
// MISMO worklet con URLs que resuelven igual (e.g. ambos usan `import.meta.url`),
// el navegador lo maneja idempotentemente. Pero si las URLs resuelven DISTINTO
// (uno usa `import.meta.url`, otro usa una ruta absoluta hardcodeada), el
// navegador registra el processor DOS veces con el mismo nombre y lanza:
//
//   "DOMException: This name has already been used..."
//
// Además, las llamadas concurrentes a `addModule` desde dos módulos distintos
// (p.ej. `cambiar-tono.js` y dependencias al navegar entre pestañas)
// generaban una race condition: ambos esperan su propio `addModule`
// y durante una fracción de segundo los registros están en vuelo.
//
// Este archivo:
//   1. Resuelve la URL del worklet priorizando `window.__PITCH_WORKLET_URL__`
//      (definida en index.html).
//   2. Cachea las promesas de `addModule` por nombre de processor, de modo
//      que múltiples llamadas concurrentes devuelven LA MISMA promesa.
//   3. Garantiza idempotencia: una vez que un processor se cargó, no se
//      vuelve a llamar `addModule` para él.
//
// Uso:
//   import { loadPitchShifterProcessor } from "./worklets.js";
//   await loadPitchShifterProcessor(audioContext);

const PROCESSOR_NAMES = {
  pitchShifter: "pitch-shifter-processor",
  vocalGate: "vocal-gate-processor"
};

// Cache de promesas por (AudioContext, nombre). Usamos un WeakMap para que
// cuando el AudioContext se cierre y pierda referencias, el GC libere la
// entrada sin que tengamos que limpiar manualmente.
const _addModuleCache = new WeakMap();

/**
 * Resuelve la URL del worklet. Prioriza la constante global definida en
 * index.html, y si no existe, usa la ruta relativa al módulo actual.
 * @param {string} globalKey - "__PITCH_WORKLET_URL__"
 * @param {string} relativePath - "./pitch-shifter-processor.js"
 * @returns {string} URL absoluta o relativa resolvable por `addModule`
 */
function resolveWorkletUrl(globalKey, relativePath) {
  const globalUrl = typeof window !== "undefined" ? window[globalKey] : null;
  if (globalUrl && typeof globalUrl === "string" && globalUrl.trim()) {
    // Si es una URL absoluta (http://, https://, /) úsala tal cual
    if (/^(https?:)?\/\//i.test(globalUrl) || globalUrl.startsWith("/")) {
      return globalUrl;
    }
  }
  return new URL(relativePath, import.meta.url).href;
}

/**
 * Carga un AudioWorklet module de forma idempotente y concurrent-safe.
 * @param {BaseAudioContext} audioContext
 * @param {string} url - URL absoluta o relativa del worklet
 * @param {string} processorName - nombre del processor (para logging)
 * @returns {Promise<void>}
 */
async function addModuleOnce(audioContext, url, processorName) {
  if (!audioContext) {
    throw new Error("addModuleOnce: audioContext es requerido.");
  }
  if (!audioContext.audioWorklet) {
    throw new Error("addModuleOnce: este AudioContext no soporta AudioWorklet.");
  }

  // Cache por AudioContext (WeakMap) y por URL (Map anidado).
  let perContextCache = _addModuleCache.get(audioContext);
  if (!perContextCache) {
    perContextCache = new Map();
    _addModuleCache.set(audioContext, perContextCache);
  }

  if (perContextCache.has(url)) {
    return perContextCache.get(url);
  }

  console.log(`🔧 [worklets] Cargando ${processorName} desde ${url}`);

  const loadPromise = audioContext.audioWorklet
    .addModule(url)
    .then(() => {
      console.log(`✅ [worklets] ${processorName} registrado.`);
    })
    .catch((err) => {
      // Si falla, eliminamos la entrada cacheada para permitir reintento.
      perContextCache.delete(url);
      console.warn(`❌ [worklets] Error cargando ${processorName}:`, err);
      throw err;
    });

  perContextCache.set(url, loadPromise);
  return loadPromise;
}

/**
 * Carga el pitch-shifter-processor en el AudioContext dado.
 * @param {BaseAudioContext} audioContext
 * @returns {Promise<void>}
 */
export async function loadPitchShifterProcessor(audioContext) {
  const url = resolveWorkletUrl(
    "__PITCH_WORKLET_URL__",
    "./pitch-shifter-processor.js"
  );
  return addModuleOnce(audioContext, url, PROCESSOR_NAMES.pitchShifter);
}

/**
 * Carga el vocal-gate-processor (limpieza automática de voz del mix karaoke).
 * El `?v=1` hace cache-busting del módulo del worklet al cambiarlo.
 * @param {BaseAudioContext} audioContext
 * @returns {Promise<void>}
 */
export async function loadVocalGateProcessor(audioContext) {
  const url = new URL("./vocal-gate-processor.js?v=1", import.meta.url).href;
  return addModuleOnce(audioContext, url, PROCESSOR_NAMES.vocalGate);
}

/**
 * Crea un AudioWorkletNode del vocal-gate. Requiere llamar antes a
 * loadVocalGateProcessor sobre el mismo AudioContext.
 * @param {BaseAudioContext} audioContext
 * @param {number} channels - canales de salida del nodo
 * @returns {AudioWorkletNode}
 */
export function createVocalGateNode(audioContext, channels) {
  return new AudioWorkletNode(audioContext, PROCESSOR_NAMES.vocalGate, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    channelCount: channels,
    channelCountMode: "explicit"
  });
}
