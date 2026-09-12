import { $ } from "./utils.js";

// ====================================================================
// AJUSTES DEL PROCESADOR VOCAL
// Conecta la tarjeta "Procesador Vocal" (Configuración) con el
// AudioWorklet "vocal-processor" creado por liveAudioService/karaoke.
// ====================================================================

const STORAGE_KEY = "karaokeTrain_vocal_settings";

const DEFAULTS = {
  enabled: true,
  preset: "auto",
  low: -2,
  mid: 5,
  high: 4,
  gate: -40,
  hp: 120,
  compThresh: -18,
  compRatio: 3,
  outputGain: 3,
  attack: 10,
  release: 100
};

const PRESETS = {
  auto: { low: -2, mid: 5, high: 4, gate: -40, hp: 120, compThresh: -18, compRatio: 3, outputGain: 3, attack: 10, release: 100 },
  warm: { low: 6, mid: 0, high: -3, gate: -38, hp: 80, compThresh: -18, compRatio: 3, outputGain: 3, attack: 15, release: 120 },
  bright: { low: -4, mid: 2, high: 8, gate: -40, hp: 140, compThresh: -18, compRatio: 3, outputGain: 3, attack: 8, release: 100 },
  presence: { low: -3, mid: 7, high: 3, gate: -42, hp: 120, compThresh: -20, compRatio: 4, outputGain: 4, attack: 8, release: 90 },
  clean: { low: -2, mid: 3, high: 3, gate: -35, hp: 150, compThresh: -16, compRatio: 3, outputGain: 2, attack: 10, release: 80 }
};

// Nodos activos (karaoke) para aplicar cambios en caliente
const activeNodes = new Set();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function isVocalProcessorEnabled() {
  return !!loadSettings().enabled;
}

function settingsForPreset() {
  const s = loadSettings();
  if (s.preset === "custom") {
    return {
      low: num(s.low), mid: num(s.mid), high: num(s.high),
      gate: num(s.gate), hp: num(s.hp), compThresh: num(s.compThresh),
      compRatio: num(s.compRatio), outputGain: num(s.outputGain),
      attack: num(s.attack), release: num(s.release)
    };
  }
  return { ...PRESETS[s.preset] || PRESETS.auto };
}

// ====================================================================
// APLICAR PARÁMETROS A UN NODO
// ====================================================================

export function applyVocalSettingsToNode(node) {
  if (!node || !node.parameters) return;
  const v = settingsForPreset();
  const s = loadSettings();
  const t = node.context ? node.context.currentTime : 0;
  const params = {
    highpass: v.hp,
    lowGain: v.low,
    midGain: v.mid,
    highGain: v.high,
    gateThreshold: v.gate,
    compThreshold: v.compThresh,
    compRatio: v.compRatio,
    attackMs: v.attack,
    releaseMs: v.release,
    outputGain: v.outputGain,
    bypass: s.enabled ? 0 : 1
  };
  Object.entries(params).forEach(([name, value]) => {
    const p = node.parameters.get(name);
    if (p) p.setValueAtTime(value, t);
  });
}

export function registerVocalNode(node) {
  if (!node) return;
  activeNodes.add(node);
  applyVocalSettingsToNode(node);
  try {
    if (typeof node.addEventListener === "function") {
      node.addEventListener("processorerror", () => activeNodes.delete(node));
    }
  } catch (e) {}
}

function refreshActiveVocalNodes() {
  activeNodes.forEach((node) => applyVocalSettingsToNode(node));
}

// ====================================================================
// PRUEBA RÁPIDA (5 segundos)
// ====================================================================

let testVocal = null;

async function testVocalProcessor() {
  if (testVocal) {
    stopTestVocal();
    return;
  }
  try {
    const { loadVocalProcessor } = await import("./worklets.js");
    const audioCtx = new AudioContext();
    await loadVocalProcessor(audioCtx);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });

    const source = audioCtx.createMediaStreamSource(stream);
    const vocalNode = new AudioWorkletNode(audioCtx, "vocal-processor");
    applyVocalSettingsToNode(vocalNode);

    source.connect(vocalNode);
    vocalNode.connect(audioCtx.destination);

    testVocal = { audioCtx, source, vocalNode, stream };

    const btn = $("testVocalProcessorBtn");
    if (btn) btn.textContent = "✋ Detener prueba";

    setTimeout(() => {
      if (testVocal) stopTestVocal();
    }, 5000);
  } catch (e) {
    console.error("Fallo al probar el procesador vocal:", e);
    alert("No se pudo probar el procesador: " + e.message);
    stopTestVocal();
  }
}

function stopTestVocal() {
  if (!testVocal) return;
  try { testVocal.source?.disconnect(); } catch (e) {}
  try { testVocal.vocalNode?.disconnect(); } catch (e) {}
  try { testVocal.stream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
  try { testVocal.audioCtx?.close(); } catch (e) {}
  testVocal = null;
  const btn = $("testVocalProcessorBtn");
  if (btn) btn.textContent = "🔊 Probar Procesador (5 seg)";
}

// ====================================================================
// UI (TARJETA "PROCESADOR VOCAL" EN CONFIGURACIÓN)
// ====================================================================

const SLIDERS = [
  { id: "eqLow", valId: "eqLowVal", key: "low", format: (v) => `${v} dB` },
  { id: "eqMid", valId: "eqMidVal", key: "mid", format: (v) => `${v} dB` },
  { id: "eqHigh", valId: "eqHighVal", key: "high", format: (v) => `${v} dB` },
  { id: "noiseGateThresh", valId: "noiseGateThreshVal", key: "gate", format: (v) => `${v} dB` },
  { id: "hpFreq", valId: "hpFreqVal", key: "hp", format: (v) => `${v} Hz` },
  { id: "compThresh", valId: "compThreshVal", key: "compThresh", format: (v) => `${v} dB` },
  { id: "compRatio", valId: "compRatioVal", key: "compRatio", format: (v) => `${v}:1` },
  { id: "outputGain", valId: "outputGainVal", key: "outputGain", format: (v) => `${v} dB` },
  { id: "compAttack", valId: "compAttackVal", key: "attack", format: (v) => `${v} ms` },
  { id: "compRelease", valId: "compReleaseVal", key: "release", format: (v) => `${v} ms` }
];

export function initVocalProcessorUI() {
  const enabled = $("vocalProcessorEnabled");
  if (!enabled) return;

  const settingsEl = $("vocalProcessorSettings");
  const presetEl = $("vocalPreset");
  const customEqEl = $("vocalCustomEq");
  const resetBtn = $("resetVocalProcessorBtn");
  const testBtn = $("testVocalProcessorBtn");

  const syncSliders = () => {
    const eff = settingsForPreset();
    SLIDERS.forEach(({ id, valId, key, format }) => {
      const el = $(id);
      if (!el) return;
      el.value = eff[key];
      const span = $(valId);
      if (span) span.textContent = format(eff[key]);
    });
  };

  const s = loadSettings();
  enabled.checked = !!s.enabled;
  if (settingsEl) settingsEl.style.display = s.enabled ? "block" : "none";
  if (presetEl) presetEl.value = s.preset || "auto";
  if (customEqEl) customEqEl.style.display = s.preset === "custom" ? "block" : "none";
  syncSliders();

  enabled.addEventListener("change", () => {
    const ws = loadSettings();
    ws.enabled = enabled.checked;
    saveSettings(ws);
    if (settingsEl) settingsEl.style.display = enabled.checked ? "block" : "none";
    refreshActiveVocalNodes();
  });

  if (presetEl) {
    presetEl.addEventListener("change", () => {
      const ws = loadSettings();
      ws.preset = presetEl.value;
      if (presetEl.value !== "custom") {
        Object.assign(ws, PRESETS[presetEl.value] || PRESETS.auto);
      }
      saveSettings(ws);
      if (customEqEl) customEqEl.style.display = presetEl.value === "custom" ? "block" : "none";
      syncSliders();
      refreshActiveVocalNodes();
    });
  }

  SLIDERS.forEach(({ id, valId, key, format }) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const ws = loadSettings();
      ws.preset = "custom";
      ws[key] = Number(el.value);
      saveSettings(ws);
      if (presetEl) presetEl.value = "custom";
      if (customEqEl) customEqEl.style.display = "block";
      const span = $(valId);
      if (span) span.textContent = format(Number(el.value));
      refreshActiveVocalNodes();
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      saveSettings({ ...DEFAULTS });
      enabled.checked = DEFAULTS.enabled;
      if (settingsEl) settingsEl.style.display = "block";
      if (presetEl) presetEl.value = DEFAULTS.preset;
      if (customEqEl) customEqEl.style.display = "none";
      syncSliders();
      refreshActiveVocalNodes();
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", () => testVocalProcessor());
  }
}
