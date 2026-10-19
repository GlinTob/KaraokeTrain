import { $ } from "./utils.js"; 

/** 
 * MÓDULO BIBLIOTECA — Gestor de Almacenamiento Remoto, Sincronización Supabase y Cargas R2
 */

let db = null;

// Buscador de biblioteca: texto actual y carpeta activa para re-render.
let librarySearchText = "";
let libraryCurrentFilter = "todos";
let librarySearchTimer = null;
// Turno de render: si dos renderLibrary se solapan (tecleo rápido + red
// lenta), el viejo se descarta y no duplica la lista.
let libraryRenderSeq = 0;

// Normaliza para buscar sin importar mayúsculas ni tildes.
function normalizarBusqueda(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Escapa texto para interpolar en innerHTML (nombres de archivo vienen del
// usuario o de la nube y podrían inyectar HTML/JS).
export function escapeHTML(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
} 

export function initBiblioteca() {
  console.log("[biblioteca.js] Inicializado con Éxito");

  const fileInput = $("libraryFileInput");
  const selectBtn = $("selectLibraryFileBtn");
  const clearBtn = $("clearUploadBtn");
  const typeSelect = $("libraryFileType");

  if (selectBtn && fileInput && !selectBtn.dataset.bound) {
    selectBtn.addEventListener("click", () => fileInput.click());
    selectBtn.dataset.bound = "true";
  }

  if (fileInput && !fileInput.dataset.bound) {
    fileInput.addEventListener("change", handleFileSelection);
    fileInput.dataset.bound = "true";
  }

    if (typeSelect && !typeSelect.dataset.bound) {
    typeSelect.addEventListener("change", () => {
      if (!fileInput) return;

      if (typeSelect.value === "texto" || typeSelect.value === "texto_plano" || typeSelect.value === "letra" || typeSelect.value === "ultrastar_txt") {
        fileInput.setAttribute("accept", ".txt,text/plain");
      } else {
        fileInput.setAttribute("accept", "audio/*,.mp3,.wav,.ogg,.webm,.m4a,.mp4");
      }
    });
    typeSelect.dataset.bound = "true";
  }

  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.addEventListener("click", clearUploadSelection);
    clearBtn.dataset.bound = "true";
  }

  const searchInput = $("librarySearchInput");
  const searchClear = $("clearLibrarySearchBtn");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", () => {
      librarySearchText = searchInput.value;
      if (searchClear) {
        searchClear.style.display = searchInput.value ? "inline-block" : "none";
      }
      // Pausa breve para no consultar a Supabase en cada tecla.
      clearTimeout(librarySearchTimer);
      librarySearchTimer = setTimeout(() => {
        renderLibrary(libraryCurrentFilter);
      }, 250);
    });
  }
  if (searchClear && !searchClear.dataset.bound) {
    searchClear.dataset.bound = "true";
    searchClear.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      librarySearchText = "";
      searchClear.style.display = "none";
      renderLibrary(libraryCurrentFilter);
    });
  }
}

// ============================================
// ☁️ INTERACCIONES DIRECTAS CON SUPABASE Y R2
// ============================================ 

export async function initSupabase() {
  if (typeof window.supabaseApp !== "undefined" || typeof window.getSupabaseClient === "function") {
    // FIX #5: el arranque de la app YA no espera al retry de Supabase, así que
    // una acción del usuario puede llegar antes de que el CDN (defer) cargue.
    // Esperamos hasta 4 s antes de reventar con el error de "CDN no cargado".
    for (let i = 0; i < 40 && typeof window.supabase === "undefined"; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    db = window.getSupabaseClient ? window.getSupabaseClient() : window.supabaseApp;
    console.log("Base de datos Supabase conectada en Biblioteca");
    return db;
  } else {
    console.error("Error: No se encontró la configuración de Supabase.");
    throw new Error("Supabase configuration missing");
  }
} 

export async function getAllLibraryItemsFromSupabase() {
  if (!db) await initSupabase();
  try {
    // Sin tope: con más de 200 filas, el .range(0, 199) escondía los registros
    // viejos en Biblioteca (pero sí salían en Karaoke, que no pagina). Se pagina.
    const PAGE = 500;
    let desde = 0;
    let todos = [];
    for (;;) {
      const { data, error } = await db.from('library').select('*').order('date', { ascending: false }).range(desde, desde + PAGE - 1);
      if (error) throw new Error(`❌ Error al leer la Biblioteca: ${error.message}`);
      todos = todos.concat(data || []);
      if (!data || data.length < PAGE) break;
      desde += PAGE;
    }
    console.log(`✅ Se recuperaron ${todos.length} elementos desde Supabase.`);
    return todos;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function updateLibraryItemsFromSupabase(id, changes) {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db
      .from('library')
      .update(changes)
      .eq('id', id)
      .select(); 

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error(`No se encontró el Item con ID: ${id}`);

    console.log("Registro actualizado con Éxito en Supabase");
    return data[0];

  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function deleteLibraryItemsFromSupabase(id) {
  if (!db) await initSupabase();
  try {
    const item = await getLibraryItemsByIdFromSupabase(id);
    const r2Key = item?.file_path;

    // Textos planos (sin binario): solo se borra el registro.
    if (!r2Key || r2Key === "null") {
      const { error: textErr } = await db.from('library').delete().eq('id', id);
      if (textErr) throw new Error(textErr.message);
      console.log(`Registro con ID ${id} eliminado de Supabase (texto, sin R2).`);
      return;
    }

    // 1. Borrar PRIMERO el binario en R2. Si falla, se conserva el registro
    // para reintentar y no queda un binario huerfano (con costo) en R2.
    if (typeof window === 'undefined' || !window.CloudflareStorage) {
      throw new Error("Sin acceso a R2: no se borra el registro para no dejar huérfano.");
    }
    {
      const ok = await window.CloudflareStorage.deleteFileFromCloudflare(r2Key);
      if (!ok) throw new Error("No se pudo eliminar el binario de R2; el registro se conserva para reintentar.");
      console.log(`Archivo binario eliminado de Cloudflare R2: ${r2Key}`);
    }

    // 2. Luego el registro en Supabase.
    const { error } = await db.from('library').delete().eq('id', id);
    if (error) throw new Error(error.message + " (el binario de R2 ya fue eliminado)");
    console.log(`Registro con ID ${id} eliminado de Supabase.`);

  } catch (error) {
    console.error("Error al eliminar el registro:", error.message);
    throw error;
  }
}

export async function getLibraryItemsByTypeFromSupabase(type) {
  if (!db) await initSupabase();
  try {
    // ✅ PERMISOS FLEXIBLES: Si el frontend pide "texto", buscamos tanto "texto" como "letra" en Supabase
    let query = db.from('library').select('*');
    
    if (type === "texto" || type === "letra" || type === "letras") {
      query = query.or(`type.eq.texto,type.eq.letra,type.eq.texto_plano`);
    } else {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Error de Supabase: ${error.message}`);
    
    console.log(`Buscando '${type}': se encontraron ${data.length} coincidencias.`);
    return data;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function getLibraryItemsByIdFromSupabase(id) {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db.from('library').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No se encontró ningún elemento con el ID: ${id}`);
    return data;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function saveLibraryItemToSupabase({ name, type, blob, transcription = [], metadata = {} }) {
  if (!db) await initSupabase(); 
  // FIX #25: guard explícito — si el script de Cloudflare Storage no cargó
  // (bloqueador, CDN caído), window.CloudflareStorage es undefined y el
  // TypeError llegaba crudo al usuario. Aquí lo interceptamos con mensaje claro.
  if (typeof window === 'undefined' || !window.CloudflareStorage) {
    console.error("CloudflareStorage no está disponible (script no cargado o bloqueado).");
    return { ok: false, error: "El servicio de almacenamiento en la nube (Cloudflare R2) no está disponible. Recarga la página o revisa la conexión." };
  }

  const mimeType = blob.type || "application/octet-stream";
  
  // 1. Obtener extensión correcta basada en el MIME Type
  const extension = mimeType.includes("wav") ? "wav" 
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" 
    : mimeType.includes("webm") ? "webm" 
    : mimeType.includes("ogg") ? "ogg" 
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" 
    : "bin"; 

  // 2. Quitar la extensión original si el nombre ya la incluye (ej: "pista.mp3" -> "pista")
  let baseName = name;
  if (name.toLowerCase().endsWith(`.${extension}`)) {
    baseName = name.substring(0, name.length - (extension.length + 1));
  } else if (name.match(/\.[a-zA-Z0-9]{3,4}$/)) {
    // Por si trae otra extensión diferente (ej: .mpeg o .txt), se la removemos también
    baseName = name.substring(0, name.lastIndexOf('.'));
  }

  // 3. Limpiar solo el cuerpo del nombre de forma segura
  let cleanName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_") // Reemplazar caracteres inválidos por underscore
    .replace(/_+/g, "_"); 

  // 4. Unir el nombre limpio con la extensión final una sola vez
  const fileName = `${cleanName}.${extension}`;
  console.log(`Generando archivo seguro: ${fileName}`);

  const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(blob, fileName, mimeType, type); 

  // Si el insert falla tras subir a R2, compensar borrando el binario para
  // no dejar huerfanos (mismo patron que saveLibraryItemToCloudflare).
  try {
  const { data, error } = await db
    .from("library")
    .insert([
      {
        name: baseName, // Guardamos el nombre limpio sin extensión en la BD
        type,
        file_path: filePath,
        file_url: fileUrl,
        transcription,
        metadata,
        date: new Date().toISOString()
      }
    ])
    .select(); 

  if (error) throw error;
  return data?.[0]; // Retornar el registro insertado con su ID
  } catch (insertErr) {
    try {
      await window.CloudflareStorage.deleteFileFromCloudflare(filePath);
      console.log("Binario huerfano compensado en R2 tras fallo de insert.");
    } catch (_) {}
    throw insertErr;
  }
}

// FIX #10: contrato explícito { ok, item, error }. Antes retornaba undefined
// en fallo y el llamador (mezcla karaoke) mostraba "✅ Guardado" igual, con el
// botón clavado en deshabilitado.
export async function saveToLibrary(blob, options = {}) {
  if (!blob) {
    console.error("No hay audio para guardar");
    return { ok: false, error: "No hay audio para guardar" };
  } 

  try {
        const result = await saveLibraryItemToSupabase({
      name: options.name || "Archivo",
        type: options.type === "audio" || !options.type ? "pista" : options.type,
      blob: blob,
      transcription: options.transcription || [],
      metadata: { textoPlano: options.textoPlano || null }
    }); 

        console.log("Guardado en biblioteca correctamente (Supabase + Cloudflare R2)");

    const filtroActual = options.type || 'todos';
    await renderLibrary(filtroActual);
    return { ok: true, item: result };

  } catch (error) {
    console.error("Error detallado:", error);
    alert("No se pudo guardar en la nube: " + error.message);
    return { ok: false, error };
  }
} 

// ============================================
// 🎨 RENDERIZADO Dinámico de la Interfaz
// ============================================ 

export async function renderLibrary(filter = "todos") {
  const container = $("libraryList");
  if (!container) return;
  libraryCurrentFilter = filter;
  const turno = ++libraryRenderSeq;

  // 1. Manejo visual de botones de carpeta activos (los botones usan
  // data-filter + addEventListener, no onclick: comparar el dataset).
  document.querySelectorAll(".folder-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });

  container.innerHTML = "Archivos de la biblioteca";

  try {
    const library = await getAllLibraryItemsFromSupabase();
    // Si arrancó otro render mientras esperábamos la red, este ya es viejo:
    // se descarta para no duplicar la lista.
    if (turno !== libraryRenderSeq) return;
    // Re-limpiar aquí (no solo antes del fetch): un render viejo que termine
    // tarde agregaría sus tarjetas sobre las del render nuevo.
    container.innerHTML = "Archivos de la biblioteca";
    // ✅ CORRECCIÓN DE FILTRO: Mapeamos los filtros visuales con los datos reales
    const filteredItems = library.filter(item => {
      if (filter === "todos") return true;
  
      // Si el usuario da clic en la carpeta "KARAOKE", mostramos cualquier archivo 
      // que tenga la bandera 'isSincronizada' en verdadero o cuyo tipo sea 'karaoke'
      if (filter === "karaoke") {
        return item.isSincronizada === true || item.type === "karaoke";
      }
  
      if (filter === "letras" || filter === "letra") {
        return item.type === "texto" || item.type === "letra" || item.type === "texto_plano" || item.type === "ultrastar_txt";
      }
  
      if (filter === "voz" || filter === "voces") {
        return item.type === "voz";
      }

      // Filtro por defecto para carpetas exactas (pistas, etc.)
      return item.type === filter;
    });

    // 🔍 Buscador por nombre (insensible a mayúsculas y tildes).
    const consulta = normalizarBusqueda(librarySearchText).trim();
    const searchedItems = consulta
      ? filteredItems.filter(item => normalizarBusqueda(item.name).includes(consulta))
      : filteredItems;

    // ✅ CONTADOR: Refleja el número de archivos según la carpeta activa
    const countEl = document.getElementById("libraryCount");
    if (countEl) countEl.textContent = String(searchedItems.length);

    if (searchedItems.length === 0) {
      container.innerHTML = consulta
        ? `<p style="color: var(--text-muted);">Sin resultados para "${escapeHTML(librarySearchText.trim())}".</p>`
        : "<p style=\"color: var(--text-muted);\">No hay archivos en esta carpeta.</p>";
    }
    
    searchedItems.forEach(item => {
      const div = document.createElement("div");
      div.className = "library-item"; // Conserva tus estilos neón oscuros
  
      // 1. Selección visual del icono según tu interfaz
      let iconoVisual = "🎵";
      if (item.type === "letra" || item.type === "texto" || item.type === "texto_plano") {
        iconoVisual = "📝";
      } else if (item.type === "karaoke" || item.isSincronizada) {
        iconoVisual = "🎧";
      }

      // 2. ✅ COMPROBACIÓN CRÍTICA: Si el archivo ya está sincronizado por Taps, 
      // preparamos el botón rosa de exportación al monitor de canto
      let botonCantarHTML = "";
        if (item.isSincronizada || item.type === "karaoke" || filter === "karaoke") {
          botonCantarHTML = `
          <button class="send-to-monitor-btn" data-id="${item.id}">Cantar</button>
        `;
      }

      // 3. Inyectamos la estructura combinando los botones
      div.innerHTML = `
        <div class="item-info">
          <span class="item-icon">${iconoVisual}</span>
          <span class="item-name">${escapeHTML(item.name)}</span>
        </div>
        <div class="item-actions">
          ${botonCantarHTML}
          <button class="delete-library-btn" data-id="${item.id}" title="Eliminar">🗑</button>
        </div>
      `;

      // 4. ✅ CAPTURAR EL CLIC DEL BOTÓN ROSA DE EXPORTACIÓN
      if (item.isSincronizada || item.type === "karaoke" || filter === "karaoke") {
        const btnCantar = div.querySelector(".send-to-monitor-btn");
        if (btnCantar) {
          btnCantar.addEventListener("click", async (e) => {
            e.stopPropagation(); // Evita interferencias con otros clics de la tarjeta
            console.log(`[Biblioteca] Exportando al Monitor Karaoke: ${item.name}`);
        
            try {
              // LLAMAMOS AL PROCESO DE REDIRECCIÓN AUTOMÁTICA
              await enviarAlMonitorKaraoke(item);
            } catch (err) {
              console.error("Error al exportar:", err);
            }
          });
        }
      }

      container.appendChild(div);
    });

    // Volver a enlazar los eventos de eliminación a los nuevos botones creados
    asignarEventosBiblioteca(filter);
    
  } catch (err) {
    console.error("Error al renderizar biblioteca:", err);
    if (turno !== libraryRenderSeq) return;
    container.innerHTML = "Error al cargar los elementos de la biblioteca.";
  }
}

export function asignarEventosBiblioteca(filter) {
  document.querySelectorAll(".delete-library-btn").forEach((btn) => {
    btn.removeEventListener("click", btn._handler);
    btn._handler = async () => {
      if (confirm("¿Estás seguro de eliminar este archivo?")) {
        const id = btn.dataset.id;
        await deleteLibraryItem(id, filter);
      }
    };
    btn.addEventListener("click", btn._handler);
  });
}

export async function deleteLibraryItem(id, currentFilter = 'todos') {
  try {
    await deleteLibraryItemsFromSupabase(id);
    await renderLibrary(currentFilter);
    console.log(`Archivo ${id} eliminado correctamente.`);
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("No se pudo eliminar el archivo. Inténtalo de nuevo.");
  }
}

export async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");
  const files = fileInput?.files;
  const rawType = typeSelect?.value || "pista";
  // Unificar: el tipo legacy "audio" se guarda como "pista" para que el filtro lo encuentre.
  const type = rawType === "audio" ? "pista" : rawType;

  if (!files || files.length === 0) {
    alert(type === "texto" || type === "texto_plano" || type === "ultrastar_txt" ? "Selecciona un .txt" : "Selecciona al menos un archivo");
    return;
  }

  // ✅ CORRECCIÓN 1: Homologar los tipos de texto para que coincidan con la validación
  const validation = validateFilesForUpload(files, type);
  if (!validation.valid) {
    alert("⚠️" + validation.error);
    return;
  }

  // Pre-cargar estudio.js para exponer segmentarTextoPlano en window (sin dependencia circular)
  try {
    if (typeof window.segmentarTextoPlano !== "function") {
      await import("./estudio.js");
    }
  } catch (e) {
    console.warn("No se pudo pre-cargar estudio.js:", e);
  }

  if (!window.CloudflareStorage?.getCloudflareConfig) {
    showStatus("Cloudflare R2 no está disponible. El script de almacenamiento no cargó; recarga la página o revisa la conexión.", "error");
    return;
  }

  const r2Config = window.CloudflareStorage.getCloudflareConfig();
  if (!r2Config) {
    showStatus("Cloudflare R2 no está configurado en el servidor. Contacta al administrador.", "error");
    return;
  }

  const uploadProgressContainer = $("uploadProgressContainer");
  const uploadFilesList = $("uploadFilesList");
  const saveBtn = $("saveLibraryFileBtn");
  const clearBtn = $("clearUploadBtn");

  if (uploadProgressContainer) uploadProgressContainer.style.display = "block";
  const textoBotonOriginal = saveBtn ? saveBtn.textContent : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Subiendo... no cierres la página";
  }
  if (clearBtn) clearBtn.style.display = "inline-block";
  showStatus("⏳ Enviando archivos a la nube, puede tardar con archivos grandes...", "info");

  // Cronómetro visible: demuestra que sigue trabajando aunque la red vaya lenta.
  const inicioSubida = Date.now();
  const temporizador = setInterval(() => {
    const s = Math.round((Date.now() - inicioSubida) / 1000);
    const text = document.getElementById("uploadProgressText");
    if (text && text.dataset.subiendo === "1") {
      text.textContent = `${text.dataset.base || "Subiendo..."} (${s}s)`;
    }
  }, 1000);

  try {
    let uploadedCount = 0;
    const totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tamMB = (file.size / 1024 / 1024).toFixed(1);
      const base = `⏳ Subiendo ${i + 1}/${totalFiles}: ${file.name} (${tamMB} MB)`;
      // ✅ CORRECCIÓN 2: Pasar el índice 'i' para evitar conflictos de ID duplicados
      updateUploadProgress(uploadedCount, totalFiles, base);
      const text = document.getElementById("uploadProgressText");
      if (text) {
        text.dataset.subiendo = "1";
        text.dataset.base = base;
      }
      setBarraIndeterminada(true);
      addFileToUploadList(uploadFilesList, file.name, "pending", i);
      updateFileStatus(file.name, "uploading", "", i);

      try {
        const isTextType = ["texto", "texto_plano", "letra", "ultrastar_txt"].includes(type);
        let saveResult = null;
        if (isTextType) {
          const text = await file.text();
          console.log(`Guardando archivo de texto: ${file.name}`);
          saveResult = await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: file.name,
            type,
            blob: file,
            textoPlano: text,
            transcription: [],
            metadata: {}
          });
        } else {
          console.log(`Subiendo audio: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          saveResult = await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: file.name,
            type,
            blob: file,
            transcription: [],
            metadata: {}
          });
        }

        updateFileStatus(file.name, "success", "", i);
        uploadedCount++;
        setBarraIndeterminada(false);
        const textOk = document.getElementById("uploadProgressText");
        if (textOk) textOk.dataset.subiendo = "0";
        updateUploadProgress(uploadedCount, totalFiles, `✅ ${uploadedCount}/${totalFiles} enviados`);

        // 🔄 AUTO-CARGA EN ESTUDIO: refrescar y cargar el ítem recién guardado
        try {
          const estudio = await import("./estudio.js");
          if (typeof estudio.autoLoadSelectedInEstudio === "function") {
            await estudio.autoLoadSelectedInEstudio(type, saveResult?.id);
          }
        } catch (autoErr) {
          console.warn("No se pudo auto-cargar en Estudio:", autoErr);
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error subiendo ${file.name}:`, err);
        updateFileStatus(file.name, "error", err.message, i);
        setBarraIndeterminada(false);
        const textErr = document.getElementById("uploadProgressText");
        if (textErr) textErr.dataset.subiendo = "0";
        updateUploadProgress(uploadedCount, totalFiles, `⚠️ Falló ${file.name}, sigo con el siguiente...`);
      }
    }

    setBarraIndeterminada(false);
    const textFin = document.getElementById("uploadProgressText");
    if (textFin) textFin.dataset.subiendo = "0";
    updateUploadProgress(uploadedCount, totalFiles, "✅ Completado");
    await renderLibrary("todos");

    if (uploadedCount > 0) {
      showStatus(`✅ ${uploadedCount}/${totalFiles} archivo(s) guardado(s) correctamente`, "success");
    }
    if (uploadedCount < totalFiles) {
      showStatus(`⚠️ ${totalFiles - uploadedCount} archivo(s) fallaron`, "warning");
    }
  } catch (error) {
    console.error("Error general:", error);
    showStatus("❌ Error: " + error.message, "error");
  } finally {
    clearInterval(temporizador);
    setBarraIndeterminada(false);
    const textReset = document.getElementById("uploadProgressText");
    if (textReset) textReset.dataset.subiendo = "0";
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = textoBotonOriginal || "Guardar en la nube";
    }
    if (clearBtn) clearBtn.style.display = "none";
    if (fileInput) fileInput.value = "";
    if (nameInput) nameInput.value = "";
    setTimeout(() => {
      if (uploadProgressContainer) uploadProgressContainer.style.display = "none";
      if (uploadFilesList) uploadFilesList.innerHTML = "";
    }, 4000);
  }
}
  
function validateFilesForUpload(files, type) {
  const isTextType = ["texto", "texto_plano", "letra", "ultrastar_txt"].includes(type);
  const audioTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/mp3", "audio/x-wav"];
  const textTypes = ["text/plain"];
  // Tope alineado con el Worker (cloudflare-worker.js rechaza con 413 a
  // partir de 100 MB): validar aquí para no hacer esperar la subida.
  const maxSize = 100 * 1024 * 1024; // 100 MB

  for (const file of files) {
    // 1. Validar tamaño máximo
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `${file.name}: excede 100 MB (límite de subida)`
      };
    }

    // 2. Validar archivos de texto
    if (isTextType) {
      const isValidText = textTypes.includes(file.type) || file.name.toLowerCase().endsWith(".txt");
      if (!isValidText) {
        return {
          valid: false,
          error: `${file.name}: debe ser .txt`
        };
      }
    }

    // 3. Validar archivos de audio
    if (!isTextType) {
      const hasValidMime = audioTypes.includes(file.type);
      const hasValidExtension = file.name.match(/\.(mp3|wav|ogg|webm|m4a|mp4)$/i);

      if (!hasValidMime && !hasValidExtension) {
        return {
          valid: false,
          error: `${file.name}: formato de audio no soportado`
        };
      }
    }
  }

  return { valid: true };
}


// ============================================
// DRAG & DROP HANDLERS PARA UPLOAD DE BIBLIOTECA
// ============================================ 

function handleFileSelection(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const uploadOptions = $("uploadOptions");
  const typeSelect = $("libraryFileType");
  const uploadProgressContainer = $("uploadProgressContainer");
  const uploadFilesList = $("uploadFilesList");
  const clearBtn = $("clearUploadBtn");
  const chosenText = $("libraryFileChosenText");

  if (chosenText) {
    chosenText.textContent = files.length === 1
      ? files[0].name
      : `${files.length} archivos seleccionados`;
  }

  if (uploadOptions) {
    uploadOptions.style.display = "block";
  }

  if (typeSelect && !typeSelect.value) {
    typeSelect.value = "pista";
  }

  if (uploadProgressContainer) uploadProgressContainer.style.display = "block";
  if (clearBtn) clearBtn.style.display = "inline-block";

  if (uploadFilesList) {
    uploadFilesList.innerHTML = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const div = document.createElement("div");
      div.className = "upload-file-item";
      div.id = `file-${i}-${file.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
      div.innerHTML = `
        <span class="file-name"> ${escapeHTML(file.name)} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <span class="file-status status-pending"> Listo para subir</span>
      `;
      uploadFilesList.appendChild(div);
    }
  }

  const bar = document.getElementById("uploadProgressBar");
  const text = document.getElementById("uploadProgressText");
  if (bar) bar.style.width = "0%";
  if (text) text.textContent = `0/${files.length} archivos seleccionados`;
}

// ============================================
// 📊 COMPONENTES DE SEGUIMIENTO DE PROGRESO
// ============================================ 

export function addFileToUploadList(container, fileName, status, index = 0) {
  // Nota: Esta función ya no duplica elementos porque handleFileSelection limpia el contenedor al inicio
  if (!container) return;
  
  // Si por alguna razón el elemento no existe en la vista previa previa, lo añade de respaldo
  const existingEl = document.getElementById(`file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`);
  if (!existingEl) {
    const div = document.createElement("div");
    div.className = "upload-file-item";
    div.id = `file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`;
    div.innerHTML = `
      <span class="file-name">${escapeHTML(fileName)}</span>
      <span class="file-status status-${status}">Pendiente</span>
    `;
    container.appendChild(div);
  }
}

export function updateFileStatus(fileName, status, errorMsg = "", index = 0) {
  const el = document.getElementById(`file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`);
  if (el) {
    const statusEl = el.querySelector(".file-status");
    if (statusEl) {
      statusEl.className = "file-status status-" + status;
      if (status === "success") statusEl.textContent = "✅ Listo";
      else if (status === "error") statusEl.textContent = "⚠️" + errorMsg;
      else if (status === "uploading") statusEl.textContent = "⏳ Subiendo...";
      else statusEl.textContent = "Pendiente";
    }
  }
}

// Marca la barra como indeterminada (animada) mientras fetch sube sin % por byte.
export function setBarraIndeterminada(activa) {
  const bar = document.getElementById("uploadProgressBar");
  if (bar) bar.classList.toggle("indeterminada", !!activa);
}

export function updateUploadProgress(uploaded, total, message) {
  const bar = document.getElementById("uploadProgressBar");
  const text = document.getElementById("uploadProgressText");
  if (bar && text) {
    const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;
    bar.style.width = percent + "%";
    text.textContent = message || (`${uploaded}/${total}`);
  }
}

export function showStatus(message, type) {
  const el = document.getElementById("uploadStatus");
  if (el) {
    el.textContent = message;
    el.className = "upload-status " + type;
    el.style.display = "block";
  }

  // ✅ Auto-ocultar la confirmación de éxito tras unos segundos
  clearTimeout(window.__uploadStatusTimer);
  if (type === "success") {
    window.__uploadStatusTimer = setTimeout(() => {
      if (el) {
        el.textContent = "";
        el.className = "upload-status";
        el.style.display = "none";
      }
    }, 4000);
  }
}

export async function enviarAlMonitorKaraoke(karaokeItem) {
  if (!karaokeItem) return;

  try {
    if (!karaokeItem.file_url) {
      const { toast: toastFn } = await import("./utils.js");
      if (typeof toastFn === "function") toastFn("Este karaoke no tiene audio.", "warn");
      else alert("Este karaoke no tiene audio.");
      return;
    }
    // Flujo central de carga (no réplica manual): resuelve letra, tiempos
    // (re-timing en loadedmetadata), selector y dataset en un solo lugar.
    const { loadKaraokeSong } = await import("./karaoke.js?v=18");
    await loadKaraokeSong(karaokeItem.id);
    // Marcar como ya cargado: entrar al tab recargaría el mismo tema por red.
    const track = document.getElementById("karaokeTrack");
    if (track) track.dataset.loadedId = String(karaokeItem.id);
    const select = document.getElementById("karaokeTrackSelect");
    if (select) select.value = String(karaokeItem.id);

    // window.showTab evita importar ../script.js pelado (duplicaría el
    // módulo y sus listeners de DOMContentLoaded).
    if (typeof window.showTab === "function") window.showTab("karaoke");
  } catch (error) {
    console.error("Error al transferir datos al monitor:", error);
  }
}
export function clearUploadSelection() {
  const fileInput = document.getElementById("libraryFileInput");
  const nameInput = document.getElementById("libraryFileName");
  const uploadProgressContainer = document.getElementById("uploadProgressContainer");
  const uploadFilesList = document.getElementById("uploadFilesList");
  const saveBtn = document.getElementById("saveLibraryFileBtn");
  const clearBtn = document.getElementById("clearUploadBtn");
  const uploadProgressBar = document.getElementById("uploadProgressBar");
  const uploadProgressText = document.getElementById("uploadProgressText");
  const statusEl = document.getElementById("uploadStatus");
  const uploadOptions = document.getElementById("uploadOptions");
  const typeSelect = document.getElementById("libraryFileType");
  const chosenText = document.getElementById("libraryFileChosenText");

  if (fileInput) fileInput.value = "";
  if (nameInput) nameInput.value = "";
  if (uploadProgressContainer) uploadProgressContainer.style.display = "none";
  if (uploadFilesList) uploadFilesList.innerHTML = "";
  if (saveBtn) saveBtn.disabled = false;
  if (clearBtn) clearBtn.style.display = "none";
  if (uploadProgressBar) uploadProgressBar.style.width = "0%";
  if (uploadProgressText) uploadProgressText.textContent = "";
  if (uploadOptions) uploadOptions.style.display = "none";
  if (typeSelect) typeSelect.value = "pista";
  if (chosenText) chosenText.textContent = "Ningún archivo seleccionado";

  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.className = "upload-status";
    statusEl.textContent = "";
  }

  console.log("🧼 Interfaz de carga reiniciada de forma segura.");
}
