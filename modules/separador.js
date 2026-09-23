import { $ } from "./utils.js";
import { saveToLibrary } from "./biblioteca.js?v=4";

/**
 * MÓDULO SEPARADOR — Voz e instrumental con IA en el navegador.
 * BS PolarFormer (ONNX) vía onnxruntime-web: WebGPU en Chrome/Edge,
 * WASM como fallback (lento). Todo local: cero costo de servidor.
 * CK = tramos de ~3 s con solape (el modelo colapsa en ventanas largas).
 */

const SAMPLE_RATE = 44100;
const N_FFT = 2048;
const HOP = 512;
const N_FREQ = N_FFT / 2 + 1; // 1025
const CHUNK = 131072; // muestras por tramo (~3 s)
const OVERLAP = 2;
const ORT_VERSION = "1.21.0";
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const HF_BASE = "https://huggingface.co/bgkb/bs_polarformer/resolve/main";
const MODEL_PATHS = {
  fp32: {
    wasm: `${HF_BASE}/bs_polarformer.onnx`,
    webgpu: `${HF_BASE}/bs_polarformer_webgpu.onnx`,
  },
  fp16: {
    wasm: `${HF_BASE}/bs_polarformer_fp16.onnx`,
    webgpu: `${HF_BASE}/bs_polarformer_webgpu_fp16.onnx`,
  },
};

let sepAudioBuffer = null;
let sepVozBlob = null;
let sepPistaBlob = null;
let sepVozUrl = null;
let sepPistaUrl = null;
let sepRunning = false;
let sepSession = 0;
let sepBound = false;

// ---------- DSP: Hann, FFT, STFT, iSTFT (sin center, como la demo oficial) ----------

function hannWindow(len) {
  const w = new Float32Array(len);
  for (let i = 0; i < len; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / len));
  return w;
}

function fftInPlace(re, im, N) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

function rfftFrame(x, off, N, win) {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[off + i] || 0) * win[i];
  fftInPlace(re, im, N);
  const out = new Float32Array((N / 2 + 1) * 2);
  for (let k = 0; k <= N / 2; k++) {
    out[k * 2] = re[k];
    out[k * 2 + 1] = im[k];
  }
  return out;
}

function irfftFrame(spec, N) {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const half = N / 2;
  for (let k = 0; k <= half; k++) {
    re[k] = spec[k * 2];
    im[k] = -spec[k * 2 + 1];
  }
  for (let k = 1; k < half; k++) {
    re[N - k] = spec[k * 2];
    im[N - k] = spec[k * 2 + 1];
  }
  fftInPlace(re, im, N);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = re[i] / N;
  return out;
}

// STFT mono CON center (pad reflectante estilo torch): [n_freq, nFrames, 2].
// El center es crítico: sin él, la división por la envolvente amplifica el
// contenido procesado donde la ventana tiende a 0 (picos de 200×+ en bordes).
function stft(signal, win) {
  const P = N_FFT / 2;
  const T = signal.length;
  const padded = new Float32Array(T + N_FFT);
  for (let i = 0; i < P; i++) padded[i] = signal[P - i] || 0;
  padded.set(signal, P);
  for (let i = 0; i < P; i++) padded[P + T + i] = signal[T - 2 - i] || 0;
  const nFrames = 1 + Math.floor(T / HOP);
  const out = new Float32Array(N_FREQ * nFrames * 2);
  for (let t = 0; t < nFrames; t++) {
    const spec = rfftFrame(padded, t * HOP, N_FFT, win);
    for (let f = 0; f < N_FREQ; f++) {
      out[(f * nFrames + t) * 2] = spec[f * 2];
      out[(f * nFrames + t) * 2 + 1] = spec[f * 2 + 1];
    }
  }
  return { data: out, nFrames };
}

function istft(stftData, nFrames, win, length) {
  const P = N_FFT / 2;
  const fullLen = nFrames * HOP + N_FFT;
  const out = new Float32Array(fullLen);
  const winSum = new Float32Array(fullLen);
  const spec = new Float32Array(N_FREQ * 2);
  for (let t = 0; t < nFrames; t++) {
    for (let f = 0; f < N_FREQ; f++) {
      spec[f * 2] = stftData[(f * nFrames + t) * 2];
      spec[f * 2 + 1] = stftData[(f * nFrames + t) * 2 + 1];
    }
    const frame = irfftFrame(spec, N_FFT);
    const off = t * HOP;
    for (let i = 0; i < N_FFT && off + i < fullLen; i++) {
      out[off + i] += frame[i] * win[i];
      winSum[off + i] += win[i] * win[i];
    }
  }
  // Recortar el pad: la zona de blowup de bordes queda fuera.
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const v = out[P + i];
    const e = winSum[P + i];
    result[i] = e > 1e-8 ? v / e : 0;
  }
  return result;
}

function resampleTo44100(ch, fromSr, len) {
  if (fromSr === SAMPLE_RATE) return ch.slice(0, len);
  const out = new Float32Array(len);
  const ratio = fromSr / SAMPLE_RATE;
  for (let i = 0; i < len; i++) {
    const p = i * ratio, i0 = Math.floor(p), fr = p - i0;
    out[i] = (ch[i0] || 0) * (1 - fr) + (ch[i0 + 1] || 0) * fr;
  }
  return out;
}

// ---------- ORT (CDN, con caché del modelo en Cache API) ----------

function ensureOrt() {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve(window.ort);
    const s = document.createElement("script");
    s.src = `${ORT_CDN}ort.all.min.js`;
    s.onload = () => (window.ort ? resolve(window.ort) : reject(new Error("ORT no se expuso como window.ort")));
    s.onerror = () => reject(new Error("No se pudo cargar onnxruntime-web desde el CDN."));
    document.head.appendChild(s);
  });
}

async function fetchModelCached(url, onProgress) {
  const CACHE = "karaoketrain-separador-v1";
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) {
      if (onProgress) onProgress(1);
      return await hit.arrayBuffer();
    }
  } catch (e) {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga del modelo falló (${res.status}). Revisa tu conexión.`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (onProgress && total) onProgress(got / total);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  try {
    const cache = await caches.open(CACHE);
    await cache.put(url, new Response(buf.slice(), { headers: { "Content-Type": "application/octet-stream" } }));
  } catch (e) {}
  return buf.buffer;
}

async function createSession(precision, provider, setStatus) {
  const ort = window.ort;
  const opts = { executionProviders: [provider], graphOptimizationLevel: "all" };
  if (provider === "webgpu") {
    ort.env.webgpu.powerPreference = "high-performance";
    const probeFrames = 1 + Math.floor(CHUNK / HOP);
    opts.freeDimensionOverrides = { batch: 1, time_frames: probeFrames };
  } else {
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
  }
  ort.env.wasm.wasmPaths = ORT_CDN;
  const url = MODEL_PATHS[precision][provider];
  setStatus(`Descargando modelo ${precision.toUpperCase()} (~${precision === "fp16" ? "103" : "201"} MB, una sola vez)…`);
  const buf = await fetchModelCached(url, (p) => setStatus(`Descargando modelo… ${Math.round(p * 100)}%`));
  setStatus("Iniciando el modelo…");
  const session = await ort.InferenceSession.create(buf, opts);
  // Warmup: en WebGPU los fallos de shaders aparecen en el primer run().
  const probeFrames = 1 + Math.floor(CHUNK / HOP);
  await session.run({
    stft_features: new ort.Tensor("float32", new Float32Array(probeFrames * N_FREQ * 2 * 2), [1, probeFrames, N_FREQ * 2 * 2]),
  });
  return session;
}

// ---------- Pipeline ----------

function setStatus(msg) {
  const el = $("sepStatus");
  if (el) el.textContent = msg;
}

function setProgress(frac) {
  const wrap = $("sepProgressWrap");
  const bar = $("sepProgressBar");
  if (wrap) wrap.style.display = "block";
  if (bar) bar.style.width = `${(frac * 100).toFixed(1)}%`;
}

function prepareChunkInput(left, right, win) {
  const stftL = stft(left, win);
  const stftR = stft(right, win);
  const nFrames = stftL.nFrames;
  const featDim = N_FREQ * 2 * 2; // 4100
  const input = new Float32Array(nFrames * featDim);
  for (let t = 0; t < nFrames; t++) {
    for (let f = 0; f < N_FREQ; f++) {
      const base = t * featDim + f * 4;
      input[base] = stftL.data[(f * nFrames + t) * 2];
      input[base + 1] = stftL.data[(f * nFrames + t) * 2 + 1];
      input[base + 2] = stftR.data[(f * nFrames + t) * 2];
      input[base + 3] = stftR.data[(f * nFrames + t) * 2 + 1];
    }
  }
  return { input, nFrames, stftL, stftR };
}

function encodeWav(left, right, sr) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const view = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF");
  view.setUint32(4, 36 + n * 4, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, n * 4, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(off, Math.round(l < 0 ? l * 0x8000 : l * 0x7fff), true); off += 2;
    view.setInt16(off, Math.round(r < 0 ? r * 0x8000 : r * 0x7fff), true); off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

function clearOutputs() {
  if (sepVozUrl) { try { URL.revokeObjectURL(sepVozUrl); } catch (e) {} sepVozUrl = null; }
  if (sepPistaUrl) { try { URL.revokeObjectURL(sepPistaUrl); } catch (e) {} sepPistaUrl = null; }
  sepVozBlob = null;
  sepPistaBlob = null;
  const out = $("sepOutputs");
  if (out) out.style.display = "none";
}

export function initSeparador() {
  if (sepBound) return;
  sepBound = true;
  console.log("🎛️ [separador.js] Inicializado.");

  const fileInput = $("sepFileInput");
  const fileName = $("sepFileName");
  const runBtn = $("sepRunBtn");
  const cancelBtn = $("sepCancelBtn");

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (fileName) fileName.textContent = file.name;
      setStatus("Decodificando audio…");
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const ab = await ctx.decodeAudioData(await file.arrayBuffer());
        const total = ab.length;
        const l0 = ab.getChannelData(0);
        const r0 = ab.numberOfChannels > 1 ? ab.getChannelData(1) : l0;
        const targetLen = Math.floor((total * SAMPLE_RATE) / ab.sampleRate);
        sepAudioBuffer = {
          name: file.name.replace(/\.[^.]+$/, ""),
          left: resampleTo44100(l0, ab.sampleRate, targetLen),
          right: resampleTo44100(r0, ab.sampleRate, targetLen),
          duration: targetLen / SAMPLE_RATE,
        };
        try { await ctx.close(); } catch (e) {}
        clearOutputs();
        setStatus(`Listo: ${sepAudioBuffer.duration.toFixed(1)} s a 44.1 kHz. Pulsa Separar voz y pista.`);
        if (runBtn) runBtn.disabled = false;
      } catch (e) {
        console.error("No se pudo decodificar:", e);
        setStatus("❌ No se pudo decodificar el archivo. Prueba con MP3 o WAV.");
      }
    });
  }

  if (runBtn) runBtn.addEventListener("click", () => separateVocals());
  if (cancelBtn) {
    cancelBtn.style.display = "none";
    cancelBtn.addEventListener("click", () => {
      sepSession++;
      sepRunning = false;
      setStatus("⏹️ Separación cancelada.");
      if (cancelBtn) cancelBtn.style.display = "none";
      if (runBtn) runBtn.disabled = false;
    });
  }

  const dlV = $("sepDlVoz");
  if (dlV) dlV.addEventListener("click", () => sepVozBlob && downloadBlob(sepVozBlob, "voz.wav"));
  const dlP = $("sepDlPista");
  if (dlP) dlP.addEventListener("click", () => sepPistaBlob && downloadBlob(sepPistaBlob, "pista.wav"));
  const svV = $("sepSaveVoz");
  if (svV) {
    svV.addEventListener("click", async () => {
      if (!sepVozBlob) return;
      svV.disabled = true;
      try {
        await saveToLibrary(sepVozBlob, { name: `Voz - ${sepAudioBuffer?.name || "separada"}`, type: "voz" });
        setStatus("✅ Voz guardada en Biblioteca.");
      } catch (e) {
        setStatus(`❌ No se pudo guardar la voz: ${e.message || e}`);
      }
      svV.disabled = false;
    });
  }
  const svP = $("sepSavePista");
  if (svP) {
    svP.addEventListener("click", async () => {
      if (!sepPistaBlob) return;
      svP.disabled = true;
      try {
        await saveToLibrary(sepPistaBlob, { name: `Pista - ${sepAudioBuffer?.name || "separada"}`, type: "pista" });
        setStatus("✅ Pista guardada en Biblioteca. Ya puedes armarla en Estudio.");
      } catch (e) {
        setStatus(`❌ No se pudo guardar la pista: ${e.message || e}`);
      }
      svP.disabled = false;
    });
  }
}

export function destroySeparador() {
  // Invalida la separación en vuelo (el bucle revisa el token por tramo).
  sepSession++;
  sepRunning = false;
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { URL.revokeObjectURL(a.href); } catch (e) {}
    a.remove();
  }, 5000);
}

export async function separateVocals() {
  if (!sepAudioBuffer) {
    setStatus("⚠️ Primero elige un archivo de audio.");
    return;
  }
  if (sepRunning) return;
  sepRunning = true;
  const session = ++sepSession;
  const runBtn = $("sepRunBtn");
  const cancelBtn = $("sepCancelBtn");
  if (runBtn) runBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  clearOutputs();

  try {
    await ensureOrt();
    if (session !== sepSession) return;

    // Proveedor: WebGPU si hay GPU, si no WASM (lento pero funciona).
    // Si WebGPU falla en el primer tramo, se reconstruye en WASM y se sigue.
    let provider = "wasm";
    try {
      if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) provider = "webgpu";
      }
    } catch (e) {}
    const warn = $("sepWasmWarn");
    if (warn) warn.style.display = provider === "wasm" ? "block" : "none";

    const precisionEl = document.querySelector('input[name="sepPrecision"]:checked');
    const precision = precisionEl ? precisionEl.value : "fp16";

    const ort = window.ort;
    const buildSession = async (prov) => {
      const o = { executionProviders: [prov], graphOptimizationLevel: "all" };
      if (prov === "webgpu") {
        ort.env.webgpu.powerPreference = "high-performance";
        const probeFrames = 1 + Math.floor(CHUNK / HOP);
        o.freeDimensionOverrides = { batch: 1, time_frames: probeFrames };
      } else {
        ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
      }
      ort.env.wasm.wasmPaths = ORT_CDN;
      const u = MODEL_PATHS[precision][prov];
      const b = await fetchModelCached(u, (p) => setStatus(`Descargando modelo… ${Math.round(p * 100)}%`));
      if (session !== sepSession) throw new Error("cancelado");
      setStatus("Iniciando el modelo…");
      return await ort.InferenceSession.create(b, o);
    };
    setStatus(`Descargando modelo ${precision.toUpperCase()} (~${precision === "fp16" ? "103" : "201"} MB, una sola vez)…`);
    let sessionOrt = await buildSession(provider);
    if (session !== sepSession) return;

    const { left, right, duration } = sepAudioBuffer;
    const totalSamples = left.length;
    const win = hannWindow(N_FFT);
    const step = Math.floor(CHUNK / OVERLAP);
    const vocalsL = new Float32Array(totalSamples);
    const vocalsR = new Float32Array(totalSamples);
    const count = new Float32Array(totalSamples);
    const t0 = performance.now();

    for (let start = 0, ci = 0; start < totalSamples; start += step, ci++) {
      if (session !== sepSession) return;
      const end = Math.min(start + CHUNK, totalSamples);
      const chunkLen = end - start;
      const cL = new Float32Array(CHUNK);
      const cR = new Float32Array(CHUNK);
      cL.set(left.subarray(start, end));
      cR.set(right.subarray(start, end));

      const { input, nFrames, stftL, stftR } = prepareChunkInput(cL, cR, win);
      const tensor = new ort.Tensor("float32", input, [1, nFrames, N_FREQ * 2 * 2]);
      let results;
      try {
        results = await sessionOrt.run({ stft_features: tensor });
      } catch (runErr) {
        // Fallback: si WebGPU truena en el primer tramo (GPU modesta), seguir
        // en WASM con el modelo equivalente en vez de dejar todo colgado.
        if (provider !== "webgpu" || session !== sepSession) throw runErr;
        console.warn("WebGPU falló, cambiando a WASM:", runErr);
        setStatus("⚠️ WebGPU falló en este equipo; siguiendo en CPU (lento)…");
        provider = "wasm";
        const warnEl = $("sepWasmWarn");
        if (warnEl) warnEl.style.display = "block";
        sessionOrt = await buildSession("wasm");
        if (session !== sepSession) return;
        results = await sessionOrt.run({ stft_features: tensor });
      }
      if (session !== sepSession) return;
      const mask = results.mask ? results.mask.data : results[Object.keys(results)[0]].data;

      const recon = applyMaskBoth(mask, stftL, stftR, nFrames, win, CHUNK);
      for (let i = 0; i < chunkLen; i++) {
        vocalsL[start + i] += recon.left[i];
        vocalsR[start + i] += recon.right[i];
        count[start + i] += 1;
      }

      const frac = (start + chunkLen) / totalSamples;
      const elapsed = (performance.now() - t0) / 1000;
      const eta = frac > 0.02 ? (elapsed / frac) * (1 - frac) : 0;
      setProgress(frac);
      setStatus(`Separando tramo ${ci + 1} · ${elapsed.toFixed(0)}s · ~${eta.toFixed(0)}s restantes (${provider.toUpperCase()})`);
      await new Promise((r) => setTimeout(r, 0));
    }

    for (let i = 0; i < totalSamples; i++) {
      if (count[i] > 0) { vocalsL[i] /= count[i]; vocalsR[i] /= count[i]; }
    }
    const otherL = new Float32Array(totalSamples);
    const otherR = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      otherL[i] = left[i] - vocalsL[i];
      otherR[i] = right[i] - vocalsR[i];
    }

    sepVozBlob = encodeWav(vocalsL, vocalsR, SAMPLE_RATE);
    sepPistaBlob = encodeWav(otherL, otherR, SAMPLE_RATE);
    if (sepVozUrl) { try { URL.revokeObjectURL(sepVozUrl); } catch (e) {} }
    if (sepPistaUrl) { try { URL.revokeObjectURL(sepPistaUrl); } catch (e) {} }
    sepVozUrl = URL.createObjectURL(sepVozBlob);
    sepPistaUrl = URL.createObjectURL(sepPistaBlob);
    const aV = $("sepAudioVoz");
    if (aV) aV.src = sepVozUrl;
    const aP = $("sepAudioPista");
    if (aP) aP.src = sepPistaUrl;
    const out = $("sepOutputs");
    if (out) out.style.display = "block";
    ["sepDlVoz", "sepDlPista", "sepSaveVoz", "sepSavePista"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = false;
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(0);
    setProgress(1);
    setStatus(`✅ Listo en ${elapsed}s (${duration.toFixed(0)}s de audio, ${provider.toUpperCase()}). Escucha, descarga o guarda en Biblioteca.`);
  } catch (e) {
    if (e && e.message === "cancelado") return;
    console.error("Error separando:", e);
    setStatus(`❌ Error separando: ${e.message || e}`);
  } finally {
    sepRunning = false;
    if (runBtn) runBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = "none";
  }
}

// Aplica la máscara [1,1,2050,T,2] a ambos canales y reconstruye con iSTFT.
function applyMaskBoth(mask, stftL, stftR, nFrames, win, length) {
  const maskedL = new Float32Array(N_FREQ * nFrames * 2);
  const maskedR = new Float32Array(N_FREQ * nFrames * 2);
  for (let f = 0; f < N_FREQ; f++) {
    for (let t = 0; t < nFrames; t++) {
      const mL = ((f * 2) * nFrames + t) * 2;
      const mR = ((f * 2 + 1) * nFrames + t) * 2;
      const sIdx = (f * nFrames + t) * 2;
      const aL = stftL.data[sIdx], bL = stftL.data[sIdx + 1];
      const aR = stftR.data[sIdx], bR = stftR.data[sIdx + 1];
      maskedL[sIdx] = f === 0 ? 0 : aL * mask[mL] - bL * mask[mL + 1];
      maskedL[sIdx + 1] = f === 0 ? 0 : aL * mask[mL + 1] + bL * mask[mL];
      maskedR[sIdx] = f === 0 ? 0 : aR * mask[mR] - bR * mask[mR + 1];
      maskedR[sIdx + 1] = f === 0 ? 0 : aR * mask[mR + 1] + bR * mask[mR];
    }
  }
  return { left: istft(maskedL, nFrames, win, length), right: istft(maskedR, nFrames, win, length) };
}
