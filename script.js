/**
 * CORE ORQUESTRADOR PRINCIPAL — vocalApp Brain (script.js)
 * Manejo de Enrutamiento Asíncrono (Lazy Loading) y Eventos Globales de Interfaz
 */
import { drawKaraokeMonitor } from './modules/karaoke.js'; 
import { toggleKaraokeDuoSplitMode } from './modules/karaoke.js';
import { updateMonitorConfig } from './modules/karaoke.js';


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
  console.log(`\n📌 [Navegación] Solicitando cambio a la pestaña: [${tabId.toUpperCase()}]`);

  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".sidebar button").forEach(btn => btn.classList.remove("active"));

  const btnMap = {
    config: "btnConfig",
    biblioteca: "btnBiblioteca",
    estudio: "btnEstudio",
    cambiarTono: "btnCambiarTono",
    afinador: "btnAfinador",
    karaoke: "btnKaraoke",
  };

  const activeBtn = document.getElementById(btnMap[tabId]);
  if (activeBtn) activeBtn.classList.add("active");

  // DISPARADORES DE DESCARGA BAJO DEMANDA (ES MODULES LAZY IMPORT)
  try {
    if (tabId === "config") {
      console.log("⚙️ [Lazy Load] Cargando configuraciones de hardware...");
      const { initSettings, loadAvailableMics } = await import("./modules/config.js");
      if (typeof initSettings === "function") initSettings();
      if (typeof loadAvailableMics === "function") await loadAvailableMics();
    } 
    else if (tabId === "biblioteca") {
      console.log("📁 [Lazy Load] Cargando visor de Base de Datos...");
      const { renderLibrary } = await import("./modules/biblioteca.js");
      if (typeof renderLibrary === "function") await renderLibrary('todos');
    }
    else if (tabId === "estudio") {
      console.log("🎧 [Lazy Load] Cargando entorno de sincronización y listados...");
      const { loadTrackOptionsInStudio, loadVoiceOptionsInStudio } = await import("./modules/estudio.js");
      if (typeof loadTrackOptionsInStudio === "function") await loadTrackOptionsInStudio();
      if (typeof loadVoiceOptionsInStudio === "function") await loadVoiceOptionsInStudio();
    }
    else if (tabId === "afinador") {
      console.log("🎵 [Lazy Load] Módulo Afinador Vocal listo.");
    }
    else if (tabId === "cambiarTono") {
      console.log("🧭 [Lazy Load] Cargando herramientas de cambio de tono...");
      const { loadPitchKaraokeOptions } = await import("./modules/cambiar-tono.js");
      if (typeof loadPitchKaraokeOptions === "function") await loadPitchKaraokeOptions();
    }
    else if (tabId === "karaoke") {
      console.log("🎤 [Lazy Load] Inicializando Canvas e Históricos de Canto...");

      const { loadTrackOptionsInKaraoke, loadKaraokeSong } = await import("./modules/karaoke.js");
      const { inicializarEscenarioDesdeMemoria } = await import("./modules/config.js");
    
      if (typeof inicializarEscenarioDesdeMemoria === "function") inicializarEscenarioDesdeMemoria();
      if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
    
      // ✅ Inicializar karaokeCanvas y ctx cuando se cargue la pestaña Karaoke
      const canvas = document.getElementById("karaokeCanvas");
      if (!canvas) {
        karaokeCanvas = canvas;
        ctx = canvas.getContext("2d");
        console.log("✅ Canvas de karaoke inicializado.");
      } else {
        console.warn("⚠️ No se encontró el canvas de karaoke.");
      }
    
      const track = $("karaokeTrack");
      if (track && track.dataset.karaokeId && typeof loadKaraokeSong === "function") {
        await loadKaraokeSong(track.dataset.karaokeId);
      }
    }

    console.log(`✅ [Navegación] Pestaña [${tabId.toUpperCase()}] cargada y visualizada.`);

  } catch (error) {
    console.error(`❌ [Lazy Load Error] Falló el módulo [${tabId}]:`, error);
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

  const allKaraokeThemes = ['theme-clasico', 'theme-moderno', 'theme-disco', 'theme-acustico', 'theme-fiesta'];
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

  safeAdd("karaokeThemeSelect", "change", async (e) => {
    localStorage.setItem("vocalApp_stage", e.target.value);
    applyKaraokeTheme();
  });

  const karaokePlayer = $("karaokeTrack") || $("trackPlayer");
  if (karaokePlayer) {
    karaokePlayer.addEventListener("timeupdate", () => {
      if (typeof window.syncKaraokeMonitor === "function") {
        window.syncKaraokeMonitor(karaokePlayer.currentTime);
      }

      // --- 🔒 PROTECCIÓN ANTES DE LLAMAR A drawKaraokeMonitor ---
      const canvas = $("karaokeCanvas");
      if (!canvas) {
        console.warn("[Timeupdate] El canvas #karaokeCanvas no está disponible. Saltando dibujo.");
      return;
      }

      if (typeof drawKaraokeMonitor === "function" && (typeof window.karaokeMediaRecorder === "undefined" || window.karaokeMediaRecorder.state !== "recording")) {
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
  //safeAdd("audioFile", "change", async (e) => 
    //const { cargarAudioEstudio } = await import("./modules/estudio.js");
    //if (typeof cargarAudioEstudio === "function") cargarAudioEstudio(e);
  
  safeAdd("loadStudioTrackBtn", "click", async () => {
    const { loadSelectedTrackFromLibraryStudio } = await import("./modules/estudio.js");
    if (typeof loadSelectedTrackFromLibraryStudio === "function") loadSelectedTrackFromLibraryStudio();
  });
  safeAdd("loadSelectedVoiceBtn", "click", async () => {
    const { loadSelectedVoiceFromLibrary } = await import("./modules/estudio.js");
    if (typeof loadSelectedVoiceFromLibrary === "function") loadSelectedVoiceFromLibrary();
  });
  /*
  safeAdd("loadSelectedTextBtn", "click", async () => {
    const { loadSelectedTextFromLibrary } = await import("./modules/estudio.js");
    if (typeof loadSelectedTextFromLibrary === "function") loadSelectedTextFromLibrary();
  });
  */
  safeAdd("applyCorrectedLyricsBtn", "click", async () => {
    const { applyCorrectedLyrics } = await import("./modules/estudio.js");
    if (typeof applyCorrectedLyrics === "function") applyCorrectedLyrics();
  });

  safeAdd("toggleAutoScrollBtn", "click", () => {
    autoScrollEnabled = !autoScrollEnabled;
    const btn = $("toggleAutoScrollBtn");
    if (btn) {
      btn.textContent = autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
      btn.style.background = autoScrollEnabled ? "#f59e0b" : "#6b7280";
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

  safeAdd("tapPartC1Btn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("C1");
  });
  safeAdd("tapPartC2Btn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("C2");
  });
  safeAdd("tapPartDuoBtn", "click", async () => {
    const { setCurrentTapPart } = await import("./modules/estudio.js");
    if (typeof setCurrentTapPart === "function") setCurrentTapPart("DUO");
  });

  // --- EVENTOS BIBLIOTECA ---
  safeAdd("saveLibraryFileBtn", "click", async () => {
    console.log("🔵 [DEBUG] Botón Guardar presionado");

    const fileInput = $("libraryFileInput");
    const typeSelect = $("libraryFileType");
    const nameInput = $("libraryFileName");

    // Verificación 1: ¿Hay archivos?
    if (!fileInput || fileInput.files.length === 0) {
        console.error("❌ [ERROR] El input de archivos está vacío.");
        alert("Error: No hay archivos seleccionados.");
        return;
    }

    // Verificación 2: ¿Hay tipo seleccionado?
    const type = typeSelect ? typeSelect.value : null;
    console.log("📋 [DEBUG] Tipo seleccionado:", type);
    if (!type) {
        console.error("❌ [ERROR] No se ha seleccionado un tipo de archivo.");
        alert("Error: Selecciona un tipo (Pista, Voz, Texto, etc.) antes de guardar.");
        return;
    }

    console.log("📂 [DEBUG] Archivos listos:", fileInput.files.length);
    
    try {
        console.log("⏳ [DEBUG] Importando módulo...");
        const { saveManualFileToLibrary } = await import("./modules/biblioteca.js");
        
        console.log("🚀 [DEBUG] Ejecutando saveManualFileToLibrary...");
        // Pasamos el nombre personalizado de la caja de texto para que el backend lo respete
        await saveManualFileToLibrary();
        
        console.log("✅ [DEBUG] Función finalizada.");
    } catch (error) {
        console.error("🔴 [ERROR CRÍTICO] Excepción en el botón:", error);
        alert("Error fatal: " + error.message);
    }
  });   
  
  safeAdd("libraryFileInput", "change", async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    // 1. MOSTRAR EL MENÚ DE TIPO
    const uploadOptions = $("uploadOptions");
    if (uploadOptions) {
        uploadOptions.style.display = "block"; 
    }

    // 2. Resto de tu lógica (nombre y lista)
    const uploadList = $("uploadFilesList");
    const progressContainer = $("uploadProgressContainer");
    
    if (progressContainer) progressContainer.style.display = "block";

    const { addFileToUploadList } = await import("./modules/biblioteca.js");

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (i === 0) {
            const nameInput = $("libraryFileName");
            if (nameInput && !nameInput.value.trim()) {
                // Removemos la extensión del input visual de la pantalla de forma segura
                nameInput.value = file.name.replace(/\.[^.]+$/, "");
            }
        }
        if (uploadList) {
            // Pasamos el índice i para que la barra de carga mantenga sus IDs únicos
            addFileToUploadList(uploadList, file.name, "pending", i);
        }
    }
  });   
  
  safeAdd("libraryFileType", "change", () => {
    const typeSelect = $("libraryFileType");
    const fileInput = $("libraryFileInput");
    if (typeSelect && fileInput) {
      // Soportar variaciones de nombres técnicos para tus archivos de texto planos manuales
      if (typeSelect.value === "texto" || typeSelect.value === "letra" || typeSelect.value === "texto_plano") {
        fileInput.setAttribute("accept", ".txt");
      } else {
        fileInput.setAttribute("accept", "audio/*");
      }
    }
  });
  // --- EVENTOS KARAOKE ---
  safeAdd("karaokeDuoSplitToggleBtn", "click", () => {
    // Verificar si la función existe en el ámbito global
    if (typeof toggleKaraokeDuoSplitMode === "function") {
      toggleKaraokeDuoSplitMode();
    } else {
      console.error("❌ toggleKaraokeDuoSplitMode no está disponible. Revisa karaoke.js");
    }
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
  safeAdd("pitchPauseBtn", "click", async () => {
    console.warn("⏸️ pausePitchShifted no está implementado en cambiar-tono.js");
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
