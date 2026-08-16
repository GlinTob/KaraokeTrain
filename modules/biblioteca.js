import { $ } from "../script.js"; 

/** 
 * MÓDULO BIBLIOTECA — Gestor de Almacenamiento Remoto, Sincronización Supabase y Cargas R2
 */

let db = null; 

export function initBiblioteca() {
  const dropZone = $("uploadDropZone");
  const fileInput = $("libraryFileInput");

  if (dropZone && fileInput) {
    // Replacement for onclick="$('libraryFileInput').click()"
    dropZone.addEventListener("click", () => FileInput.click());

    // Replacements for inline drag/drop handlers
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault(); // Necessary to allow drop
      handleDragOver(event);
    });

    dropZone.addEventListener("dragleave", (event) => {
      handleDragLeave(event);
    });

    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      handleFileDrop(event);
    });
  } else {
    console.warn("⚠️ Elementos de carga no encontrados en el DOM.");
  }
}

// ============================================
// ☁️ INTERACCIONES DIRECTAS CON SUPABASE Y R2
// ============================================ 

export async function initSupabase() {
  try {
    // 1. Buscamos la función constructora global que configuramos
    const getClient = window.getSupabaseClient;
    
    if (typeof getClient === "function") {
      // Si ya está disponible, la ejecutamos para obtener la conexión
      db = getClient();
    } else if (window.supabaseApp) {
      // Si la variable directa ya existe, la tomamos
      db = window.supabaseApp;
    } else {
      // Si ninguna está lista en este milisegundo, esperamos un instante a que cargue
      await new Promise(resolve => setTimeout(resolve, 50));
      return initSupabase(); // Reintenta pacíficamente
    }

    console.log("🚀 Base de datos Supabase sincronizada con éxito en Biblioteca");
    return db;

  } catch (error) {
    console.error("❌ Error crítico inicializando Supabase en Biblioteca:", error.message);
    throw new Error("Supabase configuration missing");
  }
}


export async function getAllLibraryItemsFromSupabase() {
  if (!db) await initSupabase();

  try {
    const { data, error } = await db
      .from('library')
      .select('*')
      .order('date', { ascending: false });

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
    // 1. Obtener la información del ítem ANTES de borrar nada
    const item = await getLibraryItemsByIdFromSupabase(id);
    const r2Key = item?.file_path; 

    // 2. Si el archivo existe en Cloudflare R2, intentar borrarlo primero
    if (r2Key && typeof window !== 'undefined' && window.CloudflareStorage) {
      try {
        await window.CloudflareStorage.deleteFileFromCloudflare(r2Key);
        console.log(`☁️ Archivo eliminado de Cloudflare R2: ${r2Key}`);
      } catch (e) {
        // Si Cloudflare falla, lanzamos un error para detener el borrado en Supabase
        throw new Error(`No se pudo eliminar el archivo físico de R2: ${e.message}. Operación cancelada.`);
      }
    }

    // 3. Si el archivo físico se borró con éxito (o no requería Cloudflare), borramos el registro en Supabase
    const { error } = await db.from('library').delete().eq('id', id);
    if (error) throw new Error(error.message);
    
    console.log(`✅ Registro con ID ${id} eliminado de Supabase.`);

  } catch (error) {
    console.error("❌ Error al eliminar el registro:", error.message);
    throw error;
  }
}

export async function getLibraryItemsByTypeFromSupabase(type) {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db.from('library').select('*').eq('type', type);
    if (error) throw new Error(`❌ Error de Supabase: ${error.message}`);
    console.log(`🔍 Buscando '${type}': se encontraron ${data?.length || 0} coincidencias.`);
    return data;
  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export async function getLibraryItemsByIdFromSupabase(id) {
  if (!db) await initSupabase();
  try {
    const { data, error } = await db.from('library').select('*').eq('id', id).maybeSingle();
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

  if (!window.CloudflareStorage?.uploadFileToCloudflare) {
    throw new Error("CloudflareStorage no está disponible.");
  }

  const mimeType = blob.type || "application/octet-stream";
  const extension =
    mimeType.includes("wav") ? "wav" :
    mimeType.includes("mpeg") ? "mp3" :
    mimeType.includes("webm") ? "webm" :
    mimeType.includes("ogg") ? "ogg" :
    mimeType.includes("mp4") ? "mp4" :
    mimeType.includes("text") || mimeType.includes("plain") ? "txt" : // 👈 ¡Añade esta línea para los .txt!
    "bin";
  
  // Quitar extensión
  const nameCleanedOfExt = (name || "archivo").replace(/\.[a-zA-Z0-9]+$/, "");
  
  // Limpiar
  const baseName = nameCleanedOfExt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  
  // Juntar nombre y extensión
  const fileName = `${baseName}.${extension}`;
  console.log(`📤 Generando archivo seguro: ${fileName}`);

  // 1. Se sube el archivo a Cloudflare R2
  const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(
    blob,
    fileName,
    mimeType,
    type
  );

  // 2. Bloque de seguridad para la inserción en Supabase
  try {
    const { data, error } = await db
      .from("library")
      .insert([
        {
          name,
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

    return data?.[0] || null;

  } catch (supabaseError) {
    // 3. PLAN DE RESPALDO: Si Supabase falla, borramos el archivo de Cloudflare inmediatamente
    console.warn("⚠️ Falló el registro en Supabase. Eliminando archivo de Cloudflare para evitar basura...");
    
    if (window.CloudflareStorage?.deleteFileFromCloudflare) {
      try {
        await window.CloudflareStorage.deleteFileFromCloudflare(filePath);
        console.log("🗑️ Archivo huérfano eliminado de Cloudflare con éxito.");
      } catch (cloudflareError) {
        console.error("🚨 Error crítico: No se pudo limpiar el archivo en Cloudflare:", cloudflareError.message);
      }
    }
    
    // Propagamos el error original para que la interfaz sepa que falló el guardado
    throw new Error(`Error al guardar en base de datos: ${supabaseError.message}`);
  }
}

export async function saveToLibrary(blob, options = {}) {
  if (!blob) {
    console.error("❌ No hay archivo para guardar");
    return;
  } 

  // Ajuste de carpeta: Si no viene un tipo, por defecto va a la carpeta 'Pista'
  const carpetaDestino = options.type || "Pista";

  try {
    // Guarda el archivo físico y registra los datos en Supabase
    await saveLibraryItemToSupabase({
      name: options.name || "Archivo Sin Nombre",
      type: carpetaDestino, // Aquí pasa 'Pista', 'Voz', 'Letra' o 'Karaoke'
      blob: blob,
      transcription: options.transcription || [],
      metadata: { textoPlano: options.textoPlano || null }
    }); 

    console.log(`✅ Guardado correctamente en la carpeta: ${carpetaDestino}`);

    // Refresca la interfaz mostrando inmediatamente la carpeta donde se guardó
    await renderLibrary(carpetaDestino);

  } catch (error) {
    console.error("Error detallado:", error);
    alert("❌ No se pudo guardar en la nube: " + error.message);
  }
}


// ============================================
// 🎨 RENDERIZADO Dinámico de la Interfaz
// ============================================ 

export async function renderLibrary(filter = "todos") {
  const container = document.getElementById("libraryList");
  if (!container) return;

  // CORRECCIÓN 1: Forma moderna y segura de activar visualmente el botón de la carpeta actual
  document.querySelectorAll(".folder-btn").forEach(btn => {
    // Busca en tu HTML un atributo nativo como data-folder="Voz" o data-folder="todos"
    const folderType = btn.getAttribute("data-folder") || "";
    if (folderType === filter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  container.innerHTML = "Cargando archivos...";

  try {
    let filteredItems;

    // CORRECCIÓN 3: Optimización de rendimiento. Ya no descarga toda la base de datos completa.
    // Si pide una carpeta específica, va a Supabase y trae ÚNICAMENTE los archivos de esa carpeta.
    if (filter === "todos") {
      filteredItems = await getAllLibraryItemsFromSupabase();
    } else {
      filteredItems = await getLibraryItemsByTypeFromSupabase(filter);
    }

    container.innerHTML = "";

    if (!filteredItems || filteredItems.length === 0) {
      container.innerHTML = `<p class="empty-message">🗄️ No hay elementos en '${filter}'.</p>`;
      return;
    }

    filteredItems.forEach(item => {
      // CORRECCIÓN 2: Íconos personalizados y dinámicos para cada una de tus carpetas reales
      let icon = "🎵"; // Por defecto para Pista o Karaoke
      if (item.type === "Voz") icon = "🎙️";
      if (item.type === "Letra") icon = "📝";

      const div = document.createElement("div");
      div.className = "library-item";
      div.innerHTML = `
        <div class="item-info">
          <span class="item-icon">${icon}</span>
          <span class="item-name">${item.name}</span>
        </div>
        <button class="delete-library-btn" data-id="${item.id}">🗑️</button>
      `;
      container.appendChild(div);
    });

    asignarEventosBiblioteca(filter);
  } catch (err) {
    console.error(err);
    container.innerHTML = "❌ Error al cargar los elementos de la biblioteca.";
  }
}


// 1. La función que asigna el evento al botón de la interfaz
export function asignarEventosBiblioteca(filter) {
  document.querySelectorAll(".delete-library-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("¿Estás seguro de eliminar este archivo?")) {
        const id = btn.dataset.id;
        // Llama correctamente al coordinador de borrado
        await deleteLibraryItem(id, filter);
      }
    });
  });
}

// 2. Tu función coordinadora (Se queda exactamente igual porque está perfecta)
export async function deleteLibraryItem(id, currentFilter = 'todos') {
  try {
    await deleteLibraryItemsFromSupabase(id); // Borra en R2 y Supabase
    await renderLibrary(currentFilter);       // Refresca la pantalla
    console.log(`✅ Archivo ${id} eliminado correctamente.`);
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("❌ No se pudo eliminar el archivo. Inténtalo de nuevo.");
  }
}

export async function saveManualFileToLibrary() {
  // CORRECCIÓN 1: Estándar moderno document.getElementById en lugar de $()
  const fileInput = document.getElementById("libraryFileInput");
  const typeSelect = document.getElementById("libraryFileType");
  const nameInput = document.getElementById("libraryFileName");
  const files = fileInput?.files;
  
  // CORRECCIÓN 2: Si no viene un tipo, por defecto va a la carpeta 'Pista'
  const type = typeSelect?.value || "Pista";

  if (!files || files.length === 0) {
    alert(type === "Letra" ? "⚠️ Selecciona un archivo de texto (.txt)" : "⚠️ Selecciona al menos un archivo");
    return;
  }

  // Se ejecuta tu función de soporte de validación actualizada
  const validation = validateFilesForUpload(files, type);
  if (!validation.valid) {
    alert("❌ " + validation.error);
    return;
  }

  const uploadProgressContainer = document.getElementById("uploadProgressContainer");
  const uploadFilesList = document.getElementById("uploadFilesList");
  const saveBtn = document.getElementById("saveLibraryFileBtn");
  const clearBtn = document.getElementById("clearUploadBtn");

  if (uploadProgressContainer) uploadProgressContainer.style.display = "block";
  if (saveBtn) saveBtn.disabled = true;
  if (clearBtn) clearBtn.style.display = "inline-block";

  try {
    let uploadedCount = 0;
    const totalFiles = files.length;
    const baseName = nameInput?.value?.trim();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Inicia el seguimiento visual con tus funciones de soporte
      updateUploadProgress(uploadedCount, totalFiles, file.name);
      addFileToUploadList(uploadFilesList, file.name, "pending");

      try {
        // Lógica de generación segura de nombres para evitar colisiones
        let finalName = "";
        const originalExt = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
        const nameWithoutExt = file.name.includes(".") ? file.name.split(".").slice(0, -1).join(".") : file.name;

        if (baseName) {
          finalName = files.length === 1 ? baseName + originalExt : `${baseName}_${i + 1}${originalExt}`;
        } else {
          finalName = files.length === 1 ? file.name : `${nameWithoutExt}_${i + 1}${originalExt}`;
        }

        // CORRECCIÓN 3: Procesamiento exclusivo para Letra o archivos multimedia
        if (type === "Letra") {
          const text = await file.text();
          console.log(`📝 Guardando archivo de texto: ${finalName}`);

          // Enlaza directamente a tu función unificada de base de datos
          await saveLibraryItemToSupabase({
            name: finalName,
            type,
            blob: file,
            transcription: [],
            metadata: { textoPlano: text }
          });
        } else {
          console.log(`🎵 Subiendo archivo multimedia: ${finalName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

          // Enlaza a tu función unificada de base de datos para Pista, Voz o Karaoke
          await saveLibraryItemToSupabase({
            name: finalName,
            type,
            blob: file,
            transcription: [],
            metadata: {}
          });
        }

        // Actualiza el estado visual a éxito usando tu función de soporte
        updateFileStatus(file.name, "success");
        uploadedCount++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error subiendo ${file.name}:`, err);
        updateFileStatus(file.name, "error", err.message);
      }
    }

    updateUploadProgress(uploadedCount, totalFiles, "Completado");
    
    // Al terminar, refresca la pantalla abriendo exactamente la carpeta donde se subieron
    await renderLibrary(type);

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
    // CORRECCIÓN 4: Uso de tu función clearUploadSelection para reiniciar la interfaz de forma limpia
    setTimeout(() => {
      clearUploadSelection();
    }, 3000);
  }
}


function validateFilesForUpload(files, type) {
  // CORRECCIÓN: Ahora valida basándose en tu carpeta real de texto "Letra"
  const isTextType = type === "Letra";
  const maxSize = 500 * 1024 * 1024; // 500 MB

  for (const file of files) {
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `${file.name}: excede 500 MB`
      };
    }

    const isTxt = file.type === "text/plain" || /\.txt$/i.test(file.name);
    // Filtro estricto de audio (eliminando mp4 si solo manejas pistas/voces de sonido)
    const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|ogg|webm|m4a)$/i.test(file.name);

    if (isTextType && !isTxt) {
      return {
        valid: false,
        error: `${file.name}: debe ser un archivo de texto .txt`
      };
    }

    if (!isTextType && !isAudio) {
      return {
        valid: false,
        error: `${file.name}: formato de audio no soportado`
      };
    }
  }

  return { valid: true };
}

// ============================================
// DRAG & DROP HANDLERS PARA UPLOAD DE BIBLIOTECA
// ============================================ 

export function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropZone = document.getElementById("uploadDropZone");
  if (dropZone) dropZone.classList.add("drag-active");
}

export function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropZone = document.getElementById("uploadDropZone");
  if (dropZone) dropZone.classList.remove("drag-active");
}

export function handleFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const dropZone = document.getElementById("uploadDropZone");
  if (dropZone) dropZone.classList.remove("drag-active");

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const fileInput = document.getElementById("libraryFileInput");
  if (fileInput) {
    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ============================================
// 📊 COMPONENTES DE SEGUIMIENTO DE PROGRESO
// ============================================ 

export function addFileToUploadList(container, fileName, status) {
  if (!container) return;
  const div = document.createElement("div");
  div.className = "upload-file-item";
  div.id = "file-" + fileName.replace(/[^a-zA-Z0-9]/g, "-");
  div.innerHTML = `
    <span class="file-name">${fileName}</span>
    <span class="file-status status-${status}">${status === "success" ? "✅ Listo" : status === "error" ? "❌ Error" : "⏳ Pendiente"}</span>
  `;
  container.appendChild(div);
}

export function updateFileStatus(fileName, status, errorMsg = "") {
  const el = document.getElementById("file-" + fileName.replace(/[^a-zA-Z0-9]/g, "-"));
  if (el) {
    const statusEl = el.querySelector(".file-status");
    if (statusEl) {
      statusEl.className = "file-status status-" + status;
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
