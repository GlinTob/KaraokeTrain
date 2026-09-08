import { $ } from "./utils.js";

class Persona {
  constructor(nombre, avatar) {
    this.nombre = nombre;
    this.avatar = avatar;
  }

  getNombre() {
    if (!this.nombre) {
      throw new Error("Persona.getNombre(): nombre no puede ser nulo");
    }
    return this.nombre;
  }

  getAvatar() {
    return this.avatar;
  }
}
/**
 * MÓDULO CONFIGURACIÓN COMPLETO
 * Gestor de Preferencias Locales, Diagnóstico de Micrófonos y Selector de Avatares Pop
 */

// ====================================================================
// ESTADO INTERNO
// ====================================================================

// Estado por micrófono para evitar race conditions
const micTestState = {
  1: { audioContext: null, stream: null, analyser: null, animationId: null, timeoutId: null },
  2: { audioContext: null, stream: null, analyser: null, animationId: null, timeoutId: null }
};

let selectedAvatar = null;
let currentAvatarCategory = "videojuegos";
let activeAvatarUser = "P1";
let settingsInitialized = false;

const EMOJI_OPTIONS = [
  "⚛️", "🐱", "🤔", "😺", "🐶", "🦊", "🐻", "🐼", "🐰",
  "🕷️", "🦇", "🦸", "👸", "🤖", "💚", "🛡️", "⭐", "🔥",
  "💎", "🎵", "🎤", "👑", "🧠", "🎩", "🎼", "🎨", "📜",
  "🍄", "🦔", "⚔️", "👽", "🎈", "⚡", "🦍", "🌈", "🍀", "🔭"
];

// ====================================================================
// BASE DE DATOS DE AVATARES
// ====================================================================

const AVATAR_CATEGORIES = {
  superheroes: {
    name: "Superhéroes",
    icon: "⚡",
    color: "#FF6B6B",
    characters: [
      { id: "batman", name: "Batman: El caballero de la noche", img: "../assets/avatares/batman.png" },
      { id: "black-panther", name: "Black Panther: Wakanda por siempre", img: "../assets/avatares/black-panther.png" },
      { id: "captain-america", name: "Captain America: El primer vengador", img: "../assets/avatares/captain-america.png" },
      { id: "cyclops", name: "Cyclops: La batalla final", img: "../assets/avatares/cyclops.png" },
      { id: "deadpool", name: "Deadpool: Oscuro y perverso", img: "../assets/avatares/deadpool.png" },
      { id: "flash", name: "Flash: El tiempo es ilusión", img: "../assets/avatares/flash.png" },
      { id: "gambit", name: "Gambit: El encantador ladrón", img: "../assets/avatares/gambit.png" },
      { id: "hulk", name: "Hulk: Un peligroso alter ego", img: "../assets/avatares/hulk.png" },
      { id: "iron-man", name: "Iron Man: Corazon de acero", img: "../assets/avatares/iron-man.png" },
      { id: "jean-grey", name: "Jean Grey: Un mundo oscuro", img: "../assets/avatares/jean-grey.png" },
      { id: "spider-man", name: "Spider Man: Su agradable vecino", img: "../assets/avatares/spider-man.png" },
      { id: "storm", name: "Storm: La fuerza de la naturaleza", img: "../assets/avatares/storm.png" },
      { id: "superman", name: "Superman: Un alien legal en la tierra", img: "../assets/avatares/superman.png" },
      { id: "thor", name: "Thor: El martillo vencedor", img: "../assets/avatares/thor.png" },
      { id: "venom", name: "Venom: Hoy habrá carnicería", img: "../assets/avatares/venom.png" },
      { id: "wonder-woman", name: "Wonder Woman: Un cielo dividido", img: "../assets/avatares/wonder-woman.png" },
    ]
  },
  personajes: {
    name: "Personajes",
    icon: "👽",
    color: "#AB8CFF",
    characters: [
      { id: "anonymous", name: "Anonymous: Ya tengo tu información", img: "../assets/avatares/anonymous.png" },
      { id: "baby-yoda", name: "Baby Yoda: No quiero crecer", img: "../assets/avatares/baby-yoda.png" },
      { id: "bart-simpson", name: "Bart: La escuela es adiestramiento", img: "../assets/avatares/bart.png" },
      { id: "brave", name: "Brave: Me veo mejor rubia", img: "../assets/avatares/brave.png" },
      { id: "brutus", name: "Brutus: Yo no soy el enemigo", img: "../assets/avatares/brutus.png" },
      { id: "chucky", name: "Chucky: Recuerda nuestros momentos", img: "../assets/avatares/chucky.png" },
      { id: "cookie-monster", name: "C Monster: Ya me comí la tuya", img: "../assets/avatares/cookie-monster.png" },
      { id: "darth-vader", name: "Darth Vader: Yo soy tu padre", img: "../assets/avatares/darth-vader.png" },
      { id: "donald", name: "Donald: Me van a hacer sopa", img: "../assets/avatares/donald.png" },
      { id: "finn", name: "Finn: Estoy re malviajado", img: "../assets/avatares/finn.png" },
      { id: "freddy", name: "Freddy: Siestica o miedo", img: "../assets/avatares/freddy.png" },
      { id: "genie", name: "Genie: Aladín es severa flor", img: "../assets/avatares/genie.png" },
      { id: "groot", name: "Groot: Ya me creció la rama", img: "../assets/avatares/groot.png" },
      { id: "harry", name: "H.P: Me llaman la Ermión", img: "../assets/avatares/harry.png" },
      { id: "hello-kitty", name: "H. Kitty: Odio el rosa", img: "../assets/avatares/hello-kitty.png" },
      { id: "homer", name: "Homero: Debí parecer un idiota", img: "../assets/avatares/homer.png" },
      { id: "jake", name: "Jake: Necesito rehabilitación", img: "../assets/avatares/jake.png" },
      { id: "pennywise", name: "Pennywise: También flotarás", img: "../assets/avatares/pennywise.png" },
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
  syncAppThemeCard(safeTheme);
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

function syncAppThemeCard(theme) {
  document.querySelectorAll("#themeGrid .theme-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.themeId === theme);
    const check = card.querySelector(".theme-card-check");
    if (check) check.textContent = card.dataset.themeId === theme ? "✓ Activo" : "";
  });
}

export function renderAppThemeGrid() {
  const grid = $("themeGrid");
  if (!grid) return;

  // Solo renderizar una vez
  if (grid.dataset.rendered === "true") {
    syncAppThemeCard(localStorage.getItem("karaokeTrain_theme") || "oscuro");
    return;
  }

  const current = localStorage.getItem("karaokeTrain_theme") || "oscuro";

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
      localStorage.setItem("karaokeTrain_theme", theme.id);
      applyAppTheme(theme.id);
      showSaveNotification();
    });
    grid.appendChild(card);
  });
  grid.dataset.rendered = "true";
}

export function renderKaraokeThemeGrid() {
  const grid = $("karaokeThemeGrid");
  if (!grid) return;

  // Solo renderizar una vez
  if (grid.dataset.rendered === "true") {
    const current = localStorage.getItem("karaokeTrain_stage") || "theme-clasico";
    document.querySelectorAll("#karaokeThemeGrid .theme-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.themeId === current);
      const check = card.querySelector(".theme-card-check");
      if (check) check.textContent = card.dataset.themeId === current ? "✓ Activo" : "";
    });
    return;
  }

  const current = localStorage.getItem("karaokeTrain_stage") || "theme-clasico";

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
  grid.dataset.rendered = "true";
}

function selectKaraokeStage(stageId) {
  localStorage.setItem("karaokeTrain_stage", stageId);

  document.querySelectorAll("#karaokeThemeGrid .theme-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.themeId === stageId);
    const check = card.querySelector(".theme-card-check");
    if (check) check.textContent = card.dataset.themeId === stageId ? "✓ Activo" : "";
  });

  // Usar evento personalizado en lugar de buscar DOM frágil
  window.dispatchEvent(new CustomEvent("karaokeThemeChanged", { detail: { stageId } }));

  showSaveNotification();
}

export function inicializarEscenarioDesdeMemoria() {
  const contenedorKaraoke =
    document.getElementById("karaokeLiveLyrics") ||
    document.getElementById("karaokeLyrics") ||
    document.querySelector(".karaoke-lyrics");

  let temaGuardado = localStorage.getItem("karaokeTrain_stage") || "theme-clasico";
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

export async function initSettings() {
  if (settingsInitialized) return;  
  settingsInitialized = true;

  const sensInput = $("micSensitivity");
  if (sensInput) {
    sensInput.value = localStorage.getItem("karaokeTrain_sensitivity") || "0.015";
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("karaokeTrain_sensitivity", e.target.value);
    });
  }

  const settings = {
    micCount: "karaokeTrain_micCount",
    difficultyLevel: "karaokeTrain_difficulty",
    karaokeDifficultyLevel: "karaokeTrain_karaoke_difficulty"
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

  // FIX: Cargar micrófonos disponibles al inicializar
  await loadAvailableMics();

  renderAppThemeGrid();
  applyAppTheme(localStorage.getItem("karaokeTrain_theme") || "oscuro");
  loadSavedAvatar();
  inicializarEscenarioDesdeMemoria();
  initializeAvatarSelector();
  toggleMic2Visibility();
}

// ====================================================================
// AVATARES
// ====================================================================

function storageKeysForUser(user) {
  const prefix = user === "P2" ? "karaokeTrain_p2" : "karaokeTrain_p1";
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
      btn.className = "avatar-category-tab" + (key === "superheroes" ? " active" : "");
      btn.dataset.category = key;
      btn.innerHTML = `${category.icon} ${category.name}`;
      btn.onclick = () => switchAvatarCategory(user, key);
      tabsContainer.appendChild(btn);
    });

    populateEmojiSelects(user);
    renderAvatarGrid(user, "superheroes");
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

  const category = AVATAR_CATEGORIES[categoryKey] || AVATAR_CATEGORIES.superheroes;
  gridContainer.innerHTML = "";

  const saved = loadAvatarFromStorage(user);

  // Grid de avatares - tamaño mayor (100x100) y sin categoría escrita
  // Los tabs de categoría ya están en avatarCategoryTabs{P1/P2} - NO duplicar aquí
  category.characters.forEach((character) => {
    const card = document.createElement("div");
    const isSelected = saved && saved.id === character.id;
    card.className = "avatar-card" + (isSelected ? " selected" : "");
    card.dataset.avatarId = character.id;
    card.onclick = () => selectAvatar(user, { ...character, category: categoryKey });
    
    // Usar imagen si está disponible, sino emoji
    const avatarImg = character.img ? `<img src="${character.img}" alt="${character.name}" style="width:80px; height:80px; border-radius:8px; object-fit:contain; background:var(--bg-main);" />` : `<div style="width:80px; height:80px; background:var(--bg-main); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--text-color); font-size:2em;">${character.emoji}</div>`;
    
    card.innerHTML = `
      <div style="text-align:center; margin:4px 0;">
        ${avatarImg}
        <div style="font-size:0.75em; margin-top:4px; color:var(--text-color-soft);">${character.name}</div>
      </div>
    `;
    gridContainer.appendChild(card);
  });
}

export function selectAvatar(user, character) {
  if (!character || !character.id) return;

  const keys = storageKeysForUser(user);
  localStorage.setItem(keys.avatar, JSON.stringify(character));

  document.querySelectorAll('#avatarGrid' + user + ' .avatar-card').forEach((card) => {
    card.classList.toggle("selected", card.dataset.avatarId === character.id);
  });

  renderAvatarSelectedInfo(user);
  notifyAvatarChange(user);
}
/*
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
*/

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

  infoEl.innerHTML = `
    <div class="avatar-selected-title">${saved.name}</div>
    <div class="avatar-selected-sub">${label}</div>
  `;
  infoEl.classList.add("has-selection");
}

/*
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

  infoEl.innerHTML = `
    <div class="avatar-selected-title">${saved.emoji} ${saved.name}</div>
    <div class="avatar-selected-sub">${label}</div>
  `;
  infoEl.classList.add("has-selection");
}
*/

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
    if (!parsed || !parsed.id) return null;

    if (parsed.category && AVATAR_CATEGORIES[parsed.category]) {
      const char = AVATAR_CATEGORIES[parsed.category].characters.find((c) => c.id === parsed.id);
      if (char) return { ...char, category: parsed.category };
    }

    for (const [categoryKey, category] of Object.entries(AVATAR_CATEGORIES)) {
      const char = category.characters.find((c) => c.id === parsed.id);
      if (char) return { ...char, category: categoryKey };
    }

    return null;
  } catch (e) {
    return null;
  }
}

/*
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
*/

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

export function guardarUsuario() {
  const nombre = $("nombreUsuario").value;
  const avatar = selectedAvatar; // Asumiendo que ya se seleccionó uno
  const usuario = new Persona(nombre, avatar);
  
  localStorage.setItem("user_profile", JSON.stringify({
    nombre: usuario.getNombre(),
    avatar: usuario.getAvatar()
  }));
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

  try {
    // PRIMERO: Enumerar SIN pedir permiso (labels pueden estar vacíos sin permiso)
    let devices = await navigator.mediaDevices.enumerateDevices();
    let mics = devices.filter((d) => d.kind === "audioinput");
    
    // Si no hay labels, pedir permiso una vez y re-enumerar
    const needsPermission = mics.some(m => !m.label);
    if (needsPermission) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(t => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        mics = devices.filter((d) => d.kind === "audioinput");
      } catch (permErr) {
        console.warn("Permiso de micrófono denegado, labels no disponibles:", permErr);
        // Continuar con deviceIds aunque labels estén vacíos
      }
    }

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

    populateMicSelect(mic1Select, "karaokeTrain_mic1");
    populateMicSelect(mic2Select, "karaokeTrain_mic2");

    console.log("🎙️ Micrófonos detectados y sincronizados:", mics.length);
  } catch (error) {
    console.error("Error crítico al enumerar los micrófonos del sistema:", error);
    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");
    if (mic1Select) mic1Select.innerHTML = `<option value="">⚠️ Error al detectar micrófonos</option>`;
    if (mic2Select) mic2Select.innerHTML = `<option value="">⚠️ Error al detectar micrófonos</option>`;
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
  const storageKey = micNumber === 1 ? "karaokeTrain_mic1" : "karaokeTrain_mic2";
  const select = $(selectId);

  if (!select) return;

  localStorage.setItem(storageKey, select.value);
  showSaveNotification();
}

export async function testMicrophone(micNumber) {
  // 1. Detener prueba previa SOLO de este micrófono
  stopMicTest(micNumber);

  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const fillId = micNumber === 1 ? "mic1LevelFill" : "mic2LevelFill";
  const statusId = micNumber === 1 ? "mic1Status" : "mic2Status";
  
  const select = document.getElementById(selectId);
  const fill = document.getElementById(fillId);
  const status = document.getElementById(statusId);

  if (!select?.value) return alert("Selecciona un mic");

  try {
    const state = micTestState[micNumber];
    
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: select.value } }
    });

    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(state.stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256; // Tamaño pequeño = muy rápido
    source.connect(state.analyser);

    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    if (status) status.innerText = "🎤 Probando...";

    function draw() {
      if (!state.stream) return;
      state.animationId = requestAnimationFrame(draw);
      
      state.analyser.getByteFrequencyData(dataArray);
      
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
    state.timeoutId = setTimeout(() => stopMicTest(micNumber), 5000);

  } catch (err) {
    if (status) status.innerText = "❌ Error de mic";
    stopMicTest(micNumber);
  }
}

export function stopMicTest(micNumber) {
  const state = micNumber ? micTestState[micNumber] : null;
  
  if (state) {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    if (state.timeoutId) clearTimeout(state.timeoutId);
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
    if (state.audioContext && state.audioContext.state !== "closed") {
      state.audioContext.close().catch(() => {});
      state.audioContext = null;
    }
    state.analyser = null;
    state.animationId = null;
    state.timeoutId = null;
    
    // Reset UI solo para este micrófono
    const fill = document.getElementById(micNumber === 1 ? "mic1LevelFill" : "mic2LevelFill");
    const status = document.getElementById(micNumber === 1 ? "mic1Status" : "mic2Status");
    if (fill) fill.style.width = "0%";
    if (status) status.innerText = "Haz clic para probar";
  } else {
    // Stop all (cleanup al salir de config)
    [1, 2].forEach(n => stopMicTest(n));
  }
}

// Función de limpieza al salir de la pestaña Configuración
export function destroyConfig() {
  stopMicTest(); // Sin argumento = stop all
  settingsInitialized = false;
  // Reset flags de renderizado para permitir re-render si se vuelve a entrar
  const themeGrid = $("themeGrid");
  const karaokeGrid = $("karaokeThemeGrid");
  if (themeGrid) themeGrid.dataset.rendered = "false";
  if (karaokeGrid) karaokeGrid.dataset.rendered = "false";
}

export function initConfig() {
  if (settingsInitialized) return;
  settingsInitialized = true;
  renderAppThemeGrid(); // Solo renderizar una vez
  renderKaraokeThemeGrid(); // Solo renderizar una vez
}
