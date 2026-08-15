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
    dropZone.addEventListener("click", () => fileInput.click());

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
    const item = await getLibraryItemsByIdFromSupabase(id);
    const r2Key = item?.file_path; 

    const { error } = await db.from('library').delete().eq('id', id);
    if (error) throw new Error(error.message);
    console.log(`✅ Registro con ID ${id} eliminado de Supabase.`);

    if (r2Key && typeof window !== 'undefined' && window.CloudflareStorage) {
      try {
        await window.CloudflareStorage.deleteFileFromCloudflare(r2Key);
        console.log(`☁️ Archivo eliminado de Cloudflare R2: ${r2Key}`);
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
    const { data, error } = await db.from('library').select('*').eq('type', type);
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
    "bin";

  const baseName = (name || "archivo")
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const fileName = `${baseName}.${extension}`;
  console.log(`📤 Generando archivo seguro: ${fileName}`);

  const { filePath, fileUrl } = await window.CloudflareStorage.uploadFileToCloudflare(
    blob,
    fileName,
    mimeType,
    type
  );

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

    const filtroActual = options.type || 'karaoke';
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

  document.querySelectorAll(".folder-btn").forEach(btn => {
    const clickAttr = btn.getAttribute("onclick") || "";
    if (clickAttr.includes(`'${filter}'`)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  container.innerHTML = "Cargando archivos...";

  try {
    let library = await getAllLibraryItemsFromSupabase();
    let filteredItems = filter === "todos" ? library : library.filter(item => item.type === filter);
    container.innerHTML = "";

    if (!filteredItems || filteredItems.length === 0) {
      container.innerHTML = `<p class="empty-message">🗄️ No hay elementos en '${filter}'.</p>`;
      return;
    }

    filteredItems.forEach(item => {
      const div = document.createElement("div");
      div.className = "library-item";
      div.innerHTML = `
        <div class="item-info">
          <span class="item-icon">${item.type === 'texto' ? '📝' : '🎵'}</span>
          <span class="item-name">${item.name}</span>
        </div>
        <button class="delete-library-btn" data-id="${item.id}">🗑️</button>
      `;
      container.appendChild(div);
    });

    asignarEventosBiblioteca(filter);
  } catch (err) {
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
    alert(type === "texto" ? "⚠️ Selecciona un .txt" : "⚠️ Selecciona al menos un archivo");
    return;
  }

  const validation = validateFilesForUpload(files, type);
  if (!validation.valid) {
    alert("❌ " + validation.error);
    return;
  }

  if (!window.CloudflareStorage?.saveLibraryItemToCloudflare) {
    alert("❌ CloudflareStorage no está disponible.");
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
    const customBaseName = nameInput?.value?.trim();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      updateUploadProgress(uploadedCount, totalFiles, file.name);
      addFileToUploadList(uploadFilesList, file.name, "pending");

      try {
        const isTextType = type === "texto" || type === "ultrastar_txt";

        let finalName = file.name;
        const finalName = originalName
        if (finalName) {
          if (files.length === 1) {
            finalName = originalName;
          } else {
            const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
            finalName = `${originalName}_${i + 1}${ext}`;
          }
        }

        if (isTextType) {
          const text = await file.text();
          console.log(`📝 Guardando archivo de texto: ${finalName}`);

          await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: finalName,
            type,
            blob: file,
            textoPlano: text,
            transcription: [],
            metadata: {}
          });
        } else {
          console.log(`🎵 Subiendo audio: ${finalName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

          await window.CloudflareStorage.saveLibraryItemToCloudflare({
            name: finalName,
            type,
            blob: file,
            transcription: [],
            metadata: {}
          });
        }

        updateFileStatus(file.name, "success");
        uploadedCount++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error subiendo ${file.name}:`, err);
        updateFileStatus(file.name, "error", err.message);
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
  const maxSize = 500 * 1024 * 1024; // 500 MB

  for (const file of files) {
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `${file.name}: excede 500 MB`
      };
    }

    const isTxt = file.type === "text/plain" || /\.txt$/i.test(file.name);
    const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|ogg|webm|m4a|mp4)$/i.test(file.name);

    if (isTextType && !isTxt) {
      return {
        valid: false,
        error: `${file.name}: debe ser .txt`
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
