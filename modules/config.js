import { $ } from "../script.js";

/**
 * MÓDULO CONFIGURACIÓN COMPLETO
 * Gestor de Preferencias Locales, Diagnóstico de Micrófonos y Selector de Avatares Pop
 */

// ====================================================================
// ESTADO INTERNO
// ====================================================================

let micTestAudioContext = null;
let micTestStream = null;
let micTestAnalyser = null;
let micTestAnimationId = null;
let micTestTimeoutId = null;

let selectedAvatar = null;
let currentAvatarCategory = "videojuegos";
let settingsInitialized = false;

// ====================================================================
// BASE DE DATOS DE AVATARES
// ====================================================================

const AVATAR_CATEGORIES = {
  videojuegos: {
    name: "🎮 Videojuegos (90s)",
    icon: "🎮",
    characters: [
      { id: "mario", name: "Mario", emoji: "🍄", img: "https://via.placeholder.com/80x80/FF0000/FFFFFF?text=MARIO", category: "videojuegos" },
      { id: "sonic", name: "Sonic", emoji: "🦔", img: "https://via.placeholder.com/80x80/00AA00/FFFFFF?text=SONIC", category: "videojuegos" },
      { id: "link", name: "Link", emoji: "⚔️", img: "https://via.placeholder.com/80x80/00FFFF/FFFFFF?text=LINK", category: "videojuegos" },
      { id: "samus", name: "Samus", emoji: "👽", img: "https://via.placeholder.com/80x80/FFA500/FFFFFF?text=SAMUS", category: "videojuegos" },
      { id: "kirby", name: "Kirby", emoji: "🎈", img: "https://via.placeholder.com/80x80/FF69B4/FFFFFF?text=KIRBY", category: "videojuegos" },
      { id: "megaman", name: "Mega Man", emoji: "🤖", img: "https://via.placeholder.com/80x80/00BFFF/FFFFFF?text=MEGAMAN", category: "videojuegos" },
      { id: "pikachu", name: "Pikachu", emoji: "⚡", img: "https://via.placeholder.com/80x80/FFFF00/000000?text=PIKA", category: "videojuegos" },
      { id: "donkeykong", name: "Donkey Kong", emoji: "🦍", img: "https://via.placeholder.com/80x80/8B4513/FFFFFF?text=DK", category: "videojuegos" }
    ]
  },
  animales: {
    name: "🐾 Animales (Estilo Pop)",
    icon: "🐾",
    characters: [
      { id: "cat", name: "Gato Pop", emoji: "😺", img: "https://via.placeholder.com/80x80/FF69B4/FFFFFF?text=CAT", category: "animales" },
      { id: "dog", name: "Perro Pop", emoji: "🐶", img: "https://via.placeholder.com/80x80/87CEEB/FFFFFF?text=DOG", category: "animales" },
      { id: "fox", name: "Zorro Pop", emoji: "🦊", img: "https://via.placeholder.com/80x80/FFA500/FFFFFF?text=FOX", category: "animales" },
      { id: "bear", name: "Oso Pop", emoji: "🐻", img: "https://via.placeholder.com/80x80/8B4513/FFFFFF?text=BEAR", category: "animales" },
      { id: "panda", name: "Panda Pop", emoji: "🐼", img: "https://via.placeholder.com/80x80/FFFFFF/000000?text=PANDA", category: "animales" },
      { id: "bunny", name: "Conejo Pop", emoji: "🐰", img: "https://via.placeholder.com/80x80/FFB6C1/000000?text=BUNNY", category: "animales" },
      { id: "wolf", name: "Lobo Pop", emoji: "🐺", img: "https://via.placeholder.com/80x80/808080/FFFFFF?text=WOLF", category: "animales" },
      { id: "cat2", name: "Gato Pop 2", emoji: "😸", img: "https://via.placeholder.com/80x80/FF69B4/FFFFFF?text=CAT2", category: "animales" }
    ]
  },
  superheroes: {
    name: "🦸 Superhéroes",
    icon: "🦸",
    characters: [
      { id: "spiderman", name: "Spider-Man", emoji: "🕷️", img: "https://via.placeholder.com/80x80/FF0000/FFFFFF?text=SPIDEY", category: "superheroes" },
      { id: "batman", name: "Batman", emoji: "🦇", img: "https://via.placeholder.com/80x80/000000/FFFF00?text=BAT", category: "superheroes" },
      { id: "superman", name: "Superman", emoji: "🦸", img: "https://via.placeholder.com/80x80/0000FF/FFD700?text=SUPER", category: "superheroes" },
      { id: "wonderwoman", name: "Mujer Maravilla", emoji: "👸", img: "https://via.placeholder.com/80x80/FFD700/FF0000?text=WW", category: "superheroes" },
      { id: "ironman", name: "Iron Man", emoji: "🤖", img: "https://via.placeholder.com/80x80/FF0000/FFD700?text=IRON", category: "superheroes" },
      { id: "hulk", name: "Hulk", emoji: "💚", img: "https://via.placeholder.com/80x80/00FF00/FFFFFF?text=HULK", category: "superheroes" },
      { id: "thor", name: "Thor", emoji: "⚡", img: "https://via.placeholder.com/80x80/FFD700/000000?text=THOR", category: "superheroes" },
      { id: "captain", name: "Capitán América", emoji: "🛡️", img: "https://via.placeholder.com/80x80/0000FF/FFFFFF?text=CAP", category: "superheroes" }
    ]
  },
  historicos: {
    name: "🏛️ Personajes Históricos",
    icon: "🏛️",
    characters: [
      { id: "cleopatra", name: "Cleopatra", emoji: "👑", img: "https://via.placeholder.com/80x80/FFD700/000000?text=CLEO", category: "historicos" },
      { id: "einstein", name: "Einstein", emoji: "🧠", img: "https://via.placeholder.com/80x80/FFFFFF/000000?text=EIN", category: "historicos" },
      { id: "napoleon", name: "Napoleón", emoji: "🎩", img: "https://via.placeholder.com/80x80/000080/FFFFFF?text=NAP", category: "historicos" },
      { id: "mozart", name: "Mozart", emoji: "🎼", img: "https://via.placeholder.com/80x80/8B0000/FFFFFF?text=MOZ", category: "historicos" },
      { id: "daVinci", name: "Da Vinci", emoji: "🎨", img: "https://via.placeholder.com/80x80/8B4513/FFFFFF?text=LEO", category: "historicos" },
      { id: "shakespeare", name: "Shakespeare", emoji: "📜", img: "https://via.placeholder.com/80x80/800000/FFFFFF?text=SHAKE", category: "historicos" },
      { id: "curie", name: "Marie Curie", emoji: "⚛️", img: "https://via.placeholder.com/80x80/FFFFFF/800080?text=CURIE", category: "historicos" },
      { id: "galileo", name: "Galileo", emoji: "🔭", img: "https://via.placeholder.com/80x80/000080/FFD700?text=GAL", category: "historicos" }
    ]
  }
};

// ====================================================================
// UTILIDADES
// ====================================================================

export function showSaveNotification() {
  const notif = $("saveNotification");
  if (notif) {
    notif.classList.add("show");
    setTimeout(() => {
      notif.classList.remove("show");
    }, 2000);
  } else {
    console.log("⚡ Configuración sincronizada y guardada en LocalStorage.");
  }
}

export function applyAppTheme(theme) {
  const safeTheme = theme || "oscuro";
  document.documentElement.setAttribute("data-theme", safeTheme);
  document.body?.setAttribute("data-theme", safeTheme);
  console.log("🎨 Tema aplicado de forma nativa:", safeTheme);
}

export function saveSetting(key, element) {
  if (!element) return;
  localStorage.setItem(key, element.value);
  showSaveNotification();
}

// ====================================================================
// ESCENARIO / TEMAS
// ====================================================================

export function inicializarEscenarioDesdeMemoria() {
  const select = document.getElementById("karaokeThemeSelect");
  const contenedorKaraoke =
    document.getElementById("karaokeLiveLyrics") ||
    document.getElementById("karaokeLyrics") ||
    document.querySelector(".karaoke-lyrics");

  if (!select || !contenedorKaraoke) return;

  let temaGuardado = localStorage.getItem("vocalApp_stage") || "theme-clasico";
  if (temaGuardado === "undefined" || !temaGuardado) temaGuardado = "theme-clasico";

  select.value = temaGuardado;

  const todosLosTemas = [
    "theme-clasico",
    "theme-moderno",
    "theme-disco",
    "theme-acustico",
    "theme-fiesta",
    "theme-retrowave"
  ];

  todosLosTemas.forEach((tema) => contenedorKaraoke.classList.remove(tema));
  contenedorKaraoke.classList.add(temaGuardado);
}

// ====================================================================
// INIT GENERAL
// ====================================================================

export function initSettings() {
  if (settingsInitialized) {
    console.warn("⚠️ initSettings() ya fue ejecutado. Se evita doble inicialización.");
    return;
  }
  settingsInitialized = true;

  const sensInput = $("micSensitivity");
  if (sensInput) {
    sensInput.value = localStorage.getItem("singIt_sensitivity") || "0.015";
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("singIt_sensitivity", e.target.value);
    });
  }

  const settings = {
    micCount: "vocalApp_micCount",
    karaokeThemeSelect: "vocalApp_stage",
    difficultyLevel: "vocalApp_difficulty",
    karaokeDifficultyLevel: "vocalApp_karaoke_difficulty",
    appTheme: "vocalApp_theme"
  };

  Object.entries(settings).forEach(([id, storageKey]) => {
    const el = $(id);
    if (!el) return;

    const saved = localStorage.getItem(storageKey);
    if (saved !== null) el.value = saved;

    el.addEventListener("change", (e) => {
      const value = e.target.value;
      localStorage.setItem(storageKey, value);
      showSaveNotification();

      if (id === "appTheme") {
        applyAppTheme(value);
      }

      if (id === "karaokeThemeSelect") {
        const contenedorKaraoke =
          document.getElementById("karaokeLiveLyrics") ||
          document.getElementById("karaokeLyrics") ||
          document.querySelector(".karaoke-lyrics");

        if (contenedorKaraoke) {
          const todosLosTemas = [
            "theme-clasico",
            "theme-moderno",
            "theme-disco",
            "theme-acustico",
            "theme-fiesta",
            "theme-retrowave"
          ];
          todosLosTemas.forEach((tema) => contenedorKaraoke.classList.remove(tema));
          contenedorKaraoke.classList.add(value);
        }
      }

      if (id === "micCount") {
        toggleMic2Visibility();
      }
    });
  });

  applyAppTheme(localStorage.getItem("vocalApp_theme") || "oscuro");
  loadSavedAvatar();
  inicializarEscenarioDesdeMemoria();
  initializeAvatarSelector();
  toggleMic2Visibility();
}

// ====================================================================
// AVATARES
// ====================================================================

export function initializeAvatarSelector() {
  const tabsContainer = $("avatarCategoryTabs");
  const gridContainer = $("avatarGrid");

  if (!tabsContainer || !gridContainer) {
    console.warn("Componentes del selector de avatares no encontrados en el DOM");
    return;
  }

  tabsContainer.innerHTML = "";

  Object.entries(AVATAR_CATEGORIES).forEach(([key, category]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-category-tab" + (key === currentAvatarCategory ? " active" : "");
    btn.dataset.category = key;
    btn.innerHTML = `${category.icon} ${category.name}`;
    btn.onclick = () => switchAvatarCategory(key);
    tabsContainer.appendChild(btn);
  });

  renderAvatarGrid();

  if (selectedAvatar) {
    const infoEl = $("avatarSelectedInfo");
    const avatarCategory = AVATAR_CATEGORIES[selectedAvatar.category];
    if (infoEl && avatarCategory) {
      infoEl.innerHTML = `
        <div class="avatar-selected-title">${selectedAvatar.emoji} ${selectedAvatar.name}</div>
        <div class="avatar-selected-sub">${avatarCategory.icon} ${avatarCategory.name}</div>
      `;
      infoEl.classList.add("has-selection");
    }
  }
}

export function switchAvatarCategory(categoryKey) {
  if (!AVATAR_CATEGORIES[categoryKey]) return;

  currentAvatarCategory = categoryKey;
  document.querySelectorAll(".avatar-category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === categoryKey);
  });
  renderAvatarGrid();
}

export function renderAvatarGrid() {
  const gridContainer = $("avatarGrid");
  if (!gridContainer) return;

  const category = AVATAR_CATEGORIES[currentAvatarCategory];
  if (!category) return;

  gridContainer.innerHTML = "";

  category.characters.forEach((character) => {
    const card = document.createElement("div");
    const isSelected = selectedAvatar && selectedAvatar.id === character.id;
    card.className = "avatar-card" + (isSelected ? " selected" : "");
    card.dataset.avatarId = character.id;
    card.onclick = () => selectAvatar(character);
    card.innerHTML = `
      <div class="avatar-card-emoji">${character.emoji}</div>
      <div class="avatar-card-name">${character.name}</div>
      <div class="avatar-card-category">${category.icon} ${category.name}</div>
    `;
    gridContainer.appendChild(card);
  });
}

export function selectAvatar(character) {
  if (!character || !character.id || !character.category) return;

  const avatarCategory = AVATAR_CATEGORIES[character.category];
  if (!avatarCategory) {
    console.warn("Categoría de avatar no válida:", character);
    return;
  }

  selectedAvatar = character;

  document.querySelectorAll(".avatar-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.avatarId === character.id);
  });

  const infoEl = $("avatarSelectedInfo");
  if (infoEl) {
    infoEl.innerHTML = `
      <div class="avatar-selected-title">${character.emoji} ${character.name}</div>
      <div class="avatar-selected-sub">${avatarCategory.icon} ${avatarCategory.name}</div>
    `;
    infoEl.classList.add("has-selection");
  }

  localStorage.setItem("vocalApp_selectedAvatar", JSON.stringify(character));

  // ✅ Llamar a updateMonitorConfig directamente
  if (typeof updateMonitorConfig === "function") {
    updateMonitorConfig({
      c1AvatarUrl: character.img,
      c2AvatarUrl: character.img
    });
  } else {
    console.warn("⚠️ updateMonitorConfig no está definida. Asegúrate de importarla desde karaoke.js.");
  }

  window.dispatchEvent(new CustomEvent("avatarChanged", { detail: character }));
}

export function loadSavedAvatar() {
  try {
    const saved = localStorage.getItem("vocalApp_selectedAvatar");
    if (!saved) return;

    const parsed = JSON.parse(saved);
    if (!parsed || !parsed.id || !parsed.category) {
      localStorage.removeItem("vocalApp_selectedAvatar");
      return;
    }

    let found = false;
    for (const [key, category] of Object.entries(AVATAR_CATEGORIES)) {
      const char = category.characters.find((c) => c.id === parsed.id);
      if (char) {
        selectedAvatar = char;
        currentAvatarCategory = key;
        found = true;
        break;
      }
    }

    if (!found) {
      localStorage.removeItem("vocalApp_selectedAvatar");
      selectedAvatar = null;
    }
  } catch (e) {
    console.warn("No se pudo cargar avatar guardado:", e);
    localStorage.removeItem("vocalApp_selectedAvatar");
    selectedAvatar = null;
  }
}

// ====================================================================
// MICRÓFONOS
// ====================================================================

export async function loadAvailableMics() {
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
    console.error("El navegador no soporta mediaDevices.");
    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");
    if (mic1Select) mic1Select.innerHTML = `<option value="">⚠️ Navegador no compatible</option>`;
    if (mic2Select) mic2Select.innerHTML = `<option value="">⚠️ Navegador no compatible</option>`;
    return;
  }

  let tempStream = null;

  try {
    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");

    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");

    const populateMicSelect = (selectEl, storageKey) => {
      if (!selectEl) return;

      selectEl.innerHTML = "";

      if (mics.length === 0) {
        selectEl.innerHTML = `<option value="">No se detectaron micrófonos</option>`;
        return;
      }

      mics.forEach((mic, index) => {
        const option = document.createElement("option");
        option.value = mic.deviceId;
        option.textContent = mic.label || `Micrófono ${index + 1}`;
        selectEl.appendChild(option);
      });

      const savedMic = localStorage.getItem(storageKey);
      if (savedMic && mics.some((mic) => mic.deviceId === savedMic)) {
        selectEl.value = savedMic;
      }
    };

    populateMicSelect(mic1Select, "singIt_mic1");
    populateMicSelect(mic2Select, "singIt_mic2");

    console.log("🎙️ Micrófonos detectados y sincronizados:", mics.length);
  } catch (error) {
    console.error("Error crítico al enumerar los micrófonos del sistema:", error);
    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");
    if (mic1Select) mic1Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
    if (mic2Select) mic2Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
  } finally {
    if (tempStream) {
      tempStream.getTracks().forEach((track) => track.stop());
    }
  }
}

export function toggleMic2Visibility() {
  const micCount = $("micCount");
  const mic2Group = $("mic2Group");
  if (!micCount || !mic2Group) return;

  mic2Group.style.display = micCount.value === "2" ? "block" : "none";
}

export function getSelectedMicId(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const select = $(selectId);
  return select ? select.value : null;
}

export function saveMicSelection(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const storageKey = micNumber === 1 ? "singIt_mic1" : "singIt_mic2";
  const select = $(selectId);

  if (!select) return;

  localStorage.setItem(storageKey, select.value);
  showSaveNotification();
}

export function stopMicTest() {
  if (micTestAnimationId) {
    cancelAnimationFrame(micTestAnimationId);
    micTestAnimationId = null;
  }

  if (micTestTimeoutId) {
    clearTimeout(micTestTimeoutId);
    micTestTimeoutId = null;
  }

  if (micTestStream) {
    micTestStream.getTracks().forEach((track) => track.stop());
    micTestStream = null;
  }

  if (micTestAudioContext) {
    micTestAudioContext.close().catch(() => {});
    micTestAudioContext = null;
  }

  micTestAnalyser = null;

  document.querySelectorAll(".mic-level-fill").forEach((fill) => {
    fill.style.width = "0%";
    fill.classList.remove("active");
  });
}

export async function testMicrophone(micNumber) {
  stopMicTest();

  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const levelId = micNumber === 1 ? "mic1Level" : "mic2Level";
  const select = $(selectId);
  const levelBar = $(levelId);

  if (!select || !levelBar) return;

  const deviceId = select.value;
  if (!deviceId) {
    alert("⚠️ Selecciona un micrófono primero");
    return;
  }

  try {
    const constraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);
    micTestAudioContext = new (window.AudioContext || window.webkitAudioContext)();

    const source = micTestAudioContext.createMediaStreamSource(micTestStream);
    micTestAnalyser = micTestAudioContext.createAnalyser();
    micTestAnalyser.fftSize = 2048;
    source.connect(micTestAnalyser);

    const levelFill = levelBar.querySelector(".mic-level-fill");
    if (levelFill) {
      levelFill.classList.add("active");
    }

    function updateLevel() {
      if (!micTestAnalyser) return;

      const dataArray = new Uint8Array(micTestAnalyser.frequencyBinCount);
      micTestAnalyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const percentage = Math.min(100, (average / 128) * 100);

      if (levelFill) {
        levelFill.style.width = `${percentage}%`;
      }

      micTestAnimationId = requestAnimationFrame(updateLevel);
    }

    updateLevel();

    micTestTimeoutId = setTimeout(() => {
      stopMicTest();
    }, 5000);
  } catch (error) {
    console.error("Error al probar hardware de micrófono:", error);
    alert("❌ No se pudo acceder al micrófono seleccionado. Verifica los permisos.");
  }
}
// Agrega esto en script.js
window.updateMonitorAvatar = function (avatar) {
  if (!avatar) return;

  // Actualizar las URLs de los avatares en el monitor
  if (typeof window.updateMonitorConfig === 'function') {
    window.updateMonitorConfig({
      c1AvatarUrl: avatar.img, // Este avatar se usará para C1
      c2AvatarUrl: avatar.img  // Este avatar se usará para C2 (puedes cambiarlo si quieres avatares distintos)
    });
  }

  console.log("✅ Avatar del monitor actualizado:", avatar.name);
};
