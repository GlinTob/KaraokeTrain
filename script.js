export const state = {
  isRecording: false,
  currentTab: "inicio"
};

export function $(id) {
  return document.getElementById(id);
}

// Función auxiliar para agregar eventos de forma segura sin romper el código si el elemento no existe
export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`⚠️ [safeAdd] Elemento no encontrado en el DOM: #${id}`);
  }
}

export async function switchTab(tabId) {
  state.currentTab = tabId;
  
  // Ocultar todos los contenidos de las pestañas
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
  });
  
  // Quitar la clase "active" de todos los botones de pestaña
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('active');
  });
  
  // Mostrar la pestaña actual
  const activeTabContent = $(tabId);
  const activeTabBtn = document.querySelector(`.tab-btn[data-tab-target="${tabId}"]`);
  
  if (activeTabContent) activeTabContent.style.display = 'block';
  if (activeTabBtn) activeTabBtn.classList.add('active');

  // Lógica específica para cuando se abre el "Karaoke"
  if (tabId === "karaoke") {
    console.log("🎤 [Lazy Load] Inicializando Canvas e Históricos de Canto...");

    try {
      // Importamos dinámicamente los módulos para no saturar la carga inicial
      const { loadTrackOptionsInKaraoke } = await import("./modules/karaoke.js");
      const { inicializarEscenarioDesdeMemoria } = await import("./modules/config.js");
    
      if (typeof inicializarEscenarioDesdeMemoria === "function") inicializarEscenarioDesdeMemoria();
      if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
    } catch (err) {
      console.warn("⚠️ No se pudieron cargar algunas dependencias del karaoke:", err);
    }
  
    // ✅ Verificación de canvas limpia
    const canvas = $("karaokeCanvas");
    if (canvas) {
      console.log("✅ Canvas de karaoke detectado y listo en el DOM.");
    } else {
      console.warn("⚠️ No se encontró el canvas de karaoke (#karaokeCanvas).");
    }
  }
}

// Exportar globalmente para que otras vistas puedan cambiar pestañas
window.switchTab = switchTab;

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Inicializar Base de Datos (Supabase)
  try {
    const { initSupabase } = await import("./modules/biblioteca.js");
    if (typeof initSupabase === "function") {
      await initSupabase();
    }
  } catch (err) {
    console.warn("⚠️ Advertencia inicializando Supabase:", err);
  }

  // 2. Aplicar Tema (Oscuro/Claro y Estilo de Escenario)
  const temaGuardado = localStorage.getItem("vocalApp_theme") || "oscuro";
  document.documentElement.setAttribute("data-theme", temaGuardado);
  document.body.setAttribute("data-theme", temaGuardado);

  function applyKaraokeTheme() {
    const theme = localStorage.getItem("vocalApp_stage") || "theme-clasico";
    const monitor = $("karaokeLiveLyrics");
    if (monitor) {
      monitor.className = `karaoke-live-lyrics ${theme}`;
    }
  }
  applyKaraokeTheme();

  // 3. Configurar Reproductor de Karaoke
  const karaokePlayer = $("karaokeTrack") || $("trackPlayer");
  if (karaokePlayer) {
    
    karaokePlayer.addEventListener("timeupdate", () => {
      // Sincronizar el teleprompter de letras llamando la función global
      if (typeof window.syncKaraokeMonitor === "function") {
        window.syncKaraokeMonitor(karaokePlayer.currentTime);
      }

      // 🔒 PROTECCIÓN ANTES DE LLAMAR A drawKaraokeMonitor
      const canvas = $("karaokeCanvas");
      if (!canvas) return; // Si no hay canvas, salimos sin hacer nada

      // 🛠️ Dibujar Canvas solo si NO estamos grabando. 
      // (Si estamos grabando, el requestAnimationFrame se encarga de dibujar para no duplicar el trabajo).
      if (typeof window.drawKaraokeMonitor === "function" && !state.isRecording) {
        window.drawKaraokeMonitor(karaokePlayer.currentTime, -1, -1);
      }
    });

    karaokePlayer.addEventListener("ended", () => {
      // Reiniciar teleprompter a 0 cuando termine
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
    state.isRecording = true; // Notificamos al sistema que estamos grabando
    try {
      const { startKaraokeRecording } = await import("./modules/karaoke.js");
      if (typeof startKaraokeRecording === "function") {
        startKaraokeRecording();
      }
    } catch (err) {
      console.error("❌ Error iniciando grabación:", err);
      state.isRecording = false; // Restauramos estado si falla
    }
  });

  // Botón de Detener Grabación
  safeAdd("karaokeStopBtn", "click", async () => {
    state.isRecording = false; // Detenemos el estado de grabación
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

  // 4. Asignar Eventos de las Pestañas de Navegación
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabTarget = e.currentTarget.dataset.tabTarget;
      if (tabTarget) {
        switchTab(tabTarget);
      }
    });
  });
});
