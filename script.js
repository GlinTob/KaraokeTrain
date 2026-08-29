export function $(id) {
  return document.getElementById(id);
}

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`⚠️ No se encontró el elemento con ID: ${id} para registrar el evento [${event}]`);
  }
}

export const state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
};

let autoScrollEnabled = true;
const allKaraokeThemes = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];

// ============================================
// 🚀 ENRUTADOR DINÁMICO Y DESCARGA BAJO DEMANDA (LAZY IMPORT)
// ============================================
export async function showTab(tabId) {
  const originalTabId = String(tabId);
  const normalizedTabId = originalTabId === "cambiarTono"
    ? "cambiarTono"
    : originalTabId.toLowerCase();

  console.log(`\n📌 [Navegación] Solicitando cambio a la pestaña: [${normalizedTabId.toUpperCase()}]`);

  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));

  const target = document.getElementById(normalizedTabId);
  if (target) {
    target.classList.add("active");
  } else {
    console.warn(`⚠️ No se encontró la pestaña con ID: ${normalizedTabId}`);
    return;
  }

  document.querySelectorAll(".sidebar button").forEach(btn => btn.classList.remove("active"));

  const btnMap = {
    config: "btnConfig",
    biblioteca: "btnBiblioteca",
    estudio: "btnEstudio",
    afinador: "btnAfinador",
    karaoke: "btnKaraoke",
    cambiarTono: "btnCambiarTono"
  };

  const activeBtn = document.getElementById(btnMap[normalizedTabId]);
  if (activeBtn) activeBtn.classList.add("active");

  try {
    if (normalizedTabId === "config") {
      console.log("⚙️ [Lazy Load] Cargando configuraciones de hardware...");
      const { initSettings, loadAvailableMics } = await import("./modules/config.js");
      if (typeof initSettings === "function") initSettings();
      if (typeof loadAvailableMics === "function") await loadAvailableMics();
    } else if (normalizedTabId === "biblioteca") {
      console.log("📁 [Lazy Load] Cargando visor de Base de Datos...");
      const { initBiblioteca, renderLibrary } = await import("./modules/biblioteca.js");
      if (typeof initBiblioteca === "function") {
        initBiblioteca();
      }
      if (typeof renderLibrary === "function") {
        await renderLibrary("todos");
      }
    } else if (normalizedTabId === "estudio") {
      console.log("🎧 [Lazy Load] Cargando entorno de sincronización y listados...");
      const { initEstudio } = await import("./modules/estudio.js");
      if (typeof initEstudio === "function") {
        await initEstudio();
      }
    } else if (normalizedTabId === "afinador") {
      console.log("🎵 [Lazy Load] Módulo Afinador Vocal listo.");
    } else if (normalizedTabId === "cambiarTono") {
      console.log("🧭 [Lazy Load] Cargando herramientas de cambio de tono...");
      const { initCambiarTono, loadPitchKaraokeOptions } = await import("./modules/cambiar-tono.js");
      if (typeof initCambiarTono === "function") initCambiarTono();
      if (typeof loadPitchKaraokeOptions === "function") await loadPitchKaraokeOptions();
    } else if (normalizedTabId === "karaoke") {
      console.log("🎤 [Lazy Load] Inicializando Canvas e Históricos de Canto...");
      const { loadTrackOptionsInKaraoke, loadKaraokeSong } = await import("./modules/karaoke.js");
      const { inicializarEscenarioDesdeMemoria } = await import("./modules/config.js");

      if (typeof inicializarEscenarioDesdeMemoria === "function") inicializarEscenarioDesdeMemoria();
      if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();

      const track = $("karaokeTrack");
      // Solo carga si tiene ID Y NO tiene el flag de prevención
      if (track && track.dataset.karaokeId && !track.dataset.preventLoad && typeof loadKaraokeSong === "function") {
        await loadKaraokeSong(track.dataset.karaokeId);
      }
      // Limpiar el flag para futuras navegaciones manuales
      if (track) delete track.dataset.preventLoad;
    }
    console.log(`✅ [Navegación] Pestaña [${normalizedTabId.toUpperCase()}] cargada y visualizada.`);
  } catch (error) {
    console.error(`❌ [Lazy Load Error] Falló el módulo [${normalizedTabId}]:`, error);
  }
}

// --- CONTROLADOR COMPARTIDO DEL MONITOR DE KARAOKE GRAPHICS ---
let _karaokeRenderPincel = null;
export async function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2 = 0) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;

  // Cachear la referencia al renderizador para evitar un import dinámico por cada repintado
  if (!_karaokeRenderPincel) {
    const { drawKaraokeMonitor: renderPincel } = await import('./modules/karaoke.js');
    _karaokeRenderPincel = renderPincel;
  }
  if (typeof _karaokeRenderPincel === "function") {
    _karaokeRenderPincel(currentTime, currentFreq, currentFreq2);
  }
}

function iniciarAplicacion() {
  console.log("🏁 [vocalApp] El núcleo del sistema ha arrancado exitosamente.");
  showTab("afinador");
}

// ============================================
// DomContentLoaded — CAPA GENERAL DE INYECCIÓN DE EVENTOS
// ============================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const { initSupabase } = await import("./modules/biblioteca.js");
    if (typeof initSupabase === "function") {
      await initSupabase();
    }
  } catch (err) {
    console.warn("⚠️ Advertencia inicializando Supabase:", err);
  }

  const temaGuardado = localStorage.getItem("vocalApp_theme") || "oscuro";
  document.documentElement.setAttribute("data-theme", temaGuardado);
  document.body.setAttribute("data-theme", temaGuardado);

  function applyKaraokeTheme() {
    const theme = localStorage.getItem("vocalApp_stage") || "theme-clasico";
    const monitor = $("karaokeLiveLyrics");
    if (monitor) {
      monitor.classList.remove(...allKaraokeThemes);
      monitor.classList.add(theme);
    }
  }

  applyKaraokeTheme();

  const karaokePlayer = $("karaokeTrack") || $("trackPlayer");
  if (karaokePlayer) {
    karaokePlayer.addEventListener("timeupdate", () => {
      if (typeof window.syncKaraokeMonitor === "function") {
        window.syncKaraokeMonitor(karaokePlayer.currentTime);
      }
      if (typeof drawKaraokeMonitor === "function" && (typeof window.karaokeMediaRecorder === "undefined" || !window.karaokeMediaRecorder || window.karaokeMediaRecorder.state !== "recording")) {
        drawKaraokeMonitor(karaokePlayer.currentTime, -1, -1);
      }
    });

    karaokePlayer.addEventListener("ended", () => {
      if (typeof window.syncKaraokeMonitor === "function") {
        window.syncKaraokeMonitor(0);
      }
    });
  }

  const studioPlayer = $("player");
  if (studioPlayer) {
    studioPlayer.addEventListener("timeupdate", () => {
      if (typeof window.updateKaraokeHighlight === "function") {
        window.updateKaraokeHighlight(studioPlayer.currentTime);
      }
    });
    studioPlayer.addEventListener("ended", () => {
      if (typeof window.updateKaraokeHighlight === "function") {
        window.updateKaraokeHighlight(0);
      }
    });
  }

  // --- NAVEGACIÓN SIDEBAR ---
  safeAdd("btnAfinador", "click", () => showTab("afinador"));
  safeAdd("btnEstudio", "click", () => showTab("estudio"));
  safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
  safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
  safeAdd("btnConfig", "click", () => showTab("config"));
  safeAdd("btnCambiarTono", "click", () => showTab("cambiarTono"));

  // --- EVENTOS AFINADOR ---
  safeAdd("recordBtn", "click", async () => {
    const { toggleRecording } = await import("./modules/afinador.js");
    if (typeof toggleRecording === "function") toggleRecording();
  });

  // --- EVENTOS ESTUDIO ---
/*
  safeAdd("audioFile", "change", async (e) => {
    const { cargarAudioEstudio } = await import("./modules/estudio.js");
    if (typeof cargarAudioEstudio === "function") cargarAudioEstudio(e);
  });
  */
  safeAdd("loadStudioTrackBtn", "click", async () => {
    const { loadSelectedTrackFromLibraryStudio } = await import("./modules/estudio.js");
    if (typeof loadSelectedTrackFromLibraryStudio === "function") loadSelectedTrackFromLibraryStudio();
  });
  safeAdd("loadSelectedVoiceBtn", "click", async () => {
    const { loadSelectedVoiceFromLibrary } = await import("./modules/estudio.js");
    if (typeof loadSelectedVoiceFromLibrary === "function") loadSelectedVoiceFromLibrary();
  });
  safeAdd("loadSelectedTextBtn", "click", async () => {
    const { loadSelectedTextFromLibrary } = await import("./modules/estudio.js");
    if (typeof loadSelectedTextFromLibrary === "function") loadSelectedTextFromLibrary();
  });
  safeAdd("applyCorrectedLyricsBtn", "click", async () => {
    const { applyCorrectedLyrics } = await import("./modules/estudio.js");
    if (typeof applyCorrectedLyrics === "function") applyCorrectedLyrics();
  });

  safeAdd("toggleAutoScrollBtn", "click", async () => {
    const { toggleAutoScrollEstudio } = await import("./modules/estudio.js");
    const enabled = typeof toggleAutoScrollEstudio === "function"
      ? toggleAutoScrollEstudio()
      : !autoScrollEnabled;
    autoScrollEnabled = enabled;
    const btn = $("toggleAutoScrollBtn");
    if (btn) {
      btn.textContent = enabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
      btn.style.background = enabled ? "#f59e0b" : "#6b7280";
    }
  });

  safeAdd("startTapSyncBtn", "click", async () => {
    const { startTapSync } = await import("./modules/estudio.js");
    if (typeof startTapSync === "function") startTapSync();
  });
  safeAdd("cancelTapSyncBtn", "click", async () => {
    const { cancelTapSync } = await import("./modules/estudio.js");
    if (typeof cancelTapSync === "function") cancelTapSync();
  });
  safeAdd("tapBeatBtn", "click", async () => {
    const { recordTap } = await import("./modules/estudio.js");
    if (typeof recordTap === "function") recordTap();
  });
  safeAdd("applyTapSyncBtn", "click", async () => {
    const { finishTapSync } = await import("./modules/estudio.js");
    if (typeof finishTapSync === "function") finishTapSync();
  });
  safeAdd("redoTapSyncBtn", "click", async () => {
    const { cancelTapSync, startTapSync } = await import("./modules/estudio.js");
    if (typeof cancelTapSync === "function") cancelTapSync();
    if (typeof startTapSync === "function") startTapSync();
  });
  safeAdd("tapPartP1Btn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("P1");
  });
  safeAdd("tapPartP2Btn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("P2");
  });
  safeAdd("tapPartDuoBtn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("DUO");
  });

  // --- EVENTOS BIBLIOTECA ---
  safeAdd("saveLibraryFileBtn", "click", async () => {
    const { saveManualFileToLibrary } = await import("./modules/biblioteca.js");
    if (typeof saveManualFileToLibrary === "function") saveManualFileToLibrary();
  });
  safeAdd("libraryFileInput", "change", (e) => {
    const file = e.target.files[0];
    const nameInput = $("libraryFileName");
    if (file && nameInput && !nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.[^.]+/, "");
    }
  });
  safeAdd("libraryFileType", "change", () => {
    const typeSelect = $("libraryFileType");
    const fileInput = $("libraryFileInput");
    if (typeSelect && fileInput) {
      if (typeSelect.value === "texto") {
        fileInput.setAttribute("accept", ".txt");
      } else {
        fileInput.setAttribute("accept", "audio/*");
      }
    }
  });

  // --- EVENTOS KARAOKE ---
  safeAdd("karaokeDuoSplitToggleBtn", "click", async () => {
    const { toggleKaraokeDuoSplitMode } = await import("./modules/karaoke.js");
    if (typeof toggleKaraokeDuoSplitMode === "function") toggleKaraokeDuoSplitMode();
  });
  safeAdd("karaokeStartBtn", "click", async () => {
    const { startKaraokeRecording } = await import("./modules/karaoke.js");
    if (typeof startKaraokeRecording === "function") startKaraokeRecording();
  });
  safeAdd("karaokeStopBtn", "click", async () => {
    const { stopKaraokeRecording } = await import("./modules/karaoke.js");
    if (typeof stopKaraokeRecording === "function") stopKaraokeRecording();
  });
  safeAdd("karaokeRestartBtn", "click", async () => {
    const { restartKaraokeRecording } = await import("./modules/karaoke.js");
    if (typeof restartKaraokeRecording === "function") restartKaraokeRecording();
  });
  safeAdd("karaokeMixBtn", "click", async () => {
    const { mixKaraoke } = await import("./modules/karaoke.js");
    if (typeof mixKaraoke === "function") mixKaraoke();
  });

  // --- EVENTOS CAMBIAR TONO ---
  safeAdd("refreshPitchKaraokeListBtn", "click", async () => {
    const { loadPitchKaraokeOptions } = await import("./modules/cambiar-tono.js");
    if (typeof loadPitchKaraokeOptions === "function") loadPitchKaraokeOptions();
  });
  safeAdd("loadPitchKaraokeBtn", "click", async () => {
    const { loadSelectedPitchKaraoke } = await import("./modules/cambiar-tono.js");
    if (typeof loadSelectedPitchKaraoke === "function") loadSelectedPitchKaraoke();
  });
  safeAdd("pitchPlayBtn", "click", async () => {
    const { playPitchShifted } = await import("./modules/cambiar-tono.js");
    if (typeof playPitchShifted === "function") playPitchShifted();
  });
  safeAdd("pitchStopBtn", "click", async () => {
    const { stopPitchShifted } = await import("./modules/cambiar-tono.js");
    if (typeof stopPitchShifted === "function") stopPitchShifted();
  });
  safeAdd("pitchSaveBtn", "click", async () => {
    const { savePitchShiftedToLibrary } = await import("./modules/cambiar-tono.js");
    if (typeof savePitchShiftedToLibrary === "function") savePitchShiftedToLibrary();
  });
  safeAdd("pitchSendToKaraokeBtn", "click", async () => {
    const { sendPitchShiftedToKaraokeMonitor } = await import("./modules/cambiar-tono.js");
    if (typeof sendPitchShiftedToKaraokeMonitor === "function") sendPitchShiftedToKaraokeMonitor();
  });

  // --- EVENTOS CONFIGURACIÓN HARDWARE MICS ---
  safeAdd("refreshMicsBtn", "click", async () => {
    const { loadAvailableMics } = await import("./modules/config.js");
    if (typeof loadAvailableMics === "function") loadAvailableMics();
  });
  safeAdd("testMic1Btn", "click", async () => {
    const { testMicrophone } = await import("./modules/config.js");
    if (typeof testMicrophone === "function") testMicrophone(1);
  });
  safeAdd("testMic2Btn", "click", async () => {
    const { testMicrophone } = await import("./modules/config.js");
    if (typeof testMicrophone === "function") testMicrophone(2);
  });
  safeAdd("stopMic1TestBtn", "click", async () => {
    const { stopMicTest } = await import("./modules/config.js");
    if (typeof stopMicTest === "function") stopMicTest();
  });
  safeAdd("stopMic2TestBtn", "click", async () => {
    const { stopMicTest } = await import("./modules/config.js");
    if (typeof stopMicTest === "function") stopMicTest();
  });

  // Carga inicial diferida
  try {
    const { initSettings, loadAvailableMics, toggleMic2Visibility } = await import("./modules/config.js");
    if (typeof initSettings === "function") initSettings();
    if (typeof loadAvailableMics === "function") await loadAvailableMics();
    if (typeof toggleMic2Visibility === "function") toggleMic2Visibility();
  } catch (e) {
    console.warn("Inicialización inicial diferida para interacción con usuario.");
  }

  iniciarAplicacion();
});
