import { $ } from "../script.js";
import { getAudioController } from "./audio-controller.js";


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
let activeAvatarUser = "P1";
let settingsInitialized = false;

const EMOJI_OPTIONS = [
  "⚛️", "🐱", "🤔", "😺", "🐶", "🦊", "🐻", "🐼", "🐰",
  "🕷️", "🦇", "🦸", "👸", "🤖", "💚", "🛡️", "⭐", "🔥",
  "💎", "🎵", "🎤", "👑", "🧠", "🎩", "🎼", "🎨", "📜",
  "🍄", "🦔", "⚔️", "👽", "🎈", "⚡", "🦍", "🌈", "🍀"
];

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

const APP_THEMES = [
  { id: "oscuro", name: "Oscuro" },
  { id: "claro", name: "Claro" },
  { id: "neon", name: "Neón" }
];

const KARAOKE_STAGES = [
  { id: "theme-clasico", name: "Clásico", pv: { fondo: "#111827", linea: "#334155", texto: "#3b82f6" } },
  { id: "theme-moderno", name: "Moderno", pv: { fondo: "#082f49", linea: "rgba(6,182,212,0.25)", texto: "#06b6d4" } },
  { id: "theme-disco", name: "Disco", pv: { fondo: "#2e1065", linea: "rgba(219,39,119,0.3)", texto: "#facc15" } },
  { id: "theme-acustico", name: "Acústico", pv: { fondo: "#451a03", linea: "rgba(120,53,15,0.5)", texto: "#fcd34d" } },
  { id: "theme-fiesta", name: "Fiesta", pv: { fondo: "#3b1230", linea: "rgba(255,0,127,0.3)", texto: "#ff007f" } },
  { id: "theme-retrowave", name: "RetroWave", pv: { fondo: "#1a1155", linea: "rgba(255,45,149,0.35)", texto: "#00e5ff" } }
];

export function applyAppTheme(theme) {
  const safeTheme = theme || "oscuro";
  document.documentElement.setAttribute("data-theme", safeTheme);
  document.body?.setAttribute("data-theme", safeTheme);
  syncAppThemeCard(safeTheme);
  console.log("🎨 Tema aplicado de forma nativa:", safeTheme);
}

function syncAppThemeCard(theme) {
  document.querySelectorAll("#themeGrid .theme-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.themeId === theme);
  });
}

export function renderAppThemeGrid() {
  const grid = $("themeGrid");
  if (!grid) return;

  const current = localStorage.getItem("vocalApp_theme") || "oscuro";

  grid.innerHTML = "";
  APP_THEMES.forEach((theme) => {
    const card = document.createElement("div");
    card.className = "theme-card" + (current === theme.id ? " active" : "");
    card.dataset.themeId = theme.id;
    card.innerHTML = `
      <div class="theme-preview ${theme.id}">
        <div class="pv-sidebar">
          <div class="pv-bar"></div>
          <div class="pv-bar"></div>
          <div class="pv-bar"></div>
          <div class="pv-bar"></div>
        </div>
        <div class="pv-content">
          <div class="pv-line"></div>
          <div class="pv-line short"></div>
          <div class="pv-block"></div>
        </div>
      </div>
      <div class="theme-card-name">${theme.name}</div>
      <span class="theme-card-check">${current === theme.id ? "✓ Activo" : ""}</span>
    `;
    card.addEventListener("click", () => {
      localStorage.setItem("vocalApp_theme", theme.id);
      applyAppTheme(theme.id);
      showSaveNotification();
    });
    grid.appendChild(card);
  });
}

export function renderKaraokeThemeGrid() {
  const grid = $("karaokeThemeGrid");
  if (!grid) return;

  const current = localStorage.getItem("vocalApp_stage") || "theme-clasico";

  grid.innerHTML = "";
  KARAOKE_STAGES.forEach((stage) => {
    const card = document.createElement("div");
    card.className = "theme-card" + (current === stage.id ? " active" : "");
    card.dataset.themeId = stage.id;
    card.innerHTML = `
      <div class="theme-preview stage" style="background: ${stage.pv.fondo};">
        <div class="pv-lyric" style="color: ${stage.pv.texto}; background: ${stage.pv.linea};">♫ La canción ♫</div>
        <div class="pv-line-row" style="background: ${stage.pv.texto};"></div>
      </div>
      <div class="theme-card-name">${stage.name}</div>
      <span class="theme-card-check">${current === stage.id ? "✓ Activo" : ""}</span>
    `;
    card.addEventListener("click", () => selectKaraokeStage(stage.id));
    grid.appendChild(card);
  });
}

function selectKaraokeStage(stageId) {
  localStorage.setItem("vocalApp_stage", stageId);

  document.querySelectorAll("#karaokeThemeGrid .theme-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.themeId === stageId);
    const check = card.querySelector(".theme-card-check");
    if (check) check.textContent = card.dataset.themeId === stageId ? "✓ Activo" : "";
  });

  const contenedorKaraoke =
    document.getElementById("karaokeLiveLyrics") ||
    document.getElementById("karaokeLyrics") ||
    document.querySelector(".karaoke-lyrics");

  if (contenedorKaraoke) {
    KARAOKE_STAGES.forEach((t) => contenedorKaraoke.classList.remove(t.id));
    contenedorKaraoke.classList.add(stageId);
  }

  showSaveNotification();
}

export function inicializarEscenarioDesdeMemoria() {
  const contenedorKaraoke =
    document.getElementById("karaokeLiveLyrics") ||
    document.getElementById("karaokeLyrics") ||
    document.querySelector(".karaoke-lyrics");

  let temaGuardado = localStorage.getItem("vocalApp_stage") || "theme-clasico";
  if (temaGuardado === "undefined" || !temaGuardado) temaGuardado = "theme-clasico";

  renderKaraokeThemeGrid();

  if (contenedorKaraoke) {
    KARAOKE_STAGES.forEach((tema) => contenedorKaraoke.classList.remove(tema.id));
    contenedorKaraoke.classList.add(temaGuardado);
  }
}

// ====================================================================
// INIT GENERAL
// ====================================================================

export function initSettings() {
  if (settingsInitialized) return;  
  settingsInitialized = true;

  const sensInput = $("micSensitivity");
  if (sensInput) {
    sensInput.value = localStorage.getItem("vocalApp_sensitivity") || "0.015";
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("vocalApp_sensitivity", e.target.value);
    });
  }

  const settings = {
    micCount: "vocalApp_micCount",
    difficultyLevel: "vocalApp_difficulty",
    karaokeDifficultyLevel: "vocalApp_karaoke_difficulty"
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

      if (id === "micCount") {
        toggleMic2Visibility();
      }
    });
  });

  const mic1Select = $("mic1Select");
  if (mic1Select) {
    mic1Select.addEventListener("change", () => saveMicSelection(1));
  }
  const mic2Select = $("mic2Select");
  if (mic2Select) {
    mic2Select.addEventListener("change", () => saveMicSelection(2));
  }

  renderAppThemeGrid();
  applyAppTheme(localStorage.getItem("vocalApp_theme") || "oscuro");
  loadSavedAvatar();
  inicializarEscenarioDesdeMemoria();
  initializeAvatarSelector();
  toggleMic2Visibility();
}

// ====================================================================
// AVATARES
// ====================================================================

function storageKeysForUser(user) {
  const prefix = user === "P2" ? "vocalApp_p2" : "vocalApp_p1";
  return {
    avatar: prefix + "_avatar",
    emoji1: prefix + "_emoji1",
    emoji2: prefix + "_emoji2"
  };
}

function getUserPrefix(user) {
  return user === "P2" ? "P2" : "P1";
}

export function initializeAvatarSelector() {
  initializeAvatarUserTabs();

  ["P1", "P2"].forEach((user) => {
    const tabsContainer = $("avatarCategoryTabs" + user);
    if (tabsContainer) tabsContainer.innerHTML = "";

    Object.entries(AVATAR_CATEGORIES).forEach(([key, category]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-category-tab" + (key === "videojuegos" ? " active" : "");
      btn.dataset.category = key;
      btn.innerHTML = `${category.icon} ${category.name}`;
      btn.onclick = () => switchAvatarCategory(user, key);
      tabsContainer.appendChild(btn);
    });

    populateEmojiSelects(user);
    renderAvatarGrid(user, "videojuegos");
    loadSavedAvatar(user);
    renderAvatarSelectedInfo(user);
  });
}

function initializeAvatarUserTabs() {
  const tabs = document.querySelectorAll(".avatar-user-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const user = tab.dataset.avatarUser || "P1";
      activeAvatarUser = user;
      const panel = $("avatarUserPanel" + user);
      document.querySelectorAll(".avatar-user-panel").forEach((p) => (p.style.display = "none"));
      document.querySelectorAll(".avatar-user-tab").forEach((t) => t.classList.remove("active"));
      if (panel) panel.style.display = "block";
      tab.classList.add("active");
    });
  });
}

function populateEmojiSelects(user) {
  const keys = storageKeysForUser(user);
  [[keys.emoji1, "avatarEmoji1" + user], [keys.emoji2, "avatarEmoji2" + user]].forEach(([storageKey, selectId]) => {
    const select = $(selectId);
    if (!select) return;
    select.innerHTML = "";
    EMOJI_OPTIONS.forEach((emoji) => {
      const option = document.createElement("option");
      option.value = emoji;
      option.textContent = emoji;
      select.appendChild(option);
    });
    const saved = localStorage.getItem(storageKey);
    if (saved && EMOJI_OPTIONS.includes(saved)) {
      select.value = saved;
    }
    select.addEventListener("change", () => {
      localStorage.setItem(storageKey, select.value);
      notifyAvatarChange(user);
    });
  });
}

export function switchAvatarCategory(user, categoryKey) {
  if (!AVATAR_CATEGORIES[categoryKey]) return;
  const tabs = document.querySelectorAll('#avatarCategoryTabs' + user + ' .avatar-category-tab');
  tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.category === categoryKey));
  renderAvatarGrid(user, categoryKey);
}

export function renderAvatarGrid(user, categoryKey) {
  const gridContainer = $("avatarGrid" + user);
  if (!gridContainer) return;

  const category = AVATAR_CATEGORIES[categoryKey] || AVATAR_CATEGORIES.videojuegos;
  gridContainer.innerHTML = "";

  const saved = loadAvatarFromStorage(user);

  category.characters.forEach((character) => {
    const card = document.createElement("div");
    const isSelected = saved && saved.id === character.id;
    card.className = "avatar-card" + (isSelected ? " selected" : "");
    card.dataset.avatarId = character.id;
    card.onclick = () => selectAvatar(user, character);
    card.innerHTML = `
      <div class="avatar-card-emoji">${character.emoji}</div>
      <div class="avatar-card-name">${character.name}</div>
      <div class="avatar-card-category">${category.icon} ${category.name}</div>
    `;
    gridContainer.appendChild(card);
  });
}

export function selectAvatar(user, character) {
  if (!character || !character.id || !character.category) return;

  const keys = storageKeysForUser(user);
  localStorage.setItem(keys.avatar, JSON.stringify(character));

  document.querySelectorAll('#avatarGrid' + user + ' .avatar-card').forEach((card) => {
    card.classList.toggle("selected", card.dataset.avatarId === character.id);
  });

  renderAvatarSelectedInfo(user);
  notifyAvatarChange(user);
}

function renderAvatarSelectedInfo(user) {
  const infoEl = $("avatarSelectedInfo" + user);
  if (!infoEl) return;

  const saved = loadAvatarFromStorage(user);
  const label = user === "P2" ? "Usuario 2" : "Usuario 1";
  if (!saved) {
    infoEl.innerHTML = `${label}: ningún avatar seleccionado (se usará avatar por defecto)`;
    infoEl.classList.remove("has-selection");
    return;
  }

  const avatarCategory = AVATAR_CATEGORIES[saved.category];
  infoEl.innerHTML = `
    <div class="avatar-selected-title">${saved.emoji} ${saved.name}</div>
    <div class="avatar-selected-sub">${label} · ${avatarCategory ? avatarCategory.icon + " " + avatarCategory.name : ""}</div>
  `;
  infoEl.classList.add("has-selection");
}

export function loadSavedAvatar(user = "P1") {
  const saved = loadAvatarFromStorage(user);
  if (!saved) {
    renderAvatarSelectedInfo(user);
    return;
  }
  renderAvatarSelectedInfo(user);
}

function loadAvatarFromStorage(user) {
  try {
    const keys = storageKeysForUser(user);
    const saved = localStorage.getItem(keys.avatar);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!parsed || !parsed.id || !parsed.category) return null;
    for (const [, category] of Object.entries(AVATAR_CATEGORIES)) {
      const char = category.characters.find((c) => c.id === parsed.id);
      if (char) return char;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function notifyAvatarChange(user) {
  const avatar = loadAvatarFromStorage(user);
  const keys = storageKeysForUser(user);
  const emoji1 = localStorage.getItem(keys.emoji1) || "";
  const emoji2 = localStorage.getItem(keys.emoji2) || "";
  window.dispatchEvent(new CustomEvent("avatarChanged", {
    detail: {
      user,
      avatar,
      emoji1,
      emoji2
    }
  }));
}

window.getAvatarForUser = function (user) {
  const avatar = loadAvatarFromStorage(user);
  const keys = storageKeysForUser(user);
  return {
    avatar: avatar || null,
    name: avatar ? avatar.name : null,
    emoji: avatar ? avatar.emoji : null,
    emoji1: localStorage.getItem(keys.emoji1) || "",
    emoji2: localStorage.getItem(keys.emoji2) || ""
  };
};

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
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

    populateMicSelect(mic1Select, "vocalApp_mic1");
    populateMicSelect(mic2Select, "vocalApp_mic2");

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
  const storageKey = micNumber === 1 ? "vocalApp_mic1" : "vocalApp_mic2";
  const select = $(selectId);

  if (!select) return;

  localStorage.setItem(storageKey, select.value);
  showSaveNotification();
}

export async function testMicrophone(micNumber) {
  // 1. Detener cualquier prueba previa
  stopMicTest();

  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const fillId = micNumber === 1 ? "mic1LevelFill" : "mic2LevelFill";
  const statusId = micNumber === 1 ? "mic1Status" : "mic2Status";
  
  const select = document.getElementById(selectId);
  const fill = document.getElementById(fillId);
  const status = document.getElementById(statusId);

  if (!select?.value) return alert("Selecciona un mic");

  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: select.value } }
    });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(micTestStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256; // Tamaño pequeño = muy rápido
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    if (status) status.innerText = "🎤 Probando...";

    function draw() {
      if (!micTestStream) return;
      micTestAnimationId = requestAnimationFrame(draw);
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calcular volumen promedio
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const volume = Math.min(100, (average / 128) * 100);

      if (fill) fill.style.width = volume + "%";
    }

    draw();

    // Auto-apagado en 5 segundos para no gastar batería
    setTimeout(stopMicTest, 5000);

  } catch (err) {
    if (status) status.innerText = "❌ Error de mic";
  }
}

export function stopMicTest() {
  if (micTestAnimationId) cancelAnimationFrame(micTestAnimationId);
  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
  }
  document.querySelectorAll(".mic-level-fill").forEach(f => f.style.width = "0%");
  document.querySelectorAll(".mic-status").forEach(s => s.innerText = "Haz clic para probar");
}
