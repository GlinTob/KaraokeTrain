export const state = {
isRecording: false,
currentTab: "inicio"
};

export function $(id) {
return document.getElementById(id);
}

export function safeAdd(id, event, handler) {
const el = $(id);
if (el) {
el.addEventListener(event, handler);
} else {
console.warn(⚠️ [safeAdd] Elemento no encontrado en el DOM: #${id});
}
}

export async function switchTab(tabId) {
state.currentTab = tabId;

document.querySelectorAll('.tab-content').forEach(el => {
el.style.display = 'none';
});

document.querySelectorAll('.tab-btn').forEach(el => {
el.classList.remove('active');
});

const activeTabContent = $(tabId);
const activeTabBtn = document.querySelector(.tab-btn[data-tab-target="${tabId}"]);

if (activeTabContent) activeTabContent.style.display = 'block';
if (activeTabBtn) activeTabBtn.classList.add('active');

if (tabId === "karaoke") {
console.log("🎤 [Lazy Load] Inicializando Canvas e Históricos de Canto...");

try {
  const { loadTrackOptionsInKaraoke } = await import("./modules/karaoke.js");
  if (typeof loadTrackOptionsInKaraoke === "function") loadTrackOptionsInKaraoke();
} catch (err) {
  console.warn("⚠️ No se pudieron cargar algunas funciones de karaoke:", err);
}

try {
  const configMod = await import("./modules/config.js").catch(() => null);
  if (configMod && typeof configMod.inicializarEscenarioDesdeMemoria === "function") {
    configMod.inicializarEscenarioDesdeMemoria();
  }
} catch (err) {
  console.warn("⚠️ Módulo de configuración no disponible:", err);
}

const canvas = $("karaokeCanvas");
if (canvas) {
  console.log("✅ Canvas de karaoke detectado y listo en el DOM.");
} else {
  console.warn("⚠️ No se encontró el canvas de karaoke (#karaokeCanvas).");
}


}
}

window.switchTab = switchTab;

document.addEventListener("DOMContentLoaded", () => {
// 1. Asignar Eventos de las Pestañas de Navegación
document.querySelectorAll('.tab-btn').forEach(btn => {
btn.addEventListener('click', (e) => {
const tabTarget = e.currentTarget.dataset.tabTarget;
if (tabTarget) {
switchTab(tabTarget);
}
});
});

// 2. Aplicar Tema
const temaGuardado = localStorage.getItem("vocalApp_theme") || "oscuro";
document.documentElement.setAttribute("data-theme", temaGuardado);
document.body.setAttribute("data-theme", temaGuardado);

function applyKaraokeTheme() {
const theme = localStorage.getItem("vocalApp_stage") || "theme-clasico";
const monitor = $("karaokeLiveLyrics");
if (monitor) {
monitor.className = karaoke-live-lyrics ${theme};
}
}
applyKaraokeTheme();

// 3. Inicializar Base de Datos
(async () => {
try {
const { initSupabase } = await import("./modules/biblioteca.js");
if (typeof initSupabase === "function") {
await initSupabase();
}
} catch (err) {
console.warn("⚠️ Advertencia inicializando Supabase:", err);
}
})();

// Eventos para filtros de biblioteca
safeAdd("btnFilterTodos", "click", async () => {
const { renderLibrary } = await import("./modules/biblioteca.js");
if (renderLibrary) renderLibrary("todos");
});
safeAdd("btnFilterPista", "click", async () => {
const { renderLibrary } = await import("./modules/biblioteca.js");
if (renderLibrary) renderLibrary("pista");
});
safeAdd("btnFilterVoz", "click", async () => {
const { renderLibrary } = await import("./modules/biblioteca.js");
if (renderLibrary) renderLibrary("voz");
});
safeAdd("btnFilterGrabaciones", "click", async () => {
const { renderLibrary } = await import("./modules/biblioteca.js");
if (renderLibrary) renderLibrary("grabacion");
});
safeAdd("btnFilterKaraoke", "click", async () => {
const { renderLibrary } = await import("./modules/biblioteca.js");
if (renderLibrary) renderLibrary("karaoke");
});

// 4. Configurar Reproductor de Karaoke
const karaokePlayer = $("karaokeTrack") \vert{}\vert{} $("trackPlayer");
if (karaokePlayer) {
karaokePlayer.addEventListener("timeupdate", () => {
if (typeof window.syncKaraokeMonitor === "function") {
window.syncKaraokeMonitor(karaokePlayer.currentTime);
}

  const canvas = $("karaokeCanvas");
  if (!canvas) return;

  if (typeof window.drawKaraokeMonitor === "function" && !state.isRecording) {
    window.drawKaraokeMonitor(karaokePlayer.currentTime, -1, -1);
  }
});

karaokePlayer.addEventListener("ended", () => {
  if (typeof window.syncKaraokeMonitor === "function") {
    window.syncKaraokeMonitor(0);
  }
});


}

// Botón de alternar Modo Dúo Split
safeAdd("karaokeDuoSplitToggleBtn", "click", async () => {
try {
const { toggleKaraokeDuoSplitMode } = await import("./modules/karaoke.js");
if (typeof toggleKaraokeDuoSplitMode === "function") {
toggleKaraokeDuoSplitMode();
}
} catch (err) {
console.error("❌ Error al cargar toggleKaraokeDuoSplitMode:", err);
}
});

// Botón de Iniciar Grabación
safeAdd("karaokeStartBtn", "click", async () => {
state.isRecording = true;
try {
const { startKaraokeRecording } = await import("./modules/karaoke.js");
if (typeof startKaraokeRecording === "function") {
startKaraokeRecording();
}
} catch (err) {
console.error("❌ Error iniciando grabación:", err);
state.isRecording = false;
}
});

// Botón de Detener Grabación
safeAdd("karaokeStopBtn", "click", async () => {
state.isRecording = false;
try {
const { stopKaraokeRecording } = await import("./modules/karaoke.js");
if (typeof stopKaraokeRecording === "function") {
stopKaraokeRecording();
}
} catch (err) {
console.error("❌ Error deteniendo grabación:", err);
}
});

// Botón de Reiniciar Pista
safeAdd("karaokeRestartBtn", "click", async () => {
state.isRecording = false;
try {
const { restartKaraokeRecording } = await import("./modules/karaoke.js");
if (typeof restartKaraokeRecording === "function") {
restartKaraokeRecording();
}
} catch (err) {
console.error("❌ Error reiniciando pista:", err);
}
});

// Botón de Mezcla (Track + Voz)
safeAdd("karaokeMixBtn", "click", async () => {
try {
const { mixKaraoke } = await import("./modules/karaoke.js");
if (typeof mixKaraoke === "function") {
mixKaraoke();
}
} catch (err) {
console.error("❌ Error llamando a mixKaraoke:", err);
}
});
});
