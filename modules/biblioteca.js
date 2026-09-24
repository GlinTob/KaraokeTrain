import { $ } from "./utils.js"; 

/** 
 * MÃ“DULO BIBLIOTECA â€” Gestor de Almacenamiento Remoto, SincronizaciÃ³n Supabase y Cargas R2
 */

let db = null;

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
  console.log("ðŸ“š [biblioteca.js] Inicializado con Ã©xito");

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
}

// ============================================
// â˜ï¸ INTERACCIONES DIRECTAS CON SUPABASE Y R2
// ============================================ 

export async function initSupabase() {
  if (typeof window.supabaseApp !== "undefined" || typeof window.getSupabaseClient === "function") {
    db = window.getSupabaseClient ? window.getSupabaseClient() : window.supabaseApp;
    console.log("ðŸš€ Base de datos Supabase conectada en Biblioteca");
    return db;
  } else {
    console.error("âŒ Error: No se encontrÃ³ la configuraciÃ³n de Supabase.");
    throw new Error("Supabase configuration missing");
  }
} 

export async function getAllLibraryItemsFromSupabase() {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db.from('library').select('*').order('date', { ascending: false }).range(0, 199);
    if (error) throw new Error(`âŒ Error al leer la Biblioteca: ${error.message}`);
    console.log(`âœ… Se recuperaron ${data.length} elementos desde Supabase.`);
    return data;
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
    if (!data || data.length === 0) throw new Error(`âŒ No se encontrÃ³ el Ã­tem con ID: ${id}`);

    console.log("âœ… Registro actualizado con Ã©xito en Supabase");
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
    if (typeof window !== 'undefined' && window.CloudflareStorage) {
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
    // âœ… PERMISOS FLEXIBLES: Si el frontend pide "texto", buscamos tanto "texto" como "letra" en Supabase
    let query = db.from('library').select('*');
    
    if (type === "texto" || type === "letra" || type === "letras") {
      query = query.or(`type.eq.texto,type.eq.letra,type.eq.texto_plano`);
    } else {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw new Error(`âŒ Error de Supabase: ${error.message}`);
    
    console.log(`ðŸ” Buscando '${type}': se encontraron ${data.length} coincidencias.`);
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
    if (!data) throw new Error(`âŒ No se encontrÃ³ ningÃºn elemento con el ID: ${id}`);
    return data;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function saveLibraryItemToSupabase({ name, type, blob, transcription = [], metadata = {} }) {
  if (!db) await initSupabase(); 

  const mimeType = blob.type || "application/octet-stream";
  
  // 1. Obtener extensiÃ³n correcta basada en el MIME Type
  const extension = mimeType.includes("wav") ? "wav" 
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" 
    : mimeType.includes("webm") ? "webm" 
    : mimeType.includes("ogg") ? "ogg" 
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" 
    : "bin"; 

  // 2. Quitar la extensiÃ³n original si el nombre ya la incluye (ej: "pista.mp3" -> "pista")
  let baseName = name;
  if (name.toLowerCase().endsWith(`.${extension}`)) {
    baseName = name.substring(0, name.length - (extension.length + 1));
  } else if (name.match(/\.[a-zA-Z0-9]{3,4}$/)) {
    // Por si trae otra extensiÃ³n diferente (ej: .mpeg o .txt), se la removemos tambiÃ©n
    baseName = name.substring(0, name.lastIndexOf('.'));
  }

  // 3. Limpiar solo el cuerpo del nombre de forma segura
  let cleanName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_") // Reemplazar caracteres invÃ¡lidos por underscore
    .replace(/_+/g, "_"); 

  // 4. Unir el nombre limpio con la extensiÃ³n final una sola vez
  const fileName = `${cleanName}.${extension}`;
  console.log(`ðŸ“¤ Generando archivo seguro: ${fileName}`);

  const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(blob, fileName, mimeType, type); 

  // Si el insert falla tras subir a R2, compensar borrando el binario para
  // no dejar huerfanos (mismo patron que saveLibraryItemToCloudflare).
  try {
  const { data, error } = await db
    .from("library")
    .insert([
      {
        name: baseName, // Guardamos el nombre limpio sin extensiÃ³n en la BD
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

export async function saveToLibrary(blob, options = {}) {
  if (!blob) {
    console.error("âŒ No hay audio para guardar");
    return;
  } 

  try {
        const result = await saveLibraryItemToSupabase({
      name: options.name || "Archivo",
      type: options.type || "audio",
      blob: blob,
      transcription: options.transcription || [],
      metadata: { textoPlano: options.textoPlano || null }
    }); 

        console.log("âœ… Guardado en biblioteca correctamente (Supabase + Cloudflare R2)");

    const filtroActual = options.type || 'todos';
    await renderLibrary(filtroActual);
    return result;

  } catch (error) {
    console.error("Error detallado:", error);
    alert("âŒ No se pudo guardar en la nube: " + error.message);
  }
} 

// ============================================
// ðŸŽ¨ RENDERIZADO DinÃ¡mico de la Interfaz
// ============================================ 

export async function renderLibrary(filter = "todos") {
  const container = $("libraryList");
  if (!container) return;

  // 1. Manejo visual de botones de carpeta activos
  document.querySelectorAll(".folder-btn").forEach(btn => {
    const clickAttr = btn.getAttribute("onclick") || "";
    if (clickAttr.includes(filter)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  container.innerHTML = "Archivos de la biblioteca";

  try {
    const library = await getAllLibraryItemsFromSupabase();
    // âœ… CORRECCIÃ“N DE FILTRO: Mapeamos los filtros visuales con los datos reales
    const filteredItems = library.filter(item => {
      if (filter === "todos") return true;
  
      // Si el usuario da clic en la carpeta "KARAOKE", mostramos cualquier archivo 
      // que tenga la bandera 'isSincronizada' en verdadero o cuyo tipo sea 'karaoke'
      if (filter === "karaoke") {
        return item.isSincronizada === true || item.type === "karaoke";
      }
  
      if (filter === "letras") {
        return item.type === "texto";
      }
  
      if (filter === "voces") {
        return item.type === "voz";
      }

      // Filtro por defecto para carpetas exactas (pistas, etc.)
      return item.type === filter;
    });

    // âœ… CONTADOR: Refleja el nÃºmero de archivos segÃºn la carpeta activa
    const countEl = document.getElementById("libraryCount");
    if (countEl) countEl.textContent = String(filteredItems.length);
    
    filteredItems.forEach(item => {
      const div = document.createElement("div");
      div.className = "library-item"; // Conserva tus estilos neÃ³n oscuros
  
      // 1. SelecciÃ³n visual del icono segÃºn tu interfaz
      let iconoVisual = "ðŸŽµ";
      if (item.type === "letra" || item.type === "texto" || item.type === "texto_plano") {
        iconoVisual = "ðŸ“„";
      } else if (item.type === "karaoke" || item.isSincronizada) {
        iconoVisual = "ðŸŽ¤";
      }

      // 2. âœ… COMPROBACIÃ“N CRÃTICA: Si el archivo ya estÃ¡ sincronizado por Taps, 
      // preparamos el botÃ³n rosa de exportaciÃ³n al monitor de canto
      let botonCantarHTML = "";
        if (item.isSincronizada || item.type === "karaoke" || filter === "karaoke") {
          botonCantarHTML = `
          <button class="send-to-monitor-btn" data-id="${item.id}">â†ªï¸ðŸŽ¤ Cantar</button>
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
          <button class="delete-library-btn" data-id="${item.id}">ðŸ—‘ï¸</button>
        </div>
      `;

      // 4. âœ… CAPTURAR EL CLIC DEL BOTÃ“N ROSA DE EXPORTACIÃ“N
      if (item.isSincronizada || item.type === "karaoke" || filter === "karaoke") {
        const btnCantar = div.querySelector(".send-to-monitor-btn");
        if (btnCantar) {
          btnCantar.addEventListener("click", async (e) => {
            e.stopPropagation(); // Evita interferencias con otros clics de la tarjeta
            console.log(`ðŸš€ [Biblioteca] Exportando al Monitor Karaoke: ${item.name}`);
        
            try {
              // LLAMAMOS AL PROCESO DE REDIRECCIÃ“N AUTOMÃTICA
              await enviarAlMonitorKaraoke(item);
            } catch (err) {
              console.error("Error al exportar:", err);
            }
          });
        }
      }

      container.appendChild(div);
    });

    // Volver a enlazar los eventos de eliminaciÃ³n a los nuevos botones creados
    asignarEventosBiblioteca(filter);
    
  } catch (err) {
    console.error("Error al renderizar biblioteca:", err);
    container.innerHTML = "âŒ Error al cargar los elementos de la biblioteca.";
  }
}

export function asignarEventosBiblioteca(filter) {
  document.querySelectorAll(".delete-library-btn").forEach((btn) => {
    btn.removeEventListener("click", btn._handler);
    btn._handler = async () => {
      if (confirm("Â¿EstÃ¡s seguro de eliminar este archivo?")) {
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
    console.log(`âœ… Archivo ${id} eliminado correctamente.`);
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("âŒ No se pudo eliminar el archivo. IntÃ©ntalo de nuevo.");
  }
}

export async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");
  const files = fileInput?.files;
  const type = typeSelect?.value || "audio";

  if (!files || files.length === 0) {
    alert(type === "texto" || type === "texto_plano" || type === "ultrastar_txt" ? "âš ï¸ Selecciona un .txt" : "âš ï¸ Selecciona al menos un archivo");
    return;
  }

  // âœ… CORRECCIÃ“N 1: Homologar los tipos de texto para que coincidan con la validaciÃ³n
  const validation = validateFilesForUpload(files, type);
  if (!validation.valid) {
    alert("âŒ " + validation.error);
    return;
  }

  // Pre-cargar estudio.js para exponer segmentarTextoPlano en window (sin dependencia circular)
  try {
    if (typeof window.segmentarTextoPlano !== "function") {
      await import("./estudio.js");
    }
  } catch (e) {
    console.warn("âš ï¸ No se pudo pre-cargar estudio.js:", e);
  }

  if (!window.CloudflareStorage?.getCloudflareConfig) {
    showStatus("âŒ Cloudflare R2 no estÃ¡ configurado. Define VITE_CLOUDFLARE_R2_BASE_URL en .env y reinicia el servidor.", "error");
    return;
  }

  const r2Config = window.CloudflareStorage.getCloudflareConfig();
  if (!r2Config) {
    showStatus("âŒ Cloudflare R2 no configurado. Verifica VITE_CLOUDFLARE_R2_BASE_URL en .env y reinicia el servidor (npm run dev).", "error");
    return;
  }

  const uploadProgressContainer = $("uploadProgressContainer");
  const uploadFilesList = $("uploadFilesList");
  const saveBtn = $("saveLibraryFileBtn");
  const clearBtn = $("clearUploadBtn");

  if (uploadProgressContainer) uploadProgressContainer.style.display = "block";
  if (saveBtn) saveBtn.disabled = true;
  if (clearBtn) clearBtn.style.display = "inline-block";

  try {
    let uploadedCount = 0;
    const totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // âœ… CORRECCIÃ“N 2: Pasar el Ã­ndice 'i' para evitar conflictos de ID duplicados
      updateUploadProgress(uploadedCount, totalFiles, file.name);
      addFileToUploadList(uploadFilesList, file.name, "pending", i);

      try {
        const isTextType = ["texto", "texto_plano", "letra", "ultrastar_txt"].includes(type);
        let saveResult = null;
        if (isTextType) {
          const text = await file.text();
          console.log(`ðŸ“ Guardando archivo de texto: ${file.name}`);
          saveResult = await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: file.name,
            type,
            blob: file,
            textoPlano: text,
            transcription: [],
            metadata: {}
          });
        } else {
          console.log(`ðŸŽµ Subiendo audio: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
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

        // ðŸ”„ AUTO-CARGA EN ESTUDIO: refrescar y cargar el Ã­tem reciÃ©n guardado
        try {
          const estudio = await import("./estudio.js");
          if (typeof estudio.autoLoadSelectedInEstudio === "function") {
            await estudio.autoLoadSelectedInEstudio(type, saveResult?.id);
          }
        } catch (autoErr) {
          console.warn("âš ï¸ No se pudo auto-cargar en Estudio:", autoErr);
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error subiendo ${file.name}:`, err);
        updateFileStatus(file.name, "error", err.message, i);
      }
    }

    updateUploadProgress(uploadedCount, totalFiles, "Completado");
    await renderLibrary("todos");

    if (uploadedCount > 0) {
      showStatus(`âœ… ${uploadedCount}/${totalFiles} archivo(s) guardado(s) correctamente`, "success");
    }
    if (uploadedCount < totalFiles) {
      showStatus(`âš ï¸ ${totalFiles - uploadedCount} archivo(s) fallaron`, "warning");
    }
  } catch (error) {
    console.error("Error general:", error);
    showStatus("âŒ Error: " + error.message, "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (clearBtn) clearBtn.style.display = "none";
    if (fileInput) fileInput.value = "";
    if (nameInput) nameInput.value = "";
    setTimeout(() => {
      if (uploadProgressContainer) uploadProgressContainer.style.display = "none";
      if (uploadFilesList) uploadFilesList.innerHTML = "";
    }, 3000);
  }
}
  
function validateFilesForUpload(files, type) {
  const isTextType = ["texto", "texto_plano", "letra", "ultrastar_txt"].includes(type);
  const audioTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/mp3", "audio/x-wav"];
  const textTypes = ["text/plain"];
  const maxSize = 500 * 1024 * 1024; // 500 MB

  for (const file of files) {
    // 1. Validar tamaÃ±o mÃ¡ximo
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `${file.name}: excede 500 MB`
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
        <span class="file-name">ðŸ“„ ${escapeHTML(file.name)} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <span class="file-status status-pending">â³ Listo para subir</span>
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
// ðŸ“Š COMPONENTES DE SEGUIMIENTO DE PROGRESO
// ============================================ 

export function addFileToUploadList(container, fileName, status, index = 0) {
  // Nota: Esta funciÃ³n ya no duplica elementos porque handleFileSelection limpia el contenedor al inicio
  if (!container) return;
  
  // Si por alguna razÃ³n el elemento no existe en la vista previa previa, lo aÃ±ade de respaldo
  const existingEl = document.getElementById(`file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`);
  if (!existingEl) {
    const div = document.createElement("div");
    div.className = "upload-file-item";
    div.id = `file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`;
    div.innerHTML = `
      <span class="file-name">${escapeHTML(fileName)}</span>
      <span class="file-status status-${status}">â³ Pendiente</span>
    `;
    container.appendChild(div);
  }
}

export function updateFileStatus(fileName, status, errorMsg = "", index = 0) {
  const el = document.getElementById(`file-${index}-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`);
  if (el) {
    const statusEl = el.querySelector(".file-status");
    if (statusEl) {
      statusEl.className = "upload-status status-" + status;
      statusEl.textContent = status === "success" ? "âœ… Listo" : status === "error" ? "âŒ " + errorMsg : "â³ Pendiente";
    }
  }
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

  // âœ… Auto-ocultar la confirmaciÃ³n de Ã©xito tras unos segundos
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
    const track = document.getElementById("karaokeTrack");
    if (track && karaokeItem.file_url) {
        track.src = karaokeItem.file_url;
        track.dataset.karaokeId = String(karaokeItem.id);
        track.load();
    
        const { setKaraokeData } = await import("./karaoke.js?v=18");
        setKaraokeData(
            karaokeItem.transcription || [],
            karaokeItem.name,
            karaokeItem.file_url
        );
        
        const { showTab } = await import("../script.js");
        showTab("karaoke");
    }

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
  if (chosenText) chosenText.textContent = "NingÃºn archivo seleccionado";

  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.className = "upload-status";
    statusEl.textContent = "";
  }

  console.log("ðŸ§¼ Interfaz de carga reiniciada de forma segura.");
}



// ============================================
// MIGRACIÓN DESDE APP PREVIA (CSV + MP3 por nombre)
// ============================================
// El CSV trae columnas id,name,type,file_path,file_url,...,transcription,
// metadata,isReadyKaraoke,textoPlano,lyrics,isSincronizada,tapModeStyle.
// Los audios viejos están muertos (403): se re-suben los MP3 del usuario,
// emparejados por nombre normalizado. Los textos no necesitan audio.

let migRows = [];
let migAudios = [];

function parseCSV(text) {
  const rows = [];
  let row = [], val = "", inQ = false;
  const push = () => { row.push(val); val = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { val += '"'; i++; }
        else inQ = false;
      } else val += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") push();
    else if (c === "\n") { push(); rows.push(row); row = []; }
    else if (c === "\r") { /* ignorar */ }
    else val += c;
  }
  if (val !== "" || row.length) { push(); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length === head.length).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

function normMigName(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^karaoke\s*-\s*/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function parseJSONSeguro(s, fb) {
  try {
    const v = JSON.parse(s);
    return (v === null || v === undefined) ? fb : v;
  } catch (e) { return fb; }
}

export function setMigCSV(text) {
  migRows = parseCSV(text);
  console.log(`Migración: ${migRows.length} filas en el CSV.`);
  renderMigPreview();
  return migRows.length;
}

export function setMigAudios(fileList) {
  migAudios = Array.from(fileList || []);
  console.log(`Migración: ${migAudios.length} audios para emparejar.`);
  renderMigPreview();
  return migAudios.length;
}

function pairMigAudio(rowName) {
  const target = normMigName(rowName);
  if (!target) return null;
  return migAudios.find((f) => {
    const base = normMigName(f.name.replace(/\.[^.]+$/, ""));
    return base && (base.includes(target) || target.includes(base));
  }) || null;
}

function cleanMigUrl(u) {
  return String(u || "").replace(/\s+/g, "");
}

// Verifica que el audio viejo siga vivo (Range mínimo, con UA de navegador
// el bucket responde 206 + CORS *; sin UA da 403 anti-bots).
async function urlMigViva(u) {
  const url = cleanMigUrl(u);
  if (!url) return false;
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export function renderMigPreview() {
  const box = $("migPreview");
  if (!box) return;
  if (!migRows.length) {
    box.innerHTML = "<p style='color: var(--text-muted);'>Sube el CSV para ver qué se migrará.</p>";
    return;
  }
  const counts = {};
  migRows.forEach((r) => { counts[r.type] = (counts[r.type] || 0) + 1; });
  const resumen = Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(" · ");
  let html = `<p><b>${migRows.length} filas</b> (${escapeHTML(resumen)}) · ${migAudios.length} audios</p>`;
  html += "<ul style='max-height: 220px; overflow-y: auto; padding-left: 18px;'>";
  migRows.slice(0, 60).forEach((r) => {
    const necesitaAudio = r.type !== "texto";
    const paired = necesitaAudio ? pairMigAudio(r.name) : true;
    const tieneUrl = necesitaAudio && !!cleanMigUrl(r.file_url);
    const marca = !necesitaAudio ? "📄" : (tieneUrl ? "🌐 URL vieja" : (paired ? "✅ MP3" : "⚠️ sin audio"));
    html += `<li>${marca} <b>${escapeHTML(r.type)}</b> — ${escapeHTML(r.name)}${paired && paired.name ? ` <small>↔ ${escapeHTML(paired.name)}</small>` : ""}</li>`;
  });
  if (migRows.length > 60) html += `<li>…y ${migRows.length - 60} más</li>`;
  html += "</ul>";
  box.innerHTML = html;
}

export async function migrarAppPrevia(onProgress) {
  if (!db) await initSupabase();
  const status = $("migStatus");
  const setSt = (t) => { if (status) status.textContent = t; };
  if (!migRows.length) {
    setSt("Primero sube el CSV.");
    return { ok: 0, pendientes: [] };
  }
  // Anti-duplicados: lo ya migrado se omite al repetir (por nombre+tipo).
  let existentes = new Set();
  try {
    const items = await getAllLibraryItemsFromSupabase();
    existentes = new Set((items || []).map((it) => `${it.type}||${it.name}`));
  } catch (e) {}
  let ok = 0;
  let omitidos = 0;
  const pendientes = [];
  let i = 0;
  for (const row of migRows) {
    if (existentes.has(`${row.type}||${row.name}`)) {
      omitidos++;
      continue;
    }
    i++;
    if (onProgress) onProgress(i, migRows.length);
    setSt(`Migrando ${i}/${migRows.length}: ${row.name}`);
    try {
      const lyrics = parseJSONSeguro(row.lyrics, []);
      const transcription = parseJSONSeguro(row.transcription, []);
      const meta = Object.assign(parseJSONSeguro(row.metadata, {}), { migrado: true, origen: "app-previa" });
      const segs = (Array.isArray(transcription) && transcription.length)
        ? transcription
        : (Array.isArray(lyrics) ? lyrics : []);
      const base = {
        name: row.name || "Sin nombre",
        type: row.type || "pista",
        transcription: segs,
        lyrics: Array.isArray(lyrics) ? lyrics : [],
        textoPlano: row.textoPlano || null,
        isSincronizada: row.isSincronizada === "true" || row.isSincronizada === true || row.type === "karaoke",
        isReadyKaraoke: row.isReadyKaraoke === "true" || row.isReadyKaraoke === true,
        tapModeStyle: row.tapModeStyle || "linea",
        metadata: meta,
        date: new Date().toISOString(),
      };
      if (row.type === "texto") {
        const { error } = await db.from("library").insert([{ ...base, file_path: null, file_url: null }]).select();
        if (error) throw error;
        ok++;
        continue;
      }
      // 1) URL vieja viva: referenciar directo (sin re-subir, instantáneo).
      // file_path queda null (bucket ajeno): al borrar solo se borra el registro.
      if (await urlMigViva(row.file_url)) {
        const { error } = await db.from("library").insert([{
          ...base,
          file_path: null,
          file_url: cleanMigUrl(row.file_url),
        }]).select();
        if (error) throw error;
        ok++;
        continue;
      }
      // 2) Respaldo: MP3 emparejado por nombre -> subir a R2 nuevo.
      const audio = pairMigAudio(row.name);
      if (!audio) {
        pendientes.push(`${row.type}: ${row.name} (URL muerta y sin MP3)`);
        continue;
      }
      const up = await window.CloudflareStorage.saveLibraryItemToCloudflare({
        name: row.name,
        type: row.type,
        blob: audio,
        transcription: base.transcription,
        metadata: meta,
        textoPlano: null,
      });
      // Conservar letra sincronizada y flags viejos en el registro recién creado.
      if (up && up.id) {
        await db.from("library").update({
          lyrics: base.lyrics,
          isSincronizada: base.isSincronizada,
          isReadyKaraoke: base.isReadyKaraoke,
          tapModeStyle: base.tapModeStyle,
        }).eq("id", up.id);
      }
      ok++;
    } catch (e) {
      console.error(`Migración falló en "${row.name}":`, e);
      pendientes.push(`${row.type}: ${row.name} (error: ${e.message || e})`);
    }
  }
  setSt(`✅ Migrados ${ok}/${migRows.length}.` + (omitidos ? ` Omitidos (ya estaban): ${omitidos}.` : "") + (pendientes.length ? ` Pendientes (${pendientes.length}): súbeles su MP3 y repite.` : ""));
  try { await renderLibrary("todos"); } catch (e) {}
  return { ok, pendientes };
}
