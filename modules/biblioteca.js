import { $ } from "../script.js"; 

/** 
 * MÓDULO BIBLIOTECA — Gestor de Almacenamiento Remoto, Sincronización Supabase y Cargas R2
 */

let db = null; 

export function initBiblioteca() {
  console.log("📚 [biblioteca.js] Inicializado con éxito"); 

  // Escuchar el cambio cuando el usuario hace clic y elige archivos mediante el explorador
  const fileInput = $("libraryFileInput");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileSelection);
  }
}

// ============================================
// ☁️ INTERACCIONES DIRECTAS CON SUPABASE Y R2
// ============================================ 

export async function initSupabase() {
  if (typeof window.supabaseApp !== "undefined" || typeof window.getSupabaseClient === "function") {
    db = window.getSupabaseClient ? window.getSupabaseClient() : window.supabaseApp;
    console.log("🚀 Base de datos Supabase conectada en Biblioteca");
    return db;
  } else {
    console.error("❌ Error: No se encontró la configuración de Supabase.");
    throw new Error("Supabase configuration missing");
  }
} 

export async function getAllLibraryItemsFromSupabase() {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db.from('library').select('*');
    if (error) throw new Error(`❌ Error al leer la Biblioteca: ${error.message}`);
    console.log(`✅ Se recuperaron ${data.length} elementos desde Supabase.`);
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
    if (!data || data.length === 0) throw new Error(`❌ No se encontró el ítem con ID: ${id}`);

    console.log("✅ Registro actualizado con éxito en Supabase");
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

    // 1. Eliminar primero el registro en la base de datos de Supabase
    const { error } = await db.from('library').delete().eq('id', id);
    if (error) throw new Error(error.message);
    console.log(`✅ Registro con ID ${id} eliminado de Supabase.`);

    // 2. ✅ VALIDACIÓN EXPLICITA: Si r2Key es null, undefined, vacío o la cadena "null", 
    // significa que era un texto plano. Terminamos la función aquí sin llamar a R2.
    if (!r2Key || r2Key === "null") {
      console.log("📄 Archivo de texto plano local eliminado correctamente (sin interacción con R2).");
      return; 
    }

    // 3. Si tiene una clave real (pistas, voces), procedemos a borrar el binario en Cloudflare R2
    if (typeof window !== 'undefined' && window.CloudflareStorage) {
      try {
        await window.CloudflareStorage.deleteFileFromCloudflare(r2Key);
        console.log(`☁️ Archivo binario eliminado de Cloudflare R2: ${r2Key}`);
      } catch (e) {
        console.warn('No se pudo eliminar de R2:', e);
      }
    }

  } catch (error) {
    console.error("❌ Error al eliminar el registro:", error.message);
    throw error;
  }
}

export async function getLibraryItemsByTypeFromSupabase(type) {
  if (!db) await initSupabase();
  try {
    // ✅ PERMISOS FLEXIBLES: Si el frontend pide "texto", buscamos tanto "texto" como "letra" en Supabase
    let query = db.from('library').select('*');
    
    if (type === "texto" || type === "letra") {
      query = query.or(`type.eq.texto,type.eq.letra,type.eq.texto_plano`);
    } else {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw new Error(`❌ Error de Supabase: ${error.message}`);
    
    console.log(`🔍 Buscando '${type}': se encontraron ${data.length} coincidencias.`);
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
    if (!data) throw new Error(`❌ No se encontró ningún elemento con el ID: ${id}`);
    return data;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function saveLibraryItemToSupabase({ name, type, blob, transcription = [], metadata = {} }) {
  if (!db) await initSupabase(); 

  const mimeType = blob.type || "application/octet-stream";
  
  // 1. Obtener extensión correcta basada en el MIME Type
  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "bin"; 

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
    .replace(/[^a-zA-Z0-9_]/g, "*") // Cambiado ".*" por "_" para evitar puntos dobles accidentales
    .replace(/__+/g, "_"); 

  // 4. Unir el nombre limpio con la extensión final una sola vez
  const fileName = `${cleanName}.${extension}`;
  console.log(`📤 Generando archivo seguro: ${fileName}`);

  const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(blob, fileName, mimeType, type); 

  const { error } = await db
    .from("library")
    .insert([
      {
        name: baseName, // Guardamos el nombre limpio sin extensión en la BD si prefieres la interfaz limpia
        type,
        file_path: filePath,
        file_url: fileUrl,
        transcription,
        metadata,
        date: new Date().toISOString()
      }
    ]); 

  if (error) throw error;
}

export async function saveToLibrary(blob, options = {}) {
  if (!blob) {
    console.error("❌ No hay audio para guardar");
    return;
  } 

  try {
    await window.CloudflareStorage.saveLibraryItemToCloudflare({
      name: options.name || "Archivo",
      type: options.type || "audio",
      blob: blob,
      transcription: options.transcription || [],
      metadata: { textoPlano: options.textoPlano || null }
    }); 

    console.log("✅ Guardado en biblioteca correctamente (Cloudflare R2)");

    const filtroActual = options.type || 'todos';
    await renderLibrary(filtroActual);

  } catch (error) {
    console.error("Error detallado:", error);
    alert("❌ No se pudo guardar en la nube: " + error.message);
  }
} 

// ============================================
// 🎨 RENDERIZADO Dinámico de la Interfaz
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

  container.innerHTML = "Cargando archivos...";

  try {
    const library = await getAllLibraryItemsFromSupabase();
    
    // Homologamos los filtros con las categorías reales de tu base de datos
    const filteredItems = filter === "todos" 
      ? library 
      : library.filter(item => item.type === filter || (filter === "letras" && item.type === "letra"));
      
    container.innerHTML = "";

    if (!filteredItems || filteredItems.length === 0) {
      container.innerHTML = `<p class="empty-message">🗄️ No hay elementos en esta carpeta.</p>`;
      return;
    }

    filteredItems.forEach(item => {
      const div = document.createElement("div");
      div.className = "library-item"; // Hereda tus estilos neón de la cuadrícula inferior
      
      // ✅ SELECCIÓN DE ICONO CORRECTO COINCIDIENDO CON TU INTERFAZ
      let iconoVisual = "🎵"; // Icono por defecto para audios (Pistas, Voces, Grabaciones)
      if (item.type === "letra" || item.type === "texto" || item.type === "texto_plano") {
        iconoVisual = "📄"; // Icono de hoja para archivos de texto plano
      } else if (item.type === "karaoke") {
        iconoVisual = "🎤"; // Micrófono para karaokes completos
      }

      div.innerHTML = `
        <div class="item-info">
          <span class="item-icon">${iconoVisual}</span>
          <span class="item-name">${item.name}</span>
        </div>
        <!-- El data-id usa el ID numérico único de Supabase, resolviendo conflictos de nombres iguales -->
        <button class="delete-library-btn" data-id="${item.id}">🗑️</button>
      `;
      container.appendChild(div);
    });

    // Volver a enlazar los eventos de eliminación a los nuevos botones creados
    asignarEventosBiblioteca(filter);
    
  } catch (err) {
    console.error("Error al renderizar biblioteca:", err);
    container.innerHTML = "❌ Error al cargar los elementos de la biblioteca.";
  }
}

export function asignarEventosBiblioteca(filter) {
  document.querySelectorAll(".delete-library-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (confirm("¿Estás seguro de eliminar este archivo?")) {
        const id = btn.dataset.id;
        await deleteLibraryItem(id, filter);
      }
    };
  });
}

export async function deleteLibraryItem(id, currentFilter = 'todos') {
  try {
    await deleteLibraryItemsFromSupabase(id);
    await renderLibrary(currentFilter);
    console.log(`✅ Archivo ${id} eliminado correctamente.`);
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("❌ No se pudo eliminar el archivo. Inténtalo de nuevo.");
  }
}

export async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");
  const files = fileInput?.files;
  const type = typeSelect?.value || "audio";

  if (!files || files.length === 0) {
    alert(type === "texto" || type === "texto_plano" || type === "ultrastar_txt" ? "⚠️ Selecciona un .txt" : "⚠️ Selecciona al menos un archivo");
    return;
  }

  // ✅ CORRECCIÓN 1: Homologar los tipos de texto para que coincidan con la validación
  const validation = validateFilesForUpload(files, type);
  if (!validation.valid) {
    alert("❌ " + validation.error);
    return;
  }

  if (!window.CloudflareStorage?.getCloudflareConfig) {
    showStatus("❌ Cloudflare R2 no está configurado. Define VITE_CLOUDFLARE_R2_BASE_URL en .env y reinicia el servidor.", "error");
    return;
  }

  const r2Config = window.CloudflareStorage.getCloudflareConfig();
  if (!r2Config) {
    showStatus("❌ Cloudflare R2 no configurado. Verifica VITE_CLOUDFLARE_R2_BASE_URL en .env y reinicia el servidor (npm run dev).", "error");
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
      // ✅ CORRECCIÓN 2: Pasar el índice 'i' para evitar conflictos de ID duplicados
      updateUploadProgress(uploadedCount, totalFiles, file.name);
      addFileToUploadList(uploadFilesList, file.name, "pending", i);

      try {
        const isTextType = ["texto", "texto_plano", "ultrastar_txt"].includes(type);
        if (isTextType) {
          const text = await file.text();
          console.log(`📝 Guardando archivo de texto: ${file.name}`);
          await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: file.name,
            type,
            blob: file,
            textoPlano: text,
            transcription: [],
            metadata: {}
          });
        } else {
          console.log(`🎵 Subiendo audio: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: file.name,
            type,
            blob: file,
            transcription: [],
            metadata: {}
          });
        }

        updateFileStatus(file.name, "success", "", i);
        uploadedCount++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error subiendo ${file.name}:`, err);
        updateFileStatus(file.name, "error", err.message, i);
      }
    }

    updateUploadProgress(uploadedCount, totalFiles, "Completado");
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
  const isTextType = ["texto", "ultrastar_txt"].includes(type);
  const audioTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/mp3", "audio/x-wav"];
  const textTypes = ["text/plain"];
  const maxSize = 500 * 1024 * 1024; // 500 MB

  for (const file of files) {
    // 1. Validar tamaño máximo
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

  const uploadProgressContainer = $("uploadProgressContainer");
  const uploadFilesList = $("uploadFilesList");
  const clearBtn = $("clearUploadBtn");

  if (uploadProgressContainer) uploadProgressContainer.style.display = "block";
  if (clearBtn) clearBtn.style.display = "inline-block";
  
  if (uploadFilesList) {
    uploadFilesList.innerHTML = ""; // Limpiar archivos previos en pantalla

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const div = document.createElement("div");
      div.className = "upload-file-item";
      // Mantenemos el índice único para evitar errores con nombres repetidos
      div.id = `file-${i}-${file.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
      div.innerHTML = `
        <span class="file-name">📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <span class="file-status status-pending">⏳ Listo para subir</span>
      `;
      uploadFilesList.appendChild(div);
    }
  }
  
  // Inicializar la barra visual en 0%
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
      <span class="file-name">${fileName}</span>
      <span class="file-status status-${status}">⏳ Pendiente</span>
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
      statusEl.textContent = status === "success" ? "✅ Listo" : status === "error" ? "❌ " + errorMsg : "⏳ Pendiente";
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

  if (fileInput) fileInput.value = "";
  if (nameInput) nameInput.value = "";
  if (uploadProgressContainer) uploadProgressContainer.style.display = "none";
  if (uploadFilesList) uploadFilesList.innerHTML = "";
  if (saveBtn) saveBtn.disabled = false;
  if (clearBtn) clearBtn.style.display = "none";
  if (uploadProgressBar) uploadProgressBar.style.width = "0%";
  if (uploadProgressText) uploadProgressText.textContent = ""; 

  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.className = "upload-status";
    statusEl.textContent = "";
  }
  console.log("🧼 Interfaz de carga reiniciada de forma segura.");
}
