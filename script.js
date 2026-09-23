import { $ } from "./modules/utils.js";

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`âš ï¸ No se encontrÃ³ el elemento con ID: ${id} para registrar el evento [${event}]`);
  }
}

export const state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
};

// FIX #6: eliminada la variable local `autoScrollEnabled` que duplicaba la de
// `estudio.js`. Ahora el botÃ³n consulta el estado real via `toggleAutoScrollEstudio()`
// (que retorna el valor actualizado) para evitar desincronizaciÃ³n en hot-reload
// o reimportaciones del mÃ³dulo.
const allKaraokeThemes = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];

// ============================================
// 🚀 ENRUTADOR DINÁMICO Y DESCARGA BAJO DEMANDA (LAZY IMPORT)
// ============================================
// Limpieza al salir de un tab: detiene audios/mics/renders que de otro modo
// seguirían vivos en segundo plano (grabación karaoke, mic del afinador,
// guía sonando, render offline de tono, test de mics).
let currentTabId = null;
// Puerta anti-carreras: clics rápidos a tabs disparan showTab concurrentes;
// el init tardío de un tab anterior no debe ejecutarse sobre el tab actual.
let navSeq = 0;
// Inits que registran listeners: una sola vez (re-entrar duplicaba handlers).
const tabsIniciados = new Set();
window.supabaseReady = false;

async function cleanupTab(tabId) {
  try {
    if (tabId === "karaoke") {
      const { destroyKaraoke } = await import("./modules/karaoke.js?v=18");
      if (typeof destroyKaraoke === "function") destroyKaraoke();
    } else if (tabId === "afinador") {
      const { destroyAfinador } = await import("./modules/afinador.js?v=1");
      if (typeof destroyAfinador === "function") destroyAfinador();
    } else if (tabId === "cambiar-tono") {
      const { destroyCambiarTono } = await import("./modules/cambiar-tono.js?v=6");
      if (typeof destroyCambiarTono === "function") destroyCambiarTono();
    } else if (tabId === "config") {
      const { destroyConfig } = await import("./modules/config.js?v=9");
      if (typeof destroyConfig === "function") destroyConfig();
    } else if (tabId === "separador") {
      const { destroySeparador } = await import("./modules/separador.js");
      if (typeof destroySeparador === "function") destroySeparador();
    }
  } catch (e) {
    console.warn(`No se pudo limpiar el tab [${tabId}]:`, e);
  }
}

export async function showTab(tabId) {
  const originalTabId = String(tabId);
  const normalizedTabId = originalTabId.toLowerCase();

  console.log(`\n📌 [Navegación] Solicitando cambio a la pestaña: [${normalizedTabId.toUpperCase()}]`);

  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));

  const target = document.getElementById(normalizedTabId);
  if (target) {
    target.classList.add("active");
  } else {
    console.warn(`⚠️ No se encontró la pestaña con ID: ${normalizedTabId}`);
    return;
  }

  if (currentTabId && currentTabId !== normalizedTabId) {
    await cleanupTab(currentTabId);
  }
  currentTabId = normalizedTabId;
  const navAhora = ++navSeq;

  document.querySelectorAll(".sidebar button").forEach(btn => btn.classList.remove("active"));

  const btnMap = {
    config: "btnConfig",
    biblioteca: "btnBiblioteca",
    estudio: "btnEstudio",
    afinador: "btnAfinador",
    "cambiar-tono": "btnCambiarTono",
    karaoke: "btnKaraoke",
    separador: "btnSeparador"
  };

  const activeBtn = document.getElementById(btnMap[normalizedTabId]);
  if (activeBtn) activeBtn.classList.add("active");

  // Si durante la limpieza arrancó otra navegación, abortar: el init tardío
  // no debe ejecutarse sobre el tab nuevo.
  if (navAhora !== navSeq) return;

  // Inits con listeners: una sola vez por sesión (re-entrar duplicaba handlers).
  const initUnaVez = (tab) => {
    if (tabsIniciados.has(tab)) return false;
    tabsIniciados.add(tab);
    return true;
  };

  try {
    if (normalizedTabId === "config") {
      console.log("âš™ï¸ [Lazy Load] Cargando configuraciones de hardware...");
      const { initSettings, loadAvailableMics } = await import("./modules/config.js?v=9");
      if (navAhora !== navSeq) return;
      if (typeof initSettings === "function") initSettings();
      if (typeof loadAvailableMics === "function") await loadAvailableMics();
    } else if (normalizedTabId === "biblioteca") {
      console.log("ðŸ“ [Lazy Load] Cargando visor de Base de Datos...");
      const { initBiblioteca, renderLibrary } = await import("./modules/biblioteca.js?v=4");
      if (navAhora !== navSeq) return;
      if (typeof initBiblioteca === "function" && initUnaVez("biblioteca")) {
        initBiblioteca();
      }
      } else if (normalizedTabId === "estudio") {
      console.log("ðŸŽ§ [Lazy Load] Cargando entorno de sincronizaciÃ³n y listados...");
      const { initEstudio, refreshStudioChecklist } = await import("./modules/estudio.js");
      if (navAhora !== navSeq) return;
      if (typeof initEstudio === "function" && initUnaVez("estudio")) {
        await initEstudio();
      }
      if (typeof refreshStudioChecklist === "function") refreshStudioChecklist();
    } else if (normalizedTabId === "afinador") {
      console.log("ðŸŽµ [Lazy Load] MÃ³dulo Afinador Vocal listo.");
      const { initAfinadorUI } = await import("./modules/afinador.js?v=1");
      if (navAhora !== navSeq) return;
      if (typeof initAfinadorUI === "function") initAfinadorUI();
    } else if (normalizedTabId === "cambiar-tono") {
      console.log("ðŸŽ¼ [Lazy Load] MÃ³dulo Cambiar Tono listo.");
      const { initCambiarTono, loadPitchKaraokeOptions } = await import("./modules/cambiar-tono.js?v=6");
      if (navAhora !== navSeq) return;
      if (typeof initCambiarTono === "function" && initUnaVez("cambiar-tono")) initCambiarTono();
      if (typeof loadPitchKaraokeOptions === "function") await loadPitchKaraokeOptions();
    } else if (normalizedTabId === "karaoke") {
      console.log("ðŸŽ¤ [Lazy Load] Inicializando Canvas e HistÃ³ricos de Canto...");
      const { loadTrackOptionsInKaraoke, loadKaraokeSong } = await import("./modules/karaoke.js?v=18");
      const { inicializarEscenarioDesdeMemoria } = await import("./modules/config.js?v=9");

      if (typeof inicializarEscenarioDesdeMemoria === "function") inicializarEscenarioDesdeMemoria();
      if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();

      const track = $("karaokeTrack");
      // Solo carga si tiene ID Y NO tiene el flag de prevenciÃ³n
      if (track && track.dataset.karaokeId && !track.dataset.preventLoad && typeof loadKaraokeSong === "function") {
        await loadKaraokeSong(track.dataset.karaokeId);
      }
      // Limpiar el flag para futuras navegaciones manuales
      if (track) delete track.dataset.preventLoad;
    } else if (normalizedTabId === "separador") {
      console.log("🎛️ [Lazy Load] Módulo Separador listo.");
      const { initSeparador } = await import("./modules/separador.js");
      if (navAhora !== navSeq) return;
      if (typeof initSeparador === "function" && initUnaVez("separador")) initSeparador();
    }
    console.log(`âœ… [NavegaciÃ³n] PestaÃ±a [${normalizedTabId.toUpperCase()}] cargada y visualizada.`);
  } catch (error) {
    console.error(`âŒ [Lazy Load Error] FallÃ³ el mÃ³dulo [${normalizedTabId}]:`, error);
  }
}

// --- CONTROLADOR COMPARTIDO DEL MONITOR DE KARAOKE GRAPHICS ---
let _karaokeRenderPincel = null;
export async function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2 = 0) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;

  // Cachear la referencia al renderizador para evitar un import dinÃ¡mico por cada repintado
  if (!_karaokeRenderPincel) {
    const { drawKaraokeMonitor: renderPincel } = await import('./modules/karaoke.js?v=18');
    _karaokeRenderPincel = renderPincel;
  }
  if (typeof _karaokeRenderPincel === "function") {
    _karaokeRenderPincel(currentTime, currentFreq, currentFreq2);
  }
}

function iniciarAplicacion() {
  console.log("ðŸ [karaokeTrain] El nÃºcleo del sistema ha arrancado exitosamente.");
  showTab("Config");
}

// ============================================
// DomContentLoaded â€” CAPA GENERAL DE INYECCIÃ“N DE EVENTOS
// ============================================
document.addEventListener("DOMContentLoaded", async () => {
  // --- INICIALIZACIÃ“N DE SUPABASE CON RETRY ---
  const initSupabaseWithRetry = async (retries = 8, delay = 500) => {
    for (let i = 0; i < retries; i++) {
      if (window.supabase) {
        try {
          const { initSupabase } = await import("./modules/biblioteca.js?v=4");
          if (typeof initSupabase === "function") {
            await initSupabase();
            console.log("âœ… Supabase inicializado correctamente.");
            window.supabaseReady = true;
            return true;
          }
        } catch (err) {
          console.warn(`âš ï¸ Intento ${i + 1} de inicializar Supabase fallÃ³:`, err);
        }
      }
      console.log(`â³ Esperando a Supabase... (intento ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
    console.error("âŒ No se pudo inicializar Supabase tras varios intentos.");
    window.supabaseReady = false;
    alert("âš ï¸ No se pudo conectar con la base de datos (Supabase/CDN). Revisa tu conexiÃ³n y recarga. La biblioteca no mostrarÃ¡ archivos.");
    return false;
  };

  await initSupabaseWithRetry();


  const temaGuardado = localStorage.getItem("karaokeTrain_theme") || "oscuro";
  document.documentElement.setAttribute("data-theme", temaGuardado);
  document.body.setAttribute("data-theme", temaGuardado);

  function applyKaraokeTheme() {
    const theme = localStorage.getItem("karaokeTrain_stage") || "theme-clasico";
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

  // --- NAVEGACIÃ“N SIDEBAR ---
  safeAdd("btnAfinador", "click", () => showTab("afinador"));
  safeAdd("btnEstudio", "click", () => showTab("estudio"));
  safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
  safeAdd("btnCambiarTono", "click", () => showTab("cambiar-tono"));
  safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
  safeAdd("btnSeparador", "click", () => showTab("separador"));
  safeAdd("btnConfig", "click", () => showTab("Config"));

  // --- EVENTOS AFINADOR ---
  safeAdd("recordBtn", "click", async () => {
    const { toggleRecording } = await import("./modules/afinador.js?v=1");
    if (typeof toggleRecording === "function") toggleRecording();
  });

  // --- EVENTOS ESTUDIO ---
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
    // FIX #6: ahora pedimos a estudio.js que togglee Y nos devuelva el estado
    // actualizado. No guardamos una copia local para evitar desincronizaciÃ³n.
    const estudioModule = await import("./modules/estudio.js");
    const enabled = typeof estudioModule.toggleAutoScrollEstudio === "function"
      ? estudioModule.toggleAutoScrollEstudio()
      : !document.getElementById("toggleAutoScrollBtn")?.textContent.includes("ON");
    const btn = $("toggleAutoScrollBtn");
    if (btn) {
      btn.textContent = enabled ? "ðŸ”’ Auto-scroll: ON" : "ðŸ”“ Auto-scroll: OFF";
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
    const { saveManualFileToLibrary } = await import("./modules/biblioteca.js?v=4");
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

  // --- EVENTOS CAMBIAR TONO ---
  safeAdd("loadPitchKaraokeBtn", "click", async () => {
    const { loadSelectedPitchKaraoke } = await import("./modules/cambiar-tono.js?v=6");
    if (typeof loadSelectedPitchKaraoke === "function") loadSelectedPitchKaraoke();
  });
  safeAdd("pitchPlayBtn", "click", async () => {
    const { playPitchShifted } = await import("./modules/cambiar-tono.js?v=6");
    if (typeof playPitchShifted === "function") playPitchShifted();
  });
  safeAdd("pitchStopBtn", "click", async () => {
    const { stopPitchShifted } = await import("./modules/cambiar-tono.js?v=6");
    if (typeof stopPitchShifted === "function") stopPitchShifted();
  });
  safeAdd("pitchSaveBtn", "click", async () => {
    const { savePitchShiftedToLibrary } = await import("./modules/cambiar-tono.js?v=6");
    if (typeof savePitchShiftedToLibrary === "function") savePitchShiftedToLibrary();
  });
  safeAdd("pitchSendToKaraokeBtn", "click", async () => {
    const { sendPitchShiftedToKaraokeMonitor } = await import("./modules/cambiar-tono.js?v=6");
    if (typeof sendPitchShiftedToKaraokeMonitor === "function") sendPitchShiftedToKaraokeMonitor();
  });

  // --- EVENTOS KARAOKE ---
  safeAdd("karaokeTrackSelect", "change", async () => {
    const { loadKaraokeSong } = await import("./modules/karaoke.js?v=18");
    const id = $("karaokeTrackSelect")?.value;
    if (id && typeof loadKaraokeSong === "function") loadKaraokeSong(id);
  });
  safeAdd("karaokeDuoSplitToggleBtn", "click", async () => {
    const { toggleKaraokeDuoSplitMode } = await import("./modules/karaoke.js?v=18");
    if (typeof toggleKaraokeDuoSplitMode === "function") toggleKaraokeDuoSplitMode();
  });
  safeAdd("karaokeStartBtn", "click", async () => {
    const { startKaraokeRecording } = await import("./modules/karaoke.js?v=18");
    if (typeof startKaraokeRecording === "function") startKaraokeRecording();
  });
  safeAdd("karaokeStopBtn", "click", async () => {
    const { stopKaraokeRecording } = await import("./modules/karaoke.js?v=18");
    if (typeof stopKaraokeRecording === "function") stopKaraokeRecording();
  });
  safeAdd("karaokeRestartBtn", "click", async () => {
    const { restartKaraokeRecording } = await import("./modules/karaoke.js?v=18");
    if (typeof restartKaraokeRecording === "function") restartKaraokeRecording();
  });
  safeAdd("karaokeMixBtn", "click", async () => {
    const { mixKaraoke } = await import("./modules/karaoke.js?v=18");
    if (typeof mixKaraoke === "function") mixKaraoke();
  });

  // --- EVENTOS CONFIGURACIÃ“N HARDWARE MICS ---
  safeAdd("refreshMicsBtn", "click", async () => {
    const { loadAvailableMics } = await import("./modules/config.js?v=9");
    if (typeof loadAvailableMics === "function") loadAvailableMics();
  });
  safeAdd("testMic1Btn", "click", async () => {
    const { testMicrophone } = await import("./modules/config.js?v=9");
    if (typeof testMicrophone === "function") testMicrophone(1);
  });
  safeAdd("testMic2Btn", "click", async () => {
    const { testMicrophone } = await import("./modules/config.js?v=9");
    if (typeof testMicrophone === "function") testMicrophone(2);
  });
  safeAdd("stopMic1TestBtn", "click", async () => {
    const { stopMicTest } = await import("./modules/config.js?v=9");
    if (typeof stopMicTest === "function") stopMicTest();
  });
  safeAdd("stopMic2TestBtn", "click", async () => {
    const { stopMicTest } = await import("./modules/config.js?v=9");
    if (typeof stopMicTest === "function") stopMicTest();
  });

  // Carga inicial diferida
  try {
    const { initSettings, loadAvailableMics, toggleMic2Visibility } = await import("./modules/config.js?v=9");
    if (typeof initSettings === "function") initSettings();
    if (typeof loadAvailableMics === "function") await loadAvailableMics();
    if (typeof toggleMic2Visibility === "function") toggleMic2Visibility();
  } catch (e) {
    console.warn("InicializaciÃ³n inicial diferida para interacciÃ³n con usuario.");
  }

  iniciarAplicacion();
});
